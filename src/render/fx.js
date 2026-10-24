// Particules et effets visuels déclenchés par les événements du moteur.
// Toutes les positions sont en unités de case ; la conversion en pixels se fait au dessin.
//
// Style : formes au pinceau (pétales échancrés, feuilles nervurées, gouttes, taches
// d'encre éclaboussées, volutes effilées, traits de vent), palette de l'estampe.
// Performance : chaque forme est pré-rendue une seule fois par couleur et par échelle
// dans un petit sprite à la résolution physique, puis copiée par drawImage ; la
// rotation passe par setTransform (aucun save/restore par particule). Le nombre de
// particules est borné et les gerbes s'allègent d'elles-mêmes quand l'écran sature.
import { INK, PALETTE, withAlpha, mix, seeded, brushStroke, makeCanvas } from './brush.js';
import { drawTower } from './towers.js';

export const ELEMENT_COLORS = {
  fire: { main: '#e2552f', light: '#ffb35c', dark: '#8c2414' },
  water: { main: '#3f7fb8', light: '#a8d8ff', dark: '#1f3f66' },
  wind: { main: '#9cc3a0', light: '#e8f4e0', dark: '#4f7a5a' },
  earth: { main: '#b0873a', light: '#e8c97a', dark: '#5e4220' },
};

const TAU = Math.PI * 2;
const MAX_PARTS = 460; // particules vivantes (ambiance comprise)
const MAX_GROUND = 36; // traces au sol (taches, fissures, brûlures)
const MAX_TEXTS = 20;
const DUST = '#b59a6a';
const SOUL = '#a9c4ff';
const MIST = '#f4f7f8';

// Style d'impact par élément ; une tour ajoutée hérite du style de son projectile.
const STYLE = { fire: 'ember', water: 'droplet', wind: 'gust', earth: 'boulder' };

// ───────────────────────── sprites pré-rendus ─────────────────────────

// Repère unité : chaque forme est dessinée dans le carré [-1, 1]. Côté nominal du
// sprite en px CSS (multiplié par l'échelle) : proche de la taille affichée, pour
// que la copie réduite reste nette et peu coûteuse.
const SPR = 24;
const SPR_SMALL = 12;
const SMALL = new Set(['petal', 'leaf', 'drop', 'pebble', 'star', 'plus', 'shard', 'flake', 'snow', 'ember']);
const sprites = new Map();

function sprite(kind, color, sc, v = 0) {
  const key = `${kind}|${color}|${sc}|${v}`;
  let c = sprites.get(key);
  if (c) return c;
  const n = Math.ceil((SMALL.has(kind) ? SPR_SMALL : SPR) * sc);
  c = makeCanvas(n, n);
  const g = c.getContext('2d');
  g.translate(n / 2, n / 2);
  g.scale(n / 2, n / 2);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  SHAPES[kind](g, color, v);
  if (sprites.size > 360) sprites.clear();
  sprites.set(key, c);
  return c;
}

// Contour irrégulier lissé (courbes par les milieux) : taches, cailloux.
function blobPath(g, cx, cy, r, rnd, wobble, n = 12) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rr = r * (1 + (rnd() - 0.5) * wobble * 2);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  g.beginPath();
  const m0 = [(pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2];
  g.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  g.closePath();
}

function radial(g, stops) {
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  g.fillStyle = gr;
  g.fillRect(-1, -1, 2, 2);
}

