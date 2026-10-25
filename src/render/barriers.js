// Barrières du Gardien de pierre : mur de pierres empilées dressé sur une case de
// chemin (~0,8 case), qui se fissure à mesure qu'il perd ses PV, vole en éclats
// sous les coups, s'écroule en ruine (anneau de relève autour) et se hérisse de
// pieux quand il renvoie des dégâts (thorns). Un fil discret le relie à son gardien.
//
// Performance : chaque état du mur (intact, fissuré, très fissuré, presque détruit,
// ruine ; avec ou sans pieux) est rendu une seule fois par case, taille de case et
// échelle dans un canvas hors écran, puis copié par drawImage.
import { INK, PALETTE, withAlpha, wash, brushStroke, seeded, mix, makeCanvas } from './brush.js';

const TAU = Math.PI * 2;
const STONES = ['#9a968a', '#a88d5e', '#8f8a7c', '#b09a70', '#a39d8c'];
const MOSS = PALETTE.moss;
const STAKE = '#a8b060';

// Rangées de pierres (repère en cases, origine au centre de la case, y vers le bas) :
// [y bas, hauteur, [x centres], largeur]
const ROWS = [
  [0.3, 0.2, [-0.27, 0, 0.27], 0.28],
  [0.1, 0.19, [-0.36, -0.13, 0.13, 0.36], [0.16, 0.26, 0.26, 0.16]],
  [-0.09, 0.17, [-0.25, 0, 0.25], 0.25],
];

// Pierres absentes selon l'usure (indices « rangée:pierre »).
const MISSING = [[], [], ['2:2'], ['2:0', '2:2', '1:3']];

function stonePath(g, x, yb, w, h, rnd) {
  const x0 = x - w / 2;
  const x1 = x + w / 2;
  const y0 = yb - h;
  const j = () => (rnd() - 0.5) * 0.02;
  const r = Math.min(w, h) * 0.32;
  g.beginPath();
  g.moveTo(x0 + r + j(), y0 + j());
  g.quadraticCurveTo(x1 + j(), y0 + j(), x1 + j(), y0 + r);
  g.quadraticCurveTo(x1 + 0.01, yb, x1 - r + j(), yb);
  g.lineTo(x0 + r + j(), yb);
  g.quadraticCurveTo(x0 - 0.01, yb, x0 + j(), y0 + r);
  g.quadraticCurveTo(x0 + j(), y0 + j(), x0 + r, y0);
  g.closePath();
}

// Fissure : trait d'encre bordé de crème (lisible sur toutes les pierres).
function crack(g, pts, w) {
  brushStroke(g, pts, w * 2.2, withAlpha(PALETTE.cream, 0.85), { taperIn: 0.1, taperOut: 0.5 });
  brushStroke(g, pts, w, INK, { taperIn: 0.1, taperOut: 0.6 });
}

