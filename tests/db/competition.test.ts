import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { DEFAULT_RULES } from '../../src/shared/domain/rules'
import { auditLogs, matches, teams } from '../../src/main/db/schema'
import { createCompetition, createSeason, setSeasonTeams } from '../../src/main/services/competitions'
import { clearFixtures, generateFixtures } from '../../src/main/services/fixtures'
import { clearKnockout, createKnockout, getBracket, knockoutProposal, knockoutRules, scheduleTie } from '../../src/main/services/knockout'
import { clockAction, endPeriod, finishMatch, recordEvent, startPeriod, tickClocks, voidEvent } from '../../src/main/services/live'
import { createMatch, deleteMatch, getMatch, listMatches, updateMatch } from '../../src/main/services/matches'
import { seasonReport } from '../../src/main/services/reports/season'
import { seasonWorkbook } from '../../src/main/services/reports/workbook'
import { seasonStandings } from '../../src/main/services/standings'
import { testDb, type TestDb } from './helpers'
import { confirmLineups, fakeTime, team } from './live-fixture'

let t: TestDb
let time: ReturnType<typeof fakeTime>
beforeEach(() => {
  t = testDb(true)
  time = fakeTime(t)
})
afterEach(() => t.cleanup())

const MIN = 60_000
const KICKOFF = Date.UTC(2027, 0, 9, 14)
const SCHEDULE = { legs: 1 as const, firstKickoff: KICKOFF, daysBetweenRounds: 7, minutesBetweenMatches: 90 }
type CompetitionType = 'league' | 'groups' | 'groups_knockout' | 'knockout'

function competition(type: CompetitionType, entries: [string, string | null][], rules = DEFAULT_RULES) {
  const ctx = time.ctx()
  const comp = createCompetition(ctx, { name: 'Test Cup', shortName: null, type, category: null, organizer: null, rules, pointsWin: 2, pointsDraw: 1, pointsLoss: 0, tiebreakers: ['points', 'head_to_head_points', 'goal_difference', 'goals_for'] })
  const season = createSeason(ctx, { competitionId: comp.id, name: '2027', startDate: null, endDate: null, status: 'active' })
  const ids = new Map(entries.map(([code]) => [code, team(ctx, code).id]))
  setSeasonTeams(ctx, { seasonId: season.id, teams: entries.map(([code, groupName]) => ({ teamId: ids.get(code)!, groupName })) })
  return { comp, seasonId: season.id, ids }
}

const shot = (matchId: string, side: 'home' | 'away', rosterId: string) =>
  recordEvent(time.ctx(), { matchId, clientRequestId: crypto.randomUUID(), event: { kind: 'shot', side, rosterId, outcome: 'goal', situation: 'positional', zone: null, assistRosterId: null } })

function half(id: string) {
  startPeriod(time.ctx(), id)
  clockAction(time.ctx(), { matchId: id, action: 'start' })
  time.advance(MIN)
}

function endHalf(id: string) {
  time.advance(31 * MIN)
  tickClocks(time.ctx())
  endPeriod(time.ctx(), { matchId: id, force: false })
}

/** Play a whole match through the live engine. Returns the id of the home side's first goal. */
function play(id: string, homeGoals: number, awayGoals: number) {
  const m = confirmLineups(time.ctx(), id)
  half(id)
  const homeGoalIds = Array.from({ length: homeGoals }, () => shot(id, 'home', m.home.get(5)!).events[0].id)
  for (let i = 0; i < awayGoals; i++) shot(id, 'away', m.away.get(5)!)
  endHalf(id)
  half(id)
  endHalf(id)
  finishMatch(time.ctx(), { matchId: id, force: false })
  return homeGoalIds[0]
}

const fixturesOf = (seasonId: string) => listMatches(time.ctx(), { seasonId, limit: 200 }).sort((a, b) => a.scheduledAt - b.scheduledAt)
const tie = (seasonId: string, stage: string, position = 1) => getBracket(time.ctx(), seasonId).ties.find((x) => x.stage === stage && x.position === position)!

