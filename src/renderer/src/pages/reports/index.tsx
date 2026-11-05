import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FileText } from 'lucide-react'
import { toast } from 'sonner'
import type { ReportFileDTO } from '@shared/dto'
import { Page } from '@/components/layout/shell'
import { MatchRow } from '@/components/domain/match-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorNote, PageHeader, Panel, Spinner } from '@/components/ui/misc'
import { SearchBox, Segmented, Table, Td, Th, Tr } from '@/components/ui/table'
import { fmtBytes, fmtDateTime } from '@/lib/format'
import { useApi, useApiMutation } from '@/lib/query'

type Tab = 'matches' | 'archive'

export function ReportFileBadges({ file }: { file: ReportFileDTO }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {file.matchState === 'provisional' && <Badge tone="warning">Provisional</Badge>}
      {file.outdated ? <Badge tone="danger">Outdated - match has changed</Badge> : <Badge tone="success">Current</Badge>}
    </span>
  )
}

/** Archived report files, with a button to save a copy. */
export function ReportArchiveTable({ files, showMatch }: { files: ReportFileDTO[]; showMatch: boolean }) {
  const save = useApiMutation('reports.saveAs', { onSuccess: (saved) => saved && toast.success(`Saved to ${saved.path}`) })
  return (
    <Table>
      <thead>
        <tr>
          {showMatch && <Th>Match</Th>}
          <Th>File</Th>
          <Th>Status</Th>
          <Th>Made</Th>
          <Th className="text-right">Size</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {files.map((f) => (
          <Tr key={f.id}>
            {showMatch && (
              <Td>
                <Link to={`/reports/${f.matchId}`} className="font-medium hover:text-primary">
                  {f.title}
                </Link>
                <div className="font-mono text-xs text-faint">{f.matchNumber}</div>
              </Td>
            )}
            <Td>
              <Badge>{f.format.toUpperCase()}</Badge>
            </Td>
            <Td>
              <ReportFileBadges file={f} />
            </Td>
            <Td className="text-muted">
              {fmtDateTime(f.createdAt)}
              {f.generatedBy && <div className="text-xs text-faint">{f.generatedBy}</div>}
            </Td>
            <Td className="text-right text-muted tabular">{fmtBytes(f.sizeBytes)}</Td>
            <Td className="text-right">
              <Button size="sm" variant="secondary" aria-label={`Save ${f.fileName}`} disabled={save.isPending} onClick={() => save.mutate({ id: f.id })}>
                <Download /> Save copy
              </Button>
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  )
}

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('matches')
  const [search, setSearch] = useState('')
  const matches = useApi('matches.list', { status: ['finished', 'live', 'ready'], search: search || undefined, limit: 500 })
  const archive = useApi('reports.list', { limit: 200 }, { staleTime: 0 })

  return (
    <Page>
      <PageHeader icon={FileText} title="Match Reports" subtitle="Preview, save and print match reports. Every saved report is kept in the archive." />
      <div className="mb-4 flex items-center gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'matches', label: 'Matches' },
            { value: 'archive', label: 'Archive', count: archive.data?.length }
          ]}
        />
        {tab === 'matches' && <SearchBox value={search} onChange={setSearch} placeholder="Team or match number" className="w-72" />}
      </div>
      <Panel>
        {tab === 'matches' &&
          (matches.isLoading ? (
            <Spinner />
          ) : matches.error ? (
            <ErrorNote error={matches.error} />
          ) : matches.data?.length ? (
            <div className="divide-y divide-border">
              {matches.data.map((m) => (
                <MatchRow key={m.id} m={m} to={`/reports/${m.id}`} />
              ))}
            </div>
          ) : (
            <EmptyState icon={FileText} title="No matches found" message="A match report is available once both lineups are confirmed." />
          ))}
        {tab === 'archive' &&
          (archive.isLoading ? (
            <Spinner />
          ) : archive.error ? (
            <ErrorNote error={archive.error} />
          ) : archive.data?.length ? (
            <ReportArchiveTable files={archive.data} showMatch />
          ) : (
            <EmptyState icon={FileText} title="The archive is empty" message="Reports are archived when they are saved as PDF or Excel." />
          ))}
      </Panel>
    </Page>
  )
}
