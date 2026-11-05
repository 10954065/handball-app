import { asc, count, eq, sql } from 'drizzle-orm'
import { ROLE_PERMISSIONS, type Role } from '@shared/domain/constants'
import type { SessionUser, UserDTO } from '@shared/dto'
import { AppError } from '@shared/errors'
import { users } from '../db/schema'
import { hashPassword, passwordPolicyError, verifyPassword } from '../security/password'
import { audit } from './audit'
import { type Ctx, nowOf, requireUser, tx, uuid } from './ctx'

type UserRow = typeof users.$inferSelect

export const toSession = (u: Pick<UserRow, 'id' | 'username' | 'displayName' | 'role'>): SessionUser => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  role: u.role,
  permissions: [...ROLE_PERMISSIONS[u.role]]
})

const toDTO = (u: UserRow): UserDTO => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  role: u.role,
  active: u.active,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt
})

export function needsSetup(ctx: Ctx): boolean {
  return (ctx.db.select({ n: count() }).from(users).get()?.n ?? 0) === 0
}

function findByUsername(ctx: Ctx, username: string): UserRow | undefined {
  return ctx.db.select().from(users).where(sql`lower(${users.username}) = lower(${username})`).get()
}

function assertPolicy(password: string): void {
  const err = passwordPolicyError(password)
  if (err) throw new AppError('VALIDATION', err)
}

/** First-run administrator setup. Only possible while no user exists. */
export async function setupAdmin(ctx: Ctx, input: { username: string; displayName: string; password: string }): Promise<SessionUser> {
  if (!needsSetup(ctx)) throw new AppError('CONFLICT', 'The administrator account has already been created.')
  assertPolicy(input.password)
  const passwordHash = await hashPassword(input.password)
  const id = uuid()
  tx(ctx, () => {
    if (!needsSetup(ctx)) throw new AppError('CONFLICT', 'The administrator account has already been created.')
    ctx.db.insert(users).values({ id, username: input.username, displayName: input.displayName, passwordHash, role: 'admin', lastLoginAt: nowOf(ctx) }).run()
    audit({ ...ctx, user: { id, username: input.username, displayName: input.displayName, role: 'admin', permissions: [] } }, {
      action: 'auth.setup',
      entity: 'users',
      entityId: id,
      note: 'First-run administrator created'
    })
  })
  return toSession({ id, username: input.username, displayName: input.displayName, role: 'admin' })
}

const failures = new Map<string, { count: number; until: number }>()
const MAX_FAILURES = 5
const LOCK_MS = 30_000

export async function login(ctx: Ctx, input: { username: string; password: string }): Promise<SessionUser> {
  const key = input.username.toLowerCase()
  const f = failures.get(key)
  if (f && f.until > nowOf(ctx)) {
    throw new AppError('FORBIDDEN', `Too many failed attempts. Try again in ${Math.ceil((f.until - nowOf(ctx)) / 1000)} s.`)
  }
  const user = findByUsername(ctx, input.username)
  const valid = user ? await verifyPassword(input.password, user.passwordHash) : false
  if (!user || !valid || !user.active) {
    const next = { count: (f?.count ?? 0) + 1, until: 0 }
    if (next.count >= MAX_FAILURES) next.until = nowOf(ctx) + LOCK_MS
    failures.set(key, next.count >= MAX_FAILURES ? { count: 0, until: next.until } : next)
    throw new AppError('UNAUTHENTICATED', user && valid && !user.active ? 'This account is disabled.' : 'Incorrect username or password.')
  }
  failures.delete(key)
  ctx.db.update(users).set({ lastLoginAt: nowOf(ctx) }).where(eq(users.id, user.id)).run()
  const session = toSession(user)
  audit({ ...ctx, user: session }, { action: 'auth.login', entity: 'users', entityId: user.id })
  return session
}

export async function changePassword(ctx: Ctx, input: { current: string; next: string }): Promise<void> {
  const me = requireUser(ctx)
  const row = ctx.db.select().from(users).where(eq(users.id, me.id)).get()
  if (!row || !(await verifyPassword(input.current, row.passwordHash))) {
    throw new AppError('VALIDATION', 'The current password is incorrect.')
  }
  assertPolicy(input.next)
  const passwordHash = await hashPassword(input.next)
  tx(ctx, () => {
    ctx.db.update(users).set({ passwordHash, updatedAt: nowOf(ctx) }).where(eq(users.id, me.id)).run()
    audit(ctx, { action: 'auth.changePassword', entity: 'users', entityId: me.id })
  })
}

export function listUsers(ctx: Ctx): UserDTO[] {
  return ctx.db.select().from(users).orderBy(asc(users.username)).all().map(toDTO)
}

export async function createUser(ctx: Ctx, input: { username: string; displayName: string; role: Role; password: string }): Promise<UserDTO> {
  if (findByUsername(ctx, input.username)) throw new AppError('CONFLICT', `Username "${input.username}" is already in use.`)
  assertPolicy(input.password)
  const passwordHash = await hashPassword(input.password)
  const id = uuid()
  return tx(ctx, () => {
    ctx.db.insert(users).values({ id, username: input.username, displayName: input.displayName, role: input.role, passwordHash }).run()
    audit(ctx, { action: 'users.create', entity: 'users', entityId: id, after: { username: input.username, role: input.role } })
    return toDTO(ctx.db.select().from(users).where(eq(users.id, id)).get()!)
  })
}

export async function updateUser(
  ctx: Ctx,
  input: { id: string; displayName?: string; role?: Role; active?: boolean; password?: string }
): Promise<UserDTO> {
  const me = requireUser(ctx)
  const row = ctx.db.select().from(users).where(eq(users.id, input.id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'User not found.')
  const demotingSelf = input.id === me.id && ((input.role && input.role !== 'admin') || input.active === false)
  if (demotingSelf) throw new AppError('FORBIDDEN', 'You cannot remove your own administrator access.')
  if (input.password) assertPolicy(input.password)
  const passwordHash = input.password ? await hashPassword(input.password) : undefined
  return tx(ctx, () => {
    const losingAdmin = row.role === 'admin' && ((input.role && input.role !== 'admin') || input.active === false)
    if (losingAdmin) {
      const admins = ctx.db.select({ n: count() }).from(users).where(sql`${users.role} = 'admin' AND ${users.active} = 1`).get()?.n ?? 0
      if (admins <= 1) throw new AppError('FORBIDDEN', 'At least one active administrator is required.')
    }
    ctx.db
      .update(users)
      .set({
        displayName: input.displayName ?? row.displayName,
        role: input.role ?? row.role,
        active: input.active ?? row.active,
        ...(passwordHash ? { passwordHash } : {}),
        updatedAt: nowOf(ctx)
      })
      .where(eq(users.id, input.id))
      .run()
    audit(ctx, {
      action: 'users.update',
      entity: 'users',
      entityId: input.id,
      before: { displayName: row.displayName, role: row.role, active: row.active },
      after: { displayName: input.displayName, role: input.role, active: input.active, passwordChanged: !!passwordHash }
    })
    return toDTO(ctx.db.select().from(users).where(eq(users.id, input.id)).get()!)
  })
}
