// Rendu des combos élémentaires : liens entre lanternes, zones de synergie, tornades, pierres.
//
// Chaque zone a sa signature, lisible même quand plusieurs se chevauchent :
//   霧 Vapeur      bandes de brume (kasumi) aux bouts arrondis qui dérivent
//   炎嵐 Tornade   orbite pointillée de braise (la tornade se dessine à part)
//   泥 Boue        flaques brunes sur le chemin, bulles qui crèvent
//   熔 Magma       croûte noire et rivière de lave le long du chemin, lueur pulsée
//   氷 Givre       liseré de gel, cristaux qui scintillent
//   砂 Tempête     arcs de sable qui tournoient
// Le contour de toute zone est un anneau d'encre au pinceau (segments effilés).
//
// Performance : tout ce qui est statique (flaques, croûte de lave, lien d'encre,
// sceau, bandes de brume, pierres) est rendu une seule fois par zone et par
// échelle dans un canvas hors écran à la résolution physique, puis copié par
// drawImage. Les zones sont dessinées en deux passes (corps, puis contours) pour
// que les anneaux restent lisibles quand elles se chevauchent.
import { INK, PALETTE, withAlpha, wash, brushStroke, quadPts, seeded, makeCanvas, mix } from './brush.js';
import { ELEMENT_COLORS } from './fx.js';

const TAU = Math.PI * 2;

// Teinte du contour et du lavis de chaque zone (les combos ajoutés utilisent def.color).
const LOOK = {
  steam: { ring: '#7f949e' },
  firestorm: { ring: '#c8502a' },
  mud: { ring: '#6b4b2a' },
  magma: { ring: '#a8301c' },
  frost: { ring: '#5f97c2' },
  sandstorm: { ring: '#a07a34' },
};

function scaleOf(ctx) {
  const m = ctx.getTransform();
  return { m, sc: Math.max(1, Math.min(4, Math.round(m.a * 2) / 2)) };
}

// Copie un sprite (canvas à l'échelle sc) dont l'origine est (x, y) en px CSS,
// aligné sur le pixel physique quand le repère le permet (copie nette).
function blit(ctx, m, spr, x, y, w = spr.w, h = spr.h) {
  if (m && !m.b && !m.c && w === spr.w && h === spr.h) {
    x = (Math.round(m.a * x + m.e) - m.e) / m.a;
    y = (Math.round(m.d * y + m.f) - m.f) / m.d;
  }
  ctx.drawImage(spr.c, x, y, w, h);
}

// Canvas hors écran couvrant [x0, y0, w, h] (px CSS) à l'échelle sc.
function layer(x0, y0, w, h, sc) {
  const c = makeCanvas(w * sc, h * sc);
  const g = c.getContext('2d');
  g.setTransform(sc, 0, 0, sc, -x0 * sc, -y0 * sc);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  return { c, g, x: x0, y: y0, w: c.width / sc, h: c.height / sc };
}

// Contour irrégulier ajouté au chemin courant (union de taches en un seul fill).
function blob(g, cx, cy, rx, ry, rnd, wobble, n = 10) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = 1 + (rnd() - 0.5) * wobble * 2;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  g.moveTo((pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  g.closePath();
}

// ───────────────────────── données de zone mises en cache ─────────────────────────

const zoneCache = new Map();
let cacheGrid = null;
let frame = 0;

function zoneData(z, game, ts, sc) {
  const key = `${z.def.id}|${z.x}|${z.y}|${z.radius.toFixed(2)}|${ts}|${sc}`;
  let d = zoneCache.get(key);
  if (d) return d;
  const seed = Math.round(z.x * 97 + z.y * 131);
  const rnd = seeded(seed + 1);
  d = { key, seed, ring: ringShape(rnd, z.def.id === 'steam' ? 5 : 4) };
  const id = z.def.id;
  if (id === 'mud' || id === 'magma') {
    const g = game.grid;
    const tiles = [];
    for (let i = 0; i < g.size; i++) {
      if (!g.isWalkableType(i)) continue;
      const cx = g.cx(i);
      const cy = g.cy(i);
      if (Math.hypot(cx - z.x, cy - z.y) > z.radius) continue;
      tiles.push({ i, cx, cy });
    }
    d.tiles = tiles;
    if (tiles.length) d.spr = id === 'mud' ? mudLayer(tiles, g, ts, sc) : magmaLayer(tiles, g, ts, sc);
  }
  if (zoneCache.size > 64) {
    for (const [k, v] of zoneCache) if (frame - v.used > 120) zoneCache.delete(k);
  }
  zoneCache.set(key, d);
  return d;
}

// Anneau au pinceau : n segments effilés séparés de petits blancs (coordonnées polaires).
function ringShape(rnd, n) {
  const segs = [];
  let a = rnd() * TAU;
  const gapTotal = 0.5 + rnd() * 0.3;
  for (let s = 0; s < n; s++) {
    const span = ((TAU - gapTotal) / n) * (0.75 + rnd() * 0.5);
    const steps = Math.max(6, Math.round(span * 7));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const taper = Math.min(1, k / 0.25, (1 - k) / 0.35);
      pts.push([a + span * k, (rnd() - 0.5) * 0.035, 0.25 + 0.75 * Math.max(0, taper)]);
    }
    segs.push(pts);
    a += span + gapTotal / n;
  }
  return segs;
}

