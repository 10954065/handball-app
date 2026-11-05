import { app, BrowserWindow, dialog } from 'electron'
import { AppContext } from './context'
import { AutoBackupScheduler } from './autoBackup'
import { initLogger, log } from './logger'
import { resolvePaths } from './paths'
import { registerIpc } from './ipc/register'
import { systemHandlers } from './ipc/handlers/system'
import { adminHandlers } from './ipc/handlers/admin'
import { handleMediaProtocol, registerMediaScheme } from './mediaProtocol'
import type { HandlerMap } from './ipc/types'
import { createMainWindow, hardenContents, rendererOrigins } from './windows'

let ctx: AppContext | null = null
let backups: AutoBackupScheduler | null = null

const handlers: HandlerMap = {
  ...systemHandlers,
  ...adminHandlers,
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
    mainWindow = createMainWindow()
    mainWindow.on('closed', () => (mainWindow = null))
  })

  app.on('window-all-closed', () => app.quit())

  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting || !ctx) return
    e.preventDefault()
    quitting = true
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
