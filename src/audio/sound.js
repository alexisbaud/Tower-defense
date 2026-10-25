// Sons générés en Web Audio API, sans aucun fichier : koto (corde pincée,
// Karplus-Strong), taiko (synthèse modale de peau), cloches de temple (bonshō et
// rin, partiels inharmoniques qui battent), shakuhachi (ton + souffle) et
// bruitages (braises, gouttes, gravier, bambou…).
// Les timbres sont calculés une fois en JS dans des tampons (à la demande, puis
// réutilisés) : chaque son joué ne coûte qu'une source + un gain, ce qui borne le
// travail du fil audio sur iPhone. Le contexte est créé et débloqué au premier
// geste de l'utilisateur (exigence iOS).

// Gammes pentatoniques japonaises (demi-tons depuis ré) : hirajōshi pour le jardin
// de mousse (chaude, classique), in-sen pour le temple sous la neige (plus sombre,
// plus froide). Même tonique : les effets restent toujours dans le ton de la musique.
const SCALES = { moss: [0, 2, 3, 7, 8], snow: [0, 1, 5, 7, 10] };
const BASE = 146.83; // ré3
const SR = 32000; // fréquence des tampons pré-calculés (aigus jusqu'à 16 kHz)
const SR_LOW = 22050; // timbres sans extrême aigu (taiko, rin, chocs) : moins de mémoire et de calcul
const SR_BELL = 11025; // bonshō : partiels sous 1,2 kHz
const MAX_SFX = 30; // voix d'effets simultanées
const SOFT_SFX = 18; // au-delà, les sons fréquents (tirs, impacts) sont ignorés
const MAX_MUSIC = 22; // voix de musique simultanées

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ───────────── outils de synthèse (JS pur, hors fil audio) ─────────────

// Bruit blanc déterministe (xorshift) : les timbres sont identiques à chaque session.
function noiseGen(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 2147483648 - 1;
  };
}

// Filtre biquadratique (formules RBJ) : 'lp', 'hp', 'bp' (crête 0 dB), 'peak'.
class Biquad {
  constructor(sr, type, f, q = 0.707, db = 0) {
    this.sr = sr;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(type, f, q, db);
  }

  set(type, f, q = 0.707, db = 0) {
    const w = (2 * Math.PI * Math.min(f, this.sr * 0.45)) / this.sr;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const A = Math.pow(10, db / 40);
    let b0;
    let b1;
    let b2;
    let a0 = 1 + al;
    let a2 = 1 - al;
    if (type === 'lp') {
      b0 = b2 = (1 - cs) / 2;
      b1 = 1 - cs;
    } else if (type === 'hp') {
      b0 = b2 = (1 + cs) / 2;
      b1 = -(1 + cs);
    } else if (type === 'bp') {
      b0 = al;
      b1 = 0;
      b2 = -al;
    } else {
      b0 = 1 + al * A;
      b1 = -2 * cs;
      b2 = 1 - al * A;
      a0 = 1 + al / A;
      a2 = 1 - al / A;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cs) / a0;
    this.a2 = a2 / a0;
    return this;
  }

  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

function normalize(d, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  return d;
}

function fadeOut(d, frac) {
  const n = Math.floor(d.length * frac);
  const s = d.length - n;
  for (let i = 0; i < n; i++) d[s + i] *= (1 - i / n) * (1 - i / n);
  return d;
}

// Modes sinusoïdaux amortis (synthèse modale : bois, métal) ajoutés à `d`.
// modes : [rapport, amplitude, tau (s), battement (Hz, optionnel)] — un mode qui bat
// est dédoublé en deux partiels voisins, comme dans une vraie cloche.
// Oscillateur récursif (rotation d'un phaseur) : pas de Math.sin par échantillon.
function addModes(d, sr, f0, modes, att = 0.001, start = 0) {
  const ra = Math.exp(-1 / (att * sr));
  for (const [ratio, amp, tau, beat = 0] of modes) {
    const parts = beat
      ? [
          [f0 * ratio, amp * 0.62],
          [f0 * ratio + beat, amp * 0.38],
        ]
      : [[f0 * ratio, amp]];
    for (const [f, a] of parts) {
      if (f >= sr * 0.45) continue;
      const w = (2 * Math.PI * f) / sr;
      const cw = Math.cos(w);
      const sw = Math.sin(w);
      const k = Math.exp(-1 / (tau * sr));
      let re = 1;
      let im = 0;
      let env = a;
      let at = 1;
      for (let n = start; n < d.length && env > 2e-4; n++) {
        const nr = re * cw - im * sw;
        im = re * sw + im * cw;
        re = nr;
        at *= ra;
        d[n] += env * (1 - at) * im;
        env *= k;
      }
    }
  }
}

// Peau de tambour : modes amortis dont la hauteur chute juste après la frappe.
function addMembrane(d, sr, f0, modes, drop, dropTau) {
  const kd = Math.exp(-1 / (dropTau * sr));
  for (const [r, amp, tau] of modes) {
    const w = (2 * Math.PI * f0 * r) / sr;
    const k = Math.exp(-1 / (tau * sr));
    const n1 = Math.min(d.length, Math.ceil(tau * sr * 9));
    let ph = 0;
    let p = drop;
    let env = amp;
    for (let n = 0; n < n1; n++) {
      ph += w * (1 + p);
      p *= kd;
      d[n] += env * Math.sin(ph) * (n < 24 ? n / 24 : 1);
      env *= k;
    }
  }
}

// Bruit filtré à enveloppe exponentielle (frappe, souffle bref), fréquence
// éventuellement glissante (sweep(t) → Hz).
function addNoise(d, sr, seed, type, f, q, amp, tau, att = 0.0005, start = 0, sweep = null) {
  const rnd = noiseGen(seed);
  const bq = new Biquad(sr, type, f, q);
  const n1 = Math.min(d.length, start + Math.ceil(tau * sr * 7));
  const k = Math.exp(-1 / (tau * sr));
  const ka = Math.exp(-1 / (att * sr));
  let env = amp;
  let at = 1;
  for (let n = start; n < n1; n++) {
    if (sweep && ((n - start) & 15) === 0) bq.set(type, sweep((n - start) / sr), q);
    at *= ka;
    d[n] += bq.run(rnd()) * env * (1 - at);
    env *= k;
  }
}

// Sinus glissant de f0 vers f1 (goutte, bulle, choc sourd).
function addChirp(d, sr, f0, f1, glideTau, amp, tau, start = 0, att = 0.001) {
  const n1 = Math.min(d.length, start + Math.ceil(tau * sr * 8));
  let ph = 0;
  for (let n = start; n < n1; n++) {
    const t = (n - start) / sr;
    ph += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t / glideTau))) / sr;
    d[n] += amp * Math.sin(ph) * Math.exp(-t / tau) * (1 - Math.exp(-t / att));
  }
}

// Grains : impulsions aléatoires de densité décroissante (gravier, crépitement).
function addGrains(d, sr, seed, rate, tau, type, f, q, amp, start = 0) {
  const rnd = noiseGen(seed);
  const bq = new Biquad(sr, type, f, q);
  const n1 = Math.min(d.length, start + Math.ceil(tau * sr * 6));
  for (let n = start; n < n1; n++) {
    const p = (rate / sr) * Math.exp(-(n - start) / (tau * sr));
    d[n] += bq.run(rnd() * 0.5 + 0.5 < p ? rnd() : 0) * amp;
  }
}

function drive(d, k) {
  for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * k);
  return d;
}

// Début d'un son, renversé : la montée « aspirée » du rembobinage.
function reversed(src, sr, seconds) {
  const n = Math.min(src.length, Math.floor(sr * seconds));
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = src[n - 1 - i];
  const k = Math.floor(sr * 0.004);
  for (let i = 0; i < k; i++) d[n - 1 - i] *= i / k; // fin sans clic
  return d;
}

// Koto : corde pincée par l'algorithme de Karplus-Strong (ligne à retard bouclée
// sur un filtre moyenneur), excitée par une impulsion « onglet près du chevalet »
// + un peu de bruit de corde, puis colorée par la caisse en paulownia.
// Renvoie [échantillons, fréquence réelle, fréquence d'échantillonnage] : la justesse
// exacte est rattrapée à la lecture par playbackRate (pas de retard fractionnaire).
function renderKoto(freq) {
  const sr = freq < 400 ? SR_LOW : SR;
  const T60 = clamp(4.2 - 0.7 * Math.log2(freq / 147), 1.6, 4.6); // les cordes graves sonnent plus longtemps
  const len = Math.floor(sr * Math.min(3.4, T60 * 0.8));
  const d = new Float32Array(len);
  const S = clamp(0.5 - 0.16 * Math.log2(freq / 147), 0.12, 0.5); // amortissement des aigus par tour
  const N = Math.max(4, Math.round(sr / freq - S));
  const rho = Math.pow(10, -3 / (freq * T60)); // perte par période pour le T60 visé
  const rnd = noiseGen(Math.round(freq * 13));
  const beta = 0.13; // position de l'onglet (tsume) sur la corde
  const P = Math.max(1, Math.round(N * beta));
  let lp = 0;
  let mean = 0;
  for (let i = 0; i < N; i++) {
    lp += 0.6 * ((i < P ? 1 - beta : -beta) * 2.4 + 0.4 * rnd() - lp);
    d[i] = lp;
    mean += lp;
  }
  mean /= N;
  for (let i = 0; i < N; i++) d[i] -= mean;
  const a = rho * (1 - S);
  const b = rho * S;
  d[N] = a * d[0];
  for (let n = N + 1; n < len; n++) d[n] = a * d[n - N] + b * d[n - N - 1];
  // caisse de résonance + « clic » de l'onglet sur la soie
  const hp = new Biquad(sr, 'hp', 70, 0.7);
  const b1 = new Biquad(sr, 'peak', 230, 1.1, 4);
  const b2 = new Biquad(sr, 'peak', 1150, 1.6, 2.5);
  const lo = new Biquad(sr, 'lp', 7000, 0.6);
  const ck = new Biquad(sr, 'bp', 3800, 1.2);
  const crnd = noiseGen(7);
  const nc = Math.floor(sr * 0.006);
  for (let n = 0; n < len; n++) {
    let x = d[n];
    if (n < nc) x += ck.run(crnd()) * 1.2 * (1 - n / nc);
    d[n] = lo.run(b2.run(b1.run(hp.run(x))));
  }
  normalize(d, 0.85);
  fadeOut(d, 0.25);
  return [d, sr / (N + S), sr];
}