function drawRing(ctx, x, y, R, segs, width, rot) {
  ctx.beginPath();
  for (const pts of segs) {
    for (let i = 0; i < pts.length; i++) {
      const [a, j, w] = pts[i];
      const r = R * (1 + j) + width * w * 0.5;
      const px = x + Math.cos(a + rot) * r;
      const py = y + Math.sin(a + rot) * r;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const [a, j, w] = pts[i];
      const r = R * (1 + j) - width * w * 0.5;
      ctx.lineTo(x + Math.cos(a + rot) * r, y + Math.sin(a + rot) * r);
    }
    ctx.closePath();
  }
  ctx.fill();
}

function tileBounds(tiles, ts, pad) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const t of tiles) {
    x0 = Math.min(x0, t.cx);
    y0 = Math.min(y0, t.cy);
    x1 = Math.max(x1, t.cx);
    y1 = Math.max(y1, t.cy);
  }
  return [(x0 - pad) * ts, (y0 - pad) * ts, (x1 - x0 + pad * 2) * ts, (y1 - y0 + pad * 2) * ts];
}

// Voisins marchables d'une case (pour relier flaques et fissures le long du chemin).
function walkNeighbors(g, i) {
  const c = g.col(i);
  const r = g.row(i);
  const out = [];
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (!g.inBounds(c + dc, r + dr)) continue;
    if (g.isWalkableType(g.idx(c + dc, r + dr))) out.push([dc, dr]);
  }
  return out;
}

// Nappe continue qui épouse le chemin : une tache par case, un pont vers chaque
// voisin marchable (le bord de zone s'effile au lieu de couper net).
function pathBand(c, tiles, g, ts, grow, seed) {
  const inZone = new Set(tiles.map((t) => t.i));
  c.beginPath();
  for (const t of tiles) {
    const r = seeded(t.i * 7 + seed);
    const x = t.cx * ts;
    const y = t.cy * ts;
    blob(c, x, y, ts * (0.36 + grow), ts * (0.34 + grow), r, 0.14, 9);
    for (const [dc, dr] of walkNeighbors(g, t.i)) {
      const n = g.idx(g.col(t.i) + dc, g.row(t.i) + dr);
      const inside = inZone.has(n);
      if (inside && n < t.i) continue;
      const f = inside ? 0.5 : 0.36;
      const k = inside ? 1 : 0.62;
      const rx = dc ? 0.34 : 0.3;
      const ry = dr ? 0.34 : 0.3;
      blob(c, x + dc * ts * f, y + dr * ts * f, ts * (rx * k + grow), ts * (ry * k + grow), r, 0.16, 8);
    }
  }
}

// Boue : nappe brune translucide, bord sombre, reflets humides et cailloux enlisés.
function mudLayer(tiles, g, ts, sc) {
  const [x0, y0, w, h] = tileBounds(tiles, ts, 0.62);
  const L = layer(x0, y0, w, h, sc);
  const c = L.g;
  pathBand(c, tiles, g, ts, 0.035, 3);
  c.fillStyle = withAlpha('#4a3420', 0.45);
  c.fill();
  pathBand(c, tiles, g, ts, -0.01, 3);
  c.fillStyle = withAlpha('#8a6a40', 0.62);
  c.fill();
  for (const t of tiles) {
    const x = t.cx * ts;
    const y = t.cy * ts;
    const r = seeded(t.i * 13 + 1);
    c.fillStyle = withAlpha('#f2e8d0', 0.24);
    c.beginPath();
    c.ellipse(x - ts * 0.08 + r() * ts * 0.1, y - ts * 0.1, ts * 0.14, ts * 0.04, -0.2, 0, TAU);
    c.fill();
    c.strokeStyle = withAlpha('#3d2a16', 0.4);
    c.lineWidth = Math.max(0.8, ts * 0.018);
    c.beginPath();
    c.ellipse(x + (r() - 0.5) * ts * 0.25, y + (r() - 0.5) * ts * 0.2, ts * 0.1, ts * 0.05, 0, 0, TAU);
    c.stroke();
    c.fillStyle = withAlpha(INK, 0.4);
    for (let k = 0; k < 3; k++) {
      c.beginPath();
      c.arc(x + (r() - 0.5) * ts * 0.5, y + (r() - 0.5) * ts * 0.45, ts * (0.014 + r() * 0.018), 0, TAU);
      c.fill();
    }
  }
  return L;
}

// Magma : croûte de basalte, rivière de lave qui suit le chemin, fissures dorées.
function magmaLayer(tiles, g, ts, sc) {
  const [x0, y0, w, h] = tileBounds(tiles, ts, 0.62);
  const L = layer(x0, y0, w, h, sc);
  const c = L.g;
  pathBand(c, tiles, g, ts, 0.03, 5);
  c.fillStyle = withAlpha('#2a1a14', 0.72);
  c.fill();
  pathBand(c, tiles, g, ts, -0.06, 5);
  c.fillStyle = withAlpha('#4a2418', 0.6);
  c.fill();
  const inZone = new Set(tiles.map((t) => t.i));
  const veins = [];
  for (const t of tiles) {
    const r = seeded(t.i * 11 + 9);
    const x = t.cx * ts;
    const y = t.cy * ts;
    const mx = x + (r() - 0.5) * ts * 0.16;
    const my = y + (r() - 0.5) * ts * 0.16;
    for (const [dc, dr] of walkNeighbors(g, t.i)) {
      const n = g.idx(g.col(t.i) + dc, g.row(t.i) + dr);
      // vers une case hors zone : la fissure s'arrête avant le bord (effilée)
      const reach = inZone.has(n) ? 0.5 : 0.32;
      const ex = x + dc * ts * reach;
      const ey = y + dr * ts * reach;
      const kx = (mx + ex) / 2 + (r() - 0.5) * ts * 0.14;
      const ky = (my + ey) / 2 + (r() - 0.5) * ts * 0.14;
      veins.push({ pts: [[mx, my], [kx, ky], [ex, ey]], end: !inZone.has(n) });
    }
    // fissures secondaires
    for (let k = 0; k < 2; k++) {
      const a = r() * TAU;
      veins.push({ pts: [[mx, my], [mx + Math.cos(a) * ts * 0.18, my + Math.sin(a) * ts * 0.14], [mx + Math.cos(a + 0.4) * ts * 0.3, my + Math.sin(a + 0.4) * ts * 0.24]], end: true, thin: true });
    }
  }
  for (const v of veins) brushStroke(c, v.pts, ts * (v.thin ? 0.05 : 0.11), '#c8402a', { taperIn: 0.05, taperOut: v.end ? 0.8 : 0.05 });
  for (const v of veins) brushStroke(c, v.pts, ts * (v.thin ? 0.022 : 0.045), '#ffc65a', { taperIn: 0.1, taperOut: v.end ? 0.8 : 0.1 });
  return L;
}

