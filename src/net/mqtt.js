// Client MQTT 3.1.1 minimal sur WebSocket (navigateur et Node ≥ 22).
// Juste ce qu'il faut au salon multijoueur : CONNECT (avec message de départ),
// SUBSCRIBE, PUBLISH en QoS 0, PING. Aucune dépendance.

const enc = new TextEncoder();
const dec = new TextDecoder();

const CONNECT = 1;
const CONNACK = 2;
const PUBLISH = 3;
const SUBSCRIBE = 8;
const SUBACK = 9;
const PINGREQ = 12;
const PINGRESP = 13;
const DISCONNECT = 14;

function str(s) {
  const b = enc.encode(s);
  const out = new Uint8Array(2 + b.length);
  out[0] = b.length >> 8;
  out[1] = b.length & 255;
  out.set(b, 2);
  return out;
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// Paquet complet : en-tête fixe (type, drapeaux, longueur restante variable) + corps.
function packet(type, flags, body) {
  const len = [];
  let n = body.length;
  do {
    let byte = n & 127;
    n >>= 7;
    if (n > 0) byte |= 128;
    len.push(byte);
  } while (n > 0);
  return concat([Uint8Array.of((type << 4) | flags, ...len), body]);
}

export class MqttClient {
  /**
   * @param {string} url  ex. wss://broker.emqx.io:8084/mqtt
   * @param {object} opts { clientId, keepalive (s), will: { topic, payload } }
   */
  constructor(url, opts = {}) {
    this.url = url;
    this.clientId = opts.clientId || `je-${Math.random().toString(36).slice(2, 10)}`;
    this.keepalive = opts.keepalive ?? 30;
    this.will = opts.will || null;
    this.ws = null;
    this.buf = new Uint8Array(0);
    this.nextPid = 1;
    this.pending = new Map(); // id de paquet → résolution du SUBACK
    this.connected = false;
    this.onmessage = null; // (topic, texte)
    this.onclose = null; // (raison)
    this.pingTimer = null;
    this.lastIn = 0;
  }

  connect(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          try {
            this.ws?.close();
          } catch {}
          reject(err);
        } else resolve(this);
      };
      const timer = setTimeout(() => done(new Error('délai de connexion dépassé')), timeoutMs);
      let ws;
      try {
        ws = new WebSocket(this.url, ['mqtt']);
      } catch (e) {
        done(e);
        return;
      }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => ws.send(this.connectPacket());
      ws.onerror = () => done(new Error('connexion refusée'));
      ws.onclose = () => {
        const was = this.connected;
        this.connected = false;
        clearInterval(this.pingTimer);
        if (!settled) done(new Error('connexion fermée'));
        else if (was && this.onclose) this.onclose('fermée');
      };
      ws.onmessage = (ev) => {
        this.lastIn = Date.now();
        const data = new Uint8Array(ev.data);
        const merged = new Uint8Array(this.buf.length + data.length);
        merged.set(this.buf);
        merged.set(data, this.buf.length);
        this.buf = merged;
        this.drain((type, flags, body) => {
          if (type === CONNACK) {
            if (body[1] === 0) {
              this.connected = true;
              this.startPing();
              done();
            } else done(new Error(`connexion refusée par le serveur (${body[1]})`));
          } else this.handle(type, flags, body);
        });
      };
    });
  }

  connectPacket() {
    const flags = 0x02 | (this.will ? 0x04 : 0); // session propre (+ message de départ, QoS 0)
    const parts = [str('MQTT'), Uint8Array.of(4, flags, this.keepalive >> 8, this.keepalive & 255), str(this.clientId)];
    if (this.will) parts.push(str(this.will.topic), str(this.will.payload));
    return packet(CONNECT, 0, concat(parts));
  }

  // Découpe le tampon en paquets complets.
  drain(cb) {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      let len = 0;
      let mult = 1;
      let i = 1;
      let byte;
      do {
        if (i >= b.length) return;
        byte = b[i++];
        len += (byte & 127) * mult;
        mult *= 128;
      } while (byte & 128);
      if (b.length < i + len) return;
      const type = b[0] >> 4;
      const flags = b[0] & 15;
      const body = b.subarray(i, i + len);
      this.buf = b.slice(i + len);
      cb(type, flags, body);
    }
  }

  handle(type, flags, body) {
    if (type === PUBLISH) {
      const tlen = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tlen));
      let o = 2 + tlen;
      if ((flags >> 1) & 3) o += 2; // identifiant de paquet (QoS > 0)
      const text = dec.decode(body.subarray(o));
      if (this.onmessage) {
        try {
          this.onmessage(topic, text);
        } catch (e) {
          console.error(e);
        }
      }
    } else if (type === SUBACK) {
      const id = (body[0] << 8) | body[1];
      const res = this.pending.get(id);
      this.pending.delete(id);
      if (res) res(body[2] !== 0x80);
    }
    // PINGRESP : rien à faire (lastIn est mis à jour)
  }

  startPing() {
    clearInterval(this.pingTimer);
    const every = Math.max(5, this.keepalive * 0.6) * 1000;
    this.pingTimer = setInterval(() => {
      if (!this.connected) return;
      // pas de réponse depuis deux intervalles : on considère la connexion perdue
      if (Date.now() - this.lastIn > every * 2.5) {
        this.ws.close();
        return;
      }
      this.send(packet(PINGREQ, 0, new Uint8Array(0)));
    }, every);
  }

  send(bytes) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(bytes);
  }

  subscribe(topic, timeoutMs = 5000) {
    const id = this.nextPid++ & 0xffff || 1;
    const body = concat([Uint8Array.of(id >> 8, id & 255), str(topic), Uint8Array.of(0)]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('abonnement sans réponse'));
      }, timeoutMs);
      this.pending.set(id, (ok) => {
        clearTimeout(timer);
        ok ? resolve() : reject(new Error('abonnement refusé'));
      });
      this.send(packet(SUBSCRIBE, 2, body));
    });
  }

  publish(topic, payload) {
    const data = typeof payload === 'string' ? enc.encode(payload) : payload;
    this.send(packet(PUBLISH, 0, concat([str(topic), data])));
  }

  close() {
    clearInterval(this.pingTimer);
    if (this.ws && this.ws.readyState === 1) {
      this.send(packet(DISCONNECT, 0, new Uint8Array(0)));
      this.connected = false;
      this.ws.close();
    }
  }
}

// Relais publics gratuits, essayés dans l'ordre (le premier qui répond est gardé).
export const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

// Se connecte au premier relais disponible à partir de l'indice `from`.
export async function connectAny(urls, opts = {}, from = 0) {
  let last = null;
  for (let k = from; k < urls.length; k++) {
    const client = new MqttClient(urls[k], opts);
    try {
      await client.connect(opts.timeoutMs ?? 5000);
      client.brokerIndex = k;
      return client;
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error('aucun relais disponible');
}
