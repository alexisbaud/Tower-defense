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
{
  // Fusionner une lanterne déjà en combo : même zone (minuterie gardée), pas de nouvelle annonce.
  const g = new Game(base(), defs, { recordEvents: true });
  g.placeTower('water', 1, 2);
  const v = g.placeTower('wind', 1, 3);
  const v2 = g.placeTower('wind', 7, 1);
  const z0 = g.zones.find((z) => z.def.id === 'frost');
  z0.timer = 3.5;
  g.events.length = 0;
  g.fuse(v2.id, v.id);
  const z1 = g.zones.find((z) => z.def.id === 'frost');
  check('fusion : zone conservée', z1 && z1.key === z0.key && z1.timer === 3.5 && z1.mult > z0.mult);
  check('fusion : combo non réannoncé', !g.events.some((ev) => ev.type === 'combo'));
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
{
  // Recul complet le long de la trace, même depuis le centre d'une case (pas d'oscillation).
  const map = [
    ',,,,S,,,,',
    ',,,,.,,,,',
    ',,,,.,,,,',
    ',,,,.,,,,',
    ',,,,.,,,,',
    ',,,,.,,,,',
    ',,,,.,,,,',
    ',,,,G,,,,',
  ];
  const g = new Game(base({ map, waves: [{ groups: [{ enemy: 'kodama', count: 1 }] }] }), defs);
  g.startNextWave();
  run(g, 4);
  const e = g.enemies[0];
  e.x = e.mx = g.grid.cx(e.cur);
  e.y = e.my = g.grid.cy(e.cur);
  const y0 = e.y;
  g.applyKnockback(e, 1.1);
  const amount = e.knock;
  let back = 0;
  let jitter = false;
  let prev = e.y;
  while (e.knock > 0) {
    g.update(STEP);
    if (e.y > prev + 1e-9) jitter = true;
    prev = e.y;
    back = Math.max(back, y0 - e.y);
  }
  check('recul complet depuis le centre d’une case', Math.abs(back - amount) < 0.02, `${back.toFixed(3)} / ${amount.toFixed(3)}`);
  check('recul sans aller-retour', !jitter);
  // le yokai est entre sa case de recul (devenue courante) et la case qu'il quittait
  check('case de recul = case courante', g.grid.cy(e.cur) <= e.y && e.y <= g.grid.cy(e.target), `${g.grid.cy(e.cur)} ≤ ${e.y} ≤ ${g.grid.cy(e.target)}`);
}

console.log('Correctifs de l’audit (bloc bugs)');
{
  // A1 : un effet faible ne prolonge plus un effet fort.
  const g = new Game(base({ waves: [{ groups: [{ enemy: 'kodama', count: 1 }] }] }), defs);
  g.startNextWave();
  run(g, 1);
  const e = g.enemies[0];
  g.applySlow(e, 0.35, 0.3, null);
  g.applySlow(e, 0.6, 1.4, 'water');
  run(g, 0.5);
  check('A1 ralentissement fort expiré, faible actif', Math.abs(e.slowF - 0.6) < 1e-6, `${e.slowF}`);
  g.applyBurn(e, 20, 0.5, null);
  g.applyBurn(e, 2.5, 3, 'fire');
  const hp = e.hp;
  run(g, 2);
  const lost = hp - e.hp;
  check('A1 brûlure forte non prolongée', lost < 20 * 0.5 + 2.5 * 2 + 1, `${lost.toFixed(1)}`);
  // C15 : un étourdissement plus court que l'actuel ne coûte pas de fatigue
  g.applyStun(e, 1);
  const f = e.stunFatigue;
  g.applyStun(e, 0.3);
  check('C15 étourdissement court sans fatigue', e.stunFatigue === f);
}
{
  // A2 : les enfants d'une division restent séparés.
  const g = new Game(base({ waves: [{ groups: [{ enemy: 'nuppeppo', count: 1, hp: 2 }] }] }), defs);
  g.startNextWave();
  run(g, 3);
  g.damage(g.enemies[0], 9999, 'fire');
  g.cleanup();
  run(g, 3);
  const [a, b] = g.enemies;
  check('A2 enfants distincts après 3 s', a && b && Math.hypot(a.x - b.x, a.y - b.y) > 0.15, a && b ? Math.hypot(a.x - b.x, a.y - b.y).toFixed(3) : 'absents');
  check('A19 enfants héritent du multiplicateur de PV', a && Math.abs(a.maxHp - defs.enemies.nuppeppo_ko.hp * 2) < 1e-6, a ? `${a.maxHp}` : '');
}
{
  // A3 : plafond de fusion lié aux données de la tour.
  const towers = { ...defs.towers, mini: { ...defs.towers.fire, levels: defs.towers.fire.levels.slice(0, 2) } };
  const g = new Game(base({ towers: ['mini'] }), { ...defs, towers });
  const a = g.placeTower('mini', 1, 1);
  const b = g.placeTower('mini', 2, 1);
  const c = g.fuse(a.id, b.id);
  const d = g.placeTower('mini', 1, 1);
  const e2 = g.placeTower('mini', 6, 1);
  const f2 = g.fuse(d.id, e2.id);
  check('A3 N2 maximum pour une tour à 2 niveaux', !g.canFuse(f2.id, c.id).ok && g.canFuse(f2.id, c.id).reason === 'level');
}
{
  // A9 / A11 : socle d'un écho occupé ; aucune commande pendant l'animation.
  const g = new Game(base({ rewind: true, waves: [{ groups: [{ enemy: 'kodama', count: 30, interval: 0.5 }] }] }), defs);
  g.startNextWave();
  run(g, 7);
  g.placeTower('fire', 1, 2);
  g.rewind();
  check('A11 pose refusée pendant le rembobinage', g.canPlaceTower('water', 6, 2).reason === 'rewinding');
  check('A11 pierre refusée pendant le rembobinage', g.canPlaceStone(4, 2).reason === 'rewinding');
  run(g, 1.3);
  check('A9 socle de l’écho occupé', g.canPlaceTower('water', 1, 2).reason === 'echo');
}
{
  // A18 : une brûlure résiduelle ne soigne pas un yokai qui absorbe le feu.
  const g = new Game(base({ waves: [{ groups: [{ enemy: 'kitsune', count: 1, absorb: 'fire' }] }] }), defs);
  g.startNextWave();
  run(g, 1);
  const e = g.enemies[0];
  e.hp = 30;
  e.burns.push({ v: 10, t: 2 });
  run(g, 1);
  check('A18 brûlure sans soin', e.hp <= 30);
}
{
  // A23 : pas de tir de trop sur une cible déjà condamnée.
  const g = new Game(base({ waves: [{ groups: [{ enemy: 'kodama', count: 1 }] }] }), defs);
  g.startNextWave();
  run(g, 1);
  const e = g.enemies[0];
  e.pend = e.hp;
  check('A23 cible condamnée ignorée', g.findTarget({ x: e.x, y: e.y }, defs.towers.fire, 3, true) === null);
}

console.log('Robustesse');
{
  // Un enfant terrestre né d'un volant atterrit sur le chemin.
  const g = new Game(base({ waves: [{ groups: [{ enemy: 'tengu', count: 1, interval: 1 }] }] }), defs);
  g.startNextWave();
  run(g, 2);
  const child = g.spawnChild('kodama', g.enemies[0]);
  check('enfant terrestre d’un volant sur une case marchable', child.cur >= 0 && g.grid.isWalkable(child.cur) && child.target >= 0);
  run(g, 30);
  check('il rejoint le sanctuaire', g.lives < 20);
}
{
  // Sauvegarde abîmée mais JSON valide : jamais d'exception.
  const store = { 'jardin-des-esprits:v1': '{"stars":{"1-1":"3","1-2":"abc","1-3":9},"muted":"oui"}' };
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v) };
  const { save } = await import('../src/save.js?corrompue');
  check('sauvegarde abîmée nettoyée', save.stars('1-1') === 3 && save.stars('1-2') === 0 && save.stars('1-3') === 3 && save.data.muted === false);
  check('total d’étoiles numérique', save.totalStars() === 6);
  delete globalThis.localStorage;
}

