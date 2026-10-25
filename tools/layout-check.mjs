// Vérifie la mise en page (docs/UI-UX.md §4.5, G0.2) : aucun débordement, cibles
// tactiles ≥ 44 px (zone réelle, pseudo-éléments compris) espacées ≥ 8 px, textes
// ≥ 12 px, libellés d'action ≥ 13 px, aucun texte coupé hors noms de joueurs, éléments
// dans l'écran, palette sans défilement caché, un seul message du couloir à la fois,
// taille des cases du plateau, bloc et bouton de vague immobiles.
// Mode « installation actuelle » (sans black-translucent) : fenêtre = hauteur − barre
// d'état, --sat = 0, --sab simulé. Mode « ancienne installation » : classe ios26-app,
// --sat = X + 40, aucun texte, bouton, sceau ni image dans la bande floue [0, X + 40).
// États v3 : palette regroupée (12 lanternes), Gardien (déplacer le mur), fiche
// de niveau avec options, dernière chance, panneau de débogage, construction en
// cours (« Annuler », barre « En construction », or réservé).
// Coopération (relais local joignable) : accueil-salon à deux (hôte, invité) et
// partie à deux (rangée des coéquipiers) ; sinon, salon « hors ligne ».
// Usage : (serveur local sur :8080) node tools/layout-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { brokerQuery } from './relay.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const Q = await brokerQuery();
const HOME = `http://localhost:8080/?${Q}`;
const online = Q !== 'broker=off';

