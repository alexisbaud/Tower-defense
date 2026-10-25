// Tests du multijoueur coopératif dans de vrais navigateurs (Playwright), au doigt
// simulé (événements tactiles, 390×844) : 2 joueurs, puis 4, puis 3. Le jeu parle à
// un relais MQTT local passé par ?broker= (voir tools/net-test.mjs pour le relais).
// Chaque téléphone fait tourner la même partie (lockstep) : seules les commandes
// datées et les battements de l'hôte circulent.
//
//   salon créé à l'ouverture (code) · rejoindre par code et par lien · élément unique
//   lancement par l'hôte · palette limitée à l'élément de chacun · pose d'un invité :
//   construction visible chez tous, activée à la même image · « Annuler » · fusion et
//   vente d'un invité en route (ni revendue ni refusionnée pendant le délai) · or séparé
//   · vies communes · lanterne d'un autre : ni vente ni fusion · poses simultanées ·
//   appel de vague et rembobinage par un invité · pause de l'hôte (même image chez
//   tous) · menu d'un invité (la partie continue) · hôte en arrière-plan · hôte sans
//   nouvelles (« En attente de l'hôte… ») · vitesse réservée à l'hôte · invité qui
//   recharge (« Synchronisation… ») · coupures du réseau · hôte qui quitte · arrivée
//   pendant une partie seul · salon plein · fin de partie (victoire calculée par
//   chacun, défaite annoncée par l'hôte) · départs et relance · fin manquée · fin
//   forgée · débit · aucune erreur console.
//
// Usage : (serveur local sur :8080, relais sur :8883)
//   node tools/mp-test.mjs [ws://localhost:8883/mqtt] [dossier des captures]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BROKER = process.argv[2] || 'ws://localhost:8883/mqtt';
const SHOTS = process.argv[3] || null;
const BASE = 'http://localhost:8080/';
const LEVEL = '1-3'; // premier niveau avec le Rembobinage (3e nœud de la carte)
const LEVEL_INDEX = 2;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ' ' + extra}`);
  if (!ok) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const errors = [];
const players = [];
const url = (extra = '') => `${BASE}?broker=${encodeURIComponent(BROKER)}${extra}`;

class Player {
  constructor(tag) {
    this.tag = tag;
  }

  async open(path = url()) {
    this.ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    this.page = await this.ctx.newPage();
    this.page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`[${this.tag}] ${m.type()} ${m.text()}`));
    this.page.on('pageerror', (e) => errors.push(`[${this.tag}] pageerror ${e.message} ${(e.stack || '').split('\n').slice(1, 3).join(' ')}`));
    this.cdp = await this.ctx.newCDPSession(this.page);
    await this.page.goto(path, { waitUntil: 'networkidle' });
    players.push(this);
    return this;
  }

  ev(fn, arg) {
    return this.page.evaluate(fn, arg);
  }

  until(fn, arg, timeout = 8000) {
    return this.page
      .waitForFunction(fn, arg, { timeout })
      .then(() => true)
      .catch(() => false);
  }

  touch(type, q) {
    return this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: q.x, y: q.y, id: 1, radiusX: 8, radiusY: 8 }] });
  }

  async tap(q, ms = 60) {
    await this.touch('touchStart', q);
    await this.page.waitForTimeout(ms);
    await this.touch('touchEnd');
    await this.page.waitForTimeout(160);
  }

  async center(sel) {
    const r = await this.page.locator(sel).first().boundingBox();
    if (!r) throw new Error(`${this.tag} : ${sel} introuvable`);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }

  async tapSel(sel) {
    // carte de résultat : boutons inactifs 700 ms (verrou contre les touchers involontaires)
    await this.page.waitForFunction(() => !document.querySelector('#modal:not(.hidden) .actions.locked'), null, { timeout: 2000 }).catch(() => {});
    await this.tap(await this.center(sel));
  }

  visible(sel) {
    return this.page
      .locator(sel)
      .first()
      .isVisible()
      .catch(() => false);
  }

  // Centre écran d'une case (c, r) du plateau.
  async at(c, r) {
    const box = await this.page.locator('#board').boundingBox();
    const p = await this.ev(([c, r]) => window.__renderer.toScreen(c + 0.5, r + 0.5), [c, r]);
    return { x: box.x + p.x, y: box.y + p.y };
  }

  shot(name) {
    return SHOTS ? this.page.screenshot({ path: `${SHOTS}/${name}.png` }) : null;
  }

  async close() {
    await this.ctx.close().catch(() => {});
  }
}

const lobby = (p) =>
  p.ev(() => {
    const s = window.__session;
    return { role: s.role, state: s.state, code: s.code, inGame: s.inGame, players: (s.lobby?.players || []).map((x) => ({ id: x.id, name: x.name, element: x.element, online: x.online })) };
  });
const gameOf = (p) =>
  p.ev(() => {
    const st = window.__state;
    const g = st.game;
    if (!g) return { screen: st.screen, role: st.coopRole };
    return {
      screen: st.screen,
      role: st.coopRole,
      local: g.localPlayer,
      frame: g.frame,
      lives: g.lives,
      gold: g.players.map((x) => Math.floor(x.gold)),
      wave: g.waveIndex,
      state: g.state,
      rewinds: g.rewindsUsed,
      towers: g.towers.map((t) => ({ id: t.id, type: t.type, c: t.c, r: t.r, owner: t.owner })),
      builds: window.__commands.builds().map((b) => ({ c: b.c, r: b.r, pid: b.pid, op: b.op, mine: b.mine, k: b.k })),
      avail: g.availableTowers,
      time: g.time,
      paused: st.paused,
      wait: window.__coop.waitKind(),
      stats: window.__coop.net?.stats ? { ...window.__coop.net.stats } : null,
    };
  });
// Empreinte de synchronisation et image de la partie de chacun.
const hashOf = (p) =>
  p.ev(async () => {
    const { syncHash } = await import('/src/net/lockstep.js');
    const g = window.__state.game;
    return `${g.frame}:${syncHash(g)}`;
  });
// Journal des commandes exécutées (identifiant → image d'exécution) : on le pose sur
// la partie en cours (un état complet importé garde le même objet Game).
const hookExec = (p) =>
  p.ev(() => {
    const g = window.__state.game;
    if (g.__hooked) return;
    g.__hooked = true;
    window.__ex = new Map();
    const ex = g.execute.bind(g);
    g.execute = (e) => (window.__ex.set(e.id, g.frame), ex(e));
  });
// Socle libre et compatible avec la lanterne `type` (gravé de son élément, ou universel).
const freeSlot = (p, type, minRow = 0) =>
  p.ev(
    ([type, minRow]) => {
      const g = window.__state.game;
      const grid = g.grid;
      for (let i = 0; i < grid.size; i++) {
        const c = grid.col(i);
        const r = grid.row(i);
        if (r < minRow) continue;
        if (window.__commands.check('placeTower', type, c, r).ok) return [c, r];
      }
      return null;
    },
    [type, minRow],
  );

// Choisit une lanterne dans la palette (onglet de son élément d'abord) puis touche un socle.
// Menu de pause (§6.10) : « Recommencer », « Quitter », « Quitter le salon » se confirment
// par un second toucher (armConfirm)
async function pauseAct(p, act) {
  const b = p.page.locator(`#modal .pause-danger [data-act="${act}"]`);
  await b.click();
  await p.page.waitForTimeout(150);
  await b.click();
}

async function placeBy(p, type, minRow = 2) {
  const el = await p.ev((t) => window.__state.game.defs.towers[t].element, type);
  if (await p.visible(`.ptab[data-el="${el}"]`)) await p.tapSel(`.ptab[data-el="${el}"]`);
  await p.tapSel(`.tool[data-tool="${type}"]`);
  const slot = await freeSlot(p, type, minRow);
  if (!slot) return null;
  await p.tap(await p.at(slot[0], slot[1]));
  return slot;
}

