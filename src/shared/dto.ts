import type { Permission, Role } from './domain/constants'
import type { AppSettings } from './schemas/settings'

export interface SessionUser {
  id: string
  username: string
  displayName: string
  role: Role
  permissions: Permission[]
}

export type DataMode = 'production' | 'demo'

export interface AppInfo {
  name: string
  version: string
  mode: DataMode
  dataDir: string
  dbFile: string
  backupDir: string
  logDir: string
  electron: string
  chrome: string
  node: string
  sqlite: string
  platform: string
}

export interface AuthStatus {
  needsSetup: boolean
  user: SessionUser | null
  mode: DataMode
}

export interface UserDTO {
  id: string
  username: string
  displayName: string
  role: Role
  active: boolean
  lastLoginAt: number | null
  createdAt: number
}

export interface BackupDTO {
  id: string
  kind: 'auto' | 'manual' | 'pre_restore' | 'external'
  filePath: string
  fileName: string
  sizeBytes: number
  sha256: string
  integrity: string
  note: string | null
  createdAt: number
  exists: boolean
}

export interface IntegrityDTO {
  ok: boolean
  integrity: string[]
  foreignKeyViolations: number
  checkedAt: number
}

export interface AuditDTO {
  id: string
  at: number
  username: string | null
  action: string
  entity: string
  entityId: string | null
  matchId: string | null
  note: string | null
  before: unknown
  after: unknown
}

export type { AppSettings }
