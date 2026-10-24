// Salons multijoueurs sans compte : un code de 4 lettres, un relais MQTT public.
//
// À l'ouverture du jeu, chacun héberge automatiquement son propre salon (le code
// s'affiche à l'accueil) : on peut jouer seul tout de suite ou partager le code.
// Rejoindre un autre salon ferme le sien. L'hôte (joueur 1) fait tourner la partie.
//
// Sujets : jde/v1/<CODE>/h  hôte → invités (salon, départ, états de partie)
//          jde/v1/<CODE>/c  invités → hôte (arrivée, choix d'élément, commandes)

import { BROKERS, connectAny } from './mqtt.js';

export const MAX_PLAYERS = 4;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sans I ni O : pas de confusion avec 1 et 0
const NS = 'jde/v1';
const PROTOCOL = 4; // 4 : états avec heure d’envoi (tampon de lecture), événements compacts
const ELEMENTS = ['fire', 'water', 'wind', 'earth'];

export function randomCode(rand = Math.random) {
  let s = '';
  for (let k = 0; k < 4; k++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}

export function normalizeCode(text) {
  const s = String(text || '')
    .toUpperCase()
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/[^A-Z]/g, '');
  return s.length === 4 && [...s].every((ch) => ALPHABET.includes(ch)) ? s : null;
}

/**
 * Événements (session.on(type, fn)) :
 *   status  { state: 'offline'|'connecting'|'online', role, code, error }
 *   lobby   état du salon (joueurs, niveau, options)
 *   start   départ d'une partie { level, seed, players, you, hard, challenge }
 *   snap    état de partie (invités)
 *   command { pid, op, args } (hôte)
 *   paused  { on } (invités)
 *   end     retour au salon
 *   closed  { reason } salon fermé : 'hostGone' (l'hôte est parti), 'hostLost' (connexion
 *           de l'hôte coupée sans au revoir : il peut revenir), 'lost' (notre connexion)
 */
export class NetSession {
  constructor({ id, name, brokers = BROKERS, connect = connectAny } = {}) {
    this.id = id || `p${Math.random().toString(36).slice(2, 10)}`;
    this.name = name || 'Esprit';
    this.brokers = brokers;
    this.connectFn = connect;
    this.client = null;
    this.role = null; // 'host' | 'guest'
    this.code = null;
    this.state = 'offline';
    this.handlers = {};
    this.lobby = null;
    this.inGame = false;
    this.lastStart = null;
    this.lastHostMsg = 0;
  }

  on(type, fn) {
    (this.handlers[type] ||= []).push(fn);
    return () => (this.handlers[type] = this.handlers[type].filter((f) => f !== fn));
  }

  emit(type, data) {
    for (const fn of this.handlers[type] || []) {
      try {
        fn(data);
      } catch (e) {
        console.error(e);
      }
    }
  }

  setState(state, error = null) {
    this.state = state;
    this.emit('status', { state, role: this.role, code: this.code, error });
  }

  topic(kind, code = this.code) {
    return `${NS}/${code}/${kind}`;
  }

  get isHost() {
    return this.role === 'host';
  }

  get online() {
    return this.state === 'online';
  }

  // Index du joueur local dans la partie (0 = hôte).
  get you() {
    return this.lobby ? Math.max(0, this.lobby.players.findIndex((p) => p.id === this.id)) : 0;
  }

  send(kind, msg) {
    if (!this.client?.connected) return false;
    this.client.publish(this.topic(kind), JSON.stringify(msg));
    return true;
  }

  // ───────────────────────── hôte ─────────────────────────

  // Crée (ou recrée) son propre salon. Sans réseau, le salon reste local : on peut jouer seul.
  async host({ code = randomCode(), element = null, level = null } = {}) {
    await this.leave(true);
    this.role = 'host';
    this.code = code;
    this.lobby = {
      code,
      host: this.id,
      players: [{ id: this.id, name: this.name, element, online: true }],
      level,
      hard: false,
      challenge: false,
      inGame: false,
    };
    this.emit('lobby', this.lobby);
    this.setState('connecting');
    try {
      const client = await this.connectFn(this.brokers, {
        will: { topic: this.topic('h', code), payload: JSON.stringify({ type: 'hostGone', code }) },
      });
      if (this.code !== code || this.role !== 'host') {
        client.close();
        return;
      }
      this.attach(client);
      await client.subscribe(this.topic('c', code));
      this.setState('online');
      this.broadcastLobby();
    } catch (e) {
      if (this.code === code) this.setState('offline', e.message);
    }
  }

  broadcastLobby() {
    if (!this.isHost) return;
    this.lobby.inGame = this.inGame;
    this.send('h', { type: 'lobby', lobby: this.lobby });
    this.emit('lobby', this.lobby);
  }

