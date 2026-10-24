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
// Couloir de gravier (colonne 2) bordé de socles : barrières et familles de lanternes.
const CORRIDOR = [',,S,,,,', ',#o#,,,', ',#o#,,,', ',#o#,,,', ',#o#,,,', ',#o#,,,', ',,.,,,,', ',,G,,,,'];
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
  // la puissance suit la lanterne la plus faible : fusionner une seule des deux ne la change pas
  check('fusion : zone conservée', z1 && z1.key === z0.key && z1.timer === 3.5 && z1.mult === z0.mult);
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
  check('armure réduit, Terre perce', d1 === 90 && d2 === 100, `${d1} ${d2}`);
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
  const g = new Game(base({ rewind: true, rewindStart: 100, waves: [{ groups: [{ enemy: 'kodama', count: 30, interval: 0.5 }] }] }), defs);
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
  check('jauge vide : pas de rembobinage', !g.canRewind() && g.rewindRatio() === 0);
  g.rewindCharge = 100;
  check('jauge pleine : disponible', g.canRewind());
  run(g, 5);
  const avail = g.rewindAvailable();
  check('6 s disponibles', Math.abs(avail - 6) < 0.15, `${avail}`);
  const goldBefore = g.gold;
  const placed = g.placeTower('fire', 1, 2);
  const enemyY = g.enemies.map((e) => e.y).reduce((a, b) => Math.max(a, b), 0);
  const ct = g.ct;
  check('rembobinage lancé', g.rewind());
  check('jauge consommée', !g.canRewind() && g.rewindCharge < 1);
  run(g, 1.3);
  check('animation terminée', !g.rewindAnim);
  check('lanterne posée après -> écho', g.echoes.length === 1 && g.echoes[0].type === 'fire');
  check('lanterne retirée du présent', !g.towerById(placed.id) && !g.towerAt(1, 2));
  check('or restauré (remboursé)', g.gold >= goldBefore, `${g.gold} vs ${goldBefore}`);
  const enemyY2 = g.enemies.map((e) => e.y).reduce((a, b) => Math.max(a, b), 0);
  check('yokai reculés', enemyY2 < enemyY, `${enemyY2} < ${enemyY}`);
  // 8 s - 6 s = 2 s, puis 0,2 s s'écoulent après l'animation (1,1 s) dans run(1.3).
  check('chronologie reculée de 6 s', Math.abs(g.ct - (ct - 6 + 0.2)) < 0.2, `${g.ct} / ${ct}`);
  run(g, 10.5);
  check('écho disparu après 10 s', g.echoes.length === 0);
}
{
  // La jauge se remplit en éliminant des yokai et en appelant une vague en avance.
  const g = new Game(base({ rewind: true, waves: [{ groups: [{ enemy: 'kodama', count: 1 }] }, { groups: [{ enemy: 'kodama', count: 1 }], pause: 20 }, { groups: [{ enemy: 'kodama', count: 1 }] }] }), defs);
  g.startNextWave();
  run(g, 1);
  g.kill(g.enemies[0], 'fire');
  const afterKill = g.rewindCharge;
  check('élimination : jauge chargée', afterKill > 0, `${afterKill}`);
  run(g, 1);
  check('vague suivante programmée', g.nextWaveT > 0);
  const gold = g.gold;
  g.startNextWave();
  check('appel anticipé : or et jauge', g.gold > gold && g.rewindCharge > afterKill + 10, `${g.gold - gold} / ${g.rewindCharge}`);
}
{
  // Yokai hors du temps : il ne recule pas, ses dégâts au sanctuaire ne s'effacent pas.
  const g = new Game(base({ rewind: true, rewindStart: 100, waves: [{ groups: [{ enemy: 'kodama', count: 6, interval: 1 }, { enemy: 'tokihami', count: 1, delay: 0.5 }] }] }), defs);
  g.startNextWave();
  run(g, 7);
  const tk = g.enemies.find((e) => e.type === 'tokihami');
  const y = tk.my;
  g.rewind();
  run(g, 1.2);
  const tk2 = g.enemies.find((e) => e.type === 'tokihami');
  check('hors du temps : ni recul ni doublon', tk2 && tk2.my >= y - 0.01 && g.enemies.filter((e) => e.type === 'tokihami').length === 1, `${tk2?.my} vs ${y}`);
  check('jauge consommée', g.rewindCharge < 1);
}
{
  // Dernière chance : une fuite fatale avec la jauge pleine fige la partie.
  const g = new Game(base({ rewind: true, rewindStart: 100, lives: 1, waves: [{ groups: [{ enemy: 'kodama', count: 3, interval: 1 }] }] }), defs);
  g.startNextWave();
  run(g, 3);
  g.leak(g.enemies[0]);
  check('dernière chance ouverte', g.state === 'wave' && g.lastChanceT > 0);
  check('rembobinage possible', g.rewind());
  run(g, 1.3);
  check('vie rendue', g.lives === 1 && g.state === 'wave');
  const g2 = new Game(base({ rewind: true, lives: 1, waves: [{ groups: [{ enemy: 'kodama', count: 3, interval: 1 }] }] }), defs);
  g2.startNextWave();
  run(g2, 3);
  g2.leak(g2.enemies[0]);
  check('jauge vide : défaite immédiate', g2.state === 'lost');
}

