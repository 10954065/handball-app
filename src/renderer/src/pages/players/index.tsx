import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Shirt } from 'lucide-react'
import { POSITION_LABELS, POSITIONS, type Position } from '@shared/domain/constants'
import { Page } from '@/components/layout/shell'
import { Jersey, PlayerAvatar } from '@/components/domain/identity'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { EmptyState, ErrorNote, PageHeader, Panel, Spinner } from '@/components/ui/misc'
import { SearchBox, Table, Td, Th, Tr } from '@/components/ui/table'
import { ageFrom } from '@/lib/format'
import { useApi } from '@/lib/query'
import { useSession } from '@/lib/session'
import { PlayerFormDialog } from './player-form'

const STATUS_TONE = { registered: 'success', pending: 'warning', suspended: 'danger', inactive: 'neutral' } as const

export function PlayersPage() {
  const navigate = useNavigate()
  const { can } = useSession()
  const [search, setSearch] = useState('')
  const [teamId, setTeamId] = useState('')
  const [position, setPosition] = useState<Position | ''>('')
  const [filter, setFilter] = useState<'all' | 'free' | 'archived'>('all')
  const [creating, setCreating] = useState(false)
  const teams = useApi('teams.list')
  const players = useApi('players.list', {
    search: search || undefined,
    teamId: teamId || undefined,
    position: position || undefined,
    freeAgentsOnly: filter === 'free' || undefined,
    includeArchived: filter === 'archived' || undefined
  })

  return (
    <Page>
      <PageHeader
        icon={Shirt}
        title="Players"
        subtitle="Player registrations, positions and transfers. Search by name, player ID or jersey number."
        actions={can('manage_data') && <Button onClick={() => setCreating(true)}><Plus /> Register player</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBox value={search} onChange={setSearch} placeholder="Name, player ID or jersey number" className="w-80" />
        <div className="w-56">
          <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Team">
            <option value="">All teams</option>
            {teams.data?.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </div>
        <div className="w-56">
          <Select value={position} onChange={(e) => setPosition(e.target.value as Position | '')} aria-label="Position">
            <option value="">All positions</option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>{POSITION_LABELS[p]}</option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter">
            <option value="all">Active players</option>
            <option value="free">Free agents</option>
            <option value="archived">Include archived</option>
          </Select>
        </div>
      </div>
      <Panel>
        {players.isLoading ? (
          <Spinner />
        ) : players.error ? (
          <div className="p-5"><ErrorNote error={players.error} /></div>
        ) : !players.data?.length ? (
          <EmptyState icon={Shirt} title="No players found" message={search || teamId || position ? 'Try a different search or filter.' : 'Register the first player.'} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-16">#</Th>
                <Th>Player</Th>
                <Th>Player ID</Th>
                <Th>Team</Th>
                <Th>Position</Th>
                <Th>Age</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {players.data.map((p) => (
                <Tr key={p.id} onClick={() => navigate(`/players/${p.id}`)}>
                  <Td><Jersey number={p.jerseyNumber} color={p.teamColor ?? undefined} size="sm" /></Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      <PlayerAvatar photoMediaId={p.photoMediaId} name={p.fullName} size={34} />
                      <span className="font-medium">{p.fullName}</span>
                      {p.isCaptain && <Badge tone="gold">C</Badge>}
                      {p.isGoalkeeper && <Badge tone="primary">GK</Badge>}
                      {p.archived && <Badge>Archived</Badge>}
                    </div>
                  </Td>
                  <Td className="font-mono text-xs text-muted">{p.registrationNo}</Td>
                  <Td>{p.teamName ?? <span className="text-faint">Free agent</span>}</Td>
                  <Td className="text-muted">{p.position ? POSITION_LABELS[p.position] : '-'}</Td>
                  <Td className="tabular text-muted">{ageFrom(p.dateOfBirth) ?? '-'}</Td>
                  <Td><Badge tone={STATUS_TONE[p.registrationStatus]}>{p.registrationStatus}</Badge></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      {creating && <PlayerFormDialog onClose={() => setCreating(false)} onSaved={(id) => navigate(`/players/${id}`)} />}
    </Page>
  )
}
