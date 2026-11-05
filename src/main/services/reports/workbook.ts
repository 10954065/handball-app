import ExcelJS from 'exceljs'
import { percent } from '@shared/domain/statistics'
import { MATCH_STAGE_LABELS } from '@shared/domain/constants'
import type { BracketDTO, MatchReportDTO, ReportPlayerDTO, ReportSideDTO, SeasonReportDTO, StatisticsOverviewDTO } from '@shared/dto'

const PERCENT_FORMAT = '0.0"%"'
const DATE_TIME = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

interface Column {
  header: string
  width: number
  percent?: boolean
}

function newWorkbook(creator: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = creator || 'HMMS'
  wb.created = new Date()
  return wb
}

/**
 * A sheet with a frozen, bold header row. ExcelJS writes every string as text, never as a formula.
 * A notice goes above the header on every sheet, because a sheet may be copied out on its own.
 */
function table(wb: ExcelJS.Workbook, name: string, columns: Column[], rows: (string | number | null)[][], notice: string): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: notice ? 2 : 1 }] })
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width, style: c.percent ? { numFmt: PERCENT_FORMAT } : {} }))
  ws.getRow(1).font = { bold: true }
  ws.addRows(rows)
  if (notice) {
    ws.insertRow(1, [notice])
    ws.getRow(1).font = { bold: true, color: { argb: 'FFB91C1C' } }
  }
  return ws
}

const DEMO_NOTICE = 'DEMONSTRATION DATA - NOT AN OFFICIAL RECORD'

const reportState = (r: MatchReportDTO) => [r.demo ? DEMO_NOTICE : null, r.state === 'provisional' ? 'PROVISIONAL - match not finalized' : null, r.match.amended ? 'AMENDED after finalization' : null].filter((x): x is string => !!x).join('; ')

function matchSheet(wb: ExcelJS.Workbook, r: MatchReportDTO): void {
  const m = r.match
  const score = (s: ReportSideDTO) => [s.name, s.score, s.halfTime, s.shootout?.goals ?? null]
  const rows: (string | number | null)[][] = [
    ['Report', r.headerTitle],
    ['Organisation', r.organisationName || null],
    ['Status', reportState(r) || 'Final'],
    ['Match number', m.matchNumber],
    ['Competition', m.competitionName ?? 'Friendly'],
    ['Season', m.seasonName],
    ['Date', DATE_TIME.format(m.scheduledAt)],
    ['Venue', m.venueName],
    ['Decided by', r.decidedBy],
    ['Ledger fingerprint (SHA-256)', r.ledger.digest],
    ['Ledger entries', r.ledger.events],
    ['Voided entries', r.ledger.voided],
    [],
    ['Team', 'Final', 'Half-time', 'Shoot-out'],
    score(r.home),
    score(r.away),
    [],
    ['Period', r.home.code, r.away.code],
    ...r.periods.map((p) => [p.label, p.home, p.away])
  ]
  const notice = reportState(r)
  const ws = table(wb, 'Match', [{ header: 'Field', width: 30 }, { header: 'Value', width: 42 }, { header: '', width: 12 }, { header: '', width: 12 }], rows, notice)
  ws.getRow(rows.findIndex((row) => row[0] === 'Team') + (notice ? 3 : 2)).font = { bold: true }
}

const sanctions = (p: ReportPlayerDTO) => [p.warningsAt.join(', ') || null, p.suspensionsAt.join(', ') || null, p.disqualifiedAt ?? null]

