import { describe, expect, it } from 'vitest'
import { allowedOnCourt, deriveMatchState } from '@shared/domain/ledger'
import { ev, fullRoster, goal, officialsFixture } from './fixtures'

const SUSP = 120_000
const roster = fullRoster()

describe('ledger-derived match state', () => {
  it('scores only active goals and keeps shoot-out goals separate', () => {
    const events = [
      goal('home', 9, 10_000),
      goal('home', 9, 20_000, { status: 'voided' }),
      goal('away', 4, 30_000),
      ev('shot', { side: 'away', rosterId: 'away-5', outcome: 'saved', matchMs: 40_000 }),
      goal('home', 2, 3_600_000, { situation: 'shootout', periodSeq: 7 })
    ]
    const s = deriveMatchState(roster, officialsFixture, events, 50_000, SUSP)
    expect(s.home.score).toBe(1)
    expect(s.away.score).toBe(1)
    expect(s.home.shootoutScore).toBe(1)
  })

  it('records the score at each period end', () => {
    const events = [goal('home', 9, 10_000), ev('period_end', { side: null, periodSeq: 1, matchMs: 1_800_000 }), goal('away', 3, 1_900_000)]
    const s = deriveMatchState(roster, officialsFixture, events, 2_000_000, SUSP)
    expect(s.scoreByPeriod.get(1)).toEqual({ home: 1, away: 0 })
  })

  it('tracks suspension timers in playing time and their expiry', () => {
    const events = [ev('suspension', { side: 'home', rosterId: 'home-5', matchMs: 600_000 })]
    const during = deriveMatchState(roster, officialsFixture, events, 650_000, SUSP)
    expect(during.courtStatus.get('home-5')).toBe('suspended')
    expect(during.home.reductions).toHaveLength(1)
    expect(during.home.reductions[0]).toMatchObject({ startMs: 600_000, endMs: 720_000, sequence: 1 })
    expect(allowedOnCourt(during, 'home', 7)).toBe(6)

    const after = deriveMatchState(roster, officialsFixture, events, 720_000, SUSP)
    expect(after.courtStatus.get('home-5')).toBe('bench')
    expect(after.home.reductions).toHaveLength(0)
  })

  it('carries a suspension over the half-time break (cumulative match time)', () => {
    const events = [ev('suspension', { side: 'away', rosterId: 'away-3', matchMs: 1_740_000 })]
    expect(deriveMatchState(roster, officialsFixture, events, 1_800_000, SUSP).away.reductions).toHaveLength(1)
    expect(deriveMatchState(roster, officialsFixture, events, 1_859_999, SUSP).away.reductions).toHaveLength(1)
    expect(deriveMatchState(roster, officialsFixture, events, 1_860_000, SUSP).away.reductions).toHaveLength(0)
  })

  it('supports multiple simultaneous suspensions with independent timers', () => {
    const events = [
      ev('suspension', { side: 'home', rosterId: 'home-2', matchMs: 100_000 }),
      ev('suspension', { side: 'home', rosterId: 'home-3', matchMs: 160_000 }),
      ev('suspension', { side: 'away', rosterId: 'away-4', matchMs: 170_000 })
    ]
    const s = deriveMatchState(roster, officialsFixture, events, 200_000, SUSP)
    expect(s.home.reductions.map((r) => r.endMs)).toEqual([220_000, 280_000])
    expect(allowedOnCourt(s, 'home', 7)).toBe(5)
    expect(s.away.reductions).toHaveLength(1)
  })

  it('marks disqualified players permanently and applies a team reduction only when flagged', () => {
    const events = [
      ev('disqualification', { side: 'home', rosterId: 'home-6', matchMs: 500_000, teamReduction: true }),
      ev('disqualification', { side: 'away', rosterId: 'away-6', matchMs: 500_000, teamReduction: false })
    ]
    const s = deriveMatchState(roster, officialsFixture, events, 2_000_000, SUSP)
    expect(s.courtStatus.get('home-6')).toBe('disqualified')
    expect(s.home.reductions).toHaveLength(0)
    expect(s.timers.filter((t) => t.side === 'home')).toHaveLength(1)
    expect(s.timers.filter((t) => t.side === 'away')).toHaveLength(0)
  })

  it('maintains the active seven through substitutions', () => {
    const events = [ev('substitution', { side: 'home', rosterId: 'home-7', inRosterId: 'home-10', matchMs: 300_000 })]
    const s = deriveMatchState(roster, officialsFixture, events, 300_000, SUSP)
    expect(s.courtStatus.get('home-7')).toBe('bench')
    expect(s.courtStatus.get('home-10')).toBe('court')
    expect(s.home.onCourt.size).toBe(7)
  })
})