// Bande de brume (suyari-gasumi) : bouts arrondis, crête festonnée cernée d'un
// trait gris-bleu, fond qui s'évanouit vers le bas (bokashi).
const bandCache = new Map();
function bandSprite(wPx, hPx, sc) {
  const key = `${wPx}|${hPx}|${sc}`;
  let b = bandCache.get(key);
  if (b) return b;
  const tp = Math.ceil(hPx * 0.4) + 2;
  const L = layer(0, 0, wPx + 4, hPx + tp + 2, sc);
  const c = L.g;
  const r = hPx / 2;
  const x0 = 2 + r;
  const x1 = 2 + wPx - r;
  const y0 = tp;
  const y1 = tp + hPx;
  const n = Math.max(2, Math.round((x1 - x0) / (hPx * 1.3)));
  const outline = () => {
    c.moveTo(x0, y1);
    c.arc(x0, y0 + r, r, Math.PI / 2, (Math.PI * 3) / 2);
    for (let i = 0; i < n; i++) {
      const xa = x0 + ((x1 - x0) * i) / n;
      const xb = x0 + ((x1 - x0) * (i + 1)) / n;
      c.quadraticCurveTo((xa + xb) / 2, y0 - hPx * (0.55 + (i % 2) * 0.2), xb, y0);
    }
    c.arc(x1, y0 + r, r, -Math.PI / 2, Math.PI / 2);
  };
  c.beginPath();
  outline();
  c.closePath();
  const gr = c.createLinearGradient(0, y0 - hPx * 0.4, 0, y1);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.5, 'rgba(246,248,249,0.8)');
  gr.addColorStop(1, 'rgba(236,241,243,0.12)');
  c.fillStyle = gr;
  c.fill();
  c.beginPath();
  outline();
  c.lineWidth = Math.max(0.8, hPx * 0.07);
  c.strokeStyle = withAlpha('#7f949e', 0.6);
  c.stroke();
  b = L;
  if (bandCache.size > 40) bandCache.clear();
  bandCache.set(key, b);
  return b;
}

// Cristal de givre (six branches).
const flakeCache = new Map();
function flakeSprite(sizePx, sc) {
  const key = `${sizePx}|${sc}`;
  let f = flakeCache.get(key);
  if (f) return f;
  const s = sizePx;
  const L = layer(-s, -s, s * 2, s * 2, sc);
  const c = L.g;
  for (const [col, lw] of [[withAlpha('#5f97c2', 0.7), s * 0.24], ['#ffffff', s * 0.11]]) {
    c.strokeStyle = col;
    c.lineWidth = lw;
    c.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI + Math.PI / 2;
      const cx = Math.cos(a) * s * 0.85;
      const cy = Math.sin(a) * s * 0.85;
      c.moveTo(-cx, -cy);
      c.lineTo(cx, cy);
      for (const d of [-0.55, 0.55]) {
        const bx = Math.cos(a) * s * d;
        const by = Math.sin(a) * s * d;
        const o = d > 0 ? 1 : -1;
        c.moveTo(bx + (Math.cos(a) * 0.3 - Math.sin(a) * 0.26) * s * o, by + (Math.sin(a) * 0.3 + Math.cos(a) * 0.26) * s * o);
        c.lineTo(bx, by);
        c.lineTo(bx + (Math.cos(a) * 0.3 + Math.sin(a) * 0.26) * s * o, by + (Math.sin(a) * 0.3 - Math.cos(a) * 0.26) * s * o);
      }
    }
    c.stroke();
  }
  if (flakeCache.size > 4) flakeCache.clear(); // une seule taille de case active à la fois
  flakeCache.set(key, L);
  return L;
}

// ───────────────────────── zones ─────────────────────────

export function drawZones(ctx, game, ts, time) {
  if (!game.zones.length) return;
  const { m, sc } = scaleOf(ctx);
  if (game.grid !== cacheGrid) {
    zoneCache.clear();
    cacheGrid = game.grid;
  }
  frame++;
  const a0 = ctx.globalAlpha;
  const list = [];
  for (const z of game.zones) {
    const d = zoneData(z, game, ts, sc);
    d.used = frame;
    list.push(d);
  }
  // passe 1 : corps des zones
  ctx.lineCap = 'round';
  for (let n = 0; n < list.length; n++) {
    const z = game.zones[n];
    const d = list[n];
    ctx.globalAlpha = a0 * Math.min(1, (game.time - z.born) / 0.6);
    drawBody(ctx, m, z, d, ts, time, sc);
  }
  // passe 2 : anneaux d'encre au pinceau
  for (let n = 0; n < list.length; n++) {
    const z = game.zones[n];
    const d = list[n];
    const look = LOOK[z.def.id];
    const col = look ? look.ring : mix(z.def.color, INK, 0.35);
    ctx.globalAlpha = a0 * Math.min(1, (game.time - z.born) / 0.6) * 0.5;
    ctx.fillStyle = col;
    drawRing(ctx, z.x * ts, z.y * ts, z.radius * ts, d.ring, Math.max(1.4, ts * 0.042), time * (d.seed % 2 ? 0.06 : -0.06));
  }
  ctx.globalAlpha = a0;
  ctx.lineCap = 'butt';
}

