// Tutoriel intégré, sans mur de texte : un doigt et une courte bulle montrent
// le geste suivant, en fonction de l'état de la partie. Les étapes viennent de
// `level.tutorial` ; le Rembobinage a un mini-tutoriel dédié.
import { T } from '../core/grid.js';
import { bfs } from '../core/flowfield.js';

export class Tutorial {
  constructor(el, ctx) {
    this.el = el; // conteneur #hint
    this.c = ctx; // { game(), input, renderer, canvas, hud, gauge, pause(bool), modal(html, buttons) }
    this.done = new Set();
    this.steps = [];
    this.current = null;
    this.rewindPhase = 0;
    this.fuseSeen = false;
  }

  start(game) {
    // Masquer d'abord l'indication éventuelle du niveau précédent.
    this.hide();
    this.el.classList.add('hidden');
    this.el.innerHTML = '';
    this.steps = [...(game.level.tutorial || [])];
    this.done = new Set();
    this.rewindPhase = this.steps.includes('rewind') ? 1 : 0;
  }

  onEvent(ev) {
    const g = this.c.game();
    switch (ev.type) {
      case 'place':
        this.done.add('place');
        break;
      case 'waveStart':
        this.done.add('wave');
        break;
      case 'fuse':
        this.done.add('fuse');
        break;
      case 'combo':
        this.done.add('combo');
        break;
      case 'stone':
        this.done.add('stone');
        break;
      case 'rewindStart':
        this.done.add('rewind');
        if (this.rewindPhase && this.rewindPhase < 3) this.rewindPhase = 3;
        break;
      case 'rewindEnd':
        if (this.rewindPhase === 3) {
          this.rewindPhase = 4;
          if (ev.echoes > 0) this.c.hud.banner('影 Écho !', 'Vos lanternes récentes tirent à 50 % pendant 10 s');
          else this.c.hud.banner('巻 −6 s', 'Astuce : posez une lanterne avant de rembobiner');
        }
        break;
      default:
        break;
    }
    void g;
  }

  hide() {
    if (this.current !== null) {
      this.el.classList.add('hidden');
      this.el.innerHTML = '';
      this.current = null;
    }
  }

  // Affiche un doigt (tap ou glissé) et une bulle à des coordonnées page.
  // opts.above : ordonnée page au-dessus de laquelle la bulle doit rester
  // (ex. haut de la barre du bas, pour ne pas couvrir le bouton de vague).
  // opts.avoid : rectangles page que la bulle ne doit pas cacher (ce qu'elle
  // montre : case visée et ses voisines, lanternes, sanctuaire).
  show(key, x, y, text, drag = null, opts = {}) {
    const root = this.el.parentElement.getBoundingClientRect();
    const lx = x - root.left;
    const ly = y - root.top;
    const sig = `${key}|${Math.round(lx)}|${Math.round(ly)}|${text}|${drag ? Math.round(drag.x) : ''}`;
    if (sig === this.current) return;
    this.current = sig;
    this.el.classList.remove('hidden');
    let html = '';
    if (drag) {
      const dx = drag.x - x;
      const dy = drag.y - y;
      html += `<div class="finger drag" style="left:${lx}px;top:${ly}px;--dx:${dx}px;--dy:${dy}px"></div>`;
    } else {
      html += `<div class="finger" style="left:${lx}px;top:${ly}px"></div>`;
    }
    html += `<div class="bubble" style="left:${lx}px;top:${ly - 26}px">${text}</div>`;
    this.el.innerHTML = html;
    const bubble = this.el.querySelector('.bubble');
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    const W = root.width;
    // Zones à laisser visibles, en coordonnées du calque.
    const rel = (r) => ({ l: r.left - root.left, t: r.top - root.top, r: r.right - root.left, b: r.bottom - root.top });
    const avoid = (opts.avoid || []).map(rel);
    avoid.push({ l: lx - 24, t: ly - 24, r: lx + 24, b: ly + 24 });
    if (drag) avoid.push({ l: drag.x - root.left - 30, t: drag.y - root.top - 30, r: drag.x - root.left + 30, b: drag.y - root.top + 30 });
    const goal = this.goalRect();
    if (goal) avoid.push(rel(goal));
    const top = this.topBand(root);
    let bottom = this.bottomBand(root);
    if (opts.above != null) bottom = Math.min(bottom, opts.above - root.top - 10);
    const union = avoid.reduce((u, r) => ({ l: Math.min(u.l, r.l), t: Math.min(u.t, r.t), r: Math.max(u.r, r.r), b: Math.max(u.b, r.b) }), { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity });
    // Positions candidates (centre x, bas de la bulle y), de la plus naturelle à la plus lointaine.
    const cands = [
      [lx, ly - 30],
      [lx, union.t - 8],
      [lx, union.b + 8 + bh],
      [lx, ly + 34 + bh],
      [union.l - 10 - bw / 2, ly + bh / 2],
      [union.r + 10 + bw / 2, ly + bh / 2],
    ];
    const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    let best = null;
    for (const [cx, by] of cands) {
      const l = Math.max(8, Math.min(W - bw - 8, cx - bw / 2));
      const r = { l, r: l + bw, t: by - bh, b: by };
      if (r.t < top || r.b > bottom) continue;
      if (avoid.some((a) => hit(a, r))) continue;
      best = r;
      break;
    }
    if (!best) {
      // repli : au-dessus du doigt, gardée à l'écran
      const l = Math.max(8, Math.min(W - bw - 8, lx - bw / 2));
      const by = Math.max(top + bh, Math.min(bottom, ly - 30));
      best = { l, t: by - bh, b: by };
    }
    bubble.style.left = `${best.l + bw / 2}px`;
    bubble.style.top = `${best.b}px`;
  }