const SHAPES = {
  // Pétale de sakura échancré, cœur plus soutenu à la base.
  petal(g, col) {
    g.beginPath();
    g.moveTo(0, 0.92);
    g.bezierCurveTo(-0.72, 0.5, -0.84, -0.5, -0.34, -0.86);
    g.quadraticCurveTo(-0.12, -0.97, 0, -0.64);
    g.quadraticCurveTo(0.12, -0.97, 0.34, -0.86);
    g.bezierCurveTo(0.84, -0.5, 0.72, 0.5, 0, 0.92);
    g.closePath();
    g.fillStyle = col;
    g.fill();
    const gr = g.createRadialGradient(0, 0.85, 0, 0, 0.85, 1.1);
    gr.addColorStop(0, withAlpha(mix(col, PALETTE.vermillion, 0.5), 0.8));
    gr.addColorStop(1, withAlpha(col, 0));
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 0.08;
    g.strokeStyle = withAlpha(mix(col, '#7a2a35', 0.55), 0.55);
    g.stroke();
  },
  // Feuille effilée avec nervure.
  leaf(g, col) {
    g.beginPath();
    g.moveTo(-0.95, 0);
    g.quadraticCurveTo(-0.15, -0.68, 0.95, 0);
    g.quadraticCurveTo(-0.15, 0.68, -0.95, 0);
    g.closePath();
    g.fillStyle = col;
    g.fill();
    g.lineWidth = 0.09;
    g.strokeStyle = withAlpha(mix(col, INK, 0.6), 0.85);
    g.stroke();
    g.beginPath();
    g.moveTo(-0.85, 0.03);
    g.quadraticCurveTo(0, -0.06, 0.8, 0);
    g.lineWidth = 0.07;
    g.strokeStyle = withAlpha(mix(col, INK, 0.45), 0.75);
    g.stroke();
  },
  // Goutte (pointe vers -y), reflet blanc.
  drop(g, col) {
    g.beginPath();
    g.moveTo(0, -0.96);
    g.bezierCurveTo(0.22, -0.5, 0.58, -0.08, 0.58, 0.34);
    g.arc(0, 0.34, 0.58, 0, Math.PI);
    g.bezierCurveTo(-0.58, -0.08, -0.22, -0.5, 0, -0.96);
    g.closePath();
    g.fillStyle = col;
    g.fill();
    g.lineWidth = 0.1;
    g.strokeStyle = withAlpha(mix(col, PALETTE.indigo, 0.65), 0.8);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.ellipse(-0.2, 0.28, 0.12, 0.22, 0.35, 0, TAU);
    g.fill();
  },
  // Tache d'encre et gouttelettes satellites (3 variantes).
  blot(g, col, v) {
    const rnd = seeded(v * 31 + 7);
    g.fillStyle = col;
    blobPath(g, 0, 0, 0.5, rnd, 0.2, 14);
    g.fill();
    for (let k = 0; k < 4; k++) {
      const a = rnd() * TAU;
      const d = 0.64 + rnd() * 0.18;
      g.beginPath();
      g.arc(Math.cos(a) * d, Math.sin(a) * d, 0.04 + rnd() * 0.08, 0, TAU);
      g.fill();
    }
  },
  // Éclaboussure au sol : flaque irrégulière, courtes coulures épaisses, gouttelettes.
  splat(g, col, v) {
    const rnd = seeded(v * 57 + 3);
    g.fillStyle = col;
    blobPath(g, 0, 0, 0.5, rnd, 0.2, 11);
    g.fill();
    blobPath(g, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5, 0.3, rnd, 0.3, 8);
    g.fill();
    const n = 3 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + rnd() * 1.2;
      const len = 0.62 + rnd() * 0.22;
      brushStroke(g, [[Math.cos(a) * 0.3, Math.sin(a) * 0.3], [Math.cos(a) * (len - 0.1), Math.sin(a) * (len - 0.1)], [Math.cos(a) * len, Math.sin(a) * len]], 0.22, col, { taperIn: 0.05, taperOut: 0.7 });
    }
    for (let k = 0; k < 7; k++) {
      const a = rnd() * TAU;
      const d = 0.62 + rnd() * 0.32;
      g.beginPath();
      g.arc(Math.cos(a) * d, Math.sin(a) * d, 0.03 + rnd() * 0.05, 0, TAU);
      g.fill();
    }
  },
  // Volute d'encre en spirale, trait effilé.
  curl(g, col) {
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const a = t * Math.PI * 2.5;
      const r = 0.1 + t * 0.8;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    brushStroke(g, pts, 0.26, col, { taperIn: 0.6, taperOut: 0.3 });
  },
  // Braise : cœur presque blanc, halo coloré.
  ember(g, col) {
    radial(g, [
      [0, 'rgba(255,250,232,1)'],
      [0.2, withAlpha(mix(col, '#fff6dc', 0.45), 1)],
      [0.48, withAlpha(col, 0.55)],
      [1, withAlpha(col, 0)],
    ]);
  },
  // Lavis doux (lueurs, poussière, vapeur).
  glow(g, col) {
    radial(g, [
      [0, withAlpha(col, 1)],
      [0.5, withAlpha(col, 0.5)],
      [1, withAlpha(col, 0)],
    ]);
  },
  snow(g, col) {
    radial(g, [
      [0, 'rgba(255,255,255,1)'],
      [0.45, 'rgba(255,255,255,0.95)'],
      [0.72, withAlpha(col, 0.55)],
      [1, withAlpha(col, 0)],
    ]);
  },
  // Cristal de neige à six branches.
  flake(g, col) {
    g.strokeStyle = col;
    g.lineWidth = 0.14;
    g.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI + Math.PI / 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      g.moveTo(-c * 0.9, -s * 0.9);
      g.lineTo(c * 0.9, s * 0.9);
      for (const d of [-0.5, 0.5]) {
        const bx = c * d;
        const by = s * d;
        const o = d > 0 ? 1 : -1;
        g.moveTo(bx + (c * 0.28 - s * 0.24) * o, by + (s * 0.28 + c * 0.24) * o);
        g.lineTo(bx, by);
        g.lineTo(bx + (c * 0.28 + s * 0.24) * o, by + (s * 0.28 - c * 0.24) * o);
      }
    }
    g.stroke();
  },
  // Éclat de glace.
  shard(g, col) {
    g.beginPath();
    g.moveTo(0, -1);
    g.lineTo(0.4, -0.1);
    g.lineTo(0, 1);
    g.lineTo(-0.4, -0.1);
    g.closePath();
    g.fillStyle = col;
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.moveTo(0, -1);
    g.lineTo(0.4, -0.1);
    g.lineTo(0, 0.2);
    g.closePath();
    g.fill();
    g.lineWidth = 0.1;
    g.strokeStyle = withAlpha(PALETTE.indigo, 0.7);
    g.beginPath();
    g.moveTo(0, -1);
    g.lineTo(0.4, -0.1);
    g.lineTo(0, 1);
    g.lineTo(-0.4, -0.1);
    g.closePath();
    g.stroke();
  },
  pebble(g, col, v) {
    const rnd = seeded(v * 13 + 5);
    blobPath(g, 0, 0, 0.7, rnd, 0.26, 7);
    g.fillStyle = col;
    g.fill();
    g.lineWidth = 0.16;
    g.strokeStyle = INK;
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.beginPath();
    g.ellipse(-0.2, -0.25, 0.28, 0.14, -0.4, 0, TAU);
    g.fill();
  },
  // Étoile à quatre branches (scintillement).
  star(g, col) {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 ? 0.24 : 1;
      const a = (i / 8) * TAU - Math.PI / 2;
      if (i) g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = col;
    g.fill();
  },
  // Croix de soin, liseré d'encre.
  plus(g, col) {
    g.beginPath();
    g.moveTo(0, -0.7);
    g.lineTo(0, 0.7);
    g.moveTo(-0.7, 0);
    g.lineTo(0.7, 0);
    g.lineWidth = 0.52;
    g.strokeStyle = withAlpha(mix(col, INK, 0.55), 0.8);
    g.stroke();
    g.lineWidth = 0.34;
    g.strokeStyle = col;
    g.stroke();
  },
  // Croissant de vent (trait effilé aux deux bouts).
  slash(g, col) {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = -1.25 + (i / 12) * 2.5;
      pts.push([-0.15 + Math.cos(a) * 0.82, Math.sin(a) * 0.82]);
    }
    brushStroke(g, pts, 0.3, col, { taperIn: 0.5, taperOut: 0.5 });
  },
  // Trait lumineux (tête vers +x) : étincelles, rayons, queues d'âme.
  spark(g, col) {
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push([-0.95 + (i / 8) * 1.85, 0]);
    brushStroke(g, pts, 0.46, col, { taperIn: 0.85, taperOut: 0.12 });
    brushStroke(g, pts, 0.16, 'rgba(255,250,232,0.9)', { taperIn: 0.8, taperOut: 0.15 });
  },
  // Fissures au sol (impact de rocher) : lignes brisées anguleuses et ramifiées.
  crack(g, col, v) {
    const rnd = seeded(v * 71 + 11);
    g.strokeStyle = col;
    const n = 4 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) {
      let a = (k / n) * TAU + rnd() * 0.9;
      let x = Math.cos(a) * 0.14;
      let y = Math.sin(a) * 0.14;
      const segs = 3 + Math.floor(rnd() * 2);
      for (let i = 0; i < segs; i++) {
        a += (rnd() - 0.5) * 1.1;
        const len = 0.18 + rnd() * 0.12;
        const nx = x + Math.cos(a) * len;
        const ny = y + Math.sin(a) * len;
        g.lineWidth = 0.06 * (1 - i / segs) + 0.02;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(nx, ny);
        g.stroke();
        if (i === 1 && rnd() < 0.7) {
          const b = a + (rnd() < 0.5 ? 1 : -1) * (0.6 + rnd() * 0.5);
          g.lineWidth = 0.035;
          g.beginPath();
          g.moveTo(nx, ny);
          g.lineTo(nx + Math.cos(b) * 0.2, ny + Math.sin(b) * 0.2);
          g.stroke();
        }
        x = nx;
        y = ny;
        if (Math.hypot(x, y) > 0.9) break;
      }
    }
    // éclats autour du point d'impact
    g.fillStyle = col;
    for (let k = 0; k < 4; k++) {
      const a = rnd() * TAU;
      const d = 0.06 + rnd() * 0.08;
      g.beginPath();
      g.moveTo(Math.cos(a) * d, Math.sin(a) * d);
      g.lineTo(Math.cos(a + 0.5) * (d + 0.07), Math.sin(a + 0.5) * (d + 0.07));
      g.lineTo(Math.cos(a - 0.3) * (d + 0.05), Math.sin(a - 0.3) * (d + 0.05));
      g.closePath();
      g.fill();
    }
  },
  // Éclat d'impact (feu, terre) : étoile irrégulière, cœur clair, liseré d'encre.
  burst(g, col, v) {
    const rnd = seeded(v * 17 + 2);
    const n = 7;
    g.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? 0.36 + rnd() * 0.1 : 0.8 + rnd() * 0.17;
      const a = (i / (n * 2)) * TAU + (rnd() - 0.5) * 0.25;
      if (i) g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 0.95);
    gr.addColorStop(0, '#fffaf0');
    gr.addColorStop(0.35, mix(col, '#fff6dc', 0.5));
    gr.addColorStop(1, col);
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 0.07;
    g.strokeStyle = mix(col, INK, 0.55);
    g.stroke();
  },
  // Gerbe d'eau : flaque claire et couronne de gouttes, liseré indigo.
  splash(g, col, v) {
    const rnd = seeded(v * 23 + 4);
    const edge = mix(col, PALETTE.indigo, 0.6);
    g.lineWidth = 0.07;
    g.strokeStyle = edge;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU + rnd() * 0.4;
      const d = 0.62 + rnd() * 0.2;
      g.save();
      g.translate(Math.cos(a) * d, Math.sin(a) * d);
      g.rotate(a + Math.PI / 2);
      g.beginPath();
      g.moveTo(0, 0.24);
      g.bezierCurveTo(0.1, 0.08, 0.13, -0.05, 0, -0.14);
      g.bezierCurveTo(-0.13, -0.05, -0.1, 0.08, 0, 0.24);
      g.fillStyle = col;
      g.fill();
      g.stroke();
      g.restore();
    }
    blobPath(g, 0, 0, 0.4, rnd, 0.18, 9);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 0.45);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(1, col);
    g.fillStyle = gr;
    g.fill();
    g.stroke();
  },
  // Âme (hitodama) : flamme pâle en goutte, queue vers -x, cœur blanc, liseré bleuté.
  soul(g, col) {
    g.beginPath();
    g.moveTo(-0.98, 0);
    g.bezierCurveTo(-0.55, -0.12, -0.2, -0.5, 0.25, -0.5);
    g.arc(0.3, 0, 0.5, -Math.PI / 2, Math.PI / 2);
    g.bezierCurveTo(-0.2, 0.5, -0.55, 0.12, -0.98, 0);
    g.closePath();
    const gr = g.createRadialGradient(0.32, 0, 0, 0.32, 0, 1.2);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.35, col);
    gr.addColorStop(1, withAlpha(col, 0.25));
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 0.08;
    g.strokeStyle = withAlpha(mix(col, PALETTE.indigo, 0.6), 0.75);
    g.stroke();
  },
  // Ensō : cercle au pinceau ouvert, effilé aux deux bouts (v : orientation de l'ouverture).
  enso(g, col, v) {
    const pts = [];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      const a = -Math.PI * 0.42 + (v * Math.PI) / 3 + t * Math.PI * 1.82;
      const r = 0.84 + Math.sin(t * 7) * 0.025;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    brushStroke(g, pts, 0.17, col, { taperIn: 0.12, taperOut: 0.45, pressure: (k) => 0.75 + 0.25 * Math.sin(k * Math.PI) });
  },
};

// Échelle de rendu des sprites (arrondie pour limiter les variantes en cache).
function scaleOf(a) {
  return Math.max(1, Math.min(4, Math.round(a * 2) / 2));
}

// Repère de base (échelle uniforme, sans rotation) mémorisé pendant un dessin.
let TA = 1;
let TD = 1;
let TE = 0;
let TF = 0;
function setBase(ctx) {
  const m = ctx.getTransform();
  TA = m.a;
  TD = m.d;
  TE = m.e;
  TF = m.f;
  return m;
}

// Copie un sprite centré en (x, y), de taille w×h, tourné de rot.
function put(ctx, img, x, y, w, h, rot = 0) {
  if (rot) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    ctx.setTransform(TA * c, TD * s, -TA * s, TD * c, TA * x + TE, TD * y + TF);
  } else {
    ctx.setTransform(TA, 0, 0, TD, TA * x + TE, TD * y + TF);
  }
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
}

// ───────────────────────── textes pré-rendus ─────────────────────────

const texts = new Map();
let measure = null;
if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
  // La police arrive après coup : les textes déjà rendus en police de secours sont refaits.
  document.fonts.addEventListener('loadingdone', () => texts.clear());
}

