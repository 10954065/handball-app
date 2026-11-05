import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { checkIntegrity, closeDatabase, openDatabase } from '../../src/main/db/connection'
import { bundledMigrations, pendingMigrations, runMigrations } from '../../src/main/db/migrate'
import { players, teamPlayers, teams } from '../../src/main/db/schema'
import { createBackup, listBackups, pruneAutoBackups, verifyDatabaseFile } from '../../src/main/services/backup'
import { getSettings, updateSettings } from '../../src/main/services/settings'
import { listAudit } from '../../src/main/services/audit'
import { testDb, type TestDb } from './helpers'

let t: TestDb
beforeEach(() => (t = testDb(true)))
afterEach(() => t.cleanup())

describe('database foundation', () => {
  it('applies every bundled migration to a new database, in WAL mode with foreign keys', () => {
    expect(bundledMigrations.length).toBeGreaterThan(0)
    expect(t.handle.appliedMigrations).toEqual(bundledMigrations.map((m) => m.id))
    expect(t.handle.sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(t.handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(checkIntegrity(t.handle.sqlite).ok).toBe(true)
  })

  it('is idempotent: reopening applies nothing new', () => {
    closeDatabase(t.handle)
    const again = openDatabase(t.file)
    expect(again.appliedMigrations).toEqual([])
    expect(pendingMigrations(again.sqlite)).toEqual([])
    closeDatabase(again)
    t.handle = openDatabase(t.file)
  })

  it('a failing migration is rolled back and reported, never ignored', () => {
    const db = new Database(join(t.dir, 'broken.db'))
    const bad = [{ id: '9999_bad', sql: 'CREATE TABLE ok_table (id INTEGER);--> statement-breakpoint\nTHIS IS NOT SQL;' }]
    expect(() => runMigrations(db, bad)).toThrow(/9999_bad failed/)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name = 'ok_table'").all()
    expect(tables).toEqual([])
    expect(pendingMigrations(db, bad)).toHaveLength(1)
    db.close()
  })

  it('enforces unique active jersey numbers per team but allows reuse after a player leaves', () => {
    const { db } = t.handle
    db.insert(teams).values({ id: 't1', name: 'Team', shortName: 'TEA', code: 'TEA' }).run()
    for (const id of ['p1', 'p2']) {
      db.insert(players).values({ id, registrationNo: id, firstName: 'A', lastName: id }).run()
    }
    db.insert(teamPlayers).values({ id: 'tp1', teamId: 't1', playerId: 'p1', jerseyNumber: 7, joinedAt: 1 }).run()
    expect(() => db.insert(teamPlayers).values({ id: 'tp2', teamId: 't1', playerId: 'p2', jerseyNumber: 7, joinedAt: 2 }).run()).toThrow(/UNIQUE/)
    db.update(teamPlayers).set({ leftAt: 3 }).where(eq(teamPlayers.id, 'tp1')).run()
    db.insert(teamPlayers).values({ id: 'tp3', teamId: 't1', playerId: 'p2', jerseyNumber: 7, joinedAt: 4 }).run()
    expect(db.select().from(teamPlayers).all()).toHaveLength(2)
  })

  it('enforces foreign keys', () => {
    expect(() =>
      t.handle.db.insert(teamPlayers).values({ id: 'x', teamId: 'missing', playerId: 'missing', jerseyNumber: 1, joinedAt: 1 }).run()
    ).toThrow(/FOREIGN KEY/)
  })
})

describe('settings', () => {
  it('returns defaults, merges partial updates and audits the change', () => {
    const ctx = t.ctx()
    expect(getSettings(ctx).sound.volume).toBe(0.8)
    const next = updateSettings(ctx, { organisationName: 'Ghana HA', sound: { volume: 0.5 } })
    expect(next.organisationName).toBe('Ghana HA')
    expect(next.sound).toMatchObject({ volume: 0.5, enabled: true })
    expect(getSettings(ctx).sound.volume).toBe(0.5)
    expect(listAudit(ctx, { limit: 10, offset: 0 }).map((a) => a.action)).toContain('settings.update')
  })
})

describe('backups', () => {
  it('creates a verified snapshot that includes committed data still in the WAL', async () => {
    const ctx = t.ctx()
    t.handle.db.insert(teams).values({ id: 't1', name: 'WAL Team', shortName: 'WAL', code: 'WAL' }).run()
    expect(existsSync(t.file + '-wal')).toBe(true)
    const b = await createBackup(ctx, t.dir, 'manual', 'test')
    expect(b.integrity).toBe('ok')
    expect(b.sha256).toMatch(/^[0-9a-f]{64}$/)
    const copy = new Database(b.filePath, { readonly: true })
    expect(copy.prepare('SELECT name FROM teams').all()).toEqual([{ name: 'WAL Team' }])
    copy.close()
    expect(listBackups(ctx)[0]).toMatchObject({ id: b.id, kind: 'manual', exists: true })
  })

  it('rejects files that are not healthy HMMS databases', () => {
    const junk = join(t.dir, 'junk.db')
    writeFileSync(junk, 'not a database')
    expect(verifyDatabaseFile(junk).ok).toBe(false)
    const foreign = join(t.dir, 'other.db')
    const f = new Database(foreign)
    f.exec('CREATE TABLE something (id INTEGER)')
    f.close()
    expect(verifyDatabaseFile(foreign)).toMatchObject({ ok: false, reason: 'The file is not an HMMS database.' })
  })

  it('prunes old automatic backups beyond the retention limit only', async () => {
    const ctx = t.ctx()
    let clock = 1_700_000_000_000
    const timed = { ...ctx, now: () => (clock += 1000) }
    for (let i = 0; i < 4; i++) await createBackup(timed, t.dir, 'auto')
    await createBackup(timed, t.dir, 'manual')
    expect(pruneAutoBackups(ctx, 2)).toBe(2)
    const kinds = listBackups(ctx).map((b) => b.kind)
    expect(kinds.filter((k) => k === 'auto')).toHaveLength(2)
    expect(kinds).toContain('manual')
  })
})
