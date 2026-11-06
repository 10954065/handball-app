import Database from 'better-sqlite3'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { cleanEnv, launch, newDataDir } from './app'
import { nav, setupAdmin, signIn } from './helpers'

const clock = (page: Page) => page.getByTestId('match-clock')
const STUB = resolve('tests/e2e/dialog-stub.cjs')

const logText = (dir: string) =>
  readdirSync(join(dir, 'logs'))
    .map((f) => readFileSync(join(dir, 'logs', f), 'utf8'))
    .join('')

const dialogsShown = (file: string) =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { title: string; content?: string; buttons?: string[] })

async function startFriendly(page: Page) {
  await page.getByRole('button', { name: /Explore demonstration mode/ }).click()
  await expect(page.getByText(/Demonstration mode - sample data only/)).toBeVisible()
  await nav(page, 'Live Match Centre')
  await page.locator('a[href^="#/live/"]').first().click()
  await page.getByRole('button', { name: 'Start match' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Start match' }).click()
  await expect(clock(page)).toHaveText('00:00')
  await page.getByRole('button', { name: /Start clock/ }).click()
  await expect(page.getByRole('button', { name: /Stop clock/ })).toBeVisible()
}

const electronBinary = () => createRequire(resolve('package.json'))('electron') as string

/** What the main window shows, read through Electron: Playwright gives up on a page once it crashes. */
const windowText = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('document.body.innerText') as Promise<string>)

/** A data folder with an administrator and the backup HMMS takes when it closes. */
async function dataWithBackup(): Promise<string> {
  const dir = newDataDir()
  const { app, page } = await launch(dir)
  await setupAdmin(page)
  await app.close()
  expect(readdirSync(join(dir, 'backups')).some((f) => f.endsWith('.db'))).toBe(true)
  return dir
}

test('a live match survives a screen crash, keeps the computer awake and stops for sleep', async () => {
  const dir = newDataDir()
  const { app, page } = await launch(dir)
  await startFriendly(page)
  await expect.poll(() => logText(dir)).toContain('keeping the computer awake')

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer())
  await expect.poll(() => logText(dir)).toContain('The main screen stopped')
  await expect.poll(() => windowText(app), { timeout: 20_000 }).toContain('Stop clock')
  expect(await windowText(app)).toMatch(/Demonstration mode/i)

  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'))
  await expect.poll(() => windowText(app)).toContain('Start clock')
  await app.close()

  const db = new Database(join(dir, 'data', 'hmms-demo.db'), { readonly: true })
  const stops = db.prepare("SELECT note FROM audit_logs WHERE action = 'live.clock.stop'").all() as { note: string }[]
  db.close()
  expect(stops.map((s) => s.note)).toContain('The computer went to sleep')
})

test('the guides are in the application, and nothing can take the window away from HMMS', async () => {
  const { app, page } = await launch(newDataDir())
  expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu())).toBeNull()

  await setupAdmin(page)
  await nav(page, 'Help & guides')
  await expect(page.getByRole('heading', { name: 'User guide', level: 1 })).toBeVisible()
  await page.getByRole('tab', { name: 'Match operator' }).click()
  await expect(page.getByRole('heading', { name: 'If HMMS stops during a match' })).toBeVisible()
  await page.getByRole('tab', { name: 'Administrator' }).click()
  await expect(page.getByRole('heading', { name: 'If HMMS cannot open its data' })).toBeVisible()

  // What a file dropped on the window does: a navigation to a file:// address.
  const before = page.url()
  await page.evaluate(() => (location.href = 'file:///C:/Windows/win.ini'))
  await expect.poll(() => page.url()).toBe(before)
  expect(await windowText(app)).toContain('If HMMS cannot open its data')
  await app.close()
})

