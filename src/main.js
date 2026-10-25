// Point d'entrée : navigation entre écrans, boucle à pas de temps fixe,
// liaison moteur / rendu / interface / audio / sauvegarde, salon multijoueur.
//
// Coopération (1 à 4 joueurs) : à l'ouverture, chacun héberge son propre salon
// (accueil). Chaque téléphone fait tourner la MÊME partie (lockstep, src/net/lockstep.js) :
// seules les commandes datées circulent (plus un battement de l'hôte ~4 fois par
// seconde) ; coop.step(dt) avance la partie, chez l'hôte comme chez les invités.
//
// Commandes : l'interface n'appelle jamais les actions du moteur. Chaque geste
// (pose, fusion, vente, priorité, mur, vague, rembobinage, annulation) passe par la
// façade `commands` (src/ui/commands.js) : en solo, game.issue (file du moteur, pose
// active après 2 s) ; en coopération, l'émetteur du réseau (coop.sender, voir
// branchSender) : l'hôte date la commande pour tous, une pose s'active 2 s après le
// toucher, au même instant chez chacun.
import { Game, STEP, PLACEMENTS } from './core/game.js';
import { T } from './core/grid.js';
import { defs, loadLevel, worldById, worlds, levelOrder } from './data.js';
import { Renderer } from './render/renderer.js';
import { PALETTE } from './render/brush.js';
import { Input } from './ui/input.js';
import { Hud } from './ui/hud.js';
import { RewindGauge } from './ui/rewind.js';
import { Tutorial } from './ui/tutorial.js';
import { TitleScreen, MapScreen } from './ui/screens.js';
import { Sheets, comboList } from './ui/sheets.js';
import { TowerBar, cyclePriority, priorityInfo, ofName } from './ui/towerbar.js';
import { enemyPortrait } from './ui/portraits.js';
import { elementBadge, elementOf, elementInfo } from './ui/elements.js';
import { BoardOverlay } from './ui/overlay.js';
import { DebugPanel } from './ui/debug.js';
import { LobbyUI, loadProfile } from './ui/lobby.js';
import { initSettings, openSettings } from './ui/settings.js';
import { digitsHTML as digitsOf } from './ui/fmt.js';
import { enemyPortrait as portraitOf } from './ui/portraits.js';
import { elementBadge as badgeOf, elementOf as elementOfTower } from './ui/elements.js';
import { BROKERS, connectAny } from './net/mqtt.js';
import { NetSession, normalizeCode } from './net/lobby.js';
import { Coop } from './net/coop.js';
import { COMMAND_DELAY } from './net/lockstep.js';
import { commands, tileOfCommand } from './ui/commands.js';
import { installPress, armConfirm } from './ui/press.js';
import { attachSheet } from './ui/sheet.js';
import { digitsHTML } from './ui/fmt.js';
import { earlyCharge } from './ui/wavepreview.js';
import { flyCoins, soberFx } from './ui/coins.js';
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
  // Poses provisoires (coopération) : commandes envoyées à l'hôte, pas encore datées.
  // Le réseau (src/net/lockstep.js) y ajoute { op, args, pid, born: game.frame au
  // toucher, tmp } puis renseigne `entry` et retire l'objet quand la commande datée
  // arrive. L'interface les dessine en construction, réserve leur or et refuse une
  // autre pose sur leur case.
  provisional: [],
};

// Façade des commandes : partie en cours, poses provisoires, annulations en route.
commands.bind({ game: () => state.game, provisional: () => state.provisional, hidden: () => coop.hiddenEntries(), sent: () => coop.sentCommands() });

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
  // clés qui signent nos messages d'invité : gardées le temps de l'onglet (après un
  // rechargement, l'hôte nous reconnaît encore)
  keyStore: {
    load: () => {
      try {
        return JSON.parse(sessionStorage.getItem(`jardin-esprits.cles.${profile.id}`) || 'null');
      } catch {
        return null;
      }
    },
    save: (v) => {
      try {
        sessionStorage.setItem(`jardin-esprits.cles.${profile.id}`, JSON.stringify(v));
      } catch {}
    },
  },
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
const map = new MapScreen($('screen-map'), (entry, unlocked) => openLevelCard(entry, unlocked), { sound: (name, data) => sound.play(name, data) });

// Données de tous les niveaux (nom, leçon, défi, mode Difficile) : carte, accueil.
let levelsLoaded = null;
let levelData = {};
function loadAllLevels() {
  if (!levelsLoaded) {
    levelsLoaded = Promise.all(order.map((o) => loadLevel(o.id).then((l) => [o.id, l]).catch(() => [o.id, null]))).then((list) => (levelData = Object.fromEntries(list.filter((x) => x[1]))));
  }
  return levelsLoaded;
}

// Une fenêtre appartient à son écran : les feuilles des menus (salon, réglages, fiche de
// niveau) se ferment à chaque changement d'écran, les autres quand l'écran change
// vraiment (ex. menu de pause d'un invité qui quitte le salon). Fermeture sans rappel :
// l'écran suivant décide de la suite.
function closeSheetsFor(prev, next) {
  if (modal.classList.contains('hidden')) return;
  if (modal.firstElementChild.classList.contains('menu-sheet') || prev !== next) closeModal('screen', true);
}