// Installation actuelle : [largeur, hauteur − barre d'état, --sat, --sab]
const sizes = [
  [390, 797, 0, 34],
  [375, 647, 0, 0],
  [430, 873, 0, 34],
  [393, 793, 0, 34],
  [402, 812, 0, 34],
  [440, 894, 0, 34],
];
const COOP_SIZES = new Set([390, 375, 430]); // la partie à deux sur trois largeurs suffit
const browser = await chromium.launch();
let problems = 0;
// index.html : plus de barre d'état translucide, couleur de thème fixe
{
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const theme = html.match(/<meta name="theme-color" content="([^"]+)"/)?.[1];
  const bad = [];
  if (html.includes('black-translucent')) bad.push('« black-translucent » encore présent');
  if (theme?.toLowerCase() !== '#1f2f4f') bad.push(`theme-color ${theme}`);
  if (bad.length) problems += bad.length;
  console.log(`${bad.length ? '✗' : '✓'} index.html : barre d'état opaque #1f2f4f${bad.length ? '\n    ' + bad.join('\n    ') : ''}`);
}
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
      const inside = (b, x, y) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (b.contains(hit) || hit.contains(b));
      };
      // bouton réellement touchable : son centre n'est pas couvert (feuille, fenêtre…)
      const reachable = (b, r) => inside(b, r.left + r.width / 2, r.top + r.height / 2);
      // Zone tactile réelle (pseudo-éléments compris : onglets de 34 étendus à 44 par
      // `::before`) : on sonde au pixel depuis le centre dans chaque direction où la boîte
      // visible fait moins de 44.
      const hitBox = (b, r) => {
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const box = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        // (seulement le bouton, ses enfants et ses pseudo-éléments : pas le conteneur)
        const own = (x, y) => {
          const hit = document.elementFromPoint(x, y);
          return !!hit && b.contains(hit);
        };
        const probe = (x0, y0, dx, dy, max) => {
          let k = 0;
          while (k < max && own(x0 + dx * (k + 1), y0 + dy * (k + 1))) k++;
          return k;
        };
        if (r.height < 44) {
          box.top = Math.min(r.top, cy - probe(cx, cy, 0, -1, 40) - 0.5);
          box.bottom = Math.max(r.bottom, cy + probe(cx, cy, 0, 1, 40) + 0.5);
        }
        if (r.width < 44) {
          box.left = Math.min(r.left, cx - probe(cx, cy, -1, 0, 40) - 0.5);
          box.right = Math.max(r.right, cx + probe(cx, cy, 1, 0, 40) + 0.5);
        }
        box.width = box.right - box.left;
        box.height = box.bottom - box.top;
        return box;
      };
      const scrolls = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) return true;
        }
        return false;
      };
      const btns = [];
      for (const b of document.querySelectorAll('button')) {
        const r = shown(b);
        if (!r) continue;
        const onScreen = r.top >= 0 && r.bottom <= H && r.left >= 0 && r.right <= W;
        if (onScreen && !reachable(b, r)) continue;
        // hors écran mais dans une zone qui défile (carte, feuille) : atteignable en faisant défiler
        if (!onScreen && scrolls(b)) continue;
        // interface inactive (dernière chance) : pas une cible
        if (getComputedStyle(b).pointerEvents === 'none' && !b.closest('.wave-btn')) continue;
        const name = b.getAttribute('aria-label') || b.textContent.trim();
        const hb = onScreen ? hitBox(b, r) : r;
        btns.push({ r: hb, b });
        if (hb.width < 43.5 || hb.height < 43.5) issues.push(`cible trop petite ${Math.round(hb.width)}×${Math.round(hb.height)} « ${name.slice(0, 20)} »`);
        if (r.left < -1 || r.right > W + 1 || r.top < -1 || r.bottom > H + 1) issues.push(`bouton hors écran « ${name.slice(0, 20)} »`);
        // libellé d'action ≥ 13 px : le plus grand texte du bouton (les compteurs et
        // légendes de 12 px à côté d'un libellé plus grand restent permis) ; un bouton
        // image (puce de yokai : portrait + compteur 12) a son libellé dans aria-label
        let big = b.querySelector('img, canvas') && b.getAttribute('aria-label') ? 99 : 0;
        for (const el of [b, ...b.querySelectorAll('*')]) {
          if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          if (!shown(el)) continue;
          big = Math.max(big, parseFloat(getComputedStyle(el).fontSize) || 0);
        }
        if (big > 0 && big < 12.9) issues.push(`libellé d'action ${big}px « ${name.slice(0, 20)} »`);
      }
      // cibles voisines d'une même rangée : au moins 8 px, jamais superposées
      for (const a of btns) {
        for (const c of btns) {
          if (a === c || a.b.contains(c.b) || c.b.contains(a.b)) continue;
          const sameRow = Math.min(a.r.bottom, c.r.bottom) - Math.max(a.r.top, c.r.top) > 10;
          if (!sameRow || c.r.left < a.r.left || (c.r.left === a.r.left && c.r.top < a.r.top)) continue;
          const gap = c.r.left - a.r.right;
          const name = (x) => x.b.textContent.trim().slice(0, 12);
          if (gap < -0.5) issues.push(`boutons superposés « ${name(a)} » / « ${name(c)} »`);
          else if (gap < 7.5) issues.push(`boutons à ${Math.round(gap)} px « ${name(a)} » / « ${name(c)} »`);
        }
      }
      // palette : jamais de défilement horizontal caché
      const pal = document.getElementById('palette');
      if (pal && shown(pal) && pal.scrollWidth > pal.clientWidth + 1) issues.push(`palette qui défile (${pal.scrollWidth} > ${pal.clientWidth})`);
      // textes ≥ 12 px ; aucun texte coupé (points de suspension ou rognage) hors noms de joueurs
      const NAMES = '.mate-name, .tt-mate, .lobby-pname, .coop-mate, .tb-owner';
      for (const el of document.querySelectorAll('.screen.active *, #modal:not(.hidden) *, body > .sheet *')) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        if (!shown(el)) continue;
        const cs = getComputedStyle(el);
        const fs = parseFloat(cs.fontSize);
        // 0 px : glyphe masqué à dessein (étoiles dessinées en CSS)
        if (fs > 0 && fs < 12) issues.push(`texte ${fs}px « ${el.textContent.trim().slice(0, 14)} »`);
        const clips = cs.textOverflow === 'ellipsis' || cs.overflowX === 'hidden' || cs.overflowX === 'clip';
        if (clips && cs.whiteSpace.startsWith('nowrap') && el.scrollWidth > el.clientWidth + 1 && !el.closest(NAMES)) issues.push(`texte coupé « ${el.textContent.trim().slice(0, 18)} » (${el.scrollWidth} > ${el.clientWidth})`);
      }
      // couloir de messages : un seul message à la fois, plus de toast en partie
      const game = document.querySelector('#screen-game.active');
      if (game) {
        const msgs = [...document.querySelectorAll('#lane, #toast, .toast, #app-toast')].filter((el) => shown(el) && getComputedStyle(el).opacity !== '0');
        if (msgs.length > 1) issues.push(`${msgs.length} messages visibles à la fois`);
      }
      return [...new Set(issues)];
    });
    if (res.length) problems += res.length;
    console.log(`${res.length ? '✗' : '✓'} ${w}×${h} ${label}${res.length ? '\n    ' + res.join('\n    ') : ''}`);
  };
  await page.waitForTimeout(500);
  await check(online ? 'titre (salon en ligne, seul)' : 'titre (salon hors ligne)');
  if (online && COOP_SIZES.has(w)) {
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
    await check('accueil à deux (hôte : « Jouer à 2 », équipe)');
    await page.click('#btn-multi'); // « À plusieurs » : feuille du salon
    await page.waitForTimeout(400);
    await check('salon à deux (hôte, feuille du salon)');
    await check('salon à deux (invité, feuille ouverte par le lien)', guest);
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
  await page.click('#btn-levels');
  await page.waitForTimeout(700);
  await check('carte (leçons)');
  await page.locator('.map-node').first().click();
  await page.waitForTimeout(300);
  await check('fiche de niveau');
  await page.locator('.modal .btn.primary').click();
  await page.waitForTimeout(1500);
  await check('partie');
  // construction en cours : « Annuler », barre « En construction · Annuler », « −X » d'or réservé
  const built = await page.evaluate(() => {
    const st = window.__state;
    const g = st.game;
    st.speed = 0.05; // la construction dure le temps de la vérification
    const gr = g.grid;
    for (let i = 0; i < gr.size; i++) {
      if (gr.type(i) !== 3 || gr.row(i) < 3) continue;
      const type = g.availableTowers.find((t) => window.__commands.check('placeTower', t, gr.col(i), gr.row(i)).ok);
      if (!type) continue;
      const ticket = window.__commands.issue('placeTower', type, gr.col(i), gr.row(i));
      window.__hud.showUndo(ticket, 'tower');
      window.__input.ui.selectedBuild = { c: gr.col(i), r: gr.row(i) };
      return true;
    }
    return false;
  });
  await page.waitForTimeout(300);
  await check(built ? 'construction en cours (Annuler, barre, or réservé)' : 'construction en cours : aucun socle libre !');
  await page.screenshot({ path: `qa-output/layout-construction-${w}x${h}.png` });
  await page.evaluate(() => {
    window.__state.speed = 1;
    window.__input.ui.selectedBuild = null;
  });
  await page.evaluate(() => window.__startLevel('2-4'));
  await page.waitForTimeout(1500);
  await check('partie 2-4 (onglets + 4 outils + jauge)');
  // taille des cases (§4.5) : ≥ 43 en 390×797 et 393×793, ≥ 35 en 375×647
  {
    const ts = await page.evaluate(() => window.__renderer.ts);
    const need = { '390x797': 43, '393x793': 43, '375x647': 35 }[`${w}x${h}`] ?? 0;
    const bad = ts < need - 0.01;
    if (bad) problems++;
    console.log(`${bad ? '✗' : '✓'} ${w}×${h} case du plateau ${Math.round(ts * 10) / 10} px${need ? ` (≥ ${need})` : ''}`);
  }
  // bloc de vague (HUD) et bouton de vague immobiles quand l'or, l'or réservé ou la jauge changent
  {
    const rects = () =>
      page.evaluate(() =>
        ['hud-wave', 'btn-wave'].map((id) => {
          const r = document.getElementById(id).getBoundingClientRect();
          return { id, x: r.left, y: r.top, w: r.width, h: r.height };
        }),
      );
    const base = await rects();
    const moved = [];
    const cmp = async (why) => {
      for (const [k, r] of (await rects()).entries()) {
        const b = base[k];
        const d = Math.max(Math.abs(r.x - b.x), Math.abs(r.y - b.y), Math.abs(r.w - b.w), Math.abs(r.h - b.h));
        if (d > 1) moved.push(`#${r.id} décalé de ${Math.round(d * 10) / 10} px (${why})`);
      }
    };
    await page.evaluate(() => {
      const g = window.__state.game;
      g.gold = 98765;
    });
    await page.waitForTimeout(700);
    await cmp('or 98765');
    await page.evaluate(() => {
      const g = window.__state.game;
      g.rewindCharge = Math.max(0, Math.min(g.rules.rewindCost - 1, 77));
    });
    await page.waitForTimeout(500);
    await cmp('jauge');
    await page.evaluate(() => {
      const g = window.__state.game;
      const gr = g.grid;
      for (let i = 0; i < gr.size; i++) {
        if (gr.type(i) !== 3 || gr.row(i) < 3) continue;
        const type = g.availableTowers.find((t) => window.__commands.check('placeTower', t, gr.col(i), gr.row(i)).ok);
        if (!type) continue;
        window.__hud.showUndo(window.__commands.issue('placeTower', type, gr.col(i), gr.row(i)), 'tower');
        return;
      }
    });
    await page.waitForTimeout(400);
    await cmp('or réservé');
    // Difficile : « VAGUE 難 » tient dans le bloc de vague (or à 5 chiffres, or réservé affiché)
    const fit = await page.evaluate(() => {
      const sg = document.getElementById('screen-game');
      const had = sg.classList.contains('mode-hard');
      sg.classList.add('mode-hard');
      const w = document.getElementById('hud-wave');
      const r = { need: w.scrollWidth, room: w.clientWidth };
      if (!had) sg.classList.remove('mode-hard');
      return r;
    });
    if (fit.need > fit.room + 1) moved.push(`bloc de vague trop étroit en Difficile (${fit.need} > ${fit.room})`);
    await cmp('Difficile');
    if (moved.length) problems += moved.length;
    console.log(`${moved.length ? '✗' : '✓'} ${w}×${h} bloc de vague et bouton de vague immobiles${moved.length ? '\n    ' + moved.join('\n    ') : ''}`);
    await page.waitForTimeout(2300); // fin de la construction
  }
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
  // Partie à quatre (simulée, sans réseau) : rangée d'équipe. Les noms par défaut
  // (« Esprit 286 ») tiennent en entier : sur une ligne, ils tombaient à « E… ».
  if (COOP_SIZES.has(w)) {
    await page.evaluate(() => document.getElementById('modal').classList.add('hidden'));
    for (const me of [0, 1]) {
      await page.evaluate(async (me) => {
        const { Game, assignElements } = await import('/src/core/game.js');
        const { defs, loadLevel } = await import('/src/data.js');
        const level = await loadLevel('1-4');
        const want = ['fire', 'water', 'wind', 'earth'];
        const els = assignElements(want);
        const players = ['Esprit 232', 'Esprit 286', 'Esprit 537', 'Esprit 570'].map((name, i) => ({ name, elements: els[i], element: want[i] }));
        const game = new Game(level, defs, { seed: 3, players, localPlayer: me });
        window.__state.coopRole = me ? 'guest' : 'host';
        window.__state.coopPlayers = players;
        window.__beginGame('1-4', level, game, { hard: false, challenge: false });
      }, me);
      await page.waitForTimeout(900);
      await check(`partie à quatre simulée (${me ? 'invité' : 'hôte'}, rangée d’équipe)`);
      const cut = await page.evaluate(() => {
        const row = document.getElementById('team-row').getBoundingClientRect();
        return [...document.querySelectorAll('#team-row .mate')].flatMap((m) => {
          const r = m.getBoundingClientRect();
          const out = [];
          if (r.left < row.left - 0.5 || r.right > row.right + 0.5) out.push(`puce hors de la rangée « ${m.textContent.trim()} »`);
          for (const n of m.querySelectorAll('.mate-name')) if (n.scrollWidth > n.clientWidth + 1) out.push(`nom coupé « ${n.textContent} » (${n.scrollWidth} > ${n.clientWidth})`);
          return out;
        });
      });
      if (cut.length) problems += cut.length;
      console.log(`${cut.length ? '✗' : '✓'} ${w}×${h} rangée d’équipe à quatre (${me ? 'invité' : 'hôte'}) : noms par défaut entiers${cut.length ? '\n    ' + cut.join('\n    ') : ''}`);
    }
    await page.evaluate(() => {
      window.__state.coopRole = null;
      window.__state.coopPlayers = null;
    });
  }
  if (errors.length) {
    problems += errors.length;
    console.log(`✗ ${w}×${h} erreurs console :\n    ${errors.join('\n    ')}`);
  }
  await ctx.close();
}

