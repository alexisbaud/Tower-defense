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
//   stun         durée d'étourdissement infligée à l'impact (s)
export default {
  fire: {
    name: 'Lanterne du Feu',
    strength: 'Gros dégâts sur une cible, brûlure qui ignore l’armure.',
    weakness: 'Coups trop faibles contre les carapaces au niveau 1 ; soigne les kitsune de feu.',
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
    strength: 'Ralentit tout ce qu’elle touche ; zone dès le niveau 2.',
    weakness: 'Presque aucun dégât : ne tue rien seule.',
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
  wind: {
    name: 'Lanterne du Vent',
    strength: 'Repousse les yokai ; dégâts doublés contre les volants.',
    weakness: 'Faible au sol ; boss et yokai hors du temps résistent au recul.',
    kanji: '風',
    role: 'Recul',
    desc: 'Des bourrasques qui repoussent les yokai. Redoutable contre les volants.',
    cost: 55,
    color: '#5f8f6a',
    glow: '#d9f2d0',
    targets: { ground: true, air: true },
    projectile: 'gust',
    levels: [
      { range: 2.3, rate: 0.9, damage: 7, knockback: 0.5, airMultiplier: 2, projectileSpeed: 12 },
      { range: 2.6, rate: 1.1, damage: 15, knockback: 0.8, airMultiplier: 2, splash: 0.5, projectileSpeed: 13 },
      { range: 3.0, rate: 1.3, damage: 30, knockback: 1.1, airMultiplier: 2.2, splash: 0.8, projectileSpeed: 14 },
    ],
  },
  earth: {
    name: 'Lanterne de la Terre',
    strength: 'Dégâts de zone lourds, perce la moitié de l’armure.',
    weakness: 'Lente et incapable de toucher les volants.',
    kanji: '土',
    role: 'Zone',
    desc: 'Projette des rochers qui écrasent tout autour de l’impact et ignorent les carapaces. Ne touche pas les volants.',
    cost: 65,
    color: '#8a6a32',
    glow: '#f0c870',
    targets: { ground: true, air: false },
    projectile: 'boulder',
    levels: [
      { range: 2.2, rate: 0.55, damage: 24, splash: 0.85, pierce: 1, projectileSpeed: 5 },
      { range: 2.5, rate: 0.65, damage: 52, splash: 1.0, pierce: 1, projectileSpeed: 5.5 },
      { range: 2.8, rate: 0.75, damage: 110, splash: 1.2, pierce: 1, stun: 0.4, projectileSpeed: 6 },
    ],
  },
};
