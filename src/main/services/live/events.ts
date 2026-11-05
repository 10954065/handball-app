import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { shootoutStatus } from '@shared/domain/flow'
import { activeEvents, compareEvents } from '@shared/domain/ledger'
import { EDITABLE_EVENTS, VOIDABLE_EVENTS, validateDraft, type EventContext, type EventDraft } from '@shared/domain/live'
import { formatMatchTime, getPeriod } from '@shared/domain/periods'
import type { LedgerEvent } from '@shared/domain/types'
import type { LiveMatchDTO } from '@shared/dto'
import { AppError } from '@shared/errors'
import type { editEventSchema, recordEventSchema, voidEventSchema } from '@shared/schemas/live'
import { matchEvents, substitutions, suspensions, timeouts } from '../../db/schema'
import { audit } from '../audit'
import { type Ctx, nowOf, requireUser, tx, uuid } from '../ctx'
import { clockView } from './clock'
import { canCorrect } from './dto'
import { getLive, refreshFinalResult } from './flow'
import { currentShootout, type EventRow, findEvent, insertEvent, type LiveData, loadLive, shootoutExcluded, stateBefore, stateNow } from './state'
import { closeTimeout } from './timeout-clock'

function reject(errors: string[]): never {
  throw new AppError('RULE_VIOLATION', errors[0], errors)
}

/**
 * Record a live event at the current match time. The time comes from the main-process clock,
 * never from the renderer. A repeated clientRequestId is answered without recording twice.
 */
export function recordEvent(ctx: Ctx, input: z.output<typeof recordEventSchema>): LiveMatchDTO {
  requireUser(ctx)
  const dup = ctx.db
    .select({ id: matchEvents.id })
    .from(matchEvents)
    .where(and(eq(matchEvents.matchId, input.matchId), eq(matchEvents.clientRequestId, input.clientRequestId)))
    .get()
  if (dup) return getLive(ctx, input.matchId)

  const d = loadLive(ctx, input.matchId)
  if (d.row.status !== 'live') throw new AppError('CONFLICT', 'The match is not in progress.')
  if (clockView(ctx, d.clock, d.period).needsRecovery) throw new AppError('CONFLICT', 'Recover the match clock first.')
  const c: EventContext = {
    roster: d.roster,
    state: stateNow(d),
    phase: d.clock.phase,
    period: d.period,
    shootout: currentShootout(d),
    onCourtMax: d.row.rules.roster.onCourt,
    timeoutActive: !!d.clock.timeoutId,
    shootoutExcluded: shootoutExcluded(d)
  }
  const r = validateDraft(input.event, c)
  if (!r.event) reject(r.errors)
  const fields = r.event

  tx(ctx, () => {
    const eventId = insertEvent(ctx, input.matchId, {
      ...fields,
      periodSeq: d.clock.periodSeq,
      matchMs: d.elapsedMs,
      clientRequestId: input.clientRequestId
    })
    if (fields.type === 'substitution') {
      ctx.db
        .insert(substitutions)
        .values({
          id: uuid(),
          matchId: input.matchId,
          eventId,
          side: fields.side!,
          outRosterId: fields.rosterId,
          inRosterId: fields.inRosterId,
          periodSeq: d.clock.periodSeq,
          matchMs: d.elapsedMs,
          createdAt: nowOf(ctx)
        })
        .run()
    }
  })
  return getLive(ctx, input.matchId)
}

function correctionTarget(ctx: Ctx, d: LiveData, eventId: string, allowed: ReadonlySet<string>): EventRow {
  if (!canCorrect(ctx, d)) {
    throw d.row.status === 'finished'
      ? new AppError('FORBIDDEN', 'Only an administrator can correct a finalized match.')
      : new AppError('CONFLICT', 'Events can be corrected while the match is in progress.')
  }
  const e = findEvent(ctx, d.row.id, eventId)
  if (e.status !== 'active') throw new AppError('CONFLICT', 'This event has already been voided.')
  if (!allowed.has(e.type)) throw new AppError('VALIDATION', 'This kind of event cannot be changed here.')
  if (e.causedByEventId) throw new AppError('CONFLICT', 'This is an automatic consequence. Void the suspension that caused it.')
  return e
}

/**
 * Refuse a correction that would leave later entries inconsistent: a substitution whose players
 * appear in later events, or a shoot-out throw that is not the last one.
 */