// Texte d'estampe : halo crème, trait d'encre teinté, remplissage en dégradé.
function textSprite(str, color, px, sc) {
  const key = `${str}|${color}|${px}|${sc}`;
  let t = texts.get(key);
  if (t) return t;
  const fs = Math.max(6, Math.round(px * sc));
  const font = `800 ${fs}px "Shippori Mincho", "Hiragino Mincho ProN", serif`;
  if (!measure) measure = makeCanvas(4, 4).getContext('2d');
  measure.font = font;
  const ow = Math.max(1.5, fs * 0.12);
  const w = Math.ceil(measure.measureText(str).width + ow * 4 + 4);
  const h = Math.ceil(fs * 1.3 + ow * 4);
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const cx = w / 2;
  const cy = h / 2 + fs * 0.04;
  g.lineWidth = ow * 3;
  g.strokeStyle = withAlpha(PALETTE.cream, 0.92);
  g.strokeText(str, cx, cy);
  g.lineWidth = ow;
  g.strokeStyle = mix(color, INK, 0.62);
  g.strokeText(str, cx, cy);
  const gr = g.createLinearGradient(0, cy - fs * 0.5, 0, cy + fs * 0.5);
  gr.addColorStop(0, mix(color, '#fff6dc', 0.45));
  gr.addColorStop(0.55, color);
  gr.addColorStop(1, mix(color, INK, 0.2));
  g.fillStyle = gr;
  g.fillText(str, cx, cy);
  t = { c, w: w / sc, h: h / sc };
  if (texts.size > 120) texts.clear();
  texts.set(key, t);
  return t;
}

export class Fx {
  constructor() {
    this.parts = [];
    this.texts = [];
    this.rings = [];
    this.marks = [];
    this.ground = [];
    this.ghosts = [];
    this.trails = new WeakMap();
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '#c8402a';
    this.ambient = 'petals';
    this.ambientT = 0;
    this.bounds = { w: 9, h: 13 };
    this.density = 1;
    this.clock = 0;
    this.game = null;
  }

  reset(bounds, ambient) {
    this.parts.length = 0;
    this.texts.length = 0;
    this.rings.length = 0;
    this.marks.length = 0;
    this.ground.length = 0;
    this.ghosts.length = 0;
    this.trails = new WeakMap();
    this.shake = 0;
    this.flash = 0;
    this.game = null;
    this.bounds = bounds;
    this.ambient = ambient || 'petals';
    // Pré-remplir l'ambiance pour éviter un écran vide au départ.
    for (let i = 0; i < 14; i++) this.spawnAmbient(Math.random() * bounds.h);
  }

  add(p) {
    p.life = p.max = p.life ?? 1;
    p.rot = p.rot ?? Math.random() * TAU;
    p.vr = p.vr ?? 0;
    p.g = p.g ?? 0;
    p.drag = p.drag ?? 0.98;
    if (this.parts.length >= MAX_PARTS) {
      // Saturé : on renonce aux particules secondaires ; les prioritaires
      // (âmes, éclaboussures de mort) remplacent la plus ancienne non prioritaire.
      if (!p.prio) return p;
      const i = this.parts.findIndex((q) => !q.prio);
      if (i >= 0) this.parts[i] = p;
      return p;
    }
    this.parts.push(p);
    return p;
  }

