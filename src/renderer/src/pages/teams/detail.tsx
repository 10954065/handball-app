import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Archive, ArrowLeft, Crown, Hand, Pencil, Plus, Shirt, Trophy } from 'lucide-react'
import type { TeamDetailDTO } from '@shared/dto'
import { Page } from '@/components/layout/shell'
import { TeamCrest } from '@/components/domain/identity'
import { PlayerCard } from '@/components/domain/player-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm'
import { EmptyState, ErrorNote, Panel, PanelHeader, Spinner } from '@/components/ui/misc'
import { useApi, useApiMutation } from '@/lib/query'
import { useSession } from '@/lib/session'
import { PlayerFormDialog } from '../players/player-form'
import { TeamFormDialog } from './team-form'

export function TeamDetailPage() {
  const { id = '' } = useParams()
  const confirm = useConfirm()
  const { can } = useSession()
  const team = useApi('teams.get', { id })
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const archive = useApiMutation('teams.archive', { invalidate: ['teams.', 'dashboard.'] })

  if (team.isLoading) return <Spinner />
  if (team.error || !team.data) return <Page><ErrorNote error={team.error} /></Page>
  const t = team.data
  const manage = can('manage_data')

  return (
    <Page>
      <Link to="/teams" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Teams
      </Link>
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-surface-1">
        <div className="absolute inset-0 opacity-[0.16]" style={{ background: `linear-gradient(120deg, ${t.primaryColor} 0%, transparent 55%)` }} />
        <div className="relative flex flex-wrap items-center gap-6 p-7">
          <TeamCrest logoMediaId={t.logoMediaId} code={t.code} color={t.primaryColor} size={96} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h1 className="font-display text-4xl font-bold tracking-wide">{t.name}</h1>
              {t.archived && <Badge>Archived</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted">{[t.clubName, t.region, t.country].filter(Boolean).join(' / ')}</p>
            <div className="mt-3 flex items-center gap-2 text-xs text-faint">
              <span className="size-4 rounded" style={{ background: t.primaryColor }} />
              <span className="size-4 rounded border border-border" style={{ background: t.secondaryColor }} />
              <span className="ml-1 font-mono">{t.code}</span>
            </div>
          </div>
          {manage && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  const ok = await confirm({
                    title: t.archived ? 'Restore team?' : 'Archive team?',
                    message: t.archived ? 'The team can be scheduled again.' : 'Archived teams are hidden and cannot be scheduled. Match history is kept.',
                    confirmLabel: t.archived ? 'Restore' : 'Archive'
                  })
                  if (ok) archive.mutate({ id: t.id, archived: !t.archived })
                }}
              >
                <Archive /> {t.archived ? 'Restore' : 'Archive'}
              </Button>
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
        <TeamRoster team={t} manage={manage} onAdd={() => setAdding(true)} />
        <TeamSidebar team={t} />
      </div>
      {editing && <TeamFormDialog team={t} onClose={() => setEditing(false)} />}
      {adding && <PlayerFormDialog teamId={t.id} onClose={() => setAdding(false)} />}
    </Page>
  )
}

function TeamRoster({ team: t, manage, onAdd }: { team: TeamDetailDTO; manage: boolean; onAdd: () => void }) {
  const navigate = useNavigate()
  const update = useApiMutation('teams.update', { invalidate: ['teams.'], success: 'Designation updated' })
  const designate = (field: 'captainPlayerId' | 'primaryGoalkeeperId', playerId: string) => {
    const { roster: _r, competitions: _c, playerCount: _p, archived: _a, createdAt: _ca, ...rest } = t
    update.mutate({ ...rest, [field]: t[field] === playerId ? null : playerId })
  }
  return (
    <Panel>
      <PanelHeader
        title={`Registered players (${t.roster.length})`}
        subtitle={manage ? 'Use C and GK to designate the captain and primary goalkeeper.' : undefined}
        actions={manage && <Button size="sm" onClick={onAdd}><Plus /> Register player</Button>}
      />
      {t.roster.length === 0 ? (
        <EmptyState icon={Shirt} title="No players registered" message="Register players or transfer existing players to this team." />
      ) : (
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {t.roster.map((p) => (
            <PlayerCard
              key={p.playerId}
              name={p.fullName}
              jersey={p.jerseyNumber}
              position={p.position}
              photoMediaId={p.photoMediaId}
              color={t.primaryColor}
              captain={p.isCaptain}
              goalkeeper={p.isGoalkeeper}
              onClick={() => navigate(`/players/${p.playerId}`)}
              footer={
                manage && (
                  <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant={p.isCaptain ? 'subtle' : 'ghost'} className="h-7 flex-1 px-2" title="Captain" onClick={() => designate('captainPlayerId', p.playerId)}>
                      <Crown /> C
                    </Button>
                    <Button
                      size="sm"
                      variant={p.isPrimaryGoalkeeper ? 'subtle' : 'ghost'}
                      className="h-7 flex-1 px-2"
                      title="Primary goalkeeper"
                      disabled={!p.isGoalkeeper}
                      onClick={() => designate('primaryGoalkeeperId', p.playerId)}
                    >
                      <Hand /> GK
                    </Button>
                  </div>
                )
              }
            />
          ))}
        </div>
      )}
    </Panel>
  )
}

function TeamSidebar({ team: t }: { team: TeamDetailDTO }) {
  const staff: [string, string | null][] = [
    ['Coach', t.coach],
    ['Assistant coach', t.assistantCoach],
    ['Team manager', t.teamManager],
    ['Home venue', t.homeVenue]
  ]
  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader title="Team staff" />
        <dl className="divide-y divide-border">
          {staff.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 px-5 py-2.5 text-sm">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-medium">{v ?? '-'}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      <Panel>
        <PanelHeader title="Competitions" />
        {t.competitions.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">Not registered in any competition.</p>
        ) : (
          <ul className="divide-y divide-border">
            {t.competitions.map((c) => (
              <li key={c.seasonId}>
                <Link to={`/competitions/${c.competitionId}`} className="flex items-center gap-2 px-5 py-2.5 text-sm hover:bg-surface-2">
                  <Trophy className="size-4 text-gold" />
                  <span className="flex-1">
                    {c.competitionName} <span className="text-muted">{c.seasonName}</span>
                  </span>
                  {c.groupName && <Badge>Group {c.groupName}</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
