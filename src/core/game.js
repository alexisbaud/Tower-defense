// Moteur de simulation. Aucune dépendance au DOM : il tourne aussi bien dans le
// navigateur que dans Node (tools/sim.mjs). Le rendu et l'audio consomment la
// file `events` remplie pendant `update()`.
//
// Multijoueur coopératif : 1 à 4 joueurs (`players`), chacun avec sa bourse et
// ses éléments ; les vies du sanctuaire sont communes. Toutes les commandes du
// joueur prennent un identifiant de joueur `pid` (par défaut le joueur local).

import { Grid, T } from './grid.js';
import { FlowField, bfs, routeOf } from './flowfield.js';
import { Rng } from './rng.js';
import { hyp, dsin, fnv } from './dmath.js';
import { buildComboIndex, computeZones, updateZones, updateTornadoes, comboKey } from './combos.js';

export const STEP = 1 / 60;
export const PRIORITIES = ['first', 'last', 'strong', 'close'];
const ALL_ELEMENTS = ['fire', 'water', 'wind', 'earth'];

// Éléments contrôlés par chaque joueur. Seul, on contrôle les quatre. À plusieurs,
// chacun n'a QUE l'élément qu'il a choisi (lanternes et objets de cet élément) ; un
// joueur sans choix (ou en double) reçoit le premier élément libre, dans l'ordre.
// `choices` : un élément (ou null) par joueur.
export function assignElements(choices, all = ALL_ELEMENTS) {
  if (choices.length <= 1) return [all.slice()];
  const taken = new Set();
  const out = choices.map((el) => {
    if (el && all.includes(el) && !taken.has(el)) {
      taken.add(el);
      return el;
    }
    return null;
  });
  return out.map((el) => {
    if (!el) {
      el = all.find((x) => !taken.has(x)) ?? all[0];
      taken.add(el);
    }
    return [el];
  });
}

// Poses : exécutées après le délai de construction (rules.buildTime, 2 s).
export const PLACEMENTS = new Set(['placeTower', 'placeStone', 'setRally']);
// Commandes de la file : nombre d'arguments (le joueur est ajouté en dernier).
export const COMMANDS = {
  placeTower: 3,
  sellTower: 1,
  undoPlace: 1,
  fuse: 2,
  setPriority: 2,
  cyclePriority: 1,
  placeStone: 2,
  removeStone: 2,
  // [vague attendue] (facultatif) : en coopération, l'appel s'exécute plus tard (délai
  // réseau) ; si la vague est partie entre-temps (compte à rebours, autre joueur), il
  // n'en appelle pas une de plus
  startNextWave: 1,
  rewind: 0,
  setRally: 3,
  cancel: 1,
};

// Champs du moteur exclus de l'état exporté (statiques, recalculés ou traités à part).
const EXPORT_SKIP = new Set(['level', 'defs', 'rules', 'rng', 'recordEvents', 'events', 'grid', 'flow', 'comboIndex', 'zones', 'history', 'rewindAnim', 'projectiles', 'chargedKills', 'chargedWaves', 'stoneOwner', '_route', '_routeV', 'localPlayer', 'waves', 'players']);
const IMPORT_SPECIAL = new Set(['v', 'players', 'rng', 'stones', 'stoneOwner', 'chargedKills', 'chargedWaves', 'projectiles', 'zoneTimers']);
const STATES = ['build', 'wave', 'won', 'lost'];

export class Game {
  /**
   * @param {object} level  données du niveau (data/levels/*.js)
   * @param {object} defs   { towers, enemies, rules, combos, elements }
   * @param {object} opts   { seed, recordEvents, players: [{ name, elements }], localPlayer, hard }
   */
  constructor(level, defs, opts = {}) {
    this.level = level;
    this.defs = defs;
    this.hard = !!opts.hard;
    this.rules = { ...defs.rules, ...(level.rules || {}), ...(this.hard ? level.hard?.rules || {} : {}) };
    this.rng = new Rng(opts.seed ?? 7);
    this.recordEvents = opts.recordEvents !== false;
    this.events = [];

    this.grid = new Grid(level.map);
    this.flow = new FlowField(this.grid);

    // Joueurs : bourse personnelle, éléments contrôlés.
    const elements = Object.keys(defs.elements || {}).length ? Object.keys(defs.elements) : ALL_ELEMENTS;
    const list = opts.players?.length ? opts.players : [{ name: 'Joueur', elements }];
    const n = Math.max(1, Math.min(4, list.length));
    const coop = this.rules.coop || {};
    this.coopHp = coop.hp?.[n - 1] ?? 1;
    this.coopReward = coop.reward?.[n - 1] ?? 1;
    const startGold = (level.startGold + (this.hard ? level.hard?.startGold ?? 0 : 0)) * (coop.startGold?.[n - 1] ?? 1);
    this.players = list.slice(0, n).map((p, i) => ({
      id: i,
      name: p.name || `Joueur ${i + 1}`,
      elements: (p.elements && p.elements.length ? p.elements : elements).slice(),
      gold: Math.round(startGold),
    }));
    this.localPlayer = Math.min(opts.localPlayer ?? 0, n - 1);

    this.time = 0; // horloge des effets visuels (ne recule jamais)
    this.ct = 0; // chronologie de la partie (reculée par le Rembobinage)
    this.maxLives = (level.lives ?? this.rules.lives) + (this.hard ? level.hard?.lives ?? 0 : 0);
    this.lives = this.maxLives;
    this.nextId = 1;
    this.hpScale = (level.hpScale ?? 1) * (this.hard ? level.hard?.hpScale ?? 1.35 : 1) * this.coopHp;

    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    this.barriers = [];
    this.zones = []; // zones de synergie (combos)
    this.tornadoes = [];
    this.beams = []; // jets du Torrent (rendu uniquement)
    this.comboIndex = buildComboIndex(defs.combos);
    this.stonesPlaced = 0;
    this.stoneOwner = new Int8Array(this.grid.size).fill(-1); // joueur qui a payé chaque pierre (−1 : aucune)
    // Rembobinage
    this.echoes = []; // lanternes fantômes (puissance réduite, durée limitée)
    this.history = [];
    this.historyT = 0;
    this.rewindCharge = Math.min(this.rules.rewindCost ?? 100, level.rewindStart ?? 0);
    this.rewindAnim = null;
    this.rewindsUsed = 0;
    this.lastChanceT = 0;
    this.timelessLoss = 0; // vies perdues à cause des yokai hors du temps (non rembobinables)
    // … leurs fuites (défi « Aucune fuite ») et leurs éliminations, avec l'or gagné par
    // chaque joueur : un yokai hors du temps abattu ne revient pas, sa prime non plus.
    this.timelessLeaks = 0;
    this.timelessKills = 0;
    this.timelessGold = this.players.map(() => 0);
    this.timelessEarned = 0;
    this.timelessSpawned = {}; // apparitions déjà faites de yokai hors du temps, par groupe
    // Ce qui a déjà rechargé la jauge (survit au rembobinage : rejouer les mêmes
    // éliminations ou le même appel anticipé ne la recharge pas une seconde fois).
    this.chargedKills = new Set();
    this.chargedWaves = new Set();

    this.waves = level.waves;
    this.waveIndex = -1; // index de la dernière vague lancée
    this.state = 'build'; // build | wave | won | lost
    this.nextWaveT = null; // secondes avant la vague suivante (null = attente du joueur)
    this.spawners = [];
    this.waveCleared = [];
    this.stats = { kills: 0, leaks: 0, goldEarned: 0, towersBuilt: 0, stones: 0, elementsUsed: {} };

    // Socles gravés d'un élément qu'aucun joueur ne contrôle : ils deviennent universels.
    const present = new Set(this.players.flatMap((p) => p.elements));
    for (let i = 0; i < this.grid.size; i++) {
      const se = this.grid.slotElement[i];
      if (se && !present.has(se)) this.grid.slotElement[i] = null;
    }

    // File de commandes (voir issue()) : chaque action est exécutée à une image
    // précise (frame), la même pour tous les joueurs d'une partie coopérative.
    this.frame = 0;
    this.queue = [];
    this.recent = []; // poses exécutées récemment (annulation)
    this.cmdSeq = 1;
    this.commandDelay = 0; // images d'attente des autres commandes (0 en solo ; réglé par le réseau)
  }

  // ───────────────────────── utilitaires ─────────────────────────

  emit(type, data) {
    if (this.recordEvents) this.events.push({ type, ...data });
  }

  player(pid = this.localPlayer) {
    return this.players[pid] || this.players[0];
  }

  // Or du joueur local (compatibilité avec l'interface solo).
  get gold() {
    return this.player().gold;
  }
  set gold(v) {
    this.player().gold = v;
  }

  goldOf(pid = this.localPlayer) {
    return this.player(pid).gold;
  }

  elementOf(type) {
    return this.defs.towers[type]?.element ?? type;
  }

  ownsElement(pid, element) {
    return this.player(pid).elements.includes(element);
  }

  // Verse une récompense à chaque joueur (part coopérative).
  reward(amount, reason = 'kill') {
    if (!(amount > 0)) return;
    const each = this.players.length > 1 ? Math.max(1, Math.round(amount * this.coopReward)) : amount;
    for (const p of this.players) p.gold += each;
    this.stats.goldEarned += each;
    return each;
  }

  get countdown() {
    return this.nextWaveT;
  }

  towerAt(c, r) {
    for (const t of this.towers) if (t.c === c && t.r === r) return t;
    return null;
  }

  towerById(id) {
    return this.towers.find((t) => t.id === id) || null;
  }

  towerStats(t) {
    const def = this.defs.towers[t.type];
    return def.levels[Math.min(t.level, def.levels.length) - 1];
  }

  get totalWaves() {
    return this.waves.length;
  }

  // Lanternes proposées dans ce niveau (filtrées par les éléments du joueur et le défi).
  get availableTowers() {
    return this.towersFor(this.localPlayer);
  }

  towersFor(pid) {
    const base = this.level.towers || Object.keys(this.defs.towers);
    const forbid = new Set(this.challengeRule?.forbidTowers || []);
    return base.filter((t) => this.defs.towers[t] && !forbid.has(t) && this.ownsElement(pid, this.elementOf(t)));
  }

  get challengeRule() {
    return this.challenge ? this.level.challenge?.rule : null;
  }

  stars() {
    if (this.state !== 'won') return 0;
    const ratio = this.lives / this.maxLives;
    if (ratio >= this.rules.stars3) return 3;
    if (ratio >= this.rules.stars2) return 2;
    return 1;
  }

  maxLevelOf(type) {
    return Math.min(this.rules.maxTowerLevel, this.defs.towers[type].levels.length);
  }

  busy() {
    if (this.state === 'won' || this.state === 'lost') return 'over';
    if (this.rewindAnim) return 'rewinding';
    if (this.lastChanceT > 0) return 'lastChance';
    return null;
  }

  // ───────────────────────── commandes du joueur ─────────────────────────

  canPlaceTower(type, c, r, pid = this.localPlayer) {
    const b = this.busy();
    if (b) return { ok: false, reason: b };
    const def = this.defs.towers[type];
    if (!def || !this.level.towers?.includes?.(type) && this.level.towers) return { ok: false, reason: 'unknown' };
    if (!this.ownsElement(pid, this.elementOf(type))) return { ok: false, reason: 'element' };
    if (this.challengeRule?.forbidTowers?.includes(type)) return { ok: false, reason: 'challenge' };
    if (!this.grid.inBounds(c, r)) return { ok: false, reason: 'bounds' };
    const i = this.grid.idx(c, r);
    if (this.grid.type(i) !== T.SLOT) return { ok: false, reason: 'slot' };
    const se = this.grid.slotElement[i];
    if (se && se !== this.elementOf(type)) return { ok: false, reason: 'slotElement', element: se };
    if (this.towerAt(c, r)) return { ok: false, reason: 'occupied' };
    // Un écho occupe son socle jusqu'à sa disparition : on repose « ailleurs ».
    if (this.echoes.some((t) => t.c === c && t.r === r)) return { ok: false, reason: 'echo' };
    // défi « N lanternes » : toutes les poses comptent (une fusion consomme une pose)
    if (this.challengeRule?.maxTowers != null && this.stats.towersBuilt >= this.challengeRule.maxTowers) return { ok: false, reason: 'challenge' };
    if (this.goldOf(pid) < def.cost) return { ok: false, reason: 'gold' };
    return { ok: true };
  }

