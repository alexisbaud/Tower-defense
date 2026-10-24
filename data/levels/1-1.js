// Niveau 1-1 — Le Seuil. Leçon : poser des lanternes, lancer puis appeler les vagues.
//
// Un seul sentier en serpentin : chaque coude borde deux lacets, les socles du
// milieu couvrent donc deux passages. Quelques socles typés (un par élément)
// montrent qu'un socle peut être réservé ; les socles universels (#) suffisent
// pour gagner. Seuls des kodama (lents) et des kamaitachi (rapides) attaquent.
//
// Courbe : 1-3 montée douce, 4 répit, 5-6 montée, 7 répit, 8-9 montée,
// 10 répit, 11 climax « La Horde du seuil » (le pic le plus haut).
//
// Légende de la grille (voir src/core/grid.js) :
//   .  chemin            o  gravier (chemin où l'on pose des pierres)
//   #  socle universel   1 Feu  2 Eau  3 Vent  4 Terre (socles réservés)
//   S  apparition des yokai   G  sanctuaire (objectif)
//   ,  herbe (décor)     T  arbre (décor)    ~  eau (décor)
//   R  rocher (décor)    =  pont (chemin)     (espace) vide
export default {
  id: '1-1',
  name: 'Le Seuil',
  subtitle: 'Allumez votre première lanterne',
  concept: 'Poser et lancer',
  world: 'moss',
  map: [
    'T,,,S,,,T',
    ',T,#.4,,,',
    ',....#,,T',
    ',.#2,,,T,',
    ',.,1#,,,,',
    ',.......,',
    'T,3#,,#.,',
    ',,,,,4#.T',
    ',.......,',
    ',.#1,,,,T',
    ',....2,,,',
    'T,,#.3,,T',
    'T,,,G,,,T',
  ],
  startGold: 180,
  lives: 20,
  hpScale: 2,
  wavePause: 17,
  towers: ['fire', 'water', 'wind', 'earth'],
  tutorial: ['place', 'wave', 'early'],
  introduce: ['kodama', 'kamaitachi'],
  hard: { hpScale: 2.2, startGold: -20, lives: -5 },
  challenge: {
    name: 'Dix lanternes',
    desc: 'Gagner en posant dix lanternes au plus (une fusion compte ses deux lanternes).',
    rule: { maxTowers: 10 },
  },
  waves: [
    { groups: [{ enemy: 'kodama', count: 6, interval: 1.8, hp: 0.95 }] },
    { groups: [{ enemy: 'kodama', count: 8, interval: 1.5, hp: 1.05 }] },
    { groups: [{ enemy: 'kodama', count: 5, interval: 1.6, hp: 1.35 }, { enemy: 'kamaitachi', count: 5, interval: 1.4, delay: 5, hp: 1.35 }] },
    // répit
    { groups: [{ enemy: 'kamaitachi', count: 7, interval: 1.6, hp: 1.2 }] },
    { groups: [{ enemy: 'kodama', count: 10, interval: 1.2, hp: 1.65 }, { enemy: 'kamaitachi', count: 6, interval: 1.2, delay: 6, hp: 1.65 }] },
    { groups: [{ enemy: 'kodama', count: 12, interval: 1, hp: 1.85 }, { enemy: 'kamaitachi', count: 8, interval: 1, delay: 5, hp: 1.5 }] },
    // répit
    { groups: [{ enemy: 'kamaitachi', count: 10, interval: 1.1, hp: 1.5 }] },
    { groups: [{ enemy: 'kodama', count: 14, interval: 0.9, hp: 2.85 }, { enemy: 'kamaitachi', count: 10, interval: 0.9, delay: 4, hp: 2.65 }] },
    { groups: [{ enemy: 'kamaitachi', count: 12, interval: 0.8, hp: 4.4 }, { enemy: 'kodama', count: 16, interval: 0.8, delay: 3, hp: 4.75 }] },
    // répit
    { groups: [{ enemy: 'kodama', count: 12, interval: 1, hp: 4.15 }] },
    // climax : La Horde du seuil
    {
      name: 'La Horde du seuil',
      climax: true,
      groups: [
        { enemy: 'kodama', count: 20, interval: 0.75, hp: 6.8 },
        { enemy: 'kamaitachi', count: 10, interval: 0.7, delay: 4, hp: 6.45 },
        { enemy: 'kamaitachi', count: 8, interval: 0.6, delay: 12, hp: 6.45 },
      ],
      reward: 0,
    },
  ],
};
