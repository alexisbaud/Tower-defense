// Bots joueurs pour le simulateur. Ils n'utilisent que l'API publique du moteur
// (placeTower, fuse, placeStone, startNextWave, rewind…), comme le ferait l'UI.
//
// Stratégies :
//   smart  — couverture du chemin, mélange d'éléments, combos, fusions, pierres, rembobinage
//   basic  — couverture du chemin, sans fusion/pierre/rembobinage
//   lazy   — trois lanternes de Feu puis plus rien (doit perdre les niveaux avancés)

import { T } from '../src/core/grid.js';

export function bot(strategy, game) {
  const log = [];
  const g = game.grid;
  let nextDecision = 0;
  let lastLives = game.lives;

  const opt = {
    smart: { fuse: true, stones: true, rewind: true, combos: true, maxTowers: 99 },
    basic: { fuse: false, stones: false, rewind: false, combos: false, maxTowers: 99 },
    lazy: { fuse: false, stones: false, rewind: false, combos: false, maxTowers: 3, only: 'fire' },
  }[strategy];

  // Cases de chemin actuellement empruntées par les yokai terrestres.
  function routeTiles() {
    const set = new Map();
    for (const s of g.spawns) {
      for (const i of game.flow.route(s)) set.set(i, (set.get(i) || 0) + 1);
    }
    return set;
  }

  function coverage(c, r, range, tiles) {
    let n = 0;
    for (const [i, w] of tiles) {
      const d = Math.hypot(g.cx(i) - (c + 0.5), g.cy(i) - (r + 0.5));
      if (d <= range) n += w;
    }
    return n;
  }

  function upcomingHasAir() {
    for (let w = game.waveIndex; w < game.waves.length && w <= game.waveIndex + 2; w++) {
      if (w < 0) continue;
      for (const gr of game.waves[w].groups) if (game.defs.enemies[gr.enemy]?.abilities?.flying) return true;
    }
    return false;
  }

  function pickType() {
    const avail = game.availableTowers.filter((t) => !opt.only || t === opt.only);
    const counts = {};
    for (const t of game.towers) counts[t.type] = (counts[t.type] || 0) + 2 ** (t.level - 1);
    // Poids souhaités : beaucoup de dégâts, un peu de contrôle.
    const want = { fire: 3, water: 1.2, wind: 1.2, earth: 2 };
    if (upcomingHasAir()) {
      want.fire += 1;
      want.wind += 1;
    }
    let best = avail[0];
    let bestScore = -Infinity;
    for (const t of avail) {
      const score = (want[t] ?? 1) / (1 + (counts[t] || 0));
      if (score > bestScore && game.gold >= game.defs.towers[t].cost) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  function bestSlot(type) {
    const tiles = routeTiles();
    const def = game.defs.towers[type];
    const range = def.levels[0].range;
    let best = null;
    let bestScore = 0;
    for (let i = 0; i < g.size; i++) {
      if (g.type(i) !== T.SLOT) continue;
      const c = g.col(i);
      const r = g.row(i);
      if (game.towerAt(c, r)) continue;
      let score = coverage(c, r, range, tiles);
      if (opt.combos && game.comboFor) {
        for (const t of game.towers) {
          if (Math.max(Math.abs(t.c - c), Math.abs(t.r - r)) === 1 && t.type !== type && game.comboFor(t.type, type)) score += 3;
        }
      }
      // Légère préférence pour les cases proches du sanctuaire (dernière ligne de défense).
      if (score > bestScore) {
        bestScore = score;
        best = { c, r };
      }
    }
    return best;
  }

  function tryFuse() {
    if (!opt.fuse || !game.fuse) return false;
    for (let lvl = 1; lvl < game.rules.maxTowerLevel; lvl++) {
      for (const type of Object.keys(game.defs.towers)) {
        const list = game.towers.filter((t) => t.type === type && t.level === lvl);
        if (list.length >= 2) {
          const tiles = routeTiles();
          const range = game.defs.towers[type].levels[lvl].range;
          list.sort((a, b) => coverage(b.c, b.r, range, tiles) - coverage(a.c, a.r, range, tiles));
          const dst = list[0];
          const src = list[list.length - 1];
          if (game.fuse(src.id, dst.id)) {
            log.push(`t=${game.time.toFixed(1)} fusion ${type} -> N${lvl + 1}`);
            return true;
          }
        }
      }
    }
    return false;
  }

  function tryStone() {
    if (!opt.stones || !game.placeStone || !game.level.stones) return false;
    const cost = game.stoneCost();
    if (game.gold < cost + 40) return false;
    const base = routeLength();
    let best = -1;
    let bestGain = 0;
    for (let i = 0; i < g.size; i++) {
      if (g.type(i) !== T.OPEN || g.stone[i]) continue;
      if (!game.canPlaceStone(g.col(i), g.row(i)).ok) continue;
      g.stone[i] = 1;
      game.flow.compute();
      const len = routeLength();
      g.stone[i] = 0;
      game.flow.compute();
      if (len - base > bestGain) {
        bestGain = len - base;
        best = i;
      }
    }
    if (best >= 0 && bestGain >= 1) {
      game.placeStone(g.col(best), g.row(best));
      log.push(`t=${game.time.toFixed(1)} pierre (${g.col(best)},${g.row(best)}) +${bestGain}`);
      return true;
    }
    return false;
  }

  function routeLength() {
    let total = 0;
    for (const s of g.spawns) total += game.flow.dist[s];
    return total;
  }

  function spend() {
    let guard = 0;
    while (guard++ < 30) {
      if (tryFuse()) continue;
      if (tryStone()) continue;
      if (game.towers.length >= opt.maxTowers) break;
      const type = pickType();
      if (!type || game.gold < game.defs.towers[type].cost) break;
      const slot = bestSlot(type);
      if (!slot) break;
      game.placeTower(type, slot.c, slot.r);
      log.push(`t=${game.time.toFixed(1)} pose ${type} (${slot.c},${slot.r})`);
    }
  }

  return {
    log,
    tick(t) {
      if (t < nextDecision) return;
      nextDecision = t + 0.5;
      spend();
      if (opt.rewind && game.canRewind && game.lives < lastLives && game.canRewind()) {
        game.rewind();
        log.push(`t=${game.time.toFixed(1)} rembobinage`);
        spend();
      }
      lastLives = game.lives;
      if (game.state === 'build') game.startNextWave();
    },
  };
}
