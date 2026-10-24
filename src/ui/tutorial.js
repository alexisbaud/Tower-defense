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
    const bx = Math.max(90, Math.min(root.width - 90, lx));
    let by = ly - 26; // bas de la bulle, au-dessus du doigt
    if (opts.above != null) by = Math.min(by, opts.above - root.top - 10);
    html += `<div class="bubble" style="left:${bx}px;top:${by}px">${text}</div>`;
    this.el.innerHTML = html;
    // Garde la bulle entièrement à l'écran.
    const bubble = this.el.querySelector('.bubble');
    const half = bubble.offsetWidth / 2;
    const clamped = Math.max(half + 8, Math.min(root.width - half - 8, bx));
    bubble.style.left = `${clamped}px`;
    // La bande sous la barre du haut est réservée aux messages (toast) : si la
    // bulle y monterait, elle passe sous le doigt.
    const h = bubble.offsetHeight;
    const band = this.topBand(root);
    if (by - h < band) bubble.style.top = `${Math.max(ly + 30 + h, band + h)}px`;
  }

  // Bas de la zone des toasts (sous la barre du haut), relatif au conteneur.
  topBand(root) {
    const top = document.getElementById('hud-top');
    const r = top ? top.getBoundingClientRect() : null;
    return r && r.height ? r.bottom - root.top + 54 : 70;
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
    if (!g || paused || this.c.hud.infoOpen || input.ui.drag || g.state === 'won' || g.state === 'lost') {
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
        this.show('place-slot', p.x, p.y, 'Touchez un socle près du chemin');
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
        this.show('fuse', a.x, a.y, 'Glissez une lanterne sur sa jumelle : fusion !', b);
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
        this.show('combo', p.x, p.y, 'Un autre élément à côté = combo');
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
        this.show('stone-spot', p.x, p.y, 'Posez-la sur le gravier');
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
