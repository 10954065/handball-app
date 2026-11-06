import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const newDataDir = (): string => mkdtempSync(join(tmpdir(), 'hmms-e2e-'))

/** The environment without what would change how Electron starts. */
export function cleanEnv(): Record<string, string> {
  // Editors such as VS Code export ELECTRON_RUN_AS_NODE, which would start Electron as plain Node.
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'ELECTRON_RENDERER_URL') env[k] = v
  }
  return env
}

/** Launch the built application (out/) against an isolated data folder. */
export async function launch(dataDir: string, extra: { args?: string[]; env?: Record<string, string> } = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [...(extra.args ?? []), resolve('out/main/index.js')], env: { ...cleanEnv(), ...extra.env, HMMS_USER_DATA: dataDir } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  return { app, page }
}
