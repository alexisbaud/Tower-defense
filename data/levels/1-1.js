// Niveau 1-1 — tutoriel intégré : poser une lanterne, lancer une vague.
//
// Légende de la grille :
//   .  chemin            o  zone ouverte (chemin où l'on peut poser des pierres)
//   #  emplacement de lanterne
//   S  apparition des yokai   G  sanctuaire (objectif)
//   ,  herbe (décor)     T  arbre (décor)    ~  eau (décor)
//   R  rocher (décor)    =  pont (chemin)     (espace) vide
export default {
  id: '1-1',
  name: 'Le Seuil',
  subtitle: 'Allumez votre première lanterne',
  world: 'moss',
  map: [
    'T,,,S,,,T',
    ',###.#,,,',
    ',....##,T',
    ',.#####,,',
    ',.......,',
    'T##,###.,',
    ',,,,,##.,',
    ',.......,',
    ',.#####,T',
    ',.....##,',
    'T,#,#.#,,',
    ',,,,,.,,T',
    'T,,,,G,,T',
  ],
  startGold: 120,
  lives: 20,
  towers: ['fire', 'water'],
  tutorial: ['place', 'wave'],
  waves: [
    { groups: [{ enemy: 'kodama', count: 5, interval: 1.8 }] },
    { groups: [{ enemy: 'kodama', count: 8, interval: 1.3 }] },
    { groups: [{ enemy: 'kodama', count: 6, interval: 1.4 }, { enemy: 'kamaitachi', count: 4, interval: 1.6, delay: 4 }] },
    { groups: [{ enemy: 'kamaitachi', count: 8, interval: 1.0 }, { enemy: 'kodama', count: 8, interval: 1.2, delay: 3 }] },
    { groups: [{ enemy: 'kodama', count: 12, interval: 0.9 }, { enemy: 'kamaitachi', count: 10, interval: 0.8, delay: 5 }], reward: 0 },
  ],
};
