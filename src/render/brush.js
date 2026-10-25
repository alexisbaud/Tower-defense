// Outils de dessin « pinceau et encre » partagés par les modules de rendu.

// ctx.roundRect n'existe que depuis Safari 16 (iPhone 6s, 7, SE de 1re génération :
// iOS 15 au plus). Les lanternes, l'écran titre et la carte s'en servent : sans lui,
// aucun niveau ne s'affichait. Repli installé une fois, pour tous les canvas (y compris
// hors écran) : rectangle aux coins arrondis par arcTo, nouveau sous-chemin fermé.
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii = 0) {
    const list = Array.isArray(radii) ? radii : [radii];
    const rad = list.map((v) => Math.max(0, (typeof v === 'object' ? v?.x : v) || 0));
    // 1 à 4 rayons, comme l'API : [tous] · [hg+bd, hd+bg] · [hg, hd+bg, bd] · [hg, hd, bd, bg]
    const [tl, tr, br, bl] = rad.length >= 4 ? rad : rad.length === 3 ? [rad[0], rad[1], rad[2], rad[1]] : rad.length === 2 ? [rad[0], rad[1], rad[0], rad[1]] : [rad[0] ?? 0, rad[0] ?? 0, rad[0] ?? 0, rad[0] ?? 0];
    if (w < 0) {
      x += w;
      w = -w;
    }
    if (h < 0) {
      y += h;
      h = -h;
    }
    // rayons réduits ensemble s'ils dépassent les côtés
    const k = Math.min(1, w / (tl + tr || 1), w / (bl + br || 1), h / (tl + bl || 1), h / (tr + br || 1));
    this.moveTo(x + tl * k, y);
    this.arcTo(x + w, y, x + w, y + h, tr * k);
    this.arcTo(x + w, y + h, x, y + h, br * k);
    this.arcTo(x, y + h, x, y, bl * k);
    this.arcTo(x, y, x + w, y, tl * k);
    this.closePath();
    this.moveTo(x, y);
  };
}

export const INK = '#1d1b22';
export const PALETTE = {
  ink: '#1d1b22',
  indigo: '#1f2f4f',
  indigoLight: '#3b5280',
  vermillion: '#c8402a',
  cream: '#f2e8d0',
  moss: '#6f7f3c',
  mossDark: '#4a5628',
  gold: '#c99a2e',
  goldLight: '#f0cf6a',
  stone: '#9a968a',
  stoneDark: '#5d5a52',
};

// Pseudo-aléatoire déterministe à partir d'une graine (pour des tracés stables).
export function seeded(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// Trait de pinceau : épaisseur variable le long d'une polyligne (début/fin effilés).
export function brushStroke(ctx, pts, width, color, opts = {}) {
  if (pts.length < 2) return;
  const taperIn = opts.taperIn ?? 0.25;
  const taperOut = opts.taperOut ?? 0.35;
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha *= opts.alpha ?? 1;
  const left = [];
  const right = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const k = i / (n - 1);
    let w = width;
    if (k < taperIn) w *= 0.25 + 0.75 * (k / taperIn);
    if (k > 1 - taperOut) w *= 0.15 + 0.85 * ((1 - k) / taperOut);
    if (opts.pressure) w *= opts.pressure(k);
    left.push([p[0] - dy * w * 0.5, p[1] + dx * w * 0.5]);
    right.push([p[0] + dy * w * 0.5, p[1] - dx * w * 0.5]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Courbe de Bézier quadratique échantillonnée en points (pour brushStroke).
export function quadPts(x0, y0, cx, cy, x1, y1, steps = 12) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1]);
  }
  return out;
}

// Cercle irrégulier « à l'encre » (contour tremblé).
export function inkCircle(ctx, x, y, r, rnd, wobble = 0.08, steps = 18) {
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = r * (1 + (rnd() - 0.5) * wobble * 2);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// Tache d'encre diluée (lavis) : dégradé radial doux. Le dégradé est
// pré-rendu une fois par couleur dans un petit sprite, puis simplement étiré :
// beaucoup plus rapide que createRadialGradient à chaque appel.
const washSprites = new Map();
function washSprite(color) {
  let c = washSprites.get(color);
  if (c) return c;
  c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, withAlpha(color, 1));
  grad.addColorStop(0.5, withAlpha(color, 0.5));
  grad.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  if (washSprites.size > 200) washSprites.clear();
  washSprites.set(color, c);
  return c;
}

export function wash(ctx, x, y, r, color, alpha = 0.25) {
  if (alpha <= 0.004 || r <= 0) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * Math.min(1, alpha);
  ctx.drawImage(washSprite(color), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = prev;
}

const alphaCache = new Map();
export function withAlpha(hex, a) {
  const key = hex + a.toFixed(3);
  let v = alphaCache.get(key);
  if (v) return v;
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  v = `rgba(${r},${g},${b},${a})`;
  if (alphaCache.size > 4000) alphaCache.clear();
  alphaCache.set(key, v);
  return v;
}

export function mix(hexA, hexB, t) {
  const a = hexA.replace('#', '');
  const b = hexB.replace('#', '');
  const ch = (s, o) => parseInt(s.slice(o, o + 2), 16);
  const r = Math.round(ch(a, 0) + (ch(b, 0) - ch(a, 0)) * t);
  const g = Math.round(ch(a, 2) + (ch(b, 2) - ch(a, 2)) * t);
  const bl = Math.round(ch(a, 4) + (ch(b, 4) - ch(a, 4)) * t);
  return '#' + [r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
