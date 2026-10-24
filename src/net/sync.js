// Synchronisation d'une partie coopérative.
//
// L'hôte fait tourner la vraie simulation (src/core/game.js) et diffuse un état
// compact environ 8 fois par seconde, avec les événements survenus entre-temps
// (tirs, éliminations…). Les invités tiennent un « miroir » : une instance de Game
// qui ne simule rien, dont l'état est remplacé à chaque réception ; le rendu et
// l'interface le lisent comme une partie normale. Les commandes des invités
// (poser, fusionner, vendre…) sont envoyées à l'hôte, qui les valide et les applique.
// Les états portent l'heure d'envoi de l'hôte : l'invité les rejoue à cette cadence,
// avec un léger retard (tampon de gigue), pour que les yokai glissent sans à-coups.
//
// On ne fait pas tourner la simulation chez chacun (pas de « lockstep ») : les
// fonctions mathématiques diffèrent légèrement d'un navigateur à l'autre et les
// parties finiraient par diverger.

import { computeZones } from '../core/combos.js';
import { STEP, PRIORITIES } from '../core/game.js';

export const SNAPSHOT_HZ = 8;
const KEYFRAME_EVERY = 16; // état complet (lanternes, pierres) au moins toutes les 2 s

// Commandes qu'un invité peut demander à l'hôte (méthodes de Game, `pid` ajouté en
// dernier) et forme de leurs arguments, vérifiée par l'hôte (le message vient du
// réseau) : 'int' entier (case, identifiant de lanterne), 'type' lanterne connue,
// 'priority' priorité de ciblage, 'wave' numéro de vague (entier) ou rien.
export const COMMANDS = {
  placeTower: ['type', 'int', 'int'],
  sellTower: ['int'],
  undoPlace: ['int'],
  fuse: ['int', 'int'],
  setPriority: ['int', 'priority'],
  cyclePriority: ['int'],
  placeStone: ['int', 'int'],
  removeStone: ['int', 'int'],
  startNextWave: ['wave'], // [vague demandée] : une demande déjà servie (deux joueurs, double toucher) est ignorée
  rewind: [],
  setRally: ['int', 'int', 'int'],
};

// Événements relayés aux invités (effets visuels et sonores).
const RELAYED = new Set([
  'place', 'sell', 'undo', 'fuse', 'priority', 'reject', 'stone', 'unstone', 'combo', 'shoot', 'hit', 'beam', 'aura', 'quake',
  'kill', 'leak', 'spawn', 'spawnChild', 'split', 'heal', 'summon', 'absorb', 'absorbShift', 'stomp', 'enrage', 'hop',
  'barrierUp', 'barrierBreak', 'barrierHeal', 'rally', 'pulse', 'tornado', 'waveStart', 'waveEnd', 'earlyBonus',
  'echo', 'echoFade', 'rewindStart', 'rewindEnd', 'lastChance', 'win', 'lose',
]);

const r2 = (v) => Math.round(v * 100) / 100;

const ELS = ['fire', 'water', 'wind', 'earth']; // absorption d'un yokai : indice (−1 : aucune)

// Bits d'état d'un yokai.
const B = { flying: 1, boss: 2, enraged: 4, timeless: 8, blocked: 16, slow: 32, burn: 64, stun: 128, blind: 256, brk: 512, hit: 1024, hop: 2048, left: 4096, shred: 8192 };

// ───────────────────────── encodage (hôte) ─────────────────────────

// Objets du moteur cités par les événements : seule une référence compacte voyage
// (l'invité retrouve l'objet vivant de son miroir par son id ; la copie ne sert que
// s'il a disparu entre-temps : yokai abattu, lanterne vendue). Un yokai complet
// pèse ~600 octets, une lanterne ~250 : les tirs et apparitions en citent sans cesse.
const REF_FIELDS = {
  enemy: ['id', 'type', 'x', 'y', 'flying', 'boss', 'size', 'absorb', 'wave', 'timeless', 'dirX'],
  tower: ['id', 'type', 'level', 'owner', 'c', 'r', 'x', 'y'],
  projectile: ['kind', 'element', 'level', 'sx', 'sy', 'tx', 'ty', 'targetId', 'speed', 'lob', 'dur', 'echo'], // part de (sx, sy)
  zone: ['key', 'x', 'y', 'radius', 'a', 'b'],
};
const REF_OF = { enemy: 'enemy', parent: 'enemy', tower: 'tower', a: 'tower', b: 'tower', projectile: 'projectile', zone: 'zone' };

const isCombo = (o) => !!(o && o.effect && o.elements && o.id);

// Copie plate d'un objet d'événement : seuls les champs simples voyagent
// (`fields` : liste des champs gardés).
function packObj(o, fields = null) {
  if (!o || typeof o !== 'object') return o;
  if (isCombo(o)) return { __combo: o.id }; // définition de combo
  const out = {};
  for (const k of fields || Object.keys(o)) {
    const v = o[k];
    if (typeof v === 'number') out[k] = Number.isInteger(v) ? v : r2(v);
    else if (typeof v === 'string' || typeof v === 'boolean' || v === null) out[k] = v;
    else if (Array.isArray(v) && v.length <= 12 && v.every((x) => typeof x === 'number')) out[k] = v;
    else if (isCombo(v)) out[k] = { __combo: v.id }; // zone de combo : sa définition
  }
  return out;
}

export function packEvent(ev) {
  const out = {};
  for (const k in ev) {
    const v = ev[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const kind = REF_OF[k];
      out[k] = packObj(v, kind ? REF_FIELDS[kind] : null);
      if (kind === 'zone' && v.def) out[k].def = { __combo: v.def.id };
    } else if (Array.isArray(v)) out[k] = v.every((x) => typeof x !== 'object') ? v : v.map((x) => packObj(x));
    else out[k] = typeof v === 'number' && !Number.isInteger(v) ? r2(v) : v;
  }
  return out;
}

