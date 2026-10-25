// Icône de l'application dessinée en code, à la manière d'une estampe : lanterne-
// gardienne de feu (niveau 3) devant une pleine lune voilée de brume (kasumi),
// colline de mousse et vagues seigaiha, sur un ciel indigo au grain de papier.
import { drawTower } from './towers.js';
import { INK, PALETTE, withAlpha, wash, seeded, brushStroke, quadPts } from './brush.js';
import towers from '../../data/towers.js';

export function drawIcon(ctx, size, maskable = false) {
  const s = size;
  const rnd = seeded(7);
  const k = maskable ? 0.78 : 1; // zone de sécurité des icônes « maskable »
  // hauteur v (0..1) dans le repère réduit : le décor du bas reste plein cadre
  const Y = (v) => s / 2 + (v * s - s / 2) * k;

  // ciel indigo + grain de papier (fibres claires)
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, '#2f4573');
  g.addColorStop(1, '#152036');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = withAlpha(PALETTE.cream, 0.05);
  ctx.lineWidth = Math.max(1, s * 0.003);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const l = s * (0.02 + rnd() * 0.05);
    const a = rnd() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }

  // pleine lune crème, halo doux, liseré d'encre diluée
  const mx = s * 0.5;
  const my = Y(0.4);
  const mr = s * 0.3 * k;
  wash(ctx, mx, my, mr * 1.55, PALETTE.goldLight, 0.3);
  ctx.fillStyle = PALETTE.cream;
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fill();
  wash(ctx, mx + mr * 0.3, my + mr * 0.25, mr * 0.9, PALETTE.gold, 0.18);
  ctx.strokeStyle = withAlpha(INK, 0.3);
  ctx.lineWidth = s * 0.008;
  ctx.stroke();

  // bandes de brume indigo (kasumi) qui voilent la lune
  ctx.fillStyle = withAlpha('#4a5f8c', 0.95);
  ctx.strokeStyle = withAlpha(INK, 0.45);
  ctx.lineWidth = s * 0.006;
  for (const [x, y, w] of [[0.02, 0.47, 0.4], [0.6, 0.29, 0.38], [0.68, 0.55, 0.3]]) {
    ctx.beginPath();
    ctx.roundRect(s / 2 + (s * x - s / 2) * k, Y(y), s * w * k, s * 0.042 * k, s * 0.021 * k);
    ctx.fill();
    ctx.stroke();
  }

  // colline de mousse au contour de pinceau (plein cadre)
  ctx.fillStyle = PALETTE.mossDark;
  ctx.beginPath();
  ctx.moveTo(0, s);
  ctx.lineTo(0, Y(0.84));
  ctx.quadraticCurveTo(s * 0.5, Y(0.7), s, Y(0.84));
  ctx.lineTo(s, s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PALETTE.moss;
  ctx.beginPath();
  ctx.moveTo(0, s);
  ctx.lineTo(0, Y(0.885));
  ctx.quadraticCurveTo(s * 0.45, Y(0.765), s, Y(0.9));
  ctx.lineTo(s, s);
  ctx.closePath();
  ctx.fill();
  brushStroke(ctx, quadPts(0, Y(0.882), s * 0.45, Y(0.762), s, Y(0.898), 16), s * 0.012, INK, { alpha: 0.7 });

  // vagues seigaiha au pied de la colline (plein cadre)
  const wy = Y(0.94);
  const r = s * 0.06 * k;
  let row = 0;
  for (let y = wy; y < s + r; y += r * 0.55, row++) {
    for (let x = -r + (row % 2) * r; x < s + r; x += r * 2) {
      ctx.fillStyle = row % 2 ? PALETTE.indigo : '#2a3f69';
      ctx.beginPath();
      ctx.arc(x, y, r, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = withAlpha('#a9c0e6', 0.6);
      ctx.lineWidth = s * 0.004;
      ctx.beginPath();
      for (const q of [0.86, 0.5]) {
        ctx.moveTo(x - r * q, y);
        ctx.arc(x, y, r * q, Math.PI, 0);
      }
      ctx.stroke();
    }
  }

  // lumière de la lanterne sur la mousse, puis la lanterne elle-même
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.scale(k, k);
  ctx.translate(-s / 2, -s / 2);
  wash(ctx, s * 0.5, s * 0.8, s * 0.3, '#ffb35c', 0.5);
  const ts = s * 0.5;
  drawTower(ctx, s * 0.5, s * 0.85 - ts * 0.34, ts, towers.fire, 3, 0.35, {});
  ctx.restore();
}
