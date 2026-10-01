import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function ready(page: import('@playwright/test').Page) {
  await expect(page.getByRole('region', { name: 'Simulated portfolio paths' })).toHaveAttribute(
    'aria-busy',
    'false',
  )
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
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const apiCalls: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/')) apiCalls.push(request.url())
  })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
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
  const sharedURL = await page.evaluate(() => navigator.clipboard.readText())
  expect(sharedURL).toContain('#atlas?v=atlas-1')
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
  const reportDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export experiment', exact: true }).click()
  const download = await reportDownload
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(chunk)
  const report = JSON.parse(Buffer.concat(chunks).toString())
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
  await page.getByRole('slider', { name: 'Shock intensity' }).fill('150')
  await ready(page)
  await expect(page.getByText('150%', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Under the hood' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
