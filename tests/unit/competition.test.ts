import { describe, expect, it } from 'vitest'
import { bracketRounds, buildBracket, resolveBracket, seedOrder, type TieMatch, type TieSlot } from '../../src/shared/domain/bracket'
import { planFixtures, roundRobin } from '../../src/shared/domain/fixtures'

const teams = (n: number) => Array.from({ length: n }, (_, i) => `T${i + 1}`)

describe('round-robin fixtures', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 10, 12]) {
    it(`pairs ${n} teams once each, in one match per round, with balanced home matches`, () => {
      const ids = teams(n)
      const rounds = roundRobin(ids)
      expect(rounds).toHaveLength(n % 2 ? n : n - 1)
      const pairs = rounds.flat().map((p) => [p.homeTeamId, p.awayTeamId].sort().join('-'))
      expect(pairs).toHaveLength((n * (n - 1)) / 2)
      expect(new Set(pairs).size).toBe(pairs.length)
      for (const round of rounds) {
        const inRound = round.flatMap((p) => [p.homeTeamId, p.awayTeamId])
        expect(new Set(inRound).size).toBe(inRound.length)
      }
      for (const id of ids) {
        const home = rounds.flat().filter((p) => p.homeTeamId === id).length
        const away = rounds.flat().filter((p) => p.awayTeamId === id).length
        expect(Math.abs(home - away)).toBeLessThanOrEqual(1)
      }
    })
  }

  it('reverses home and away in the second leg', () => {
    const rounds = roundRobin(teams(4), 2)
    expect(rounds).toHaveLength(6)
    expect(rounds[3][0]).toEqual({ homeTeamId: rounds[0][0].awayTeamId, awayTeamId: rounds[0][0].homeTeamId })
    for (const id of teams(4)) expect(rounds.flat().filter((p) => p.homeTeamId === id)).toHaveLength(3)
  })

  it('gives each team one bye when the number is odd', () => {
    const rounds = roundRobin(teams(5))
    for (const id of teams(5)) expect(rounds.filter((r) => !r.some((p) => p.homeTeamId === id || p.awayTeamId === id))).toHaveLength(1)
  })
})

describe('fixture schedule', () => {
  const start = Date.UTC(2027, 0, 9, 14)
  const options = { legs: 1 as const, firstKickoff: start, daysBetweenRounds: 7, minutesBetweenMatches: 90 }
  const HOUR = 3_600_000

  it('spaces rounds by days and matches on a day by minutes', () => {
    const f = planFixtures([{ groupName: null, teamIds: teams(4) }], options)
    expect(f.map((x) => x.round)).toEqual([1, 1, 2, 2, 3, 3])
    expect(f[0].scheduledAt).toBe(start)
    expect(f[1].scheduledAt).toBe(start + 1.5 * HOUR)
    expect(f[2].scheduledAt).toBe(start + 7 * 24 * HOUR)
  })

  it('keeps the same local throw-off time from one round to the next', () => {
    const first = new Date(2027, 2, 20, 18, 30).getTime()
    const later = planFixtures([{ groupName: null, teamIds: teams(4) }], { ...options, firstKickoff: first, minutesBetweenMatches: 0 })
    for (const f of later) expect([new Date(f.scheduledAt).getHours(), new Date(f.scheduledAt).getMinutes()]).toEqual([18, 30])
    expect(new Date(later[4].scheduledAt).getDate()).toBe(3)
  })

  it('runs the groups of a round one after another on the same day', () => {
    const f = planFixtures(
      [
        { groupName: 'A', teamIds: teams(4) },
        { groupName: 'B', teamIds: ['X', 'Y', 'Z'] }
      ],
      options
    )
    const first = f.filter((x) => x.round === 1)
    expect(first.map((x) => x.groupName)).toEqual(['A', 'A', 'B'])
    expect(new Set(first.map((x) => x.scheduledAt)).size).toBe(3)
    expect(Math.max(...f.map((x) => x.round))).toBe(3)
  })
})

describe('bracket structure', () => {
  it('seeds so the top two can only meet in the final', () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3])
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
    expect(bracketRounds(16)).toEqual(['round_of_16', 'quarter_final', 'semi_final', 'final'])
    expect(bracketRounds(5)).toEqual(['quarter_final', 'semi_final', 'final'])
    expect(bracketRounds(2)).toEqual(['final'])
  })

  it('builds every tie, with a third-place match only when there are semi-finals', () => {
    const ties = buildBracket(teams(8), true)
    expect(ties.map((t) => t.stage)).toEqual(['quarter_final', 'quarter_final', 'quarter_final', 'quarter_final', 'semi_final', 'semi_final', 'final', 'third_place'])
    expect(ties[0]).toMatchObject({ homeTeamId: 'T1', awayTeamId: 'T8' })
    expect(ties[3]).toMatchObject({ homeTeamId: 'T3', awayTeamId: 'T6' })
    expect(buildBracket(teams(2), true).map((t) => t.stage)).toEqual(['final'])
  })

  it('has no third-place match with three teams, because one semi-final is a bye', () => {
    expect(buildBracket(teams(3), true).map((t) => t.stage)).toEqual(['semi_final', 'semi_final', 'final'])
    expect(buildBracket(teams(4), true).some((t) => t.stage === 'third_place')).toBe(true)
  })

  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 15, 16]) {
    it(`leaves no team stranded with ${n} teams: every first-round tie has a match or a bye winner`, () => {
      const resolved = resolveBracket(buildBracket(teams(n), true), [])
      const first = resolved.filter((t) => t.stage === resolved[0].stage)
      expect(first.every((t) => t.state === 'bye' || t.state === 'ready')).toBe(true)
      expect(new Set(first.flatMap((t) => [t.homeTeamId, t.awayTeamId]).filter(Boolean)).size).toBe(n)
    })
  }

  it('gives byes to the top seeds and advances them without a match', () => {
    const resolved = resolveBracket(buildBracket(teams(6), false), [])
    const qf = resolved.filter((t) => t.stage === 'quarter_final')
    expect(qf.map((t) => t.state)).toEqual(['bye', 'ready', 'bye', 'ready'])
    expect(qf[0].winnerTeamId).toBe('T1')
    const sf = resolved.filter((t) => t.stage === 'semi_final')
    expect(sf[0]).toMatchObject({ homeTeamId: 'T1', awayTeamId: null, state: 'waiting', awaySource: 'Winner QF 2' })
  })
})

