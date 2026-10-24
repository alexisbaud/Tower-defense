// Génère BALANCE.md à partir des données (lanternes, yokai, combos, règles, niveaux).
// Usage : node tools/balance-md.mjs > BALANCE.md
import { defs, levelOrder, loadLevel } from '../src/data.js';
import { waveThreat } from './sim.mjs';

const { towers, enemies, combos, rules, elements } = defs;
const out = [];
const p = (s = '') => out.push(s);
const fmt = (v, d = 1) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(d));
const pct = (v) => `${Math.round(v * 100)} %`;
const elName = (el) => (elements[el] ? `${elements[el].kanji} ${elements[el].name}` : el);
const ATTACK = { projectile: 'tir', lob: 'tir en cloche', aura: 'aura', pulse: 'impulsion', beam: 'jet perçant', support: 'soutien', barrier: 'barrière' };

// Dégâts par seconde d'une lanterne contre un yokai (une cible, sans combo ni soutien).
export function effectiveDps(type, level, enemyId) {
  const def = towers[type];
  const st = def.levels[Math.min(level, def.levels.length) - 1];
  const e = enemies[enemyId];
  const atk = def.attack ?? 'projectile';
  if (atk === 'support' || atk === 'barrier') return null;
  const tg = def.targets ?? { ground: true, air: true };
  const flying = !!e.abilities?.flying;
  if (flying ? !tg.air : !tg.ground) return 0;
  const resist = e.resist?.[def.element] ?? 0;
  const armor = e.armor ?? 0;
  const minPart = rules.armorMinDamage ?? 0.2;
  let hit = (st.damage ?? 0) * (1 - resist) * (flying ? st.airMultiplier ?? 1 : 1);
  if (armor > 0) hit = Math.max(hit * minPart, hit - armor * (1 - (st.pierce ?? 0)));
  let dps = atk === 'aura' ? (st.auraDps ?? 0) * (1 - resist) : Math.max(0, hit) * st.rate;
  if (st.burn) dps += st.burn.dps * (1 - (e.resist?.fire ?? 0));
  return dps;
}

function effects(st, def) {
  const fx = [];
  if (st.splash) fx.push(`zone ${st.splash}`);
  if (st.pierce) fx.push(`perce ${pct(st.pierce)} d’armure`);
  if (st.burn) fx.push(`brûlure ${st.burn.dps}/s ${st.burn.duration} s`);
  if (st.slow) fx.push(`ralentit ×${st.slow.factor} ${st.slow.duration} s`);
  if (st.stun) fx.push(`étourdit ${st.stun} s`);
  if (st.knockback) fx.push(`recul ${st.knockback}`);
  if (st.airMultiplier) fx.push(`volants ×${st.airMultiplier}`);
  if (st.armorBreak) fx.push(`brise l’armure ${st.armorBreak} s`);
  if (st.auraDps) fx.push(`aura ${st.auraDps}/s`);
  if (st.width) fx.push(`largeur ${st.width}`);
  if (st.heal) fx.push(`soigne les barrières ${st.heal}/s`);
  if (st.cleanse) fx.push(`dissipe ${pct(st.cleanse)} des étourdissements`);
  if (st.rateBonus) fx.push(`cadence voisines +${pct(st.rateBonus)}`);
  if (st.barrierHp) fx.push(`barrière ${st.barrierHp} PV, relevée en ${st.respawn} s`);
  if (st.thorns) fx.push(`épines ${st.thorns}/s`);
  return fx.join(', ') || '—';
}

p('# Équilibrage — Jardin des Esprits');
p();
p('> Fichier généré par `node tools/balance-md.mjs > BALANCE.md` à partir de `data/`. Ne pas modifier à la main.');
p();
p('Principes : chaque lanterne a une force et une faiblesse nettes, chaque yokai contre une stratégie et a au moins deux réponses. ');
p('Aucune lanterne ne gagne seule : `node tools/sim.mjs --check` vérifie qu’aucun niveau (hors le premier) n’est gagnable avec une seule lanterne, que le bot équilibré gagne chaque niveau seul et en coopération, et qu’aucune vague ne double brutalement la difficulté.');
p();

