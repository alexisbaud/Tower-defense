// Yokai dessinés à l'encre. Chaque `look` correspond à une fonction de dessin.
import { INK, PALETTE, withAlpha, wash, brushStroke, quadPts } from './brush.js';

const LOOKS = {
  kodama(ctx, e, r, t) {
    // Petit corps blanc, tête ronde qui oscille, trois trous noirs.
    const tilt = Math.sin(t * 7 + e.seed * 10) * 0.25;
    ctx.fillStyle = '#f6f2e6';
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, r * 0.12);
    // corps
    ctx.beginPath();
    ctx.ellipse(0, r * 0.45, r * 0.45, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // bras
    ctx.beginPath();
    ctx.moveTo(-r * 0.4, r * 0.4);
    ctx.lineTo(-r * 0.7, r * 0.2 + Math.sin(t * 8) * r * 0.1);
    ctx.moveTo(r * 0.4, r * 0.4);
    ctx.lineTo(r * 0.7, r * 0.2 - Math.sin(t * 8) * r * 0.1);
    ctx.stroke();
    // tête
    ctx.save();
    ctx.translate(0, -r * 0.25);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.62, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(-r * 0.22, -r * 0.06, r * 0.1, r * 0.13, 0, 0, Math.PI * 2);
    ctx.ellipse(r * 0.22, -r * 0.06, r * 0.1, r * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, r * 0.24, r * 0.09, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
  kamaitachi(ctx, e, r, t) {
    // Belette élancée, faucilles aux pattes, traînées de vitesse.
    ctx.strokeStyle = withAlpha(INK, 0.35);
    ctx.lineWidth = Math.max(1, r * 0.08);
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(-r * (1 + k * 0.25), -r * 0.2 + k * r * 0.25);
      ctx.lineTo(-r * (1.6 + k * 0.3), -r * 0.2 + k * r * 0.25);
      ctx.stroke();
    }
    const bob = Math.sin(t * 16) * r * 0.08;
    ctx.fillStyle = '#b58a4e';
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, r * 0.11);
    ctx.beginPath();
    ctx.moveTo(-r * 0.9, r * 0.1 + bob);
    ctx.quadraticCurveTo(-r * 0.2, -r * 0.55 + bob, r * 0.55, -r * 0.25 + bob);
    ctx.quadraticCurveTo(r * 0.95, -r * 0.2 + bob, r * 0.85, r * 0.05 + bob);
    ctx.quadraticCurveTo(r * 0.2, r * 0.35 + bob, -r * 0.9, r * 0.1 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // queue
    brushStroke(ctx, quadPts(-r * 0.85, r * 0.05 + bob, -r * 1.3, -r * 0.6, -r * 0.9, -r * 0.9), r * 0.22, '#8c6234');
    // oreille + œil
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.moveTo(r * 0.45, -r * 0.35 + bob);
    ctx.lineTo(r * 0.55, -r * 0.6 + bob);
    ctx.lineTo(r * 0.65, -r * 0.3 + bob);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r * 0.62, -r * 0.12 + bob, r * 0.07, 0, Math.PI * 2);
    ctx.fill();
    // faucilles
    ctx.strokeStyle = '#dfe6ea';
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    ctx.arc(r * 0.1, r * 0.35 + bob, r * 0.35, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();
  },
};

export function drawEnemy(ctx, e, def, x, y, ts, time) {
  const r = (e.size ?? def.size ?? 0.3) * ts;
  const t = time + e.seed * 10;
  ctx.save();
  // Apparition en volute d'encre : fondu + échelle.
  let appear = 1;
  if (e.spawnT > 0) appear = Math.max(0, 1 - e.spawnT / 0.7);
  ctx.globalAlpha *= appear;

  // ombre
  if (!e.flying) {
    ctx.fillStyle = withAlpha(INK, 0.25);
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.85, r * 0.7, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = withAlpha(INK, 0.15);
    ctx.beginPath();
    ctx.ellipse(x, y + r * 1.8, r * 0.6, r * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // aura d'absorption
  if (e.absorb) {
    const colors = { fire: '#e8603c', water: '#5aa0d8', wind: '#b9d7b0', earth: '#c99a2e' };
    wash(ctx, x, y, r * 1.6, colors[e.absorb] || '#ffffff', 0.45 + Math.sin(t * 5) * 0.1);
  }

  ctx.translate(x, y - (e.flying ? r * 0.6 : 0));
  const flip = e.dirX < 0 ? -1 : 1;
  ctx.scale(flip * (0.6 + 0.4 * appear), 0.6 + 0.4 * appear);
  const draw = LOOKS[def.look] || LOOKS.kodama;
  draw(ctx, e, r, t);
  ctx.restore();

  // Flash blanc à l'impact.
  if (e.hitT > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    wash(ctx, x, y, r * 1.2, '#ffffff', e.hitT * 3);
    ctx.restore();
  }

  // États visibles
  if (e.slowT > 0 && e.slowF < 1) {
    ctx.fillStyle = withAlpha('#7fc0f0', 0.7);
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      ctx.arc(x + (k ? r * 0.5 : -r * 0.5), y + r * 0.6 + Math.sin(time * 6 + k) * 2, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (e.burnT > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    wash(ctx, x, y - r * 0.6, r * 0.7, '#ff8a3c', 0.5);
    ctx.restore();
  }

  // Barre de vie au pinceau.
  if (e.hp < e.maxHp && appear >= 1) {
    const w = Math.max(ts * 0.5, r * 1.8);
    const by = y - r * (e.flying ? 2.1 : 1.45);
    ctx.fillStyle = withAlpha(INK, 0.55);
    ctx.fillRect(x - w / 2 - 1, by - 1, w + 2, 5);
    ctx.fillStyle = e.hp / e.maxHp > 0.4 ? PALETTE.moss : PALETTE.vermillion;
    ctx.fillRect(x - w / 2, by, w * Math.max(0, e.hp / e.maxHp), 3);
  }
}
