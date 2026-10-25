// Coopération en « lockstep » : chaque téléphone fait tourner la MÊME partie.
//
// Le moteur (src/core/game.js) est déterministe (src/core/dmath.js) : deux parties
// créées avec le même niveau, la même graine et les mêmes joueurs, qui exécutent les
// mêmes commandes aux mêmes images, restent identiques. Seules les COMMANDES
// circulent, jamais la position des yokai ni des lanternes :
//
//   - l'hôte date chaque commande (image d'exécution, identifiant), la met dans la
//     file de son moteur (game.enqueue) et la diffuse : { type: 'cmd', e } ;
//   - un invité PROPOSE ses commandes (op, args, image souhaitée) ; l'hôte les vérifie,
//     les date comme les siennes et les diffuse à tous ; en attendant, l'invité affiche
//     sa pose « en construction » (pose provisoire, state.provisional) ;
//   - l'hôte bat la mesure ~4 fois par seconde : { type: 'hb', f (son image), h, hf
//     (empreinte de son état à la dernière image multiple de 30), sp (vitesse),
//     pz (image de la pause) } ; l'invité avance sa partie au même rythme, un peu en
//     retard, et compare son empreinte à celle de l'hôte ;
//   - un écart (empreinte différente, commande perdue ou arrivée trop tard, gros
//     retard) : l'invité demande l'état complet (game.exportState), l'importe et
//     repart de cette image.
//
// Pourquoi rien ne recule jamais : l'hôte date toute commande au moins MIN_LEAD (10)
// images après son image courante, et un invité ne dépasse jamais de plus de LEAD_CAP
// (8) images la dernière image de l'hôte qu'il connaît. Les messages de l'hôte
// arrivent dans l'ordre (un relais, une connexion) : quand un invité atteint l'image
// F, il a déjà reçu toutes les commandes à exécuter jusqu'à F. Les poses (lanterne,
// pierre, mur) attendent la construction de 2 s (rules.buildTime) : le temps que leur
// commande parvienne à tous, sans que personne ne la voie arriver en retard.
import { COMMANDS, PLACEMENTS, PRIORITIES, STEP } from '../core/game.js';

// Battement de l'hôte : ~4 par seconde à ×1, soit toutes les 15 images (à ×2, deux fois
// plus souvent : l'invité garde la même avance sur la partie) ; une fois par seconde
// pendant la pause (l'invité sait que l'hôte est toujours là).
export const HEARTBEAT_MS = 250;
const PAUSED_HEARTBEAT_MS = 1000;
export const MIN_LEAD = 10; // une commande s'exécute au plus tôt 10 images après sa date
export const LEAD_CAP = 8; // un invité ne dépasse jamais l'hôte connu de plus de 8 images
export const HASH_EVERY = 30; // empreinte de l'état toutes les 30 images (0,5 s)
export const COMMAND_DELAY = 45; // délai des commandes autres que les poses (0,75 s)
// Retard visé de l'invité sur l'image estimée de l'hôte : 12 images (0,2 s), plus si
// les battements arrivent irrégulièrement (sans quoi l'invité buterait sur LEAD_CAP
// entre deux battements et marquerait de petits arrêts).
const MARGIN = 12;
const MARGIN_MAX = 45; // (à ×1 ; à ×2, deux fois plus d'images pour le même retard)
const CLOCK_WINDOW_MS = 4000; // horloge de l'hôte : battements des 4 dernières secondes
const CLOCK_SLIP_S = 0.75; // battement plus en retard que cela sur le plus rapide : l'hôte s'est figé
const HOST_STEPS = 8; // pas de simulation au plus par image d'affichage (hôte, comme le solo)
const CATCHUP_STEPS = 20; // … et pour un invité qui rattrape son retard
const CATCHUP_AFTER = 30; // retard (images) au-delà duquel l'invité rattrape vite
const RESYNC_BEHIND = 300; // plus de 5 s de retard : état complet plutôt que rattrapage
const RESYNC_RETRY_MS = 3000; // état complet demandé sans réponse : nouvelle demande
const STALE_MS = 2500; // invité sans nouvelles de l'hôte : « En attente de l'hôte… »
const MAX_PENDING = 40; // commandes en attente par joueur (au-delà : refusées)
const MAX_AHEAD = 300; // image proposée par un invité : au plus 5 s après celle de l'hôte
const LOST_MS = 6000; // pose provisoire sans nouvelles de l'hôte (proposition perdue) : effacée

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const isInt = Number.isSafeInteger;

// ───────────────────────── forme des commandes ─────────────────────────

// Arguments de chaque commande (le joueur n'en fait pas partie : il est connu de l'hôte
// par la signature de l'invité) : 'int' entier (case, identifiant), 'type' lanterne
// connue, 'priority' priorité de ciblage, 'wave' numéro de vague ou rien. Une chaîne à
// la place d'un entier (« '4' ») donnerait un indice de case faux qui contourne les
// contrôles du moteur : rien d'autre ne passe.
export const ARGS = {
  placeTower: ['type', 'int', 'int'],
  sellTower: ['int'],
  undoPlace: ['int'],
  fuse: ['int', 'int'],
  setPriority: ['int', 'priority'],
  cyclePriority: ['int'],
  placeStone: ['int', 'int'],
  removeStone: ['int', 'int'],
  startNextWave: ['wave'],
  rewind: [],
  setRally: ['int', 'int', 'int'],
  cancel: ['int'],
};

