// Identité visuelle des éléments : chaque élément se reconnaît à sa FORME autant
// qu'à sa couleur (daltonisme, B17) — Feu ▲, Eau ● (goutte), Vent ◆, Terre ■ —
// et porte un libellé français sous son kanji.
//
// Tout se lit dans les données : `def.element` (famille d'une tour, facultatif),
// `def.shape`, `def.elementLabel`. Les quatre éléments connus ne servent que de repli.

const FALLBACK = {
  fire: { shape: 'triangle', label: 'Feu' },
  water: { shape: 'drop', label: 'Eau' },
  wind: { shape: 'diamond', label: 'Vent' },
  earth: { shape: 'square', label: 'Terre' },
};
// Formes attribuées aux éléments inconnus, dans l'ordre d'apparition.
const SPARE = ['hexagon', 'star', 'circle', 'triangle-down'];
export const SHAPE_GLYPH = { triangle: '▲', drop: '●', circle: '●', diamond: '◆', square: '■', hexagon: '⬢', star: '★', 'triangle-down': '▼' };

const CREAM = '#f2e8d0';
const INK = '#1d1b22';

// Élément d'une tour (sa famille) : `def.element`, sinon son type.
export function elementOf(type, defs) {
  return defs?.towers?.[type]?.element ?? type;
}

// Première tour d'un élément : sa couleur et son kanji le représentent.
function towerOfElement(el, defs) {
  const towers = defs?.towers || {};
  if (towers[el] && (towers[el].element ?? el) === el) return towers[el];
  for (const id of Object.keys(towers)) if ((towers[id].element ?? id) === el) return towers[id];
  return null;
}

const infoCache = new Map();

// { id, shape, glyph, label, kanji, color, ink } — `ink` : teinte foncée de la
// couleur, lisible sous un texte crème (contraste ≥ 4,5).
export function elementInfo(el, defs) {
  const key = el;
  const cached = infoCache.get(key);
  if (cached && cached.defs === defs) return cached.info;
  const def = towerOfElement(el, defs) || {};
  const fb = FALLBACK[el];
  let shape = def.shape || fb?.shape;
  if (!shape) {
    const known = new Set(Object.values(FALLBACK).map((f) => f.shape));
    const others = Object.keys(defs?.towers || {})
      .map((t) => elementOf(t, defs))
      .filter((e, i, a) => !FALLBACK[e] && a.indexOf(e) === i);
    const i = Math.max(0, others.indexOf(el));
    shape = SPARE.filter((s) => !known.has(s))[i % SPARE.length] || 'circle';
  }
  const color = def.color || '#7d7a70';
  const info = {
    id: el,
    shape,
    glyph: SHAPE_GLYPH[shape] || '●',
    label: def.elementLabel || fb?.label || labelFromName(def.name) || el,
    kanji: def.kanji || '?',
    color,
    ink: readable(color),
  };
  infoCache.set(key, { defs, info });
  return info;
}

