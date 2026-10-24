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

### Seul ou à plusieurs (1 à 4)

Aucun compte. À l'ouverture du jeu, **votre salon est créé automatiquement** : son code de 4 lettres s'affiche sur l'écran d'accueil.

- **Jouer seul** : touchez « Jouer », choisissez un niveau. Seul, vous contrôlez les quatre éléments.
- **Inviter** : touchez « Inviter » (partage du lien `…/?salon=CODE`) ou dictez le code. Jusqu'à 4 joueurs.
- **Rejoindre** : « Rejoindre un salon », saisissez le code (ou ouvrez le lien reçu).
- **Choisir son élément** : chaque joueur prend un élément (un seul joueur par élément). Les éléments que personne n'a choisis sont **partagés** par tous.
- **Coopération** : l'hôte choisit le niveau et lance la partie pour tout le salon. Chacun a **sa bourse d'or** et bâtit les lanternes de ses éléments ; les **vies du sanctuaire sont communes**. Seuls les joueurs de la Terre posent des pierres. Les yokai ont plus de PV à plusieurs (×1,2 à ×1,6).

Le réseau passe par un relais MQTT public et gratuit (EMQX, puis HiveMQ, puis Mosquitto en secours) : l'hôte fait tourner la partie et diffuse son état 8 fois par seconde ; les invités envoient leurs commandes. Sans réseau, le salon reste « hors ligne » et le jeu solo fonctionne normalement.

### Contrôles

| Geste | Action |
| --- | --- |
| Choisir une lanterne dans la palette (par élément), puis toucher ou glisser vers un socle | Poser : la lanterne fantôme flotte 60 px au-dessus du doigt, la pose se valide **au relâchement** ; liens et nom des combos en direct |
| « ↶ Annuler » (3 s) | Annuler la dernière pose, or rendu en entier |
| Toucher une lanterne | Barre d'actions : **priorité de ciblage** (Premier → Dernier → Plus fort → Plus proche), fiche, vente (confirmée) ; Gardien de pierre : déplacer le mur |
| Glisser une lanterne sur une lanterne identique | **Fusion** (même type, même niveau → niveau supérieur, 3 niveaux) ; l'aperçu montre les combos perdus et conservés |
| Appui long sur une lanterne, un yokai ou un bouton de la palette | Fiche : statistiques, forces, faiblesses, contres |
| Outil Pierre, glisser sur le gravier | Le nouveau chemin s'affiche en pointillés avec « +X cases » ; une pierre qui fermerait le passage est refusée |
| Bouton de vague | Aperçu de la vague suivante ; **appel anticipé** à tout moment : or et charge de Rembobinage |
| Glisser la jauge 巻 vers la gauche (jauge pleine) | **Rembobinage** |
| ×1 / ×2, ❙❙ | Vitesse, pause (le plateau reste visible ; table des combos) |
| 5 touchers rapides sur le titre | Panneau de débogage (or infini, choix de la vague, vitesse ×4…) |

### Éléments et lanternes

Chaque élément a son style de jeu et se reconnaît à sa **forme** autant qu'à sa couleur (▲ Feu, goutte Eau, ◆ Vent, ■ Terre). Trois lanternes par élément, chacune avec une force et une faiblesse nettes ; aucune ne gagne seule. Certains socles sont **gravés** d'un élément et n'acceptent que ses lanternes ; les socles lisses sont universels.

