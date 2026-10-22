import { expect, test, type Download, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createHash } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { STRATEGIES, type LabEvaluation } from '../../src/lab/engine'
import type { Dataset } from '../../src/lab/data'
import { verifyLabReport } from '../../src/lab/report'

type Report = {
  engine: string
  dataset: Dataset
  evaluation: LabEvaluation
  rules: typeof STRATEGIES
}

async function ready(page: Page) {
  await expect(
    page.getByRole('region', { name: 'Strategy evaluation', exact: true }),
  ).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('button', { name: 'Export research run', exact: true })).toBeEnabled()
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function report(page: Page): Promise<Report> {
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export research run', exact: true }).click()
  const file = await downloaded
  expect(file.suggestedFilename()).toBe('tradebo-strategy-lab.json')
  return JSON.parse((await downloadBytes(file)).toString())
}

async function sourceDetails(page: Page, label = 'Synthetic browser test, decimal returns, v1') {
  const details = page.locator('.lab-import-help')
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open)))
    await details.locator('summary').click()
  await page.getByRole('textbox', { name: 'Source for your own CSV' }).fill(label)
}

async function upload(page: Page, name: string, buffer: Buffer) {
  await page.locator('input[type="file"][aria-label="Monthly data file"]').setInputFiles({
    name,
    mimeType: name.endsWith('.zip') ? 'application/zip' : 'text/csv',
    buffer,
  })
}

function dates(count: number) {
  return Array.from(
    { length: count },
    (_, index) => `${2000 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`,
  )
}

function canonicalCSV(count = 180, marketReturn = 0.01, cashReturn = 0.002) {
  return [
    'date,market_return,cash_return',
    ...dates(count).map((date) => `${date},${marketReturn},${cashReturn}`),
  ].join('\n')
}

function frenchCSV() {
  return [
    'Synthetic browser fixture; not historical financial data.',
    'Synthetic CRSP CIZ format fixture vintage 209912.',
    ',Mkt-RF,SMB,HML,RF',
    ...dates(180).map((date) => `${date.replace('-', '')},1.25,-0.50,0.75,0.25`),
    '',
    ' Annual Factors: January-December ',
    ',Mkt-RF,SMB,HML,RF',
    '2000,99,99,99,99',
  ].join('\n')
}

test('Strategy Lab is directly accessible, discoverable from Atlas, and exports displayed evidence', async ({
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
    page.getByRole('heading', { name: 'Test the rule. Show the evidence.' }),
  ).toBeVisible()
  await expect(page.getByText('SYNTHETIC TEACHING DATA', { exact: true })).toBeVisible()
  const comparison = page.getByRole('table', { name: 'Strategy comparison' })
  await expect(comparison.locator('tbody tr')).toHaveCount(8)
  const exported = await report(page)
  expect(exported.engine).toBe('lab-2')
  expect(exported.rules).toEqual(STRATEGIES)
  expect(exported.dataset.kind).toBe('synthetic')
  expect(exported.dataset.rows).toHaveLength(432)
  expect(exported.dataset.dataSha256).toBe(
    createHash('sha256').update(JSON.stringify(exported.dataset.rows)).digest('hex'),
  )
  expect(exported.evaluation.results.every((result) => result.ledger.length === 60)).toBe(true)
  const selected = exported.evaluation.results.find((result) => result.id === 'trend')!
  await expect(page.getByTestId('lab-cagr')).toHaveText(
    `${(selected.metrics.cagr * 100).toFixed(1)}%`,
  )
  for (const result of exported.evaluation.results) {
    const row = comparison.locator('tbody tr').filter({
      has: page.getByRole('rowheader', { name: result.name, exact: result.id !== 'trend' }),
    })
    await expect(row.locator('td').first()).toHaveText(`${(result.metrics.cagr * 100).toFixed(1)}%`)
  }

  await page
    .getByRole('navigation', { name: 'Strategy Lab navigation' })
    .getByRole('link', { name: 'Atlas', exact: true })
    .click()
  await expect(page.getByTestId('median-value')).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Atlas navigation' })
    .getByRole('link', { name: 'Strategy lab', exact: true })
    .click()
  await ready(page)
  expect(apiRequests).toEqual([])
  expect(errors).toEqual([])
})

