// Bots joueurs pour le simulateur. Ils n'utilisent que l'API publique du moteur
// (placeTower, fuse, placeStone, startNextWave, rewind…), comme le ferait l'UI.
//
// Stratégies :
//   balanced     mélange d'éléments selon les yokai annoncés (contres, combos, soutiens,
//                barrières), fusions, pierres, rembobinage — le joueur appliqué :
//                il diversifie ses éléments (kitsune), renforce l'antiaérien quand les
//                volants annoncés dépassent sa défense, passe ses arcs en priorité
//                « premier » face aux volants, ne choisit que des lanternes qui ont un
//                socle libre (socles typés) et respecte le défi « N lanternes »
//   mono:<type>  une seule lanterne, posée et fusionnée partout (doit perdre dès le niveau 2)
//   random       lanternes et socles au hasard, sans pierre (indicatif)
//   smart        alias de balanced
//
// En coopération, chaque joueur a son propre bot : bot(strategy, game, { pid }).

import { T } from '../src/core/grid.js';
import { Rng } from '../src/core/rng.js';

export function bot(strategy, game, opts = {}) {
  const log = [];
  const g = game.grid;
  const pid = opts.pid ?? 0;
  const rng = new Rng(opts.seed ?? 11 + pid * 101);
  let nextDecision = 0;
  let lastLives = game.lives;

  const mono = strategy.startsWith('mono:') ? strategy.slice(5) : null;
  const opt = {
    balanced: { fuse: true, stones: true, rewind: true, combos: true, support: true },
    smart: { fuse: true, stones: true, rewind: true, combos: true, support: true },
    random: { fuse: true, stones: false, rewind: true, combos: false, support: false, random: true },
  }[mono ? 'mono' : strategy] ?? { fuse: true, stones: true, rewind: true, combos: false, support: false };
  // Le bot mono joue aussi bien que le bot équilibré (fusions, pierres, rembobinage) :
  // s'il perd, c'est bien que la lanterne seule ne suffit pas.

  const defs = game.defs;
  const gold = () => game.goldOf(pid);
  const available = () => game.towersFor(pid).filter((t) => !mono || t === mono);
  const attackOf = (def) => def.attack ?? 'projectile';
  const isSupport = (type) => ['support', 'barrier'].includes(attackOf(defs.towers[type]));

  // ───────── lecture de la carte ─────────

  // Cases du trajet actuel des yokai terrestres (poids = nombre de trajets).
  function routeTiles() {
    const m = new Map();
    for (const s of g.spawns) for (const i of game.flow.route(s)) m.set(i, (m.get(i) || 0) + 1);
    return m;
  }

  function flightPoints() {
    const pts = [];
    for (const s of g.spawns) {
      const goal = game.nearestGoal(g.cx(s), g.cy(s));
      const x0 = g.cx(s);
      const y0 = g.cy(s);
      const x1 = g.cx(goal);
      const y1 = g.cy(goal);
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
      for (let k = 0; k <= n; k++) pts.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
    }
    return pts;
  }

  // ───────── lecture des vagues annoncées ─────────

  // Composition des deux prochaines vagues : [{ def, absorb, hp }] (PV totaux par groupe).
  function upcoming() {
    const out = [];
    const from = game.waveIndex + 1;
    const start = game.enemies.length ? Math.max(0, game.waveIndex) : from;
    for (let w = start; w < game.waves.length && w <= from + 1; w++) {
      for (const gr of game.waves[w].groups) {
        const def = defs.enemies[gr.enemy];
        if (!def) continue;
        out.push({ def, absorb: gr.absorb ?? def.abilities?.absorb ?? null, hp: def.hp * (gr.hp ?? 1) * gr.count, unit: def.hp * (gr.hp ?? 1) * game.hpScale, count: gr.count, interval: gr.interval ?? 1 });
        const split = def.abilities?.split;
        if (split) out.push({ def: defs.enemies[split.into], absorb: null, hp: defs.enemies[split.into].hp * split.count * gr.count * (gr.hp ?? 1) });
      }
    }
    return out;
  }

  // Dégâts par seconde estimés d'une lanterne contre un yokai (armure, résistances,
  // cibles possibles, absorption) ; les attaques de zone comptent plus.
  function dpsVs(type, level, edef, absorb) {
    const def = defs.towers[type];
    const st = def.levels[Math.min(level, def.levels.length) - 1];
    const el = def.element;
    const atk = attackOf(def);
    if (atk === 'support' || atk === 'barrier') return 0;
    if (absorb === el) return 0;
    const flying = !!edef.abilities?.flying;
    const tg = def.targets ?? { ground: true, air: true };
    if (flying ? !tg.air : !tg.ground) return 0;
    const resist = edef.resist?.[el] ?? 0;
    const armor = edef.armor ?? 0;
    const per = (dmg) => {
      let d = dmg * (1 - resist);
      if (armor > 0) d = Math.max(d * 0.2, d - armor * (1 - (st.pierce ?? 0)));
      return Math.max(0, d);
    };
    let dps = atk === 'aura' ? (st.auraDps ?? 0) * (1 - resist) : per(st.damage ?? 0) * (st.rate ?? 1) * (flying ? st.airMultiplier ?? 1 : 1);
    if (st.burn && edef.abilities?.absorb !== 'fire') dps += st.burn.dps * (1 - (edef.resist?.fire ?? 0)) * 0.8;
    const zone = st.splash ? 1.7 : atk === 'beam' ? 1.6 : atk === 'pulse' ? 1.8 : atk === 'aura' ? 1.4 : 1;
    let util = 1;
    if (st.slow && edef.speed >= 1.2 && (edef.resist?.water ?? 0) < 1) util += 0.35;
    if (st.knockback && !edef.abilities?.timeless) util += 0.15;
    if (st.stun) util += 0.2;
    if (st.armorBreak && armor > 0) util += 0.5;
    return dps * zone * util;
  }

  // Défense antiaérienne : dégâts qu'encaisse un volant pendant sa traversée, sur la
  // ligne de vol la moins couverte (lanternes de tous les joueurs).
  function airCover() {
    let worst = Infinity;
    for (const s of g.spawns) {
      const goal = game.nearestGoal(g.cx(s), g.cy(s));
      const x0 = g.cx(s), y0 = g.cy(s), x1 = g.cx(goal), y1 = g.cy(goal);
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
      let dmg = 0;
      for (const t of game.towers) {
        const def = defs.towers[t.type];
        const tg = def.targets ?? { ground: true, air: true };
        if (!tg.air || isSupport(t.type)) continue;
        const st = game.towerStats(t);
        let k = 0;
        for (let j = 0; j <= n; j++) if (Math.hypot(x0 + ((x1 - x0) * j) / n - t.x, y0 + ((y1 - y0) * j) / n - t.y) <= st.range) k++;
        const dps = (st.damage ?? 0) * (st.airMultiplier ?? 1) * (st.rate ?? 1) * (t.rateMult || 1) + (st.auraDps ?? 0) + (st.burn?.dps ?? 0);
        dmg += (dps * k * 0.5) / 1.2; // k points espacés d'une demi-case, volant à ~1,2 case/s
      }
      worst = Math.min(worst, dmg);
    }
    return worst;
  }

  // Volants annoncés plus robustes que la défense antiaérienne : leur poids triple.
  // Besoin : PV des volants d'un groupe présents en même temps sur la ligne de vol.
  function airBoost(list) {
    const flight = Math.max(4, ...g.spawns.map((s) => { const gl = game.nearestGoal(g.cx(s), g.cy(s)); return Math.hypot(g.cx(gl) - g.cx(s), g.cy(gl) - g.cy(s)); }));
    const need = Math.max(0, ...list.filter((x) => x.def.abilities?.flying).map((x) => x.unit * Math.min(x.count, 1 + flight / x.def.speed / x.interval)));
    if (!need) return 1;
    return airCover() < 1.5 * need ? 3 : 1;
  }

  // Valeur d'un type de lanterne pour les prochaines vagues (dégâts utiles par pièce d'or).
  function valueOf(type) {
    const list = upcoming();
    const boost = airBoost(list);
    const w = (x) => x.hp * (x.def.abilities?.flying ? boost : 1);
    const total = list.reduce((s, x) => s + w(x), 0) || 1;
    let v = 0;
    for (const x of list) v += (w(x) / total) * dpsVs(type, 1, x.def, x.absorb);
    return v / defs.towers[type].cost;
  }

  // ───────── socles ─────────

  function slotFree(type, c, r) {
    const i = g.idx(c, r);
    if (g.type(i) !== T.SLOT || game.towerAt(c, r)) return false;
    const se = g.slotElement[i];
    if (se && se !== defs.towers[type].element) return false;
    return !game.echoes.some((t) => t.c === c && t.r === r);
  }

  function freeSlots(type) {
    const out = [];
    for (let i = 0; i < g.size; i++) if (g.type(i) === T.SLOT && slotFree(type, g.col(i), g.row(i))) out.push([g.col(i), g.row(i)]);
    return out;
  }

  const barrierTiles = () => game.barriers.map((b) => b.tile);

  function slotScore(type, c, r, tiles, air) {
    const def = defs.towers[type];
    const st = def.levels[0];
    const x = c + 0.5;
    const y = r + 0.5;
    const atk = attackOf(def);
    let score = 0;
    if (atk === 'support') {
      for (const t of game.towers) {
        if (t.c === c && t.r === r) continue;
        const d = Math.hypot(t.x - x, t.y - y);
        if (d > st.range) continue;
        if (st.rateBonus && !isSupport(t.type)) score += 2 ** (t.level - 1) * (defs.towers[t.type].cost / 50);
      }
      if (st.heal) for (const bt of barrierTiles()) if (Math.hypot(g.cx(bt) - x, g.cy(bt) - y) <= st.range) score += 4;
      return score;
    }
    if (atk === 'barrier') {
      // un mur sur le trajet, au milieu de lanternes qui frappent
      let best = 0;
      for (const [i] of tiles) {
        if (Math.hypot(g.cx(i) - x, g.cy(i) - y) > st.range) continue;
        if (barrierTiles().includes(i)) continue;
        let s = 1;
        for (const t of game.towers) if (!isSupport(t.type) && Math.hypot(t.x - g.cx(i), t.y - g.cy(i)) <= game.towerStats(t).range) s += 2 ** (t.level - 1);
        // loin du sanctuaire : plus de temps pour frapper les yokai arrêtés
        s *= 1 + Math.min(1, game.flow.dist[i] / 20);
        best = Math.max(best, s);
      }
      return best;
    }
    const tg = def.targets ?? { ground: true, air: true };
    if (tg.ground) {
      for (const [i, w] of tiles) {
        const d = Math.hypot(g.cx(i) - x, g.cy(i) - y);
        if (d <= st.range) score += w * (barrierTiles().includes(i) ? 3 : 1);
      }
    }
    if (tg.air && air.length) {
      const share = airShare();
      for (const [px, py] of air) if (Math.hypot(px - x, py - y) <= st.range) score += share * 1.5;
    }
    if (opt.combos) {
      for (const t of [...game.towers, ...game.echoes]) {
        if (t.element === def.element || Math.max(Math.abs(t.c - c), Math.abs(t.r - r)) !== 1) continue;
        if (game.comboFor(t.type, type)) score += 3;
      }
    }
    // un Carillon voisin accélère
    for (const t of game.towers) {
      const tst = game.towerStats(t);
      if (tst.rateBonus && Math.hypot(t.x - x, t.y - y) <= tst.range) score *= 1 + tst.rateBonus * 0.5;
    }
    return score;
  }

  function airShare() {
    const list = upcoming();
    const boost = airBoost(list);
    const w = (x) => x.hp * (x.def.abilities?.flying ? boost : 1);
    const total = list.reduce((s, x) => s + w(x), 0) || 1;
    return list.filter((x) => x.def.abilities?.flying).reduce((s, x) => s + w(x), 0) / total;
  }

  function bestSlot(type) {
    const slots = freeSlots(type);
    if (!slots.length) return null;
    if (opt.random) {
      const [c, r] = slots[Math.floor(rng.next() * slots.length)];
      return { c, r, score: 1 };
    }
    const tiles = routeTiles();
    const air = flightPoints();
    let best = null;
    let bestScore = 0;
    for (const [c, r] of slots) {
      const s = slotScore(type, c, r, tiles, air);
      if (s > bestScore) {
        bestScore = s;
        best = [c, r];
      }
    }
    return best ? { c: best[0], r: best[1], score: bestScore } : null;
  }

  // ───────── choix de la lanterne ─────────

  // Défi « N lanternes » : le bot ne dépasse jamais le nombre de poses permis.
  function buildLimitReached() {
    const max = game.challengeRule?.maxTowers;
    return max != null && (game.stats.towersBuilt >= max || game.towers.length >= max);
  }

  function pickType() {
    if (buildLimitReached()) return null;
    // seules comptent les lanternes qui ont encore un socle libre (socles typés)
    const avail = available().filter((t) => defs.towers[t] && freeSlots(t).length);
    if (!avail.length) return null;
    if (opt.random) return avail[Math.floor(rng.next() * avail.length)];
    if (mono) return avail[0];
    const mine = game.towers.filter((t) => t.owner === pid || game.players.length === 1);
    const count = {};
    for (const t of mine) count[t.type] = (count[t.type] || 0) + 2 ** (t.level - 1);
    const dmgTowers = mine.filter((t) => !isSupport(t.type)).length;
    // part de l'or investi par élément (diversifier : kitsune, coopération)
    const inv = mine.reduce((s, t) => s + t.invested, 0) || 1;
    const elShare = {};
    for (const t of mine) elShare[t.element] = (elShare[t.element] || 0) + t.invested / inv;
    const ground = 1 - airShare();
    let best = null;
    let bestScore = -Infinity;
    for (const type of avail) {
      const def = defs.towers[type];
      const atk = attackOf(def);
      let score;
      if (atk === 'support') {
        if (!opt.support) continue;
        const slot = bestSlot(type);
        if (!slot) continue;
        score = (def.levels[0].rateBonus ? slot.score * 0.012 : slot.score * 0.006) / (1 + (count[type] || 0));
        if (def.levels[0].rateBonus && dmgTowers < 4) continue;
        if (def.levels[0].heal && !game.barriers.length) continue;
      } else if (atk === 'barrier') {
        if (!opt.support || dmgTowers < 2 || ground < 0.5) continue;
        if ((count[type] || 0) >= 2) continue;
        const slot = bestSlot(type);
        if (!slot) continue;
        // valeur d'un mur : les lanternes qui frappent autour de sa case (voir slotScore)
        score = (0.015 * slot.score * ground) / (1 + (count[type] || 0));
      } else {
        score = valueOf(type) / (1 + 0.6 * (count[type] || 0)) / (1 + 0.8 * (elShare[def.element] || 0));
      }
      if (score > bestScore) {
        bestScore = score;
        best = type;
      }
    }
    return best;
  }

  // ───────── fusion, pierres ─────────

  function tryFuse() {
    if (!opt.fuse) return false;
    const mine = game.towers.filter((t) => t.owner === pid || game.players.length === 1);
    for (let lvl = 1; lvl < game.rules.maxTowerLevel; lvl++) {
      const types = [...new Set(mine.map((t) => t.type))];
      for (const type of types) {
        const list = mine.filter((t) => t.type === type && t.level === lvl);
        if (list.length < 2 || lvl >= game.maxLevelOf(type)) continue;
        if (opt.random && rng.next() < 0.5) continue;
        const tiles = routeTiles();
        const air = flightPoints();
        // on garde la mieux placée, on libère la moins utile (de préférence hors combo)
        const score = (t) => slotScore(type, t.c, t.r, tiles, air) + (game.zones.some((z) => z.a === t.id || z.b === t.id) ? 5 : 0);
        list.sort((a, b) => score(b) - score(a));
        const dst = list[0];
        const src = list[list.length - 1];
        if (game.fuse(src.id, dst.id, pid)) {
          log.push(`t=${game.time.toFixed(1)} fusion ${type} -> N${lvl + 1}`);
          return true;
        }
      }
    }
    return false;
  }

  function routeLength() {
    let total = 0;
    for (const s of g.spawns) total += game.flow.dist[s];
    return total;
  }

  function tryStone() {
    if (!opt.stones || !game.canUseStones(pid) || game.towers.length < 2) return false;
    const cost = game.stoneCost();
    if (game.stonesLeft() <= 0 || gold() < cost + 30) return false;
    const base = routeLength();
    const cands = [];
    for (let i = 0; i < g.size; i++) {
      if (g.type(i) !== T.OPEN || g.stone[i]) continue;
      if (game.canPlaceStone(g.col(i), g.row(i), pid).ok) cands.push(i);
    }
    const lenWith = (list) => {
      for (const i of list) g.stone[i] = 1;
      game.flow.compute();
      const ok = g.spawns.every((s) => game.flow.dist[s] >= 0);
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
    if (best < 0 && game.stonesLeft() >= 2 && gold() >= cost * 2 + 30) {
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
    if (best >= 0 && bestGain >= 1 && game.placeStone(g.col(best), g.row(best), pid)) {
      log.push(`t=${game.time.toFixed(1)} pierre (${g.col(best)},${g.row(best)}) +${bestGain}`);
      return true;
    }
    return false;
  }

  // Priorités : un antiaérien réglé sur « plus fort » viserait les carapaces au sol ;
  // quand des volants sont annoncés, il passe sur « premier » (les volants filent droit).
  function retarget() {
    if (opt.random) return;
    const wantAir = airShare() > 0.1;
    for (const t of game.towers) {
      if (game.players.length > 1 && t.owner !== pid) continue;
      const def = defs.towers[t.type];
      if (def.priority !== 'strong' || !((def.levels[0].airMultiplier ?? 1) > 1)) continue;
      const want = wantAir ? 'first' : 'strong';
      if (t.priority !== want) game.setPriority(t.id, want, pid);
    }
  }

  function spend() {
    let guard = 0;
    while (guard++ < 30) {
      if (tryFuse()) continue;
      if (tryStone()) continue;
      const type = pickType();
      if (!type || gold() < defs.towers[type].cost) break;
      const slot = bestSlot(type);
      if (!slot) break;
      if (!game.placeTower(type, slot.c, slot.r, pid)) break;
      log.push(`t=${game.time.toFixed(1)} pose ${type} (${slot.c},${slot.r})`);
    }
  }

  return {
    log,
    tick(t) {
      if (t < nextDecision) return;
      nextDecision = t + 0.5;
      spend();
      retarget();
      if (opt.rewind && game.lives < lastLives && game.canRewind()) {
        game.rewind(pid);
        log.push(`t=${game.time.toFixed(1)} rembobinage`);
      }
      if (game.lastChanceT > 0 && game.canRewind()) game.rewind(pid);
      lastLives = game.lives;
      if (game.state === 'build' && pid === 0) game.startNextWave(pid, false);
    },
  };
}
