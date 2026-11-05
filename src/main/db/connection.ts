import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { runMigrations } from './migrate'

export type Db = BetterSQLite3Database<typeof schema>

export interface DbHandle {
  file: string
  sqlite: Database.Database
  db: Db
  appliedMigrations: string[]
}

/**
 * Open (or create) an HMMS database.
 *  - WAL journal for crash safety and concurrent reads.
 *  - synchronous=FULL: every committed match event is durable even on power loss.
 *  - foreign keys enforced.
 */
export function openDatabase(file: string): DbHandle {
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = FULL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  const appliedMigrations = runMigrations(sqlite)
  return { file, sqlite, db: drizzle(sqlite, { schema }), appliedMigrations }
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
