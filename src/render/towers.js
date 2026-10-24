// Lanternes-gardiennes (tōrō) dessinées au pinceau. Trois niveaux d'évolution :
//  N1 — petite lanterne de pierre
//  N2 — lanterne haute à double toit, liserés d'or, kanji de l'élément
//  N3 — grande lanterne à trois toits, halo doré et esprits en orbite
import { INK, PALETTE, withAlpha, mix, wash } from './brush.js';

const STONE = '#a9a496';
const STONE_DARK = '#6b675d';

export function drawTower(ctx, x, y, ts, def, level, time, opts = {}) {
  const s = ts * (level === 1 ? 0.78 : level === 2 ? 0.92 : 1.04);
  const glow = def.glow;
  const col = def.color;
  const flick = 0.85 + Math.sin(time * 9 + x) * 0.08 + Math.sin(time * 23 + y) * 0.05;
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  const baseY = y + ts * 0.32;

  // Halo au sol (lumière de la lanterne).
  wash(ctx, x, baseY - s * 0.45, s * (0.8 + level * 0.15), glow, 0.18 * flick + (opts.shot ? 0.15 : 0));

  if (level === 3) {
    // Halo doré derrière la lanterne.
    ctx.save();
    ctx.translate(x, baseY - s * 0.62);
    ctx.rotate(time * 0.3);
    ctx.strokeStyle = withAlpha(PALETTE.goldLight, 0.55);
    ctx.lineWidth = Math.max(1, ts * 0.03);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * s * 0.42, Math.sin(a) * s * 0.42);
      ctx.lineTo(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.55);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Ombre portée.
  ctx.fillStyle = withAlpha(INK, 0.28);
  ctx.beginPath();
  ctx.ellipse(x + s * 0.06, baseY, s * 0.34, s * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();

  const lw = Math.max(1, ts * 0.035);
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';

  // Socle (kiso).
  const bw = s * (0.42 + level * 0.03);
  poly(ctx, [
    [x - bw * 0.5, baseY],
    [x + bw * 0.5, baseY],
    [x + bw * 0.4, baseY - s * 0.09],
    [x - bw * 0.4, baseY - s * 0.09],
  ]);
  fillStroke(ctx, STONE);

  // Fût (sao).
  const pillarH = s * (0.22 + level * 0.04);
  ctx.beginPath();
  ctx.rect(x - s * 0.07, baseY - s * 0.09 - pillarH, s * 0.14, pillarH);
  fillStroke(ctx, STONE);
  // Plateau (chūdai).
  const platY = baseY - s * 0.09 - pillarH;
  poly(ctx, [
    [x - s * 0.24, platY],
    [x + s * 0.24, platY],
    [x + s * 0.18, platY - s * 0.07],
    [x - s * 0.18, platY - s * 0.07],
  ]);
  fillStroke(ctx, STONE);

  // Chambre de lumière (hibukuro).
  const boxW = s * 0.3;
  const boxH = s * 0.24;
  const boxY = platY - s * 0.07 - boxH;
  ctx.beginPath();
  ctx.rect(x - boxW / 2, boxY, boxW, boxH);
  fillStroke(ctx, STONE_DARK);
  // fenêtre lumineuse
  const winW = boxW * 0.62;
  const winH = boxH * 0.7;
  const g = ctx.createRadialGradient(x, boxY + boxH / 2, 0, x, boxY + boxH / 2, winW);
  g.addColorStop(0, '#fff6d8');
  g.addColorStop(0.45, glow);
  g.addColorStop(1, col);
  ctx.fillStyle = g;
  ctx.globalAlpha *= 0.75 + flick * 0.25;
  ctx.fillRect(x - winW / 2, boxY + (boxH - winH) / 2, winW, winH);
  ctx.globalAlpha /= 0.75 + flick * 0.25;
  // croisillon
  ctx.strokeStyle = withAlpha(INK, 0.8);
  ctx.lineWidth = lw * 0.7;
  ctx.beginPath();
  ctx.moveTo(x, boxY + (boxH - winH) / 2);
  ctx.lineTo(x, boxY + (boxH + winH) / 2);
  ctx.stroke();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;

  // Toits (kasa) — un par niveau.
  let roofY = boxY;
  for (let k = 0; k < level; k++) {
    const rw = s * (0.62 - k * 0.12);
    const rh = s * (0.14 - k * 0.015);
    drawRoof(ctx, x, roofY, rw, rh, level >= 2 ? PALETTE.gold : null, lw);
    roofY -= rh * (k === level - 1 ? 1 : 0.95);
    if (k < level - 1) {
      // petite chambre intermédiaire
      ctx.beginPath();
      ctx.rect(x - s * 0.08, roofY - s * 0.06, s * 0.16, s * 0.06);
      fillStroke(ctx, STONE_DARK);
      roofY -= s * 0.06;
    }
  }

  // Joyau sommital (hōju).
  ctx.beginPath();
  ctx.moveTo(x, roofY - s * 0.14);
  ctx.quadraticCurveTo(x + s * 0.08, roofY - s * 0.05, x, roofY);
  ctx.quadraticCurveTo(x - s * 0.08, roofY - s * 0.05, x, roofY - s * 0.14);
  fillStroke(ctx, level >= 2 ? PALETTE.gold : STONE);

  // Kanji de l'élément (N2+).
  if (level >= 2) {
    ctx.fillStyle = withAlpha(PALETTE.cream, 0.95);
    ctx.font = `700 ${Math.round(s * 0.15)}px "Shippori Mincho", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.kanji, x, boxY + boxH / 2 + 0.5);
  }

  // Esprits en orbite (N3).
  if (level === 3) {
    for (let k = 0; k < 3; k++) {
      const a = time * 1.6 + (k * Math.PI * 2) / 3;
      const ox = x + Math.cos(a) * s * 0.5;
      const oy = boxY + Math.sin(a) * s * 0.18;
      wash(ctx, ox, oy, s * 0.12, glow, 0.7);
      ctx.fillStyle = '#fffbe8';
      ctx.beginPath();
      ctx.arc(ox, oy, s * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Lueur du tir.
  if (opts.shot) wash(ctx, x, boxY + boxH / 2, s * 0.45, glow, 0.5);

  // Étourdi (frappe du boss) : petites étoiles d'encre.
  if (opts.stunned) {
    ctx.fillStyle = PALETTE.goldLight;
    for (let k = 0; k < 3; k++) {
      const a = time * 4 + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * s * 0.25, roofY - s * 0.2 + Math.sin(a) * s * 0.06, s * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  return { top: roofY - s * 0.14, boxY: boxY + boxH / 2 };
}

function drawRoof(ctx, x, y, w, h, trim, lw) {
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y + h * 0.15);
  ctx.quadraticCurveTo(x - w * 0.3, y - h * 0.1, x - w * 0.12, y - h * 0.75);
  ctx.lineTo(x, y - h);
  ctx.lineTo(x + w * 0.12, y - h * 0.75);
  ctx.quadraticCurveTo(x + w * 0.3, y - h * 0.1, x + w / 2, y + h * 0.15);
  ctx.quadraticCurveTo(x, y - h * 0.05, x - w / 2, y + h * 0.15);
  ctx.closePath();
  fillStroke(ctx, '#55524b');
  if (trim) {
    ctx.save();
    ctx.strokeStyle = trim;
    ctx.lineWidth = lw * 0.9;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + lw, y + h * 0.1);
    ctx.quadraticCurveTo(x, y - h * 0.08, x + w / 2 - lw, y + h * 0.1);
    ctx.stroke();
    ctx.restore();
  }
}

function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function fillStroke(ctx, fill) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
}

// Icône de lanterne pour la palette (canvas 2D hors jeu).
export function drawTowerIcon(ctx, w, h, def, level = 1) {
  ctx.clearRect(0, 0, w, h);
  drawTower(ctx, w / 2, h * 0.62, Math.min(w, h) * 0.9, def, level, 0.3, {});
}

export { mix };
