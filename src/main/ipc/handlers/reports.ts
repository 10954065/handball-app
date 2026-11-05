import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import type { MatchReportDTO } from '@shared/dto'
import { audit } from '../../services/audit'
import { auditReportExport, findArchived, listReports, readReport, reportContentKey, storeReport } from '../../services/reports/archive'
import { matchReport } from '../../services/reports/data'
import { matchWorkbook, statisticsWorkbook } from '../../services/reports/workbook'
import { getSettings } from '../../services/settings'
import { statisticsOverview } from '../../services/statistics'
import { printReport, renderReportPdf } from '../../reportWindow'
import type { HandlerMap, RequestContext } from '../types'

const FILTERS = {
  pdf: { name: 'PDF document', extensions: ['pdf'] },
  xlsx: { name: 'Excel workbook', extensions: ['xlsx'] }
}

/** Ask where to save a file and write it there. Null when the operator cancels. */
async function saveTo(ctx: RequestContext, fileName: string, format: keyof typeof FILTERS, bytes: Buffer): Promise<{ path: string } | null> {
  const parent = BrowserWindow.fromWebContents(ctx.sender)
  const options = { title: 'Save report', defaultPath: join(app.getPath('documents'), fileName), filters: [FILTERS[format]] }
  const res = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
  if (res.canceled || !res.filePath) return null
  await writeFile(res.filePath, bytes)
  return { path: res.filePath }
}

/** The running footer of a PDF. A page may travel alone, so each one carries the report's status. */
function pageFooter(report: MatchReportDTO, author: string): string {
  const status = report.demo ? 'DEMONSTRATION DATA - ' : report.state === 'provisional' ? 'PROVISIONAL - ' : ''
  return `${status}${report.match.matchNumber} - generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by ${author}`
}

export const reportHandlers = {
  'statistics.overview': (input, ctx) => statisticsOverview(ctx, input),
  'statistics.export': async (input, ctx) => {
    const settings = getSettings(ctx)
    const bytes = await statisticsWorkbook(statisticsOverview(ctx, input), settings.organisationName, ctx.mode === 'demo')
    const saved = await saveTo(ctx, `${ctx.mode === 'demo' ? 'DEMO - ' : ''}HMMS statistics.xlsx`, 'xlsx', bytes)
    if (saved) audit(ctx, { action: 'statistics.export', entity: 'player_statistics', after: { filter: input, path: saved.path } })
    return saved
  },
  'reports.get': ({ matchId }, ctx) => matchReport(ctx, matchId),
  'reports.list': (input, ctx) => listReports(ctx, input),
  'reports.generate': async ({ matchId, format }, ctx) => {
    const report = matchReport(ctx, matchId)
    const archived = findArchived(ctx, matchId, format, reportContentKey(report))
    if (archived) return archived
    const bytes = format === 'pdf' ? await renderReportPdf(matchId, pageFooter(report, ctx.user?.displayName ?? 'HMMS')) : await matchWorkbook(report)
    return storeReport(ctx, report, format, bytes)
  },
  'reports.saveAs': async ({ id }, ctx) => {
    const file = readReport(ctx, id)
    const saved = await saveTo(ctx, file.fileName, file.format, file.bytes)
    if (saved) auditReportExport(ctx, { id, matchId: file.matchId, fileName: file.fileName }, saved.path)
    return saved
  },
  'reports.print': ({ matchId }) => printReport(matchId)
} satisfies Partial<HandlerMap>
