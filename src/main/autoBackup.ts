import type { AppContext } from './context'
import { log } from './logger'
import { createBackup, pruneAutoBackups } from './services/backup'
import { getSettings } from './services/settings'
import { ctxOf } from './restore'

/**
 * Periodic automatic backups while the application is open. A backup is only taken when the
 * database changed since the previous one (SQLite total_changes counter).
 */
export class AutoBackupScheduler {
  private timer: NodeJS.Timeout | null = null
  private lastChanges = -1
  private running = false

  constructor(private readonly app: AppContext) {
    app.onReopen(() => {
      this.lastChanges = -1
      this.reschedule()
    })
  }

  reschedule(): void {
    if (this.timer) clearInterval(this.timer)
    const s = getSettings(ctxOf(this.app)).backup
    if (!s.autoEnabled) return
    this.timer = setInterval(() => void this.runOnce('interval'), s.intervalMinutes * 60_000)
  }

  async runOnce(reason: string, force = false): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const ctx = ctxOf(this.app)
      const changes = (ctx.sqlite.prepare('SELECT total_changes() AS n').get() as { n: number }).n
      if (!force && changes === this.lastChanges) return
      await createBackup(ctx, this.app.paths.backupDirFor(this.app.mode), 'auto', `Automatic (${reason})`)
      pruneAutoBackups(ctx, getSettings(ctx).backup.keep)
      this.lastChanges = (ctx.sqlite.prepare('SELECT total_changes() AS n').get() as { n: number }).n
    } catch (err) {
      log.error('Automatic backup failed', err)
    } finally {
      this.running = false
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }
}
