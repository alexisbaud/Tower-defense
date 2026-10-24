// Moteur de simulation. Aucune dépendance au DOM : il tourne aussi bien dans le
// navigateur que dans Node (tools/sim.mjs). Le rendu et l'audio consomment la
// file `events` remplie pendant `update()`.

import { Grid, T } from './grid.js';
import { FlowField, bfs } from './flowfield.js';
import { Rng } from './rng.js';
import { buildComboIndex, computeZones, updateZones, updateTornadoes, comboKey } from './combos.js';

export const STEP = 1 / 60;

export class Game {
  /**
   * @param {object} level  données du niveau (data/levels/*.js)
   * @param {object} defs   { towers, enemies, rules }
   * @param {object} opts   { seed, recordEvents }
   */
  constructor(level, defs, opts = {}) {
    this.level = level;
    this.defs = defs;
    this.rules = { ...defs.rules, ...(level.rules || {}) };
    this.rng = new Rng(opts.seed ?? 7);
    this.recordEvents = opts.recordEvents !== false;
    this.events = [];

    this.grid = new Grid(level.map);
    this.flow = new FlowField(this.grid);

    this.time = 0;
    this.waveTime = 0;
    this.gold = level.startGold;
    this.maxLives = level.lives ?? this.rules.lives;
    this.lives = this.maxLives;
    this.nextId = 1;

    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    this.zones = []; // zones de synergie (combos)
    this.tornadoes = [];
    this.comboIndex = buildComboIndex(defs.combos);
    this.stonesPlaced = 0;

    this.waves = level.waves;
    this.waveIndex = -1; // index de la dernière vague lancée
    this.state = 'build'; // build | wave | won | lost
    this.countdown = null; // compte à rebours avant la vague suivante (null = attente du joueur)
    this.spawners = [];
    this.stats = { kills: 0, leaks: 0, goldEarned: 0, towersBuilt: 0 };
  }

  // ───────────────────────── utilitaires ─────────────────────────

  emit(type, data) {
    if (this.recordEvents) this.events.push({ type, ...data });
  }

  towerAt(c, r) {
    for (const t of this.towers) if (t.c === c && t.r === r) return t;
    return null;
  }

  towerById(id) {
    return this.towers.find((t) => t.id === id) || null;
  }

  towerStats(t) {
    return this.defs.towers[t.type].levels[t.level - 1];
  }

  get totalWaves() {
    return this.waves.length;
  }

  get availableTowers() {
    return this.level.towers || Object.keys(this.defs.towers);
  }

  stars() {
    if (this.state !== 'won') return 0;
    const ratio = this.lives / this.maxLives;
    if (ratio >= this.rules.stars3) return 3;
    if (ratio >= this.rules.stars2) return 2;
    return 1;
  }

  // ───────────────────────── commandes du joueur ─────────────────────────

  canPlaceTower(type, c, r) {
    if (this.state === 'won' || this.state === 'lost') return { ok: false, reason: 'over' };
    const def = this.defs.towers[type];
    if (!def || !this.availableTowers.includes(type)) return { ok: false, reason: 'unknown' };
    if (!this.grid.inBounds(c, r)) return { ok: false, reason: 'bounds' };
    const i = this.grid.idx(c, r);
    if (this.grid.type(i) !== T.SLOT) return { ok: false, reason: 'slot' };
    if (this.towerAt(c, r)) return { ok: false, reason: 'occupied' };
    if (this.gold < def.cost) return { ok: false, reason: 'gold' };
    return { ok: true };
  }

  placeTower(type, c, r) {
    const check = this.canPlaceTower(type, c, r);
    if (!check.ok) {
      this.emit('reject', { c, r, reason: check.reason });
      return null;
    }
    const def = this.defs.towers[type];
    this.gold -= def.cost;
    const t = {
      id: this.nextId++,
      type,
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
    };
    this.towers.push(t);
    this.stats.towersBuilt++;
    this.emit('place', { tower: t });
    this.onTowersChanged();
    return t;
  }

  sellValue(t) {
    return Math.floor(t.invested * this.rules.sellRatio);
  }

