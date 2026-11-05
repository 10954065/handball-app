import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { emptyPlayerTally, liveTallies } from '../../src/shared/domain/tally'
import type { MatchReportDTO, ReportSideDTO } from '../../src/shared/dto'
import { StatTable, type StatColumn } from '@/components/domain/stat-table'
import { MatchReportDocument } from '@/pages/reports/document'

interface Row {
  name: string
  goals: number
  rate: number | null
}

const COLUMNS: StatColumn<Row>[] = [
  { key: 'goals', label: 'G', title: 'Goals', value: (r) => r.goals },
  { key: 'rate', label: 'S%', title: 'Shooting', percent: true, value: (r) => r.rate }
]

const names = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)

describe('StatTable', () => {
  const rows: Row[] = [
    { name: 'Low', goals: 1, rate: 25.5 },
    { name: 'Nothing', goals: 2, rate: null },
    { name: 'High', goals: 5, rate: 100 }
  ]
  const table = () => render(<StatTable label="Test" nameHeader="Player" rows={rows} rowKey={(r) => r.name} name={(r) => r.name} columns={COLUMNS} initialSort="goals" />)

  it('sorts by the initial column, then by any header, and back', async () => {
    table()
    expect(names()).toEqual(['High', 'Nothing', 'Low'])
    await userEvent.click(screen.getByRole('button', { name: 'G' }))
    expect(names()).toEqual(['Low', 'Nothing', 'High'])
    expect(screen.getByRole('columnheader', { name: 'G' })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('shows a rate with nothing to measure as a dash and sorts it last in both directions', async () => {
    table()
    await userEvent.click(screen.getByRole('button', { name: 'S%' }))
    expect(names()).toEqual(['High', 'Low', 'Nothing'])
    expect(screen.getByRole('cell', { name: '25.5%' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '-' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'S%' }))
    expect(names()).toEqual(['Low', 'High', 'Nothing'])
  })
})

const side = (s: 'home' | 'away', name: string, score: number): ReportSideDTO => ({
  side: s,
  teamId: s,
  name,
  code: name.slice(0, 3).toUpperCase(),
  color: '#c00000',
  logoMediaId: null,
  score,
  halfTime: null,
  shootout: null,
  stats: liveTallies([]).teams[s],
  shooting: { situations: [], zones: [] },
  timeoutsAt: [],
  players: [
    {
      rosterId: `${s}-9`,
      playerId: `${s}-p9`,
      jerseyNumber: 9,
      name: `${name} Nine`,
      isGoalkeeper: false,
      isCaptain: true,
      isStarting: true,
      played: true,
      stats: { ...emptyPlayerTally(), goals: score, shots: score },
      warningsAt: [],
      suspensionsAt: ['12:30', '40:00'],
      disqualifiedAt: '41:15',
      blueCard: true
    }
  ],
  officials: []
})

const report = (over: Partial<MatchReportDTO> = {}): MatchReportDTO =>
  ({
    match: { matchNumber: 'M-1', stage: 'friendly', round: null, groupName: null, competitionName: null, seasonName: null, scheduledAt: 1_800_000_000_000, venueName: null, amended: false, officials: [{ officialId: 'o', name: 'Ref One', role: 'Referee' }] },
    state: 'final',
    demo: false,
    organisationName: 'Ghana Handball Association',
    headerTitle: 'Official Match Report',
    footerNote: 'Send signed copies to the secretariat.',
    showLogos: false,
    includeStatistics: true,
    includeTimeline: true,
    decidedBy: 'regular',
    spectators: null,
    finalizedAt: null,
    finalizedBy: null,
    home: side('home', 'Lions', 3),
    away: side('away', 'Royals', 2),
    periods: [],
    flow: [],
    biggestLead: null,
    timeline: [],
    corrections: [],
    ledger: { digest: 'abcdef0123456789abcdef', events: 12, voided: 0 },
    ...over
  }) as MatchReportDTO

describe('MatchReportDocument', () => {
  it('prints the result, sanction times, signatures and the ledger fingerprint', () => {
    render(<MatchReportDocument report={report()} />)
    expect(screen.getByRole('region', { name: 'Result' })).toHaveTextContent('3:2')
    expect(screen.getByRole('heading', { name: 'Official Match Report' })).toBeInTheDocument()
    expect(screen.getByText('Ghana Handball Association')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Lions match sheet' })).toHaveTextContent('12:30 40:00')
    expect(screen.getByRole('region', { name: 'Lions match sheet' })).toHaveTextContent('41:15 (blue)')
    expect(screen.getByRole('region', { name: 'Signatures' })).toHaveTextContent('Ref One Referee')
    expect(screen.getByText('abcdef0123456789')).toBeInTheDocument()
    expect(screen.getByText('Send signed copies to the secretariat.')).toBeInTheDocument()
  })

  it('leaves an official report unmarked and without a corrections section when there are none', () => {
    render(<MatchReportDocument report={report()} />)
    expect(screen.queryByText(/Demonstration data/)).toBeNull()
    expect(screen.queryByText(/Provisional/)).toBeNull()
    expect(screen.queryByText(/Amended/)).toBeNull()
    expect(screen.queryByRole('region', { name: 'Corrections' })).toBeNull()
  })

  it('marks demonstration data, provisional and amended reports', () => {
    const r = report({ demo: true, state: 'provisional' })
    render(<MatchReportDocument report={{ ...r, match: { ...r.match, amended: true } }} />)
    expect(screen.getByText(/Demonstration data - not an official record/)).toBeInTheDocument()
    expect(screen.getByText(/Provisional - this match has not been finalized/)).toBeInTheDocument()
    expect(screen.getByText(/Amended after finalization/)).toBeInTheDocument()
  })

  it('leaves out the sections the settings turn off, but never the corrections', () => {
    const correction = { id: 'c', time: '10:00', title: 'Goal', who: '#9 Nine', kind: 'voided' as const, reason: 'Wrong team', by: 'Ama' }
    render(<MatchReportDocument report={report({ includeStatistics: false, includeTimeline: false, corrections: [correction] })} />)
    expect(screen.queryByRole('region', { name: 'Team statistics' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Match timeline' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Corrections' })).toHaveTextContent('Wrong team')
  })
})