const ARG_OK = {
  int: (v) => isInt(v),
  type: (v, game) => typeof v === 'string' && Object.hasOwn(game.defs.towers, v),
  priority: (v) => PRIORITIES.includes(v),
  wave: (v) => v == null || isInt(v),
};

// Arguments vérifiés d'une commande (copie), ou null si elle est mal formée.
export function cleanArgs(game, op, args) {
  if (typeof op !== 'string' || !Object.hasOwn(ARGS, op) || !Object.hasOwn(COMMANDS, op) || !Array.isArray(args) || args.length > 4) return null;
  const spec = ARGS[op];
  const a = spec.map((kind, k) => args[k] ?? null);
  return spec.every((kind, k) => ARG_OK[kind](a[k], game)) ? a : null;
}

// Commande datée reçue de l'hôte (copie vérifiée), ou null.
export function cleanEntry(game, e) {
  if (!e || typeof e !== 'object') return null;
  const { id, frame, issued, pid, at } = e;
  if (![id, frame, issued, pid, at].every(isInt) || id < 1 || frame < 0 || at < 0) return null;
  if (pid < 0 || pid >= game.players.length) return null;
  const args = cleanArgs(game, e.op, e.args);
  return args ? { id, frame, issued, pid, op: e.op, args, at } : null;
}

// Copie d'une commande pour le réseau (les marques locales ne voyagent pas).
const packEntry = (e) => ({ id: e.id, frame: e.frame, issued: e.issued, pid: e.pid, op: e.op, args: e.args, at: e.at });

// Arguments complétés avant l'envoi : l'appel de vague cite la vague demandée (un appel
// arrivé après le départ automatique, ou en double, n'en appelle pas une de plus).
function prepare(game, op, args) {
  if (op === 'startNextWave') return [game.waveIndex + 1];
  return args;
}

// Image d'exécution souhaitée d'une commande émise à l'image `base`. Une annulation
// passe AVANT la pose qu'elle vise quand c'est possible (rien n'est alors payé).
export function proposeFrame(game, op, args, base) {
  let f = base + game.delayFor(op);
  if (op === 'cancel') {
    const target = game.queue.find((e) => e.id === args[0] && !e.cancelled);
    if (target) f = Math.max(base + 1, Math.min(f, target.frame - 1));
  }
  return f;
}

// Annulation qui, à l'image où elle s'exécuterait (`frame`), serait sans effet — ou
// ne rendrait que la moitié du prix : refusée, « Trop tard pour annuler », plutôt
// qu'acceptée en silence (l'interface avait déjà retiré la construction).
//   - mur déplacé : seulement avant son déplacement ;
//   - lanterne : jusqu'à la fin de sa fenêtre d'annulation (game.undoWindow) — un
//     invité au réseau lent touchait « Annuler » à 2,9 s, l'annulation arrivait après ;
//   - pierre : peu après sa pose (reprise à plein prix, voir game.cancelEntry).
export function lateCancel(game, args, frame) {
  const t = game.queue.find((e) => e.id === args[0] && !e.cancelled);
  if (t) return t.op === 'setRally' && frame >= t.frame;
  // déjà exécutée (l'hôte est en avance sur l'invité)
  const r = game.recent.find((x) => x.id === args[0]);
  if (!r || !r.result) return true;
  if (r.op === 'placeStone') return frame - r.frame > game.commandDelay + 90;
  if (r.op === 'placeTower') {
    const tw = game.towerById(r.result);
    return !tw || tw.level !== 1 || game.time - tw.bornAt + (frame - game.frame) * STEP > game.undoWindow() + 0.25;
  }
  return true;
}

// Empreinte de synchronisation à l'image courante : game.stateHash(), en ne comptant
// que les commandes en file que tous les joueurs ont forcément reçues (datées par
// l'hôte au plus tard à l'image F − LEAD_CAP − 1). Une commande toute fraîche est déjà
// chez l'hôte mais encore en route vers l'invité : elle ne fait pas une différence.
export function syncHash(game) {
  const q = game.queue;
  const limit = game.frame - LEAD_CAP - 1;
  game.queue = q.filter((e) => (e.at ?? -1) <= limit);
  try {
    return game.stateHash();
  } finally {
    game.queue = q;
  }
}

// ───────────────────────── hôte ─────────────────────────

export class HostLockstep {
  /**
   * @param {Game} game  la partie (celle de l'hôte, qu'il fait avancer)
   * @param {object} o   { send(msg) → diffusion à tous les invités, gid, now }
   */
  constructor(game, { send, gid = null, now = clock } = {}) {
    this.game = game;
    this.send = send;
    this.gid = gid;
    this.now = now;
    this.acc = 0;
    this.speed = 1;
    this.speedNext = null; // { sp, at } : vitesse appliquée à partir de l'image `at`
    this.pauseAt = null; // pause : la partie s'arrête à cette image (chez tous)
    this.hbT = 0;
    this.hash = null; // { f, h } : empreinte à la dernière image multiple de HASH_EVERY
    this.k = 0; // numéro de la dernière commande diffusée (un invité repère une perte)
    this.wants = new Map(); // demandes d'état complet : joueur → identifiant
    this.served = new Map(); // joueur → heure du dernier état complet envoyé
    this.traffic = { bytes: 0, msgs: 0, byType: {} };
  }

