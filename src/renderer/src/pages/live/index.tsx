import { RadioTower } from 'lucide-react'
import { Page } from '@/components/layout/shell'
import { MatchRow } from '@/components/domain/match-row'
import { EmptyState, ErrorNote, PageHeader, Panel, PanelHeader, Spinner } from '@/components/ui/misc'
import { useApi } from '@/lib/query'

/** Entry point of the Live Match Centre: matches in progress, then matches ready to start. */
export function LiveIndexPage() {
  const live = useApi('matches.list', { status: ['live'] })
  const ready = useApi('matches.list', { status: ['ready'] })
  const waiting = useApi('matches.list', { status: ['scheduled'], limit: 8 })
  if (live.isLoading || ready.isLoading) return <Spinner />
  const error = live.error ?? ready.error
  if (error) return <Page><ErrorNote error={error} /></Page>
  const none = !live.data?.length && !ready.data?.length
  return (
    <Page>
      <PageHeader title="Live Match Centre" subtitle="Run the clock, record goals and events, and drive the public scoreboard." icon={RadioTower} />
      {none && (
        <Panel className="mb-5">
          <EmptyState
            icon={RadioTower}
            title="No match is ready to start"
            message="A match appears here once both teams' lineups have been confirmed on its match sheet."
          />
        </Panel>
      )}
      {!!live.data?.length && (
        <Panel className="mb-5">
          <PanelHeader title="In progress" />
          <div className="divide-y divide-border">
            {live.data.map((m) => <MatchRow key={m.id} m={m} to={`/live/${m.id}`} />)}
          </div>
        </Panel>
      )}
      {!!ready.data?.length && (
        <Panel className="mb-5">
          <PanelHeader title="Ready to start" subtitle="Both lineups confirmed." />
          <div className="divide-y divide-border">
            {ready.data.map((m) => <MatchRow key={m.id} m={m} to={`/live/${m.id}`} />)}
          </div>
        </Panel>
      )}
      {!!waiting.data?.length && (
        <Panel>
          <PanelHeader title="Waiting for lineups" subtitle="Confirm both match sheets to make these matches available here." />
          <div className="divide-y divide-border">
            {waiting.data.map((m) => <MatchRow key={m.id} m={m} to={`/matches/${m.id}/lineups`} />)}
          </div>
        </Panel>
      )}
    </Page>
  )
}
