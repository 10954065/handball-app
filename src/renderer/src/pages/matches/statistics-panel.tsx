import { percent } from '@shared/domain/statistics'
import type { MatchReportDTO, ReportSideDTO } from '@shared/dto'
import { ScoreFlowChart } from '@/components/domain/charts'
import { ErrorNote, Panel, PanelHeader, Spinner } from '@/components/ui/misc'
import { useApi } from '@/lib/query'

const MINUTE = 60_000

interface CompareRowProps {
  label: string
  home: number
  away: number
  /** Printed beside the value, such as a rate. */
  note?: (s: 'home' | 'away') => string
}

function CompareRow({ label, home, away, note }: CompareRowProps) {
  const most = Math.max(home, away, 1)
  const bar = (v: number, color: string, align: string) => (
    <div className={`flex h-1.5 flex-1 ${align} rounded-full bg-surface-3`}>
      <div className="h-full rounded-full" style={{ width: `${(v / most) * 100}%`, background: color }} />
    </div>
  )
  return (
    <li className="px-5 py-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold tabular">
          {home} <span className="text-xs font-normal text-faint">{note?.('home')}</span>
        </span>
        <span className="text-xs text-muted">{label}</span>
        <span className="font-semibold tabular">
          <span className="text-xs font-normal text-faint">{note?.('away')}</span> {away}
        </span>
      </div>
      <div className="mt-1 flex gap-1">
        {bar(home, 'var(--chart-home)', 'justify-end')}
        {bar(away, 'var(--chart-away)', 'justify-start')}
      </div>
    </li>
  )
}

function Comparison({ r }: { r: MatchReportDTO }) {
  const rate = (of: (s: ReportSideDTO) => number | null) => (side: 'home' | 'away') => {
    const v = of(r[side])
    return v === null ? '' : `${v}%`
  }
  const row = (label: string, of: (s: ReportSideDTO) => number, note?: CompareRowProps['note']) => <CompareRow key={label} label={label} home={of(r.home)} away={of(r.away)} note={note} />
  return (
    <ul className="divide-y divide-border/60">
      {row('Goals', (s) => s.stats.goals, rate((s) => percent(s.stats.goals, s.stats.shots)))}
      {row('Shots', (s) => s.stats.shots)}
      {row('7 m goals', (s) => s.stats.sevenMetreGoals)}
      {row('Saves', (s) => s.stats.saves, rate((s) => percent(s.stats.saves, s.stats.saves + s.stats.goalsConceded)))}
      {row('Technical faults', (s) => s.stats.technicalFaults)}
      {row('Turnovers', (s) => s.stats.turnovers)}
      {row('Steals', (s) => s.stats.steals)}
      {row('Blocks', (s) => s.stats.blocks)}
      {row('2-minute suspensions', (s) => s.stats.suspensions)}
    </ul>
  )
}

/** Score flow and team comparison of a finalized match, from the same data as its report. */
export function MatchStatisticsPanel({ matchId }: { matchId: string }) {
  const q = useApi('reports.get', { matchId }, { staleTime: 0 })
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <ErrorNote error={q.error} />
  const r = q.data
  const regularEnd = r.match.rules.periodMinutes * 2 * MINUTE
  return (
    <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Panel>
        <PanelHeader title="Score flow" subtitle={r.biggestLead ? `Biggest lead: ${r[r.biggestLead.side].name} by ${r.biggestLead.goals}` : 'No goals were scored.'} />
        <div className="px-5 py-4">
          <ScoreFlowChart flow={r.flow} endMs={regularEnd} home={r.home.name} away={r.away.name} />
          {r.periods.length > 0 && (
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {r.periods.map((p) => (
                <div key={p.label} className="flex gap-2">
                  <dt className="text-muted">{p.label}</dt>
                  <dd className="font-semibold tabular">
                    {p.home}:{p.away}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="Team comparison" subtitle={`${r.home.code} on the left, ${r.away.code} on the right.`} />
        <Comparison r={r} />
      </Panel>
    </div>
  )
}
