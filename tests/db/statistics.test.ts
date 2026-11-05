import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { RULE_PRESETS } from '../../src/shared/domain/rules'
import { auditLogs, matches, playerStatistics, players, teamStatistics } from '../../src/main/db/schema'
import { clockAction, endPeriod, endTimeout, finishMatch, recordEvent, recordSanction, startPeriod, startTimeout, tickClocks, voidEvent } from '../../src/main/services/live'
import { getPlayer } from '../../src/main/services/players'
import { findArchived, listReports, readReport, reportContentKey, reportFileName, storeReport } from '../../src/main/services/reports/archive'
import { matchReport } from '../../src/main/services/reports/data'
import { matchWorkbook, statisticsWorkbook } from '../../src/main/services/reports/workbook'
import { updateSettings } from '../../src/main/services/settings'
import { ensureStatistics, statisticsOverview } from '../../src/main/services/statistics'
import { createMatch } from '../../src/main/services/matches'
import { testDb, type TestDb } from './helpers'
import { fakeTime, readyMatch, rematch } from './live-fixture'

let t: TestDb
let time: ReturnType<typeof fakeTime>
beforeEach(() => {
  t = testDb(true)
  time = fakeTime(t)
})
afterEach(() => t.cleanup())

const MIN = 60_000
const rid = () => crypto.randomUUID()
type Side = 'home' | 'away'
type Match = ReturnType<typeof readyMatch>

const record = (matchId: string, event: Parameters<typeof recordEvent>[1]['event']) => recordEvent(time.ctx(), { matchId, clientRequestId: rid(), event })
const shot = (matchId: string, side: Side, rosterId: string, outcome: 'goal' | 'saved' | 'missed', extra: Record<string, unknown> = {}) =>
  record(matchId, { kind: 'shot', side, rosterId, outcome, situation: 'positional', zone: null, assistRosterId: null, ...extra })
const sanction = (matchId: string, kind: 'warning' | 'suspension' | 'disqualification', side: Side, rosterId: string, blueCard = false) =>
  recordSanction(time.ctx(), { matchId, clientRequestId: rid(), kind, side, target: { type: 'player', rosterId }, blueCard, acknowledged: true })

function endHalf(matchId: string) {
  time.advance(31 * MIN)
  tickClocks(time.ctx())
  endPeriod(time.ctx(), { matchId, force: false })
}

/** A short match with a known outcome: home 3, away 2 after one voided home goal. */
function playMatch(m: Match) {
  const id = m.matchId
  startPeriod(time.ctx(), id)
  clockAction(time.ctx(), { matchId: id, action: 'start' })
  time.advance(MIN)
  shot(id, 'home', m.home.get(5)!, 'goal', { assistRosterId: m.home.get(6)!, situation: 'fast_break', zone: 'wing' })
  shot(id, 'home', m.home.get(4)!, 'goal', { situation: 'seven_metre' })
  shot(id, 'away', m.away.get(3)!, 'saved')
  shot(id, 'away', m.away.get(4)!, 'goal')
  shot(id, 'home', m.home.get(5)!, 'missed')
  shot(id, 'away', m.away.get(6)!, 'saved', { situation: 'seven_metre' })
  record(id, { kind: 'steal', side: 'home', rosterId: m.home.get(6)! })
  record(id, { kind: 'turnover', side: 'away', rosterId: m.away.get(7)! })
  record(id, { kind: 'technical_fault', side: 'away', rosterId: m.away.get(7)! })
  record(id, { kind: 'block', side: 'home', rosterId: m.home.get(7)! })
  sanction(id, 'warning', 'home', m.home.get(5)!)
  time.advance(MIN)
  sanction(id, 'suspension', 'away', m.away.get(3)!)
  startTimeout(time.ctx(), { matchId: id, clientRequestId: rid(), side: 'away' })
  time.advance(10_000)
  endTimeout(time.ctx(), id)
  clockAction(time.ctx(), { matchId: id, action: 'start' })
  endHalf(id)
  startPeriod(time.ctx(), id)
  clockAction(time.ctx(), { matchId: id, action: 'start' })
  time.advance(MIN)
  shot(id, 'home', m.home.get(5)!, 'goal')
  shot(id, 'away', m.away.get(5)!, 'goal')
  const voided = shot(id, 'home', m.home.get(2)!, 'goal').events[0]
  voidEvent(time.ctx(), { matchId: id, eventId: voided.id, reason: 'Scored by the other team' })
  sanction(id, 'disqualification', 'away', m.away.get(4)!, true)
  endHalf(id)
  finishMatch(time.ctx(), { matchId: id, force: false })
  return id
}

