import { describe, expect, it } from 'vitest'
import { validateLineup, type LineupEntryInput } from '@shared/domain/lineup'
import { buildPeriodPlan } from '@shared/domain/periods'
import { DEFAULT_RULES } from '@shared/domain/rules'
import { checkTimeout } from '@shared/domain/timeouts'

const plan = buildPeriodPlan(DEFAULT_RULES)
const [h1, h2, ot1] = plan
const MIN = 60_000

describe('team time-outs', () => {
  it('allows three per match, at most two per half', () => {
    expect(checkTimeout([], h1, 5 * MIN, DEFAULT_RULES).allowed).toBe(true)
    const two = [{ periodSeq: 1, matchMs: 5 * MIN }, { periodSeq: 1, matchMs: 10 * MIN }]
    const third = checkTimeout(two, h1, 20 * MIN, DEFAULT_RULES)
    expect(third.allowed).toBe(false)
    expect(third.reason).toMatch(/each half/)
    const r = checkTimeout(two, h2, 40 * MIN, DEFAULT_RULES)
    expect(r.allowed).toBe(true)
    expect(r.remainingInMatch).toBe(1)
  })

  it('refuses a fourth time-out', () => {
    const three = [{ periodSeq: 1, matchMs: MIN }, { periodSeq: 2, matchMs: 35 * MIN }, { periodSeq: 2, matchMs: 40 * MIN }]
    expect(checkTimeout(three, h2, 50 * MIN, DEFAULT_RULES).reason).toMatch(/All 3/)
  })

  it('only one in the last five minutes of regular time', () => {
    const r = checkTimeout([{ periodSeq: 2, matchMs: 56 * MIN }], h2, 58 * MIN, DEFAULT_RULES)
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/last 5 minutes/)
    expect(checkTimeout([{ periodSeq: 2, matchMs: 50 * MIN }], h2, 58 * MIN, DEFAULT_RULES).allowed).toBe(true)
  })

  it('no time-outs in overtime or the shoot-out', () => {
    expect(checkTimeout([], ot1, 61 * MIN, DEFAULT_RULES).allowed).toBe(false)
    expect(checkTimeout([], plan[plan.length - 1], 80 * MIN, DEFAULT_RULES).allowed).toBe(false)
  })
})

const entry = (jersey: number, extra: Partial<LineupEntryInput> = {}): LineupEntryInput => ({
  playerId: `p${jersey}`,
  jersey,
  isGoalkeeper: jersey === 1,
  isStarting: jersey <= 7,
  isStartingGk: jersey === 1,
  isCaptain: jersey === 7,
  ...extra
})
const squad = (n = 14) => Array.from({ length: n }, (_, i) => entry(i + 1))

describe('lineup validation', () => {
  it('accepts a standard seven with one goalkeeper and a captain', () => {
    const v = validateLineup(squad(), DEFAULT_RULES)
    expect(v.errors).toEqual([])
    expect(v.warnings).toEqual([])
    expect(v.starters).toBe(7)
  })

  it('rejects more than seven starters and more than one starting goalkeeper', () => {
    const v = validateLineup([...squad(7), entry(8, { isStarting: true, isStartingGk: true })], DEFAULT_RULES)
    expect(v.errors.join(' ')).toMatch(/maximum is 7/)
    expect(v.errors.join(' ')).toMatch(/one starting goalkeeper/)
  })

  it('rejects duplicate jerseys, oversize rosters and too few starters', () => {
    expect(validateLineup([entry(1), entry(1, { playerId: 'x' })], DEFAULT_RULES).errors.join(' ')).toMatch(/#1 is used by 2/)
    expect(validateLineup(squad(17), DEFAULT_RULES).errors.join(' ')).toMatch(/Too many/)
    const four = squad(10).map((e) => ({ ...e, isStarting: e.jersey <= 4 }))
    expect(validateLineup(four, DEFAULT_RULES).errors.join(' ')).toMatch(/At least 5/)
  })

  it('warns for six starters or no goalkeeper, and rejects a goalkeeper who does not start', () => {
    const six = squad().map((e) => ({ ...e, isStarting: e.jersey <= 6 }))
    expect(validateLineup(six, DEFAULT_RULES).warnings.join(' ')).toMatch(/Only 6/)
    const noGk = squad().map((e) => ({ ...e, isStartingGk: false }))
    expect(validateLineup(noGk, DEFAULT_RULES).warnings.join(' ')).toMatch(/No starting goalkeeper/)
    const benchGk = squad().map((e) => ({ ...e, isStartingGk: e.jersey === 12 }))
    expect(validateLineup(benchGk, DEFAULT_RULES).errors.join(' ')).toMatch(/must be in the starting lineup/)
  })
})
