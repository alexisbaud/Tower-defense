// Niveau 1-4 — La Clairière de l'Oni. Leçon : façonner le chemin (pierres et barrières).
//
// Un lacet au nord, puis une grande clairière de gravier : sans pierre, les yokai
// la traversent en ligne droite ; quelques pierres les forcent à serpenter sous
// les lanternes des îlots. Au sud, un goulet bordé de socles : un Gardien de
// pierre y dresse un mur que la Source sacrée répare, et les kappa (armure)
// s'y entassent sous la catapulte. L'Aka-oni, boss du Jardin de mousse, ferme
// la marche : son coup de massue étourdit les lanternes proches.
//
// Courbe : 1-3 montée, 4 répit, 5-6 montée, 7 répit, 8-9 montée, 10 répit,
// 11 montée, 12 climax « La Marche de l'Aka-oni ».
export default {
  id: '1-4',
  name: "La Clairière de l'Oni",
  subtitle: 'Détournez le sentier, dressez le mur',
  concept: 'Pierres et barrières',
  world: 'moss',
  map: [
    'T,,,,,,ST',
    ',1,#3,#.,',
    ',.......,',
    ',.#4,1#,,',
    ',....#,,,',
    ',#2,.3#,,',
    ',ooooooo,',
    '#ooo#ooo4',
    '2ooooooo#',
    ',ooo1ooo,',
    ',ooooooo,',
    ',,#4.2#,,',
    'T,,,G,,,T',
  ],
  startGold: 340,
  lives: 20,
  hpScale: 4,
  wavePause: 15,
  towers: ['fire', 'water', 'wind', 'earth', 'fire_mortar', 'wind_bow', 'earth_guard', 'water_spring'],
  stones: { cost: 10, max: 10 },
  rewind: true,
  tutorial: ['stone', 'barrier'],
  introduce: ['kappa', 'akaoni'],
  hard: { hpScale: 1.2, startGold: -20, lives: -5 },
  challenge: {
    name: 'Sans pierre',
    desc: 'Gagner sans poser une seule pierre : les barrières seules tiennent le chemin.',
    rule: { noStones: true },
  },
  waves: [
    { groups: [{ enemy: 'kodama', count: 10, interval: 1.2, hp: 1.55 }] },
    { groups: [{ enemy: 'kappa', count: 3, interval: 3, hp: 1.15 }, { enemy: 'kodama', count: 8, interval: 1.2, delay: 2, hp: 1.15 }] },
    {
      groups: [
        { enemy: 'kappa', count: 4, interval: 2.5, hp: 0.9 },
        { enemy: 'kamaitachi', count: 8, interval: 0.9, delay: 3, hp: 0.9 },
        { enemy: 'kodama', count: 6, interval: 1.2, delay: 6, hp: 0.9 },
      ],
    },
    // répit
    { groups: [{ enemy: 'kamaitachi', count: 10, interval: 1, hp: 0.8 }] },
    {
      groups: [
        { enemy: 'kappa', count: 6, interval: 2, hp: 0.8 },
        { enemy: 'nuppeppo', count: 5, interval: 2, delay: 3, hp: 0.8 },
        { enemy: 'kodama', count: 8, interval: 1, delay: 6, hp: 0.8 },
      ],
    },
    {
      groups: [
        { enemy: 'kappa', count: 6, interval: 1.8 },
        { enemy: 'kitsune', count: 6, interval: 1.5, delay: 3, absorb: 'earth' },
        { enemy: 'kamaitachi', count: 10, interval: 0.8, delay: 6 },
      ],
    },
    // répit
    { groups: [{ enemy: 'tengu', count: 5, interval: 2, hp: 0.3 }, { enemy: 'kodama', count: 10, interval: 1, delay: 3, hp: 0.9 }] },
    {
      groups: [
        { enemy: 'kappa', count: 8, interval: 1.6, hp: 0.85 },
        { enemy: 'nuppeppo', count: 6, interval: 1.6, delay: 3, hp: 0.85 },
        { enemy: 'kamaitachi', count: 10, interval: 0.8, delay: 7, hp: 0.85 },
      ],
    },
    {
      groups: [
        { enemy: 'kappa', count: 8, interval: 1.5 },
        { enemy: 'kitsune', count: 6, interval: 1.4, delay: 3, absorb: 'fire' },
        { enemy: 'tengu', count: 5, interval: 1.8, delay: 5, hp: 0.35 },
        { enemy: 'kodama', count: 10, interval: 0.9, delay: 8 },
      ],
    },
    // répit
    { groups: [{ enemy: 'kamaitachi', count: 14, interval: 0.8, hp: 0.9 }, { enemy: 'kodama', count: 8, interval: 1, delay: 4, hp: 0.9 }] },
    {
      groups: [
        { enemy: 'kappa', count: 10, interval: 1.3, hp: 1.3 },
        { enemy: 'nuppeppo', count: 8, interval: 1.4, delay: 3, hp: 1.3 },
        { enemy: 'kamaitachi', count: 12, interval: 0.7, delay: 8, hp: 1.3 },
        { enemy: 'tengu', count: 5, interval: 1.8, delay: 10, hp: 0.45 },
      ],
    },
    // climax : La Marche de l'Aka-oni
    {
      name: "La Marche de l'Aka-oni",
      climax: true,
      groups: [
        { enemy: 'kodama', count: 8, interval: 0.9, hp: 2.15 },
        { enemy: 'kitsune', count: 6, interval: 1.2, delay: 3, hp: 2.15, absorb: 'fire' },
        { enemy: 'akaoni', count: 1, delay: 6, hp: 0.75 },
        { enemy: 'kappa', count: 8, interval: 1.4, delay: 8, hp: 2.15 },
        { enemy: 'kamaitachi', count: 10, interval: 0.7, delay: 14, hp: 2.15 },
        { enemy: 'tengu', count: 6, interval: 1.6, delay: 16, hp: 0.75 },
      ],
      reward: 0,
    },
  ],
};
