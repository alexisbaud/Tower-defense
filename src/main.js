// Point d'entrée : navigation entre écrans, boucle à pas de temps fixe,
// liaison moteur / rendu / interface / audio / sauvegarde.
import { Game, STEP } from './core/game.js';
import { defs, loadLevel, worldById, worlds, levelOrder } from './data.js';
import { Renderer } from './render/renderer.js';
import { drawEnemy } from './render/enemies.js';
import { Input } from './ui/input.js';
import { Hud } from './ui/hud.js';
import { RewindGauge } from './ui/rewind.js';
import { Tutorial } from './ui/tutorial.js';
import { TitleScreen, MapScreen } from './ui/screens.js';
import { sound } from './audio/sound.js';
import { save } from './save.js';

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const stage = $('stage');
const screenGame = $('screen-game');
const order = levelOrder();

const renderer = new Renderer(canvas);
const state = {
  screen: 'title',
  game: null,
  levelId: null,
  paused: false,
  speed: 1,
  acc: 0,
  last: performance.now(),
  introduced: new Set(),
  introTimer: 0,
  resultShown: false,
  loopRunning: false,
};

// ───────────────────────── Son ─────────────────────────

sound.muted = save.data.muted;
sound.musicOn = save.data.music;
document.addEventListener(
  'pointerdown',
  () => {
    sound.unlock();
    sound.play('tap');
  },
  true,
);

function setMuted(m) {
  save.set('muted', m);
  sound.setMuted(m);
  for (const id of ['btn-mute', 'btn-title-sound']) $(id).classList.toggle('off', m);
}
setMuted(save.data.muted);

// ───────────────────────── Écrans ─────────────────────────

const title = new TitleScreen($('screen-title'));
const map = new MapScreen($('screen-map'), (entry, unlocked) => openLevelCard(entry, unlocked));

function showScreen(name) {
  state.screen = name;
  title.hide();
  map.hide();
  screenGame.classList.toggle('active', name === 'game');
  if (name === 'title') title.show();
  if (name === 'map') {
    map.show(order, worlds, save);
    $('map-stars').textContent = `${save.totalStars()}/${order.length * 3}`;
  }
  if (name !== 'game') {
    state.game = null;
    sound.intensity = 0;
  }
}

$('btn-play').addEventListener('click', () => showScreen('map'));
$('btn-title-sound').addEventListener('click', () => setMuted(!save.data.muted));
$('btn-map-back').addEventListener('click', () => showScreen('title'));
if (window.navigator.standalone) $('title-foot').textContent = 'Version hors ligne prête';

async function openLevelCard(entry, unlocked) {
  if (!unlocked) {
    showModal(
      `<div class="modal-kanji">封</div><h2>Niveau scellé</h2><p>Terminez le niveau précédent pour briser le sceau.</p>`,
      [{ label: 'Fermer' }],
    );
    return;
  }
  const level = await loadLevel(entry.id);
  const world = worldById(level.world);
  const stars = save.stars(entry.id);
  const towers = (level.towers || Object.keys(defs.towers))
    .map((t) => `<span class="seal" style="background:${defs.towers[t].color}">${defs.towers[t].kanji}</span>`)
    .join(' ');
  const news = (level.introduce || []).map((e) => defs.enemies[e]?.name).filter(Boolean);
  const feats = [level.stones ? '石 Pierres' : null, level.rewind ? '巻 Rembobinage' : null].filter(Boolean);
  showModal(
    `<div class="modal-kanji">${world.kanji}</div>
     <h2>${entry.index + 1}. ${level.name}</h2>
     <p>${level.subtitle || ''}</p>
     <div class="result-stars small">${[0, 1, 2].map((k) => `<i class="show ${k < stars ? 'on' : ''}">★</i>`).join('')}</div>
     <p>${towers}</p>
     ${news.length ? `<p><b>Nouveau :</b> ${news.join(', ')}</p>` : ''}
     ${feats.length ? `<p>${feats.join(' · ')}</p>` : ''}`,
    [
      { label: 'Retour' },
      { label: 'Jouer', cls: 'primary', run: () => startLevel(entry.id) },
    ],
  );
}

