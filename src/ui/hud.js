// Interface DOM de la partie (docs/UI-UX.md §6.2 à §6.6) : « lire en haut, agir en bas ».
//
//   HUD (44)      vies, or (cases fixes, rien ne glisse), or promis dans sa case réservée,
//                 bloc vague n/N + barre de progression (repère du climax), capsule du
//                 temps ×1/×2 et pause.
//   Rangée (46)   jauge 巻, aperçu de la vague suivante (collé au bouton), « Annuler » à
//                 place fixe (remplace l'aperçu), bouton de vague de largeur fixe (cadran :
//                 secondes dans un anneau qui se vide, « Vague N », prime « +12 »).
//   Palette       onglets d'éléments soudés à une boîte de lanternes (palette groupée),
//                 4 grandes cartes (palette simple), ou la rangée d'équipe à la place des
//                 onglets (coopération) ; la pierre est épinglée à droite.
//   Messages      un seul couloir en haut du plateau (src/ui/lane.js) ; les indications
//                 près d'un contrôle s'écrivent à côté de lui (tip).
// Or : le compteur montre l'or DISPONIBLE (commands.spendable : bourse moins l'or promis
// aux constructions en cours) ; « −X » dans sa case réservée dit l'or promis.
import { drawTowerIcon } from '../render/towers.js';
import { commands } from './commands.js';
import { elementOf, elementInfo, elementBadge, readable, shortName, roleWord, elementWithArticle, toElement } from './elements.js';
import { WavePreview, earlyCharge } from './wavepreview.js';
import { LONG_PRESS_MS } from './input.js';
import { setDigits, digitsHTML } from './fmt.js';
import { Lane } from './lane.js';
import { soberFx } from './coins.js';

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
  slotElement: 'Ce socle est réservé à un autre élément',
  challenge: 'Interdit par le défi',
  element: 'Élément d’un autre joueur',
  owner: 'Lanterne d’un autre joueur',
  barrier: 'Une barrière occupe cette case',
  unknown: 'Indisponible dans ce niveau',
  pending: 'Une construction occupe déjà cette case',
};

// Raisons courtes, écrites près du geste (bulle de refus).
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
  late: 'Trop tard pour annuler', // (coopération : annulation refusée par l'hôte)
  busy: 'Déjà en cours', // (coopération : fusion ou vente en route)
};

const STONE_COLOR = '#5a5850';
// Texte inséré dans le HTML : le nom d'une vague peut venir de l'hôte (réseau).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const UNDO_SECONDS = 3; // après l'activation d'une lanterne (la construction s'y ajoute)
const BANNER_MS = 1800;
export const tipMs = (text) => Math.max(2200, Math.min(5000, 1000 + 50 * String(text || '').length));

export class Hud {
  /**
   * @param {HTMLElement} root  #screen-game
   * @param {object} handlers  onWave, onPause, onSpeed, onTool(tool), onToolInfo(id),
   *                           onUndo(ticket), onHold(state, p, ms), onEnemyInfo(type, absorb), onWaveInfo(),
   *                           onElementInfo(element), onTab(element), isNew(type),
   *                           laneAvoid(), laneTop(), laneHold(), onLaneAct(action),
   *                           onLanePass(pointerdown) (geste passé au plateau sous un message),
   *                           laneOverBoard(pointerdown) (une lanterne sous le message ?)
   */
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    this.$ = (id) => root.querySelector('#' + id);
    this.lives = this.$('hud-lives');
    this.gold = this.$('hud-gold');
    this.reservedEl = this.$('hud-reserved');
    this.wave = this.$('hud-wave');
    this.waveCur = this.$('hud-wave-n');
    this.waveTotal = this.$('hud-wave-total');
    this.waveFill = this.wave.querySelector('.wave-bar-fill');
    this.waveClimax = this.wave.querySelector('.wave-bar-climax');
    this.palette = this.$('palette');
    this.pin = this.$('palette-pin');
    this.tabsEl = this.$('palette-tabs');
    this.teamEl = this.$('team-row');
    this.area = root.querySelector('.palette-area');
    this.tab = null; // élément affiché (palette regroupée)
    this.grouped = false;
    this.mode = 'simple';
    this.bindTabs();
    this.footer = this.$('hud-bottom');
    this.actionRow = root.querySelector('.action-row');
    this.waveBtn = this.$('btn-wave');
    this.waveLabel = this.$('btn-wave-label');
    this.waveSub = this.$('btn-wave-sub');
    this.waveKanji = this.$('btn-wave-kanji');
    this.waveDial = this.waveBtn.querySelector('.wave-dial');
    this.bannerEl = this.$('banner');
    this.info = this.$('info');
    this.tipEl = this.$('tip');
    this.undoEl = this.$('btn-undo');
    this.undoSub = this.$('btn-undo-sub');
    this.lane = new Lane(this.$('lane'), {
      avoid: () => this.h.laneAvoid?.() ?? [],
      top: () => this.h.laneTop?.() ?? 10,
      hold: () => !!this.h.laneHold?.() || this.bannerShown,
      onAct: (a, m) => this.h.onLaneAct?.(a, m),
      pass: (e) => this.h.onLanePass?.(e),
      over: (e) => !!this.h.laneOverBoard?.(e),
    });
    this.preview = new WavePreview(this.$('wave-preview'), {
      onEnemy: (type, absorb) => this.h.onEnemyInfo?.(type, absorb),
      onMore: () => this.h.onWaveInfo?.(),
      isNew: (type) => !!this.h.isNew?.(type),
    });
    this.last = {};
    this.tools = [];
    this.undo = null;
    this.toolPtr = null;
    this.goldDebt = 0; // or encore « en vol » (pièces) : le compteur monte à leur arrivée
    this.roll = null;
    // Clic fantôme après un glisser ou un appui long : ignoré sur CE bouton seulement
    // (un toucher rapide sur un autre onglet ou une autre lanterne doit répondre).
    this.suppress = { el: null, until: 0 };