test('a damaged database is replaced from the latest backup, and the damaged file is kept', async () => {
  const dir = await dataWithBackup()
  const dbFile = join(dir, 'data', 'hmms.db')
  const damaged = Buffer.from('the disk failed here '.repeat(500))
  writeFileSync(dbFile, damaged)
  for (const ext of ['-wal', '-shm']) rmSync(dbFile + ext, { force: true })

  const dialogLog = join(dir, 'dialogs.jsonl')
  const { app, page } = await launch(dir, { args: ['-r', STUB], env: { HMMS_DIALOG_LOG: dialogLog } })
  await signIn(page)

  const shown = dialogsShown(dialogLog)
  expect(shown.map((d) => d.title)).toEqual(['HMMS cannot open its data', 'Backup restored'])
  expect(shown[0].buttons?.[0]).toBe('Restore the latest backup')
  const kept = readdirSync(join(dir, 'data')).find((f) => f.startsWith('damaged-'))
  expect(readFileSync(join(dir, 'data', kept!, 'hmms.db')).equals(damaged)).toBe(true)

  await nav(page, 'Settings')
  await page.getByRole('tab', { name: /System & audit/ }).click()
  await expect(page.getByText('backup.recover')).toBeVisible()
  await app.close()
})

test('a missing database is reported instead of quietly starting again from nothing', async () => {
  const dir = await dataWithBackup()
  const dbFile = join(dir, 'data', 'hmms.db')
  for (const ext of ['', '-wal', '-shm']) rmSync(dbFile + ext, { force: true })

  const dialogLog = join(dir, 'dialogs.jsonl')
  const { app, page } = await launch(dir, { args: ['-r', STUB], env: { HMMS_DIALOG_LOG: dialogLog } })
  await signIn(page)
  expect(dialogsShown(dialogLog)[0].title).toBe('HMMS cannot open its data')
  await app.close()
})

test('a failed update leaves the data in place and offers no restore', async () => {
  const dir = await dataWithBackup()
  const dbFile = join(dir, 'data', 'hmms.db')
  // The table the newest migration creates is already there, so that migration cannot succeed.
  const db = new Database(dbFile)
  db.prepare("DELETE FROM __hmms_migrations WHERE id = '0005_knockout_ties'").run()
  db.close()

  const dialogLog = join(dir, 'dialogs.jsonl')
  const run = spawnSync(electronBinary(), ['-r', STUB, resolve('out/main/index.js')], {
    env: { ...cleanEnv(), HMMS_USER_DATA: dir, HMMS_DIALOG_LOG: dialogLog },
    timeout: 30_000
  })

  expect(run.status).toBe(1)
  const shown = dialogsShown(dialogLog)
  expect(shown.map((d) => d.title)).toEqual(['HMMS cannot start'])
  expect(shown[0].content).toMatch(/Your data is safe/)
  expect(readdirSync(join(dir, 'data')).some((f) => f.startsWith('damaged-'))).toBe(false)
  expect(readdirSync(join(dir, 'backups')).some((f) => f.includes('pre_update'))).toBe(true)
})

test('a damaged demonstration database leaves the application working', async () => {
  const dir = await dataWithBackup()
  writeFileSync(join(dir, 'data', 'hmms-demo.db'), 'the disk failed here '.repeat(500))
  const { app, page } = await launch(dir)
  await page.getByRole('button', { name: /Explore demonstration mode/ }).click()
  await expect(page.getByText(/Demonstration mode - sample data only/)).toBeHidden()
  await signIn(page)
  await nav(page, 'Teams')
  await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible()
  await app.close()
})

test('data from a newer version is refused with an explanation and left unchanged', async () => {
  const dir = await dataWithBackup()
  const dbFile = join(dir, 'data', 'hmms.db')
  const db = new Database(dbFile)
  db.prepare('INSERT INTO __hmms_migrations (id, applied_at) VALUES (?, ?)').run('9999_from_the_future', 1)
  db.close()
  const before = readFileSync(dbFile)

  const dialogLog = join(dir, 'dialogs.jsonl')
  const electronBinary = createRequire(resolve('package.json'))('electron') as string
  const run = spawnSync(electronBinary, ['-r', STUB, resolve('out/main/index.js')], {
    env: { ...cleanEnv(), HMMS_USER_DATA: dir, HMMS_DIALOG_LOG: dialogLog },
    timeout: 30_000
  })

  expect(run.status).toBe(1)
  const [shown] = dialogsShown(dialogLog)
  expect(shown.title).toBe('HMMS cannot start')
  expect(shown.content).toMatch(/newer version of HMMS/)
  expect(readFileSync(dbFile).equals(before)).toBe(true)
})
