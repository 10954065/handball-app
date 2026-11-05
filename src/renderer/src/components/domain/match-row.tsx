import { Link } from 'react-router-dom'
import { MATCH_STAGE_LABELS } from '@shared/domain/constants'
import type { MatchSummaryDTO } from '@shared/dto'
import { Badge } from '@/components/ui/badge'
import { fmtDate, fmtTime } from '@/lib/format'
import { TeamCrest } from './identity'

export const MATCH_STATUS = {
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  ready: { label: 'Lineups ready', tone: 'primary' },
  live: { label: 'Live', tone: 'danger' },
  finished: { label: 'Final', tone: 'success' },
  abandoned: { label: 'Abandoned', tone: 'warning' }
} as const

/** One fixture or result line. */
export function MatchRow({ m, to }: { m: MatchSummaryDTO; to?: string }) {
  const s = MATCH_STATUS[m.status]
  const played = m.homeScore !== null && m.awayScore !== null
  return (
    <Link
      to={to ?? `/matches/${m.id}`}
      className="grid grid-cols-[minmax(96px,140px)_minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2"
    >
      <div className="min-w-0 text-xs leading-tight text-muted">
        <div className="font-medium text-text">
          {fmtDate(m.scheduledAt)} <span className="tabular text-muted">{fmtTime(m.scheduledAt)}</span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-faint">
          {m.competitionName ? `${m.competitionName} - ${MATCH_STAGE_LABELS[m.stage]}${m.round ? ` R${m.round}` : ''}` : 'Friendly'}
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-3">
        <span className={`line-clamp-2 text-right font-medium leading-tight ${played && m.winnerSide !== 'home' ? 'text-muted' : ''}`}>{m.home.name}</span>
        <TeamCrest logoMediaId={m.home.logoMediaId} code={m.home.code} color={m.home.color} size={30} />
      </div>
      <div className="min-w-16 text-center">
        {played ? (
          <div className="font-display text-2xl font-bold tabular">
            {m.homeScore}
            <span className="mx-1.5 text-faint">:</span>
            {m.awayScore}
            {m.homeShootout !== null && <div className="text-[10px] font-medium uppercase tracking-wider text-muted">PS {m.homeShootout}:{m.awayShootout}</div>}
          </div>
        ) : (
          <span className="text-sm font-semibold text-faint">vs</span>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <TeamCrest logoMediaId={m.away.logoMediaId} code={m.away.code} color={m.away.color} size={30} />
        <span className={`line-clamp-2 font-medium leading-tight ${played && m.winnerSide !== 'away' ? 'text-muted' : ''}`}>{m.away.name}</span>
      </div>
      <Badge tone={m.amended ? 'warning' : s.tone} className="justify-self-end">
        {m.amended ? 'Final (amended)' : s.label}
      </Badge>
    </Link>
  )
}
