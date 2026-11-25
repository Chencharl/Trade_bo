import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const base = process.env.TRADEBO_FULL_HISTORY_URL || '/'
test('all eight rules show the published warnings, return gaps and rebound evidence', async ({
  page,
  browserName,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(base + '#lab')
  await page.getByRole('link', { name: 'Full-history study', exact: true }).click()
  const counts = page.getByRole('table', { name: 'Full-history warning counts' })
  await expect(counts.locator('tbody tr')).toHaveCount(8)
  const reversal = counts
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'Short-term reversal' }) })
  await expect(reversal.locator('td')).toHaveText(['7', '1', '6', '118', '2 mo.', '-5.74 pp'])
  await reversal.getByRole('button').click()
  const evidence = page.getByRole('region', { name: 'Strategy evidence' })
  await expect(evidence).toContainText('8 / 126')
  await expect(evidence.getByRole('table').locator('tbody tr')).toHaveCount(14)
  await evidence.locator('summary').click()
  await expect(evidence).toContainText('Unscored')
  const volatility = counts
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'Volatility targeting' }) })
  await expect(volatility.locator('td').nth(3)).toHaveText('24')
  await page.getByRole('combobox', { name: 'Count cuts to' }).selectOption('partial')
  await expect(volatility.locator('td').nth(3)).toHaveText('28')
  if (process.env.TRADEBO_STUDY_IMAGE && browserName === 'chromium') {
    await page.setViewportSize({ width: 1350, height: 970 })
    await page.getByRole('combobox', { name: 'Count cuts to' }).selectOption('half')
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.screenshot({ path: process.env.TRADEBO_STUDY_IMAGE })
  }
  await page.getByRole('button', { name: 'Returns after fees' }).click()
  const performance = page.getByRole('table', { name: 'Full-history performance' })
  await expect(
    performance
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: 'Market', exact: true }) })
      .locator('td')
      .first(),
  ).toHaveText('10.19%')
  await expect(
    performance
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: 'Short-term reversal' }) }),
  ).toContainText('-0.92 pp')
  await page.setViewportSize({ width: 320, height: 720 })
  await page.getByRole('button', { name: 'Cash', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(evidence.getByRole('heading')).toHaveText('Cash')
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
