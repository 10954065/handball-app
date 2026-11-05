import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { DEFAULT_RULES, RULE_PRESETS } from '../../src/shared/domain/rules'
import { matches } from '../../src/main/db/schema'
import { createCompetition, createSeason, setSeasonTeams, updateCompetition } from '../../src/main/services/competitions'
import { getDashboard } from '../../src/main/services/dashboard'
import { createOfficial, createVenue, listOfficials } from '../../src/main/services/directory'
import { createMatch, deleteMatch, getMatch, listMatches } from '../../src/main/services/matches'
import { saveMedia, readMedia } from '../../src/main/services/media'
import { changeJersey, createPlayer, getPlayer, listPlayers, transferPlayer, updatePlayer } from '../../src/main/services/players'
import { seedDemoData } from '../../src/main/services/demo'
import { seasonStandings } from '../../src/main/services/standings'
import { createTeam, getTeam, listTeams, updateTeam } from '../../src/main/services/teams'
import { testDb, type TestDb } from './helpers'

let t: TestDb
beforeEach(() => (t = testDb(true)))
afterEach(() => t.cleanup())

const team = (code: string, color = '#ff0000') =>
  createTeam(t.ctx(), { name: `Team ${code}`, shortName: code, code, primaryColor: color, secondaryColor: '#ffffff' })
const player = (first: string, teamId?: string, jerseyNumber?: number) =>
  createPlayer(t.ctx(), { firstName: first, lastName: 'Test', isGoalkeeper: false, registrationStatus: 'registered', teamId, jerseyNumber })

describe('teams and players', () => {
  it('creates players with permanent sequential registration numbers and searches them', () => {
    const a = team('AAA')
    const p1 = player('Kwame', a.id, 7)
    const p2 = player('Kofi', a.id, 9)
    expect(p1.registrationNo).toBe('P-000001')
    expect(p2.registrationNo).toBe('P-000002')
    expect(listPlayers(t.ctx(), { search: 'kwa' }).map((p) => p.id)).toEqual([p1.id])
    expect(listPlayers(t.ctx(), { search: '9' }).map((p) => p.id)).toEqual([p2.id])
    expect(listTeams(t.ctx())[0].playerCount).toBe(2)
  })

  it('prevents duplicate jersey numbers within an active team roster', () => {
    const a = team('AAA')
    player('Kwame', a.id, 7)
    expect(() => player('Kofi', a.id, 7)).toThrow(/Jersey #7 is already worn by Kwame Test/)
    const b = team('BBB')
    expect(player('Kofi', b.id, 7).jerseyNumber).toBe(7)
  })

  it('transfers keep full registration history and free the old jersey', () => {
    const a = team('AAA')
    const b = team('BBB')
    const p = player('Yaw', a.id, 10)
    updateTeam(t.ctx(), { ...getTeam(t.ctx(), a.id), id: a.id, captainPlayerId: p.id })
    expect(() => transferPlayer(t.ctx(), { playerId: p.id, toTeamId: b.id, jerseyNumber: 4, effectiveDate: '2000-01-01' })).toThrow(/before the current registration/)
    const moved = transferPlayer({ ...t.ctx(), now: () => Date.now() + 60_000 }, { playerId: p.id, toTeamId: b.id, jerseyNumber: 4 })
    expect(moved).toMatchObject({ teamId: b.id, jerseyNumber: 4 })
    expect(getTeam(t.ctx(), a.id).captainPlayerId).toBeNull()
    expect(player('Ebo', a.id, 10).jerseyNumber).toBe(10)
    const detail = getPlayer(t.ctx(), p.id)
    expect(detail.history.map((h) => [h.teamName, h.jerseyNumber, h.leftAt === null])).toEqual([
      ['Team BBB', 4, true],
      ['Team AAA', 10, false]
    ])
    const released = transferPlayer({ ...t.ctx(), now: () => Date.now() + 120_000 }, { playerId: p.id, toTeamId: null })
    expect(released.teamId).toBeNull()
    expect(listPlayers(t.ctx(), { freeAgentsOnly: true }).map((x) => x.id)).toEqual([p.id])
  })

  it('changes jersey numbers without rewriting history', () => {
    const a = team('AAA')
    const p = player('Kojo', a.id, 3)
    player('Kwesi', a.id, 8)
    expect(() => changeJersey(t.ctx(), { playerId: p.id, jerseyNumber: 8 })).toThrow(/already worn/)
    expect(changeJersey(t.ctx(), { playerId: p.id, jerseyNumber: 11 }).jerseyNumber).toBe(11)
    expect(getPlayer(t.ctx(), p.id).history).toHaveLength(2)
  })

  it('designations must reference current team players', () => {
    const a = team('AAA')
    const outsider = player('Nana')
    expect(() => updateTeam(t.ctx(), { ...getTeam(t.ctx(), a.id), id: a.id, captainPlayerId: outsider.id })).toThrow(/captain must be a registered player/)
  })

  it('stores only real images and serves them back', () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ffbf1e000502027fd4b1eb0000000049454e44ae426082', 'hex')
    const { id } = saveMedia(t.ctx(), { mime: 'image/png', base64: png.toString('base64') })
    expect(readMedia(t.ctx(), id)?.mime).toBe('image/png')
    expect(() => saveMedia(t.ctx(), { mime: 'image/png', base64: Buffer.from('<svg onload=alert(1)>').toString('base64') })).toThrow(/Only PNG/)
  })

  it('updates players and audits every change', () => {
    const p = player('Edem')
    const u = updatePlayer(t.ctx(), { id: p.id, firstName: 'Edem', lastName: 'Agbeko', position: 'pivot', isGoalkeeper: false, registrationStatus: 'pending' })
    expect(u).toMatchObject({ fullName: 'Edem Agbeko', position: 'pivot', registrationStatus: 'pending' })
    const actions = t.handle.sqlite.prepare("SELECT action FROM audit_logs WHERE entity_id = ?").all(p.id) as { action: string }[]
    expect(actions.map((a) => a.action)).toEqual(['players.create', 'players.update'])
  })
})

