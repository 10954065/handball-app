import ExcelJS from 'exceljs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, newDataDir } from './app'
import { nav } from './helpers'

const clock = (page: Page) => page.getByTestId('match-clock')
const timeline = (page: Page) => page.getByRole('region', { name: 'Match timeline' })
const report = (page: Page) => page.getByTestId('match-report')

async function setClockAndRunOut(page: Page, time: string, end: string) {
  await page.getByRole('button', { name: /Stop clock/ }).click()
  await page.getByRole('button', { name: 'Correct clock' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel(/Match time/).fill(time)
  await dlg.getByLabel(/Reason/).fill('Test: skip to the end of the half')
  await dlg.getByRole('button', { name: 'Set clock' }).click()
  await page.getByRole('button', { name: /Start clock/ }).click()
  await expect(clock(page)).toHaveText(end, { timeout: 6000 })
  await expect(page.getByRole('button', { name: /Start clock/ })).toBeVisible()
}

const press = async (page: Page, ...keys: string[]) => {
  for (const key of keys) await page.keyboard.press(key)
}

/** The sample friendly: home 2, away 1, one warning, finalized. Leaves the match centre open. */
async function playFriendly(page: Page) {
  await page.getByRole('button', { name: /Explore demonstration mode/ }).click()
  await expect(page.getByText(/Demonstration mode - sample data only/)).toBeVisible()
  await nav(page, 'Live Match Centre')
  await page.locator('a[href^="#/live/"]').first().click()
  await page.getByRole('button', { name: 'Start match' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Start match' }).click()
  await page.getByRole('button', { name: /Start clock/ }).click()
  await expect(page.getByRole('button', { name: /Stop clock/ })).toBeVisible()
  await expect(page.getByTestId('live-indicator')).toBeVisible()

  await press(page, 'h', '9', 'g')
  await expect(timeline(page)).toContainText('Goal')
  await press(page, 'a', '5', 'g')
  await expect(timeline(page)).toContainText('1:1')
  await press(page, 'h', '9', 'y')
  await expect(timeline(page)).toContainText('Warning')
  await setClockAndRunOut(page, '29:58', '30:00')
  await page.getByRole('button', { name: 'End first half' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'End period' }).click()

  await page.getByRole('button', { name: 'Start second half' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Start/ }).click()
  await page.getByRole('button', { name: /Start clock/ }).click()
  await expect(page.getByRole('button', { name: /Stop clock/ })).toBeVisible()
  await press(page, 'h', '9', 'g')
  await expect(timeline(page)).toContainText('2:1')
  await setClockAndRunOut(page, '59:58', '60:00')
  await page.getByRole('button', { name: 'End second half' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'End period' }).click()
  await page.getByRole('button', { name: 'Finish match' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Finish|Finalize/ }).click()
  await expect(page.getByRole('button', { name: 'Finish match' })).toBeHidden()
  await expect(page.getByTestId('live-indicator')).toBeHidden()
}

/** Answer the next save dialogs with this path, as the operator would. */
const saveTo = (app: ElectronApplication, file: string) =>
  app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog
  }, file)

test('a finished match has statistics, a report, files, an archive and a history', async () => {
  const dir = newDataDir()
  const { app, page } = await launch(dir)
  await playFriendly(page)

  // The match page shows the score flow and opens the report.
  await page.getByRole('link', { name: /M-\d{4}-\d+/ }).first().click()
  await expect(page.getByText('Score flow')).toBeVisible()
  await expect(page.getByText('Team comparison')).toBeVisible()
  await page.screenshot({ path: 'test-results/phase6-match.png', fullPage: true })
  await page.getByRole('button', { name: 'Match report' }).click()

  // Preview: the labelled sample data, the result and the sanction with its time.
  await expect(report(page)).toContainText('Demonstration data - not an official record')
  await expect(report(page).getByRole('region', { name: 'Result' })).toContainText('2:1')
  await expect(report(page).getByRole('region', { name: 'Result' })).toContainText('Half-time 1:1')
  await expect(report(page).getByRole('region', { name: 'Match timeline' })).toContainText('Warning')
  await expect(report(page).getByRole('region', { name: 'Corrections' })).toContainText('Test: skip to the end of the half')
  await expect(report(page)).toContainText(/Fingerprint [0-9a-f]{16}/)
  await report(page).screenshot({ path: 'test-results/phase6-report.png' })

  // PDF: a real file, archived, in A4.
  const pdfPath = join(dir, 'report.pdf')
  await saveTo(app, pdfPath)
  await page.getByRole('button', { name: 'Save PDF' }).click()
  await expect(page.getByText(`Saved to ${pdfPath}`)).toBeVisible({ timeout: 30_000 })
  const pdf = readFileSync(pdfPath)
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pdf.length).toBeGreaterThan(10_000)
  const text = pdf.toString('latin1')
  const pages = text.match(/\/Type\s*\/Page\b/g)?.length ?? 0
  expect(pages).toBeGreaterThanOrEqual(1)
  expect(pages).toBeLessThanOrEqual(5)
  expect(text).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+59\d(\.\d+)?\s+84\d(\.\d+)?\s*\]/)

  // The print page must not carry the dark theme onto paper, not even in the page margins.
  const matchId = /#\/reports\/([^/?]+)/.exec(page.url())![1]
  await page.evaluate((id) => (location.hash = `#/print/report/${id}`), matchId)
  await expect(page.locator('html')).toHaveAttribute('data-report-state', 'ready')
  const paper = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    return { scheme: root.colorScheme, root: root.backgroundColor, body: getComputedStyle(document.body).backgroundColor }
  })
  expect(paper).toEqual({ scheme: 'light', root: 'rgb(255, 255, 255)', body: 'rgb(255, 255, 255)' })
  await page.goBack()
  await expect(page.getByRole('button', { name: 'Save Excel' })).toBeVisible()

  // Excel: the same numbers as the screen.
  const xlsxPath = join(dir, 'report.xlsx')
  await saveTo(app, xlsxPath)
  await page.getByRole('button', { name: 'Save Excel' }).click()
  await expect(page.getByText(`Saved to ${xlsxPath}`)).toBeVisible({ timeout: 15_000 })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(xlsxPath)
  const teams = wb.getWorksheet('Teams')!
  expect(teams.getRow(1).values).toEqual([undefined, 'DEMONSTRATION DATA - NOT AN OFFICIAL RECORD'])
  expect(teams.getRow(3).values).toEqual([undefined, 'Goals', 2, 1])
  expect(wb.getWorksheet('Match')!.getColumn(2).values).toContain('DEMONSTRATION DATA - NOT AN OFFICIAL RECORD')

  // Saving the same report again reuses the archived file.
  const archived = page.getByRole('row').filter({ hasText: 'Current' })
  await expect(archived).toHaveCount(2)
  await page.getByRole('button', { name: 'Save PDF' }).click()
  await expect(page.getByText(`Saved to ${pdfPath}`).first()).toBeVisible({ timeout: 15_000 })
  await expect(archived).toHaveCount(2)

  // Printing goes through the report window to the system print dialog (stubbed here).
  await app.evaluate(({ app: electronApp }) => {
    electronApp.once('web-contents-created', (_e, contents) => {
      contents.print = ((options: object, callback: (ok: boolean, reason: string) => void) => {
        ;(globalThis as Record<string, unknown>).printedWith = options
        callback(true, '')
      }) as typeof contents.print
    })
  })
  await page.getByRole('button', { name: 'Print' }).click()
  await expect
    .poll(() => app.evaluate(() => (globalThis as Record<string, unknown>).printedWith), { timeout: 15_000 })
    .toMatchObject({ pageSize: 'A4', printBackground: true })

  // A report window that crashes gives an error and is not left behind to block quitting.
  await app.evaluate(({ app: electronApp }) => {
    electronApp.once('web-contents-created', (_e, contents) => contents.once('dom-ready', () => contents.forcefullyCrashRenderer()))
  })
  await page.getByRole('button', { name: 'Print' }).click()
  await expect(page.getByText(/The report page stopped working/)).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  await expect(page.getByRole('button', { name: 'Print' })).toBeEnabled()

  // Statistics agree with the match.
  await nav(page, 'Statistics')
  await expect(page.getByRole('heading', { name: 'Top scorers' })).toBeVisible()
  const players = page.getByRole('table', { name: 'Player statistics' })
  const scorer = players.getByRole('row').nth(1)
  await expect(scorer).toContainText('Sample')
  await expect(scorer.getByRole('cell').nth(2)).toHaveText('2')
  await page.screenshot({ path: 'test-results/phase6-statistics.png', fullPage: true })
  await page.getByRole('tab', { name: /Teams/ }).click()
  const teamTable = page.getByRole('table', { name: 'Team statistics' })
  await expect(teamTable.getByRole('row').nth(1)).toContainText('Sample Accra Lions HC')
  await page.getByRole('tab', { name: /Goalkeepers/ }).click()
  await expect(page.getByRole('table', { name: 'Goalkeeper statistics' }).getByRole('row')).toHaveCount(3)

  // Sorting and the Excel export.
  await page.getByRole('tab', { name: /Players/ }).click()
  await page.getByRole('button', { name: 'S%' }).click()
  await expect(page.getByRole('columnheader', { name: 'S%' })).toHaveAttribute('aria-sort', 'descending')
  const statsPath = join(dir, 'statistics.xlsx')
  await saveTo(app, statsPath)
  await page.getByRole('button', { name: 'Export to Excel' }).click()
  await expect(page.getByText(`Saved to ${statsPath}`)).toBeVisible()
  await new ExcelJS.Workbook().xlsx.readFile(statsPath)

  // History finds the match, and a correction marks it and its files.
  await nav(page, 'Match History')
  const row = page.getByRole('link', { name: /Sample Accra Lions HC/ }).first()
  await expect(row).toContainText('Final')
  await row.click()
  await page.getByRole('button', { name: 'Match record & timeline' }).click()
  const goal = timeline(page).getByRole('listitem').filter({ hasText: '2:1' })
  await goal.hover()
  await goal.getByRole('button', { name: 'Void event' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Reason/).fill('Goal did not count')
  await dialog.getByRole('button', { name: 'Void event' }).click()
  await expect(timeline(page)).toContainText('Voided: Goal did not count')

  await nav(page, 'Match History')
  await expect(page.getByRole('link', { name: /Sample Accra Lions HC/ }).first()).toContainText('Final (amended)')
  await nav(page, 'Match Reports')
  await page.getByRole('tab', { name: /Archive/ }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Outdated - match has changed' })).toHaveCount(2)
  await page.getByRole('row').filter({ hasText: 'PDF' }).getByRole('link').click()
  await expect(report(page)).toContainText('Amended after finalization')
  await expect(report(page).getByRole('region', { name: 'Result' })).toContainText('1:1')
  await expect(report(page).getByRole('region', { name: 'Corrections' })).toContainText('Goal did not count')
  await nav(page, 'Statistics')
  await expect(page.getByRole('table', { name: 'Player statistics' }).getByRole('row').nth(1).getByRole('cell').nth(2)).toHaveText('1')
  await app.close()
})