| | Lanterne | Rôle | Force | Faiblesse |
| --- | --- | --- | --- | --- |
| 火 | Brasero | Dégâts | Gros dégâts sur une cible ; la brûlure ignore l'armure | Petits coups au N1 ; soigne les kitsune de feu |
| 砲 | Mortier hanabi | Zone à longue portée | Très longue portée, perce la moitié de l'armure | Lent, rate les rapides, pas de volants |
| 燐 | Feux follets | Aura brûlante | Brûle tout autour, carapaces comprises | Portée très courte |
| 水 | Fontaine glacée | Ralentissement | Ralentit tout ce qu'elle touche | Presque aucun dégât |
| 泉 | Source sacrée | Soin des barrières | Barrières presque indestructibles ; dissipe les étourdissements | N'attaque pas |
| 瀑 | Torrent | Jet perçant | Touche toute une file et ralentit | Faible contre un yokai isolé |
| 風 | Bourrasque | Recul | Repousse ; ×2 contre les volants | Faible au sol |
| 鈴 | Carillon fūrin | Soutien | Accélère les lanternes proches | N'attaque pas |
| 弓 | Arc-tempête | Antiaérien | Abat les volants de loin, perce l'armure | Cadence lente |
| 土 | Catapulte de roc | Zone | Dégâts de zone lourds, perce l'armure | Lente, pas de volants |
| 壁 | Gardien de pierre | Barrière | Arrête les yokai au sol et les regroupe | Volants et kasa-obake passent ; l'ushi-oni la fracasse |
| 震 | Tambour du séisme | Contrôle | Étourdit un groupe et brise les armures | Impulsions espacées ; pas de volants |

**Armure partielle** : l'armure d'un yokai est retranchée de chaque coup (au moins 20 % du coup passe) ; Mortier, Arc et Catapulte en ignorent la moitié, brûlures et auras l'ignorent, le Séisme et la Tempête de sable la brisent.

### Combos élémentaires

Deux lanternes d'éléments différents **adjacentes** (diagonale comprise) créent une zone de synergie ; chaque combo répond à un type de yokai. Les échos du Rembobinage comptent (à 60 %). La puissance suit le niveau de la lanterne la **plus faible** de la paire.

| | Feu | Eau | Vent | Terre |
| --- | --- | --- | --- | --- |
| **Feu** | — | 霧 Vapeur : aveugle (pouvoirs, soins, sauts suspendus) — kitsune, yuki-onna, kasa-obake | 炎嵐 Tornade de flammes : brûle tout, volants compris — tengu | 熔 Magma : lave au sol — nuppeppō, kappa |
| **Eau** | | — | 氷 Givre : gèle sur place, même hors du temps — tokihami, ushi-oni | 泥 Boue : enlise au sol — kamaitachi |
| **Vent** | | | — | 砂 Tempête de sable : armure annulée, +25 % de dégâts — kappa, aka-oni |

### Rembobinage 巻戻

Une **jauge** se remplit en éliminant des yokai et en appelant les vagues en avance. Pleine, glissez-la vers la gauche : le temps recule de **6 secondes** (yokai, or, vies, pierres). Les lanternes posées après cet instant disparaissent du présent (**or rendu à 100 %**) et laissent un **écho** qui tire à 50 % pendant 10 s et compte pour les combos. Une fuite fatale avec la jauge pleine ouvre une **dernière chance** de 4 s pour rembobiner. Les **tokihami**, hors du temps, ne reculent pas et les vies qu'ils prennent ne reviennent pas.

### Yokai

Chaque yokai contre une stratégie et a au moins deux réponses (voir [BALANCE.md](BALANCE.md)).

| Yokai | Force | Faiblesse |
| --- | --- | --- |
| Kodama | Nombreux | Fragile |
| Kamaitachi | Très rapide ; résiste au Vent | S'arrête devant une barrière ; ralentissements |
| Kappa | Armure 10 ; résiste à l'Eau | Perce-armure, brûlures, Séisme |
| Karasu-tengu | Vole : ignore chemin, pierres, barrières, Terre | Vent (Arc, Bourrasque), Tornade de flammes |
| Nuppeppō | Se divise à sa mort | Dégâts de zone |
| Kitsune | Absorbe un élément | Un autre élément, ou la Vapeur |
| Yuki-onna | Soigne ses voisins ; insensible à l'Eau | Priorité « plus fort », Feu, Vapeur |
| Ushi-oni | Fracasse les barrières ; armure 6 | Étourdissements, ralentissements |
| Kasa-obake | Saute par-dessus les barrières | Vapeur (plus de saut), tirs directs |
| Tokihami | Hors du temps : ni rembobinage ni recul | Givre, Séisme, ralentissements |
| **Aka-oni** (boss) | Armure 15, massue qui étourdit les lanternes | Brise-armure ; Source sacrée contre l'étourdissement |
| **Gashadokuro** (boss) | Invoque, change d'élément absorbé | Plusieurs éléments, Vapeur |

