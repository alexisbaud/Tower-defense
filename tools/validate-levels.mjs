// Valide le schéma de chaque niveau listé dans data/worlds.js.
// Usage : node tools/validate-levels.mjs
import { defs, worlds, loadLevel } from '../src/data.js';
import { Grid, LEGEND, T } from '../src/core/grid.js';
import { bfs } from '../src/core/flowfield.js';

const TUTORIALS = ['place', 'wave', 'fuse', 'combo', 'stone', 'rewind'];
let errors = 0;
const err = (id, msg) => {
  errors++;
  console.log(`  ✗ [${id}] ${msg}`);
};

const seen = new Set();
for (const w of worlds) {
  if (!w.id || !w.name || !w.theme) err(w.id, 'monde incomplet (id, name, theme)');
  for (const id of w.levels) {
    if (seen.has(id)) err(id, 'niveau listé deux fois');
    seen.add(id);
    let L;
    try {
      L = await loadLevel(id);
    } catch (e) {
      err(id, `fichier data/levels/${id}.js introuvable ou invalide : ${e.message}`);
      continue;
    }
    if (L.id !== id) err(id, `id du fichier (${L.id}) différent de son nom`);
    if (L.world !== w.id) err(id, `world "${L.world}" mais listé dans "${w.id}"`);
    if (!L.name) err(id, 'name manquant');
    if (!Array.isArray(L.map) || !L.map.length) {
      err(id, 'map manquante');
      continue;
    }
    const cols = L.map[0].length;
    L.map.forEach((row, r) => {
      if (row.length !== cols) err(id, `ligne ${r} : ${row.length} caractères au lieu de ${cols}`);
      for (const ch of row) if (!(ch in LEGEND)) err(id, `caractère inconnu "${ch}" ligne ${r}`);
    });
    if (cols !== 9 || L.map.length !== 13) console.log(`  ! [${id}] grille ${cols}×${L.map.length} (recommandé 9×13 pour le portrait)`);
    const g = new Grid(L.map);
    if (!g.spawns.length) err(id, 'aucune apparition S');
    if (!g.goals.length) err(id, 'aucun sanctuaire G');
    const dist = bfs(g);
    for (const s of g.spawns) if (dist[s] < 0) err(id, `apparition (${g.col(s)},${g.row(s)}) non reliée au sanctuaire`);
    let slots = 0;
    let open = 0;
    for (let i = 0; i < g.size; i++) {
      if (g.type(i) === T.SLOT) slots++;
      if (g.type(i) === T.OPEN) open++;
    }
    if (slots < 6) err(id, `seulement ${slots} emplacements de lanterne`);
    if (L.stones && open === 0) err(id, 'stones activé mais aucune zone ouverte "o"');
    if (!L.stones && open > 0) console.log(`  ! [${id}] zones ouvertes sans "stones" (les pierres seront indisponibles)`);
    if (typeof L.startGold !== 'number') err(id, 'startGold manquant');
    for (const t of L.towers || []) if (!defs.towers[t]) err(id, `tour inconnue "${t}"`);
    for (const t of L.tutorial || []) if (!TUTORIALS.includes(t)) err(id, `tutoriel inconnu "${t}"`);
    for (const e of L.introduce || []) if (!defs.enemies[e]) err(id, `introduce : yokai inconnu "${e}"`);
    if (!Array.isArray(L.waves) || !L.waves.length) err(id, 'aucune vague');
    (L.waves || []).forEach((wv, i) => {
      if (!wv.groups?.length) err(id, `vague ${i + 1} sans groupe`);
      for (const gr of wv.groups || []) {
        if (!defs.enemies[gr.enemy]) err(id, `vague ${i + 1} : yokai inconnu "${gr.enemy}"`);
        if (!(gr.count > 0)) err(id, `vague ${i + 1} : count invalide`);
        if ((gr.spawn ?? 0) >= g.spawns.length) err(id, `vague ${i + 1} : spawn ${gr.spawn} inexistant`);
        if (gr.absorb && !defs.towers[gr.absorb]) err(id, `vague ${i + 1} : absorb "${gr.absorb}" invalide`);
      }
    });
  }
}
console.log(errors ? `${errors} erreur(s)` : `Niveaux valides (${seen.size})`);
process.exit(errors ? 1 : 0);
