// Yokai dessinés au pinceau (aplats, lavis, contours d'encre effilés).
//
// Chaque `look` est une fonction de dessin vectoriel (ctx, e, r, t) dans un repère
// centré sur le yokai, tourné vers la droite, `r` = rayon en pixels CSS.
// Pour les looks intégrés, `t` est la position dans le cycle d'animation (0..1).
//
// Performance : un yokai dessiné en vectoriel coûte des dizaines de tracés. Les
// looks décrits dans META sont donc pré-rendus en quelques images d'animation
// (sprites mis en cache par look / variante / rayon / résolution, rendus à r·dpr)
// puis simplement posés par drawImage. Les parties dynamiques (massue de l'oni,
// orbites lumineuses, feu follet) et les états (brûlure, givre, étourdissement…)
// sont des surcouches légères, elles aussi à base de sprites en cache.
// Un look ajouté sans entrée META est dessiné en vectoriel à chaque frame.
import { INK, PALETTE, withAlpha, wash, brushStroke, quadPts, mix, seeded, makeCanvas } from './brush.js';
import { ELEMENT_COLORS } from './fx.js';

const TAU = Math.PI * 2;

// ───────────────────────── Couleurs (palette + dérivés) ─────────────────────────

const COL = {
  paper: mix(PALETTE.cream, '#ffffff', 0.5), // blanc crème des esprits
  cream: PALETTE.cream,
  spiritShade: mix(PALETTE.moss, PALETTE.cream, 0.42),
  coolShade: mix(PALETTE.indigoLight, PALETTE.cream, 0.45),
  warmShade: mix(PALETTE.gold, PALETTE.cream, 0.35),
  hole: mix(PALETTE.indigo, INK, 0.55),
  moss: PALETTE.moss,
  mossLight: mix(PALETTE.moss, PALETTE.cream, 0.32),
  mossDark: PALETTE.mossDark,
  mossInk: mix(PALETTE.mossDark, INK, 0.45),
  shellLine: mix(PALETTE.moss, PALETTE.gold, 0.45),
  plastron: mix(PALETTE.gold, PALETTE.cream, 0.5),
  gold: PALETTE.gold,
  goldLight: PALETTE.goldLight,
  goldDark: mix(PALETTE.gold, INK, 0.35),
  ochre: mix(PALETTE.gold, PALETTE.vermillion, 0.16),
  ochreDark: mix(PALETTE.gold, INK, 0.42),
  verm: PALETTE.vermillion,
  vermDark: mix(PALETTE.vermillion, INK, 0.38),
  vermLight: mix(PALETTE.vermillion, PALETTE.goldLight, 0.35),
  oniRage: mix(PALETTE.vermillion, '#ff6a3a', 0.45),
  horn: mix(PALETTE.cream, PALETTE.gold, 0.28),
  indigo: PALETTE.indigo,
  indigoLight: PALETTE.indigoLight,
  indigoInk: mix(PALETTE.indigo, INK, 0.5),
  steel: mix(PALETTE.cream, PALETTE.indigoLight, 0.14),
  flesh: mix(PALETTE.cream, PALETTE.vermillion, 0.22),
  fleshShade: mix(PALETTE.vermillion, PALETTE.cream, 0.45),
  fleshFold: mix(PALETTE.vermillion, INK, 0.15),
  bone: mix(PALETTE.cream, '#ffffff', 0.3),
  boneShade: mix(PALETTE.indigoLight, PALETTE.cream, 0.4),
  heal: mix(PALETTE.moss, PALETTE.cream, 0.5),
  healDeep: mix(PALETTE.moss, PALETTE.cream, 0.15),
  steam: '#fbf7ec',
};

const ELEM = ELEMENT_COLORS || {};
const ELEM_FALLBACK = { main: PALETTE.gold, light: PALETTE.goldLight, dark: COL.goldDark };
const KANJI = { fire: '火', water: '水', wind: '風', earth: '土' };
const elemCol = (el) => ELEM[el] || ELEM_FALLBACK;
const ICE = (ELEM.water && ELEM.water.light) || '#a8d8ff';
const ICE_DEEP = (ELEM.water && ELEM.water.main) || '#3f7fb8';

// ───────────────────────── Petits outils ─────────────────────────

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function smooth(a, b, v) {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
}
function easeOutBack(k) {
  const c1 = 1.70158;
  const u = k - 1;
  return 1 + (c1 + 1) * u * u * u + c1 * u * u;
}
const lerp = (a, b, k) => a + (b - a) * k;

// Points d'une ellipse (ou d'un arc) en pixels.
function ell(cx, cy, rx, ry, n = 22, rot = 0, a0 = 0, a1 = TAU) {
  const out = [];
  const full = Math.abs(a1 - a0 - TAU) < 1e-6;
  const m = full ? n : n + 1;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  for (let i = 0; i < m; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    out.push([cx + x * cr - y * sr, cy + x * sr + y * cr]);
  }
  return out;
}

// Ellipse « vivante » : rayon modulé par des harmoniques (contour organique fermé).
function ellW(cx, cy, rx, ry, rnd, wob = 0.05, n = 26, rot = 0) {
  const p1 = rnd() * TAU;
  const p2 = rnd() * TAU;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = 1 + wob * (Math.sin(a * 3 + p1) * 0.6 + Math.sin(a * 5 + p2) * 0.4);
    const x = Math.cos(a) * rx * k;
    const y = Math.sin(a) * ry * k;
    out.push([cx + x * cr - y * sr, cy + x * sr + y * cr]);
  }
  return out;
}

// Contour fermé à partir d'un point de départ et de segments quadratiques
// [cx, cy, x, y] exprimés en unités de r.
function qpath(r, x0, y0, segs, steps = 6) {
  const pts = [[x0 * r, y0 * r]];
  let px = x0;
  let py = y0;
  for (const [cx, cy, x, y] of segs) {
    const q = quadPts(px * r, py * r, cx * r, cy * r, x * r, y * r, steps);
    for (let i = 1; i < q.length; i++) pts.push(q[i]);
    px = x;
    py = y;
  }
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) pts.pop();
  return pts;
}

const U = (r, list) => list.map(([x, y]) => [x * r, y * r]);

function bbox(pts) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: (x1 - x0) / 2 || 1, hh: (y1 - y0) / 2 || 1 };
}

function polyPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

// Contour d'encre d'un polygone fermé : trait au pinceau plus appuyé du côté
// de l'ombre (bas-droite), extrémités effilées qui se chevauchent.
function inkContour(ctx, pts, w, color = INK) {
  if (pts.length < 3 || w <= 0) return;
  const b = bbox(pts);
  const loop = pts.concat([pts[0], pts[1], pts[2]]);
  const m = loop.length;
  const ws = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const k = 0.5 + ((loop[i][1] - b.cy) / b.hh) * 0.4 + ((loop[i][0] - b.cx) / b.hw) * 0.14;
    ws[i] = 0.6 + 0.8 * clamp01(k);
  }
  brushStroke(ctx, loop, w, color, { taperIn: 0.05, taperOut: 0.05, pressure: (k) => ws[Math.round(k * (m - 1))] });
}

// Forme pleine : aplat, lavis d'ombre (bas-droite) et de lumière (haut-gauche), contour.
function shape(ctx, pts, fill, w, shade, light) {
  polyPath(ctx, pts);
  ctx.fillStyle = fill;
  ctx.fill();
  if (shade || light) {
    const b = bbox(pts);
    const m = Math.max(b.hw, b.hh);
    ctx.save();
    ctx.clip();
    if (shade) wash(ctx, b.cx + b.hw * 0.55, b.cy + b.hh * 0.8, m * 1.35, shade, 0.75);
    if (light) wash(ctx, b.cx - b.hw * 0.4, b.cy - b.hh * 0.5, m * 0.75, light, 0.55);
    ctx.restore();
  }
  if (w > 0) inkContour(ctx, pts, w);
}

// Trait de pinceau simple.
function line(ctx, pts, w, color = INK, tin = 0.25, tout = 0.4) {
  brushStroke(ctx, pts, w, color, { taperIn: tin, taperOut: tout });
}

// Membre « cerné » : trait d'encre large puis trait de couleur par-dessus.
function limb(ctx, pts, w, color, edge) {
  brushStroke(ctx, pts, w + edge * 2, INK, { taperIn: 0.08, taperOut: 0.12 });
  brushStroke(ctx, pts, w, color, { taperIn: 0.1, taperOut: 0.2 });
}

function dot(ctx, x, y, rad, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, TAU);
  ctx.fill();
}

function oval(ctx, x, y, rx, ry, color, rot = 0) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.fill();
}

// Feuille (lentille) orientée selon `ang`, avec nervure.
function leaf(ctx, x, y, len, ang, color, w) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const P = (u, v) => [x + c * u - s * v, y + s * u + c * v];
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const u = (i / 6) * len;
    pts.push(P(u, Math.sin((i / 6) * Math.PI) * len * 0.32));
  }
  for (let i = 5; i >= 1; i--) {
    const u = (i / 6) * len;
    pts.push(P(u, -Math.sin((i / 6) * Math.PI) * len * 0.32));
  }
  shape(ctx, pts, color, w, null, null);
  line(ctx, [P(len * 0.1, 0), P(len * 0.85, 0)], w * 0.7, withAlpha(INK, 0.6), 0.2, 0.6);
}

// ───────────────────────── Dessins des yokai ─────────────────────────