  // Reconnexion après une coupure du relais, sans perdre le salon (hôte : mêmes
  // code et joueurs ; les invités, toujours abonnés, retrouvent les états) ni sa
  // place (invité : l'hôte le reconnaît à son id et lui renvoie le départ).
  async reconnect() {
    if (this.role === 'guest' && this.code) {
      try {
        return await this.join(this.code);
      } catch {
        return false;
      }
    }
    if (this.role !== 'host' || !this.code || this.client) return this.online;
    const code = this.code;
    this.setState('connecting');
    try {
      const client = await this.connectFn(this.brokers, {
        will: { topic: this.topic('h', code), payload: JSON.stringify({ type: 'hostGone', code }) },
      });
      if (this.code !== code || this.role !== 'host' || this.client) {
        client.close();
        return this.online;
      }
      this.attach(client);
      await client.subscribe(this.topic('c', code));
      this.setState('online');
      this.broadcastLobby();
      return true;
    } catch (e) {
      if (this.code === code && this.role === 'host' && !this.client) this.setState('offline', e.message);
      return false;
    }
  }

  // Hors partie : retire les joueurs partis pendant la partie (restés « absents »).
  prune() {
    if (!this.isHost || this.inGame || !this.lobby) return;
    const before = this.lobby.players.length;
    this.lobby.players = this.lobby.players.filter((p, i) => i === 0 || p.online !== false);
    if (this.lobby.players.length !== before) this.broadcastLobby();
  }

  // Choix d'élément : un élément par joueur au plus (null = aucun choix).
  pickElement(element) {
    if (this.isHost) this.assignElement(this.id, element);
    else this.send('c', { type: 'pick', id: this.id, element });
  }

  assignElement(id, element) {
    const p = this.lobby.players.find((x) => x.id === id);
    if (!p || this.inGame) return false;
    if (element && !ELEMENTS.includes(element)) return false;
    if (element && this.lobby.players.some((x) => x !== p && x.element === element)) return false;
    p.element = element;
    this.broadcastLobby();
    return true;
  }

  setName(name) {
    this.name = String(name || '').slice(0, 16) || 'Esprit';
    if (this.isHost) {
      const p = this.lobby?.players[0];
      if (p) p.name = this.name;
      this.broadcastLobby();
    } else this.send('c', { type: 'name', id: this.id, name: this.name });
  }

  setOptions(opts) {
    if (!this.isHost) return;
    Object.assign(this.lobby, opts);
    this.broadcastLobby();
  }

  // Lance la partie pour tout le salon. `players` : [{ name, elements }] dans l'ordre du salon.
  startGame({ level, seed, players, hard = false, challenge = false }) {
    if (!this.isHost) return null;
    this.inGame = true;
    this.lobby.level = level;
    const msg = { type: 'start', level, seed, players, ids: this.lobby.players.map((p) => p.id), hard, challenge };
    this.lastStart = msg;
    this.lobby.solo = null;
    this.broadcastLobby();
    this.send('h', msg);
    return msg;
  }

  broadcastSnapshot(snap) {
    if (this.isHost && this.lobby.players.length > 1) this.send('h', snap);
  }

  setPaused(on) {
    this.send('h', { type: 'paused', on: !!on });
  }

  endGame(result = null) {
    if (!this.isHost) return;
    this.inGame = false;
    this.lastStart = null;
    this.send('h', { type: 'end', result });
    this.broadcastLobby();
  }

  onHostMessage(msg) {
    if (msg.type === 'hello') {
      if (msg.v !== PROTOCOL) {
        this.send('h', { type: 'refuse', id: msg.id, reason: 'version' });
        return;
      }
      let p = this.lobby.players.find((x) => x.id === msg.id);
      if (!p) {
        if (this.lobby.players.length >= MAX_PLAYERS) {
          this.send('h', { type: 'refuse', id: msg.id, reason: 'full' });
          return;
        }
        if (this.inGame) {
          this.send('h', { type: 'refuse', id: msg.id, reason: 'inGame' });
          return;
        }
        const free = ELEMENTS.find((el) => !this.lobby.players.some((x) => x.element === el)) ?? null;
        p = { id: msg.id, name: String(msg.name || 'Esprit').slice(0, 16), element: free, online: true };
        this.lobby.players.push(p);
      }
      p.online = true;
      this.broadcastLobby();
      // retour d'un joueur en pleine partie : on lui renvoie le départ
      if (this.inGame && this.lastStart) this.send('h', { ...this.lastStart, rejoin: msg.id });
      this.emit('join', p);
    } else if (msg.type === 'pick') {
      if (!this.assignElement(msg.id, msg.element)) this.broadcastLobby();
    } else if (msg.type === 'name') {
      const p = this.lobby.players.find((x) => x.id === msg.id);
      if (p) {
        p.name = String(msg.name || '').slice(0, 16) || 'Esprit';
        this.broadcastLobby();
      }
    } else if (msg.type === 'bye') {
      const i = this.lobby.players.findIndex((x) => x.id === msg.id);
      if (i <= 0) return;
      if (this.inGame) this.lobby.players[i].online = false; // ses lanternes restent en jeu
      else this.lobby.players.splice(i, 1);
      this.broadcastLobby();
      this.emit('leave', msg.id);
    } else if (msg.type === 'cmd') {
      const pid = this.lobby.players.findIndex((x) => x.id === msg.id);
      if (pid > 0 && this.inGame) this.emit('command', { pid, op: msg.op, args: msg.args });
    }
  }

