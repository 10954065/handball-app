import { useState } from 'react'
import { History } from 'lucide-react'
import { Page } from '@/components/layout/shell'
import { MatchRow } from '@/components/domain/match-row'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { EmptyState, ErrorNote, PageHeader, Panel, Spinner } from '@/components/ui/misc'
import { SearchBox } from '@/components/ui/table'
import { useApi } from '@/lib/query'

/** The first or last millisecond of a yyyy-mm-dd day in local time. */
function dayBound(day: string, end: boolean): number | undefined {
  if (!day) return undefined
  const t = new Date(`${day}T${end ? '23:59:59.999' : '00:00:00'}`).getTime()
  return Number.isNaN(t) ? undefined : t
}

export function HistoryPage() {
  const [search, setSearch] = useState('')
  const [competitionId, setCompetitionId] = useState('')
  const [teamId, setTeamId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const competitions = useApi('competitions.list')
  const teams = useApi('teams.list')
  const list = useApi('matches.list', {
    status: ['finished', 'abandoned'],
    search: search || undefined,
    competitionId: competitionId || undefined,
    teamId: teamId || undefined,
    from: dayBound(from, false),
    to: dayBound(to, true),
    limit: 500
  })

  return (
    <Page>
      <PageHeader icon={History} title="Match History" subtitle="Every completed match, with its record, statistics and report." />
      <Panel className="mb-4 p-4">
        <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
          <SearchBox value={search} onChange={setSearch} placeholder="Team or match number" />
          <Field label="Competition" htmlFor="history-competition">
            <Select id="history-competition" value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
              <option value="">All</option>
              {competitions.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Team" htmlFor="history-team">
            <Select id="history-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">All</option>
              {teams.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" htmlFor="history-from">
            <Input id="history-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="history-to">
            <Input id="history-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </Panel>
      <Panel>
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <ErrorNote error={list.error} />
        ) : list.data?.length ? (
          <div className="divide-y divide-border">
            {list.data.map((m) => (
              <MatchRow key={m.id} m={m} />
            ))}
          </div>
        ) : (
          <EmptyState icon={History} title="No completed matches found" message="Finished matches appear here once they have been finalized." />
        )}
      </Panel>
    </Page>
  )
}