function showScreen(name, opts = {}) {
  const leaving = state.screen === 'game' && name !== 'game';
  closeSheetsFor(state.screen, name);
  state.screen = name;
  title.hide();
  map.hide();
  screenGame.classList.toggle('active', name === 'game');
  // écran « Tournez votre téléphone » : en partie, il dit ce que devient la partie
  $('rotate-sub').textContent = name === 'game' ? (state.coopRole === 'guest' ? 'La partie continue chez l’hôte' : 'La partie est en pause') : '';
  if (leaving) leaveCoopGame();
  if (name === 'title') {
    title.show();
    ensureSalon();
    updateHome();
  }
  if (name === 'map') {
    map.show(order, worlds, save, { justCleared: opts.justCleared });
    const got = save.totalStars(order);
    $('map-stars').innerHTML = `${digitsOf(got)}<span class="map-stars-of">/${digitsOf(order.length * 3)}</span>`;
    $('map-stars').parentElement.setAttribute('aria-label', `${got} étoiles sur ${order.length * 3}`);
    loadAllLevels().then((levels) => state.screen === 'map' && map.setLevels(levels));
  }
  // un message hors partie (« Vous avez rejoint le salon… ») ne suit pas dans la partie :
  // il restait sur la rangée d'action, à côté du message du couloir (deux à la fois)
  if (name === 'game') $('app-toast')?.classList.remove('show');
  if (name !== 'game') {
    state.game = null;
    musicHold = null;
    sound.intensity = 0;
    $('coop-roster')?.classList.add('hidden');
    $('coop-wait')?.classList.add('hidden');
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

// Accueil : le héros joue (Continuer / Jouer), « Niveaux » ouvre la carte, « À plusieurs »
// le salon ; son et réglages en haut à droite.
$('btn-play').addEventListener('click', () => heroAction());
$('btn-levels').addEventListener('click', () => showScreen('map'));
$('btn-multi').addEventListener('click', () => openSalon());
// Cinq touchers rapides sur le titre : panneau de débogage (caché).
// (pointerdown : les touchers rapprochés ne sont pas avalés par l'anti double-tap d'iOS)
document.querySelector('#screen-title .title-wrap')?.addEventListener('pointerdown', () => debug.tap());
$('btn-title-sound').addEventListener('click', () => {
  setMuted(!save.data.muted);
  syncSoundButton();
});
$('btn-title-settings').addEventListener('click', () => openSettings());
$('btn-map-back').addEventListener('click', () => showScreen('title'));
function syncSoundButton() {
  const b = $('btn-title-sound');
  b.setAttribute('aria-pressed', String(!save.data.muted));
  b.classList.toggle('off', !!save.data.muted);
}

// En-tête d'une feuille des menus : sceau (ou image), titre h2, sur-titre, ✕.
const X_ICON = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>';
function menuHead(seal, heading, { kicker = '', sealCls = '' } = {}) {
  return `<div class="sheet-head menu-head"><span class="menu-seal ${sealCls}" aria-hidden="true">${seal}</span><div class="menu-titles">${kicker ? `<small class="menu-kicker">${kicker}</small>` : ''}<h2 class="menu-title">${heading}</h2></div><button type="button" class="sheet-close menu-x" data-act="close" aria-label="Fermer">${X_ICON}</button></div>`;
}
// (le ✕ d'une feuille des menus : la carte de la fenêtre est partagée, un `onclick` par vue)
function closeOnX(card, extra = null) {
  card.onclick = (e) => {
    if (e.target.closest('[data-act="close"]')) return closeModal('close');
    extra?.(e);
  };
}

// Charge un niveau ; s'il est introuvable (hors ligne et jamais mis en cache),
// le dit au joueur au lieu d'ignorer le toucher.
async function fetchLevel(id) {
  try {
    return await loadLevel(id);
  } catch {
    const card = showModal(
      `${menuHead('封', 'Niveau indisponible', { sealCls: 'ink' })}<p class="menu-p">Ce niveau n’est pas encore enregistré pour le jeu hors ligne. Ouvrez le jeu une fois connecté pour le télécharger.</p>`,
      [{ label: 'Niveaux', cls: 'secondary', run: () => showScreen('map') }],
      { sheet: true, veil: true, cls: 'menu-sheet' },
    );
    closeOnX(card);
    return null;
  }
}

// Règles du niveau : puces qui s'expliquent d'un toucher.
const RULES = {
  stones: ['石', 'Pierres', 'Posez des pierres sur le gravier : le chemin des yokai s’allonge.'],
  rewind: ['巻', 'Rembobinage', 'Jauge pleine : glissez-la (ou touchez-la deux fois) pour remonter le temps de 6 s.'],
  slots: ['刻', 'Socles réservés', 'Un socle gravé d’un élément n’accepte que les lanternes de cet élément.'],
};

// Fiche de niveau : feuille moyenne, modale (§6.18). Divulgation progressive : les
// variantes (Difficile, défi) n'apparaissent qu'après une première victoire.
async function openLevelCard(entry, unlocked) {
  if (!unlocked) {
    const prev = order[entry.index - 1];
    const prevName = prev && levelData[prev.id]?.name;
    const card = showModal(
      `${menuHead('封', 'Niveau scellé', { kicker: `Niveau ${entry.index + 1}`, sealCls: 'ink' })}<p class="menu-p">Gagnez ${prev ? `<b>${prev.id}${prevName ? ` · ${esc(prevName)}` : ''}</b>` : 'le niveau précédent'} pour briser le sceau.</p>`,
      [{ label: 'Fermer', cls: 'secondary' }],
      { sheet: true, veil: true, cls: 'menu-sheet level-sealed' },
    );
    closeOnX(card);
    return;
  }
  const level = await fetchLevel(entry.id);
  if (!level || state.screen !== 'map') return;
  const world = worldById(level.world);
  const rec = save.level(entry.id);
  const stars = rec.stars;
  // Lanternes du niveau, regroupées par élément (forme + kanji + libellé + nombre).
  const counts = new Map();
  for (const t of level.towers || Object.keys(defs.towers)) {
    if (!defs.towers[t]) continue;
    const el = elementOfTower(t, defs);
    counts.set(el, (counts.get(el) || 0) + 1);
  }
  const towers = [...counts].map(([el, n]) => `<span class="lv-el">${badgeOf(el, defs, { size: 20, label: true })}${n > 1 ? `<small>×${n}</small>` : ''}</span>`).join('');
  const news = (level.introduce || []).filter((e) => defs.enemies[e]);
  const rules = [level.stones ? 'stones' : null, level.rewind ? 'rewind' : null, typedSlots(level) ? 'slots' : null].filter(Boolean);
  const opts = { hard: false, challenge: false };
  const variants = stars > 0; // première victoire : Difficile et défi se dévoilent
  // tout premier niveau, jamais rien gagné : en-tête, leçon, yokai, Jouer (§6.18) ; ni
  // « Lanternes » ni « Socles réservés » (le tutoriel les présente en jouant)
  const firstEver = entry.index === 0 && !Object.keys(save.data.stars || {}).length;
  const hardOk = !!level.hard && save.hardUnlocked(entry.id);
  const ch = level.challenge;
  const sw = '<span class="switch lv-switch" aria-hidden="true"></span>';
  const hardText = level.hard ? hardSummary(level.hard) : '';
  const recordStars = `<div class="lv-record" role="img" aria-label="Record : ${stars} étoile${stars > 1 ? 's' : ''} sur 3">${[0, 1, 2].map((k) => `<i class="${k < stars ? 'on' : ''}"></i>`).join('')}</div>`;
  const options = [
    level.hard
      ? hardOk
        ? `<button type="button" class="lv-opt hard" data-opt="hard" aria-pressed="false"><span class="lv-seal hard" aria-hidden="true">難</span><span class="lv-opt-text"><b>Difficile${rec.hard ? ` <em>· gagné ${'★'.repeat(rec.hard)}</em>` : ''}</b><small>${hardText}</small></span>${sw}</button>`
        : `<div class="lv-opt locked"><span class="lv-seal hard" aria-hidden="true">難</span><span class="lv-opt-text"><b>Difficile</b><small>S’ouvre après 3 ★ dans ce niveau</small></span><span class="lv-lock" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="currentColor"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></span></div>`
      : '',
    ch ? `<button type="button" class="lv-opt challenge" data-opt="challenge" aria-pressed="false"><span class="lv-seal ch${rec.challenge ? ' done' : ''}" aria-hidden="true">挑</span><span class="lv-opt-text"><b>Défi : ${ch.name}${rec.challenge ? ' <em>· réussi</em>' : ''}</b><small>${ch.desc || ''}</small></span>${sw}</button>` : '',
  ].join('');
  const card = showModal(
    `${menuHead(world.kanji.charAt(0), esc(level.name), { kicker: `Niveau ${entry.index + 1} · ${esc(world.name)}`, sealCls: 'lv-world' })}
     <div class="lv-body">
       <div class="lv-subrow"><p class="lv-sub">${esc(level.subtitle || '')}</p>${recordStars}</div>
       ${level.concept ? `<div class="lv-concept"><span class="lv-concept-k" aria-hidden="true">学</span><span><small>Leçon</small><b>${esc(level.concept)}</b></span></div>` : ''}
       ${
         news.length
           ? `<section class="lv-sec"><h3 class="menu-sec">Nouveaux yokai</h3><div class="lv-yokai">${news
               .map((e) => `<button type="button" class="lv-yk" data-enemy="${e}" aria-expanded="false"><img alt="" src="${portraitOf(defs, e, null, 48)}"><span>${esc(defs.enemies[e].name)}</span></button>`)
               .join('')}</div><p class="lv-info lv-yk-info hidden" role="status"></p></section>`
           : ''
       }
       ${firstEver ? '' : `<section class="lv-sec lv-inline"><h3 class="menu-sec">Lanternes</h3><div class="lv-els">${towers}</div></section>`}
       ${rules.length && !firstEver ? `<section class="lv-sec lv-inline"><h3 class="menu-sec">Règles</h3><div class="lv-rules">${rules.map((r) => `<button type="button" class="lv-rule" data-rule="${r}" aria-expanded="false"><b aria-hidden="true">${RULES[r][0]}</b>${RULES[r][1]}</button>`).join('')}</div><p class="lv-info lv-rule-info hidden" role="status"></p></section>` : ''}
       ${variants && options ? `<section class="lv-sec"><h3 class="menu-sec">Variantes</h3><div class="lv-options">${options}</div></section>` : ''}
       ${coopReady() ? teamLine() : ''}
     </div>`,
    [{ label: 'Jouer', cls: 'primary L lv-play', run: () => startLevel(entry.id, { ...opts }) }],
    { sheet: true, veil: true, cls: 'menu-sheet level-card', actionsCls: 'lv-actions' },
  );
  const play = card.querySelector('.actions .btn.primary');
  const info = (box, key, text) => {
    const same = box.dataset.key === key && !box.classList.contains('hidden');
    box.dataset.key = key;
    box.textContent = text;
    box.classList.toggle('hidden', same);
    return !same;
  };
  closeOnX(card, (e) => {
    const yk = e.target.closest('.lv-yk');
    if (yk) {
      const d = defs.enemies[yk.dataset.enemy];
      const open = info(card.querySelector('.lv-yk-info'), yk.dataset.enemy, `${d.name} — force : ${d.strength || d.desc}. Faiblesse : ${d.weakness || '—'}.`);
      for (const b of card.querySelectorAll('.lv-yk')) b.setAttribute('aria-expanded', String(open && b === yk));
      sound.play('select');
      return;
    }
    const rule = e.target.closest('.lv-rule');
    if (rule) {
      const open = info(card.querySelector('.lv-rule-info'), rule.dataset.rule, RULES[rule.dataset.rule][2]);
      for (const b of card.querySelectorAll('.lv-rule')) b.setAttribute('aria-expanded', String(open && b === rule));
      sound.play('select');
      return;
    }
    const b = e.target.closest('.lv-opt[data-opt]');
    if (!b) return;
    const k = b.dataset.opt;
    opts[k] = !opts[k];
    b.setAttribute('aria-pressed', String(opts[k]));
    b.classList.toggle('on', opts[k]);
    b.querySelector('.lv-switch')?.classList.toggle('on', opts[k]);
    const modes = [opts.hard ? 'Difficile' : '', opts.challenge ? 'Défi' : ''].filter(Boolean).join(' · ');
    play.innerHTML = modes ? `Jouer<small class="btn-sub">${modes}</small>` : 'Jouer';
    play.setAttribute('aria-label', modes ? `Jouer : ${modes}` : 'Jouer');
    sound.play('select');
  });
}

// Salon hébergé, en ligne, avec au moins un invité : « Jouer » lance pour tous.
function coopReady() {
  return session.isHost && session.online && (session.lobby?.players.length ?? 0) > 1;
}

// Fiche de niveau de l'hôte : qui partira avec lui (sceau d'élément + nom).
// À plusieurs, chacun n'a que son élément (attribué d'office à qui n'a rien choisi).
function teamLine() {
  const list = coop.playersFromLobby();
  const chips = list
    .map((p) => {
      const el = p.element || p.elements?.[0];
      const auto = !p.element && el ? ' <small>(attribué)</small>' : '';
      return `<span class="lv-mate">${el ? badgeOf(el, defs, { size: 18 }) : ''}${esc(p.name)}${auto}</span>`;
    })
    .join('');
  return `<section class="lv-sec"><h3 class="menu-sec">Partent avec vous · ${list.length}</h3><p class="lv-line lv-team">${chips}</p><p class="lv-line lv-team-note">Chacun ne pose que les lanternes de son élément.</p></section>`;
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
// showModal(html, buttons, opts) — contrat entre lots (docs/UI-UX.md §9.4) :
//   opts.sheet : true | 'medium' | 'large' → feuille du bas (true = moyenne) ; sinon carte centrée.
//   opts.veil : voile (toucher = fermer), pour les feuilles hors partie ; en partie, sans voile,
//               le plateau reste visible et touchable (pause, combos).
//   opts.grabber : poignée (vrai par défaut pour une feuille) ; glisser vers le bas ferme.
//   opts.onClose(raison) : feuille fermée par le voile, la poignée ou closeModal().
//   opts.cls, opts.actionsCls, opts.column : classes de la carte et de la rangée d'actions.
// Bouton : { label, html (libellé en HTML), cls, aria, keep (ne ferme pas), run(el),
//            confirm: 'Confirmer…' (second toucher exigé, armConfirm) }.
let modalOnClose = null;
const modalCard = modal.firstElementChild;
const modalSheet = attachSheet(modalCard, {
  enabled: () => modal.classList.contains('as-sheet'),
  largeTop: () => (state.screen === 'game' ? $('hud-top').getBoundingClientRect().bottom + 8 : modal.getBoundingClientRect().top + parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat') || 0) + 56),
  onClose: () => closeModal('drag'),
});
function showModal(html, buttons, opts = {}) {
  const card = modalCard;
  const sheet = opts.sheet ? (opts.sheet === 'large' ? 'large' : 'medium') : null;
  modal.classList.toggle('as-sheet', !!sheet);
  modal.classList.toggle('veil', !!(sheet && opts.veil));
  modal.classList.remove('peek');
  // classe propre à la fenêtre (résultat : voile léger, plateau visible)
  if (modal.dataset.cls) modal.classList.remove(...modal.dataset.cls.split(' '));
  modal.dataset.cls = opts.modalCls || '';
  if (opts.modalCls) modal.classList.add(...opts.modalCls.split(' '));
  modalOnClose = opts.onClose || null;
  modalSheet.reset();
  // « scroll » : la carte défile au doigt si elle dépasse l'écran (B28).
  card.className = `modal-card scroll${sheet ? ` sheet-card${sheet === 'large' ? ' sheet-large' : ''}` : ''}${opts.cls ? ' ' + opts.cls : ''}`;
  card.onclick = null; // gestionnaire propre à une vue (table des combos)
  const grab = sheet && opts.grabber !== false ? '<span class="sheet-grabber" aria-hidden="true"></span>' : '';
  card.innerHTML = grab + html + `<div class="actions${opts.column ? ' col' : ''}${opts.actionsCls ? ' ' + opts.actionsCls : ''}"></div>`;
  const box = card.querySelector('.actions');
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls || '');
    if (b.html) el.innerHTML = b.label;
    else el.textContent = b.label;
    if (b.aria) el.setAttribute('aria-label', b.aria);
    const go = () => {
      if (b.keep !== true) closeModal('button', true);
      b.run?.(el);
    };
    el.addEventListener('click', () => (b.confirm ? armConfirm(el, { label: b.confirm, run: go }) : go()));
    box.appendChild(el);
  }
  modal.classList.remove('hidden');
  card.scrollTop = 0;
  return card;
}
// Ferme la fenêtre. `silent` : sans rappel onClose (un bouton a sa propre action).
function closeModal(reason = 'close', silent = false) {
  if (modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  const f = modalOnClose;
  modalOnClose = null;
  if (!silent) f?.(reason);
}
// Toucher le voile (feuille modale hors partie) : fermer.
modal.addEventListener('click', (e) => {
  if (e.target === modal && modal.classList.contains('veil')) closeModal('veil');
});
const modalOpen = () => !modal.classList.contains('hidden');
const pauseSheetOpen = () => modalOpen() && modal.classList.contains('as-sheet') && state.screen === 'game';

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
  barClosed: (id) => towerBar.isClosedFor(id),
  reopenBar: (id) => towerBar.reopen(id),
  onInfo: (target) => showInfo(target),
  onFeedback: (kind, data) => feedback(kind, data),
  onAction: (kind, data) => {
    if (kind === 'selectTower' || kind === 'dragStart') sound.play('select');
    if (kind === 'placed') {
      // la pose répond au relâchement du doigt (son « build », < 100 ms) ; en
      // construction 2 s : « Annuler » pendant la construction, puis 3 s
      sound.play('build', { x: data.c + 0.5 });
      renderer.dropGhost?.(data);
      hud.showUndo(data.ticket, 'tower');
      hud.popTool(data.type);
      // Défi « N lanternes au plus » : le compte des poses (constructions comprises), sous les yeux
      const rule = state.game?.challengeRule;
      if (rule?.maxTowers != null) {
        const p = renderer.toScreen(data.c + 0.5, data.r + 0.3);
        input.flash(`挑 ${state.game.stats.towersBuilt + hud.buildingTowers()}/${rule.maxTowers} lanternes`, p.x, p.y);
      }
    }
    if (kind === 'stone') {
      sound.play('build', { x: data.c + 0.5 });
      hud.popTool('stone');
      hud.showUndo(data.ticket, 'stone');
    }
    if (kind === 'rally') {
      // le mur se dessine sur la case touchée et s'y dresse après la construction
      sound.play('build', { x: data.c + 0.5 });
      hud.lane.clear('rally');
      hud.showUndo(data.ticket, 'rally');
      const p = renderer.toScreen(data.c + 0.5, data.r - 0.1);
      input.flash('Le mur se déplace…', p.x, p.y);
    }
    if (kind === 'fused' || kind === 'fuseCancel') endFuseMode();
    if (kind === 'slot') slotFirst(data);
    if (kind === 'placed' || kind === 'toolCleared' || kind === 'selectTower' || kind === 'stone' || kind === 'slot') hud.refreshTools();
  },
  onHold: (st, p, ms) => holdRing(st, p, ms),
  // Un toucher sur le plateau ferme la fiche ouverte.
  onBoardTouch: () => sheets.close(),
});

// Retours d'un geste : refus écrit près du fantôme (plus de toast sur les portails),
// « Annulé » discret, son de refus.
function feedback(kind, data = {}) {
  if (kind === 'reject') {
    // le refus s'écrit près du geste, au-dessus du socle visé (jamais dans un message global)
    const short = data.reason === 'gold' && data.missing ? `Il manque ${data.missing} or` : data.reason === 'challenge' ? challengeShort() : hud.shortReason(data.reason, data);
    const text = short || hud.reason(data.reason, data);
    if (text && data.c != null && state.game?.grid.inBounds(data.c, data.r)) {
      const p = renderer.toScreen(data.c + 0.5, data.r + 0.5);
      input.flash(text, p.x, p.y, true, { c: data.c, r: data.r });
    } else if (text && data.x != null) input.flash(text, data.x, data.y, true);
    // Premier refus sur un socle réservé : la règle, une fois, en clair (couloir).
    if (data.reason === 'slotElement' && !state.slotRefuseShown) {
      state.slotRefuseShown = true;
      hud.say({ key: 'slot-rule', text: hud.reason('slotElement', data), prio: 1 });
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
  } else if (kind === 'fuseCancel') {
    if (data.x != null) input.flash('Fusion annulée', data.x, data.y);
    sound.play('tap');
  }
}

// Libellé écrit à côté du fantôme de pose (raison du refus, gain de chemin).
renderer.pressLabel = (press) => {
  if (!press || press.c == null) return null;
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
  return { text: hud.shortReason(press.reason, press) || 'Impossible', tone: 'bad' };
};

// Constructions en cours (lanternes, pierres, murs : file du moteur et poses
// provisoires du réseau), dessinées par le rendu ; liseré à la couleur de l'élément
// du joueur qui construit (coéquipiers).
renderer.constructions = () => (state.game ? commands.builds() : []);
// fusions et ventes en route (coopération : elles s'exécutent après le délai des commandes)
renderer.towerOps = () => (state.game ? commands.towerOps() : null);
renderer.buildOwner = (pid) => playerInfo(pid);

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
      hud.tipAt($('btn-speed'), 'La vitesse est réglée par l’hôte');
      return;
    }
    setSpeed(state.speed === 1 ? 2 : 1);
    sound.play('select');
  },
  onTool: (tool) => {
    sound.play('select');
    // Premier choix d'une lanterne dans un niveau à socles réservés : la règle, une fois
    // (le tutoriel la dit déjà dans sa bulle de pose).
    const g = state.game;
    if (tool && tool !== 'stone' && g && !state.slotHintShown && g.grid.slotElement?.some(Boolean) && !g.level.tutorial?.includes('place')) {
      state.slotHintShown = true;
      hud.say({ key: 'slot-rule', text: '刻 Socles réservés ▲ ● ◆ ■ : chacun n’accepte que son élément', prio: 1 });
    }
  },
  // socle d'abord : une carte touchée pose aussitôt sur le socle choisi
  onToolPick: (id) => pickTool(id),
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
  // un yokai que le niveau présente et qui n'est pas encore apparu : « nouveau »
  isNew: (type) => !!state.game && (state.game.level.introduce || []).includes(type) && !state.introduced.has(type),
  // couloir de messages : ni portails, ni sanctuaire, ni barre d'actions, ni bulle du tutoriel
  laneAvoid: () => laneAvoid(),
  laneTop: () => (bossbar.classList.contains('hidden') ? 10 : bossbar.offsetTop + bossbar.offsetHeight + 6),
  laneHold: () => tutorial.showing || state.lastChance || state.resultShown,
  onLaneAct: (a) => laneAct(a),
  // message sans action touché : il s'efface et le geste continue sur le plateau dessous
  onLanePass: (e) => input.onDown(e),
  // … de même pour un message à action posé sur une lanterne ou une construction
  laneOverBoard: (e) => {
    const g = state.game;
    if (!g) return false;
    const r = canvas.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const t = renderer.toTile(p.x, p.y);
    return !!input.towerNear(p) || (g.grid.inBounds(t.c, t.r) && !!commands.buildAt(t.c, t.r));
  },
});