  placeTower(type, c, r, pid = this.localPlayer) {
    const check = this.canPlaceTower(type, c, r, pid);
    if (!check.ok) {
      this.emit('reject', { c, r, reason: check.reason, pid });
      return null;
    }
    const def = this.defs.towers[type];
    this.player(pid).gold -= def.cost;
    const t = {
      id: this.nextId++,
      type,
      element: this.elementOf(type),
      owner: pid,
      level: 1,
      c,
      r,
      x: c + 0.5,
      y: r + 0.5,
      cooldown: 0.2,
      angle: -Math.PI / 2,
      invested: def.cost,
      stunT: 0,
      shotT: 0,
      bornAt: this.time,
      bornCt: this.ct,
      priority: def.priority ?? 'first',
      rateMult: 1,
      cleanse: 0,
      rally: null,
    };
    this.towers.push(t);
    this.stats.towersBuilt++;
    this.stats.elementsUsed[t.element] = true;
    this.emit('place', { tower: t, pid });
    this.onTowersChanged();
    return t;
  }

  sellValue(t) {
    return Math.floor(t.invested * this.rules.sellRatio);
  }

  sellTower(id, pid = this.localPlayer) {
    const t = this.towerById(id);
    if (!t || this.busy() || (this.players.length > 1 && t.owner !== pid)) return 0;
    const value = this.sellValue(t);
    this.player(t.owner).gold += value;
    this.towers = this.towers.filter((x) => x !== t);
    this.removeBarrierOf(t);
    this.emit('sell', { tower: t, value, pid });
    this.onTowersChanged();
    return value;
  }

  // Annuler une pose récente : la lanterne disparaît, son prix est intégralement rendu.
  undoPlace(id, maxAge = 3, pid = this.localPlayer) {
    const t = this.towerById(id);
    if (!t || t.level !== 1 || this.busy() || this.time - t.bornAt > maxAge + 0.25) return false;
    if (this.players.length > 1 && t.owner !== pid) return false;
    this.towers = this.towers.filter((x) => x !== t);
    this.removeBarrierOf(t);
    this.player(t.owner).gold += t.invested;
    this.stats.towersBuilt = Math.max(0, this.stats.towersBuilt - 1);
    this.emit('undo', { tower: t, value: t.invested, pid });
    this.onTowersChanged();
    return true;
  }

  // Appelé à chaque modification de l'ensemble des tours ou des échos.
  onTowersChanged() {
    computeZones(this);
    this.recomputeSupport();
    this.refreshBarriers();
  }

  refreshBarriers() {
    for (const t of this.towers) if (this.defs.towers[t.type].attack === 'barrier') this.ensureBarrier(t);
  }

  comboFor(a, b) {
    return this.comboIndex.get(comboKey(this.elementOf(a), this.elementOf(b))) || null;
  }

  // ───────────────────────── priorités de ciblage ─────────────────────────

  setPriority(id, priority, pid = this.localPlayer) {
    const t = this.towerById(id);
    if (!t || !PRIORITIES.includes(priority)) return false;
    if (this.players.length > 1 && t.owner !== pid) return false;
    t.priority = priority;
    this.emit('priority', { tower: t, priority, pid });
    return true;
  }

  cyclePriority(id, pid = this.localPlayer) {
    const t = this.towerById(id);
    if (!t) return null;
    const next = PRIORITIES[(PRIORITIES.indexOf(t.priority) + 1) % PRIORITIES.length];
    return this.setPriority(id, next, pid) ? next : t.priority;
  }

  // ───────────────────────── fusion ─────────────────────────

  canFuse(srcId, dstId, pid = this.localPlayer) {
    const a = this.towerById(srcId);
    const b = this.towerById(dstId);
    if (!a || !b || a === b) return { ok: false, reason: 'mismatch' };
    const busy = this.busy();
    if (busy) return { ok: false, reason: busy };
    if (this.players.length > 1 && (a.owner !== pid || b.owner !== pid)) return { ok: false, reason: 'owner' };
    if (a.type !== b.type || a.level !== b.level) return { ok: false, reason: 'mismatch' };
    if (a.level >= this.maxLevelOf(a.type)) return { ok: false, reason: 'level' };
    return { ok: true };
  }

  // Glisser `src` sur `dst` : `src` disparaît, `dst` monte d'un niveau.
  fuse(srcId, dstId, pid = this.localPlayer) {
    if (!this.canFuse(srcId, dstId, pid).ok) return null;
    const src = this.towerById(srcId);
    const dst = this.towerById(dstId);
    const dstOldId = dst.id;
    this.towers = this.towers.filter((t) => t !== src);
    this.removeBarrierOf(src);
    dst.level += 1;
    dst.invested += src.invested;
    dst.id = this.nextId++; // nouvelle identité : utile au rembobinage (écho)
    dst.bornAt = this.time;
    dst.bornCt = this.ct;
    dst.cooldown = 0.3;
    const bar = this.barriers.find((b) => b.towerId === dstOldId);
    if (bar) {
      bar.towerId = dst.id;
      const hp = this.towerStats(dst).barrierHp;
      if (bar.alive) bar.hp = (bar.hp / bar.maxHp) * hp;
      bar.maxHp = hp;
    }
    this.emit('fuse', { tower: dst, from: { x: src.x, y: src.y }, level: dst.level, oldId: dstOldId, srcId, pid });
    this.onTowersChanged();
    return dst;
  }

  // ───────────────────────── pierres (chemin modifiable) ─────────────────────────

  stoneConf() {
    const s = this.level.stones;
    if (!s || this.challengeRule?.noStones) return null;
    const o = typeof s === 'object' ? s : {};
    return { cost: o.cost ?? this.rules.stoneCost, max: o.max ?? this.rules.stoneMax };
  }

  stoneCost() {
    return this.stoneConf()?.cost ?? 0;
  }

  // Pierres restantes : ressource limitée du niveau (les pierres retirées ne reviennent pas).
  stonesLeft() {
    const conf = this.stoneConf();
    return conf ? Math.max(0, conf.max - this.stats.stones) : 0;
  }

  // La Terre façonne le chemin : seuls ses joueurs posent des pierres (en coop).
  canUseStones(pid = this.localPlayer) {
    return !!this.stoneConf() && (this.players.length === 1 || this.ownsElement(pid, 'earth'));
  }

  routeLength() {
    let n = 0;
    for (const s of this.grid.spawns) n += Math.max(0, this.flow.dist[s]);
    return n;
  }

  canPlaceStone(c, r, pid = this.localPlayer) {
    const conf = this.stoneConf();
    if (!conf) return { ok: false, reason: 'unknown' };
    const busy = this.busy();
    if (busy) return { ok: false, reason: busy };
    if (!this.canUseStones(pid)) return { ok: false, reason: 'element' };
    const g = this.grid;
    if (!g.inBounds(c, r)) return { ok: false, reason: 'bounds' };
    const i = g.idx(c, r);
    if (g.type(i) !== T.OPEN) return { ok: false, reason: 'open' };
    if (g.stone[i]) return { ok: false, reason: 'occupied' };
    if (this.barriers.some((b) => b.tile === i)) return { ok: false, reason: 'barrier' };
    if (this.stats.stones >= conf.max) return { ok: false, reason: 'limit' };
    if (this.goldOf(pid) < conf.cost) return { ok: false, reason: 'gold' };
    for (const e of this.enemies) {
      if (!e.alive || e.flying) continue;
      if (e.cur === i || e.target === i || g.tileAt(e.mx, e.my) === i) return { ok: false, reason: 'occupiedEnemy' };
    }
    // Le passage ne doit jamais être totalement bloqué.
    const dist = bfs(g, i);
    for (const s of g.spawns) if (dist[s] < 0) return { ok: false, reason: 'blocked' };
    for (const e of this.enemies) {
      if (!e.alive || e.flying) continue;
      if (dist[e.cur] < 0 || dist[e.target] < 0) return { ok: false, reason: 'blocked' };
    }
    return { ok: true };
  }

  placeStone(c, r, pid = this.localPlayer) {
    const check = this.canPlaceStone(c, r, pid);
    if (!check.ok) {
      this.emit('reject', { c, r, reason: check.reason, pid });
      return false;
    }
    const before = this.routeLength();
    const i = this.grid.idx(c, r);
    this.grid.stone[i] = 1;
    this.stoneOwner[i] = this.player(pid).id;
    this.player(pid).gold -= this.stoneCost();
    this.stonesPlaced++;
    this.stats.stones++;
    this.flow.compute();
    this.refreshBarriers();
    this.emit('stone', { c, r, delta: this.routeLength() - before, pid });
    return true;
  }

  // Retirer une pierre : réservé aux joueurs de la Terre ; en coopération, à celui
  // qui l'a posée (comme on ne vend que ses propres lanternes).
  canRemoveStone(c, r, pid = this.localPlayer) {
    const g = this.grid;
    if (!g.inBounds(c, r)) return { ok: false, reason: 'bounds' };
    const busy = this.busy();
    if (busy) return { ok: false, reason: busy };
    if (!this.canUseStones(pid)) return { ok: false, reason: 'element' };
    const i = g.idx(c, r);
    if (!g.stone[i]) return { ok: false, reason: 'open' };
    const owner = this.stoneOwner[i];
    if (this.players.length > 1 && owner >= 0 && owner !== pid) return { ok: false, reason: 'owner', owner };
    return { ok: true };
  }

  removeStone(c, r, pid = this.localPlayer) {
    if (!this.canRemoveStone(c, r, pid).ok) return false;
    const g = this.grid;
    const i = g.idx(c, r);
    const before = this.routeLength();
    g.stone[i] = 0;
    this.stonesPlaced--;
    const refund = Math.floor(this.stoneCost() * this.rules.stoneRefund);
    // le remboursement revient à celui qui a payé la pierre
    const owner = this.stoneOwner[i] >= 0 ? this.stoneOwner[i] : pid;
    this.stoneOwner[i] = -1;
    this.player(owner).gold += refund;
    this.flow.compute();
    this.refreshBarriers();
    this.emit('unstone', { c, r, refund, delta: this.routeLength() - before, pid, owner });
    return true;
  }

  // ───────────────────────── aperçus (sans effet de bord) ─────────────────────────

  // Combos qui naîtraient si l'on posait `type` en (c, r) (échos compris).
  previewCombos(type, c, r) {
    const out = [];
    const el = this.elementOf(type);
    for (const t of [...this.towers, ...this.echoes]) {
      if (t.element === el || Math.max(Math.abs(t.c - c), Math.abs(t.r - r)) !== 1) continue;
      const def = this.comboFor(type, t.type);
      if (def) out.push({ def, other: t });
    }
    return out;
  }

  // Conséquences d'une fusion : case libérée, combos perdus (lanterne source)
  // et combos conservés (lanterne cible), niveau obtenu.
  previewFuse(srcId, dstId, pid = this.localPlayer) {
    const check = this.canFuse(srcId, dstId, pid);
    const src = this.towerById(srcId);
    const dst = this.towerById(dstId);
    if (!check.ok) return { ok: false, reason: check.reason };
    const lost = this.zones.filter((z) => (z.a === src.id || z.b === src.id) && z.a !== dst.id && z.b !== dst.id);
    const kept = this.zones.filter((z) => z.a === dst.id || z.b === dst.id);
    return { ok: true, level: dst.level + 1, freed: { c: src.c, r: src.r }, lost, kept };
  }

  // Chemin si l'on posait une pierre en (c, r) : validité, gain de cases et tracés.
  // Les pierres en construction comptent comme posées : le chemin tel qu'il sera.
  previewStone(c, r, pid = this.localPlayer) {
    const g = this.grid;
    if (!g.inBounds(c, r)) return { ok: false, reason: 'bounds', delta: 0, routes: [] };
    const i = g.idx(c, r);
    return this.withPendingStones((pending) => {
      const check = this.canPlaceStone(c, r, pid);
      const dist = bfs(g, i);
      const routes = [];
      let len = 0;
      for (const s of g.spawns) {
        if (dist[s] < 0) continue;
        len += dist[s];
        // même départage que les yokai (spawnEnemy : ils partent vers le bas)
        routes.push(routeOf(g, dist, s, 0, 1));
      }
      let base = this.routeLength();
      if (pending) {
        const d0 = bfs(g);
        base = 0;
        for (const s of g.spawns) base += Math.max(0, d0[s]);
      }
      return { ok: check.ok, reason: check.reason, delta: check.ok || check.reason === 'gold' ? len - base : 0, routes };
    }, i);
  }