describe('fixture generation', () => {
  it('creates a full league programme and refuses to create it twice', () => {
    const c = competition('league', [['AAA', null], ['BBB', null], ['CCC', null], ['DDD', null]])
    expect(generateFixtures(time.ctx(), { ...SCHEDULE, legs: 2, seasonId: c.seasonId })).toEqual({ created: 12 })
    const list = fixturesOf(c.seasonId)
    expect(list).toHaveLength(12)
    expect(list.every((m) => m.stage === 'league' && m.status === 'scheduled')).toBe(true)
    expect(list[0]).toMatchObject({ round: 1, scheduledAt: KICKOFF })
    expect(new Set(list.map((m) => m.matchNumber)).size).toBe(12)
    expect(() => generateFixtures(time.ctx(), { ...SCHEDULE, seasonId: c.seasonId })).toThrow(/already has fixtures/)
  })

  it('creates all fixtures or none when one team cannot be scheduled', () => {
    const c = competition('league', [['AAA', null], ['BBB', null], ['CCC', null]])
    t.handle.db.update(teams).set({ archived: true }).where(eq(teams.id, c.ids.get('CCC')!)).run()
    expect(() => generateFixtures(time.ctx(), { ...SCHEDULE, seasonId: c.seasonId })).toThrow(/Archived/)
    expect(fixturesOf(c.seasonId)).toHaveLength(0)
  })

  it('keeps each group to itself and requires every team to have a group', () => {
    const c = competition('groups', [['AAA', 'A'], ['BBB', 'A'], ['CCC', 'B'], ['DDD', 'B']])
    expect(generateFixtures(time.ctx(), { ...SCHEDULE, seasonId: c.seasonId }).created).toBe(2)
    const list = fixturesOf(c.seasonId)
    expect(list.map((m) => [m.stage, m.groupName])).toEqual([['group', 'A'], ['group', 'B']])

    const ungrouped = competition('groups', [['EEE', 'A'], ['FFF', null]])
    expect(() => generateFixtures(time.ctx(), { ...SCHEDULE, seasonId: ungrouped.seasonId })).toThrow(/Give every team a group/)
  })

  it('refuses a competition without fixtures of this kind', () => {
    const c = competition('knockout', [['AAA', null], ['BBB', null]])
    expect(() => generateFixtures(time.ctx(), { ...SCHEDULE, seasonId: c.seasonId })).toThrow(/no league or group fixtures/)
  })

  it('deletes only unprepared fixtures, keeping played matches and confirmed lineups', () => {
    const c = competition('league', [['AAA', null], ['BBB', null], ['CCC', null], ['DDD', null]])
    generateFixtures(time.ctx(), { ...SCHEDULE, seasonId: c.seasonId })
    const [first, prepared] = fixturesOf(c.seasonId)
    play(first.id, 3, 1)
    confirmLineups(time.ctx(), prepared.id)
    expect(clearFixtures(time.ctx(), c.seasonId)).toEqual({ deleted: 4 })
    expect(fixturesOf(c.seasonId).map((m) => m.id).sort()).toEqual([first.id, prepared.id].sort())
    expect(t.handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'fixtures.clear')).all()).toHaveLength(1)
  })
})

describe('standings from played matches', () => {
  it('counts finalized matches only, and follows a correction', () => {
    const c = competition('league', [['AAA', null], ['BBB', null], ['CCC', null], ['DDD', null]])
    generateFixtures(time.ctx(), { ...SCHEDULE, seasonId: c.seasonId })
    const [one, two] = fixturesOf(c.seasonId)
    const firstGoal = play(one.id, 2, 1)
    const unfinished = confirmLineups(time.ctx(), two.id)
    half(two.id)
    shot(two.id, 'home', unfinished.home.get(5)!)

    const winner = seasonStandings(time.ctx(), c.seasonId)[0]
    expect(winner).toMatchObject({ teamId: one.home.teamId, played: 1, won: 1, points: 2, goalsFor: 2, goalsAgainst: 1 })
    expect(seasonStandings(time.ctx(), c.seasonId).reduce((n, r) => n + r.played, 0)).toBe(2)

    voidEvent(time.ctx(), { matchId: one.id, eventId: firstGoal, reason: 'Goal did not count' })
    const after = seasonStandings(time.ctx(), c.seasonId).find((r) => r.teamId === one.home.teamId)
    expect(after).toMatchObject({ played: 1, won: 0, drawn: 1, points: 1, goalsFor: 1 })
  })

  it('ranks each group separately', () => {
    const c = competition('groups', [['AAA', 'A'], ['BBB', 'A'], ['CCC', 'B'], ['DDD', 'B']])
    generateFixtures(time.ctx(), { ...SCHEDULE, seasonId: c.seasonId })
    const [a, b] = fixturesOf(c.seasonId)
    play(a.id, 1, 3)
    play(b.id, 2, 0)
    const rows = seasonStandings(time.ctx(), c.seasonId)
    expect(rows.map((r) => [r.groupName, r.rank, r.teamId])).toEqual([
      ['A', 1, a.away.teamId],
      ['A', 2, a.home.teamId],
      ['B', 1, b.home.teamId],
      ['B', 2, b.away.teamId]
    ])
  })
})

