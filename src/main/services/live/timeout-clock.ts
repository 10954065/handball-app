import { and, eq } from 'drizzle-orm'
import type { LiveTimeoutDTO } from '@shared/dto'
import { matchClock, timeouts } from '../../db/schema'
import { audit } from '../audit'
import { bootIdOf, type Ctx, monoOf, nowOf } from '../ctx'

type TimeoutRow = typeof timeouts.$inferSelect

export function activeTimeout(ctx: Ctx, matchId: string): TimeoutRow | undefined {
  return ctx.db.select().from(timeouts).where(and(eq(timeouts.matchId, matchId), eq(timeouts.status, 'active'))).get()
}

/** Monotonic while this process owns the time-out; wall time after a restart. */
function elapsed(ctx: Ctx, row: TimeoutRow): number {
  const owned = row.bootId === bootIdOf(ctx) && row.startedMono !== null
  return Math.round(Math.max(0, owned ? monoOf(ctx) - row.startedMono! : nowOf(ctx) - row.startedWall))
}

export function timeoutView(ctx: Ctx, matchId: string): LiveTimeoutDTO | null {
  const row = activeTimeout(ctx, matchId)
  return row ? { id: row.id, eventId: row.eventId, side: row.side, durationMs: row.durationMs, elapsedMs: Math.min(elapsed(ctx, row), row.durationMs) } : null
}

/** End a time-out. The match clock stays stopped until the referees restart play. */
export function closeTimeout(ctx: Ctx, row: TimeoutRow, status: 'completed' | 'voided'): void {
  ctx.db.update(timeouts).set({ status, endedWall: row.endedWall ?? nowOf(ctx) }).where(eq(timeouts.id, row.id)).run()
  // Voiding an old time-out must not disturb another one that is running now.
  ctx.db
    .update(matchClock)
    .set({ timeoutId: null, updatedAt: nowOf(ctx) })
    .where(and(eq(matchClock.matchId, row.matchId), eq(matchClock.timeoutId, row.id)))
    .run()
}

/** Close time-outs whose time has run out. Returns the matches that changed. */
export function tickTimeouts(ctx: Ctx): string[] {
  const running = ctx.db.select().from(timeouts).where(eq(timeouts.status, 'active')).all()
  const due = running.filter((r) => elapsed(ctx, r) >= r.durationMs)
  for (const row of due) {
    ctx.sqlite.transaction(() => {
      closeTimeout(ctx, row, 'completed')
      audit(ctx, { action: 'live.timeout.end', entity: 'timeouts', entityId: row.id, matchId: row.matchId, after: { automatic: true } })
    })()
  }
  return due.map((r) => r.matchId)
}
