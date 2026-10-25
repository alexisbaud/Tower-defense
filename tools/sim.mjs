// Simulateur headless : joue chaque niveau avec des bots pour vérifier l'équilibrage.
//
// Usage :
//   node tools/sim.mjs [idNiveau ...] [--bots=balanced,random,mono] [--seeds=1,2,3]
//                      [--players=1..4] [--elements=fire+water,…] [--hard] [--check] [--verbose]
//
//   --bots=mono   une partie par lanterne d'attaque disponible (mono:fire, mono:water…)
//   --players=N   coopération : N bots, chacun limité à UN élément (Feu, Eau, Vent, Terre
//                 dans l'ordre) ; les éléments que personne n'a pris ne sont à personne
//   --elements=   équipes à simuler, une par combinaison : fire+water, wind+earth…
//                 (« all2 », « all3 », « all4 » : toutes les paires, triplets, les quatre)
//   --check       vérifications de l'étape 6 ; code de sortie 1 en cas d'échec :
//                   · chaque niveau est gagné par le bot équilibré seul, et en coopération
//                     par CHAQUE équipe d'éléments : les 6 paires, les 4 triplets et les
//                     quatre éléments (un bot par joueur, limité à son élément)
//                   · aucun niveau (sauf le premier) n'est gagné en n'utilisant qu'une lanterne
//                   · aucune vague ne double brutalement la difficulté ; 10 à 15 vagues ;
//                     une vague climax annoncée, pic le plus dur en fin de niveau ;
//                     durée de 5 à 8 minutes
//
// Lanternes affichées : initiale de l'élément (F feu, E eau, V vent, T terre),
// variante (m mortier, f follets, s source, t torrent, c carillon, a arc, g gardien, q séisme), niveau.
import { Game, STEP, assignElements } from '../src/core/game.js';
import { defs, loadLevel, levelOrder } from '../src/data.js';
import { bot } from './bot.mjs';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ELEMENTS = ['fire', 'water', 'wind', 'earth'];
const INITIAL = { fire: 'F', water: 'E', wind: 'V', earth: 'T' };
const VARIANT = { mortar: 'm', wisp: 'f', spring: 's', torrent: 't', chime: 'c', bow: 'a', guard: 'g', quake: 'q' };

export function towerCode(t) {
  const d = defs.towers[t.type];
  return (INITIAL[d.element] ?? '?') + (VARIANT[d.variant] ?? '') + t.level;
}

// Joueurs d'une partie coopérative : un élément choisi par joueur (assignElements :
// chacun n'a que le sien). `choices` : nombre de joueurs (Feu, Eau, Vent, Terre dans
// l'ordre) ou liste d'éléments.
export function coopPlayers(choices) {
  const list = typeof choices === 'number' ? ELEMENTS.slice(0, choices) : choices;
  return assignElements(list).map((elements, i) => ({ name: `Bot ${i + 1}`, elements }));
}

// Toutes les équipes réalistes de k joueurs : un élément différent chacun.
export function elementTeams(k) {
  const out = [];
  const rec = (start, cur) => {
    if (cur.length === k) return out.push(cur.slice());
    for (let i = start; i < ELEMENTS.length; i++) rec(i + 1, [...cur, ELEMENTS[i]]);
  };
  rec(0, []);
  return out;
}

// Équipes vérifiées par --check : 6 paires, 4 triplets, les quatre éléments.
export const COOP_TEAMS = [2, 3, 4].flatMap(elementTeams);

export const teamCode = (els) => els.map((el) => INITIAL[el]).join('');

export async function simulate(id, strategy, seed = 1, { players = 1, elements = null, hard = false, challenge = false } = {}) {
  const level = await loadLevel(id);
  const team = elements?.length > 1 ? coopPlayers(elements) : players > 1 ? coopPlayers(players) : undefined;
  const game = new Game(level, defs, { seed, recordEvents: false, hard, players: team });
  game.challenge = challenge && !!level.challenge;
  const bots = game.players.map((p) => bot(strategy, game, { pid: p.id, seed: seed * 7 + p.id }));
  let t = 0;
  const maxT = 60 * 30;
  const leaks = [];
  let lives = game.lives;
  while (game.state !== 'won' && game.state !== 'lost' && t < maxT) {
    for (const b of bots) b.tick(t);
    game.update(STEP);
    t += STEP;
    if (game.lives < lives) {
      const w = Math.max(0, game.waveIndex);
      leaks[w] = (leaks[w] || 0) + (lives - game.lives);
      lives = game.lives;
    }
    lives = game.lives;
  }
  return {
    id,
    strategy,
    players: game.players.length,
    team: game.players.length > 1 ? teamCode(game.players.map((p) => p.elements[0])) : '',
    state: game.state,
    challengeMet: game.challengeMet(),
    lives: game.lives,
    maxLives: game.maxLives,
    stars: game.stars(),
    wave: game.waveIndex + 1,
    waves: game.totalWaves,
    gold: game.players.map((p) => Math.round(p.gold)).join('/'),
    towers: game.towers.map(towerCode).join(' '),
    rewinds: game.rewindsUsed,
    time: Math.round(t),
    leaks,
    log: bots.flatMap((b) => b.log),
  };
}

