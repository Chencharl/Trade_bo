import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { HISTORY_ARCHIVE } from '../../src/lab/crises'

test('historical entry carries rule and fee, offers local recovery, and preserves the Lab', async ({
  page,
}) => {
  let requests = 0
  await page.route(HISTORY_ARCHIVE, (route) => {
    requests++
    return route.fulfill({ status: 503, body: '' })
  })
  await page.goto('/#lab')
  await page.getByRole('button', { name: 'Inspect Cash', exact: true }).click()
  await page.getByRole('slider', { name: /One-way trading cost/ }).press('End')
  await page.getByRole('link', { name: /2008 financial crisis/i }).click()
  await expect(page.getByRole('alert')).toContainText('Archive unavailable')
  await expect(page.getByRole('combobox', { name: 'Strategy', exact: true })).toHaveValue('cash')
  await expect(page.getByLabel('One-way fee')).toHaveValue('100')
  const before = requests
  await page.getByRole('button', { name: 'Retry archive' }).click()
  await expect.poll(() => requests).toBeGreaterThan(before)
  await page
    .getByLabel('Open archived CSV or ZIP')
    .setInputFiles({ name: 'wrong.csv', mimeType: 'text/csv', buffer: Buffer.from('wrong') })
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Selected month evidence' })).toHaveCount(0)
  await page.getByRole('link', { name: '← Strategy Lab' }).click()
  await expect(page.getByRole('slider', { name: /One-way trading cost/ })).toHaveValue('100')
})

// An explicit real-snapshot run supplements offline CI without redistributing source data.
if (process.env.TRADEBO_HISTORY_FILE || process.env.TRADEBO_HISTORY_URL) {
  test('published-snapshot months reconcile through the crash and recovery', async ({
    page,
    browserName,
  }) => {
    const url = process.env.TRADEBO_HISTORY_URL || 'http://127.0.0.1:4173/'
    const file = process.env.TRADEBO_HISTORY_FILE
    if (file) await page.route(HISTORY_ARCHIVE, (route) => route.abort())
    const expected = (name: string) =>
      page
        .locator('.crisis-detail dl > div')
        .filter({ has: page.getByText(name, { exact: true }) })
        .locator('dd')
    await page.goto(url + '#lab-history-2008')
    if (file) await page.getByLabel('Open archived CSV or ZIP').setInputFiles(file)
    const ledger = page.getByRole('region', { name: 'Selected month evidence' })
    await expect(expected('Monthly difference')).toHaveText('+17.20 pp', { timeout: 25000 })
    await expect(expected('Strategy fee this month')).toHaveText('0.00 bp')
    await expect(ledger).toContainText('Latest target cut · Jan 2008')
    await page.getByRole('button', { name: /Jan 2008 market/ }).click()
    await expect(expected('Strategy fee this month')).toHaveText('10.00 bp')
    await page.getByRole('link', { name: /2020 · COVID/ }).click()
    await expect(expected('Monthly difference')).toHaveText('+13.27 pp')
    await expect(ledger).toContainText('after the decline began')
    await expect(expected('Strategy fee this month')).toHaveText('10.00 bp')
    if (browserName === 'chromium' && process.env.TRADEBO_HISTORY_SCREENSHOT) {
      await page.setViewportSize({ width: 1240, height: 900 })
      await page.screenshot({ path: process.env.TRADEBO_HISTORY_SCREENSHOT, fullPage: true })
    }
    await page.getByRole('button', { name: /Feb 2020 market/ }).focus()
    await page.keyboard.press('Enter')
    await expect(expected('Monthly difference')).toHaveText('0.00 pp')
    await expect(expected('Strategy net return')).toHaveText('-8.03%')
    await page.setViewportSize({ width: 320, height: 700 })
    await page.getByRole('button', { name: /Apr 2020 market/ }).click()
    await expect(expected('Monthly difference')).toHaveText('-13.60 pp')
    await page.getByLabel('Inspect month').selectOption('2020-08')
    await expect(ledger).toContainText('-4.84 USD')
    await page.getByRole('combobox', { name: 'Strategy', exact: true }).selectOption('market')
    await expect(expected('Monthly difference')).toHaveText('0.00 pp')
    await expect(page).toHaveURL(/rule=market.*month=2020-08/)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    const axe = await new AxeBuilder({ page }).include('.crisis-main').analyze()
    expect(axe.violations.map((v) => v.id)).toEqual([])
  })
}
