// QA navigateur : ouvre le jeu en 390×844 (iPhone), capture les erreurs console
// et prend des captures d'écran. Usage : node tools/qa.mjs [url] [outDir]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import fs from 'node:fs';

const url = process.argv[2] || 'http://localhost:8080/';
const out = process.argv[3] || 'qa-output';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/01-start.png` });

// Sélectionner la tour de feu puis poser sur un socle.
const box = await page.locator('#board').boundingBox();
await page.locator('.tool[data-tool="fire"]').click();
const tile = await page.evaluate(() => window.__game ? null : null);
// case (2,3) en coordonnées de grille
const pos = await page.evaluate(() => {
  const r = window.__renderer;
  return r ? r.toScreen(2.5, 3.5) : null;
});
if (pos) {
  await page.mouse.click(box.x + pos.x, box.y + pos.y);
}
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/02-placed.png` });
await page.locator('#btn-wave').click();
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}/03-wave.png` });
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
