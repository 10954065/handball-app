import { expect, type Page } from '@playwright/test'

export async function setupAdmin(page: Page): Promise<void> {
  await expect(page.getByText('Welcome - first-run setup')).toBeVisible()
  await page.getByLabel('Your full name').fill('Ama Mensah')
  await page.getByLabel(/^Username/).fill('secretary')
  await page.getByLabel(/^Password/).fill('Handball2026')
  await page.getByLabel(/^Confirm/).fill('Handball2026')
  await page.getByRole('button', { name: 'Create administrator' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome, Ama' })).toBeVisible()
}

export async function signIn(page: Page): Promise<void> {
  await page.getByLabel('Username').fill('secretary')
  await page.getByLabel('Password').fill('Handball2026')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome, Ama' })).toBeVisible()
}

/** A valid 8x8 red PNG for upload tests. */
export const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC',
  'base64'
)

/** Click a primary sidebar navigation item. */
export async function nav(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name }).click()
}