test('cash keeps undefined excess Sharpe and cost-invariant returns; Market has zero paired difference', async ({
  page,
}) => {
  await page.goto('/#lab')
  await ready(page)
  await page.getByRole('button', { name: 'Inspect Cash', exact: true }).click()
  await ready(page)
  const cash = await report(page)
  const cashResult = cash.evaluation.results.find((result) => result.id === 'cash')!
  expect(cashResult.metrics.sharpe).toBeNull()
  const expectedCashWealth = cash.dataset.rows
    .slice(-60)
    .reduce((wealth, row) => wealth * (1 + row.cashReturn), 1)
  expect(cashResult.metrics.totalReturn).toBeCloseTo(expectedCashWealth - 1, 12)
  await expect(page.locator('.lab-metrics').getByText('—', { exact: true })).toBeVisible()
  expect(new Set(cash.evaluation.costSensitivity.map((point) => point.totalReturn)).size).toBe(1)
  await page.getByRole('slider', { name: /One-way trading cost/ }).press('End')
  await ready(page)
  const expensiveCash = await report(page)
  expect(expensiveCash.evaluation.config.costBps).toBe(100)
  expect(expensiveCash.evaluation.results.find((result) => result.id === 'cash')).toEqual(
    cashResult,
  )

  await page.getByRole('button', { name: 'Inspect Market', exact: true }).click()
  await ready(page)
  const market = await report(page)
  expect(market.evaluation.uncertainty.estimate).toBe(0)
  expect(market.evaluation.uncertainty.low).toBe(0)
  expect(market.evaluation.uncertainty.high).toBe(0)
  await expect(page.locator('.lab-interval')).toContainText('0.0 pp')
})

test('synthetic CSV round trip preserves its hash, header downloads work, and navigation retains the experiment', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/#lab')
  await ready(page)
  const original = await report(page)
  await sourceDetails(page, 'Synthetic round-trip fixture; illustrative units; version 1')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download synthetic example', exact: true }).click()
  const bytes = await downloadBytes(await downloaded)
  await upload(page, 'my-synthetic-example.csv', bytes)
  await expect(
    page.getByRole('heading', { name: 'my-synthetic-example.csv', exact: true }),
  ).toBeVisible()
  await ready(page)
  await expect(page.getByText('IMPORTED RETURN DATA', { exact: true })).toBeVisible()
  const roundTrip = await report(page)
  expect(roundTrip.dataset.kind).toBe('imported')
  expect(roundTrip.dataset.dataSha256).toBe(original.dataset.dataSha256)
  expect(roundTrip.dataset.rows).toEqual(original.dataset.rows)
  expect(roundTrip.dataset.rawSha256).toBe(createHash('sha256').update(bytes).digest('hex'))

  const headerDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download CSV header', exact: true }).click()
  expect((await downloadBytes(await headerDownload)).toString()).toBe(
    'date,market_return,cash_return\n',
  )
  await page.getByRole('button', { name: 'Inspect Volatility targeting', exact: true }).click()
  await page.getByRole('slider', { name: /One-way trading cost/ }).press('End')
  await ready(page)
  const beforeNavigation = await report(page)
  const skip = page.getByRole('link', { name: 'Skip to the strategy evaluation', exact: true })
  await skip.focus()
  await skip.press('Enter')
  await expect(page).toHaveURL(/#lab-main$/)
  await ready(page)
  await page
    .getByRole('navigation', { name: 'Strategy Lab navigation' })
    .getByRole('link', { name: 'Atlas', exact: true })
    .click()
  await expect(page.getByTestId('median-value')).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Atlas navigation' })
    .getByRole('link', { name: 'Strategy lab', exact: true })
    .click()
  await ready(page)
  const restored = await report(page)
  expect(restored.dataset).toEqual(beforeNavigation.dataset)
  expect(restored.evaluation).toEqual(beforeNavigation.evaluation)
  await page.reload()
  await ready(page)
  await expect(page.getByText('SYNTHETIC TEACHING DATA', { exact: true })).toBeVisible()
  expect((await report(page)).dataset.rawSha256).toBeNull()
  expect(errors).toEqual([])
})

