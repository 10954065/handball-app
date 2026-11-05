import { MATCH_STAGE_LABELS } from '@shared/domain/constants'
import { percent } from '@shared/domain/statistics'
import type { MatchReportDTO, ReportOfficialDTO, ReportPlayerDTO, ReportSideDTO } from '@shared/dto'
import { TeamCrest } from '@/components/domain/identity'
import { fmtDateTime } from '@/lib/format'
import '@/styles/report.css'

const rate = (part: number, whole: number) => {
  const p = percent(part, whole)
  return p === null ? '-' : `${p}%`
}

const DECIDED: Record<string, string> = { overtime: 'After overtime', shootout: 'After penalty shoot-out' }

function Notices({ r }: { r: MatchReportDTO }) {
  return (
    <>
      {r.demo && <p className="report-notice report-notice-danger">Demonstration data - not an official record</p>}
      {r.state === 'provisional' && <p className="report-notice">Provisional - this match has not been finalized</p>}
      {r.match.amended && <p className="report-notice">Amended after finalization - see the corrections in this report</p>}
    </>
  )
}

function Header({ r }: { r: MatchReportDTO }) {
  const m = r.match
  const facts: [string, string | number | null][] = [
    ['Competition', m.competitionName ?? 'Friendly'],
    ['Stage', `${MATCH_STAGE_LABELS[m.stage]}${m.round ? `, round ${m.round}` : ''}${m.groupName ? `, group ${m.groupName}` : ''}`],
    ['Season', m.seasonName],
    ['Date and time', fmtDateTime(m.scheduledAt)],
    ['Venue', m.venueName],
    ['Spectators', r.spectators]
  ]
  return (
    <header>
      <div className="report-title">
        <div>
          {r.organisationName && <p className="report-org">{r.organisationName}</p>}
          <h1>{r.headerTitle}</h1>
        </div>
        <p className="report-number">{m.matchNumber}</p>
      </div>
      <dl className="report-facts">
        {facts
          .filter(([, value]) => value !== null && value !== '')
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
    </header>
  )
}

function Team({ s, showLogo }: { s: ReportSideDTO; showLogo: boolean }) {
  return (
    <div className={`report-team report-team-${s.side}`}>
      {showLogo && <TeamCrest logoMediaId={s.logoMediaId} code={s.code} color={s.color} size={44} />}
      <span>{s.name}</span>
    </div>
  )
}

function Result({ r }: { r: MatchReportDTO }) {
  const { home, away } = r
  return (
    <section className="report-result" aria-label="Result">
      <Team s={home} showLogo={r.showLogos} />
      <div className="report-score">
        <strong>
          {home.score}:{away.score}
        </strong>
        {home.halfTime !== null && (
          <span>
            Half-time {home.halfTime}:{away.halfTime}
          </span>
        )}
        {home.shootout && away.shootout && (
          <span>
            Shoot-out {home.shootout.goals}:{away.shootout.goals}
          </span>
        )}
        {r.decidedBy && DECIDED[r.decidedBy] && <span>{DECIDED[r.decidedBy]}</span>}
      </div>
      <Team s={away} showLogo={r.showLogos} />
    </section>
  )
}

const times = (list: string[]) => list.join(' ') || ''

function Sanctions({ p }: { p: Pick<ReportPlayerDTO, 'warningsAt' | 'suspensionsAt' | 'disqualifiedAt' | 'blueCard'> }) {
  return (
    <>
      <td className="report-time">{times(p.warningsAt)}</td>
      <td className="report-time">{times(p.suspensionsAt)}</td>
      <td className="report-time">
        {p.disqualifiedAt}
        {p.blueCard && ' (blue)'}
      </td>
    </>
  )
}

function PlayerRow({ p }: { p: ReportPlayerDTO }) {
  const t = p.stats
  return (
    <tr className={p.played ? undefined : 'report-faint'}>
      <td className="report-num">{p.jerseyNumber}</td>
      <td>
        {p.name}
        {p.isCaptain && ' (C)'}
        {p.isGoalkeeper && ' (GK)'}
      </td>
      <td className="report-num">{t.goals || ''}</td>
      <td className="report-num">{t.shots || ''}</td>
      <td className="report-num">{t.sevenMetreShots ? `${t.sevenMetreGoals}/${t.sevenMetreShots}` : ''}</td>
      <td className="report-num">{t.assists || ''}</td>
      <Sanctions p={p} />
    </tr>
  )
}

const OfficialRow = ({ o }: { o: ReportOfficialDTO }) => (
  <tr>
    <td className="report-num">{o.slot}</td>
    <td colSpan={5}>
      {o.name} <span className="report-faint">{o.role}</span>
    </td>
    <Sanctions p={o} />
  </tr>
)

function TeamSheet({ s }: { s: ReportSideDTO }) {
  const keepers = s.players.filter((p) => (p.isGoalkeeper && p.played) || p.stats.shotsFaced > 0)
  return (
    <section className="report-section" aria-label={`${s.name} match sheet`}>
      <h2 style={{ borderColor: s.color }}>
        {s.name} <small>{s.code}</small>
      </h2>
      <table>
        <thead>
          <tr>
            <th className="report-num">#</th>
            <th>Player</th>
            <th className="report-num">Goals</th>
            <th className="report-num">Shots</th>
            <th className="report-num">7 m</th>
            <th className="report-num">Assists</th>
            <th>Warning</th>
            <th>2 min</th>
            <th>Disqual.</th>
          </tr>
        </thead>
        <tbody>
          {s.players.map((p) => (
            <PlayerRow key={p.rosterId} p={p} />
          ))}
          {s.officials.map((o) => (
            <OfficialRow key={o.slot} o={o} />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Team total</td>
            <td className="report-num">{s.stats.goals}</td>
            <td className="report-num">{s.stats.shots}</td>
            <td className="report-num">
              {s.stats.sevenMetreGoals}/{s.stats.sevenMetreShots}
            </td>
            <td className="report-num">{s.players.reduce((n, p) => n + p.stats.assists, 0)}</td>
            <td>{s.stats.warnings}</td>
            <td>{s.stats.suspensions}</td>
            <td>{s.stats.disqualifications}</td>
          </tr>
        </tfoot>
      </table>
      <p className="report-line">
        <span>
          <strong>Team time-outs:</strong> {s.timeoutsAt.join(', ') || 'none'}
        </span>
        {keepers.map((k) => (
          <span key={k.rosterId}>
            <strong>
              GK #{k.jerseyNumber} {k.name}:
            </strong>{' '}
            {k.stats.saves} saves of {k.stats.shotsFaced} ({rate(k.stats.saves, k.stats.shotsFaced)})
          </span>
        ))}
      </p>
    </section>
  )
}

function TeamStatistics({ r }: { r: MatchReportDTO }) {
  const { home, away } = r
  const row = (label: string, of: (s: ReportSideDTO) => string | number) => (
    <tr key={label}>
      <td className="report-num">{of(home)}</td>
      <td className="report-center">{label}</td>
      <td className="report-num">{of(away)}</td>
    </tr>
  )
  return (
    <section className="report-section report-keep" aria-label="Team statistics">
      <h2>Team statistics</h2>
      <table className="report-compare">
        <thead>
          <tr>
            <th className="report-num">{home.code}</th>
            <th className="report-center">Statistic</th>
            <th className="report-num">{away.code}</th>
          </tr>
        </thead>
        <tbody>
          {row('Shooting', (s) => `${s.stats.goals}/${s.stats.shots} (${rate(s.stats.goals, s.stats.shots)})`)}
          {row('7 m throws', (s) => `${s.stats.sevenMetreGoals}/${s.stats.sevenMetreShots}`)}
          {row('Goalkeeper saves', (s) => `${s.stats.saves} (${rate(s.stats.saves, s.stats.saves + s.stats.goalsConceded)})`)}
          {row('Technical faults', (s) => s.stats.technicalFaults)}
          {row('Turnovers', (s) => s.stats.turnovers)}
          {row('Steals', (s) => s.stats.steals)}
          {row('Blocks', (s) => s.stats.blocks)}
        </tbody>
      </table>
      {r.periods.length > 0 && (
        <p className="report-line">
          <span>
            <strong>Goals by period:</strong> {r.periods.map((p) => `${p.label} ${p.home}:${p.away}`).join(', ')}
          </span>
          {r.biggestLead && (
            <span>
              <strong>Biggest lead:</strong> {r[r.biggestLead.side].code} by {r.biggestLead.goals}
            </span>
          )}
        </p>
      )}
    </section>
  )
}

function Timeline({ r }: { r: MatchReportDTO }) {
  const code = (side: string | null) => (side === 'home' ? r.home.code : side === 'away' ? r.away.code : '')
  return (
    <section className="report-section" aria-label="Match timeline">
      <h2>Match timeline</h2>
      <table className="report-events">
        <thead>
          <tr>
            <th>Time</th>
            <th>Team</th>
            <th>Event</th>
            <th>Player or official</th>
            <th className="report-num">Score</th>
          </tr>
        </thead>
        <tbody>
          {r.timeline
            .filter((e) => e.key)
            .map((e) => (
              <tr key={e.id}>
                <td className="report-time">{e.periodLabel === 'PS' ? 'PS' : e.time}</td>
                <td>{code(e.side)}</td>
                <td>{e.title}</td>
                <td>{e.who}</td>
                <td className="report-num">{e.score}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  )
}

function Corrections({ r }: { r: MatchReportDTO }) {
  return (
    <section className="report-section" aria-label="Corrections">
      <h2>Corrections</h2>
      <table className="report-events">
        <thead>
          <tr>
            <th>Time</th>
            <th>Entry</th>
            <th>Reason</th>
            <th>Corrected by</th>
          </tr>
        </thead>
        <tbody>
          {r.corrections.map((c) => (
            <tr key={c.id}>
              <td className="report-time">{c.time}</td>
              <td>
                {c.kind === 'voided' ? 'Voided: ' : ''}
                {c.title} {c.who}
              </td>
              <td>{c.reason}</td>
              <td>{c.by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

const BLANK_SIGNERS = ['Referee', 'Referee', 'Timekeeper', 'Scorekeeper'].map((role) => ({ role, name: '' }))

function Signatures({ r }: { r: MatchReportDTO }) {
  const signers = r.match.officials.length ? r.match.officials : BLANK_SIGNERS
  return (
    <section className="report-section report-keep" aria-label="Signatures">
      <h2>Officials and signatures</h2>
      <div className="report-signatures">
        {signers.map((s, i) => (
          <div key={`${s.role}-${i}`}>
            <span className="report-signline" />
            <p>
              {s.name && <strong>{s.name}</strong>} {s.role}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

/** The A4 match report. The same component is the on-screen preview, the PDF and the printout. */
export function MatchReportDocument({ report: r }: { report: MatchReportDTO }) {
  return (
    <article className="report" data-testid="match-report">
      <Notices r={r} />
      <Header r={r} />
      <Result r={r} />
      <TeamSheet s={r.home} />
      <TeamSheet s={r.away} />
      {r.includeStatistics && <TeamStatistics r={r} />}
      {r.includeTimeline && <Timeline r={r} />}
      {r.corrections.length > 0 && <Corrections r={r} />}
      <Signatures r={r} />
      <footer>
        {r.footerNote && <p>{r.footerNote}</p>}
        {r.finalizedAt && (
          <p>
            Finalized {fmtDateTime(r.finalizedAt)}
            {r.finalizedBy && ` by ${r.finalizedBy}`}.
          </p>
        )}
        <p>
          Calculated from the match event ledger: {r.ledger.events} entries, {r.ledger.voided} voided. Fingerprint <span className="report-digest">{r.ledger.digest.slice(0, 16)}</span>
        </p>
      </footer>
    </article>
  )
}
