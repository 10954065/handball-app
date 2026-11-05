import type { PeriodDef } from './periods'
import type { RulesConfig } from './rules'

/** Seconds before the end of a time-out at which the warning signal sounds. VERIFY against IHF 2:10. */
export const TIMEOUT_WARNING_SECONDS = 10

export interface TimeoutRecord {
  periodSeq: number
  matchMs: number
}

export interface TimeoutCheck {
  allowed: boolean
  reason: string | null
  usedInMatch: number
  usedInPeriod: number
  remainingInMatch: number
}

/**
 * Validate a team time-out request against the IHF Electronic Team Time-Out Regulations:
 * a 4th time-out, a 3rd in the same half, a 2nd in the last five minutes of regular playing
 * time, and any time-out in overtime are faulty requests and are not granted.
 */
export function checkTimeout(
  taken: readonly TimeoutRecord[],
  period: PeriodDef,
  matchMs: number,
  rules: RulesConfig
): TimeoutCheck {
  const t = rules.timeouts
  const regular = taken.filter((r) => r.periodSeq <= 2)
  const usedInMatch = regular.length
  const usedInPeriod = taken.filter((r) => r.periodSeq === period.seq).length
  const result = (allowed: boolean, reason: string | null): TimeoutCheck => ({
    allowed,
    reason,
    usedInMatch,
    usedInPeriod,
    remainingInMatch: Math.max(0, t.perMatch - usedInMatch)
  })

  if (period.kind === 'shootout') return result(false, 'Team time-outs are not permitted during the penalty shoot-out.')
  if (period.kind === 'overtime' && !t.allowedInOvertime) {
    return result(false, 'Team time-outs are not permitted in overtime.')
  }
  if (period.kind === 'regular') {
    if (usedInMatch >= t.perMatch) return result(false, `All ${t.perMatch} team time-outs have been used.`)
    if (usedInPeriod >= t.perHalf) return result(false, `Only ${t.perHalf} team time-outs are permitted in each half.`)
    const windowStart = period.endMs - t.finalWindowMinutes * 60_000
    if (period.seq === 2 && matchMs >= windowStart) {
      const inWindow = regular.filter((r) => r.periodSeq === 2 && r.matchMs >= windowStart).length
      if (inWindow >= t.inFinalWindow) {
        return result(false, `Only ${t.inFinalWindow} team time-out is permitted in the last ${t.finalWindowMinutes} minutes.`)
      }
    }
  }
  return result(true, null)
}
