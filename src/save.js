// Sauvegarde de la progression dans localStorage (tolérante aux erreurs :
// navigation privée, stockage plein…).
const KEY = 'jardin-des-esprits:v1';

const DEFAULT = {
  stars: {}, // { idNiveau: 0..3 } meilleur score
  muted: false,
  music: true,
  rewindTutorialSeen: false,
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

// Une sauvegarde abîmée (modifiée à la main, version future…) ne doit jamais
// bloquer le jeu : on ne garde que les champs valides.
function sanitize(p) {
  const out = structuredCloneSafe(DEFAULT);
  if (!p || typeof p !== 'object') return out;
  for (const k of ['muted', 'music', 'rewindTutorialSeen']) if (typeof p[k] === 'boolean') out[k] = p[k];
  if (p.stars && typeof p.stars === 'object' && !Array.isArray(p.stars)) {
    for (const [id, v] of Object.entries(p.stars)) {
      if (typeof v !== 'number' && !(typeof v === 'string' && /^\d+$/.test(v))) continue;
      const n = Math.max(0, Math.min(3, Math.floor(Number(v))));
      if (n > 0) out.stars[id] = n;
    }
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
  // Enregistre un résultat ; renvoie true si c'est un nouveau record.
  record(id, stars) {
    const n = Math.max(0, Math.min(3, Math.floor(Number(stars) || 0)));
    if (n > (data.stars[id] || 0)) {
      data.stars[id] = n;
      persist();
      return true;
    }
    return false;
  },
  // Un niveau est débloqué si c'est le premier, si le précédent a au moins une
  // étoile, ou s'il a lui-même (ou un niveau suivant) déjà été gagné : insérer
  // un nouveau niveau ne reverrouille jamais une progression acquise.
  isUnlocked(order, index) {
    if (index <= 0) return true;
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