### Progression

8 niveaux en 2 mondes ; **chaque niveau enseigne une notion** :

| Niveau | Leçon |
| --- | --- |
| 1-1 Le Seuil | Poser et lancer, appeler une vague en avance |
| 1-2 Le Jardin des renards | Combos |
| 1-3 L'Étang du temps | Rembobinage |
| 1-4 La Clairière de l'Oni | Pierres et barrières (boss : Aka-oni) |
| 2-1 Les Terrasses gelées | Répit : priorités de ciblage, toutes les lanternes |
| 2-2 Les Deux Portes | Deux chemins |
| 2-3 Le Ciel de fer | Volants et blindés |
| 2-4 Le Dernier Torii | Boss final : Gashadokuro |

Chaque niveau compte 11 à 14 vagues en **dents de scie** (montées, vague de répit, nouveau pic) et se termine par une **vague climax annoncée**, la plus dure. Étoiles selon les vies restantes (3★ ≥ 85 %, 2★ ≥ 50 %). Après 3★, le mode **Difficile** se débloque. Chaque niveau propose un **défi** optionnel (« Sans Vent », « Dix lanternes », « Sans rembobinage »…). La progression est sauvegardée dans `localStorage`.

---

## Lancer en local

Les modules ES exigent un serveur HTTP (pas de `file://`) :

```bash
python3 -m http.server 8080
# puis http://localhost:8080
```

Raccourcis de test : `?level=2-4` lance directement un niveau ; `?salon=ABCD` rejoint un salon ; `?broker=ws://localhost:8883/mqtt` remplace les relais publics (tests du multijoueur hors ligne).

Relais MQTT local pour tester le multijoueur sans Internet (facultatif) :

```bash
mkdir -p /tmp/relais && cd /tmp/relais && npm i aedes aedes-server-factory
node -e "const a=require('aedes')();require('aedes-server-factory').createServer(a,{ws:true}).listen(8883)"
```

---

## Architecture

```
index.html, styles.css      écrans (titre, carte, partie) et HUD en DOM
manifest.json, sw.js        PWA : installation et jeu hors ligne
icons/                      icônes PNG générées par tools/make-icons.mjs
lobby.css                   salon multijoueur de l'écran d'accueil
data/                       ★ DONNÉES PURES (aucune logique)
  rules.js                  règles globales (vente, pierres, rembobinage, étoiles, coopération…)
  elements.js               les quatre éléments (nom, kanji, forme, couleur, style)
  towers.js                 12 lanternes (3 par élément) et leurs 3 niveaux
  enemies.js                yokai et capacités
  combos.js                 matrice des 6 combos
  worlds.js                 mondes, thèmes et ordre des niveaux
  levels/<id>.js            un fichier par niveau
src/
  main.js                   navigation, boucle à pas de temps fixe, liaison des modules
  data.js                   chargement des données (navigateur et Node)
  save.js                   sauvegarde localStorage
  core/                     MOTEUR — sans DOM, testable dans Node
    game.js                 état, joueurs, commandes, simulation, barrières, rembobinage
    grid.js                 grille et légende des cases
    flowfield.js            champ de flux BFS (chemin en temps réel)
    combos.js               détection des paires et effets de zone
    rng.js                  aléatoire déterministe
  render/                   RENDU Canvas 2D (pinceau, papier washi, particules)
  ui/                       HUD, entrées tactiles, palette, fiches, salon, jauge, tutoriel, menus
  net/                      MULTIJOUEUR
    mqtt.js                 client MQTT 3.1.1 minimal sur WebSocket (sans dépendance)
    lobby.js                salons par code : hôte, invités, choix d'élément
    sync.js                 états compacts hôte → invités, commandes invités → hôte, miroir
    coop.js                 lien entre salon, partie et boucle principale
  audio/sound.js            synthèse Web Audio (koto, taiko, cloche) + musique générative
tools/                      simulateur, bots, validateur, tests, QA navigateur
```