// ── Ancienne installation (§4.5) : iOS garde « black-translucent » pour une icône déjà
// posée ; la classe `ios26-app` repousse tout sous la bande floue (X + 40). Aucun texte,
// bouton, sceau ni image ne commence dans [0, X + 40) sur l'accueil, la carte, la fiche
// de niveau, la partie, la pause, la fiche et le salon.
const OLD = [
  [375, 667, 20, 0],
  [390, 844, 47, 34],
  [430, 932, 59, 34],
  [402, 874, 62, 34],
];
const HOME_OFF = 'http://localhost:8080/?broker=off';
for (const [w, h, X, bottom] of OLD) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const band = X + 40;
  const prep = async () => {
    await page.evaluate(() => document.documentElement.classList.add('ios26-app'));
    await page.addStyleTag({ content: `:root.ios26-app{--sat:calc(${X}px + 40px) !important;--sab:${bottom}px !important}` });
    await page.waitForTimeout(300);
  };
  const bandCheck = async (label) => {
    const res = await page.evaluate((band) => {
      const issues = [];
      const shown = (el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (!r.width || !r.height || st.visibility === 'hidden' || st.opacity === '0' || el.closest('.hidden')) return null;
        if (el.closest('.screen') && !el.closest('.screen.active')) return null;
        return r;
      };
      const sel = '.screen.active *, #modal:not(.hidden) *';
      for (const el of document.querySelectorAll(sel)) {
        const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        const kind = el.tagName === 'BUTTON' ? 'bouton' : el.tagName === 'IMG' ? 'image' : el.classList.contains('seal') ? 'sceau' : text ? 'texte' : null;
        if (!kind) continue;
        const r = shown(el);
        if (!r || r.bottom <= 0) continue;
        if (r.top < band - 0.5) issues.push(`${kind} à y = ${Math.round(r.top)} (< ${band}) « ${(el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 20)} »`);
      }
      return [...new Set(issues)];
    }, band);
    if (res.length) problems += res.length;
    console.log(`${res.length ? '✗' : '✓'} ancienne installation ${w}×${h} (X = ${X}) ${label}${res.length ? '\n    ' + res.join('\n    ') : ''}`);
  };
  await page.goto(HOME_OFF, { waitUntil: 'networkidle' });
  await prep();
  await bandCheck('accueil');
  if (await page.locator('#btn-multi').isVisible()) {
    await page.click('#btn-multi');
    await page.waitForTimeout(500);
    await bandCheck('salon');
    await page.goto(HOME_OFF, { waitUntil: 'networkidle' });
    await prep();
  }
  await page.click('#btn-levels');
  await page.waitForTimeout(700);
  await bandCheck('carte');
  await page.locator('.map-node').first().click();
  await page.waitForTimeout(400);
  await bandCheck('fiche de niveau');
  await page.evaluate(() => window.__startLevel('2-4'));
  await page.waitForTimeout(1500);
  await bandCheck('partie 2-4');
  await page.click('#btn-pause');
  await page.waitForTimeout(400);
  await bandCheck('pause');
  await page.locator('#modal:not(.hidden) .btn.primary').first().click();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const g = window.__state.game;
    g.gold = 999;
    const gr = g.grid;
    for (let i = 0; i < gr.size; i++) {
      if (gr.type(i) !== 3) continue;
      const type = g.availableTowers.find((t) => g.canPlaceTower(t, gr.col(i), gr.row(i)).ok);
      const t = type && g.placeTower(type, gr.col(i), gr.row(i));
      if (!t) continue;
      window.__input.ui.selectedTower = t.id;
      window.__sheets.open('tower', t.id);
      return;
    }
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__sheets.grow(true)); // grande hauteur : le cas le plus haut
  await page.waitForTimeout(500);
  await bandCheck('fiche de lanterne (grande hauteur)');
  if (errors.length) {
    problems += errors.length;
    console.log(`✗ ancienne installation ${w}×${h} erreurs console :\n    ${errors.join('\n    ')}`);
  }
  await ctx.close();
}

await browser.close();
process.exit(problems ? 1 : 0);
