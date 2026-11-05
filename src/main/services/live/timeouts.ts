import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { checkTimeout } from '@shared/domain/timeouts'
import type { LiveMatchDTO } from '@shared/dto'
import { AppError } from '@shared/errors'
import type { startTimeoutSchema } from '@shared/schemas/live'
import { matchClock, matchEvents, timeouts } from '../../db/schema'
import { audit } from '../audit'
import { bootIdOf, type Ctx, monoOf, nowOf, requireUser, tx, uuid } from '../ctx'
import { clockView, stopClock } from './clock'
import { getLive, playingPeriod } from './flow'
import { insertEvent, loadLive, takenTimeouts } from './state'
import { activeTimeout, closeTimeout } from './timeout-clock'

/** Grant a team time-out: the clock stops at once and the time-out runs in real time. */
export function startTimeout(ctx: Ctx, input: z.output<typeof startTimeoutSchema>): LiveMatchDTO {
  requireUser(ctx)
  const dup = ctx.db
    .select({ id: matchEvents.id })
    .from(matchEvents)
    .where(and(eq(matchEvents.matchId, input.matchId), eq(matchEvents.clientRequestId, input.clientRequestId)))
    .get()
  if (dup) return getLive(ctx, input.matchId)

  const d = loadLive(ctx, input.matchId)
  const period = playingPeriod(ctx, d)
  if (d.clock.timeoutId) throw new AppError('CONFLICT', 'A team time-out is already in progress.')
  const check = checkTimeout(takenTimeouts(d, input.side), period, d.elapsedMs, d.row.rules)
  if (!check.allowed) throw new AppError('RULE_VIOLATION', check.reason ?? 'The team time-out cannot be granted.')

  tx(ctx, () => {
    const ms = clockView(ctx, d.clock, period).running ? stopClock(ctx, d.clock, period) : d.elapsedMs
    const eventId = insertEvent(ctx, input.matchId, { type: 'timeout', side: input.side, periodSeq: period.seq, matchMs: ms, clientRequestId: input.clientRequestId })
    const id = uuid()
    ctx.db
      .insert(timeouts)
      .values({
        id,
        matchId: input.matchId,
        eventId,
        side: input.side,
        teamId: input.side === 'home' ? d.row.homeTeamId : d.row.awayTeamId,
        periodSeq: period.seq,
        matchMs: ms,
        durationMs: d.row.rules.timeouts.durationSeconds * 1000,
        startedWall: nowOf(ctx),
        startedMono: monoOf(ctx),
        bootId: bootIdOf(ctx)
      })
      .run()
    ctx.db.update(matchClock).set({ timeoutId: id, updatedAt: nowOf(ctx) }).where(eq(matchClock.matchId, input.matchId)).run()
    audit(ctx, { action: 'live.timeout.start', entity: 'timeouts', entityId: id, matchId: input.matchId, after: { side: input.side, ms } })
  })
  return getLive(ctx, input.matchId)
}

/** End the time-out early. The clock stays stopped until play restarts. */
export function endTimeout(ctx: Ctx, matchId: string): LiveMatchDTO {
  requireUser(ctx)
  const row = activeTimeout(ctx, matchId)
  if (!row) throw new AppError('CONFLICT', 'No team time-out is in progress.')
  tx(ctx, () => {
    closeTimeout(ctx, row, 'completed')
    audit(ctx, { action: 'live.timeout.end', entity: 'timeouts', entityId: row.id, matchId, after: { automatic: false } })
  })
  return getLive(ctx, matchId)
}
