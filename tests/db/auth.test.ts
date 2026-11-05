import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { changePassword, createUser, listUsers, login, needsSetup, setupAdmin, updateUser } from '../../src/main/services/auth'
import { hashPassword, verifyPassword } from '../../src/main/security/password'
import { testDb, type TestDb } from './helpers'

let t: TestDb
beforeEach(() => (t = testDb()))
afterEach(() => t.cleanup())

describe('password hashing', () => {
  it('uses salted scrypt and verifies correctly', async () => {
    const a = await hashPassword('Secret123')
    const b = await hashPassword('Secret123')
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/)
    expect(a).not.toBe(b)
    expect(await verifyPassword('Secret123', a)).toBe(true)
    expect(await verifyPassword('secret123', a)).toBe(false)
    expect(await verifyPassword('x', 'garbage')).toBe(false)
  })
})

describe('local authentication', () => {
  it('first-run setup creates exactly one administrator', async () => {
    const anon = t.ctx(null)
    expect(needsSetup(anon)).toBe(true)
    const admin = await setupAdmin(anon, { username: 'secretary', displayName: 'Match Secretary', password: 'Handball2026' })
    expect(admin.role).toBe('admin')
    expect(admin.permissions).toContain('admin')
    expect(needsSetup(anon)).toBe(false)
    await expect(setupAdmin(anon, { username: 'x2', displayName: 'X', password: 'Handball2026' })).rejects.toThrow(/already/)
  })

  it('rejects weak passwords', async () => {
    await expect(setupAdmin(t.ctx(null), { username: 'admin', displayName: 'A', password: 'password' })).rejects.toThrow(/letters and numbers/)
  })

  it('logs in case-insensitively and locks out after repeated failures', async () => {
    const anon = t.ctx(null)
    await setupAdmin(anon, { username: 'Admin', displayName: 'A', password: 'Handball2026' })
    expect((await login(anon, { username: 'admin', password: 'Handball2026' })).username).toBe('Admin')
    for (let i = 0; i < 5; i++) await expect(login(anon, { username: 'admin', password: 'wrong' })).rejects.toThrow()
    await expect(login(anon, { username: 'admin', password: 'Handball2026' })).rejects.toThrow(/Too many failed attempts/)
  })

  it('manages users with role protection for the last administrator', async () => {
    const admin = await setupAdmin(t.ctx(null), { username: 'chief', displayName: 'Chief', password: 'Handball2026' })
    const ctx = t.ctx(admin)
    const op = await createUser(ctx, { username: 'op1', displayName: 'Operator', role: 'operator', password: 'Operate2026' })
    expect(listUsers(ctx).map((u) => u.username)).toEqual(['chief', 'op1'])
    await expect(createUser(ctx, { username: 'OP1', displayName: 'Dup', role: 'viewer', password: 'Operate2026' })).rejects.toThrow(/already in use/)
    await expect(updateUser(ctx, { id: admin.id, role: 'viewer' })).rejects.toThrow(/own administrator/)
    const disabled = await updateUser(ctx, { id: op.id, active: false })
    expect(disabled.active).toBe(false)
    await expect(login(t.ctx(null), { username: 'op1', password: 'Operate2026' })).rejects.toThrow(/disabled/)
  })

  it('changes a password only with the current password', async () => {
    const admin = await setupAdmin(t.ctx(null), { username: 'chief', displayName: 'Chief', password: 'Handball2026' })
    const ctx = t.ctx(admin)
    await expect(changePassword(ctx, { current: 'nope', next: 'NewPass2026' })).rejects.toThrow(/incorrect/)
    await changePassword(ctx, { current: 'Handball2026', next: 'NewPass2026' })
    expect((await login(t.ctx(null), { username: 'chief', password: 'NewPass2026' })).id).toBe(admin.id)
  })
})
