// Simulateur headless : joue chaque niveau avec un « bot » pour vérifier qu'il
// est gagnable. Usage : node tools/sim.mjs [idNiveau ...] [--verbose]
import { Game, STEP } from '../src/core/game.js';
import { defs, loadLevel, levelOrder } from '../src/data.js';
import { bot } from './bot.mjs';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const strategies = (args.find((a) => a.startsWith('--bots=')) || '--bots=smart').slice(7).split(',');
const seeds = (args.find((a) => a.startsWith('--seeds=')) || '--seeds=1').slice(8).split(',').map(Number);
const ids = args.filter((a) => !a.startsWith('--'));
const list = ids.length ? ids : levelOrder().map((l) => l.id);

export async function simulate(id, strategy, seed = 1) {
  const level = await loadLevel(id);
  const game = new Game(level, defs, { seed, recordEvents: false });
  const b = bot(strategy, game);
  let t = 0;
  const maxT = 60 * 60; // 1 h de jeu max
  while (game.state !== 'won' && game.state !== 'lost' && t < maxT) {
    b.tick(t);
    game.update(STEP);
    t += STEP;
  }
  return {
    id,
    strategy,
    state: game.state,
    lives: game.lives,
    maxLives: game.maxLives,
    stars: game.stars(),
    wave: game.waveIndex + 1,
    waves: game.totalWaves,
    gold: Math.round(game.gold),
    towers: game.towers.map((x) => x.type[0] + x.level).join(' '),
    time: Math.round(t),
    log: b.log,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let failed = false;
  for (const id of list) {
    for (const s of strategies) for (const seed of seeds) {
      const r = await simulate(id, s, seed);
      const ok = r.state === 'won';
      if (!ok && s === 'smart') failed = true;
      console.log(
        `${id.padEnd(5)} ${s.padEnd(7)}${seeds.length > 1 ? ` s${seed}` : ''} ${r.state.padEnd(4)} vies ${String(r.lives).padStart(2)}/${r.maxLives} ` +
          `★${r.stars} vague ${r.wave}/${r.waves} or ${r.gold} t=${r.time}s  [${r.towers}]`,
      );
      if (verbose) console.log(r.log.join('\n'));
    }
  }
  process.exit(failed ? 1 : 0);
}
