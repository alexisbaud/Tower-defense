// Test du multijoueur sans navigateur : un hôte et deux invités sur un relais MQTT
// local (tools : npm i aedes aedes-server-factory, puis un serveur WebSocket).
// Usage : node tools/net-test.mjs ws://localhost:8883/mqtt
import { NetSession } from '../src/net/lobby.js';
import { MqttClient, connectAny } from '../src/net/mqtt.js';
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

// Tiers du relais : un client MQTT quelconque, abonné aux jokers (il voit tous les salons).
const spyClient = async (topics) => {
  const c = new MqttClient(url);
  await c.connect();
  c.inbox = [];
  c.onmessage = (topic, text) => c.inbox.push({ topic, text });
  for (const t of topics) await c.subscribe(t);
  return c;
};

console.log('Commandes mal formées');
{
  // Coordonnées en chaîne : idx('4', 1) = '94' contournait inBounds et le contrôle de
  // blocage ; une pierre pouvait couper l'unique chemin (partie bloquée pour tous).
  const lvl = await loadLevel('1-4');
  const els = assignElements(['fire', 'earth']);
  const g = new Game(lvl, defs, { seed: 7, players: [{ name: 'H', elements: els[0] }, { name: 'T', elements: els[1] }] });
  const stones = () => g.grid.stone.reduce((x, y) => x + y, 0);
  const res = [];
  for (const [op, args] of [
    ['placeStone', ['4', 1]],
    ['placeStone', [4.5, 1]],
    ['removeStone', ['4', 1]],
    ['placeTower', ['earth', '4', 1]],
    ['placeTower', ['inconnue', 4, 1]],
    ['setPriority', [1, 'nimporte']],
    ['constructor', []],
    ['toString', []],
  ]) {
    try {
      res.push(applyCommand(g, 1, op, args));
    } catch (e) {
      res.push(`exception ${e.message}`);
    }
  }
  check('arguments mal formés refusés (chaînes, réels, inconnus)', res.every((r) => r === null), JSON.stringify(res));
  check('… aucune pierre posée, chemin intact', stones() === 0 && g.grid.spawns.every((sp) => g.flow.dist[sp] >= 0));
  let ok = false;
  for (let i = 0; i < g.grid.size && !ok; i++) if (g.canPlaceStone(g.grid.col(i), g.grid.row(i), 1).ok) ok = applyCommand(g, 1, 'placeStone', [g.grid.col(i), g.grid.row(i)]) === true;
  check('… une commande honnête passe', ok && stones() === 1);
}

console.log('Recherche de salon annulée');
{
  // « Annuler la recherche » (ou « Quitter ce salon ») pendant « Recherche du salon… » :
  // le salon recréé ne doit pas être fermé par la recherche qui s'achève ensuite.
  const spy = await spyClient(['jde/v1/+/c']);
  const X = new NetSession({ id: 'X', brokers: [url, url] }); // deux relais : la recherche passe au suivant
  await X.host({ code: 'XXXA' });
  const joining = X.join('ZZZZ', 1500).then(
    () => 'rejoint',
    (e) => (e.cancelled ? 'annulé' : e.message),
  );
  await wait(300);
  await X.host({ code: 'XXXB' });
  const r = await joining;
  await wait(2500);
  check('recherche annulée : elle le dit (pas « rejoint »)', r === 'annulé', r);
  check('… le salon recréé reste en ligne', X.online && X.isHost && !!X.client?.connected && X.code === 'XXXB', `${X.state} ${X.role} ${!!X.client} ${X.code}`);
  const F = new NetSession({ id: 'F', brokers: [url] });
  check('… un ami le rejoint', await F.join('XXXB').then(() => true, (e) => e.message));
  const stray = spy.inbox.filter((m) => m.topic === 'jde/v1/XXXB/c' && JSON.parse(m.text).id === 'X');
  check('… aucun « hello » de la recherche vers son propre salon', stray.length === 0, `${stray.length}`);
  await F.leave();
  await X.leave();
  spy.close();
}

console.log('« bye » d’une connexion morte');
{
  // Changement de réseau : l'invité se reconnecte aussitôt, mais le relais ne publie le
  // message de départ (will) de l'ancienne connexion que bien plus tard.
  const H2 = new NetSession({ id: 'H2', brokers: [url] });
  await H2.host({ code: 'WWLL' });
  const wills = [];
  const G2 = new NetSession({
    id: 'G2',
    brokers: [url],
    connect: (urls, opts, from) => {
      wills.push(opts.will?.payload);
      return connectAny(urls, opts, from);
    },
  });
  await G2.join('WWLL');
  const lvl = await loadLevel('1-1');
  H2.startGame({ level: '1-1', seed: 11, players: [{ name: 'H2', elements: ['fire', 'water'] }, { name: 'G2', elements: ['wind', 'earth'] }] });
  await wait(300);
  void lvl;
  G2.client.ws.close(); // socket coupée (le relais publie aussitôt ce départ)
  await wait(300);
  await G2.join('WWLL'); // nouvelle connexion (comme main.js sur « closed »)
  await wait(400);
  const raw = await spyClient([]);
  raw.publish('jde/v1/WWLL/c', wills[0]); // l'ancien départ, publié bien après
  await wait(600);
  const p = H2.lobby.players.find((x) => x.id === 'G2');
  check('« bye » de l’ancienne connexion ignoré : l’invité reste présent', p && p.online !== false, JSON.stringify(H2.lobby.players));
  H2.endGame(null);
  H2.prune();
  await wait(300);
  check('… et il reste dans le salon après la partie', H2.lobby.players.some((x) => x.id === 'G2') && G2.lobby.players.some((x) => x.id === 'G2'));
  // le bon « bye » (connexion actuelle) fait toujours sortir
  await G2.leave();
  await wait(400);
  check('… son vrai départ est pris en compte', !H2.lobby.players.some((x) => x.id === 'G2'));
  raw.close();
  await H2.leave();
}