export const LOOKS = {
  // Kodama : petit esprit des arbres, grosse tête qui cliquette, trois trous d'ombre.
  kodama(ctx, e, r, t) {
    const a = t * TAU;
    const v = Math.floor((e.seed ?? 0.3) * 3) % 3;
    const w = r * 0.12;
    const body = COL.paper;
    // jambes : pas alternés
    for (const s of [-1, 1]) {
      const ph = a + (s > 0 ? 0 : Math.PI);
      const lift = Math.max(0, Math.sin(ph)) * 0.13;
      const sw = Math.cos(ph) * 0.11;
      line(ctx, [[s * 0.13 * r, 0.58 * r], [(s * 0.15 + sw * 0.5) * r, 0.74 * r], [(s * 0.16 + sw) * r, (0.9 - lift) * r]], w * 1.3, INK, 0.05, 0.05);
    }
    // corps
    shape(ctx, ell(0, 0.46 * r, 0.33 * r, 0.35 * r, 20), body, w, COL.spiritShade, null);
    // bras qui balancent
    for (const s of [-1, 1]) {
      const sw = Math.sin(a + (s > 0 ? Math.PI : 0)) * 0.13;
      line(ctx, quadPts(s * 0.27 * r, 0.35 * r, s * 0.48 * r, 0.32 * r, s * 0.58 * r, (0.5 + sw) * r, 5), w * 1.15, INK, 0.1, 0.35);
    }
    // tête
    ctx.save();
    ctx.translate(0.04 * r, -0.24 * r);
    ctx.rotate(Math.sin(a * 2) * 0.09 + [-0.05, 0.05, 0.12][v]);
    const [hx, hy] = [[0.6, 0.53], [0.54, 0.6], [0.64, 0.5]][v];
    shape(ctx, ellW(0, 0, hx * r, hy * r, seeded(7 + v), 0.06, 28), body, w, COL.spiritShade, '#ffffff');
    // pousse de feuilles
    const top = -hy * r;
    line(ctx, quadPts(0.02 * r, top + 0.04 * r, 0.03 * r, top - 0.1 * r, 0.1 * r, top - 0.2 * r, 4), w * 0.9, INK, 0.1, 0.3);
    leaf(ctx, 0.1 * r, top - 0.19 * r, 0.24 * r, -0.45, COL.moss, w * 0.55);
    if (v !== 1) leaf(ctx, 0.04 * r, top - 0.08 * r, 0.18 * r, -2.5, COL.mossLight, w * 0.55);
    // visage : trois trous d'ombre tournés vers l'avant
    const eyes = [
      [[0.0, -0.06, 0.12, 0.16], [0.31, -0.07, 0.11, 0.15], [0.17, 0.2, 0.09, 0.12]],
      [[-0.02, -0.1, 0.11, 0.17], [0.27, -0.1, 0.1, 0.16], [0.14, 0.2, 0.08, 0.1]],
      [[0.02, -0.05, 0.13, 0.15], [0.34, -0.04, 0.11, 0.13], [0.2, 0.2, 0.11, 0.14]],
    ][v];
    for (const [ex, ey, rx, ry] of eyes) oval(ctx, ex * r, ey * r, rx * r, ry * r, COL.hole);
    ctx.restore();
  },

  // Kamaitachi : belette-faucille au galop, queue en tourbillon, lames d'acier.
  kamaitachi(ctx, e, r, t) {
    const a = t * TAU;
    const ext = Math.sin(a); // +1 étiré, -1 ramassé
    const u = (ext + 1) / 2;
    const w = r * 0.11;
    // traînées de vent
    for (let k = 0; k < 3; k++) {
      const yy = (-0.3 + k * 0.28) * r;
      const x0 = (-0.98 - k * 0.1 - u * 0.08) * r;
      line(ctx, [[x0, yy], [x0 - 0.3 * r, yy + 0.02 * r], [x0 - (0.66 - k * 0.12) * r, yy]], r * 0.1, withAlpha(INK, 0.38), 0.5, 0.5);
    }
    // queue en panache qui s'enroule
    const tail = quadPts(-0.6 * r, 0.0, -1.2 * r, -0.05 * r, -1.08 * r, (-0.62 + ext * 0.05) * r, 8);
    brushStroke(ctx, tail, r * 0.34 + w * 2, INK, { taperIn: 0.05, taperOut: 0.5 });
    brushStroke(ctx, tail, r * 0.34, COL.ochre, { taperIn: 0.05, taperOut: 0.55 });
    line(ctx, ell(-0.9 * r, -0.7 * r, 0.17 * r, 0.15 * r, 10, 0, Math.PI * 0.9, Math.PI * 2.6), w * 0.9, INK, 0.2, 0.6);
    // pattes lointaines (dans l'ombre)
    const hip = [-0.48 * r, 0.12 * r];
    const sho = [0.38 * r, 0.06 * r];
    const footB = [lerp(-0.22, -0.9, u) * r, lerp(0.8, 0.62, u) * r];
    const footB2 = [lerp(-0.86, -0.3, u) * r, lerp(0.66, 0.8, u) * r];
    const footF = [lerp(0.12, 0.7, u) * r, lerp(0.8, 0.66, u) * r];
    limb(ctx, [hip, [lerp(-0.42, -0.72, u) * r, 0.45 * r], footB], r * 0.17, w * 0.5, COL.ochreDark);
    limb(ctx, [sho, [lerp(0.3, 0.52, u) * r, 0.44 * r], footF], r * 0.16, w * 0.5, COL.ochreDark);
    // corps allongé qui s'étire et se ramasse
    const L = 0.8 + 0.1 * ext;
    const arch = 0.14 * (1 - u);
    const body = qpath(r, -L, 0.2, [
      [-0.2, -0.5 - arch, 0.5, -0.3],
      [0.72, 0.05, 0.38, 0.3],
      [-0.1, 0.44, -L, 0.2],
    ]);
    shape(ctx, body, COL.ochre, w, COL.ochreDark, COL.goldLight);
    line(ctx, quadPts(-0.42 * r, 0.27 * r, 0.0, 0.38 * r, 0.32 * r, 0.24 * r, 6), r * 0.12, COL.cream, 0.3, 0.4);
    // patte arrière proche
    limb(ctx, [[-0.56 * r, 0.16 * r], [lerp(-0.8, -0.46, u) * r, 0.46 * r], footB2], r * 0.17, w * 0.5, COL.ochre);
    // tête pointue
    const hx = 0.08 * ext;
    const head = qpath(r, 0.4 + hx, -0.36, [
      [0.6 + hx, -0.6, 0.82 + hx, -0.44],
      [1.0 + hx, -0.36, 1.16 + hx, -0.2],
      [0.88 + hx, -0.04, 0.5 + hx, -0.08],
      [0.36 + hx, -0.2, 0.4 + hx, -0.36],
    ]);
    shape(ctx, head, COL.ochre, w, COL.ochreDark, COL.goldLight);
    shape(ctx, U(r, [[0.52 + hx, -0.47], [0.6 + hx, -0.76], [0.72 + hx, -0.48]]), COL.ochreDark, w * 0.8, null, null);
    line(ctx, quadPts((0.7 + hx) * r, -0.12 * r, (0.88 + hx) * r, -0.08 * r, (1.06 + hx) * r, -0.17 * r, 4), r * 0.09, COL.cream, 0.3, 0.5);
    dot(ctx, (0.86 + hx) * r, -0.31 * r, r * 0.085, INK);
    dot(ctx, (0.88 + hx) * r, -0.33 * r, r * 0.03, COL.paper);
    line(ctx, [[(0.74 + hx) * r, -0.45 * r], [(0.94 + hx) * r, -0.39 * r]], r * 0.07, INK, 0.2, 0.5);
    dot(ctx, (1.15 + hx) * r, -0.2 * r, r * 0.05, INK);
    // patte avant proche levée, faucille d'acier tendue vers l'avant
    const paw = [lerp(0.56, 0.78, u) * r, lerp(0.38, 0.28, u) * r];
    limb(ctx, [sho, [lerp(0.44, 0.6, u) * r, 0.36 * r], paw], r * 0.17, w * 0.5, COL.ochre);
    sickle(ctx, paw[0], paw[1], 0.74 * r, lerp(1.05, 1.45, u), w * 0.6, COL.steel);
    dot(ctx, paw[0], paw[1], r * 0.09, INK);
  },

  // Kappa : lutin-tortue qui se dandine, carapace écaillée, bec et coupelle d'eau.
  kappa(ctx, e, r, t) {
    const a = t * TAU;
    const step = Math.sin(a);
    const w = r * 0.11;
    const skin = COL.mossLight;
    const footAt = (x, lift) => {
      shape(ctx, U(r, [[x - 0.16, 0.9 - lift], [x - 0.04, 0.76 - lift], [x + 0.14, 0.78 - lift], [x + 0.24, 0.92 - lift], [x + 0.08, 0.88 - lift], [x + 0.03, 0.94 - lift]]), skin, w * 0.8, COL.moss, null);
    };
    // jambe arrière
    limb(ctx, [[-0.1 * r, 0.55 * r], [(-0.12 + 0.12 * step) * r, 0.8 * r]], r * 0.16, w * 0.55, COL.moss);
    footAt(-0.14 + 0.12 * step, Math.max(0, -step) * 0.08);
    // carapace (sur le dos)
    const shell = ellW(-0.3 * r, 0.1 * r, 0.5 * r, 0.62 * r, seeded(3), 0.025, 26, -0.12);
    shape(ctx, shell, COL.mossDark, w, COL.mossInk, COL.moss);
    polyPath(ctx, shell);
    ctx.save();
    ctx.clip();
    for (const [cx, cy] of [[-0.38, -0.2], [-0.12, 0.08], [-0.46, 0.22], [-0.2, 0.46], [-0.6, -0.02], [-0.04, -0.28]]) {
      const hex = [];
      for (let k = 0; k < 6; k++) hex.push([(cx + Math.cos((k / 6) * TAU) * 0.15) * r, (cy + Math.sin((k / 6) * TAU) * 0.15) * r]);
      polyPath(ctx, hex);
      ctx.strokeStyle = COL.shellLine;
      ctx.lineWidth = r * 0.06;
      ctx.stroke();
    }
    ctx.restore();
    line(ctx, ell(-0.3 * r, 0.1 * r, 0.47 * r, 0.59 * r, 14, -0.12, -1.2, 1.1), r * 0.08, COL.gold, 0.2, 0.3);
    // corps et plastron
    const body = ell(0.08 * r, 0.3 * r, 0.38 * r, 0.48 * r, 22);
    shape(ctx, body, skin, 0, COL.moss, null);
    polyPath(ctx, body);
    ctx.save();
    ctx.clip();
    oval(ctx, 0.26 * r, 0.34 * r, 0.22 * r, 0.42 * r, COL.plastron);
    for (let k = 0; k < 3; k++) line(ctx, quadPts(0.08 * r, (0.14 + k * 0.17) * r, 0.24 * r, (0.18 + k * 0.17) * r, 0.44 * r, (0.12 + k * 0.17) * r, 4), r * 0.05, COL.goldDark, 0.2, 0.2);
    ctx.restore();
    inkContour(ctx, body, w);
    // jambe avant
    limb(ctx, [[0.22 * r, 0.6 * r], [(0.24 - 0.12 * step) * r, 0.8 * r]], r * 0.17, w * 0.55, skin);
    footAt(0.2 - 0.12 * step, Math.max(0, step) * 0.08);
    // bras
    const hand = [0.56 * r, (0.3 + 0.06 * step) * r];
    limb(ctx, [[0.24 * r, 0.06 * r], [0.48 * r, 0.14 * r], hand], r * 0.14, w * 0.55, skin);
    for (let k = -1; k <= 1; k++) line(ctx, [hand, [hand[0] + (0.08 + k * 0.02) * r, hand[1] + (0.08 + k * 0.05) * r]], r * 0.06, INK, 0.1, 0.6);
    // tête
    const head = ellW(0.32 * r, -0.38 * r, 0.34 * r, 0.31 * r, seeded(5), 0.03, 24);
    shape(ctx, head, skin, w, COL.moss, COL.cream);
    // frange de cheveux autour de la coupelle
    const fr = [];
    for (let k = 0; k <= 8; k++) {
      const ang = Math.PI * (1.05 + (k / 8) * 0.9);
      const rr = k % 2 ? 0.2 : 0.34;
      fr.push([(0.32 + Math.cos(ang) * rr) * r, (-0.52 + Math.sin(ang) * rr * 0.6 + (k % 2 ? 0.1 : 0.04)) * r]);
    }
    fr.push([0.52 * r, -0.66 * r], [0.12 * r, -0.66 * r]);
    polyPath(ctx, fr);
    ctx.fillStyle = INK;
    ctx.fill();
    // bec
    shape(ctx, U(r, [[0.56, -0.44], [0.9, -0.33], [0.58, -0.24]]), COL.gold, w * 0.8, COL.goldDark, null);
    line(ctx, [[0.6 * r, -0.33 * r], [0.84 * r, -0.33 * r]], r * 0.04, INK, 0.2, 0.6);
    // œil
    oval(ctx, 0.46 * r, -0.42 * r, 0.09 * r, 0.1 * r, COL.paper);
    dot(ctx, 0.49 * r, -0.41 * r, 0.055 * r, INK);
    line(ctx, [[0.36 * r, -0.53 * r], [0.54 * r, -0.5 * r]], r * 0.06, INK, 0.2, 0.5);
    // coupelle d'eau (sara)
    shape(ctx, ell(0.3 * r, -0.68 * r, 0.24 * r, 0.09 * r, 16), COL.cream, w * 0.7, null, null);
    oval(ctx, 0.3 * r, -0.675 * r, 0.15 * r, 0.045 * r, COL.indigoLight);
    oval(ctx, 0.26 * r, -0.685 * r, 0.05 * r, 0.015 * r, COL.paper);
  },

  // Karasu-tengu : corbeau-démon aux grandes ailes, visage vermillon, bec d'or.
  tengu(ctx, e, r, t) {
    const a = t * TAU;
    const f = Math.sin(a); // +1 ailes hautes
    const w = r * 0.1;
    for (const s of [-1, 1]) wing(ctx, s, f, r, w);
    // queue en éventail
    shape(ctx, U(r, [[-0.14, 0.4], [-0.3, 0.86], [-0.1, 0.8], [0, 0.94], [0.1, 0.8], [0.3, 0.86], [0.14, 0.4]]), COL.indigoInk, w * 0.8, null, null);
    // serres d'or
    for (const s of [-1, 1]) {
      line(ctx, [[s * 0.1 * r, 0.42 * r], [s * 0.12 * r, 0.62 * r]], r * 0.08, COL.gold, 0.1, 0.1);
      for (let k = -1; k <= 1; k++) line(ctx, [[s * 0.12 * r, 0.6 * r], [(s * 0.12 + k * 0.07) * r, 0.7 * r]], r * 0.05, INK, 0.1, 0.6);
    }
    // corps : robe de yamabushi
    shape(ctx, ell(0, 0.12 * r, 0.29 * r, 0.42 * r, 20), COL.indigo, w, COL.indigoInk, COL.indigoLight);
    line(ctx, quadPts(-0.16 * r, -0.2 * r, 0.0, 0.05 * r, 0.16 * r, -0.2 * r, 5), r * 0.09, COL.cream, 0.1, 0.1);
    for (const [px, py] of [[-0.08, 0.12], [0.1, 0.2]]) {
      dot(ctx, px * r, py * r, 0.11 * r, INK);
      dot(ctx, px * r, py * r, 0.08 * r, COL.verm);
    }
    // tête au masque vermillon
    shape(ctx, ell(0.04 * r, -0.42 * r, 0.25 * r, 0.24 * r, 20), COL.verm, w, COL.vermDark, COL.vermLight);
    shape(ctx, U(r, [[0.18, -0.5], [0.62, -0.38], [0.18, -0.3]]), COL.gold, w * 0.8, COL.goldDark, null);
    oval(ctx, 0.1 * r, -0.46 * r, 0.075 * r, 0.07 * r, COL.paper);
    dot(ctx, 0.12 * r, -0.46 * r, 0.04 * r, INK);
    line(ctx, [[-0.04 * r, -0.6 * r], [0.2 * r, -0.52 * r]], r * 0.08, INK, 0.2, 0.4);
    // tokin (petit bonnet noir)
    shape(ctx, U(r, [[-0.12, -0.6], [-0.08, -0.78], [0.08, -0.8], [0.12, -0.62]]), INK, w * 0.5, null, null);
  },

  // Nuppeppō : masse de chair molle qui tremblote, plis, yeux endormis.
  nuppeppo(ctx, e, r, t) {
    const a = t * TAU;
    const j = Math.sin(a);
    const j2 = Math.sin(a * 2 + 1);
    const w = r * 0.1;
    // moignons-bras (derrière)
    shape(ctx, ell(-0.74 * r, 0.3 * r, 0.14 * r, 0.22 * r, 14, 0.5 + j * 0.1), COL.flesh, w * 0.9, COL.fleshShade, null);
    const body = qpath(r, -0.8, 0.84, [
      [-0.96 - 0.05 * j, 0.3, -0.62, -0.2 + 0.03 * j],
      [-0.42, -0.64 - 0.06 * j, 0.02, -0.66 - 0.06 * j],
      [0.5, -0.66 + 0.02 * j, 0.66, -0.2 - 0.03 * j],
      [0.98 + 0.05 * j, 0.32, 0.8, 0.84],
      [0.0, 0.97, -0.8, 0.84],
    ], 7);
    shape(ctx, body, COL.flesh, w, COL.fleshShade, '#ffffff');
    // taches et plis
    polyPath(ctx, body);
    ctx.save();
    ctx.clip();
    wash(ctx, -0.4 * r, 0.1 * r, 0.3 * r, COL.verm, 0.18);
    wash(ctx, 0.5 * r, 0.5 * r, 0.25 * r, COL.verm, 0.15);
    ctx.restore();
    line(ctx, quadPts(-0.6 * r, 0.34 * r, -0.05 * r, (0.5 + 0.03 * j2) * r, 0.55 * r, 0.32 * r, 6), r * 0.075, withAlpha(COL.fleshFold, 0.75), 0.3, 0.3);
    line(ctx, quadPts(-0.42 * r, 0.58 * r, 0.0, (0.7 + 0.02 * j2) * r, 0.4 * r, 0.56 * r, 6), r * 0.065, withAlpha(COL.fleshFold, 0.6), 0.3, 0.3);
    line(ctx, quadPts(-0.62 * r, -0.05 * r, -0.5 * r, 0.1 * r, -0.62 * r, 0.22 * r, 4), r * 0.05, withAlpha(COL.fleshFold, 0.5), 0.3, 0.3);
    // moignon avant
    shape(ctx, ell(0.76 * r, 0.32 * r, 0.14 * r, 0.22 * r, 14, -0.5 - j * 0.1), COL.flesh, w * 0.9, COL.fleshShade, null);
    // visage : paupières lourdes, poches, bouche tombante
    for (const [ex, sz] of [[0.04, 1], [0.38, 0.9]]) {
      line(ctx, ell(ex * r, -0.24 * r, 0.11 * r * sz, 0.07 * r, 6, 0, Math.PI * 1.05, Math.PI * 1.95), r * 0.1, INK, 0.2, 0.2);
      dot(ctx, ex * r, -0.2 * r, 0.05 * r * sz, INK);
      line(ctx, ell(ex * r, -0.18 * r, 0.1 * r * sz, 0.06 * r, 6, 0, 0.15, Math.PI - 0.15), r * 0.045, withAlpha(COL.fleshFold, 0.8), 0.3, 0.3);
    }
    line(ctx, ell(0.22 * r, 0.06 * r, 0.12 * r, 0.06 * r, 6, 0, Math.PI * 1.1, Math.PI * 1.9), r * 0.075, INK, 0.3, 0.3);
    oval(ctx, 0.31 * r, 0.12 * r, 0.03 * r, 0.05 * r, COL.coolShade);
  },

  // Kitsune : renard blanc à trois queues, marques vermillon, collier et clochette.
  kitsune(ctx, e, r, t) {
    const a = t * TAU;
    const w = r * 0.1;
    for (const k of [-1, 0, 1]) foxTail(ctx, r, w, -2.3 + k * 0.45 + Math.sin(a + k * 0.9) * 0.1, 0.95 + (k === 0 ? 0.12 : 0));
    // pattes au trot (paires diagonales)
    const legAt = (x, ph, near) => {
      const sw = Math.sin(ph) * 0.15;
      const lift = Math.max(0, Math.cos(ph)) * 0.1;
      const foot = [(x + sw) * r, (0.84 - lift) * r];
      const pts = [[x * r, 0.24 * r], [(x + sw * 0.4) * r, 0.56 * r], foot];
      brushStroke(ctx, pts, r * 0.16 + w * 1.1, INK, { taperIn: 0.05, taperOut: 0.02 });
      brushStroke(ctx, pts, r * 0.14, near ? COL.paper : COL.coolShade, { taperIn: 0.05, taperOut: 0.05 });
      oval(ctx, foot[0] + 0.03 * r, foot[1], 0.08 * r, 0.05 * r, INK);
    };
    legAt(-0.26, a + Math.PI, false);
    legAt(0.4, a, false);
    shape(ctx, ell(0, 0.2 * r, 0.52 * r, 0.28 * r, 22, -0.06), COL.paper, w, COL.warmShade, '#ffffff');
    legAt(-0.36, a, true);
    legAt(0.3, a + Math.PI, true);
    // tête
    const head = U(r, [
      [0.38, -0.26], [0.4, -0.5], [0.42, -0.84], [0.6, -0.52], [0.68, -0.54], [0.84, -0.82],
      [0.84, -0.46], [0.98, -0.34], [1.16, -0.16], [0.94, -0.06], [0.64, 0.02], [0.44, -0.06],
    ]);
    shape(ctx, head, COL.paper, w, COL.warmShade, '#ffffff');
    shape(ctx, U(r, [[0.46, -0.52], [0.47, -0.72], [0.56, -0.54]]), COL.verm, 0, null, null);
    shape(ctx, U(r, [[0.73, -0.55], [0.81, -0.72], [0.81, -0.5]]), COL.verm, 0, null, null);
    // marques vermillon : front, joue, œil bridé
    line(ctx, quadPts(0.62 * r, -0.36 * r, 0.66 * r, -0.46 * r, 0.62 * r, -0.54 * r, 4), r * 0.08, COL.verm, 0.4, 0.5);
    line(ctx, quadPts(0.74 * r, -0.12 * r, 0.86 * r, -0.12 * r, 0.98 * r, -0.2 * r, 4), r * 0.07, COL.verm, 0.2, 0.6);
    line(ctx, [[0.76 * r, -0.36 * r], [0.84 * r, -0.33 * r], [0.93 * r, -0.27 * r]], r * 0.075, INK, 0.2, 0.5);
    line(ctx, [[0.74 * r, -0.41 * r], [0.95 * r, -0.33 * r]], r * 0.05, COL.verm, 0.2, 0.6);
    dot(ctx, 1.15 * r, -0.16 * r, 0.05 * r, INK);
    // collier vermillon et clochette d'or
    line(ctx, quadPts(0.4 * r, -0.14 * r, 0.5 * r, 0.02 * r, 0.62 * r, 0.04 * r, 4), r * 0.1, COL.verm, 0.1, 0.1);
    dot(ctx, 0.54 * r, 0.11 * r, 0.085 * r, INK);
    dot(ctx, 0.54 * r, 0.11 * r, 0.06 * r, COL.gold);
  },

  // Yuki-onna : femme des neiges flottante, kimono blanc, longs cheveux d'encre.
  yukionna(ctx, e, r, t) {
    const a = t * TAU;
    const s1 = Math.sin(a);
    const s2 = Math.sin(a + 1.3);
    const w = r * 0.09;
    // cheveux qui flottent derrière
    const hair = qpath(r, 0.04, -0.8, [
      [-0.5, -0.72, -0.72 + 0.04 * s1, -0.18],
      [-0.86 + 0.06 * s2, 0.1, -1.08 + 0.06 * s1, 0.26],
      [-0.78, 0.26, -0.7, 0.4 + 0.05 * s2],
      [-0.44, 0.2, -0.16, 0.1],
      [0.02, -0.3, 0.04, -0.8],
    ], 6);
    shape(ctx, hair, INK, 0, null, null);
    for (let k = 0; k < 3; k++) line(ctx, quadPts(-0.1 * r, (-0.62 + k * 0.08) * r, -0.6 * r, (-0.36 + k * 0.14) * r, (-0.86 + k * 0.08 + 0.05 * s1) * r, (0.12 + k * 0.1) * r, 6), r * 0.03, withAlpha(COL.indigoLight, 0.7), 0.3, 0.5);
    // brume de l'ourlet (pas de pieds)
    for (let k = 0; k < 3; k++) {
      const x0 = (-0.34 + k * 0.3) * r;
      line(ctx, quadPts(x0, 0.76 * r, x0 - 0.2 * r, (0.92 + 0.04 * s2) * r, x0 - (0.36 - k * 0.04) * r, (0.98 + 0.03 * s1) * r, 5), r * 0.14, withAlpha(COL.coolShade, 0.75), 0.1, 0.7);
    }
    // kimono
    const kim = qpath(r, -0.22, -0.32, [
      [0.02, -0.38, 0.24, -0.3],
      [0.5, 0.2, 0.56, 0.78],
      [0.4, 0.7, 0.24, 0.78],
      [0.06, 0.88, -0.14, 0.76],
      [-0.36, 0.7, -0.62 + 0.04 * s1, 0.86],
      [-0.5, 0.2, -0.22, -0.32],
    ], 6);
    shape(ctx, kim, COL.paper, w, COL.coolShade, '#ffffff');
    // col croisé et obi indigo
    polyPath(ctx, kim);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = COL.indigo;
    ctx.fillRect(-0.7 * r, 0.02 * r, 1.4 * r, 0.16 * r);
    line(ctx, [[-0.6 * r, 0.1 * r], [0.6 * r, 0.1 * r]], r * 0.035, COL.gold, 0.1, 0.1);
    line(ctx, quadPts(-0.3 * r, 0.3 * r, -0.2 * r, 0.55 * r, -0.4 * r, 0.8 * r, 5), r * 0.04, withAlpha(COL.coolShade, 0.9), 0.3, 0.3);
    ctx.restore();
    line(ctx, [[-0.12 * r, -0.3 * r], [0.12 * r, 0.02 * r]], r * 0.06, COL.indigoLight, 0.1, 0.2);
    line(ctx, [[0.16 * r, -0.3 * r], [0.04 * r, -0.08 * r]], r * 0.05, COL.indigoLight, 0.1, 0.2);
    // longue manche qui pend, main pâle
    const sleeve = qpath(r, 0.16, -0.24, [
      [0.42, -0.1, 0.5 + 0.03 * s2, 0.3],
      [0.54, 0.46, 0.34, 0.44],
      [0.3, 0.2, 0.16, -0.24],
    ], 5);
    shape(ctx, sleeve, COL.paper, w, COL.coolShade, null);
    oval(ctx, 0.5 * r, 0.42 * r, 0.06 * r, 0.05 * r, COL.paper);
    // visage
    shape(ctx, ell(0.1 * r, -0.52 * r, 0.19 * r, 0.24 * r, 18), '#fdfbf4', w * 0.85, COL.coolShade, null);
    shape(ctx, U(r, [[-0.12, -0.52], [-0.06, -0.74], [0.12, -0.8], [0.3, -0.66], [0.26, -0.6], [0.14, -0.66], [0.04, -0.58], [-0.04, -0.3]]), INK, 0, null, null);
    line(ctx, [[0.13 * r, -0.53 * r], [0.22 * r, -0.51 * r]], r * 0.045, INK, 0.2, 0.5);
    line(ctx, [[0.0 * r, -0.53 * r], [0.06 * r, -0.52 * r]], r * 0.035, INK, 0.2, 0.5);
    dot(ctx, 0.18 * r, -0.4 * r, 0.035 * r, COL.verm);
    // souffle glacé
    line(ctx, ell(0.4 * r, -0.44 * r, 0.12 * r, 0.08 * r, 8, 0, Math.PI * 0.9, Math.PI * (1.9 + 0.3 * s1)), r * 0.06, withAlpha(ICE, 0.9), 0.2, 0.7);
  },

  // Aka-oni : ogre rouge massif, crinière d'encre, cornes, pagne en peau de tigre.
  // La massue (kanabō) est dessinée à part (META.akaoni.after) pour pouvoir frapper.
  akaoni(ctx, e, r, t) {
    const a = t * TAU;
    const step = Math.sin(a);
    const w = r * 0.075;
    const skin = e.enraged ? COL.oniRage : COL.verm;
    // jambes : pas lourds
    for (const s of [-1, 1]) {
      const k = s > 0 ? step : -step;
      const lift = Math.max(0, k) * 0.07;
      const fx = (s * 0.26 + k * 0.08) * r;
      limb(ctx, [[s * 0.2 * r, 0.5 * r], [(s * 0.3 + k * 0.04) * r, 0.72 * r], [fx, (0.88 - lift) * r]], r * 0.24, w * 0.8, s < 0 ? COL.vermDark : skin);
      shape(ctx, ell(fx + 0.06 * r, (0.92 - lift) * r, 0.16 * r, 0.07 * r, 12), s < 0 ? COL.vermDark : skin, w * 0.8, null, null);
    }
    // bras arrière
    const backArm = e.enraged ? mix(COL.oniRage, INK, 0.25) : mix(COL.verm, INK, 0.25);
    brushStroke(ctx, [[-0.4 * r, -0.12 * r], [-0.68 * r, 0.12 * r], [-0.66 * r, 0.4 * r]], r * 0.22 + w * 1.6, INK, { taperIn: 0.02, taperOut: 0.02 });
    brushStroke(ctx, [[-0.4 * r, -0.12 * r], [-0.68 * r, 0.12 * r], [-0.66 * r, 0.4 * r]], r * 0.22, backArm, { taperIn: 0.02, taperOut: 0.02 });
    shape(ctx, ell(-0.66 * r, 0.44 * r, 0.13 * r, 0.12 * r, 12), backArm, w * 0.8, null, null);
    // torse
    const torso = qpath(r, -0.5, -0.2, [
      [0, -0.44, 0.5, -0.18],
      [0.64, 0.24, 0.42, 0.52],
      [0, 0.68, -0.42, 0.52],
      [-0.64, 0.2, -0.5, -0.2],
    ], 7);
    shape(ctx, torso, skin, w, COL.vermDark, COL.vermLight);
    line(ctx, quadPts(-0.3 * r, -0.02 * r, -0.12 * r, 0.1 * r, 0.02 * r, 0.0, 5), r * 0.06, COL.vermDark, 0.3, 0.3);
    line(ctx, quadPts(0.06 * r, 0.0, 0.22 * r, 0.1 * r, 0.36 * r, -0.02 * r, 5), r * 0.06, COL.vermDark, 0.3, 0.3);
    line(ctx, quadPts(-0.08 * r, 0.2 * r, 0.04 * r, 0.3 * r, 0.14 * r, 0.22 * r, 4), r * 0.05, COL.vermDark, 0.3, 0.3);
    // pagne en peau de tigre
    const cloth = U(r, [[-0.46, 0.4], [0.46, 0.4], [0.4, 0.62], [0.28, 0.7], [0.16, 0.62], [0.02, 0.74], [-0.12, 0.62], [-0.26, 0.72], [-0.4, 0.62]]);
    shape(ctx, cloth, COL.gold, w, COL.goldDark, COL.goldLight);
    for (let k = 0; k < 4; k++) {
      const x0 = (-0.32 + k * 0.2) * r;
      line(ctx, [[x0, 0.44 * r], [x0 + 0.05 * r, 0.54 * r], [x0 - 0.02 * r, 0.64 * r]], r * 0.07, INK, 0.3, 0.5);
    }
    line(ctx, [[-0.48 * r, 0.41 * r], [0.48 * r, 0.41 * r]], r * 0.08, INK, 0.1, 0.1);
    // bras avant jusqu'au poing (le poing est dessiné avec la massue)
    limb(ctx, [[0.42 * r, -0.12 * r], [0.64 * r, 0.22 * r], [0.74 * r, 0.04 * r]], r * 0.21, w * 0.8, skin);
    // crinière d'encre
    const mane = [];
    for (let k = 0; k < 15; k++) {
      const ang = Math.PI * (0.62 + (k / 14) * 1.5);
      const rr = (k % 2 ? 0.34 : 0.52) * r;
      mane.push([0.02 * r + Math.cos(ang) * rr, -0.6 * r + Math.sin(ang) * rr]);
    }
    polyPath(ctx, mane);
    ctx.fillStyle = INK;
    ctx.fill();
    // tête
    shape(ctx, ellW(0.08 * r, -0.6 * r, 0.35 * r, 0.33 * r, seeded(11), 0.03, 24), skin, w, COL.vermDark, COL.vermLight);
    // cornes
    for (const [hx, dir] of [[-0.1, -1], [0.26, 1]]) {
      const horn = qpath(r, hx - 0.07, -0.84, [
        [hx + dir * 0.1, -1.0, hx + dir * 0.06, -1.24],
        [hx + dir * 0.18, -1.0, hx + 0.08, -0.86],
      ], 5);
      shape(ctx, horn, COL.horn, w * 0.9, COL.gold, null);
      line(ctx, [[(hx - 0.04) * r, -0.94 * r], [(hx + 0.08) * r, -0.95 * r]], r * 0.035, COL.goldDark, 0.1, 0.1);
    }
    // sourcils, yeux, nez, gueule et crocs
    line(ctx, [[-0.12 * r, -0.74 * r], [0.06 * r, -0.66 * r]], r * 0.1, INK, 0.2, 0.3);
    line(ctx, [[0.16 * r, -0.66 * r], [0.36 * r, -0.74 * r]], r * 0.1, INK, 0.3, 0.2);
    const eyeCol = e.enraged ? COL.paper : COL.goldLight;
    for (const ex of [-0.02, 0.26]) {
      oval(ctx, ex * r, -0.6 * r, 0.075 * r, 0.06 * r, INK);
      oval(ctx, ex * r, -0.6 * r, 0.055 * r, 0.042 * r, eyeCol);
      dot(ctx, (ex + 0.025) * r, -0.6 * r, 0.025 * r, INK);
    }
    line(ctx, ell(0.12 * r, -0.48 * r, 0.08 * r, 0.04 * r, 6, 0, 0.1, Math.PI - 0.1), r * 0.05, COL.vermDark, 0.2, 0.2);
    line(ctx, quadPts(-0.08 * r, -0.36 * r, 0.12 * r, -0.3 * r, 0.34 * r, -0.37 * r, 6), r * 0.07, INK, 0.2, 0.2);
    for (const fx of [-0.04, 0.26]) shape(ctx, U(r, [[fx - 0.04, -0.34], [fx, -0.46], [fx + 0.04, -0.33]]), COL.paper, w * 0.5, null, null);
  },

  // Gashadokuro : squelette géant qui rampe hors d'une brume d'indigo.
  // Les orbites lumineuses (élément absorbé) sont dessinées à part.
  gashadokuro(ctx, e, r, t) {
    const a = t * TAU;
    const w = r * 0.06;
    // volutes de la brume d'où il surgit (le lavis est dessiné sous le sprite : META.under)
    for (let k = 0; k < 4; k++) {
      const cx = (-0.75 + k * 0.5) * r;
      line(ctx, ell(cx, 0.82 * r, 0.2 * r, 0.1 * r, 8, 0, Math.PI * 0.9, Math.PI * (2.2 + 0.2 * Math.sin(a + k))), r * 0.07, withAlpha(COL.indigoLight, 0.7), 0.2, 0.6);
    }
    // bras qui rampent (alternés) : os épais cernés d'encre, mains griffues
    for (const s of [-1, 1]) {
      const reach = Math.sin(a + (s > 0 ? 0 : Math.PI));
      const col = s < 0 ? mix(COL.bone, COL.boneShade, 0.5) : COL.bone;
      const sho = [s * 0.4 * r, 0.0];
      const elb = [s * (0.9 + 0.05 * reach) * r, (0.14 - 0.16 * reach) * r];
      const wri = [s * (0.84 + 0.14 * reach) * r, (0.6 - 0.12 * Math.max(0, reach)) * r];
      bone(ctx, sho, elb, r * 0.13, col, w);
      bone(ctx, elb, wri, r * 0.11, col, w);
      for (let k = 0; k < 4; k++) {
        const fx = wri[0] + s * (-0.1 + k * 0.075) * r;
        const mid = [fx + s * 0.05 * r, wri[1] + 0.1 * r];
        const tip = [fx + s * 0.1 * r, wri[1] + 0.2 * r];
        bone(ctx, [fx, wri[1]], mid, r * 0.05, col, w * 0.7);
        bone(ctx, mid, tip, r * 0.04, col, w * 0.7);
      }
      shape(ctx, ell(wri[0], wri[1], 0.14 * r, 0.1 * r, 12), col, w * 0.8, null, null);
    }
    // colonne, clavicules et côtes
    for (let k = 0; k < 6; k++) shape(ctx, ell(0, (0.0 + k * 0.13) * r, 0.06 * r, 0.05 * r, 10), COL.bone, w * 0.6, null, null);
    for (const s of [-1, 1]) {
      limb(ctx, quadPts(0, -0.04 * r, s * 0.24 * r, -0.1 * r, s * 0.46 * r, 0.0, 5), r * 0.06, w * 0.6, COL.bone);
      for (let k = 0; k < 4; k++) {
        const y0 = (0.08 + k * 0.13) * r;
        const span = 0.46 - k * 0.05;
        limb(ctx, quadPts(s * 0.04 * r, y0, s * span * r, y0 - 0.08 * r, s * (span - 0.06) * r, y0 + 0.14 * r, 6), r * (0.06 - k * 0.006), w * 0.6, COL.bone);
      }
    }
    // crâne
    const jaw = 0.03 + 0.04 * Math.max(0, Math.sin(a * 2));
    shape(ctx, U(r, [[-0.16, -0.24], [0.28, -0.24], [0.24, -0.06 + jaw], [0.06, 0.0 + jaw], [-0.12, -0.06 + jaw]]), COL.bone, w, COL.boneShade, null);
    shape(ctx, ellW(0.06 * r, -0.5 * r, 0.44 * r, 0.38 * r, seeded(13), 0.03, 26), COL.bone, w, COL.boneShade, '#ffffff');
    // dents
    ctx.fillStyle = INK;
    for (let k = -2; k <= 3; k++) ctx.fillRect((0.06 + k * 0.065) * r - 0.012 * r, -0.2 * r, 0.024 * r, 0.1 * r);
    line(ctx, [[-0.14 * r, -0.2 * r], [0.26 * r, -0.2 * r]], r * 0.04, INK, 0.1, 0.1);
    for (let k = -1; k <= 2; k++) ctx.fillRect((0.06 + k * 0.07) * r - 0.012 * r, (-0.08 + jaw) * r, 0.024 * r, 0.07 * r);
    // orbites, cavité nasale, fêlures
    for (const [ex, ey] of META_EYES) {
      const ok = ell(ex * r, ey * r, 0.135 * r, 0.12 * r, 14, ex < 0.06 ? 0.3 : -0.3);
      shape(ctx, ok, COL.hole, 0, null, null);
    }
    shape(ctx, U(r, [[0.06, -0.38], [0.12, -0.28], [0.06, -0.3], [0.0, -0.28]]), COL.hole, 0, null, null);
    line(ctx, [[-0.08 * r, -0.86 * r], [-0.02 * r, -0.76 * r], [-0.08 * r, -0.68 * r]], r * 0.035, INK, 0.2, 0.6);
    line(ctx, [[0.3 * r, -0.8 * r], [0.24 * r, -0.72 * r]], r * 0.03, INK, 0.2, 0.6);
  },
};

