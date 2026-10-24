// Niveau 2-4 — Le Dernier Torii. Leçon : tout réunir face au boss final.
//
// Le sentier descend les terrasses du temple en lacets serrés (chaque socle entre
// deux lacets en couvre deux), puis traverse la cour de gravier du dernier torii.
// Les tengu plongent droit par l'axe central, où veillent les socles de Vent.
// Le Gashadokuro, squelette géant, invoque des kodama et change d'élément absorbé
// toutes les 6 s : il faut plusieurs éléments (ou la Vapeur pour l'aveugler) et
// des dégâts de zone pour ses invocations ; les tokihami de son escorte ignorent
// le Rembobinage.
//
// Courbe : 1-3 montée, 4 répit, 5-6 montée, 7 répit, 8-9 montée, 10 répit,
// 11-13 montée, 14 climax « Les Os du géant ».
export default {
  id: '2-4',
  name: 'Le Dernier Torii',
  subtitle: 'Les os du géant font trembler la neige',
  concept: 'Boss final',
  world: 'snow',
  map: [
    'T,,,S,,,T',
    ',....,,,,',
    ',.,13#2#,',
    ',.......,',
    ',#4#,2#.,',
    ',.......,',
    ',.#1#3#,,',
    ',.......,',
    ',,2#3#4.,',
    ',ooooooo,',
    '2ooo3ooo1',
    ',ooooooo,',
    'T,,,G,,,T',
  ],
  startGold: 420,
  lives: 20,
  hpScale: 3,
  wavePause: 10,
  // les douze lanternes (trois par élément)
  towers: ['fire', 'fire_mortar', 'fire_wisp', 'water', 'water_spring', 'water_torrent', 'wind', 'wind_chime', 'wind_bow', 'earth', 'earth_guard', 'earth_quake'],
  stones: { cost: 10, max: 8 },
  rewind: true,
  introduce: ['gashadokuro'],
  hard: { hpScale: 1.15, startGold: -30, lives: -5 },
  challenge: {
    name: 'Aucune fuite',
    desc: 'Gagner sans qu’un seul yokai n’atteigne le sanctuaire.',
    rule: { noLeak: true },
  },
  waves: [
    { groups: [{ enemy: 'kodama', count: 10, interval: 1.1 }, { enemy: 'kamaitachi', count: 6, interval: 1, delay: 5 }] },
    {
      groups: [
        { enemy: 'kitsune', count: 6, interval: 1.6, hp: 1.05, absorb: 'fire' },
        { enemy: 'nuppeppo', count: 4, interval: 2, delay: 3, hp: 1.05 },
      ],
    },
    {
      groups: [
        { enemy: 'tengu', count: 6, interval: 1.8, hp: 0.9 },
        { enemy: 'kappa', count: 4, interval: 2.2, delay: 2, hp: 2.2 },
        { enemy: 'yukionna', count: 2, interval: 4, delay: 5, hp: 2.2 },
      ],
    },
    // répit
    { groups: [{ enemy: 'kodama', count: 12, interval: 1, hp: 1.6 }] },
    {
      groups: [
        { enemy: 'tokihami', count: 2, interval: 4, hp: 1.9 },
        { enemy: 'kasaobake', count: 6, interval: 1.4, delay: 2, hp: 1.9 },
        { enemy: 'kitsune', count: 6, interval: 1.4, delay: 5, hp: 1.9, absorb: 'water' },
      ],
    },
    {
      groups: [
        { enemy: 'ushioni', count: 3, interval: 4, hp: 2.15 },
        { enemy: 'kappa', count: 5, interval: 1.8, delay: 2, hp: 2.15 },
        { enemy: 'tengu', count: 6, interval: 1.6, delay: 5, hp: 0.8 },
      ],
    },
    // répit
    { groups: [{ enemy: 'kamaitachi', count: 12, interval: 0.9, hp: 1.5 }, { enemy: 'kodama', count: 6, interval: 1.2, delay: 4, hp: 1.5 }] },
    {
      groups: [
        { enemy: 'tokihami', count: 3, interval: 3.5, hp: 2.25 },
        { enemy: 'nuppeppo', count: 6, interval: 1.6, delay: 2, hp: 2.25 },
        { enemy: 'kitsune', count: 6, interval: 1.3, delay: 5, hp: 2.25, absorb: 'wind' },
        { enemy: 'yukionna', count: 3, interval: 3, delay: 6, hp: 2.25 },
      ],
    },
    {
      groups: [
        { enemy: 'ushioni', count: 3, interval: 4, hp: 3.2 },
        { enemy: 'kasaobake', count: 8, interval: 1.2, delay: 2, hp: 3.2 },
        { enemy: 'tengu', count: 8, interval: 1.4, delay: 5, hp: 1.3 },
        { enemy: 'kappa', count: 4, interval: 2, delay: 8, hp: 3.2 },
      ],
    },
    // répit
    {
      groups: [
        { enemy: 'kodama', count: 14, interval: 0.9, hp: 2.45 },
        { enemy: 'kitsune', count: 6, interval: 1.4, delay: 4, hp: 2.45, absorb: 'earth' },
      ],
    },
    {
      groups: [
        { enemy: 'tokihami', count: 4, interval: 3, hp: 1.75 },
        { enemy: 'kappa', count: 8, interval: 1.4, delay: 2, hp: 1.75 },
        { enemy: 'tengu', count: 10, interval: 1.2, delay: 5, hp: 0.7 },
        { enemy: 'yukionna', count: 3, interval: 3, delay: 7, hp: 1.75 },
        { enemy: 'kitsune', count: 6, interval: 1.3, delay: 9, hp: 1.75, absorb: 'fire' },
      ],
    },
    {
      groups: [
        { enemy: 'ushioni', count: 4, interval: 3.5, hp: 2.85 },
        { enemy: 'kasaobake', count: 10, interval: 1.1, delay: 2, hp: 2.85 },
        { enemy: 'nuppeppo', count: 8, interval: 1.3, delay: 5, hp: 2.85 },
        { enemy: 'tengu', count: 8, interval: 1.4, delay: 8, hp: 1.1 },
      ],
    },
    {
      groups: [
        { enemy: 'tokihami', count: 4, interval: 3, hp: 4.7 },
        { enemy: 'ushioni', count: 4, interval: 3.5, delay: 2, hp: 4.7 },
        { enemy: 'kitsune', count: 8, interval: 1.2, delay: 5, hp: 4.7, absorb: 'water' },
        { enemy: 'tengu', count: 10, interval: 1.2, delay: 8, hp: 1.9 },
        { enemy: 'kamaitachi', count: 10, interval: 0.7, delay: 12, hp: 4.7 },
      ],
    },
    // climax : Les Os du géant
    {
      name: 'Les Os du géant',
      climax: true,
      groups: [
        { enemy: 'gashadokuro', count: 1, hp: 1.45 },
        { enemy: 'tokihami', count: 4, interval: 3, hp: 5.95 },
        { enemy: 'kitsune', count: 6, interval: 1.3, delay: 8, hp: 5.95, absorb: 'wind' },
        { enemy: 'tengu', count: 8, interval: 1.4, delay: 10, hp: 2.35 },
        { enemy: 'kappa', count: 6, interval: 1.8, delay: 14, hp: 5.95 },
      ],
      reward: 0,
    },
  ],
};
