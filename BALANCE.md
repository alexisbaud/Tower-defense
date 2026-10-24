# Équilibrage — Jardin des Esprits

> Fichier généré par `node tools/balance-md.mjs > BALANCE.md` à partir de `data/`. Ne pas modifier à la main.

Principes : chaque lanterne a une force et une faiblesse nettes, chaque yokai contre une stratégie et a au moins deux réponses. 
Aucune lanterne ne gagne seule : `node tools/sim.mjs --check` vérifie qu’aucun niveau (hors le premier) n’est gagnable avec une seule lanterne, que le bot équilibré gagne chaque niveau seul et en coopération, et qu’aucune vague ne double brutalement la difficulté.

## Éléments

| Élément | Forme | Style | Description |
|---|---|---|---|
| 火 Feu (`fire`) | triangle | Offensif | Dégâts bruts et brûlures qui ignorent l’armure. Fragile face aux kitsune de feu. |
| 水 Eau (`water`) | drop | Contrôle et soin | Ralentit, soigne les barrières et transperce les files de yokai. |
| 風 Vent (`wind`) | diamond | Mobilité et soutien | Repousse, abat les volants et accélère les lanternes voisines. |
| 土 Terre (`earth`) | square | Défense et chemin | Barrières, pierres et coups qui brisent les armures. Ne touche pas les volants. |

## Lanternes

Coût d’un niveau N = coût × 2^(N−1) : une fusion consomme une lanterne identique. DPS = dégâts × cadence (+ brûlure), sur une cible sans armure.

### 火 Feu

**火 Brasero** (`fire`) — Dégâts, tir, cibles : sol + air, priorité par défaut : first  
Force : Gros dégâts sur une cible ; la brûlure ignore l’armure.  
Faiblesse : Petits coups au N1 : les carapaces les encaissent. Soigne les kitsune de feu.

| Niv. | Coût total | Portée | Cadence | Dégâts | DPS | Effets |
|---|---|---|---|---|---|---|
| 1 | 50 | 2.3 | 1.10/s | 14 | 20.4 | brûlure 5/s 2 s |
| 2 | 100 | 2.6 | 1.25/s | 24 | 39 | brûlure 9/s 2.5 s |
| 3 | 200 | 3 | 1.45/s | 40 | 74 | brûlure 16/s 3 s |

**砲 Mortier hanabi** (`fire_mortar`) — Zone à longue portée, tir en cloche, cibles : sol, priorité par défaut : strong  
Force : Très longue portée, explosion qui brise la moitié de l’armure.  
Faiblesse : Lent, rate les yokai rapides et ne touche pas les volants.

| Niv. | Coût total | Portée | Cadence | Dégâts | DPS | Effets |
|---|---|---|---|---|---|---|
| 1 | 70 | 3.2 | 0.45/s | 30 | 17.5 | zone 1, perce 50 % d’armure, brûlure 4/s 1.5 s |
| 2 | 140 | 3.5 | 0.47/s | 55 | 32.8 | zone 1.15, perce 50 % d’armure, brûlure 7/s 1.5 s |
| 3 | 280 | 3.8 | 0.52/s | 95 | 61.4 | zone 1.3, perce 50 % d’armure, brûlure 12/s 2 s |

**燐 Feux follets** (`fire_wisp`) — Aura brûlante, aura, cibles : sol + air, priorité par défaut : first  
Force : Brûle tous les yokai proches à la fois, carapaces comprises.  
Faiblesse : Portée très courte ; inutile contre les kitsune de feu.

| Niv. | Coût total | Portée | Cadence | Dégâts | DPS | Effets |
|---|---|---|---|---|---|---|
| 1 | 60 | 1.3 | 4/s | — | 9 | aura 9/s |
| 2 | 120 | 1.4 | 4/s | — | 17 | aura 17/s |
| 3 | 240 | 1.6 | 4/s | — | 32 | aura 32/s |

### 水 Eau

**水 Fontaine glacée** (`water`) — Ralentissement, tir, cibles : sol + air, priorité par défaut : first  
Force : Ralentit tout ce qu’elle touche ; zone dès le N2.  
Faiblesse : Presque aucun dégât : ne tue rien seule.