  burst(x, y, n, kind, color, speed = 2, life = 0.6, size = 0.06, extra = {}) {
    n = Math.max(1, Math.round(n * this.density));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
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
        v: (Math.random() * 3) | 0,
        ...extra,
      });
    }
  }

  // Gerbe dirigée vers le haut (gouttes, cailloux) : retombe sous la gravité.
  fountain(x, y, n, kind, color, speed, life, size, extra = {}) {
    n = Math.max(1, Math.round(n * this.density));
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const v = speed * (0.45 + Math.random() * 0.55);
      this.add({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        kind,
        color,
        life: life * (0.7 + Math.random() * 0.5),
        size: size * (0.6 + Math.random() * 0.8),
        v: (Math.random() * 3) | 0,
        drag: 0.97,
        ...extra,
      });
    }
  }

  // squash < 1 : anneau en perspective au sol. r0 > r1 : l'anneau se resserre.
  ring(x, y, r0, r1, color, life = 0.5, width = 0.05, squash = 1) {
    if (this.rings.length > 40) this.rings.shift();
    this.rings.push({ x, y, r0, r1, color, life, max: life, width, squash, a0: Math.random() * TAU });
  }

  text(x, y, str, color = PALETTE.gold, size = 0.34) {
    if (this.texts.length >= MAX_TEXTS) this.texts.shift();
    const t = { x, y, str, color, size, life: 1.1, max: 1.1 };
    this.texts.push(t);
    return t;
  }

  // « +or » doré : les gains simultanés et voisins se cumulent en un seul chiffre.
  goldText(x, y, n) {
    for (const t of this.texts) {
      if (!t.gold || t.max - t.life > 0.35) continue;
      if (Math.abs(t.x - x) > 0.9 || Math.abs(t.y - y) > 0.9) continue;
      t.val += n;
      t.str = `+${t.val}`;
      t.life = t.max;
      return;
    }
    const t = this.text(x, y, `+${n}`, PALETTE.gold, 0.3);
    t.gold = true;
    t.val = n;
  }

  mark(c, r, color = PALETTE.vermillion) {
    this.marks.push({ x: c + 0.5, y: r + 0.5, color, life: 0.75, max: 0.75, seed: Math.random() * 1000 });
  }

  // Trace au sol (sous les entités) : tache d'encre, fissure, brûlure, ondulation.
  decal(kind, x, y, size, color, life = 1.5) {
    if (this.ground.length >= MAX_GROUND) this.ground.shift();
    this.ground.push({ kind, x, y, size, color, life, max: life, v: (Math.random() * 4) | 0 });
  }

  addShake(v) {
    this.shake = Math.min(1, this.shake + v);
  }

  colOf(el) {
    const c = ELEMENT_COLORS[el];
    if (c) return c;
    const def = this.game?.defs?.towers?.[el];
    if (!def?.color) return ELEMENT_COLORS.fire;
    const glow = def.glow || mix(def.color, '#ffffff', 0.5);
    ELEMENT_COLORS[el] = { main: def.color, light: glow, dark: mix(def.color, INK, 0.5) };
    return ELEMENT_COLORS[el];
  }

  styleOf(el) {
    return STYLE[el] || this.game?.defs?.towers?.[el]?.projectile || 'ember';
  }

  // Traînée d'un projectile : positions récentes échantillonnées (unités de case),
  // la dernière suit toujours le projectile.
  trail(p, max = 6) {
    const x = p.x;
    const y = p.y - (p.h || 0);
    let t = this.trails.get(p);
    if (!t) {
      t = [[p.sx ?? x, p.sy ?? y], [x, y]];
      this.trails.set(p, t);
      return t;
    }
    const n = t.length;
    const prev = t[n - 2];
    if (Math.abs(prev[0] - x) + Math.abs(prev[1] - y) > 0.08) {
      t.push([x, y]);
      if (t.length > max) t.shift();
    } else {
      t[n - 1][0] = x;
      t[n - 1][1] = y;
    }
    return t;
  }

  // Même traînée, en points écran (px) pour brushStroke.
  trailPts(p, max, ts) {
    const tr = this.trail(p, max);
    const out = new Array(tr.length);
    for (let i = 0; i < tr.length; i++) out[i] = [tr[i][0] * ts, tr[i][1] * ts];
    return out;
  }

  spawnAmbient(y) {
    const { w } = this.bounds;
    if (this.ambient === 'snow') {
      const big = Math.random() < 0.15;
      this.add({
        x: Math.random() * w,
        y: y ?? -0.3,
        vx: 0.08 + Math.random() * 0.08,
        vy: big ? 0.6 + Math.random() * 0.2 : 0.3 + Math.random() * 0.3,
        kind: 'snow',
        color: '#d6e2f0',
        life: 40,
        size: big ? 0.07 + Math.random() * 0.03 : 0.025 + Math.random() * 0.035,
        alpha: big ? 0.55 : 0.9,
        flake: !big,
        drag: 1,
        amb: true,
      });
    } else {
      const r = Math.random();
      // les pétales dérivent vers la droite : ils naissent aussi un peu à gauche
      this.add({
        x: -1.5 + Math.random() * (w + 1.5),
        y: y ?? -0.3,
        vx: 0.25 + Math.random() * 0.3,
        vy: 0.3 + Math.random() * 0.25,
        kind: 'petal',
        color: r < 0.6 ? '#f2b8c0' : r < 0.88 ? '#f7d9dc' : '#e8949c',
        life: 40,
        size: 0.06 + Math.random() * 0.04,
        vr: (Math.random() - 0.5) * 3,
        ph: Math.random() * TAU,
        drag: 1,
        amb: true,
      });
    }
  }

  // ───────────────────────── événements du moteur ─────────────────────────

  // Traduction des événements du moteur en effets.
  onEvent(ev, game) {
    if (game) this.game = game;
    switch (ev.type) {
      case 'spawn':
        this.spawnFx(ev.enemy.x, ev.enemy.y, 1);
        break;
      case 'spawnChild':
        this.spawnFx(ev.enemy.x, ev.enemy.y, 0.5);
        break;
      case 'shoot':
        this.muzzle(ev);
        break;
      case 'hit':
        this.impact(ev);
        break;
      case 'kill':
        this.death(ev);
        break;
      case 'leak': {
        const e = ev.enemy;
        this.addShake(0.32);
        this.flash = 0.32;
        this.flashColor = PALETTE.vermillion;
        this.ring(e.x, e.y, 0.1, 1, PALETTE.vermillion, 0.6, 0.09, 0.7);
        this.burst(e.x, e.y - 0.1, 8, 'blot', PALETTE.vermillion, 1.8, 0.45, 0.05, { g: 4, drag: 0.9 });
        this.decal('splat', e.x, e.y + 0.1, 0.3, PALETTE.vermillion, 1.4);
        this.text(e.x, e.y - 0.5, `−${ev.damage}`, PALETTE.vermillion, 0.4);
        break;
      }
      case 'place': {
        const t = ev.tower;
        const c = this.colOf(t.type);
        this.ring(t.x, t.y + 0.32, 0.1, 0.7, c.main, 0.5, 0.07, 0.45);
        this.ring(t.x, t.y + 0.32, 0.05, 0.45, INK, 0.35, 0.04, 0.45);
        this.fountain(t.x, t.y + 0.3, 8, 'dust', DUST, 1.2, 0.55, 0.1, { drag: 0.9 });
        this.burst(t.x, t.y - 0.3, 7, 'ember', c.light, 1.3, 0.7, 0.045, { g: -0.9, drag: 0.94 });
        break;
      }
      case 'sell': {
        const t = ev.tower;
        this.burst(t.x, t.y, 10, 'blot', INK, 1.5, 0.5, 0.05, { g: 3, drag: 0.9 });
        this.burst(t.x, t.y - 0.2, 6, 'smoke', MIST, 0.6, 1, 0.16, { g: -0.5, drag: 0.95 });
        this.fountain(t.x, t.y - 0.2, 6, 'ember', PALETTE.goldLight, 1.8, 0.7, 0.05, { g: 3 });
        this.goldText(t.x, t.y - 0.5, ev.value);
        break;
      }
      case 'reject':
        this.mark(ev.c, ev.r);
        this.burst(ev.c + 0.5, ev.r + 0.5, 4, 'blot', PALETTE.vermillion, 1.4, 0.35, 0.035, { drag: 0.88 });
        break;
      case 'fuse':
        this.fuseFx(ev);
        break;
      case 'stone': {
        const x = ev.c + 0.5;
        const y = ev.r + 0.5;
        this.fountain(x, y + 0.2, 10, 'dust', DUST, 1.4, 0.6, 0.11, { drag: 0.9 });
        this.fountain(x, y + 0.1, 4, 'pebble', '#8a8578', 2, 0.45, 0.045, { g: 7, vr: 8 });
        this.ring(x, y + 0.15, 0.1, 0.65, INK, 0.4, 0.05, 0.55);
        if (ev.delta > 0) this.text(x, y - 0.45, `+${ev.delta} cases`, PALETTE.indigoLight, 0.28);
        this.addShake(0.05);
        break;
      }
      case 'unstone': {
        const x = ev.c + 0.5;
        const y = ev.r + 0.5;
        this.fountain(x, y + 0.1, 8, 'dust', DUST, 1.2, 0.5, 0.1, { drag: 0.9 });
        if (ev.refund) this.goldText(x, y - 0.4, ev.refund);
        break;
      }
      case 'combo': {
        const d = ev.def;
        this.ring(ev.x, ev.y, 0.1, d.radius, d.color, 0.8, 0.08, 0.85);
        this.ring(ev.x, ev.y, 0.05, d.radius * 0.6, PALETTE.vermillion, 0.5, 0.05, 0.85);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU;
          this.add({ x: ev.x + Math.cos(a) * 0.15, y: ev.y + Math.sin(a) * 0.15, vx: Math.cos(a) * 2.2, vy: Math.sin(a) * 2.2, kind: 'spark', color: i % 2 ? d.color : PALETTE.goldLight, life: 0.35, size: 0.12, drag: 0.88 });
        }
        this.burst(ev.x, ev.y, 10, 'ember', d.color, 1.4, 0.8, 0.05, { g: -0.6 });
        this.text(ev.x, ev.y - 0.65, d.name, PALETTE.vermillion, 0.3);
        break;
      }
      case 'pulse': {
        const z = ev.zone;
        if (z.def.id === 'frost') {
          this.ring(z.x, z.y, 0.2, z.radius, '#9fd4ff', 0.6, 0.12, 0.85);
          this.ring(z.x, z.y, 0.1, z.radius * 0.7, '#ffffff', 0.45, 0.06, 0.85);
          this.burst(z.x, z.y, 12, 'shard', '#d8f0ff', 2.6, 0.55, 0.07, { drag: 0.9, vr: 6 });
          this.burst(z.x, z.y, 10, 'snow', '#d6e2f0', 2.2, 0.8, 0.045, { drag: 0.93 });
        } else {
          this.ring(z.x, z.y, 0.2, z.radius, z.def.color, 0.6, 0.08, 0.85);
        }
        break;
      }
      case 'tornado': {
        const t = ev.tornado;
        this.ring(t.x, t.y, 0.1, 0.7, '#ff8a3c', 0.45, 0.07, 0.5);
        this.burst(t.x, t.y - 0.2, 10, 'ember', '#ffb35c', 1.5, 0.6, 0.05, { g: -1.2 });
        this.burst(t.x, t.y, 4, 'smoke', '#5d4a40', 0.5, 0.8, 0.15, { g: -0.4 });
        break;
      }
      case 'heal': {
        const e = ev.enemy;
        this.ring(e.x, e.y, 0.1, ev.radius || 1, '#8fbf7a', 0.7, 0.06, 0.8);
        this.burst(e.x, e.y - 0.2, 5, 'plus', '#9fd08a', 0.7, 0.9, 0.09, { g: -0.8, drag: 0.95, rot: 0 });
        break;
      }
      case 'absorb': {
        // L'élément est bu par le yokai : quelques motes convergent vers lui.
        const e = ev.enemy;
        const c = this.colOf(ev.element);
        if (this.density < 0.6) break;
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * TAU;
          this.add({ x: e.x + Math.cos(a) * 0.45, y: e.y - 0.15 + Math.sin(a) * 0.4, vx: -Math.cos(a) * 1.3, vy: -Math.sin(a) * 1.2, kind: 'ember', color: c.light, life: 0.3, size: 0.045, drag: 0.95 });
        }
        break;
      }
      case 'absorbShift': {
        const e = ev.enemy;
        const c = this.colOf(ev.element);
        this.ring(e.x, e.y - 0.2, 0.1, 1, c.main, 0.6, 0.08, 0.85);
        this.burst(e.x, e.y - 0.3, 12, 'ember', c.light, 2, 0.7, 0.06, { drag: 0.92 });
        const k = { fire: '火', water: '水', wind: '風', earth: '土' }[ev.element];
        if (k) this.text(e.x, e.y - 1, k, c.main, 0.42);
        break;
      }
      case 'split': {
        const e = ev.enemy;
        this.burst(e.x, e.y, 6, 'blot', INK, 1.4, 0.4, 0.05, { g: 3, drag: 0.9 });
        this.burst(e.x, e.y, 3, 'curl', INK, 0.9, 0.5, 0.09, { vr: 5, drag: 0.92, alpha: 0.8 });
        break;
      }
      case 'summon': {
        const e = ev.enemy;
        this.ring(e.x, e.y, 0.2, 1.2, INK, 0.7, 0.09, 0.75);
        this.ring(e.x, e.y, 1, 0.1, PALETTE.indigo, 0.6, 0.06, 0.75);
        this.burst(e.x, e.y, 8, 'curl', INK, 1.3, 0.7, 0.12, { vr: -5, drag: 0.93, alpha: 0.8 });
        break;
      }
      case 'stomp': {
        const e = ev.enemy;
        const R = ev.radius || 1.5;
        this.ring(e.x, e.y + 0.2, 0.2, R, INK, 0.55, 0.12, 0.6);
        this.ring(e.x, e.y + 0.2, 0.1, R * 0.7, DUST, 0.7, 0.18, 0.6);
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * TAU;
          this.add({ x: e.x + Math.cos(a) * 0.3, y: e.y + 0.2 + Math.sin(a) * 0.18, vx: Math.cos(a) * 2.2, vy: Math.sin(a) * 1.2, kind: 'dust', color: DUST, life: 0.7, size: 0.16, drag: 0.9 });
        }
        this.decal('crack', e.x, e.y + 0.2, 0.7, INK, 1.8);
        break;
      }
      case 'enrage': {
        const e = ev.enemy;
        this.ring(e.x, e.y - 0.3, 0.2, 1.1, PALETTE.vermillion, 0.6, 0.1, 0.85);
        this.burst(e.x, e.y - 0.4, 8, 'smoke', '#8c2414', 0.9, 0.9, 0.14, { g: -0.8 });
        this.burst(e.x, e.y - 0.4, 10, 'spark', PALETTE.vermillion, 2.6, 0.3, 0.1, { drag: 0.88 });
        this.text(e.x, e.y - 1.15, '怒', PALETTE.vermillion, 0.5);
        this.addShake(0.2);
        break;
      }
      case 'echo': {
        // La lanterne du futur se dédouble en fantôme.
        const t = ev.tower;
        const def = this.game?.defs?.towers?.[t.type];
        if (def) this.ghosts.push({ x: t.x, y: t.y, def, level: t.level, life: 0.85, max: 0.85, mode: 'split' });
        this.ring(t.x, t.y + 0.32, 0.1, 0.8, PALETTE.indigoLight, 0.7, 0.07, 0.45);
        this.burst(t.x, t.y - 0.2, 6, 'wisp', '#b8ccff', 0.6, 0.9, 0.07, { g: -0.6, sway: 0.5 });
        break;
      }
      case 'echoFade': {
        const t = ev.tower;
        const def = this.game?.defs?.towers?.[t.type];
        if (def) this.ghosts.push({ x: t.x, y: t.y, def, level: t.level, life: 0.8, max: 0.8, mode: 'fade' });
        this.burst(t.x, t.y - 0.3, 6, 'wisp', '#b8ccff', 0.5, 0.9, 0.06, { g: -0.8, sway: 0.6 });
        this.burst(t.x, t.y, 3, 'curl', PALETTE.indigoLight, 0.7, 0.6, 0.09, { vr: 4, alpha: 0.7 });
        break;
      }
      case 'rewindStart':
        this.flash = 0.35;
        this.flashColor = PALETTE.indigo;
        this.marks.length = 0;
        break;
      case 'rewindEnd': {
        const { w, h } = this.bounds;
        this.flash = 0.3;
        this.flashColor = PALETTE.cream;
        this.ring(w / 2, h / 2, 0.3, Math.max(w, h) * 0.65, PALETTE.indigoLight, 0.9, 0.16, 0.9);
        this.ring(w / 2, h / 2, 0.2, Math.max(w, h) * 0.4, PALETTE.cream, 0.7, 0.08, 0.9);
        break;
      }
      case 'waveStart': {
        const g = this.game?.grid;
        if (!g) break;
        for (const s of g.spawns) {
          const x = g.cx(s);
          const y = g.cy(s);
          this.ring(x, y, 0.1, 1.2, INK, 0.8, 0.09, 0.8);
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * TAU;
            this.add({ x, y, vx: Math.cos(a) * 1.4, vy: Math.sin(a) * 1.1, kind: 'curl', color: INK, life: 0.7, size: 0.1, rot: a, vr: 5, drag: 0.92, alpha: 0.8 });
          }
        }
        break;
      }
      case 'waveEnd': {
        const g = this.game?.grid;
        if (!g) break;
        for (const gi of g.goals) {
          const x = g.cx(gi);
          const y = g.cy(gi);
          this.ring(x, y, 0.1, 1.3, PALETTE.gold, 0.9, 0.07, 0.7);
          this.burst(x, y - 0.3, 14, 'ember', PALETTE.goldLight, 1.2, 1.3, 0.05, { g: -0.7, drag: 0.96 });
        }
        break;
      }
      case 'win':
      case 'lose': {
        // victoire : gerbe dorée sur le sanctuaire ; défaite : l'encre l'engloutit
        const g = this.game?.grid;
        if (!g) break;
        const win = ev.type === 'win';
        for (const gi of g.goals) {
          const x = g.cx(gi);
          const y = g.cy(gi);
          this.ring(x, y, 0.1, 2, win ? PALETTE.gold : INK, 1.1, 0.1, 0.7);
          if (win) this.burst(x, y - 0.3, 24, 'ember', PALETTE.goldLight, 2.4, 1.4, 0.06, { g: -0.6, drag: 0.95, prio: true });
          else this.burst(x, y, 14, 'blot', INK, 2.2, 0.8, 0.07, { g: 2, drag: 0.9, prio: true });
          if (!win) this.decal('splat', x, y + 0.1, 0.6, INK, 2.5);
        }
        break;
      }
      default:
        break;
    }
  }

  // Apparition : anneau d'encre qui se resserre et deux gouttes projetées. La
  // naissance elle-même (tache qui s'étale, volutes, silhouette qui se dresse)
  // est dessinée par enemies.js : on ne double pas ses volutes.
  spawnFx(x, y, k) {
    this.ring(x, y, 0.6 * k, 0.05, INK, 0.42, 0.06 * k, 0.7);
    this.burst(x, y, Math.max(1, Math.round(2 * k)), 'blot', INK, 1.2, 0.35, 0.03, { g: 3, drag: 0.9 });
  }

  // Départ du tir, à la bouche de la lanterne (discret : les tirs sont fréquents).
  muzzle(ev) {
    if (this.density < 0.6) return;
    const p = ev.projectile;
    const t = ev.tower;
    const x = p ? p.sx : t.x;
    const y = p ? p.sy : t.y - 0.3;
    const c = this.colOf(ev.element);
    const a = ev.echo ? 0.5 : 1;
    switch (this.styleOf(ev.element)) {
      case 'ember':
        this.add({ x, y, vx: 0, vy: 0, kind: 'flare', color: c.light, life: 0.14, size: 0.16, alpha: a });
        this.burst(x, y, 2, 'ember', c.light, 0.9, 0.3, 0.035, { g: -1.2, alpha: a });
        break;
      case 'droplet':
        this.fountain(x, y, 2, 'drop', c.light, 1, 0.35, 0.04, { g: 5, alpha: a });
        break;
      case 'gust': {
        const ang = p ? Math.atan2(p.ty - p.sy, p.tx - p.sx) : 0;
        this.add({ x, y, vx: Math.cos(ang) * 0.8, vy: Math.sin(ang) * 0.8, kind: 'slash', color: c.dark, life: 0.2, size: 0.13, rot: ang, alpha: 0.6 * a });
        break;
      }
      case 'boulder':
        this.burst(x, y, 2, 'dust', DUST, 0.5, 0.35, 0.08, { alpha: a });
        break;
      default:
        this.burst(x, y, 2, 'ember', c.light, 0.8, 0.25, 0.04, { alpha: a });
    }
  }

  // Impact net et lisible, propre à chaque élément.
  impact(ev) {
    const c = this.colOf(ev.element);
    const a = ev.echo ? 0.5 : 1;
    const lv = ev.level || 1;
    const sp = ev.splash || 0;
    const { x, y } = ev;
    switch (this.styleOf(ev.element)) {
      case 'ember':
        this.add({ x, y, vx: 0, vy: 0, kind: 'flare', color: c.light, life: 0.2, size: 0.26 + lv * 0.05, alpha: a });
        this.add({ x, y, vx: 0, vy: 0, kind: 'burst', color: c.light, life: 0.16, size: 0.15 + lv * 0.035, v: (Math.random() * 3) | 0, alpha: a });
        this.burst(x, y, 3 + lv * 2, 'ember', c.light, 1.9, 0.5, 0.05, { g: -1.6, drag: 0.93, alpha: a });
        this.burst(x, y, 2 + lv, 'spark', '#ffc65a', 3.4, 0.22, 0.09, { drag: 0.86, alpha: a });
        if (sp) {
          this.ring(x, y + 0.1, 0.1, sp, c.main, 0.4, 0.06, 0.6);
          this.decal('scorch', x, y + 0.1, sp * 0.8, c.dark, 1);
        }
        break;
      case 'droplet':
        this.add({ x, y, vx: 0, vy: 0, kind: 'splash', color: c.light, life: 0.2, size: 0.15 + lv * 0.03, v: (Math.random() * 3) | 0, alpha: a });
        this.fountain(x, y, 4 + lv * 2, 'drop', c.light, 2.3, 0.5, 0.05, { g: 7, alpha: a });
        this.ring(x, y + 0.08, 0.04, 0.28 + sp, c.main, 0.45, 0.04, 0.55);
        if (lv >= 2) this.burst(x, y, lv, 'shard', '#d8f0ff', 1.6, 0.4, 0.055, { g: 4, vr: 6, alpha: a });
        if (sp) this.ring(x, y + 0.08, 0.1, sp, c.main, 0.5, 0.05, 0.6);
        break;
      case 'gust':
        for (let i = 0; i < 2; i++) {
          const r = Math.random() * TAU;
          this.add({ x, y, vx: Math.cos(r) * 0.4, vy: Math.sin(r) * 0.4, kind: 'slash', color: i ? c.dark : mix(c.main, c.dark, 0.4), life: 0.26, size: 0.18 + lv * 0.025, rot: r, vr: 7, drag: 0.9, alpha: 0.9 * a });
        }
        this.burst(x, y, 1 + lv, 'leaf', c.main, 2.2, 0.65, 0.07, { vr: 9, drag: 0.9, alpha: a });
        this.burst(x, y, 1, 'leaf', '#7f9a4a', 2, 0.6, 0.065, { vr: -8, drag: 0.9, alpha: a });
        break;
      case 'boulder':
        this.add({ x, y, vx: 0, vy: 0, kind: 'burst', color: c.light, life: 0.14, size: 0.14 + lv * 0.03, v: (Math.random() * 3) | 0, alpha: a });
        this.burst(x, y, 4 + lv * 2, 'dust', DUST, 1.3, 0.55, 0.12, { drag: 0.92, alpha: a });
        this.fountain(x, y, 3 + lv, 'pebble', '#6b675d', 2.6, 0.5, 0.05, { g: 7, vr: 8, alpha: a });
        this.decal('crack', x, y + 0.05, 0.24 + sp * 0.4, INK, 1.1);
        this.ring(x, y + 0.05, 0.1, (sp || 0.5) + 0.1, c.dark, 0.35, 0.07, 0.6);
        if (!ev.echo) this.addShake(0.02 + lv * 0.015);
        break;
      default:
        this.add({ x, y, vx: 0, vy: 0, kind: 'burst', color: c.light, life: 0.16, size: 0.16 + lv * 0.03, alpha: a });
        this.burst(x, y, 6, 'ember', c.light, 1.8, 0.45, 0.05, { alpha: a });
    }
  }

  // Mort d'un yokai : éclaboussure d'encre, âme qui s'élève, or gagné.
  death(ev) {
    const e = ev.enemy;
    const big = e.boss ? 2 : Math.max(0.8, Math.min(1.6, (e.size ?? 0.3) / 0.3));
    const x = e.x;
    const y = e.y - (e.flying ? 0.4 : 0.15);
    this.add({ x, y, vx: 0, vy: 0, kind: 'blot', shape: 'splat', color: INK, life: 0.42, size: 0.17 * big, grow: 1.7, v: (Math.random() * 4) | 0, prio: true });
    const n = Math.round(6 * big);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = 1.3 + Math.random() * 1.4;
      this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, kind: 'blot', color: INK, life: 0.45, size: 0.035 + Math.random() * 0.03, v: i % 3, g: 5, drag: 0.92 });
    }
    if (!e.flying) this.decal('splat', e.x, e.y + 0.08, 0.24 * big, INK, 1.6);
    this.add({ x, y: y - 0.1, vx: 0, vy: -0.75, kind: 'wisp', color: SOUL, life: 1.3, size: 0.12 * Math.min(1.6, big), drag: 0.995, sway: 0.7, prio: true });
    if (ev.reward) this.goldText(e.x, e.y - 0.5, ev.reward);
    if (e.boss) {
      this.ring(x, y, 0.2, 1.6, INK, 0.8, 0.12, 0.8);
      this.burst(x, y, 12, 'curl', INK, 2, 0.8, 0.14, { vr: 5, drag: 0.92 });
      this.addShake(0.45);
    }
  }

  // Fusion : rayons dorés, anneaux, l'esprit de la lanterne absorbée rejoint l'autre.
  fuseFx(ev) {
    const t = ev.tower;
    const c = this.colOf(t.type);
    this.ring(t.x, t.y - 0.2, 0.1, 1.1, PALETTE.gold, 0.7, 0.08);
    this.ring(t.x, t.y + 0.32, 0.1, 0.8, c.main, 0.55, 0.07, 0.45);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + 0.13;
      this.add({ x: t.x + Math.cos(a) * 0.2, y: t.y - 0.3 + Math.sin(a) * 0.2, vx: Math.cos(a) * 2.6, vy: Math.sin(a) * 2.6, kind: 'spark', color: PALETTE.goldLight, life: 0.4, size: 0.14, drag: 0.86 });
    }
    this.burst(t.x, t.y - 0.3, 16, 'ember', PALETTE.goldLight, 2.2, 0.9, 0.055, { g: -1.2, drag: 0.94 });
    this.burst(t.x, t.y - 0.3, 6, 'star', PALETTE.goldLight, 1.4, 0.7, 0.07, { vr: 3, drag: 0.92 });
    // traînée depuis la lanterne absorbée
    for (let i = 0; i < 7; i++) {
      const k = i / 7;
      this.add({ x: ev.from.x + (t.x - ev.from.x) * k, y: ev.from.y - 0.2 + (t.y - ev.from.y) * k, vx: 0, vy: -0.4, kind: 'ember', color: k < 0.5 ? c.light : PALETTE.goldLight, life: 0.45 + k * 0.35, size: 0.07, g: -0.5 });
    }
    this.text(t.x, t.y - 0.95, ev.level === 3 ? '極' : '合', PALETTE.vermillion, 0.5);
    this.addShake(0.1);
  }

  // Ambiance vivante des combos : vapeur qui monte, étincelles de lave, grains
  // de sable en orbite, scintillements de givre, braises des tornades.
  ambientZones(dt) {
    const game = this.game;
    if (!game || !(dt > 0) || this.parts.length > MAX_PARTS * 0.6) return;
    const g = game.grid;
    for (const z of game.zones) {
      const id = z.def.id;
      const rate = id === 'steam' ? 2 : id === 'magma' ? 5 : id === 'sandstorm' ? 7 : id === 'frost' ? 2 : 0;
      if (!rate || Math.random() > rate * dt) continue;
      const a = Math.random() * TAU;
      const d = Math.sqrt(Math.random()) * z.radius * 0.85;
      const x = z.x + Math.cos(a) * d;
      const y = z.y + Math.sin(a) * d * 0.85;
      if (id === 'steam') {
        this.add({ x, y, vx: (Math.random() - 0.5) * 0.2, vy: -0.3, kind: 'smoke', color: MIST, life: 1.3, size: 0.13, g: -0.05, drag: 0.99, alpha: 0.9 });
      } else if (id === 'magma') {
        const i = g.tileAt(x, y);
        if (i < 0 || !g.isWalkableType(i)) continue;
        this.add({ x, y, vx: (Math.random() - 0.5) * 0.3, vy: -0.6, kind: 'ember', color: Math.random() < 0.5 ? '#ff9a3c' : '#ffd27a', life: 0.8, size: 0.035, g: -0.4, drag: 0.98 });
      } else if (id === 'sandstorm') {
        this.add({ x, y, vx: 0, vy: 0, kind: 'grain', color: Math.random() < 0.6 ? '#a8823e' : '#d8b878', life: 1.1, size: 0.028, orb: { cx: z.x, cy: z.y, r: d, a, w: 2.4 + Math.random() } });
      } else if (id === 'frost') {
        this.add({ x, y, vx: 0, vy: -0.05, kind: 'star', color: '#ffffff', life: 0.6, size: 0.055, rot: 0, tw: true, drag: 1 });
      }
    }
    for (const t of game.tornadoes) {
      if (Math.random() > 10 * dt) continue;
      const a = Math.random() * TAU;
      this.add({
        x: t.x + Math.cos(a) * 0.25,
        y: t.y - Math.random() * 0.7,
        vx: -Math.sin(a) * 1.2,
        vy: -0.9,
        kind: 'ember',
        color: Math.random() < 0.5 ? '#ffb35c' : PALETTE.vermillion,
        life: 0.55,
        size: 0.04,
        g: -0.6,
        drag: 0.96,
      });
    }
  }

  update(dt) {
    this.clock += dt;
    this.ambientT += dt;
    const rate = this.ambient === 'snow' ? 0.24 : 0.55;
    while (this.ambientT > rate) {
      this.ambientT -= rate;
      this.spawnAmbient();
    }
    const n = this.parts.length;
    this.density = n > MAX_PARTS * 0.85 ? 0.3 : n > MAX_PARTS * 0.6 ? 0.55 : 1;
    this.ambientZones(dt);
    const H = this.bounds.h + 1;
    const W = this.bounds.w + 1;
    const parts = this.parts;
    let j = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.rot += p.vr * dt;
      if (p.orb) {
        const o = p.orb;
        o.a += o.w * dt;
        o.r *= 1 + dt * 0.15;
        p.x = o.cx + Math.cos(o.a) * o.r;
        p.y = o.cy + Math.sin(o.a) * o.r * 0.85;
        parts[j++] = p;
        continue;
      }
      p.vy += p.g * dt;
      if (p.drag !== 1) {
        const d = Math.pow(p.drag, dt * 60);
        p.vx *= d;
        p.vy *= d;
      }
      if (p.amb) {
        p.vx += Math.sin(p.y * 1.3 + p.rot) * 0.01;
        if (p.y > H || p.x > W) continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.sway) p.x += Math.sin(p.life * 5 + p.rot) * p.sway * dt;
      parts[j++] = p;
    }
    parts.length = j;
    this.rings = keepAlive(this.rings, dt);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= dt * 0.55 * Math.min(1, (t.life / t.max) * 1.6);
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    this.marks = keepAlive(this.marks, dt);
    this.ground = keepAlive(this.ground, dt);
    this.ghosts = keepAlive(this.ghosts, dt);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.flash = Math.max(0, this.flash - dt * 1.5);
  }

  // Traces au sol, dessinées sous les entités (appelé par le rendu avant les aperçus).
  drawGround(ctx, ts) {
    if (!this.ground.length) return;
    const m = setBase(ctx);
    const sc = scaleOf(TA);
    const a0 = ctx.globalAlpha;
    for (const d of this.ground) {
      const k = d.life / d.max;
      const s = d.size * ts * 2;
      const fade = Math.min(1, k * 2.5);
      if (d.kind === 'scorch') {
        ctx.globalAlpha = a0 * 0.35 * fade;
        put(ctx, sprite('glow', d.color, sc), d.x * ts, d.y * ts, s * 1.2, s * 0.75);
      } else {
        // la tache s'étale vite, puis sèche et pâlit
        const grow = Math.min(1, (1 - k) * 8);
        ctx.globalAlpha = a0 * (d.kind === 'crack' ? 0.6 : 0.42) * fade;
        put(ctx, sprite(d.kind, d.color, sc, d.v), d.x * ts, d.y * ts, s * (0.6 + 0.4 * grow), s * 0.62 * (0.6 + 0.4 * grow));
      }
    }
    ctx.setTransform(m);
    ctx.globalAlpha = a0;
  }

  drawParts(ctx, ts, filter) {
    const m = setBase(ctx);
    const sc = scaleOf(TA);
    const a0 = ctx.globalAlpha;
    // Flocons d'ambiance : un seul tracé rempli pour tous (les plus gros, flous,
    // et ceux qui s'éteignent passent par le sprite).
    let flakes = 0;
    ctx.beginPath();
    for (const p of this.parts) {
      if (!p.flake || p.life < 1 || (filter && !filter(p))) continue;
      const x = p.x * ts;
      const y = p.y * ts;
      const r = p.size * ts * 0.8;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
      flakes++;
    }
    if (flakes) {
      ctx.globalAlpha = a0 * 0.92;
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    for (const p of this.parts) {
      if (filter && !filter(p)) continue;
      if (p.flake && p.life >= 1) continue;
      const k = p.life / p.max;
      const x = p.x * ts;
      const y = p.y * ts;
      const s = p.size * ts;
      const a = a0 * (p.alpha ?? 1) * (p.amb ? Math.min(1, p.life) : 1);
      switch (p.kind) {
        case 'petal': {
          // le pétale se retourne en tombant (aplatissement périodique)
          const flip = 0.3 + 0.7 * Math.abs(Math.sin(p.rot * 0.9 + (p.ph || 0)));
          ctx.globalAlpha = a * 0.92;
          put(ctx, sprite('petal', p.color, sc), x, y, s * 1.7, s * 2 * flip, p.rot);
          break;
        }
        case 'snow':
          ctx.globalAlpha = a;
          put(ctx, sprite('snow', p.color, sc), x, y, s * 2.4, s * 2.4);
          break;
        case 'ember':
        case 'dot':
          ctx.globalAlpha = a * Math.min(1, k * 1.6);
          put(ctx, sprite('ember', p.color, sc), x, y, s * (1.4 + k * 1.4), s * (1.4 + k * 1.4));
          break;
        case 'spark': {
          const sp = Math.hypot(p.vx, p.vy);
          ctx.globalAlpha = a * Math.min(1, k * 2);
          put(ctx, sprite('spark', p.color, sc), x, y, s * (1.2 + Math.min(2.5, sp * 0.5)), s * 0.55, Math.atan2(p.vy, p.vx));
          break;
        }
        case 'drop':
          ctx.globalAlpha = a * Math.min(1, k * 2);
          put(ctx, sprite('drop', p.color, sc), x, y, s * 1.3, s * 1.9, Math.atan2(p.vy, p.vx) - Math.PI / 2);
          break;
        case 'leaf': {
          const flip = 0.35 + 0.65 * Math.abs(Math.cos(p.rot * 1.3));
          ctx.globalAlpha = a * Math.min(1, k * 2);
          put(ctx, sprite('leaf', p.color, sc), x, y, s * 2.2, s * 1.2 * flip, p.rot);
          break;
        }
        case 'dust':
          ctx.globalAlpha = a * k * 0.45;
          put(ctx, sprite('glow', p.color, sc), x, y, s * (2.4 + (1 - k) * 2), s * (2.4 + (1 - k) * 2));
          break;
        case 'smoke':
          ctx.globalAlpha = a * Math.min(1, k * 1.5, (1 - k) * 5) * 0.4;
          put(ctx, sprite('glow', p.color, sc), x, y, s * (2 + (1 - k) * 2.6), s * (1.6 + (1 - k) * 2));
          break;
        case 'flare':
          ctx.globalAlpha = a * k * 0.85;
          put(ctx, sprite('glow', p.color, sc), x, y, s * (1.6 + (1 - k) * 1.6), s * (1.6 + (1 - k) * 1.6));
          ctx.globalAlpha = a * k;
          put(ctx, sprite('ember', '#fff6dc', sc), x, y, s * 0.9 * k, s * 0.9 * k);
          break;
        case 'pebble':
          ctx.globalAlpha = a * Math.min(1, k * 3);
          put(ctx, sprite('pebble', p.color, sc, p.v || 0), x, y, s * 2, s * 1.7, p.rot);
          break;
        case 'ink':
        case 'blot': {
          const g = p.grow ? 1 + (p.grow - 1) * (1 - k * k) : 1;
          ctx.globalAlpha = a * Math.min(1, k * 2.2) * 0.9;
          put(ctx, sprite(p.shape || 'blot', p.color || INK, sc, p.v || 0), x, y, s * 2 * g, s * 2 * g, p.rot);
          break;
        }
        case 'curl':
          ctx.globalAlpha = a * k * 0.85;
          put(ctx, sprite('curl', p.color, sc), x, y, s * 2 * (1.3 - k * 0.5), s * 2 * (1.3 - k * 0.5), p.rot);
          break;
        case 'wisp': {
          // âme (hitodama) : halo bleuté, flamme pâle dont la queue traîne
          const fade = Math.min(1, k * 1.8, (1 - k) * 8);
          ctx.globalAlpha = a * fade * 0.45;
          put(ctx, sprite('glow', p.color, sc), x, y, s * 4.6, s * 4.6);
          ctx.globalAlpha = a * fade;
          const dir = Math.atan2(p.vy, p.vx + Math.sin(p.life * 5 + p.rot) * (p.sway || 0));
          put(ctx, sprite('soul', p.color, sc), x - Math.cos(dir) * s * 0.5, y - Math.sin(dir) * s * 0.5, s * 2.8, s * 1.7, dir);
          break;
        }
        case 'burst':
        case 'splash': {
          // éclat d'impact : jaillit, s'ouvre, disparaît en un éclair
          const g = 0.55 + (1 - k) * 0.7;
          ctx.globalAlpha = a * Math.min(1, k * 2.5);
          put(ctx, sprite(p.kind, p.color, sc, p.v || 0), x, y, s * 2 * g, s * 2 * g * (p.kind === 'splash' ? 0.7 : 1), p.rot);
          break;
        }
        case 'flake':
        case 'shard':
          ctx.globalAlpha = a * Math.min(1, k * 2);
          put(ctx, sprite(p.kind, p.color, sc), x, y, s * 1.4, s * 2, p.rot);
          break;
        case 'star': {
          const tw = p.tw ? Math.sin((1 - k) * Math.PI) : Math.min(1, k * 2);
          ctx.globalAlpha = a * tw;
          put(ctx, sprite('star', p.color, sc), x, y, s * 2 * (0.5 + tw * 0.5), s * 2 * (0.5 + tw * 0.5), p.rot);
          break;
        }
        case 'plus':
          ctx.globalAlpha = a * Math.min(1, k * 2);
          put(ctx, sprite('plus', p.color, sc), x, y, s * 2, s * 2);
          break;
        case 'slash':
          ctx.globalAlpha = a * k;
          put(ctx, sprite('slash', p.color, sc), x, y, s * 2 * (1 + (1 - k) * 0.4), s * 2 * (1 + (1 - k) * 0.4), p.rot);
          break;
        case 'grain':
          ctx.setTransform(m);
          ctx.globalAlpha = a * Math.min(1, k * 3, (1 - k) * 6);
          ctx.fillStyle = p.color;
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
          break;
        default:
          ctx.globalAlpha = a * k;
          put(ctx, sprite('ember', p.color || PALETTE.goldLight, sc), x, y, s * 2, s * 2);
      }
    }
    ctx.setTransform(m);
    ctx.globalAlpha = a0;
  }

  drawOverlay(ctx, ts) {
    const m = setBase(ctx);
    const sc = scaleOf(TA);
    const a0 = ctx.globalAlpha;
    // anneaux d'onde : deux arcs au pinceau, l'un plus long que l'autre
    ctx.lineCap = 'round';
    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      const rad = Math.max(0.5, (r.r0 + (r.r1 - r.r0) * easeOut(k)) * ts);
      ctx.globalAlpha = a0 * (1 - k) * 0.85;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(1, r.width * ts * (1 - k * 0.65));
      ctx.beginPath();
      ctx.ellipse(r.x * ts, r.y * ts, rad, rad * r.squash, 0, r.a0, r.a0 + 3.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(r.x * ts, r.y * ts, rad, rad * r.squash, 0, r.a0 + 3.85, r.a0 + 6.05);
      ctx.stroke();
    }
    // échos : la lanterne se dédouble puis se rassemble en fantôme
    for (const g of this.ghosts) {
      const k = 1 - g.life / g.max;
      ctx.globalAlpha = a0;
      if (g.mode === 'split') {
        const off = Math.sin(k * Math.PI) * 0.38 * ts;
        const al = 0.5 * (1 - k);
        drawTower(ctx, g.x * ts - off, g.y * ts - off * 0.2, ts, g.def, g.level, this.clock, { echo: 1, alpha: al });
        drawTower(ctx, g.x * ts + off, g.y * ts - off * 0.2, ts, g.def, g.level, this.clock, { echo: 1, alpha: al });
      } else {
        drawTower(ctx, g.x * ts, (g.y - easeOut(k) * 0.5) * ts, ts, g.def, g.level, this.clock, { echo: 1 - k, alpha: 0.65 * (1 - k) });
      }
    }
    ctx.globalAlpha = a0;
    // refus : croix vermillon au pinceau qui tremble, frappée comme un tampon
    for (const mk of this.marks) {
      const k = mk.life / mk.max;
      const age = mk.max - mk.life;
      const st = age < 0.08 ? 1.5 - (age / 0.08) * 0.5 : 1;
      const x = mk.x * ts + Math.sin(mk.life * 55) * ts * 0.05 * k * k;
      const y = mk.y * ts;
      ctx.globalAlpha = a0 * Math.min(1, k * 3);
      drawInkCross(ctx, x, y, ts * 0.27 * st, mk.color, mk.seed);
    }
    // textes (pré-rendus) : surgissent, montent, s'effacent
    for (const t of this.texts) {
      const k = t.life / t.max;
      const age = t.max - t.life;
      const pop = age < 0.12 ? 0.55 + (age / 0.12) * 0.6 : age < 0.24 ? 1.15 - ((age - 0.12) / 0.12) * 0.15 : 1;
      const spr = textSprite(t.str, t.color, Math.round(t.size * ts), sc);
      ctx.globalAlpha = a0 * Math.min(1, k * 2.8);
      put(ctx, spr.c, t.x * ts, t.y * ts, spr.w * pop, spr.h * pop);
    }
    ctx.setTransform(m);
    ctx.globalAlpha = a0;
    ctx.lineCap = 'butt';
  }
}