    this.waveBtn.addEventListener('click', () => this.h.onWave());
    this.$('btn-pause').addEventListener('click', () => this.h.onPause());
    this.$('btn-speed').addEventListener('click', () => this.h.onSpeed());
    this.undoEl.addEventListener('click', () => this.undo && this.h.onUndo?.(this.undo.ticket));
    // la bulle ne capte pas le doigt (elle peut chevaucher « Annuler ») : le geste suivant l'efface
    root.addEventListener('pointerdown', (e) => {
      ripple(e);
      if (!this.tipEl.classList.contains('hidden')) this.hideTip();
    }, true);
    // La place de l'aperçu de vague suit celle de la rangée (jauge prête, « Annuler »).
    const sync = () => this.preview.resize();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(sync).observe(this.$('wave-preview'));
  }

  setup(game, input) {
    this.game = game;
    this.input = input;
    this.last = {};
    this.goldDebt = 0;
    this.roll = null;
    // un doigt tenait une carte de l'ancienne palette (relance de l'hôte, « Suivant ») : la
    // carte disparaît sans « pointerup », le geste en cours ne doit pas bloquer la nouvelle
    if (this.toolPtr) {
      clearTimeout(this.toolPtr.timer);
      clearTimeout(this.toolPtr.holdT);
      this.toolPtr = null;
      this.h.onHold?.('end');
    }
    this.palette.innerHTML = '';
    this.pin.innerHTML = '';
    this.tools = [];
    this.slotFilter = null;
    this.hideUndo();
    this.hideTip();
    this.lane.reset();
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
    // Une lanterne par élément : 4 grandes cartes. Sinon, des onglets (un par élément)
    // soudés à la boîte des lanternes de l'élément choisi. À plusieurs, chacun n'a que
    // son élément : la rangée d'équipe prend la place des onglets (plateau identique).
    this.grouped = [...groups.values()].some((l) => l.length > 1);
    const team = (game.players?.length ?? 1) > 1;
    this.mode = team ? 'team' : this.grouped && groups.size > 1 ? 'tabs' : 'simple';
    this.footer.dataset.palette = this.mode;
    this.root.classList.toggle('palette-grouped', this.mode !== 'simple');
    // nouvelle partie : premier élément (le tutoriel montre la première lanterne)
    this.tab = groups.keys().next().value ?? null;
    this.tool = null;
    this.buildTabs();
    this.teamEl.classList.toggle('hidden', this.mode !== 'team');
    if (this.mode !== 'team') this.teamEl.innerHTML = '';
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cs = getComputedStyle(this.palette);
    const iconG = parseFloat(cs.getPropertyValue('--icon-g')) || 40;
    const iconS = parseFloat(cs.getPropertyValue('--icon-s')) || 48;
    const add = (id, opts, draw) => {
      const b = document.createElement('button');
      const kind = id === 'stone' ? 'pin' : this.mode === 'simple' ? 's' : 'g';
      const size = kind === 's' ? iconS : iconG;
      b.className = `tool ${kind}`;
      b.dataset.tool = id;
      if (opts.element) b.dataset.element = opts.element;
      b.style.setProperty('--el', opts.color);
      b.style.setProperty('--el-ink', opts.ink);
      b.setAttribute('aria-label', `${opts.name}${opts.role ? `, ${opts.role}` : ''}, ${opts.cost} or`);
      const cv = document.createElement('canvas');
      cv.width = Math.round(size * dpr);
      cv.height = Math.round(size * dpr);
      cv.style.width = cv.style.height = `${size}px`;
      const ctx = cv.getContext('2d');
      ctx.scale(dpr, dpr);
      draw(ctx, size);
      b.appendChild(cv);
      const cost = `<span class="cost">${digitsHTML(opts.cost)}</span>`;
      if (kind === 'pin') {
        b.insertAdjacentHTML('beforeend', `<span class="tool-count"></span><span class="tool-name">Pierre</span>${cost}`);
      } else if (kind === 's') {
        // pastille de l'élément (forme + kanji : se lit sans la couleur, comme les socles),
        // coût, dessin, nom ; le mot de l'élément est dans l'étiquette lue et la fiche
        b.setAttribute('aria-label', `${opts.name}, ${opts.label}, ${opts.cost} or`);
        b.insertAdjacentHTML('beforeend', `<span class="tool-id" title="${esc(opts.label)}">${elementBadge(opts.element, defs, { size: 22 })}</span>${cost}<span class="tool-name">${esc(opts.short)}</span>`);
      } else {
        // l'onglet dit l'élément : dessin, coût, rôle en un mot, nom court
        b.insertAdjacentHTML('beforeend', `${cost}<span class="tool-role">${esc(opts.roleWord || '')}</span><span class="tool-name">${esc(opts.short)}</span>`);
      }
      this.bindTool(b, id);
      (kind === 'pin' ? this.pin : this.palette).appendChild(b);
      this.tools.push({ el: b, id, element: opts.element || null, cost: opts.cost, costEl: b.querySelector('.cost'), countEl: b.querySelector('.tool-count') });
      return b;
    };
    for (const [el, list] of groups) {
      const info = elementInfo(el, defs);
      for (const type of list) {
        const def = defs.towers[type];
        add(
          type,
          { name: def.name, element: el, color: def.color, ink: readable(def.color), label: info.label, short: shortName(type, defs), roleWord: roleWord(type, defs), role: def.role, cost: def.cost },
          (ctx, size) => drawTowerIcon(ctx, size, size, def),
        );
      }
    }
    // en coopération, seuls les joueurs de la Terre posent des pierres
    const stones = !!(game.level.stones && game.stoneCost && game.stoneConf?.() && (typeof game.canUseStones !== 'function' || game.canUseStones()));
    if (stones) add('stone', { name: 'Pierre', color: STONE_COLOR, ink: STONE_COLOR, label: 'Pierre', short: 'Pierre', cost: game.stoneCost() }, (ctx, size) => drawStoneIcon(ctx, size, size));
    this.pin.classList.toggle('hidden', !stones);
    this.area.classList.toggle('has-pin', stones);
    this.palette.dataset.count = String(this.tools.filter((t) => t.id !== 'stone').length);
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
    const on = this.mode === 'tabs';
    el.classList.toggle('hidden', !on);
    if (!on) return;
    const defs = this.game.defs;
    let html = '';
    for (const [id, list] of this.groups) {
      const info = elementInfo(id, defs);
      html += `<button class="ptab" role="tab" data-el="${id}" style="--el:${info.color};--el-ink:${info.ink}" aria-label="${info.label} : ${list.length} lanterne${list.length > 1 ? 's' : ''}">${elementBadge(id, defs, { size: 20 })}<span class="ptab-label">${info.label}</span></button>`;
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
    if (this.mode !== 'tabs' || !this.groups?.has(el)) return;
    if (this.tab !== el) {
      const keys = [...this.groups.keys()];
      const dir = keys.indexOf(el) > keys.indexOf(this.tab) ? 'r' : 'l';
      this.tab = el;
      this.applyTab();
      // fondu enchaîné + glissé de 8 px dans le sens de l'onglet (160 ms)
      if (!soberFx()) {
        this.palette.classList.remove('slide-l', 'slide-r');
        void this.palette.offsetWidth;
        this.palette.classList.add(`slide-${dir}`);
      }
    }
  }

  // Onglet de la lanterne `id` (palette regroupée), pour l'afficher avant de la montrer.
  tabOf(id) {
    return this.tools.find((t) => t.id === id)?.element ?? null;
  }

  applyTab() {
    const grouped = this.mode === 'tabs';
    for (const t of this.tools) t.el.classList.toggle('off-tab', grouped && t.element != null && t.element !== this.tab);
    if (!this.tabsEl) return;
    const keys = this.groups ? [...this.groups.keys()] : [];
    this.area.dataset.tab = String(Math.max(0, keys.indexOf(this.tab)));
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
    if (this.mode !== 'tabs' || !this.tabsEl) return;
    const tool = this.input?.ui.tool;
    const el = tool && tool !== 'stone' ? this.tabOf(tool) : null;
    for (const b of this.tabsEl.querySelectorAll('.ptab')) b.classList.toggle('has-tool', b.dataset.el === el);
  }

  // ───────────────────────── équipe (coopération) ─────────────────────────

  // mates : [{ pid, name, seal (HTML), gold, off, host, me }] — la puce du joueur est
  // soudée à la boîte ; celles des coéquipiers disent leur or (ou « hors ligne »).
  setTeam(mates) {
    if (this.mode !== 'team') return;
    const sig = mates.map((m) => `${m.pid}|${m.name}|${m.me ? '' : Math.floor(m.gold)}|${m.off}|${m.host}`).join(';');
    if (sig === this.last.team) return;
    const first = this.last.team == null;
    this.last.team = sig;
    if (first || this.teamEl.childElementCount !== mates.length) {
      this.teamEl.innerHTML = mates
        .map(
          (m) =>
            `<span class="mate${m.me ? ' me' : ''}" data-pid="${m.pid}">${m.seal}<b class="mate-name">${m.me ? 'Vous' : esc(m.name)}</b>${m.host ? '<span class="mate-host" aria-hidden="true">主</span>' : ''}<span class="mate-gold"></span></span>`,
        )
        .join('');
    }
    for (const m of mates) {
      const chip = this.teamEl.querySelector(`.mate[data-pid="${m.pid}"]`);
      if (!chip) continue;
      chip.classList.toggle('off', !!m.off);
      chip.setAttribute('role', 'img');
      chip.setAttribute('aria-label', m.me ? `Vous${m.host ? ', hôte' : ''}` : `${m.name}${m.host ? ', hôte' : ''} : ${m.off ? 'hors ligne' : `${Math.floor(m.gold)} or`}`);
      const g = chip.querySelector('.mate-gold');
      if (m.me) g.textContent = '';
      else if (m.off) {
        g.textContent = 'hors ligne';
        g.classList.add('offline');
        delete g.dataset.v;
      } else {
        g.classList.remove('offline');
        setDigits(g, Math.floor(m.gold));
      }
    }
  }

  // La pose d'un coéquipier fait clignoter son sceau (une pulsation).
  pulseMate(pid) {
    const chip = this.teamEl.querySelector(`.mate[data-pid="${pid}"]`);
    if (chip) pop(chip, 'pulse');
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
      // (un geste dont la carte a quitté la page ne compte plus)
      if (this.toolPtr?.el?.isConnected) return;
      const tp = { id, el: b, pid: e.pointerId, x0: e.clientX, y0: e.clientY, long: false, drag: false };
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
        b.classList.remove('is-pressed');
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
    if (id === 'stone') return commands.stonesLeft() > 0;
    return true;
  }

  clickTool(id, b) {
    const g = this.game;
    if (!g) return;
    if (id === 'stone' && commands.stonesLeft() <= 0) {
      this.tipAt(b, 'Plus de pierres dans ce niveau');
      if (this.input.ui.tool === 'stone') this.input.setTool('stone');
      this.refreshTools();
      return;
    }
    const t = this.tools.find((x) => x.id === id);
    const tool = this.h.onToolPick ? this.h.onToolPick(id) : this.input.setTool(id);
    if (tool === false) return; // posé aussitôt sur le socle choisi (socle d'abord)
    this.h.onTool?.(tool);
    this.refreshTools();
    if (tool) {
      pop(b);
      // trop chère : ce qu'il manque, écrit au-dessus de la carte
      // (commands.missing vaut au moins 1 : on ne l'appelle que si la carte est vraiment trop chère)
      const cost = t && tool !== 'stone' ? g.defs.towers[id]?.cost ?? 0 : 0;
      const missing = cost > 0 && commands.spendable() < cost ? commands.missing(id) : 0;
      if (missing > 0) this.tipAt(b, `Il manque ${missing} or`, { bad: true });
    }
  }

  refreshTools() {
    const g = this.game;
    for (const t of this.tools) {
      t.el.classList.toggle('selected', this.input.ui.tool === t.id);
      if (t.id === 'stone' && g) {
        // Pierres restantes : ressource limitée du niveau, l'outil se grise à 0.
        // (celles en construction sont déjà comptées)
        const conf = g.stoneConf?.();
        const left = commands.stonesLeft();
        const txt = conf ? `${left}/${conf.max}` : String(left);
        if (t.countEl.textContent !== txt) t.countEl.innerHTML = digitsHTML(txt);
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

  // Socle d'abord : socle choisi sans outil. Réservé à un élément : son onglet s'affiche ;
  // les cartes qui ne peuvent pas s'y poser se grisent. `null` : fin du choix.
  setSlotFilter(slot) {
    this.slotFilter = slot;
    for (const t of this.tools) {
      const no = !!slot && (t.id === 'stone' || (slot.element && t.element && t.element !== slot.element));
      t.el.classList.toggle('forbid', no);
    }
    if (slot?.element) this.showTab(slot.element);
  }

  // La bannière (≈ 1,8 s) est-elle encore à l'écran ?
  get bannerShown() {
    return this.bannerAt != null && performance.now() - this.bannerAt < BANNER_MS;
  }

  // Petit rebond d'un bouton de la palette (retour d'action).
  popTool(id) {
    const t = this.tools.find((x) => x.id === id);
    if (t) pop(t.el);
  }

  // ───────────────────────── mise à jour par frame ─────────────────────────

  // Or « en vol » : affiché en moins jusqu'à l'arrivée des pièces (pay).
  deferGold(n) {
    this.goldDebt = Math.max(0, this.goldDebt + n);
    clearTimeout(this.debtT);
    this.debtT = setTimeout(() => (this.goldDebt = 0), 1400); // filet : jamais bloqué
  }

  payGold(n) {
    this.goldDebt = Math.max(0, this.goldDebt - n);
    pop(this.gold.parentElement, 'gain');
  }

  update(force = false) {
    const g = this.game;
    if (!g) return;
    this.lane.update();
    // or disponible : la bourse moins l'or promis aux constructions en cours (jamais
    // négatif : après un Rembobinage, l'or revenu en arrière peut ne plus couvrir une
    // construction en cours ; elle sera refusée à son activation, « Pas assez d'or »)
    const gold = Math.max(0, Math.floor(commands.spendable()));
    const promised = Math.floor(commands.reserved());
    const target = Math.max(0, gold - Math.round(this.goldDebt));
    if (force || target !== this.last.goldTarget) {
      const prev = this.last.goldShown;
      if (!force && prev != null && target !== prev) {
        const d = Math.abs(target - prev);
        // le compteur roule (300 ms au-delà de 10 or, 500 ms au-delà de 50) ; petit rebond
        if (d > 10 && !soberFx()) this.roll = { from: prev, to: target, t0: performance.now(), ms: d > 50 ? 500 : 300 };
        else this.roll = null;
        bump(this.gold, target > prev ? 'bump' : 'spend');
      }
      if (force) this.roll = null;
      this.last.goldTarget = target;
    }
    let shown = target;
    if (this.roll) {
      const k = Math.min(1, (performance.now() - this.roll.t0) / this.roll.ms);
      shown = Math.round(this.roll.from + (this.roll.to - this.roll.from) * (1 - Math.pow(1 - k, 3)));
      if (k >= 1) this.roll = null;
    }
    if (shown !== this.last.goldShown) {
      setDigits(this.gold, shown);
      this.last.goldShown = shown;
    }
    if (force || gold !== this.last.gold) {
      this.last.gold = gold;
      for (const t of this.tools) {
        const cost = t.id === 'stone' ? g.stoneCost() : t.cost;
        t.el.classList.toggle('poor', gold < cost);
        // le coût d'une pierre peut évoluer : on garde l'étiquette à jour
        if (t.id === 'stone') setDigits(t.costEl, cost);
      }
    }
    if (force || promised !== this.last.promised || gold !== this.last.goldAria) {
      this.last.promised = promised;
      this.last.goldAria = gold;
      if (this.reservedEl) {
        if (promised > 0) this.reservedEl.innerHTML = `−${digitsHTML(promised)}`;
        this.reservedEl.classList.toggle('hidden', !(promised > 0));
      }
      this.gold.parentElement?.setAttribute('aria-label', promised > 0 ? `Or : ${gold} disponible, ${promised} promis aux constructions` : `Or : ${gold}`);
    }
    // Défi « N lanternes au plus » : poses épuisées (constructions comprises), les
    // lanternes se grisent (sans le rouge du manque d'or) ; leur libellé le dit.
    const rule = g.challengeRule;
    const spent = rule?.maxTowers != null && g.stats.towersBuilt + this.buildingTowers() >= rule.maxTowers;
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
      setDigits(this.lives, g.lives);
      if (!force && this.last.lives != null) {
        const hurt = g.lives < this.last.lives;
        bump(this.lives, hurt ? 'hurt' : 'bump');
        if (hurt) pop(this.lives.parentElement, 'hurt');
      }
      this.lives.parentElement.classList.toggle('low', g.lives <= Math.max(3, g.maxLives * 0.25));
      this.lives.parentElement.setAttribute('aria-label', `Vies : ${g.lives} sur ${g.maxLives}`);
      this.last.lives = g.lives;
    }
    const stones = g.level.stones ? `${commands.stonesLeft()}` : '';
    if (force || stones !== this.last.stones) {
      this.last.stones = stones;
      this.refreshTools();
    }
    this.updateWaveLabel(g, force);
    this.updateWaveButton(g);
    this.updateUndo(g);
  }

  // Bloc « VAGUE » : n/N en cases fixes, barre de progression et repère du climax ;
  // au début d'une vague, le chiffre roule (l'ancien monte, le nouveau arrive d'en dessous).
  updateWaveLabel(g, force) {
    const waveNum = Math.max(0, g.waveIndex + 1);
    const total = g.totalWaves;
    const key = `${waveNum}/${total}`;
    if (key === this.last.wave && !force) return;
    const prev = this.last.waveNum;
    this.last.wave = key;
    this.last.waveNum = waveNum;
    if (!force && prev != null && waveNum === prev + 1 && !soberFx()) {
      this.waveCur.innerHTML = `<span class="roll"><span class="roll-old">${digitsHTML(prev)}</span><span class="roll-new">${digitsHTML(waveNum)}</span></span>`;
      delete this.waveCur.dataset.v;
      clearTimeout(this.rollT);
      this.rollT = setTimeout(() => setDigits(this.waveCur, this.last.waveNum), 260);
    } else setDigits(this.waveCur, waveNum);
    this.waveTotal.innerHTML = `/${digitsHTML(total)}`;
    this.waveFill.style.width = `${total ? (waveNum / total) * 100 : 0}%`;
    const ci = (g.waves || []).findIndex((w) => w.climax);
    this.waveClimax.classList.toggle('hidden', ci < 0);
    if (ci >= 0) this.waveClimax.style.left = `${((ci + 0.5) / total) * 100}%`;
    this.wave.setAttribute('aria-label', `Vague ${waveNum} sur ${total}${g.hard ? ', mode Difficile' : ''}`);
  }

  // Bouton de vague (largeur fixe) : cadran avec les secondes restantes dans un anneau
  // or qui se vide (波 avant la première vague et pendant la dernière), « Vague N » ou
  // « Climax », sous-ligne « +12 » (prime d'or d'un appel anticipé). Aperçu à côté.
  updateWaveButton(g) {
    const pv = g.nextWavePreview ? g.nextWavePreview() : null;
    // (commande acceptée : aussi faux quand un appel est déjà en file)
    const canCall = commands.check('startNextWave').ok;
    let label;
    let sub = '';
    let dial = '波';
    let enabled;
    let mode;
    let aria;
    let k = 1;
    if (g.waveIndex < 0 && pv) {
      enabled = canCall;
      mode = 'ready';
      label = 'Vague 1';
      sub = 'Lancer';
      aria = `Lancer la vague 1 sur ${g.totalWaves}`;
    } else if (pv) {
      enabled = canCall;
      const cd = pv.countdown != null ? Math.max(0, Math.ceil(pv.countdown)) : null;
      mode = cd != null && cd <= 5 ? 'soon' : 'call';
      label = pv.climax ? 'Climax' : `Vague ${pv.index + 1}`;
      if (cd != null) {
        dial = String(cd);
        // durée totale du compte à rebours (le plus grand vu pour cette vague)
        if (this.last.cdIndex !== pv.index || pv.countdown > (this.last.cdTotal ?? 0)) {
          this.last.cdIndex = pv.index;
          this.last.cdTotal = Math.max(1, pv.countdown);
        }
        k = Math.max(0, Math.min(1, pv.countdown / this.last.cdTotal));
      }
      sub = pv.bonus > 0 ? `+${pv.bonus}` : 'Appeler';
      const charge = earlyCharge(g, pv);
      aria = `Appeler la vague ${pv.index + 1}${pv.name ? ` « ${pv.name} »` : ''} maintenant${pv.bonus > 0 ? ` : +${pv.bonus} or` : ''}${charge > 0 ? `, +${charge} de charge du Rembobinage` : ''}${cd != null ? `. Elle arrive seule dans ${cd} s` : ''}`;
    } else {
      enabled = false;
      mode = g.state === 'wave' ? 'running' : 'over';
      label = g.state === 'wave' ? `Vague ${g.totalWaves}` : '—';
      sub = g.state === 'wave' ? 'dernière' : '';
      aria = g.state === 'wave' ? 'Dernière vague en cours' : 'Partie terminée';
    }
    const climax = !!pv?.climax;
    if (label !== this.last.label) {
      this.waveLabel.textContent = label;
      this.last.label = label;
    }
    if (sub !== this.last.sub) {
      this.waveSub.innerHTML = /^\+\d+$/.test(sub) ? `<i class="coin" aria-hidden="true"></i><span>${digitsHTML(sub)}</span>` : esc(sub);
      this.waveSub.classList.toggle('hidden', !sub);
      this.waveSub.classList.toggle('gain', /^\+/.test(sub));
      this.last.sub = sub;
    }
    if (dial !== this.last.dial) {
      if (/^\d+$/.test(dial)) setDigits(this.waveKanji, dial);
      else {
        this.waveKanji.textContent = climax && dial === '波' ? '嵐' : dial;
        delete this.waveKanji.dataset.v;
      }
      this.waveDial.classList.toggle('secs', /^\d+$/.test(dial));
      this.last.dial = dial;
    }
    const ks = k.toFixed(3);
    if (ks !== this.last.k) {
      this.waveDial.style.setProperty('--k', ks);
      this.last.k = ks;
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
      if (!/^\d+$/.test(this.last.dial)) this.waveKanji.textContent = climax ? '嵐' : '波';
      this.last.climax = climax;
    }
    const pulse = g.waveIndex < 0 && (g.towers.length > 0 || this.buildingTowers() > 0);
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
    pop(this.waveDial, 'stamp');
  }

  // Lanternes en construction (tous joueurs).
  buildingTowers() {
    let n = 0;
    for (const b of commands.builds()) if (b.op === 'placeTower') n++;
    return n;
  }

  // ───────────────────────── Annuler (construction, puis 3 s) ─────────────────────────
  //
  // `ticket` : la commande de pose (commands.issue). Lanterne : « Annuler » reste
  // pendant la construction (rien n'est payé), puis 3 s après son activation (or
  // rendu en entier). Pierre et mur : pendant la construction seulement (une pierre
  // posée ne se reprend qu'à moitié prix, par sa fiche). Sa place ne change jamais :
  // il remplace l'aperçu de vague dans la rangée d'action.

  showUndo(ticket, kind = 'tower') {
    if (!ticket || !this.game) return;
    this.undo = { ticket, kind };
    this.setUndoShown(true);
    this.updateUndo(this.game);
  }

  setUndoShown(on) {
    if (on === !this.undoEl.classList.contains('hidden')) return;
    this.undoEl.classList.toggle('hidden', !on);
    this.actionRow.classList.toggle('has-undo', on);
    this.root.classList.toggle('has-undo', on);
    this.preview.resize();
  }

  updateUndo(g) {
    if (!this.undo) return;
    const { ticket, kind } = this.undo;
    const st = commands.status(ticket);
    const build = g.rules.buildTime ?? 2;
    const total = kind === 'tower' ? build + UNDO_SECONDS : build;
    let left = 0;
    if (st === 'building') left = total - commands.progress(ticket) * build;
    else if (st === 'built' && kind === 'tower') {
      const e = commands.entryOf(ticket) || ticket;
      const t = g.towerById(e.result);
      if (t && t.level === 1) left = UNDO_SECONDS - (g.time - t.bornAt);
    }
    // Pendant l'animation du Rembobinage, « Annuler » s'efface ; une construction en
    // cours y survit (elle s'achève ensuite) : le bouton revient avec elle.
    if (g.rewindAnim && st === 'building') {
      this.setUndoShown(false);
      return;
    }
    if (left <= 0 || g.rewindAnim || g.state === 'won' || g.state === 'lost') {
      this.hideUndo();
      return;
    }
    this.setUndoShown(true);
    const k = Math.max(0, Math.min(1, left / total));
    const s = k.toFixed(3);
    if (s !== this.last.undo) {
      this.undoEl.style.setProperty('--k', s);
      this.last.undo = s;
    }
    const building = st === 'building';
    if (building !== this.last.undoBuilding) {
      this.last.undoBuilding = building;
      this.undoEl.classList.toggle('building', building);
      this.undoSub.textContent = building ? 'gratuit' : 'or rendu';
      this.undoEl.setAttribute('aria-label', building ? 'Annuler la construction : rien n’est payé' : 'Annuler la pose : or rendu en entier');
    }
  }

  hideUndo() {
    this.undo = null;
    this.last.undoBuilding = null;
    this.setUndoShown(false);
  }

  // ───────────────────────── messages ─────────────────────────

  // Message global : couloir en haut du plateau (signature conservée, contrat §9.4).
  // `bad` : alerte (priorité 2) ; `ms` : au moins la durée de lecture (≥ 2,5 s).
  toast(msg, bad = false, ms = 0) {
    this.lane.post({ text: msg, prio: bad ? 2 : 0, ms });
  }

  // Message du couloir avec ses options : { key, text, detail, icon, prio, ms, action }.
  say(m) {
    this.lane.post(m);
  }

  // Indication écrite près d'un contrôle (jauge, carte trop chère, « Annuler »…).
  tipAt(target, text, { bad = false, ms } = {}) {
    const el = this.tipEl;
    const r = target?.getBoundingClientRect ? target.getBoundingClientRect() : target;
    if (!r) return;
    const root = this.root.getBoundingClientRect();
    el.textContent = text;
    el.classList.toggle('bad', bad);
    el.classList.remove('hidden', 'below', 'show');
    void el.offsetWidth;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const cx = r.left + r.width / 2 - root.left;
    const left = Math.max(8, Math.min(root.width - w - 8, cx - w / 2));
    let top = r.top - root.top - h - 10;
    const below = top < 8;
    if (below) top = r.bottom - root.top + 10;
    el.classList.toggle('below', below);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.setProperty('--ax', `${Math.round(Math.max(14, Math.min(w - 14, cx - left)))}px`);
    el.classList.add('show');
    clearTimeout(this.tipT);
    this.tipT = setTimeout(() => this.hideTip(), ms ?? tipMs(text));
  }

  hideTip() {
    clearTimeout(this.tipT);
    this.tipEl.classList.add('hidden');
    this.tipEl.classList.remove('show');
  }

  get tipText() {
    return this.tipEl.classList.contains('hidden') ? '' : this.tipEl.textContent;
  }

  // `data.element` : élément d'un socle réservé (refus 'slotElement').
  reason(code, data = {}) {
    if (code === 'slotElement' && data.element && this.game) {
      const info = elementInfo(data.element, this.game.defs);
      return `${info.glyph} Ce socle réservé ${info.kanji} n’accepte que ${elementWithArticle(data.element, this.game.defs)}`;
    }
    return REASONS[code] || null;
  }

  shortReason(code, data = {}) {
    // case déjà en construction : la sienne, ou celle d'un coéquipier
    if (code === 'pending') {
      const g = this.game;
      if (g && data.owner != null && data.owner !== g.localPlayer && g.players?.length > 1) return `Pris par ${g.players[data.owner]?.name ?? 'un coéquipier'}`;
      return 'En construction';
    }
    if (code === 'slotElement' && data.element && this.game) {
      const info = elementInfo(data.element, this.game.defs);
      return `${info.glyph} Socle réservé ${toElement(data.element, this.game.defs)}`;
    }
    return SHORT[code] || REASONS[code] || null;
  }

  // Bannière au grand pinceau : moments forts seulement (titre du niveau, climax, boss,
  // dernière vague, victoire, défaite), 1,8 s, à 30 % de la scène.
  // `cls` : variante ('climax' : pinceau vermillon et or).
  banner(big, small = '', cls = '') {
    const el = this.bannerEl;
    this.bannerAt = performance.now();
    el.innerHTML = `<span class="big">${esc(big)}</span>${small ? `<span class="small">${esc(small)}</span>` : ''}`;
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

// Petit rebond d'un bouton (retour d'action), sans gêner son état pressé.
export function pop(el, cls = 'pop') {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 420);
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
  setTimeout(() => r.remove(), 400);
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
