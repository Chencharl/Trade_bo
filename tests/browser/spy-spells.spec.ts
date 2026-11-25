import { test, expect } from '@playwright/test'
import type { CashStudy } from '../../src/lab/spyDaily'
import { readFileSync } from 'node:fs'

const base = process.env.TRADEBO_SPY_URL || '/'
const a: CashStudy = JSON.parse(readFileSync('public/research/spy-spells.json', 'utf8'))
const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

test('each exit leads from the equity chart to the same-window trend account', async ({ page }) => {
  await page.goto(base + '#lab')
  const chart = page.getByRole('region', { name: 'Portfolio chart' })
  const detail = page.getByRole('region', { name: 'Selected cash spell' })
  const picker = page.getByLabel('Choose an exit')
  await expect(picker.locator('option')).toHaveCount(a.spells.model.length + a.spells.trend.length)
  await expect(chart.getByRole('button', { name: /^(Neural model|Trend filter) 20/ })).toHaveCount(
    65,
  )
  for (const [key, list] of Object.entries(a.spells)) {
    for (const s of list) {
      await picker.selectOption(key + s.exit)
      await expect(detail).toContainText(s.reentry!)
      await expect(detail).toContainText(usd(Math.abs(s.endingEffect)))
      await expect(detail).toContainText((100 * s.avoided).toFixed(2) + '%')
      await expect(detail).toContainText((100 * s.missed).toFixed(2) + '%')
      const w = s[key as 'model' | 'trend']
      await expect(detail).toContainText(usd(w.commission + w.slippage))
    }
  }
  const period = page.getByLabel('Chart period')
  const april = chart.getByRole('button', { name: /^Neural model 2025-04-03/ })
  await april.click()
  await expect(picker).toHaveValue('model2025-04-03')
  await april.press('ArrowRight')
  await expect(picker).toHaveValue('model2025-04-08')
  await period.selectOption('2025')
  await april.click()
  await expect(picker).toHaveValue('model2025-04-03')
  await expect(page.getByLabel('Comparison portfolio')).toHaveValue('trend')
  await expect(detail).toContainText('−10.23%')
  await expect(detail).toContainText('−0.06%')
  await detail.getByText('How this exit adds up').click()
  await expect(detail).toContainText('$2.17')
  await expect(detail).toContainText('$4.34')
  await chart.getByRole('button', { name: /^Neural model 2025-04-08/ }).focus()
  await page.keyboard.press('Enter')
  await expect(detail).toContainText('+$969.77')
  await page.getByRole('button', { name: '2022-08-01 ↗', exact: true }).click()
  await expect(period).toHaveValue('2022')
  await expect(detail).toContainText('Trend filter in cash')
  await expect(detail).toContainText('23 sessions')
  await expect(detail).toContainText('−3.46%')
  await page.getByRole('button', { name: '中文' }).click()
  await page.setViewportSize({ width: 320, height: 800 })
  await page.getByLabel('图表年份').selectOption('2025')
  await page.getByLabel('选择空仓区间').selectOption('model2025-03-21')
  await expect(page.getByRole('region', { name: '所选空仓区间' })).toContainText('错过的 SPY 上涨')
  await expect(page.getByRole('region', { name: '所选空仓区间' })).toContainText('−$323.06')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('cash-spell download retries with both account reports', async ({ page }) => {
  let blocked = true
  await page.route('**/research/spy-spells.json', (route) =>
    blocked ? route.fulfill({ status: 503, body: '' }) : route.continue(),
  )
  await page.goto(base + '#lab')
  await expect(page.getByRole('alert')).toBeVisible()
  blocked = false
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByLabel('Choose an exit')).toBeVisible()
})
