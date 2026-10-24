// Point d'entrée : navigation entre écrans, boucle à pas de temps fixe,
// liaison moteur / rendu / interface / audio / sauvegarde, salon multijoueur.
//
// Coopération (1 à 4 joueurs) : à l'ouverture, chacun héberge son propre salon
// (accueil). L'hôte fait tourner la partie (Game normal + coop.afterUpdate) ;
// un invité tient un miroir (coop.attachGuest) qui ne simule rien : ses commandes
// partent vers l'hôte, l'état et les événements reviennent ~8 fois par seconde.
import { Game, STEP } from './core/game.js';
import { T } from './core/grid.js';
import { defs, loadLevel, worldById, worlds, levelOrder } from './data.js';
import { Renderer } from './render/renderer.js';
import { PALETTE } from './render/brush.js';
import { Input } from './ui/input.js';
import { Hud } from './ui/hud.js';
import { RewindGauge } from './ui/rewind.js';
import { Tutorial } from './ui/tutorial.js';
import { TitleScreen, MapScreen } from './ui/screens.js';
import { Sheets, comboTable, comboDetail } from './ui/sheets.js';
import { TowerBar, cyclePriority, priorityInfo, ofName } from './ui/towerbar.js';
import { enemyPortrait } from './ui/portraits.js';
import { elementBadge, elementOf, elementInfo } from './ui/elements.js';
import { BoardOverlay } from './ui/overlay.js';
import { DebugPanel } from './ui/debug.js';
import { LobbyUI, loadProfile } from './ui/lobby.js';
import { BROKERS, connectAny } from './net/mqtt.js';
import { NetSession, normalizeCode } from './net/lobby.js';
import { Coop } from './net/coop.js';
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
  combosSeen: new Set(),
  zones: null, // zones de combo de la frame précédente (combos perdus)
  introTimer: 0,
  resultShown: false,
  loopRunning: false,
  mode: { hard: false, challenge: false }, // options de la partie en cours
  challengeLost: false, // défi déjà manqué (message affiché une fois)
  lastChance: false,
  slotHintShown: false, // explication des socles gravés (premier choix d'une lanterne)
  slotRefuseShown: false, // … et premier refus sur un socle gravé
  coopRole: null, // partie en cours : 'host' | 'guest' | null (solo)
  coopPlayers: null, // joueurs de la partie coopérative (nom, éléments, élément choisi)
  gid: null, // graine de la partie coopérative en cours (départ renvoyé : déjà en jeu)
  startToken: 0,
  resultPending: false, // fin de partie annoncée, résultat pas encore affiché
};

// ───────────────────────── Salon multijoueur ─────────────────────────

const params = new URLSearchParams(location.search);
// ?broker=URL[,URL…] remplace la liste des relais (tests) ; ?broker=off : aucun réseau.
const brokerParam = params.get('broker');
const brokers = brokerParam == null ? BROKERS : brokerParam === 'off' ? [] : brokerParam.split(',').map((u) => u.trim()).filter(Boolean);
const profile = loadProfile();
const session = new NetSession({
  id: profile.id,
  name: profile.name,
  brokers,
  // sans réseau, inutile d'attendre les relais : le salon reste local, le solo marche
  connect: (urls, opts, from) => (navigator.onLine === false ? Promise.reject(new Error('hors ligne')) : connectAny(urls, opts, from)),
});
const coop = new Coop(session);
// Codes de salon gardés le temps de l'onglet : un rechargement retrouve son salon
// (hôte : même code ; invité : il revient dans le salon, et dans la partie en cours).
const SALON_HOST = 'jardin-esprits.salon-hote';
const SALON_GUEST = 'jardin-esprits.salon-invite';
function memo(key, value) {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {}
}
function recall(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

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

// Données de tous les niveaux (leçon, défi, mode Difficile) pour la carte.
let levelsLoaded = null;
function loadAllLevels() {
  if (!levelsLoaded) {
    levelsLoaded = Promise.all(order.map((o) => loadLevel(o.id).then((l) => [o.id, l]).catch(() => [o.id, null]))).then((list) => Object.fromEntries(list.filter((x) => x[1])));
  }
  return levelsLoaded;
}

function showScreen(name) {
  const leaving = state.screen === 'game' && name !== 'game';
  state.screen = name;
  title.hide();
  map.hide();
  screenGame.classList.toggle('active', name === 'game');
  if (leaving) leaveCoopGame();
  if (name === 'title') {
    title.show();
    ensureSalon();
  }
  if (name === 'map') {
    map.show(order, worlds, save);
    $('map-stars').textContent = `${save.totalStars(order)}/${order.length * 3}`;
    loadAllLevels().then((levels) => state.screen === 'map' && map.setLevels(levels));
  }
  if (name !== 'game') {
    state.game = null;
    musicHold = null;
    sound.intensity = 0;
    $('coop-roster').classList.add('hidden');
    $('coop-wait').classList.add('hidden');
  }
}

// On quitte l'écran de jeu : en coopération, l'hôte met fin à la partie pour tous
// (si elle n'est pas déjà finie) ; un invité cesse de suivre l'état de l'hôte.
function leaveCoopGame() {
  if (state.coopRole === 'host' && session.isHost && session.inGame) session.endGame(null);
  coop.stop();
  state.coopRole = null;
  state.gid = null;
  state.resultPending = false;
  // hors partie : le salon oublie les joueurs partis, et n'est plus « occupé »
  if (session.isHost) {
    session.prune();
    if (session.lobby?.solo) session.setOptions({ solo: null });
  }
}

$('btn-play').addEventListener('click', () => {
  if (session.role === 'guest') return; // l'hôte choisit le niveau
  showScreen('map');
});
// Cinq touchers rapides sur le titre : panneau de débogage (caché).
// (pointerdown : les touchers rapprochés ne sont pas avalés par l'anti double-tap d'iOS)
document.querySelector('#screen-title .title-wrap')?.addEventListener('pointerdown', () => debug.tap());
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
  const rec = save.level(entry.id);
  const stars = rec.stars;
  // Lanternes du niveau, regroupées par élément (forme + kanji + libellé + nombre).
  const counts = new Map();
  for (const t of level.towers || Object.keys(defs.towers)) {
    if (!defs.towers[t]) continue;
    const el = elementOf(t, defs);
    counts.set(el, (counts.get(el) || 0) + 1);
  }
  const towers = [...counts].map(([el, n]) => `<span class="lv-el">${elementBadge(el, defs, { size: 20, label: true })}${n > 1 ? `<small>×${n}</small>` : ''}</span>`).join('');
  const news = (level.introduce || []).map((e) => defs.enemies[e]?.name).filter(Boolean);
  const feats = [level.stones ? '石 Pierres' : null, level.rewind ? '巻 Rembobinage' : null, typedSlots(level) ? '刻 Socles gravés' : null].filter(Boolean);
  const opts = { hard: false, challenge: false };
  const hardOk = !!level.hard && save.hardUnlocked(entry.id);
  const ch = level.challenge;
  const sw = (on) => `<span class="lv-switch${on ? ' on' : ''}" aria-hidden="true"></span>`;
  const hardText = level.hard ? hardSummary(level.hard) : '';
  const card = showModal(
    `<div class="modal-kanji">${world.kanji}</div>
     <h2>${entry.index + 1}. ${level.name}</h2>
     <p class="lv-sub">${level.subtitle || ''}</p>
     ${level.concept ? `<div class="lv-concept"><span class="lv-concept-k" aria-hidden="true">学</span><span><small>Leçon</small><b>${level.concept}</b></span></div>` : ''}
     <div class="result-stars small">${[0, 1, 2].map((k) => `<i class="show ${k < stars ? 'on' : ''}">★</i>`).join('')}</div>
     <div class="lv-els">${towers}</div>
     ${news.length ? `<p class="lv-line"><b>Nouveau :</b> ${news.join(', ')}</p>` : ''}
     ${feats.length ? `<p class="lv-line">${feats.join(' · ')}</p>` : ''}
     ${coopReady() ? teamLine() : ''}
     <div class="lv-options">
       ${
         level.hard
           ? hardOk
             ? `<button class="lv-opt hard" data-opt="hard" aria-pressed="false"><span class="lv-seal hard" aria-hidden="true">難</span><span class="lv-opt-text"><b>Difficile${rec.hard ? ` <em>· gagné ${'★'.repeat(rec.hard)}</em>` : ''}</b><small>${hardText}</small></span>${sw(false)}</button>`
             : `<div class="lv-opt locked"><span class="lv-seal hard" aria-hidden="true">難</span><span class="lv-opt-text"><b>Difficile</b><small>S’ouvre après 3 ★ dans ce niveau</small></span><span class="lv-lock" aria-hidden="true">封</span></div>`
           : ''
       }
       ${
         ch
           ? `<button class="lv-opt challenge" data-opt="challenge" aria-pressed="false"><span class="lv-seal ch${rec.challenge ? ' done' : ''}" aria-hidden="true">挑</span><span class="lv-opt-text"><b>Défi : ${ch.name}${rec.challenge ? ' <em>· réussi</em>' : ''}</b><small>${ch.desc || ''}</small></span>${sw(false)}</button>`
           : ''
       }
     </div>`,
    [
      { label: 'Retour' },
      { label: 'Jouer', cls: 'primary', run: () => startLevel(entry.id, { ...opts }) },
    ],
    { cls: 'level-card' },
  );
  const play = card.querySelector('.actions .btn.primary');
  card.onclick = (e) => {
    const b = e.target.closest('.lv-opt[data-opt]');
    if (!b) return;
    const k = b.dataset.opt;
    opts[k] = !opts[k];
    b.setAttribute('aria-pressed', String(opts[k]));
    b.classList.toggle('on', opts[k]);
    b.querySelector('.lv-switch')?.classList.toggle('on', opts[k]);
    const modes = [opts.hard ? 'Difficile' : '', opts.challenge ? 'défi' : ''].filter(Boolean).join(' + ');
    play.innerHTML = modes ? `Jouer<small class="btn-sub">${modes}</small>` : 'Jouer';
    play.setAttribute('aria-label', modes ? `Jouer : ${modes}` : 'Jouer');
    sound.play('select');
  };
}

