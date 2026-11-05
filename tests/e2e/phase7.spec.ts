import ExcelJS from 'exceljs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, newDataDir } from './app'
import { nav } from './helpers'

const report = (page: Page) => page.getByTestId('season-report')

async function competition(page: Page, name: string, format: string) {
  await nav(page, 'Competitions')
  await page.getByRole('button', { name: 'Create competition' }).first().click()
  const form = page.getByRole('dialog')
  await form.getByLabel('Competition name').fill(name)
  await form.getByLabel('Format').selectOption(format)
  await form.getByRole('button', { name: 'Create competition' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await page.getByRole('button', { name: 'New season' }).first().click()
  await page.getByRole('dialog').getByLabel('Season name').fill('2027')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Manage teams' }).click()
  const choose = page.getByRole('dialog')
  const unselected = choose.locator('button[aria-pressed="false"]')
  await expect(unselected.first()).toBeVisible()
  for (let left = await unselected.count(); left > 0; left--) await unselected.first().click()
  await choose.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText(/^Teams \(4\)$/)).toBeVisible()
}

const saveTo = (app: ElectronApplication, file: string) =>
  app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog
  }, file)

test('fixtures and a bracket are built from the competition page, with a competition report', async () => {
  const dir = newDataDir()
  const { app, page } = await launch(dir)
  await page.getByRole('button', { name: /Explore demonstration mode/ }).click()
  await expect(page.getByText(/Demonstration mode - sample data only/)).toBeVisible()

  // A knockout cup: seed the teams, build the bracket, schedule the first round, undo it.
  await competition(page, 'Sample Cup', 'knockout')
  await page.getByRole('button', { name: 'Create bracket' }).click()
  const create = page.getByRole('dialog')
  const seeds = create.getByRole('list', { name: 'Seeding' }).getByRole('listitem')
  await expect(seeds).toHaveCount(4)
  const secondName = /Move (.*) up/.exec((await seeds.nth(1).getByRole('button').first().getAttribute('aria-label'))!)![1]
  await seeds.nth(1).getByRole('button', { name: /up$/ }).click()
  await expect(seeds.nth(0)).toContainText(secondName)
  await create.getByRole('button', { name: 'Create bracket' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const semi = page.getByTestId('tie-semi_final-1')
  await expect(semi).toContainText(secondName)
  await expect(page.getByTestId('tie-final-1')).toContainText('Winner SF 1')
  await expect(page.getByTestId('tie-third_place-1')).toContainText('Loser SF 2')
  await page.screenshot({ path: 'test-results/phase7-bracket.png', fullPage: true })

  await semi.getByRole('button', { name: /^Schedule / }).click()
  const when = page.getByRole('dialog')
  await when.getByLabel('Date').fill('2027-03-06')
  await when.getByRole('button', { name: 'Create fixture' }).click()
  await expect(semi).toContainText(/M-2027-\d{4}/)
  await expect(semi.getByRole('button', { name: /^Schedule / })).toHaveCount(0)

  await page.getByRole('button', { name: 'Remove bracket' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText('No bracket yet')).toBeVisible()

  // A group stage cannot be scheduled until every team has a group.
  await competition(page, 'Sample Groups', 'groups_knockout')
  await page.getByRole('button', { name: 'Generate fixtures' }).click()
  await expect(page.getByRole('dialog')).toContainText('Give every team a group first')
  await expect(page.getByRole('dialog').getByRole('button', { name: /^Create \d+ fixtures/ })).toBeDisabled()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

  // A league: preview, create, delete, create again.
  await competition(page, 'Sample Second League', 'league')
  await page.getByRole('button', { name: 'Generate fixtures' }).click()
  const plan = page.getByRole('dialog')
  await plan.getByLabel('First match day').fill('2027-01-09')
  await expect(plan.getByRole('region', { name: 'Fixture preview' })).toContainText('6 matches in 3 rounds, from 09 Jan 2027 to 23 Jan 2027.')
  await plan.getByLabel('Format').selectOption('2')
  await expect(plan.getByRole('region', { name: 'Fixture preview' })).toContainText('12 matches in 6 rounds')
  await plan.getByLabel('Format').selectOption('1')
  await plan.getByRole('button', { name: 'Create 6 fixtures' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Scheduled/ })).toHaveCount(6)
  await page.getByRole('button', { name: 'Delete unplayed' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('link', { name: /Scheduled/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Generate fixtures' }).click()
  await page.getByRole('dialog').getByLabel('First match day').fill('2027-01-09')
  await page.getByRole('dialog').getByRole('button', { name: 'Create 6 fixtures' }).click()
  await expect(page.getByRole('link', { name: /Scheduled/ })).toHaveCount(6)

  // The competition report: preview, PDF, Excel and print.
  await page.getByRole('button', { name: 'Competition report' }).click()
  await expect(report(page)).toContainText('Demonstration data - not an official record')
  await expect(report(page)).toContainText('In progress - 0 of 6 matches finalized')
  await expect(report(page).getByRole('region', { name: 'Standings' })).toContainText('Points: win 2, draw 1, loss 0.')
  await expect(report(page).getByRole('region', { name: 'Fixtures and results' }).getByRole('row')).toHaveCount(7)
  await report(page).screenshot({ path: 'test-results/phase7-report.png' })

  const pdfPath = join(dir, 'competition.pdf')
  await saveTo(app, pdfPath)
  await page.getByRole('button', { name: 'Save PDF' }).click()
  await expect(page.getByText(`Saved to ${pdfPath}`)).toBeVisible({ timeout: 30_000 })
  const pdf = readFileSync(pdfPath)
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pdf.toString('latin1')).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+59\d(\.\d+)?\s+84\d(\.\d+)?\s*\]/)

  const xlsxPath = join(dir, 'competition.xlsx')
  await saveTo(app, xlsxPath)
  await page.getByRole('button', { name: 'Save Excel' }).click()
  await expect(page.getByText(`Saved to ${xlsxPath}`)).toBeVisible({ timeout: 15_000 })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(xlsxPath)
  expect(wb.getWorksheet('Standings')!.getCell('A1').value).toBe('DEMONSTRATION DATA - NOT AN OFFICIAL RECORD; IN PROGRESS - 0 of 6 matches finalized')
  expect(wb.getWorksheet('Fixtures')!.rowCount).toBe(8)

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
  await app.close()
})
