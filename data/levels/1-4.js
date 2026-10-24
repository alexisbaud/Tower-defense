// Niveau 1-4 — deux sentiers traversent le bosquet et se rejoignent dans une clairière de gravier ; l'Aka-oni ferme la marche.
export default {
  id: '1-4',
  name: "Le Bosquet de l'Oni",
  subtitle: 'Deux sentiers, une clairière, un ogre',
  world: 'moss',
  map: [
    'T,S,T,S,T',
    ',,.#T#.,,',
    'T,.#T#.,T',
    ',,ooooo,,',
    'T#ooooo#T',
    ',#ooooo#,',
    'T,.###,,T',
    ',#.....#,',
    ',,##T#.#,',
    'T,.....,,',
    ',,.##T#,T',
    ',,...#,,,',
    'T,,,G,,,T',
  ],
  startGold: 180,
  hpScale: 1.75,
  lives: 20,
  towers: ['fire', 'water', 'wind', 'earth'],
  stones: { cost: 10, max: 8 },
  rewind: true,
  introduce: ['akaoni'],
  waves: [
    { groups: [{ enemy: 'kodama', count: 10, interval: 1.0 }, { enemy: 'kodama', count: 8, interval: 1.0, delay: 2, spawn: 1 }] },
    { groups: [{ enemy: 'kamaitachi', count: 12, interval: 0.8, spawn: 1 }, { enemy: 'kappa', count: 3, interval: 2.5, delay: 4 }] },
    { groups: [{ enemy: 'kodama', count: 14, interval: 0.8 }, { enemy: 'tengu', count: 6, interval: 1.6, delay: 4, spawn: 1 }] },
    { groups: [{ enemy: 'kappa', count: 6, interval: 1.8 }, { enemy: 'kamaitachi', count: 16, interval: 0.6, delay: 3, spawn: 1 }] },
    {
      groups: [
        { enemy: 'kodama', count: 18, interval: 0.7, hp: 1.3 },
        { enemy: 'tengu', count: 8, interval: 1.3, delay: 3, spawn: 1 },
        { enemy: 'kappa', count: 4, interval: 2.0, delay: 8, spawn: 1 },
      ],
    },
    {
      groups: [
        { enemy: 'kamaitachi', count: 14, interval: 0.6, hp: 1.4 },
        { enemy: 'kamaitachi', count: 14, interval: 0.6, delay: 2, spawn: 1, hp: 1.4 },
        { enemy: 'kappa', count: 6, interval: 1.6, delay: 6, hp: 1.2 },
        { enemy: 'tengu', count: 6, interval: 1.4, delay: 8, spawn: 1 },
      ],
    },
    {
      groups: [
        { enemy: 'kappa', count: 8, interval: 1.4, hp: 1.4 },
        { enemy: 'kodama', count: 20, interval: 0.6, delay: 2, spawn: 1, hp: 1.6 },
        { enemy: 'tengu', count: 10, interval: 1.1, delay: 6, spawn: 1, hp: 1.2 },
        { enemy: 'kamaitachi', count: 16, interval: 0.5, delay: 10, hp: 1.6 },
      ],
    },
    {
      groups: [
        { enemy: 'akaoni', count: 1, delay: 2, hp: 1.5 },
        { enemy: 'kodama', count: 14, interval: 0.8, spawn: 1, hp: 1.6 },
        { enemy: 'kappa', count: 6, interval: 2.0, delay: 4, hp: 1.4 },
        { enemy: 'kamaitachi', count: 16, interval: 0.6, delay: 12, spawn: 1, hp: 1.6 },
        { enemy: 'tengu', count: 8, interval: 1.5, delay: 16, spawn: 1, hp: 1.2 },
      ],
      reward: 0,
    },
  ],
};
