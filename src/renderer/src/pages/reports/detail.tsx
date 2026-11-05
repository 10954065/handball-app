import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FileSpreadsheet, FileText, Printer } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ReportFormat } from '@shared/dto'
import { Page } from '@/components/layout/shell'
import { Button } from '@/components/ui/button'
import { ErrorNote, Panel, PanelHeader, Spinner } from '@/components/ui/misc'
import { call, errorMessage } from '@/lib/api'
import { useApi } from '@/lib/query'
import { useSession } from '@/lib/session'
import { MatchReportDocument } from './document'
import { ReportArchiveTable } from './index'

type Action = ReportFormat | 'print'

export function ReportDetailPage() {
  const { id = '' } = useParams()
  const { can } = useSession()
  const qc = useQueryClient()
  const q = useApi('reports.get', { matchId: id }, { staleTime: 0 })
  const files = useApi('reports.list', { matchId: id, limit: 50 }, { staleTime: 0 })
  const [busy, setBusy] = useState<Action | null>(null)

  const run = async (action: Action, work: () => Promise<void>) => {
    setBusy(action)
    try {
      await work()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  /** Archive the report (or reuse the identical archived file), then ask where to save a copy. */
  const saveFile = (format: ReportFormat) =>
    run(format, async () => {
      const file = await call('reports.generate', { matchId: id, format })
      await qc.invalidateQueries({ queryKey: ['reports.list'] })
      const saved = await call('reports.saveAs', { id: file.id })
      if (saved) toast.success(`Saved to ${saved.path}`)
    })

  const print = () =>
    run('print', async () => {
      await call('reports.print', { matchId: id })
    })

  const back = (
    <Link to="/reports" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
      <ArrowLeft className="size-4" /> Match Reports
    </Link>
  )
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) {
    return (
      <Page>
        {back}
        <ErrorNote error={q.error} />
      </Page>
    )
  }
  const operator = can('operate_match')

  return (
    <Page>
      {back}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {operator && (
          <>
            <Button disabled={!!busy} onClick={() => void saveFile('pdf')}>
              <FileText /> {busy === 'pdf' ? 'Preparing PDF...' : 'Save PDF'}
            </Button>
            <Button variant="secondary" disabled={!!busy} onClick={() => void saveFile('xlsx')}>
              <FileSpreadsheet /> Save Excel
            </Button>
          </>
        )}
        <Button variant="secondary" disabled={!!busy} onClick={() => void print()}>
          <Printer /> Print
        </Button>
        <Link to={`/matches/${id}`} className="ml-auto text-sm text-muted hover:text-text">
          Open match
        </Link>
      </div>
      {!!files.data?.length && (
        <Panel className="mb-5">
          <PanelHeader title="Archived files" subtitle="Files made for this match. A correction to the match makes them outdated." />
          <ReportArchiveTable files={files.data} showMatch={false} />
        </Panel>
      )}
      <div className="report-sheet">
        <MatchReportDocument report={q.data} />
      </div>
    </Page>
  )
}
