import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { Dataset } from '../../src/lab/data'
import type { LabEvaluation } from '../../src/lab/engine'
import { evaluateRiskAudit } from '../../src/lab/risk'

type Report = { dataset: Dataset; evaluation: LabEvaluation }
const count = (numerator: number, denominator: number) =>
  denominator === 0 ? '—' : `${numerator} / ${denominator}`
const percent = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`)
const gap = (value: number | null) =>
  value === null ? '—' : `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)} pp`

async function ready(page: Page) {
  await expect(
    page.getByRole('region', { name: 'Strategy evaluation', exact: true }),
  ).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('button', { name: 'Export research run', exact: true })).toBeEnabled()
  await expect(
    page.getByRole('region', { name: 'Did lower exposure precede losses?', exact: true }),
  ).toBeVisible()
}

async function exportReport(page: Page): Promise<Report> {
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export research run', exact: true }).click()
  const stream = await (await downloaded).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString())
}

async function uploadReturns(page: Page, returns: number[]) {
  const details = page.locator('.lab-import-help')
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open)))
    await details.locator('summary').click()
  await page
    .getByRole('textbox', { name: 'Source for your own CSV' })
    .fill('Generated downside test fixture; no historical data')
  const csv = [
    'date,market_return,cash_return',
    ...returns.map(
      (value, i) =>
        `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')},${value},0`,
    ),
  ].join('\n')
  const name = `synthetic-risk-${returns.filter((value) => value < 0).length}-loss-months.csv`
  await page.locator('input[type="file"][aria-label="Monthly data file"]').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await ready(page)
}

test('retrospective downside counts match exported inputs and distinguish late warnings from advance prediction', async ({
  page,
}) => {
  const errors: string[] = []
  const apiRequests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('/api/')) apiRequests.push(request.url())
  })
  await page.goto('/#lab')
  await ready(page)
  await expect(
    page.getByText('SYNTHETIC DOWNSIDE CHECK · risk-audit-1', { exact: true }),
  ).toBeVisible()
  // One isolated synthetic loss is included in six overlapping forward windows.
  const returns = Array.from({ length: 180 }, (_, index) => (index === 150 ? -0.2 : 0.01))
  await uploadReturns(page, returns)
  const exported = await exportReport(page)
  const audit = evaluateRiskAudit(exported.dataset.rows, exported.evaluation)
  expect(audit.rules).toHaveLength(8)
  expect(
    audit.rules.every(
      (rule) => rule.eligibleMonths === 55 && rule.censoredMonths === 5 && rule.eventWindows === 6,
    ),
  ).toBe(true)
  const panel = page.getByRole('region', {
    name: 'Did lower exposure precede losses?',
    exact: true,
  })
  await expect(panel).toContainText('IMPORTED-DATA DOWNSIDE CHECK · risk-audit-1')
  await expect(panel).toContainText('55 COMPLETE WINDOWS · 5 CENSORED')
  await expect(panel).toContainText('market exposure ≤50% at month start')
  await expect(panel).toContainText('loss of ≥15% from that opening wealth within 6 months')
  await expect(panel).toContainText('Cash always warns; Market never warns.')
  await expect(panel).toContainText('Overlapping windows are not independent events.')
  const table = panel.getByRole('table', { name: 'Downside warning comparison', exact: true })
  await expect(table.locator('tbody tr')).toHaveCount(8)
  for (let index = 0; index < audit.rules.length; index++) {
    const rule = audit.rules[index]
    const cells = table.locator('tbody tr').nth(index).locator('td')
    const expected = [
      count(rule.warningMonths, rule.eligibleMonths),
      count(rule.truePositive, rule.eventWindows),
      count(rule.falsePositive, rule.warningMonths),
      count(rule.falseNegative, rule.eventWindows),
      gap(rule.meanUpMarketGap),
    ]
    for (let column = 0; column < expected.length; column++)
      await expect(cells.nth(column)).toHaveText(expected[column])
  }
  const trend = audit.rules.find((rule) => rule.id === 'trend')!
  expect(trend.truePositive).toBe(0)
  expect(trend.falseNegative).toBe(6)
  expect(trend.warningMonths).toBeGreaterThan(0)
  expect(trend.medianWarningDrawdown).toBeGreaterThan(0)
  await expect(panel.getByTestId('risk-covered')).toHaveText('0 / 6')
  await expect(panel.getByTestId('risk-missed')).toHaveText('6 / 6')
  await expect(panel.getByTestId('risk-prior-dd')).toHaveText(percent(trend.medianWarningDrawdown))
  await expect(panel.getByTestId('risk-lead')).toHaveText('—')
  await panel.getByText('Inspect monthly downside evidence', { exact: true }).click()
  const ledger = panel.getByRole('table', { name: 'Monthly downside evidence', exact: true })
  await expect(ledger.locator('tbody tr')).toHaveCount(55)
  await expect(
    ledger.getByRole('columnheader', { name: 'Signal month (modeled)', exact: true }),
  ).toBeVisible()
  await expect(panel).toContainText(
    'Monthly timing is modeled; imported data availability is unverified.',
  )
  await expect(panel).toContainText('not a peak-to-trough crash definition')
  for (const index of [0, 30, 54]) {
    const record = trend.ledger[index]
    const row = ledger.locator('tbody tr').nth(index)
    await expect(row.locator('th')).toHaveText(record.signalDate)
    const expected = [
      record.firstReturnMonth,
      record.endMonth,
      percent(record.targetWeight),
      percent(record.drawdownAtSignal),
      percent(record.forwardWorstReturn),
      String(record.monthsToLoss ?? '—'),
    ]
    for (let column = 0; column < expected.length; column++)
      await expect(row.locator('td').nth(column)).toHaveText(expected[column])
  }
  await page.getByRole('button', { name: 'Inspect Cash', exact: true }).click()
  await ready(page)
  await expect(panel.getByTestId('risk-covered')).toHaveText('6 / 6')
  await expect(panel.getByTestId('risk-false-alarms')).toHaveText('49 / 55')
  await expect(panel.getByTestId('risk-missed')).toHaveText('0 / 6')
  await expect(panel.getByTestId('risk-lead')).toHaveText('3.5 months')
  await expect(panel.getByTestId('risk-up-gap')).toHaveText(
    gap(audit.rules.find((rule) => rule.id === 'cash')!.meanUpMarketGap),
  )
  await page.getByRole('button', { name: 'Inspect Market', exact: true }).click()
  await ready(page)
  await expect(panel.getByTestId('risk-covered')).toHaveText('0 / 6')
  await expect(panel.getByTestId('risk-false-alarms')).toHaveText('—')
  await expect(panel.getByTestId('risk-missed')).toHaveText('6 / 6')
  await expect(panel.getByTestId('risk-up-gap')).toHaveText('0.00 pp')
  expect(errors).toEqual([])
  expect(apiRequests).toEqual([])
})

