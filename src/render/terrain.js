// Rendu du terrain, pré-calculé une fois par niveau dans un canvas hors écran,
// façon estampe : tapis de mousse au pinceau, gravier ratissé (karesansui) bordé
// d'encre, jardin sec ouvert aux pierres, bassins arrondis à vagues seigaiha,
// dalles des lanternes, pins, rochers et sanctuaire.
//
// Les régions (chemin, gravier ouvert, eau) sont tracées comme des contours
// continus (boucles de coins de cases, coins arrondis, bord légèrement tremblé)
// plutôt que case par case : les zones contiguës forment des formes cohérentes.
import { T } from '../core/grid.js';
import { makeCanvas, seeded, brushStroke, quadPts, withAlpha, mix, wash, PALETTE, INK } from './brush.js';
import { elementLook, shapePath, shapeCenterY } from './glyphs.js';

const WALK = new Set([T.PATH, T.OPEN, T.SPAWN, T.GOAL, T.BRIDGE]);
const TAU = Math.PI * 2;
const SNOW_WHITE = '#f6f8f8';

export function renderTerrain(grid, ts, dpr, theme) {
  const W = grid.cols * ts;
  const H = grid.rows * ts;
  const pad = ts * 0.5;
  const c = makeCanvas((W + pad * 2) * dpr, (H + pad * 2) * dpr);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.translate(pad, pad);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // graine propre à chaque carte : deux niveaux ne se ressemblent pas
  let h = grid.cols * 31 + grid.rows * 7;
  for (let i = 0; i < grid.size; i++) h = (h * 31 + grid.types[i] * (i + 1)) % 1000003;
  const th = theme;
  const k = {
    grid,
    ts,
    th,
    seed: h,
    snow: !!(th.snowCaps || th.ambient === 'snow'),
    typeAt: (cc, rr) => (grid.inBounds(cc, rr) ? grid.type(grid.idx(cc, rr)) : -1),
  };

  drawGround(ctx, k);
  drawWater(ctx, k);
  drawGravel(ctx, k);
  drawBridges(ctx, k);
  drawSlots(ctx, k);
  drawGrass(ctx, k);
  drawRocks(ctx, k);
  drawTrees(ctx, k);
  drawSpawnScars(ctx, k);
  drawGoals(ctx, k);
  return { canvas: c, pad };
}

// ───────────────────────── Contours de régions ─────────────────────────

// Boucles fermées des coins de cases bordant une région (unités de case),
// parcourues dans le sens horaire à l'écran : l'intérieur est à droite.
// Les trous (îlots) sont des boucles de sens opposé, ce qui permet de tout
// remplir d'un seul chemin (règle « nonzero »).
function traceLoops(cols, rows, inside) {
  const V = cols + 1;
  const out = new Map();
  const add = (x0, y0, x1, y1) => {
    const key = y0 * V + x0;
    let l = out.get(key);
    if (!l) out.set(key, (l = []));
    l.push([x0, y0, x1, y1]);
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!inside(c, r)) continue;
      if (!inside(c, r - 1)) add(c, r, c + 1, r);
      if (!inside(c + 1, r)) add(c + 1, r, c + 1, r + 1);
      if (!inside(c, r + 1)) add(c + 1, r + 1, c, r + 1);
      if (!inside(c - 1, r)) add(c, r + 1, c, r);
    }
  }
  const loops = [];
  for (const list of out.values()) {
    while (list.length) {
      let e = list.pop();
      const sx = e[0];
      const sy = e[1];
      const pts = [];
      for (let guard = 0; guard < 100000; guard++) {
        pts.push([e[0], e[1]]);
        if (e[2] === sx && e[3] === sy) break;
        const next = out.get(e[3] * V + e[2]);
        if (!next || !next.length) break;
        let j = 0;
        if (next.length > 1) {
          // point selle : on tourne à droite (deux cases en diagonale restent séparées)
          const dx = e[2] - e[0];
          const dy = e[3] - e[1];
          j = Math.max(0, next.findIndex((f) => f[2] - f[0] === -dy && f[3] - f[1] === dx));
        }
        e = next.splice(j, 1)[0];
      }
      const s = simplify(pts);
      if (s.length >= 4) loops.push(s);
    }
  }
  return loops;
}

// Retire les sommets alignés : il ne reste que les coins.
function simplify(pts) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out;
}

// Décale une boucle orthogonale de d vers l'intérieur (d < 0 : vers l'extérieur).
function offsetLoop(loop, d) {
  const n = loop.length;
  return loop.map((p, i) => {
    const a = loop[(i - 1 + n) % n];
    const c = loop[(i + 1) % n];
    const ax = Math.sign(p[0] - a[0]);
    const ay = Math.sign(p[1] - a[1]);
    const bx = Math.sign(c[0] - p[0]);
    const by = Math.sign(c[1] - p[1]);
    return [p[0] + (-ay - by) * d, p[1] + (ax + bx) * d];
  });
}

const toPx = (loop, ts) => loop.map((p) => [p[0] * ts, p[1] * ts]);

// Échantillonne une boucle à coins arrondis (rayon R) tous les ~step px.
// Chaque point porte sa normale intérieure : [x, y, nx, ny].
function sampleLoop(loop, R, step) {
  const n = loop.length;
  const dir = (a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l, l];
  };
  const rad = [];
  for (let i = 0; i < n; i++) {
    const a = dir(loop[(i - 1 + n) % n], loop[i]);
    const b = dir(loop[i], loop[(i + 1) % n]);
    rad.push(Math.min(R, a[2] * 0.5, b[2] * 0.5));
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % n];
    const q2 = loop[(i + 2) % n];
    const [ux, uy, len] = dir(p, q);
    const r0 = rad[i];
    const r1 = rad[(i + 1) % n];
    const L = len - r0 - r1;
    const m = Math.max(1, Math.round(L / step));
    for (let s = 0; s < m; s++) {
      const t = r0 + (L * s) / m;
      out.push([p[0] + ux * t, p[1] + uy * t, -uy, ux]);
    }
    const [vx, vy] = dir(q, q2);
    const ax = q[0] - ux * r1;
    const ay = q[1] - uy * r1;
    const bx = q[0] + vx * r1;
    const by = q[1] + vy * r1;
    const steps = Math.max(2, Math.ceil((r1 * 1.6) / step));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      const nx = -(uy * u + vy * t);
      const ny = ux * u + vx * t;
      const nl = Math.hypot(nx, ny) || 1;
      out.push([u * u * ax + 2 * u * t * q[0] + t * t * bx, u * u * ay + 2 * u * t * q[1] + t * t * by, nx / nl, ny / nl]);
    }
  }
  return out;
}

