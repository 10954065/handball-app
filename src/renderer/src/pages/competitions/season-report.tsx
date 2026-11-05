import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FileSpreadsheet, FileText, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { COMPETITION_TYPE_LABELS, MATCH_STAGE_LABELS } from '@shared/domain/constants'
import { percent } from '@shared/domain/statistics'
import type { BracketTieDTO, MatchSummaryDTO, ReportFormat, SeasonReportDTO, StandingRowDTO } from '@shared/dto'
import { Page } from '@/components/layout/shell'
import { Button } from '@/components/ui/button'
import { ErrorNote, Spinner } from '@/components/ui/misc'
import { call, errorMessage } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import { useApi } from '@/lib/query'
import '@/styles/report.css'

const LEADERS = 10

const score = (home: number | null | undefined, away: number | null | undefined) => (home === null || home === undefined || away === null || away === undefined ? '' : `${home}:${away}`)

function GroupTable({ title, rows }: { title: string | null; rows: StandingRowDTO[] }) {
  return (
    <div className="report-keep">
      {title && <h3>{title}</h3>}
      <table>
        <thead>
          <tr>
            <th className="report-num">#</th>
            <th>Team</th>
            <th className="report-num">P</th>
            <th className="report-num">W</th>
            <th className="report-num">D</th>
            <th className="report-num">L</th>
            <th className="report-num">Goals</th>
            <th className="report-num">+/-</th>
            <th className="report-num">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.teamId}>
              <td className="report-num">{r.rank}{r.unresolvedTie && '='}</td>
              <td>{r.teamName}</td>
              <td className="report-num">{r.played}</td>
              <td className="report-num">{r.won}</td>
              <td className="report-num">{r.drawn}</td>
              <td className="report-num">{r.lost}</td>
              <td className="report-num">{r.goalsFor}:{r.goalsAgainst}</td>
              <td className="report-num">{r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}</td>
              <td className="report-num">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Standings({ r }: { r: SeasonReportDTO }) {
  const groups = [...new Set(r.standings.map((s) => s.groupName))]
  const c = r.competition
  return (
    <section className="report-section" aria-label="Standings">
      <h2>Standings</h2>
      {groups.map((g) => (
        <GroupTable key={g || 'all'} title={g ? `Group ${g}` : null} rows={r.standings.filter((s) => s.groupName === g)} />
      ))}
      <p className="report-line">
        <span>
          <strong>Points:</strong> win {c.pointsWin}, draw {c.pointsDraw}, loss {c.pointsLoss}.
        </span>
        {r.standings.some((s) => s.unresolvedTie) && <span>= level on every criterion; the order shown is alphabetical.</span>}
      </p>
    </section>
  )
}

const tieSide = (t: BracketTieDTO, side: 'home' | 'away') => t[side]?.name ?? (side === 'home' ? t.homeSource : t.awaySource) ?? 'Bye'

function Bracket({ r }: { r: SeasonReportDTO }) {
  const ties = r.bracket?.ties.filter((t) => t.state !== 'bye') ?? []
  return (
    <section className="report-section" aria-label="Knockout rounds">
      <h2>Knockout rounds</h2>
      <table>
        <thead>
          <tr>
            <th>Round</th>
            <th>Home</th>
            <th>Away</th>
            <th className="report-num">Result</th>
          </tr>
        </thead>
        <tbody>
          {ties.map((t) => (
            <tr key={t.id}>
              <td>{MATCH_STAGE_LABELS[t.stage]}</td>
              <td>{tieSide(t, 'home')}</td>
              <td>{tieSide(t, 'away')}</td>
              <td className="report-num">
                {score(t.match?.homeScore, t.match?.awayScore)}
                {t.match?.homeShootout !== null && t.match?.homeShootout !== undefined && ` (${t.match.homeShootout}:${t.match.awayShootout})`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.bracket?.champion && (
        <p className="report-line">
          <span>
            <strong>Champion:</strong> {r.bracket.champion.name}
          </span>
        </p>
      )}
      {ties
        .filter((t) => t.problem)
        .map((t) => (
          <p key={t.id} className="report-line">
            <span>
              <strong>{MATCH_STAGE_LABELS[t.stage]} {t.position}:</strong> {t.problem}
            </span>
          </p>
        ))}
    </section>
  )
}

function Fixture({ m }: { m: MatchSummaryDTO }) {
  return (
    <tr>
      <td className="report-time">{m.matchNumber}</td>
      <td>{fmtDate(m.scheduledAt)}</td>
      <td>
        {m.groupName ? `Group ${m.groupName}` : MATCH_STAGE_LABELS[m.stage]}
        {m.round && m.stage !== 'final' ? ` R${m.round}` : ''}
      </td>
      <td>{m.home.name}</td>
      <td>{m.away.name}</td>
      <td className="report-num">
        {score(m.homeScore, m.awayScore)}
        {m.homeShootout !== null && ` (${m.homeShootout}:${m.awayShootout})`}
        {m.amended && ' *'}
      </td>
    </tr>
  )
}

function Fixtures({ r }: { r: SeasonReportDTO }) {
  return (
    <section className="report-section" aria-label="Fixtures and results">
      <h2>Fixtures and results</h2>
      <table className="report-events">
        <thead>
          <tr>
            <th>Match</th>
            <th>Date</th>
            <th>Stage</th>
            <th>Home</th>
            <th>Away</th>
            <th className="report-num">Result</th>
          </tr>
        </thead>
        <tbody>
          {r.fixtures.map((m) => (
            <Fixture key={m.id} m={m} />
          ))}
        </tbody>
      </table>
      {r.fixtures.some((m) => m.amended) && <p className="report-line">* Corrected after finalization.</p>}
    </section>
  )
}

function Leaders({ r }: { r: SeasonReportDTO }) {
  const scorers = r.statistics.players.filter((p) => p.goals > 0).slice(0, LEADERS)
  const keepers = r.statistics.goalkeepers.filter((k) => k.shotsFaced > 0).slice(0, LEADERS)
  const sanctioned = r.statistics.players.filter((p) => p.warnings + p.suspensions + p.disqualifications > 0).sort((a, b) => b.disqualifications - a.disqualifications || b.suspensions - a.suspensions || b.warnings - a.warnings).slice(0, LEADERS)
  return (
    <>
      {scorers.length > 0 && (
        <section className="report-section report-keep" aria-label="Top scorers">
          <h2>Top scorers</h2>
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Team</th>
                <th className="report-num">Matches</th>
                <th className="report-num">Goals</th>
                <th className="report-num">Shooting</th>
              </tr>
            </thead>
            <tbody>
              {scorers.map((p) => (
                <tr key={p.playerId}>
                  <td>{p.name}</td>
                  <td>{p.teamName}</td>
                  <td className="report-num">{p.matches}</td>
                  <td className="report-num">{p.goals}</td>
                  <td className="report-num">{percent(p.goals, p.shots)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {keepers.length > 0 && (
        <section className="report-section report-keep" aria-label="Goalkeepers">
          <h2>Goalkeepers</h2>
          <table>
            <thead>
              <tr>
                <th>Goalkeeper</th>
                <th>Team</th>
                <th className="report-num">Matches</th>
                <th className="report-num">Saves</th>
                <th className="report-num">Save rate</th>
              </tr>
            </thead>
            <tbody>
              {keepers.map((k) => (
                <tr key={k.playerId}>
                  <td>{k.name}</td>
                  <td>{k.teamName}</td>
                  <td className="report-num">{k.matches}</td>
                  <td className="report-num">{k.saves}/{k.shotsFaced}</td>
                  <td className="report-num">{percent(k.saves, k.shotsFaced)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {sanctioned.length > 0 && (
        <section className="report-section report-keep" aria-label="Discipline">
          <h2>Discipline</h2>
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Team</th>
                <th className="report-num">Warnings</th>
                <th className="report-num">2 min</th>
                <th className="report-num">Disqualifications</th>
              </tr>
            </thead>
            <tbody>
              {sanctioned.map((p) => (
                <tr key={p.playerId}>
                  <td>{p.name}</td>
                  <td>{p.teamName}</td>
                  <td className="report-num">{p.warnings}</td>
                  <td className="report-num">{p.suspensions}</td>
                  <td className="report-num">{p.disqualifications}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}

/** The A4 competition report: the same component on screen, in the PDF and on paper. */
export function SeasonReportDocument({ report: r }: { report: SeasonReportDTO }) {
  const c = r.competition
  const facts: [string, string | null][] = [
    ['Format', COMPETITION_TYPE_LABELS[c.type]],
    ['Category', c.category],
    ['Organizer', c.organizer],
    ['Dates', r.season.startDate ? `${fmtDate(new Date(r.season.startDate).getTime())} to ${fmtDate(new Date(r.season.endDate ?? r.season.startDate).getTime())}` : null],
    ['Matches finalized', `${r.played} of ${r.scheduled}`]
  ]
  return (
    <article className="report" data-testid="season-report">
      {r.demo && <p className="report-notice report-notice-danger">Demonstration data - not an official record</p>}
      {r.inProgress && <p className="report-notice">In progress - {r.played} of {r.scheduled} matches finalized</p>}
      <header>
        <div className="report-title">
          <div>
            {r.organisationName && <p className="report-org">{r.organisationName}</p>}
            <h1>{c.name}</h1>
          </div>
          <p className="report-number">{r.season.name}</p>
        </div>
        <dl className="report-facts">
          {facts
            .filter(([, value]) => !!value)
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>
      </header>
      {r.standings.length > 0 && <Standings r={r} />}
      {!!r.bracket?.ties.length && <Bracket r={r} />}
      <Leaders r={r} />
      <Fixtures r={r} />
      <footer>
        {r.footerNote && <p>{r.footerNote}</p>}
        <p>Calculated from the event ledgers of finalized matches. Only finalized matches count.</p>
      </footer>
    </article>
  )
}

type Action = ReportFormat | 'print'

export function SeasonReportPage() {
  const { id = '', seasonId = '' } = useParams()
  const q = useApi('seasons.report', { seasonId }, { staleTime: 0 })
  const [busy, setBusy] = useState<Action | null>(null)
  const run = async (action: Action, work: () => Promise<void>) => {
    setBusy(action)
    try {
      await work()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  const save = (format: ReportFormat) =>
    run(format, async () => {
      const saved = await call('seasons.saveReport', { seasonId, format })
      if (saved) toast.success(`Saved to ${saved.path}`)
    })
  const print = () =>
    run('print', async () => {
      await call('seasons.printReport', { seasonId })
    })
  const back = (
    <Link to={`/competitions/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
      <ArrowLeft className="size-4" /> Competition
    </Link>
  )
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) {
    return (
      <Page>
        {back}
        <ErrorNote error={q.error} />
      </Page>
    )
  }
  return (
    <Page>
      {back}
      <div className="mb-4 flex flex-wrap gap-2">
        <Button disabled={!!busy} onClick={() => void save('pdf')}>
          <FileText /> {busy === 'pdf' ? 'Preparing PDF...' : 'Save PDF'}
        </Button>
        <Button variant="secondary" disabled={!!busy} onClick={() => void save('xlsx')}>
          <FileSpreadsheet /> Save Excel
        </Button>
        <Button variant="secondary" disabled={!!busy} onClick={() => void print()}>
          <Printer /> Print
        </Button>
      </div>
      <div className="report-sheet">
        <SeasonReportDocument report={q.data} />
      </div>
    </Page>
  )
}