function towerSig(list) {
  return list.map((t) => `${t.id}:${t.level}:${t.priority}:${t.rally ?? ''}:${t.owner ?? 0}`).join(',');
}

// Horloge en millisecondes (navigateur et Node).
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Forme d'un état de l'hôte. Il arrive par un relais public : un message absurde ou
// forgé (n'importe quel client peut publier sur le sujet du salon) ne doit ni figer le
// miroir (numéro de séquence énorme) ni planter la boucle de l'invité (champ manquant).
const STATES = ['build', 'wave', 'won', 'lost'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isRows = (v) => Array.isArray(v) && v.every((row) => Array.isArray(row));
const isInts = (v) => Array.isArray(v) && v.every((x) => Number.isSafeInteger(x));
export function validSnap(s, gid = null) {
  if (!s || typeof s !== 'object' || !Number.isSafeInteger(s.seq) || s.seq < 1) return false;
  if (gid != null && s.gid !== gid) return false; // état d'une autre partie, ou sans partie
  if (s.rt != null && !isNum(s.rt)) return false;
  if (!['t', 'ct', 'lv', 'ml', 'wi', 'rc', 'ra', 'lc', 'ru', 'sp'].every((k) => isNum(s[k]))) return false;
  if (s.nw != null && !isNum(s.nw)) return false;
  if (!STATES.includes(s.st) || !Array.isArray(s.gold) || !s.gold.every(isNum)) return false;
  if (!isRows(s.en) || (s.em != null && !isRows(s.em)) || !isRows(s.ba) || !isRows(s.to)) return false;
  if (!Array.isArray(s.ev) || !s.ev.every((ev) => ev && typeof ev === 'object' && typeof ev.type === 'string')) return false;
  for (const k of ['tw', 'ec', 'su', 'zt']) if (s[k] != null && !isRows(s[k])) return false;
  for (const k of ['sn', 'so', 'cw', 'fl']) if (s[k] != null && !isInts(s[k])) return false;
  if (s.rw != null && (typeof s.rw !== 'object' || !isNum(s.rw.t) || !isNum(s.rw.d) || (s.rw.gh != null && !isInts(s.rw.gh)))) return false;
  return true;
}

// Une pose (ou une commande qui l'attend) reste provisoire chez l'invité au plus
// PENDING_MS de temps réel (pas de temps de jeu : à ×2, 2 s de jeu ne laissaient
// qu'une seconde à la réponse de l'hôte, retard de lecture compris).
const PENDING_MS = 3500;
const fresh = (t) => clock() - (t.sentAt ?? -Infinity) < PENDING_MS;

// Événements purement décoratifs : un invité qui rattrape un retard (onglet en
// arrière-plan) les saute plutôt que de tout rejouer d'un coup.
const COSMETIC = new Set(['shoot', 'hit', 'beam', 'aura', 'quake', 'absorb', 'heal', 'spawn', 'spawnChild', 'split', 'pulse', 'tornado', 'barrierHeal', 'hop', 'absorbShift', 'kill', 'summon', 'stomp']);

export class HostSync {
  constructor(game, publish) {
    this.game = game;
    this.publish = publish; // (objet) → envoi à tous les invités
    this.events = [];
    this.acc = 0;
    this.seq = 0;
    this.sig = { towers: '', echoes: '', stones: '', charged: '' };
    this.stunned = false; // lanternes étourdies à l'état précédent (liste `su`)
    this.known = new Set(); // yokai déjà envoyés en entier (lignes courtes ensuite)
    this.typeIndex = new Map(Object.keys(game.defs.enemies).map((k, i) => [k, i]));
    this.towerIndex = new Map(Object.keys(game.defs.towers).map((k, i) => [k, i]));
    this.paused = false;
    this.speed = 1; // vitesse de jeu de l'hôte (×1, ×2) : les effets des invités la suivent
    this.gid = null; // identifiant de la partie (graine du départ) : un état d'une partie précédente est ignoré
  }

  // À appeler avec la file d'événements de la frame, avant qu'elle soit vidée.
  collect(events) {
    for (const ev of events) if (RELAYED.has(ev.type)) this.events.push(packEvent(ev));
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  tick(dt, force = false) {
    this.acc += dt;
    if (!force && this.acc < 1 / SNAPSHOT_HZ) return;
    this.acc = 0;
    this.publish(this.snapshot());
  }

  snapshot() {
    const g = this.game;
    const key = this.seq++ % KEYFRAME_EVERY === 0 || this.forceKey;
    this.forceKey = false;
    const s = {
      type: 'snap',
      gid: this.gid,
      seq: this.seq,
      rt: Math.round(clock()), // heure d'envoi (ms, horloge de l'hôte) : cadence de lecture chez l'invité
      t: r2(g.time),
      ct: r2(g.ct),
      st: g.state,
      lv: g.lives,
      ml: g.maxLives,
      gold: g.players.map((p) => Math.floor(p.gold)),
      wi: g.waveIndex,
      nw: g.nextWaveT == null ? null : r2(g.nextWaveT),
      rc: r2(g.rewindCharge),
      ra: r2(g.rewindAvailable()),
      lc: r2(g.lastChanceT),
      ru: g.rewindsUsed,
      sp: g.stats.stones,
      pz: this.paused ? 1 : 0,
      gs: this.speed,
      ...this.packEnemies(g, key),
      ba: g.barriers.map((b) => [b.id, b.towerId, b.tile, Math.ceil(b.hp), Math.ceil(b.maxHp), b.alive ? 1 : 0, r2(b.respawnT), b.owner ?? 0, r2(b.thorns || 0), b.hitT > 0 ? 1 : 0]),
      to: g.tornadoes.map((t) => [t.id, r2(t.x), r2(t.y), r2(t.life), r2(t.max), r2(t.size)]),
      ev: this.events,
    };
    this.events = [];
    const ts = towerSig(g.towers);
    if (key || ts !== this.sig.towers) {
      this.sig.towers = ts;
      s.tw = g.towers.map((t) => this.packTower(t));
    }
    const es = towerSig(g.echoes);
    if (key || es !== this.sig.echoes) {
      this.sig.echoes = es;
      s.ec = g.echoes.map((t) => [...this.packTower(t), r2(t.ttl), r2(t.maxTtl)]);
    }
    const stones = [];
    for (let i = 0; i < g.grid.size; i++) if (g.grid.stone[i]) stones.push(i);
    // propriétaire de chaque pierre (seul celui qui l'a payée la retire, en coopération)
    const owners = stones.map((i) => g.stoneOwner?.[i] ?? -1);
    const ss = `${stones.join(',')}|${owners.join(',')}`;
    if (key || ss !== this.sig.stones) {
      this.sig.stones = ss;
      s.sn = stones;
      s.so = owners;
    }
    // lanternes étourdies (piétinement d'un boss) : liste courte, tant qu'il y en a
    const su = [];
    for (const t of g.towers) if (t.stunT > 0) su.push([t.id, r2(t.stunT)]);
    for (const t of g.echoes) if (t.stunT > 0) su.push([t.id, r2(t.stunT)]);
    if (su.length || this.stunned) s.su = su;
    this.stunned = su.length > 0;
    // vagues déjà appelées en avance (l'aperçu « +N 巻 » ne les compte plus)
    const cw = [...g.chargedWaves].join(',');
    if (key || cw !== this.sig.charged) {
      this.sig.charged = cw;
      s.cw = [...g.chargedWaves];
    }
    if (g.rewindAnim) s.rw = { t: r2(g.rewindAnim.t), d: g.rewindAnim.dur, gh: g.rewindAnim.ghosts };
    // minuteries des combos périodiques (Givre, Tornade) : arc de recharge des invités
    const zt = [];
    for (const z of g.zones) {
      const kind = z.def.effect?.kind;
      if (kind === 'pulse' || kind === 'tornado') zt.push([z.key, r2(z.timer)]);
    }
    if (zt.length) s.zt = zt;
    // portails d'où sortiront encore des volants pendant la vague (leurs trajectoires)
    const fl = g.flyerPortals();
    if (fl.length) s.fl = fl;
    return s;
  }

  // Yokai : ligne complète (`en`) pour ceux que les invités ne connaissent pas encore
  // (apparition, retour après un Rembobinage, état complet), ligne courte (`em` :
  // position, PV, états) ensuite — près de deux fois moins d'octets par yokai.
  packEnemies(g, key) {
    const en = [];
    const em = [];
    const seen = new Set();
    for (const e of g.enemies) {
      if (!e.alive) continue;
      seen.add(e.id);
      if (key || e.boss || !this.known.has(e.id)) en.push(this.packEnemy(e));
      else em.push(this.packEnemyShort(e));
    }
    this.known = seen;
    return em.length ? { en, em } : { en };
  }

  // [id, x, y, pv, bits, absorption, apparition, ralenti] ; valeurs par défaut finales omises.
  packEnemyShort(e) {
    const out = [e.id, r2(e.x), r2(e.y), Math.ceil(e.hp), this.bitsOf(e), ELS.indexOf(e.absorb), r2(e.spawnT), r2(e.slowF)];
    const def = [-1, 0, 1];
    while (out.length > 5 && out[out.length - 1] === def[out.length - 6]) out.pop();
    return out;
  }

  packEnemy(e) {
    const out = [e.id, this.typeIndex.get(e.type), r2(e.x), r2(e.y), Math.ceil(e.hp), Math.ceil(e.maxHp), this.bitsOf(e), ELS.indexOf(e.absorb), r2(e.spawnT), r2(e.slowF), e.wave];
    if (e.boss) out.push({ stomp: r2(e.timers.stomp ?? 0), summon: r2(e.timers.summon ?? 0), cycle: r2(e.timers.cycle ?? 0) });
    return out;
  }

  bitsOf(e) {
    let bits = 0;
    if (e.flying) bits |= B.flying;
    if (e.boss) bits |= B.boss;
    if (e.enraged) bits |= B.enraged;
    if (e.timeless) bits |= B.timeless;
    if (e.blocked != null) bits |= B.blocked;
    if (e.slowT > 0) bits |= B.slow;
    if (e.burnT > 0) bits |= B.burn;
    if (e.stunT > 0) bits |= B.stun;
    if (e.blindT > 0) bits |= B.blind;
    if (e.breakT > 0) bits |= B.brk;
    if (e.shredT > 0) bits |= B.shred;
    if (e.hitT > 0) bits |= B.hit;
    if (e.hopT > 0) bits |= B.hop;
    if (e.dirX < 0) bits |= B.left;
    return bits;
  }

  packTower(t) {
    return [t.id, this.towerIndex.get(t.type), t.c, t.r, t.level, t.owner ?? 0, t.priority, t.invested, r2(t.stunT), t.rally ?? -1];
  }
}

// Un argument de commande a-t-il la forme attendue ? Une chaîne à la place d'un
// entier (« '4' ») donnait un indice de case faux qui contournait les contrôles.
const ARG_OK = {
  int: (v) => Number.isSafeInteger(v),
  type: (v, game) => typeof v === 'string' && Object.hasOwn(game.defs.towers, v),
  priority: (v) => PRIORITIES.includes(v),
  wave: (v) => v == null || Number.isSafeInteger(v),
};

// Applique une commande reçue d'un invité. Renvoie le résultat de la méthode (null :
// commande inconnue ou mal formée, ignorée).
export function applyCommand(game, pid, op, args = []) {
  if (typeof op !== 'string' || !Object.hasOwn(COMMANDS, op) || !Array.isArray(args)) return null;
  const spec = COMMANDS[op];
  const a = spec.map((kind, k) => args[k]);
  if (!spec.every((kind, k) => ARG_OK[kind](a[k], game))) return null;
  if (op === 'startNextWave') {
    if (typeof a[0] === 'number' && a[0] !== game.waveIndex + 1) return false; // vague déjà appelée
    return game.startNextWave(pid, true);
  }
  if (op === 'undoPlace') return game.undoPlace(a[0], 3.6, pid); // marge pour la latence du relais
  return game[op](...a, pid);
}

// ───────────────────────── miroir (invité) ─────────────────────────

export class ClientSync {
  /**
   * @param {Game} mirror  partie construite avec le même niveau et les mêmes joueurs
   * @param {(op, args) => void} send  envoi d'une commande à l'hôte
   */
  constructor(mirror, send) {
    this.game = mirror;
    this.send = send;
    this.types = Object.keys(mirror.defs.enemies);
    this.towerTypes = Object.keys(mirror.defs.towers);
    this.byId = new Map();
    this.history = []; // positions récentes des yokai (animation du Rembobinage)
    this.alpha = 1;
    this.lastSeq = 0;
    this.paused = false;
    this.received = 0;
    this.pendingN = 0;
    this.realIds = new Map(); // id provisoire d'une pose → id attribué par l'hôte
    this.deferred = []; // commandes visant une pose pas encore confirmée (Annuler, Vendre…)
    this.rewindAvail = 0;
    this.speed = 1;
    this.gid = null;
    this.flyers = []; // portails d'où sortiront encore des volants (envoyés par l'hôte)
    this.behind = null; // états valides refusés comme « en retard » à la suite (séquence faussée ?)
    // Lecture régulière des états : ils arrivent par à-coups (relais, réseau mobile) ;
    // on les rejoue à la cadence de l'hôte avec un léger retard (tampon de gigue),
    // et les yokai glissent d'un état au suivant sans arrêt ni saut.
    this.queue = []; // états reçus, pas encore appliqués
    this.offsets = []; // (heure locale de réception − heure d'envoi de l'hôte), récents
    this.offset = null; // le plus petit : trajet le plus rapide
    this.lags = []; // retards de réception au-delà du plus rapide (ms)
    this.iv = 1000 / SNAPSHOT_HZ; // intervalle entre deux états de l'hôte (ms, moyenne)
    this.delay = this.iv * 1.5; // retard de lecture visé (ms)
    this.playRt = null; // instant de l'hôte en cours de lecture (ms)
    this.prevRt = null; // états encadrant la lecture : précédent…
    this.curRt = null; // … et dernier appliqué
    this.lastTick = null;
    this.makeRemote();
  }

  // Les commandes du miroir partent vers l'hôte ; les vérifications (canPlaceTower,
  // aperçus…) restent locales et donnent un retour immédiat à l'interface.
  makeRemote() {
    const g = this.game;
    const self = this;
    g.update = () => {};
    g.rewindAvailable = () => self.rewindAvail;
    g.flyerPortals = () => self.flyers;
    const real = (id) => (id < 0 ? self.realIds.get(id) ?? id : id);
    // Une pose provisoire garde son id pour l'interface (sélection, « Annuler ») :
    // une fois confirmée, cet id désigne la lanterne attribuée par l'hôte.
    const byId = g.towerById.bind(g);
    g.towerById = (id) => byId(id) ?? (id < 0 && self.realIds.has(id) ? byId(self.realIds.get(id)) : null);
    g.placeTower = function (type, c, r) {
      const check = g.canPlaceTower(type, c, r);
      if (!check.ok) {
        g.emit('reject', { c, r, reason: check.reason, pid: g.localPlayer });
        return null;
      }
      self.send('placeTower', [type, c, r]);
      // lanterne provisoire, remplacée par celle de l'hôte au prochain état reçu
      const def = g.defs.towers[type];
      const t = { id: -++self.pendingN, type, element: def.element, owner: g.localPlayer, level: 1, c, r, x: c + 0.5, y: r + 0.5, angle: -Math.PI / 2, shotT: 0, stunT: 0, priority: def.priority ?? 'first', invested: def.cost, bornAt: g.time, sentAt: clock(), pending: true, cooldown: 0, rateMult: 1 };
      g.towers.push(t);
      g.player().gold -= def.cost;
      return t;
    };
    for (const op of Object.keys(COMMANDS)) {
      if (op === 'placeTower') continue;
      const local = g[op].bind(g);
      g[op] = (...args) => {
        const n = COMMANDS[op].length;
        // appel de vague : la réponse de l'hôte met un instant à revenir ; un second
        // toucher pendant ce temps (bouton encore inchangé) n'appelle pas une vague de plus
        if (op === 'startNextWave') {
          const w = self.waveCall;
          if (w && g.waveIndex < w.idx && clock() - w.at < 1500) return false;
          if (!g.canCallNextWave()) return false;
          self.waveCall = { idx: g.waveIndex + 1, at: clock() };
          args = [g.waveIndex + 1];
        }
        // les identifiants de lanterne sont toujours les premiers arguments
        if (['sellTower', 'undoPlace', 'setPriority', 'cyclePriority', 'setRally'].includes(op)) args[0] = real(args[0]);
        if (op === 'fuse') args = [real(args[0]), real(args[1])];
        // une pose pas encore confirmée n'a pas d'id chez l'hôte : la commande attend
        // la confirmation (sinon « Annuler » juste après la pose serait perdu)
        const ids = op === 'fuse' ? args.slice(0, 2) : ['sellTower', 'undoPlace', 'setPriority', 'cyclePriority', 'setRally'].includes(op) ? [args[0]] : [];
        if (ids.some((id) => typeof id === 'number' && id < 0)) self.deferred.push({ op, args: args.slice(0, n), at: clock() });
        else self.send(op, args.slice(0, n));
        // réponse optimiste quand l'action est valide localement
        if (op === 'fuse') return g.canFuse(args[0], args[1]).ok ? g.towerById(args[1]) : null;
        if (op === 'placeStone') return g.canPlaceStone(args[0], args[1]).ok;
        if (op === 'cyclePriority') {
          const t = g.towerById(args[0]);
          return t ? local(args[0]) : null;
        }
        if (op === 'setPriority') return local(args[0], args[1]);
        if (op === 'sellTower') {
          const t = g.towerById(args[0]);
          return t ? g.sellValue(t) : 0;
        }
        if (op === 'rewind') return g.canRewind();
        if (op === 'startNextWave') return g.canCallNextWave();
        return true;
      };
    }
  }

  // Avance les effets purement visuels entre deux états reçus.
  tick(dt) {
    const g = this.game;
    this.play();
    // partie en pause chez l'hôte : rien n'avance ; sinon, à la vitesse de l'hôte
    dt = this.paused ? 0 : dt * this.speed;
    g.time += dt;
    for (const t of g.towers) {
      if (t.shotT > 0) t.shotT -= dt;
      if (t.stunT > 0) t.stunT = Math.max(0, t.stunT - dt);
    }
    for (const t of g.echoes) {
      if (t.shotT > 0) t.shotT -= dt;
      if (t.stunT > 0) t.stunT = Math.max(0, t.stunT - dt);
      t.ttl = Math.max(0, t.ttl - dt);
    }
    // recharge des combos périodiques : elle avance entre deux états (l'hôte la recale)
    for (const z of g.zones) {
      const fx = z.def.effect;
      if ((fx?.kind === 'pulse' || fx?.kind === 'tornado') && z.timer < fx.interval) z.timer = Math.min(fx.interval, z.timer + dt);
    }
    // tornades : elles glissent d'un état à l'autre, comme les yokai
    for (const t of g.tornadoes) {
      if (t.x1 == null) continue;
      t.x = t.x0 + (t.x1 - t.x0) * this.alpha;
      t.y = t.y0 + (t.y1 - t.y0) * this.alpha;
    }
    for (const e of g.enemies) {
      e.age += dt;
      if (e.hitT > 0) e.hitT -= dt;
      if (e.hopT > 0) e.hopT -= dt;
    }
    for (const b of g.barriers) if (b.hitT > 0) b.hitT -= dt;
    for (const b of g.beams) b.life -= dt;
    if (g.beams.some((b) => b.life <= 0)) g.beams = g.beams.filter((b) => b.life > 0);
    this.moveProjectiles(dt);
    if (g.rewindAnim) g.rewindAnim.t = Math.min(g.rewindAnim.dur, g.rewindAnim.t + dt);
  }

  // Projectiles visuels (les dégâts sont calculés chez l'hôte).
  moveProjectiles(dt) {
    const g = this.game;
    for (const p of g.projectiles) {
      if (p.lob) {
        p.t += dt;
        const k = Math.min(1, p.t / p.dur);
        p.x = p.sx + (p.tx - p.sx) * k;
        p.y = p.sy + (p.ty - p.sy) * k;
        p.h = Math.sin(k * Math.PI) * 1.1;
        if (k >= 1) p.alive = false;
        continue;
      }
      const target = this.byId.get(p.targetId);
      if (target) {
        // le yokai tel qu'il est dessiné (interpolé), pas sa position du dernier état
        p.tx = target.px + (target.x - target.px) * this.alpha;
        p.ty = target.py + (target.y - target.py) * this.alpha;
      }
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (d <= step + 0.12) p.alive = false;
      else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
      p.angle = Math.atan2(dy, dx);
    }
    if (g.projectiles.some((p) => !p.alive)) g.projectiles = g.projectiles.filter((p) => p.alive);
  }

  // État reçu de l'hôte : mis en file, appliqué à son tour par play() (chaque image).
  // Renvoie false si l'état est ignoré (mal formé, d'une autre partie, en retard).
  apply(s) {
    if (!validSnap(s, this.gid)) return false;
    if (s.seq <= this.lastSeq) {
      // message en retard… ou séquence faussée par un état forgé (numéro énorme) : si
      // les états continuent d'arriver « en retard » mais dans l'ordre, ce sont ceux de
      // l'hôte, et la lecture repart d'eux (sans quoi le miroir resterait figé)
      this.behind = this.behind && s.seq > this.behind.seq ? { seq: s.seq, n: this.behind.n + 1 } : { seq: s.seq, n: 1 };
      if (this.behind.n < 12) return false;
      this.queue = this.queue.filter((q) => q.seq < s.seq);
    }
    this.behind = null;
    this.lastSeq = s.seq;
    this.received++;
    if (s.rt == null) {
      this.applySafe(s); // hôte sans heure d'envoi : application immédiate
      this.alpha = 1;
      return true;
    }
    const now = clock();
    const off = now - s.rt;
    this.offsets.push(off);
    if (this.offsets.length > 40) this.offsets.shift();
    this.offset = Math.min(...this.offsets);
    // Retard de lecture : l'état k doit être là quand la lecture atteint l'état k−1,
    // soit (intervalle + retard de réception) ; on vise le 9e décile, sans dépasser
    // ~0,4 s de plus qu'un intervalle (un relais lent ne fige pas la partie).
    const gap = this.lastRt != null ? s.rt - this.lastRt : this.iv;
    this.lastRt = s.rt;
    if (gap > 0 && gap < 400) {
      this.iv = this.iv * 0.9 + gap * 0.1;
      this.lags.push(gap + off - this.offset);
      if (this.lags.length > 40) this.lags.shift();
      const sorted = this.lags.slice().sort((a, b) => a - b);
      const need = sorted[Math.floor(sorted.length * 0.9)] ?? this.iv;
      this.delay = Math.max(this.iv, Math.min(this.iv + 400, need + 10));
    }
    this.queue.push(s);
    // lecture arrêtée (onglet caché) : on ne garde pas des minutes d'états en attente
    while (this.queue.length > 24) this.applySafe(this.queue.shift(), true);
    return true;
  }

  // Un état qui échoue à s'appliquer (contenu inattendu) est écarté sans arrêter la
  // lecture : play() tourne dans la boucle d'affichage de l'invité.
  applySafe(s, quiet = false) {
    try {
      this.applyNow(s, quiet);
    } catch (e) {
      console.warn('État de l’hôte ignoré :', e);
    }
  }

  // Lecture : applique les états dont l'heure est venue, calcule l'interpolation.
  play() {
    const now = clock();
    const step = this.lastTick == null ? 0 : now - this.lastTick;
    this.lastTick = now;
    if (this.offset == null || !this.queue.length && this.curRt == null) return;
    const target = now - this.offset - this.delay;
    if (this.playRt == null || Math.abs(target - this.playRt) > 1000) this.playRt = target;
    else {
      // la lecture suit le temps réel, et rejoint en douceur (± 10 %) le retard visé
      this.playRt += step;
      this.playRt += Math.max(-0.1 * step, Math.min(0.1 * step, target - this.playRt));
    }
    // états dus : l'état k s'applique quand la lecture atteint l'état k−1
    let due = 0;
    while (due < this.queue.length && this.playRt >= (due ? this.queue[due - 1].rt : this.curRt ?? -Infinity)) due++;
    for (let k = 0; k < due; k++) {
      const s = this.queue.shift();
      // gros retard rattrapé d'un coup : les effets décoratifs des plus anciens sont sautés
      this.applySafe(s, due - k > 3);
      this.prevRt = this.curRt ?? s.rt;
      this.curRt = s.rt;
    }
    const span = this.curRt - this.prevRt;
    this.alpha = span > 0 ? Math.max(0, Math.min(1, (this.playRt - this.prevRt) / span)) : 1;
  }

  // Message direct de l'hôte (pause / reprise), plus rapide que les états en file.
  setPaused(on) {
    this.paused = !!on;
    this.pauseHint = { on: !!on, seq: this.lastSeq };
  }

  // Applique tout ce qui attend (fin de partie : le dernier état compte).
  drain() {
    while (this.queue.length) {
      const s = this.queue.shift();
      this.applySafe(s, this.queue.length > 0);
      this.prevRt = this.curRt ?? s.rt;
      this.curRt = s.rt;
    }
    this.alpha = 1;
  }

  applyNow(s, quiet = false) {
    const g = this.game;
    const defs = g.defs;
    // pause annoncée directement par l'hôte : les états plus anciens encore en file ne
    // la contredisent pas (sans quoi « Pause par l'hôte » clignoterait)
    const hint = this.pauseHint;
    this.paused = hint && s.seq <= hint.seq ? hint.on : !!s.pz;
    if (hint && s.seq >= hint.seq) this.pauseHint = null;
    this.speed = s.gs || 1;
    g.ct = s.ct;
    g.state = s.st;
    g.lives = s.lv;
    g.maxLives = s.ml;
    s.gold.forEach((v, i) => {
      if (g.players[i]) g.players[i].gold = v;
    });
    g.waveIndex = s.wi;
    g.nextWaveT = s.nw;
    g.rewindCharge = s.rc;
    this.rewindAvail = s.ra;
    g.lastChanceT = s.lc;
    g.rewindsUsed = s.ru;
    g.stats.stones = s.sp;

    // yokai : on garde les objets (interpolation px → x) et l'on crée les nouveaux
    const rewound = !s.rw && !!g.rewindAnim;
    const seen = new Set();
    const list = [];
    for (const row of s.en) {
      const [id, ti, x, y, hp, maxHp, bits, ab, spawnT, slowF, wave, timers] = row;
      if (!Number.isSafeInteger(id) || !this.types[ti] || ![x, y, hp, maxHp, bits].every(isNum)) continue; // ligne inattendue
      let e = this.byId.get(id);
      if (!e) {
        e = g.createEnemy(this.types[ti], { wave });
        e.id = id;
        e.seed = ((id * 0.61803) % 1 + 1) % 1;
        e.x = e.px = e.mx = x;
        e.y = e.py = e.my = y;
        this.byId.set(id, e);
      }
      e.maxHp = maxHp;
      this.setEnemy(e, x, y, hp, bits, ab, spawnT, slowF, rewound);
      if (timers) Object.assign(e.timers, timers);
      seen.add(id);
      list.push(e);
    }
    // lignes courtes : yokai déjà connus (un inconnu attend l'état complet suivant)
    for (const [id, x, y, hp, bits, ab = -1, spawnT = 0, slowF = 1] of s.em || []) {
      const e = this.byId.get(id);
      if (!e || ![x, y, hp, bits].every(isNum)) continue;
      this.setEnemy(e, x, y, hp, bits, ab, spawnT, slowF, rewound);
      seen.add(id);
      list.push(e);
    }
    for (const id of this.byId.keys()) if (!seen.has(id)) this.byId.delete(id);
    g.enemies = list;
    this.history.push({ t: g.time, enemies: list.map((e) => ({ ...e })) });
    // (pause de l'hôte : l'horloge s'arrête, la longueur est donc bornée aussi)
    while (this.history.length && (g.time - this.history[0].t > 7 || this.history.length > 64)) this.history.shift();

    // poses provisoires confirmées par l'hôte : id provisoire → id réel (pour « Annuler »)
    for (const ev of s.ev) {
      if (ev.type !== 'place' || (ev.pid ?? 0) !== g.localPlayer || !ev.tower) continue;
      const p = g.towers.find((t) => t.pending && !t.confirmed && t.c === ev.tower.c && t.r === ev.tower.r);
      if (p) {
        this.realIds.set(p.id, ev.tower.id);
        p.confirmed = true;
      }
    }
    // commandes qui attendaient une confirmation : elles partent avec l'id réel
    if (this.deferred.length) {
      const keep = [];
      for (const d of this.deferred) {
        const args = d.args.map((v, k) => (k < (d.op === 'fuse' ? 2 : 1) && v < 0 && this.realIds.has(v) ? this.realIds.get(v) : v));
        const waiting = args.slice(0, d.op === 'fuse' ? 2 : 1).filter((v) => typeof v === 'number' && v < 0);
        if (!waiting.length) this.send(d.op, args);
        // pose refusée (ou trop ancienne) : la commande est abandonnée
        else if (clock() - d.at < PENDING_MS && waiting.every((id) => g.towers.some((t) => t.id === id))) keep.push({ ...d, args });
      }
      this.deferred = keep;
    }
    if (s.tw) {
      const old = new Map(g.towers.filter((t) => !t.pending).map((t) => [t.id, t]));
      // une pose encore en route vers l'hôte reste affichée (PENDING_MS au plus)
      const waiting = g.towers.filter((t) => t.pending && !t.confirmed && fresh(t));
      g.towers = s.tw.filter((row) => this.towerRowOk(row)).map((row) => this.unpackTower(row, old.get(row[0])));
      for (const p of waiting) if (!g.towerAt(p.c, p.r)) g.towers.push(p);
      computeZones(g);
    } else if (g.towers.some((t) => t.pending && (t.confirmed || !fresh(t)))) {
      g.towers = g.towers.filter((t) => !t.pending || (!t.confirmed && fresh(t)));
    }
    if (s.ec) {
      const old = new Map(g.echoes.map((t) => [t.id, t]));
      g.echoes = s.ec.filter((row) => this.towerRowOk(row)).map((row) => {
        const t = this.unpackTower(row, old.get(row[0]));
        t.echo = true;
        t.ttl = row[10];
        t.maxTtl = row[11];
        return t;
      });
      computeZones(g);
    }
    const oldBars = new Map(g.barriers.map((b) => [b.id, b]));
    g.barriers = s.ba.map(([id, towerId, tile, hp, maxHp, alive, respawnT, owner, thorns = 0, hit = 0]) => ({
      id,
      towerId,
      tile,
      hp,
      maxHp,
      alive: !!alive,
      respawnT,
      owner,
      thorns,
      hitT: hit ? 0.15 : Math.max(0, oldBars.get(id)?.hitT ?? 0),
    }));
    // tornades : de leur position précédente (x0, y0) à la nouvelle (x1, y1), cf. tick()
    const oldTor = new Map(g.tornadoes.map((t) => [t.id, t]));
    g.tornadoes = s.to.map(([id, x, y, life, max, size]) => {
      const o = oldTor.get(id);
      return { id, x: o ? o.x : x, y: o ? o.y : y, x0: o ? o.x1 : x, y0: o ? o.y1 : y, x1: x, y1: y, life, max, size, color: this.tornadoColor() };
    });
    // lanternes étourdies (l'étourdissement s'écoule ensuite chez l'invité, cf. tick())
    if (s.su) {
      const su = new Map(s.su);
      for (const t of g.towers) if (!t.pending) t.stunT = su.get(t.id) ?? 0;
      for (const t of g.echoes) t.stunT = su.get(t.id) ?? 0;
    }
    if (s.cw) g.chargedWaves = new Set(s.cw);
    if (s.sn) {
      const st = g.grid.stone;
      let changed = false;
      const set = new Set(s.sn);
      for (let i = 0; i < st.length; i++) {
        const v = set.has(i) ? 1 : 0;
        if (st[i] !== v) {
          st[i] = v;
          changed = true;
        }
      }
      if (changed) g.flow.compute();
      g.stonesPlaced = s.sn.length;
      if (s.so && g.stoneOwner) {
        g.stoneOwner.fill(-1);
        s.sn.forEach((i, k) => {
          if (i >= 0 && i < st.length) g.stoneOwner[i] = s.so[k] ?? -1;
        });
      }
    }
    // minuteries des combos périodiques (après un éventuel recalcul des zones)
    if (s.zt) {
      const timers = new Map(s.zt);
      for (const z of g.zones) if (isNum(timers.get(z.key))) z.timer = timers.get(z.key);
    }
    this.flyers = s.fl || [];
    // Rembobinage : l'animation est rejouée avec l'historique reçu.
    if (s.rw && !g.rewindAnim) {
      const frames = [{ enemies: list.map((e) => ({ ...e })) }, ...this.history.slice().reverse()];
      g.rewindAnim = { t: s.rw.t, dur: s.rw.d, frames, ghosts: s.rw.gh || [], seconds: 6 };
    } else if (!s.rw && g.rewindAnim) {
      g.rewindAnim = null;
      this.history = [];
    }
    for (const ev of s.ev) {
      // retard rattrapé, ou file d'effets qui n'est plus lue (onglet caché) : on saute le décor
      if ((quiet || g.events.length > 300) && COSMETIC.has(ev.type)) continue;
      try {
        this.event(ev);
      } catch (e) {
        console.warn('Événement de l’hôte ignoré :', ev.type, e);
      }
    }
    // Or du joueur local : les poses encore en route vers l'hôte restent décomptées
    // (sans quoi le compteur remonterait puis redescendrait).
    const me = g.players[g.localPlayer];
    if (me) {
      let pending = 0;
      for (const t of g.towers) if (t.pending && !t.confirmed) pending += t.invested || 0;
      if (pending) me.gold = Math.max(0, me.gold - pending);
    }
  }

  // Nouvel état d'un yokai du miroir (interpolé de px, py vers x, y).
  setEnemy(e, x, y, hp, bits, ab, spawnT, slowF, rewound) {
    // fin d'un Rembobinage ou grand écart : replacé d'un coup (pas de glissade à travers la carte)
    const jump = rewound || Math.hypot(x - e.x, y - e.y) > 2.5;
    e.px = jump ? x : e.x;
    e.py = jump ? y : e.y;
    e.x = e.mx = x;
    e.y = e.my = y;
    e.hp = hp;
    e.flying = !!(bits & B.flying);
    e.enraged = !!(bits & B.enraged);
    e.blocked = bits & B.blocked ? 1 : null;
    e.slowT = bits & B.slow ? 0.5 : 0;
    e.slowF = slowF;
    e.burnT = bits & B.burn ? 0.5 : 0;
    e.stunT = bits & B.stun ? 0.5 : 0;
    e.blindT = bits & B.blind ? 0.5 : 0;
    e.breakT = bits & B.brk ? 0.5 : 0;
    e.shredT = bits & B.shred ? 0.5 : 0;
    if (bits & B.hit) e.hitT = Math.max(e.hitT, 0.12);
    // saut (kasaobake) : l'animation démarre au premier état qui le signale, puis s'écoule
    if (bits & B.hop) {
      if (!e.hopping) e.hopT = 0.5;
      e.hopping = true;
    } else e.hopping = false;
    e.dirX = bits & B.left ? -1 : 1;
    e.absorb = ab >= 0 ? ELS[ab] : null;
    e.spawnT = spawnT;
  }

  tornadoColor() {
    return this.game.defs.combos.find((c) => c.effect?.kind === 'tornado')?.color ?? '#ff8a3c';
  }

  // Ligne de lanterne exploitable (type connu, case entière) ?
  towerRowOk(row) {
    const [id, ti, c, r, level] = row;
    return Number.isSafeInteger(id) && !!this.towerTypes[ti] && this.game.grid.inBounds(c, r) && Number.isInteger(level);
  }

  unpackTower(row, prev) {
    const [id, ti, c, r, level, owner, priority, invested, stunT, rally] = row;
    const type = this.towerTypes[ti];
    const def = this.game.defs.towers[type];
    const t = prev && prev.type === type ? prev : { angle: -Math.PI / 2, shotT: 0, cooldown: 0, bornAt: this.game.time, rateMult: 1, cleanse: 0 };
    Object.assign(t, { id, type, element: def.element, c, r, x: c + 0.5, y: r + 0.5, level, owner, priority, invested, stunT, rally: rally >= 0 ? rally : null });
    return t;
  }

  // Événement de l'hôte → file locale (rendu, sons) avec les objets du miroir.
  event(ev) {
    const g = this.game;
    ev.fromHost = true; // (main.js : refus d'une commande de l'invité, dit près du socle)
    for (const k in ev) {
      const v = ev[k];
      if (v && v.__combo) ev[k] = g.defs.combos.find((c) => c.id === v.__combo) || v;
    }
    if (ev.zone) {
      // zone de combo (impulsion du Givre) : celle du miroir, ou la copie avec sa définition
      const live = g.zones.find((z) => z.key === ev.zone.key);
      if (live) ev.zone = live;
      else {
        const def = g.defs.combos.find((c) => c.id === ev.zone.def?.__combo);
        if (!def) return;
        ev.zone.def = def;
      }
    }
    // les objets voyagent en copie : on préfère l'objet vivant du miroir s'il existe
    if (ev.enemy && this.byId.has(ev.enemy.id)) ev.enemy = this.byId.get(ev.enemy.id);
    if (ev.tower) {
      const live = g.towerById(ev.tower.id) || g.echoes.find((t) => t.id === ev.tower.id);
      if (live) ev.tower = live;
    }
    if (ev.type === 'shoot' && ev.projectile) {
      const p = { ...ev.projectile, alive: true, t: 0 };
      p.x ??= p.sx;
      p.y ??= p.sy;
      p.homing ??= !p.lob;
      g.projectiles.push(p);
      ev.projectile = p;
      if (ev.tower) {
        ev.tower.shotT = 0.18;
        ev.tower.angle = Math.atan2(p.ty - p.sy, p.tx - p.sx);
      }
    } else if (ev.type === 'beam' && ev.beam) {
      g.beams.push({ ...ev.beam });
      // le Torrent tire (recul, gerbe) : comme updateTower chez l'hôte
      if (ev.tower) {
        ev.tower.shotT = 0.18;
        ev.tower.angle = Math.atan2(ev.beam.y1 - ev.tower.y, ev.beam.x1 - ev.tower.x);
      }
    } else if ((ev.type === 'aura' || ev.type === 'barrierHeal') && ev.tower) {
      // Feux follets, Source sacrée : activité de la lanterne (orbite, anneau d'eau)
      ev.tower.shotT = ev.type === 'aura' ? 0.25 : 0.6;
    } else if (ev.type === 'reject' && ev.pid !== g.localPlayer) {
      return; // refus adressé à un autre joueur
    } else if (ev.type === 'combo') {
      return; // le miroir recalcule ses zones (computeZones) et annonce lui-même les combos
    } else if (ev.type === 'quake' && ev.tower) {
      ev.tower.shotT = 0.3;
    }
    if (ev.type === 'reject' && (ev.pid ?? 0) === g.localPlayer) {
      // pose refusée par l'hôte (socle pris entre-temps…) : la lanterne provisoire disparaît
      g.towers = g.towers.filter((t) => !(t.pending && t.c === ev.c && t.r === ev.r));
    }
    g.events.push(ev);
  }
}

// Partie miroir : même niveau, mêmes joueurs, sans simulation.
export function makeMirror(Game, level, defs, start) {
  const mirror = new Game(level, defs, { seed: start.seed, players: start.players, localPlayer: start.you, hard: start.hard });
  mirror.challenge = !!start.challenge;
  mirror.remote = true;
  return mirror;
}

export { STEP };
