// Lanternes-gardiennes (tōrō) dessinées au pinceau. Chaque élément a sa silhouette :
//  Feu   — kasuga-dōrō : haut fût de pierre, toit vermillon à volutes, flamme vivante
//  Eau   — yukimi-dōrō : large toit-ombrelle indigo à motif seigaiha, pieds dans un
//          bassin, gouttes qui tombent des avant-toits
//  Vent  — lanterne de papier sur fût de bambou, toits en ailes, rubans et volutes
//  Terre — oki-dōrō : bloc massif de pierre ocre, toit lourd couvert de mousse, braise
// Toute autre tour (README « Ajouter une tour ») reçoit un kasuga générique teinté
// par def.color / def.glow, son kanji gravé dès le niveau 1.
//
// Trois niveaux d'évolution :
//  N1 — un toit, pierre nue
//  N2 — plus haute, double toit liseré d'or, kanji de l'élément, joyau doré
//  N3 — trois toits, ornements dorés, auréole tournante et esprits en orbite
//
// Performance : le corps statique (ombre, pierre, toits, motifs, kanji) est rendu
// une seule fois par (tour, niveau, taille de case, échelle) dans un canvas hors
// écran à la résolution physique, puis copié par drawImage. Seules les parties
// vivantes (lumière de la chambre, flamme, rubans, gouttes, esprits) sont
// dessinées à chaque frame, avec des sprites mis en cache (wash, auréole, volutes).
import { INK, PALETTE, withAlpha, mix, wash, seeded, brushStroke, quadPts, makeCanvas } from './brush.js';

// Repère local : unité = une case, origine au pied de la lanterne, y vers le bas.
const GROUND = 0.34; // le pied de la lanterne, sous le centre de la case (en cases)
const LW = 0.03; // épaisseur du trait d'encre (en cases)
const TAU = Math.PI * 2;

const C = {
  stone: '#aaa292',
  stoneWarm: '#b0a28a',
  stoneCool: '#a2a8a6',
  ochre: '#a88d5e',
  ochreRoof: '#7b6c54',
  wood: '#7d8a45',
  bamboo: '#97a656',
  sage: '#86b07a',
  waterRoof: '#2a3f69',
  mossLight: '#a4ad62',
};

// ---------------------------------------------------------------------------
// Styles par élément (identifiés par leur kanji, ou par def.look s'il existe)
// ---------------------------------------------------------------------------

const STYLES = {
  fire: { layout: kasugaLayout, stone: C.stoneWarm, roof: PALETTE.vermillion, tip: 'curl', kanjiFrom: 2, light: lightFire, live: liveFire, spirit: spiritFire, flick: 1 },
  water: { layout: yukimiLayout, stone: C.stoneCool, roof: C.waterRoof, tip: 'umbrella', kanjiFrom: 2, light: lightWater, live: liveWater, spirit: spiritWater, flick: 0.35 },
  wind: { layout: windLayout, stone: C.stone, roof: C.sage, tip: 'wing', kanjiFrom: 2, light: lightWind, back: windSwirls, live: liveWind, spirit: spiritWind, flick: 0.5 },
  earth: { layout: earthLayout, stone: C.ochre, roof: C.ochreRoof, tip: 'heavy', kanjiFrom: 2, light: lightEarth, live: liveEarth, spirit: spiritEarth, flick: 0.3 },
  generic: { layout: kasugaLayout, stone: C.stone, roof: null, tip: 'up', kanjiFrom: 1, light: lightGeneric, live: null, spirit: spiritGeneric, flick: 0.6 },
};
const BY_KANJI = { '火': 'fire', '水': 'water', '風': 'wind', '土': 'earth' };

const styleCache = new WeakMap();
function styleOf(def) {
  let st = styleCache.get(def);
  if (!st) {
    st = STYLES[def.look] || STYLES[BY_KANJI[def.kanji]] || STYLES.generic;
    styleCache.set(def, st);
  }
  return st;
}

const defIds = new WeakMap();
let nextDefId = 1;
function defId(def) {
  let id = defIds.get(def);
  if (!id) {
    id = nextDefId++;
    defIds.set(def, id);
  }
  return id;
}

const clampLevel = (l) => Math.max(1, Math.min(3, l | 0 || 1));

// Tour décrite partiellement (README « Ajouter une tour ») : couleurs et kanji par
// défaut, pour que le dessin générique ne casse jamais.
const HEX = /^#[0-9a-f]{6}$/i;
const views = new WeakMap();
function viewOf(def) {
  let v = views.get(def);
  if (v) return v;
  const ok = HEX.test(def.color) && HEX.test(def.glow) && typeof def.kanji === 'string';
  v = ok ? def : { ...def, color: HEX.test(def.color) ? def.color : C.stone, glow: HEX.test(def.glow) ? def.glow : PALETTE.goldLight, kanji: typeof def.kanji === 'string' ? def.kanji : '' };
  views.set(def, v);
  return v;
}

// ---------------------------------------------------------------------------
// Silhouettes : chaque style décrit sa lanterne comme une pile de pièces
// (géométrie pure, en cases) ; le dessin des pièces est commun.
// ---------------------------------------------------------------------------

function liftOf(tip, h) {
  if (tip === 'wing') return h * 0.5;
  if (tip === 'curl') return h * 0.34;
  if (tip === 'heavy') return h * 0.04;
  if (tip === 'umbrella') return h * 0.1;
  return h * 0.24;
}

// Empile les toits (et les petites chambres intermédiaires) à partir de y.
function addRoofs(P, y, roofs, tiers, o) {
  const eaves = [];
  for (let i = 0; i < roofs.length; i++) {
    const [h, hw] = roofs[i];
    const y0 = y + 0.015;
    P.push({ k: 'roof', y0, h, hw, col: o.col, tip: o.tip, pattern: o.pattern, trim: o.lvl >= 2, trim2: o.lvl === 3 && i === 0, curl: o.tip === 'curl' ? (o.lvl === 3 ? PALETTE.gold : INK) : null });
    const lift = liftOf(o.tip, h);
    eaves.push([[-hw, y0 - lift], [hw, y0 - lift]]);
    y = y0 - h * 0.8;
    const t = tiers[i];
    if (t) {
      P.push({ k: 'slab', y0: y, h: t[0], hb: t[1], ht: t[1] * 0.9, col: o.stone });
      y -= t[0];
    }
  }
  return { y, eaves };
}

function winMeta(w) {
  if (w.shape === 'circle') return { ...w, x: w.cx - w.r, y: w.cy - w.r, w: w.r * 2, h: w.r * 2 };
  return { ...w, cx: w.x + w.w / 2, cy: w.y + w.h / 2 };
}

function finish(P, y, jw, lvl, stone, win, eaves, hw, def) {
  const gold = lvl >= 2;
  P.push({ k: 'jewel', y0: y + 0.01, h: jw, col: gold ? PALETTE.gold : stone, flame: lvl === 3 });
  const top = y + 0.01 - jw * (lvl === 3 ? 1.12 : 1);
  const wm = winMeta(win);
  const haloY = (top + wm.y) / 2 - 0.04;
  // lueurs fixes, peintes sous la lanterne dans le cache : flaque de lumière au sol
  // (ellipse en perspective) et, au N2, halo doux derrière les toits
  P.unshift({ k: 'glow', y: -0.06, rx: 0.5 + lvl * 0.04, ry: 0.19, col: def.glow, a: 0.34 + lvl * 0.06 });
  if (lvl === 2) P.unshift({ k: 'glow', y: haloY, rx: 0.36, ry: 0.36, col: def.glow, a: 0.3 });
  return { parts: P, meta: { top, win: wm, eaves: eaves[0], eaves2: eaves[1] || null, haloY, hw } };
}

// Feu et générique : kasuga-dōrō (socle, fût, plateau, chambre, toits, joyau).
const KASUGA = [
  { sh: 0.36, base: [0.08, 0.27, 0.22], pil: [0.25, 0.082], plat: [0.07, 0.14, 0.24], ch: [0.24, 0.17, 0.108], roofs: [[0.17, 0.4]], tiers: [], jw: 0.13 },
  { sh: 0.4, base: [0.085, 0.29, 0.24], pil: [0.28, 0.105], plat: [0.07, 0.16, 0.27], ch: [0.25, 0.185, 0.118], roofs: [[0.155, 0.44], [0.12, 0.29]], tiers: [[0.05, 0.095]], jw: 0.14 },
  { sh: 0.44, base: [0.09, 0.31, 0.26], pil: [0.3, 0.11], plat: [0.07, 0.17, 0.29], ch: [0.26, 0.195, 0.125], roofs: [[0.15, 0.48], [0.12, 0.35], [0.1, 0.24]], tiers: [[0.05, 0.105], [0.045, 0.08]], jw: 0.15 },
];

