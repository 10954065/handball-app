import { app, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '../logger'
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

export const vision = new VisionSupervisor({
  locate: locateService,
  log,
  onStatus: (status) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('hmms-push:vision.status', status)
    }
  },
  onEvent: () => undefined
})
