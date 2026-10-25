// Contrôles tactiles du plateau.
//
//   Lanterne choisie   le fantôme flotte LIFT px au-dessus du doigt (case visée = case
//                      sous le fantôme) ; la pose se valide au RELÂCHEMENT, relâcher hors
//                      socle annule. Un simple toucher sur un socle pose sur ce socle :
//                      doigt immobile, le fantôme ne se soulève qu'après LIFT_MS, en une
//                      montée visible de RISE_MS ; tant qu'elle n'est pas finie, relâcher
//                      reste un toucher (pas de pose une rangée trop haut sur un toucher lent).
//   Outil pierre       même geste : le nouveau chemin s'affiche avant de relâcher.
//   Lanterne           toucher : sélection (barre d'actions) ; appui long : fiche ;
//                      glisser : fusion (la lanterne portée flotte au-dessus du doigt).
//                      En coopération, la lanterne d'un coéquipier ne se fusionne pas.
//   Socle d'abord      sans outil, un toucher sur un socle libre le choisit (anneau or) :
//                      la carte touchée ensuite y pose aussitôt (main.js, pickTool).
//   Fusion guidée      « Fusionner » (barre d'actions) : les jumelles s'allument ; un toucher
//                      sur l'une d'elles l'absorbe dans la lanterne choisie ; ailleurs, annulé.
//   Yokai              appui long sur le yokai le plus proche du doigt : sa fiche.
//   Déplacer le mur    (Gardien de pierre) un toucher sur une case allumée y déplace
//                      sa barrière ; ailleurs, le mode s'annule.
//   En pause           étude seulement : toucher et appui long, ni pose ni fusion
//                      (réglages permis : priorité, mur d’un Gardien).
//   Dernière chance    aucun geste sur le plateau : seule la jauge compte.
//   Construction       une pose (lanterne, pierre, mur) part comme commande (voir
//                      commands.js) et reste « en construction » 2 s : son socle
//                      refuse une autre pose ; un toucher dessus ouvre la petite barre
//                      « En construction · Annuler » (ou « Pris par Aki »).
// Aucune action n'appelle le moteur directement : tout passe par la façade `commands`.
import { T } from '../core/grid.js';
import { rallyTiles } from './overlay.js';
import { commands } from './commands.js';

export const LONG_PRESS_MS = 430;
const HOLD_DELAY_MS = 110; // l'anneau d'appui long n'apparaît qu'après ce délai (pas sur un toucher)
const DRAG_THRESHOLD = 9;
const LIFT_MS = 260; // doigt immobile plus longtemps : le fantôme commence à se soulever
const RISE_MS = 170; // durée de la montée du fantôme (doigt immobile)
// Le fantôme (pose, pierre, fusion) est dessiné au-dessus du doigt pour rester visible.
export const LIFT = 60;
const ENEMY_RADIUS = 0.6; // rayon de prise d'un yokai, en cases

