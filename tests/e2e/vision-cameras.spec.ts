import Database from 'better-sqlite3'
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
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

const SAMPLE = resolve('ai-vision/models/people-sample.jpg')

/** Real people moving gently across a photograph, for the real model to find. */
function peopleClip(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'hmms-clip-')), 'people.mp4')
  const script = `
import sys, cv2, numpy as np
image = cv2.imread(sys.argv[2])
h, w = image.shape[:2]
out = cv2.VideoWriter(sys.argv[1], cv2.VideoWriter_fourcc(*'mp4v'), 25, (w, h))
for i in range(1500):
    shift = int(20 * np.sin(i / 25))
    out.write(cv2.warpAffine(image, np.float32([[1, 0, shift], [0, 1, 0]]), (w, h), borderMode=cv2.BORDER_REPLICATE))
out.release()
`
  execFileSync(resolve('ai-vision/.venv/Scripts/python.exe'), ['-c', script, file, SAMPLE])
  return file
}

const clockSeconds = async (page: Page) => {
  const [m, s] = ((await page.getByTestId('match-clock').textContent()) ?? '0:0').split(':').map(Number)
  return m * 60 + s
}

test.describe('with the real model', () => {
  test.skip(!existsSync(resolve('ai-vision/models/yolox_s.onnx')) || !existsSync(SAMPLE), 'The model is not installed')

  test('real people are found and tracked, and the match clock keeps time meanwhile', async () => {
    const { app, page } = await launch(newDataDir())
    await openVisionInDemo(page)
    await addVideoCamera(app, page, 'People', peopleClip())
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(page.getByLabel('Camera People').getByText('Live', { exact: true })).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Start analysis' }).click()
    await expect(page.getByText('Analysing', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Graphics card')).toBeVisible()
    await expect(page.getByRole('img', { name: /[1-9]\d* players tracked/ })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/#T\d+/).first()).toBeVisible()
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'vision-tracking.png') })

    // Run a match with the graphics card busy: the clock must not depend on any of it.
    await nav(page, 'Live Match Centre')
    await page.locator('a[href^="#/live/"]').first().click()
    await page.getByRole('button', { name: 'Start match' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Start match' }).click()
    await page.getByRole('button', { name: /Start clock/ }).click()
    await expect(page.getByRole('button', { name: /Stop clock/ })).toBeVisible()
    const started = Date.now()
    await page.waitForTimeout(6000)
    await page.keyboard.press('h')
    await page.keyboard.press('9')
    await page.keyboard.press('g')
    await expect(page.getByRole('region', { name: 'Match timeline' })).toContainText('Goal')
    const elapsed = (Date.now() - started) / 1000
    expect(Math.abs((await clockSeconds(page)) - elapsed)).toBeLessThanOrEqual(1.5)

    await nav(page, 'AI Vision')
    await page.getByRole('button', { name: 'Pause' }).click()
    await expect(page.getByText('Paused', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Stop analysis' }).click()
    await expect(page.getByRole('button', { name: 'Start analysis' })).toBeVisible()
    await app.close()
  })
})

/** A drawn court with a ball thrown into the right-hand goal every few seconds. */
function shotClip(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'hmms-clip-')), 'shots.mp4')
  const script = `
import sys, cv2, numpy as np
W, H = 1280, 720
out = cv2.VideoWriter(sys.argv[1], cv2.VideoWriter_fourcc(*'mp4v'), 25, (W, H))
for i in range(2000):
    f = np.full((H, W, 3), (60, 120, 70), np.uint8)
    cv2.rectangle(f, (int(W * .93), int(H * .35)), (W - 4, int(H * .65)), (240, 240, 240), 3)
    step = i % 75
    if 20 <= step < 32:
        p = (step - 20) / 11
        cv2.circle(f, (int(W * (.5 + .46 * p)), int(H * (.5 - .02 * p))), 7, (0, 200, 255), -1)
    out.write(f)
out.release()
`
  execFileSync(resolve('ai-vision/.venv/Scripts/python.exe'), ['-c', script, file])
  return file
}

/** Drag across the frozen picture, in fractions of its width and height. */
async function dragOnPicture(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId('goal-picture').boundingBox())!
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 5 })
  await page.mouse.up()
}