{
  // Dernière chance sur la toute dernière fuite : pas de victoire à 0 vie.
  const g = new Game(base({ rewind: true, rewindStart: 100, lives: 1, waves: [{ groups: [{ enemy: 'kodama', count: 1 }] }] }), defs);
  g.startNextWave();
  run(g, 3);
  g.leak(g.enemies[0]);
  run(g, 0.5);
  check('dernière fuite : pas de victoire à 0 vie', g.state === 'wave' && g.lastChanceT > 0, g.state);
  run(g, 5);
  check('sans rembobinage : défaite', g.state === 'lost', g.state);
}
{
  // Défi « N lanternes » : les poses fusionnées comptent.
  const lvl = base({ challenge: { name: 'Deux', desc: '', rule: { maxTowers: 2 } } });
  const g = new Game(lvl, defs);
  g.challenge = true;
  const a = g.placeTower('fire', 1, 1);
  const b = g.placeTower('fire', 2, 1);
  g.fuse(a.id, b.id);
  check('défi : pose refusée après 2 poses, même fusionnées', g.canPlaceTower('fire', 1, 1).reason === 'challenge');
}

console.log('Socles typés et éléments');
{
  const map = [',,,,S,,,,', ',1#ooo2#,', ',#ooooo#,', ',#ooooo#,', ',##ooo##,', ',,,,.,,,,', ',,,,G,,,,'];
  const all = Object.keys(defs.towers);
  const g = new Game(base({ map, towers: all }), defs);
  check('socle de Feu refuse l’Eau', g.canPlaceTower('water', 1, 1).reason === 'slotElement');
  check('socle de Feu accepte le Mortier', g.canPlaceTower('fire_mortar', 1, 1).ok);
  check('socle universel accepte tout', g.canPlaceTower('earth_guard', 2, 1).ok);
  const mp = new Game(base({ map, towers: all }), defs, { players: [{ name: 'A', elements: ['fire'] }, { name: 'B', elements: ['water', 'earth'] }] });
  check('coop : bourses séparées', mp.players.length === 2 && mp.goldOf(0) === mp.goldOf(1) && mp.goldOf(0) < 1000);
  check('coop : élément d’un autre joueur refusé', mp.canPlaceTower('water', 2, 1, 0).reason === 'element');
  const t = mp.placeTower('water', 2, 1, 1);
  check('coop : pose payée par son joueur', t && mp.goldOf(1) < mp.goldOf(0));
  check('coop : on ne vend pas la lanterne d’un autre', mp.sellTower(t.id, 0) === 0 && mp.towerById(t.id));
  check('coop : pierres réservées à la Terre', !mp.canUseStones(0) && mp.canUseStones(1));
  check('coop : yokai plus robustes', mp.hpScale > g.hpScale);
}