// Salon hébergé, en ligne, avec au moins un invité : « Jouer » lance pour tous.
function coopReady() {
  return session.isHost && session.online && (session.lobby?.players.length ?? 0) > 1;
}

// Fiche de niveau de l'hôte : qui partira avec lui (sceau d'élément + nom).
function teamLine() {
  const list = coop.playersFromLobby();
  const chips = list
    .map((p) => `<span class="lv-mate">${p.element ? elementBadge(p.element, defs, { size: 18 }) : '<span class="lv-mate-any" aria-label="éléments libres">？</span>'}${esc(p.name)}</span>`)
    .join('');
  return `<p class="lv-line lv-team"><b>Partie à ${list.length} :</b> ${chips}</p>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Le niveau a-t-il des socles gravés (chiffres 1 à 4 de la carte) ?
function typedSlots(level) {
  return (level.map || []).some((line) => /[1-4]/.test(line));
}

// Mode Difficile en clair : « PV ×1,4 · −20 or · −5 vies ».
function hardSummary(h) {
  const nf = (n) => String(Math.round(n * 100) / 100).replace('.', ',');
  const parts = [];
  if (h.hpScale && h.hpScale !== 1) parts.push(`PV des yokai ×${nf(h.hpScale)}`);
  if (h.startGold) parts.push(`${h.startGold > 0 ? '+' : '−'}${Math.abs(h.startGold)} or`);
  if (h.lives) parts.push(`${h.lives > 0 ? '+' : '−'}${Math.abs(h.lives)} vies`);
  return parts.join(' · ') || 'Yokai plus coriaces';
}

// ───────────────────────── Fenêtre modale ─────────────────────────

const modal = $('modal');
// opts.sheet : feuille du bas sans voile (pause) — le plateau reste visible et touchable.
function showModal(html, buttons, opts = {}) {
  const card = modal.firstElementChild;
  modal.classList.toggle('as-sheet', !!opts.sheet);
  modal.classList.remove('peek');
  // « scroll » : la carte défile au doigt si elle dépasse l'écran (B28).
  card.className = `modal-card scroll${opts.cls ? ' ' + opts.cls : ''}`;
  card.onclick = null; // gestionnaire propre à une vue (table des combos)
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

// Panneau de débogage (caché : cinq touchers sur le titre).
const debug = new DebugPanel({
  game: () => (state.screen === 'game' ? state.game : null),
  save,
  // ouvre la modale (feuille du bas en partie, carte centrée ailleurs)
  open: () => {
    const card = modal.firstElementChild;
    modal.classList.toggle('as-sheet', state.screen === 'game');
    modal.classList.remove('peek', 'hidden');
    card.onclick = null;
    return card;
  },
  close: () => modal.classList.add('hidden'),
  onSpeed: (fast) => setSpeed(fast ? 4 : 1),
  onUnlock: () => {
    if (state.screen === 'map') showScreen('map');
  },
  // retour au menu de pause (ou reprise si l'on a sauté de vague)
  onBack: (jumped) => {
    if (state.screen !== 'game' || !state.game) return;
    if (jumped) resumeFromPause();
    else openPauseMenu();
  },
});
window.__debug = debug;

// ───────────────────────── Partie ─────────────────────────

const input = new Input(canvas, renderer, {
  game: () => state.game,
  onInfo: (target) => showInfo(target),
  onFeedback: (kind, data) => feedback(kind, data),
  onAction: (kind, data) => {
    if (kind === 'selectTower' || kind === 'dragStart') sound.play('select');
    if (kind === 'placed') {
      hud.showUndo(data.tower);
      placeUndo();
      hud.popTool(data.type);
      // Défi « N lanternes au plus » : le compte des poses, sous les yeux
      const rule = state.game?.challengeRule;
      if (rule?.maxTowers != null && data.tower) {
        const p = renderer.toScreen(data.tower.x, data.tower.y - 0.2);
        input.flash(`挑 ${state.game.stats.towersBuilt}/${rule.maxTowers} lanternes`, p.x, p.y);
      }
    }
    if (kind === 'stone') hud.popTool('stone');
    if (kind === 'rally') {
      // le mur se dresse sur la case touchée
      sound.play('select');
      renderer.fx.ring(data.c + 0.5, data.r + 0.6, 0.1, 0.6, PALETTE.gold, 0.45, 0.06, 0.45);
      const p = renderer.toScreen(data.c + 0.5, data.r - 0.1);
      input.flash('Mur déplacé', p.x, p.y);
    }
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
    const short = data.reason === 'gold' && data.missing ? `Il manque ${data.missing} or` : data.reason === 'challenge' ? challengeShort() : hud.shortReason(data.reason, data);
    if (data.x != null && short) input.flash(short, data.x, data.y, true);
    else if (hud.reason(data.reason, data)) hud.toast(hud.reason(data.reason, data), true);
    // Premier refus sur un socle gravé : la règle, une fois, en clair.
    if (data.reason === 'slotElement' && !state.slotRefuseShown) {
      state.slotRefuseShown = true;
      hud.toast(hud.reason('slotElement', data), false, 2600);
    }
    sound.play('reject');
  } else if (kind === 'rallyFar') {
    if (data.x != null) input.flash('Hors de portée du Gardien', data.x, data.y, true);
    sound.play('reject');
  } else if (kind === 'cancel' || kind === 'dropCancel') {
    if (data.x != null) input.flash('Annulé', data.x, data.y);
    sound.play('tap');
  } else if (kind === 'owner') {
    // coopération : glisser la lanterne d'un coéquipier ne la fusionne pas
    const name = state.game?.players[data.tower?.owner]?.name;
    if (data.x != null) input.flash(name ? `Lanterne ${ofName(name)}` : 'Lanterne d’un coéquipier', data.x, data.y, true);
    sound.play('reject');
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
    if (press.reason === 'challenge') return { text: challengeShort(), tone: 'bad' };
    return { text: hud.shortReason(press.reason, press) || 'Impossible', tone: 'bad' };
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

// Surcouches du plateau ; en coopération, le sceau du joueur à qui appartient
// chaque lanterne d'un coéquipier.
const overlay = new BoardOverlay(renderer, { game: () => state.game, owner: (pid) => playerInfo(pid) });

const hud = new Hud(screenGame, {
  onWave: () => callWave(),
  onPause: () => (pauseSheetOpen() && state.paused && !state.resultShown ? resumeFromPause() : openPauseMenu()),
  onSpeed: () => {
    if (state.coopRole === 'guest') {
      hud.toast('La vitesse est réglée par l’hôte');
      return;
    }
    setSpeed(state.speed === 1 ? 2 : 1);
    sound.play('select');
  },
  onTool: (tool) => {
    sound.play('select');
    // Premier choix d'une lanterne dans un niveau à socles gravés : la règle, une fois.
    const g = state.game;
    if (tool && tool !== 'stone' && g && !state.slotHintShown && g.grid.slotElement?.some(Boolean)) {
      state.slotHintShown = true;
      hud.toast('刻 Socles gravés ▲ ● ◆ ■ : chacun n’accepte que son élément', false, 2800);
    }
    // La carte « Nouveau yokai » cachait des socles : un toucher pour poser ouvrait
    // la fiche du yokai. On pose : elle s'efface (la fiche reste dans l'aperçu de vague).
    if (tool && g && introCoversSlot(g)) introEl.classList.add('hidden');
  },
  onToolInfo: (id) => (id === 'stone' ? sheets.open('stoneTool') : sheets.open('type', id)),
  onUndo: (id) => undoPlace(id),
  onHold: (st, p, ms) => holdRing(st, p, ms),
  onEnemyInfo: (type, absorb) => sheets.open('enemy', { type, absorb }),
  onWaveInfo: () => sheets.open('wave'),
  onElementInfo: (el) => {
    sound.play('select');
    sheets.open('element', el);
  },
  onTab: () => sound.play('select'),
});

// Bouton de vague : lancer la première, puis appeler la suivante en avance (à
// tout moment, même pendant une vague : bonus d'or et charge de Rembobinage).
function callWave() {
  const g = state.game;
  if (!g || g.rewindAnim || coopFrozen()) return;
  const can = typeof g.canCallNextWave === 'function' ? g.canCallNextWave() : g.state === 'build';
  if (!can) return;
  // Double toucher accidentel : le bouton montre aussitôt la vague suivante, un
  // second toucher rapproché l'appelait aussi (deux vagues d'un coup).
  const now = performance.now();
  if (now - (state.waveCallAt ?? -1e9) < 350) return;
  if (g.startNextWave() !== false) {
    state.waveCallAt = now;
    hud.popWave();
  }
}

// « Défi : 10 lanternes au plus » (refus d'une pose interdite par le défi).
function challengeShort() {
  const r = state.game?.challengeRule;
  if (r?.maxTowers != null) return `Défi : ${r.maxTowers} lanternes au plus`;
  return 'Interdit par le défi';
}

// « Annuler » : en bas à gauche du plateau, ou à droite s'il y cacherait un socle
// libre ou le sanctuaire (petits écrans : le plateau descend jusqu'à la palette).
function placeUndo() {
  const el = $('btn-undo');
  const g = state.game;
  el.classList.remove('right');
  if (!g || el.classList.contains('hidden')) return;
  const cv = canvas.getBoundingClientRect();
  const ts = renderer.ts;
  const cost = () => {
    const u = el.getBoundingClientRect();
    let n = 0;
    for (let i = 0; i < g.grid.size; i++) {
      const ty = g.grid.type(i);
      const c = g.grid.col(i);
      const r = g.grid.row(i);
      if (ty !== T.GOAL && !(ty === T.SLOT && !g.towerAt(c, r))) continue;
      const p = renderer.toScreen(c, r);
      const ix = Math.min(u.right, cv.left + p.x + ts) - Math.max(u.left, cv.left + p.x);
      const iy = Math.min(u.bottom, cv.top + p.y + ts) - Math.max(u.top, cv.top + p.y);
      if (ix > 0 && iy > 0) n += ix * iy;
    }
    return n;
  };
  const left = cost();
  if (left <= 0) return;
  el.classList.add('right');
  if (cost() >= left) el.classList.remove('right');
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
  sheetOpen: () => sheets.isOpen,
  onPriority: (t) => changePriority(t),
  onRally: (t) => toggleRally(t),
  onSheet: (t) => {
    sound.play('select');
    sheets.open('tower', t.id);
  },
  onSell: (t) => sellTower(t),
  owner: (pid) => playerInfo(pid),
});

// « Déplacer le mur » : les cases valides s'allument, un toucher y déplace le mur.
function toggleRally(t) {
  sound.play('select');
  if (input.ui.rally?.towerId === t.id) {
    input.setRally(null);
    return;
  }
  input.setRally(t.id);
  hud.toast('壁 Touchez une case allumée du chemin · ailleurs : annuler', false, 3200);
}

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
  // ordonnée (page) de la lanterne ou du yokai décrit : la fiche ne doit pas le cacher
  anchor: (kind, data) => {
    const g = state.game;
    if (!g) return null;
    let y = null;
    if (kind === 'tower') y = g.towerById(data)?.y;
    else if (kind === 'enemy' && data?.enemy?.alive) y = data.enemy.y;
    if (y == null) return null;
    return canvas.getBoundingClientRect().top + renderer.toScreen(0, y - 0.3).y;
  },
  onOpen: (kind, data) => {
    input.ui.focusEnemy = kind === 'enemy' ? data?.enemy?.id ?? null : input.ui.focusEnemy;
    input.ui.rally = null;
    // En pause, la feuille de pause s'efface le temps de la fiche.
    if (pauseSheetOpen()) modal.classList.add('peek');
  },
  onClose: () => {
    input.ui.focusEnemy = null;
    modal.classList.remove('peek');
  },
  onSell: (t) => sellTower(t),
  onPriority: (t) => changePriority(t),
  onRally: (t) => toggleRally(t),
  onSelectTool: (type) => {
    if (input.ui.tool !== type) input.setTool(type);
    hud.refreshTools();
    hud.popTool(type);
    sound.play('select');
  },
  onRemoveStone: (c, r) => state.game?.removeStone(c, r),
  onCallWave: () => callWave(),
  onEnemy: (type, absorb) => sheets.open('enemy', { type, absorb }),
  owner: (pid) => playerInfo(pid),
});

function setSpeed(s) {
  state.speed = s;
  const b = $('btn-speed');
  b.firstElementChild.textContent = `×${s}`;
  b.classList.toggle('on', s > 1);
}

const gauge = new RewindGauge($('rewind'), {
  game: () => state.game,
  onRewind: () => !coopFrozen() && state.game?.rewind(),
  // Simple indication (pas d'erreur rouge ni de son de refus) : la jauge réduite
  // dit comment elle se remplit ; un appui long ouvre la règle.
  onRefuse: (why, pct) => {
    const msg = {
      charge: `巻 Jauge ${pct} % : apaisez des yokai, appelez les vagues en avance (appui long : la règle)`,
      wave: '巻 Jauge pleine : glissez ◀◀ pendant une vague',
      short: '巻 Le passé s’accumule encore…',
      // jauge prête, simplement touchée : le geste attendu
      drag: `巻 Glissez la poignée vers la gauche ◀◀ : le temps recule de ${state.game?.rules.rewindSeconds ?? 6} s`,
    }[why];
    if (msg) hud.toast(msg, false, 2200);
  },
  onInfo: () => {
    sound.play('select');
    sheets.open('rewind');
  },
  onHold: (st, p, ms) => holdRing(st, p, ms),
});

const tutorial = new Tutorial($('hint'), {
  game: () => state.game,
  input,
  renderer,
  canvas,
  hud,
  gauge,
  towerBar: $('tower-bar'),
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
  // Invité : son menu ne fige rien (la partie continue chez l'hôte), la musique non plus.
  if (state.coopRole === 'guest') return;
  holdMusic(p);
  // Hôte : sa pause est celle de tous (état diffusé aussitôt, et message direct).
  if (state.coopRole === 'host' && coop.isHost && !state.resultShown) {
    coop.setPaused(p);
    session.setPaused(p);
  }
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
// Coopération : la pause de l'hôte arrête la partie pour tous ; le menu d'un invité
// ne l'arrête pas (« La partie continue »).
function openPauseMenu() {
  if (!state.game || state.resultShown) return;
  setPaused(true);
  sheets.close();
  const g = state.game;
  const role = state.coopRole;
  const musicLabel = () => `Musique : ${save.data.music ? 'oui' : 'non'}`;
  const soundLabel = () => `Son : ${save.data.muted ? 'non' : 'oui'}`;
  const head = role === 'guest' ? 'Menu' : 'Pause';
  const note = role === 'guest' ? '<p class="pause-coop">La partie continue : seul l’hôte peut la mettre en pause.</p>' : role === 'host' ? '<p class="pause-coop">Partie en pause pour tous les joueurs.</p>' : '';
  const sound2 = [
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
  ];
  let buttons;
  if (role === 'guest') {
    buttons = [
      { label: 'Reprendre', cls: 'primary', run: () => resumeFromPause() },
      { label: 'Combos', keep: true, aria: 'Table des combos', run: () => openComboTable() },
      ...sound2,
      { label: 'Quitter le salon', cls: 'dark', run: () => quitGuestGame() },
    ];
  } else {
    buttons = [
      ...(debug.enabled ? [{ label: 'Débogage', keep: true, run: () => debug.open() }] : []),
      { label: 'Reprendre', cls: 'primary', run: () => resumeFromPause() },
      { label: 'Combos', keep: true, aria: 'Table des combos', run: () => openComboTable() },
      { label: 'Carte', cls: 'dark', aria: role === 'host' ? 'Carte du jardin (fin de la partie pour tous)' : 'Carte du jardin', run: () => showScreen('map') },
      ...sound2,
      { label: 'Recommencer', aria: role === 'host' ? 'Recommencer pour tous' : 'Recommencer', run: () => startLevel(state.levelId, state.mode) },
    ];
  }
  showModal(
    `<div class="pause-head"><span class="modal-kanji">${role === 'guest' ? '間' : '休'}</span><div><h2>${head}</h2><p>${g.level.name} · vague ${Math.max(0, g.waveIndex + 1)}/${g.totalWaves}</p></div></div>
     ${modeLine(g)}${note}
     <p class="pause-hint">Touchez une lanterne, ou appuyez longuement sur un yokai, pour l’étudier.</p>`,
    buttons,
    { sheet: true, cls: 'pause-card', actionsCls: 'pause-grid' },
  );
}

// Invité : quitter la partie, c'est quitter le salon de l'hôte (ses lanternes restent).
function quitGuestGame() {
  showScreen('title');
  hostSalon();
  appToast('Vous avez quitté le salon');
}

// Marques de la partie : mode Difficile, défi relevé (réussi / manqué en cours de route).
function modeLine(g) {
  const parts = [];
  if (g.hard) parts.push('<span class="mode-chip hard"><b>難</b>Difficile</span>');
  if (g.challenge && g.level.challenge) parts.push(`<span class="mode-chip ch${state.challengeLost ? ' lost' : ''}"><b>挑</b>Défi : ${g.level.challenge.name}${state.challengeLost ? ' — manqué' : ''}</span>`);
  return parts.length ? `<p class="mode-line">${parts.join('')}</p>` : '';
}

// Le défi est-il déjà perdu ? (mêmes règles que game.challengeMet, en cours de partie)
function challengeBroken(g) {
  return !!g.challengeBroken?.();
}

// Table des combos : matrice des éléments (forme + kanji + libellé), nom de chaque
// combo ; la case touchée détaille son effet et contre quoi il sert.
function openComboTable() {
  const g = state.game;
  if (!g) return;
  const card = modal.firstElementChild;
  card.className = 'modal-card scroll pause-card combos-card';
  card.innerHTML = `<div class="pause-head"><span class="modal-kanji">合</span><div><h2>Combos</h2><p>Deux éléments différents côte à côte</p></div></div>${comboTable(g.defs, g.availableTowers)}<div class="actions"><button class="btn" data-act="back">Retour</button></div>`;
  const detail = card.querySelector('.ct-detail');
  const select = (id) => {
    detail.innerHTML = comboDetail(g.defs, id);
    for (const c of card.querySelectorAll('.ct-cell[data-combo]')) c.classList.toggle('on', c.dataset.combo === id);
  };
  card.onclick = (e) => {
    const cell = e.target.closest('.ct-cell[data-combo]');
    if (cell) {
      select(cell.dataset.combo);
      sound.play('select');
    }
    if (e.target.closest('[data-act="back"]')) openPauseMenu();
  };
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
  } else if (target.kind === 'echo') {
    // Écho : un toucher le présentait en silence (rien ne répondait) ; il se nomme.
    const e = target.echo;
    const g = state.game;
    if (!e || !g) return;
    const pow = Math.round((g.rules.echoPower ?? 0.5) * 100);
    hud.toast(`影 Écho : ${defs.towers[e.type]?.name ?? 'lanterne'} N${e.level} · ${pow} % · encore ${Math.max(1, Math.ceil(e.ttl))} s`, false, 2200);
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
  const sr = stage.getBoundingClientRect();
  let H = stage.clientHeight;
  // fiche ouverte : elle couvre le bas du plateau
  if (sheets.isOpen) H = Math.min(H, $('info').getBoundingClientRect().top - sr.top);
  const w = introEl.offsetWidth;
  const h = introEl.offsetHeight;
  const ts = renderer.ts;
  const rel = (r) => ({ l: r.left - sr.left, t: r.top - sr.top, r: r.right - sr.left, b: r.bottom - sr.top });
  // Interdit : portails, sanctuaire, barre de boss, « Annuler ».
  const forbid = [{ l: W * 0.12, t: 0, r: W * 0.88, b: 34 }];
  if (!$('btn-undo').classList.contains('hidden')) forbid.push(rel($('btn-undo').getBoundingClientRect()));
  if (hud.bannerShown) forbid.push(rel($('banner').getBoundingClientRect())); // « Vague N », nom du niveau
  // À éviter (pondéré) : socles et lanternes, chemin et gravier où passent les yokai,
  // surtout à la sortie des portails (là où marche le yokai présenté).
  const soft = [];
  const grid = g.grid;
  const nearSpawn = (c, r) => grid.spawns.some((sp) => Math.max(Math.abs(grid.col(sp) - c), Math.abs(grid.row(sp) - r)) <= 3);
  for (let i = 0; i < grid.size; i++) {
    const ty = grid.type(i);
    const c = grid.col(i);
    const rr = grid.row(i);
    const p = renderer.toScreen(c, rr);
    const r = { l: p.x, t: p.y, r: p.x + ts, b: p.y + ts };
    if (ty === T.SPAWN || ty === T.GOAL) forbid.push({ l: r.l - 6, t: r.t - 6, r: r.r + 6, b: r.b + 6 });
    else if (ty === T.SLOT) soft.push([r, 4]);
    else if (ty === T.PATH || ty === T.OPEN) soft.push([r, nearSpawn(c, rr) ? 8 : 1]);
  }
  const area = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
  const m = 8;
  const top = 40;
  let best = null;
  for (const x of [m, W - w - m, (W - w) / 2]) {
    for (let y = H - h - m; y >= top; y -= Math.max(8, ts / 3)) {
      const box = { l: x, t: y, r: x + w, b: y + h };
      if (forbid.some((f) => area(f, box) > 0)) continue;
      let score = 0;
      for (const [r, k] of soft) score += (area(r, box) / (ts * ts)) * k;
      score += (x === (W - w) / 2 ? 0.6 : 0) + (1 - y / H) * 0.3; // préfère les bords, puis le bas
      if (!best || score < best.score) best = { x, y, score };
    }
  }
  const pos = best || { x: m, y: H - h - m };
  introEl.style.left = `${Math.round(pos.x)}px`;
  introEl.style.top = `${Math.round(pos.y)}px`;
}
// La carte de présentation recouvre-t-elle un socle libre ?
function introCoversSlot(g) {
  if (introEl.classList.contains('hidden')) return false;
  const r = introEl.getBoundingClientRect();
  const cv = canvas.getBoundingClientRect();
  const ts = renderer.ts;
  const grid = g.grid;
  for (let i = 0; i < grid.size; i++) {
    if (grid.type(i) !== T.SLOT || g.towerAt(grid.col(i), grid.row(i))) continue;
    const p = renderer.toScreen(grid.col(i), grid.row(i));
    const x = cv.left + p.x;
    const y = cv.top + p.y;
    if (x < r.right && x + ts > r.left && y < r.bottom && y + ts > r.top) return true;
  }
  return false;
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

// opts : { hard: mode Difficile (après 3★), challenge: défi optionnel relevé }
// Salon avec des invités : la partie part pour tous (l'hôte la fait tourner).
async function startLevel(id, opts = {}) {
  if (session.role === 'guest' || state.coopRole === 'guest') return; // l'hôte choisit le niveau
  const token = ++state.startToken;
  const level = await fetchLevel(id);
  if (!level || token !== state.startToken) return;
  const mode = { hard: !!(opts.hard && level.hard), challenge: !!(opts.challenge && level.challenge) };
  let game;
  // entre deux parties, les joueurs partis entre-temps ne sont plus du voyage
  if (session.isHost && !session.inGame) session.prune();
  if (coopReady()) {
    const players = coop.playersFromLobby();
    const seed = 1 + Math.floor(Math.random() * 1e9);
    const start = session.startGame({ level: id, seed, players, hard: mode.hard, challenge: mode.challenge });
    game = new Game(level, defs, { seed, players, localPlayer: 0, hard: mode.hard });
    // le défi filtre la palette (lanternes interdites) : avant hud.setup
    game.challenge = mode.challenge;
    coop.attachHost(game, start);
    state.coopRole = 'host';
    state.coopPlayers = players;
    state.gid = seed;
  } else {
    coop.stop();
    game = new Game(level, defs, { seed: 1, hard: mode.hard });
    game.challenge = mode.challenge;
    state.coopRole = null;
    state.coopPlayers = null;
    state.gid = null;
    // les joueurs qui rejoignent le salon pendant ce temps savent qu'ils attendront la suivante
    if (session.isHost) session.setOptions({ solo: id });
  }
  beginGame(id, level, game, mode);
}

// Invité : l'hôte lance une partie (ou la renvoie après un rechargement).
async function startGuestGame(msg) {
  // le message vient du réseau : on n'accepte qu'un niveau connu du jeu
  if (!order.some((o) => o.id === msg.level) || !Array.isArray(msg.players)) return;
  const token = ++state.startToken;
  const level = await fetchLevel(msg.level);
  if (!level || token !== state.startToken || session.role !== 'guest') return;
  const game = coop.attachGuest(Game, level, defs, msg);
  state.coopRole = 'guest';
  state.coopPlayers = msg.players;
  state.gid = msg.seed;
  beginGame(msg.level, level, game, { hard: !!msg.hard, challenge: !!(msg.challenge && level.challenge) });
  if (msg.rejoin) hud.toast('Vous revoilà dans la partie');
}

// Mise en place commune (solo, hôte, invité).
function beginGame(id, level, game, mode) {
  const world = worldById(level.world);
  modal.classList.add('hidden');
  showScreen('game');
  state.levelId = id;
  state.mode = mode;
  state.game = game;
  state.challengeLost = false;
  state.lastChance = false;
  state.acc = 0;
  state.resultShown = false;
  state.resultPending = false;
  state.coopResult = null;
  state.guestBlocked = false;
  // sceau de chaque joueur (élément choisi au salon) : marques des lanternes, coéquipiers
  state.coopInfo = state.coopRole ? game.players.map((p, i) => playerSeal(p, state.coopPlayers?.[i]?.element)) : null;
  setPaused(false);
  input.reset();
  renderer.game = null; // resize() ne refait pas le fond de l'ancien niveau : setGame s'en charge
  // la palette (rangée simple ou onglets) fixe la hauteur du bas : avant de mesurer le plateau
  hud.setup(state.game, input);
  updateRoster(true);
  resize();
  renderer.setGame(state.game, world.theme);
  sheets.close();
  towerBar.hide();
  holdRing('end');
  const idx = order.findIndex((o) => o.id === id);
  const marks = [state.mode.hard ? '難 Difficile' : '', state.mode.challenge ? `挑 Défi : ${level.challenge.name}` : ''].filter(Boolean);
  const team = state.coopRole ? `Coopération à ${game.players.length}` : '';
  hud.banner(level.name, marks.length ? marks.join(' · ') : team || `${world.name} · ${idx + 1}/${order.length}`);
  screenGame.classList.toggle('mode-hard', state.mode.hard);
  screenGame.classList.toggle('coop-guest', state.coopRole === 'guest');
  setLastChance(false);
  state.introduced = new Set();
  state.combosSeen = new Set();
  state.zones = null;
  introEl.classList.add('hidden');
  bossbar.classList.add('hidden');
  bossShown = null;
  // tutoriels : en solo seulement (l'hôte seul en garde le bénéfice)
  tutorial.start(state.game, !state.coopRole);
  if (save.data.rewindTutorialSeen && tutorial.rewindPhase === 1) tutorial.rewindPhase = 2;
  gauge.reset();
  gauge.update();
  if (state.coopRole === 'guest') setSpeed(1); // la vitesse est celle de l'hôte (affichée chaque image)
  else if (debug.fast) setSpeed(4);
  if (state.coopRole !== 'guest') debug.onStart(state.game);
  updateCoopWait(null);
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
// `challenge` : défi réussi (game.challengeMet() à la victoire).
function showResult(won, record = false, challenge = false) {
  const g = state.game;
  state.resultShown = true;
  state.resultPending = false;
  setPaused(true);
  sheets.close();
  input.ui.selectedTower = null;
  const idx = order.findIndex((o) => o.id === state.levelId);
  // Invité : les compteurs de la partie viennent de l'hôte ; la suite, c'est lui qui la choisit.
  const guest = state.coopRole === 'guest';
  const res = guest ? state.coopResult || {} : {};
  const kills = res.kills ?? g.stats.kills;
  const built = res.towers ?? g.stats.towersBuilt;
  const guestNote = '<p class="res-coop">L’hôte choisit la suite : elle vous rejoindra ici ou au salon.</p>';
  const guestButtons = [{ label: 'Retour au salon', cls: 'primary', run: () => showScreen('title') }];
  // Hôte en coopération : le salon plutôt que la carte (on y change d'élément entre deux parties)
  const back = state.coopRole === 'host' ? { label: 'Salon', cls: 'dark', aria: 'Retour au salon', run: () => showScreen('title') } : { label: 'Carte', cls: 'dark', run: () => showScreen('map') };
  if (won) {
    const stars = g.stars();
    const next = order[idx + 1];
    const card = showModal(
      `<div class="modal-kanji">勝</div><h2>Victoire !</h2>
       <div class="result-stars">${[0, 1, 2].map((k) => `<i class="${k < stars ? 'on' : ''}">★</i>`).join('')}</div>
       <div class="result-stats">
         <span>Vies : <b>${g.lives}/${g.maxLives}</b></span><span>Yokai apaisés : <b>${kills}</b></span>
         <span>Lanternes : <b>${built}</b></span><span>${record ? '<b style="color:var(--vermillion)">Nouveau record</b>' : ''}</span>
       </div>
       ${resultMarks(g, challenge)}
       ${!next ? '<p>Le sanctuaire est sauvé. Les esprits retrouvent la paix.</p>' : ''}
       ${!guest && stars >= 3 && !g.hard && g.level.hard && (save.level(state.levelId).hard || 0) === 0 ? '<p class="lv-line"><b>難 Difficile</b> est ouvert pour ce niveau.</p>' : ''}
       ${guest ? guestNote : ''}`,
      guest
        ? guestButtons
        : [
            back,
            { label: 'Rejouer', run: () => startLevel(state.levelId, state.mode) },
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
       <p>Vague ${g.waveIndex + 1}/${g.totalWaves}. Essayez d'autres combos, ou rembobinez au bon moment.</p>
       ${guest ? guestNote : ''}`,
      guest
        ? guestButtons
        : [
            back,
            { label: 'Réessayer', cls: 'primary', run: () => startLevel(state.levelId, state.mode) },
          ],
      { cls: 'result result-lose' },
    );
  }
}