test('local French-format CSV and ZIP fixtures convert percentages and exclude annual rows without network calls', async ({
  page,
}) => {
  await page.goto('/#lab')
  await ready(page)
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  const csv = frenchCSV()
  await upload(page, 'synthetic-factors.csv', Buffer.from(csv))
  await expect(
    page.getByRole('heading', { name: 'synthetic-factors.csv', exact: true }),
  ).toBeVisible()
  await ready(page)
  const plain = await report(page)
  expect(plain.dataset.rows).toHaveLength(180)
  expect(plain.dataset.rows[0]).toEqual({
    date: '2000-01',
    marketReturn: 0.015,
    cashReturn: 0.0025,
  })
  expect(plain.dataset.rows.at(-1)?.date).toBe('2014-12')
  const zip = Buffer.from(zipSync({ 'synthetic-factors.csv': strToU8(csv) }))
  await upload(page, 'synthetic-factors.zip', zip)
  await expect(
    page.getByRole('heading', { name: 'synthetic-factors.zip', exact: true }),
  ).toBeVisible()
  await ready(page)
  const zipped = await report(page)
  expect(zipped.dataset.dataSha256).toBe(plain.dataset.dataSha256)
  expect(zipped.dataset.rawSha256).not.toBe(plain.dataset.rawSha256)
  expect(zipped.evaluation).toEqual(plain.evaluation)
  expect(
    requests.filter(
      (url) => /^https?:/.test(url) && new URL(url).origin !== new URL(page.url()).origin,
    ),
  ).toEqual([])
  expect(requests.filter((url) => url.includes('/api/'))).toEqual([])
})

test('invalid monthly files explain the gap and preserve the previous dataset until a valid import', async ({
  page,
}) => {
  await page.goto('/#lab')
  await ready(page)
  const before = await report(page)
  await sourceDetails(page)
  const lines = canonicalCSV().split('\n')
  lines.splice(30, 1)
  await upload(page, 'gapped-test.csv', Buffer.from(lines.join('\n')))
  await expect(page.getByRole('alert')).toContainText(/consecutive|gaps/)
  await expect(page.getByRole('heading', { name: before.dataset.name, exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'gapped-test.csv', exact: true })).toBeHidden()
  await upload(page, 'valid-test.csv', Buffer.from(canonicalCSV()))
  await expect(page.getByRole('heading', { name: 'valid-test.csv', exact: true })).toBeVisible()
  await ready(page)
  await expect(page.getByRole('alert')).toBeHidden()
  const after = await report(page)
  expect(after.dataset.rows).toHaveLength(180)
  expect(after.dataset.dataSha256).not.toBe(before.dataset.dataSha256)
})