console.log('Armure et résistances');
{
  const g = new Game(base({ waves: [{ groups: [{ enemy: 'kappa', count: 1 }] }] }), defs);
  g.startNextWave();
  run(g, 1);
  const e = g.enemies[0];
  const hp = e.hp;
  g.damage(e, 6, 'fire');
  const small = hp - e.hp;
  check('petit coup réduit au minimum (20 %)', Math.abs(small - 1.2) < 0.01, `${small}`);
  const hp2 = e.hp;
  g.damage(e, 30, 'earth', { pierce: 0.5 });
  check('perce-armure : 30 − 10 × 50 %', Math.abs(hp2 - e.hp - 25) < 0.01, `${hp2 - e.hp}`);
  const hp3 = e.hp;
  g.damage(e, 20, 'water');
  check('résistance à l’Eau 50 % puis armure', Math.abs(hp3 - e.hp - 2) < 0.01, `${hp3 - e.hp}`);
  const hp4 = e.hp;
  g.damage(e, 5, 'fire', { dot: true });
  check('brûlure ignore l’armure', Math.abs(hp4 - e.hp - 5) < 0.01);
  g.applyArmorBreak(e, 2);
  const hp5 = e.hp;
  g.damage(e, 6, 'fire');
  check('armure brisée', Math.abs(hp5 - e.hp - 6) < 0.01);
  const y = new Game(base({ waves: [{ groups: [{ enemy: 'yukionna', count: 1 }] }] }), defs);
  y.startNextWave();
  run(y, 1);
  const ye = y.enemies[0];
  const yh = ye.hp;
  y.damage(ye, 10, 'fire');
  check('faiblesse au Feu (+40 %)', Math.abs(yh - ye.hp - 14) < 0.01, `${yh - ye.hp}`);
  y.applySlow(ye, 0.5, 2, 'water');
  check('insensible au ralentissement de l’Eau', ye.slowT <= 0);
}

console.log('Barrières');
const ALL = Object.keys(defs.towers);
{
  const g = new Game(base({ map: CORRIDOR, towers: ALL, waves: [{ groups: [{ enemy: 'kodama', count: 1 }], pause: 60 }, { groups: [{ enemy: 'kodama', count: 1 }] }] }), defs);
  const t = g.placeTower('earth_guard', 1, 2);
  const bar = g.barriers[0];
  check('barrière dressée sur le trajet', bar && bar.alive && bar.tile === g.grid.idx(2, 2), JSON.stringify(bar));
  check('pas de pierre sur une barrière', g.canPlaceStone(2, 2).reason === 'barrier');
  g.startNextWave();
  run(g, 4);
  const e = g.enemies[0];
  check('yokai arrêté par la barrière', e && e.blocked === bar.id && bar.hp < bar.maxHp, `${e?.blocked} ${bar.hp}`);
  bar.hp = 0.5;
  run(g, 0.5);
  check('barrière brisée', !bar.alive);
  run(g, 0.3);
  check('le yokai repart', e.blocked == null && g.grid.row(e.cur) >= 2, `${e.blocked} ${g.grid.row(e.cur)}`);
  run(g, 8);
  check('barrière relevée après le passage', bar.alive);
  g.sellTower(t.id);
  check('vendre retire la barrière', g.barriers.length === 0);
}
{
  // Kasa-obake bondit par-dessus ; la Vapeur (aveuglement) l'en empêche.
  const mk = () => {
    const g = new Game(base({ map: CORRIDOR, towers: ALL, waves: [{ groups: [{ enemy: 'kasaobake', count: 1 }] }] }), defs);
    g.placeTower('earth_guard', 1, 2);
    const bar = g.barriers[0];
    bar.maxHp = bar.hp = 1e6;
    g.startNextWave();
    return [g, bar];
  };
  const [g, bar] = mk();
  run(g, 5);
  const e = g.enemies[0];
  check('kasa-obake franchit la barrière', !e || g.grid.row(e.cur) > 2, `${e && g.grid.row(e.cur)}`);
  const [g2, bar2] = mk();
  for (let k = 0; k < 5 / STEP; k++) {
    for (const x of g2.enemies) x.blindT = 1;
    g2.update(STEP);
  }
  check('aveuglé : il reste bloqué', g2.enemies[0]?.blocked === bar2.id);
}
{
  // Source sacrée : soigne une barrière proche.
  const g = new Game(base({ map: CORRIDOR, towers: ALL }), defs);
  g.placeTower('earth_guard', 1, 2);
  g.placeTower('water_spring', 3, 2);
  const bar = g.barriers[0];
  bar.hp = bar.maxHp / 2;
  g.startNextWave();
  run(g, 1);
  check('Source sacrée : barrière soignée', bar.hp > bar.maxHp / 2, `${bar.hp}/${bar.maxHp}`);
}

