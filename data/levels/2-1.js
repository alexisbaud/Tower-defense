// Niveau 2-1 — Les Terrasses gelées. Leçon : la priorité de ciblage (et le répit).
//
// Après l'Aka-oni, un niveau plus doux pour essayer les douze lanternes : quatre
// terrasses reliées par des marches, et beaucoup de socles entre elles (chacun
// couvre deux terrasses). Les tengu descendent le long du bord est, où veillent
// des socles de Vent. Les yuki-onna soignent le cortège : régler une lanterne
// sur « plus fort » (ou les aveugler à la Vapeur) les abat en premier. Elles sont
// insensibles à l'Eau : à deux, l'équipe Eau + Vent compte sur le Vent (qu'elles
// craignent) ; yuki-onna, kappa et kitsune restent donc modérés.
//
// Courbe : 1-3 montée, 4 répit, 5-6 montée, 7 répit, 8-9 montée, 10 répit,
// 11 montée, 12 climax « La Procession des neiges ».
export default {
  id: '2-1',
  name: 'Les Terrasses gelées',
  subtitle: 'Visez d’abord celle qui soigne',
  concept: 'Priorité',
  world: 'snow',
  map: [
    'T,,,,,,ST',
    ',,3,#,1.,',
    ',.......,',
    ',.2#,4#,,',
    ',.,,1,3,,',
    ',.......,',
    ',#4,#2,.,',
    'T,#1,3#.,',
    ',.......,',
    ',.#2,#4,,',
    ',.,1#,3,,',
    ',.......,',
    'T,,,,,,G,',
  ],
  startGold: 380,
  lives: 20,
  hpScale: 3,
  wavePause: 15,
  // les douze lanternes (trois par élément)
  towers: ['fire', 'fire_mortar', 'fire_wisp', 'water', 'water_spring', 'water_torrent', 'wind', 'wind_chime', 'wind_bow', 'earth', 'earth_guard', 'earth_quake'],
  rewind: true,
  tutorial: ['priority'],
  introduce: ['yukionna'],
  hard: { hpScale: 1.7, startGold: -30, lives: -5 },
  challenge: {
    name: 'Sans Terre',
    desc: 'Gagner sans lanterne de Terre : ni catapulte, ni gardien, ni séisme.',
    rule: { forbidTowers: ['earth', 'earth_guard', 'earth_quake'] },
  },
  waves: [
    { groups: [{ enemy: 'kodama', count: 10, interval: 1.2, hp: 1.15 }, { enemy: 'kamaitachi', count: 4, interval: 1.2, delay: 6, hp: 1.15 }] },
    { groups: [{ enemy: 'yukionna', count: 2, interval: 4, hp: 0.7 }, { enemy: 'kodama', count: 10, interval: 1.1, delay: 1, hp: 1.2 }] },
    {
      groups: [
        { enemy: 'kappa', count: 4, interval: 2.5, hp: 0.95 },
        { enemy: 'yukionna', count: 2, interval: 4, delay: 2, hp: 0.65 },
        { enemy: 'kamaitachi', count: 8, interval: 0.9, delay: 5, hp: 1.1 },
      ],
    },
    // répit
    { groups: [{ enemy: 'tengu', count: 4, interval: 2.2, hp: 0.3 }, { enemy: 'kodama', count: 8, interval: 1.2, delay: 3 }] },
    {
      groups: [
        { enemy: 'nuppeppo', count: 6, interval: 1.8, hp: 0.75 },
        { enemy: 'yukionna', count: 3, interval: 3, delay: 2, hp: 0.45 },
        { enemy: 'kitsune', count: 5, interval: 1.5, delay: 5, hp: 0.45, absorb: 'wind' },
      ],
    },
    {
      groups: [
        { enemy: 'kappa', count: 6, interval: 1.8, hp: 1.25 },
        { enemy: 'yukionna', count: 3, interval: 3, delay: 2, hp: 0.9 },
        { enemy: 'kamaitachi', count: 10, interval: 0.8, delay: 6, hp: 1.5 },
      ],
    },
    // répit
    {
      groups: [
        { enemy: 'kitsune', count: 6, interval: 1.5, hp: 0.8, absorb: 'water' },
        { enemy: 'kodama', count: 8, interval: 1.1, delay: 3, hp: 1.35 },
      ],
    },
    {
      groups: [
        { enemy: 'nuppeppo', count: 8, interval: 1.5, hp: 1.5 },
        { enemy: 'yukionna', count: 4, interval: 2.5, delay: 2, hp: 0.9 },
        { enemy: 'tengu', count: 5, interval: 1.8, delay: 6, hp: 0.4 },
      ],
    },
    {
      groups: [
        { enemy: 'kappa', count: 8, interval: 1.5, hp: 1.15 },
        { enemy: 'yukionna', count: 4, interval: 2.5, delay: 2, hp: 0.8 },
        { enemy: 'kitsune', count: 6, interval: 1.3, delay: 5, hp: 0.8, absorb: 'fire' },
        { enemy: 'kamaitachi', count: 8, interval: 0.8, delay: 9, hp: 1.35 },
      ],
    },
    // répit
    { groups: [{ enemy: 'kodama', count: 16, interval: 0.9, hp: 1.25 }, { enemy: 'tengu', count: 4, interval: 2, delay: 4, hp: 0.35 }] },
    {
      groups: [
        { enemy: 'nuppeppo', count: 8, interval: 1.3, hp: 1.85 },
        { enemy: 'kappa', count: 6, interval: 1.6, delay: 3, hp: 1.55 },
        { enemy: 'yukionna', count: 5, interval: 2.2, delay: 4, hp: 1.1 },
        { enemy: 'tengu', count: 6, interval: 1.6, delay: 8, hp: 0.5 },
      ],
    },
    // climax : La Procession des neiges
    {
      name: 'La Procession des neiges',
      climax: true,
      groups: [
        { enemy: 'yukionna', count: 6, interval: 2.2, hp: 1.6 },
        { enemy: 'kappa', count: 8, interval: 1.4, delay: 2, hp: 2.25 },
        { enemy: 'kitsune', count: 8, interval: 1.2, delay: 6, hp: 1.6, absorb: 'earth' },
        { enemy: 'nuppeppo', count: 6, interval: 1.4, delay: 9, hp: 2.65 },
        { enemy: 'kamaitachi', count: 12, interval: 0.7, delay: 13, hp: 2.65 },
      ],
      reward: 0,
    },
  ],
};
