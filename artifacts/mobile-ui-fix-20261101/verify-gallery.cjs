const { chromium } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href);
    await page.locator('#role').selectOption('orgAdmin');
    await page.locator('#width').selectOption('360');
    const result = await page.evaluate(() => ({
      total: document.querySelectorAll('article').length,
      shown: [...document.querySelectorAll('article')].filter(e => !e.hidden).length,
      wrongRole: [...document.querySelectorAll('article')].filter(e => !e.hidden && e.dataset.role !== 'orgAdmin').length,
      wrongWidth: [...document.querySelectorAll('.view')].filter(e => !e.hidden && e.dataset.width !== '360').length,
    }));
    const images = page.locator('article:not([hidden]) .view:not([hidden]) img');
    for (const image of await images.all()) await image.evaluate(e => e.decode());
    if (result.total !== 66 || !result.shown || result.wrongRole || result.wrongWidth) throw Error(JSON.stringify(result));
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
