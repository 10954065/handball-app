import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

export function rendererOrigins(): string[] {
  return isDev ? [new URL(process.env['ELECTRON_RENDERER_URL']!).origin] : ['file://']
}

function loadRoute(win: BrowserWindow, hash: string): void {
  if (isDev) void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
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
  loadScoreboard(win, matchId)
  return win
}

export function loadScoreboard(win: BrowserWindow, matchId: string): void {
  loadRoute(win, `/scoreboard/${matchId}`)
}

/** Never shown: a match report rendered at A4 width for PDF export and printing. */
export function createReportWindow(matchId: string): BrowserWindow {
  const win = new BrowserWindow({ width: 794, height: 1123, show: false, title: 'HMMS report', webPreferences: secureWebPreferences() })
  loadRoute(win, `/print/report/${matchId}`)
  return win
}

/** Harden every web contents: no navigation away, no new windows, no permission prompts. */
export function hardenContents(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (e, url) => {
    if (!rendererOrigins().some((o) => url.startsWith(o))) e.preventDefault()
  })
  contents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
}
