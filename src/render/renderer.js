// Orchestration du rendu Canvas 2D : papier, terrain, entités triées en
// profondeur, projectiles, particules et surcouches d'interface.
import { makePaper, makeVignette } from './paper.js';
import { renderTerrain } from './terrain.js';
import { drawTower } from './towers.js';
import { drawEnemy } from './enemies.js';
import { Fx, ELEMENT_COLORS } from './fx.js';
import { INK, PALETTE, withAlpha, wash } from './brush.js';
import { T } from '../core/grid.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fx = new Fx();
    this.game = null;
    this.theme = null;
    this.w = 1;
    this.h = 1;
    this.dpr = 1;
    this.ts = 32;
    this.ox = 0;
    this.oy = 0;
    this.time = 0;
    this.routes = [];
    this.routeVersion = -1;
  }

  resize(w, h) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.paper = makePaper(this.w, this.h, dpr, this.theme?.paper);
    this.vignette = makeVignette(this.w, this.h, dpr);
    if (this.game) this.layout();
  }

  setGame(game, theme) {
    this.game = game;
    this.theme = theme;
    this.paper = makePaper(this.w, this.h, this.dpr, theme.paper);
    this.fx.reset({ w: game.grid.cols, h: game.grid.rows }, theme.ambient);
    this.routeVersion = -1;
    this.layout();
  }

  layout() {
    const g = this.game.grid;
    const ts = Math.floor(Math.min(this.w / g.cols, this.h / g.rows));
    this.ts = ts;
    this.ox = Math.round((this.w - g.cols * ts) / 2);
    this.oy = Math.round((this.h - g.rows * ts) / 2);
    this.terrain = renderTerrain(g, ts, this.dpr, this.theme);
  }

  // Coordonnées écran (px CSS relatifs au canvas) -> case.
  toTile(px, py) {
    const x = (px - this.ox) / this.ts;
    const y = (py - this.oy) / this.ts;
    return { c: Math.floor(x), r: Math.floor(y), x, y };
  }

  toScreen(x, y) {
    return { x: this.ox + x * this.ts, y: this.oy + y * this.ts };
  }

  onEvents(events) {
    for (const ev of events) this.fx.onEvent(ev, this.game);
  }

  render(dt, alpha, ui = {}) {
    const { ctx, game, ts } = this;
    if (!game) return;
    this.time += dt;
    this.fx.update(dt);
    const time = this.time;
    const dpr = this.dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.paper, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Tremblement d'écran léger.
    let sx = 0;
    let sy = 0;
    if (this.fx.shake > 0 && !ui.reducedMotion) {
      const s = this.fx.shake * ts * 0.12;
      sx = (Math.random() - 0.5) * s;
      sy = (Math.random() - 0.5) * s;
    }
    ctx.save();
    ctx.translate(this.ox + sx, this.oy + sy);

    const pad = this.terrain.pad;
    ctx.drawImage(this.terrain.canvas, -pad, -pad, this.terrain.canvas.width / dpr, this.terrain.canvas.height / dpr);

    this.drawSpawns(ctx, ts, time);
    this.drawRoutes(ctx, ts, time);
    this.drawGoalGlow(ctx, ts, time);
    if (this.drawUnderlay) this.drawUnderlay(ctx, ts, time, ui);

    // Aperçus de pose / portée sous les entités.
    this.drawPlacement(ctx, ts, ui);

    // Entités triées par profondeur.
    const items = [];
    for (const t of game.towers) items.push({ y: t.y, k: 0, o: t });
    for (const e of game.enemies) {
      const ex = e.px + (e.x - e.px) * alpha;
      const ey = e.py + (e.y - e.py) * alpha;
      items.push({ y: e.flying ? ey + 5 : ey, k: 1, o: e, ex, ey });
    }
    if (this.extraDrawables) this.extraDrawables(items);
    items.sort((a, b) => a.y - b.y);
    for (const it of items) {
      if (it.k === 0) {
        const t = it.o;
        if (ui.drag && ui.drag.towerId === t.id) {
          drawTower(ctx, t.x * ts, t.y * ts, ts, game.defs.towers[t.type], t.level, time, { alpha: 0.35 });
          continue;
        }
        drawTower(ctx, t.x * ts, t.y * ts, ts, game.defs.towers[t.type], t.level, time, {
          shot: t.shotT > 0,
          stunned: t.stunT > 0,
        });
      } else if (it.k === 1) {
        const e = it.o;
        drawEnemy(ctx, e, game.defs.enemies[e.type], it.ex * ts, it.ey * ts, ts, time);
      } else if (it.draw) {
        it.draw(ctx, ts, time);
      }
    }

    this.drawProjectiles(ctx, ts, time);
    this.fx.drawParts(ctx, ts);
    if (this.drawOverlayExtra) this.drawOverlayExtra(ctx, ts, time, ui);
    this.fx.drawOverlay(ctx, ts);
    this.drawSelection(ctx, ts, time, ui);
    ctx.restore();

    // Vignettage + flash.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.vignette, 0, 0);
    if (this.fx.flash > 0) {
      ctx.fillStyle = withAlpha(this.fx.flashColor, this.fx.flash * 0.35);
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ui.drag) this.drawDragGhost(ctx, ui.drag, time);
  }

  drawSpawns(ctx, ts, time) {
    const g = this.game.grid;
    for (const s of g.spawns) {
      const x = g.cx(s) * ts;
      const y = g.cy(s) * ts;
      wash(ctx, x, y, ts * 0.75, INK, 0.45);
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = withAlpha(INK, 0.75);
      ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        ctx.rotate(time * (0.8 + k * 0.3) + k * 2);
        ctx.lineWidth = Math.max(1, ts * (0.07 - k * 0.015));
        ctx.beginPath();
        ctx.arc(0, 0, ts * (0.15 + k * 0.1), 0, Math.PI * 1.3);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawGoalGlow(ctx, ts, time) {
    const g = this.game.grid;
    for (const gi of g.goals) {
      const pulse = 0.25 + Math.sin(time * 2) * 0.08;
      wash(ctx, g.cx(gi) * ts, g.cy(gi) * ts - ts * 0.2, ts * 1.1, PALETTE.goldLight, pulse);
    }
  }

  // Tracé actuel des yokai : pointillés d'encre qui avancent vers le sanctuaire.
  drawRoutes(ctx, ts, time) {
    const game = this.game;
    if (this.routeVersion !== game.flow.version) {
      this.routeVersion = game.flow.version;
      this.routes = game.grid.spawns.map((s) => game.flow.route(s));
    }
    const g = game.grid;
    ctx.fillStyle = withAlpha(INK, 0.22);
    for (const route of this.routes) {
      const n = route.length;
      for (let i = 0; i < n - 1; i++) {
        const a = route[i];
        const b = route[i + 1];
        for (let k = 0; k < 2; k++) {
          const f = (k / 2 + time * 0.6) % 1;
          const x = (g.cx(a) + (g.cx(b) - g.cx(a)) * f) * ts;
          const y = (g.cy(a) + (g.cy(b) - g.cy(a)) * f) * ts;
          ctx.beginPath();
          ctx.arc(x, y, ts * 0.045, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  drawProjectiles(ctx, ts, time) {
    for (const p of this.game.projectiles) {
      const c = ELEMENT_COLORS[p.element] || ELEMENT_COLORS.fire;
      const x = p.x * ts;
      const y = (p.y - (p.h || 0)) * ts;
      const a = p.echo ? 0.55 : 1;
      ctx.save();
      ctx.globalAlpha = a;
      switch (p.kind) {
        case 'ember':
          wash(ctx, x, y, ts * 0.28, c.light, 0.8);
          ctx.fillStyle = '#fff2c8';
          ctx.beginPath();
          ctx.arc(x, y, ts * 0.07, 0, Math.PI * 2);
          ctx.fill();
          if (Math.random() < 0.6) this.fx.add({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 0.4, vy: -0.4, kind: 'ember', color: c.light, life: 0.35, size: 0.035 });
          break;
        case 'droplet':
          ctx.translate(x, y);
          ctx.rotate((p.angle || 0) + Math.PI / 2);
          ctx.fillStyle = c.main;
          ctx.strokeStyle = INK;
          ctx.lineWidth = Math.max(1, ts * 0.025);
          ctx.beginPath();
          ctx.moveTo(0, -ts * 0.13);
          ctx.quadraticCurveTo(ts * 0.09, ts * 0.04, 0, ts * 0.08);
          ctx.quadraticCurveTo(-ts * 0.09, ts * 0.04, 0, -ts * 0.13);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#e6f5ff';
          ctx.beginPath();
          ctx.arc(-ts * 0.02, 0, ts * 0.02, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'gust':
          ctx.translate(x, y);
          ctx.rotate(p.angle || 0);
          ctx.strokeStyle = withAlpha(c.dark, 0.8);
          ctx.lineCap = 'round';
          for (let k = 0; k < 3; k++) {
            ctx.lineWidth = Math.max(1, ts * (0.05 - k * 0.012));
            ctx.beginPath();
            ctx.arc(-k * ts * 0.1, 0, ts * (0.16 + k * 0.05), -0.9, 0.9);
            ctx.stroke();
          }
          break;
        case 'boulder': {
          // ombre au sol puis rocher en cloche
          ctx.fillStyle = withAlpha(INK, 0.25);
          ctx.beginPath();
          ctx.ellipse(x, p.y * ts + ts * 0.1, ts * 0.12, ts * 0.05, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.translate(x, y);
          ctx.rotate(time * 6);
          ctx.fillStyle = '#7a6a4c';
          ctx.strokeStyle = INK;
          ctx.lineWidth = Math.max(1, ts * 0.03);
          ctx.beginPath();
          ctx.moveTo(-ts * 0.12, -ts * 0.04);
          ctx.lineTo(-ts * 0.03, -ts * 0.12);
          ctx.lineTo(ts * 0.11, -ts * 0.06);
          ctx.lineTo(ts * 0.1, ts * 0.08);
          ctx.lineTo(-ts * 0.08, ts * 0.1);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;
        }
        default:
          ctx.fillStyle = c.main;
          ctx.beginPath();
          ctx.arc(x, y, ts * 0.08, 0, Math.PI * 2);
          ctx.fill();
      }
      ctx.restore();
    }
  }

  drawRange(ctx, x, y, range, ts, color, time) {
    const r = range * ts;
    ctx.save();
    ctx.fillStyle = withAlpha(color, 0.1);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(color, 0.75);
    ctx.lineWidth = Math.max(1.5, ts * 0.04);
    ctx.setLineDash([ts * 0.18, ts * 0.12]);
    ctx.lineDashOffset = -time * ts * 0.4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawPlacement(ctx, ts, ui) {
    const game = this.game;
    if (ui.press && ui.press.kind === 'tower') {
      const { c, r, valid, type } = ui.press;
      const def = game.defs.towers[type];
      const x = (c + 0.5) * ts;
      const y = (r + 0.5) * ts;
      this.drawRange(ctx, x, y, def.levels[0].range, ts, valid ? ELEMENT_COLORS[type]?.main || PALETTE.gold : PALETTE.vermillion, this.time);
      drawTower(ctx, x, y, ts, def, 1, this.time, { alpha: valid ? 0.6 : 0.3 });
    }
    // Mise en évidence des cases constructibles quand une lanterne est sélectionnée.
    if (ui.tool && ui.tool !== 'stone' && !ui.drag) {
      const g = game.grid;
      ctx.strokeStyle = withAlpha(PALETTE.gold, 0.45 + Math.sin(this.time * 4) * 0.15);
      ctx.lineWidth = Math.max(1, ts * 0.03);
      for (let i = 0; i < g.size; i++) {
        if (g.type(i) !== T.SLOT) continue;
        if (game.towerAt(g.col(i), g.row(i))) continue;
        ctx.beginPath();
        ctx.arc(g.cx(i) * ts, g.cy(i) * ts + ts * 0.04, ts * 0.42, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  drawSelection(ctx, ts, time, ui) {
    const game = this.game;
    if (ui.selectedTower != null) {
      const t = game.towerById(ui.selectedTower);
      if (t) {
        const st = game.towerStats(t);
        this.drawRange(ctx, t.x * ts, t.y * ts, st.range, ts, ELEMENT_COLORS[t.type]?.main || PALETTE.gold, time);
      }
    }
    if (ui.drag) {
      const g = game.grid;
      // cibles de fusion valides
      for (const t of game.towers) {
        if (t.id === ui.drag.towerId) continue;
        if (game.canFuse && game.canFuse(ui.drag.towerId, t.id).ok) {
          ctx.strokeStyle = withAlpha(PALETTE.goldLight, 0.6 + Math.sin(time * 8) * 0.3);
          ctx.lineWidth = Math.max(2, ts * 0.06);
          ctx.beginPath();
          ctx.arc(t.x * ts, t.y * ts, ts * 0.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (ui.drag.hover && g.inBounds(ui.drag.hover.c, ui.drag.hover.r)) {
        const { c, r, valid } = ui.drag.hover;
        ctx.fillStyle = withAlpha(valid ? PALETTE.goldLight : PALETTE.vermillion, 0.25);
        ctx.fillRect(c * ts, r * ts, ts, ts);
      }
    }
  }

  drawDragGhost(ctx, drag, time) {
    const t = this.game.towerById(drag.towerId);
    if (!t) return;
    drawTower(ctx, drag.x, drag.y - this.ts * 0.4, this.ts * 1.1, this.game.defs.towers[t.type], t.level, time, { alpha: 0.85 });
  }
}