// Fait trembler une boucle le long de sa normale : bruit lisse et périodique
// (somme de sinusoïdes dont la période divise la longueur de la boucle).
function displace(pts, amp, wl, rnd) {
  const n = pts.length;
  const s = [0];
  for (let i = 1; i <= n; i++) {
    const a = pts[i - 1];
    const b = pts[i % n];
    s.push(s[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const L = s[n] || 1;
  const waves = [];
  for (let j = 0; j < 3; j++) {
    const m = Math.max(1, Math.round((L / wl) * (1 + j * 1.3)));
    waves.push([(TAU * m) / L, rnd() * TAU, amp / (1 + j * 0.8)]);
  }
  return pts.map((p, i) => {
    let d = 0;
    for (const [f, ph, a] of waves) d += Math.sin(s[i] * f + ph) * a;
    return [p[0] + p[2] * d, p[1] + p[3] * d, p[2], p[3]];
  });
}

function polyPath(ctx, pts, begin = true) {
  if (begin) ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function multiPath(ctx, shapes) {
  ctx.beginPath();
  for (const s of shapes) polyPath(ctx, s, false);
}

// Contour d'encre au pinceau le long d'une boucle : plusieurs traits qui se
// chevauchent, d'épaisseur variable, extrémités effilées (pas un tube régulier).
function inkLoop(ctx, pts, width, color, rnd, opts = {}) {
  const n = pts.length;
  if (n < 4) return;
  const seg = opts.seg ?? 24;
  const gap = opts.gap ?? 0;
  let i = Math.floor(rnd() * n);
  let done = 0;
  while (done < n) {
    const len = Math.max(4, Math.min(n - done + 2, Math.round(seg * (0.6 + rnd() * 0.8))));
    const chunk = [];
    for (let j = 0; j <= len; j++) chunk.push(pts[(i + j) % n]);
    if (rnd() >= gap) {
      const ph = rnd() * TAU;
      const fq = 3 + rnd() * 4;
      brushStroke(ctx, chunk, width * (0.8 + rnd() * 0.4), color, {
        taperIn: 0.1,
        taperOut: 0.16,
        pressure: (t) => 0.78 + 0.32 * Math.sin(t * fq + ph),
      });
    }
    i += len - 2;
    done += len - 2;
  }
}

// Petite touche de pinceau en amande ajoutée au chemin courant (remplie par lots).
function lens(ctx, x, y, len, w, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const hx = c * len * 0.5;
  const hy = s * len * 0.5;
  ctx.moveTo(x - hx, y - hy);
  ctx.quadraticCurveTo(x - s * w, y + c * w, x + hx, y + hy);
  ctx.quadraticCurveTo(x + s * w, y - c * w, x - hx, y - hy);
}

// Brin effilé (base large, pointe fine) ajouté au chemin courant.
function blade(ctx, x, y, tx, ty, bend, w) {
  const dx = tx - x;
  const dy = ty - y;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l;
  const ny = dx / l;
  const cx = x + dx * 0.5 + nx * bend;
  const cy = y + dy * 0.5 + ny * bend;
  ctx.moveTo(x - nx * w * 0.5, y - ny * w * 0.5);
  ctx.quadraticCurveTo(cx - nx * w * 0.3, cy - ny * w * 0.3, tx, ty);
  ctx.quadraticCurveTo(cx + nx * w * 0.5, cy + ny * w * 0.5, x + nx * w * 0.5, y + ny * w * 0.5);
  ctx.closePath();
}

// Ombre portée douce (lavis elliptique, sprite en cache).
function softShadow(ctx, x, y, rx, ry, a) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  wash(ctx, 0, 0, rx, INK, a);
  ctx.restore();
}

// Couche douce en basse résolution (¼ de pixel CSS) couvrant tout le terrain :
// on y peint lavis et ombres larges, puis on l'agrandit d'un seul drawImage.
function softLayer(k) {
  const { grid, ts } = k;
  const pad = ts * 0.5;
  const s = 0.25;
  const c = makeCanvas((grid.cols * ts + pad * 2) * s, (grid.rows * ts + pad * 2) * s);
  const g = c.getContext('2d');
  g.scale(s, s);
  g.translate(pad, pad);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  return {
    ctx: g,
    draw(ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(c, -pad, -pad, c.width / s, c.height / s);
    },
  };
}

// ───────────────────────── Sol : mousse ou neige ─────────────────────────

function drawGround(ctx, k) {
  const { grid, ts, th, snow, typeAt } = k;
  const rnd = seeded(k.seed + 11);
  const cols = grid.cols;
  const rows = grid.rows;
  const base = snow ? mix(th.grass, th.ground, 0.55) : mix(th.grass, th.paper, 0.4);
  const dark = snow ? mix(th.grassDark, th.grass, 0.45) : mix(th.grassDark, th.grass, 0.35);

  // Bord extérieur organique : le tapis déborde un peu de la grille, comme un lavis.
  const rect = [
    [0, 0],
    [cols, 0],
    [cols, rows],
    [0, rows],
  ];
  let border = sampleLoop(toPx(offsetLoop(rect, -0.2), ts), ts * 0.7, ts * 0.12);
  border = displace(border, ts * 0.08, ts * 2.4, rnd);
  border = displace(border, ts * 0.018, ts * 0.7, rnd);

  ctx.save();
  polyPath(ctx, border);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.clip();

  // Bokashi et ombres portées : couche douce en basse résolution, agrandie en
  // une fois (le filtrage bilinéaire adoucit les bords, comme un lavis).
  const soft = softLayer(k);
  const sc = soft.ctx;
  const nW = Math.round(cols * rows * 0.5);
  for (let i = 0; i < nW; i++) {
    const x = (rnd() * (cols + 1) - 0.5) * ts;
    const y = (rnd() * (rows + 1) - 0.5) * ts;
    const r = ts * (1.3 + rnd() * 1.4);
    const v = rnd();
    if (snow) {
      if (v < 0.4) wash(sc, x, y, r, SNOW_WHITE, 0.45);
      else if (v < 0.75) wash(sc, x, y, r, th.grassDark, 0.18);
      else wash(sc, x, y, r, PALETTE.indigoLight, 0.16);
    } else if (v < 0.4) wash(sc, x, y, r, mix(th.grass, th.paper, 0.75), 0.3);
    else if (v < 0.8) wash(sc, x, y, r, th.grassDark, 0.16);
    else wash(sc, x, y, r, PALETTE.gold, 0.1);
  }

  // Ombre portée des chemins et bassins sur la mousse (le remplissage la recouvre côté intérieur).
  const isWalk = (cc, rr) => {
    const t = typeAt(cc, rr);
    return WALK.has(t) && t !== T.BRIDGE;
  };
  const isWater = (cc, rr) => {
    const t = typeAt(cc, rr);
    return t === T.WATER || t === T.BRIDGE;
  };
  const halo = snow ? PALETTE.indigo : th.grassDark;
  for (const pred of [isWalk, isWater]) {
    const shapes = traceLoops(cols, rows, pred).map((l) => sampleLoop(toPx(offsetLoop(l, 0.04), ts), ts * 0.4, ts * 0.15));
    if (!shapes.length) continue;
    multiPath(sc, shapes);
    sc.strokeStyle = withAlpha(halo, snow ? 0.1 : 0.16);
    sc.lineWidth = ts * 0.4;
    sc.stroke();
    sc.strokeStyle = withAlpha(halo, snow ? 0.1 : 0.14);
    sc.lineWidth = ts * 0.18;
    sc.stroke();
  }
  soft.draw(ctx);

  // Texture au pinceau : touches en amande de trois tons, par lots (un remplissage par ton).
  const isGround = (cc, rr) => {
    const t = typeAt(cc, rr);
    return !WALK.has(t) && t !== T.WATER;
  };
  const tones = snow
    ? [
        [withAlpha(mix(th.grass, th.grassDark, 0.4), 0.5), []],
        [withAlpha(mix(th.grass, th.ground, 0.15), 0.5), []],
        [withAlpha(SNOW_WHITE, 0.8), []],
      ]
    : [
        [withAlpha(dark, 0.32), []],
        [withAlpha(mix(th.grass, PALETTE.moss, 0.5), 0.34), []],
        [withAlpha(mix(th.grass, th.paper, 0.7), 0.42), []],
      ];
  const dots = [];
  for (let r = -1; r <= rows; r++) {
    for (let cc = -1; cc <= cols; cc++) {
      if (!isGround(cc, r)) continue;
      // touches en petits groupes (coussins de mousse) plutôt qu'au hasard uniforme
      for (let g = 0; g < 3; g++) {
        const gx = (cc + 0.1 + rnd() * 0.8) * ts;
        const gy = (r + 0.1 + rnd() * 0.8) * ts;
        const tone = tones[Math.floor(rnd() * 3)][1];
        const nb = 3 + Math.floor(rnd() * 3);
        const ang = (rnd() - 0.5) * 0.9;
        for (let j = 0; j < nb; j++) {
          tone.push([gx + (rnd() - 0.5) * ts * 0.34, gy + (rnd() - 0.5) * ts * 0.22, ts * (0.09 + rnd() * 0.12), ts * (0.035 + rnd() * 0.03), ang + (rnd() - 0.5) * 0.6]);
        }
      }
      // tenten (苔点) : grappes de points d'encre, la signature des lavis de mousse
      if (rnd() < (snow ? 0.3 : 0.45)) {
        const gx = (cc + 0.15 + rnd() * 0.7) * ts;
        const gy = (r + 0.15 + rnd() * 0.7) * ts;
        const nb = 3 + Math.floor(rnd() * 3);
        for (let j = 0; j < nb; j++) dots.push([gx + (rnd() - 0.5) * ts * 0.2, gy + (rnd() - 0.5) * ts * 0.12, ts * (0.045 + rnd() * 0.035), ts * 0.032, (rnd() - 0.5) * 0.7]);
      }
    }
  }
  for (const [color, list] of tones) {
    ctx.beginPath();
    for (const d of list) lens(ctx, d[0], d[1], d[2], d[3], d[4]);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.beginPath();
  for (const d of dots) lens(ctx, d[0], d[1], d[2], d[3], d[4]);
  ctx.fillStyle = withAlpha(snow ? mix(th.grassDark, INK, 0.3) : mix(th.grassDark, INK, 0.35), snow ? 0.4 : 0.55);
  ctx.fill();

  // Neige : congères blanches au pinceau (mousse givrée visible entre elles) et scintillement.
  if (snow) {
    ctx.beginPath();
    const nD = Math.round(cols * rows * 0.35);
    for (let i = 0; i < nD; i++) {
      const gx = (rnd() * (cols + 0.6) - 0.3) * ts;
      const gy = (rnd() * (rows + 0.6) - 0.3) * ts;
      const nb = 4 + Math.floor(rnd() * 4);
      for (let j = 0; j < nb; j++) lens(ctx, gx + (rnd() - 0.5) * ts * 0.6, gy + (rnd() - 0.5) * ts * 0.25, ts * (0.25 + rnd() * 0.35), ts * (0.12 + rnd() * 0.1), (rnd() - 0.5) * 0.3);
    }
    ctx.fillStyle = withAlpha(SNOW_WHITE, 0.82);
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < cols * rows * 2; i++) {
      const x = (rnd() * (cols + 0.4) - 0.2) * ts;
      const y = (rnd() * (rows + 0.4) - 0.2) * ts;
      ctx.moveTo(x + ts * 0.02, y);
      ctx.arc(x, y, ts * (0.01 + rnd() * 0.012), 0, TAU);
    }
    ctx.fillStyle = withAlpha('#ffffff', 0.9);
    ctx.fill();
  }

  // Liseré intérieur plus sombre le long du bord (le tapis « boit » l'encre).
  polyPath(ctx, border);
  ctx.strokeStyle = withAlpha(dark, snow ? 0.12 : 0.22);
  ctx.lineWidth = ts * 0.22;
  ctx.stroke();
  ctx.restore();

  // Bord sec (kasure) : traits interrompus le long du contour extérieur.
  inkLoop(ctx, border, ts * 0.045, withAlpha(snow ? PALETTE.indigo : th.grassDark, 0.45), rnd, { gap: 0.35, seg: 30 });

  // Cases vides : on laisse voir le papier.
  const voids = traceLoops(cols, rows, (cc, rr) => typeAt(cc, rr) === T.VOID);
  if (voids.length) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    multiPath(
      ctx,
      voids.map((l) => sampleLoop(toPx(offsetLoop(l, 0.08), ts), ts * 0.4, ts * 0.12)),
    );
    ctx.fill();
    ctx.restore();
  }
}

// ───────────────────────── Eau ─────────────────────────

function drawWater(ctx, k) {
  const { grid, ts, th, snow, typeAt } = k;
  const rnd = seeded(k.seed + 23);
  const isW = (cc, rr) => {
    const t = typeAt(cc, rr);
    return t === T.WATER || t === T.BRIDGE;
  };
  const loops = traceLoops(grid.cols, grid.rows, isW);
  if (!loops.length) return;
  const shapes = loops.map((l) => displace(sampleLoop(toPx(offsetLoop(l, 0.06), ts), ts * 0.42, ts * 0.1), ts * 0.03, ts * 1.4, rnd));
  const base = snow ? mix(th.water, '#cfe4f2', 0.55) : th.water;
  const deep = snow ? mix(th.water, PALETTE.indigoLight, 0.3) : mix(th.water, PALETTE.indigo, 0.55);
  const light = snow ? '#ffffff' : mix(th.water, PALETTE.cream, 0.35);

  // Pierres de berge (suhama) posées sous le contour, côté terre.
  for (const s of shapes) {
    for (let i = Math.floor(rnd() * 20); i < s.length; i += 14 + Math.floor(rnd() * 16)) {
      const p = s[i];
      const x = p[0] - p[2] * ts * 0.06;
      const y = p[1] - p[3] * ts * 0.06;
      const r = ts * (0.05 + rnd() * 0.04);
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.3, r, rnd() * 0.6, 0, TAU);
      ctx.fillStyle = mix(PALETTE.stone, th.paper, 0.3);
      ctx.fill();
      ctx.strokeStyle = withAlpha(INK, 0.6);
      ctx.lineWidth = Math.max(0.8, ts * 0.02);
      ctx.stroke();
    }
  }

  ctx.save();
  multiPath(ctx, shapes);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.clip();

  // Bokashi en couche douce : plus sombre le long des rives (eau), ou cœur
  // bleu profond et bords blanchis de neige (glace).
  const soft = softLayer(k);
  const sc = soft.ctx;
  multiPath(sc, shapes);
  if (snow) {
    sc.strokeStyle = withAlpha(SNOW_WHITE, 0.45);
    sc.lineWidth = ts * 0.6;
    sc.stroke();
    sc.strokeStyle = withAlpha(SNOW_WHITE, 0.75);
    sc.lineWidth = ts * 0.24;
    sc.stroke();
    for (let r = 0; r < grid.rows; r++) {
      for (let cc = 0; cc < grid.cols; cc++) if (typeAt(cc, r) === T.WATER) wash(sc, (cc + 0.5) * ts, (r + 0.5) * ts, ts * 0.75, deep, 0.4);
    }
  } else {
    sc.strokeStyle = withAlpha(deep, 0.35);
    sc.lineWidth = ts * 0.7;
    sc.stroke();
    sc.strokeStyle = withAlpha(deep, 0.4);
    sc.lineWidth = ts * 0.28;
    sc.stroke();
  }
  soft.draw(ctx);

  // Cases d'eau (hors pont) : base des motifs et des carpes.
  const cells = [];
  for (let r = 0; r < grid.rows; r++) for (let cc = 0; cc < grid.cols; cc++) if (typeAt(cc, r) === T.WATER) cells.push([cc, r]);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    for (const p of s) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
  }

  if (snow) {
    // Glace : reflets obliques et fissures fines.
    ctx.beginPath();
    for (const [cc, r] of cells) {
      if (rnd() < 0.5) continue;
      const x = (cc + 0.2 + rnd() * 0.5) * ts;
      const y = (r + 0.3 + rnd() * 0.5) * ts;
      const l = ts * (0.25 + rnd() * 0.3);
      lens(ctx, x, y, l, ts * 0.05, -0.6);
      lens(ctx, x + ts * 0.1, y + ts * 0.06, l * 0.5, ts * 0.03, -0.6);
    }
    ctx.fillStyle = withAlpha('#ffffff', 0.7);
    ctx.fill();
    const cracks = new Path2D();
    const shade = new Path2D();
    for (const [cc, r] of cells) {
      if (rnd() < 0.35) continue;
      let x = (cc + rnd()) * ts;
      let y = (r + rnd()) * ts;
      cracks.moveTo(x, y);
      shade.moveTo(x + 0.8, y + 0.8);
      let a = rnd() * TAU;
      for (let s = 0; s < 4; s++) {
        a += (rnd() - 0.5) * 1.4;
        x += Math.cos(a) * ts * 0.18;
        y += Math.sin(a) * ts * 0.18;
        cracks.lineTo(x, y);
        shade.lineTo(x + 0.8, y + 0.8);
      }
    }
    ctx.lineWidth = Math.max(0.6, ts * 0.016);
    ctx.strokeStyle = withAlpha(PALETTE.indigo, 0.35);
    ctx.stroke(shade);
    ctx.strokeStyle = withAlpha('#ffffff', 0.85);
    ctx.stroke(cracks);
  } else {
    // Seigaiha par bandes : écailles visibles là où un champ lisse est positif.
    const rs = ts * 0.15;
    const a1 = rnd() * TAU;
    const a2 = rnd() * TAU;
    const a3 = rnd() * TAU;
    const field = (x, y) => Math.sin(x / ts * 1.1 + a1) + Math.sin(y / ts * 1.4 + a2) + 0.8 * Math.sin((x - y) / ts * 0.8 + a3);
    const bands = [new Path2D(), new Path2D(), new Path2D()];
    let row = 0;
    for (let y = minY + rs; y < maxY + rs; y += rs * 0.82, row++) {
      for (let x = minX - (row % 2) * rs; x < maxX + rs; x += rs * 2) {
        const f = field(x, y);
        if (f < 0.1) continue;
        const b = bands[f > 1.1 ? 2 : f > 0.55 ? 1 : 0];
        for (let j = 1; j <= 3; j++) {
          const rr = rs * (j / 3) * 0.98;
          b.moveTo(x - rr, y);
          b.arc(x, y, rr, Math.PI, TAU);
        }
      }
    }
    ctx.lineWidth = Math.max(0.7, ts * 0.022);
    bands.forEach((b, i) => {
      ctx.strokeStyle = withAlpha(light, 0.18 + i * 0.12);
      ctx.stroke(b);
    });
    // Reflets : traits horizontaux crème.
    ctx.beginPath();
    for (const [cc, r] of cells) {
      if (rnd() < 0.55) continue;
      const x = (cc + 0.2 + rnd() * 0.6) * ts;
      const y = (r + 0.2 + rnd() * 0.6) * ts;
      lens(ctx, x, y, ts * (0.2 + rnd() * 0.25), ts * 0.035, 0);
    }
    ctx.fillStyle = withAlpha(PALETTE.cream, 0.4);
    ctx.fill();
    // Nénuphars et carpes koï, discrets.
    const free = cells.filter(([cc, r]) => {
      let n = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        if (typeAt(cc + dx, r + dy) === T.WATER) n++;
      return n >= 2;
    });
    shuffle(free, rnd);
    const nPads = Math.min(4, Math.floor(cells.length / 6));
    for (let i = 0; i < nPads && i < free.length; i++) {
      const [cc, r] = free[i];
      lilyPad(ctx, (cc + 0.25 + rnd() * 0.5) * ts, (r + 0.25 + rnd() * 0.5) * ts, ts * (0.09 + rnd() * 0.04), rnd, th);
    }
    const nKoi = Math.min(3, Math.ceil(cells.length / 8));
    for (let i = 0; i < nKoi && nPads + i < free.length; i++) {
      const [cc, r] = free[nPads + i];
      drawKoi(ctx, (cc + 0.5) * ts, (r + 0.5) * ts, rnd() * TAU, ts * 0.34, rnd, i);
    }
    const nCurl = Math.min(3, Math.floor(cells.length / 7));
    for (let i = 0; i < nCurl && nPads + nKoi + i < free.length; i++) {
      const [cc, r] = free[nPads + nKoi + i];
      waveCurl(ctx, (cc + 0.3 + rnd() * 0.4) * ts, (r + 0.45 + rnd() * 0.2) * ts, ts, rnd() < 0.5 ? -1 : 1, light);
    }
  }
  ctx.restore();

  // Rive : écume crème à l'intérieur, puis contour d'encre au pinceau.
  for (const s of shapes) {
    const foam = s.map((p) => [p[0] + p[2] * ts * 0.1, p[1] + p[3] * ts * 0.1]);
    if (!snow) inkLoop(ctx, foam, ts * 0.035, withAlpha(PALETTE.cream, 0.55), rnd, { gap: 0.45, seg: 14 });
    inkLoop(ctx, s, ts * 0.065, withAlpha(INK, 0.85), rnd);
  }
}

