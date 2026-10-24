// Rendu du terrain (pré-calculé dans un canvas hors écran) : mousse, gravier
// ratissé façon karesansui, socles de lanternes, arbres, eau, sanctuaire.
import { T } from '../core/grid.js';
import { makeCanvas, seeded, inkCircle, brushStroke, quadPts, withAlpha, mix, PALETTE, INK } from './brush.js';

const WALK = new Set([T.PATH, T.OPEN, T.SPAWN, T.GOAL, T.BRIDGE]);

export function renderTerrain(grid, ts, dpr, theme) {
  const W = grid.cols * ts;
  const H = grid.rows * ts;
  const pad = ts * 0.5;
  const c = makeCanvas((W + pad * 2) * dpr, (H + pad * 2) * dpr);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.translate(pad, pad);
  const rnd = seeded(grid.cols * 31 + grid.rows * 7 + grid.size);
  const th = theme;

  const isWalk = (cc, rr) => grid.inBounds(cc, rr) && WALK.has(grid.type(grid.idx(cc, rr)));
  const typeAt = (cc, rr) => (grid.inBounds(cc, rr) ? grid.type(grid.idx(cc, rr)) : -1);

  // 1. Lavis de mousse sous toute la zone non marchable.
  ctx.save();
  for (let r = 0; r < grid.rows; r++) {
    for (let cc = 0; cc < grid.cols; cc++) {
      const t = typeAt(cc, r);
      if (WALK.has(t) || t === T.WATER || t === T.VOID) continue;
      const x = cc * ts + ts / 2;
      const y = r * ts + ts / 2;
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = withAlpha(k === 0 ? th.grass : th.grassDark, k === 0 ? 0.35 : 0.12);
        inkCircle(ctx, x + (rnd() - 0.5) * ts * 0.3, y + (rnd() - 0.5) * ts * 0.3, ts * (0.62 + rnd() * 0.2), rnd, 0.12);
        ctx.fill();
      }
    }
  }
  ctx.restore();

  // 2. Eau : indigo et vagues seigaiha.
  for (let r = 0; r < grid.rows; r++) {
    for (let cc = 0; cc < grid.cols; cc++) {
      if (typeAt(cc, r) !== T.WATER) continue;
      const x = cc * ts;
      const y = r * ts;
      ctx.fillStyle = th.water;
      ctx.fillRect(x - 0.5, y - 0.5, ts + 1, ts + 1);
      ctx.strokeStyle = withAlpha(PALETTE.cream, 0.55);
      ctx.lineWidth = Math.max(1, ts * 0.03);
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const wx = x + (col + (row % 2) * 0.5) * (ts / 2.5);
          const wy = y + row * (ts / 3) + ts / 3;
          for (let k = 1; k <= 3; k++) {
            ctx.beginPath();
            ctx.arc(wx, wy, (ts / 7) * (k / 3) * 1.6, Math.PI, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    }
  }

  // 3. Chemins : bande de gravier crème bordée d'encre.
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const drawPathNet = (width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let r = 0; r < grid.rows; r++) {
      for (let cc = 0; cc < grid.cols; cc++) {
        if (!isWalk(cc, r)) continue;
        const x = cc * ts + ts / 2;
        const y = r * ts + ts / 2;
        ctx.moveTo(x, y);
        ctx.lineTo(x + 0.01, y);
        if (isWalk(cc + 1, r)) {
          ctx.moveTo(x, y);
          ctx.lineTo(x + ts, y);
        }
        if (isWalk(cc, r + 1)) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + ts);
        }
      }
    }
    ctx.stroke();
  };
  drawPathNet(ts * 0.98, withAlpha(INK, 0.55));
  drawPathNet(ts * 0.9, mix(th.path, '#b9a77c', 0.35));
  drawPathNet(ts * 0.82, th.path);
  ctx.restore();

  // Zones ouvertes : remplissage carré + pointillés (on peut y poser des pierres).
  for (let r = 0; r < grid.rows; r++) {
    for (let cc = 0; cc < grid.cols; cc++) {
      if (typeAt(cc, r) !== T.OPEN) continue;
      const x = cc * ts;
      const y = r * ts;
      ctx.fillStyle = mix(th.path, '#cdbb8e', 0.25);
      ctx.fillRect(x + ts * 0.04, y + ts * 0.04, ts * 0.92, ts * 0.92);
      ctx.strokeStyle = withAlpha(INK, 0.28);
      ctx.setLineDash([ts * 0.06, ts * 0.08]);
      ctx.lineWidth = Math.max(1, ts * 0.025);
      ctx.strokeRect(x + ts * 0.1, y + ts * 0.1, ts * 0.8, ts * 0.8);
      ctx.setLineDash([]);
    }
  }

  // Ratissage : lignes parallèles selon la direction du chemin.
  ctx.save();
  ctx.strokeStyle = withAlpha('#8a7a55', 0.45);
  ctx.lineWidth = Math.max(0.8, ts * 0.02);
  ctx.lineCap = 'round';
  for (let r = 0; r < grid.rows; r++) {
    for (let cc = 0; cc < grid.cols; cc++) {
      const t = typeAt(cc, r);
      if (!WALK.has(t) || t === T.BRIDGE) continue;
      const x = cc * ts;
      const y = r * ts;
      const n = isWalk(cc, r - 1);
      const s = isWalk(cc, r + 1);
      const e = isWalk(cc + 1, r);
      const w = isWalk(cc - 1, r);
      const lines = [-0.22, 0, 0.22];
      ctx.beginPath();
      if (t === T.OPEN) {
        for (const k of [0.16, 0.3]) {
          ctx.moveTo(x + ts / 2 + ts * k, y + ts / 2);
          ctx.arc(x + ts / 2, y + ts / 2, ts * k, 0, Math.PI * 2);
        }
      } else if ((e || w) && !(n || s)) {
        for (const k of lines) {
          ctx.moveTo(x + (w ? 0 : ts * 0.3), y + ts / 2 + k * ts);
          ctx.lineTo(x + (e ? ts : ts * 0.7), y + ts / 2 + k * ts);
        }
      } else if ((n || s) && !(e || w)) {
        for (const k of lines) {
          ctx.moveTo(x + ts / 2 + k * ts, y + (n ? 0 : ts * 0.3));
          ctx.lineTo(x + ts / 2 + k * ts, y + (s ? ts : ts * 0.7));
        }
      } else if ((n || s) && (e || w) && (n + s + e + w === 2)) {
        // Virage : arcs concentriques centrés sur le coin intérieur.
        const cx = x + (e ? ts : 0);
        const cy = y + (s ? ts : 0);
        let a0;
        if (e && s) a0 = Math.PI;
        else if (w && s) a0 = Math.PI * 1.5;
        else if (w && n) a0 = 0;
        else a0 = Math.PI / 2;
        for (const k of lines) {
          const rad = ts / 2 + k * ts;
          ctx.moveTo(cx + Math.cos(a0) * rad, cy + Math.sin(a0) * rad);
          ctx.arc(cx, cy, rad, a0, a0 + Math.PI / 2);
        }
      } else {
        for (const k of [0.14, 0.28]) {
          ctx.moveTo(x + ts / 2 + ts * k, y + ts / 2);
          ctx.arc(x + ts / 2, y + ts / 2, ts * k, 0, Math.PI * 2);
        }
      }
      ctx.stroke();
    }
  }
  ctx.restore();

  // Pont : planches vermillon.
  for (let r = 0; r < grid.rows; r++) {
    for (let cc = 0; cc < grid.cols; cc++) {
      if (typeAt(cc, r) !== T.BRIDGE) continue;
      const x = cc * ts;
      const y = r * ts;
      const horiz = isWalk(cc - 1, r) || isWalk(cc + 1, r);
      ctx.fillStyle = '#8b5a3a';
      ctx.fillRect(x, y + ts * 0.12, ts, ts * 0.76);
      ctx.strokeStyle = withAlpha(INK, 0.6);
      ctx.lineWidth = Math.max(1, ts * 0.03);
      for (let k = 0; k <= 5; k++) {
        ctx.beginPath();
        if (horiz) {
          ctx.moveTo(x + (k * ts) / 5, y + ts * 0.14);
          ctx.lineTo(x + (k * ts) / 5, y + ts * 0.86);
        } else {
          ctx.moveTo(x + ts * 0.02, y + (k * ts) / 5);
          ctx.lineTo(x + ts * 0.98, y + (k * ts) / 5);
        }
        ctx.stroke();
      }
      ctx.fillStyle = PALETTE.vermillion;
      if (horiz) {
        ctx.fillRect(x, y + ts * 0.06, ts, ts * 0.1);
        ctx.fillRect(x, y + ts * 0.84, ts, ts * 0.1);
      } else {
        ctx.fillRect(x + ts * 0.06, y, ts * 0.1, ts);
        ctx.fillRect(x + ts * 0.84, y, ts * 0.1, ts);
      }
    }
  }

  // 4. Socles de lanternes : disque de pierre plat.
  for (let r = 0; r < grid.rows; r++) {
    for (let cc = 0; cc < grid.cols; cc++) {
      if (typeAt(cc, r) !== T.SLOT) continue;
      const x = cc * ts + ts / 2;
      const y = r * ts + ts / 2;
      ctx.fillStyle = withAlpha(INK, 0.18);
      ctx.beginPath();
      ctx.ellipse(x + ts * 0.03, y + ts * 0.1, ts * 0.4, ts * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = mix(PALETTE.stone, th.paper, 0.35);
      inkCircle(ctx, x, y + ts * 0.04, ts * 0.38, rnd, 0.05);
      ctx.fill();
      ctx.strokeStyle = withAlpha(INK, 0.55);
      ctx.lineWidth = Math.max(1, ts * 0.035);
      ctx.stroke();
      ctx.strokeStyle = withAlpha(INK, 0.18);
      ctx.lineWidth = Math.max(1, ts * 0.02);
      ctx.beginPath();
      ctx.arc(x, y + ts * 0.04, ts * 0.26, 0.2, Math.PI * 1.3);
      ctx.stroke();
    }
  }

  // 5. Herbes : petites touches de pinceau.
  for (let r = 0; r < grid.rows; r++) {
    for (let cc = 0; cc < grid.cols; cc++) {
      const t = typeAt(cc, r);
      if (t !== T.GRASS && t !== T.TREE) continue;
      for (let k = 0; k < 3; k++) {
        const x = cc * ts + rnd() * ts;
        const y = r * ts + rnd() * ts;
        const h = ts * (0.12 + rnd() * 0.12);
        brushStroke(ctx, quadPts(x, y, x + h * 0.2, y - h * 0.6, x + h * 0.4, y - h), ts * 0.04, withAlpha(th.grassDark, 0.7));
        brushStroke(ctx, quadPts(x + ts * 0.04, y, x, y - h * 0.5, x - h * 0.3, y - h * 0.8), ts * 0.035, withAlpha(th.grassDark, 0.6));
      }
    }
  }

  // 6. Rochers.
  for (let r = 0; r < grid.rows; r++) {
    for (let cc = 0; cc < grid.cols; cc++) {
      if (typeAt(cc, r) !== T.ROCK) continue;
      drawRock(ctx, cc * ts + ts / 2, r * ts + ts * 0.58, ts * 0.36, rnd, th);
    }
  }

  // 7. Arbres (pins stylisés), triés par rangée pour la profondeur.
  for (let r = 0; r < grid.rows; r++) {
    for (let cc = 0; cc < grid.cols; cc++) {
      if (typeAt(cc, r) !== T.TREE) continue;
      drawPine(ctx, cc * ts + ts / 2, r * ts + ts * 0.85, ts, rnd, th);
    }
  }

  // 8. Sanctuaire (torii) sur la case objectif.
  for (const gi of grid.goals) {
    drawTorii(ctx, grid.cx(gi) * ts, grid.cy(gi) * ts, ts);
  }

  return { canvas: c, pad };
}

