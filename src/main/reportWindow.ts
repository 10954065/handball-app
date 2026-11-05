import type { BrowserWindow, WebContents } from 'electron'
import { AppError } from '@shared/errors'
import { log } from './logger'
import { createReportWindow } from './windows'

const READY_TIMEOUT_MS = 20_000
const READY_POLL_MS = 100
/** Chromium's code for a load replaced by another navigation, which is not a failure. */
const ERR_ABORTED = -3

/** Set on the report page's root element once data, fonts and images have loaded (see pages/reports/print.tsx). */
const READ_STATE = `document.documentElement.dataset.reportState || ''`

async function waitUntilRendered(contents: WebContents): Promise<void> {
  for (;;) {
    const state = (await contents.executeJavaScript(READ_STATE)) as string
    if (state === 'ready') return
    if (state) throw new AppError('INTERNAL', `The report could not be prepared: ${state}`)
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS))
  }
}

/** Rejects if the hidden window dies at any point, so a caller can never wait on it forever. */
function windowLost(win: BrowserWindow): Promise<never> {
  return new Promise((_resolve, reject) => {
    win.webContents.once('render-process-gone', (_e, details) => reject(new AppError('INTERNAL', `The report page stopped working: ${details.reason}`)))
    win.once('closed', () => reject(new AppError('INTERNAL', 'The report window was closed.')))
  })
}

function pageLoaded(win: BrowserWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    win.webContents.once('did-finish-load', () => resolve())
    win.webContents.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== ERR_ABORTED) reject(new AppError('INTERNAL', `The report page did not load: ${description}`))
    })
  })
}

/** A crash can surface first as a failed script call, so anything unexpected means the page was lost. */
async function rendered(win: BrowserWindow): Promise<void> {
  try {
    await pageLoaded(win)
    await waitUntilRendered(win.webContents)
  } catch (err) {
    if (err instanceof AppError) throw err
    log.error('Report page failed', err)
    throw new AppError('INTERNAL', 'The report page stopped working.')
  }
}

function timedOut(): { promise: Promise<never>; cancel: () => void } {
  let timer: NodeJS.Timeout
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new AppError('INTERNAL', 'The report took too long to prepare.')), READY_TIMEOUT_MS)
  })
  return { promise, cancel: () => clearTimeout(timer) }
}

/** Render a report route in a hidden window, use it, and always close the window. */
async function withReportWindow<T>(route: string, use: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const win = createReportWindow(route)
  const lost = windowLost(win)
  const limit = timedOut()
  try {
    await Promise.race([rendered(win), lost, limit.promise])
    limit.cancel()
    return await Promise.race([use(win), lost])
  } finally {
    limit.cancel()
    if (!win.isDestroyed()) win.destroy()
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The running footer. Electron fills pageNumber and totalPages; all other text is escaped. */
function footerTemplate(label: string): string {
  return `<div style="width:100%;padding:0 12mm;font:8px Arial,sans-serif;color:#555;display:flex;justify-content:space-between"><span>${escapeHtml(label)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`
}

export const matchReportRoute = (matchId: string) => `/print/report/${matchId}`
export const seasonReportRoute = (seasonId: string) => `/print/season/${seasonId}`

/** A4 PDF of a report route. */
export function renderReportPdf(route: string, footerLabel: string): Promise<Buffer> {
  return withReportWindow(route, (win) =>
    win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.45, bottom: 0.6, left: 0.45, right: 0.45 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footerTemplate(footerLabel)
    })
  )
}

/** Open the system print dialog for a report route. A cancelled dialog is not an error. */
export function printReport(route: string): Promise<{ printed: boolean }> {
  return withReportWindow(
    route,
    (win) =>
      new Promise((resolve, reject) => {
        win.webContents.print({ printBackground: true, pageSize: 'A4' }, (printed, reason) => {
          if (printed || /cancel/i.test(reason)) resolve({ printed })
          else reject(new AppError('INTERNAL', `The report could not be printed: ${reason}`))
        })
      })
  )
}