// Banque de timbres : nom → () => [échantillons, fréquence d'échantillonnage].
// `get(nom)` donne les échantillons d'un autre timbre (sons dérivés).
const SAMPLES = {
  // Ō-daiko : peau grave, modes presque harmoniques (charge de l'air), hauteur qui
  // chute après la frappe ; fût en bois et saturation douce pour exister sur les
  // petits haut-parleurs de téléphone (qui ne restituent pas le fondamental).
  taiko() {
    const sr = SR_LOW;
    const d = new Float32Array(Math.floor(sr * 1.25));
    addMembrane(
      d,
      sr,
      64,
      [
        [1, 1, 0.36],
        [1.5, 0.42, 0.19],
        [1.98, 0.26, 0.13],
        [2.44, 0.16, 0.09],
        [2.9, 0.1, 0.065],
        [3.6, 0.06, 0.045],
      ],
      0.5,
      0.02,
    );
    addModes(
      d,
      sr,
      330,
      [
        [1, 0.35, 0.025],
        [1.7, 0.2, 0.015],
      ],
      0.0005,
    );
    addNoise(d, sr, 11, 'lp', 160, 0.7, 2.4, 0.05, 0.001);
    addNoise(d, sr, 12, 'lp', 1000, 0.8, 1, 0.012);
    addNoise(d, sr, 13, 'bp', 2400, 1.2, 0.8, 0.0035);
    return [normalize(drive(d, 2)), sr];
  },
  // Shime-daiko : petit tambour très tendu, sec et clair (la pulsation).
  shime() {
    const sr = SR;
    const d = new Float32Array(Math.floor(sr * 0.32));
    addMembrane(
      d,
      sr,
      300,
      [
        [1, 1, 0.11],
        [1.59, 0.5, 0.06],
        [2.14, 0.35, 0.045],
        [2.65, 0.2, 0.03],
        [3.16, 0.12, 0.02],
      ],
      0.14,
      0.006,
    );
    addNoise(d, sr, 14, 'bp', 3500, 1, 1.4, 0.003);
    return [normalize(drive(d, 1.4)), sr];
  },
  // Ka : la baguette sur le cerclage en bois du taiko.
  ka() {
    const sr = SR;
    const d = new Float32Array(Math.floor(sr * 0.12));
    addModes(
      d,
      sr,
      1250,
      [
        [1, 1, 0.022],
        [2.3, 0.6, 0.012],
        [3.9, 0.3, 0.007],
      ],
      0.0003,
    );
    addNoise(d, sr, 15, 'bp', 5000, 1, 1.6, 0.0015);
    return [normalize(d), sr];
  },
  // Hyōshigi : claquoirs de bois dur du kabuki, le signal du début.
  hyoshigi() {
    const sr = SR;
    const d = new Float32Array(Math.floor(sr * 0.3));
    addModes(
      d,
      sr,
      1900,
      [
        [1, 1, 0.05],
        [1.47, 0.6, 0.034],
        [2.18, 0.45, 0.022],
        [2.95, 0.25, 0.014],
      ],
      0.0002,
    );
    addNoise(d, sr, 16, 'bp', 6000, 0.9, 2, 0.001);
    return [normalize(d), sr];
  },
  // Mokugyo (bloc de bois creux du temple) : refus, « tok-tok ».
  woodBlock() {
    const sr = SR;
    const d = new Float32Array(Math.floor(sr * 0.25));
    addModes(
      d,
      sr,
      480,
      [
        [1, 1, 0.065],
        [2.62, 0.35, 0.02],
        [4.1, 0.15, 0.01],
      ],
      0.0004,
    );
    addNoise(d, sr, 17, 'lp', 1200, 0.8, 1.2, 0.005);
    return [normalize(d), sr];
  },
  // Pierre contre pierre : une lanterne posée sur son socle.
  stoneKnock() {
    const sr = SR;
    const d = new Float32Array(Math.floor(sr * 0.15));
    addModes(
      d,
      sr,
      1350,
      [
        [1, 1, 0.018],
        [1.7, 0.7, 0.012],
        [2.6, 0.5, 0.008],
        [3.8, 0.3, 0.006],
      ],
      0.0002,
    );
    addNoise(d, sr, 18, 'bp', 5000, 0.9, 1.6, 0.001);
    addNoise(d, sr, 19, 'lp', 300, 0.7, 2, 0.015);
    return [normalize(d), sr];
  },
  // Shishi-odoshi : le bambou qui bascule et frappe la pierre (« kon »).
  bamboo() {
    const sr = SR;
    const d = new Float32Array(Math.floor(sr * 0.35));
    addModes(
      d,
      sr,
      640,
      [
        [1, 1, 0.09],
        [2.1, 0.5, 0.04],
        [3.3, 0.3, 0.02],
        [4.9, 0.12, 0.012],
      ],
      0.0003,
    );
    addNoise(d, sr, 20, 'bp', 4000, 1, 1.4, 0.0012);
    return [normalize(d), sr];
  },
  // Bonshō : grande cloche de temple frappée par une poutre (attaque sourde),
  // partiels inharmoniques dédoublés → le battement « ôôn-ôôn » caractéristique.
  bonsho() {
    const sr = SR_BELL;
    const d = new Float32Array(Math.floor(sr * 6));
    addModes(
      d,
      sr,
      110,
      [
        [1, 1, 1.6, 0.42],
        [2.07, 0.6, 1.1, 0.9],
        [2.93, 0.55, 0.85, 1.3],
        [4.18, 0.4, 0.6, 1.1],
        [5.43, 0.28, 0.42, 1.7],
        [6.8, 0.18, 0.3, 2.3],
        [8.25, 0.11, 0.2],
        [10.1, 0.07, 0.13],
      ],
      0.006,
    );
    addNoise(d, sr, 21, 'lp', 260, 0.7, 3, 0.03, 0.002);
    addNoise(d, sr, 22, 'bp', 700, 1.5, 0.8, 0.012);
    return [fadeOut(normalize(d), 0.35), sr];
  },
  // Rin : petit bol de méditation, clair, long, légèrement battant.
  rin() {
    const sr = SR_LOW;
    const d = new Float32Array(Math.floor(sr * 3.2));
    addModes(
      d,
      sr,
      660,
      [
        [1, 1, 0.95, 1.1],
        [2.71, 0.5, 0.45, 2.3],
        [5.15, 0.3, 0.24, 3.1],
        [8.43, 0.14, 0.12],
        [12.3, 0.06, 0.07],
      ],
      0.0006,
    );
    addNoise(d, sr, 23, 'bp', 6500, 1.2, 1, 0.0015);
    return [fadeOut(normalize(d), 0.3), sr];
  },
  rinRev: (get) => [reversed(get('rin'), SR_LOW, 2.2), SR_LOW],
  bonshoRev: (get) => [reversed(get('bonsho'), SR_BELL, 3), SR_BELL],
  // Tir de feu : souffle de braise qui descend + crépitements.
  fireShot() {
    const sr = SR;
    const d = new Float32Array(Math.floor(sr * 0.24));
    addNoise(d, sr, 41, 'bp', 2600, 1.1, 1, 0.07, 0.006, 0, (t) => 650 + 1950 * Math.exp(-t / 0.05));
    addGrains(d, sr, 42, 900, 0.08, 'hp', 2500, 0.7, 0.8);
    return [normalize(d), sr];
  },
  // Tir d'eau : goutte (résonance de bulle dont la hauteur monte) + éclat aigu.
  waterShot() {
    const sr = SR;
    const d = new Float32Array(Math.floor(sr * 0.18));
    addChirp(d, sr, 430, 1350, 0.018, 1, 0.035, 0, 0.0015);
    addNoise(d, sr, 43, 'hp', 5000, 0.7, 0.5, 0.006);
    return [normalize(d), sr];
  },
  // Tir de vent : bouffée d'air qui monte.
  windShot() {
    const sr = SR;
    const len = Math.floor(sr * 0.32);
    const d = new Float32Array(len);
    const rnd = noiseGen(44);
    const b1 = new Biquad(sr, 'bp', 500, 0.8);
    const b2 = new Biquad(sr, 'bp', 1200, 1.2);
    for (let n = 0; n < len; n++) {
      const x = n / len;
      if ((n & 15) === 0) {
        const f = 450 + 1900 * Math.pow(x, 0.8);
        b1.set('bp', f, 0.8);
        b2.set('bp', f * 2.3, 1.2);
      }
      const w = rnd();
      d[n] = (b1.run(w) + 0.35 * b2.run(w)) * Math.pow(Math.sin(Math.PI * Math.pow(x, 0.6)), 2);
    }
    return [normalize(d), sr];
  },
  // Tir de terre : rocher lancé, choc sourd.
  earthShot() {
    const sr = SR;
    const d = new Float32Array(Math.floor(sr * 0.22));
    addChirp(d, sr, 190, 75, 0.03, 1, 0.06, 0, 0.002);
    addNoise(d, sr, 45, 'lp', 1500, 0.8, 1.6, 0.008);
    addModes(d, sr, 420, [[1, 0.25, 0.02]], 0.0005);
    return [normalize(drive(d, 1.5)), sr];
  },
  // Impact de feu : grésillement + petit souffle.
  fireHit() {
    const sr = SR;
    const d = new Float32Array(Math.floor(sr * 0.2));
    addNoise(d, sr, 46, 'hp', 3000, 0.7, 0.6, 0.05, 0.002);
    addGrains(d, sr, 47, 1800, 0.06, 'hp', 2000, 0.7, 1.2);
    addNoise(d, sr, 48, 'bp', 500, 1, 1.6, 0.02);
    return [normalize(d), sr];
  },
  // Impact d'eau : éclaboussure + gouttelettes.
  waterHit() {
    const sr = SR;
    const d = new Float32Array(Math.floor(sr * 0.3));
    addNoise(d, sr, 49, 'bp', 3200, 0.9, 1.4, 0.05, 0.002, 0, (t) => 1100 + 2100 * Math.exp(-t / 0.06));
    const r = noiseGen(50);
    for (let k = 0; k < 3; k++) addChirp(d, sr, 1300 + 400 * r(), 2200 + 500 * r(), 0.01, 0.35, 0.02, Math.floor(sr * (0.03 + k * 0.045)));
    return [normalize(d), sr];
  },
  // Impact de vent : bouffée sourde.
  windHit() {
    const sr = SR;
    const d = new Float32Array(Math.floor(sr * 0.16));
    addNoise(d, sr, 59, 'lp', 900, 0.7, 1, 0.03, 0.004);
    return [normalize(d), sr];
  },
  // Impact de terre : choc grave + gravier projeté.
  earthHit() {
    const sr = SR_LOW;
    const d = new Float32Array(Math.floor(sr * 0.5));
    addChirp(d, sr, 110, 48, 0.04, 1, 0.12, 0, 0.002);
    addModes(
      d,
      sr,
      260,
      [
        [1, 0.3, 0.03],
        [1.8, 0.2, 0.02],
      ],
      0.0005,
    );
    addGrains(d, sr, 51, 2500, 0.06, 'bp', 2600, 1.5, 5);
    addNoise(d, sr, 52, 'lp', 400, 0.7, 2, 0.03);
    return [normalize(drive(d, 1.6)), sr];
  },
  // Pierre posée sur le gravier ratissé : crissement de grains + appui sourd.
  gravel() {
    const sr = SR;
    const d = new Float32Array(Math.floor(sr * 0.34));
    addGrains(d, sr, 53, 3500, 0.09, 'bp', 2300, 1.2, 4);
    addGrains(d, sr, 54, 2000, 0.07, 'bp', 4600, 1.5, 3);
    addChirp(d, sr, 260, 180, 0.02, 0.5, 0.025);
    return [normalize(d), sr];
  },
  // Toucher : minuscule déclic de bois.
  tick() {
    const sr = SR;
    const d = new Float32Array(Math.floor(sr * 0.04));
    addModes(d, sr, 2400, [[1, 0.5, 0.006]], 0.0002);
    addNoise(d, sr, 55, 'bp', 3200, 2, 3, 0.004);
    return [normalize(d), sr];
  },
  // Long souffle tournoyant (tornade, rembobinage).
  whoosh() {
    const sr = SR_LOW;
    const len = Math.floor(sr * 1.6);
    const d = new Float32Array(len);
    const rnd = noiseGen(56);
    const b1 = new Biquad(sr, 'bp', 300, 1.6);
    const b2 = new Biquad(sr, 'bp', 700, 2);
    for (let n = 0; n < len; n++) {
      const x = n / len;
      if ((n & 15) === 0) {
        const f = 300 + 1100 * Math.pow(Math.sin(Math.PI * x), 1.5);
        b1.set('bp', f, 1.6);
        b2.set('bp', f * 2.3, 2);
      }
      const w = rnd();
      d[n] = (b1.run(w) + 0.35 * b2.run(w)) * Math.pow(Math.sin(Math.PI * x), 2);
    }
    return [normalize(d), sr];
  },
  // Scintillement de verre (givre, soin, échos) : petits partiels aigus épars.
  shimmer() {
    const sr = SR;
    const d = new Float32Array(Math.floor(sr * 1.3));
    const r = noiseGen(57);
    for (let k = 0; k < 14; k++) {
      const f = 2200 + 4600 * (r() * 0.5 + 0.5);
      const start = Math.floor(sr * 0.45 * Math.pow(r() * 0.5 + 0.5, 1.4));
      addModes(d, sr, f, [[1, 0.3 + 0.25 * (r() + 1), 0.08 + 0.14 * (r() + 1)]], 0.001, start);
    }
    addNoise(d, sr, 58, 'hp', 6000, 0.7, 0.3, 0.3, 0.02);
    return [normalize(d), sr];
  },
  // Bulle (« blorp ») : nuppeppō qui se divise, boue.
  bubble() {
    const sr = SR;
    const len = Math.floor(sr * 0.32);
    const d = new Float32Array(len);
    let ph = 0;
    for (let n = 0; n < len; n++) {
      const t = n / sr;
      ph += (2 * Math.PI * 170 * (1 + 2.2 * Math.min(1, t / 0.12)) * (1 + 0.07 * Math.sin(2 * Math.PI * 28 * t))) / sr;
      d[n] = Math.sin(ph) * Math.exp(-t / 0.07) * (1 - Math.exp(-t / 0.003));
    }
    return [normalize(d), sr];
  },
  // Goutte du suikinkutsu (jarre enterrée sous le bassin) : note claire et ronde.
  drop() {
    const sr = SR;
    const d = new Float32Array(Math.floor(sr * 0.7));
    addChirp(d, sr, 820, 1000, 0.01, 1, 0.16);
    addModes(d, sr, 2760, [[1, 0.15, 0.04]], 0.001);
    addNoise(d, sr, 60, 'bp', 3000, 1.2, 0.6, 0.0007);
    return [fadeOut(normalize(d), 0.2), sr];
  },
};