function drawBody(ctx, m, z, d, ts, time, sc) {
  const x = z.x * ts;
  const y = z.y * ts;
  const R = z.radius * ts;
  const ph = d.seed * 0.37;
  const a0 = ctx.globalAlpha;
  switch (z.def.id) {
    case 'steam': {
      const bh = Math.max(6, Math.round(ts * 0.24));
      for (let i = 0; i < 3; i++) {
        const k = i - 1;
        const band = bandSprite(Math.round(R * (1.2 - Math.abs(k) * 0.26)), bh, sc);
        const bx = x + Math.sin(time * 0.35 + i * 2.1 + ph) * R * 0.22 - band.w / 2 + k * R * 0.12;
        const by = y + k * R * 0.42 - band.h / 2 + Math.sin(time * 0.5 + i) * ts * 0.03;
        ctx.globalAlpha = a0 * (0.6 + 0.2 * Math.sin(time * 0.7 + i * 1.7 + ph));
        blit(ctx, m, band, bx, by);
      }
      ctx.globalAlpha = a0;
      break;
    }
    case 'firestorm': {
      // orbite de la tornade : trait plein discret et trois traînées de braise qui y courent
      const rx = R * 0.7;
      const ry = rx * 0.85;
      ctx.strokeStyle = withAlpha('#c8502a', 0.28);
      ctx.lineWidth = Math.max(1, ts * 0.025);
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = withAlpha('#e2552f', 0.75);
      ctx.lineWidth = Math.max(1.4, ts * 0.045);
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = time * 2.2 + (k * TAU) / 3 + ph;
        ctx.moveTo(x + Math.cos(a) * rx, y + Math.sin(a) * ry);
        ctx.ellipse(x, y, rx, ry, 0, a, a + 0.45);
      }
      ctx.stroke();
      break;
    }
    case 'mud': {
      if (!d.spr) break;
      blit(ctx, m, d.spr, d.spr.x, d.spr.y);
      // bulles qui gonflent puis crèvent
      ctx.strokeStyle = withAlpha('#3d2a16', 0.6);
      ctx.lineWidth = Math.max(0.8, ts * 0.02);
      const n = d.tiles.length;
      for (let b = 0; b < 2; b++) {
        const u = time * 0.7 + b * 0.5 + ph;
        const t = d.tiles[Math.floor(u * 1.7 + b * 3) % n];
        const f = u % 1;
        const r = seeded(t.i + Math.floor(u));
        const bx = t.cx * ts + (r() - 0.5) * ts * 0.4;
        const by = t.cy * ts + (r() - 0.5) * ts * 0.3;
        ctx.globalAlpha = a0 * (1 - f);
        ctx.beginPath();
        ctx.arc(bx, by, ts * (0.03 + f * 0.09), Math.PI, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = a0;
      break;
    }
    case 'magma': {
      if (!d.spr) break;
      blit(ctx, m, d.spr, d.spr.x, d.spr.y);
      for (let i = 0; i < d.tiles.length; i++) {
        const t = d.tiles[i];
        wash(ctx, t.cx * ts, t.cy * ts, ts * 0.4, '#ff7a2c', 0.16 + 0.14 * Math.sin(time * 2.6 + t.i * 1.3));
      }
      break;
    }
    case 'frost': {
      ctx.strokeStyle = withAlpha('#bfe3ff', 0.35);
      ctx.lineWidth = ts * 0.16;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, R - ts * 0.1), 0, TAU);
      ctx.stroke();
      const fl = flakeSprite(Math.round(ts * 0.13), sc);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU + ph + time * 0.08;
        const rr = R * (0.45 + ((k * 3) % 5) * 0.08);
        const tw = 0.55 + 0.45 * Math.sin(time * 2 + k * 1.9 + ph);
        ctx.globalAlpha = a0 * tw;
        ctx.drawImage(fl.c, x + Math.cos(a) * rr - fl.w / 2, y + Math.sin(a) * rr * 0.85 - fl.h / 2, fl.w, fl.h);
      }
      ctx.globalAlpha = a0;
      break;
    }
    case 'sandstorm': {
      ctx.strokeStyle = withAlpha('#a07a34', 0.5);
      for (let k = 0; k < 7; k++) {
        const a = time * (1.3 + (k % 3) * 0.25) + k * 0.9 + ph;
        const rr = R * (0.28 + (k % 4) * 0.2);
        ctx.lineWidth = Math.max(1, ts * (0.025 + (k % 3) * 0.012));
        ctx.beginPath();
        ctx.ellipse(x, y, rr, rr * 0.85, 0, a, a + 0.55 + (k % 2) * 0.3);
        ctx.stroke();
      }
      break;
    }
    default:
      wash(ctx, x, y, R * 0.7, z.def.color, 0.16);
  }
}

// ───────────────────────── liens et sceaux ─────────────────────────

const linkCache = new Map();
const sealCache = new Map();
if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
  // La police arrive après coup : les sceaux rendus en police de secours sont refaits.
  document.fonts.addEventListener('loadingdone', () => sealCache.clear());
}

