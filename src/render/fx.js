// Particules et effets visuels déclenchés par les événements du moteur.
// Toutes les positions sont en unités de case ; la conversion en pixels se fait au dessin.
import { INK, PALETTE, withAlpha, wash } from './brush.js';

export const ELEMENT_COLORS = {
  fire: { main: '#e2552f', light: '#ffb35c', dark: '#8c2414' },
  water: { main: '#3f7fb8', light: '#a8d8ff', dark: '#1f3f66' },
  wind: { main: '#9cc3a0', light: '#e8f4e0', dark: '#4f7a5a' },
  earth: { main: '#b0873a', light: '#e8c97a', dark: '#5e4220' },
};

const MAX_PARTS = 700;

export class Fx {
  constructor() {
    this.parts = [];
    this.texts = [];
    this.rings = [];
    this.marks = [];
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '#c8402a';
    this.ambient = 'petals';
    this.ambientT = 0;
    this.bounds = { w: 9, h: 13 };
  }

  reset(bounds, ambient) {
    this.parts.length = 0;
    this.texts.length = 0;
    this.rings.length = 0;
    this.marks.length = 0;
    this.shake = 0;
    this.flash = 0;
    this.bounds = bounds;
    this.ambient = ambient || 'petals';
    // Pré-remplir l'ambiance pour éviter un écran vide au départ.
    for (let i = 0; i < 14; i++) this.spawnAmbient(Math.random() * bounds.h);
  }

  add(p) {
    if (this.parts.length >= MAX_PARTS) this.parts.shift();
    p.life = p.max = p.life ?? 1;
    p.rot = p.rot ?? Math.random() * Math.PI * 2;
    p.vr = p.vr ?? 0;
    p.g = p.g ?? 0;
    p.drag = p.drag ?? 0.98;
    this.parts.push(p);
    return p;
  }