function kasugaLayout(lvl, st, def) {
  const L = KASUGA[lvl - 1];
  const P = [];
  const stone = st.stone;
  P.push({ k: 'shadow', rx: L.sh, ry: 0.11 });
  let y = 0;
  P.push({ k: 'slab', y0: y, h: L.base[0], hb: L.base[1], ht: L.base[2], col: stone, band: lvl === 3 });
  P.push({ k: 'moss', pts: [[-L.base[1] * 0.92, -0.012, 0.034], [L.base[1] * 0.95, -0.006, 0.026]] });
  y -= L.base[0];
  const kanji = lvl >= st.kanjiFrom;
  P.push({ k: 'pillar', y0: y, h: L.pil[0], hw: L.pil[1], col: stone, high: kanji });
  if (kanji) P.push({ k: 'kanji', x: 0, y: y - L.pil[0] * 0.42, size: L.pil[1] * 1.55, glyph: def.kanji, gold: lvl === 3, plaque: [L.pil[1] * 0.82, L.pil[0] * 0.33] });
  y -= L.pil[0];
  P.push({ k: 'slab', y0: y, h: L.plat[0], hb: L.plat[1], ht: L.plat[2], col: stone });
  y -= L.plat[0];
  const [chH, chW, wHW] = L.ch;
  const win = { shape: 'rect', x: -wHW, y: y - chH + 0.036, w: wHW * 2, h: chH - 0.066 };
  P.push({ k: 'chamber', y0: y, h: chH, hw: chW, col: stone, win, goldFrame: lvl === 3 });
  y -= chH;
  const r = addRoofs(P, y, L.roofs, L.tiers, { col: st.roof || def.color, tip: st.tip, lvl, stone });
  if (lvl === 3 && st.tip === 'curl') P.push({ k: 'bells', pts: r.eaves[0] });
  return finish(P, r.y, L.jw, lvl, stone, win, r.eaves, L.roofs[0][1], def);
}

// Eau : yukimi-dōrō (bassin, trois pieds, anneau, chambre à fenêtre ronde, ombrelle).
const YUKIMI = [
  { pond: [0.44, 0.13], leg: [0.27, 0.28], ring: [0.045, 0.2], ch: [0.21, 0.15, 0.075], roofs: [[0.15, 0.46]], tiers: [], jw: 0.1 },
  { pond: [0.47, 0.14], leg: [0.3, 0.3], ring: [0.045, 0.215], ch: [0.22, 0.165, 0.09], roofs: [[0.14, 0.49], [0.115, 0.31]], tiers: [[0.05, 0.1]], jw: 0.11 },
  { pond: [0.5, 0.15], leg: [0.32, 0.32], ring: [0.05, 0.23], ch: [0.23, 0.175, 0.096], roofs: [[0.135, 0.5], [0.115, 0.37], [0.095, 0.24]], tiers: [[0.05, 0.11], [0.045, 0.085]], jw: 0.12 },
];

function yukimiLayout(lvl, st, def) {
  const L = YUKIMI[lvl - 1];
  const P = [];
  const stone = st.stone;
  P.push({ k: 'pond', rx: L.pond[0], ry: L.pond[1] });
  P.push({ k: 'shadow', rx: 0.3, ry: 0.075 });
  P.push({ k: 'legs', top: -L.leg[0], spread: L.leg[1], w: 0.06, col: stone });
  let y = -L.leg[0] + 0.012;
  P.push({ k: 'ring', y0: y, h: L.ring[0], hw: L.ring[1], col: stone });
  y -= L.ring[0];
  const [chH, chW, rr] = L.ch;
  const win = { shape: 'circle', cx: 0, cy: y - chH / 2, r: rr };
  P.push({ k: 'chamber', y0: y, h: chH, hw: chW, col: stone, win, goldFrame: lvl === 3 });
  if (lvl >= st.kanjiFrom) P.push({ k: 'kanji', x: 0, y: y - chH / 2, size: rr * 1.6, glyph: def.kanji, col: PALETTE.indigo });
  y -= chH;
  const r = addRoofs(P, y, L.roofs, L.tiers, { col: st.roof, tip: st.tip, pattern: 'seigaiha', lvl, stone });
  return finish(P, r.y, L.jw, lvl, stone, win, r.eaves, L.roofs[0][1], def);
}

// Vent : lanterne de papier sur un fût de bambou, toits aux pointes relevées.
const WIND = [
  { base: [0.06, 0.17, 0.14], pole: [0.38, 0.052], plat: [0.035, 0.1, 0.15], ch: [0.22, 0.14], roofs: [[0.16, 0.34]], tiers: [], jw: 0.09 },
  { base: [0.065, 0.19, 0.155], pole: [0.42, 0.056], plat: [0.035, 0.11, 0.165], ch: [0.23, 0.15], roofs: [[0.145, 0.37], [0.115, 0.25]], tiers: [[0.04, 0.07]], jw: 0.1 },
  { base: [0.07, 0.2, 0.165], pole: [0.44, 0.06], plat: [0.035, 0.12, 0.175], ch: [0.24, 0.16], roofs: [[0.135, 0.41], [0.11, 0.3], [0.095, 0.2]], tiers: [[0.04, 0.075], [0.035, 0.055]], jw: 0.11 },
];

function windLayout(lvl, st, def) {
  const L = WIND[lvl - 1];
  const P = [];
  P.push({ k: 'shadow', rx: 0.3, ry: 0.09 });
  let y = 0;
  P.push({ k: 'slab', y0: y, h: L.base[0], hb: L.base[1], ht: L.base[2], col: st.stone, band: lvl === 3 });
  P.push({ k: 'moss', pts: [[-L.base[1] * 0.9, -0.01, 0.03], [L.base[1] * 0.85, -0.004, 0.024]] });
  y -= L.base[0];
  P.push({ k: 'bamboo', y0: y + 0.005, h: L.pole[0] + 0.01, hw: L.pole[1] });
  y -= L.pole[0];
  P.push({ k: 'slab', y0: y, h: L.plat[0], hb: L.plat[1], ht: L.plat[2], col: C.wood });
  y -= L.plat[0];
  const [chH, chW] = L.ch;
  const win = { shape: 'rect', x: -chW + 0.045, y: y - chH + 0.034, w: (chW - 0.045) * 2, h: chH - 0.068 };
  P.push({ k: 'chamber', y0: y, h: chH, hw: chW, col: C.wood, win, goldFrame: lvl === 3, paper: true });
  const wm = winMeta(win);
  if (lvl >= st.kanjiFrom) P.push({ k: 'kanji', x: 0, y: wm.cy, size: Math.min(wm.w, wm.h) * 0.9, glyph: def.kanji, col: INK });
  else P.push({ k: 'spiral', x: 0, y: wm.cy, r: Math.min(wm.w, wm.h) * 0.36 });
  y -= chH;
  const r = addRoofs(P, y, L.roofs, L.tiers, { col: st.roof, tip: st.tip, lvl, stone: C.wood });
  return finish(P, r.y, L.jw, lvl, st.roof, win, r.eaves, L.roofs[0][1] + 0.26, def);
}

// Terre : oki-dōrō massif posé au sol, fenêtre en fente, toit lourd moussu.
const EARTH = [
  { sh: 0.44, base: [0.15, 0.32, 0.29], ch: [0.28, 0.255, 0.135, 0.07], roofs: [[0.19, 0.4]], tiers: [], jw: 0.11 },
  { sh: 0.47, base: [0.16, 0.345, 0.315], ch: [0.29, 0.275, 0.145, 0.07], roofs: [[0.16, 0.44], [0.13, 0.29]], tiers: [[0.075, 0.155]], jw: 0.11 },
  { sh: 0.5, base: [0.165, 0.36, 0.33], ch: [0.3, 0.285, 0.155, 0.075], roofs: [[0.155, 0.47], [0.13, 0.34], [0.105, 0.22]], tiers: [[0.075, 0.175], [0.055, 0.115]], jw: 0.13 },
];

function earthLayout(lvl, st, def) {
  const L = EARTH[lvl - 1];
  const P = [];
  P.push({ k: 'shadow', rx: L.sh, ry: 0.12 });
  let y = 0;
  P.push({ k: 'slab', y0: y, h: L.base[0], hb: L.base[1], ht: L.base[2], col: st.stone, rough: true, band: lvl === 3 });
  const b = L.base[1];
  P.push({ k: 'moss', pts: [[-b * 0.95, -0.015, 0.045], [-b * 0.6, 0.0, 0.03], [b * 0.92, -0.01, 0.04], [b * 0.55, 0.004, 0.026]] });
  y -= L.base[0];
  const [chH, chW, sHW, sH] = L.ch;
  const win = { shape: 'rect', x: -sHW, y: y - chH + 0.045, w: sHW * 2, h: sH };
  P.push({ k: 'chamber', y0: y, h: chH, hw: chW, col: st.stone, win, goldFrame: lvl === 3, rough: true });
  const ey = (win.y + sH + y) / 2 + 0.005;
  if (lvl >= st.kanjiFrom) P.push({ k: 'kanji', x: 0, y: ey, size: Math.min(chH * 0.56, 0.18), glyph: def.kanji, gold: lvl === 3, engrave: true, col: mix(st.stone, INK, 0.88) });
  else P.push({ k: 'mon', x: 0, y: ey, r: 0.05 });
  P.push({ k: 'moss', pts: [[-chW * 0.9, y - chH + 0.02, 0.03], [chW * 0.8, y - chH + 0.03, 0.025]] });
  y -= chH;
  const r = addRoofs(P, y, L.roofs, L.tiers, { col: st.roof, tip: st.tip, pattern: 'moss', lvl, stone: st.stone });
  return finish(P, r.y, L.jw, lvl, st.stone, win, r.eaves, L.roofs[0][1], def);
}

const layouts = new Map();
function layoutOf(def, st, lvl) {
  const key = defId(def) * 4 + lvl;
  let l = layouts.get(key);
  if (!l) {
    l = st.layout(lvl, st, def);
    l.box = boxOf(l);
    layouts.set(key, l);
  }
  return l;
}