// Mur (wear : 0 intact … 3 presque détruit).
function paintWall(g, seed, wear, thorns) {
  const rnd = seeded(seed * 13 + 5);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // ombre portée
  g.save();
  g.translate(0.04, 0.31);
  g.scale(1, 0.3);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 0.5);
  gr.addColorStop(0, withAlpha(INK, 0.45));
  gr.addColorStop(1, withAlpha(INK, 0));
  g.fillStyle = gr;
  g.fillRect(-0.5, -0.5, 1, 1);
  g.restore();
  // le mur couvre ~0,8 case : on resserre le dessin autour de sa base
  g.translate(0, 0.31);
  g.scale(0.88, 0.92);
  g.translate(0, -0.31);
  if (thorns) paintStakes(g, rnd, true);
  const miss = new Set(MISSING[wear]);
  const tilt = wear >= 3 ? 0.06 : 0;
  ROWS.forEach(([yb, h, xs, ws], ri) => {
    xs.forEach((x, si) => {
      if (miss.has(`${ri}:${si}`)) return;
      const w = Array.isArray(ws) ? ws[si] : ws;
      const sx = x + (ri === 2 ? tilt : 0);
      const col = STONES[Math.floor(rnd() * STONES.length)];
      stonePath(g, sx, yb, w - 0.012, h - 0.008, rnd);
      g.fillStyle = col;
      g.fill();
      g.save();
      g.clip();
      wash(g, sx - w * 0.25, yb - h * 0.75, w * 0.7, '#fffaf0', 0.5);
      wash(g, sx + w * 0.3, yb, w * 0.7, PALETTE.stoneDark, 0.5);
      g.fillStyle = withAlpha(PALETTE.stoneDark, 0.35);
      for (let k = 0; k < 3; k++) g.fillRect(sx + (rnd() - 0.5) * w * 0.7, yb - rnd() * h, 0.012, 0.01);
      g.restore();
      g.strokeStyle = INK;
      g.lineWidth = 0.026;
      g.stroke();
      // mousse sur quelques pierres du haut
      if (ri === 2 && rnd() < 0.6 && wear < 2) {
        g.fillStyle = MOSS;
        g.beginPath();
        g.ellipse(sx - w * 0.15, yb - h + 0.012, w * 0.22, 0.03, 0, Math.PI, 0);
        g.fill();
      }
    });
  });
  // fissures selon l'usure
  const cracks = [
    [[-0.3, 0.11], [-0.24, 0.17], [-0.27, 0.24]],
    [[0.06, -0.24], [0.02, -0.16], [0.08, -0.08], [0.04, 0.02]],
    [[0.24, 0.12], [0.3, 0.2], [0.26, 0.28]],
    [[-0.1, -0.06], [-0.16, 0.02], [-0.1, 0.08]],
    [[0.3, -0.2], [0.24, -0.12]],
  ];
  const n = wear === 0 ? 0 : wear === 1 ? 2 : wear === 2 ? 4 : 5;
  for (let i = 0; i < n; i++) crack(g, cracks[i], 0.022);
  if (wear >= 2) {
    // gravats au pied du mur
    for (let k = 0; k < 2 + wear; k++) {
      const x = (rnd() - 0.5) * 0.8;
      g.beginPath();
      g.ellipse(x, 0.31 + rnd() * 0.03, 0.03 + rnd() * 0.02, 0.018, 0, 0, TAU);
      g.fillStyle = STONES[k % STONES.length];
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 0.012;
      g.stroke();
    }
  }
  if (thorns) paintStakes(g, rnd, false);
}

// Pieux de bambou taillés en pointe (sakamogi), devant et derrière le mur.
function paintStakes(g, rnd, back) {
  const list = back ? [[-0.38, -0.06, -0.6], [0.38, -0.06, 0.6]] : [[-0.34, 0.24, -0.75], [-0.12, 0.3, -0.3], [0.12, 0.3, 0.3], [0.34, 0.24, 0.75]];
  for (const [x, y, a] of list) {
    const len = back ? 0.3 : 0.3;
    const tx = x + Math.sin(a) * len;
    const ty = y - Math.cos(a) * len * 0.55 + (back ? -0.12 : 0.08);
    const nx = Math.cos(a) * 0.04;
    const ny = Math.sin(a) * 0.04;
    g.beginPath();
    g.moveTo(x - nx, y - ny);
    g.lineTo(x + nx, y + ny);
    g.lineTo(tx, ty);
    g.closePath();
    g.fillStyle = back ? mix(STAKE, INK, 0.3) : STAKE;
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 0.024;
    g.stroke();
    // pointe claire (coupe fraîche)
    g.beginPath();
    g.moveTo(tx, ty);
    g.lineTo(tx + (x - tx) * 0.25 + nx * 0.6, ty + (y - ty) * 0.25 + ny * 0.6);
    g.strokeStyle = PALETTE.cream;
    g.lineWidth = 0.02;
    g.stroke();
  }
}