  get halted() {
    return this.pauseAt != null && this.game.frame >= this.pauseAt;
  }

  get alpha() {
    return this.halted ? 1 : Math.max(0, Math.min(1, this.acc / STEP));
  }

  post(msg) {
    msg.gid = this.gid;
    const n = JSON.stringify(msg).length;
    this.traffic.bytes += n;
    this.traffic.msgs++;
    this.traffic.byType[msg.type] = (this.traffic.byType[msg.type] || 0) + n;
    this.send(msg);
  }

  // Date une commande, l'ajoute à la file locale et la diffuse.
  schedule(op, args, pid, frame, tmp = null) {
    const g = this.game;
    const e = g.makeEntry(op, args, pid, Math.max(frame, g.frame + MIN_LEAD));
    // avancement de la construction : depuis le toucher (image proposée − délai)
    e.issued = Math.max(0, Math.min(g.frame, e.frame - g.delayFor(op)));
    e.at = g.frame;
    g.enqueue(e);
    this.k++;
    this.post({ type: 'cmd', k: this.k, e: packEntry(e), ...(tmp != null ? { tmp } : {}) });
    return e;
  }

  // Commande du joueur de l'hôte (émetteur de src/ui/commands.js).
  issue(op, args, pid = this.game.localPlayer) {
    const g = this.game;
    const a = cleanArgs(g, op, prepare(g, op, args));
    if (!a || !g.canIssue(op, a, pid).ok) return null;
    const frame = Math.max(proposeFrame(g, op, a, g.frame), g.frame + MIN_LEAD);
    if (op === 'cancel' && lateCancel(g, a, frame)) return null;
    return this.schedule(op, a, pid, frame);
  }

  // Commande proposée par un invité (déjà authentifiée : `pid` vient de sa signature).
  // Refusée : l'invité est prévenu (« nack ») et retire sa pose provisoire.
  receive({ pid, op, args, f, tmp }) {
    const g = this.game;
    const t = isInt(tmp) ? tmp : null;
    // (socle déjà en construction : à qui, pour « Pris par … » chez l'invité)
    const refuse = (reason, owner = null) => {
      if (t != null) this.post({ type: 'nack', pid, tmp: t, reason, ...(isInt(owner) ? { owner } : {}) });
      return null;
    };
    if (!isInt(pid) || pid <= 0 || pid >= g.players.length) return null;
    const a = cleanArgs(g, op, args);
    if (!a) return refuse('invalid');
    if (g.queue.reduce((n, e) => n + (e.pid === pid ? 1 : 0), 0) >= MAX_PENDING) return refuse('busy');
    const check = g.canIssue(op, a, pid);
    if (!check.ok) return refuse(check.reason, check.owner);
    const frame = Math.max(isInt(f) ? Math.min(f, g.frame + MAX_AHEAD) : proposeFrame(g, op, a, g.frame), g.frame + MIN_LEAD);
    if (op === 'cancel' && lateCancel(g, a, frame)) return refuse('late');
    return this.schedule(op, a, pid, frame, t);
  }

  // Avance la partie de `dt` secondes réelles. Renvoie le nombre de pas simulés.
  step(dt) {
    const g = this.game;
    let n = 0;
    if (this.halted) this.acc = 0;
    else {
      this.acc += dt * this.speed;
      while (this.acc >= STEP && n < HOST_STEPS) {
        if (this.halted) {
          this.acc = 0;
          break;
        }
        this.update();
        this.acc -= STEP;
        n++;
        // image de la pause atteinte : les invités la connaissent aussitôt (ils s'y arrêtent)
        if (this.halted) this.heartbeat();
      }
      if (n >= HOST_STEPS) this.acc = 0;
    }
    this.serveStates();
    this.hbT += dt;
    if (this.hbT >= (this.halted ? PAUSED_HEARTBEAT_MS : HEARTBEAT_MS / this.speed) / 1000) this.heartbeat();
    return n;
  }

  update() {
    const g = this.game;
    g.update(STEP);
    if (g.frame % HASH_EVERY === 0) this.hash = { f: g.frame, h: syncHash(g) };
    if (this.speedNext && g.frame >= this.speedNext.at) {
      this.speed = this.speedNext.sp;
      this.speedNext = null;
    }
  }

  heartbeat() {
    this.hbT = 0;
    const g = this.game;
    const m = { type: 'hb', f: g.frame, k: this.k, sp: this.speed };
    if (this.hash) {
      m.hf = this.hash.f;
      m.h = this.hash.h;
    }
    if (this.speedNext) {
      m.ns = this.speedNext.sp;
      m.nf = this.speedNext.at;
    }
    if (this.pauseAt != null) m.pz = this.pauseAt;
    this.post(m);
  }

