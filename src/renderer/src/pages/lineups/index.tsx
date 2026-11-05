import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ClipboardList } from 'lucide-react'
import { Page } from '@/components/layout/shell'
import { TeamCrest } from '@/components/domain/identity'
import { ErrorNote, Spinner } from '@/components/ui/misc'
import { fmtDateTime } from '@/lib/format'
import { useApi } from '@/lib/query'
import { useSession } from '@/lib/session'
import { LineupSummary } from './summary'
import { SideEditor } from './side-editor'

export function LineupsPage() {
  const { id = '' } = useParams()
  const { can } = useSession()
  const q = useApi('lineups.get', { id })
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <Page><ErrorNote error={q.error} /></Page>
  const s = q.data
  const m = s.match
  const bothConfirmed = !!s.home.confirmedAt && !!s.away.confirmedAt

  return (
    <Page wide>
      <Link to={`/matches/${m.id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Match {m.matchNumber}
      </Link>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="grid size-11 place-items-center rounded-lg border border-border bg-surface-2 text-primary">
          <ClipboardList className="size-5" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-[28px] font-semibold leading-none tracking-wide">Match sheet & starting lineups</h1>
          <p className="mt-1.5 flex items-center gap-2 text-sm text-muted">
            <TeamCrest logoMediaId={m.home.logoMediaId} code={m.home.code} color={m.home.color} size={20} /> {m.home.name}
            <span className="text-faint">vs</span>
            <TeamCrest logoMediaId={m.away.logoMediaId} code={m.away.code} color={m.away.color} size={20} /> {m.away.name}
            <span className="text-faint">- {fmtDateTime(m.scheduledAt)}</span>
          </p>
        </div>
        {s.locked && <span className="text-sm text-muted">The match has started. The match sheet is read-only.</span>}
      </div>
      {bothConfirmed && (
        <div className="mb-5 overflow-hidden rounded-2xl border border-goal/40">
          <div className="flex items-center gap-3 border-b border-goal/25 bg-goal/10 px-5 py-3">
            <CheckCircle2 className="size-5 text-goal" />
            <span className="font-semibold">Both lineups confirmed - final match confirmation</span>
            <span className="text-sm text-muted">Check both starting sevens with the team officials before the throw-off.</span>
          </div>
          <div className="grid grid-cols-1 gap-px bg-border lg:grid-cols-2">
            <LineupSummary side={s.home} />
            <LineupSummary side={s.away} />
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SideEditor key={`home-${s.home.confirmedAt ?? 'd'}-${s.home.entries.length}`} matchId={m.id} side={s.home} rules={m.rules} locked={s.locked} canEdit={can('operate_match')} />
        <SideEditor key={`away-${s.away.confirmedAt ?? 'd'}-${s.away.entries.length}`} matchId={m.id} side={s.away} rules={m.rules} locked={s.locked} canEdit={can('operate_match')} />
      </div>
    </Page>
  )
}