// « Lanterne du Feu » → « Feu » (repli quand les données ne donnent pas de libellé).
function labelFromName(name) {
  if (!name) return null;
  const m = /(?:du|de la|de l['’]|des|de)\s+(.+)$/i.exec(name);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : name;
}

// ───────────────────────── couleurs et contrastes ─────────────────────────

function rgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lum(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

// Fonce une couleur jusqu'à ce qu'un texte crème y soit lisible (AA, 4,5:1).
export function readable(color, on = CREAM, target = 4.6) {
  let [r, g, b] = rgb(color);
  let hex = toHex(r, g, b);
  for (let k = 0; k < 24 && contrast(hex, on) < target; k++) {
    r *= 0.9;
    g *= 0.9;
    b *= 0.9;
    hex = toHex(r, g, b);
  }
  return hex;
}

// ───────────────────────── formes ─────────────────────────

// Tracé SVG d'une forme dans une boîte 0..24 (centre 12, 12).
function shapePath(shape) {
  switch (shape) {
    case 'triangle':
      return '<path d="M12 1.6 L22.6 21.4 L1.4 21.4 Z"/>';
    case 'triangle-down':
      return '<path d="M12 22.4 L22.6 2.6 L1.4 2.6 Z"/>';
    case 'drop':
      return '<path d="M12 1.4 C15.6 6.6 20.6 11 20.6 15.4 C20.6 20 16.8 22.8 12 22.8 C7.2 22.8 3.4 20 3.4 15.4 C3.4 11 8.4 6.6 12 1.4 Z"/>';
    case 'diamond':
      return '<path d="M12 1 L23 12 L12 23 L1 12 Z"/>';
    case 'square':
      return '<rect x="2.6" y="2.6" width="18.8" height="18.8" rx="1.6"/>';
    case 'hexagon':
      return '<path d="M12 1.2 L21.6 6.6 L21.6 17.4 L12 22.8 L2.4 17.4 L2.4 6.6 Z"/>';
    case 'stone':
      return '<path d="M2 16 C1 9 6 4.2 12.6 4.4 C18.6 4.6 23 9 22.2 16 C18 19.6 6.4 19.8 2 16 Z"/>';
    case 'star':
      return '<path d="M12 1.2 L14.9 8.6 L22.8 9 L16.7 14 L18.8 21.8 L12 17.4 L5.2 21.8 L7.3 14 L1.2 9 L9.1 8.6 Z"/>';
    default:
      return '<circle cx="12" cy="12" r="10.6"/>';
  }
}

// Forme seule, en SVG en ligne (taille en px CSS).
export function shapeSvg(shape, fill, size = 14, stroke = INK) {
  return `<svg class="el-shape" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round">${shapePath(shape)}</svg>`;
}

// Pastille d'élément : la forme, colorée, avec le kanji crème au centre.
// opts.label : ajoute le libellé français ; opts.size : taille de la forme.
export function elementBadge(el, defs, opts = {}) {
  const info = elementInfo(el, defs);
  const size = opts.size ?? 24;
  const kanji = opts.kanji === false ? '' : `<b>${info.kanji}</b>`;
  const label = opts.label ? `<span class="el-label">${info.label}</span>` : '';
  return `<span class="el-badge el-${info.shape}${opts.cls ? ' ' + opts.cls : ''}" style="--el:${info.color};--el-ink:${info.ink};--s:${size}px" title="${info.label}" aria-label="${info.label}">${shapeSvg(info.shape, info.ink, size)}${kanji}</span>${label}`;
}

// Libellé court « ▲ Feu » (texte seul, pour les listes).
export function elementTag(el, defs) {
  const info = elementInfo(el, defs);
  return `<span class="el-tag" style="--el-ink:${info.ink}">${shapeSvg(info.shape, info.ink, 13)}${info.label}</span>`;
}

// Version Canvas 2D de la forme (aperçus dessinés dans le plateau).
export function drawShape(ctx, shape, x, y, r, fill, stroke = INK, lw = 1.5) {
  ctx.save();
  ctx.translate(x - r, y - r);
  ctx.scale(r / 12, r / 12);
  ctx.beginPath();
  switch (shape) {
    case 'triangle':
      ctx.moveTo(12, 1.6);
      ctx.lineTo(22.6, 21.4);
      ctx.lineTo(1.4, 21.4);
      break;
    case 'diamond':
      ctx.moveTo(12, 1);
      ctx.lineTo(23, 12);
      ctx.lineTo(12, 23);
      ctx.lineTo(1, 12);
      break;
    case 'square':
      ctx.rect(2.6, 2.6, 18.8, 18.8);
      break;
    case 'drop':
      ctx.moveTo(12, 1.4);
      ctx.bezierCurveTo(15.6, 6.6, 20.6, 11, 20.6, 15.4);
      ctx.bezierCurveTo(20.6, 20, 16.8, 22.8, 12, 22.8);
      ctx.bezierCurveTo(7.2, 22.8, 3.4, 20, 3.4, 15.4);
      ctx.bezierCurveTo(3.4, 11, 8.4, 6.6, 12, 1.4);
      break;
    default:
      ctx.arc(12, 12, 10.6, 0, Math.PI * 2);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = (lw * 12) / r;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.restore();
}

// Éléments connus du jeu (ordre : tours du niveau, puis combos), pour la table des combos.
export function elementList(defs, available = null) {
  const out = [];
  const add = (e) => e && !out.includes(e) && out.push(e);
  for (const t of available || Object.keys(defs.towers || {})) add(elementOf(t, defs));
  for (const c of defs.combos || []) for (const e of c.elements || []) add(e);
  return out;
}

export { CREAM, INK };