  // Pause de l'hôte : la partie s'arrête chez tous à la même image (dans 10 images).
  setPaused(on) {
    const g = this.game;
    if (on && this.pauseAt == null) this.pauseAt = g.frame + MIN_LEAD;
    else if (!on) this.pauseAt = null;
    this.heartbeat();
  }

  // Vitesse (×1, ×2) : appliquée chez tous à partir d'une image annoncée.
  setSpeed(sp) {
    if (!(sp > 0) || sp === (this.speedNext?.sp ?? this.speed)) return;
    if (sp === this.speed) this.speedNext = null;
    else this.speedNext = { sp, at: this.game.frame + MIN_LEAD };
    this.heartbeat();
  }

  // Un invité demande l'état complet (retour, écart d'empreinte, commande perdue).
  requestState(pid, id) {
    if (!isInt(pid) || pid <= 0 || pid >= this.game.players.length || typeof id !== 'string') return;
    this.wants.set(pid, id);
  }

  // Envoie les états complets demandés (pas pendant l'animation du Rembobinage :
  // exportState renvoie null, on réessaie à l'image suivante). Une fois par seconde
  // au plus pour un même joueur.
  serveStates() {
    if (!this.wants.size) return;
    const now = this.now();
    const ready = [...this.wants].filter(([pid]) => now - (this.served.get(pid) ?? -Infinity) >= 1000);
    if (!ready.length) return;
    const s = this.game.exportState();
    if (!s) return;
    for (const [pid, id] of ready) {
      this.wants.delete(pid);
      this.served.set(pid, now);
      this.post({ type: 'state', to: id, f: this.game.frame, k: this.k, s });
    }
  }
}

// ───────────────────────── invité ─────────────────────────