function playerSheets(wb: ExcelJS.Workbook, r: MatchReportDTO): void {
  const sides = [r.home, r.away]
  table(
    wb,
    'Players',
    [
      { header: 'Team', width: 22 },
      { header: '#', width: 5 },
      { header: 'Player', width: 26 },
      { header: 'Played', width: 8 },
      { header: 'Goals', width: 7 },
      { header: 'Shots', width: 7 },
      { header: 'Shooting %', width: 11, percent: true },
      { header: '7 m goals', width: 10 },
      { header: '7 m shots', width: 10 },
      { header: 'Assists', width: 8 },
      { header: 'Steals', width: 8 },
      { header: 'Blocks', width: 8 },
      { header: 'Turnovers', width: 10 },
      { header: 'Technical faults', width: 15 },
      { header: 'Warning at', width: 11 },
      { header: '2 min at', width: 20 },
      { header: 'Disqualified at', width: 14 }
    ],
    sides.flatMap((s) =>
      s.players.map((p) => {
        const t = p.stats
        return [s.name, p.jerseyNumber, p.name, p.played ? 'Yes' : 'No', t.goals, t.shots, percent(t.goals, t.shots), t.sevenMetreGoals, t.sevenMetreShots, t.assists, t.steals, t.blocks, t.turnovers, t.technicalFaults, ...sanctions(p)]
      })
    ),
    reportState(r)
  )
  table(
    wb,
    'Goalkeepers',
    [
      { header: 'Team', width: 22 },
      { header: '#', width: 5 },
      { header: 'Goalkeeper', width: 26 },
      { header: 'Saves', width: 7 },
      { header: 'Shots faced', width: 11 },
      { header: 'Save %', width: 8, percent: true },
      { header: 'Goals conceded', width: 14 },
      { header: '7 m saves', width: 10 },
      { header: '7 m faced', width: 10 }
    ],
    sides.flatMap((s) =>
      s.players
        .filter((p) => (p.isGoalkeeper && p.played) || p.stats.shotsFaced > 0)
        .map((p) => {
          const t = p.stats
          return [s.name, p.jerseyNumber, p.name, t.saves, t.shotsFaced, percent(t.saves, t.shotsFaced), t.goalsConceded, t.sevenMetreSaves, t.sevenMetreFaced]
        })
    ),
    reportState(r)
  )
}

function teamSheet(wb: ExcelJS.Workbook, r: MatchReportDTO): void {
  const line = (label: string, of: (s: ReportSideDTO) => number | null) => [label, of(r.home), of(r.away)]
  table(
    wb,
    'Teams',
    [{ header: 'Statistic', width: 26 }, { header: r.home.name, width: 22 }, { header: r.away.name, width: 22 }],
    [
      line('Goals', (s) => s.stats.goals),
      line('Shots', (s) => s.stats.shots),
      line('Shooting %', (s) => percent(s.stats.goals, s.stats.shots)),
      line('7 m goals', (s) => s.stats.sevenMetreGoals),
      line('7 m shots', (s) => s.stats.sevenMetreShots),
      line('Saves', (s) => s.stats.saves),
      line('Goals conceded', (s) => s.stats.goalsConceded),
      line('Save %', (s) => percent(s.stats.saves, s.stats.saves + s.stats.goalsConceded)),
      line('Technical faults', (s) => s.stats.technicalFaults),
      line('Turnovers', (s) => s.stats.turnovers),
      line('Steals', (s) => s.stats.steals),
      line('Blocks', (s) => s.stats.blocks),
      line('Warnings', (s) => s.stats.warnings),
      line('2-minute suspensions', (s) => s.stats.suspensions),
      line('Disqualifications', (s) => s.stats.disqualifications),
      line('Team time-outs', (s) => s.stats.timeouts)
    ],
    reportState(r)
  )
}

/** The match report as a workbook: the same numbers as the PDF, plus the whole ledger. */
export async function matchWorkbook(r: MatchReportDTO): Promise<Buffer> {
  const wb = newWorkbook(r.organisationName)
  matchSheet(wb, r)
  teamSheet(wb, r)
  playerSheets(wb, r)
  const code = (side: string | null) => (side === 'home' ? r.home.code : side === 'away' ? r.away.code : null)
  table(
    wb,
    'Timeline',
    [{ header: 'Time', width: 8 }, { header: 'Period', width: 8 }, { header: 'Team', width: 8 }, { header: 'Event', width: 24 }, { header: 'Who', width: 30 }, { header: 'Detail', width: 44 }, { header: 'Score', width: 8 }],
    r.timeline.map((e) => [e.time, e.periodLabel, code(e.side), e.title, e.who || null, e.detail || null, e.score]),
    reportState(r)
  )
  table(
    wb,
    'Corrections',
    [{ header: 'Time', width: 8 }, { header: 'Kind', width: 10 }, { header: 'Entry', width: 24 }, { header: 'Who', width: 30 }, { header: 'Reason', width: 44 }, { header: 'By', width: 22 }],
    r.corrections.map((c) => [c.time, c.kind === 'voided' ? 'Voided' : 'Clock', c.title, c.who || null, c.reason, c.by]),
    reportState(r)
  )
  return Buffer.from(await wb.xlsx.writeBuffer())
}

