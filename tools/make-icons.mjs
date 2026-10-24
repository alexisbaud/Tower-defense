// Génère les icônes PNG de la PWA à partir de src/render/icon.js.
// Usage : (serveur local sur :8080) node tools/make-icons.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8080/tools/icon.html');
await page.waitForFunction(() => window.ready);
await page.waitForTimeout(300);
fs.mkdirSync('icons', { recursive: true });
for (const [name, size, mask] of [
  ['icon-180.png', 180, false],
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  const url = await page.evaluate(([s, m]) => window.makeIcon(s, m), [size, mask]);
  fs.writeFileSync(`icons/${name}`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('icons/' + name);
}
await browser.close();
