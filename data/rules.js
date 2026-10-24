// Règles globales du jeu — uniquement des valeurs, aucune logique.
// Le moteur lit ces paramètres ; un niveau peut surcharger certains d'entre eux
// (voir le schéma de niveau dans README.md).
export default {
  lives: 20,              // vies par défaut d'un niveau
  sellRatio: 0.7,         // part de l'or investi rendue à la vente
  wavePause: 14,          // secondes avant le lancement automatique de la vague suivante
  earlyBonusPerSecond: 1, // or gagné par seconde d'avance quand on appelle une vague plus tôt
  waveReward: 15,         // or par défaut à la fin d'une vague
  maxTowerLevel: 3,
  // Pierres (chemin modifiable) — un niveau peut surcharger via `stones: { cost, max }`
  stoneCost: 10,
  stoneMax: 10,
  stoneRefund: 0.5,
  // Combos : bonus de puissance par niveau moyen au-delà de 1
  comboLevelBonus: 0.4,
  // Seuils d'étoiles (ratio de vies restantes) : >= stars3 -> 3★, >= stars2 -> 2★, sinon 1★
  stars3: 0.85,
  stars2: 0.5,
};
