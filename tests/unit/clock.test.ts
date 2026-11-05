import { describe, expect, it } from 'vitest'
import { clockElapsed, clockElapsedClamped, clockPause, clockSet, clockStart, msUntil, stoppedClock } from '@shared/domain/clock'
import { buildPeriodPlan, formatCountdown, formatMatchTime, regularEndMs } from '@shared/domain/periods'
import { DEFAULT_RULES, RULE_PRESETS, findPreset, rulesConfigSchema } from '@shared/domain/rules'

describe('match clock', () => {
  it('derives elapsed time from a monotonic anchor instead of counting ticks', () => {
    const c = clockStart(stoppedClock(0), 1_000)
    expect(clockElapsed(c, 1_000)).toBe(0)
    expect(clockElapsed(c, 61_500)).toBe(60_500)
  })

  it('accumulates across pause and resume', () => {
    let c = clockStart(stoppedClock(), 0)
    c = clockPause(c, 10_000)
    expect(clockElapsed(c, 99_999)).toBe(10_000)
    c = clockStart(c, 50_000)
    expect(clockElapsed(c, 55_000)).toBe(15_000)
  })

  it('start and pause are idempotent', () => {
    const running = clockStart(stoppedClock(), 0)
    expect(clockStart(running, 5_000)).toBe(running)
    const paused = stoppedClock(42)
    expect(clockPause(paused, 9_000)).toBe(paused)
  })

  it('never runs past the end of a period when clamped', () => {
    const c = clockStart(stoppedClock(1_799_000), 0)
    expect(clockElapsedClamped(c, 5_000, 1_800_000)).toBe(1_800_000)
    expect(msUntil(c, 500, 1_800_000)).toBe(500)
    expect(msUntil(stoppedClock(), 0, 10)).toBeNull()
  })

  it('can be set (corrected) while running or paused', () => {
    expect(clockElapsed(clockSet(stoppedClock(5), 90_000, 0), 1_000)).toBe(90_000)
    const running = clockSet(clockStart(stoppedClock(), 0), 30_000, 10_000)
    expect(clockElapsed(running, 12_000)).toBe(32_000)
    expect(clockSet(stoppedClock(), -50, 0).baseMs).toBe(0)
  })
})

describe('period plan', () => {
  it('builds cumulative IHF senior periods with two overtimes and a shoot-out', () => {
    const plan = buildPeriodPlan(DEFAULT_RULES)
    expect(plan.map((p) => p.shortLabel)).toEqual(['1H', '2H', 'OT1.1', 'OT1.2', 'OT2.1', 'OT2.2', 'PS'])
    expect(plan[1]).toMatchObject({ startMs: 1_800_000, endMs: 3_600_000 })
    expect(plan[2]).toMatchObject({ startMs: 3_600_000, endMs: 3_900_000, kind: 'overtime', breakBeforeMinutes: 5 })
    expect(plan[3].breakBeforeMinutes).toBe(1)
    expect(plan[6].kind).toBe('shootout')
    expect(regularEndMs(DEFAULT_RULES)).toBe(3_600_000)
  })

  it('supports youth formats and disabling overtime / shoot-out', () => {
    const u16 = findPreset('youth_u16')!
    const plan = buildPeriodPlan({ ...u16, overtime: { ...u16.overtime, enabled: false }, shootout: { ...u16.shootout, enabled: false } })
    expect(plan).toHaveLength(2)
    expect(plan[1].endMs).toBe(50 * 60_000)
  })

  it('formats cumulative match time and countdowns', () => {
    expect(formatMatchTime(0)).toBe('00:00')
    expect(formatMatchTime(3_659_999)).toBe('60:59')
    expect(formatCountdown(120_000)).toBe('2:00')
    expect(formatCountdown(119_001)).toBe('2:00')
    expect(formatCountdown(1)).toBe('0:01')
    expect(formatCountdown(0)).toBe('0:00')
  })

  it('all presets satisfy the rules schema', () => {
    for (const p of RULE_PRESETS) expect(rulesConfigSchema.safeParse(p).success).toBe(true)
  })
})