// Géométrie d'un lien : extrémités au niveau des lanternes, courbe légère.
function linkGeom(a, b, ts) {
  const ax = a.x * ts;
  const ay = (a.y - 0.25) * ts;
  const bx = b.x * ts;
  const by = (b.y - 0.25) * ts;
  // la courbe s'écarte des corps des lanternes ; le sceau se pose en son milieu.
  // Paire verticale : le sceau s'écarte d'environ une demi-case sur le côté pour ne
  // pas cacher le toit (niveau) des lanternes (D21).
  const bow = Math.abs(bx - ax) < ts * 0.05 ? 0.84 : 0.36;
  const mx = (ax + bx) / 2 + (by - ay) * bow;
  const my = (ay + by) / 2 - (bx - ax) * bow;
  const sx = (ax + bx) / 2 + (by - ay) * bow * 0.5;
  const sy = (ay + by) / 2 - (bx - ax) * bow * 0.5;
  return { ax, ay, bx, by, mx, my, sx, sy };
}

// Lien d'encre : trait sombre sous-jacent, puis deux demi-traits aux couleurs des éléments.
function linkSprite(key, G, ca, cb, ts, sc) {
  let L = linkCache.get(key);
  if (L) return L;
  const pad = ts * 0.12;
  const x0 = Math.min(G.ax, G.bx, G.mx) - pad;
  const y0 = Math.min(G.ay, G.by, G.my) - pad;
  const x1 = Math.max(G.ax, G.bx, G.mx) + pad;
  const y1 = Math.max(G.ay, G.by, G.my) + pad;
  L = layer(x0, y0, x1 - x0, y1 - y0, sc);
  const pts = quadPts(G.ax, G.ay, G.mx, G.my, G.bx, G.by, 16);
  const half = 8;
  const w = Math.max(1.8, ts * 0.055);
  brushStroke(L.g, pts, w * 1.8, withAlpha(INK, 0.32), { taperIn: 0.3, taperOut: 0.3 });
  brushStroke(L.g, pts.slice(0, half + 1), w, withAlpha(ca, 0.9), { taperIn: 0.55, taperOut: 0 });
  brushStroke(L.g, pts.slice(half), w, withAlpha(cb, 0.9), { taperIn: 0, taperOut: 0.55 });
  if (linkCache.size > 60) linkCache.clear();
  linkCache.set(key, L);
  return L;
}

