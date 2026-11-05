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
}

export const nowOf = (ctx: Ctx): number => (ctx.now ? ctx.now() : Date.now())

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