describe('keeping the table complete', () => {
  it('refuses a league match with a team that is not registered in the season', () => {
    const c = competition('league', [['AAA', null], ['BBB', null]])
    const outsider = team(time.ctx(), 'ZZZ')
    const fixture = { competitionId: c.comp.id, seasonId: c.seasonId, scheduledAt: KICKOFF, officials: [], homeTeamId: c.ids.get('AAA')!, awayTeamId: outsider.id }
    expect(() => createMatch(time.ctx(), { ...fixture, stage: 'league' })).toThrow(/registered in the season/)
    const other = createMatch(time.ctx(), { ...fixture, stage: 'quarter_final' })
    expect(() => updateMatch(time.ctx(), { id: other.id, stage: 'league' })).toThrow(/registered in the season/)
  })

  it('refuses to move a team with group fixtures to another group, which would hide played matches', () => {
    const c = competition('groups', [['AAA', 'A'], ['BBB', 'A'], ['CCC', 'B'], ['DDD', 'B']])
    generateFixtures(time.ctx(), { ...SCHEDULE, seasonId: c.seasonId })
    const moved = [['AAA', 'A'], ['BBB', 'B'], ['CCC', 'B'], ['DDD', 'B']].map(([code, groupName]) => ({ teamId: c.ids.get(code)!, groupName }))
    expect(() => setSeasonTeams(time.ctx(), { seasonId: c.seasonId, teams: moved })).toThrow(/group cannot change/)
    expect(seasonStandings(time.ctx(), c.seasonId).find((r) => r.teamId === c.ids.get('BBB'))?.groupName).toBe('A')
  })

  it('still lets a team move group before it has any fixtures', () => {
    const c = competition('groups', [['AAA', 'A'], ['BBB', 'B']])
    setSeasonTeams(time.ctx(), { seasonId: c.seasonId, teams: [{ teamId: c.ids.get('AAA')!, groupName: 'A' }, { teamId: c.ids.get('BBB')!, groupName: 'A' }] })
    expect(seasonStandings(time.ctx(), c.seasonId).map((r) => r.groupName)).toEqual(['A', 'A'])
  })
})

