// Façade des commandes de l'interface.
//
// L'interface n'appelle jamais les actions du moteur (placeTower, fuse, sellTower,
// startNextWave, rewind…) : chaque geste devient une COMMANDE confiée à un
// « émetteur ».
//   - Par défaut (solo) : game.issue(op, args) — le moteur date la commande et la
//     met en file : une pose (lanterne, pierre, mur) s'exécute après le délai de
//     construction (rules.buildTime, 2 s), les autres commandes aussitôt.
//   - Coopération : le réseau installe son émetteur (setSender). Il diffuse la
//     commande datée à tous les téléphones (game.enqueue chez chacun). Tant qu'une
//     pose n'a pas reçu sa date, il peut la publier comme POSE PROVISOIRE dans
//     state.provisional (crochet bind({ provisional })) : l'interface la dessine
//     « en construction », réserve son or et refuse une autre pose sur sa case.
//     Une commande en file dont l'annulation est partie (délai réseau) peut être
//     cachée tout de suite (crochet bind({ hidden }) : ensemble d'identifiants).
//
// Ticket renvoyé par issue() :
//   - l'entrée de la file du moteur { id, frame, issued, pid, op, args, done, ok, result } ;
//   - ou, chez un émetteur réseau, la pose provisoire { op, args, pid, born, entry? }
//     (born : game.frame au toucher ; entry : l'entrée datée, renseignée par le
//     réseau dès qu'elle est connue — la pose quitte alors la liste provisoire) ;
//   - null : commande refusée, rien n'est parti.
//
// Émetteur : fn(op, args, game) → ticket | null. Il reçoit des commandes déjà
// vérifiées (check). Exception : l'annulation d'une pose provisoire (sans entrée
// datée) arrive comme ('cancel', [ticketProvisoire]) : à l'émetteur de la retirer.
import { COMMANDS, PLACEMENTS, PRIORITIES, STEP } from '../core/game.js';

const NONE = Object.freeze([]);
const clamp01 = (k) => (k > 0 ? (k < 1 ? k : 1) : 0);

// Case visée par une pose (lanterne, pierre, mur déplacé).
export function tileOfCommand(op, args) {
  if (op === 'placeTower' || op === 'setRally') return { c: args[1], r: args[2] };
  if (op === 'placeStone') return { c: args[0], r: args[1] };
  return null;
}

export class Commands {
  constructor() {
    this.h = { game: () => null, provisional: () => null, hidden: () => null, sent: () => null };
    this.sender = null;
  }

  // h : { game() → partie en cours, provisional() → state.provisional,
  //       hidden() → identifiants des commandes en file dont l'annulation est partie,
  //       sent() → commandes de l'invité envoyées à l'hôte, pas encore datées }
  bind(h) {
    Object.assign(this.h, h);
  }

  get game() {
    return this.h.game();
  }

  // Remplace l'émetteur (null : retour à game.issue, le solo).
  setSender(fn) {
    this.sender = typeof fn === 'function' ? fn : null;
  }

  // Envoie la commande `op` du joueur local. Renvoie le ticket, ou null si elle est
  // refusée (mêmes règles que check).
  issue(op, ...args) {
    const g = this.game;
    if (!g || COMMANDS[op] == null) return null;
    const a = args.slice(0, COMMANDS[op]);
    if (!this.check(op, ...a).ok) return null;
    if (this.sender) return this.sender(op, a, g) ?? null;
    return g.issue(op, a, g.localPlayer);
  }

  // Annule une pose : en construction, rien n'est payé ; juste après, l'or est rendu
  // (commande 'cancel' [entry.id], voir game.cancelEntry).
  cancel(ticket) {
    if (!ticket) return null;
    const e = this.entryOf(ticket);
    if (e) return this.issue('cancel', e.id);
    // pose sans entrée datée (provisoire) : l'émetteur réseau s'en charge
    if (this.sender && this.check('cancel').ok) return this.sender('cancel', [ticket], this.game) ?? null;
    return null;
  }