// Glisse la poignée de la jauge de Rembobinage vers la gauche (doigt).
async function dragRewind(p) {
  const k = await p.center('#rewind-knob');
  const track = await p.page.locator('.rewind-track').boundingBox();
  await p.touch('touchStart', k);
  for (let i = 1; i <= 14; i++) {
    await p.touch('touchMove', { x: k.x - ((k.x - track.x - 6) * i) / 14, y: k.y });
    await p.page.waitForTimeout(16);
  }
  await p.touch('touchEnd');
  await p.page.waitForTimeout(200);
}

// Même modification chez tous, à la même image : l'hôte arrête la partie commune (pause
// annoncée), chacun applique `fn` à sa partie, puis la partie reprend. Les parties
// restent identiques (le test règle ainsi vies, or, fin de partie… sans écart).
async function together(peers, fn, arg) {
  const [H] = peers;
  await H.ev(() => window.__coop.setPaused(true));
  const pz = await H.ev(() => window.__coop.net.pauseAt);
  for (const p of peers) await p.until((pz) => window.__state.game?.frame === pz, pz, 8000);
  const out = [];
  for (const p of peers) out.push(await p.ev(fn, arg));
  await H.ev(() => window.__coop.setPaused(false));
  return out;
}

// Toutes les parties à la même image (pause de l'hôte), pour les comparer.
async function settle(peers) {
  const [H] = peers;
  await H.ev(() => window.__coop.setPaused(true));
  const pz = await H.ev(() => window.__coop.net.pauseAt);
  for (const p of peers) await p.until((pz) => window.__state.game?.frame === pz, pz, 8000);
  const hashes = [];
  for (const p of peers) hashes.push(await hashOf(p));
  await H.ev(() => window.__coop.setPaused(false));
  return hashes;
}