  // Bas de la barre du haut (et de la barre de boss), relatif au conteneur.
  topBand(root) {
    const top = document.getElementById('hud-top');
    const r = top ? top.getBoundingClientRect() : null;
    return r && r.height ? r.bottom - root.top + 30 : 70;
  }

  // Haut de la bande des messages, au-dessus de la barre du bas.
  bottomBand(root) {
    const t = this.footerTop();
    return t != null ? t - root.top - 54 : root.height - 60;
  }

  // Sanctuaire (en coordonnées page) : la bulle ne le cache jamais.
  goalRect() {
    const g = this.c.game();
    if (!g || !g.grid.goals.length) return null;
    const gi = g.grid.goals[0];
    return this.tileRect(g.grid.col(gi), g.grid.row(gi), 0);
  }

  // Rectangle page d'une case et de ses `pad` voisines de chaque côté.
  tileRect(c, r, pad = 1) {
    const rect = this.c.canvas.getBoundingClientRect();
    const a = this.c.renderer.toScreen(c - pad, r - pad);
    const b = this.c.renderer.toScreen(c + 1 + pad, r + 1 + pad);
    return { left: rect.left + a.x, top: rect.top + a.y, right: rect.left + b.x, bottom: rect.top + b.y };
  }

  // Haut de la barre du bas (bouton de vague, palette), en coordonnées page.
  footerTop() {
    const el = document.getElementById('hud-bottom');
    return el ? el.getBoundingClientRect().top : null;
  }

  tileToPage(c, r) {
    const rect = this.c.canvas.getBoundingClientRect();
    const p = this.c.renderer.toScreen(c + 0.5, r + 0.5);
    return { x: rect.left + p.x, y: rect.top + p.y };
  }

