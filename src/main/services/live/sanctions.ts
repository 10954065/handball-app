import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { planSanction, type SanctionContext, type SanctionTarget } from '@shared/domain/discipline'
import type { LiveSanctionResultDTO } from '@shared/dto'
import { AppError } from '@shared/errors'
import type { sanctionSchema } from '@shared/schemas/live'
import { matchEvents, suspensions } from '../../db/schema'
import { audit } from '../audit'
import { type Ctx, nowOf, requireUser, tx, uuid } from '../ctx'
import { clockView } from './clock'
import { upcomingPeriod } from './dto'
import { getLive } from './flow'
import { insertEvent, type LiveData, loadLive, stateNow } from './state'

function sanctionContext(ctx: Ctx, d: LiveData): SanctionContext {
  if (d.clock.phase === 'break') return 'break'
  if (d.period?.kind === 'shootout') return 'shootout'
  const beforeThrowOff = d.period?.seq === 1 && d.elapsedMs === d.period.startMs && !clockView(ctx, d.clock, d.period).running
  return beforeThrowOff ? 'pre_match' : 'in_play'
}

/**
 * Match time of a sanction. A sanction given in a break takes effect when play resumes, so its
 * timer starts at the next period rather than running out unseen during the break. The event
 * stays in the period that just ended (it happened before the next one started), which keeps it
 * after that period's events and before the next period's in ledger order.
 */
function sanctionTime(d: LiveData): number {
  if (d.clock.phase !== 'break') return d.elapsedMs
  return upcomingPeriod(d, stateNow(d))?.startMs ?? d.elapsedMs
}

const targetIds = (t: SanctionTarget) =>
  t.type === 'player' ? { rosterId: t.rosterId, teamOfficialId: null } : { rosterId: null, teamOfficialId: t.teamOfficialId }

/**
 * Record a disciplinary decision. The referees decide and HMMS records: rule conflicts are shown
 * for acknowledgement, and only consequences the rules mandate are applied automatically.
 */
export function recordSanction(ctx: Ctx, input: z.output<typeof sanctionSchema>): LiveSanctionResultDTO {
  requireUser(ctx)
  const dup = ctx.db
    .select({ id: matchEvents.id })
    .from(matchEvents)
    .where(and(eq(matchEvents.matchId, input.matchId), eq(matchEvents.clientRequestId, input.clientRequestId)))
    .get()
  if (dup) return { live: getLive(ctx, input.matchId), notes: [] }

  const d = loadLive(ctx, input.matchId)
  if (d.row.status !== 'live') throw new AppError('CONFLICT', 'The match is not in progress.')
  if (clockView(ctx, d.clock, d.period).needsRecovery) throw new AppError('CONFLICT', 'Recover the match clock first.')
  if (d.clock.phase !== 'in_period' && d.clock.phase !== 'break') throw new AppError('CONFLICT', 'Sanctions are recorded during a period or a break.')

  const req = { kind: input.kind, side: input.side, target: input.target, blueCard: input.blueCard, context: sanctionContext(ctx, d) }
  const plan = planSanction(req, stateNow(d), d.roster, d.officials, d.row.rules)
  if (plan.errors.length) throw new AppError('RULE_VIOLATION', plan.errors[0], plan.errors)
  if (plan.warnings.length && !input.acknowledged) throw new AppError('NEEDS_CONFIRMATION', 'This decision conflicts with a rule limit.', plan.warnings)

  const ids = targetIds(input.target)
  const matchMs = sanctionTime(d)
  const durationMs = d.row.rules.suspension.durationSeconds * 1000
  const player = d.roster.find((r) => r.id === ids.rosterId)
  tx(ctx, () => {
    let cause: string | null = null
    for (const p of plan.events) {
      const id = insertEvent(ctx, input.matchId, {
        type: p.type,
        side: input.side,
        ...ids,
        periodSeq: d.clock.periodSeq,
        matchMs,
        blueCard: p.blueCard,
        teamReduction: p.teamReduction,
        causedByEventId: p.automatic ? cause : null,
        reason: p.automatic ? `Automatic: suspension number ${plan.sequence}` : (input.reason ?? null),
        clientRequestId: p.automatic ? null : input.clientRequestId
      })
      cause ??= id
      if (p.teamReduction && p.type !== 'warning') {
        ctx.db
          .insert(suspensions)
          .values({
            id: uuid(),
            matchId: input.matchId,
            eventId: id,
            side: input.side,
            teamId: input.side === 'home' ? d.row.homeTeamId : d.row.awayTeamId,
            rosterId: ids.rosterId,
            playerId: player?.playerId ?? null,
            teamOfficialId: ids.teamOfficialId,
            kind: p.type,
            sequence: p.type === 'suspension' ? plan.sequence : 0,
            periodSeq: d.clock.periodSeq,
            startMs: matchMs,
            durationMs,
            endMs: matchMs + durationMs,
            reason: input.reason ?? null,
            recordedBy: ctx.user?.id ?? null,
            createdAt: nowOf(ctx)
          })
          .run()
      }
    }
    audit(ctx, {
      action: `live.sanction.${input.kind}`,
      entity: 'match_events',
      entityId: cause,
      matchId: input.matchId,
      after: { side: input.side, target: input.target, blueCard: input.blueCard, matchMs, context: req.context },
      note: plan.warnings.length ? `Acknowledged: ${plan.warnings.join(' ')}` : null
    })
  })
  return { live: getLive(ctx, input.matchId), notes: plan.notes }
}