// Textures élémentaires jouées avec la cloche d'un combo : [timbre, volume, vitesse, délai].
const COMBO_TEX = {
  steam: [
    ['fireHit', 0.1, 0.8, 0.02],
    ['whoosh', 0.12, 1.8, 0],
  ],
  firestorm: [
    ['whoosh', 0.16, 1.3, 0],
    ['fireShot', 0.1, 0.7, 0.05],
  ],
  mud: [
    ['bubble', 0.1, 0.6, 0.02],
    ['bubble', 0.08, 0.8, 0.14],
  ],
  magma: [
    ['earthHit', 0.14, 0.7, 0],
    ['fireHit', 0.1, 0.6, 0.06],
  ],
  frost: [['shimmer', 0.14, 1, 0]],
  sandstorm: [
    ['gravel', 0.14, 0.8, 0],
    ['whoosh', 0.12, 1.5, 0.02],
  ],
};

// ───────────── musique : motifs rythmiques et percussions ─────────────

// Rythmes de motif (2 mesures de 8 croches) : [position, durée] en croches.
// prettier-ignore
const RHYTHMS = {
  calm: [
    [[0, 3], [3, 1], [4, 4], [10, 2], [12, 4]],
    [[0, 2], [2, 2], [4, 6], [12, 4]],
    [[0, 4], [6, 2], [8, 8]],
    [[1, 1], [2, 3], [6, 2], [8, 5], [14, 2]],
    [[0, 6], [8, 2], [10, 2], [12, 4]],
  ],
  wave: [
    [[0, 2], [2, 1], [3, 1], [4, 2], [6, 2], [8, 3], [11, 1], [12, 4]],
    [[0, 1], [1, 1], [2, 2], [4, 1], [5, 1], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]],
    [[0, 3], [3, 3], [6, 2], [8, 1], [9, 1], [10, 2], [12, 4]],
    [[0, 2], [2, 2], [4, 4], [8, 2], [10, 1], [11, 1], [12, 4]],
  ],
};
const WALK = [-2, -1, -1, 0, 1, 1, 2];

// Ostinato du koto grave : [croche, degré, volume].
// prettier-ignore
const BASS = {
  1: [[0, -5, 0.3], [3, -2, 0.17], [4, 0, 0.2], [6, -2, 0.17]],
  2: [[0, -5, 0.34], [2, -5, 0.16], [3, -2, 0.2], [4, 0, 0.22], [6, -2, 0.2], [7, -1, 0.16]],
};

// Taiko par mode (vague / boss ou dernière vague), mesure normale et mesure de
// relance (4e de la phrase) : volume par croche pour don (ō-daiko), ten (shime), ka.
// prettier-ignore
const DRUMS = {
  1: {
    don: [0.22, 0, 0, 0, 0, 0.12, 0.16, 0],
    ten: [0, 0, 0.08, 0, 0, 0, 0.08, 0.04],
    ka: [0, 0, 0, 0, 0.09, 0, 0, 0],
  },
  '1f': {
    don: [0.22, 0, 0, 0, 0.14, 0.16, 0.18, 0.22],
    ten: [0, 0, 0.08, 0, 0, 0, 0, 0],
    ka: [0, 0, 0, 0, 0, 0, 0, 0],
  },
  2: {
    don: [0.28, 0, 0, 0.16, 0.2, 0, 0.18, 0.12],
    ten: [0.06, 0.05, 0.1, 0.05, 0.06, 0.05, 0.1, 0.05],
    ka: [0, 0, 0.1, 0, 0, 0, 0.1, 0],
  },
  '2f': {
    don: [0.28, 0.16, 0.18, 0.2, 0.22, 0.24, 0.26, 0.3],
    ten: [0.06, 0, 0.1, 0, 0.06, 0, 0.1, 0],
    ka: [0, 0, 0, 0, 0, 0, 0, 0],
  },
};

// Courbe d'écrêtage doux (sécurité finale) : linéaire jusqu'à 0,8 puis tangente.
function softClipCurve() {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    c[i] = a < 0.8 ? x : Math.sign(x) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
  }
  return c;
}

// Fige un paramètre à sa valeur courante avant une nouvelle automatisation.
// Ignore le rejet éventuel d'une promesse (les anciens WebKit n'en renvoient pas).
function quiet(p) {
  if (p && p.catch) p.catch(() => {});
}

function hold(p, t) {
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
  else {
    const v = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
  }
}

export class Sound {
  constructor() {
    this.ctx = null;
    this._muted = false;
    this._musicOn = true;
    this._intensity = 0; // 0 calme (préparation), 1 vague en cours
    this.world = 'moss';
    this.scale = SCALES.moss;
    this.hidden = false; // page en arrière-plan
    this.woken = false; // tampon silencieux déjà joué dans un geste (iOS)
    this.offline = false; // contexte hors ligne (tests)
    this.tOffset = 0; // décalage temporel des sons (rendu hors ligne de test)
    this.last = new Map(); // limites de fréquence par son
    this.meters = new Map(); // densité récente par famille de sons
    this.bank = new Map(); // timbres → AudioBuffer
    this.kotoBank = new Map(); // cordes de koto (un tampon tous les deux demi-tons)
    this.voices = new Set();
    this.nSfx = 0;
    this.nMusic = 0;
    this.musicTimer = null;
    this.sleepTimer = null;
    // musique générative
    this.step = 0;
    this.nextStep = 0;
    this.stepDur = 0.48;
    this.mode = 0; // 0 calme, 1 vague, 2 boss ou dernière vague
    this.phrase = null;
    this.phraseN = 0;
    this.motif = null;
    this.bossActive = false;
    this.finalWave = false;
    this.totalWaves = 0;
    this.hushUntil = 0; // silence musical (ma 間) après les grands moments
    this.streak = 0;
    this.lastKill = -1e9;
    this.lastBossDown = -1e9;
    this.nextShishi = 0;
    this.nextBell = 0;
    this.drone = null;
    this.wind = null;
  }

