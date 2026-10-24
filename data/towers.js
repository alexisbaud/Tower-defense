// Définition des lanternes-gardiennes (tours).
// Données pures : le moteur interprète chaque clé (voir README « Ajouter une tour »).
//
// Clés d'un niveau de tour :
//   range        portée en cases
//   rate         tirs par seconde
//   damage       dégâts par impact
//   projectileSpeed  vitesse du projectile (cases/s)
//   burn   { dps, duration }    brûlure (dégâts sur la durée)
//   slow   { factor, duration } ralentissement (factor = multiplicateur de vitesse)
//   knockback    recul en cases
//   splash       rayon de dégâts de zone en cases
//   pierce       0..1, part de l'armure ignorée
//   airMultiplier multiplicateur de dégâts contre les volants
export default {
  fire: {
    name: 'Lanterne du Feu',
    kanji: '火',
    role: 'Dégâts',
    desc: 'Projette des braises qui brûlent leur cible.',
    cost: 50,
    color: '#c8402a',
    glow: '#ffb35c',
    targets: { ground: true, air: true },
    projectile: 'ember',
    levels: [
      { range: 2.3, rate: 1.1, damage: 14, burn: { dps: 5, duration: 2 }, projectileSpeed: 9 },
      { range: 2.6, rate: 1.4, damage: 30, burn: { dps: 10, duration: 2.5 }, projectileSpeed: 10 },
      { range: 3.0, rate: 1.8, damage: 62, burn: { dps: 20, duration: 3 }, projectileSpeed: 11 },
    ],
  },
  water: {
    name: "Lanterne de l'Eau",
    kanji: '水',
    role: 'Ralentissement',
    desc: 'Des gouttes glacées qui ralentissent les yokai.',
    cost: 45,
    color: '#2f5f8f',
    glow: '#9fd4ff',
    targets: { ground: true, air: true },
    projectile: 'droplet',
    levels: [
      { range: 2.2, rate: 1.0, damage: 6, slow: { factor: 0.6, duration: 1.4 }, projectileSpeed: 8 },
      { range: 2.5, rate: 1.2, damage: 13, slow: { factor: 0.5, duration: 1.8 }, splash: 0.6, projectileSpeed: 9 },
      { range: 2.9, rate: 1.5, damage: 24, slow: { factor: 0.4, duration: 2.2 }, splash: 0.9, projectileSpeed: 10 },
    ],
  },
};