/** Count active ledger rows with SQL, independently of the code under test. */
const ledgerCount = (matchId: string, where: string) =>
  (t.handle.sqlite.prepare(`SELECT count(*) AS n FROM match_events WHERE match_id = ? AND status = 'active' AND ${where}`).get(matchId) as { n: number }).n

describe('statistics agree with the event ledger', () => {
  it('caches the exact totals of a finalized match', () => {
    const m = readyMatch(time.ctx())
    const id = playMatch(m)
    const rows = t.handle.db.select().from(playerStatistics).where(eq(playerStatistics.matchId, id)).all()
    const row = (rosterId: string) => rows.find((r) => r.rosterId === rosterId)
    expect(rows).toHaveLength(28)
    expect(row(m.home.get(5)!)).toMatchObject({ goals: 2, shots: 3, warnings: 1, played: true })
    expect(row(m.home.get(4)!)).toMatchObject({ goals: 1, sevenMetreGoals: 1, sevenMetreShots: 1 })
    expect(row(m.home.get(6)!)).toMatchObject({ assists: 1, steals: 1 })
    expect(row(m.home.get(1)!)).toMatchObject({ saves: 2, shotsFaced: 4, goalsConceded: 2, sevenMetreSaves: 1, sevenMetreFaced: 1, isGoalkeeper: true })
    expect(row(m.away.get(1)!)).toMatchObject({ saves: 0, shotsFaced: 3, goalsConceded: 3 })
    expect(row(m.away.get(7)!)).toMatchObject({ turnovers: 1, technicalFaults: 1 })
    expect(row(m.away.get(3)!)).toMatchObject({ suspensions: 1 })
    expect(row(m.away.get(4)!)).toMatchObject({ disqualifications: 1 })
    expect(row(m.home.get(2)!)).toMatchObject({ goals: 0, shots: 0 })
    expect(row(m.home.get(14)!)).toMatchObject({ played: false })

    const teams = t.handle.db.select().from(teamStatistics).where(eq(teamStatistics.matchId, id)).all()
    const home = teams.find((x) => x.side === 'home')!
    const away = teams.find((x) => x.side === 'away')!
    expect(home).toMatchObject({ goals: 3, shots: 4, saves: 2, goalsConceded: 2, warnings: 1, steals: 1, blocks: 1, shootingPct: 75, savePct: 50 })
    expect(away).toMatchObject({ goals: 2, shots: 4, saves: 0, goalsConceded: 3, suspensions: 1, disqualifications: 1, timeouts: 1, technicalFaults: 1, turnovers: 1 })

    // Against the raw ledger, and against the stored result.
    for (const r of [home, away]) {
      expect(r.goals).toBe(ledgerCount(id, `type = 'shot' AND outcome = 'goal' AND side = '${r.side}'`))
      expect(r.shots).toBe(ledgerCount(id, `type = 'shot' AND side = '${r.side}'`))
      expect(rows.filter((x) => x.teamId === r.teamId).reduce((n, x) => n + x.goals, 0)).toBe(r.goals)
    }
    const stored = t.handle.db.select().from(matches).where(eq(matches.id, id)).get()!
    expect([stored.homeScore, stored.awayScore]).toEqual([home.goals, away.goals])
  })

  it('updates statistics, report and result when a finalized match is corrected, and marks old reports outdated', async () => {
    const m = readyMatch(time.ctx())
    const id = playMatch(m)
    const before = matchReport(time.ctx(), id)
    const file = storeReport(time.ctx(), before, 'xlsx', await matchWorkbook(before))
    expect(listReports(time.ctx(), { limit: 10 })[0]).toMatchObject({ outdated: false, matchState: 'final' })

    const goal = before.timeline.find((e) => e.title === 'Goal' && e.who.startsWith('#5'))!
    voidEvent(time.ctx(), { matchId: id, eventId: goal.id, reason: 'Wrong team recorded' })

    const after = matchReport(time.ctx(), id)
    expect(after.home.score).toBe(2)
    expect(after.match.amended).toBe(true)
    expect(after.ledger.digest).not.toBe(before.ledger.digest)
    expect(after.corrections.find((c) => c.id === goal.id)).toMatchObject({ kind: 'voided', reason: 'Wrong team recorded', by: 'Test Admin' })
    const row = t.handle.db.select().from(teamStatistics).where(eq(teamStatistics.matchId, id)).all().find((x) => x.side === 'home')
    expect(row?.goals).toBe(2)
    expect(listReports(time.ctx(), { limit: 10 }).find((r) => r.id === file.id)?.outdated).toBe(true)
  })

  it('marks a provisional file outdated once the match is finalized, although the ledger is unchanged', () => {
    const m = readyMatch(time.ctx())
    const id = m.matchId
    startPeriod(time.ctx(), id)
    clockAction(time.ctx(), { matchId: id, action: 'start' })
    endHalf(id)
    startPeriod(time.ctx(), id)
    clockAction(time.ctx(), { matchId: id, action: 'start' })
    endHalf(id)
    const provisional = matchReport(time.ctx(), id)
    expect(provisional.state).toBe('provisional')
    storeReport(time.ctx(), provisional, 'pdf', Buffer.from('%PDF-test'))
    expect(listReports(time.ctx(), { limit: 10 })[0]).toMatchObject({ outdated: false, matchState: 'provisional' })
    finishMatch(time.ctx(), { matchId: id, force: false })
    expect(matchReport(time.ctx(), id).ledger.digest).toBe(provisional.ledger.digest)
    expect(listReports(time.ctx(), { limit: 10 })[0]).toMatchObject({ outdated: true })
  })

  it('leaves a match in progress out of the career totals, and a player who did not play out of the match count', () => {
    const first = readyMatch(time.ctx())
    playMatch(first)
    const live = rematch(time.ctx(), first.homeTeamId, first.awayTeamId)
    startPeriod(time.ctx(), live.matchId)
    clockAction(time.ctx(), { matchId: live.matchId, action: 'start' })
    time.advance(MIN)
    shot(live.matchId, 'home', live.home.get(5)!, 'goal')

    const scorer = statisticsOverview(time.ctx(), {}).players[0]
    const profile = getPlayer(time.ctx(), scorer.playerId)
    expect(profile.totals).toMatchObject({ goals: scorer.goals, shots: scorer.shots, matches: scorer.matches })
    expect(profile.matches.find((x) => x.matchId === live.matchId)?.goals).toBe(1)

    const benchRow = t.handle.db.select().from(playerStatistics).where(eq(playerStatistics.rosterId, first.home.get(14)!)).get()!
    expect(benchRow.played).toBe(false)
    expect(getPlayer(time.ctx(), benchRow.playerId).totals.matches).toBe(0)
  })

  it('rebuilds a missing cache from the ledger, as after restoring an older backup', () => {
    const m = readyMatch(time.ctx())
    const id = playMatch(m)
    const expected = statisticsOverview(time.ctx(), {})
    t.handle.db.delete(playerStatistics).run()
    t.handle.db.delete(teamStatistics).run()
    ensureStatistics(time.ctx())
    expect(statisticsOverview(time.ctx(), {})).toEqual(expected)
    expect(t.handle.db.select().from(teamStatistics).where(eq(teamStatistics.matchId, id)).all()).toHaveLength(2)
  })

  it('keeps the player profile equal to the statistics page', () => {
    const m = readyMatch(time.ctx())
    playMatch(m)
    const overview = statisticsOverview(time.ctx(), {})
    const scorer = overview.players[0]
    const profile = getPlayer(time.ctx(), scorer.playerId)
    expect(profile.totals).toMatchObject({ goals: scorer.goals, shots: scorer.shots, warnings: scorer.warnings, assists: scorer.assists })
    const keeper = overview.goalkeepers[0]
    expect(getPlayer(time.ctx(), keeper.playerId).totals).toMatchObject({ saves: keeper.saves, shotsFaced: keeper.shotsFaced })
  })
})

