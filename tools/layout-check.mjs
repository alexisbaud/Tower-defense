// Vérifie la mise en page en 390×844 (et autres tailles) : aucun débordement,
// boutons visibles ≥ 44 px, éléments dans l'écran, avec des safe areas simulées.
// Usage : (serveur local sur :8080) node tools/layout-check.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const sizes = [
  [390, 844, 47, 34],
  [375, 667, 20, 0],
  [430, 932, 59, 34],
];
const browser = await chromium.launch();
let problems = 0;
for (const [w, h, top, bottom] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
  // Simule l'encoche et la barre d'accueil d'un iPhone en mode écran d'accueil.
  await page.addStyleTag({ content: `:root{--sat:${top}px !important;--sab:${bottom}px !important}` });
  const check = async (label) => {
    const res = await page.evaluate(() => {
      const issues = [];
      const W = innerWidth;
      const H = innerHeight;
      if (document.documentElement.scrollWidth > W + 1) issues.push(`débordement horizontal ${document.documentElement.scrollWidth}px`);
      for (const b of document.querySelectorAll('button')) {
        const r = b.getBoundingClientRect();
        const st = getComputedStyle(b);
        if (!r.width || !r.height || st.visibility === 'hidden' || b.closest('.hidden')) continue;
        if (b.closest('.screen') && !b.closest('.screen.active')) continue;
        if (r.width < 43.5 || r.height < 43.5) issues.push(`bouton trop petit ${Math.round(r.width)}×${Math.round(r.height)} « ${b.textContent.trim().slice(0, 20)} »`);
        if (r.left < -1 || r.right > W + 1 || r.top < -1 || r.bottom > H + 1) issues.push(`bouton hors écran « ${b.textContent.trim().slice(0, 20)} »`);
      }
      return issues;
    });
    if (res.length) problems += res.length;
    console.log(`${res.length ? '✗' : '✓'} ${w}×${h} ${label}${res.length ? '\n    ' + res.join('\n    ') : ''}`);
  };
  await page.waitForTimeout(500);
  await check('titre');
  await page.click('#btn-play');
  await page.waitForTimeout(400);
  await check('carte');
  await page.locator('.map-node').first().click();
  await page.waitForTimeout(300);
  await check('fiche de niveau');
  await page.locator('.modal .btn.primary').click();
  await page.waitForTimeout(1500);
  await check('partie');
  await page.evaluate(() => window.__startLevel('2-4'));
  await page.waitForTimeout(1500);
  await check('partie 2-4 (5 outils + jauge)');
  await page.click('#btn-pause');
  await page.waitForTimeout(300);
  await check('pause');
  await page.locator('.modal .btn.primary').click();
  await page.evaluate(() => {
    const g = window.__state.game;
    g.waveIndex = g.waves.length - 1;
    g.state = 'wave';
    g.spawners = [];
  });
  await page.waitForTimeout(3200);
  await check('victoire');
  await page.screenshot({ path: `qa-output/layout-${w}x${h}.png` });
  await ctx.close();
}
await browser.close();
process.exit(problems ? 1 : 0);