| Niv. | Coût total | Portée | Cadence | Dégâts | DPS | Effets |
|---|---|---|---|---|---|---|
| 1 | 45 | 2.2 | 1/s | 4 | 4 | ralentit ×0.6 1.4 s |
| 2 | 90 | 2.5 | 1.15/s | 7 | 8.0 | zone 0.6, ralentit ×0.5 1.8 s |
| 3 | 180 | 2.9 | 1.35/s | 11 | 14.9 | zone 0.9, ralentit ×0.42 2.2 s |

**泉 Source sacrée** (`water_spring`) — Soin des barrières, soutien, cibles : aucune, priorité par défaut : first  
Force : Rend les barrières presque indestructibles ; dissipe les étourdissements.  
Faiblesse : N’attaque pas.

| Niv. | Coût total | Portée | Cadence | Dégâts | DPS | Effets |
|---|---|---|---|---|---|---|
| 1 | 55 | 2.2 | 2/s | — | — | soigne les barrières 14/s, dissipe 30 % des étourdissements |
| 2 | 110 | 2.5 | 2/s | — | — | soigne les barrières 30/s, dissipe 50 % des étourdissements |
| 3 | 220 | 2.9 | 2/s | — | — | soigne les barrières 55/s, dissipe 80 % des étourdissements |

**瀑 Torrent** (`water_torrent`) — Jet perçant, jet perçant, cibles : sol + air, priorité par défaut : first  
Force : Touche tous les yokai alignés et les ralentit.  
Faiblesse : Faible contre un yokai isolé ; direction du jet imposée par la cible.

| Niv. | Coût total | Portée | Cadence | Dégâts | DPS | Effets |
|---|---|---|---|---|---|---|
| 1 | 65 | 3 | 0.70/s | 15 | 10.5 | ralentit ×0.8 1 s, largeur 0.45 |
| 2 | 130 | 3.3 | 0.75/s | 27 | 20.3 | ralentit ×0.75 1.2 s, largeur 0.5 |
| 3 | 260 | 3.6 | 0.80/s | 48 | 38.4 | ralentit ×0.7 1.4 s, largeur 0.55 |

### 風 Vent

**風 Bourrasque** (`wind`) — Recul, tir, cibles : sol + air, priorité par défaut : first  
Force : Repousse les yokai ; dégâts doublés contre les volants.  
Faiblesse : Faible au sol ; boss et yokai hors du temps résistent au recul.

| Niv. | Coût total | Portée | Cadence | Dégâts | DPS | Effets |
|---|---|---|---|---|---|---|
| 1 | 55 | 2.3 | 0.90/s | 7 | 6.3 | recul 0.5, volants ×2 |
| 2 | 110 | 2.6 | 1/s | 13 | 13 | zone 0.5, recul 0.8, volants ×2 |
| 3 | 220 | 3 | 1.15/s | 24 | 27.6 | zone 0.8, recul 1.1, volants ×2.2 |

**鈴 Carillon fūrin** (`wind_chime`) — Soutien, soutien, cibles : aucune, priorité par défaut : first  
Force : Accélère toutes les lanternes proches (non cumulable).  
Faiblesse : N’attaque pas.

| Niv. | Coût total | Portée | Cadence | Dégâts | DPS | Effets |
|---|---|---|---|---|---|---|
| 1 | 60 | 1.6 | 2/s | — | — | cadence voisines +20 % |
| 2 | 120 | 1.8 | 2/s | — | — | cadence voisines +35 % |
| 3 | 240 | 2 | 2/s | — | — | cadence voisines +55 % |

**弓 Arc-tempête** (`wind_bow`) — Tireur antiaérien, tir, cibles : sol + air, priorité par défaut : strong  
Force : Abat les volants de loin ; ignore la moitié de l’armure.  
Faiblesse : Cadence lente : débordé par les groupes.

| Niv. | Coût total | Portée | Cadence | Dégâts | DPS | Effets |
|---|---|---|---|---|---|---|
| 1 | 70 | 3.6 | 0.60/s | 26 | 15.6 | perce 50 % d’armure, volants ×2.5 |
| 2 | 140 | 3.9 | 0.65/s | 46 | 29.9 | perce 50 % d’armure, volants ×2.5 |
| 3 | 280 | 4.3 | 0.70/s | 80 | 56 | perce 50 % d’armure, volants ×2.5 |

