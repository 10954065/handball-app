import type Database from 'better-sqlite3'
import type { DataMode, SessionUser } from '@shared/dto'
import { AppError } from '@shared/errors'
import type { Db } from '../db/connection'

/** Electron-free service context, so every service can be tested against a real SQLite file. */
export interface Ctx {
  db: Db
  sqlite: Database.Database
  user: SessionUser | null
  mode: DataMode
  now?: () => number
  /** Monotonic clock source for the match clock (performance.now by default). */
  mono?: () => number
  /** Identifies this process instance. A running clock owned by another boot id was interrupted. */
  bootId?: string
}

/** One id per process start: lets the match clock detect that the application was restarted. */
export const BOOT_ID = crypto.randomUUID()

export const nowOf = (ctx: Ctx): number => (ctx.now ? ctx.now() : Date.now())
export const monoOf = (ctx: Ctx): number => (ctx.mono ? ctx.mono() : performance.now())
export const bootIdOf = (ctx: Ctx): string => ctx.bootId ?? BOOT_ID

export function requireUser(ctx: Ctx): SessionUser {
  if (!ctx.user) throw new AppError('UNAUTHENTICATED', 'Please sign in.')
  return ctx.user
}

export const uuid = (): string => crypto.randomUUID()

/** Run a function inside a single SQLite transaction (synchronous, all-or-nothing). */
export function tx<T>(ctx: Ctx, fn: () => T): T {
  return ctx.sqlite.transaction(fn)()
}

export function notFound(entity: string): never {
  throw new AppError('NOT_FOUND', `${entity} not found.`)
}
