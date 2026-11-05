import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarPlus, Pencil, Plus, Trophy, Users } from 'lucide-react'
import { COMPETITION_TYPE_LABELS } from '@shared/domain/constants'
import type { CompetitionDTO, SeasonDTO } from '@shared/dto'
import { Page } from '@/components/layout/shell'
import { MatchRow } from '@/components/domain/match-row'
import { StandingsTable } from '@/components/domain/standings-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorNote, Panel, PanelHeader, Spinner } from '@/components/ui/misc'
import { Segmented } from '@/components/ui/table'
import { useApi } from '@/lib/query'
import { useSession } from '@/lib/session'
import { MatchFormDialog } from '../matches/match-form'
import { CompetitionDialog } from './competition-form'
import { SeasonDialog } from './season-form'
import { SeasonTeamsDialog } from './season-teams'

export function CompetitionDetailPage() {
  const { id = '' } = useParams()
  const { can } = useSession()
  const q = useApi('competitions.get', { id })
  const [seasonId, setSeasonId] = useState('')
  const [dialog, setDialog] = useState<'edit' | 'season' | 'editSeason' | 'teams' | 'match' | null>(null)
  useEffect(() => {
    if (q.data && !q.data.seasons.some((s) => s.id === seasonId)) {
      setSeasonId((q.data.seasons.find((s) => s.status === 'active') ?? q.data.seasons[0])?.id ?? '')
    }
  }, [q.data, seasonId])
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <Page><ErrorNote error={q.error} /></Page>
  const c = q.data
  const season = c.seasons.find((s) => s.id === seasonId)
  const manage = can('manage_data')

  return (
    <Page>
      <Link to="/competitions" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"><ArrowLeft className="size-4" /> Competitions</Link>
      <div className="mb-6 flex flex-wrap items-center gap-5 rounded-2xl border border-border bg-surface-1 p-6">
        <div className="grid size-16 place-items-center rounded-2xl bg-gold/15 text-gold"><Trophy className="size-8" /></div>
        <div className="flex-1">
          <h1 className="font-display text-4xl font-bold tracking-wide">{c.name}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="gold">{COMPETITION_TYPE_LABELS[c.type]}</Badge>
            {c.category && <Badge>{c.category}</Badge>}
            <Badge>{c.rules.presetName}</Badge>
            <Badge>W {c.pointsWin} / D {c.pointsDraw} / L {c.pointsLoss}</Badge>
          </div>
        </div>
        {manage && <Button variant="secondary" onClick={() => setDialog('edit')}><Pencil /> Edit competition</Button>}
      </div>
      <div className="mb-5 flex items-center gap-3">
        {c.seasons.length > 0 && <Segmented value={seasonId} onChange={setSeasonId} options={c.seasons.map((s) => ({ value: s.id, label: s.name }))} />}
        {manage && <Button size="sm" variant="ghost" onClick={() => setDialog('season')}><Plus /> New season</Button>}
      </div>
      {!season ? (
        <Panel><EmptyState icon={Trophy} title="No seasons yet" message="Create a season to register teams and schedule fixtures." action={manage && <Button onClick={() => setDialog('season')}><Plus /> New season</Button>} /></Panel>
      ) : (
        <SeasonView competition={c} season={season} manage={manage} onDialog={setDialog} />
      )}
      {dialog === 'edit' && <CompetitionDialog competition={c} onClose={() => setDialog(null)} />}
      {dialog === 'season' && <SeasonDialog competitionId={c.id} onClose={() => setDialog(null)} onSaved={setSeasonId} />}
      {dialog === 'editSeason' && season && <SeasonDialog competitionId={c.id} season={season} onClose={() => setDialog(null)} />}
      {dialog === 'teams' && season && <SeasonTeamsDialog season={season} grouped={c.type === 'groups' || c.type === 'groups_knockout'} onClose={() => setDialog(null)} />}
      {dialog === 'match' && season && <MatchFormDialog competitionId={c.id} seasonId={season.id} onClose={() => setDialog(null)} />}
    </Page>
  )
}

interface SeasonViewProps {
  competition: CompetitionDTO
  season: SeasonDTO
  manage: boolean
  onDialog: (d: 'editSeason' | 'teams' | 'match') => void
}

function SeasonView({ competition: c, season, manage, onDialog }: SeasonViewProps) {
  const standings = useApi('seasons.standings', { id: season.id })
  const fixtures = useApi('matches.list', { seasonId: season.id, limit: 1000 })
  const hasTable = c.type === 'league' || c.type === 'groups' || c.type === 'groups_knockout'
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1.1fr]">
      <div className="space-y-5">
        <Panel>
          <PanelHeader
            title={`Teams (${season.teams.length})`}
            subtitle={`Season ${season.status}`}
            actions={manage && (<><Button size="sm" variant="ghost" onClick={() => onDialog('editSeason')}>Edit season</Button><Button size="sm" variant="secondary" onClick={() => onDialog('teams')}><Users /> Manage teams</Button></>)}
          />
          {hasTable ? (
            standings.data?.length ? <StandingsTable rows={standings.data} /> : <p className="px-5 py-4 text-sm text-muted">Register teams to build the standings. Only finalized matches are counted.</p>
          ) : (
            <ul className="divide-y divide-border">
              {season.teams.map((t) => <li key={t.teamId} className="px-5 py-2.5 text-sm">{t.teamName}</li>)}
            </ul>
          )}
        </Panel>
      </div>
      <Panel>
        <PanelHeader title="Fixtures and results" actions={manage && <Button size="sm" onClick={() => onDialog('match')}><CalendarPlus /> Add fixture</Button>} />
        {fixtures.data?.length ? (
          <div className="divide-y divide-border">{fixtures.data.map((m) => <MatchRow key={m.id} m={m} />)}</div>
        ) : (
          <p className="px-5 py-6 text-sm text-muted">No fixtures in this season yet.</p>
        )}
      </Panel>
    </div>
  )
}
