import { chromium } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  deviceScaleFactor: 1,
})
const page = await context.newPage()
await page.goto(process.env.ATLAS_URL || 'http://127.0.0.1:5173/')
await page.locator('.atlas-field[aria-busy="false"]').waitFor()
await page.evaluate(() => document.fonts.ready)
const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
console.log(
  JSON.stringify(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
    null,
    2,
  ),
)
await page.getByRole('button', { name: 'Pin this setup to compare' }).click()
await page.getByRole('button', { name: 'Risk-off A flight to safety' }).click()
await page.locator('.atlas-field[aria-busy="false"]').waitFor()
await page.getByRole('button', { name: 'Dismiss notification' }).click()
await page.screenshot({ path: 'docs/atlas-preview.png', fullPage: true })
await page.setViewportSize({ width: 390, height: 844 })
await page.screenshot({ path: 'docs/atlas-mobile.png', fullPage: true })
for (const width of [320, 768, 1024]) {
  await page.setViewportSize({ width, height: 900 })
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    throw new Error(`Horizontal overflow at ${width}px`)
}
await browser.close()
if (audit.violations.length) process.exitCode = 1
