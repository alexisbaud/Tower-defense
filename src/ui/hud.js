// Interface DOM de la partie : compteurs, palette (regroupée par élément quand
// un élément a plusieurs lanternes), bouton et aperçu de vague, messages,
// bouton « Annuler ».
import { drawTowerIcon } from '../render/towers.js';
import { elementOf, elementInfo, elementBadge, shapeSvg, readable, shortName, roleWord, elementWithArticle, toElement } from './elements.js';
import { WavePreview, earlyCharge } from './wavepreview.js';
import { LONG_PRESS_MS } from './input.js';

const REASONS = {
  gold: "Pas assez d'or",
  occupied: 'Case déjà occupée',
  slot: 'Posez les lanternes sur les socles de pierre',
  blocked: 'Le chemin ne peut pas être bloqué',
  occupiedEnemy: 'Un yokai se tient ici',
  open: 'Les pierres se posent sur le gravier ouvert',
  limit: 'Plus de pierres disponibles',
  level: 'Niveau maximum atteint',
  mismatch: 'Fusion : même lanterne et même niveau',
  over: 'La partie est terminée',
  echo: 'Un écho occupe ce socle : posez ailleurs',
  rewinding: 'Le temps recule…',
  lastChance: 'Rembobinez d’abord !',
  bounds: 'Hors du jardin',
  slotElement: 'Ce socle gravé est réservé à un autre élément',
  challenge: 'Interdit par le défi',
  element: 'Élément d’un autre joueur',
  owner: 'Lanterne d’un autre joueur',
  barrier: 'Une barrière occupe cette case',
  unknown: 'Indisponible dans ce niveau',
};

// Raisons courtes, écrites à côté du fantôme de pose.
const SHORT = {
  occupied: 'Occupé',
  slot: 'Pas un socle',
  blocked: 'Bloqué !',
  occupiedEnemy: 'Un yokai est là',
  open: 'Pas du gravier',
  limit: 'Plus de pierres',
  level: 'Niveau max',
  mismatch: 'Pas jumelles',
  echo: 'Écho présent',
  rewinding: 'Le temps recule…',
  lastChance: 'Rembobinez !',
  challenge: 'Défi',
  barrier: 'Barrière',
};

const STONE_COLOR = '#7d7a70';
const ICON = 52; // taille CSS par défaut des icônes de la palette
const UNDO_SECONDS = 3;

export class Hud {
  /**
   * @param {HTMLElement} root  #screen-game
   * @param {object} handlers  onWave, onPause, onSpeed, onTool(tool), onToolInfo(id),
   *                           onUndo(id), onHold(state, p, ms), onEnemyInfo(type, absorb), onWaveInfo(),
   *                           onElementInfo(element), onTab(element)
   */
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    this.$ = (id) => root.querySelector('#' + id);
    this.lives = this.$('hud-lives');
    this.gold = this.$('hud-gold');
    this.wave = this.$('hud-wave');
    this.palette = this.$('palette');
    this.tabsEl = this.$('palette-tabs');
    this.tab = null; // élément affiché (palette regroupée)
    this.grouped = false;
    this.bindTabs();
    this.footer = this.$('hud-bottom');
    this.actionRow = root.querySelector('.action-row');
    this.waveBtn = this.$('btn-wave');
    this.waveLabel = this.$('btn-wave-label');
    this.waveSub = this.$('btn-wave-sub');
    this.waveKanji = this.$('btn-wave-kanji');
    this.toastEl = this.$('toast');
    this.bannerEl = this.$('banner');
    this.info = this.$('info');
    this.undoEl = this.$('btn-undo');
    this.undoBar = this.undoEl.querySelector('.undo-bar');
    this.preview = new WavePreview(this.$('wave-preview'), {
      onEnemy: (type, absorb) => this.h.onEnemyInfo?.(type, absorb),
      onMore: () => this.h.onWaveInfo?.(),
    });
    this.last = {};
    this.tools = [];
    this.toastTimer = 0;
    this.undo = null;
    this.toolPtr = null;
    // Clic fantôme après un glisser ou un appui long : ignoré sur CE bouton seulement
    // (un toucher rapide sur un autre onglet ou une autre lanterne doit répondre).
    this.suppress = { el: null, until: 0 };

