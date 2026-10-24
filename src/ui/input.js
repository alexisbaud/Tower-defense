// Contrôles tactiles : tap pour poser, glisser pour fusionner, appui long pour infos.
import { T } from '../core/grid.js';

const LONG_PRESS_MS = 430;
const DRAG_THRESHOLD = 9;

export class Input {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../render/renderer.js').Renderer} renderer
   * @param {object} h  callbacks : game(), onInfo(target), onFeedback(kind, data), onAction(kind)
   */
  constructor(canvas, renderer, h) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.h = h;
    this.ui = { tool: null, press: null, selectedTower: null, drag: null };
    this.down = null;
    this.enabled = true;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', () => this.cancel());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get game() {
    return this.h.game();
  }

  setTool(tool) {
    this.ui.tool = this.ui.tool === tool ? null : tool;
    this.ui.selectedTower = null;
    return this.ui.tool;
  }

  pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  tileOf(p) {
    return this.renderer.toTile(p.x, p.y);
  }

  onDown(e) {
    if (!this.enabled || this.down) return;
    const game = this.game;
    if (!game || game.state === 'won' || game.state === 'lost') return;
    this.h.onAction?.('pointer');
    const p = this.pos(e);
    const tile = this.tileOf(p);
    const tower = game.grid.inBounds(tile.c, tile.r) ? game.towerAt(tile.c, tile.r) : null;
    this.down = { id: e.pointerId, x0: p.x, y0: p.y, t0: performance.now(), tile, tower, moved: false, long: false };
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* certains navigateurs refusent la capture */
    }
    if (tower) {
      this.down.timer = setTimeout(() => {
        if (!this.down || this.down.moved) return;
        this.down.long = true;
        this.ui.drag = null;
        this.ui.selectedTower = tower.id;
        this.h.onInfo?.({ kind: 'tower', tower });
      }, LONG_PRESS_MS);
    } else if (this.ui.tool && this.ui.tool !== 'stone') {
      // Pose : l'aperçu suit le doigt pendant tout le geste, même s'il passe
      // (ou commence) hors d'un socle — relâcher hors socle annule.
      this.down.placing = true;
      this.updatePress(tile);
    } else if (game.grid.inBounds(tile.c, tile.r) && game.grid.stone[game.grid.idx(tile.c, tile.r)]) {
      this.down.timer = setTimeout(() => {
        if (!this.down || this.down.moved) return;
        this.down.long = true;
        this.h.onInfo?.({ kind: 'stone', c: tile.c, r: tile.r });
      }, LONG_PRESS_MS);
    }
  }

  updatePress(tile) {
    const game = this.game;
    const type = this.ui.tool;
    const g = game.grid;
    if (!g.inBounds(tile.c, tile.r) || g.type(g.idx(tile.c, tile.r)) !== T.SLOT || game.towerAt(tile.c, tile.r)) {
      this.ui.press = null;
      return;
    }
    const check = game.canPlaceTower(type, tile.c, tile.r);
    this.ui.press = { kind: 'tower', type, c: tile.c, r: tile.r, valid: check.ok, reason: check.reason };
  }

  onMove(e) {
    const d = this.down;
    if (!d || d.id !== e.pointerId) return;
    const p = this.pos(e);
    const dist = Math.hypot(p.x - d.x0, p.y - d.y0);
    if (!d.moved && dist > DRAG_THRESHOLD) {
      d.moved = true;
      clearTimeout(d.timer);
      if (d.tower && !d.long && this.game.fuse) {
        this.ui.drag = { towerId: d.tower.id, x: p.x, y: p.y, hover: null };
        this.ui.selectedTower = null;
        this.h.onAction?.('dragStart');
      }
    }
    if (this.ui.drag) {
      this.ui.drag.x = p.x;
      this.ui.drag.y = p.y;
      // La lanterne est dessinée au-dessus du doigt : on vise la case sous la lanterne.
      const tile = this.tileOf({ x: p.x, y: p.y - this.renderer.ts * 0.4 });
      const target = this.game.grid.inBounds(tile.c, tile.r) ? this.game.towerAt(tile.c, tile.r) : null;
      this.ui.drag.hover = { c: tile.c, r: tile.r, valid: !!(target && this.game.canFuse(d.tower.id, target.id).ok) };
    } else if (d.placing) {
      this.updatePress(this.tileOf(p));
    }
  }

  onUp(e) {
    const d = this.down;
    if (!d || d.id !== e.pointerId) return;
    clearTimeout(d.timer);
    this.down = null;
    const game = this.game;
    if (this.ui.drag) {
      const hover = this.ui.drag.hover;
      const src = d.tower;
      this.ui.drag = null;
      if (hover && game.grid.inBounds(hover.c, hover.r)) {
        const dst = game.towerAt(hover.c, hover.r);
        if (dst && dst.id !== src.id) {
          const res = game.canFuse(src.id, dst.id);
          if (res.ok) {
            game.fuse(src.id, dst.id);
            this.ui.selectedTower = null;
          } else {
            this.h.onFeedback?.('reject', { reason: res.reason, c: hover.c, r: hover.r });
          }
        }
      }
      return;
    }
    if (d.long) return;
    if (this.ui.press) {
      const { type, c, r } = this.ui.press;
      this.ui.press = null;
      const res = game.canPlaceTower(type, c, r);
      if (res.ok) {
        game.placeTower(type, c, r);
        this.h.onAction?.('placed', { type });
      } else {
        game.emit('reject', { c, r, reason: res.reason });
        this.h.onFeedback?.('reject', { reason: res.reason, c, r });
      }
      return;
    }
    if (d.moved) return;
    this.tap(d.tile, d.tower);
  }

  tap(tile, tower) {
    const game = this.game;
    const g = game.grid;
    if (tower) {
      this.ui.selectedTower = this.ui.selectedTower === tower.id ? null : tower.id;
      this.h.onAction?.('selectTower', { tower });
      return;
    }
    this.ui.selectedTower = null;
    if (!g.inBounds(tile.c, tile.r)) return;
    const i = g.idx(tile.c, tile.r);
    if (this.ui.tool === 'stone') {
      if (g.stone[i]) {
        this.h.onInfo?.({ kind: 'stone', c: tile.c, r: tile.r });
        return;
      }
      const res = game.canPlaceStone(tile.c, tile.r);
      if (res.ok) {
        game.placeStone(tile.c, tile.r);
        this.h.onAction?.('stone');
      } else {
        game.emit('reject', { c: tile.c, r: tile.r, reason: res.reason });
        this.h.onFeedback?.('reject', { reason: res.reason, c: tile.c, r: tile.r });
      }
      return;
    }
    if (g.stone[i]) {
      this.h.onInfo?.({ kind: 'stone', c: tile.c, r: tile.r });
      return;
    }
    if (this.ui.tool && g.type(i) !== T.SLOT) {
      this.h.onFeedback?.('hint', { reason: 'slot', c: tile.c, r: tile.r });
    }
  }

  cancel() {
    if (this.down) clearTimeout(this.down.timer);
    this.down = null;
    this.ui.press = null;
    this.ui.drag = null;
  }

  reset() {
    this.cancel();
    this.ui.tool = null;
    this.ui.selectedTower = null;
  }
}
