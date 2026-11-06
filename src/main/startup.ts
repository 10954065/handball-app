import { dialog } from 'electron'
import { existsSync } from 'node:fs'
import { checkIntegrity, DatabaseDamaged, DatabaseRefused, isDamage } from './db/connection'
import { AppContext } from './context'
import { log } from './logger'
import type { AppPaths } from './paths'
import { beginSession, installBackup, latestGoodBackup, type UsableBackup } from './recovery'
import { ctxOf } from './restore'
import { audit } from './services/audit'

interface Recovered {
  source: string
  kept: string
}

const takenOn = (backup: UsableBackup) => new Date(backup.takenAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })

async function chooseBackupFile(): Promise<string | null> {
  const res = await dialog.showOpenDialog({
    title: 'Select an HMMS backup to restore',
    properties: ['openFile'],
    filters: [{ name: 'HMMS database backup', extensions: ['db'] }]
  })
  return res.canceled ? null : (res.filePaths[0] ?? null)
}

/** Ask what to do about a database that cannot be used. Returns the file to restore, or null to quit. */
async function askForBackup(paths: AppPaths, reason: string): Promise<string | null> {
  const latest = latestGoodBackup(paths.backupDir)
  const buttons = latest ? ['Restore the latest backup', 'Choose a backup file', 'Quit HMMS'] : ['Choose a backup file', 'Quit HMMS']
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'HMMS cannot open its data',
    message: 'The HMMS data file cannot be used.',
    detail: `${reason}\n\n${latest ? `The latest good backup is from ${takenOn(latest)}. Anything entered after that time will not be in it.` : 'No usable backup was found in the backups folder. You can choose one from a USB drive or another folder.'}\n\nThe damaged file is kept, never erased. If you quit, nothing changes.`,
    buttons,
    // Replacing data is never what pressing Enter does.
    defaultId: buttons.length - 1,
    cancelId: buttons.length - 1,
    noLink: true
  })
  const choice = buttons[response]
  if (choice === 'Restore the latest backup') return latest?.file ?? null
  return choice === 'Choose a backup file' ? chooseBackupFile() : null
}

async function restoreAfterDamage(paths: AppPaths, reason: string): Promise<Recovered | null> {
  const source = await askForBackup(paths, reason)
  if (!source) return null
  try {
    const kept = installBackup(source, paths.dbFile('production'))
    log.warn('Restored a backup after the data could not be opened', { source, kept })
    return { source, kept }
  } catch (err) {
    log.error('Could not restore the backup', err)
    await dialog.showMessageBox({ type: 'error', title: 'Backup not restored', message: (err as Error).message, detail: 'The current files are as they were.', buttons: ['OK'] })
    return restoreAfterDamage(paths, reason)
  }
}

/**
 * Open the production database, offering a backup if it cannot be used. After a session that did
 * not close, the file is checked in full: damage from a power cut should show now, not mid-match.
 * Returns null if HMMS should quit.
 */
export async function openDataOrRecover(paths: AppPaths): Promise<AppContext | null> {
  const unclean = beginSession(paths.root)
  if (unclean) log.warn('The previous session did not close properly')
  let check = unclean
  let recovered: Recovered | null = null
  for (;;) {
    let app: AppContext | null = null
    try {
      // Opening a missing file would create an empty one and quietly start again from nothing.
      if (!existsSync(paths.dbFile('production')) && latestGoodBackup(paths.backupDir)) throw new DatabaseDamaged('The data file is missing.')
      app = new AppContext(paths, 'production')
      if (check) {
        const report = checkIntegrity(app.sqlite)
        if (report.integrity.join() !== 'ok') throw new DatabaseDamaged(`Integrity check failed: ${report.integrity.join('; ')}`)
      }
      if (recovered) {
        audit(ctxOf(app), { action: 'backup.recover', entity: 'database', note: `Restored from ${recovered.source} when HMMS started; damaged files kept in ${recovered.kept}` })
        await dialog.showMessageBox({
          type: 'info',
          title: 'Backup restored',
          message: 'HMMS restored the backup.',
          detail: `Check the latest matches and anything entered recently: work done after the backup was taken is not included.\n\nThe damaged files were kept in:\n${recovered.kept}`,
          buttons: ['Continue']
        })
      }
      return app
    } catch (err) {
      try {
        app?.close()
      } catch (closeErr) {
        log.error('Error closing the database', closeErr)
      }
      log.error('Failed to open the database', err)
      if (err instanceof DatabaseRefused) {
        dialog.showErrorBox('HMMS cannot start', err.message)
        return null
      }
      if (!isDamage(err)) {
        dialog.showErrorBox(
          'HMMS cannot start',
          `${(err as Error).message}\n\nYour data is safe. Restart the computer and try again. If this keeps happening, send the log folder to your support contact:\n${paths.logDir}`
        )
        return null
      }
      recovered = await restoreAfterDamage(paths, (err as Error).message)
      if (!recovered) return null
      check = true
    }
  }
}