console.log('Une vague finit toujours (pire cas)');
{
  // Boue N3 + N3 au contact, deux Vent N3, Givre : le yokai le plus lent doit avancer.
  const map = [
    ',,,,S,,,,',
    ',,,#.#,,,',
    ',,,#.#,,,',
    ',,,#.#,,,',
    ',,,#.#,,,',
    ',,,,.,,,,',
    ',,,,.,,,,',
    ',,,,.,,,,',
    ',,,,.,,,,',
    ',,,,G,,,,',
  ];
  for (const enemy of ['kodama', 'gashadokuro', 'kappa']) {
    const g = new Game(base({ map, waves: [{ groups: [{ enemy, count: 1, interval: 1, hp: 100000 }] }] }), defs);
    const place = (type, c, r) => {
      const t = g.placeTower(type, c, r);
      t.level = 3;
    };
    place('water', 3, 1);
    place('earth', 3, 2);
    place('water', 5, 1);
    place('earth', 5, 2);
    place('wind', 3, 3);
    place('wind', 5, 3);
    place('water', 3, 4);
    place('wind', 5, 4);
    g.onTowersChanged();
    g.startNextWave();
    run(g, 400);
    check(`${enemy} finit par passer (PV ×100000)`, g.lives < 20, `vies ${g.lives}, y=${g.enemies[0]?.y?.toFixed(2)}`);
  }
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
