# Jardin des Esprits : spécification UI/UX v4

Base : branche `engine-v3`, commit `c3dde46`. Date : 25 octobre 2026.
Ce document est la référence de la refonte. Il tranche entre deux propositions indépendantes (A « lisibilité », B « satisfaction »), trois rapports de recherche (iOS, UX mobile, audit de l'existant) et mes propres vérifications. Toutes les mesures sont en px CSS (= pt iOS).

Pièces de travail (hors dépôt) :
- recherches : `/tmp/claude-0/-home-user-Tower-defense/f911883b-8555-55e6-8324-4729246e5ba3/scratchpad/uiux/research-ios/`, `…/uiux/research-ux/`, `…/uiux/audit/` (146 captures, scripts `lib.mjs`) ;
- propositions : `…/uiux/design-clarity/` (A : `shots/compare-partie-390.png`, `planche-hors-partie.png`, `planche-partie.png`), `…/uiux/design-feel/` (B : `shots/proto-*.png`, `proto/proto.css`) ;
- arbitrage : `…/uiux/synth/measure.mjs` (largeurs réelles des libellés dans les deux polices).

---

## 0. En bref

1. **Le flou du haut** vient d'iOS 26.1+ quand l'app installée garde `apple-mobile-web-app-status-bar-style=black-translucent`. On **supprime la balise** (parade Apple, vérifiée sur un iPhone iOS 27.0) : la barre d'état devient un aplat indigo et la page commence dessous. Les installations existantes reçoivent un **garde-fou de 40 px** en CSS, puis une invitation à réinstaller, **après** l'arrivée d'un code de transfert de progression.
2. **Lire en haut, agir en bas, le plateau au milieu et libre.** HUD de 44 px (au lieu de 54), bas d'écran de 156 px (au lieu de 183) : la case passe de **40 à 43 px** sur iPhone 14/15/16 (+16 % de surface), de 32 à 35 px sur iPhone SE.
3. **Un seul couloir de messages**, en haut du plateau, une seule bulle à la fois, des durées lisibles ; plus rien de fixe sur le tiers bas (toast, « Annuler », carte « Nouveau yokai » quittent le plateau).
4. **Chaque information a une place** : compte à rebours dans le sceau du bouton de vague, charge de Rembobinage en arc fantôme sur la jauge, « Annuler » à une place fixe dans la rangée d'action, refus écrits près du doigt.
5. **Chaque geste répond en moins de 100 ms** (état pressé commun), chaque geste caché a son équivalent par touchers (fusion, Rembobinage), chaque action destructrice se confirme (Recommencer, Quitter, Vendre).
6. **Accueil pour jouer** : un bouton « Continuer · 2-3 » (1 toucher au lieu de 3), « Niveaux », « À plusieurs » ; le salon passe dans une feuille.
7. **Estampe, jamais verre** : aplats, encre, sceaux, ombres nettes ; aucune translucidité ni `backdrop-filter` ; tout kanji est doublé d'un mot.
8. Deux lots parallèles : **GAME** (écran de partie et fondation des jetons) et **MENUS** (accueil, salon, carte, fiche de niveau, réglages, rotation), avec des fichiers ou des plages disjoints (§9).

---

## 1. Ce que disent les recherches

### 1.1 Le flou en haut de l'écran (iOS 26.1+, accentué sous iOS 27)

- **Mécanisme.** UIKit pose sur la vue web un « scroll edge effect » (Liquid Glass) quand la page passe sous la barre d'état (`black-translucent`). Il est dessiné hors du DOM : **aucun CSS ne le retire**. Code WebKit lu : `WKScrollView.mm` (`topEdgeEffect`), `WKWebViewIOS.mm` (`_shouldHideTopScrollPocket`), `LocalFrameView::fixedContainerEdges`.
- **Hauteur.** De 0 à environ **encart + 40 pt** (herdr #164 : flou net jusqu'à 88 px, fondu jusqu'à ~104, net à ~112 sur un iPhone à Dynamic Island ; dozzle #5222, xdoubleu #1987, folio, kp-rueck : ~40 pt). Notre HUD (54 px) commence pile à l'encart : il est entièrement dans la bande (audit C1 : vies, or, vague, ×1 et pause entre y = 64 et 108).
- **Parade.** Supprimer la balise : la barre d'état devient opaque (couleur `theme-color`), la page commence dessous, plus rien n'est sous le flou. Réponse d'un ingénieur Apple sur le bug WebKit 317153 (« deprecated »), **vérifiée sur iPhone iOS 27.0.0** (herdr #164/#199) et dans le Simulator iOS 27.0 (alkalye #67).
- **Coûts.** iOS lit la balise **à l'installation** : il faut supprimer l'icône puis la rajouter. L'app installée a son propre `localStorage` : la réinstallation perd très probablement la progression (bug WebKit 181849, non vérifié sur appareil) → **transfert de progression obligatoire avant toute invitation**. Le bug 316008 (`100vh` inclut la barre) ne nous touche pas : aucun `vh`, `lvh`, `innerHeight` ou `screen.height` dans la mise en page (vérifié).
- **Ce qui ne marche pas de façon fiable.** Une bande `fixed` opaque en haut en gardant `black-translucent` (herdr #178, trailhead #120, folio #999 annulé après essai). Notre page remplit déjà ces conditions et reste floue.
- **Règles annexes.** Ne jamais changer `theme-color` ni `color-scheme` à l'exécution (l'app installée fige le premier changement). Garder `html`, `body`, `#app` opaques et `position: fixed; inset: 0`.

### 1.2 Ergonomie mobile

- **Pouce.** 49 % des usages à une main, le pouce fait ~75 % des touchers ; précision ~7 mm au centre, ~12 mm aux coins (Hoober 2013, 2017). Apple : contrôles fréquents près du pouce, menus secondaires en haut.
- **Cibles.** Apple 44×44 pt (28 au minimum en jeu), Material 48 dp + 8 dp d'écart, WCAG 2.5.8 24 px (AA). Les cases du plateau font 32 à 36 px sur SE aujourd'hui : l'aimantation (`nearestFreeSlot`, `towerNear`) compense et doit être élargie.
- **Texte.** Apple (jeux) : 17 pt par défaut, 11 pt minimum pour le secondaire, éviter les graisses fines ; contraste 4,5:1 sous 18 pt, 3:1 au-delà ou en gras. Le mincho (pleins et déliés très contrastés) ne s'emploie qu'à 18 px et plus.
- **Durées.** Swink, Nielsen : réponse perçue instantanée sous 100 ms. Lecture : ~17 caractères/s + temps de réaction → `max(2500, 1200 + 60 × caractères)` ms. Apple : « minimize time-boxed interface elements ».

### 1.3 Information de jeu

- HUD en trois niveaux : survie toujours visible, tactique contextuelle, stratégique à la demande ; « never put Tier 3 information in persistent HUD space ». Mini Metro (GDC 2017) : la beauté par élimination ; Alto : interface « pared down ».
- Proximité (Apple, onboarding et menus) : l'instruction près de la zone qu'elle concerne. Kingdom Rush : minuteur de vague en cercle, construction en deux touchers ; Arknights : portée et stats sur le terrain à la sélection ; Bloons TD 6 : lecture/avance dans un seul contrôle.
- Feuilles (Apple) : deux hauteurs, poignée, glisser pour fermer, une seule à la fois ; une feuille non modale laisse agir derrière.

### 1.4 Retour et « juice »

- Kao et al. 2020 : courbe en U inversé (moyen et fort > aucun et extrême). CHI 2024 (n = 1 699) : les effets ne motivent que **liés à la réussite** du joueur. Lin et al. 2022 : l'impact ressenti tient au hit stop, à la cohérence du son, à la caméra.
- Apple : état pressé visible avec une lueur **hors des bords** du contrôle (sinon cachée par le doigt), « avoid overusing haptics ».

### 1.5 Haptique web

- Safari n'a pas l'API Vibration. Le `<input type="checkbox" switch>` déclenché par programme est bloqué depuis iOS 26.5 ; seul un toucher réel sur un switch superposé vibre encore (ios-haptics 3.2.0). → P2, derrière un réglage, éteint par défaut, à tester sur appareil.

### 1.6 Constats de l'audit (chiffrés, `uiux/audit/`)

| Id | Constat |
|---|---|
| C1 | HUD et en-tête de la carte entièrement dans la bande floue (y 64–109). `layout-check` simule 47 px d'encart et aucune bande. |
| C2 | Au lancement de la vague 1, 5 calques à la fois (bulle, toast, bannière, carte « Nouveau yokai », « Annuler ») couvrent **65–67 % du tiers bas** ; le toast « 刻 Socles gravés… » cache 71–100 % de la bulle « Lancez la vague ! ». |
| C3 | « Recommencer » et « Carte » de la pause détruisent la partie sans confirmation, y compris pour tout le salon (hôte). |
| M1 | La barre d'actions reste ouverte pendant les vagues et couvre le chemin ; la fiche occupe 34–41 % de l'écran. |
| M2 | Fiche de lanterne : 119 mots, 10 rubriques, 2,8 à 3,1 hauteurs de défilement ; Force/Faiblesse en dernier (en tête sur la fiche « type ») ; ligne « Niveau 2 » coupée. |
| M3 | Fusion non signalée (glisser seulement) ; table des combos en matrice 4×4 (6 combos affichés deux fois). |
| M4 | Lancer un niveau depuis l'accueil : 3 touchers ; priorité de ciblage : 2 à 4 touchers à l'aveugle. |
| M5 | Cases de 32 px (SE, 2-4) à 40 px (390) ; bas d'écran de 175–183 px. |
| M6 | 11 combinaisons taille/graisse/famille à l'écran ; libellés d'action en 12 px ; chiffres mêlant Zen Kaku et Shippori. |
| M7 | Le salon occupe ~31 % de l'accueil ; deux boutons vermillon concurrents ; le champ de code coupe « BQKR » en « QKR » ; renommer n'est pas signalé. |
| M8 | Fiche du 1-1 : Difficile (fermé), Défi, jargon « Socles gravés » dès la première partie ; kanji seuls (戻, 音, 巻, 封). |
| m1 | « Vague » glisse de 18 px quand « −50 » apparaît ; le bouton de vague perd 39 px quand la jauge est pleine. |
| m3 | Victoire : « Carte » (indigo plein) pèse plus que « Rejouer ». |
| m4 | Nœuds verrouillés 2,2–2,4:1, « Second monde » 2,7:1. |

Ma vérification (`uiux/synth/` et `design-clarity/scripts/tnum.mjs`, polices réellement chargées) : **ni Zen Kaku Gothic New ni Shippori Mincho n'ont de chiffres tabulaires** ; `font-variant-numeric: tabular-nums` ne change rien (Zen 700 20 px : « 1111 » = 32,7 px, « 0000 » = 40,2 px, avec ou sans). C'est la cause de m1.

### 1.7 Sources

iOS et WebKit :
- WebKit (code) : https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/page/LocalFrameView.cpp · https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/ios/WKWebViewIOS.mm · https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/ios/WKScrollView.mm
- Bugs 317153, 301994, 316008, 301108 cités par https://github.com/autobrr/qui/issues/2520 · https://github.com/anomalyco/opencode/issues/56969
- Vérifiés sur appareil ou simulateur : https://github.com/devswha/herdr-web-ui/issues/164 · https://github.com/devswha/herdr-web-ui/pull/199 · https://github.com/carlassmann/alkalye/pull/67 · https://github.com/thierryvm/TerminalLearning/pull/398 · https://github.com/luismlorenzana/uma-rpg/pull/32
- Hauteurs : https://github.com/amir20/dozzle/pull/5222 · https://github.com/xdoubleu/tools.xdoubleu.com/issues/1987 · https://github.com/mbryantms/folio/pull/999 · https://github.com/ionic-team/capacitor-docs/pull/617 · https://useyourloaf.com/blog/iphone-16-screen-sizes/ · https://useyourloaf.com/blog/iphone-17-screen-sizes/
- Échecs de la bande opaque : https://github.com/YuzhouTian/trailhead/pull/120 · https://github.com/rexdotsh/kleis/pull/97
- Synthèse : https://github.com/joe-bell/skills/blob/main/skills/apple-web-app/references/theme-color-and-status-bar.md · forum Apple https://developer.apple.com/forums/thread/845732 · stockage séparé https://bugs.webkit.org/show_bug.cgi?id=181849

Ergonomie, jeu, retour :
- Apple HIG : https://developer.apple.com/design/human-interface-guidelines/designing-for-games · …/game-controls · …/typography · …/sheets · …/onboarding · …/accessibility · …/materials · …/playing-haptics
- Hoober : https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php · https://www.uxmatters.com/mt/archives/2017/07/design-for-fingers-touch-and-people-part-3.php
- Nielsen : https://www.nngroup.com/videos/3-response-time-limits-interaction-design/ · WCAG 2.5.8 : https://www.disabilityworld.org/toolkit/standards/wcag/2-5-8-target-size-minimum/
- Game feel et juice : https://en.wikipedia.org/wiki/Game_feel · https://arxiv.org/pdf/2011.09201 (Kao 2020) · https://spiral.imperial.ac.uk/entities/publication/253c32f5-d124-4a23-88b5-9aaaf114608d (CHI 2024) · https://arxiv.org/abs/2208.06155v1 (Lin 2022)
- HUD : https://bugnet.io/blog/how-to-design-a-readable-hud · Mini Metro : https://gdconf.com/news/attend-gdc-2017-and-learn-the-value-of-less-is-more-from-a-mini-metro-dev
- Jeux de référence : https://arknights.wiki.gg/wiki/User_interface · https://www.bloonswiki.com/Fast_Forward · https://www.trueachievements.com/a382017/daring-achievement
- Haptique : https://npmjs.com/package/ios-haptics

---

## 2. Arbitrages entre les propositions

A et B s'accordent sur l'essentiel (correctif iOS, HUD de 44, couloir de messages unique en haut, « Annuler » fixe, pause hiérarchisée et confirmée, fiches à deux hauteurs, accueil « Continuer » + salon en feuille, divulgation progressive de la fiche de niveau, combos en liste). Les désaccords sont tranchés ainsi :

| Sujet | A (lisibilité) | B (satisfaction) | Décision et raison |
|---|---|---|---|
| Code de transfert | base32 Crockford compact, 10 caractères | base64url du JSON + somme | **A.** La sauvegarde tient en 44 bits (8 niveaux × 5 bits + drapeaux) : un code court se recopie à la main si le presse-papiers échoue. Import = maximum des records (ne baisse jamais rien). |
| Chiffres | cases fixes `.dg` | `tabular-nums` « presque tabulaire » | **A**, vérifié : `tabular-nums` est sans effet dans nos deux polices. |
| Vitesse et pause | « ×1 » et ❙❙ séparés, en haut | capsule ►/►► + ❙❙, en haut | **Capsule de B, libellé texte de A** (« ×1 »/« ×2 »). Un ► à côté de ❙❙ se lit « lecture/pause ». Les deux restent en haut, contre l'audit : un toucher manqué près du bouton de vague appellerait une vague, action irréversible. |
| Icône de l'or | pièce « mon » partout | sceau 金 dans le HUD, pièce sur les prix | **B.** Le sceau 金 répond au sceau 命 (identité hanko) ; la pièce reste le signe des prix et vole vers le sceau. |
| Or réservé « −60 » | case réservée de 44 px | badge absolu | **A.** Rien ne glisse, rien ne se chevauche ; tient en 375 px (vérifié par A). |
| Bas d'écran | 172 px (case 42) | 156 px (case 43) | **156 px**, découpé 4 + 46 + 6 + 34 + 62 + 4 : rangée d'action de 46 (valeur actuelle, cible plus généreuse que 44) et cartes de 62. 156 est le maximum qui donne 43 px à la fois en 390×797 et en 393×793. |
| Pierre | 4e carte | outil épinglé à droite, hors des onglets | **B.** La pierre n'est pas un élément ; les onglets restent purs (audit m8). |
| Rôle sur les cartes | retiré | gardé | **B.** Les cartes de 102 px laissent la place ; « Dégâts / Zone / Aura » aide à choisir. Le badge d'élément est retiré (l'onglet le dit). |
| Palette simple (1-1, 1-2) | bas de 142 | même bas, cartes plus grandes | **B.** La case est limitée par la largeur en 390 : 14 px de plus ne la grandissent pas ; même gabarit partout, cartes plus belles pour les débutants. |
| Coéquipiers | rangée de 28 sous le HUD | à la place des onglets | **B.** En coop chaque joueur a un élément : les onglets n'existent pas, l'équipe prend leur place ; plateau identique seul et à plusieurs. |
| Bouton de vague, avant la 1re vague | « Commencer » | « Vague 1 · Lancer » | **B.** « Commencer » mesure 108 px pour 86 disponibles (mesuré). Structure constante : libellé « Vague N », sous-ligne. |
| Compte à rebours | secondes dans le sceau | 波 + anneau | **Les deux** : anneau qui se vide autour du sceau ; dans le sceau, les secondes pendant un compte à rebours, 波 sinon (avant la vague 1, dernière vague). Le chiffre exact sert à décider d'un appel anticipé. |
| Jauge prête | disque fixe, piste seulement pendant le glisser, bulle de confirmation | piste qui remplace l'aperçu, double toucher sur place | **Hybride.** Prête, la jauge s'allonge en piste de 130 px **sans jamais déplacer le bouton de vague** (l'aperçu perd des puces) ; double toucher sur place (B) plutôt qu'une bulle de plus sur le plateau (A). Le glisser vers la gauche existant reste. |
| « Annuler » | remplace jauge + aperçu | remplace l'aperçu | **Place de B** (la jauge reste visible), **libellés courts de A** (« gratuit », « or rendu » : « rien n'est payé » ne tenait pas, capture A). |
| Couloir de messages | haut centré, couvre les portails | 4 emplacements candidats, évite S, G et la barre d'actions | **Placement de B, style de A.** Cacher l'apparition des yokai 3 à 6 s n'est pas un « moindre mal » quand on peut l'éviter (méthode déjà écrite pour `placeIntro`). |
| Nouveau yokai | étiquette « nouveau » sur la puce | sceau 新 | **A.** Un kanji n'est jamais seul ; « nouveau » se lit. Étiquette au sol du yokai à sa première apparition (B) en P2. |
| Barre d'actions | pas de fermeture minutée, placement qui évite le chemin | fermeture après 4 s | **Les deux, 6 s.** Fermeture après action, toucher ailleurs, ouverture d'une fiche, et après 6 s sans geste (sauf vente armée ou choix de priorité ouvert) ; placement qui couvre le moins de chemin. Un menu d'action n'est pas une information : on le rouvre d'un toucher. |
| Réglages rapides de la pause | Son, Musique, Vibrations | Son, Musique, Effets, Texte | **Son, Musique, Effets** + lien « Réglages ». Vibrations (incertain sur iOS 26.5+) et Taille du texte (change la mise en page) vont dans Réglages, en P2. |
| Fiche de niveau | feuille du bas | modale centrée | **A.** « Jouer » sous le pouce, un seul modèle de feuille hors partie. Vocabulaire de B : « Socles réservés » au lieu de « gravés ». |
| Carte | pas de bouton bas | bouton « Jouer 2-3 » collé en bas | **A** (« Continuer » le fait depuis l'accueil, la carte reste un écran de choix) + **défilement automatique vers le prochain nœud (B)**. Titre d'en-tête court « Niveaux » (la maquette A, titre long sur deux lignes et étiquettes tronquées, est le contre-exemple). |
| Accueil | Réglages seul en haut à droite | son + réglages | **B** pour les icônes (couper le son vite est un réflexe), **A** pour les libellés (« Niveaux » plutôt que « Carte du jardin »). Variante hôte « Jouer à 2 » (B). |
| Salon | lignes de joueurs, « N places libres » | 4 tuiles de places | **A** : moins de bruit, renommage visible. |
| Victoire | hiérarchie | chorégraphie (chœur des lanternes, comptes, verrou 900 ms) | **Hiérarchie de A en P1, verrou de 700 ms et comptes de B en P1, chœur des lanternes en P2.** |
| Pose | anneau d'encre | son au relâchement, chute du fantôme, cloche à l'activation | **B** : la pose est aujourd'hui muette au relâchement ; c'est le trou de ressenti le plus fréquent du jeu. |
| Couleurs d'élément sous du texte | Vent 3,1:1 toléré (décoratif) | teintes `-ui` | **B** : coût nul, contraste ≥ 4,7:1. |
| Ralenti pendant la visée | éteint par défaut | en option | **Éteint par défaut**, solo seulement, P2 (équilibrage et parité coop). |
| `theme-color` par écran | facultatif (rapport iOS) | jamais (rapport UX) | **Jamais** : risque de figer la barre. Chaque écran commence par un aplat #1f2f4f. |

---

## 3. Principes

1. **Lire en haut, agir en bas.** HUD et couloir de messages en haut ; vague, jauge, palette, « Annuler » dans le tiers bas. Rien à lire dans la zone de l'indicateur d'accueil.
2. **Trois niveaux d'information.** HUD = survie (vies, or, vague n/N, temps). Contextuel = près de l'objet, au bon moment. Le reste = à la demande (fiches, combos, réglages).
3. **Le plateau est la scène.** Rien de permanent ne le couvre. Un seul message global visible à la fois, jamais sur une case d'apparition (S) ni sur le sanctuaire (G).
4. **Stabilité.** Rien ne bouge sans que le joueur l'ait provoqué : chiffres en cases fixes, bouton de vague de largeur fixe, case réservée pour l'or promis.
5. **Réponse < 100 ms et alternative à chaque geste caché.** État pressé au `pointerdown` ; fusion et Rembobinage faisables par touchers ; action destructrice = second toucher.
6. **L'effet suit la réussite.** On amplifie pose, activation, fusion, combo, appel anticipé, vague repoussée ; on calme le décor quand le plateau est chargé.
7. **Lisible par tous.** AA mesuré ; 12 px pour le tertiaire seulement ; ≥ 13 px pour un libellé d'action ; mincho ≥ 18 px ; forme + couleur + kanji + mot pour chaque élément ; aucun texte tronqué par des points de suspension (sauf noms de joueurs).
8. **Estampe sans verre.** Aplats, washi en grandes surfaces seulement, ombres d'encre nettes, sceaux inclinés, filet d'or = « choisi / opportunité ». Pas de `backdrop-filter`, pas de translucidité sous du texte.

---

## 4. Correctif iOS (P0, lot GAME pour `<head>` et `:root`, lot MENUS pour le transfert)

### 4.1 `index.html`, `<head>`

```html
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<!-- SUPPRIMÉ : apple-mobile-web-app-status-bar-style=black-translucent.
     iOS 26.1+ dessine sous la barre d'état un flou que la page ne peut pas retirer (WebKit 317153).
     Sans la balise, la barre est opaque (theme-color) et la page commence dessous. -->
<meta name="apple-mobile-web-app-title" content="Jardin Esprits" />
<meta name="theme-color" content="#1f2f4f" />   <!-- = indigo du HUD. Ne JAMAIS le modifier à l'exécution. -->
<script>
  // Ancienne installation possible : app installée sur iOS ≥ 26 (WebKit ≤ 18 ne connaît pas animation-timeline).
  (function () {
    var n = navigator, d = document.documentElement;
    var ios = /iP(hone|od|ad)/.test(n.userAgent) || (n.platform === 'MacIntel' && n.maxTouchPoints > 1);
    var app = n.standalone === true || matchMedia('(display-mode: standalone)').matches;
    if (ios && app && window.CSS && CSS.supports('animation-timeline: scroll()')) d.classList.add('ios26-app');
  })();
</script>
```

`viewport-fit=cover` reste (encart du bas, `--sab`). Le script se place juste après la balise `theme-color`.

### 4.2 `styles.css`, dans `:root`, après `--sat`

```css
/* Garde-fou : une installation faite avant ce correctif reste en black-translucent (iOS fige la
   balise à l'installation). On la reconnaît à un encart haut non nul : on réserve alors 40 px
   d'aplat uni sous la zone sûre, où tombe la rampe floue. Nouvelle installation : encart 0, sans effet.
   min(40px, encart × 1000) vaut 0 si l'encart est nul, 40px sinon. */
:root.ios26-app {
  --sat: calc(env(safe-area-inset-top, 0px) + min(40px, env(safe-area-inset-top, 0px) * 1000));
}
```

Les 9 emplois de `var(--sat)` (8 dans `styles.css`, 1 dans `lobby.css`) suivent sans autre changement. Conditions à tenir :
- le haut de chaque écran est un **aplat sans texte** : `#screen-game` et `#screen-map` ont déjà un `background-color` indigo sous leur `padding-top` ; **le ciel de l'accueil part de #1f2f4f opaque** (`src/ui/screens.js`, `paint()` : premier arrêt du dégradé à alpha 1 au lieu de 0,95) ;
- aucune texture washi ni aucun texte dans la bande `[0, --sat)`.

### 4.3 Procédure pour les joueurs déjà installés (lot MENUS)

1. Au déploiement, l'ancienne installation reçoit le garde-fou : HUD et en-têtes passent sous la rampe, donc lisibles (scène réduite de ~40 px).
2. Une **carte d'invitation unique** sur l'accueil (§6.20) mène à Réglages › Ma progression : copier le code, supprimer l'icône, Safari › Partager › Sur l'écran d'accueil, importer le code.
3. Cas non détectable (régression iOS 27 où l'encart vaut 0 en `black-translucent`) : l'entrée « Haut de l'écran flou ? » reste en permanence dans Réglages.
4. Page `diag.html` (§6.20) pour mesurer la vraie bande sur l'iPhone de l'utilisateur.

### 4.4 Couleur du texte de la barre d'état

Sans la balise, iOS 26/27 teinte la barre avec `theme-color` (#1f2f4f) et choisit un texte clair. **À vérifier après réinstallation** : si l'heure sort sombre sur indigo, mettre `content="black"` (barre noire, texte blanc ; une bande noire se fond dans le bord de l'écran).

### 4.5 Critères d'acceptation

- `index.html` ne contient plus la chaîne `black-translucent` ; `theme-color` = `#1f2f4f` et n'est jamais écrit en JS.
- `tools/layout-check.mjs` passe en **mode installation actuelle** (fenêtre = H − barre d'état, `--sat` = 0) : 375×647/bas 0, 390×797/34, 393×793/34, 402×812/34, 430×873/34, 440×894/34.
- En **mode ancienne installation** (classe `ios26-app` + `:root.ios26-app{--sat:calc(Xpx + 40px)}` injecté, X = 20, 47, 59, 62, fenêtre pleine) : aucun texte, bouton, sceau ou image ne commence dans `[0, X + 40)` sur l'accueil, la carte, la fiche de niveau, la partie, la pause, la fiche et le salon.
- Contrôle final sur l'iPhone de l'utilisateur : exporter, supprimer l'icône, déployer (service worker à jour), réinstaller, importer, vérifier que le haut est net et l'heure lisible.

---

## 5. Système visuel

### 5.1 Jetons (`:root` de `styles.css`, lot GAME, livrés en premier)

Les jetons existants (`--ink`, `--indigo*`, `--vermillion*`, `--cream*`, `--paper`, `--moss*`, `--gold*`, polices, textures, safe areas) restent. On ajoute :

```css
:root {
  /* texte : couleurs pleines (contraste stable, pas d'alpha sur washi) */
  --on-dark: #f2e8d0;      /* crème sur indigo : 10,9 */
  --on-dark-2: #c8bfa6;    /* secondaire sur indigo : 7,3 (remplace crème à 60–70 %) */
  --ink-2: #54504f;        /* secondaire sur crème : 6,5 (remplace --ink-soft en rgba) */
  /* éléments : teinte « ui » dès qu'un texte crème est posé dessus */
  --fire: #c8402a;  --fire-ui: #b0361f;    /* 5,08 */
  --water: #2f5f8f; --water-ui: #2f5f8f;   /* 5,46 */
  --wind: #5f8f6a;  --wind-ui: #476b50;    /* 3,06 → 4,94 */
  --earth: #8a6a32; --earth-ui: #7c5f2d;   /* 4,11 → 4,88 */
  --moss-ui: #5e6c33;                      /* 3,61 → 4,70 */
  --slate: #5a5850;                        /* outil Pierre (crème dessus : 5,85) */
  --gold-on-dark: #f0cf6a;                 /* = --gold-2 : or vif, actif, ×2 */
  --veil: rgba(16, 22, 40, 0.45);          /* voile des feuilles modales hors partie */
  /* espacements (base 4) */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px;
  --gutter-game: 8px; --gutter-menu: 16px;
  /* rayons */
  --r-s: 6px; --r-m: 10px; --r-l: 14px; --r-xl: 20px; --r-pill: 999px;
  /* ombres d'encre (décalage net, sans flou), sauf les calques flottants */
  --sh-1: 0 2px 0 var(--ink);
  --sh-2: 0 3px 0 var(--ink);
  --sh-float: 0 4px 0 var(--ink), 0 10px 24px rgba(16, 20, 30, 0.3);
  --sh-sheet: 0 -8px 24px rgba(10, 14, 26, 0.28);
  --glow-press: 0 0 0 3px rgba(240, 207, 106, 0.55);   /* lueur hors du doigt */
  /* typographie */
  --fs-scale: 1;            /* P2 : 1 / 1.15 / 1.3, appliqué aux feuilles, modales, menus, couloir, tutoriel */
  --fs-display: clamp(40px, 12.3vw, 52px);
  --fs-banner: 34px; --fs-h1: 28px; --fs-hero: 24px; --fs-h2: 22px; --fs-counter: 20px; --fs-h3: 18px;
  --fs-body: 16px; --fs-body-s: 15px; --fs-label: 15px; --fs-label-s: 14px; --fs-caption: 13px; --fs-micro: 12px;
  /* mouvement */
  --d-quick: 140ms; --d-short: 200ms; --d-med: 280ms; --d-long: 420ms;
  --e-out: cubic-bezier(0.2, 0.8, 0.2, 1);       /* standard */
  --e-emph: cubic-bezier(0.05, 0.7, 0.1, 1);     /* entrées */
  --e-in: cubic-bezier(0.3, 0, 0.8, 0.15);       /* sorties, chutes, aspiration */
  --e-spring: cubic-bezier(0.3, 1.5, 0.5, 1);    /* sceaux, rebonds */
  /* gabarit de la partie */
  --hud-top-h: 44px; --action-h: 46px; --tabs-h: 34px; --cards-h: 62px;
  --foot-pt: 4px; --foot-gap: 6px; --foot-pb: 4px;   /* bas = 4 + 46 + 6 + 34 + 62 + 4 = 156 */
  --wave-w: 148px; --gauge-d: 46px; --chip: 44px;
}
@media (max-height: 720px) {
  :root { --action-h: 44px; --tabs-h: 32px; --cards-h: 52px; --wave-w: 136px; }  /* bas = 142 */
}
```

Les anciens jetons `--palette-h`, `--icon`, `--footer-h` disparaissent une fois leurs emplois remplacés (lot GAME). Règle de sortie : une sortie dure 0,7 × l'entrée, en `--e-in`.

### 5.2 Couleurs et contrastes (calculés, `design-clarity/scripts/contrast.mjs`, `design-feel/scripts/contrast.mjs`)

| Paire | Ratio | Règle |
|---|---|---|
| crème / indigo | 10,9 | texte principal sombre |
| `--on-dark-2` / indigo | 7,3 | « VAGUE », « /14 », sous-lignes, or des coéquipiers |
| encre / crème | 14,0 | texte principal clair |
| `--ink-2` / crème | 6,5 | secondaire sur papier |
| crème / `--vermillion-ui` | 5,08 | **seul vermillon sous du texte** |
| crème / `--vermillion` | 4,08 | interdit sous un texte < 18,7 px gras (sceaux décoratifs seulement) |
| `--vermillion-2` / indigo | 3,6 | jamais du texte : traits, repère de climax |
| crème / `--wind-ui`, `--earth-ui`, `--moss-ui` | 4,94 / 4,88 / 4,70 | remplacent Vent, Terre, mousse sous du texte |
| or `--gold` / indigo | 5,16 | sceau 金, filets |
| `--gold-on-dark` / encre | 11,2 | état actif (×2), couloir |
| vies basses #ff8a6e / indigo | 5,8 | conservé |
| numéros de nœuds verrouillés | 2,4 → **4,9** | encre 0,42 → encre 0,70 |
| plancher secondaire sur indigo | 4,96 | jamais moins que crème à 60 % |

### 5.3 Typographie

Deux polices déjà chargées : **Zen Kaku Gothic New** 500/700 pour toute l'interface et **tous les chiffres** ; **Shippori Mincho** 800 (700 pour l'accroche) seulement à 18 px et plus, plus les kanji des sceaux (pictogrammes, 11 à 30 px).

| Jeton | Taille / interligne | Police, graisse | Emplois |
|---|---|---|---|
| display | clamp(40, 12,3vw, 52) / 1,0 | Mincho 800 | titre de l'accueil |
| banner | 34 / 1,15 | Mincho 800 | grand pinceau (moments forts) |
| h1 | 28 / 1,15 | Mincho 800 | « Victoire ! », « Le sanctuaire est tombé » |
| hero | 24 / 1,0 | Mincho 800 | bouton « Continuer » |
| h2 | 22 / 1,2 | Mincho 800 | titres de feuilles (fiche, pause, salon, niveau, réglages) |
| counter | 20 / 1,0 | Zen 700, cases `.dg` | vies, or, vague |
| h3 | 18 / 1,25 | Mincho 800 | « Vague 4 » du bouton, nom d'un combo, leçon, titre de la carte |
| body | 16 / 1,45 | Zen 500 | paragraphes des menus, lignes de réglages |
| body-s | 15 / 1,45 | Zen 500 | descriptions des fiches en partie |
| label | 15 / 1,25 | Zen 700 | boutons M et S, couloir de messages, bulles du tutoriel, lignes de liste |
| label-s | 14 / 1,2 | Zen 700 | onglets, noms des cartes, lignes de fiche |
| caption | 13 / 1,35 | Zen 500/700 | coûts, sous-lignes, libellés de la barre d'actions, puces |
| micro | 12 / 1,2 | Zen 700 capitales +0,06 em | **tertiaire seulement** : « VAGUE », en-têtes de section, rôles, compteurs de puces, « nouveau » |

Règles :
- Aucun texte sous 12 px ; un libellé qui déclenche une action fait au moins 13 px.
- Correspondances : `.stat` 18 → 20 ; `.wave-label b` Mincho 19 → Zen 20 ; `.tool-name` 12 → 14 ; `.tool.g .cost` 12 → 13 ; `.hint` Mincho 15/800 → **Zen 15/700** ; `.sheet-body` 13 → 15 ; `.tb-btn` 12 → 13 ; `.modal-card p` 15 → 16 ; `.lv-opt-text small`, `.map-concept`, `.lobby-status`, `.lobby-note` 12 → 13.
- **Chiffres en cases fixes** (helper `digitsHTML(n)` / `setDigits(el, n)` dans `src/ui/fmt.js`, lot GAME) : chaque chiffre dans `<i class="dg">`, `.dg { display:inline-block; width:.52em; text-align:center; font-style:normal }` (le « 8 » mesure 0,51 em), le conteneur en `white-space: nowrap`. Emplois : vies, or, or réservé, vague, secondes du bouton de vague, pourcentage de la jauge, or des coéquipiers, étoiles de la carte, pierres restantes, comptes de la victoire. Les `font-variant-numeric: tabular-nums` existants sont retirés (sans effet).
- Les noms de lanternes en palette utilisent le nom court existant (`shortName`) : « Mortier hanabi » (90,8 px) ne tient pas dans une carte, « Mortier » si.

### 5.4 Iconographie

- **Éléments** : toujours forme + couleur + kanji + mot. ▲ Feu 火, goutte Eau 水, ◆ Vent 風, ■ Terre 土 (`elementBadge()` de `src/ui/elements.js`, fond du kanji en teinte `-ui`). Tailles 18 (texte), 20 (onglets), 24 (listes), 26 (salon).
- **Ressources** : 命 vies (sceau vermillon 24) ; 金 or (sceau or 24) dans le HUD ; **pièce percée « mon »** devant tout prix et dans les vols de pièces (10–14 px) ; 巻 jauge (disque crème, encre indigo, anneau or) ; 波 vague, 嵐 climax ; 石 pierre ; 建 construction ; 合 fusion et combos.
- **Actions** : pictogrammes SVG en trait de 2 px à bouts ronds, `currentColor`, cadre 20 : ↶ annuler, ↺ recommencer, ⌂ quitter, ‹ retour, haut-parleur (son), croche (musique), étincelle (effets), deux curseurs (réglages), cadenas (avec 封). ❙❙ pause (barres CSS existantes). Vitesse en texte « ×1 / ×2 ».
- **Kanji seuls interdits** : 戻 → « ‹ Accueil » ; 音 → haut-parleur ; 封 → cadenas + « Scellé » ; 巻 au repos → pourcentage ; priorités 先 後 強 近 toujours suivies du mot.
- **Niveau d'une lanterne** : sceau 壱 / 弐 / 参 or clair sur encre, incliné de −3°, `aria-label="Niveau 1"`, à la place de la pastille « N1 ».

### 5.5 Matières

| Matière | Règle |
|---|---|
| Washi | grandes surfaces (feuilles, boîte à lanternes, boutons crème). Jamais directement sous un texte < 15 px : aplat ≥ 85 % entre les deux. **HUD : indigo uni** (sans washi). |
| Ombre de registre | `--sh-1` / `--sh-2` pour tout ce qui se presse ; pressé = enfoncé de 2 px, ombre réduite à 1 px (un tampon qu'on appuie). |
| Flottant | `--sh-float` seulement : barre d'actions, couloir, bulles, carte de résultat. `--sh-sheet` : feuilles. |
| Bords | bord déchiré `--edge` sous le HUD et au-dessus du bas (existant). Séparateurs de sections des feuilles : trait de pinceau `--stroke-ink` (opacité 0,45, hauteur 8) ou filet 1 px encre 16 %, un par section. |
| Kirikane (filet d'or) | 1,5 à 3 px or = « choisi, actif, opportunité » : onglet choisi, Fusionner, climax, jumelles. |
| Sceaux | inclinés de −2 à −4°, liseré intérieur crème 40 % ; tailles 18 / 24 / 32 / 44 / 56+. Vermillon = action, vie ; indigo = information ; or = or, défi ; encre = Difficile. |
| Interdits | `backdrop-filter`, verre, dégradés « numériques ». `.rewind-fill` devient un aplat `#9db8ff` à 55 % terminé par un trait de pinceau. |

### 5.6 Composants et états

**État pressé commun** (nouveau `src/ui/press.js`, lot GAME) : un écouteur `pointerdown` en capture sur `document` ajoute `.is-pressed` à `button, .tool, .ptab, .wchip, [data-press]` (sauf `.disabled`) et le retire au `pointerup`, `pointercancel`, `pointerleave`. On ne dépend pas de `:active` sur iOS. Pressé : immédiat, `translateY(2px)`, ombre 1 px, fond assombri ~6 %, `box-shadow: …, var(--glow-press)` ; relâché : 140 ms `--e-spring`. L'ondulation d'encre existante (`ripple`) passe de 480 à 360 ms et à opacité 0,18 sur fond sombre.

**Confirmation en deux temps** (`armConfirm(el, { label, run })`, même fichier) : 1er toucher → fond `--vermillion-ui`, libellé « Confirmer… » (ou celui donné), anneau or qui se vide en 2,6 s (`CONFIRM_MS` existant) ; 2e toucher → exécute ; sinon retour à l'état initial. Emplois : Vendre, Recommencer, Quitter, Quitter le salon, Rembobiner au toucher.

| Composant | Mesures | Repos | Pressé | Désactivé / spécial |
|---|---|---|---|---|
| Bouton primaire | L 56 / M 48, rayon 14, bord encre 2 | fond `--vermillion-ui`, texte crème 16–18/700, `--sh-2` | commun ; fond `--vermillion-dark` | opacité 0,45, ombre 1 px, sans lueur. **Un seul primaire par écran.** |
| Secondaire | M 48 / S 44 | crème washi, texte encre, bord encre 2, `--sh-2` | fond crème-2 | variante sombre (indigo, texte crème) : « À plusieurs » |
| Discret (contour) | M 48 / S 44 | sans fond, bord encre 1,5 à 45 %, sans ombre | fond encre 6 % | porte la confirmation en deux temps |
| Texte | 44 de haut | souligné 1,5 px à 4 px sous le texte | opacité 0,6 | « Carte » des résultats |
| Héros (accueil) | 64, rayon 32 | primaire ; sceau 遊 44 à gauche ; libellé hero 24 + sous-ligne 13/700 | commun | un seul |
| Bouton icône | cible 44×44 ; boîte visible 40×32 sur sombre | trait crème 32 % | fond crème 24 %, `scale(.94)` | actif (`.on`) : fond or vif, picto encre |
| Capsule du temps | 88×36 (2 cibles de 44) | trait crème 32 %, séparateur 1 px | par moitié | ×2 actif : moitié gauche or vif, texte encre ; invité : « ×2 » sans cadre, inactif |
| Interrupteur | 50×30, bord encre 2 | éteint : crème-3, rond encre ; allumé : `--moss-ui`, rond crème | — | toute la ligne de 48 est la cible ; libellé à gauche |
| Contrôle segmenté | 34 (32 petits écrans), zone tactile étendue de 6 px vers le haut par `::before` | inactif : crème 8 %, bord crème 28 %, texte crème 14/700 | commun | actif : crème washi, bord encre 2, soudé à la boîte (sans bord bas) ; losange vermillon si l'outil choisi est dans un autre onglet (existant) |
| Carte de lanterne (groupée) | ≈ 102×62 (≈ 102×52 petits écrans) | dessin 40 en haut à gauche, coût 13/700 + pièce en haut à droite, rôle 12/700 `--ink-2` sous le coût, nom court 14/700 en bas à gauche | fond crème-2, dessin −1 px | choisie : fond #f6dc8c, anneau intérieur vermillon 2,5, `translateY(-2px)` 120 ms ; trop chère : fond crème-3, dessin 45 %, coût `--vermillion-dark`, toucher → « Il manque 15 or » écrit au-dessus ; défi épuisé : grisée sans rouge |
| Pierre épinglée | 56×96 (56×84) | ardoise `--slate` washi, galet 40, « Pierre » 13/700, « ◉10 » 12/700, compteur « 8/8 » 12/700 sur indigo en haut à droite | commun | « 0/8 » sur `--vermillion-ui` ; choisie : comme une carte |
| Puce de yokai (aperçu) | 44×44, rayon 10, `--sh-1` | portrait 38, compteur 12/700 sur pastille encre en bas à droite | commun | boss : anneau intérieur vermillon ; climax : anneau or ; nouveau : étiquette « nouveau » 12/700 crème sur `--vermillion-ui` au-dessus ; « +N » : puce texte « +N » + « yokai » 12 dessous |
| Compteur du HUD | pastille 32 de haut, rayon 10, fond `rgba(10,14,26,.32)`, filet crème 14 % | sceau 24 + nombre counter 20 en cases | — | gain : `scale(1.12)` 120 ms `--e-spring`, nombre or vif 280 ms ; perte de vie : `hurt` 260 ms (existant) + fond `--vermillion-ui` 200 ms ; vies ≤ 25 % : #ff8a6e + sceau qui bat (existant) |
| Feuille du bas | rayon 20 en haut, bord haut encre 2, `--sh-sheet`, poignée 36×5 à 8 px du haut, en-tête ≥ 52 (sceau 32 ou image 48, titre h2, ✕ 44) | crème washi | — | moyenne / grande ; modale (voile, hors partie) ou non modale (sans voile, en partie) : §6.9 |
| Barre d'actions | fond encre, rayon 14, cadre 6, écart 6, boutons 64×52 (sceau 22 + libellé 13/700), flèche 12 | — | commun | confirmation : vermillon ; actif : or (mur du Gardien) |
| Couloir de messages | hauteur ≥ 36, ≤ 2 lignes, rayon 10, fond encre, filet or 60 %, `--sh-float` | icône 28 à gauche, texte 15/700 crème, détail 13/500 `--on-dark-2`, « › » or si un toucher ouvre quelque chose | commun si touchable | §6.4 |
| Bulle de refus | rayon 10, fond `--vermillion-ui`, bord encre 2, queue vers le socle | texte 14/700 crème | — | §6.4 |

### 5.7 Mouvement

| Usage | Durée | Courbe |
|---|---|---|
| pressé / relâché | 0 / 140 ms | — / `--e-spring` |
| choix d'une carte, d'un onglet | 120–160 ms | `--e-out` |
| couloir : entrée / sortie / remplacement | 200 / 140 / 120 ms | `--e-emph` / `--e-in` / fondu |
| feuille : ouverture / fermeture / retour en place | 280 / 200 / 200 ms | `--e-emph` / `--e-in` / `--e-spring` |
| barre d'actions : entrée / sortie | 160 / 100 ms | `--e-emph` (échelle 0,9 → 1) / `--e-in` |
| chiffre de vague qui roule | 240 ms | `--e-out` |
| vol de pièces | 480 ms, 45 ms d'écart | `--e-in` |
| sceau qui se tamponne | 220–420 ms | `--e-spring` |

---

## 6. Écrans

Repère : iPhone 14/15/16e 390×844, encoche. **Coordonnées d'écran** : la barre d'état iOS (0–47) est peinte par iOS en #1f2f4f ; la page commence à y = 47 (y = 0 de la page) ; l'indicateur d'accueil occupe 810–844 (`--sab` = 34) : fond seulement, rien de touchable. Sur iPhone à Dynamic Island (393×852), la barre fait 59 et la page 793.

### 6.1 Gabarit de la partie

`case = floor(min(largeur / 9, scène / 13))` (`renderer.layout`). Scène = page − `--sab` − HUD − bas.

| Appareil | Page (H − barre) | `--sab` | HUD | Bas | Scène | Case (auj.) |
|---|---|---|---|---|---|---|
| SE 375×667 | 647 | 0 | 44 | 142 | 461 | **35** (32) |
| 12–16e 390×844 | 797 | 34 | 44 | 156 | 563 | **43** (40) |
| 14 Pro–16 393×852 | 793 | 34 | 44 | 156 | 559 | **43** (40) |
| 16 Pro–17 Pro 402×874 | 812 | 34 | 44 | 156 | 578 | **44** (41) |
| Pro Max 430×932 | 873 | 34 | 44 | 156 | 639 | **47** largeur (46) |
| 16/17 Pro Max 440×956 | 894 | 34 | 44 | 156 | 660 | **48** largeur |
| Ancienne installation 393×852 (`--sat` 99) | 852 | 34 | 44 | 156 | 519 | 39 (dégradé accepté, invitation) |

Le gabarit est **le même** pour la palette groupée, la palette simple et la coop (les coéquipiers prennent la place des onglets).

### 6.2 Partie : vue d'ensemble (solo, palette groupée, pendant une vague)

```
  y   ┌──────────────────────────────────────────────┐
   0  │ 9:41            ▀▀ encoche ▀▀       ▮▮▮ ◔ ▭  │ barre d'état iOS opaque #1f2f4f (rien à nous)
  47  ├──────────────────────────────────────────────┤ ← y = 0 de la page
      │[命 20][金 1820][−60]   VAGUE 難   [ ×1 │ ❙❙ ]│ HUD 44, indigo uni (§6.3)
      │                        3/14                  │
      │                        ▬▬▬▬▭▭▭▭              │
  91  ├≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈┤ bord déchiré (décor existant)
      │ (S)   ╭(霧) Vapeur : yokai aveuglés  ›╮      │ couloir de messages, transitoire (§6.4)
      │       ╰───────────────────────────────╯      │
      │      ┌[先 Premier▾][合 Fusionner][札 Fiche][◉ +35]┐ barre d'actions, près de sa lanterne (§6.8)
      │      └────────▼─────────────────────────────┘│
      │            (lanterne)                        │
      │          PLATEAU 9 × 13, case 43             │ #stage 91–654 (563) ; plateau 387 × 559
      │                                              │
      │                                  (G)         │
 654  ├≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈┤
 658  │(巻)      [kodama 12][kamaitachi 6]((18) Vague 4)│ rangée d'action 46 (§6.5)
      │ 42%           nouveau            ◉ +12       │
 704  │                                              │
 710  │╭▲ Feu─╮ ● Eau   ◆ Vent   ■ Terre  ┌─────────┐ │ onglets 34 (4 × 74) │ pierre épinglée 56 × 96
 744  │┘      └───────────────────────────┐│  8/8    │ │
      ││[ic] ◉50 │[ic] ◉70  │[ic] ◉60     ││  (石)   │ │ boîte 310 × 62, 3 cartes ≈ 102
      ││   Dégâts│     Zone │     Aura    ││ Pierre  │ │
      ││Brasero  │Mortier   │Follets      ││  ◉10    │ │
 806  │└──────────────────────────────────┘└─────────┘ │
 810  ├──────────────────────────────────────────────┤
      │                  ▬▬▬▬▬▬                      │ indicateur d'accueil 34, indigo
 844  └──────────────────────────────────────────────┘
```

Bas (654–810) : 4 (marge) + 46 (rangée d'action 658–704) + 6 + 34 (onglets 710–744) + 62 (cartes 744–806) + 4. Gouttière 8 px.

**Règle du plateau.** Rien de permanent ne le recouvre. Y apparaissent seulement, de façon transitoire : la barre d'actions, le couloir, une bulle (tutoriel ou refus), la barre de boss (en haut, 28 px), l'écran de dernière chance, la carte d'attente coop. **Quittent le plateau** : `#toast` (en partie), `#btn-undo` flottant, `#intro` (carte « Nouveau yokai »), la bannière des vagues ordinaires.

### 6.3 HUD du haut (44 px)

```
x   8        70 76            160 164    208 214          286 294            382
    [(命) 20 ]  [(金) 1 8 2 0 ]  [ −60  ]    VAGUE (難)       [  ×1  │  ❙❙  ]
     pastille     pastille         case        3/14              capsule 88 × 36
     62 × 32      84 × 32          44          ▬▬▬▬▬▭▭▭ 64×3       (2 cibles 44)
                                               ↑ trait vermillon 3×7 au climax annoncé
```

- Fond **indigo uni** ; grille à positions fixes ; rien ne glisse quand l'or change de nombre de chiffres ou que « −60 » apparaît.
- Vies : sceau 命 24 + chiffres en cases. Or : sceau 金 24 + 4 cases (largeur minimale ; un 5e chiffre élargit vers la droite dans la case réservée). Or réservé : pastille 13/700 encre dans une **case réservée de 44**, toujours présente, invisible à 0.
- Bloc vague : « VAGUE » micro 12 `--on-dark-2` ; « 3/14 » counter 20 (Zen 700, « /14 » `--on-dark-2`) ; barre 64×3 (fond crème 22 %, avancée or vif, repère vermillon de 3×7 à la position du climax) ; mode Difficile : sceau 難 de 16 après « VAGUE » (remplace « · 難 »).
- Capsule du temps : « ×1 »/« ×2 » 15/700 à gauche, ❙❙ à droite.
- 375 px : écarts 6, barre 52, capsule 84. Vérifier avec or à 4 chiffres + « −60 ».
- Début de vague : le chiffre **roule** (l'ancien monte et s'efface, le nouveau arrive d'en dessous, 240 ms `--e-out`) et un segment de barre se remplit (300 ms). Pas de bannière.

### 6.4 Plateau : couloir de messages, bulles, bannières

**Couloir** (nouveau `#lane` dans `#stage`, module `src/ui/lane.js`) :
- Placement (`placeLane()`, même méthode que `placeIntro`) : candidats dans l'ordre haut centré (`top: 10`, ou bas de la barre de boss + 6), haut à gauche (12), haut à droite (12), bas centré (`bottom: 10`) ; on garde le premier qui ne recoupe ni une case S ou G (marge 6), ni la barre d'actions, ni la bulle du tutoriel.
- Largeur maximale `min(340px, 100% − 24px)` ; ≤ 2 lignes ; jamais de point de suspension (le texte est écrit court).
- File à priorités, **un seul message visible**, dédoublonné par clé, 3 en attente au plus (on jette le plus ancien) :

| Priorité | Exemples | Durée |
|---|---|---|
| 3 consigne | tutoriel « Choisissez une lanterne », « Touchez la jumelle à absorber » | jusqu'à ce que l'action soit faite |
| 2 alerte | boss en rage, coéquipier déconnecté, l'hôte est parti | `clamp(2500, 1200 + 60 × car., 6000)` ms ; un état réseau reste tant qu'il dure |
| 1 nouveauté | nouveau yokai (portrait, toucher = fiche), premier combo du niveau (kanji du combo, toucher = combos), règle des socles réservés (une fois), « Aki appelle la vague 6 · +8 ◉ » | idem |
| 0 info | écho, « Plus de pierres : touchez-en une pour la retirer », « La vitesse est réglée par l'hôte » | idem |

- Une priorité plus haute préempte. Pendant un moment fort (§7.3) ou une bulle du tutoriel, les priorités 0–1 attendent.
- `aria-live="polite"` (`assertive` pour la priorité 2). Toucher : ouvre l'action liée, ou ferme le message.
- `hud.toast(msg, bad, ms)` garde sa signature et route vers le couloir (priorité 0, ou 2 si `bad`) ; le `ms` par défaut (1600) est remplacé par la règle de durée. `appToast()` en partie passe donc aussi par le couloir.

**Bulles de refus** (`input.flash` existant, restylé) : au-dessus du socle visé (dessous sur la rangée 0), texte 14/700 crème sur `--vermillion-ui`, queue vers le socle ; durée `clamp(2200, 1000 + 50 × car., 5000)` ms ; secousse de 300 ms et son `reject` existants. **Plus aucun refus dans un toast** : « ● Socle réservé à l'Eau », « Trop tard pour annuler », « Il manque 15 or ».

**Bannière au grand pinceau** (existante, 1,8 s au lieu de 2,1, à 30 % de la scène) : seulement titre du niveau, climax, boss, dernière vague, victoire, défaite.

**Barre de boss** (existante) : en haut du plateau ; le couloir se place dessous.

### 6.5 Rangée d'action (46 px)

```
x 8     54 62                          226 234                         382
  ( 巻 )    ·····  [puce 44][puce 44][puce 44]  (( 18 )  Vague 4          )
  42 %                                          (      )  ◉ +12           )
  jauge 46     aperçu (flex, aligné à droite)    bouton de vague 148 × 46
```

Ordre : **jauge, aperçu, bouton**. L'aperçu est collé au bouton : ses puces sont le contenu de la prochaine vague (plus besoin du libellé « Prochaine vague », gardé en `aria-label`). Le nombre de puces dépend de la largeur restante (`WavePreview.resize`) ; « +N » ouvre la liste.

**Bouton de vague** (largeur fixe `--wave-w` : 148, 136 en petit écran) : pilule `--vermillion-ui`, bord encre 2, `--sh-2` ; cadran 38 (34 en petit écran) à 4 px du bord gauche ; libellé h3 18 (16 en petit écran, « Vague 14 » = 84,6 px pour 86 disponibles) ; sous-ligne caption 13/700.

| État | Cadran | Libellé | Sous-ligne |
|---|---|---|---|
| Avant la 1re vague | 波 ; anneau or qui pulse si une lanterne est posée (existant) | « Vague 1 » | « Lancer » |
| Compte à rebours > 5 s | **secondes** (16/700 en cases) dans un anneau or conique qui se vide (`--k` = temps restant ÷ pause) | « Vague N » | « ◉ +12 » (prime d'appel anticipé) |
| ≤ 5 s | idem, le cadran bat (`sealBeat` 0,9 s, existant) | | |
| Climax suivant | secondes ; filet or 3 px autour du bouton | « Climax » | « ◉ +X » |
| Dernière vague en cours | 波, désactivé (indigo-2, crème 82 %) | « Vague N » | « dernière » |

Disparaît : la sous-ligne « 13 s · +12 or · +39 巻 » en 12 px. Double toucher filtré à 350 ms (existant).

**Jauge 巻** (disque `--gauge-d` 46) :

| État | Apparence | Toucher | Appui long |
|---|---|---|---|
| Se remplit | anneau or = charge ; **arc fantôme** or 45 % en pointillés = ce que rapporterait un appel anticipé maintenant (`earlyCharge()` existe) ; pourcentage 12/700 en cases sous le kanji | « 42 % : se remplit en apaisant des yokai » écrit près du doigt | fiche « Rembobinage » (existante) |
| Pleine, hors vague | anneau plein, lueur (existant) | « Pleine : utilisable pendant une vague » | idem |
| **Prête** | s'allonge en **piste de 130 px** (x 8–138), poignée 38 à droite, flèches ◀◀ ; une pulsation toutes les 4 s ; **le bouton de vague ne bouge pas**, l'aperçu perd des puces (1 puce + « +N » en 390) | **double toucher** : 1er → piste vermillon, libellé « Encore : −6 s », anneau de 2,6 s ; 2e → Rembobinage | idem |
| Glisser (habitués) | poignée vers la gauche, déclenchement à 55 % de la course (existant) | | |
| Dernière chance | la rangée entière devient la piste (x 8–382), poignée à droite avec le compte « 4 » ; **un toucher sur la poignée rembobine aussitôt** (seule issue) ; le reste de l'interface est grisé, carte « Rembobinez ! » et sa flèche conservées | | |

**Annuler** : pendant la fenêtre d'annulation (2 s de construction + 3 s), une pilule remplace l'aperçu (x 62–226, 164 × 46) : cadran ↶ 34 qui se vide en même temps que l'anneau de construction du socle (hachuré pendant la construction, existant), « Annuler » 16/700, sous-ligne 12/700 `--on-dark-2` « gratuit » (construction) ou « or rendu » (après) ; fond encre, bord or vif 2. Entrée glissée depuis la gauche, 180 ms `--e-emph`. **La place ne change jamais** : `placeUndo()` est supprimée. Pendant cette fenêtre, une jauge prête reste un disque or (le double toucher marche, le glisser non).

### 6.6 Palette

**Groupée** (§6.2) : onglets en contrôle segmenté de 34 (4 × 74, écart 4) soudés à une **boîte à lanternes** unique (crème washi, bord encre 2, rayon 0 12 12 12, `--sh-2`, cases séparées par des tirets d'encre 1,5 px à 35 %). Changement d'onglet : fondu enchaîné + glissé de 8 px dans le sens de l'onglet, 160 ms, son `select`.

**Simple** (1-1, 1-2) : pas d'onglets ; 4 cartes de ≈ 89 × 96 (la boîte occupe onglets + cartes) : badge d'élément 20 + mot en haut à gauche, dessin 48, coût en haut à droite, nom 15/700 en bas. Pierre épinglée si le niveau en a.

**Coop** : la rangée d'équipe remplace les onglets (même hauteur 34).

```
 710 │┌[水 Vous]┐[風 Aki ◉212][火 Botan ◉96][土 Kei ⚠]│  4 puces ; la mienne soudée à la boîte
 744 │┘        └────────────┬─────────────┬────────┐   sceau 18 + nom 12/700 + or 12/700 en cases
     ││[Fontaine] ◉45 │[Source] ◉55 │[Torrent] ◉65  │   mes 3 lanternes (+ pierre si je suis la Terre)
 806 │└──────────────┴──────────────┴──────────────┘
```

- Ma puce : « Vous » seulement (mon or est dans le HUD). Absent : opacité 0,55, « hors ligne » au lieu de l'or. Hôte : petit sceau 主 14.
- La pose d'un coéquipier fait clignoter son sceau (1 pulsation, 200 ms) ; son or roule sans vol de pièces.
- `#coop-roster` sous le HUD disparaît (≈ 25 px rendus au plateau).

### 6.7 Pose et construction

**Socle d'abord** (nouveau, le parcours carte → socle reste) : toucher un socle libre sans outil le sélectionne (anneau **or** pulsé) ; s'il est réservé, la palette bascule sur l'onglet de son élément et grise les cartes interdites ; consigne « Choisissez une lanterne » (priorité 3) ; toucher une carte **pose aussitôt** sur ce socle ; toucher ailleurs annule. Socle réservé d'un autre élément : 2 touchers au lieu de 3.

**Déroulé d'une pose** :

| t | Visuel | Son |
|---|---|---|
| doigt levé | le fantôme (60 px au-dessus du doigt, existant) **tombe** sur le socle (90 ms `--e-in`) puis s'écrase et revient (`scaleY .88 / scaleX 1.08`, 160 ms `--e-spring`) ; anneau d'encre 280 ms ; « −50 » apparaît dans sa case ; l'or roule | **nouveau `build`** : `stoneKnock` (vél. 0,12, vitesse 1,1) + `bamboo` à +40 ms (0,09 ; 1,25), pour ses propres poses (`case 'pending'` dans `handleEvents`, `ev.entry.pid === localPlayer`) |
| 0 → 2 s | échafaudage, encre qui monte, sceau 建 (existants) ; anneau de construction linéaire synchrone avec le cadran ↶ ; petit ↶ or 14 au coin du socle | silence (*ma*) |
| 2 s | la lanterne s'allume : `scale 1 → 1.08 → 1` 260 ms + halo ; « −50 » s'efface | `place` existant + `bell(nf(12), 0.06, 0.08, 1.6)` ; coéquipier à 50 % |
| Annuler | fumée (fx `cancel`, existant) ; l'or remonte en roulant | **nouveau `undo`** : koto `nf(7)` puis `nf(5)` à +70 ms, vél. 0,13 |

Aimantation : `towerNear` passe de `max(22, 0,5 case)` à `max(24, 0,6 case)` (lanterne touchable sur SE).

### 6.8 Sélection : barre d'actions

```
            ┌────────┬──────────┬────────┬──────────┐
            │ [先]   │ [合]     │ [札]   │ [◉]      │   boutons 64 × 52, fond encre, rayon 14
            │Premier▾│Fusionner │ Fiche  │Vendre +35│   libellés 13/700 ; largeur ≤ 286
            └────────┴────┬─────┴────────┴──────────┘
                          ◆ flèche 12 vers la lanterne
« Premier ▾ » → la barre se replie en :
            [先 Premier][後 Dernier][強 Fort][近 Proche]    priorité courante en or ; un toucher règle et ferme
```

- **Placement** (`towerbar.js` `place()`) : au-dessus ou au-dessous, décalée horizontalement dans le plateau ; on choisit la position qui couvre le moins de **cases de chemin** (poids 2) et de lanternes (poids 1), sans jamais couvrir la lanterne choisie.
- **Fermeture** : après chaque action (sauf ouvrir « Priorité ▾ »), toucher ailleurs, ouverture d'une fiche, et **6 s sans geste** (suspendu pendant une vente armée ou le choix de priorité).
- **Fusionner** : visible seulement si une jumelle existe (même lanterne, même niveau) ; fond or clair et filet = opportunité. Toucher → la barre se ferme, les jumelles reçoivent un anneau or pulsé, la lanterne choisie une aura, consigne « 合 Touchez la jumelle à absorber » ; toucher une jumelle → fusion (avec l'aperçu des combos perdus et gardés, existant pour le glisser) ; toucher ailleurs annule. Le glisser reste le raccourci. Indice passif : sceau 合 de 14 px à 70 %, statique, au coin de deux lanternes posées fusionnables (`overlay.js`).
- **Priorité** : 4 choix visibles, 3 touchers prévisibles au lieu de 2 à 4 à l'aveugle (`setPriority` avec la valeur choisie) ; retour existant (anneau or, « Cible : … »).
- **Vendre** : contour, confirmation en deux temps (existant).
- Entrée 160 ms (échelle 0,9 → 1 depuis l'ancrage), sortie 100 ms.

### 6.9 Feuilles et fiches

**Mécanique commune** (nouveau `src/ui/sheet.js`, lot GAME, utilisée par `#info` et par `showModal`) :
- Hauteurs : **moyenne** = hauteur du contenu, plafonnée à 56 % de la page (446 px en 797) ; **grande** = jusqu'à 8 px sous le HUD en partie (page y 52), 56 px sous la barre d'état hors partie.
- Glisser : seules la poignée et l'en-tête (52 px du haut) lancent le glisser (le corps défile normalement). La feuille suit le doigt 1:1 vers le bas ; vers le haut, résistance ×0,3 au-delà de la grande hauteur. Relâché : fermeture si déplacement > 25 % de la hauteur ou vitesse > 0,5 px/ms vers le bas ; passage en grande si tiré de > 60 px vers le haut ou vitesse > 0,5 px/ms vers le haut ; sinon retour 200 ms `--e-spring`. Le ✕ reste.
- Modale hors partie (fiche de niveau, salon, réglages) : voile `--veil`, toucher le voile ferme. Non modale en partie (fiches, pause) : sans voile, le plateau reste visible et touchable.
- Une seule feuille à la fois (existant). Entre deux vagues, une fiche ouverte suspend le compte à rebours (B12, existant). Variante haute `.sheet.top` (existante) quand le sujet est dans la moitié basse du plateau.

**Fiche de lanterne** (moyenne, 390×844, ≈ 440 px avec la zone sûre) :

```
 404 ╭──────────────────────── ▬ ──────────────────────────╮ poignée 36×5
     │[image 48] Brasero (h2 22)                 [壱] (✕)   │ sceau de niveau 30 ; ✕ 44
     │           ▲ Feu · Dégâts (13/700)                    │
     │ ┌FORCE──────────────────┐┌FAIBLESSE──────────────┐   │ 2 tuiles, texte 14/500,
     │ │Gros dégâts sur une    ││Petits coups au N1 ;   │   │ légendes micro 12
     │ │cible ; brûlure        ││soigne les kitsune     │   │ (filet mousse / vermillon)
     │ └───────────────────────┘└───────────────────────┘   │
     │ [Dégâts 14][Cadence 1,1/s][DPS 20][Portée 2,3]      │ 4 tuiles 46 : légende 12 --ink-2, valeur 17/700 en cases
     │ Combos : (● Vapeur) (◆ Tornade) (■ Magma)            │ puces 13/700 : toucher = détail du combo
     │ ┌[合] Fusionner avec sa jumelle                   › ┐│ si jumelle : primaire or clair,
     │ │     弐 : DPS 20 → 46 · portée 2,6                  ││ gain chiffré
     │ └────────────────────────────────────────────────────┘│
     │ ┌[先] Cible : Premier ▾┐      ┌ Vendre ◉ +35 ┐        │ actions M 48 collées en bas
     │          Détails : évolution, cibles, armure ⌃        │ 13/700 → hauteur grande
 810 ╰───────────────────────────────────────────────────────╯
```

**Modèle commun** (lanterne posée, type de la palette, yokai, élément, pierre) : 1) en-tête ; 2) Force / Faiblesse (et Contres pour un yokai) ; 3) 4 chiffres ; 4) action principale (Fusionner ; « Choisir · ◉ 50 » pour un type ; barre de PV pour un yokai suivi) ; 5) action secondaire ; 6) « Détails ⌃ » → grande hauteur : évolution N2/N3, cibles, armure, vente, description, séparés par un trait de pinceau. Plus de ligne « Niveau 2 » coupée. Le sceau 壱/弐/参 se tamponne (360 ms) quand la lanterne affichée fusionne (`Sheets.onEvent('fuse')` existe).

### 6.10 Pause (feuille non modale)

```
 412 ╭──────────────────────── ▬ ──────────────────────────╮
     │[休] Pause (h2 22)                                     │ sceau 32 incliné
     │     Le Dernier Torii · vague 3/14 (13)   [難 Difficile]│ marques du mode (existantes)
     │ ┌──────────────────────────────────────────────────┐ │
     │ │                 ▶  Reprendre                      │ │ primaire L 56, seul plein
     │ └──────────────────────────────────────────────────┘ │
     │ ┌[合] Combos 3/6 ───────┐ ┌[学] Aide ──────────────┐  │ secondaires M 48 (Aide : P2)
     │ ┌──────────┐┌──────────┐┌──────────┐┌──────────┐     │ réglages rapides 80 × 56 :
     │ │ haut-p.  ││ croche   ││ étincelle││ curseurs │     │ picto 20 + libellé 12 ;
     │ │   Son    ││ Musique  ││  Effets  ││ Réglages │     │ état : fond or si actif
     │ └──────────┘└──────────┘└──────────┘└──────────┘     │
     │ ~~~~~~~~~~~~~~~~~ trait de pinceau ~~~~~~~~~~~~~~~~~ │
     │   [↺ Recommencer]              [⌂ Quitter la partie] │ discrets 44, confirmation en deux temps
     │   Un second toucher confirme : la partie sera perdue. │ 13/500 --ink-2
 810 ╰───────────────────────────────────────────────────────╯
```

- Hôte en coop : « ↺ Recommencer pour tous », « ⌂ Quitter (fin pour tous) », note « Partie en pause pour tous les joueurs ».
- Invité : titre « Menu », sceau 間, note « La partie continue : seul l'hôte peut la mettre en pause », la ligne destructive devient « Quitter le salon » (confirmé).
- « Effets » bascule Complets / Sobres (§7.4). « Réglages » ouvre la feuille Réglages du lot MENUS (contrat `openSettings()`).
- Débogage (si activé, solo) : bouton texte en bas.

### 6.11 Combos (grande hauteur, depuis la pause ou une puce de combo)

```
 99  ╭──────────────────────── ▬ ──────────────────────────╮
     │[‹ Pause]  [合] Combos · 3/6                     (✕)  │ retour 44 ; h2
     │           Deux éléments différents côte à côte       │ 15/500 --ink-2
     │           (diagonale comprise)                       │
     │ ▲+●  霧 Vapeur                        [actif ×2]     │ lignes ≥ 56 : paire de badges 56 |
     │      Aveugle : plus de soins, de sauts ni d'absorption│ kanji + nom h3 | effet 14/500 |
     │      Contre : Kitsune, Yuki-onna, Kasa-obake         │ « Contre » 13/500 --ink-2
     │ ▲+◆  炎嵐 Tornade de flammes …                       │ actif sur le plateau : fond or 28 %
     │ ▲+■  熔 Magma …                                      │ + puce « actif ×N » (--moss-ui)
     │ ●+◆  氷 Givre …                                      │ élément absent du niveau : ligne à 50 %,
     │ ●+■  泥 Boue …                                       │ « absent du niveau »
     │ ◆+■  砂 Tempête de sable …                           │
     │ ┌────────────────── ▶ Reprendre ─────────────────┐   │ primaire collé en bas
 810 ╰───────────────────────────────────────────────────────╯
```

La matrice 4×4 devient une liste de 6. Ouverte depuis une puce de combo, la feuille défile jusqu'à la ligne concernée. Noms unifiés « Yuki-onna », « Kasa-obake » (`data/combos.js`).

### 6.12 Victoire et défaite

```
 190 ┌──────────────── carte 358 (x 16–374) ────────────────┐  plateau visible ; HUD et bas à 60 %
     │                       [勝] 44                         │  tampon 420 ms --e-spring (existant)
     │                   Victoire ! (h1 28)                  │
     │                 2-3 · Le Ciel de fer (13)             │
     │               ★       ★(66)       ☆                   │  étoiles 54/66/54 frappées toutes les 380 ms
     │   Vies 17/20     Yokai 214     Lanternes 11          │  15/500, valeurs 700 en cases, comptées en 600 ms
     │          [難] Difficile s'ouvre à 3 ★                 │  puce si pertinent
     │ ┌ Suivant ─────────────── 2-4 · Le Dernier Torii › ┐ │  primaire L 56 (seul vermillon)
     │ ┌─ Rejouer ─────────┐               Carte            │  secondaire M | texte souligné
     └───────────────────────────────────────────────────────┘
```

- Boutons inactifs pendant **700 ms** après l'apparition (contre les touchers involontaires) ; un toucher sur la carte saute à la fin des animations.
- Dernier niveau : le primaire devient « Carte ». Hôte coop : « Salon ». « Carte » appelle `showScreen('map', { justCleared: id })` (contrat §9.4).
- **Défaite** : sceau 敗 indigo, « Le sanctuaire est tombé », « Vague 9/14 » ; primaire « Réessayer », texte « Carte ». P2 : un conseil tiré de la cause des fuites (« 8 fuites de kitsune de feu : ils absorbent le Feu, essayez l'Eau »).

### 6.13 Dernière chance et attente coop

Conservées (l'audit les juge très lisibles). La flèche vise la poignée dans la rangée de 46 (`placeLastChanceArrow`) ; la poignée se touche (§6.5). `#coop-wait` garde sa carte centrale (état bloquant).

### 6.14 Tutoriel

- Bulles **ancrées près de leur cible** (`.hint` : Zen 15/700, ≤ 2 lignes, fond crème, bord encre 2, `--sh-float`), qui **restent jusqu'à ce que l'action soit faite**. Une seule à la fois ; les messages 0–1 du couloir attendent.
- Repère pulsé sur la cible (carte, socle conseillé) ; pas de voile.
- La règle des socles réservés entre dans la bulle de pose : « Touchez un socle lisse, ou réservé ▲ » ; le message séparé « 刻 Socles gravés ▲ ● ◆ ■… » disparaît.
- La leçon « appel anticipé » n'est proposée qu'**après la fin de la vague 1**.
- L'anneau du doigt ne couvre ni l'outil ni le texte du bouton de vague (audit m2) : décalé de 8 px vers l'extérieur.

### 6.15 Accueil

```
   0 ┌──────────────────────────────────────────────┐
     │ 9:41             ▀▀ encoche ▀▀      ▮▮▮ ◔ ▭  │ barre opaque ; le ciel part de #1f2f4f opaque
  47 ├──────────────────────────────────────────────┤
  55 │                          [haut-p.] [curseurs]│ boutons icône 44 : x 286–330, 334–378
 113 │              ── 精 霊 の 庭 ──                │ Mincho 17, crème
     │                 Jardin                       │ display (≤ 52)
     │              des Esprits                     │
     │              ━━━━━━━━━━━━                    │ trait vermillon (existant)
     │         Allumez les lanternes,               │ Mincho 700 16
     │         protégez le sanctuaire.              │
     │      (Fuji, soleil, torii, lanternes,        │ l'illustration respire : plus de
     │       allée : la scène peinte visible)       │ panneau de salon par-dessus
 614 │ ┌──────────────────────────────────────────┐ │ zone d'annonce 48 (une seule à la fois) :
     │ │ Haut de l'écran flou ?  Corrigez-le    › │ │ invitation (§6.20), « Aki a rejoint votre
 662 │ └──────────────────────────────────────────┘ │ salon », ou ligne Safari « Partager ▸ Sur l'écran d'accueil »
 670 │ ╭──────────────────────────────────────────╮ │ héros 64 (x 16–374)
     │ │(遊)  Continuer                      (24) │ │
     │ │      2-3 · Le Ciel de fer           (13) │ │
 734 │ ╰──────────────────────────────────────────╯ │
 746 │ ┌────────────────────┐ ┌────────────────────┐│ secondaires 48, écart 12
     │ │      Niveaux       │ │(人) À plusieurs (2)││ « À plusieurs » sombre ; (2) = joueurs présents
 794 │ └────────────────────┘ └────────────────────┘│
 810 ├──────────────────────────────────────────────┤
 844 └──────────────────────────────────────────────┘
```

- **Héros** : premier lancement (aucune étoile) → « Jouer » + « 1-1 · Le Seuil », lance 1-1 directement (ni carte ni fiche). Ensuite → « Continuer » + prochain niveau non gagné, lancé tout de suite en mode normal (1 toucher au lieu de 3). Tous gagnés → « Choisir un niveau » (ouvre la carte) et « Niveaux » se cache.
- **Hôte avec invités** : rangée de sceaux des joueurs (32) au-dessus du héros ; le héros devient « Jouer à 2 · Choisir le niveau » et ouvre la carte.
- **Invité** : le héros est remplacé par la carte d'attente `#title-wait` (64) ; « Niveaux » caché ; « À plusieurs » devient « Salon » (ouvre la feuille avec « Quitter le salon »).
- Son et réglages en haut à droite : haut-parleur (barré si coupé), curseurs → Réglages.
- `#title-foot` disparaît de l'app installée ; la ligne Safari n'apparaît que dans Safari iOS non installé.
- 5 touchers rapides sur le titre ouvrent le débogage (existant).

### 6.16 Salon (feuille grande, modale)

```
 103 ╭──────────────────────── ▬ ──────────────────────────╮
     │(人) Jouer à plusieurs                          (✕)   │ h2 ; état 13 : ● En ligne · 2 joueurs sur 4
     │     ● En ligne · 2 joueurs sur 4                      │   (hors ligne : « Hors ligne · Réessayer » texte)
     │───────────────────────────────────────────────────── │
     │ VOTRE SALON                                           │ micro
     │ [G][T][W][W]       ┌────────────────────────┐         │ lettres 40 × 52, Mincho 30, sceaux crème
     │                    │        Inviter         │         │ primaire M 48 (partage du lien ?salon=)
     │ Vos amis ouvrent le lien, ou saisissent ce code.      │ body 16
     │───────────────────────────────────────────────────── │
     │ JOUEURS · 2/4                                         │
     │ ▲ Esprit 108  [vous][hôte]             [Renommer]     │ lignes 52 ; « Renommer » discret 40
     │ ● Aki                                        Eau      │
     │   2 places libres                                     │ une ligne (plus 3 tuiles vides)
     │───────────────────────────────────────────────────── │
     │ VOTRE ÉLÉMENT                                         │
     │ ┌▲ Feu ──┐┌● Eau ──┐┌◆ Vent ─┐┌■ Terre ┐              │ 4 × 85 × 72 : badge 26, nom 14/700,
     │ │Offensif││pris par││Soutien ││Défense │              │ style 12/500 en un mot (plus de troncature) ;
     │ └────────┘└─Aki────┘└────────┘└────────┘              │ choisi : fond --el-ui + anneau or ; pris : inactif
     │───────────────────────────────────────────────────── │
     │ REJOINDRE UN AUTRE SALON                              │
     │ ┌ _  _  _  _ ┐   ┌──────── Rejoindre ────────┐        │ champ 168 × 48, Mincho 26, espacement .3em
 844 ╰───────────────────────────────────────────────────────╯ (« BQKR » entier) ; secondaire M 48
```

- « Votre élément » n'est plus replié derrière « au choix ▾ ». Note 13 : « Chacun pose les lanternes de son élément. »
- La feuille s'ouvre d'elle-même avec `?salon=` ; un ami qui arrive déclenche l'annonce « Aki a rejoint votre salon » sur l'accueil, sans ouverture forcée.
- Champ : `autocapitalize="characters"`, `autocomplete="off"`, `spellcheck="false"`, `inputmode="text"`, 4 caractères.

### 6.17 Carte des niveaux

```
  47 ├──────────────────────────────────────────────┤
     │‹ Accueil           Niveaux          ★ 13/24 │ en-tête 44 indigo uni : « ‹ Accueil » 16/700 (cible 44,
  91 ├──────────────────────────────────────────────┤ x 8–112) ; titre h3 Mincho 18 ; étoiles 16/700 en cases
     │                     Jardin de mousse [苔庭] │ cartouches de monde (existants)
     │ [一]⁽難⁾ ╭1-1 · Le Seuil──────╮              │ nœuds 62 (boss 72 ; 56/64 en petit écran)
     │  ★★★     ╰Poser et lancer────╯              │ étiquette : nom 13/700 (retour à la ligne, ≤ 2 lignes),
     │      ╭1-2 · Le Jardin des   ╮ [二]          │ leçon 12/500 --ink-2 ; côté opposé au centre ;
     │      │renards              │  ★★★           │ largeur ≤ distance au bord − 12 ;
     │      ╰Combos───────────────╯               │ **jamais de points de suspension**
     │  ...                                         │
     │ [七]◯ ╭2-3 · Le Ciel de fer──╮              │ prochain : anneau vermillon (3 diffusions puis fixe),
     │  ☆☆☆  ╰Volants · à jouer─────╯              │ bord d'étiquette vermillon, « à jouer »
     │      [封]   ╭2-4 · Le Dernier Torii╮         │ verrouillé : sceau 封 + cadenas, encre 0,70, nom --ink-2, « Scellé »
     │            ╰Scellé──────────────╯           │
 844 └──────────────────────────────────────────────┘ la carte défile sous l'indicateur d'accueil ; aucun nœud dans les 34 px du bas
```

- Retirés : 戻 seul, la pastille latine « 1 » en haut à droite des nœuds (doublon), le titre long dans l'en-tête.
- À l'affichage, défilement automatique vers le prochain nœud (500 ms `--e-out`, instantané en mouvement réduit).
- P2 : célébration au retour d'une victoire (`justCleared`) : étoiles tamponnées sur le nœud (120 ms d'écart, son `star` à 60 %), chemin d'encre dessiné vers le nœud suivant (700 ms), sceau 封 qui se brise (320 ms, `woodBlock` + koto).

### 6.18 Fiche de niveau (feuille moyenne, modale)

```
     ╭──────────────────────── ▬ ──────────────────────────╮
     │[苔] NIVEAU 3 · JARDIN DE MOUSSE                 (✕)   │ sceau 48 ; micro 12 ; ✕ 44
     │     L'Étang du temps (h2 22)                          │
     │ Le temps s'écoule à rebours (15 --ink-2)      ★★☆    │ record, étoiles 26
     │───────────────────────────────────────────────────── │
     │[学] LEÇON  Rembobinage (h3 18)                        │
     │───────────────────────────────────────────────────── │
     │ NOUVEAUX YOKAI                                        │
     │ [portrait 48] [portrait 48] [portrait 48]            │ portraits + nom 13/700 (toucher = fiche)
     │  Nuppeppō      Tengu         Tokihami                 │
     │ LANTERNES   ▲ Feu ×2   ● Eau   ◆ Vent ×2   ■ Terre    │ 14/700
     │ RÈGLES  (石 Pierres) (巻 Rembobinage) (刻 Socles réservés) │ puces : toucher = une ligne d'explication
     │──────── (seulement après une première victoire) ──── │
     │ VARIANTES                                             │
     │ [難] Difficile · PV ×1,4 · −20 or · −5 vies     (○)   │ lignes 56, interrupteurs 50 × 30
     │ [挑] Défi : Sans rembobinage                    (○)   │
     │ Partent avec vous : ▲ Aki  ● Botan                    │ hôte en coop (existant)
     │ ┌──────────────────── Jouer ──────────────────────┐   │ primaire L 56 collé en bas ;
     │ └─────────────── (Difficile · Défi) ──────────────┘   │ sous-libellé si des variantes sont actives
 844 ╰───────────────────────────────────────────────────────╯
```

- La fenêtre centrée devient une feuille ; « Retour » disparaît (✕, poignée, voile).
- **Divulgation progressive** : « Variantes » n'apparaît que si `rec.stars > 0`. Au premier passage du 1-1 : en-tête, leçon, yokai, Jouer.
- Hauteur : contenu, plafonnée à 88 % de la page ; le corps défile, « Jouer » reste collé.

### 6.19 Réglages (feuille grande, modale ; depuis l'accueil et la pause)

```
 103 ╭──────────────────────── ▬ ──────────────────────────╮
     │[設] Réglages                                    (✕)   │
     │ SON ET EFFETS                                         │ lignes 48, toute la ligne est la cible
     │ Son                                            (●)    │
     │ Musique                                        (●)    │
     │ Effets            [ Complets │ Sobres ]               │ segmenté 34
     │ CONFORT (P2)                                          │
     │ Taille du texte   [ Normale │ Grande │ Très grande ]  │ ×1 / ×1,15 / ×1,3
     │ Vibrations (boutons)                           (○)    │ masqué tant que non validé sur appareil
     │ Ralentir pendant la visée (seul)               (○)    │
     │ Bouton de vague à gauche                       (○)    │
     │ MA PROGRESSION                                        │
     │ ┌ JDE1-7KQ2M-X9A4F ─────────┐ [Copier] [Partager]     │ code Zen 700 20, espacement .08em
     │ ┌──────────── Importer un code ──────────────┐        │ secondaire → champ + « Importer »
     │ ┌ Haut de l'écran flou ? ───────────────────────────┐ │ encart crème-2 :
     │ │ 1 Copiez ce code  2 Supprimez l'icône du jeu      │ │ 15/500 ; lien « Diagnostic de l'écran ›»
     │ │ 3 Safari ▸ Partager ▸ Sur l'écran d'accueil       │ │ → diag.html
     │ │ 4 Ouvrez le jeu et importez le code               │ │
     │ └───────────────────────────────────────────────────┘ │
     │ À PROPOS  Version hors ligne prête · v4               │
 844 ╰───────────────────────────────────────────────────────╯
```

**Code de progression** (`save.exportCode()` / `save.importCode(str)`, lot MENUS) :
- Format `JDE1-XXXXX-XXXXX` : base32 Crockford (sans I, L, O, U), 10 caractères = 50 bits : pour chaque niveau de `levelOrder()` (8) : étoiles 2 bits, Difficile 2 bits, défi 1 bit (40) ; drapeaux 4 bits (`rewindTutorialSeen`, 3 réservés) ; somme de contrôle 6 bits. Plus de 8 niveaux → préfixe `JDE2`.
- Import tolérant : minuscules, tirets ou espaces absents, O → 0, I/L → 1. **Fusion par maximum** (un import ne baisse jamais un record). Code invalide : « Code invalide : vérifiez les 10 caractères ». Succès : « Progression importée : 14 ★ ».
- Copier : `navigator.clipboard.writeText` ; Partager : `navigator.share({ text })` si disponible ; le code reste affiché (recopiable à la main).

### 6.20 Invitation à réinstaller et `diag.html`

- **Condition** : `html.ios26-app`, sonde `position:fixed; height: env(safe-area-inset-top)` mesurée > 0, portrait, et `save.data.reinstallHintSeen` faux. Carte de la zone d'annonce de l'accueil (§6.15) : « Haut de l'écran flou ? » 15/700 + « Corrigez-le en 2 minutes, sans perdre votre progression. » 13/500 + « › ». Toucher → Réglages, défilés sur « Ma progression ». « Plus tard » (texte) → `reinstallHintSeen = true` ; l'entrée reste dans Réglages.
- **Jamais avant l'export** : l'invitation et le code partent dans le même déploiement.
- **`diag.html`** (fichier statique autonome, lien depuis Réglages ; même portée que l'app) : fond indigo, règles tous les 10 px de 0 à 160 numérotées, textes de 12, 15 et 17 px, valeurs affichées (`navigator.standalone`, `display-mode`, encart haut mesuré, `innerHeight`, `visualViewport.height`, `devicePixelRatio`, version d'iOS du user agent), consigne « Faites une capture d'écran », lien « ‹ Retour au jeu » (`./`).

### 6.21 Messages hors partie

`#app-toast` (accueil, carte) : pilule encre, texte 15/700 crème, **12 px au-dessus des boutons de l'accueil** (et non plus au ras de la zone sûre), au bas de la carte ailleurs ; durée selon la règle `clamp(2500, 1200 + 60 × car., 6000)`. En partie, `appToast()` route vers le couloir (contrat existant).

### 6.22 Écran de rotation

Paysage (≈ 844 × 390) : fond indigo uni, sceau 縦 de 64 (Mincho, vermillon), « Tournez votre téléphone en portrait » 17/700 crème centré, et, si une partie est en cours, « La partie est en pause » 15/500 `--on-dark-2` ; marges `--sal`/`--sar` respectées. La pause automatique existante (`pauseIfLandscape`) est gardée.

---

## 7. Interactions et retours

### 7.1 Nombre de gestes

| Action | Aujourd'hui | Cible | Comment |
|---|---|---|---|
| Reprendre là où on en était (accueil) | 3 | **1** | « Continuer » |
| Premier lancement → 1-1 | 3 | **1** | « Jouer » lance 1-1 |
| Poser, élément affiché | 2 (ou 1 glisser) | 2 (ou 1) | inchangé |
| Poser sur un socle réservé d'un autre élément | 3 | **2** | socle d'abord |
| Pierre | 2 | 2 | épinglée, visible dans tous les onglets |
| Appeler la vague | 1 | 1 | filtre double toucher 350 ms |
| Annuler une pose | 1 (cible mobile) | 1 (place fixe) | rangée d'action |
| Priorité de ciblage | 2 à 4 à l'aveugle | **3 prévisibles** | 4 choix visibles |
| Fusion | 1 glisser caché | 1 glisser ou 3 touchers | « Fusionner » + jumelles allumées |
| Combos (aller-retour) | 4 | **3** | pause → Combos → Reprendre |
| Rembobiner | 1 glisser | 1 glisser ou **2 touchers** | double toucher sur place |
| Recommencer, Quitter | 2 | **3 (voulu)** | confirmation |
| Vendre | 3 | 3 | confirmation (existante) |
| Rejoindre un salon | 3 + saisie | 3 + saisie (0 par lien) | champ élargi |

### 7.2 Retours par événement (sons existants de `src/audio/sound.js`)

| Événement | Visuel | Son |
|---|---|---|
| Tout bouton | pressé au `pointerdown`, relâché 140 ms ressort | `tap` (existant, global) / `select` |
| Carte choisie | élévation −2 px + anneau vermillon, 120 ms | `select` |
| Pose (relâchement) | chute du fantôme + anneau d'encre (§6.7) | **`build`** (nouveau) |
| Activation | allumage 260 ms + halo | `place` + cloche |
| Or gagné | le compteur roule (300 ms si l'écart > 10, 500 ms si > 50), rebond 120 ms | `kill` (existant) |
| Appel anticipé | le cadran se tamponne (`1.25 → 1`, −8° → 0, 220 ms) ; `N = min(6, ceil(prime / 5))` pièces de 10 px volent du bouton au sceau 金 (arc, point de contrôle 40 px au-dessus, 480 ms, 45 ms d'écart), le compteur monte à chaque arrivée ; l'arc fantôme de 巻 se remplit (300 ms) et « +N 巻 » flotte (existant). **Le toast « Appel anticipé » disparaît.** | `earlyBonus` + `waveStart` ; pièce : `bell(nf(13), 0, 0.05, 0.6)`, une toutes les 45 ms au plus (nouveau cas `coin`) |
| Début de vague | chiffre qui roule, segment de barre (300 ms) | `waveStart` |
| Vague repoussée (prime > 0) | pièces du bloc « VAGUE » vers 金 (420 ms) ; balayage or du segment | `waveEnd` + pièces |
| Vie perdue | 命 tremble 260 ms (existant), pastille vermillon 200 ms, secousse 0,32 et voile (existants) | `leak` |
| Premier combo du niveau | lien (existant) + couloir priorité 1 | `combo` |
| Fusion | la jumelle glisse (160 ms `--e-in`), éclair (`fuseFx` existant), sceau 弐/参 tamponné à côté (360 ms) | `fuse` (« big » au N3, existant) |
| Vente | fx `sell` + pièces vers 金 | `sell` |
| Annulation | fumée + or qui roule | **`undo`** (nouveau) |
| Refus | bulle près du geste + secousse 300 ms | `reject` |
| Feuille | ouverture 280 ms / fermeture 200 ms | `select` |
| Victoire | §6.12 ; étoiles toutes les 380 ms (existant) ; comptes 600 ms avec `tick` 0,02 toutes les 80 ms | `win`, `star` |
| Défaite | plateau désaturé (`grayscale(.6) brightness(.9)` sur le canvas, 900 ms), bannière, carte à 1400 ms | `lose` |

Code de référence du son de pose (lot GAME) :

```js
// src/audio/sound.js — play()
case 'build': {
  if (!this.throttle('build', 60)) return;
  const pan = this.pan(data.x);
  this.fx('stoneKnock', { vel: 0.12, rate: 1.1, pan, prio: 2 });
  this.fx('bamboo', { vel: 0.09, rate: 1.25, when: 0.04, pan, prio: 2 });
  break;
}
case 'undo': this.koto(this.nf(7), 0, 0.13, 0.8); this.koto(this.nf(5), 0.07, 0.13, 0.9); break;
case 'coin': if (this.throttle('coin', 45)) this.bell(this.nf(13), 0, 0.05, 0.6, this.sfx, { prio: 1 }); break;

// src/main.js — handleEvents()
case 'pending': {
  const en = ev.entry; if (!en || en.pid !== game.localPlayer) break;
  const at = tileOfCommand(en.op, en.args); if (at) sound.play('build', { x: at.c + 0.5 });
  break;
}
```

### 7.3 Budget d'effets (4 niveaux, `fx.js`, `main.js`)

1. **Murmure** (continu) : pétales, neige, flammes au repos, ambiance des combos. Densité × `(1 − min(0,7, yokai / 30))`.
2. **Note** (≤ 300 ms, local, sans secousse ni baisse de musique) : tirs, coups, éliminations, touchers, gains de 巻.
3. **Accent** (≤ 800 ms, local + un écho dans le HUD, secousse ≤ 0,1, baisse de musique légère) : pose, activation, appel anticipé, vague repoussée, combo, fusion N2, vente. La fuite garde sa secousse de 0,32 (signal d'échec).
4. **Moment fort** (≤ 2 s, global, **un seul à la fois**) : titre du niveau, climax, boss, fusion N3, Rembobinage, dernière chance, victoire, défaite. Les messages 0–1 attendent ; la musique baisse (existant).

### 7.4 Mouvement réduit et « Effets sobres »

`prefers-reduced-motion` ou réglage « Sobres » : ni translation ni changement d'échelle (fondus ≤ 150 ms) ; ni secousse ni hit stop ; ni vols de pièces (le compteur fait seulement un pop, valeur aussitôt) ; 50 % des particules, décor à 30 %. Restent (ce sont des informations) : l'anneau d'appui long, les « +N 巻 », les anneaux de construction et d'annulation, le compte à rebours.

### 7.5 Retiré ou regroupé

| Retiré | Où va l'information |
|---|---|
| `.toast` en bas du plateau | couloir en haut + bulles près du geste |
| Bannière des vagues ordinaires | chiffre qui roule + son |
| Toast « Appel anticipé +X or » | vol de pièces + arc de la jauge |
| Carte flottante « Nouveau yokai » (`#intro`, `placeIntro`, `introCoversSlot`) | étiquette « nouveau » sur la puce + couloir |
| Sous-ligne « 13 s · +12 or · +39 巻 » | cadran (secondes + anneau), « ◉ +12 », arc fantôme |
| Pilule « Annuler » sur le plateau | rangée d'action |
| `#coop-roster` sous le HUD | rangée d'équipe à la place des onglets |
| Badge d'élément sur chaque carte groupée | l'onglet |
| Pierre dans chaque onglet | pierre épinglée |
| Panneau du salon sur l'accueil | feuille « À plusieurs » |
| 音 et 戻 seuls | haut-parleur, « ‹ Accueil » |
| « Retour » de la fiche de niveau | ✕, poignée, voile |
| Difficile et Défi avant la 1re victoire | masqués |
| Six boutons égaux de la pause | Reprendre / Combos, Aide / réglages rapides / Recommencer, Quitter confirmés |
| Matrice des combos | liste de 6 |
| Pastilles « 1… 8 » de la carte | étiquettes « 1-1 · Nom » |
| Message « 刻 Socles gravés ▲ ● ◆ ■… » | bulle de pose du tutoriel |
| Pied « Partager… » dans l'app installée | Safari seulement |
| ×1 et ❙❙ séparés | capsule du temps |

---

## 8. Actions priorisées

Chaque action porte son lot (G = GAME, M = MENUS). Les critères d'ensemble sont en §9.6.

### P0 : lisibilité du haut, fondation, désencombrement

| # | Lot | Action | Fichiers | Acceptation |
|---|---|---|---|---|
| G0.1 | G | **Barre d'état** : supprimer la balise, script `ios26-app`, garde-fou `--sat` | `index.html` `<head>`, `styles.css` `:root` | §4.5 |
| G0.2 | G | **`layout-check`** : tailles du mode actuel (§4.5), mode ancienne installation (X = 20/47/59/62 + 40), règle « aucun texte ni bouton dans [0, X + 40) », texte ≥ 12 px, libellé d'action ≥ 13 px, aucun `text-overflow: ellipsis` visible hors noms de joueurs, case ≥ 43 en 390×797 et 393×793, ≥ 35 en 375×647, au plus un message du couloir visible, aucun décalage > 1 px du bloc vague et du bouton de vague quand l'or, l'or réservé ou la jauge changent | `tools/layout-check.mjs` | vert sur toutes les tailles |
| G0.3 | G | **Fondation** : jetons §5.1 ; boutons et états §5.6 ; `src/ui/press.js` (état pressé, `armConfirm`) ; `src/ui/fmt.js` (`digitsHTML`, `setDigits`) ; `src/ui/sheet.js` + options de `showModal` (§9.4) | `styles.css` (fondation), `src/ui/*.js` nouveaux, `src/main.js` (`showModal`) | livré **en premier**, MENUS se rebase dessus |
| G0.4 | G | **HUD 44** (§6.3) : sceaux, chiffres en cases, case réservée, bloc vague + barre, capsule du temps, 難 | `index.html` `#hud-top`, `styles.css`, `src/ui/hud.js` `update()` | tient en 375 avec 4 chiffres + « −60 » |
| G0.5 | G | **Gabarit du bas 156/142** : rangée 46, onglets 34, boîte 62, pierre épinglée, cartes sans badge avec rôle | `styles.css`, `src/ui/hud.js` `setup`/`buildTabs` | §6.1 |
| G0.6 | G | **Couloir de messages** + bulles de refus ; suppression du toast bas, de la bannière des vagues ordinaires, du toast d'appel anticipé | `src/ui/lane.js` (nouveau), `index.html` `#lane`, `src/ui/hud.js` `toast`, `src/ui/input.js` `flash`, `src/main.js` `feedback`/`handleEvents`, `styles.css` | un seul message visible ; aucune durée < 2,5 s |
| G0.7 | G | **Pause hiérarchisée** + confirmation de Recommencer / Quitter (libellés hôte, invité) | `src/main.js` `openPauseMenu`, `styles.css` `.pause-*` | C3 corrigé |
| G0.8 | G | **Son de pose au relâchement**, cloche d'activation, son d'annulation | `src/audio/sound.js`, `src/main.js` `handleEvents` | son < 100 ms après le relâchement |
| G0.9 | G | **Plancher typo et contrastes en partie** : `.hint` Zen 15/700, `.tb-btn` 13, `.tool-name` 14, teintes `-ui` (`elements.js` `readable`), retrait des `tabular-nums` | `styles.css`, `src/ui/elements.js` | §5.2, §5.3 |
| M0.1 | M | **Code de progression** : `exportCode`, `importCode` (fusion par maximum) + nouvelles clés de sauvegarde (§9.4) | `src/save.js` | aller-retour export → import identique ; code corrompu refusé |
| M0.2 | M | **Réglages minimaux** : Son, Musique, Effets, Ma progression, « Haut de l'écran flou ? » ; icône curseurs sur l'accueil ; `openSettings()` exporté | `src/ui/settings.js` (nouveau), `index.html` `#screen-title`, `lobby.css` | ouvrable depuis l'accueil et la pause |
| M0.3 | M | **Invitation unique** + **`diag.html`** + ciel de l'accueil opaque en haut | `src/main.js` (zone MENUS), `src/ui/screens.js` `paint()`, `diag.html` (nouveau) | invitation seulement si encart > 0 en app installée |
| M0.4 | M | **Carte lisible** : en-tête 44 « ‹ Accueil · Niveaux · ★ », nœuds verrouillés encre 0,70, « Second monde » ≥ 4,5:1 | `index.html` `#screen-map`, `styles.css` Carte, `src/ui/screens.js` | aucun texte dans la bande en mode ancienne installation |

### P1 : agencement et interactions (le gros du gain)

| # | Lot | Action | Fichiers |
|---|---|---|---|
| G1.1 | G | Bouton de vague (§6.5 : cadran, secondes, « Vague N », « ◉ +X », largeur fixe) | `src/ui/hud.js` `updateWaveButton`, `styles.css` |
| G1.2 | G | Jauge : arc fantôme, pourcentage, piste de 130 px quand prête, double toucher, poignée touchable en dernière chance | `src/ui/rewind.js`, `src/main.js` `placeLastChanceArrow`, `styles.css` |
| G1.3 | G | « Annuler » dans la rangée d'action (suppression de `placeUndo`) | `src/ui/hud.js` `showUndo`/`updateUndo`, `src/main.js`, `index.html` (`#btn-undo` dans `.action-row`), `styles.css` |
| G1.4 | G | Barre d'actions : 64×52, Priorité ▾ à 4 choix, Fusionner guidé, indice 合, fermeture (6 s), placement qui évite le chemin, `towerNear` élargi | `src/ui/towerbar.js`, `src/ui/input.js`, `src/ui/overlay.js`, `src/main.js` `changePriority`, `src/ui/commands.js` |
| G1.5 | G | Fiches : mécanique `sheet.js`, modèle commun, deux hauteurs, sceau de niveau | `src/ui/sheets.js`, `styles.css` |
| G1.6 | G | Socle d'abord | `src/ui/input.js`, `src/ui/hud.js` `clickTool`, `src/render/renderer.js` |
| G1.7 | G | Nouveau yokai : étiquette « nouveau » + couloir ; suppression de `#intro` | `src/ui/wavepreview.js`, `src/main.js` `showIntro`, `index.html`, `styles.css` |
| G1.8 | G | Vols de pièces et compteurs qui roulent (appel, fin de vague, vente, annulation) | `src/ui/coins.js` (nouveau), `src/ui/hud.js` (`bump` → `rollNumber`), `src/main.js` |
| G1.9 | G | Victoire / défaite : hiérarchie, verrou 700 ms, comptes | `src/main.js` `showResult`, `styles.css` |
| G1.10 | G | Coop : rangée d'équipe à la place des onglets | `src/ui/hud.js` `buildTabs`, `src/main.js` `updateRoster`, `index.html`, `lobby.css` (plage GAME) |
| G1.11 | G | Tutoriel ancré et persistant, socles réservés dans la bulle, leçon d'appel après la vague 1 | `src/ui/tutorial.js`, `styles.css` `.hint` |
| G1.12 | G | Combos en liste de 6 (feuille grande, « ‹ Pause », « Reprendre » collé) | `src/main.js` `openComboTable`, `src/ui/sheets.js` `comboTable`/`comboDetail`, `styles.css` |
| G1.13 | G | Chute et rebond du fantôme, allumage, chiffre de vague qui roule, bannière réservée aux moments forts (1,8 s) | `src/render/renderer.js`, `src/render/fx.js`, `src/ui/hud.js`, `src/main.js` |
| G1.14 | G | « Effets sobres » (lecture de `save.data.effects`) | `src/render/fx.js`, `src/ui/coins.js`, `styles.css` |
| M1.1 | M | Accueil (§6.15) : héros Continuer/Jouer, « Niveaux », « À plusieurs », zone d'annonce, variantes hôte et invité, premier lancement → 1-1 | `index.html` `#screen-title`, `src/main.js` (zone MENUS), `src/ui/screens.js` `TitleScreen`, `lobby.css` |
| M1.2 | M | Salon en feuille (§6.16) : lignes de joueurs, éléments visibles, Renommer, champ 168 | `src/ui/lobby.js`, `lobby.css` |
| M1.3 | M | Fiche de niveau en feuille (§6.18) : divulgation progressive, portraits, règles, un seul « Jouer » | `src/main.js` `openLevelCard`, `styles.css` Fiche de niveau |
| M1.4 | M | Carte : étiquettes nom + leçon sans troncature, retrait de `.latin`, défilement vers le prochain nœud, `showScreen('map', { justCleared })` accepté | `src/ui/screens.js` `MapScreen`, `styles.css` Carte, `src/main.js` `showScreen` |
| M1.5 | M | Messages hors partie (§6.21), écran de rotation (§6.22) | `lobby.css`, `styles.css` Orientation, `index.html` `#rotate`, `#app-toast` |
| M1.6 | M | `tools/menus-check.mjs` : accueil, salon (code « BQKR » entier), carte (aucune étiquette tronquée), fiche de niveau, réglages, invitation ; mode ancienne installation | nouveau |

### P2 : finitions et options

| # | Lot | Action |
|---|---|---|
| G2.1 | G | Haptique par switch superposé (méthode ios-haptics 3.2.0) sur bouton de vague, carte choisie, confirmations, derrière « Vibrations » (éteint), à tester sur iOS 26.5+ et 27 |
| G2.2 | G | Taille du texte : `--fs-scale` appliqué aux fiches, pause, combos, couloir, tutoriel (pas au HUD ni à la palette) |
| G2.3 | G | Mode gaucher : rangée d'action inversée (`flex-direction: row-reverse`) |
| G2.4 | G | Ralenti ×0,5 en solo pendant la visée ou une fiche ouverte (éteint par défaut, `main.js` `frame`) |
| G2.5 | G | Densité du décor selon le nombre de yokai ; hit stop visuel de la fusion (temps des particules ×0,1 pendant 90 ms, simulation intacte) |
| G2.6 | G | Chœur des lanternes à la victoire ; conseil de défaite tiré des fuites |
| G2.7 | G | Carnet des combos (n/6, `save.data.combosSeen`, « Nouveau combo · 4/6 ») ; étiquette au sol du yokai nouveau ; « Aide / Leçons » dans la pause ; « ka » aux 3 dernières secondes |
| G2.8 | G | Noms : « Yuki-onna », « Kasa-obake » (`data/combos.js`) ; `apple-mobile-web-app-title` et `short_name` identiques (`index.html`, `manifest.json`) |
| M2.1 | M | Réglages P2 : lignes Taille du texte, Vibrations, Ralentir, Gaucher (écrivent `save` ; l'effet est du lot GAME) ; `--fs-scale` appliqué aux menus |
| M2.2 | M | Célébration de la carte au retour d'une victoire (§6.17) |

---

## 9. Partage du travail

### 9.1 Les deux lots

- **GAME** : écran de partie (HUD, palette, vague, jauge, sélection, fiches, constructions, pause, combos, fin de partie, notifications, tutoriel, coop en partie), **fondation** (jetons de `:root`, composants de base, état pressé, chiffres, mécanique des feuilles, `showModal`), correctif iOS (`<head>`, garde-fou), `layout-check`, service worker.
- **MENUS** : accueil, salon, carte, fiche de niveau, réglages et transfert de progression, invitation à réinstaller, `diag.html`, messages hors partie, écran de rotation.

### 9.2 Fichiers exclusifs

| GAME seul | MENUS seul |
|---|---|
| `src/ui/hud.js`, `input.js`, `sheets.js`, `towerbar.js`, `wavepreview.js`, `rewind.js`, `tutorial.js`, `overlay.js`, `commands.js`, `elements.js`, `debug.js` (si besoin) | `src/ui/lobby.js`, `src/ui/screens.js` |
| `src/render/*`, `src/audio/sound.js`, `data/combos.js` (noms) | `src/save.js` (toutes les clés, y compris celles que GAME lit : §9.4) |
| nouveaux : `src/ui/press.js`, `fmt.js`, `sheet.js`, `lane.js`, `coins.js` | nouveaux : `src/ui/settings.js`, `diag.html`, `tools/menus-check.mjs` |
| `tools/layout-check.mjs`, `sw.js` (MENUS y ajoute seulement ses lignes, §9.3), `manifest.json` | — |

`src/ui/portraits.js` n'est modifié par personne (MENUS l'utilise pour les portraits de la fiche de niveau).

### 9.3 Fichiers partagés : qui possède quoi (lignes au commit `c3dde46`)

**`styles.css`**

| Lignes | Section | Lot |
|---|---|---|
| 1–309 | `:root`, base, Sceaux, Étoile, **Boutons**, Ondulation | GAME (fondation) |
| 310–444 | Titre | MENUS |
| 445–788 | Carte (en-tête, cartouches, nœuds, prochain niveau) | MENUS |
| 789–1838 | Écran de jeu, bouton de vague, palette, Rembobinage, Messages, Bannière, Fiche, Tutoriel, Boss, Nouveau yokai | GAME |
| 1839–1968, 1979–2149 | Fenêtre modale (coquille, `.as-sheet`, sceau de tête, défaite, résultats, démonstration de la jauge) | GAME |
| 1969–1978 | Tours disponibles (fiche de niveau) | MENUS **ne l'édite pas sur place** : surcharge depuis `lobby.css` (bloc enclavé dans GAME) |
| 2150–2201 | Orientation | MENUS |
| 2202–2318 | Petits écrans | GAME ; les règles `#screen-title`, `.tagline`, `.btn.big`, `.map-node` (≈ 2229–2260) restent telles quelles, MENUS les surcharge depuis `lobby.css` |
| 2319–4024 | UX mobile, Moteur v3 (palette, onglets, vague, jauge, dernière chance, barre d'actions, fiches v3, tutoriel) | GAME |
| 4025–4298 | Fiche de niveau (leçon, Difficile, défi, interrupteurs) ; Carte : leçons et marques | MENUS |
| 4299–fin | Résultat et pause (marques), débogage, mouvement réduit | GAME |

Règle : **MENUS écrit tout CSS nouveau dans `lobby.css`** (chargé après `styles.css`, il surcharge sans conflit) et n'édite sur place que ses plages de `styles.css`. GAME n'édite jamais les plages MENUS ; il n'y fait que des remplacements mécaniques de jetons s'ils sont indispensables, signalés dans sa PR.

**`lobby.css`**

| Lignes | Section | Lot |
|---|---|---|
| 1–483 | accueil = salon, message hors partie (`.app-toast`), salon, places, élément, petits écrans du salon | MENUS |
| 484–657 | Partie coopérative : coéquipiers, attente, vitesse de l'invité, barre d'actions d'un coéquipier, fiche du joueur | GAME |
| 658–682 | Fiche de niveau de l'hôte (`lv-team`, `lv-mate`) | MENUS |
| 683–691 | Pause et résultat en coopération | GAME |
| 692–719 | mouvement réduit (mixte), `.seal-any` | personne ; MENUS **ajoute** son CSS nouveau **après la ligne 719** |

**`index.html`**

| Zone | Lot |
|---|---|
| `<head>` (balise de barre d'état, script `ios26-app` juste après `theme-color`, titre de l'app) | GAME |
| `#screen-title` (l. 31–45), `#screen-map` (l. 47–54), `#app-toast` (l. 108), `#rotate` (l. 110) | MENUS |
| `#screen-game` (l. 56–106 : HUD, `#coop-roster`, `#stage` + `#lane`, `#hud-bottom`, `#btn-undo`, `#toast`, `#banner`, `#info`, `#hint`, `#hold`), `#modal` (l. 107) | GAME |
| `<script type="module">` | personne |

**`src/main.js`** (par fonction ; les numéros sont indicatifs)

| Zone | Lot |
|---|---|
| Imports (l. 15–38) : GAME ajoute ses imports **juste après** `import { commands, tileOfCommand }` (l. 36) ; MENUS **juste après** `import { LobbyUI, loadProfile }` (l. 31) | les deux, à ces ancres seulement |
| l. 40–81 état global | GAME (ne pas réordonner) |
| l. 82–130 Salon multijoueur (`params`, `session`, `coop`, `memo`, `recall`) | MENUS |
| l. 131–151 Son (`setMuted`) | GAME (signature inchangée) |
| l. 152–342 Écrans : `title`, `map`, `loadAllLevels`, `showScreen`, câblage `btn-play`/`btn-title-sound`/`btn-map-back`/`title-foot`, `fetchLevel` (lecture seule), `openLevelCard`, `coopReady`, `teamLine`, `typedSlots`, `hardSummary` | MENUS (`leaveCoopGame` et `esc` : personne) |
| l. 343–398 Fenêtre modale (`showModal`, `modalOpen`, `pauseSheetOpen`, débogage) | GAME |
| l. 399–1686 Partie et Coopération (`openPauseMenu`, `openComboTable`, `feedback`, `callWave`, `placeUndo`, `showInfo`, `showIntro`, `startLevel`, `beginGame`, `showResult`, `handleEvents`, `frame`, `updateRoster`…) | GAME |
| l. 1687–1802 `appToast`, `updateTitleActions`, `hostSalon`, `ensureSalon`, `lobbyUI` et son câblage | MENUS |
| l. 1803–1899 `cleanResult`, `guestGameOver` | GAME |
| l. 1900–1915 `scheduleReconnect`, `online` | MENUS |
| l. 1916–fin Contraintes iOS, `visibilitychange`, `pagehide`, paysage, `resize`, `watchDpr`, service worker | GAME |

**`sw.js`** : GAME possède le fichier (incrémente `VERSION`, ajoute ses fichiers après `'src/ui/commands.js'`). MENUS ajoute seulement ses lignes après `'src/ui/lobby.js'` (`'src/ui/settings.js'`) et après `'manifest.json'` (`'diag.html'`).

**Outils de test** (`tools/ui-test.mjs`, `qa.mjs`, `mp-test.mjs`, `play-browser.mjs`) : chaque lot ne modifie que les lignes qui visent ses propres sélecteurs (`#btn-play`, `#title-lobby`, `.lobby-join*`, `#btn-map-back` pour MENUS ; `#toast`, `#intro`, `#btn-undo`, `#palette-tabs`, `#coop-roster` pour GAME). Les tests qui ouvrent la carte par `#btn-play` passent par `#btn-levels` (MENUS).

**`README.md`** : GAME met à jour « Contrôles » ; MENUS « Seul ou à plusieurs » et ajoute « Transfert de progression ».

### 9.4 Contrats entre les lots (à respecter tels quels)

1. **Classes de composants** (GAME les style en fondation, MENUS les emploie) : `.btn.primary`, `.btn.secondary`, `.btn.dark`, `.btn.quiet`, `.btn.text`, `.btn.hero`, `.btn.L|.M|.S`, `.icon-btn`, `.switch`, `.seg` (segmenté), `.seal`, `.seal-*`, `.dg`, `.sheet-grabber`, `.sheet-head`. Jetons de §5.1 seulement (aucune couleur en dur hors palette).
2. **`showModal(html, buttons, opts)`** (GAME) : `opts.sheet: true | 'medium' | 'large'` (feuille du bas ; `true` = moyenne), `opts.veil: boolean` (voile, toucher = fermer), `opts.grabber` (défaut vrai pour une feuille), `opts.onClose()`, `opts.cls`, `opts.actionsCls`, `opts.column` (existants). Bouton : `{ label, cls, aria, keep, run, confirm }` où `confirm: 'Confirmer…'` branche `armConfirm`. Tant que G0.3 n'est pas fusionné, MENUS appelle `showModal(…, { sheet: true })` (sans voile).
3. **`src/ui/press.js`** (GAME) : `installPress(document)` (appelé une fois par GAME dans `main.js`) et `armConfirm(el, { label, ms = 2600, run })`.
4. **`src/ui/fmt.js`** (GAME) : `digitsHTML(n | string)` et `setDigits(el, n)`.
5. **`src/ui/settings.js`** (MENUS) : `openSettings({ section } = {})`, avec des rappels injectés par `main.js` (`setMuted`, `setMusic`, `onEffects`). La pause appelle `openSettings()`.
6. **Sauvegarde** (MENUS, `src/save.js`) : clés ajoutées d'un coup, avec valeurs par défaut et `sanitize` : `effects: 'full' | 'sober'` (`'full'`), `textScale: 1 | 1.15 | 1.3` (1), `haptics: false`, `slowAim: false`, `leftHanded: false`, `combosSeen: {}`, `reinstallHintSeen: false`. GAME les lit (`save.data.*`) et écrit seulement `combosSeen` (via `save.set`).
7. **`showScreen(name, opts)`** (MENUS) : accepte `{ justCleared: levelId }` pour la carte ; GAME l'appelle depuis `showResult`.
8. **`hud.toast(msg, bad, ms)`** (GAME) garde sa signature ; `appToast()` (MENUS) continue d'y router en partie.
9. **Ids conservés** : `#btn-play` = bouton héros ; nouveaux : `#btn-levels`, `#btn-multi`, `#btn-title-settings`, `#title-notice` (MENUS) ; `#lane`, `#btn-undo` déplacé dans `.action-row` (GAME).

### 9.5 Ordre de fusion et règles anti-conflit

1. GAME livre **G0.1 + G0.3** (barre d'état, jetons, composants, `press.js`, `fmt.js`, `sheet.js`, `showModal`) en premier, en une PR courte.
2. MENUS se rebase dessus ; les deux lots avancent ensuite en parallèle.
3. Fusions suivantes : GAME d'abord, MENUS se rebase. Les seuls conflits attendus sont aux frontières des plages (lignes d'en-tête de section, ancres d'import, liste de `sw.js`) : on garde les deux côtés.
4. Aucun lot ne reformate ni ne réordonne un fichier partagé ; pas de Prettier global pendant la refonte.

### 9.6 Vérification commune (avant chaque fusion)

- `node tools/layout-check.mjs` (GAME) et `node tools/menus-check.mjs` (MENUS) verts, en mode actuel et en mode ancienne installation.
- `node tools/ui-test.mjs`, `tools/qa.mjs`, `tools/mp-test.mjs` (relais local), `tools/test-core.mjs`, `tools/validate-levels.mjs` verts ; `tools/perf.mjs` sans régression de plus de 5 %.
- Captures avant/après en 375×647, 390×797, 393×793, 430×873 (`hasTouch`, `isMobile`, `deviceScaleFactor: 3`) jointes à la PR.
- Critères d'ensemble : case ≥ 43 px en 390×797 et 393×793, ≥ 35 en 375×647 ; au plus un message du couloir visible ; aucune information à durée limitée sous 2,5 s ; un seul bouton vermillon plein par écran ; aucun texte < 12 px, aucun libellé d'action < 13 px ; aucun kanji seul porteur de sens.

---

## 10. À vérifier sur un iPhone

- Netteté du haut et couleur du texte de la barre d'état après réinstallation (sinon `content="black"`).
- Hauteur réelle de la bande en ancienne installation (`diag.html`) ; efficacité du garde-fou de 40 px.
- Perte du stockage à la suppression de l'icône (probable) et aller-retour du code de progression.
- Encart haut des iPhone 16/17 Pro et Pro Max (62 pt annoncés).
- Haptique par switch superposé sur iOS 26.5+ et 27 (P2).
- Lisibilité de « Vague 14 » dans le bouton en 375 px (16 px Mincho) et du HUD avec un or à 5 chiffres.