// Sceaux du résultat : mode Difficile, défi réussi ou manqué.
function resultMarks(g, challenge) {
  const out = [];
  if (g.hard) out.push('<span class="res-seal hard"><b>難</b>Victoire en Difficile</span>');
  if (g.challenge && g.level.challenge) {
    out.push(challenge ? `<span class="res-seal ch"><b>挑</b>Défi réussi : ${g.level.challenge.name}</span>` : `<span class="res-seal ch lost"><b>挑</b>Défi manqué : ${g.level.challenge.name}</span>`);
  }
  return out.length ? `<div class="res-seals">${out.join('')}</div>` : '';
}

// Dernière chance : la partie est figée, seul le Rembobinage peut sauver le
// sanctuaire ; le reste de l'interface est inactif.
const lcEl = $('last-chance');
function setLastChance(on) {
  if (on === state.lastChance) return;
  state.lastChance = on;
  lcEl.classList.toggle('hidden', !on);
  screenGame.classList.toggle('lc-on', on);
  if (on) {
    input.cancel();
    input.ui.selectedTower = null;
    input.ui.tool = null;
    input.ui.rally = null;
    sheets.close();
    towerBar.hide();
    hud.refreshTools();
    requestAnimationFrame(placeLastChanceArrow);
  }
}

// La flèche de l'appel pointe sur la poignée de la jauge (sous le plateau).
function placeLastChanceArrow() {
  const arrow = $('lc-arrow');
  const k = gauge.knobRect();
  const st = stage.getBoundingClientRect();
  if (!k.width) return;
  arrow.style.left = `${Math.round(k.left + k.width / 2 - st.left)}px`;
}

