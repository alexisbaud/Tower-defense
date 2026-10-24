// Vignettes dessinées une fois puis réutilisées : portraits de yokai (aperçu de
// vague, fiches, carte de présentation) et icônes de lanternes (fiches).
import { drawEnemy, enemyFrame } from '../render/enemies.js';
import { drawTowerIcon } from '../render/towers.js';

const cache = new Map();

// Yokai factice, immobile, tourné vers la droite : ce que drawEnemy attend.
function fakeEnemy(type, def, absorb) {
  return {
    type,
    seed: 0.3,
    size: def.size,
    dirX: 1,
    hp: 1,
    maxHp: 1,
    spawnT: 0,
    hitT: 0,
    slowT: 0,
    burnT: 0,
    stunT: 0,
    blindT: 0,
    shredT: 0,
    breakT: 0,
    hopT: 0,
    blocked: null,
    armor: def.armor ?? 0,
    timeless: !!def.abilities?.timeless,
    flying: !!def.abilities?.flying,
    absorb: absorb ?? def.abilities?.absorb ?? def.abilities?.cycleAbsorb?.elements?.[0] ?? null,
  };
}

// Dessine le portrait d'un yokai, cadré sur la boîte de son dessin, dans `ctx` (taille px).
export function paintEnemy(ctx, defs, type, px, absorb = null) {
  const def = defs.enemies[type];
  if (!def) return;
  const { box, lift } = enemyFrame(def);
  const r = Math.min((px * 0.9) / (box[2] - box[0]), (px * 0.8) / (box[3] - box[1]));
  const cx = px / 2 - ((box[0] + box[2]) / 2) * r;
  const cy = px / 2 - ((box[1] + box[3]) / 2) * r + lift * r;
  drawEnemy(ctx, fakeEnemy(type, def, absorb), def, cx, cy, r / (def.size ?? 0.3), 0.5);
}

// URL d'image (data:) du portrait d'un yokai, mise en cache par type et élément absorbé.
export function enemyPortrait(defs, type, absorb = null, css = 40) {
  const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const px = Math.round(css * dpr);
  const key = `e|${type}|${absorb}|${px}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  try {
    paintEnemy(c.getContext('2d'), defs, type, px, absorb);
  } catch {
    /* look inconnu : vignette vide plutôt qu'une erreur */
  }
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

// URL d'image de l'icône d'une lanterne (niveau donné).
export function towerPortrait(def, level = 1, css = 44) {
  const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const px = Math.round(css * dpr);
  const key = `t|${def.name}|${def.color}|${level}|${px}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  try {
    drawTowerIcon(ctx, css, css, def, level);
  } catch {
    /* ignore */
  }
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}
