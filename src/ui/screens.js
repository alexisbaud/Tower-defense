// Écrans de menu : titre animé et carte de sélection des niveaux.
// Le module installe aussi les textures de l'interface DOM (papier washi,
// traits d'encre), peintes une seule fois en Canvas 2D.
import { makePaper } from '../render/paper.js';
import { INK, PALETTE, withAlpha, wash, brushStroke, quadPts, seeded, mix, makeCanvas } from '../render/brush.js';
import { drawPine, drawTorii } from '../render/terrain.js';

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const PAPER = '#efe4c8';

function fitCanvas(canvas) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const r = canvas.parentElement.getBoundingClientRect();
  const w = Math.max(1, r.width);
  const h = Math.max(1, r.height);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  return { w, h, dpr };
}

// Les polices web arrivent après le premier rendu : on recompose alors les
// écrans dont la mise en page dépend de la taille du texte.
function onFontsReady(fn) {
  document.fonts?.ready?.then(fn).catch(() => {});
}

// ───────────────────────── Textures de l'interface ─────────────────────────

// Tuile de washi transparente (grain + fibres de kozo), raccordable : elle se
// superpose à n'importe quel aplat CSS (crème, indigo, vermillon).
function washiTile(n = 256) {
  const c = makeCanvas(n, n);
  const g = c.getContext('2d');
  const rnd = seeded(41);
  const img = g.createImageData(n, n);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = rnd() - 0.5;
    const a = Math.abs(v) * 2;
    const dark = v < 0;
    d[i] = dark ? 70 : 255;
    d[i + 1] = dark ? 52 : 250;
    d[i + 2] = dark ? 30 : 236;
    d[i + 3] = Math.round(a * a * a * (dark ? 46 : 60));
  }
  g.putImageData(img, 0, 0);
  // fibres : chaque trait est répété aux 8 voisins pour raccorder la tuile
  g.lineCap = 'round';
  for (let k = 0; k < 22; k++) {
    const x = rnd() * n;
    const y = rnd() * n;
    const len = 14 + rnd() * 46;
    const a = rnd() * Math.PI * 2;
    const bend = (rnd() - 0.5) * len * 0.6;
    const light = rnd() < 0.7;
    g.strokeStyle = light ? 'rgba(255,250,236,0.2)' : 'rgba(80,60,34,0.08)';
    g.lineWidth = 0.4 + rnd() * 0.7;
    for (let ox = -n; ox <= n; ox += n) {
      for (let oy = -n; oy <= n; oy += n) {
        const x0 = x + ox;
        const y0 = y + oy;
        const x1 = x0 + Math.cos(a) * len;
        const y1 = y0 + Math.sin(a) * len;
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo((x0 + x1) / 2 - Math.sin(a) * bend, (y0 + y1) / 2 + Math.cos(a) * bend, x1, y1);
        g.stroke();
      }
    }
  }
  return c;
}

// Trait de pinceau horizontal avec frottis (kasure) : séparateurs, bordures.
function strokeImage(w, h, color, seed, opts = {}) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const rnd = seeded(seed);
  const pts = [];
  const n = 40;
  const mid = h / 2;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    pts.push([k * w, mid + Math.sin(k * Math.PI * (opts.waves ?? 1.3) + seed) * h * (opts.wobble ?? 0.06)]);
  }
  brushStroke(g, pts, h * (opts.width ?? 0.62), color, {
    taperIn: opts.taperIn ?? 0.12,
    taperOut: opts.taperOut ?? 0.22,
    pressure: (k) => 0.82 + Math.sin(k * 9 + seed) * 0.1 + Math.sin(k * 23) * 0.06,
  });
  // frottis : stries claires qui laissent voir le papier
  g.globalCompositeOperation = 'destination-out';
  g.lineCap = 'round';
  for (let i = 0; i < (opts.streaks ?? 16); i++) {
    const y = mid + (rnd() - 0.5) * h * (opts.width ?? 0.62) * 0.8;
    const x0 = w * (0.25 + rnd() * 0.75);
    const x1 = Math.min(w, x0 + w * (0.05 + rnd() * 0.3));
    g.strokeStyle = `rgba(0,0,0,${0.25 + rnd() * 0.5})`;
    g.lineWidth = 0.6 + rnd() * h * 0.035;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y + (rnd() - 0.5) * 2);
    g.stroke();
  }
  return c;
}

// Bordure d'encre irrégulière (bord de bandeau) : un trait plein presque sans
// effilement, d'épaisseur variable.
function edgeImage(w, h, color, seed) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const rnd = seeded(seed);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, 0);
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * w;
    const y = h * (0.42 + Math.sin(i * 0.7 + seed) * 0.12 + rnd() * 0.16);
    g.lineTo(x, y);
  }
  g.lineTo(w, 0);
  g.closePath();
  g.fill();
  return c;
}

