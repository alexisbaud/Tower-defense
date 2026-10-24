// Tests unitaires du moteur (sans navigateur). Usage : node tools/test-core.mjs
import { Game, STEP } from '../src/core/game.js';
import { defs } from '../src/data.js';

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}
const run = (g, seconds) => {
  for (let t = 0; t < seconds; t += STEP) g.update(STEP);
};

const OPEN_MAP = [
  ',,,,S,,,,',
  ',##ooo##,',
  ',#ooooo#,',
  ',#ooooo#,',
  ',##ooo##,',
  ',,,,.,,,,',
  ',,,,G,,,,',
];
const base = (extra = {}) => ({
  id: 'test',
  world: 'moss',
  map: OPEN_MAP,
  startGold: 1000,
  lives: 20,
  towers: ['fire', 'water', 'wind', 'earth'],
  stones: { cost: 10, max: 30 },
  waves: [{ groups: [{ enemy: 'kodama', count: 3, interval: 1 }] }, { groups: [{ enemy: 'kodama', count: 1, interval: 1 }] }],
  ...extra,
});

console.log('Pierres et chemin');
{
  const g = new Game(base(), defs, { recordEvents: true });
  const before = g.routeLength();
  check('pose valide', g.placeStone(4, 2));
  check('chemin rallongé ou égal', g.routeLength() >= before);
  // Rangée 1 : seules (3..5,1) descendent vers la rangée 2. On ferme (2..4,2) :
  // (5,2) devient l'unique passage et doit être refusée.
  g.placeStone(2, 2);
  g.placeStone(3, 2);
  const res = g.canPlaceStone(5, 2);
  check('blocage total refusé', !res.ok && res.reason === 'blocked', JSON.stringify(res));
  check('pierre hors gravier refusée', g.canPlaceStone(1, 1).reason === 'open');
  const gold = g.gold;
  g.removeStone(4, 2);
  check('retrait rembourse', g.gold > gold);
}

console.log('Fusion');
{
  const g = new Game(base(), defs);
  const a = g.placeTower('fire', 1, 1);
  const b = g.placeTower('fire', 2, 1);
  const c = g.placeTower('water', 6, 1);
  check('fusion refusée entre éléments différents', !g.canFuse(a.id, c.id).ok);
  const f = g.fuse(a.id, b.id);
  check('fusion N2', f && f.level === 2 && g.towers.length === 2);
  check('case source libérée', !g.towerAt(1, 1));
  const d = g.placeTower('fire', 1, 1);
  check('N2 + N1 refusée', !g.canFuse(d.id, f.id).ok);
}

console.log('Combos');
{
  const g = new Game(base(), defs, { recordEvents: true });
  g.placeTower('fire', 1, 2);
  g.placeTower('water', 1, 3);
  check('Vapeur détectée', g.zones.length === 1 && g.zones[0].def.id === 'steam');
  g.placeTower('earth', 2, 4);
  check('Boue (diagonale) détectée', g.zones.some((z) => z.def.id === 'mud'));
  const ids = new Set(defs.combos.map((c) => c.id));
  check('6 combos définis', ids.size === 6);
  const pairs = new Set(defs.combos.map((c) => [...c.elements].sort().join('+')));
  check('6 paires distinctes', pairs.size === 6);
}

console.log('Capacités des yokai');
{
  const g = new Game(base({ waves: [{ groups: [{ enemy: 'nuppeppo', count: 1, interval: 1 }] }] }), defs, { recordEvents: true });
  g.startNextWave();
  run(g, 1);
  const e = g.enemies[0];
  g.damage(e, 9999, 'fire');
  g.cleanup();
  check('division en 2', g.enemies.length === 2 && g.enemies.every((x) => x.type === 'nuppeppo_ko'));
}
{
  const g = new Game(base({ waves: [{ groups: [{ enemy: 'kitsune', count: 1, interval: 1, absorb: 'water' }] }] }), defs);
  g.startNextWave();
  run(g, 1);
  const e = g.enemies[0];
  e.hp = 40;
  g.damage(e, 20, 'water');
  check('absorption soigne', e.hp > 40);
  g.damage(e, 20, 'fire');
  check('autre élément blesse', e.hp < 50);
  e.blindT = 1;
  const hp = e.hp;
  g.damage(e, 10, 'water');
  check('aveuglé : absorption suspendue', e.hp < hp);
}
{
  const g = new Game(base({ waves: [{ groups: [{ enemy: 'kappa', count: 1, interval: 1 }] }] }), defs);
  g.startNextWave();
  run(g, 1);
  const e = g.enemies[0];
  const d1 = g.damage(e, 100, 'fire');
  const d2 = g.damage(e, 100, 'earth', { pierce: 1 });
  check('armure réduit, Terre perce', d1 < 50 && d2 === 100, `${d1} ${d2}`);
}
{
  const g = new Game(
    base({ waves: [{ groups: [{ enemy: 'yukionna', count: 1, interval: 1 }, { enemy: 'kodama', count: 1, interval: 1 }] }] }),
    defs,
  );
  g.startNextWave();
  run(g, 1);
  const k = g.enemies.find((x) => x.type === 'kodama');
  k.hp = 10;
  run(g, 2);
  check('Yuki-onna soigne', k.hp > 10, `${k.hp}`);
}
{
  const g = new Game(base({ waves: [{ groups: [{ enemy: 'tengu', count: 1, interval: 1 }] }] }), defs);
  g.placeTower('earth', 1, 1);
  g.startNextWave();
  run(g, 1);
  const e = g.enemies[0];
  check('volant', e.flying);
  check('la Terre ne vise pas les volants', !g.canTarget(defs.towers.earth, e));
}
{
  const g = new Game(base({ waves: [{ groups: [{ enemy: 'akaoni', count: 1, interval: 1 }] }] }), defs, { recordEvents: true });
  const t = g.placeTower('fire', 2, 1);
  g.startNextWave();
  run(g, 8.5);
  check('frappe du boss étourdit', g.events.some((ev) => ev.type === 'stomp'));
  void t;
}