// Crête de vague à la Hokusai : boucle d'écume qui s'enroule, petites griffes.
function waveCurl(ctx, x, y, ts, dir, color) {
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const a = Math.PI + t * Math.PI * 1.55;
    const r = ts * (0.2 - t * 0.13);
    pts.push([x + dir * (Math.cos(a) * r + t * ts * 0.06), y + Math.sin(a) * r * 0.75]);
  }
  pts.unshift([x - dir * ts * 0.38, y + ts * 0.04]);
  brushStroke(ctx, pts, ts * 0.05, withAlpha(color, 0.85), { taperIn: 0.3, taperOut: 0.25 });
  ctx.fillStyle = withAlpha(color, 0.8);
  ctx.beginPath();
  for (let j = 0; j < 3; j++) {
    const px = x + dir * ts * (0.12 + j * 0.05);
    const py = y - ts * (0.12 - j * 0.05);
    ctx.moveTo(px + ts * 0.018, py);
    ctx.arc(px, py, ts * 0.018, 0, TAU);
  }
  ctx.fill();
}

function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function lilyPad(ctx, x, y, r, rnd, th) {
  const a = rnd() * TAU;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, r, a + 0.45, a + TAU - 0.15);
  ctx.closePath();
  ctx.fillStyle = mix(th.grass, PALETTE.moss, 0.5);
  ctx.fill();
  ctx.strokeStyle = withAlpha(INK, 0.55);
  ctx.lineWidth = Math.max(0.7, r * 0.12);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(th.grassDark, 0.6);
  ctx.lineWidth = Math.max(0.5, r * 0.06);
  ctx.beginPath();
  for (let j = 1; j < 5; j++) {
    const b = a + 0.45 + j * ((TAU - 0.6) / 5);
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(b) * r * 0.8, y + Math.sin(b) * r * 0.8);
  }
  ctx.stroke();
}

// Carpe koï vue de dessus, un peu sous l'eau (translucide).
function drawKoi(ctx, x, y, a, len, rnd, i) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.globalAlpha = 0.82;
  const w = len * 0.2;
  const bend = (rnd() - 0.5) * 0.5;
  // sillage
  ctx.strokeStyle = withAlpha(PALETTE.cream, 0.3);
  ctx.lineWidth = Math.max(0.6, len * 0.04);
  ctx.beginPath();
  ctx.arc(len * 0.25, 0, len * 0.42, -0.5, 0.5);
  ctx.stroke();
  // queue
  ctx.fillStyle = withAlpha('#f4ece0', 0.8);
  ctx.beginPath();
  ctx.moveTo(-len * 0.32, 0);
  ctx.quadraticCurveTo(-len * 0.5, -w * 0.2 + bend * w, -len * 0.62, -w * 0.9 + bend * w);
  ctx.quadraticCurveTo(-len * 0.52, bend * w, -len * 0.62, w * 0.9 + bend * w);
  ctx.quadraticCurveTo(-len * 0.5, w * 0.2 + bend * w, -len * 0.32, 0);
  ctx.fill();
  // nageoires
  ctx.beginPath();
  lens(ctx, len * 0.12, -w * 0.9, len * 0.18, w * 0.5, -0.9);
  lens(ctx, len * 0.12, w * 0.9, len * 0.18, w * 0.5, 0.9);
  ctx.fill();
  // corps
  const body = new Path2D();
  body.moveTo(len * 0.4, 0);
  body.quadraticCurveTo(len * 0.3, -w * 1.2, -len * 0.05, -w);
  body.quadraticCurveTo(-len * 0.3, -w * 0.6 + bend * w * 0.4, -len * 0.36, bend * w * 0.4);
  body.quadraticCurveTo(-len * 0.3, w * 0.6 + bend * w * 0.4, -len * 0.05, w);
  body.quadraticCurveTo(len * 0.3, w * 1.2, len * 0.4, 0);
  ctx.fillStyle = i % 3 === 2 ? PALETTE.gold : '#f6efe2';
  ctx.fill(body);
  // taches vermillon (kohaku)
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = PALETTE.vermillion;
  ctx.beginPath();
  ctx.ellipse(len * 0.22, -w * 0.2, len * 0.14, w * 0.8, 0.2, 0, TAU);
  ctx.ellipse(-len * 0.12, w * 0.3, len * 0.12, w * 0.7, -0.3, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = withAlpha(INK, 0.45);
  ctx.lineWidth = Math.max(0.5, len * 0.03);
  ctx.stroke(body);
  ctx.restore();
}

// ───────────────────────── Gravier : chemin et jardin sec ─────────────────────────

