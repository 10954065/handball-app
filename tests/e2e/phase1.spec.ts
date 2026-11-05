import { expect, test } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch, newDataDir } from './app'
import { nav } from './helpers'

test('first-run setup, local persistence, backup and sign-in after restart', async () => {
  const dataDir = newDataDir()
  let { app, page } = await launch(dataDir)

  await expect(page.getByText('Welcome - first-run setup')).toBeVisible()
  await page.getByLabel('Association / organisation').fill('Handball Association of Ghana')
  await page.getByLabel('Your full name').fill('Ama Mensah')
  await page.getByLabel(/^Username/).fill('secretary')
  await page.getByLabel(/^Password/).fill('Handball2026')
  await page.getByLabel(/^Confirm/).fill('Handball2026')
  await page.getByRole('button', { name: 'Create administrator' }).click()

  await expect(page.getByRole('heading', { name: 'Welcome, Ama' })).toBeVisible()
  await expect(page.getByText('Handball Association of Ghana')).toBeVisible()
  await expect(page.getByText('Healthy')).toBeVisible()
  await page.screenshot({ path: 'test-results/phase1-dashboard.png' })

  await page.getByRole('button', { name: 'Back up now' }).click()
  await expect(page.getByText(/Backup created/)).toBeVisible()

  await nav(page, 'Settings')
  await page.getByRole('tab', { name: /Backup & restore/ }).click()
  await expect(page.getByRole('cell', { name: 'Manual' }).first()).toBeVisible()
  await page.screenshot({ path: 'test-results/phase1-settings-backup.png' })

  await app.close()
  expect(existsSync(join(dataDir, 'data', 'hmms.db'))).toBe(true)
  expect(readdirSync(join(dataDir, 'backups')).some((f) => f.endsWith('.db'))).toBe(true)

  ;({ app, page } = await launch(dataDir))
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await page.getByLabel('Username').fill('secretary')
  await page.getByLabel('Password').fill('Handball2026')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome, Ama' })).toBeVisible()
  await nav(page, 'Settings')
  await expect(page.getByLabel('Association / organisation name')).toHaveValue('Handball Association of Ghana')
  await app.close()
})

test('demonstration mode uses a separate, clearly labelled database', async () => {
  const dataDir = newDataDir()
  const { app, page } = await launch(dataDir)
  await page.getByRole('button', { name: /Explore demonstration mode/ }).click()
  await expect(page.getByText(/Demonstration mode - sample data only/)).toBeVisible()
  await page.getByRole('button', { name: 'Exit demo' }).click()
  await expect(page.getByText('Welcome - first-run setup')).toBeVisible()
  await app.close()
  expect(existsSync(join(dataDir, 'data', 'hmms-demo.db'))).toBe(true)
})
