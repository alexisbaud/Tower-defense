// Sauvegarde de la progression dans localStorage (tolérante aux erreurs :
// navigation privée, stockage plein…).
//
// Record par niveau : `stars` (meilleur score, mode normal), `hard` (meilleur
// score en mode Difficile, 0 = jamais gagné) et `challenge` (défi optionnel
// réussi). Les trois tables sont indépendantes : une ancienne sauvegarde (qui
// n'a que `stars`) reste lisible telle quelle.
//
// Réglages (écrits par les Réglages, lus par la partie) : `effects` ('full' |
// 'sober'), `textScale` (1 | 1.15 | 1.3), `haptics`, `slowAim`, `leftHanded` ;
// `combosSeen` (carnet des combos, écrit par la partie) ; `reinstallHintSeen`
// (invitation à réinstaller l'app déjà vue).
//
// Code de progression (transfert vers une nouvelle installation, dont le
// stockage est séparé) : « JDE1-XXXXX-XXXXX », base32 de Crockford (sans I, L,
// O, U), 10 caractères = 50 bits : pour chaque niveau de levelOrder() (8),
// étoiles 2 bits, Difficile 2 bits, défi 1 bit ; 4 drapeaux (Rembobinage déjà
// expliqué, 3 réservés) ; somme de contrôle 6 bits. Au-delà de 8 niveaux :
// « JDE2- », un caractère de plus par niveau. L'import fusionne par maximum :
// il ne baisse jamais un record.
import { levelOrder } from './data.js';

const KEY = 'jardin-des-esprits:v1';

const DEFAULT = {
  stars: {}, // { idNiveau: 1..3 } meilleur score
  hard: {}, // { idNiveau: 1..3 } meilleur score en mode Difficile
  challenge: {}, // { idNiveau: true } défi réussi
  muted: false,
  music: true,
  rewindTutorialSeen: false,
  unlockAll: false, // débogage : tous les niveaux ouverts
  effects: 'full', // 'full' | 'sober' (effets sobres : mouvement réduit)
  textScale: 1, // 1 | 1.15 | 1.3
  haptics: false,
  slowAim: false,
  leftHanded: false,
  combosSeen: {}, // { idCombo: true }
  reinstallHintSeen: false,
};

const BOOLS = ['muted', 'music', 'rewindTutorialSeen', 'unlockAll', 'haptics', 'slowAim', 'leftHanded', 'reinstallHintSeen'];
export const TEXT_SCALES = [1, 1.15, 1.3];

let data = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredCloneSafe(DEFAULT);
    return sanitize(JSON.parse(raw));
  } catch {
    return structuredCloneSafe(DEFAULT);
  }
}

// Score 1..3 valide (nombre ou chaîne de chiffres), sinon 0.
function starsOf(v) {
  if (typeof v !== 'number' && !(typeof v === 'string' && /^\d+$/.test(v))) return 0;
  const n = Math.max(0, Math.min(3, Math.floor(Number(v))));
  return Number.isFinite(n) ? n : 0;
}

function isMap(o) {
  return !!o && typeof o === 'object' && !Array.isArray(o);
}

// Une sauvegarde abîmée (modifiée à la main, version future…) ne doit jamais
// bloquer le jeu : on ne garde que les champs valides.
function sanitize(p) {
  const out = structuredCloneSafe(DEFAULT);
  if (!p || typeof p !== 'object') return out;
  for (const k of BOOLS) if (typeof p[k] === 'boolean') out[k] = p[k];
  for (const table of ['stars', 'hard']) {
    if (!isMap(p[table])) continue;
    for (const [id, v] of Object.entries(p[table])) {
      const n = starsOf(v);
      if (n > 0) out[table][id] = n;
    }
  }
  if (isMap(p.challenge)) {
    for (const [id, v] of Object.entries(p.challenge)) if (v === true) out.challenge[id] = true;
  }
  if (p.effects === 'full' || p.effects === 'sober') out.effects = p.effects;
  if (TEXT_SCALES.includes(p.textScale)) out.textScale = p.textScale;
  if (isMap(p.combosSeen)) {
    for (const [id, v] of Object.entries(p.combosSeen)) if (v === true && id.length <= 40) out.combosSeen[id] = true;
  }
  return out;
}

