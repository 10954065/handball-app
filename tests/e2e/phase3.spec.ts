import { expect, test } from '@playwright/test'
import { launch, newDataDir } from './app'
import { nav } from './helpers'

test('both starting lineups can be prepared, validated, confirmed and persist', async () => {
  const dataDir = newDataDir()
  let { app, page } = await launch(dataDir)
  await page.getByRole('button', { name: /Explore demonstration mode/ }).click()
  await expect(page.getByText(/Demonstration mode - sample data only/)).toBeVisible()

  await nav(page, 'Matches')
  await page.locator('a[href^="#/matches/"]').first().click()
  await page.getByRole('button', { name: 'Match sheet & lineups' }).click()
  await expect(page.getByRole('heading', { name: 'Match sheet & starting lineups' })).toBeVisible()

  for (const label of ['Sample Accra Lions HC lineup', 'Sample Kumasi Royals HC lineup']) {
    const side = page.getByRole('region', { name: label })
    await side.getByRole('button', { name: 'Add whole squad' }).click()
    await expect(side.getByText('Substitutes (14)')).toBeVisible()
    await side.getByRole('button', { name: 'Suggest seven' }).click()
    await expect(side.getByText('Starters').locator('..')).toContainText('7/7')
    // An eighth starter is refused: the seven is full.
    await side.getByText('Substitutes (7)').locator('../..').locator('button[aria-pressed=false]').first().click()
    await expect(page.getByText(/starting seven is full/).first()).toBeVisible()
    await side.getByRole('button', { name: 'Confirm lineup' }).click()
    await expect(side.getByText('Confirmed', { exact: true })).toBeVisible()
  }
  await expect(page.getByText('Both lineups confirmed - final match confirmation')).toBeVisible()
  await page.screenshot({ path: 'test-results/phase3-lineups.png', fullPage: false })
  await app.close()

  ;({ app, page } = await launch(dataDir))
  await page.getByRole('button', { name: /Explore demonstration mode/ }).click()
  await nav(page, 'Matches')
  await expect(page.getByText('Lineups ready').first()).toBeVisible()
  await page.locator('a[href^="#/matches/"]').first().click()
  await expect(page.getByText(/ACL confirmed \/ KUR confirmed/)).toBeVisible()
  await app.close()
})