function assertNoDependents(d: LiveData, e: EventRow): void {
  const target = d.events.find((x) => x.id === e.id)!
  const later = activeEvents(d.events).filter((x) => x.id !== e.id && compareEvents(x, target) > 0)
  if (e.type === 'substitution') {
    const players = new Set([e.rosterId, e.inRosterId].filter(Boolean))
    const dependent = later.find((x) => [x.rosterId, x.inRosterId, x.assistRosterId, x.goalkeeperRosterId].some((id) => id && players.has(id)))
    if (dependent) throw new AppError('CONFLICT', 'Later entries involve these players. Correct or void the later entries first.')
  }
  if (e.type === 'suspension') {
    const samePerson = (x: LedgerEvent) => x.type === 'suspension' && (e.rosterId ? x.rosterId === e.rosterId : x.teamOfficialId === e.teamOfficialId)
    if (later.some(samePerson)) throw new AppError('CONFLICT', 'Suspensions are numbered. Void the later suspension of this person first.')
  }
  if (e.situation === 'shootout' && later.some((x) => x.situation === 'shootout')) {
    throw new AppError('CONFLICT', 'Only the last shoot-out throw can be corrected. Void the later throws first.')
  }
}

/** Void one event, its automatic consequences, and the mirror tables that follow them. */
function voidRow(ctx: Ctx, e: EventRow, reason: string): void {
  const consequences = ctx.db.select().from(matchEvents).where(and(eq(matchEvents.causedByEventId, e.id), eq(matchEvents.status, 'active'))).all()
  for (const row of [e, ...consequences]) {
    ctx.db
      .update(matchEvents)
      .set({ status: 'voided', voidedAt: nowOf(ctx), voidedBy: ctx.user?.id ?? null, voidReason: reason })
      .where(eq(matchEvents.id, row.id))
      .run()
    ctx.db.update(substitutions).set({ status: 'voided' }).where(eq(substitutions.eventId, row.id)).run()
    ctx.db.update(suspensions).set({ status: 'cancelled' }).where(eq(suspensions.eventId, row.id)).run()
    const timeout = ctx.db.select().from(timeouts).where(eq(timeouts.eventId, row.id)).get()
    if (timeout) closeTimeout(ctx, timeout, 'voided')
  }
}

/** Void an event (undo). The event stays in the ledger, struck through, with who voided it and why. */
export function voidEvent(ctx: Ctx, input: z.output<typeof voidEventSchema>): LiveMatchDTO {
  requireUser(ctx)
  const d = loadLive(ctx, input.matchId)
  const e = correctionTarget(ctx, d, input.eventId, VOIDABLE_EVENTS)
  assertNoDependents(d, e)
  tx(ctx, () => {
    voidRow(ctx, e, input.reason)
    audit(ctx, { action: 'live.event.void', entity: 'match_events', entityId: e.id, matchId: input.matchId, before: e, note: input.reason })
    refreshFinalResult(ctx, input.matchId)
  })
  return getLive(ctx, input.matchId)
}

/**
 * Correct an event: the original is voided and a corrected copy is recorded in its place in
 * the match, linked by replacesEventId. The correction is validated against the situation at
 * the time of the original event.
 */
export function editEvent(ctx: Ctx, input: z.output<typeof editEventSchema>): LiveMatchDTO {
  requireUser(ctx)
  const d = loadLive(ctx, input.matchId)
  const orig = correctionTarget(ctx, d, input.eventId, EDITABLE_EVENTS)
  assertNoDependents(d, orig)
  const draft: EventDraft = input.event
  if (!EDITABLE_EVENTS.has(draft.kind)) throw new AppError('VALIDATION', 'Shots and play events can only be corrected into shots or play events.')

  const period = getPeriod(d.plan, orig.periodSeq)
  if (!period) throw new AppError('CONFLICT', 'The period of this event is unknown.')
  const matchMs = input.matchMs ?? orig.matchMs
  const ended = activeEvents(d.events).find((e) => e.type === 'period_end' && e.periodSeq === period.seq)
  const latest = ended ? ended.matchMs : d.period?.seq === period.seq && d.clock.phase === 'in_period' ? d.elapsedMs : period.endMs
  if (period.kind !== 'shootout' && (matchMs < period.startMs || matchMs > latest)) {
    throw new AppError('VALIDATION', `The time must be between ${formatMatchTime(period.startMs)} and ${formatMatchTime(latest)}.`)
  }

  const others = d.events.filter((e) => e.id !== orig.id)
  const c: EventContext = {
    roster: d.roster,
    state: stateBefore(d, { periodSeq: period.seq, matchMs }, orig),
    phase: 'in_period',
    period,
    shootout: period.kind === 'shootout' ? shootoutStatus(others, d.row.rules) : null,
    onCourtMax: d.row.rules.roster.onCourt,
    timeoutActive: false,
    shootoutExcluded: new Set()
  }
  const r = validateDraft(draft, c)
  if (!r.event) reject(r.errors)
  const fields = r.event

  tx(ctx, () => {
    voidRow(ctx, orig, `Corrected: ${input.reason}`)
    const id = insertEvent(ctx, input.matchId, { ...fields, periodSeq: period.seq, matchMs, replacesEventId: orig.id })
    audit(ctx, {
      action: 'live.event.edit',
      entity: 'match_events',
      entityId: id,
      matchId: input.matchId,
      before: orig,
      after: { ...fields, matchMs },
      note: input.reason
    })
    refreshFinalResult(ctx, input.matchId)
  })
  return getLive(ctx, input.matchId)
}
