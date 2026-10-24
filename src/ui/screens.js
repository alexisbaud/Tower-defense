// Écrans de menu : titre animé et carte de sélection des niveaux.
import { makePaper } from '../render/paper.js';
import { INK, PALETTE, withAlpha, wash, brushStroke, quadPts, seeded, mix } from '../render/brush.js';
import { drawPine, drawTorii } from '../render/terrain.js';

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

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

// ───────────────────────── Titre ─────────────────────────

export class TitleScreen {
  constructor(el) {
    this.el = el;
    this.canvas = el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.petals = [];
    this.running = false;
    this.t = 0;
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

  // Décor statique : soleil vermillon, montagnes à l'encre, torii, pins.
  paint(w, h, dpr) {
    const c = makePaper(w, h, dpr, '#efe4c8', 11);
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const rnd = seeded(5);
    // soleil
    ctx.fillStyle = withAlpha(PALETTE.vermillion, 0.9);
    ctx.beginPath();
    ctx.arc(w * 0.66, h * 0.43, Math.min(w, h) * 0.17, 0, Math.PI * 2);
    ctx.fill();
    // nuages en bandes (style estampe)
    ctx.fillStyle = withAlpha('#f6eedb', 0.92);
    for (const [y, x0, x1] of [
      [0.4, 0.42, 0.98],
      [0.455, 0.55, 1.05],
    ]) {
      ctx.beginPath();
      ctx.roundRect(w * x0, h * y, w * (x1 - x0), h * 0.022, h * 0.011);
      ctx.fill();
    }
    // montagnes (lavis d'indigo superposés)
    const layers = [
      [0.48, '#5b6f95', 0.55],
      [0.56, '#3b5280', 0.75],
      [0.64, '#1f2f4f', 0.9],
    ];
    for (const [base, col, a] of layers) {
      ctx.fillStyle = withAlpha(col, a);
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, h * base);
      let x = 0;
      while (x < w) {
        const pw = w * (0.18 + rnd() * 0.22);
        const ph = h * (0.05 + rnd() * 0.09);
        ctx.quadraticCurveTo(x + pw * 0.5, h * base - ph * 2, x + pw, h * base + (rnd() - 0.5) * h * 0.02);
        x += pw;
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
      // neige sur la crête de la première couche
    }
    // brume
    const g = ctx.createLinearGradient(0, h * 0.6, 0, h * 0.75);
    g.addColorStop(0, withAlpha('#efe4c8', 0));
    g.addColorStop(1, withAlpha('#efe4c8', 0.75));
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.6, w, h * 0.15);
    // sol de mousse
    ctx.fillStyle = withAlpha('#4f5b2c', 0.95);
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.8);
    ctx.quadraticCurveTo(w * 0.5, h * 0.75, w, h * 0.82);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    const ts = Math.min(w, h) * 0.22;
    drawTorii(ctx, w * 0.5, h * 0.79, ts);
    const th = { grass: '#7d8a4a', grassDark: '#2f3a1c', snowCaps: false };
    drawPine(ctx, w * 0.12, h * 0.86, ts * 0.9, rnd, th);
    drawPine(ctx, w * 0.88, h * 0.88, ts * 1.05, rnd, th);
    return c;
  }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const { ctx, w, h, dpr } = this;
    if (!this.bg) return requestAnimationFrame((n) => this.frame(n));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // pétales
    if (this.petals.length < 40 && Math.random() < 0.5) {
      this.petals.push({ x: Math.random() * w * 1.2 - w * 0.2, y: -10, vx: 20 + Math.random() * 25, vy: 25 + Math.random() * 30, r: Math.random() * 6, s: 3 + Math.random() * 3 });
    }
    for (const p of this.petals) {
      p.x += (p.vx + Math.sin(this.t * 2 + p.r) * 12) * dt;
      p.y += p.vy * dt;
      p.r += dt * 2;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.scale(1, Math.abs(Math.sin(p.r)) * 0.6 + 0.4);
      ctx.fillStyle = 'rgba(242,184,192,0.9)';
      ctx.beginPath();
      ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    this.petals = this.petals.filter((p) => p.y < h + 10);
    // lueur du torii
    wash(ctx, w * 0.5, h * 0.72, Math.min(w, h) * 0.25, PALETTE.goldLight, 0.18 + Math.sin(this.t * 2) * 0.05);
    requestAnimationFrame((n) => this.frame(n));
  }
}

// ───────────────────────── Carte des niveaux ─────────────────────────

export class MapScreen {
  constructor(el, onSelect) {
    this.el = el;
    this.onSelect = onSelect;
    this.canvas = el.querySelector('canvas');
    this.nodesEl = el.querySelector('.map-nodes');
  }

  show(order, worlds, save) {
    this.order = order;
    this.worlds = worlds;
    this.save = save;
    this.el.classList.add('active');
    this.render();
  }

  hide() {
    this.el.classList.remove('active');
  }

  resize() {
    if (this.el.classList.contains('active')) this.render();
  }