function keepAlive(list, dt) {
  let j = 0;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    o.life -= dt;
    if (o.life > 0) list[j++] = o;
  }
  list.length = j;
  return list;
}

function easeOut(k) {
  return 1 - (1 - k) * (1 - k);
}

// ───────────────────────── surcouches dessinées par le rendu ─────────────────────────

// Spirale d'encre à quatre bras effilés (portail d'apparition), mise en cache.
const portals = new Map();
function portalSprite(size, sc) {
  const key = `${size}|${sc}`;
  let c = portals.get(key);
  if (c) return c;
  const n = Math.ceil(size * 2 * sc);
  c = makeCanvas(n, n);
  const g = c.getContext('2d');
  g.translate(n / 2, n / 2);
  g.scale(n / 2, n / 2);
  for (let k = 0; k < 4; k++) {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const a = (k * Math.PI) / 2 + t * Math.PI * 1.25;
      const r = 0.16 + t * 0.8;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    brushStroke(g, pts, 0.17, withAlpha(INK, 0.85), { taperIn: 0.7, taperOut: 0.2 });
  }
  portals.set(key, c);
  return c;
}

// Le portail tourne par images pré-rendues : la spirale a une symétrie d'ordre 4,
// un quart de tour suffit (24 images), chacune copiée sans rotation ni flou.
const PORTAL_FRAMES = 24;
const portalFrames = new Map();
function portalFrame(R, sc, i) {
  const key = `${R}|${sc}`;
  let frames = portalFrames.get(key);
  if (!frames) {
    frames = new Array(PORTAL_FRAMES);
    portalFrames.set(key, frames);
  }
  if (frames[i]) return frames[i];
  const w = R * 2.5;
  const h = Math.ceil(w * 0.84);
  const c = makeCanvas(w * sc, h * sc);
  const g = c.getContext('2d');
  g.setTransform(sc, 0, 0, sc * 0.84, (w * sc) / 2, (h * sc) / 2);
  g.globalAlpha = 0.6;
  g.drawImage(sprite('glow', INK, sc), -R * 1.25, -R * 1.25, R * 2.5, R * 2.5);
  g.globalAlpha = 1;
  const th = (i / PORTAL_FRAMES) * (Math.PI / 2);
  const spr = portalSprite(R, sc);
  g.save();
  g.rotate(-th);
  g.drawImage(spr, -R, -R, R * 2, R * 2);
  g.restore();
  g.rotate(th * 2 + 1);
  g.globalAlpha = 0.6;
  g.drawImage(spr, -R * 0.55, -R * 0.55, R * 1.1, R * 1.1);
  frames[i] = { c, w: c.width / sc, h: c.height / sc };
  return frames[i];
}

