// Test du multijoueur sans navigateur (Node ≥ 22).
//
// 1. Lockstep en mémoire (horloge simulée, aucun relais) : forme des commandes, appel
//    de vague daté, trois parties qui tournent 3 minutes avec Rembobinage, gigue,
//    pertes et un invité à 30 Hz (empreintes identiques), poses simultanées, commande
//    arrivée en retard, état corrompu chez un invité (resynchronisation), débit ;
//    défauts corrigés par qa-coop : Rembobinage juste après un état complet (dernière
//    chance), lecture régulière sous 300-800 ms de gigue (chaque empreinte comparée,
//    hôte figé), annulations tardives (pierre, mur, lanterne).
// 2. Sur un relais MQTT local (npm i aedes aedes-server-factory, puis un serveur
//    WebSocket : voir README) : salon, élément unique, salon plein, parties à deux puis
//    à trois (même partie partout, construction activée à la même image, pause de
//    l'hôte à la même image), invité qui recharge en pleine partie, commandes mal
//    formées ou forgées, recherche annulée, « bye » d'une connexion morte, messages
//    usurpés.
//
// Usage : node tools/net-test.mjs [ws://localhost:8883/mqtt]
import { NetSession } from '../src/net/lobby.js';
import { MqttClient, connectAny } from '../src/net/mqtt.js';
import { Coop } from '../src/net/coop.js';
import { HostLockstep, GuestLockstep, ARGS, cleanArgs, syncHash, COMMAND_DELAY, MIN_LEAD, LEAD_CAP } from '../src/net/lockstep.js';
import { Game, STEP, COMMANDS, assignElements } from '../src/core/game.js';
import { defs, loadLevel } from '../src/data.js';
import { bot } from './bot.mjs';

