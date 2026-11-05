import { describe, expect, it } from 'vitest'
import type { PeriodDef } from '../../src/shared/domain/periods'
import { appearances, biggestLead, goalsByPeriod, percent, scoreFlow, shootingBreakdown } from '../../src/shared/domain/statistics'
import { liveTallies } from '../../src/shared/domain/tally'
import type { LedgerEvent, RosterEntry } from '../../src/shared/domain/types'

let seq = 0
const ev = (type: LedgerEvent['type'], over: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: `e${++seq}`,
  seq,
  type,
  side: null,
  rosterId: null,
  teamOfficialId: null,
  periodSeq: 1,
  matchMs: seq * 1000,
  outcome: null,
  situation: null,
  zone: null,
  assistRosterId: null,
  goalkeeperRosterId: null,
  inRosterId: null,
  blueCard: false,
  teamReduction: false,
  causedByEventId: null,
  reason: null,
  status: 'active',
  ...over
})
const shot = (side: 'home' | 'away', outcome: LedgerEvent['outcome'], over: Partial<LedgerEvent> = {}) =>
  ev('shot', { side, outcome, rosterId: `${side}-9`, situation: 'positional', ...over })

describe('goalkeeper statistics', () => {
  it('counts only shots on target against the goalkeeper', () => {
    const gk = { goalkeeperRosterId: 'away-1' }
    const t = liveTallies([shot('home', 'goal', gk), shot('home', 'saved', gk), shot('home', 'missed', gk), shot('home', 'post', gk), shot('home', 'blocked', gk)])
    expect(t.players.get('away-1')).toMatchObject({ saves: 1, shotsFaced: 2, goalsConceded: 1 })
    expect(t.teams.away).toMatchObject({ saves: 1, goalsConceded: 1 })
    expect(t.teams.home.shots).toBe(5)
  })

  it('counts seven-metre throws separately and leaves out the shoot-out', () => {
    const gk = { goalkeeperRosterId: 'away-1' }
    const t = liveTallies([
      shot('home', 'goal', { ...gk, situation: 'seven_metre' }),
      shot('home', 'saved', { ...gk, situation: 'seven_metre' }),
      shot('home', 'saved', { ...gk, situation: 'shootout' })
    ])
    expect(t.players.get('away-1')).toMatchObject({ saves: 1, shotsFaced: 2, sevenMetreSaves: 1, sevenMetreFaced: 2 })
    expect(t.teams.away).toMatchObject({ sevenMetreSaves: 1, sevenMetreFaced: 2 })
  })
})

describe('player and team sanctions', () => {
  it('credits plays and sanctions to the player and team, and officials to the team only', () => {
    const t = liveTallies([
      ev('steal', { side: 'home', rosterId: 'home-3' }),
      ev('technical_fault', { side: 'home', rosterId: 'home-3' }),
      ev('warning', { side: 'home', rosterId: 'home-3' }),
      ev('suspension', { side: 'home', teamOfficialId: 'official-a' }),
      ev('disqualification', { side: 'away', rosterId: 'away-5' }),
      ev('timeout', { side: 'away' }),
      ev('warning', { side: 'home', rosterId: 'home-3', status: 'voided' })
    ])
    expect(t.players.get('home-3')).toMatchObject({ steals: 1, technicalFaults: 1, warnings: 1, suspensions: 0 })
    expect(t.teams.home).toMatchObject({ warnings: 1, suspensions: 1, steals: 1 })
    expect(t.teams.away).toMatchObject({ disqualifications: 1, timeouts: 1 })
  })
})

describe('match analysis', () => {
  const plan = [
    { seq: 1, kind: 'regular', label: '1st half' },
    { seq: 2, kind: 'regular', label: '2nd half' },
    { seq: 3, kind: 'overtime', label: 'OT1 1st half' },
    { seq: 7, kind: 'shootout', label: 'Shoot-out' }
  ] as PeriodDef[]

  it('follows the score goal by goal and finds the biggest lead', () => {
    const flow = scoreFlow([shot('home', 'goal'), shot('home', 'goal'), shot('home', 'goal', { status: 'voided' }), shot('away', 'missed'), shot('away', 'goal'), shot('home', 'goal', { situation: 'shootout' })])
    expect(flow.map((p) => `${p.home}:${p.away}`)).toEqual(['1:0', '2:0', '2:1'])
    expect(biggestLead(flow)).toEqual({ side: 'home', goals: 2 })
    expect(biggestLead([])).toBeNull()
  })

  it('splits goals by the periods that were played', () => {
    const events = [ev('period_start'), shot('home', 'goal'), ev('period_start', { periodSeq: 2 }), shot('away', 'goal', { periodSeq: 2 }), shot('away', 'goal', { periodSeq: 2 })]
    expect(goalsByPeriod(events, plan)).toEqual([
      { label: '1st half', home: 1, away: 0 },
      { label: '2nd half', home: 0, away: 2 }
    ])
  })

  it('breaks shooting down by situation and zone', () => {
    const b = shootingBreakdown(
      [shot('home', 'goal', { situation: 'fast_break', zone: 'wing' }), shot('home', 'missed', { situation: 'fast_break' }), shot('home', 'goal', { zone: 'wing' }), shot('away', 'goal'), shot('home', 'goal', { situation: 'shootout' })],
      'home'
    )
    expect(b.situations).toEqual([
      { key: 'positional', shots: 1, goals: 1 },
      { key: 'fast_break', shots: 2, goals: 1 }
    ])
    expect(b.zones).toEqual([{ key: 'wing', shots: 2, goals: 2 }])
  })

  it('treats starters, substitutes brought on and players in events as having played', () => {
    const roster = [{ id: 'a', isStarting: true }, { id: 'b', isStarting: false }, { id: 'c', isStarting: false }, { id: 'd', isStarting: false }] as RosterEntry[]
    const played = appearances([ev('substitution', { rosterId: 'a', inRosterId: 'b' }), ev('warning', { rosterId: 'c' }), ev('warning', { rosterId: 'd', status: 'voided' })], roster)
    expect([...played].sort()).toEqual(['a', 'b', 'c'])
  })

  it('rounds percentages to one decimal and has no percentage of nothing', () => {
    expect(percent(1, 3)).toBe(33.3)
    expect(percent(0, 0)).toBeNull()
  })
})
