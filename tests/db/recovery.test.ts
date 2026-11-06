import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, DatabaseRefused, openDatabase } from '../../src/main/db/connection'
import { bundledMigrations } from '../../src/main/db/migrate'
import { beginSession, endSession, installBackup, latestGoodBackup } from '../../src/main/recovery'
import { listBackups, recordSnapshot, snapshotBeforeUpdate, verifyDatabaseFile } from '../../src/main/services/backup'

let dir: string
let dbFile: string
let backups: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hmms-recovery-'))
  dbFile = join(dir, 'hmms.db')
  backups = mkdtempSync(join(tmpdir(), 'hmms-recovery-backups-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(backups, { recursive: true, force: true })
})

/** A healthy database containing one recognisable value. */
function healthyDatabase(file: string, marker: string): void {
  const h = openDatabase(file)
  h.sqlite.exec(`CREATE TABLE IF NOT EXISTS marker (value TEXT); INSERT INTO marker VALUES ('${marker}')`)
  closeDatabase(h)
}

const markerIn = (file: string): string => {
  const db = new Database(file, { readonly: true })
  try {
    return (db.prepare('SELECT value FROM marker').get() as { value: string }).value
  } finally {
    db.close()
  }
}

const damage = (file: string) => writeFileSync(file, 'this is not a database, the disk failed here'.repeat(200))

const age = (file: string, minutes: number) => {
  const t = new Date(Date.now() - minutes * 60_000)
  utimesSync(file, t, t)
}

const newest = bundledMigrations[bundledMigrations.length - 1]

/** Make an existing database look as if the newest migration has not been applied yet. */
function rewindNewestMigration(file: string): void {
  const db = new Database(file)
  db.exec('DROP TABLE IF EXISTS knockout_ties')
  db.prepare('DELETE FROM __hmms_migrations WHERE id = ?').run(newest.id)
  db.close()
}

const hasNewest = (file: string): boolean => {
  const db = new Database(file, { readonly: true })
  try {
    return (db.prepare('SELECT count(*) AS n FROM __hmms_migrations WHERE id = ?').get(newest.id) as { n: number }).n === 1
  } finally {
    db.close()
  }
}

describe('opening a database', () => {
  it('releases the file when it cannot be opened, so it can be moved aside', () => {
    damage(dbFile)
    expect(() => openDatabase(dbFile)).toThrow()
    rmSync(dbFile)
    expect(existsSync(dbFile)).toBe(false)
  })

  it('refuses data saved by a newer version and leaves the file unchanged', () => {
    healthyDatabase(dbFile, 'new')
    const h = openDatabase(dbFile)
    h.sqlite.prepare('INSERT INTO __hmms_migrations (id, applied_at) VALUES (?, ?)').run('9999_from_the_future', 1)
    closeDatabase(h)
    const before = readFileSync(dbFile)
    expect(() => openDatabase(dbFile)).toThrow(DatabaseRefused)
    expect(() => openDatabase(dbFile)).toThrow(/newer version of HMMS/)
    expect(readFileSync(dbFile).equals(before)).toBe(true)
  })

  it('makes no copy of a brand new database', () => {
    const calls: number[] = []
    closeDatabase(openDatabase(dbFile, { beforeMigrate: () => calls.push(1) }))
    expect(calls).toEqual([])
  })

  it('makes no copy when nothing needs to change', () => {
    healthyDatabase(dbFile, 'current')
    const calls: number[] = []
    closeDatabase(openDatabase(dbFile, { beforeMigrate: () => calls.push(1) }))
    expect(calls).toEqual([])
  })

  it('takes the copy before an existing database is changed', () => {
    healthyDatabase(dbFile, 'existing')
    rewindNewestMigration(dbFile)
    const seen: boolean[] = []
    const h = openDatabase(dbFile, { beforeMigrate: () => seen.push(hasNewest(dbFile)) })
    expect(seen).toEqual([false])
    expect(h.appliedMigrations).toEqual([newest.id])
    closeDatabase(h)
  })

  it('changes nothing when the copy cannot be made', () => {
    healthyDatabase(dbFile, 'keep')
    rewindNewestMigration(dbFile)
    const refuse = () => {
      throw new DatabaseRefused('No room for a copy.')
    }
    expect(() => openDatabase(dbFile, { beforeMigrate: refuse })).toThrow(/No room/)
    expect(hasNewest(dbFile)).toBe(false)
  })
})