  // La commande serait-elle acceptée maintenant ? game.canIssue (file comprise : socle
  // « en construction », or réservé, défi) puis les poses provisoires.
  // Refus : { ok: false, reason, owner? (joueur dont la pose occupe la case), element? }.
  check(op, ...args) {
    const g = this.game;
    if (!g || COMMANDS[op] == null) return { ok: false, reason: 'unknown' };
    const pid = g.localPlayer;
    const prov = this.provisional();
    // lanterne déjà en route vers une fusion ou une vente (délai des commandes)
    if ((op === 'fuse' && (this.towerBusy(args[0]) || this.towerBusy(args[1]))) || (op === 'sellTower' && this.towerBusy(args[0]))) return { ok: false, reason: 'busy' };
    // Rembobinage déjà demandé (invité : envoyé, pas encore daté par l'hôte)
    if (op === 'rewind' && this.pending('rewind')) return { ok: false, reason: 'rewind' };
    if (op === 'placeTower' || op === 'placeStone') {
      const at = tileOfCommand(op, args);
      const p = prov.find((x) => x.op === op && sameTile(tileOfCommand(x.op, x.args), at));
      if (p) return { ok: false, reason: 'pending', owner: p.pid };
    }
    const res = g.canIssue(op, args, pid);
    if (!res.ok) {
      // case déjà réservée par une pose en file : de qui ?
      if (res.reason === 'pending' && res.owner == null) {
        const b = this.buildAt(tileOfCommand(op, args)?.c, tileOfCommand(op, args)?.r, op);
        if (b) return { ...res, owner: b.pid };
      }
      return res;
    }
    if (!prov.length) return res;
    // les poses provisoires du joueur promettent aussi de l'or (et des pierres, des poses)
    const mine = prov.filter((x) => x.pid === pid);
    if (op === 'placeTower') {
      const max = g.challengeRule?.maxTowers;
      const queued = g.pendingPlacements().filter((e) => e.op === 'placeTower').length;
      if (max != null && g.stats.towersBuilt + queued + prov.filter((x) => x.op === 'placeTower').length >= max) return { ok: false, reason: 'challenge' };
      if (mine.length && this.spendable(pid) < (g.defs.towers[args[0]]?.cost ?? 0)) return { ok: false, reason: 'gold' };
    } else if (op === 'placeStone') {
      if (this.stonesLeft() <= 0) return { ok: false, reason: 'limit' };
      if (mine.length && this.spendable(pid) < g.stoneCost()) return { ok: false, reason: 'gold' };
    }
    return res;
  }

  // Or qui manque pour une pose (lanterne `type`, ou pierre si type = 'stone').
  missing(type) {
    const g = this.game;
    if (!g) return 0;
    const cost = type === 'stone' ? g.stoneCost() : g.defs.towers[type]?.cost ?? 0;
    return Math.max(1, Math.ceil(cost - this.spendable()));
  }

  // ───────────── poses provisoires et constructions ─────────────

  // Poses provisoires encore sans date (une fois datées, elles sont dans la file).
  provisional() {
    const list = this.h.provisional?.();
    if (!Array.isArray(list) || !list.length) return NONE;
    return list.filter((p) => p && !p.entry && PLACEMENTS.has(p.op) && Array.isArray(p.args));
  }

  // Commande en file déjà annulée par le joueur (l'annulation attend son image) ?
  hiddenEntry(e) {
    const set = this.h.hidden?.();
    return !!(set && e && set.has(e.id));
  }

  // Entrée de la file d'un ticket (null : pose encore provisoire).
  entryOf(ticket) {
    if (!ticket) return null;
    if (ticket.entry) return ticket.entry;
    return ticket.frame != null && ticket.id != null ? ticket : null;
  }

  // Où en est une commande ? 'building' (en construction : en file, ou provisoire),
  // 'built' (exécutée avec succès : entry.result), 'gone' (annulée, refusée, perdue).
  status(ticket) {
    const g = this.game;
    if (!g || !ticket) return 'gone';
    const e = this.entryOf(ticket);
    if (!e) {
      if (this.provisional().includes(ticket)) return moot(g, ticket) ? 'gone' : 'building';
      return ticket.done && ticket.ok ? 'built' : 'gone';
    }
    if (e.cancelled) return 'gone';
    if (!e.done) return g.queue.includes(e) && !this.hiddenEntry(e) && !moot(g, e) ? 'building' : 'gone';
    return e.ok ? 'built' : 'gone';
  }

  // Avancement (0 → 1) de la construction d'un ticket.
  progress(ticket) {
    const g = this.game;
    if (!g || !ticket) return 1;
    const e = this.entryOf(ticket);
    if (e) return e.done ? 1 : g.progressOf(e);
    return clamp01((g.frame - (ticket.born ?? g.frame)) / Math.max(1, g.buildFrames()));
  }

  // Constructions en cours, tous joueurs : file du moteur puis poses provisoires.
  // { op, args, pid, k (0 → 1), left (s), c, r, type, towerId, mine, entry, ticket }
  // Rien après la fin de la partie (la file ne s'exécute plus), ni pour un mur dont le
  // Gardien n'existe plus (vendu, fusionné, effacé par le Rembobinage).
  builds() {
    const g = this.game;
    if (!g || g.state === 'won' || g.state === 'lost') return NONE;
    const out = [];
    for (const e of g.pendingPlacements()) if (!this.hiddenEntry(e) && !moot(g, e)) out.push(this.describe(g, e, e, g.progressOf(e)));
    for (const p of this.provisional()) if (!moot(g, p)) out.push(this.describe(g, p, null, this.progress(p)));
    return out;
  }

  describe(g, src, entry, k) {
    const { op, args, pid } = src;
    const at = tileOfCommand(op, args) || { c: null, r: null };
    const span = entry ? (entry.frame - entry.issued) * STEP : g.rules.buildTime ?? 2;
    return {
      op,
      args,
      pid,
      k,
      left: Math.max(0, span * (1 - k)),
      c: at.c,
      r: at.r,
      type: op === 'placeTower' ? args[0] : null,
      towerId: op === 'setRally' ? args[0] : null,
      mine: pid === g.localPlayer,
      entry,
      ticket: src,
    };
  }