function statisticsSheets(wb: ExcelJS.Workbook, s: StatisticsOverviewDTO, notice: string): void {
  table(
    wb,
    'Players',
    [
      { header: 'Player', width: 26 },
      { header: 'Team', width: 24 },
      { header: 'Matches', width: 9 },
      { header: 'Goals', width: 7 },
      { header: 'Shots', width: 7 },
      { header: 'Shooting %', width: 11, percent: true },
      { header: '7 m goals', width: 10 },
      { header: '7 m shots', width: 10 },
      { header: 'Assists', width: 8 },
      { header: 'Steals', width: 8 },
      { header: 'Blocks', width: 8 },
      { header: 'Turnovers', width: 10 },
      { header: 'Technical faults', width: 15 },
      { header: 'Warnings', width: 9 },
      { header: '2 min', width: 7 },
      { header: 'Disqualifications', width: 16 }
    ],
    s.players.map((p) => [p.name, p.teamName, p.matches, p.goals, p.shots, percent(p.goals, p.shots), p.sevenMetreGoals, p.sevenMetreShots, p.assists, p.steals, p.blocks, p.turnovers, p.technicalFaults, p.warnings, p.suspensions, p.disqualifications]),
    notice
  )
  table(
    wb,
    'Goalkeepers',
    [
      { header: 'Goalkeeper', width: 26 },
      { header: 'Team', width: 24 },
      { header: 'Matches', width: 9 },
      { header: 'Saves', width: 7 },
      { header: 'Shots faced', width: 11 },
      { header: 'Save %', width: 8, percent: true },
      { header: 'Goals conceded', width: 14 },
      { header: '7 m saves', width: 10 },
      { header: '7 m faced', width: 10 }
    ],
    s.goalkeepers.map((k) => [k.name, k.teamName, k.matches, k.saves, k.shotsFaced, percent(k.saves, k.shotsFaced), k.goalsConceded, k.sevenMetreSaves, k.sevenMetreFaced]),
    notice
  )
  table(
    wb,
    'Teams',
    [
      { header: 'Team', width: 26 },
      { header: 'Played', width: 8 },
      { header: 'Won', width: 6 },
      { header: 'Drawn', width: 7 },
      { header: 'Lost', width: 6 },
      { header: 'Goals for', width: 10 },
      { header: 'Goals against', width: 13 },
      { header: 'Shooting %', width: 11, percent: true },
      { header: 'Save %', width: 8, percent: true },
      { header: 'Technical faults', width: 15 },
      { header: 'Turnovers', width: 10 },
      { header: 'Steals', width: 8 },
      { header: 'Blocks', width: 8 },
      { header: 'Warnings', width: 9 },
      { header: '2 min', width: 7 },
      { header: 'Disqualifications', width: 16 },
      { header: 'Time-outs', width: 10 }
    ],
    s.teams.map((t) => [t.name, t.played, t.won, t.drawn, t.lost, t.goalsFor, t.goalsConceded, percent(t.goalsFor, t.shots), percent(t.saves, t.saves + t.goalsConceded), t.technicalFaults, t.turnovers, t.steals, t.blocks, t.warnings, t.suspensions, t.disqualifications, t.timeouts]),
    notice
  )
}

/** The statistics page as a workbook, for the filter the viewer chose. */
export async function statisticsWorkbook(s: StatisticsOverviewDTO, organisationName: string, demo: boolean): Promise<Buffer> {
  const wb = newWorkbook(organisationName)
  statisticsSheets(wb, s, demo ? DEMO_NOTICE : '')
  return Buffer.from(await wb.xlsx.writeBuffer())
}