  elCenter(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  update(paused) {
    const g = this.c.game();
    const input = this.c.input;
    // Rien pendant qu'un doigt est posé (pose, glisser, appui long) ni sur une fiche.
    if (!g || paused || this.c.hud.infoOpen || input.pressing || input.ui.press || input.ui.drag || g.state === 'won' || g.state === 'lost') {
      this.hide();
      return;
    }
    if (this.rewindPhase) {
      if (this.updateRewind(g)) return;
    }
    for (const step of this.steps) {
      if (this.done.has(step)) continue;
      if (this.tryStep(step, g, input)) return;
    }
    this.hide();
  }

  tryStep(step, g, input) {
    const hud = this.c.hud;
    switch (step) {
      case 'place': {
        if (g.towers.length) {
          this.done.add('place');
          return false;
        }
        const tool = input.ui.tool;
        if (!tool || tool === 'stone') {
          const first = hud.tools.find((t) => t.id !== 'stone');
          if (!first) return false;
          const p = this.elCenter(first.el);
          this.show('place-tool', p.x, p.y - 6, 'Choisissez une lanterne', null, { above: this.footerTop() });
          return true;
        }
        const slot = this.bestSlot(g, g.defs.towers[tool].levels[0].range);
        if (!slot) return false;
        const p = this.tileToPage(slot.c, slot.r);
        this.show('place-slot', p.x, p.y, 'Touchez un socle près du chemin', null, { avoid: [this.tileRect(slot.c, slot.r, 0)] });
        return true;
      }
      case 'wave': {
        if (g.waveIndex >= 0) {
          this.done.add('wave');
          return false;
        }
        if (!g.towers.length) return false;
        const p = this.elCenter(hud.waveBtn);
        this.show('wave', p.x, p.y, 'Lancez la vague !');
        return true;
      }
      case 'fuse': {
        const pair = this.findPair(g);
        if (!pair) return false;
        const a = this.tileToPage(pair[0].c, pair[0].r);
        const b = this.tileToPage(pair[1].c, pair[1].r);
        this.show('fuse', a.x, a.y, 'Glissez une lanterne sur sa jumelle : fusion !', b, {
          avoid: [this.tileRect(pair[0].c, pair[0].r - 1, 0), this.tileRect(pair[1].c, pair[1].r - 1, 0), this.tileRect(pair[0].c, pair[0].r, 0), this.tileRect(pair[1].c, pair[1].r, 0)],
        });
        return true;
      }
      case 'combo': {
        if (g.state !== 'build' || !g.towers.length) return false;
        if (g.zones.length) {
          this.done.add('combo');
          return false;
        }
        const spot = this.comboSpot(g);
        if (!spot) return false;
        const p = this.tileToPage(spot.c, spot.r);
        // la case visée, ses voisines (et le lien de combo qui naîtra) restent visibles
        this.show('combo', p.x, p.y, 'Un autre élément à côté = combo', null, { avoid: [this.tileRect(spot.c, spot.r, 1)] });
        return true;
      }
      case 'stone': {
        if (!g.level.stones || g.stonesLeft() <= 0) return false;
        if (g.waveIndex < 0 && !g.towers.length) return false;
        if (input.ui.tool !== 'stone') {
          const st = hud.tools.find((t) => t.id === 'stone');
          if (!st || g.gold < g.stoneCost()) return false;
          const p = this.elCenter(st.el);
          this.show('stone-tool', p.x, p.y - 6, 'Des pierres pour allonger le chemin', null, { above: this.footerTop() });
          return true;
        }
        const spot = this.stoneSpot(g);
        if (!spot) return false;
        const p = this.tileToPage(spot.c, spot.r);
        this.show('stone-spot', p.x, p.y, 'Glissez-la sur le gravier', null, { avoid: [this.tileRect(spot.c, spot.r, 1)] });
        return true;
      }
      default:
        return false;
    }
  }

  updateRewind(g) {
    if (this.rewindPhase === 1 && g.state === 'wave' && g.waveTime > 2.5) {
      this.rewindPhase = 2;
      this.hide();
      this.c.pause(true, true);
      this.c.modal(
        `<div class="modal-kanji">巻戻</div>
         <h2>Le Rembobinage</h2>
         <p>Une fois par vague, <b>glissez la jauge vers la gauche</b> : le temps recule de 6 secondes.</p>
         <p>Les lanternes posées depuis laissent un <b>écho fantôme</b> qui tire à 50 % pendant 10 s.
         Posez, rembobinez, reposez : double défense !</p>
         <div class="demo-gauge"><span class="demo-knob">巻</span></div>`,
        [{ label: 'Compris', cls: 'primary', run: () => this.c.pause(false, true) }],
      );
      return true;
    }
    if (this.rewindPhase === 2 && g.canRewind() && g.rewindAvailable() >= 5) {
      const tr = this.c.gauge.trackRect();
      const kr = this.c.gauge.knobRect();
      const from = { x: kr.left + kr.width / 2, y: kr.top + kr.height / 2 };
      const to = { x: tr.left + tr.width * 0.25, y: from.y };
      const recent = g.towers.some((t) => g.time - t.bornAt < 5);
      this.show('rewind', from.x, from.y, recent ? 'Glissez ◀◀ : la lanterne laissera un écho' : 'Posez une lanterne, puis glissez ◀◀', to);
      return true;
    }
    return false;
  }

  // ───── heuristiques de placement pour les indications ─────

  routeTiles(g) {
    const tiles = new Set();
    for (const s of g.grid.spawns) for (const i of g.flow.route(s)) tiles.add(i);
    return tiles;
  }

  bestSlot(g, range) {
    const grid = g.grid;
    const tiles = this.routeTiles(g);
    let best = null;
    let bestN = 0;
    for (let i = 0; i < grid.size; i++) {
      if (grid.type(i) !== T.SLOT || g.towerAt(grid.col(i), grid.row(i))) continue;
      let n = 0;
      for (const p of tiles) if (Math.hypot(grid.cx(p) - grid.cx(i), grid.cy(p) - grid.cy(i)) <= range) n++;
      if (n > bestN) {
        bestN = n;
        best = { c: grid.col(i), r: grid.row(i) };
      }
    }
    return best;
  }

  findPair(g) {
    for (let i = 0; i < g.towers.length; i++) {
      for (let j = i + 1; j < g.towers.length; j++) {
        if (g.canFuse(g.towers[i].id, g.towers[j].id).ok) return [g.towers[i], g.towers[j]];
      }
    }
    return null;
  }

  comboSpot(g) {
    const grid = g.grid;
    for (const t of g.towers) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const c = t.c + dx;
          const r = t.r + dy;
          if (!grid.inBounds(c, r)) continue;
          if (grid.type(grid.idx(c, r)) === T.SLOT && !g.towerAt(c, r)) return { c, r };
        }
      }
    }
    return null;
  }

  stoneSpot(g) {
    const grid = g.grid;
    const base = g.routeLength();
    let best = null;
    let bestGain = -1;
    for (let i = 0; i < grid.size; i++) {
      if (grid.type(i) !== T.OPEN || grid.stone[i]) continue;
      if (!g.canPlaceStone(grid.col(i), grid.row(i)).ok) continue;
      const dist = bfs(grid, i);
      let len = 0;
      for (const s of grid.spawns) len += dist[s];
      const gain = len - base;
      if (gain > bestGain) {
        bestGain = gain;
        best = { c: grid.col(i), r: grid.row(i) };
      }
    }
    return best;
  }
}
