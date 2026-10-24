// Matrice des 6 combos élémentaires. Deux lanternes d'éléments différents
// adjacentes (y compris en diagonale) créent une zone de synergie centrée entre elles.
// Données pures : `effect.kind` choisit un comportement générique du moteur.
//
//   kind 'aura'    applique `status` aux yokai dans la zone toutes les `tick` secondes
//   kind 'pulse'   toutes les `interval` secondes : `damage` + `status` dans la zone
//   kind 'tornado' toutes les `interval` secondes : une tornade orbite `duration` s
//                  et inflige `dps` aux yokai touchés (volants compris)
//
//   status : blind (s), slow (facteur), burn { dps, duration }, stun (s), shred { mult, duration }
//   groundOnly : n'affecte pas les volants
export default [
  {
    id: 'steam',
    name: 'Vapeur',
    kanji: '霧',
    elements: ['fire', 'water'],
    desc: 'Un nuage de vapeur aveugle les yokai : ils perdent leurs pouvoirs et ralentissent.',
    color: '#e4ecef',
    radius: 1.5,
    effect: { kind: 'aura', tick: 0.2, status: { blind: 0.8, slow: 0.8 } },
  },
  {
    id: 'firestorm',
    name: 'Tornade de flammes',
    kanji: '炎嵐',
    elements: ['fire', 'wind'],
    desc: 'Une tornade de feu tourne autour des lanternes et brûle tout sur son passage.',
    color: '#ff8a3c',
    radius: 1.7,
    effect: { kind: 'tornado', interval: 4.5, duration: 3.5, dps: 34, size: 0.6, speed: 2.4, knockback: 0.12 },
  },
  {
    id: 'mud',
    name: 'Boue',
    kanji: '泥',
    elements: ['water', 'earth'],
    desc: 'Le sol se change en boue : les yokai terrestres s’y enlisent.',
    color: '#7a5c3a',
    radius: 1.6,
    effect: { kind: 'aura', tick: 0.2, groundOnly: true, status: { slow: 0.45 } },
  },
  {
    id: 'magma',
    name: 'Magma',
    kanji: '熔',
    elements: ['fire', 'earth'],
    desc: 'Des fissures de lave brûlent les yokai qui marchent dessus.',
    color: '#e0502a',
    radius: 1.45,
    effect: { kind: 'aura', tick: 0.2, groundOnly: true, status: { burn: { dps: 14, duration: 1 } } },
  },
  {
    id: 'frost',
    name: 'Givre',
    kanji: '氷',
    elements: ['water', 'wind'],
    desc: 'Une bourrasque glacée gèle régulièrement les yokai sur place.',
    color: '#bfe3ff',
    radius: 1.7,
    effect: { kind: 'pulse', interval: 4, damage: 10, status: { stun: 1.0 } },
  },
  {
    id: 'sandstorm',
    name: 'Tempête de sable',
    kanji: '砂',
    elements: ['wind', 'earth'],
    desc: 'Le sable brise carapaces et armures : les yokai subissent davantage de dégâts.',
    color: '#d8b878',
    radius: 1.8,
    effect: { kind: 'aura', tick: 0.2, status: { shred: { mult: 1.4, duration: 0.5 } } },
  },
];