function drawGravel(ctx, k) {
  const { grid, ts, th, snow, typeAt } = k;
  const rnd = seeded(k.seed + 37);
  const cols = grid.cols;
  const rows = grid.rows;
  const isWalk = (cc, rr) => WALK.has(typeAt(cc, rr));
  const isG = (cc, rr) => {
    const t = typeAt(cc, rr);
    return WALK.has(t) && t !== T.BRIDGE;
  };
  const loops = traceLoops(cols, rows, isG);
  if (!loops.length) return;
  const shapes = loops.map((l) => displace(sampleLoop(toPx(offsetLoop(l, 0.06), ts), ts * 0.42, ts * 0.1), ts * 0.022, ts * 1.2, rnd));
  const gravel = snow ? mix(th.path, '#a39d8e', 0.22) : th.path;
  const groove = snow ? mix(gravel, PALETTE.indigo, 0.4) : mix(th.path, '#6e5c3a', 0.55);
  const ridge = snow ? '#ffffff' : mix(th.path, '#fffdf4', 0.7);

  // Neige : bourrelet blanc le long des bords (neige déblayée).
  if (snow) {
    multiPath(ctx, shapes);
    ctx.strokeStyle = withAlpha(SNOW_WHITE, 0.9);
    ctx.lineWidth = ts * 0.24;
    ctx.stroke();
  }

  ctx.save();
  multiPath(ctx, shapes);
  ctx.fillStyle = gravel;
  ctx.fill();
  ctx.clip();

  // Grain du gravier : points clairs et sombres, par lots.
  const darkG = new Path2D();
  const lightG = new Path2D();
  const pebbles = new Path2D();
  for (let r = 0; r < rows; r++) {
    for (let cc = 0; cc < cols; cc++) {
      if (!isG(cc, r)) continue;
      for (let j = 0; j < 34; j++) {
        const x = (cc + rnd()) * ts;
        const y = (r + rnd()) * ts;
        const s = ts * (0.01 + rnd() * 0.016);
        const p = rnd() < 0.5 ? darkG : lightG;
        p.moveTo(x + s, y);
        p.arc(x, y, s, 0, TAU);
      }
      if (rnd() < 0.7) {
        const x = (cc + 0.15 + rnd() * 0.7) * ts;
        const y = (r + 0.15 + rnd() * 0.7) * ts;
        const s = ts * (0.025 + rnd() * 0.02);
        pebbles.moveTo(x + s * 1.3, y);
        pebbles.ellipse(x, y, s * 1.3, s, 0, 0, TAU);
      }
    }
  }
  ctx.fillStyle = withAlpha(groove, 0.32);
  ctx.fill(darkG);
  ctx.fillStyle = withAlpha(ridge, 0.7);
  ctx.fill(lightG);
  ctx.fillStyle = withAlpha(mix(PALETTE.stone, gravel, 0.4), 0.55);
  ctx.fill(pebbles);

  // Ombre intérieure le long du bord : le gravier est légèrement creusé.
  multiPath(ctx, shapes);
  ctx.strokeStyle = withAlpha(groove, 0.14);
  ctx.lineWidth = ts * 0.3;
  ctx.stroke();
  ctx.strokeStyle = withAlpha(groove, 0.14);
  ctx.lineWidth = ts * 0.13;
  ctx.stroke();

  // Ratissage : sillons parallèles qui suivent le chemin (creux sombre + crête claire).
  const rake = new Path2D();
  const lines = [-0.24, 0, 0.24];
  for (let r = 0; r < rows; r++) {
    for (let cc = 0; cc < cols; cc++) {
      const t = typeAt(cc, r);
      if (!isG(cc, r) || t === T.OPEN || t === T.GOAL) continue;
      const x = cc * ts;
      const y = r * ts;
      const n = isWalk(cc, r - 1);
      const s = isWalk(cc, r + 1);
      const e = isWalk(cc + 1, r);
      const w = isWalk(cc - 1, r);
      if ((e || w) && !(n || s)) {
        for (const q of lines) {
          rake.moveTo(x + (w ? 0 : ts * 0.3), y + ts / 2 + q * ts);
          rake.lineTo(x + (e ? ts : ts * 0.7), y + ts / 2 + q * ts);
        }
      } else if ((n || s) && !(e || w)) {
        for (const q of lines) {
          rake.moveTo(x + ts / 2 + q * ts, y + (n ? 0 : ts * 0.3));
          rake.lineTo(x + ts / 2 + q * ts, y + (s ? ts : ts * 0.7));
        }
      } else if ((n || s) && (e || w) && n + s + e + w === 2) {
        // Virage : arcs concentriques centrés sur le coin intérieur.
        const cx = x + (e ? ts : 0);
        const cy = y + (s ? ts : 0);
        let a0;
        if (e && s) a0 = Math.PI;
        else if (w && s) a0 = Math.PI * 1.5;
        else if (w && n) a0 = 0;
        else a0 = Math.PI / 2;
        for (const q of lines) {
          const rad = ts / 2 + q * ts;
          rake.moveTo(cx + Math.cos(a0) * rad, cy + Math.sin(a0) * rad);
          rake.arc(cx, cy, rad, a0, a0 + Math.PI / 2);
        }
      } else {
        // Carrefour ou cul-de-sac : cercles concentriques.
        for (const q of [0.15, 0.3]) {
          rake.moveTo(x + ts / 2 + ts * q, y + ts / 2);
          rake.arc(x + ts / 2, y + ts / 2, ts * q, 0, TAU);
        }
      }
    }
  }
  ctx.save();
  ctx.translate(ts * 0.022, ts * 0.022);
  ctx.strokeStyle = withAlpha(ridge, 0.85);
  ctx.lineWidth = Math.max(0.8, ts * 0.026);
  ctx.stroke(rake);
  ctx.restore();
  ctx.strokeStyle = withAlpha(groove, 0.5);
  ctx.lineWidth = Math.max(0.8, ts * 0.024);
  ctx.stroke(rake);

  drawOpenGarden(ctx, k, rnd, groove, ridge);
  ctx.restore();

  // Bord d'encre au pinceau, irrégulier.
  for (const s of shapes) inkLoop(ctx, s, ts * 0.07, withAlpha(INK, 0.82), rnd);
}

// Gravier ouvert (cases 'o') : jardin sec plus clair, ratissé en vagues (nami-mon),
// cerné d'un liseré pointillé indigo ; repères discrets aux coins des cases.
function drawOpenGarden(ctx, k, rnd, groove, ridge) {
  const { grid, ts, th, snow, typeAt } = k;
  const isO = (cc, rr) => typeAt(cc, rr) === T.OPEN;
  const loops = traceLoops(grid.cols, grid.rows, isO);
  if (!loops.length) return;
  const shapes = loops.map((l) => sampleLoop(toPx(offsetLoop(l, 0.1), ts), ts * 0.32, ts * 0.06));
  const sand = snow ? mix(th.path, '#e4eef4', 0.5) : mix(th.path, '#fbf6e6', 0.62);
  ctx.save();
  multiPath(ctx, shapes);
  ctx.fillStyle = sand;
  ctx.fill();
  ctx.clip();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    for (const p of s) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  // Ombre douce le long du liseré : le lit de sable est légèrement en creux.
  multiPath(ctx, shapes);
  ctx.strokeStyle = withAlpha(groove, 0.16);
  ctx.lineWidth = ts * 0.2;
  ctx.stroke();
  // Vagues ratissées continues sur tout le jardin (coordonnées absolues).
  const waves = new Path2D();
  const step = ts * 0.2;
  const amp = ts * 0.055;
  const f = TAU / (ts * 0.95);
  for (let y = minY - step, row = 0; y < maxY + step; y += step, row++) {
    const ph = row * 0.9;
    waves.moveTo(minX - ts * 0.1, y + Math.sin((minX - ts * 0.1) * f + ph) * amp);
    for (let x = minX; x < maxX + ts * 0.2; x += ts * 0.08) waves.lineTo(x, y + Math.sin(x * f + ph) * amp);
  }
  ctx.save();
  ctx.translate(0, ts * 0.024);
  ctx.strokeStyle = withAlpha(ridge, 0.95);
  ctx.lineWidth = Math.max(0.8, ts * 0.026);
  ctx.stroke(waves);
  ctx.restore();
  ctx.strokeStyle = withAlpha(groove, 0.42);
  ctx.lineWidth = Math.max(0.8, ts * 0.022);
  ctx.stroke(waves);
  ctx.restore();

  // Liseré pointillé (on peut y poser des pierres).
  const dotsP = new Path2D();
  const dotR = Math.max(0.9, ts * 0.022);
  for (const s of shapes) {
    for (let i = 0; i < s.length; i += 2) {
      const p = s[i];
      const x = p[0] + p[2] * ts * 0.05;
      const y = p[1] + p[3] * ts * 0.05;
      dotsP.moveTo(x + dotR, y);
      dotsP.arc(x, y, dotR, 0, TAU);
    }
  }
  ctx.fillStyle = withAlpha(PALETTE.indigo, 0.6);
  ctx.fill(dotsP);

  // Repères aux coins intérieurs des cases (petites croix d'encre).
  const marks = new Path2D();
  const m = ts * 0.05;
  for (let r = 1; r < grid.rows; r++) {
    for (let cc = 1; cc < grid.cols; cc++) {
      if (!(isO(cc, r) && isO(cc - 1, r) && isO(cc, r - 1) && isO(cc - 1, r - 1))) continue;
      const x = cc * ts;
      const y = r * ts;
      marks.moveTo(x - m, y);
      marks.lineTo(x + m, y);
      marks.moveTo(x, y - m);
      marks.lineTo(x, y + m);
    }
  }
  ctx.strokeStyle = withAlpha(PALETTE.indigo, 0.45);
  ctx.lineWidth = Math.max(0.8, ts * 0.022);
  ctx.stroke(marks);

  // Petits galets décoratifs posés aux coins saillants du jardin.
  for (const l of loops) {
    const n = l.length;
    for (let i = 0; i < n; i++) {
      const a = l[(i - 1 + n) % n];
      const p = l[i];
      const c = l[(i + 1) % n];
      const cross = (p[0] - a[0]) * (c[1] - p[1]) - (p[1] - a[1]) * (c[0] - p[0]);
      if (cross <= 0 || rnd() < 0.45) continue;
      // coin convexe : galets juste à l'intérieur du liseré
      const ix = Math.sign(c[0] - p[0]) - Math.sign(p[0] - a[0]);
      const iy = Math.sign(c[1] - p[1]) - Math.sign(p[1] - a[1]);
      const x = (p[0] + ix * 0.24) * ts;
      const y = (p[1] + iy * 0.24) * ts;
      for (let j = 0; j < 2; j++) {
        const r = ts * (0.035 + rnd() * 0.02);
        ctx.beginPath();
        ctx.ellipse(x + (j ? ix * ts * 0.07 : 0), y + (j ? -iy * ts * 0.02 : 0), r * 1.3, r, rnd(), 0, TAU);
        ctx.fillStyle = mix(PALETTE.stoneDark, PALETTE.stone, 0.4);
        ctx.fill();
        ctx.strokeStyle = withAlpha(INK, 0.6);
        ctx.lineWidth = Math.max(0.6, ts * 0.016);
        ctx.stroke();
      }
    }
  }
}

// ───────────────────────── Pont ─────────────────────────

