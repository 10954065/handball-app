import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import { basename } from 'node:path'
import { AppError } from '@shared/errors'
import type { AppContext } from './context'
import { log } from './logger'
import { audit } from './services/audit'
import { createBackup, recordBackup, verifyDatabaseFile } from './services/backup'
import type { Ctx } from './services/ctx'

export const ctxOf = (app: AppContext): Ctx => ({ db: app.db, sqlite: app.sqlite, user: app.session, mode: app.mode })

/**
 * Restore the active database from a backup file.
 *  1. Verify the candidate (integrity check, HMMS tables) without modifying it.
 *  2. Create a verified pre-restore backup of the current database.
 *  3. Close the database, replace the file atomically, remove stale WAL/SHM files.
 *  4. Reopen (pending migrations run). On failure the pre-restore backup is put back.
 */
export async function restoreDatabase(app: AppContext, source: string): Promise<{ restored: boolean; preRestoreBackup: string }> {
  const check = verifyDatabaseFile(source)
  if (!check.ok) throw new AppError('VALIDATION', `This backup cannot be restored. ${check.reason}`)

  const actor = app.session
  const pre = await createBackup(ctxOf(app), app.paths.backupDirFor(app.mode), 'pre_restore', `Before restoring ${basename(source)}`)
  const target = app.paths.dbFile(app.mode)
  const staging = `${target}.restoring`

  const clearSidecars = () => {
    for (const ext of ['-wal', '-shm']) if (existsSync(target + ext)) rmSync(target + ext)
  }

  app.withClosedDatabase(
    () => {
      copyFileSync(source, staging)
      clearSidecars()
      renameSync(staging, target)
    },
    () => {
      if (existsSync(staging)) rmSync(staging)
      clearSidecars()
      copyFileSync(pre.filePath, target)
    }
  )

  const ctx = { ...ctxOf(app), user: actor }
  recordBackup(ctx, { ...pre, createdBy: actor?.username ?? null })
  audit(ctx, { action: 'backup.restore', entity: 'database', note: `Restored from ${basename(source)}; previous data saved as ${pre.fileName}` })
  log.info('Database restored', { source, preRestore: pre.filePath })
  return { restored: true, preRestoreBackup: pre.filePath }
}
