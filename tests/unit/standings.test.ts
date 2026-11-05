import { describe, expect, it } from 'vitest'
import { computeStandings, type ResultInput } from '@shared/domain/standings'

const cfg = { pointsWin: 2, pointsDraw: 1, pointsLoss: 0, tiebreakers: ['points', 'head_to_head_points', 'goal_difference', 'goals_for'] }
const r = (h: string, a: string, hs: number, as: number): ResultInput => ({
  homeTeamId: h,
  awayTeamId: a,
  homeScore: hs,
  awayScore: as,
  winnerSide: hs > as ? 'home' : hs < as ? 'away' : 'draw'
})
const teams = ['A', 'B', 'C', 'D'].map((id) => ({ teamId: id, groupName: null, name: `Team ${id}` }))

describe('standings', () => {
  it('applies the configured points system', () => {
    const rows = computeStandings(teams, [r('A', 'B', 30, 25), r('C', 'D', 28, 28)], cfg)
    const by = Object.fromEntries(rows.map((x) => [x.teamId, x]))
    expect(by.A).toMatchObject({ points: 2, won: 1, goalsFor: 30, goalsAgainst: 25, goalDifference: 5, rank: 1 })
    expect(by.C.points).toBe(1)
    expect(by.D.points).toBe(1)
    expect(by.B).toMatchObject({ points: 0, lost: 1, rank: 4 })
  })

  it('breaks ties head-to-head before goal difference', () => {
    // A and B both finish on 4 points. A has the far better goal difference, but B beat A.
    const results = [r('B', 'A', 26, 25), r('A', 'C', 40, 20), r('A', 'D', 35, 20), r('C', 'B', 30, 20), r('B', 'D', 22, 21), r('C', 'D', 30, 30)]
    const rows = computeStandings(teams, results, cfg)
    const by = Object.fromEntries(rows.map((x) => [x.teamId, x]))
    expect(by.A.points).toBe(4)
    expect(by.B.points).toBe(4)
    expect(by.A.goalDifference).toBeGreaterThan(by.B.goalDifference)
    expect(by.B.rank).toBe(1)
    expect(by.A.rank).toBe(2)
    expect(by.C).toMatchObject({ points: 3, rank: 3 })
  })

  it('uses goal difference when head-to-head is level, then goals scored, then name', () => {
    const rows = computeStandings(teams.slice(0, 2), [r('A', 'B', 20, 20)], cfg)
    expect(rows.map((x) => x.teamId)).toEqual(['A', 'B'])
    const gd = computeStandings(teams, [r('A', 'C', 30, 20), r('B', 'D', 25, 24)], cfg)
    expect(gd.slice(0, 2).map((x) => x.teamId)).toEqual(['A', 'B'])
  })

  it('awards shoot-out winners the win points while goals exclude the shoot-out', () => {
    const rows = computeStandings(teams.slice(0, 2), [{ homeTeamId: 'A', awayTeamId: 'B', homeScore: 30, awayScore: 30, winnerSide: 'away' }], cfg)
    const b = rows.find((x) => x.teamId === 'B')!
    expect(b).toMatchObject({ points: 2, won: 1, goalsFor: 30, goalDifference: 0, rank: 1 })
  })

  it('ranks each group separately', () => {
    const grouped = [
      { teamId: 'A', groupName: 'A' },
      { teamId: 'B', groupName: 'A' },
      { teamId: 'C', groupName: 'B' },
      { teamId: 'D', groupName: 'B' }
    ]
    const rows = computeStandings(grouped, [r('A', 'B', 10, 20), r('C', 'D', 20, 10), r('A', 'C', 99, 0)], cfg)
    expect(rows.filter((x) => x.groupName === 'A').map((x) => x.teamId)).toEqual(['B', 'A'])
    expect(rows.filter((x) => x.groupName === 'B').map((x) => [x.teamId, x.rank])).toEqual([['C', 1], ['D', 2]])
    expect(rows.find((x) => x.teamId === 'A')!.played).toBe(1)
  })
})
