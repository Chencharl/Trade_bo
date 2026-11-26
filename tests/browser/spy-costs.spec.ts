import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { CostReport } from '../../src/lab/SpyCostStudy'

const base = process.env.TRADEBO_SPY_URL || '/'
const data: CostReport = JSON.parse(readFileSync('public/research/spy-costs.json', 'utf8'))
const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
async function checkBalance(page: Page, values: (typeof data.mixed)[number]) {
  const readout = page.locator('.cost-result')
  await expect(readout).toContainText(usd(values.model))
  for (const k of ['trend', 'market'] as const) {
    const gap = values.model - values[k]
    await expect(readout).toContainText((gap < 0 ? '−' : '+') + usd(Math.abs(gap)))
  }
}

test('frozen SPY fee and slippage cutoffs agree with the selected cost slice', async ({ page }) => {
  await page.goto(base + '#lab-spy-costs')
  const s = page.getByRole('region', { name: 'Trading cost study' })
  await expect(
    s.getByRole('heading', { name: 'When do trading costs erase the model’s lead?' }),
  ).toBeInViewport()
  const chart = s.getByRole('img')
  await expect(chart).toContainText('Trend · 1.10 bp')
  await expect(chart).toContainText('SPY · 4.26 bp')
  await expect(chart).toContainText('Original · 3 bp')
  await checkBalance(page, data.mixed[12])
  const total = s.getByRole('slider', { name: 'Combined cost' })
  await s.locator('.cost-cross').first().locator('circle').last().click()
  await expect(s.locator('.cost-result')).toContainText('Tie · $0.00')
  const tie = data.cutoffs.mixed.trend
  if (tie.status !== 'crossing') throw Error('Expected a trend crossing')
  await expect(s.locator('.cost-result')).toContainText(usd(tie.balances.model))
  await expect(total).toHaveAttribute('aria-valuetext', '1.10 bp')
  await total.press('ArrowRight')
  await checkBalance(page, data.mixed[5])
  await total.press('Home')
  await checkBalance(page, data.mixed[0])
  await total.press('End')
  await checkBalance(page, data.mixed[24])
  await s.getByRole('button', { name: 'Restore original costs' }).click()
  await checkBalance(page, data.mixed[12])

  await s.getByRole('button', { name: 'Commission', exact: true }).click()
  await expect(s).toContainText('Trend filter already leads at 0 bp')
  await expect(chart).toContainText('SPY · 2.26 bp')
  const fixed = s.getByRole('slider', { name: 'Fixed slippage' })
  await fixed.press('Home')
  await expect(chart).toContainText('Trend · 1.10 bp')
  await expect(chart).not.toContainText('Original ·')
  await checkBalance(page, data.grid[4][0])
  await s.getByRole('button', { name: 'Restore original costs' }).click()
  await s.getByRole('button', { name: 'Slippage', exact: true }).click()
  await expect(chart).toContainText('Trend · 0.10 bp')
  await expect(chart).toContainText('SPY · 3.26 bp')
  const fee = s.getByRole('slider', { name: 'Fixed commission' })
  await fee.press('End')
  await expect(s.locator('.cost-outside')).toHaveCount(2)
  await checkBalance(page, data.grid[24][8])
  await chart.click({ position: { x: 1, y: 35 } })
  await checkBalance(page, data.grid[24][0])
  await s.getByText('Break-even values and calculation').click()
  await expect(s.getByRole('link', { name: /Download the 625/ })).toHaveAttribute(
    'href',
    './research/spy-costs.json',
  )
  await page.getByRole('button', { name: '中文', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 820 })
  await page.getByRole('link', { name: '交易成本', exact: true }).click()
  const cn = page.getByRole('region', { name: '交易成本研究' })
  await cn.getByRole('button', { name: '合计成本', exact: true }).click()
  await expect(cn.getByRole('img')).toContainText('趋势 · 1.10 bp')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('cost study can be opened from the lab and retried independently', async ({ page }) => {
  let fail = true
  await page.route('**/research/spy-costs.json', (route) =>
    fail ? route.fulfill({ status: 503, body: '' }) : route.continue(),
  )
  await page.goto(base + '#lab')
  await expect(page.getByRole('region', { name: 'Portfolio chart' })).toBeVisible()
  await page.getByRole('link', { name: 'Trading costs', exact: true }).click()
  await expect(page).toHaveURL(/#lab-spy-costs$/)
  const alert = page.getByRole('alert')
  await expect(alert).toBeInViewport()
  fail = false
  await alert.getByRole('button', { name: 'Retry cost study' }).click()
  await expect(
    page.getByRole('region', { name: 'Trading cost study' }).getByRole('img'),
  ).toBeVisible()
})
