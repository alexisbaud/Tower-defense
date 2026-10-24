// Orchestration du rendu Canvas 2D : papier, terrain, entités triées en
// profondeur, projectiles, particules et surcouches d'interface.
import { makePaper, makeVignette } from './paper.js';
import { renderTerrain } from './terrain.js';
import { drawTower } from './towers.js';
import { drawEnemy, setReducedMotion } from './enemies.js';
import { drawBarrier, drawBarrierThread, noteBarrierUp } from './barriers.js';
import { setElementDefs } from './glyphs.js';
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
    this.edge = null;
    if (this.game) this.layout();
  }

  setGame(game, theme) {
    this.game = game;
    this.theme = theme;
    setElementDefs(game.defs?.elements);
    this.fx.reset({ w: game.grid.cols, h: game.grid.rows }, theme.ambient);
    this.routeVersion = -1;
    this.layout();
  }

  layout() {
    const g = this.game.grid;
    const ts = Math.floor(Math.min(this.w / g.cols, this.h / g.rows));
    this.ts = ts;
    this.fx.textTs = ts; // les textes flottants s'empilent selon leur taille réelle
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
    for (const ev of events) {
      if (ev.type === 'barrierUp' && ev.barrier) noteBarrierUp(ev.barrier.id, this.time);
      this.fx.onEvent(ev, this.game);
    }
  }

  render(dt, alpha, ui = {}) {
    const { ctx, game, ts } = this;
    if (!game) return;
    if (!(dt > 0)) dt = 0; // le temps du rendu ne recule jamais (rayons des ondes ≥ 0)
    this.time += dt;
    // Dernière chance : le monde se fige (les particules ralentissent presque à l'arrêt).
    const frozen = game.lastChanceT > 0 && !game.rewindAnim;
    this.fx.update(frozen ? dt * 0.12 : dt);
    setReducedMotion(!!ui.reducedMotion);
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
    this.drawSupportLinks(ctx, ts, time);
    this.drawBarrierThreads(ctx, ts, time);
    if (this.drawUnderlay) this.drawUnderlay(ctx, ts, time, ui);

    // Aperçus de pose / portée sous les entités.
    this.drawPlacement(ctx, ts, ui);

    // Entités triées par profondeur.
    const anim = game.rewindAnim;
    const ak = anim ? Math.min(1, anim.t / anim.dur) : 0;
    let enemies = game.enemies;
    let timeless = null;
    if (anim) {
      // Lecture accélérée de l'historique, à l'envers. Les yokai hors du temps ne
      // reculent pas : ils restent à leur place (et en couleur, voir plus bas).
      const f = Math.min(anim.frames.length - 1, Math.floor(easeInOut(ak) * (anim.frames.length - 1)));
      const isTimeless = (e) => e.timeless || !!game.defs.enemies[e.type]?.abilities?.timeless;
      enemies = anim.frames[f].enemies.filter((e) => !isTimeless(e));
      timeless = game.enemies.filter((e) => e.alive !== false && isTimeless(e));
      this.drawRewindTrails(ctx, ts, anim, f, isTimeless);
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
    for (const b of game.barriers || []) {
      const bt = game.towerById(b.towerId);
      let respawnMax = 6;
      if (bt) respawnMax = game.towerStats(bt).respawn ?? 6;
      items.push({ y: g.cy(b.tile) + 0.12, k: 2, draw: (c, s, tm) => drawBarrier(c, b, game, s, tm, { respawnMax, reduced: !!ui.reducedMotion }) });
    }
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
          // Lanterne posée après l'instant cible : elle se dissout en bandes d'encre
          // qui glissent et s'effacent, pendant que son écho se forme.
          this.drawDissolve(ctx, t, ts, time, ak);
          drawTower(ctx, t.x * ts, t.y * ts, ts, game.defs.towers[t.type], t.level, time, { echo: 1, alpha: ak * ak });
          continue;
        }
        drawTower(ctx, t.x * ts, t.y * ts, ts, game.defs.towers[t.type], t.level, time, {
          shot: t.shotT > 0,
          stunned: t.stunT > 0,
          tower: t,
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
    this.drawBeams(ctx, ts, time);
    this.drawProjectiles(ctx, ts, time);
    this.fx.drawParts(ctx, ts);
    if (this.drawOverlayExtra) this.drawOverlayExtra(ctx, ts, time, ui);
    this.fx.drawOverlay(ctx, ts);
    this.drawSelection(ctx, ts, time, ui);
    ctx.restore();

    // Rembobinage : négatif d'encre ; les yokai hors du temps restent en couleur.
    if (anim) {
      this.drawRewindNegative(ctx, ak);
      if (timeless?.length) this.drawTimeless(ctx, timeless, ak, time, sx, sy);
    } else if (frozen) this.drawLastChance(ctx, time, ui);
    // Vignettage + flash.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (anim) this.drawRewindOverlay(ctx, ak, anim, time);
    if (this.fx.flash > 0) {
      ctx.fillStyle = withAlpha(this.fx.flashColor, this.fx.flash * 0.35);
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ui.drag) {
      this.drawDragGhost(ctx, ui.drag, time);
      // aperçu de fusion par-dessus la lanterne portée (liens, N+1, case libérée)
      const h = ui.drag.hover;
      if (h?.valid) {
        ctx.save();
        ctx.translate(this.ox, this.oy);
        this.drawFusePreview(ctx, this.ts, time, ui.drag, game.towerAt(h.c, h.r));
        ctx.restore();
      }
    }
    if (ui.dragBack) this.drawDragBack(ctx, ui, time);
    if (ui.press) {
      this.drawPressGhost(ctx, ui.press, time);
      this.drawPressCombos(ctx, ui.press, time);
    }
    if (ui.flash) this.drawFlash(ctx, ui);
  }

  // Carillon : fil d'or discret et ondes sonores qui voyagent vers chaque lanterne
  // accélérée (dans sa portée, hors soutiens et gardiens qui n'ont pas de cadence).
  drawSupportLinks(ctx, ts, time) {
    const game = this.game;
    const towers = game.towers;
    let started = false;
    for (const s of towers) {
      const def = game.defs.towers[s.type];
      if (def?.attack !== 'support') continue;
      const st = game.towerStats(s);
      if (!st?.rateBonus) continue;
      for (const t of towers) {
        if (t === s || Math.hypot(t.x - s.x, t.y - s.y) > st.range + 0.01) continue;
        const ta = game.defs.towers[t.type]?.attack;
        if (ta === 'support' || ta === 'barrier') continue;
        if (!started) {
          started = true;
          ctx.save();
          ctx.lineCap = 'round';
        }
        const x0 = s.x * ts;
        const y0 = (s.y - 0.35) * ts;
        const x1 = t.x * ts;
        const y1 = (t.y - 0.3) * ts;
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = PALETTE.gold;
        ctx.lineWidth = Math.max(1, ts * 0.022);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        const ang = Math.atan2(y1 - y0, x1 - x0);
        ctx.lineWidth = Math.max(1.4, ts * 0.035);
        for (let k = 0; k < 2; k++) {
          const q = (time * 0.7 + k * 0.5 + s.x * 0.13) % 1;
          const px = x0 + (x1 - x0) * q;
          const py = y0 + (y1 - y0) * q;
          ctx.globalAlpha = 0.85 * Math.sin(Math.PI * q);
          ctx.strokeStyle = k ? PALETTE.goldLight : PALETTE.gold;
          ctx.beginPath();
          ctx.arc(px, py, ts * (0.09 + 0.06 * q), ang - 0.9, ang + 0.9);
          ctx.stroke();
        }
      }
    }
    if (started) ctx.restore();
  }

  // Fils entre chaque barrière et son Gardien de pierre.
  drawBarrierThreads(ctx, ts, time) {
    const game = this.game;
    if (!game.barriers?.length) return;
    for (const b of game.barriers) {
      const t = game.towerById(b.towerId);
      if (t) drawBarrierThread(ctx, b, t, game, ts, time);
    }
  }

  // Rembobinage : chaque yokai qui recule laisse une traînée d'encre (ses positions
  // dans les images d'historique qui viennent d'être rejouées).
  drawRewindTrails(ctx, ts, anim, f, isTimeless) {
    if (f < 1) return;
    const maps = anim._maps || (anim._maps = []);
    const mapOf = (i) => maps[i] || (maps[i] = new Map(anim.frames[i].enemies.map((e) => [e.uid ?? e.id, e])));
    for (const e of anim.frames[f].enemies) {
      if (isTimeless(e)) continue;
      const key = e.uid ?? e.id;
      const pts = [[e.x * ts, e.y * ts]];
      for (let j = 1; j <= 7 && f - j >= 0; j++) {
        const o = mapOf(f - j).get(key);
        if (!o) break;
        pts.push([o.x * ts, o.y * ts]);
      }
      if (pts.length < 2) continue;
      const span = Math.abs(pts[pts.length - 1][0] - pts[0][0]) + Math.abs(pts[pts.length - 1][1] - pts[0][1]);
      if (span < ts * 0.05) continue;
      brushStroke(ctx, pts, ts * (e.size ?? 0.3) * 0.7, withAlpha(INK, 0.5), { taperIn: 0.05, taperOut: 0.95 });
    }
  }

  // Lanterne effacée par le rembobinage : bandes horizontales qui glissent de
  // côté et pâlissent, gouttes d'encre qui s'en échappent.
  drawDissolve(ctx, t, ts, time, ak) {
    const def = this.game.defs.towers[t.type];
    const n = 5;
    const top = t.y * ts - ts * 0.95;
    const band = (ts * 1.35) / n;
    for (let i = 0; i < n; i++) {
      const y0 = top + i * band;
      const off = Math.sin(i * 2.3 + time * 7) * ts * 0.28 * ak * (0.4 + (n - i) / n);
      const a = (1 - ak) * (1 - (i / n) * 0.3 * ak);
      if (a <= 0.02) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(t.x * ts - ts, y0, ts * 2, band + 0.5);
      ctx.clip();
      drawTower(ctx, t.x * ts + off, t.y * ts, ts, def, t.level, time, { alpha: a });
      ctx.restore();
    }
    if (ak < 0.9 && Math.random() < 0.35) {
      this.fx.add({ x: t.x + (Math.random() - 0.5) * 0.6, y: t.y - Math.random() * 0.8, vx: (Math.random() - 0.5) * 0.6, vy: -0.6, kind: 'blot', color: INK, life: 0.6, size: 0.04, g: -0.6, drag: 0.95, alpha: 0.8 });
    }
  }

  // Jets du Torrent : jet d'eau épais qui s'amenuise vers le bout, bords qui ondulent.
  drawBeams(ctx, ts, time) {
    const beams = this.game.beams;
    if (!beams?.length) return;
    const c = ELEMENT_COLORS.water;
    for (const b of beams) {
      const k = Math.max(0, Math.min(1, b.life / 0.25));
      if (k <= 0) continue;
      const grow = Math.min(1, (1 - k) / 0.18 + 0.2);
      const dx = (b.x1 - b.x0) * grow;
      const dy = (b.y1 - b.y0) * grow;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const pts = [];
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const wob = Math.sin(u * 9 - time * 40) * 0.035 * u;
        pts.push([(b.x0 + dx * u + nx * wob) * ts, (b.y0 + dy * u + ny * wob) * ts]);
      }
      const w = ts * 0.3 * Math.sqrt(k);
      ctx.save();
      ctx.globalAlpha = (b.echo ? 0.55 : 1) * Math.min(1, k * 3);
      brushStroke(ctx, pts, w * 1.3, withAlpha(PALETTE.indigo, 0.55), { taperIn: 0.02, taperOut: 0.85 });
      brushStroke(ctx, pts, w, c.main, { taperIn: 0.02, taperOut: 0.85 });
      brushStroke(ctx, pts, w * 0.55, c.light, { taperIn: 0.02, taperOut: 0.8 });
      brushStroke(ctx, pts, w * 0.18, '#ffffff', { taperIn: 0.05, taperOut: 0.7 });
      wash(ctx, b.x0 * ts, b.y0 * ts, ts * 0.3, c.light, 0.6 * k);
      ctx.restore();
    }
  }

  // Négatif d'encre (sans ctx.filter, absent de Safari < 18) : « difference » avec
  // un crème chaud inverse le papier (qui devient nuit) et l'encre (qui devient
  // claire, virée sépia par la teinte du crème). Une seule passe ; fondu d'entrée et de sortie.
  drawRewindNegative(ctx, k) {
    const env = Math.max(0, Math.min(1, k / 0.12, (1 - k) / 0.12));
    if (env <= 0.01) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'difference';
    ctx.globalAlpha = env;
    ctx.fillStyle = '#f4e6c4';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  // Yokai hors du temps pendant le rembobinage : immobiles, en couleur, cernés
  // d'un halo crème (seuls à échapper au négatif).
  drawTimeless(ctx, list, k, time, sx, sy) {
    const ts = this.ts;
    const env = Math.max(0, Math.min(1, k / 0.12, (1 - k) / 0.12));
    ctx.save();
    ctx.translate(this.ox + sx, this.oy + sy);
    for (const e of list) {
      wash(ctx, e.x * ts, e.y * ts, ts * 0.7, PALETTE.cream, 0.55 * env);
      drawEnemy(ctx, e, this.game.defs.enemies[e.type], e.x * ts, e.y * ts, ts, time);
    }
    ctx.restore();
  }

  // Liseré vermillon des bords de l'écran (dernière chance), rendu une fois en petit.
  edgeGlow() {
    if (this.edge) return this.edge;
    const w = 96;
    const h = Math.max(96, Math.round((96 * this.h) / Math.max(1, this.w)));
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.38, w / 2, h / 2, Math.hypot(w / 2, h / 2));
    vg.addColorStop(0, withAlpha(PALETTE.vermillion, 0));
    vg.addColorStop(1, withAlpha(PALETTE.vermillion, 0.6));
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
    this.edge = c;
    return c;
  }

  // Dernière chance : le monde se fige (désaturation légère), le sanctuaire bat
  // en vermillon, un liseré vermillon pulse au bord de l'écran.
  drawLastChance(ctx, time, ui) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const reduced = !!ui.reducedMotion;
    // battement : deux pulsations rapprochées par seconde
    const ph = (time * 1.1) % 1;
    const beat = reduced ? 0.6 : Math.max(Math.exp(-((ph - 0.08) ** 2) / 0.008), 0.75 * Math.exp(-((ph - 0.32) ** 2) / 0.008));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // désaturation légère : voile gris de papier (mélange normal, peu coûteux sur
    // mobile ; un mode « saturation » plein écran coûte cher sans GPU)
    ctx.fillStyle = withAlpha('#8d8a80', 0.36);
    ctx.fillRect(0, 0, W, H);
    // liseré vermillon pré-rendu (petite image étirée), qui bat avec le sanctuaire
    ctx.globalAlpha = 0.45 + 0.55 * beat;
    ctx.drawImage(this.edgeGlow(), 0, 0, W, H);
    ctx.restore();
    const g = this.game.grid;
    const ts = this.ts;
    ctx.save();
    ctx.translate(this.ox, this.oy);
    for (const gi of g.goals) {
      const x = g.cx(gi) * ts;
      const y = g.cy(gi) * ts;
      wash(ctx, x, y - ts * 0.2, ts * 1.4, PALETTE.vermillion, 0.25 + 0.45 * beat);
      const q = reduced ? 0.5 : ph;
      ctx.strokeStyle = withAlpha(PALETTE.vermillion, 0.8 * (1 - q));
      ctx.lineWidth = Math.max(2, ts * 0.07 * (1 - q * 0.5));
      ctx.beginPath();
      ctx.ellipse(x, y + ts * 0.2, ts * (0.4 + q * 1.1), ts * (0.2 + q * 0.55), 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Pose en cours : combos qui naîtraient avec les voisines (échos compris), liens
  // d'encre lumineux et nom, par-dessus le fantôme ; en grisé si la pose est refusée.
  drawPressCombos(ctx, press, time) {
    if (press.kind !== 'tower' || press.c == null || !press.combos?.length) return;
    const a = { x: press.c + 0.5, y: press.r + 0.5 };
    ctx.save();
    ctx.translate(this.ox, this.oy);
    for (const { def, other } of press.combos) {
      // rayon réel de la zone : il grandit avec le niveau moyen des deux lanternes (cf. core/combos.js)
      const radius = (def.radius ?? 1.5) + 0.2 * ((1 + (other.level ?? 1)) / 2 - 1);
      drawComboPreview(ctx, a, other, def, this.ts, time, { dim: !press.valid, radius });
    }
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
    ctx.fillStyle = withAlpha(PALETTE.indigo, 0.16 * env);
    ctx.fillRect(0, 0, W, H);
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
      this.routes = game.grid.spawns.map((s) => game.flow.route(s, 0, 1)); // départ vers le bas, comme les yokai
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
        case 'arrow': {
          // flèche de vent : sillage de deux filets clairs, hampe d'encre, plumes
          const tr = fx.trailPts(p, 6, ts);
          if (tr.length > 1) {
            brushStroke(ctx, tr, ts * 0.09, withAlpha(c.light, 0.75), { taperIn: 0.95, taperOut: 0.05 });
            brushStroke(ctx, tr, ts * 0.03, withAlpha(c.dark, 0.6), { taperIn: 0.9, taperOut: 0.1 });
          }
          ctx.translate(x, y);
          ctx.rotate(p.angle || 0);
          ctx.lineCap = 'round';
          ctx.strokeStyle = INK;
          ctx.lineWidth = Math.max(1.2, ts * 0.028);
          ctx.beginPath();
          ctx.moveTo(-ts * 0.24, 0);
          ctx.lineTo(ts * 0.12, 0);
          ctx.stroke();
          ctx.fillStyle = '#dfe6ec';
          ctx.lineWidth = Math.max(1, ts * 0.018);
          ctx.beginPath();
          ctx.moveTo(ts * 0.2, 0);
          ctx.lineTo(ts * 0.1, -ts * 0.045);
          ctx.lineTo(ts * 0.1, ts * 0.045);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = PALETTE.cream;
          for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(-ts * 0.24, 0);
            ctx.lineTo(-ts * 0.17, s * ts * 0.05);
            ctx.lineTo(-ts * 0.1, s * ts * 0.012);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
          break;
        }
        case 'boulder': {
          // ombre au sol (pâlit avec la hauteur), sillage de poussière, rocher qui roule
          const hk = Math.max(0, 1 - (p.h || 0) * 0.45);
          if (fx.styleOf(p.element) === 'ember') {
            // obus incandescent du mortier : fumée, braise qui rougeoie, mèche qui crépite
            ctx.fillStyle = withAlpha(INK, 0.28 * hk);
            ctx.beginPath();
            ctx.ellipse(x, p.y * ts + ts * 0.1, ts * 0.12 * (0.6 + 0.4 * hk), ts * 0.045 * (0.6 + 0.4 * hk), 0, 0, Math.PI * 2);
            ctx.fill();
            const tr = fx.trailPts(p, 7, ts);
            if (tr.length > 1) {
              brushStroke(ctx, tr, ts * 0.13, withAlpha('#6b625a', 0.35), { taperIn: 0.95, taperOut: 0.15 });
              brushStroke(ctx, tr, ts * 0.05, withAlpha(c.light, 0.7), { taperIn: 0.9, taperOut: 0.1 });
            }
            wash(ctx, x, y, ts * 0.34, c.light, 0.75);
            ctx.translate(x, y);
            ctx.fillStyle = '#3a2a24';
            ctx.strokeStyle = INK;
            ctx.lineWidth = Math.max(1, ts * 0.025);
            ctx.beginPath();
            ctx.arc(0, 0, ts * 0.095, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.rotate(time * 5);
            ctx.strokeStyle = '#ffb35c';
            ctx.lineWidth = Math.max(1, ts * 0.02);
            ctx.beginPath();
            ctx.moveTo(-ts * 0.06, -ts * 0.02);
            ctx.lineTo(0, ts * 0.01);
            ctx.lineTo(ts * 0.05, -ts * 0.05);
            ctx.moveTo(0, ts * 0.01);
            ctx.lineTo(ts * 0.02, ts * 0.07);
            ctx.stroke();
            ctx.fillStyle = '#fff3cf';
            ctx.beginPath();
            ctx.arc(-ts * 0.03, -ts * 0.03, ts * 0.022, 0, Math.PI * 2);
            ctx.fill();
            if (Math.random() < 0.35) fx.add({ x: p.x, y: p.y - (p.h || 0), vx: (Math.random() - 0.5) * 0.6, vy: -0.3, kind: 'ember', color: c.light, life: 0.35, size: 0.035, alpha: p.echo ? 0.5 : 1 });
            break;
          }
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
      const el = game.defs.towers[ui.tool]?.element ?? ui.tool;
      for (let i = 0; i < g.size; i++) {
        if (g.type(i) !== T.SLOT) continue;
        if (game.towerAt(g.col(i), g.row(i))) continue;
        const x = g.cx(i) * ts;
        const y = g.cy(i) * ts - ts * 0.01;
        const se = g.slotElement?.[i];
        if (se && se !== el) {
          // socle réservé à un autre élément : voilé d'encre, pas d'ensō
          wash(ctx, x, y, ts * 0.42, INK, 0.22);
          continue;
        }
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
      // (invité : le miroir ne simule pas les apparitions, l'hôte envoie ces portails)
      for (const k of game.flyerPortals?.() || []) spawns.add(k);
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
    const tags = []; // étiquettes déjà posées : « → N+1 » les évite
    for (const z of pv.kept || []) {
      const a = find(z.a);
      const b = find(z.b);
      if (a && b) tags.push(drawLinkPreview(ctx, a, b, z.def, ts, time, 'kept'));
    }
    for (const z of pv.lost || []) {
      const a = find(z.a);
      const b = find(z.b);
      if (a && b) tags.push(drawLinkPreview(ctx, a, b, z.def, ts, time, 'lost'));
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
      // dans la case libérée (la lanterne y est déjà effacée), sinon juste dessous ou
      // dessus : jamais sur le nom d'un combo
      ctx.save();
      ctx.font = `700 12px ${UI_FONT}`;
      const lw = ctx.measureText('libéré').width + 14;
      ctx.restore();
      const ys = [fy + ts * 0.12, fy + ts * 0.66, fy - ts * 0.62];
      const box = (y) => ({ x: fx - lw / 2, y: y - 11, w: lw, h: 22 });
      const y = ys.find((yy) => !tags.some((t) => t && overlap(box(yy), t))) ?? ys[0];
      tags.push(this.drawTag(ctx, 'libéré', fx, y, { tone: 'muted', align: 'center', size: 12 }));
    }
    // résultat : « → N3 » doré à côté de la cible, dans le plateau, sans recouvrir
    // le nom d'un combo ni « libéré »
    const lvl = pv.level ?? dst.level + 1;
    const W = game.grid.cols * ts;
    const text = `→ N${lvl}`;
    ctx.save();
    ctx.font = `700 14px ${UI_FONT}`;
    const tw = ctx.measureText(text).width + 14;
    ctx.restore();
    const th = 24;
    const spots = [
      [dst.x + 0.55, dst.y - 0.75, 'left'],
      [dst.x - 0.55, dst.y - 0.75, 'right'],
      [dst.x + 0.55, dst.y + 0.2, 'left'],
      [dst.x - 0.55, dst.y + 0.2, 'right'],
      [dst.x, dst.y - 1.35, 'center'],
      [dst.x, dst.y + 0.95, 'center'],
    ];
    const boxOf = ([x, y, align]) => {
      let x0 = align === 'center' ? x * ts - tw / 2 : align === 'right' ? x * ts - tw : x * ts;
      x0 = Math.max(4, Math.min(W - tw - 4, x0));
      return { x: x0, y: y * ts - th / 2, w: tw, h: th };
    };
    const spot = spots.find((sp) => !tags.some((t) => t && overlap(boxOf(sp), t))) || spots[0];
    this.drawTag(ctx, text, spot[0] * ts, spot[1] * ts, { tone: 'gold', align: spot[2], size: 14, bounds: [0, W] });
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
    let gy = snapped ? this.oy + (press.r + 0.5) * ts : press.gy;
    // doigt immobile : le fantôme monte au-dessus du doigt (la case visée reste
    // celle du doigt tant que la montée n'est pas finie)
    const rising = !press.lifted && press.rise > 0;
    if (rising) {
      const e = 1 - Math.pow(1 - press.rise, 3);
      gy -= (press.liftPx || 0) * e;
    }
    if (press.lifted || (rising && press.rise > 0.25)) {
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
          // lanterne grise pré-rendue (ctx.filter par frame coûte des centaines de ms)
          const g = this.greyGhost(def, ts);
          ctx.save();
          ctx.globalAlpha *= 0.62;
          ctx.drawImage(g.c, gx - g.ax, gy - g.ay, g.w, g.h);
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

  // Fantôme d'une pose refusée : la lanterne en niveaux de gris, dessinée une fois
  // par type et par taille de case (puis copiée), lisible sans la couleur (B16).
  greyGhost(def, ts) {
    const dpr = this.dpr || 1;
    const key = `${def.name}|${def.color}|${ts}|${dpr}`;
    this.greyCache = this.greyCache || new Map();
    let g = this.greyCache.get(key);
    if (g) return g;
    const w = ts * 2;
    const h = ts * 2.6;
    const ax = ts;
    const ay = ts * 1.9;
    const c = makeCanvas(w * dpr, h * dpr);
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTower(cx, ax, ay, ts, def, 1, 0, {});
    try {
      const img = cx.getImageData(0, 0, c.width, c.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const l = Math.min(255, (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) * 1.08);
        d[i] = d[i + 1] = d[i + 2] = l;
      }
      cx.putImageData(img, 0, 0);
    } catch {
      /* lecture refusée : fantôme en couleur, la croix et la raison restent */
    }
    if (this.greyCache.size > 24) this.greyCache.clear();
    g = { c, w, h, ax, ay };
    this.greyCache.set(key, g);
    return g;
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
    // taille de case fixe (corps en cache), grossissement 1,1 → 1 par opts.scale
    drawTower(ctx, sx + (tx - sx) * e, sy + (ty - sy) * e, ts, this.game.defs.towers[t.type], t.level, time, { alpha: 0.85, scale: 1.1 - 0.1 * e });
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

// Deux rectangles { x, y, w, h } se chevauchent-ils ?
function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
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