    this.waveBtn.addEventListener('click', () => this.h.onWave());
    this.$('btn-pause').addEventListener('click', () => this.h.onPause());
    this.$('btn-speed').addEventListener('click', () => this.h.onSpeed());
    this.undoEl.addEventListener('click', () => this.undo && this.h.onUndo?.(this.undo.id));
    root.addEventListener('pointerdown', (e) => ripple(e), true);
    // Hauteur de la barre du bas : les toasts, la fiche et « Annuler » se calent dessus.
    const syncFooter = () => {
      const h = this.footer.offsetHeight;
      if (h) root.style.setProperty('--footer-h', `${h}px`);
      this.preview.resize();
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncFooter).observe(this.footer);
    syncFooter();
  }

  setup(game, input) {
    this.game = game;
    this.input = input;
    this.last = {};
    this.palette.innerHTML = '';
    this.tools = [];
    this.hideUndo();
    const defs = game.defs;
    // Lanternes regroupées par élément (ordre de data/elements.js, puis les autres).
    const types = game.availableTowers.filter((t) => defs.towers[t]);
    const order = Object.keys(defs.elements || {});
    const groups = new Map();
    for (const el of order) groups.set(el, []);
    for (const t of types) {
      const el = elementOf(t, defs);
      if (!groups.has(el)) groups.set(el, []);
      groups.get(el).push(t);
    }
    for (const [el, list] of groups) if (!list.length) groups.delete(el);
    this.groups = groups;
    // Une seule lanterne par élément : une rangée simple suffit. Sinon, une rangée
    // d'onglets (un par élément) puis les lanternes de l'élément choisi.
    this.grouped = [...groups.values()].some((l) => l.length > 1);
    this.root.classList.toggle('palette-grouped', this.grouped);
    // nouvelle partie : premier élément (le tutoriel montre la première lanterne)
    this.tab = groups.keys().next().value ?? null;
    this.tool = null;
    this.buildTabs();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    // taille d'icône fixée par la feuille de style (--icon, selon l'écran)
    const size = parseFloat(getComputedStyle(this.palette).getPropertyValue(this.grouped ? '--icon-g' : '--icon')) || ICON;
    const add = (id, opts, draw) => {
      const b = document.createElement('button');
      b.className = `tool${this.grouped ? ' g' : ''}`;
      b.dataset.tool = id;
      if (opts.element) b.dataset.element = opts.element;
      b.style.setProperty('--el', opts.color);
      b.style.setProperty('--el-ink', opts.ink);
      b.setAttribute('aria-label', `${opts.name}${opts.role ? `, ${opts.role}` : ''}, ${opts.cost} or`);
      const cv = document.createElement('canvas');
      cv.width = Math.round(size * dpr);
      cv.height = Math.round(size * dpr);
      const ctx = cv.getContext('2d');
      ctx.scale(dpr, dpr);
      draw(ctx);
      b.appendChild(cv);
      // Forme + kanji (l'élément se lit sans la couleur), libellé français dessous ;
      // palette regroupée : nom court et rôle en un mot (l'onglet dit l'élément).
      const badge = `<span class="el-badge el-${opts.shape}" style="--s:24px">${shapeSvg(opts.shape, opts.ink, 24)}<b>${opts.kanji}</b></span>`;
      if (this.grouped) {
        b.insertAdjacentHTML('beforeend', `<span class="tool-id">${badge}</span><span class="tool-text"><span class="tool-name">${opts.short}</span><span class="tool-role">${opts.roleWord || ''}</span></span><span class="cost">${opts.cost}</span>`);
      } else {
        b.insertAdjacentHTML('beforeend', `<span class="tool-id">${badge}<span class="tool-name">${opts.label}</span></span><span class="cost">${opts.cost}</span>`);
      }
      if (id === 'stone') b.insertAdjacentHTML('beforeend', '<span class="tool-count"></span>');
      this.bindTool(b, id);
      this.palette.appendChild(b);
      this.tools.push({ el: b, id, element: opts.element || null, cost: opts.cost, costEl: b.querySelector('.cost'), countEl: b.querySelector('.tool-count') });
      return b;
    };
    for (const [el, list] of groups) {
      const info = elementInfo(el, defs);
      for (const type of list) {
        const def = defs.towers[type];
        add(
          type,
          { name: def.name, element: el, color: def.color, ink: readable(def.color), shape: info.shape, kanji: def.kanji, label: info.label, short: shortName(type, defs), roleWord: roleWord(type, defs), role: def.role, cost: def.cost },
          (ctx) => drawTowerIcon(ctx, size, size, def),
        );
      }
    }
    // en coopération, seuls les joueurs de la Terre posent des pierres
    if (game.level.stones && game.stoneCost && game.stoneConf?.() && (typeof game.canUseStones !== 'function' || game.canUseStones())) {
      add('stone', { name: 'Pierre', color: STONE_COLOR, ink: readable(STONE_COLOR), shape: 'stone', kanji: '石', label: 'Pierre', short: 'Pierre', roleWord: 'Chemin', cost: game.stoneCost() }, (ctx) => drawStoneIcon(ctx, size, size));
    }
    this.applyTab();
    this.refreshTools();
    this.preview.reset();
    this.update(true);
  }

  // ───────────────────────── onglets d'éléments ─────────────────────────

  buildTabs() {
    const el = this.tabsEl;
    if (!el) return;
    el.innerHTML = '';
    // un seul élément (coopération à 4) : pas d'onglets, les lanternes suffisent
    const single = this.groups.size <= 1;
    el.classList.toggle('hidden', !this.grouped || single);
    if (!this.grouped || single) return;
    const defs = this.game.defs;
    let html = '';
    for (const [id, list] of this.groups) {
      const info = elementInfo(id, defs);
      html += `<button class="ptab" role="tab" data-el="${id}" style="--el:${info.color};--el-ink:${info.ink}" aria-label="${info.label} : ${list.length} lanterne${list.length > 1 ? 's' : ''}">${elementBadge(id, defs, { size: 22 })}<span class="ptab-label">${info.label}</span></button>`;
    }
    el.innerHTML = html;
  }

  // Toucher : afficher les lanternes de l'élément. Appui long : fiche de l'élément.
  bindTabs() {
    const el = this.tabsEl;
    if (!el) return;
    let hold = null;
    const clear = () => {
      if (!hold) return;
      clearTimeout(hold.timer);
      clearTimeout(hold.ring);
      this.h.onHold?.('end');
    };
    el.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.ptab');
      if (!b) return;
      clear();
      const h = { id: b.dataset.el, x: e.clientX, y: e.clientY, long: false };
      hold = h;
      h.ring = setTimeout(() => hold === h && this.h.onHold?.('start', { x: e.clientX, y: e.clientY }, LONG_PRESS_MS - 110), 110);
      h.timer = setTimeout(() => {
        if (hold !== h) return;
        h.long = true;
        this.h.onHold?.('end');
        this.h.onElementInfo?.(h.id);
      }, LONG_PRESS_MS);
    });
    el.addEventListener('pointermove', (e) => {
      if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) {
        clear();
        hold = null;
      }
    });
    const up = () => {
      clear();
      if (hold?.long) this.suppressOn(el.querySelector(`.ptab[data-el="${hold.id}"]`));
      hold = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.ptab');
      if (!b || this.suppressed(b)) return;
      this.showTab(b.dataset.el);
      this.h.onTab?.(b.dataset.el);
    });
  }

  // Affiche l'onglet d'un élément (palette regroupée) ; sans effet sinon.
  showTab(el) {
    if (!this.grouped || !this.groups?.has(el)) return;
    if (this.tab !== el) {
      this.tab = el;
      this.applyTab();
    }
  }

  // Onglet de la lanterne `id` (palette regroupée), pour l'afficher avant de la montrer.
  tabOf(id) {
    return this.tools.find((t) => t.id === id)?.element ?? null;
  }

  applyTab() {
    for (const t of this.tools) t.el.classList.toggle('off-tab', this.grouped && t.element != null && t.element !== this.tab);
    if (!this.tabsEl) return;
    for (const b of this.tabsEl.querySelectorAll('.ptab')) {
      const on = b.dataset.el === this.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    this.markTabs();
  }

  // L'onglet qui contient l'outil choisi porte une marque (l'outil reste actif
  // même si l'on regarde un autre élément).
  markTabs() {
    if (!this.grouped || !this.tabsEl) return;
    const tool = this.input?.ui.tool;
    const el = tool && tool !== 'stone' ? this.tabOf(tool) : null;
    for (const b of this.tabsEl.querySelectorAll('.ptab')) b.classList.toggle('has-tool', b.dataset.el === el);
  }

  // ───────────────────────── palette ─────────────────────────

  // Toucher : choisir l'outil. Appui long : fiche AVANT achat (anneau qui se remplit).
  // Glisser vers le haut : poser directement sur le plateau.
  bindTool(b, id) {
    const clear = (tp) => {
      clearTimeout(tp.timer);
      clearTimeout(tp.holdT);
      this.h.onHold?.('end');
    };
    b.addEventListener('pointerdown', (e) => {
      if (this.toolPtr) return;
      const tp = { id, pid: e.pointerId, x0: e.clientX, y0: e.clientY, long: false, drag: false };
      this.toolPtr = tp;
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      tp.holdT = setTimeout(() => this.toolPtr === tp && this.h.onHold?.('start', { x: e.clientX, y: e.clientY }, LONG_PRESS_MS - 110), 110);
      tp.timer = setTimeout(() => {
        if (this.toolPtr !== tp || tp.drag) return;
        tp.long = true;
        this.h.onHold?.('end');
        this.h.onToolInfo?.(id);
      }, LONG_PRESS_MS);
    });
    b.addEventListener('pointermove', (e) => {
      const tp = this.toolPtr;
      if (!tp || tp.pid !== e.pointerId) return;
      if (tp.drag) {
        this.input.onMove(e);
        return;
      }
      const dx = e.clientX - tp.x0;
      const dy = e.clientY - tp.y0;
      if (Math.hypot(dx, dy) <= 10) return;
      clear(tp);
      if (!tp.long && dy < -12 && -dy > Math.abs(dx) * 0.7 && this.usable(id) && this.input.startFromPalette(id, e)) {
        tp.drag = true;
        this.refreshTools();
        this.h.onTool?.(id, 'drag');
      }
    });
    const end = (e, cancel) => {
      const tp = this.toolPtr;
      if (!tp || tp.pid !== e.pointerId) return;
      clear(tp);
      this.toolPtr = null;
      if (tp.drag) {
        if (cancel) this.input.cancel();
        else this.input.onUp(e);
        this.suppressOn(b);
        this.refreshTools();
      } else if (tp.long) {
        this.suppressOn(b);
      }
    };
    b.addEventListener('pointerup', (e) => end(e, false));
    b.addEventListener('pointercancel', (e) => end(e, true));
    b.addEventListener('click', () => {
      if (this.suppressed(b)) return;
      this.clickTool(id, b);
    });
  }

  suppressOn(el) {
    this.suppress = { el, until: performance.now() + 450 };
  }

  suppressed(el) {
    return this.suppress.el === el && performance.now() < this.suppress.until;
  }

  usable(id) {
    const g = this.game;
    if (!g) return false;
    if (id === 'stone') return g.stonesLeft() > 0;
    return true;
  }

  clickTool(id, b) {
    const g = this.game;
    if (!g) return;
    if (id === 'stone' && g.stonesLeft() <= 0) {
      this.toast('Plus de pierres : touchez une pierre posée pour la retirer');
      if (this.input.ui.tool === 'stone') this.input.setTool('stone');
      this.refreshTools();
      return;
    }
    const tool = this.input.setTool(id);
    this.h.onTool?.(tool);
    this.refreshTools();
    if (tool) pop(b);
  }

  refreshTools() {
    const g = this.game;
    for (const t of this.tools) {
      t.el.classList.toggle('selected', this.input.ui.tool === t.id);
      if (t.id === 'stone' && g) {
        // Pierres restantes : ressource limitée du niveau, l'outil se grise à 0.
        const conf = g.stoneConf?.();
        const left = g.stonesLeft();
        const txt = conf ? `${left}/${conf.max}` : String(left);
        if (t.countEl.textContent !== txt) t.countEl.textContent = txt;
        t.el.classList.toggle('empty', left <= 0);
        t.el.setAttribute('aria-label', `Pierre, ${g.stoneCost()} or, ${left} restante${left > 1 ? 's' : ''}`);
        if (left <= 0 && this.input.ui.tool === 'stone' && !this.input.down) this.input.setTool('stone');
      }
    }
    // l'outil choisi ailleurs (fiche, tutoriel) : son onglet s'affiche
    const tool = this.input.ui.tool;
    if (tool && tool !== 'stone' && this.tool !== tool) this.showTab(this.tabOf(tool));
    this.tool = tool;
    this.markTabs();
  }

  // La bannière (≈ 2,1 s) est-elle encore à l'écran ?
  get bannerShown() {
    return this.bannerAt != null && performance.now() - this.bannerAt < 2100;
  }

  // Petit rebond d'un bouton de la palette (retour d'action).
  popTool(id) {
    const t = this.tools.find((x) => x.id === id);
    if (t) pop(t.el);
  }

  // ───────────────────────── mise à jour par frame ─────────────────────────

  update(force = false) {
    const g = this.game;
    if (!g) return;
    const gold = Math.floor(g.gold);
    if (force || gold !== this.last.gold) {
      this.gold.textContent = gold;
      if (!force && this.last.gold != null) bump(this.gold, gold > this.last.gold ? 'bump' : 'spend');
      this.last.gold = gold;
      for (const t of this.tools) {
        const cost = t.id === 'stone' ? g.stoneCost() : t.cost;
        t.el.classList.toggle('poor', gold < cost);
        // le coût d'une pierre peut évoluer : on garde l'étiquette à jour
        if (t.id === 'stone' && String(cost) !== t.costEl.textContent) t.costEl.textContent = cost;
      }
    }
    // Défi « N lanternes au plus » : poses épuisées, les lanternes se grisent (sans
    // le rouge du manque d'or) ; leur libellé le dit.
    const rule = g.challengeRule;
    const spent = rule?.maxTowers != null && g.stats.towersBuilt >= rule.maxTowers;
    if (force || spent !== this.last.spent) {
      this.last.spent = spent;
      for (const t of this.tools) {
        if (t.id === 'stone') continue;
        t.el.classList.toggle('spent', spent);
        const base = t.el.getAttribute('aria-label').replace(/ · défi : .*$/, '');
        t.el.setAttribute('aria-label', spent ? `${base} · défi : ${rule.maxTowers} lanternes déjà posées` : base);
      }
    }
    if (force || g.lives !== this.last.lives) {
      this.lives.textContent = g.lives;
      if (!force) bump(this.lives, g.lives < (this.last.lives ?? 0) ? 'hurt' : 'bump');
      this.lives.parentElement.classList.toggle('low', g.lives <= Math.max(3, g.maxLives * 0.25));
      this.last.lives = g.lives;
    }
    const stones = g.level.stones ? `${g.stonesLeft()}` : '';
    if (force || stones !== this.last.stones) {
      this.last.stones = stones;
      this.refreshTools();
    }
    const waveNum = Math.max(0, g.waveIndex + 1);
    const waveStr = `${waveNum}/${g.totalWaves}`;
    if (waveStr !== this.last.wave) {
      this.wave.innerHTML = `<small>Vague</small><b>${waveNum}<i>/${g.totalWaves}</i></b>`;
      this.wave.setAttribute('aria-label', `Vague ${waveNum} sur ${g.totalWaves}`);
      this.last.wave = waveStr;
    }
    this.updateWaveButton(g);
    this.updateUndo(g);
  }

  // Bouton de vague. Les vagues se chevauchent : après la première, il n'y a plus
  // de phase de construction ; le bouton montre en permanence la vague suivante,
  // son compte à rebours, et ce que rapporte un appel anticipé (+or, +charge 巻).
  // Aperçu de la vague suivante à côté.
  updateWaveButton(g) {
    const pv = g.nextWavePreview ? g.nextWavePreview() : null;
    const canCall = typeof g.canCallNextWave === 'function' ? !!g.canCallNextWave() : g.state === 'build';
    let label;
    let sub = '';
    let enabled;
    let mode;
    let aria;
    if (g.waveIndex < 0 && pv) {
      enabled = canCall;
      mode = 'ready';
      label = 'Commencer';
      sub = `${g.totalWaves} vagues`;
      aria = `Commencer : ${g.totalWaves} vagues`;
    } else if (pv) {
      enabled = canCall;
      mode = pv.countdown != null && pv.countdown <= 5 ? 'soon' : 'call';
      label = pv.climax ? `Climax ${pv.index + 1}` : `Vague ${pv.index + 1}`;
      const parts = [];
      const charge = earlyCharge(g, pv);
      if (pv.countdown != null) parts.push(`${Math.max(0, Math.ceil(pv.countdown))} s`);
      if (pv.bonus > 0) parts.push(`+${pv.bonus} or`);
      if (charge > 0) parts.push(`+${charge} 巻`);
      sub = parts.join(' · ');
      aria = `Appeler la vague ${pv.index + 1}${pv.name ? ` « ${pv.name} »` : ''} maintenant${pv.bonus > 0 ? ` : +${pv.bonus} or` : ''}${charge > 0 ? `, +${charge} de charge du Rembobinage` : ''}${pv.countdown != null ? `. Elle arrive seule dans ${Math.max(0, Math.ceil(pv.countdown))} s` : ''}`;
    } else {
      enabled = false;
      mode = g.state === 'wave' ? 'running' : 'over';
      label = g.state === 'wave' ? 'Dernière vague' : '—';
      sub = g.state === 'wave' ? 'en cours' : '';
      aria = label;
    }
    const climax = !!pv?.climax;
    if (label !== this.last.label) {
      this.waveLabel.textContent = label;
      this.last.label = label;
    }
    if (sub !== this.last.sub) {
      this.waveSub.textContent = sub;
      this.waveSub.classList.toggle('hidden', !sub);
      this.last.sub = sub;
    }
    if (aria !== this.last.aria) {
      this.waveBtn.setAttribute('aria-label', aria);
      this.last.aria = aria;
    }
    if (enabled !== this.last.enabled) {
      this.waveBtn.classList.toggle('disabled', !enabled);
      this.waveBtn.setAttribute('aria-disabled', String(!enabled));
      this.last.enabled = enabled;
    }
    if (mode !== this.last.mode) {
      this.waveBtn.dataset.mode = mode;
      this.last.mode = mode;
    }
    if (climax !== this.last.climax) {
      this.waveBtn.classList.toggle('climax', climax);
      this.waveKanji.textContent = climax ? '嵐' : '波';
      this.last.climax = climax;
    }
    const pulse = g.waveIndex < 0 && g.towers.length > 0;
    if (pulse !== this.last.pulse) {
      this.waveBtn.classList.toggle('pulse', pulse);
      this.last.pulse = pulse;
    }
    const showPv = !!pv;
    this.preview.update(g, showPv ? pv : null);
    if (showPv !== this.last.showPv) {
      this.actionRow.classList.toggle('has-preview', showPv);
      this.last.showPv = showPv;
      this.preview.resize();
    }
  }

  popWave() {
    pop(this.waveBtn);
  }

  // ───────────────────────── Annuler (3 s après une pose) ─────────────────────────

  showUndo(tower) {
    if (!tower) return;
    this.undo = { id: tower.id, bornAt: tower.bornAt ?? this.game.time };
    this.undoEl.classList.remove('hidden');
    this.root.classList.add('has-undo');
    this.updateUndo(this.game);
  }

  updateUndo(g) {
    if (!this.undo) return;
    const t = g.towerById(this.undo.id);
    const left = UNDO_SECONDS - (g.time - this.undo.bornAt);
    if (!t || t.level !== 1 || left <= 0 || g.rewindAnim || g.state === 'won' || g.state === 'lost') {
      this.hideUndo();
      return;
    }
    const k = Math.max(0, Math.min(1, left / UNDO_SECONDS));
    const s = k.toFixed(2);
    if (s !== this.last.undo) {
      this.undoBar.style.transform = `scaleX(${s})`;
      this.last.undo = s;
    }
  }

  hideUndo() {
    this.undo = null;
    this.undoEl.classList.add('hidden');
    this.root.classList.remove('has-undo');
  }

  // ───────────────────────── messages ─────────────────────────

  // Message bref dans la bande au-dessus de la barre du bas (jamais sur les portails).
  toast(msg, bad = false, ms = 1600) {
    const el = this.toastEl;
    el.textContent = msg;
    el.classList.toggle('bad', bad);
    // relance l'animation d'entrée même si un message est déjà affiché
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  // `data.element` : élément d'un socle gravé (refus 'slotElement').
  reason(code, data = {}) {
    if (code === 'slotElement' && data.element && this.game) {
      const info = elementInfo(data.element, this.game.defs);
      return `${info.glyph} Ce socle gravé ${info.kanji} n’accepte que ${elementWithArticle(data.element, this.game.defs)}`;
    }
    return REASONS[code] || null;
  }

  shortReason(code, data = {}) {
    if (code === 'slotElement' && data.element && this.game) {
      const info = elementInfo(data.element, this.game.defs);
      return `${info.glyph} Socle réservé ${toElement(data.element, this.game.defs)}`;
    }
    return SHORT[code] || REASONS[code] || null;
  }

  // `cls` : variante ('climax' : vague nommée, pinceau vermillon et or).
  banner(big, small = '', cls = '') {
    const el = this.bannerEl;
    this.bannerAt = performance.now(); // la carte « Nouveau yokai » évite la bannière affichée
    el.innerHTML = `<span class="big">${big}</span>${small ? `<span class="small">${small}</span>` : ''}`;
    el.classList.toggle('climax', cls === 'climax');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  hideInfo() {
    this.info.classList.add('hidden');
  }

  get infoOpen() {
    return !this.info.classList.contains('hidden');
  }
}

function bump(el, cls = 'bump') {
  el.classList.remove('bump', 'hurt', 'spend');
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 280);
}

// Petit rebond d'un bouton (retour d'action), sans gêner son état :active.
export function pop(el) {
  if (!el) return;
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
  setTimeout(() => el.classList.remove('pop'), 320);
}

// Ondulation d'encre sous le doigt sur tous les boutons. Elle vit dans un
// calque rogné propre au bouton : les pastilles qui débordent (étoiles,
// numéros de la carte) ne sont jamais coupées.
export function ripple(e) {
  const btn = e.target.closest?.('button');
  if (!btn || btn.classList.contains('disabled')) return;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  let box = btn.querySelector(':scope > .ripple-box');
  if (!box) {
    box = document.createElement('span');
    box.className = 'ripple-box';
    if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
    btn.appendChild(box);
  }
  const r = document.createElement('span');
  r.className = 'ripple';
  r.style.width = r.style.height = `${size}px`;
  r.style.left = `${e.clientX - rect.left - size / 2}px`;
  r.style.top = `${e.clientY - rect.top - size / 2}px`;
  box.appendChild(r);
  setTimeout(() => r.remove(), 520);
}

// Icône de la pierre : galet gris cerné d'encre, coussin de mousse, ombre douce.
export function drawStoneIcon(ctx, w, h) {
  const x = w / 2;
  const y = h * 0.54;
  const r = w * 0.27;
  ctx.clearRect(0, 0, w, h);
  // ombre portée
  ctx.fillStyle = 'rgba(29,27,34,0.2)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.12, y + r * 0.55, r * 1.15, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  // galet
  ctx.beginPath();
  ctx.moveTo(x - r * 1.02, y + r * 0.45);
  ctx.bezierCurveTo(x - r * 1.15, y - r * 0.35, x - r * 0.45, y - r * 0.95, x + r * 0.05, y - r * 0.88);
  ctx.bezierCurveTo(x + r * 0.75, y - r * 0.82, x + r * 1.12, y - r * 0.2, x + r * 1.02, y + r * 0.45);
  ctx.quadraticCurveTo(x, y + r * 0.62, x - r * 1.02, y + r * 0.45);
  ctx.closePath();
  ctx.fillStyle = '#9a968a';
  ctx.fill();
  // flanc dans l'ombre
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(61,58,52,0.45)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.7, y + r * 0.35, r * 0.75, r * 0.85, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(242,232,208,0.45)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.45, y - r * 0.45, r * 0.38, r * 0.16, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#1d1b22';
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // mousse sur le dessus
  ctx.fillStyle = '#6f7f3c';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.12, y - r * 0.72, r * 0.5, r * 0.16, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4a5628';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.02, y - r * 0.66, r * 0.28, r * 0.08, -0.12, 0, Math.PI * 2);
  ctx.fill();
}
