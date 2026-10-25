// Niveau 1-3 — L'Étang du temps. Leçon : le Rembobinage.
//
// Le sentier fait le tour de l'étang par le nord, le traverse sur un long pont
// de planches puis redescend vers le sanctuaire ; deux îlots bordent le pont.
// Les tengu (premiers volants) coupent en diagonale au-dessus de l'eau : les
// socles de Vent sont posés sur leur ligne. La jauge de Rembobinage est pleine
// dès le départ pour l'essayer tôt ; elle se recharge en éliminant des yokai et
// en appelant les vagues en avance. En fin de niveau, les tokihami (hors du
// temps) montrent sa limite : eux ne reculent pas.
//
// Courbe : 1-3 montée, 4 répit, 5-6 montée, 7 répit, 8-9 montée, 10 répit,
// 11 montée, 12 climax « L'Heure dévorée ».
export default {
  id: '1-3',
  name: "L'Étang du temps",
  subtitle: 'Six secondes pour se raviser',
  concept: 'Rembobinage',
  world: 'moss',
  map: [
    'TS,,,,,,T',
    ',.,#1,#,,',
    ',.......,',
    ',,3~~4#.,',
    'T,~~~~~.,',
    ',2~~#~~.T',
    ',.=====.,',
    ',.~~3~~#,',
    'T.~~~~~,,',
    ',.#12~#,,',
    ',.....,,,',
    'T,,#4.#,T',
    'T,,,,G,,T',
  ],
  startGold: 320,
  lives: 20,
  hpScale: 1,
  wavePause: 15,
  towers: ['fire', 'water', 'wind', 'earth', 'fire_mortar', 'wind_bow'],
  rewind: true,
  rewindStart: 100,
  tutorial: ['rewind'],
  introduce: ['nuppeppo', 'tengu', 'tokihami'],
  hard: { hpScale: 1.5, startGold: -20, lives: -5 },
  challenge: {
    name: 'Sans rembobinage',
    desc: 'Gagner sans jamais remonter le temps.',
    rule: { noRewind: true },
  },
  waves: [
    { groups: [{ enemy: 'kodama', count: 8, interval: 1.3, hp: 1.05 }, { enemy: 'kamaitachi', count: 4, interval: 1.2, delay: 5, hp: 1.05 }] },
    { groups: [{ enemy: 'nuppeppo', count: 4, interval: 2.5, hp: 1.1 }, { enemy: 'kodama', count: 6, interval: 1.3, delay: 2, hp: 1.1 }] },
    {
      groups: [
        { enemy: 'nuppeppo', count: 5, interval: 2.2, hp: 1.3 },
        { enemy: 'kitsune', count: 4, interval: 1.8, delay: 3, hp: 1.3, absorb: 'wind' },
        { enemy: 'kamaitachi', count: 6, interval: 1, delay: 6, hp: 1.3 },
      ],
    },
    // répit
    { groups: [{ enemy: 'tengu', count: 3, interval: 2.5, hp: 0.5 }, { enemy: 'kodama', count: 6, interval: 1.3, delay: 2, hp: 1.1 }] },
    {
      groups: [
        { enemy: 'nuppeppo', count: 6, interval: 1.8, hp: 1.7 },
        { enemy: 'kitsune', count: 5, interval: 1.6, delay: 3, hp: 1.7, absorb: 'water' },
        { enemy: 'kamaitachi', count: 8, interval: 0.9, delay: 6, hp: 1.7 },
      ],
    },
    {
      groups: [
        { enemy: 'tengu', count: 5, interval: 2, hp: 1.1 },
        { enemy: 'nuppeppo', count: 6, interval: 1.7, delay: 2, hp: 2.45 },
        { enemy: 'kodama', count: 8, interval: 1, delay: 5, hp: 2.45 },
      ],
    },
    // répit
    { groups: [{ enemy: 'kamaitachi', count: 12, interval: 0.9, hp: 1.85 }] },
    {
      groups: [
        { enemy: 'nuppeppo', count: 8, interval: 1.5, hp: 2.85 },
        { enemy: 'kitsune', count: 6, interval: 1.4, delay: 3, hp: 2.85, absorb: 'wind' },
        { enemy: 'tengu', count: 4, interval: 2, delay: 6, hp: 1.3 },
      ],
    },
    {
      groups: [
        { enemy: 'tokihami', count: 2, interval: 4, hp: 5.15 },
        { enemy: 'nuppeppo', count: 6, interval: 1.5, delay: 3, hp: 5.15 },
        { enemy: 'kamaitachi', count: 10, interval: 0.8, delay: 7, hp: 5.15 },
      ],
    },
    // répit
    { groups: [{ enemy: 'kodama', count: 14, interval: 0.9, hp: 4.65 }, { enemy: 'tengu', count: 4, interval: 2, delay: 4, hp: 2.1 }] },
    {
      groups: [
        { enemy: 'tokihami', count: 4, interval: 3, hp: 6.1 },
        { enemy: 'nuppeppo', count: 8, interval: 1.3, delay: 2, hp: 6.1 },
        { enemy: 'kitsune', count: 6, interval: 1.3, delay: 5, hp: 6.1, absorb: 'earth' },
        { enemy: 'tengu', count: 5, interval: 1.8, delay: 8, hp: 2.75 },
      ],
    },
    // climax : L'Heure dévorée
    {
      name: "L'Heure dévorée",
      climax: true,
      groups: [
        { enemy: 'tokihami', count: 6, interval: 2.5, hp: 8.05 },
        { enemy: 'nuppeppo', count: 10, interval: 1.2, delay: 2, hp: 8.05 },
        { enemy: 'kitsune', count: 8, interval: 1.2, delay: 5, hp: 8.05, absorb: 'fire' },
        { enemy: 'tengu', count: 6, interval: 1.6, delay: 8, hp: 3.6 },
        { enemy: 'kamaitachi', count: 12, interval: 0.7, delay: 12, hp: 8.05 },
      ],
      reward: 0,
    },
  ],
};