// Position des orbites du gashadokuro (unités de r), partagée avec la lueur dynamique.
const META_EYES = [[-0.1, -0.5], [0.23, -0.5]];

// Faucille : lame en croissant, convexe vers l'avant, de la base (x, y) à la pointe.
function sickle(ctx, x, y, len, rot, w, col) {
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const P = ([px, py]) => [x + (px * cr - py * sr) * len, y + (px * sr + py * cr) * len];
  const outer = quadPts(0, 0, 0.85, -0.3, 0.12, -1, 8);
  const inner = quadPts(0.12, -1, 0.42, -0.42, -0.08, -0.06, 6);
  const pts = outer.concat(inner.slice(1)).map(P);
  shape(ctx, pts, col, w, null, '#ffffff');
  line(ctx, quadPts(0.1, -0.1, 0.66, -0.34, 0.16, -0.88, 6).map(P), Math.max(0.6, len * 0.05), withAlpha('#ffffff', 0.9), 0.3, 0.5);
}

// Os : fût cerné d'encre et têtes renflées aux deux bouts.
function bone(ctx, p0, p1, w, col, edge) {
  ctx.lineCap = 'round';
  for (const [c, ww] of [[INK, w + edge * 2], [col, w]]) {
    ctx.strokeStyle = c;
    ctx.lineWidth = ww;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.stroke();
    dot(ctx, p0[0], p0[1], ww * 0.62, c);
    dot(ctx, p1[0], p1[1], ww * 0.62, c);
  }
}

