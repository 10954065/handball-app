import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { errorMessage } from '@/lib/api'
import { useApi } from '@/lib/query'
import { SeasonReportDocument } from '../competitions/season-report'
import { MatchReportDocument } from './document'

/** Resolves once web fonts and every image on the page can be painted. */
async function assetsLoaded(): Promise<void> {
  await document.fonts.ready
  await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)))
}

/**
 * Mark the page as a printout, and tell the main process when it is ready.
 * The main process waits for data-report-state on the root element (see main/reportWindow.ts).
 */
function usePrintState(data: unknown, error: unknown): void {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('report-print')
    return () => root.classList.remove('report-print')
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (error) root.dataset.reportState = errorMessage(error)
    if (!data) return
    let current = true
    void assetsLoaded().then(() => {
      if (current) root.dataset.reportState = 'ready'
    })
    return () => {
      current = false
    }
  }, [data, error])
}

/** The match report alone, for the hidden window behind PDF export and printing. */
export function ReportPrintPage() {
  const { id = '' } = useParams()
  const q = useApi('reports.get', { matchId: id })
  usePrintState(q.data, q.error)
  return q.data ? <MatchReportDocument report={q.data} /> : null
}

/** The competition report alone, for the same hidden window. */
export function SeasonPrintPage() {
  const { id = '' } = useParams()
  const q = useApi('seasons.report', { seasonId: id })
  usePrintState(q.data, q.error)
  return q.data ? <SeasonReportDocument report={q.data} /> : null
}
