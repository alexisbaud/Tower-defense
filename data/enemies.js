// Définition des yokai (ennemis). Données pures.
//
//   hp        points de vie
//   speed     vitesse en cases par seconde
//   reward    or gagné à l'élimination
//   damage    vies retirées s'il atteint le sanctuaire
//   size      rayon visuel / de collision en cases
//   look      style de dessin utilisé par le moteur de rendu
//   abilities capacités optionnelles (voir README « Ajouter un ennemi ») :
//     armor: 0..1                       réduction des dégâts (la Terre perce)
//     flying: true                      vole en ligne droite vers le sanctuaire
//     split: { into, count }            se divise à la mort
//     absorb: 'fire'|'water'|'wind'|'earth'  soigné par cet élément (surchargable par vague)
//     healAura: { radius, amount, interval }  soigne les voisins (amount = part des PV max)
//     summon: { enemy, count, interval } invoque des yokai
//     cycleAbsorb: { elements, interval } change d'élément absorbé
//     stomp: { interval, radius, stun }  étourdit les lanternes proches
//     enrage: { below, speed }          accélère sous un seuil de PV
//   boss, knockResist (0..1), stunResist (0..1)
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
  kappa: {
    name: 'Kappa',
    desc: 'Carapace épaisse : réduit fortement les dégâts. La Terre la brise.',
    hp: 110,
    speed: 0.8,
    reward: 10,
    damage: 2,
    size: 0.32,
    look: 'kappa',
    abilities: { armor: 0.55 },
  },
  tengu: {
    name: 'Karasu-tengu',
    desc: 'Corbeau-démon qui vole droit vers le sanctuaire en ignorant le chemin.',
    hp: 55,
    speed: 1.2,
    reward: 9,
    damage: 1,
    size: 0.3,
    look: 'tengu',
    abilities: { flying: true },
  },
  nuppeppo: {
    name: 'Nuppeppō',
    desc: 'Masse de chair molle qui se divise en deux à sa mort.',
    hp: 95,
    speed: 0.8,
    reward: 6,
    damage: 2,
    size: 0.36,
    look: 'nuppeppo',
    abilities: { split: { into: 'nuppeppo_ko', count: 2 } },
  },
  nuppeppo_ko: {
    name: 'Petit nuppeppō',
    desc: 'Fragment rapide né de la division.',
    hp: 34,
    speed: 1.15,
    reward: 3,
    damage: 1,
    size: 0.24,
    look: 'nuppeppo',
    abilities: {},
  },
  kitsune: {
    name: 'Kitsune',
    desc: 'Renard-esprit qui absorbe un élément (aura colorée) : il en guérit au lieu d’en souffrir.',
    hp: 85,
    speed: 1.3,
    reward: 9,
    damage: 1,
    size: 0.3,
    look: 'kitsune',
    abilities: { absorb: 'fire' },
  },
  yukionna: {
    name: 'Yuki-onna',
    desc: 'Femme des neiges qui soigne régulièrement les yokai proches.',
    hp: 80,
    speed: 0.9,
    reward: 11,
    damage: 2,
    size: 0.32,
    look: 'yukionna',
    abilities: { healAura: { radius: 1.7, amount: 0.07, interval: 1.3 } },
  },
  akaoni: {
    name: 'Aka-oni',
    desc: 'Ogre rouge du Jardin de mousse. Son coup de massue étourdit les lanternes proches.',
    boss: true,
    hp: 1700,
    speed: 0.5,
    reward: 120,
    damage: 10,
    size: 0.55,
    look: 'akaoni',
    knockResist: 0.85,
    stunResist: 0.6,
    abilities: { armor: 0.3, stomp: { interval: 7, radius: 2.2, stun: 2.5 }, enrage: { below: 0.4, speed: 1.6 } },
  },
  gashadokuro: {
    name: 'Gashadokuro',
    desc: 'Squelette géant du Temple sous la neige. Invoque des kodama et change d’élément absorbé.',
    boss: true,
    hp: 5200,
    speed: 0.4,
    reward: 300,
    damage: 20,
    size: 0.7,
    look: 'gashadokuro',
    knockResist: 0.9,
    stunResist: 0.7,
    abilities: {
      summon: { enemy: 'kodama', count: 2, interval: 6 },
      cycleAbsorb: { elements: ['fire', 'water', 'wind', 'earth'], interval: 6 },
      enrage: { below: 0.5, speed: 1.5 },
    },
  },
};
