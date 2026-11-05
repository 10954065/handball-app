import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { percent } from '@shared/domain/statistics'
import type { StatGoalkeeperDTO, StatPlayerDTO, StatTeamDTO } from '@shared/dto'
import { Page } from '@/components/layout/shell'
import { RankedBars } from '@/components/domain/charts'
import { PlayerAvatar, TeamCrest } from '@/components/domain/identity'
import { StatTable, type StatColumn } from '@/components/domain/stat-table'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/input'
import { EmptyState, ErrorNote, PageHeader, Panel, PanelHeader, Spinner, Stat } from '@/components/ui/misc'
import { Segmented } from '@/components/ui/table'
import { useApi, useApiMutation } from '@/lib/query'

type Tab = 'players' | 'goalkeepers' | 'teams'

const count = <T,>(key: keyof T & string, label: string, title: string): StatColumn<T> => ({ key, label, title, value: (r) => r[key] as number })

const PLAYER_COLUMNS: StatColumn<StatPlayerDTO>[] = [
  count('matches', 'M', 'Matches played'),
  count('goals', 'G', 'Goals'),
  count('shots', 'S', 'Shots'),
  { key: 'rate', label: 'S%', title: 'Shooting percentage', percent: true, value: (p) => percent(p.goals, p.shots) },
  count('sevenMetreGoals', '7mG', '7 m goals'),
  count('sevenMetreShots', '7mS', '7 m shots'),
  count('assists', 'A', 'Assists'),
  count('steals', 'St', 'Steals'),
  count('blocks', 'Bl', 'Blocks'),
  count('turnovers', 'TO', 'Turnovers'),
  count('technicalFaults', 'TF', 'Technical faults'),
  count('warnings', 'Y', 'Warnings'),
  count('suspensions', '2m', '2-minute suspensions'),
  count('disqualifications', 'D', 'Disqualifications')
]

const KEEPER_COLUMNS: StatColumn<StatGoalkeeperDTO>[] = [
  count('matches', 'M', 'Matches played'),
  count('saves', 'Saves', 'Saves'),
  count('shotsFaced', 'Faced', 'Shots on target faced'),
  { key: 'rate', label: 'Save%', title: 'Save percentage', percent: true, value: (k) => percent(k.saves, k.shotsFaced) },
  count('goalsConceded', 'GA', 'Goals conceded'),
  count('sevenMetreSaves', '7mSv', '7 m saves'),
  count('sevenMetreFaced', '7mF', '7 m throws faced'),
  { key: 'sevenRate', label: '7m%', title: '7 m save percentage', percent: true, value: (k) => percent(k.sevenMetreSaves, k.sevenMetreFaced) }
]

const TEAM_COLUMNS: StatColumn<StatTeamDTO>[] = [
  count('played', 'P', 'Played'),
  count('won', 'W', 'Won'),
  count('drawn', 'D', 'Drawn'),
  count('lost', 'L', 'Lost'),
  count('goalsFor', 'GF', 'Goals for'),
  count('goalsConceded', 'GA', 'Goals against'),
  { key: 'diff', label: '+/-', title: 'Goal difference', value: (t) => t.goalsFor - t.goalsConceded },
  { key: 'shooting', label: 'S%', title: 'Shooting percentage', percent: true, value: (t) => percent(t.goalsFor, t.shots) },
  { key: 'saving', label: 'Sv%', title: 'Save percentage', percent: true, value: (t) => percent(t.saves, t.saves + t.goalsConceded) },
  count('technicalFaults', 'TF', 'Technical faults'),
  count('turnovers', 'TO', 'Turnovers'),
  count('steals', 'St', 'Steals'),
  count('blocks', 'Bl', 'Blocks'),
  count('warnings', 'Y', 'Warnings'),
  count('suspensions', '2m', '2-minute suspensions'),
  count('disqualifications', 'DQ', 'Disqualifications'),
  count('timeouts', 'TT', 'Team time-outs')
]

function Person({ row }: { row: StatPlayerDTO | StatGoalkeeperDTO }) {
  return (
    <Link to={`/players/${row.playerId}`} className="flex min-w-52 items-center gap-2.5 hover:text-primary">
      <PlayerAvatar photoMediaId={row.photoMediaId} name={row.name} size={28} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-medium">{row.name}</span>
        <span className="block truncate text-xs text-faint">{row.teamName}</span>
      </span>
    </Link>
  )
}

