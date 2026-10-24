# Audit — Jardin des Esprits

Audit réalisé avant toute modification du code (version `cc6e0df`), sur l'intégralité du dépôt :
moteur (`src/core`), données (`data/`), interface (`src/ui`, `src/main.js`, `styles.css`), rendu et audio,
outils (`tools/`).

**Méthode.** Quatre audits indépendants (bugs du moteur, bugs et UX tactile, équilibrage, mécaniques) ont lu
leur périmètre en entier et prouvé chaque constat par un script (Node pour le moteur, Playwright au doigt
simulé en 390×844 et 430×932 pour l'interface, simulations au bot pour l'équilibrage). Chaque constat a
ensuite été **reproduit par un second agent sceptique** ; seuls les constats confirmés figurent ici
(124 sur 124 confirmés, gravités ajustées par le vérificateur).

## Synthèse

| | Constats | Majeurs |
|---|---|---|
| Bugs | 22 | 3 |
| Lisibilité / UX mobile | 23 | 3 |
| Déséquilibres | 19 | 10 |
| Mécaniques qui fonctionnent mal | 14 | 1 |
| Manques par rapport à la refonte | 29 | 17 |
| Points solides (à garder) | 17 | — |

**Les cinq problèmes qui comptent le plus**

1. **Une seule tour suffit à gagner** (A4, C1). Au bot, l'Eau seule gagne 7 niveaux sur 8, le Feu 6, le Vent 6 ;
   le duo Feu + Eau gagne tout. Le mélange d'éléments fait *moins bien* que le Feu seul sur 2-3.
2. **La fusion est un gain pur** (A5, C2, D2) : +15 à +31 % de DPS par or, un socle libéré, des combos plus
   forts, aucune contrepartie. Les combos pèsent moins de 2,3 % des dégâts (C10).
3. **Le Rembobinage est un bouton « annuler » gratuit** (D7, C9) : il rend les vies perdues et rembourse les
   poses, sans coût ; il ne peut pas sauver d'une fuite fatale (A12).
4. **Pose et fusion trompeuses au doigt** : le fantôme est dessiné sous le doigt (B2), la zone de dépôt de
   fusion est décalée vers le bas et échoue en silence (B3), l'outil reste armé et tout toucher sur un socle
   achète (B1), la fiche d'info reste figée et vend une N2 au prix affiché d'une N1 (B4, D1).
5. **Structure des niveaux** : 5 à 10 vagues en rampe quasi monotone, pics ×1,9 à ×2,55, falaise en 1-3,
   boss final expédié en 15 s (A8, C6, C7).

## Plan de correction (ordre de priorité)

1. **Bugs** — statuts (A1, C5, C15, A17, A18), séparation des yokai (A2), fusion (A3, B3, D1, B4), échos et
   commandes pendant le rembobinage (A9, D11, A11, B25, D8), enfants de division (A19, C16), validation des
   données (A20, A21), sauvegarde (A22), achat involontaire (B1), outils (A25), animations réduites (B23).
2. **UX mobile** — fantôme au-dessus du doigt et annulation (B2, B8, A30), fiches tour / ennemi / palette
   (B5, B6, B7, B9, B27), pierres restantes (B10, D15), pause qui laisse voir le plateau (B13), cartes,
   bulles et toasts moins envahissants (B14, B15, B22), couleurs, contrastes, textes et zones tactiles
   (B16 à B21), retours de geste (B24, B26).
3. **Équilibrage** — rôles de tours avec une faiblesse nette, armure partielle, priorités de ciblage, fusion
   avec contrepartie, combos utiles chacun contre un ennemi, rembobinage payé par une jauge, économie,
   courbe des vagues (A4, A5, C1 à C4, C6 à C14, D4, D19).
4. **Nouvelles fonctions** — aperçus (combos, fusion, chemin, vague), jauge de Rembobinage, ennemi hors du
   temps, appel anticipé, niveaux en dents de scie, mode Difficile et défis, outils d'équilibrage, puis
   l'adaptation multijoueur demandée (A6, A29, B29, C11).

La colonne **Statut** est mise à jour au fil des corrections.

## Bugs (22)

