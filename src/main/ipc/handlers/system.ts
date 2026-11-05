import { app as electronApp, dialog, shell, BrowserWindow } from 'electron'
import { randomBytes } from 'node:crypto'
import { basename } from 'node:path'
import { AppError } from '@shared/errors'
import type { HandlerMap } from '../types'
import { checkIntegrity } from '../../db/connection'
import { listAudit } from '../../services/audit'
import * as auth from '../../services/auth'
import { createBackup, getBackup, listBackups } from '../../services/backup'
import { getSettings, updateSettings } from '../../services/settings'
import { restoreDatabase } from '../../restore'
import type { AppContext } from '../../context'
import { seedDemoData } from '../../services/demo'

const DEMO_USER = 'demo'

/** In demonstration mode the operator is signed in automatically as the demo administrator. */
async function ensureDemoSession(app: AppContext): Promise<void> {
  const ctx = { db: app.db, sqlite: app.sqlite, user: null, mode: app.mode }
  if (auth.needsSetup(ctx)) {
    await auth.setupAdmin(ctx, { username: DEMO_USER, displayName: 'Demo Administrator', password: `Demo-${randomBytes(12).toString('hex')}1` })
  }
  const row = auth.listUsers(ctx).find((u) => u.username === DEMO_USER)
  if (!row) throw new AppError('INTERNAL', 'Demo administrator missing.')
  app.session = auth.toSession(row)
  seedDemoData({ ...ctx, user: app.session })
  app.broadcast('session.changed', { user: app.session })
}

function parentWindow(sender: Electron.WebContents) {
  return BrowserWindow.fromWebContents(sender) ?? undefined
}

export const systemHandlers = {
  'app.info': (_i, { app, sqlite }) => ({
    name: 'HMMS',
    version: electronApp.getVersion(),
    mode: app.mode,
    dataDir: app.paths.dataDir,
    dbFile: app.paths.dbFile(app.mode),
    backupDir: app.paths.backupDirFor(app.mode),
    logDir: app.paths.logDir,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    sqlite: (sqlite.prepare('select sqlite_version() as v').get() as { v: string }).v,
    platform: `${process.platform} ${process.arch}`
  }),
  'app.openDataFolder': async (_i, { app }) => {
    await shell.openPath(app.paths.root)
  },

  'auth.status': (_i, ctx) => ({ needsSetup: auth.needsSetup(ctx), user: ctx.app.session, mode: ctx.app.mode }),
  'auth.setup': async (input, ctx) => {
    const user = await auth.setupAdmin(ctx, input)
    if (input.organisationName) updateSettings({ ...ctx, user }, { organisationName: input.organisationName })
    ctx.app.session = user
    ctx.app.broadcast('session.changed', { user })
    return user
  },
  'auth.login': async (input, ctx) => {
    const user = await auth.login(ctx, input)
    ctx.app.session = user
    ctx.app.broadcast('session.changed', { user })
    return user
  },
  'auth.logout': (_i, { app }) => {
    app.session = null
    app.broadcast('session.changed', { user: null })
  },
  'auth.changePassword': (input, ctx) => auth.changePassword(ctx, input),
  'users.list': (_i, ctx) => auth.listUsers(ctx),
  'users.create': (input, ctx) => auth.createUser(ctx, input),
  'users.update': (input, ctx) => auth.updateUser(ctx, input),

  'settings.get': (_i, ctx) => getSettings(ctx),
  'settings.update': (input, ctx) => {
    const next = updateSettings(ctx, input)
    ctx.app.broadcast('settings.changed', next)
    return next
  },

  'backup.list': (_i, ctx) => listBackups(ctx),
  'backup.create': (input, ctx) => createBackup(ctx, ctx.app.paths.backupDirFor(ctx.mode), 'manual', input.note),
  'backup.exportToFolder': async (_i, ctx) => {
    const res = await dialog.showOpenDialog(parentWindow(ctx.sender)!, {
      title: 'Choose a folder or USB drive for the backup',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    const b = await createBackup(ctx, res.filePaths[0], 'external', 'Exported backup')
    return { path: b.filePath }
  },
  'backup.restoreFromFile': async (_i, ctx) => {
    const res = await dialog.showOpenDialog(parentWindow(ctx.sender)!, {
      title: 'Select an HMMS backup to restore',
      properties: ['openFile'],
      filters: [{ name: 'HMMS database backup', extensions: ['db'] }]
    })
    if (res.canceled || !res.filePaths[0]) return { restored: false }
    const confirm = await dialog.showMessageBox(parentWindow(ctx.sender)!, {
      type: 'warning',
      buttons: ['Restore', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Restore database',
      message: `Replace all current data with "${basename(res.filePaths[0])}"?`,
      detail: 'A verified backup of the current data is created first, so this can be undone.'
    })
    if (confirm.response !== 0) return { restored: false }
    return restoreDatabase(ctx.app, res.filePaths[0])
  },
  'backup.restoreFromHistory': async (input, ctx) => {
    const b = getBackup(ctx, input.id)
    if (!b.exists) throw new AppError('NOT_FOUND', 'The backup file no longer exists on disk.')
    return restoreDatabase(ctx.app, b.filePath)
  },
  'db.integrity': (_i, ctx) => ({ ...checkIntegrity(ctx.sqlite), checkedAt: Date.now() }),
  'audit.list': (input, ctx) => listAudit(ctx, input),

  'demo.enter': async (_i, { app }) => {
    if (app.mode !== 'demo') app.reopen('demo')
    await ensureDemoSession(app)
  },
  'demo.exit': (_i, { app }) => {
    if (app.mode !== 'production') app.reopen('production')
  }
} satisfies Partial<HandlerMap>