test('numeric-range failure cannot display or export an old dataset result under a new file', async ({
  page,
}) => {
  await page.goto('/#lab')
  await ready(page)
  await sourceDetails(page, 'Synthetic overflow stress fixture; not historical returns')
  await upload(page, 'overflow-test.csv', Buffer.from(canonicalCSV(1500, 10, 0)))
  await expect(page.getByRole('heading', { name: 'overflow-test.csv', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('numeric range')
  await expect(page.getByRole('table', { name: 'Strategy comparison' })).toBeHidden()
  await expect(page.getByTestId('lab-cagr')).toBeHidden()
  await expect(page.getByRole('img', { name: /Reserved-window equity and drawdown/ })).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Export research run', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Restore synthetic data', exact: true }).click()
  await ready(page)
  await expect(page.getByRole('alert')).toBeHidden()
  expect((await report(page)).dataset.kind).toBe('synthetic')
})

test('blocked Workers use an identical local fallback and remain interactive', async ({
  page,
  context,
}) => {
  await page.goto('/#lab')
  await ready(page)
  const baseline = await report(page)
  const fallbackPage = await context.newPage()
  const errors: string[] = []
  fallbackPage.on('pageerror', (error) => errors.push(error.message))
  await fallbackPage.addInitScript(() => {
    Object.defineProperty(window, 'Worker', {
      configurable: true,
      value: class {
        constructor() {
          throw new DOMException('Workers are blocked for this test.', 'SecurityError')
        }
      },
    })
  })
  await fallbackPage.goto('/#lab')
  await ready(fallbackPage)
  const fallback = await report(fallbackPage)
  expect(fallback.dataset).toEqual(baseline.dataset)
  expect(fallback.evaluation).toEqual(baseline.evaluation)
  await fallbackPage.getByRole('button', { name: 'Inspect 60 / 40', exact: true }).click()
  await fallbackPage.getByRole('slider', { name: /One-way trading cost/ }).press('End')
  await ready(fallbackPage)
  const changed = await report(fallbackPage)
  expect(changed.evaluation.config.selectedStrategy).toBe('balanced')
  expect(changed.evaluation.config.costBps).toBe(100)
  expect(changed.evaluation.results.find((run) => run.id === 'balanced')?.metrics.cagr).not.toBe(
    baseline.evaluation.results.find((run) => run.id === 'balanced')?.metrics.cagr,
  )
  expect(errors).toEqual([])
  await fallbackPage.close()
})

test('pending evaluations hide stale evidence and ignore delayed results from obsolete controls', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      holdLabResults: boolean
      pendingLabResults: Array<() => void>
    }
    state.holdLabResults = false
    state.pendingLabResults = []
    const NativeWorker = window.Worker
    Object.defineProperty(window, 'Worker', {
      configurable: true,
      value: class {
        worker: Worker
        onmessage: ((event: MessageEvent) => void) | null = null
        onerror: ((event: ErrorEvent) => void) | null = null
        constructor(url: string | URL, options?: WorkerOptions) {
          this.worker = new NativeWorker(url, options)
          this.worker.onmessage = (event) => {
            const deliver = () => this.onmessage?.(event)
            if (String(url).includes('lab.worker') && state.holdLabResults)
              state.pendingLabResults.push(deliver)
            else deliver()
          }
          this.worker.onerror = (event) => this.onerror?.(event)
        }
        postMessage(message: unknown) {
          this.worker.postMessage(message)
        }
        terminate() {
          // Deliberately retain callbacks already queued by this test. The app
          // must reject a late completion from a now-obsolete request itself.
          this.worker.terminate()
        }
      },
    })
  })
  await page.goto('/#lab')
  await ready(page)
  await page.evaluate(() => {
    ;(window as typeof window & { holdLabResults: boolean }).holdLabResults = true
  })
  await page.getByRole('button', { name: 'Inspect Market', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'Strategy evaluation', exact: true }),
  ).toHaveAttribute('aria-busy', 'true')
  await expect(page.getByRole('table', { name: 'Strategy comparison' })).toBeHidden()
  await expect(page.getByTestId('lab-cagr')).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Export research run', exact: true }),
  ).toBeDisabled()
  const pendingCount = () =>
    page.evaluate(
      () =>
        (window as typeof window & { pendingLabResults: Array<() => void> }).pendingLabResults
          .length,
    )
  await expect.poll(pendingCount).toBeGreaterThanOrEqual(1)
  await page.getByRole('button', { name: 'Inspect Cash', exact: true }).click()
  await page.getByRole('slider', { name: /One-way trading cost/ }).press('End')
  await expect.poll(pendingCount).toBeGreaterThanOrEqual(2)
  await page.evaluate(() => {
    const state = window as typeof window & {
      holdLabResults: boolean
      pendingLabResults: Array<() => void>
    }
    state.holdLabResults = false
    for (const deliver of state.pendingLabResults.splice(0)) deliver()
  })
  await ready(page)
  const current = await report(page)
  expect(current.evaluation.config.selectedStrategy).toBe('cash')
  expect(current.evaluation.config.costBps).toBe(100)
  await expect(page.getByRole('button', { name: 'Inspect Cash', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('320-pixel layout and expanded evidence tables support keyboard access and automated accessibility checks', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/')
  const entry = page.getByRole('link', { name: /Explore Strategy Lab/ })
  await expect(entry).toBeVisible()
  await entry.click()
  await ready(page)
  await page.evaluate(() => document.fonts.ready)
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  expect(await noOverflow()).toBe(true)
  const scan = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect((await scan()).violations).toEqual([])
  await sourceDetails(page)
  await page.getByText('Open the walk-forward selection ledger', { exact: true }).click()
  await page.getByText('Inspect the monthly position & cost ledger', { exact: true }).click()
  await page.getByText('Inspect data provenance & interpretation', { exact: true }).click()
  await expect(page.getByRole('table', { name: 'Monthly position and cost ledger' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Walk-forward selection' })).toBeVisible()
  const cost = page.getByRole('slider', { name: /One-way trading cost/ })
  await cost.focus()
  await cost.press('ArrowRight')
  await ready(page)
  await expect(cost).toHaveValue('11')
  expect(await noOverflow()).toBe(true)
  expect((await scan()).violations).toEqual([])
})

test('selector baselines display the exported dates and metrics and the downloaded report recomputes', async ({
  page,
}) => {
  await page.goto('/#lab')
  await ready(page)
  const exported = await report(page)
  expect((await verifyLabReport(exported)).calculationMatches).toBe(true)
  const table = page.getByRole('table', { name: 'Selector and baseline comparison', exact: true })
  await expect(table.locator('tbody')).toHaveCount(2)
  const windows = [
    [exported.evaluation.walkForward, ...exported.evaluation.walkForward.baselines],
    [
      exported.evaluation.frozenSelection,
      ...exported.evaluation.results.filter((row) =>
        ['market', 'cash', 'balanced'].includes(row.id),
      ),
    ],
  ]
  for (let window = 0; window < 2; window++) {
    const rows = table.locator('tbody').nth(window).locator('tr')
    await expect(rows).toHaveCount(4)
    for (let i = 0; i < 4; i++) {
      await expect(rows.nth(i).locator('td').nth(0)).toHaveText(
        `${(windows[window][i].metrics.cagr * 100).toFixed(1)}%`,
      )
      await expect(rows.nth(i).locator('td').nth(1)).toHaveText(
        `${(windows[window][i].metrics.maxDrawdown * 100).toFixed(1)}%`,
      )
    }
  }
  await expect(table.locator('tbody').first()).toContainText('Jan 1997 — Dec 2020')
  await expect(table.locator('tbody').nth(1)).toContainText('Jan 2021 — Dec 2025')
  await page.getByRole('button', { name: 'Inspect the frozen rule', exact: true }).click()
  await ready(page)
  expect((await report(page)).evaluation.config.selectedStrategy).toBe(
    exported.evaluation.frozenSelection.chosenId,
  )
})

test('declining input abstains in Cash and reports the actual partial-fold test coverage', async ({
  page,
}) => {
  await page.goto('/#lab')
  await ready(page)
  await sourceDetails(page, 'Generated declining market; no historical claims')
  await upload(page, 'declining-fixture.csv', Buffer.from(canonicalCSV(157, -0.01, 0)))
  await expect(
    page.getByRole('heading', { name: 'declining-fixture.csv', exact: true }),
  ).toBeVisible()
  await ready(page)
  const exported = await report(page)
  expect(exported.evaluation.frozenSelection.chosenId).toBe('cash')
  expect(exported.evaluation.frozenSelection.selectionReason).toBe('cash-abstention')
  expect(exported.evaluation.frozenSelection.trainingSharpe).toBeNull()
  expect(exported.evaluation.frozenSelection.metrics.totalReturn).toBe(0)
  await expect(page.locator('.lab-selection')).toContainText('13 TEST MONTHS · 2 FOLDS')
  await expect(
    page.getByText('No candidate had a positive, defined training score. The selector held cash.'),
  ).toBeVisible()
  await expect(
    page
      .getByRole('table', { name: 'Selector and baseline comparison' })
      .getByRole('rowheader', { name: 'Frozen: Cash', exact: true }),
  ).toBeVisible()
  expect((await verifyLabReport(exported)).calculationMatches).toBe(true)
})
