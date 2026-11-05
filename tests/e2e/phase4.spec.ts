import { expect, test, type Page } from '@playwright/test'
import { launch, newDataDir } from './app'
import { nav } from './helpers'

/** Wait until a process (and with it the single-instance lock) is gone. */
async function waitForExit(pid: number) {
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0)
    } catch {
      return new Promise((r) => setTimeout(r, 1000))
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Process ${pid} did not exit`)
}

const clock = (page: Page) => page.getByTestId('match-clock')
const score = (page: Page, side: 'home' | 'away') => page.getByTestId(`score-${side}`)

async function openDemoFriendly(page: Page) {
  await page.getByRole('button', { name: /Explore demonstration mode/ }).click()
  await expect(page.getByText(/Demonstration mode - sample data only/)).toBeVisible()
  await nav(page, 'Live Match Centre')
  await page.locator('a[href^="#/live/"]').first().click()
}

test('a match is run live: clock, goals, undo, periods, scoreboard and crash recovery', async () => {
  const dataDir = newDataDir()
  let { app, page } = await launch(dataDir)
  await openDemoFriendly(page)

  await page.getByRole('button', { name: 'Start match' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Start match' }).click()
  await expect(clock(page)).toHaveText('00:00')
  await expect(page.getByText('Clock stopped')).toBeVisible()

  // Space starts the clock; the display advances from the main-process clock.
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: /Stop clock/ })).toBeVisible()
  await expect(clock(page)).toHaveText('00:01', { timeout: 4000 })

  // Keyboard goal: H, jersey 9, G.
  await page.keyboard.press('h')
  await page.keyboard.press('9')
  await expect(page.getByRole('region', { name: 'Record event' })).toContainText('Goal')
  await page.keyboard.press('g')
  await expect(score(page, 'home')).toHaveText('1')

  // Mouse goal: tile, then Goal.
  const away = page.getByRole('region', { name: 'Sample Kumasi Royals HC players' })
  await away.getByRole('button', { name: /^#10 / }).click()
  await page.getByRole('region', { name: 'Record event' }).getByRole('button', { name: /^Goal/ }).click()
  await expect(score(page, 'away')).toHaveText('1')
  await expect(page.getByRole('region', { name: 'Match timeline' })).toContainText('1:1')

  // Ctrl+Z undoes the last entry (voided, still visible in the ledger).
  await page.keyboard.press('Control+z')
  await page.getByRole('dialog').getByRole('button', { name: 'Void event' }).click()
  await expect(score(page, 'away')).toHaveText('0')
  await expect(page.getByRole('region', { name: 'Match timeline' })).toContainText('Voided: Entered in error')

  // Correct the clock to 29:58; it then stops exactly at 30:00.
  await page.getByRole('button', { name: /Stop clock/ }).click()
  await page.getByRole('button', { name: 'Correct clock' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel(/Match time/).fill('29:58')
  await dlg.getByLabel(/Reason/).fill('Clock started late')
  await dlg.getByRole('button', { name: 'Set clock' }).click()
  await expect(clock(page)).toHaveText('29:58')
  await page.getByRole('button', { name: /Start clock/ }).click()
  await expect(clock(page)).toHaveText('30:00', { timeout: 5000 })
  await expect(page.getByRole('button', { name: /Start clock/ })).toBeVisible()
  await expect(clock(page)).toHaveText('30:00')

  await page.getByRole('button', { name: 'End first half' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'End period' }).click()
  await expect(page.getByRole('button', { name: 'Start second half' })).toBeVisible()
  await expect(page.getByText('1H 1:0').first()).toBeVisible()
  await page.screenshot({ path: 'test-results/phase4-match-centre.png' })

  // Public scoreboard on a second window.
  const boardPromise = app.waitForEvent('window')
  await page.getByRole('button', { name: 'Public scoreboard' }).click()
  const board = await boardPromise
  await expect(board.getByTestId('scoreboard')).toBeVisible()
  await expect(board.getByTestId('board-score-home')).toHaveText('1')
  await board.screenshot({ path: 'test-results/phase4-scoreboard.png' })

  // Second half running when the application is killed.
  await page.getByRole('button', { name: 'Start second half' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Start' }).click()
  await page.keyboard.press('Space')
  await expect(clock(page)).toHaveText('30:02', { timeout: 5000 })
  // Simulate a crash: terminate the Electron main process abruptly (no shutdown handlers run).
  const mainPid = await app.evaluate(() => process.pid)
  process.kill(mainPid, 'SIGKILL')
  await waitForExit(mainPid)

  ;({ app, page } = await launch(dataDir))
  await openDemoFriendly(page)
  const recovery = page.getByRole('dialog', { name: 'Recover the match clock' })
  await expect(recovery).toBeVisible()
  await recovery.getByRole('button', { name: /Continue from the last saved time/ }).click()
  await expect(recovery).toBeHidden()
  await expect(clock(page)).toHaveText(/^30:0[1-3]$/)
  await expect(score(page, 'home')).toHaveText('1')
  await expect(page.getByRole('button', { name: /Start clock/ })).toBeVisible()
  await app.close()
})
