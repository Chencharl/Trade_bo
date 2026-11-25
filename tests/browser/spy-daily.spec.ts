import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import type { SpyReport } from '../../src/lab/SpyDailyPage'
const base = process.env.TRADEBO_SPY_URL || '/'
const r = JSON.parse(readFileSync('public/research/spy-daily.json', 'utf8')) as SpyReport
test('Strategy Lab opens on actual SPY outcomes, compares all baselines and explains next-open fills', async ({
  page,
}, info) => {
  await page.goto(base + '#lab')
  await expect(page.getByRole('heading', { name: 'SPY at the next open' })).toBeVisible()
  await expect(page.getByText('SYNTHETIC TEACHING DATA', { exact: true })).toHaveCount(0)
  const table = page.getByRole('table', { name: 'Final holdout results' })
  await expect(table.locator('tbody tr')).toHaveCount(4)
  await expect(table.locator('tbody tr').first()).toContainText('71.52%')
  await expect(table.locator('tbody tr').first()).toContainText('25.34%')
  if (process.env.TRADEBO_SPY_IMAGE && info.project.name === 'chromium') {
    await page.setViewportSize({ width: 1320, height: 1000 })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: process.env.TRADEBO_SPY_IMAGE })
  }
  const panel = page.getByRole('complementary', { name: 'Model comparison' })
  for (const id of ['market', 'original', 'trend'] as const) {
    await page.getByLabel('Comparison portfolio', { exact: true }).selectOption(id)
    const delta = r.metrics.model.total - r.metrics[id].total
    await expect(panel).toContainText((delta < 0 ? '−' : '+') + Math.abs(delta * 100).toFixed(2))
  }
  await page.getByRole('button', { name: 'Drawdown', exact: true }).click()
  const cursor = page.getByRole('slider', { name: 'Inspect week' })
  await cursor.focus()
  await cursor.press('Home')
  await expect(cursor).toHaveAttribute('aria-valuetext', r.start)
  await cursor.press('End')
  await expect(page.locator('.spy-readout')).toContainText(r.end)
  await page.getByLabel('Order date', { exact: true }).selectOption('1')
  await expect(page.locator('.spy-ticket')).toContainText(r.trades.model[1].signal)
  await expect(page.locator('.spy-ticket')).toContainText(r.trades.model[1].date)
  await expect(page.locator('.spy-ticket')).toContainText('$432.97')
  await page.getByLabel('Order portfolio', { exact: true }).selectOption('market')
  await expect(page.getByLabel('Order date', { exact: true })).toHaveValue('0')
  await page.getByText('Training, trading assumptions and yearly results', { exact: true }).click()
  await expect(
    page.getByRole('table', { name: 'Holdout calendar returns' }).locator('tbody tr'),
  ).toHaveCount(5)
  await page.getByRole('button', { name: '中文' }).click()
  await expect(page.getByRole('heading', { name: 'SPY 次日开盘回测' })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 820 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([])
  await page.getByRole('link', { name: /月度回测工作台/ }).click()
  await expect(page.getByText('SYNTHETIC TEACHING DATA', { exact: true })).toBeVisible()
})
test('a failed SPY download can be retried and the research library stays usable', async ({
  page,
}) => {
  let fail = true
  await page.route('**/research/spy-daily.json', (route) =>
    fail ? route.fulfill({ status: 503, body: '' }) : route.continue(),
  )
  await page.goto(base + '#lab-spy-daily')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Timing vs chance', exact: true })).toBeVisible()
  fail = false
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('table', { name: 'Final holdout results' })).toBeVisible()
})
