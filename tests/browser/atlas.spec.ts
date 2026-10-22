import { expect, test, type Download, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function ready(page: Page) {
  await expect(page.getByRole('region', { name: 'Simulated portfolio paths' })).toHaveAttribute(
    'aria-busy',
    'false',
  )
}

async function denyClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException('Clipboard access denied for this test.', 'NotAllowedError')
        },
      },
    })
  })
}

async function downloadText(download: Download) {
  const stream = await download.createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(chunk)
  return Buffer.concat(chunks).toString()
}

async function exportReport(page: Page) {
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export experiment', exact: true }).click()
  return JSON.parse(await downloadText(await downloaded))
}

test('default and expanded comparison views pass automated accessibility checks', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  const scan = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect((await scan()).violations).toEqual([])
  await page.getByRole('button', { name: 'Pin this setup to compare' }).click()
  await page.getByRole('button', { name: 'Risk-off A flight to safety' }).click()
  await ready(page)
  await page.getByRole('button', { name: 'Under the hood' }).click()
  expect((await scan()).violations).toEqual([])
})

test('experiment changes, pins, shares and restores identical results without any API', async ({
  page,
  context,
  browserName,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const apiCalls: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/')) apiCalls.push(request.url())
  })
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  } else {
    await denyClipboard(page)
  }
  await page.goto('/')
  await ready(page)
  const baseline = await page.getByTestId('median-value').innerText()
  await page.getByRole('button', { name: 'Pin this setup to compare' }).click()
  await page.getByRole('button', { name: 'Risk-off A flight to safety' }).click()
  await ready(page)
  await expect(page.getByTestId('median-value')).not.toHaveText(baseline)
  await expect(page.getByText('median difference vs. pinned')).toBeVisible()
  await page.getByRole('button', { name: 'Growth', exact: true }).click()
  await ready(page)
  const expected = await page.getByTestId('median-value').innerText()
  await page.getByRole('button', { name: 'Share experiment' }).click()
  let sharedURL: string
  if (browserName === 'chromium') {
    await expect(
      page.getByRole('status').filter({ hasText: 'Experiment link copied' }),
    ).toBeVisible()
    sharedURL = await page.evaluate(() => navigator.clipboard.readText())
  } else {
    const fallback = page.getByRole('textbox', { name: 'Experiment link' })
    await expect(fallback).toBeVisible()
    sharedURL = await fallback.inputValue()
  }
  expect(sharedURL).toContain('#atlas?v=atlas-1')
  expect(sharedURL).toBe(page.url())
  await page.reload()
  await ready(page)
  await expect(page.getByTestId('median-value')).toHaveText(expected)
  await expect(page.getByRole('button', { name: 'Growth', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByText('median difference vs. pinned')).toBeVisible()
  expect(apiCalls).toEqual([])
  expect(errors).toEqual([])
})

test('exports contain the exact displayed inputs and results', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  const report = await exportReport(page)
  expect(report.model).toBe('atlas-1')
  expect(report.results.terminal).toHaveLength(1000)
  expect(report.inputs.weights).toEqual([45, 20, 20, 10, 5])
  await expect(page.getByTestId('median-value')).toHaveText(
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(report.results.median),
  )
  const cardDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save share card' }).click()
  expect((await cardDownload).suggestedFilename()).toBe('tradebo-atlas-card.svg')
})

test('severe short-horizon shocks keep share-card graphics inside the plot', async ({ page }) => {
  await page.goto('/#atlas?v=atlas-1&w=0,100,0,0,0&s=riskoff&i=150&c=100000&y=1&seed=20261001')
  await ready(page)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save share card' }).click()
  const svg = await downloadText(await downloaded)
  const graphics = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, 'image/svg+xml')
    return {
      parseErrors: document.querySelectorAll('parsererror').length,
      points: Array.from(document.querySelectorAll('polygon, polyline')).map((element) =>
        (element.getAttribute('points') || '')
          .trim()
          .split(/\s+/)
          .map((point) => point.split(',').map(Number)),
      ),
    }
  }, svg)
  expect(graphics.parseErrors).toBe(0)
  expect(graphics.points).toHaveLength(2)
  for (const points of graphics.points) {
    expect(points.length).toBeGreaterThan(1)
    for (const [x, y] of points) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
      expect(x).toBeGreaterThanOrEqual(80)
      expect(x).toBeLessThanOrEqual(960)
      expect(y).toBeGreaterThanOrEqual(235)
      expect(y).toBeLessThanOrEqual(470)
    }
  }
})