| ID | Gravité | Zone | Constat | Correction prévue | Statut |
|---|---|---|---|---|---|
| A2 | majeur | collisions / ennemi:nuppeppo | **Aucune séparation entre yokai : les deux enfants d'une division se confondent en un seul, et jusqu'à 12 yokai s'empilent au même point** — Les yokai terrestres visent toujours le centre exact des cases (moveEnemy), sur une seule ligne. Le décalage des enfants d'un nuppeppō est de 0,11 case, alors que leur rayon est de 0,24, et il disparaît dès la case suivante : 3 s plus tard, l'écart est de 0,000. | Donner à chaque yokai un couloir latéral persistant (lane ∈ [-0,22 ; +0,22] tiré de e.seed) appliqué perpendiculairement à la direction dans moveEnemy, plus une légère répulsion entre yokai d'une même case, purement visu … | ✅ Corrigé (bloc 1) |
| B1 | majeur | pose | **Achat involontaire : l'outil lanterne reste sélectionné et tout toucher sur un socle libre achète aussitôt** — Scénario au doigt (390×844 et 430×932, niveau 1-1) : on choisit Feu, on pose une lanterne, puis on touche cette lanterne pour voir sa portée. On touche ensuite un socle vide voisin pour « désélectionner » : une 2e lanterne est achetée (or 70 → 20). | Après une pose, désélectionner l'outil (ou le garder seulement si l'option « pose en série » est choisie). Si une tour est sélectionnée, le 1er toucher sur une case vide la désélectionne seulement. | ✅ Corrigé (bloc 1) |
| B3 | majeur | fusion | **Fusion : la zone de dépôt est décalée vers le bas, viser la lanterne échoue en silence** — La cible se calcule à 0,4 case au-dessus du doigt (input.js l.112). La fusion ne réussit donc que si le doigt se trouve entre −4 px et +19 px du centre de la case cible (en 390). Or le dessin de la lanterne monte au-dessus du centre de sa case. | Tester le dépôt contre la boîte du dessin de chaque tour, ou aimanter vers la cible valide la plus proche du fantôme dans un rayon de 0,75 case, plutôt que de prendre floor(y-0,4ts). | ✅ Corrigé (bloc 1) |
| A1 | mineur | statuts | **Cumul des statuts : le facteur le plus fort hérite de la durée la plus longue (ralentissement, brûlure, armure brisée)** — applySlow garde min(facteur) et max(durée) dans un seul emplacement. Si la Boue applique ×0,35 pendant 0,3 s puis qu'une seule goutte d'Eau N1 tombe (×0,6 pendant 1,4 s), le yokai reste à ×0,35 pendant 1,4 s, soit 4,6 fois trop longtemps. La brûlure fait pareil : max(dps) et max(durée). | Garder une petite liste d'effets actifs {facteur/dps, t restant, source}, avec vitesse = min des facteurs actifs et dps = max (ou somme plafonnée) des brûlures actives, chaque entrée expirant pour son compte. | ✅ Corrigé (bloc 1) |
| A11 | mineur | rembobinage | **Commandes acceptées pendant l'animation de rembobinage : une pierre posée disparaît sans le moindre retour** — Pendant rewindAnim (1,1 s), update() ne fait rien d'autre que l'animation, mais placeTower, placeStone, fuse et sellTower restent acceptées. Une pierre est validée contre les yokai du présent, l'or est débité (1000 → 990) et l'événement 'stone' est émis. | Faire refuser toute commande par le moteur tant que rewindAnim est actif (raison 'rewinding', avec un 'reject' pour le retour visuel), ou les mettre en file pour les exécuter après finishRewind. | ✅ Corrigé (bloc 1) |
| A17 | mineur | statuts / données | **Les effets à l'impact sont liés à un élément fixe (ralentir = eau, brûler = feu, repousser = vent, étourdir = terre) plutôt qu'à l'élément de la tour** — hitEffects vérifie immuneTo(e, 'water'/'fire'/'wind'/'earth') selon le type d'effet, sans regarder l'élément du projectile. | Passer l'élément du projectile (el) à applySlow, applyBurn, applyKnockback et applyStun, puis tester immuneTo(e, el). | ✅ Corrigé (bloc 1) |
| A18 | mineur | ennemi:gashadokuro / statuts | **Une brûlure posée avant que le Gashadokuro bascule sur « feu » le soigne ensuite à chaque tic** — applyBurn vérifie l'immunité au moment de la pose, mais les tics de updateStatuses repassent par damage(..., 'fire'). Si cycleAbsorb bascule sur le feu pendant la brûlure, chaque tic soigne le boss de 50 % des dégâts. | Lors d'un absorbShift, éteindre la brûlure si le nouvel élément est le feu (et faire de même pour un ralentissement en cours face à l'eau). | ✅ Corrigé (bloc 1) |
| A19 | mineur | ennemi:nuppeppo / vagues | **Les enfants d'une division ignorent le multiplicateur hp et l'absorb de leur groupe** — spawnChild appelle createEnemy(type, { spawnT }) sans hpMult ni absorb. Dans 2-1, vague 8 (groupe hp 1,9), le parent a 325 PV et chaque enfant seulement 61 PV, car seul hpScale 1,8 s'applique. | Garder hpMult et absorbOverride sur le yokai et les transmettre dans spawnChild pour la division. Pour l'invocation, garder la base ou ajouter un champ dédié. | ✅ Corrigé (bloc 1) |
| A20 | mineur | données / NaN | **Une tour sans damage produit des PV NaN : le yokai devient immortel, et validate-levels ne contrôle ni data/towers.js ni data/enemies.js** — impact() calcule st.damage * pw. Sans champ damage (une tour de soutien pure, plausible dans la refonte), on obtient NaN. damage() ne filtre pas NaN (NaN <= 0 est faux), hp devient NaN et e.hp <= 0 ne sera plus jamais vrai : le yokai ne meurt plus et finit par fuir. | Côté moteur : utiliser (st.damage ?? 0), sortir de damage() si !Number.isFinite(amount), et lire def.targets ?? { ground: true, air: true }. | ✅ Corrigé (bloc 1) |
| A21 | mineur | données / validation des niveaux | **Valeurs de groupe absurdes ou mal orthographiées acceptées sans avertissement** — validate-levels accepte hp: 0 (les yokai apparaissent avec 0 PV), count: 2.5 (3 apparitions), delay négatif (rafale dès la première frame) et les clés mal orthographiées comme intervale (retour silencieux à 1 s). Le jeu se lance quand même, mais pas avec la vague prévue. | Vérifier que count est un entier > 0, interval > 0, delay ≥ 0, hp > 0, et signaler les clés inconnues des groupes, vagues et niveaux (liste blanche). | ✅ Corrigé (bloc 1) |
| A22 | mineur | sauvegarde / déblocage | **Insérer un niveau reverrouille des niveaux déjà gagnés, et totalStars compte des niveaux qui n'existent plus** — isUnlocked(order, i) ne regarde que les étoiles du niveau précédent. Si une mise à jour insère 1-5 (l'exemple du README), un joueur qui a tout fini en 3★ voit 2-1 (3★) verrouillé jusqu'à ce qu'il gagne 1-5. | isUnlocked doit renvoyer true aussi quand le niveau lui-même, ou n'importe quel niveau suivant, a des étoiles (ou stocker un ensemble 'unlocked'). totalStars ne doit parcourir que levelOrder(). | ✅ Corrigé (bloc 1) |
| A25 | mineur | outils : sim | **sim.mjs lancé par un lien symbolique (ou un chemin avec espace) n'affiche rien et sort avec le code 0** — La garde du point d'entrée compare import.meta.url (chemin réel, encodé en URL) à `file://${process.argv[1]}`. Par un lien symbolique, ou avec un chemin contenant un espace ou un caractère non ASCII, la comparaison échoue. | import { pathToFileURL } from 'node:url'; import { realpathSync } from 'node:fs'; if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) … | ✅ Corrigé (bloc 1) |
| A3 | mineur | fusion | **Crash latent : la fusion se fonde sur rules.maxTowerLevel et non sur le nombre de niveaux de la tour** — canFuse autorise la fusion tant que level < rules.maxTowerLevel (3). Une tour définie avec 2 niveaux (cas probable pour les familles de tours par élément de la refonte multijoueur), ou un niveau qui surcharge rules.maxTowerLevel = 4, produit une lanterne d'un niveau inexistant. | Dans canFuse, refuser quand a.level >= Math.min(rules.maxTowerLevel, def.levels.length). Faire vérifier par validate-levels (ou un nouveau validate-data) que chaque tour a au moins un niveau et que les niveaux sont cohér … | ✅ Corrigé (bloc 1) |
| A9 | mineur | rembobinage / échos | **Écho et lanterne réelle empilés sur le même socle** — Cas 1 : on fusionne pendant la vague puis on rembobine. La N1 restaurée et l'écho N2 occupent le même socle (1,3). Cas 2 : canPlaceTower ne regarde que this.towers, si bien qu'on peut poser une nouvelle lanterne réelle sur le socle d'un écho. Deux lanternes se superposent alors sur un socle et tirent toutes les deux. | Faire refuser par canPlaceTower un socle occupé par un écho actif (raison 'echo'), ou dissiper l'écho quand on pose dessus. Pour la fusion : placer l'écho N2 sur le socle source libéré, ou l'afficher décalé. | ✅ Corrigé (bloc 1) |
| B23 | mineur | accessibilité / mouvement réduit | **Avec « réduire les animations », les bannières disparaissent et le tremblement d'écran reste** — La règle globale prefers-reduced-motion ramène les animations à 0,01 ms. Or .banner.show utilise animation: banner … forwards, dont la dernière image est à opacity 0 : « Vague N », « Dernière vague », « Victoire ★★★ », « Défaite » et « 影 Écho ! » deviennent invisibles. | Sous reduced-motion, donner à la bannière une animation d'opacité sans mouvement (ou l'afficher puis la masquer par une classe minutée). | ✅ Corrigé (bloc 1) |
| B25 | mineur | rembobinage | **Pendant l'animation de rembobinage (1,1 s), les gestes restent actifs et leurs effets deviennent des échos** — L'entrée n'est pas coupée pendant game.rewindAnim. Une lanterne posée pendant l'animation apparaît, puis disparaît du présent et devient un écho (or rendu). Une fusion faite pendant l'animation laisse les deux N1 d'origine et ajoute un écho N2. | Mettre input.enabled = false et griser la palette pendant rewindAnim, ou mettre l'action en file d'attente jusqu'à rewindEnd. | ✅ Corrigé (bloc 1) |
| B4 | mineur | HUD:fiche | **La fiche d'info reste figée : elle affiche N1 « Vendre +35 » et vend une tour N2 pour 70** — La fiche est construite une seule fois et capture l'objet tour dans une closure. Scénario : appui long sur la lanterne Feu (1,4), fiche ouverte. On glisse une autre lanterne Feu N1 dessus : la tour passe N2 et vaut 70. | Lier la fiche à l'id de la tour. La rafraîchir sur les événements fuse, sell, place et rewindEnd, ou à chaque frame si elle est ouverte. La fermer avec un message si la tour disparaît. | ✅ Corrigé (bloc 1) |
| C16 | mineur | ennemi:nuppeppo / invocations | **Les enfants de division et les invocations ignorent le multiplicateur de PV du groupe** — spawnChild appelle createEnemy(type, { spawnT }) sans hpMult : seul hpScale s'applique. En 2-1 vague 8 (hp 1,9, hpScale 1,8), un nuppeppō a 325 PV mais chacun de ses deux enfants n'en a que 61 (116 attendus) ; leur part de la menace diminue au fil des vagues. | Transmettre aux enfants et aux invocations le hpMult du parent (stocker e.hpMult dans createEnemy). | ✅ Corrigé (bloc 1) |
| C5 | mineur | statuts (ralentissement, brûlure, sable) | **Une source faible qui rafraîchit un statut prolonge indéfiniment l'effet fort (ralentissement, brûlure, sable)** — applySlow (ligne 882), applyBurn (ligne 910) et le sable (src/core/combos.js:68) gardent séparément l'intensité maximale et la durée maximale. Tant qu'une source faible rafraîchit la durée, l'intensité forte n'expire jamais. | Quand la nouvelle intensité est plus faible, ne pas prolonger l'effet fort : garder deux entrées (forte avec sa fin, faible avec sa fin) et passer à la faible quand la forte expire. | ✅ Corrigé (bloc 1) |
| D1 | mineur | fusion | **La fiche d'info reste ouverte après une fusion, et « Vendre +35 » vend en fait la lanterne fusionnée N2 pour +70** — Scénario : appui long sur la lanterne B (la fiche s'ouvre : N1, « Vendre +35 »), puis on glisse la lanterne A sur B sans fermer la fiche. La fusion réussit, mais la fiche affiche toujours N1, les stats N1 et « Vendre +35 ». Un toucher sur Vendre vend alors la lanterne N2 qu'on vient de fusionner (or 400 -> 470). | Fermer la fiche (hud.hideInfo) sur les événements fuse, sell et rewindEnd qui touchent la tour affichée. Ou bien la redessiner à partir de l'id courant, en gardant la tour par id et non par référence. | ✅ Corrigé (bloc 1) |
| D11 | mineur | rembobinage | **On peut poser une lanterne réelle sur le socle d'un écho : les deux se superposent et la tour réelle est masquée** — towerAt() et canPlaceTower() ignorent les échos. Après un rembobinage, reposer « au même endroit » est accepté (6 sur 6), et chaque socle porte alors la lanterne réelle et son écho. L'écho, translucide indigo et dessiné par-dessus (y + 0,01), masque la tour réelle pendant 10 s. | Soit interdire la pose sur un écho, soit (mieux) dessiner l'écho décalé ou en halo derrière la tour réelle, réduit, avec le badge 影 visible. Signaler la repose par l'animation de pose habituelle par-dessus l'écho. | ✅ Corrigé (bloc 1) |
| A14 | info | rembobinage / statistiques | **stats.towersBuilt est ramené à l'instantané : l'écran de victoire sous-compte les lanternes** — finishRewind restaure stats en entier. Les lanternes posées après l'instantané, devenues des échos, ne sont donc plus comptées dans « Lanternes » sur l'écran de victoire (main.js:417). | Restaurer seulement kills et leaks, et garder towersBuilt (ou compter les échos à part). | ✅ Corrigé (bloc 1) |