const STATES = ['build', 'wave', 'won', 'lost'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const arr = (v, max) => Array.isArray(v) && v.length <= max;

// État complet de l'hôte : il arrive par un relais public (n'importe qui peut publier
// sur le sujet du salon). Il ne doit ni planter la simulation (type inconnu, case hors
// de la grille) ni introduire de joueurs, de noms ou de grilles d'une autre partie.
export function validState(game, s) {
  if (!s || typeof s !== 'object' || s.v !== 1) return false;
  const g = game.grid;
  const n = game.players.length;
  if (!isInt(s.frame) || s.frame < 0 || !STATES.includes(s.state) || !isNum(s.lives) || !isNum(s.time) || !isNum(s.ct)) return false;
  if (!arr(s.players, 4) || s.players.length !== n || !s.players.every((p) => p && isNum(p.gold))) return false;
  if (!arr(s.stones, g.size) || s.stones.length !== g.size || !s.stones.every((v) => v === 0 || v === 1)) return false;
  if (!arr(s.stoneOwner, g.size) || s.stoneOwner.length !== g.size || !s.stoneOwner.every((v) => isInt(v) && v >= -1 && v < n)) return false;
  const tower = (t) => t && Object.hasOwn(game.defs.towers, t.type) && isInt(t.id) && g.inBounds(t.c, t.r) && isInt(t.c) && isInt(t.r) && isInt(t.level) && t.level >= 1 && t.level <= 3 && isInt(t.owner) && t.owner >= 0 && t.owner < n;
  if (!arr(s.towers, g.size) || !s.towers.every(tower) || !arr(s.echoes, g.size * 2) || !s.echoes.every(tower)) return false;
  const enemy = (e) => e && Object.hasOwn(game.defs.enemies, e.type) && isInt(e.id) && isNum(e.x) && isNum(e.y) && isNum(e.hp) && Array.isArray(e.trail) && Array.isArray(e.slows) && Array.isArray(e.burns) && Array.isArray(e.shreds) && e.timers && typeof e.timers === 'object';
  if (!arr(s.enemies, 3000) || !s.enemies.every(enemy)) return false;
  if (!arr(s.queue, 2000) || !s.queue.every((e) => cleanEntry(game, e))) return false;
  for (const k of ['barriers', 'spawners', 'recent', 'projectiles', 'zoneTimers', 'chargedKills', 'chargedWaves', 'tornadoes', 'waveCleared']) if (!arr(s[k], 20000)) return false;
  return s.spawners.every((sp) => sp && Object.hasOwn(game.defs.enemies, sp.enemy) && isInt(sp.count));
}

export class GuestLockstep {
  /**
   * @param {Game} game  la partie de l'invité (une vraie simulation, avancée ici)
   * @param {object} o   { send(op, args, { f, tmp }) → proposition à l'hôte,
   *                       ask(why) → demande d'état complet, provisional() → liste des
   *                       poses provisoires (state.provisional), gid, rejoin, now }
   */
  constructor(game, { send, ask, provisional = () => null, gid = null, rejoin = false, now = clock } = {}) {
    this.game = game;
    this.sendCmd = send;
    this.ask = ask;
    this.provisional = provisional;
    this.gid = gid;
    this.now = now;
    this.hb = null; // dernier battement : { f, at, sp, ns, nf, pz }
    this.stamp = 0; // dernière image de l'hôte connue (battement, commande, état complet)
    this.play = 0; // image visée par la lecture (réel)
    this.k = 0; // dernière commande reçue (numéro de diffusion de l'hôte)
    this.hashes = new Map(); // image → empreinte (images multiples de HASH_EVERY)
    // empreintes de l'hôte pas encore comparées (image → empreinte) : plusieurs, car un
    // invité loin derrière (réseau irrégulier, téléphone lent) en recevait parfois une
    // nouvelle avant d'atteindre l'image de la précédente, qui n'était jamais vérifiée
    this.hostHashes = new Map();
    this.sync = null; // { why, at } : état complet demandé, partie suspendue
    this.tickets = new Map(); // numéro provisoire → ticket (pose provisoire ou commande envoyée)
    this.hidden = new Set(); // commandes en file dont l'annulation est demandée (cachées)
    this.tmpBase = Math.floor(Math.random() * 1e6) * 1000;
    this.tmpSeq = 0;
    this.lastMsgAt = now();
    this.offs = []; // décalages d'arrivée des battements récents : { at, o } (voir onHeartbeat)
    this.lead = 0; // avance de l'horloge de l'hôte sur le dernier battement (images)
    this.margin = MARGIN;
    this.stats = { resyncs: 0, why: {}, imports: 0, late: 0, steps: 0, checks: 0 };
    if (rejoin) this.resync('rejoin');
  }

  // ─── messages de l'hôte ───

  receive(msg) {
    if (!msg || typeof msg !== 'object' || msg.gid !== this.gid) return false;
    try {
      if (msg.type === 'cmd') return this.onCmd(msg);
      if (msg.type === 'hb') return this.onHeartbeat(msg);
      if (msg.type === 'state') return this.onState(msg);
      if (msg.type === 'nack') return this.onNack(msg);
    } catch (e) {
      console.warn('Message de l’hôte ignoré :', msg.type, e);
    }
    return false;
  }

  seen(f) {
    if (f > this.stamp) this.stamp = f;
    this.lastMsgAt = this.now();
  }

  // Image plausible de l'hôte (un message forgé ne fait pas courir la partie).
  plausible(f) {
    if (!isInt(f) || f < 0) return false;
    if (!this.hb) return true;
    const dt = (this.now() - this.hb.at) / 1000;
    return f >= this.hb.f && f <= this.hb.f + dt * 60 * 4 + 600;
  }

  onCmd(msg) {
    const g = this.game;
    const e = cleanEntry(g, msg.e);
    if (!e || !isInt(msg.k) || !this.plausible(e.at)) return false;
    this.seen(e.at);
    const mine = e.pid === g.localPlayer && isInt(msg.tmp) ? this.tickets.get(msg.tmp) : null;
    if (this.sync) {
      // l'état complet attendu la contiendra (ou son effet) : on retient juste sa date
      if (mine) this.dated(mine, e);
      return true;
    }
    if (msg.k <= this.k) return true; // déjà reçue
    if (msg.k !== this.k + 1) {
      this.resync('gap'); // une commande s'est perdue en route
      return true;
    }
    this.k = msg.k;
    if (e.frame <= g.frame) {
      // arrivée trop tard (ne devrait jamais arriver : voir LEAD_CAP)
      this.stats.late++;
      this.resync('late');
      return true;
    }
    g.enqueue(e);
    if (mine) this.dated(mine, e);
    return true;
  }

  onHeartbeat(msg) {
    if (!this.plausible(msg.f) || !isInt(msg.k)) return false;
    const sp = [1, 2, 4].includes(msg.sp) ? msg.sp : 1;
    const ns = [1, 2, 4].includes(msg.ns) && isInt(msg.nf) ? msg.ns : null;
    const prev = this.hb;
    const now = this.now();
    // Horloge de l'hôte. Chaque battement donne un décalage o = heure d'arrivée − heure
    // de son image (f / 60 / vitesse) : il ne varie que de son temps de route. Le plus
    // petit des dernières secondes (le battement le plus rapide) donne l'horloge la
    // plus juste ; s'y fier plutôt qu'au dernier battement rend la lecture régulière
    // (réseau irrégulier : l'estimation sautait à chaque battement, la lecture
    // ralentissait d'une image sur cinq et butait sur LEAD_CAP). L'écart entre le plus
    // grand et le plus petit (la gigue) fixe la marge.
    const steady = prev && prev.pz == null && msg.pz == null && prev.ns == null && ns == null && prev.sp === sp;
    const o = now / 1000 - msg.f / (60 * sp);
    // (hôte figé un moment — onglet gelé, téléphone occupé — : son horloge a pris du
    // retard pour de bon ; les battements d'avant ne disent plus rien)
    if (!steady || this.offs.some((x) => o - x.o > CLOCK_SLIP_S)) this.offs = [];
    this.offs.push({ at: now, o });
    while (this.offs.length > 2 && (this.offs.length > 64 || now - this.offs[0].at > CLOCK_WINDOW_MS)) this.offs.shift();
    this.lead = 0;
    if (this.offs.length >= 4) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const x of this.offs) {
        if (x.o < lo) lo = x.o;
        if (x.o > hi) hi = x.o;
      }
      this.lead = (this.offs.at(-1).o - lo) * 60 * sp;
      this.margin = Math.max(MARGIN, Math.min(MARGIN_MAX * sp, Math.ceil(LEAD_CAP + (hi - lo) * 60 * sp + 2)));
    }
    this.hb = { f: msg.f, at: this.now(), sp, ns, nf: ns != null ? msg.nf : null, pz: isInt(msg.pz) ? msg.pz : null };
    this.seen(msg.f);
    if (!this.sync && msg.k > this.k) this.resync('gap'); // une commande diffusée avant ce battement manque
    if (isInt(msg.hf) && isInt(msg.h) && !this.hostHashes.has(msg.hf)) {
      this.hostHashes.set(msg.hf, msg.h);
      if (this.hostHashes.size > 40) this.hostHashes.delete(this.hostHashes.keys().next().value);
      this.verify();
    }
    return true;
  }

  onState(msg) {
    const g = this.game;
    if (!this.sync || !isInt(msg.f) || !isInt(msg.k) || msg.f !== msg.s?.frame || !validState(g, msg.s)) return false;
    // noms et éléments des joueurs : ceux du départ (l'état ne les change pas)
    const keep = g.players.map((p) => ({ name: p.name, elements: p.elements.slice() }));
    try {
      if (!g.importState(msg.s)) return false;
    } catch (e) {
      console.warn('État complet de l’hôte ignoré :', e);
      return false;
    }
    g.players.forEach((p, i) => Object.assign(p, keep[i]));
    this.k = msg.k;
    this.stamp = Math.max(this.stamp, msg.f);
    this.lastMsgAt = this.now();
    this.play = g.frame;
    this.hashes.clear();
    this.hostHashes.clear();
    this.sync = null;
    this.stats.imports++;
    this.stats.lastImport = g.frame;
    // l'historique du Rembobinage ne voyage pas (trop lourd) : il se reconstitue en 6 s
    // de chronologie (g.ct, qui ne court ni pendant la dernière chance ni pendant
    // l'animation d'un Rembobinage : compter les images ne suffit pas)
    this.shortHistoryUntil = g.frame + Math.ceil(((g.rules.rewindSeconds ?? 6) + 0.5) * 60);
    this.shortHistoryCt = g.rewindEnabled && g.state === 'wave' ? g.ct + (g.rules.rewindSeconds ?? 6) + 0.3 + 2 * (g.rules.snapshotInterval ?? 0.1) : null;
    this.relink();
    for (const t of this.tickets.values()) if (t.cancelled && t.entry && g.queue.includes(t.entry)) this.cancelLate(t);
    // une pose provisoire datée avant l'état complet est dans sa file (ou déjà faite)
    const prov = this.provisional();
    if (Array.isArray(prov)) for (let i = prov.length - 1; i >= 0; i--) if (prov[i].entry) prov.splice(i, 1);
    return true;
  }

  onNack(msg) {
    const g = this.game;
    if (msg.pid !== g.localPlayer || !isInt(msg.tmp)) return false;
    const t = this.tickets.get(msg.tmp);
    if (!t || t.entry) return false;
    this.drop(t);
    t.refused = typeof msg.reason === 'string' ? msg.reason.slice(0, 24) : 'refused';
    this.lastMsgAt = this.now();
    // pose refusée par l'hôte : la raison s'écrit près du socle (main.js, 'reject')
    const at = t.op === 'placeTower' || t.op === 'setRally' ? { c: t.args[1], r: t.args[2] } : t.op === 'placeStone' ? { c: t.args[0], r: t.args[1] } : null;
    const owner = isInt(msg.owner) && msg.owner >= 0 && msg.owner < g.players.length ? msg.owner : undefined;
    if (at && PLACEMENTS.has(t.op)) g.emit('reject', { c: at.c, r: at.r, reason: t.refused, owner, pid: g.localPlayer, fromHost: true });
    if (t.op === 'cancel') {
      // annulation refusée (trop tard) : la construction cachée réapparaît, et on le dit
      this.hidden.delete(t.args[0]);
      const e = g.queue.find((x) => x.id === t.args[0]) ?? g.recent.find((x) => x.id === t.args[0]);
      const tile = e && (e.op === 'placeStone' ? { c: e.args[0], r: e.args[1] } : e.op === 'placeTower' || e.op === 'setRally' ? { c: e.args[1], r: e.args[2] } : null);
      if (tile) g.emit('reject', { c: tile.c, r: tile.r, reason: t.refused, pid: g.localPlayer, fromHost: true });
    }
    return true;
  }

  // ─── commandes du joueur (émetteur de src/ui/commands.js) ───

  issue(op, args) {
    const g = this.game;
    if (this.sync) return null; // partie suspendue le temps de la synchronisation
    // annulation d'une pose pas encore datée par l'hôte
    if (op === 'cancel' && args[0] && typeof args[0] === 'object') return this.cancelProvisional(args[0]);
    const a = cleanArgs(g, op, prepare(g, op, args));
    if (!a) return null;
    const tmp = this.tmpBase + ++this.tmpSeq;
    this.sendCmd(op, a, { f: proposeFrame(g, op, a, g.frame), tmp });
    if (op === 'cancel' && g.queue.some((e) => e.id === a[0])) this.hidden.add(a[0]);
    const ticket = { op, args: a, pid: g.localPlayer, born: g.frame, tmp, sentAt: this.now() };
    this.tickets.set(tmp, ticket);
    if (this.tickets.size > 64) this.tickets.delete(this.tickets.keys().next().value);
    if (PLACEMENTS.has(op)) this.provisional()?.push(ticket);
    return ticket;
  }

  // « Annuler » avant la date de l'hôte : la pose disparaît tout de suite ; sa commande
  // datée, à son arrivée, est aussitôt annulée (avant son exécution : rien n'est payé).
  cancelProvisional(t) {
    if (t.entry) return this.issue('cancel', [t.entry.id]);
    this.drop(t);
    t.cancelled = true;
    return { op: 'cancel', args: [], pid: this.game.localPlayer, done: true, ok: true, result: true };
  }

  // La commande du ticket est datée : elle quitte la liste provisoire.
  dated(t, e) {
    t.entry = e;
    this.drop(t);
    this.cancelLate(t);
  }

  // Pose annulée avant sa date : son annulation part dès qu'elle est datée (et connue
  // de la file : après un état complet, la commande y est peut-être déjà).
  cancelLate(t) {
    if (!t.cancelled || t.cancelSent || !t.entry || this.sync) return;
    t.cancelSent = true;
    this.hidden.add(t.entry.id);
    this.issue('cancel', [t.entry.id]);
  }

  // Commandes envoyées à l'hôte, pas encore datées (ni refusées, ni perdues en route) :
  // l'interface montre une fusion ou une vente « en route » (commands.towerOps).
  sent() {
    const now = this.now();
    const out = [];
    for (const t of this.tickets.values()) if (!t.entry && !t.refused && !t.cancelled && t.op !== 'cancel' && now - t.sentAt < LOST_MS) out.push(t);
    return out;
  }

  drop(t) {
    const prov = this.provisional();
    const i = Array.isArray(prov) ? prov.indexOf(t) : -1;
    if (i >= 0) prov.splice(i, 1);
  }

  // Proposition perdue en route (coupure du relais) : la pose provisoire ne reste pas
  // « en construction » indéfiniment (si sa date arrive malgré tout, la construction
  // réapparaît depuis la file).
  dropLost(now) {
    const prov = this.provisional();
    if (!Array.isArray(prov) || !prov.length) return;
    for (let i = prov.length - 1; i >= 0; i--) {
      const t = prov[i];
      if (!t.entry && t.sentAt != null && now - t.sentAt > LOST_MS) prov.splice(i, 1);
    }
  }

  // Après un état complet : les tickets visent les commandes de la nouvelle file.
  relink() {
    const g = this.game;
    for (const t of this.tickets.values()) {
      const e = t.entry;
      if (!e) continue;
      const q = g.queue.find((x) => x.id === e.id);
      if (q) t.entry = q;
      else if (!e.done) {
        const r = g.recent.find((x) => x.id === e.id);
        Object.assign(e, { done: true, ok: !!r?.result, result: r?.result ?? null });
      }
    }
    for (const id of this.hidden) if (!g.queue.some((e) => e.id === id)) this.hidden.delete(id);
  }

  // ─── lecture ───

  resync(why) {
    if (this.sync) return;
    this.sync = { why, at: this.now() };
    this.stats.resyncs++;
    this.stats.why[why] = (this.stats.why[why] || 0) + 1;
    this.ask(why);
  }

  // Image de l'hôte estimée maintenant (depuis le dernier battement, à sa vitesse).
  estimate(now) {
    const hb = this.hb;
    let t = Math.max(0, (now - hb.at) / 1000);
    let f = hb.f;
    let sp = hb.sp;
    if (hb.ns != null) {
      if (hb.nf <= f) sp = hb.ns;
      else {
        const until = (hb.nf - f) / (60 * sp);
        if (t > until) {
          f = hb.nf;
          t -= until;
          sp = hb.ns;
        }
      }
    }
    f += t * 60 * sp;
    // (horloge régulière : voir onHeartbeat ; pas pendant une pause ni un changement de vitesse)
    if (hb.pz == null && hb.ns == null) f += this.lead;
    return hb.pz != null ? Math.min(f, hb.pz) : f;
  }

  // Vitesse de la partie (affichée par l'invité, réglée par l'hôte).
  get speed() {
    const hb = this.hb;
    if (!hb) return 1;
    return hb.ns != null && this.game.frame >= hb.nf ? hb.ns : hb.sp;
  }

  // Avance la partie de `dt` secondes réelles vers l'image de l'hôte. Renvoie le nombre
  // de pas simulés.
  step(dt) {
    const g = this.game;
    const now = this.now();
    this.dropLost(now);
    if (this.sync) {
      if (now - this.sync.at > RESYNC_RETRY_MS) {
        this.sync.at = now;
        this.ask(this.sync.why);
      }
      return 0;
    }
    if (!this.hb || g.state === 'won' || g.state === 'lost') return 0;
    const cap = Math.min(this.stamp + LEAD_CAP, this.hb.pz ?? Infinity);
    // pause annoncée : tous s'arrêtent à la même image (celle de la pause)
    const target = this.hb.pz != null ? cap : Math.min(this.estimate(now) - this.margin, cap);
    if (target - g.frame > RESYNC_BEHIND) {
      this.resync('behind');
      return 0;
    }
    // la lecture suit le temps réel à la vitesse de l'hôte, et rejoint en douceur
    // (± 50 %) l'image visée ; loin derrière, elle rattrape (20 pas par image au plus)
    const adv = dt * 60 * this.speed;
    let play = this.play + adv;
    const err = target - play;
    if (err > CATCHUP_AFTER) play += Math.min(err, CATCHUP_STEPS);
    else play += Math.max(-adv * 0.5, Math.min(adv * 0.5, err * 0.1));
    this.play = Math.max(g.frame - 2, Math.min(play, cap));
    let n = 0;
    while (g.frame < Math.floor(this.play) && n < CATCHUP_STEPS && !this.sync) {
      this.update();
      n++;
    }
    if (this.hidden.size) for (const id of this.hidden) if (!g.queue.some((e) => e.id === id)) this.hidden.delete(id);
    return n;
  }

  // L'historique du Rembobinage est-il encore incomplet (état complet importé il y a
  // moins de 6 s de chronologie) ?
  get shortHistory() {
    const g = this.game;
    // (une fois reconstitué, il le reste : un Rembobinage ultérieur ramène g.ct en
    // arrière, mais l'historique est alors le même que celui de l'hôte)
    if (this.shortHistoryCt != null && g.ct >= this.shortHistoryCt) this.shortHistoryCt = null;
    return g.frame < (this.shortHistoryUntil ?? 0) || this.shortHistoryCt != null;
  }

  update() {
    const g = this.game;
    const rewinds = g.rewindsUsed;
    // Rembobinage dû à cette image alors que notre historique est incomplet : chez
    // nous, il peut échouer (moins de 2 s de passé) ou ramener ailleurs. Sans le voir
    // aussitôt, la partie divergeait jusqu'à l'empreinte suivante — et pendant une
    // dernière chance, l'invité perdait seul la partie que l'hôte venait de sauver.
    const due = this.shortHistory ? g.queue.filter((e) => e.op === 'rewind' && !e.cancelled && e.frame <= g.frame + 1) : null;
    try {
      g.update(STEP);
    } catch (e) {
      // (état complet forgé ou incohérent) : l'hôte renverra le sien
      console.warn('Simulation interrompue :', e);
      this.resync('error');
      return;
    }
    this.stats.steps++;
    // Rembobinage juste après un état complet : notre historique est plus court que
    // celui de l'hôte, le passé retrouvé diffère (ou le Rembobinage n'a pas eu lieu) ;
    // l'état complet suit sans attendre l'empreinte.
    if ((g.rewindsUsed !== rewinds && this.shortHistory) || due?.some((e) => !g.queue.includes(e))) {
      this.resync('rewind');
      return;
    }
    if (g.frame % HASH_EVERY === 0) {
      this.hashes.set(g.frame, syncHash(g));
      if (this.hashes.size > 40) this.hashes.delete(this.hashes.keys().next().value);
      this.verify();
    }
  }

  // Compare l'empreinte de l'hôte à la nôtre, à la même image.
  verify() {
    for (const [f, h] of this.hostHashes) {
      if (this.sync) return;
      if (this.hashes.has(f)) {
        this.hostHashes.delete(f);
        this.stats.checks++;
        if (this.hashes.get(f) !== h) this.resync('hash');
      } else if (f <= this.game.frame) this.hostHashes.delete(f); // image trop ancienne (ou importée depuis)
    }
  }

  // Fin de partie annoncée par l'hôte à son image `f` : on y va d'un coup (toutes ses
  // commandes sont déjà arrivées), la partie se conclut d'elle-même.
  finish(f) {
    const g = this.game;
    if (this.sync || !isInt(f)) return;
    let n = 0;
    while (g.frame < f && g.state !== 'won' && g.state !== 'lost' && n < RESYNC_BEHIND * 4 && !this.sync) {
      this.update();
      n++;
    }
  }

  get alpha() {
    return Math.max(0, Math.min(1, this.play - this.game.frame));
  }

  // Retard actuel sur l'image estimée de l'hôte (images).
  get lag() {
    return this.hb ? this.estimate(this.now()) - this.game.frame : 0;
  }

  // Bandeau de l'invité : 'sync' (état complet attendu), 'pause' (pause de l'hôte),
  // 'stale' (plus de nouvelles de l'hôte), ou null.
  waitKind() {
    if (this.sync) return 'sync';
    if (this.hb?.pz != null) return 'pause';
    if (this.now() - this.lastMsgAt > STALE_MS) return 'stale';
    return null;
  }

  get halted() {
    const g = this.game;
    return !!this.sync || (this.hb?.pz != null && g.frame >= this.hb.pz) || this.waitKind() === 'stale';
  }
}
