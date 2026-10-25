// Papier washi texturé généré procéduralement : pâte nuagée, grain fin,
// fibres de kozo (courtes et longues), inclusions d'écorce ; vignettage doux.
//
// Tout est rendu une fois (au changement de niveau ou de taille) : les nuances
// douces sont peintes en basse résolution puis agrandies, et le grain est une
// petite tuile pré-calculée répétée (pas de lecture de pixels plein écran).
import { makeCanvas, seeded, withAlpha, mix, wash } from './brush.js';

// Tuile de grain neutre (pixels clairs et sombres semi-transparents), calculée
// une seule fois puis répétée sur toute la feuille.
let grainTile = null;
function grain() {
  if (grainTile) return grainTile;
  const n = 160;
  const c = makeCanvas(n, n);
  const g = c.getContext('2d');
  const img = g.createImageData(n, n);
  const d = img.data;
  const rnd = seeded(77);
  for (let i = 0; i < d.length; i += 4) {
    const v = rnd() - 0.5;
    const a = Math.abs(v) * 2;
    if (v < 0) {
      d[i] = 92;
      d[i + 1] = 72;
      d[i + 2] = 44;
    } else {
      d[i] = 255;
      d[i + 1] = 252;
      d[i + 2] = 242;
    }
    d[i + 3] = Math.round(a * a * 40);
  }
  g.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

export function makePaper(w, h, dpr, base = '#efe4c8', seed = 3) {
  const cw = Math.ceil(w * dpr);
  const ch = Math.ceil(h * dpr);
  const c = makeCanvas(cw, ch);
  const ctx = c.getContext('2d');
  const rnd = seeded(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, cw, ch);

  // Nuages de teinte (irrégularités de la pâte), peints au huitième de la
  // résolution puis agrandis : un lavis très doux, sans coût par pixel.
  const s = 1 / 8;
  const low = makeCanvas(w * s, h * s);
  const lg = low.getContext('2d');
  lg.scale(s, s);
  const dark = mix(base, '#b89f72', 0.6);
  const light = mix(base, '#fffaf0', 0.75);
  for (let i = 0; i < 34; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 50 + rnd() * 190;
    wash(lg, x, y, r, rnd() < 0.55 ? dark : light, 0.2 + rnd() * 0.15);
  }
  // nuées de fibres plus denses (zones légèrement plus opaques)
  for (let i = 0; i < 10; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    for (let j = 0; j < 4; j++) wash(lg, x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 30, 18 + rnd() * 30, light, 0.35);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(low, 0, 0, cw, ch);

  // Grain fin : tuile répétée (légèrement agrandie à haute densité de pixels).
  const tile = grain();
  const ts = tile.width * Math.max(1, dpr * 0.5);
  const ox = -Math.floor(rnd() * ts);
  const oy = -Math.floor(rnd() * ts);
  for (let y = oy; y < ch; y += ts) for (let x = ox; x < cw; x += ts) ctx.drawImage(tile, x, y, ts, ts);

  // Fibres de kozo : courtes et nombreuses, plus quelques longues fibres
  // ondulées ; regroupées par teinte et par épaisseur (un tracé par lot).
  ctx.lineCap = 'round';
  const lots = [
    { color: 'rgba(120,96,60,0.11)', width: 0.5, p: new Path2D() },
    { color: 'rgba(120,96,60,0.08)', width: 1.0, p: new Path2D() },
    { color: 'rgba(255,252,240,0.45)', width: 0.7, p: new Path2D() },
    { color: 'rgba(255,252,240,0.3)', width: 1.4, p: new Path2D() },
  ];
  const short = Math.floor((w * h) / 700);
  for (let i = 0; i < short; i++) {
    const x = rnd() * cw;
    const y = rnd() * ch;
    const len = (5 + rnd() * 22) * dpr;
    const a = rnd() * Math.PI * 2;
    const bend = (rnd() - 0.5) * len * 0.8;
    const lot = lots[rnd() < 0.62 ? (rnd() < 0.7 ? 0 : 1) : rnd() < 0.7 ? 2 : 3];
    lot.p.moveTo(x, y);
    lot.p.quadraticCurveTo(
      x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend,
      y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend,
      x + Math.cos(a) * len,
      y + Math.sin(a) * len,
    );
  }
  const long = Math.floor((w * h) / 6000);
  for (let i = 0; i < long; i++) {
    let x = rnd() * cw;
    let y = rnd() * ch;
    let a = rnd() * Math.PI * 2;
    const lot = lots[rnd() < 0.5 ? 0 : 2];
    lot.p.moveTo(x, y);
    for (let j = 0; j < 4; j++) {
      const l = (12 + rnd() * 20) * dpr;
      const na = a + (rnd() - 0.5) * 1.2;
      lot.p.quadraticCurveTo(x + Math.cos(a) * l * 0.5, y + Math.sin(a) * l * 0.5, x + Math.cos(na) * l, y + Math.sin(na) * l);
      x += Math.cos(na) * l;
      y += Math.sin(na) * l;
      a = na;
    }
  }
  for (const lot of lots) {
    ctx.strokeStyle = lot.color;
    ctx.lineWidth = lot.width * dpr;
    ctx.stroke(lot.p);
  }

  // Inclusions : paillettes et éclats d'écorce plus sombres.
  const specks = new Path2D();
  const bark = new Path2D();
  const nS = Math.floor((w * h) / 2500);
  for (let i = 0; i < nS; i++) {
    const x = rnd() * cw;
    const y = rnd() * ch;
    if (rnd() < 0.75) {
      const r = (0.4 + rnd() * 0.9) * dpr;
      specks.moveTo(x + r, y);
      specks.arc(x, y, r, 0, Math.PI * 2);
    } else {
      const a = rnd() * Math.PI;
      const l = (1.5 + rnd() * 3) * dpr;
      bark.moveTo(x, y);
      bark.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    }
  }
  ctx.fillStyle = 'rgba(90,70,40,0.14)';
  ctx.fill(specks);
  ctx.strokeStyle = 'rgba(80,58,30,0.22)';
  ctx.lineWidth = 0.7 * dpr;
  ctx.stroke(bark);
  return c;
}

// Vignettage doux (bords assombris comme une vieille estampe), légèrement
// elliptique pour suivre le format portrait ; peint en basse résolution.
export function makeVignette(w, h, dpr) {
  const cw = Math.ceil(w * dpr);
  const ch = Math.ceil(h * dpr);
  const c = makeCanvas(cw, ch);
  const ctx = c.getContext('2d');
  const s = 1 / 6;
  const lw = Math.ceil(w * s);
  const lh = Math.ceil(h * s);
  const low = makeCanvas(lw, lh);
  const lg = low.getContext('2d');
  // dégradé circulaire étiré à l'ovale de la feuille
  lg.translate(lw / 2, lh / 2);
  lg.scale(1, lh / lw);
  const R = lw * 0.5;
  const g = lg.createRadialGradient(0, 0, R * 0.55, 0, 0, R * 1.45);
  g.addColorStop(0, 'rgba(60,40,20,0)');
  g.addColorStop(0.55, 'rgba(60,40,20,0.1)');
  g.addColorStop(1, 'rgba(50,32,16,0.32)');
  lg.fillStyle = g;
  lg.fillRect(-R * 2, -R * 2, R * 4, R * 4);
  lg.setTransform(1, 0, 0, 1, 0, 0);
  // voile chaud très léger en haut et en bas (papier qui a jauni sur les bords)
  const v = lg.createLinearGradient(0, 0, 0, lh);
  v.addColorStop(0, withAlpha('#a07a40', 0.08));
  v.addColorStop(0.2, withAlpha('#a07a40', 0));
  v.addColorStop(0.8, withAlpha('#a07a40', 0));
  v.addColorStop(1, withAlpha('#a07a40', 0.1));
  lg.fillStyle = v;
  lg.fillRect(0, 0, lw, lh);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(low, 0, 0, cw, ch);
  return c;
}
