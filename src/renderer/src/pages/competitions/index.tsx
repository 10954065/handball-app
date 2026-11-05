import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trophy } from 'lucide-react'
import { COMPETITION_TYPE_LABELS } from '@shared/domain/constants'
import { Page } from '@/components/layout/shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader, Spinner } from '@/components/ui/misc'
import { useApi } from '@/lib/query'
import { useSession } from '@/lib/session'
import { CompetitionDialog } from './competition-form'

export function CompetitionsPage() {
  const { can } = useSession()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const list = useApi('competitions.list', { includeArchived: true })

  return (
    <Page>
      <PageHeader
        icon={Trophy}
        title="Competitions"
        subtitle="Leagues, knockout cups and tournaments with their seasons, teams and rules."
        actions={can('manage_data') && <Button onClick={() => setCreating(true)}><Plus /> Create competition</Button>}
      />
      {list.isLoading ? (
        <Spinner />
      ) : !list.data?.length ? (
        <EmptyState icon={Trophy} title="No competitions yet" message="Create a league, cup or tournament to schedule fixtures and track standings." action={can('manage_data') && <Button onClick={() => setCreating(true)}><Plus /> Create competition</Button>} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {list.data.map((c) => {
            const current = c.seasons.find((s) => s.status === 'active') ?? c.seasons[0]
            return (
              <button key={c.id} onClick={() => navigate(`/competitions/${c.id}`)} className={`rounded-xl border border-border bg-surface-1 p-5 text-left transition-colors hover:border-border-strong hover:bg-surface-2 ${c.archived ? 'opacity-55' : ''}`}>
                <div className="flex items-start gap-4">
                  <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold"><Trophy className="size-6" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-xl font-semibold tracking-wide">{c.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone="gold">{COMPETITION_TYPE_LABELS[c.type]}</Badge>
                      {c.category && <Badge>{c.category}</Badge>}
                      {c.archived && <Badge>Archived</Badge>}
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-muted">
                  <div><div className="text-faint">Current season</div><div className="mt-0.5 font-medium text-text">{current?.name ?? 'None'}</div></div>
                  <div><div className="text-faint">Teams</div><div className="mt-0.5 font-medium text-text tabular">{current?.teams.length ?? 0}</div></div>
                  <div><div className="text-faint">Rules</div><div className="mt-0.5 truncate font-medium text-text">{c.rules.periodMinutes * 2} min</div></div>
                </div>
              </button>
            )
          })}
        </div>
      )}
      {creating && <CompetitionDialog onClose={() => setCreating(false)} onSaved={(id) => navigate(`/competitions/${id}`)} />}
    </Page>
  )
}