p('## Éléments');
p();
p('| Élément | Forme | Style | Description |');
p('|---|---|---|---|');
for (const [id, el] of Object.entries(elements)) p(`| ${el.kanji} ${el.name} (\`${id}\`) | ${el.shape} | ${el.style} | ${el.desc} |`);
p();

p('## Lanternes');
p();
p('Coût d’un niveau N = coût × 2^(N−1) : une fusion consomme une lanterne identique. DPS = dégâts × cadence (+ brûlure), sur une cible sans armure.');
p();
for (const el of Object.keys(elements)) {
  p(`### ${elName(el)}`);
  p();
  for (const [id, t] of Object.entries(towers)) {
    if (t.element !== el) continue;
    const tg = t.targets ?? { ground: true, air: true };
    p(`**${t.kanji} ${t.name}** (\`${id}\`) — ${t.role}, ${ATTACK[t.attack ?? 'projectile']}, cibles : ${[tg.ground && 'sol', tg.air && 'air'].filter(Boolean).join(' + ') || 'aucune'}, priorité par défaut : ${t.priority ?? 'first'}  `);
    p(`Force : ${t.strength}  `);
    p(`Faiblesse : ${t.weakness}`);
    p();
    p('| Niv. | Coût total | Portée | Cadence | Dégâts | DPS | Effets |');
    p('|---|---|---|---|---|---|---|');
    t.levels.forEach((st, k) => {
      const dps = (st.damage ?? 0) * st.rate + (st.auraDps ?? 0) + (st.burn?.dps ?? 0);
      p(`| ${k + 1} | ${t.cost * 2 ** k} | ${fmt(st.range)} | ${fmt(st.rate, 2)}/s | ${fmt(st.damage)} | ${dps ? fmt(dps) : '—'} | ${effects(st, t)} |`);
    });
    p();
  }
}

p('## Yokai');
p();
p('| Yokai | PV | Vitesse | Armure | Résistances | Récompense | Dégâts | Attaque (barrières) | Capacités |');
p('|---|---|---|---|---|---|---|---|---|');
for (const [id, e] of Object.entries(enemies)) {
  const res = Object.entries(e.resist || {}).map(([k, v]) => `${elements[k]?.name ?? k} ${v > 0 ? '−' : '+'}${pct(Math.abs(v))}`).join(', ') || '—';
  const ab = Object.keys(e.abilities || {}).join(', ') || '—';
  p(`| ${e.name} (\`${id}\`)${e.boss ? ' **boss**' : ''} | ${e.hp} | ${e.speed} | ${e.armor ?? 0} | ${res} | ${e.reward} | ${e.damage} | ${e.attack ?? 0}/s | ${ab} |`);
}
p();
p('| Yokai | Force | Faiblesse | Contres |');
p('|---|---|---|---|');
for (const e of Object.values(enemies)) p(`| ${e.name} | ${e.strength} | ${e.weakness} | ${e.counters} |`);
p();

p('## DPS effectif au niveau 1 (armure et résistances comprises)');
p();
p('Une case à 0 : la lanterne ne peut pas toucher ce yokai (volant, absorption non comptée). Lire en colonne : les meilleures réponses à chaque yokai.');
p();
const attackers = Object.keys(towers).filter((t) => !['support', 'barrier'].includes(towers[t].attack));
const shown = Object.keys(enemies).filter((e) => !enemies[e].boss || true);
p(`| Lanterne | ${shown.map((e) => enemies[e].name).join(' | ')} |`);
p(`|---|${shown.map(() => '---').join('|')}|`);
for (const t of attackers) {
  const row = shown.map((e) => {
    const v = effectiveDps(t, 1, e);
    return v == null ? '—' : fmt(v / (towers[t].cost / 50));
  });
  p(`| ${towers[t].name} | ${row.join(' | ')} |`);
}
p();
p('(valeurs ramenées à un coût de 50 or pour comparer les lanternes entre elles)');
p();