// Cadre serré du corps statique (en cases) : le cache ne copie aucun pixel vide inutile.
function boxOf(l) {
  let hw = 0.2;
  let bottom = 0.1;
  let top = -l.meta.top;
  for (const p of l.parts) {
    if (p.k === 'glow') {
      hw = Math.max(hw, p.rx);
      bottom = Math.max(bottom, p.y + p.ry);
      top = Math.max(top, -(p.y - p.ry));
    } else if (p.k === 'roof') hw = Math.max(hw, p.hw + (p.curl ? 0.06 : 0.02));
    else if (p.k === 'slab') hw = Math.max(hw, p.hb, p.ht);
    else if (p.k === 'shadow') {
      hw = Math.max(hw, p.rx + 0.05);
      bottom = Math.max(bottom, p.ry + 0.02);
    } else if (p.k === 'pond') {
      hw = Math.max(hw, p.rx + 0.02);
      bottom = Math.max(bottom, p.ry + 0.03);
    } else if (p.k === 'legs') hw = Math.max(hw, p.spread + p.w);
    else if (p.k === 'moss') for (const [x, , r] of p.pts) hw = Math.max(hw, Math.abs(x) + r * 1.4);
  }
  const m = LW * 1.5;
  return { left: hw + m, right: hw + m + 0.05, top: top + m, bottom: bottom + m };
}

// ---------------------------------------------------------------------------
// Dessin des pièces (sur le canvas de cache, repère en cases)
// ---------------------------------------------------------------------------

// Polygone au contour légèrement tremblé (milieux des arêtes décalés).
function wobPath(g, pts, rnd, amp = 0.004) {
  g.beginPath();
  const n = pts.length;
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    g.quadraticCurveTo((a[0] + b[0]) / 2 + (rnd() - 0.5) * amp * 2, (a[1] + b[1]) / 2 + (rnd() - 0.5) * amp * 2, b[0], b[1]);
  }
  g.closePath();
}

// Lavis sur la forme courante : flanc gauche éclairé, arête, flanc droit dans l'ombre,
// et grain de la pierre. Le tracé courant est conservé.
function shade(b, x0, x1, yTop, yBot, k = 1, grain = true) {
  const g = b.g;
  g.save();
  g.clip();
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  gr.addColorStop(0, withAlpha(PALETTE.cream, 0.3 * k));
  gr.addColorStop(0.3, withAlpha(PALETTE.cream, 0));
  gr.addColorStop(0.6, withAlpha(INK, 0.03 * k));
  gr.addColorStop(0.63, withAlpha(INK, 0.2 * k));
  gr.addColorStop(1, withAlpha(INK, 0.36 * k));
  g.fillStyle = gr;
  g.fillRect(x0, yTop, x1 - x0, yBot - yTop);
  if (grain) {
    g.fillStyle = withAlpha(INK, 0.2);
    const n = 3 + Math.round((x1 - x0) * (yBot - yTop) * 160);
    for (let i = 0; i < n; i++) {
      const s = 0.008 + b.rnd() * 0.01;
      g.fillRect(x0 + b.rnd() * (x1 - x0), yTop + b.rnd() * (yBot - yTop), s, s * 0.8);
    }
  }
  g.restore();
}

function inkStroke(b, w = 1) {
  b.g.lineWidth = LW * w;
  b.g.strokeStyle = INK;
  b.g.stroke();
}

function slab(b, p) {
  const { g, rnd } = b;
  const { y0, h, hb, ht } = p;
  const m = Math.max(hb, ht);
  wobPath(g, [[-hb, y0], [hb, y0], [ht, y0 - h], [-ht, y0 - h]], rnd);
  g.fillStyle = p.col;
  g.fill();
  shade(b, -m, m, y0 - h, y0);
  inkStroke(b);
  // arête de la facette
  g.beginPath();
  g.moveTo(hb * 0.26, y0 - 0.006);
  g.lineTo(ht * 0.26, y0 - h + 0.006);
  g.lineWidth = LW * 0.5;
  g.strokeStyle = withAlpha(INK, 0.4);
  g.stroke();
  if (p.rough) {
    // fissures de la pierre brute
    g.strokeStyle = withAlpha(INK, 0.55);
    g.lineWidth = LW * 0.45;
    for (let i = 0; i < 3; i++) {
      const x = (rnd() - 0.5) * m * 1.4;
      const yy = y0 - h * (0.2 + rnd() * 0.5);
      g.beginPath();
      g.moveTo(x, yy);
      g.lineTo(x + (rnd() - 0.5) * 0.05, yy + h * 0.2);
      g.lineTo(x + (rnd() - 0.5) * 0.06, yy + h * 0.38);
      g.stroke();
    }
  }
  if (p.band) {
    // liseré d'or (N3)
    g.strokeStyle = PALETTE.gold;
    g.lineWidth = LW * 0.8;
    g.beginPath();
    g.moveTo(-ht * 0.98 - (hb - ht) * 0.2, y0 - h * 0.78);
    g.lineTo(ht * 0.98 + (hb - ht) * 0.2, y0 - h * 0.78);
    g.stroke();
  }
  // trait de pinceau appuyé au contact du sol / de la pièce inférieure
  brushStroke(g, [[-hb * 0.95, y0], [0, y0 + 0.004], [hb * 0.95, y0]], LW * 1.4, INK, { taperIn: 0.4, taperOut: 0.4 });
}

function pillar(b, p) {
  const { g } = b;
  slab(b, { y0: p.y0, h: p.h, hb: p.hw * 1.1, ht: p.hw * 0.9, col: p.col });
  // nœud du fût (fushi)
  const ym = p.y0 - p.h * (p.high ? 0.86 : 0.5);
  g.beginPath();
  g.roundRect(-p.hw * 1.22, ym - 0.014, p.hw * 2.44, 0.028, 0.012);
  g.fillStyle = mix(p.col, INK, 0.12);
  g.fill();
  inkStroke(b, 0.75);
}

function bamboo(b, p) {
  const { g } = b;
  const { y0, h, hw } = p;
  g.beginPath();
  g.rect(-hw, y0 - h, hw * 2, h);
  g.fillStyle = C.bamboo;
  g.fill();
  shade(b, -hw, hw, y0 - h, y0, 1.2, false);
  inkStroke(b, 0.9);
  // reflet vertical et nœuds
  brushStroke(g, [[-hw * 0.45, y0 - h * 0.04], [-hw * 0.45, y0 - h * 0.5], [-hw * 0.42, y0 - h * 0.96]], hw * 0.4, PALETTE.cream, { alpha: 0.45, taperIn: 0.1, taperOut: 0.1 });
  for (const k of [0.3, 0.66]) {
    const yy = y0 - h * k;
    g.beginPath();
    g.moveTo(-hw * 1.2, yy);
    g.quadraticCurveTo(0, yy + 0.012, hw * 1.2, yy);
    inkStroke(b, 0.9);
    g.beginPath();
    g.moveTo(-hw * 0.9, yy - 0.012);
    g.lineTo(hw * 0.9, yy - 0.012);
    g.strokeStyle = withAlpha(PALETTE.cream, 0.5);
    g.lineWidth = LW * 0.5;
    g.stroke();
  }
}

function legs(b, p) {
  const { g } = b;
  const { top, spread, w, col } = p;
  // pied arrière, plus sombre
  wobPath(g, [[-w * 0.42, top], [w * 0.42, top], [w * 0.36, -0.03], [-w * 0.36, -0.03]], b.rnd, 0.003);
  g.fillStyle = mix(col, INK, 0.35);
  g.fill();
  inkStroke(b, 0.8);
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(s * 0.05, top);
    g.lineTo(s * (0.05 + w * 1.15), top - 0.008);
    g.quadraticCurveTo(s * (spread + w * 0.55), top + 0.01, s * (spread + w * 0.5), 0);
    g.lineTo(s * (spread - w * 0.5), 0);
    g.quadraticCurveTo(s * (spread - w * 0.5), top + w * 1.7, s * 0.05, top);
    g.closePath();
    g.fillStyle = col;
    g.fill();
    shade(b, s < 0 ? -spread - w : 0, s < 0 ? 0 : spread + w, top - 0.01, 0, 0.9);
    inkStroke(b);
    // semelle
    g.beginPath();
    g.roundRect(s * spread - w * 0.85, -0.028, w * 1.7, 0.032, 0.01);
    g.fillStyle = mix(col, INK, 0.15);
    g.fill();
    inkStroke(b, 0.8);
  }
}

function ring(b, p) {
  const { g } = b;
  g.beginPath();
  g.roundRect(-p.hw, p.y0 - p.h, p.hw * 2, p.h, p.h * 0.5);
  g.fillStyle = p.col;
  g.fill();
  shade(b, -p.hw, p.hw, p.y0 - p.h, p.y0);
  inkStroke(b);
}

function winPath(g, w, inflate = 0) {
  g.beginPath();
  if (w.shape === 'circle') g.arc(w.cx, w.cy, w.r + inflate, 0, TAU);
  else g.rect(w.x - inflate, w.y - inflate, w.w + inflate * 2, w.h + inflate * 2);
}

