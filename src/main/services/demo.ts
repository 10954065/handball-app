import { getSettings, updateSettings } from './settings'
import type { Ctx } from './ctx'

/**
 * Seed the separate demonstration database with clearly labelled sample data.
 * Runs only in demo mode and only once (idempotent). The production database is never touched.
 */
export function seedDemoData(ctx: Ctx): void {
  if (ctx.mode !== 'demo') return
  if (!getSettings(ctx).organisationName) {
    updateSettings(ctx, { organisationName: 'HMMS Demonstration (sample data)' })
  }
}
