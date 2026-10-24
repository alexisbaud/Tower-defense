// Sauvegarde de la progression dans localStorage (tolérante aux erreurs :
// navigation privée, stockage plein…).
//
// Record par niveau : `stars` (meilleur score, mode normal), `hard` (meilleur
// score en mode Difficile, 0 = jamais gagné) et `challenge` (défi optionnel
// réussi). Les trois tables sont indépendantes : une ancienne sauvegarde (qui
// n'a que `stars`) reste lisible telle quelle.
const KEY = 'jardin-des-esprits:v1';

const DEFAULT = {
  stars: {}, // { idNiveau: 1..3 } meilleur score
  hard: {}, // { idNiveau: 1..3 } meilleur score en mode Difficile
  challenge: {}, // { idNiveau: true } défi réussi
  muted: false,
  music: true,
  rewindTutorialSeen: false,
  unlockAll: false, // débogage : tous les niveaux ouverts
};

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
  for (const k of ['muted', 'music', 'rewindTutorialSeen', 'unlockAll']) if (typeof p[k] === 'boolean') out[k] = p[k];
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
