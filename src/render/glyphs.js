// Identité dessinée des éléments : forme (lisible sans la couleur), teinte et
// kanji, lues dans les données (defs.elements, transmis par le rendu au début de
// chaque partie). Les quatre éléments connus ne servent que de repli.
//
// Formes : triangle ▲ (Feu), goutte (Eau), losange ◆ (Vent), carré ■ (Terre),
// et quelques formes de réserve pour un élément ajouté sans forme.

const FALLBACK = {
  fire: { shape: 'triangle', color: '#c8402a', kanji: '火' },
  water: { shape: 'drop', color: '#2f5f8f', kanji: '水' },
  wind: { shape: 'diamond', color: '#5f8f6a', kanji: '風' },
  earth: { shape: 'square', color: '#8a6a32', kanji: '土' },
};
const SPARE = ['hexagon', 'star', 'circle', 'triangle-down'];

let registry = null;
const cache = new Map();

// Appelé par le rendu (setGame) : éléments décrits par les données.
export function setElementDefs(elements) {
  if (elements === registry) return;
  registry = elements || null;
  cache.clear();
}

// { shape, color, kanji } d'un élément (repli : gris neutre, cercle).
export function elementLook(el) {
  if (!el) return null;
  let v = cache.get(el);
  if (v) return v;
  const d = registry?.[el] || {};
  const fb = FALLBACK[el] || {};
  let shape = d.shape || fb.shape;
  if (!shape) {
    const others = Object.keys(registry || {}).filter((k) => !FALLBACK[k]);
    shape = SPARE[Math.max(0, others.indexOf(el)) % SPARE.length];
  }
  v = { shape, color: d.color || fb.color || '#7d7a70', kanji: d.kanji || fb.kanji || '' };
  cache.set(el, v);
  return v;
}

// Ajoute au chemin courant la forme `shape` centrée en (x, y), de « rayon » r
// (toutes les formes ont à peu près la même surface apparente).
export function shapePath(ctx, shape, x, y, r) {
  switch (shape) {
    case 'triangle':
      ctx.moveTo(x, y - r * 1.05);
      ctx.lineTo(x + r * 1.0, y + r * 0.72);
      ctx.lineTo(x - r * 1.0, y + r * 0.72);
      ctx.closePath();
      break;
    case 'triangle-down':
      ctx.moveTo(x, y + r * 1.05);
      ctx.lineTo(x + r * 1.0, y - r * 0.72);
      ctx.lineTo(x - r * 1.0, y - r * 0.72);
      ctx.closePath();
      break;
    case 'drop':
      ctx.moveTo(x, y - r * 1.12);
      ctx.bezierCurveTo(x + r * 0.32, y - r * 0.6, x + r * 0.86, y - r * 0.12, x + r * 0.86, y + r * 0.3);
      ctx.arc(x, y + r * 0.3, r * 0.86, 0, Math.PI);
      ctx.bezierCurveTo(x - r * 0.86, y - r * 0.12, x - r * 0.32, y - r * 0.6, x, y - r * 1.12);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(x, y - r * 1.1);
      ctx.lineTo(x + r * 0.9, y);
      ctx.lineTo(x, y + r * 1.1);
      ctx.lineTo(x - r * 0.9, y);
      ctx.closePath();
      break;
    case 'square':
      ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
      break;
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 ? r * 0.45 : r * 1.05;
        if (i) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      break;
    default:
      ctx.moveTo(x + r * 0.9, y);
      ctx.arc(x, y, r * 0.9, 0, Math.PI * 2);
  }
}

// Centre optique d'une forme (le kanji s'y pose) : décalage vertical en unités de r.
export function shapeCenterY(shape) {
  if (shape === 'triangle') return 0.22;
  if (shape === 'triangle-down') return -0.22;
  if (shape === 'drop') return 0.2;
  return 0;
}
