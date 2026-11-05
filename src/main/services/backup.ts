import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import { and, desc, eq } from 'drizzle-orm'
import type { BackupDTO } from '@shared/dto'
import { AppError } from '@shared/errors'
import { backupHistory } from '../db/schema'
import { type Ctx, nowOf, uuid } from './ctx'

export type BackupKind = 'auto' | 'manual' | 'pre_restore' | 'external'

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export interface FileVerification {
  ok: boolean
  reason: string | null
  integrity: string
}

/**
 * Verify that a file is a healthy HMMS database: SQLite integrity check passes and the HMMS
 * migration table and core tables exist. Opened read-only so the candidate is never modified.
 */
export function verifyDatabaseFile(path: string): FileVerification {
  let db: Database.Database | null = null
  try {
    db = new Database(path, { readonly: true, fileMustExist: true })
    const integrity = (db.pragma('integrity_check') as { integrity_check: string }[]).map((r) => r.integrity_check).join('; ')
    if (integrity !== 'ok') return { ok: false, reason: `Integrity check failed: ${integrity}`, integrity }
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name))
    for (const t of ['__hmms_migrations', 'users', 'matches', 'match_events']) {
      if (!tables.has(t)) return { ok: false, reason: 'The file is not an HMMS database.', integrity }
    }
    return { ok: true, reason: null, integrity }
  } catch (err) {
    return { ok: false, reason: `Unable to open database: ${(err as Error).message}`, integrity: 'error' }
  } finally {
    db?.close()
  }
}

/**
 * Create a consistent snapshot with SQLite's online backup API. The backup API reads through
 * the live connection, so committed transactions still in the WAL file are included. The
 * snapshot is verified before it is recorded.
 */
export async function createBackup(ctx: Ctx, dir: string, kind: BackupKind, note?: string | null): Promise<BackupDTO> {
  const at = nowOf(ctx)
  const file = join(dir, `hmms-${ctx.mode}-${kind}-${stamp(at)}.db`)
  await ctx.sqlite.backup(file)
  const v = verifyDatabaseFile(file)
  if (!v.ok) {
    try {
      unlinkSync(file)
    } catch {
      // leave the broken file for inspection if it cannot be removed
    }
    throw new AppError('INTERNAL', `Backup verification failed: ${v.reason}`)
  }
  const row = {
    id: uuid(),
    kind,
    filePath: file,
    sizeBytes: statSync(file).size,
    sha256: sha256File(file),
    integrity: v.integrity,
    note: note ?? null,
    createdBy: ctx.user?.username ?? null,
    createdAt: at
  }
  ctx.db.insert(backupHistory).values(row).run()
  return toDTO(row)
}

/** Record a backup file that was created by another database (e.g. before a restore). */
export function recordBackup(ctx: Ctx, entry: Omit<BackupDTO, 'id' | 'fileName' | 'exists'> & { createdBy?: string | null }): void {
  ctx.db
    .insert(backupHistory)
    .values({
      id: uuid(),
      kind: entry.kind,
      filePath: entry.filePath,
      sizeBytes: entry.sizeBytes,
      sha256: entry.sha256,
      integrity: entry.integrity,
      note: entry.note,
      createdBy: entry.createdBy ?? null,
      createdAt: entry.createdAt
    })
    .run()
}

export function listBackups(ctx: Ctx): BackupDTO[] {
  return ctx.db.select().from(backupHistory).orderBy(desc(backupHistory.createdAt)).all().map(toDTO)
}

export function getBackup(ctx: Ctx, id: string): BackupDTO {
  const row = ctx.db.select().from(backupHistory).where(eq(backupHistory.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Backup not found.')
  return toDTO(row)
}

/** Delete the oldest automatic backups beyond the retention limit. */
export function pruneAutoBackups(ctx: Ctx, keep: number): number {
  const autos = ctx.db
    .select()
    .from(backupHistory)
    .where(and(eq(backupHistory.kind, 'auto')))
    .orderBy(desc(backupHistory.createdAt))
    .all()
  let removed = 0
  for (const b of autos.slice(keep)) {
    try {
      if (existsSync(b.filePath)) unlinkSync(b.filePath)
    } catch {
      continue
    }
    ctx.db.delete(backupHistory).where(eq(backupHistory.id, b.id)).run()
    removed++
  }
  return removed
}

function toDTO(r: typeof backupHistory.$inferSelect): BackupDTO {
  return {
    id: r.id,
    kind: r.kind,
    filePath: r.filePath,
    fileName: basename(r.filePath),
    sizeBytes: r.sizeBytes,
    sha256: r.sha256,
    integrity: r.integrity,
    note: r.note,
    createdAt: r.createdAt,
    exists: existsSync(r.filePath)
  }
}