function structuredCloneSafe(o) {
  return JSON.parse(JSON.stringify(o));
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* stockage indisponible : la partie continue sans sauvegarde */
  }
}

// ───────────── Code de progression ─────────────

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford : ni I, ni L, ni O, ni U
const FLAGS = ['rewindTutorialSeen']; // + 3 réservés (toujours 0)

function levelIds() {
  return levelOrder().map((o) => o.id);
}

// Somme de contrôle sur 6 bits : 37 + Σ (2j + 1) × quartet j (mod 64). Chaque poids
// est impair, donc inversible modulo 64 : toute erreur sur un seul quartet se voit
// (et « 0000000000 », recopié par erreur, n'est pas un code valide).
function checksum(bits) {
  let c = 37;
  for (let j = 0; j * 4 < bits.length; j++) {
    let n = 0;
    for (let k = 0; k < 4; k++) n = n * 2 + (bits[j * 4 + k] || 0);
    c = (c + (2 * j + 1) * n) % 64;
  }
  return c;
}

const pushBits = (bits, v, n) => {
  for (let k = n - 1; k >= 0; k--) bits.push((v >> k) & 1);
};
const readBits = (bits, at, n) => {
  let v = 0;
  for (let k = 0; k < n; k++) v = v * 2 + bits[at + k];
  return v;
};

// Version du code selon le nombre de niveaux : JDE1 = exactement les 8 premiers.
function codeLayout(ids) {
  const v1 = ids.length <= 8;
  const n = v1 ? 8 : ids.length;
  return { version: v1 ? 1 : 2, n, chars: Math.ceil((5 * n + 10) / 5) };
}

export function exportCode(d = data, ids = levelIds()) {
  const { version, n, chars } = codeLayout(ids);
  const bits = [];
  for (let i = 0; i < n; i++) {
    const id = ids[i];
    pushBits(bits, id ? starsOf(d.stars[id]) : 0, 2);
    pushBits(bits, id ? starsOf(d.hard[id]) : 0, 2);
    pushBits(bits, id && d.challenge[id] ? 1 : 0, 1);
  }
  pushBits(bits, FLAGS.reduce((v, f, k) => v | ((d[f] ? 1 : 0) << (3 - k)), 0), 4);
  pushBits(bits, checksum(bits), 6);
  while (bits.length < chars * 5) bits.push(0);
  let s = '';
  for (let j = 0; j < chars; j++) s += B32[readBits(bits, j * 5, 5)];
  return `JDE${version}-${s.match(/.{1,5}/g).join('-')}`;
}

// Lecture tolérante : minuscules, tirets ou espaces absents, O → 0, I/L → 1.
// Renvoie { stars, hard, challenge, flags } ou null (code invalide).
export function decodeCode(str, ids = levelIds()) {
  let s = String(str ?? '')
    .toUpperCase()
    .replace(/[\s\-_.·]/g, '')
    .replace(/^JDE[IL]/, 'JDE1');
  const m = /^JDE([12])/.exec(s);
  const { version, n, chars } = codeLayout(ids);
  if (m) {
    if (Number(m[1]) !== version) return null;
    s = s.slice(4);
  }
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== chars || /[^0-9A-Z]/.test(s) || /U/.test(s)) return null;
  const bits = [];
  for (const ch of s) pushBits(bits, B32.indexOf(ch), 5);
  const payload = 5 * n + 4;
  if (checksum(bits.slice(0, payload)) !== readBits(bits, payload, 6)) return null;
  if (bits.slice(payload + 6).some((b) => b)) return null;
  const out = { stars: {}, hard: {}, challenge: {}, flags: {} };
  for (let i = 0; i < n; i++) {
    const id = ids[i];
    if (!id) continue;
    const st = readBits(bits, i * 5, 2);
    const hd = readBits(bits, i * 5 + 2, 2);
    if (st) out.stars[id] = st;
    if (hd) out.hard[id] = hd;
    if (bits[i * 5 + 4]) out.challenge[id] = true;
  }
  const fl = readBits(bits, 5 * n, 4);
  FLAGS.forEach((f, k) => (out.flags[f] = !!((fl >> (3 - k)) & 1)));
  return out;
}