describe('statistics overview', () => {
  it('adds up matches, ignores unfinished ones and can be filtered', () => {
    const first = readyMatch(time.ctx())
    playMatch(first)
    const second = rematch(time.ctx(), first.homeTeamId, first.awayTeamId)
    playMatch(second)
    const third = rematch(time.ctx(), first.homeTeamId, first.awayTeamId)
    startPeriod(time.ctx(), third.matchId)
    clockAction(time.ctx(), { matchId: third.matchId, action: 'start' })
    time.advance(MIN)
    shot(third.matchId, 'home', third.home.get(5)!, 'goal')

    const all = statisticsOverview(time.ctx(), {})
    expect(all.matches).toBe(2)
    expect(all.players[0]).toMatchObject({ name: 'P5 HOM', goals: 4, matches: 2, teamName: 'Team HOM' })
    expect(all.teams[0]).toMatchObject({ name: 'Team HOM', played: 2, won: 2, drawn: 0, lost: 0, goalsFor: 6, goalsConceded: 4 })
    expect(all.teams[1]).toMatchObject({ name: 'Team AWY', played: 2, won: 0, lost: 2, goalsFor: 4, goalsConceded: 6 })
    expect(all.goalkeepers[0]).toMatchObject({ name: 'P1 HOM', saves: 4, shotsFaced: 8, matches: 2 })

    const oneTeam = statisticsOverview(time.ctx(), { teamId: first.awayTeamId })
    expect(oneTeam.teams.map((x) => x.name)).toEqual(['Team AWY'])
    expect(new Set(oneTeam.players.map((p) => p.teamName))).toEqual(new Set(['Team AWY']))
    expect(oneTeam.matches).toBe(2)

    const none = statisticsOverview(time.ctx(), { competitionId: crypto.randomUUID() })
    expect(none).toEqual({ matches: 0, players: [], goalkeepers: [], teams: [] })
  })

  it('counts a shoot-out win correctly and keeps shoot-out throws out of the totals', () => {
    const preset = RULE_PRESETS[0]
    const rules = { ...preset, drawAllowed: false, overtime: { ...preset.overtime, enabled: false }, shootout: { ...preset.shootout, enabled: true, throwsPerTeam: 1 } }
    const m = readyMatch(time.ctx(), rules)
    const id = m.matchId
    startPeriod(time.ctx(), id)
    clockAction(time.ctx(), { matchId: id, action: 'start' })
    endHalf(id)
    startPeriod(time.ctx(), id)
    clockAction(time.ctx(), { matchId: id, action: 'start' })
    endHalf(id)
    startPeriod(time.ctx(), id)
    shot(id, 'home', m.home.get(5)!, 'goal', { situation: 'shootout' })
    shot(id, 'away', m.away.get(5)!, 'saved', { situation: 'shootout' })
    endPeriod(time.ctx(), { matchId: id, force: false })
    finishMatch(time.ctx(), { matchId: id, force: false })

    const report = matchReport(time.ctx(), id)
    expect(report.decidedBy).toBe('shootout')
    expect(report.home.shootout).toEqual({ attempts: 1, goals: 1 })
    expect(report.home.score).toBe(0)
    expect(report.timeline.filter((e) => e.key && e.title.startsWith('Shoot-out'))).toHaveLength(2)
    const overview = statisticsOverview(time.ctx(), {})
    expect(overview.teams.find((x) => x.name === 'Team HOM')).toMatchObject({ won: 1, goalsFor: 0, shots: 0 })
    expect(overview.teams.find((x) => x.name === 'Team AWY')).toMatchObject({ lost: 1 })
  })
})

