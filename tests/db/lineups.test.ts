import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { matchEvents } from '../../src/main/db/schema'
import { createMatch, getMatch } from '../../src/main/services/matches'
import { confirmLineup, getMatchSetup, reopenLineup, saveLineup } from '../../src/main/services/lineups'
import { createPlayer, updatePlayer } from '../../src/main/services/players'
import { createTeam } from '../../src/main/services/teams'
import { testDb, type TestDb } from './helpers'

let t: TestDb
beforeEach(() => (t = testDb(true)))
afterEach(() => t.cleanup())

function teamWithSquad(code: string, n = 14) {
  const team = createTeam(t.ctx(), { name: `Team ${code}`, shortName: code, code, primaryColor: '#123456', secondaryColor: '#ffffff' })
  const players = Array.from({ length: n }, (_, i) =>
    createPlayer(t.ctx(), {
      firstName: `P${i + 1}`,
      lastName: code,
      isGoalkeeper: i === 0 || i === 11,
      position: i === 0 ? 'goalkeeper' : 'pivot',
      registrationStatus: 'registered',
      teamId: team.id,
      jerseyNumber: i + 1
    })
  )
  return { team, players }
}

function setup() {
  const home = teamWithSquad('HOM')
  const away = teamWithSquad('AWY')
  const match = createMatch(t.ctx(), { homeTeamId: home.team.id, awayTeamId: away.team.id, scheduledAt: Date.now(), stage: 'friendly', officials: [] })
  return { home, away, match }
}

const sheet = (ps: { id: string; jerseyNumber: number | null }[], starters = 7) =>
  ps.map((p, i) => ({ playerId: p.id, jerseyNumber: p.jerseyNumber!, isStarting: i < starters, isStartingGk: i === 0, isCaptain: i === 3 }))

describe('starting lineups', () => {
  it('lists the eligible squad and starts unprepared', () => {
    const { match } = setup()
    const s = getMatchSetup(t.ctx(), match.id)
    expect(s.home.squad).toHaveLength(14)
    expect(s.home.entries).toEqual([])
    expect(s.home.validation.errors).toEqual(['The match sheet has not been prepared.'])
    expect(s.locked).toBe(false)
  })

  it('saves a valid starting seven with goalkeeper, captain and substitutes', () => {
    const { home, match } = setup()
    const s = saveLineup(t.ctx(), { matchId: match.id, side: 'home', entries: sheet(home.players), officials: [{ slot: 'A', name: 'Coach H', role: 'Head coach' }] })
    expect(s.home.entries).toHaveLength(14)
    expect(s.home.entries.filter((e) => e.isStarting)).toHaveLength(7)
    expect(s.home.entries.find((e) => e.isStartingGk)?.jerseyNumber).toBe(1)
    expect(s.home.officials).toMatchObject([{ slot: 'A', name: 'Coach H' }])
    expect(s.home.validation).toEqual({ errors: [], warnings: [] })
  })

  it('rejects more than seven starters, two starting goalkeepers and duplicate jerseys', () => {
    const { home, match } = setup()
    const eight = sheet(home.players, 8)
    expect(() => saveLineup(t.ctx(), { matchId: match.id, side: 'home', entries: eight, officials: [] })).toThrow(/not valid/)
    const twoGk = sheet(home.players).map((e, i) => ({ ...e, isStartingGk: i < 2 }))
    expect(() => saveLineup(t.ctx(), { matchId: match.id, side: 'home', entries: twoGk, officials: [] })).toThrow(/not valid/)
    const dup = sheet(home.players).map((e, i) => (i === 1 ? { ...e, jerseyNumber: 1 } : e))
    expect(() => saveLineup(t.ctx(), { matchId: match.id, side: 'home', entries: dup, officials: [] })).toThrow(/not valid/)
  })

  it('allows an incomplete draft but refuses to confirm it', () => {
    const { home, match } = setup()
    const draft = saveLineup(t.ctx(), { matchId: match.id, side: 'home', entries: sheet(home.players.slice(0, 10), 3), officials: [] })
    expect(draft.home.validation.errors.join(' ')).toMatch(/At least 5/)
    expect(() => confirmLineup(t.ctx(), { matchId: match.id, side: 'home' })).toThrow(/cannot be confirmed/)
  })

  it('rejects players who are not eligible', () => {
    const { home, match } = setup()
    updatePlayer(t.ctx(), { id: home.players[5].id, firstName: 'P6', lastName: 'HOM', isGoalkeeper: false, registrationStatus: 'suspended' })
    expect(() => saveLineup(t.ctx(), { matchId: match.id, side: 'home', entries: sheet(home.players), officials: [] })).toThrow(/not eligible/)
  })

  it('confirming both teams makes the match ready; editing clears the confirmation', () => {
    const { home, away, match } = setup()
    saveLineup(t.ctx(), { matchId: match.id, side: 'home', entries: sheet(home.players), officials: [] })
    saveLineup(t.ctx(), { matchId: match.id, side: 'away', entries: sheet(away.players), officials: [] })
    confirmLineup(t.ctx(), { matchId: match.id, side: 'home' })
    expect(getMatch(t.ctx(), match.id).status).toBe('scheduled')
    const both = confirmLineup(t.ctx(), { matchId: match.id, side: 'away' })
    expect(both.match.status).toBe('ready')
    expect(both.home.confirmedBy).toBe('Test Admin')
    const reopened = reopenLineup(t.ctx(), { matchId: match.id, side: 'away' })
    expect(reopened.match.status).toBe('scheduled')
    confirmLineup(t.ctx(), { matchId: match.id, side: 'away' })
    const edited = saveLineup(t.ctx(), { matchId: match.id, side: 'home', entries: sheet(home.players.slice(0, 12)), officials: [] })
    expect(edited.home.confirmedAt).toBeNull()
    expect(edited.match.status).toBe('scheduled')
  })

  it('the lineup is a snapshot: later roster edits do not change it', () => {
    const { home, match } = setup()
    saveLineup(t.ctx(), { matchId: match.id, side: 'home', entries: sheet(home.players), officials: [] })
    updatePlayer(t.ctx(), { id: home.players[2].id, firstName: 'Renamed', lastName: 'Player', isGoalkeeper: false, registrationStatus: 'registered' })
    const s = getMatchSetup(t.ctx(), match.id)
    expect(s.home.entries.find((e) => e.playerId === home.players[2].id)?.name).toBe('P3 HOM')
  })

  it('locks the match sheet once the match has started', () => {
    const { home, match } = setup()
    const saved = saveLineup(t.ctx(), { matchId: match.id, side: 'home', entries: sheet(home.players), officials: [] })
    t.handle.db
      .insert(matchEvents)
      .values({ id: crypto.randomUUID(), matchId: match.id, seq: 1, type: 'period_start', periodSeq: 1, matchMs: 0, wallTime: Date.now(), rosterId: saved.home.entries[0].rosterId })
      .run()
    expect(() => saveLineup(t.ctx(), { matchId: match.id, side: 'home', entries: sheet(home.players), officials: [] })).toThrow(/has started/)
  })
})