// Sceau (hanko) : carré vermillon aux bords irréguliers, cadre et kanji crème.
function sealSprite(kanji, sizePx, sc) {
  const key = `${kanji}|${sizePx}|${sc}`;
  let S = sealCache.get(key);
  if (S) return S;
  const s = sizePx;
  const L = layer(-s, -s, s * 2, s * 2, sc);
  const c = L.g;
  const rnd = seeded(kanji.charCodeAt(0));
  c.rotate(-0.08);
  const h = s / 2;
  const j = () => (rnd() - 0.5) * s * 0.06;
  const quad = () => {
    c.beginPath();
    c.moveTo(-h + j(), -h + j());
    c.lineTo(j(), -h + j());
    c.lineTo(h + j(), -h + j());
    c.lineTo(h + j(), j());
    c.lineTo(h + j(), h + j());
    c.lineTo(j(), h + j());
    c.lineTo(-h + j(), h + j());
    c.lineTo(-h + j(), j());
    c.closePath();
  };
  // ombre portée douce
  c.save();
  c.translate(s * 0.05, s * 0.07);
  quad();
  c.fillStyle = withAlpha(INK, 0.3);
  c.fill();
  c.restore();
  quad();
  c.fillStyle = PALETTE.vermillion;
  c.fill();
  c.strokeStyle = withAlpha('#7a1f12', 0.8);
  c.lineWidth = Math.max(0.8, s * 0.04);
  c.stroke();
  // cadre intérieur
  c.strokeStyle = withAlpha(PALETTE.cream, 0.85);
  c.lineWidth = Math.max(0.6, s * 0.045);
  c.strokeRect(-h * 0.8, -h * 0.8, h * 1.6, h * 1.6);
  c.fillStyle = PALETTE.cream;
  c.font = `800 ${Math.round(s * (kanji.length > 1 ? 0.4 : 0.66))}px "Shippori Mincho", serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  if (kanji.length > 1) {
    c.fillText(kanji[0], 0, -s * 0.19);
    c.fillText(kanji[1], 0, s * 0.21);
  } else c.fillText(kanji, 0, s * 0.03);
  // éclats d'usure du sceau
  c.fillStyle = withAlpha(PALETTE.cream, 0.6);
  for (let k = 0; k < 4; k++) {
    const side = Math.floor(rnd() * 4);
    const t = (rnd() - 0.5) * s * 0.8;
    const px = side < 2 ? t : side === 2 ? -h : h;
    const py = side < 2 ? (side ? h : -h) : t;
    c.beginPath();
    c.arc(px, py, s * (0.02 + rnd() * 0.03), 0, TAU);
    c.fill();
  }
  if (sealCache.size > 40) sealCache.clear();
  sealCache.set(key, L);
  return L;
}

// Liens d'encre entre les deux lanternes d'un combo + sceau (hanko) au centre.
export function drawComboLinks(ctx, game, ts, time) {
  if (!game.zones.length) return;
  const { m, sc } = scaleOf(ctx);
  const a0 = ctx.globalAlpha;
  for (const z of game.zones) {
    const a = game.towerById(z.a);
    const b = game.towerById(z.b);
    if (!a || !b) continue;
    const G = linkGeom(a, b, ts);
    const ca = ELEMENT_COLORS[a.type]?.main || PALETTE.gold;
    const cb = ELEMENT_COLORS[b.type]?.main || PALETTE.gold;
    const age = game.time - z.born;
    const pop = Math.min(1, age / 0.35);
    const L = linkSprite(`${G.ax},${G.ay},${G.bx},${G.by}|${ca}|${cb}|${ts}|${sc}`, G, ca, cb, ts, sc);
    ctx.globalAlpha = a0 * pop;
    blit(ctx, m, L, L.x, L.y);
    // l'énergie des deux lanternes coule vers le sceau
    for (let i = 0; i < 2; i++) {
      const u = (time * 0.8 + i * 0.5) % 1;
      const t = i ? 1 - u * 0.5 : u * 0.5;
      const v = 1 - t;
      const px = v * v * G.ax + 2 * v * t * G.mx + t * t * G.bx;
      const py = v * v * G.ay + 2 * v * t * G.my + t * t * G.by;
      const col = ELEMENT_COLORS[i ? b.type : a.type]?.light || PALETTE.goldLight;
      wash(ctx, px, py, ts * 0.13, col, Math.sin(u * Math.PI) * 0.9 * pop);
    }
    // sceau qui se pose comme un tampon (léger rebond)
    const s = Math.round(ts * 0.32);
    const S = sealSprite(z.def.kanji || '合', s, sc); // kanji facultatif dans les données
    const k = age < 0.35 ? 1.6 - easeOutBack(age / 0.35) * 0.6 : 1;
    ctx.globalAlpha = a0 * pop;
    if (k === 1) blit(ctx, m, S, G.sx - S.w / 2, G.sy - S.h / 2);
    else ctx.drawImage(S.c, G.sx - (S.w * k) / 2, G.sy - (S.h * k) / 2, S.w * k, S.h * k);
    // recharge des combos périodiques (Givre, Tornade) : arc autour du sceau
    const fx = z.def.effect;
    if (fx && (fx.kind === 'pulse' || fx.kind === 'tornado') && fx.interval) {
      const p = Math.min(1, z.timer / fx.interval);
      const r = s * 0.78;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.2, ts * 0.035);
      ctx.strokeStyle = withAlpha(INK, 0.35);
      ctx.beginPath();
      ctx.arc(G.sx, G.sy, r, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = p >= 1 ? withAlpha(PALETTE.goldLight, 0.75 + 0.25 * Math.sin(time * 6)) : mix(z.def.color, '#ffffff', 0.2);
      ctx.beginPath();
      ctx.arc(G.sx, G.sy, r, -Math.PI / 2, -Math.PI / 2 + p * TAU);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }
  ctx.globalAlpha = a0;
}

// Aperçu d'un combo pendant la pose : zone pointillée, lien d'encre lumineux et
// sceau qui palpitent, nom du combo sur une pastille lisible au-dessus du sceau.
// opts.dim : pose refusée (or insuffisant…) — même aperçu, en grisé.
export function drawComboPreview(ctx, a, b, def, ts, time, opts = {}) {
  const G = linkGeom(a, b, ts);
  const { sc } = scaleOf(ctx);
  const dim = !!opts.dim;
  const a0 = ctx.globalAlpha;
  const pulse = 0.75 + 0.25 * Math.sin(time * 5);
  const col = dim ? '#8a8578' : def.color || PALETTE.gold;
  ctx.globalAlpha = a0 * 0.75 * pulse;
  ctx.strokeStyle = mix(col, INK, 0.4);
  ctx.lineWidth = Math.max(1.2, ts * 0.035);
  ctx.lineCap = 'round';
  ctx.setLineDash([ts * 0.02, ts * 0.11]);
  ctx.lineDashOffset = -time * ts * 0.3;
  ctx.beginPath();
  ctx.arc((a.x + b.x) * 0.5 * ts, (a.y + b.y) * 0.5 * ts, (def.radius ?? 1.5) * ts, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  // trait d'encre lumineux : halo clair, corps d'encre, cœur à la couleur du combo
  const pts = quadPts(G.ax, G.ay, G.mx, G.my, G.bx, G.by, 14);
  const w = Math.max(2, ts * 0.065);
  ctx.globalAlpha = a0;
  if (!dim) brushStroke(ctx, pts, w * 3.4, withAlpha(PALETTE.goldLight, 0.32 + 0.18 * pulse), { taperIn: 0.4, taperOut: 0.4 });
  brushStroke(ctx, pts, w * 1.5, withAlpha(INK, dim ? 0.45 : 0.75), { taperIn: 0.3, taperOut: 0.3 });
  brushStroke(ctx, pts, w * 0.75, withAlpha(dim ? '#d9ccaa' : mix(col, '#ffffff', 0.35), 0.95), { taperIn: 0.35, taperOut: 0.35 });
  // étincelles qui courent le long du lien
  if (!dim) {
    for (let i = 0; i < 2; i++) {
      const t = (time * 0.9 + i * 0.5) % 1;
      const v = 1 - t;
      const px = v * v * G.ax + 2 * v * t * G.mx + t * t * G.bx;
      const py = v * v * G.ay + 2 * v * t * G.my + t * t * G.by;
      wash(ctx, px, py, ts * 0.16, PALETTE.goldLight, Math.sin(t * Math.PI) * 0.9);
    }
  }
  ctx.globalAlpha = a0 * (dim ? 0.55 : pulse);
  const S = sealSprite(def.kanji || '合', Math.round(ts * 0.34), sc);
  ctx.drawImage(S.c, G.sx - S.w / 2, G.sy - S.h / 2, S.w, S.h);
  ctx.globalAlpha = a0;
  nameTag(ctx, def.name, G.sx, G.sy - ts * 0.42, ts, dim ? 'muted' : 'combo');
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}

// Lien d'un combo existant pendant une fusion : 'lost' (rouge, barré : il
// disparaîtra) ou 'kept' (or : il reste, renforcé).
export function drawLinkPreview(ctx, a, b, def, ts, time, mode = 'kept') {
  const G = linkGeom(a, b, ts);
  const lost = mode === 'lost';
  const a0 = ctx.globalAlpha;
  const pulse = 0.8 + 0.2 * Math.sin(time * 6);
  const pts = quadPts(G.ax, G.ay, G.mx, G.my, G.bx, G.by, 14);
  const w = Math.max(2, ts * 0.07);
  ctx.globalAlpha = a0 * pulse;
  if (lost) {
    brushStroke(ctx, pts, w * 1.6, withAlpha(INK, 0.7), { taperIn: 0.2, taperOut: 0.2 });
    ctx.save();
    ctx.setLineDash([ts * 0.1, ts * 0.08]);
    ctx.strokeStyle = PALETTE.vermillion;
    ctx.lineWidth = w * 0.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
    ctx.restore();
    // le lien est barré d'une croix au pinceau
    const s = ts * 0.2;
    brushStroke(ctx, [[G.sx - s, G.sy - s], [G.sx + s, G.sy + s]], w * 1.1, PALETTE.vermillion, { taperIn: 0.1, taperOut: 0.5 });
    brushStroke(ctx, [[G.sx + s, G.sy - s], [G.sx - s, G.sy + s]], w, PALETTE.vermillion, { taperIn: 0.1, taperOut: 0.5 });
  } else {
    brushStroke(ctx, pts, w * 3, withAlpha(PALETTE.goldLight, 0.4), { taperIn: 0.4, taperOut: 0.4 });
    brushStroke(ctx, pts, w * 1.4, withAlpha(INK, 0.7), { taperIn: 0.3, taperOut: 0.3 });
    brushStroke(ctx, pts, w * 0.8, PALETTE.gold, { taperIn: 0.3, taperOut: 0.3 });
  }
  ctx.globalAlpha = a0;
  nameTag(ctx, def.name, G.sx, G.sy - ts * 0.45, ts, lost ? 'lost' : 'kept');
}

// Nom de combo sur une pastille crème cernée d'encre (texte ≥ 12 px) ;
// 'lost' : barré en vermillon.
function nameTag(ctx, text, x, y, ts, tone) {
  const size = Math.max(12, Math.round(ts * 0.29));
  ctx.save();
  ctx.font = `800 ${size}px "Shippori Mincho", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 12;
  const h = size + 8;
  const x0 = x - w / 2;
  const y0 = y - h / 2;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x0, y0, w, h, h / 2);
  else ctx.rect(x0, y0, w, h);
  ctx.fillStyle = tone === 'kept' ? PALETTE.goldLight : withAlpha(PALETTE.cream, 0.96);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = tone === 'muted' ? '#4a463e' : tone === 'kept' ? INK : '#a8321f';
  ctx.fillText(text, x, y + 0.5);
  if (tone === 'lost') {
    ctx.strokeStyle = '#a8321f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0 + 5, y + 1);
    ctx.lineTo(x0 + w - 5, y + 1);
    ctx.stroke();
  }
  ctx.restore();
}

