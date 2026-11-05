import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, newDataDir } from './app'
import { nav, RED_PNG, setupAdmin, signIn } from './helpers'

test('administration data can be created, searched and survives a restart', async () => {
  const dataDir = newDataDir()
  const logo = join(dataDir, 'logo.png')
  writeFileSync(logo, RED_PNG)
  let { app, page } = await launch(dataDir)
  await setupAdmin(page)

  for (const [name, code] of [['Accra Lions HC', 'ACL'], ['Kumasi Royals HC', 'KUR']]) {
    await nav(page, 'Teams')
    await page.getByRole('button', { name: 'Register team' }).first().click()
    await page.getByRole('dialog').getByLabel('Team name').fill(name)
    await page.getByRole('dialog').getByLabel('Short name').fill(name.split(' ')[0])
    await page.getByRole('dialog').getByLabel('Code').fill(code)
    if (code === 'ACL') {
      await page.locator('input[type=file]').setInputFiles(logo)
      await expect(page.getByRole('dialog').locator('img[src^="hmms-media://"]')).toBeVisible()
    }
    await page.getByRole('dialog').getByRole('button', { name: 'Register team' }).click()
    await expect(page.getByRole('heading', { name })).toBeVisible()
  }

  await nav(page, 'Teams')
  await page.getByText('Accra Lions HC').click()
  const squad: [string, string, string][] = [['Kwame', 'Mensah', '7'], ['Kofi', 'Owusu', '1'], ['Yaw', 'Boateng', '7']]
  for (const [first, last, jersey] of squad) {
    await page.getByRole('button', { name: 'Register player' }).click()
    await page.getByRole('dialog').getByLabel('First name').fill(first)
    await page.getByRole('dialog').getByLabel('Last name').fill(last)
    await page.getByRole('dialog').getByLabel('Jersey number').fill(jersey)
    await page.getByRole('dialog').getByRole('button', { name: 'Register player' }).click()
    if (first === 'Yaw') {
      await expect(page.getByText('Jersey #7 is already worn by Kwame Mensah in this team.')).toBeVisible()
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    } else {
      await expect(page.getByText(`${first} ${last} registered`)).toBeVisible()
    }
  }
  await expect(page.getByText('Registered players (2)')).toBeVisible()
  await page.screenshot({ path: 'test-results/phase2-team.png' })

  await nav(page, 'Officials')
  await page.getByRole('button', { name: 'Add official' }).click()
  await page.getByRole('dialog').getByLabel('Full name').fill('Abena Darko')
  await page.getByRole('dialog').getByRole('button', { name: 'Add official' }).click()
  await page.getByRole('tab', { name: 'Venues' }).click()
  await page.getByRole('button', { name: 'Add venue' }).click()
  await page.getByRole('dialog').getByLabel('Venue name').fill('Accra Sports Hall')
  await page.getByRole('dialog').getByRole('button', { name: 'Add venue' }).click()
  await expect(page.getByText('Accra Sports Hall')).toBeVisible()
  await app.close()
  ;({ app, page } = await launch(dataDir))
  await signIn(page)
  await nav(page, 'Players')
  await page.getByLabel('Name, player ID or jersey number').fill('7')
  await expect(page.getByRole('cell', { name: 'Kwame Mensah' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Kofi Owusu' })).toHaveCount(0)
  await page.getByRole('cell', { name: 'Kwame Mensah' }).click()
  await expect(page.getByRole('heading', { name: 'Kwame Mensah' })).toBeVisible()
  await expect(page.getByText('P-000001')).toBeVisible()
  await app.close()
})

test('competitions, seasons and matches can be created and persist', async () => {
  const dataDir = newDataDir()
  let { app, page } = await launch(dataDir)
  await setupAdmin(page)
  for (const [name, code] of [['Accra Lions HC', 'ACL'], ['Kumasi Royals HC', 'KUR']]) {
    await nav(page, 'Teams')
    await page.getByRole('button', { name: 'Register team' }).first().click()
    await page.getByRole('dialog').getByLabel('Team name').fill(name)
    await page.getByRole('dialog').getByLabel('Short name').fill(code)
    await page.getByRole('dialog').getByLabel('Code').fill(code)
    await page.getByRole('dialog').getByRole('button', { name: 'Register team' }).click()
    await expect(page.getByRole('heading', { name })).toBeVisible()
  }

  await nav(page, 'Competitions')
  await page.getByRole('button', { name: 'Create competition' }).first().click()
  await page.getByRole('dialog').getByLabel('Competition name').fill('Premier League')
  await page.getByRole('dialog').getByRole('button', { name: 'Create competition' }).click()
  await expect(page.getByRole('heading', { name: 'Premier League' })).toBeVisible()
  await page.getByRole('button', { name: 'New season' }).first().click()
  await page.getByRole('dialog').getByLabel('Season name').fill('2026/27')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Manage teams' }).click()
  await page.getByRole('dialog').getByText('Accra Lions HC').click()
  await page.getByRole('dialog').getByText('Kumasi Royals HC').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Teams (2)')).toBeVisible()

  await page.getByRole('button', { name: 'Add fixture' }).click()
  await page.getByRole('dialog').getByLabel('Home team').selectOption({ label: 'Accra Lions HC' })
  await page.getByRole('dialog').getByLabel('Away team').selectOption({ label: 'Kumasi Royals HC' })
  await page.getByRole('dialog').getByRole('button', { name: 'Create match' }).click()
  await expect(page.getByText(/Match M-\d{4}-0001 created/)).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/phase2-competition.png' })

  await nav(page, 'Dashboard')
  await expect(page.getByText('Upcoming matches', { exact: true })).toBeVisible()
  // The cached empty state may show briefly while the dashboard refreshes.
  await expect(page.getByText('No upcoming matches')).toBeHidden()
  await page.screenshot({ path: 'test-results/phase2-dashboard.png' })
  await app.close()

  ;({ app, page } = await launch(dataDir))
  await signIn(page)
  await nav(page, 'Matches')
  await expect(page.getByText('Kumasi Royals HC').first()).toBeVisible()
  await page.getByText('Kumasi Royals HC').first().click()
  await expect(page.getByText(/M-\d{4}-0001/)).toBeVisible()
  await expect(page.getByText('IHF Senior (2 x 30 min)')).toBeVisible()
  await app.close()
})