test('restoring a valid shared hash clears invalid capital and an obsolete fallback link', async ({
  page,
}) => {
  await denyClipboard(page)
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'Share experiment' }).click()
  const fallback = page.getByRole('textbox', { name: 'Experiment link' })
  await expect(fallback).toBeVisible()
  const capital = page.getByRole('spinbutton', { name: 'Starting value' })
  await capital.fill('0')
  await capital.blur()
  await expect(capital).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('button', { name: 'Export experiment', exact: true })).toBeDisabled()

  await page.evaluate(() => {
    window.location.hash = '#atlas?v=atlas-1&w=0,0,0,0,100&s=baseline&i=100&c=200000&y=5&seed=0'
  })
  await expect(capital).toHaveValue('200000')
  await ready(page)
  await expect(capital).toHaveAttribute('aria-invalid', 'false')
  await expect(page.getByText('Enter a starting value from')).toBeHidden()
  await expect(fallback).toBeHidden()
  await expect(page.getByTestId('median-value')).toHaveText('$226,630')
  await expect(page.getByRole('button', { name: 'Share experiment' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Save share card' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Export experiment', exact: true })).toBeEnabled()
  const report = await exportReport(page)
  expect(report.inputs.capital).toBe(200000)
  expect(report.inputs.weights).toEqual([0, 0, 0, 0, 100])
})

test('clipboard-denied links never retain an obsolete pinned comparison', async ({ page }) => {
  await denyClipboard(page)
  await page.goto('/')
  await ready(page)
  const share = page.getByRole('button', { name: 'Share experiment' })
  const fallback = page.getByRole('textbox', { name: 'Experiment link' })
  await share.click()
  await expect(fallback).toBeVisible()
  expect(new URLSearchParams(new URL(await fallback.inputValue()).hash.slice(7)).has('pw')).toBe(
    false,
  )

  for (const removeName of ['Remove pinned comparison', 'Remove comparison']) {
    await page.getByRole('button', { name: 'Pin this setup to compare' }).click()
    await ready(page)
    await expect(fallback).toBeHidden()
    await share.click()
    await expect(fallback).toBeVisible()
    const pinnedParams = new URLSearchParams(new URL(await fallback.inputValue()).hash.slice(7))
    expect(pinnedParams.get('pw')).toBe('45,20,20,10,5')
    expect(pinnedParams.get('ps')).toBe('baseline')

    await page.getByRole('button', { name: removeName, exact: true }).click()
    await ready(page)
    await expect(fallback).toBeHidden()
    await share.click()
    await expect(fallback).toBeVisible()
    const unpinnedParams = new URLSearchParams(new URL(await fallback.inputValue()).hash.slice(7))
    expect(unpinnedParams.has('pw')).toBe(false)
    expect(unpinnedParams.has('ps')).toBe(false)
    expect(unpinnedParams.has('pi')).toBe(false)
  }
})

