import { and, eq } from 'drizzle-orm'
import { matchResult } from '@shared/domain/flow'
import { formatCountdown, formatMatchTime, type PeriodDef } from '@shared/domain/periods'
import type { LiveMatchDTO } from '@shared/dto'
import { AppError } from '@shared/errors'
import { matchClock, matches, matchPeriods } from '../../db/schema'
import { audit } from '../audit'
import { type Ctx, nowOf, requireUser, tx, uuid } from '../ctx'
import { clockView, setClockTo, startClock, stopClock, syncSuspensions } from './clock'
import { buildLiveDTO, upcomingPeriod } from './dto'
import { currentShootout, insertEvent, type LiveData, loadLive, scoreOf, stateNow } from './state'

export function getLive(ctx: Ctx, matchId: string): LiveMatchDTO {
  return buildLiveDTO(ctx, loadLive(ctx, matchId))
}

function assertLive(ctx: Ctx, d: LiveData): void {
  if (d.row.status !== 'live') throw new AppError('CONFLICT', 'The match is not in progress.')
  if (clockView(ctx, d.clock, d.period).needsRecovery) {
    throw new AppError('CONFLICT', 'Recover the match clock first.')
  }
}

const logEntry = (d: LiveData, action: string, after: unknown, note?: string) => ({
  action,
  entity: 'match_clock',
  entityId: d.row.id,
  matchId: d.row.id,
  after,
  note: note ?? null
})

/** Go live (if needed) and start the next period. The clock stays stopped until the throw-off whistle. */
export function startPeriod(ctx: Ctx, matchId: string): LiveMatchDTO {
  requireUser(ctx)
  let d = loadLive(ctx, matchId)
  if (d.row.status === 'scheduled') throw new AppError('CONFLICT', 'Both lineups must be confirmed before the match can start.')
  if (d.row.status === 'finished' || d.row.status === 'abandoned') throw new AppError('CONFLICT', 'This match is already over.')
  tx(ctx, () => {
    if (d.row.status === 'ready') {
      const at = nowOf(ctx)
      ctx.db.insert(matchClock).values({ matchId, phase: 'pre_match', periodSeq: 0, updatedAt: at }).run()
      ctx.db.update(matches).set({ status: 'live', startedAt: at, updatedAt: at }).where(eq(matches.id, matchId)).run()
      audit(ctx, { action: 'live.match.start', entity: 'matches', entityId: matchId, matchId })
      d = loadLive(ctx, matchId)
    }
    assertLive(ctx, d)
    const target = upcomingPeriod(d, stateNow(d))
    if (!target) throw new AppError('CONFLICT', 'There is no further period to play.')
    insertEvent(ctx, matchId, { type: 'period_start', periodSeq: target.seq, matchMs: target.startMs })
    ctx.db
      .insert(matchPeriods)
      .values({ id: uuid(), matchId, seq: target.seq, kind: target.kind, label: target.label, startMs: target.startMs, endMs: target.endMs, startedAt: nowOf(ctx) })
      .onConflictDoUpdate({ target: [matchPeriods.matchId, matchPeriods.seq], set: { startedAt: nowOf(ctx), endedAt: null } })
      .run()
    ctx.db
      .update(matchClock)
      .set({ phase: 'in_period', periodSeq: target.seq, running: false, baseMs: target.startMs, checkpointMs: target.startMs, bootId: null, runStartedMono: null, updatedAt: nowOf(ctx) })
      .where(eq(matchClock.matchId, matchId))
      .run()
    audit(ctx, logEntry(d, 'live.period.start', { period: target.label }))
  })
  return getLive(ctx, matchId)
}

export function playingPeriod(ctx: Ctx, d: LiveData): PeriodDef {
  assertLive(ctx, d)
  if (d.clock.phase !== 'in_period' || !d.period) throw new AppError('CONFLICT', 'No period is in progress.')
  return d.period
}

