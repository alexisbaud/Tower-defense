// Synchronisation d'une partie coopérative.
//
// L'hôte fait tourner la vraie simulation (src/core/game.js) et diffuse un état
// compact environ 8 fois par seconde, avec les événements survenus entre-temps
// (tirs, éliminations…). Les invités tiennent un « miroir » : une instance de Game
// qui ne simule rien, dont l'état est remplacé à chaque réception ; le rendu et
// l'interface le lisent comme une partie normale. Les commandes des invités
// (poser, fusionner, vendre…) sont envoyées à l'hôte, qui les valide et les applique.
//
// On ne fait pas tourner la simulation chez chacun (pas de « lockstep ») : les
// fonctions mathématiques diffèrent légèrement d'un navigateur à l'autre et les
// parties finiraient par diverger.

import { computeZones } from '../core/combos.js';
import { STEP } from '../core/game.js';

export const SNAPSHOT_HZ = 8;
const KEYFRAME_EVERY = 16; // état complet (lanternes, pierres) au moins toutes les 2 s

// Commandes qu'un invité peut demander à l'hôte (méthodes de Game, `pid` ajouté en dernier).
export const COMMANDS = {
  placeTower: 3,
  sellTower: 1,
  undoPlace: 2,
  fuse: 2,
  setPriority: 2,
  cyclePriority: 1,
  placeStone: 2,
  removeStone: 2,
  startNextWave: 0,
  rewind: 0,
  setRally: 3,
};

// Événements relayés aux invités (effets visuels et sonores).
const RELAYED = new Set([
  'place', 'sell', 'undo', 'fuse', 'priority', 'reject', 'stone', 'unstone', 'combo', 'shoot', 'hit', 'beam', 'aura', 'quake',
  'kill', 'leak', 'spawn', 'spawnChild', 'split', 'heal', 'summon', 'absorb', 'absorbShift', 'stomp', 'enrage', 'hop',
  'barrierUp', 'barrierBreak', 'barrierHeal', 'rally', 'pulse', 'tornado', 'waveStart', 'waveEnd', 'earlyBonus',
  'echo', 'echoFade', 'rewindStart', 'rewindEnd', 'lastChance', 'win', 'lose',
]);

const r2 = (v) => Math.round(v * 100) / 100;

// Bits d'état d'un yokai.
const B = { flying: 1, boss: 2, enraged: 4, timeless: 8, blocked: 16, slow: 32, burn: 64, stun: 128, blind: 256, brk: 512, hit: 1024, hop: 2048, left: 4096, shred: 8192 };

// ───────────────────────── encodage (hôte) ─────────────────────────

// Copie plate d'un objet d'événement : seuls les champs simples voyagent.
function packObj(o) {
  if (!o || typeof o !== 'object') return o;
  if (o.effect && o.elements && o.id) return { __combo: o.id }; // définition de combo
  const out = {};
  for (const k in o) {
    const v = o[k];
    if (typeof v === 'number') out[k] = Number.isInteger(v) ? v : r2(v);
    else if (typeof v === 'string' || typeof v === 'boolean' || v === null) out[k] = v;
    else if (Array.isArray(v) && v.length <= 12 && v.every((x) => typeof x === 'number')) out[k] = v;
  }
  return out;
}

