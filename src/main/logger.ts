import { appendFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

type Level = 'info' | 'warn' | 'error'

let logDir: string | null = null
const KEEP_DAYS = 14

export function initLogger(dir: string): void {
  logDir = dir
  try {
    const files = readdirSync(dir).filter((f) => /^hmms-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort()
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_DAYS))) unlinkSync(join(dir, f))
  } catch {
    // Log rotation failure must never stop the application.
  }
}

function write(level: Level, message: string, meta?: unknown): void {
  const now = new Date()
  const line = `${now.toISOString()} [${level.toUpperCase()}] ${message}${meta !== undefined ? ' ' + safeJson(meta) : ''}\n`
  if (level === 'error') process.stderr.write(line)
  if (!logDir) return
  try {
    appendFileSync(join(logDir, `hmms-${now.toISOString().slice(0, 10)}.log`), line)
  } catch {
    // Disk full or permission problems: keep running, stderr already has the line.
  }
}

function safeJson(v: unknown): string {
  if (v instanceof Error) return JSON.stringify({ name: v.name, message: v.message, stack: v.stack })
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export const log = {
  info: (m: string, meta?: unknown) => write('info', m, meta),
  warn: (m: string, meta?: unknown) => write('warn', m, meta),
  error: (m: string, meta?: unknown) => write('error', m, meta)
}