// Pont de bois à garde-corps vermillon ; les cases contiguës forment un seul pont.
function drawBridges(ctx, k) {
  const { grid, ts, typeAt } = k;
  const done = new Set();
  for (let r = 0; r < grid.rows; r++) {
    for (let cc = 0; cc < grid.cols; cc++) {
      if (typeAt(cc, r) !== T.BRIDGE || done.has(r * grid.cols + cc)) continue;
      const horiz = WALK.has(typeAt(cc - 1, r)) || WALK.has(typeAt(cc + 1, r));
      let n = 0;
      while (typeAt(cc + (horiz ? n : 0), r + (horiz ? 0 : n)) === T.BRIDGE) {
        done.add((r + (horiz ? 0 : n)) * grid.cols + cc + (horiz ? n : 0));
        n++;
      }
      drawBridge(ctx, cc * ts, r * ts, n, horiz, ts);
    }
  }
}

function drawBridge(ctx, x0, y0, n, horiz, ts) {
  ctx.save();
  // repère local : le pont court selon +x (rotation pour un pont vertical)
  if (horiz) ctx.translate(x0, y0 + ts / 2);
  else {
    ctx.translate(x0 + ts / 2, y0);
    ctx.rotate(Math.PI / 2);
  }
  const L = n * ts;
  const ext = ts * 0.14;
  const half = ts * 0.34;
  // ombre sur l'eau
  ctx.fillStyle = withAlpha(INK, 0.28);
  ctx.fillRect(-ext + ts * 0.04, -half + ts * (horiz ? 0.1 : -0.06), L + ext * 2, half * 2 + ts * 0.04);
  // tablier
  ctx.fillStyle = '#9a6b45';
  ctx.fillRect(-ext, -half, L + ext * 2, half * 2);
  // planches : alternance de tons et joints d'encre
  const pw = ts * 0.15;
  for (let x = -ext, i = 0; x < L + ext; x += pw, i++) {
    ctx.fillStyle = i % 3 === 0 ? '#a87650' : i % 3 === 1 ? '#8d603e' : '#9a6b45';
    ctx.fillRect(x, -half, Math.min(pw, L + ext - x), half * 2);
  }
  ctx.strokeStyle = withAlpha(INK, 0.5);
  ctx.lineWidth = Math.max(0.7, ts * 0.02);
  ctx.beginPath();
  for (let x = -ext + pw; x < L + ext; x += pw) {
    ctx.moveTo(x, -half);
    ctx.lineTo(x, half);
  }
  ctx.stroke();
  // pont bombé (taikobashi) : extrémités dans l'ombre, sommet éclairé
  const arch = ctx.createLinearGradient(-ext, 0, L + ext, 0);
  arch.addColorStop(0, withAlpha(INK, 0.3));
  arch.addColorStop(0.3, withAlpha(INK, 0));
  arch.addColorStop(0.5, withAlpha('#f6dcb0', 0.22));
  arch.addColorStop(0.7, withAlpha(INK, 0));
  arch.addColorStop(1, withAlpha(INK, 0.3));
  ctx.fillStyle = arch;
  ctx.fillRect(-ext, -half, L + ext * 2, half * 2);
  ctx.strokeStyle = withAlpha(INK, 0.75);
  ctx.lineWidth = Math.max(1, ts * 0.03);
  ctx.strokeRect(-ext, -half, L + ext * 2, half * 2);
  // garde-corps vermillon, poteaux à chapeau d'or (giboshi)
  for (const side of [-1, 1]) {
    const y = side * (half - ts * 0.02);
    ctx.fillStyle = PALETTE.vermillion;
    ctx.fillRect(-ext, y - ts * 0.045, L + ext * 2, ts * 0.09);
    ctx.fillStyle = withAlpha(INK, 0.25);
    ctx.fillRect(-ext, y + ts * 0.01, L + ext * 2, ts * 0.035);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.8, ts * 0.024);
    ctx.strokeRect(-ext, y - ts * 0.045, L + ext * 2, ts * 0.09);
    for (let i = 0; i <= n; i++) {
      const px = i === 0 ? -ext : i === n ? L + ext : i * ts;
      ctx.fillStyle = mix(PALETTE.vermillion, INK, 0.25);
      ctx.fillRect(px - ts * 0.06, y - ts * 0.06, ts * 0.12, ts * 0.12);
      ctx.strokeRect(px - ts * 0.06, y - ts * 0.06, ts * 0.12, ts * 0.12);
      ctx.fillStyle = PALETTE.gold;
      ctx.beginPath();
      ctx.arc(px, y, ts * 0.038, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ───────────────────────── Socles : dalles de pierre ─────────────────────────

function drawSlots(ctx, k) {
  const { grid, ts, th, snow, typeAt } = k;
  const rnd = seeded(k.seed + 41);
  for (let r = 0; r < grid.rows; r++) {
    for (let cc = 0; cc < grid.cols; cc++) {
      if (typeAt(cc, r) !== T.SLOT) continue;
      const el = grid.slotElement ? grid.slotElement[grid.idx(cc, r)] : null;
      drawSlab(ctx, cc * ts + ts / 2, r * ts + ts / 2, ts, rnd, th, snow, el);
    }
  }
}

// Dalle taillée vue de trois quarts : face claire, chant sombre, contour d'encre,
// anneau gravé au centre (l'emplacement de la lanterne), mousse sur un coin.
// Socle réservé à un élément (el) : lavis discret de sa couleur et sa FORME gravée
// au centre (lisible sans la couleur) ; le socle universel reste neutre.
function drawSlab(ctx, x, y, ts, rnd, th, snow, el = null) {
  const hw = ts * (0.38 + rnd() * 0.02);
  const hh = ts * (0.31 + rnd() * 0.02);
  const cy = y - ts * 0.03;
  const thick = ts * 0.08;
  const face = displace(
    sampleLoop(
      [
        [x - hw, cy - hh],
        [x + hw, cy - hh],
        [x + hw, cy + hh],
        [x - hw, cy + hh],
      ],
      ts * 0.1,
      ts * 0.07,
    ),
    ts * 0.012,
    ts * 0.5,
    rnd,
  );
  const shifted = (dx, dy) => face.map((p) => [p[0] + dx, p[1] + dy]);
  const faceCol = snow ? mix(PALETTE.stone, th.paper, 0.35) : mix(PALETTE.stone, th.paper, 0.5);
  const sideCol = mix(PALETTE.stoneDark, PALETTE.stone, 0.25);
  // ombre portée
  softShadow(ctx, x + ts * 0.05, cy + hh + thick * 0.6, hw * 1.25, ts * 0.16, 0.5);
  // chant (épaisseur)
  polyPath(ctx, shifted(0, thick));
  ctx.fillStyle = sideCol;
  ctx.fill();
  ctx.strokeStyle = withAlpha(INK, 0.8);
  ctx.lineWidth = Math.max(1, ts * 0.035);
  ctx.stroke();
  // face
  polyPath(ctx, face);
  ctx.fillStyle = faceCol;
  ctx.fill();
  ctx.save();
  ctx.clip();
  wash(ctx, x - hw * 0.45, cy - hh * 0.5, hw * 1.3, '#fffaf0', 0.45);
  wash(ctx, x + hw * 0.9, cy + hh * 0.9, hw * 1.1, PALETTE.stoneDark, 0.35);
  // grain de la pierre
  ctx.beginPath();
  for (let j = 0; j < 9; j++) {
    const gx = x + (rnd() - 0.5) * hw * 1.8;
    const gy = cy + (rnd() - 0.5) * hh * 1.8;
    const s = ts * (0.008 + rnd() * 0.012);
    ctx.moveTo(gx + s, gy);
    ctx.arc(gx, gy, s, 0, TAU);
  }
  ctx.fillStyle = withAlpha(PALETTE.stoneDark, 0.45);
  ctx.fill();
  ctx.restore();
  // contour d'encre au pinceau (plus appuyé en bas)
  inkLoop(ctx, face, ts * 0.04, withAlpha(INK, 0.8), rnd, { seg: 12 });
  const look = el ? elementLook(el) : null;
  if (look) {
    polyPath(ctx, face);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = withAlpha(look.color, 0.1);
    ctx.fill();
    wash(ctx, x, cy, hw * 1.1, look.color, 0.16);
    ctx.restore();
    engraveShape(ctx, look, x, cy + hh * 0.06, ts);
    return finishSlab(ctx, x, cy, hw, hh, ts, rnd, th, snow);
  }
  // anneau gravé : creux sombre puis lèvre claire décalée
  const ry = cy + hh * 0.08;
  ctx.lineWidth = Math.max(0.9, ts * 0.028);
  ctx.strokeStyle = withAlpha(PALETTE.stoneDark, 0.6);
  ctx.beginPath();
  ctx.ellipse(x, ry, ts * 0.17, ts * 0.13, 0, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = withAlpha('#fffaf0', 0.7);
  ctx.beginPath();
  ctx.ellipse(x + ts * 0.012, ry + ts * 0.016, ts * 0.17, ts * 0.13, 0, 0.2, Math.PI - 0.2);
  ctx.stroke();
  finishSlab(ctx, x, cy, hw, hh, ts, rnd, th, snow);
}

// Forme d'un élément gravée dans la dalle : creux teinté de la couleur de
// l'élément, bord d'encre, lèvre claire décalée vers le bas (lumière d'en haut).
function engraveShape(ctx, look, x, y, ts) {
  const R = ts * 0.15;
  const oy = -shapeCenterY(look.shape) * R * 0.6;
  ctx.save();
  ctx.lineJoin = 'round';
  // lèvre claire (décalée)
  ctx.beginPath();
  shapePath(ctx, look.shape, x + ts * 0.014, y + oy + ts * 0.018, R);
  ctx.strokeStyle = withAlpha('#fffaf0', 0.75);
  ctx.lineWidth = Math.max(1, ts * 0.03);
  ctx.stroke();
  // creux peint
  ctx.beginPath();
  shapePath(ctx, look.shape, x, y + oy, R);
  ctx.fillStyle = withAlpha(mix(look.color, PALETTE.stoneDark, 0.25), 0.78);
  ctx.fill();
  ctx.strokeStyle = withAlpha(INK, 0.75);
  ctx.lineWidth = Math.max(1, ts * 0.032);
  ctx.stroke();
  // ombre intérieure en haut du creux
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  shapePath(ctx, look.shape, x + ts * 0.02, y + oy + ts * 0.03, R);
  ctx.rect(x - R * 3, y - R * 3, R * 6, R * 6);
  ctx.fillStyle = withAlpha(INK, 0.3);
  ctx.fill('evenodd');
  ctx.restore();
  ctx.restore();
}

// Finitions communes : fissure, mousse ou neige sur le bord arrière.
function finishSlab(ctx, x, cy, hw, hh, ts, rnd, th, snow) {
  // fissure fine, parfois
  if (rnd() < 0.4) {
    const sx = x + (rnd() < 0.5 ? -hw : hw) * 0.95;
    const sy = cy + (rnd() - 0.5) * hh;
    brushStroke(ctx, quadPts(sx, sy, sx + (x - sx) * 0.3, sy + ts * 0.05, sx + (x - sx) * 0.45, sy + ts * 0.02, 5), ts * 0.02, withAlpha(INK, 0.45));
  }
  // mousse (苔点) ou neige sur le bord arrière
  if (snow) {
    ctx.beginPath();
    const sy = cy - hh;
    ctx.moveTo(x - hw * 0.8, sy + ts * 0.02);
    ctx.quadraticCurveTo(x - hw * 0.2, sy - ts * 0.04, x + hw * 0.75, sy + ts * 0.01);
    ctx.quadraticCurveTo(x + hw * 0.2, sy + ts * 0.07, x - hw * 0.8, sy + ts * 0.02);
    ctx.fillStyle = SNOW_WHITE;
    ctx.fill();
  } else if (rnd() < 0.75) {
    const sx = x + (rnd() < 0.5 ? -1 : 1) * hw * 0.78;
    const sy = cy + (rnd() < 0.6 ? -1 : 1) * hh * 0.75;
    ctx.beginPath();
    for (let j = 0; j < 4; j++) lens(ctx, sx + (rnd() - 0.5) * ts * 0.12, sy + (rnd() - 0.5) * ts * 0.06, ts * (0.05 + rnd() * 0.04), ts * 0.03, (rnd() - 0.5) * 0.8);
    ctx.fillStyle = withAlpha(mix(th.grassDark, PALETTE.moss, 0.4), 0.8);
    ctx.fill();
  }
}

// ───────────────────────── Herbes ─────────────────────────

function drawGrass(ctx, k) {
  const { grid, ts, th, snow, typeAt } = k;
  const rnd = seeded(k.seed + 53);
  const darkBlades = new Path2D();
  const lightBlades = new Path2D();
  const petals = [];
  const tuft = (x, y, s) => {
    const nb = 3 + Math.floor(rnd() * 3);
    for (let j = 0; j < nb; j++) {
      const a = -Math.PI / 2 + (j / (nb - 1) - 0.5) * 1.3 + (rnd() - 0.5) * 0.3;
      const l = ts * s * (0.7 + rnd() * 0.5);
      const p = j === 1 && !snow ? lightBlades : darkBlades;
      blade(p, x + (j - nb / 2) * ts * 0.015, y, x + Math.cos(a) * l, y + Math.sin(a) * l, l * 0.18 * (a < -Math.PI / 2 ? -1 : 1), ts * 0.04);
    }
  };
  for (let r = 0; r < grid.rows; r++) {
    for (let cc = 0; cc < grid.cols; cc++) {
      const t = typeAt(cc, r);
      if (t === T.GRASS) {
        const nT = rnd() < 0.35 ? 2 : 1;
        for (let j = 0; j < nT; j++) tuft((cc + 0.2 + rnd() * 0.6) * ts, (r + 0.35 + rnd() * 0.5) * ts, snow ? 0.13 : 0.18);
        if (!snow && rnd() < 0.14) {
          // fleurettes crème à cœur d'or
          const fx = (cc + 0.25 + rnd() * 0.5) * ts;
          const fy = (r + 0.25 + rnd() * 0.5) * ts;
          for (let j = 0; j < 3; j++) petals.push([fx + (rnd() - 0.5) * ts * 0.25, fy + (rnd() - 0.5) * ts * 0.18]);
        }
      } else if (t === T.TREE || t === T.ROCK) {
        // touffes au pied
        tuft((cc + 0.2 + rnd() * 0.15) * ts, (r + 0.85) * ts, 0.13);
        tuft((cc + 0.65 + rnd() * 0.15) * ts, (r + 0.88) * ts, 0.12);
      } else if (t === T.SLOT && rnd() < 0.35) {
        tuft((cc + (rnd() < 0.5 ? 0.08 : 0.92)) * ts, (r + 0.88) * ts, 0.1);
      }
    }
  }
  ctx.fillStyle = withAlpha(snow ? mix(th.grassDark, INK, 0.25) : th.grassDark, 0.8);
  ctx.fill(darkBlades);
  ctx.fillStyle = withAlpha(mix(th.grass, th.grassDark, 0.2), 0.85);
  ctx.fill(lightBlades);
  if (petals.length) {
    const pr = ts * 0.024;
    ctx.beginPath();
    for (const [x, y] of petals) {
      for (let j = 0; j < 5; j++) {
        const a = (j / 5) * TAU;
        ctx.moveTo(x + Math.cos(a) * pr * 1.4 + pr, y + Math.sin(a) * pr * 1.4);
        ctx.arc(x + Math.cos(a) * pr * 1.4, y + Math.sin(a) * pr * 1.4, pr, 0, TAU);
      }
    }
    ctx.fillStyle = withAlpha(PALETTE.cream, 0.95);
    ctx.fill();
    ctx.beginPath();
    for (const [x, y] of petals) {
      ctx.moveTo(x + pr, y);
      ctx.arc(x, y, pr, 0, TAU);
    }
    ctx.fillStyle = PALETTE.gold;
    ctx.fill();
  }
  if (snow) {
    // pointes givrées
    ctx.beginPath();
    for (let r = 0; r < grid.rows; r++) {
      for (let cc = 0; cc < grid.cols; cc++) {
        if (typeAt(cc, r) !== T.GRASS || rnd() < 0.5) continue;
        lens(ctx, (cc + 0.2 + rnd() * 0.6) * ts, (r + 0.3 + rnd() * 0.5) * ts, ts * 0.14, ts * 0.05, 0);
      }
    }
    ctx.fillStyle = withAlpha(SNOW_WHITE, 0.85);
    ctx.fill();
  }
}

// ───────────────────────── Rochers ─────────────────────────

function drawRocks(ctx, k) {
  const { grid, ts, th, typeAt } = k;
  const rnd = seeded(k.seed + 67);
  for (let r = 0; r < grid.rows; r++) {
    for (let cc = 0; cc < grid.cols; cc++) {
      if (typeAt(cc, r) !== T.ROCK) continue;
      const x = cc * ts + ts / 2;
      const y = r * ts + ts * 0.6;
      // composition à deux pierres (une grande, une petite), comme au jardin sec
      const side = rnd() < 0.5 ? -1 : 1;
      if (rnd() < 0.7) drawRock(ctx, x + side * ts * 0.26, y - ts * 0.12, ts * 0.17, rnd, th);
      drawRock(ctx, x - side * ts * 0.05, y, ts * 0.33, rnd, th);
    }
  }
}

// Rocher anguleux à facettes : face éclairée, flanc dans l'ombre, contour
// d'encre appuyé côté ombre, points de mousse (苔点), neige éventuelle.
export function drawRock(ctx, x, y, r, rnd, th) {
  const snow = !!th.snowCaps;
  const n = 6;
  const top = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI;
    const rr = r * (0.82 + rnd() * 0.3);
    const lift = i > 0 && i < n ? 1.05 + rnd() * 0.2 : 0.4;
    top.push([x + Math.cos(a) * rr * 1.08, y + r * 0.25 + Math.sin(a) * rr * lift]);
  }
  const base = [
    [x + r * 0.7, y + r * 0.45],
    [x - r * 0.1, y + r * 0.52],
    [x - r * 0.75, y + r * 0.42],
  ];
  const poly = top.concat(base);
  const apexI = 2 + Math.floor(rnd() * 3);
  const apex = top[apexI];
  const knee = [x + r * (0.05 + rnd() * 0.2), y + r * 0.3];
  softShadow(ctx, x + r * 0.2, y + r * 0.48, r * 1.35, r * 0.4, 0.55);
  polyPath(ctx, poly);
  ctx.fillStyle = PALETTE.stone;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // flanc droit dans l'ombre
  ctx.beginPath();
  ctx.moveTo(apex[0], apex[1]);
  for (let i = apexI + 1; i <= n; i++) ctx.lineTo(top[i][0], top[i][1]);
  ctx.lineTo(base[0][0], base[0][1]);
  ctx.lineTo(knee[0], knee[1] + r * 0.3);
  ctx.lineTo(knee[0], knee[1]);
  ctx.closePath();
  ctx.fillStyle = withAlpha(PALETTE.stoneDark, 0.55);
  ctx.fill();
  // face éclairée
  ctx.beginPath();
  ctx.moveTo(top[1][0], top[1][1]);
  for (let i = 2; i <= apexI; i++) ctx.lineTo(top[i][0], top[i][1]);
  ctx.lineTo(knee[0] - r * 0.15, knee[1] - r * 0.25);
  ctx.closePath();
  ctx.fillStyle = withAlpha('#fffaf0', 0.3);
  ctx.fill();
  ctx.restore();
  // contour : fin en haut, appuyé à droite et en bas
  brushStroke(ctx, top.slice(0, apexI + 1), Math.max(1, r * 0.09), withAlpha(INK, 0.85), { taperIn: 0.2, taperOut: 0.1 });
  brushStroke(ctx, top.slice(apexI).concat(base), Math.max(1.2, r * 0.15), INK, { taperIn: 0.1, taperOut: 0.15 });
  brushStroke(ctx, [base[1], base[2], top[0]], Math.max(1, r * 0.11), withAlpha(INK, 0.85), { taperIn: 0.2, taperOut: 0.3 });
  // arête intérieure
  brushStroke(ctx, quadPts(apex[0], apex[1], (apex[0] + knee[0]) / 2 - r * 0.08, (apex[1] + knee[1]) / 2, knee[0], knee[1], 6), Math.max(0.8, r * 0.08), withAlpha(INK, 0.6), { taperIn: 0.1, taperOut: 0.6 });
  if (snow) {
    // calotte de neige sur le sommet
    ctx.beginPath();
    ctx.moveTo(top[1][0], top[1][1] + r * 0.05);
    for (let i = 1; i < n; i++) ctx.lineTo(top[i][0], top[i][1] - r * 0.04);
    ctx.quadraticCurveTo(x + r * 0.3, y - r * 0.1, x, y - r * 0.2);
    ctx.quadraticCurveTo(x - r * 0.4, y - r * 0.05, top[1][0], top[1][1] + r * 0.05);
    ctx.fillStyle = SNOW_WHITE;
    ctx.fill();
    ctx.strokeStyle = withAlpha(PALETTE.indigoLight, 0.35);
    ctx.lineWidth = Math.max(0.6, r * 0.05);
    ctx.stroke();
  } else {
    // mousse sur le sommet et points d'encre
    ctx.beginPath();
    for (let j = 0; j < 5; j++) lens(ctx, apex[0] - r * 0.25 + (rnd() - 0.5) * r * 0.5, apex[1] + r * 0.12 + rnd() * r * 0.12, r * (0.22 + rnd() * 0.2), r * 0.12, (rnd() - 0.5) * 0.6);
    ctx.fillStyle = withAlpha(th.grass, 0.85);
    ctx.fill();
  }
  ctx.beginPath();
  for (let j = 0; j < 4; j++) lens(ctx, x + (rnd() - 0.6) * r, y - r * 0.2 + rnd() * r * 0.4, r * 0.14, r * 0.09, (rnd() - 0.5) * 0.6);
  ctx.fillStyle = withAlpha(snow ? PALETTE.indigo : mix(th.grassDark, INK, 0.3), 0.7);
  ctx.fill();
}

// ───────────────────────── Arbres ─────────────────────────

function drawTrees(ctx, k) {
  const { grid, ts, th, typeAt } = k;
  const rnd = seeded(k.seed + 79);
  for (let r = 0; r < grid.rows; r++) {
    for (let cc = 0; cc < grid.cols; cc++) {
      if (typeAt(cc, r) !== T.TREE) continue;
      const x = cc * ts + ts / 2 + (rnd() - 0.5) * ts * 0.14;
      const y = r * ts + ts * 0.86;
      if (th.tree === 'sakura') drawSakura(ctx, x, y, ts, rnd, th);
      else drawPine(ctx, x, y, ts, rnd, th);
    }
  }
}

// Pin japonais (matsu) : tronc tortueux, plateaux d'aiguilles aplatis cernés
// d'encre, hachures en éventail ; neige sur les plateaux si th.snowCaps.
export function drawPine(ctx, x, y, ts, rnd, th) {
  const h = ts * (0.92 + rnd() * 0.25);
  const lean = (rnd() - 0.5) * 0.3;
  const dark = th.grassDark;
  const mid = mix(th.grass, th.grassDark, 0.35);
  const light = mix(th.grass, '#e8e2b8', 0.25);
  softShadow(ctx, x + ts * 0.1, y, ts * 0.5, ts * 0.15, 0.4);
  // tronc tortueux
  const tx = x + lean * ts * 0.6;
  const trunk = quadPts(x, y, x - ts * 0.12 - lean * ts * 0.3, y - h * 0.45, tx, y - h * 0.86, 10);
  brushStroke(ctx, trunk, ts * 0.13, '#3a2a1f', { taperIn: 0.02, taperOut: 0.55 });
  brushStroke(ctx, trunk.map((p) => [p[0] - ts * 0.025, p[1]]), ts * 0.035, withAlpha('#8a6a4a', 0.6), { taperIn: 0.1, taperOut: 0.5 });
  // racines
  brushStroke(ctx, quadPts(x, y - ts * 0.04, x - ts * 0.08, y, x - ts * 0.16, y + ts * 0.02, 5), ts * 0.05, '#3a2a1f', { taperIn: 0.05, taperOut: 0.8 });
  brushStroke(ctx, quadPts(x, y - ts * 0.04, x + ts * 0.08, y, x + ts * 0.14, y + ts * 0.01, 5), ts * 0.045, '#3a2a1f', { taperIn: 0.05, taperOut: 0.8 });
  // plateaux (du bas vers le haut) : [dx, hauteur, demi-largeur]
  const side = rnd() < 0.5 ? -1 : 1;
  const pads = [
    [-0.22 * side, 0.48, 0.33],
    [0.22 * side, 0.66, 0.29],
    [-0.03 * side + lean * 0.5, 0.88, 0.25],
  ];
  if (rnd() < 0.5) pads.splice(1, 0, [0.36 * side, 0.36, 0.2]);
  for (const [dx, dy, rw] of pads) {
    const cx = x + dx * ts + lean * ts * dy * 0.5;
    const cy = y - dy * h;
    const rx = rw * ts * (0.9 + rnd() * 0.2);
    const ry = rx * 0.56;
    // branche
    const bx = x + (tx - x) * dy;
    brushStroke(ctx, quadPts(bx, cy + ry * 0.4, (bx + cx) / 2, cy + ry * 0.9, cx, cy + ry * 0.2, 5), ts * 0.04, '#3a2a1f', { taperIn: 0.1, taperOut: 0.5 });
    pinePad(ctx, cx, cy, rx, ry, rnd, ts, dark, mid, light, th.snowCaps);
  }
}

function pinePad(ctx, cx, cy, rx, ry, rnd, ts, dark, mid, light, snow) {
  const sc = [0.45 + rnd() * 0.25, 0.55 + rnd() * 0.25, 0.45 + rnd() * 0.25];
  const bump = 1.05 + rnd() * 0.25;
  // nuage aplati : trois bosses sur le dessus, festons sous le plateau
  const pad = new Path2D();
  pad.moveTo(cx - rx, cy);
  pad.quadraticCurveTo(cx - rx * 1.02, cy - ry * 1.05, cx - rx * 0.38, cy - ry * 0.92);
  pad.quadraticCurveTo(cx, cy - ry * 1.5 * bump, cx + rx * 0.38, cy - ry * 0.92);
  pad.quadraticCurveTo(cx + rx * 1.02, cy - ry * 1.05, cx + rx, cy);
  for (let i = 0; i < 3; i++) {
    const x0 = cx + rx - (2 * rx * i) / 3;
    const x1 = cx + rx - (2 * rx * (i + 1)) / 3;
    pad.quadraticCurveTo((x0 + x1) / 2, cy + ry * sc[i], x1, cy);
  }
  pad.closePath();
  ctx.fillStyle = dark;
  ctx.fill(pad);
  // dôme plus clair (lumière sur le dessus)
  ctx.save();
  ctx.clip(pad);
  ctx.fillStyle = mid;
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.1, cy - ry * 0.55, rx * 0.86, ry * 0.7, 0, 0, TAU);
  ctx.fill();
  // aiguilles : hachures en éventail
  ctx.strokeStyle = withAlpha(light, 0.75);
  ctx.lineWidth = Math.max(0.6, ts * 0.016);
  ctx.beginPath();
  const nb = Math.max(7, Math.round(rx / (ts * 0.03)));
  for (let i = 0; i < nb; i++) {
    const a = Math.PI + 0.25 + (i / (nb - 1)) * (Math.PI - 0.5);
    const ox = cx + Math.cos(a) * rx * 0.25;
    const oy = cy + ry * 0.1 + Math.sin(a) * ry * 0.2;
    ctx.moveTo(ox, oy);
    ctx.lineTo(cx + Math.cos(a) * rx * 0.95, cy + Math.sin(a) * ry * 1.25);
  }
  ctx.stroke();
  ctx.restore();
  // contour d'encre : festons du dessous appuyés, dôme léger
  ctx.strokeStyle = withAlpha(INK, 0.55);
  ctx.lineWidth = Math.max(0.7, ts * 0.018);
  ctx.stroke(pad);
  brushStroke(ctx, quadPts(cx - rx, cy, cx, cy + ry * 0.75, cx + rx, cy, 10), Math.max(1, ts * 0.04), withAlpha(INK, 0.7), { taperIn: 0.2, taperOut: 0.2 });
  if (snow) {
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.95, cy - ry * 0.3);
    ctx.quadraticCurveTo(cx - rx * 0.98, cy - ry * 1.1, cx - rx * 0.38, cy - ry * 1.0);
    ctx.quadraticCurveTo(cx, cy - ry * 1.58 * bump, cx + rx * 0.38, cy - ry * 1.0);
    ctx.quadraticCurveTo(cx + rx * 0.98, cy - ry * 1.1, cx + rx * 0.95, cy - ry * 0.3);
    ctx.quadraticCurveTo(cx + rx * 0.5, cy - ry * 0.75, cx + rx * 0.1, cy - ry * 0.6);
    ctx.quadraticCurveTo(cx - rx * 0.4, cy - ry * 0.85, cx - rx * 0.95, cy - ry * 0.3);
    ctx.fillStyle = SNOW_WHITE;
    ctx.fill();
    ctx.strokeStyle = withAlpha(PALETTE.indigoLight, 0.45);
    ctx.lineWidth = Math.max(0.6, ts * 0.016);
    ctx.stroke();
  }
}

// Cerisier (theme.tree 'sakura') : tronc sombre ramifié, nuées de fleurs roses.
export function drawSakura(ctx, x, y, ts, rnd, th) {
  const h = ts * (0.9 + rnd() * 0.2);
  softShadow(ctx, x + ts * 0.1, y, ts * 0.52, ts * 0.15, 0.4);
  const bark = '#3b2a26';
  const trunk = quadPts(x, y, x - ts * 0.06, y - h * 0.3, x + ts * 0.02, y - h * 0.55, 8);
  brushStroke(ctx, trunk, ts * 0.12, bark, { taperIn: 0.02, taperOut: 0.3 });
  const top = trunk[trunk.length - 1];
  const tips = [];
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (i / 3 - 0.5) * 1.9 + (rnd() - 0.5) * 0.3;
    const l = h * (0.3 + rnd() * 0.12);
    const ex = top[0] + Math.cos(a) * l * 1.1;
    const ey = top[1] + Math.sin(a) * l * 0.8;
    tips.push([ex, ey]);
    brushStroke(ctx, quadPts(top[0], top[1], (top[0] + ex) / 2, (top[1] + ey) / 2 - ts * 0.05, ex, ey, 6), ts * 0.05, bark, { taperIn: 0.05, taperOut: 0.7 });
  }
  const pinks = ['#d98a9a', '#ebb0bb', '#f6d3d8'];
  const clusters = [];
  for (const [ex, ey] of tips) {
    for (let j = 0; j < 2; j++) clusters.push([ex + (rnd() - 0.5) * ts * 0.22, ey + (rnd() - 0.5) * ts * 0.14, ts * (0.12 + rnd() * 0.07)]);
  }
  clusters.sort((a, b) => a[1] - b[1]);
  // dessous sombre, puis masses festonnées, puis lumière
  for (let pass = 0; pass < 3; pass++) {
    ctx.beginPath();
    for (const [cx, cy, r] of clusters) {
      const ox = pass === 0 ? r * 0.08 : pass === 2 ? -r * 0.18 : 0;
      const oy = pass === 0 ? r * 0.15 : pass === 2 ? -r * 0.22 : 0;
      const rr = pass === 2 ? r * 0.55 : r;
      ctx.moveTo(cx + ox + rr * 0.62, cy + oy);
      ctx.arc(cx + ox, cy + oy, rr * 0.62, 0, TAU);
      for (let j = 0; j < 5; j++) {
        const a = (j / 5) * TAU + cx;
        const bx = cx + ox + Math.cos(a) * rr * 0.48;
        const by = cy + oy + Math.sin(a) * rr * 0.4;
        ctx.moveTo(bx + rr * 0.5, by);
        ctx.arc(bx, by, rr * 0.5, 0, TAU);
      }
    }
    ctx.fillStyle = pinks[pass];
    ctx.fill();
  }
  // fleurs blanches éparses
  ctx.beginPath();
  for (const [cx, cy, r] of clusters) {
    for (let j = 0; j < 3; j++) {
      const fx = cx + (rnd() - 0.5) * r * 1.4;
      const fy = cy + (rnd() - 0.6) * r;
      ctx.moveTo(fx + ts * 0.018, fy);
      ctx.arc(fx, fy, ts * 0.018, 0, TAU);
    }
  }
  ctx.fillStyle = withAlpha('#fff8f4', 0.9);
  ctx.fill();
  ctx.strokeStyle = withAlpha(INK, 0.45);
  ctx.lineWidth = Math.max(0.6, ts * 0.016);
  ctx.beginPath();
  for (const [cx, cy, r] of clusters) {
    ctx.moveTo(cx + r, cy + r * 0.15);
    ctx.arc(cx, cy + r * 0.15, r, 0.1, Math.PI - 0.1);
  }
  ctx.stroke();
  // pétales tombés
  ctx.fillStyle = withAlpha(pinks[1], 0.9);
  ctx.beginPath();
  for (let j = 0; j < 6; j++) lens(ctx, x + (rnd() - 0.5) * ts * 0.8, y + (rnd() - 0.4) * ts * 0.2, ts * 0.05, ts * 0.03, rnd() * TAU);
  ctx.fill();
}