describe('bracket progress', () => {
  const played = (ties: TieSlot[], stage: string, position: number, id: string, home: string, away: string, winnerSide: TieMatch['winnerSide'], status: TieMatch['status'] = 'finished') => {
    const tie = ties.find((t) => t.stage === stage && t.position === position)!
    tie.matchId = id
    return { id, status, homeTeamId: home, awayTeamId: away, winnerSide }
  }
  const of = (r: ReturnType<typeof resolveBracket>, stage: string, position = 1) => r.find((t) => t.stage === stage && t.position === position)!

  it('moves winners to the next round and losers to the third-place match', () => {
    const ties = buildBracket(teams(4), true)
    const matches = [played(ties, 'semi_final', 1, 'a', 'T1', 'T4', 'home'), played(ties, 'semi_final', 2, 'b', 'T2', 'T3', 'away')]
    const r = resolveBracket(ties, matches)
    expect(of(r, 'final')).toMatchObject({ homeTeamId: 'T1', awayTeamId: 'T3', state: 'ready' })
    expect(of(r, 'third_place')).toMatchObject({ homeTeamId: 'T4', awayTeamId: 'T2', state: 'ready', homeSource: 'Loser SF 1' })
  })

  it('waits for both teams, and tracks a fixture through to its result', () => {
    const ties = buildBracket(teams(4), false)
    const one = [played(ties, 'semi_final', 1, 'a', 'T1', 'T4', 'away')]
    expect(of(resolveBracket(ties, one), 'final')).toMatchObject({ homeTeamId: 'T4', awayTeamId: null, state: 'waiting' })
    const inProgress = [played(ties, 'semi_final', 2, 'b', 'T2', 'T3', null, 'live'), ...one]
    expect(of(resolveBracket(ties, inProgress), 'semi_final', 2).state).toBe('live')
    const fixture = [played(ties, 'semi_final', 2, 'b', 'T2', 'T3', null, 'scheduled'), ...one]
    expect(of(resolveBracket(ties, fixture), 'semi_final', 2).state).toBe('scheduled')
  })

  it('reaches every later round when a result is corrected before the next match exists', () => {
    const ties = buildBracket(teams(4), false)
    const first = [played(ties, 'semi_final', 1, 'a', 'T1', 'T4', 'home'), played(ties, 'semi_final', 2, 'b', 'T2', 'T3', 'home')]
    expect(of(resolveBracket(ties, first), 'final')).toMatchObject({ homeTeamId: 'T1', awayTeamId: 'T2' })
    const corrected = [{ ...first[0], winnerSide: 'away' as const }, first[1]]
    expect(of(resolveBracket(ties, corrected), 'final')).toMatchObject({ homeTeamId: 'T4', awayTeamId: 'T2', problem: null })
  })

  it('raises a problem, and changes nothing, when a correction contradicts a fixture already made', () => {
    const ties = buildBracket(teams(4), false)
    const semi = played(ties, 'semi_final', 1, 'a', 'T1', 'T4', 'away')
    const other = played(ties, 'semi_final', 2, 'b', 'T2', 'T3', 'home')
    const final = played(ties, 'final', 1, 'c', 'T1', 'T2', 'home')
    const r = of(resolveBracket(ties, [semi, other, final]), 'final')
    expect(r.problem).toMatch(/Its result stands/)
    expect(r.matchId).toBe('c')
    expect(r.winnerTeamId).toBeNull()
  })

  it('tells the operator to reschedule a contradicted fixture that has not been played', () => {
    const ties = buildBracket(teams(4), false)
    const semi = played(ties, 'semi_final', 1, 'a', 'T1', 'T4', 'away')
    const other = played(ties, 'semi_final', 2, 'b', 'T2', 'T3', 'home')
    const final = played(ties, 'final', 1, 'c', 'T1', 'T2', null, 'scheduled')
    expect(of(resolveBracket(ties, [semi, other, final]), 'final').problem).toMatch(/Delete this fixture and schedule the tie again/)
  })

  it('does not advance anyone from a level knockout match', () => {
    const ties = buildBracket(teams(2), false)
    const r = of(resolveBracket(ties, [played(ties, 'final', 1, 'a', 'T1', 'T2', 'draw')]), 'final')
    expect(r.problem).toMatch(/level/)
    expect(r.winnerTeamId).toBeNull()
  })

  it('treats a deleted fixture as ready to schedule again', () => {
    const ties = buildBracket(teams(2), false)
    ties[0].matchId = 'gone'
    expect(of(resolveBracket(ties, []), 'final')).toMatchObject({ state: 'ready', problem: null })
  })
})