console.log('Familles de lanternes');
{
  const g = new Game(base({ map: CORRIDOR, towers: ALL, waves: [{ groups: [{ enemy: 'kodama', count: 8, interval: 0.4, hp: 50 }] }] }), defs);
  const chime = g.placeTower('wind_chime', 1, 1);
  const fire = g.placeTower('fire', 1, 2);
  check('Carillon : cadence accélérée', fire.rateMult > 1 && chime.rateMult === 1, `${fire.rateMult}`);
  g.placeTower('fire_wisp', 3, 2);
  g.placeTower('water_torrent', 3, 3);
  g.placeTower('earth_quake', 1, 4);
  g.placeTower('fire_mortar', 3, 5);
  g.startNextWave();
  const hits = { aura: 0, beam: 0, quake: 0, shoot: 0 };
  for (let k = 0; k < 12 / STEP; k++) {
    g.update(STEP);
    for (const ev of g.events) if (hits[ev.type] != null) hits[ev.type]++;
    g.events.length = 0;
  }
  check('aura, jet, séisme et tirs en action', hits.aura > 0 && hits.beam > 0 && hits.quake > 0 && hits.shoot > 0, JSON.stringify(hits));
}
{
  // Priorités de ciblage.
  const g = new Game(base({ waves: [{ groups: [{ enemy: 'kodama', count: 1 }, { enemy: 'kappa', count: 1, delay: 1.5 }] }] }), defs);
  g.startNextWave();
  run(g, 3.2);
  const t = { x: 4.5, y: 3, priority: 'first' };
  const def = defs.towers.fire;
  const first = g.findTarget(t, def, 9);
  t.priority = 'strong';
  const strong = g.findTarget(t, def, 9);
  t.priority = 'last';
  const last = g.findTarget(t, def, 9);
  check('priorités : premier / plus fort / dernier', first?.type === 'kodama' && strong?.type === 'kappa' && last?.type === 'kappa', `${first?.type} ${strong?.type} ${last?.type}`);
}

console.log('Vagues qui se chevauchent');
{
  const g = new Game(base({ waves: [{ groups: [{ enemy: 'kodama', count: 2, interval: 1, hp: 100 }], pause: 3 }, { groups: [{ enemy: 'kodama', count: 1 }] }, { groups: [{ enemy: 'kodama', count: 1 }] }] }), defs);
  g.startNextWave();
  run(g, 4.5);
  check('vague 2 partie sans attendre la fin de la 1', g.waveIndex === 1 && g.enemies.some((e) => e.wave === 0));
  check('appel anticipé pendant une vague', g.canCallNextWave() && g.startNextWave() && g.waveIndex === 2);
  check('plus d’appel après la dernière', !g.canCallNextWave());
  run(g, 0.1);
  for (const e of g.enemies) g.kill(e, 'fire');
  run(g, 1);
  check('victoire quand tout est fini', g.state === 'won', g.state);
}

{
  // Combos avec écho et niveau minimal.
  const g = new Game(base({ rewind: true, rewindStart: 100, waves: [{ groups: [{ enemy: 'kodama', count: 30, interval: 0.5 }] }] }), defs);
  const a = g.placeTower('fire', 1, 2);
  const b = g.placeTower('fire', 2, 1);
  g.fuse(b.id, a.id);
  g.placeTower('water', 1, 3);
  check('combo au niveau de la plus faible', g.zones.length === 1 && g.zones[0].level === 1, JSON.stringify(g.zones.map((z) => z.level)));
  g.startNextWave();
  run(g, 7);
  g.placeTower('wind', 2, 1);
  g.rewind();
  run(g, 1.3);
  check('l’écho forme un combo affaibli', g.zones.some((z) => z.echo && z.mult < 1), JSON.stringify(g.zones.map((z) => [z.def.id, z.echo, z.mult])));
}

