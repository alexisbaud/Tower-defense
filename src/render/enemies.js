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

Object.assign(LOOKS, {
  kappa(ctx, e, r, t) {
    // Tortue-lutin : carapace verte écaillée, bec, coupelle d'eau sur la tête.
    const step = Math.sin(t * 6) * r * 0.06;
    ctx.lineWidth = Math.max(1, r * 0.11);
    ctx.strokeStyle = INK;
    // pattes
    ctx.fillStyle = '#6f8f4a';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * r * 0.45, r * 0.65 + (s > 0 ? step : -step), r * 0.18, r * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // carapace
    ctx.fillStyle = '#4e6b35';
    ctx.beginPath();
    ctx.ellipse(-r * 0.1, r * 0.15, r * 0.72, r * 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = withAlpha('#c9d79a', 0.7);
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath();
    for (const [x, y] of [[-0.35, 0.05], [0.1, -0.05], [-0.1, 0.4]]) {
      ctx.moveTo(x * r + r * 0.18, y * r);
      ctx.arc(x * r, y * r, r * 0.18, 0, Math.PI * 2);
    }
    ctx.stroke();
    // tête
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, r * 0.11);
    ctx.fillStyle = '#8fae5a';
    ctx.beginPath();
    ctx.arc(r * 0.55, -r * 0.3, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // bec
    ctx.fillStyle = '#d9b44a';
    ctx.beginPath();
    ctx.moveTo(r * 0.82, -r * 0.3);
    ctx.lineTo(r * 1.05, -r * 0.2);
    ctx.lineTo(r * 0.8, -r * 0.14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // coupelle d'eau
    ctx.fillStyle = '#e8f0e0';
    ctx.beginPath();
    ctx.ellipse(r * 0.5, -r * 0.62, r * 0.2, r * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(r * 0.66, -r * 0.36, r * 0.06, 0, Math.PI * 2);
    ctx.fill();
  },
  tengu(ctx, e, r, t) {
    // Corbeau-démon : grandes ailes battantes, bec, masque rouge.
    const flap = Math.sin(t * 10);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.fillStyle = '#26232c';
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.scale(s, 1);
      ctx.rotate(-0.3 * flap);
      ctx.beginPath();
      ctx.moveTo(r * 0.1, -r * 0.1);
      ctx.quadraticCurveTo(r * 0.9, -r * 0.9, r * 1.35, -r * 0.35);
      ctx.lineTo(r * 1.0, -r * 0.2);
      ctx.lineTo(r * 1.15, 0);
      ctx.lineTo(r * 0.8, -r * 0.02);
      ctx.lineTo(r * 0.85, r * 0.18);
      ctx.quadraticCurveTo(r * 0.4, r * 0.1, r * 0.1, r * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // corps
    ctx.fillStyle = '#2f2b36';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.1, r * 0.32, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // tête + masque
    ctx.fillStyle = PALETTE.vermillion;
    ctx.beginPath();
    ctx.arc(0, -r * 0.42, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PALETTE.goldLight;
    ctx.beginPath();
    ctx.moveTo(r * 0.15, -r * 0.45);
    ctx.lineTo(r * 0.5, -r * 0.35);
    ctx.lineTo(r * 0.15, -r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(r * 0.06, -r * 0.48, r * 0.06, 0, Math.PI * 2);
    ctx.fill();
  },
  nuppeppo(ctx, e, r, t) {
    // Masse de chair molle, plis, petits yeux endormis.
    const wob = Math.sin(t * 4) * 0.06;
    ctx.fillStyle = '#e8c3b0';
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    ctx.moveTo(-r * 0.75, r * 0.6);
    ctx.quadraticCurveTo(-r * (0.85 + wob), -r * 0.35, -r * 0.2, -r * 0.6);
    ctx.quadraticCurveTo(r * 0.3, -r * (0.78 + wob), r * 0.7, -r * 0.2);
    ctx.quadraticCurveTo(r * (0.95 - wob), r * 0.35, r * 0.7, r * 0.6);
    ctx.quadraticCurveTo(0, r * 0.75, -r * 0.75, r * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = withAlpha('#9a6a58', 0.8);
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, r * 0.25);
    ctx.quadraticCurveTo(0, r * 0.4, r * 0.45, r * 0.22);
    ctx.moveTo(-r * 0.35, r * 0.45);
    ctx.quadraticCurveTo(0, r * 0.55, r * 0.3, r * 0.42);
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    ctx.arc(-r * 0.22, -r * 0.18, r * 0.1, 0.2, Math.PI - 0.2);
    ctx.moveTo(r * 0.32, -r * 0.18);
    ctx.arc(r * 0.22, -r * 0.18, r * 0.1, 0.2, Math.PI - 0.2);
    ctx.stroke();
  },
  kitsune(ctx, e, r, t) {
    // Renard blanc à queues multiples, marques vermillon.
    const sway = Math.sin(t * 5) * 0.25;
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.fillStyle = '#f7f1e3';
    for (let k = -1; k <= 1; k++) {
      ctx.save();
      ctx.translate(-r * 0.55, r * 0.1);
      ctx.rotate(-0.9 + k * 0.45 + sway * 0.4);
      ctx.beginPath();
      ctx.ellipse(-r * 0.45, 0, r * 0.5, r * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = PALETTE.vermillion;
      ctx.beginPath();
      ctx.ellipse(-r * 0.85, 0, r * 0.12, r * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f7f1e3';
      ctx.restore();
    }
    ctx.beginPath();
    ctx.ellipse(0, r * 0.2, r * 0.55, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // tête
    ctx.beginPath();
    ctx.moveTo(r * 0.35, -r * 0.05);
    ctx.lineTo(r * 0.45, -r * 0.65);
    ctx.lineTo(r * 0.62, -r * 0.3);
    ctx.lineTo(r * 0.82, -r * 0.62);
    ctx.lineTo(r * 0.85, -r * 0.2);
    ctx.lineTo(r * 1.1, -r * 0.05);
    ctx.lineTo(r * 0.7, r * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = PALETTE.vermillion;
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.beginPath();
    ctx.moveTo(r * 0.6, -r * 0.12);
    ctx.lineTo(r * 0.8, -r * 0.08);
    ctx.stroke();
  },
  yukionna(ctx, e, r, t) {
    // Femme des neiges : kimono blanc, longs cheveux d'encre, souffle glacé.
    const float = Math.sin(t * 2.5) * r * 0.08;
    ctx.translate(0, float);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, r * 0.09);
    // kimono
    ctx.fillStyle = '#f4f6fa';
    ctx.beginPath();
    ctx.moveTo(-r * 0.25, -r * 0.3);
    ctx.quadraticCurveTo(-r * 0.7, r * 0.5, -r * 0.55, r * 0.85);
    ctx.lineTo(r * 0.55, r * 0.85);
    ctx.quadraticCurveTo(r * 0.7, r * 0.5, r * 0.25, -r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = withAlpha('#7fa6c8', 0.8);
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.2);
    ctx.lineTo(r * 0.15, r * 0.4);
    ctx.stroke();
    // cheveux
    ctx.fillStyle = '#1a1820';
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, -r * 0.55);
    ctx.quadraticCurveTo(-r * 0.55, r * 0.1, -r * 0.45 + Math.sin(t * 3) * r * 0.05, r * 0.5);
    ctx.lineTo(r * 0.45, r * 0.5);
    ctx.quadraticCurveTo(r * 0.55, r * 0.1, r * 0.3, -r * 0.55);
    ctx.closePath();
    ctx.fill();
    // visage
    ctx.fillStyle = '#fbfbff';
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.5, r * 0.22, r * 0.27, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PALETTE.vermillion;
    ctx.fillRect(-r * 0.05, -r * 0.36, r * 0.1, r * 0.04);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.beginPath();
    ctx.moveTo(-r * 0.13, -r * 0.52);
    ctx.lineTo(-r * 0.04, -r * 0.5);
    ctx.moveTo(r * 0.04, -r * 0.5);
    ctx.lineTo(r * 0.13, -r * 0.52);
    ctx.stroke();
  },
  akaoni(ctx, e, r, t) {
    // Ogre rouge : cornes, crocs, massue cloutée (kanabō).
    const breathe = Math.sin(t * 2) * r * 0.03;
    const swing = e.enraged ? Math.sin(t * 8) * 0.4 : Math.sin(t * 2) * 0.15;
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.5, r * 0.07);
    // massue
    ctx.save();
    ctx.translate(r * 0.55, r * 0.05);
    ctx.rotate(-0.6 + swing);
    ctx.fillStyle = '#3b3530';
    ctx.beginPath();
    ctx.moveTo(-r * 0.05, 0);
    ctx.lineTo(r * 0.05, 0);
    ctx.lineTo(r * 0.12, -r * 0.9);
    ctx.lineTo(-r * 0.12, -r * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PALETTE.goldLight;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.arc(0, -r * (0.35 + k * 0.15), r * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // corps
    ctx.fillStyle = e.enraged ? '#e0402a' : '#c8402a';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.25 + breathe, r * 0.55, r * 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // pagne tigré
    ctx.fillStyle = '#d9a63a';
    ctx.fillRect(-r * 0.45, r * 0.45, r * 0.9, r * 0.25);
    ctx.strokeRect(-r * 0.45, r * 0.45, r * 0.9, r * 0.25);
    ctx.fillStyle = INK;
    for (let k = 0; k < 4; k++) ctx.fillRect(-r * 0.38 + k * r * 0.22, r * 0.47, r * 0.06, r * 0.21);
    // tête
    ctx.fillStyle = e.enraged ? '#e0402a' : '#c8402a';
    ctx.beginPath();
    ctx.arc(0, -r * 0.42, r * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // cornes
    ctx.fillStyle = '#f2e8d0';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.2, -r * 0.7);
      ctx.quadraticCurveTo(s * r * 0.35, -r * 1.05, s * r * 0.15, -r * 1.12);
      ctx.lineTo(s * r * 0.08, -r * 0.74);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // yeux + crocs
    ctx.fillStyle = PALETTE.goldLight;
    ctx.beginPath();
    ctx.arc(-r * 0.13, -r * 0.48, r * 0.07, 0, Math.PI * 2);
    ctx.arc(r * 0.13, -r * 0.48, r * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, -r * 0.25);
    ctx.lineTo(-r * 0.1, -r * 0.12);
    ctx.lineTo(-r * 0.05, -r * 0.25);
    ctx.moveTo(r * 0.05, -r * 0.25);
    ctx.lineTo(r * 0.1, -r * 0.12);
    ctx.lineTo(r * 0.15, -r * 0.25);
    ctx.fill();
  },
  gashadokuro(ctx, e, r, t) {
    // Squelette géant : crâne, côtes, mains osseuses, orbites lumineuses.
    const sway = Math.sin(t * 1.5) * r * 0.05;
    const glowCol = { fire: '#ff8a3c', water: '#7fc0f0', wind: '#c8f0c0', earth: '#f0c870' }[e.absorb] || '#9fd4ff';
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.5, r * 0.05);
    ctx.fillStyle = '#ece6d6';
    // cage thoracique
    ctx.beginPath();
    ctx.ellipse(sway, r * 0.35, r * 0.5, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const y = r * (0.12 + k * 0.13);
      ctx.moveTo(sway - r * 0.4, y);
      ctx.quadraticCurveTo(sway, y + r * 0.08, sway + r * 0.4, y);
    }
    ctx.moveTo(sway, r * 0.0);
    ctx.lineTo(sway, r * 0.75);
    ctx.stroke();
    // bras
    for (const s of [-1, 1]) {
      const reach = Math.sin(t * 2 + s) * r * 0.1;
      ctx.lineWidth = Math.max(2, r * 0.1);
      ctx.beginPath();
      ctx.moveTo(sway + s * r * 0.45, r * 0.1);
      ctx.lineTo(sway + s * r * 0.85, r * 0.45 + reach);
      ctx.lineTo(sway + s * r * 0.75, r * 0.8 + reach);
      ctx.stroke();
      ctx.lineWidth = Math.max(1, r * 0.04);
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(sway + s * r * 0.75, r * 0.8 + reach);
        ctx.lineTo(sway + s * r * (0.75 + k * 0.08), r * 0.95 + reach);
        ctx.stroke();
      }
    }
    // crâne
    ctx.lineWidth = Math.max(1.5, r * 0.05);
    ctx.fillStyle = '#f2ecdc';
    ctx.beginPath();
    ctx.ellipse(sway, -r * 0.4, r * 0.42, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(sway - r * 0.22, -r * 0.12, r * 0.44, r * 0.16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sway + s * r * 0.16, -r * 0.42, r * 0.11, r * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    wash(ctx, sway - r * 0.16, -r * 0.42, r * 0.14, glowCol, 0.95);
    wash(ctx, sway + r * 0.16, -r * 0.42, r * 0.14, glowCol, 0.95);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, r * 0.03);
    ctx.beginPath();
    for (let k = -2; k <= 2; k++) {
      ctx.moveTo(sway + k * r * 0.08, -r * 0.12);
      ctx.lineTo(sway + k * r * 0.08, r * 0.04);
    }
    ctx.stroke();
  },
});

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