  // ───────────────────────── invité ─────────────────────────

  // Rejoint le salon `code`. Essaie chaque relais jusqu'à obtenir une réponse de l'hôte.
  async join(code, timeoutMs = 5000) {
    code = normalizeCode(code);
    if (!code) throw new Error('code invalide');
    await this.leave(true);
    this.role = 'guest';
    this.code = code;
    this.setState('connecting');
    let lastErr = new Error('salon introuvable');
    for (let k = 0; k < this.brokers.length; k++) {
      let client;
      try {
        client = await this.connectFn(this.brokers, { will: { topic: this.topic('c', code), payload: JSON.stringify({ type: 'bye', id: this.id }) } }, k);
      } catch (e) {
        lastErr = e;
        break;
      }
      k = client.brokerIndex ?? k;
      if (this.code !== code) {
        client.close();
        return false;
      }
      this.attach(client);
      try {
        await client.subscribe(this.topic('h', code));
        const res = await this.waitFor((m) => (m.type === 'lobby' && m.lobby.players.some((p) => p.id === this.id)) || (m.type === 'refuse' && m.id === this.id), timeoutMs, () =>
          this.send('c', { type: 'hello', id: this.id, name: this.name, v: PROTOCOL }),
        );
        if (res.type === 'refuse') {
          this.detach();
          this.role = null;
          this.setState('offline', res.reason);
          throw new Error(res.reason);
        }
        this.setState('online');
        return true;
      } catch (e) {
        lastErr = e;
        if (['full', 'version', 'inGame'].includes(e.message)) throw e;
        this.detach();
      }
    }
    this.role = null;
    this.setState('offline', lastErr.message);
    throw lastErr;
  }

  // Attend un message de l'hôte (en relançant `ping` chaque seconde).
  waitFor(pred, timeoutMs, ping) {
    return new Promise((resolve, reject) => {
      const off = this.on('_msg', (m) => {
        if (!pred(m)) return;
        clearInterval(iv);
        clearTimeout(to);
        off();
        resolve(m);
      });
      ping();
      const iv = setInterval(ping, 1000);
      const to = setTimeout(() => {
        clearInterval(iv);
        off();
        reject(new Error('salon introuvable'));
      }, timeoutMs);
    });
  }

  sendCommand(op, args) {
    this.send('c', { type: 'cmd', id: this.id, op, args });
  }

  onGuestMessage(msg) {
    this.lastHostMsg = Date.now();
    if (msg.type === 'lobby') {
      this.lobby = msg.lobby;
      this.inGame = msg.lobby.inGame;
      this.emit('lobby', this.lobby);
    } else if (msg.type === 'start') {
      if (msg.rejoin && msg.rejoin !== this.id) return;
      const you = msg.ids.indexOf(this.id);
      if (you < 0) return;
      this.inGame = true;
      this.emit('start', { ...msg, you });
    } else if (msg.type === 'snap') this.emit('snap', msg);
    else if (msg.type === 'paused') this.emit('paused', msg);
    else if (msg.type === 'end') {
      this.inGame = false;
      this.emit('end', msg);
    } else if (msg.type === 'hostGone') {
      // message de départ (will) : connexion coupée, l'hôte reviendra peut-être
      this.emit('closed', { reason: msg.final ? 'hostGone' : 'hostLost' });
    }
  }

  // ───────────────────────── commun ─────────────────────────

  attach(client) {
    this.client = client;
    client.onmessage = (topic, text) => {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      this.emit('_msg', msg);
      if (this.role === 'host' && topic === this.topic('c')) this.onHostMessage(msg);
      else if (this.role === 'guest' && topic === this.topic('h')) this.onGuestMessage(msg);
    };
    client.onclose = () => {
      if (this.client !== client) return;
      this.client = null;
      this.setState('offline', 'connexion perdue');
      if (this.role === 'guest') this.emit('closed', { reason: 'lost' });
    };
  }

  detach() {
    const c = this.client;
    this.client = null;
    if (c) {
      c.onclose = null;
      c.close();
    }
  }

  // L'onglet se ferme : l'hôte prévient ses invités que c'est définitif.
  farewell() {
    if (this.role === 'host' && this.client?.connected) this.send('h', { type: 'hostGone', code: this.code, final: true });
  }

  // Quitte le salon courant (un invité prévient l'hôte ; un hôte prévient ses invités).
  async leave(silent = false) {
    if (this.client?.connected) {
      if (this.role === 'guest') this.send('c', { type: 'bye', id: this.id });
      if (this.role === 'host') this.send('h', { type: 'hostGone', code: this.code, final: true });
    }
    this.detach();
    this.role = null;
    this.code = null;
    this.inGame = false;
    this.lobby = null;
    if (!silent) this.setState('offline');
  }
}
