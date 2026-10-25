// Chargement des fichiers de données (fonctionne dans le navigateur et dans Node).
import towers from '../data/towers.js';
import enemies from '../data/enemies.js';
import rules from '../data/rules.js';
import worlds from '../data/worlds.js';
import combos from '../data/combos.js';
import elements from '../data/elements.js';

export const defs = { towers, enemies, rules, combos, elements };
export { worlds };

const cache = new Map();

export async function loadLevel(id) {
  if (cache.has(id)) return cache.get(id);
  const mod = await import(new URL(`../data/levels/${id}.js`, import.meta.url).href);
  const level = mod.default;
  cache.set(id, level);
  return level;
}

// Liste ordonnée de tous les niveaux : [{ id, world, index }]
export function levelOrder() {
  const out = [];
  for (const w of worlds) for (const id of w.levels) out.push({ id, world: w.id, index: out.length });
  return out;
}

export function worldById(id) {
  return worlds.find((w) => w.id === id) || worlds[0];
}
