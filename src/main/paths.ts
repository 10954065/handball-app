import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DataMode } from '@shared/dto'

/**
 * All persistent data lives in the per-user application data directory
 * (%APPDATA%\HMMS on Windows), never inside the installation folder.
 */
export interface AppPaths {
  root: string
  dataDir: string
  backupDir: string
  logDir: string
  dbFile(mode: DataMode): string
  backupDirFor(mode: DataMode): string
}

export function resolvePaths(root = app.getPath('userData')): AppPaths {
  const dataDir = join(root, 'data')
  const backupDir = join(root, 'backups')
  const logDir = join(root, 'logs')
  for (const d of [dataDir, backupDir, join(backupDir, 'demo'), logDir]) mkdirSync(d, { recursive: true })
  return {
    root,
    dataDir,
    backupDir,
    logDir,
    dbFile: (mode) => join(dataDir, mode === 'demo' ? 'hmms-demo.db' : 'hmms.db'),
    backupDirFor: (mode) => (mode === 'demo' ? join(backupDir, 'demo') : backupDir)
  }
}