// Gestion des événements moteur côté présentation.
function handleEvents(game) {
  const all = game.events;
  if (!all.length) return;
  // Coopération : un refus adressé à un autre joueur ne concerne que lui.
  const me = game.localPlayer;
  const evs = state.coopRole ? all.filter((ev) => !(ev.type === 'reject' && ev.pid != null && ev.pid !== me)) : all;
  renderer.onEvents(evs);
  for (const ev of evs) {
    // geste d'un coéquipier : on dit qui (appel de vague, rembobinage)
    const mate = state.coopRole && ev.pid != null && ev.pid !== me ? game.players[ev.pid]?.name : null;
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
      case 'waveStart': {
        // Vague climax : bannière nommée (« La Horde du seuil »).
        const last = ev.index === ev.total - 1;
        if (ev.climax) hud.banner(ev.name || 'Climax', `嵐 Climax · vague ${ev.index + 1}${last ? ' · dernière' : ''}`, 'climax');
        else hud.banner(ev.name || `Vague ${ev.index + 1}`, last ? 'Dernière vague' : ev.name ? `Vague ${ev.index + 1}` : '');
        hud.popWave();
        if (mate && ev.early) hud.toast(`${mate} appelle la vague ${ev.index + 1}`);
        break;
      }
      case 'lastChance':
        setLastChance(true);
        break;
      case 'rewindStart':
        setLastChance(false);
        if (mate) hud.toast(`巻 ${mate} remonte le temps`);
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
      case 'earlyBonus': {
        // charge réellement gagnée : jauge déjà pleine, ou vague déjà rechargée avant
        // un rembobinage, l'appel n'en rapporte pas (le moteur annonce la valeur brute)
        const before = gauge.last.charge;
        const got = before != null ? Math.max(0, Math.round((game.rewindCharge ?? 0) - before)) : ev.charge;
        const ch = Math.min(ev.charge || 0, got);
        hud.toast(`Appel anticipé +${ev.gold} or${ch > 0 && game.rewindEnabled ? ` · +${ch} 巻` : ''}`);
        break;
      }
      case 'combo':
        // Premier combo de chaque sorte dans le niveau : son effet est expliqué (D5).
        if (ev.def && !state.combosSeen.has(ev.def.id)) {
          state.combosSeen.add(ev.def.id);
          hud.toast(`${ev.def.kanji || ''} ${ev.def.name} : ${ev.def.desc}`, false, 3200);
        }
        break;
      case 'reject':
        // Invité : l'hôte refuse sa commande (socle pris entre-temps par un coéquipier…) :
        // la raison s'écrit près du socle, comme un refus local.
        if (ev.fromHost && state.coopRole === 'guest' && ev.c != null && game.grid.inBounds(ev.c, ev.r)) {
          const other = game.towerAt(ev.c, ev.r);
          const who = other && other.owner !== me ? game.players[other.owner]?.name : null;
          const p = renderer.toScreen(ev.c + 0.5, ev.r);
          input.flash(who ? `Pris par ${who}` : hud.shortReason(ev.reason, ev) || 'Refusé par l’hôte', p.x, p.y, true);
        }
        break;
      case 'stomp':
        renderer.fx.addShake(0.35);
        break;
      case 'enrage':
        hud.toast(`${defs.enemies[ev.enemy.type].name} entre en rage !`, true);
        break;
      case 'win': {
        if (state.resultPending || state.resultShown) break; // fin déjà annoncée (coopération)
        hud.banner('Victoire', '★'.repeat(ev.stars) + '☆'.repeat(3 - ev.stars));
        // Enregistrée tout de suite : quitter (ou recommencer) pendant la bannière ne perd pas la victoire.
        // En coopération, chacun garde ses étoiles dans sa propre sauvegarde.
        const challenge = ev.challenge ?? (game.challengeMet ? game.challengeMet() : false);
        const record = save.record(state.levelId, ev.stars, { hard: game.hard, challenge });
        // une victoire en Difficile compte aussi pour les étoiles du mode normal
        if (game.hard) save.record(state.levelId, ev.stars);
        state.resultPending = true;
        endCoopGame(game, { won: true, stars: ev.stars, challenge });
        setTimeout(() => state.game === game && showResult(true, record, challenge), 1400);
        break;
      }
      case 'lose':
        if (state.resultPending || state.resultShown) break;
        setLastChance(false);
        hud.banner('Défaite', 'Le sanctuaire est tombé');
        state.resultPending = true;
        endCoopGame(game, { won: false, stars: 0, challenge: false });
        setTimeout(() => state.game === game && showResult(false), 1400);
        break;
      default:
        break;
    }
  }
  all.length = 0; // la file du moteur (pas la copie filtrée)
}