// Aile de tengu : bord d'attaque arqué, plumes primaires détachées.
function wing(ctx, s, f, r, w) {
  const th = -0.2 - 0.55 * f;
  const cr = Math.cos(th);
  const sr = Math.sin(th);
  const base = [
    [0.1, -0.14], [0.55, -0.48], [1.0, -0.42], [1.48, -0.22], [1.24, -0.08], [1.36, 0.0],
    [1.08, 0.06], [1.16, 0.16], [0.86, 0.14], [0.88, 0.26], [0.56, 0.18], [0.14, 0.18],
  ];
  const pts = base.map(([px, py]) => {
    const dx = px - 0.12;
    return [s * (0.12 + dx * cr - py * sr) * r, (dx * sr + py * cr) * r];
  });
  shape(ctx, pts, s < 0 ? COL.indigoInk : COL.indigo, w, INK, COL.indigoLight);
  const P = (px, py) => {
    const dx = px - 0.12;
    return [s * (0.12 + dx * cr - py * sr) * r, (dx * sr + py * cr) * r];
  };
  for (const [nx, ny] of [[1.24, -0.08], [1.08, 0.06], [0.86, 0.14], [0.56, 0.18]]) {
    line(ctx, [P(nx, ny), P(nx - 0.32, ny - 0.18)], r * 0.05, withAlpha(COL.indigoLight, 0.9), 0.2, 0.6);
  }
}