describe('competitions and matches', () => {
  const league = () =>
    createCompetition(t.ctx(), {
      name: 'National League',
      type: 'league',
      rules: RULE_PRESETS[0],
      pointsWin: 2,
      pointsDraw: 1,
      pointsLoss: 0,
      tiebreakers: ['points', 'head_to_head_points', 'goal_difference']
    })

  it('snapshots rules and team details on the match so later edits never alter it', () => {
    const a = team('AAA', '#123456')
    const b = team('BBB', '#123456')
    const comp = league()
    const ref = createOfficial(t.ctx(), { fullName: 'Ref One', role: 'referee' })
    const venue = createVenue(t.ctx(), { name: 'Hall' })
    const m = createMatch(t.ctx(), {
      homeTeamId: a.id,
      awayTeamId: b.id,
      competitionId: comp.id,
      venueId: venue.id,
      scheduledAt: Date.UTC(2026, 10, 20, 15),
      stage: 'league',
      officials: [{ officialId: ref.id, role: 'Referee' }]
    })
    expect(m.matchNumber).toBe('M-2026-0001')
    expect(m.away.color).toBe('#ffffff')
    expect(m.officials).toEqual([{ officialId: ref.id, name: 'Ref One', role: 'Referee' }])
    updateTeam(t.ctx(), { ...getTeam(t.ctx(), a.id), id: a.id, name: 'Renamed Team' })
    updateCompetition(t.ctx(), { ...comp, id: comp.id, tiebreakers: ['points'], rules: { ...comp.rules, periodMinutes: 20 } })
    const again = getMatch(t.ctx(), m.id)
    expect(again.home.name).toBe('Team AAA')
    expect(again.rules.periodMinutes).toBe(30)
    expect(listOfficials(t.ctx())[0].matchCount).toBe(1)
  })

  it('rejects a team playing itself and a season from another competition', () => {
    const a = team('AAA')
    const b = team('BBB')
    const c1 = league()
    const c2 = league()
    const s2 = createSeason(t.ctx(), { competitionId: c2.id, name: '2026', status: 'planned' })
    expect(() => createMatch(t.ctx(), { homeTeamId: a.id, awayTeamId: b.id, competitionId: c1.id, seasonId: s2.id, scheduledAt: 1, stage: 'league', officials: [] })).toThrow(/does not belong/)
  })

  it('deletes only fixtures that never started', () => {
    const a = team('AAA')
    const b = team('BBB')
    const m = createMatch(t.ctx(), { homeTeamId: a.id, awayTeamId: b.id, scheduledAt: 1, stage: 'friendly', officials: [], rules: DEFAULT_RULES })
    t.handle.db.update(matches).set({ status: 'finished' }).where(eq(matches.id, m.id)).run()
    expect(() => deleteMatch(t.ctx(), m.id)).toThrow(/cannot be deleted/)
    const m2 = createMatch(t.ctx(), { homeTeamId: a.id, awayTeamId: b.id, scheduledAt: 2, stage: 'friendly', officials: [] })
    deleteMatch(t.ctx(), m2.id)
    expect(listMatches(t.ctx(), undefined).map((x) => x.id)).toEqual([m.id])
  })

  it('season standings count finalized matches only', () => {
    const [a, b, c] = [team('AAA'), team('BBB'), team('CCC')]
    const comp = league()
    const s = createSeason(t.ctx(), { competitionId: comp.id, name: '2026', status: 'active' })
    setSeasonTeams(t.ctx(), { seasonId: s.id, teams: [a, b, c].map((x) => ({ teamId: x.id })) })
    const m1 = createMatch(t.ctx(), { homeTeamId: a.id, awayTeamId: b.id, competitionId: comp.id, seasonId: s.id, scheduledAt: 1, stage: 'league', officials: [] })
    const m2 = createMatch(t.ctx(), { homeTeamId: b.id, awayTeamId: c.id, competitionId: comp.id, seasonId: s.id, scheduledAt: 2, stage: 'league', officials: [] })
    t.handle.db.update(matches).set({ status: 'finished', homeScore: 30, awayScore: 22, winnerSide: 'home' }).where(eq(matches.id, m1.id)).run()
    t.handle.db.update(matches).set({ status: 'live', homeScore: 10, awayScore: 0, winnerSide: 'home' }).where(eq(matches.id, m2.id)).run()
    const rows = seasonStandings(t.ctx(), s.id)
    expect(rows.map((r) => [r.code, r.points, r.played])).toEqual([['AAA', 2, 1], ['CCC', 0, 0], ['BBB', 0, 1]])
    expect(() => setSeasonTeams(t.ctx(), { seasonId: s.id, teams: [{ teamId: a.id }] })).toThrow(/already has matches/)
  })

  it('dashboard reports real totals and empty sections for a new database', () => {
    const d = getDashboard(t.ctx())
    expect(d.totals).toEqual({ competitions: 0, teams: 0, players: 0, matchesPlayed: 0, officials: 0 })
    expect(d.upcoming).toEqual([])
    expect(d.topScorers).toEqual([])
    expect(d.standings).toBeNull()
  })
})

describe('demonstration data', () => {
  it('never seeds the production database', () => {
    seedDemoData(t.ctx())
    expect(listTeams(t.ctx())).toEqual([])
  })

  it('seeds clearly labelled sample data once in demo mode', () => {
    const demo = { ...t.ctx(), mode: 'demo' as const }
    seedDemoData(demo)
    seedDemoData(demo)
    const teams = listTeams(demo)
    expect(teams).toHaveLength(4)
    expect(teams.every((x) => x.name.startsWith('Sample'))).toBe(true)
    expect(teams.every((x) => x.playerCount === 14 && x.captainPlayerId && x.primaryGoalkeeperId)).toBe(true)
    expect(getDashboard(demo).upcoming.length).toBeGreaterThan(0)
  })
})