const TOP_SCORERS = 8

export function StatisticsPage() {
  const [tab, setTab] = useState<Tab>('players')
  const [competitionId, setCompetitionId] = useState('')
  const [seasonId, setSeasonId] = useState('')
  const [teamId, setTeamId] = useState('')
  const competitions = useApi('competitions.list')
  const teams = useApi('teams.list')
  const filter = { competitionId: competitionId || undefined, seasonId: seasonId || undefined, teamId: teamId || undefined }
  const q = useApi('statistics.overview', filter, { staleTime: 0 })
  const exportFile = useApiMutation('statistics.export', { onSuccess: (saved) => saved && toast.success(`Saved to ${saved.path}`) })
  const seasons = competitions.data?.find((c) => c.id === competitionId)?.seasons ?? []
  const data = q.data
  const scorers = (data?.players ?? []).filter((p) => p.goals > 0).slice(0, TOP_SCORERS)
  const goals = data?.teams.reduce((n, t) => n + t.goalsFor, 0) ?? 0

  return (
    <Page wide>
      <PageHeader
        icon={BarChart3}
        title="Statistics"
        subtitle="Calculated from the event ledgers of finalized matches."
        actions={
          <Button variant="secondary" disabled={!data?.matches || exportFile.isPending} onClick={() => exportFile.mutate(filter)}>
            <FileSpreadsheet /> Export to Excel
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Competition" htmlFor="stat-competition">
          <Select
            id="stat-competition"
            value={competitionId}
            onChange={(e) => {
              setCompetitionId(e.target.value)
              setSeasonId('')
            }}
          >
            <option value="">All competitions and friendlies</option>
            {competitions.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Season" htmlFor="stat-season">
          <Select id="stat-season" value={seasonId} disabled={!seasons.length} onChange={(e) => setSeasonId(e.target.value)}>
            <option value="">All seasons</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Team" htmlFor="stat-team">
          <Select id="stat-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">All teams</option>
            {teams.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {q.error && <ErrorNote error={q.error} />}
      {q.isLoading && <Spinner />}
      {data && data.matches === 0 && (
        <Panel>
          <EmptyState icon={BarChart3} title="No finalized matches here yet" message="Statistics appear once a match has been finished in the match centre." />
        </Panel>
      )}
      {data && data.matches > 0 && (
        <>
          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="grid grid-cols-2 gap-5 lg:grid-cols-1">
              <Stat label="Finalized matches" value={data.matches} />
              <Stat label="Goals" value={goals} hint={`${(goals / data.matches).toFixed(1)} per match`} />
            </div>
            <Panel>
              <PanelHeader title="Top scorers" />
              <div className="px-5 py-3">{scorers.length ? <RankedBars rows={scorers.map((p) => ({ name: p.name, value: p.goals }))} valueLabel="Goals" /> : <p className="py-6 text-center text-sm text-muted">No goals have been scored.</p>}</div>
            </Panel>
          </div>
          <div className="mb-3">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'players', label: 'Players', count: data.players.length },
                { value: 'goalkeepers', label: 'Goalkeepers', count: data.goalkeepers.length },
                { value: 'teams', label: 'Teams', count: data.teams.length }
              ]}
            />
          </div>
          <Panel className="overflow-hidden">
            {tab === 'players' && <StatTable label="Player statistics" nameHeader="Player" rows={data.players} rowKey={(p) => p.playerId} name={(p) => <Person row={p} />} columns={PLAYER_COLUMNS} initialSort="goals" />}
            {tab === 'goalkeepers' && <StatTable label="Goalkeeper statistics" nameHeader="Goalkeeper" rows={data.goalkeepers} rowKey={(k) => k.playerId} name={(k) => <Person row={k} />} columns={KEEPER_COLUMNS} initialSort="saves" />}
            {tab === 'teams' && (
              <StatTable
                label="Team statistics"
                nameHeader="Team"
                rows={data.teams}
                rowKey={(t) => t.teamId}
                name={(t) => (
                  <Link to={`/teams/${t.teamId}`} className="flex min-w-48 items-center gap-2.5 font-medium hover:text-primary">
                    <TeamCrest code={t.code} color={t.color} logoMediaId={null} size={26} /> {t.name}
                  </Link>
                )}
                columns={TEAM_COLUMNS}
                initialSort="won"
              />
            )}
          </Panel>
        </>
      )}
    </Page>
  )
}
