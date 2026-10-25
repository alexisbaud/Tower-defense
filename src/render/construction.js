// Constructions en cours (délai de construction, rules.buildTime = 2 s).
//
// Une pose n'est active qu'à la fin de sa construction ; d'ici là, elle se voit :
//   - lanterne : pâle (grisée) dans un échafaudage de bambou ; la couleur et l'encre
//     la remplissent du pied au toit à mesure que la construction avance ;
//   - pierre : pierre fantôme qui descend se poser sur le gravier ;
//   - mur déplacé : le mur neuf monte de terre sur sa nouvelle case, relié au Gardien.
// Un anneau au sol (perspective) montre l'avancement ; un petit sceau 建 dit
// « en construction » sans la couleur. Chez un coéquipier, l'anneau et le liseré
// prennent la couleur de son élément ; chez soi, l'or.
//
// `b` : construction décrite par l'interface (src/ui/commands.js, builds()) :
// { op, c, r, k (0 → 1), type, towerId, mine, pid }. Repère du plateau, px CSS.
import { drawTower } from './towers.js';
import { drawStone } from './combos.js';
import { drawWallGhost } from './barriers.js';
import { INK, PALETTE, withAlpha, wash } from './brush.js';

const TAU = Math.PI * 2;
const GROUND = 0.34; // pied d'une lanterne sous le centre de sa case (cf. towers.js)
const BAMBOO = '#a8935a';
const BAMBOO_DARK = '#6d5c30';
// Haut de chaque lanterne (en cases, depuis le centre de la case), relevé au premier
// dessin (drawTower le renvoie) : l'encre monte jusqu'au toit.
const tops = new Map();

const clamp01 = (k) => (k > 0 ? (k < 1 ? k : 1) : 0);

// Anneau d'avancement au sol : fond d'encre (ou liseré du joueur), arc qui se remplit.
function progressRing(ctx, x, y, ts, k, color, rim) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(3, ts * 0.085);
  ctx.strokeStyle = rim ? withAlpha(rim, 0.6) : withAlpha(INK, 0.32);
  ctx.beginPath();
  ctx.ellipse(x, y, ts * 0.42, ts * 0.16, 0, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = Math.max(1.8, ts * 0.05);
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, ts * 0.42, ts * 0.16, 0, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, k) * TAU);
  ctx.stroke();
  ctx.restore();
}

