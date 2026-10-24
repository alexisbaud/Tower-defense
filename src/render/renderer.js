// Orchestration du rendu Canvas 2D : papier, terrain, entités triées en
// profondeur, projectiles, particules et surcouches d'interface.
import { makePaper, makeVignette } from './paper.js';
import { renderTerrain } from './terrain.js';
import { drawTower } from './towers.js';
import { drawEnemy } from './enemies.js';
import { Fx, ELEMENT_COLORS, drawPortal, drawEnso, drawInkCross, drawRouteMarks } from './fx.js';
import { INK, PALETTE, withAlpha, wash, brushStroke, mix, makeCanvas } from './brush.js';
import { T } from '../core/grid.js';
import { drawZones, drawComboLinks, drawTornado, drawStone, drawComboPreview, drawLinkPreview, drawSeal } from './combos.js';

const TAU = Math.PI * 2;
const UI_FONT = '"Zen Kaku Gothic New", -apple-system, "Helvetica Neue", sans-serif';
const GREY = '#7d7a70';

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
    this.maxDpr = 3; // abaissé automatiquement si l'appareil peine (voir main.js)
    // Libellé d'un aperçu de pose (fourni par main.js) : { text, tone: 'ok'|'bad'|'muted' } | null
    this.pressLabel = null;
  }

  resize(w, h) {
    const dpr = Math.min(this.maxDpr, window.devicePixelRatio || 1);
    w = Math.max(1, w);
    h = Math.max(1, h);
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    // Rien n'a changé (window 'resize' et ResizeObserver signalent souvent le même
    // changement) : ne pas refaire le fond, ni vider le canvas en réaffectant sa taille.
    if (w === this.w && h === this.h && dpr === this.dpr && this.canvas.width === cw && this.canvas.height === ch) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    if (this.game) this.layout();
  }

  setGame(game, theme) {
    this.game = game;
    this.theme = theme;
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
    this.composeBackground();
  }

  // Papier + terrain + vignettage fusionnés en une seule image : un seul
  // blit plein écran par frame pour toute la partie statique. Papier et
  // vignettage ne dépendent que de l'écran et de la teinte du papier : ils sont
  // gardés en cache (un changement de niveau du même monde ne refait que le terrain).
  composeBackground() {
    const dpr = this.dpr;
    const key = `${this.w}|${this.h}|${dpr}|${this.theme?.paper}`;
    if (this.paperKey !== key) {
      this.paperKey = key;
      this.paper = makePaper(this.w, this.h, dpr, this.theme?.paper);
      this.vignette = makeVignette(this.w, this.h, dpr);
    }
    const { paper } = this;
    let bg = this.background;
    if (!bg || bg.width !== paper.width || bg.height !== paper.height) bg = makeCanvas(paper.width, paper.height);
    const ctx = bg.getContext('2d');
    ctx.drawImage(paper, 0, 0);
    const pad = this.terrain.pad;
    ctx.drawImage(this.terrain.canvas, Math.round((this.ox - pad) * dpr), Math.round((this.oy - pad) * dpr));
    ctx.drawImage(this.vignette, 0, 0);
    this.background = bg;
  }

  // À appeler quand le terrain change d'apparence (ex. thème).
  refreshBackground() {
    if (this.game) this.layout();
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

    // Tremblement d'écran léger.
    let sx = 0;
    let sy = 0;
    if (this.fx.shake > 0 && !ui.reducedMotion) {
      const s = this.fx.shake * ts * 0.12;
      sx = (Math.random() - 0.5) * s;
      sy = (Math.random() - 0.5) * s;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (sx || sy) {
      ctx.fillStyle = this.theme?.paper || '#efe4c8';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.drawImage(this.background, Math.round(sx * dpr), Math.round(sy * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(this.ox + sx, this.oy + sy);

    this.drawSpawns(ctx, ts, time);
    this.drawRoutes(ctx, ts, time);
    this.drawGoalGlow(ctx, ts, time);
    drawZones(ctx, game, ts, time);
    this.drawFlyerPaths(ctx, ts, time, ui);
    if (this.drawUnderlay) this.drawUnderlay(ctx, ts, time, ui);

    // Aperçus de pose / portée sous les entités.
    this.drawPlacement(ctx, ts, ui);

    // Entités triées par profondeur.
    const anim = game.rewindAnim;
    const ak = anim ? Math.min(1, anim.t / anim.dur) : 0;
    let enemies = game.enemies;
    if (anim) {
      // Lecture accélérée de l'historique, à l'envers.
      const f = Math.min(anim.frames.length - 1, Math.floor(easeInOut(ak) * (anim.frames.length - 1)));
      enemies = anim.frames[f].enemies;
    }
    const items = [];
    for (const t of game.towers) items.push({ y: t.y, k: 0, o: t });
    for (const t of game.echoes) items.push({ y: t.y + 0.01, k: 3, o: t });
    for (const e of enemies) {
      const ex = anim ? e.x : e.px + (e.x - e.px) * alpha;
      const ey = anim ? e.y : e.py + (e.y - e.py) * alpha;
      items.push({ y: e.flying ? ey + 5 : ey, k: 1, o: e, ex, ey });
    }
    const g = game.grid;
    const snow = !!this.theme?.snowCaps;
    for (let i = 0; i < g.size; i++) {
      if (!g.stone[i]) continue;
      const sx = g.cx(i) * ts;
      const sy = g.cy(i) * ts;
      items.push({ y: g.cy(i) - 0.1, k: 2, draw: (c) => drawStone(c, sx, sy, ts, i * 17 + 3, snow) });
    }
    for (const t of game.tornadoes) items.push({ y: t.y + 0.2, k: 2, draw: (c, s, tm) => drawTornado(c, t, s, tm) });
    if (this.extraDrawables) this.extraDrawables(items);
    items.sort((a, b) => a.y - b.y);
    for (const it of items) {
      if (it.k === 0) {
        const t = it.o;
        if ((ui.drag && ui.drag.towerId === t.id) || (ui.dragBack && ui.dragBack.towerId === t.id)) {
          drawTower(ctx, t.x * ts, t.y * ts, ts, game.defs.towers[t.type], t.level, time, { alpha: 0.35 });
          continue;
        }
        if (anim && anim.ghosts.includes(t.id)) {
          // Lanterne posée après l'instant cible : elle se change en écho.
          drawTower(ctx, t.x * ts, t.y * ts, ts, game.defs.towers[t.type], t.level, time, { alpha: 1 - ak });
          drawTower(ctx, t.x * ts, t.y * ts, ts, game.defs.towers[t.type], t.level, time, { echo: 1, alpha: ak });
          continue;
        }
        drawTower(ctx, t.x * ts, t.y * ts, ts, game.defs.towers[t.type], t.level, time, {
          shot: t.shotT > 0,
          stunned: t.stunT > 0,
        });
      } else if (it.k === 3) {
        const t = it.o;
        drawTower(ctx, t.x * ts, t.y * ts, ts, game.defs.towers[t.type], t.level, time, { echo: t.ttl / t.maxTtl, shot: t.shotT > 0 });
      } else if (it.k === 1) {
        const e = it.o;
        drawEnemy(ctx, e, game.defs.enemies[e.type], it.ex * ts, it.ey * ts, ts, time);
      } else if (it.draw) {
        it.draw(ctx, ts, time);
      }
    }

    drawComboLinks(ctx, game, ts, time);
    this.drawProjectiles(ctx, ts, time);
    this.fx.drawParts(ctx, ts);
    if (this.drawOverlayExtra) this.drawOverlayExtra(ctx, ts, time, ui);
    this.fx.drawOverlay(ctx, ts);
    this.drawSelection(ctx, ts, time, ui);
    ctx.restore();

    // Vignettage + flash.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (anim) this.drawRewindOverlay(ctx, ak, anim, time);
    if (this.fx.flash > 0) {
      ctx.fillStyle = withAlpha(this.fx.flashColor, this.fx.flash * 0.35);
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ui.drag) this.drawDragGhost(ctx, ui.drag, time);
    if (ui.dragBack) this.drawDragBack(ctx, ui, time);
    if (ui.press) {
      this.drawPressGhost(ctx, ui.press, time);
      this.drawPressCombos(ctx, ui.press, time);
    }
    if (ui.flash) this.drawFlash(ctx, ui);
  }

  // Pose en cours : combos qui naîtraient avec les voisines (échos compris), liens
  // d'encre lumineux et nom, par-dessus le fantôme ; en grisé si la pose est refusée.
  drawPressCombos(ctx, press, time) {
    if (press.kind !== 'tower' || press.c == null || !press.combos?.length) return;
    const a = { x: press.c + 0.5, y: press.r + 0.5 };
    ctx.save();
    ctx.translate(this.ox, this.oy);
    for (const { def, other } of press.combos) drawComboPreview(ctx, a, other, def, this.ts, time, { dim: !press.valid });
    ctx.restore();
  }

  // Rembobinage : voile indigo et sépia, traits de temps qui filent à rebours,
  // spirale d'encre et cadran qui tournent à l'envers, sceau 巻 et compteur.
  drawRewindOverlay(ctx, k, anim, time) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.dpr;
    const env = Math.sin(Math.PI * Math.min(1, k * 1.15));
    if (env <= 0.001) return;
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) * 0.34;
    ctx.save();
    ctx.fillStyle = withAlpha(PALETTE.indigo, 0.36 * env);
    ctx.fillRect(0, 0, W, H);
    // virage sépia de vieille estampe
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = withAlpha('#c9b48a', 0.28 * env);
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    // vignettage indigo (un seul dégradé par frame, le temps de l'animation)
    const vg = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, Math.hypot(cx, cy));
    vg.addColorStop(0, withAlpha(PALETTE.indigo, 0));
    vg.addColorStop(1, withAlpha(PALETTE.indigo, 0.55 * env));
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    // traits de temps qui filent vers la gauche
    for (let i = 0; i < 9; i++) {
      const u = (time * (1.1 + (i % 3) * 0.35) + i * 0.37) % 1;
      const y = H * (0.08 + ((i * 0.618) % 1) * 0.84);
      const len = W * (0.12 + (i % 4) * 0.05);
      const x = W * 1.15 - u * W * 1.5;
      brushStroke(ctx, [[x, y], [x + len * 0.5, y + 1], [x + len, y]], (2 + (i % 3)) * dpr, withAlpha(PALETTE.cream, 0.35 * env), { taperIn: 0.1, taperOut: 0.85 });
    }
    ctx.translate(cx, cy);
    // cadran : douze graduations au pinceau qui tournent à rebours
    ctx.rotate(-time * 0.8);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = R * (i % 3 ? 1.04 : 0.98);
      const r1 = R * 1.12;
      brushStroke(ctx, [[Math.cos(a) * r0, Math.sin(a) * r0], [Math.cos(a) * r1, Math.sin(a) * r1]], (i % 3 ? 3 : 5) * dpr, withAlpha(PALETTE.cream, 0.7 * env), { taperIn: 0.2, taperOut: 0.4 });
    }
    ctx.rotate(time * 0.8);
    // spirale d'encre à rebours : un bras principal qui s'enroule vers le centre,
    // un second plus court et plus fin, crème liserés d'indigo
    for (let arm = 0; arm < 2; arm++) {
      const pts = [];
      const rot = -time * 4.2 + arm * Math.PI;
      const turns = arm ? 1.1 : 1.75;
      const r0 = arm ? 0.32 : 0.06;
      const n = Math.round(turns * 40);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const a = rot + t * Math.PI * 2 * turns;
        const r = R * (r0 + t * (1 - r0) * (arm ? 0.85 : 1));
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      const w = (arm ? 6 : 11) * dpr;
      brushStroke(ctx, pts, w * 1.6, withAlpha(PALETTE.indigo, 0.5 * env), { taperIn: 0.7, taperOut: 0.3 });
      brushStroke(ctx, pts, w, withAlpha('#e6eeff', 0.8 * env), { taperIn: 0.7, taperOut: 0.3 });
    }
    // aiguille vermillon qui remonte le temps
    const ha = -Math.PI / 2 - easeInOut(k) * Math.PI * 2;
    brushStroke(ctx, [[0, 0], [Math.cos(ha) * R * 0.45, Math.sin(ha) * R * 0.45], [Math.cos(ha) * R * 0.92, Math.sin(ha) * R * 0.92]], 7 * dpr, withAlpha(PALETTE.vermillion, 0.9 * env), { taperIn: 0.05, taperOut: 0.7 });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // sceau 巻 et compteur de secondes
    ctx.globalAlpha = env;
    const s = 64 * dpr * (0.9 + 0.1 * env);
    // Sceau rendu à taille fixe (une seule image en cache) ; la pulsation passe par le repère.
    const s0 = Math.round(64 * dpr);
    ctx.save();
    ctx.translate(cx, cy - s * 0.18);
    ctx.scale(s / s0, s / s0);
    drawSeal(ctx, 0, 0, s0, '巻');
    ctx.restore();
    const secs = Math.max(0, anim.seconds * (1 - easeInOut(k)));
    const label = `−${secs.toFixed(1)} s`;
    ctx.font = `800 ${Math.round(34 * dpr)}px "Shippori Mincho", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 7 * dpr;
    ctx.strokeStyle = PALETTE.indigo;
    ctx.strokeText(label, cx, cy + s * 0.72);
    ctx.fillStyle = PALETTE.cream;
    ctx.fillText(label, cx, cy + s * 0.72);
    ctx.restore();
  }

  // Portails d'apparition : mare d'encre et volutes tournantes (plus vives en vague).
  drawSpawns(ctx, ts, time) {
    const g = this.game.grid;
    const active = this.game.state === 'wave';
    for (const s of g.spawns) drawPortal(ctx, g.cx(s) * ts, g.cy(s) * ts, ts, time, active);
  }

  // Sanctuaire : halo doré qui respire et onde protectrice au sol.
  drawGoalGlow(ctx, ts, time) {
    const g = this.game.grid;
    for (const gi of g.goals) {
      const x = g.cx(gi) * ts;
      const y = g.cy(gi) * ts;
      const pulse = 0.25 + Math.sin(time * 2) * 0.08;
      wash(ctx, x, y - ts * 0.2, ts * 1.1, PALETTE.goldLight, pulse);
      const f = (time / 2.4) % 1;
      const r = ts * (0.35 + f * 0.85);
      ctx.strokeStyle = withAlpha(PALETTE.gold, (1 - f) * 0.45);
      ctx.lineWidth = Math.max(1, ts * 0.035 * (1 - f * 0.5));
      ctx.beginPath();
      ctx.ellipse(x, y + ts * 0.22, r, r * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Tracé actuel des yokai : chevrons d'encre qui avancent vers le sanctuaire.
  drawRoutes(ctx, ts, time) {
    const game = this.game;
    if (this.routeVersion !== game.flow.version) {
      this.routeVersion = game.flow.version;
      this.routes = game.grid.spawns.map((s) => game.flow.route(s));
      // segments uniques (les tracés se rejoignent) et distance restante au sanctuaire
      const g = game.grid;
      const seen = new Set();
      this.routeSegs = [];
      for (const route of this.routes) {
        const n = route.length;
        for (let i = 0; i < n - 1; i++) {
          const a = route[i];
          const b = route[i + 1];
          const key = a * g.size + b;
          if (seen.has(key)) continue;
          seen.add(key);
          const dx = g.cx(b) - g.cx(a);
          const dy = g.cy(b) - g.cy(a);
          this.routeSegs.push({ x: g.cx(a), y: g.cy(a), dx, dy, d: n - 1 - i, d0: n - 1 });
        }
      }
    }
    drawRouteMarks(ctx, this.routeSegs || [], ts, time);
  }

  // Projectiles par élément, chacun avec sa traînée (positions récentes tenues par fx).
  drawProjectiles(ctx, ts, time) {
    const fx = this.fx;
    for (const p of this.game.projectiles) {
      const c = fx.colOf(p.element);
      const x = p.x * ts;
      const y = (p.y - (p.h || 0)) * ts;
      ctx.save();
      ctx.globalAlpha = p.echo ? 0.55 : 1;
      switch (p.kind) {
        case 'ember': {
          // comète de feu : traînée effilée orange, cœur blanc doré
          const tr = fx.trailPts(p, 5, ts);
          if (tr.length > 1) {
            brushStroke(ctx, tr, ts * 0.17, withAlpha(c.main, 0.5), { taperIn: 0.95, taperOut: 0.05 });
            brushStroke(ctx, tr, ts * 0.075, withAlpha('#ffe2a0', 0.9), { taperIn: 0.9, taperOut: 0.05 });
          }
          wash(ctx, x, y, ts * 0.3, c.light, 0.75);
          ctx.fillStyle = '#fff4d6';
          ctx.beginPath();
          ctx.arc(x, y, ts * 0.075, 0, Math.PI * 2);
          ctx.fill();
          if (Math.random() < 0.3) fx.add({ x: p.x, y: p.y - (p.h || 0), vx: (Math.random() - 0.5) * 0.5, vy: -0.4, kind: 'ember', color: c.light, life: 0.3, size: 0.03, alpha: p.echo ? 0.5 : 1 });
          break;
        }
        case 'droplet': {
          // goutte glacée : sillage pâle, tête ronde en avant, liseré d'encre
          const tr = fx.trailPts(p, 4, ts);
          if (tr.length > 1) brushStroke(ctx, tr, ts * 0.1, withAlpha(c.light, 0.65), { taperIn: 0.95, taperOut: 0.1 });
          ctx.translate(x, y);
          ctx.rotate((p.angle || 0) - Math.PI / 2);
          ctx.fillStyle = c.main;
          ctx.strokeStyle = INK;
          ctx.lineWidth = Math.max(1, ts * 0.025);
          ctx.beginPath();
          ctx.moveTo(0, -ts * 0.14);
          ctx.quadraticCurveTo(ts * 0.1, ts * 0.02, 0, ts * 0.09);
          ctx.quadraticCurveTo(-ts * 0.1, ts * 0.02, 0, -ts * 0.14);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#e6f5ff';
          ctx.beginPath();
          ctx.arc(-ts * 0.025, ts * 0.025, ts * 0.025, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'gust': {
          // bourrasque : deux mèches de vent qui ondulent derrière des croissants d'encre
          const tr = fx.trailPts(p, 5, ts);
          if (tr.length > 2) {
            const a = p.angle || 0;
            const nx = -Math.sin(a) * ts * 0.07;
            const ny = Math.cos(a) * ts * 0.07;
            for (const sgn of [-1, 1]) {
              const pts = tr.map((q, i) => {
                const w = sgn * Math.sin(i * 1.4 + time * 18) * 0.8 + sgn * 0.6;
                return [q[0] + nx * w, q[1] + ny * w];
              });
              brushStroke(ctx, pts, ts * 0.05, withAlpha(sgn > 0 ? c.dark : c.main, 0.6), { taperIn: 0.9, taperOut: 0.15 });
            }
          }
          ctx.translate(x, y);
          ctx.rotate(p.angle || 0);
          ctx.lineCap = 'round';
          for (let k = 0; k < 3; k++) {
            ctx.strokeStyle = withAlpha(k === 1 ? c.main : c.dark, 0.85);
            ctx.lineWidth = Math.max(1, ts * (0.055 - k * 0.012));
            ctx.beginPath();
            ctx.arc(-k * ts * 0.09, 0, ts * (0.15 + k * 0.05), -0.95, 0.95);
            ctx.stroke();
          }
          break;
        }
        case 'boulder': {
          // ombre au sol (pâlit avec la hauteur), sillage de poussière, rocher qui roule
          const hk = Math.max(0, 1 - (p.h || 0) * 0.45);
          ctx.fillStyle = withAlpha(INK, 0.28 * hk);
          ctx.beginPath();
          ctx.ellipse(x, p.y * ts + ts * 0.1, ts * 0.13 * (0.6 + 0.4 * hk), ts * 0.05 * (0.6 + 0.4 * hk), 0, 0, Math.PI * 2);
          ctx.fill();
          const tr = fx.trailPts(p, 6, ts);
          if (tr.length > 1) brushStroke(ctx, tr, ts * 0.12, withAlpha('#b59a6a', 0.35), { taperIn: 0.95, taperOut: 0.2 });
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
          ctx.fillStyle = withAlpha('#ffffff', 0.25);
          ctx.beginPath();
          ctx.ellipse(-ts * 0.03, -ts * 0.05, ts * 0.05, ts * 0.025, -0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = PALETTE.moss;
          ctx.beginPath();
          ctx.arc(ts * 0.05, -ts * 0.06, ts * 0.025, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        default:
          wash(ctx, x, y, ts * 0.25, c.light, 0.7);
          ctx.fillStyle = c.main;
          ctx.beginPath();
          ctx.arc(x, y, ts * 0.08, 0, Math.PI * 2);
          ctx.fill();
      }
      ctx.restore();
    }
  }

  // Portée : lavis très léger, bord en dégradé, cercle d'encre pointillé qui tourne.
  drawRange(ctx, x, y, range, ts, color, time) {
    const r = range * ts;
    ctx.save();
    ctx.fillStyle = withAlpha(color, 0.08);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(color, 0.16);
    ctx.lineWidth = ts * 0.2;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, r - ts * 0.1), 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(color, 0.4);
    ctx.lineWidth = Math.max(1, ts * 0.018);
    ctx.beginPath();
    ctx.arc(x, y, r + ts * 0.035, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(mix(color, INK, 0.3), 0.9);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, ts * 0.06);
    ctx.setLineDash([0.01, ts * 0.17]);
    ctx.lineDashOffset = -time * ts * 0.35;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawPlacement(ctx, ts, ui) {
    const game = this.game;
    const time = this.time;
    // Traces au sol des effets (taches d'encre, fissures) : sous les aperçus et les entités.
    this.fx.drawGround(ctx, ts);
    // Outil pierre : cases de gravier ouvert disponibles (équerres indigo).
    if (ui.tool === 'stone') {
      const g = game.grid;
      ctx.strokeStyle = withAlpha(PALETTE.indigoLight, 0.55 + Math.sin(time * 4) * 0.2);
      ctx.lineWidth = Math.max(1.5, ts * 0.045);
      ctx.lineCap = 'round';
      const q = ts * 0.2;
      ctx.beginPath();
      for (let i = 0; i < g.size; i++) {
        if (g.type(i) !== T.OPEN || g.stone[i]) continue;
        const x0 = g.col(i) * ts + ts * 0.16;
        const y0 = g.row(i) * ts + ts * 0.16;
        const x1 = x0 + ts * 0.68;
        const y1 = y0 + ts * 0.68;
        ctx.moveTo(x0, y0 + q);
        ctx.lineTo(x0, y0);
        ctx.lineTo(x0 + q, y0);
        ctx.moveTo(x1 - q, y0);
        ctx.lineTo(x1, y0);
        ctx.lineTo(x1, y0 + q);
        ctx.moveTo(x1, y1 - q);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x1 - q, y1);
        ctx.moveTo(x0 + q, y1);
        ctx.lineTo(x0, y1);
        ctx.lineTo(x0, y1 - q);
      }
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    // Lanterne sélectionnée : ensō dorés sur les socles libres, calés sur la
    // face supérieure de la dalle (centrée ~0,03 case au-dessus du centre, voir terrain.js).
    if (ui.tool && ui.tool !== 'stone' && !ui.drag) {
      const g = game.grid;
      const a = 0.75 + Math.sin(time * 4) * 0.2;
      for (let i = 0; i < g.size; i++) {
        if (g.type(i) !== T.SLOT) continue;
        if (game.towerAt(g.col(i), g.row(i))) continue;
        const x = g.cx(i) * ts;
        const y = g.cy(i) * ts - ts * 0.01;
        // lueur dorée puis ensō doublé d'une ombre d'encre : lisible sur la pierre claire
        wash(ctx, x, y, ts * 0.42, PALETTE.goldLight, 0.32 * a);
        drawEnso(ctx, x, y + ts * 0.02, ts * 0.34, INK, 0.3 * a, i * 1.7, 0.8);
        drawEnso(ctx, x, y, ts * 0.34, PALETTE.gold, a, i * 1.7, 0.8);
      }
    }
    // Aperçu de pose : portée et réticule sur la case visée (sous les entités).
    const press = ui.press;
    if (press && press.kind === 'tower' && press.c != null) {
      const def = game.defs.towers[press.type];
      const x = (press.c + 0.5) * ts;
      const y = (press.r + 0.5) * ts;
      const range = def?.levels?.[0]?.range ?? 2;
      if (press.valid) {
        const col = this.colorOf(press.type);
        this.drawRange(ctx, x, y, range, ts, col, time);
        wash(ctx, x, y + ts * 0.3, ts * 0.45, col, 0.35);
      } else {
        // refus : portée grise en tirets et case hachurée (jamais la teinte seule)
        this.drawDashedRing(ctx, x, y, range * ts, GREY, 0.75, ts);
        this.drawHatch(ctx, press.c, press.r, ts);
      }
      this.drawReticle(ctx, press.c, press.r, ts, press.valid ? PALETTE.gold : GREY);
    }
    if (press && press.kind === 'stone') this.drawStonePreview(ctx, ts, time, press);
  }

  colorOf(type) {
    return ELEMENT_COLORS[type]?.main || this.game.defs.towers[type]?.color || PALETTE.gold;
  }

  // Cercle en tirets (portée refusée, case libérée).
  drawDashedRing(ctx, x, y, r, color, alpha, ts) {
    ctx.save();
    ctx.strokeStyle = withAlpha(color, alpha);
    ctx.lineWidth = Math.max(1.5, ts * 0.045);
    ctx.setLineDash([ts * 0.16, ts * 0.12]);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, r), 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // Hachures d'encre sur une case (aperçu refusé).
  drawHatch(ctx, c, r, ts) {
    const x0 = c * ts + ts * 0.1;
    const y0 = r * ts + ts * 0.1;
    const s = ts * 0.8;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, s, s);
    ctx.clip();
    ctx.strokeStyle = withAlpha(INK, 0.35);
    ctx.lineWidth = Math.max(1, ts * 0.03);
    ctx.beginPath();
    for (let k = -s; k < s; k += ts * 0.16) {
      ctx.moveTo(x0 + k, y0 + s);
      ctx.lineTo(x0 + k + s, y0);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Réticule : quatre équerres d'encre autour de la case visée.
  drawReticle(ctx, c, r, ts, color) {
    const x0 = c * ts + ts * 0.06;
    const y0 = r * ts + ts * 0.06;
    const x1 = x0 + ts * 0.88;
    const y1 = y0 + ts * 0.88;
    const q = ts * 0.22;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(x0, y0 + q);
      ctx.lineTo(x0, y0);
      ctx.lineTo(x0 + q, y0);
      ctx.moveTo(x1 - q, y0);
      ctx.lineTo(x1, y0);
      ctx.lineTo(x1, y0 + q);
      ctx.moveTo(x1, y1 - q);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1 - q, y1);
      ctx.moveTo(x0 + q, y1);
      ctx.lineTo(x0, y1);
      ctx.lineTo(x0, y1 - q);
    };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    path();
    ctx.strokeStyle = withAlpha(INK, 0.55);
    ctx.lineWidth = Math.max(3, ts * 0.09);
    ctx.stroke();
    path();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.6, ts * 0.05);
    ctx.stroke();
    ctx.restore();
  }

  // Pierre glissée : nouveau tracé en pointillés (sous les entités).
  drawStonePreview(ctx, ts, time, press) {
    if (press.c == null) return;
    const g = this.game.grid;
    const blocked = press.reason === 'blocked';
    if (!blocked && press.routes && press.reason !== 'occupied') {
      const col = press.valid ? PALETTE.indigo : GREY;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const route of press.routes) {
        if (!route || route.length < 2) continue;
        const pathOf = () => {
          ctx.beginPath();
          ctx.moveTo(g.cx(route[0]) * ts, g.cy(route[0]) * ts);
          for (let k = 1; k < route.length; k++) ctx.lineTo(g.cx(route[k]) * ts, g.cy(route[k]) * ts);
        };
        // liseré crème sous les points : lisible sur le gravier comme sur l'herbe
        ctx.setLineDash([]);
        pathOf();
        ctx.strokeStyle = withAlpha(PALETTE.cream, 0.55);
        ctx.lineWidth = Math.max(4, ts * 0.13);
        ctx.stroke();
        ctx.setLineDash([0.01, ts * 0.2]);
        ctx.lineDashOffset = -time * ts * 0.8;
        pathOf();
        ctx.strokeStyle = withAlpha(col, 0.95);
        ctx.lineWidth = Math.max(3, ts * 0.1);
        ctx.stroke();
      }
      ctx.restore();
    }
    const tone = press.valid ? PALETTE.indigoLight : blocked ? PALETTE.vermillion : GREY;
    this.drawReticle(ctx, press.c, press.r, ts, tone);
    if (blocked) drawInkCross(ctx, (press.c + 0.5) * ts, (press.r + 0.5) * ts, ts * 0.22, withAlpha(PALETTE.vermillion, 0.9), press.c * 31 + press.r);
  }

  // Trajectoires des volants (ligne droite portail → sanctuaire) : affichées quand
  // des volants sont annoncés ou en route, plus marquées avec l'outil pierre.
  drawFlyerPaths(ctx, ts, time, ui) {
    const game = this.game;
    const lines = this.flyerLines(game);
    if (!lines.length) return;
    const strong = ui.tool === 'stone' || ui.press?.kind === 'stone';
    ctx.save();
    ctx.lineCap = 'round';
    for (const [x0, y0, x1, y1] of lines) {
      const ax = x0 * ts;
      const ay = y0 * ts;
      const bx = x1 * ts;
      const by = y1 * ts;
      ctx.setLineDash([ts * 0.05, ts * 0.17]);
      ctx.lineDashOffset = -time * ts * 0.6;
      ctx.strokeStyle = withAlpha(PALETTE.indigo, strong ? 0.75 : 0.42);
      ctx.lineWidth = Math.max(2, ts * (strong ? 0.07 : 0.05));
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      // ailes (chevrons) régulièrement espacées, pointées vers le sanctuaire
      ctx.setLineDash([]);
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1) continue;
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      const step = ts * 1.4;
      const off = (time * ts * 0.6) % step;
      ctx.lineWidth = Math.max(1.6, ts * 0.045);
      ctx.beginPath();
      for (let d = step * 0.6 + off; d < len - ts * 0.4; d += step) {
        const px = ax + ux * d;
        const py = ay + uy * d;
        const w = ts * 0.13;
        ctx.moveTo(px - ux * w - uy * w, py - uy * w + ux * w);
        ctx.lineTo(px, py);
        ctx.lineTo(px - ux * w + uy * w, py - uy * w - ux * w);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Portails d'où partiront (ou partent encore) des volants : prochaine vague en
  // construction, apparitions restantes pendant la vague.
  flyerLines(game) {
    const fly = (type) => !!game.defs.enemies[type]?.abilities?.flying;
    const spawns = new Set();
    if (game.state === 'build') {
      const wave = game.waves?.[game.waveIndex + 1];
      for (const gr of wave?.groups || []) if (fly(gr.enemy)) spawns.add(gr.spawn ?? 0);
    } else if (game.state === 'wave') {
      for (const sp of game.spawners || []) if (sp.spawned < sp.count && fly(sp.enemy)) spawns.add(sp.spawn ?? 0);
      // appel anticipé possible : la vague suivante compte aussi
      if (typeof game.canCallNextWave === 'function' && game.canCallNextWave()) {
        const wave = game.waves?.[game.waveIndex + 1];
        for (const gr of wave?.groups || []) if (fly(gr.enemy)) spawns.add(gr.spawn ?? 0);
      }
    }
    if (!spawns.size) return [];
    const g = game.grid;
    const out = [];
    for (const k of spawns) {
      const s = g.spawns[k % g.spawns.length];
      if (s == null) continue;
      const x = g.cx(s);
      const y = g.cy(s);
      const goal = game.nearestGoal ? game.nearestGoal(x, y) : g.goals[0];
      out.push([x, y, g.cx(goal), g.cy(goal)]);
    }
    return out;
  }

  drawSelection(ctx, ts, time, ui) {
    const game = this.game;
    // Pose en cours : combos qui naîtraient avec les voisines (échos compris),
    // liens d'encre lumineux et nom ; en grisé si la pose est refusée.
    if (ui.selectedTower != null) {
      const t = game.towerById(ui.selectedTower);
      if (t) {
        const st = game.towerStats(t);
        const col = this.colorOf(t.type);
        // zones des combos de la lanterne : anneau plus marqué
        for (const z of game.zones) {
          if (z.a !== t.id && z.b !== t.id) continue;
          this.drawDashedRing(ctx, z.x * ts, z.y * ts, z.radius * ts, mix(z.def.color || PALETTE.gold, INK, 0.35), 0.8, ts);
        }
        this.drawRange(ctx, t.x * ts, t.y * ts, st.range, ts, col, time);
        drawEnso(ctx, t.x * ts, t.y * ts + ts * 0.3, ts * 0.5, PALETTE.gold, 0.9, time * 0.6, 0.45);
      }
    }
    // Yokai visé (appui long, fiche ouverte) : ensō doré à ses pieds.
    if (ui.focusEnemy != null) {
      const e = game.enemies.find((x) => x.id === ui.focusEnemy);
      if (e) drawEnso(ctx, e.x * ts, e.y * ts + ts * 0.12, ts * (e.size ?? 0.3) * 1.7, PALETTE.gold, 0.95, time * 1.5, 0.5);
    }
    if (ui.drag) {
      const g = game.grid;
      // cibles de fusion valides : ensō doré qui tourne
      for (const t of game.towers) {
        if (t.id === ui.drag.towerId) continue;
        if (game.canFuse && game.canFuse(ui.drag.towerId, t.id).ok) {
          const p = 0.6 + Math.sin(time * 8) * 0.3;
          wash(ctx, t.x * ts, t.y * ts - ts * 0.1, ts * 0.6, PALETTE.goldLight, 0.3 * p);
          drawEnso(ctx, t.x * ts, t.y * ts, ts * 0.52, PALETTE.gold, p, time * 2.5);
        }
      }
      if (ui.drag.hover && g.inBounds(ui.drag.hover.c, ui.drag.hover.r)) {
        const { c, r, valid } = ui.drag.hover;
        const x = (c + 0.5) * ts;
        const y = (r + 0.5) * ts;
        const other = game.towerAt(c, r);
        if (valid) {
          wash(ctx, x, y, ts * 0.75, PALETTE.goldLight, 0.45);
          drawEnso(ctx, x, y, ts * 0.6, PALETTE.vermillion, 0.9, -time * 3);
          this.drawFusePreview(ctx, ts, time, ui.drag, other);
        } else if (other && other.id !== ui.drag.towerId) {
          drawInkCross(ctx, x, y - ts * 0.1, ts * 0.2, withAlpha(PALETTE.vermillion, 0.85), c * 31 + r);
        }
      }
    }
  }

  // Fusion : résultat (N+1), case libérée, combos perdus (rouge, barrés) et
  // conservés (or), d'après game.previewFuse.
  drawFusePreview(ctx, ts, time, drag, dst) {
    const pv = drag.preview;
    const game = this.game;
    if (!pv || !pv.ok || !dst) return;
    const find = (id) => game.towerById(id) || game.echoes?.find((e) => e.id === id) || null;
    for (const z of pv.kept || []) {
      const a = find(z.a);
      const b = find(z.b);
      if (a && b) drawLinkPreview(ctx, a, b, z.def, ts, time, 'kept');
    }
    for (const z of pv.lost || []) {
      const a = find(z.a);
      const b = find(z.b);
      if (a && b) drawLinkPreview(ctx, a, b, z.def, ts, time, 'lost');
    }
    if (pv.freed) {
      const fx = (pv.freed.c + 0.5) * ts;
      const fy = (pv.freed.r + 0.5) * ts;
      ctx.save();
      ctx.strokeStyle = withAlpha(PALETTE.cream, 0.95);
      ctx.lineWidth = Math.max(2, ts * 0.06);
      ctx.setLineDash([ts * 0.12, ts * 0.09]);
      ctx.lineDashOffset = -time * ts * 0.4;
      ctx.strokeRect(fx - ts * 0.42, fy - ts * 0.42, ts * 0.84, ts * 0.84);
      ctx.restore();
      this.drawTag(ctx, 'libéré', fx, fy + ts * 0.62, { tone: 'muted', align: 'center', size: 12 });
    }
    // résultat : « N3 » doré à côté de la cible
    const lvl = pv.level ?? dst.level + 1;
    const right = (dst.x + 1.1) * ts < game.grid.cols * ts;
    this.drawTag(ctx, `→ N${lvl}`, (dst.x + (right ? 0.5 : -0.5)) * ts, (dst.y - 0.7) * ts, { tone: 'gold', align: right ? 'left' : 'right', size: 14 });
  }

  // Étiquette au pinceau : pastille crème cernée d'encre, texte lisible (≥ 12 px).
  // tone : 'ok' (indigo), 'bad' (vermillon), 'muted' (gris), 'gold' (or).
  drawTag(ctx, text, x, y, opts = {}) {
    const size = Math.max(12, opts.size ?? 13);
    ctx.save();
    ctx.font = `700 ${size}px ${UI_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const w = ctx.measureText(text).width + 14;
    const h = size + 10;
    let x0 = opts.align === 'center' ? x - w / 2 : opts.align === 'right' ? x - w : x;
    // reste dans le plateau (repère courant : celui du plateau ou de l'écran)
    const bounds = opts.bounds;
    if (bounds) x0 = Math.max(bounds[0] + 4, Math.min(bounds[1] - w - 4, x0));
    const y0 = y - h / 2;
    const tone = opts.tone || 'ok';
    const bg = tone === 'bad' ? '#a8321f' : tone === 'gold' ? PALETTE.goldLight : PALETTE.cream;
    const fg = tone === 'bad' ? PALETTE.cream : tone === 'muted' ? '#4a463e' : tone === 'gold' ? INK : PALETTE.indigo;
    ctx.fillStyle = withAlpha(INK, 0.3);
    roundRect(ctx, x0 + 1.5, y0 + 2.5, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = bg;
    roundRect(ctx, x0, y0, w, h, h / 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.fillText(text, x0 + 7, y + 0.5);
    ctx.restore();
    return { x: x0, y: y0, w, h };
  }

  // Fantôme de pose (lanterne ou pierre), au-dessus du doigt, relié au doigt par
  // un fil d'or ; raison du refus écrite à côté (repère écran).
  drawPressGhost(ctx, press, time) {
    const game = this.game;
    const ts = this.ts;
    const snapped = press.c != null;
    const gx = snapped ? this.ox + (press.c + 0.5) * ts : press.gx;
    const gy = snapped ? this.oy + (press.r + 0.5) * ts : press.gy;
    if (press.lifted) {
      // fil d'or du doigt au pied du fantôme, petit cercle sous le doigt
      ctx.save();
      ctx.lineCap = 'round';
      ctx.setLineDash([ts * 0.03, ts * 0.12]);
      ctx.lineDashOffset = -time * ts * 0.5;
      ctx.strokeStyle = withAlpha(PALETTE.gold, 0.85);
      ctx.lineWidth = Math.max(1.8, ts * 0.045);
      ctx.beginPath();
      ctx.moveTo(press.fx, press.fy - ts * 0.3);
      ctx.lineTo(gx, gy + ts * 0.32);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = withAlpha(PALETTE.gold, 0.7);
      ctx.lineWidth = Math.max(1.5, ts * 0.04);
      ctx.beginPath();
      ctx.arc(press.fx, press.fy, ts * 0.3, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    const bad = snapped && !press.valid;
    if (press.kind === 'tower') {
      const def = game.defs.towers[press.type];
      if (!def) return;
      const occupied = snapped && game.towerAt(press.c, press.r);
      if (!occupied) {
        wash(ctx, gx, gy + ts * 0.32, ts * 0.42, INK, snapped ? 0.3 : 0.15);
        if (bad) {
          ctx.save();
          ctx.filter = 'grayscale(1) brightness(1.08)';
          drawTower(ctx, gx, gy, ts, def, 1, time, { alpha: 0.55 });
          ctx.restore();
        } else {
          drawTower(ctx, gx, gy, ts, def, 1, time, { alpha: snapped ? 0.88 : 0.45 });
        }
      }
      if (bad) drawInkCross(ctx, gx, gy - ts * 0.35, ts * 0.2, withAlpha(PALETTE.vermillion, 0.95), press.c * 31 + press.r);
    } else {
      // pierre : vibre quand elle couperait le chemin
      const blocked = press.reason === 'blocked';
      const shake = blocked ? Math.sin(performance.now() * 0.06) * ts * 0.06 : 0;
      ctx.save();
      ctx.globalAlpha = snapped ? 0.9 : 0.5;
      drawStone(ctx, gx + shake, gy, ts, 11, !!this.theme?.snowCaps);
      ctx.restore();
    }
    const label = this.pressLabel?.(press);
    if (label?.text) {
      // à droite du fantôme, ou à gauche près du bord droit
      const right = gx + ts * 0.5 + 120 < this.w;
      this.drawTag(ctx, label.text, gx + (right ? ts * 0.5 : -ts * 0.5), gy - ts * 0.75, { tone: label.tone, align: right ? 'left' : 'right', bounds: [0, this.w] });
    }
  }

  // Dépôt raté : la lanterne revient à sa place en ~170 ms.
  drawDragBack(ctx, ui, time) {
    const b = ui.dragBack;
    const t = this.game.towerById(b.towerId);
    const k = (performance.now() - b.t0) / 170;
    if (!t || k >= 1) {
      ui.dragBack = null;
      return;
    }
    const ts = this.ts;
    const e = 1 - Math.pow(1 - k, 3);
    const sx = b.x;
    const sy = b.y + ts * 0.3;
    const tx = this.ox + t.x * ts;
    const ty = this.oy + t.y * ts;
    drawTower(ctx, sx + (tx - sx) * e, sy + (ty - sy) * e, ts * (1.1 - 0.1 * e), this.game.defs.towers[t.type], t.level, time, { alpha: 0.85 });
  }

  // Message éphémère près du geste (« annulé », raison d'un refus).
  drawFlash(ctx, ui) {
    const f = ui.flash;
    const k = (performance.now() - f.t0) / 1100;
    if (k >= 1) {
      ui.flash = null;
      return;
    }
    ctx.save();
    ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
    this.drawTag(ctx, f.text, f.x, f.y - this.ts * 0.6 - k * 14, { tone: f.bad ? 'bad' : 'muted', align: 'center', bounds: [0, this.w] });
    ctx.restore();
  }

  // Lanterne saisie : fil d'or vers son socle, ombre portée sous le doigt.
  drawDragGhost(ctx, drag, time) {
    const t = this.game.towerById(drag.towerId);
    if (!t) return;
    const ts = this.ts;
    const ox = this.ox + t.x * ts;
    const oy = this.oy + t.y * ts;
    const gx = drag.gx ?? drag.x;
    const gy = (drag.gy ?? drag.y) + ts * 0.3; // drag.gy = corps de la lanterne portée
    ctx.save();
    ctx.strokeStyle = withAlpha(PALETTE.gold, 0.7);
    ctx.lineWidth = Math.max(1.5, ts * 0.04);
    ctx.lineCap = 'round';
    ctx.setLineDash([ts * 0.02, ts * 0.12]);
    ctx.lineDashOffset = -time * ts * 0.5;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.quadraticCurveTo((ox + gx) / 2, Math.min(oy, gy) - ts * 0.4, gx, gy + ts * 0.3);
    ctx.stroke();
    ctx.restore();
    wash(ctx, gx, gy + ts * 0.45, ts * 0.45, INK, 0.35);
    drawTower(ctx, gx, gy, ts * 1.1, this.game.defs.towers[t.type], t.level, time, { alpha: 0.85 });
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function easeInOut(k) {
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}
