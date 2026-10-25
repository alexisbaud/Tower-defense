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

Aucun compte. L'accueil sert à jouer : **« Continuer · 2-3 »** relance d'un toucher le premier niveau ouvert pas encore gagné (au tout premier lancement : « Jouer · 1-1 »), **« Niveaux »** ouvre la carte, **« À plusieurs »** la feuille du salon. Son et Réglages sont en haut à droite. À l'ouverture du jeu, **votre salon est créé automatiquement** ; son code de 4 lettres s'affiche dans la feuille « Jouer à plusieurs ».

- **Jouer seul** : « Continuer », ou « Niveaux » puis un niveau. Seul, vous contrôlez les quatre éléments.
- **Inviter** : « À plusieurs » ▸ « Inviter » (partage du lien `…/?salon=CODE`) ou dictez le code. Jusqu'à 4 joueurs. Un ami qui arrive est annoncé sur l'accueil (« Aki a rejoint votre salon ») ; l'hôte voit alors « Jouer à 2 · Choisir le niveau ».
- **Rejoindre** : ouvrez le lien reçu (la feuille du salon s'ouvre d'elle-même), ou « À plusieurs » ▸ « Rejoindre un autre salon », saisissez le code. Un invité attend sur l'accueil que l'hôte choisisse le niveau ; « Salon » rouvre la feuille, d'où « Quitter le salon » (second toucher pour confirmer).
- **Un élément par joueur** : à plusieurs, chacun prend un élément (un seul joueur par élément ; qui n'a rien choisi reçoit le premier libre) et ne pose **que** les lanternes de cet élément ; les pierres sont l'objet de la Terre. Les éléments que personne n'a pris ne sont à personne : leurs socles gravés deviennent universels.
- **Coopération** : l'hôte choisit le niveau et lance la partie pour tout le salon. Chacun a **sa bourse d'or** ; les **vies du sanctuaire sont communes**. À plusieurs, les yokai ont un peu plus de PV (×1,05 à ×1,35) ; or de départ et primes suivent `rules.coop` (`data/rules.js`).
- **Construction de 2 s** : une lanterne, une pierre ou un mur déplacé apparaît « en construction » et s'active 2 s après le toucher, seul comme à plusieurs (à plusieurs : au même instant chez tous). « Annuler » pendant la construction ne coûte rien, même quand l'annulation n'arrive qu'après l'activation (délai réseau) : la lanterne ou la pierre est reprise et payée en entier ; une annulation qui arriverait trop tard pour rien changer (mur déjà déplacé, lanterne au-delà de sa fenêtre d'annulation) est refusée par l'hôte : « Trop tard pour annuler », jamais acceptée sans effet. À plusieurs, une fusion ou une vente part après le délai des commandes (~1 s) : la lanterne glisse vers sa jumelle, ou s'efface, et ne peut être ni revendue ni refusionnée entre-temps.

Le réseau passe par un relais MQTT public et gratuit (EMQX, puis HiveMQ, puis Mosquitto en secours). **Chaque téléphone fait tourner la même partie** (lockstep) : seules les commandes datées circulent (poser, vendre, appeler une vague…), plus un battement de l'hôte ~4 fois par seconde avec une empreinte de contrôle ; la position des yokai et des lanternes ne voyage jamais. Un invité reçoit environ 0,3 à 0,6 Ko/s en partie chargée (contre 6 à 8 Ko/s, 16 Ko/s en pointe, quand l'hôte diffusait son état 8 fois par seconde). Sans réseau, le salon reste « hors ligne » et le jeu solo fonctionne normalement.

### Transfert de progression

La progression vit dans le stockage du navigateur ; une app ajoutée à l'écran d'accueil a **son propre stockage**. Pour la garder d'une installation à l'autre (ou d'un téléphone à l'autre) : **Réglages ▸ Ma progression** affiche un code `JDE1-XXXXX-XXXXX` (10 caractères, base 32 de Crockford : ni I, ni L, ni O, ni U ; « Copier », « Partager »), à saisir dans l'autre installation (**Importer un code**). L'import est tolérant (minuscules, tirets ou espaces oubliés, O pour 0, I ou L pour 1) et **ne baisse jamais un record** : chaque niveau garde le meilleur des deux (étoiles, Difficile, défi). Un code mal recopié est refusé (somme de contrôle). Au-delà de 8 niveaux, le code devient `JDE2-…` (un caractère de plus par niveau).