// Sceau 建 (« bâtir ») : disque d'encre cerné de la couleur du joueur.
function buildSeal(ctx, x, y, ts, accent) {
  const r = Math.max(7, ts * 0.17);
  ctx.save();
  ctx.fillStyle = withAlpha(INK, 0.88);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1.5, ts * 0.035);
  ctx.stroke();
  ctx.fillStyle = PALETTE.cream;
  ctx.font = `800 ${Math.round(r * 1.25)}px "Shippori Mincho", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('建', x, y + r * 0.06);
  ctx.restore();
}

// Échafaudage de bambou autour de la lanterne : deux perches, trois traverses
// liées ; il s'efface à la fin de la construction.
function scaffold(ctx, x, foot, top, ts, alpha) {
  if (alpha <= 0.01) return;
  const hw = ts * 0.4;
  const y0 = foot + ts * 0.04;
  const y1 = top - ts * 0.06;
  const ties = [0.18, 0.5, 0.82].map((f) => y0 + (y1 - y0) * f);
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(x - hw, y0);
    ctx.lineTo(x - hw * 0.92, y1);
    ctx.moveTo(x + hw, y0);
    ctx.lineTo(x + hw * 0.92, y1);
    for (const y of ties) {
      ctx.moveTo(x - hw * 1.08, y);
      ctx.lineTo(x + hw * 1.08, y + ts * 0.02);
    }
    // contrevent en diagonale
    ctx.moveTo(x - hw, ties[0]);
    ctx.lineTo(x + hw * 0.95, ties[1]);
  };
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.lineCap = 'round';
  path();
  ctx.strokeStyle = withAlpha(INK, 0.75);
  ctx.lineWidth = Math.max(2.4, ts * 0.065);
  ctx.stroke();
  path();
  ctx.strokeStyle = BAMBOO;
  ctx.lineWidth = Math.max(1.2, ts * 0.035);
  ctx.stroke();
  // ligatures (nœuds de corde) aux croisements
  ctx.fillStyle = BAMBOO_DARK;
  for (const y of ties) {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(x + s * hw * 0.98, y, Math.max(1.2, ts * 0.03), 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Lanterne en construction.
 * opts : { grey: { c, w, h, ax, ay } (lanterne grisée pré-rendue), color (liseré
 *          d'un coéquipier, sinon or) }
 */
export function drawTowerBuild(ctx, b, def, ts, time, opts = {}) {
  const x = (b.c + 0.5) * ts;
  const y = (b.r + 0.5) * ts;
  const k = clamp01(b.k);
  const foot = y + GROUND * ts;
  const top = y + (tops.get(def) ?? -1.25) * ts;
  const accent = opts.color || PALETTE.gold;
  wash(ctx, x, foot, ts * 0.5, opts.color || PALETTE.goldLight, 0.22);
  progressRing(ctx, x, foot, ts, k, accent, opts.color);
  // lanterne pâle (ce qui reste à bâtir)
  if (opts.grey) {
    const g = opts.grey;
    ctx.save();
    ctx.globalAlpha *= 0.5;
    ctx.drawImage(g.c, x - g.ax, y - g.ay, g.w, g.h);
    ctx.restore();
  }
  // partie bâtie : couleur et encre montent du pied vers le toit
  const fill = foot - (foot - top) * k;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - ts, fill, ts * 2, foot - fill + ts * 0.5);
  ctx.clip();
  const res = drawTower(ctx, x, y, ts, def, 1, time, { alpha: 0.95 });
  ctx.restore();
  if (res && !tops.has(def)) tops.set(def, (res.top - y) / ts);
  // niveau de l'encre : trait de pinceau qui monte
  if (k > 0.02 && k < 0.98) {
    ctx.save();
    ctx.strokeStyle = withAlpha(accent, 0.9);
    ctx.lineWidth = Math.max(1.5, ts * 0.04);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - ts * 0.3, fill);
    ctx.quadraticCurveTo(x, fill - ts * 0.03, x + ts * 0.3, fill);
    ctx.stroke();
    ctx.restore();
  }
  scaffold(ctx, x, foot, top, ts, k < 0.8 ? 1 : (1 - k) / 0.2);
  buildSeal(ctx, x + ts * 0.36, y - ts * 0.2, ts, accent);
}

/**
 * Pierre en construction : elle descend se poser (son ombre grandit).
 * opts : { seed (graine du dessin de la pierre), snow, color }
 */
export function drawStoneBuild(ctx, b, ts, time, opts = {}) {
  const x = (b.c + 0.5) * ts;
  const y = (b.r + 0.5) * ts;
  const k = clamp01(b.k);
  const e = k * k;
  const accent = opts.color || PALETTE.indigoLight;
  progressRing(ctx, x, y + ts * 0.2, ts, k, accent, opts.color);
  wash(ctx, x, y + ts * 0.18, ts * (0.2 + 0.25 * k), INK, 0.12 + 0.2 * k);
  ctx.save();
  ctx.globalAlpha *= 0.35 + 0.45 * k;
  drawStone(ctx, x, y - (1 - e) * ts * 0.55, ts, opts.seed ?? 11, !!opts.snow);
  ctx.restore();
  buildSeal(ctx, x + ts * 0.36, y - ts * 0.3, ts, accent);
}

/**
 * Mur déplacé en construction : le mur neuf sur sa case, relié à son Gardien.
 * opts : { from: { x, y } (Gardien, en cases), seed (index de la case), color }
 */
export function drawRallyBuild(ctx, b, ts, time, opts = {}) {
  const x = (b.c + 0.5) * ts;
  const y = (b.r + 0.5) * ts;
  const k = clamp01(b.k);
  const accent = opts.color || PALETTE.gold;
  if (opts.from) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([ts * 0.04, ts * 0.11]);
    ctx.lineDashOffset = -time * ts * 0.4;
    ctx.strokeStyle = withAlpha(accent, 0.7);
    ctx.lineWidth = Math.max(1.4, ts * 0.035);
    ctx.beginPath();
    const fx = opts.from.x * ts;
    const fy = opts.from.y * ts + ts * 0.2;
    ctx.moveTo(fx, fy);
    ctx.quadraticCurveTo((fx + x) / 2, (fy + y) / 2 + ts * 0.25, x, y + ts * 0.15);
    ctx.stroke();
    ctx.restore();
  }
  progressRing(ctx, x, y + ts * 0.22, ts, k, accent, opts.color);
  drawWallGhost(ctx, x, y, opts.seed ?? 0, ts, k);
  buildSeal(ctx, x + ts * 0.38, y - ts * 0.32, ts, accent);
}
