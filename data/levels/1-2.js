// Niveau 1-2 — Le Jardin des renards. Leçon : les combos (deux éléments voisins).
//
// Trois allées verticales (descente, remontée, descente). Entre deux allées, des
// paires de socles typés d'éléments différents côte à côte (Feu + Eau = Vapeur,
// Terre + Eau = Boue, Vent + Feu = Tornade, Vent + Terre = Sable) : chaque paire
// couvre deux allées. Les kitsune absorbent un élément (aura colorée) et s'en
// soignent : une défense d'un seul élément les laisse passer, la Vapeur les aveugle.
// Ils restent fragiles (surtout ceux qui absorbent la Terre, que la catapulte soigne
// en zone) : à deux, chacun n'a qu'un élément, et l'autre doit pouvoir les abattre
// seul. Le gros de la menace vient des kodama et des kamaitachi.
//
// Courbe : 1-3 montée, 4 répit, 5-6 montée, 7 répit, 8-10 montée, 11 répit,
// 12 climax « Le Cortège des renards » (les quatre absorptions à la fois).
export default {
  id: '1-2',
  name: 'Le Jardin des renards',
  subtitle: 'Deux éléments valent mieux qu’un',
  concept: 'Combos',
  world: 'moss',
  map: [
    'TS,,,,,,T',
    ',.,,#,,,,',
    ',.,,....,',
    ',.12.3#.,',
    '#.,,.,,.,',
    ',.,#.42.T',
    ',.31.,,.#',
    'T.,,.#,.,',
    ',.#,.34.,',
    ',.#2.,,.#',
    ',....,,.,',
    'T,,,#,,.,',
    'T,,,,,,G,',
  ],
  startGold: 300,
  lives: 20,
  hpScale: 2.5,
  wavePause: 15,
  towers: ['fire', 'water', 'wind', 'earth'],
  tutorial: ['combo', 'fuse'],
  introduce: ['kitsune'],
  hard: { hpScale: 1.4, startGold: -20, lives: -5 },
  challenge: {
    name: 'Sans Vent',
    desc: 'Gagner avec trois éléments seulement : aucune lanterne de Vent.',
    rule: { forbidTowers: ['wind', 'wind_chime', 'wind_bow'] },
  },
  waves: [
    { groups: [{ enemy: 'kodama', count: 8, interval: 1.4, hp: 1.2 }] },
    {
      groups: [
        { enemy: 'kitsune', count: 4, interval: 2, hp: 0.35, absorb: 'wind' },
        { enemy: 'kodama', count: 8, interval: 1.3, delay: 3, hp: 1.1 },
      ],
    },
    {
      groups: [
        { enemy: 'kitsune', count: 5, interval: 1.8, hp: 0.35, absorb: 'water' },
        { enemy: 'kamaitachi', count: 8, interval: 1, delay: 4, hp: 1.3 },
      ],
    },
    // répit
    {
      groups: [
        { enemy: 'kodama', count: 8, interval: 1.3, hp: 1.15 },
        { enemy: 'kitsune', count: 3, interval: 2, delay: 4, hp: 0.25, absorb: 'earth' },
      ],
    },
    {
      groups: [
        { enemy: 'kitsune', count: 6, interval: 1.6, hp: 0.4, absorb: 'wind' },
        { enemy: 'kamaitachi', count: 8, interval: 0.9, delay: 3, hp: 1.3 },
        { enemy: 'kodama', count: 8, interval: 1.2, delay: 6, hp: 1.5 },
      ],
    },
    {
      groups: [
        { enemy: 'kitsune', count: 6, interval: 1.5, hp: 0.75, absorb: 'fire' },
        { enemy: 'kitsune', count: 6, interval: 1.5, delay: 4, hp: 0.5, absorb: 'earth' },
        { enemy: 'kodama', count: 10, interval: 1.1, delay: 3, hp: 2.45 },
      ],
    },
    // répit
    { groups: [{ enemy: 'kamaitachi', count: 10, interval: 1, hp: 2.1 }] },
    {
      groups: [
        { enemy: 'kitsune', count: 8, interval: 1.3, hp: 1.3, absorb: 'water' },
        { enemy: 'kodama', count: 14, interval: 1, delay: 2, hp: 4.1 },
      ],
    },
    {
      groups: [
        { enemy: 'kitsune', count: 6, interval: 1.3, hp: 1.2, absorb: 'fire' },
        { enemy: 'kitsune', count: 6, interval: 1.3, delay: 3, hp: 1.2, absorb: 'wind' },
        { enemy: 'kamaitachi', count: 12, interval: 0.8, delay: 6, hp: 3.9 },
      ],
    },
    {
      groups: [
        { enemy: 'kitsune', count: 8, interval: 1.2, hp: 0.8, absorb: 'earth' },
        { enemy: 'kitsune', count: 8, interval: 1.2, delay: 3, hp: 1.3, absorb: 'water' },
        { enemy: 'kodama', count: 14, interval: 0.9, delay: 6, hp: 4.6 },
      ],
    },
    // répit
    {
      groups: [
        { enemy: 'kodama', count: 14, interval: 0.9, hp: 3.6 },
        { enemy: 'kitsune', count: 4, interval: 1.5, delay: 5, hp: 1.2, absorb: 'wind' },
      ],
    },
    // climax : Le Cortège des renards
    {
      name: 'Le Cortège des renards',
      climax: true,
      groups: [
        { enemy: 'kitsune', count: 8, interval: 1.1, hp: 1.4, absorb: 'fire' },
        { enemy: 'kitsune', count: 8, interval: 1.1, delay: 2, hp: 1.4, absorb: 'water' },
        { enemy: 'kitsune', count: 8, interval: 1.1, delay: 4, hp: 1.4, absorb: 'wind' },
        { enemy: 'kitsune', count: 8, interval: 1.1, delay: 6, hp: 0.8, absorb: 'earth' },
        { enemy: 'kodama', count: 12, interval: 0.8, delay: 3, hp: 4.4 },
        { enemy: 'kamaitachi', count: 14, interval: 0.7, delay: 9, hp: 4.3 },
      ],
      reward: 0,
    },
  ],
};