// ───────────────────────── Apparitions et sanctuaire ─────────────────────────

// Sol meurtri sous les portails : fissures d'encre qui rayonnent (le portail est animé ailleurs).
function drawSpawnScars(ctx, k) {
  const { grid, ts } = k;
  const rnd = seeded(k.seed + 83);
  for (const s of grid.spawns) {
    const x = grid.cx(s) * ts;
    const y = grid.cy(s) * ts;
    wash(ctx, x, y, ts * 0.55, INK, 0.2);
    for (let j = 0; j < 5; j++) {
      const a = (j / 5) * TAU + rnd() * 0.8;
      const l = ts * (0.28 + rnd() * 0.14);
      const mx = x + Math.cos(a + 0.2) * l * 0.55;
      const my = y + Math.sin(a + 0.2) * l * 0.55;
      brushStroke(ctx, quadPts(x + Math.cos(a) * ts * 0.12, y + Math.sin(a) * ts * 0.12, mx, my, x + Math.cos(a) * l, y + Math.sin(a) * l, 5), ts * 0.03, withAlpha(INK, 0.5), { taperIn: 0.1, taperOut: 0.8 });
    }
  }
}

function drawGoals(ctx, k) {
  const { grid, ts, th, typeAt } = k;
  const rnd = seeded(k.seed + 97);
  for (const gi of grid.goals) {
    const cc = grid.col(gi);
    const r = grid.row(gi);
    const x = grid.cx(gi) * ts;
    const y = grid.cy(gi) * ts;
    // parvis dallé (ishidatami)
    const rr = ts * 0.44;
    softShadow(ctx, x, y + ts * 0.12, rr * 1.1, rr * 0.7, 0.3);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y + ts * 0.06, rr, rr * 0.82, 0, 0, TAU);
    ctx.fillStyle = mix(PALETTE.stone, th.paper, 0.55);
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = withAlpha(PALETTE.stoneDark, 0.55);
    ctx.lineWidth = Math.max(0.7, ts * 0.018);
    ctx.beginPath();
    const cs = ts * 0.15;
    for (let j = -3; j <= 3; j++) {
      const yy = y + ts * 0.06 + j * cs;
      ctx.moveTo(x - rr, yy);
      ctx.lineTo(x + rr, yy);
      for (let i = -3; i <= 3; i++) {
        const xx = x + (i + (j % 2 ? 0.5 : 0)) * cs * 1.3 + (rnd() - 0.5) * cs * 0.2;
        ctx.moveTo(xx, yy);
        ctx.lineTo(xx, yy + cs);
      }
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = withAlpha(INK, 0.7);
    ctx.lineWidth = Math.max(1, ts * 0.03);
    ctx.beginPath();
    ctx.ellipse(x, y + ts * 0.06, rr, rr * 0.82, 0, 0, TAU);
    ctx.stroke();
    // lanternes de pierre de part et d'autre, si la place est libre
    for (const s of [-1, 1]) {
      const t = typeAt(cc + s, r);
      if (t === T.GRASS || t === T.VOID || t === T.ROCK) drawStoneLantern(ctx, x + s * ts * 0.68, y + ts * 0.3, ts * 0.36);
    }
    drawHokora(ctx, x, y - ts * 0.04, ts);
    drawTorii(ctx, x, y, ts);
  }
}

