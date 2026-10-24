// Mesure du temps de simulation + rendu par frame avec une scène chargée.
// Usage : (serveur local sur :8080) node tools/perf.mjs [idNiveau]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const id = process.argv[2] || '1-2';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:8080/?level=${id}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const res = await page.evaluate(async () => {
  const st = window.__state;
  const g = st.game;
  const r = window.__renderer;
  g.gold = 99999;
  // remplir tous les socles
  const types = g.availableTowers;
  let k = 0;
  for (let i = 0; i < g.grid.size; i++) {
    if (g.grid.types[i] === 3) g.placeTower(types[k++ % types.length], g.grid.col(i), g.grid.row(i));
  }
  // vague dense
  g.waves[0] = { groups: [{ enemy: 'kodama', count: 60, interval: 0.15, hp: 20 }, { enemy: 'kamaitachi', count: 30, interval: 0.3, hp: 20 }] };
  g.startNextWave();
  for (let i = 0; i < 600; i++) g.update(1 / 60);
  // mesure
  const N = 240;
  const sim = [];
  const ren = [];
  for (let i = 0; i < N; i++) {
    const a = performance.now();
    g.update(1 / 60);
    const b = performance.now();
    r.onEvents(g.events);
    g.events.length = 0;
    r.render(1 / 60, 0.5, {});
    r.ctx.getImageData(0, 0, 1, 1); // force la rastérisation : coût réel de la frame
    const c = performance.now();
    sim.push(b - a);
    ren.push(c - b);
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const p95 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
  return { enemies: g.enemies.length, towers: g.towers.length, parts: r.fx.parts.length, sim: avg(sim).toFixed(2), simP95: p95(sim).toFixed(2), render: avg(ren).toFixed(2), renderP95: p95(ren).toFixed(2) };
});
console.log(JSON.stringify({ ...res, errors }));
await browser.close();