describe('the copy made before an update', () => {
  it('is a complete, verified copy that appears in the backup history', () => {
    healthyDatabase(dbFile, 'before update')
    const h = openDatabase(dbFile)
    const file = snapshotBeforeUpdate(h.sqlite, backups, 'production', Date.UTC(2026, 10, 6, 9))
    expect(verifyDatabaseFile(file).ok).toBe(true)
    expect(markerIn(file)).toBe('before update')
    const ctx = { db: h.db, sqlite: h.sqlite, user: null, mode: 'production' as const }
    recordSnapshot(ctx, file)
    expect(listBackups(ctx)[0]).toMatchObject({ kind: 'pre_update', filePath: file, exists: true })
    closeDatabase(h)
  })

  it('copes with a folder name containing an apostrophe', () => {
    healthyDatabase(dbFile, 'quoted')
    const h = openDatabase(dbFile)
    const quoted = mkdtempSync(join(backups, "Kofi's backups-"))
    expect(verifyDatabaseFile(snapshotBeforeUpdate(h.sqlite, quoted, 'production')).ok).toBe(true)
    closeDatabase(h)
  })

  it('refuses safely when the copy cannot be written', () => {
    healthyDatabase(dbFile, 'x')
    const h = openDatabase(dbFile)
    expect(() => snapshotBeforeUpdate(h.sqlite, join(backups, 'no', 'such', 'folder'), 'production')).toThrow(DatabaseRefused)
    closeDatabase(h)
  })
})

describe('verifying a backup', () => {
  it('rejects a backup made by a newer version', () => {
    const file = join(backups, 'newer.db')
    healthyDatabase(file, 'x')
    const h = openDatabase(file)
    h.sqlite.prepare('INSERT INTO __hmms_migrations (id, applied_at) VALUES (?, ?)').run('9999_from_the_future', 1)
    closeDatabase(h)
    expect(verifyDatabaseFile(file)).toMatchObject({ ok: false, reason: expect.stringMatching(/newer version/) })
  })
})

describe('finding a backup after damage', () => {
  it('chooses the newest backup that passes verification, skipping damaged ones', () => {
    const old = join(backups, 'hmms-production-auto-old.db')
    const good = join(backups, 'hmms-production-auto-good.db')
    const broken = join(backups, 'hmms-production-auto-broken.db')
    healthyDatabase(old, 'old')
    healthyDatabase(good, 'good')
    damage(broken)
    age(old, 120)
    age(good, 60)
    age(broken, 1)
    expect(latestGoodBackup(backups)?.file).toBe(good)
  })

  it('has nothing to offer when no backup can be used', () => {
    expect(latestGoodBackup(backups)).toBeNull()
    expect(latestGoodBackup(join(backups, 'missing'))).toBeNull()
    damage(join(backups, 'hmms-production-auto-broken.db'))
    expect(latestGoodBackup(backups)).toBeNull()
  })

  it('ignores files that are not databases', () => {
    writeFileSync(join(backups, 'notes.txt'), 'hello')
    expect(latestGoodBackup(backups)).toBeNull()
  })
})

describe('restoring after damage', () => {
  it('keeps every damaged file and leaves a database that opens', () => {
    damage(dbFile)
    writeFileSync(`${dbFile}-wal`, 'wal contents')
    writeFileSync(`${dbFile}-shm`, 'shm contents')
    const damagedBytes = readFileSync(dbFile)
    const backup = join(backups, 'hmms-production-auto-good.db')
    healthyDatabase(backup, 'restored')

    const kept = installBackup(backup, dbFile, Date.UTC(2026, 10, 6, 9))

    expect(existsSync(`${dbFile}-wal`)).toBe(false)
    expect(readdirSync(kept).sort()).toEqual(['hmms.db', 'hmms.db-shm', 'hmms.db-wal'])
    expect(readFileSync(join(kept, 'hmms.db')).equals(damagedBytes)).toBe(true)
    expect(markerIn(dbFile)).toBe('restored')
    closeDatabase(openDatabase(dbFile))
  })

  it('works when the database file has gone altogether', () => {
    const backup = join(backups, 'hmms-production-auto-good.db')
    healthyDatabase(backup, 'restored')
    installBackup(backup, dbFile)
    expect(markerIn(dbFile)).toBe('restored')
  })

  it('refuses a bad backup and leaves the current files where they are', () => {
    damage(dbFile)
    const before = statSync(dbFile).size
    const bad = join(backups, 'bad.db')
    damage(bad)
    expect(() => installBackup(bad, dbFile)).toThrow(/cannot be used/)
    expect(statSync(dbFile).size).toBe(before)
    expect(readdirSync(dir)).toEqual(['hmms.db'])
  })

  it('does not overwrite files kept from an earlier recovery', () => {
    const backup = join(backups, 'good.db')
    healthyDatabase(backup, 'restored')
    damage(dbFile)
    const at = Date.UTC(2026, 10, 6, 9)
    const first = installBackup(backup, dbFile, at)
    damage(dbFile)
    const second = installBackup(backup, dbFile, at)
    expect(second).not.toBe(first)
    expect(existsSync(join(first, 'hmms.db'))).toBe(true)
  })
})

describe('noticing that HMMS did not close properly', () => {
  it('treats a first start and a clean close as clean', () => {
    expect(beginSession(dir)).toBe(false)
    endSession(dir)
    expect(beginSession(dir)).toBe(false)
  })

  it('notices a start after a session that was never closed', () => {
    beginSession(dir)
    expect(beginSession(dir)).toBe(true)
  })

  it('accepts being closed twice', () => {
    beginSession(dir)
    endSession(dir)
    endSession(dir)
    expect(beginSession(dir)).toBe(false)
  })
})