let texturesInstalled = false;
export function installUiTextures() {
  if (texturesInstalled || typeof document === 'undefined') return;
  texturesInstalled = true;
  try {
    const st = document.documentElement.style;
    const url = (cv) => `url(${cv.toDataURL('image/png')})`;
    st.setProperty('--washi', url(washiTile()));
    st.setProperty('--stroke-ink', url(strokeImage(480, 22, INK, 3)));
    st.setProperty('--stroke-red', url(strokeImage(480, 22, PALETTE.vermillion, 7)));
    st.setProperty('--stroke-gold', url(strokeImage(480, 22, PALETTE.gold, 5)));
    st.setProperty('--band', url(strokeImage(720, 120, PALETTE.indigo, 11, { width: 0.78, wobble: 0.04, streaks: 30, taperIn: 0.06, taperOut: 0.12 })));
    st.setProperty('--edge', url(edgeImage(900, 10, INK, 2)));
  } catch {
    /* textures facultatives : l'interface reste lisible sans elles */
  }
}
installUiTextures();

// ───────────────────────── Motifs d'estampe ─────────────────────────

// Bande de brume stylisée (suyari-gasumi) : aplat crème cerné d'un trait fin.
function kasumi(ctx, x, y, w, h, color = '#f6eedb', alpha = 0.96) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.strokeStyle = withAlpha(INK, 0.22);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// Ligne de crêtes (collines arrondies ou pics) entre x0 et x1.
function ridge(rnd, x0, x1, base, amp, minW, maxW, pointy = false) {
  const pts = [[x0, base]];
  let x = x0;
  while (x < x1) {
    const pw = minW + rnd() * (maxW - minW);
    const ph = amp * (0.45 + rnd() * 0.55);
    if (pointy) {
      pts.push([x + pw * (0.42 + rnd() * 0.16), base - ph]);
      pts.push([x + pw, base - ph * (0.15 + rnd() * 0.25)]);
    } else {
      for (let s = 1; s <= 6; s++) {
        const k = s / 6;
        pts.push([x + pw * k, base - ph * Math.sin(k * Math.PI) - (rnd() - 0.5) * amp * 0.04]);
      }
    }
    x += pw;
  }
  return pts;
}

function fillRidge(ctx, pts, bottom, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], bottom);
  for (const p of pts) ctx.lineTo(p[0], p[1]);
  ctx.lineTo(pts[pts.length - 1][0], bottom);
  ctx.closePath();
  ctx.fill();
}