// Un combo qui disparaît (vente, fusion, annulation, rembobinage) ne s'efface plus
// en silence : son anneau se resserre et son nom s'affiche, barré (D16).
function watchZones(g) {
  if (g.zones === state.zones) return;
  const prev = state.zones;
  state.zones = g.zones;
  if (!prev) return;
  const now = new Set(g.zones.map((z) => z.key));
  for (const z of prev) {
    if (now.has(z.key)) continue;
    renderer.fx.ring(z.x, z.y, z.radius * 0.85, 0.1, z.def.color || PALETTE.gold, 0.55, 0.06, 0.85);
    renderer.fx.text(z.x, z.y - 0.45, `${z.def.name} perdu`, '#4a463e', Math.max(0.3, 12.5 / renderer.ts));
  }
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
  // L'horodatage d'une image peut précéder l'instant où elle a été demandée (Chrome :
  // heure de début d'image ; plus d'une seconde si la page est chargée, juste après
  // le lancement d'une partie) : un écart négatif ne doit jamais faire reculer le temps.
  const raw = Math.max(0, (now - state.last) / 1000);
  const dt = Math.min(0.1, raw);
  state.last = now;
  const g = state.game;
  if (g && state.screen === 'game') {
    const guest = state.coopRole === 'guest';
    if (!guest) debug.tick(g);
    // Pause douce : entre deux vagues (plus aucun yokai en jeu), le compte à
    // rebours attend qu'on ait lu la fiche (B12). Pas en coopération : les autres jouent.
    const calm = g.enemies.length === 0 && (typeof g.spawnersDone === 'function' ? g.spawnersDone() : true);
    const reading = !state.coopRole && sheets.isOpen && g.countdown != null && calm && g.state !== 'won' && g.state !== 'lost';
    state.reading = reading;
    // L'invité ne simule rien : son miroir reçoit l'état de l'hôte (coop.afterUpdate).
    if (!guest && !state.paused && !reading) {
      state.acc += dt * state.speed;
      let steps = 0;
      while (state.acc >= STEP && steps < 8) {
        g.update(STEP);
        state.acc -= STEP;
        steps++;
      }
      if (steps >= 8) state.acc = 0;
    }
    // Coopération : avant de consommer game.events (ils partent aussi vers les invités).
    if (coop.active) {
      coop.speed = state.speed;
      coop.afterUpdate(dt);
    }
    const hold = updateCoopGuest(g);
    try {
      handleEvents(g);
    } catch (e) {
      // un effet qui échoue (événement inattendu reçu de l'hôte…) n'arrête pas la boucle
      g.events.length = 0;
      console.error(e);
    }
    watchZones(g);
    if (g.lastChanceT > 0 !== state.lastChance) setLastChance(g.lastChanceT > 0);
    if (state.lastChance) {
      const n = String(Math.max(1, Math.ceil(g.lastChanceT)));
      const cnt = $('lc-count');
      if (cnt.textContent !== n) {
        cnt.textContent = n;
        placeLastChanceArrow();
      }
    }
    if (!guest && !state.challengeLost && g.challenge && challengeBroken(g)) {
      state.challengeLost = true;
      hud.toast(`挑 Défi « ${g.level.challenge.name} » manqué`, true, 2600);
    }
    input.tick();
    hud.update();
    gauge.update();
    updateBossBar(g);
    towerBar.update();
    sheets.update();
    tutorial.update(state.paused || modalOpen());
    updateRoster();
    // Invité : son menu ne fige pas le plateau (la partie continue) ; la pause de
    // l'hôte, si. Les yokai sont interpolés entre deux états reçus (coop.alpha).
    const still = guest ? hold === 'pause' : state.paused;
    renderer.render(still ? 0 : dt, guest ? coop.alpha ?? 1 : state.paused ? 1 : state.acc / STEP, input.ui);
    if (raw < 0.25) adaptQuality(raw, (performance.now() - t0) / 1000);
  }
  requestAnimationFrame(frame);
}

