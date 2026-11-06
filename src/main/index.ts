import { app, BrowserWindow, dialog, Menu, powerMonitor, powerSaveBlocker } from 'electron'
import { release } from 'node:os'
import type { AppContext } from './context'
import { AutoBackupScheduler } from './autoBackup'
import { initLogger, log } from './logger'
import { resolvePaths } from './paths'
import { registerIpc } from './ipc/register'
import { systemHandlers } from './ipc/handlers/system'
import { adminHandlers } from './ipc/handlers/admin'
import { lineupHandlers } from './ipc/handlers/lineups'
import { liveHandlers } from './ipc/handlers/live'
import { reportHandlers } from './ipc/handlers/reports'
import { visionHandlers } from './ipc/handlers/vision'
import { endSession } from './recovery'
import { ctxOf } from './restore'
import type { Ctx } from './services/ctx'
import { getSettings } from './services/settings'
import { runningClocks, stopAllClocks, tickClocks, tickTimeouts } from './services/live'
import { liveMatchIds } from './services/matches'
import { expireSuggestions, proposeSuggestion } from './services/suggestions'
import { handleMediaProtocol, handleVisionProtocol, registerMediaScheme } from './mediaProtocol'
import type { HandlerMap } from './ipc/types'
import { openDataOrRecover } from './startup'
import { feeds, suggestions, vision } from './vision/instance'
import { createMainWindow, createScoreboardWindow, hardenContents, isDev, loadScoreboard, rendererOrigins } from './windows'

/** How often running match clocks are checked for the end of a period and checkpointed. */
const CLOCK_TICK_MS = 250
/** Ticks this far apart mean the computer slept, even if Windows never said so. */
const SLEEP_GAP_MS = 30_000

let ctx: AppContext | null = null
let backups: AutoBackupScheduler | null = null
let scoreboard: BrowserWindow | null = null
let clockTimer: NodeJS.Timeout | null = null
let sleepBlocker: number | null = null
let lastTick = { wall: Date.now(), mono: performance.now() }
let quitting = false
let warnedOfError = false

const handlers: HandlerMap = {
  ...systemHandlers,
  ...adminHandlers,
  ...lineupHandlers,
  ...liveHandlers,
  ...reportHandlers,
  ...visionHandlers,
  'live.finish': (input, rc) => {
    const out = liveHandlers['live.finish'](input, rc)
    expireSuggestions(rc, input.matchId)
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

  process.on('uncaughtException', warnOfUnexpectedError)
  process.on('unhandledRejection', (err) => log.error('Unhandled rejection', err))
  app.on('child-process-gone', (_e, details) => log.warn('A helper process stopped', details))

  void app.whenReady().then(startApplication).catch((err: unknown) => {
    log.error('HMMS could not start', err)
    dialog.showErrorBox('HMMS could not start', `${(err as Error).message}\n\nYour saved data has not been changed.`)
    app.exit(1)
  })

  async function startApplication(): Promise<void> {
    const paths = resolvePaths()
    initLogger(paths.logDir)
    log.info(`HMMS ${app.getVersion()} starting`, { userData: paths.root, windows: release(), packaged: app.isPackaged })
    if (!isDev) Menu.setApplicationMenu(null)
    ctx = await openDataOrRecover(paths)
    if (!ctx) {
      app.exit(1)
      return
    }
    suggestions.handle = takeSuggestion
    // The scoreboard shows a match from the database that has just been closed.
    ctx.onReopen(() => {
      scoreboard?.close()
      void feeds.closeAll()
    })
    registerIpc(ctx, handlers, rendererOrigins())
    handleMediaProtocol(ctx)
    handleVisionProtocol(ctx, feeds)
    backups = new AutoBackupScheduler(ctx)
    backups.reschedule()
    clockTimer = setInterval(tickLiveClocks, CLOCK_TICK_MS)
    powerMonitor.on('suspend', () => stopClocksForSleep(performance.now()))
    mainWindow = createMainWindow()
    mainWindow.on('close', confirmCloseWhileClockRuns)
    mainWindow.on('closed', () => {
      mainWindow = null
      if (scoreboard && !scoreboard.isDestroyed()) scoreboard.close()
    })
  }

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
    void Promise.allSettled([vision.stop(), backups?.runOnce('shutdown')]).finally(() => {
      try {
        ctx?.close()
        if (ctx) endSession(ctx.paths.root)
      } catch (err) {
        log.error('Error closing database', err)
      }
      app.quit()
    })
  })
}

