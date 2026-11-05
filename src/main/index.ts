import { app, BrowserWindow, dialog } from 'electron'
import { AppContext } from './context'
import { AutoBackupScheduler } from './autoBackup'
import { initLogger, log } from './logger'
import { resolvePaths } from './paths'
import { registerIpc } from './ipc/register'
import { systemHandlers } from './ipc/handlers/system'
import { adminHandlers } from './ipc/handlers/admin'
import { lineupHandlers } from './ipc/handlers/lineups'
import { liveHandlers } from './ipc/handlers/live'
import { ctxOf } from './restore'
import { getSettings } from './services/settings'
import { runningClocks, stopAllClocks, tickClocks } from './services/live'
import { handleMediaProtocol, registerMediaScheme } from './mediaProtocol'
import type { HandlerMap } from './ipc/types'
import { createMainWindow, createScoreboardWindow, hardenContents, loadScoreboard, rendererOrigins } from './windows'

/** How often running match clocks are checked for the end of a period and checkpointed. */
const CLOCK_TICK_MS = 250

let ctx: AppContext | null = null
let backups: AutoBackupScheduler | null = null
let scoreboard: BrowserWindow | null = null
let clockTimer: NodeJS.Timeout | null = null
let quitting = false

const handlers: HandlerMap = {
  ...systemHandlers,
  ...adminHandlers,
  ...lineupHandlers,
  ...liveHandlers,
  'live.finish': (input, rc) => {
    const out = liveHandlers['live.finish'](input, rc)
    if (getSettings(rc).backup.onMatchFinalize) void backups?.runOnce('match finalized', true)
    return out
  },
  'live.openScoreboard': ({ matchId }, rc) => {
    const fullscreen = getSettings(rc).scoreboard.fullscreen
    if (scoreboard && !scoreboard.isDestroyed()) {
      loadScoreboard(scoreboard, matchId)
      scoreboard.show()
      scoreboard.focus()
      return
    }
    scoreboard = createScoreboardWindow(matchId, fullscreen)
    scoreboard.on('closed', () => (scoreboard = null))
  },
  'settings.update': async (input, rc) => {
    const next = await systemHandlers['settings.update'](input, rc)
    backups?.reschedule()
    return next
  }
}
let mainWindow: BrowserWindow | null = null

// Isolated data folder for automated end-to-end tests.
if (process.env.HMMS_USER_DATA) app.setPath('userData', process.env.HMMS_USER_DATA)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  registerMediaScheme()
  app.setAppUserModelId('gh.hmms.desktop')
  app.on('web-contents-created', (_e, contents) => hardenContents(contents))

  process.on('uncaughtException', (err) => log.error('Uncaught exception', err))
  process.on('unhandledRejection', (err) => log.error('Unhandled rejection', err))

  app.whenReady().then(() => {
    const paths = resolvePaths()
    initLogger(paths.logDir)
    log.info(`HMMS ${app.getVersion()} starting`, { userData: paths.root })
    try {
      ctx = new AppContext(paths, 'production')
    } catch (err) {
      log.error('Failed to open database', err)
      dialog.showErrorBox(
        'HMMS cannot open its database',
        `${(err as Error).message}\n\nYour data has not been modified. Restore a backup from ${paths.backupDir} or contact support.`
      )
      app.exit(1)
      return
    }
    registerIpc(ctx, handlers, rendererOrigins())
    handleMediaProtocol(ctx)
    backups = new AutoBackupScheduler(ctx)
    backups.reschedule()
    clockTimer = setInterval(tickLiveClocks, CLOCK_TICK_MS)
    mainWindow = createMainWindow()
    mainWindow.on('close', confirmCloseWhileClockRuns)
    mainWindow.on('closed', () => {
      mainWindow = null
      if (scoreboard && !scoreboard.isDestroyed()) scoreboard.close()
    })
  })

  app.on('window-all-closed', () => app.quit())

  app.on('before-quit', (e) => {
    if (quitting || !ctx) return
    e.preventDefault()
    quitting = true
    if (clockTimer) clearInterval(clockTimer)
    try {
      stopAllClocks(ctxOf(ctx), 'Application closed')
    } catch (err) {
      log.error('Could not stop running match clocks', err)
    }
    backups?.stop()
    void backups?.runOnce('shutdown').finally(() => {
      try {
        ctx?.close()
      } catch (err) {
        log.error('Error closing database', err)
      }
      app.quit()
    })
  })
}

let tickFailed = false

function tickLiveClocks(): void {
  if (!ctx) return
  try {
    for (const matchId of tickClocks(ctxOf(ctx))) ctx.broadcast('live.changed', { matchId })
    tickFailed = false
  } catch (err) {
    if (!tickFailed) log.error('Match clock tick failed', err)
    tickFailed = true
  }
}

/** Closing the window while a match clock runs needs confirmation; the clock is then stopped. */
function confirmCloseWhileClockRuns(e: Electron.Event): void {
  // During shutdown the clocks were already stopped and the database is closed.
  if (quitting || !ctx || !mainWindow || runningClocks(ctxOf(ctx)).length === 0) return
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning',
    buttons: ['Keep HMMS open', 'Stop the clock and close'],
    defaultId: 0,
    cancelId: 0,
    title: 'Match clock is running',
    message: 'A match clock is running.',
    detail: 'Closing HMMS stops the clock. The match is saved and can be continued when HMMS is opened again.'
  })
  if (choice === 0) {
    e.preventDefault()
    return
  }
  stopAllClocks(ctxOf(ctx), 'Application closed by the operator')
}
