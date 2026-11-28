import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { ForwardReport } from '../../src/lab/SpyForward'
const initial: ForwardReport = JSON.parse(
  readFileSync('public/research/spy-forward-start.json', 'utf8'),
)
const base = process.env.TRADEBO_SPY_URL || '/'
const feed = '**/forward-data/ledger.json*'

test('the forward test opens from Strategy Lab, reports an unavailable ledger and retries', async ({
  page,
}) => {
  let fail = true
  await page.route(feed, (route) =>
    fail ? route.fulfill({ status: 503, body: '' }) : route.fulfill({ json: initial }),
  )
  await page.goto(base + '#lab')
  await page.getByRole('link', { name: 'Forward test', exact: true }).click()
  await expect(page).toHaveURL(/#lab-forward$/)
  await expect(page.getByRole('alert')).toBeVisible()
  fail = false
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('heading', { name: 'From signal to next open' })).toBeVisible()
  await expect(page.locator('.fw-accounts')).toContainText('$10,000.00')
  await expect(page.locator('.fw-gaps')).toContainText('—')
  await expect(page.getByText('No model exit has filled yet.', { exact: false })).toBeVisible()
  await page.getByRole('link', { name: 'Historical test', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'SPY at the next open' })).toBeVisible()
})

test('record times, missed signals, fills and each cash window remain legible on a phone', async ({
  page,
}) => {
  const r = structuredClone(initial)
  const header = {
    date: '2026-12-01',
    marketAt: '2026-12-01T21:00:00Z',
    recordedAt: '2026-12-01T21:30:04Z',
    run: '123',
  }
  r.events = [
    {
      ...header,
      phase: 'close',
      signal: { probability: 0.45, targets: { model: 0, trend: 1, market: 1 } },
      nextOpenAt: '2026-12-02T14:30:00Z',
    },
    {
      ...header,
      date: '2026-12-02',
      phase: 'open',
      marketAt: '2026-12-02T14:30:00Z',
      recordedAt: '2026-12-02T15:02:30Z',
    },
    {
      ...header,
      date: '2026-12-02',
      phase: 'close',
      marketAt: '2026-12-02T21:00:00Z',
      recordedAt: '2026-12-03T14:54:00Z',
      signal: null,
      nextOpenAt: '2026-12-03T14:30:00Z',
    },
  ]
  r.accounts.model = { ending: 10090, net: 0.009, fees: 7, target: 0 }
  r.accounts.trend.ending = 10100
  const windows = {
    model: { net: -0.0006, commission: 1, slippage: 2 },
    trend: { net: -0.02, commission: 0, slippage: 0 },
    market: { net: -0.02, commission: 0, slippage: 0 },
  }
  r.episodes = [
    {
      exit: '2026-12-02',
      reentry: '2026-12-04',
      through: '2026-12-04',
      days: 2,
      avoided: 0.05,
      missed: 0.03,
      windows,
    },
    {
      exit: '2026-12-08',
      reentry: null,
      through: '2026-12-08',
      days: 1,
      avoided: 0.01,
      missed: 0,
      windows,
    },
  ]
  r.fills = [
    {
      ...header,
      phase: 'open',
      rule: 'model',
      side: 'sell',
      date: '2026-12-02',
      marketAt: '2026-12-02T14:30:00Z',
      recordedAt: '2026-12-02T15:02:30Z',
      commission: 1,
      slippage: 2,
      notional: 9998,
      shares: 10,
      fillPrice: 999.8,
    } as ForwardReport['fills'][number],
  ]
  await page.route(feed, (route) => route.fulfill({ json: r }))
  await page.goto(base + '#lab-forward')
  const gap = page.locator('.fw-gaps')
  await expect(gap).toContainText('−$10.00')
  await expect(gap).toContainText('+$90.00')
  await expect(page.locator('.fw-period')).toContainText('Still in cash')
  await page.getByLabel('Exit open').selectOption('2026-12-02')
  await expect(page.locator('.fw-spell')).toContainText('5.00%')
  await expect(page.locator('.fw-spell')).toContainText('3.00%')
  await expect(page.locator('.fw-spell')).toContainText('$3.00')
  await expect(page.getByText('+$194.00', { exact: true })).toHaveCount(2)
  await expect(page.getByText('Missed · carry', { exact: true })).toBeVisible()
  await expect(page.locator('.fw-scroll').first()).toContainText('16:30:04 ET')
  await page.getByText('Simulated opening fills', { exact: false }).click()
  await expect(page.locator('.fw-details')).toContainText('10:02:30 ET')
  await expect(page.locator('.fw-details')).toContainText('$999.80')
  await page.getByRole('button', { name: '中文', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 820 })
  await expect(page.getByRole('heading', { name: '从收盘信号到次日开盘' })).toBeVisible()
  await expect(page.getByText('漏记 · 延续仓位', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