// Ruine : pierres éboulées, tache de poussière.
function paintRuin(g, seed) {
  const rnd = seeded(seed * 7 + 3);
  g.lineJoin = 'round';
  wash(g, 0, 0.24, 0.45, '#b59a6a', 0.35);
  const pts = [[-0.26, 0.28, 0.13], [0.0, 0.3, 0.15], [0.25, 0.27, 0.12], [-0.12, 0.2, 0.11], [0.13, 0.19, 0.1], [0.34, 0.31, 0.07], [-0.36, 0.31, 0.06]];
  for (const [x, y, s] of pts) {
    stonePath(g, x, y, s * 1.5, s * 0.9, rnd);
    g.fillStyle = STONES[Math.floor(rnd() * STONES.length)];
    g.fill();
    g.save();
    g.clip();
    wash(g, x + s * 0.4, y, s, PALETTE.stoneDark, 0.5);
    g.restore();
    g.strokeStyle = INK;
    g.lineWidth = 0.022;
    g.stroke();
  }
  crack(g, [[-0.05, 0.12], [0.0, 0.18], [-0.04, 0.24]], 0.018);
}

const cache = new Map();
// Sprite d'un état du mur ; repère : centre de la case.
function wallSprite(seed, state, thorns, ts, sc) {
  const key = `${seed}|${state}|${thorns ? 1 : 0}|${ts}|${sc}`;
  let s = cache.get(key);
  if (s) return s;
  const W = 1.2;
  const H = 1.0;
  const ax = 0.6;
  const ay = 0.6;
  const S = ts * sc;
  const c = makeCanvas(W * S, H * S);
  const g = c.getContext('2d');
  g.setTransform(S, 0, 0, S, ax * S, ay * S);
  if (state === 4) paintRuin(g, seed);
  else paintWall(g, seed, state, thorns);
  s = { c, w: W * ts, h: H * ts, ax: ax * ts, ay: ay * ts };
  if (cache.size > 160) cache.clear();
  cache.set(key, s);
  return s;
}

// Montée de la barrière (barrierUp) : instant par barrière, pour l'animation.
const risen = new Map();
export function noteBarrierUp(id, time) {
  risen.set(id, time);
  if (risen.size > 200) risen.clear();
}

function easeOutBack(k) {
  const c1 = 1.9;
  const u = k - 1;
  return 1 + (c1 + 1) * u * u * u + c1 * u * u;
}

/**
 * Dessine une barrière (repère du plateau, px CSS).
 * opts : { respawnMax (s), time, reduced }
 */
