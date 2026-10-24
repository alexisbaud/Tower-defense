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
const PROTOCOL = 5; // 5 : messages des invités signés, connexion identifiée (« bye »), fin de partie liée à sa partie (gid)
const ELEMENTS = ['fire', 'water', 'wind', 'earth'];

export function randomCode(rand = Math.random) {
  let s = '';
  for (let k = 0; k < 4; k++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}

// Une autre action (héberger, rejoindre ailleurs, quitter) a pris la main pendant
// une connexion en cours : celle-ci s'efface sans toucher au salon courant.
function cancelled() {
  const e = new Error('annulé');
  e.cancelled = true;
  return e;
}

const randomId = () => Math.random().toString(36).slice(2, 10);

// ───────── messages signés (invité → hôte) ─────────
// Le relais est public : n'importe qui peut lire les identifiants des joueurs (salon
// diffusé) et publier sur le sujet d'un salon. Chaque invité a donc une paire de clés
// ECDSA (P-256, gardée le temps de l'onglet) : son « hello » annonce la clé publique,
// l'hôte la retient pour cet identifiant, et tout message suivant (choix d'élément,
// nom, commande, départ) doit être signé par elle. Un tiers ne peut plus vendre les
// lanternes d'un joueur, le faire sortir du salon ni rejouer ses messages (compteur).
// (Sans WebCrypto — page hors contexte sécurisé —, les messages partent non signés.)
const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIG = { name: 'ECDSA', hash: 'SHA-256' };
const utf8 = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const subtle = () => globalThis.crypto?.subtle ?? null;

// Clé publique transmise : coordonnées x.y (JWK, base64url).
async function importPublic(pk) {
  const [x, y] = String(pk).split('.');
  return subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x, y, ext: true }, ALG, false, ['verify']);
}