describe('match report', () => {
  it('lists sanctions with their match times and the timeline in order', () => {
    const m = readyMatch(time.ctx())
    const r = matchReport(time.ctx(), playMatch(m))
    expect(r.state).toBe('final')
    expect(r.finalizedBy).toBe('Test Admin')
    expect([r.home.score, r.away.score, r.home.halfTime, r.away.halfTime]).toEqual([3, 2, 2, 1])
    expect(r.periods.map((p) => [p.home, p.away])).toEqual([[2, 1], [1, 1]])
    expect(r.biggestLead).toEqual({ side: 'home', goals: 2 })
    const player = (side: 'home' | 'away', n: number) => r[side].players.find((p) => p.jerseyNumber === n)!
    expect(player('home', 5).warningsAt).toEqual(['01:00'])
    expect(player('away', 3).suspensionsAt).toEqual(['02:00'])
    expect(player('away', 4)).toMatchObject({ disqualifiedAt: '31:00', blueCard: true })
    expect(r.away.timeoutsAt).toEqual(['02:00'])
    expect(r.away.officials[0]).toMatchObject({ slot: 'A', name: 'Coach away', warningsAt: [] })
    expect(r.corrections).toHaveLength(1)
    expect(r.corrections[0]).toMatchObject({ kind: 'voided', reason: 'Scored by the other team' })
    expect(r.timeline.some((e) => e.who.startsWith('#2 '))).toBe(false)
    expect(r.ledger.voided).toBe(1)
    expect(r.timeline[0].title).toMatch(/^Start/)
    const goals = r.timeline.filter((e) => e.score).map((e) => e.score)
    expect(goals).toEqual(['1:0', '2:0', '2:1', '3:1', '3:2'])
  })

  it('is provisional until the match is finalized and refuses a match without lineups', () => {
    const m = readyMatch(time.ctx())
    expect(matchReport(time.ctx(), m.matchId)).toMatchObject({ state: 'provisional' })
    const fixture = createMatch(time.ctx(), { homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, scheduledAt: Date.now(), stage: 'friendly', officials: [] })
    expect(() => matchReport(time.ctx(), fixture.id)).toThrow(/lineups/)
  })

  it('takes its header and sections from the settings and labels demonstration data', () => {
    const m = readyMatch(time.ctx())
    updateSettings(time.ctx(), { organisationName: 'Ghana Handball Association', reports: { headerTitle: 'Match Protocol', includeTimeline: false, footerNote: 'Signed copies go to the secretariat.' } })
    expect(matchReport(time.ctx(), m.matchId)).toMatchObject({
      organisationName: 'Ghana Handball Association',
      headerTitle: 'Match Protocol',
      includeTimeline: false,
      footerNote: 'Signed copies go to the secretariat.',
      demo: false
    })
    expect(matchReport({ ...time.ctx(), mode: 'demo' }, m.matchId).demo).toBe(true)
  })
})