export function clockAction(ctx: Ctx, input: { matchId: string; action: 'start' | 'stop' }): LiveMatchDTO {
  requireUser(ctx)
  const d = loadLive(ctx, input.matchId)
  const period = playingPeriod(ctx, d)
  if (period.kind === 'shootout') throw new AppError('CONFLICT', 'The penalty shoot-out is played without the match clock.')
  const running = clockView(ctx, d.clock, period).running
  if (input.action === 'start' && d.clock.timeoutId) throw new AppError('CONFLICT', 'A team time-out is in progress. End it before restarting the clock.')
  tx(ctx, () => {
    if (input.action === 'start' && !running) {
      if (d.elapsedMs >= period.endMs) throw new AppError('CONFLICT', 'The playing time of this period is over. End the period or correct the clock.')
      startClock(ctx, d.clock, period)
      audit(ctx, logEntry(d, 'live.clock.start', { ms: d.elapsedMs }))
    }
    if (input.action === 'stop' && running) {
      const ms = stopClock(ctx, d.clock, period)
      audit(ctx, logEntry(d, 'live.clock.stop', { ms }))
    }
  })
  return getLive(ctx, input.matchId)
}

/** Correct the match clock. Recorded in the ledger (clock_adjust) and the audit log with a reason. */
export function setClock(ctx: Ctx, input: { matchId: string; ms: number; reason: string }): LiveMatchDTO {
  requireUser(ctx)
  const d = loadLive(ctx, input.matchId)
  const period = playingPeriod(ctx, d)
  if (period.kind === 'shootout') throw new AppError('CONFLICT', 'The penalty shoot-out is played without the match clock.')
  if (input.ms < period.startMs || input.ms > period.endMs) {
    throw new AppError('VALIDATION', `The time must be within ${period.label} (${formatMatchTime(period.startMs)} - ${formatMatchTime(period.endMs)}).`)
  }
  tx(ctx, () => {
    setClockTo(ctx, d.clock, input.ms)
    syncSuspensions(ctx, input.matchId, input.ms)
    insertEvent(ctx, input.matchId, {
      type: 'clock_adjust',
      periodSeq: period.seq,
      matchMs: input.ms,
      reason: `${formatMatchTime(d.elapsedMs)} -> ${formatMatchTime(input.ms)}: ${input.reason}`
    })
    audit(ctx, { ...logEntry(d, 'live.clock.set', { from: d.elapsedMs, to: input.ms }), note: input.reason })
  })
  return getLive(ctx, input.matchId)
}

/** After an unexpected shutdown, continue from a time chosen by the operator (clock stopped). */
export function recoverClock(ctx: Ctx, input: { matchId: string; resumeAtMs: number }): LiveMatchDTO {
  requireUser(ctx)
  const d = loadLive(ctx, input.matchId)
  const view = clockView(ctx, d.clock, d.period)
  if (!view.needsRecovery || !view.recovery) throw new AppError('CONFLICT', 'The match clock does not need recovery.')
  const p = d.period
  const ms = p && p.kind !== 'shootout' ? Math.min(Math.max(input.resumeAtMs, p.startMs), p.endMs) : input.resumeAtMs
  tx(ctx, () => {
    setClockTo(ctx, { ...d.clock, running: false }, ms)
    syncSuspensions(ctx, input.matchId, ms)
    insertEvent(ctx, input.matchId, {
      type: 'clock_adjust',
      periodSeq: d.clock.periodSeq,
      matchMs: ms,
      reason: `Recovered after an unexpected shutdown: last saved ${formatMatchTime(view.recovery!.checkpointMs)}, continued at ${formatMatchTime(ms)}`
    })
    audit(ctx, logEntry(d, 'live.clock.recover', { checkpointMs: view.recovery!.checkpointMs, wallElapsedMs: view.recovery!.wallElapsedMs, resumeAtMs: ms }))
  })
  return getLive(ctx, input.matchId)
}

