import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { log } from './logger'
import { verifyDatabaseFile } from './services/backup'

const SESSION_MARKER = 'hmms.running'

export interface UsableBackup {
  file: string
  takenAt: number
}

/** The newest file in a folder that passes full verification. Older or damaged files are skipped. */
export function latestGoodBackup(dir: string): UsableBackup | null {
  if (!existsSync(dir)) return null
  const candidates = readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({ file: join(dir, f), takenAt: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.takenAt - a.takenAt)
  return candidates.find((c) => verifyDatabaseFile(c.file).ok) ?? null
}

function unusedFolder(parent: string, at: number): string {
  const name = `damaged-${new Date(at).toISOString().replace(/[:.]/g, '-')}`
  for (let n = 1; ; n++) {
    const folder = join(parent, n === 1 ? name : `${name}-${n}`)
    if (!existsSync(folder)) return folder
  }
}

/**
 * Replace a database that cannot be used. Nothing is erased: the database and its journal files
 * move to a dated folder beside it. The backup is copied first, so a full disk changes nothing,
 * and the journals move first, so they can never be replayed onto the restored file. If a step
 * fails the files are put back. Returns the folder holding the old files.
 */
export function installBackup(source: string, dbFile: string, at = Date.now()): string {
  const check = verifyDatabaseFile(source)
  if (!check.ok) throw new Error(`This backup cannot be used. ${check.reason}`)
  const staging = `${dbFile}.restoring`
  copyFileSync(source, staging)
  const kept = unusedFolder(dirname(dbFile), at)
  mkdirSync(kept)
  const moved: string[] = []
  try {
    for (const file of [`${dbFile}-wal`, `${dbFile}-shm`, dbFile]) {
      if (!existsSync(file)) continue
      renameSync(file, join(kept, basename(file)))
      moved.push(file)
    }
    renameSync(staging, dbFile)
    return kept
  } catch (err) {
    for (const file of moved) renameSync(join(kept, basename(file)), file)
    rmSync(staging, { force: true })
    rmSync(kept, { recursive: true, force: true })
    throw err
  }
}

/** Note that HMMS is running. Returns true if the previous session never closed. */
export function beginSession(root: string): boolean {
  const marker = join(root, SESSION_MARKER)
  const unclean = existsSync(marker)
  try {
    writeFileSync(marker, new Date().toISOString())
  } catch (err) {
    log.warn('Could not write the session marker', err)
  }
  return unclean
}

export function endSession(root: string): void {
  try {
    rmSync(join(root, SESSION_MARKER), { force: true })
  } catch (err) {
    log.warn('Could not remove the session marker', err)
  }
}
