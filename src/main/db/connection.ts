import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { bundledMigrations, pendingMigrations, runMigrations, unknownMigrations } from './migrate'

export type Db = BetterSQLite3Database<typeof schema>

export interface DbHandle {
  file: string
  sqlite: Database.Database
  db: Db
  appliedMigrations: string[]
}

/** The data is healthy but must not be opened as it is. Restoring a backup is the wrong answer. */
export class DatabaseRefused extends Error {}

/** The file itself failed a check. */
export class DatabaseDamaged extends Error {}

/**
 * True only when the file itself is bad. A locked file, a full disk or a failed migration leave
 * healthy data behind, and replacing that with a backup would lose work for nothing.
 */
export function isDamage(err: unknown): boolean {
  if (err instanceof DatabaseDamaged) return true
  if (!(err instanceof Error)) return false
  const code = (err as { code?: unknown }).code
  return (typeof code === 'string' && /^SQLITE_(CORRUPT|NOTADB)/.test(code)) || isDamage(err.cause)
}

export interface OpenOptions {
  /** Called before an existing database is migrated. Throw to leave it untouched. */
  beforeMigrate?: (sqlite: Database.Database) => void
}

/**
 * Open (or create) an HMMS database.
 *  - WAL journal for crash safety and concurrent reads.
 *  - synchronous=FULL: every committed match event is durable even on power loss.
 *  - foreign keys enforced.
 * On failure the file is released, so it can be moved or replaced.
 */
export function openDatabase(file: string, { beforeMigrate }: OpenOptions = {}): DbHandle {
  const sqlite = new Database(file)
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('synchronous = FULL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')
    const pending = pendingMigrations(sqlite)
    if (unknownMigrations(sqlite).length) {
      throw new DatabaseRefused('This data was saved by a newer version of HMMS. Install that version or a later one. Your data has not been changed.')
    }
    const existing = pending.length < bundledMigrations.length
    if (pending.length && existing) beforeMigrate?.(sqlite)
    const appliedMigrations = runMigrations(sqlite)
    return { file, sqlite, db: drizzle(sqlite, { schema }), appliedMigrations }
  } catch (err) {
    sqlite.close()
    throw err
  }
}

export interface IntegrityReport {
  ok: boolean
  integrity: string[]
  foreignKeyViolations: number
}

export function checkIntegrity(sqlite: Database.Database): IntegrityReport {
  const integrity = (sqlite.pragma('integrity_check') as { integrity_check: string }[]).map((r) => r.integrity_check)
  const fk = sqlite.pragma('foreign_key_check') as unknown[]
  return { ok: integrity.length === 1 && integrity[0] === 'ok' && fk.length === 0, integrity, foreignKeyViolations: fk.length }
}

export function closeDatabase(handle: DbHandle): void {
  try {
    handle.sqlite.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    handle.sqlite.close()
  }
}