// Portail d'apparition : mare d'encre et volutes qui tournent (plus vives en vague).
export function drawPortal(ctx, x, y, ts, time, active) {
  const m = ctx.getTransform();
  const sc = scaleOf(m.a);
  const R = Math.round(ts * 0.62);
  const turn = (time * (active ? 1.3 : 0.6)) / (Math.PI / 2);
  const f = portalFrame(R, sc, Math.floor((turn - Math.floor(turn)) * PORTAL_FRAMES) % PORTAL_FRAMES);
  const a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * (active ? 1 : 0.8);
  // copie alignée sur le pixel physique
  const px = (Math.round(m.a * (x - f.w / 2) + m.e) - m.e) / m.a;
  const py = (Math.round(m.d * (y - f.h / 2) + m.f) - m.f) / m.d;
  ctx.drawImage(f.c, px, py, f.w, f.h);
  if (active) {
    const p = 0.5 + 0.5 * Math.sin(time * 3);
    ctx.globalAlpha = a0 * (0.25 + 0.2 * p);
    ctx.drawImage(sprite('glow', PALETTE.vermillion, sc), x - R * 0.45, y - R * 0.4, R * 0.9, R * 0.8);
  }
  ctx.globalAlpha = a0;
}

// Ensō centré en (x, y), de rayon r. Aplati (squash < 1, cercle posé au sol), il ne
// tourne pas dans le plan de l'écran : l'ouverture prend une des six orientations.
export function drawEnso(ctx, x, y, r, color, alpha = 1, rot = 0, squash = 1) {
  const m = setBase(ctx);
  const a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * alpha;
  const sc = scaleOf(TA);
  if (squash === 1) put(ctx, sprite('enso', color, sc), x, y, r * 2, r * 2, rot);
  else put(ctx, sprite('enso', color, sc, ((Math.round((rot * 3) / Math.PI) % 6) + 6) % 6), x, y, r * 2, r * 2 * squash);
  ctx.setTransform(m);
  ctx.globalAlpha = a0;
}

