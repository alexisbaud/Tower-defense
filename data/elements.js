// Les quatre éléments. Chacun a un style de jeu, une forme (reconnaissable
// sans la couleur) et une famille de lanternes (champ `element` de data/towers.js).
// En multijoueur, chaque joueur choisit un ou plusieurs éléments.
export default {
  fire: {
    name: 'Feu',
    kanji: '火',
    shape: 'triangle',
    color: '#c8402a',
    style: 'Offensif',
    desc: 'Dégâts bruts et brûlures qui ignorent l’armure. Fragile face aux kitsune de feu.',
  },
  water: {
    name: 'Eau',
    kanji: '水',
    shape: 'drop',
    color: '#2f5f8f',
    style: 'Contrôle et soin',
    desc: 'Ralentit, soigne les barrières et transperce les files de yokai.',
  },
  wind: {
    name: 'Vent',
    kanji: '風',
    shape: 'diamond',
    color: '#5f8f6a',
    style: 'Mobilité et soutien',
    desc: 'Repousse, abat les volants et accélère les lanternes voisines.',
  },
  earth: {
    name: 'Terre',
    kanji: '土',
    shape: 'square',
    color: '#8a6a32',
    style: 'Défense et chemin',
    desc: 'Barrières, pierres et coups qui brisent les armures. Ne touche pas les volants.',
  },
};