export function packEvent(ev) {
  const out = {};
  for (const k in ev) {
    const v = ev[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = packObj(v);
    else if (Array.isArray(v)) out[k] = v.every((x) => typeof x !== 'object') ? v : v.map(packObj);
    else out[k] = typeof v === 'number' && !Number.isInteger(v) ? r2(v) : v;
  }
  return out;
}

function towerSig(list) {
  return list.map((t) => `${t.id}:${t.level}:${t.priority}`).join(',');
}

export class HostSync {
  constructor(game, publish) {
    this.game = game;
    this.publish = publish; // (objet) → envoi à tous les invités
    this.events = [];
    this.acc = 0;
    this.seq = 0;
    this.sig = { towers: '', echoes: '', stones: '' };
    this.typeIndex = new Map(Object.keys(game.defs.enemies).map((k, i) => [k, i]));
    this.towerIndex = new Map(Object.keys(game.defs.towers).map((k, i) => [k, i]));
    this.paused = false;
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
    const key = this.seq++ % KEYFRAME_EVERY === 0;
    const s = {
      type: 'snap',
      seq: this.seq,
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
      en: g.enemies.filter((e) => e.alive).map((e) => this.packEnemy(e)),
      ba: g.barriers.map((b) => [b.id, b.towerId, b.tile, Math.ceil(b.hp), Math.ceil(b.maxHp), b.alive ? 1 : 0, r2(b.respawnT), b.owner ?? 0]),
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
    const ss = stones.join(',');
    if (key || ss !== this.sig.stones) {
      this.sig.stones = ss;
      s.sn = stones;
    }
    if (g.rewindAnim) s.rw = { t: r2(g.rewindAnim.t), d: g.rewindAnim.dur, gh: g.rewindAnim.ghosts };
    return s;
  }

  packEnemy(e) {
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
    const els = ['fire', 'water', 'wind', 'earth'];
    const out = [e.id, this.typeIndex.get(e.type), r2(e.x), r2(e.y), Math.ceil(e.hp), Math.ceil(e.maxHp), bits, els.indexOf(e.absorb), r2(e.spawnT), r2(e.slowF), e.wave];
    if (e.boss) out.push({ stomp: r2(e.timers.stomp ?? 0), summon: r2(e.timers.summon ?? 0), cycle: r2(e.timers.cycle ?? 0) });
    return out;
  }

  packTower(t) {
    return [t.id, this.towerIndex.get(t.type), t.c, t.r, t.level, t.owner ?? 0, t.priority, t.invested, r2(t.stunT), t.rally ?? -1];
  }
}

// Applique une commande reçue d'un invité. Renvoie le résultat de la méthode.
export function applyCommand(game, pid, op, args = []) {
  const n = COMMANDS[op];
  if (n == null || !Array.isArray(args)) return null;
  const a = args.slice(0, n).map((v) => (typeof v === 'number' || typeof v === 'string' ? v : null));
  while (a.length < n) a.push(undefined);
  if (op === 'startNextWave') return game.startNextWave(pid, true);
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
    this.lastSnap = 0; // horodatage local de la dernière réception
    this.interval = 1 / SNAPSHOT_HZ;
    this.alpha = 1;
    this.lastSeq = 0;
    this.paused = false;
    this.received = 0;
    this.pendingN = 0;
    this.realIds = new Map(); // id provisoire d'une pose → id attribué par l'hôte
    this.rewindAvail = 0;
    this.makeRemote();
  }

  // Les commandes du miroir partent vers l'hôte ; les vérifications (canPlaceTower,
  // aperçus…) restent locales et donnent un retour immédiat à l'interface.
  makeRemote() {
    const g = this.game;
    const self = this;
    g.update = () => {};
    g.rewindAvailable = () => self.rewindAvail;
    const real = (id) => (id < 0 ? self.realIds.get(id) ?? id : id);
    g.placeTower = function (type, c, r) {
      const check = g.canPlaceTower(type, c, r);
      if (!check.ok) {
        g.emit('reject', { c, r, reason: check.reason, pid: g.localPlayer });
        return null;
      }
      self.send('placeTower', [type, c, r]);
      // lanterne provisoire, remplacée par celle de l'hôte au prochain état reçu
      const def = g.defs.towers[type];
      const t = { id: -++self.pendingN, type, element: def.element, owner: g.localPlayer, level: 1, c, r, x: c + 0.5, y: r + 0.5, angle: -Math.PI / 2, shotT: 0, stunT: 0, priority: def.priority ?? 'first', invested: def.cost, bornAt: g.time, pending: true, cooldown: 0, rateMult: 1 };
      g.towers.push(t);
      g.player().gold -= def.cost;
      return t;
    };
    for (const op of Object.keys(COMMANDS)) {
      if (op === 'placeTower') continue;
      const local = g[op].bind(g);
      g[op] = (...args) => {
        const n = COMMANDS[op];
        // les identifiants de lanterne sont toujours les premiers arguments
        if (['sellTower', 'undoPlace', 'setPriority', 'cyclePriority', 'setRally'].includes(op)) args[0] = real(args[0]);
        if (op === 'fuse') args = [real(args[0]), real(args[1])];
        self.send(op, args.slice(0, n));
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
    g.time += dt;
    const now = g.time;
    this.alpha = Math.min(1, (now - this.lastSnap) / this.interval);
    for (const t of g.towers) if (t.shotT > 0) t.shotT -= dt;
    for (const t of g.echoes) {
      if (t.shotT > 0) t.shotT -= dt;
      t.ttl = Math.max(0, t.ttl - dt);
    }
    for (const e of g.enemies) {
      e.age += dt;
      if (e.hitT > 0) e.hitT -= dt;
    }
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
        p.tx = target.x;
        p.ty = target.y;
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

  apply(s) {
    if (s.seq <= this.lastSeq) return; // message en retard
    this.lastSeq = s.seq;
    this.received++;
    const g = this.game;
    const defs = g.defs;
    this.interval = Math.max(0.05, Math.min(0.5, g.time - this.lastSnap || 1 / SNAPSHOT_HZ));
    this.lastSnap = g.time;
    this.paused = !!s.pz;
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
    const seen = new Set();
    const list = [];
    for (const row of s.en) {
      const [id, ti, x, y, hp, maxHp, bits, ab, spawnT, slowF, wave, timers] = row;
      let e = this.byId.get(id);
      if (!e) {
        e = g.createEnemy(this.types[ti], { wave });
        e.id = id;
        e.seed = ((id * 0.61803) % 1 + 1) % 1;
        e.x = e.px = e.mx = x;
        e.y = e.py = e.my = y;
        this.byId.set(id, e);
      }
      e.px = e.x;
      e.py = e.y;
      e.x = e.mx = x;
      e.y = e.my = y;
      e.hp = hp;
      e.maxHp = maxHp;
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
      e.hopT = bits & B.hop ? 0.3 : 0;
      e.dirX = bits & B.left ? -1 : 1;
      e.absorb = ab >= 0 ? ['fire', 'water', 'wind', 'earth'][ab] : null;
      e.spawnT = spawnT;
      if (timers) Object.assign(e.timers, timers);
      seen.add(id);
      list.push(e);
    }
    for (const id of this.byId.keys()) if (!seen.has(id)) this.byId.delete(id);
    g.enemies = list;
    this.history.push({ t: g.time, enemies: list.map((e) => ({ ...e })) });
    while (this.history.length && g.time - this.history[0].t > 7) this.history.shift();

    // poses provisoires confirmées par l'hôte : id provisoire → id réel (pour « Annuler »)
    for (const ev of s.ev) {
      if (ev.type !== 'place' || (ev.pid ?? 0) !== g.localPlayer || !ev.tower) continue;
      const p = g.towers.find((t) => t.pending && t.c === ev.tower.c && t.r === ev.tower.r);
      if (p) {
        this.realIds.set(p.id, ev.tower.id);
        p.confirmed = true;
      }
    }
    if (s.tw) {
      const old = new Map(g.towers.filter((t) => !t.pending).map((t) => [t.id, t]));
      // une pose encore en route vers l'hôte reste affichée (2 s au plus)
      const waiting = g.towers.filter((t) => t.pending && !t.confirmed && g.time - t.bornAt < 2);
      g.towers = s.tw.map((row) => this.unpackTower(row, old.get(row[0])));
      for (const p of waiting) if (!g.towerAt(p.c, p.r)) g.towers.push(p);
      computeZones(g);
    } else if (g.towers.some((t) => t.pending && (t.confirmed || g.time - t.bornAt >= 2))) {
      g.towers = g.towers.filter((t) => !t.pending || (!t.confirmed && g.time - t.bornAt < 2));
    }
    if (s.ec) {
      const old = new Map(g.echoes.map((t) => [t.id, t]));
      g.echoes = s.ec.map((row) => {
        const t = this.unpackTower(row, old.get(row[0]));
        t.echo = true;
        t.ttl = row[10];
        t.maxTtl = row[11];
        return t;
      });
      computeZones(g);
    }
    g.barriers = s.ba.map(([id, towerId, tile, hp, maxHp, alive, respawnT, owner]) => ({ id, towerId, tile, hp, maxHp, alive: !!alive, respawnT, owner, hitT: 0 }));
    g.tornadoes = s.to.map(([id, x, y, life, max, size]) => ({ id, x, y, life, max, size, color: this.tornadoColor() }));
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
    }
    // Rembobinage : l'animation est rejouée avec l'historique reçu.
    if (s.rw && !g.rewindAnim) {
      const frames = [{ enemies: list.map((e) => ({ ...e })) }, ...this.history.slice().reverse()];
      g.rewindAnim = { t: s.rw.t, dur: s.rw.d, frames, ghosts: s.rw.gh || [], seconds: 6 };
    } else if (!s.rw && g.rewindAnim) {
      g.rewindAnim = null;
      this.history = [];
    }
    for (const ev of s.ev) this.event(ev);
  }

  tornadoColor() {
    return this.game.defs.combos.find((c) => c.effect?.kind === 'tornado')?.color ?? '#ff8a3c';
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
    for (const k in ev) {
      const v = ev[k];
      if (v && v.__combo) ev[k] = g.defs.combos.find((c) => c.id === v.__combo) || v;
    }
    // les objets voyagent en copie : on préfère l'objet vivant du miroir s'il existe
    if (ev.enemy && this.byId.has(ev.enemy.id)) ev.enemy = this.byId.get(ev.enemy.id);
    if (ev.tower) {
      const live = g.towerById(ev.tower.id) || g.echoes.find((t) => t.id === ev.tower.id);
      if (live) ev.tower = live;
    }
    if (ev.type === 'shoot' && ev.projectile) {
      const p = { ...ev.projectile, alive: true, t: 0 };
      g.projectiles.push(p);
      ev.projectile = p;
      if (ev.tower) {
        ev.tower.shotT = 0.18;
        ev.tower.angle = Math.atan2(p.ty - p.sy, p.tx - p.sx);
      }
    } else if (ev.type === 'beam' && ev.beam) {
      g.beams.push({ ...ev.beam });
    } else if (ev.type === 'reject' && ev.pid !== g.localPlayer) {
      return; // refus adressé à un autre joueur
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