describe('report archive', () => {
  it('finds an identical report instead of storing it twice, and keeps both formats', () => {
    const m = readyMatch(time.ctx())
    const id = playMatch(m)
    const report = matchReport(time.ctx(), id)
    const key = reportContentKey(report)
    expect(findArchived(time.ctx(), id, 'pdf', key)).toBeNull()
    const pdf = storeReport(time.ctx(), report, 'pdf', Buffer.from('%PDF-test'))
    expect(findArchived(time.ctx(), id, 'pdf', reportContentKey(matchReport(time.ctx(), id)))?.id).toBe(pdf.id)
    expect(findArchived(time.ctx(), id, 'xlsx', key)).toBeNull()
    updateSettings(time.ctx(), { reports: { headerTitle: 'Changed title' } })
    expect(findArchived(time.ctx(), id, 'pdf', reportContentKey(matchReport(time.ctx(), id)))).toBeNull()

    expect(pdf).toMatchObject({ format: 'pdf', sizeBytes: 9, generatedBy: 'Test Admin', title: 'Team HOM v Team AWY' })
    expect(readReport(time.ctx(), pdf.id).bytes.toString()).toBe('%PDF-test')
    expect(t.handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'report.generate')).all()).toHaveLength(1)
  })

  it('makes a safe file name from the match details', () => {
    const m = readyMatch(time.ctx())
    const r = matchReport(time.ctx(), m.matchId)
    const name = reportFileName({ ...r, match: { ...r.match, matchNumber: 'M/1:2*"3' } }, 'pdf')
    expect(name).toBe('M_1_2_3 HOM v AWY provisional report.pdf')
    expect(reportFileName({ ...r, demo: true }, 'xlsx')).toMatch(/^DEMO - .* provisional report\.xlsx$/)
  })
})