  layout(w, h) {
    // Chaque monde occupe une bande ; les nœuds serpentent en zigzag.
    const nW = this.worlds.length;
    const bandH = h / nW;
    const pts = [];
    const bands = [];
    let idx = 0;
    this.worlds.forEach((wd, wi) => {
      const top = wi * bandH;
      bands.push({ world: wd, top, h: bandH });
      const n = wd.levels.length;
      for (let k = 0; k < n; k++) {
        const fy = (k + 0.75) / (n + 0.4);
        const zig = k % 2 === 0 ? 0.28 : 0.72;
        pts.push({ x: w * (zig + (wi % 2 ? -0.02 : 0.02)), y: top + bandH * fy, i: idx++, world: wd });
      }
    });
    return { pts, bands };
  }

  render() {
    const { w, h, dpr } = fitCanvas(this.canvas);
    const ctx = this.canvas.getContext('2d');
    const { pts, bands } = this.layout(w, h);
    const paper = makePaper(w, h, dpr, '#efe4c8', 21);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(paper, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rnd = seeded(9);

    // Fonds des mondes.
    bands.forEach((b, i) => {
      const th = b.world.theme;
      const g = ctx.createLinearGradient(0, b.top, 0, b.top + b.h);
      g.addColorStop(0, withAlpha(th.grass, i ? 0.18 : 0.25));
      g.addColorStop(1, withAlpha(th.grassDark, i ? 0.3 : 0.2));
      ctx.fillStyle = g;
      ctx.fillRect(0, b.top, w, b.h);
      if (th.snowCaps) {
        ctx.fillStyle = withAlpha('#ffffff', 0.55);
        for (let k = 0; k < 60; k++) {
          ctx.beginPath();
          ctx.arc(rnd() * w, b.top + rnd() * b.h, 1 + rnd() * 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // pins décoratifs sur les bords
      const tth = { grass: th.grass, grassDark: th.grassDark, snowCaps: th.snowCaps };
      for (let k = 0; k < 3; k++) {
        drawPine(ctx, w * (0.06 + rnd() * 0.08), b.top + b.h * (0.3 + k * 0.28), 46, rnd, tth);
        drawPine(ctx, w * (0.88 + rnd() * 0.08), b.top + b.h * (0.2 + k * 0.3), 46, rnd, tth);
      }
      // bandeau du monde
      ctx.save();
      ctx.fillStyle = withAlpha(PALETTE.indigo, 0.9);
      const bw = Math.min(w * 0.7, 260);
      ctx.beginPath();
      ctx.roundRect((w - bw) / 2, b.top + 8, bw, 30, 15);
      ctx.fill();
      ctx.fillStyle = PALETTE.cream;
      ctx.font = `700 15px "Shippori Mincho", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${b.world.kanji}  ${b.world.name}`, w / 2, b.top + 24);
      ctx.restore();
      if (i > 0) {
        brushStroke(ctx, [[0, b.top], [w * 0.5, b.top + 4], [w, b.top]], 3, withAlpha(INK, 0.4), { taperIn: 0.1, taperOut: 0.1 });
      }
    });

    // Chemin d'encre reliant les niveaux.
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      const unlocked = this.save.isUnlocked(this.order, k + 1);
      const mx = (a.x + b.x) / 2 + (k % 2 ? 30 : -30);
      const my = (a.y + b.y) / 2;
      const p = quadPts(a.x, a.y, mx, my, b.x, b.y, 18);
      if (unlocked) brushStroke(ctx, p, 7, withAlpha(INK, 0.75), { taperIn: 0.05, taperOut: 0.05 });
      else {
        ctx.save();
        ctx.strokeStyle = withAlpha(INK, 0.3);
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mx, my, b.x, b.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Nœuds (boutons DOM pour l'accessibilité et le feedback tactile).
    this.nodesEl.innerHTML = '';
    for (const p of pts) {
      const entry = this.order[p.i];
      const unlocked = this.save.isUnlocked(this.order, p.i);
      const stars = this.save.stars(entry.id);
      const boss = p.i === pts.length - 1 || (p.world.levels.at(-1) === entry.id);
      const b = document.createElement('button');
      b.className = `map-node${unlocked ? '' : ' locked'}${boss ? ' boss' : ''}${unlocked && !stars ? ' next' : ''}`;
      b.style.left = `${p.x}px`;
      b.style.top = `${p.y}px`;
      b.setAttribute('aria-label', `Niveau ${p.i + 1}${unlocked ? '' : ' (verrouillé)'}`);
      b.innerHTML = `<span class="num">${unlocked ? NUMERALS[p.i] ?? p.i + 1 : '封'}</span><span class="latin">${p.i + 1}</span>
        <span class="stars">${[0, 1, 2].map((k) => `<i class="${k < stars ? 'on' : ''}">★</i>`).join('')}</span>`;
      b.addEventListener('click', () => this.onSelect(entry, unlocked));
      this.nodesEl.appendChild(b);
    }
    void mix;
  }
}