// ───────────────────────── tornade de flammes ─────────────────────────

// Le tourbillon est rendu par images pré-rendues (ses anneaux tournent tous à la
// même vitesse : 16 images couvrent un tour), copiées telles quelles à chaque frame.
const TORNADO_FRAMES = 16;
const tornadoFrames = new Map();
function tornadoFrame(ts, size, sc, i) {
  const key = `${ts}|${size}|${sc}`;
  let frames = tornadoFrames.get(key);
  if (!frames) {
    frames = new Array(TORNADO_FRAMES);
    if (tornadoFrames.size > 4) tornadoFrames.clear(); // anciennes tailles (rotation, baisse de qualité)
    tornadoFrames.set(key, frames);
  }
  if (frames[i]) return frames[i];
  const h = ts;
  const L = layer(-ts * 0.62, -h - ts * 0.3, ts * 1.24, h + ts * 0.62, sc);
  const c = L.g;
  // brûlure au sol et lueur du tourbillon
  wash(c, 0, ts * 0.05, ts * 0.5, '#8c2414', 0.35);
  wash(c, 0, -h * 0.45, ts * 0.55, '#ff8a3c', 0.3);
  const N = 7;
  const base = (i / TORNADO_FRAMES) * TAU;
  // passe d'encre (contour), puis passe de feu (du vermillon à l'or vers le haut)
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < N; k++) {
      const f = k / (N - 1);
      const w = ts * (0.1 + f * 0.36) * size;
      const yy = -f * h;
      const lw = Math.max(1.4, ts * 0.055 * (1 - f * 0.4));
      if (pass === 0) {
        c.strokeStyle = withAlpha('#5a1a10', 0.55);
        c.lineWidth = lw + Math.max(1.2, ts * 0.03);
      } else {
        c.strokeStyle = k % 2 ? mix('#ff9a3c', PALETTE.goldLight, f) : mix(PALETTE.vermillion, '#ffb35c', f);
        c.lineWidth = lw;
      }
      const s0 = base + k * 0.8;
      c.beginPath();
      c.ellipse(Math.sin(f * 3) * ts * 0.05 * f, yy, w, w * 0.3, 0, s0, s0 + Math.PI * 1.3);
      c.stroke();
    }
  }
  frames[i] = L;
  return L;
}

