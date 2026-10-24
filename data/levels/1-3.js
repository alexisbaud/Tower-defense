// Niveau 1-3 — le sentier longe l'étang, le retraverse sur un long pont de planches puis redescend ; les tengu volent en diagonale ; premier Rembobinage.
export default {
  id: '1-3',
  name: "L'Étang aux carpes",
  subtitle: 'Certains yokai ne suivent pas le chemin',
  world: 'moss',
  map: [
    'TS,,,,,,T',
    ',.#,#ooo,',
    ',.#,#ooo#',
    'T.,,.ooo#',
    ',.#~=~#.,',
    ',.~#=~~.T',
    ',.~~=~~.,',
    'T.~~=#~.,',
    ',.#~=~~.,',
    ',.~~=~#.,',
    ',.##.,#.,',
    'T....#,.,',
    'T,,,,,,G,',
  ],
  startGold: 170,
  hpScale: 1.4,
  lives: 20,
  towers: ['fire', 'water', 'wind', 'earth'],
  stones: { cost: 10, max: 6 },
  rewind: true,
  tutorial: ['rewind'],
  introduce: ['tengu'],
  waves: [
    { groups: [{ enemy: 'kodama', count: 10, interval: 1.1 }, { enemy: 'kamaitachi', count: 6, interval: 0.9, delay: 5 }] },
    { groups: [{ enemy: 'kamaitachi', count: 12, interval: 0.7, hp: 1.2 }, { enemy: 'kappa', count: 3, interval: 2.5, delay: 6 }] },
    { groups: [{ enemy: 'kodama', count: 10, interval: 1.0, hp: 1.3 }, { enemy: 'tengu', count: 5, interval: 2.0, delay: 5 }] },
    { groups: [{ enemy: 'tengu', count: 8, interval: 1.4, hp: 1.2 }, { enemy: 'kodama', count: 14, interval: 0.8, delay: 3, hp: 1.8 }] },
    {
      groups: [
        { enemy: 'kappa', count: 6, interval: 1.8, hp: 1.5 },
        { enemy: 'kamaitachi', count: 14, interval: 0.6, delay: 5, hp: 1.8 },
        { enemy: 'tengu', count: 4, interval: 1.5, delay: 8, hp: 1.3 },
      ],
    },
    {
      groups: [
        { enemy: 'kodama', count: 20, interval: 0.6, hp: 2.2 },
        { enemy: 'tengu', count: 8, interval: 1.2, delay: 4, hp: 1.4 },
        { enemy: 'kappa', count: 4, interval: 2.0, delay: 10, hp: 1.6 },
      ],
    },
    {
      groups: [
        { enemy: 'kappa', count: 8, interval: 1.5, hp: 1.9 },
        { enemy: 'tengu', count: 12, interval: 1.0, delay: 3, hp: 1.6 },
        { enemy: 'kamaitachi', count: 18, interval: 0.5, delay: 8, hp: 2.2 },
      ],
      reward: 0,
    },
  ],
};
