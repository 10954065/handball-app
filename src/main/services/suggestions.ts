import { and, desc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { LiveMatchDTO } from '@shared/dto'
import { AppError } from '@shared/errors'
import type { confirmSuggestionSchema, rejectSuggestionSchema } from '@shared/schemas/vision'
import type { SuggestionCategory, SuggestionDTO, SuggestionStatus } from '@shared/vision'
import type { ShotOutcome } from '@shared/domain/constants'
import { aiEventSuggestions, matchEvents } from '../db/schema'
import { audit } from './audit'
import { type Ctx, notFound, nowOf, requireUser, tx, uuid } from './ctx'
import { getLive, recordEventAt } from './live'
import { clockView } from './live/clock'
import { loadLive } from './live/state'

/** Detections of one action arrive over several frames. Within this time they are the same action. */
const SAME_ACTION_MS = 5000

type Row = typeof aiEventSuggestions.$inferSelect

export interface Proposal {
  matchId: string
  category: SuggestionCategory
  side: 'home' | 'away' | null
  /** The number the camera read, if it read one. */
  jersey: number | null
  trackId: number | null
  confidence: number
  cameraId: string | null
  /** How long ago the frame was taken. The service never knows the match time. */
  ageMs: number
  evidence: unknown
}

const OUTCOME_OF: Partial<Record<SuggestionCategory, ShotOutcome>> = { goal: 'goal', save: 'saved' }

function toDTO(ctx: Ctx, r: Row): SuggestionDTO {
  const event = r.eventId ? ctx.db.select({ status: matchEvents.status }).from(matchEvents).where(eq(matchEvents.id, r.eventId)).get() : null
  return { ...r, evidence: r.evidence ?? null, correction: (r.correction as SuggestionDTO['correction']) ?? null, eventVoided: event?.status === 'voided' }
}

const row = (ctx: Ctx, id: string): Row => ctx.db.select().from(aiEventSuggestions).where(eq(aiEventSuggestions.id, id)).get() ?? notFound('Suggestion')

export function listSuggestions(ctx: Ctx, matchId: string, status?: SuggestionStatus): SuggestionDTO[] {
  const where = status ? and(eq(aiEventSuggestions.matchId, matchId), eq(aiEventSuggestions.status, status)) : eq(aiEventSuggestions.matchId, matchId)
  return ctx.db.select().from(aiEventSuggestions).where(where).orderBy(desc(aiEventSuggestions.matchMs), desc(aiEventSuggestions.createdAt)).all().map((r) => toDTO(ctx, r))
}

/** The player with that number on that team, or null. A number off the roster names nobody. */
function rosterIdFor(ctx: Ctx, matchId: string, side: 'home' | 'away' | null, jersey: number | null): string | null {
  if (side === null || jersey === null) return null
  const players = getLive(ctx, matchId)[side].players.filter((p) => p.jerseyNumber === jersey)
  return players.length === 1 ? players[0].rosterId : null
}

/**
 * Store what the AI thinks happened. This only ever writes to the suggestions table: the score,
 * the ledger and statistics are out of its reach. Returns null when nothing new was stored.
 */
export function proposeSuggestion(ctx: Ctx, p: Proposal): SuggestionDTO | null {
  const d = loadLive(ctx, p.matchId)
  if (d.row.status !== 'live' || d.clock.phase !== 'in_period' || !d.period || d.period.kind === 'shootout') return null
  const matchMs = Math.max(d.period.startMs, clockView(ctx, d.clock, d.period).elapsedMs - p.ageMs)
  const near = (other: number) => Math.abs(other - matchMs) <= SAME_ACTION_MS

  const existing = ctx.db.select().from(aiEventSuggestions).where(and(eq(aiEventSuggestions.matchId, p.matchId), eq(aiEventSuggestions.periodSeq, d.period.seq), eq(aiEventSuggestions.category, p.category))).all()
  const repeat = existing.find((s) => s.side === p.side && near(s.matchMs))
  if (repeat) {
    if (repeat.status === 'pending' && p.confidence > repeat.confidence) {
      ctx.db.update(aiEventSuggestions).set({ confidence: p.confidence, evidence: p.evidence, cameraId: p.cameraId }).where(eq(aiEventSuggestions.id, repeat.id)).run()
    }
    return null
  }
  const outcome = OUTCOME_OF[p.category]
  const official = d.events.some((e) => e.status === 'active' && e.type === 'shot' && e.periodSeq === d.period?.seq && e.side === p.side && (!outcome || e.outcome === outcome) && near(e.matchMs))
  if (official) return null

  const id = uuid()
  ctx.db
    .insert(aiEventSuggestions)
    .values({ id, matchId: p.matchId, category: p.category, side: p.side, rosterId: rosterIdFor(ctx, p.matchId, p.side, p.jersey), jersey: p.jersey, trackId: p.trackId, confidence: p.confidence, cameraId: p.cameraId, periodSeq: d.period.seq, matchMs, evidence: p.evidence ?? null, createdAt: nowOf(ctx) })
    .run()
  return toDTO(ctx, row(ctx, id))
}

function assertPending(s: Row): void {
  if (s.status !== 'pending') throw new AppError('CONFLICT', 'This suggestion has already been decided.')
}

/**
 * Turn a suggestion into an official event, through the match engine and its rules, and nothing
 * else. The suggestion's id is the event's request id, so one suggestion can never score twice.
 */
export function confirmSuggestion(ctx: Ctx, input: z.output<typeof confirmSuggestionSchema>): LiveMatchDTO {
  requireUser(ctx)
  const s = row(ctx, input.id)
  if (s.status === 'confirmed' || s.status === 'corrected') {
    if (s.eventId) return getLive(ctx, s.matchId)
  }
  assertPending(s)
  const side = input.side ?? s.side
  const rosterId = input.rosterId ?? s.rosterId
  const outcome = input.outcome ?? OUTCOME_OF[s.category]
  const matchMs = input.matchMs ?? s.matchMs
  if (!side) throw new AppError('VALIDATION', 'Choose the team.')
  if (!rosterId) throw new AppError('VALIDATION', 'Choose the player. An official event needs one.')
  if (!outcome) throw new AppError('VALIDATION', 'Choose how the shot ended.')

  const correction = { side, rosterId, outcome, matchMs }
  const namedPlayerChanged = s.rosterId !== null && s.rosterId !== rosterId
  const corrected = (s.side !== null && s.side !== side) || namedPlayerChanged || matchMs !== s.matchMs || (OUTCOME_OF[s.category] ?? outcome) !== outcome

  return tx(ctx, () => {
    const live = recordEventAt(
      ctx,
      { matchId: s.matchId, clientRequestId: s.id, event: { kind: 'shot', side, rosterId, outcome, situation: 'positional', zone: null, assistRosterId: null } },
      { periodSeq: s.periodSeq, matchMs }
    )
    const event = ctx.db.select({ id: matchEvents.id }).from(matchEvents).where(and(eq(matchEvents.matchId, s.matchId), eq(matchEvents.clientRequestId, s.id))).get()
    ctx.db
      .update(aiEventSuggestions)
      .set({ status: corrected ? 'corrected' : 'confirmed', eventId: event?.id ?? null, correction: corrected ? correction : null, decidedBy: ctx.user?.username ?? null, decidedAt: nowOf(ctx) })
      .where(eq(aiEventSuggestions.id, s.id))
      .run()
    audit(ctx, { action: 'ai.suggestion.confirm', entity: 'ai_event_suggestions', entityId: s.id, matchId: s.matchId, before: { category: s.category, side: s.side, rosterId: s.rosterId, matchMs: s.matchMs, confidence: s.confidence }, after: correction, note: corrected ? 'Corrected by the official' : null })
    return live
  })
}

export function rejectSuggestion(ctx: Ctx, input: z.output<typeof rejectSuggestionSchema>): { matchId: string } {
  requireUser(ctx)
  const s = row(ctx, input.id)
  assertPending(s)
  tx(ctx, () => {
    ctx.db.update(aiEventSuggestions).set({ status: 'rejected', reason: input.reason, decidedBy: ctx.user?.username ?? null, decidedAt: nowOf(ctx) }).where(eq(aiEventSuggestions.id, s.id)).run()
    audit(ctx, { action: 'ai.suggestion.reject', entity: 'ai_event_suggestions', entityId: s.id, matchId: s.matchId, before: { category: s.category, side: s.side, matchMs: s.matchMs, confidence: s.confidence }, note: input.reason })
  })
  return { matchId: s.matchId }
}

/** A finished match has an official result, so anything still waiting is no longer a question. */
export function expireSuggestions(ctx: Ctx, matchId: string): number {
  return ctx.db.update(aiEventSuggestions).set({ status: 'expired', decidedAt: nowOf(ctx) }).where(and(eq(aiEventSuggestions.matchId, matchId), eq(aiEventSuggestions.status, 'pending'))).run().changes
}