  sellTower(id) {
    const t = this.towerById(id);
    if (!t) return 0;
    const value = this.sellValue(t);
    this.gold += value;
    this.towers = this.towers.filter((x) => x !== t);
    this.emit('sell', { tower: t, value });
    this.onTowersChanged();
    return value;
  }

  // Appelé à chaque modification de l'ensemble des tours.
  onTowersChanged() {
    computeZones(this);
  }

  comboFor(a, b) {
    return this.comboIndex.get(comboKey(a, b)) || null;
  }

  // ───────────────────────── fusion ─────────────────────────

  canFuse(srcId, dstId) {
    const a = this.towerById(srcId);
    const b = this.towerById(dstId);
    if (!a || !b || a === b) return { ok: false, reason: 'mismatch' };
    if (this.state === 'won' || this.state === 'lost') return { ok: false, reason: 'over' };
    if (a.type !== b.type || a.level !== b.level) return { ok: false, reason: 'mismatch' };
    if (a.level >= this.rules.maxTowerLevel) return { ok: false, reason: 'level' };
    return { ok: true };
  }

  // Glisser `src` sur `dst` : `src` disparaît, `dst` monte d'un niveau.
  fuse(srcId, dstId) {
    if (!this.canFuse(srcId, dstId).ok) return null;
    const src = this.towerById(srcId);
    const dst = this.towerById(dstId);
    this.towers = this.towers.filter((t) => t !== src);
    dst.level += 1;
    dst.invested += src.invested;
    dst.id = this.nextId++; // nouvelle identité : utile au rembobinage (écho)
    dst.bornAt = this.time;
    dst.cooldown = 0.3;
    this.emit('fuse', { tower: dst, from: { x: src.x, y: src.y }, level: dst.level });
    this.onTowersChanged();
    return dst;
  }

  // ───────────────────────── pierres (chemin modifiable) ─────────────────────────

  stoneConf() {
    const s = this.level.stones;
    if (!s) return null;
    const o = typeof s === 'object' ? s : {};
    return { cost: o.cost ?? this.rules.stoneCost, max: o.max ?? this.rules.stoneMax };
  }

  stoneCost() {
    return this.stoneConf()?.cost ?? 0;
  }

  stonesLeft() {
    const conf = this.stoneConf();
    return conf ? conf.max - this.stonesPlaced : 0;
  }

  routeLength() {
    let n = 0;
    for (const s of this.grid.spawns) n += Math.max(0, this.flow.dist[s]);
    return n;
  }

