import { eq } from 'drizzle-orm'
import { buildPeriodPlan, getPeriod, type PeriodDef } from '@shared/domain/periods'
import type { LiveClockDTO } from '@shared/dto'
import { matchClock, matches } from '../../db/schema'
import { audit } from '../audit'
import { bootIdOf, type Ctx, monoOf, nowOf } from '../ctx'

export type ClockRow = typeof matchClock.$inferSelect

/** Running checkpoints are written at most this often (crash recovery granularity). */
export const CHECKPOINT_INTERVAL_MS = 1000

const clamp = (ms: number, p: PeriodDef | null) => (p && p.kind !== 'shootout' ? Math.min(Math.max(ms, p.startMs), p.endMs) : ms)

export function readClock(ctx: Ctx, matchId: string): ClockRow | undefined {
  return ctx.db.select().from(matchClock).where(eq(matchClock.matchId, matchId)).get()
}

/** True when this process owns the running clock (it was started since the application last started). */
const owned = (ctx: Ctx, row: ClockRow) => row.running && row.bootId === bootIdOf(ctx) && row.runStartedMono !== null

/**
 * Elapsed match time, derived from the monotonic anchor - never counted tick by tick.
 * A clock left running by a previous process is reported stopped at its last checkpoint and
 * flagged for recovery: the operator decides the time to continue from.
 */
export function clockElapsed(ctx: Ctx, row: ClockRow, period: PeriodDef | null): number {
  const raw = owned(ctx, row)
    ? row.baseMs + Math.max(0, monoOf(ctx) - row.runStartedMono!)
    : row.running
      ? row.checkpointMs
      : row.baseMs
  return Math.round(clamp(raw, period))
}

export function clockView(ctx: Ctx, row: ClockRow, period: PeriodDef | null): LiveClockDTO {
  const needsRecovery = row.running && !owned(ctx, row)
  return {
    phase: row.phase,
    periodSeq: row.periodSeq,
    running: owned(ctx, row),
    elapsedMs: clockElapsed(ctx, row, period),
    needsRecovery,
    recovery: needsRecovery
      ? {
          checkpointMs: row.checkpointMs,
          checkpointWall: row.checkpointWall,
          wallElapsedMs: row.checkpointWall ? Math.max(0, nowOf(ctx) - row.checkpointWall) : null
        }
      : null
  }
}

type ClockPatch = Partial<Omit<ClockRow, 'matchId'>>

export function writeClock(ctx: Ctx, matchId: string, patch: ClockPatch): void {
  ctx.db.update(matchClock).set({ ...patch, updatedAt: nowOf(ctx) }).where(eq(matchClock.matchId, matchId)).run()
}

const stopped = (ms: number, at: number): ClockPatch => ({
  running: false,
  baseMs: ms,
  runStartedMono: null,
  runStartedWall: null,
  bootId: null,
  checkpointMs: ms,
  checkpointWall: at
})

export function startClock(ctx: Ctx, row: ClockRow, period: PeriodDef): void {
  const from = clockElapsed(ctx, row, period)
  const at = nowOf(ctx)
  writeClock(ctx, row.matchId, {
    running: true,
    baseMs: from,
    runStartedMono: monoOf(ctx),
    runStartedWall: at,
    bootId: bootIdOf(ctx),
    checkpointMs: from,
    checkpointWall: at
  })
}

export function stopClock(ctx: Ctx, row: ClockRow, period: PeriodDef | null): number {
  const ms = clockElapsed(ctx, row, period)
  writeClock(ctx, row.matchId, stopped(ms, nowOf(ctx)))
  syncSuspensions(ctx, row.matchId, ms)
  return ms
}

/** Set the clock to an exact time, keeping it running if it was running. */
export function setClockTo(ctx: Ctx, row: ClockRow, ms: number): void {
  const at = nowOf(ctx)
  if (owned(ctx, row)) {
    writeClock(ctx, row.matchId, { baseMs: ms, runStartedMono: monoOf(ctx), runStartedWall: at, checkpointMs: ms, checkpointWall: at })
  } else writeClock(ctx, row.matchId, stopped(ms, at))
}

/**
 * Bring the suspensions mirror in line with the match clock. The ledger stays authoritative;
 * this keeps the table's status right, including after the clock is corrected backwards.
 * Returns true when a suspension expired.
 */
export function syncSuspensions(ctx: Ctx, matchId: string, ms: number): boolean {
  const expired = ctx.sqlite
    .prepare("UPDATE suspensions SET status = 'completed', completed_at = ? WHERE match_id = ? AND status = 'active' AND end_ms <= ?")
    .run(nowOf(ctx), matchId, ms)
  ctx.sqlite.prepare("UPDATE suspensions SET status = 'active', completed_at = NULL WHERE match_id = ? AND status = 'completed' AND end_ms > ?").run(matchId, ms)
  return expired.changes > 0
}

function runningRows(ctx: Ctx) {
  return ctx.db
    .select({ row: matchClock, rules: matches.rules })
    .from(matchClock)
    .innerJoin(matches, eq(matches.id, matchClock.matchId))
    .where(eq(matchClock.running, true))
    .all()
    .filter((r) => owned(ctx, r.row))
}

/**
 * Called by the main process a few times per second. Stops a clock exactly at the end of its
 * period and writes recovery checkpoints. Returns the matches whose state changed visibly.
 */
export function tickClocks(ctx: Ctx): string[] {
  const changed: string[] = []
  const at = nowOf(ctx)
  for (const { row, rules } of runningRows(ctx)) {
    const period = getPeriod(buildPeriodPlan(rules), row.periodSeq) ?? null
    const ms = clockElapsed(ctx, row, period)
    if (syncSuspensions(ctx, row.matchId, ms)) changed.push(row.matchId)
    if (period && ms >= period.endMs) {
      ctx.sqlite.transaction(() => {
        writeClock(ctx, row.matchId, stopped(period.endMs, at))
        audit(ctx, { action: 'live.clock.autostop', entity: 'match_clock', entityId: row.matchId, matchId: row.matchId, after: { ms: period.endMs } })
      })()
      changed.push(row.matchId)
    } else if (!row.checkpointWall || at - row.checkpointWall >= CHECKPOINT_INTERVAL_MS) {
      writeClock(ctx, row.matchId, { checkpointMs: ms, checkpointWall: at })
    }
  }
  return [...new Set(changed)]
}

/** Matches with a clock running in this process. */
export function runningClocks(ctx: Ctx): string[] {
  return runningRows(ctx).map((r) => r.row.matchId)
}

/** Stop every running clock (application closing). Each stop is audited. */
export function stopAllClocks(ctx: Ctx, note: string): string[] {
  const ids: string[] = []
  ctx.sqlite.transaction(() => {
    for (const { row, rules } of runningRows(ctx)) {
      const ms = stopClock(ctx, row, getPeriod(buildPeriodPlan(rules), row.periodSeq) ?? null)
      audit(ctx, { action: 'live.clock.stop', entity: 'match_clock', entityId: row.matchId, matchId: row.matchId, after: { ms }, note })
      ids.push(row.matchId)
    }
  })()
  return ids
}