const failedTicks = new Set<string>()

/** Run one tick. Each is independent: a failing clock tick must not stop time-outs from ending. */
function runTick(name: string, tick: (c: Ctx) => string[]): string[] {
  try {
    const changed = ctx ? tick(ctxOf(ctx)) : []
    failedTicks.delete(name)
    return changed
  } catch (err) {
    if (!failedTicks.has(name)) log.error(`Live tick failed: ${name}`, err)
    failedTicks.add(name)
    return []
  }
}

function tickLiveClocks(): void {
  const now = { wall: Date.now(), mono: performance.now() }
  if (Math.max(now.wall - lastTick.wall, now.mono - lastTick.mono) > SLEEP_GAP_MS) stopClocksForSleep(lastTick.mono)
  lastTick = now
  for (const matchId of new Set([...runTick('clocks', tickClocks), ...runTick('time-outs', tickTimeouts)])) {
    ctx?.broadcast('live.changed', { matchId })
  }
  keepComputerAwake(runTick('live matches', liveMatchIds).length > 0)
}

/** A camera's opinion. It lands in the review queue and goes no further until an official acts. */
function takeSuggestion(s: Parameters<NonNullable<typeof suggestions.handle>>[0]): void {
  const matchId = suggestions.matchId
  if (!ctx || !matchId) return
  try {
    const stored = proposeSuggestion(ctxOf(ctx), { matchId, category: s.category, side: s.side, jersey: s.jersey, trackId: s.trackId, confidence: s.confidence, cameraId: s.camera, ageMs: s.ageMs, evidence: s.evidence })
    if (stored) ctx.broadcast('suggestions.changed', { matchId })
  } catch (err) {
    log.error('Could not store a suggestion', err)
  }
}

/** The screens stay on for the whole of a live match, including breaks with the clock stopped. */
function keepComputerAwake(awake: boolean): void {
  if (awake && sleepBlocker === null) {
    sleepBlocker = powerSaveBlocker.start('prevent-display-sleep')
    log.info('A match is live: keeping the computer awake')
  } else if (!awake && sleepBlocker !== null) {
    powerSaveBlocker.stop(sleepBlocker)
    sleepBlocker = null
    log.info('No match is live: the computer may sleep again')
  }
}

/**
 * Sleep cannot always be prevented (a closed lid). Time asleep must not count as playing time,
 * so the clocks stop at the given moment: now if Windows reports sleep, otherwise the last tick.
 */
function stopClocksForSleep(atMono: number): void {
  if (!ctx) return
  try {
    for (const matchId of stopAllClocks({ ...ctxOf(ctx), mono: () => atMono }, 'The computer went to sleep')) {
      log.warn('Stopped the match clock because the computer went to sleep', { matchId })
      ctx.broadcast('live.changed', { matchId })
    }
  } catch (err) {
    log.error('Could not stop the match clocks before sleep', err)
  }
}

/** Keep running: a modal box would block the clock, and every saved action is already on disk. */
function warnOfUnexpectedError(err: Error): void {
  log.error('Uncaught exception', err)
  if (warnedOfError || !app.isReady()) return
  warnedOfError = true
  void dialog.showMessageBox({
    type: 'warning',
    title: 'HMMS hit a problem',
    message: 'Something unexpected went wrong.',
    detail: 'Saved data is safe. You can carry on, but if anything looks wrong, close HMMS and open it again. The details are in the log folder.'
  })
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
  // The box stops the ticks while it is open. That is not sleep, and the clock kept running.
  lastTick = { wall: Date.now(), mono: performance.now() }
  if (choice === 0) {
    e.preventDefault()
    return
  }
  stopAllClocks(ctxOf(ctx), 'Application closed by the operator')
}