p('## Combos');
p();
p('Deux lanternes d’éléments différents voisines (diagonale comprise). Puissance : +' + pct(rules.comboLevelBonus) + ' par niveau de la lanterne la plus faible ; un écho du Rembobinage agit à ' + pct(rules.echoComboPower) + '.');
p();
p('| Combo | Éléments | Effet | Contre |');
p('|---|---|---|---|');
for (const c of combos) p(`| ${c.kanji} ${c.name} | ${c.elements.map(elName).join(' + ')} | ${c.desc} | ${(c.counters || []).map((e) => enemies[e]?.name ?? e).join(', ')} |`);
p();

p('## Règles');
p();
p('| Règle | Valeur |');
p('|---|---|');
const R = [
  ['Vente', pct(rules.sellRatio) + ' de l’or investi'],
  ['Récompense de fin de vague (défaut)', `${rules.waveReward} or`],
  ['Appel anticipé', `${rules.earlyBonusPerSecond} or par seconde d’avance (à chaque joueur) et ${rules.rewindPerEarlySecond} de jauge par seconde`],
  ['Pause entre vagues (défaut)', `${rules.wavePause} s après la fin des apparitions`],
  ['Armure', `retranchée de chaque coup, au moins ${pct(rules.armorMinDamage)} du coup passe ; brûlures et auras l’ignorent`],
  ['Ralentissement', `jamais sous ${pct(rules.minSlowFactor)} de la vitesse`],
  ['Rembobinage', `${rules.rewindSeconds} s en arrière pour une jauge de ${rules.rewindCost} (${rules.rewindPerGold} par pièce d’or de récompense) ; échos ${rules.echoSeconds} s à ${pct(rules.echoPower)}`],
  ['Dernière chance', `${rules.lastChanceSeconds} s pour rembobiner après une fuite fatale (jauge pleine)`],
  ['Étoiles', `3★ ≥ ${pct(rules.stars3)} des vies, 2★ ≥ ${pct(rules.stars2)}`],
  ['Coopération (1 → 4 joueurs)', `or de départ ×${rules.coop.startGold.join(' / ')} par joueur, récompenses ×${rules.coop.reward.join(' / ')} à chacun, PV des yokai ×${rules.coop.hp.join(' / ')}`],
];
for (const [k, v] of R) p(`| ${k} | ${v} |`);
p();

p('## Niveaux');
p();
p('| Niveau | Leçon | Vagues | Or | Vies | PV ×| Lanternes | Nouveaux yokai | Climax | Défi | Difficile |');
p('|---|---|---|---|---|---|---|---|---|---|---|');
const levels = [];
for (const { id } of levelOrder()) {
  const L = await loadLevel(id);
  levels.push(L);
  const climax = L.waves.findIndex((w) => w.climax);
  const hard = L.hard ? [L.hard.hpScale && `PV ×${L.hard.hpScale}`, L.hard.startGold && `or ${L.hard.startGold > 0 ? '+' : ''}${L.hard.startGold}`, L.hard.lives && `vies ${L.hard.lives}`].filter(Boolean).join(', ') : '—';
  p(
    `| ${id} ${L.name} | ${L.concept ?? '—'} | ${L.waves.length} | ${L.startGold} | ${L.lives ?? rules.lives} | ${L.hpScale ?? 1} | ${(L.towers || Object.keys(towers)).length} | ${(L.introduce || []).map((e) => enemies[e]?.name ?? e).join(', ') || '—'} | ${climax >= 0 ? `v${climax + 1} ${L.waves[climax].name ?? ''}` : '—'} | ${L.challenge ? `${L.challenge.name} : ${L.challenge.desc}` : '—'} | ${hard} |`,
  );
}
p();
p('### Courbe de menace par vague');
p();
p('Menace = PV effectifs (armure, vitesse, dégâts au sanctuaire) de la vague, en centaines. ▲ = vague climax.');
p();
p('```');
for (const L of levels) {
  const th = L.waves.map((w) => waveThreat(L, w));
  const max = Math.max(...th);
  const bars = th.map((v, i) => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((v / max) * 7.99))] + (L.waves[i].climax ? '▲' : ''));
  p(`${L.id.padEnd(4)} ${bars.join('')}  ${th.map((v) => Math.round(v / 100)).join(' ')}`);
}
p('```');
p();

console.log(out.join('\n'));