// Croix vermillon au pinceau (refus), légèrement irrégulière selon la graine.
export function drawInkCross(ctx, x, y, s, color, seed) {
  const rnd = seeded(seed);
  const j = () => (rnd() - 0.5) * s * 0.25;
  const w = s * 0.48;
  brushStroke(ctx, [[x - s + j(), y - s + j()], [x + j() * 0.5, y + j() * 0.5], [x + s + j(), y + s * 1.05 + j()]], w, color, { taperIn: 0.15, taperOut: 0.55 });
  brushStroke(ctx, [[x + s * 0.95 + j(), y - s + j()], [x + j() * 0.5, y + j() * 0.5], [x - s + j(), y + s + j()]], w * 0.9, color, { taperIn: 0.15, taperOut: 0.6 });
}

// Marques de route : chevrons qui avancent vers le sanctuaire, avec une onde de
// clarté qui parcourt le tracé. Les chevrons sont groupés en paliers d'opacité :
// un seul tracé rempli par palier, quel que soit leur nombre.
const ROUTE_STEPS = 5;
const routeBuckets = Array.from({ length: ROUTE_STEPS }, () => []);
// chevron au pinceau (tête vers +x) : pointe épaisse, branches effilées
const CHEVRON = [0.5, 0, -0.36, 0.8, -0.5, 0.68, 0.1, 0, -0.5, -0.68, -0.36, -0.8];