### 土 Terre

**土 Catapulte de roc** (`earth`) — Zone, tir en cloche, cibles : sol, priorité par défaut : first  
Force : Dégâts de zone lourds ; ignore la moitié de l’armure.  
Faiblesse : Lente et incapable de toucher les volants.

| Niv. | Coût total | Portée | Cadence | Dégâts | DPS | Effets |
|---|---|---|---|---|---|---|
| 1 | 65 | 2.2 | 0.55/s | 24 | 13.2 | zone 0.85, perce 50 % d’armure |
| 2 | 130 | 2.5 | 0.58/s | 44 | 25.5 | zone 1, perce 50 % d’armure |
| 3 | 260 | 2.8 | 0.62/s | 78 | 48.4 | zone 1.2, perce 50 % d’armure, étourdit 0.4 s |

**壁 Gardien de pierre** (`earth_guard`) — Barrière, barrière, cibles : aucune, priorité par défaut : first  
Force : Arrête les yokai au sol et les regroupe pour les attaques de zone.  
Faiblesse : Les volants et les kasa-obake passent par-dessus ; l’ushi-oni la fracasse.

| Niv. | Coût total | Portée | Cadence | Dégâts | DPS | Effets |
|---|---|---|---|---|---|---|
| 1 | 60 | 1.6 | 1/s | — | — | barrière 160 PV, relevée en 6 s |
| 2 | 120 | 1.8 | 1/s | — | — | barrière 340 PV, relevée en 5 s |
| 3 | 240 | 2 | 1/s | — | — | barrière 700 PV, relevée en 4 s, épines 10/s |

**震 Tambour du séisme** (`earth_quake`) — Contrôle et brise-armure, impulsion, cibles : sol, priorité par défaut : first  
Force : Étourdit un groupe et brise les armures (les autres lanternes en profitent).  
Faiblesse : Impulsions espacées ; sans effet sur les volants.

| Niv. | Coût total | Portée | Cadence | Dégâts | DPS | Effets |
|---|---|---|---|---|---|---|
| 1 | 75 | 1.8 | 0.25/s | 18 | 4.5 | perce 50 % d’armure, étourdit 0.6 s, brise l’armure 3 s |
| 2 | 150 | 2 | 0.27/s | 34 | 9.2 | perce 50 % d’armure, étourdit 0.7 s, brise l’armure 3.5 s |
| 3 | 300 | 2.2 | 0.30/s | 62 | 18.6 | perce 50 % d’armure, étourdit 0.8 s, brise l’armure 4 s |

## Yokai

| Yokai | PV | Vitesse | Armure | Résistances | Récompense | Dégâts | Attaque (barrières) | Capacités |
|---|---|---|---|---|---|---|---|---|
| Kodama (`kodama`) | 40 | 0.95 | 0 | — | 3 | 1 | 8/s | — |
| Kamaitachi (`kamaitachi`) | 26 | 2 | 0 | Vent −50 % | 4 | 1 | 6/s | — |
| Kappa (`kappa`) | 110 | 0.8 | 10 | Eau −50 % | 6 | 2 | 14/s | — |
| Karasu-tengu (`tengu`) | 55 | 1.2 | 0 | — | 5 | 1 | 0/s | flying |
| Nuppeppō (`nuppeppo`) | 95 | 0.8 | 0 | — | 4 | 2 | 10/s | split |
| Petit nuppeppō (`nuppeppo_ko`) | 34 | 1.15 | 0 | — | 2 | 1 | 5/s | — |
| Kitsune (`kitsune`) | 85 | 1.3 | 0 | — | 5 | 1 | 10/s | absorb |
| Yuki-onna (`yukionna`) | 80 | 0.9 | 0 | Eau −100 %, Feu +40 % | 7 | 2 | 8/s | healAura |
| Ushi-oni (`ushioni`) | 260 | 0.7 | 6 | — | 11 | 3 | 70/s | — |
| Kasa-obake (`kasaobake`) | 60 | 1.3 | 0 | — | 5 | 1 | 6/s | hop |
| Tokihami (`tokihami`) | 150 | 0.9 | 0 | — | 8 | 2 | 12/s | timeless |
| Aka-oni (`akaoni`) **boss** | 1700 | 0.5 | 15 | Feu −30 % | 70 | 10 | 120/s | stomp, enrage |
| Gashadokuro (`gashadokuro`) **boss** | 5200 | 0.4 | 0 | — | 180 | 20 | 200/s | summon, cycleAbsorb, enrage |

