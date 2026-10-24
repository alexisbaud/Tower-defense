// Tests d'interface au doigt simulé (Playwright, 390×844) : pose, désélection,
// fusion par glisser, fiche tenue à jour, animations réduites.
// Usage : (serveur local sur :8080) node tools/ui-test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ' ' + extra}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:8080/?level=1-1', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

const box = await page.locator('#board').boundingBox();
// Centre écran d'une case (c, r) ; `dy` décale le point de contact.
const at = (c, r, dy = 0) =>
  page.evaluate(([c, r]) => window.__renderer.toScreen(c + 0.5, r + 0.5), [c, r]).then((p) => ({ x: box.x + p.x, y: box.y + p.y + dy }));
const slots = await page.evaluate(() => {
  const g = window.__state.game.grid;
  const out = [];
  for (let i = 0; i < g.size; i++) if (g.type(i) === 3) out.push([g.col(i), g.row(i)]);
  return out;
});
const game = () => page.evaluate(() => {
  const g = window.__state.game;
  return { gold: g.gold, towers: g.towers.map((t) => ({ id: t.id, c: t.c, r: t.r, level: t.level, type: t.type })), tool: window.__state && document.querySelector('.tool.selected')?.dataset.tool };
});

console.log('Pose et désélection (B1)');
await page.evaluate(() => (window.__state.game.gold = 500));
await page.locator('.tool[data-tool="fire"]').click();
const [c1, r1] = slots[0];
let p = await at(c1, r1);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(150);
let s = await game();
check('lanterne posée sur la case touchée', s.towers.length === 1 && s.towers[0].c === c1 && s.towers[0].r === r1, JSON.stringify(s.towers));
check('outil désélectionné après la pose', !s.tool);
const [c2, r2] = slots[1];
p = await at(c2, r2);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(150);
s = await game();
check('un toucher sur un socle vide n’achète rien', s.towers.length === 1);

console.log('Fusion par glisser (B3)');
await page.locator('.tool[data-tool="fire"]').click();
p = await at(c2, r2);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(150);
s = await game();
const src = s.towers.find((t) => t.c === c2 && t.r === r2);
const dst = s.towers.find((t) => t.c === c1 && t.r === r1);
// Le doigt glisse sous la cible : la lanterne portée flotte 60 px plus haut, sur la cible.
const from = await at(src.c, src.r);
const target = await at(dst.c, dst.r, 60 - 13);
await page.mouse.move(from.x, from.y);
await page.mouse.down();
for (let k = 1; k <= 12; k++) await page.mouse.move(from.x + ((target.x - from.x) * k) / 12, from.y + ((target.y - from.y) * k) / 12);
await page.mouse.up();
await page.waitForTimeout(200);
s = await game();
check('fusion réussie en visant avec la lanterne portée', s.towers.length === 1 && s.towers[0].level === 2, JSON.stringify(s.towers));

console.log('Fiche tenue à jour (B4)');
const t2 = s.towers[0];
p = await at(t2.c, t2.r);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
await page.waitForTimeout(600);
await page.mouse.up();
await page.waitForTimeout(200);
let sheet = await page.locator('#info').innerText();
check('fiche ouverte au niveau 2', /N2/.test(sheet), sheet.slice(0, 80));
// fusion d'une 3e lanterne N1+N1 ailleurs : ne doit pas fausser la fiche
const sellLabel = await page.locator('#info .btn.primary').innerText();
const value = await page.evaluate(() => window.__state.game.sellValue(window.__state.game.towers[0]));
check('prix de vente affiché = prix réel', sellLabel.includes(String(value)), `${sellLabel} vs ${value}`);

console.log('Animations réduites (B23)');
await page.evaluate(() => window.__hud.banner('Test', 'bannière'));
await page.waitForTimeout(400);
const op = await page.evaluate(() => getComputedStyle(document.getElementById('banner')).opacity);
check('bannière visible avec « réduire les animations »', Number(op) > 0.5, `opacity ${op}`);

check('aucune erreur console', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests d’interface passent');
process.exit(failures ? 1 : 0);
