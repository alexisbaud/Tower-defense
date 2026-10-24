// Combos élémentaires : détection des paires adjacentes et effets de zone.

export function comboKey(a, b) {
  return a < b ? `${a}+${b}` : `${b}+${a}`;
}

export function buildComboIndex(combos) {
  const map = new Map();
  for (const c of combos || []) map.set(comboKey(c.elements[0], c.elements[1]), c);
  return map;
}

// Recalcule toutes les zones de synergie à partir des lanternes posées.
export function computeZones(game) {
  const old = new Map(game.zones.map((z) => [z.key, z]));
  const zones = [];
  const towers = game.towers;
  const bonus = game.rules.comboLevelBonus ?? 0.4;
  for (let i = 0; i < towers.length; i++) {
    for (let j = i + 1; j < towers.length; j++) {
      const a = towers[i];
      const b = towers[j];
      if (a.type === b.type) continue;
      if (Math.max(Math.abs(a.c - b.c), Math.abs(a.r - b.r)) !== 1) continue;
      const def = game.comboIndex.get(comboKey(a.type, b.type));
      if (!def) continue;
      // Clé stable (combo + socles) : une fusion ou un rembobinage change les ids des
      // lanternes, mais la zone reste la même (minuterie conservée, pas de nouvelle annonce).
      const [p, q] = a.c * 100 + a.r < b.c * 100 + b.r ? [a, b] : [b, a];
      const key = `${def.id}@${p.c},${p.r}-${q.c},${q.r}`;
      const avg = (a.level + b.level) / 2;
      const mult = 1 + bonus * (avg - 1);
      const prev = old.get(key);
      zones.push({
        key,
        def,
        a: a.id,
        b: b.id,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        radius: def.radius + 0.2 * (avg - 1),
        mult,
        timer: prev ? prev.timer : 0,
        born: prev ? prev.born : game.time,
        pulseT: prev ? prev.pulseT : 0,
      });
      if (!prev) game.emit('combo', { def, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, a, b });
    }
  }
  game.zones = zones;
}

function inZone(z, e) {
  return Math.hypot(e.x - z.x, e.y - z.y) <= z.radius + e.size * 0.5;
}

// Statuts d'un combo : deux éléments mêlés, donc aucune immunité d'absorption
// (seuls les dégâts typés, plus bas, peuvent être absorbés).
export function applyStatus(game, e, status, mult, groundOnly, duration) {
  if (groundOnly && e.flying) return;
  if (status.blind) e.blindT = Math.max(e.blindT, Math.max(duration, status.blind));
  if (status.slow) {
    const f = 1 - (1 - status.slow) * Math.min(1.6, mult); // plancher appliqué par applySlow
    game.applySlow(e, f, Math.max(duration, 0.3), null);
  }
  if (status.burn) game.applyBurn(e, status.burn.dps * mult, Math.max(duration, status.burn.duration), null);
  if (status.stun) game.applyStun(e, status.stun * Math.sqrt(mult), null);
  if (status.shred) game.applyShred(e, 1 + (status.shred.mult - 1) * mult, Math.max(duration, status.shred.duration));
}

export function updateZones(game, dt) {
  for (const z of game.zones) {
    const fx = z.def.effect;
    if (fx.kind === 'aura') {
      z.timer -= dt;
      if (z.timer > 0) continue;
      z.timer += fx.tick;
      for (const e of game.enemies) {
        if (!e.alive || e.spawnT > 0 || !inZone(z, e)) continue;
        applyStatus(game, e, fx.status, z.mult, fx.groundOnly, fx.tick + 0.1);
      }
    } else if (fx.kind === 'pulse') {
      z.timer += dt;
      if (z.timer < fx.interval) continue;
      let hit = false;
      for (const e of game.enemies) {
        if (!e.alive || e.spawnT > 0 || !inZone(z, e)) continue;
        if (fx.groundOnly && e.flying) continue;
        hit = true;
      }
      if (!hit) {
        z.timer = fx.interval; // prête : se déclenche dès qu'un yokai entre
        continue;
      }
      z.timer = 0;
      for (const e of game.enemies) {
        if (!e.alive || e.spawnT > 0 || !inZone(z, e)) continue;
        if (fx.groundOnly && e.flying) continue;
        applyStatus(game, e, fx.status, z.mult, false, 0);
        // dégâts typés par l'élément déclaré du combo (ex. Givre : eau)
        if (fx.damage) game.damage(e, fx.damage * z.mult, fx.element ?? z.def.elements[0], {});
      }
      game.emit('pulse', { zone: z });
    } else if (fx.kind === 'tornado') {
      z.timer += dt;
      if (z.timer < fx.interval) continue;
      const any = game.enemies.some((e) => e.alive && e.spawnT <= 0 && Math.hypot(e.x - z.x, e.y - z.y) <= z.radius + 1);
      if (!any) {
        z.timer = fx.interval;
        continue;
      }
      z.timer = 0;
      const t = {
        id: game.nextId++,
        zone: z.key,
        cx: z.x,
        cy: z.y,
        orbit: z.radius * 0.7,
        angle: game.rng.next() * Math.PI * 2,
        life: fx.duration,
        max: fx.duration,
        dps: fx.dps * z.mult,
        size: fx.size,
        speed: fx.speed,
        knockback: fx.knockback ?? 0,
        x: z.x,
        y: z.y,
        color: z.def.color,
      };
      game.tornadoes.push(t);
      game.emit('tornado', { tornado: t });
    }
  }
}

export function updateTornadoes(game, dt) {
  for (const t of game.tornadoes) {
    t.life -= dt;
    t.angle += (t.speed / Math.max(0.5, t.orbit)) * dt;
    t.x = t.cx + Math.cos(t.angle) * t.orbit;
    t.y = t.cy + Math.sin(t.angle) * t.orbit * 0.85;
    for (const e of game.enemies) {
      if (!e.alive || e.spawnT > 0) continue;
      if (Math.hypot(e.x - t.x, e.y - t.y) > t.size + e.size * 0.5) continue;
      game.applyBurn(e, t.dps * 0.25, 1, 'fire');
      game.damage(e, t.dps * dt, 'fire', { dot: true });
      if (t.knockback && e.knock <= 0) game.applyKnockback(e, t.knockback);
    }
  }
  if (game.tornadoes.some((t) => t.life <= 0)) game.tornadoes = game.tornadoes.filter((t) => t.life > 0);
}
