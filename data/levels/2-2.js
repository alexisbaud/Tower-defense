// Niveau 2-2 — Les Deux Portes. Leçon : défendre deux chemins.
//
// Deux portes au nord, deux sentiers en lacets qui ne se rejoignent qu'au pied
// du temple. Chaque côté a ses socles typés (les quatre éléments de chaque
// côté) ; la colonne centrale de socles universels couvre les deux sentiers à la
// fois. Nouveaux venus : les kasa-obake, qui sautent les barrières (la Vapeur
// les en empêche), et les ushi-oni, qui les fracassent (étourdir, ralentir ou
// réparer avec la Source sacrée).
//
// Courbe : 1-3 montée, 4 répit, 5-6 montée, 7 répit, 8-10 montée, 11 répit,
// 12 montée, 13 climax « La Charge des taureaux ».
export default {
  id: '2-2',
  name: 'Les Deux Portes',
  subtitle: 'Deux sentiers, un seul sanctuaire',
  concept: 'Deux chemins',
  world: 'snow',
  map: [
    'TS,,,,,ST',
    ',.3,#,1.,',
    ',...,...,',
    ',#2.#.4#,',
    ',...,...,',
    '#.1,#,3.#',
    ',...,...,',
    ',4#.#.#2,',
    ',...,...,',
    ',.3,#,1.,',
    ',.......,',
    'T,,4.2,,T',
    'T,,,G,,,T',
  ],
  startGold: 400,
  lives: 20,
  hpScale: 1,
  wavePause: 14,
  // les douze lanternes (trois par élément)
  towers: ['fire', 'fire_mortar', 'fire_wisp', 'water', 'water_spring', 'water_torrent', 'wind', 'wind_chime', 'wind_bow', 'earth', 'earth_guard', 'earth_quake'],
  rewind: true,
  introduce: ['kasaobake', 'ushioni'],
  hard: { hpScale: 1.3, startGold: -30, lives: -5 },
  challenge: {
    name: 'Sans Eau',
    desc: 'Gagner sans lanterne d’Eau : ni fontaine, ni source, ni torrent (et donc sans Vapeur ni Boue).',
    rule: { forbidTowers: ['water', 'water_spring', 'water_torrent'] },
  },
  waves: [
    { groups: [{ enemy: 'kodama', count: 8, interval: 1.3, hp: 1.35 }, { enemy: 'kodama', count: 8, interval: 1.3, delay: 1, spawn: 1, hp: 1.35 }] },
    {
      groups: [
        { enemy: 'kamaitachi', count: 8, interval: 1, hp: 1.15 },
        { enemy: 'kitsune', count: 5, interval: 1.8, delay: 2, spawn: 1, hp: 1.15, absorb: 'water' },
      ],
    },
    {
      groups: [
        { enemy: 'kasaobake', count: 6, interval: 1.6, hp: 1.25 },
        { enemy: 'kodama', count: 8, interval: 1.2, spawn: 1, hp: 1.25 },
        { enemy: 'kappa', count: 3, interval: 2.5, delay: 4, spawn: 1, hp: 1.25 },
      ],
    },
    // répit
    {
      groups: [
        { enemy: 'kodama', count: 8, interval: 1.2, hp: 1.15 },
        { enemy: 'kamaitachi', count: 6, interval: 1, delay: 3, spawn: 1, hp: 1.15 },
      ],
    },
    {
      groups: [
        { enemy: 'ushioni', count: 2, interval: 5, hp: 1.65 },
        { enemy: 'kasaobake', count: 6, interval: 1.5, delay: 2, spawn: 1, hp: 1.65 },
        { enemy: 'kodama', count: 8, interval: 1.1, delay: 4, hp: 1.65 },
      ],
    },
    {
      groups: [
        { enemy: 'kasaobake', count: 8, interval: 1.3, hp: 1.7 },
        { enemy: 'kappa', count: 5, interval: 2, spawn: 1, hp: 1.7 },
        { enemy: 'tengu', count: 4, interval: 2, delay: 5, spawn: 1, hp: 0.75 },
      ],
    },
    // répit
    {
      groups: [
        { enemy: 'kitsune', count: 6, interval: 1.5, hp: 1.2, absorb: 'fire' },
        { enemy: 'kodama', count: 8, interval: 1.2, delay: 2, spawn: 1, hp: 1.2 },
      ],
    },
    {
      groups: [
        { enemy: 'ushioni', count: 3, interval: 4, spawn: 1, hp: 1.15 },
        { enemy: 'nuppeppo', count: 6, interval: 1.6, hp: 1.15 },
        { enemy: 'kasaobake', count: 8, interval: 1.2, delay: 4, spawn: 1, hp: 1.15 },
      ],
    },
    {
      groups: [
        { enemy: 'ushioni', count: 3, interval: 4 },
        { enemy: 'kappa', count: 6, interval: 1.6, spawn: 1 },
        { enemy: 'yukionna', count: 3, interval: 3, delay: 2 },
        { enemy: 'kitsune', count: 6, interval: 1.3, delay: 4, absorb: 'fire' },
        { enemy: 'kamaitachi', count: 10, interval: 0.8, delay: 6, spawn: 1 },
      ],
    },
    {
      groups: [
        { enemy: 'kasaobake', count: 10, interval: 1.1, hp: 3.4 },
        { enemy: 'kasaobake', count: 10, interval: 1.1, delay: 2, spawn: 1, hp: 3.4 },
        { enemy: 'tengu', count: 5, interval: 1.8, delay: 6, hp: 1.35 },
      ],
    },
    // répit
    {
      groups: [
        { enemy: 'kodama', count: 12, interval: 1, hp: 3.05 },
        { enemy: 'kitsune', count: 6, interval: 1.4, delay: 3, spawn: 1, hp: 3.05, absorb: 'water' },
      ],
    },
    {
      groups: [
        { enemy: 'ushioni', count: 4, interval: 3.5, hp: 2.05 },
        { enemy: 'ushioni', count: 4, interval: 3.5, delay: 2, spawn: 1, hp: 2.05 },
        { enemy: 'kasaobake', count: 8, interval: 1.2, delay: 5, hp: 2.05 },
        { enemy: 'kitsune', count: 6, interval: 1.3, delay: 5, spawn: 1, hp: 2.05, absorb: 'earth' },
        { enemy: 'yukionna', count: 3, interval: 3, delay: 8, hp: 2.05 },
        { enemy: 'tengu', count: 4, interval: 1.6, delay: 10, hp: 0.85 },
      ],
    },
    // climax : La Charge des taureaux
    {
      name: 'La Charge des taureaux',
      climax: true,
      groups: [
        { enemy: 'ushioni', count: 5, interval: 3, hp: 2.8 },
        { enemy: 'ushioni', count: 5, interval: 3, delay: 1.5, spawn: 1, hp: 2.8 },
        { enemy: 'kasaobake', count: 12, interval: 1, delay: 4, hp: 2.8 },
        { enemy: 'kitsune', count: 6, interval: 1.2, delay: 6, spawn: 1, hp: 2.8, absorb: 'fire' },
        { enemy: 'kitsune', count: 6, interval: 1.2, delay: 7, hp: 2.8, absorb: 'wind' },
        { enemy: 'tengu', count: 6, interval: 1.5, delay: 9, spawn: 1, hp: 1.05 },
        { enemy: 'yukionna', count: 3, interval: 3, delay: 10, hp: 2.8 },
        { enemy: 'kamaitachi', count: 8, interval: 0.7, delay: 12, hp: 2.8 },
      ],
      reward: 0,
    },
  ],
};