// ───────────────────────── Coopération ─────────────────────────

// Sceau d'un joueur : l'élément qu'il a choisi au salon ; sans choix, un sceau
// neutre à son initiale (il joue les éléments que personne n'a pris).
function playerSeal(p, chosen) {
  const el = chosen && defs.elements?.[chosen] ? chosen : null;
  const info = el ? elementInfo(el, defs) : null;
  const initial = (String(p.name || '?').trim()[0] || '?').toUpperCase();
  return { pid: p.id, name: p.name, element: el, color: info?.color ?? '#6d6a78', ink: info?.ink ?? '#f2e8d0', shape: info?.shape ?? 'circle', kanji: info?.kanji ?? initial, label: info?.label ?? '', initial };
}

// Sceau HTML d'un joueur (élément choisi, ou initiale sur fond neutre).
function sealHtml(o, size = 18) {
  if (o?.element) return elementBadge(o.element, defs, { size });
  return `<span class="seal-any" style="--s:${size}px" aria-hidden="true">${esc(o?.initial ?? '?')}</span>`;
}

// Sceau du joueur `pid` dans la partie en cours (null en solo).
function playerInfo(pid) {
  return state.coopInfo?.[pid] ?? null;
}

// Invité bloqué (pause de l'hôte, hôte injoignable) : aucune commande ne part.
function coopFrozen() {
  return state.coopRole === 'guest' && !!state.guestBlocked;
}