describe('Excel workbooks', () => {
  const open = async (buffer: Buffer) => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    return wb
  }
  const values = (ws: ExcelJS.Worksheet) => {
    const rows: unknown[][] = []
    ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1)))
    return rows
  }

  it('holds the same numbers as the report, including the whole ledger', async () => {
    const m = readyMatch(time.ctx())
    const r = matchReport(time.ctx(), playMatch(m))
    const wb = await open(await matchWorkbook(r))
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Match', 'Teams', 'Players', 'Goalkeepers', 'Timeline', 'Corrections'])
    const rows = values(wb.getWorksheet('Players')!)
    expect(rows[0].slice(0, 7)).toEqual(['Team', '#', 'Player', 'Played', 'Goals', 'Shots', 'Shooting %'])
    expect(rows).toHaveLength(29)
    expect(rows.find((row) => row[2] === 'P5 HOM')?.slice(4, 7)).toEqual([2, 3, 66.7])
    const keepers = values(wb.getWorksheet('Goalkeepers')!)
    expect(keepers.find((row) => row[2] === 'P1 HOM')?.slice(3, 6)).toEqual([2, 4, 50])
    expect(values(wb.getWorksheet('Timeline')!)).toHaveLength(r.timeline.length + 1)
    expect(values(wb.getWorksheet('Corrections')!)[1][4]).toBe('Scored by the other team')
    expect(values(wb.getWorksheet('Teams')!)[1]).toEqual(['Goals', 3, 2])
    expect(values(wb.getWorksheet('Match')!).find((row) => row[0] === 'Status')?.[1]).toBe('Final')
  })

  it('labels provisional and demonstration data', async () => {
    const m = readyMatch(time.ctx())
    const r = matchReport({ ...time.ctx(), mode: 'demo' }, m.matchId)
    const notice = 'DEMONSTRATION DATA - NOT AN OFFICIAL RECORD; PROVISIONAL - match not finalized'
    const wb = await open(await matchWorkbook(r))
    expect(values(wb.getWorksheet('Match')!).find((row) => row[0] === 'Status')?.[1]).toBe(notice)
    // Every sheet is marked, because a sheet can be copied out on its own.
    for (const ws of wb.worksheets) expect(ws.getCell('A1').value).toBe(notice)
  })

  it('stores a name that looks like a formula as plain text', async () => {
    const m = readyMatch(time.ctx())
    playMatch(m)
    const p = t.handle.db.select().from(players).all()[0]
    t.handle.db.update(players).set({ firstName: '=HYPERLINK("http://x","y")', lastName: 'A' }).where(eq(players.id, p.id)).run()
    const ws = (await open(await statisticsWorkbook(statisticsOverview(time.ctx(), {}), 'GHA', false))).getWorksheet('Players')!
    expect(ws.getColumn(1).values).toContain('=HYPERLINK("http://x","y") A')
  })

  it('exports the statistics page with percentages and marks demonstration totals', async () => {
    const m = readyMatch(time.ctx())
    playMatch(m)
    const wb = await open(await statisticsWorkbook(statisticsOverview(time.ctx(), {}), 'GHA', true))
    expect(wb.creator).toBe('GHA')
    for (const ws of wb.worksheets) expect(ws.getCell('A1').value).toBe('DEMONSTRATION DATA - NOT AN OFFICIAL RECORD')
    expect(values(wb.getWorksheet('Teams')!)[2].slice(0, 8)).toEqual(['Team HOM', 1, 1, 0, 0, 3, 2, 75])
  })
})