console.log('Rembobinage et yokai hors du temps');
{
  // Une pierre retirée après l'instantané ne revient pas sous un tokihami : il resterait
  // figé dessus (vague sans fin, plus aucune pierre posable).
  const g = new Game(base({ rewind: true, rewindStart: 100, waves: [{ groups: [{ enemy: 'kodama', count: 4, interval: 1.5 }, { enemy: 'tokihami', count: 1, delay: 4 }] }] }), defs);
  const X = g.grid.idx(4, 3);
  g.placeStone(4, 3);
  const gold0 = g.gold;
  g.startNextWave();
  const tk = () => g.enemies.find((e) => e.type === 'tokihami');
  for (let k = 0; k < 20 / STEP && !(tk() && g.grid.row(tk().cur) === 1 && tk().spawnT <= 0); k++) g.update(STEP);
  g.removeStone(4, 3);
  for (let k = 0; k < 10 / STEP && tk()?.target !== X; k++) g.update(STEP);
  check('tokihami en route vers la case de la pierre retirée', tk()?.target === X && g.canRewind(), `${tk()?.target} ${X}`);
  g.rewind();
  run(g, 1.3);
  const e = tk();
  check('rembobinage : pas de pierre sous le tokihami', !g.grid.stone[X] && e && g.flow.dist[e.cur] >= 0 && g.flow.dist[e.target] >= 0, `pierre ${g.grid.stone[X]}`);
  check('… pierre restée retirée : compte et remboursement justes', g.stonesPlaced === 0 && g.gold === gold0 + Math.floor(g.stoneCost() * g.rules.stoneRefund), `${g.stonesPlaced} ${g.gold} / ${gold0}`);
  run(g, 40);
  check('… le tokihami repart, la vague finit', g.state === 'won', `${g.state} ${e && g.grid.col(e.cur)},${e && g.grid.row(e.cur)}`);
  check('… et les pierres restent posables', g.canPlaceStone(3, 3).ok || g.state === 'won');
}
{
  // Pierre remise là où elle enfermerait le tokihami (sans être sous ses pieds) : refusée aussi.
  const map = [',,,,S,,,,', ',,,,o,,,,', ',,,,o,,,,', ',,,oo,,,,', ',,,,o,,,,', ',,,,.,,,,', ',,,,G,,,,'];
  const g = new Game(base({ map, rewind: true, rewindStart: 100, waves: [{ groups: [{ enemy: 'kodama', count: 4, interval: 1.5 }, { enemy: 'tokihami', count: 1, delay: 5 }] }] }), defs);
  g.placeStone(3, 3); // cul-de-sac à gauche de la colonne
  g.startNextWave();
  run(g, 6.5);
  // le tokihami entre dans le cul-de-sac (simulé) : on retire la pierre, il s'y trouve
  const e = g.enemies.find((x) => x.type === 'tokihami');
  g.removeStone(3, 3);
  e.cur = e.target = g.grid.idx(3, 3);
  e.mx = 3.5;
  e.my = 3.5;
  g.rewind();
  run(g, 1.3);
  check('rembobinage : pas de pierre remise sur le tokihami ni autour de lui', !g.grid.stone[g.grid.idx(3, 3)] && g.flow.dist[e.cur] >= 0);
}
{
  // Dernière chance : la fuite fatale vient d'un tokihami, mais un rembobinage rendrait
  // les vies prises par les autres yokai.
  const lvl = base({ rewind: true, rewindStart: 100, lives: 4, waves: [{ groups: [{ enemy: 'kodama', count: 6, interval: 0.5 }, { enemy: 'tokihami', count: 1, delay: 0.5 }] }] });
  const g = new Game(lvl, defs);
  g.startNextWave();
  run(g, 3);
  const ks = g.enemies.filter((e) => e.type === 'kodama');
  g.leak(ks[0]);
  g.leak(ks[1]);
  g.leak(g.enemies.find((e) => e.type === 'tokihami'));
  check('fuite fatale d’un tokihami : dernière chance (le rembobinage rend des vies)', g.state === 'wave' && g.lastChanceT > 0, `${g.state} ${g.lastChanceT}`);
  check('… rembobinage possible', g.rewind());
  run(g, 1.3);
  check('… vies rendues, sauf celles du tokihami', g.lives === 2 && g.state === 'wave', `${g.lives} ${g.state}`);
  // seul un tokihami a pris des vies : le rembobinage n'en rendrait aucune
  const g2 = new Game(base({ rewind: true, rewindStart: 100, lives: 2, waves: lvl.waves }), defs);
  g2.startNextWave();
  run(g2, 3);
  g2.leak(g2.enemies.find((e) => e.type === 'tokihami'));
  check('… rien à rendre : défaite immédiate', g2.state === 'lost', g2.state);
}
{
  // Défi « Aucune fuite » : la fuite d'un tokihami reste comptée après un rembobinage.
  const lvl = base({ rewind: true, rewindStart: 100, challenge: { name: 'Aucune fuite', desc: '', rule: { noLeak: true } }, waves: [{ groups: [{ enemy: 'kodama', count: 6, interval: 0.5 }, { enemy: 'tokihami', count: 1, delay: 0.5 }] }] });
  const g = new Game(lvl, defs);
  g.challenge = true;
  g.startNextWave();
  run(g, 3);
  g.leak(g.enemies.find((e) => e.type === 'tokihami'));
  g.rewind();
  run(g, 1.3);
  check('défi « Aucune fuite » : la fuite du tokihami survit au rembobinage', g.challengeBroken() && g.stats.leaks === 1 && g.lives === 18, `${g.stats.leaks} ${g.lives}`);
  for (const sp of g.spawners) sp.spawned = sp.count;
  for (const e of g.enemies) g.kill(e, 'fire');
  run(g, 1);
  check('… victoire sans défi réussi', g.state === 'won' && !g.challengeMet(), g.state);
}
{
  // Prime d'un tokihami abattu après l'instantané : il ne revient pas, sa prime reste.
  for (const players of [null, [{ name: 'A', elements: ['fire', 'wind'] }, { name: 'B', elements: ['water', 'earth'] }]]) {
    const g = new Game(base({ rewind: true, rewindStart: 100, waves: [{ groups: [{ enemy: 'kodama', count: 6, interval: 0.5 }, { enemy: 'tokihami', count: 1, delay: 0.5 }] }] }), defs, players ? { players } : {});
    g.startNextWave();
    run(g, 3);
    const tk = g.enemies.find((e) => e.type === 'tokihami');
    const before = g.players.map((p) => p.gold);
    g.kill(tk, 'fire');
    const bounty = g.players.map((p, i) => p.gold - before[i]);
    const snap = g.history[g.rewindSnapIndex()];
    g.rewind();
    run(g, 1.3);
    const label = players ? 'coop' : 'solo';
    check(`prime du tokihami gardée au rembobinage (${label})`, bounty[0] > 0 && g.players.every((p, i) => p.gold === snap.gold[i] + bounty[i]), `${g.players.map((p) => p.gold)} / ${snap.gold} + ${bounty}`);
    check(`… et son élimination comptée (${label})`, g.stats.kills === snap.stats.kills + 1 && !g.enemies.some((e) => e.type === 'tokihami'), `${g.stats.kills}`);
  }
}

