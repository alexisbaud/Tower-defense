// Icône de l'application dessinée en code : lanterne-gardienne de feu devant
// un soleil vermillon, sur fond indigo et papier.
import { drawTower } from './towers.js';
import { PALETTE, withAlpha, wash } from './brush.js';
import towers from '../../data/towers.js';

export function drawIcon(ctx, size, maskable = false) {
  const s = size;
  // fond indigo + dégradé
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, '#2d4270');
  g.addColorStop(1, '#162238');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const k = maskable ? 0.78 : 1; // zone de sécurité des icônes « maskable »
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.scale(k, k);
  ctx.translate(-s / 2, -s / 2);
  // soleil
  ctx.fillStyle = PALETTE.vermillion;
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 0.42, s * 0.3, 0, Math.PI * 2);
  ctx.fill();
  // bandes de nuages
  ctx.fillStyle = withAlpha('#f2e8d0', 0.92);
  ctx.beginPath();
  ctx.roundRect(s * 0.08, s * 0.5, s * 0.36, s * 0.035, s * 0.02);
  ctx.roundRect(s * 0.6, s * 0.36, s * 0.34, s * 0.035, s * 0.02);
  ctx.fill();
  // collines de mousse
  ctx.fillStyle = '#4f5b2c';
  ctx.beginPath();
  ctx.moveTo(0, s);
  ctx.lineTo(0, s * 0.8);
  ctx.quadraticCurveTo(s * 0.5, s * 0.68, s, s * 0.8);
  ctx.lineTo(s, s);
  ctx.closePath();
  ctx.fill();
  wash(ctx, s * 0.5, s * 0.62, s * 0.3, '#ffb35c', 0.45);
  drawTower(ctx, s * 0.5, s * 0.7, s * 0.5, towers.fire, 3, 0.35, {});
  ctx.restore();
}