// ───────────────────────── Fenêtre modale ─────────────────────────

const modal = $('modal');
function showModal(html, buttons, opts = {}) {
  const card = modal.firstElementChild;
  card.innerHTML = html + `<div class="actions${opts.column ? ' col' : ''}"></div>`;
  const box = card.querySelector('.actions');
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls || '');
    el.textContent = b.label;
    el.addEventListener('click', () => {
      if (b.keep !== true) modal.classList.add('hidden');
      b.run?.(el);
    });
    box.appendChild(el);
  }
  modal.classList.remove('hidden');
  return card;
}
const modalOpen = () => !modal.classList.contains('hidden');

// ───────────────────────── Partie ─────────────────────────

const input = new Input(canvas, renderer, {
  game: () => state.game,
  onInfo: (target) => showInfo(target),
  onFeedback: (kind, data) => {
    if (kind === 'reject' || kind === 'hint') {
      const msg = hud.reason(data.reason);
      if (msg) hud.toast(msg, kind === 'reject');
      if (kind === 'reject') sound.play('reject');
    }
  },
  onAction: (kind) => {
    if (kind === 'selectTower' || kind === 'dragStart') sound.play('select');
  },
});

const hud = new Hud(screenGame, {
  onWave: () => state.game?.startNextWave(),
  onPause: () => openPauseMenu(),
  onSpeed: () => setSpeed(state.speed === 1 ? 2 : 1),
  onMute: () => setMuted(!save.data.muted),
  onTool: () => sound.play('select'),
});

function setSpeed(s) {
  state.speed = s;
  const b = $('btn-speed');
  b.firstElementChild.textContent = `×${s}`;
  b.classList.toggle('on', s === 2);
}

const gauge = new RewindGauge($('rewind'), {
  game: () => state.game,
  onRewind: () => state.game?.rewind(),
  onRefuse: (why) => {
    const msg = {
      used: 'Rembobinage déjà utilisé pour cette vague',
      wave: 'Le Rembobinage s’utilise pendant une vague',
      short: 'Le passé s’accumule encore…',
    }[why];
    if (msg) hud.toast(msg, true);
    sound.play('reject');
  },
});

const tutorial = new Tutorial($('hint'), {
  game: () => state.game,
  input,
  renderer,
  canvas,
  hud,
  gauge,
  pause: (p) => setPaused(p),
  modal: (html, buttons) => {
    save.set('rewindTutorialSeen', true);
    return showModal(html, buttons);
  },
});

function setPaused(p) {
  state.paused = p;
  $('btn-pause').classList.toggle('on', p);
  input.enabled = !p;
  if (p) input.cancel();
}

function openPauseMenu() {
  if (!state.game || state.resultShown) return;
  setPaused(true);
  const musicLabel = () => `Musique : ${save.data.music ? 'oui' : 'non'}`;
  const soundLabel = () => `Son : ${save.data.muted ? 'coupé' : 'actif'}`;
  showModal(
    `<div class="modal-kanji">休</div><h2>Pause</h2><p>${state.game.level.name} — vague ${Math.max(0, state.game.waveIndex + 1)}/${state.game.totalWaves}</p>`,
    [
      { label: 'Reprendre', cls: 'primary', run: () => setPaused(false) },
      {
        label: soundLabel(),
        keep: true,
        run: (el) => {
          setMuted(!save.data.muted);
          el.textContent = soundLabel();
        },
      },
      {
        label: musicLabel(),
        keep: true,
        run: (el) => {
          save.set('music', !save.data.music);
          sound.musicOn = save.data.music;
          el.textContent = musicLabel();
        },
      },
      { label: 'Recommencer', run: () => startLevel(state.levelId) },
      { label: 'Carte du jardin', cls: 'dark', run: () => showScreen('map') },
    ],
    { column: true },
  );
}

