// Valide le schéma de chaque niveau listé dans data/worlds.js.
// Usage : node tools/validate-levels.mjs
import { defs, worlds, loadLevel } from '../src/data.js';
import { Grid, LEGEND, T } from '../src/core/grid.js';
import { bfs } from '../src/core/flowfield.js';

const TUTORIALS = ['place', 'wave', 'fuse', 'combo', 'stone', 'rewind', 'barrier', 'early', 'priority'];
const RULE_KEYS = new Set(['forbidTowers', 'noStones', 'noRewind', 'maxTowers', 'noLeak', 'minLives']);
let errors = 0;
const err = (id, msg) => {
  errors++;
  console.log(`  ✗ [${id}] ${msg}`);
};

// ───── Données globales : tours, yokai, combos (références et valeurs) ─────
const ELEMENTS = new Set(Object.keys(defs.elements));
const ATTACKS = new Set(['projectile', 'lob', 'aura', 'pulse', 'beam', 'support', 'barrier']);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
for (const [id, t] of Object.entries(defs.towers)) {
  if (!Array.isArray(t.levels) || !t.levels.length) err(`tour:${id}`, 'levels vide');
  if (!num(t.cost) || t.cost <= 0) err(`tour:${id}`, 'cost invalide');
  if (!ELEMENTS.has(t.element)) err(`tour:${id}`, `élément inconnu « ${t.element} »`);
  if (t.attack && !ATTACKS.has(t.attack)) err(`tour:${id}`, `attaque inconnue « ${t.attack} »`);
  for (const k of ['name', 'role', 'strength', 'weakness']) if (!t[k]) err(`tour:${id}`, `${k} manquant`);
  (t.levels || []).forEach((l, k) => {
    for (const key of ['range', 'rate']) if (!num(l[key]) || l[key] <= 0) err(`tour:${id}`, `N${k + 1} : ${key} doit être > 0`);
    if (l.damage != null && (!num(l.damage) || l.damage < 0)) err(`tour:${id}`, `N${k + 1} : damage invalide`);
    if (l.pierce != null && (!num(l.pierce) || l.pierce < 0 || l.pierce > 1)) err(`tour:${id}`, `N${k + 1} : pierce hors de 0..1`);
  });
}
for (const [id, e] of Object.entries(defs.enemies)) {
  if (!num(e.hp) || e.hp <= 0) err(`yokai:${id}`, 'hp doit être > 0');
  if (!num(e.speed) || e.speed <= 0) err(`yokai:${id}`, 'speed doit être > 0');
  const ab = e.abilities || {};
  if (ab.split && !defs.enemies[ab.split.into]) err(`yokai:${id}`, `split.into inconnu « ${ab.split.into} »`);
  if (ab.summon && !defs.enemies[ab.summon.enemy]) err(`yokai:${id}`, `summon.enemy inconnu « ${ab.summon.enemy} »`);
  if (ab.absorb && !ELEMENTS.has(ab.absorb)) err(`yokai:${id}`, `absorb inconnu « ${ab.absorb} »`);
  for (const el of ab.cycleAbsorb?.elements || []) if (!ELEMENTS.has(el)) err(`yokai:${id}`, `cycleAbsorb : élément inconnu « ${el} »`);
  for (const el of Object.keys(e.resist || {})) if (!ELEMENTS.has(el)) err(`yokai:${id}`, `resist : élément inconnu « ${el} »`);
  if (e.armor != null && (!num(e.armor) || e.armor < 0)) err(`yokai:${id}`, 'armor invalide');
  for (const k of ['strength', 'weakness', 'counters']) if (!e[k]) err(`yokai:${id}`, `${k} manquant`);
}
for (const c of defs.combos) {
  for (const el of c.elements || []) if (!ELEMENTS.has(el)) err(`combo:${c.id}`, `élément inconnu « ${el} »`);
  if (!c.effect?.kind) err(`combo:${c.id}`, 'effect.kind manquant');
}