describe('knockout rounds', () => {
  const four = () => competition('knockout', [['AAA', null], ['BBB', null], ['CCC', null], ['DDD', null]])
  const seeded = (c: ReturnType<typeof four>) => ['AAA', 'BBB', 'CCC', 'DDD'].map((x) => c.ids.get(x)!)
  const schedule = (c: { seasonId: string }, stage: string, position = 1) => {
    scheduleTie(time.ctx(), { tieId: tie(c.seasonId, stage, position).id, scheduledAt: KICKOFF })
    return tie(c.seasonId, stage, position).match!.id
  }

  it('builds a seeded bracket and refuses a second one or a stranger', () => {
    const c = four()
    const stranger = team(time.ctx(), 'ZZZ')
    expect(() => createKnockout(time.ctx(), { seasonId: c.seasonId, teamIds: [...seeded(c).slice(0, 3), stranger.id], thirdPlace: false })).toThrow(/registered/)
    const b = createKnockout(time.ctx(), { seasonId: c.seasonId, teamIds: seeded(c), thirdPlace: true })
    expect(b.ties.map((x) => x.stage)).toEqual(['semi_final', 'semi_final', 'third_place', 'final'])
    expect(b.ties[0]).toMatchObject({ state: 'ready', home: { code: 'AAA' }, away: { code: 'DDD' } })
    expect(() => createKnockout(time.ctx(), { seasonId: c.seasonId, teamIds: seeded(c), thirdPlace: false })).toThrow(/already has a bracket/)
    expect(knockoutProposal(time.ctx(), { seasonId: c.seasonId, qualifiersPerGroup: 2 }).teams.map((x) => x.code)).toEqual(['AAA', 'BBB', 'CCC', 'DDD'])
  })

  it('runs to a champion through real matches, with the losers in the third-place match', () => {
    const c = four()
    createKnockout(time.ctx(), { seasonId: c.seasonId, teamIds: seeded(c), thirdPlace: true })
    play(schedule(c, 'semi_final', 1), 3, 1)
    play(schedule(c, 'semi_final', 2), 1, 4)
    expect(tie(c.seasonId, 'final')).toMatchObject({ state: 'ready', home: { code: 'AAA' }, away: { code: 'CCC' } })
    expect(tie(c.seasonId, 'third_place')).toMatchObject({ state: 'ready', home: { code: 'DDD' }, away: { code: 'BBB' } })
    const finalId = schedule(c, 'final')
    expect(getMatch(time.ctx(), finalId)).toMatchObject({ stage: 'final', competitionId: c.comp.id })
    play(finalId, 2, 5)
    expect(getBracket(time.ctx(), c.seasonId).champion?.code).toBe('CCC')
  })

  it('makes every knockout match need a winner, whatever the competition rules say', () => {
    const lenient = { ...DEFAULT_RULES, drawAllowed: true, shootout: { ...DEFAULT_RULES.shootout, enabled: false } }
    expect(knockoutRules(lenient)).toMatchObject({ drawAllowed: false, shootout: { enabled: true } })
    const c = competition('knockout', [['AAA', null], ['BBB', null]], lenient)
    createKnockout(time.ctx(), { seasonId: c.seasonId, teamIds: [...c.ids.values()], thirdPlace: false })
    const id = schedule(c, 'final')
    expect(getMatch(time.ctx(), id).rules).toMatchObject({ drawAllowed: false, shootout: { enabled: true } })
  })

  it('keeps a team in the bracket registered, and keeps its seed when the teams are saved again', () => {
    const c = four()
    createKnockout(time.ctx(), { seasonId: c.seasonId, teamIds: seeded(c).reverse(), thirdPlace: false })
    const without = ['AAA', 'BBB', 'CCC'].map((x) => ({ teamId: c.ids.get(x)!, groupName: null }))
    expect(() => setSeasonTeams(time.ctx(), { seasonId: c.seasonId, teams: without })).toThrow(/in the bracket/)
    setSeasonTeams(time.ctx(), { seasonId: c.seasonId, teams: [...without, { teamId: c.ids.get('DDD')!, groupName: null }] })
    expect(knockoutProposal(time.ctx(), { seasonId: c.seasonId, qualifiersPerGroup: 2 }).teams.map((x) => x.code)).toEqual(['DDD', 'CCC', 'BBB', 'AAA'])
  })

  it('will not let a bracket match end without a winner', () => {
    const noOvertime = { ...DEFAULT_RULES, overtime: { ...DEFAULT_RULES.overtime, enabled: false } }
    const c = competition('knockout', [['AAA', null], ['BBB', null]], noOvertime)
    createKnockout(time.ctx(), { seasonId: c.seasonId, teamIds: [...c.ids.values()], thirdPlace: false })
    const id = schedule(c, 'final')
    const m = confirmLineups(time.ctx(), id)
    half(id)
    endHalf(id)
    half(id)
    endHalf(id)
    startPeriod(time.ctx(), id)
    expect(() => endPeriod(time.ctx(), { matchId: id, force: true })).toThrow(/must have a winner/)
    const throwIn = (side: 'home' | 'away', jersey: number, outcome: 'goal' | 'saved') =>
      recordEvent(time.ctx(), { matchId: id, clientRequestId: crypto.randomUUID(), event: { kind: 'shot', side, rosterId: m[side].get(jersey)!, outcome, situation: 'shootout', zone: null, assistRosterId: null } })
    for (const jersey of [2, 3, 4, 5, 6]) {
      throwIn('home', jersey, 'goal')
      throwIn('away', jersey, jersey === 6 ? 'saved' : 'goal')
    }
    endPeriod(time.ctx(), { matchId: id, force: false })
    finishMatch(time.ctx(), { matchId: id, force: false })
    expect(getBracket(time.ctx(), c.seasonId).champion?.code).toBe('AAA')
    expect(getMatch(time.ctx(), id)).toMatchObject({ homeShootout: 5, awayShootout: 4, winnerSide: 'home' })
  })

  it('will not schedule a tie before both teams are known, or twice', () => {
    const c = four()
    createKnockout(time.ctx(), { seasonId: c.seasonId, teamIds: seeded(c), thirdPlace: false })
    expect(() => schedule(c, 'final')).toThrow(/must be known/)
    schedule(c, 'semi_final')
    expect(() => schedule(c, 'semi_final')).toThrow(/must be known/)
  })

  it('flags a correction that contradicts a later fixture, and changes nothing by itself', () => {
    const c = four()
    createKnockout(time.ctx(), { seasonId: c.seasonId, teamIds: seeded(c), thirdPlace: false })
    const semi = schedule(c, 'semi_final', 1)
    const firstGoal = play(semi, 2, 1)
    play(schedule(c, 'semi_final', 2), 3, 1)
    const finalId = schedule(c, 'final')

    voidEvent(time.ctx(), { matchId: semi, eventId: firstGoal, reason: 'Goal did not count' })
    expect(tie(c.seasonId, 'semi_final').problem).toMatch(/level/)
    const final = tie(c.seasonId, 'final')
    expect(final.problem).toMatch(/Delete this fixture/)
    expect(final.match?.id).toBe(finalId)
    expect(getMatch(time.ctx(), finalId).status).toBe('scheduled')
  })

  it('returns a tie to ready when its unplayed fixture is deleted', () => {
    const c = four()
    createKnockout(time.ctx(), { seasonId: c.seasonId, teamIds: seeded(c), thirdPlace: false })
    deleteMatch(time.ctx(), schedule(c, 'semi_final'))
    expect(tie(c.seasonId, 'semi_final')).toMatchObject({ state: 'ready', match: null })
  })

  it('removes an unstarted bracket with its fixtures, but never a played one', () => {
    const c = four()
    createKnockout(time.ctx(), { seasonId: c.seasonId, teamIds: seeded(c), thirdPlace: false })
    const id = schedule(c, 'semi_final')
    clearKnockout(time.ctx(), c.seasonId)
    expect(getBracket(time.ctx(), c.seasonId).ties).toHaveLength(0)
    expect(t.handle.db.select().from(matches).where(eq(matches.id, id)).all()).toHaveLength(0)

    createKnockout(time.ctx(), { seasonId: c.seasonId, teamIds: seeded(c), thirdPlace: false })
    play(schedule(c, 'semi_final'), 2, 1)
    expect(() => clearKnockout(time.ctx(), c.seasonId)).toThrow(/played match/)
    expect(getBracket(time.ctx(), c.seasonId).ties).toHaveLength(3)
  })
})