function showInfo(target) {
  const g = state.game;
  sound.play('select');
  if (target.kind === 'tower') {
    const t = target.tower;
    const def = g.defs.towers[t.type];
    const st = g.towerStats(t);
    const combos = g.zones
      .filter((z) => z.a === t.id || z.b === t.id)
      .map((z) => `<span>${z.def.kanji} ${z.def.name}</span>`)
      .join(', ');
    const extra = [];
    if (st.burn) extra.push(`Brûlure ${st.burn.dps}/s`);
    if (st.slow) extra.push(`Ralentit ${Math.round((1 - st.slow.factor) * 100)} %`);
    if (st.knockback) extra.push(`Recul ${st.knockback}`);
    if (st.splash) extra.push(`Zone ${st.splash}`);
    if (st.pierce) extra.push('Perce l’armure');
    if (st.stun) extra.push(`Étourdit ${st.stun} s`);
    const next = t.level < g.rules.maxTowerLevel ? 'Glissez-la sur une lanterne identique pour la fusionner.' : 'Niveau maximum atteint.';
    hud.showInfo(
      `<h3>${def.kanji} ${def.name} · N${t.level}</h3>
       <div class="sub">${def.role} — ${def.desc}</div>
       <div class="rows">
         <span>Dégâts <b>${st.damage}</b></span><span>Cadence <b>${st.rate}/s</b></span>
         <span>Portée <b>${st.range}</b></span><span>Investi <b>${t.invested}</b></span>
         ${extra.length ? `<span style="grid-column:1/-1">${extra.join(' · ')}</span>` : ''}
         ${combos ? `<span style="grid-column:1/-1">Combos : ${combos}</span>` : ''}
         <span style="grid-column:1/-1;opacity:.7">${next}</span>
       </div>`,
      [
        { label: `Vendre +${g.sellValue(t)}`, cls: 'primary', run: () => g.sellTower(t.id) },
        { label: 'Fermer', run: () => (input.ui.selectedTower = null) },
      ],
    );
  } else if (target.kind === 'stone') {
    const refund = Math.floor(g.stoneCost() * g.rules.stoneRefund);
    hud.showInfo(
      `<h3>石 Pierre</h3>
       <div class="sub">Elle détourne les yokai terrestres. Pierres restantes : ${g.stonesLeft()}</div>`,
      [
        { label: `Retirer +${refund}`, cls: 'primary', run: () => g.removeStone(target.c, target.r) },
        { label: 'Fermer' },
      ],
    );
  }
}

// Carte de présentation d'un yokai à sa première apparition.
const introEl = $('intro');
function showIntro(type) {
  const def = defs.enemies[type];
  introEl.innerHTML = `<canvas width="192" height="192"></canvas><div class="intro-text"><div class="intro-tag">${def.boss ? 'Boss' : 'Nouveau yokai'}</div><h4>${def.name}</h4><p>${def.desc}</p></div>`;
  const ctx = introEl.querySelector('canvas').getContext('2d');
  const fake = {
    type,
    seed: 0.3,
    size: def.size,
    dirX: 1,
    hp: 1,
    maxHp: 1,
    spawnT: 0,
    hitT: 0,
    slowT: 0,
    burnT: 0,
    flying: !!def.abilities?.flying,
    absorb: def.abilities?.absorb ?? def.abilities?.cycleAbsorb?.elements[0] ?? null,
  };
  drawEnemy(ctx, fake, def, 96, fake.flying ? 120 : 108, 192 / (def.size * 3.6), 0.5);
  introEl.classList.remove('hidden');
  clearTimeout(state.introTimer);
  state.introTimer = setTimeout(() => introEl.classList.add('hidden'), 5500);
}
introEl.addEventListener('click', () => introEl.classList.add('hidden'));

