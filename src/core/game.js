// Moteur de simulation. Aucune dépendance au DOM : il tourne aussi bien dans le
// navigateur que dans Node (tools/sim.mjs). Le rendu et l'audio consomment la
// file `events` remplie pendant `update()`.

import { Grid, T } from './grid.js';
import { FlowField, bfs } from './flowfield.js';
import { Rng } from './rng.js';
import { buildComboIndex, computeZones, updateZones, updateTornadoes, comboKey } from './combos.js';

export const STEP = 1 / 60;
export const PRIORITIES = ['first', 'last', 'strong', 'close'];

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
    // Rembobinage
    this.echoes = []; // lanternes fantômes (50 % de puissance, durée limitée)
    this.history = []; // instantanés de la vague en cours
    this.historyT = 0;
    this.rewindUsed = false;
    this.rewindAnim = null;

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
    if (this.rewindAnim) return { ok: false, reason: 'rewinding' };
    const def = this.defs.towers[type];
    if (!def || !this.availableTowers.includes(type)) return { ok: false, reason: 'unknown' };
    if (!this.grid.inBounds(c, r)) return { ok: false, reason: 'bounds' };
    const i = this.grid.idx(c, r);
    if (this.grid.type(i) !== T.SLOT) return { ok: false, reason: 'slot' };
    if (this.towerAt(c, r)) return { ok: false, reason: 'occupied' };
    // Un écho occupe son socle jusqu'à sa disparition : on repose « ailleurs ».
    if (this.echoes.some((t) => t.c === c && t.r === r)) return { ok: false, reason: 'echo' };
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
      priority: def.priority ?? 'first',
    };
    this.towers.push(t);
    this.stats.towersBuilt++;
    this.emit('place', { tower: t });
    this.onTowersChanged();
    return t;
  }

  // ───────────────────────── priorités de ciblage ─────────────────────────

  setPriority(id, priority) {
    const t = this.towerById(id);
    if (!t || !PRIORITIES.includes(priority)) return false;
    t.priority = priority;
    this.emit('priority', { tower: t, priority });
    return true;
  }

  cyclePriority(id) {
    const t = this.towerById(id);
    if (!t) return null;
    const next = PRIORITIES[(PRIORITIES.indexOf(t.priority) + 1) % PRIORITIES.length];
    this.setPriority(id, next);
    return next;
  }

  // Annuler une pose récente : la lanterne disparaît, son prix est intégralement rendu.
  undoPlace(id, maxAge = 3) {
    const t = this.towerById(id);
    if (!t || t.level !== 1 || this.rewindAnim || this.time - t.bornAt > maxAge + 0.25) return false;
    this.towers = this.towers.filter((x) => x !== t);
    this.gold += t.invested;
    this.stats.towersBuilt = Math.max(0, this.stats.towersBuilt - 1);
    this.emit('undo', { tower: t, value: t.invested });
    this.onTowersChanged();
    return true;
  }

  // ───────────────────────── aperçus (sans effet de bord) ─────────────────────────

  // Combos qui naîtraient si l'on posait `type` en (c, r).
  previewCombos(type, c, r) {
    const out = [];
    for (const t of [...this.towers, ...this.echoes]) {
      if (t.type === type || Math.max(Math.abs(t.c - c), Math.abs(t.r - r)) !== 1) continue;
      const def = this.comboFor(type, t.type);
      if (def) out.push({ def, other: t });
    }
    return out;
  }

  // Conséquences d'une fusion : case libérée, combos perdus (lanterne source)
  // et combos renforcés (lanterne cible), niveau obtenu.
  previewFuse(srcId, dstId) {
    const check = this.canFuse(srcId, dstId);
    const src = this.towerById(srcId);
    const dst = this.towerById(dstId);
    if (!check.ok) return { ok: false, reason: check.reason };
    const lost = this.zones.filter((z) => (z.a === src.id || z.b === src.id) && z.a !== dst.id && z.b !== dst.id);
    const kept = this.zones.filter((z) => z.a === dst.id || z.b === dst.id);
    return { ok: true, level: dst.level + 1, freed: { c: src.c, r: src.r }, lost, kept };
  }

  // Chemin si l'on posait une pierre en (c, r) : validité, gain de cases et tracés.
  previewStone(c, r) {
    const check = this.canPlaceStone(c, r);
    const g = this.grid;
    if (!g.inBounds(c, r)) return { ok: false, reason: 'bounds', delta: 0, routes: [] };
    const i = g.idx(c, r);
    const dist = bfs(g, i);
    const routes = [];
    let len = 0;
    for (const s of g.spawns) {
      if (dist[s] < 0) continue;
      len += dist[s];
      routes.push(routeFrom(g, dist, s));
    }
    return { ok: check.ok, reason: check.reason, delta: check.ok || check.reason === 'gold' ? len - this.routeLength() : 0, routes };
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
    const bonus = this.state === 'build' && this.countdown != null ? Math.floor(this.countdown * this.rules.earlyBonusPerSecond) : 0;
    return { index: idx, groups: [...counts.values()], climax: !!wave.climax, countdown: this.countdown, bonus };
  }

  sellValue(t) {
    return Math.floor(t.invested * this.rules.sellRatio);
  }

  sellTower(id) {
    const t = this.towerById(id);
    if (!t || this.rewindAnim) return 0;
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
    if (this.rewindAnim) return { ok: false, reason: 'rewinding' };
    if (a.type !== b.type || a.level !== b.level) return { ok: false, reason: 'mismatch' };
    if (a.level >= this.maxLevelOf(a.type)) return { ok: false, reason: 'level' };
    return { ok: true };
  }

  // Niveau maximal d'une tour : borné par la règle globale ET par ses données.
  maxLevelOf(type) {
    return Math.min(this.rules.maxTowerLevel, this.defs.towers[type].levels.length);
  }

  // Glisser `src` sur `dst` : `src` disparaît, `dst` monte d'un niveau.
  fuse(srcId, dstId) {
    if (!this.canFuse(srcId, dstId).ok) return null;
    const src = this.towerById(srcId);
    const dst = this.towerById(dstId);
    const dstOldId = dst.id;
    this.towers = this.towers.filter((t) => t !== src);
    dst.level += 1;
    dst.invested += src.invested;
    dst.id = this.nextId++; // nouvelle identité : utile au rembobinage (écho)
    dst.bornAt = this.time;
    dst.cooldown = 0.3;
    this.emit('fuse', { tower: dst, from: { x: src.x, y: src.y }, level: dst.level, oldId: dstOldId, srcId });
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
    if (this.rewindAnim) return { ok: false, reason: 'rewinding' };
    const g = this.grid;
    if (!g.inBounds(c, r)) return { ok: false, reason: 'bounds' };
    const i = g.idx(c, r);
    if (g.type(i) !== T.OPEN) return { ok: false, reason: 'open' };
    if (g.stone[i]) return { ok: false, reason: 'occupied' };
    if (this.stonesPlaced >= conf.max) return { ok: false, reason: 'limit' };
    if (this.gold < conf.cost) return { ok: false, reason: 'gold' };
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
    if (!g.inBounds(c, r) || this.rewindAnim) return false;
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
    if (this.state !== 'build' || this.rewindAnim) return false;
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
    this.history = [];
    this.historyT = 0;
    this.rewindUsed = false;
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
    if (this.rewindAnim) {
      this.rewindAnim.t += dt;
      if (this.rewindAnim.t >= this.rewindAnim.dur) this.finishRewind();
      return;
    }
    this.time += dt;
    if (this.state === 'wave') {
      this.waveTime += dt;
      this.recordHistory(dt);
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
    const seed = this.rng.next();
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
      absorb: opts.absorb ?? def.abilities?.absorb ?? def.abilities?.cycleAbsorb?.elements[0] ?? null,
      hpMult: opts.hpMult ?? 1, // transmis aux enfants (division, invocation)
      groupAbsorb: opts.absorb ?? null,
      boss: !!def.boss,
      // Position logique sur la ligne centrale du chemin (mx, my) et couloir latéral
      // persistant : les yokai ne se superposent plus et restent dénombrables.
      mx: 0,
      my: 0,
      lane: opts.lane ?? (seed - 0.5) * 0.36,
      offX: 0,
      offY: 0,
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
      // Effets actifs (une entrée par source) : chaque effet expire pour son compte.
      slows: [],
      burns: [],
      shreds: [],
      pend: 0, // dégâts en route (projectiles guidés) : évite la surpuissance
      knock: 0,
      knockFatigue: 0, // rendements décroissants du recul
      stunFatigue: 0, // rendements décroissants des étourdissements
      healT: 0, // délai avant de pouvoir être soigné de nouveau (auras non cumulables)
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

  // Case marchable reliée au sanctuaire la plus proche d'un point.
  nearestWalkable(x, y) {
    const g = this.grid;
    let best = g.goals[0];
    let bd = Infinity;
    for (let i = 0; i < g.size; i++) {
      if (!g.isWalkable(i) || this.flow.dist[i] < 0) continue;
      const d = Math.hypot(g.cx(i) - x, g.cy(i) - y);
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
    return (d < 0 ? 999 : d) + Math.hypot(tx - e.mx, ty - e.my);
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
    if (e.knockFatigue > 0) e.knockFatigue = Math.max(0, e.knockFatigue - dt * (this.rules.knockFatigueDecay ?? 0.2));
    if (e.stunFatigue > 0) e.stunFatigue = Math.max(0, e.stunFatigue - dt * (this.rules.stunFatigueDecay ?? 0.35));
    if (e.healT > 0) e.healT -= dt;
    if (e.stunT > 0) e.stunT -= dt;
    if (e.blindT > 0) e.blindT -= dt;
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
    if (e.blindT > 0 || e.stunT > 0) return; // aveuglé (Vapeur) ou étourdi : pouvoirs suspendus
    if (ab.healAura) {
      tm.heal = (tm.heal ?? ab.healAura.interval * 0.5) - dt;
      if (tm.heal <= 0) {
        tm.heal += ab.healAura.interval;
        let healed = false;
        for (const o of this.enemies) {
          if (o === e || !o.alive || o.hp >= o.maxHp || o.healT > 0) continue;
          if (Math.hypot(o.x - e.x, o.y - e.y) > ab.healAura.radius) continue;
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
        for (let k = 0; k < ab.summon.count; k++) this.spawnChild(ab.summon.enemy, e, k, ab.summon.count);
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
        for (const t of this.towers) {
          if (Math.hypot(t.x - e.x, t.y - e.y) <= ab.stomp.radius) {
            t.stunT = Math.max(t.stunT, ab.stomp.stun);
            hit.push(t.id);
          }
        }
        this.emit('stomp', { enemy: e, radius: ab.stomp.radius, towers: hit });
      }
    }
  }

  // Fait apparaître un yokai à la position d'un autre (division, invocation).
  spawnChild(type, parent, k = 0, n = 1) {
    // Couloirs opposés et apparitions décalées : les enfants restent distincts.
    const lane = n > 1 ? Math.max(-0.2, Math.min(0.2, (k - (n - 1) / 2) * 0.4)) : parent.lane;
    const e = this.createEnemy(type, {
      spawnT: 0.25 + k * 0.2,
      hpMult: parent.hpMult,
      absorb: parent.groupAbsorb ?? undefined,
      lane,
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
        e.flyLen = Math.hypot(e.fx1 - e.fx0, e.fy1 - e.fy0);
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
      const dx = tx - e.mx;
      const dy = ty - e.my;
      const d = Math.hypot(dx, dy);
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

  // Décale le yokai sur son couloir, perpendiculairement à sa marche (lissé).
  applyLane(e, dt) {
    const g = this.grid;
    let dx = g.cx(e.target) - e.mx;
    let dy = g.cy(e.target) - e.my;
    const d = Math.hypot(dx, dy);
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
    const wob = Math.sin(k * Math.PI * 3 + e.seed * 6) * 0.35 * Math.sin(k * Math.PI);
    e.x = e.mx = e.fx0 + (e.fx1 - e.fx0) * k + nx * wob;
    e.y = e.my = e.fy0 + (e.fy1 - e.fy0) * k + ny * wob;
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
      // Au centre, la case précédente de la trace devient aussitôt la case courante
      // (le yokai repart vers elle ; canPlaceStone la protège donc des pierres).
      if (Math.hypot(g.cx(e.cur) - e.mx, g.cy(e.cur) - e.my) < 1e-3) {
        const back = e.trail[e.trail.length - 1];
        if (back == null || !g.isWalkable(back) || this.flow.dist[back] < 0) {
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
      const d = Math.hypot(bx - e.mx, by - e.my);
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
    if (!e.alive || !(amount > 0) || !Number.isFinite(amount)) return 0;
    if (e.absorb && e.absorb === element && e.blindT <= 0) {
      // Un coup de son élément le soigne ; une brûlure résiduelle s'éteint simplement.
      if (opts.dot) return 0;
      e.hp = Math.min(e.maxHp, e.hp + amount * 0.5);
      this.emit('absorb', { enemy: e, element });
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

  // Effets à la mort.
  onKill(e, def) {
    const split = def.abilities?.split;
    if (split) {
      for (let k = 0; k < split.count; k++) this.spawnChild(split.into, e, k, split.count);
      this.emit('split', { enemy: e });
    }
  }

  // ───────────────────────── rembobinage ─────────────────────────

  get rewindEnabled() {
    return !!this.level.rewind;
  }

  recordHistory(dt) {
    if (!this.rewindEnabled || this.rewindUsed) return;
    this.historyT -= dt;
    if (this.historyT > 0) return;
    this.historyT += this.rules.snapshotInterval ?? 0.1;
    this.history.push(this.snapshot());
    const keep = (this.rules.rewindSeconds ?? 6) + 0.25;
    while (this.history.length > 2 && this.waveTime - this.history[1].wt >= keep) this.history.shift();
  }

  // Secondes de passé disponibles (0..rewindSeconds).
  rewindAvailable() {
    if (!this.history.length) return 0;
    return Math.min(this.rules.rewindSeconds ?? 6, this.waveTime - this.history[0].wt);
  }

  canRewind() {
    return (
      this.rewindEnabled &&
      this.state === 'wave' &&
      !this.rewindUsed &&
      !this.rewindAnim &&
      this.rewindAvailable() >= 1
    );
  }

  snapshot() {
    return {
      wt: this.waveTime,
      gold: this.gold,
      lives: this.lives,
      stonesPlaced: this.stonesPlaced,
      stats: { ...this.stats },
      stones: Uint8Array.from(this.grid.stone),
      enemies: this.enemies.map(cloneEnemy),
      towers: this.towers.map((t) => ({ ...t })),
      spawners: this.spawners.map((sp) => ({ ...sp })),
      tornadoes: this.tornadoes.map((t) => ({ ...t })),
      zoneTimers: this.zones.map((z) => [z.key, z.timer]),
    };
  }

  rewind() {
    if (!this.canRewind()) return false;
    const target = this.waveTime - (this.rules.rewindSeconds ?? 6);
    let idx = this.history.findIndex((h) => h.wt >= target - 1e-6);
    if (idx < 0) idx = 0;
    const snap = this.history[idx];
    const frames = [{ enemies: this.enemies.map(cloneEnemy) }, ...this.history.slice(idx).reverse()];
    const snapIds = new Set(snap.towers.map((t) => t.id));
    this.rewindAnim = {
      t: 0,
      dur: this.rules.rewindAnimDuration ?? 1.1,
      frames,
      snap,
      idx,
      seconds: this.waveTime - snap.wt,
      ghosts: this.towers.filter((t) => !snapIds.has(t.id)).map((t) => t.id),
    };
    this.rewindUsed = true;
    this.projectiles = [];
    this.emit('rewindStart', { seconds: this.rewindAnim.seconds });
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
    this.enemies = snap.enemies.map(cloneEnemy);
    for (const e of this.enemies) {
      e.px = e.x;
      e.py = e.y;
    }
    this.spawners = snap.spawners.map((sp) => ({ ...sp }));
    this.gold = snap.gold;
    this.lives = snap.lives;
    // Les lanternes construites restent comptées (statistique de fin de partie).
    this.stats = { ...snap.stats, towersBuilt: this.stats.towersBuilt };
    this.grid.stone.set(snap.stones);
    this.stonesPlaced = snap.stonesPlaced;
    this.flow.compute();
    this.waveTime = snap.wt;
    this.projectiles = [];
    for (const e of this.enemies) e.pend = 0;
    this.tornadoes = (snap.tornadoes || []).map((t) => ({ ...t }));
    this.history = this.history.slice(0, idx + 1);
    this.rewindAnim = null;
    this.onTowersChanged();
    const timers = new Map(snap.zoneTimers || []);
    for (const z of this.zones) if (timers.has(z.key)) z.timer = timers.get(z.key);
    this.emit('rewindEnd', { echoes: this.echoes.length });
  }

  // Un yokai est insensible aux effets de l'élément qu'il absorbe (sauf aveuglé).
  // `element` = élément de la SOURCE de l'effet ; null pour un combo (deux éléments).
  immuneTo(e, element) {
    return !!element && e.absorb === element && e.blindT <= 0;
  }

  applySlow(e, factor, duration, element = 'water') {
    if (this.immuneTo(e, element)) return;
    // Plancher : un yokai ralenti avance toujours (voir minSlowFactor dans data/rules.js).
    addEffect(e.slows, Math.max(this.rules.minSlowFactor ?? 0.35, factor), duration);
    refreshStatus(e);
  }

  applyShred(e, mult, duration) {
    addEffect(e.shreds, mult, duration);
    refreshStatus(e);
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
  // indéfiniment (sinon une vague pourrait ne jamais finir).
  applyKnockback(e, amount, element = 'wind') {
    if (amount <= 0 || this.immuneTo(e, element)) return;
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
      const d = Math.hypot(e.x - t.x, e.y - t.y);
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
    const target = this.findTarget(t, def, st.range, !st.splash);
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
      pend: 0,
    };
    if (!lob && !st.splash) {
      // estimation des dégâts du coup (armure comprise) réservés sur la cible
      p.pend = this.estimateHit(target, st, power, t.type);
      target.pend += p.pend;
    }
    this.projectiles.push(p);
    this.emit('shoot', { tower: t, projectile: p, element: t.type, echo: p.echo });
  }

  estimateHit(e, st, power, element) {
    if (e.absorb === element && e.blindT <= 0) return 0;
    let dmg = (st.damage ?? 0) * power * (e.flying ? st.airMultiplier ?? 1 : 1);
    if (e.armor > 0) dmg *= 1 - e.armor * (1 - (st.pierce ?? 0));
    if (e.shredT > 0) dmg *= e.shredM;
    return dmg;
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
        if (p.target) p.target.pend = Math.max(0, p.target.pend - p.pend);
        p.pend = 0;
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
    if (p.pend && p.target) p.target.pend = Math.max(0, p.target.pend - p.pend);
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
        const dmg = (st.damage ?? 0) * pw * (main || p.lob ? 1 : 0.5);
        this.hitEffects(e, st, pw, el);
        this.damage(e, dmg * (e.flying ? st.airMultiplier ?? 1 : 1), el, opts);
      }
    } else if (target && target.alive) {
      this.hitEffects(target, st, pw, el);
      this.damage(target, (st.damage ?? 0) * pw * (target.flying ? st.airMultiplier ?? 1 : 1), el, opts);
    }
    this.emit('hit', { x: p.x, y: p.y, element: el, level: p.level, splash: st.splash ?? 0, echo: p.echo });
  }

  // Effets à l'impact : l'immunité dépend de l'élément de la tour qui tire.
  hitEffects(e, st, pw, el) {
    if (!e.alive) return;
    if (st.burn) this.applyBurn(e, st.burn.dps * pw, st.burn.duration, el);
    if (st.slow) this.applySlow(e, 1 - (1 - st.slow.factor) * pw, st.slow.duration, el);
    if (st.stun) this.applyStun(e, st.stun * pw, el);
    if (st.knockback) this.applyKnockback(e, st.knockback * pw, el);
  }

  cleanup() {
    if (this.enemies.some((e) => !e.alive)) this.enemies = this.enemies.filter((e) => e.alive);
    if (this.projectiles.some((p) => !p.alive)) this.projectiles = this.projectiles.filter((p) => p.alive);
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

// Tracé d'une apparition au sanctuaire selon un champ de distances donné.
function routeFrom(g, dist, start) {
  const out = [start];
  let i = start;
  for (let guard = 0; guard < g.size; guard++) {
    const d = dist[i];
    if (d <= 0) break;
    const c = g.col(i);
    const r = g.row(i);
    let next = -1;
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const nc = c + dx;
      const nr = r + dy;
      if (!g.inBounds(nc, nr)) continue;
      const n = g.idx(nc, nr);
      if (dist[n] === d - 1) {
        next = n;
        break;
      }
    }
    if (next < 0) break;
    out.push(next);
    i = next;
  }
  return out;
}
