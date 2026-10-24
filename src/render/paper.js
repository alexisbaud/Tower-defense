// Papier washi texturé généré procéduralement (fibres, grain, taches).
import { makeCanvas, seeded, withAlpha, mix } from './brush.js';

export function makePaper(w, h, dpr, base = '#efe4c8', seed = 3) {
  const cw = Math.ceil(w * dpr);
  const ch = Math.ceil(h * dpr);
  const c = makeCanvas(cw, ch);
  const ctx = c.getContext('2d');
  const rnd = seeded(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, cw, ch);

  // Nuages de teinte (irrégularités de la pâte).
  for (let i = 0; i < 26; i++) {
    const x = rnd() * cw;
    const y = rnd() * ch;
    const r = (60 + rnd() * 200) * dpr;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = rnd() < 0.5 ? mix(base, '#c9b48a', 0.5) : mix(base, '#fff8e6', 0.6);
    g.addColorStop(0, withAlpha(tone, 0.22));
    g.addColorStop(1, withAlpha(tone, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Grain fin.
  const img = ctx.getImageData(0, 0, cw, ch);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 14;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n * 0.8;
  }
  ctx.putImageData(img, 0, 0);

  // Fibres de kozo.
  ctx.lineCap = 'round';
  const fibers = Math.floor((cw * ch) / (2600 * dpr));
  for (let i = 0; i < fibers; i++) {
    const x = rnd() * cw;
    const y = rnd() * ch;
    const len = (6 + rnd() * 26) * dpr;
    const a = rnd() * Math.PI * 2;
    const bend = (rnd() - 0.5) * len;
    ctx.strokeStyle = rnd() < 0.7 ? 'rgba(120,96,60,0.10)' : 'rgba(255,252,240,0.35)';
    ctx.lineWidth = (0.4 + rnd() * 0.8) * dpr;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend,
      y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend,
      x + Math.cos(a) * len,
      y + Math.sin(a) * len,
    );
    ctx.stroke();
  }

  // Quelques inclusions (paillettes de fibres plus sombres).
  for (let i = 0; i < fibers / 8; i++) {
    ctx.fillStyle = 'rgba(90,70,40,0.12)';
    ctx.beginPath();
    ctx.arc(rnd() * cw, rnd() * ch, (0.5 + rnd() * 1.2) * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

// Vignettage doux (bords assombris comme une vieille estampe).
export function makeVignette(w, h, dpr) {
  const cw = Math.ceil(w * dpr);
  const ch = Math.ceil(h * dpr);
  const c = makeCanvas(cw, ch);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
  g.addColorStop(0, 'rgba(60,40,20,0)');
  g.addColorStop(1, 'rgba(60,40,20,0.28)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
  return c;
}