const bossbar = $('bossbar');
const bossFill = bossbar.querySelector('.boss-fill');
const bossName = bossbar.querySelector('.boss-name');
let bossShown = null;
function updateBossBar(g) {
  const boss = g.enemies.find((e) => e.boss && e.alive);
  if (!boss) {
    if (bossShown) bossbar.classList.add('hidden');
    bossShown = null;
    return;
  }
  if (bossShown !== boss.id) {
    bossName.textContent = defs.enemies[boss.type].name;
    bossbar.classList.remove('hidden');
    bossShown = boss.id;
  }
  bossFill.style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100).toFixed(1)}%`;
}

async function startLevel(id) {
  const level = await loadLevel(id);
  const world = worldById(level.world);
  modal.classList.add('hidden');
  showScreen('game');
  state.levelId = id;
  state.game = new Game(level, defs, { seed: 1 });
  state.acc = 0;
  state.resultShown = false;
  setPaused(false);
  input.reset();
  resize();
  renderer.setGame(state.game, world.theme);
  hud.setup(state.game, input);
  const idx = order.findIndex((o) => o.id === id);
  hud.banner(level.name, `${world.name} · ${idx + 1}/${order.length}`);
  state.introduced = new Set();
  introEl.classList.add('hidden');
  bossbar.classList.add('hidden');
  bossShown = null;
  tutorial.start(state.game);
  if (save.data.rewindTutorialSeen && tutorial.rewindPhase === 1) tutorial.rewindPhase = 2;
  gauge.update();
  sound.intensity = 0;
  if (!state.loopRunning) {
    state.loopRunning = true;
    state.last = performance.now();
    requestAnimationFrame(frame);
  }
}

function showResult(won) {
  const g = state.game;
  state.resultShown = true;
  setPaused(true);
  const idx = order.findIndex((o) => o.id === state.levelId);
  if (won) {
    const stars = g.stars();
    const record = save.record(state.levelId, stars);
    const next = order[idx + 1];
    const card = showModal(
      `<div class="modal-kanji">勝</div><h2>Victoire !</h2>
       <div class="result-stars">${[0, 1, 2].map((k) => `<i class="${k < stars ? 'on' : ''}">★</i>`).join('')}</div>
       <div class="result-stats">
         <span>Vies : <b>${g.lives}/${g.maxLives}</b></span><span>Yokai apaisés : <b>${g.stats.kills}</b></span>
         <span>Lanternes : <b>${g.stats.towersBuilt}</b></span><span>${record ? '<b style="color:var(--vermillion)">Nouveau record</b>' : ''}</span>
       </div>
       ${!next ? '<p>Le sanctuaire est sauvé. Les esprits retrouvent la paix.</p>' : ''}`,
      [
        { label: 'Carte', cls: 'dark', run: () => showScreen('map') },
        { label: 'Rejouer', run: () => startLevel(state.levelId) },
        ...(next ? [{ label: 'Suivant', cls: 'primary', run: () => startLevel(next.id) }] : []),
      ],
    );
    const is = card.querySelectorAll('.result-stars i');
    is.forEach((el, k) =>
      setTimeout(() => {
        el.classList.add('show');
        if (k < stars) sound.play('star', { i: k });
      }, 350 + k * 380),
    );
  } else {
    showModal(
      `<div class="modal-kanji">敗</div><h2>Le sanctuaire est tombé</h2>
       <p>Vague ${g.waveIndex + 1}/${g.totalWaves}. Essayez d'autres combos, ou rembobinez au bon moment.</p>`,
      [
        { label: 'Carte', cls: 'dark', run: () => showScreen('map') },
        { label: 'Réessayer', cls: 'primary', run: () => startLevel(state.levelId) },
      ],
    );
  }
}

