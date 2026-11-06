import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, DatabaseDamaged, DatabaseRefused, isDamage, openDatabase } from '../../src/main/db/connection'
import { installBackup } from '../../src/main/recovery'
import { snapshotBeforeUpdate } from '../../src/main/services/backup'

/** The file whose move fails, as when antivirus has just opened it. */
const fail = vi.hoisted(() => ({ on: '' }))

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return {
    ...fs,
    renameSync: (from: string, to: string) => {
      if (fail.on && from.endsWith(fail.on)) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      fs.renameSync(from, to)
    }
  }
})

let dir: string
let dbFile: string
let backup: string
const damagedBytes = Buffer.from('this is not a database '.repeat(200))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hmms-recovery-failure-'))
  dbFile = join(dir, 'hmms.db')
  backup = join(mkdtempSync(join(tmpdir(), 'hmms-recovery-backup-')), 'good.db')
  closeDatabase(openDatabase(backup))
  writeFileSync(dbFile, damagedBytes)
  writeFileSync(`${dbFile}-wal`, 'wal contents')
})

afterEach(() => {
  fail.on = ''
  rmSync(dir, { recursive: true, force: true })
})

describe('a recovery that fails part way', () => {
  for (const step of ['hmms.db', 'hmms.db.restoring']) {
    it(`puts everything back when moving ${step} fails`, () => {
      fail.on = step
      expect(() => installBackup(backup, dbFile)).toThrow(/EBUSY/)
      fail.on = ''
      expect(readdirSync(dir).sort()).toEqual(['hmms.db', 'hmms.db-wal'])
      expect(readFileSync(dbFile).equals(damagedBytes)).toBe(true)
      expect(readFileSync(`${dbFile}-wal`, 'utf8')).toBe('wal contents')
    })
  }

  it('moves the journal first, so it can never be left beside the restored file', () => {
    fail.on = 'hmms.db-wal'
    expect(() => installBackup(backup, dbFile)).toThrow(/EBUSY/)
    expect(readFileSync(dbFile).equals(damagedBytes)).toBe(true)
    expect(existsSync(`${dbFile}.restoring`)).toBe(false)
  })
})

describe('telling damage from everything else', () => {
  it('recognises a file that is not a database', () => {
    let error: unknown
    try {
      openDatabase(dbFile)
    } catch (err) {
      error = err
    }
    expect(isDamage(error)).toBe(true)
  })

  it('recognises a failed check, and corruption found during a migration', () => {
    expect(isDamage(new DatabaseDamaged('Integrity check failed'))).toBe(true)
    const corrupt = Object.assign(new Error('database disk image is malformed'), { code: 'SQLITE_CORRUPT_VTAB' })
    expect(isDamage(new Error('Database migration failed', { cause: corrupt }))).toBe(true)
  })

  it('does not treat healthy data as damaged', () => {
    expect(isDamage(new Error('Database migration 0006 failed', { cause: new Error('table already exists') }))).toBe(false)
    expect(isDamage(Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }))).toBe(false)
    expect(isDamage(Object.assign(new Error('disk full'), { code: 'SQLITE_FULL' }))).toBe(false)
    expect(isDamage(Object.assign(new Error('busy'), { code: 'EBUSY' }))).toBe(false)
    expect(isDamage(new DatabaseRefused('newer version'))).toBe(false)
    expect(isDamage('not even an error')).toBe(false)
  })
})

describe('the copy before an update, on a file that is damaged', () => {
  it('reports the damage, not a disk space problem', () => {
    const malformed = () => {
      throw Object.assign(new Error('database disk image is malformed'), { code: 'SQLITE_CORRUPT' })
    }
    const sqlite = { prepare: () => ({ run: malformed }) } as unknown as Database.Database
    let error: unknown
    try {
      snapshotBeforeUpdate(sqlite, dir, 'production')
    } catch (err) {
      error = err
    }
    expect(isDamage(error)).toBe(true)
    expect(error).not.toBeInstanceOf(DatabaseRefused)
  })
})