describe('groups and knockout', () => {
  it('waits for the group stage, then seeds group winners against the runners-up of the other group', () => {
    const c = competition('groups_knockout', [['AAA', 'A'], ['BBB', 'A'], ['CCC', 'B'], ['DDD', 'B']])
    generateFixtures(time.ctx(), { ...SCHEDULE, seasonId: c.seasonId })
    const [a, b] = fixturesOf(c.seasonId)
    play(a.id, 4, 1)
    expect(knockoutProposal(time.ctx(), { seasonId: c.seasonId, qualifiersPerGroup: 2 }).blocked).toBe('1 group match has not been finalized.')
    expect(() => createKnockout(time.ctx(), { seasonId: c.seasonId, teamIds: [...c.ids.values()], thirdPlace: false })).toThrow(/not been finalized/)

    play(b.id, 1, 2)
    const proposal = knockoutProposal(time.ctx(), { seasonId: c.seasonId, qualifiersPerGroup: 2 })
    expect(proposal.blocked).toBeNull()
    expect(proposal.teams.map((x) => x.label)).toEqual(['A1', 'B1', 'A2', 'B2'])
    const bracket = createKnockout(time.ctx(), { seasonId: c.seasonId, teamIds: proposal.teams.map((x) => x.teamId), thirdPlace: false })
    const [first, second] = bracket.ties
    expect([first.home?.teamId, first.away?.teamId]).toEqual([a.home.teamId, b.home.teamId])
    expect([second.home?.teamId, second.away?.teamId]).toEqual([b.away.teamId, a.away.teamId])
  })

  it('warns when a qualifying place cannot be decided by the criteria', () => {
    const c = competition('groups_knockout', [['AAA', 'A'], ['BBB', 'A'], ['CCC', 'A']])
    generateFixtures(time.ctx(), { ...SCHEDULE, seasonId: c.seasonId })
    // A beats B, B beats C, C beats A, all by one goal: nothing separates them.
    const beats = new Map([[c.ids.get('AAA'), c.ids.get('BBB')], [c.ids.get('BBB'), c.ids.get('CCC')], [c.ids.get('CCC'), c.ids.get('AAA')]])
    for (const m of fixturesOf(c.seasonId)) {
      const homeWins = beats.get(m.home.teamId) === m.away.teamId
      play(m.id, homeWins ? 2 : 1, homeWins ? 1 : 2)
    }
    expect(seasonStandings(time.ctx(), c.seasonId).filter((r) => r.unresolvedTie)).toHaveLength(3)
    expect(knockoutProposal(time.ctx(), { seasonId: c.seasonId, qualifiersPerGroup: 1 }).warnings[0]).toMatch(/level with the next team on every criterion/)
  })

  it('reports nothing to seed when the group stage has no fixtures', () => {
    const c = competition('groups_knockout', [['AAA', 'A'], ['BBB', 'A']])
    expect(knockoutProposal(time.ctx(), { seasonId: c.seasonId, qualifiersPerGroup: 1 }).blocked).toBe('The group stage has no fixtures yet.')
  })
})