**Haut de l'écran flou (iOS 26/27, app installée avant la version 4)** : iOS fige à l'installation la balise de barre d'état « translucide », sous laquelle il floute le haut de la page. Le jeu le détecte (encart haut non nul), décale son interface de 40 px sous la bande floue et propose une fois, sur l'accueil, de réinstaller : copier le code, supprimer l'icône, Safari ▸ Partager ▸ Sur l'écran d'accueil, importer le code. L'explication reste dans Réglages ; `diag.html` (lien « Diagnostic de l'écran ») mesure la bande réelle sur l'iPhone.

### Contrôles

| Geste | Action |
| --- | --- |
| Choisir une lanterne dans la palette (onglet de son élément), puis toucher ou glisser vers un socle | Poser : la lanterne fantôme flotte 60 px au-dessus du doigt, la pose se valide **au relâchement** ; liens et nom des combos en direct. La lanterne se construit **2 s** (or réservé, « −50 » à côté de l'or), puis s'allume |
| Toucher d'abord un socle libre (**socle d'abord**) | Le socle s'entoure d'or et la palette grise les cartes qui n'y vont pas ; toucher une carte y pose aussitôt ; toucher ailleurs annule |
| « ↶ Annuler » (rangée d'action, à la place de l'aperçu) | Pendant la construction : rien n'est payé ; puis 3 s après l'activation : or rendu en entier (pierre et mur : pendant la construction) |
| Toucher une lanterne | Barre d'actions 64 × 52 près d'elle : « Premier ▾ » ouvre les **4 priorités** (un toucher règle et ferme), **Fusionner** (si une jumelle est posée : les jumelles s'allument, toucher l'une l'absorbe), Fiche, Vendre (second toucher pour confirmer) ; Gardien de pierre : « Mur » (déplacer le mur). Elle se ferme après une action, ailleurs, ou 6 s sans geste ; toucher la lanterne la rouvre |
| Glisser une lanterne sur une lanterne identique | **Fusion** (raccourci : même type, même niveau → niveau supérieur, 3 niveaux) ; l'aperçu montre les combos perdus et conservés. Un petit sceau 合 marque les lanternes qui ont une jumelle |
| Appui long sur une lanterne, un yokai, une carte ou un onglet de la palette | **Fiche** en feuille du bas (le plateau reste visible) : force, faiblesse, 4 chiffres, action principale ; « Détails ⌃ » (ou tirer la poignée) l'agrandit : évolution, cibles, armure, vente |
| Outil Pierre (épinglé à droite), glisser sur le gravier | Le nouveau chemin s'affiche en pointillés avec « +X cases » ; une pierre qui fermerait le passage est refusée (les pierres encore en construction comptent déjà : refus dès le toucher, jamais 2 s plus tard) |
| Bouton de vague | Le cadran compte les secondes avant la vague suivante, la sous-ligne dit la prime « ◉ +12 » ; **appel anticipé** à tout moment : les pièces volent jusqu'à 金, l'arc fantôme de la jauge montre la charge gagnée. Les puces à côté sont la vague suivante (toucher : la fiche du yokai) |
| Jauge 巻 : glisser vers la gauche, ou **deux touchers** (jauge pleine) | **Rembobinage** ; un toucher sur la jauge pas encore pleine dit comment la remplir, un appui long la règle |
| ×1 / ×2, ❙❙ | Vitesse, pause : feuille du bas sans voile (Reprendre, Combos, son, musique, effets, réglages ; Recommencer et Quitter se confirment) |
| Messages | Un seul à la fois dans le **couloir** du plateau, jamais sur un portail ni sur le sanctuaire (toucher : sa fiche ou les combos) ; les refus s'écrivent près du doigt |
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

Une **jauge** se remplit en éliminant des yokai et en appelant les vagues en avance. Pleine, glissez-la vers la gauche (ou touchez-la deux fois) : le temps recule de **6 secondes** (yokai, or, vies, pierres). Les lanternes posées après cet instant disparaissent du présent (**or rendu à 100 %**) et laissent un **écho** qui tire à 50 % pendant 10 s et compte pour les combos. Une fuite fatale avec la jauge pleine ouvre une **dernière chance** de 4 s pour rembobiner. Les **tokihami**, hors du temps, ne reculent pas et les vies qu'ils prennent ne reviennent pas.

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
| Yuki-onna | Soigne ses voisins ; insensible à l'Eau | Priorité « plus fort », Feu et Vent (qui disperse sa neige), Vapeur |
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

Raccourcis de test : `?level=2-4` lance directement un niveau ; `?salon=ABCD` rejoint un salon ; `?broker=ws://localhost:8883/mqtt` remplace les relais publics (plusieurs adresses séparées par des virgules) et `?broker=off` coupe tout réseau (salon « hors ligne »).

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
    commands.js             façade des commandes (solo : file du moteur ; à plusieurs : réseau)
  net/                      MULTIJOUEUR
    mqtt.js                 client MQTT 3.1.1 minimal sur WebSocket (sans dépendance)
    lobby.js                salons par code : hôte, invités, choix d'élément, messages signés
    lockstep.js             partie commune : commandes datées, battements, empreintes, état complet
    coop.js                 lien entre salon, partie et boucle principale
  audio/sound.js            synthèse Web Audio (koto, taiko, cloche) + musique générative
tools/                      simulateur, bots, validateur, tests, QA navigateur
```

**Principes**

- Le moteur (`src/core`) ne connaît ni le DOM ni le Canvas. Il avance par pas fixes de 1/60 s (`game.update(STEP)`), et publie des **événements** (`spawn`, `shoot`, `hit`, `kill`, `fuse`, `combo`, `rewindStart`…) consommés par le rendu, l'audio et l'interface.
- Les **données** décrivent *quoi* (valeurs, capacités activées) ; le moteur sait *comment*. Ajouter du contenu ne demande pas de toucher au moteur tant qu'on réutilise les capacités existantes.
- Le chemin est un champ de flux BFS recalculé à chaque pierre ; une pierre qui couperait tout passage (pour une apparition ou un yokai déjà en route) est refusée avec un retour visuel et sonore.
- Le rembobinage enregistre un instantané de l'état toutes les 0,1 s pendant la partie ; chaque yokai a une identité stable (`uid`) pour que rejouer les mêmes éliminations ne recharge pas la jauge deux fois.
- **Commandes datées** : l'interface et les bots n'appellent jamais les actions du moteur ; chaque geste devient une commande (`game.issue`, `src/ui/commands.js`) exécutée à une image précise. Une pose (lanterne, pierre, mur) attend la construction (`rules.buildTime`, 2 s) ; seul, les autres commandes s'exécutent aussitôt.
- **Multijoueur en lockstep** : le moteur est déterministe (`src/core/dmath.js` : sinus, cosinus et longueurs identiques sur tous les navigateurs ; aléatoire à graine), chaque téléphone fait donc tourner la même partie. L'hôte date chaque commande, la sienne ou celle d'un invité, **au moins 10 images plus tard**, l'exécute par sa file et la diffuse ; un invité **ne dépasse jamais de plus de 8 images** la dernière image connue de l'hôte. Comme les messages de l'hôte arrivent dans l'ordre, un invité qui atteint une image a déjà reçu toutes ses commandes : rien n'arrive en retard, rien ne recule. Les 2 s de construction laissent à la commande d'une pose le temps de parvenir à tous ; les autres commandes attendent 0,75 s (`commandDelay`). L'hôte bat la mesure ~4 fois par seconde (son image, sa vitesse, sa pause, l'empreinte `stateHash` de son état toutes les 30 images) ; l'invité le suit ~0,2 s derrière, à sa vitesse, et compare chaque empreinte. Son horloge de l'hôte vient du battement le plus rapide des 4 dernières secondes (pas du dernier reçu) et sa marge couvre la gigue observée : sur un réseau irrégulier, la lecture garde la vitesse de l'hôte au lieu de ralentir ou de s'arrêter à chaque battement en retard (300-800 ms de latence : 0 % d'images ralenties contre 19 %). Pause et vitesse de l'hôte s'appliquent chez tous à une image annoncée (dans 10 images).
- **Resynchronisation** : empreinte différente, commande perdue en route, plus de 5 s de retard (onglet en arrière-plan), rechargement de la page ou retour après une coupure : l'invité demande l'état complet (`game.exportState`, 15 à 50 Ko), l'importe et repart de cette image (« Synchronisation… »). L'historique du Rembobinage ne voyage pas : un Rembobinage exécuté moins de 6 s (de chronologie) après une resynchronisation en demande aussitôt une autre, qu'il ait réussi ou échoué chez l'invité (sans quoi, pendant une dernière chance, l'invité pouvait perdre seul la partie que les autres venaient de sauver).
- **Relais public** : n'importe qui peut y lire et y publier. Les messages des invités sont **signés** (ECDSA P-256, clé gardée le temps de l'onglet, compteur contre le rejeu) : un tiers ne peut ni agir au nom d'un joueur ni le faire sortir. L'hôte vérifie la forme de chaque commande (types entiers, lanterne connue, joueur authentifié, image bornée) ; l'invité, celle de chaque commande datée, battement, état complet et résultat (nombres bornés, types connus, jamais de HTML), et ignore ce qui ne cite pas sa partie. Une commande forgée glissée dans la partie d'un invité est repérée par l'empreinte et effacée par l'état complet de l'hôte.

**Protocole réseau (version 6)** — sujets `jde/v1/<CODE>/h` (hôte → invités) et `jde/v1/<CODE>/c` (invités → hôte, messages signés) :

| Message | Sens | Contenu |
| --- | --- | --- |
| `hello`, `pick`, `name`, `bye` | invité → hôte | arrivée (version, clé publique), choix d'élément, nom, départ |
| `lobby`, `refuse` | hôte → invités | état du salon ; refus (`full`, `version`, `inGame`) |
| `start` | hôte → invités | `level`, `seed` (identifiant de la partie), `players` (un élément chacun), `hard`, `challenge`, `cd` (délai des commandes) ; renvoyé à un joueur qui revient (`rejoin`) |
| `cmd` | invité → hôte | commande proposée : `op`, `args`, `f` (image souhaitée), `tmp` (numéro provisoire) |
| `cmd` | hôte → invités | commande datée `e` = `{ id, frame, issued, pid, op, args, at }`, numéro de diffusion `k`, `tmp` de l'invité qui l'a proposée |
| `nack` | hôte → invités | commande refusée (`pid`, `tmp`, raison) : la pose provisoire disparaît |
| `hb` | hôte → invités | battement : `f` image, `k` dernière commande, `h`/`hf` empreinte et son image, `sp` vitesse (`ns`/`nf` : prochaine vitesse et son image), `pz` image de la pause |
| `resync` | invité → hôte | demande d'état complet |
| `state` | hôte → un invité | état complet `s` à l'image `f` (après l'animation d'un Rembobinage) |
| `end`, `hostGone` | hôte → invités | fin (résultat, image finale `f`) ; départ de l'hôte |

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
| `node tools/sim.mjs --check` | **Équilibrage** : le bot équilibré gagne chaque niveau seul et dans les 11 équipes coop possibles (6 paires, 4 trios, les 4 éléments ; chaque bot limité à son élément, construction de 2 s comprise), aucun niveau (sauf le premier) n'est gagnable avec une seule lanterne, aucune vague ne double la difficulté, dents de scie et climax en fin de niveau, 5 à 8 minutes, défi réussi, Difficile gagnable |
| `node tools/sim.mjs [ids] --bots=balanced,random,mono --seeds=1,2,3 --players=2 --verbose` | Simulations détaillées (bots : `balanced`, `random`, `mono` = une partie par lanterne) |
| `node tools/balance-md.mjs > BALANCE.md` | Régénère les tableaux d'équilibrage depuis les données |
| `node tools/net-test.mjs ws://localhost:8883/mqtt` | Multijoueur sans navigateur. En mémoire (horloge simulée) : trois parties 3 minutes avec Rembobinage, gigue, pertes et un invité à 30 Hz (empreintes identiques, chaque commande à la même image), poses simultanées, commande en retard, état corrompu puis resynchronisé, invité qui arrive en cours de partie, pause et vitesse, débit, Rembobinage juste après un état complet (dernière chance), lecture régulière sous 300-800 ms de gigue (chaque empreinte comparée), annulation tardive d'une pierre, d'un mur et d'une lanterne (refusée et dite plutôt qu'acceptée sans effet). Sur le relais : salon, élément unique, salon plein, ancienne version, parties à deux et à trois, rechargement, messages forgés, « bye » d'une connexion morte. `NET_ONLY=mot` ne lance que les sections dont le titre le contient |
| `node tools/mp-test.mjs` | Multijoueur dans de vrais navigateurs (2, 4 puis 3 joueurs au doigt simulé) : salon, code et lien, élément unique, palette limitée à son élément, construction visible chez tous puis activée à la même image, « Annuler », fusion et vente d'un invité en route (ni revendue ni refusionnée pendant le délai), or séparé, vies communes, pause de l'hôte (même image chez tous), hôte sans nouvelles, coupures, rechargement (« Synchronisation… »), fin de partie, débit. Les outils navigateur passent au jeu le relais local (`tools/relay.mjs`, variable `JDE_RELAY`) s'il répond, sinon `?broker=off` |
| `node tools/ui-test.mjs` | Gestes au doigt simulé : pose soulevée, annuler, fiches, fusion, pierres, palette, jauge… |
| `node tools/play-browser.mjs [ids]` | Joue chaque niveau en entier dans le vrai jeu et vérifie victoire + console propre |
| `node tools/qa.mjs`, `node tools/layout-check.mjs` | QA navigateur, mise en page 390×844, 375×667, 430×932 avec zones sûres |
| `node tools/menus-check.mjs` | Écrans hors partie au doigt simulé : code de progression (aller-retour, code abîmé refusé, import par maximum), accueil (« Jouer » lance 1-1 d'un toucher, « Continuer »), salon en feuille (code entier, voile), réglages, carte (étiquettes jamais tronquées ni superposées, défilement vers le niveau à jouer, retour d'une victoire), fiche de niveau (variantes après la 1re victoire), rotation ; installation actuelle (375×647 à 430×873) et ancienne installation (rien dans la bande floue, invitation à réinstaller) ; accueil de l'hôte et de l'invité si le relais local répond |
| `node tools/perf.mjs 2-4` | Temps de rendu (objectif : ≤ 20 ms en moyenne) |
| `node tools/shot.mjs <id>`, `node tools/make-icons.mjs` | Captures, icônes |

Les bots passent par la file de commandes du moteur (`game.issue` : poses, fusions, pierres, vagues, rembobinage), comme l'interface.

Le moteur applique des **rendements décroissants** au recul et aux étourdissements (`knockFatigue*`, `stunFatigue*` dans `data/rules.js`) : un yokai ne peut jamais être bloqué indéfiniment, une vague finit toujours.

---

## Déploiement

Le dépôt est servi tel quel par **GitHub Pages** (workflow `.github/workflows/pages.yml` : à chaque push sur `main`, le contenu est publié). Le fichier `.nojekyll` désactive Jekyll.

Installation sur iPhone : ouvrir l'URL dans Safari → bouton Partager → **Add to Home Screen** (« Sur l'écran d'accueil »).
