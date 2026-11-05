import type { RulesConfig } from './rules'

export type PeriodKind = 'regular' | 'overtime' | 'shootout'

/**
 * A period of play. Match time is cumulative across periods, exactly like a handball
 * scoreboard: the second half starts at 30:00 and the first overtime at 60:00. This makes
 * suspension carry-over between periods automatic and unambiguous.
 */
export interface PeriodDef {
  seq: number
  kind: PeriodKind
  label: string
  shortLabel: string
  /** Overtime number (1 or 2) for overtime periods. */
  overtime?: number
  startMs: number
  endMs: number
  /** Break that precedes this period, in minutes (informational). */
  breakBeforeMinutes: number
}

const MIN = 60_000

export function buildPeriodPlan(rules: RulesConfig): PeriodDef[] {
  const plan: PeriodDef[] = []
  const len = rules.periodMinutes * MIN
  plan.push({ seq: 1, kind: 'regular', label: 'First half', shortLabel: '1H', startMs: 0, endMs: len, breakBeforeMinutes: 0 })
  plan.push({
    seq: 2,
    kind: 'regular',
    label: 'Second half',
    shortLabel: '2H',
    startMs: len,
    endMs: 2 * len,
    breakBeforeMinutes: rules.halfTimeBreakMinutes
  })
  let cursor = 2 * len
  let seq = 3
  if (rules.overtime.enabled) {
    const otLen = rules.overtime.periodMinutes * MIN
    for (let ot = 1; ot <= rules.overtime.maxOvertimes; ot++) {
      plan.push({
        seq: seq++,
        kind: 'overtime',
        overtime: ot,
        label: `Overtime ${ot} - first half`,
        shortLabel: `OT${ot}.1`,
        startMs: cursor,
        endMs: cursor + otLen,
        breakBeforeMinutes: rules.overtime.breakBeforeMinutes
      })
      cursor += otLen
      plan.push({
        seq: seq++,
        kind: 'overtime',
        overtime: ot,
        label: `Overtime ${ot} - second half`,
        shortLabel: `OT${ot}.2`,
        startMs: cursor,
        endMs: cursor + otLen,
        breakBeforeMinutes: rules.overtime.breakBetweenMinutes
      })
      cursor += otLen
    }
  }
  if (rules.shootout.enabled) {
    plan.push({
      seq: seq++,
      kind: 'shootout',
      label: 'Penalty shoot-out',
      shortLabel: 'PS',
      startMs: cursor,
      endMs: cursor,
      breakBeforeMinutes: 0
    })
  }
  return plan
}

export function getPeriod(plan: PeriodDef[], seq: number): PeriodDef | undefined {
  return plan.find((p) => p.seq === seq)
}

export function regularEndMs(rules: RulesConfig): number {
  return rules.periodMinutes * 2 * MIN
}

/** Format cumulative match time as MM:SS (minutes may exceed 59, as on a handball clock). */
export function formatMatchTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Format a countdown, rounded up so 0:00 only appears once time has fully elapsed. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
