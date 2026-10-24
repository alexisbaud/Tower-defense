// Lien entre le salon (NetSession), la partie et la boucle principale.
//
//   Hôte   : game.update() comme en solo, puis coop.afterUpdate(dt) avant de vider
//            game.events (les événements partent aussi vers les invités).
//   Invité : coop.afterUpdate(dt) remplace game.update() : le miroir avance ses
//            effets visuels et reçoit l'état de l'hôte.

import { HostSync, ClientSync, applyCommand, makeMirror } from './sync.js';
import { assignElements } from '../core/game.js';

export class Coop {
  constructor(session) {
    this.session = session;
    this.game = null;
    this.host = null;
    this.client = null;
    this.offs = [];
    this.lastSnapAt = 0;
  }

  get active() {
    return !!(this.host || this.client);
  }

  get isGuest() {
    return !!this.client;
  }

  get isHost() {
    return !!this.host;
  }

  // Joueurs de la partie à partir du salon : chacun garde son élément, les éléments libres sont partagés.
  playersFromLobby() {
    const list = this.session.lobby?.players || [];
    const els = assignElements(list.map((p) => p.element));
    return list.map((p, i) => ({ name: p.name, elements: els[i], element: p.element }));
  }

  // Hôte : diffuse le départ et branche la partie déjà créée.
  attachHost(game, start) {
    this.stop();
    this.game = game;
    this.host = new HostSync(game, (snap) => this.session.broadcastSnapshot(snap));
    this.host.gid = start?.seed ?? null;
    this.offs.push(this.session.on('command', ({ pid, op, args }) => applyCommand(game, pid, op, args)));
    // un joueur revenu en pleine partie reçoit aussitôt un état complet
    this.offs.push(this.session.on('join', () => (this.host.forceKey = true)));
    this.start = start;
  }

  // Invité : construit le miroir de la partie annoncée par l'hôte.
  attachGuest(Game, level, defs, start) {
    this.stop();
    const mirror = makeMirror(Game, level, defs, start);
    this.game = mirror;
    this.client = new ClientSync(mirror, (op, args) => this.session.sendCommand(op, args));
    this.client.gid = start.seed ?? null;
    this.offs.push(this.session.on('snap', (snap) => {
      // seuls les états acceptés (bien formés, de cette partie) disent que l'hôte est là
      if (this.client.apply(snap)) this.lastSnapAt = performance.now();
    }));
    this.lastSnapAt = performance.now();
    this.start = start;
    return mirror;
  }

  // À appeler à chaque image, après la simulation et avant de consommer game.events.
  afterUpdate(dt) {
    if (this.host) {
      this.host.collect(this.game.events);
      this.host.tick(dt);
    } else if (this.client) this.client.tick(dt);
  }

  // Interpolation des yokai chez l'invité (0..1 entre deux états reçus).
  get alpha() {
    return this.client ? this.client.alpha : null;
  }

  // Invité sans nouvelles de l'hôte depuis plus de `ms`.
  stale(ms = 2500) {
    return !!this.client && performance.now() - this.lastSnapAt > ms;
  }

  setPaused(on) {
    if (this.host) {
      this.host.paused = !!on;
      this.host.tick(0, true);
    }
  }

  get remotePaused() {
    return !!this.client?.paused;
  }

  // Vitesse de jeu : réglée par l'hôte (×1, ×2), suivie par les invités.
  get speed() {
    return this.host ? this.host.speed : this.client ? this.client.speed : 1;
  }

  set speed(v) {
    if (this.host) this.host.speed = v;
  }

  // Force l'envoi immédiat d'un état (fin de partie, hôte en arrière-plan).
  flush() {
    if (this.host) this.host.tick(0, true);
  }

  stop() {
    for (const off of this.offs) off();
    this.offs = [];
    this.host = null;
    this.client = null;
    this.game = null;
  }
}
