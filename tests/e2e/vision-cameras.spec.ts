import { execFileSync, execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, newDataDir } from './app'
import { nav } from './helpers'

const SHOTS = process.env.HMMS_SHOTS
let clip = ''

test.beforeAll(() => {
  clip = testClip()
})

/** A moving picture, so a test can tell live pictures from a stuck one. */
function testClip(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'hmms-clip-')), 'match.mp4')
  const script = `
import sys, cv2, numpy as np
w = cv2.VideoWriter(sys.argv[1], cv2.VideoWriter_fourcc(*'mp4v'), 25, (1280, 720))
for i in range(1500):
    f = np.full((720, 1280, 3), (40, 110, 60), np.uint8)
    cv2.circle(f, (100 + (i * 7) % 1080, 360), 24, (0, 215, 255), -1)
    w.write(f)
w.release()
`
  execFileSync(resolve('ai-vision/.venv/Scripts/python.exe'), ['-c', script, file])
  return file
}

async function openVisionInDemo(page: Page) {
  await page.getByRole('button', { name: /Explore demonstration mode/ }).click()
  await expect(page.getByText(/Demonstration mode - sample data only/)).toBeVisible()
  await nav(page, 'AI Vision')
}

async function addVideoCamera(app: ElectronApplication, page: Page, name: string, file: string) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, file)
  await page.getByRole('button', { name: 'Add camera' }).click()
  const form = page.getByRole('dialog')
  await form.getByLabel('Type of camera').selectOption('file')
  await form.getByLabel(/^Name/).fill(name)
  await form.getByRole('button', { name: 'Choose' }).click()
  await expect(form.getByLabel('Video file')).toHaveValue(file)
  await form.getByRole('button', { name: 'Save camera' }).click()
  await expect(form).toBeHidden()
  await expect(page.getByText(name, { exact: true })).toBeVisible()
}

const picture = (page: Page, name: string) => page.getByRole('img', { name: `Live picture from ${name}` })

/** What is really on screen, so a frozen picture cannot pass. */
const drawn = async (page: Page, name: string) => (await picture(page, name).screenshot()).toString('base64')

test('a camera is added, shows live moving pictures, and closes', async () => {
  const { app, page } = await launch(newDataDir())
  await openVisionInDemo(page)
  await addVideoCamera(app, page, 'Match video', clip)

  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByLabel('Camera Match video').getByText('Live', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel('Camera Match video').getByText(/1280/)).toBeVisible()
  await expect.poll(() => picture(page, 'Match video').evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0)
  const first = await drawn(page, 'Match video')
  await expect.poll(() => drawn(page, 'Match video'), { timeout: 5000 }).not.toBe(first)
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'vision-live.png') })

  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(picture(page, 'Match video')).toBeHidden()
  await app.close()
})

test('a network camera that cannot be reached says so, and its password stays hidden', async () => {
  const { app, page } = await launch(newDataDir())
  await openVisionInDemo(page)
  await page.getByRole('button', { name: 'Add camera' }).click()
  const form = page.getByRole('dialog')
  await form.getByLabel('Type of camera').selectOption('ip')
  await form.getByLabel(/^Name/).fill('Stand camera')
  await form.getByLabel('Stream address').fill('rtsp://kofi:secret@127.0.0.1:1/live')
  await form.getByLabel('Username').fill('kofi')
  await form.getByLabel('Password').fill('secret-word')
  await form.getByRole('button', { name: 'Save camera' }).click()
  await expect(form.getByText(/in their own fields/)).toBeVisible()
  await form.getByLabel('Stream address').fill('rtsp://127.0.0.1:1/live')
  await form.getByRole('button', { name: 'Save camera' }).click()
  await expect(form).toBeHidden()
  await expect(page.getByText('Stand camera', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Edit Stand camera' }).click()
  await expect(page.getByRole('dialog').getByLabel(/New password/)).toHaveValue('')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()

  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByLabel('Camera Stand camera')).toContainText('cannot be reached', { timeout: 20_000 })
  await expect(page.locator('body')).not.toContainText('secret-word')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await app.close()
})

test('the cameras on this computer are listed by name', async () => {
  const { app, page } = await launch(newDataDir())
  await openVisionInDemo(page)
  await page.getByRole('button', { name: 'Add camera' }).click()
  const select = page.getByRole('dialog').getByRole('combobox', { name: /^Camera/ })
  await expect.poll(() => select.locator('option').count(), { timeout: 20_000 }).toBeGreaterThan(1)
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await app.close()
})

test('a camera comes back by itself after the AI service is killed', async () => {
  const { app, page } = await launch(newDataDir())
  await openVisionInDemo(page)
  await addVideoCamera(app, page, 'Match video', clip)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByLabel('Camera Match video').getByText('Live', { exact: true })).toBeVisible({ timeout: 20_000 })

  execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='python.exe'\\" | Where-Object { $_.CommandLine -like '*hmms_vision*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore' })
  await expect(page.getByLabel('Camera Match video').getByText('Reconnecting', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByLabel('Camera Match video').getByText('Live', { exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await app.close()
})