  get muted() {
    return this._muted;
  }

  set muted(m) {
    this.setMuted(m);
  }

  get musicOn() {
    return this._musicOn;
  }

  set musicOn(v) {
    this._musicOn = !!v;
    this.applyMusic();
  }

  get intensity() {
    return this._intensity;
  }

  set intensity(v) {
    this._intensity = v;
    if (!v) {
      this.bossActive = false;
      this.finalWave = false;
    }
  }

  // ───────────── contexte, déblocage iOS, sortie ─────────────

  // À appeler dans un gestionnaire d'événement utilisateur.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      // iOS 17 : session « ambiante » (respecte le silencieux, se mêle à la musique de l'utilisateur).
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'ambient';
      } catch {
        /* non pris en charge */
      }
      let ctx;
      try {
        ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        try {
          ctx = new AC();
        } catch {
          return;
        }
      }
      this.init(ctx);
      ctx.onstatechange = () => this.onState();
      // Certains iOS n'acceptent la reprise que sur touchend / click : on écoute aussi.
      const h = () => this.wake();
      for (const ev of ['touchend', 'click', 'keydown']) document.addEventListener(ev, h, { capture: true, passive: true });
      this.startMusic();
      this.warm();
      if (this._muted) this.sleepTimer = setTimeout(() => this._muted && this.sleep(), 300);
    }
    this.wake();
  }

  // Construit le graphe audio sur un contexte (temps réel, ou hors ligne pour les tests).
  init(ctx) {
    this.ctx = ctx;
    this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    const c = ctx;
    const gain = (v, to) => {
      const g = c.createGain();
      g.gain.value = v;
      if (to) g.connect(to);
      return g;
    };
    // sortie : mix → compresseur (colle) → limiteur → écrêtage doux → coupure du son
    this.out = gain(this._muted ? 0 : 1, c.destination);
    const clip = c.createWaveShaper();
    clip.curve = softClipCurve();
    clip.connect(this.out);
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -3;
    lim.knee.value = 1;
    lim.ratio.value = 20;
    lim.attack.value = 0.001;
    lim.release.value = 0.1;
    lim.connect(clip);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 10;
    comp.ratio.value = 2.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(lim);
    this.mix = gain(0.8, comp);
    // réverbération : passe-haut d'abord (pas de traîne boueuse dans les graves)
    this.revIn = c.createBiquadFilter();
    this.revIn.type = 'highpass';
    this.revIn.frequency.value = 220;
    const conv = c.createConvolver();
    conv.buffer = this.makeImpulse(2.6);
    this.revIn.connect(conv);
    this.wet = gain(0.55, this.mix);
    conv.connect(this.wet);
    this.sends = { lo: gain(0.1, this.revIn), mid: gain(0.24, this.revIn), hi: gain(0.55, this.revIn) };
    // effets : bus général, et bus des sons fréquents (atténué lors des grands moments)
    this.sfx = gain(0.9, this.mix);
    this.freq = gain(1, this.sfx);
    // musique : marche/arrêt → atténuation (ducking) → filtre (effet de rembobinage)
    this.musicBus = gain(this._musicOn ? 0.5 : 0);
    this.musicDuck = gain(1);
    this.musicTone = c.createBiquadFilter();
    this.musicTone.type = 'lowpass';
    this.musicTone.frequency.value = 18000;
    this.musicTone.Q.value = 0.5;
    this.musicBus.connect(this.musicDuck).connect(this.musicTone).connect(this.mix);
    this.musicSend = gain(0.32, this.revIn);
    this.musicTone.connect(this.musicSend);
    // ambiance du jardin (dans la musique) et sa réverbération plus généreuse
    this.amb = gain(1, this.musicBus);
    this.ambVerb = gain(this._musicOn ? 0.4 : 0, this.revIn);
    this.canPan = typeof c.createStereoPanner === 'function';
    // certains moteurs refusent les tampons à basse fréquence : on suréchantillonne alors
    try {
      c.createBuffer(1, 1, SR_BELL);
      this.minRate = SR_BELL;
    } catch {
      this.minRate = 22050;
    }
    this.silent = c.createBuffer(1, 1, c.sampleRate);
    const nd = new Float32Array(SR * 2);
    const rnd = noiseGen(99);
    for (let i = 0; i < nd.length; i++) nd[i] = rnd();
    this.noiseBuf = this.toBuffer(nd, SR);
    // shakuhachi : fondamental dominant, harmoniques faibles (tube ouvert en bambou)
    this.shakuWave = c.createPeriodicWave(new Float32Array(7), new Float32Array([0, 1, 0.3, 0.16, 0.07, 0.04, 0.02]));
  }

  // Relance la sortie quand elle doit tourner (dans un geste : exigence iOS).
  wake() {
    const c = this.ctx;
    if (!c || this.offline || this._muted || this.hidden) return;
    if (c.state !== 'running' || !this.woken) {
      this.woken = true;
      try {
        quiet(c.resume());
      } catch {
        /* contexte fermé */
      }
      // iOS : lire un tampon (même silencieux) pendant le geste déverrouille la sortie.
      try {
        const s = c.createBufferSource();
        s.buffer = this.silent;
        s.connect(c.destination);
        s.onended = () => s.disconnect();
        s.start(0);
      } catch {
        /* sans effet */
      }
    }
  }

  // Changement d'état du contexte : iOS « interrompt » la sortie (appel, Siri,
  // changement de casque…). Si ce n'est pas nous qui l'avons mise en veille, on la
  // relance ; à défaut, le prochain geste s'en charge (wake).
  onState() {
    const c = this.ctx;
    if (c.state === 'running') {
      if (this.nextStep < c.currentTime) this.nextStep = c.currentTime + 0.1;
      return;
    }
    if ((c.state === 'interrupted' || c.state === 'suspended') && !this.hidden && !this._muted) {
      try {
        quiet(c.resume());
      } catch {
        /* un prochain geste relancera */
      }
    }
  }

  sleep() {
    const c = this.ctx;
    if (c && !this.offline && c.state === 'running') quiet(c.suspend());
  }

  // Coupure instantanée (fondu de quelques ms, sans clic), puis mise en veille du
  // contexte : plus aucun calcul audio tant que le son est coupé.
  setMuted(m) {
    this._muted = !!m;
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const g = this.out.gain;
    hold(g, t);
    clearTimeout(this.sleepTimer);
    if (this._muted) {
      g.setTargetAtTime(0, t, 0.006);
      this.sleepTimer = setTimeout(() => {
        if (!this._muted) return;
        this.stopAll();
        this.sleep();
      }, 120);
    } else {
      this.wake();
      g.setTargetAtTime(1, t, 0.01);
      this.nextStep = 0; // le séquenceur repart proprement
    }
  }

  suspend() {
    this.hidden = true;
    this.sleep();
  }

  resume() {
    this.hidden = false;
    this.wake();
  }

  // Optionnel : ambiance musicale du monde ('moss' | 'snow'), à appeler au lancement d'un niveau.
  setWorld(w) {
    const id = SCALES[w] ? w : 'moss';
    if (id === this.world) return;
    this.world = id;
    this.scale = SCALES[id];
    this.phrase = null;
    this.motif = null;
    this.applyMusic();
  }

  ready() {
    const c = this.ctx;
    return !!c && !this._muted && (this.offline || (c.state === 'running' && !this.hidden));
  }

  now() {
    return this.ctx.currentTime + this.tOffset;
  }

  ms() {
    return this.offline ? this.now() * 1000 : performance.now();
  }

  // Limite la fréquence d'un même son (évite la saturation pendant les vagues).
  throttle(key, ms) {
    const now = this.ms();
    const t = this.last.get(key);
    if (t !== undefined && now - t < ms) return false;
    this.last.set(key, now);
    return true;
  }

  // Densité récente d'une famille de sons (moyenne glissante exponentielle, tau en s).
  density(key, tau) {
    const now = this.ms() / 1000;
    const m = this.meters.get(key) || { v: 0, t: now };
    m.v = m.v * Math.exp(-(now - m.t) / tau) + 1;
    m.t = now;
    this.meters.set(key, m);
    return m.v - 1;
  }

  pan(x) {
    return x == null ? 0 : clamp((x / 9 - 0.5) * 0.7, -0.35, 0.35);
  }

  nf(degree, octave = 0) {
    return BASE * Math.pow(2, this.semis(degree, octave) / 12);
  }

  semis(degree, octave = 0) {
    const sc = this.scale;
    const n = sc.length;
    return sc[((degree % n) + n) % n] + 12 * (Math.floor(degree / n) + octave);
  }

  makeImpulse(seconds) {
    const c = this.ctx;
    const sr = c.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = c.createBuffer(2, len, sr);
    const pre = Math.floor(sr * 0.012);
    const T60 = seconds * 0.9;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const rnd = noiseGen(ch + 5);
      // premières réflexions : quelques échos discrets (murets, lanternes de pierre)
      for (let k = 0; k < 7; k++) d[pre + Math.floor(sr * (0.006 + 0.07 * Math.pow(rnd() * 0.5 + 0.5, 1.5)))] += rnd() * 0.6 * (1 - k / 8);
      // queue diffuse : les aigus s'éteignent plus vite que les graves (bois, mousse)
      let lp = 0;
      let a = 0;
      let comp = 1;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        if (((i - pre) & 63) === 0) {
          const fc = 6500 * Math.exp(-t * 1.3) + 900;
          a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
          comp = Math.pow(sr / (2 * fc), 0.25); // compense en partie l'énergie perdue au filtrage
        }
        lp += a * (rnd() - lp);
        d[i] += lp * comp * Math.exp((-6.9 * t) / T60) * Math.min(1, t / 0.025);
      }
    }
    return buf;
  }

  toBuffer(data, sr) {
    while (sr < this.minRate) {
      const u = new Float32Array(data.length * 2);
      for (let i = 0; i < data.length; i++) {
        u[2 * i] = data[i];
        u[2 * i + 1] = i + 1 < data.length ? (data[i] + data[i + 1]) / 2 : data[i];
      }
      data = u;
      sr *= 2;
    }
    const b = this.ctx.createBuffer(1, data.length, sr);
    b.getChannelData(0).set(data);
    return b;
  }

  // Timbre de la banque, calculé à la première demande.
  sample(name) {
    let b = this.bank.get(name);
    if (!b) {
      const r = SAMPLES[name];
      if (!r) return null;
      const [data, sr] = r((n) => this.sample(n).getChannelData(0));
      b = this.toBuffer(data, sr);
      this.bank.set(name, b);
    }
    return b;
  }

  kotoNote(freq) {
    const key = 2 * Math.round((69 + 12 * Math.log2(freq / 440)) / 2);
    let k = this.kotoBank.get(key);
    if (!k) {
      const [data, f, sr] = renderKoto(440 * Math.pow(2, (key - 69) / 12));
      k = { buf: this.toBuffer(data, sr), f };
      this.kotoBank.set(key, k);
    }
    return { buf: k.buf, rate: freq / k.f };
  }

  // Pré-calcule la banque par petites tâches après le déblocage (pas d'à-coup).
  warm() {
    const first = [5, 7, 8, 6, -5, -2];
    const jobs = first.map((d) => () => this.kotoNote(this.nf(d)));
    jobs.push(...Object.keys(SAMPLES).map((n) => () => this.sample(n)));
    for (let d = -5; d <= 15; d++) if (!first.includes(d)) jobs.push(() => this.kotoNote(this.nf(d)));
    const next = () => {
      const j = jobs.shift();
      if (!j) return;
      j();
      setTimeout(next, 40);
    };
    setTimeout(next, 250);
  }

  // ───────────── voix (polyphonie bornée, aucune fuite) ─────────────

  // Budget de voix d'effets : au-delà du seuil, les sons fréquents sont ignorés ;
  // plafond atteint, un son important vole la voix la moins prioritaire et la plus
  // ancienne (le total ne dépasse jamais MAX_SFX).
  admit(prio) {
    if (this.nSfx < SOFT_SFX) return true;
    if (prio === 0) return false;
    if (this.nSfx < MAX_SFX) return true;
    if (prio < 2) return false;
    let old = null;
    for (const v of this.voices) {
      if (!v.counted || v.music) continue;
      if (!old || v.prio < old.prio || (v.prio === old.prio && v.t < old.t)) old = v;
    }
    if (old) this.fadeVoice(old);
    return true;
  }

  // Joue un tampon : source + gain (+ panoramique). Renvoie la voix, ou null.
  voice(buf, o = {}) {
    if (!buf) return null;
    const music = !!o.music;
    const prio = o.prio ?? 1;
    if (music ? this.nMusic >= MAX_MUSIC : !this.admit(prio)) return null;
    const c = this.ctx;
    const t = this.now() + Math.max(0, o.when || 0);
    const rate = o.rate || 1;
    const vel = o.vel ?? 0.5;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = vel;
    src.connect(g);
    const nodes = [src, g];
    let tail = g;
    if (o.pan && this.canPan) {
      const p = c.createStereoPanner();
      p.pan.value = o.pan;
      g.connect(p);
      nodes.push(p);
      tail = p;
    }
    tail.connect(o.out || this.sfx);
    if (o.send) tail.connect(o.send);
    const offset = o.offset || 0;
    let len = (buf.duration - offset) / rate;
    if (o.dur && o.dur < len) {
      // étouffement (main posée sur la corde) plutôt qu'une coupure sèche
      const r = Math.min(0.12, o.dur * 0.3);
      g.gain.setValueAtTime(vel, t + o.dur - r);
      g.gain.linearRampToValueAtTime(0, t + o.dur);
      len = o.dur;
    }
    src.start(t, offset);
    src.stop(t + len + 0.02);
    return this.track({ srcs: [src], nodes, g, prio, music, t, end: t + len }, src);
  }

  track(v, main) {
    v.counted = true;
    this.voices.add(v);
    if (v.music) this.nMusic++;
    else this.nSfx++;
    main.onended = () => this.release(v);
    return v;
  }

  uncount(v) {
    if (!v.counted) return;
    v.counted = false;
    if (v.music) this.nMusic--;
    else this.nSfx--;
  }

  release(v) {
    this.uncount(v);
    if (!this.voices.delete(v)) return;
    for (const n of v.nodes) {
      try {
        n.disconnect();
      } catch {
        /* déjà déconnecté */
      }
    }
  }

  // Éteint une voix en quelques millisecondes (vol de voix).
  fadeVoice(v) {
    this.uncount(v);
    const t = this.ctx.currentTime;
    try {
      hold(v.g.gain, t);
      v.g.gain.setTargetAtTime(0, t, 0.008);
      for (const s of v.srcs) s.stop(t + 0.06);
    } catch {
      /* voix déjà terminée */
    }
  }

  stopAll() {
    for (const v of [...this.voices]) {
      for (const s of v.srcs) {
        try {
          s.stop();
        } catch {
          /* pas encore démarrée ou déjà arrêtée */
        }
      }
      this.release(v);
    }
  }

  // Filet de sécurité : libère une voix dont la fin n'a pas été signalée.
  sweep() {
    const t = this.now() - 1.5;
    for (const v of this.voices) if (v.end < t) this.release(v);
  }

  // Atténuation momentanée de la musique et des sons fréquents (grands moments).
  duck(level, holdT = 0.5, rel = 0.8) {
    const t = this.now();
    for (const p of [this.musicDuck.gain, this.freq.gain]) {
      hold(p, t);
      p.linearRampToValueAtTime(level, t + 0.04);
      p.setValueAtTime(level, t + 0.04 + holdT);
      p.linearRampToValueAtTime(1, t + 0.04 + holdT + rel);
    }
  }

  hush(sec) {
    this.hushUntil = Math.max(this.hushUntil, this.now() + sec);
  }

  // ───────────── instruments ─────────────

  fx(name, o = {}) {
    return this.voice(this.sample(name), { out: this.sfx, send: this.sends.lo, ...o });
  }

  isMusic(out) {
    return out === this.musicBus || out === this.amb;
  }

  // Koto : corde pincée (tampon Karplus-Strong), légère surtension à l'attaque,
  // et oshide en option (pression derrière le chevalet : la note monte).
  koto(freq, when = 0, vel = 0.5, dur = 0, out = this.sfx, o = {}) {
    const k = this.kotoNote(freq);
    const music = this.isMusic(out);
    const v = this.voice(k.buf, { when, vel, rate: k.rate, out, dur, music, pan: o.pan, prio: o.prio ?? 1, send: o.send ?? (music ? null : this.sends.mid) });
    if (!v) return null;
    const p = v.srcs[0].playbackRate;
    const t = v.t;
    p.setValueAtTime(k.rate * 1.006, t);
    p.exponentialRampToValueAtTime(k.rate, t + 0.07);
    if (o.bend) {
      p.setValueAtTime(k.rate, t + o.bendAt);
      p.exponentialRampToValueAtTime(k.rate * Math.pow(2, o.bend / 12), t + o.bendAt + 0.14);
    }
    return v;
  }

  // Glissando de koto (balayage des cordes).
  gliss(degs, when, spacing, vel, pan = 0) {
    degs.forEach((d, i) => this.koto(this.nf(d), when + i * spacing, vel * (0.85 + (0.3 * i) / degs.length), 1.6, this.sfx, { pan, prio: 2 }));
  }

  // Taiko : `pitch` transpose le fût (1 = ō-daiko grave).
  taiko(when = 0, vel = 0.6, pitch = 1, out = this.sfx, prio = 2) {
    const music = this.isMusic(out);
    return this.voice(this.sample('taiko'), { when, vel, rate: pitch, out, music, prio, send: music ? null : this.sends.mid });
  }

  // Cloche : bonshō sous 300 Hz, rin au-dessus (transposés par la vitesse de lecture).
  bell(freq, when = 0, vel = 0.4, dur = 0, out = this.sfx, o = {}) {
    const big = freq < 300;
    const music = this.isMusic(out);
    return this.voice(this.sample(big ? 'bonsho' : 'rin'), {
      when,
      vel,
      dur,
      out,
      music,
      rate: freq / (big ? 110 : 660),
      pan: o.pan,
      prio: o.prio ?? 2,
      send: o.send ?? (out === this.amb ? this.ambVerb : music ? null : this.sends.hi),
    });
  }

  // Son renversé calé pour culminer dans `endIn` secondes.
  swell(name, rate, endIn, vel, prio = 2) {
    const buf = this.sample(name);
    const real = buf.duration / rate;
    return this.voice(buf, { when: Math.max(0, endIn - real), offset: Math.max(0, buf.duration - endIn * rate), vel, rate, prio, send: this.sends.hi });
  }

  glide(v, factor, dt) {
    if (!v) return;
    const p = v.srcs[0].playbackRate;
    p.setValueAtTime(p.value, v.t);
    p.exponentialRampToValueAtTime(p.value * factor, v.t + dt);
  }

  // Shakuhachi : flûte de bambou. La note s'installe par en dessous (meri → kari),
  // souffle très présent à l'attaque (muraiki), vibrato (yuri) qui vient tard.
  shakuhachi(freq, when, dur, vel = 0.3, out = this.musicBus) {
    if (this.nMusic >= MAX_MUSIC - 2 || dur < 0.8) return;
    const c = this.ctx;
    const t = this.now() + Math.max(0, when);
    const end = t + dur;
    const o = c.createOscillator();
    o.setPeriodicWave(this.shakuWave);
    const f = o.frequency;
    f.setValueAtTime(freq * 0.965, t);
    f.exponentialRampToValueAtTime(freq, t + 0.16);
    f.setValueAtTime(freq, end - 0.25);
    f.exponentialRampToValueAtTime(freq * 0.985, end);
    const lfo = c.createOscillator();
    lfo.frequency.value = 4.6 + Math.random() * 0.8;
    const depth = c.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(0, t + Math.min(0.5, dur * 0.35));
    depth.gain.linearRampToValueAtTime(freq * 0.009, t + Math.min(1.2, dur * 0.7));
    lfo.connect(depth).connect(f);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(4000, freq * 5);
    lp.Q.value = 0.4;
    const tone = c.createGain();
    const g = tone.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(vel, t + 0.14);
    g.linearRampToValueAtTime(vel * 0.82, t + Math.min(0.4, dur * 0.4));
    g.linearRampToValueAtTime(vel, Math.max(t + 0.45, end - 0.35));
    g.linearRampToValueAtTime(0, end);
    o.connect(lp).connect(tone).connect(out);
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * 2;
    bp.Q.value = 1.6;
    const breath = c.createGain();
    const b = breath.gain;
    b.setValueAtTime(0, t);
    b.linearRampToValueAtTime(vel * 2.5, t + 0.05);
    b.linearRampToValueAtTime(vel * 0.6, t + 0.3);
    b.setValueAtTime(vel * 0.6, Math.max(t + 0.31, end - 0.3));
    b.linearRampToValueAtTime(0, end);
    n.connect(bp).connect(breath).connect(out);
    const srcs = [o, lfo, n];
    for (const s of srcs) {
      s.start(t, s === n ? Math.random() * 1.5 : undefined);
      s.stop(end + 0.05);
    }
    this.track({ srcs, nodes: [o, lfo, depth, lp, tone, n, bp, breath], g: tone, prio: 1, music: true, t, end }, o);
  }

  // Bourdon (ré + la, doucement filtré et respirant) : le fond de la musique.
  startDrone() {
    if (this.drone) return;
    const c = this.ctx;
    const t = this.now();
    const g = c.createGain();
    g.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.7;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.06;
    const lg = c.createGain();
    lg.gain.value = 140;
    lfo.connect(lg).connect(lp.frequency);
    const nodes = [g, lp, lfo, lg];
    const srcs = [lfo];
    const root = BASE / 2;
    for (const [f, type, a] of [
      [root, 'triangle', 0.5],
      [root * 1.003, 'triangle', 0.35],
      [root * 1.4983, 'sine', 0.25],
      [BASE, 'sine', 0.18],
      [BASE * 1.4983, 'sine', 0.08],
    ]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = c.createGain();
      og.gain.value = a;
      o.connect(og).connect(lp);
      nodes.push(o, og);
      srcs.push(o);
    }
    lp.connect(g).connect(this.musicBus);
    for (const s of srcs) s.start(t);
    this.drone = { g, lp, nodes, srcs };
    this.levels();
  }

  // Vent du temple sous la neige : bruit filtré, rafales lentes.
  startWind() {
    if (this.wind) return;
    const c = this.ctx;
    const t = this.now();
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.9;
    const g = c.createGain();
    g.gain.value = 0;
    const l1 = c.createOscillator();
    l1.frequency.value = 0.09;
    const l1g = c.createGain();
    l1g.gain.value = 260;
    l1.connect(l1g).connect(bp.frequency);
    const l2 = c.createOscillator();
    l2.frequency.value = 0.05;
    const l2g = c.createGain();
    l2g.gain.value = 0.25;
    const gust = c.createGain();
    gust.gain.value = 1;
    l2.connect(l2g).connect(gust.gain);
    n.connect(bp).connect(gust).connect(g).connect(this.amb);
    const srcs = [n, l1, l2];
    for (const s of srcs) s.start(t);
    this.wind = { g, nodes: [n, bp, g, l1, l1g, l2, l2g, gust], srcs };
    this.levels();
  }

  stopLayer(layer) {
    if (!layer) return;
    const t = this.now();
    hold(layer.g.gain, t);
    layer.g.gain.setTargetAtTime(0, t, 0.4);
    for (const s of layer.srcs) s.stop(t + 2.5);
    layer.srcs[0].onended = () => layer.nodes.forEach((n) => n.disconnect());
  }

  // Niveaux du bourdon et du vent selon le mode (calme / vague / boss).
  levels() {
    if (!this.ctx) return;
    const t = this.now();
    if (this.drone) {
      hold(this.drone.g.gain, t);
      this.drone.g.gain.setTargetAtTime([0.06, 0.035, 0.045][this.mode], t, 1.2);
      this.drone.lp.frequency.setTargetAtTime(this.world === 'snow' ? 420 : 520, t, 1); // neige : plus feutré
    }
    if (this.wind) {
      hold(this.wind.g.gain, t);
      this.wind.g.gain.setTargetAtTime(this.mode ? 0.06 : 0.11, t, 1.5);
    }
  }

  // Marche/arrêt de la musique et couches persistantes (bourdon, vent).
  applyMusic() {
    if (!this.ctx) return;
    const t = this.now();
    const on = this._musicOn;
    for (const [p, v] of [
      [this.musicBus.gain, 0.5],
      [this.ambVerb.gain, 0.4],
    ]) {
      hold(p, t);
      p.setTargetAtTime(on ? v : 0, t, 0.25);
    }
    if (on) {
      this.startDrone();
      this.levels();
      if (this.world === 'snow') this.startWind();
      else {
        this.stopLayer(this.wind);
        this.wind = null;
      }
      if (this.nextStep < t) this.nextStep = t + 0.1;
    } else {
      this.stopLayer(this.drone);
      this.stopLayer(this.wind);
      this.drone = this.wind = null;
    }
  }

  // ───────────── effets de jeu ─────────────

  play(name, data = {}) {
    if (!this.ready()) return;
    const S = this.sends;
    switch (name) {
      case 'tap':
        if (this.throttle('tap', 40)) this.fx('tick', { vel: 0.03, rate: 0.95 + Math.random() * 0.1, out: this.freq, prio: 0, send: null });
        break;
      case 'select':
        if (this.throttle('select', 60)) this.koto(this.nf(7), 0, 0.13, 0.7, this.sfx, { prio: 2 });
        break;
      case 'shoot': {
        const el = data.element;
        if (!this.throttle('shoot-' + el, 85)) return;
        const d = this.density('shoot', 0.5);
        if (d > 7) return;
        const lv = data.tower?.level || 1;
        const g = ((data.echo ? 0.5 : 1) * (1 + 0.12 * (lv - 1))) / Math.sqrt(1 + d * 0.35);
        const rate = (data.echo ? 0.94 : 1) * (1 - 0.06 * (lv - 1)) * (0.94 + Math.random() * 0.12);
        const o = { out: this.freq, prio: 0, pan: this.pan(data.tower?.x), send: data.echo ? S.hi : S.lo };
        if (el === 'fire') this.fx('fireShot', { ...o, vel: 0.088 * g, rate });
        else if (el === 'water') this.fx('waterShot', { ...o, vel: 0.085 * g, rate: rate * Math.pow(2, pick(this.scale) / 12) });
        else if (el === 'wind') this.fx('windShot', { ...o, vel: 0.08 * g, rate });
        else if (el === 'earth') this.fx('earthShot', { ...o, vel: 0.095 * g, rate });
        break;
      }
      case 'hit': {
        const el = data.element;
        if (!this.throttle('hit-' + el, 70)) return;
        const d = this.density('hit', 0.5);
        if (d > 6) return;
        const g = ((data.echo ? 0.6 : 1) * (data.splash ? 1.2 : 1)) / Math.sqrt(1 + d * 0.35);
        const o = { out: this.freq, prio: 0, pan: this.pan(data.x), rate: 0.94 + Math.random() * 0.12 };
        if (el === 'earth') this.fx('earthHit', { ...o, vel: 0.12 * g, send: S.mid, rate: o.rate * (data.splash ? 0.9 : 1) });
        else if (el === 'water') this.fx('waterHit', { ...o, vel: 0.07 * g });
        else if (el === 'fire') this.fx('fireHit', { ...o, vel: 0.085 * g });
        else if (el === 'wind') this.fx('windHit', { ...o, vel: 0.05 * g });
        break;
      }
      case 'kill': {
        if (!this.throttle('kill', 55)) return;
        // série d'apaisements rapprochés : les notes montent la gamme
        const t = this.ms();
        this.streak = t - this.lastKill < 700 ? this.streak + 1 : 0;
        this.lastKill = t;
        const pan = this.pan(data.enemy?.x);
        this.koto(this.nf(5 + (this.streak % 7)), 0, 0.2, 0.9, this.freq, { prio: 0, pan });
        this.fx('windHit', { vel: 0.035, rate: 1.4, out: this.freq, prio: 0, send: S.hi, pan });
        break;
      }
      case 'bossDown':
        this.lastBossDown = this.ms();
        this.duck(0.35, 1.2, 1.5);
        this.hush(3);
        this.taiko(0, 0.4, 0.8);
        this.taiko(0.18, 0.26, 0.85);
        this.bell(this.nf(-5), 0.05, 0.22, 6);
        this.gliss([0, 2, 3, 5, 7, 8, 10, 12], 0.25, 0.05, 0.13);
        this.bell(this.nf(10), 0.7, 0.14, 3.5);
        break;
      case 'place': {
        // activation (fin de la construction) : bois, koto, puis une cloche (coéquipier : à 50 %)
        if (!this.throttle('place', 50)) return;
        const pan = this.pan(data.tower?.x);
        const k = data.pid != null && this.localPid != null && data.pid !== this.localPid ? 0.5 : 1;
        this.fx('stoneKnock', { vel: 0.14 * k, pan, prio: 2 });
        this.koto(this.nf(5), 0.02, 0.16 * k, 1.2, this.sfx, { pan, prio: 2 });
        this.koto(this.nf(7), 0.08, 0.14 * k, 1.2, this.sfx, { pan, prio: 2 });
        this.bell(this.nf(12), 0.06, 0.08 * k, 1.6, this.sfx, { pan, prio: 1 });
        break;
      }
      case 'build': {
        // pose au relâchement du doigt (la construction commence) : pierre, puis bambou
        if (!this.throttle('build', 60)) return;
        const pan = this.pan(data.x);
        this.fx('stoneKnock', { vel: 0.12, rate: 1.1, pan, prio: 2 });
        this.fx('bamboo', { vel: 0.09, rate: 1.25, when: 0.04, pan, prio: 2 });
        break;
      }
      case 'undo':
        this.koto(this.nf(7), 0, 0.13, 0.8, this.sfx, { prio: 2 });
        this.koto(this.nf(5), 0.07, 0.13, 0.9, this.sfx, { prio: 2 });
        break;
      case 'coin':
        if (this.throttle('coin', 45)) this.bell(this.nf(13), 0, 0.05, 0.6, this.sfx, { prio: 1 });
        break;
      case 'tick':
        if (this.throttle('tick', 70)) this.fx('tick', { vel: 0.02, rate: 1.1, out: this.freq, prio: 0, send: null });
        break;
      case 'sell': {
        if (!this.throttle('sell', 50)) return;
        const pan = this.pan(data.tower?.x);
        this.koto(this.nf(8), 0, 0.16, 0.8, this.sfx, { pan, prio: 2 });
        this.koto(this.nf(6), 0.08, 0.15, 0.9, this.sfx, { pan, prio: 2 });
        this.bell(this.nf(13), 0.12, 0.05, 1.2, this.sfx, { prio: 1, pan }); // tintement des pièces
        break;
      }
      case 'fuse': {
        if (!this.throttle('fuse', 80)) return;
        const big = data.level >= 3;
        const pan = this.pan(data.tower?.x);
        this.duck(big ? 0.45 : 0.65, 0.6, 1);
        this.gliss(big ? [3, 4, 5, 6, 7, 8, 9, 10] : [2, 3, 4, 5, 6, 7], 0, big ? 0.04 : 0.045, big ? 0.17 : 0.2, pan);
        this.bell(this.nf(big ? 10 : 8), big ? 0.34 : 0.28, big ? 0.2 : 0.2, 3.5, this.sfx, { pan });
        this.fx('shimmer', { when: 0.25, vel: big ? 0.08 : 0.06, send: S.hi, pan });
        if (big) {
          this.bell(this.nf(-5), 0.3, 0.16, 5);
          this.taiko(0.3, 0.26, 1.1);
        }
        break;
      }
      case 'combo': {
        if (!this.throttle('combo', 160)) return;
        const pan = this.pan(data.x);
        this.duck(0.7, 0.4, 0.8);
        this.bell(this.nf(9), 0, 0.26, 3, this.sfx, { pan });
        this.koto(this.nf(4), 0.04, 0.24, 1.2, this.sfx, { pan });
        this.koto(this.nf(7), 0.1, 0.22, 1.2, this.sfx, { pan });
        for (const [n, v, r, w] of COMBO_TEX[data.def?.id] || []) this.fx(n, { vel: v, rate: r, when: w, pan, send: S.mid });
        break;
      }
      case 'stone':
        if (!this.throttle('stone', 50)) return;
        this.fx('gravel', { vel: 0.24, prio: 2, pan: this.pan(data.c != null ? data.c + 0.5 : null) });
        this.fx('stoneKnock', { vel: 0.11, rate: 0.55, when: 0.01, prio: 2 });
        break;
      case 'unstone':
        if (!this.throttle('stone', 50)) return;
        this.fx('gravel', { vel: 0.22, rate: 1.2, prio: 2, pan: this.pan(data.c != null ? data.c + 0.5 : null) });
        this.fx('stoneKnock', { vel: 0.1, rate: 0.7, prio: 2 });
        break;
      case 'reject':
        if (!this.throttle('reject', 150)) return;
        // « tok-tok » descendant du bloc de bois : clair, jamais agressif
        this.fx('woodBlock', { vel: 0.26, rate: 0.95, prio: 2 });
        this.fx('woodBlock', { vel: 0.22, rate: 0.78, when: 0.085, prio: 2 });
        break;
      case 'leak':
        if (!this.throttle('leak', 250)) return;
        this.duck(0.6, 0.3, 0.8);
        this.taiko(0, 0.32, 0.75);
        this.bell(this.nf(-2), 0.03, 0.1, 2.2);
        this.bell(this.nf(-2) * 1.06, 0.03, 0.07, 2.2); // seconde mineure : l'alerte
        break;
      case 'waveStart': {
        const last = data.index != null && data.index === data.total - 1;
        this.duck(0.4, 1.2, 1.2);
        // hyōshigi : les claquoirs du kabuki annoncent la vague, puis les taiko
        const claps = last ? [0, 0.26, 0.44] : [0, 0.3];
        claps.forEach((w, i) => this.fx('hyoshigi', { when: w, vel: 0.24 + i * 0.04, send: S.hi, prio: 2 }));
        const t0 = claps[claps.length - 1] + 0.32;
        this.taiko(t0, 0.36);
        this.taiko(t0 + 0.2, 0.28);
        if (last) this.taiko(t0 + 0.32, 0.3);
        this.taiko(t0 + 0.42, 0.55, 0.95);
        this.bell(this.nf(0), t0 + 0.42, last ? 0.26 : 0.18, 4);
        break;
      }
      case 'waveEnd':
        [5, 7, 8, 10].forEach((d, i) => this.koto(this.nf(d), [0, 0.11, 0.22, 0.38][i], 0.17 + i * 0.015, 1.8));
        this.bell(this.nf(15), 0.38, 0.07, 2.5);
        break;
      case 'win': {
        // si le boss vient de tomber, la victoire attend la fin de sa cloche
        const w0 = Math.max(0, 1.2 - (this.ms() - this.lastBossDown) / 1000);
        this.duck(0.3, 2.5 + w0, 2);
        this.hush(6 + w0);
        this.taiko(w0, 0.3);
        this.taiko(w0 + 0.16, 0.22);
        this.taiko(w0 + 0.34, 0.36);
        this.bell(this.nf(0), w0 + 0.34, 0.2, 6);
        this.gliss([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], w0 + 0.5, 0.035, 0.12);
        [5, 7, 8, 10, 12, 13, 15].forEach((d, i) => this.koto(this.nf(d), w0 + 1.0 + i * 0.15, 0.17, 2, this.sfx, { prio: 2 }));
        this.bell(this.nf(10), w0 + 2.1, 0.16, 4);
        this.bell(this.nf(13), w0 + 2.1, 0.11, 4);
        break;
      }
      case 'lose':
        this.duck(0.25, 3, 2);
        this.hush(8);
        [9, 7, 5, 3, 0].forEach((d, i) => this.koto(this.nf(d), i * 0.26, 0.2, 2.2, this.sfx, { prio: 2 }));
        this.bell(this.nf(-5), 0.2, 0.26, 6);
        this.taiko(0.2, 0.24, 0.7);
        break;
      case 'rewind': {
        // le temps s'aspire à l'envers : cloches renversées, souffle qui descend,
        // koto qui se déroule de plus en plus vite, musique étouffée
        const dur = 1.1;
        this.duck(0.35, dur, 0.6);
        this.hush(dur + 0.4);
        const f = this.musicTone.frequency;
        const t = this.now();
        hold(f, t);
        f.exponentialRampToValueAtTime(500, t + dur * 0.4);
        f.setValueAtTime(500, t + dur);
        f.exponentialRampToValueAtTime(18000, t + dur + 0.5);
        this.swell('rinRev', this.nf(10) / 660, dur, 0.26);
        this.swell('bonshoRev', this.nf(-5) / 110, dur, 0.22);
        this.glide(this.fx('whoosh', { vel: 0.13, rate: 1.4, send: S.hi, prio: 2 }), 0.43, dur);
        [12, 11, 10, 9, 8, 7, 6, 5, 4].forEach((d, i) =>
          this.koto(this.nf(d), 0.9 * (1 - Math.pow(1 - i / 9, 1.6)), 0.14, 0.6, this.sfx, { prio: 2, send: S.hi }),
        );
        break;
      }
      case 'rewindEnd':
        this.bell(this.nf(10), 0, 0.24, 3);
        this.fx('hyoshigi', { vel: 0.16, send: S.hi, prio: 2 });
        this.koto(this.nf(5), 0.02, 0.2, 1.5);
        break;
      case 'echo':
        if (!this.throttle('echo', 250)) return;
        this.bell(this.nf(12), 0.05, 0.12, 2.5);
        this.bell(this.nf(12) * 1.007, 0.06, 0.09, 2.5); // battement fantomatique
        this.fx('shimmer', { vel: 0.05, rate: 0.8, send: S.hi });
        break;
      case 'echoFade':
        if (this.throttle('echoFade', 400)) this.swell('rinRev', this.nf(14) / 660, 0.6, 0.05, 0);
        break;
      case 'stomp':
        this.duck(0.5, 0.3, 0.6);
        this.taiko(0, 0.5, 0.62);
        this.fx('earthHit', { vel: 0.22, rate: 0.6, send: S.mid, prio: 2, pan: this.pan(data.enemy?.x) });
        this.fx('gravel', { vel: 0.1, rate: 0.7, when: 0.03 });
        break;
      case 'boss':
        this.duck(0.35, 1.5, 1.5);
        this.taiko(0, 0.32, 0.7);
        this.taiko(0.38, 0.34, 0.66);
        this.taiko(0.62, 0.22, 0.7);
        this.bell(73.4, 0.1, 0.22, 6);
        this.bell(73.4 * 1.06, 0.12, 0.09, 5); // dissonance sombre
        break;
      case 'enrage':
        this.duck(0.45, 0.8, 1);
        for (let i = 0; i < 7; i++) this.taiko(0.6 * (1 - Math.pow(1 - i / 7, 1.5)), 0.12 + i * 0.022, 0.75 + i * 0.02);
        this.bell(this.nf(-4), 0.6, 0.12, 4);
        this.bell(this.nf(-4) * 1.06, 0.6, 0.07, 4);
        break;
      case 'summon':
        if (!this.throttle('summon', 600)) return;
        this.swell('bonshoRev', 0.9, 0.7, 0.16);
        this.fx('bubble', { vel: 0.1, rate: 0.55, when: 0.6, send: S.hi });
        break;
      case 'absorbShift':
        if (this.throttle('absorbShift', 500)) this.glide(this.bell(this.nf(9), 0, 0.12, 1.8), 0.84, 0.6);
        break;
      case 'heal':
        if (this.throttle('heal', 400)) this.fx('shimmer', { vel: 0.05, rate: 1.25, out: this.freq, prio: 0, send: S.hi });
        break;
      case 'absorb':
        if (this.throttle('absorb', 250)) this.fx('bubble', { vel: 0.06, rate: 1.7, out: this.freq, prio: 0, pan: this.pan(data.enemy?.x) });
        break;
      case 'split':
        if (this.throttle('split', 120))
          this.fx('bubble', { vel: 0.08, rate: 0.85 + Math.random() * 0.3, out: this.freq, prio: 0, pan: this.pan(data.enemy?.x) });
        break;
      case 'pulse': {
        if (!this.throttle('pulse', 300)) return;
        const frost = data.zone?.def?.id === 'frost';
        const pan = this.pan(data.zone?.x);
        this.fx('shimmer', { vel: frost ? 0.08 : 0.06, rate: frost ? 1 : 0.8, send: S.hi, prio: 0, out: this.freq, pan });
        if (frost) this.bell(this.nf(14), 0, 0.06, 1.2, this.freq, { prio: 0, pan });
        break;
      }
      case 'tornado':
        if (this.throttle('tornado', 500)) this.fx('whoosh', { vel: 0.12, rate: 0.85, pan: this.pan(data.tornado?.x), send: S.mid });
        break;
      case 'star': {
        const d = [8, 10, 13][data.i || 0] ?? 13;
        this.bell(this.nf(d), 0, 0.27, 3);
        this.koto(this.nf(d), 0, 0.18, 1.5);
        break;
      }
      case 'earlyBonus':
        this.bell(this.nf(13), 0, 0.12, 1.4);
        this.bell(this.nf(15), 0.09, 0.12, 1.6);
        break;
      default:
        break;
    }
  }

  // Traduction des événements moteur en sons.
  onEvent(ev) {
    switch (ev.type) {
      case 'shoot':
      case 'hit':
      case 'place':
      case 'sell':
      case 'fuse':
      case 'combo':
      case 'stone':
      case 'unstone':
      case 'reject':
      case 'leak':
      case 'echo':
      case 'echoFade':
      case 'stomp':
      case 'enrage':
      case 'summon':
      case 'absorbShift':
      case 'heal':
      case 'absorb':
      case 'split':
      case 'pulse':
      case 'tornado':
      case 'earlyBonus':
      case 'rewindEnd':
        return this.play(ev.type, ev);
      case 'kill':
        if (ev.enemy?.boss) {
          this.bossActive = false;
          return this.play('bossDown', ev);
        }
        return this.play('kill', ev);
      case 'rewindStart':
        return this.play('rewind', ev);
      case 'spawn':
        if (ev.enemy?.boss) {
          this.bossActive = true;
          this.play('boss', ev);
        }
        return undefined;
      case 'waveStart':
        this.intensity = 1;
        this.totalWaves = ev.total || 0;
        this.finalWave = ev.total > 1 && ev.index === ev.total - 1;
        return this.play('waveStart', ev);
      case 'waveEnd':
        this.intensity = 0;
        // dernière vague : la victoire prend le relais
        if (this.totalWaves && ev.index >= this.totalWaves - 1) return undefined;
        return this.play('waveEnd', ev);
      case 'win':
        this.intensity = 0;
        return this.play('win', ev);
      case 'lose':
        this.intensity = 0;
        return this.play('lose', ev);
      default:
        return undefined;
    }
  }

  // ───────────── musique générative ─────────────
  // Séquenceur à anticipation : toutes les 100 ms, on programme les croches des
  // 0,3 s à venir sur l'horloge audio (rythme exact même si le fil principal peine).

  startMusic() {
    if (this.musicTimer || this.offline) return;
    this.musicTimer = setInterval(() => this.tick(), 100);
    this.applyMusic();
  }

  tick() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    this.sweep();
    if (this._musicOn && !this._muted && !this.hidden) this.scheduleMusic();
  }

  scheduleMusic(horizon) {
    const now = this.now();
    // rattrapage : après une coupure on reprend à l'heure, sans rafale de notes
    if (this.nextStep < now) this.nextStep = now + 0.06;
    const end = horizon ?? now + 0.3;
    while (this.nextStep < end) {
      this.composeStep(this.nextStep - now);
      this.nextStep += this.stepDur;
    }
  }

  targetMode() {
    if (!(this._intensity > 0)) return 0;
    return this.bossActive || this.finalWave ? 2 : 1;
  }

  composeStep(when) {
    // changements de mode sur les demi-mesures : la musique bascule à temps
    if (this.step % 4 === 0) {
      const m = this.targetMode();
      if (m !== this.mode) {
        this.mode = m;
        this.step = 0;
        this.phrase = null;
        this.motif = null;
        this.levels();
      }
      this.stepDur = this.mode === 2 ? 0.285 : this.mode === 1 ? 0.33 : this.world === 'snow' ? 0.55 : 0.48;
    }
    const ps = this.step % 32;
    const bar = Math.floor(ps / 8);
    const sb = ps % 8;
    if (ps === 0 || !this.phrase) this.phrase = this.makePhrase();
    if (this.now() + when >= this.hushUntil) {
      for (const n of this.phrase[ps]) this.playNote(n, when);
      this.playBass(bar, sb, when);
      if (this.mode) this.playDrums(bar, sb, when);
      else this.playAmbience(sb, when);
    }
    this.step++;
  }

  // Phrase de 4 mesures : motif A puis sa variation qui conclut sur la tonique ;
  // une phrase sur deux expose un motif neuf. En préparation, une phrase sur trois
  // laisse sa seconde moitié vide : le ma (間), le silence qui fait respirer.
  makePhrase() {
    const calm = this.mode === 0;
    const n = this.phraseN++;
    if (!this.motif || n % 2 === 0) this.motif = this.makeMotif(calm);
    const head = n % 2 === 0 ? this.motif : this.makeMotif(calm);
    const notes = head.map((x) => ({ ...x }));
    if (!(calm && n % 3 === 2)) for (const x of this.vary(this.motif)) notes.push({ ...x, pos: x.pos + 16 });
    const byPos = Array.from({ length: 32 }, () => []);
    for (const x of notes) byPos[x.pos].push(x);
    return byPos;
  }

  makeMotif(calm) {
    const rh = pick(calm ? RHYTHMS.calm : RHYTHMS.wave);
    let deg = pick([3, 5, 5, 7]);
    const out = rh.map(([pos, len], i) => {
      if (i > 0) deg = clamp(deg + pick(WALK), 2, 9);
      return { pos, len, deg, vel: (pos % 4 === 0 ? 1 : 0.82) * (0.85 + Math.random() * 0.3) };
    });
    // le motif se pose sur une note d'appui (la, ré ou la aigu)
    const last = out[out.length - 1];
    last.deg = [3, 5, 8].reduce((a, b) => (Math.abs(b - last.deg) < Math.abs(a - last.deg) ? b : a));
    return out;
  }

  vary(m) {
    const v = m.map((x) => ({ ...x }));
    for (let k = 0; k < 2; k++) {
      const i = Math.floor(Math.random() * Math.max(1, v.length - 1));
      v[i].deg = clamp(v[i].deg + (Math.random() < 0.5 ? -1 : 1), 2, 9);
    }
    v[v.length - 1].deg = 5;
    return v;
  }

  playNote(n, when) {
    const d = this.stepDur;
    const calm = this.mode === 0;
    const f = this.nf(n.deg);
    const w = when + (Math.random() - 0.5) * 0.012;
    if (this.world === 'snow' && calm) {
      // shakuhachi : seules les notes longues sont jouées, le souffle lie le reste
      if (n.len >= 2) this.shakuhachi(f, w, n.len * d * 0.96, 0.1 * n.vel);
      return;
    }
    const vel = 0.38 * n.vel;
    const ring = calm ? Math.min(3, n.len * d + 1.2) : Math.min(1.6, n.len * d + 0.5);
    let bend = 0;
    if (calm && n.len >= 3 && Math.random() < 0.3) {
      const st = this.semis(n.deg + 1) - this.semis(n.deg);
      if (st <= 2) bend = st; // oshide : la corde pressée monte au degré suivant
    }
    this.koto(f, w, vel, ring, this.musicBus, { bend, bendAt: d * n.len * 0.45 });
    // awasezume : l'octave grave double les longues notes d'appui
    if (calm && n.len >= 4 && n.deg >= 5) this.koto(this.nf(n.deg - 5), w + 0.012, vel * 0.55, ring, this.musicBus);
  }

  playBass(bar, sb, when) {
    const m = this.mode;
    const d = this.stepDur;
    if (m === 0) {
      if (sb === 0 && (bar === 0 || bar === 2)) this.koto(this.nf(bar === 0 ? -5 : -2), when, 0.26, 0, this.musicBus);
      return;
    }
    for (const [st, deg, v] of BASS[m]) if (st === sb) this.koto(this.nf(deg), when, v, m === 2 ? 0.9 : 1.3, this.musicBus);
    // neige : le shakuhachi tient de longues notes au-dessus de la vague
    if (this.world === 'snow' && sb === 0 && (bar === 0 || bar === 2)) this.shakuhachi(this.nf(bar === 0 ? 5 : 3), when, 8 * d * 1.8, 0.07);
    if (m === 2 && bar === 0 && sb === 0) this.bell(this.nf(-5), when, 0.12, 4, this.musicBus);
  }

  playDrums(bar, sb, when) {
    const m = this.mode;
    const pat = DRUMS[bar === 3 ? m + 'f' : m];
    const j = () => when + (Math.random() - 0.5) * 0.006;
    const hv = () => 0.88 + Math.random() * 0.24;
    if (pat.don[sb]) this.taiko(j(), pat.don[sb] * hv(), 1, this.musicBus, 1);
    if (pat.ten[sb]) this.voice(this.sample('shime'), { when: j(), vel: pat.ten[sb] * hv(), out: this.musicBus, music: true });
    if (pat.ka[sb]) this.voice(this.sample('ka'), { when: j(), vel: pat.ka[sb] * hv(), out: this.musicBus, music: true });
    // boss : notes fantômes de shime en double croche
    if (m === 2 && (sb === 1 || sb === 5))
      this.voice(this.sample('shime'), { when: when + this.stepDur / 2, vel: 0.035, out: this.musicBus, music: true, rate: 1.05 });
  }

  // Ambiance du jardin en préparation : shishi-odoshi et gouttes du suikinkutsu
  // (mousse) ; cloche lointaine sur le vent (neige).
  playAmbience(sb, when) {
    if (sb !== 0) return;
    const t = this.now() + when;
    if (this.world === 'snow') {
      if (t > this.nextBell) {
        if (this.nextBell) this.bell(this.nf(-5), when, 0.12, 6, this.amb);
        this.nextBell = t + 24 + Math.random() * 16;
      }
      return;
    }
    if (t > this.nextShishi) {
      if (this.nextShishi) this.voice(this.sample('bamboo'), { when, vel: 0.2, out: this.amb, send: this.ambVerb, music: true });
      this.nextShishi = t + 16 + Math.random() * 14;
    }
    if (Math.random() < 0.3) {
      const k = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < k; i++) {
        this.voice(this.sample('drop'), {
          when: when + i * 0.23 + Math.random() * 0.1,
          vel: 0.06 + Math.random() * 0.06,
          rate: this.nf(10 + Math.floor(Math.random() * 5)) / 1000,
          out: this.amb,
          send: this.ambVerb,
          music: true,
        });
      }
    }
  }
}

export const sound = new Sound();