// Fin de partie en coopération. Hôte : dernier état (avec l'événement de fin) puis
// annonce à tous ; chacun affiche son résultat et garde ses étoiles. Invité : il
// cesse d'attendre les états de l'hôte.
function endCoopGame(game, result) {
  if (state.coopRole === 'host' && coop.isHost) {
    coop.flush();
    session.endGame({
      ...result,
      level: state.levelId,
      hard: !!game.hard,
      lives: game.lives,
      maxLives: game.maxLives,
      kills: game.stats.kills,
      towers: game.stats.towersBuilt,
      wave: game.waveIndex + 1,
    });
    coop.stop();
  } else if (state.coopRole === 'guest') coop.stop();
}

// Invité, chaque image : pause de l'hôte, hôte sans nouvelles, vitesse de l'hôte.
// Renvoie 'pause' | 'stale' | null.
function updateCoopGuest(g) {
  if (state.coopRole !== 'guest') {
    updateCoopWait(null);
    return null;
  }
  const over = g.state === 'won' || g.state === 'lost' || state.resultShown || state.resultPending;
  const kind = over || !coop.isGuest ? null : coop.remotePaused ? 'pause' : coop.stale() ? 'stale' : null;
  updateCoopWait(kind);
  const blocked = kind != null;
  if (blocked !== !!state.guestBlocked) {
    state.guestBlocked = blocked;
    if (blocked) {
      input.cancel();
      input.ui.rally = null;
    }
  }
  input.inspect = state.paused || blocked;
  const sp = coop.speed || 1;
  if (sp !== state.speed) setSpeed(sp);
  return kind;
}

// Bandeau de l'invité : « Pause par l'hôte » ou « En attente de l'hôte… ».
function updateCoopWait(kind) {
  if (kind === state.waitKind) return;
  state.waitKind = kind;
  const el = $('coop-wait');
  el.classList.toggle('hidden', !kind);
  if (!kind) return;
  const host = esc(state.game?.players[0]?.name || 'L’hôte');
  el.innerHTML =
    kind === 'pause'
      ? `<span class="cw-kanji" aria-hidden="true">休</span><span class="cw-text"><b>Pause par l’hôte</b><small>${host} a mis la partie en pause</small></span>`
      : `<span class="cw-kanji wait" aria-hidden="true">待</span><span class="cw-text"><b>En attente de l’hôte…</b><small>La partie reprend dès son retour</small></span>`;
}

// Rangée des coéquipiers sous le HUD : sceau d'élément, nom, or, absent.
function updateRoster(force = false) {
  const el = $('coop-roster');
  const g = state.game;
  const on = !!(g && state.coopRole && g.players.length > 1 && state.screen === 'game');
  if (!on) {
    if (!el.classList.contains('hidden')) el.classList.add('hidden');
    state.rosterSig = null;
    return;
  }
  const lp = session.lobby?.players || [];
  const mates = g.players.filter((p) => p.id !== g.localPlayer).map((p) => ({ p, info: playerInfo(p.id), off: lp[p.id]?.online === false }));
  const sig = mates.map((m) => `${m.p.name}|${Math.floor(m.p.gold)}|${m.off}`).join(';');
  if (!force && sig === state.rosterSig) return;
  state.rosterSig = sig;
  el.innerHTML = mates
    .map(({ p, info, off }) => {
      const gold = Math.floor(p.gold);
      const seal = sealHtml(info, 18);
      return `<span class="coop-mate${off ? ' off' : ''}" role="img" aria-label="${esc(p.name)}${info?.label ? `, ${info.label}` : ''} : ${gold} or${off ? ', absent' : ''}">${seal}<b>${esc(p.name)}</b><span class="cm-gold"><i aria-hidden="true">金</i>${gold}</span>${off ? '<em>absent</em>' : ''}</span>`;
    })
    .join('');
  el.classList.remove('hidden');
}