export function drawTornado(ctx, t, ts, time) {
  const x = t.x * ts;
  const y = t.y * ts;
  const k = Math.max(0, Math.min(1, t.life / 0.4, (t.max - t.life) / 0.3 + 0.2));
  const size = Math.round(t.size * 1.6 * 20) / 20;
  const { sc } = scaleOf(ctx);
  const turn = (time * 12) / TAU;
  const F = tornadoFrame(ts, size, sc, Math.floor((turn - Math.floor(turn)) * TORNADO_FRAMES) % TORNADO_FRAMES);
  const sway = Math.sin(time * 3.5) * ts * 0.04;
  const a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * k;
  ctx.drawImage(F.c, x + F.x + sway, y + F.y, F.w, F.h);
  // langues de flamme au sommet
  const top = y - ts;
  for (let i = 0; i < 2; i++) {
    const dx = (i ? 1 : -1) * ts * 0.12 * size;
    const sw = Math.sin(time * 9 + i * 2) * ts * 0.06;
    brushStroke(ctx, quadPts(x + dx + sway, top + ts * 0.08, x + dx * 1.4 + sw + sway, top - ts * 0.12, x + dx * 0.6 + sw * 1.5 + sway, top - ts * 0.3, 6), ts * 0.08, withAlpha('#ffb35c', 0.85), { taperIn: 0.1, taperOut: 0.9 });
  }
  ctx.globalAlpha = a0;
}

// ───────────────────────── pierres ─────────────────────────

const stoneCache = new Map();

// Galet posé : ombre douce, lavis gris, reflet, coussin de mousse, trait d'encre.
function stoneSprite(seed, ts, sc, snow) {
  const key = `${seed}|${ts}|${sc}|${snow ? 1 : 0}`;
  let S = stoneCache.get(key);
  if (S) return S;
  const rnd = seeded(seed);
  const r = ts * 0.36;
  const L = layer(-r * 1.5, -r * 1.3, r * 3, r * 2.3, sc);
  const c = L.g;
  wash(c, r * 0.1, r * 0.6, r * 1.25, INK, 0.35);
  c.fillStyle = withAlpha(INK, 0.22);
  c.beginPath();
  c.ellipse(r * 0.12, r * 0.55, r * 1.1, r * 0.36, 0, 0, TAU);
  c.fill();
  const j = () => (rnd() - 0.5) * r * 0.25;
  const body = new Path2D();
  body.moveTo(-r + j(), r * 0.45);
  body.quadraticCurveTo(-r * 1.05 + j(), -r * 0.5 + j(), -r * 0.15 + j(), -r * 0.85 + j());
  body.quadraticCurveTo(r * 0.85 + j(), -r * 0.9 + j(), r + j(), r * 0.45);
  body.quadraticCurveTo(0, r * 0.7, -r, r * 0.45);
  body.closePath();
  const gr = c.createLinearGradient(-r, -r, r, r);
  gr.addColorStop(0, '#a8a497');
  gr.addColorStop(1, '#77736a');
  c.fillStyle = gr;
  c.fill(body);
  c.save();
  c.clip(body);
  wash(c, r * 0.5, r * 0.5, r * 0.9, PALETTE.stoneDark, 0.45);
  if (snow) {
    // calotte de neige (comme les rochers du terrain enneigé), découpée dans la pierre
    c.beginPath();
    c.moveTo(-r * 1.2, -r * 1.2);
    c.lineTo(r * 1.2, -r * 1.2);
    c.lineTo(r * 1.2, -r * 0.22);
    c.quadraticCurveTo(r * 0.5, -r * 0.4, r * 0.15, -r * 0.24);
    c.quadraticCurveTo(-r * 0.3, -r * 0.08, -r * 1.2, -r * 0.3);
    c.closePath();
    c.fillStyle = '#f6f8f8';
    c.fill();
    brushStroke(c, quadPts(r * 0.9, -r * 0.26, r * 0.4, -r * 0.42, r * 0.1, -r * 0.24, 8), r * 0.07, withAlpha('#7d93ab', 0.7));
  }
  c.restore();
  c.strokeStyle = INK;
  c.lineWidth = Math.max(1, ts * 0.04);
  c.stroke(body);
  c.fillStyle = withAlpha('#ffffff', 0.2);
  c.beginPath();
  c.ellipse(-r * 0.3, -r * 0.4, r * 0.35, r * 0.15, -0.4, 0, TAU);
  c.fill();
  if (!snow) {
    c.fillStyle = withAlpha(PALETTE.moss, 0.95);
    c.beginPath();
    c.ellipse(r * 0.2, -r * 0.62, r * 0.34, r * 0.13, 0.2, 0, TAU);
    c.fill();
    c.fillStyle = withAlpha(PALETTE.mossDark, 0.8);
    c.beginPath();
    c.ellipse(r * 0.28, -r * 0.58, r * 0.16, r * 0.06, 0.2, 0, TAU);
    c.fill();
  }
  brushStroke(c, [[-r * 0.1, -r * 0.3], [r * 0.15, 0], [r * 0.05, r * 0.3]], r * 0.14, withAlpha(INK, 0.45));
  if (stoneCache.size > 40) stoneCache.clear();
  stoneCache.set(key, L);
  return L;
}

// snow (facultatif) : calotte de neige au lieu de la mousse (monde enneigé).
export function drawStone(ctx, x, y, ts, seed, snow = false) {
  const { m, sc } = scaleOf(ctx);
  const S = stoneSprite(seed, ts, sc, snow);
  blit(ctx, m, S, x + S.x, y + S.y);
}

function easeOutBack(k) {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
}

// Sceau (hanko) isolé, centré en (x, y) : taille en px du repère courant.
export function drawSeal(ctx, x, y, size, kanji) {
  const { sc } = scaleOf(ctx);
  const S = sealSprite(kanji, Math.round(size), sc);
  ctx.drawImage(S.c, x - S.w / 2, y - S.h / 2, S.w, S.h);
}