test.describe('from camera to official record', () => {
  test.skip(!existsSync(resolve('ai-vision/models/yolox_s.onnx')), 'The model is not installed')
  let shots = ''

  test.beforeAll(() => {
    shots = shotClip()
  })

  test('a shot on camera becomes a suggestion, and only an official makes it a goal', async () => {
    const dir = newDataDir()
    const { app, page } = await launch(dir)
    await openVisionInDemo(page)

    await nav(page, 'Live Match Centre')
    await page.locator('a[href^="#/live/"]').first().click()
    await page.getByRole('button', { name: 'Start match' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Start match' }).click()
    await page.getByRole('button', { name: /Start clock/ }).click()
    await expect(page.getByRole('button', { name: /Stop clock/ })).toBeVisible()

    await nav(page, 'AI Vision')
    await addVideoCamera(app, page, 'Goal camera', shots)
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(page.getByLabel('Camera Goal camera').getByText('Live', { exact: true })).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Mark goal areas' }).click()
    await page.getByRole('button', { name: 'Right goal' }).click()
    await expect(page.getByRole('img', { name: 'Picture from Goal camera' })).toBeVisible()
    await dragOnPicture(page, [0.9, 0.3], [0.995, 0.7])
    await expect(page.getByRole('img', { name: 'Right goal area' })).toBeVisible()
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'vision-goal-areas.png') })
    await page.getByRole('button', { name: 'Save goal areas' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()

    await page.getByLabel('Match').selectOption({ index: 1 })
    await page.getByRole('button', { name: 'Start analysis' }).click()
    await expect(page.getByText('Analysing', { exact: true })).toBeVisible({ timeout: 30_000 })

    await nav(page, 'Live Match Centre')
    await page.locator('a[href^="#/live/"]').first().click()
    const queue = page.getByRole('region', { name: 'AI suggestions' })
    await expect(queue).toContainText('Possible goal', { timeout: 30_000 })
    await expect(queue).toContainText('Unknown player')

    // Seen by the camera, and still nothing on the official record.
    const timeline = page.getByRole('region', { name: 'Match timeline' })
    await expect(timeline).not.toContainText(/\d:\d\dGoal/)
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'vision-queue.png') })

    await queue.getByRole('button', { name: /^Review/ }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Record event' })).toBeDisabled()
    await dialog.getByLabel(/Scorer/).selectOption({ index: 1 })
    await dialog.getByRole('button', { name: 'Record event' }).click()
    await expect(dialog).toBeHidden()
    await expect(timeline).toContainText(/\d:\d\dGoal/)

    await nav(page, 'AI Vision')
    await page.getByRole('button', { name: 'Stop analysis' }).click()
    await expect(page.getByRole('button', { name: 'Start analysis' })).toBeVisible()
    await app.close()

    const db = new Database(join(dir, 'data', 'hmms-demo.db'), { readonly: true })
    const confirmed = db.prepare("SELECT event_id, status FROM ai_event_suggestions WHERE status IN ('confirmed', 'corrected')").all() as { event_id: string; status: string }[]
    const goals = db.prepare("SELECT id FROM match_events WHERE type = 'shot' AND outcome = 'goal' AND status = 'active'").all() as { id: string }[]
    const audits = db.prepare("SELECT count(*) AS n FROM audit_logs WHERE action = 'ai.suggestion.confirm'").get() as { n: number }
    db.close()
    expect(confirmed).toHaveLength(1)
    expect(goals.map((g) => g.id)).toEqual([confirmed[0].event_id])
    expect(audits.n).toBe(1)
  })
})