| Yokai | Force | Faiblesse | Contres |
|---|---|---|---|
| Kodama | Nombreux. | Fragile : tout l’abat. | Toutes les lanternes |
| Kamaitachi | Très rapide : traverse les défenses lentes ; résiste au Vent. | Peu de PV ; s’arrête net devant une barrière. | Ralentissement (Eau, Boue), barrière, Brasero |
| Kappa | Armure 10 : les coups rapides et faibles sont presque annulés ; résiste à l’Eau. | Lent ; brûlures et brise-armure le traversent. | Catapulte et mortier (perce), Séisme ou Tempête de sable (brise-armure), Feux follets, lanternes fusionnées |
| Karasu-tengu | Vole : ignore le chemin, les pierres, les barrières et la Terre. | Fragile face au Vent. | Arc-tempête, Bourrasque (×2), Tornade de flammes, Brasero |
| Nuppeppō | Se divise : les tirs à cible unique s’y épuisent. | Lent, fragments fragiles et groupés. | Zone : Catapulte, Mortier, Feux follets, Magma, Torrent |
| Petit nuppeppō | Rapide. | Très fragile. | Dégâts de zone |
| Kitsune | Absorbe un élément : punit les défenses d’un seul élément. | Sans défense contre les autres éléments. | Un autre élément, ou la Vapeur (pouvoirs suspendus) |
| Yuki-onna | Soigne ses voisins ; insensible à l’Eau. | Fragile si on l’isole ; craint le Feu. | Priorité « plus fort », Vapeur, recul du Vent, Feu |
| Ushi-oni | Brise les barrières très vite ; armure 6, résiste au recul. | Lent hors charge ; se laisse étourdir et ralentir. | Séisme ou Givre (étourdissement), Eau, Source sacrée derrière la barrière |
| Kasa-obake | Saute les barrières ; assez rapide. | Fragile ; aveuglé par la Vapeur, il ne saute plus. | Vapeur, Brasero, Bourrasque, Torrent |
| Tokihami | Hors du temps : le Rembobinage ne le ramène pas en arrière, le Vent ne le repousse pas. | Se laisse ralentir et étourdir. | Givre ou Séisme (étourdissement), Eau et Boue (ralentissement), dégâts soutenus |
| Aka-oni | Armure 15, massue qui étourdit les lanternes, fracasse les barrières. | Lent ; son armure se brise. | Séisme ou Tempête de sable (brise-armure), Catapulte, Source sacrée (purifie l’étourdissement) |
| Gashadokuro | Énorme, invoque des kodama, change d’élément absorbé. | Très lent ; la Vapeur suspend ses pouvoirs. | Plusieurs éléments à la fois, Vapeur, zone pour les invocations |

## DPS effectif au niveau 1 (armure et résistances comprises)

Une case à 0 : la lanterne ne peut pas toucher ce yokai (volant, absorption non comptée). Lire en colonne : les meilleures réponses à chaque yokai.

