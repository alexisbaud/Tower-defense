// Lien entre le salon (NetSession), la partie et la boucle principale.
//
// Chaque téléphone fait tourner sa propre partie, identique à celle des autres
// (lockstep, voir src/net/lockstep.js) :
//   Hôte   : coop.step(dt) avance la partie (pause et vitesse annoncées à tous), date
//            les commandes (les siennes et celles des invités) et bat la mesure.
//   Invité : coop.step(dt) avance sa partie au rythme de l'hôte, un peu en retard ;
//            ses commandes partent vers l'hôte, qui les date pour tous.
// Dans les deux cas, l'interface envoie ses commandes par coop.sender (émetteur de
// src/ui/commands.js).

import { HostLockstep, GuestLockstep, COMMAND_DELAY } from './lockstep.js';
import { assignElements } from '../core/game.js';

export class Coop {
  constructor(session) {
    this.session = session;
    this.game = null;
    this.net = null; // HostLockstep | GuestLockstep
    this.offs = [];
    this.provisional = () => null; // poses provisoires de l'interface (state.provisional)
    // émetteur des commandes de l'interface : fn(op, args, game) → ticket | null
    this.sender = (op, args) => (this.net ? this.net.issue(op, args) : null);
  }

  get active() {
    return !!this.net;
  }

  get isGuest() {
    return this.net instanceof GuestLockstep;
  }

  get isHost() {
    return this.net instanceof HostLockstep;
  }

  // Joueurs de la partie à partir du salon : un élément chacun (celui choisi, ou le
  // premier libre). Les éléments que personne n'a pris ne sont à personne.
  playersFromLobby() {
    const list = this.session.lobby?.players || [];
    const els = assignElements(list.map((p) => p.element));
    return list.map((p, i) => ({ name: p.name, elements: els[i], element: p.element }));
  }

  // Liste des poses provisoires de l'interface (l'invité y met ses poses envoyées,
  // pas encore datées par l'hôte).
  bindProvisional(fn) {
    this.provisional = typeof fn === 'function' ? fn : () => null;
  }

  // Hôte : branche la partie déjà créée (même graine et mêmes joueurs que le départ).
  attachHost(game, start) {
    this.stop();
    game.commandDelay = start?.cd ?? COMMAND_DELAY;
    this.game = game;
    this.net = new HostLockstep(game, { send: (msg) => this.session.broadcast(msg), gid: start?.seed ?? null });
    this.offs.push(this.session.on('command', (c) => this.net?.receive?.(c)));
    this.offs.push(this.session.on('resync', ({ pid, id }) => this.net?.requestState?.(pid, id)));
    this.start = start;
  }

  // Invité : construit sa partie, identique à celle de l'hôte. Revenu en pleine
  // partie (rechargement, coupure), il demande aussitôt l'état complet.
  attachGuest(Game, level, defs, start) {
    this.stop();
    const game = new Game(level, defs, { seed: start.seed, players: start.players, localPlayer: start.you, hard: start.hard });
    game.challenge = !!start.challenge;
    game.commandDelay = start.cd ?? COMMAND_DELAY;
    this.game = game;
    this.net = new GuestLockstep(game, {
      gid: start.seed ?? null,
      send: (op, args, meta) => this.session.sendCommand(op, args, meta),
      ask: (why) => this.session.requestState(why),
      provisional: () => this.provisional(),
      rejoin: !!start.rejoin,
    });
    this.offs.push(this.session.on('game', (msg) => this.net?.receive?.(msg)));
    this.start = start;
    return game;
  }

  // À chaque image d'affichage : avance la partie (hôte comme invité).
  step(dt) {
    return this.net ? this.net.step(dt) : 0;
  }

  // Interpolation de l'affichage entre deux pas de simulation (0..1).
  get alpha() {
    return this.net ? this.net.alpha : 1;
  }

  // La partie est arrêtée (pause atteinte, invité en attente de l'hôte).
  get halted() {
    return !!this.net?.halted;
  }

  // Invité : 'sync' (état complet attendu), 'pause' (pause de l'hôte), 'stale' (hôte
  // sans nouvelles) ou null.
  waitKind() {
    return this.isGuest ? this.net.waitKind() : null;
  }

  // Hôte : sa pause est celle de tous (annoncée, à la même image chez chacun).
  setPaused(on) {
    if (this.isHost) this.net.setPaused(on);
  }

  // Vitesse de jeu : réglée par l'hôte (×1, ×2), suivie par les invités.
  get speed() {
    return this.net ? this.net.speed : 1;
  }

  set speed(v) {
    if (this.isHost) this.net.setSpeed(v);
  }

  // Hôte : battement immédiat (fin de partie, arrière-plan).
  flush() {
    if (this.isHost) this.net.heartbeat();
  }

  // Invité : fin annoncée par l'hôte à son image `f` ; la partie s'y rend et se conclut.
  finish(f) {
    if (this.isGuest) this.net.finish(f);
  }

  // Commandes dont l'annulation est demandée (l'interface ne les montre plus).
  hiddenEntries() {
    return this.isGuest ? this.net.hidden : null;
  }

  // Invité : commandes envoyées, pas encore datées par l'hôte (fusion, vente en route).
  sentCommands() {
    return this.isGuest ? this.net.sent() : null;
  }

  stop() {
    for (const off of this.offs) off();
    this.offs = [];
    this.net = null;
    this.game = null;
  }
}