export class Input {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../render/renderer.js').Renderer} renderer
   * @param {object} h  game(), onInfo(target), onFeedback(kind, data), onAction(kind, data),
   *                    onHold(state, pagePoint, ms), onBoardTouch()
   */
  constructor(canvas, renderer, h) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.h = h;
    // État lu par le rendu : outil, aperçu de pose, sélection, lanterne portée,
    // retour animé d'un dépôt raté, message éphémère, yokai visé.
    // selectedBuild : case d'une construction touchée ({ c, r }, barre « En construction »).
    // selectedSlot : socle choisi sans outil ({ c, r, element }) ; fuseFrom : lanterne dont on
    // cherche la jumelle (fusion guidée).
    this.ui = { tool: null, press: null, selectedTower: null, selectedBuild: null, selectedSlot: null, fuseFrom: null, drag: null, dragBack: null, flash: null, focusEnemy: null, rally: null };
    this.down = null;
    this.enabled = true;
    this.inspect = false; // pause : étude du plateau seulement
    this.stoneKey = null;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => (!this.down || this.down.id === e.pointerId) && this.cancel());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get game() {
    return this.h.game();
  }

  // Un doigt est posé sur le plateau (le tutoriel s'efface).
  get pressing() {
    return !!this.down;
  }

  setTool(tool) {
    // seulement les outils du joueur (coopération : les lanternes de SON élément ;
    // les pierres, à la Terre) — aucun chemin n'en pose d'autres
    this.ui.tool = this.ui.tool === tool || !this.allowed(tool) ? null : tool;
    this.ui.selectedTower = null;
    this.ui.selectedBuild = null;
    this.ui.selectedSlot = null;
    this.ui.fuseFrom = null;
    this.ui.rally = null;
    return this.ui.tool;
  }

  // Fusion guidée : la lanterne d'identifiant id cherche sa jumelle (null : fin).
  setFuse(id) {
    this.ui.fuseFrom = id;
    if (id != null) {
      this.ui.tool = null;
      this.ui.selectedSlot = null;
      this.ui.rally = null;
      this.ui.selectedTower = id;
    }
  }

  // L'outil est-il celui du joueur local ? (palette : game.availableTowers)
  allowed(tool) {
    const game = this.game;
    if (!game || !tool) return false;
    if (tool === 'stone') return !!game.stoneConf?.() && (typeof game.canUseStones !== 'function' || game.canUseStones());
    return game.availableTowers.includes(tool);
  }

  // Mode « Déplacer le mur » d'un Gardien de pierre (null : quitter).
  setRally(towerId) {
    this.ui.rally = towerId != null ? { towerId } : null;
    if (towerId != null) {
      this.ui.tool = null;
      this.ui.selectedTower = towerId;
      this.ui.selectedBuild = null;
    }
  }

  pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // Point du canvas -> coordonnées page (anneau d'appui long, bulles).
  page(p) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y };
  }

  tileOf(p) {
    return this.renderer.toTile(p.x, p.y);
  }

  // Point visé : LIFT px au-dessus du doigt. Près du haut du plateau, le décalage
  // diminue pour que le fantôme ne dépasse pas le centre de la rangée 0.
  aim(p, lifted = true) {
    if (!lifted) return { x: p.x, y: p.y };
    const top = this.renderer.oy + this.renderer.ts * 0.5;
    const k = Math.max(0, Math.min(LIFT, p.y - top));
    return { x: p.x, y: p.y - k };
  }

  // ───────────────────────── cibles sous le doigt ─────────────────────────

  // Lanterne sous le doigt, ou la plus proche dans un rayon d'au moins 24 px
  // (0,6 case : une lanterne reste touchable sur les petites cases de l'iPhone SE).
  towerNear(p) {
    const game = this.game;
    const tile = this.tileOf(p);
    if (game.grid.inBounds(tile.c, tile.r)) {
      const t = game.towerAt(tile.c, tile.r);
      if (t) return t;
    }
    const ts = this.renderer.ts;
    let best = null;
    let bd = Math.max(24, ts * 0.6);
    for (const t of game.towers) {
      const s = this.renderer.toScreen(t.x, t.y - 0.3);
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  // Yokai le plus proche du doigt, dans ~0,6 case (au moins 22 px).
  enemyNear(p, radius = ENEMY_RADIUS) {
    const game = this.game;
    const ts = this.renderer.ts;
    let best = null;
    let bd = Math.max(22, ts * radius);
    for (const e of game.enemies) {
      if (!e.alive) continue;
      // centre visuel : le corps est au-dessus du point au sol, plus haut pour un volant
      const s = this.renderer.toScreen(e.x, e.y - (e.flying ? 0.55 : 0.22));
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  // Socle libre le plus proche du point visé (aimantation), dans `radius` cases.
  // `element` : seuls les socles universels ou gravés de cet élément attirent.
  nearestFreeSlot(a, radius, element = null) {
    const game = this.game;
    const g = game.grid;
    const ts = this.renderer.ts;
    let best = null;
    let bd = radius * ts;
    for (let i = 0; i < g.size; i++) {
      if (g.type(i) !== T.SLOT) continue;
      const se = g.slotElement?.[i];
      if (element && se && se !== element) continue;
      const c = g.col(i);
      const r = g.row(i);
      if (game.towerAt(c, r) || game.echoes?.some((t) => t.c === c && t.r === r) || commands.buildAt(c, r)) continue;
      const s = this.renderer.toScreen(c + 0.5, r + 0.5);
      const d = Math.hypot(s.x - a.x, s.y - a.y);
      if (d < bd) {
        bd = d;
        best = { c, r };
      }
    }
    return best;
  }

  // ───────────────────────── gestes ─────────────────────────

  onDown(e) {
    if (!this.enabled || this.down) return;
    const game = this.game;
    if (!game || game.state === 'won' || game.state === 'lost') return;
    // Pendant l'animation du rembobinage ou la dernière chance, aucun geste n'est pris en compte.
    if (game.rewindAnim || game.lastChanceT > 0) return;
    this.h.onAction?.('pointer');
    const p = this.pos(e);
    const tile = this.tileOf(p);
    const g = game.grid;
    const inB = g.inBounds(tile.c, tile.r);
    const d = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, t0: performance.now(), tile, moved: false, long: false, lifted: false, mode: 'empty' };
    this.down = d;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* certains navigateurs refusent la capture */
    }
    // Un toucher sur le plateau ferme la fiche ouverte.
    this.h.onBoardTouch?.();
    // « Déplacer le mur » vaut aussi en pause (comme la priorité) : les cases allumées
    // l'étaient, mais le toucher n'y faisait rien.
    if (this.ui.rally) {
      d.mode = 'rally';
      return;
    }
    // fusion guidée : le toucher choisit la jumelle (ou annule)
    if (this.ui.fuseFrom != null && !this.inspect) {
      d.mode = 'fuse';
      d.tower = this.towerNear(p);
      return;
    }
    const tool = this.inspect ? null : this.ui.tool;
    if (tool) {
      d.mode = tool === 'stone' ? 'stone' : 'place';
      d.tower = inB ? game.towerAt(tile.c, tile.r) : null;
      d.stoneHere = inB && !!g.stone[g.idx(tile.c, tile.r)];
      d.build = inB && !!commands.buildAt(tile.c, tile.r); // construction en cours sous le doigt
      // Doigt immobile : après un court instant, le fantôme monte au-dessus du doigt
      // (animation suivie par tick) ; la case visée ne change qu'une fois la montée finie.
      d.liftTimer = setTimeout(() => {
        if (this.down !== d || d.lifted) return;
        d.rise0 = performance.now();
        this.updateAim();
      }, LIFT_MS);
      this.stoneKey = null;
      this.updateAim();
      return;
    }
    const tower = this.towerNear(p);
    // Un yokai nettement visé l'emporte sur la lanterne du socle (volant au-dessus d'un socle).
    const enemy = this.enemyNear(p, tower ? 0.32 : ENEMY_RADIUS);
    if (enemy) {
      d.mode = 'enemy';
      d.enemy = enemy;
      d.tower = tower; // un simple toucher garde la lanterne sous le doigt (un volant qui passe)
      this.ui.focusEnemy = enemy.id;
      this.startHold(d, p, () => this.h.onInfo?.({ kind: 'enemy', enemy }));
    } else if (tower) {
      d.mode = 'tower';
      d.tower = tower;
      this.startHold(d, p, () => {
        this.ui.drag = null;
        this.ui.selectedTower = tower.id;
        this.h.onInfo?.({ kind: 'tower', tower });
      });
    } else if (inB && g.stone[g.idx(tile.c, tile.r)]) {
      d.mode = 'stoneInfo';
      this.startHold(d, p, () => this.h.onInfo?.({ kind: 'stone', c: tile.c, r: tile.r }));
    } else if (inB && game.echoes?.some((t) => t.c === tile.c && t.r === tile.r)) {
      // Écho (lanterne fantôme du Rembobinage) : toucher ou appui long le présentent.
      d.mode = 'echo';
      d.echo = game.echoes.find((t) => t.c === tile.c && t.r === tile.r);
      this.startHold(d, p, () => this.h.onInfo?.({ kind: 'echo', echo: d.echo }));
    } else if (inB && commands.buildAt(tile.c, tile.r)) {
      // Construction en cours (lanterne ou pierre) : un toucher ouvre sa petite barre.
      d.mode = 'build';
    } else if (inB && !this.inspect && g.type(g.idx(tile.c, tile.r)) === T.SLOT && !game.echoes?.some((t) => t.c === tile.c && t.r === tile.r)) {
      // Socle libre sans outil : socle d'abord (un toucher le choisit).
      d.mode = 'slot';
    }
  }

  // Appui long : l'anneau (ensō) se remplit sous le doigt, puis `fire`.
  startHold(d, p, fire) {
    d.holdTimer = setTimeout(() => {
      if (this.down === d && !d.moved) this.h.onHold?.('start', this.page(p), LONG_PRESS_MS - HOLD_DELAY_MS);
    }, HOLD_DELAY_MS);
    d.timer = setTimeout(() => {
      if (this.down !== d || d.moved) return;
      d.long = true;
      this.h.onHold?.('end');
      fire();
    }, LONG_PRESS_MS);
  }

  stopHold(d) {
    if (!d) return;
    clearTimeout(d.timer);
    clearTimeout(d.holdTimer);
    clearTimeout(d.liftTimer);
    this.h.onHold?.('end');
  }

  onMove(e) {
    const d = this.down;
    if (!d || d.id !== e.pointerId) return;
    const p = this.pos(e);
    d.x = p.x;
    d.y = p.y;
    const game = this.game;
    if (!game) return;
    if (!d.moved && Math.hypot(p.x - d.x0, p.y - d.y0) > DRAG_THRESHOLD) {
      d.moved = true;
      if (d.mode === 'place' || d.mode === 'stone') {
        d.lifted = true;
      } else {
        this.stopHold(d);
        if (d.mode === 'enemy') this.ui.focusEnemy = null;
        const mine = !(game.players?.length > 1) || d.tower?.owner === game.localPlayer;
        if (d.mode === 'tower' && !d.long && !this.inspect && !mine) {
          this.h.onFeedback?.('owner', { tower: d.tower, x: p.x, y: p.y });
        } else if (d.mode === 'tower' && !d.long && !this.inspect && game.fuse && !commands.towerBusy(d.tower.id)) {
          // (lanterne déjà en route vers une fusion ou une vente : elle ne se reprend pas)
          const a = this.aim(p);
          this.ui.drag = { towerId: d.tower.id, x: p.x, y: p.y, gx: a.x, gy: a.y, hover: null, preview: null };
          this.ui.selectedTower = null;
          this.h.onAction?.('dragStart');
        }
      }
    }
    if (this.ui.drag) this.updateDrag(p);
    else if (d.mode === 'place' || d.mode === 'stone') this.updateAim();
  }

  // Lanterne portée (fusion) : elle flotte au-dessus du doigt ; la cible est la
  // lanterne compatible la plus proche (aimantation), avec l'aperçu du résultat.
  updateDrag(p) {
    const drag = this.ui.drag;
    const src = this.game.towerById(drag.towerId);
    if (!src) {
      this.ui.drag = null;
      return;
    }
    const a = this.aim(p);
    drag.x = p.x;
    drag.y = p.y;
    drag.gx = a.x;
    drag.gy = a.y;
    const hover = this.fuseTarget(src, a.x, a.y, p.x, p.y);
    const key = hover ? `${hover.c},${hover.r},${hover.valid}` : '';
    if (key !== drag.key) {
      drag.key = key;
      drag.hover = hover;
      drag.preview = hover?.valid && this.game.previewFuse ? this.game.previewFuse(src.id, hover.id) : null;
      if (hover?.valid) this.h.onAction?.('fuseHover', { tower: src });
    }
  }

  // Cible de fusion : lanterne compatible dont le corps (≈ 0,3 case au-dessus du
  // centre du socle) est à moins de 0,8 case de la lanterne portée. À défaut, la
  // case sous la lanterne portée (pour afficher un refus clair).
  // Le doigt posé SUR une jumelle compte aussi quand le fantôme ne vise rien :
  // c'est le geste que montre le tutoriel (« glissez une lanterne sur sa jumelle »).
  fuseTarget(src, gx, gy, fx = null, fy = null) {
    const game = this.game;
    const ts = this.renderer.ts;
    let best = null;
    let bestD = ts * 0.8;
    for (const t of game.towers) {
      if (t.id === src.id || !commands.check('fuse', src.id, t.id).ok) continue;
      const p = this.renderer.toScreen(t.x, t.y - 0.3);
      const d = Math.hypot(p.x - gx, p.y - gy);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (!best && fx != null) {
      const ft = this.tileOf({ x: fx, y: fy });
      const t = game.grid.inBounds(ft.c, ft.r) ? game.towerAt(ft.c, ft.r) : null;
      if (t && t.id !== src.id && commands.check('fuse', src.id, t.id).ok) best = t;
    }
    if (best) return { c: best.c, r: best.r, valid: true, id: best.id };
    const tile = this.tileOf({ x: gx, y: gy + ts * 0.3 });
    // jumelle encore en construction (sous la lanterne portée ou sous le doigt) : elle
    // ne se fusionne qu'une fois allumée ; le refus le dit (« En construction »)
    for (const q of [tile, fx != null ? this.tileOf({ x: fx, y: fy }) : null]) {
      const b = q && commands.buildAt(q.c, q.r, 'placeTower');
      if (b && b.type === src.type) return { c: q.c, r: q.r, valid: false, reason: 'pending', owner: b.pid };
    }
    return { c: tile.c, r: tile.r, valid: false };
  }

  // Montée du fantôme (doigt immobile) : avancement 0..1 et hauteur visée en px.
  riseOf(d, p) {
    const rise = d.lifted ? 1 : d.rise0 != null ? Math.min(1, (performance.now() - d.rise0) / RISE_MS) : 0;
    return { rise, liftPx: p.y - this.aim(p, true).y };
  }

  // Recalcule l'aperçu de pose (lanterne ou pierre) depuis la position du doigt.
  updateAim() {
    const d = this.down;
    if (!d) return;
    const p = { x: d.x, y: d.y };
    const a = this.aim(p, d.lifted);
    if (d.mode === 'place') this.updatePlace(d, a, p);
    else if (d.mode === 'stone') this.updateStone(d, a, p);
  }

  updatePlace(d, a, p) {
    const game = this.game;
    const g = game.grid;
    const type = this.ui.tool;
    const def = game.defs.towers[type];
    if (!def) return;
    const t = this.tileOf(a);
    let target = null;
    const el = def.element ?? type;
    if (g.inBounds(t.c, t.r) && g.type(g.idx(t.c, t.r)) === T.SLOT) target = { c: t.c, r: t.r };
    else target = this.nearestFreeSlot(a, d.lifted ? 0.75 : 0.5, el);
    const press = { kind: 'tower', type, gx: a.x, gy: a.y, fx: p.x, fy: p.y, lifted: d.lifted, ...this.riseOf(d, p), c: null, r: null, valid: false, reason: null, combos: [] };
    if (target) {
      // même règle que la commande : socle en construction, or réservé, élément du joueur
      const chk = commands.check('placeTower', type, target.c, target.r);
      press.c = target.c;
      press.r = target.r;
      press.valid = chk.ok;
      press.reason = chk.reason;
      press.element = chk.element ?? null; // socle gravé d'un autre élément
      press.owner = chk.owner ?? null; // socle déjà en construction : par qui
      if (chk.reason === 'gold') press.missing = commands.missing(type);
      const free = !game.towerAt(target.c, target.r) && !game.echoes?.some((e) => e.c === target.c && e.r === target.r) && !commands.buildAt(target.c, target.r);
      // Combos qui naîtraient (échos et lanternes en construction compris), affichés
      // même si la pose est refusée.
      if (free) press.combos = this.previewCombos(type, target.c, target.r);
    }
    this.ui.press = press;
  }

  // Combos qui naîtraient en posant `type` en (c, r) : lanternes posées et échos
  // (moteur), plus les lanternes voisines encore en construction.
  previewCombos(type, c, r) {
    const game = this.game;
    const out = game.previewCombos ? game.previewCombos(type, c, r) : [];
    const el = game.defs.towers[type]?.element ?? type;
    for (const b of commands.builds()) {
      if (b.op !== 'placeTower' || Math.max(Math.abs(b.c - c), Math.abs(b.r - r)) !== 1) continue;
      if ((game.defs.towers[b.type]?.element ?? b.type) === el) continue;
      const def = game.comboFor?.(type, b.type);
      if (def) out.push({ def, other: { type: b.type, c: b.c, r: b.r, x: b.c + 0.5, y: b.r + 0.5, level: 1, pending: true } });
    }
    return out;
  }

  updateStone(d, a, p) {
    const game = this.game;
    const g = game.grid;
    const t = this.tileOf(a);
    const press = { kind: 'stone', gx: a.x, gy: a.y, fx: p.x, fy: p.y, lifted: d.lifted, ...this.riseOf(d, p), c: null, r: null, valid: false, reason: null, delta: 0, routes: null };
    if (g.inBounds(t.c, t.r)) {
      const i = g.idx(t.c, t.r);
      if (g.type(i) === T.OPEN && !g.stone[i]) {
        const key = `${t.c},${t.r}`;
        if (key !== this.stoneKey || !this.stonePreview) {
          this.stoneKey = key;
          this.stonePreview = game.previewStone ? game.previewStone(t.c, t.r) : { ...game.canPlaceStone(t.c, t.r), delta: 0, routes: [] };
          // refus sonore et visuel à l'entrée sur une case qui couperait le chemin (une fois par case)
          const blocked = !this.stonePreview.ok && this.stonePreview.reason === 'blocked';
          if (blocked && this.blockedKey !== key) this.h.onFeedback?.('stoneBlocked', { c: t.c, r: t.r });
          this.blockedKey = blocked ? key : null;
        }
        const pv = this.stonePreview;
        // tracé et gain du moteur ; validité de la commande (pierre en construction, or réservé)
        const chk = pv.ok || pv.reason === 'gold' || pv.reason === 'limit' ? commands.check('placeStone', t.c, t.r) : pv;
        Object.assign(press, { c: t.c, r: t.r, valid: chk.ok, reason: chk.reason, owner: chk.owner ?? null, delta: pv.delta, routes: pv.routes });
        if (chk.reason === 'gold') press.missing = commands.missing('stone');
      } else if (g.stone[i]) {
        press.c = t.c;
        press.r = t.r;
        press.reason = 'occupied';
        this.stoneKey = null;
        this.blockedKey = null;
      } else {
        this.stoneKey = null;
        this.blockedKey = null;
      }
    }
    this.ui.press = press;
  }

  onUp(e) {
    const d = this.down;
    if (!d || d.id !== e.pointerId) return;
    this.stopHold(d);
    this.down = null;
    const game = this.game;
    if (!game) return;
    if (this.ui.drag) return this.dropDrag();
    if (d.long) return;
    switch (d.mode) {
      case 'place':
        return this.releasePlace(d);
      case 'stone':
        return this.releaseStone(d);
      case 'tower':
        if (!d.moved) this.tapTower(d.tower);
        return;
      case 'enemy':
        // simple toucher sur un yokai : rien (l'appui long ouvre sa fiche), sauf s'il
        // passait au-dessus d'une lanterne : c'est elle qu'on visait.
        this.ui.focusEnemy = null;
        if (!d.moved && d.tower && this.game.towerById(d.tower.id)) this.tapTower(d.tower);
        else if (!d.moved && this.ui.selectedTower != null) this.ui.selectedTower = null;
        return;
      case 'stoneInfo':
        if (!d.moved) this.h.onInfo?.({ kind: 'stone', c: d.tile.c, r: d.tile.r });
        return;
      case 'echo':
        if (d.moved) return;
        this.tapEmpty();
        this.h.onInfo?.({ kind: 'echo', echo: d.echo });
        return;
      case 'rally':
        if (!d.moved) this.tapRally(d);
        return;
      case 'build':
        if (!d.moved) this.tapBuild(d.tile);
        return;
      case 'fuse':
        if (!d.moved) this.tapFuse(d);
        return;
      case 'slot':
        if (!d.moved) this.tapSlot(d.tile);
        return;
      default:
        if (!d.moved) this.tapEmpty();
    }
  }

  // Fusion guidée : la jumelle touchée est absorbée par la lanterne choisie.
  tapFuse(d) {
    const game = this.game;
    const src = d.tower;
    const dst = game.towerById(this.ui.fuseFrom);
    this.ui.fuseFrom = null;
    if (src && dst && src.id !== dst.id && commands.check('fuse', src.id, dst.id).ok && commands.issue('fuse', src.id, dst.id)) {
      this.ui.selectedTower = null;
      this.h.onAction?.('fused', { tower: dst });
      return;
    }
    this.h.onAction?.('fuseCancel');
    this.h.onFeedback?.('fuseCancel', { x: d.x, y: d.y });
  }

  // Socle d'abord : choisir (ou rechoisir) un socle libre.
  tapSlot(tile) {
    const game = this.game;
    const cur = this.ui.selectedSlot;
    this.ui.selectedTower = null;
    this.ui.selectedBuild = null;
    this.ui.rally = null;
    if (cur && cur.c === tile.c && cur.r === tile.r) {
      this.ui.selectedSlot = null;
      this.h.onAction?.('slot', null);
      return;
    }
    const element = game.grid.slotElement?.[game.grid.idx(tile.c, tile.r)] || null;
    // Socle réservé à un élément qu'aucune de MES lanternes ne peut prendre (celui d'un
    // coéquipier, ou interdit par le défi) : refus dit sur le socle. Le choisir affichait
    // « Choisissez une lanterne » avec toutes les cartes grisées (consigne impossible).
    if (element && !game.availableTowers.some((t) => commands.check('placeTower', t, tile.c, tile.r).reason !== 'slotElement')) {
      if (cur) {
        this.ui.selectedSlot = null;
        this.h.onAction?.('slot', null);
      }
      game.emit?.('reject', { c: tile.c, r: tile.r, reason: 'slotElement' });
      this.h.onFeedback?.('reject', { reason: 'slotElement', element, c: tile.c, r: tile.r });
      return;
    }
    this.ui.selectedSlot = { c: tile.c, r: tile.r, element };
    this.h.onAction?.('slot', this.ui.selectedSlot);
  }

  releasePlace(d) {
    const game = this.game;
    const press = this.ui.press;
    this.ui.press = null;
    if (!d.lifted) {
      // Simple toucher sur une lanterne : on range l'outil et on la sélectionne.
      if (d.tower) {
        this.clearTool();
        this.tapTower(d.tower);
        return;
      }
      // … sur une construction en cours : de même, sa barre (« En construction »).
      if (d.build) {
        this.clearTool();
        this.tapBuild(d.tile);
        return;
      }
      // Toucher hors socle : on range l'outil, sans message.
      if (!press || press.c == null) {
        this.clearTool();
        return;
      }
    } else if (!press || press.c == null) {
      // Glisser relâché hors socle : la pose est annulée.
      this.h.onFeedback?.('cancel', { x: press?.gx ?? d.x, y: press?.gy ?? d.y });
      if (d.external) this.clearTool();
      return;
    }
    const { type, c, r } = press;
    const res = commands.check('placeTower', type, c, r);
    const ticket = res.ok ? commands.issue('placeTower', type, c, r) : null;
    if (ticket) {
      // La lanterne apparaît « en construction » et s'allume 2 s plus tard.
      // L'outil se désélectionne après chaque pose : plus d'achat involontaire.
      this.ui.tool = null;
      this.h.onAction?.('placed', { type, c, r, ticket });
    } else {
      const reason = res.ok ? 'unknown' : res.reason;
      game.emit('reject', { c, r, reason });
      this.h.onFeedback?.('reject', { reason, element: res.element, owner: res.owner, c, r, x: press.gx, y: press.gy, missing: reason === 'gold' ? commands.missing(type) : press.missing });
    }
  }

  // Mode « Déplacer le mur » : un toucher sur une case allumée y déplace la
  // barrière du Gardien ; ailleurs, le mode s'annule.
  tapRally(d) {
    const game = this.game;
    const rally = this.ui.rally;
    const t = rally ? game.towerById(rally.towerId) : null;
    this.ui.rally = null;
    if (!t) return;
    const { c, r } = d.tile;
    const g = game.grid;
    const i = g.inBounds(c, r) ? g.idx(c, r) : -1;
    const x = d.x;
    const y = d.y;
    if (i >= 0 && rallyTiles(game, t).includes(i)) {
      // le mur se déplace après la construction (2 s), comme une pose. Un seul
      // déplacement à la fois : celui encore en construction est remplacé (sinon deux
      // murs fantômes pour un même Gardien) ; vers la même case, il continue.
      const prev = commands.builds().filter((b) => b.op === 'setRally' && b.towerId === t.id && b.mine);
      if (prev.some((b) => b.c === c && b.r === r)) {
        this.ui.selectedTower = t.id;
        return;
      }
      if (prev.length && commands.check('setRally', t.id, c, r).ok) for (const b of prev) commands.cancel(b.ticket);
      const ticket = commands.issue('setRally', t.id, c, r);
      if (ticket) {
        this.ui.selectedTower = t.id;
        this.h.onAction?.('rally', { tower: t, c, r, ticket });
        return;
      }
    }
    // toucher la tour elle-même (ou une autre) : simple annulation
    const other = this.towerNear({ x, y });
    if (other) {
      this.h.onFeedback?.('cancel', { x, y });
      this.ui.selectedTower = other.id;
      this.h.onAction?.('selectTower', { tower: other });
      return;
    }
    // case du chemin où se tient un yokai : le mur ne s'y dresse pas (il le traverserait)
    if (i >= 0 && game.groundEnemyOn?.(i)) {
      this.h.onFeedback?.('reject', { reason: 'occupiedEnemy', x, y });
      return;
    }
    const walk = i >= 0 && g.isWalkableType(i);
    this.h.onFeedback?.(walk ? 'rallyFar' : 'cancel', { x, y });
  }

  releaseStone(d) {
    const game = this.game;
    const press = this.ui.press;
    this.ui.press = null;
    this.stoneKey = null;
    this.stonePreview = null;
    if (!d.lifted && d.stoneHere) {
      this.h.onInfo?.({ kind: 'stone', c: d.tile.c, r: d.tile.r });
      return;
    }
    if (!d.lifted && d.build) {
      this.clearTool();
      this.tapBuild(d.tile);
      return;
    }
    if (!press || press.c == null || press.reason === 'occupied') {
      if (!d.lifted) this.clearTool();
      else this.h.onFeedback?.('cancel', { x: press?.gx ?? d.x, y: press?.gy ?? d.y });
      if (d.external) this.clearTool();
      return;
    }
    const { c, r } = press;
    const res = commands.check('placeStone', c, r);
    const ticket = res.ok ? commands.issue('placeStone', c, r) : null;
    if (ticket) {
      this.h.onAction?.('stone', { c, r, ticket });
      // plus de pierre à poser (celles en construction comprises) : l'outil se range
      if (d.external || commands.stonesLeft() <= 0) this.clearTool();
    } else {
      const reason = res.ok ? 'unknown' : res.reason;
      game.emit('reject', { c, r, reason });
      this.h.onFeedback?.('reject', { reason, owner: res.owner, c, r, x: press.gx, y: press.gy, missing: reason === 'gold' ? commands.missing('stone') : press.missing, stone: true });
    }
  }

  dropDrag() {
    const game = this.game;
    const drag = this.ui.drag;
    this.ui.drag = null;
    const src = game.towerById(drag.towerId);
    if (!src) return;
    const hover = drag.hover;
    if (hover?.valid) {
      const dst = game.towerById(hover.id) || game.towerAt(hover.c, hover.r);
      if (dst && commands.issue('fuse', src.id, dst.id)) {
        this.ui.selectedTower = null;
        this.h.onAction?.('fused', { tower: dst });
        return;
      }
    }
    let reason = null;
    if (hover && game.grid.inBounds(hover.c, hover.r)) {
      const other = game.towerAt(hover.c, hover.r);
      if (other && other.id !== src.id) reason = commands.check('fuse', src.id, other.id).reason;
      else if (hover.reason) reason = hover.reason; // jumelle en construction
      if (reason) game.emit('reject', { c: hover.c, r: hover.r, reason });
    }
    // Dépôt raté : la lanterne revient à sa place (animation), avec un retour discret.
    this.ui.dragBack = { towerId: src.id, x: drag.gx, y: drag.gy, t0: performance.now() };
    if (reason) this.h.onFeedback?.('reject', { reason, owner: hover.owner, c: hover.c, r: hover.r, x: drag.gx, y: drag.gy });
    else this.h.onFeedback?.('dropCancel', { x: drag.gx, y: drag.gy });
  }

  tapTower(tower) {
    if (this.ui.tool) this.clearTool();
    this.ui.rally = null;
    this.ui.selectedBuild = null;
    if (this.ui.selectedSlot) {
      this.ui.selectedSlot = null;
      this.h.onAction?.('slot', null);
    }
    // lanterne déjà choisie dont la barre s'est refermée (action faite, 6 s sans geste) :
    // le toucher la rouvre au lieu de la désélectionner
    if (this.ui.selectedTower === tower.id && this.h.barClosed?.(tower.id)) this.h.reopenBar?.(tower.id);
    else this.ui.selectedTower = this.ui.selectedTower === tower.id ? null : tower.id;
    this.h.onAction?.('selectTower', { tower });
  }

  // Construction touchée : sa barre (« En construction · Annuler », « Pris par Aki »).
  tapBuild(tile) {
    const cur = this.ui.selectedBuild;
    this.ui.selectedTower = null;
    this.ui.rally = null;
    this.ui.selectedBuild = cur && cur.c === tile.c && cur.r === tile.r ? null : { c: tile.c, r: tile.r };
    this.h.onAction?.('selectBuild', { c: tile.c, r: tile.r });
  }

  tapEmpty() {
    if (this.ui.selectedSlot) {
      this.ui.selectedSlot = null;
      this.h.onAction?.('slot', null);
    }
    // Avec une lanterne sélectionnée, un toucher ailleurs ne fait que désélectionner.
    if (this.ui.selectedTower != null || this.ui.selectedBuild) {
      this.ui.selectedTower = null;
      this.ui.selectedBuild = null;
      this.ui.rally = null;
      this.h.onAction?.('deselect');
    }
  }

  clearTool() {
    if (!this.ui.tool) return;
    this.ui.tool = null;
    this.h.onAction?.('toolCleared');
  }

  // Pose glissée depuis un bouton de la palette : le geste continue ici
  // (la palette relaie pointermove / pointerup).
  startFromPalette(tool, e) {
    const game = this.game;
    if (!this.enabled || this.inspect || this.down || !game || game.rewindAnim || game.lastChanceT > 0) return false;
    if (game.state === 'won' || game.state === 'lost' || !this.allowed(tool)) return false;
    this.ui.tool = tool;
    this.ui.selectedTower = null;
    this.ui.selectedBuild = null;
    this.ui.rally = null;
    this.ui.fuseFrom = null;
    // socle choisi d'abord, puis carte glissée ailleurs : ce geste remplace le choix
    // (sinon le socle restait choisi, consigne comprise, et la carte touchée ensuite y posait)
    if (this.ui.selectedSlot) {
      this.ui.selectedSlot = null;
      this.h.onAction?.('slot', null);
    }
    const p = this.pos(e);
    this.down = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, t0: performance.now(), tile: this.tileOf(p), moved: true, long: false, lifted: true, external: true, mode: tool === 'stone' ? 'stone' : 'place' };
    this.stoneKey = null;
    this.h.onBoardTouch?.();
    this.updateAim();
    return true;
  }

  // Message éphémère dessiné près du geste (refus, « annulé »). Un refus reste le temps
  // d'être lu : clamp(2200, 1000 + 50 × caractères, 5000) ms ; tile : la case visée
  // (la bulle se pose au-dessus, sa queue vers elle).
  flash(text, x, y, bad = false, tile = null) {
    const ms = bad ? Math.max(2200, Math.min(5000, 1000 + 50 * String(text).length)) : 1100;
    this.ui.flash = { text, x, y, bad, tile, ms, t0: performance.now() };
  }

  // Chaque frame : l'aperçu suit l'or disponible même si le doigt ne bouge pas, et
  // le fantôme achève sa montée (doigt immobile).
  tick() {
    const d = this.down;
    if (d && (d.mode === 'place' || d.mode === 'stone') && this.ui.press) {
      if (!d.lifted && d.rise0 != null && performance.now() - d.rise0 >= RISE_MS) d.lifted = true;
      if (d.mode === 'stone') this.stoneKey = null; // l'or ou les yokai ont pu changer
      this.updateAim();
    }
    if (this.ui.drag && !this.game?.towerById(this.ui.drag.towerId)) this.ui.drag = null;
    // lanterne portée immobile au-dessus d'une jumelle qui s'achève (construction) :
    // la cible suit sans attendre un mouvement du doigt
    else if (this.ui.drag && this.down) this.updateDrag({ x: this.ui.drag.x, y: this.ui.drag.y });
    if (this.ui.rally && !this.game?.towerById(this.ui.rally.towerId)) this.ui.rally = null;
    // Construction sélectionnée achevée : la lanterne allumée prend la sélection
    // (annulée ou refusée : la barre se ferme).
    const sb = this.ui.selectedBuild;
    if (sb && this.game && !commands.buildAt(sb.c, sb.r)) {
      this.ui.selectedBuild = null;
      const t = this.game.towerAt(sb.c, sb.r);
      if (t && (t.owner === this.game.localPlayer || !(this.game.players?.length > 1))) this.ui.selectedTower = t.id;
    }
  }

  cancel() {
    if (this.down) this.stopHold(this.down);
    // pose glissée depuis la palette, interrompue (pause de l'hôte, geste du système) :
    // l'outil se range, comme pour un glisser relâché hors socle
    const external = !!this.down?.external;
    this.down = null;
    if (external) this.clearTool();
    this.ui.press = null;
    this.ui.drag = null;
    this.stoneKey = null;
    this.stonePreview = null;
    this.blockedKey = null;
  }

  reset() {
    this.cancel();
    this.ui.tool = null;
    this.ui.selectedTower = null;
    this.ui.selectedBuild = null;
    this.ui.selectedSlot = null;
    this.ui.fuseFrom = null;
    this.ui.dragBack = null;
    this.ui.flash = null;
    this.ui.focusEnemy = null;
    this.ui.rally = null;
  }
}
