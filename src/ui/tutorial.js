// Tutoriel intégré, sans mur de texte : un doigt et une courte bulle montrent
// le geste suivant, en fonction de l'état de la partie. Les étapes viennent de
// `level.tutorial` : place, wave, early (appel anticipé), fuse, combo, stone,
// barrier (poser un Gardien et déplacer son mur), priority (régler la cible),
// rewind (mini-tutoriel dédié de la jauge).
// Une lanterne en construction (2 s) compte déjà comme posée : le doigt ne redemande
// pas de choisir une lanterne pendant qu'elle se construit. De même, une pierre ou un
// mur en construction : la leçon attend qu'ils soient posés, sans réclamer la suite.
import { T } from '../core/grid.js';
import { bfs } from '../core/flowfield.js';
import { rallyTiles, isBarrierTower } from './overlay.js';
import { rewindRules } from './sheets.js';
import { aims } from './towerbar.js';
import { elementWithArticle, elementInfo } from './elements.js';
import { earlyCharge } from './wavepreview.js';
import { commands } from './commands.js';

// Lanternes posées ou en construction ?
const hasTowers = (g) => g.towers.length > 0 || commands.builds().some((b) => b.op === 'placeTower');

export class Tutorial {
  constructor(el, ctx) {
    this.el = el; // conteneur #hint
    this.c = ctx; // { game(), input, renderer, canvas, hud, gauge, towerBar, pause(bool), modal(html, buttons) }
    this.done = new Set();
    this.steps = [];
    this.current = null;
    this.rewindPhase = 0;
    this.fuseSeen = false;
    // La police de la bulle arrive parfois après la première indication : la bulle
    // s'élargit alors sans être replacée (elle débordait de l'écran en 375 px).
    document.fonts?.addEventListener?.('loadingdone', () => (this.current = null));
  }

  // Une bulle est-elle affichée ? (le couloir de messages retient alors ses messages 0–1)
  get showing() {
    return this.current !== null;
  }

  // `enabled` : faux en coopération (le tutoriel n'accompagne que la partie en solo).
  start(game, enabled = true) {
    // Masquer d'abord l'indication éventuelle du niveau précédent.
    this.hide();
    this.el.classList.add('hidden');
    this.el.innerHTML = '';
    this.steps = enabled ? [...(game.level.tutorial || [])] : [];
    this.done = new Set();
    // défi « sans Rembobinage » : la jauge est cachée, pas de leçon à son sujet
    this.rewindPhase = this.steps.includes('rewind') && game.rewindEnabled !== false ? 1 : 0;
    this.waveT0 = null; // instant (game.time) du lancement de la première vague
    this.wave1Done = false; // l'appel anticipé ne s'apprend qu'après la première vague
  }

  onEvent(ev) {
    const g = this.c.game();
    switch (ev.type) {
      case 'place':
        this.done.add('place');
        break;
      case 'waveEnd':
        this.wave1Done = true;
        break;
      case 'waveStart':
        this.done.add('wave');
        if (this.waveT0 == null && g) this.waveT0 = g.time;
        // appel anticipé : une vague lancée avant la fin de son compte à rebours
        if (ev.early && ev.index > 0) this.done.add('early');
        break;
      case 'rally':
        this.done.add('barrier');
        break;
      case 'priority':
        this.done.add('priority');
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
    } else if (opts.halo) {
      // halo autour de la cible (cadran du bouton de vague) : le repère l'entoure sans
      // couvrir le 波 ni les secondes
      const d = Math.round(opts.halo);
      html += `<div class="finger halo" style="left:${lx}px;top:${ly}px;width:${d}px;height:${d}px;margin:${-d / 2}px 0 0 ${-d / 2}px"></div>`;
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
    // Enveloppe du geste montré (cibles, doigt, arrivée) : le sanctuaire n'en fait pas
    // partie (en bas du plateau, il étirait l'enveloppe à tout le plateau et la bulle
    // retombait sur la lanterne qu'elle demande de glisser).
    const union = avoid.reduce((u, r) => ({ l: Math.min(u.l, r.l), t: Math.min(u.t, r.t), r: Math.max(u.r, r.r), b: Math.max(u.b, r.b) }), { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity });
    const goal = this.goalRect();
    if (goal) avoid.push(rel(goal));
    const top = this.topBand(root);
    let bottom = this.bottomBand(root);
    if (opts.above != null) bottom = Math.min(bottom, opts.above - root.top - 10);
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
    const over = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
    let best = null;
    let least = null; // repli : la place dans l'écran qui couvre le moins les zones à voir
    for (const [cx, by] of cands) {
      const l = Math.max(8, Math.min(W - bw - 8, cx - bw / 2));
      const r = { l, r: l + bw, t: by - bh, b: by };
      if (r.t < top || r.b > bottom) continue;
      if (avoid.some((a) => hit(a, r))) {
        const o = avoid.reduce((n, a) => n + over(a, r), 0);
        if (!least || o < least.o) least = { ...r, o };
        continue;
      }
      best = r;
      break;
    }
    if (!best && least) best = least;
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

  // Bord haut d'une carte de la palette : l'anneau du doigt la montre sans couvrir son nom.
  edgeOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top - 8 };
  }

