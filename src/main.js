// Point d'entrée : navigation entre écrans, boucle à pas de temps fixe,
// liaison moteur / rendu / interface / audio / sauvegarde.
import { Game, STEP } from './core/game.js';
import { defs, loadLevel, worldById, worlds, levelOrder } from './data.js';
import { Renderer } from './render/renderer.js';
import { PALETTE } from './render/brush.js';
import { Input } from './ui/input.js';
import { Hud } from './ui/hud.js';
import { RewindGauge } from './ui/rewind.js';
import { Tutorial } from './ui/tutorial.js';
import { TitleScreen, MapScreen } from './ui/screens.js';
import { Sheets, comboTable, comboDetail } from './ui/sheets.js';
import { TowerBar, cyclePriority, priorityInfo } from './ui/towerbar.js';
import { enemyPortrait } from './ui/portraits.js';
import { elementBadge } from './ui/elements.js';
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
let musicHold = null; // état musical mis de côté pendant une pause (voir holdMusic)
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
  for (const id of ['btn-mute', 'btn-title-sound']) $(id)?.classList.toggle('off', m);
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
    $('map-stars').textContent = `${save.totalStars(order)}/${order.length * 3}`;
  }
  if (name !== 'game') {
    state.game = null;
    musicHold = null;
    sound.intensity = 0;
  }
}

$('btn-play').addEventListener('click', () => showScreen('map'));
$('btn-title-sound').addEventListener('click', () => setMuted(!save.data.muted));
$('btn-map-back').addEventListener('click', () => showScreen('title'));
if (window.navigator.standalone) $('title-foot').textContent = 'Version hors ligne prête';

// Charge un niveau ; s'il est introuvable (hors ligne et jamais mis en cache),
// le dit au joueur au lieu d'ignorer le toucher.
async function fetchLevel(id) {
  try {
    return await loadLevel(id);
  } catch {
    showModal(
      `<div class="modal-kanji">封</div><h2>Niveau indisponible</h2><p>Ce niveau n’est pas encore enregistré pour le jeu hors ligne. Ouvrez le jeu une fois connecté pour le télécharger.</p>`,
      [{ label: 'Carte du jardin', run: () => showScreen('map') }],
    );
    return null;
  }
}