// Queue de kitsune : panache effilé à pointe vermillon.
function foxTail(ctx, r, w, ang, len) {
  const bx = -0.4 * r;
  const by = 0.08 * r;
  const L = len * r;
  const spine = [];
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    const aa = ang + Math.sin(u * Math.PI) * 0.35 - u * 0.25;
    spine.push([bx + Math.cos(aa) * L * u, by + Math.sin(aa) * L * u]);
  }
  const left = [];
  const right = [];
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    const p = spine[i];
    const q = spine[Math.min(10, i + 1)];
    const o = spine[Math.max(0, i - 1)];
    let dx = q[0] - o[0];
    let dy = q[1] - o[1];
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    const hw = r * 0.2 * Math.pow(Math.sin(Math.min(1, u * 1.08) * Math.PI), 0.7) * (0.55 + 0.45 * u) + r * 0.03;
    left.push([p[0] - dy * hw, p[1] + dx * hw]);
    right.push([p[0] + dy * hw, p[1] - dx * hw]);
  }
  const pts = left.concat(right.reverse());
  polyPath(ctx, pts);
  ctx.fillStyle = COL.paper;
  ctx.fill();
  ctx.save();
  ctx.clip();
  wash(ctx, spine[3][0], spine[3][1] + r * 0.1, r * 0.4, COL.warmShade, 0.7);
  const tip = spine[9];
  dot(ctx, tip[0], tip[1], r * 0.26, COL.verm);
  dot(ctx, spine[7][0], spine[7][1], r * 0.12, withAlpha(COL.gold, 0.5));
  ctx.restore();
  inkContour(ctx, pts, w);
}

// ───────────────────────── Métadonnées d'animation ─────────────────────────
//
//   box      emprise du sprite [x0, y0, x1, y1] en unités de r (repère tourné à droite)
//   frames   images par cycle ; rate : cycles par seconde à allure normale
//   head     position de la tête (vapeur) ; top : haut de la silhouette (barre, étoiles)
//   foot     niveau des pieds (ombre, ancrage) ; shadow : demi-largeur de l'ombre
//   core     centre du corps (fissures, flammes) ; lift : altitude des volants
//   motion   mouvement du cycle : bascule et écrasement sont cuits dans les images,
//            le rebond vertical est appliqué en continu (au pixel physique près)
//   under    dessiné sous le corps, repère du monde
//   overlay  dessiné sur le corps, repère du monde (sprites alignés)
//   after    parties dynamiques dans le repère du corps (transformées : à réserver aux boss)

const MO = { bob: 0, rot: 0, sx: 1, sy: 1 };
function mo(bob, rot, sx = 1, sy = 1) {
  MO.bob = bob;
  MO.rot = rot;
  MO.sx = sx;
  MO.sy = sy;
  return MO;
}

const META = {
  kodama: {
    box: [-0.9, -1.22, 0.9, 1.0], frames: 8, rate: 1.6, head: [0.12, -0.28], top: -1.02, foot: 0.88, shadow: 0.52, core: 0.3,
    variant: (e) => Math.floor((e.seed ?? 0.3) * 3) % 3,
    fake: (v) => ({ seed: (v + 0.5) / 3 }),
    motion: (a) => mo(-Math.abs(Math.sin(a)) * 0.07, Math.sin(a) * 0.04),
  },
  kamaitachi: {
    box: [-1.8, -1.05, 1.4, 1.02], frames: 8, rate: 3.0, head: [0.86, -0.3], top: -0.86, foot: 0.78, shadow: 0.85, core: 0.0,
    motion: (a) => mo(-Math.cos(a) * 0.06, Math.cos(a) * 0.05),
  },
  kappa: {
    box: [-1.0, -0.98, 1.08, 1.04], frames: 8, rate: 1.3, head: [0.38, -0.42], top: -0.86, foot: 0.9, shadow: 0.7, core: 0.1,
    motion: (a) => mo(-Math.abs(Math.sin(a)) * 0.04, Math.sin(a) * 0.07),
  },
  tengu: {
    box: [-1.65, -1.38, 1.65, 1.0], frames: 8, rate: 2.0, head: [0.07, -0.44], top: -0.92, foot: 0.75, shadow: 0.62, core: 0.1, lift: 0.8,
    motion: (a) => mo(-Math.cos(a) * 0.09, 0),
  },
  nuppeppo: {
    box: [-1.15, -1.0, 1.17, 1.02], frames: 8, rate: 1.0, head: [0.2, -0.2], top: -0.78, foot: 0.88, shadow: 0.85, core: 0.2,
    motion: (a) => mo(0, 0, 1 + Math.sin(a) * 0.05, 1 - Math.sin(a) * 0.05),
  },
  kitsune: {
    box: [-1.8, -1.36, 1.25, 1.0], frames: 8, rate: 2.0, head: [0.86, -0.32], top: -0.92, foot: 0.88, shadow: 0.75, core: 0.15,
    motion: (a) => mo(-Math.abs(Math.sin(a)) * 0.06, 0),
    overlay: foxfire,
  },
  yukionna: {
    box: [-1.28, -1.04, 1.04, 1.14], frames: 8, rate: 0.5, head: [0.12, -0.52], top: -0.88, foot: 0.9, shadow: 0.55, core: 0.15,
    motion: (a) => mo(Math.sin(a) * 0.09 - 0.08, Math.sin(a) * 0.03),
  },
  akaoni: {
    box: [-1.08, -1.36, 1.08, 1.06], frames: 8, rate: 0.9, head: [0.08, -0.62], top: -1.3, foot: 0.92, shadow: 0.78, core: 0.15,
    variant: (e) => (e.enraged ? 1 : 0),
    fake: (v) => ({ seed: 0.5, enraged: v === 1 }),
    motion: (a) => mo(-Math.abs(Math.sin(a)) * 0.04, Math.sin(a) * 0.03),
    under: stompWarning,
    after: oniClub,
  },
  gashadokuro: {
    box: [-1.45, -1.04, 1.45, 1.12], frames: 8, rate: 0.55, head: [0.06, -0.5], top: -0.95, foot: 0.85, shadow: 1.05, core: 0.1,
    motion: (a) => mo(Math.sin(a) * 0.03, Math.sin(a) * 0.02),
    under: (ctx, e, x, y, by, r, ts, scale) => blit(ctx, auraSprite(COL.indigo, INK, r * 1.3, scale), x, by + 0.75 * r),
    overlay: skullEyes,
  },
};
// Look ajouté sans métadonnées : dessiné en vectoriel à chaque frame.
const GENERIC = { box: null, frames: 0, rate: 1, head: [0.1, -0.3], top: -1.0, foot: 0.85, shadow: 0.7, core: 0.1, motion: null };

// Cadre du dessin d'un yokai, en rayons, dans le repère du corps tourné vers la
// droite ([x0, y0, x1, y1]), et hauteur de vol : sert à cadrer les vignettes
// (carte de présentation) sans connaître le détail de chaque look.
export function enemyFrame(def) {
  const look = typeof LOOKS[def?.look] === 'function' ? def.look : 'kodama';
  const meta = META[look] || GENERIC;
  return { box: meta.box || [-1.2, -1.3, 1.2, 1.0], lift: def?.abilities?.flying ? meta.lift ?? 0.75 : 0 };
}

// ───────────────────────── Alignement au pixel physique ─────────────────────────
// En rendu logiciel, un drawImage à position fractionnaire (filtrage bilinéaire)
// coûte ~6× plus cher qu'une copie alignée. Les sprites sont rendus à la
// résolution de l'écran et posés au pixel physique près, sans transformation.

let SC = 1; // échelle courante (px physiques par px CSS)
let TX = 0; // translation courante en px physiques
let TY = 0;

// Pose le canvas `c` de sorte que son pixel (px, py) tombe sur le point CSS (x, y).
function put(ctx, c, px, py, x, y) {
  const X = Math.round(TX + x * SC) - px;
  const Y = Math.round(TY + y * SC) - py;
  ctx.drawImage(c, (X - TX) / SC, (Y - TY) / SC, c.width / SC, c.height / SC);
}