## Lisibilité et UX mobile (23)

| ID | Gravité | Zone | Constat | Correction prévue | Statut |
|---|---|---|---|---|---|
| B2 | majeur | pose | **Le fantôme de pose et la lanterne glissée sont dessinés sous le doigt (décalage 0 px à la pose, 17 px à la fusion)** — Pendant la pose, le fantôme, la croix d'invalidité et le centre de l'aperçu sont dessinés sur la case située sous le point de contact, donc entièrement cachés par la pulpe du doigt (≈ 44-57 px). Seul l'anneau de portée dépasse. | Calculer la case visée à toTile(x, y - 60) et dessiner le fantôme et l'aperçu à cet endroit, avec un fil ou un réticule vers le doigt. Près de la rangée 0, réduire progressivement le décalage. | ✅ Corrigé (bloc 2 UX) |
| B5 | majeur | HUD:fiche | **La fiche d'info cache la palette, le bouton de vague et 4 rangées du plateau, le jeu continue dessous et elle ne se ferme pas d'un toucher à côté** — La fiche fait 295 px de haut, ancrée en bas. Elle recouvre entièrement le bouton de vague (46 px), la palette (77-83 px) et 157 px du plateau (rangées 9 à 12, dont le sanctuaire). La partie n'est pas en pause. Toucher le plateau ailleurs ne la ferme pas. | Fiche compacte placée dans la moitié de l'écran opposée à la tour. Fermeture par un toucher à l'extérieur et par un glissement vers le bas (ou retirer le grip). Option de ralenti ou de pause douce pendant la lecture. | ✅ Corrigé (bloc 2 UX) |
| B7 | majeur | HUD:découvrabilité | **L'appui long (infos, vente) n'est enseigné nulle part et ne montre aucune progression** — La vente et les statistiques ne sont accessibles que par un appui long de 430 ms. Le tutoriel ne connaît que place, wave, fuse, combo, stone et rewind : aucune étape n'enseigne l'info ou la vente. Toucher une tour n'affiche que sa portée, sans invitation. | Toucher une tour ouvre une mini-fiche (nom, niveau, Vendre, priorité de ciblage). L'appui long ouvre les détails. Dessiner un anneau qui se remplit pendant l'appui. | ✅ Corrigé (bloc 2 UX) |
| B14 | mineur | carte de présentation | **La carte « Nouveau yokai » cache les rangées 0 à 2 (portail, yokai présenté, socles, barre de boss) pendant 5,5 s et avale les touchers** — La carte apparaît au moment où le yokai sort, en haut du plateau (87 px de haut, de bord à bord). Elle cache le portail et le yokai qu'elle présente. En 1-1, elle cache aussi 4 socles ((1,1), (2,1), (3,1), (5,1)), et toucher l'un d'eux ferme seulement la carte sans poser. | Présenter le yokai pendant la phase de construction (aperçu de vague), ou en petite pastille latérale ou basse qui ne couvre ni les rangées des portails ni la barre de boss. Option de pause automatique au premier yokai. | ✅ Corrigé (bloc 2 UX) |
| B15 | mineur | tutoriel | **Les bulles du tutoriel cachent ce qu'elles enseignent et restent affichées pendant la pose** — Tutorial.update ne masque l'indication que pendant un drag, une fiche ou une pause : pas pendant ui.press. 1-2 : la bulle « Un autre élément à côté = combo » couvre la lanterne voisine, le lien de combo et le nom « Vapeur » de l'aperçu qu'on est en train de faire naître. | Masquer l'indication pendant ui.press et pendant les gestes en cours. Placer la bulle hors de la case cible, de ses 8 voisines, du sanctuaire et des libellés du HUD (tester les collisions). | ✅ Corrigé (bloc 2 UX) |
| B16 | mineur | pose / daltonisme | **Pour le Feu, l'aperçu valide et l'aperçu invalide ont presque la même couleur (ratio 1,32)** — Un aperçu valide prend la couleur de l'élément, un aperçu invalide le vermillon. Pour le Feu : #e2552f contre #c8402a, soit presque la même teinte et un ratio de luminance de 1,32. Le refus ne se lit qu'à l'opacité (0,65 contre 0,35) et à une petite croix d'encre, cachée par le doigt (B2). | État invalide neutre (gris ou hachures, anneau en tirets) et pictogramme de la raison (pièce barrée, cadenas) au-dessus du doigt, avec un court texte. Ne jamais compter sur la teinte seule. | ✅ Corrigé (bloc 2 UX) |
| B18 | mineur | HUD / lisibilité | **Textes sous 12 px dans le DOM et dans le canvas** — DOM : « VAGUE » 9,5 px (HUD), kanji des outils 12 px (11,5 px quand la hauteur fait moins de 720 px), « BOSS » 10 px (carte), étiquette « NOUVEAU YOKAI » 10,5 px, pied de l'écran titre 11,5 px, sous-titres des mondes et « 0/12 » 11,5 px, numéros des nœuds 12 px. | Plancher de 12 px partout (13 px conseillé pour les infos de jeu). Agrandir le libellé VAGUE ou le remplacer par une icône. Sceaux du canvas ≥ 16 px, ou retirer le texte au profit d'une icône. | 🟡 Partiel (bloc 2 UX) : DOM ≥ 12 px ; quelques textes du canvas (fx) restent plus petits |
| B19 | mineur | contrastes | **Plusieurs contrastes sous le seuil WCAG AA (4,5:1)** — Crème sur vermillon : 4,08 (bouton de vague en 17 px gras, boutons principaux en 16 px, toast d'erreur en 15 px, nom du boss en 13 px, étiquette en 10,5 px). Kanji crème sur Vent : 3,06 ; sur Pierre : 3,52. Coût en vermillon quand l'or manque : 3,77. Sous-titre de la fiche et texte de la carte de présentation : 4,46. | Fonds vermillon sous du texte : foncer jusqu'à ≈ #a8321f (ratio ≥ 4,5) ou passer le texte en encre. Badges Vent et Pierre plus foncés ou texte encre. Coût insuffisant en vermillon foncé avec une icône. | ✅ Corrigé (bloc 2 UX) |
| B20 | mineur | HUD / zones tactiles | **Boutons trop serrés : 4 px entre son, vitesse et pause, 6 px entre outils et bouton de vague** — Les trois boutons du haut font bien 44×44, mais seulement 4 px les séparent : on peut passer en ×2 en visant la pause. La palette est espacée de 6 px. Entre le bouton de vague et la palette, l'écart est de 6-7 px, et l'outil sélectionné remonte de 4 px (translateY(-4px)), ce qui le réduit à environ 3 px. | Écarts d'au moins 8 px. Retirer le bouton son du HUD (il est dans la pause) pour donner de l'air à vitesse et pause. Garder au moins 8 px entre le bouton de vague et l'outil sélectionné. | ✅ Corrigé (bloc 2 UX) |
| B21 | mineur | plateau / zones tactiles | **Cases du plateau sous 44 pt : 43 px en 390, 47 px en 430, 36 px en 375×667** — La grille de 9×13 donne des cases de 43 px (390×844) et 36 px (375×667, iPhone SE), sans marge entre deux socles adjacents. Un toucher à 22 px du centre tombe sur la case voisine. La précision tient tant que l'aperçu est visible, ce qui n'est pas le cas aujourd'hui (B2). | Le fantôme décalé de 60 px avec aimantation au socle libre le plus proche compense le manque de précision. Pour les yokai et les tours, sélectionner l'entité la plus proche dans un rayon de 22 px minimum. | 🟡 Atténué (bloc 2 UX) : fantôme soulevé + aimantation au socle libre le plus proche (0,75 case) |
| B22 | mineur | toasts | **Les toasts couvrent la rangée des portails pendant 1,6 s à chaque refus** — Les toasts sont centrés juste sous la barre du haut : 328×37 px sur les rangées 0 et 1 en 390, rangée 0 en 430. Dans tous les niveaux, les apparitions (S) sont en rangée 0. Chaque refus (« Pas assez d'or », « Posez les lanternes… ») cache donc le portail et les yokai qui en sortent, loin de l'endroit où agit le doigt. | Afficher le refus près du fantôme, au-dessus du doigt, ou dans une bande au-dessus de la palette. Garder les toasts centraux pour les événements globaux. | ✅ Corrigé (bloc 2 UX) |
| B24 | mineur | fusion / pose | **Plusieurs gestes s'annulent sans aucun retour** — Lâcher une lanterne portée sur une case vide ou sur le chemin, et glisser hors d'un socle pendant une pose, n'affichent rien : ni animation de retour, ni son, ni message. Seule une fusion sur une tour incompatible affiche un toast. Combiné à B3, un dépôt raté passe pour un bug. | Animer le retour de la lanterne vers son socle (≈ 150 ms), jouer un son d'annulation discret et afficher un petit « annulé » à l'endroit du geste. | ✅ Corrigé (bloc 2 UX) |
| B26 | mineur | rembobinage:jauge | **Hors vague, la jauge de rembobinage prend la moitié de la rangée et tout toucher déclenche une erreur** — En phase de construction, la jauge occupe la moitié gauche de la rangée d'actions avec le libellé ambigu « Pendant la vague ». Tout toucher affiche un toast rouge et joue le son d'erreur. Le bouton de vague passe de 374 à 175 px. Une fois le rembobinage utilisé, l'opacité de 0,42 donne un contraste de 3,0. | Réduire la jauge à un bouton circulaire hors vague, ou en faire une vraie jauge de charge avec un libellé d'état (« prêt dans 4 s »). Hors vague, le toucher affiche une explication neutre plutôt qu'une erreur rouge. | ✅ Corrigé (bloc 2 UX) |
| C19 | mineur | niveaux 1-2 / 1-3 | **Trop de nouveautés à la fois en 1-2 et 1-3, au moment de la falaise de difficulté** — 1-2 introduit à la fois la Terre, la fusion, les combos, les pierres et le kappa (tutorial: fuse, combo, stone). 1-3 introduit le Vent, les tengu et le rembobinage, avec hpScale de 1,0 à 1,4. C'est là que la marge chute (smart ×5,5 → ×2,5, cf. C6). À l'inverse, 2-1 à 2-4 n'introduisent chacun qu'un yokai. | Une nouveauté par niveau : passer à 12 niveaux ou étaler, par exemple fusion en 1-2, Terre et kappa en 1-3, pierres en 1-4. | À corriger |
| D10 | mineur | tutoriel | **La fusion, mécanique décisive, n'est enseignée que par hasard en 1-2** — Seul le niveau 1-2 contient l'étape 'fuse', et celle-ci ne s'affiche que si le joueur possède déjà deux lanternes identiques de même niveau (findPair). Sinon, le tutoriel passe à 'combo' puis 'stone', et la fusion n'est jamais montrée. L'info « même niveau » n'arrive qu'en toast d'erreur. | Rendre l'étape fusion déterministe : en 1-2, offrir ou imposer une deuxième lanterne identique, ou afficher l'indication « posez une 2e lanterne de Feu » puis le geste. | À corriger |
| D14 | mineur | combos | **L'aperçu de combo pendant la pose disparaît sans or, a un rayon faux, et peut être masqué par la bulle du tutoriel** — (1) L'aperçu n'est dessiné que si la pose est valide : avec un or insuffisant, le cas le plus courant quand on planifie, on ne voit ni combo ni cercle. | Afficher l'aperçu même quand la pose est invalide (en grisé, avec « il manque X or »). Calculer le rayon et le mult réels. Masquer le tutoriel pendant ui.press. | ✅ Corrigé (bloc 2 UX) |
| D15 | mineur | chemin | **Le nombre de pierres restantes n'apparaît pas dans la palette, et la limite est simultanée, non totale** — Le bouton Pierre n'affiche que « 10 » (le coût) et ne se grise que si l'or manque. Les pierres restantes ne sont visibles que dans la fiche d'une pierre déjà posée. À zéro, le bouton a l'air disponible et le toucher donne le toast « Plus de pierres disponibles ». | Afficher « 石 4/6 » sur le bouton, le griser à 0, et choisir clairement entre une limite totale (pierres consommées) et une limite simultanée affichée comme telle. | ✅ Corrigé (bloc 2 UX) |
| D18 | mineur | tutoriel | **L'indication « Glissez ◀◀ » réapparaît à chaque vague de 1-3 tant qu'on n'a pas rembobiné** — En phase 2, updateRewind affiche le doigt et la bulle dès que canRewind() est vrai et que 5 s sont disponibles, et ne passe à la phase 3 qu'au premier rembobinage. Un joueur qui ne veut pas rembobiner voit donc l'indication à chaque vague des 7 vagues, au-dessus de la barre du bas. | Limiter l'indication à 2 vagues, ou la retirer après qu'elle a été vue pendant 8 s. | À corriger |
| D20 | mineur | combos | **Les interactions entre combos et absorption des kitsune sont implicites et parfois contre-intuitives** — L'élément d'un combo face à l'absorption n'est indiqué nulle part. Givre frappe en Vent (elements[1]), donc un kitsune de Vent est soigné par le pulse. La Tornade de flammes inflige des dégâts de Feu et une brûlure, donc elle soigne les kitsune de Feu. | Donner à chaque combo un élément explicite affiché, avec un pictogramme sur le sceau. Signaler visuellement « absorbé » quand un combo soigne. | À corriger |
| D21 | mineur | combos | **Le sceau d'un combo vertical se pose sur les lanternes et masque leur niveau ; l'anneau de zone est pâle** — Pour deux tours voisines verticalement, linkGeom place le sceau à 0,18 case de l'axe, à mi-hauteur. Il tombe donc sur le toit ou le pied des deux lanternes et cache le kanji N2 et les ornements N3. | Écarter davantage le sceau (bow plus grand et décalage latéral fixe de 0,5 case pour les paires verticales). Dessiner l'anneau plus opaque au début de la vague ou lors de la sélection d'une tour engagée dans le combo. | ✅ Corrigé (bloc 2 UX) |
| D22 | mineur | fusion | **Pendant le glisser de fusion, la lanterne n'est qu'à 0,4 case (environ 17 px) au-dessus du doigt** — Le fantôme et la case visée sont décalés de ts × 0,4, soit environ 17 px sur iPhone 390 px où ts ≈ 43. Le pouce couvre donc la cible, son ensō et la croix de refus. La refonte vise 60 px. | Utiliser un décalage fixe de 60 px CSS (constante partagée avec la pose), en gardant la case visée sous le fantôme. | ✅ Corrigé (bloc 2 UX) |
| D9 | mineur | rembobinage | **La règle du Rembobinage est expliquée à moitié et ne donne plus de retour après la première fois** — La modale dit seulement : « le temps recule de 6 s » et « les lanternes posées depuis laissent un écho fantôme… Posez, rembobinez, reposez ». | Compléter la modale avec un schéma avant/après (or rendu, vies rendues, yokai qui reviennent). À chaque rembobinage, afficher des textes flottants « +X or rendu », « +N vies » et « −Y or (yokai revenus) ». | À corriger |
| B28 | info | index.html / accessibilité | **Zoom bloqué et défilement des modales impossible** — Le viewport impose user-scalable=no et maximum-scale=1, et main.js bloque les événements gesture* et tous les touchmove. Combiné aux textes de 9,5 à 12 px, un joueur malvoyant ne peut pas zoomer. | Laisser passer touchmove quand la cible est dans un conteneur défilable (e.target.closest('.scroll')). Compenser l'absence de zoom par des tailles de texte suffisantes, voire une option « texte agrandi ». | À corriger |

## Déséquilibres (19)

| ID | Gravité | Zone | Constat | Correction prévue | Statut |
|---|---|---|---|---|---|
| A4 | majeur | tour:fire / tour:water | **Un seul élément suffit à gagner : Feu seul gagne 6 niveaux sur 8 à 20/20, Eau seule gagne aussi 6 niveaux sur 8 dont le niveau final** — Cible de la refonte : « aucune tour ne gagne seule ». J'ai lancé le bot smart restreint à un élément (fusions, pierres et rembobinage autorisés). Feu seul gagne 1-1, 1-2, 1-3, 1-4, 2-1 et 2-3, toujours à 20/20. Eau seule gagne 1-1 à 2-1 ainsi que 2-3 (4/20) et 2-4 (4/20). Vent seul gagne 1-3, 1-4, 2-1 et 2-2 (12/20). | Donner à chaque tour un trou net : Feu sans effet sur l'air ou ×0,5 sur les blindés, Eau DPS très bas (contrôle seulement), Vent faible au sol, Terre lente. | À corriger |
| A5 | majeur | fusion / combos | **La fusion est un gain pur, sans contrepartie : +15 à +31 % de DPS, un socle libéré, aucun coût, et des combos plus forts** — Cible de la refonte : tension entre fusion et combo. Pour le même or, un N2 vaut 1,27 à 1,31 fois deux N1, et un N3 vaut 1,15 à 1,27 fois deux N2, en plus d'une portée accrue (+70 % d'aire), du splash dès N2 pour l'Eau et le Vent, et d'un socle libéré. | Exemples : le combo ne s'active qu'entre lanternes de même niveau, ou son bonus diminue quand l'écart de niveau augmente. La fusion coûte de l'or ou un temps d'arrêt (lanterne inactive 3 s). | À corriger |
| C1 | majeur | tours (stratégie mono) | **Une seule tour gagne presque tout : l'Eau seule gagne 7/8 niveaux, Feu 6/8, Vent 6/8 ; Feu+Eau gagne 8/8** — Bot smart limité à une seule tour (fusion, pierres et rembobinage autorisés). Eau : 7/8 niveaux gagnés, dont le niveau final 2-4 (4/20 vies), 2-1 à 20/20, 2-3 à 4/20 ; elle ne perd que 2-2. Feu : 6/8, à 20/20 sur chaque victoire ; il perd 2-2 (vague 8) et 2-4 (vague 9). | Donner à chaque tour une faiblesse dure : un ralentissement non cumulable en zone et des dégâts d'Eau quasi nuls contre les boss et les rapides, des blindés qui résistent vraiment au Feu (y compris à la brûlure), des vol … | À corriger |
| C13 | majeur | économie | **Un quart de l'or arrive quand il ne sert plus ; les récompenses ne suivent pas les PV ; le bonus d'appel est gratuit** — La dernière vague rapporte 20 à 26 % de l'or total possible (1-1 : 120/507 ; 1-2 : 214/857 ; 2-1 : 520/1991 ; 2-4 : 672/2961). Cela inclut les primes de boss, Aka-oni 120 et Gashadokuro 300, plus 5 or par kodama invoqué : elles tombent quand la partie se termine. Smart finit 2-4 avec 688 or. | Faire suivre les récompenses de hpScale (en partie) ; déplacer les boss avant la dernière vague ou convertir leur prime en score ou en étoiles  | À corriger |
| C14 | majeur | niveau:2-4 / ennemi:tengu | **En 2-4, les tengu décident seuls de l'issue : 6,7 s de vol, couverts par seulement 4 socles** — En 2-4, la ligne de vol S(1,0) → G(5,7) mesure 8,1 cases, soit 6,7 s de vol, contre 37 s de marche au sol pour un kodama. Seuls 4 socles atteignent cette ligne (portée 2,3 : exposition cumulée des 4 meilleurs 11,1 s ; dans les autres niveaux, 6 à 24 socles et 15 à 16 s). | Ajouter 2 ou 3 socles proches de la ligne de vol, ou allonger le vol (apparition des volants à l'autre bout) ; réduire les multiplicateurs de PV des tengu de 2-3 et 2-4 (2,2 à 2,7) ; afficher la ligne de vol. | À corriger |
| C2 | majeur | fusion | **La fusion est toujours strictement meilleure : aucune tension avec les combos** — La fusion transforme 2 tours de niveau N en 1 tour N+1. Elle est gratuite, n'exige pas d'adjacence (canFuse ne vérifie que le type et le niveau) et libère un socle. DPS par 100 or, N1 → N2 → N3 : Feu 40,8 → 52 → 65,8 ; Terre 20,3 → 26 → 31,7 ; Eau 13,3 → 17,3 → 20  | Créer un vrai choix. Par exemple : fusion seulement entre tours adjacentes (elle détruit alors un combo voisin) ; coût de fusion en or ou tour inactive quelques secondes ; N3 à spécialisation A/B  | À corriger |
| C3 | majeur | tour:wind | **Le Vent n'est le meilleur à rien : le Feu le bat contre les volants, l'Eau le bat pour retarder** — Contre les volants, DPS par or : N1 Feu 20,4 DPS pour 50 or (0,41/or) contre Vent 12,6 pour 55 or (0,23/or) ; N2 Feu 0,52 contre Vent 0,30 ; N3 Feu 131,6 pour 200 or (0,66/or) contre Vent 85,8 pour 220 or (0,39/or). Le bonus ×2 / ×2,2 contre les volants ne compense pas le faible dégât de base. | Lui donner un rôle exclusif. Par exemple : seule tour à toucher les volants « hauts » ; recul qui interrompt les capacités (invocation, soin, charge) ; ou bonus contre volants porté à ×3,5 avec un coût réduit à 45. | À corriger |
| C6 | majeur | courbe de difficulté entre niveaux | **Début trop facile, falaise en 1-3, progression non monotone, boss final expédié en 15 s** — Marge = multiplicateur de PV le plus élevé que la stratégie gagne encore (recherche binaire, environ ±0,2 de bruit), smart / basic : 1-1 ×6,8 / ×4,9 (le bot lazy, 3 Feu N1, gagne à ×3,2 et finit avec 409 or inutilisés) ; 1-2 ×5,5 / ×4,6 ; 1-3 ×2,5 / ×1,8 ; 1-4 ×2,4 / ×1,45 ; 2-1 ×2,4 / ×1,6 ; 2-2 ×1,6 / ×0,72  | Viser une marge smart décroissante et régulière (par exemple de ×2,0 en 1-1 à ×1,25 en 2-4), avec un bot basic qui perd à partir de 1-3 et lazy qui perd dès 1-2. Lisser hpScale (1-2 : 1,0 → 1-3 : 1,4 est trop brusque  | À corriger |
| C9 | majeur | rembobinage | **Rembobinage gratuit et sans effet mesurable ; il ne peut pas annuler la fuite fatale** — Smart et smart-norewind font les mêmes vies sur 8 niveaux sur 8 (marges ±0,06). Bot « abus » : il garde son or, pose tout à 6 s de vague, rembobine puis repose tout, ce qui crée des échos à 50 % pendant 10 s à chaque vague. Ses marges restent inchangées (1-4 ×2,46 contre ×2,34 ; 2-2 ×1,60  | Jauge chargée par les éliminations ou le temps, avec un coût proportionnel aux secondes remontées. Proposer le rembobinage à la défaite (pause et choix). Échos à 60-75 % qui comptent pour les combos. | À corriger |
| D2 | majeur | fusion | **La fusion domine sans contrepartie : aucune tension entre fusion et combo** — À coût égal, le N3 rend environ 1,6 fois plus de dégâts par or que le N1. Feu : 0,41 dégât/s par or en N1 (20,4 dps pour 50 or), 0,52 en N2, 0,66 en N3 (131,6 dps pour 200 or). Terre : 0,20 -> 0,32. En plus, la portée passe de 2,3 à 3,0 et trois socles se libèrent. | Donner un coût à la fusion : coût d'or, perte de la moitié des combos, ou combo seulement entre tours de même niveau. Par exemple, une tour N2 ou N3 ne crée de combo qu'avec un voisin de niveau au moins égal, ou chaque c … | À corriger |
| A27 | mineur | niveau:1-1 | **1-1 se gagne en 3★ avec trois Feu N1, posés une fois pour toutes** — Le bot lazy (3 Feu N1 et plus rien ensuite) gagne 1-1 à 20/20 avec 409 or jamais dépensé. Le niveau n'apprend rien. Ce n'est pas un problème pour un tutoriel, mais aucune vague ne pousse à poser une Eau. | Ajouter en vague 4 ou 5 un groupe de kamaitachi trop rapide pour le Feu seul (le ralentissement de l'Eau devient nécessaire), ou baisser startGold à 100 tout en raccourcissant le chemin initial. | À corriger |
| C10 | mineur | combos | **Combos très inégaux et marginaux : la Vapeur ne vaut rien, les combos font moins de 2,3 % des dégâts** — Gain de dégâts d'une paire adjacente par rapport à la même paire non adjacente (10 yokai immortels sur 20 cases), tours N1 / N3, contre kodama : Vapeur −0 % / −1 % ; Tornade de flammes +128 % / +47 % ; Magma +69 % / +15 % ; Boue +36 % / +21 % ; Givre +69 % / +55 % ; Sable +31 % / +33 %. | Vapeur : aveuglement plus une vulnérabilité de +25 %, ou une immunité aux absorptions plus large. Tornade : la réduire au niveau N1. Faire compter les échos. | À corriger |
| C17 | mineur | ennemi:yukionna | **La yuki-onna (soigneuse) ne contre aucune stratégie** — Sur tout 2-3, les 13 yuki-onna soignent 2058 PV, soit 4,7 % des 44 168 PV du niveau ; sur 2-4, 548 PV (smart). La Vapeur, censée les contrer, ne change presque rien (10 tués au lieu de 9). Les soins ne se cumulent pas (healT), le rayon est de 1,7 et le soin de 7 % des PV max toutes les 1,3 s. | Soin plus fort mais interruptible (aveuglement, recul), ou bouclier de groupe : il faut un contre net (dégâts en rafale ou Vapeur) et une seconde façon de la battre (la tuer en priorité, ce qui exige des priorités de cib … | À corriger |
| C8 | mineur | pierres | **Pierres peu rentables : gain de chemin plafonné à +4…+10 cases, souvent nul ou négatif dans les simulations** — Recherche exhaustive de la meilleure pose. Chemin maximal : 1-2 23 → 33 (+43 %, 6 pierres) ; 1-3 34 → 38 (2 pierres utiles sur 6) ; 1-4 48 → 56 (4 sur 8) ; 2-1 28 → 34 ; 2-2 44 → 52 ; 2-3 27 → 33 ; 2-4 35 → 39 (2 sur 8). | Agrandir les champs de gravier (au moins 6×5) ou donner aux pierres un second effet (ralentit les yokai adjacents, +portée pour une tour voisine). | À corriger |
| D19 | mineur | chemin | **Les pierres apportent peu : 2 à 5 pierres suffisent pour le gain maximal (+11 à +43 % de chemin), et le bot fait mieux sans** — Une recherche en faisceau donne la plus forte élongation possible par niveau. 1-2 : 23 -> 33 cases (+43 %) avec 5 pierres. 1-3 : +12 % avec 2. 1-4 : +17 % avec 4. 2-1 : +21 % avec 3. 2-2 : +18 % avec 3. 2-3 : +22 % avec 3. 2-4 : +11 % avec 2. Au-delà, le plafond de 6 à 8 pierres ne sert à rien. | Agrandir et diversifier les zones de gravier (couloirs de 2 cases, carrefours) pour permettre de vrais labyrinthes, réduire le plafond à ce qui est utile, et faire varier la valeur des pierres selon les niveaux (par exem … | À corriger |
| D4 | mineur | combos | **La Tempête de sable domine, la Tornade de flammes et le Magma sont des pièges, la Vapeur ne sert que contre deux cas** — Mesure isolée : même paire, avec ou sans combo, couloir de test et 4 Feu N2 voisins sans lien avec la paire. Gain de dégâts totaux apporté par le combo. Sable : +20 à +46 % contre tous les yokai, à tous les niveaux, volants compris (le shred multiplie tous les dégâts de toutes les tours de la zone). | Plafonner le Sable : bonus réservé aux yokai blindés (« certains dégâts ignorent 50 % de l'armure » dans la refonte) ou bonus fixe non multiplicatif. | À corriger |
| A28 | info | combos | **Les dégâts directs des combos restent marginaux (≤ 1,8 % du total)** — Les dégâts directs des combos (pulsation du Givre, tornades) pèsent de 0 à 1,8 % des dégâts dans les parties du bot smart. Les échos ne dépassent pas 0,9 %. L'essentiel se fait au tir (Terre 54 à 75 % des dégâts à partir de 1-3, Feu 12 à 69 %). | Si la refonte veut des combos décisifs, donner à chacun un rôle impossible à obtenir autrement (par exemple : seule source de dégâts aux volants blindés, seul retrait d'un bouclier) plutôt qu'un simple bonus. | À corriger |
| A42 | info | boss | **Une fuite du Gashadokuro (20 dégâts) vaut défaite immédiate en 2-4 (20 vies) ; une fuite de l'Aka-oni limite à 2★** — damage 20 = lives 20 : laisser passer le boss final fait perdre la partie, quel que soit le reste. L'Aka-oni (10 dégâts) ramène au mieux à 2★. Par ailleurs, les invocations du Gashadokuro rapportent ~1,6 or/s tant qu'il vit, donc retenir le boss rapporte de l'or. C'est sans gravité sur la dernière vague. | Choix de design à assumer explicitement (bannière « s'il passe, tout est perdu »), ou damage 12 à 15 pour laisser une chance au Rembobinage. | À corriger |
| C21 | info | tours (DPS et efficacité par ennemi) | **Tableau DPS / coût et efficacité contre chaque yokai (référence pour la refonte)** — DPS sur une cible, entre parenthèses DPS pour 100 or. Feu : 20,4 (40,8), 52 (52), 131,6 (65,8) ; contre kappa 9,2, 23,4, 59,2. Eau : 6 (13,3), 15,6 (17,3), 36 (20). Vent : 6,3 (11,5), 16,5 (15), 39 (17,7) ; contre volants 12,6, 33, 85,8. | Point de départ chiffré pour la refonte (forces et faiblesses par tour). Corriger le commentaire de data/rules.js sur le recul « moyen ». | À corriger |
## Mécaniques : ce qui marche, ce qui ne marche pas

### Combos élémentaires

**Ce qui marche**

- ✓ Détection, persistance et rendu des combos solides (D25)
- ✓ La Vapeur est un vrai contre ciblé (kitsune et boss), et la Boue et le Givre ont chacun une niche (D26)
- ✓ La fusion conserve la zone de combo et donne une nouvelle identité à la lanterne (A36)

**Ce qui ne marche pas ou manque**

- ✗ La Tempête de sable domine, la Tornade de flammes et le Magma sont des pièges, la Vapeur ne sert que contre deux cas (D4, mineur)
- ✗ Combos très inégaux et marginaux : la Vapeur ne vaut rien, les combos font moins de 2,3 % des dégâts (C10, mineur)
- ✗ Les dégâts directs des combos restent marginaux (≤ 1,8 % du total) (A28, info)
- ✗ L'effet des combos n'est jamais expliqué dans le jeu : le champ desc n'est affiché nulle part (D5, majeur)
- ✗ L'aperçu de combo pendant la pose disparaît sans or, a un rayon faux, et peut être masqué par la bulle du tutoriel (D14, mineur)
- ✗ Un combo perdu disparaît en silence, et un combo restauré par le Rembobinage est annoncé une seconde fois (D16, mineur)
- ✗ Les interactions entre combos et absorption des kitsune sont implicites et parfois contre-intuitives (D20, mineur)
- ✗ Le sceau d'un combo vertical se pose sur les lanternes et masque leur niveau ; l'anneau de zone est pâle (D21, mineur)
- ✅ Les combos traitent l'absorption de façon arbitraire : le Givre frappe en « vent », et l'étourdissement, la cécité et l'armure brisée ignorent les immunités (A16, mineur) — corrigé (bloc 1)
- ✗ Les échos ne forment aucun combo et échappent à la frappe de l'Aka-oni (A10, mineur)
- ✗ Les échos ne comptent pas pour les combos (objectif de la refonte) (D12, mineur)

### Fusion

**Ce qui marche**

- ✓ Le geste de fusion et le rendu des trois niveaux sont clairs (D27)
- ✓ La fusion conserve la zone de combo et donne une nouvelle identité à la lanterne (A36)

**Ce qui ne marche pas ou manque**

- ✗ La fusion est un gain pur, sans contrepartie : +15 à +31 % de DPS, un socle libéré, aucun coût, et des combos plus forts (A5, majeur)
- ✗ La fusion est toujours strictement meilleure : aucune tension avec les combos (C2, majeur)
- ✗ La fusion domine sans contrepartie : aucune tension entre fusion et combo (D2, majeur)
- ✗ Pendant le glisser de fusion, rien ne montre le combo qui va disparaître ni la tour qu'on obtiendra (D3, majeur)
- ✗ La fiche de tour ne montre ni le coût de fusion, ni le niveau suivant, ni le DPS, ni la priorité de ciblage, et la fusion ne prévient pas des combos perdus (B27, majeur)
- ✅ La fiche d'info reste ouverte après une fusion, et « Vendre +35 » vend en fait la lanterne fusionnée N2 pour +70 (D1, mineur) — corrigé (bloc 1)
- ✅ Fusion : la zone de dépôt est décalée vers le bas, viser la lanterne échoue en silence (B3, majeur) — corrigé (bloc 1)
- ✗ Pendant le glisser de fusion, la lanterne n'est qu'à 0,4 case (environ 17 px) au-dessus du doigt (D22, mineur)
- ✅ Crash latent : la fusion se fonde sur rules.maxTowerLevel et non sur le nombre de niveaux de la tour (A3, mineur) — corrigé (bloc 1)

### Chemin modifiable (pierres)

**Ce qui marche**

- ✓ Validation des pierres et chemin dynamique robustes : aucun yokai coincé ni case invalide sur 320 parties aléatoires (A32)
- ✓ Le chemin modifiable est sûr : refus de blocage, tracé mis à jour aussitôt, pas de jonglage possible (D28)
- ✓ À garder : la pose est précise, on peut glisser pour ajuster et glisser hors du socle annule (B30)

**Ce qui ne marche pas ou manque**

- ✗ Aucun aperçu du chemin avant de poser une pierre, alors que 75 à 85 % des cases de gravier n'ont aucun effet (D6, majeur)
- ✗ Pas d'aperçu du chemin avant de poser une pierre : un toucher pose tout de suite et on ne peut pas glisser (B11, majeur)
- ✗ Pierres peu rentables : gain de chemin plafonné à +4…+10 cases, souvent nul ou négatif dans les simulations (C8, mineur)
- ✗ Les pierres apportent peu : 2 à 5 pierres suffisent pour le gain maximal (+11 à +43 % de chemin), et le bot fait mieux sans (D19, mineur)
- ✗ Le nombre de pierres restantes n'est pas affiché et l'outil Pierre reste actif à la limite (B10, mineur)
- ✗ Le nombre de pierres restantes n'apparaît pas dans la palette, et la limite est simultanée, non totale (D15, mineur)
- ✗ Les trajectoires des volants ne sont pas dessinées : un labyrinthe de pierres ne montre pas qu'il sera contourné par les airs (D23, mineur)

### Rembobinage

**Ce qui marche**

- ✓ Le rembobinage restaure de façon cohérente l'or, les vies, les pierres, les yokai et les apparitions (A35)
- ✓ Le Rembobinage restaure un état cohérent avec un retour audiovisuel fort, et la jauge est lisible (D29)
- ✓ À garder : jauge de rembobinage robuste, appui long sur tour et pierre fiable, aperçu des combos à la pose (B31)
- ✓ Une vague finit toujours : les rendements décroissants empêchent un blocage par recul, étourdissement et ralentissement (A34)

**Ce qui ne marche pas ou manque**

- ✗ Le Rembobinage sert de bouton « annuler » gratuit : il rend les vies perdues et rembourse 100 % des poses (D7, majeur)
- ✗ Rembobinage gratuit et sans effet mesurable ; il ne peut pas annuler la fuite fatale (C9, majeur)
- ✗ La fuite fatale termine la partie dans le même pas : le Rembobinage disponible ne peut plus sauver le sanctuaire (A12, mineur)
- ✗ Une fuite ne peut pas être annulée si c'est le dernier yokai de la vague (D17, mineur)
- ✅ Fusionner juste avant de rembobiner donne un écho N+1 gratuit tout en gardant les deux N1, et on peut poser pendant l'animation (D8, mineur) — corrigé (bloc 1)
- ✅ Pendant l'animation de rembobinage (1,1 s), les gestes restent actifs et leurs effets deviennent des échos (B25, mineur) — corrigé (bloc 1)
- ✅ Commandes acceptées pendant l'animation de rembobinage : une pierre posée disparaît sans le moindre retour (A11, mineur) — corrigé (bloc 1)
- ✅ Écho et lanterne réelle empilés sur le même socle (A9, mineur) — corrigé (bloc 1)
- ✅ On peut poser une lanterne réelle sur le socle d'un écho : les deux se superposent et la tour réelle est masquée (D11, mineur) — corrigé (bloc 1)
- ✗ Les échos ne forment aucun combo et échappent à la frappe de l'Aka-oni (A10, mineur)
- ✗ Les échos ne sont pas étourdis par le coup de massue des boss (D13, mineur)
- ✅ Le rembobinage ne restaure ni les minuteries de combos ni les tornades (A13, mineur) — corrigé (bloc 1)
- ✗ La règle du Rembobinage est expliquée à moitié et ne donne plus de retour après la première fois (D9, mineur)
- ✗ L'indication « Glissez ◀◀ » réapparaît à chaque vague de 1-3 tant qu'on n'a pas rembobiné (D18, mineur)
- ✗ Hors vague, la jauge de rembobinage prend la moitié de la rangée et tout toucher déclenche une erreur (B26, mineur)
- ✗ Rembobinage tout ou rien (une fois par vague, au moins 1 s), sans jauge ni exemption par yokai (A39, mineur)
- ✗ Il n'existe pas d'ennemi « hors du temps », ni de jauge-ressource pour le Rembobinage (objectifs de la refonte) (D24, info)

### Ciblage, armure, rôles

**Ce qui marche**

- ✓ L'armure partielle est déjà prise en charge : pierce accepte toute valeur de 0 à 1 (A37)
- ✓ Tableau DPS / coût et efficacité contre chaque yokai (référence pour la refonte) (C21)
- ✓ Les rochers non guidés ne ratent pas les kamaitachi aujourd'hui, mais la marge est infime (C20)
- ✓ Les rochers en cloche ne ratent pas leur cible malgré l'absence d'anticipation (A31)
- ✓ Plancher de ralentissement, plafond d'étourdissement et fin de vague garantie : conformes (C22)

**Ce qui ne marche pas ou manque**

- ✗ Ciblage unique « le plus avancé » codé en dur, sans priorité par tour (A7, majeur)
- ✗ Ciblage unique « le plus avancé », sans priorités et sans ignorer les absorbeurs : les kitsune servent de bouclier (C4, majeur)
- ✅ Surpuissance : environ 9 % des tirs à tête chercheuse arrivent sur une cible déjà morte (A23, mineur) — corrigé (bloc 1)
- ✗ Un seul élément suffit à gagner : Feu seul gagne 6 niveaux sur 8 à 20/20, Eau seule gagne aussi 6 niveaux sur 8 dont le niveau final (A4, majeur)
- ✗ Une seule tour gagne presque tout : l'Eau seule gagne 7/8 niveaux, Feu 6/8, Vent 6/8 ; Feu+Eau gagne 8/8 (C1, majeur)
- ✗ Le Vent n'est le meilleur à rien : le Feu le bat contre les volants, l'Eau le bat pour retarder (C3, majeur)
- ✗ La Terre fait la majorité des dégâts mais ne gagne pas seule ; un seul modèle de tour par élément et aucune mise à l'échelle pour 1 à 4 joueurs (C11, majeur)
- ✗ La plupart des yokai n'ont qu'une réponse, pas deux façons d'être vaincus (A41, mineur)
- ✗ La yuki-onna (soigneuse) ne contre aucune stratégie (C17, mineur)
- ✗ Armure tout ou rien et absence de l'ennemi « hors du temps » (C18, mineur)
- ✅ Cumul des statuts : le facteur le plus fort hérite de la durée la plus longue (ralentissement, brûlure, armure brisée) (A1, mineur) — corrigé (bloc 1)
- ✅ Une source faible qui rafraîchit un statut prolonge indéfiniment l'effet fort (ralentissement, brûlure, sable) (C5, mineur) — corrigé (bloc 1)
- ✅ Empiler des sources d'étourdissement réduit l'étourdissement total (C15, mineur) — corrigé (bloc 1)
- ✅ Les effets à l'impact sont liés à un élément fixe (ralentir = eau, brûler = feu, repousser = vent, étourdir = terre) plutôt qu'à l'élément de la tour (A17, mineur) — corrigé (bloc 1)
- ✅ Un boss gelé (étourdi) continue de frapper, d'invoquer et de changer d'élément (A15, mineur) — corrigé (bloc 1)

### Vagues et niveaux

**Ce qui marche**

- ✓ Simulation entièrement déterministe dans un même moteur JS (A33)

**Ce qui ne marche pas ou manque**

- ✗ 5 à 10 vagues par niveau, en rampe presque monotone, sans dents de scie (A8, majeur)
- ✗ 5 à 10 vagues par niveau, rampe quasi monotone sans dents de scie, pics de ×1,9 à ×2,55 (C7, majeur)
- ✗ Début trop facile, falaise en 1-3, progression non monotone, boss final expédié en 15 s (C6, majeur)
- ✗ Un quart de l'or arrive quand il ne sert plus ; les récompenses ne suivent pas les PV ; le bonus d'appel est gratuit (C13, majeur)
- ✗ En 2-4, les tengu décident seuls de l'issue : 6,7 s de vol, couverts par seulement 4 socles (C14, majeur)
- ✗ Appel anticipé seulement entre deux vagues, sans aperçu (A40, mineur)
- ✗ Aucun aperçu de la vague suivante, le bonus d'appel anticipé reste caché et le compte à rebours tourne pendant la fiche (B12, majeur)
- ✗ Une fuite du Gashadokuro (20 dégâts) vaut défaite immédiate en 2-4 (20 vies) ; une fuite de l'Aka-oni limite à 2★ (A42, info)
- ✗ 1-1 se gagne en 3★ avec trois Feu N1, posés une fois pour toutes (A27, mineur)
- ✗ Trop de nouveautés à la fois en 1-2 et 1-3, au moment de la falaise de difficulté (C19, mineur)


## Manques par rapport à la refonte demandée

| ID | Gravité | Zone | Manque | Statut |
|---|---|---|---|---|
| A6 | majeur | multijoueur / déterminisme | Moteur mono-joueur, état non sérialisable en entier, déterminisme non garanti entre Safari et Chrome | À faire |
| A7 | majeur | ciblage | Ciblage unique « le plus avancé » codé en dur, sans priorité par tour | ✅ Fait (moteur + bloc 2 UX : barre d’actions) |
| A8 | majeur | niveaux / vagues | 5 à 10 vagues par niveau, en rampe presque monotone, sans dents de scie | À faire |
| B11 | majeur | outil pierre / chemin | Pas d'aperçu du chemin avant de poser une pierre : un toucher pose tout de suite et on ne peut pas glisser | ✅ Fait (bloc 2 UX) |
| B12 | majeur | bouton de vague | Aucun aperçu de la vague suivante, le bonus d'appel anticipé reste caché et le compte à rebours tourne pendant la fiche | ✅ Fait (bloc 2 UX) |
| B13 | majeur | pause | La pause masque 75 % du plateau (87 % sur iPhone SE) sous un voile sombre | ✅ Fait (bloc 2 UX) |
| B27 | majeur | fiche tour / fusion | La fiche de tour ne montre ni le coût de fusion, ni le niveau suivant, ni le DPS, ni la priorité de ciblage, et la fusion ne prévient pas des combos perdus | ✅ Fait (bloc 2 UX) |
| B6 | majeur | HUD:ennemis | Appui long sur un yokai : rien ne se passe, et aucune statistique d'ennemi n'est consultable dans le jeu | ✅ Fait (bloc 2 UX) |
| B8 | majeur | pose / fusion / vente | Aucune annulation (3 s) pour une pose, une fusion ou une vente, et Vendre est le bouton principal | 🟡 Partiel (bloc 2 UX) : annulation de pose 3 s ; vente secondaire avec confirmation ; pas d’annulation de fusion |
| B9 | majeur | palette | On ne peut pas savoir ce que fait une lanterne avant de l'acheter | ✅ Fait (bloc 2 UX) |
| C11 | majeur | tour:earth / multijoueur | La Terre fait la majorité des dégâts mais ne gagne pas seule ; un seul modèle de tour par élément et aucune mise à l'échelle pour 1 à 4 joueurs | À faire |
| C12 | majeur | outils (tools/bot.mjs, tools/sim.mjs) | Bots et simulateur peu fiables pour l'équilibrage : graines sans effet, pierres contre-productives, rembobinage aveugle, aucune borne « trop facile » | À faire |
| C4 | majeur | ciblage | Ciblage unique « le plus avancé », sans priorités et sans ignorer les absorbeurs : les kitsune servent de bouclier | À faire |
| C7 | majeur | structure des vagues | 5 à 10 vagues par niveau, rampe quasi monotone sans dents de scie, pics de ×1,9 à ×2,55 | À faire |
| D3 | majeur | fusion | Pendant le glisser de fusion, rien ne montre le combo qui va disparaître ni la tour qu'on obtiendra | ✅ Fait (bloc 2 UX) |
| D5 | majeur | combos | L'effet des combos n'est jamais expliqué dans le jeu : le champ desc n'est affiché nulle part | ✅ Fait (bloc 2 UX) |
| D6 | majeur | chemin | Aucun aperçu du chemin avant de poser une pierre, alors que 75 à 85 % des cases de gravier n'ont aucun effet | ✅ Fait (bloc 2 UX) |
| A29 | mineur | aperçus (combos, chemin, vague) | Le moteur n'offre aucune API d'aperçu sans effet de bord : combos à la pose, chemin au glisser d'une pierre, composition de la prochaine vague | À faire |
| A30 | mineur | pose / annulation | Aucune annulation de pose : une pose ratée coûte 30 % de l'or | ✅ Fait (bloc 2 UX) |
| A39 | mineur | rembobinage / ennemi hors du temps | Rembobinage tout ou rien (une fois par vague, au moins 1 s), sans jauge ni exemption par yokai | À faire |
| A40 | mineur | appel de vague anticipé | Appel anticipé seulement entre deux vagues, sans aperçu | À faire |
| A41 | mineur | ennemis | La plupart des yokai n'ont qu'une réponse, pas deux façons d'être vaincus | À faire |
| B10 | mineur | outil pierre | Le nombre de pierres restantes n'est pas affiché et l'outil Pierre reste actif à la limite | ✅ Fait (bloc 2 UX) |
| B17 | mineur | daltonisme / éléments | Éléments, vies et or ne se distinguent que par la couleur et un kanji (illisible pour des francophones) | ✅ Fait (bloc 2 UX) |
| C18 | mineur | armure / ennemis | Armure tout ou rien et absence de l'ennemi « hors du temps » | À faire |
| D12 | mineur | rembobinage | Les échos ne comptent pas pour les combos (objectif de la refonte) | À faire |
| D23 | mineur | chemin | Les trajectoires des volants ne sont pas dessinées : un labyrinthe de pierres ne montre pas qu'il sera contourné par les airs | ✅ Fait (bloc 2 UX) |
| B29 | info | multijoueur (demande utilisateur) | L'interface actuelle n'a aucune place pour le lobby, le choix d'élément ni les joueurs | À faire |
| D24 | info | rembobinage | Il n'existe pas d'ennemi « hors du temps », ni de jauge-ressource pour le Rembobinage (objectifs de la refonte) | À faire |