  // Exécute fn(pending) avec les pierres en construction (file des commandes) posées
  // sur la grille, puis la rend intacte (lecture seule) : vérification et aperçu d'une
  // NOUVELLE pierre. Sans cela, deux pierres posées coup sur coup, chacune inoffensive
  // seule, fermaient ensemble le passage : l'aperçu promettait « +X cases » et la
  // seconde était refusée 2 s plus tard (« Bloqué ! »). Une pierre en attente sous un
  // yokai n'est pas comptée (elle-même sera refusée s'il s'y tient encore) ; `except` :
  // case laissée telle quelle (celle de la pierre examinée).
  withPendingStones(fn, except = -1) {
    const g = this.grid;
    const put = [];
    for (const e of this.queue) {
      if (e.cancelled || e.op !== 'placeStone') continue;
      const [c, r] = e.args;
      if (!g.inBounds(c, r)) continue;
      const i = g.idx(c, r);
      if (i === except || g.type(i) !== T.OPEN || g.stone[i]) continue;
      if (this.enemies.some((en) => en.alive && !en.flying && (en.cur === i || en.target === i || g.tileAt(en.mx, en.my) === i))) continue;
      g.stone[i] = 1;
      put.push(i);
    }
    try {
      return fn(put.length > 0);
    } finally {
      for (const i of put) g.stone[i] = 0;
    }
  }

  // Composition de la prochaine vague (aperçu du bouton d'appel).
  nextWavePreview() {
    const idx = this.waveIndex + 1;
    if (idx >= this.waves.length) return null;
    const wave = this.waves[idx];
    const counts = new Map();
    for (const gr of wave.groups) {
      const key = gr.enemy + (gr.absorb ? `:${gr.absorb}` : '');
      const cur = counts.get(key) || { enemy: gr.enemy, absorb: gr.absorb ?? null, count: 0 };
      cur.count += gr.count;
      counts.set(key, cur);
    }
    const t = this.nextWaveT;
    return {
      index: idx,
      groups: [...counts.values()],
      climax: !!wave.climax,
      name: wave.name || null,
      countdown: t,
      bonus: t != null && t > 0 ? Math.floor(t * this.rules.earlyBonusPerSecond) : 0,
      charge: t != null && t > 0 && this.rewindEnabled && !this.chargedWaves.has(idx) ? Math.round(t * this.rules.rewindPerEarlySecond) : 0,
    };
  }

  canCallNextWave() {
    return !this.busy() && !this.lastChanceT && this.waveIndex + 1 < this.waves.length;
  }

  // ───────────────────────── file de commandes ─────────────────────────
  //
  // Toute action d'un joueur passe par issue() : elle reçoit une image d'exécution
  // (frame) et s'exécute précisément à cette image. Les poses (lanterne, pierre, mur)
  // attendent le délai de construction (rules.buildTime) : la lanterne apparaît
  // « en construction » puis s'active. En coopération, tous les téléphones reçoivent
  // les mêmes commandes datées et calculent exactement la même partie ; les 2 s de
  // construction laissent aux commandes le temps de parvenir à chacun, sans retour
  // en arrière. Les autres commandes attendent commandDelay (0 en solo).

  buildFrames() {
    return Math.round((this.rules.buildTime ?? 0) / STEP);
  }

  delayFor(op) {
    return PLACEMENTS.has(op) ? this.buildFrames() : this.commandDelay;
  }

  // Commande du joueur `pid`. Renvoie l'entrée de la file (exécutée tout de suite si
  // le délai est nul : entry.done, entry.result) ou null si elle est refusée d'emblée.
  issue(op, args = [], pid = this.localPlayer) {
    if (COMMANDS[op] == null) return null;
    const check = this.canIssue(op, args, pid);
    if (!check.ok) {
      if (op === 'placeTower') this.emit('reject', { c: args[1], r: args[2], reason: check.reason, element: check.element, pid });
      else if (op === 'placeStone') this.emit('reject', { c: args[0], r: args[1], reason: check.reason, pid });
      return null;
    }
    const entry = this.makeEntry(op, args, pid, this.frame + this.delayFor(op));
    if (entry.frame <= this.frame) this.execute(entry);
    else this.enqueue(entry);
    return entry;
  }

  makeEntry(op, args, pid, frame) {
    const a = (args || []).slice(0, COMMANDS[op]);
    while (a.length < COMMANDS[op]) a.push(null);
    return { id: this.cmdSeq++, frame, issued: this.frame, pid, op, args: a };
  }

