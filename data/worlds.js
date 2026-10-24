// Mondes et ordre des niveaux. Ajouter un niveau = créer data/levels/<id>.js
// puis ajouter son id dans la liste `levels` du monde voulu.
//
// theme :
//   paper, ground, grass, grassDark, path, water, accent  couleurs du terrain
//   ambient      particules d'ambiance : 'petals' | 'snow'
//   snowCaps     neige sur les arbres
//   tree         essence dessinée sur les cases T : 'pine' | 'sakura'
export default [
  {
    id: 'moss',
    name: 'Jardin de mousse',
    kanji: '苔庭',
    subtitle: 'Premier monde',
    theme: {
      paper: '#efe4c8',
      ground: '#d9cba4',
      grass: '#7d8a4a',
      grassDark: '#4f5b2c',
      path: '#e8dcbc',
      water: '#3d6a8a',
      accent: '#c8402a',
      ambient: 'petals',
      snowCaps: false,
      tree: 'pine',
    },
    levels: ['1-1', '1-2', '1-3', '1-4'],
  },
  {
    id: 'snow',
    name: 'Temple sous la neige',
    kanji: '雪寺',
    subtitle: 'Second monde',
    theme: {
      paper: '#eef0f2',
      ground: '#dfe4ea',
      grass: '#7f9496',
      grassDark: '#3f5560',
      path: '#f7f7f4',
      water: '#2c4a6e',
      accent: '#c8402a',
      ambient: 'snow',
      snowCaps: true,
      tree: 'pine',
    },
    levels: ['2-1', '2-2', '2-3', '2-4'],
  },
];
