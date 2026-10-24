// Vérifie la mise en page en 390×844 (et autres tailles) : aucun débordement,
// boutons visibles ≥ 44 px et espacés ≥ 8 px, textes ≥ 12 px, éléments dans
// l'écran, palette sans défilement horizontal caché, avec des safe areas simulées.
// États v3 : palette regroupée (12 lanternes), Gardien (déplacer le mur), fiche
// de niveau avec options, dernière chance, panneau de débogage.
// Coopération (relais local joignable) : accueil-salon à deux (hôte, invité) et
// partie à deux (rangée des coéquipiers) ; sinon, salon « hors ligne ».
// Usage : (serveur local sur :8080) node tools/layout-check.mjs
import { createRequire } from 'node:module';
import { brokerQuery } from './relay.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const Q = await brokerQuery();
const HOME = `http://localhost:8080/?${Q}`;
const online = Q !== 'broker=off';

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
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(HOME, { waitUntil: 'networkidle' });
  // Simule l'encoche et la barre d'accueil d'un iPhone en mode écran d'accueil.
  await page.addStyleTag({ content: `:root{--sat:${top}px !important;--sab:${bottom}px !important}` });
  const check = async (label, pg = page) => {
    const res = await pg.evaluate(() => {
      const issues = [];
      const W = innerWidth;
      const H = innerHeight;
      if (document.documentElement.scrollWidth > W + 1) issues.push(`débordement horizontal ${document.documentElement.scrollWidth}px`);
      const shown = (el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (!r.width || !r.height || st.visibility === 'hidden' || el.closest('.hidden')) return null;
        if (el.closest('.screen') && !el.closest('.screen.active')) return null;
        return r;
      };
      // bouton réellement touchable : son centre n'est pas couvert (feuille, fenêtre…)
      const reachable = (b, r) => {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && (b.contains(hit) || hit.contains(b));
      };
      const btns = [];
      for (const b of document.querySelectorAll('button')) {
        const r = shown(b);
        if (!r) continue;
        if (r.top >= 0 && r.bottom <= H && r.left >= 0 && r.right <= W && !reachable(b, r)) continue;
        // interface inactive (dernière chance) : pas une cible
        if (getComputedStyle(b).pointerEvents === 'none' && !b.closest('.wave-btn')) continue;
        btns.push({ r, b });
        if (r.width < 43.5 || r.height < 43.5) issues.push(`bouton trop petit ${Math.round(r.width)}×${Math.round(r.height)} « ${b.textContent.trim().slice(0, 20)} »`);
        if (r.left < -1 || r.right > W + 1 || r.top < -1 || r.bottom > H + 1) issues.push(`bouton hors écran « ${b.textContent.trim().slice(0, 20)} »`);
      }
      // cibles voisines d'une même rangée : au moins 8 px, jamais superposées
      for (const a of btns) {
        for (const c of btns) {
          if (a === c || a.b.contains(c.b) || c.b.contains(a.b)) continue;
          const sameRow = Math.min(a.r.bottom, c.r.bottom) - Math.max(a.r.top, c.r.top) > 10;
          if (!sameRow || c.r.left < a.r.left || (c.r.left === a.r.left && c.r.top < a.r.top)) continue;
          const gap = c.r.left - a.r.right;
          const name = (x) => x.b.textContent.trim().slice(0, 12);
          if (gap < 0) issues.push(`boutons superposés « ${name(a)} » / « ${name(c)} »`);
          else if (gap < 7.5) issues.push(`boutons à ${Math.round(gap)} px « ${name(a)} » / « ${name(c)} »`);
        }
      }
      // palette : jamais de défilement horizontal caché
      const pal = document.getElementById('palette');
      if (pal && shown(pal) && pal.scrollWidth > pal.clientWidth + 1) issues.push(`palette qui défile (${pal.scrollWidth} > ${pal.clientWidth})`);
      // textes ≥ 12 px
      for (const el of document.querySelectorAll('.screen.active *, #modal:not(.hidden) *')) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        if (!shown(el)) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        // 0 px : glyphe masqué à dessein (étoiles dessinées en CSS)
        if (fs > 0 && fs < 12) issues.push(`texte ${fs}px « ${el.textContent.trim().slice(0, 14)} »`);
      }
      return [...new Set(issues)];
    });
    if (res.length) problems += res.length;
    console.log(`${res.length ? '✗' : '✓'} ${w}×${h} ${label}${res.length ? '\n    ' + res.join('\n    ') : ''}`);
  };
  await page.waitForTimeout(500);
  await check(online ? 'titre (salon en ligne, seul)' : 'titre (salon hors ligne)');
  if (online) {
    // un second onglet rejoint le salon : salon à deux, puis partie à deux
    await page.waitForFunction(() => window.__session.online, null, { timeout: 8000 });
    const code = await page.evaluate(() => window.__session.code);
    const guest = await ctx.newPage();
    guest.on('pageerror', (e) => errors.push(`[invité] ${e.message}`));
    guest.on('console', (m) => m.type() === 'error' && errors.push(`[invité] ${m.text()}`));
    await guest.goto(`${HOME}&salon=${code}`, { waitUntil: 'networkidle' });
    await guest.addStyleTag({ content: `:root{--sat:${top}px !important;--sab:${bottom}px !important}` });
    await guest.waitForFunction(() => window.__session.role === 'guest' && window.__session.online, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    await check('salon à deux (hôte, choix d’élément déplié)');
    await check('salon à deux (invité)', guest);
    await page.evaluate(() => window.__startLevel('2-4'));
    await guest.waitForFunction(() => window.__state.screen === 'game' && window.__state.coopRole === 'guest', null, { timeout: 10000 });
    await guest.waitForTimeout(1500);
    await check('partie à deux 2-4 (invité, coéquipiers)', guest);
    await check('partie à deux 2-4 (hôte)');
    await guest.close();
    await page.goto(HOME, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: `:root{--sat:${top}px !important;--sab:${bottom}px !important}` });
    await page.waitForTimeout(500);
  }
  await page.click('#btn-play');
  await page.waitForTimeout(700);
  await check('carte (leçons)');
  await page.locator('.map-node').first().click();
  await page.waitForTimeout(300);
  await check('fiche de niveau');
  await page.locator('.modal .btn.primary').click();
  await page.waitForTimeout(1500);
  await check('partie');
  await page.evaluate(() => window.__startLevel('2-4'));
  await page.waitForTimeout(1500);
  await check('partie 2-4 (onglets + 4 outils + jauge)');
  // Gardien sélectionné, puis « Déplacer le mur »
  await page.evaluate(() => {
    const g = window.__state.game;
    g.gold = 999;
    const gr = g.grid;
    for (let i = 0; i < gr.size; i++) {
      if (gr.type(i) === 3 && gr.row(i) > 3 && g.canPlaceTower('earth_guard', gr.col(i), gr.row(i)).ok) {
        const t = g.placeTower('earth_guard', gr.col(i), gr.row(i));
        window.__input.ui.selectedTower = t.id;
        break;
      }
    }
  });
  await page.waitForTimeout(300);
  await check('barre d’actions du Gardien');
  await page.click('#btn-pause');
  await page.waitForTimeout(300);
  await check('pause');
  await page.locator('.modal .btn.primary').click();
  // dernière chance
  await page.evaluate(() => {
    const g = window.__state.game;
    g.startNextWave();
  });
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    const g = window.__state.game;
    g.rewindCharge = g.rules.rewindCost;
    g.lives = 1;
    const e = g.enemies.find((x) => x.alive && !x.flying && !x.timeless);
    if (e) g.leak(e);
  });
  await page.waitForTimeout(300);
  await check('dernière chance');
  await page.screenshot({ path: `qa-output/layout-lastchance-${w}x${h}.png` });
  await page.evaluate(() => window.__state.game.lose());
  await page.waitForTimeout(1800);
  await check('défaite');
  await page.evaluate(() => window.__startLevel('2-1'));
  await page.waitForTimeout(1500);
  if (await page.locator('#modal:not(.hidden) .btn.primary').count()) await page.locator('#modal:not(.hidden) .btn.primary').click();
  await page.evaluate(() => {
    const g = window.__state.game;
    g.waveIndex = g.waves.length - 1;
    g.state = 'wave';
    g.spawners = [];
  });
  await page.waitForTimeout(3200);
  await check('victoire');
  await page.screenshot({ path: `qa-output/layout-${w}x${h}.png` });
  // panneau de débogage (cinq touchers sur le titre)
  await page.evaluate(() => {
    document.getElementById('modal').classList.add('hidden');
  });
  await page.goto(HOME, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const t = await page.locator('#screen-title .title-wrap').boundingBox();
  for (let k = 0; k < 5; k++) await page.mouse.click(t.x + t.width / 2, t.y + t.height / 2);
  await page.waitForTimeout(300);
  await check('panneau de débogage');
  if (errors.length) {
    problems += errors.length;
    console.log(`✗ ${w}×${h} erreurs console :\n    ${errors.join('\n    ')}`);
  }
  await ctx.close();
}
await browser.close();
process.exit(problems ? 1 : 0);