export function drawRouteMarks(ctx, segs, ts, time) {
  if (!segs.length) return;
  for (const b of routeBuckets) b.length = 0;
  const f0 = (time * 0.55) % 0.5;
  for (const sg of segs) {
    for (let k = 0; k < 2; k++) {
      const f = f0 + k * 0.5;
      const dist = sg.d - f; // distance restante au sanctuaire
      const fade = Math.min(1, dist / 0.9, (sg.d0 - dist + 0.3) / 0.9);
      if (fade <= 0) continue;
      const w = Math.max(0, Math.sin(dist * 0.9 + time * 2.6));
      const a = fade * (0.4 + 0.6 * w * w);
      routeBuckets[Math.min(ROUTE_STEPS - 1, Math.floor(a * ROUTE_STEPS))].push((sg.x + sg.dx * f) * ts, (sg.y + sg.dy * f) * ts, sg.dx, sg.dy);
    }
  }
  const a0 = ctx.globalAlpha;
  const s = ts * 0.085;
  ctx.fillStyle = INK;
  for (let b = 0; b < ROUTE_STEPS; b++) {
    const list = routeBuckets[b];
    if (!list.length) continue;
    ctx.globalAlpha = a0 * 0.4 * ((b + 0.5) / ROUTE_STEPS);
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 4) {
      const x = list[i];
      const y = list[i + 1];
      const c = list[i + 2] * s;
      const sn = list[i + 3] * s;
      for (let j = 0; j < CHEVRON.length; j += 2) {
        const px = x + CHEVRON[j] * c - CHEVRON[j + 1] * sn;
        const py = y + CHEVRON[j] * sn + CHEVRON[j + 1] * c;
        if (j) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
    }
    ctx.fill();
  }
  ctx.globalAlpha = a0;
}