// Petite lanterne de pierre (kasuga-dōrō) à l'encre, fenêtre dorée.
// Renvoie la position de la fenêtre (pour la lueur animée).
function drawStoneLantern(ctx, x, y, s) {
  const ink = INK;
  const stone = '#5d5a52';
  const lw = Math.max(1, s * 0.04);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink;
  ctx.lineWidth = lw;
  // ombre douce
  ctx.fillStyle = withAlpha(ink, 0.22);
  ctx.beginPath();
  ctx.ellipse(x + s * 0.06, y, s * 0.42, s * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  const part = (x0, y0, w0, h0, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.rect(x - w0 / 2 + x0, y0, w0, h0);
    ctx.fill();
    ctx.stroke();
  };
  part(0, y - s * 0.12, s * 0.62, s * 0.12, stone); // socle
  part(0, y - s * 0.62, s * 0.16, s * 0.5, mix(stone, '#9a968a', 0.3)); // fût
  part(0, y - s * 0.72, s * 0.5, s * 0.1, stone); // plateau
  // chambre de lumière
  const wy = y - s * 1.02;
  ctx.fillStyle = mix(stone, '#9a968a', 0.3);
  ctx.beginPath();
  ctx.rect(x - s * 0.22, wy, s * 0.44, s * 0.3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = PALETTE.goldLight;
  ctx.fillRect(x - s * 0.11, wy + s * 0.06, s * 0.22, s * 0.18);
  ctx.fillStyle = withAlpha(PALETTE.vermillion, 0.55);
  ctx.fillRect(x - s * 0.11, wy + s * 0.17, s * 0.22, s * 0.07);
  // toit courbe
  ctx.fillStyle = mix(stone, ink, 0.35);
  ctx.beginPath();
  ctx.moveTo(x - s * 0.48, wy + s * 0.02);
  ctx.quadraticCurveTo(x - s * 0.2, wy - s * 0.06, x, wy - s * 0.22);
  ctx.quadraticCurveTo(x + s * 0.2, wy - s * 0.06, x + s * 0.48, wy + s * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // fleuron
  ctx.fillStyle = stone;
  ctx.beginPath();
  ctx.arc(x, wy - s * 0.27, s * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  return { x, y: wy + s * 0.15 };
}

// Pétale (couleur unique, précalculée).
const PETAL = withAlpha(mix(PALETTE.cream, PALETTE.vermillion, 0.32), 0.92);
const PETAL_DARK = withAlpha(mix(PALETTE.cream, PALETTE.vermillion, 0.55), 0.92);

// ───────────────────────── Titre ─────────────────────────

export class TitleScreen {
  constructor(el) {
    this.el = el;
    this.canvas = el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.petals = [];
    this.wisps = [];
    this.running = false;
    this.t = 0;
    this.scene = null;
    onFontsReady(() => this.resize());
  }

  show() {
    this.el.classList.add('active');
    this.resize();
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame((n) => this.frame(n));
    }
  }

  hide() {
    this.el.classList.remove('active');
    this.running = false;
  }

  resize() {
    if (!this.el.classList.contains('active')) return;
    const { w, h, dpr } = fitCanvas(this.canvas);
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.bg = this.paint(w, h, dpr);
  }

  // Mise en page de la scène : tout se cale entre le bas du titre et le haut
  // des boutons — ou du salon, s'il est affiché au-dessus d'eux —, pour que le
  // soleil ne passe jamais sous le texte et que le torii reste visible.
  layoutScene(w, h) {
    const box = this.el.getBoundingClientRect();
    const tw = this.el.querySelector('.title-wrap')?.getBoundingClientRect();
    const lobby = this.el.querySelector('.title-lobby')?.getBoundingClientRect();
    const act = lobby && lobby.height ? lobby : this.el.querySelector('.title-actions')?.getBoundingClientRect();
    const tb = tw && tw.height ? tw.bottom - box.top : h * 0.32;
    const kj = this.el.querySelector('.title-kanji')?.getBoundingClientRect();
    const skyH = kj && kj.height ? kj.bottom - box.top + 26 : h * 0.12;
    const ab = act && act.height ? act.top - box.top : h * 0.86;
    const span = Math.max(h * 0.3, ab - tb);
    const at = (k) => tb + span * k;
    const sunR = Math.min(w * 0.19, span * 0.16);
    return {
      tb,
      ab,
      skyH,
      span,
      at,
      sun: { x: w * 0.68, y: tb + sunR + Math.max(10, span * 0.05), r: sunR },
      fuji: { cx: w * 0.3, peak: tb + sunR * 0.95 + span * 0.05, base: at(0.62), hw: w * 0.8 },
      midBase: at(0.62),
      nearBase: at(0.73),
      lake: [at(0.705), at(0.81)],
      ground: at(0.79),
      ts: Math.min(w * 0.22, span * 0.25),
    };
  }

  // Décor statique : bokashi d'indigo, soleil vermillon, Fuji enneigé, collines
  // à l'encre, lac, colline de mousse, torii et lanternes de pierre.
  paint(w, h, dpr) {
    const c = makePaper(w, h, dpr, PAPER, 11);
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const rnd = seeded(5);
    const S = this.layoutScene(w, h);
    this.scene = S;

    // ciel : bandeau d'indigo dégradé en haut (bokashi), typique des
    // estampes ; il s'arrête sous le kanji, avant le titre noir
    const sky = S.skyH;
    let g = ctx.createLinearGradient(0, 0, 0, sky);
    g.addColorStop(0, withAlpha(PALETTE.indigo, 0.95));
    g.addColorStop(0.55, withAlpha(PALETTE.indigo, 0.72));
    g.addColorStop(1, withAlpha(PALETTE.indigo, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, sky);

    // soleil : disque plat, halo doré très doux
    const { sun } = S;
    wash(ctx, sun.x, sun.y, sun.r * 2.1, PALETTE.goldLight, 0.35);
    ctx.fillStyle = PALETTE.vermillion;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, sun.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = withAlpha('#e2603f', 0.55);
    ctx.beginPath();
    ctx.arc(sun.x - sun.r * 0.12, sun.y - sun.r * 0.12, sun.r * 0.78, 0, Math.PI * 2);
    ctx.fill();

    // Fuji : pentes concaves, sommet plat, calotte de neige dentelée
    const F = S.fuji;
    const fujiY = (x) => {
      const d = Math.min(1, Math.abs(x - F.cx) / F.hw);
      if (d < 0.07) return F.peak + (F.base - F.peak) * d * 0.15;
      return F.peak + (F.base - F.peak) * (0.0105 + Math.pow((d - 0.07) / 0.93, 0.62) * 0.99);
    };
    const fpts = [];
    for (let i = 0; i <= 64; i++) {
      const x = F.cx - F.hw + (i / 64) * F.hw * 2;
      fpts.push([x, fujiY(x)]);
    }
    fillRidge(ctx, fpts, F.base + 4, mix('#5b6f95', PAPER, 0.42));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(fpts[0][0], F.base);
    for (const p of fpts) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(fpts[fpts.length - 1][0], F.base);
    ctx.closePath();
    ctx.clip();
    const snowY = F.peak + (F.base - F.peak) * 0.3;
    ctx.fillStyle = '#f8f3e6';
    ctx.beginPath();
    ctx.moveTo(F.cx - F.hw, F.peak - 10);
    ctx.lineTo(F.cx + F.hw, F.peak - 10);
    const teeth = 14;
    for (let i = 0; i <= teeth; i++) {
      const x = F.cx + F.hw * 0.6 - (i / teeth) * F.hw * 1.2;
      const deep = i % 2 ? (F.base - F.peak) * (0.05 + rnd() * 0.08) : 0;
      ctx.lineTo(x, snowY + deep - (F.base - F.peak) * 0.03 * Math.abs(i - teeth / 2) / (teeth / 2));
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // arêtes d'encre sur les pentes
    const left = fpts.filter((p) => p[0] <= F.cx - F.hw * 0.05 && p[0] > F.cx - F.hw * 0.62).reverse();
    const right = fpts.filter((p) => p[0] >= F.cx + F.hw * 0.05 && p[0] < F.cx + F.hw * 0.62);
    brushStroke(ctx, left, 2.2, withAlpha(INK, 0.55), { taperIn: 0.05, taperOut: 0.6 });
    brushStroke(ctx, right, 2.2, withAlpha(INK, 0.55), { taperIn: 0.05, taperOut: 0.6 });

    // brume (suyari-gasumi) en travers du bas du soleil et du flanc du Fuji
    kasumi(ctx, sun.x - sun.r * 1.3, sun.y + sun.r * 0.42, w - sun.x + sun.r * 1.3 + 20, Math.max(8, sun.r * 0.2));
    kasumi(ctx, sun.x - sun.r * 0.7, sun.y + sun.r * 0.86, w, Math.max(7, sun.r * 0.16));
    kasumi(ctx, -20, F.peak + (F.base - F.peak) * 0.62, w * 0.42, Math.max(7, sun.r * 0.17));

    // collines intermédiaires puis proches, cernées d'un trait d'encre
    const mid = ridge(rnd, -10, w + 40, S.midBase, S.span * 0.1, w * 0.22, w * 0.4);
    fillRidge(ctx, mid, S.lake[0] + 4, mix('#3b5280', PAPER, 0.18));
    brushStroke(ctx, mid, 1.6, withAlpha(INK, 0.4), { taperIn: 0.02, taperOut: 0.02 });
    // brume au pied des collines
    g = ctx.createLinearGradient(0, S.midBase - S.span * 0.05, 0, S.nearBase);
    g.addColorStop(0, withAlpha(PAPER, 0));
    g.addColorStop(1, withAlpha(PAPER, 0.7));
    ctx.fillStyle = g;
    ctx.fillRect(0, S.midBase - S.span * 0.05, w, S.nearBase - S.midBase + S.span * 0.05);
    const near = ridge(rnd, -10, w + 40, S.nearBase, S.span * 0.1, w * 0.14, w * 0.28);
    fillRidge(ctx, near, S.lake[0] + 6, PALETTE.indigo);
    brushStroke(ctx, near, 1.8, withAlpha(INK, 0.6), { taperIn: 0.02, taperOut: 0.02 });

    // lac : aplat indigo, rides crème, reflet du soleil en traits vermillon
    const [ly0, ly1] = S.lake;
    ctx.fillStyle = '#2d4270';
    ctx.fillRect(0, ly0, w, ly1 - ly0 + 8);
    for (let i = 0; i < 16; i++) {
      const y = ly0 + 4 + rnd() * (ly1 - ly0 - 6);
      const x = rnd() * w;
      const len = 14 + rnd() * 40;
      brushStroke(ctx, [[x, y], [x + len * 0.5, y - 0.6], [x + len, y]], 1.6, withAlpha(PALETTE.cream, 0.35));
    }
    for (let i = 0; i < 5; i++) {
      const y = ly0 + 5 + i * ((ly1 - ly0) / 6);
      const len = sun.r * (1.2 - i * 0.18);
      brushStroke(ctx, [[sun.x - len / 2, y], [sun.x, y + 0.8], [sun.x + len / 2, y]], 2.4 - i * 0.25, withAlpha(PALETTE.vermillion, 0.7 - i * 0.1));
    }

    // colline de mousse au premier plan
    const gy = S.ground;
    ctx.fillStyle = '#5d6b30';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, gy + S.span * 0.03);
    ctx.quadraticCurveTo(w * 0.5, gy - S.span * 0.05, w, gy + S.span * 0.04);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    brushStroke(ctx, quadPts(0, gy + S.span * 0.03, w * 0.5, gy - S.span * 0.05, w, gy + S.span * 0.04, 24), 2.2, withAlpha(INK, 0.55), { taperIn: 0.05, taperOut: 0.05 });
    g = ctx.createLinearGradient(0, gy, 0, h);
    g.addColorStop(0, withAlpha(PALETTE.mossDark, 0));
    g.addColorStop(1, withAlpha('#2f3a1c', 0.85));
    ctx.fillStyle = g;
    ctx.fillRect(0, gy, w, h - gy);
    // touffes de mousse
    for (let i = 0; i < 26; i++) {
      const x = rnd() * w;
      const y = gy + S.span * 0.04 + rnd() * (h - gy) * 0.5;
      brushStroke(ctx, [[x, y], [x + 3, y - 5], [x + 6, y - 8]], 1.6, withAlpha(PALETTE.moss, 0.9));
      brushStroke(ctx, [[x + 2, y], [x + 1, y - 7]], 1.4, withAlpha('#2f3a1c', 0.6));
    }

    // allée de gravier jusqu'au torii (perspective)
    const ts = S.ts;
    const toriiBase = gy + S.span * 0.005;
    ctx.fillStyle = '#e8dcbc';
    ctx.beginPath();
    ctx.moveTo(w * 0.5 - ts * 0.3, toriiBase);
    ctx.lineTo(w * 0.5 + ts * 0.3, toriiBase);
    ctx.lineTo(w * 0.5 + w * 0.32, h + 2);
    ctx.lineTo(w * 0.5 - w * 0.32, h + 2);
    ctx.closePath();
    ctx.fill();
    for (const s of [-1, 1]) {
      brushStroke(ctx, [[w * 0.5 + s * ts * 0.3, toriiBase], [w * 0.5 + s * w * 0.32, h + 2]], 2, withAlpha(INK, 0.5), { taperIn: 0.3, taperOut: 0 });
    }
    // ratissage
    for (let i = 1; i < 9; i++) {
      const k = i / 9;
      const y = toriiBase + (h - toriiBase) * k * k;
      const hw = ts * 0.3 + (w * 0.32 - ts * 0.3) * k * k;
      brushStroke(ctx, [[w * 0.5 - hw * 0.9, y], [w * 0.5 + hw * 0.9, y]], 0.9 + k, withAlpha('#b8a77f', 0.55), { taperIn: 0.2, taperOut: 0.2 });
    }

    drawTorii(ctx, w * 0.5, toriiBase - ts * 0.32, ts);
    const th = { grass: '#7d8a4a', grassDark: '#2f3a1c', snowCaps: false };
    drawPine(ctx, w * 0.1, S.at(0.9), ts * 0.95, rnd, th);
    drawPine(ctx, w * 0.9, S.at(0.93), ts * 1.1, rnd, th);
    // lanternes de pierre de part et d'autre de l'allée
    const ls = ts * 0.5;
    this.lights = [
      drawStoneLantern(ctx, w * 0.5 - ts * 0.95, S.at(0.9), ls),
      drawStoneLantern(ctx, w * 0.5 + ts * 0.95, S.at(0.9), ls),
    ];
    return c;
  }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const { ctx, w, h, dpr, t } = this;
    if (!this.bg) return requestAnimationFrame((n) => this.frame(n));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = this.scene;

    // lueurs : torii et lanternes de pierre (sprites de lavis en cache)
    if (S) {
      wash(ctx, w * 0.5, S.ground - S.ts * 0.5, S.ts * 1.1, PALETTE.goldLight, 0.16 + Math.sin(t * 2) * 0.05);
      for (const [k, l] of (this.lights || []).entries()) {
        const fl = 0.5 + Math.sin(t * 7 + k * 2) * 0.08 + Math.sin(t * 13 + k) * 0.05;
        wash(ctx, l.x, l.y, S.ts * 0.4, PALETTE.goldLight, fl);
      }
      // esprits : petites lueurs qui montent des lanternes
      if (this.wisps.length < 7 && Math.random() < dt * 2.2 && this.lights) {
        const l = this.lights[Math.random() < 0.5 ? 0 : 1];
        this.wisps.push({ x: l.x, y: l.y, vx: (Math.random() - 0.5) * 8, vy: -10 - Math.random() * 10, life: 0, max: 3 + Math.random() * 2, ph: Math.random() * 6 });
      }
      for (const p of this.wisps) {
        p.life += dt;
        p.x += (p.vx + Math.sin(t * 2 + p.ph) * 6) * dt;
        p.y += p.vy * dt;
        const k = p.life / p.max;
        const a = Math.sin(Math.min(1, k) * Math.PI);
        wash(ctx, p.x, p.y, 7, PALETTE.goldLight, a * 0.8);
        wash(ctx, p.x, p.y, 2.2, '#fff8e0', a);
      }
      this.wisps = this.wisps.filter((p) => p.life < p.max);
    }

    // pétales portés par le vent
    if (this.petals.length < 28 && Math.random() < 0.35) {
      this.petals.push({ x: Math.random() * w * 1.2 - w * 0.2, y: -10, vx: 18 + Math.random() * 22, vy: 22 + Math.random() * 26, r: Math.random() * 6, s: 2.6 + Math.random() * 2.6, dark: Math.random() < 0.3 });
    }
    for (const p of this.petals) {
      p.x += (p.vx + Math.sin(t * 2 + p.r) * 12) * dt;
      p.y += p.vy * dt;
      p.r += dt * 2;
      const c = Math.cos(p.r);
      const s = Math.sin(p.r);
      const sy = Math.abs(Math.sin(p.r * 0.7)) * 0.6 + 0.4;
      ctx.setTransform(dpr * c, dpr * s, -dpr * s * sy, dpr * c * sy, p.x * dpr, p.y * dpr);
      ctx.fillStyle = p.dark ? PETAL_DARK : PETAL;
      ctx.beginPath();
      ctx.moveTo(-p.s, 0);
      ctx.quadraticCurveTo(0, -p.s * 0.9, p.s, 0);
      ctx.quadraticCurveTo(0, p.s * 0.9, -p.s, 0);
      ctx.fill();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.petals = this.petals.filter((p) => p.y < h + 10);
    requestAnimationFrame((n) => this.frame(n));
  }
}

// ───────────────────────── Carte des niveaux ─────────────────────────

const LABEL_H = 50; // hauteur réservée au cartouche du monde en haut de bande
const FOOT_H = 38; // marge basse (étoiles du dernier nœud)

export class MapScreen {
  constructor(el, onSelect) {
    this.el = el;
    this.onSelect = onSelect;
    this.canvas = el.querySelector('canvas');
    this.nodesEl = el.querySelector('.map-nodes');
    onFontsReady(() => this.resize());
  }

  show(order, worlds, save) {
    this.order = order;
    this.worlds = worlds;
    this.save = save;
    this.el.classList.add('active');
    this.render();
  }

  // Données des niveaux (chargées à part) : leçon de chaque niveau sur la carte.
  setLevels(levels) {
    this.levels = levels;
    if (this.el.classList.contains('active') && this.pts) this.buildNodes(this.pts, this.bands);
  }

  hide() {
    this.el.classList.remove('active');
  }

  resize() {
    if (this.el.classList.contains('active') && this.order) this.render();
  }

  layout(w, h) {
    // Chaque monde occupe une bande : cartouche en haut à droite, nœuds en
    // zigzag dessous, le boss (dernier niveau du monde) au centre.
    const nW = this.worlds.length;
    const bandH = h / nW;
    const pts = [];
    const bands = [];
    let idx = 0;
    this.worlds.forEach((wd, wi) => {
      const top = wi * bandH;
      const first = idx;
      const n = wd.levels.length;
      const areaTop = top + LABEL_H;
      const areaH = bandH - LABEL_H - FOOT_H;
      for (let k = 0; k < n; k++) {
        const boss = k === n - 1;
        const zig = boss ? 0.5 : k % 2 === 0 ? 0.27 : 0.73;
        pts.push({ x: w * zig, y: areaTop + (areaH * (k + 0.5)) / n, i: idx++, world: wd, boss });
      }
      bands.push({ world: wd, top, h: bandH, first, last: idx - 1 });
    });
    return { pts, bands };
  }

  render() {
    const { w, h, dpr } = fitCanvas(this.canvas);
    const ctx = this.canvas.getContext('2d');
    const { pts, bands } = this.layout(w, h);
    const paper = makePaper(w, h, dpr, PAPER, 21);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(paper, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rnd = seeded(9);

    bands.forEach((b, i) => this.paintBand(ctx, b, w, rnd, i, pts));
    // séparation des mondes : bandes de brume
    for (let i = 1; i < bands.length; i++) {
      const y = bands[i].top;
      kasumi(ctx, -20, y - 3, w * 0.62, 11);
      kasumi(ctx, w * 0.38, y + 6, w * 0.7, 9);
    }
    this.paintPath(ctx, pts);
    this.pts = pts;
    this.bands = bands;
    this.buildNodes(pts, bands);
  }

  // Fond d'un monde : teinte, reliefs du thème, ambiance, pins sur les bords.
  paintBand(ctx, b, w, rnd, i, pts) {
    const th = b.world.theme;
    const snow = !!th.snowCaps;
    const bottom = b.top + b.h;
    // teinte du monde, plus dense en bas de bande
    const g = ctx.createLinearGradient(0, b.top, 0, bottom);
    g.addColorStop(0, withAlpha(th.grass, 0.06));
    g.addColorStop(1, withAlpha(th.grassDark, snow ? 0.2 : 0.24));
    ctx.fillStyle = g;
    ctx.fillRect(0, b.top, w, b.h);
    // reliefs lointains (lavis) au pied de la bande
    const far = ridge(rnd, -10, w + 30, bottom - b.h * 0.08, b.h * (snow ? 0.32 : 0.2), w * 0.25, w * 0.45, snow);
    fillRidge(ctx, far, bottom, withAlpha(snow ? '#7f9496' : th.grass, snow ? 0.32 : 0.3));
    if (snow) {
      // calottes de neige sur les pics
      ctx.fillStyle = withAlpha('#ffffff', 0.75);
      for (let k = 1; k < far.length - 1; k++) {
        const p = far[k];
        if (p[1] > far[k - 1][1] || p[1] > far[k + 1][1]) continue;
        const a = far[k - 1];
        const c = far[k + 1];
        const f = 0.3;
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(p[0] + (c[0] - p[0]) * f, p[1] + (c[1] - p[1]) * f);
        ctx.lineTo(p[0] + (c[0] - p[0]) * f * 0.5, p[1] + (c[1] - p[1]) * f * 0.8);
        ctx.lineTo(p[0], p[1] + (c[1] - p[1]) * f * 0.6);
        ctx.lineTo(p[0] + (a[0] - p[0]) * f * 0.5, p[1] + (a[1] - p[1]) * f * 0.8);
        ctx.lineTo(p[0] + (a[0] - p[0]) * f, p[1] + (a[1] - p[1]) * f);
        ctx.closePath();
        ctx.fill();
      }
    }
    brushStroke(ctx, far, 1.4, withAlpha(INK, 0.28), { taperIn: 0.03, taperOut: 0.03 });
    const nearR = ridge(rnd, -10, w + 30, bottom, b.h * 0.1, w * 0.18, w * 0.32);
    fillRidge(ctx, nearR, bottom + 2, withAlpha(th.grassDark, snow ? 0.22 : 0.3));
    // ambiance : flocons ou pétales épars
    for (let k = 0; k < (snow ? 70 : 26); k++) {
      const x = rnd() * w;
      const y = b.top + rnd() * b.h;
      if (snow) {
        ctx.fillStyle = withAlpha('#ffffff', 0.5 + rnd() * 0.4);
        ctx.beginPath();
        ctx.arc(x, y, 0.8 + rnd() * 1.8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = rnd() < 0.5 ? PETAL : PETAL_DARK;
        ctx.beginPath();
        ctx.ellipse(x, y, 3, 1.7, rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // pins sur les bords, à l'écart du cartouche (haut droite) et des nœuds
    const tth = { grass: th.grass, grassDark: th.grassDark, snowCaps: th.snowCaps };
    const size = Math.min(48, b.h * 0.14);
    const spots = [
      [0.07, 0.32],
      [0.05, 0.7],
      [0.93, 0.42],
      [0.95, 0.8],
      [0.09, 0.95],
    ];
    for (const [fx, fy] of spots) {
      const x = w * fx + (rnd() - 0.5) * 8;
      const y = b.top + b.h * fy;
      const clash = pts.some((p) => Math.abs(p.x - x) < 52 && Math.abs(p.y - (y - size * 0.4)) < 56);
      if (!clash) drawPine(ctx, x, y, size, rnd, tth);
    }
    void i;
  }

  // Chemin d'encre reliant les niveaux ; au-delà du dernier niveau débloqué,
  // de simples pas japonais (tobi-ishi) à peine esquissés.
  paintPath(ctx, pts) {
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      const unlocked = this.save.isUnlocked(this.order, k + 1);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const bend = (k % 2 ? 1 : -1) * Math.min(26, len * 0.16);
      const mx = (a.x + b.x) / 2 - (dy / len) * bend;
      const my = (a.y + b.y) / 2 + (dx / len) * bend;
      const p = quadPts(a.x, a.y, mx, my, b.x, b.y, 22);
      if (unlocked) {
        brushStroke(ctx, p, 16, withAlpha('#f6eedb', 0.85), { taperIn: 0.02, taperOut: 0.02 });
        brushStroke(ctx, p, 6, withAlpha(INK, 0.82), {
          taperIn: 0.04,
          taperOut: 0.04,
          pressure: (t) => 0.8 + Math.sin(t * Math.PI) * 0.25 + Math.sin(t * 17 + k) * 0.06,
        });
      } else {
        const steps = Math.max(3, Math.round(len / 18));
        for (let s = 1; s < steps; s++) {
          const q = p[Math.round((s / steps) * (p.length - 1))];
          ctx.fillStyle = withAlpha('#9a968a', 0.55);
          ctx.strokeStyle = withAlpha(INK, 0.35);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(q[0], q[1], 4.6, 3.2, (s * 0.7) % Math.PI, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  }

  // Nœuds-sceaux et cartouches de monde (DOM : texte net, feedback tactile).
  buildNodes(pts, bands) {
    const frag = document.createDocumentFragment();
    for (const b of bands) {
      const wd = b.world;
      let got = 0;
      for (const id of wd.levels) got += this.save.stars(id);
      const open = this.save.isUnlocked(this.order, b.first);
      const lab = document.createElement('div');
      lab.className = `map-world${open ? '' : ' locked'}`;
      lab.style.top = `${b.top + 8}px`;
      lab.innerHTML = `<span class="mw-seal">${wd.kanji}</span><span class="mw-text"><b>${wd.name}</b><small>${wd.subtitle || ''}<span class="mw-stars"><i></i>${got}/${wd.levels.length * 3}</span></small></span>`;
      frag.appendChild(lab);
    }
    const W = this.nodesEl.clientWidth || this.el.clientWidth;
    for (const p of pts) {
      const entry = this.order[p.i];
      const unlocked = this.save.isUnlocked(this.order, p.i);
      const rec = this.save.level ? this.save.level(entry.id) : { stars: this.save.stars(entry.id), hard: 0, challenge: false };
      const stars = rec.stars;
      const level = this.levels?.[entry.id];
      const b = document.createElement('button');
      b.className = `map-node${unlocked ? '' : ' locked'}${p.boss ? ' boss' : ''}${unlocked && !stars ? ' next' : ''}${stars ? ' cleared' : ''}${rec.hard ? ' hard' : ''}`;
      b.style.left = `${p.x}px`;
      b.style.top = `${p.y}px`;
      const marks = [rec.hard ? 'gagné en Difficile' : '', rec.challenge ? 'défi réussi' : ''].filter(Boolean).join(', ');
      b.setAttribute('aria-label', `Niveau ${p.i + 1}${level?.concept ? ` : ${level.concept}` : ''}${p.boss ? ' (boss)' : ''}${unlocked ? `, ${stars} étoile${stars > 1 ? 's' : ''}${marks ? `, ${marks}` : ''}` : ' (verrouillé)'}`);
      b.innerHTML = `<span class="face"><span class="num">${unlocked ? NUMERALS[p.i] ?? p.i + 1 : '封'}</span></span><span class="latin">${p.i + 1}</span>
        ${p.boss ? '<span class="boss-tag">Boss</span>' : ''}
        ${rec.hard ? '<span class="node-mark hard" aria-hidden="true">難</span>' : ''}
        ${rec.challenge ? '<span class="node-mark ch" aria-hidden="true">挑</span>' : ''}
        <span class="stars">${[0, 1, 2].map((k) => `<i class="${k < stars ? 'on' : ''}"></i>`).join('')}</span>`;
      b.addEventListener('click', () => this.onSelect(entry, unlocked));
      frag.appendChild(b);
      // Leçon du niveau, à côté du nœud (côté intérieur de la carte).
      if (level?.concept) {
        const lab = document.createElement('span');
        const right = p.x < W / 2 || (p.boss && p.x <= W / 2);
        lab.className = `map-concept${unlocked ? '' : ' locked'}${right ? ' right' : ' left'}`;
        lab.setAttribute('aria-hidden', 'true');
        lab.textContent = level.concept;
        const half = (p.boss ? 36 : 31) + 10;
        if (right) lab.style.left = `${Math.round(p.x + half)}px`;
        else lab.style.right = `${Math.round(W - p.x + half)}px`;
        lab.style.top = `${Math.round(p.y - 2)}px`;
        frag.appendChild(lab);
      }
    }
    this.nodesEl.innerHTML = '';
    this.nodesEl.appendChild(frag);
  }
}
