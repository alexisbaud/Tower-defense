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

  // Analyse des prochaines vagues : volants, carapaces, absorptions, boss.
  function upcoming() {
    const info = { air: 0, armor: 0, boss: 0, absorb: {}, total: 0 };
    const from = Math.max(0, game.state === 'wave' ? game.waveIndex : game.waveIndex + 1);
    for (let w = from; w < game.waves.length && w <= from + 1; w++) {
      for (const gr of game.waves[w].groups) {
        const d = game.defs.enemies[gr.enemy];
        if (!d) continue;
        const n = gr.count;
        info.total += n;
        if (d.abilities?.flying) info.air += n;
        if (d.abilities?.armor) info.armor += n;
        if (d.boss) info.boss += 1;
        const ab = gr.absorb ?? d.abilities?.absorb;
        if (ab) info.absorb[ab] = (info.absorb[ab] || 0) + n;
      }
    }
    return info;
  }

  function pickType() {
    const avail = game.availableTowers.filter((t) => !opt.only || t === opt.only);
    const counts = {};
    for (const t of game.towers) counts[t.type] = (counts[t.type] || 0) + 2 ** (t.level - 1);
    const info = upcoming();
    const want = { fire: 3, water: 1.3, wind: 1.1, earth: 2.2 };
    if (info.total) {
      want.wind += (3 * info.air) / info.total;
      want.fire += (2 * info.air) / info.total;
      want.earth += (3 * info.armor) / info.total;
      if (info.air / info.total > 0.6) want.earth *= 0.3;
      for (const [el, n] of Object.entries(info.absorb)) if (want[el]) want[el] *= Math.max(0.15, 1 - (1.5 * n) / info.total);
    }
    if (info.boss) {
      want.fire += 1;
      want.earth += 1;
    }
    let best = null;
    let bestScore = -Infinity;
    for (const t of avail) {
      const score = (want[t] ?? 1) / (1 + (counts[t] || 0));
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  // Points échantillonnés sur les lignes de vol S→G (pondérés si des volants arrivent).
  function flightPoints() {
    const info = upcoming();
    if (!info.air || !info.total) return [];
    const w = (1.5 * info.air) / info.total;
    const pts = [];
    for (const s of g.spawns) {
      const goal = game.nearestGoal(g.cx(s), g.cy(s));
      const x0 = g.cx(s);
      const y0 = g.cy(s);
      const x1 = g.cx(goal);
      const y1 = g.cy(goal);
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
      for (let k = 0; k <= n; k++) pts.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, w]);
    }
    return pts;
  }

  function bestSlot(type) {
    const tiles = routeTiles();
    const def = game.defs.towers[type];
    const range = def.levels[0].range;
    const air = def.targets.air ? flightPoints() : [];
    let best = null;
    let bestScore = 0;
    for (let i = 0; i < g.size; i++) {
      if (g.type(i) !== T.SLOT) continue;
      const c = g.col(i);
      const r = g.row(i);
      if (game.towerAt(c, r)) continue;
      let score = coverage(c, r, range, tiles);
      for (const [x, y, w] of air) if (Math.hypot(x - (c + 0.5), y - (r + 0.5)) <= range) score += w * 0.5;
      if (opt.combos && game.comboFor) {
        for (const t of game.towers) {
          if (Math.max(Math.abs(t.c - c), Math.abs(t.r - r)) === 1 && t.type !== type && game.comboFor(t.type, type)) score += 3;
        }
      }
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
    if (!opt.stones || !game.placeStone || !game.level.stones || game.towers.length < 2) return false;
    const cost = game.stoneCost();
    if (game.stonesLeft() <= 0 || game.gold < cost + 30) return false;
    const base = routeLength();
    const cands = [];
    for (let i = 0; i < g.size; i++) {
      if (g.type(i) !== T.OPEN || g.stone[i]) continue;
      if (game.canPlaceStone(g.col(i), g.row(i)).ok) cands.push(i);
    }
    const lenWith = (list) => {
      for (const i of list) g.stone[i] = 1;
      game.flow.compute();
      let ok = g.spawns.every((s) => game.flow.dist[s] >= 0);
      const len = ok ? routeLength() : -1;
      for (const i of list) g.stone[i] = 0;
      game.flow.compute();
      return len;
    };
    let best = -1;
    let bestGain = 0;
    for (const i of cands) {
      const gain = lenWith([i]) - base;
      if (gain > bestGain) {
        bestGain = gain;
        best = i;
      }
    }
    // Aucun gain immédiat : on regarde les paires (un seul caillou ne suffit pas toujours).
    if (best < 0 && game.stonesLeft() >= 2 && game.gold >= cost * 2 + 30) {
      for (let a = 0; a < cands.length; a++) {
        for (let b = a + 1; b < cands.length; b++) {
          const gain = lenWith([cands[a], cands[b]]) - base;
          if (gain > bestGain) {
            bestGain = gain;
            best = cands[a];
          }
        }
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
