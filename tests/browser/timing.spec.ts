import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import type { TimingStudy, Endpoint } from '../../src/lab/timingStudy'
const report: TimingStudy = JSON.parse(readFileSync('public/research/timing-null.json', 'utf8'))
const base = process.env.TRADEBO_TIMING_URL || '/'
test('timing distributions, ranks, constraints and execution delay match the released research', async ({
  page,
}, info) => {
  await page.goto(base + '#lab')
  await page.getByRole('link', { name: 'Timing vs chance', exact: true }).click()
  const result = page.getByRole('region', { name: 'Conditional timing result' })
  await expect(result).toContainText('0.76 pp')
  await expect(result).toContainText('10,000 / 10,000')
  await expect(result).toContainText('3.16 pp')
  if (process.env.TRADEBO_TIMING_IMAGE && info.project.name === 'chromium') {
    await page.setViewportSize({ width: 1200, height: 920 })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: process.env.TRADEBO_TIMING_IMAGE })
  }
  const hist = page.getByRole('region', { name: 'Random schedule distribution' })
  for (const id of Object.keys(report.results) as Endpoint[]) {
    await page.getByLabel('Measure', { exact: true }).selectOption(id)
    const s = report.results[id]
    await expect(hist).toContainText(s.p.toFixed(4))
    await expect(hist).toContainText(s.matched.toLocaleString('en-US') + ' / 10,000')
    await expect(hist.locator('.timing-bars span')).toHaveCount(24)
  }
  const ranks = page.getByRole('table', { name: 'Observed strategy ranks' })
  await expect(ranks.locator('tbody tr')).toHaveCount(4)
  await expect(ranks).toContainText('96.72')
  await page.getByText('Execution check · trade one month later', { exact: true }).click()
  await expect(page.getByRole('table', { name: 'Execution lag sensitivity' })).toContainText(
    '10.00%',
  )
  await expect(page.getByText(/Gross incremental timing return/)).toContainText('0.32 pp')
  await page.getByText('Check the constraints for a test period', { exact: true }).click()
  await page.getByLabel('Test period', { exact: true }).selectOption('89')
  await expect(
    page.locator('details').filter({ has: page.getByLabel('Test period', { exact: true }) }),
  ).toContainText('/ 2 months in stocks')
  await page.getByRole('button', { name: '中文' }).click()
  await expect(page.getByRole('heading', { name: '择时与随机对照' })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 820 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([])
  await page.getByRole('link', { name: '股票仓位与择时', exact: true }).click()
  await expect(page.getByRole('heading', { name: '股票仓位与择时', exact: true })).toBeVisible()
})
test('timing test retries unavailable results', async ({ page }) => {
  let unavailable = true
  await page.route('**/research/timing-null.json', (route) =>
    unavailable ? route.fulfill({ status: 503, body: '' }) : route.continue(),
  )
  await page.goto(base + '#lab-timing-test')
  await expect(page.getByRole('alert')).toBeVisible()
  unavailable = false
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('region', { name: 'Conditional timing result' })).toBeVisible()
})