// Message bref hors partie (accueil, carte) ; en partie, celui du HUD.
let appToastTimer = 0;
function appToast(msg, ms = 2200) {
  if (state.screen === 'game') {
    hud.toast(msg, false, ms);
    return;
  }
  const el = $('app-toast');
  el.textContent = msg;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(appToastTimer);
  appToastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Accueil : « Jouer » pour l'hôte ; un invité attend que l'hôte choisisse le niveau.
function updateTitleActions() {
  const guest = session.role === 'guest';
  $('btn-play').classList.toggle('hidden', guest);
  const wait = $('title-wait');
  wait.classList.toggle('hidden', !guest);
  if (!guest) return;
  const txt = session.lobby?.solo ? 'L’hôte finit une partie seul : vous jouerez à la suivante' : session.inGame ? 'Partie en cours…' : 'L’hôte choisit le niveau…';
  if (wait.textContent !== txt) wait.textContent = txt;
}

// Son propre salon (même code après un rechargement de l'onglet).
function hostSalon() {
  memo(SALON_GUEST, null);
  const code = normalizeCode(recall(SALON_HOST)) || undefined;
  return session.host({ code, element: profile.element });
}

// À l'accueil : le salon existe toujours. Lien ?salon=CODE (ou rechargement d'un
// invité) : on rejoint ce salon ; sinon on héberge le sien.
function ensureSalon() {
  if (session.role || lobbyUI.joining) return;
  let code = normalizeCode(params.get('salon'));
  if (params.has('salon')) {
    params.delete('salon');
    history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}${location.hash}`);
  }
  code ||= normalizeCode(recall(SALON_GUEST));
  if (code && code !== normalizeCode(recall(SALON_HOST))) lobbyUI.join(code);
  else hostSalon();
}

const lobbyUI = new LobbyUI($('title-lobby'), session, {
  elements: defs.elements,
  profile,
  toast: (msg) => appToast(msg),
  sound: (name) => sound.play(name),
  host: () => hostSalon(),
  // lien d'invitation : ?salon=CODE (et le relais choisi, pour les tests)
  inviteUrl: (code) => {
    const q = new URLSearchParams();
    if (brokerParam != null) q.set('broker', brokerParam);
    q.set('salon', code);
    return `${location.origin}${location.pathname}?${q}`;
  },
  onRender: () => updateTitleActions(),
});
// la scène de l'accueil se cale au-dessus du salon : elle suit sa hauteur
new ResizeObserver(() => title.resize()).observe($('title-lobby'));

session.on('status', ({ state: st, role, code, error }) => {
  if (role === 'host' && code) memo(SALON_HOST, code);
  if (role === 'guest' && st === 'online' && code) memo(SALON_GUEST, code);
  updateTitleActions();
  // relais perdu en cours de route : l'hôte se reconnecte sans perdre son salon
  if (st === 'offline' && role === 'host' && error === 'connexion perdue') scheduleReconnect();
  if (st === 'online') reconnectTries = 0;
});

session.on('lobby', () => {
  updateTitleActions();
  if (state.screen === 'game') updateRoster(true);
});

// Invité : l'hôte lance une partie. Départ renvoyé (rechargement, reconnexion) alors
// qu'on y est déjà : rien à faire, les états reprennent.
session.on('start', (msg) => {
  if (state.coopRole === 'guest' && state.screen === 'game' && state.gid === msg.seed && state.levelId === msg.level && !state.resultShown && !state.resultPending) return;
  startGuestGame(msg);
});

// Invité : fin de partie annoncée par l'hôte (résultat), ou partie arrêtée (null).
session.on('end', (msg) => {
  if (state.coopRole !== 'guest' || state.screen !== 'game') return;
  const r = msg.result;
  const g = state.game;
  if (r) {
    state.coopResult = r;
    coop.client?.drain(); // le dernier état de l'hôte (et son événement de fin) d'abord
    if (!state.resultPending && !state.resultShown && g && g.state !== 'won' && g.state !== 'lost') {
      // l'état final n'est pas arrivé : on conclut d'après l'annonce de l'hôte
      g.state = r.won ? 'won' : 'lost';
      if (r.lives != null) g.lives = r.lives;
      g.events.push(r.won ? { type: 'win', stars: r.stars ?? g.stars(), challenge: !!r.challenge } : { type: 'lose' });
    }
    return;
  }
  if (state.resultShown || state.resultPending) return;
  coop.stop();
  setPaused(true);
  showModal(`<div class="modal-kanji">終</div><h2>Partie terminée</h2><p>L’hôte a mis fin à la partie. Il choisira bientôt la suivante.</p>`, [
    { label: 'Retour au salon', cls: 'primary', run: () => showScreen('title') },
  ]);
});

// Invité : pause de l'hôte (message direct ; l'état suivant la confirme).
session.on('paused', (msg) => {
  coop.client?.setPaused(!!msg.on);
});

// Invité : salon fermé. L'hôte parti pour de bon : retour à son propre salon.
// Connexion coupée (la nôtre, ou celle de l'hôte, sans au revoir) : on tente d'abord
// de revenir (l'hôte reconnecté nous reconnaît et renvoie la partie) ; pendant ce
// temps, « En attente de l'hôte… ».
let rejoining = false;
session.on('closed', async ({ reason }) => {
  if (rejoining) return;
  if ((reason === 'lost' || reason === 'hostLost') && session.code) {
    rejoining = true;
    let ok = false;
    try {
      ok = await session.join(session.code, 6000);
    } catch {
      ok = false;
    }
    rejoining = false;
    if (ok) return;
  }
  const inGame = state.screen === 'game' && state.coopRole === 'guest' && !state.resultShown && !state.resultPending;
  if (inGame) coop.stop();
  hostSalon();
  const gone = reason !== 'lost';
  if (inGame) {
    setPaused(true);
    showModal(
      `<div class="modal-kanji">${gone ? '去' : '断'}</div><h2>${gone ? 'L’hôte a quitté la partie' : 'Connexion perdue'}</h2><p>${gone ? 'La partie s’arrête ici.' : 'Impossible de joindre l’hôte.'} Votre propre salon est de nouveau ouvert.</p>`,
      [{ label: 'Retour au salon', cls: 'primary', run: () => showScreen('title') }],
    );
  } else appToast(gone ? 'L’hôte a fermé le salon : vous retrouvez le vôtre' : 'Connexion au salon perdue');
});

// Hôte : arrivées et départs (le salon de l'accueil les montre ; en partie, un mot).
const joinSeen = new Map();
session.on('join', (p) => {
  const now = performance.now();
  if (now - (joinSeen.get(p.id) ?? -1e9) < 4000) return; // « hello » répétés
  joinSeen.set(p.id, now);
  if (state.screen !== 'game') {
    if (state.screen === 'title') sound.play('select');
    return;
  }
  if (state.coopRole === 'host') hud.toast(`${p.name} est de retour`);
  else if (!state.coopRole) hud.toast(`${p.name} a rejoint votre salon : il jouera à la prochaine partie`, false, 2600);
});
session.on('leave', (id) => {
  joinSeen.delete(id);
  if (state.screen !== 'game' || state.coopRole !== 'host') return;
  const p = session.lobby?.players.find((x) => x.id === id);
  if (p) hud.toast(`${p.name} s’est déconnecté`, true);
});

// Reconnexion de l'hôte (relais perdu) : 1,5 s, 3 s, 6 s… puis on abandonne.
let reconnectTimer = 0;
let reconnectTries = 0;
function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (reconnectTries >= 6) return;
  const delay = Math.min(15000, 1500 * 2 ** reconnectTries++);
  reconnectTimer = setTimeout(async () => {
    if (!session.isHost || session.online || session.state === 'connecting') return;
    if (!(await session.reconnect())) scheduleReconnect();
  }, delay);
}
// Le réseau revient : le salon se reconnecte de lui-même.
window.addEventListener('online', () => {
  if (session.state !== 'offline' || lobbyUI.joining) return;
  if (session.isHost) session.reconnect();
  else if (!session.role && state.screen === 'title') hostSalon();
});

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

// Pause automatique en arrière-plan. Hôte : c'est la pause de tous ; un état par
// seconde rassure les invités (sinon ils l'attendraient comme un hôte disparu).
// Invité : rien (la partie continue chez l'hôte).
let heartbeat = 0;
document.addEventListener('visibilitychange', () => {
  clearInterval(heartbeat);
  if (document.hidden) {
    if (state.game && state.screen === 'game' && !state.paused && !state.resultShown && state.coopRole !== 'guest') openPauseMenu();
    if (coop.isHost) heartbeat = setInterval(() => coop.flush(), 1000);
    sound.suspend();
  } else {
    sound.resume();
  }
});
window.addEventListener('pagehide', () => {
  sound.suspend();
  session.farewell(); // hôte : ses invités savent que la partie s'arrête
});

// Téléphone tourné en paysage : l'écran « Tournez votre téléphone » (styles.css)
// masque la partie, qui se met donc en pause (iOS ignore l'orientation du manifeste).
const landscape = matchMedia('(orientation: landscape) and (max-height: 500px)');
function pauseIfLandscape() {
  if (landscape.matches && state.game && state.screen === 'game' && !state.paused && !state.resultShown && state.coopRole !== 'guest') openPauseMenu();
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
const resizeObs = new ResizeObserver(resize);
resizeObs.observe(document.getElementById('app'));
// la hauteur du plateau suit aussi celle de la barre du bas (palette regroupée ou non)
resizeObs.observe(stage);

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
window.__gauge = gauge;
window.__overlay = overlay;
window.__save = save;
window.__session = session;
window.__coop = coop;
window.__lobby = lobbyUI;

// Démarrage : ?level=<id> lance directement un niveau en solo (tests), sinon
// l'accueil, où le salon se crée tout seul (ou rejoint celui de ?salon=CODE).
const direct = params.get('level');
if (direct) startLevel(direct);
else showScreen('title');
resize();