test('visiting the research desk preserves the unsaved experiment and comparison', async ({
  page,
}) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ status: 404, body: 'No local research API' }),
  )
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'Growth', exact: true }).click()
  await page.getByRole('button', { name: '10Y', exact: true }).click()
  const capital = page.getByRole('spinbutton', { name: 'Starting value' })
  await capital.fill('125000')
  await capital.blur()
  await page.getByRole('button', { name: 'Pin this setup to compare' }).click()
  await page.getByRole('button', { name: 'Inflation wave Stocks & bonds fall' }).click()
  await page.getByRole('slider', { name: 'Shock intensity' }).press('End')
  await ready(page)
  const expected = await exportReport(page)

  await page.getByRole('link', { name: 'Research desk' }).click()
  await expect(
    page.getByRole('heading', { name: 'The research desk. On your own machine.' }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Back to Atlas' }).click()
  await ready(page)
  await expect(capital).toHaveValue('125000')
  await expect(page.getByRole('button', { name: 'Growth', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: '10Y', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('slider', { name: 'Shock intensity' })).toHaveValue('150')
  await expect(page.getByText('median difference vs. pinned')).toBeVisible()
  const restored = await exportReport(page)
  expect(restored.inputs).toEqual(expected.inputs)
  expect(restored.results).toEqual(expected.results)
  expect(restored.pinned).toEqual(expected.pinned)
})

test('a blocked Worker falls back to identical results and keeps comparison usable', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await ready(page)
  const baseline = await exportReport(page)
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
  await fallbackPage.goto('/')
  await ready(fallbackPage)
  const fallback = await exportReport(fallbackPage)
  expect(fallback.inputs).toEqual(baseline.inputs)
  expect(fallback.results).toEqual(baseline.results)
  await fallbackPage.getByRole('button', { name: 'Pin this setup to compare' }).click()
  await fallbackPage.getByRole('button', { name: 'Risk-off A flight to safety' }).click()
  await ready(fallbackPage)
  const changed = await exportReport(fallbackPage)
  expect(changed.inputs.scenario).toBe('riskoff')
  expect(changed.results.terminal).toHaveLength(1000)
  expect(changed.results.median).not.toBe(baseline.results.median)
  expect(changed.pinned.results).toEqual(baseline.results)
  expect(errors).toEqual([])
  await fallbackPage.close()
})

test('keyboard controls preserve allocation totals and reject invalid capital', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  const slider = page.getByRole('slider', { name: 'US equities' })
  await slider.focus()
  await slider.press('ArrowRight')
  await ready(page)
  expect(await slider.inputValue()).toBe('46')
  const total = await page
    .locator('.atlas-weights input')
    .evaluateAll((inputs) =>
      inputs.reduce((sum, input) => sum + Number((input as HTMLInputElement).value), 0),
    )
  expect(total).toBe(100)
  const capital = page.getByRole('spinbutton', { name: 'Starting value' })
  await capital.fill('0')
  await capital.blur()
  await expect(capital).toHaveAttribute('aria-invalid', 'true')
  await capital.fill('200000')
  await capital.blur()
  await ready(page)
  await expect(capital).toHaveAttribute('aria-invalid', 'false')
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await ready(page)
  await expect(capital).toHaveValue('100000')
})

test('all-cash edge case, transparent assumptions and chart table', async ({ page }) => {
  await page.goto('/#atlas?v=atlas-1&w=0,0,0,0,100&s=baseline&i=100&c=100000&y=5&seed=0')
  await ready(page)
  await expect(page.getByTestId('median-value')).toHaveText('$113,315')
  await expect(page.getByText('All percentiles', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Under the hood' }).click()
  await expect(page.getByRole('table', { name: 'Illustrative annual inputs' })).toBeVisible()
  await page.getByText('Read the chart as a table').click()
  await expect(page.getByRole('table', { name: 'Pointwise percentiles' })).toBeVisible()
})

test('bad links explain fallback and the research desk has a useful static entry', async ({
  page,
}) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ status: 404, body: 'No local research API' }),
  )
  await page.goto('/#atlas?v=unknown')
  await ready(page)
  await expect(page.getByRole('status')).toContainText('invalid')
  await page.getByRole('link', { name: 'Research desk' }).click()
  await expect(
    page.getByRole('heading', { name: 'The research desk. On your own machine.' }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Back to Atlas' }).click()
  await ready(page)
})

test('mobile controls remain usable with no horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await ready(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByRole('button', { name: 'Inflation wave Stocks & bonds fall' }).click()
  await ready(page)
  await page.getByRole('slider', { name: 'Shock intensity' }).press('End')
  await ready(page)
  await expect(page.getByText('150%', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Under the hood' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([])
})

test('large dollar amounts stay readable on the smallest supported layout', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/#atlas?v=atlas-1&w=100,0,0,0,0&s=baseline&i=150&c=10000000&y=10&seed=0')
  await ready(page)
  await page.evaluate(() => document.fonts.ready)
  await expect(page.getByRole('spinbutton', { name: 'Starting value' })).toHaveValue('10000000')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(
    await page
      .locator('.atlas-metric-money')
      .evaluateAll((values) => values.every((value) => value.scrollWidth <= value.clientWidth)),
  ).toBe(true)
  await page.getByRole('button', { name: 'Pin this setup to compare' }).click()
  await page.getByRole('button', { name: 'Risk-off A flight to safety' }).click()
  await ready(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
