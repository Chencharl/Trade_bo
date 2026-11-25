import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('inspect the original false alarms, seven advances and matched OOS finance results', async ({
  page,
  browserName,
}) => {
  const base = process.env.TRADEBO_FILTER_URL || '/'
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(base + '#lab')
  await page.getByRole('link', { name: 'Reversal filter study', exact: true }).click()
  const warnings = page.getByRole('table', { name: 'Filter study Warnings' })
  await expect(warnings.locator('tbody tr')).toHaveCount(5)
  await expect(
    warnings.getByRole('row').filter({ hasText: 'Original reversal' }).locator('td').nth(0),
  ).toHaveText('107')
  const early = page.getByRole('table', { name: 'Original advance cuts' })
  await expect(early.locator('tbody tr')).toHaveCount(7)
  await expect(early.locator('tbody tr').first()).toContainText('Before testing')
  await expect(early.getByRole('row').filter({ hasText: 'May 1990' })).toContainText('Kept cut')
  await page.getByRole('button', { name: 'Net returns', exact: true }).click()
  const trend = page
    .getByRole('table', { name: 'Filter study Net returns' })
    .getByRole('row')
    .filter({ hasText: 'Trend filter' })
  await expect(trend.locator('td').nth(1)).toHaveText('+4.87 pp')
  await expect(trend.locator('td').nth(2)).toHaveText('-1.04 pp')
  if (browserName === 'chromium' && process.env.TRADEBO_FILTER_IMAGE) {
    await page.setViewportSize({ width: 1350, height: 1110 })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.screenshot({ path: process.env.TRADEBO_FILTER_IMAGE })
  }
  await page.getByRole('button', { name: 'Rebounds', exact: true }).click()
  await expect(page.getByRole('table', { name: 'Filter study Rebounds' })).toContainText('-0.41 pp')
  await page.getByText('Inspect an original false alarm', { exact: true }).click()
  const selector = page.getByRole('combobox', { name: 'Cut month' })
  await expect(selector.locator('option')).toHaveCount(118)
  await selector.selectOption({ index: 117 })
  await expect(page.getByText(/Trailing volatility.*Fold cutoff/)).toBeVisible()
  await page.getByText('Inspect a rolling fold', { exact: true }).click()
  const fold = page.getByRole('combobox', { name: 'Test period' })
  await expect(fold.locator('option')).toHaveCount(90)
  await fold.selectOption('89')
  await expect(
    page.getByRole('table', { name: 'Fold net returns' }).locator('tbody tr'),
  ).toHaveCount(5)
  await page.setViewportSize({ width: 320, height: 720 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  expect(
    (await new AxeBuilder({ page }).include('.history-study').analyze()).violations.map(
      (v) => v.id,
    ),
  ).toEqual([])
  expect(errors).toEqual([])
})