// Menace d'une vague : PV effectifs (armure, PV du niveau) pondérés par la vitesse.
export function waveThreat(level, wave) {
  let threat = 0;
  for (const gr of wave.groups) {
    const d = defs.enemies[gr.enemy];
    if (!d) continue;
    let hp = d.hp * (gr.hp ?? 1);
    const split = d.abilities?.split;
    if (split) hp += defs.enemies[split.into].hp * split.count * (gr.hp ?? 1);
    const armor = 1 + (d.armor ?? 0) / 20;
    const speed = 0.6 + 0.4 * d.speed;
    const flying = d.abilities?.flying ? 1.15 : 1;
    threat += hp * armor * speed * flying * gr.count * (d.damage ?? 1) ** 0.3;
  }
  return threat * (level.hpScale ?? 1);
}

// Vérifications structurelles d'un niveau (sans simulation).
export function checkStructure(level) {
  const issues = [];
  const n = level.waves.length;
  if (n < 10 || n > 15) issues.push(`${n} vagues (attendu 10 à 15)`);
  const climax = level.waves.map((w, i) => (w.climax ? i : -1)).filter((i) => i >= 0);
  if (climax.length !== 1) issues.push(`${climax.length} vague(s) climax (attendu 1)`);
  const threats = level.waves.map((w) => waveThreat(level, w));
  for (let i = 2; i < n; i++) {
    const ref = Math.max(threats[i - 1], threats[i - 2]);
    if (threats[i] > ref * 2) issues.push(`vague ${i + 1} : menace ×${(threats[i] / ref).toFixed(2)} par rapport aux deux précédentes`);
  }
  if (n >= 2 && threats[1] > threats[0] * 2.5) issues.push(`vague 2 : menace ×${(threats[1] / threats[0]).toFixed(2)}`);
  const peak = threats.indexOf(Math.max(...threats));
  if (peak < n - 2) issues.push(`pic de menace en vague ${peak + 1}/${n} (le dernier pic doit être le plus dur)`);
  if (climax.length === 1 && climax[0] < n - 2) issues.push(`climax en vague ${climax[0] + 1}/${n} (attendu en fin de niveau)`);
  // dents de scie : au moins deux replis après une hausse
  let drops = 0;
  for (let i = 1; i < n; i++) if (threats[i] < threats[i - 1] * 0.9) drops++;
  if (drops < 2) issues.push(`courbe trop lisse (${drops} repli(s), attendu ≥ 2 : dents de scie)`);
  return { issues, threats };
}