| Lanterne | Kodama | Kamaitachi | Kappa | Karasu-tengu | Nuppeppō | Petit nuppeppō | Kitsune | Yuki-onna | Ushi-oni | Kasa-obake | Tokihami | Aka-oni | Gashadokuro |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Brasero | 20.4 | 20.4 | 9.4 | 20.4 | 20.4 | 20.4 | 20.4 | 28.6 | 13.8 | 20.4 | 20.4 | 5.7 | 20.4 |
| Mortier hanabi | 12.5 | 12.5 | 10.9 | 0 | 12.5 | 12.5 | 12.5 | 17.5 | 11.5 | 12.5 | 12.5 | 6.3 | 12.5 |
| Feux follets | 7.5 | 7.5 | 7.5 | 7.5 | 7.5 | 7.5 | 7.5 | 10.5 | 7.5 | 7.5 | 7.5 | 5.3 | 7.5 |
| Fontaine glacée | 4.4 | 4.4 | 0.4 | 4.4 | 4.4 | 4.4 | 4.4 | 0 | 0.9 | 4.4 | 4.4 | 0.9 | 4.4 |
| Torrent | 8.1 | 8.1 | 0.8 | 8.1 | 8.1 | 8.1 | 8.1 | 0 | 4.8 | 8.1 | 8.1 | 1.6 | 8.1 |
| Bourrasque | 5.7 | 2.9 | 1.1 | 11.5 | 5.7 | 5.7 | 5.7 | 5.7 | 1.1 | 5.7 | 5.7 | 1.1 | 5.7 |
| Arc-tempête | 11.1 | 5.6 | 9 | 27.9 | 11.1 | 11.1 | 11.1 | 11.1 | 9.9 | 11.1 | 11.1 | 7.9 | 11.1 |
| Catapulte de roc | 10.2 | 10.2 | 8.0 | 0 | 10.2 | 10.2 | 10.2 | 10.2 | 8.9 | 10.2 | 10.2 | 7.0 | 10.2 |
| Tambour du séisme | 3 | 3 | 2.2 | 0 | 3 | 3 | 3 | 3 | 2.5 | 3 | 3 | 1.8 | 3 |

(valeurs ramenées à un coût de 50 or pour comparer les lanternes entre elles)

## Combos

Deux lanternes d’éléments différents voisines (diagonale comprise). Puissance : +40 % par niveau de la lanterne la plus faible ; un écho du Rembobinage agit à 60 %.

| Combo | Éléments | Effet | Contre |
|---|---|---|---|
| 霧 Vapeur | 火 Feu + 水 Eau | Un nuage de vapeur aveugle les yokai : ils perdent leurs pouvoirs (soin, absorption, saut, invocation) et ralentissent. | Kitsune, Yuki-onna, Kasa-obake, Gashadokuro |
| 炎嵐 Tornade de flammes | 火 Feu + 風 Vent | Une tornade de feu tourne autour des lanternes et brûle tout sur son passage, volants compris. | Karasu-tengu |
| 泥 Boue | 水 Eau + 土 Terre | Le sol se change en boue : les yokai terrestres s’y enlisent. | Kamaitachi, Petit nuppeppō |
| 熔 Magma | 火 Feu + 土 Terre | Des fissures de lave brûlent les yokai qui marchent dessus (la brûlure ignore l’armure). | Nuppeppō, Kappa |
| 氷 Givre | 水 Eau + 風 Vent | Une bourrasque glacée gèle régulièrement les yokai sur place, même ceux qui sont hors du temps. | Tokihami, Ushi-oni |
| 砂 Tempête de sable | 風 Vent + 土 Terre | Le sable brise carapaces et armures : armure annulée et dégâts subis +25 %. | Kappa, Aka-oni |

## Règles

| Règle | Valeur |
|---|---|
| Vente | 70 % de l’or investi |
| Récompense de fin de vague (défaut) | 25 or |
| Appel anticipé | 1 or par seconde d’avance (à chaque joueur) et 3 de jauge par seconde |
| Pause entre vagues (défaut) | 14 s après la fin des apparitions |
| Armure | retranchée de chaque coup, au moins 20 % du coup passe ; brûlures et auras l’ignorent |
| Ralentissement | jamais sous 35 % de la vitesse |
| Rembobinage | 6 s en arrière pour une jauge de 100 (1.5 par pièce d’or de récompense) ; échos 10 s à 50 % |
| Dernière chance | 4 s pour rembobiner après une fuite fatale (jauge pleine) |
| Étoiles | 3★ ≥ 85 % des vies, 2★ ≥ 50 % |
| Coopération (1 → 4 joueurs) | or de départ ×1 / 0.65 / 0.55 / 0.5 par joueur, récompenses ×1 / 0.6 / 0.45 / 0.38 à chacun, PV des yokai ×1 / 1.2 / 1.4 / 1.6 |

