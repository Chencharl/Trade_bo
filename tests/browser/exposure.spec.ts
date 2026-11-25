import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import type { ExposureStudy } from '../../src/lab/exposureStudy'
const base = process.env.TRADEBO_EXPOSURE_URL || '/'
const report = JSON.parse(
  readFileSync('public/research/exposure-controls.json', 'utf8'),
) as ExposureStudy
test('public landing explains the fixed mixes and the plotted points reconcile with the research report', async ({
  page,
}, info) => {
  await page.goto(base + '#lab')
  await expect(page.getByRole('heading', { name: 'Strategy Lab', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Stock exposure & timing', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Stock exposure & timing' })).toBeVisible()
  await expect(page.getByLabel('Return breakdown')).toContainText('+3.92')
  await expect(page.getByLabel('Return breakdown')).toContainText('+0.95')
  const outcomes = page.getByRole('table', { name: 'Portfolio outcomes' })
  await expect(outcomes.locator('tbody tr')).toHaveCount(5)
  await expect(outcomes.getByRole('row').filter({ hasText: 'Trend fixed mix' })).toContainText(
    '9.96%',
  )
  await expect(
    outcomes.getByRole('row').filter({ hasText: 'Trend-filtered reversal' }),
  ).toContainText('−46.85%')
  if (process.env.TRADEBO_EXPOSURE_IMAGE && info.project.name === 'chromium') {
    await page.setViewportSize({ width: 1240, height: 970 })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: process.env.TRADEBO_EXPOSURE_IMAGE })
  }
  await expect(page.locator('.xp-holdings')).toContainText('Trend-filtered reversal 0.00%')
  const path = page.locator('.xp-rule-line')
  await page.getByRole('button', { name: 'All years', exact: true }).click()
  const full = await path.getAttribute('d')
  await page.getByRole('button', { name: '2008', exact: true }).click()
  await expect(path).not.toHaveAttribute('d', full!)
  await page.getByRole('button', { name: 'Growth of $100' }).click()
  const slider = page.getByRole('slider', { name: 'Inspect a quarter' })
  await slider.focus()
  await slider.press('Home')
  await expect(page.locator('.xp-readout')).toContainText('2007-09')
  await expect(page.locator('.xp-readout')).toContainText('$100.00')
  await slider.press('ArrowRight')
  const val = (id: 'trend' | 'trendMix') =>
    (100 * report.chart.find((p) => p.date === '2007-12')!.values[id]) /
    report.chart.find((p) => p.date === '2007-09')!.values[id]
  for (const id of ['trend', 'trendMix'] as const)
    await expect(page.locator('.xp-readout')).toContainText('$' + val(id).toFixed(2))
  await page.getByLabel('Compare', { exact: true }).selectOption('original')
  await page.getByRole('button', { name: '2020', exact: true }).click()
  await page.getByRole('button', { name: 'Loss from peak', exact: true }).click()
  await slider.press('Home')
  await slider.press('ArrowRight')
  const p = report.chart.find((p) => p.date === '2020-03')!
  await expect(page.locator('.xp-readout')).toContainText(
    (-100 * p.drawdowns.originalMix).toFixed(2) + '%',
  )
  await page.getByText('How the comparison works', { exact: true }).click()
  await page.getByLabel('Test period').selectOption('89')
  await expect(page.locator('.xp-method')).toContainText(report.folds[89].trainEnd)
  await expect(page.locator('.xp-fold li')).toHaveCount(5)
  await page.getByRole('button', { name: '中文' }).click()
  await expect(page.getByRole('heading', { name: '股票仓位与择时' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'English' })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 820 })
  await expect(page.getByRole('table', { name: '组合表现' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([])
})
test('an unavailable overview can be retried without losing access to the workbench', async ({
  page,
}) => {
  let unavailable = true
  await page.route('**/research/exposure-controls.json', (route) =>
    unavailable ? route.fulfill({ status: 503, body: '' }) : route.continue(),
  )
  await page.goto(base + '#lab-exposure')
  await expect(page.getByRole('alert')).toContainText('Couldn’t load')
  await expect(page.getByRole('link', { name: '← Strategy Lab' })).toBeVisible()
  unavailable = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Stock exposure & timing' })).toBeVisible()
})
test('workbench distinguishes monthly returns, cash months and an overlapping market benchmark', async ({
  page,
}) => {
  await page.goto(base + '#lab-workbench')
  await expect(page.locator('.lab-plot-note')).toContainText('29 of 60 months')
  const line = page.locator('.lab-strategy-line'),
    initial = await line.getAttribute('d')
  await page.getByRole('button', { name: 'Monthly gain or loss' }).click()
  await expect(line).not.toHaveAttribute('d', initial!)
  expect(await line.evaluate((el) => (el as SVGPathElement).getBBox().height)).toBeGreaterThan(1)
  await page.getByRole('button', { name: 'Inspect Market', exact: true }).click()
  await expect(page.locator('.lab-plot-note')).toContainText('share the same path')
  await expect(page.locator('.lab-benchmark-line')).toHaveCount(0)
})
