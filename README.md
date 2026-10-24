# Jardin des Esprits 精霊の庭

Tower defense mobile au style estampe japonaise (ukiyo-e). Des yokai envahissent un jardin japonais ; posez des **lanternes-gardiennes** pour protéger le sanctuaire.

- Jouable dans Safari sur iPhone, installable sur l'écran d'accueil (PWA, hors ligne).
- 100 % JavaScript vanilla (ES modules), **sans étape de build** : GitHub Pages sert le dépôt tel quel.
- Tout est dessiné en Canvas 2D (aucune image externe) et tous les sons sont générés en Web Audio.

**Jouer :** https://alexisbaud.github.io/Tower-defense/

---

## Sommaire

1. [Le jeu](#le-jeu)
2. [Lancer en local](#lancer-en-local)
3. [Architecture](#architecture)
4. [Schéma d'un niveau](#schéma-dun-niveau)
5. [Ajouter un niveau](#ajouter-un-niveau)
6. [Ajouter une tour](#ajouter-une-tour)
7. [Ajouter un ennemi](#ajouter-un-ennemi)
8. [Ajouter un monde](#ajouter-un-monde)
9. [Ajouter un combo](#ajouter-un-combo)
10. [Outils de vérification](#outils-de-vérification)
11. [Déploiement](#déploiement)

---

## Le jeu

### Contrôles

| Geste | Action |
| --- | --- |
| Toucher une lanterne de la palette, puis un socle | Poser la lanterne (l'aperçu de portée s'affiche tant que le doigt est posé ; glissez pour ajuster) |
| Glisser une lanterne sur une lanterne identique | **Fusion** (même élément, même niveau → niveau supérieur, 3 niveaux) |
| Appui long sur une lanterne | Fiche d'information, **vente** |
| Outil Pierre, puis toucher le gravier | Poser une pierre (allonge le chemin) ; appui long / toucher une pierre pour la retirer |
| Glisser la jauge 巻 vers la gauche | **Rembobinage** (une fois par vague) |
| ×1 / ×2, ❙❙, 音 | Vitesse, pause, son |

### Lanternes

| | Élément | Rôle | Particularité |
| --- | --- | --- | --- |
| 火 | Feu | Dégâts | Braises + brûlure |
| 水 | Eau | Ralentissement | Gouttes glacées (zone dès le niveau 2) |
| 風 | Vent | Recul | Repousse les yokai le long de leur trajet ; ×2 contre les volants |
| 土 | Terre | Zone | Rochers en cloche, dégâts de zone, perce les carapaces, ne touche pas les volants |

### Combos élémentaires

Deux lanternes d'éléments différents **adjacentes** (y compris en diagonale) créent une zone de synergie, matérialisée par un lien d'encre et un sceau vermillon.

| | Feu | Eau | Vent | Terre |
| --- | --- | --- | --- | --- |
| **Feu** | — | 霧 Vapeur : aveugle (pouvoirs suspendus) et ralentit | 炎嵐 Tornade de flammes : tornade orbitale qui brûle tout, volants compris | 熔 Magma : fissures de lave qui brûlent au sol |
| **Eau** | | — | 氷 Givre : gèle périodiquement les yokai sur place | 泥 Boue : fort ralentissement au sol |
| **Vent** | | | — | 砂 Tempête de sable : brise les armures (+40 % de dégâts subis) |

La puissance d'un combo augmente avec le niveau moyen des deux lanternes.

### Rembobinage 巻戻

Une fois par vague, glissez la jauge vers la gauche : le temps recule de **6 secondes** (yokai, or, vies, pierres). Les lanternes posées (ou fusionnées) après cet instant disparaissent du présent — leur or est rendu — mais laissent un **écho fantôme** qui tire à **50 %** pendant **10 s**. Posez, rembobinez, reposez ailleurs : double défense. Introduit au niveau 3 avec un mini-tutoriel.

### Yokai

| Yokai | Comportement |
| --- | --- |
| Kodama | De base, lent |
| Kamaitachi | Rapide, fragile |
| Kappa | Blindé (carapace −55 % de dégâts, sauf Terre) |
| Karasu-tengu | Volant : ignore le chemin et les pierres |
| Nuppeppō | Se divise en deux à sa mort |
| Kitsune | Absorbe un élément (aura colorée) : il en guérit |
| Yuki-onna | Soigne ses voisins |
| **Aka-oni** (boss monde 1) | Blindé, sa massue étourdit les lanternes, enrage |
| **Gashadokuro** (boss monde 2) | Invoque des kodama, change d'élément absorbé, enrage |

### Progression

8 niveaux en 2 mondes (Jardin de mousse, Temple sous la neige). Étoiles selon les vies restantes (3★ ≥ 85 %, 2★ ≥ 50 %, sinon 1★). Un niveau se débloque quand le précédent est gagné. La progression est sauvegardée dans `localStorage`.

---

## Lancer en local

Les modules ES exigent un serveur HTTP (pas de `file://`) :

```bash
python3 -m http.server 8080
# puis http://localhost:8080
```

Raccourci de test : `http://localhost:8080/?level=2-4` lance directement un niveau.

---

## Architecture

```
index.html, styles.css      écrans (titre, carte, partie) et HUD en DOM
manifest.json, sw.js        PWA : installation et jeu hors ligne
icons/                      icônes PNG générées par tools/make-icons.mjs
data/                       ★ DONNÉES PURES (aucune logique)
  rules.js                  règles globales (vente, pierres, rembobinage, étoiles…)
  towers.js                 lanternes et leurs 3 niveaux
  enemies.js                yokai et capacités
  combos.js                 matrice des 6 combos
  worlds.js                 mondes, thèmes et ordre des niveaux
  levels/<id>.js            un fichier par niveau
src/
  main.js                   navigation, boucle à pas de temps fixe, liaison des modules
  data.js                   chargement des données (navigateur et Node)
  save.js                   sauvegarde localStorage
  core/                     MOTEUR — sans DOM, testable dans Node
    game.js                 état, commandes du joueur, simulation, rembobinage
    grid.js                 grille et légende des cases
    flowfield.js            champ de flux BFS (chemin en temps réel)
    combos.js               détection des paires et effets de zone
    rng.js                  aléatoire déterministe
  render/                   RENDU Canvas 2D (pinceau, papier washi, particules)
  ui/                       HUD, entrées tactiles, jauge de rembobinage, tutoriel, menus
  audio/sound.js            synthèse Web Audio (koto, taiko, cloche) + musique générative
tools/                      simulateur, bots, validateur, tests, QA navigateur
```

**Principes**

- Le moteur (`src/core`) ne connaît ni le DOM ni le Canvas. Il avance par pas fixes de 1/60 s (`game.update(STEP)`), et publie des **événements** (`spawn`, `shoot`, `hit`, `kill`, `fuse`, `combo`, `rewindStart`…) consommés par le rendu, l'audio et l'interface.
- Les **données** décrivent *quoi* (valeurs, capacités activées) ; le moteur sait *comment*. Ajouter du contenu ne demande pas de toucher au moteur tant qu'on réutilise les capacités existantes.
- Le chemin est un champ de flux BFS recalculé à chaque pierre ; une pierre qui couperait tout passage (pour une apparition ou un yokai déjà en route) est refusée avec un retour visuel et sonore.
- Le rembobinage enregistre un instantané de l'état toutes les 0,1 s pendant la vague.

---

## Schéma d'un niveau

Un niveau est un module ES qui exporte un objet par défaut : `data/levels/<id>.js`.

| Champ | Type | Obligatoire | Description |
| --- | --- | --- | --- |
| `id` | string | oui | Identique au nom du fichier (`'1-3'`) |
| `name` | string | oui | Nom affiché |
| `subtitle` | string | | Accroche affichée au lancement |
| `world` | string | oui | Id du monde (`'moss'`, `'snow'`…) : détermine le thème visuel |
| `map` | string[] | oui | Grille, une chaîne par ligne (9 colonnes × 13 lignes conseillées pour le portrait) |
| `startGold` | number | oui | Or de départ |
| `lives` | number | | Vies (défaut `rules.lives` = 20) |
| `towers` | string[] | | Lanternes disponibles (défaut : toutes) |
| `stones` | `{ cost, max }` | | Active les pierres sur les cases `o` (défaut : désactivées) |
| `rewind` | boolean | | Active le Rembobinage |
| `tutorial` | string[] | | Indices contextuels : `'place'`, `'wave'`, `'fuse'`, `'combo'`, `'stone'`, `'rewind'` |
| `introduce` | string[] | | Yokai présentés par une carte à leur première apparition |
| `waves` | Wave[] | oui | Liste des vagues (voir ci-dessous) |
| `hpScale` | number | | Multiplicateur global des PV |
| `wavePause` | number | | Secondes avant le lancement automatique de la vague suivante (défaut 14) |
| `rules` | object | | Surcharge ponctuelle de `data/rules.js` |

**Légende de la grille**

| Car. | Case | Marchable | Constructible |
| --- | --- | --- | --- |
| `.` | chemin (gravier ratissé) | ✓ | |
| `o` | **gravier ouvert** : le joueur peut y poser des pierres | ✓ | pierre |
| `#` | socle de lanterne | | lanterne |
| `S` | apparition des yokai (plusieurs possibles, indexées dans l'ordre de lecture) | ✓ | |
| `G` | sanctuaire (objectif) | ✓ | |
| `=` | pont | ✓ | |
| `,` `T` `~` `R` ` ` | herbe, arbre, eau, rocher, vide (décor) | | |

Les yokai terrestres suivent le plus court chemin (4 directions) sur les cases marchables ; les volants vont en ligne droite de leur `S` vers `G`.

**Vague** : `{ groups: Group[], reward?: number }` (`reward` = or en fin de vague, défaut `rules.waveReward`).

**Groupe** :

| Champ | Défaut | Description |
| --- | --- | --- |
| `enemy` | — | Id du yokai (`data/enemies.js`) |
| `count` | — | Nombre de yokai |
| `interval` | 1 | Secondes entre deux apparitions |
| `delay` | 0 | Secondes avant la première apparition |
| `spawn` | 0 | Index de la case `S` |
| `hp` | 1 | Multiplicateur de PV pour ce groupe |
| `absorb` | — | Élément absorbé (surcharge, ex. kitsune d'eau) |

---

## Ajouter un niveau

1. Créez `data/levels/1-5.js` :

```js
// Niveau 1-5 — exemple : double entrée et gravier central.
export default {
  id: '1-5',
  name: 'Les Deux Sentiers',
  subtitle: 'Deux portails, un seul sanctuaire',
  world: 'moss',
  map: [
    'TS,,,,,ST',
    ',.##,##.,',
    ',.#,,,#.,',
    ',...o...,',
    'T##ooo##T',
    ',,#ooo#,,',
    ',,,ooo,,,',
    ',##,.,##,',
    ',#,,.,,#,',
    ',~~,.,~~,',
    ',~~#.#~~,',
    'T,,#.#,,T',
    'T,,,G,,,T',
  ],
  startGold: 220,
  towers: ['fire', 'water', 'wind', 'earth'],
  stones: { cost: 10, max: 8 },
  rewind: true,
  introduce: [],
  waves: [
    { groups: [{ enemy: 'kodama', count: 8, interval: 1.2, spawn: 0 }, { enemy: 'kodama', count: 8, interval: 1.2, spawn: 1, delay: 0.6 }] },
    { groups: [{ enemy: 'kamaitachi', count: 10, interval: 0.8, spawn: 1 }, { enemy: 'kappa', count: 4, interval: 2, spawn: 0, delay: 3 }] },
    { groups: [{ enemy: 'tengu', count: 6, interval: 1.5 }, { enemy: 'kodama', count: 14, interval: 0.7, spawn: 1, hp: 1.4 }], reward: 0 },
  ],
};
```

2. Ajoutez son id à la liste `levels` du monde dans `data/worlds.js` :

```js
levels: ['1-1', '1-2', '1-3', '1-4', '1-5'],
```

C'est tout : la carte des niveaux, la sauvegarde, le service worker (qui découvre les niveaux dans `worlds.js`) et le moteur le prennent en compte automatiquement.

3. Vérifiez :

```bash
node tools/validate-levels.mjs                      # schéma, connexité S→G, ids valides
node tools/sim.mjs 1-5 --bots=smart,basic,lazy --seeds=1,2,3   # gagnable ? trop facile ?
```

---

## Ajouter une tour

Dans `data/towers.js`, ajoutez une entrée. Le dessin de la lanterne est générique (couleurs, kanji, 3 niveaux d'évolution) : aucun code de rendu n'est nécessaire.

```js
thunder: {
  name: 'Lanterne de la Foudre',
  kanji: '雷',
  role: 'Étourdissement',
  desc: 'Des éclairs qui paralysent brièvement leur cible.',
  cost: 70,
  color: '#6a4fa0',          // couleur principale
  glow: '#e6d8ff',           // lueur de la chambre de lumière
  targets: { ground: true, air: true },
  projectile: 'ember',       // visuel : 'ember' | 'droplet' | 'gust' | 'boulder' (cloche, zone au sol)
  levels: [
    { range: 2.4, rate: 0.8, damage: 12, stun: 0.3, projectileSpeed: 14 },
    { range: 2.7, rate: 1.0, damage: 26, stun: 0.45, projectileSpeed: 15 },
    { range: 3.0, rate: 1.2, damage: 55, stun: 0.6, splash: 0.7, projectileSpeed: 16 },
  ],
},
```

Effets disponibles par niveau : `damage`, `rate`, `range`, `projectileSpeed`, `burn {dps, duration}`, `slow {factor, duration}`, `knockback`, `splash`, `pierce` (0..1), `airMultiplier`, `stun`.

Rendez-la disponible dans un niveau via `towers: [..., 'thunder']`. Pour lui donner des combos, ajoutez des entrées dans `data/combos.js` (voir plus bas).

Rendu : une tour inconnue reçoit une lanterne générique teintée par `color` / `glow` et gravée de son `kanji`, avec ses trois évolutions. Le champ facultatif `look: 'fire' | 'water' | 'wind' | 'earth'` réutilise l'une des quatre silhouettes. Les impacts et traînées de projectile se déduisent aussi de `projectile` et des couleurs ; pour un visuel sur mesure, ajoutez un cas dans `drawProjectiles` (`src/render/renderer.js`) ou dans `Fx.impact` (`src/render/fx.js`).

---

## Ajouter un ennemi

Dans `data/enemies.js` :

```js
kasaobake: {
  name: 'Kasa-obake',
  desc: 'Parapluie hanté qui bondit vite et se divise.',
  hp: 60,
  speed: 1.6,
  reward: 7,
  damage: 1,
  size: 0.3,
  look: 'kamaitachi',        // réutilise un dessin existant…
  abilities: { split: { into: 'kodama', count: 2 } },
},
```

Capacités génériques (`abilities`) : `armor` (0..1), `flying`, `split {into, count}`, `absorb` (élément), `healAura {radius, amount, interval}`, `summon {enemy, count, interval}`, `cycleAbsorb {elements, interval}`, `stomp {interval, radius, stun}`, `enrage {below, speed}`. Champs optionnels : `boss: true` (barre de vie dédiée), `knockResist`, `stunResist` (0..1).

Pour un **nouveau dessin**, ajoutez une fonction au dictionnaire exporté `LOOKS` de `src/render/enemies.js` (repère local centré sur le yokai, `r` = rayon en pixels, `t` = temps) puis indiquez son nom dans `look`. Un `look` sans entrée dans `META` (même fichier) est dessiné en vectoriel à chaque frame ; y ajouter une entrée active le cache de sprites animés :

```js
LOOKS.kasaobake = (ctx, e, r, t) => {
  ctx.fillStyle = '#c8402a';
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.quadraticCurveTo(0, -r * 1.4, r, 0);
  ctx.closePath();
  ctx.fill();
};
```

---

## Ajouter un monde

Dans `data/worlds.js`, ajoutez un objet ; ses niveaux portent `world: '<id>'` :

```js
{
  id: 'autumn',
  name: 'Érablière d’automne',
  kanji: '紅葉',
  subtitle: 'Troisième monde',
  theme: {
    paper: '#f1e2c6', ground: '#dcc49a', grass: '#a0662e', grassDark: '#5e3418',
    path: '#efdcb4', water: '#3d5a7a', accent: '#c8402a',
    ambient: 'petals',      // 'petals' | 'snow'
    snowCaps: false,
    tree: 'pine',
  },
  levels: ['3-1', '3-2', '3-3', '3-4'],
},
```

La carte des niveaux ajoute automatiquement une bande pour ce monde.

---

## Ajouter un combo

Dans `data/combos.js`, une entrée par paire d'éléments :

```js
{
  id: 'storm', name: 'Orage', kanji: '嵐', elements: ['thunder', 'water'],
  desc: 'La pluie conduit la foudre : étourdissements réguliers.',
  color: '#b9a6ff', radius: 1.6,
  effect: { kind: 'pulse', interval: 3.5, damage: 20, status: { stun: 0.6 } },
}
```

Types d'effet : `aura` (statut appliqué en continu, `tick`), `pulse` (toutes les `interval` s : dégâts + statut), `tornado` (tornade orbitale : `interval`, `duration`, `dps`, `size`, `speed`, `knockback`). Statuts : `blind`, `slow`, `burn {dps, duration}`, `stun`, `shred {mult, duration}` ; `groundOnly` pour épargner les volants.

---

## Outils de vérification

Tous les outils tournent avec Node ≥ 18 (aucune dépendance npm ; Playwright pour les outils navigateur).

| Commande | Rôle |
| --- | --- |
| `node tools/test-core.mjs` | Tests du moteur : pierres et blocage, fusion, combos, capacités, rembobinage |
| `node tools/validate-levels.mjs` | Validation du schéma de tous les niveaux |
| `node tools/sim.mjs [ids] --bots=smart,basic,lazy --seeds=1,2,3` | Joue chaque niveau avec des bots (smart doit gagner partout) |
| `node tools/qa.mjs` | QA navigateur 390×844 : erreurs console + captures |
| `node tools/shot.mjs <id>` | Capture d'un niveau |
| `node tools/make-icons.mjs` | Régénère les icônes PNG depuis `src/render/icon.js` |

Les bots n'utilisent que l'API publique du moteur (`placeTower`, `fuse`, `placeStone`, `rewind`…).

Le moteur applique des **rendements décroissants** au recul et aux étourdissements (`knockFatigue*`, `stunFatigue*` dans `data/rules.js`) : un yokai ne peut jamais être bloqué indéfiniment, une vague finit toujours.

---

## Déploiement

Le dépôt est servi tel quel par **GitHub Pages** (workflow `.github/workflows/pages.yml` : à chaque push sur `main`, le contenu est publié). Le fichier `.nojekyll` désactive Jekyll.

Installation sur iPhone : ouvrir l'URL dans Safari → bouton Partager → **Add to Home Screen** (« Sur l'écran d'accueil »).
