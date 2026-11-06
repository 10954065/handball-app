import { execSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'
import { launch, newDataDir } from './app'
import { nav } from './helpers'

const clock = (page: Page) => page.getByTestId('match-clock')
const seconds = async (page: Page) => {
  const [m, s] = ((await clock(page).textContent()) ?? '0:0').split(':').map(Number)
  return m * 60 + s
}

async function enterDemo(page: Page) {
  await page.getByRole('button', { name: /Explore demonstration mode/ }).click()
  await expect(page.getByText(/Demonstration mode - sample data only/)).toBeVisible()
}

/** The service's own Python processes, found by the command line that starts them. */
function killVisionService(): void {
  execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='python.exe'\\" | Where-Object { $_.CommandLine -like '*hmms_vision*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore' })
}

test('the AI service starts and stops from its own screen', async () => {
  const { app, page } = await launch(newDataDir())
  await enterDemo(page)
  await nav(page, 'AI Vision')
  await expect(page.getByRole('heading', { name: 'AI Vision' })).toBeVisible()
  await page.getByRole('button', { name: 'Start AI service' }).click()
  await expect(page.getByText('Running', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/of [\d,]+ MB/)).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Stop AI service' }).click()
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible()
  await app.close()
})

test('the match clock and match events carry on when the AI service is killed', async () => {
  const { app, page } = await launch(newDataDir())
  await enterDemo(page)
  await nav(page, 'AI Vision')
  await page.getByRole('button', { name: 'Start AI service' }).click()
  await expect(page.getByText('Running', { exact: true })).toBeVisible({ timeout: 20_000 })

  await nav(page, 'Live Match Centre')
  await page.locator('a[href^="#/live/"]').first().click()
  await page.getByRole('button', { name: 'Start match' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Start match' }).click()
  await page.getByRole('button', { name: /Start clock/ }).click()
  await expect(page.getByRole('button', { name: /Stop clock/ })).toBeVisible()

  killVisionService()
  const before = await seconds(page)
  await expect.poll(() => seconds(page), { timeout: 6000 }).toBeGreaterThanOrEqual(before + 2)
  await page.keyboard.press('h')
  await page.keyboard.press('9')
  await page.keyboard.press('g')
  await expect(page.getByRole('region', { name: 'Match timeline' })).toContainText('Goal')

  await nav(page, 'AI Vision')
  await expect(page.getByText('Running', { exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Stop AI service' }).click()
  await app.close()
})