// Zones du plateau (repère de #stage) que le couloir de messages ne couvre jamais.
let laneAvoidCache = { key: '', rects: [] };
function laneAvoid() {
  const g = state.game;
  if (!g) return [];
  const key = `${renderer.ts}|${renderer.ox}|${renderer.oy}|${g.grid.cols}`;
  if (laneAvoidCache.key !== key) {
    const rects = [];
    const ts = renderer.ts;
    for (const i of [...g.grid.spawns, ...g.grid.goals]) {
      const p = renderer.toScreen(g.grid.col(i), g.grid.row(i));
      rects.push({ l: p.x - 6, t: p.y - 6, r: p.x + ts + 6, b: p.y + ts + 6 });
    }
    laneAvoidCache = { key, rects };
  }
  const out = [...laneAvoidCache.rects];
  const st = stage.getBoundingClientRect();
  const rel = (r) => ({ l: r.left - st.left, t: r.top - st.top, r: r.right - st.left, b: r.bottom - st.top });
  const bar = $('tower-bar');
  if (!bar.classList.contains('hidden')) out.push(rel(bar.getBoundingClientRect()));
  const bubble = $('hint').querySelector('.bubble');
  if (bubble && !$('hint').classList.contains('hidden')) out.push(rel(bubble.getBoundingClientRect()));
  // Lanternes, constructions et échos : à éviter aussi, mais après S, G, la barre et la
  // bulle (poids faible : départage les places qui ne couvrent rien de tout cela). Un
  // message en haut du plateau cachait (et prenait le doigt de) la lanterne dessous.
  const ts = renderer.ts;
  const cell = (c, r) => {
    const p = renderer.toScreen(c, r - 0.4);
    return { l: p.x + 2, t: p.y, r: p.x + ts - 2, b: p.y + ts * 1.4 - 2, w: 0.01 };
  };
  for (const t of g.towers) out.push(cell(t.c, t.r));
  for (const e of g.echoes || []) out.push(cell(e.c, e.r));
  for (const b of commands.builds()) if (b.op === 'placeTower') out.push(cell(b.c, b.r));
  return out;
}

// Toucher un message du couloir : son action liée.
function laneAct(a) {
  if (!a || !state.game) return;
  if (a.kind === 'enemy') {
    const e = state.game.enemies.find((x) => x.type === a.type && x.alive);
    sheets.open('enemy', { type: a.type, enemy: e || null, absorb: e?.absorb ?? a.absorb ?? null });
  } else if (a.kind === 'combos') openComboTable(a.id, true);
}