function chamber(b, p) {
  const { g } = b;
  slab(b, { y0: p.y0, h: p.h, hb: p.hw, ht: p.hw * 0.97, col: p.col, rough: p.rough });
  const w = p.win;
  // la fenêtre est découpée : la lumière vivante est dessinée dessous
  g.save();
  g.globalCompositeOperation = 'destination-out';
  winPath(g, w);
  g.fill();
  g.restore();
  // ombre intérieure sous le linteau (laisse passer la lumière)
  g.save();
  winPath(g, w);
  g.clip();
  g.fillStyle = withAlpha(INK, p.paper ? 0.18 : 0.38);
  g.fillRect(w.x - 0.01, w.y - 0.01, w.w + 0.02, Math.min(0.03, w.h * 0.3) + 0.01);
  g.restore();
  if (p.paper) {
    // croisillons de bois du papier (kumiko), discrets
    g.strokeStyle = withAlpha(C.wood, 0.55);
    g.lineWidth = LW * 0.4;
    g.beginPath();
    g.moveTo(w.x, w.y + w.h * 0.18);
    g.lineTo(w.x + w.w, w.y + w.h * 0.18);
    g.moveTo(w.x, w.y + w.h * 0.86);
    g.lineTo(w.x + w.w, w.y + w.h * 0.86);
    g.stroke();
  }
  winPath(g, w);
  inkStroke(b, p.paper ? 0.55 : 0.85);
  if (p.goldFrame) {
    winPath(g, w, 0.016);
    g.strokeStyle = PALETTE.gold;
    g.lineWidth = LW * 0.7;
    g.stroke();
  }
}

function roofPath(g, y0, h, hw, tip) {
  const lift = liftOf(tip, h);
  const sag = h * 0.07;
  g.beginPath();
  g.moveTo(-hw, y0 - lift);
  g.quadraticCurveTo(-hw * 0.5, y0 + sag, 0, y0 + sag);
  g.quadraticCurveTo(hw * 0.5, y0 + sag, hw, y0 - lift);
  if (tip === 'heavy') {
    g.lineTo(hw * 0.88, y0 - lift - h * 0.2);
    g.lineTo(hw * 0.15, y0 - h);
    g.lineTo(-hw * 0.15, y0 - h);
    g.lineTo(-hw * 0.88, y0 - lift - h * 0.2);
  } else if (tip === 'umbrella') {
    g.quadraticCurveTo(hw * 0.78, y0 - h * 0.6, hw * 0.12, y0 - h * 0.97);
    g.quadraticCurveTo(0, y0 - h * 1.03, -hw * 0.12, y0 - h * 0.97);
    g.quadraticCurveTo(-hw * 0.78, y0 - h * 0.6, -hw, y0 - lift);
  } else {
    const cx = tip === 'wing' ? 0.42 : 0.34;
    g.quadraticCurveTo(hw * cx, y0 - h * 0.3, hw * 0.1, y0 - h * 0.97);
    g.lineTo(0, y0 - h);
    g.lineTo(-hw * 0.1, y0 - h * 0.97);
    g.quadraticCurveTo(-hw * cx, y0 - h * 0.3, -hw, y0 - lift);
  }
  g.closePath();
}

// Chant de l'avant-toit : bande sombre le long du bord inférieur.
function bandPath(g, y0, h, hw, tip, upperOnly = false) {
  const lift = liftOf(tip, h);
  const sag = h * 0.07;
  const bh = h * 0.17;
  g.beginPath();
  if (tip === 'heavy') {
    if (upperOnly) {
      g.moveTo(-hw * 0.88, y0 - lift - h * 0.2);
      g.lineTo(hw * 0.88, y0 - lift - h * 0.2);
      return;
    }
    g.moveTo(-hw, y0 - lift);
    g.quadraticCurveTo(-hw * 0.5, y0 + sag, 0, y0 + sag);
    g.quadraticCurveTo(hw * 0.5, y0 + sag, hw, y0 - lift);
    g.lineTo(hw * 0.88, y0 - lift - h * 0.2);
    g.lineTo(-hw * 0.88, y0 - lift - h * 0.2);
    g.closePath();
    return;
  }
  if (upperOnly) {
    g.moveTo(-hw * 0.97, y0 - lift);
    g.quadraticCurveTo(-hw * 0.5, y0 + sag - bh, 0, y0 + sag - bh);
    g.quadraticCurveTo(hw * 0.5, y0 + sag - bh, hw * 0.97, y0 - lift);
    return;
  }
  g.moveTo(-hw, y0 - lift);
  g.quadraticCurveTo(-hw * 0.5, y0 + sag, 0, y0 + sag);
  g.quadraticCurveTo(hw * 0.5, y0 + sag, hw, y0 - lift);
  g.quadraticCurveTo(hw * 0.5, y0 + sag - bh, 0, y0 + sag - bh);
  g.quadraticCurveTo(-hw * 0.5, y0 + sag - bh, -hw, y0 - lift);
  g.closePath();
}

function roof(b, p) {
  const { g } = b;
  const { y0, h, hw, tip } = p;
  const lift = liftOf(tip, h);
  const sag = h * 0.07;
  roofPath(g, y0, h, hw, tip);
  g.fillStyle = p.col;
  g.fill();
  if (p.pattern) {
    g.save();
    g.clip();
    if (p.pattern === 'seigaiha') seigaiha(b, y0, h, hw, p.col);
    else roofMoss(b, y0, h, hw);
    g.restore();
  }
  shade(b, -hw, hw, y0 - h, y0 + sag, 0.9, false);
  // arêtes des pans
  g.beginPath();
  if (tip === 'umbrella') {
    for (const k of [-0.62, -0.24, 0.24, 0.62]) {
      g.moveTo(k * hw * 0.18, y0 - h * 0.95);
      g.quadraticCurveTo(k * hw * 0.8, y0 - h * 0.5, k * hw, y0 + sag - h * 0.24);
    }
  } else {
    const t = tip === 'heavy' ? 0.15 : 0.08;
    g.moveTo(-hw * t, y0 - h * 0.97);
    g.lineTo(-hw * 0.4, y0 + sag - h * 0.22);
    g.moveTo(hw * t, y0 - h * 0.97);
    g.lineTo(hw * 0.4, y0 + sag - h * 0.22);
  }
  g.strokeStyle = withAlpha(INK, 0.42);
  g.lineWidth = LW * 0.55;
  g.stroke();
  // chant sombre + liseré d'or
  bandPath(g, y0, h, hw, tip);
  g.fillStyle = mix(p.col, INK, 0.3);
  g.fill();
  if (p.trim) {
    bandPath(g, y0, h, hw, tip, true);
    g.strokeStyle = PALETTE.gold;
    g.lineWidth = LW * 0.85;
    g.stroke();
  }
  roofPath(g, y0, h, hw, tip);
  inkStroke(b, hw < 0.3 ? 0.8 : 1);
  // trait appuyé sous l'avant-toit, reflet clair sur le pan gauche
  brushStroke(g, quadPts(-hw, y0 - lift, 0, y0 + sag * 2.1, hw, y0 - lift, 10), LW * (hw < 0.3 ? 1.1 : 1.5), p.trim2 ? PALETTE.gold : INK, { taperIn: 0.3, taperOut: 0.3 });
  if (tip !== 'heavy') brushStroke(g, quadPts(-hw * 0.8, y0 - lift - h * 0.08, -hw * 0.3, y0 - h * 0.42, -hw * 0.09, y0 - h * 0.9, 8), LW * 0.9, PALETTE.cream, { alpha: 0.5 });
  else brushStroke(g, [[-hw * 0.84, y0 - lift - h * 0.3], [-hw * 0.18, y0 - h * 0.92]], LW * 0.9, PALETTE.cream, { alpha: 0.4 });
  if (p.curl) {
    const r = Math.max(0.03, h * 0.24);
    curl(g, -hw, y0 - lift, r, 1, p.curl);
    curl(g, hw, y0 - lift, r, -1, p.curl);
  }
}

// Volute (warabite) qui s'enroule vers l'intérieur à la pointe de l'avant-toit.
function curl(g, x, y, r, dir, col) {
  const pts = [];
  const cx = x + dir * r;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const a = dir > 0 ? Math.PI + t * Math.PI * 1.55 : -t * Math.PI * 1.55;
    const rr = r * (1 - t * 0.6);
    pts.push([cx + Math.cos(a) * rr, y - r * 0.15 + Math.sin(a) * rr]);
  }
  brushStroke(g, pts, LW * 1.25, col, { taperIn: 0.05, taperOut: 0.5 });
}

// Écailles de vagues seigaiha (rangées de demi-disques concentriques).
function seigaiha(b, y0, h, hw, col) {
  const { g } = b;
  const r = Math.max(0.05, h * 0.38);
  const lite = withAlpha('#a9c0e6', 0.7);
  const alt = mix(col, PALETTE.indigoLight, 0.4);
  let row = 0;
  for (let yy = y0 - h - r * 0.1; yy < y0 + r; yy += r * 0.55, row++) {
    for (let xx = -hw - r + (row % 2) * r; xx < hw + r; xx += r * 2) {
      g.beginPath();
      g.arc(xx, yy, r, Math.PI, 0);
      g.closePath();
      g.fillStyle = (row + Math.round(xx / r)) % 3 ? col : alt;
      g.fill();
      g.strokeStyle = lite;
      g.lineWidth = LW * 0.42;
      g.beginPath();
      for (const k of [0.86, 0.5]) {
        g.moveTo(xx - r * k, yy);
        g.arc(xx, yy, r * k, Math.PI, 0);
      }
      g.stroke();
    }
  }
}

function roofMoss(b, y0, h, hw) {
  const { g, rnd } = b;
  for (let i = 0; i < 14; i++) {
    const x = (rnd() * 2 - 1) * hw * 0.8;
    const yy = y0 - h + h * (0.05 + rnd() * 0.3 + (Math.abs(x) / hw) * 0.4);
    const r = 0.026 + rnd() * 0.036;
    g.fillStyle = rnd() < 0.35 ? PALETTE.mossDark : rnd() < 0.5 ? PALETTE.moss : C.mossLight;
    g.beginPath();
    g.arc(x, yy, r, 0, TAU);
    g.fill();
  }
}

