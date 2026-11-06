import Database from 'better-sqlite3'
import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setupAdmin, signIn } from '../e2e/helpers'

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
const INSTALLER = resolve('release', `HMMS-Setup-${version}.exe`)
const OLD_VERSION = '0.7.9'
const OLD_INSTALLER = resolve('release', 'upgrade-from', `HMMS-Setup-${OLD_VERSION}.exe`)
const DEBUG_PORT = 9347
const SHORTCUT = join(process.env.APPDATA!, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'HMMS.lnk')

/** A space and an accent, as in many Windows user folders. */
const scratch = mkdtempSync(join(tmpdir(), 'hmms-package-'))
const installDir = join(scratch, 'HMMS Tést Install')
const dataDir = join(scratch, 'data')
const exe = join(installDir, 'HMMS.exe')

/** Only what Windows itself provides: no Node.js, npm or development tools on the path. */
function bareEnvironment(): Record<string, string> {
  const pick = ['SystemRoot', 'SystemDrive', 'windir', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ComSpec']
  const env = Object.fromEntries(pick.flatMap((k) => (process.env[k] ? [[k, process.env[k]!]] : [])))
  return { ...env, PATH: join(process.env.SystemRoot!, 'System32'), HMMS_USER_DATA: dataDir }
}

function install(installer: string): void {
  // /D must come last and unquoted, whatever the folder name: NSIS reads it literally.
  const run = spawnSync(installer, [`/S /currentuser /D=${installDir}`], { windowsVerbatimArguments: true, timeout: 180_000 })
  expect(run.status).toBe(0)
}

interface Running {
  child: ChildProcess
  browser: Browser
  page: Page
  requests: string[]
}

async function connect(): Promise<Browser> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`)
    } catch (err) {
      if (attempt > 60) throw err
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

/** Start the installed program. The fuses block Playwright's Electron launcher, as they should. */
async function start(): Promise<Running> {
  const child = spawn(exe, [`--remote-debugging-port=${DEBUG_PORT}`], { env: bareEnvironment(), stdio: 'ignore' })
  const browser = await connect()
  const context = browser.contexts()[0]
  await expect.poll(() => context.pages().length, { timeout: 30_000 }).toBeGreaterThan(0)
  const page = context.pages()[0]
  const requests: string[] = []
  context.on('request', (r) => requests.push(r.url()))
  await page.reload()
  return { child, browser, page, requests }
}

async function stop({ child, browser, page }: Running): Promise<void> {
  const exited = new Promise((r) => child.once('exit', r))
  await page.evaluate(() => window.close())
  await exited
  await browser.close().catch(() => undefined)
}

async function invoke<T>(page: Page, channel: string, input?: unknown): Promise<T> {
  const res = await page.evaluate(
    ([c, i]) => (window as unknown as { hmms: { invoke: (c: unknown, i: unknown) => Promise<unknown> } }).hmms.invoke(c, i),
    [channel, input]
  )
  const out = res as { ok: boolean; data: T; error?: { message: string } }
  if (!out.ok) throw new Error(`${channel}: ${out.error?.message}`)
  return out.data
}

test.afterAll(() => {
  const uninstaller = join(installDir, 'Uninstall HMMS.exe')
  if (existsSync(uninstaller)) spawnSync(uninstaller, ['/S', '/currentuser'], { timeout: 60_000 })
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
})

test('install, use, update and uninstall HMMS as a user would', async () => {
  await test.step('the older version installs without administrator rights', () => {
    install(OLD_INSTALLER)
    expect(existsSync(exe)).toBe(true)
    expect(existsSync(SHORTCUT)).toBe(true)
  })

  await test.step('it starts with nothing but Windows, and data survives a restart', async () => {
    const first = await start()
    await setupAdmin(first.page)
    expect((await invoke<{ version: string }>(first.page, 'app.info')).version).toBe(OLD_VERSION)
    await stop(first)
    expect(existsSync(join(dataDir, 'hmms.running'))).toBe(false)

    const again = await start()
    await signIn(again.page)
    await stop(again)
  })

  await test.step('an update keeps the data, and copies it before changing it', async () => {
    // The two builds have the same schema, so make the data look as if it came from an older one.
    const db = new Database(join(dataDir, 'data', 'hmms.db'))
    db.exec('DROP TABLE knockout_ties')
    db.prepare("DELETE FROM __hmms_migrations WHERE id = '0005_knockout_ties'").run()
    db.close()

    install(INSTALLER)
    const updated = await start()
    await signIn(updated.page)
    expect((await invoke<{ version: string }>(updated.page, 'app.info')).version).toBe(version)
    const backups = await invoke<{ kind: string; exists: boolean }[]>(updated.page, 'backup.list')
    expect(backups).toContainEqual(expect.objectContaining({ kind: 'pre_update', exists: true }))

    await updated.page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Help & guides' }).click()
    await expect(updated.page.getByRole('heading', { name: 'User guide', level: 1 })).toBeVisible()
    await stop(updated)
  })

  await test.step('the live engine and reports work from inside the package', async () => {
    const run = await start()
    const { page } = run
    await page.getByRole('button', { name: /Explore demonstration mode/ }).click()
    await expect(page.getByText(/Demonstration mode - sample data only/)).toBeVisible()
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Live Match Centre' }).click()
    await page.locator('a[href^="#/live/"]').first().click()
    await page.getByRole('button', { name: 'Start match' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Start match' }).click()
    await page.getByRole('button', { name: /Start clock/ }).click()
    await expect(page.getByRole('button', { name: /Stop clock/ })).toBeVisible()
    await page.keyboard.press('h')
    await page.keyboard.press('9')
    await page.keyboard.press('g')
    await expect(page.getByRole('region', { name: 'Match timeline' })).toContainText('Goal')
    await page.getByRole('button', { name: /Stop clock/ }).click()

    const [match] = await invoke<{ id: string }[]>(page, 'matches.list', { status: ['live'], limit: 1 })
    for (const format of ['pdf', 'xlsx']) {
      const file = await invoke<{ sizeBytes: number }>(page, 'reports.generate', { matchId: match.id, format })
      expect(file.sizeBytes).toBeGreaterThan(1000)
    }

    const offline = /^(file:|hmms-media:|data:|blob:)/
    expect(run.requests.length).toBeGreaterThan(0)
    expect(run.requests.filter((url) => !offline.test(url))).toEqual([])
    await stop(run)
  })

  await test.step('uninstalling removes the program and keeps the data', async () => {
    spawnSync(join(installDir, 'Uninstall HMMS.exe'), ['/S', '/currentuser'], { timeout: 60_000 })
    await expect.poll(() => existsSync(exe), { timeout: 60_000 }).toBe(false)
    await expect.poll(() => existsSync(SHORTCUT)).toBe(false)
    expect(readdirSync(join(dataDir, 'data'))).toContain('hmms.db')
    expect(readdirSync(join(dataDir, 'backups')).length).toBeGreaterThan(0)
  })
})