console.log('Barrières : trajet réel et case occupée');
{
  // Deux plus courts chemins : le mur du Gardien suit le passage des yokai (tout droit),
  // pas un tracé qui préfère toujours descendre.
  const map = [',S,,,,,,,', ',o###,,,,', ',oooooo#,', ',#oooooo,', ',,#ooo#o,', ',,,,,,,.,', ',,,,,,,G,'];
  const lvl = base({ map, towers: ALL, waves: [{ groups: [{ enemy: 'kodama', count: 3, interval: 1, hp: 30 }] }] });
  const g = new Game(lvl, defs);
  const s = g.grid.spawns[0];
  const real = new Set(g.flow.route(s, 0, 1));
  const guard = g.placeTower('earth_guard', 1, 3);
  const bar = g.barriers[0];
  check('mur posé sur le trajet réel des yokai', bar && real.has(bar.tile) && [...g.routeTiles()].every((i) => real.has(i)), bar && `${g.grid.col(bar.tile)},${g.grid.row(bar.tile)}`);
  g.startNextWave();
  let blocked = 0;
  for (let k = 0; k < 8 / STEP; k++) {
    g.update(STEP);
    if (g.enemies.some((e) => e.blocked === bar.id)) blocked++;
  }
  check('… et il arrête les yokai', blocked > 30, `${blocked} images`);
  void guard;
  // aperçu de pierre : le tracé montré est celui que suivront les yokai
  const g2 = new Game(lvl, defs);
  const shown = g2.previewStone(4, 4).routes[0];
  g2.placeStone(4, 4);
  check('aperçu de pierre : même tracé que les yokai', shown.join() === g2.flow.route(s, 0, 1).join(), `${shown.join()} / ${g2.flow.route(s, 0, 1).join()}`);
}
{
  // Ralliement ou pose de Gardien sur la case d'un yokai : refusés (il traverserait le mur).
  const g = new Game(base({ map: CORRIDOR, towers: ALL, waves: [{ groups: [{ enemy: 'kodama', count: 1, hp: 50 }] }] }), defs);
  const t = g.placeTower('earth_guard', 1, 2);
  const bar = g.barriers[0];
  g.startNextWave();
  run(g, 4);
  const e = g.enemies[0];
  check('yokai arrêté devant le mur', e.blocked === bar.id && e.cur === g.grid.idx(2, 1), `${e.blocked} ${e.cur}`);
  check('ralliement sur sa case refusé', !g.setRally(t.id, 2, 1) && bar.tile === g.grid.idx(2, 2) && !g.rallyTiles(t.id).includes(g.grid.idx(2, 1)));
  run(g, 0.5);
  check('… il reste arrêté', e.blocked === bar.id);
  const g2 = new Game(base({ map: CORRIDOR, towers: ALL, waves: [{ groups: [{ enemy: 'kodama', count: 1, hp: 50 }] }] }), defs);
  g2.startNextWave();
  const e2 = () => g2.enemies[0];
  for (let k = 0; k < 10 / STEP && !(e2() && e2().cur === g2.grid.idx(2, 2) && e2().spawnT <= 0); k++) g2.update(STEP);
  g2.placeTower('earth_guard', 1, 2);
  const bar2 = g2.barriers[0];
  check('Gardien posé en pleine vague : mur hors de la case du yokai', bar2 && bar2.tile !== e2().cur && bar2.tile !== g2.grid.tileAt(e2().mx, e2().my), bar2 && `${bar2.tile}`);
  let stopped = 0;
  for (let k = 0; k < 3 / STEP; k++) {
    g2.update(STEP);
    if (e2()?.blocked === bar2.id) stopped++;
  }
  check('… et le yokai est arrêté', stopped > 30, `${stopped}`);
}

console.log('Coopération : pierres');
{
  const g = new Game(base(), defs, { players: [{ name: 'A', elements: ['fire', 'wind', 'earth'] }, { name: 'B', elements: ['water', 'wind', 'earth'] }] });
  const [a0, b0] = [g.goldOf(0), g.goldOf(1)];
  g.placeStone(4, 2, 0);
  check('retirer la pierre d’un coéquipier : refusé', !g.removeStone(4, 2, 1) && g.grid.stone[g.grid.idx(4, 2)] === 1 && g.canRemoveStone(4, 2, 1).reason === 'owner');
  check('… celui qui l’a posée la retire et est remboursé', g.removeStone(4, 2, 0) && g.goldOf(0) === a0 - g.stoneCost() + Math.floor(g.stoneCost() * g.rules.stoneRefund) && g.goldOf(1) === b0, `${g.goldOf(0)} ${g.goldOf(1)}`);
}

console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent');
process.exit(failures ? 1 : 0);
