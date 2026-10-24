// Définition des yokai (ennemis). Données pures.
//
//   hp        points de vie
//   speed     vitesse en cases par seconde
//   reward    or gagné à l'élimination
//   damage    vies retirées s'il atteint le sanctuaire
//   size      rayon visuel / de collision en cases
//   look      style de dessin utilisé par le moteur de rendu
//   abilities capacités optionnelles (voir README « Ajouter un ennemi »)
export default {
  kodama: {
    name: 'Kodama',
    desc: 'Petit esprit des arbres. Lent et docile.',
    hp: 40,
    speed: 0.95,
    reward: 5,
    damage: 1,
    size: 0.3,
    look: 'kodama',
    abilities: {},
  },
  kamaitachi: {
    name: 'Kamaitachi',
    desc: 'Belette-faucille. Très rapide, mais fragile.',
    hp: 26,
    speed: 2.0,
    reward: 6,
    damage: 1,
    size: 0.27,
    look: 'kamaitachi',
    abilities: {},
  },
};