// Clés autorisées (une faute de frappe comme « intervale » est signalée).
const LEVEL_KEYS = new Set(['id', 'name', 'subtitle', 'world', 'map', 'startGold', 'lives', 'towers', 'stones', 'rewind', 'tutorial', 'introduce', 'waves', 'hpScale', 'wavePause', 'rules', 'hard', 'challenge', 'rewindStart', 'concept']);
const WAVE_KEYS = new Set(['groups', 'reward', 'pause', 'climax', 'name']);
const GROUP_KEYS = new Set(['enemy', 'count', 'interval', 'delay', 'spawn', 'hp', 'absorb']);

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
    // En coopération, chaque joueur doit pouvoir construire : au moins une lanterne d'attaque par élément.
    const towersHere = L.towers || Object.keys(defs.towers);
    for (const el of ELEMENTS) {
      if (!towersHere.some((t) => defs.towers[t]?.element === el && !['support', 'barrier'].includes(defs.towers[t].attack))) err(id, `aucune lanterne d'attaque de l'élément ${el}`);
    }
    // Socles typés : l'élément du socle doit être proposé dans le niveau.
    for (let i = 0; i < g.size; i++) {
      const se = g.slotElement[i];
      if (se && !towersHere.some((t) => defs.towers[t]?.element === se)) err(id, `socle ${se} (${g.col(i)},${g.row(i)}) sans lanterne de cet élément`);
    }
    if (L.hard) {
      for (const k of Object.keys(L.hard)) if (!['hpScale', 'startGold', 'lives', 'rules'].includes(k)) err(id, `hard : clé inconnue « ${k} »`);
    }
    if (L.challenge) {
      if (!L.challenge.name || !L.challenge.desc) err(id, 'challenge : name et desc requis');
      for (const k of Object.keys(L.challenge.rule || {})) if (!RULE_KEYS.has(k)) err(id, `challenge.rule : clé inconnue « ${k} »`);
      for (const t of L.challenge.rule?.forbidTowers || []) if (!defs.towers[t]) err(id, `challenge : tour inconnue « ${t} »`);
    }
    for (const t of L.tutorial || []) if (!TUTORIALS.includes(t)) err(id, `tutoriel inconnu "${t}"`);
    for (const e of L.introduce || []) if (!defs.enemies[e]) err(id, `introduce : yokai inconnu "${e}"`);
    if (!Array.isArray(L.waves) || !L.waves.length) err(id, 'aucune vague');
    for (const k of Object.keys(L)) if (!LEVEL_KEYS.has(k)) err(id, `clé de niveau inconnue « ${k} »`);
    (L.waves || []).forEach((wv, i) => {
      if (!wv.groups?.length) err(id, `vague ${i + 1} sans groupe`);
      for (const k of Object.keys(wv)) if (!WAVE_KEYS.has(k)) err(id, `vague ${i + 1} : clé inconnue « ${k} »`);
      for (const gr of wv.groups || []) {
        for (const k of Object.keys(gr)) if (!GROUP_KEYS.has(k)) err(id, `vague ${i + 1} : clé de groupe inconnue « ${k} »`);
        if (!Number.isInteger(gr.count)) err(id, `vague ${i + 1} : count doit être un entier`);
        if (gr.interval != null && !(gr.interval > 0)) err(id, `vague ${i + 1} : interval doit être > 0`);
        if (gr.delay != null && !(gr.delay >= 0)) err(id, `vague ${i + 1} : delay doit être ≥ 0`);
        if (gr.hp != null && !(gr.hp > 0)) err(id, `vague ${i + 1} : hp doit être > 0`);
        if (!defs.enemies[gr.enemy]) err(id, `vague ${i + 1} : yokai inconnu "${gr.enemy}"`);
        if (!(gr.count > 0)) err(id, `vague ${i + 1} : count invalide`);
        if ((gr.spawn ?? 0) >= g.spawns.length) err(id, `vague ${i + 1} : spawn ${gr.spawn} inexistant`);
        if (gr.absorb && !ELEMENTS.has(gr.absorb)) err(id, `vague ${i + 1} : absorb "${gr.absorb}" invalide`);
      }
    });
  }
}
console.log(errors ? `${errors} erreur(s)` : `Niveaux valides (${seen.size})`);
process.exit(errors ? 1 : 0);