// Bouton de vague : lancer la première, puis appeler la suivante en avance (à
// tout moment, même pendant une vague : bonus d'or et charge de Rembobinage).
function callWave() {
  const g = state.game;
  // En pause, on étudie le plateau sans rien changer (une fiche passée en haut de
  // l'écran découvre la barre du bas) ; le menu d'un invité, lui, ne fige rien.
  if (!g || g.rewindAnim || coopFrozen() || pausedHere()) return;
  if (!commands.check('startNextWave').ok) return;
  // Double toucher accidentel : le bouton montre aussitôt la vague suivante, un
  // second toucher rapproché l'appelait aussi (deux vagues d'un coup).
  const now = performance.now();
  if (now - (state.waveCallAt ?? -1e9) < 350) return;
  const e = commands.issue('startNextWave');
  if (e && !(e.done && !e.ok)) {
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

// ── Socle d'abord (docs/UI-UX.md §6.7) : toucher un socle libre sans outil le choisit
// (anneau or) ; réservé, la palette montre son élément et grise les cartes interdites ;
// toucher une carte pose aussitôt sur ce socle ; toucher ailleurs annule.
function slotFirst(slot) {
  hud.setSlotFilter(slot || null);
  if (slot) hud.say({ key: 'slot-first', text: '建 Choisissez une lanterne', detail: slot.element ? `Socle réservé ${toElementName(slot.element)}` : 'pour ce socle', prio: 3 });
  else hud.lane.clear('slot-first');
}

function toElementName(el) {
  const info = elementInfo(el, defs);
  return `${info.glyph} ${info.label}`;
}

// Une carte de la palette touchée : outil choisi, ou pose immédiate sur le socle choisi.
// Renvoie l'outil (comme input.setTool) ou false si la pose est partie.
function pickTool(id) {
  const slot = input.ui.selectedSlot;
  if (!slot || id === 'stone') {
    if (slot) clearSlot();
    return input.setTool(id);
  }
  const g = state.game;
  const res = commands.check('placeTower', id, slot.c, slot.r);
  if (!res.ok) {
    feedback('reject', { reason: res.reason, element: res.element, owner: res.owner, c: slot.c, r: slot.r, missing: res.reason === 'gold' ? commands.missing(id) : 0 });
    if (g) g.emit('reject', { c: slot.c, r: slot.r, reason: res.reason });
    return false;
  }
  const ticket = commands.issue('placeTower', id, slot.c, slot.r);
  clearSlot();
  if (ticket) input.h.onAction?.('placed', { type: id, c: slot.c, r: slot.r, ticket });
  return false;
}

function clearSlot() {
  if (!input.ui.selectedSlot) return;
  input.ui.selectedSlot = null;
  slotFirst(null);
}

// ── Fusion guidée (§6.8) : « Fusionner » allume les jumelles ; toucher une jumelle
// l'absorbe dans la lanterne choisie ; toucher ailleurs annule.
function startFuseMode(t) {
  if (input.inspect) return; // pause : ni pose ni fusion (la consigne serait impossible à suivre)
  sound.play('select');
  input.setFuse(t.id);
  hud.say({ key: 'fuse', text: '合 Touchez la jumelle à absorber', detail: 'ailleurs : annuler', prio: 3 });
}

function endFuseMode() {
  if (input.ui.fuseFrom != null) input.setFuse(null);
  hud.lane.clear('fuse');
}

// « Annuler » : commande 'cancel' de la pose (en construction : rien n'est payé ;
// juste après son activation : la lanterne est reprise, son prix rendu).
function undoPlace(ticket) {
  const g = state.game;
  if (!g || !ticket) return;
  const entry = commands.entryOf(ticket);
  const towerId = entry?.done ? entry.result : null;
  const res = commands.cancel(ticket);
  // (exécutée aussitôt en solo ; en coopération, après le délai des commandes)
  if (res && !(res.done && !res.ok)) {
    hud.hideUndo();
    sound.play('undo');
    hud.refreshTools();
    if (towerId != null && input.ui.selectedTower === towerId) input.ui.selectedTower = null;
  } else {
    hud.tipAt($('btn-undo'), 'Trop tard pour annuler', { bad: true });
    hud.hideUndo();
  }
}

// Construction touchée, puis « Annuler » (barre « En construction »).
function cancelBuild(build) {
  if (!build?.mine) return;
  const res = commands.cancel(build.ticket);
  if (hud.undo?.ticket && (hud.undo.ticket === build.ticket || commands.entryOf(hud.undo.ticket) === build.entry)) hud.hideUndo();
  if (res && !(res.done && !res.ok)) {
    sound.play('undo');
    hud.refreshTools();
  } else {
    const p = renderer.toScreen(build.c + 0.5, build.r + 0.5);
    input.flash('Trop tard pour annuler', p.x, p.y, true, { c: build.c, r: build.r });
  }
}

// Barre d'actions de la lanterne sélectionnée.
const towerBar = new TowerBar($('tower-bar'), {
  game: () => state.game,
  input,
  renderer,
  sheetOpen: () => sheets.isOpen,
  onPriority: (t, p) => changePriority(t, p),
  onRally: (t) => toggleRally(t),
  onSheet: (t) => {
    sound.play('select');
    sheets.open('tower', t.id);
  },
  onSell: (t) => sellTower(t),
  onFuse: (t) => startFuseMode(t),
  onCancelBuild: (b) => cancelBuild(b),
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
  hud.say({ key: 'rally', text: '壁 Touchez une case allumée du chemin', detail: 'ailleurs : annuler', prio: 3 });
}

// Priorité de ciblage : la valeur choisie dans la barre d'actions, sinon la suivante.
function changePriority(t, value = null) {
  const g = state.game;
  const p = value ? (commands.issue('setPriority', t.id, value) ? value : null) : cyclePriority(g, t);
  if (!p) return;
  sound.play('select');
  renderer.fx.ring(t.x, t.y + 0.3, 0.1, 0.62, PALETTE.gold, 0.45, 0.06, 0.45);
  const s = renderer.toScreen(t.x, t.y - 0.6);
  input.flash(`Cible : ${priorityInfo(p).label}`, s.x, s.y);
}

function sellTower(t) {
  const g = state.game;
  if (!g.towerById(t.id)) hud.toast('Cette lanterne n’existe plus', true);
  else commands.issue('sellTower', t.id);
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
  onPriority: (t, value) => changePriority(t, value),
  onRally: (t) => toggleRally(t),
  onFuse: (t) => startFuseMode(t),
  onCombo: (id) => openComboTable(id),
  // grande hauteur : 8 px sous le HUD
  largeTop: () => $('hud-top').getBoundingClientRect().bottom + 8,
  onSelectTool: (type) => {
    // (setTool refuse une lanterne qui n'est pas de l'élément du joueur)
    if (input.ui.tool !== type) input.setTool(type);
    hud.refreshTools();
    hud.popTool(type);
    sound.play('select');
  },
  onRemoveStone: (c, r) => commands.issue('removeStone', c, r),
  onCallWave: () => callWave(),
  onEnemy: (type, absorb) => sheets.open('enemy', { type, absorb }),
  owner: (pid) => playerInfo(pid),
});

function setSpeed(s) {
  state.speed = s;
  const b = $('btn-speed');
  b.firstElementChild.textContent = `×${s}`;
  b.classList.toggle('on', s > 1);
  b.setAttribute('aria-label', `Vitesse ×${s}${state.coopRole === 'guest' ? ' (réglée par l’hôte)' : ''}`);
}

const gauge = new RewindGauge($('rewind'), {
  game: () => state.game,
  onRewind: () => !coopFrozen() && !pausedHere() && !!commands.issue('rewind'),
  // Simple indication (pas d'erreur rouge ni de son de refus) : la jauge réduite
  // dit comment elle se remplit ; un appui long ouvre la règle.
  onRefuse: (why, pct) => {
    const msg = {
      charge: `${pct} % : se remplit en apaisant des yokai et en appelant les vagues en avance`,
      wave: 'Pleine : utilisable pendant une vague',
      short: 'Le passé s’accumule encore…',
      // (coopération) déjà demandé, il part après le délai des commandes
      coming: 'Le temps va reculer…',
    }[why];
    // écrit près du doigt, au-dessus de la jauge (appui long : la règle)
    if (msg) hud.tipAt($('rewind'), msg);
  },
  onInfo: () => {
    sound.play('select');
    sheets.open('rewind');
  },
  onHold: (st, p, ms) => holdRing(st, p, ms),
  // arc fantôme : la charge qu'apporterait un appel anticipé maintenant
  ghost: () => {
    const g = state.game;
    const pv = g?.nextWavePreview?.();
    return g && g.waveIndex >= 0 && commands.check('startNextWave').ok ? earlyCharge(g, pv) : 0;
  },
  onArm: (on) => {
    if (on) sound.play('select');
  },
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

// Partie figée par sa propre pause (solo, hôte) : ni appel de vague ni rembobinage.
function pausedHere() {
  return state.paused && state.coopRole !== 'guest';
}

function setPaused(p) {
  state.paused = p;
  $('btn-pause').classList.toggle('on', p);
  // « Annuler » ne dépasse plus à moitié de la feuille de pause (une construction en
  // cours s'annule encore en la touchant : barre « En construction »)
  screenGame.classList.toggle('pause-on', p);
  // En pause, le plateau reste consultable (toucher, appui long), sans pose ni fusion.
  input.inspect = p;
  input.enabled = true;
  if (p) input.cancel();
  // Invité : son menu ne fige rien (la partie continue chez l'hôte), la musique non plus.
  if (state.coopRole === 'guest') return;
  holdMusic(p);
  // Hôte : sa pause est celle de tous, à la même image chez chacun (annoncée tout de
  // suite par un battement, effective 10 images plus tard).
  if (state.coopRole === 'host' && coop.isHost && !state.resultShown) coop.setPaused(p);
}

function resumeFromPause() {
  modal.classList.add('hidden');
  sheets.close();
  setPaused(false);
  applyHand(); // (les Réglages ouverts depuis la pause ont pu changer de main)
}

// « Bouton de vague à gauche » (réglage, gaucher) : rangée d'action inversée.
function applyHand() {
  screenGame.classList.toggle('left-handed', !!save.data.leftHanded);
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

// Pause (docs/UI-UX.md §6.10) : feuille du bas non modale (sans voile, le plateau reste
// visible et touchable pour étudier la carte), hiérarchisée : « Reprendre » seul en
// vermillon ; Combos ; réglages rapides (Son, Musique, Effets, Réglages) ; puis, sous un
// trait de pinceau, « Recommencer » et « Quitter » discrets, confirmés par un second
// toucher. Coopération : la pause de l'hôte arrête la partie pour tous ; le menu d'un
// invité ne l'arrête pas (« La partie continue »).
const ICONS = {
  // son et musique : l'icône dit l'état (haut-parleur barré, croche barrée quand coupés)
  sound: '<svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8h3l4-3.5v11L6 12H3z"/><path class="ico-on" d="M13.5 7.2a4 4 0 0 1 0 5.6M15.6 5a7 7 0 0 1 0 10"/><path class="ico-off" d="M13.2 7.6l4.8 4.8M18 7.6l-4.8 4.8"/></svg>',
  music: '<svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M8 15V4.5l8-1.8V13"/><ellipse cx="5.8" cy="15.2" rx="2.4" ry="1.9"/><ellipse cx="13.8" cy="13.4" rx="2.4" ry="1.9"/><path class="ico-off" d="M2.5 2.5l15 15"/></svg>',
  fx: '<svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5l1.6 4.6 4.6 1.6-4.6 1.6L10 15l-1.6-4.7-4.6-1.6 4.6-1.6z"/><path d="M15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
  settings: '<svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h14M3 14h14"/><circle cx="7" cy="6" r="2.2" fill="currentColor"/><circle cx="13" cy="14" r="2.2" fill="currentColor"/></svg>',
  restart: '<svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10a5.5 5.5 0 1 0 1.8-4.1"/><path d="M4 3.2v3.6h3.6"/></svg>',
  quit: '<svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 9.5L10 4l6.5 5.5"/><path d="M5.5 8v8h9V8"/></svg>',
  play: '<svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 4.5l9 5.5-9 5.5z" fill="currentColor"/></svg>',
};

// Effets complets / sobres (§7.4) : lu au démarrage, appliqué à toute l'interface.
function applyEffects() {
  const sober = save.data.effects === 'sober';
  document.documentElement.classList.toggle('fx-sober', sober);
  renderer.sober = sober || reduceMotion.matches;
}
applyEffects();
reduceMotion.addEventListener?.('change', applyEffects);

// Note du menu d'un invité : la partie continue, sauf si l'hôte l'a mise en pause.
function guestPauseNote() {
  return state.waitKind === 'pause' ? 'Partie en pause : l’hôte l’a arrêtée pour tous.' : 'La partie continue : seul l’hôte peut la mettre en pause.';
}

function openPauseMenu() {
  if (!state.game || state.resultShown) return;
  setPaused(true);
  sheets.close();
  endFuseMode();
  clearSlot();
  const g = state.game;
  const role = state.coopRole;
  const guest = role === 'guest';
  const host = role === 'host';
  const zones = new Set((g.zones || []).map((z) => z.def?.id));
  const totalCombos = (g.defs.combos || []).length;
  const note = guest ? guestPauseNote() : host ? 'Partie en pause pour tous les joueurs.' : '';
  const quick = (act, label, on) => `<button class="pq${on ? ' on' : ''}" data-act="${act}" aria-pressed="${on}">${ICONS[act]}<span>${label}</span></button>`;
  const sober = save.data.effects === 'sober';
  const card = showModal(
    `<div class="pause-head"><span class="seal seal-indigo seal-32 tilt" aria-hidden="true">${guest ? '間' : '休'}</span><div class="ph-text"><h2>${guest ? 'Menu' : 'Pause'}</h2><p>${esc(g.level.name)} · vague ${digitsHTML(Math.max(0, g.waveIndex + 1))}/${digitsHTML(g.totalWaves)}</p></div>${modeLine(g)}</div>
     ${note ? `<p class="pause-coop">${note}</p>` : ''}
     <div class="pause-main">
       <button class="btn primary L" data-act="resume">${ICONS.play}Reprendre</button>
       <button class="btn M pause-combos" data-act="combos" aria-label="Combos : ${zones.size} actifs sur ${totalCombos}"><span class="seal seal-indigo seal-24" aria-hidden="true">合</span>Combos<small>${zones.size ? `${digitsHTML(zones.size)} actif${zones.size > 1 ? 's' : ''}` : 'aucun actif'}</small></button>
     </div>
     <div class="pause-quick" role="group" aria-label="Réglages rapides">
       ${quick('sound', 'Son', !save.data.muted)}${quick('music', 'Musique', !!save.data.music)}${quick('fx', sober ? 'Sobres' : 'Effets', !sober)}<button class="pq" data-act="settings">${ICONS.settings}<span>Réglages</span></button>
     </div>
     <div class="pause-danger">
       ${
         guest
           ? `<button class="btn quiet S" data-act="leave">${ICONS.quit}Quitter le salon</button>`
           : // hôte : la conséquence en sous-ligne dessinée (le libellé long se cassait n'importe où)
             `<button class="btn quiet S" data-act="restart"${host ? ' aria-label="Recommencer pour tous"' : ''}>${ICONS.restart}${host ? '<span class="pd-txt">Recommencer<small>pour tous</small></span>' : 'Recommencer'}</button><button class="btn quiet S" data-act="quit"${host ? ' aria-label="Quitter : fin de la partie pour tous"' : ''}>${ICONS.quit}${host ? '<span class="pd-txt">Quitter<small>fin pour tous</small></span>' : 'Quitter la partie'}</button>`
       }
     </div>
     <p class="pause-note">Un second toucher confirme${guest ? '.' : ' : la partie sera perdue.'}</p>
     ${debug.enabled && !role ? '<button class="btn text pause-debug" data-act="debug">Débogage</button>' : ''}`,
    [],
    { sheet: true, cls: 'pause-card', onClose: () => resumeFromPause() },
  );
  card.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'resume') resumeFromPause();
    else if (act === 'combos') openComboTable();
    else if (act === 'sound') {
      setMuted(!save.data.muted);
      b.classList.toggle('on', !save.data.muted);
      b.setAttribute('aria-pressed', String(!save.data.muted));
      sound.play('select');
    } else if (act === 'music') {
      save.set('music', !save.data.music);
      sound.musicOn = save.data.music;
      b.classList.toggle('on', save.data.music);
      b.setAttribute('aria-pressed', String(save.data.music));
      sound.play('select');
    } else if (act === 'fx') {
      save.set('effects', save.data.effects === 'sober' ? 'full' : 'sober');
      applyEffects();
      const full = save.data.effects !== 'sober';
      b.classList.toggle('on', full);
      b.setAttribute('aria-pressed', String(full));
      b.querySelector('span').textContent = full ? 'Effets' : 'Sobres';
      sound.play('select');
    } else if (act === 'settings') openSettingsSheet();
    else if (act === 'restart') armConfirm(b, { label: host ? 'Tous recommencent ?' : 'Recommencer ?', run: () => startLevel(state.levelId, state.mode) });
    else if (act === 'quit') armConfirm(b, { label: host ? 'Fin pour tous ?' : 'Quitter ?', run: () => showScreen('map') });
    else if (act === 'leave') armConfirm(b, { label: 'Quitter le salon ?', run: () => quitGuestGame() });
    else if (act === 'debug') debug.open();
  };
}

// Réglages (lot MENUS, src/ui/settings.js, contrat openSettings()) : chargé à la demande.
function openSettingsSheet() {
  import('./ui/settings.js')
    .then((m) => m.openSettings?.({ from: 'pause', back: () => openPauseMenu() }))
    .catch(() => hud.say({ text: 'Réglages indisponibles hors ligne', prio: 0 }));
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
  if (g.challenge && g.level.challenge) parts.push(`<span class="mode-chip ch${state.challengeLost ? ' lost' : ''}"><b>挑</b>Défi : ${esc(g.level.challenge.name)}${state.challengeLost ? ' — manqué' : ''}</span>`);
  return parts.length ? `<p class="mode-line">${parts.join('')}</p>` : '';
}

// Le défi est-il déjà perdu ? (mêmes règles que game.challengeMet, en cours de partie)
function challengeBroken(g) {
  return !!g.challengeBroken?.();
}

// Combos (§6.11) : grande feuille, liste des 6 paires (badges, kanji et nom, effet,
// contre quoi) ; actif sur le plateau : fond or ; élément absent du niveau : estompé.
// « ‹ Pause » revient au menu, « Reprendre » reste collé en bas.
function openComboTable(focus = null) {
  const g = state.game;
  if (!g) return;
  if (!pauseSheetOpen()) openPauseMenu();
  const card = modal.firstElementChild;
  const list = comboList(g.defs, g.availableTowers, g.zones || []);
  card.className = 'modal-card scroll sheet-card sheet-large pause-card combos-card';
  card.innerHTML = `<span class="sheet-grabber" aria-hidden="true"></span><div class="sheet-head combos-head"><button class="btn text ch-back" data-act="back" aria-label="Retour à la pause">‹ Pause</button><span class="seal seal-indigo seal-32 tilt" aria-hidden="true">合</span><div class="ph-text"><h2>Combos · ${digitsHTML(list.active)}/${digitsHTML(list.total)}</h2><p>Deux éléments différents côte à côte (diagonale comprise)</p></div></div>${list.html}<div class="actions combos-actions"><button class="btn primary L" data-act="resume">${ICONS.play}Reprendre</button></div>`;
  card.scrollTop = 0;
  card.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (b?.dataset.act === 'back') openPauseMenu();
    else if (b?.dataset.act === 'resume') resumeFromPause();
  };
  if (focus) {
    const row = card.querySelector(`.combo-row[data-combo="${CSS.escape(focus)}"]`);
    if (row) {
      row.classList.add('focus');
      requestAnimationFrame(() => (card.scrollTop = Math.max(0, row.offsetTop - 90)));
    }
  }
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
    hud.say({ key: 'echo', text: `影 Écho : ${defs.towers[e.type]?.name ?? 'lanterne'} N${e.level}`, detail: `tire à ${pow} % · encore ${Math.max(1, Math.ceil(e.ttl))} s`, prio: 0 });
  }
}

// Première idée d'un texte de fiche (≤ 1 ligne du couloir) : « Vole : ignore le chemin… »
// → « Vole » ; la fiche complète est à un toucher.
function brief(text) {
  let t = String(text || '').split(/\s*[:;]\s*/)[0];
  if (t.length > 40) t = t.split(/\s*,\s*/)[0];
  return t.replace(/\.$/, '');
}

// Nouveau yokai (§6.4) : la puce de l'aperçu porte « nouveau » ; à sa première
// apparition, un message du couloir (portrait, force ; toucher = sa fiche).
function introduce(type) {
  const def = defs.enemies[type];
  if (!def) return;
  const absorb = def.abilities?.absorb ?? null;
  hud.say({
    key: `new-${type}`,
    text: `${def.boss ? 'Boss' : 'Nouveau'} : ${def.name}`,
    detail: brief(def.strength || def.desc),
    icon: `<img alt="" src="${enemyPortrait(defs, type, absorb, 28)}">`,
    prio: 1,
    action: { kind: 'enemy', type, absorb },
  });
}

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
  // entre deux parties, les joueurs partis entre-temps ne sont plus du voyage ; de même
  // quand l'hôte relance en pleine partie (« Recommencer pour tous ») : leurs éléments
  // reviennent aux autres
  if (session.isHost) {
    const relaunch = session.inGame;
    session.prune(relaunch);
    // plus personne avec lui : la partie coopérative s'arrête, il rejoue seul
    if (relaunch && !coopReady()) session.endGame(null);
  }
  if (coopReady()) {
    const players = coop.playersFromLobby();
    const seed = 1 + Math.floor(Math.random() * 1e9);
    const start = session.startGame({ level: id, seed, players, hard: mode.hard, challenge: mode.challenge, cd: COMMAND_DELAY });
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
  // le message vient du réseau : on n'accepte qu'un niveau connu du jeu, une graine
  // entière, des joueurs aux éléments connus (ils finissent dans le HTML de la palette)
  if (!order.some((o) => o.id === msg.level) || !Number.isSafeInteger(msg.seed) || !Array.isArray(msg.players) || !msg.players.length) return;
  const known = (el) => typeof el === 'string' && Object.hasOwn(defs.elements, el);
  const players = msg.players.slice(0, 4).map((p) => ({
    name: String(p?.name ?? 'Esprit').slice(0, 16),
    elements: Array.isArray(p?.elements) ? p.elements.filter(known) : [],
    element: known(p?.element) ? p.element : null,
  }));
  if (players.some((p) => !p.elements.length)) return;
  // délai des commandes (images) : le même chez tous, sans quoi les parties divergent
  const cd = Number.isSafeInteger(msg.cd) && msg.cd >= 0 && msg.cd <= 300 ? msg.cd : COMMAND_DELAY;
  msg = { ...msg, players, cd };
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
  applyHand();
  state.levelId = id;
  state.mode = mode;
  state.game = game;
  state.challengeLost = false;
  state.acc = 0;
  state.resultShown = false;
  state.resultPending = false;
  state.coopResult = null;
  state.guestBlocked = false;
  state.bossSeen = new Set();
  // sceau de chaque joueur (son élément, choisi au salon ou attribué d'office) :
  // marques des lanternes et des constructions, coéquipiers
  state.coopInfo = state.coopRole ? game.players.map((p, i) => playerSeal(p, p.elements?.length === 1 ? p.elements[0] : state.coopPlayers?.[i]?.element)) : null;
  sound.localPid = game.localPlayer ?? 0;
  branchSender(state.coopRole, game);
  setPaused(false);
  input.reset();
  screenGame.classList.remove('result-on', 'lost');
  renderer.game = null; // resize() ne refait pas le fond de l'ancien niveau : setGame s'en charge
  // la palette (rangée simple, onglets ou équipe) : avant de mesurer le plateau
  state.introduced = new Set();
  state.combosSeen = new Set();
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
  // l'appel « Rembobinez ! » d'une partie quittée pendant sa dernière chance disparaît
  // (forcé : l'état mémorisé peut déjà dire « éteint »)
  setLastChance(false, true);
  state.zones = null;
  bossbar.classList.add('hidden');
  bossShown = null;
  // tutoriels : en solo seulement (l'hôte seul en garde le bénéfice)
  tutorial.start(state.game, !state.coopRole);
  if (save.data.rewindTutorialSeen && tutorial.rewindPhase === 1) tutorial.rewindPhase = 2;
  gauge.reset();
  gauge.update();
  if (state.coopRole === 'guest') setSpeed(1); // la vitesse est celle de l'hôte (affichée chaque image)
  else if (debug.fast) setSpeed(4);
  else setSpeed(1);
  if (!state.coopRole) debug.onStart(state.game);
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

// Fin de partie (docs/UI-UX.md §6.12) : carte centrée, plateau visible, HUD et bas à 60 %.
// Hiérarchie : « Suivant » seul en vermillon (« Réessayer » après une défaite), « Rejouer »
// secondaire, « Carte » en texte. Boutons inactifs 700 ms (contre les touchers
// involontaires) ; un toucher sur la carte saute à la fin des animations.
// `record` : la victoire est déjà enregistrée à l'événement 'win' (voir handleEvents).
// `challenge` : défi réussi (game.challengeMet() à la victoire).
function showResult(won, record = false, challenge = false) {
  const g = state.game;
  state.resultShown = true;
  state.resultPending = false;
  setPaused(true);
  sheets.close();
  endFuseMode();
  clearSlot();
  hud.lane.reset(); // plus aucun message sur le plateau derrière la carte de fin
  input.ui.selectedTower = null;
  const idx = order.findIndex((o) => o.id === state.levelId);
  // Invité : les compteurs de la partie viennent de l'hôte ; la suite, c'est lui qui la choisit.
  const guest = state.coopRole === 'guest';
  const host = state.coopRole === 'host';
  const res = guest ? state.coopResult || {} : {};
  const kills = res.kills ?? g.stats.kills;
  const built = res.towers ?? g.stats.towersBuilt;
  const lives = res.lives ?? g.lives;
  const maxLives = res.maxLives ?? g.maxLives;
  const title = `${esc(state.levelId)} · ${esc(g.level.name)}`;
  const guestNote = '<p class="res-coop">L’hôte choisit la suite : elle vous rejoindra ici ou au salon.</p>';
  const guestButtons = [{ label: 'Retour au salon', cls: 'primary L', run: () => showScreen('title') }];
  // Hôte en coopération : le salon plutôt que la carte (on y change d'élément entre deux parties)
  const back = host ? { label: 'Salon', cls: 'text', aria: 'Retour au salon', run: () => showScreen('title') } : { label: 'Carte', cls: 'text', aria: 'Carte des niveaux', run: () => showScreen('map', { justCleared: won ? state.levelId : null }) };
  const count = (n, extra = '') => `<b class="num" data-count="${Math.max(0, Math.floor(Number(n) || 0))}">${digitsHTML(Math.max(0, Math.floor(Number(n) || 0)))}</b>${extra}`;
  let card;
  if (won) {
    const stars = g.stars();
    const next = order[idx + 1];
    const nextLevel = next ? state.levelNames?.[next.id] : null;
    const hardOpen = !guest && stars >= 3 && !g.hard && g.level.hard && (save.level(state.levelId).hard || 0) === 0;
    card = showModal(
      `<span class="seal seal-red seal-44 result-seal" aria-hidden="true">勝</span><h2>Victoire !</h2>
       <p class="res-sub">${title}</p>
       <div class="result-stars" role="img" aria-label="${stars} étoile${stars > 1 ? 's' : ''} sur 3">${[0, 1, 2].map((k) => `<i class="${k < stars ? 'on' : ''}">★</i>`).join('')}</div>
       <div class="result-stats">
         <span><small>Vies</small>${count(lives, `<i>/${digitsHTML(maxLives)}</i>`)}</span><span><small>Yokai</small>${count(kills)}</span><span><small>Lanternes</small>${count(built)}</span>
       </div>
       ${record ? '<p class="res-record">Nouveau record</p>' : ''}
       ${resultMarks(g, challenge)}
       ${hardOpen ? '<p class="res-chip"><span class="seal seal-ink seal-24" aria-hidden="true">難</span>Difficile s’ouvre pour ce niveau</p>' : ''}
       ${!next && !guest ? '<p class="res-end">Le sanctuaire est sauvé. Les esprits retrouvent la paix.</p>' : ''}
       ${guest ? guestNote : ''}`,
      guest
        ? guestButtons
        : next
          ? [
              { label: `<span class="bl">Suivant</span><small>${esc(next.id)}${nextLevel ? ` · ${esc(nextLevel)}` : ''} ›</small>`, html: true, cls: 'primary L res-next', aria: `Niveau suivant ${next.id}`, run: () => startLevel(next.id) },
              { label: 'Rejouer', cls: 'M', run: () => startLevel(state.levelId, state.mode) },
              back,
            ]
          : [{ label: host ? 'Salon' : 'Carte', cls: 'primary L', run: back.run }, { label: 'Rejouer', cls: 'M', run: () => startLevel(state.levelId, state.mode) }],
      { cls: 'result result-win', actionsCls: 'result-actions', modalCls: 'result-modal' },
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
    card = showModal(
      `<span class="seal seal-indigo seal-44 result-seal" aria-hidden="true">敗</span><h2>Le sanctuaire est tombé</h2>
       <p class="res-sub">${title} · vague ${digitsHTML(Math.max(1, g.waveIndex + 1))}/${digitsHTML(g.totalWaves)}</p>
       <p class="res-tip">Essayez d’autres combos, ou rembobinez au bon moment.</p>
       ${guest ? guestNote : ''}`,
      guest ? guestButtons : [{ label: 'Réessayer', cls: 'primary L', run: () => startLevel(state.levelId, state.mode) }, back],
      { cls: 'result result-lose', actionsCls: 'result-actions', modalCls: 'result-modal' },
    );
  }
  screenGame.classList.add('result-on');
  // verrou de 700 ms ; les comptes montent en 600 ms
  const actions = card.querySelector('.actions');
  actions.classList.add('locked');
  const unlock = () => actions.classList.remove('locked');
  const lock = setTimeout(unlock, 700);
  const counters = [...card.querySelectorAll('[data-count]')];
  const finish = () => {
    for (const el of counters) el.innerHTML = digitsHTML(el.dataset.count);
    card.querySelectorAll('.result-stars i').forEach((el) => el.classList.add('show'));
  };
  if (!soberFx()) {
    for (const el of counters) el.innerHTML = digitsHTML(0);
    const t0 = performance.now() + 250;
    let lastTick = 0;
    const step = (now) => {
      if (!state.resultShown || !card.isConnected) return;
      const k = Math.max(0, Math.min(1, (now - t0) / 600));
      for (const el of counters) el.innerHTML = digitsHTML(Math.round(Number(el.dataset.count) * k));
      if (k > 0 && k < 1 && now - lastTick > 80) {
        sound.play('tick');
        lastTick = now;
      }
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // un toucher sur la carte : tout s'affiche (et les boutons répondent)
  card.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target.closest('.actions')) return;
      finish();
      clearTimeout(lock);
      setTimeout(unlock, 120);
    },
    { once: true },
  );
}

// Sceaux du résultat : mode Difficile, défi réussi ou manqué.
function resultMarks(g, challenge) {
  const out = [];
  if (g.hard) out.push('<span class="res-seal hard"><b>難</b>Victoire en Difficile</span>');
  if (g.challenge && g.level.challenge) {
    out.push(challenge ? `<span class="res-seal ch"><b>挑</b>Défi réussi : ${esc(g.level.challenge.name)}</span>` : `<span class="res-seal ch lost"><b>挑</b>Défi manqué : ${esc(g.level.challenge.name)}</span>`);
  }
  return out.length ? `<div class="res-seals">${out.join('')}</div>` : '';
}

// Dernière chance : la partie est figée, seul le Rembobinage peut sauver le
// sanctuaire ; le reste de l'interface est inactif.
const lcEl = $('last-chance');
function setLastChance(on, force = false) {
  if (on === state.lastChance && !force) return;
  state.lastChance = on;
  lcEl.classList.toggle('hidden', !on);
  screenGame.classList.toggle('lc-on', on);
  if (on) {
    input.cancel();
    input.ui.selectedTower = null;
    input.ui.tool = null;
    input.ui.rally = null;
    endFuseMode();
    clearSlot();
    sheets.close();
    // Feuille ouverte (menu d'un invité, ses Réglages : sa partie continue) : elle
    // couvrirait la poignée, seule issue. Elle se ferme sans rappel (pas de retour au menu).
    if (modalOpen() && !state.resultShown) {
      closeModal('lastChance', true);
      if (state.paused && state.coopRole === 'guest') setPaused(false);
    }
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

// Or gagné par MON geste (appel anticipé, vente, fin de vague) : N pièces volent de la
// source au sceau 金 ; le compteur monte à chaque arrivée (§7.2).
function coinsTo(fromRect, gold) {
  if (!(gold > 0) || !fromRect) return;
  const n = Math.min(6, Math.max(1, Math.ceil(gold / 5)));
  const seal = screenGame.querySelector('.stat-gold .seal');
  const per = gold / n;
  hud.deferGold(gold);
  let paid = 0;
  flyCoins({
    root: screenGame,
    from: fromRect,
    to: seal.getBoundingClientRect(),
    n,
    onArrive: (i, last) => {
      const v = last ? gold - paid : Math.round(per);
      paid += v;
      hud.payGold(v);
      sound.play('coin');
    },
  });
}

// Rectangle (page) d'une case du plateau.
function tileRect(x, y) {
  const cv = canvas.getBoundingClientRect();
  const p = renderer.toScreen(x, y);
  const ts = renderer.ts;
  return { left: cv.left + p.x - ts * 0.3, top: cv.top + p.y - ts * 0.6, width: ts * 0.6, height: ts * 0.6 };
}

// Gestion des événements moteur côté présentation.
function handleEvents(game) {
  const all = game.events;
  if (!all.length) return;
  // Coopération : un refus adressé à un autre joueur ne concerne que lui.
  const me = game.localPlayer;
  const evs = state.coopRole ? all.filter((ev) => !(ev.type === 'reject' && ev.pid != null && ev.pid !== me)) : all;
  renderer.onEvents(evs);
  const refused = new Map(); // refus de MES poses à leur exécution, par case (raison)
  const mine = (ev) => !state.coopRole || ev.pid == null || ev.pid === me;
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
          introduce(type);
        }
        // boss : moment fort (bannière au grand pinceau)
        if (ev.enemy.boss && !state.bossSeen.has(type)) {
          state.bossSeen.add(type);
          hud.banner(defs.enemies[type]?.name || 'Boss', 'Boss', 'climax');
        }
        break;
      }
      case 'waveStart': {
        // Vagues ordinaires : le chiffre roule dans le HUD et le son les annonce. Bannière
        // seulement pour le climax (nommé) et la dernière vague.
        const last = ev.index === ev.total - 1;
        if (ev.climax) hud.banner(ev.name || 'Climax', `嵐 Climax · vague ${ev.index + 1}${last ? ' · dernière' : ''}`, 'climax');
        else if (last) hud.banner(ev.name || `Vague ${ev.index + 1}`, 'Dernière vague');
        hud.popWave();
        if (mate && ev.early) hud.say({ key: `call-${ev.index}`, text: `${mate} appelle la vague ${ev.index + 1}`, prio: 1 });
        break;
      }
      case 'lastChance':
        setLastChance(true);
        break;
      case 'rewindStart':
        setLastChance(false);
        if (mate) hud.say({ text: `巻 ${mate} remonte le temps`, prio: 1 });
        break;
      case 'fuse':
        // La lanterne fusionnée change d'identité : la sélection la suit (la fiche aussi, cf. Sheets).
        if (input.ui.selectedTower === ev.oldId || input.ui.selectedTower === ev.srcId) input.ui.selectedTower = ev.tower.id;
        break;
      case 'place':
        if (mate) hud.pulseMate(ev.pid);
        break;
      case 'sell':
      case 'rewindEnd':
      case 'undo':
        if (input.ui.selectedTower != null && !game.towerById(input.ui.selectedTower)) input.ui.selectedTower = null;
        if (ev.type === 'sell' && ev.tower && mine(ev)) coinsTo(tileRect(ev.tower.x, ev.tower.y), ev.value);
        if (ev.type === 'undo' && ev.tower) {
          // la lanterne retourne dans la palette : fumée d'encre et or rendu (il roule)
          const t = ev.tower;
          renderer.fx.burst(t.x, t.y - 0.2, 6, 'smoke', '#f4f7f8', 0.6, 0.8, 0.14, { g: -0.5, drag: 0.95 });
          renderer.fx.ring(t.x, t.y + 0.3, 0.6, 0.1, PALETTE.gold, 0.4, 0.05, 0.45);
          renderer.fx.goldText(t.x, t.y - 0.5, ev.value);
          if (!mine(ev)) sound.play('undo');
        }
        break;
      case 'earlyBonus':
        // appel anticipé : les pièces volent du bouton de vague au sceau 金, l'arc
        // fantôme de la jauge se remplit (« +N 巻 » flotte) ; plus de message global
        if (mine(ev)) coinsTo($('btn-wave').getBoundingClientRect(), ev.gold);
        break;
      case 'waveEnd':
        // vague repoussée : la prime vole du bloc « VAGUE » au sceau 金
        if (ev.reward > 0 && !game.lastChanceT) coinsTo($('hud-wave').getBoundingClientRect(), ev.reward);
        break;
      case 'combo':
        // Premier combo de chaque sorte dans le niveau : son effet, dans le couloir
        // (toucher : la liste des combos).
        if (ev.def && !state.combosSeen.has(ev.def.id)) {
          state.combosSeen.add(ev.def.id);
          const seen = save.data.combosSeen || {};
          const fresh = !seen[ev.def.id];
          if (fresh) save.set('combosSeen', { ...seen, [ev.def.id]: true });
          const known = Object.keys(save.data.combosSeen || {}).length;
          hud.say({
            key: `combo-${ev.def.id}`,
            text: `${ev.def.kanji || '合'} ${fresh ? 'Nouveau combo' : 'Combo'} : ${ev.def.name}`,
            // ≤ 2 lignes : l'effet complet est dans la liste des combos (toucher). Le carnet
            // (« découverts n/6 ») est dit en clair : la pause affiche, elle, les combos ACTIFS.
            detail: fresh ? `Découverts : ${known}/${(defs.combos || []).length} · voir l’effet` : 'Touchez pour voir son effet',
            prio: 1,
            action: { kind: 'combos', id: ev.def.id },
          });
        }
        break;
      case 'executed': {
        // Ma pose refusée à son exécution (case prise au même instant par un coéquipier,
        // chemin qui serait coupé, yokai sur la case du mur…) : on le dit sur la case.
        const en = ev.entry;
        if (!en || en.ok || en.pid !== me || !PLACEMENTS.has(en.op)) break;
        // mur d'un Gardien vendu, fusionné ou effacé par le Rembobinage entre-temps :
        // rien à signaler (le joueur l'a voulu ; la construction ne se dessinait plus)
        if (en.op === 'setRally' && !game.towerById(en.args[0])) break;
        const at = tileOfCommand(en.op, en.args);
        if (!at || !game.grid.inBounds(at.c, at.r)) break;
        const other = en.op === 'placeTower' ? game.towerAt(at.c, at.r) : null;
        const who = other && other.owner !== me && game.players.length > 1 ? game.players[other.owner]?.name : null;
        const why = refused.get(`${at.c},${at.r}`);
        const wall = game.groundEnemyOn?.(game.grid.idx(at.c, at.r)) ? 'Un yokai est là : mur non déplacé' : 'Mur non déplacé';
        const text = who ? `Pris par ${who}` : en.op === 'setRally' ? wall : hud.shortReason(why, {}) || 'Pose impossible';
        const p = renderer.toScreen(at.c + 0.5, at.r + 0.5);
        input.flash(text, p.x, p.y, true, { c: at.c, r: at.r });
        if (en.op === 'setRally') sound.play('reject');
        break;
      }
      case 'reject':
        if (ev.pid === me && ev.c != null) refused.set(`${ev.c},${ev.r}`, ev.reason);
        // Invité : l'hôte refuse sa commande (socle pris entre-temps par un coéquipier…) :
        // la raison s'écrit près du socle, comme un refus local.
        if (ev.fromHost && state.coopRole === 'guest' && ev.c != null && game.grid.inBounds(ev.c, ev.r)) {
          const other = game.towerAt(ev.c, ev.r);
          const who = other && other.owner !== me ? game.players[other.owner]?.name : null;
          const p = renderer.toScreen(ev.c + 0.5, ev.r + 0.5);
          input.flash(who ? `Pris par ${who}` : hud.shortReason(ev.reason, ev) || 'Refusé par l’hôte', p.x, p.y, true, { c: ev.c, r: ev.r });
        }
        break;
      case 'rally':
        // le mur déplacé se dresse à la fin de sa construction (l'effet : fx 'rally')
        if (ev.tile != null) sound.play('stone', { c: game.grid.col(ev.tile) });
        break;
      case 'stomp':
        renderer.fx.addShake(0.35);
        break;
      case 'enrage':
        hud.say({ key: `rage-${ev.enemy.type}`, text: `${defs.enemies[ev.enemy.type].name} entre en rage !`, prio: 2 });
        break;
      case 'win': {
        if (state.resultPending || state.resultShown) break; // fin déjà annoncée (coopération)
        ev.stars = Math.max(0, Math.min(3, Math.floor(Number(ev.stars) || 0))); // (invité : vient de l'hôte)
        hud.banner('Victoire', '★'.repeat(ev.stars) + '☆'.repeat(3 - ev.stars));
        // Enregistrée tout de suite : quitter (ou recommencer) pendant la bannière ne perd pas la victoire.
        // En coopération, chacun garde ses étoiles dans sa propre sauvegarde.
        const challenge = ev.challenge != null ? ev.challenge === true : game.challengeMet ? game.challengeMet() : false;
        const record = save.record(state.levelId, ev.stars, { hard: game.hard, challenge });
        // une victoire en Difficile compte aussi pour les étoiles du mode normal
        if (game.hard) save.record(state.levelId, ev.stars);
        state.resultPending = true;
        endCoopGame(game, { won: true, stars: ev.stars, challenge });
        // nom du niveau suivant (« Suivant · 2-4 · Le Dernier Torii »)
        const next = order[order.findIndex((o) => o.id === state.levelId) + 1];
        if (next) loadLevel(next.id).then((l) => ((state.levelNames ||= {})[next.id] = l.name)).catch(() => {});
        setTimeout(() => state.game === game && showResult(true, record, challenge), 1400);
        break;
      }
      case 'lose':
        if (state.resultPending || state.resultShown) break;
        setLastChance(false);
        hud.banner('Défaite', 'Le sanctuaire est tombé');
        // le plateau se désature (900 ms)
        screenGame.classList.add('lost');
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
    // Coopération : chaque téléphone fait tourner la même partie, au rythme commun.
    const net = coop.active && coop.game === g;
    if (!state.coopRole) debug.tick(g); // débogage : seul
    // Pause douce : entre deux vagues (plus aucun yokai en jeu), le compte à
    // rebours attend qu'on ait lu la fiche (B12). Seul : à plusieurs, chaque téléphone
    // avance image par image avec les autres.
    const calm = g.enemies.length === 0 && (typeof g.spawnersDone === 'function' ? g.spawnersDone() : true);
    const reading = !state.coopRole && sheets.isOpen && g.countdown != null && calm && g.state !== 'won' && g.state !== 'lost';
    state.reading = reading;
    if (net) {
      // hôte : sa vitesse et sa pause s'appliquent chez tous à une image annoncée ;
      // invité : sa partie suit celle de l'hôte (un message inattendu n'arrête rien)
      if (state.coopRole === 'host') coop.speed = state.speed;
      try {
        coop.step(dt);
      } catch (e) {
        console.error(e);
      }
    } else if (!state.paused && !reading) {
      // « Ralentir pendant la visée » (réglage, seul) : ×0,5 tant qu'un doigt vise ou qu'une fiche est ouverte
      const slow = save.data.slowAim && (input.ui.press || input.ui.drag || sheets.isOpen) ? 0.5 : 1;
      state.acc += dt * state.speed * slow;
      let steps = 0;
      while (state.acc >= STEP && steps < 8) {
        g.update(STEP);
        state.acc -= STEP;
        steps++;
      }
      if (steps >= 8) state.acc = 0;
    }
    updateCoopGuest(g);
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
    if (!state.challengeLost && g.challenge && challengeBroken(g)) {
      state.challengeLost = true;
      hud.say({ key: 'challenge', text: `挑 Défi « ${g.level.challenge.name} » manqué`, prio: 2 });
    }
    input.tick();
    syncConsignes();
    hud.update();
    gauge.update();
    updateBossBar(g);
    towerBar.update();
    sheets.update();
    tutorial.update(state.paused || modalOpen());
    updateRoster();
    // geste en cours (outil choisi, glisser, socle choisi, fusion, mur) : le couloir de
    // messages laisse passer les touchers vers le plateau (un socle sous le message reste posable)
    const placing = !!(input.ui.tool || input.ui.drag || input.ui.press || input.ui.selectedSlot || input.ui.rally || input.ui.fuseFrom != null);
    if (placing !== state.placingCls) {
      state.placingCls = placing;
      screenGame.classList.toggle('placing', placing);
    }
    // Coopération : le plateau s'arrête quand la partie commune est arrêtée (pause de
    // l'hôte atteinte, attente de l'hôte) ; le menu d'un invité ne fige rien.
    const still = net ? coop.halted : state.paused;
    try {
      renderer.render(still ? 0 : dt, net ? coop.alpha : state.paused ? 1 : state.acc / STEP, input.ui);
    } catch (e) {
      // un dessin qui échoue (API absente d'un vieux Safari…) ne fige pas le jeu
      if (!state.renderError) console.error(e);
      state.renderError = true;
    }
    if (raw < 0.25) adaptQuality(raw, (performance.now() - t0) / 1000);
  }
  requestAnimationFrame(frame);
}

// ───────────────────────── Coopération ─────────────────────────

// Sceau d'un joueur : son élément (à plusieurs, chacun en a un, choisi ou attribué) ;
// à défaut, un sceau neutre à son initiale.
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

// ───────────────────────── Émetteur des commandes ─────────────────────────
//
// Solo : émetteur par défaut de la façade (game.issue : file du moteur).
// Coopération (hôte comme invité) : l'émetteur du réseau, coop.sender. L'hôte date la
// commande, la met dans sa file et la diffuse ; un invité la propose à l'hôte et publie
// sa pose dans state.provisional (« en construction ») jusqu'à ce qu'elle soit datée.
function branchSender(role, game) {
  state.provisional = [];
  const net = !!role && coop.active && coop.game === game;
  coop.bindProvisional(net ? () => state.provisional : null);
  commands.setSender(net ? coop.sender : null);
}

// Invité bloqué (pause de l'hôte, hôte injoignable, synchronisation) : aucune commande ne part.
function coopFrozen() {
  return state.coopRole === 'guest' && !!state.guestBlocked;
}

// Fin de partie en coopération. Chacun la calcule lui-même (même partie partout) ;
// l'hôte l'annonce aussi, avec l'image où elle s'est conclue (filet : un invité en
// retard s'y rend d'un coup). Chacun affiche son résultat et garde ses étoiles.
function endCoopGame(game, result) {
  if (state.coopRole === 'host' && coop.isHost) {
    coop.flush(); // dernier battement : les invités peuvent atteindre l'image finale
    session.endGame({
      ...result,
      level: state.levelId,
      hard: !!game.hard,
      lives: game.lives,
      maxLives: game.maxLives,
      kills: game.stats.kills,
      towers: game.stats.towersBuilt,
      wave: game.waveIndex + 1,
    }, game.frame);
    coop.stop();
  } else if (state.coopRole === 'guest') coop.stop();
}

// Invité, chaque image : synchronisation, pause de l'hôte, hôte sans nouvelles,
// vitesse de l'hôte. Renvoie 'sync' | 'pause' | 'stale' | null.
function updateCoopGuest(g) {
  if (state.coopRole !== 'guest') {
    updateCoopWait(null);
    return null;
  }
  const over = g.state === 'won' || g.state === 'lost' || state.resultShown || state.resultPending;
  const kind = over || !coop.isGuest ? null : coop.waitKind();
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

// Bandeau de l'invité : « Pause par l'hôte », « En attente de l'hôte… » ou
// « Synchronisation… » (état complet de la partie en route depuis l'hôte).
function updateCoopWait(kind) {
  if (kind === state.waitKind) return;
  state.waitKind = kind;
  // menu de l'invité ouvert : sa note suit l'état réel (il disait « la partie continue »
  // sous le bandeau « Pause par l'hôte »)
  const pn = document.querySelector('#modal:not(.hidden) .pause-card p.pause-coop');
  if (pn && state.coopRole === 'guest') pn.textContent = guestPauseNote();
  const el = $('coop-wait');
  el.classList.toggle('hidden', !kind);
  if (!kind) return;
  const host = esc(state.game?.players[0]?.name || 'L’hôte');
  el.innerHTML =
    kind === 'pause'
      ? `<span class="cw-kanji" aria-hidden="true">休</span><span class="cw-text"><b>Pause par l’hôte</b><small>${host} a mis la partie en pause</small></span>`
      : kind === 'sync'
        ? `<span class="cw-kanji wait" aria-hidden="true">同</span><span class="cw-text"><b>Synchronisation…</b><small>La partie de ${host} arrive</small></span>`
        : `<span class="cw-kanji wait" aria-hidden="true">待</span><span class="cw-text"><b>En attente de l’hôte…</b><small>La partie reprend dès son retour</small></span>`;
}

// Rangée des coéquipiers sous le HUD : sceau d'élément, nom, or, absent.
// Coopération : la rangée d'équipe prend la place des onglets (docs/UI-UX.md §6.6) :
// « Vous » (soudée à la boîte des lanternes), puis chaque coéquipier : sceau de son
// élément, nom, or (ou « hors ligne »), petit sceau 主 pour l'hôte.
function updateRoster(force = false) {
  const g = state.game;
  const on = !!(g && state.coopRole && g.players.length > 1 && state.screen === 'game');
  if (!on) {
    state.rosterSig = null;
    return;
  }
  const lp = session.lobby?.players || [];
  const me = g.localPlayer;
  const list = [g.players[me], ...g.players.filter((p) => p.id !== me)].filter(Boolean);
  const mates = list.map((p) => ({ pid: p.id, name: p.name, seal: sealHtml(playerInfo(p.id), 18), gold: p.gold, off: p.id !== me && lp[p.id]?.online === false, host: p.id === 0, me: p.id === me }));
  const sig = mates.map((m) => `${m.name}|${m.me ? '' : Math.floor(m.gold)}|${m.off}`).join(';');
  if (!force && sig === state.rosterSig) return;
  state.rosterSig = sig;
  hud.setTeam(mates);
}

// Consignes du couloir (priorité 3) : elles restent tant que l'action n'est pas faite,
// et disparaissent avec le mode qu'elles accompagnent.
function syncConsignes() {
  const l = hud.lane;
  if (!input.ui.rally && l.has('rally')) l.clear('rally');
  if (input.ui.fuseFrom == null && l.has('fuse')) l.clear('fuse');
  if (!input.ui.selectedSlot && l.has('slot-first')) {
    l.clear('slot-first');
    hud.setSlotFilter(null);
  }
}

// Message bref hors partie (accueil, carte) ; en partie, celui de la partie (couloir).
// Durée lisible : clamp(2500, 1200 + 60 × caractères, 6000) ms. Sur l'accueil, il
// flotte 12 px au-dessus des boutons (ou de la feuille ouverte), jamais au ras du bas.
let appToastTimer = 0;
// Hauteur réelle de --sat en px (la propriété vaut « env(…) » non calculé : on la mesure).
let satProbe = null;
function satPx() {
  if (!satProbe) {
    satProbe = document.createElement('div');
    satProbe.setAttribute('aria-hidden', 'true');
    satProbe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:var(--sat);visibility:hidden;pointer-events:none';
    document.body.appendChild(satProbe);
  }
  return satProbe.offsetHeight;
}

function appToast(msg, ms = 0) {
  if (state.screen === 'game') {
    hud.toast(msg, false, ms || undefined);
    return;
  }
  const el = $('app-toast');
  el.textContent = msg;
  let top = null;
  let gap = 12; // §6.21 : 12 px au-dessus des boutons de l'accueil
  const card = modal.firstElementChild;
  // feuille ouverte : au-dessus de sa position de REPOS (offsetTop ignore la glissade
  // d'entrée ; mesuré pendant l'animation, le message tombait sur l'en-tête de la feuille)
  if (!modal.classList.contains('hidden') && card.classList.contains('menu-sheet')) {
    top = card.offsetTop + (card.offsetParent?.getBoundingClientRect().top ?? 0);
    gap = 8; // au-dessus d'une feuille grande, la place est comptée
  }
  else if (state.screen === 'title') top = document.querySelector('#screen-title .title-actions')?.getBoundingClientRect().top ?? null;
  if (top != null) {
    // jamais sous la zone sûre du haut : au pire, collé sous elle
    const h = el.offsetHeight || 40;
    el.style.bottom = `${Math.round(Math.min(innerHeight - top + gap, innerHeight - satPx() - 6 - h))}px`;
  } else el.style.bottom = '';
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(appToastTimer);
  const dur = ms || Math.max(2500, Math.min(6000, 1200 + 60 * String(msg).length));
  appToastTimer = setTimeout(() => el.classList.remove('show'), dur);
}

// ───────────── Accueil : héros, rangée, zone d'annonce ─────────────

function levelLabel(id) {
  const n = levelData[id]?.name;
  return n ? `${id} · ${n}` : id;
}

// Héros de l'accueil : premier lancement → « Jouer » (1-1) ; ensuite « Continuer » (premier
// niveau ouvert non gagné), lancé d'un toucher en mode normal ; tout gagné → la carte.
// Hôte avec des invités : « Jouer à N », qui ouvre la carte (le niveau se choisit à plusieurs).
function heroState() {
  if (session.role === 'guest') return { kind: 'guest' };
  const n = session.lobby?.players.length ?? 1;
  if (coopReady()) return { kind: 'map', label: `Jouer à ${n}`, sub: 'Choisir le niveau' };
  const total = save.totalStars(order);
  const next = order.find((o, i) => !save.stars(o.id) && save.isUnlocked(order, i));
  if (!next) return { kind: 'map', label: 'Choisir un niveau', sub: `${total} ★ sur ${order.length * 3}`, done: true };
  return { kind: 'play', id: next.id, label: total ? 'Continuer' : 'Jouer', sub: levelLabel(next.id) };
}

function heroAction() {
  const h = heroState();
  if (h.kind === 'guest') return; // l'hôte choisit le niveau
  if (h.kind === 'map') return showScreen('map');
  startLevel(h.id, { hard: false, challenge: false });
}

// Accueil à jour : héros, « Niveaux », « À plusieurs » (nombre de joueurs), équipe de
// l'hôte, attente de l'invité, zone d'annonce.
function updateHome() {
  syncSoundButton();
  const guest = session.role === 'guest';
  const h = heroState();
  const hero = $('btn-play');
  hero.classList.toggle('hidden', guest);
  if (!guest) {
    if ($('btn-play-label').textContent !== h.label) $('btn-play-label').textContent = h.label;
    if ($('btn-play-sub').textContent !== h.sub) $('btn-play-sub').textContent = h.sub;
    hero.setAttribute('aria-label', `${h.label} : ${h.sub}`);
  }
  $('btn-levels').classList.toggle('hidden', guest || !!h.done);
  const players = session.lobby?.players || [];
  const n = players.length;
  $('btn-multi-label').textContent = guest ? 'Salon' : 'À plusieurs';
  const count = $('btn-multi-count');
  count.textContent = n > 1 ? String(n) : '';
  count.classList.toggle('hidden', n <= 1);
  $('btn-multi').setAttribute('aria-label', guest ? `Salon : ${n} joueurs` : n > 1 ? `À plusieurs : ${n} joueurs dans le salon` : 'À plusieurs');
  // hôte avec des invités : qui jouera (sceau d'élément + nom)
  const team = $('title-team');
  const showTeam = !guest && coopReady();
  team.classList.toggle('hidden', !showTeam);
  if (showTeam) {
    const html = coop
      .playersFromLobby()
      .map((p) => {
        const el = p.element || p.elements?.[0];
        return `<span class="tt-mate">${el ? badgeOf(el, defs, { size: 22 }) : ''}<span>${esc(p.name)}</span></span>`;
      })
      .join('');
    if (team.innerHTML !== html) team.innerHTML = html;
  }
  // invité : la carte d'attente remplace le héros
  const wait = $('title-wait');
  wait.classList.toggle('hidden', !guest);
  if (guest) {
    const txt = session.lobby?.solo ? 'L’hôte finit une partie seul : vous jouerez à la suivante' : session.inGame ? 'Partie en cours…' : 'L’hôte choisit le niveau…';
    if (wait.textContent !== txt) wait.textContent = txt;
  }
  updateNotice();
}

// Zone d'annonce (une seule à la fois) : arrivée d'un ami (4,5 s), invitation à
// réinstaller une ancienne app installée (haut flou), ligne Safari « Sur l'écran d'accueil ».
let announce = null;
function announceHome(text) {
  announce = { text, until: performance.now() + 4500 };
  updateNotice();
  setTimeout(updateNotice, 4600);
}
// Encart haut réel (une sonde fixe ; --inset-top la remplace dans les tests).
let insetProbe = null;
function insetTop() {
  if (!insetProbe) {
    insetProbe = document.createElement('div');
    insetProbe.setAttribute('aria-hidden', 'true');
    insetProbe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:var(--inset-top, env(safe-area-inset-top, 0px));visibility:hidden;pointer-events:none';
    document.body.appendChild(insetProbe);
  }
  return insetProbe.getBoundingClientRect().height;
}
const isIOS = () => /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
// Ancienne installation (balise black-translucent figée par iOS) : encart haut non nul.
function reinstallHint() {
  return document.documentElement.classList.contains('ios26-app') && insetTop() > 0 && matchMedia('(orientation: portrait)').matches && !save.data.reinstallHintSeen;
}
function updateNotice() {
  const box = $('title-notice');
  let kind = '';
  if (announce && performance.now() < announce.until) kind = 'announce';
  else if (reinstallHint()) kind = 'reinstall';
  else if (isIOS() && !installed()) kind = 'safari';
  if (box.dataset.kind === kind && kind !== 'announce') return;
  box.dataset.kind = kind;
  box.classList.toggle('hidden', !kind);
  if (kind === 'announce') box.innerHTML = `<span class="notice-ico" aria-hidden="true">人</span><span class="notice-text"><b>${esc(announce.text)}</b></span>`;
  else if (kind === 'reinstall')
    box.innerHTML = `<button type="button" class="notice-main" data-act="fix"><span class="notice-ico" aria-hidden="true">!</span><span class="notice-text"><b>Haut de l’écran flou ?</b><small>Corrigez-le en 2 minutes, sans perdre votre progression.</small></span><span class="notice-chev" aria-hidden="true">›</span></button><button type="button" class="notice-later" data-act="later">Plus tard</button>`;
  else if (kind === 'safari') box.innerHTML = `<span class="notice-text"><small>Partager ▸ « Sur l’écran d’accueil » pour jouer en plein écran</small></span>`;
  else box.innerHTML = '';
}
$('title-notice').addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  if (t.dataset.act === 'fix') openSettings({ section: 'progress' });
  else if (t.dataset.act === 'later') {
    save.set('reinstallHintSeen', true);
    updateNotice();
  }
});
matchMedia('(orientation: portrait)').addEventListener?.('change', () => state.screen === 'title' && updateNotice());

