import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, closeDatabase, type DbHandle } from '../../src/main/db/connection'
import { users } from '../../src/main/db/schema'
import type { Ctx } from '../../src/main/services/ctx'
import type { SessionUser } from '../../src/shared/dto'
import { ROLE_PERMISSIONS } from '../../src/shared/domain/constants'

export interface TestDb {
  dir: string
  file: string
  handle: DbHandle
  ctx: (user?: SessionUser | null) => Ctx
  cleanup: () => void
}

export const ADMIN: SessionUser = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'admin',
  displayName: 'Test Admin',
  role: 'admin',
  permissions: [...ROLE_PERMISSIONS.admin]
}

/** A fresh, fully migrated database in a temporary folder. withAdmin seeds the ADMIN user row. */
export function testDb(withAdmin = false): TestDb {
  const dir = mkdtempSync(join(tmpdir(), 'hmms-test-'))
  const file = join(dir, 'hmms.db')
  const t: TestDb = {
    dir,
    file,
    handle: openDatabase(file),
    ctx: (user = ADMIN) => ({ db: t.handle.db, sqlite: t.handle.sqlite, user, mode: 'production' }),
    cleanup: () => {
      try {
        closeDatabase(t.handle)
      } catch {
        // already closed by the test
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }
  if (withAdmin) {
    t.handle.db.insert(users).values({ id: ADMIN.id, username: ADMIN.username, displayName: ADMIN.displayName, role: 'admin', passwordHash: 'x' }).run()
  }
  return t
}