try {
  // ─────────── image « en retard » au lancement d'une partie (page chargée) ───────────
  // Chrome date une image de son début : juste après un lancement coûteux (4 joueurs
  // sur un téléphone chargé), l'horodatage précède parfois d'1 s la demande. Le temps
  // du rendu devenait négatif : exception, boucle arrêtée, écran figé. Émulé ici.
  console.log('Image en retard au lancement');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(() => {
      const orig = window.requestAnimationFrame.bind(window);
      window.__staleOnce = false;
      window.requestAnimationFrame = (cb) =>
        orig((ts) => {
          if (window.__staleOnce) {
            window.__staleOnce = false;
            ts -= 1200;
          }
          cb(ts);
        });
    });
    await page.goto(`${BASE}?broker=off`, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      window.__staleOnce = true;
      window.__startLevel('1-1');
    });
    await page.waitForTimeout(1200);
    const t1 = await page.evaluate(() => window.__renderer.time);
    await page.waitForTimeout(500);
    const t2 = await page.evaluate(() => window.__renderer.time);
    check('image en retard : le rendu continue (temps ≥ 0, aucune exception)', t1 >= 0 && t2 > t1 && errs.length === 0, `${t1} → ${t2} ${errs.join(' | ')}`);
    await ctx.close();
  }

  // ─────────────────────────── deux joueurs ───────────────────────────
  console.log('Salon à l’ouverture');
  const A = await new Player('A').open();
  check('salon créé tout seul, en ligne, avec un code de 4 lettres', await A.until(() => window.__session?.online && /^[A-Z]{4}$/.test(window.__session.code)), JSON.stringify(await lobby(A)));
  const code = (await lobby(A)).code;
  await A.tapSel('#btn-multi'); // « À plusieurs » : feuille du salon
  check('« À plusieurs » ouvre la feuille du salon', await A.until(() => !!document.querySelector('#modal:not(.hidden) #title-lobby')));
  const shown = await A.ev(() => [...document.querySelectorAll('#title-lobby .lobby-code-ch')].map((e) => e.textContent).join(''));
  check('code affiché en sceaux dans la feuille du salon', shown === code, shown);
  check('« Inviter » et « Jouer » visibles', (await A.visible('.lobby-invite')) && (await A.visible('#btn-play')));
  const link = await A.ev(() => document.querySelector('.lobby-invite')?.dataset.link || '');
  check('lien d’invitation ?salon=CODE (relais conservé)', link.includes(`salon=${code}`) && link.includes('broker='), link);
  await A.tapSel('.lobby-invite');
  check('« Inviter » : lien partagé ou copié (message)', await A.until(() => document.querySelector('#app-toast')?.classList.contains('show')));
  check('seul : choix de l’élément visible (un mot par carte)', (await A.visible('.lobby-el[data-el="fire"]')) && (await A.ev(() => document.querySelector('.lobby-el[data-el="fire"] .lobby-el-style').textContent)) === 'Offensif');
  await A.tapSel('.lobby-el[data-el="fire"]');
  check('élément choisi (Feu)', (await lobby(A)).players[0]?.element === 'fire');
  await A.shot('salon-seul');

  console.log('Rejoindre par le code');
  const B = await new Player('B').open();
  await B.until(() => window.__session?.online);
  await B.tapSel('#btn-multi');
  await B.page.fill('.lobby-join-input', code.toLowerCase());
  await B.tapSel('.lobby-join-ok');
  check('B a rejoint le salon de A', await B.until((c) => window.__session.role === 'guest' && window.__session.online && window.__session.code === c, code, 10000), JSON.stringify(await lobby(B)));
  check('A voit deux joueurs', await A.until(() => window.__session.lobby.players.length === 2));
  check('B : « L’hôte choisit le niveau… », pas de bouton Jouer', (await B.visible('#title-wait')) && !(await B.visible('#btn-play')), await B.ev(() => document.querySelector('#title-wait').textContent));
  check('à deux : choix de l’élément visible', (await A.visible('.lobby-el[data-el="wind"]')) && (await A.ev(() => document.querySelectorAll('#title-lobby .lobby-player').length)) === 2);
  check('élément pris par un autre : désactivé', await B.ev(() => document.querySelector('.lobby-el[data-el="fire"]').disabled));
  await B.page.evaluate(() => window.__session.pickElement('fire')); // même en forçant
  await wait(400);
  check('élément déjà pris refusé par l’hôte', (await lobby(A)).players[1].element !== 'fire', JSON.stringify((await lobby(A)).players));
  await B.tapSel('.lobby-el[data-el="wind"]');
  check('B choisit le Vent, A le voit', await A.until(() => window.__session.lobby.players[1]?.element === 'wind'));
  // conflit : A et B choisissent la Terre au même instant ; l'hôte tranche (le sien d'abord)
  await Promise.all([A.ev(() => window.__lobby.pick('earth')), B.ev(() => window.__lobby.pick('earth'))]);
  await wait(900);
  const conflict = (await lobby(A)).players;
  check('conflit simultané : un seul joueur obtient la Terre (l’hôte)', conflict.filter((p) => p.element === 'earth').length === 1 && conflict[0].element === 'earth', JSON.stringify(conflict));
  const lose = await B.ev(() => ({ toast: document.querySelector('#app-toast').textContent, show: document.querySelector('#app-toast').classList.contains('show'), prof: JSON.parse(localStorage.getItem('jardin-esprits.profil')).element }));
  check('conflit : B est prévenu (« déjà choisi par … »)', lose.show && /déjà choisi par/.test(lose.toast), JSON.stringify(lose));
  check('conflit : le profil de B garde l’élément obtenu (Vent)', lose.prof === 'wind', JSON.stringify(lose));
  if ((await lobby(A)).players[0].element !== 'fire') await A.tapSel('.lobby-el[data-el="fire"]');
  if ((await lobby(A)).players[1].element !== 'wind') await B.tapSel('.lobby-el[data-el="wind"]');
  check('après le conflit : Feu (A) et Vent (B)', await A.until(() => window.__session.lobby.players.map((p) => p.element).join() === 'fire,wind', null, 4000), JSON.stringify((await lobby(A)).players));
  await A.shot('salon-a-2');
  await B.shot('salon-a-2-invite');

  console.log('Lancement par l’hôte');
  await A.ev(() => {
    window.__save.record('1-1', 3);
    window.__save.record('1-2', 3);
  });
  await A.tapSel('#modal .menu-x'); // la feuille du salon se ferme…
  check('accueil de l’hôte : « Jouer à 2 · Choisir le niveau »', await A.until(() => document.getElementById('btn-play-label').textContent === 'Jouer à 2'));
  await A.tapSel('#btn-play'); // … et le héros ouvre la carte
  await A.until(() => window.__state.screen === 'map');
  await A.page.waitForTimeout(500);
  await A.tapSel(`.map-node >> nth=${LEVEL_INDEX}`);
  check('fiche du niveau : « Partent avec vous · 2 », un élément chacun', await A.until(() => /Partent avec vous · 2/.test(document.querySelector('.modal-card')?.textContent || '') && /Chacun ne pose que les lanternes de son élément/.test(document.querySelector('.modal-card')?.textContent || '')));
  await A.tapSel('.modal-card .actions .btn.primary');
  check('A en partie (hôte)', await A.until(() => window.__state.screen === 'game' && window.__state.coopRole === 'host' && window.__coop.isHost));
  check('B entre dans la partie (invité, sa propre simulation)', await B.until(() => window.__state.screen === 'game' && window.__state.coopRole === 'guest' && window.__coop.isGuest && window.__state.game.frame > 30));
  let a = await gameOf(A);
  let b = await gameOf(B);
  const els = (p) => p.ev(() => [...new Set(window.__state.game.availableTowers.map((t) => window.__state.game.defs.towers[t].element))]);
  const paletteEls = (p) => p.ev(() => [...new Set([...document.querySelectorAll('#palette .tool')].map((x) => x.dataset.tool).filter((t) => t !== 'stone').map((t) => window.__state.game.defs.towers[t].element))]);
  check('même niveau, B est le joueur 2', b.local === 1 && (await B.ev(() => window.__state.levelId)) === LEVEL);
  check('palette de B : seulement le Vent', JSON.stringify(await els(B)) === '["wind"]' && JSON.stringify(await paletteEls(B)) === '["wind"]', JSON.stringify([await els(B), await paletteEls(B)]));
  check('palette de A : seulement le Feu', JSON.stringify(await els(A)) === '["fire"]' && JSON.stringify(await paletteEls(A)) === '["fire"]', JSON.stringify([await els(A), await paletteEls(A)]));
  // les coéquipiers prennent la place des onglets (§6.6) : « Vous » soudé à la boîte, l'or des autres
  const team = (p) => p.ev(() => [...document.querySelectorAll('#team-row:not(.hidden) .mate:not(.me)')].map((m) => m.getAttribute('aria-label')));
  check('rangée des coéquipiers (nom, or)', (await B.visible('#team-row .mate.me')) && (await A.visible('#team-row .mate.me')) && /\d+ or/.test((await team(A)).join()) && /\d+ or/.test((await team(B)).join()), JSON.stringify([await team(A), await team(B)]));
  check('tutoriel désactivé en coopération', await B.ev(() => window.__tutorial.steps.length === 0));
  const lagB = await B.ev(() => window.__coop.net.lag);
  check('B suit la partie de A, un peu en retard (< 0,5 s)', lagB >= 0 && lagB < 30, `${lagB}`);
  await hookExec(A);
  await hookExec(B);
  // le test prend son temps entre deux gestes : le sanctuaire reçoit de quoi tenir (chez tous)
  await together([A, B], () => {
    const g = window.__state.game;
    g.maxLives = g.lives = 400;
  });

  console.log('Pose d’un invité : construction chez tous, activée à la même image');
  const goldA0 = (await gameOf(A)).gold[0];
  const goldB0 = (await gameOf(B)).gold[1];
  const wind = b.avail.find((t) => t === 'wind') || b.avail[0];
  const cost = await B.ev((t) => window.__state.game.defs.towers[t].cost, wind);
  const slotB = await placeBy(B, wind);
  check('B pose une lanterne : en construction chez lui aussitôt', !!slotB && (await gameOf(B)).builds.some((x) => x.c === slotB[0] && x.r === slotB[1] && x.mine));
  check('… en construction chez A aussi (construction de B)', await A.until(([c, r]) => window.__commands.builds().some((x) => x.c === c && x.r === r && x.pid === 1 && !x.mine), slotB, 2000));
  await B.shot('construction-invite');
  await A.shot('construction-hote');
  check('… pas encore active (2 s)', !(await A.ev(([c, r]) => !!window.__state.game.towerAt(c, r), slotB)));
  check('la lanterne de B s’active chez A et chez B', (await A.until(([c, r]) => window.__state.game.towerAt(c, r)?.owner === 1, slotB, 4000)) && (await B.until(([c, r]) => window.__state.game.towerAt(c, r)?.owner === 1, slotB, 4000)));
  const act = async (p) =>
    p.ev(([c, r]) => {
      const g = window.__state.game;
      const rec = g.recent.find((e) => e.op === 'placeTower' && e.args[1] === c && e.args[2] === r);
      return rec ? { id: rec.id, f: window.__ex.get(rec.id), frame: rec.frame } : null;
    }, slotB);
  const [xa, xb] = [await act(A), await act(B)];
  check('… à la même image chez les deux', xa && xb && xa.id === xb.id && xa.f === xb.f && xa.f === xa.frame, JSON.stringify([xa, xb]));
  await B.page.waitForTimeout(300);
  a = await gameOf(A);
  b = await gameOf(B);
  check('or séparé : B paie, A garde le sien (chez les deux)', a.gold[1] === goldB0 - cost && a.gold[0] === goldA0 && b.gold[1] === goldB0 - cost && b.gold[0] === goldA0, `${JSON.stringify(a.gold)} ${JSON.stringify(b.gold)} coût ${cost}`);
  check('B : « Annuler » encore possible après l’activation', await B.visible('#btn-undo'));
  const fireType = a.avail.find((t) => t === 'fire') || a.avail[0];
  const slotA = await placeBy(A, fireType);
  check('la lanterne de A apparaît chez B (après sa construction)', await B.until(([c, r]) => window.__state.game.towerAt(c, r)?.owner === 0, slotA, 5000));

  console.log('Lanterne d’un autre joueur');
  await A.tap(await A.at(slotB[0], slotB[1]));
  check('A touche la lanterne de B : « Lanterne de … », sans Vendre', (await A.until(() => !!document.querySelector('#tower-bar .tb-owner'))) && !(await A.visible('#tower-bar .tb-sell')), await A.ev(() => document.querySelector('#tower-bar').innerHTML.slice(0, 200)));
  await A.tapSel('#tower-bar .tb-info');
  check('fiche : nom du joueur, ni vente ni fusion', (await A.until(() => /ni vente ni fusion/.test(document.querySelector('#info')?.textContent || ''))) && !(await A.visible('#info .btn.sell')));
  await A.tapSel('#info .sheet-close');
  check('la commande de vente de A est refusée d’emblée', !(await A.ev((id) => !!window.__commands.issue('sellTower', id), (await gameOf(A)).towers.find((t) => t.owner === 1).id)));
  const fromA = await A.at(slotA[0], slotA[1]);
  await B.touch('touchStart', { x: fromA.x, y: fromA.y - 12 });
  for (let i = 1; i <= 8; i++) {
    await B.touch('touchMove', { x: fromA.x + i * 6, y: fromA.y - 12 + i * 4 });
    await B.page.waitForTimeout(16);
  }
  check('B ne peut pas emporter la lanterne de A (pas de fusion)', !(await B.ev(() => !!window.__input.ui.drag)));
  await B.touch('touchEnd');
  await B.page.waitForTimeout(200);
  await B.tap(await B.at(slotB[0], slotB[1]));
  check('B touche sa propre lanterne : « Vendre » proposé', await B.until(() => !!document.querySelector('#tower-bar .tb-sell')));
  await B.tap(await B.at(0, 0));

  console.log('Poses simultanées, « Annuler » aussitôt');
  await together([A, B], () => window.__state.game.players.forEach((p) => (p.gold += 600)));
  await B.ev(() => {
    window.__flashes = [];
    const i = window.__input;
    const f = i.flash.bind(i);
    i.flash = (t, x, y, bad) => (window.__flashes.push(t), f(t, x, y, bad));
  });
  const uni = await A.ev(() => {
    const g = window.__state.game;
    const gr = g.grid;
    for (let i = 0; i < gr.size; i++) if (gr.type(i) === 3 && !gr.slotElement[i] && !g.towerAt(gr.col(i), gr.row(i)) && !window.__commands.buildAt(gr.col(i), gr.row(i)) && gr.row(i) >= 2) return [gr.col(i), gr.row(i)];
    return null;
  });
  const g0 = (await gameOf(A)).gold;
  const pick = async (p, t) => {
    const el = await p.ev((t) => window.__state.game.defs.towers[t].element, t);
    if (await p.visible(`.ptab[data-el="${el}"]`)) await p.tapSel(`.ptab[data-el="${el}"]`);
    await p.tapSel(`.tool[data-tool="${t}"]`);
    return p.at(uni[0], uni[1]);
  };
  const [qa, qb] = await Promise.all([pick(A, fireType), pick(B, wind)]);
  await Promise.all([B.tap(qb), A.tap(qa)]);
  await wait(3200);
  const here = (await gameOf(A)).towers.filter((t) => t.c === uni[0] && t.r === uni[1]);
  const g1 = (await gameOf(A)).gold;
  check('poses simultanées : une seule lanterne, seul le gagnant paie', here.length === 1 && g1[1 - here[0].owner] === g0[1 - here[0].owner], JSON.stringify([here, g0, g1]));
  check('poses simultanées : B voit la même chose', JSON.stringify((await gameOf(B)).towers.filter((t) => t.c === uni[0] && t.r === uni[1])) === JSON.stringify(here));
  if (here[0]?.owner === 0) check('perdant (B) : « Pris par … » près du socle', (await B.ev(() => window.__flashes)).some((t) => /^Pris par /.test(t)), JSON.stringify(await B.ev(() => window.__flashes)));
  // « Annuler » touché aussitôt après la pose (avant même que l'hôte l'ait datée)
  await B.ev(() => {
    const c = window.__session.client;
    const om = c.onmessage;
    window.__slow = () => (c.onmessage = om);
    c.onmessage = (t, x) => setTimeout(() => om(t, x), 250);
  });
  const gu = (await gameOf(A)).gold[1];
  const su = await placeBy(B, wind);
  check('B : pose provisoire (pas encore datée) en construction', (await B.ev(() => window.__state.provisional.length)) === 1);
  await B.tapSel('#btn-undo');
  check('« Annuler » : la construction disparaît aussitôt chez B', (await B.ev(([c, r]) => !window.__commands.buildAt(c, r), su)) && (await B.ev(() => window.__state.provisional.length)) === 0);
  await wait(3000);
  await B.ev(() => window.__slow());
  check('« Annuler » aussitôt : rien n’est construit, ni chez A ni chez B, rien n’est payé', !(await A.ev(([c, r]) => !!window.__state.game.towerAt(c, r), su)) && !(await B.ev(([c, r]) => !!window.__state.game.towerAt(c, r), su)) && (await gameOf(A)).gold[1] === gu, JSON.stringify([su, gu, (await gameOf(A)).gold]));
  // « Annuler » pendant la construction (pose datée) : retirée chez tous, rien n'est payé
  const sv = await placeBy(B, wind);
  await B.page.waitForTimeout(700);
  check('construction datée (chez A aussi)', await A.until(([c, r]) => window.__commands.buildAt(c, r)?.pid === 1, sv, 1500));
  await B.tapSel('#btn-undo');
  check('« Annuler » pendant la construction : elle disparaît aussitôt chez B', await B.ev(([c, r]) => !window.__commands.buildAt(c, r), sv));
  await wait(2500);
  check('… retirée chez A, jamais activée, or rendu', !(await A.ev(([c, r]) => !!window.__state.game.towerAt(c, r) || !!window.__commands.buildAt(c, r), sv)) && (await gameOf(A)).gold[1] === gu);

  console.log('Fusion et vente d’un invité : en route pendant le délai des commandes');
  // (qa-coop) Une fusion ou une vente s'exécute ~1 s après le geste : la lanterne glissée
  // revenait à sa place comme si la fusion avait échoué, et pouvait être revendue ou
  // refusionnée entre-temps (la seconde commande échouait en silence).
  const tw1 = await placeBy(B, wind);
  const tw2 = await placeBy(B, wind);
  check('deux lanternes jumelles de B', await B.until(([a, b]) => window.__state.game.towerAt(...a)?.level === 1 && window.__state.game.towerAt(...b)?.level === 1, [tw1, tw2], 5000));
  await B.page.waitForTimeout(3200); // (« Annuler » de la dernière pose : passé)
  const [fa, fb] = [await B.at(...tw1), await B.at(...tw2)];
  await B.touch('touchStart', { x: fa.x, y: fa.y - 10 });
  await B.page.waitForTimeout(80);
  for (let i = 1; i <= 12; i++) {
    await B.touch('touchMove', { x: fa.x + ((fb.x - fa.x) * i) / 12, y: fa.y - 10 + ((fb.y - fa.y) * i) / 12 });
    await B.page.waitForTimeout(16);
  }
  await B.touch('touchEnd');
  const fu = await B.ev(([a, b]) => {
    const g = window.__state.game;
    const s = g.towerAt(...a);
    const d = g.towerAt(...b);
    return { src: !!s, ops: [...window.__commands.towerOps().values()].map((x) => x.op), again: window.__commands.check('fuse', s?.id, d?.id).ok, sell: window.__commands.check('sellTower', s?.id).ok };
  }, [tw1, tw2]);
  check('fusion glissée : en route (la lanterne file vers sa jumelle), ni seconde fusion ni vente', fu.src && fu.ops.includes('fuse') && fu.ops.includes('fuseInto') && !fu.again && !fu.sell, JSON.stringify(fu));
  await B.shot('fusion-en-route');
  check('… fusion faite chez A et chez B', (await A.until(([a, b]) => !window.__state.game.towerAt(...a) && window.__state.game.towerAt(...b)?.level === 2, [tw1, tw2], 4000)) && (await B.until(([a, b]) => !window.__state.game.towerAt(...a) && window.__state.game.towerAt(...b)?.level === 2, [tw1, tw2], 4000)));
  await B.tap(await B.at(...tw2));
  await B.until(() => !!document.querySelector('#tower-bar .tb-sell'), null, 2000);
  await B.tapSel('#tower-bar .tb-sell');
  await B.tapSel('#tower-bar .tb-sell');
  const sv2 = await B.ev(([c, r]) => {
    const t = window.__state.game.towerAt(c, r);
    return { still: !!t, busy: t ? window.__commands.towerBusy(t.id) : null, canSell: t ? window.__commands.check('sellTower', t.id).ok : null, bar: !document.querySelector('#tower-bar').classList.contains('hidden') };
  }, tw2);
  check('vente confirmée : en route (la lanterne s’efface), pas de seconde vente, barre fermée', !sv2.still || (sv2.busy && !sv2.canSell && !sv2.bar), JSON.stringify(sv2));
  check('… vendue chez A et chez B', (await A.until(([c, r]) => !window.__state.game.towerAt(c, r), tw2, 4000)) && (await B.until(([c, r]) => !window.__state.game.towerAt(c, r), tw2, 4000)));

  console.log('Vagues, vitesse, vies communes');
  await B.tapSel('#btn-wave');
  check('B lance la première vague (chez A aussi)', (await A.until(() => window.__state.game.waveIndex === 0, null, 3000)) && (await B.until(() => window.__state.game.waveIndex === 0, null, 3000)));
  await B.page.waitForTimeout(400);
  const w = (await gameOf(A)).wave;
  await B.tapSel('#btn-wave');
  check('B appelle la vague suivante en avance', await A.until((w) => window.__state.game.waveIndex === w + 1, w, 3000));
  check('A est prévenu de l’appel de B', await A.until(() => /appelle la vague/.test(document.querySelector('#lane')?.textContent || '')));
  await A.page.waitForTimeout(1600);
  const w2 = (await gameOf(A)).wave;
  const wq = await B.center('#btn-wave');
  for (let k = 0; k < 2; k++) {
    await B.touch('touchStart', wq);
    await B.page.waitForTimeout(30);
    await B.touch('touchEnd');
    await B.page.waitForTimeout(70);
  }
  await A.page.waitForTimeout(2000);
  check('double toucher de B sur « Vague » : une seule vague de plus', (await gameOf(A)).wave === w2 + 1, `${w2} → ${(await gameOf(A)).wave}`);
  check('yokai visibles chez B (sa propre simulation)', await B.until(() => window.__state.game.enemies.length > 0));
  await B.tapSel('#btn-speed');
  check('vitesse : réservée à l’hôte (B ne change rien)', (await A.ev(() => window.__state.speed)) === 1);
  await A.tapSel('#btn-speed');
  check('A passe en ×2, B le voit', await B.until(() => window.__state.speed === 2 && /×2/.test(document.querySelector('#btn-speed').textContent)));
  await A.tapSel('#btn-speed');
  check('retour à ×1 chez B', await B.until(() => window.__state.speed === 1));
  // vies communes : les lanternes se taisent jusqu'à la première fuite (chez tous, même image)
  const lives0 = (await gameOf(A)).lives;
  await together([A, B], () => {
    const g = window.__state.game;
    const keep = g.towers.map((t) => t.stunT);
    for (const t of g.towers) t.stunT = 999;
    const l = g.lives;
    for (let k = 0; k < 60 * 120 && g.lives === l && g.state === 'wave'; k++) g.update(1 / 60);
    g.towers.forEach((t, i) => (t.stunT = keep[i] ?? 0));
  });
  a = await gameOf(A);
  check('une fuite coûte des vies', a.lives < lives0, `${a.lives} / ${lives0}`);
  check('vies communes : B voit les mêmes vies (HUD)', await B.until((l) => window.__state.game.lives === l && document.querySelector('#hud-lives').textContent === String(l), a.lives));
  const h1 = await settle([A, B]);
  check('même partie chez A et B (empreinte à la même image)', h1[0] === h1[1], h1.join(' '));
  check('aucune resynchronisation jusqu’ici', ((await gameOf(B)).stats?.resyncs ?? 1) === 0, JSON.stringify((await gameOf(B)).stats));

  console.log('Rembobinage par un invité');
  check('jauge pleine et utilisable chez B', await B.until(() => window.__state.game.canRewind() && document.querySelector('#rewind')?.classList.contains('ready'), null, 6000), await B.ev(() => document.querySelector('#rewind').className));
  await dragRewind(B);
  // (qa-coop) pendant le délai de la commande, la jauge disait « Le passé s'accumule… »
  // et se laissait glisser de nouveau : elle annonce le Rembobinage en route
  const coming = await B.ev(() => ({ text: document.querySelector('#rewind .rewind-label')?.textContent || '', again: window.__commands.check('rewind').ok, rw: window.__state.game.rewindsUsed }));
  check('B : jauge « Le temps va reculer… » pendant le délai, pas de second Rembobinage', coming.rw === 1 || (/va reculer|Recule…/.test(coming.text) && !coming.again), JSON.stringify(coming));
  check('B rembobine : le temps recule chez A et chez B', (await A.until(() => window.__state.game.rewindsUsed === 1, null, 3000)) && (await B.until(() => window.__state.game.rewindsUsed === 1, null, 3000)));
  check('A est prévenu du rembobinage de B', await A.until(() => /remonte le temps/.test(document.querySelector('#lane')?.textContent || '')));
  await A.page.waitForTimeout(1600);
  const h2 = await settle([A, B]);
  check('après le Rembobinage : même partie', h2[0] === h2[1], h2.join(' '));

  // (qa refonte) l'invité a son menu ouvert (sa partie continue) quand le sanctuaire
  // tombe : la feuille couvrait la poignée, seule issue, et la partie était perdue.
  console.log('Dernière chance, menu de l’invité ouvert');
  {
    await A.page.waitForTimeout(2300); // du passé à rembobiner (≥ 2 s) depuis le Rembobinage
    await B.tapSel('#btn-pause');
    check('menu de B ouvert', await B.until(() => /La partie continue/.test(document.querySelector('#modal:not(.hidden) .modal-card')?.textContent || '')));
    const used0 = (await gameOf(A)).rewinds;
    await together([A, B], () => {
      const g = window.__state.game;
      g.rewindCharge = g.rules.rewindCost;
      g.lives = 0;
      g.lastChanceT = g.rules.lastChanceSeconds ?? 4;
    });
    check('dernière chance chez B : son menu se ferme', await B.until(() => window.__state.game.lastChanceT > 0 && document.getElementById('modal').classList.contains('hidden') && !window.__state.paused, null, 3000), JSON.stringify(await B.ev(() => ({ lc: window.__state.game.lastChanceT, modal: !document.getElementById('modal').classList.contains('hidden') }))));
    const kn = await B.center('#rewind .rewind-knob');
    check('… la poignée est sous le doigt (rien ne la couvre)', await B.ev(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('#rewind'), kn));
    await B.tap(kn);
    check('… un toucher de B sauve la partie, chez A et chez B', (await A.until((u) => window.__state.game.rewindsUsed === u + 1 && window.__state.game.state === 'wave', used0, 4000)) && (await B.until((u) => window.__state.game.rewindsUsed === u + 1, used0, 4000)), JSON.stringify(await A.ev(() => ({ st: window.__state.game.state, rw: window.__state.game.rewindsUsed }))));
    await A.page.waitForTimeout(1600);
    check('… les vies reviennent (même partie)', (await A.until(() => window.__state.game.lives > 0, null, 3000)) && (await B.until(() => window.__state.game.lives > 0, null, 3000)));
    const h2b = await settle([A, B]);
    check('après la dernière chance : même partie', h2b[0] === h2b[1], h2b.join(' '));
  }

  console.log('Pause');
  await A.tapSel('#btn-pause');
  check('pause de l’hôte : « Pause par l’hôte » chez B', await B.until(() => !document.querySelector('#coop-wait').classList.contains('hidden') && /Pause par l’hôte/.test(document.querySelector('#coop-wait').textContent)));
  const flicker = await B.ev(
    () =>
      new Promise((res) => {
        let off = 0;
        const t0 = performance.now();
        const iv = setInterval(() => {
          if (document.querySelector('#coop-wait').classList.contains('hidden')) off++;
          if (performance.now() - t0 > 900) {
            clearInterval(iv);
            res(off);
          }
        }, 20);
      }),
  );
  check('pause de l’hôte : bandeau stable (pas de clignotement)', flicker === 0, `${flicker} relevés sans bandeau`);
  const pa = await gameOf(A);
  const pb = await gameOf(B);
  check('pause : A et B arrêtés à la même image', pa.frame === pb.frame && pa.frame === (await A.ev(() => window.__coop.net.pauseAt)), `${pa.frame} ${pb.frame}`);
  await B.page.waitForTimeout(500);
  check('la partie est figée chez B', (await gameOf(B)).frame === pb.frame);
  await A.shot('partie-a-2-hote-pause');
  await B.shot('partie-a-2-invite-pause');
  await A.tapSel('.modal-card .pause-main .btn.primary'); // Reprendre
  check('reprise : le bandeau disparaît chez B', await B.until(() => document.querySelector('#coop-wait').classList.contains('hidden')));
  await B.tapSel('#btn-pause');
  check('menu de B : « La partie continue »', await B.until(() => /La partie continue/.test(document.querySelector('.modal-card')?.textContent || '')));
  const fA = (await gameOf(A)).frame;
  const fB = (await gameOf(B)).frame;
  await A.page.waitForTimeout(600);
  check('le menu d’un invité n’arrête pas la partie (ni chez A, ni chez B)', (await gameOf(A)).frame > fA + 20 && (await gameOf(B)).frame > fB + 20);
  await B.tapSel('.modal-card .pause-main .btn.primary'); // Reprendre
  check('B reprend', !(await B.ev(() => window.__state.paused)));
  // l'hôte passe en arrière-plan : pause pour tous
  await A.ev(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  check('hôte en arrière-plan : pause pour tous', (await B.until(() => /Pause par l’hôte/.test(document.querySelector('#coop-wait').textContent) && !document.querySelector('#coop-wait').classList.contains('hidden'))) && (await A.ev(() => window.__state.paused)));
  await A.ev(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await A.tapSel('.modal-card .pause-main .btn.primary'); // Reprendre
  check('retour de l’hôte : la partie reprend', await B.until(() => document.querySelector('#coop-wait').classList.contains('hidden')));
  // l'hôte ne donne plus de nouvelles (réseau coupé) : l'invité l'attend, sans le dépasser
  await A.ev(() => {
    window.__mute = window.__session.broadcast;
    window.__session.broadcast = () => {};
  });
  check('hôte sans nouvelles : « En attente de l’hôte… »', await B.until(() => /En attente de l’hôte/.test(document.querySelector('#coop-wait').textContent) && !document.querySelector('#coop-wait').classList.contains('hidden'), null, 6000));
  check('invité bloqué pendant l’attente (aucune commande)', await B.ev(() => window.__input.inspect === true));
  const stuck = (await gameOf(B)).frame;
  await B.page.waitForTimeout(400);
  check('… sa partie s’arrête (jamais plus de 8 images après le dernier battement)', (await gameOf(B)).frame === stuck);
  await A.ev(() => (window.__session.broadcast = window.__mute));
  check('les nouvelles reviennent : le bandeau disparaît, B rattrape', await B.until(() => document.querySelector('#coop-wait').classList.contains('hidden') && window.__coop.net.lag < 40, null, 8000));
  await A.page.waitForTimeout(700);
  await A.shot('partie-a-2-hote');
  await B.shot('partie-a-2-invite');

  console.log('Débit pendant une vague');
  {
    const t0 = Date.now();
    const in0 = await B.ev(() => window.__session.traffic.in);
    const f0 = (await gameOf(A)).frame;
    await B.tapSel('#btn-wave');
    await wait(8000);
    const secs = (Date.now() - t0) / 1000;
    const bytes = (await B.ev(() => window.__session.traffic.in)) - in0;
    const fr = (await gameOf(A)).frame - f0;
    const en = (await gameOf(A)).towers.length;
    console.log(`  · reçu par l’invité : ${(bytes / secs / 1024).toFixed(2)} Ko/s (${Math.round(bytes / secs)} o/s, ${fr} images, ${en} lanternes, ${await A.ev(() => window.__state.game.enemies.length)} yokai)`);
    check('débit très faible chez l’invité (< 1 Ko/s)', bytes / secs < 1024, `${Math.round(bytes / secs)} o/s`);
  }

  console.log('Invité qui recharge la page');
  const before = await gameOf(A);
  await B.page.reload({ waitUntil: 'networkidle' });
  check('B revient dans la partie après rechargement', await B.until(() => window.__state.screen === 'game' && window.__state.coopRole === 'guest', null, 12000), JSON.stringify(await lobby(B)));
  check('B : état complet reçu (« Synchronisation… » puis la partie)', await B.until(() => window.__coop.net?.stats.imports === 1 && window.__coop.waitKind() === null && window.__state.game.frame > 600, null, 8000), JSON.stringify((await gameOf(B)).stats));
  check('B retrouve les lanternes et son or', await B.until(([n, g]) => window.__state.game.towers.length === n && Math.abs(Math.floor(window.__state.game.players[1].gold) - g) < 60, [before.towers.length, before.gold[1]]));
  check('A voit B présent (pas « absent »)', await A.until(() => !document.querySelector('#team-row .mate.off')));
  const h3 = await settle([A, B]);
  check('après le rechargement : même partie', h3[0] === h3[1], h3.join(' '));

  console.log('Coupures du réseau');
  await B.ev(() => window.__session.client.ws.close());
  check('connexion de l’invité coupée : il revient seul, même partie', (await B.until(() => window.__session.online && window.__state.coopRole === 'guest', null, 10000)) && (await B.until(() => window.__coop.waitKind() === null && window.__coop.net.lag < 40, null, 10000)));
  await A.ev(() => window.__session.client.ws.close());
  check('connexion de l’hôte coupée : il se reconnecte, salon intact', await A.until(() => window.__session.online && window.__session.lobby.players.length === 2, null, 10000));
  check('l’invité retrouve l’hôte et la partie continue', (await B.until(() => window.__coop.waitKind() === null && window.__coop.net.lag < 40 && window.__state.screen === 'game', null, 15000)) && !(await B.visible('#modal:not(.hidden)')));
  const h4 = await settle([A, B]);
  check('après les coupures : même partie', h4[0] === h4[1], h4.join(' '));

  console.log('L’hôte quitte');
  await A.close();
  check('B : « L’hôte a quitté la partie »', await B.until(() => /L’hôte a quitté la partie/.test(document.querySelector('.modal-card')?.textContent || ''), null, 10000));
  await B.tapSel('.modal-card .actions .btn.primary');
  check('B retrouve son propre salon, en ligne', await B.until(() => window.__state.screen === 'title' && window.__session.role === 'host' && window.__session.online, null, 8000), JSON.stringify(await lobby(B)));
  await B.close();

  // ─────────────────────────── quatre joueurs ───────────────────────────
  console.log('Quatre joueurs');
  const H = await new Player('H').open();
  await H.until(() => window.__session?.online);
  const code4 = (await lobby(H)).code;
  await H.ev(() => {
    window.__save.record('1-1', 3);
    window.__save.record('1-2', 3);
  });
  await H.tapSel('#btn-multi');
  await H.tapSel('.lobby-el[data-el="earth"]');
  // l'hôte joue d'abord seul : un ami qui arrive attendra la partie suivante
  await H.ev(() => window.__startLevel('1-1'));
  await H.until(() => window.__state.screen === 'game' && !window.__state.coopRole);
  const early = await new Player('P2').open(url(`&salon=${code4}`));
  check('arrivée pendant une partie seul : acceptée', await early.until(() => window.__session.role === 'guest' && window.__session.online, null, 10000));
  check('l’arrivant sait que l’hôte joue seul', await early.until(() => /seul/.test(document.querySelector('#title-wait').textContent)), await early.ev(() => document.querySelector('#title-wait').textContent));
  check('l’hôte est prévenu en jeu', await H.until(() => /rejoint votre salon/.test(document.querySelector('#lane')?.textContent || '')));
  await H.tapSel('#btn-pause');
  await pauseAct(H, 'quit');
  await H.until(() => window.__state.screen === 'map');
  await H.tapSel('#btn-map-back');
  check('hôte revenu au salon : l’arrivant attend le choix du niveau', await early.until(() => /choisit le niveau/.test(document.querySelector('#title-wait').textContent)));
  const G = [];
  for (const [k, el] of [
    ['P2', 'fire'],
    ['P3', 'water'],
    ['P4', 'wind'],
  ]) {
    const p = k === 'P2' ? early : await new Player(k).open(url(`&salon=${code4}`));
    check(`${k} rejoint par le lien`, await p.until(() => window.__session.role === 'guest' && window.__session.online, null, 10000));
    if ((await p.ev((el) => document.querySelector(`.lobby-el[data-el="${el}"]`).getAttribute('aria-checked'), el)) !== 'true') await p.tapSel(`.lobby-el[data-el="${el}"]`);
    await p.until((el) => window.__session.lobby.players.find((x) => x.id === window.__session.id)?.element === el, el, 4000);
    G.push(p);
  }
  check('l’hôte voit 4 joueurs, 4 éléments différents', await H.until(() => window.__session.lobby.players.length === 4 && new Set(window.__session.lobby.players.map((p) => p.element)).size === 4), JSON.stringify((await lobby(H)).players));
  const P5 = await new Player('P5').open();
  await P5.until(() => window.__session?.online);
  await P5.ev((c) => window.__lobby.join(c), code4);
  check('5e joueur : salon complet', (await P5.until(() => /complet/.test(document.querySelector('.lobby-error')?.textContent || ''), null, 10000)) && (await lobby(P5)).role === 'host');
  await P5.close();
  await H.page.waitForTimeout(300);
  await H.shot('salon-a-4');
  await G[0].shot('salon-a-4-invite');
  await H.tapSel('#btn-play');
  await H.until(() => window.__state.screen === 'map');
  await H.page.waitForTimeout(400);
  await H.tapSel(`.map-node >> nth=${LEVEL_INDEX}`);
  await H.until(() => /Partent avec vous · 4/.test(document.querySelector('.modal-card')?.textContent || ''));
  await H.tapSel('.modal-card .actions .btn.primary');
  let all = true;
  for (const p of G) all = (await p.until(() => window.__state.screen === 'game' && window.__state.coopRole === 'guest')) && all;
  check('les trois invités entrent dans la partie', all);
  const P = [H, ...G];
  const want = ['earth', 'fire', 'water', 'wind'];
  for (let i = 0; i < P.length; i++) {
    const e = await els(P[i]);
    check(`${P[i].tag} : palette de son seul élément (${want[i]})`, JSON.stringify(e) === JSON.stringify([want[i]]) && JSON.stringify(await paletteEls(P[i])) === JSON.stringify([want[i]]), JSON.stringify(e));
  }
  // « Vous » soudé à la boîte + les trois autres
  check('rangée des coéquipiers : 3 chez chacun (plus « Vous »)', (await H.ev(() => [document.querySelectorAll('#team-row .mate:not(.me)').length, document.querySelectorAll('#team-row .mate.me').length].join())) === '3,1');
  for (const p of P) await hookExec(p);
  const placed = [];
  let building = true;
  for (const p of G) {
    const g = await gameOf(p);
    const s = await placeBy(p, g.avail[0], 1);
    placed.push(s);
    // sa construction, aussitôt chez lui, puis chez les trois autres (pose datée par l'hôte)
    for (const q of P) building = (await q.until((s) => !!s && (!!window.__commands.buildAt(s[0], s[1]) || !!window.__state.game.towerAt(s[0], s[1])), s, 1500)) && building;
    if (p === G[1]) await G[2].shot('partie-a-4-construction');
  }
  check('chaque construction d’un invité est visible chez les quatre', building);
  let seen = true;
  for (const p of P) seen = (await p.until((list) => list.every((s) => s && window.__state.game.towerAt(s[0], s[1])), placed, 5000)) && seen;
  check('… puis actives chez les quatre', seen);
  const frames = [];
  for (const p of P) frames.push(await p.ev((list) => list.map((s) => window.__ex.get(window.__state.game.recent.find((e) => e.op === 'placeTower' && e.args[1] === s[0] && e.args[2] === s[1])?.id)).join(), placed));
  check('… chacune activée à la même image chez les quatre', new Set(frames).size === 1 && !frames[0].includes('undefined'), frames.join(' | '));
  const h5 = await settle(P);
  check('à quatre : même partie partout', new Set(h5).size === 1, h5.join(' '));
  await H.page.waitForTimeout(300);
  await H.shot('partie-a-4-hote');
  await G[1].shot('partie-a-4-invite');

  console.log('Fin de partie');
  // tous sautent à la fin (dernière vague lancée, plus aucun yokai), à la même image :
  // chacun calcule lui-même sa victoire
  await together(P, () => {
    const g = window.__state.game;
    while (g.startNextWave(0, false));
    for (const s of g.spawners) s.spawned = s.count;
    g.enemies = [];
  });
  check('victoire chez l’hôte', await H.until(() => /Victoire/.test(document.querySelector('.modal-card')?.textContent || ''), null, 8000));
  // §6.12 : « Suivant » seul en vermillon, « Rejouer » secondaire, « Salon » en texte
  check('hôte : « Suivant », « Rejouer », « Salon »', /Suivant.*Rejouer.*Salon/.test(await H.ev(() => document.querySelector('.modal-card .actions').textContent)) && (await H.ev(() => !!document.querySelector('.modal-card .actions .btn.text')?.textContent.includes('Salon'))));
  let wins = true;
  for (const p of G) wins = (await p.until(() => /Victoire/.test(document.querySelector('.modal-card')?.textContent || '') && !!document.querySelector('.modal-card .actions .btn.primary'), null, 8000)) && wins;
  check('chaque invité voit la victoire (calculée par sa propre partie)', wins);
  let starsOk = true;
  for (const p of G) starsOk = (await p.ev((id) => window.__save.level(id).stars > 0, LEVEL)) && starsOk;
  check('étoiles enregistrées chez chacun', starsOk);
  check('invité : « Retour au salon »', /Retour au salon/.test(await G[0].ev(() => document.querySelector('.modal-card .actions').textContent)));
  await G[0].page.waitForTimeout(1600);
  await G[0].shot('victoire-invite');
  await G[0].tapSel('.modal-card .actions .btn.primary');
  check('retour au salon de l’hôte', await G[0].until(() => window.__state.screen === 'title' && window.__session.role === 'guest'));
  await H.tapSel('.modal-card .actions .btn:not(.primary):not(.text)'); // Rejouer
  all = true;
  for (const p of G) all = (await p.until(() => window.__state.screen === 'game' && window.__state.coopRole === 'guest' && !window.__state.resultShown, null, 8000)) && all;
  check('« Rejouer » de l’hôte : nouvelle partie pour tous', all);
  // défaite chez l'hôte seul : les invités la reçoivent par l'annonce de l'hôte (filet)
  await H.ev(() => window.__state.game.lose());
  let lost = true;
  for (const p of G) lost = (await p.until(() => /Le sanctuaire est tombé/.test(document.querySelector('.modal-card')?.textContent || ''), null, 8000)) && lost;
  check('défaite annoncée par l’hôte : chaque invité la voit', lost);
  await H.until(() => /Le sanctuaire est tombé/.test(document.querySelector('.modal-card')?.textContent || ''));
  await H.tapSel('.modal-card .actions .btn.primary'); // Réessayer
  all = true;
  for (const p of G) all = (await p.until(() => window.__state.screen === 'game' && !window.__state.resultShown && document.querySelector('#modal').classList.contains('hidden'), null, 8000)) && all;
  check('« Réessayer » de l’hôte : tous repartent', all);
  await H.tapSel('#btn-pause');
  await pauseAct(H, 'quit');
  let ended = true;
  for (const p of G) ended = (await p.until(() => /mis fin à la partie/.test(document.querySelector('.modal-card')?.textContent || ''), null, 8000)) && ended;
  check('l’hôte quitte la partie : « L’hôte a mis fin à la partie »', ended);
  for (const p of [H, ...G]) await p.close();

  // ─────────────── trois joueurs : départs, relance, fin manquée, messages forgés ───────────────
  console.log('Départs et relance');
  const { MqttClient } = await import('../src/net/mqtt.js');
  const X = await new Player('X').open();
  await X.until(() => window.__session?.online);
  const codeX = (await lobby(X)).code;
  await X.tapSel('#btn-multi');
  await X.tapSel('.lobby-el[data-el="fire"]');
  const Y = await new Player('Y').open(url(`&salon=${codeX}`));
  const Z = await new Player('Z').open(url(`&salon=${codeX}`));
  for (const [p, el] of [
    [Y, 'water'],
    [Z, 'wind'],
  ]) {
    await p.until(() => window.__session.role === 'guest' && window.__session.online, null, 10000);
    if ((await p.ev((el) => document.querySelector(`.lobby-el[data-el="${el}"]`).getAttribute('aria-checked'), el)) !== 'true') await p.tapSel(`.lobby-el[data-el="${el}"]`);
    await p.until((el) => window.__session.lobby.players.find((x) => x.id === window.__session.id)?.element === el, el, 4000);
  }
  check('salon à trois (Feu, Eau, Vent)', await X.until(() => window.__session.lobby.players.map((p) => p.element).join() === 'fire,water,wind'), JSON.stringify((await lobby(X)).players));
  await X.ev(() => window.__startLevel('1-1'));
  check('les deux invités entrent dans la partie', (await Y.until(() => window.__state.screen === 'game' && window.__coop.isGuest)) && (await Z.until(() => window.__state.screen === 'game' && window.__coop.isGuest)));

  // Y quitte le salon en pleine partie ; « Recommencer pour tous » repart sans lui
  await Y.tapSel('#btn-pause');
  await pauseAct(Y, 'leave');
  check('X voit Y absent', await X.until(() => window.__session.lobby.players.find((p) => p.element === 'water')?.online === false, null, 6000));
  const gidX = await X.ev(() => window.__state.gid);
  await Z.ev(() => {
    window.__sawEnd = false;
    new MutationObserver(() => {
      if (/Partie terminée/.test(document.querySelector('.modal-card')?.textContent || '') && !document.querySelector('#modal').classList.contains('hidden')) window.__sawEnd = true;
    }).observe(document.querySelector('#modal'), { attributes: true, childList: true, subtree: true });
  });
  await X.tapSel('#btn-pause');
  await pauseAct(X, 'restart');
  check('« Recommencer pour tous » : partie à 2, sans l’absent', await X.until((g0) => window.__state.game && window.__state.gid !== g0 && window.__state.game.players.length === 2 && window.__session.lobby.players.length === 2, gidX, 6000), JSON.stringify(await X.ev(() => [window.__state.game?.players.length, window.__session.lobby.players.map((p) => [p.element, p.online])])));
  check('… un élément chacun : Feu pour X (l’Eau de l’absent n’est à personne)', await X.ev(() => JSON.stringify(window.__state.game.players[0].elements) === '["fire"]' && window.__state.game.availableTowers.every((t) => window.__state.game.defs.towers[t].element === 'fire')));
  check('… Z entre dans la nouvelle partie (sans « Partie terminée »)', (await Z.until((g0) => window.__state.screen === 'game' && window.__coop.isGuest && window.__state.gid !== g0 && window.__state.game.players.length === 2, gidX, 8000)) && !(await Z.ev(() => window.__sawEnd)));

  console.log('Fin de partie manquée pendant une coupure');
  await Z.ev(() => {
    const s = window.__session;
    const on = s.onGuestMessage;
    s.onGuestMessage = (m) => m.type !== 'end' && on.call(s, m);
    window.__unmute = () => (s.onGuestMessage = on);
  });
  await X.tapSel('#btn-pause');
  await pauseAct(X, 'quit');
  check('invité sans le message de fin : « Partie terminée » (pas d’attente sans fin)', await Z.until(() => /Partie terminée/.test(document.querySelector('.modal-card')?.textContent || '') && !document.querySelector('#modal').classList.contains('hidden'), null, 8000), await Z.ev(() => document.querySelector('#coop-wait').textContent));
  await Z.tapSel('.modal-card .actions .btn.primary');
  await Z.until(() => window.__state.screen === 'title');
  await Z.ev(() => window.__unmute());

  await X.tapSel('#btn-map-back');
  await X.until(() => window.__state.screen === 'title');
  await X.ev(() => window.__startLevel('1-1'));
  await Z.until(() => window.__state.screen === 'game' && window.__coop.isGuest);
  // un tiers du relais forge une fin de partie (avec du HTML) : sans la partie qu'elle
  // termine, elle est ignorée ; avec, le résultat n'affiche que des nombres
  const spy = new MqttClient(BROKER);
  await spy.connect();
  const fake = (gid) => JSON.stringify({ type: 'end', ...(gid != null ? { gid } : {}), result: { won: true, stars: 3, challenge: true, level: '1-1', kills: '<img src=x onerror="window.__pwned=1">', towers: '<b id="inj">7</b>', lives: '<i id="inj2">' } });
  spy.publish(`jde/v1/${codeX}/h`, fake(null));
  await wait(800);
  check('fin forgée sans sa partie : ignorée (l’invité joue toujours)', await Z.ev(() => window.__state.screen === 'game' && !window.__state.resultPending && !window.__state.resultShown && document.querySelector('#modal').classList.contains('hidden')));
  spy.publish(`jde/v1/${codeX}/h`, fake(await Z.ev(() => window.__state.gid)));
  await Z.until(() => window.__state.resultShown, null, 4000);
  const inj = await Z.ev(() => ({ shown: window.__state.resultShown, pwned: window.__pwned ?? null, tags: !!document.querySelector('#inj, #inj2, .result-stats img'), text: document.querySelector('.result-stats')?.textContent || '' }));
  check('fin forgée : aucun HTML injecté dans le résultat', inj.shown && inj.pwned === null && !inj.tags, JSON.stringify(inj));
  spy.close();
  await Z.tapSel('.modal-card .actions .btn.primary'); // Retour au salon
  await Z.until(() => window.__state.screen === 'title' && window.__session.role === 'guest');

  await Z.tapSel('#btn-multi'); // « Salon » (invité) : la feuille du salon
  await Z.tapSel('.lobby-leave'); // « Quitter le salon » : armé…
  check('« Quitter le salon » se confirme (second toucher)', await Z.ev(() => window.__session.role === 'guest' && document.querySelector('.lobby-leave').classList.contains('armed')));
  await Z.tapSel('.lobby-leave'); // … puis quitté
  await X.until(() => window.__session.lobby.players[1]?.online === false, null, 6000);
  await X.tapSel('#btn-pause');
  await pauseAct(X, 'restart');
  check('seul après les départs : « Recommencer » relance une partie seul (4 éléments)', await X.until(() => window.__state.game && !window.__state.coopRole && window.__state.game.players.length === 1 && window.__state.game.players[0].elements.length === 4 && !window.__session.inGame && window.__session.lobby.players.length === 1, null, 6000));
  for (const p of [X, Y, Z]) await p.close();

  console.log('Recherche de salon annulée');
  const W = await new Player('W').open(`${BASE}?broker=${encodeURIComponent(`${BROKER},${BROKER}`)}`);
  await W.until(() => window.__session?.online);
  await W.ev(() => {
    window.__toasts = [];
    const el = document.querySelector('#app-toast');
    new MutationObserver(() => window.__toasts.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await W.tapSel('#btn-multi');
  await W.page.fill('.lobby-join-input', 'ZZZZ');
  await W.tapSel('.lobby-join-ok');
  await W.until(() => /Recherche du salon/.test(document.querySelector('.lobby-error')?.textContent || ''));
  check('pendant la recherche : « Annuler la recherche »', /Annuler la recherche/.test(await W.ev(() => document.querySelector('.lobby-leave')?.textContent || '')));
  await W.tapSel('.lobby-leave');
  await W.page.waitForTimeout(7500);
  const wl = await W.ev(() => ({ role: window.__session.role, state: window.__session.state, client: !!window.__session.client?.connected, toasts: window.__toasts }));
  check('recherche annulée : son salon reste ouvert et en ligne', wl.role === 'host' && wl.state === 'online' && wl.client, JSON.stringify(wl));
  check('… sans faux « Vous avez rejoint »', !wl.toasts.some((t) => /Vous avez rejoint/.test(t)), JSON.stringify(wl.toasts));
  await W.close();
} catch (e) {
  failures++;
  console.log(`  ✗ exception : ${e.message}`);
}

check('aucune erreur console', errors.length === 0, '\n    ' + errors.slice(0, 12).join('\n    '));
for (const p of players) await p.close();
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests multijoueur passent');
process.exit(failures ? 1 : 0);