async function openLevelCard(entry, unlocked) {
  if (!unlocked) {
    showModal(
      `<div class="modal-kanji">封</div><h2>Niveau scellé</h2><p>Terminez le niveau précédent pour briser le sceau.</p>`,
      [{ label: 'Fermer' }],
    );
    return;
  }
  const level = await fetchLevel(entry.id);
  if (!level) return;
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
// opts.sheet : feuille du bas sans voile (pause) — le plateau reste visible et touchable.
function showModal(html, buttons, opts = {}) {
  const card = modal.firstElementChild;
  modal.classList.toggle('as-sheet', !!opts.sheet);
  modal.classList.remove('peek');
  card.className = `modal-card${opts.cls ? ' ' + opts.cls : ''}`;
  card.innerHTML = html + `<div class="actions${opts.column ? ' col' : ''}${opts.actionsCls ? ' ' + opts.actionsCls : ''}"></div>`;
  const box = card.querySelector('.actions');
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls || '');
    el.textContent = b.label;
    if (b.aria) el.setAttribute('aria-label', b.aria);
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
const pauseSheetOpen = () => modalOpen() && modal.classList.contains('as-sheet');

// ───────────────────────── Partie ─────────────────────────

const input = new Input(canvas, renderer, {
  game: () => state.game,
  onInfo: (target) => showInfo(target),
  onFeedback: (kind, data) => feedback(kind, data),
  onAction: (kind, data) => {
    if (kind === 'selectTower' || kind === 'dragStart') sound.play('select');
    if (kind === 'placed') {
      hud.showUndo(data.tower);
      hud.popTool(data.type);
    }
    if (kind === 'stone') hud.popTool('stone');
    if (kind === 'placed' || kind === 'toolCleared' || kind === 'selectTower' || kind === 'stone') hud.refreshTools();
  },
  onHold: (st, p, ms) => holdRing(st, p, ms),
  // Un toucher sur le plateau ferme la fiche ouverte.
  onBoardTouch: () => sheets.close(),
});

// Retours d'un geste : refus écrit près du fantôme (plus de toast sur les portails),
// « Annulé » discret, son de refus.
function feedback(kind, data = {}) {
  if (kind === 'reject') {
    const short = data.reason === 'gold' && data.missing ? `Il manque ${data.missing} or` : hud.shortReason(data.reason);
    if (data.x != null && short) input.flash(short, data.x, data.y, true);
    else if (hud.reason(data.reason)) hud.toast(hud.reason(data.reason), true);
    sound.play('reject');
  } else if (kind === 'cancel' || kind === 'dropCancel') {
    if (data.x != null) input.flash('Annulé', data.x, data.y);
    sound.play('tap');
  } else if (kind === 'stoneBlocked') {
    sound.play('reject');
  } else if (kind === 'hint') {
    const msg = hud.reason(data.reason);
    if (msg) hud.toast(msg);
  }
}

// Libellé écrit à côté du fantôme de pose (raison du refus, gain de chemin).
renderer.pressLabel = (press) => {
  if (press.c == null) return null;
  if (press.kind === 'tower') {
    if (press.valid) return null;
    if (press.reason === 'gold') return { text: `Il manque ${press.missing} or`, tone: 'bad' };
    return { text: hud.shortReason(press.reason) || 'Impossible', tone: 'bad' };
  }
  if (press.reason === 'blocked') return { text: 'Bloqué !', tone: 'bad' };
  if (press.reason === 'occupied') return { text: 'Déjà une pierre', tone: 'muted' };
  const gain = press.delta > 0 ? `+${press.delta} case${press.delta > 1 ? 's' : ''}` : 'Sans effet';
  if (press.valid) return { text: gain, tone: press.delta > 0 ? 'ok' : 'muted' };
  if (press.reason === 'gold') return { text: `${gain} · il manque ${press.missing} or`, tone: 'bad' };
  return { text: hud.shortReason(press.reason) || 'Impossible', tone: 'bad' };
};

// Anneau (ensō) qui se remplit sous le doigt pendant un appui long.
const holdEl = $('hold');
function holdRing(st, p, ms) {
  if (st === 'start' && p) {
    const r = screenGame.getBoundingClientRect();
    holdEl.style.left = `${p.x - r.left}px`;
    holdEl.style.top = `${p.y - r.top}px`;
    holdEl.style.setProperty('--hold-ms', `${Math.max(60, ms || 300)}ms`);
    holdEl.classList.remove('hidden', 'run');
    void holdEl.offsetWidth;
    holdEl.classList.add('run');
  } else {
    holdEl.classList.add('hidden');
    holdEl.classList.remove('run');
  }
}

// Préférence « réduire les animations » : pas de tremblement d'écran.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
input.ui.reducedMotion = reduceMotion.matches;
reduceMotion.addEventListener?.('change', () => (input.ui.reducedMotion = reduceMotion.matches));

const hud = new Hud(screenGame, {
  onWave: () => callWave(),
  onPause: () => (pauseSheetOpen() && state.paused && !state.resultShown ? resumeFromPause() : openPauseMenu()),
  onSpeed: () => {
    setSpeed(state.speed === 1 ? 2 : 1);
    sound.play('select');
  },
  onTool: () => sound.play('select'),
  onToolInfo: (id) => (id === 'stone' ? sheets.open('stoneTool') : sheets.open('type', id)),
  onUndo: (id) => undoPlace(id),
  onHold: (st, p, ms) => holdRing(st, p, ms),
  onEnemyInfo: (type, absorb) => sheets.open('enemy', { type, absorb }),
  onWaveInfo: () => sheets.open('wave'),
});

// Bouton de vague : lancer (construction) ou appeler en avance (si le moteur le permet).
function callWave() {
  const g = state.game;
  if (!g || g.rewindAnim) return;
  let ok = false;
  if (g.state === 'build') ok = g.startNextWave();
  else if (typeof g.canCallNextWave === 'function' && g.canCallNextWave()) ok = (g.callNextWave || g.startNextWave).call(g);
  if (ok !== false) hud.popWave();
}

function undoPlace(id) {
  const g = state.game;
  if (!g) return;
  const t = g.towerById(id);
  if (t && g.undoPlace && g.undoPlace(id)) {
    hud.hideUndo();
    hud.refreshTools();
    if (input.ui.selectedTower === id) input.ui.selectedTower = null;
  } else {
    hud.hideUndo();
    hud.toast('Trop tard pour annuler');
  }
}

// Barre d'actions de la lanterne sélectionnée.
const towerBar = new TowerBar($('tower-bar'), {
  game: () => state.game,
  input,
  renderer,
  onPriority: (t) => changePriority(t),
  onSheet: (t) => sheets.open('tower', t.id),
  onSell: (t) => sellTower(t),
});

function changePriority(t) {
  const g = state.game;
  const p = cyclePriority(g, t);
  sound.play('select');
  renderer.fx.ring(t.x, t.y + 0.3, 0.1, 0.62, PALETTE.gold, 0.45, 0.06, 0.45);
  const s = renderer.toScreen(t.x, t.y - 0.6);
  input.flash(`Cible : ${priorityInfo(p).label}`, s.x, s.y);
}

function sellTower(t) {
  const g = state.game;
  if (!g.towerById(t.id)) hud.toast('Cette lanterne n’existe plus', true);
  else g.sellTower(t.id);
  if (input.ui.selectedTower === t.id) input.ui.selectedTower = null;
}

// Fiches compactes (remplacent la barre du bas).
const sheets = new Sheets($('info'), {
  game: () => state.game,
  input,
  onOpen: (kind, data) => {
    input.ui.focusEnemy = kind === 'enemy' ? data?.enemy?.id ?? null : input.ui.focusEnemy;
    // En pause, la feuille de pause s'efface le temps de la fiche.
    if (pauseSheetOpen()) modal.classList.add('peek');
  },
  onClose: () => {
    input.ui.focusEnemy = null;
    modal.classList.remove('peek');
  },
  onSell: (t) => sellTower(t),
  onPriority: (t) => changePriority(t),
  onSelectTool: (type) => {
    if (input.ui.tool !== type) input.setTool(type);
    hud.refreshTools();
    hud.popTool(type);
    sound.play('select');
  },
  onRemoveStone: (c, r) => state.game?.removeStone(c, r),
  onCallWave: () => callWave(),
  onEnemy: (type, absorb) => sheets.open('enemy', { type, absorb }),
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
  // Simple indication (pas d'erreur rouge ni de son de refus) : la jauge réduite
  // dit quand elle servira.
  onRefuse: (why) => {
    const msg = {
      used: '巻 Déjà utilisé pour cette vague',
      wave: '巻 Pendant une vague : glissez ◀◀ pour remonter le temps',
      short: '巻 Le passé s’accumule encore…',
    }[why];
    if (msg) hud.toast(msg);
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
  // En pause, le plateau reste consultable (toucher, appui long), sans pose ni fusion.
  input.inspect = p;
  input.enabled = true;
  if (p) input.cancel();
  holdMusic(p);
}

function resumeFromPause() {
  modal.classList.add('hidden');
  sheets.close();
  setPaused(false);
}

// En pause, la musique retombe au calme (plus de tambours de vague), puis
// retrouve son état (vague, boss, dernière vague) à la reprise.
function holdMusic(p) {
  if (p && !musicHold) {
    musicHold = { intensity: sound.intensity, boss: sound.bossActive, final: sound.finalWave };
    sound.intensity = 0;
  } else if (!p && musicHold) {
    const h = musicHold;
    musicHold = null;
    if (!state.game || state.resultShown) return;
    sound.intensity = h.intensity;
    sound.bossActive = h.boss;
    sound.finalWave = h.final;
  }
}

// Pause : feuille du bas compacte, sans voile ; le plateau reste visible et on peut
// y toucher les lanternes et les yokai pour étudier la carte.
function openPauseMenu() {
  if (!state.game || state.resultShown) return;
  setPaused(true);
  sheets.close();
  const g = state.game;
  const musicLabel = () => `Musique : ${save.data.music ? 'oui' : 'non'}`;
  const soundLabel = () => `Son : ${save.data.muted ? 'non' : 'oui'}`;
  showModal(
    `<div class="pause-head"><span class="modal-kanji">休</span><div><h2>Pause</h2><p>${g.level.name} · vague ${Math.max(0, g.waveIndex + 1)}/${g.totalWaves}</p></div></div>
     <p class="pause-hint">Touchez une lanterne, ou appuyez longuement sur un yokai, pour l’étudier.</p>`,
    [
      { label: 'Reprendre', cls: 'primary', run: () => resumeFromPause() },
      { label: 'Combos', keep: true, aria: 'Table des combos', run: () => openComboTable() },
      { label: 'Carte', cls: 'dark', aria: 'Carte du jardin', run: () => showScreen('map') },
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
    ],
    { sheet: true, cls: 'pause-card', actionsCls: 'pause-grid' },
  );
}

// Table des combos : matrice des éléments (forme + kanji + libellé), nom de chaque
// combo ; la case touchée détaille son effet et contre quoi il sert.
function openComboTable() {
  const g = state.game;
  if (!g) return;
  const card = modal.firstElementChild;
  card.className = 'modal-card pause-card combos-card';
  card.innerHTML = `<div class="pause-head"><span class="modal-kanji">合</span><div><h2>Combos</h2><p>Deux éléments différents côte à côte</p></div></div>${comboTable(g.defs, g.availableTowers)}<div class="actions"><button class="btn" data-act="back">Retour</button></div>`;
  const detail = card.querySelector('.ct-detail');
  const select = (id) => {
    detail.innerHTML = comboDetail(g.defs, id);
    for (const c of card.querySelectorAll('.ct-cell[data-combo]')) c.classList.toggle('on', c.dataset.combo === id);
  };
  card.addEventListener('click', (e) => {
    const cell = e.target.closest('.ct-cell[data-combo]');
    if (cell) {
      select(cell.dataset.combo);
      sound.play('select');
    }
    if (e.target.closest('[data-act="back"]')) openPauseMenu();
  });
  const first = card.querySelector('.ct-cell[data-combo]');
  if (first) select(first.dataset.combo);
}

function showInfo(target, silent = false) {
  if (!silent) sound.play('select');
  if (target.kind === 'tower') {
    input.ui.selectedTower = target.tower.id;
    sheets.open('tower', target.tower.id);
  } else if (target.kind === 'enemy') {
    sheets.open('enemy', { type: target.enemy.type, enemy: target.enemy, absorb: target.enemy.absorb });
  } else if (target.kind === 'stone') {
    sheets.open('stone', { c: target.c, r: target.r });
  }
}

// Carte de présentation d'un yokai à sa première apparition : compacte, placée
// loin des portails, du sanctuaire et de la barre de boss ; un toucher ouvre sa fiche.
const introEl = $('intro');
function showIntro(type) {
  const def = defs.enemies[type];
  const absorb = def.abilities?.absorb ?? null;
  introEl.dataset.enemy = type;
  introEl.innerHTML = `<img alt="" src="${enemyPortrait(defs, type, absorb, 46)}"><div class="intro-text"><div class="intro-tag">${def.boss ? 'Boss' : 'Nouveau yokai'}${absorb ? ` ${elementBadge(absorb, defs, { size: 14, kanji: false })}` : ''}</div><h4>${def.name}</h4><p>${def.strength || def.desc}</p></div><span class="intro-more" aria-hidden="true">›</span>`;
  introEl.classList.remove('hidden');
  placeIntro();
  clearTimeout(state.introTimer);
  state.introTimer = setTimeout(() => introEl.classList.add('hidden'), 5500);
}

function placeIntro() {
  const g = state.game;
  if (!g) return;
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  const w = introEl.offsetWidth;
  const h = introEl.offsetHeight;
  const ts = renderer.ts;
  const avoid = [];
  for (const i of [...g.grid.spawns, ...g.grid.goals]) {
    const p = renderer.toScreen(g.grid.col(i), g.grid.row(i));
    avoid.push({ l: p.x - 6, t: p.y - 6, r: p.x + ts + 6, b: p.y + ts + 6 });
  }
  avoid.push({ l: W * 0.12, t: 0, r: W * 0.88, b: 34 }); // barre de boss
  const m = 8;
  const top = 40;
  const cands = [
    [m, H - h - m],
    [W - w - m, H - h - m],
    [m, top],
    [W - w - m, top],
    [m, (H - h) / 2],
    [W - w - m, (H - h) / 2],
  ];
  const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  let pos = cands[0];
  for (const [x, y] of cands) {
    if (!avoid.some((a) => hit(a, { l: x, t: y, r: x + w, b: y + h }))) {
      pos = [x, y];
      break;
    }
  }
  introEl.style.left = `${Math.round(pos[0])}px`;
  introEl.style.top = `${Math.round(pos[1])}px`;
}
introEl.addEventListener('click', () => {
  introEl.classList.add('hidden');
  const type = introEl.dataset.enemy;
  if (type && state.game) {
    const e = state.game.enemies.find((x) => x.type === type && x.alive);
    sheets.open('enemy', { type, enemy: e || null, absorb: e?.absorb });
  }
});

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
  const level = await fetchLevel(id);
  if (!level) return;
  const world = worldById(level.world);
  modal.classList.add('hidden');
  showScreen('game');
  state.levelId = id;
  state.game = new Game(level, defs, { seed: 1 });
  state.acc = 0;
  state.resultShown = false;
  setPaused(false);
  input.reset();
  renderer.game = null; // resize() ne refait pas le fond de l'ancien niveau : setGame s'en charge
  resize();
  renderer.setGame(state.game, world.theme);
  hud.setup(state.game, input);
  sheets.close();
  towerBar.hide();
  holdRing('end');
  const idx = order.findIndex((o) => o.id === id);
  hud.banner(level.name, `${world.name} · ${idx + 1}/${order.length}`);
  state.introduced = new Set();
  introEl.classList.add('hidden');
  bossbar.classList.add('hidden');
  bossShown = null;
  tutorial.start(state.game);
  if (save.data.rewindTutorialSeen && tutorial.rewindPhase === 1) tutorial.rewindPhase = 2;
  gauge.update();
  musicHold = null;
  sound.intensity = 0;
  sound.setWorld?.(world.id);
  pauseIfLandscape();
  if (!state.loopRunning) {
    state.loopRunning = true;
    state.last = performance.now();
    requestAnimationFrame(frame);
  }
}

// `record` : la victoire est déjà enregistrée à l'événement 'win' (voir handleEvents).
function showResult(won, record = false) {
  const g = state.game;
  state.resultShown = true;
  setPaused(true);
  sheets.close();
  input.ui.selectedTower = null;
  const idx = order.findIndex((o) => o.id === state.levelId);
  if (won) {
    const stars = g.stars();
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
      { cls: 'result result-win' },
    );
    const is = card.querySelectorAll('.result-stars i');
    is.forEach((el, k) =>
      setTimeout(() => {
        if (state.game !== g || !state.resultShown) return; // partie suivante déjà lancée (ou carte)
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
      { cls: 'result result-lose' },
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
    sheets.onEvent(ev);
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
        hud.banner(`Vague ${ev.index + 1}`, ev.index === ev.total - 1 ? 'Dernière vague' : game.waves?.[ev.index]?.climax ? 'Climax' : '');
        hud.popWave();
        break;
      case 'fuse':
        // La lanterne fusionnée change d'identité : la sélection la suit (la fiche aussi, cf. Sheets).
        if (input.ui.selectedTower === ev.oldId || input.ui.selectedTower === ev.srcId) input.ui.selectedTower = ev.tower.id;
        break;
      case 'sell':
      case 'rewindEnd':
      case 'undo':
        if (input.ui.selectedTower != null && !game.towerById(input.ui.selectedTower)) input.ui.selectedTower = null;
        if (ev.type === 'undo' && ev.tower) {
          // la lanterne retourne dans la palette : fumée d'encre et or rendu
          const t = ev.tower;
          renderer.fx.burst(t.x, t.y - 0.2, 6, 'smoke', '#f4f7f8', 0.6, 0.8, 0.14, { g: -0.5, drag: 0.95 });
          renderer.fx.ring(t.x, t.y + 0.3, 0.6, 0.1, PALETTE.gold, 0.4, 0.05, 0.45);
          renderer.fx.goldText(t.x, t.y - 0.5, ev.value);
          sound.play('sell', ev);
        }
        break;
      case 'earlyBonus':
        hud.toast(`Appel anticipé +${ev.gold} or`);
        break;
      case 'stomp':
        renderer.fx.addShake(0.35);
        break;
      case 'enrage':
        hud.toast(`${defs.enemies[ev.enemy.type].name} entre en rage !`, true);
        break;
      case 'win': {
        hud.banner('Victoire', '★'.repeat(ev.stars) + '☆'.repeat(3 - ev.stars));
        // Enregistrée tout de suite : quitter (ou recommencer) pendant la bannière ne perd pas la victoire.
        const record = save.record(state.levelId, ev.stars);
        setTimeout(() => state.game === game && showResult(true, record), 1400);
        break;
      }
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
// secondes, on réduit la résolution du canvas (3x → 2x → 1.5x). Une cadence
// régulière plafonnée par le système (iOS en mode Économie d'énergie : 30 Hz)
// avec peu de travail par frame ne dégrade rien : on ne baisse que si la frame
// coûte cher (plus de la moitié de l'intervalle) ou si la cadence est saccadée.
const perf = { acc: 0, work: 0, jit: 0, prev: 0, n: 0 };
function adaptQuality(rawDt, work) {
  if (state.paused || document.hidden) return;
  perf.acc += rawDt;
  perf.work += work;
  if (perf.n) perf.jit += Math.abs(rawDt - perf.prev);
  perf.prev = rawDt;
  perf.n++;
  if (perf.n < 150) return;
  const avg = perf.acc / perf.n;
  const busy = perf.work / perf.acc > 0.5;
  const jerky = perf.jit / (perf.n - 1) > avg * 0.2;
  perf.acc = perf.work = perf.jit = perf.n = 0;
  if (avg > 1 / 45 && (busy || jerky) && renderer.maxDpr > 1.5 && (window.devicePixelRatio || 1) > 1.5) {
    renderer.maxDpr = renderer.maxDpr > 2 ? 2 : 1.5;
    resize();
  }
}

function frame(now) {
  const t0 = performance.now();
  const raw = (now - state.last) / 1000;
  const dt = Math.min(0.1, raw);
  state.last = now;
  const g = state.game;
  if (g && state.screen === 'game') {
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
    input.tick();
    hud.update();
    gauge.update();
    updateBossBar(g);
    towerBar.update();
    sheets.update();
    tutorial.update(state.paused || modalOpen());
    renderer.render(state.paused ? 0 : dt, state.paused ? 1 : state.acc / STEP, input.ui);
    if (raw < 0.25) adaptQuality(raw, (performance.now() - t0) / 1000);
  }
  requestAnimationFrame(frame);
}

// ───────────────────────── Contraintes iOS ─────────────────────────

// Empêche le zoom par pincement / double-tap et le défilement.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
// Les conteneurs défilants (fiches, palette chargée) gardent leur défilement.
document.addEventListener('touchmove', (e) => !e.target.closest?.('.scroll') && e.preventDefault(), { passive: false });
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

// Téléphone tourné en paysage : l'écran « Tournez votre téléphone » (styles.css)
// masque la partie, qui se met donc en pause (iOS ignore l'orientation du manifeste).
const landscape = matchMedia('(orientation: landscape) and (max-height: 500px)');
function pauseIfLandscape() {
  if (landscape.matches && state.game && state.screen === 'game' && !state.paused && !state.resultShown) openPauseMenu();
}
if (landscape.addEventListener) landscape.addEventListener('change', pauseIfLandscape);
else landscape.addListener?.(pauseIfLandscape);

window.addEventListener('resize', resize);
// Changement de densité de pixels sans changement de taille (écran externe, zoom).
function watchDpr() {
  const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  mq.addEventListener?.(
    'change',
    () => {
      resize();
      watchDpr();
    },
    { once: true },
  );
}
watchDpr();
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
window.__hud = hud;
window.__input = input;
window.__sheets = sheets;

// Démarrage : ?level=<id> lance directement un niveau (tests), sinon l'écran titre.
const direct = new URLSearchParams(location.search).get('level');
if (direct) startLevel(direct);
else showScreen('title');
resize();
