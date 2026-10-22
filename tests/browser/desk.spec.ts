import { expect, test, type Page } from '@playwright/test'
import type { Board, Mode, Model } from '../../src/types'

// Entirely fictional API responses; no provider key, network feed, or market history.
const initialModel: Model = {
  cash: 10000,
  holdings: [{ symbol: 'ORBT', shares: 10, cost_basis: 80, role: 'Core' }],
  targets: { ORBT: 40, CASH: 60 },
  policy: {
    max_position_pct: 22,
    max_sector_pct: 32,
    min_cash_pct: 12,
    risk_per_trade_pct: 1,
    planning_stop_pct: 8,
    rebalance_band_pct: 4,
  },
  label: 'Synthetic browser-test portfolio',
}

function dashboard(mode: Mode, model: Model, symbols: string[], priceChange: number): Board {
  const prices = Object.fromEntries(
    symbols.map((symbol, index) => [symbol, 100 * (index + 1) + priceChange]),
  )
  const nav =
    model.cash +
    model.holdings.reduce((sum, holding) => sum + holding.shares * prices[holding.symbol], 0)
  const positions = model.holdings.map((holding) => {
    const value = holding.shares * prices[holding.symbol]
    return {
      ...holding,
      name: `${holding.symbol} Fictional Company`,
      sector: 'Technology',
      method: 'Synthetic test rule',
      price: prices[holding.symbol],
      value,
      weight_pct: (value / nav) * 100,
      target_pct: model.targets[holding.symbol],
      drift_pp: (value / nav) * 100 - model.targets[holding.symbol],
      unrealized_pl_pct: null,
    }
  })
  return {
    as_of: '2026-10-22',
    mode,
    symbols,
    portfolio: {
      label: model.label,
      nav,
      cash: model.cash,
      cash_weight_pct: (model.cash / nav) * 100,
      cash_target_pct: model.targets.CASH,
      positions,
      sectors: [],
      roles: [],
      targets: model.targets,
      policy: model.policy,
      alerts: [],
      model,
      sample: true,
    },
    analyses: positions.map((position) => ({
      symbol: position.symbol,
      name: position.name,
      sector: position.sector,
      mode,
      role: position.role,
      method: position.method,
      market: {
        price: position.price,
        as_of: '2026-10-22',
        change_pct: 0,
        return_20d_pct: 0,
        sma20: position.price,
        sma50: position.price,
        trend_up: false,
        trend_down: false,
        volatility_annualized_pct: 0,
        max_drawdown_observed_pct: 0,
        history: [
          { date: '2026-10-21', close: position.price },
          { date: '2026-10-22', close: position.price },
        ],
      },
      overview: {
        sector: position.sector,
        market_cap: null,
        pe_ratio: null,
        profit_margin: null,
        revenue_ttm: null,
        dividend_yield: null,
        source: 'Synthetic browser fixture',
      },
      news: [],
      action: 'HOLD',
      reason: 'Synthetic test case',
      buy_gates: [],
      sell_triggers: [],
      relevant_article_count: 0,
      screened_article_count: 0,
      excluded_article_count: 0,
      independent_source_count: 0,
      position_shares: position.shares,
      position_value: position.value,
      weight_pct: position.weight_pct,
      target_pct: position.target_pct,
      suggested_max_add_shares: 0,
      review_reduce_shares: 0,
      planning_stop: position.price * (1 - model.policy.planning_stop_pct / 100),
      retrieved_at: '2026-10-22T12:00:00Z',
      source_note: 'Fictional data only',
    })),
    paper_orders: [],
    method: 'Synthetic browser test',
  }
}

async function mockedDesk(page: Page) {
  const state = {
    priceChange: 0,
    failNext: false,
    gets: [] as string[],
    posts: [] as { mode: Mode; model: Model; symbols: string[] }[],
  }
  await page.route('**/api/health', (route) => route.fulfill({ json: { ok: true } }))
  await page.route('**/api/dashboard**', async (route) => {
    const request = route.request()
    const isPost = request.method() === 'POST'
    const body = isPost ? request.postDataJSON() : null
    if (isPost) state.posts.push(body)
    else state.gets.push(request.url())
    if (state.failNext) {
      state.failNext = false
      await route.fulfill({ status: 503, json: { error: 'Synthetic provider unavailable' } })
      return
    }
    const mode = body?.mode || new URL(request.url()).searchParams.get('mode') || 'demo'
    await route.fulfill({
      json: dashboard(
        mode,
        body?.model || structuredClone(initialModel),
        body?.symbols || ['ORBT'],
        state.priceChange,
      ),
    })
  })
  return state
}