export function drawBarrier(ctx, bar, game, ts, time, opts = {}) {
  const g = game.grid;
  const x = g.cx(bar.tile) * ts;
  const y = g.cy(bar.tile) * ts;
  const m = ctx.getTransform();
  const sc = Math.max(1, Math.min(4, Math.round(Math.hypot(m.a, m.b) * 2) / 2));
  if (!bar.alive) {
    const s = wallSprite(bar.tile, 4, false, ts, sc);
    ctx.drawImage(s.c, x - s.ax, y - s.ay, s.w, s.h);
    // anneau de relève : se remplit jusqu'à ce que le mur se redresse
    const max = opts.respawnMax || 6;
    const k = Math.max(0, Math.min(1, 1 - (bar.respawnT ?? 0) / max));
    const cy = y + ts * 0.22;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, ts * 0.06);
    ctx.strokeStyle = withAlpha(INK, 0.3);
    ctx.beginPath();
    ctx.ellipse(x, cy, ts * 0.44, ts * 0.17, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(PALETTE.goldLight, 0.95);
    ctx.lineWidth = Math.max(1.5, ts * 0.04);
    ctx.beginPath();
    ctx.ellipse(x, cy, ts * 0.44, ts * 0.17, 0, -Math.PI / 2, -Math.PI / 2 + k * TAU);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const r = bar.maxHp > 0 ? bar.hp / bar.maxHp : 1;
  const wear = r >= 0.75 ? 0 : r >= 0.5 ? 1 : r >= 0.25 ? 2 : 3;
  const s = wallSprite(bar.tile, wear, (bar.thorns || 0) > 0, ts, sc);
  // montée : les pierres jaillissent du sol
  const t0 = risen.get(bar.id);
  let rise = 1;
  if (t0 != null) {
    const k = (time - t0) / 0.42;
    if (k < 1) rise = Math.max(0.05, easeOutBack(Math.max(0, k)));
    else risen.delete(bar.id);
  }
  const hit = (bar.hitT || 0) > 0;
  const shake = hit && !opts.reduced ? Math.sin(time * 70) * ts * 0.018 : 0;
  if (rise < 1) {
    ctx.save();
    ctx.translate(x, y + ts * 0.3);
    ctx.scale(1, rise);
    ctx.drawImage(s.c, -s.ax, -s.ay - ts * 0.3, s.w, s.h);
    ctx.restore();
  } else {
    ctx.drawImage(s.c, x - s.ax + shake, y - s.ay, s.w, s.h);
  }
  if (hit) {
    // éclats de pierre qui sautent sous les coups
    ctx.save();
    ctx.fillStyle = '#c9c2ad';
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.8, ts * 0.012);
    for (let k = 0; k < 3; k++) {
      const q = (time * 3.2 + k / 3) % 1;
      const side = k === 1 ? 0.15 : k ? 1 : -1;
      const px = x + side * ts * (0.12 + q * 0.3);
      const py = y - ts * 0.2 - Math.sin(q * Math.PI) * ts * 0.3 + q * ts * 0.2;
      const sz = ts * 0.035 * (1 - q * 0.5);
      ctx.globalAlpha = 1 - q;
      ctx.beginPath();
      ctx.moveTo(px - sz, py);
      ctx.lineTo(px, py - sz);
      ctx.lineTo(px + sz, py + sz * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    wash(ctx, x, y - ts * 0.05, ts * 0.4, '#fffaf0', 0.25);
  }
}

// Mur en construction (« Déplacer le mur », cf. render/construction.js) : le mur
// neuf monte de terre sur sa nouvelle case, translucide, avec l'avancement k (0 → 1).
// (x, y) : centre de la case (repère du plateau, px CSS) ; `seed` : index de la case.
export function drawWallGhost(ctx, x, y, seed, ts, k) {
  const m = ctx.getTransform();
  const sc = Math.max(1, Math.min(4, Math.round(Math.hypot(m.a, m.b) * 2) / 2));
  const s = wallSprite(seed, 0, false, ts, sc);
  const rise = 0.25 + 0.75 * Math.max(0, Math.min(1, k));
  ctx.save();
  ctx.globalAlpha *= 0.3 + 0.45 * k;
  ctx.translate(x, y + ts * 0.3);
  ctx.scale(1, rise);
  ctx.drawImage(s.c, -s.ax, -s.ay - ts * 0.3, s.w, s.h);
  ctx.restore();
}

// Fil discret entre la barrière et son gardien (sous les entités).
export function drawBarrierThread(ctx, bar, tower, game, ts, time) {
  const g = game.grid;
  const bx = g.cx(bar.tile) * ts;
  const by = g.cy(bar.tile) * ts + ts * 0.15;
  const tx = tower.x * ts;
  const ty = tower.y * ts + ts * 0.2;
  const mx = (bx + tx) / 2;
  const my = (by + ty) / 2 + ts * 0.18;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.setLineDash([ts * 0.05, ts * 0.1]);
  ctx.lineDashOffset = -time * ts * 0.25;
  ctx.strokeStyle = withAlpha(bar.alive ? PALETTE.gold : '#7d7a70', bar.alive ? 0.55 : 0.4);
  ctx.lineWidth = Math.max(1.2, ts * 0.03);
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.quadraticCurveTo(mx, my, bx, by);
  ctx.stroke();
  ctx.restore();
}