  burst(x, y, n, kind, color, speed = 2, life = 0.6, size = 0.06, extra = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      this.add({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        kind,
        color,
        life: life * (0.6 + Math.random() * 0.6),
        size: size * (0.6 + Math.random() * 0.8),
        ...extra,
      });
    }
  }

  ring(x, y, r0, r1, color, life = 0.5, width = 0.05) {
    this.rings.push({ x, y, r0, r1, color, life, max: life, width });
  }

  text(x, y, str, color = PALETTE.gold, size = 0.34) {
    this.texts.push({ x, y, str, color, size, life: 1.1, max: 1.1 });
  }

  mark(c, r, color = PALETTE.vermillion) {
    this.marks.push({ x: c + 0.5, y: r + 0.5, color, life: 0.7, max: 0.7 });
  }

  addShake(v) {
    this.shake = Math.min(1.2, this.shake + v);
  }

  spawnAmbient(y) {
    const { w } = this.bounds;
    const k = this.ambient;
    if (k === 'snow') {
      this.add({ x: Math.random() * w, y: y ?? -0.3, vx: 0.1, vy: 0.35 + Math.random() * 0.3, kind: 'snow', color: '#ffffff', life: 40, size: 0.03 + Math.random() * 0.04, drag: 1, amb: true });
    } else {
      this.add({
        x: Math.random() * w,
        y: y ?? -0.3,
        vx: 0.25 + Math.random() * 0.3,
        vy: 0.3 + Math.random() * 0.25,
        kind: 'petal',
        color: Math.random() < 0.8 ? '#f2b8c0' : '#f7d9dc',
        life: 40,
        size: 0.06 + Math.random() * 0.04,
        vr: (Math.random() - 0.5) * 3,
        drag: 1,
        amb: true,
      });
    }
  }

  // Traduction des événements du moteur en effets.
  onEvent(ev) {
    const col = (el) => ELEMENT_COLORS[el] || ELEMENT_COLORS.fire;
    switch (ev.type) {
      case 'spawn': {
        const e = ev.enemy;
        this.ring(e.x, e.y, 0.05, 0.6, INK, 0.7, 0.08);
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          this.add({ x: e.x, y: e.y, vx: Math.cos(a) * 0.9, vy: Math.sin(a) * 0.9 - 0.2, kind: 'curl', color: INK, life: 0.8, size: 0.09, vr: 4, drag: 0.93 });
        }
        break;
      }
      case 'shoot': {
        const t = ev.tower;
        const c = col(ev.element);
        this.burst(t.x, t.y - 0.35, 3, 'dot', c.light, 0.8, 0.25, 0.04);
        break;
      }
      case 'hit': {
        const c = col(ev.element);
        const a = ev.echo ? 0.5 : 1;
        if (ev.element === 'fire') {
          this.burst(ev.x, ev.y, 7 + ev.level * 2, 'ember', c.light, 2.2, 0.5, 0.05, { g: -1.5, alpha: a });
        } else if (ev.element === 'water') {
          this.burst(ev.x, ev.y, 6 + ev.level * 2, 'drop', c.light, 2, 0.45, 0.05, { g: 5, alpha: a });
          this.ring(ev.x, ev.y, 0.05, 0.25 + (ev.splash || 0), c.main, 0.4, 0.04);
        } else if (ev.element === 'wind') {
          this.burst(ev.x, ev.y, 5 + ev.level, 'leaf', c.main, 2.4, 0.6, 0.07, { vr: 8, alpha: a });
        } else if (ev.element === 'earth') {
          this.burst(ev.x, ev.y, 10 + ev.level * 3, 'dust', '#b59a6a', 1.6, 0.6, 0.09, { alpha: a });
          this.burst(ev.x, ev.y, 5, 'pebble', '#6b675d', 2.5, 0.5, 0.04, { g: 6 });
          this.ring(ev.x, ev.y, 0.1, (ev.splash || 0.6) + 0.1, c.dark, 0.35, 0.06);
          this.addShake(0.08);
        }
        break;
      }
      case 'kill': {
        const e = ev.enemy;
        this.burst(e.x, e.y, 10, 'ink', INK, 1.6, 0.6, 0.1, { drag: 0.9 });
        this.add({ x: e.x, y: e.y, vx: 0, vy: -0.8, kind: 'wisp', color: '#e8f0ff', life: 1.2, size: 0.12, drag: 0.99 });
        if (ev.reward) this.text(e.x, e.y - 0.3, `+${ev.reward}`, PALETTE.gold, 0.3);
        break;
      }
      case 'leak': {
        this.addShake(0.5);
        this.flash = 0.45;
        this.flashColor = PALETTE.vermillion;
        this.text(ev.enemy.x, ev.enemy.y - 0.4, `-${ev.damage}`, PALETTE.vermillion, 0.4);
        break;
      }
      case 'place': {
        const t = ev.tower;
        this.ring(t.x, t.y + 0.2, 0.1, 0.7, col(t.type).main, 0.5, 0.06);
        this.burst(t.x, t.y + 0.25, 10, 'dust', '#b59a6a', 1.2, 0.5, 0.08);
        this.burst(t.x, t.y - 0.2, 8, 'dot', col(t.type).light, 1.5, 0.6, 0.04, { g: -1 });
        break;
      }
      case 'sell': {
        const t = ev.tower;
        this.burst(t.x, t.y, 14, 'ink', INK, 1.4, 0.6, 0.08);
        this.text(t.x, t.y - 0.4, `+${ev.value}`, PALETTE.gold, 0.32);
        break;
      }
      case 'reject': {
        this.mark(ev.c, ev.r);
        break;
      }
      case 'fuse': {
        const t = ev.tower;
        const c = col(t.type);
        this.ring(t.x, t.y - 0.2, 0.1, 1.1, PALETTE.gold, 0.7, 0.08);
        this.ring(t.x, t.y - 0.2, 0.1, 0.7, c.main, 0.5, 0.06);
        this.burst(t.x, t.y - 0.3, 22, 'ember', PALETTE.goldLight, 2.6, 0.9, 0.06, { g: -1.2 });
        this.burst(t.x, t.y - 0.3, 10, 'dot', c.light, 1.8, 0.8, 0.05);
        // traînée depuis la lanterne absorbée
        for (let i = 0; i < 8; i++) {
          const k = i / 8;
          this.add({ x: ev.from.x + (t.x - ev.from.x) * k, y: ev.from.y + (t.y - ev.from.y) * k, vx: 0, vy: -0.3, kind: 'wisp', color: c.light, life: 0.5 + k * 0.3, size: 0.08 });
        }
        this.text(t.x, t.y - 0.9, ev.level === 3 ? '極' : '合', PALETTE.vermillion, 0.5);
        this.addShake(0.15);
        break;
      }
      case 'stone': {
        const x = ev.c + 0.5;
        const y = ev.r + 0.5;
        this.burst(x, y + 0.2, 12, 'dust', '#b59a6a', 1.4, 0.6, 0.09);
        this.ring(x, y, 0.1, 0.6, INK, 0.4, 0.05);
        if (ev.delta > 0) this.text(x, y - 0.4, `+${ev.delta} cases`, PALETTE.indigoLight, 0.3);
        this.addShake(0.06);
        break;
      }
      case 'unstone': {
        const x = ev.c + 0.5;
        const y = ev.r + 0.5;
        this.burst(x, y, 10, 'dust', '#b59a6a', 1.2, 0.5, 0.08);
        if (ev.refund) this.text(x, y - 0.4, `+${ev.refund}`, PALETTE.gold, 0.3);
        break;
      }
      case 'combo': {
        this.ring(ev.x, ev.y, 0.1, ev.def.radius, ev.def.color, 0.8, 0.07);
        this.burst(ev.x, ev.y, 14, 'dot', ev.def.color, 1.6, 0.8, 0.05);
        this.text(ev.x, ev.y - 0.6, ev.def.name, PALETTE.vermillion, 0.3);
        break;
      }
      case 'pulse': {
        const z = ev.zone;
        if (z.def.id === 'frost') {
          this.ring(z.x, z.y, 0.2, z.radius, '#bfe3ff', 0.6, 0.1);
          this.burst(z.x, z.y, 18, 'snow', '#ffffff', 2.5, 0.8, 0.05, { drag: 0.94 });
        } else {
          this.ring(z.x, z.y, 0.2, z.radius, z.def.color, 0.6, 0.08);
        }
        break;
      }
      case 'tornado': {
        const t = ev.tornado;
        this.burst(t.x, t.y, 10, 'ember', '#ffb35c', 1.5, 0.6, 0.05, { g: -1 });
        break;
      }
      case 'earlyBonus':
        break;
      default:
        break;
    }
  }

  update(dt) {
    this.ambientT += dt;
    const rate = this.ambient === 'snow' ? 0.18 : 0.45;
    while (this.ambientT > rate) {
      this.ambientT -= rate;
      this.spawnAmbient();
    }
    const H = this.bounds.h + 1;
    for (const p of this.parts) {
      p.life -= dt;
      p.vy += p.g * dt;
      p.vx *= p.drag;
      p.vy *= p.drag;
      if (p.amb) {
        p.vx += Math.sin(p.y * 1.3 + p.rot) * 0.01;
        if (p.y > H) p.life = 0;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= dt * 0.6;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const m of this.marks) m.life -= dt;
    this.marks = this.marks.filter((m) => m.life > 0);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.flash = Math.max(0, this.flash - dt * 1.5);
  }

  drawParts(ctx, ts, filter) {
    for (const p of this.parts) {
      if (filter && !filter(p)) continue;
      const k = p.life / p.max;
      const x = p.x * ts;
      const y = p.y * ts;
      const s = p.size * ts;
      const a = (p.alpha ?? 1) * (p.amb ? Math.min(1, p.life) : 1);
      switch (p.kind) {
        case 'petal':
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(p.rot);
          ctx.scale(1, Math.abs(Math.sin(p.rot * 0.7)) * 0.6 + 0.4);
          ctx.fillStyle = withAlpha(p.color, 0.85 * a);
          ctx.beginPath();
          ctx.ellipse(0, 0, s, s * 0.55, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          break;
        case 'snow':
          ctx.fillStyle = withAlpha('#ffffff', 0.85 * a);
          ctx.beginPath();
          ctx.arc(x, y, s, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'ember':
          ctx.fillStyle = withAlpha(p.color, k * a);
          ctx.beginPath();
          ctx.arc(x, y, s * (0.5 + k * 0.5), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'drop':
          ctx.fillStyle = withAlpha(p.color, k * a);
          ctx.beginPath();
          ctx.ellipse(x, y, s * 0.6, s, Math.atan2(p.vy, p.vx) + Math.PI / 2, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'leaf':
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(p.rot);
          ctx.fillStyle = withAlpha(p.color, k * a);
          ctx.beginPath();
          ctx.ellipse(0, 0, s, s * 0.35, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          break;
        case 'dust':
          ctx.fillStyle = withAlpha(p.color, k * 0.45 * a);
          ctx.beginPath();
          ctx.arc(x, y, s * (1.6 - k * 0.6), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'pebble':
          ctx.fillStyle = withAlpha(p.color, k);
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
          break;
        case 'ink':
          ctx.fillStyle = withAlpha(INK, k * 0.7);
          ctx.beginPath();
          ctx.arc(x, y, s * (1.3 - k * 0.5), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'curl': {
          ctx.strokeStyle = withAlpha(INK, k * 0.8);
          ctx.lineWidth = Math.max(1, s * 0.5 * k);
          ctx.beginPath();
          ctx.arc(x, y, s * (1.5 - k), p.rot, p.rot + Math.PI * 1.2);
          ctx.stroke();
          break;
        }
        case 'wisp':
          wash(ctx, x, y, s * 2, p.color, k * 0.8);
          break;
        case 'smoke':
          ctx.fillStyle = withAlpha(p.color, k * 0.35 * a);
          ctx.beginPath();
          ctx.arc(x, y, s * (2 - k), 0, Math.PI * 2);
          ctx.fill();
          break;
        default:
          ctx.fillStyle = withAlpha(p.color, k * a);
          ctx.beginPath();
          ctx.arc(x, y, s, 0, Math.PI * 2);
          ctx.fill();
      }
    }
  }

  drawOverlay(ctx, ts) {
    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      ctx.strokeStyle = withAlpha(r.color, (1 - k) * 0.8);
      ctx.lineWidth = Math.max(1, r.width * ts * (1 - k * 0.6));
      ctx.beginPath();
      ctx.arc(r.x * ts, r.y * ts, (r.r0 + (r.r1 - r.r0) * easeOut(k)) * ts, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const m of this.marks) {
      const k = m.life / m.max;
      const x = m.x * ts;
      const y = m.y * ts;
      const s = ts * 0.28;
      const jx = Math.sin(m.life * 60) * ts * 0.04 * k;
      ctx.strokeStyle = withAlpha(m.color, k);
      ctx.lineWidth = ts * 0.09;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - s + jx, y - s);
      ctx.lineTo(x + s + jx, y + s);
      ctx.moveTo(x + s + jx, y - s);
      ctx.lineTo(x - s + jx, y + s);
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = t.life / t.max;
      ctx.font = `800 ${Math.round(t.size * ts)}px "Shippori Mincho", serif`;
      ctx.lineWidth = Math.max(2, ts * 0.06);
      ctx.strokeStyle = withAlpha('#f6efdc', Math.min(1, k * 2));
      ctx.strokeText(t.str, t.x * ts, t.y * ts);
      ctx.fillStyle = withAlpha(t.color, Math.min(1, k * 2));
      ctx.fillText(t.str, t.x * ts, t.y * ts);
    }
  }
}

function easeOut(k) {
  return 1 - (1 - k) * (1 - k);
}
