import type { ReactNode } from 'react'
import { CalendarClock, MapPin, Trophy } from 'lucide-react'
import { MATCH_STAGE_LABELS } from '@shared/domain/constants'
import type { MatchSummaryDTO } from '@shared/dto'
import { Badge } from '@/components/ui/badge'
import { fmtDateTime } from '@/lib/format'
import { TeamCrest } from './identity'
import { MATCH_STATUS } from './match-row'

/** Match identity banner: both teams, score or "vs", date, venue and competition. */
export function MatchHeader({ m, actions }: { m: MatchSummaryDTO; actions?: ReactNode }) {
  const played = m.homeScore !== null && m.awayScore !== null
  const comp = m.competitionName
    ? `${m.competitionName}${m.seasonName ? ` ${m.seasonName}` : ''} - ${MATCH_STAGE_LABELS[m.stage]}${m.round ? ` round ${m.round}` : ''}${m.groupName ? ` group ${m.groupName}` : ''}`
    : 'Friendly'
  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-surface-1">
      <div className="absolute inset-y-0 left-0 w-1/2 opacity-[0.14]" style={{ background: `linear-gradient(90deg, ${m.home.color}, transparent)` }} />
      <div className="absolute inset-y-0 right-0 w-1/2 opacity-[0.14]" style={{ background: `linear-gradient(270deg, ${m.away.color}, transparent)` }} />
      <div className="relative px-8 pb-6 pt-5">
        <div className="flex items-center justify-between text-xs text-muted">
          <span className="font-mono">{m.matchNumber}</span>
          <Badge tone={MATCH_STATUS[m.status].tone}>{MATCH_STATUS[m.status].label}</Badge>
        </div>
        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-8">
          <div className="flex items-center justify-end gap-5">
            <div className="text-right font-display text-3xl font-bold tracking-wide">{m.home.name}</div>
            <TeamCrest logoMediaId={m.home.logoMediaId} code={m.home.code} color={m.home.color} size={84} />
          </div>
          <div className="text-center font-display text-6xl font-bold tabular">
            {played ? `${m.homeScore} : ${m.awayScore}` : <span className="text-4xl text-faint">vs</span>}
          </div>
          <div className="flex items-center gap-5">
            <TeamCrest logoMediaId={m.away.logoMediaId} code={m.away.code} color={m.away.color} size={84} />
            <div className="font-display text-3xl font-bold tracking-wide">{m.away.name}</div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted">
          <span className="flex items-center gap-1.5"><CalendarClock className="size-4" /> {fmtDateTime(m.scheduledAt)}</span>
          <span className="flex items-center gap-1.5"><MapPin className="size-4" /> {m.venueName ?? 'Venue not set'}</span>
          <span className="flex items-center gap-1.5"><Trophy className="size-4" /> {comp}</span>
        </div>
      </div>
      {actions && <div className="relative flex gap-2 border-t border-border px-8 py-3">{actions}</div>}
    </div>
  )
}
