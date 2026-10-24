// Lanternes-gardiennes (tours). Données pures : le moteur interprète chaque clé
// (voir README « Ajouter une tour »). Chaque élément (data/elements.js) a une
// famille de trois lanternes aux rôles distincts.
//
// Champs d'une tour :
//   element      élément de la famille (fire | water | wind | earth)
//   attack       comportement : projectile (défaut) | lob | aura | pulse | beam | support | barrier
//   targets      { ground, air } : ce que la tour peut viser
//   look         silhouette de rendu (famille), variant = détail propre à la tour
//   priority     priorité de ciblage par défaut (first | last | strong | close)
//
// Clés d'un niveau de tour :
//   range        portée en cases            rate     tirs (ou impulsions) par seconde
//   damage       dégâts par impact          projectileSpeed  vitesse du projectile (cases/s)
//   burn   { dps, duration }  brûlure (ignore l'armure)
//   slow   { factor, duration } ralentissement (factor = multiplicateur de vitesse)
//   knockback    recul en cases             splash   rayon de dégâts de zone
//   pierce       0..1, part de l'armure ignorée (0,5 = « ignore la moitié de l'armure »)
//   airMultiplier multiplicateur contre les volants
//   stun         étourdissement à l'impact (s)
//   armorBreak   durée (s) pendant laquelle l'armure de la cible est brisée
//   auraDps      (aura) dégâts par seconde à tous les yokai dans la portée (ignore l'armure)
//   width        (beam) demi-largeur du jet en cases
//   heal         (support) PV par seconde rendus aux barrières dans la portée
//   rateBonus    (support) bonus de cadence des lanternes voisines (+0,2 = +20 %)
//   cleanse      (support) part de l'étourdissement des lanternes voisines effacée
//   barrierHp    (barrier) PV de la barrière   respawn  délai de reconstruction (s)
//   thorns       (barrier) dégâts par seconde renvoyés aux yokai qui la frappent
//
// Équilibrage de la fusion : une lanterne N2 vaut environ 1,9 fois une N1 pour
// deux fois le prix (et N3 ≈ 1,9 × N2) : fusionner libère un socle et gagne de la
// portée, mais coûte un peu de rendement et les combos de la lanterne absorbée.
export default {
  // ───────────────────────── Feu : offensif ─────────────────────────
  fire: {
    element: 'fire',
    name: 'Brasero',
    kanji: '火',
    look: 'fire',
    role: 'Dégâts',
    desc: 'Projette des braises qui brûlent leur cible.',
    strength: 'Gros dégâts sur une cible ; la brûlure ignore l’armure.',
    weakness: 'Petits coups au N1 : les carapaces les encaissent. Soigne les kitsune de feu.',
    cost: 50,
    color: '#c8402a',
    glow: '#ffb35c',
    targets: { ground: true, air: true },
    projectile: 'ember',
    levels: [
      { range: 2.3, rate: 1.1, damage: 14, burn: { dps: 5, duration: 2 }, projectileSpeed: 9 },
      { range: 2.6, rate: 1.25, damage: 24, burn: { dps: 9, duration: 2.5 }, projectileSpeed: 10 },
      { range: 3.0, rate: 1.45, damage: 40, burn: { dps: 16, duration: 3 }, projectileSpeed: 11 },
    ],
  },
  fire_mortar: {
    element: 'fire',
    name: 'Mortier hanabi',
    kanji: '砲',
    look: 'fire',
    variant: 'mortar',
    role: 'Zone à longue portée',
    desc: 'Lance des bombes de feu qui explosent en gerbe.',
    strength: 'Très longue portée, explosion qui brise la moitié de l’armure.',
    weakness: 'Lent, rate les yokai rapides et ne touche pas les volants.',
    cost: 70,
    color: '#b8322a',
    glow: '#ffd27a',
    targets: { ground: true, air: false },
    attack: 'lob',
    projectile: 'boulder',
    priority: 'strong',
    levels: [
      { range: 3.2, rate: 0.45, damage: 30, splash: 1.0, pierce: 0.5, burn: { dps: 4, duration: 1.5 }, projectileSpeed: 5 },
      { range: 3.5, rate: 0.47, damage: 55, splash: 1.15, pierce: 0.5, burn: { dps: 7, duration: 1.5 }, projectileSpeed: 5.5 },
      { range: 3.8, rate: 0.52, damage: 95, splash: 1.3, pierce: 0.5, burn: { dps: 12, duration: 2 }, projectileSpeed: 6 },
    ],
  },
  fire_wisp: {
    element: 'fire',
    name: 'Feux follets',
    kanji: '燐',
    look: 'fire',
    variant: 'wisp',
    role: 'Aura brûlante',
    desc: 'Des feux follets tournent autour de la lanterne et brûlent tout ce qui passe.',
    strength: 'Brûle tous les yokai proches à la fois, carapaces comprises.',
    weakness: 'Portée très courte ; inutile contre les kitsune de feu.',
    cost: 60,
    color: '#d0602a',
    glow: '#ffc06a',
    targets: { ground: true, air: true },
    attack: 'aura',
    levels: [
      { range: 1.3, rate: 4, auraDps: 9 },
      { range: 1.45, rate: 4, auraDps: 17 },
      { range: 1.6, rate: 4, auraDps: 32 },
    ],
  },

  // ───────────────────────── Eau : contrôle et soin ─────────────────────────
  water: {
    element: 'water',
    name: 'Fontaine glacée',
    kanji: '水',
    look: 'water',
    role: 'Ralentissement',
    desc: 'Des gouttes glacées qui ralentissent les yokai.',
    strength: 'Ralentit tout ce qu’elle touche ; zone dès le N2.',
    weakness: 'Presque aucun dégât : ne tue rien seule.',
    cost: 45,
    color: '#2f5f8f',
    glow: '#9fd4ff',
    targets: { ground: true, air: true },
    projectile: 'droplet',
    levels: [
      { range: 2.2, rate: 1.0, damage: 6, slow: { factor: 0.6, duration: 1.4 }, projectileSpeed: 8 },
      { range: 2.5, rate: 1.15, damage: 11, slow: { factor: 0.5, duration: 1.8 }, splash: 0.6, projectileSpeed: 9 },
      { range: 2.9, rate: 1.35, damage: 20, slow: { factor: 0.42, duration: 2.2 }, splash: 0.9, projectileSpeed: 10 },
    ],
  },
  water_spring: {
    element: 'water',
    name: 'Source sacrée',
    kanji: '泉',
    look: 'water',
    variant: 'spring',
    role: 'Soin des barrières',
    desc: 'Son eau pure répare les barrières et purifie les lanternes étourdies.',
    strength: 'Rend les barrières presque indestructibles ; dissipe les étourdissements.',
    weakness: 'N’attaque pas.',
    cost: 55,
    color: '#3a78a8',
    glow: '#c8ecff',
    targets: { ground: false, air: false },
    attack: 'support',
    levels: [
      { range: 2.2, rate: 2, heal: 14, cleanse: 0.3 },
      { range: 2.5, rate: 2, heal: 30, cleanse: 0.5 },
      { range: 2.9, rate: 2, heal: 55, cleanse: 0.8 },
    ],
  },
  water_torrent: {
    element: 'water',
    name: 'Torrent',
    kanji: '瀑',
    look: 'water',
    variant: 'torrent',
    role: 'Jet perçant',
    desc: 'Un jet d’eau sous pression qui traverse toute une file de yokai.',
    strength: 'Touche tous les yokai alignés et les ralentit.',
    weakness: 'Faible contre un yokai isolé ; direction du jet imposée par la cible.',
    cost: 65,
    color: '#24507a',
    glow: '#a8dcff',
    targets: { ground: true, air: true },
    attack: 'beam',
    levels: [
      { range: 3.0, rate: 0.7, damage: 15, width: 0.45, slow: { factor: 0.8, duration: 1 } },
      { range: 3.3, rate: 0.75, damage: 27, width: 0.5, slow: { factor: 0.75, duration: 1.2 } },
      { range: 3.6, rate: 0.8, damage: 48, width: 0.55, slow: { factor: 0.7, duration: 1.4 } },
    ],
  },

  // ───────────────────────── Vent : mobilité et soutien ─────────────────────────
  wind: {
    element: 'wind',
    name: 'Bourrasque',
    kanji: '風',
    look: 'wind',
    role: 'Recul',
    desc: 'Des bourrasques qui repoussent les yokai. Redoutable contre les volants.',
    strength: 'Repousse les yokai ; dégâts doublés contre les volants.',
    weakness: 'Faible au sol ; boss et yokai hors du temps résistent au recul.',
    cost: 55,
    color: '#5f8f6a',
    glow: '#d9f2d0',
    targets: { ground: true, air: true },
    projectile: 'gust',
    levels: [
      { range: 2.3, rate: 0.9, damage: 7, knockback: 0.5, airMultiplier: 2, projectileSpeed: 12 },
      { range: 2.6, rate: 1.0, damage: 13, knockback: 0.8, airMultiplier: 2, splash: 0.5, projectileSpeed: 13 },
      { range: 3.0, rate: 1.15, damage: 24, knockback: 1.1, airMultiplier: 2.2, splash: 0.8, projectileSpeed: 14 },
    ],
  },
  wind_chime: {
    element: 'wind',
    name: 'Carillon fūrin',
    kanji: '鈴',
    look: 'wind',
    variant: 'chime',
    role: 'Soutien',
    desc: 'Le tintement du carillon accélère les lanternes voisines, quel que soit leur élément.',
    strength: 'Accélère toutes les lanternes proches (non cumulable).',
    weakness: 'N’attaque pas.',
    cost: 60,
    color: '#6f9f78',
    glow: '#eaf7d8',
    targets: { ground: false, air: false },
    attack: 'support',
    levels: [
      { range: 1.6, rate: 2, rateBonus: 0.2 },
      { range: 1.8, rate: 2, rateBonus: 0.35 },
      { range: 2.0, rate: 2, rateBonus: 0.55 },
    ],
  },
  wind_bow: {
    element: 'wind',
    name: 'Arc-tempête',
    kanji: '弓',
    look: 'wind',
    variant: 'bow',
    role: 'Tireur antiaérien',
    desc: 'Des flèches portées par le vent, à très longue portée.',
    strength: 'Abat les volants de loin ; ignore la moitié de l’armure.',
    weakness: 'Cadence lente : débordé par les groupes.',
    cost: 70,
    color: '#4f7f5a',
    glow: '#e2f5d8',
    targets: { ground: true, air: true },
    projectile: 'arrow',
    priority: 'strong',
    levels: [
      { range: 3.6, rate: 0.6, damage: 26, airMultiplier: 2.5, pierce: 0.5, projectileSpeed: 16 },
      { range: 3.9, rate: 0.65, damage: 46, airMultiplier: 2.5, pierce: 0.5, projectileSpeed: 17 },
      { range: 4.3, rate: 0.7, damage: 80, airMultiplier: 2.5, pierce: 0.5, projectileSpeed: 18 },
    ],
  },

  // ───────────────────────── Terre : défense et chemin ─────────────────────────
  earth: {
    element: 'earth',
    name: 'Catapulte de roc',
    kanji: '土',
    look: 'earth',
    role: 'Zone',
    desc: 'Projette des rochers qui écrasent tout autour de l’impact.',
    strength: 'Dégâts de zone lourds ; ignore la moitié de l’armure.',
    weakness: 'Lente et incapable de toucher les volants.',
    cost: 65,
    color: '#8a6a32',
    glow: '#f0c870',
    targets: { ground: true, air: false },
    attack: 'lob',
    projectile: 'boulder',
    levels: [
      { range: 2.2, rate: 0.55, damage: 24, splash: 0.85, pierce: 0.5, projectileSpeed: 5 },
      { range: 2.5, rate: 0.58, damage: 44, splash: 1.0, pierce: 0.5, projectileSpeed: 5.5 },
      { range: 2.8, rate: 0.62, damage: 78, splash: 1.2, pierce: 0.5, stun: 0.4, projectileSpeed: 6 },
    ],
  },
  earth_guard: {
    element: 'earth',
    name: 'Gardien de pierre',
    kanji: '壁',
    look: 'earth',
    variant: 'guard',
    role: 'Barrière',
    desc: 'Dresse un mur de pierre sur le chemin voisin : les yokai doivent le briser pour passer.',
    strength: 'Arrête les yokai au sol et les regroupe pour les attaques de zone.',
    weakness: 'Les volants et les kasa-obake passent par-dessus ; l’ushi-oni la fracasse.',
    cost: 60,
    color: '#7a5a2a',
    glow: '#e8c070',
    targets: { ground: false, air: false },
    attack: 'barrier',
    levels: [
      { range: 1.6, rate: 1, barrierHp: 160, respawn: 6 },
      { range: 1.8, rate: 1, barrierHp: 340, respawn: 5 },
      { range: 2.0, rate: 1, barrierHp: 700, respawn: 4, thorns: 10 },
    ],
  },
  earth_quake: {
    element: 'earth',
    name: 'Tambour du séisme',
    kanji: '震',
    look: 'earth',
    variant: 'quake',
    role: 'Contrôle et brise-armure',
    desc: 'Frappe le sol : les yokai proches sont étourdis et leur armure se fend.',
    strength: 'Étourdit un groupe et brise les armures (les autres lanternes en profitent).',
    weakness: 'Impulsions espacées ; sans effet sur les volants.',
    cost: 75,
    color: '#6e5428',
    glow: '#f2d08a',
    targets: { ground: true, air: false },
    attack: 'pulse',
    levels: [
      { range: 1.8, rate: 0.25, damage: 18, stun: 0.6, armorBreak: 3, pierce: 0.5 },
      { range: 2.0, rate: 0.27, damage: 34, stun: 0.7, armorBreak: 3.5, pierce: 0.5 },
      { range: 2.2, rate: 0.3, damage: 62, stun: 0.8, armorBreak: 4, pierce: 0.5 },
    ],
  },
};
