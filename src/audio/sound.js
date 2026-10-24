// Sons générés en Web Audio API : koto (corde pincée), taiko (tambour), cloche
// de temple, souffles et impacts. Aucun fichier audio. Le contexte est créé et
// débloqué au premier geste de l'utilisateur (exigence iOS).

// Gamme Hirajoshi (ré) : ré, mi, fa, la, si♭ — couleur japonaise traditionnelle.
const SCALE = [0, 2, 3, 7, 8];
const BASE = 146.83; // ré3

function noteFreq(degree, octave = 0) {
  const n = SCALE.length;
  const oct = Math.floor(degree / n) + octave;
  const st = SCALE[((degree % n) + n) % n] + 12 * oct;
  return BASE * Math.pow(2, st / 12);
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this.last = new Map();
    this.musicTimer = null;
    this.intensity = 0; // 0 calme (préparation), 1 vague en cours
    this.step = 0;
    this.nextNote = 0;
  }

  // À appeler dans un gestionnaire d'événement utilisateur.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(c.destination);
      this.sfx = c.createGain();
      this.sfx.gain.value = 0.8;
      this.sfx.connect(this.master);
      this.music = c.createGain();
      this.music.gain.value = 0.38;
      this.music.connect(this.master);
      // Réverbération légère (impulsion générée) pour l'espace du jardin.
      this.reverb = c.createConvolver();
      this.reverb.buffer = this.makeImpulse(2.4);
      const wet = c.createGain();
      wet.gain.value = 0.28;
      this.reverb.connect(wet).connect(this.master);
      this.noiseBuf = this.makeNoise();
      // iOS : un son silencieux débloque la sortie audio.
      const o = c.createOscillator();
      const g = c.createGain();
      g.gain.value = 0.0001;
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + 0.05);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.musicTimer) this.startMusic();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, t, 0.05);
    }
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  makeNoise() {
    const c = this.ctx;
    const buf = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  makeImpulse(seconds) {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }

  ready() {
    return this.ctx && this.ctx.state === 'running' && !this.muted;
  }

  // Limite la fréquence d'un même son (évite la saturation pendant les vagues).
  throttle(key, ms) {
    const now = performance.now();
    const t = this.last.get(key) || 0;
    if (now - t < ms) return false;
    this.last.set(key, now);
    return true;
  }

  // ───────────── instruments ─────────────

  // Koto : corde pincée (dent de scie filtrée + attaque bruitée + léger glissando).
  koto(freq, when = 0, vel = 0.5, dur = 1.6, out = this.sfx, wet = true) {
    const c = this.ctx;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq * 1.012, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
    const o2 = c.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq * 2;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(Math.min(9000, freq * 14), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(200, freq * 1.5), t + dur * 0.6);
    f.Q.value = 2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.32, t + 0.004);
    g.gain.exponentialRampToValueAtTime(vel * 0.1, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = c.createGain();
    g2.gain.value = 0.25;
    o.connect(f);
    o2.connect(g2).connect(f);
    f.connect(g).connect(out);
    if (wet) g.connect(this.reverb);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
    // pincement
    this.noise(t, 0.03, 3000 + freq, vel * 0.12, out, 'bandpass', 3);
  }

  // Taiko : sinus grave à chute de hauteur + choc bruité.
  taiko(when = 0, vel = 0.6, pitch = 1, out = this.sfx) {
    const c = this.ctx;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(48 * pitch, t + 0.3);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g).connect(out);
    g.connect(this.reverb);
    o.start(t);
    o.stop(t + 0.6);
    this.noise(t, 0.08, 400 * pitch, vel * 0.5, out, 'lowpass', 1);
  }

  // Cloche de temple : partiels inharmoniques, longue résonance.
  bell(freq, when = 0, vel = 0.4, dur = 3.5, out = this.sfx) {
    const c = this.ctx;
    const t = c.currentTime + when;
    const partials = [
      [1, 1],
      [2.76, 0.5],
      [5.4, 0.25],
      [8.93, 0.12],
      [0.5, 0.35],
    ];
    for (const [m, a] of partials) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * m;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vel * a * 0.3, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur / Math.sqrt(m));
      o.connect(g).connect(out);
      g.connect(this.reverb);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  noise(t, dur, freq, vel, out = this.sfx, type = 'bandpass', q = 1, sweepTo = null) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  blip(freq, to, dur, vel, type = 'sine', when = 0) {
    const c = this.ctx;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // ───────────── effets de jeu ─────────────

  play(name, data = {}) {
    if (!this.ready()) return;
    const c = this.ctx;
    const t = c.currentTime;
    switch (name) {
      case 'tap':
        if (this.throttle('tap', 40)) this.noise(t, 0.025, 2400, 0.12, this.sfx, 'bandpass', 4);
        break;
      case 'select':
        this.koto(noteFreq(7), 0, 0.25, 0.6);
        break;
      case 'shoot': {
        const el = data.element;
        if (!this.throttle('shoot-' + el, 70)) return;
        const v = data.echo ? 0.5 : 1;
        if (el === 'fire') this.noise(t, 0.18, 1800, 0.12 * v, this.sfx, 'bandpass', 0.8, 500);
        else if (el === 'water') this.blip(900, 420, 0.12, 0.08 * v);
        else if (el === 'wind') this.noise(t, 0.25, 600, 0.1 * v, this.sfx, 'bandpass', 2, 2400);
        else if (el === 'earth') this.blip(220, 90, 0.18, 0.12 * v, 'triangle');
        break;
      }
      case 'hit': {
        if (!this.throttle('hit-' + data.element, 60)) return;
        if (data.element === 'earth') this.taiko(0, 0.25, 1.4);
        else if (data.element === 'water') this.noise(t, 0.12, 1500, 0.06, this.sfx, 'highpass', 1);
        else if (data.element === 'fire') this.noise(t, 0.1, 900, 0.06, this.sfx, 'bandpass', 1);
        break;
      }
      case 'kill':
        if (!this.throttle('kill', 45)) return;
        this.koto(noteFreq(5 + Math.floor(Math.random() * 6)), 0, 0.22, 0.9);
        break;
      case 'place':
        this.noise(t, 0.04, 1200, 0.25, this.sfx, 'bandpass', 6);
        this.koto(noteFreq(0), 0, 0.4, 1.2);
        this.koto(noteFreq(2), 0.06, 0.35, 1.2);
        break;
      case 'sell':
        this.koto(noteFreq(4), 0, 0.3, 0.8);
        this.koto(noteFreq(2), 0.08, 0.3, 0.8);
        break;
      case 'fuse':
        for (let i = 0; i < 5; i++) this.koto(noteFreq(i + (data.level === 3 ? 5 : 2)), i * 0.06, 0.4, 1.4);
        this.bell(noteFreq(data.level === 3 ? 10 : 7), 0.3, 0.35, 3);
        break;
      case 'combo':
        this.bell(noteFreq(9), 0, 0.3, 2.2);
        this.koto(noteFreq(4), 0.05, 0.3, 1);
        break;
      case 'stone':
        this.noise(t, 0.06, 2200, 0.35, this.sfx, 'bandpass', 5);
        this.taiko(0.01, 0.2, 2);
        break;
      case 'reject':
        if (!this.throttle('reject', 150)) return;
        this.blip(160, 120, 0.18, 0.15, 'square');
        this.blip(170, 125, 0.18, 0.1, 'square');
        break;
      case 'leak':
        this.taiko(0, 0.7, 0.8);
        this.bell(110, 0.05, 0.3, 2);
        break;
      case 'waveStart':
        this.taiko(0, 0.7);
        this.taiko(0.22, 0.5);
        this.taiko(0.44, 0.8);
        this.bell(noteFreq(5), 0.5, 0.25, 3);
        break;
      case 'waveEnd':
        this.koto(noteFreq(5), 0, 0.3, 1.5);
        this.koto(noteFreq(7), 0.12, 0.3, 1.5);
        this.koto(noteFreq(9), 0.24, 0.35, 2);
        break;
      case 'win':
        this.bell(noteFreq(0, 1), 0, 0.5, 4);
        [0, 2, 4, 5, 7, 9, 10].forEach((d, i) => this.koto(noteFreq(d), 0.3 + i * 0.13, 0.4, 2));
        break;
      case 'lose':
        [9, 7, 5, 3, 0].forEach((d, i) => this.koto(noteFreq(d), i * 0.22, 0.4, 2));
        this.bell(noteFreq(-5), 0.2, 0.5, 4.5);
        break;
      case 'rewind': {
        // souffle qui s'inverse : bruit filtré montant + cloche
        this.noise(t, 1.0, 300, 0.25, this.sfx, 'bandpass', 3, 3000);
        for (let i = 0; i < 6; i++) this.koto(noteFreq(10 - i), i * 0.12, 0.25, 0.8);
        this.bell(noteFreq(7), 0.9, 0.3, 2.5);
        break;
      }
      case 'echo':
        if (this.throttle('echo', 200)) this.bell(noteFreq(12), 0, 0.15, 1.8);
        break;
      case 'stomp':
        this.taiko(0, 1, 0.6);
        this.noise(t, 0.4, 200, 0.4, this.sfx, 'lowpass', 1);
        break;
      case 'boss':
        this.taiko(0, 0.9, 0.7);
        this.taiko(0.35, 0.9, 0.7);
        this.bell(73.4, 0.1, 0.6, 5);
        break;
      case 'heal':
        if (this.throttle('heal', 300)) this.blip(700, 1200, 0.2, 0.05);
        break;
      case 'absorb':
        if (this.throttle('absorb', 200)) this.blip(500, 800, 0.15, 0.06, 'triangle');
        break;
      case 'split':
        if (this.throttle('split', 100)) this.blip(300, 600, 0.12, 0.08, 'triangle');
        break;
      case 'pulse':
        this.noise(t, 0.5, 4000, 0.12, this.sfx, 'highpass', 1);
        this.bell(noteFreq(14), 0, 0.12, 1.2);
        break;
      case 'tornado':
        this.noise(t, 1.2, 300, 0.15, this.sfx, 'bandpass', 2, 1200);
        break;
      case 'star':
        this.bell(noteFreq(7 + (data.i || 0) * 2, 0), 0, 0.35, 2);
        break;
      default:
        break;
    }
  }

  // Traduction des événements moteur en sons.
  onEvent(ev) {
    switch (ev.type) {
      case 'shoot':
        return this.play('shoot', ev);
      case 'hit':
        return this.play('hit', ev);
      case 'kill':
        return this.play(ev.enemy.boss ? 'win' : 'kill');
      case 'place':
        return this.play('place');
      case 'sell':
        return this.play('sell');
      case 'fuse':
        return this.play('fuse', ev);
      case 'combo':
        return this.play('combo');
      case 'stone':
      case 'unstone':
        return this.play('stone');
      case 'reject':
        return this.play('reject');
      case 'leak':
        return this.play('leak');
      case 'waveStart':
        this.intensity = 1;
        return this.play('waveStart');
      case 'waveEnd':
        this.intensity = 0;
        return this.play('waveEnd');
      case 'rewindStart':
        return this.play('rewind');
      case 'echo':
        return this.play('echo');
      case 'stomp':
        return this.play('stomp');
      case 'heal':
        return this.play('heal');
      case 'absorb':
        return this.play('absorb');
      case 'split':
        return this.play('split');
      case 'pulse':
        return this.play('pulse');
      case 'tornado':
        return this.play('tornado');
      case 'spawn':
        if (ev.enemy.boss) this.play('boss');
        return undefined;
      case 'win':
        this.intensity = 0;
        return this.play('win');
      case 'lose':
        this.intensity = 0;
        return this.play('lose');
      default:
        return undefined;
    }
  }

  // ───────────── musique générative ─────────────

  startMusic() {
    this.nextNote = this.ctx.currentTime + 0.5;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 120);
    this.startDrone();
  }

  startDrone() {
    const c = this.ctx;
    this.drone = c.createGain();
    this.drone.gain.value = 0.0;
    this.drone.connect(this.music);
    for (const [f, type] of [
      [BASE / 2, 'triangle'],
      [(BASE / 2) * 1.5, 'sine'],
      [BASE / 2 + 0.6, 'triangle'],
    ]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      o.connect(lp).connect(this.drone);
      o.start();
    }
    this.drone.gain.setTargetAtTime(0.05, c.currentTime, 2);
  }

  scheduleMusic() {
    if (!this.ctx || this.ctx.state !== 'running' || !this.musicOn) return;
    const c = this.ctx;
    while (this.nextNote < c.currentTime + 0.4) {
      const t = this.nextNote - c.currentTime;
      const beat = this.step % 16;
      // koto : phrase pentatonique clairsemée
      const p = this.intensity ? 0.55 : 0.35;
      if (Math.random() < p) {
        const deg = [0, 2, 4, 5, 7, 4, 2, 3][(this.step + Math.floor(Math.random() * 3)) % 8] + (Math.random() < 0.3 ? 5 : 0);
        this.koto(noteFreq(deg), t, 0.18 + Math.random() * 0.1, 2.2, this.music);
      }
      if (beat === 0 && Math.random() < 0.5) this.koto(noteFreq(-5), t, 0.2, 3, this.music);
      // taiko discret pendant les vagues
      if (this.intensity && (beat === 0 || beat === 6 || beat === 10)) this.taiko(t, beat === 0 ? 0.28 : 0.16, 1, this.music);
      if (beat === 8 && Math.random() < 0.15) this.bell(noteFreq(10), t, 0.12, 4, this.music);
      this.step++;
      this.nextNote += this.intensity ? 0.32 : 0.48;
    }
  }
}

export const sound = new Sound();