  canPlaceStone(c, r) {
    const conf = this.stoneConf();
    if (!conf) return { ok: false, reason: 'unknown' };
    if (this.state === 'won' || this.state === 'lost') return { ok: false, reason: 'over' };
    const g = this.grid;
    if (!g.inBounds(c, r)) return { ok: false, reason: 'bounds' };
    const i = g.idx(c, r);
    if (g.type(i) !== T.OPEN) return { ok: false, reason: 'open' };
    if (g.stone[i]) return { ok: false, reason: 'occupied' };
    if (this.stonesPlaced >= conf.max) return { ok: false, reason: 'limit' };
    if (this.gold < conf.cost) return { ok: false, reason: 'gold' };
    for (const e of this.enemies) {
      if (!e.alive || e.flying) continue;
      if (e.cur === i || e.target === i || g.tileAt(e.x, e.y) === i) return { ok: false, reason: 'occupiedEnemy' };
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

  placeStone(c, r) {
    const check = this.canPlaceStone(c, r);
    if (!check.ok) {
      this.emit('reject', { c, r, reason: check.reason });
      return false;
    }
    const before = this.routeLength();
    const i = this.grid.idx(c, r);
    this.grid.stone[i] = 1;
    this.gold -= this.stoneCost();
    this.stonesPlaced++;
    this.flow.compute();
    this.emit('stone', { c, r, delta: this.routeLength() - before });
    return true;
  }

  removeStone(c, r) {
    const g = this.grid;
    if (!g.inBounds(c, r)) return false;
    const i = g.idx(c, r);
    if (!g.stone[i]) return false;
    const before = this.routeLength();
    g.stone[i] = 0;
    this.stonesPlaced--;
    const refund = Math.floor(this.stoneCost() * this.rules.stoneRefund);
    this.gold += refund;
    this.flow.compute();
    this.emit('unstone', { c, r, refund, delta: this.routeLength() - before });
    return true;
  }

  startNextWave() {
    if (this.state !== 'build') return false;
    const idx = this.waveIndex + 1;
    if (idx >= this.waves.length) return false;
    if (this.countdown != null && this.countdown > 0) {
      const bonus = Math.floor(this.countdown * this.rules.earlyBonusPerSecond);
      if (bonus > 0) {
        this.gold += bonus;
        this.emit('earlyBonus', { gold: bonus });
      }
    }
    this.countdown = null;
    this.waveIndex = idx;
    this.state = 'wave';
    this.waveTime = 0;
    const wave = this.waves[idx];
    this.spawners = wave.groups.map((g) => ({
      enemy: g.enemy,
      count: g.count,
      interval: g.interval ?? 1,
      spawn: g.spawn ?? 0,
      hp: g.hp ?? 1,
      absorb: g.absorb ?? null,
      t: -(g.delay ?? 0),
      spawned: 0,
    }));
    this.emit('waveStart', { index: idx, total: this.waves.length });
    return true;
  }

  // ───────────────────────── boucle ─────────────────────────

  update(dt) {
    if (this.state === 'won' || this.state === 'lost') return;
    this.time += dt;
    if (this.state === 'wave') {
      this.waveTime += dt;
      this.updateSpawners(dt);
    } else if (this.countdown != null) {
      this.countdown -= dt;
      if (this.countdown <= 0) this.startNextWave();
    }
    this.updateEnemies(dt);
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    updateZones(this, dt);
    updateTornadoes(this, dt);
    this.cleanup();
    this.checkWaveEnd();
  }

  updateSpawners(dt) {
    for (const s of this.spawners) {
      if (s.spawned >= s.count) continue;
      s.t += dt;
      while (s.t >= 0 && s.spawned < s.count) {
        const spawnTile = this.grid.spawns[s.spawn % this.grid.spawns.length];
        this.spawnEnemy(s.enemy, spawnTile, { hpMult: s.hp, absorb: s.absorb });
        s.spawned++;
        s.t -= s.interval;
      }
    }
  }

  spawnersDone() {
    return this.spawners.every((s) => s.spawned >= s.count);
  }

  checkWaveEnd() {
    if (this.state !== 'wave') return;
    if (!this.spawnersDone() || this.enemies.length > 0) return;
    const wave = this.waves[this.waveIndex];
    const reward = wave.reward ?? this.rules.waveReward;
    this.gold += reward;
    this.emit('waveEnd', { index: this.waveIndex, reward });
    if (this.waveIndex >= this.waves.length - 1) {
      this.state = 'won';
      this.emit('win', { stars: this.stars() });
    } else {
      this.state = 'build';
      this.countdown = this.level.wavePause ?? this.rules.wavePause;
    }
  }

  // ───────────────────────── yokai ─────────────────────────

  createEnemy(type, opts = {}) {
    const def = this.defs.enemies[type];
    if (!def) throw new Error(`Yokai inconnu : ${type}`);
    const hp = def.hp * (opts.hpMult ?? 1) * (this.level.hpScale ?? 1);
    return {
      id: this.nextId++,
      type,
      x: 0,
      y: 0,
      px: 0,
      py: 0,
      hp,
      maxHp: hp,
      speed: def.speed,
      size: def.size ?? 0.3,
      armor: def.abilities?.armor ?? 0,
      flying: !!def.abilities?.flying,
      absorb: opts.absorb ?? def.abilities?.absorb ?? null,
      alive: true,
      cur: -1,
      target: -1,
      dirX: 0,
      dirY: 1,
      trail: [],
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
      shredM: 1,
      shredT: 0,
      knock: 0,
      hitT: 0,
      spawnT: opts.spawnT ?? 0.7,
      age: 0,
      seed: this.rng.next(),
      timers: {},
      enraged: false,
    };
  }

  spawnEnemy(type, spawnTile, opts = {}) {
    const e = this.createEnemy(type, opts);
    const g = this.grid;
    e.x = e.px = g.cx(spawnTile);
    e.y = e.py = g.cy(spawnTile);
    if (e.flying) {
      const goal = this.nearestGoal(e.x, e.y);
      e.fx0 = e.x;
      e.fy0 = e.y;
      e.fx1 = g.cx(goal);
      e.fy1 = g.cy(goal);
      e.flyLen = Math.hypot(e.fx1 - e.fx0, e.fy1 - e.fy0);
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

  nearestGoal(x, y) {
    let best = this.grid.goals[0];
    let bd = Infinity;
    for (const gi of this.grid.goals) {
      const d = Math.hypot(this.grid.cx(gi) - x, this.grid.cy(gi) - y);
      if (d < bd) {
        bd = d;
        best = gi;
      }
    }
    return best;
  }

  // Distance restante jusqu'au sanctuaire (sert au ciblage « le plus avancé »).
  remaining(e) {
    if (e.flying) return e.flyLen - e.s;
    const d = this.flow.dist[e.target];
    const tx = this.grid.cx(e.target);
    const ty = this.grid.cy(e.target);
    return (d < 0 ? 999 : d) + Math.hypot(tx - e.x, ty - e.y);
  }

  updateEnemies(dt) {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.px = e.x;
      e.py = e.y;
      e.age += dt;
      if (e.hitT > 0) e.hitT -= dt;
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
    }
  }

  updateStatuses(e, dt) {
    if (e.slowT > 0 && (e.slowT -= dt) <= 0) e.slowF = 1;
    if (e.stunT > 0) e.stunT -= dt;
    if (e.blindT > 0) e.blindT -= dt;
    if (e.shredT > 0 && (e.shredT -= dt) <= 0) e.shredM = 1;
    if (e.burnT > 0) {
      e.burnT -= dt;
      this.damage(e, e.burnDps * dt, 'fire', { dot: true });
      if (e.burnT <= 0) e.burnDps = 0;
    }
  }

  // Capacités spéciales (étendues dans les étapes suivantes).
  updateAbilities() {}

  speedOf(e) {
    if (e.stunT > 0) return 0;
    let s = e.speed;
    if (e.slowT > 0) s *= e.slowF;
    return s;
  }

  moveEnemy(e, dt) {
    let remain = this.speedOf(e) * dt;
    if (remain <= 0) return;
    if (e.flying) {
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
    let guard = 0;
    while (remain > 0 && guard++ < 8) {
      const tx = g.cx(e.target);
      const ty = g.cy(e.target);
      const dx = tx - e.x;
      const dy = ty - e.y;
      const d = Math.hypot(dx, dy);
      if (d <= remain) {
        e.x = tx;
        e.y = ty;
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
        const pdx = g.col(e.cur) - g.col(prev);
        const pdy = g.row(e.cur) - g.row(prev);
        const n = this.flow.next(e.cur, pdx, pdy);
        if (n < 0) return; // isolé (ne devrait pas arriver : la pose est validée)
        e.target = n;
      } else {
        e.x += (dx / d) * remain;
        e.y += (dy / d) * remain;
        if (Math.abs(dx) > 0.01) e.dirX = dx;
        remain = 0;
      }
    }
  }

  // Position d'un volant le long de sa ligne (légère ondulation).
  placeFlyer(e) {
    const k = e.flyLen > 0 ? e.s / e.flyLen : 1;
    const nx = -(e.fy1 - e.fy0) / (e.flyLen || 1);
    const ny = (e.fx1 - e.fx0) / (e.flyLen || 1);
    const wob = Math.sin(k * Math.PI * 3 + e.seed * 6) * 0.35 * Math.sin(k * Math.PI);
    e.x = e.fx0 + (e.fx1 - e.fx0) * k + nx * wob;
    e.y = e.fy0 + (e.fy1 - e.fy0) * k + ny * wob;
    e.dirX = e.fx1 - e.fx0;
  }

  // Recul (Vent) : le yokai est repoussé le long de son propre trajet.
  applyKnock(e, dt) {
    let remain = Math.min(e.knock, 6 * dt);
    e.knock -= remain;
    if (e.flying) {
      e.s = Math.max(0, e.s - remain);
      this.placeFlyer(e);
      return;
    }
    const g = this.grid;
    let guard = 0;
    while (remain > 0 && guard++ < 8) {
      // On recule d'abord vers le centre de la case courante, puis le long de la trace.
      let back = e.cur;
      const atCur = Math.hypot(g.cx(e.cur) - e.x, g.cy(e.cur) - e.y) < 1e-3;
      if (atCur) {
        back = e.trail[e.trail.length - 1];
        if (back == null || !g.isWalkable(back) || this.flow.dist[back] < 0) {
          e.knock = 0;
          return;
        }
      }
      const bx = g.cx(back);
      const by = g.cy(back);
      const d = Math.hypot(bx - e.x, by - e.y);
      if (d <= remain) {
        e.x = bx;
        e.y = by;
        remain -= d;
        if (back !== e.cur) {
          e.trail.pop();
          e.target = e.cur;
          e.cur = back;
        }
      } else {
        e.x += ((bx - e.x) / d) * remain;
        e.y += ((by - e.y) / d) * remain;
        remain = 0;
      }
    }
  }

  leak(e) {
    if (!e.alive) return;
    e.alive = false;
    const dmg = this.defs.enemies[e.type].damage ?? 1;
    this.lives = Math.max(0, this.lives - dmg);
    this.stats.leaks++;
    this.emit('leak', { enemy: e, damage: dmg });
    if (this.lives <= 0 && this.state !== 'lost') {
      this.state = 'lost';
      this.emit('lose', {});
    }
  }

  /**
   * Inflige des dégâts élémentaires.
   * opts : { pierce, dot, source }
   */
  damage(e, amount, element, opts = {}) {
    if (!e.alive || amount <= 0) return 0;
    if (e.absorb && e.absorb === element && e.blindT <= 0) {
      e.hp = Math.min(e.maxHp, e.hp + amount * 0.5);
      if (!opts.dot) this.emit('absorb', { enemy: e, element });
      return 0;
    }
    let mult = 1;
    if (e.armor > 0) mult *= 1 - e.armor * (1 - (opts.pierce ?? 0));
    if (e.shredT > 0) mult *= e.shredM;
    const dealt = amount * mult;
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
    this.gold += reward;
    this.stats.kills++;
    this.stats.goldEarned += reward;
    this.emit('kill', { enemy: e, reward, element });
    this.onKill(e, def);
  }

  // Effets à la mort (étendu plus loin : division…).
  onKill() {}

  immuneTo(e, element) {
    return e.absorb === element && e.blindT <= 0;
  }

  applySlow(e, factor, duration) {
    if (this.immuneTo(e, 'water')) return;
    if (e.slowT <= 0) e.slowF = factor;
    else e.slowF = Math.min(e.slowF, factor);
    e.slowT = Math.max(e.slowT, duration);
  }

  applyStun(e, duration) {
    const resist = this.defs.enemies[e.type].stunResist ?? 0;
    e.stunT = Math.max(e.stunT, duration * (1 - resist));
  }

  applyBurn(e, dps, duration) {
    if (this.immuneTo(e, 'fire')) return;
    e.burnDps = Math.max(e.burnT > 0 ? e.burnDps : 0, dps);
    e.burnT = Math.max(e.burnT, duration);
  }

  // ───────────────────────── lanternes ─────────────────────────

  updateTowers(dt) {
    for (const t of this.towers) this.updateTower(t, dt, 1);
  }

  canTarget(def, e) {
    if (!e.alive || e.spawnT > 0) return false;
    return e.flying ? def.targets.air : def.targets.ground;
  }

  findTarget(t, def, range) {
    let best = null;
    let bestRem = Infinity;
    for (const e of this.enemies) {
      if (!this.canTarget(def, e)) continue;
      const d = Math.hypot(e.x - t.x, e.y - t.y);
      if (d > range + e.size * 0.5) continue;
      const rem = this.remaining(e);
      if (rem < bestRem) {
        bestRem = rem;
        best = e;
      }
    }
    return best;
  }

  updateTower(t, dt, power) {
    if (t.shotT > 0) t.shotT -= dt;
    if (t.stunT > 0) {
      t.stunT -= dt;
      return;
    }
    t.cooldown -= dt;
    if (t.cooldown > 0) return;
    const def = this.defs.towers[t.type];
    const st = def.levels[t.level - 1];
    const target = this.findTarget(t, def, st.range);
    if (!target) {
      t.cooldown = 0;
      return;
    }
    t.cooldown += 1 / st.rate;
    if (t.cooldown < 0) t.cooldown = 1 / st.rate;
    t.angle = Math.atan2(target.y - t.y, target.x - t.x);
    t.shotT = 0.18;
    this.fire(t, def, st, target, power);
  }

  fire(t, def, st, target, power) {
    const lob = def.projectile === 'boulder';
    const p = {
      id: this.nextId++,
      kind: def.projectile,
      element: t.type,
      level: t.level,
      x: t.x,
      y: t.y - 0.25,
      sx: t.x,
      sy: t.y - 0.25,
      tx: target.x,
      ty: target.y,
      targetId: target.id,
      target,
      speed: st.projectileSpeed ?? 9,
      homing: !lob,
      lob,
      t: 0,
      dur: lob ? Math.max(0.35, Math.hypot(target.x - t.x, target.y - t.y) / (st.projectileSpeed ?? 5)) : 0,
      power,
      st,
      echo: power < 1,
      alive: true,
    };
    this.projectiles.push(p);
    this.emit('shoot', { tower: t, projectile: p, element: t.type, echo: p.echo });
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      if (p.lob) {
        p.t += dt;
        const k = Math.min(1, p.t / p.dur);
        p.x = p.sx + (p.tx - p.sx) * k;
        p.y = p.sy + (p.ty - p.sy) * k;
        p.h = Math.sin(k * Math.PI) * 1.1;
        if (k >= 1) this.impact(p, null);
        continue;
      }
      if (p.target && p.target.alive) {
        p.tx = p.target.x;
        p.ty = p.target.y;
      } else {
        p.target = null;
      }
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
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
    const st = p.st;
    const pw = p.power;
    const el = p.element;
    const opts = { pierce: st.pierce ?? 0 };
    if (st.splash) {
      for (const e of this.enemies) {
        if (!e.alive || e.spawnT > 0) continue;
        if (p.lob && e.flying) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d > st.splash + e.size * 0.5) continue;
        const main = e === target;
        const dmg = st.damage * pw * (main || p.lob ? 1 : 0.5);
        this.hitEffects(e, st, pw, el);
        this.damage(e, dmg * (e.flying ? st.airMultiplier ?? 1 : 1), el, opts);
      }
    } else if (target && target.alive) {
      this.hitEffects(target, st, pw, el);
      this.damage(target, st.damage * pw * (target.flying ? st.airMultiplier ?? 1 : 1), el, opts);
    }
    this.emit('hit', { x: p.x, y: p.y, element: el, level: p.level, splash: st.splash ?? 0, echo: p.echo });
  }

  hitEffects(e, st, pw, el) {
    if (!e.alive) return;
    if (st.burn) this.applyBurn(e, st.burn.dps * pw, st.burn.duration);
    if (st.slow) this.applySlow(e, 1 - (1 - st.slow.factor) * pw, st.slow.duration);
    if (st.stun && !this.immuneTo(e, 'earth')) this.applyStun(e, st.stun * pw);
    if (st.knockback && !this.immuneTo(e, 'wind')) {
      const resist = this.defs.enemies[e.type].knockResist ?? 0;
      e.knock = Math.max(e.knock, st.knockback * pw * (1 - resist));
    }
  }

  cleanup() {
    if (this.enemies.some((e) => !e.alive)) this.enemies = this.enemies.filter((e) => e.alive);
    if (this.projectiles.some((p) => !p.alive)) this.projectiles = this.projectiles.filter((p) => p.alive);
  }
}
