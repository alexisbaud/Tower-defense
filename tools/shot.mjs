// Capture d'écran d'un niveau en 390×844 (serveur local requis sur :8080).
// Usage : node tools/shot.mjs <idNiveau> [fichier.png]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const id = process.argv[2] || '1-1';
const out = process.argv[3] || `qa-output/level-${id}.png`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://localhost:8080/?level=${id}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2600);
await import('node:fs').then((fs) => fs.mkdirSync(out.split('/').slice(0, -1).join('/') || '.', { recursive: true }));
await page.screenshot({ path: out });
console.log(out, errors.length ? `ERREURS: ${errors.join(' | ')}` : 'ok');
await browser.close();