// Sprite centré sur (x, y).
function blit(ctx, s, x, y) {
  put(ctx, s.c, s.c.width >> 1, s.c.height >> 1, x, y);
}

// Coordonnée CSS ramenée sur la grille des pixels physiques.
const snapX = (x) => (Math.round(TX + x * SC) - TX) / SC;
const snapY = (y) => (Math.round(TY + y * SC) - TY) / SC;

// ───────────────────────── Parties dynamiques ─────────────────────────

// Feu follet (kitsunebi) qui flotte près des queues, couleur de l'élément absorbé.
function foxfire(ctx, e, x, by, r, flip, st, time, scale) {
  const c = e.absorb ? elemCol(e.absorb) : ELEM_FALLBACK;
  const ox = (-1.0 + Math.sin(time * 2.1 + st.seed * 6) * 0.12) * r * flip;
  const oy = (-1.0 + Math.cos(time * 2.7 + st.seed * 4) * 0.1) * r;
  blit(ctx, orbSprite(c.main, c.light, r * 0.42, scale), x + ox, by + oy);
}

// Avant le coup de massue : cercle vermillon de la zone d'étourdissement des lanternes.
function stompWarning(ctx, e, x, y, by, r, ts, scale, st) {
  const ab = st.def.abilities?.stomp;
  const s = e.timers?.stomp;
  if (!ab || s == null || s >= 0.9 || e.blindT > 0) return;
  const k = smooth(0, 1, (0.9 - s) / 0.9);
  ctx.strokeStyle = withAlpha(COL.verm, 0.25 + 0.4 * k);
  ctx.lineWidth = Math.max(1.5, ts * 0.05);
  ctx.beginPath();
  ctx.arc(x, y, ab.radius * ts * (1.06 - 0.06 * k), 0, TAU);
  ctx.stroke();
  ctx.fillStyle = withAlpha(COL.verm, 0.08 * k);
  ctx.fill();
}

// Massue de l'aka-oni : repos le long du corps, armée avant le coup, frappe au sol.
function oniClub(ctx, e, R, st, time, scale) {
  const ab = st.def.abilities?.stomp;
  const tm = e.timers;
  const rest = 0.22 + Math.sin(st.ph * TAU) * 0.08;
  let ang = rest;
  if (ab && tm && tm.stomp != null) {
    const s = tm.stomp;
    const since = ab.interval - s;
    if (since < 0.45) ang = lerp(2.05, rest, smooth(0.08, 0.45, since));
    else if (s < 0.9) ang = lerp(rest, -0.35, smooth(0, 1, (0.9 - s) / 0.9)) + Math.sin(time * 40) * 0.04;
  }
  if (e.enraged) ang += Math.sin(time * 18) * 0.05;
  const spr = clubSprite(R, scale, !!e.enraged);
  ctx.save();
  ctx.translate(0.74 * R, 0.04 * R);
  ctx.rotate(ang);
  ctx.drawImage(spr.c, -spr.w / 2, -spr.h / 2, spr.w, spr.h);
  ctx.restore();
}

// Orbites du gashadokuro : lueur de l'élément absorbé, avivée avant une invocation.
function skullEyes(ctx, e, x, by, r, flip, st, time, scale) {
  const c = e.absorb ? elemCol(e.absorb) : { main: '#9fd4ff', light: '#e6f5ff' };
  const tm = e.timers;
  let flare = 0;
  if (tm && tm.summon != null && tm.summon < 0.8) flare = (0.8 - tm.summon) / 0.8;
  const spr = orbSprite(c.main, c.light, r * (0.26 + 0.12 * flare), scale);
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * (0.8 + Math.sin(time * 4) * 0.15 + flare * 0.2);
  for (const [ex, ey] of META_EYES) blit(ctx, spr, x + ex * r * flip, by + ey * r);
  ctx.globalAlpha = prev;
}

// ───────────────────────── Caches de sprites ─────────────────────────

const sets = new Map(); // images d'animation des looks
const misc = new Map(); // petits sprites (ombres, auras, flammes, étoiles, sceaux…)
let calls = 0;
let fontOk = false;
// Budget de construction d'images par frame (lisse les à-coups en début de vague).
let frameTime = -1;
let builds = 0;

function getSet(look, meta, e, r, scale) {
  const vk = meta.variant ? meta.variant(e) : 0;
  const rpx = Math.max(6, Math.round(r * scale));
  const key = `${look}|${vk}|${rpx}|${scale}`;
  let set = sets.get(key);
  if (!set) {
    const [x0, y0, x1, y1] = meta.box;
    const W = Math.ceil((x1 - x0) * rpx) + 4;
    const H = Math.ceil((y1 - y0) * rpx) + 4;
    const ox = Math.round(-x0 * rpx) + 2;
    const oy = Math.round(-y0 * rpx) + 2;
    set = { look, vk, rpx, scale, R: rpx / scale, W, H, ox, oy, dx: -ox / scale, dy: -oy / scale, w: W / scale, h: H / scale, frames: [], used: 0 };
    sets.set(key, set);
  }
  set.used = calls;
  return set;
}

// Image i du cycle : bascule et écrasement du mouvement cuits dans le dessin.
function frameOf(set, meta, i) {
  let fr = set.frames[i];
  if (fr) return fr;
  if (builds >= 2) {
    // budget épuisé : on reprend provisoirement l'image déjà prête la plus proche
    for (let k = 1; k < meta.frames; k++) {
      const alt = set.frames[(i - k + meta.frames) % meta.frames];
      if (alt) return alt;
    }
  }
  builds++;
  const c = makeCanvas(set.W, set.H);
  const g = c.getContext('2d');
  g.setTransform(set.scale, 0, 0, set.scale, set.ox, set.oy);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const fake = meta.fake ? meta.fake(set.vk) : { seed: 0.5 };
  if (meta.motion) {
    const mv = meta.motion((i / meta.frames) * TAU, fake);
    const fy = meta.foot * set.R;
    g.translate(0, fy);
    if (mv.rot) g.rotate(mv.rot);
    g.scale(mv.sx, mv.sy);
    g.translate(0, -fy);
  }
  LOOKS[set.look](g, fake, set.R, i / meta.frames);
  fr = { c, m: null, sil: {} };
  set.frames[i] = fr;
  return fr;
}

// Version miroir (yokai tourné vers la gauche), créée à la demande.
function mirrorOf(fr) {
  if (fr.m) return fr.m;
  const c = makeCanvas(fr.c.width, fr.c.height);
  const g = c.getContext('2d');
  g.translate(c.width, 0);
  g.scale(-1, 1);
  g.drawImage(fr.c, 0, 0);
  fr.m = c;
  return c;
}

// Silhouette unie d'une image (flash d'impact, encre d'apparition, givre).
function silhouette(fr, color, flip) {
  const key = flip < 0 ? color + 'm' : color;
  let c = fr.sil[key];
  if (c) return c;
  c = makeCanvas(fr.c.width, fr.c.height);
  const g = c.getContext('2d');
  g.drawImage(flip < 0 ? mirrorOf(fr) : fr.c, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  fr.sil[key] = c;
  return c;
}

// Purge des jeux d'images inutilisés (changement de résolution, de niveau…).
function purge() {
  for (const [k, s] of sets) if (calls - s.used > 30000) sets.delete(k);
  if (misc.size > 500) misc.clear();
}

// Petit sprite centré, rendu à la résolution de l'écran ; w, h en px CSS.
function sprite(key, w, h, scale, draw) {
  const k = `${key}|${scale}`;
  let s = misc.get(k);
  if (s) return s;
  const c = makeCanvas(w * scale, h * scale);
  const g = c.getContext('2d');
  g.setTransform(scale, 0, 0, scale, c.width >> 1, c.height >> 1);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  draw(g);
  s = { c, w: c.width / scale, h: c.height / scale };
  misc.set(k, s);
  return s;
}

const q2 = (v) => Math.max(1, Math.round(v * 2) / 2);

// Dégradé radial (lavis) pré-rendu ; stops = [[position, couleur, alpha], …].
function radial(g, rad, stops) {
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, rad);
  for (const [k, col, a] of stops) grad.addColorStop(k, withAlpha(col, a));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, rad, 0, TAU);
  g.fill();
}

// Ombre portée douce (ellipse aplatie).
const SHADOW = mix(INK, PALETTE.indigo, 0.4);
function shadowSprite(rx, scale) {
  const rq = q2(rx);
  return sprite(`sh${rq}`, rq * 2 + 2, rq * 0.7 + 2, scale, (g) => {
    g.scale(1, 0.32);
    radial(g, rq, [[0, SHADOW, 0.6], [0.55, SHADOW, 0.32], [1, SHADOW, 0]]);
  });
}

// Aura (lavis à deux tons) : c1 au bord, c2 au cœur.
function auraSprite(c1, c2, rad, scale) {
  const rq = q2(rad);
  return sprite(`au${c1}${c2}${rq}`, rq * 2 + 2, rq * 2 + 2, scale, (g) => {
    radial(g, rq, [[0, c2, 0.7], [0.35, c1, 0.6], [0.7, c1, 0.28], [1, c1, 0]]);
  });
}

// Orbe lumineux (feu follet, orbites) : cœur crème, halo coloré.
function orbSprite(main, light, rad, scale) {
  const rq = q2(rad);
  return sprite(`ob${main}${rq}`, rq * 2 + 2, rq * 2 + 2, scale, (g) => {
    radial(g, rq, [[0, COL.paper, 1], [0.16, light, 1], [0.45, main, 0.75], [1, main, 0]]);
  });
}

// Bandeau de vapeur (aveuglé) : quatre bouffées crème fondues.
function steamSprite(r, scale) {
  const rq = q2(r);
  return sprite(`sb${rq}`, rq * 1.5, rq * 0.75, scale, (g) => {
    for (let i = 0; i < 4; i++) {
      g.save();
      g.translate((-0.36 + i * 0.24) * rq, (i % 2 ? -0.04 : 0.04) * rq);
      radial(g, rq * 0.3, [[0, COL.steam, 1], [0.55, COL.steam, 0.85], [1, COL.steam, 0]]);
      g.restore();
    }
  });
}

// Tache d'encre d'apparition : flaque irrégulière et éclaboussures.
let blotCanvas = null;
function blotSprite() {
  if (blotCanvas) return blotCanvas;
  const c = makeCanvas(160, 96);
  const g = c.getContext('2d');
  g.translate(80, 48);
  g.scale(1, 0.55);
  const rnd = seeded(29);
  g.fillStyle = withAlpha(INK, 0.35);
  polyPath(g, ellW(0, 0, 70, 70, rnd, 0.12, 30));
  g.fill();
  g.fillStyle = INK;
  polyPath(g, ellW(0, 0, 52, 52, rnd, 0.16, 30));
  g.fill();
  for (let k = 0; k < 9; k++) {
    const a = rnd() * TAU;
    const d = 58 + rnd() * 18;
    g.beginPath();
    g.arc(Math.cos(a) * d, Math.sin(a) * d, 3 + rnd() * 5, 0, TAU);
    g.fill();
  }
  blotCanvas = c;
  return c;
}

// Massue (kanabō) avec le poing qui la tient ; pivot = poing = centre du sprite.
function clubSprite(R, scale, rage) {
  const L = R * 1.25;
  return sprite(`club${q2(R)}${rage ? 'r' : ''}`, R * 0.6, L * 2 + R * 0.4, scale, (g) => {
    const w = R * 0.075;
    const pts = [[-0.05 * R, 0.16 * R], [0.05 * R, 0.16 * R], [0.07 * R, -0.25 * R], [0.15 * R, -L], [0.0, -L - 0.08 * R], [-0.15 * R, -L], [-0.07 * R, -0.25 * R]];
    shape(g, pts, COL.indigoInk, w, INK, COL.indigoLight);
    line(g, [[0.02 * R, -0.3 * R], [0.08 * R, -L * 0.95]], R * 0.04, withAlpha(COL.indigoLight, 0.8), 0.2, 0.4);
    for (let k = 0; k < 5; k++) {
      const yy = -0.42 * R - k * 0.17 * R;
      const half = 0.07 * R + (k / 4) * 0.07 * R;
      for (const sx of [-1, 0, 1]) {
        dot(g, sx * half * 0.75, yy, R * 0.035, INK);
        dot(g, sx * half * 0.75, yy, R * 0.024, COL.goldLight);
      }
    }
    const skin = rage ? COL.oniRage : COL.verm;
    shape(g, ell(0, 0, 0.13 * R, 0.12 * R, 14), skin, w, COL.vermDark, null);
    line(g, [[-0.08 * R, -0.03 * R], [0.06 * R, -0.05 * R]], R * 0.03, COL.vermDark, 0.2, 0.2);
  });
}