  // Construction (lanterne ou pierre ; `op` pour préciser) sur la case (c, r).
  buildAt(c, r, op = null) {
    if (c == null || r == null) return null;
    for (const b of this.builds()) {
      if (b.op === 'setRally' || (op && b.op !== op)) continue;
      if (b.c === c && b.r === r) return b;
    }
    return null;
  }

  // Pierres encore disponibles, celles en construction déduites.
  stonesLeft() {
    const g = this.game;
    if (!g?.stoneConf?.()) return 0;
    let n = g.stonesLeft();
    for (const b of this.builds()) if (b.op === 'placeStone') n--;
    return Math.max(0, n);
  }

  // ───────────── or ─────────────

  // Or promis aux constructions du joueur (file et poses provisoires).
  reserved(pid = this.game?.localPlayer ?? 0) {
    const g = this.game;
    if (!g || g.state === 'won' || g.state === 'lost') return 0;
    let n = g.reservedGold(pid);
    // (commandes dont l'annulation est partie : leur or est déjà rendu à l'affichage)
    if (this.h.hidden?.()?.size) {
      for (const e of g.pendingPlacements(pid)) {
        if (!this.hiddenEntry(e)) continue;
        n -= e.op === 'placeTower' ? g.defs.towers[e.args[0]]?.cost ?? 0 : e.op === 'placeStone' ? g.stoneCost() : 0;
      }
    }
    for (const p of this.provisional()) {
      if (p.pid !== pid) continue;
      if (p.op === 'placeTower') n += g.defs.towers[p.args[0]]?.cost ?? 0;
      else if (p.op === 'placeStone') n += g.stoneCost();
    }
    return n;
  }

  // Or disponible pour une nouvelle pose.
  spendable(pid = this.game?.localPlayer ?? 0) {
    const g = this.game;
    if (!g) return 0;
    return g.goldOf(pid) - this.reserved(pid);
  }

  // ───────────── réglages en attente ─────────────

  // Priorité de ciblage telle qu'elle sera : la dernière commande en attente pour
  // cette lanterne (délai réseau ; invité : celles envoyées, pas encore datées,
  // comprises), sinon la sienne.
  priorityOf(t) {
    const g = this.game;
    if (!g || !t) return t?.priority;
    let p = t.priority;
    for (const e of [...g.queue, ...(this.h.sent?.() || [])]) {
      if (e.cancelled || e.args?.[0] !== t.id) continue;
      if (e.op === 'setPriority') p = e.args[1];
      else if (e.op === 'cyclePriority') p = PRIORITIES[(PRIORITIES.indexOf(p) + 1) % PRIORITIES.length];
    }
    return p;
  }

  // ───────────── fusions et ventes en route ─────────────
  //
  // En coopération, une fusion ou une vente s'exécute 0,75 à 1,5 s après le geste
  // (délai des commandes, réseau). Sans rien pour le dire, la lanterne glissée revenait
  // à sa place comme si la fusion avait échoué, et l'on pouvait la revendre ou la
  // refusionner (la seconde commande échouait en silence). Seul, elles sont immédiates.

  // Lanternes du joueur visées par une fusion ou une vente en route :
  // id → { op: 'fuse' (source) | 'fuseInto' (cible) | 'sellTower', k (0 → 1), dst?, src? }.
  towerOps() {
    const g = this.game;
    const out = new Map();
    if (!g) return out;
    const add = (op, args, k) => {
      if (op === 'fuse') {
        out.set(args[0], { op, k, dst: args[1] });
        if (!out.has(args[1])) out.set(args[1], { op: 'fuseInto', k, src: args[0] });
      } else if (op === 'sellTower') out.set(args[0], { op, k });
    };
    for (const e of g.queue) if (!e.cancelled && e.pid === g.localPlayer && (e.op === 'fuse' || e.op === 'sellTower')) add(e.op, e.args, g.progressOf(e));
    for (const t of this.h.sent?.() || []) if (t.op === 'fuse' || t.op === 'sellTower') add(t.op, t.args, 0);
    return out;
  }

  towerBusy(id) {
    return id != null && this.towerOps().has(id);
  }

  // Une commande `op` est-elle en route (en file, ou envoyée par l'invité et pas encore
  // datée) ? Tous joueurs : un Rembobinage demandé par un coéquipier compte aussi.
  pending(op) {
    const g = this.game;
    if (!g) return false;
    return g.queue.some((e) => e.op === op && !e.cancelled) || (this.h.sent?.() || []).some((t) => t.op === op);
  }
}

// Commande devenue sans objet, qui échouera à son image : partie finie, ou mur d'un
// Gardien qui n'existe plus. Elle ne se dessine plus « en construction ».
function moot(g, e) {
  if (g.state === 'won' || g.state === 'lost') return true;
  return e.op === 'setRally' && !g.towerById(e.args?.[0]);
}

function sameTile(a, b) {
  return !!a && !!b && a.c === b.c && a.r === b.r;
}

// L'instance de l'interface (branchée par main.js : bind, setSender).
export const commands = new Commands();
