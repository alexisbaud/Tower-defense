// Mondes et ordre des niveaux. Ajouter un niveau = créer data/levels/<id>.js
// puis ajouter son id dans la liste `levels` du monde voulu.
export default [
  {
    id: 'moss',
    name: 'Jardin de mousse',
    kanji: '苔庭',
    theme: {
      paper: '#efe4c8',
      ground: '#d9cba4',
      grass: '#7d8a4a',
      grassDark: '#4f5b2c',
      path: '#e8dcbc',
      water: '#3d6a8a',
      accent: '#c8402a',
      ambient: 'petals', // particules d'ambiance : petals | snow | leaves | fireflies
    },
    levels: ['1-1', '1-2'],
  },
];
