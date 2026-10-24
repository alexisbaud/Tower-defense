// Rendu des combos élémentaires : liens entre lanternes, zones de synergie, tornades.
import { INK, PALETTE, withAlpha, wash, brushStroke, seeded } from './brush.js';
import { ELEMENT_COLORS } from './fx.js';

export function drawZones(ctx, game, ts, time) {
  const g = game.grid;
  for (const z of game.zones) {
    const id = z.def.id;
    const x = z.x * ts;
    const y = z.y * ts;
    const R = z.radius * ts;
    const age = Math.min(1, (game.time - z.born) / 0.6);
    ctx.save();
    ctx.globalAlpha = age;
    // Contour discret de la zone d'effet.
    ctx.strokeStyle = withAlpha(z.def.color === '#e4ecef' ? '#8fa3ad' : z.def.color, 0.45);
    ctx.lineWidth = Math.max(1, ts * 0.025);
    ctx.setLineDash([ts * 0.05, ts * 0.12]);
    ctx.lineDashOffset = time * ts * 0.2;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (id === 'steam') {
      for (let k = 0; k < 7; k++) {
        const a = time * 0.35 + k * 0.9;
        const rr = R * (0.25 + ((k * 37) % 10) / 16);
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a * 1.3) * rr * 0.6;
        wash(ctx, px, py, ts * (0.55 + (k % 3) * 0.12), '#f4f7f8', 0.45);
      }
    } else if (id === 'mud' || id === 'magma') {
      const rnd = seeded(z.a * 131 + z.b * 7);
      for (let i = 0; i < g.size; i++) {
        if (!g.isWalkableType(i)) continue;
        const cx = g.cx(i) * ts;
        const cy = g.cy(i) * ts;
        if (Math.hypot(cx - x, cy - y) > R) {
          rnd();
          rnd();
          continue;
        }
        if (id === 'mud') {
          ctx.fillStyle = withAlpha('#6b4b2a', 0.55);
          ctx.beginPath();
          ctx.ellipse(cx + (rnd() - 0.5) * ts * 0.2, cy + (rnd() - 0.5) * ts * 0.2, ts * 0.42, ts * 0.3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = withAlpha('#3d2a16', 0.5);
          ctx.lineWidth = Math.max(1, ts * 0.02);
          ctx.beginPath();
          ctx.arc(cx, cy, ts * (0.12 + 0.06 * Math.sin(time * 2 + i)), 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = withAlpha('#2a1a14', 0.55);
          ctx.beginPath();
          ctx.ellipse(cx, cy, ts * 0.4, ts * 0.32, 0, 0, Math.PI * 2);
          ctx.fill();
          const glow = 0.6 + Math.sin(time * 3 + i) * 0.3;
          ctx.strokeStyle = withAlpha('#ff7a2c', glow);
          ctx.lineWidth = Math.max(1, ts * 0.04);
          ctx.beginPath();
          const a0 = rnd() * 6;
          ctx.moveTo(cx + Math.cos(a0) * ts * 0.3, cy + Math.sin(a0) * ts * 0.22);
          ctx.lineTo(cx + (rnd() - 0.5) * ts * 0.1, cy + (rnd() - 0.5) * ts * 0.1);
          ctx.lineTo(cx + Math.cos(a0 + 2.4) * ts * 0.32, cy + Math.sin(a0 + 2.4) * ts * 0.22);
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a0 + 4.2) * ts * 0.3, cy + Math.sin(a0 + 4.2) * ts * 0.24);
          ctx.stroke();
        }
      }
    } else if (id === 'frost') {
      wash(ctx, x, y, R, '#cfe9ff', 0.25);
      ctx.strokeStyle = withAlpha('#ffffff', 0.6);
      ctx.lineWidth = Math.max(1, ts * 0.025);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + time * 0.2;
        const px = x + Math.cos(a) * R * 0.6;
        const py = y + Math.sin(a) * R * 0.6;
        snowflake(ctx, px, py, ts * 0.12);
      }
      // jauge de recharge
      const k = Math.min(1, z.timer / z.def.effect.interval);
      ctx.strokeStyle = withAlpha('#9fd4ff', 0.8);
      ctx.lineWidth = Math.max(1.5, ts * 0.04);
      ctx.beginPath();
      ctx.arc(x, y, ts * 0.3, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      ctx.stroke();
    } else if (id === 'sandstorm') {
      ctx.strokeStyle = withAlpha('#c9a45e', 0.55);
      ctx.lineCap = 'round';
      for (let k = 0; k < 10; k++) {
        const a = time * 1.6 + k * 0.63;
        const rr = R * (0.3 + (k % 4) * 0.18);
        ctx.lineWidth = Math.max(1, ts * (0.02 + (k % 3) * 0.01));
        ctx.beginPath();
        ctx.arc(x, y, rr, a, a + 0.7);
        ctx.stroke();
      }
    } else if (id === 'firestorm') {
      ctx.strokeStyle = withAlpha('#ff8a3c', 0.3);
      ctx.lineWidth = Math.max(1, ts * 0.03);
      ctx.beginPath();
      ctx.ellipse(x, y, R * 0.7, R * 0.7 * 0.85, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// Liens d'encre entre les deux lanternes d'un combo + sceau (hanko) au centre.
export function drawComboLinks(ctx, game, ts, time) {
  for (const z of game.zones) {
    const a = game.towerById(z.a);
    const b = game.towerById(z.b);
    if (!a || !b) continue;
    const ax = a.x * ts;
    const ay = (a.y - 0.25) * ts;
    const bx = b.x * ts;
    const by = (b.y - 0.25) * ts;
    const ca = ELEMENT_COLORS[a.type]?.main || PALETTE.gold;
    const cb = ELEMENT_COLORS[b.type]?.main || PALETTE.gold;
    const grad = ctx.createLinearGradient(ax, ay, bx, by);
    grad.addColorStop(0, withAlpha(ca, 0.85));
    grad.addColorStop(1, withAlpha(cb, 0.85));
    ctx.save();
    ctx.strokeStyle = grad;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, ts * 0.06);
    ctx.setLineDash([ts * 0.12, ts * 0.08]);
    ctx.lineDashOffset = -time * ts * 0.6;
    ctx.beginPath();
    const mx = (ax + bx) / 2 + (by - ay) * 0.15;
    const my = (ay + by) / 2 - (bx - ax) * 0.15;
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(mx, my, bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    // sceau
    const sx = (ax + bx) / 2 + (by - ay) * 0.075;
    const sy = (ay + by) / 2 - (bx - ax) * 0.075;
    const s = ts * 0.3;
    const pop = Math.min(1, (game.time - z.born) / 0.35);
    ctx.translate(sx, sy);
    ctx.scale(pop, pop);
    ctx.rotate(-0.08);
    ctx.fillStyle = PALETTE.vermillion;
    ctx.strokeStyle = withAlpha(INK, 0.6);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    ctx.beginPath();
    ctx.rect(-s / 2, -s / 2, s, s);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PALETTE.cream;
    const k = z.def.kanji;
    ctx.font = `800 ${Math.round(s * (k.length > 1 ? 0.42 : 0.7))}px "Shippori Mincho", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (k.length > 1) {
      ctx.fillText(k[0], 0, -s * 0.2);
      ctx.fillText(k[1], 0, s * 0.22);
    } else ctx.fillText(k, 0, s * 0.03);
    ctx.restore();
  }
}

export function drawTornado(ctx, t, ts, time) {
  const x = t.x * ts;
  const y = t.y * ts;
  const k = Math.min(1, t.life / 0.4, (t.max - t.life) / 0.3 + 0.2);
  const h = ts * 0.9;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, k));
  wash(ctx, x, y, ts * 0.7, '#ff8a3c', 0.35);
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const f = i / 6;
    const w = ts * (0.12 + f * 0.38) * t.size * 1.6;
    const yy = y - f * h;
    const a = time * 12 + i * 0.8;
    ctx.strokeStyle = i % 2 ? withAlpha('#ffb35c', 0.9) : withAlpha('#c8402a', 0.85);
    ctx.lineWidth = Math.max(1.5, ts * 0.05 * (1 - f * 0.4));
    ctx.beginPath();
    ctx.ellipse(x + Math.sin(a * 0.3 + f * 3) * ts * 0.08, yy, w, w * 0.3, 0, a % (Math.PI * 2), (a % (Math.PI * 2)) + Math.PI * 1.4);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawStone(ctx, x, y, ts, seed) {
  const rnd = seeded(seed);
  const r = ts * 0.36;
  ctx.fillStyle = withAlpha(INK, 0.25);
  ctx.beginPath();
  ctx.ellipse(x + r * 0.12, y + r * 0.55, r * 1.1, r * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
  const j = () => (rnd() - 0.5) * r * 0.25;
  ctx.beginPath();
  ctx.moveTo(x - r + j(), y + r * 0.45);
  ctx.quadraticCurveTo(x - r * 1.05 + j(), y - r * 0.5 + j(), x - r * 0.15 + j(), y - r * 0.85 + j());
  ctx.quadraticCurveTo(x + r * 0.85 + j(), y - r * 0.9 + j(), x + r + j(), y + r * 0.45);
  ctx.quadraticCurveTo(x, y + r * 0.7, x - r, y + r * 0.45);
  ctx.closePath();
  ctx.fillStyle = '#8f8b80';
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, ts * 0.04);
  ctx.stroke();
  // reflet + mousse
  ctx.fillStyle = withAlpha('#ffffff', 0.18);
  ctx.beginPath();
  ctx.ellipse(x - r * 0.3, y - r * 0.4, r * 0.35, r * 0.15, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = withAlpha('#6f7f3c', 0.9);
  ctx.beginPath();
  ctx.ellipse(x + r * 0.2, y - r * 0.62, r * 0.32, r * 0.12, 0.2, 0, Math.PI * 2);
  ctx.fill();
  brushStroke(ctx, [[x - r * 0.1, y - r * 0.3], [x + r * 0.15, y], [x + r * 0.05, y + r * 0.3]], r * 0.14, withAlpha(INK, 0.45));
}

function snowflake(ctx, x, y, s) {
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    ctx.moveTo(x - Math.cos(a) * s, y - Math.sin(a) * s);
    ctx.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s);
  }
  ctx.stroke();
}
