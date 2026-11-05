import { eq } from 'drizzle-orm'
import { appSettingsSchema, type AppSettings, type AppSettingsPatch } from '@shared/schemas/settings'
import { appSettings } from '../db/schema'
import { audit } from './audit'
import { type Ctx, nowOf, tx } from './ctx'

const KEY = 'app'

export function getSettings(ctx: Ctx): AppSettings {
  const row = ctx.db.select().from(appSettings).where(eq(appSettings.key, KEY)).get()
  const parsed = appSettingsSchema.safeParse(row?.value ?? {})
  return parsed.success ? parsed.data : appSettingsSchema.parse({})
}

export function updateSettings(ctx: Ctx, patch: AppSettingsPatch): AppSettings {
  return tx(ctx, () => {
    const current = getSettings(ctx)
    const next = appSettingsSchema.parse({
      ...current,
      ...stripUndefined(patch),
      sound: { ...current.sound, ...patch.sound },
      display: { ...current.display, ...patch.display },
      live: { ...current.live, ...patch.live },
      backup: { ...current.backup, ...patch.backup },
      reports: { ...current.reports, ...patch.reports },
      scoreboard: { ...current.scoreboard, ...patch.scoreboard }
    })
    ctx.db
      .insert(appSettings)
      .values({ key: KEY, value: next, updatedAt: nowOf(ctx) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: nowOf(ctx) } })
      .run()
    audit(ctx, { action: 'settings.update', entity: 'app_settings', entityId: KEY, before: current, after: next })
    return next
  })
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && typeof v !== 'object')) as Partial<T>
}