export const save = {
  get data() {
    return data;
  },
  stars(id) {
    return data.stars[id] || 0;
  },
  // Record complet d'un niveau : { stars, hard, challenge }.
  level(id) {
    return { stars: data.stars[id] || 0, hard: data.hard[id] || 0, challenge: !!data.challenge[id] };
  },
  // Le mode Difficile s'ouvre après trois étoiles en mode normal.
  hardUnlocked(id) {
    return (data.stars[id] || 0) >= 3 || data.unlockAll;
  },
  // Enregistre un résultat ; renvoie true si c'est un nouveau record (étoiles,
  // première victoire en Difficile, meilleur score en Difficile ou défi réussi).
  // opts : { hard: bool, challenge: bool (défi réussi) }
  record(id, stars, opts = {}) {
    const n = starsOf(Number(stars) || 0);
    let better = false;
    const table = opts.hard ? data.hard : data.stars;
    if (n > (table[id] || 0)) {
      table[id] = n;
      better = true;
    }
    if (opts.challenge === true && !data.challenge[id]) {
      data.challenge[id] = true;
      better = true;
    }
    if (better) persist();
    return better;
  },
  // Un niveau est débloqué si c'est le premier, si le précédent a au moins une
  // étoile, ou s'il a lui-même (ou un niveau suivant) déjà été gagné : insérer
  // un nouveau niveau ne reverrouille jamais une progression acquise.
  isUnlocked(order, index) {
    if (index <= 0 || data.unlockAll) return true;
    if ((data.stars[order[index - 1].id] || 0) > 0) return true;
    for (let k = index; k < order.length; k++) if ((data.stars[order[k].id] || 0) > 0) return true;
    return false;
  },
  // Total des étoiles des seuls niveaux existants (`order` = levelOrder()).
  totalStars(order = null) {
    if (!order) return Object.values(data.stars).reduce((a, b) => a + b, 0);
    return order.reduce((sum, o) => sum + (data.stars[o.id] || 0), 0);
  },
  // Code de progression de cette sauvegarde (à recopier dans la nouvelle installation).
  exportCode() {
    return exportCode(data);
  },
  // Importe un code : fusion par maximum (un import ne baisse jamais un record).
  // Renvoie { ok: true, stars: total, gained: étoiles gagnées } ou { ok: false, error }.
  importCode(str) {
    const got = decodeCode(str);
    if (!got) return { ok: false, error: 'Code invalide : vérifiez les 10 caractères' };
    const before = save.totalStars(levelOrder());
    for (const table of ['stars', 'hard']) {
      for (const [id, n] of Object.entries(got[table])) if (n > (data[table][id] || 0)) data[table][id] = n;
    }
    for (const id of Object.keys(got.challenge)) data.challenge[id] = true;
    for (const [f, on] of Object.entries(got.flags)) if (on) data[f] = true;
    persist();
    const stars = save.totalStars(levelOrder());
    return { ok: true, stars, gained: stars - before };
  },
  set(key, value) {
    data[key] = value;
    persist();
  },
  reset() {
    data = structuredCloneSafe(DEFAULT);
    persist();
  },
};

// Pour les tests (Node) : nettoyage d'une sauvegarde brute.
export { sanitize };
