import { app, BrowserWindow, safeStorage } from 'electron'
import type { z } from 'zod'
import type { suggestionEventSchema } from '@shared/vision'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '../logger'
import type { Secrets } from '../services/cameras'
import { CameraFeeds } from './feeds'
import { VisionSupervisor, type VisionCommand } from './supervisor'

/** The packaged service, or in development the Python environment in ai-vision/. */
function locateService(): VisionCommand | null {
  if (app.isPackaged) {
    const exe = join(process.resourcesPath, 'vision', 'hmms-vision.exe')
    return existsSync(exe) ? { command: exe, args: [] } : null
  }
  // Not app.getAppPath(): that depends on how Electron was started, and __dirname is out/main.
  const cwd = join(__dirname, '..', '..', 'ai-vision')
  const python = join(cwd, '.venv', 'Scripts', 'python.exe')
  return existsSync(python) ? { command: python, args: ['-m', 'hmms_vision'], cwd } : null
}

function push(event: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(`hmms-push:${event}`, payload)
  }
}

export const vision = new VisionSupervisor({
  locate: locateService,
  log,
  onStatus: (status) => {
    feeds.onServiceState(status.state)
    push('vision.status', status)
  },
  onEvent: (header, payload) => feeds.onEvent(header, payload)
})

export const feeds = new CameraFeeds((cmd, args) => vision.request(cmd, args), {
  onFeeds: (states) => push('vision.feeds', states),
  onAnalysis: (analysis) => push('vision.analysis', analysis),
  onTracks: (tracks) => push('vision.tracks', tracks),
  onSuggestion: (suggestion) => suggestions.handle?.(suggestion),
  onBall: (ball) => push('vision.ball', ball)
})

/** Set once the database is open. Which match is analysed is decided when analysis starts. */
export const suggestions: { matchId: string | null; handle: ((s: z.output<typeof suggestionEventSchema>) => void) | null } = { matchId: null, handle: null }

/** Camera passwords, encrypted by Windows for the signed-in account. */
export const secrets: Secrets = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
  decrypt: (text) => safeStorage.decryptString(Buffer.from(text, 'base64'))
}