## Niveaux

| Niveau | Leçon | Vagues | Or | Vies | PV ×| Lanternes | Nouveaux yokai | Climax | Défi | Difficile |
|---|---|---|---|---|---|---|---|---|---|---|
| 1-1 Le Seuil | Poser et lancer | 11 | 180 | 20 | 2 | 4 | Kodama, Kamaitachi | v11 La Horde du seuil | Dix lanternes : Gagner en posant dix lanternes au plus (une fusion compte ses deux lanternes). | PV ×2.2, or -20, vies -5 |
| 1-2 Le Jardin des renards | Combos | 12 | 300 | 20 | 2.5 | 4 | Kitsune | v12 Le Cortège des renards | Sans Vent : Gagner avec trois éléments seulement : aucune lanterne de Vent. | PV ×1.4, or -20, vies -5 |
| 1-3 L'Étang du temps | Rembobinage | 12 | 320 | 20 | 1 | 6 | Nuppeppō, Karasu-tengu, Tokihami | v12 L'Heure dévorée | Sans rembobinage : Gagner sans jamais remonter le temps. | PV ×1.5, or -20, vies -5 |
| 1-4 La Clairière de l'Oni | Pierres et barrières | 12 | 340 | 20 | 4 | 8 | Kappa, Aka-oni | v12 La Marche de l'Aka-oni | Sans pierre : Gagner sans poser une seule pierre : les barrières seules tiennent le chemin. | PV ×1.2, or -20, vies -5 |
| 2-1 Les Terrasses gelées | Priorité | 12 | 380 | 20 | 3 | 12 | Yuki-onna | v12 La Procession des neiges | Sans Terre : Gagner sans lanterne de Terre : ni catapulte, ni gardien, ni séisme. | PV ×1.7, or -30, vies -5 |
| 2-2 Les Deux Portes | Deux chemins | 13 | 400 | 20 | 1 | 12 | Kasa-obake, Ushi-oni | v13 La Charge des taureaux | Sans Eau : Gagner sans lanterne d’Eau : ni fontaine, ni source, ni torrent (et donc sans Vapeur ni Boue). | PV ×1.3, or -30, vies -5 |
| 2-3 Le Ciel de fer | Volants et blindés | 13 | 400 | 20 | 2 | 12 | — | v13 La Nuée de fer | Cœur intact : Gagner avec au moins 15 vies au sanctuaire. | PV ×1.15, or -30, vies -5 |
| 2-4 Le Dernier Torii | Boss final | 14 | 420 | 20 | 3 | 12 | Gashadokuro | v14 Les Os du géant | Aucune fuite : Gagner sans qu’un seul yokai n’atteigne le sanctuaire. | PV ×1.15, or -30, vies -5 |

### Courbe de menace par vague

Menace = PV effectifs (armure, vitesse, dégâts au sanctuaire) de la vague, en centaines. ▲ = vague climax.

```
1-1  ▁▁▁▁▁▂▁▃▅▂█▲  4 7 10 6 20 26 11 51 98 39 191
1-2  ▁▁▁▁▁▂▁▃▃▅▂█▲  9 14 16 13 32 60 17 117 132 182 79 353
1-3  ▁▁▁▁▁▁▁▂▃▁▅█▲  5 11 20 4 32 39 8 62 94 31 178 345
1-4  ▁▁▁▁▂▂▁▃▃▁▅█▲  24 40 46 12 75 82 18 101 103 30 203 391
2-1  ▁▁▁▁▁▂▁▃▃▁▅█▲  19 21 41 12 42 80 36 88 111 26 177 347
2-2  ▁▁▁▁▂▂▁▂▂▃▂▅█▲  8 9 16 6 25 27 11 33 36 50 32 99 191
2-3  ▁▁▁▁▁▁▁▂▂▁▄▆█▲  13 14 17 14 33 55 32 94 102 31 199 296 457
2-4  ▁▁▁▁▁▂▁▂▃▁▂▄▅█▲  18 41 73 23 76 150 30 168 264 82 175 343 531 890
```

