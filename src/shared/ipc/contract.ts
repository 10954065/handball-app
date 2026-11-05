import { z } from 'zod'
import type { ChannelDef } from './define'
import { channel } from './define'
import type { AppInfo, AppSettings, AuditDTO, AuthStatus, BackupDTO, IntegrityDTO, SessionUser, UserDTO } from '../dto'
import { changePasswordSchema, createUserSchema, loginSchema, setupSchema, updateUserSchema } from '../schemas/auth'
import { appSettingsPatchSchema } from '../schemas/settings'
import { idInput, noInput } from '../schemas/common'

/**
 * The complete IPC contract between renderer and main process.
 * Every channel declares its input schema (validated in main), its required permission and
 * its output type. The renderer can only reach these channels through the preload bridge.
 */
export const contract = {
  // application
  'app.info': channel<AppInfo>()('public', noInput),
  'app.openDataFolder': channel<void>()('admin', noInput),

  // authentication & users
  'auth.status': channel<AuthStatus>()('public', noInput),
  'auth.setup': channel<SessionUser>()('public', setupSchema),
  'auth.login': channel<SessionUser>()('public', loginSchema),
  'auth.logout': channel<void>()('public', noInput),
  'auth.changePassword': channel<void>()('authenticated', changePasswordSchema),
  'users.list': channel<UserDTO[]>()('admin', noInput),
  'users.create': channel<UserDTO>()('admin', createUserSchema),
  'users.update': channel<UserDTO>()('admin', updateUserSchema),

  // settings
  'settings.get': channel<AppSettings>()('public', noInput),
  'settings.update': channel<AppSettings>()('admin', appSettingsPatchSchema),

  // backup, restore & integrity
  'backup.list': channel<BackupDTO[]>()('admin', noInput),
  'backup.create': channel<BackupDTO>()('manage_data', z.object({ note: z.string().max(200).optional() })),
  'backup.exportToFolder': channel<{ path: string } | null>()('manage_data', noInput),
  'backup.restoreFromFile': channel<{ restored: boolean; preRestoreBackup?: string }>()('admin', noInput),
  'backup.restoreFromHistory': channel<{ restored: boolean; preRestoreBackup?: string }>()('admin', idInput),
  'db.integrity': channel<IntegrityDTO>()('authenticated', noInput),
  'audit.list': channel<AuditDTO[]>()(
    'authenticated',
    z.object({
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
      matchId: z.string().uuid().optional()
    })
  ),

  // demonstration mode
  'demo.enter': channel<void>()('public', noInput),
  'demo.exit': channel<void>()('public', noInput)
} satisfies Record<string, ChannelDef<z.ZodType, unknown>>

export type Contract = typeof contract
export type ChannelName = keyof Contract
export type ChannelInput<K extends ChannelName> = z.input<Contract[K]['input']>
export type ChannelParsed<K extends ChannelName> = z.output<Contract[K]['input']>
export type ChannelOutput<K extends ChannelName> = Contract[K] extends ChannelDef<z.ZodType, infer O> ? O : never

/** Push events from main to renderer windows. */
export interface PushEvents {
  'session.changed': { user: SessionUser | null }
  'data.reloaded': { mode: 'production' | 'demo' }
  'settings.changed': AppSettings
}
export type PushEventName = keyof PushEvents
