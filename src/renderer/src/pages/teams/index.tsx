import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, Plus, Shield, Users } from 'lucide-react'
import { Page } from '@/components/layout/shell'
import { TeamCrest } from '@/components/domain/identity'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/misc'
import { SearchBox } from '@/components/ui/table'
import { useApi } from '@/lib/query'
import { useSession } from '@/lib/session'
import { TeamFormDialog } from './team-form'

export function TeamsPage() {
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const { can } = useSession()
  const navigate = useNavigate()
  const teams = useApi('teams.list', { search: search || undefined, includeArchived: archived })

  return (
    <Page>
      <PageHeader
        icon={Shield}
        title="Teams"
        subtitle="Registered teams, colours, staff and rosters."
        actions={
          can('manage_data') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Register team
            </Button>
          )
        }
      />
      <div className="mb-5 flex items-center gap-3">
        <SearchBox value={search} onChange={setSearch} placeholder="Search by name, code, club or region" className="w-96" />
        <Button variant={archived ? 'subtle' : 'ghost'} size="sm" onClick={() => setArchived((a) => !a)}>
          <Archive /> {archived ? 'Showing archived' : 'Show archived'}
        </Button>
      </div>
      {teams.isLoading ? (
        <Spinner />
      ) : teams.error ? (
        <ErrorNote error={teams.error} />
      ) : !teams.data?.length ? (
        <EmptyState
          icon={Shield}
          title={search ? 'No teams match your search' : 'No teams registered yet'}
          message={search ? undefined : 'Register the first team to start building rosters and fixtures.'}
          action={can('manage_data') && !search && <Button onClick={() => setCreating(true)}><Plus /> Register team</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {teams.data.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(`/teams/${t.id}`)}
              className="group relative overflow-hidden rounded-xl border border-border bg-surface-1 p-5 text-left transition-colors hover:border-border-strong hover:bg-surface-2"
            >
              <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${t.primaryColor}, ${t.secondaryColor})` }} />
              <div className="flex items-center gap-4">
                <TeamCrest logoMediaId={t.logoMediaId} code={t.code} color={t.primaryColor} size={56} />
                <div className="min-w-0">
                  <div className="truncate font-display text-xl font-semibold tracking-wide">{t.name}</div>
                  <div className="mt-0.5 truncate text-xs text-muted">{[t.clubName !== t.name ? t.clubName : null, t.region, t.country].filter(Boolean).join(' / ') || '-'}</div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  <Users className="size-3.5" /> {t.playerCount} players
                </span>
                <span>{t.coach ? `Coach ${t.coach}` : 'No coach recorded'}</span>
                {t.archived && <Badge>Archived</Badge>}
              </div>
            </button>
          ))}
        </div>
      )}
      {creating && <TeamFormDialog onClose={() => setCreating(false)} onSaved={(id) => navigate(`/teams/${id}`)} />}
    </Page>
  )
}
