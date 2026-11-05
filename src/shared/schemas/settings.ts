import { z } from 'zod'

export const appSettingsSchema = z.object({
  organisationName: z.string().max(120).default(''),
  defaultRulesPresetId: z.string().max(40).default('ihf_senior'),
  sound: z
    .object({
      enabled: z.boolean().default(true),
      volume: z.number().min(0).max(1).default(0.8),
      suspensionExpiry: z.boolean().default(true),
      timeoutEnd: z.boolean().default(true),
      periodEnd: z.boolean().default(true)
    })
    .default({ enabled: true, volume: 0.8, suspensionExpiry: true, timeoutEnd: true, periodEnd: true }),
  display: z
    .object({
      theme: z.enum(['dark', 'light', 'system']).default('dark'),
      density: z.enum(['comfortable', 'compact']).default('comfortable')
    })
    .default({ theme: 'dark', density: 'comfortable' }),
  live: z
    .object({
      /** Show missed/saved/steal/turnover controls. Basic scorekeeping stays one click. */
      advancedStats: z.boolean().default(true),
      /** Ask for an assist after each goal. */
      assistPrompt: z.boolean().default(false),
      /** Require confirmation for period/match transitions. */
      confirmCriticalActions: z.boolean().default(true),
      /** Track which players are on court through substitutions. */
      trackCourtPresence: z.boolean().default(true)
    })
    .default({ advancedStats: true, assistPrompt: false, confirmCriticalActions: true, trackCourtPresence: true }),
  backup: z
    .object({
      autoEnabled: z.boolean().default(true),
      /** Automatic backup interval while the application is open. */
      intervalMinutes: z.number().int().min(5).max(1440).default(30),
      /** Number of automatic backups to keep. */
      keep: z.number().int().min(3).max(200).default(30),
      onMatchFinalize: z.boolean().default(true)
    })
    .default({ autoEnabled: true, intervalMinutes: 30, keep: 30, onMatchFinalize: true }),
  reports: z
    .object({
      headerTitle: z.string().max(120).default('Official Match Report'),
      footerNote: z.string().max(300).default(''),
      showLogos: z.boolean().default(true),
      includeStatistics: z.boolean().default(true),
      includeTimeline: z.boolean().default(true)
    })
    .default({ headerTitle: 'Official Match Report', footerNote: '', showLogos: true, includeStatistics: true, includeTimeline: true }),
  scoreboard: z
    .object({
      showLogos: z.boolean().default(true),
      showSuspensions: z.boolean().default(true),
      fullscreen: z.boolean().default(true)
    })
    .default({ showLogos: true, showSuspensions: true, fullscreen: true })
})

export type AppSettings = z.infer<typeof appSettingsSchema>

export const DEFAULT_SETTINGS: AppSettings = appSettingsSchema.parse({})

/** Partial update payload: every section optional, every field optional. */
export const appSettingsPatchSchema = z.object({
  organisationName: z.string().max(120).optional(),
  defaultRulesPresetId: z.string().max(40).optional(),
  sound: appSettingsSchema.shape.sound.unwrap().partial().optional(),
  display: appSettingsSchema.shape.display.unwrap().partial().optional(),
  live: appSettingsSchema.shape.live.unwrap().partial().optional(),
  backup: appSettingsSchema.shape.backup.unwrap().partial().optional(),
  reports: appSettingsSchema.shape.reports.unwrap().partial().optional(),
  scoreboard: appSettingsSchema.shape.scoreboard.unwrap().partial().optional()
})
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>
