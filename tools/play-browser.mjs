// Test de bout en bout : joue chaque niveau dans le vrai jeu (rendu, audio,
// tutoriel, modales, sauvegarde) en 390×844, piloté par le bot « smart »,
// en vitesse accélérée. Vérifie la victoire, l'écran de résultat, la
// sauvegarde et l'absence d'erreur console.
// Le bot passe par la file de commandes du moteur (game.issue) : chaque pose attend
// sa construction (2 s de jeu) avant de tirer, son or est réservé entre-temps ;
// le test vérifie que les constructions ont bien eu lieu (et se sont achevées).
// Usage : (serveur local sur :8080) node tools/play-browser.mjs [ids...]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const list = ids.length ? ids : ['1-1', '1-2', '1-3', '1-4', '2-1', '2-2', '2-3', '2-4'];
const out = (process.argv.find((a) => a.startsWith('--out=')) || '--out=qa-output/play').slice(6);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
let failed = 0;
for (const id of list) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(`http://localhost:8080/?level=${id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const t0 = Date.now();
  // Le bot joue via l'API publique ; la boucle du jeu tourne en ×8.
  await page.evaluate(async () => {
    const { bot } = await import('/tools/bot.mjs');
    const st = window.__state;
    st.speed = 8;
    let game = st.game;
    let b = bot('smart', game);
    window.__builds = { max: 0, seen: 0 };
    window.__botTimer = setInterval(() => {
      if (st.game !== game) {
        game = st.game;
        b = bot('smart', game);
      }
      // Le mini-tutoriel du Rembobinage met en pause : on le ferme comme un joueur.
      const modalBtn = document.querySelector('#modal:not(.hidden) .btn.primary');
      if (modalBtn && !st.resultShown) modalBtn.click();
      if (!st.paused) b.tick(game.time);
      // constructions en cours (poses qui attendent leurs 2 s)
      const n = game.pendingPlacements().length;
      window.__builds.max = Math.max(window.__builds.max, n);
      if (n) window.__builds.seen++;
    }, 50);
  });
  let result = null;
  for (let k = 0; k < 600; k++) {
    await page.waitForTimeout(1000);
    result = await page.evaluate(() => {
      const st = window.__state;
      if (!st.resultShown) return null;
      const g = st.game;
      return {
        state: g.state,
        lives: g.lives,
        stars: g.stars(),
        title: document.querySelector('#modal:not(.hidden) h2')?.textContent || '',
        saved: JSON.parse(localStorage.getItem('jardin-des-esprits:v1') || '{}').stars?.[g.level.id] ?? 0,
        builds: window.__builds,
        built: g.stats.towersBuilt,
      };
    });
    if (result) break;
  }
  await page.screenshot({ path: `${out}/${id}-result.png` });
  // des poses ont attendu leur construction, et des lanternes se sont allumées
  const builds = !!result && result.builds.seen > 0 && result.built > 0;
  const ok = result && result.state === 'won' && /Victoire/.test(result.title) && result.saved === result.stars && builds && errors.length === 0;
  if (!ok) failed++;
  console.log(
    `${ok ? '✓' : '✗'} ${id} ${result ? `${result.state} vies ${result.lives} ★${result.stars} sauvegarde ★${result.saved} « ${result.title} » · ${result.built} lanternes, constructions vues ${result.builds.seen}× (jusqu’à ${result.builds.max} à la fois)` : 'pas de fin de partie'}` +
      ` (${Math.round((Date.now() - t0) / 1000)} s)${errors.length ? '\n    ' + errors.slice(0, 5).join('\n    ') : ''}`,
  );
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