  // Cadran du bouton de vague : l'anneau du doigt ne couvre pas « Vague 1 ».
  dialOf(btn) {
    const d = btn.querySelector('.wave-dial') || btn;
    return this.elCenter(d);
  }

  // Diamètre du halo autour du cadran (cadran + 12).
  dialSize(btn) {
    const d = btn.querySelector('.wave-dial');
    return (d ? d.getBoundingClientRect().width : 38) + 12;
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
        if (hasTowers(g)) return false; // en construction : rien à montrer
        const tool = input.ui.tool;
        if (!tool || tool === 'stone') {
          const first = hud.tools.find((t) => t.id !== 'stone' && !t.el.classList.contains('off-tab'));
          if (!first) return false;
          const p = this.edgeOf(first.el);
          this.show('place-tool', p.x, p.y, 'Choisissez une lanterne', null, { above: this.footerTop() });
          return true;
        }
        const tdef = g.defs.towers[tool];
        const el = tdef.element ?? tool;
        const slot = this.bestSlot(g, tdef.levels[0].range, el);
        if (!slot) return false;
        const p = this.tileToPage(slot.c, slot.r);
        // la règle des socles réservés tient dans la bulle de pose
        const reserved = g.grid.slotElement?.some((x) => x === el);
        const text = reserved ? `Touchez un socle lisse, ou réservé ${elementInfo(el, g.defs).glyph}` : 'Touchez un socle près du chemin';
        this.show('place-slot', p.x, p.y, text, null, { avoid: [this.tileRect(slot.c, slot.r, 0)] });
        return true;
      }
      case 'wave': {
        if (g.waveIndex >= 0) {
          this.done.add('wave');
          return false;
        }
        if (!hasTowers(g)) return false;
        const p = this.dialOf(hud.waveBtn);
        this.show('wave', p.x, p.y, 'Lancez la vague !', null, { avoid: [hud.waveBtn.getBoundingClientRect()], halo: this.dialSize(hud.waveBtn) });
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
        // avant la première vague, ou dans un moment calme (plus aucun yokai en jeu)
        if (!g.towers.length || (g.waveIndex >= 0 && g.enemies.length > 0)) return false;
        if (g.zones.length) {
          this.done.add('combo');
          return false;
        }
        // Lanterne choisie qui ferait un combo : le socle où la poser (compatible
        // avec les socles gravés). Sinon, d'abord une lanterne d'un autre élément :
        // toucher un socle sans lanterne choisie ne fait rien (indication sans issue).
        const tool = input.ui.tool && input.ui.tool !== 'stone' ? input.ui.tool : null;
        const spot = tool ? this.comboSpot(g, tool) : null;
        if (spot) {
          const p = this.tileToPage(spot.c, spot.r);
          // la case visée, ses voisines (et le lien de combo qui naîtra) restent visibles
          this.show('combo', p.x, p.y, 'Un autre élément à côté = combo', null, { avoid: [this.tileRect(spot.c, spot.r, 1)] });
          return true;
        }
        const pick = this.comboPick(g);
        const item = pick && hud.tools.find((t) => t.id === pick);
        if (!item) return false;
        const text = `Un autre élément à côté = combo : prenez ${elementWithArticle(item.element ?? pick, g.defs)}`;
        if (item.el.classList.contains('off-tab')) {
          const tab = hud.tabsEl?.querySelector(`.ptab[data-el="${item.element}"]`);
          if (!tab) return false;
          const p = this.elCenter(tab);
          this.show('combo-tab', p.x, p.y, text, null, { above: this.footerTop() });
          return true;
        }
        const p = this.elCenter(item.el);
        this.show('combo-tool', p.x, p.y - 6, text, null, { above: this.footerTop() });
        return true;
      }
      case 'stone': {
        // pierre en construction : la leçon attend qu'elle soit posée (le doigt ne
        // réclame pas déjà la suivante ; refusée, la leçon reprend)
        if (commands.builds().some((b) => b.op === 'placeStone' && b.mine)) {
          this.hide();
          return true;
        }
        if (!g.level.stones || commands.stonesLeft() <= 0) return false;
        if (g.waveIndex < 0 && !hasTowers(g)) return false;
        if (input.ui.tool !== 'stone') {
          const st = hud.tools.find((t) => t.id === 'stone');
          if (!st || commands.spendable() < g.stoneCost()) return false;
          const p = this.elCenter(st.el);
          this.show('stone-tool', p.x, p.y - 6, 'Des pierres pour allonger le chemin', null, { above: this.footerTop() });
          return true;
        }
        const spot = this.stoneSpot(g);
        if (!spot) return false;
        const p = this.tileToPage(spot.c, spot.r);
        // Gravier large : aucune pierre seule n'allonge le chemin (« Sans effet ») ;
        // la bulle le dit au lieu de promettre un détour qui n'arrive pas.
        const text = spot.gain > 0 ? 'Glissez-la sur le gravier' : 'Glissez-la sur le chemin : alignez-en plusieurs pour l’allonger';
        this.show('stone-spot', p.x, p.y, text, null, { avoid: [this.tileRect(spot.c, spot.r, 1)] });
        return true;
      }
      case 'early': {
        // Appeler la vague suivante en avance : seulement après la fin de la première
        // vague, quand la vague en cours a fini d'apparaître (ou presque plus de yokai).
        if (g.waveIndex < 0 || !this.wave1Done || !g.canCallNextWave?.()) return false;
        const pv = g.nextWavePreview?.();
        if (!pv || !(pv.bonus > 0)) return false;
        const calm = g.spawnersDone?.(g.waveIndex) || g.enemies.length <= 2;
        if (!calm) return false;
        const p = this.dialOf(hud.waveBtn);
        const charge = earlyCharge(g, pv);
        const gain = `+${pv.bonus} or${charge > 0 ? ` · +${charge} 巻` : ''}`;
        this.show('early', p.x, p.y, `Appelez la vague suivante en avance : ${gain}`, null, { above: this.footerTop(), halo: this.dialSize(hud.waveBtn) });
        return true;
      }
      case 'priority': {
        // Une lanterne qui vise ; touchée, sa barre d'actions propose la priorité.
        const t = g.towers.find((x) => aims(g.defs.towers[x.type]));
        if (!t) return false;
        const bar = this.c.towerBar;
        const shown = bar && !bar.classList.contains('hidden');
        // les quatre choix ouverts : « Fort »
        const strong = shown ? bar.querySelector('.tb-pick[data-p="strong"]') : null;
        if (strong && input.ui.selectedTower === t.id) {
          const p = this.elCenter(strong);
          this.show('priority-pick', p.x, p.y, 'Visez « Fort » : la yuki-onna qui soigne tombe la première', null, { avoid: [bar.getBoundingClientRect()] });
          return true;
        }
        const prio = shown ? bar.querySelector('.tb-prio') : null;
        if (prio && input.ui.selectedTower === t.id) {
          const p = this.elCenter(prio);
          this.show('priority-btn', p.x, p.y, 'Choisissez sa cible : visez « Fort »', null, { avoid: [prio.getBoundingClientRect()] });
          return true;
        }
        if (input.ui.selectedTower != null || input.ui.tool) return false;
        const p = this.tileToPage(t.c, t.r);
        this.show('priority', p.x, p.y, 'Touchez une lanterne pour régler sa cible', null, { avoid: [this.tileRect(t.c, t.r, 0)] });
        return true;
      }
      case 'barrier':
        return this.barrierStep(g, input);
      default:
        return false;
    }
  }

  // Poser un Gardien de pierre, puis déplacer son mur sur le chemin.
  barrierStep(g, input) {
    const hud = this.c.hud;
    const guard = g.towers.find((t) => isBarrierTower(g, t));
    const guardType = g.availableTowers.find((t) => g.defs.towers[t]?.attack === 'barrier');
    if (!guardType) return false;
    if (!guard) {
      if (g.waveIndex < 0 && !g.towers.length) return false; // d'abord les premières lanternes
      if (commands.builds().some((b) => b.op === 'placeTower' && b.type === guardType)) return false; // il se construit
      if (input.ui.tool !== guardType) {
        const tool = hud.tools.find((t) => t.id === guardType);
        if (!tool || commands.spendable() < g.defs.towers[guardType].cost) return false;
        // palette regroupée : d'abord l'onglet de l'élément
        if (tool.el.classList.contains('off-tab')) {
          const tab = hud.tabsEl?.querySelector(`.ptab[data-el="${tool.element}"]`);
          if (!tab) return false;
          const p = this.elCenter(tab);
          this.show('barrier-tab', p.x, p.y, 'Le Gardien de pierre est dans la Terre', null, { above: this.footerTop() });
          return true;
        }
        const p = this.elCenter(tool.el);
        this.show('barrier-tool', p.x, p.y - 6, 'Le Gardien dresse un mur sur le chemin', null, { above: this.footerTop() });
        return true;
      }
      const def = g.defs.towers[guardType];
      const slot = this.bestSlot(g, def.levels[0].range, def.element ?? guardType);
      if (!slot) return false;
      const p = this.tileToPage(slot.c, slot.r);
      this.show('barrier-slot', p.x, p.y, 'Posez-le près du chemin', null, { avoid: [this.tileRect(slot.c, slot.r, 0)] });
      return true;
    }
    // mur en train de se déplacer (construction de 2 s) : la leçon attend qu'il se
    // dresse, sans redemander de le déplacer
    if (commands.builds().some((b) => b.op === 'setRally' && b.towerId === guard.id)) {
      this.hide();
      return true;
    }
    if (input.ui.rally?.towerId === guard.id) {
      const tiles = rallyTiles(g, guard);
      const bar = g.barriers.find((b) => b.towerId === guard.id);
      const i = tiles.find((x) => !bar || x !== bar.tile);
      if (i == null) return false;
      const p = this.tileToPage(g.grid.col(i), g.grid.row(i));
      this.show('barrier-tile', p.x, p.y, 'Touchez une case allumée : le mur s’y dresse', null, { avoid: [this.tileRect(g.grid.col(i), g.grid.row(i), 0)] });
      return true;
    }
    const bar = this.c.towerBar;
    const btn = bar && !bar.classList.contains('hidden') ? bar.querySelector('.tb-rally') : null;
    if (btn && input.ui.selectedTower === guard.id) {
      const p = this.elCenter(btn);
      this.show('barrier-btn', p.x, p.y, 'Déplacez son mur où les yokai se regroupent', null, { avoid: [btn.getBoundingClientRect()] });
      return true;
    }
    if (input.ui.selectedTower != null || input.ui.tool) return false;
    const p = this.tileToPage(guard.c, guard.r);
    this.show('barrier-guard', p.x, p.y, 'Touchez le Gardien pour déplacer son mur', null, { avoid: [this.tileRect(guard.c, guard.r, 0)] });
    return true;
  }

  updateRewind(g) {
    const waveT = this.waveT0 != null ? g.time - this.waveT0 : 0;
    if (this.rewindPhase === 1 && g.state === 'wave' && waveT > 2.5) {
      this.rewindPhase = 2;
      this.hide();
      this.c.pause(true, true);
      const sec = g.rules.rewindSeconds ?? 6;
      this.c.modal(
        `<div class="modal-kanji">巻戻</div>
         <h2>Le Rembobinage</h2>
         <p>La <b>jauge 巻</b> se remplit quand vous apaisez des yokai et quand vous appelez une vague en avance. <b>Pleine, touchez-la deux fois</b> (ou glissez-la vers la gauche) : le temps recule de ${sec} secondes.</p>
         <div class="demo-gauge"><span class="demo-knob">巻</span></div>
         <div class="rules">${rewindRules(g, true)}</div>`,
        [{ label: 'Compris', cls: 'primary', run: () => this.c.pause(false, true) }],
      );
      return true;
    }
    if (this.rewindPhase === 2 && g.canRewind() && g.rewindAvailable() >= Math.min(5, (g.rules.rewindSeconds ?? 6) - 0.5)) {
      const tr = this.c.gauge.trackRect();
      const kr = this.c.gauge.knobRect();
      const from = { x: kr.left + kr.width / 2, y: kr.top + kr.height / 2 };
      const to = { x: tr.left + tr.width * 0.25, y: from.y };
      const recent = g.towers.some((t) => g.time - t.bornAt < 5);
      this.show('rewind', from.x, from.y, recent ? 'Jauge pleine : touchez-la deux fois, la lanterne laissera un écho' : 'Jauge pleine : touchez-la deux fois (ou glissez ◀◀) pour remonter le temps', to);
      return true;
    }
    return false;
  }

  // ───── heuristiques de placement pour les indications ─────

  routeTiles(g) {
    const tiles = new Set();
    for (const s of g.grid.spawns) for (const i of g.flow.route(s, 0, 1)) tiles.add(i);
    return tiles;
  }

  // Socle libre (compatible avec `element` : universel ou gravé de cet élément)
  // qui couvre le plus de cases du trajet.
  bestSlot(g, range, element = null) {
    const grid = g.grid;
    const tiles = this.routeTiles(g);
    let best = null;
    let bestN = 0;
    for (let i = 0; i < grid.size; i++) {
      if (grid.type(i) !== T.SLOT || g.towerAt(grid.col(i), grid.row(i)) || commands.buildAt(grid.col(i), grid.row(i))) continue;
      const se = grid.slotElement?.[i];
      if (element && se && se !== element) continue;
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

  // Socle libre voisin d'une lanterne où poser `type` ferait naître un combo
  // (socle gravé compatible, pas d'écho dessus).
  comboSpot(g, type) {
    const grid = g.grid;
    for (const t of g.towers) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const c = t.c + dx;
          const r = t.r + dy;
          if (!grid.inBounds(c, r) || grid.type(grid.idx(c, r)) !== T.SLOT) continue;
          const chk = commands.check('placeTower', type, c, r);
          if (!chk.ok && chk.reason !== 'gold') continue;
          if (g.previewCombos(type, c, r).length) return { c, r };
        }
      }
    }
    return null;
  }

  // Lanterne (la moins chère, abordable) qui ferait un combo quelque part.
  comboPick(g) {
    const gold = commands.spendable();
    const list = g.availableTowers.filter((t) => gold >= g.defs.towers[t].cost).sort((a, b) => g.defs.towers[a].cost - g.defs.towers[b].cost);
    return list.find((t) => this.comboSpot(g, t)) ?? null;
  }

  // Case de gravier où une pierre allonge le plus le chemin ; à gain égal, une case
  // du trajet actuel (l'aperçu montre alors le détour), la plus proche des portails.
  stoneSpot(g) {
    const grid = g.grid;
    const base = g.routeLength();
    const route = this.routeTiles(g);
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < grid.size; i++) {
      if (grid.type(i) !== T.OPEN || grid.stone[i]) continue;
      if (!commands.check('placeStone', grid.col(i), grid.row(i)).ok) continue;
      const dist = bfs(grid, i);
      let len = 0;
      for (const s of grid.spawns) len += dist[s];
      const gain = len - base;
      const score = gain * 1000 + (route.has(i) ? 100 : 0) + Math.max(0, g.flow.dist[i]) * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = { c: grid.col(i), r: grid.row(i), gain };
      }
    }
    return best;
  }
}