// Petit sanctuaire (hokora) encadré par le torii.
function drawHokora(ctx, x, y, ts) {
  const w = ts * 0.3;
  const lw = Math.max(0.8, ts * 0.022);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  // socle
  ctx.fillStyle = mix(PALETTE.stone, PALETTE.cream, 0.3);
  ctx.fillRect(x - w * 0.62, y + ts * 0.02, w * 1.24, ts * 0.06);
  ctx.strokeRect(x - w * 0.62, y + ts * 0.02, w * 1.24, ts * 0.06);
  // corps de bois
  ctx.fillStyle = '#6b3a28';
  ctx.fillRect(x - w * 0.42, y - ts * 0.16, w * 0.84, ts * 0.18);
  ctx.strokeRect(x - w * 0.42, y - ts * 0.16, w * 0.84, ts * 0.18);
  // portes d'or
  ctx.fillStyle = PALETTE.gold;
  ctx.fillRect(x - w * 0.24, y - ts * 0.12, w * 0.48, ts * 0.12);
  ctx.beginPath();
  ctx.moveTo(x, y - ts * 0.12);
  ctx.lineTo(x, y);
  ctx.stroke();
  // toit à larges avant-toits
  ctx.fillStyle = PALETTE.indigo;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.75, y - ts * 0.13);
  ctx.quadraticCurveTo(x - w * 0.35, y - ts * 0.17, x, y - ts * 0.31);
  ctx.quadraticCurveTo(x + w * 0.35, y - ts * 0.17, x + w * 0.75, y - ts * 0.13);
  ctx.lineTo(x + w * 0.6, y - ts * 0.17);
  ctx.lineTo(x - w * 0.6, y - ts * 0.17);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = PALETTE.gold;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.2, y - ts * 0.27);
  ctx.lineTo(x + w * 0.2, y - ts * 0.27);
  ctx.stroke();
}

