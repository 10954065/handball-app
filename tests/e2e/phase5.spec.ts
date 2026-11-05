import { expect, test, type Page } from '@playwright/test'
import { launch, newDataDir } from './app'
import { nav } from './helpers'

const clock = (page: Page) => page.getByTestId('match-clock')
const panel = (page: Page) => page.getByRole('region', { name: 'Record event' })
const home = (page: Page) => page.getByRole('region', { name: 'Sample Accra Lions HC players' })
const away = (page: Page) => page.getByRole('region', { name: 'Sample Kumasi Royals HC players' })
const timeline = (page: Page) => page.getByRole('region', { name: 'Match timeline' })

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

test('discipline and time-outs are run from the match centre and shown on the scoreboard', async () => {
  const { app, page } = await launch(newDataDir())
  await startFriendly(page)

  // Warning by keyboard, then a rule conflict the operator must acknowledge.
  await page.keyboard.press('h')
  await page.keyboard.press('9')
  await page.keyboard.press('y')
  await expect(timeline(page)).toContainText('Warning')
  await expect(page.getByLabel('Entry confirmations')).toContainText('Warning')
  await page.keyboard.press('h')
  await page.keyboard.press('9')
  await page.keyboard.press('y')
  const conflict = page.getByRole('dialog', { name: 'This decision conflicts with a rule limit.' })
  await expect(conflict).toContainText('a player should receive only one warning')
  await conflict.getByRole('button', { name: 'Cancel' }).click()

  // Suspension: the countdown runs and the team is reduced.
  await home(page).getByRole('button', { name: /^#10 / }).click()
  await panel(page).getByRole('button', { name: /2 min/ }).click()
  await expect(home(page).getByLabel('Team reductions')).toContainText('#10')
  await expect(home(page)).toContainText('6 on court / 6 allowed')
  await expect(home(page).getByTestId('reduction-time')).toHaveText(/^1:\d\d$/, { timeout: 5000 })

  // Public scoreboard shows the running suspension.
  const boardPromise = app.waitForEvent('window')
  await page.getByRole('button', { name: 'Public scoreboard' }).click()
  const board = await boardPromise
  await expect(board.getByTestId('board-timers-home')).toContainText(/1:\d\d/)

  // Red and blue card.
  await away(page).getByRole('button', { name: /^#5 / }).click()
  await panel(page).getByRole('button', { name: /Red card/ }).click()
  const red = page.getByRole('dialog')
  await red.getByRole('switch', { name: 'Blue card' }).click()
  await red.getByRole('button', { name: 'Record red card' }).click()
  await expect(timeline(page)).toContainText('Red and blue card')
  await expect(panel(page)).toContainText('Select a player')
  await expect(timeline(page)).toContainText('written report required')
  await expect(away(page).getByRole('button', { name: /^#5 .*Disqualified/ })).toBeVisible()

  // Team official suspension.
  await away(page).getByRole('button', { name: /^Official A / }).click()
  const off = page.getByRole('dialog')
  await off.getByRole('tab', { name: '2 minutes' }).click()
  await off.getByRole('button', { name: 'Record 2 minutes' }).click()
  await expect(timeline(page)).toContainText('Official A')
  await expect(away(page)).toContainText('6 on court / 5 allowed')
  await away(page).getByRole('button', { name: /^#9 / }).click()
  await page.screenshot({ path: 'test-results/phase5-discipline.png' })

  // Team time-out: the clock stops and the countdown runs.
  await page.getByRole('button', { name: /Time-out ACL/ }).click()
  await expect(page.getByRole('status', { name: 'Team time-out' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Start clock/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Time-out KUR/ })).toBeDisabled()
  await expect(page.getByTestId('timeout-clock')).toHaveText(/^0:\d\d$/, { timeout: 5000 })
  await expect(board.getByTestId('board-timeout')).toHaveText(/^(0:\d\d|1:00)$/)
  await board.screenshot({ path: 'test-results/phase5-scoreboard.png' })
  const frozen = await clock(page).textContent()
  await page.getByRole('button', { name: 'End time-out' }).click()
  await expect(page.getByRole('status', { name: 'Team time-out' })).toBeHidden()
  await expect(page.getByRole('button', { name: /Time-out ACL/ })).toContainText('2 left')
  await expect(clock(page)).toHaveText(frozen!)

  // Undo restores the time-out.
  await page.keyboard.press('Control+z')
  await page.getByRole('dialog').getByRole('button', { name: 'Void event' }).click()
  await expect(page.getByRole('button', { name: /Time-out ACL/ })).toContainText('3 left')
  await app.close()
})