  // Ajoute une commande datée (venue du réseau ou d'issue()), dans l'ordre (image, id).
  enqueue(entry) {
    this.cmdSeq = Math.max(this.cmdSeq, entry.id + 1);
    if (this.queue.some((e) => e.id === entry.id)) return false;
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1].frame > entry.frame || (this.queue[i - 1].frame === entry.frame && this.queue[i - 1].id > entry.id))) i--;
    this.queue.splice(i, 0, entry);
    if (PLACEMENTS.has(entry.op)) this.emit('pending', { entry });
    return true;
  }

  // Exécute les commandes arrivées à échéance. Pendant l'animation du Rembobinage ou
  // la dernière chance, elles patientent (sauf le Rembobinage lui-même). Chaque
  // commande reste dans la file jusqu'à son exécution : une annulation exécutée ici
  // trouve encore la pose plus tardive qu'elle vise (coopération : 'cancel' en file).
  runQueue() {
    if (!this.queue.length) return;
    for (const entry of this.queue.slice()) {
      if (entry.cancelled || !this.queue.includes(entry)) continue;
      const b = this.busy();
      if (entry.frame > this.frame || b === 'rewinding' || (b === 'lastChance' && entry.op !== 'rewind')) continue;
      this.queue.splice(this.queue.indexOf(entry), 1);
      this.execute(entry);
    }
    if (this.queue.some((e) => e.cancelled)) this.queue = this.queue.filter((e) => !e.cancelled);
  }

  execute(entry) {
    const { op, args, pid } = entry;
    let res = null;
    if (op === 'cancel') res = this.cancelEntry(args[0], pid);
    else if (op === 'startNextWave') res = args[0] != null && args[0] !== this.waveIndex + 1 ? false : this.startNextWave(pid, true);
    else if (op === 'undoPlace') res = this.undoPlace(args[0], this.undoWindow(), pid);
    else if (op === 'setRally') res = this.setRally(args[0], args[1], args[2], pid);
    else if (typeof this[op] === 'function') res = this[op](...args, pid);
    entry.done = true;
    entry.ok = !!res;
    entry.result = res && typeof res === 'object' ? res.id ?? true : res;
    if (op === 'placeTower' || op === 'placeStone') {
      this.recent.push({ id: entry.id, pid, op, args: entry.args, result: entry.result, frame: this.frame });
      while (this.recent.length && this.frame - this.recent[0].frame > 600) this.recent.shift();
    }
    this.emit('executed', { entry });
    return res;
  }

  // Fenêtre d'annulation d'une pose (s), délai des commandes compris.
  undoWindow() {
    return 3 + this.commandDelay * STEP + 0.5;
  }

  // Annuler une commande : encore en file, elle est retirée (rien n'était payé) ;
  // déjà exécutée (pose récente), la lanterne est reprise et son prix rendu.
  cancelEntry(entryId, pid) {
    const q = this.queue.find((e) => e.id === entryId && !e.cancelled);
    if (q) {
      if (q.pid !== pid) return false;
      q.cancelled = true;
      this.queue = this.queue.filter((e) => e !== q);
      this.emit('cancel', { entry: q, pid });
      return true;
    }
    const r = this.recent.find((e) => e.id === entryId);
    if (!r || r.pid !== pid || !r.result) return false;
    if (r.op === 'placeTower') return this.undoPlace(r.result, this.undoWindow(), pid);
    if (r.op === 'placeStone') {
      // « Annuler » touché pendant la construction, mais exécuté juste après l'activation
      // (coopération : délai des commandes, latence) : la pierre est reprise comme si
      // elle n'avait jamais été posée — prix rendu en entier, pierre rendue à la réserve.
      // (Sans cela : moitié du prix et une pierre de la réserve perdues, en silence.)
      if (this.frame - r.frame <= this.commandDelay + 90) return this.undoStone(r.args[0], r.args[1], pid);
      return this.removeStone(r.args[0], r.args[1], pid);
    }
    return false;
  }

  // Reprise d'une pierre tout juste posée (voir cancelEntry).
  undoStone(c, r, pid = this.localPlayer) {
    const g = this.grid;
    if (!g.inBounds(c, r) || this.busy()) return false;
    const i = g.idx(c, r);
    if (!g.stone[i] || this.stoneOwner[i] !== this.player(pid).id) return false;
    const before = this.routeLength();
    g.stone[i] = 0;
    this.stoneOwner[i] = -1;
    this.stonesPlaced--;
    this.stats.stones = Math.max(0, this.stats.stones - 1);
    const refund = this.stoneCost();
    this.player(pid).gold += refund;
    this.flow.compute();
    this.refreshBarriers();
    this.emit('unstone', { c, r, refund, delta: this.routeLength() - before, pid, owner: pid, undo: true });
    return true;
  }

  // Poses en attente de construction (pour l'affichage « en construction »).
  pendingPlacements(pid = null) {
    return this.queue.filter((e) => PLACEMENTS.has(e.op) && !e.cancelled && (pid == null || e.pid === pid));
  }

  // Avancement d'une commande en file (0 → 1).
  progressOf(entry) {
    const span = entry.frame - entry.issued;
    return span > 0 ? Math.max(0, Math.min(1, (this.frame - entry.issued) / span)) : 1;
  }

  // Or déjà promis par les poses en attente d'un joueur.
  reservedGold(pid = this.localPlayer) {
    let n = 0;
    for (const e of this.queue) {
      if (e.cancelled || e.pid !== pid) continue;
      if (e.op === 'placeTower') n += this.defs.towers[e.args[0]]?.cost ?? 0;
      else if (e.op === 'placeStone') n += this.stoneCost();
    }
    return n;
  }

  // Or disponible pour une nouvelle pose.
  spendable(pid = this.localPlayer) {
    return this.goldOf(pid) - this.reservedGold(pid);
  }

  // La commande serait-elle acceptée maintenant ? (poses en attente comprises)
  canIssue(op, args = [], pid = this.localPlayer) {
    const pend = this.queue.filter((e) => !e.cancelled);
    const no = (reason, extra = {}) => ({ ok: false, reason, ...extra });
    switch (op) {
      case 'placeTower': {
        const [type, c, r] = args;
        const def = this.defs.towers[type];
        if (!def) return no('unknown');
        const check = this.canPlaceTower(type, c, r, pid);
        if (!check.ok && check.reason !== 'gold') return check;
        if (pend.some((e) => e.op === 'placeTower' && e.args[1] === c && e.args[2] === r)) return no('pending', { owner: pend.find((e) => e.op === 'placeTower' && e.args[1] === c && e.args[2] === r).pid });
        const max = this.challengeRule?.maxTowers;
        if (max != null && this.stats.towersBuilt + pend.filter((e) => e.op === 'placeTower').length >= max) return no('challenge');
        if (this.spendable(pid) < def.cost) return no('gold');
        return { ok: true };
      }
      case 'placeStone': {
        const [c, r] = args;
        // pierres en construction comprises (ensemble, elles bloqueraient le passage)
        const check = this.grid.inBounds(c, r) ? this.withPendingStones(() => this.canPlaceStone(c, r, pid), this.grid.idx(c, r)) : this.canPlaceStone(c, r, pid);
        if (!check.ok && check.reason !== 'gold' && check.reason !== 'limit') return check;
        const stones = pend.filter((e) => e.op === 'placeStone');
        if (stones.some((e) => e.args[0] === c && e.args[1] === r)) return no('pending');
        // un mur s'y dresse bientôt (« Déplacer le mur » en construction)
        if (pend.some((e) => e.op === 'setRally' && e.args[1] === c && e.args[2] === r)) return no('barrier');
        if (this.stonesLeft() - stones.length <= 0) return no('limit');
        if (this.spendable(pid) < this.stoneCost()) return no('gold');
        return { ok: true };
      }
      case 'setRally': {
        const t = this.towerById(args[0]);
        if (!t || (this.players.length > 1 && t.owner !== pid) || this.busy()) return no('unknown');
        // (une pierre en construction sur la case l'occupera)
        if (!this.grid.inBounds(args[1], args[2]) || !this.withPendingStones(() => this.rallyTiles(t.id)).includes(this.grid.idx(args[1], args[2]))) return no('rally');
        return { ok: true };
      }
      case 'fuse':
        return this.canFuse(args[0], args[1], pid);
      case 'sellTower': {
        const t = this.towerById(args[0]);
        return t && !this.busy() && (this.players.length === 1 || t.owner === pid) ? { ok: true } : no('unknown');
      }
      case 'removeStone':
        return this.canRemoveStone(args[0], args[1], pid);
      case 'startNextWave':
        if (args[0] != null && args[0] !== this.waveIndex + 1) return no('wave');
        return this.canCallNextWave() && !pend.some((e) => e.op === 'startNextWave') ? { ok: true } : no('wave');
      case 'rewind':
        return this.canRewind() && !pend.some((e) => e.op === 'rewind') ? { ok: true } : no('rewind');
      default:
        return { ok: true };
    }
  }

  // ───────────────────────── vagues ─────────────────────────

  waveSpawnDuration(idx) {
    let d = 0;
    for (const g of this.waves[idx].groups) d = Math.max(d, (g.delay ?? 0) + (g.count - 1) * (g.interval ?? 1));
    return d;
  }

  wavePause(idx) {
    return this.waves[idx].pause ?? this.level.wavePause ?? this.rules.wavePause;
  }

  // Lance la vague suivante (appel du joueur ou fin du compte à rebours). Appelée en
  // avance, elle rapporte de l'or à chaque joueur et recharge le Rembobinage.
  startNextWave(pid = this.localPlayer, early = true) {
    if (!this.canCallNextWave()) return false;
    const idx = this.waveIndex + 1;
    if (early && this.nextWaveT != null && this.nextWaveT > 0) {
      const bonus = Math.floor(this.nextWaveT * this.rules.earlyBonusPerSecond);
      const charge = this.nextWaveT * (this.rules.rewindPerEarlySecond ?? 0);
      if (bonus > 0) {
        const each = this.reward(bonus, 'early');
        this.emit('earlyBonus', { gold: each, charge: Math.round(charge), pid });
      }
      if (this.rewindEnabled && !this.chargedWaves.has(idx)) {
        this.chargedWaves.add(idx);
        this.rewindCharge = Math.min(this.rules.rewindCost ?? 100, this.rewindCharge + charge);
      }
    }
    this.waveIndex = idx;
    this.state = 'wave';
    const wave = this.waves[idx];
    wave.groups.forEach((g, gi) => {
      const timeless = !!this.defs.enemies[g.enemy]?.abilities?.timeless;
      this.spawners.push({
        wave: idx,
        group: gi,
        enemy: g.enemy,
        count: g.count,
        interval: g.interval ?? 1,
        spawn: g.spawn ?? 0,
        hp: g.hp ?? 1,
        absorb: g.absorb ?? null,
        t: -(g.delay ?? 0),
        spawned: timeless ? this.timelessSpawned[`${idx}:${gi}`] ?? 0 : 0,
        timeless,
      });
    });
    this.nextWaveT = idx < this.waves.length - 1 ? this.waveSpawnDuration(idx) + this.wavePause(idx) : null;
    this.emit('waveStart', { index: idx, total: this.waves.length, climax: !!wave.climax, name: wave.name || null, early, pid });
    return true;
  }

  // ───────────────────────── boucle ─────────────────────────

  update(dt) {
    if (this.state === 'won' || this.state === 'lost') return;
    this.frame++;
    this.runQueue();
    if (this.rewindAnim) {
      this.rewindAnim.t += dt;
      if (this.rewindAnim.t >= this.rewindAnim.dur) this.finishRewind();
      return;
    }
    // Dernière chance : la partie est figée tant que le joueur peut rembobiner.
    if (this.lastChanceT > 0) {
      this.lastChanceT -= dt;
      if (this.lastChanceT <= 0) this.lose();
      return;
    }
    this.time += dt;
    if (this.state === 'wave') {
      this.ct += dt;
      this.recordHistory(dt);
      if (this.nextWaveT != null) {
        this.nextWaveT -= dt;
        if (this.nextWaveT <= 0) this.startNextWave(-1, false); // départ automatique (aucun joueur)
      }
      this.updateSpawners(dt);
    }
    this.updateEnemies(dt);
    this.updateBarriers(dt);
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    updateZones(this, dt);
    updateTornadoes(this, dt);
    this.cleanup();
    this.checkWaves();
  }

  updateSpawners(dt) {
    for (const s of this.spawners) {
      if (s.spawned >= s.count) continue;
      s.t += dt;
      while (s.t >= 0 && s.spawned < s.count) {
        const spawnTile = this.grid.spawns[s.spawn % this.grid.spawns.length];
        this.spawnEnemy(s.enemy, spawnTile, { hpMult: s.hp, absorb: s.absorb, wave: s.wave, uid: `${s.wave}.${s.group}.${s.spawned}` });
        s.spawned++;
        if (s.timeless) this.timelessSpawned[`${s.wave}:${s.group}`] = s.spawned;
        s.t -= s.interval;
      }
    }
  }

  spawnersDone(wave = null) {
    return this.spawners.every((s) => (wave != null && s.wave !== wave) || s.spawned >= s.count);
  }

  // Portails (index des cases S) d'où sortiront encore des volants pendant les vagues
  // en cours : le rendu trace leur ligne droite vers le sanctuaire.
  flyerPortals() {
    const out = new Set();
    for (const sp of this.spawners) if (sp.spawned < sp.count && this.defs.enemies[sp.enemy]?.abilities?.flying) out.add(sp.spawn ?? 0);
    return [...out];
  }

  // Fin de chaque vague (récompense) et victoire.
  checkWaves() {
    // pendant la dernière chance, la partie est suspendue : ni fin de vague ni victoire
    if (this.state !== 'wave' || this.lastChanceT > 0) return;
    for (let w = 0; w <= this.waveIndex; w++) {
      if (this.waveCleared[w]) continue;
      if (!this.spawnersDone(w) || this.enemies.some((e) => e.wave === w)) continue;
      this.waveCleared[w] = true;
      const reward = this.waves[w].reward ?? this.rules.waveReward;
      const each = this.reward(reward, 'wave');
      this.emit('waveEnd', { index: w, reward: each ?? 0 });
    }
    if (this.waveIndex >= this.waves.length - 1 && this.spawnersDone() && this.enemies.length === 0) {
      this.state = 'won';
      this.emit('win', { stars: this.stars(), challenge: this.challengeMet() });
    }
  }

  // ───────────────────────── yokai ─────────────────────────

  createEnemy(type, opts = {}) {
    const def = this.defs.enemies[type];
    if (!def) throw new Error(`Yokai inconnu : ${type}`);
    const hp = def.hp * (opts.hpMult ?? 1) * this.hpScale;
    const seed = this.rng.next();
    const ab = def.abilities || {};
    const id = this.nextId++;
    return {
      id,
      uid: opts.uid ?? `x${id}`, // identité stable d'une partie à l'autre de la chronologie
      type,
      wave: opts.wave ?? this.waveIndex,
      x: 0,
      y: 0,
      px: 0,
      py: 0,
      vx: 0,
      vy: 0,
      hp,
      maxHp: hp,
      speed: def.speed,
      size: def.size ?? 0.3,
      armor: def.armor ?? 0,
      flying: !!ab.flying,
      timeless: !!ab.timeless,
      absorb: opts.absorb ?? ab.absorb ?? ab.cycleAbsorb?.elements[0] ?? null,
      hpMult: opts.hpMult ?? 1, // transmis aux enfants (division, invocation)
      groupAbsorb: opts.absorb ?? null,
      boss: !!def.boss,
      alive: true,
      cur: -1,
      target: -1,
      dirX: 0,
      dirY: 1,
      trail: [],
      // Position logique sur la ligne centrale du chemin (mx, my) et couloir latéral
      // persistant : les yokai ne se superposent pas et restent dénombrables.
      mx: 0,
      my: 0,
      lane: opts.lane ?? (seed - 0.5) * 0.36,
      offX: 0,
      offY: 0,
      // vol
      fx0: 0,
      fy0: 0,
      fx1: 0,
      fy1: 0,
      flyLen: 0,
      s: 0,
      // états
      slowF: 1,
      slowT: 0,
      burnDps: 0,
      burnT: 0,
      stunT: 0,
      blindT: 0,
      breakT: 0, // armure brisée
      shredM: 1,
      shredT: 0,
      slows: [],
      burns: [],
      shreds: [],
      pend: 0, // dégâts en route (projectiles guidés) : évite la surpuissance
      knock: 0,
      knockFatigue: 0,
      stunFatigue: 0,
      healT: 0,
      blocked: null, // barrière qui l'arrête
      passTile: -1, // case de barrière franchie d'un bond
      hopT: 0, // animation de saut
      hitT: 0,
      spawnT: opts.spawnT ?? 0.7,
      age: 0,
      seed,
      timers: {},
      enraged: false,
    };
  }

  spawnEnemy(type, spawnTile, opts = {}) {
    const e = this.createEnemy(type, opts);
    const g = this.grid;
    e.x = e.px = e.mx = g.cx(spawnTile);
    e.y = e.py = e.my = g.cy(spawnTile);
    if (e.flying) {
      const goal = this.nearestGoal(e.x, e.y);
      e.fx0 = e.x;
      e.fy0 = e.y;
      e.fx1 = g.cx(goal);
      e.fy1 = g.cy(goal);
      e.flyLen = hyp(e.fx1 - e.fx0, e.fy1 - e.fy0);
      e.s = 0;
    } else {
      e.cur = spawnTile;
      e.target = this.flow.next(spawnTile, 0, 1);
      if (e.target < 0) e.target = spawnTile;
    }
    this.enemies.push(e);
    this.emit('spawn', { enemy: e });
    return e;
  }

  // Case marchable reliée au sanctuaire la plus proche d'un point.
  nearestWalkable(x, y) {
    const g = this.grid;
    let best = g.goals[0];
    let bd = Infinity;
    for (let i = 0; i < g.size; i++) {
      if (!g.isWalkable(i) || this.flow.dist[i] < 0) continue;
      const d = hyp(g.cx(i) - x, g.cy(i) - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  nearestGoal(x, y) {
    let best = this.grid.goals[0];
    let bd = Infinity;
    for (const gi of this.grid.goals) {
      const d = hyp(this.grid.cx(gi) - x, this.grid.cy(gi) - y);
      if (d < bd) {
        bd = d;
        best = gi;
      }
    }
    return best;
  }

  // Distance restante jusqu'au sanctuaire (sert au ciblage « premier / dernier »).
  remaining(e) {
    if (e.flying) return e.flyLen - e.s;
    const d = this.flow.dist[e.target];
    const tx = this.grid.cx(e.target);
    const ty = this.grid.cy(e.target);
    return (d < 0 ? 999 : d) + hyp(tx - e.mx, ty - e.my);
  }

  updateEnemies(dt) {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.px = e.x;
      e.py = e.y;
      e.age += dt;
      if (e.hitT > 0) e.hitT -= dt;
      if (e.hopT > 0) e.hopT -= dt;
      if (e.spawnT > 0) {
        e.spawnT -= dt;
        continue;
      }
      this.updateStatuses(e, dt);
      if (!e.alive) continue;
      this.updateAbilities(e, dt);
      if (!e.alive) continue;
      if (e.knock > 0) this.applyKnock(e, dt);
      else this.moveEnemy(e, dt);
      if (dt > 0) {
        e.vx = (e.x - e.px) / dt;
        e.vy = (e.y - e.py) / dt;
      }
    }
  }

  updateStatuses(e, dt) {
    if (e.knockFatigue > 0) e.knockFatigue = Math.max(0, e.knockFatigue - dt * (this.rules.knockFatigueDecay ?? 0.2));
    if (e.stunFatigue > 0) e.stunFatigue = Math.max(0, e.stunFatigue - dt * (this.rules.stunFatigueDecay ?? 0.35));
    if (e.healT > 0) e.healT -= dt;
    if (e.stunT > 0) e.stunT -= dt;
    if (e.blindT > 0) e.blindT -= dt;
    if (e.breakT > 0) e.breakT -= dt;
    tickEffects(e.slows, dt);
    tickEffects(e.shreds, dt);
    tickEffects(e.burns, dt);
    refreshStatus(e);
    if (e.burnDps > 0) this.damage(e, e.burnDps * dt, 'fire', { dot: true });
  }

  // Capacités spéciales des yokai (paramétrées par les données).
  updateAbilities(e, dt) {
    const ab = this.defs.enemies[e.type].abilities;
    if (!ab) return;
    const tm = e.timers;
    if (ab.enrage && !e.enraged && e.hp < e.maxHp * ab.enrage.below) {
      e.enraged = true;
      e.speed *= ab.enrage.speed;
      this.emit('enrage', { enemy: e });
    }
    if (ab.hop) tm.hop = (tm.hop ?? 0) + dt;
    if (e.blindT > 0 || e.stunT > 0) return; // aveuglé (Vapeur) ou étourdi : pouvoirs suspendus
    if (ab.healAura) {
      tm.heal = (tm.heal ?? ab.healAura.interval * 0.5) - dt;
      if (tm.heal <= 0) {
        tm.heal += ab.healAura.interval;
        let healed = false;
        for (const o of this.enemies) {
          if (o === e || !o.alive || o.hp >= o.maxHp || o.healT > 0) continue;
          if (hyp(o.x - e.x, o.y - e.y) > ab.healAura.radius) continue;
          o.hp = Math.min(o.maxHp, o.hp + o.maxHp * ab.healAura.amount);
          o.healT = ab.healAura.interval * 0.9; // plusieurs soigneuses ne se cumulent pas
          healed = true;
        }
        if (healed) this.emit('heal', { enemy: e, radius: ab.healAura.radius });
      }
    }
    if (ab.summon) {
      tm.summon = (tm.summon ?? ab.summon.interval) - dt;
      if (tm.summon <= 0) {
        tm.summon += ab.summon.interval;
        tm.summonN = (tm.summonN ?? 0) + 1;
        for (let k = 0; k < ab.summon.count; k++) this.spawnChild(ab.summon.enemy, e, k, ab.summon.count, `s${tm.summonN}`);
        this.emit('summon', { enemy: e });
      }
    }
    if (ab.cycleAbsorb) {
      tm.cycle = (tm.cycle ?? ab.cycleAbsorb.interval) - dt;
      if (tm.cycle <= 0) {
        tm.cycle += ab.cycleAbsorb.interval;
        const els = ab.cycleAbsorb.elements;
        e.absorb = els[(els.indexOf(e.absorb) + 1) % els.length];
        if (e.absorb === 'fire') e.burns.length = 0;
        if (e.absorb === 'water') e.slows.length = 0;
        refreshStatus(e);
        this.emit('absorbShift', { enemy: e, element: e.absorb });
      }
    }
    if (ab.stomp) {
      tm.stomp = (tm.stomp ?? ab.stomp.interval) - dt;
      if (tm.stomp <= 0) {
        tm.stomp += ab.stomp.interval;
        const hit = [];
        for (const t of [...this.towers, ...this.echoes]) {
          if (hyp(t.x - e.x, t.y - e.y) <= ab.stomp.radius) {
            // la Source sacrée voisine dissipe une part de l'étourdissement
            t.stunT = Math.max(t.stunT, ab.stomp.stun * (1 - (t.cleanse || 0)));
            hit.push(t.id);
          }
        }
        this.emit('stomp', { enemy: e, radius: ab.stomp.radius, towers: hit });
      }
    }
  }

  // Fait apparaître un yokai à la position d'un autre (division, invocation).
  spawnChild(type, parent, k = 0, n = 1, tag = 'c') {
    // Couloirs opposés et apparitions décalées : les enfants restent distincts.
    const lane = n > 1 ? Math.max(-0.2, Math.min(0.2, (k - (n - 1) / 2) * 0.4)) : parent.lane;
    const e = this.createEnemy(type, {
      spawnT: 0.25 + k * 0.2,
      hpMult: parent.hpMult,
      absorb: parent.groupAbsorb ?? undefined,
      lane,
      wave: parent.wave,
      uid: `${parent.uid}/${tag}${k}`,
    });
    e.x = e.px = e.mx = parent.x;
    e.y = e.py = e.my = parent.y;
    e.dirX = parent.dirX;
    if (e.flying) {
      if (parent.flying) {
        Object.assign(e, { fx0: parent.fx0, fy0: parent.fy0, fx1: parent.fx1, fy1: parent.fy1, flyLen: parent.flyLen, s: parent.s });
      } else {
        const goal = this.nearestGoal(e.x, e.y);
        Object.assign(e, { fx0: e.x, fy0: e.y, fx1: this.grid.cx(goal), fy1: this.grid.cy(goal), s: 0 });
        e.flyLen = hyp(e.fx1 - e.fx0, e.fy1 - e.fy0);
      }
    } else if (parent.flying) {
      // Enfant terrestre d'un volant : il atterrit sur la case marchable la plus proche.
      const land = this.nearestWalkable(parent.x, parent.y);
      e.x = e.px = e.mx = this.grid.cx(land);
      e.y = e.py = e.my = this.grid.cy(land);
      e.cur = land;
      e.target = this.flow.next(land, 0, 1);
      if (e.target < 0) e.target = land;
    } else {
      e.cur = parent.cur;
      e.target = parent.target;
      e.trail = parent.trail.slice();
      e.mx = parent.mx;
      e.my = parent.my;
      e.offX = parent.offX;
      e.offY = parent.offY;
      e.passTile = parent.passTile;
    }
    this.enemies.push(e);
    this.emit('spawnChild', { enemy: e, parent });
    return e;
  }

  speedOf(e) {
    if (e.stunT > 0) return 0;
    let s = e.speed;
    if (e.slowT > 0) s *= e.slowF;
    return s;
  }

  // Barrière vivante sur une case (ou null).
  barrierAt(tile) {
    for (const b of this.barriers) if (b.alive && b.tile === tile) return b;
    return null;
  }

  moveEnemy(e, dt) {
    if (e.flying) {
      const remain = this.speedOf(e) * dt;
      if (remain <= 0) return;
      e.s += remain;
      if (e.s >= e.flyLen) {
        e.s = e.flyLen;
        this.leak(e);
        return;
      }
      this.placeFlyer(e);
      return;
    }
    const g = this.grid;
    e.blocked = null;
    let remain = this.speedOf(e) * dt;
    let guard = 0;
    while (remain > 0 && guard++ < 8) {
      const tx = g.cx(e.target);
      const ty = g.cy(e.target);
      const dx = tx - e.mx;
      const dy = ty - e.my;
      const d = hyp(dx, dy);
      // Une barrière sur la case suivante l'arrête au bord de cette case.
      const bar = e.passTile === e.target ? null : this.barrierAt(e.target);
      if (bar) {
        const stop = 0.5;
        if (d - stop <= remain) {
          if (d > stop) {
            e.mx += (dx / d) * (d - stop);
            e.my += (dy / d) * (d - stop);
          }
          this.blockBy(e, bar, dt);
          break;
        }
      }
      if (d <= remain) {
        e.mx = tx;
        e.my = ty;
        remain -= d;
        if (g.type(e.target) === T.GOAL) {
          this.leak(e);
          return;
        }
        if (e.cur !== e.target) {
          e.trail.push(e.cur);
          if (e.trail.length > 10) e.trail.shift();
        }
        const prev = e.cur;
        e.cur = e.target;
        if (e.passTile !== -1 && e.passTile !== e.cur) e.passTile = -1;
        const pdx = g.col(e.cur) - g.col(prev);
        const pdy = g.row(e.cur) - g.row(prev);
        const n = this.flow.next(e.cur, pdx, pdy);
        if (n < 0) break; // isolé (ne devrait pas arriver : la pose est validée)
        e.target = n;
      } else {
        e.mx += (dx / d) * remain;
        e.my += (dy / d) * remain;
        if (Math.abs(dx) > 0.01) e.dirX = dx;
        remain = 0;
      }
    }
    this.applyLane(e, dt);
  }

  // Yokai arrêté par une barrière : il la frappe (ou bondit par-dessus).
  blockBy(e, bar, dt) {
    const def = this.defs.enemies[e.type];
    const hop = def.abilities?.hop;
    if (hop && e.blindT <= 0 && e.stunT <= 0 && (e.timers.hop ?? 0) >= hop.interval) {
      e.timers.hop = 0;
      e.passTile = bar.tile;
      e.hopT = 0.5;
      this.emit('hop', { enemy: e, barrier: bar });
      return;
    }
    e.blocked = bar.id;
    if (e.stunT > 0) return;
    bar.hp -= (def.attack ?? 8) * dt;
    bar.hitT = 0.15;
    const thorns = bar.thorns || 0;
    if (thorns) this.damage(e, thorns * dt, 'earth', { dot: true });
    if (bar.hp <= 0) this.breakBarrier(bar);
  }

  // Décale le yokai sur son couloir, perpendiculairement à sa marche (lissé).
  applyLane(e, dt) {
    const g = this.grid;
    let dx = g.cx(e.target) - e.mx;
    let dy = g.cy(e.target) - e.my;
    const d = hyp(dx, dy);
    if (d > 1e-3) {
      dx /= d;
      dy /= d;
      const k = Math.min(1, dt * 6);
      e.offX += (-dy * e.lane - e.offX) * k;
      e.offY += (dx * e.lane - e.offY) * k;
    }
    e.x = e.mx + e.offX;
    e.y = e.my + e.offY;
  }

  // Position d'un volant le long de sa ligne (légère ondulation).
  placeFlyer(e) {
    const k = e.flyLen > 0 ? e.s / e.flyLen : 1;
    const nx = -(e.fy1 - e.fy0) / (e.flyLen || 1);
    const ny = (e.fx1 - e.fx0) / (e.flyLen || 1);
    const wob = dsin(k * Math.PI * 3 + e.seed * 6) * 0.35 * dsin(k * Math.PI);
    e.x = e.mx = e.fx0 + (e.fx1 - e.fx0) * k + nx * wob;
    e.y = e.my = e.fy0 + (e.fy1 - e.fy0) * k + ny * wob;
    e.dirX = e.fx1 - e.fx0;
  }

  // Recul (Vent) : le yokai est repoussé le long de son propre trajet.
  applyKnock(e, dt) {
    let remain = Math.min(e.knock, 6 * dt);
    e.knock -= remain;
    e.blocked = null;
    if (e.flying) {
      e.s = Math.max(0, e.s - remain);
      this.placeFlyer(e);
      return;
    }
    const g = this.grid;
    let guard = 0;
    while (remain > 0 && guard++ < 8) {
      // On recule d'abord vers le centre de la case courante, puis le long de la trace.
      // Au centre, la case précédente de la trace devient aussitôt la case courante
      // (le yokai repart vers elle ; canPlaceStone la protège donc des pierres).
      if (hyp(g.cx(e.cur) - e.mx, g.cy(e.cur) - e.my) < 1e-3) {
        const back = e.trail[e.trail.length - 1];
        if (back == null || !g.isWalkable(back) || this.flow.dist[back] < 0 || this.barrierAt(back)) {
          e.knock = 0;
          break;
        }
        e.trail.pop();
        e.target = e.cur;
        e.cur = back;
        continue;
      }
      const bx = g.cx(e.cur);
      const by = g.cy(e.cur);
      const d = hyp(bx - e.mx, by - e.my);
      if (d <= remain) {
        e.mx = bx;
        e.my = by;
        remain -= d;
      } else {
        e.mx += ((bx - e.mx) / d) * remain;
        e.my += ((by - e.my) / d) * remain;
        remain = 0;
      }
    }
    this.applyLane(e, dt);
  }

  leak(e) {
    if (!e.alive) return;
    e.alive = false;
    const dmg = this.defs.enemies[e.type].damage ?? 1;
    this.lives = Math.max(0, this.lives - dmg);
    if (e.timeless) {
      this.timelessLoss += dmg;
      this.timelessLeaks++;
    }
    this.stats.leaks++;
    this.emit('leak', { enemy: e, damage: dmg });
    if (this.lives <= 0 && this.state !== 'lost') {
      // Jauge pleine : dernière chance de rembobiner avant la chute du sanctuaire, si le
      // rembobinage rend des vies (pas celles des yokai hors du temps, qui restent perdues ;
      // une fuite fatale de tokihami peut donc être sauvée par les autres fuites effacées).
      if (this.canRewind() && this.rewindLives() > 0) {
        this.lastChanceT = this.rules.lastChanceSeconds ?? 4;
        this.emit('lastChance', { seconds: this.lastChanceT });
      } else this.lose();
    }
  }

  lose() {
    if (this.state === 'lost') return;
    this.lastChanceT = 0;
    this.state = 'lost';
    this.emit('lose', {});
  }

  // Résistance d'un yokai à un élément (0,5 = −50 %, −0,3 = +30 %).
  resistOf(e, element) {
    return this.defs.enemies[e.type].resist?.[element] ?? 0;
  }

  /**
   * Inflige des dégâts élémentaires.
   * opts : { pierce (0..1, part de l'armure ignorée), dot (brûlure/aura : ignore l'armure), owner }
   */
  damage(e, amount, element, opts = {}) {
    if (!e.alive || !(amount > 0) || !Number.isFinite(amount)) return 0;
    if (e.absorb && e.absorb === element && e.blindT <= 0) {
      // Un coup de son élément le soigne ; une brûlure résiduelle s'éteint simplement.
      if (opts.dot) return 0;
      e.hp = Math.min(e.maxHp, e.hp + amount * 0.5);
      this.emit('absorb', { enemy: e, element });
      return 0;
    }
    let dealt = amount * (1 - this.resistOf(e, element));
    if (dealt <= 0) return 0;
    // Armure partielle : retranchée de chaque coup (au moins armorMinDamage passe) ;
    // `pierce` en ignore une part ; brûlures, auras et armure brisée l'ignorent.
    if (!opts.dot && e.armor > 0 && e.breakT <= 0) {
      const armor = e.armor * (1 - (opts.pierce ?? 0));
      dealt = Math.max(dealt * (this.rules.armorMinDamage ?? 0.2), dealt - armor);
    }
    if (e.shredT > 0) dealt *= e.shredM;
    e.hp -= dealt;
    if (!opts.dot) e.hitT = 0.12;
    if (e.hp <= 0) this.kill(e, element);
    return dealt;
  }

  kill(e, element) {
    if (!e.alive) return;
    e.alive = false;
    const def = this.defs.enemies[e.type];
    const reward = def.reward ?? 0;
    const each = this.reward(reward, 'kill');
    this.stats.kills++;
    if (e.timeless) {
      // hors du temps : le rembobinage ne le ramène pas, il ne reprend donc pas sa prime
      this.timelessKills++;
      if (each) {
        for (const p of this.players) this.timelessGold[p.id] += each;
        this.timelessEarned += each;
      }
    }
    if (this.rewindEnabled && !this.chargedKills.has(e.uid)) {
      this.chargedKills.add(e.uid);
      this.rewindCharge = Math.min(this.rules.rewindCost ?? 100, this.rewindCharge + reward * (this.rules.rewindPerGold ?? 0));
    }
    this.emit('kill', { enemy: e, reward: each ?? reward, element });
    this.onKill(e, def);
  }

  // Effets à la mort.
  onKill(e, def) {
    const split = def.abilities?.split;
    if (split) {
      for (let k = 0; k < split.count; k++) this.spawnChild(split.into, e, k, split.count, 'd');
      this.emit('split', { enemy: e });
    }
  }

  // ───────────────────────── barrières (Gardien de pierre) ─────────────────────────

  // Case de chemin où dresser la barrière d'une tour : le point de ralliement choisi
  // s'il est valide, sinon la case marchable libre la plus proche dans la portée.
  barrierTileOk(t, range, i) {
    const g = this.grid;
    const ty = g.type(i);
    if (ty !== T.PATH && ty !== T.OPEN && ty !== T.BRIDGE) return false;
    if (g.stone[i] || this.flow.dist[i] < 0) return false;
    if (hyp(g.cx(i) - t.x, g.cy(i) - t.y) > range + 0.01) return false;
    if (this.barriers.some((b) => b.tile === i && b.towerId !== t.id)) return false;
    // Pas de mur sous les pieds d'un yokai (pose, ralliement, déplacement) : seule la
    // case suivante l'arrête, il traverserait. Le mur reste bien sûr sur sa propre case.
    if (this.barriers.some((b) => b.tile === i && b.towerId === t.id)) return true;
    return !this.groundEnemyOn(i);
  }

  // Un yokai terrestre vivant se tient-il sur la case i ?
  groundEnemyOn(i) {
    const g = this.grid;
    return this.enemies.some((e) => e.alive && !e.flying && (e.cur === i || g.tileAt(e.mx, e.my) === i));
  }

  // Cases où le Gardien `id` peut dresser son mur (pour l'interface « Déplacer le mur »).
  rallyTiles(id) {
    const t = this.towerById(id);
    if (!t || this.defs.towers[t.type].attack !== 'barrier') return [];
    const range = this.towerStats(t).range;
    const out = [];
    for (let i = 0; i < this.grid.size; i++) if (this.barrierTileOk(t, range, i)) out.push(i);
    return out;
  }

  barrierTileFor(t, range) {
    const g = this.grid;
    const route = this.routeTiles();
    const ok = (i) => this.barrierTileOk(t, range, i);
    if (t.rally != null && ok(t.rally)) return t.rally;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < g.size; i++) {
      if (!ok(i)) continue;
      // de préférence sur le trajet actuel des yokai, puis au plus près de la tour
      const d = (route.has(i) ? 0 : 100) + hyp(g.cx(i) - t.x, g.cy(i) - t.y) + this.flow.dist[i] * 0.001;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // Cases du trajet actuel (de chaque apparition au sanctuaire), parcouru comme les
  // yokai le parcourent : départ vers le bas, puis tout droit tant que c'est possible
  // (sans quoi, entre deux plus courts chemins, le mur pouvait finir à côté du passage).
  routeTiles() {
    if (this._routeV === this.flow.version && this._route) return this._route;
    const set = new Set();
    for (const sp of this.grid.spawns) for (const i of this.flow.route(sp, 0, 1)) set.add(i);
    this._route = set;
    this._routeV = this.flow.version;
    return set;
  }

  ensureBarrier(t) {
    const st = this.towerStats(t);
    let bar = this.barriers.find((b) => b.towerId === t.id);
    const tile = this.barrierTileFor(t, st.range);
    if (!bar) {
      if (tile < 0) return null;
      bar = { id: this.nextId++, towerId: t.id, owner: t.owner, tile, hp: st.barrierHp, maxHp: st.barrierHp, alive: true, respawnT: 0, hitT: 0, thorns: st.thorns || 0 };
      this.barriers.push(bar);
      this.emit('barrierUp', { barrier: bar });
      return bar;
    }
    bar.thorns = st.thorns || 0;
    if (tile >= 0 && tile !== bar.tile && !this.enemies.some((e) => e.blocked === bar.id)) bar.tile = tile;
    return bar;
  }

  // Point de ralliement d'une barrière (case de chemin dans la portée du gardien).
  setRally(id, c, r, pid = this.localPlayer) {
    const t = this.towerById(id);
    if (!t || this.defs.towers[t.type].attack !== 'barrier' || this.busy()) return false;
    if (this.players.length > 1 && t.owner !== pid) return false;
    const i = this.grid.inBounds(c, r) ? this.grid.idx(c, r) : -1;
    const prev = t.rally;
    t.rally = i;
    const st = this.towerStats(t);
    if (i < 0 || this.barrierTileFor(t, st.range) !== i) {
      t.rally = prev;
      return false;
    }
    const bar = this.barriers.find((b) => b.towerId === t.id);
    if (bar) {
      for (const e of this.enemies) if (e.blocked === bar.id) e.blocked = null;
      bar.tile = i;
    }
    this.emit('rally', { tower: t, tile: i });
    return true;
  }

  removeBarrierOf(t) {
    const bar = this.barriers.find((b) => b.towerId === t.id);
    if (!bar) return;
    for (const e of this.enemies) if (e.blocked === bar.id) e.blocked = null;
    this.barriers = this.barriers.filter((b) => b !== bar);
  }

  breakBarrier(bar) {
    if (!bar.alive) return;
    bar.alive = false;
    bar.hp = 0;
    const t = this.towerById(bar.towerId);
    bar.respawnT = t ? this.towerStats(t).respawn ?? 6 : 6;
    for (const e of this.enemies) if (e.blocked === bar.id) e.blocked = null;
    this.emit('barrierBreak', { barrier: bar });
  }

  updateBarriers(dt) {
    for (const bar of this.barriers) {
      if (bar.hitT > 0) bar.hitT -= dt;
      if (bar.alive) continue;
      const t = this.towerById(bar.towerId);
      if (!t || t.stunT > 0) continue;
      bar.respawnT -= dt;
      if (bar.respawnT > 0) continue;
      // on ne relève pas la barrière sous les pieds d'un yokai
      if (this.groundEnemyOn(bar.tile)) continue;
      const st = this.towerStats(t);
      bar.alive = true;
      bar.maxHp = st.barrierHp;
      bar.hp = st.barrierHp;
      this.emit('barrierUp', { barrier: bar });
    }
  }

  // ───────────────────────── soutien (Carillon, Source sacrée) ─────────────────────────

  // Bonus de cadence (le plus fort des carillons voisins) et purification (Source).
  recomputeSupport() {
    const all = [...this.towers, ...this.echoes];
    const echoPow = this.rules.echoPower ?? 0.5;
    for (const t of all) {
      t.rateMult = 1;
      t.cleanse = 0;
    }
    for (const s of all) {
      const def = this.defs.towers[s.type];
      if (def.attack !== 'support') continue;
      const st = this.towerStats(s);
      const pow = s.echo ? echoPow : 1;
      for (const t of all) {
        if (t === s || hyp(t.x - s.x, t.y - s.y) > st.range + 0.01) continue;
        if (st.rateBonus) t.rateMult = Math.max(t.rateMult, 1 + st.rateBonus * pow);
        if (st.cleanse) t.cleanse = Math.max(t.cleanse, st.cleanse * pow);
      }
    }
  }

  // ───────────────────────── rembobinage ─────────────────────────

  get rewindEnabled() {
    return !!this.level.rewind && !this.challengeRule?.noRewind;
  }

  recordHistory(dt) {
    if (!this.rewindEnabled) return;
    this.historyT -= dt;
    if (this.historyT > 0) return;
    this.historyT += this.rules.snapshotInterval ?? 0.1;
    this.history.push(this.snapshot());
    const keep = (this.rules.rewindSeconds ?? 6) + 0.3;
    while (this.history.length > 2 && this.ct - this.history[1].ct >= keep) this.history.shift();
  }

  // Secondes de passé disponibles (0..rewindSeconds).
  rewindAvailable() {
    if (!this.history.length) return 0;
    return Math.min(this.rules.rewindSeconds ?? 6, this.ct - this.history[0].ct);
  }

  // Jauge de rembobinage : 0..1.
  rewindRatio() {
    return Math.min(1, this.rewindCharge / (this.rules.rewindCost ?? 100));
  }

  canRewind() {
    return (
      this.rewindEnabled &&
      this.state === 'wave' &&
      !this.rewindAnim &&
      this.rewindCharge >= (this.rules.rewindCost ?? 100) - 1e-6 &&
      this.rewindAvailable() >= 2
    );
  }

  snapshot() {
    return {
      ct: this.ct,
      gold: this.players.map((p) => p.gold),
      lives: this.lives,
      timelessLoss: this.timelessLoss,
      timelessLeaks: this.timelessLeaks,
      timelessKills: this.timelessKills,
      timelessGold: this.timelessGold.slice(),
      timelessEarned: this.timelessEarned,
      stonesPlaced: this.stonesPlaced,
      stats: { ...this.stats, elementsUsed: { ...this.stats.elementsUsed } },
      stones: Uint8Array.from(this.grid.stone),
      stoneOwner: Int8Array.from(this.stoneOwner),
      enemies: this.enemies.map(cloneEnemy),
      towers: this.towers.map((t) => ({ ...t })),
      barriers: this.barriers.map((b) => ({ ...b })),
      spawners: this.spawners.map((sp) => ({ ...sp })),
      waveIndex: this.waveIndex,
      nextWaveT: this.nextWaveT,
      waveCleared: this.waveCleared.slice(),
      tornadoes: this.tornadoes.map((t) => ({ ...t })),
      zoneTimers: this.zones.map((z) => [z.key, z.timer]),
    };
  }

  // Instantané où ramènerait un rembobinage lancé maintenant (6 s plus tôt, ou le plus ancien).
  rewindSnapIndex() {
    const target = this.ct - (this.rules.rewindSeconds ?? 6);
    const idx = this.history.findIndex((h) => h.ct >= target - 1e-6);
    return idx < 0 ? 0 : idx;
  }

  // Vies du sanctuaire après un rembobinage lancé maintenant : celles de l'instantané,
  // moins ce que les yokai hors du temps ont pris depuis (ces vies ne reviennent pas).
  rewindLives() {
    const snap = this.history[this.rewindSnapIndex()];
    if (!snap) return this.lives;
    return Math.max(0, snap.lives - (this.timelessLoss - snap.timelessLoss));
  }

  rewind(pid = this.localPlayer) {
    if (!this.canRewind()) return false;
    const idx = this.rewindSnapIndex();
    const snap = this.history[idx];
    const frames = [{ enemies: this.enemies.map(cloneEnemy) }, ...this.history.slice(idx).reverse()];
    const snapIds = new Set(snap.towers.map((t) => t.id));
    this.rewindAnim = {
      t: 0,
      dur: this.rules.rewindAnimDuration ?? 1.1,
      frames,
      snap,
      idx,
      seconds: this.ct - snap.ct,
      ghosts: this.towers.filter((t) => !snapIds.has(t.id)).map((t) => t.id),
      timeless: this.enemies.filter((e) => e.timeless).map((e) => e.id),
    };
    this.rewindCharge -= this.rules.rewindCost ?? 100;
    this.rewindsUsed++;
    this.lastChanceT = 0;
    for (const e of this.enemies) e.pend = 0;
    this.projectiles = [];
    this.emit('rewindStart', { seconds: this.rewindAnim.seconds, pid });
    return true;
  }

  finishRewind() {
    const { snap, idx } = this.rewindAnim;
    const snapIds = new Set(snap.towers.map((t) => t.id));
    const echoT = this.rules.echoSeconds ?? 10;
    for (const t of this.towers) {
      if (snapIds.has(t.id)) continue;
      const echo = { ...t, id: this.nextId++, echo: true, ttl: echoT, maxTtl: echoT, cooldown: 0.2, stunT: 0 };
      this.echoes.push(echo);
      this.emit('echo', { tower: echo });
    }
    this.towers = snap.towers.map((t) => ({ ...t }));
    // Les yokai hors du temps restent où ils sont ; les autres reviennent 6 s en arrière.
    const timeless = this.enemies.filter((e) => e.alive && e.timeless);
    this.enemies = snap.enemies.filter((e) => !e.timeless).map(cloneEnemy).concat(timeless);
    for (const e of this.enemies) {
      e.px = e.x;
      e.py = e.y;
      e.pend = 0;
      if (e.blocked != null && !snap.barriers.some((b) => b.id === e.blocked && b.alive)) e.blocked = null;
    }
    // Apparitions : celles des yokai hors du temps ne sont pas rejouées.
    const live = new Map(this.spawners.map((sp) => [`${sp.wave}:${sp.group}`, sp]));
    this.spawners = snap.spawners.map((sp) => {
      const copy = { ...sp };
      if (copy.timeless) copy.spawned = Math.max(copy.spawned, live.get(`${sp.wave}:${sp.group}`)?.spawned ?? 0);
      return copy;
    });
    this.barriers = snap.barriers.map((b) => ({ ...b }));
    // L'or revient à l'instantané, sauf les primes des yokai hors du temps abattus
    // depuis : eux ne reviennent pas, leur prime reste donc acquise.
    snap.gold.forEach((g, i) => {
      if (this.players[i]) this.players[i].gold = g + (this.timelessGold[i] - (snap.timelessGold[i] ?? 0));
    });
    // Les vies perdues face aux yokai hors du temps ne reviennent pas.
    this.lives = Math.max(0, snap.lives - (this.timelessLoss - snap.timelessLoss));
    // Les lanternes construites et les pierres posées restent comptées ; les fuites et
    // éliminations des yokai hors du temps aussi (défi « Aucune fuite », bilan).
    this.stats = {
      ...snap.stats,
      kills: snap.stats.kills + (this.timelessKills - snap.timelessKills),
      leaks: snap.stats.leaks + (this.timelessLeaks - snap.timelessLeaks),
      goldEarned: snap.stats.goldEarned + (this.timelessEarned - snap.timelessEarned),
      towersBuilt: this.stats.towersBuilt,
      stones: Math.max(this.stats.stones, snap.stats.stones),
    };
    this.restoreStones(snap, timeless);
    this.flow.compute();
    this.ct = snap.ct;
    this.waveIndex = snap.waveIndex;
    this.nextWaveT = snap.nextWaveT;
    this.waveCleared = snap.waveCleared.slice();
    this.projectiles = [];
    this.tornadoes = (snap.tornadoes || []).map((t) => ({ ...t }));
    this.history = this.history.slice(0, idx + 1);
    this.rewindAnim = null;
    this.onTowersChanged();
    const timers = new Map(snap.zoneTimers || []);
    for (const z of this.zones) if (timers.has(z.key)) z.timer = timers.get(z.key);
    this.emit('rewindEnd', { echoes: this.echoes.length });
    if (this.lives <= 0) this.lose();
  }

  // Pierres de l'instantané. Les yokai hors du temps restent dans le présent : une
  // pierre retirée depuis ne revient pas sous leurs pieds ni là où elle les enfermerait
  // (figés sur place, la vague ne finirait jamais et plus aucune pierre ne se poserait).
  // Elle reste alors retirée, et son remboursement acquis.
  restoreStones(snap, timeless) {
    const g = this.grid;
    const ground = timeless.filter((e) => !e.flying);
    const back = []; // pierres retirées depuis l'instantané, à remettre
    for (let i = 0; i < g.size; i++) {
      if (snap.stones[i] && !g.stone[i]) back.push(i);
      else g.stone[i] = snap.stones[i];
    }
    this.stoneOwner.set(snap.stoneOwner);
    let placed = snap.stonesPlaced;
    const refund = Math.floor(this.stoneCost() * (this.rules.stoneRefund ?? 0.5));
    const reach = (dist, i) => i < 0 || dist[i] >= 0;
    for (const i of back) {
      let ok = !ground.some((e) => e.cur === i || e.target === i || g.tileAt(e.mx, e.my) === i);
      if (ok && ground.length) {
        const dist = bfs(g, i);
        ok = ground.every((e) => reach(dist, e.cur) && reach(dist, e.target));
      }
      if (ok) {
        g.stone[i] = 1;
        continue;
      }
      placed--;
      const owner = this.stoneOwner[i];
      this.player(owner >= 0 ? owner : 0).gold += refund;
      this.stoneOwner[i] = -1;
    }
    this.stonesPlaced = placed;
  }

  // ───────────────────────── statuts ─────────────────────────

  // Un yokai est insensible aux effets de l'élément qu'il absorbe (sauf aveuglé).
  // `element` = élément de la SOURCE de l'effet ; null pour un combo (deux éléments).
  immuneTo(e, element) {
    return !!element && e.absorb === element && e.blindT <= 0;
  }

  applySlow(e, factor, duration, element = 'water') {
    if (this.immuneTo(e, element) || (element && this.resistOf(e, element) >= 1)) return;
    // Plancher : un yokai ralenti avance toujours (voir minSlowFactor dans data/rules.js).
    addEffect(e.slows, Math.max(this.rules.minSlowFactor ?? 0.35, factor), duration);
    refreshStatus(e);
  }

  applyShred(e, mult, duration) {
    addEffect(e.shreds, mult, duration);
    refreshStatus(e);
  }

  applyArmorBreak(e, duration) {
    e.breakT = Math.max(e.breakT, duration);
  }

  // Étourdissement avec rendements décroissants : chaque étourdissement subi
  // raccourcit les suivants tant que la « fatigue » n'est pas retombée. Un
  // étourdissement plus court que celui en cours ne coûte rien (pas de fatigue).
  applyStun(e, duration, element = null) {
    if (this.immuneTo(e, element)) return;
    const resist = this.defs.enemies[e.type].stunResist ?? 0;
    const d = (duration * (1 - resist)) / (1 + e.stunFatigue);
    if (d <= e.stunT) return;
    e.stunFatigue += (d - Math.max(0, e.stunT)) * (this.rules.stunFatigueGain ?? 1.5);
    e.stunT = d;
  }

  // Recul avec rendements décroissants : un yokai ne peut pas être repoussé
  // indéfiniment. Les yokai hors du temps ne reculent jamais.
  applyKnockback(e, amount, element = 'wind') {
    if (amount <= 0 || e.timeless || this.immuneTo(e, element)) return;
    const resist = this.defs.enemies[e.type].knockResist ?? 0;
    const k = (amount * (1 - resist)) / (1 + e.knockFatigue);
    e.knockFatigue += k * (this.rules.knockFatigueGain ?? 2.5);
    e.knock = Math.max(e.knock, k);
  }

  applyBurn(e, dps, duration, element = 'fire') {
    if (this.immuneTo(e, element) || e.absorb === 'fire') return;
    addEffect(e.burns, dps, duration);
    refreshStatus(e);
  }

  // ───────────────────────── lanternes ─────────────────────────

  updateTowers(dt) {
    for (const t of this.towers) this.updateTower(t, dt, 1);
    if (this.echoes.length) {
      const power = this.rules.echoPower ?? 0.5;
      for (const t of this.echoes) {
        t.ttl -= dt;
        if (t.ttl > 0) this.updateTower(t, dt, power);
      }
      if (this.echoes.some((t) => t.ttl <= 0)) {
        for (const t of this.echoes) if (t.ttl <= 0) this.emit('echoFade', { tower: t });
        this.echoes = this.echoes.filter((t) => t.ttl > 0);
        this.onTowersChanged();
      }
    }
  }

  canTarget(def, e) {
    if (!e.alive || e.spawnT > 0) return false;
    const tg = def.targets ?? { ground: true, air: true };
    return e.flying ? tg.air : tg.ground;
  }

  // Choix de la cible selon la priorité de la tour :
  //   first  le plus avancé vers le sanctuaire   last   le moins avancé
  //   strong le plus de PV restants              close  le plus proche de la tour
  // `skipDoomed` : ignore un yokai que les projectiles déjà en vol suffiront à abattre.
  findTarget(t, def, range, skipDoomed = false) {
    const mode = t.priority || 'first';
    let best = null;
    let bestScore = Infinity;
    for (const e of this.enemies) {
      if (!this.canTarget(def, e)) continue;
      if (skipDoomed && e.pend >= e.hp) continue;
      const d = hyp(e.x - t.x, e.y - t.y);
      if (d > range + e.size * 0.5) continue;
      let score;
      if (mode === 'last') score = -this.remaining(e);
      else if (mode === 'strong') score = -(e.hp - e.pend) * 1000 + this.remaining(e);
      else if (mode === 'close') score = d;
      else score = this.remaining(e);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  attackOf(def) {
    return def.attack ?? (def.projectile === 'boulder' ? 'lob' : 'projectile');
  }

  updateTower(t, dt, power) {
    if (t.shotT > 0) t.shotT -= dt;
    if (t.stunT > 0) {
      t.stunT -= dt;
      return;
    }
    const def = this.defs.towers[t.type];
    const st = this.towerStats(t);
    const attack = this.attackOf(def);
    if (attack === 'support') return this.updateSupport(t, st, dt, power);
    if (attack === 'barrier') return; // gérée par updateBarriers
    if (attack === 'aura') return this.updateAura(t, def, st, dt, power);
    t.cooldown -= dt * (t.rateMult || 1);
    if (t.cooldown > 0) return;
    if (attack === 'pulse') return this.updatePulse(t, def, st, power);
    const target = this.findTarget(t, def, st.range, attack === 'projectile' && !st.splash);
    if (!target) {
      t.cooldown = 0;
      return;
    }
    t.cooldown += 1 / st.rate;
    if (t.cooldown < 0) t.cooldown = 1 / st.rate;
    t.angle = Math.atan2(target.y - t.y, target.x - t.x);
    t.shotT = 0.18;
    if (attack === 'beam') this.fireBeam(t, def, st, target, power);
    else this.fire(t, def, st, target, power, attack === 'lob');
  }

  // Aura (Feux follets) : brûle en continu tous les yokai dans la portée.
  updateAura(t, def, st, dt, power) {
    let any = false;
    for (const e of this.enemies) {
      if (!this.canTarget(def, e)) continue;
      if (hyp(e.x - t.x, e.y - t.y) > st.range + e.size * 0.5) continue;
      this.damage(e, (st.auraDps ?? 0) * power * dt, t.element, { dot: true, owner: t.owner });
      any = true;
    }
    if (any && t.shotT <= 0) {
      t.shotT = 0.25;
      this.emit('aura', { tower: t, element: t.element, echo: power < 1 });
    }
  }

  // Impulsion (Séisme) : tous les yokai au sol dans la portée.
  updatePulse(t, def, st, power) {
    const hit = this.enemies.filter((e) => this.canTarget(def, e) && hyp(e.x - t.x, e.y - t.y) <= st.range + e.size * 0.5);
    if (!hit.length) {
      t.cooldown = 0;
      return;
    }
    t.cooldown += 1 / st.rate;
    if (t.cooldown < 0) t.cooldown = 1 / st.rate;
    t.shotT = 0.3;
    for (const e of hit) {
      if (st.armorBreak) this.applyArmorBreak(e, st.armorBreak);
      if (st.stun) this.applyStun(e, st.stun * power, t.element);
      this.damage(e, (st.damage ?? 0) * power, t.element, { pierce: st.pierce ?? 0, owner: t.owner });
    }
    this.emit('quake', { tower: t, radius: st.range, element: t.element, echo: power < 1 });
  }

  // Jet perçant (Torrent) : tous les yokai le long d'un segment.
  fireBeam(t, def, st, target, power) {
    const dx = target.x - t.x;
    const dy = target.y - t.y;
    const d = hyp(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const x1 = t.x + ux * st.range;
    const y1 = t.y + uy * st.range;
    for (const e of this.enemies) {
      if (!this.canTarget(def, e)) continue;
      const px = e.x - t.x;
      const py = e.y - t.y;
      const along = px * ux + py * uy;
      if (along < 0 || along > st.range) continue;
      const side = Math.abs(px * uy - py * ux);
      if (side > (st.width ?? 0.45) + e.size * 0.5) continue;
      this.hitEffects(e, st, power, t.element);
      this.damage(e, (st.damage ?? 0) * power * (e.flying ? st.airMultiplier ?? 1 : 1), t.element, { pierce: st.pierce ?? 0, owner: t.owner });
    }
    const beam = { x0: t.x, y0: t.y - 0.25, x1, y1, element: t.element, life: 0.25, echo: power < 1 };
    this.beams.push(beam);
    this.emit('beam', { tower: t, beam, element: t.element, echo: power < 1 });
  }

  // Soutien : la Source sacrée soigne les barrières dans sa portée.
  updateSupport(t, st, dt, power) {
    if (!st.heal) return;
    let healed = false;
    for (const b of this.barriers) {
      if (!b.alive || b.hp >= b.maxHp) continue;
      const g = this.grid;
      if (hyp(g.cx(b.tile) - t.x, g.cy(b.tile) - t.y) > st.range + 0.01) continue;
      b.hp = Math.min(b.maxHp, b.hp + st.heal * power * dt);
      healed = true;
    }
    if (healed && t.shotT <= 0) {
      t.shotT = 0.6;
      this.emit('barrierHeal', { tower: t });
    }
  }

  fire(t, def, st, target, power, lob = false) {
    let tx = target.x;
    let ty = target.y;
    const speed = st.projectileSpeed ?? (lob ? 5 : 9);
    let dur = 0;
    if (lob) {
      // Tir en cloche : on vise là où le yokai sera à l'impact (anticipation).
      dur = Math.max(0.35, hyp(target.x - t.x, target.y - t.y) / speed);
      if (!target.blocked && target.stunT <= 0) {
        tx += (target.vx || 0) * dur;
        ty += (target.vy || 0) * dur;
      }
    }
    const p = {
      id: this.nextId++,
      kind: def.projectile,
      ttype: t.type,
      element: t.element,
      owner: t.owner,
      level: t.level,
      x: t.x,
      y: t.y - 0.25,
      sx: t.x,
      sy: t.y - 0.25,
      tx,
      ty,
      targetId: target.id,
      target,
      speed,
      homing: !lob,
      lob,
      t: 0,
      dur,
      power,
      st,
      echo: power < 1,
      alive: true,
      pend: 0,
    };
    if (!lob && !st.splash) {
      // estimation des dégâts du coup (armure comprise) réservés sur la cible
      p.pend = this.estimateHit(target, st, power, t.element);
      target.pend += p.pend;
    }
    this.projectiles.push(p);
    this.emit('shoot', { tower: t, projectile: p, element: t.element, echo: p.echo });
  }

  estimateHit(e, st, power, element) {
    if (e.absorb === element && e.blindT <= 0) return 0;
    let dmg = (st.damage ?? 0) * power * (e.flying ? st.airMultiplier ?? 1 : 1) * (1 - this.resistOf(e, element));
    if (e.armor > 0 && e.breakT <= 0) dmg = Math.max(dmg * (this.rules.armorMinDamage ?? 0.2), dmg - e.armor * (1 - (st.pierce ?? 0)));
    if (e.shredT > 0) dmg *= e.shredM;
    return Math.max(0, dmg);
  }

  updateProjectiles(dt) {
    for (const b of this.beams) b.life -= dt;
    if (this.beams.some((b) => b.life <= 0)) this.beams = this.beams.filter((b) => b.life > 0);
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      if (p.lob) {
        p.t += dt;
        const k = Math.min(1, p.t / p.dur);
        p.x = p.sx + (p.tx - p.sx) * k;
        p.y = p.sy + (p.ty - p.sy) * k;
        p.h = dsin(k * Math.PI) * 1.1;
        if (k >= 1) this.impact(p, null);
        continue;
      }
      if (p.target && p.target.alive) {
        p.tx = p.target.x;
        p.ty = p.target.y;
      } else {
        if (p.target) p.target.pend = Math.max(0, p.target.pend - p.pend);
        p.pend = 0;
        p.target = null;
      }
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = hyp(dx, dy);
      const step = p.speed * dt;
      if (d <= step + 0.12) {
        p.x = p.tx;
        p.y = p.ty;
        this.impact(p, p.target);
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
      p.angle = Math.atan2(dy, dx);
    }
  }

  impact(p, target) {
    p.alive = false;
    if (p.pend && p.target) p.target.pend = Math.max(0, p.target.pend - p.pend);
    const st = p.st;
    const pw = p.power;
    const el = p.element;
    const opts = { pierce: st.pierce ?? 0, owner: p.owner };
    if (st.splash) {
      for (const e of this.enemies) {
        if (!e.alive || e.spawnT > 0) continue;
        if (p.lob && e.flying) continue;
        const d = hyp(e.x - p.x, e.y - p.y);
        if (d > st.splash + e.size * 0.5) continue;
        const main = e === target;
        const dmg = (st.damage ?? 0) * pw * (main || p.lob ? 1 : 0.5);
        this.hitEffects(e, st, pw, el);
        this.damage(e, dmg * (e.flying ? st.airMultiplier ?? 1 : 1), el, opts);
      }
    } else if (target && target.alive) {
      this.hitEffects(target, st, pw, el);
      this.damage(target, (st.damage ?? 0) * pw * (target.flying ? st.airMultiplier ?? 1 : 1), el, opts);
    }
    this.emit('hit', { x: p.x, y: p.y, element: el, level: p.level, splash: st.splash ?? 0, echo: p.echo, kind: p.kind });
  }

  // Effets à l'impact : l'immunité dépend de l'élément de la tour qui tire.
  hitEffects(e, st, pw, el) {
    if (!e.alive) return;
    if (st.burn) this.applyBurn(e, st.burn.dps * pw, st.burn.duration, el);
    if (st.slow) this.applySlow(e, 1 - (1 - st.slow.factor) * pw, st.slow.duration, el);
    if (st.stun) this.applyStun(e, st.stun * pw, el);
    if (st.knockback) this.applyKnockback(e, st.knockback * pw, el);
    if (st.armorBreak) this.applyArmorBreak(e, st.armorBreak);
  }

  cleanup() {
    if (this.enemies.some((e) => !e.alive)) this.enemies = this.enemies.filter((e) => e.alive);
    if (this.projectiles.some((p) => !p.alive)) this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  // ───────────────────────── défis ─────────────────────────

  // Le défi optionnel du niveau est-il réussi ? (à appeler en fin de partie)
  challengeMet() {
    if (!this.level.challenge || !this.challenge || this.state !== 'won') return false;
    return !this.challengeBroken();
  }

  // Le défi actif est-il déjà manqué ? (consultable en cours de partie)
  challengeBroken() {
    const r = this.challengeRule;
    if (!r) return false;
    if (r.noLeak && this.stats.leaks > 0) return true;
    if (r.noStones && this.stats.stones > 0) return true;
    if (r.noRewind && this.rewindsUsed > 0) return true;
    if (r.maxTowers != null && this.stats.towersBuilt > r.maxTowers) return true;
    if (r.forbidTowers && this.towers.some((t) => r.forbidTowers.includes(t.type))) return true;
    if (r.minLives != null && this.lives < r.minLives) return true;
    return false;
  }
  // ───────────────────────── état complet (coopération) ─────────────────────────

  // Instantané complet de la partie, en données JSON : sert à resynchroniser un
  // joueur (arrivée en cours de partie, écart détecté par l'empreinte). L'historique
  // du Rembobinage n'est pas transmis (trop lourd) : il se reconstitue en 6 s.
  exportState() {
    if (this.rewindAnim) return null;
    const s = { v: 1 };
    for (const k of Object.keys(this)) {
      if (EXPORT_SKIP.has(k)) continue;
      const v = this[k];
      if (v === undefined || typeof v === 'function') continue;
      s[k] = JSON.parse(JSON.stringify(v));
    }
    s.players = this.players.map((p) => ({ ...p, elements: p.elements.slice() }));
    s.rng = this.rng.s;
    s.stones = Array.from(this.grid.stone);
    s.stoneOwner = Array.from(this.stoneOwner);
    s.chargedKills = [...this.chargedKills];
    s.chargedWaves = [...this.chargedWaves];
    s.projectiles = this.projectiles.map((p) => {
      const { target, st, ...rest } = p;
      return { ...JSON.parse(JSON.stringify(rest)), hasTarget: !!target };
    });
    s.zoneTimers = this.zones.map((z) => [z.key, z.timer, z.born, z.pulseT ?? 0]);
    return s;
  }

  importState(s) {
    if (!s || s.v !== 1) return false;
    for (const [k, v] of Object.entries(s)) {
      if (IMPORT_SPECIAL.has(k) || EXPORT_SKIP.has(k)) continue;
      this[k] = v;
    }
    s.players.forEach((p, i) => {
      if (this.players[i]) Object.assign(this.players[i], p, { elements: p.elements.slice() });
    });
    this.rng.s = s.rng >>> 0;
    this.grid.stone.set(s.stones);
    this.stoneOwner.set(s.stoneOwner);
    this.flow.compute();
    this.chargedKills = new Set(s.chargedKills);
    this.chargedWaves = new Set(s.chargedWaves);
    const byId = new Map(this.enemies.map((e) => [e.id, e]));
    this.projectiles = s.projectiles.map(({ hasTarget, ...p }) => {
      const def = this.defs.towers[p.ttype];
      const st = def ? def.levels[Math.min(p.level, def.levels.length) - 1] : {};
      return { ...p, st, target: hasTarget ? byId.get(p.targetId) ?? null : null };
    });
    this.history = [];
    this.rewindAnim = null;
    this.zones = [];
    computeZones(this);
    this.recomputeSupport();
    const timers = new Map(s.zoneTimers.map(([key, timer, born, pulseT]) => [key, { timer, born, pulseT }]));
    for (const z of this.zones) if (timers.has(z.key)) Object.assign(z, timers.get(z.key));
    this.events.length = 0;
    return true;
  }

  // Empreinte de l'état (entier 32 bits) : deux joueurs synchronisés ont la même.
  stateHash() {
    const v = [this.frame, this.lives, this.waveIndex, STATES.indexOf(this.state), this.rng.s | 0, Math.round(this.rewindCharge * 100), this.queue.length];
    for (const p of this.players) v.push(Math.round(p.gold * 100));
    for (const e of this.enemies) v.push(e.id, Math.round(e.x * 4096), Math.round(e.y * 4096), Math.round(e.hp * 64));
    for (const t of this.towers) v.push(t.id, t.level, t.c * 64 + t.r);
    for (const b of this.barriers) v.push(b.id, Math.round(b.hp * 16), b.alive ? 1 : 0, b.tile);
    for (const p of this.projectiles) v.push(p.id, Math.round(p.x * 4096), Math.round(p.y * 4096));
    return fnv(v);
  }

}

function cloneEnemy(e) {
  return {
    ...e,
    trail: e.trail.slice(),
    timers: { ...e.timers },
    slows: e.slows.map((x) => ({ ...x })),
    burns: e.burns.map((x) => ({ ...x })),
    shreds: e.shreds.map((x) => ({ ...x })),
  };
}

// ───────── effets à durée (une entrée par intensité, chacune expire pour son compte) ─────────

function addEffect(list, v, t) {
  for (const x of list) {
    if (Math.abs(x.v - v) < 1e-6) {
      x.t = Math.max(x.t, t);
      return;
    }
  }
  list.push({ v, t });
  if (list.length > 6) {
    list.sort((a, b) => b.t - a.t);
    list.length = 6;
  }
}

function tickEffects(list, dt) {
  let j = 0;
  for (const x of list) {
    x.t -= dt;
    if (x.t > 0) list[j++] = x;
  }
  list.length = j;
}

// Valeurs résumées lues par le moteur et le rendu : ralentissement le plus fort,
// brûlure la plus forte, affaiblissement le plus fort parmi les effets actifs.
function refreshStatus(e) {
  let f = 1;
  let ft = 0;
  for (const x of e.slows) {
    if (x.v < f) f = x.v;
    if (x.t > ft) ft = x.t;
  }
  e.slowF = f;
  e.slowT = ft;
  let b = 0;
  let bt = 0;
  for (const x of e.burns) {
    if (x.v > b) b = x.v;
    if (x.t > bt) bt = x.t;
  }
  e.burnDps = b;
  e.burnT = bt;
  let m = 1;
  let mt = 0;
  for (const x of e.shreds) {
    if (x.v > m) m = x.v;
    if (x.t > mt) mt = x.t;
  }
  e.shredM = m;
  e.shredT = mt;
}