console.log('Rendements décroissants');
{
  // Un yokai ne doit pas pouvoir être bloqué indéfiniment par du recul + des soins.
  const map = [
    ',,,,S,,,,',
    ',,,,.,,,,',
    ',,,,.#,,,',
    ',,,,.#,,,',
    ',,,,.,,,,',
    ',,,,.,,,,',
    ',,,,.,,,,',
    ',,,,.,,,,',
    ',,,,G,,,,',
  ];
  const g = new Game(
    base({ map, waves: [{ groups: [{ enemy: 'yukionna', count: 3, interval: 0.4, hp: 30 }, { enemy: 'kodama', count: 3, interval: 0.4, hp: 30 }] }] }),
    defs,
  );
  const w = g.placeTower('wind', 5, 2);
  w.level = 3;
  const a = g.placeTower('water', 5, 3);
  a.level = 3;
  g.startNextWave();
  run(g, 120);
  check('la vague progresse malgré Vent N3 + Eau N3 + soins', g.lives < 20 || g.state !== 'wave', `vies ${g.lives} état ${g.state}`);
  const e = g.createEnemy('kodama');
  g.applyStun(e, 1);
  const first = e.stunT;
  e.stunT = 0;
  g.applyStun(e, 1);
  check('étourdissements décroissants', e.stunT < first, `${e.stunT} < ${first}`);
  g.applyKnockback(e, 1);
  const k1 = e.knock;
  e.knock = 0;
  g.applyKnockback(e, 1);
  check('reculs décroissants', e.knock < k1);
}

console.log('Rembobinage');
{
  const lvl = base({
    rewind: true,
    waves: [{ groups: [{ enemy: 'kodama', count: 20, interval: 0.5 }] }],
  });
  const g = new Game(lvl, defs, { recordEvents: true });
  g.startNextWave();
  run(g, 3);
  check('pas avant 1 s de vague… puis disponible', g.canRewind());
  run(g, 5);
  const avail = g.rewindAvailable();
  check('6 s disponibles', Math.abs(avail - 6) < 0.15, `${avail}`);
  const goldBefore = g.gold;
  const placed = g.placeTower('fire', 1, 2);
  const enemyY = g.enemies.map((e) => e.y).reduce((a, b) => Math.max(a, b), 0);
  check('rembobinage lancé', g.rewind());
  check('une seule fois par vague', !g.canRewind());
  run(g, 1.3);
  check('animation terminée', !g.rewindAnim);
  check('lanterne posée après -> écho', g.echoes.length === 1 && g.echoes[0].type === 'fire');
  check('lanterne retirée du présent', !g.towerById(placed.id) && !g.towerAt(1, 2));
  check('or restauré (remboursé)', g.gold >= goldBefore, `${g.gold} vs ${goldBefore}`);
  const enemyY2 = g.enemies.map((e) => e.y).reduce((a, b) => Math.max(a, b), 0);
  check('yokai reculés', enemyY2 < enemyY, `${enemyY2} < ${enemyY}`);
  // 8 s - 6 s = 2 s, puis 0,2 s s'écoulent après l'animation (1,1 s) dans run(1.3).
  check('temps de vague reculé', Math.abs(g.waveTime - 2.2) < 0.2, `${g.waveTime}`);
  run(g, 10.5);
  check('écho disparu après 10 s', g.echoes.length === 0);
}

console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent');
process.exit(failures ? 1 : 0);
