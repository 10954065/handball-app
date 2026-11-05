import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { errorMessage } from '@/lib/api'
import { useApi } from '@/lib/query'
import { MatchReportDocument } from './document'

/** Resolves once web fonts and every image on the page can be painted. */
async function assetsLoaded(): Promise<void> {
  await document.fonts.ready
  await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)))
}

/**
 * The report alone, for the hidden window behind PDF export and printing.
 * The main process waits for data-report-state on the root element (see main/reportWindow.ts).
 */
export function ReportPrintPage() {
  const { id = '' } = useParams()
  const q = useApi('reports.get', { matchId: id })

  useEffect(() => {
    const root = document.documentElement
    root.classList.add('report-print')
    return () => root.classList.remove('report-print')
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (q.error) root.dataset.reportState = errorMessage(q.error)
    if (!q.data) return
    let current = true
    void assetsLoaded().then(() => {
      if (current) root.dataset.reportState = 'ready'
    })
    return () => {
      current = false
    }
  }, [q.data, q.error])

  return q.data ? <MatchReportDocument report={q.data} /> : null
}