const STAGE_NAMES: Record<string, string> = { round_of_16: 'Round of 16', quarter_final: 'Quarter-final', semi_final: 'Semi-final', third_place: 'Third place', final: 'Final' }

const score = (home: number | null | undefined, away: number | null | undefined) => (home === null || home === undefined || away === null || away === undefined ? null : `${home}:${away}`)

function standingsSheet(wb: ExcelJS.Workbook, r: SeasonReportDTO, notice: string): void {
  table(
    wb,
    'Standings',
    [
      { header: 'Group', width: 8 },
      { header: 'Rank', width: 6 },
      { header: 'Team', width: 28 },
      { header: 'Played', width: 8 },
      { header: 'Won', width: 6 },
      { header: 'Drawn', width: 7 },
      { header: 'Lost', width: 6 },
      { header: 'Goals for', width: 10 },
      { header: 'Goals against', width: 13 },
      { header: 'Difference', width: 11 },
      { header: 'Points', width: 8 },
      { header: 'Note', width: 34 }
    ],
    r.standings.map((t) => [t.groupName || null, t.rank, t.teamName, t.played, t.won, t.drawn, t.lost, t.goalsFor, t.goalsAgainst, t.goalDifference, t.points, t.unresolvedTie ? 'Level on every criterion' : null]),
    notice
  )
}

function fixturesSheet(wb: ExcelJS.Workbook, r: SeasonReportDTO, notice: string): void {
  table(
    wb,
    'Fixtures',
    [
      { header: 'Match', width: 14 },
      { header: 'Date', width: 20 },
      { header: 'Stage', width: 14 },
      { header: 'Round', width: 7 },
      { header: 'Group', width: 7 },
      { header: 'Home', width: 26 },
      { header: 'Away', width: 26 },
      { header: 'Result', width: 8 },
      { header: 'Shoot-out', width: 10 },
      { header: 'Status', width: 16 }
    ],
    r.fixtures.map((m) => [m.matchNumber, DATE_TIME.format(m.scheduledAt), MATCH_STAGE_LABELS[m.stage], m.round, m.groupName, m.home.name, m.away.name, score(m.homeScore, m.awayScore), score(m.homeShootout, m.awayShootout), m.amended ? 'Final (amended)' : m.status]),
    notice
  )
}

function bracketSheet(wb: ExcelJS.Workbook, bracket: BracketDTO, notice: string): void {
  table(
    wb,
    'Bracket',
    [
      { header: 'Stage', width: 14 },
      { header: 'Tie', width: 5 },
      { header: 'Home', width: 26 },
      { header: 'Away', width: 26 },
      { header: 'Result', width: 8 },
      { header: 'Shoot-out', width: 10 },
      { header: 'Winner', width: 26 },
      { header: 'Problem', width: 50 }
    ],
    bracket.ties
      .filter((t) => t.state !== 'bye')
      .map((t) => {
        const winner = [t.home, t.away].find((x) => x?.teamId === t.winnerTeamId)
        return [STAGE_NAMES[t.stage], t.position, t.home?.name ?? t.homeSource, t.away?.name ?? t.awaySource, score(t.match?.homeScore, t.match?.awayScore), score(t.match?.homeShootout, t.match?.awayShootout), winner?.name ?? null, t.problem]
      }),
    notice
  )
}

/** A competition report as a workbook: standings, fixtures, bracket and statistics. */
export async function seasonWorkbook(r: SeasonReportDTO): Promise<Buffer> {
  const wb = newWorkbook(r.organisationName)
  const notice = [r.demo ? DEMO_NOTICE : null, r.inProgress ? `IN PROGRESS - ${r.played} of ${r.scheduled} matches finalized` : null].filter(Boolean).join('; ')
  if (r.standings.length) standingsSheet(wb, r, notice)
  fixturesSheet(wb, r, notice)
  if (r.bracket?.ties.length) bracketSheet(wb, r.bracket, notice)
  statisticsSheets(wb, r.statistics, notice)
  return Buffer.from(await wb.xlsx.writeBuffer())
}