// Gestion des événements moteur côté présentation.
function handleEvents(game) {
  const evs = game.events;
  if (!evs.length) return;
  renderer.onEvents(evs);
  for (const ev of evs) {
    sound.onEvent(ev);
    tutorial.onEvent(ev);
    switch (ev.type) {
      case 'spawn':
      case 'spawnChild': {
        const type = ev.enemy.type;
        if ((game.level.introduce || []).includes(type) && !state.introduced.has(type)) {
          state.introduced.add(type);
          showIntro(type);
        }
        break;
      }
      case 'waveStart':
        hud.banner(`Vague ${ev.index + 1}`, ev.index === ev.total - 1 ? 'Dernière vague' : '');
        break;
      case 'earlyBonus':
        hud.toast(`Appel anticipé +${ev.gold} or`);
        break;
      case 'stomp':
        renderer.fx.addShake(0.9);
        break;
      case 'enrage':
        hud.toast(`${defs.enemies[ev.enemy.type].name} entre en rage !`, true);
        break;
      case 'win':
        hud.banner('Victoire', '★'.repeat(ev.stars) + '☆'.repeat(3 - ev.stars));
        setTimeout(() => state.game === game && showResult(true), 1400);
        break;
      case 'lose':
        hud.banner('Défaite', 'Le sanctuaire est tombé');
        setTimeout(() => state.game === game && showResult(false), 1400);
        break;
      default:
        break;
    }
  }
  evs.length = 0;
}

function resize() {
  const r = stage.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) renderer.resize(r.width, r.height);
  title.resize();
  map.resize();
}

// Qualité adaptative : si l'appareil n'atteint pas ~45 fps pendant quelques
// secondes, on réduit la résolution du canvas (3x → 2x → 1.5x).
const perf = { acc: 0, n: 0 };
function adaptQuality(rawDt) {
  if (state.paused || document.hidden) return;
  perf.acc += rawDt;
  perf.n++;
  if (perf.n < 150) return;
  const avg = perf.acc / perf.n;
  perf.acc = 0;
  perf.n = 0;
  if (avg > 1 / 45 && renderer.maxDpr > 1.5 && (window.devicePixelRatio || 1) > 1.5) {
    renderer.maxDpr = renderer.maxDpr > 2 ? 2 : 1.5;
    resize();
  }
}

function frame(now) {
  const raw = (now - state.last) / 1000;
  const dt = Math.min(0.1, raw);
  state.last = now;
  const g = state.game;
  if (g && state.screen === 'game') {
    if (raw < 0.25) adaptQuality(raw);
    if (!state.paused) {
      state.acc += dt * state.speed;
      let steps = 0;
      while (state.acc >= STEP && steps < 8) {
        g.update(STEP);
        state.acc -= STEP;
        steps++;
      }
      if (steps >= 8) state.acc = 0;
    }
    handleEvents(g);
    hud.update();
    gauge.update();
    updateBossBar(g);
    tutorial.update(state.paused || modalOpen());
    renderer.render(state.paused ? 0 : dt, state.paused ? 1 : state.acc / STEP, input.ui);
  }
  requestAnimationFrame(frame);
}

// ───────────────────────── Contraintes iOS ─────────────────────────

// Empêche le zoom par pincement / double-tap et le défilement.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 300 && !e.target.closest?.('button')) e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false },
);

// Pause automatique en arrière-plan.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (state.game && state.screen === 'game' && !state.paused && !state.resultShown) openPauseMenu();
    sound.suspend();
  } else {
    sound.resume();
  }
});
window.addEventListener('pagehide', () => sound.suspend());

window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(document.getElementById('app'));

// Hors ligne : service worker.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Accès de débogage (QA automatisée).
window.__renderer = renderer;
window.__state = state;
window.__tutorial = tutorial;
window.__startLevel = startLevel;

// Démarrage : ?level=<id> lance directement un niveau (tests), sinon l'écran titre.
const direct = new URLSearchParams(location.search).get('level');
if (direct) startLevel(direct);
else showScreen('title');
resize();
