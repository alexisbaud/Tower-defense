// Niveau 2-3 — Le Ciel de fer. Leçon : volants et blindés à la fois.
//
// Les tengu coupent en diagonale de la porte au sanctuaire, au-dessus d'une cour
// de gravier ; les socles de Vent jalonnent leur ligne (îlots de la cour). Au
// sol, kappa et ushi-oni, cuirassés, suivent le long sentier : la Terre (perce,
// séisme, Tempête de sable) brise les armures mais ne touche pas les volants ;
// le Vent abat les volants mais glisse sur les carapaces. Il faut les deux, et
// des pierres pour allonger la traversée de la cour.
//
// Courbe : 1-3 montée, 4 répit, 5-6 montée, 7 répit, 8-9 montée, 10 répit,
// 11-12 montée, 13 climax « La Nuée de fer ».
export default {
  id: '2-3',
  name: 'Le Ciel de fer',
  subtitle: 'Des ailes au-dessus, des carapaces en dessous',
  concept: 'Volants et blindés',
  world: 'snow',
  map: [
    'TS,,,,,,T',
    ',.#3,#1,,',
    ',.......,',
    ',#4,2#,.,',
    ',ooooooo,',
    '1ooo3ooo2',
    ',ooooooo,',
    ',ooo#3oo,',
    '#ooooooo4',
    ',.#4,2#,,',
    ',.......,',
    'T,#1,#3.,',
    'T,,,,,,G,',
  ],
  startGold: 400,
  lives: 20,
  hpScale: 2,
  wavePause: 14,
  // les douze lanternes (trois par élément)
  towers: ['fire', 'fire_mortar', 'fire_wisp', 'water', 'water_spring', 'water_torrent', 'wind', 'wind_chime', 'wind_bow', 'earth', 'earth_guard', 'earth_quake'],
  stones: { cost: 10, max: 10 },
  rewind: true,
  hard: { hpScale: 1.15, startGold: -30, lives: -5 },
  challenge: {
    name: 'Cœur intact',
    desc: 'Gagner avec au moins 15 vies au sanctuaire.',
    rule: { minLives: 15 },
  },
  waves: [
    { groups: [{ enemy: 'tengu', count: 4, interval: 2.2, hp: 0.65 }, { enemy: 'kodama', count: 8, interval: 1.2, delay: 2, hp: 1.5 }] },
    { groups: [{ enemy: 'kappa', count: 4, interval: 2.2, hp: 0.8 }, { enemy: 'tengu', count: 5, interval: 2, delay: 3, hp: 0.35 }] },
    { groups: [{ enemy: 'tengu', count: 8, interval: 1.5, hp: 0.7 }, { enemy: 'kamaitachi', count: 8, interval: 0.9, delay: 4, hp: 1.6 }] },
    // répit
    { groups: [{ enemy: 'kodama', count: 10, interval: 1.1, hp: 0.75 }, { enemy: 'kappa', count: 3, interval: 2.5, delay: 4, hp: 0.75 }] },
    {
      groups: [
        { enemy: 'ushioni', count: 2, interval: 5, hp: 0.9 },
        { enemy: 'tengu', count: 8, interval: 1.4, delay: 2, hp: 0.4 },
        { enemy: 'kappa', count: 4, interval: 2, delay: 5, hp: 0.9 },
      ],
    },
    {
      groups: [
        { enemy: 'tengu', count: 10, interval: 1.2, hp: 0.65 },
        { enemy: 'kappa', count: 6, interval: 1.8, delay: 3, hp: 1.45 },
        { enemy: 'kitsune', count: 5, interval: 1.5, delay: 6, hp: 1.45, absorb: 'wind' },
      ],
    },
    // répit
    { groups: [{ enemy: 'nuppeppo', count: 6, interval: 1.8, hp: 1.3 }, { enemy: 'tengu', count: 4, interval: 2, delay: 3, hp: 0.6 }] },
    {
      groups: [
        { enemy: 'ushioni', count: 3, interval: 4, hp: 1.55 },
        { enemy: 'kappa', count: 8, interval: 1.5, delay: 2, hp: 1.55 },
        { enemy: 'tengu', count: 10, interval: 1.1, delay: 5, hp: 0.7 },
      ],
    },
    {
      groups: [
        { enemy: 'tengu', count: 12, interval: 1, hp: 1.05 },
        { enemy: 'yukionna', count: 3, interval: 3, delay: 2, hp: 2.35 },
        { enemy: 'kappa', count: 6, interval: 1.6, delay: 4, hp: 2.35 },
        { enemy: 'kasaobake', count: 6, interval: 1.2, delay: 8, hp: 2.35 },
      ],
    },
    // répit
    { groups: [{ enemy: 'kodama', count: 14, interval: 0.9, hp: 2.1 }, { enemy: 'tengu', count: 6, interval: 1.6, delay: 4, hp: 0.95 }] },
    {
      groups: [
        { enemy: 'ushioni', count: 4, interval: 3.5, hp: 2.55 },
        { enemy: 'kappa', count: 10, interval: 1.3, delay: 2, hp: 2.55 },
        { enemy: 'tengu', count: 12, interval: 1, delay: 6, hp: 1.15 },
      ],
    },
    {
      groups: [
        { enemy: 'tengu', count: 16, interval: 0.9, hp: 1.75 },
        { enemy: 'ushioni', count: 3, interval: 4, delay: 2, hp: 3.9 },
        { enemy: 'kappa', count: 8, interval: 1.4, delay: 4, hp: 3.9 },
        { enemy: 'kitsune', count: 6, interval: 1.3, delay: 8, hp: 3.9, absorb: 'wind' },
      ],
    },
    // climax : La Nuée de fer
    {
      name: 'La Nuée de fer',
      climax: true,
      groups: [
        { enemy: 'tengu', count: 20, interval: 0.8, hp: 2 },
        { enemy: 'ushioni', count: 5, interval: 3, delay: 2, hp: 4.5 },
        { enemy: 'kappa', count: 10, interval: 1.2, delay: 4, hp: 4.5 },
        { enemy: 'tokihami', count: 3, interval: 3, delay: 10, hp: 4.5 },
      ],
      reward: 0,
    },
  ],
};