// Réglages (feuille des menus, aussi ouverte depuis la pause) : rappels de main.js.
function applyTextScale(v) {
  document.documentElement.style.setProperty('--fs-scale', String(v || 1));
  // texte agrandi : les libellés les plus longs se raccourcissent (« Cible : Premier ▾ »
  // se cassait sur deux lignes à 130 %)
  document.documentElement.classList.toggle('text-big', (v || 1) > 1);
}
applyTextScale(save.data.textScale);
initSettings({
  showModal: (html, buttons, opts) => showModal(html, buttons, opts),
  close: (o) => closeModal('close', !!o?.silent),
  setMuted: (m) => {
    setMuted(m);
    syncSoundButton();
  },
  setMusic: (on) => {
    save.set('music', on);
    sound.musicOn = on;
  },
  onEffects: () => applyEffects(), // (partie : effets sobres, lu dans save.data.effects)
  onTextScale: (v) => applyTextScale(v),
  onImport: () => {
    if (state.screen === 'title') updateHome();
  },
  sound: (name) => sound.play(name),
});

// Son propre salon (même code après un rechargement de l'onglet).
function hostSalon() {
  memo(SALON_GUEST, null);
  const code = normalizeCode(recall(SALON_HOST)) || undefined;
  return session.host({ code, element: profile.element });
}

