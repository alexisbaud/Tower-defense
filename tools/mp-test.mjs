// Tests du multijoueur coopératif dans de vrais navigateurs (Playwright), au doigt
// simulé (événements tactiles, 390×844) : 2 joueurs, puis 4. Le jeu parle à un relais
// MQTT local passé par ?broker= (voir tools/net-test.mjs pour le relais).
//
//   salon créé à l'ouverture (code) · rejoindre par code et par lien · élément unique
//   lancement par l'hôte · pose d'un invité visible chez tous · or séparé · vies
//   communes · lanterne d'un autre : ni vente ni fusion · appel de vague et
//   rembobinage par un invité · pause de l'hôte · menu d'un invité (la partie
//   continue) · hôte en arrière-plan (pause pour tous) · hôte sans nouvelles
//   (« En attente de l'hôte… ») · vitesse réservée à l'hôte · invité qui recharge
//   et revient · coupures du réseau (invité, hôte) · arrivée pendant une partie
//   seul · salon plein · fin de partie (victoire et étoiles chez chacun) · hôte qui
//   quitte · aucune erreur console.
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

// Le relais doit répondre (sinon chaque connexion du jeu échouerait en console).
async function relayUp() {
  return new Promise((resolve) => {
    let ws;
    const t = setTimeout(() => {
      try {
        ws?.close();
      } catch {}
      resolve(false);
    }, 3000);
    try {
      ws = new WebSocket(BROKER, ['mqtt']);
    } catch {
      clearTimeout(t);
      resolve(false);
      return;
    }
    ws.onopen = () => {
      clearTimeout(t);
      ws.close();
      resolve(true);
    };
    ws.onerror = () => {
      clearTimeout(t);
      resolve(false);
    };
  });
}
// ─────────── synchronisation hôte → invité, sans réseau, horloge simulée ───────────
// Un HostSync et un ClientSync reliés par un « relais » en mémoire qui retarde chaque
// message (20 à 120 ms, parfois deux états collés) : lecture régulière des yokai,
// pas de glissade après un Rembobinage, impulsion du Givre, événements compacts,
// lanternes étourdies, mur déplacé, appel anticipé, « Annuler » avant confirmation.
async function syncChecks() {
  console.log('Synchronisation (horloge simulée, sans relais)');
  const { Game, STEP } = await import('../src/core/game.js');
  const { defs, loadLevel } = await import('../src/data.js');
  const { HostSync, ClientSync, applyCommand, makeMirror } = await import('../src/net/sync.js');
  const level = await loadLevel('2-2');
  const players = [
    { name: 'Hôte', elements: ['fire', 'water'] },
    { name: 'Aki', elements: ['wind', 'earth'] },
  ];
  const nowOrig = performance.now;
  let clock = 0;
  let extraLag = 0; // latence ajoutée (relais lent)
  let speed = 1; // vitesse de l'hôte
  performance.now = () => clock;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const game = new Game(level, defs, { seed: 3, players });
  game.lives = game.maxLives = 999;
  for (const p of game.players) p.gold = 5000;
  const net = []; // messages en route : { at, fn }
  const host = new HostSync(game, (snap) => {
    const json = JSON.stringify(snap);
    sizes.push(json.length);
    // gigue : 20 à 120 ms, et un état sur six arrive collé au suivant
    const lag = (rand() < 1 / 6 ? 150 : 20 + rand() * 100) + extraLag;
    net.push({ at: clock + lag, fn: () => client.apply(JSON.parse(json)) });
  });
  const sizes = [];
  const mirror = makeMirror(Game, level, defs, { seed: 3, players, you: 1 });
  const client = new ClientSync(mirror, (op, args) => net.push({ at: clock + 60 + extraLag, fn: () => applyCommand(game, 1, op, args) }));
  const events = [];
  const frame = (ms = 1000 / 60) => {
    clock += ms;
    host.speed = speed;
    for (let k = 0; k < speed; k++) game.update(STEP);
    host.collect(game.events);
    game.events.length = 0;
    host.tick(ms / 1000);
    for (const m of net.filter((m) => m.at <= clock)) m.fn();
    for (let i = net.length - 1; i >= 0; i--) if (net[i].at <= clock) net.splice(i, 1);
    client.tick(ms / 1000);
    events.push(...mirror.events);
    mirror.events.length = 0;
  };
  const run = (s, each) => {
    for (let k = 0; k < (s * 1000) / (1000 / 60); k++) {
      frame();
      each?.();
    }
  };
  const drawn = (e) => ({ x: e.px + (e.x - e.px) * client.alpha, y: e.py + (e.y - e.py) * client.alpha });
  try {
    game.startNextWave(0, false);
    run(4);
    // lecture : un yokai qui marche avance à chaque image, sans arrêt ni saut
    let frames = 0;
    let still = 0;
    let maxStep = 0;
    let steps = [];
    const last = new Map();
    run(6, () => {
      for (const e of mirror.enemies) {
        if (e.spawnT > 0) continue;
        const h = game.enemies.find((x) => x.id === e.id);
        const p = drawn(e);
        const q = last.get(e.id);
        last.set(e.id, p);
        if (!q || !h || h.stunT > 0 || h.blocked != null || h.knock > 0 || h.slowT > 0) continue;
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        frames++;
        if (d < 1e-4) still++;
        maxStep = Math.max(maxStep, d);
        steps.push(d);
      }
    });
    steps.sort((a, b) => a - b);
    const med = steps[Math.floor(steps.length / 2)] || 0;
    check('invité : yokai fluides malgré la gigue (≤ 3 % d’images figées)', frames > 200 && still / frames <= 0.03, `${still}/${frames}`);
    check('invité : aucun saut (pas > 3× le pas médian)', maxStep <= med * 3 + 0.02, `max ${maxStep.toFixed(3)} médian ${med.toFixed(3)}`);
    check('invité : retard de lecture borné (< 0,4 s)', client.delay < 400, `${Math.round(client.delay)} ms`);

    // événements compacts
    const shoot = [];
    const spawn = [];
    let short = 0;
    const t1 = Object.keys(defs.towers).find((t) => defs.towers[t].element === 'fire' && !defs.towers[t].attack);
    for (let i = 0; i < game.grid.size; i++) {
      const c = game.grid.col(i);
      const r = game.grid.row(i);
      if (game.canPlaceTower(t1, c, r, 0).ok && game.towers.length < 4) game.placeTower(t1, c, r, 0);
    }
    const sp = host.publish;
    host.publish = (snap) => {
      for (const ev of snap.ev) if (ev.type === 'shoot') shoot.push(JSON.stringify(ev).length);
      for (const ev of snap.ev) if (ev.type === 'spawn') spawn.push(JSON.stringify(ev).length);
      if (snap.em?.length) short++;
      sp(snap);
    };
    game.startNextWave(0, false);
    run(5);
    host.publish = sp;
    check('tir : événement compact (< 300 o)', shoot.length > 0 && Math.max(...shoot) < 300, `${shoot.length} tirs, max ${Math.max(...shoot)} o`);
    check('apparition : événement compact (< 220 o)', spawn.length > 0 && Math.max(...spawn) < 220, `max ${Math.max(...spawn)} o`);
    check('lignes courtes pour les yokai connus, mêmes yokai chez l’invité', short > 10 && mirror.enemies.length > 3 && Math.abs(mirror.enemies.length - game.enemies.length) <= 3, `${mirror.enemies.length} / ${game.enemies.length}`);

    // impulsion du Givre (Eau de l'hôte + Vent de l'invité) : la zone garde sa définition
    let pair = null;
    for (let i = 0; i < game.grid.size && !pair; i++) {
      const c = game.grid.col(i);
      const r = game.grid.row(i);
      if (!game.canPlaceTower('water', c, r, 0).ok) continue;
      for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [-1, 1], [-1, 0], [0, -1]]) if (!pair && game.canPlaceTower('wind', c + dc, r + dr, 1).ok) pair = [c, r, c + dc, r + dr];
    }
    game.placeTower('water', pair[0], pair[1], 0);
    game.placeTower('wind', pair[2], pair[3], 1);
    run(0.5);
    const frost = game.zones.find((z) => z.def.id === 'frost');
    game.emit('pulse', { zone: frost });
    events.length = 0;
    run(0.8);
    const pulse = events.find((e) => e.type === 'pulse');
    check('Givre : l’impulsion arrive chez l’invité avec sa définition (plus de plantage)', pulse?.zone?.def?.id === 'frost', JSON.stringify(pulse?.zone || null).slice(0, 120));

    // lanterne étourdie (piétinement) : vue tout de suite, puis l'étourdissement s'écoule
    const tw = game.towers.find((t) => t.owner === 1);
    tw.stunT = 1.5;
    run(0.6);
    const st1 = mirror.towerById(tw.id)?.stunT ?? 0;
    run(2);
    const st2 = mirror.towerById(tw.id)?.stunT ?? 1;
    check('lanterne étourdie : visible chez l’invité, puis rétablie', st1 > 0.2 && st2 === 0, `${st1} → ${st2}`);

    // mur du Gardien déplacé : la case choisie (rally) suit chez l'invité
    let gslot = null;
    for (let i = 0; i < game.grid.size && !gslot; i++) if (game.canPlaceTower('earth_guard', game.grid.col(i), game.grid.row(i), 1).ok) gslot = [game.grid.col(i), game.grid.row(i)];
    const guard = game.placeTower('earth_guard', gslot[0], gslot[1], 1);
    run(0.6);
    const bar = game.barriers.find((b) => b.towerId === guard.id);
    let moved = false;
    for (let i = 0; i < game.grid.size && !moved; i++) {
      if (i === bar.tile) continue;
      if (game.setRally(guard.id, game.grid.col(i), game.grid.row(i), 1)) moved = i;
    }
    run(0.7);
    check('mur déplacé : case de ralliement à jour chez l’invité (< 1 s)', moved !== false && mirror.towerById(guard.id)?.rally === moved && mirror.barriers.find((b) => b.towerId === guard.id)?.tile === moved, `${moved} ${mirror.towerById(guard.id)?.rally}`);

    // appel anticipé : l'aperçu « +N 巻 » de l'invité ne compte plus une vague déjà chargée
    run(1);
    if (game.nextWaveT > 1 && game.canCallNextWave()) game.startNextWave(0, true);
    run(0.8);
    check('appel anticipé : vagues déjà chargées connues de l’invité', [...game.chargedWaves].every((w) => mirror.chargedWaves.has(w)), `${[...game.chargedWaves]} / ${[...mirror.chargedWaves]}`);

    // deux joueurs appellent la même vague au même instant : une seule vague part
    const wv = game.waveIndex;
    if (game.canCallNextWave()) {
      applyCommand(game, 1, 'startNextWave', [wv + 1]);
      applyCommand(game, 0, 'startNextWave', [wv + 1]);
      check('même vague appelée deux fois (deux joueurs) : une seule lancée', game.waveIndex === wv + 1, `${wv} → ${game.waveIndex}`);
    }
    run(0.5);
    // « Annuler » juste après la pose, avant la confirmation de l'hôte
    let us = null;
    for (let i = 0; i < mirror.grid.size && !us; i++) if (mirror.canPlaceTower('wind', mirror.grid.col(i), mirror.grid.row(i)).ok) us = [mirror.grid.col(i), mirror.grid.row(i)];
    const gold0 = game.goldOf(1);
    const pt = mirror.placeTower('wind', us[0], us[1]);
    frame();
    mirror.undoPlace(pt.id);
    run(1.2);
    check('« Annuler » avant confirmation : annulée chez l’hôte, or rendu', !game.towerAt(us[0], us[1]) && game.goldOf(1) >= gold0, `${!!game.towerAt(us[0], us[1])} ${game.goldOf(1)} / ${gold0}`);
    check('… et disparue chez l’invité', !mirror.towerAt(us[0], us[1]));

    // hôte en ×2 et relais lent (0,5 s de plus) : la pose provisoire de l'invité reste
    // affichée jusqu'à sa confirmation (plus de lanterne qui clignote, ni d'or qui remonte)
    speed = 2;
    extraLag = 500;
    run(1);
    let ws = null;
    for (let i = 0; i < mirror.grid.size && !ws; i++) if (mirror.canPlaceTower('wind', mirror.grid.col(i), mirror.grid.row(i)).ok) ws = [mirror.grid.col(i), mirror.grid.row(i)];
    const goldW = mirror.goldOf(1);
    mirror.placeTower('wind', ws[0], ws[1]);
    let gaps = 0;
    let up = 0;
    run(3, () => {
      if (!mirror.towerAt(ws[0], ws[1])) gaps++;
      if (mirror.goldOf(1) > goldW - defs.towers.wind.cost + 40) up++;
    });
    check('×2 et relais lent : la pose de l’invité reste affichée jusqu’à confirmation', gaps === 0 && game.towerAt(ws[0], ws[1])?.owner === 1, `${gaps} images sans lanterne`);
    check('×2 et relais lent : l’or de l’invité ne remonte pas en attendant', up === 0, `${up} images`);
    speed = 1;
    extraLag = 0;
    run(1);

    // Rembobinage : à la fin de l'animation, les yokai sont replacés d'un coup
    run(3);
    game.rewindCharge = game.rules.rewindCost ?? 100;
    const okRw = game.rewind(0);
    let slide = 0;
    let after = false;
    const prev = new Map();
    run(3, () => {
      if (mirror.rewindAnim) {
        after = true;
        prev.clear();
        return;
      }
      if (!after) return;
      for (const e of mirror.enemies) {
        const p = drawn(e);
        const q = prev.get(e.id);
        prev.set(e.id, p);
        if (q) slide = Math.max(slide, Math.hypot(p.x - q.x, p.y - q.y));
      }
    });
    check('après un Rembobinage : pas de glissade des yokai à travers la carte', okRw && after && slide < 0.5, `${okRw} ${after} pas max ${slide.toFixed(2)}`);
    const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    console.log(`  · ${Math.round(avg)} o par état en moyenne (${sizes.length} états, max ${Math.max(...sizes)} o)`);
  } catch (e) {
    check('synchronisation : exception', false, e.stack);
  } finally {
    performance.now = nowOrig;
  }
}
await syncChecks();

