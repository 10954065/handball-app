import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Activity, CalendarDays, CalendarPlus, DatabaseBackup, Goal, LayoutDashboard, Shield, Shirt, Trophy } from 'lucide-react'
import { Page } from '@/components/layout/shell'
import { MatchRow } from '@/components/domain/match-row'
import { StandingsTable } from '@/components/domain/standings-table'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader, Spinner, Stat } from '@/components/ui/misc'
import { useApi, useApiMutation } from '@/lib/query'
import { useSession } from '@/lib/session'
import { CompetitionDialog } from './competitions/competition-form'
import { ActivityList, QuickAction, Section, TopScorers } from './dashboard-parts'
import { MatchFormDialog } from './matches/match-form'
import { PlayerFormDialog } from './players/player-form'
import { TeamFormDialog } from './teams/team-form'

type Quick = 'match' | 'team' | 'player' | 'competition' | null

export function DashboardPage() {
  const { user, can } = useSession()
  const navigate = useNavigate()
  const settings = useApi('settings.get')
  const d = useApi('dashboard.get')
  const integrity = useApi('db.integrity')
  const [quick, setQuick] = useState<Quick>(null)
  const backup = useApiMutation('backup.create', { invalidate: ['backup.'], success: (b) => `Backup created: ${b.fileName}` })
  const manage = can('manage_data')
  const bad = integrity.data?.ok === false

  return (
    <Page wide>
      <PageHeader
        icon={LayoutDashboard}
        title={`Welcome, ${user?.displayName.split(' ')[0] ?? ''}`}
        subtitle={settings.data?.organisationName || 'Handball Match Management System'}
        actions={
          <>
            <span className={`mr-2 flex items-center gap-2 text-xs ${bad ? 'text-danger' : 'text-muted'}`}>
              <span className={`size-2 rounded-full ${bad ? 'bg-danger' : 'bg-goal'}`} />
              {bad ? 'Database problem - see Settings' : 'Database healthy - offline'}
            </span>
            {manage && (
              <Button variant="secondary" loading={backup.isPending} onClick={() => backup.mutate({ note: 'Manual backup from dashboard' })}>
                <DatabaseBackup /> Back up now
              </Button>
            )}
          </>
        }
      />
      {manage && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <QuickAction icon={CalendarPlus} label="Create match" onClick={() => setQuick('match')} primary />
          <QuickAction icon={Shield} label="Register team" onClick={() => setQuick('team')} />
          <QuickAction icon={Shirt} label="Register player" onClick={() => setQuick('player')} />
          <QuickAction icon={Trophy} label="Create competition" onClick={() => setQuick('competition')} />
        </div>
      )}
      {d.isLoading || !d.data ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-5">
            <Stat label="Competitions" value={d.data.totals.competitions} />
            <Stat label="Teams" value={d.data.totals.teams} />
            <Stat label="Players" value={d.data.totals.players} />
            <Stat label="Matches played" value={d.data.totals.matchesPlayed} />
            <Stat label="Officials" value={d.data.totals.officials} />
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
            <div className="space-y-5">
              {d.data.liveMatches.length > 0 && (
                <Section title="Live now" icon={Activity} className="border-red-card/40">
                  <div className="divide-y divide-border">{d.data.liveMatches.map((m) => <MatchRow key={m.id} m={m} />)}</div>
                </Section>
              )}
              <Section title="Upcoming matches" icon={CalendarDays} action={<Link className="text-xs text-primary hover:underline" to="/matches">All matches</Link>}>
                {d.data.upcoming.length ? (
                  <div className="divide-y divide-border">{d.data.upcoming.map((m) => <MatchRow key={m.id} m={m} />)}</div>
                ) : (
                  <EmptyState className="py-8" icon={CalendarDays} title="No upcoming matches" />
                )}
              </Section>
              <Section title="Recent results" icon={Trophy}>
                {d.data.recentResults.length ? (
                  <div className="divide-y divide-border">{d.data.recentResults.map((m) => <MatchRow key={m.id} m={m} />)}</div>
                ) : (
                  <EmptyState className="py-8" icon={Trophy} title="No results yet" message="Finalized matches appear here." />
                )}
              </Section>
            </div>
            <div className="space-y-5">
              <Section title={d.data.standings ? `Standings - ${d.data.standings.title}` : 'Standings'} icon={Trophy}>
                {d.data.standings ? (
                  <StandingsTable rows={d.data.standings.rows.slice(0, 10)} compact />
                ) : (
                  <EmptyState className="py-8" icon={Trophy} title="No standings yet" message="Create a competition and season with registered teams." />
                )}
              </Section>
              <Section title="Top scorers" icon={Goal}>
                <TopScorers rows={d.data.topScorers} />
              </Section>
              <Section title="Recent activity" icon={Activity}>
                <ActivityList rows={d.data.activity} />
              </Section>
            </div>
          </div>
        </>
      )}
      {quick === 'match' && <MatchFormDialog onClose={() => setQuick(null)} onCreated={(id) => navigate(`/matches/${id}`)} />}
      {quick === 'team' && <TeamFormDialog onClose={() => setQuick(null)} onSaved={(id) => navigate(`/teams/${id}`)} />}
      {quick === 'player' && <PlayerFormDialog onClose={() => setQuick(null)} onSaved={(id) => navigate(`/players/${id}`)} />}
      {quick === 'competition' && <CompetitionDialog onClose={() => setQuick(null)} onSaved={(id) => navigate(`/competitions/${id}`)} />}
    </Page>
  )
}
