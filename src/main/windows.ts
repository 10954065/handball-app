import { app, BrowserWindow, dialog, screen, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { log } from './logger'

/** The development server is never honoured in an installed copy: it would run with the preload. */
export const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']

const RENDERER_FILE = join(__dirname, '../renderer/index.html')
/** A screen that keeps crashing is left alone rather than reloaded forever. */
const CRASH_WINDOW_MS = 60_000
const MAX_CRASHES = 3

export function rendererOrigins(): string[] {
  return isDev ? [new URL(process.env['ELECTRON_RENDERER_URL']!).origin] : ['file://']
}

/** Reload a screen whose renderer process died. Sign-in and all match data live in the main process. */
function reloadOnCrash(win: BrowserWindow, name: string): void {
  let crashes: number[] = []
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error(`The ${name} screen stopped`, details)
    if (details.reason === 'clean-exit' || win.isDestroyed()) return
    const now = Date.now()
    crashes = [...crashes.filter((t) => now - t < CRASH_WINDOW_MS), now]
    if (crashes.length <= MAX_CRASHES) {
      win.webContents.reload()
      return
    }
    void dialog.showMessageBox({
      type: 'error',
      title: 'HMMS keeps stopping',
      message: `The ${name} screen has stopped several times.`,
      detail: 'Saved data is safe. Close HMMS and open it again. If this keeps happening, send the log folder to your administrator.'
    })
  })
  win.on('unresponsive', () => log.warn(`The ${name} screen is not responding`))
  win.on('responsive', () => log.info(`The ${name} screen is responding again`))
}

function loadRoute(win: BrowserWindow, hash: string): void {
  if (isDev) void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
  else void win.loadFile(RENDERER_FILE, { hash })
}

const secureWebPreferences = (): Electron.WebPreferences => ({
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  spellcheck: false,
  devTools: isDev
})

export function createMainWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const win = new BrowserWindow({
    width: Math.min(1600, width),
    height: Math.min(1000, height),
    minWidth: 1280,
    minHeight: 720,
    show: false,
    backgroundColor: '#0a0f1c',
    title: 'HMMS - Handball Match Management System',
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences()
  })
  win.once('ready-to-show', () => {
    if (width <= 1440) win.maximize()
    win.show()
  })
  reloadOnCrash(win, 'main')
  loadRoute(win, '/')
  return win
}

/** Public scoreboard for a match, on a second monitor or projector when one is connected. */
export function createScoreboardWindow(matchId: string, fullscreen: boolean): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const external = screen.getAllDisplays().find((d) => d.id !== primary.id)
  const target = external ?? primary
  const win = new BrowserWindow({
    x: target.bounds.x + 40,
    y: target.bounds.y + 40,
    width: Math.min(1280, target.workAreaSize.width),
    height: Math.min(720, target.workAreaSize.height),
    minWidth: 640,
    minHeight: 360,
    backgroundColor: '#000000',
    title: 'HMMS Scoreboard',
    autoHideMenuBar: true,
    show: false,
    webPreferences: secureWebPreferences()
  })
  win.once('ready-to-show', () => {
    if (external && fullscreen) win.setFullScreen(true)
    win.show()
  })
  reloadOnCrash(win, 'scoreboard')
  loadScoreboard(win, matchId)
  return win
}

export function loadScoreboard(win: BrowserWindow, matchId: string): void {
  loadRoute(win, `/scoreboard/${matchId}`)
}

/** Never shown: a report rendered at A4 width for PDF export and printing. */
export function createReportWindow(route: string): BrowserWindow {
  const win = new BrowserWindow({ width: 794, height: 1123, show: false, title: 'HMMS report', webPreferences: secureWebPreferences() })
  loadRoute(win, route)
  return win
}

/** Harden every web contents: no navigation away, no new windows, no permission prompts. */
export function hardenContents(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (e, url) => {
    // Comparing paths, not origins: every file on the computer is a file:// address, and dropping
    // one on the window would otherwise replace HMMS with that file.
    const allowed = isDev ? rendererOrigins().some((o) => url.startsWith(o)) : url.split('#')[0] === pathToFileURL(RENDERER_FILE).href
    if (!allowed) e.preventDefault()
  })
  contents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
}
