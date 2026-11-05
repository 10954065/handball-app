import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, Plus } from 'lucide-react'
import type { MatchStatus } from '@shared/domain/constants'
import { Page } from '@/components/layout/shell'
import { MatchRow } from '@/components/domain/match-row'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader, Panel, Spinner } from '@/components/ui/misc'
import { SearchBox, Segmented } from '@/components/ui/table'
import { useApi } from '@/lib/query'
import { useSession } from '@/lib/session'
import { MatchFormDialog } from './match-form'

type Tab = 'upcoming' | 'live' | 'results' | 'all'
const STATUSES: Record<Tab, MatchStatus[] | undefined> = {
  upcoming: ['scheduled', 'ready'],
  live: ['live'],
  results: ['finished', 'abandoned'],
  all: undefined
}

export function MatchesPage() {
  const { can } = useSession()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('upcoming')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const list = useApi('matches.list', { status: STATUSES[tab], search: search || undefined, limit: 500 })

  return (
    <Page>
      <PageHeader
        icon={CalendarDays}
        title="Matches"
        subtitle="Fixtures, live matches and results."
        actions={can('manage_data') && <Button onClick={() => setCreating(true)}><Plus /> Create match</Button>}
      />
      <div className="mb-4 flex items-center gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'live', label: 'Live' },
            { value: 'results', label: 'Results' },
            { value: 'all', label: 'All' }
          ]}
        />
        <SearchBox value={search} onChange={setSearch} placeholder="Team or match number" className="w-72" />
      </div>
      <Panel>
        {list.isLoading ? (
          <Spinner />
        ) : !list.data?.length ? (
          <EmptyState
            icon={CalendarDays}
            title={tab === 'upcoming' ? 'No upcoming matches' : tab === 'live' ? 'No match is live' : 'No matches found'}
            message={tab === 'upcoming' ? 'Create a match to prepare lineups and start live scoring.' : undefined}
            action={tab === 'upcoming' && can('manage_data') && <Button onClick={() => setCreating(true)}><Plus /> Create match</Button>}
          />
        ) : (
          <div className="divide-y divide-border">
            {list.data.map((m) => <MatchRow key={m.id} m={m} />)}
          </div>
        )}
      </Panel>
      {creating && <MatchFormDialog onClose={() => setCreating(false)} onCreated={(id) => navigate(`/matches/${id}`)} />}
    </Page>
  )
}