// Lanterne de pierre (tōrō) miniature, avec une lueur.
function drawStoneLantern(ctx, x, y, h) {
  const lw = Math.max(0.7, h * 0.05);
  softShadow(ctx, x + h * 0.06, y, h * 0.3, h * 0.1, 0.45);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  const stone = mix(PALETTE.stone, PALETTE.cream, 0.25);
  const box = (bx, by, bw, bh) => {
    ctx.fillStyle = stone;
    ctx.fillRect(bx - bw / 2, by, bw, bh);
    ctx.strokeRect(bx - bw / 2, by, bw, bh);
  };
  box(x, y - h * 0.12, h * 0.42, h * 0.12);
  box(x, y - h * 0.5, h * 0.14, h * 0.38);
  box(x, y - h * 0.58, h * 0.36, h * 0.08);
  box(x, y - h * 0.8, h * 0.3, h * 0.22);
  wash(ctx, x, y - h * 0.69, h * 0.3, PALETTE.goldLight, 0.5);
  ctx.fillStyle = PALETTE.goldLight;
  ctx.fillRect(x - h * 0.07, y - h * 0.75, h * 0.14, h * 0.12);
  ctx.fillStyle = mix(PALETTE.stoneDark, PALETTE.stone, 0.4);
  ctx.beginPath();
  ctx.moveTo(x - h * 0.3, y - h * 0.78);
  ctx.quadraticCurveTo(x - h * 0.1, y - h * 0.84, x, y - h * 0.98);
  ctx.quadraticCurveTo(x + h * 0.1, y - h * 0.84, x + h * 0.3, y - h * 0.78);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y - h * 1.0, h * 0.05, 0, TAU);
  ctx.fill();
  ctx.stroke();
}

// Torii vermillon : piliers légèrement évasés, traverse (nuki), linteau courbé
// (kasagi) noir aux extrémités relevées, plaque dorée.
export function drawTorii(ctx, x, y, ts) {
  const w = ts * 0.92;
  const h = ts * 0.95;
  const base = y + ts * 0.32;
  const red = PALETTE.vermillion;
  const redDark = mix(PALETTE.vermillion, INK, 0.35);
  const lw = Math.max(1, ts * 0.028);
  softShadow(ctx, x + ts * 0.06, base + ts * 0.02, w * 0.7, ts * 0.12, 0.5);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  // piliers (légèrement évasés vers le bas), flanc droit dans l'ombre
  for (const s of [-1, 1]) {
    const px = x + s * w * 0.32;
    const tw = ts * 0.042;
    const bw = ts * 0.058;
    ctx.beginPath();
    ctx.moveTo(px - tw, base - h * 0.9);
    ctx.lineTo(px + tw, base - h * 0.9);
    ctx.lineTo(px + bw, base);
    ctx.lineTo(px - bw, base);
    ctx.closePath();
    ctx.fillStyle = red;
    ctx.fill();
    ctx.fillStyle = redDark;
    ctx.beginPath();
    ctx.moveTo(px + tw * 0.2, base - h * 0.9);
    ctx.lineTo(px + tw, base - h * 0.9);
    ctx.lineTo(px + bw, base);
    ctx.lineTo(px + bw * 0.25, base);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(px - tw, base - h * 0.9);
    ctx.lineTo(px - bw, base);
    ctx.moveTo(px + tw, base - h * 0.9);
    ctx.lineTo(px + bw, base);
    ctx.stroke();
    // socle noir (kamaki)
    ctx.fillStyle = INK;
    ctx.fillRect(px - bw * 1.15, base - ts * 0.07, bw * 2.3, ts * 0.075);
  }
  // nuki (traverse basse), dépasse des piliers
  ctx.fillStyle = red;
  ctx.beginPath();
  ctx.rect(x - w * 0.47, base - h * 0.72, w * 0.94, ts * 0.07);
  ctx.fill();
  ctx.stroke();
  // gakuzuka et plaque dorée
  ctx.fillStyle = PALETTE.gold;
  ctx.beginPath();
  ctx.rect(x - ts * 0.055, base - h * 0.86, ts * 0.11, ts * 0.13);
  ctx.fill();
  ctx.stroke();
  // shimaki (poutre sous le linteau)
  ctx.fillStyle = red;
  ctx.beginPath();
  ctx.rect(x - w * 0.5, base - h * 0.9, w, ts * 0.065);
  ctx.fill();
  ctx.stroke();
  // kasagi : linteau noir courbé aux extrémités relevées (sori)
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.66, base - h * 1.02);
  ctx.quadraticCurveTo(x, base - h * 0.88, x + w * 0.66, base - h * 1.02);
  ctx.lineTo(x + w * 0.57, base - h * 0.9);
  ctx.quadraticCurveTo(x, base - h * 0.8, x - w * 0.57, base - h * 0.9);
  ctx.closePath();
  ctx.fill();
  // reflet sur le linteau
  ctx.strokeStyle = withAlpha('#fff2d8', 0.35);
  ctx.lineWidth = Math.max(0.6, ts * 0.016);
  ctx.beginPath();
  ctx.moveTo(x - w * 0.5, base - h * 0.95);
  ctx.quadraticCurveTo(x, base - h * 0.86, x + w * 0.5, base - h * 0.95);
  ctx.stroke();
}