export function drawRock(ctx, x, y, r, rnd, th) {
  ctx.fillStyle = withAlpha(INK, 0.2);
  ctx.beginPath();
  ctx.ellipse(x + r * 0.15, y + r * 0.45, r * 1.05, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - r, y + r * 0.35);
  ctx.quadraticCurveTo(x - r * 0.9, y - r * 0.6, x - r * 0.2, y - r * 0.8);
  ctx.quadraticCurveTo(x + r * 0.6, y - r * 0.9, x + r, y + r * 0.3);
  ctx.closePath();
  ctx.fillStyle = PALETTE.stone;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.stroke();
  ctx.fillStyle = withAlpha(th.grass, 0.8);
  ctx.beginPath();
  ctx.ellipse(x - r * 0.25, y - r * 0.55, r * 0.35, r * 0.15, -0.3, 0, Math.PI * 2);
  ctx.fill();
  brushStroke(ctx, quadPts(x - r * 0.1, y - r * 0.4, x + r * 0.2, y, x + r * 0.1, y + r * 0.3), r * 0.12, withAlpha(INK, 0.5));
}

export function drawPine(ctx, x, y, ts, rnd, th) {
  const h = ts * (0.9 + rnd() * 0.25);
  // ombre portée
  ctx.fillStyle = withAlpha(INK, 0.18);
  ctx.beginPath();
  ctx.ellipse(x + ts * 0.08, y, ts * 0.42, ts * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  // tronc
  brushStroke(ctx, quadPts(x, y, x - ts * 0.08, y - h * 0.5, x + ts * 0.05, y - h * 0.85), ts * 0.11, '#4a3526', {
    taperIn: 0.05,
    taperOut: 0.6,
  });
  // nuages de feuillage (style pin japonais)
  const tiers = [
    [-0.18, 0.55, 0.36],
    [0.16, 0.7, 0.3],
    [-0.02, 0.88, 0.26],
  ];
  for (const [dx, dy, rr] of tiers) {
    const cx = x + dx * ts;
    const cy = y - dy * h;
    const rad = rr * ts;
    ctx.fillStyle = th.grassDark;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rad, rad * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = mix(th.grass, th.grassDark, 0.3);
    ctx.beginPath();
    ctx.ellipse(cx - rad * 0.1, cy - rad * 0.15, rad * 0.85, rad * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(INK, 0.7);
    ctx.lineWidth = Math.max(1, ts * 0.025);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rad, rad * 0.55, 0, Math.PI * 0.05, Math.PI * 0.95);
    ctx.stroke();
    if (th.snowCaps) {
      ctx.fillStyle = '#f7f4ee';
      ctx.beginPath();
      ctx.ellipse(cx - rad * 0.1, cy - rad * 0.3, rad * 0.8, rad * 0.22, 0, Math.PI, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawTorii(ctx, x, y, ts) {
  const w = ts * 0.92;
  const h = ts * 0.95;
  const base = y + ts * 0.32;
  ctx.fillStyle = withAlpha(INK, 0.25);
  ctx.beginPath();
  ctx.ellipse(x, base + ts * 0.03, w * 0.6, ts * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  const red = PALETTE.vermillion;
  ctx.fillStyle = red;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, ts * 0.03);
  // piliers
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.rect(x + s * w * 0.32 - ts * 0.05, base - h, ts * 0.1, h);
    ctx.fill();
    ctx.stroke();
  }
  // nuki (traverse basse)
  ctx.beginPath();
  ctx.rect(x - w * 0.45, base - h * 0.72, w * 0.9, ts * 0.07);
  ctx.fill();
  ctx.stroke();
  // kasagi (linteau courbé)
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.62, base - h * 0.98);
  ctx.quadraticCurveTo(x, base - h * 0.86, x + w * 0.62, base - h * 0.98);
  ctx.lineTo(x + w * 0.56, base - h * 0.88);
  ctx.quadraticCurveTo(x, base - h * 0.78, x - w * 0.56, base - h * 0.88);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = red;
  ctx.beginPath();
  ctx.rect(x - w * 0.5, base - h * 0.88, w, ts * 0.07);
  ctx.fill();
  ctx.stroke();
  // plaque
  ctx.fillStyle = PALETTE.gold;
  ctx.fillRect(x - ts * 0.05, base - h * 0.84, ts * 0.1, ts * 0.12);
}
