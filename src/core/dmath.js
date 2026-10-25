// Mathématiques déterministes du moteur.
//
// En coopération, chaque téléphone calcule la même partie à partir des mêmes
// commandes : il faut que chaque calcul donne exactement le même nombre sur tous
// les navigateurs. Les opérations IEEE de base (+ − × ÷ et Math.sqrt) le
// garantissent ; Math.hypot, Math.sin, Math.cos… non (leur précision dépend du
// moteur JavaScript). src/core n'utilise donc que les fonctions ci-dessous.

const PI = 3.141592653589793;
const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

// Longueur d'un vecteur (remplace Math.hypot à deux arguments).
export function hyp(x, y) {
  return Math.sqrt(x * x + y * y);
}

// Sinus : réduction à [−π, π[, symétrie vers [−π/2, π/2], puis série de Taylor
// jusqu'à x¹⁵ (erreur < 1e-10). Les coefficients sont des constantes calculées une
// fois à l'identique partout.
const S3 = -1 / 6;
const S5 = 1 / 120;
const S7 = -1 / 5040;
const S9 = 1 / 362880;
const S11 = -1 / 39916800;
const S13 = 1 / 6227020800;
const S15 = -1 / 1307674368000;

export function dsin(x) {
  x -= TAU * Math.floor((x + PI) / TAU);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return x * (1 + x2 * (S3 + x2 * (S5 + x2 * (S7 + x2 * (S9 + x2 * (S11 + x2 * (S13 + x2 * S15)))))));
}

export function dcos(x) {
  return dsin(x + HALF_PI);
}

// Empreinte FNV-1a 32 bits d'une suite d'entiers (contrôle de synchronisation).
export function fnv(values) {
  let h = 0x811c9dc5;
  for (const v of values) {
    let n = v | 0;
    for (let k = 0; k < 4; k++) {
      h ^= n & 255;
      h = Math.imul(h, 0x01000193);
      n >>>= 8;
    }
  }
  return h >>> 0;
}