/** End the current period. Ending early, or a shoot-out that is not decided, needs confirmation. */
export function endPeriod(ctx: Ctx, input: { matchId: string; force: boolean }): LiveMatchDTO {
  requireUser(ctx)
  const d = loadLive(ctx, input.matchId)
  const period = playingPeriod(ctx, d)
  if (clockView(ctx, d.clock, period).running) throw new AppError('CONFLICT', 'Stop the clock before ending the period.')
  if (d.clock.timeoutId) throw new AppError('CONFLICT', 'End the team time-out before ending the period.')
  if (!input.force) {
    if (period.kind === 'shootout' && !currentShootout(d)?.decided) {
      throw new AppError('NEEDS_CONFIRMATION', 'The shoot-out has not been decided yet.', ['End the shoot-out anyway?'])
    }
    if (period.kind !== 'shootout' && d.elapsedMs < period.endMs) {
      throw new AppError('NEEDS_CONFIRMATION', `${formatCountdown(period.endMs - d.elapsedMs)} of playing time remain in the ${period.label.toLowerCase()}.`, [
        'End the period early?'
      ])
    }
  }
  tx(ctx, () => {
    const state = stateNow(d)
    insertEvent(ctx, input.matchId, { type: 'period_end', periodSeq: period.seq, matchMs: d.elapsedMs })
    ctx.db
      .update(matchPeriods)
      .set({ endedAt: nowOf(ctx), homeScore: state.home.score, awayScore: state.away.score })
      .where(and(eq(matchPeriods.matchId, input.matchId), eq(matchPeriods.seq, period.seq)))
      .run()
    ctx.db.update(matchClock).set({ phase: 'break', updatedAt: nowOf(ctx) }).where(eq(matchClock.matchId, input.matchId)).run()
    audit(ctx, logEntry(d, 'live.period.end', { period: period.label, ms: d.elapsedMs, score: scoreOf(state), early: d.elapsedMs < period.endMs }))
  })
  return getLive(ctx, input.matchId)
}

/** Result fields of the match row, recomputed from the ledger. */
function resultValues(d: LiveData) {
  const state = stateNow(d)
  const half = state.scoreByPeriod.get(1)
  const r = matchResult(scoreOf(state), d.period ?? d.plan[0], currentShootout(d))
  return {
    homeScore: r.homeScore,
    awayScore: r.awayScore,
    homeHalfTime: half?.home ?? null,
    awayHalfTime: half?.away ?? null,
    homeShootout: r.homeShootout,
    awayShootout: r.awayShootout,
    winnerSide: r.winnerSide,
    decidedBy: r.decidedBy
  }
}

/** Finalize the match: the result is written from the ledger and the match becomes read-only. */
export function finishMatch(ctx: Ctx, input: { matchId: string; force: boolean }): LiveMatchDTO {
  const user = requireUser(ctx)
  const d = loadLive(ctx, input.matchId)
  assertLive(ctx, d)
  if (d.clock.phase !== 'break' || upcomingPeriod(d, stateNow(d))) {
    throw new AppError('CONFLICT', 'The match can be finished after the final period has ended.')
  }
  const values = resultValues(d)
  if (values.winnerSide === 'draw' && !d.row.rules.drawAllowed && !input.force) {
    throw new AppError('NEEDS_CONFIRMATION', 'These rules require a winner, but the match is level and no further period is configured.', [
      'Finish the match as a draw?'
    ])
  }
  const at = nowOf(ctx)
  tx(ctx, () => {
    ctx.db
      .update(matches)
      .set({ ...values, status: 'finished', finalizedAt: at, finalizedBy: user.id, updatedAt: at })
      .where(eq(matches.id, input.matchId))
      .run()
    ctx.db.update(matchClock).set({ phase: 'finished', updatedAt: at }).where(eq(matchClock.matchId, input.matchId)).run()
    audit(ctx, { action: 'live.match.finish', entity: 'matches', entityId: input.matchId, matchId: input.matchId, after: values })
  })
  return getLive(ctx, input.matchId)
}

/** After a correction to a finalized match: rewrite the result and mark the match as amended. */
export function refreshFinalResult(ctx: Ctx, matchId: string): void {
  const d = loadLive(ctx, matchId)
  if (d.row.status !== 'finished') return
  const values = resultValues(d)
  ctx.db.update(matches).set({ ...values, amended: true, updatedAt: nowOf(ctx) }).where(eq(matches.id, matchId)).run()
  audit(ctx, { action: 'live.match.amend', entity: 'matches', entityId: matchId, matchId, before: { homeScore: d.row.homeScore, awayScore: d.row.awayScore }, after: values })
}