// Flammèche (3 images) : vermillon, cœur d'or, contour d'encre fin.
// Base de la flamme à +0,5·sz sous le centre du sprite, pointe à −0,95·sz.
function flameSprite(sz, scale, f) {
  return sprite(`fl${q2(sz)}|${f}`, sz * 1.1, sz * 2.1, scale, (g) => {
    const sw = [-0.14, 0.04, 0.16][f];
    const tall = [1, 0.88, 1.08][f];
    const fl = (k, col, w) => {
      const pts = qpath(sz * k, -0.3, 0.45, [
        [-0.42, 0.0, -0.12 + sw * 0.5, -0.32 * tall],
        [-0.02 + sw, -0.6 * tall, sw * 1.4, -0.95 * tall],
        [0.3 + sw * 0.5, -0.45 * tall, 0.24, -0.14 * tall],
        [0.42, 0.25, 0.0, 0.5],
        [-0.22, 0.52, -0.3, 0.45],
      ], 5);
      shape(g, pts, col, w, null, null);
    };
    fl(1, COL.verm, Math.max(0.8, sz * 0.07));
    fl(0.66, COL.goldLight, 0);
    fl(0.34, COL.paper, 0);
  });
}

function starSprite(sz, scale) {
  return sprite(`st${q2(sz)}`, sz * 1.3, sz * 1.3, scale, (g) => {
    const pts = [];
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k / 10) * TAU;
      const rr = (k % 2 ? 0.22 : 0.5) * sz;
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    shape(g, pts, COL.goldLight, Math.max(0.8, sz * 0.12), COL.gold, null);
  });
}

function frostSprite(sz, scale) {
  return sprite(`fr${q2(sz)}`, sz * 1.2, sz * 1.2, scale, (g) => {
    for (const [col, wk] of [[COL.indigo, 0.24], [ICE, 0.12]]) {
      g.strokeStyle = col;
      g.lineWidth = Math.max(0.8, sz * wk);
      g.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI + Math.PI / 6;
        g.moveTo(Math.cos(a) * sz * 0.5, Math.sin(a) * sz * 0.5);
        g.lineTo(-Math.cos(a) * sz * 0.5, -Math.sin(a) * sz * 0.5);
      }
      g.stroke();
    }
    dot(g, 0, 0, sz * 0.12, COL.paper);
  });
}

function dropSprite(sz, scale) {
  return sprite(`dr${q2(sz)}`, sz, sz * 1.4, scale, (g) => {
    const pts = qpath(sz, 0, -0.55, [[0.42, 0.05, 0.3, 0.3], [0, 0.6, -0.3, 0.3], [-0.42, 0.05, 0, -0.55]], 5);
    shape(g, pts, ICE_DEEP, Math.max(0.7, sz * 0.12), null, ICE);
  });
}

function curlSprite(sz, scale, col) {
  return sprite(`cu${q2(sz)}${col}`, sz * 1.2, sz * 1.4, scale, (g) => {
    line(g, ell(0, sz * 0.05, sz * 0.28, sz * 0.24, 10, 0, Math.PI * 0.4, Math.PI * 2.1), Math.max(1, sz * 0.12), col, 0.3, 0.3);
    line(g, quadPts(sz * 0.26, 0.0, sz * 0.4, -sz * 0.3, sz * 0.1, -sz * 0.55, 5), Math.max(1, sz * 0.1), col, 0.2, 0.7);
  });
}

// Fissures d'armure brisée : traits d'encre bordés de crème (lisibles sur tout fond).
function crackSprite(R, scale) {
  return sprite(`ck${q2(R)}`, R * 1.7, R * 1.7, scale, (g) => {
    const rnd = seeded(41);
    const paths = [];
    for (let k = 0; k < 4; k++) {
      const a = k * 1.65 + rnd() * 0.5;
      const pts = [[Math.cos(a) * R * 0.05, Math.sin(a) * R * 0.05]];
      let d = 0.05;
      while (d < 0.55) {
        d += 0.12 + rnd() * 0.06;
        const aa = a + (rnd() - 0.5) * 0.9;
        pts.push([Math.cos(aa) * R * d, Math.sin(aa) * R * d]);
      }
      paths.push(pts);
    }
    const wk = Math.max(1.2, R * 0.12);
    for (const p of paths) line(g, p, wk * 2.1, withAlpha(COL.paper, 0.92), 0.05, 0.5);
    for (const p of paths) line(g, p, wk, INK, 0.05, 0.6);
  });
}

// Éclat d'armure qui tombe.
function chipSprite(sz, scale) {
  return sprite(`cp${q2(sz)}`, sz * 1.4, sz * 1.4, scale, (g) => {
    shape(g, [[-0.5 * sz, -0.2 * sz], [0.1 * sz, -0.5 * sz], [0.5 * sz, 0.3 * sz], [-0.2 * sz, 0.4 * sz]], COL.paper, Math.max(0.8, sz * 0.18), null, null);
  });
}

