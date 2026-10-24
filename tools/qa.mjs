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

// Sans ?level=, on passe par le titre et la carte pour ouvrir le premier niveau.
if (!(await page.locator('#screen-game.active').count())) {
  await page.click('#btn-play');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/01b-map.png` });
  await page.locator('.map-node').first().click();
  await page.waitForTimeout(400);
  await page.locator('.modal .btn.primary').click();
  await page.waitForTimeout(1200);
}

// Sélectionner la première lanterne puis toucher le socle le plus proche du chemin.
const box = await page.locator('#board').boundingBox();
await page.locator('#palette .tool').first().click();
const pos = await page.evaluate(() => {
  const g = window.__state.game;
  const r = window.__renderer;
  const grid = g.grid;
  const route = new Set(grid.spawns.flatMap((s) => g.flow.route(s)));
  let best = null;
  let bestN = -1;
  for (let i = 0; i < grid.size; i++) {
    if (grid.type(i) !== 3 || g.towerAt(grid.col(i), grid.row(i))) continue;
    let n = 0;
    for (const p of route) if (Math.hypot(grid.cx(p) - grid.cx(i), grid.cy(p) - grid.cy(i)) <= 2.2) n++;
    if (n > bestN) {
      bestN = n;
      best = i;
    }
  }
  return best == null ? null : r.toScreen(grid.cx(best), grid.cy(best));
});
if (pos) await page.mouse.click(box.x + pos.x, box.y + pos.y);
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/02-placed.png` });
const placed = await page.evaluate(() => window.__state.game.towers.length);
if (!placed) errors.push('[qa] aucune lanterne posée par le tap');
await page.locator('#btn-wave').click();
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}/03-wave.png` });
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
