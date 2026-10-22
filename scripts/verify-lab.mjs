import { chromium } from '@playwright/test'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
    deviceScaleFactor: 1,
  })
  await page.goto(process.env.LAB_URL || 'http://127.0.0.1:4173/#lab')
  await page.getByRole('button', { name: 'Export research run', exact: true }).waitFor()
  await page.waitForFunction(
    () => !document.querySelector('.lab-results')?.getAttribute('aria-busy')?.includes('true'),
  )
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: 'docs/strategy-lab-preview.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'docs/strategy-lab-mobile.png', fullPage: true })
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
      throw new Error(`Horizontal overflow at ${width}px`)
  }
  console.log('Strategy Lab screenshots captured; no page overflow at 320, 768, 1024, or 1440px.')
} finally {
  await browser.close()
}