test('zero-event and zero-upside samples show missing denominators instead of invented scores', async ({
  page,
}) => {
  await page.goto('/#lab')
  await ready(page)
  await uploadReturns(page, Array(180).fill(0.01))
  await page.getByRole('button', { name: 'Inspect Cash', exact: true }).click()
  await ready(page)
  await expect(page.getByTestId('risk-covered')).toHaveText('—')
  await expect(page.getByTestId('risk-false-alarms')).toHaveText('55 / 55')
  await expect(page.getByTestId('risk-missed')).toHaveText('—')
  await expect(page.getByTestId('risk-lead')).toHaveText('—')
  await uploadReturns(page, Array(180).fill(-0.04))
  await expect(page.getByTestId('risk-covered')).toHaveText('55 / 55')
  await expect(page.getByTestId('risk-false-alarms')).toHaveText('0 / 55')
  await expect(page.getByTestId('risk-missed')).toHaveText('0 / 55')
  await expect(page.getByTestId('risk-lead')).toHaveText('4 months')
  await expect(page.getByTestId('risk-up-gap')).toHaveText('—')
})

test('downside evidence remains readable and keyboard accessible at 320 pixels', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/#lab')
  await ready(page)
  await page.evaluate(() => document.fonts.ready)
  const panel = page.getByRole('region', {
    name: 'Did lower exposure precede losses?',
    exact: true,
  })
  const toggle = panel.getByText('Inspect monthly downside evidence', { exact: true })
  await toggle.focus()
  await toggle.press('Enter')
  await expect(
    panel.getByRole('table', { name: 'Monthly downside evidence', exact: true }),
  ).toBeVisible()
  const scroll = panel.getByRole('region', {
    name: 'Scroll monthly downside evidence',
    exact: true,
  })
  await scroll.focus()
  await expect(scroll).toBeFocused()
  await scroll.press('ArrowRight')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([])
})
