// Mesure du temps de simulation + rendu par frame avec une scène chargée.
// Usage : (serveur local sur :8080) node tools/perf.mjs [idNiveau] [--full]
//   --full : chaque socle reçoit une lanterne compatible (socles gravés compris) ;
//   sans l'option, la répartition historique (les socles gravés d'un autre élément
//   restent vides : ~13 lanternes sur 23 en 2-4), pour comparer aux mesures passées.
// Trois socles reçoivent une lanterne « en construction » (file de commandes, délai
// allongé pour durer toute la mesure) : leur dessin est compté.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const id = process.argv.slice(2).find((a) => !a.startsWith('--')) || '1-2';
const full = process.argv.includes('--full');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:8080/?level=${id}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const res = await page.evaluate(async (full) => {
  const st = window.__state;
  const g = st.game;
  const r = window.__renderer;
  g.gold = 99999;
  // remplir tous les socles (les trois premiers socles universels : constructions)
  const types = g.availableTowers;
  let k = 0;
  const later = [];
  for (let i = 0; i < g.grid.size; i++) {
    if (g.grid.types[i] !== 3) continue;
    const se = g.grid.slotElement?.[i];
    if (!se && later.length < 3) {
      later.push(i);
      continue;
    }
    const ok = full ? types.filter((t) => !se || g.defs.towers[t].element === se) : types;
    if (ok.length) g.placeTower(ok[k++ % ok.length], g.grid.col(i), g.grid.row(i));
  }
  g.rules.buildTime = 60; // les constructions durent toute la mesure
  for (const i of later) g.issue('placeTower', [types[k++ % types.length], g.grid.col(i), g.grid.row(i)]);
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
  return { enemies: g.enemies.length, towers: g.towers.length, building: r.builds.length, parts: r.fx.parts.length, sim: avg(sim).toFixed(2), simP95: p95(sim).toFixed(2), render: avg(ren).toFixed(2), renderP95: p95(ren).toFixed(2) };
}, full);
console.log(JSON.stringify({ ...res, errors }));
await browser.close();