function sealSprite(el, d, scale) {
  return sprite(`se${el}${q2(d)}${fontOk ? 1 : 0}`, d + 3, d + 3, scale, (g) => {
    const c = elemCol(el);
    dot(g, 0, 0, d / 2 + 0.6, INK);
    dot(g, 0, 0, d / 2 - 0.3, c.main);
    dot(g, 0, 0, d / 2 - Math.max(1.2, d * 0.13), c.dark);
    g.fillStyle = COL.paper;
    g.font = `800 ${Math.round(d * 0.66)}px "Shippori Mincho", "Hiragino Mincho ProN", serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(KANJI[el] || '?', 0, d * 0.05);
  });
}

// Fond de la barre de vie : trait d'encre effilé, piste crème (w, h en px CSS).
function barSprite(w, h, scale) {
  return sprite(`bar${w}x${h}`, w + h * 2.6, h * 2.6, scale, (g) => {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      pts.push([(u - 0.5) * (w + h * 1.6), Math.sin(u * 5.5) * h * 0.08]);
    }
    brushStroke(g, pts, h * 2.1, withAlpha(INK, 0.82), { taperIn: 0.08, taperOut: 0.1 });
    g.fillStyle = withAlpha(COL.cream, 0.9);
    g.fillRect(-w / 2, -h / 2, w, h);
  });
}

// ───────────────────────── État de rendu par yokai ─────────────────────────
// Horloge d'animation propre (figée si étourdi, ralentie si ralenti), durée
// d'apparition initiale et PV affichés (traînée de dégâts). Rangé dans une
// WeakMap pour ne pas toucher aux entités du moteur.

const states = new WeakMap();
function stateOf(e, def, meta, time) {
  let st = states.get(e);
  const k = e.maxHp > 0 ? clamp01((e.hp ?? e.maxHp) / e.maxHp) : 1;
  const seed = e.seed ?? 0.5;
  if (!st) {
    st = { ph: time * meta.rate + seed * 7, lt: time, s0: e.spawnT > 0 ? e.spawnT : 0, hp: k, seed, def };
    states.set(e, st);
    return st;
  }
  st.def = def;
  let dt = time - st.lt;
  st.lt = time;
  if (!(dt > 0)) dt = 0;
  else if (dt > 0.25) dt = 0.25;
  let rate = meta.rate;
  if (e.stunT > 0) rate = 0;
  else if (e.slowT > 0 && e.slowF < 1) rate *= Math.max(0.3, e.slowF);
  if (e.enraged) rate *= 1.5;
  st.ph += dt * rate;
  if (e.spawnT > st.s0) st.s0 = e.spawnT;
  if (k >= st.hp) st.hp = k;
  else st.hp = Math.max(k, st.hp - dt * 0.8);
  return st;
}

// ───────────────────────── Dessin d'un yokai ─────────────────────────

export function drawEnemy(ctx, e, def, x, y, ts, time) {
  def = def || {};
  const look = typeof LOOKS[def.look] === 'function' ? def.look : 'kodama';
  const meta = META[look] || GENERIC;
  const r = (e.size ?? def.size ?? 0.3) * ts;
  if (!(r > 0)) return;
  calls++;
  if (calls % 5000 === 0) purge();
  if (time !== frameTime) {
    frameTime = time;
    builds = 0;
  }
  if (!fontOk && calls % 60 === 1) fontOk = !!document.fonts?.check?.('800 12px "Shippori Mincho"');
  const m = ctx.getTransform();
  const scale = Math.min(4, Math.max(1, Math.round(Math.hypot(m.a, m.b) * 1000) / 1000));
  SC = scale;
  TX = m.e;
  TY = m.f;
  const st = stateOf(e, def, meta, time);
  const seed = st.seed;
  const flip = e.dirX < 0 ? -1 : 1;
  const prevAlpha = ctx.globalAlpha;

  // Apparition : la silhouette monte d'une tache d'encre qui se résorbe.
  // Durée totale = âge + temps restant (0,7 s, ou 0,25 s pour les enfants).
  let p = 1;
  if (e.spawnT > 0) {
    const s0 = e.age >= 0 ? e.age + e.spawnT : st.s0 > 0.26 ? Math.max(0.7, st.s0) : 0.25;
    p = clamp01(1 - e.spawnT / s0);
  }
  const bob = meta.motion ? meta.motion(st.ph * TAU, e).bob * r : 0;
  const lift = e.flying ? (meta.lift ?? 0.75) * r : 0;
  const by = y - lift + bob; // origine du corps
  const groundY = y + meta.foot * r;
  const hk = e.hitT > 0 ? clamp01(e.hitT / 0.12) : 0;
  const ab = def.abilities;

  // Ombre portée (les volants : plus pâle, détachée du corps).
  const sh = shadowSprite(r * meta.shadow, scale);
  ctx.globalAlpha = prevAlpha * (e.flying ? 0.5 : 1) * (0.3 + 0.7 * p);
  blit(ctx, sh, x, e.flying ? y + r * 0.85 : groundY);
  ctx.globalAlpha = prevAlpha;

  // Auras derrière le corps.
  if (p > 0.5) {
    const ak = smooth(0.5, 1, p);
    if (e.enraged) {
      ctx.globalAlpha = prevAlpha * (0.75 + Math.sin(time * 9) * 0.25) * ak;
      blit(ctx, auraSprite(COL.verm, COL.vermLight, r * 1.8, scale), x, by + 0.05 * r);
    }
    if (e.absorb) {
      const c = elemCol(e.absorb);
      ctx.globalAlpha = prevAlpha * (0.72 + Math.sin(time * 4 + seed * 6) * 0.2) * ak;
      blit(ctx, auraSprite(c.main, c.light, r * 1.5, scale), x, by + meta.core * r);
    }
    ctx.globalAlpha = prevAlpha;
    if (ab?.healAura && !(e.blindT > 0)) drawHealHalo(ctx, e, ab.healAura, x, y, by, r, ts, time, seed, ak, scale);
  }
  if (meta.under) meta.under(ctx, e, x, y, by, r, ts, scale, st, time);

  // Corps.
  if (meta.frames > 0) {
    const set = getSet(look, meta, e, r, scale);
    const n = meta.frames;
    const fi = (((Math.floor(st.ph * n) % n) + n) % n) | 0;
    const fr = frameOf(set, meta, fi);
    if (p < 1) {
      // Apparition : tache, volutes, puis la silhouette d'encre prend ses couleurs.
      drawSpawnInk(ctx, x, groundY - (e.flying ? 0 : r * 0.06), r, p, seed);
      const e1 = smooth(0.06, 0.8, p);
      const sy = 0.2 + 0.8 * easeOutBack(e1);
      const sx = 1.3 - 0.3 * e1;
      const colorA = smooth(0.4, 0.95, p);
      const inkA = smooth(0.04, 0.3, p);
      const fy = meta.foot * r;
      ctx.save();
      ctx.translate(x, by + fy);
      ctx.scale(flip * sx, sy);
      ctx.translate(0, -fy);
      if (inkA > 0.01) {
        ctx.globalAlpha = prevAlpha * inkA;
        ctx.drawImage(silhouette(fr, INK, 1), set.dx, set.dy, set.w, set.h);
      }
      if (colorA > 0) {
        ctx.globalAlpha = prevAlpha * colorA;
        ctx.drawImage(fr.c, set.dx, set.dy, set.w, set.h);
      }
      ctx.restore();
      ctx.globalAlpha = prevAlpha;
      return;
    }
    const img = flip > 0 ? fr.c : mirrorOf(fr);
    const px = flip > 0 ? set.ox : set.W - set.ox;
    put(ctx, img, px, set.oy, x, by);
    if (e.slowT > 0 && e.slowF < 1) {
      ctx.globalAlpha = prevAlpha * (0.2 + 0.2 * clamp01((1 - e.slowF) * 1.6));
      put(ctx, silhouette(fr, ICE, flip), px, set.oy, x, by);
    }
    if (hk > 0) {
      ctx.globalAlpha = prevAlpha * hk * 0.7;
      put(ctx, silhouette(fr, COL.steam, flip), px, set.oy, x, by);
    }
    ctx.globalAlpha = prevAlpha;
    if (meta.after) {
      ctx.save();
      ctx.translate(snapX(x), snapY(by));
      ctx.scale(flip, 1);
      meta.after(ctx, e, set.R, st, time, scale);
      ctx.restore();
    }
  } else {
    // Look sans métadonnées : vectoriel direct (temps réel en secondes).
    if (p < 1) drawSpawnInk(ctx, x, groundY, r, p, seed);
    ctx.save();
    ctx.globalAlpha = prevAlpha * smooth(0.3, 1, p);
    ctx.translate(x, by);
    ctx.scale(flip, 1);
    LOOKS[look](ctx, e, r, time + seed * 10);
    ctx.restore();
    if (hk > 0) blit(ctx, auraSprite('#ffffff', '#ffffff', r * 1.1, scale), x, by);
    if (p < 1) return;
  }
  if (meta.overlay) meta.overlay(ctx, e, x, by, r, flip, st, time, scale);

  // États visibles.
  const hx = x + flip * meta.head[0] * r;
  const hy = by + meta.head[1] * r;
  const topY = by + meta.top * r;
  const cy = by + meta.core * r;
  if (e.shredT > 0) drawShred(ctx, x, cy, r, scale, time, seed);
  if (e.burnT > 0) drawBurn(ctx, x, cy, r, scale, time, seed);
  if (e.slowT > 0 && e.slowF < 1) drawSlow(ctx, x, by, e.flying ? by + 0.6 * r : groundY, r, scale, time, seed);
  if (e.blindT > 0) drawBlind(ctx, hx, hy, r, scale, time, seed);
  if (e.stunT > 0) drawStun(ctx, x, topY, r, scale, time);
  if (e.enraged) drawRage(ctx, hx, topY, r, scale, time, seed);
  if (e.absorb && KANJI[e.absorb]) {
    const d = Math.min(26, Math.max(9, ts * 0.27));
    blit(ctx, sealSprite(e.absorb, d, scale), x + Math.max(r * 0.72, d * 0.9), topY + d * 0.55);
  }

  // Barre de vie au pinceau (avec traînée des dégâts récents).
  const k = e.maxHp > 0 ? clamp01(e.hp / e.maxHp) : 1;
  if (k < 1 && e.hp != null) drawBar(ctx, x, topY, r, ts, k, st.hp, !!e.boss, scale);
}

function drawBar(ctx, x, topY, r, ts, k, kShow, boss, scale) {
  const w = Math.round(Math.min(ts * (boss ? 1.3 : 0.95), Math.max(ts * 0.44, r * 1.7)));
  const h = Math.max(2, Math.round(Math.max(2.5, ts * 0.07) * SC) / SC);
  const yb = topY - h * 1.6;
  blit(ctx, barSprite(w, h, scale), x, yb);
  const bx = snapX(x - w / 2);
  const by = snapY(yb - h / 2);
  if (kShow > k + 0.004) {
    ctx.fillStyle = COL.paper;
    ctx.fillRect(bx, by, w * kShow, h);
  }
  if (k <= 0) return;
  ctx.fillStyle = k > 0.5 ? COL.moss : k > 0.25 ? COL.gold : COL.verm;
  ctx.fillRect(bx, by, w * k, h);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(bx, by, w * k, h * 0.34);
}

// ───────────────────────── Surcouches d'état ─────────────────────────

function drawSpawnInk(ctx, x, gy, r, p, seed) {
  const grow = smooth(0, 0.22, p);
  const shrink = 1 - smooth(0.45, 1, p);
  const rad = r * (0.4 + 0.9 * grow) * (0.3 + 0.7 * shrink);
  const al = grow * (0.2 + 0.8 * shrink);
  const prev = ctx.globalAlpha;
  if (al > 0.01) {
    wash(ctx, x, gy, rad * 1.6, INK, 0.3 * al);
    ctx.globalAlpha = prev * al;
    ctx.drawImage(blotSprite(), x - rad, gy - rad * 0.6, rad * 2, rad * 1.2);
    ctx.globalAlpha = prev;
  }
  // volutes : trois filets d'encre qui s'enroulent en montant puis se resserrent
  const k = 1 - smooth(0.2, 1, p);
  if (k <= 0.02) return;
  for (let i = 0; i < 3; i++) {
    const pts = [];
    for (let j = 0; j < 7; j++) {
      const u = j / 6;
      const ang = seed * 6 + (i * TAU) / 3 + p * 5 + u * 2.4;
      const rr = r * (0.3 + 0.9 * k) * (1 - u * 0.5);
      pts.push([x + Math.cos(ang) * rr, gy - u * r * (0.5 + 1.1 * p) + Math.sin(ang) * rr * 0.35]);
    }
    brushStroke(ctx, pts, r * 0.17 * (0.35 + 0.65 * k), INK, { taperIn: 0.2, taperOut: 0.6, alpha: 0.85 * Math.min(1, grow * 2) * k });
  }
}

function drawHealHalo(ctx, e, aura, x, y, by, r, ts, time, seed, ak, scale) {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * (0.7 + Math.sin(time * 3.2 + seed * 5) * 0.3) * ak;
  blit(ctx, auraSprite(COL.heal, COL.paper, r * 1.45, scale), x, by + 0.1 * r);
  ctx.globalAlpha = prev;
  const iv = aura.interval || 1.3;
  const tm = e.timers;
  const q = tm && tm.heal != null ? clamp01(1 - tm.heal / iv) : (time / iv + seed) % 1;
  if (q < 0.45) {
    const k = q / 0.45;
    const R = r * 0.9 + ((aura.radius || 1.5) * ts - r * 0.9) * (1 - (1 - k) * (1 - k));
    ctx.strokeStyle = withAlpha(COL.healDeep, (1 - k) * 0.6 * ak);
    ctx.lineWidth = Math.max(1.2, ts * 0.04) * (1 - k * 0.5);
    ctx.beginPath();
    ctx.arc(x, y, R, 0, TAU);
    ctx.stroke();
  }
}

function drawShred(ctx, x, cy, r, scale, time, seed) {
  blit(ctx, crackSprite(r, scale), x, cy);
  // un éclat qui se détache et tombe
  const ph = (time * 1.4 + seed * 3) % 1;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * (1 - ph);
  blit(ctx, chipSprite(Math.max(2.5, r * 0.18), scale), x + (seed - 0.5) * 0.8 * r + ph * 0.15 * r, cy + ph * 0.7 * r);
  ctx.globalAlpha = prev;
}

function drawBurn(ctx, x, cy, r, scale, time, seed) {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * (0.55 + Math.sin(time * 17 + seed * 9) * 0.12);
  blit(ctx, auraSprite(COL.vermLight, COL.goldLight, r * 1.05, scale), x, cy);
  ctx.globalAlpha = prev;
  const sz = Math.max(6, r * 0.52);
  const spots = [[-0.4, 0.22], [0.38, 0.08], [0.0, 0.46]];
  for (let i = 0; i < 3; i++) {
    const f = (Math.floor(time * 13 + i * 1.7 + seed * 5) % 3 + 3) % 3;
    const s = flameSprite(sz * (i === 2 ? 0.8 : 1), scale, f);
    blit(ctx, s, x + spots[i][0] * r, cy + spots[i][1] * r - sz * (i === 2 ? 0.4 : 0.5));
  }
}

function drawSlow(ctx, x, by, gy, r, scale, time, seed) {
  const fz = frostSprite(Math.max(5, r * 0.42), scale);
  blit(ctx, fz, x - 0.44 * r, gy - 0.14 * r);
  blit(ctx, frostSprite(Math.max(4, r * 0.32), scale), x + 0.48 * r, gy - 0.3 * r);
  const ds = dropSprite(Math.max(3.5, r * 0.2), scale);
  const prev = ctx.globalAlpha;
  for (let i = 0; i < 2; i++) {
    const ph = (time * 1.2 + seed * 3 + i * 0.5) % 1;
    ctx.globalAlpha = prev * (1 - ph * ph);
    blit(ctx, ds, x + (i ? 0.24 : -0.16) * r, by + (0.1 + ph * 0.55) * r);
  }
  ctx.globalAlpha = prev;
}

function drawBlind(ctx, hx, hy, r, scale, time, seed) {
  // bandeau de vapeur sur les yeux, qui ondule ; volutes qui s'échappent
  blit(ctx, steamSprite(r, scale), hx + Math.sin(time * 2.4 + seed * 5) * 0.06 * r, hy + Math.sin(time * 3.1) * 0.04 * r);
  const cs = curlSprite(Math.max(6, r * 0.5), scale, COL.indigoLight);
  const prev = ctx.globalAlpha;
  for (let i = 0; i < 2; i++) {
    const ph = (time * 0.8 + seed + i * 0.5) % 1;
    ctx.globalAlpha = prev * Math.sin(ph * Math.PI);
    blit(ctx, cs, hx + (i ? 0.34 : -0.34) * r, hy - 0.22 * r - ph * 0.5 * r);
  }
  ctx.globalAlpha = prev;
}

function drawStun(ctx, x, topY, r, scale, time) {
  const cy = topY - 0.02 * r;
  const rx = Math.max(7, r * 0.55);
  const ry = rx * 0.32;
  ctx.strokeStyle = withAlpha(INK, 0.45);
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.beginPath();
  ctx.ellipse(x, cy, rx, ry, 0, 0, TAU);
  ctx.stroke();
  const sz = Math.max(6.5, r * 0.48);
  const near = starSprite(sz, scale);
  const far = starSprite(sz * 0.72, scale);
  for (let i = 0; i < 3; i++) {
    const ang = time * 5.5 + (i * TAU) / 3;
    blit(ctx, Math.sin(ang) > 0 ? near : far, x + Math.cos(ang) * rx, cy + Math.sin(ang) * ry);
  }
}

function drawRage(ctx, hx, topY, r, scale, time, seed) {
  // bouffées de colère qui montent de la tête
  const prev = ctx.globalAlpha;
  const puff = auraSprite(COL.vermLight, COL.steam, r * 0.32, scale);
  for (let k = 0; k < 3; k++) {
    const ph = (time * 1.1 + k / 3 + seed) % 1;
    const side = k === 1 ? 0.05 : k ? 0.3 : -0.25;
    ctx.globalAlpha = prev * (1 - ph) * 0.9;
    blit(ctx, puff, hx + side * r + Math.sin(ph * 6 + k) * 0.06 * r, topY + 0.35 * r - ph * r * 0.8);
  }
  ctx.globalAlpha = prev;
}
