import { BrowserWindow } from 'electron'
import type { DataMode, SessionUser } from '@shared/dto'
import type { PushEventName, PushEvents } from '@shared/ipc/contract'
import { closeDatabase, openDatabase, type DbHandle } from './db/connection'
import type { AppPaths } from './paths'
import { log } from './logger'
import { recordSnapshot, snapshotBeforeUpdate } from './services/backup'

/** Process-wide application state owned by the trusted main process. */
export class AppContext {
  handle: DbHandle
  mode: DataMode
  session: SessionUser | null = null
  readonly paths: AppPaths
  private readonly listeners = new Set<(mode: DataMode) => void>()

  constructor(paths: AppPaths, mode: DataMode = 'production') {
    this.paths = paths
    this.mode = mode
    this.handle = this.open(mode)
  }

  private open(mode: DataMode): DbHandle {
    const snapshots: string[] = []
    const handle = openDatabase(this.paths.dbFile(mode), {
      beforeMigrate: (sqlite) => snapshots.push(snapshotBeforeUpdate(sqlite, this.paths.backupDirFor(mode), mode))
    })
    if (handle.appliedMigrations.length) log.info('Applied migrations', handle.appliedMigrations)
    for (const file of snapshots) {
      log.info('Saved a copy of the data before updating it', { file })
      try {
        recordSnapshot({ db: handle.db, sqlite: handle.sqlite, user: null, mode }, file)
      } catch (err) {
        log.error('Could not add the copy to the backup history', err)
      }
    }
    return handle
  }

  get db() {
    return this.handle.db
  }

  get sqlite() {
    return this.handle.sqlite
  }

  /** Close and reopen the database (after restore, or when switching demo mode). */
  reopen(mode: DataMode = this.mode): void {
    // Opened first: if this fails, the data in use stays open and nothing else has changed.
    const next = this.open(mode)
    closeDatabase(this.handle)
    this.handle = next
    this.mode = mode
    this.session = null
    for (const l of this.listeners) l(mode)
    this.broadcast('data.reloaded', { mode })
    this.broadcast('session.changed', { user: null })
  }

  /**
   * Close the database, run fn (e.g. replace the file during a restore), then reopen it.
   * If reopening fails, rollback() is invoked and the database is reopened again.
   */
  withClosedDatabase(fn: () => void, rollback: () => void): void {
    closeDatabase(this.handle)
    this.session = null
    const file = this.paths.dbFile(this.mode)
    try {
      fn()
      this.handle = openDatabase(file)
    } catch (err) {
      log.error('Reopen after file replacement failed, rolling back', err)
      rollback()
      this.handle = openDatabase(file)
      throw err
    } finally {
      for (const l of this.listeners) l(this.mode)
      this.broadcast('data.reloaded', { mode: this.mode })
      this.broadcast('session.changed', { user: null })
    }
  }

  onReopen(listener: (mode: DataMode) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  broadcast<K extends PushEventName>(event: K, payload: PushEvents[K]): void {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(`hmms-push:${event}`, payload)
    }
  }

  close(): void {
    closeDatabase(this.handle)
  }
}