**Principes**

- Le moteur (`src/core`) ne connaît ni le DOM ni le Canvas. Il avance par pas fixes de 1/60 s (`game.update(STEP)`), et publie des **événements** (`spawn`, `shoot`, `hit`, `kill`, `fuse`, `combo`, `rewindStart`…) consommés par le rendu, l'audio et l'interface.
- Les **données** décrivent *quoi* (valeurs, capacités activées) ; le moteur sait *comment*. Ajouter du contenu ne demande pas de toucher au moteur tant qu'on réutilise les capacités existantes.
- Le chemin est un champ de flux BFS recalculé à chaque pierre ; une pierre qui couperait tout passage (pour une apparition ou un yokai déjà en route) est refusée avec un retour visuel et sonore.
- Le rembobinage enregistre un instantané de l'état toutes les 0,1 s pendant la partie ; chaque yokai a une identité stable (`uid`) pour que rejouer les mêmes éliminations ne recharge pas la jauge deux fois.
- **Multijoueur hôte-autoritaire** : seul l'hôte simule. Les invités tiennent un *miroir* (une instance de `Game` qui ne simule rien) mis à jour par les états reçus et interpolé à l'affichage ; leurs commandes (`placeTower`, `fuse`…) partent vers l'hôte, qui les valide avec l'identifiant du joueur. On ne simule pas chez chacun : les fonctions mathématiques diffèrent légèrement entre Safari et Chrome et les parties divergeraient.

---

## Schéma d'un niveau

Un niveau est un module ES qui exporte un objet par défaut : `data/levels/<id>.js`.

| Champ | Type | Obligatoire | Description |
| --- | --- | --- | --- |
| `id` | string | oui | Identique au nom du fichier (`'1-3'`) |
| `name` | string | oui | Nom affiché |
| `subtitle` | string | | Accroche affichée au lancement |
| `concept` | string | | La leçon du niveau, en quelques mots (carte des niveaux) |
| `world` | string | oui | Id du monde (`'moss'`, `'snow'`…) : détermine le thème visuel |
| `map` | string[] | oui | Grille, une chaîne par ligne (9 colonnes × 13 lignes conseillées pour le portrait) |
| `startGold` | number | oui | Or de départ |
| `lives` | number | | Vies (défaut `rules.lives` = 20) |
| `towers` | string[] | | Lanternes disponibles (défaut : toutes) ; au moins une lanterne d'attaque par élément (coopération) |
| `stones` | `{ cost, max }` | | Active les pierres sur les cases `o` (défaut : désactivées) |
| `rewind` | boolean | | Active le Rembobinage |
| `rewindStart` | number | | Charge initiale de la jauge (0 à 100) |
| `tutorial` | string[] | | Indices contextuels : `'place'`, `'wave'`, `'early'`, `'fuse'`, `'combo'`, `'stone'`, `'rewind'`, `'barrier'`, `'priority'` |
| `introduce` | string[] | | Yokai présentés par une carte à leur première apparition |
| `waves` | Wave[] | oui | Liste des vagues (voir ci-dessous) |
| `hpScale` | number | | Multiplicateur global des PV |
| `wavePause` | number | | Secondes avant le lancement automatique de la vague suivante (défaut 14) |
| `rules` | object | | Surcharge ponctuelle de `data/rules.js` |
| `hard` | `{ hpScale, startGold, lives, rules }` | | Mode Difficile (débloqué après 3★) : multiplicateur de PV, écarts d'or et de vies |
| `challenge` | `{ name, desc, rule }` | | Défi optionnel ; `rule` : `forbidTowers: [...]`, `maxTowers` (poses totales), `noStones`, `noRewind`, `noLeak`, `minLives` |