// À l'accueil : le salon existe toujours. Lien ?salon=CODE (ou rechargement d'un
// invité) : on rejoint ce salon (le lien ouvre aussi la feuille) ; sinon on héberge le sien.
function ensureSalon() {
  if (session.role || lobbyUI.joining) return;
  let code = normalizeCode(params.get('salon'));
  const fromLink = !!code;
  if (params.has('salon')) {
    params.delete('salon');
    history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}${location.hash}`);
  }
  code ||= normalizeCode(recall(SALON_GUEST));
  if (code && code !== normalizeCode(recall(SALON_HOST))) {
    lobbyUI.join(code);
    if (fromLink) openSalon();
  } else hostSalon();
}

// Salon : feuille grande, modale (« À plusieurs », ou « Salon » pour un invité). Le salon
// (LobbyUI) vit dans #title-lobby, qu'on glisse dans la feuille ; fermée, ou remplacée
// par une autre fenêtre, il retourne à sa place (cachée) : il reste à jour.
const lobbyRoot = $('title-lobby');
const lobbyPark = lobbyRoot.parentElement;
function openSalon() {
  const card = showModal('<div class="salon-slot"></div>', [], { sheet: 'large', veil: true, cls: 'menu-sheet salon-sheet' });
  card.querySelector('.salon-slot')?.replaceWith(lobbyRoot);
  lobbyUI.render();
  sound.play('select');
}
let modalWasHidden = modal.classList.contains('hidden');
new MutationObserver(() => {
  if (lobbyRoot.parentElement !== lobbyPark && (modal.classList.contains('hidden') || !modal.contains(lobbyRoot))) lobbyPark.appendChild(lobbyRoot);
  // une fenêtre s'ouvre ou se ferme : un message hors partie posé pour l'écran d'avant s'efface
  const hidden = modal.classList.contains('hidden');
  if (hidden !== modalWasHidden) $('app-toast').classList.remove('show');
  modalWasHidden = hidden;
}).observe(modal, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });

const lobbyUI = new LobbyUI(lobbyRoot, session, {
  defs,
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
  onRender: () => updateHome(),
  close: () => closeModal('close'),
});
window.__showScreen = showScreen; // (tests : retour d'une victoire sur la carte, justCleared)
// la scène de l'accueil se cale au-dessus des boutons : elle suit leur hauteur
new ResizeObserver(() => title.resize()).observe(document.querySelector('#screen-title .title-actions'));
// noms des niveaux (sous-ligne du héros) : dès qu'ils sont chargés
loadAllLevels().then(() => state.screen === 'title' && updateHome());
// un ami arrive dans notre salon : on l'annonce sur l'accueil (sans ouvrir la feuille)
const announced = new Map(); // (« hello » répétés, reconnexions : une annonce par ami et par minute)
session.on('join', (p) => {
  if (state.screen !== 'title' || !session.isHost || !p?.name) return;
  if (!modal.classList.contains('hidden') && modal.firstElementChild.classList.contains('salon-sheet')) return; // il le voit déjà
  const now = performance.now();
  if (now - (announced.get(p.id) ?? -1e9) < 60000) return;
  announced.set(p.id, now);
  announceHome(`${p.name} a rejoint votre salon`);
});

session.on('status', ({ state: st, role, code, error }) => {
  if (role === 'host' && code) memo(SALON_HOST, code);
  if (role === 'guest' && st === 'online' && code) memo(SALON_GUEST, code);
  updateHome();
  // relais perdu en cours de route : l'hôte se reconnecte sans perdre son salon
  if (st === 'offline' && role === 'host' && error === 'connexion perdue') scheduleReconnect();
  if (st === 'online') reconnectTries = 0;
});

session.on('lobby', () => {
  updateHome();
  if (state.screen === 'game') updateRoster(true);
  guestGameOver();
});

// Invité : l'hôte lance une partie. Départ renvoyé (reconnexion) alors qu'on y est
// déjà : rien à faire, les commandes et battements reprennent (une commande perdue
// pendant la coupure : l'état complet suit).
session.on('start', (msg) => {
  if (state.coopRole === 'guest' && state.screen === 'game' && state.gid === msg.seed && state.levelId === msg.level && !state.resultShown && !state.resultPending) return;
  startGuestGame(msg);
});

// Invité : fin de partie annoncée par l'hôte (résultat), ou partie arrêtée (null).
session.on('end', (msg) => {
  if (state.coopRole !== 'guest' || state.screen !== 'game') return;
  // fin d'une autre partie (message égaré, ou forgé par un tiers du relais) : ignorée
  if (msg.gid !== state.gid) return;
  const r = cleanResult(msg.result, state.levelId);
  const g = state.game;
  if (r) {
    state.coopResult = r;
    // la partie se rend à l'image finale de l'hôte et se conclut d'elle-même
    if (!state.resultPending && !state.resultShown) coop.finish(msg.f);
    if (!state.resultPending && !state.resultShown && g && g.state !== 'won' && g.state !== 'lost') {
      // (écart avec l'hôte, ou fin sans image) : on conclut d'après son annonce
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

// Résultat de partie annoncé par l'hôte : il finit dans le HTML du résultat et dans la
// sauvegarde. Il vient du réseau : seuls des nombres bornés et des booléens passent.
function cleanResult(r, levelId) {
  if (!r || typeof r !== 'object' || (r.level != null && r.level !== levelId)) return null;
  const int = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);
  return {
    won: r.won === true,
    stars: int(r.stars, 3) ?? 0,
    challenge: r.challenge === true,
    lives: int(r.lives, 999),
    maxLives: int(r.maxLives, 999),
    kills: int(r.kills, 1e6),
    towers: int(r.towers, 1e5),
    wave: int(r.wave, 99),
  };
}

// Invité : l'hôte n'est plus dans la partie affichée (fin manquée pendant une coupure :
// il est revenu au salon, ou en a lancé une autre) : on la conclut comme un « end ».
function guestGameOver(later = false) {
  if (state.coopRole !== 'guest' || state.screen !== 'game' || !coop.isGuest) return;
  if (state.resultShown || state.resultPending || session.role !== 'guest' || !session.online) return;
  const lobby = session.lobby;
  if (!lobby || (lobby.inGame && (lobby.gid == null || lobby.gid === state.gid))) return;
  // une autre partie a commencé : son départ suit d'ordinaire aussitôt (on y passe
  // directement) ; sinon (on n'en est pas), celle-ci est bien finie
  if (lobby.inGame && !later) {
    setTimeout(() => guestGameOver(true), 2000);
    return;
  }
  coop.stop();
  setPaused(true);
  showModal(`<div class="modal-kanji">終</div><h2>Partie terminée</h2><p>L’hôte a mis fin à la partie. Il choisira bientôt la suivante.</p>`, [
    { label: 'Retour au salon', cls: 'primary', run: () => showScreen('title') },
  ]);
}

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
    } catch (e) {
      ok = false;
      // le joueur a fait autre chose entre-temps (quitté le salon, rejoint un autre) : rien à reprendre
      if (e.cancelled) {
        rejoining = false;
        return;
      }
    }
    rejoining = false;
    if (ok) {
      guestGameOver(); // la partie a pu finir pendant la coupure
      return;
    }
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
  // (état du salon : priorité 2, il passe devant les bulles du tutoriel)
  if (state.coopRole === 'host') hud.say({ key: `join-${p.id}`, text: `${p.name} est de retour`, prio: 2 });
  else if (!state.coopRole) hud.say({ key: `join-${p.id}`, text: `${p.name} a rejoint votre salon`, detail: 'il jouera à la prochaine partie', prio: 2 });
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
// État pressé commun (< 100 ms) sur tous les contrôles (src/ui/press.js).
installPress(document);

// Pause automatique en arrière-plan. Hôte : c'est la pause de tous ; un battement par
// seconde rassure les invités (sinon ils l'attendraient comme un hôte disparu).
// Invité : rien (la partie continue ; à son retour, il rattrape, ou reçoit l'état
// complet s'il a plus de 5 s de retard).
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
window.__commands = commands;
window.__beginGame = beginGame; // (tests : partie coopérative simulée sans réseau)

// Démarrage : ?level=<id> lance directement un niveau en solo (tests), sinon
// l'accueil, où le salon se crée tout seul (ou rejoint celui de ?salon=CODE).
const direct = params.get('level');
if (direct) startLevel(direct);
else showScreen('title');
resize();