async function verifySealed(key, env) {
  if (typeof env.sig !== 'string' || env.sig.length > 200) return false;
  try {
    return await subtle().verify(SIG, key, fromB64(env.sig), utf8.encode(env.d));
  } catch {
    return false;
  }
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
  constructor({ id, name, brokers = BROKERS, connect = connectAny, keyStore = null } = {}) {
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
    this.gen = 0; // génération : chaque départ (leave) rend caduques les connexions en cours
    this.conn = null; // invité : identifiant de la connexion actuelle (son « bye » la cite)
    this.byeMsg = null; // invité : « bye » signé de cette connexion (aussi message de départ du relais)
    this.gameId = null; // invité : graine de la partie annoncée par l'hôte (sa fin la cite)
    this.helloAt = 0;
    this.keyStore = keyStore; // { load(), save(v) } : clés gardées (rechargement de l'onglet)
    this.keysP = null;
    this.n = 0; // compteur des messages signés (croissant, même après un rechargement)
    this.outbox = Promise.resolve(); // signatures dans l'ordre d'envoi
    this.inbox = Promise.resolve(); // hôte : vérifications dans l'ordre d'arrivée
    this.peers = new Map(); // hôte : id → { pk, key, conn, n } (jamais diffusé dans le salon)
  }

  // Paire de clés de l'invité (créée une fois, gardée par keyStore), ou null sans WebCrypto.
  identityKeys() {
    this.keysP ||= (async () => {
      if (!subtle()) return null;
      try {
        const saved = this.keyStore?.load?.();
        if (saved?.priv && typeof saved.pub === 'string') return { priv: await subtle().importKey('jwk', saved.priv, ALG, false, ['sign']), pub: saved.pub };
        const pair = await subtle().generateKey(ALG, true, ['sign', 'verify']);
        const jwk = await subtle().exportKey('jwk', pair.publicKey);
        const pub = `${jwk.x}.${jwk.y}`;
        this.keyStore?.save?.({ priv: await subtle().exportKey('jwk', pair.privateKey), pub });
        return { priv: pair.privateKey, pub };
      } catch {
        return null;
      }
    })();
    return this.keysP;
  }

  // Enveloppe signée d'un message pour l'hôte : { type: 'sig', id, d: JSON, sig }.
  async seal(msg) {
    const keys = await this.identityKeys();
    // compteur croissant d'un message à l'autre (et d'un chargement de la page à l'autre)
    this.n = Math.max(this.n + 1, Date.now() * 1000);
    const d = JSON.stringify({ ...msg, id: this.id, n: this.n, ...(msg.type === 'hello' ? { pk: keys?.pub ?? null } : {}) });
    const env = { type: 'sig', id: this.id, d };
    if (keys) env.sig = toB64(await subtle().sign(SIG, keys.priv, utf8.encode(d)));
    return env;
  }

  // Envoie un message signé à l'hôte, sur la connexion courante (dans l'ordre).
  sendSealed(msg) {
    const client = this.client;
    const topic = this.topic('c');
    this.outbox = this.outbox
      .then(async () => {
        const env = await this.seal(msg);
        if (this.client === client && client?.connected) client.publish(topic, JSON.stringify(env));
      })
      .catch((e) => console.error(e));
    return this.outbox;
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
    const gen = this.gen;
    this.role = 'host';
    this.peers = new Map();
    this.inbox = Promise.resolve();
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
      // salon quitté (ou recréé, même code) pendant la connexion : elle ne sert plus
      if (this.gen !== gen) {
        client.close();
        return;
      }
      this.attach(client);
      await client.subscribe(this.topic('c', code));
      if (this.gen !== gen) return;
      this.setState('online');
      this.broadcastLobby();
    } catch (e) {
      if (this.gen === gen) this.setState('offline', e.message);
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
    const gen = this.gen;
    this.setState('connecting');
    try {
      const client = await this.connectFn(this.brokers, {
        will: { topic: this.topic('h', code), payload: JSON.stringify({ type: 'hostGone', code }) },
      });
      if (this.gen !== gen || this.code !== code || this.role !== 'host' || this.client) {
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

  // Retire les joueurs partis pendant la partie (restés « absents ») : hors partie, ou
  // quand l'hôte en relance une (`force` : « Recommencer pour tous ») — les absents ne
  // sont plus du voyage, leurs éléments reviennent aux autres.
  prune(force = false) {
    if (!this.isHost || (this.inGame && !force) || !this.lobby) return;
    const before = this.lobby.players.length;
    this.lobby.players = this.lobby.players.filter((p, i) => i === 0 || p.online !== false);
    if (this.lobby.players.length !== before) this.broadcastLobby();
  }

  // Choix d'élément : un élément par joueur au plus (null = aucun choix).
  pickElement(element) {
    if (this.isHost) this.assignElement(this.id, element);
    else this.sendSealed({ type: 'pick', conn: this.conn, element });
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
    } else this.sendSealed({ type: 'name', conn: this.conn, name: this.name });
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
    this.lobby.gid = seed; // partie en cours : un invité resté sur une autre partie s'en aperçoit
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
    const gid = this.lastStart?.seed ?? null; // la partie qui se termine
    this.inGame = false;
    this.lastStart = null;
    this.lobby.gid = null;
    this.send('h', { type: 'end', result, gid });
    this.broadcastLobby();
  }

  // Message d'un invité. Le relais est public : seule compte l'enveloppe signée
  // (voir seal) ; un « hello » d'une autre version reçoit simplement un refus.
  onHostMessage(env) {
    // identifiant de joueur : une courte chaîne
    if (typeof env.id !== 'string' || !env.id || env.id.length > 32) return;
    if (env.type === 'hello' && env.v !== PROTOCOL) {
      this.send('h', { type: 'refuse', id: env.id, reason: 'version' });
      return;
    }
    if (env.type !== 'sig' || typeof env.d !== 'string' || env.d.length > 4096) return;
    // vérifications asynchrones (WebCrypto), traitées dans l'ordre d'arrivée
    const gen = this.gen;
    this.inbox = this.inbox.then(() => this.gen === gen && this.openSealed(env, gen)).catch((e) => console.error(e));
  }

  async openSealed(env, gen = this.gen) {
    let msg;
    try {
      msg = JSON.parse(env.d);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || msg.id !== env.id || !Number.isFinite(msg.n) || !this.isHost) return;
    const peer = this.peers.get(env.id);
    if (msg.type === 'hello') {
      if (msg.v !== PROTOCOL) return this.send('h', { type: 'refuse', id: env.id, reason: 'version' });
      // la clé annoncée doit signer ce message ; un joueur déjà connu garde la sienne
      // (un tiers qui reprend son identifiant est ignoré), et un ancien « hello » rejoué
      // (compteur dépassé) aussi
      const pk = typeof msg.pk === 'string' && msg.pk.length < 200 ? msg.pk : null;
      if (peer && ((peer.pk && pk !== peer.pk) || msg.n <= peer.n)) return;
      let key = peer?.key ?? null;
      // hôte sans WebCrypto (page hors contexte sécurisé) : il accepte sans vérifier
      if (pk && subtle()) {
        try {
          key ||= await importPublic(pk);
        } catch {
          return;
        }
        if (!(await verifySealed(key, env))) return;
      }
      // (salon recréé pendant la vérification : ce message visait l'ancien)
      if (!this.isHost || this.gen !== gen) return;
      this.welcome(msg, { pk, key, conn: typeof msg.conn === 'string' ? msg.conn.slice(0, 16) : null, n: msg.n });
      return;
    }
    // autres messages : un joueur connu, sa signature, sa connexion actuelle, un compteur neuf
    if (!peer || (peer.key && !(await verifySealed(peer.key, env)))) return;
    if (msg.conn !== peer.conn) return; // (« bye » d'une connexion morte depuis, publié par le relais)
    if (msg.type !== 'bye') {
      if (msg.n <= peer.n) return; // message rejoué
      peer.n = msg.n;
    }
    if (this.isHost && this.gen === gen) this.onGuest(msg);
  }

  // « hello » vérifié : arrivée (ou retour) d'un joueur.
  welcome(msg, peer) {
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
    // connexion actuelle et clé du joueur (gardées par l'hôte seul : le salon est diffusé)
    this.peers.set(msg.id, peer);
    p.online = true;
    this.broadcastLobby();
    // retour d'un joueur en pleine partie : on lui renvoie le départ
    if (this.inGame && this.lastStart) this.send('h', { ...this.lastStart, rejoin: msg.id });
    this.emit('join', p);
  }

  // Message vérifié d'un joueur du salon.
  onGuest(msg) {
    if (msg.type === 'pick') {
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
      const peer = this.peers.get(msg.id);
      if (peer) peer.conn = null; // connexion terminée : plus rien n'arrive d'elle
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
    // Recherche annulée (« Quitter ce salon », autre code, salon recréé) : chaque étape
    // vérifie qu'elle a toujours la main, sans quoi elle fermerait le nouveau salon.
    const gen = this.gen;
    const current = () => this.gen === gen;
    this.role = 'guest';
    this.code = code;
    this.setState('connecting');
    let lastErr = new Error('salon introuvable');
    for (let k = 0; k < this.brokers.length; k++) {
      let client;
      // identifiant de cette connexion, et son « bye » signé : message de départ (will)
      // publié par le relais si elle meurt, et adieu explicite (leave) ; il ne vise qu'elle
      const conn = randomId();
      const bye = JSON.stringify(await this.seal({ type: 'bye', conn }));
      if (!current()) throw cancelled();
      try {
        client = await this.connectFn(this.brokers, { will: { topic: this.topic('c', code), payload: bye } }, k);
      } catch (e) {
        if (!current()) throw cancelled();
        lastErr = e;
        break;
      }
      k = client.brokerIndex ?? k;
      if (!current()) {
        client.close();
        throw cancelled();
      }
      this.attach(client);
      this.conn = conn;
      this.byeMsg = bye;
      try {
        await client.subscribe(this.topic('h', code));
        if (!current()) throw cancelled();
        const res = await this.waitFor(
          (m) => (m.type === 'lobby' && m.lobby?.players?.some((p) => p.id === this.id)) || (m.type === 'refuse' && m.id === this.id),
          timeoutMs,
          () => this.sendSealed({ type: 'hello', name: this.name, v: PROTOCOL, conn }),
          current,
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
        // la recherche a perdu la main : le client courant n'est plus le sien
        if (e.cancelled || !current()) throw cancelled();
        lastErr = e;
        if (['full', 'version', 'inGame'].includes(e.message)) throw e;
        this.detach();
      }
    }
    this.role = null;
    this.setState('offline', lastErr.message);
    throw lastErr;
  }

  // Attend un message de l'hôte (en relançant `ping` chaque seconde) ; s'arrête dès
  // que `alive()` devient faux (recherche annulée : plus de « hello » vers ce salon).
  waitFor(pred, timeoutMs, ping, alive = () => true) {
    return new Promise((resolve, reject) => {
      const stop = () => {
        clearInterval(iv);
        clearTimeout(to);
        off();
      };
      const off = this.on('_msg', (m) => {
        if (!alive() || !pred(m)) return;
        stop();
        resolve(m);
      });
      ping();
      const iv = setInterval(() => {
        if (alive()) ping();
        else {
          stop();
          reject(cancelled());
        }
      }, 1000);
      const to = setTimeout(() => {
        stop();
        reject(alive() ? new Error('salon introuvable') : cancelled());
      }, timeoutMs);
    });
  }

  sendCommand(op, args) {
    this.sendSealed({ type: 'cmd', conn: this.conn, op, args });
  }

  onGuestMessage(msg) {
    this.lastHostMsg = Date.now();
    if (msg.type === 'lobby') {
      if (!msg.lobby || !Array.isArray(msg.lobby.players)) return;
      this.lobby = msg.lobby;
      this.inGame = !!msg.lobby.inGame;
      // l'hôte ne nous compte plus (ou nous croit absent) alors que nous sommes là :
      // on se représente (« bye » d'une ancienne connexion, coupure mal comprise)
      const me = msg.lobby.players.find((p) => p.id === this.id);
      if (this.online && (!me || me.online === false) && Date.now() - this.helloAt > 2000) {
        this.helloAt = Date.now();
        this.sendSealed({ type: 'hello', name: this.name, v: PROTOCOL, conn: this.conn });
      }
      this.emit('lobby', this.lobby);
    } else if (msg.type === 'start') {
      if (msg.rejoin && msg.rejoin !== this.id) return;
      const you = Array.isArray(msg.ids) ? msg.ids.indexOf(this.id) : -1;
      if (you < 0) return;
      this.inGame = true;
      this.gameId = msg.seed;
      this.emit('start', { ...msg, you });
    } else if (msg.type === 'snap') this.emit('snap', msg);
    else if (msg.type === 'paused') this.emit('paused', msg);
    else if (msg.type === 'end') {
      // seule la fin de la partie annoncée compte (pas un message égaré ou forgé)
      if (msg.gid == null || msg.gid !== this.gameId) return;
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
      if (this.role === 'guest' && this.byeMsg) this.client.publish(this.topic('c'), this.byeMsg);
      if (this.role === 'host') this.send('h', { type: 'hostGone', code: this.code, final: true });
    }
    this.gen++; // les connexions en cours (host, join) ne serviront plus
    this.detach();
    this.role = null;
    this.code = null;
    this.conn = null;
    this.byeMsg = null;
    this.gameId = null;
    this.inGame = false;
    this.lobby = null;
    if (!silent) this.setState('offline');
  }
}