test('desk refresh preserves the edited model and added tickers while updating market values', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const state = await mockedDesk(page)
  await page.goto('/#research')
  await expect(page.getByRole('heading', { name: 'Portfolio review', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Provider', exact: true }).click()
  await expect(page.getByText('PROVIDER DATA', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Security research', exact: true }).click()
  await page.getByRole('textbox', { name: 'US equity ticker' }).fill('NOVA')
  await page.getByRole('button', { name: 'Load ticker', exact: true }).click()
  await expect(
    page.locator('.research-universe').getByRole('button', { name: 'NOVA', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click()
  await page.getByRole('button', { name: 'Edit model', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Edit portfolio model' })
  await editor.getByLabel('Cash balance, USD', { exact: true }).fill('25000')
  await editor.getByLabel('Cash target, %', { exact: true }).fill('50')
  const orbt = editor.locator('.edit-position').filter({ hasText: 'ORBT' })
  await orbt.getByLabel('Shares', { exact: true }).fill('17')
  await orbt.getByLabel('Cost / share', { exact: true }).fill('95')
  await orbt.getByLabel('Target, %', { exact: true }).fill('35')
  await orbt.getByRole('combobox').selectOption('Defensive')
  const nova = editor.locator('.edit-position').filter({ hasText: 'NOVA' })
  await nova.getByLabel('Shares', { exact: true }).fill('3')
  await nova.getByLabel('Cost / share', { exact: true }).fill('150')
  await nova.getByLabel('Target, %', { exact: true }).fill('15')
  for (const [label, value] of [
    ['Single name max, %', '24'],
    ['Sector max, %', '45'],
    ['Min cash, %', '15'],
    ['Risk budget, %', '0.5'],
    ['Planning stop, %', '7'],
    ['Review band, pp', '3'],
  ])
    await editor.getByLabel(label, { exact: true }).fill(value)
  await editor.getByRole('button', { name: 'Apply model', exact: true }).click()
  await expect(editor).toBeHidden()
  await expect(page.locator('.metric').filter({ hasText: 'NET ASSET VALUE' })).toContainText(
    '$27,300',
  )

  const expectedModel: Model = {
    cash: 25000,
    holdings: [
      { symbol: 'ORBT', shares: 17, cost_basis: 95, role: 'Defensive' },
      { symbol: 'NOVA', shares: 3, cost_basis: 150, role: 'Tactical' },
    ],
    targets: { ORBT: 35, CASH: 50, NOVA: 15 },
    policy: {
      max_position_pct: 24,
      max_sector_pct: 45,
      min_cash_pct: 15,
      risk_per_trade_pct: 0.5,
      planning_stop_pct: 7,
      rebalance_band_pct: 3,
    },
    label: initialModel.label,
  }
  const expectedRequest = { mode: 'live', model: expectedModel, symbols: ['ORBT', 'NOVA'] }
  expect(state.posts.at(-1)).toEqual(expectedRequest)
  const getCount = state.gets.length
  const postCount = state.posts.length
  await page.getByRole('button', { name: 'Security research', exact: true }).click()
  await expect(page.locator('.security-price strong')).toHaveText('$200.00')
  state.priceChange = 20
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.locator('.security-price strong')).toHaveText('$220.00')
  expect(state.posts).toHaveLength(postCount + 1)
  expect(state.posts.at(-1)).toEqual(expectedRequest)
  expect(state.gets).toHaveLength(getCount)
  await expect(page.locator('.research-universe .ticker-chip.active')).toHaveText('NOVA')
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click()
  await expect(page.locator('.metric').filter({ hasText: 'NET ASSET VALUE' })).toContainText(
    '$27,700',
  )
  await expect(page.locator('.metric').filter({ hasText: 'CASH RESERVE' })).toContainText('$25,000')

  // A failed refresh must retain the edited inputs so the next attempt is identical.
  state.failNext = true
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Synthetic provider unavailable')
  await expect(page.locator('.metric').filter({ hasText: 'NET ASSET VALUE' })).toContainText(
    '$27,700',
  )
  state.priceChange = 30
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('alert')).toBeHidden()
  await expect(page.locator('.metric').filter({ hasText: 'NET ASSET VALUE' })).toContainText(
    '$27,900',
  )
  expect(state.posts.at(-1)).toEqual(expectedRequest)

  // Changing dataset remains an explicit reset to that dataset's default model.
  await page.getByRole('button', { name: 'Sample', exact: true }).click()
  await expect(page.getByText('SYNTHETIC SAMPLE', { exact: true })).toBeVisible()
  expect(state.gets).toHaveLength(getCount + 1)
  await page.getByRole('button', { name: 'Edit model', exact: true }).click()
  await expect(editor.getByLabel('Cash balance, USD', { exact: true })).toHaveValue('10000')
  await expect(editor.locator('.edit-position')).toHaveCount(1)
  expect(errors).toEqual([])
})
