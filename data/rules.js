// Règles globales du jeu — uniquement des valeurs, aucune logique.
// Le moteur lit ces paramètres ; un niveau peut surcharger certains d'entre eux
// (voir le schéma de niveau dans README.md).
export default {
  lives: 20,              // vies par défaut d'un niveau
  sellRatio: 0.7,         // part de l'or investi rendue à la vente
  wavePause: 14,          // secondes avant le lancement automatique de la vague suivante
  earlyBonusPerSecond: 1, // or gagné par seconde d'avance quand on appelle une vague plus tôt
  // Les vagues s'enchaînent : la suivante part `pause` secondes après la fin des
  // apparitions de la précédente, même si des yokai sont encore en route. On peut
  // l'appeler plus tôt (bonus d'or et charge de Rembobinage).
  // Économie : les primes des yokai (data/enemies.js) restent modestes et la fin de
  // vague paie davantage, pour que l'or ne fasse pas boule de neige en fin de niveau ;
  // l'or de départ des niveaux, plus généreux, permet une vraie première défense.
  waveReward: 25,         // or par défaut à la fin d'une vague
  maxTowerLevel: 3,
  // Délai de construction (s) : une lanterne, une pierre ou un mur posé apparaît
  // « en construction » et ne s'active qu'après ce délai (en coopération, il laisse
  // à la commande le temps de parvenir à tous les joueurs).
  buildTime: 2,
  // Pierres (chemin modifiable) — un niveau peut surcharger via `stones: { cost, max }`
  stoneCost: 10,
  stoneMax: 10,
  stoneRefund: 0.5,
  // Combos : bonus de puissance par niveau au-delà de 1, calculé sur la lanterne la
  // plus faible de la paire (fusionner une seule lanterne ne renforce pas le combo).
  comboLevelBonus: 0.4,
  echoComboPower: 0.6,    // un combo qui implique un écho agit à 60 %
  // Armure : au moins cette part de chaque coup passe, quelle que soit l'armure.
  armorMinDamage: 0.2,
  // Rendements décroissants : chaque recul / étourdissement subi augmente une
  // « fatigue » qui réduit les suivants, puis retombe avec le temps. À l'équilibre,
  // le recul moyen subi vaut decay / gain (0,08 case/s) et la part du temps passée
  // étourdi vaut decay / gain (≈ 23 %). Avec le plancher de ralentissement, même le
  // yokai le plus lent (0,4 case/s) avance donc toujours : 0,4 × 0,35 × 0,77 > 0,08.
  // Une vague finit toujours.
  knockFatigueGain: 2.5,
  knockFatigueDecay: 0.2,
  stunFatigueGain: 1.5,
  stunFatigueDecay: 0.35,
  minSlowFactor: 0.35,    // aucun ralentissement ne descend sous 35 % de la vitesse
  // Rembobinage (niveaux avec `rewind: true`) : une jauge qui se remplit en
  // éliminant des yokai et en appelant les vagues en avance ; pleine, elle permet
  // de remonter le temps de 6 s (autant de fois qu'on la remplit).
  rewindSeconds: 6,
  rewindCost: 100,        // charge consommée par un rembobinage (= jauge pleine)
  rewindPerGold: 1.5,     // charge gagnée par pièce d'or de récompense d'un yokai
  rewindPerEarlySecond: 3,// charge gagnée par seconde d'avance à l'appel d'une vague
  lastChanceSeconds: 4,   // fuite fatale avec la jauge pleine : délai pour rembobiner
  echoSeconds: 10,        // durée de vie des échos fantômes
  echoPower: 0.5,         // puissance des échos
  snapshotInterval: 0.1,  // fréquence des instantanés (s)
  rewindAnimDuration: 1.1,
  // Seuils d'étoiles (ratio de vies restantes) : >= stars3 -> 3★, >= stars2 -> 2★, sinon 1★
  stars3: 0.85,
  stars2: 0.5,
  // Coopération (1 à 4 joueurs) : facteurs selon le nombre de joueurs.
  // Chaque joueur a sa bourse ; les vies du sanctuaire sont communes. L'or de départ
  // par joueur laisse chacun poser au moins une lanterne de son élément dès le début
  // (la Terre coûte 65) ; les PV montent moins vite que l'or total, car chaque joueur
  // n'utilise que les socles de son élément et les socles universels.
  coop: {
    startGold: [1, 0.65, 0.55, 0.5], // part de l'or de départ du niveau, par joueur
    reward: [1, 0.6, 0.45, 0.38], // part de chaque récompense, versée à chaque joueur
    hp: [1, 1.2, 1.4, 1.6], // multiplicateur des PV des yokai
  },
};