// Lanternes d'attaque disponibles dans un niveau (pour les bots mono).
function attackTowers(level) {
  return (level.towers || Object.keys(defs.towers)).filter((t) => !['support', 'barrier'].includes(defs.towers[t]?.attack));
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name, def) => (args.find((a) => a.startsWith(`--${name}=`)) || `--${name}=${def}`).slice(name.length + 3);
  const verbose = args.includes('--verbose');
  const check = args.includes('--check');
  const hard = args.includes('--hard');
  const seeds = opt('seeds', '1').split(',').map(Number);
  const players = Number(opt('players', '1'));
  const teamsOpt = opt('elements', '');
  const teams = teamsOpt
    ? teamsOpt.split(',').flatMap((t) => (/^all[234]$/.test(t) ? elementTeams(Number(t[3])) : [t.split('+')]))
    : [null];
  const ids = args.filter((a) => !a.startsWith('--'));
  const order = levelOrder().map((l) => l.id);
  const list = ids.length ? ids : order;
  let failures = 0;
  const fail = (msg) => {
    failures++;
    console.log(`  ✗ ${msg}`);
  };

  const line = (r, seed) =>
    `${r.id.padEnd(5)} ${(r.strategy + (r.players > 1 ? ` ×${r.players} ${r.team}` : '')).padEnd(18)}${seeds.length > 1 ? ` s${seed}` : ''} ${r.state.padEnd(4)} ` +
    `vies ${String(r.lives).padStart(2)}/${r.maxLives} ★${r.stars} vague ${r.wave}/${r.waves} or ${r.gold} t=${r.time}s` +
    `${r.rewinds ? ` ↺${r.rewinds}` : ''}  [${r.towers}]`;

  if (!check) {
    const strategies = opt('bots', 'balanced').split(',');
    for (const id of list) {
      const level = await loadLevel(id);
      const strats = strategies.flatMap((s) => (s === 'mono' ? attackTowers(level).map((t) => `mono:${t}`) : [s]));
      for (const s of strats) {
        for (const team of teams) {
          for (const seed of seeds) {
            const r = await simulate(id, s, seed, { players, elements: team, hard });
            console.log(line(r, seed));
            if (verbose) {
              console.log(`        fuites par vague : ${r.leaks.map((x, i) => (x ? `v${i + 1}:${x}` : '')).filter(Boolean).join(' ') || 'aucune'}`);
              for (const l of r.log) console.log('        ' + l);
            }
          }
        }
      }
    }
  } else {
    for (const id of list) {
      const level = await loadLevel(id);
      const first = order.indexOf(id) === 0;
      console.log(`\n${id} — ${level.name}`);
      const { issues, threats } = checkStructure(level);
      console.log(`  menace : ${threats.map((t) => Math.round(t / 100)).join(' ')}${level.waves.map((w, i) => (w.climax ? ` (climax v${i + 1})` : '')).join('')}`);
      for (const msg of issues) fail(msg);
      for (const seed of seeds) {
        const r = await simulate(id, 'balanced', seed);
        console.log('  ' + line(r, seed));
        if (r.state !== 'won') fail(`le bot équilibré perd (graine ${seed})`);
        else if (r.time < 300 || r.time > 480) fail(`durée ${r.time} s (attendu 300 à 480 s)`);
        if (verbose) console.log(`        fuites par vague : ${r.leaks.map((x, i) => (x ? `v${i + 1}:${x}` : '')).filter(Boolean).join(' ') || 'aucune'}`);
      }
      // Coopération : chaque équipe d'éléments (un bot par joueur, limité à son élément).
      for (const els of COOP_TEAMS) {
        const r = await simulate(id, 'balanced', seeds[0], { elements: els });
        console.log('  ' + line(r, seeds[0]));
        if (r.state !== 'won') fail(`coop ×${els.length} ${els.join(' + ')} : le bot équilibré perd`);
        if (verbose) console.log(`        fuites par vague : ${r.leaks.map((x, i) => (x ? `v${i + 1}:${x}` : '')).filter(Boolean).join(' ') || 'aucune'}`);
      }
      const r = await simulate(id, 'random', seeds[0]);
      console.log('  ' + line(r, seeds[0]) + '  (indicatif)');
      for (const type of attackTowers(level)) {
        const m = await simulate(id, `mono:${type}`, seeds[0]);
        if (verbose || m.state === 'won') console.log('  ' + line(m, seeds[0]));
        if (m.state === 'won' && !first) fail(`gagnable avec la seule lanterne ${type}`);
      }
      if (level.challenge) {
        const c = await simulate(id, 'balanced', seeds[0], { challenge: true });
        const perf = ['noLeak', 'minLives'].some((k) => level.challenge.rule?.[k] != null);
        console.log('  ' + line(c, seeds[0]) + `  (défi « ${level.challenge.name} » ${c.challengeMet ? 'réussi' : 'échoué'}${perf ? ', indicatif' : ''})`);
        if (!perf && !c.challengeMet) fail(`défi « ${level.challenge.name} » non réussi par le bot équilibré`);
      } else fail('aucun défi optionnel');
      if (!level.hard) fail('aucun réglage Difficile (hard)');
      if (hard || level.hard) {
        const h = await simulate(id, 'balanced', seeds[0], { hard: true });
        console.log('  ' + line(h, seeds[0]) + '  (Difficile)');
        if (h.state !== 'won') fail('Difficile : le bot équilibré perd');
      }
    }
    console.log(failures ? `\n${failures} échec(s)` : '\nToutes les vérifications passent');
    process.exit(failures ? 1 : 0);
  }
}