describe('competition report', () => {
  function played() {
    const c = competition('groups_knockout', [['AAA', 'A'], ['BBB', 'A'], ['CCC', 'B'], ['DDD', 'B']])
    generateFixtures(time.ctx(), { ...SCHEDULE, seasonId: c.seasonId })
    const [a, b] = fixturesOf(c.seasonId)
    play(a.id, 4, 1)
    return { c, a, b }
  }

  it('brings standings, bracket, progress and statistics together', () => {
    const { c, b } = played()
    const r = seasonReport(time.ctx(), c.seasonId)
    expect(r).toMatchObject({ played: 1, scheduled: 2, demo: false, competition: { name: 'Test Cup', type: 'groups_knockout' } })
    expect(r.standings[0]).toMatchObject({ groupName: 'A', rank: 1, goalsFor: 4 })
    expect(r.bracket?.ties).toEqual([])
    expect(r.statistics).toMatchObject({ matches: 1 })
    expect(r.statistics.players[0]).toMatchObject({ goals: 4 })
    play(b.id, 2, 0)
    // Every fixture is played, but the knockout rounds are still to come.
    expect(seasonReport(time.ctx(), c.seasonId)).toMatchObject({ played: 2, scheduled: 2, inProgress: true })
  })

  it('is complete when a league has played every match, and a cup has a champion', () => {
    const league = competition('league', [['AAA', null], ['BBB', null]])
    generateFixtures(time.ctx(), { ...SCHEDULE, seasonId: league.seasonId })
    expect(seasonReport(time.ctx(), league.seasonId).inProgress).toBe(true)
    play(fixturesOf(league.seasonId)[0].id, 2, 1)
    expect(seasonReport(time.ctx(), league.seasonId).inProgress).toBe(false)

    const cup = competition('knockout', [['CCC', null], ['DDD', null]])
    createKnockout(time.ctx(), { seasonId: cup.seasonId, teamIds: [...cup.ids.values()], thirdPlace: false })
    expect(seasonReport(time.ctx(), cup.seasonId).inProgress).toBe(true)
    scheduleTie(time.ctx(), { tieId: tie(cup.seasonId, 'final').id, scheduledAt: KICKOFF })
    play(tie(cup.seasonId, 'final').match!.id, 3, 2)
    expect(seasonReport(time.ctx(), cup.seasonId).inProgress).toBe(false)
  })

  it('has no standings for a knockout competition and no bracket for a league', () => {
    const ko = competition('knockout', [['AAA', null], ['BBB', null]])
    expect(seasonReport(time.ctx(), ko.seasonId)).toMatchObject({ standings: [], bracket: { ties: [] } })
    const league = competition('league', [['CCC', null], ['DDD', null]])
    expect(seasonReport(time.ctx(), league.seasonId).bracket).toBeNull()
  })

  it('writes the same numbers to Excel and labels a season in progress and demonstration data', async () => {
    const { c, a } = played()
    const open = async (buffer: Buffer) => {
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer)
      return wb
    }
    const wb = await open(await seasonWorkbook(seasonReport(time.ctx(), c.seasonId)))
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Standings', 'Fixtures', 'Players', 'Goalkeepers', 'Teams'])
    const notice = 'IN PROGRESS - 1 of 2 matches finalized'
    for (const ws of wb.worksheets) expect(ws.getCell('A1').value).toBe(notice)
    expect(wb.getWorksheet('Standings')!.getRow(3).values).toEqual([undefined, 'A', 1, a.home.name, 1, 1, 0, 0, 4, 1, 3, 2])
    const demo = await open(await seasonWorkbook(seasonReport({ ...time.ctx(), mode: 'demo' }, c.seasonId)))
    expect(demo.getWorksheet('Fixtures')!.getCell('A1').value).toBe(`DEMONSTRATION DATA - NOT AN OFFICIAL RECORD; ${notice}`)
  })
})