const url = process.argv[2] || 'ws://localhost:8883/mqtt';
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ' ' + extra}`);
  if (!ok) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// NET_ONLY=mot : ne lance que les sections dont le titre contient ce mot (mise au point)
const only = process.env.NET_ONLY?.toLowerCase() || null;
const section = (title) => {
  const on = !only || title.toLowerCase().includes(only);
  if (on) console.log(title);
  return on;
};
const ELEMENTS = ['fire', 'water', 'wind', 'earth'];
const team = (n) => assignElements(ELEMENTS.slice(0, n)).map((elements, i) => ({ name: `J${i + 1}`, elements }));
const kb = (b) => `${(b / 1024).toFixed(2)} Ko/s`;

// Partie vue par un bot (tools/bot.mjs) : ses commandes passent par le réseau (issue →
// émetteur), et ses poses provisoires comptent (or promis, socle réservé).
function botView(game, issue, prov = []) {
  const cost = (p) => (p.op === 'placeTower' ? defs.towers[p.args[0]]?.cost ?? 0 : p.op === 'placeStone' ? game.stoneCost() : 0);
  const sameTile = (p, op, a) => p.op === op && (op === 'placeTower' ? p.args[1] === a[1] && p.args[2] === a[2] : p.args[0] === a[0] && p.args[1] === a[1]);
  return new Proxy(game, {
    get(t, k) {
      if (k === 'issue') return (op, args) => issue(op, args);
      if (k === 'pendingPlacements') return (pid = null) => [...t.pendingPlacements(pid), ...prov.filter((p) => pid == null || p.pid === pid)];
      if (k === 'spendable') return (pid = t.localPlayer) => t.spendable(pid) - prov.filter((p) => p.pid === pid).reduce((n, p) => n + cost(p), 0);
      if (k === 'canIssue')
        return (op, args, pid) => {
          if (prov.some((p) => sameTile(p, op, args))) return { ok: false, reason: 'pending' };
          const r = t.canIssue(op, args, pid);
          if (r.ok && (op === 'placeTower' || op === 'placeStone') && prov.length) {
            const left = t.spendable(pid) - prov.filter((p) => p.pid === pid).reduce((n, p) => n + cost(p), 0);
            if (left < (op === 'placeTower' ? defs.towers[args[0]].cost : t.stoneCost())) return { ok: false, reason: 'gold' };
          }
          return r;
        };
      const v = Reflect.get(t, k, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

// ─────────────────────────── réseau en mémoire ───────────────────────────
// Chaque lien (hôte → invité, invité → hôte) livre ses messages DANS L'ORDRE (comme
// une connexion au relais), après 20 à 150 ms ; `loss` en perd une part.
class MemNet {
  constructor({ jitter = [20, 150], loss = 0, seed = 9 } = {}) {
    this.jitter = jitter;
    this.loss = loss;
    this.seed = seed;
    this.now = 0;
    this.msgs = [];
    this.last = new Map();
    this.lost = 0;
    this.hold = null; // (lien, message) → retard supplémentaire hors ordre (ms) ou 0
  }

  rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  post(link, msg, deliver) {
    if (this.loss && this.rand() < this.loss) {
      this.lost++;
      return;
    }
    const text = JSON.stringify(msg);
    const extra = this.hold?.(link, msg) ?? 0;
    const lat = this.jitter[0] + this.rand() * (this.jitter[1] - this.jitter[0]);
    let at;
    if (extra) at = this.now + lat + extra; // message retenu : il double les suivants
    else {
      at = Math.max(this.last.get(link) ?? 0, this.now + lat);
      this.last.set(link, at);
    }
    this.msgs.push({ at, fn: () => deliver(JSON.parse(text)) });
  }

  advance(ms) {
    this.now += ms;
    const due = this.msgs.filter((m) => m.at <= this.now).sort((a, b) => a.at - b.at);
    if (!due.length) return;
    this.msgs = this.msgs.filter((m) => m.at > this.now);
    for (const m of due) m.fn();
  }
}

// Journal des commandes exécutées par une partie : identifiant → image d'exécution.
function logExec(game) {
  const log = new Map();
  const exec = game.execute.bind(game);
  game.execute = (e) => {
    log.set(e.id, game.frame);
    return exec(e);
  };
  return log;
}

// Partie coopérative en mémoire : un hôte et des invités (HostLockstep, GuestLockstep).
function memCoop(level, { n = 3, seed = 5, net, hz = [], bots = true, players: chosen = null } = {}) {
  const players = chosen ?? team(n);
  const now = () => net.now;
  const guests = [];
  const hostGame = new Game(level, defs, { seed, players, localPlayer: 0 });
  hostGame.commandDelay = COMMAND_DELAY;
  const host = new HostLockstep(hostGame, {
    gid: seed,
    now,
    send: (msg) => {
      for (const g of guests) if (!g.gone) net.post(`h${g.pid}`, msg, (m) => (m.type === 'state' && m.to !== g.id ? null : g.ls.receive(m)));
    },
  });
  host.hashes = new Map();
  const update = host.update.bind(host);
  host.update = () => {
    update();
    if (hostGame.frame % 30 === 0) host.hashes.set(hostGame.frame, host.hash.h);
  };
  const addGuest = (pid, { rejoin = false } = {}) => {
    const game = new Game(level, defs, { seed, players, localPlayer: pid });
    game.commandDelay = COMMAND_DELAY;
    const prov = [];
    const g = { pid, id: `g${pid}`, prov, game, hz: hz[pid] ?? 60, acc: 0, executed: logExec(game) };
    g.ls = new GuestLockstep(game, {
      gid: seed,
      now,
      rejoin,
      provisional: () => prov,
      send: (op, args, meta) => net.post(`c${pid}`, { op, args, ...meta }, (m) => host.receive({ pid, op: m.op, args: m.args, f: m.f, tmp: m.tmp })),
      ask: () => net.post(`c${pid}`, { type: 'resync' }, () => host.requestState(pid, g.id)),
    });
    g.bot = bots ? bot('balanced', botView(game, (op, args) => g.ls.issue(op, args), prov), { pid, seed: 3 + pid }) : null;
    const old = guests.findIndex((x) => x.pid === pid);
    if (old >= 0) guests[old].gone = true;
    guests.push(g);
    return g;
  };
  for (let pid = 1; pid < n; pid++) addGuest(pid);
  const hostBot = bots ? bot('balanced', botView(hostGame, (op, args) => host.issue(op, args, 0)), { pid: 0, seed: 3 }) : null;
  const hostExec = logExec(hostGame);
  const frame = () => {
    net.advance(1000 / 60);
    host.step(1 / 60);
    hostBot?.tick(hostGame.frame * STEP);
    hostGame.events.length = 0;
    for (const g of guests) {
      if (g.gone) continue;
      g.acc += 1 / 60;
      if (g.acc < 1 / g.hz - 1e-9) continue; // invité qui affiche à 30 Hz : un pas d'affichage sur deux
      g.ls.step(g.acc);
      g.acc = 0;
      g.bot?.tick(g.game.frame * STEP);
      g.game.events.length = 0;
    }
  };
  const run = (s, each) => {
    for (let k = 0; k < s * 60 && hostGame.state !== 'won' && hostGame.state !== 'lost'; k++) {
      frame();
      each?.();
    }
  };
  return { host, hostGame, guests: () => guests.filter((g) => !g.gone), addGuest, run, frame, hostExec };
}

// Empreintes communes (hôte / invité) depuis l'image `from` : égales ?
function hashAgreement(host, g, from = 0) {
  let same = 0;
  let diff = 0;
  for (const [f, h] of g.ls.hashes) {
    if (f < from || !host.hashes.has(f)) continue;
    if (host.hashes.get(f) === h) same++;
    else diff++;
  }
  return { same, diff };
}

// ═══════════════════════════ 1. en mémoire ═══════════════════════════

if (section('Forme des commandes')) {
  const lvl = await loadLevel('1-4');
  const players = team(2).map((p, i) => ({ ...p, elements: i === 0 ? ['fire'] : ['earth'] }));
  const g = new Game(lvl, defs, { seed: 7, players });
  g.commandDelay = COMMAND_DELAY;
  const sent = [];
  const host = new HostLockstep(g, { gid: 7, send: (m) => sent.push(m) });
  check('chaque commande du moteur a sa forme (et le même nombre d’arguments)', Object.keys(COMMANDS).every((op) => ARGS[op]?.length === COMMANDS[op]) && Object.keys(ARGS).length === Object.keys(COMMANDS).length);
  // Coordonnées en chaîne : idx('4', 1) = '94' contournait inBounds et le contrôle de
  // blocage ; une pierre pouvait couper l'unique chemin (partie bloquée pour tous).
  const bad = [
    ['placeStone', ['4', 1]],
    ['placeStone', [4.5, 1]],
    ['removeStone', ['4', 1]],
    ['placeTower', ['earth', '4', 1]],
    ['placeTower', ['inconnue', 4, 1]],
    ['setPriority', [1, 'nimporte']],
    ['startNextWave', ['1']],
    ['cancel', ['1']],
    ['constructor', []],
    ['toString', []],
    ['__proto__', []],
    ['placeStone', 'pas un tableau'],
  ];
  const res = [];
  for (const [op, args] of bad) {
    try {
      res.push(host.receive({ pid: 1, op, args, f: g.frame + 120, tmp: 1 }));
    } catch (e) {
      res.push(`exception ${e.message}`);
    }
  }
  check('arguments mal formés refusés (chaînes, réels, inconnus)', res.every((r) => r === null) && g.queue.length === 0, JSON.stringify(res));
  check('… l’invité est prévenu (refus)', sent.filter((m) => m.type === 'nack').length === bad.length);
  check('… un joueur inconnu ou l’hôte usurpé : ignoré', host.receive({ pid: 0, op: 'rewind', args: [] }) === null && host.receive({ pid: 7, op: 'rewind', args: [] }) === null);
  check('Feu ne pose pas de Terre (élément d’un autre joueur)', host.receive({ pid: 0, op: 'placeTower', args: ['earth', 1, 1], tmp: 2 }) === null || g.queue.length === 0);
  let slot = null;
  for (let i = 0; i < g.grid.size && !slot; i++) if (g.canPlaceStone(g.grid.col(i), g.grid.row(i), 1).ok) slot = [g.grid.col(i), g.grid.row(i)];
  const e = host.receive({ pid: 1, op: 'placeStone', args: slot, f: g.frame + 120, tmp: 3 });
  check('une commande honnête est datée et diffusée', !!e && e.frame === g.frame + 120 && sent.at(-1).type === 'cmd' && sent.at(-1).tmp === 3 && sent.at(-1).e.id === e.id);
  // (commande sans effet sur la partie ; une annulation d'identifiant inconnu est, elle,
  // refusée : voir « Annulation tardive »)
  const late = host.receive({ pid: 1, op: 'cyclePriority', args: [99], f: g.frame - 50, tmp: 4 });
  check('image proposée déjà passée : repoussée à l’image de l’hôte + 10', late && late.frame === g.frame + MIN_LEAD, `${late?.frame} / ${g.frame}`);
  const far = host.receive({ pid: 1, op: 'cyclePriority', args: [98], f: g.frame + 1e6, tmp: 5 });
  check('image proposée trop lointaine : bornée', far && far.frame <= g.frame + 300);
  for (let k = 0; k < 130; k++) host.step(1 / 60);
  check('la pierre de l’invité se pose 2 s après (chemin intact)', g.grid.stone[g.grid.idx(...slot)] === 1 && g.grid.spawns.every((sp) => g.flow.dist[sp] >= 0));
}

if (section('Appel de vague daté (correctif du moteur)')) {
  // Appel anticipé à 0,3 s de la fin du compte à rebours : en coopération, il s'exécute
  // 0,75 s plus tard, après le départ automatique ; il ne doit pas appeler une vague de plus.
  const lvl = await loadLevel('1-1');
  const mk = () => {
    const g = new Game(lvl, defs, { seed: 1, players: team(2) });
    g.commandDelay = COMMAND_DELAY;
    g.startNextWave(0, false);
    for (let k = 0; k < 60 * 400 && !(g.nextWaveT != null && g.nextWaveT < 0.3); k++) g.update(STEP);
    return g;
  };
  const g = mk();
  const w = g.waveIndex;
  const sent = [];
  const host = new HostLockstep(g, { gid: 1, send: (m) => sent.push(m) });
  const e = host.issue('startNextWave', []);
  for (let k = 0; k < 60; k++) host.step(1 / 60);
  check('appel daté avec la vague demandée', e && e.args[0] === w + 1, JSON.stringify(e?.args));
  check('départ automatique entre-temps : une seule vague de plus', g.waveIndex === w + 1, `${w} → ${g.waveIndex}`);
  const g2 = mk();
  g2.enqueue({ ...g2.makeEntry('startNextWave', [], 0, g2.frame + COMMAND_DELAY), at: g2.frame });
  for (let k = 0; k < 60; k++) g2.update(STEP);
  check('(sans la vague demandée, deux vagues partaient)', g2.waveIndex === w + 2, `${w} → ${g2.waveIndex}`);
}

if (section('Trois parties en mémoire : 3 minutes, Rembobinage, gigue, pertes, invité à 30 Hz')) {
  const lvl = await loadLevel('1-3');
  const net = new MemNet({ jitter: [20, 150], loss: 0.004, seed: 11 });
  const m = memCoop(lvl, { n: 3, seed: 21, net, hz: [60, 60, 30] });
  const [g1, g2] = m.guests();
  let rewinds = 0;
  m.run(180, () => {
    const f = m.hostGame.frame;
    // Rembobinage demandé par l'hôte (1 min) puis par un invité (2 min), dès que possible
    if (f > 3600 && rewinds === 0 && m.hostGame.canRewind() && m.host.issue('rewind', [])) rewinds++;
    if (f > 7200 && rewinds === 1 && g1.game.canRewind() && g1.ls.issue('rewind', [])) rewinds++;
  });
  const games = [m.hostGame, g1.game, g2.game];
  check('3 minutes de jeu', m.hostGame.frame >= 180 * 60 - 1 || m.hostGame.state === 'won', `${m.hostGame.frame}`);
  check('deux Rembobinages, partout', games.every((g) => g.rewindsUsed === 2), games.map((g) => g.rewindsUsed).join());
  const lastSync = Math.max(...[g1, g2].map((g) => g.ls.stats.lastImport ?? 0));
  const a1 = hashAgreement(m.host, g1, lastSync);
  const a2 = hashAgreement(m.host, g2, lastSync);
  check('empreintes identiques (hôte, invité 60 Hz, invité 30 Hz)', a1.diff === 0 && a2.diff === 0 && a1.same > 20 && a2.same > 20, JSON.stringify([a1, a2]));
  check('vérifiées en continu (une empreinte toutes les 0,5 s)', g1.ls.stats.checks > 300 && g2.ls.stats.checks > 300, `${g1.ls.stats.checks} ${g2.ls.stats.checks}`);
  check('aucune commande arrivée en retard', g1.ls.stats.late === 0 && g2.ls.stats.late === 0);
  // (seule exception connue : un Rembobinage moins de 6 s après un état complet, dont
  // l'historique ne voyage pas ; l'invité redemande alors l'état sans attendre)
  check('aucun écart d’empreinte : seules les pertes demandent l’état complet', [g1, g2].every((g) => !g.ls.stats.why.hash && !g.ls.stats.why.late), JSON.stringify([g1.ls.stats.why, g2.ls.stats.why]));
  check(`pertes (${net.lost}) rattrapées par l’état complet`, net.lost === 0 || g1.ls.stats.imports + g2.ls.stats.imports > 0, JSON.stringify([g1.ls.stats, g2.ls.stats]));
  // même partie, image par image : les invités rejoignent l'image de l'hôte
  for (const g of [g1, g2]) g.ls.finish(m.hostGame.frame);
  check('à la même image : même état partout (empreinte complète)', games.every((g) => g.frame === m.hostGame.frame) && new Set(games.map((g) => syncHash(g))).size === 1, games.map((g) => `${g.frame}:${syncHash(g)}`).join(' '));
  check('lanternes, or et vies identiques', new Set(games.map((g) => JSON.stringify([g.towers.map((t) => [t.id, t.type, t.c, t.r, t.level, t.owner]), g.players.map((p) => p.gold), g.lives]))).size === 1);
  check('partie jouée par les trois bots (lanternes de chacun)', [0, 1, 2].every((pid) => m.hostGame.towers.some((t) => t.owner === pid)), JSON.stringify(m.hostGame.towers.map((t) => t.owner)));
  // chaque commande exécutée à la même image chez tous
  const off = [g1, g2].flatMap((g) => [...g.executed].filter(([id, f]) => m.hostExec.has(id) && m.hostExec.get(id) !== f));
  check('chaque commande s’exécute à la même image chez tous', off.length === 0 && g1.executed.size > 20, `${off.length} écarts / ${g1.executed.size}`);
  check('retard des invités sur l’hôte : ~0,2 s', [g1, g2].every((g) => g.ls.lag < 40), [g1, g2].map((g) => g.ls.lag.toFixed(1)).join());
  const secs = m.hostGame.frame / 60;
  const per = m.host.traffic.bytes / secs;
  console.log(`  · débit hôte → chaque invité : ${kb(per)} (commandes ${kb(m.host.traffic.byType.cmd / secs)}, battements ${kb(m.host.traffic.byType.hb / secs)}, états complets ${kb((m.host.traffic.byType.state || 0) / secs)})`);
  check('débit très faible hors resynchronisation (< 1 Ko/s par invité)', (per - (m.host.traffic.byType.state || 0) / secs) < 1024, kb(per));
}

if (section('Poses simultanées sur le même socle')) {
  const lvl = await loadLevel('2-2');
  const net = new MemNet({ jitter: [30, 90], seed: 3 });
  const m = memCoop(lvl, { n: 3, seed: 8, net, bots: false });
  const [g1, g2] = m.guests();
  m.run(1);
  const gr = m.hostGame.grid;
  let slot = null;
  const t1 = m.hostGame.towersFor(1)[0];
  const t2 = m.hostGame.towersFor(2)[0];
  for (let i = 0; i < gr.size && !slot; i++) if (gr.type(i) === 3 && !gr.slotElement[i] && m.hostGame.canPlaceTower(t1, gr.col(i), gr.row(i), 1).ok && m.hostGame.canPlaceTower(t2, gr.col(i), gr.row(i), 2).ok) slot = [gr.col(i), gr.row(i)];
  const gold0 = m.hostGame.players.map((p) => p.gold);
  const k1 = g1.ls.issue('placeTower', [t1, ...slot]);
  const k2 = g2.ls.issue('placeTower', [t2, ...slot]);
  check('chacun voit sa pose en construction (provisoire)', g1.prov.includes(k1) && g2.prov.includes(k2));
  m.run(3);
  const games = [m.hostGame, g1.game, g2.game];
  const here = games.map((g) => g.towers.filter((t) => t.c === slot[0] && t.r === slot[1]));
  check('une seule lanterne, la même partout', here.every((h) => h.length === 1) && new Set(here.map((h) => h[0].owner)).size === 1, JSON.stringify(here.map((h) => h.map((t) => t.owner))));
  const win = here[0][0].owner;
  const lose = win === 1 ? 2 : 1;
  check('seul le gagnant paie', m.hostGame.players[lose].gold === gold0[lose] && m.hostGame.players[win].gold < gold0[win]);
  check('le perdant ne garde pas de pose provisoire (refus de l’hôte)', !g1.prov.length && !g2.prov.length && [k1, k2].some((k) => k.refused === 'pending' || (k.entry && !k.entry.ok)), JSON.stringify([k1.refused, k2.refused]));
  // « Annuler » avant la date de l'hôte : rien n'est payé, rien n'est construit
  let s2 = null;
  for (let i = 0; i < gr.size && !s2; i++) if (gr.type(i) === 3 && m.hostGame.canPlaceTower(t1, gr.col(i), gr.row(i), 1).ok && !(gr.col(i) === slot[0] && gr.row(i) === slot[1])) s2 = [gr.col(i), gr.row(i)];
  const goldB = m.hostGame.players[1].gold;
  const k3 = g1.ls.issue('placeTower', [t1, ...s2]);
  g1.ls.issue('cancel', [k3]);
  check('« Annuler » aussitôt : la construction disparaît tout de suite', !g1.prov.includes(k3));
  m.run(3);
  check('… annulée chez tous avant son activation, rien n’est payé', games.every((g) => !g.towerAt(...s2)) && m.hostGame.players[1].gold === goldB, `${m.hostGame.players[1].gold} / ${goldB}`);
  // proposition perdue en route (coupure) : la pose provisoire ne reste pas en construction
  net.loss = 1;
  const k4 = g1.ls.issue('placeTower', [t1, ...s2]);
  net.loss = 0;
  m.run(3);
  const still = g1.prov.includes(k4);
  m.run(4);
  check('proposition perdue : la construction provisoire s’efface (6 s), rien n’est construit', still && !g1.prov.includes(k4) && games.every((g) => !g.towerAt(...s2)));
}

if (section('Commande en retard, état corrompu, invité qui arrive en cours de partie')) {
  const lvl = await loadLevel('1-3');
  const net = new MemNet({ jitter: [20, 120], seed: 5 });
  const m = memCoop(lvl, { n: 3, seed: 13, net });
  const [g1, g2] = m.guests();
  m.run(40);
  // une commande retenue 2 s sur la route de l'invité 1 (elle double les battements)
  let held = 0;
  net.hold = (link, msg) => {
    if (link !== 'h1' || msg.type !== 'cmd' || held) return 0;
    held++;
    return 2000;
  };
  const e = m.host.issue('startNextWave', []) || m.host.issue('rewind', []) || m.host.issue('setPriority', [m.hostGame.towers[0]?.id ?? 1, 'strong']);
  m.run(4);
  net.hold = null;
  check('commande retenue : l’invité le voit (commande manquante) et reçoit l’état complet', held === 1 && !!e && g1.ls.stats.imports >= 1 && (g1.ls.stats.why.gap || g1.ls.stats.why.late), JSON.stringify(g1.ls.stats));
  m.run(5);
  for (const g of [g1, g2]) g.ls.finish(m.hostGame.frame);
  check('… puis même partie que l’hôte', [g1, g2].every((g) => g.game.frame === m.hostGame.frame && syncHash(g.game) === syncHash(m.hostGame)));
  // état corrompu volontairement chez l'invité 2 (PV d'un yokai, or) : l'empreinte le voit
  m.run(5);
  const imports = g2.ls.stats.imports;
  const victim = g2.game.enemies[0];
  if (victim) victim.hp *= 0.5;
  g2.game.players[2].gold += 37;
  m.run(3);
  check('état corrompu chez un invité : écart d’empreinte détecté', g2.ls.stats.why.hash >= 1, JSON.stringify(g2.ls.stats));
  check('… état complet importé', g2.ls.stats.imports > imports);
  m.run(10);
  for (const g of [g1, g2]) g.ls.finish(m.hostGame.frame);
  check('… empreintes de nouveau identiques', [g1, g2].every((g) => syncHash(g.game) === syncHash(m.hostGame)) && hashAgreement(m.host, g2, m.hostGame.frame - 300).diff === 0);
  // un invité (re)vient en pleine partie : partie neuve, état complet, puis lockstep
  const f0 = m.hostGame.frame;
  const back = m.addGuest(2, { rejoin: true });
  check('arrivée en pleine partie : « Synchronisation… »', back.ls.waitKind() === 'sync' && back.game.frame === 0);
  m.run(4);
  check('… état complet reçu, la partie reprend à l’image de l’hôte', back.ls.stats.imports === 1 && back.game.frame > f0 && back.ls.waitKind() === null, `${back.game.frame} / ${f0} ${JSON.stringify(back.ls.stats)}`);
  m.run(20);
  back.ls.finish(m.hostGame.frame);
  check('… puis empreintes identiques (20 s de jeu)', syncHash(back.game) === syncHash(m.hostGame) && hashAgreement(m.host, back, f0 + 300).same > 20 && hashAgreement(m.host, back).diff === 0, JSON.stringify(hashAgreement(m.host, back)));
  check('… et ses lanternes, son or : ceux de la partie', back.game.players[2].gold === m.hostGame.players[2].gold && back.game.towers.length === m.hostGame.towers.length);
}

if (section('Pause et vitesse de l’hôte : à la même image chez tous')) {
  const lvl = await loadLevel('1-1');
  const net = new MemNet({ jitter: [40, 160], seed: 17 });
  const m = memCoop(lvl, { n: 3, seed: 2, net, hz: [60, 60, 30] });
  const [g1, g2] = m.guests();
  m.run(10);
  m.host.setPaused(true);
  const pz = m.host.pauseAt;
  m.run(2);
  check('pause : tous s’arrêtent à la même image (annoncée + 10)', [m.hostGame, g1.game, g2.game].every((g) => g.frame === pz), [m.hostGame, g1.game, g2.game].map((g) => g.frame).join() + ` / ${pz}`);
  check('invités : « Pause par l’hôte »', g1.ls.waitKind() === 'pause' && g2.ls.waitKind() === 'pause');
  m.run(3);
  check('pause : rien ne bouge (3 s)', [m.hostGame, g1.game, g2.game].every((g) => g.frame === pz));
  m.host.setPaused(false);
  m.run(2);
  check('reprise : tous repartent', [m.hostGame, g1.game, g2.game].every((g) => g.frame > pz + 60) && g1.ls.waitKind() === null);
  m.host.setSpeed(2);
  const sf = m.host.speedNext?.at;
  let applied = null;
  m.run(3, () => {
    if (applied == null && m.host.speed === 2) applied = m.hostGame.frame;
  });
  check('vitesse ×2 : appliquée à l’image annoncée (+ 10), suivie par les invités', applied != null && applied >= sf && applied <= sf + 2 && g1.ls.speed === 2 && g2.ls.speed === 2, `${applied} / ${sf} ${g1.ls.speed} ${g2.ls.speed}`);
  check('à ×2, les invités suivent sans retard croissant', [g1, g2].every((g) => g.ls.lag < 60 && m.hostGame.frame - g.game.frame < 60), [g1, g2].map((g) => `${g.ls.lag.toFixed(0)}/${m.hostGame.frame - g.game.frame}`).join());
  check('à ×2 : aucun écart', [g1, g2].every((g) => !g.ls.stats.resyncs));
}

// ─── qa-coop : défauts reproduits puis corrigés (un test chacun) ───

// Même modification chez tous, à la même image (pause de l'hôte, puis reprise).
function together(m, fn) {
  m.host.setPaused(true);
  m.run(2);
  for (const g of [m.hostGame, ...m.guests().map((x) => x.game)]) fn(g);
  m.host.setPaused(false);
}

if (section('Rembobinage juste après un état complet (dernière chance)')) {
  // L'historique du Rembobinage ne voyage pas. Un invité resynchronisé peu avant une
  // dernière chance sauvée par un Rembobinage ne pouvait pas rembobiner (moins de 2 s
  // de passé) : sa partie divergeait jusqu'à l'empreinte suivante, et si la dernière
  // chance s'achevait avant, il perdait SEUL la partie (écran « Défaite », sortie).
  const lvl = await loadLevel('1-3');
  let lostAlone = 0;
  let viaHash = 0;
  let viaRewind = 0;
  let same = 0;
  const lefts = [1.25, 1.15, 1.05, 0.95, 0.9, 0.85];
  for (const left of lefts) {
    const net = new MemNet({ jitter: [30, 90], seed: 4 });
    const m = memCoop(lvl, { n: 2, seed: 9, net, bots: false });
    const [g1] = m.guests();
    m.run(1);
    m.host.issue('startNextWave', []);
    m.run(25);
    together(m, (g) => {
      g.rewindCharge = g.rules.rewindCost ?? 100;
      g.lives = 1;
      g.leak(g.enemies[0] ?? g.spawnEnemy('kodama', g.grid.spawns[0])); // fuite fatale, jauge pleine : dernière chance de 4 s
    });
    for (let k = 0; k < 120 && m.hostGame.lastChanceT > 3.5; k++) m.frame();
    g1.ls.resync('test');
    for (let k = 0; k < 240 && g1.ls.stats.imports < 1; k++) m.frame();
    for (let k = 0; k < 240 && m.hostGame.lastChanceT > left; k++) m.frame();
    m.host.issue('rewind', []);
    let lost = false;
    for (let k = 0; k < 360; k++) {
      m.frame();
      if (g1.game.state === 'lost') lost = true;
    }
    if (lost) lostAlone++;
    if (g1.ls.stats.why.hash) viaHash++;
    if (g1.ls.stats.why.rewind) viaRewind++;
    g1.ls.finish(m.hostGame.frame);
    if (m.hostGame.state === 'wave' && g1.game.frame === m.hostGame.frame && syncHash(g1.game) === syncHash(m.hostGame)) same++;
  }
  check('dernière chance sauvée juste après un état complet : l’invité ne perd jamais seul', lostAlone === 0, `${lostAlone}/${lefts.length}`);
  check('… il le voit aussitôt (« rewind ») et reçoit l’état complet, sans attendre l’écart d’empreinte', viaRewind === lefts.length && viaHash === 0, `rewind ${viaRewind} hash ${viaHash}`);
  check('… puis même partie que l’hôte (sauvée)', same === lefts.length, `${same}/${lefts.length}`);
}

if (section('Lecture régulière sous un réseau irrégulier (300-800 ms)')) {
  // L'invité extrapolait l'image de l'hôte depuis le DERNIER battement : chaque écart de
  // temps de route faisait sauter l'estimation ; la lecture ralentissait (19 % des
  // images à moins de 60 % de la vitesse) et butait sur LEAD_CAP (2 % d'images figées).
  const lvl = await loadLevel('2-2');
  for (const jitter of [
    [20, 150],
    [300, 800],
  ]) {
    const net = new MemNet({ jitter, seed: 5 });
    const m = memCoop(lvl, { n: 2, seed: 3, net });
    const [g1] = m.guests();
    m.run(10);
    // images dont l'empreinte de l'hôte a été comparée (chacune une fois au moins)
    const verified = new Set();
    const hs = g1.ls.hashes;
    const get = hs.get.bind(hs);
    hs.get = (f) => (verified.add(f), get(f));
    const f0 = g1.game.frame;
    let n = 0;
    let slow = 0;
    let stuck = 0;
    let prev = g1.ls.play;
    m.run(60, () => {
      const p = g1.ls.play;
      if (!g1.ls.halted && !g1.ls.sync && g1.ls.hb?.pz == null) {
        n++;
        if (p - prev < 0.6) slow++;
        if (g1.game.frame >= g1.ls.stamp + LEAD_CAP) stuck++;
      }
      prev = p;
    });
    check(`gigue ${jitter.join('-')} ms : lecture à la vitesse de l’hôte (< 1 % d’images ralenties, < 0,5 % contre LEAD_CAP)`, n > 3000 && slow / n < 0.01 && stuck / n < 0.005, `${((100 * slow) / n).toFixed(1)} % ralenties, ${stuck} butées sur ${n}`);
    check('… retard modéré, aucune resynchronisation', g1.ls.lag < 60 && !g1.ls.stats.resyncs, `${g1.ls.lag.toFixed(1)} ${JSON.stringify(g1.ls.stats.why)}`);
    // (une seule empreinte en attente : loin derrière l'hôte, l'invité en recevait une
    // nouvelle avant d'atteindre la précédente, jamais comparée — 7 % à 300-800 ms)
    const due = Math.floor(g1.game.frame / 30) - Math.ceil(f0 / 30);
    check('… chaque empreinte de l’hôte est comparée', verified.size >= due, `${verified.size}/${due}`);
  }
  // Hôte figé 2 s (onglet gelé, sans pause) puis reparti : les battements d'avant ne
  // disent plus rien de son horloge (sans quoi l'invité le croyait 2 s plus loin et
  // butait sur LEAD_CAP à chaque battement pendant plusieurs secondes).
  {
    const net = new MemNet({ jitter: [40, 90], seed: 3 });
    const m = memCoop(lvl, { n: 2, seed: 3, net });
    const [g1] = m.guests();
    m.run(15);
    for (let k = 0; k < 120; k++) {
      net.advance(1000 / 60);
      g1.ls.step(1 / 60);
      g1.game.events.length = 0;
    }
    let n = 0;
    let stuck = 0;
    m.run(8, () => {
      if (g1.ls.halted || g1.ls.sync) return;
      n++;
      if (g1.game.frame >= g1.ls.stamp + LEAD_CAP) stuck++;
    });
    check('hôte figé 2 s puis reparti : l’invité reprend sans buter (< 5 %) ni état complet', n > 400 && stuck / n < 0.05 && !g1.ls.stats.resyncs, `${stuck}/${n} ${JSON.stringify(g1.ls.stats.why)}`);
  }
}

if (section('Annulation tardive d’une pierre et d’un mur (invité, Terre)')) {
  // « Annuler » touché en fin de construction : la commande d'annulation arrive après
  // l'activation. Pierre : elle était posée PUIS retirée à moitié prix, une pierre de
  // la réserve perdue (en silence). Mur : il se déplaçait quand même.
  const lvl = await loadLevel('1-4');
  const net = new MemNet({ jitter: [60, 120], seed: 6 });
  const players = [
    { name: 'H', elements: ['fire'] },
    { name: 'T', elements: ['earth'] },
  ];
  const m = memCoop(lvl, { n: 2, seed: 4, net, bots: false, players });
  const [g1] = m.guests();
  m.run(1);
  const G = g1.game;
  let slot = null;
  for (let i = 0; i < G.grid.size && !slot; i++) if (G.canIssue('placeStone', [G.grid.col(i), G.grid.row(i)], 1).ok) slot = [G.grid.col(i), G.grid.row(i)];
  const gold = m.hostGame.players[1].gold;
  const left = m.hostGame.stonesLeft();
  const t = g1.ls.issue('placeStone', slot);
  for (let k = 0; k < 600 && !t.entry; k++) m.frame();
  // l'invité touche « Annuler » 6 images avant la fin de la construction (chez lui)
  for (let k = 0; k < 600 && G.frame < t.entry.frame - 6; k++) m.frame();
  g1.ls.issue('cancel', [t.entry.id]);
  m.run(3);
  const games = [m.hostGame, G];
  check('pierre annulée tard : reprise chez tous, prix rendu en entier, réserve intacte', games.every((g) => !g.grid.stone[g.grid.idx(...slot)] && g.players[1].gold === gold && g.stonesLeft() === left), JSON.stringify(games.map((g) => [g.grid.stone[g.grid.idx(...slot)], g.players[1].gold, g.stonesLeft()])) + ` / ${gold} ${left}`);
  // mur du Gardien de T, puis déplacement annulé trop tard
  let gs = null;
  for (let i = 0; i < G.grid.size && !gs; i++) if (G.canIssue('placeTower', ['earth_guard', G.grid.col(i), G.grid.row(i)], 1).ok) gs = [G.grid.col(i), G.grid.row(i)];
  g1.ls.issue('placeTower', ['earth_guard', ...gs]);
  m.run(4);
  const guard = m.hostGame.towerAt(...gs);
  const bar0 = m.hostGame.barriers.find((b) => b.towerId === guard?.id)?.tile;
  const tile = G.rallyTiles(guard.id).find((i) => i !== bar0);
  const rt = g1.ls.issue('setRally', [guard.id, G.grid.col(tile), G.grid.row(tile)]);
  for (let k = 0; k < 600 && !rt.entry; k++) m.frame();
  for (let k = 0; k < 600 && G.frame < rt.entry.frame - 4; k++) m.frame();
  const ct = g1.ls.issue('cancel', [rt.entry.id]);
  check('… l’interface cache le déplacement annulé', g1.ls.hidden.has(rt.entry.id));
  m.run(3);
  check('mur annulé trop tard : refusé par l’hôte (« late »), le déplacement réapparaît', ct.refused === 'late' && !g1.ls.hidden.has(rt.entry.id), `${ct.refused}`);
  const bars = games.map((g) => g.barriers.find((b) => b.towerId === guard.id)?.tile);
  check('… même mur chez tous', bars[0] === bars[1], JSON.stringify(bars));
  // hôte : annulation de son propre mur trop tard → refusée d'emblée (« Trop tard pour annuler »)
  const hostReject = m.host.issue('cancel', [999999]);
  check('hôte : annulation d’une commande inconnue ou déjà passée refusée', hostReject === null);
  m.run(1);
  check('… parties identiques', syncHash(G) === syncHash(m.hostGame) || (g1.ls.finish(m.hostGame.frame), syncHash(G) === syncHash(m.hostGame)));
  // Lanterne : « Annuler » touché à la fin de ses 3 s, réseau lent (700-900 ms) :
  // l'annulation arrivait après la fenêtre, était acceptée… et ne faisait rien.
  {
    const net2 = new MemNet({ jitter: [700, 900], seed: 8 });
    const m2 = memCoop(lvl, { n: 2, seed: 4, net: net2, bots: false, players });
    const [h1] = m2.guests();
    m2.run(2);
    const H = h1.game;
    let s3 = null;
    for (let i = 0; i < H.grid.size && !s3; i++) if (H.canIssue('placeTower', ['earth', H.grid.col(i), H.grid.row(i)], 1).ok) s3 = [H.grid.col(i), H.grid.row(i)];
    const pt = h1.ls.issue('placeTower', ['earth', ...s3]);
    for (let k = 0; k < 900 && !H.towerAt(...s3); k++) m2.frame();
    const tw = H.towerAt(...s3);
    // « Annuler » visible 3 s après l'activation (chez l'invité) : touché à 2,9 s
    for (let k = 0; k < 900 && H.time - tw.bornAt < 2.95; k++) m2.frame();
    const gold3 = m2.hostGame.players[1].gold;
    const ct3 = h1.ls.issue('cancel', [pt.entry.id]);
    m2.run(5);
    const still = !!m2.hostGame.towerAt(...s3);
    if (process.env.NET_DEBUG) console.log('   ', JSON.stringify({ still, refused: ct3.refused, gold: [gold3, m2.hostGame.players[1].gold], age: m2.hostGame.time - tw.bornAt }));
    check('lanterne annulée à la fin de ses 3 s (réseau lent) : refusée et dite (« late »), jamais acceptée sans effet', (still && ct3.refused === 'late' && m2.hostGame.players[1].gold === gold3) || (!still && m2.hostGame.players[1].gold === gold3 + defs.towers.earth.cost), JSON.stringify({ still, refused: ct3.refused, gold: [gold3, m2.hostGame.players[1].gold] }));
  }
}

// ═══════════════════════════ 2. sur le relais ═══════════════════════════

// Boucle temps réel : chaque partie avance (coop.step) ; les bots jouent.
function realLoop(peers) {
  let running = true;
  let last = performance.now();
  (async () => {
    while (running) {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      for (const p of peers) {
        if (!p.coop.active) continue;
        p.coop.step(dt);
        p.bot?.tick(p.coop.game.frame * STEP);
        p.coop.game.events.length = 0;
      }
      await wait(16);
    }
  })();
  return () => (running = false);
}

// Hôte et invités sur le relais, partie lancée (Coop réel, comme main.js).
async function relayGame(code, levelId, guestIds, { bots = true, speed = 1, seed = 1234 } = {}) {
  const keys = new Map();
  const keyStore = (id) => ({ load: () => keys.get(id) ?? null, save: (v) => keys.set(id, v) });
  const H = new NetSession({ id: `H${code}`, name: 'Hôte', brokers: [url] });
  await H.host({ code, element: 'fire' });
  const G = [];
  for (const id of guestIds) {
    const s = new NetSession({ id, name: id, brokers: [url], keyStore: keyStore(id) });
    await s.join(code);
    G.push(s);
  }
  await wait(300);
  const level = await loadLevel(levelId);
  const host = { s: H, coop: new Coop(H) };
  const players = host.coop.playersFromLobby();
  const starts = G.map((s) => new Promise((res) => s.on('start', res)));
  const start = H.startGame({ level: levelId, seed, players, cd: COMMAND_DELAY });
  const game = new Game(level, defs, { seed, players, localPlayer: 0 });
  host.coop.attachHost(game, start);
  host.coop.speed = speed;
  host.executed = logExec(game);
  const msgs = await Promise.all(starts);
  const guests = msgs.map((msg, i) => {
    const p = { s: G[i], coop: new Coop(G[i]), prov: [], msg };
    p.coop.bindProvisional(() => p.prov);
    p.executed = logExec(p.coop.attachGuest(Game, level, defs, msg));
    return p;
  });
  if (bots) {
    host.bot = bot('balanced', botView(game, (op, args) => host.coop.sender(op, args)), { pid: 0, seed: 3 });
    for (const p of guests) p.bot = bot('balanced', botView(p.coop.game, (op, args) => p.coop.sender(op, args), p.prov), { pid: p.coop.game.localPlayer, seed: 3 + p.coop.game.localPlayer });
  }
  return { H, G, host, guests, level, keys, keyStore, peers: [host, ...guests] };
}

const sameGame = (games) => new Set(games.map((g) => `${g.frame}:${syncHash(g)}`)).size === 1;
// Les invités rejoignent l'image de l'hôte (pause) pour comparer les parties.
async function settle(r) {
  r.host.coop.setPaused(true);
  await wait(1200);
}

if (section('Salon')) {
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
{
  // un client d'une autre version (protocole 5 : états diffusés) est refusé
  const spy = new MqttClient(url);
  await spy.connect();
  const got = [];
  spy.onmessage = (t, x) => got.push(JSON.parse(x));
  await spy.subscribe('jde/v1/TEST/h');
  spy.publish('jde/v1/TEST/c', JSON.stringify({ type: 'hello', id: 'old5', v: 5, name: 'Ancien' }));
  await wait(400);
  check('ancienne version (protocole 5) : refusée', got.some((m) => m.type === 'refuse' && m.id === 'old5' && m.reason === 'version'));
  spy.close();
}
await host.leave();
await wait(200);
for (const s of [a, b, d]) await s.leave();
}

if (section('Partie à deux sur le relais')) {
  const r = await relayGame('DUAB', '1-3', ['A2'], { bots: false });
  const stop = realLoop(r.peers);
  const [gA] = r.guests;
  const hg = r.host.coop.game;
  const ag = gA.coop.game;
  check('départ : même partie (graine, joueurs, délai des commandes)', ag.players.length === 2 && ag.localPlayer === 1 && ag.commandDelay === COMMAND_DELAY && hg.commandDelay === COMMAND_DELAY);
  check('un élément chacun : Feu pour l’hôte, Eau pour l’invité', hg.towersFor(0).every((t) => defs.towers[t].element === 'fire') && ag.towersFor(1).every((t) => defs.towers[t].element === 'water'));
  await wait(1500);
  // une lanterne de Feu demandée par l'invité (outil forcé) : l'hôte la refuse
  let uni = null;
  for (let i = 0; i < ag.grid.size && !uni; i++) if (ag.grid.type(i) === 3 && !ag.grid.slotElement[i] && ag.canPlaceTower('fire', ag.grid.col(i), ag.grid.row(i), 0).ok) uni = [ag.grid.col(i), ag.grid.row(i)];
  const fire = gA.coop.sender('placeTower', ['fire', ...uni]);
  check('l’invité ne peut pas poser de Feu (refusé par l’hôte)', ag.canIssue('placeTower', ['fire', ...uni], 1).reason === 'element' && (await until(() => fire.refused === 'element', 2000)) && !gA.prov.length, JSON.stringify(fire));
  // l'invité pose une lanterne : en construction chez tous, activée à la même image
  const type = ag.towersFor(1)[0];
  let slot = null;
  for (let i = 0; i < ag.grid.size && !slot; i++) if (ag.grid.row(i) >= 2 && ag.canIssue('placeTower', [type, ag.grid.col(i), ag.grid.row(i)], 1).ok) slot = [ag.grid.col(i), ag.grid.row(i)];
  const gold = hg.players.map((p) => p.gold);
  const t0 = performance.now();
  const ticket = gA.coop.sender('placeTower', [type, ...slot]);
  check('invité : pose provisoire « en construction » aussitôt', gA.prov.includes(ticket) && !ag.towerAt(...slot));
  check('datée par l’hôte (< 1 s), visible en construction chez l’hôte', await until(() => hg.pendingPlacements(1).some((e) => e.args[1] === slot[0] && e.args[2] === slot[1]), 1000));
  check('… et chez l’invité (commande datée, plus provisoire)', await until(() => !!ticket.entry && !gA.prov.length && ag.queue.includes(ticket.entry), 1000));
  const entry = ticket.entry;
  check('construction de 2 s depuis le toucher de l’invité', entry && entry.frame - entry.issued === hg.buildFrames(), JSON.stringify(entry));
  check('activée chez les deux à la même image', await until(() => !!hg.towerAt(...slot) && !!ag.towerAt(...slot), 4000));
  const tH = r.host.executed.get(entry.id);
  const tA = gA.executed.get(entry.id);
  check('… l’image annoncée', tH === entry.frame && tA === entry.frame, `${tH} ${tA} / ${entry.frame}`);
  const delay = performance.now() - t0;
  check('… environ 2 s après le toucher (temps réel)', delay > 1700 && delay < 2900, `${Math.round(delay)} ms`);
  check('or séparé : l’invité paie, l’hôte non', hg.players[1].gold === gold[1] - defs.towers[type].cost && hg.players[0].gold === gold[0] && ag.players[1].gold === hg.players[1].gold);
  // pause de l'hôte : tous à la même image
  r.host.coop.setPaused(true);
  const pz = r.host.coop.net.pauseAt;
  await wait(1000);
  check('pause de l’hôte : même image chez les deux (annoncée)', hg.frame === pz && ag.frame === pz && gA.coop.waitKind() === 'pause', `${hg.frame} ${ag.frame} / ${pz}`);
  check('… même partie (empreinte)', sameGame([hg, ag]));
  r.host.coop.setPaused(false);
  await wait(600);
  check('reprise', ag.frame > pz + 10 && gA.coop.waitKind() === null);
  stop();
  r.host.coop.stop();
  gA.coop.stop();
  for (const s of [r.H, ...r.G]) await s.leave();
}

async function until(fn, ms = 4000) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (fn()) return true;
    await wait(20);
  }
  return !!fn();
}

if (section('Partie à trois sur le relais : bots, ×4, 3 minutes de jeu, débit, rechargement')) {
  const r = await relayGame('TRXA', '1-3', ['A3', 'B3'], { bots: true, speed: 4 });
  const stop = realLoop(r.peers);
  const hg = r.host.coop.game;
  // à ×4 : 3 minutes de jeu en ~45 s
  let rewound = false;
  const t0 = performance.now();
  const in0 = r.G.map((s) => s.traffic.in);
  const out0 = r.G.map((s) => s.traffic.out);
  while (hg.frame < 180 * 60 && hg.state !== 'won' && hg.state !== 'lost' && performance.now() - t0 < 90000) {
    if (!rewound && hg.frame > 60 * 60 && hg.canRewind()) rewound = !!r.host.coop.sender('rewind', []);
    await wait(100);
  }
  const gameSecs = hg.frame / 60;
  const realSecs = (performance.now() - t0) / 1000;
  await settle(r);
  const games = r.peers.map((p) => p.coop.game);
  check('3 minutes de jeu (×4) avec Rembobinage', hg.frame >= 180 * 60 - 1 && games.every((g) => g.rewindsUsed >= 1 && g.rewindsUsed === hg.rewindsUsed), games.map((g) => `${g.frame}:${g.rewindsUsed}`).join(' '));
  check('même partie chez les trois (empreinte à la même image)', sameGame(games), games.map((g) => `${g.frame}:${syncHash(g)}`).join(' '));
  const st = r.guests.map((p) => p.coop.net.stats);
  check('aucune resynchronisation (relais fiable)', st.every((s) => s.resyncs === 0), JSON.stringify(st));
  check('empreintes vérifiées en continu', st.every((s) => s.checks > 300), st.map((s) => s.checks).join());
  check('les trois joueurs ont bâti', [0, 1, 2].every((pid) => hg.towers.some((t) => t.owner === pid)));
  // débit par invité : reçu (commandes + battements) et envoyé (commandes signées)
  const rin = r.G.map((s, i) => (s.traffic.in - in0[i]) / gameSecs);
  const rout = r.G.map((s, i) => (s.traffic.out - out0[i]) / gameSecs);
  console.log(`  · reçu par invité : ${rin.map(kb).join(', ')} par seconde de jeu (×4 : ${r.G.map((s, i) => kb((s.traffic.in - in0[i]) / realSecs)).join(', ')} en temps réel) ; envoyé : ${rout.map(kb).join(', ')}`);
  check('débit très faible par invité (< 1,5 Ko/s par seconde de jeu)', rin.every((v) => v < 1.5 * 1024), rin.map(kb).join());
  // un invité recharge sa page en pleine partie : même identifiant, mêmes clés
  r.host.coop.setPaused(false);
  await wait(1500);
  const old = r.guests[1];
  old.coop.stop();
  old.s.detach(); // onglet fermé brutalement (le relais publie son « bye »… d'une connexion morte)
  const s2 = new NetSession({ id: 'B3', name: 'B3', brokers: [url], keyStore: r.keyStore('B3') });
  const restart = new Promise((res) => s2.on('start', res));
  await s2.join('TRXA');
  const msg = await Promise.race([restart, wait(4000).then(() => null)]);
  check('rechargement : l’hôte renvoie le départ (retour)', !!msg && msg.rejoin === 'B3' && msg.you === 2);
  const back = { s: s2, coop: new Coop(s2), prov: [] };
  back.coop.bindProvisional(() => back.prov);
  back.coop.attachGuest(Game, r.level, defs, msg);
  r.peers.push(back);
  check('… « Synchronisation… » le temps de l’état complet', back.coop.waitKind() === 'sync');
  check('… état complet reçu, la partie reprend', await until(() => back.coop.net.stats.imports === 1 && back.coop.waitKind() === null && back.coop.game.frame > 60 * 60, 6000), JSON.stringify(back.coop.net.stats));
  await wait(4000);
  await settle(r);
  const all = [hg, r.guests[0].coop.game, back.coop.game];
  check('… puis même partie que les autres', sameGame(all), all.map((g) => `${g.frame}:${syncHash(g)}`).join(' '));
  r.host.coop.setPaused(false);
  await wait(500);
  // fin de partie : chacun la calcule ; l'annonce de l'hôte (image finale) sert de filet
  r.host.coop.game.lose();
  const fin = hg.frame;
  r.H.endGame({ won: false }, fin);
  const ends = await Promise.all([r.G[0], s2].map((s) => new Promise((res) => s.on('end', res))).map((p) => Promise.race([p, wait(3000).then(() => null)])));
  check('fin annoncée avec son image', ends.every((m) => m && m.f === fin));
  stop();
  for (const p of r.peers) p.coop.stop();
  for (const s of [r.H, r.G[0], s2]) await s.leave();
}

// Tiers du relais : un client MQTT quelconque, abonné aux jokers (il voit tous les salons).
const spyClient = async (topics) => {
  const cl = new MqttClient(url);
  await cl.connect();
  cl.inbox = [];
  cl.onmessage = (topic, text) => cl.inbox.push({ topic, text });
  for (const t of topics) await cl.subscribe(t);
  return cl;
};

if (section('Messages forgés sur le relais (partie en cours)')) {
  const r = await relayGame('SPYQ', '1-1', ['pvictim1'], { bots: false });
  const stop = realLoop(r.peers);
  const spy = await spyClient(['jde/v1/+/h', 'jde/v1/+/c']);
  const [V] = r.guests;
  const hg = r.host.coop.game;
  const vg = V.coop.game;
  await wait(800);
  let slot = null;
  for (let i = 0; i < vg.grid.size && !slot; i++) if (vg.canIssue('placeTower', ['water', vg.grid.col(i), vg.grid.row(i)], 1).ok) slot = [vg.grid.col(i), vg.grid.row(i)];
  V.coop.sender('placeTower', ['water', ...slot]);
  check('commande signée de l’invité appliquée', await until(() => hg.towers.some((t) => t.owner === 1) && vg.towers.some((t) => t.owner === 1), 4000));
  const t = hg.towers.find((x) => x.owner === 1);
  const forge = (msg) => spy.publish('jde/v1/SPYQ/c', typeof msg === 'string' ? msg : JSON.stringify(msg));
  const n = Date.now() * 2000;
  // ancien format, enveloppe sans signature, puis enveloppe signée par une autre clé
  forge({ type: 'cmd', id: 'pvictim1', op: 'sellTower', args: [t.id] });
  forge({ type: 'sig', id: 'pvictim1', d: JSON.stringify({ type: 'cmd', id: 'pvictim1', n, conn: V.s.conn, op: 'sellTower', args: [t.id], f: hg.frame + 60 }) });
  const subtle = globalThis.crypto.subtle;
  const mine = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', mine.publicKey);
  const signAs = async (inner) => {
    const dd = JSON.stringify(inner);
    const sig = btoa(String.fromCharCode(...new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, mine.privateKey, new TextEncoder().encode(dd)))));
    return { type: 'sig', id: 'pvictim1', d: dd, sig };
  };
  forge(await signAs({ type: 'hello', id: 'pvictim1', n: n + 1, conn: 'tiers', v: 6, name: 'Tiers', pk: `${jwk.x}.${jwk.y}` }));
  forge(await signAs({ type: 'cmd', id: 'pvictim1', n: n + 2, conn: 'tiers', op: 'sellTower', args: [t.id] }));
  forge(await signAs({ type: 'resync', id: 'pvictim1', n: n + 3, conn: 'tiers' }));
  // rejeu des messages signés de l'invité, captés au passage
  for (const msg of spy.inbox.filter((x) => x.topic === 'jde/v1/SPYQ/c')) forge(msg.text);
  forge({ type: 'bye', id: 'pvictim1' });
  forge({ type: 'sig', id: 'pvictim1', d: JSON.stringify({ type: 'bye', id: 'pvictim1', n: n + 4, conn: V.s.conn }) });
  // fin de partie forgée chez l'invité (sans la partie qu'elle termine)
  const ends = [];
  V.s.on('end', (msg) => ends.push(msg));
  spy.publish('jde/v1/SPYQ/h', JSON.stringify({ type: 'end', result: { won: true, stars: 3, challenge: true, kills: '<img src=x onerror=alert(1)>' } }));
  await wait(1500);
  check('usurpations ignorées : la lanterne de l’invité reste', !!hg.towerById(t.id) && hg.towers.filter((x) => x.owner === 1).length === 1);
  check('… aucune commande forgée datée par l’hôte', !hg.queue.some((e) => e.op === 'sellTower') && !r.host.coop.net.wants.size);
  check('« bye » usurpé ignoré : l’invité reste présent', r.H.lobby.players[1]?.online === true, JSON.stringify(r.H.lobby.players));
  check('identité de l’invité non reprise par un tiers', r.H.lobby.players.length === 2 && !r.H.lobby.players.some((x) => x.name === 'Tiers'));
  check('fin de partie forgée ignorée par l’invité', ends.length === 0, JSON.stringify(ends));
  // messages de partie forgés sur le sujet de l'hôte (n'importe qui peut y publier) :
  // autre partie, absurdes, puis une commande « valide » glissée dans la partie
  const gid = r.H.lastStart.seed;
  const pub = (m) => spy.publish('jde/v1/SPYQ/h', JSON.stringify(m));
  const steps0 = V.coop.net.stats.steps;
  pub({ type: 'hb', gid: gid + 1, f: 1e9, k: 0, sp: 1 });
  pub({ type: 'hb', gid, f: 'x', k: 0 });
  pub({ type: 'hb', gid, f: 1e12, k: 0, sp: 1 });
  pub({ type: 'cmd', gid, k: 1e9, e: { id: 1, frame: 'x' } });
  pub({ type: 'state', gid, to: 'pvictim1', f: 5, k: 0, s: { v: 1, frame: 5, towers: [{ type: '<b>', id: 1 }] } });
  await wait(800);
  check('messages de partie absurdes ou d’une autre partie : ignorés, la partie continue', V.coop.net.stats.steps > steps0 + 20 && V.coop.net.stats.resyncs === 0 && vg.frame < 1e6, JSON.stringify(V.coop.net.stats));
  const k = r.host.coop.net.k;
  pub({ type: 'cmd', gid, k: k + 1, e: { id: 900, frame: vg.frame + 30, issued: vg.frame, pid: 1, op: 'sellTower', args: [t.id], at: hg.frame } });
  check('commande forgée glissée dans la partie : l’invité s’en remet (état complet)', await until(() => V.coop.net.stats.imports >= 1 && V.coop.waitKind() === null, 6000), JSON.stringify(V.coop.net.stats));
  await settle(r);
  check('… même partie que l’hôte, la lanterne est toujours là', sameGame([hg, vg]) && !!vg.towerById(t.id), `${hg.frame}:${syncHash(hg)} ${vg.frame}:${syncHash(vg)}`);
  stop();
  spy.close();
  for (const p of r.peers) p.coop.stop();
  r.H.endGame(null);
  for (const s of [r.H, ...r.G]) await s.leave();
}

if (section('Recherche de salon annulée')) {
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
  const res = await joining;
  await wait(2500);
  check('recherche annulée : elle le dit (pas « rejoint »)', res === 'annulé', res);
  check('… le salon recréé reste en ligne', X.online && X.isHost && !!X.client?.connected && X.code === 'XXXB', `${X.state} ${X.role} ${!!X.client} ${X.code}`);
  const F = new NetSession({ id: 'F', brokers: [url] });
  check('… un ami le rejoint', await F.join('XXXB').then(() => true, (e) => e.message));
  const stray = spy.inbox.filter((m) => m.topic === 'jde/v1/XXXB/c' && JSON.parse(m.text).id === 'X');
  check('… aucun « hello » de la recherche vers son propre salon', stray.length === 0, `${stray.length}`);
  await F.leave();
  await X.leave();
  spy.close();
}

if (section('« bye » d’une connexion morte')) {
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
  H2.startGame({ level: '1-1', seed: 11, players: team(2), cd: COMMAND_DELAY });
  await wait(300);
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

if (section('Relance en pleine partie')) {
  const H3 = new NetSession({ id: 'H3', brokers: [url] });
  await H3.host({ code: 'RLNC' });
  const V = new NetSession({ id: 'V3', brokers: [url] });
  await V.join('RLNC');
  H3.startGame({ level: '1-1', seed: 21, players: team(2), cd: COMMAND_DELAY });
  await wait(300);
  await V.leave();
  await wait(400);
  H3.prune();
  const kept = H3.lobby.players.length;
  H3.prune(true);
  check('relance : l’absent est retiré du salon (prune forcé), pas avant', kept === 2 && H3.lobby.players.length === 1, `${kept} → ${H3.lobby.players.length}`);
  H3.endGame(null);
  await H3.leave();
}

console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests réseau passent');
process.exit(failures ? 1 : 0);