console.log('Messages usurpés');
{
  const H3 = new NetSession({ id: 'H3', brokers: [url] });
  await H3.host({ code: 'SPYQ' });
  const V = new NetSession({ id: 'pvictim1', brokers: [url] });
  await V.join('SPYQ');
  const spy = await spyClient(['jde/v1/+/h', 'jde/v1/+/c']);
  const lvl = await loadLevel('1-1');
  const players = [{ name: 'H3', elements: ['fire', 'water'] }, { name: 'V', elements: ['wind', 'earth'] }];
  const ends = [];
  V.on('end', (m) => ends.push(m));
  H3.startGame({ level: '1-1', seed: 21, players });
  const g = new Game(lvl, defs, { seed: 21, players });
  H3.on('command', ({ pid, op, args }) => applyCommand(g, pid, op, args));
  await wait(300);
  let slot = null;
  for (let i = 0; i < g.grid.size && !slot; i++) if (g.canPlaceTower('wind', g.grid.col(i), g.grid.row(i), 1).ok) slot = [g.grid.col(i), g.grid.row(i)];
  V.sendCommand('placeTower', ['wind', ...slot]);
  await wait(500);
  const t = g.towers.find((x) => x.owner === 1);
  check('commande signée de l’invité appliquée', !!t);
  const forge = (msg) => spy.publish('jde/v1/SPYQ/c', typeof msg === 'string' ? msg : JSON.stringify(msg));
  const n = Date.now() * 2000;
  // ancien format, enveloppe sans signature, puis enveloppe signée par une autre clé
  forge({ type: 'cmd', id: 'pvictim1', op: 'sellTower', args: [t.id] });
  forge({ type: 'sig', id: 'pvictim1', d: JSON.stringify({ type: 'cmd', id: 'pvictim1', n, conn: V.conn, op: 'sellTower', args: [t.id] }) });
  const subtle = globalThis.crypto.subtle;
  const mine = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', mine.publicKey);
  const signAs = async (inner) => {
    const d = JSON.stringify(inner);
    const sig = btoa(String.fromCharCode(...new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, mine.privateKey, new TextEncoder().encode(d)))));
    return { type: 'sig', id: 'pvictim1', d, sig };
  };
  forge(await signAs({ type: 'hello', id: 'pvictim1', n: n + 1, conn: 'tiers', v: 5, name: 'Tiers', pk: `${jwk.x}.${jwk.y}` }));
  forge(await signAs({ type: 'cmd', id: 'pvictim1', n: n + 2, conn: 'tiers', op: 'sellTower', args: [t.id] }));
  // rejeu des messages signés de l'invité, captés au passage
  for (const m of spy.inbox.filter((x) => x.topic === 'jde/v1/SPYQ/c')) forge(m.text);
  forge({ type: 'bye', id: 'pvictim1' });
  forge({ type: 'sig', id: 'pvictim1', d: JSON.stringify({ type: 'bye', id: 'pvictim1', n: n + 3, conn: V.conn }) });
  // fin de partie forgée chez l'invité (sans la partie qu'elle termine)
  spy.publish('jde/v1/SPYQ/h', JSON.stringify({ type: 'end', result: { won: true, stars: 3, challenge: true, kills: '<img src=x onerror=alert(1)>' } }));
  await wait(800);
  check('usurpations ignorées : la lanterne de l’invité reste', !!g.towerById(t.id) && g.towers.filter((x) => x.owner === 1).length === 1);
  check('« bye » usurpé ignoré : l’invité reste présent', H3.lobby.players[1]?.online === true, JSON.stringify(H3.lobby.players));
  check('identité de l’invité non reprise par un tiers', H3.lobby.players.length === 2 && !H3.lobby.players.some((x) => x.name === 'Tiers'));
  check('fin de partie forgée ignorée par l’invité', ends.length === 0, JSON.stringify(ends));
  // ses vrais messages passent toujours
  V.sendCommand('sellTower', [t.id]);
  await wait(500);
  check('… ses vrais messages passent toujours', !g.towerById(t.id));
  // relance en pleine partie (« Recommencer pour tous ») : les absents ne sont plus du voyage
  await V.leave();
  await wait(400);
  H3.prune();
  const kept = H3.lobby.players.length;
  H3.prune(true);
  check('relance : l’absent est retiré du salon (prune forcé), pas avant', kept === 2 && H3.lobby.players.length === 1, `${kept} → ${H3.lobby.players.length}`);
  H3.endGame(null);
  await wait(200);
  spy.close();
  await H3.leave();
}
console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests réseau passent');
process.exit(failures ? 1 : 0);