function moss(b, p) {
  const { g, rnd } = b;
  for (const [x, y, r] of p.pts) {
    g.fillStyle = PALETTE.mossDark;
    g.beginPath();
    g.arc(x + r * 0.2, y, r, Math.PI, 0);
    g.fill();
    g.fillStyle = PALETTE.moss;
    g.beginPath();
    g.arc(x - r * 0.35, y - r * 0.05, r * 0.75, 0, TAU);
    g.arc(x + r * 0.5, y - r * 0.1, r * 0.6, 0, TAU);
    g.fill();
    g.fillStyle = C.mossLight;
    g.beginPath();
    g.arc(x - r * 0.45, y - r * 0.35, r * 0.3, 0, TAU);
    g.fill();
    // brins d'herbe
    for (let i = 0; i < 2; i++) {
      const bx = x + (rnd() - 0.5) * r * 2;
      brushStroke(g, [[bx, y + r * 0.2], [bx + (rnd() - 0.5) * r, y - r * 0.8], [bx + (rnd() - 0.3) * r * 1.4, y - r * 1.5]], LW * 0.8, PALETTE.mossDark, { taperIn: 0.1, taperOut: 0.7 });
    }
  }
}

function jewel(b, p) {
  const { g } = b;
  const { y0, h, col } = p;
  const w = h * 0.44;
  // collerette (ukebana)
  g.beginPath();
  g.ellipse(0, y0 - h * 0.1, w * 0.95, h * 0.1, 0, 0, TAU);
  g.fillStyle = col;
  g.fill();
  inkStroke(b, 0.55);
  // bulbe, à pointe de flamme au N3
  const top = y0 - h * (p.flame ? 1.12 : 1);
  g.beginPath();
  g.moveTo(0, top);
  g.bezierCurveTo(w * 0.28, y0 - h * 0.8, w * 1.05, y0 - h * 0.58, w * 0.72, y0 - h * 0.27);
  g.quadraticCurveTo(0, y0 - h * 0.1, -w * 0.72, y0 - h * 0.27);
  g.bezierCurveTo(-w * 1.05, y0 - h * 0.58, -w * 0.28, y0 - h * 0.8, 0, top);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  shade(b, -w, w, top, y0, 0.6, false);
  inkStroke(b, 0.6);
  g.fillStyle = withAlpha(PALETTE.cream, 0.7);
  g.beginPath();
  g.ellipse(-w * 0.32, y0 - h * 0.5, w * 0.16, w * 0.26, -0.4, 0, TAU);
  g.fill();
}

function bells(b, p) {
  const { g } = b;
  for (const [x, y] of p.pts) {
    const bx = x * 0.9;
    g.beginPath();
    g.moveTo(bx, y + 0.01);
    g.lineTo(bx, y + 0.05);
    g.strokeStyle = INK;
    g.lineWidth = LW * 0.5;
    g.stroke();
    g.beginPath();
    g.moveTo(bx - 0.024, y + 0.1);
    g.quadraticCurveTo(bx - 0.022, y + 0.045, bx, y + 0.045);
    g.quadraticCurveTo(bx + 0.022, y + 0.045, bx + 0.024, y + 0.1);
    g.closePath();
    g.fillStyle = PALETTE.gold;
    g.fill();
    inkStroke(b, 0.6);
  }
}

