/**
 * Match clock model.
 *
 * The clock never counts by repeatedly subtracting a second. It stores the playing time
 * accumulated before the current run (baseMs) and, while running, the monotonic timestamp at
 * which the run started (anchor). Elapsed time is always derived:
 *
 *   elapsed = baseMs + (running ? now - anchor : 0)
 *
 * "now" must come from a monotonic source (performance.now) so wall-clock changes (NTP, DST,
 * manual changes) cannot move the match clock. For crash recovery the main process also
 * persists the wall-clock time of the run start and periodic checkpoints.
 */
export interface ClockState {
  running: boolean
  baseMs: number
  anchor: number | null
}

export const stoppedClock = (baseMs = 0): ClockState => ({ running: false, baseMs, anchor: null })

export function clockElapsed(c: ClockState, now: number): number {
  if (!c.running || c.anchor === null) return c.baseMs
  return c.baseMs + Math.max(0, now - c.anchor)
}

export function clockStart(c: ClockState, now: number): ClockState {
  if (c.running) return c
  return { running: true, baseMs: c.baseMs, anchor: now }
}

export function clockPause(c: ClockState, now: number): ClockState {
  if (!c.running) return c
  return { running: false, baseMs: clockElapsed(c, now), anchor: null }
}

export function clockSet(c: ClockState, ms: number, now: number): ClockState {
  const safe = Math.max(0, Math.round(ms))
  return c.running ? { running: true, baseMs: safe, anchor: now } : { running: false, baseMs: safe, anchor: null }
}

/** Elapsed time clamped to a period boundary: the clock never runs past the end of a period. */
export function clockElapsedClamped(c: ClockState, now: number, limitMs: number): number {
  return Math.min(clockElapsed(c, now), limitMs)
}

/** Milliseconds until the clock reaches limitMs, or null when not running. */
export function msUntil(c: ClockState, now: number, limitMs: number): number | null {
  if (!c.running) return null
  return Math.max(0, limitMs - clockElapsed(c, now))
}
