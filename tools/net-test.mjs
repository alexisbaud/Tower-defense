// Test du multijoueur sans navigateur : un hôte et deux invités sur un relais MQTT
// local (tools : npm i aedes aedes-server-factory, puis un serveur WebSocket).
// Usage : node tools/net-test.mjs ws://localhost:8883/mqtt
import { NetSession } from '../src/net/lobby.js';
import { HostSync, ClientSync, applyCommand, makeMirror } from '../src/net/sync.js';
import { Game, STEP, assignElements } from '../src/core/game.js';
import { defs, loadLevel } from '../src/data.js';

const url = process.argv[2] || 'ws://localhost:8883/mqtt';
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ' ' + extra}`);
  if (!ok) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('Salon');
const host = new NetSession({ id: 'H', name: 'Hôte', brokers: ['ws://localhost:1/none', url] });
await host.host({ code: 'TEST', element: 'fire' });
check('salon hébergé (relais de secours)', host.online && host.code === 'TEST', host.state);
const a = new NetSession({ id: 'A', name: 'Aki', brokers: ['ws://localhost:1/none', url] });
const b = new NetSession({ id: 'B', name: 'Botan', brokers: ['ws://localhost:1/none', url] });
await a.join('test');
await b.join('TEST');
await wait(200);
check('deux invités arrivés', host.lobby.players.length === 3, JSON.stringify(host.lobby.players));
check('élément libre attribué', a.lobby.players[1].element === 'water' && b.lobby.players[2].element === 'wind', JSON.stringify(a.lobby.players));
b.pickElement('fire');
await wait(200);
check('élément déjà pris refusé', b.lobby.players[2].element === 'wind');
b.pickElement('earth');
await wait(200);
check('choix d’élément libre', host.lobby.players[2].element === 'earth');
const c = new NetSession({ id: 'C', brokers: [url] });
const d = new NetSession({ id: 'D', brokers: [url] });
await c.join('TEST');
let refused = null;
try {
  await d.join('TEST');
} catch (e) {
  refused = e.message;
}
check('salon plein refusé', refused === 'full', refused);
await c.leave();
await wait(200);
check('départ d’un invité', host.lobby.players.length === 3);
let notFound = null;
try {
  await d.join('ZZZZ', 1500);
} catch (e) {
  notFound = e.message;
}
check('code inconnu : salon introuvable', notFound === 'salon introuvable', notFound);

console.log('Partie');
const level = await loadLevel('1-3');
const elements = assignElements(host.lobby.players.map((p) => p.element));
const players = host.lobby.players.map((p, i) => ({ name: p.name, elements: elements[i] }));
const starts = {};
a.on('start', (m) => (starts.a = m));
b.on('start', (m) => (starts.b = m));
host.startGame({ level: '1-3', seed: 5, players });
await wait(300);
check('départ reçu par les invités', starts.a?.you === 1 && starts.b?.you === 2, JSON.stringify(starts.a));
const game = new Game(level, defs, { seed: 5, players });
const hs = new HostSync(game, (snap) => host.broadcastSnapshot(snap));
host.on('command', ({ pid, op, args }) => applyCommand(game, pid, op, args));
const mirrors = {};
for (const [k, s] of [['a', a], ['b', b]]) {
  const m = makeMirror(Game, level, defs, starts[k]);
  const cs = new ClientSync(m, (op, args) => s.sendCommand(op, args));
  s.on('snap', (snap) => cs.apply(snap));
  mirrors[k] = cs;
}
// boucle : 60 images/s pour l'hôte, rendu des invités
let running = true;
const loop = async () => {
  while (running) {
    for (let k = 0; k < 4; k++) {
      game.update(STEP);
      hs.collect(game.events);
      game.events.length = 0;
      hs.tick(STEP);
    }
    for (const cs of Object.values(mirrors)) {
      cs.tick(STEP * 4);
      cs.game.events.length = 0;
    }
    await wait(16);
  }
};
loop();
const ma = mirrors.a.game;
const water = Object.keys(defs.towers).find((t) => defs.towers[t].element === 'water' && level.towers.includes(t));
const slot = (() => {
  for (let i = 0; i < ma.grid.size; i++) {
    const c = ma.grid.col(i);
    const r = ma.grid.row(i);
    if (ma.canPlaceTower(water, c, r).ok) return [c, r];
  }
})();
const gA = game.goldOf(1);
const t = ma.placeTower(water, ...slot);
check('pose provisoire chez l’invité', t && t.pending);
await wait(400);
const hostT = game.towerAt(...slot);
check('pose appliquée par l’hôte, payée par l’invité', hostT && hostT.owner === 1 && game.goldOf(1) === gA - defs.towers[water].cost, `${hostT?.owner} ${game.goldOf(1)} / ${gA}`);
check('lanterne visible chez l’autre invité', mirrors.b.game.towerAt(...slot)?.owner === 1);
check('l’invité Vent/Terre ne peut pas poser d’Eau', !mirrors.b.game.canPlaceTower(water, slot[0], slot[1] + 1).ok);
const realId = hostT.id;
check('annulation avec l’id provisoire', ma.undoPlace(t.id) !== false);
await wait(400);
check('annulée chez l’hôte et remboursée', !game.towerAt(...slot) && game.goldOf(1) === gA, `${game.goldOf(1)} / ${gA} ${realId}`);
host.on('command', () => {});
game.startNextWave();
await wait(3000);
check('yokai visibles chez les invités', ma.enemies.length > 0 && Math.abs(ma.enemies.length - game.enemies.length) <= 2, `${ma.enemies.length} vs ${game.enemies.length}`);
const e = game.enemies[0];
const me = ma.enemies.find((x) => x.id === e.id);
check('positions proches (< 0,6 case)', me && Math.hypot(me.x - e.x, me.y - e.y) < 0.6, me && `${Math.hypot(me.x - e.x, me.y - e.y)}`);
check('vies et or synchronisés', ma.lives === game.lives && ma.goldOf(2) === Math.floor(game.goldOf(2)));
let bytes = 0;
let n = 0;
const orig = host.broadcastSnapshot.bind(host);
host.broadcastSnapshot = (snap) => {
  bytes += JSON.stringify(snap).length;
  n++;
  orig(snap);
};
await wait(2000);
// la boucle de test accélère la simulation : on rapporte le débit au temps de jeu (8 états/s)
const rate = ((bytes / n) * 8) / 1024;
console.log(`  · débit hôte → relais : ${rate.toFixed(1)} Ko/s par invité (${Math.round(bytes / n)} o par état, ${game.enemies.length} yokai)`);
check('débit raisonnable (< 30 Ko/s)', rate < 30);
running = false;
await host.leave();
await wait(300);
await a.leave();
await b.leave();
await d.leave();
console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests réseau passent');
process.exit(failures ? 1 : 0);