if (!(await relayUp())) {
  console.log(`Relais MQTT injoignable (${BROKER}) : lancez-le d'abord (voir tools/net-test.mjs).`);
  process.exit(1);
}

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
      lives: g.lives,
      gold: g.players.map((x) => Math.floor(x.gold)),
      wave: g.waveIndex,
      state: g.state,
      rewinds: g.rewindsUsed,
      towers: g.towers.map((t) => ({ id: t.id, type: t.type, c: t.c, r: t.r, owner: t.owner, pending: !!t.pending })),
      avail: g.availableTowers,
      time: g.time,
      paused: st.paused,
    };
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
        if (g.canPlaceTower(type, c, r).ok) return [c, r];
      }
      return null;
    },
    [type, minRow],
  );

// Choisit une lanterne dans la palette (onglet de son élément d'abord) puis touche un socle.
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

try {
  // ─────────── image « en retard » au lancement d'une partie (page chargée) ───────────
  // Chrome date une image de son début : juste après un lancement coûteux (4 joueurs
  // sur un téléphone chargé), l'horodatage précède parfois d'1 s la demande. Le temps
  // du rendu devenait négatif, l'onde du sanctuaire avait un rayon négatif : exception,
  // boucle arrêtée, écran figé (vu chez deux invités à 4). Émulé ici : 1,2 s d'avance.
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
  const shown = await A.ev(() => [...document.querySelectorAll('#title-lobby .lobby-code-ch')].map((e) => e.textContent).join(''));
  check('code affiché en sceaux sous le titre', shown === code, shown);
  check('« Inviter » et « Jouer » visibles', (await A.visible('.lobby-invite')) && (await A.visible('#btn-play')));
  const link = await A.ev(() => document.querySelector('.lobby-invite')?.dataset.link || '');
  check('lien d’invitation ?salon=CODE (relais conservé)', link.includes(`salon=${code}`) && link.includes('broker='), link);
  await A.tapSel('.lobby-invite');
  check('« Inviter » : lien partagé ou copié (message)', await A.until(() => document.querySelector('#app-toast')?.classList.contains('show')));
  // l'hôte choisit le Feu (le choix est replié tant qu'on est seul)
  check('seul : choix de l’élément replié', await A.ev(() => document.querySelector('#title-lobby').classList.contains('folded')));
  await A.tapSel('.lobby-fold');
  await A.tapSel('.lobby-el[data-el="fire"]');
  check('élément choisi (Feu)', (await lobby(A)).players[0]?.element === 'fire');
  await A.shot('salon-seul');

  console.log('Rejoindre par le code');
  const B = await new Player('B').open();
  await B.until(() => window.__session?.online);
  await B.tapSel('.lobby-join-btn');
  await B.page.fill('.lobby-join-input', code.toLowerCase());
  await B.tapSel('.lobby-join-form .btn.primary');
  check('B a rejoint le salon de A', await B.until((c) => window.__session.role === 'guest' && window.__session.online && window.__session.code === c, code, 10000), JSON.stringify(await lobby(B)));
  check('A voit deux joueurs', await A.until(() => window.__session.lobby.players.length === 2));
  check('B : « L’hôte choisit le niveau… », pas de bouton Jouer', (await B.visible('#title-wait')) && !(await B.visible('#btn-play')), await B.ev(() => document.querySelector('#title-wait').textContent));
  check('à deux : choix de l’élément déplié', !(await A.ev(() => document.querySelector('#title-lobby').classList.contains('folded'))));
  // élément unique : le Feu de A est pris
  check('élément pris par un autre : désactivé', await B.ev(() => document.querySelector('.lobby-el[data-el="fire"]').disabled));
  await B.page.evaluate(() => window.__session.pickElement('fire')); // même en forçant
  await wait(400);
  check('élément déjà pris refusé par l’hôte', (await lobby(A)).players[1].element !== 'fire', JSON.stringify((await lobby(A)).players));
  await B.tapSel('.lobby-el[data-el="wind"]');
  check('B choisit le Vent, A le voit', await A.until(() => window.__session.lobby.players[1]?.element === 'wind'));
  // conflit : A et B choisissent la Terre au même instant (avant que le salon de B ne
  // montre le choix de A) ; l'hôte tranche — son propre choix passe d'abord — et B est prévenu
  await Promise.all([A.ev(() => window.__lobby.pick('earth')), B.ev(() => window.__lobby.pick('earth'))]);
  await wait(900);
  const conflict = (await lobby(A)).players;
  check('conflit simultané : un seul joueur obtient la Terre (l’hôte)', conflict.filter((p) => p.element === 'earth').length === 1 && conflict[0].element === 'earth', JSON.stringify(conflict));
  const lose = await B.ev(() => ({ toast: document.querySelector('#app-toast').textContent, show: document.querySelector('#app-toast').classList.contains('show'), prof: JSON.parse(localStorage.getItem('jardin-esprits.profil')).element }));
  check('conflit : B est prévenu (« déjà choisi par … »)', lose.show && /déjà choisi par/.test(lose.toast), JSON.stringify(lose));
  check('conflit : le profil de B garde l’élément obtenu (Vent)', lose.prof === 'wind', JSON.stringify(lose));
  // A reprend le Feu, B garde le Vent
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
  await A.tapSel('#btn-play');
  await A.until(() => window.__state.screen === 'map');
  await A.page.waitForTimeout(500);
  await A.tapSel(`.map-node >> nth=${LEVEL_INDEX}`);
  check('fiche du niveau : « Partie à 2 »', await A.until(() => /Partie à 2/.test(document.querySelector('.modal-card')?.textContent || '')));
  await A.tapSel('.modal-card .actions .btn.primary');
  check('A en partie (hôte)', await A.until(() => window.__state.screen === 'game' && window.__state.coopRole === 'host'));
  check('B entre dans la partie (invité)', await B.until(() => window.__state.screen === 'game' && window.__state.coopRole === 'guest' && window.__coop.isGuest));
  let a = await gameOf(A);
  let b = await gameOf(B);
  check('même niveau, B est le joueur 2', b.local === 1 && (await B.ev(() => window.__state.levelId)) === LEVEL);
  check('palette de B : Vent et éléments libres, sans Feu', b.avail.length > 0 && !b.avail.some((t) => t === 'fire' || t.startsWith('fire_')), JSON.stringify(b.avail));
  check('palette de A : sans Vent', !a.avail.some((t) => t === 'wind' || t.startsWith('wind_')), JSON.stringify(a.avail));
  check('rangée des coéquipiers (nom, or)', (await B.visible('#coop-roster .coop-mate')) && (await A.visible('#coop-roster .coop-mate')));
  check('tutoriel désactivé en coopération', await B.ev(() => window.__tutorial.steps.length === 0));
  // le test prend son temps entre deux gestes : le sanctuaire reçoit de quoi tenir
  await A.ev(() => {
    const g = window.__state.game;
    g.maxLives = g.lives = 400;
  });

  console.log('Pose d’un invité');
  const goldA0 = a.gold[0];
  const goldB0 = b.gold[1];
  const wind = b.avail.find((t) => t === 'wind') || b.avail.find((t) => t.startsWith('wind'));
  const cost = await B.ev((t) => window.__state.game.defs.towers[t].cost, wind);
  const slotB = await placeBy(B, wind);
  check('B pose une lanterne (provisoire chez lui)', !!slotB && (await gameOf(B)).towers.some((t) => t.c === slotB[0] && t.r === slotB[1]));
  check('la lanterne de B apparaît chez A, à B', await A.until(([c, r]) => window.__state.game.towerAt(c, r)?.owner === 1, slotB));
  await B.page.waitForTimeout(400);
  a = await gameOf(A);
  b = await gameOf(B);
  check('or séparé : B paie, A garde le sien', a.gold[1] === goldB0 - cost && a.gold[0] === goldA0 && b.gold[1] === goldB0 - cost, `${JSON.stringify(a.gold)} ${JSON.stringify(b.gold)} coût ${cost}`);
  check('B : la pose confirmée garde son « Annuler »', await B.visible('#btn-undo'));
  // A pose aussi (pour la fusion refusée plus bas)
  const fireType = a.avail.find((t) => t === 'fire') || a.avail[0];
  const slotA = await placeBy(A, fireType);
  check('la lanterne de A apparaît chez B', await B.until(([c, r]) => window.__state.game.towerAt(c, r)?.owner === 0, slotA));

  console.log('Lanterne d’un autre joueur');
  await A.tap(await A.at(slotB[0], slotB[1]));
  check('A touche la lanterne de B : « Lanterne de … », sans Vendre', (await A.until(() => !!document.querySelector('#tower-bar .tb-owner'))) && !(await A.visible('#tower-bar .tb-sell')), await A.ev(() => document.querySelector('#tower-bar').innerHTML.slice(0, 200)));
  await A.tapSel('#tower-bar .tb-info');
  check('fiche : nom du joueur, ni vente ni fusion', await A.until(() => /ni vente ni fusion/.test(document.querySelector('#info')?.textContent || '')) && !(await A.visible('#info .btn.sell')));
  await A.tapSel('#info .sheet-close');
  const sold = await A.ev((id) => window.__state.game.sellTower(id), (await gameOf(A)).towers.find((t) => t.owner === 1).id);
  check('le moteur refuse aussi la vente par A', sold === 0 && (await gameOf(A)).towers.some((t) => t.owner === 1));
  // glisser la lanterne de A sur celle de B : pas de fusion
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

  console.log('Poses simultanées, « Annuler » aussitôt, Givre');
  await A.ev(() => window.__state.game.players.forEach((p) => (p.gold += 600)));
  await wait(400);
  // A et B touchent le même socle universel au même instant : une seule lanterne,
  // seul le gagnant paie ; le perdant lit la raison près du socle
  await B.ev(() => {
    window.__flashes = [];
    const i = window.__input;
    const f = i.flash.bind(i);
    i.flash = (t, x, y, bad) => (window.__flashes.push(t), f(t, x, y, bad));
  });
  const uni = await A.ev(() => {
    const g = window.__state.game;
    const gr = g.grid;
    for (let i = 0; i < gr.size; i++) if (gr.type(i) === 3 && !gr.slotElement[i] && !g.towerAt(gr.col(i), gr.row(i)) && gr.row(i) >= 2) return [gr.col(i), gr.row(i)];
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
  await wait(1500);
  const here = (await gameOf(A)).towers.filter((t) => t.c === uni[0] && t.r === uni[1]);
  const g1 = (await gameOf(A)).gold;
  check('poses simultanées : une seule lanterne, seul le gagnant paie', here.length === 1 && g1[1 - here[0].owner] === g0[1 - here[0].owner], JSON.stringify([here, g0, g1]));
  check('poses simultanées : B voit la même chose', (await gameOf(B)).towers.filter((t) => t.c === uni[0] && t.r === uni[1] && !t.pending).length === 1);
  if (here[0]?.owner === 0) check('perdant (B) : « Pris par … » près du socle', (await B.ev(() => window.__flashes)).some((t) => /^Pris par /.test(t)), JSON.stringify(await B.ev(() => window.__flashes)));
  // « Annuler » touché aussitôt après la pose (avant la confirmation de l'hôte)
  await B.ev(() => {
    // 250 ms de latence à la réception : la confirmation arrive après le toucher
    const c = window.__session.client;
    const om = c.onmessage;
    window.__slow = () => (c.onmessage = om);
    c.onmessage = (t, x) => setTimeout(() => om(t, x), 250);
  });
  const gu = (await gameOf(A)).gold[1];
  const su = await placeBy(B, wind);
  await B.tapSel('#btn-undo');
  await wait(1800);
  check('« Annuler » aussitôt : annulée chez l’hôte, or rendu', !(await A.ev(([c, r]) => !!window.__state.game.towerAt(c, r), su)) && (await gameOf(A)).gold[1] >= gu, JSON.stringify([su, gu, (await gameOf(A)).gold]));
  check('« Annuler » aussitôt : rien chez B', !(await B.ev(([c, r]) => !!window.__state.game.towerAt(c, r), su)));
  await B.ev(() => window.__slow());
  // Impulsion de combo (Givre : Eau + Vent) relayée à B : la zone voyageait sans sa
  // définition et l'effet plantait la boucle de B (écran figé). Sur cette carte, pas
  // de socles Eau / Vent voisins : deux lanternes voisines d'éléments différents
  // forment un autre combo, dont l'hôte émet l'impulsion (même chemin réseau).
  const combo = await A.ev(() => {
    const g = window.__state.game;
    const gr = g.grid;
    const near = [[1, 0], [0, 1], [1, 1], [-1, 1], [-1, 0], [0, -1], [1, -1], [-1, -1]];
    for (const [ta, tb] of [['water', 'wind'], ['fire', 'wind'], ['fire', 'water'], ['earth', 'wind'], ['fire', 'earth'], ['water', 'earth']]) {
      for (let i = 0; i < gr.size; i++) {
        const c = gr.col(i);
        const r = gr.row(i);
        if (!g.canPlaceTower(ta, c, r, 0).ok) continue;
        for (const [dc, dr] of near) {
          if (!g.canPlaceTower(tb, c + dc, r + dr, 1).ok) continue;
          g.placeTower(ta, c, r, 0);
          g.placeTower(tb, c + dc, r + dr, 1);
          const z = g.zones.find((z) => (z.a === g.towerAt(c, r).id || z.b === g.towerAt(c, r).id) && z.def.elements.includes(g.defs.towers[tb].element));
          if (z) return z.key;
        }
      }
    }
    return null;
  });
  check('combo formé (lanternes de A et de B) chez B', !!combo && (await B.until((k) => window.__state.game.zones.some((z) => z.key === k), combo, 4000)), String(combo));
  await A.ev((k) => {
    const g = window.__state.game;
    g.emit('pulse', { zone: g.zones.find((z) => z.key === k) });
  }, combo);
  await wait(1200);
  const tf = (await gameOf(B)).time;
  await wait(700);
  check('impulsion de combo relayée : la partie de B continue (boucle intacte)', (await gameOf(B)).time > tf + 0.3 && !errors.some((e) => /pageerror/.test(e)), errors.slice(-2).join(' | '));

  console.log('Vagues, vitesse, vies communes');
  await B.tapSel('#btn-wave');
  check('B lance la première vague chez l’hôte', await A.until(() => window.__state.game.waveIndex === 0));
  await B.page.waitForTimeout(400);
  const w = (await gameOf(A)).wave;
  await B.tapSel('#btn-wave');
  check('B appelle la vague suivante en avance', await A.until((w) => window.__state.game.waveIndex === w + 1, w));
  check('A est prévenu de l’appel de B', await A.until(() => /appelle la vague/.test(document.querySelector('#toast')?.textContent || '')));
  // double toucher de B sur « Vague » avant la réponse de l'hôte : une seule vague appelée
  await A.page.waitForTimeout(1600);
  const w2 = (await gameOf(A)).wave;
  const wq = await B.center('#btn-wave');
  for (let k = 0; k < 2; k++) {
    await B.touch('touchStart', wq);
    await B.page.waitForTimeout(30);
    await B.touch('touchEnd');
    await B.page.waitForTimeout(70);
  }
  await A.page.waitForTimeout(1500);
  check('double toucher de B sur « Vague » : une seule vague de plus', (await gameOf(A)).wave === w2 + 1, `${w2} → ${(await gameOf(A)).wave}`);
  check('yokai visibles chez B', await B.until(() => window.__state.game.enemies.length > 0));
  await B.tapSel('#btn-speed');
  check('vitesse : réservée à l’hôte (B ne change rien)', (await A.ev(() => window.__state.speed)) === 1);
  await A.tapSel('#btn-speed');
  check(
    'A passe en ×2, B le voit',
    await B.until(() => window.__state.speed === 2 && /×2/.test(document.querySelector('#btn-speed').textContent)),
    JSON.stringify([await A.ev(() => [window.__state.speed, window.__coop.active, window.__state.game.state]), await B.ev(() => [window.__state.speed, window.__coop.isGuest, window.__coop.speed, window.__coop.client?.received, window.__state.game.state])]),
  );
  await A.tapSel('#btn-speed');
  // vies communes : on avance la simulation de l'hôte jusqu'aux premières fuites
  const lives0 = (await gameOf(A)).lives;
  await A.ev(() => {
    const g = window.__state.game;
    for (const t of g.towers) t.stunT = 999; // les lanternes se taisent : les yokai passent
    const l = g.lives;
    for (let k = 0; k < 60 * 120 && g.lives === l && g.state === 'wave'; k++) g.update(1 / 60);
    for (const t of g.towers) t.stunT = 0;
  });
  a = await gameOf(A);
  check('une fuite coûte des vies chez l’hôte', a.lives < lives0, `${a.lives} / ${lives0}`);
  check('vies communes : B voit les mêmes vies', await B.until((l) => window.__state.game.lives === l && document.querySelector('#hud-lives').textContent === String(l), a.lives));

  console.log('Rembobinage par un invité');
  await A.ev(() => {
    const g = window.__state.game;
    g.rewindCharge = g.rules.rewindCost ?? 100;
  });
  check('jauge pleine et utilisable chez B', await B.until(() => window.__state.game.canRewind() && document.querySelector('#rewind')?.classList.contains('ready'), null, 6000), await B.ev(() => document.querySelector('#rewind').className));
  await dragRewind(B);
  check('B rembobine : le temps recule chez l’hôte', await A.until(() => window.__state.game.rewindsUsed === 1));
  check('A est prévenu du rembobinage de B', await A.until(() => /remonte le temps/.test(document.querySelector('#toast')?.textContent || '')));
  await A.page.waitForTimeout(1600);

  console.log('Pause');
  await A.tapSel('#btn-pause');
  check('pause de l’hôte : « Pause par l’hôte » chez B', await B.until(() => !document.querySelector('#coop-wait').classList.contains('hidden') && /Pause par l’hôte/.test(document.querySelector('#coop-wait').textContent)));
  // le bandeau ne clignote pas (les états plus anciens encore en file ne lèvent pas la pause)
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
  const tB = (await gameOf(B)).time;
  await B.page.waitForTimeout(500);
  check('la partie est figée chez B', Math.abs((await gameOf(B)).time - tB) < 0.05);
  await A.shot('partie-a-2-hote-pause');
  await B.shot('partie-a-2-invite-pause');
  await A.tapSel('.modal-card .actions .btn.primary'); // Reprendre
  check('reprise : le bandeau disparaît chez B', await B.until(() => document.querySelector('#coop-wait').classList.contains('hidden')));
  await B.tapSel('#btn-pause');
  check('menu de B : « La partie continue »', await B.until(() => /La partie continue/.test(document.querySelector('.modal-card')?.textContent || '')));
  const tA = (await gameOf(A)).time;
  await A.page.waitForTimeout(600);
  check('le menu d’un invité n’arrête pas la partie', (await gameOf(A)).time > tA + 0.3);
  await B.tapSel('.modal-card .actions .btn.primary');
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
  await A.tapSel('.modal-card .actions .btn.primary'); // Reprendre
  check('retour de l’hôte : la partie reprend', await B.until(() => document.querySelector('#coop-wait').classList.contains('hidden')));
  // l'hôte ne donne plus de nouvelles (réseau coupé) : l'invité l'attend
  await A.ev(() => {
    window.__mute = window.__session.broadcastSnapshot;
    window.__session.broadcastSnapshot = () => {};
  });
  check('hôte sans nouvelles : « En attente de l’hôte… »', await B.until(() => /En attente de l’hôte/.test(document.querySelector('#coop-wait').textContent) && !document.querySelector('#coop-wait').classList.contains('hidden'), null, 6000));
  check('invité bloqué pendant l’attente (aucune commande)', await B.ev(() => window.__input.inspect === true));
  await A.ev(() => (window.__session.broadcastSnapshot = window.__mute));
  check('les nouvelles reviennent : le bandeau disparaît', await B.until(() => document.querySelector('#coop-wait').classList.contains('hidden')));
  await A.page.waitForTimeout(700);
  await A.shot('partie-a-2-hote');
  await B.shot('partie-a-2-invite');

  console.log('Invité qui recharge la page');
  const before = (await gameOf(A)).towers.length;
  await B.page.reload({ waitUntil: 'networkidle' });
  check('B revient dans la partie après rechargement', await B.until(() => window.__state.screen === 'game' && window.__state.coopRole === 'guest', null, 12000), JSON.stringify(await lobby(B)));
  check('B retrouve les lanternes et son or', await B.until(([n, g]) => window.__state.game.towers.length === n && Math.floor(window.__state.game.players[1].gold) === g, [before, (await gameOf(A)).gold[1]]));
  check('A voit B présent (pas « absent »)', await A.until(() => !document.querySelector('#coop-roster .coop-mate.off')));

  console.log('Coupures du réseau');
  const recv = () => B.ev(() => window.__coop.client?.received ?? 0);
  await B.ev(() => window.__session.client.ws.close());
  let r0 = await recv();
  check('connexion de l’invité coupée : il revient seul, même partie', (await B.until(() => window.__session.online && window.__state.coopRole === 'guest', null, 10000)) && (await B.until((r) => (window.__coop.client?.received ?? 0) > r + 4, r0)));
  await A.ev(() => window.__session.client.ws.close());
  check('connexion de l’hôte coupée : il se reconnecte, salon intact', await A.until(() => window.__session.online && window.__session.lobby.players.length === 2, null, 10000));
  r0 = await recv();
  check('l’invité retrouve l’hôte et la partie continue', (await B.until((r) => (window.__coop.client?.received ?? 0) > r + 4 && window.__state.screen === 'game', r0, 15000)) && !(await B.visible('#modal:not(.hidden)')));

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
  await H.tapSel('.lobby-fold');
  await H.tapSel('.lobby-el[data-el="earth"]');
  // l'hôte joue d'abord seul : un ami qui arrive attendra la partie suivante
  await H.ev(() => window.__startLevel('1-1'));
  await H.until(() => window.__state.screen === 'game' && !window.__state.coopRole);
  const early = await new Player('P2').open(url(`&salon=${code4}`));
  check('arrivée pendant une partie seul : acceptée', await early.until(() => window.__session.role === 'guest' && window.__session.online, null, 10000));
  check('l’arrivant sait que l’hôte joue seul', await early.until(() => /seul/.test(document.querySelector('#title-wait').textContent)), await early.ev(() => document.querySelector('#title-wait').textContent));
  check('l’hôte est prévenu en jeu', await H.until(() => /rejoint votre salon/.test(document.querySelector('#toast')?.textContent || '')));
  await H.tapSel('#btn-pause');
  await H.page.locator('.modal-card .actions .btn', { hasText: 'Carte' }).click();
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
    // (un élément libre est proposé à l'arrivée ; toucher l'élément déjà choisi le retirerait)
    if ((await p.ev((el) => document.querySelector(`.lobby-el[data-el="${el}"]`).getAttribute('aria-checked'), el)) !== 'true') await p.tapSel(`.lobby-el[data-el="${el}"]`);
    await p.until((el) => window.__session.lobby.players.find((x) => x.id === window.__session.id)?.element === el, el, 4000);
    G.push(p);
  }
  check('l’hôte voit 4 joueurs, 4 éléments différents', await H.until(() => window.__session.lobby.players.length === 4 && new Set(window.__session.lobby.players.map((p) => p.element)).size === 4), JSON.stringify((await lobby(H)).players));
  const P5 = await new Player('P5').open();
  await P5.until(() => window.__session?.online);
  await P5.ev((c) => window.__lobby.join(c), code4);
  check('5e joueur : salon complet', await P5.until(() => /complet/.test(document.querySelector('.lobby-error')?.textContent || ''), null, 10000) && (await lobby(P5)).role === 'host');
  await P5.close();
  await H.page.waitForTimeout(300);
  await H.shot('salon-a-4');
  await G[0].shot('salon-a-4-invite');
  await H.tapSel('#btn-play');
  await H.until(() => window.__state.screen === 'map');
  await H.page.waitForTimeout(400);
  await H.tapSel(`.map-node >> nth=${LEVEL_INDEX}`);
  await H.until(() => /Partie à 4/.test(document.querySelector('.modal-card')?.textContent || ''));
  await H.tapSel('.modal-card .actions .btn.primary');
  let all = true;
  for (const p of G) all = (await p.until(() => window.__state.screen === 'game' && window.__state.coopRole === 'guest')) && all;
  check('les trois invités entrent dans la partie', all);
  for (const p of G) {
    const g = await gameOf(p);
    const els = new Set(await p.ev(() => window.__state.game.availableTowers.map((t) => window.__state.game.defs.towers[t].element)));
    check(`${p.tag} : une seule famille d’éléments, ${g.local + 1}e joueur`, els.size === 1, JSON.stringify([...els]));
  }
  check('rangée des coéquipiers : 3 chez chacun', (await H.ev(() => document.querySelectorAll('#coop-roster .coop-mate').length)) === 3);
  const placed = [];
  for (const p of G) {
    const g = await gameOf(p);
    const type = g.avail[0];
    const s = await placeBy(p, type, 1);
    placed.push(s);
  }
  let seen = true;
  for (const p of [H, ...G]) seen = (await p.until((list) => list.every((s) => s && window.__state.game.towerAt(s[0], s[1])), placed)) && seen;
  check('les poses des trois invités sont visibles chez les quatre', seen);
  await H.page.waitForTimeout(300);
  await H.shot('partie-a-4-hote');
  await G[1].shot('partie-a-4-invite');

  console.log('Fin de partie');
  // l'hôte saute à la fin (dernière vague lancée, plus aucun yokai) : victoire
  await H.ev(() => {
    const g = window.__state.game;
    while (g.startNextWave(0, false));
    for (const s of g.spawners) s.spawned = s.count;
    g.enemies = [];
  });
  check('victoire chez l’hôte', await H.until(() => /Victoire/.test(document.querySelector('.modal-card')?.textContent || ''), null, 8000));
  check('hôte : « Salon », « Rejouer », « Suivant »', /Salon.*Rejouer.*Suivant/.test(await H.ev(() => document.querySelector('.modal-card .actions').textContent)));
  let wins = true;
  for (const p of G) wins = (await p.until(() => /Victoire/.test(document.querySelector('.modal-card')?.textContent || '') && !!document.querySelector('.modal-card .actions .btn.primary'), null, 8000)) && wins;
  check('chaque invité voit la victoire', wins);
  let starsOk = true;
  for (const p of G) starsOk = (await p.ev((id) => window.__save.level(id).stars > 0, LEVEL)) && starsOk;
  check('étoiles enregistrées chez chacun', starsOk);
  check('invité : « Retour au salon »', /Retour au salon/.test(await G[0].ev(() => document.querySelector('.modal-card .actions').textContent)));
  await G[0].page.waitForTimeout(1600); // étoiles qui s'allument une à une
  await G[0].shot('victoire-invite');
  await G[0].tapSel('.modal-card .actions .btn.primary');
  check('retour au salon de l’hôte', await G[0].until(() => window.__state.screen === 'title' && window.__session.role === 'guest'));
  // l'hôte relance : tous repartent, même celui revenu au salon
  await H.tapSel('.modal-card .actions .btn:not(.primary):not(.dark)'); // Rejouer
  all = true;
  for (const p of G) all = (await p.until(() => window.__state.screen === 'game' && window.__state.coopRole === 'guest' && !window.__state.resultShown, null, 8000)) && all;
  check('« Rejouer » de l’hôte : nouvelle partie pour tous', all);
  // défaite : chacun la voit ; « Réessayer » de l'hôte relance pour tous
  await H.ev(() => window.__state.game.lose());
  let lost = true;
  for (const p of G) lost = (await p.until(() => /Le sanctuaire est tombé/.test(document.querySelector('.modal-card')?.textContent || ''), null, 8000)) && lost;
  check('défaite : chaque invité la voit', lost);
  await H.until(() => /Le sanctuaire est tombé/.test(document.querySelector('.modal-card')?.textContent || ''));
  await H.tapSel('.modal-card .actions .btn.primary'); // Réessayer
  all = true;
  for (const p of G) all = (await p.until(() => window.__state.screen === 'game' && !window.__state.resultShown && document.querySelector('#modal').classList.contains('hidden'), null, 8000)) && all;
  check('« Réessayer » de l’hôte : tous repartent', all);
  // l'hôte retourne à la carte : la partie s'arrête pour tous
  await H.tapSel('#btn-pause');
  await H.page.locator('.modal-card .actions .btn', { hasText: 'Carte' }).click();
  let ended = true;
  for (const p of G) ended = (await p.until(() => /mis fin à la partie/.test(document.querySelector('.modal-card')?.textContent || ''), null, 8000)) && ended;
  check('l’hôte quitte la partie : « L’hôte a mis fin à la partie »', ended);
} catch (e) {
  failures++;
  console.log(`  ✗ exception : ${e.message}`);
}

check('aucune erreur console', errors.length === 0, '\n    ' + errors.slice(0, 12).join('\n    '));
for (const p of players) await p.close();
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests multijoueur passent');
process.exit(failures ? 1 : 0);