// Kanji gravé ou peint, rendu en pixels physiques (net quelle que soit l'échelle).
function kanji(b, p) {
  const { g, S } = b;
  if (p.plaque) {
    const [pw, ph] = p.plaque;
    g.beginPath();
    g.rect(p.x - pw, p.y - ph, pw * 2, ph * 2);
    g.fillStyle = withAlpha(INK, p.gold ? 0.55 : 0.4);
    g.fill();
    g.strokeStyle = withAlpha(PALETTE.cream, 0.35);
    g.lineWidth = LW * 0.5;
    g.beginPath();
    g.moveTo(p.x - pw, p.y + ph);
    g.lineTo(p.x + pw, p.y + ph);
    g.stroke();
  }
  g.save();
  g.scale(1 / S, 1 / S);
  const px = Math.max(5, p.size * S);
  g.font = `800 ${px.toFixed(1)}px "Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const x = p.x * S;
  const y = p.y * S + px * 0.05;
  if (p.gold) {
    g.lineJoin = 'round';
    g.lineWidth = px * 0.16;
    g.strokeStyle = INK;
    g.strokeText(p.glyph, x, y);
    g.fillStyle = PALETTE.goldLight;
  } else if (p.plaque) {
    g.fillStyle = PALETTE.cream;
  } else if (p.engrave) {
    // gravure : lèvre claire décalée puis creux sombre
    g.fillStyle = withAlpha(PALETTE.cream, 0.55);
    g.fillText(p.glyph, x + px * 0.06, y + px * 0.06);
    g.fillStyle = p.col;
  } else {
    g.fillStyle = p.col || INK;
  }
  g.fillText(p.glyph, x, y);
  g.restore();
}

function spiral(b, p) {
  const pts = [];
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    const a = t * Math.PI * 3.3;
    const r = p.r * (1 - t * 0.85);
    pts.push([p.x + Math.cos(a) * r, p.y + Math.sin(a) * r]);
  }
  brushStroke(b.g, pts, LW * 1.3, INK, { taperIn: 0.08, taperOut: 0.5 });
}

function mon(b, p) {
  const { g } = b;
  for (const [dx, col] of [[0.007, withAlpha(PALETTE.cream, 0.5)], [0, withAlpha(INK, 0.6)]]) {
    g.strokeStyle = col;
    g.lineWidth = LW * 0.8;
    g.beginPath();
    g.arc(p.x + dx, p.y + dx, p.r, 0, TAU);
    g.stroke();
    g.fillStyle = col;
    g.beginPath();
    g.arc(p.x + dx, p.y + dx, p.r * 0.32, 0, TAU);
    g.fill();
  }
}

function glow(b, p) {
  const { g } = b;
  g.save();
  g.translate(0, p.y);
  g.scale(1, p.ry / p.rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, p.rx);
  gr.addColorStop(0, withAlpha(p.col, p.a));
  gr.addColorStop(0.5, withAlpha(p.col, p.a * 0.45));
  gr.addColorStop(1, withAlpha(p.col, 0));
  g.fillStyle = gr;
  g.fillRect(-p.rx, -p.rx, p.rx * 2, p.rx * 2);
  g.restore();
}

function shadow(b, p) {
  const { g } = b;
  g.save();
  g.translate(0.04, 0.015);
  g.scale(1, p.ry / p.rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, p.rx);
  gr.addColorStop(0, withAlpha(INK, 0.4));
  gr.addColorStop(0.55, withAlpha(INK, 0.24));
  gr.addColorStop(1, withAlpha(INK, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, p.rx, 0, TAU);
  g.fill();
  g.restore();
}

// Bassin du yukimi-dōrō : aplat indigo, cœur plus profond, rive à l'encre.
function pond(b, p) {
  const { g } = b;
  const { rx, ry } = p;
  g.beginPath();
  g.ellipse(0, 0.01, rx, ry, 0, 0, TAU);
  g.fillStyle = withAlpha(PALETTE.indigoLight, 0.62);
  g.fill();
  g.beginPath();
  g.ellipse(0.02, 0.0, rx * 0.68, ry * 0.58, 0, 0, TAU);
  g.fillStyle = withAlpha(PALETTE.indigo, 0.4);
  g.fill();
  brushStroke(g, quadPts(-rx, 0.01, 0, ry * 2.05, rx, 0.01, 14), LW * 1.3, INK, { alpha: 0.75, taperIn: 0.2, taperOut: 0.2 });
  brushStroke(g, quadPts(-rx * 0.9, -ry * 0.25, -rx * 0.2, -ry * 1.15, rx * 0.5, -ry * 0.8, 10), LW * 0.7, INK, { alpha: 0.4 });
  g.strokeStyle = withAlpha(PALETTE.cream, 0.55);
  g.lineWidth = LW * 0.55;
  g.beginPath();
  g.ellipse(-rx * 0.35, ry * 0.25, rx * 0.22, ry * 0.18, 0, Math.PI * 0.1, Math.PI * 0.9);
  g.stroke();
}

const PARTS = { glow, shadow, pond, slab, pillar, bamboo, legs, ring, chamber, roof, jewel, bells, kanji, spiral, mon, moss };

// ---------------------------------------------------------------------------
// Caches : corps statiques, auréole, volutes
// ---------------------------------------------------------------------------

const bodies = new Map();
const sprites = new Map();
if (typeof document !== 'undefined' && document.fonts?.addEventListener) {
  // les kanji mis en cache avant le chargement de la police sont redessinés
  document.fonts.addEventListener('loadingdone', () => bodies.clear());
}

function getBody(def, st, lvl, ts, sc, echo) {
  const key = `${defId(def)}|${lvl}|${ts}|${sc}|${echo ? 1 : 0}`;
  let body = bodies.get(key);
  if (body) return body;
  const lay = layoutOf(def, st, lvl);
  const box = lay.box;
  const S = ts * sc;
  const W = Math.ceil((box.left + box.right) * S);
  const H = Math.ceil((box.top + box.bottom) * S);
  const AX = Math.round(box.left * S);
  const AY = Math.round(box.top * S);
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.setTransform(S, 0, 0, S, AX, AY);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const b = { g, S, rnd: seeded(lvl * 131 + (def.kanji || '?').charCodeAt(0)) };
  for (const p of lay.parts) {
    if (echo && (p.k === 'shadow' || p.k === 'pond' || p.k === 'glow')) continue;
    PARTS[p.k](b, p);
  }
  if (echo) {
    // écho fantôme : tout le corps est teinté d'indigo
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = withAlpha('#36548f', 0.6);
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
  }
  body = { canvas: c, ax: AX / sc, ay: AY / sc, w: W / sc, h: H / sc, meta: lay.meta };
  if (bodies.size > 96) bodies.clear();
  bodies.set(key, body);
  return body;
}

function sprite(name, ts, sc, size, draw) {
  const key = `${name}|${ts}|${sc}`;
  let s = sprites.get(key);
  if (s) return s;
  const S = ts * sc;
  const px = Math.ceil(size * S * 0.5) * 2 + 2; // pair : centre sur un pixel entier
  const c = makeCanvas(px, px);
  const g = c.getContext('2d');
  g.setTransform(S, 0, 0, S, px / 2, px / 2);
  g.lineCap = 'round';
  draw(g);
  s = { canvas: c, size: px / sc };
  if (sprites.size > 64) sprites.clear();
  sprites.set(key, s);
  return s;
}

// Auréole dorée (N3) : lueur, anneau double et rayons alternés. Le motif se répète
// tous les 1/12 de tour : HALO_FRAMES images pré-tournées évitent un drawImage
// pivoté (coûteux) à chaque frame.
const HALO_FRAMES = 10;
function haloSprite(ts, sc, frame) {
  return sprite('halo' + frame, ts, sc, 1.1, (g) => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 0.55);
    gr.addColorStop(0, withAlpha(PALETTE.goldLight, 0.26));
    gr.addColorStop(0.5, withAlpha(PALETTE.goldLight, 0.12));
    gr.addColorStop(1, withAlpha(PALETTE.goldLight, 0));
    g.fillStyle = gr;
    g.fillRect(-0.55, -0.55, 1.1, 1.1);
    g.rotate((frame / HALO_FRAMES) * (TAU / 12));
    g.globalAlpha = 0.75;
    for (const [col, k] of [[PALETTE.gold, 1.6], [PALETTE.goldLight, 0.8]]) {
      g.strokeStyle = col;
      g.lineWidth = LW * 0.6 * k;
      g.beginPath();
      g.arc(0, 0, 0.33, 0, TAU);
      g.stroke();
      g.lineWidth = LW * 0.35 * k;
      g.beginPath();
      g.arc(0, 0, 0.28, 0, TAU);
      g.stroke();
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        const r2 = i % 2 ? 0.41 : 0.45;
        g.lineWidth = LW * (i % 2 ? 0.35 : 0.55) * k;
        g.beginPath();
        g.moveTo(Math.cos(a) * 0.37, Math.sin(a) * 0.37);
        g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        g.stroke();
      }
    }
  });
}

// Volute de vent : spirale au pinceau.
function swirlSprite(ts, sc) {
  return sprite('swirl', ts, sc, 0.3, (g) => {
    const pts = [];
    for (let i = 0; i <= 22; i++) {
      const t = i / 22;
      const a = t * Math.PI * 2.6;
      const r = 0.12 * (1 - t * 0.8);
      pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.75]);
    }
    pts.unshift([0.12 + 0.03, 0.04]);
    brushStroke(g, pts, LW * 1.3, PALETTE.cream, { taperIn: 0.3, taperOut: 0.4 });
  });
}

// ---------------------------------------------------------------------------
// Parties vivantes (repère local en px : origine au pied, y vers le bas)
// ---------------------------------------------------------------------------

function flame(ctx, cx, by, w, h, sway, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx + sway, by - h);
  ctx.bezierCurveTo(cx + w * 0.18 + sway * 0.5, by - h * 0.6, cx + w * 0.56, by - h * 0.38, cx + w * 0.44, by - h * 0.13);
  ctx.quadraticCurveTo(cx, by + h * 0.1, cx - w * 0.44, by - h * 0.13);
  ctx.bezierCurveTo(cx - w * 0.56, by - h * 0.38, cx - w * 0.18 + sway * 0.5, by - h * 0.6, cx + sway, by - h);
  ctx.fill();
}

function lightFire(ctx, m, ts, def, time, ph, f, dim, rec) {
  const w = m.win;
  const x0 = w.x * ts;
  const y0 = w.y * ts;
  const ww = w.w * ts;
  const hh = w.h * ts;
  ctx.fillStyle = dim < 1 ? '#3a1a12' : '#6a2414';
  ctx.fillRect(x0 - 1, y0 - 1, ww + 2, hh + 2);
  wash(ctx, 0, y0 + hh * 0.72, ww * 0.95, def.glow, 0.95 * dim);
  const fh = hh * (0.8 + 0.1 * Math.sin(time * 11 + ph) + 0.07 * Math.sin(time * 23 + ph * 2)) * (1 + 0.35 * rec) * (0.55 + 0.45 * dim);
  const fw = ww * 0.66;
  const sway = (Math.sin(time * 7 + ph) * 0.09 + Math.sin(time * 17 + ph) * 0.04) * ww;
  const by = y0 + hh * 0.98;
  flame(ctx, 0, by, fw, fh, sway, '#e2562a');
  flame(ctx, 0, by, fw * 0.66, fh * 0.72, sway * 0.8, '#ffb347');
  flame(ctx, 0, by, fw * 0.34, fh * 0.42, sway * 0.5, '#fff3cf');
}

function lightWater(ctx, m, ts, def, time, ph, f, dim) {
  const w = m.win;
  const cx = w.cx * ts;
  const cy = w.cy * ts;
  const r = w.r * ts;
  ctx.fillStyle = dim < 1 ? '#6d86a0' : '#bfe2ff';
  ctx.fillRect(cx - r - 1, cy - r - 1, r * 2 + 2, r * 2 + 2);
  wash(ctx, cx, cy, r * 1.2, '#ffffff', 0.5 * f * dim);
  // reflets ondulants
  ctx.strokeStyle = withAlpha(PALETTE.indigoLight, 0.55 * dim);
  ctx.lineWidth = Math.max(0.8, ts * 0.016);
  ctx.beginPath();
  for (let k = 0; k < 2; k++) {
    const yy = cy + r * (0.25 + k * 0.38);
    const half = Math.sqrt(Math.max(0, r * r - (yy - cy) * (yy - cy))) * 0.85;
    for (let i = 0; i <= 6; i++) {
      const xx = cx - half + (i / 6) * half * 2;
      const py = yy + Math.sin(i * 1.4 + time * 3.2 + k * 2 + ph) * r * 0.1;
      if (i === 0) ctx.moveTo(xx, py);
      else ctx.lineTo(xx, py);
    }
  }
  ctx.stroke();
}

function lightWind(ctx, m, ts, def, time, ph, f, dim) {
  const w = m.win;
  const x0 = w.x * ts;
  const y0 = w.y * ts;
  const ww = w.w * ts;
  const hh = w.h * ts;
  ctx.fillStyle = dim < 1 ? '#a8a58e' : '#eee6c4';
  ctx.fillRect(x0 - 1, y0 - 1, ww + 2, hh + 2);
  wash(ctx, w.cx * ts, w.cy * ts, Math.max(ww, hh) * 0.75, def.glow, 0.85 * f * dim);
  // lanterne tournante (sōmatō) : ombres de feuilles qui défilent sur le papier
  const prev = ctx.globalAlpha;
  ctx.fillStyle = PALETTE.mossDark;
  for (let i = 0; i < 3; i++) {
    const k = (time * 0.32 + i / 3 + ph * 0.05) % 1;
    const lx = x0 + k * ww;
    const ly = y0 + hh * (0.3 + 0.4 * ((i * 0.37) % 1)) + Math.sin(time * 2 + i) * hh * 0.06;
    ctx.globalAlpha = prev * 0.32 * Math.sin(Math.PI * k);
    ctx.beginPath();
    ctx.ellipse(lx, ly, ts * 0.035, ts * 0.016, time * 1.5 + i * 2, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = prev;
}

function lightEarth(ctx, m, ts, def, time, ph, f, dim) {
  const w = m.win;
  const x0 = w.x * ts;
  const y0 = w.y * ts;
  const ww = w.w * ts;
  const hh = w.h * ts;
  ctx.fillStyle = dim < 1 ? '#3b2412' : '#7a3a12';
  ctx.fillRect(x0 - 1, y0 - 1, ww + 2, hh + 2);
  const pulse = 0.75 + 0.25 * Math.sin(time * 2.2 + ph);
  wash(ctx, w.cx * ts, w.cy * ts + hh * 0.2, ww * 0.6, def.glow, pulse * dim);
  ctx.fillStyle = withAlpha('#ffe2a0', 0.75 * pulse * dim);
  ctx.fillRect(x0 + ww * 0.12, y0 + hh * 0.55, ww * 0.76, Math.max(1, hh * 0.22));
}

function lightGeneric(ctx, m, ts, def, time, ph, f, dim) {
  const w = m.win;
  ctx.fillStyle = dim < 1 ? mix(def.color, INK, 0.5) : mix(def.glow, def.color, 0.35);
  ctx.fillRect(w.x * ts - 1, w.y * ts - 1, w.w * ts + 2, w.h * ts + 2);
  wash(ctx, w.cx * ts, w.cy * ts, Math.max(w.w, w.h) * ts * 0.7, '#fffbe8', (0.6 + 0.3 * Math.sin(time * 3 + ph)) * dim);
}

// Braises qui s'élèvent au-dessus du joyau.
function liveFire(ctx, m, ts, def, lvl, time, ph) {
  const prev = ctx.globalAlpha;
  const n = lvl + 1;
  for (let i = 0; i < n; i++) {
    const k = (time * 0.7 + i / n + ph * 0.1) % 1;
    const px = Math.sin(time * 2.3 + i * 2.1 + ph) * ts * 0.08 * (0.3 + k);
    const py = (m.top + 0.03) * ts - k * ts * 0.32;
    ctx.globalAlpha = prev * 0.9 * (1 - k) * Math.min(1, k * 6);
    ctx.fillStyle = i % 2 ? PALETTE.goldLight : def.glow;
    ctx.beginPath();
    ctx.arc(px, py, ts * (0.022 - k * 0.01), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = prev;
}

// Gouttes qui tombent des avant-toits et ronds dans le bassin.
function liveWater(ctx, m, ts, def, lvl, time, ph) {
  const prev = ctx.globalAlpha;
  ctx.lineWidth = Math.max(0.8, ts * 0.016);
  for (let k = 0; k < 2; k++) {
    const q = (time * 0.42 + k * 0.5 + ph * 0.07) % 1;
    const rx = ts * (0.1 + q * 0.3);
    ctx.globalAlpha = prev * 0.6 * (1 - q);
    ctx.strokeStyle = PALETTE.cream;
    ctx.beginPath();
    ctx.ellipse(ts * 0.02, ts * 0.01, rx, rx * 0.3, 0, 0, TAU);
    ctx.stroke();
  }
  for (let i = 0; i < 2; i++) {
    const [ex, ey] = m.eaves[i];
    const q = (time * 0.55 + i * 0.5 + ph * 0.11) % 1;
    const x = ex * ts * 0.94;
    const y0 = ey * ts + ts * 0.03;
    const y1 = -ts * 0.02;
    if (q < 0.82) {
      const t = q / 0.82;
      const y = y0 + (y1 - y0) * t * t;
      const s = ts * 0.028;
      ctx.globalAlpha = prev * (t < 0.08 ? t / 0.08 : 1);
      ctx.fillStyle = '#d6efff';
      ctx.strokeStyle = PALETTE.indigo;
      ctx.lineWidth = Math.max(0.6, ts * 0.012);
      ctx.beginPath();
      ctx.moveTo(x, y - s * 1.6);
      ctx.quadraticCurveTo(x + s, y, x, y + s * 0.6);
      ctx.quadraticCurveTo(x - s, y, x, y - s * 1.6);
      ctx.fill();
      ctx.stroke();
    } else {
      const t = (q - 0.82) / 0.18;
      ctx.globalAlpha = prev * 0.8 * (1 - t);
      ctx.strokeStyle = PALETTE.cream;
      ctx.lineWidth = Math.max(0.8, ts * 0.016);
      ctx.beginPath();
      ctx.ellipse(x, y1, ts * (0.03 + t * 0.07), ts * (0.01 + t * 0.022), 0, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = prev;
}

const RB = new Float32Array(16);
// Ruban effilé qui flotte au vent, calculé sans allocation.
function ribbon(ctx, x0, y0, dir, len, wid, edge, time, ph, col) {
  const n = 7;
  // rafale commune : les rubans penchent ensemble, puis ondulent sur leur longueur
  const gust = 0.28 + Math.sin(time * 1.3 + ph * 0.3) * 0.22;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    RB[i * 2] = x0 + (dir * 0.18 + gust) * s * len + Math.sin(time * 5.5 - s * 5.5 + ph) * s * len * 0.16;
    RB[i * 2 + 1] = y0 + s * len * (0.95 - gust * 0.35) + Math.cos(time * 4.3 - s * 4 + ph) * s * len * 0.05;
  }
  // contour d'encre : la même bande, un peu plus large, remplie dessous
  // (deux remplissages coûtent bien moins qu'un stroke)
  ribbonPath(ctx, n, wid, edge);
  ctx.fillStyle = INK;
  ctx.fill();
  ribbonPath(ctx, n, wid, 0);
  ctx.fillStyle = col;
  ctx.fill();
}

function ribbonPath(ctx, n, wid, extra) {
  ctx.beginPath();
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j <= n; j++) {
      const i = pass ? n - j : j;
      const a = Math.max(0, i - 1);
      const b = Math.min(n, i + 1);
      let dx = RB[b * 2] - RB[a * 2];
      let dy = RB[b * 2 + 1] - RB[a * 2 + 1];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const w = (wid * (i === 0 ? 0.5 : 1 - (i / n) * 0.55) + extra) * (pass ? -0.5 : 0.5);
      const px = RB[i * 2] - dy * w;
      const py = RB[i * 2 + 1] + dx * w;
      if (j === 0 && !pass) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}

// Rubans qui flottent aux avant-toits.
function liveWind(ctx, m, ts, def, lvl, time, ph) {
  const edge = Math.max(1.1, ts * 0.028);
  const len = ts * (0.32 + lvl * 0.05);
  const wid = ts * 0.05;
  const col = lvl === 3 ? PALETTE.goldLight : PALETTE.cream;
  for (let i = 0; i < 2; i++) {
    const [ex, ey] = m.eaves[i];
    ribbon(ctx, ex * ts, ey * ts, i ? 1 : -1, len, wid, edge, time, ph + i * 1.3, col);
  }
  if (m.eaves2 && lvl === 3) {
    for (let i = 0; i < 2; i++) {
      const [ex, ey] = m.eaves2[i];
      ribbon(ctx, ex * ts, ey * ts, i ? 1 : -1, len * 0.7, wid * 0.8, edge, time + 0.4, ph + 2 + i, PALETTE.vermillion);
    }
  }
}

// Volutes de vent qui tournent autour de la lanterne (dessinées derrière elle).
function windSwirls(ctx, m, ts, def, lvl, time, ph, sc) {
  const s = swirlSprite(ts, sc);
  const prev = ctx.globalAlpha;
  const n = lvl === 1 ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const k = (time * 0.2 + i / n + ph * 0.05) % 1;
    const a = k * TAU;
    const px = Math.cos(a) * ts * 0.44;
    const py = (m.win.cy - 0.1 * i) * ts + Math.sin(a) * ts * 0.1;
    ctx.globalAlpha = prev * (0.35 + 0.35 * Math.abs(Math.cos(a)));
    ctx.drawImage(s.canvas, px - s.size / 2, py - s.size / 2, s.size, s.size);
  }
  ctx.globalAlpha = prev;
}

// Poussière ocre qui flotte autour du socle.
function liveEarth(ctx, m, ts, def, lvl, time, ph) {
  const prev = ctx.globalAlpha;
  ctx.fillStyle = '#c9a868';
  for (let i = 0; i < 2 + lvl; i++) {
    const k = (time * 0.25 + i / (2 + lvl) + ph * 0.03) % 1;
    const px = (i % 2 ? 1 : -1) * ts * (0.3 + 0.12 * Math.sin(i * 3.1 + time * 0.7));
    const py = -k * ts * 0.4 - ts * 0.02;
    ctx.globalAlpha = prev * 0.7 * Math.sin(Math.PI * k);
    ctx.fillRect(px, py, ts * 0.025, ts * 0.025);
  }
  ctx.globalAlpha = prev;
}

// Esprits en orbite (N3), propres à chaque élément.
function spiritFire(ctx, x, y, s, a, time, def) {
  wash(ctx, x, y, s * 2.6, def.glow, 0.6);
  const sw = Math.sin(time * 9 + a) * s * 0.25;
  flame(ctx, x, y + s * 0.9, s * 1.3, s * 2.2, sw, '#e2562a');
  flame(ctx, x, y + s * 0.9, s * 0.7, s * 1.3, sw * 0.7, '#fff0c0');
}

function spiritWater(ctx, x, y, s, a, time, def) {
  wash(ctx, x, y, s * 2.4, def.glow, 0.6);
  ctx.fillStyle = '#dff2ff';
  ctx.strokeStyle = PALETTE.indigo;
  ctx.lineWidth = Math.max(0.6, s * 0.22);
  ctx.beginPath();
  ctx.moveTo(x, y - s * 1.3);
  ctx.quadraticCurveTo(x + s, y + s * 0.1, x, y + s * 0.75);
  ctx.quadraticCurveTo(x - s, y + s * 0.1, x, y - s * 1.3);
  ctx.fill();
  ctx.stroke();
}

function spiritWind(ctx, x, y, s, a, time, def) {
  wash(ctx, x, y, s * 2.2, def.glow, 0.5);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a * 2 + time * 2);
  ctx.fillStyle = '#8db27a';
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.6, s * 0.2);
  ctx.beginPath();
  ctx.moveTo(-s * 1.2, 0);
  ctx.quadraticCurveTo(0, -s * 0.8, s * 1.2, 0);
  ctx.quadraticCurveTo(0, s * 0.8, -s * 1.2, 0);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 0.9, 0);
  ctx.lineTo(s * 0.9, 0);
  ctx.stroke();
  ctx.restore();
}

function spiritEarth(ctx, x, y, s, a, time, def) {
  wash(ctx, x, y, s * 2.4, def.glow, 0.55);
  ctx.fillStyle = '#9c7c45';
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.6, s * 0.22);
  ctx.beginPath();
  ctx.moveTo(x - s, y - s * 0.2);
  ctx.lineTo(x - s * 0.3, y - s * 0.9);
  ctx.lineTo(x + s * 0.9, y - s * 0.5);
  ctx.lineTo(x + s * 0.8, y + s * 0.6);
  ctx.lineTo(x - s * 0.6, y + s * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = withAlpha(PALETTE.goldLight, 0.9);
  ctx.fillRect(x - s * 0.35, y - s * 0.4, s * 0.4, s * 0.25);
}

function spiritGeneric(ctx, x, y, s, a, time, def) {
  wash(ctx, x, y, s * 2.6, def.glow, 0.75);
  ctx.fillStyle = '#fffbe8';
  ctx.beginPath();
  ctx.arc(x, y, s * 0.55, 0, TAU);
  ctx.fill();
}

function spirits(ctx, st, m, ts, def, time, ph, front) {
  const cy = (m.win.cy - 0.04) * ts;
  for (let k = 0; k < 3; k++) {
    const a = time * 1.3 + ph + (k * TAU) / 3;
    const s = Math.sin(a);
    if (s >= 0 !== front) continue;
    st.spirit(ctx, Math.cos(a) * ts * 0.5, cy + s * ts * 0.15, ts * (0.05 + s * 0.01), a, time, def);
  }
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const rr = i % 2 ? r * 0.38 : r;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// Recul au tir : opts.shot n'est qu'un booléen ; on retient l'instant du front
// montant par position pour un recul qui s'amortit en douceur.
const shots = new Map();
function recoil(x, y, shot, time) {
  const key = Math.round(x * 4) * 100000 + Math.round(y * 4);
  let r = shots.get(key);
  if (!r) {
    if (!shot) return 0;
    if (shots.size > 300) shots.clear();
    r = { on: false, t: -9 };
    shots.set(key, r);
  }
  if (shot && !r.on) r.t = time;
  r.on = shot;
  const k = 1 - (time - r.t) / 0.26;
  return k > 0 && k <= 1 ? k * k : 0;
}

const phaseOf = (x, y) => (x * 0.37 + y * 0.23) % TAU;

function scaleOf(ctx) {
  const m = ctx.getTransform ? ctx.getTransform() : null;
  return { m, sc: m ? Math.hypot(m.a, m.b) || 1 : 1 };
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

export function drawTower(ctx, x, y, ts, def, level, time, opts = {}) {
  if (opts.echo != null) return drawEcho(ctx, x, y, ts, def, level, time, opts);
  def = viewOf(def);
  const st = styleOf(def);
  const lvl = clampLevel(level);
  const { m, sc } = scaleOf(ctx);
  const body = getBody(def, st, lvl, ts, sc, false);
  const meta = body.meta;
  const w = meta.win;
  const ph = phaseOf(x, y);
  const rec = recoil(x, y, !!opts.shot, time);
  const stun = !!opts.stunned;
  const dim = stun ? 0.35 : 1;
  const sp = st.flick;
  const f = 0.88 + Math.sin(time * 9 * sp + ph) * 0.07 + Math.sin(time * 23 * sp + ph * 1.7) * 0.05;
  let gx = x;
  let gy = y + GROUND * ts;
  if (m && !m.b && !m.c && !rec && !stun) {
    // pied aligné sur le pixel physique : le cache est copié sans flou
    gx = (Math.round(m.a * gx + m.e) - m.e) / m.a;
    gy = (Math.round(m.d * gy + m.f) - m.f) / m.d;
  }
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  ctx.translate(gx, gy);
  if (stun) ctx.rotate(Math.sin(time * 12 + ph) * 0.06);
  if (rec) ctx.scale(1 + rec * 0.05, 1 - rec * 0.07);
  // derrière la lanterne : auréole tournante et esprits qui passent derrière (N3)
  if (lvl === 3) {
    const turn = (((time + ph) * 0.25) / (TAU / 12)) % 1;
    const h = haloSprite(ts, sc, Math.floor(turn * HALO_FRAMES));
    const hy = Math.round(meta.haloY * ts * sc) / sc;
    ctx.drawImage(h.canvas, -h.size / 2, hy - h.size / 2, h.size, h.size);
    spirits(ctx, st, meta, ts, def, time, ph, false);
  }
  if (st.back) st.back(ctx, meta, ts, def, lvl, time, ph, sc);
  st.light(ctx, meta, ts, def, time, ph, f, dim, rec);
  ctx.drawImage(body.canvas, -body.ax, -body.ay, body.w, body.h);
  wash(ctx, w.cx * ts, w.cy * ts, ts * (0.3 + 0.04 * lvl), def.glow, 0.22 * f * dim);
  if (st.live) st.live(ctx, meta, ts, def, lvl, time, ph);
  if (lvl === 3) spirits(ctx, st, meta, ts, def, time, ph, true);
  if (rec) {
    wash(ctx, w.cx * ts, w.cy * ts, ts * 0.5, def.glow, 0.55 * rec);
    wash(ctx, w.cx * ts, w.cy * ts, ts * 0.2, '#fffbe8', 0.6 * rec);
  }
  if (stun) {
    // étourdie (frappe du boss) : étoiles dorées qui tournent au-dessus du toit
    ctx.fillStyle = PALETTE.goldLight;
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.7, ts * 0.014);
    const cy = (meta.top - 0.08) * ts;
    for (let k = 0; k < 3; k++) {
      const a = time * 5 + (k * TAU) / 3;
      star(ctx, Math.cos(a) * ts * 0.24, cy + Math.sin(a) * ts * 0.07, ts * 0.065);
    }
  }
  ctx.restore();
  return { top: gy + meta.top * ts, boxY: gy + w.cy * ts };
}

// Écho fantôme (Rembobinage) : lanterne translucide indigo qui flotte et vacille,
// lumière spectrale, anneau de durée au sol et sceau 影. opts.echo = vie restante (0..1).
function drawEcho(ctx, x, y, ts, def, level, time, opts) {
  def = viewOf(def);
  const st = styleOf(def);
  const lvl = clampLevel(level);
  const k = Math.max(0, Math.min(1, opts.echo));
  const { sc } = scaleOf(ctx);
  const body = getBody(def, st, lvl, ts, sc, true);
  const meta = body.meta;
  const w = meta.win;
  const ph = phaseOf(x, y);
  const flicker = 0.78 + Math.sin(time * 13 + ph) * 0.1 + Math.sin(time * 5.3 + ph) * 0.08;
  const gy = y + GROUND * ts;
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  wash(ctx, x, gy - ts * 0.35, ts * 0.8, '#8fb4ff', 0.3 * flicker);
  // anneau de durée restante, en perspective au sol
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.5, ts * 0.045);
  ctx.strokeStyle = withAlpha('#9db8ff', 0.25);
  ctx.beginPath();
  ctx.ellipse(x, gy, ts * 0.42, ts * 0.15, 0, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = withAlpha('#c4d6ff', 0.95);
  ctx.beginPath();
  ctx.ellipse(x, gy, ts * 0.42, ts * 0.15, 0, Math.PI / 2, Math.PI / 2 + k * TAU);
  ctx.stroke();
  // lanterne spectrale
  ctx.save();
  ctx.translate(x + Math.sin(time * 3 + ph) * ts * 0.02, gy - ts * (0.06 + 0.025 * Math.sin(time * 2.1 + ph)));
  ctx.globalAlpha *= 0.7 * flicker * (0.4 + 0.6 * Math.min(1, k * 3));
  ctx.fillStyle = '#dbe7ff';
  ctx.fillRect(w.x * ts - 1, w.y * ts - 1, w.w * ts + 2, w.h * ts + 2);
  ctx.drawImage(body.canvas, -body.ax, -body.ay, body.w, body.h);
  wash(ctx, w.cx * ts, w.cy * ts, ts * 0.38, '#cfe0ff', 0.55 * flicker + (opts.shot ? 0.35 : 0));
  ctx.restore();
  // sceau 影
  const sx = x + ts * 0.34;
  const sy = y - ts * 0.36;
  ctx.fillStyle = withAlpha(PALETTE.indigo, 0.85);
  ctx.beginPath();
  ctx.arc(sx, sy, ts * 0.14, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = withAlpha('#9db8ff', 0.9);
  ctx.lineWidth = Math.max(1, ts * 0.02);
  ctx.stroke();
  ctx.fillStyle = '#e4edff';
  ctx.font = `800 ${Math.round(ts * 0.19)}px "Shippori Mincho", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('影', sx, sy + ts * 0.01);
  ctx.restore();
  return { top: gy + meta.top * ts, boxY: gy + w.cy * ts };
}

// Icône de lanterne pour la palette (canvas 2D hors jeu) : la lanterne est
// cadrée pour remplir l'icône quelle que soit sa silhouette, en laissant les
// coins supérieurs libres (kanji de la palette).
export function drawTowerIcon(ctx, w, h, def, level = 1) {
  ctx.clearRect(0, 0, w, h);
  const lvl = clampLevel(level);
  def = viewOf(def);
  const meta = layoutOf(def, styleOf(def), lvl).meta;
  const up = -meta.top + 0.03; // hauteur au-dessus du pied (en cases)
  const down = 0.13; // ombre sous le pied
  const half = Math.max(meta.hw, 0.32) + 0.03;
  const ts = Math.min(h / (up + down), (w * 0.86) / (half * 2));
  const gy = (h - (up + down) * ts) / 2 + up * ts;
  drawTower(ctx, w / 2, gy - GROUND * ts, ts, def, lvl, 0.3, {});
}

export { mix };