**Légende de la grille**

| Car. | Case | Marchable | Constructible |
| --- | --- | --- | --- |
| `.` | chemin (gravier ratissé) | ✓ | |
| `o` | **gravier ouvert** : le joueur peut y poser des pierres | ✓ | pierre |
| `#` | socle de lanterne universel | | lanterne |
| `1` `2` `3` `4` | socle gravé : Feu, Eau, Vent, Terre | | lanterne de cet élément |
| `S` | apparition des yokai (plusieurs possibles, indexées dans l'ordre de lecture) | ✓ | |
| `G` | sanctuaire (objectif) | ✓ | |
| `=` | pont | ✓ | |
| `,` `T` `~` `R` ` ` | herbe, arbre, eau, rocher, vide (décor) | | |

Les yokai terrestres suivent le plus court chemin (4 directions) sur les cases marchables ; les volants vont en ligne droite de leur `S` vers `G`.

**Vague** : `{ groups: Group[], reward?, pause?, climax?, name? }`. `reward` = or en fin de vague (défaut `rules.waveReward`) ; `pause` = secondes entre la fin des apparitions et la vague suivante (les vagues se chevauchent) ; `climax: true` + `name` = vague finale annoncée (une par niveau).

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
// Niveau 1-5 — exemple : double entrée, gravier central, socles gravés.
export default {
  id: '1-5',
  name: 'Les Deux Sentiers',
  subtitle: 'Deux portails, un seul sanctuaire',
  concept: 'Deux entrées',
  world: 'moss',
  map: [
    'TS,,,,,ST',
    ',.13,24.,',
    ',.#,,,#.,',
    ',...o...,',
    'T##ooo##T',
    ',,#ooo#,,',
    ',,,ooo,,,',
    ',3#,.,#4,',
    ',#,,.,,#,',
    ',~~,.,~~,',
    ',~~1.2~~,',
    'T,,#.#,,T',
    'T,,,G,,,T',
  ],
  startGold: 220,
  towers: ['fire', 'water', 'wind', 'earth', 'earth_guard'],
  stones: { cost: 10, max: 8 },
  rewind: true,
  introduce: ['tengu'],
  hard: { hpScale: 1.3, startGold: -20, lives: -5 },
  challenge: { name: 'Sans Feu', desc: 'Gagner sans lanterne de Feu.', rule: { forbidTowers: ['fire'] } },
  waves: [
    { groups: [{ enemy: 'kodama', count: 8, interval: 1.2, spawn: 0 }, { enemy: 'kodama', count: 8, interval: 1.2, spawn: 1, delay: 0.6 }] },
    { groups: [{ enemy: 'kamaitachi', count: 10, interval: 0.8, spawn: 1 }, { enemy: 'kappa', count: 4, interval: 2, spawn: 0, delay: 3 }] },
    // … 10 à 15 vagues en dents de scie …
    { climax: true, name: 'Le Vol des corbeaux', groups: [{ enemy: 'tengu', count: 6, interval: 1.5 }, { enemy: 'kodama', count: 14, interval: 0.7, spawn: 1, hp: 1.4 }], reward: 0 },
  ],
};
```

2. Ajoutez son id à la liste `levels` du monde dans `data/worlds.js` :

```js
levels: ['1-1', '1-2', '1-3', '1-4', '1-5'],
```

C'est tout : la carte des niveaux, la sauvegarde, le service worker (qui découvre les niveaux dans `worlds.js`, y compris chez un joueur qui a déjà installé le jeu : le niveau est mis en cache au prochain lancement en ligne) et le moteur le prennent en compte automatiquement.

3. Vérifiez :

```bash
node tools/validate-levels.mjs                      # schéma, connexité S→G, ids valides
node tools/sim.mjs 1-5 --check                      # gagnable, sans lanterne unique gagnante, courbe saine
```

---

## Ajouter une tour

Dans `data/towers.js`, ajoutez une entrée. Le dessin est générique (couleurs, kanji, 3 évolutions) ; `look` réutilise la silhouette d'un élément et `variant` l'une de ses variantes.

```js
fire_thunder: {
  element: 'fire',           // famille : socles gravés, joueur qui la contrôle en coopération
  name: 'Lanterne de la Foudre',
  kanji: '雷',
  look: 'fire',
  role: 'Étourdissement',
  desc: 'Des éclairs qui paralysent brièvement leur cible.',
  strength: 'Étourdit les yokai rapides.',
  weakness: 'Dégâts faibles contre les carapaces.',
  cost: 70,
  color: '#6a4fa0',
  glow: '#e6d8ff',
  targets: { ground: true, air: true },
  attack: 'projectile',      // projectile | lob | aura | pulse | beam | support | barrier
  projectile: 'ember',       // 'ember' | 'droplet' | 'gust' | 'boulder' | 'arrow'
  priority: 'first',         // priorité de ciblage par défaut : first | last | strong | close
  levels: [
    { range: 2.4, rate: 0.8, damage: 12, stun: 0.3, projectileSpeed: 14 },
    { range: 2.7, rate: 1.0, damage: 26, stun: 0.45, projectileSpeed: 15 },
    { range: 3.0, rate: 1.2, damage: 55, stun: 0.6, splash: 0.7, projectileSpeed: 16 },
  ],
},
```

Valeurs par niveau : `damage`, `rate`, `range`, `projectileSpeed`, `burn {dps, duration}`, `slow {factor, duration}`, `knockback`, `splash`, `pierce` (part de l'armure ignorée, 0..1), `airMultiplier`, `stun`, `armorBreak` (s), `auraDps` (aura), `width` (jet), `heal` et `cleanse` (Source), `rateBonus` (Carillon), `barrierHp`, `respawn`, `thorns` (Gardien).

Rendez-la disponible via `towers: [..., 'fire_thunder']` dans un niveau, puis vérifiez avec `node tools/sim.mjs --check` qu'elle ne gagne pas seule.

---

## Ajouter un ennemi

Dans `data/enemies.js` :

```js
hitodama: {
  name: 'Hitodama',
  desc: 'Flamme errante qui file en zigzag.',
  strength: 'Rapide ; absorbe le Feu.',
  weakness: 'Fragile ; la Vapeur l’aveugle.',
  counters: 'Eau, Vent, Vapeur',
  hp: 60,
  speed: 1.5,
  reward: 4,
  damage: 1,
  attack: 6,                 // dégâts par seconde contre une barrière
  armor: 0,                  // armure plate, retranchée de chaque coup
  resist: { wind: 0.3 },     // résistance (0,5 = −50 %) ou faiblesse (−0,3 = +30 %)
  size: 0.28,
  look: 'kitsune',           // réutilise un dessin existant…
  abilities: { absorb: 'fire' },
},
```

Capacités (`abilities`) : `flying`, `split {into, count}`, `absorb` (élément), `healAura {radius, amount, interval}`, `summon {enemy, count, interval}`, `cycleAbsorb {elements, interval}`, `stomp {interval, radius, stun}`, `enrage {below, speed}`, `hop {interval}` (saute les barrières), `timeless` (ni rembobinage ni recul). Champs optionnels : `boss: true` (barre de vie dédiée), `knockResist`, `stunResist` (0..1).

Pour un **nouveau dessin**, ajoutez une fonction au dictionnaire exporté `LOOKS` de `src/render/enemies.js` (repère local centré sur le yokai, `r` = rayon en pixels, `t` = temps) puis indiquez son nom dans `look`.

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
  id: 'storm', name: 'Orage', kanji: '嵐', elements: ['fire', 'water'],   // une paire d'éléments de data/elements.js
  counters: ['kamaitachi'],
  desc: 'La pluie conduit la foudre : étourdissements réguliers.',
  color: '#b9a6ff', radius: 1.6,
  effect: { kind: 'pulse', interval: 3.5, damage: 20, status: { stun: 0.6 } },
}
```

Types d'effet : `aura` (statut appliqué en continu, `tick`), `pulse` (toutes les `interval` s : dégâts typés par `element` + statut), `tornado` (tornade orbitale : `interval`, `duration`, `dps`, `size`, `speed`, `knockback`). Statuts : `blind`, `slow`, `burn {dps, duration}`, `stun`, `shred {mult, duration}`, `armorBreak` (s) ; `groundOnly` pour épargner les volants. `counters` liste les yokai auxquels le combo répond (fiches et table des combos).

---

## Outils de vérification

Tous les outils tournent avec Node ≥ 22 (aucune dépendance npm dans le jeu ; Playwright pour les outils navigateur).

| Commande | Rôle |
| --- | --- |
| `node tools/test-core.mjs` | Tests du moteur : pierres, fusion, combos, capacités, armure, barrières, socles typés, coopération, vagues qui se chevauchent, rembobinage et dernière chance |
| `node tools/validate-levels.mjs` | Validation du schéma des niveaux et des données (clés inconnues, éléments, une lanterne d'attaque par élément) |
| `node tools/sim.mjs --check` | **Équilibrage** : le bot équilibré gagne chaque niveau seul et en coop ×2 / ×4, aucun niveau (sauf le premier) n'est gagnable avec une seule lanterne, aucune vague ne double la difficulté, dents de scie et climax en fin de niveau, 5 à 8 minutes, défi réussi, Difficile gagnable |
| `node tools/sim.mjs [ids] --bots=balanced,random,mono --seeds=1,2,3 --players=2 --verbose` | Simulations détaillées (bots : `balanced`, `random`, `mono` = une partie par lanterne) |
| `node tools/balance-md.mjs > BALANCE.md` | Régénère les tableaux d'équilibrage depuis les données |
| `node tools/net-test.mjs ws://localhost:8883/mqtt` | Multijoueur sans navigateur : salon, élément, salon plein, partie à 3, poses, annulation, débit |
| `node tools/mp-test.mjs` | Multijoueur dans de vrais navigateurs (2 à 4 joueurs au doigt simulé) |
| `node tools/ui-test.mjs` | Gestes au doigt simulé : pose soulevée, annuler, fiches, fusion, pierres, palette, jauge… |
| `node tools/play-browser.mjs [ids]` | Joue chaque niveau en entier dans le vrai jeu et vérifie victoire + console propre |
| `node tools/qa.mjs`, `node tools/layout-check.mjs` | QA navigateur, mise en page 390×844, 375×667, 430×932 avec zones sûres |
| `node tools/perf.mjs 2-4` | Temps de rendu (objectif : ≤ 20 ms en moyenne) |
| `node tools/shot.mjs <id>`, `node tools/make-icons.mjs` | Captures, icônes |

Les bots n'utilisent que l'API publique du moteur (`placeTower`, `fuse`, `placeStone`, `rewind`…), comme l'interface.

Le moteur applique des **rendements décroissants** au recul et aux étourdissements (`knockFatigue*`, `stunFatigue*` dans `data/rules.js`) : un yokai ne peut jamais être bloqué indéfiniment, une vague finit toujours.

---

## Déploiement

Le dépôt est servi tel quel par **GitHub Pages** (workflow `.github/workflows/pages.yml` : à chaque push sur `main`, le contenu est publié). Le fichier `.nojekyll` désactive Jekyll.

Installation sur iPhone : ouvrir l'URL dans Safari → bouton Partager → **Add to Home Screen** (« Sur l'écran d'accueil »).
