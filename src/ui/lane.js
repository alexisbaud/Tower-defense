// Couloir de messages (docs/UI-UX.md §6.4) : UNE seule bulle globale à la fois, en
// haut du plateau, jamais sur une case d'apparition (S) ni sur le sanctuaire (G).
//
//   Priorités : 3 consigne (reste jusqu'à ce que l'action soit faite, clear(key)),
//               2 alerte (boss en rage, coéquipier parti…), 1 nouveauté (nouveau yokai,
//               premier combo, règle des socles réservés), 0 info.
//   Durées    : clamp(2500, 1200 + 60 × caractères, 6000) ms ; jamais moins de 2,5 s.
//   File      : dédoublonnée par clé, 3 messages en attente au plus (le plus ancien
//               part). Une priorité plus haute préempte (l'autre revient en file s'il lui
//               restait du temps). Pendant un moment fort ou une bulle du tutoriel, les
//               priorités 0 et 1 attendent.
//   Placement : haut centré (sous la barre de boss), haut à gauche, haut à droite, bas
//               centré : le premier qui ne recoupe ni S, ni G (marge 6), ni la barre
//               d'actions, ni la bulle du tutoriel ; puis, si possible, ni lanterne ni
//               construction (poids faible, `w`).
//   Toucher   : l'action liée (fiche du yokai, combos…) ; sans action, le message
//               s'efface et le geste passe au plateau dessous (h.pass).

export const readMs = (text) => Math.max(2500, Math.min(6000, 1200 + 60 * String(text || '').length));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// « 巻 Jauge pleine… » : le kanji de tête devient le sceau du message
const LEAD = /^([㐀-鿿々]{1,2})\s+(.+)$/s;

export class Lane {
  /**
   * @param {HTMLElement} el  #lane (dans #stage)
   * @param {object} h  avoid() → rectangles {l,t,r,b} (repère du plateau) à ne pas couvrir,
   *                    top() → ordonnée minimale (sous la barre de boss), hold() → vrai pendant
   *                    un moment fort ou une bulle du tutoriel, onAct(action, msg),
   *                    pass(pointerdown) : geste passé au plateau (message sans action),
   *                    over(pointerdown) → vrai si une lanterne est sous le doigt
   */
  constructor(el, h = {}) {
    this.el = el;
    this.h = h;
    this.queue = [];
    this.cur = null;
    this.placeAt = 0;
    this.posKey = '';
    // seul un geste commencé sur le message l'active (un toucher de pose qui finit sous
    // le message, ou le clic qui suit, ne l'ouvre pas)
    this.downAt = 0;
    el.addEventListener('pointerdown', (e) => {
      this.downAt = performance.now();
      // Message sans action : il ne retient pas le doigt. Il s'efface et le geste passe
      // au plateau dessous (une lanterne du haut reste touchable et glissable). Avec une
      // action, de même s'il recouvre une lanterne ou une construction (posée après lui :
      // il les évite) : le doigt vise la lanterne, pas la fiche du message.
      const m = this.cur;
      if (m && this.h.pass && (!m.action || this.h.over?.(e))) {
        if (m.prio < 3) this.dismiss();
        this.downAt = 0;
        this.h.pass(e);
      }
    });
    el.addEventListener('click', () => {
      const m = this.cur;
      const fresh = performance.now() - this.downAt < 1500;
      this.downAt = 0;
      if (!m || !fresh) return;
      if (m.action) this.h.onAct?.(m.action, m);
      if (m.prio < 3 || m.action) this.dismiss();
    });
  }

  // m : { key, text, detail, icon (HTML), prio, ms, action }
  post(m) {
    const msg = { prio: 0, ...m };
    msg.key = msg.key ?? msg.text;
    if (msg.icon == null) {
      const lead = LEAD.exec(msg.text || '');
      if (lead) {
        msg.text = lead[2];
        msg.icon = `<span class="lane-seal" aria-hidden="true">${esc(lead[1])}</span>`;
      }
    }
    msg.ms = msg.prio >= 3 ? Infinity : Math.max(msg.ms || 0, readMs(`${msg.text}${msg.detail || ''}`));
    if (this.cur && this.cur.key === msg.key) {
      // même message : texte à jour, durée relancée
      const shownFor = performance.now() - this.cur.t0;
      Object.assign(this.cur, msg, { t0: this.cur.t0, ms: Math.max(msg.ms, shownFor + 1500) });
      this.render();
      return;
    }
    const i = this.queue.findIndex((q) => q.key === msg.key);
    if (i >= 0) this.queue.splice(i, 1, msg);
    else {
      this.queue.push(msg);
      if (this.queue.length > 3) this.queue.splice(this.queue.findIndex((q) => q.prio < 3), 1);
    }
  }

  // Retire un message (consigne accomplie).
  clear(key) {
    this.queue = this.queue.filter((q) => q.key !== key);
    if (this.cur?.key === key) this.dismiss();
  }

  has(key) {
    return this.cur?.key === key || this.queue.some((q) => q.key === key);
  }

  get current() {
    return this.cur;
  }

  reset() {
    this.queue = [];
    this.cur = null;
    this.el.classList.add('hidden');
    this.el.classList.remove('in', 'out');
    this.el.innerHTML = '';
    this.posKey = '';
  }

  dismiss() {
    if (!this.cur) return;
    this.cur = null;
    this.el.classList.remove('in');
    this.el.classList.add('out');
    clearTimeout(this.outT);
    this.outT = setTimeout(() => {
      if (this.cur) return;
      this.el.classList.add('hidden');
      this.el.classList.remove('out');
    }, 140);
  }

  // Le meilleur candidat de la file (priorité, puis ancienneté) ; `min` : priorité minimale.
  pick(min = 0) {
    let best = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const q = this.queue[i];
      if (q.prio < min) continue;
      if (best < 0 || q.prio > this.queue[best].prio) best = i;
    }
    return best;
  }

  // Chaque image.
  update() {
    const now = performance.now();
    const hold = !!this.h.hold?.();
    const min = hold ? 2 : 0;
    if (this.cur && now - this.cur.t0 >= this.cur.ms) this.dismiss();
    // un message 0–1 à l'écran pendant un moment fort : il s'efface (il revient ensuite)
    if (this.cur && hold && this.cur.prio < 2) {
      const left = this.cur.ms - (now - this.cur.t0);
      const back = this.cur;
      this.dismiss();
      if (left > 1000) this.queue.unshift({ ...back, ms: Math.max(2500, left) });
    }
    const i = this.pick(min);
    if (i >= 0) {
      const q = this.queue[i];
      if (!this.cur) {
        if (!this.el.classList.contains('out')) this.show(this.queue.splice(i, 1)[0]);
      } else if (q.prio > this.cur.prio) {
        // préemption : le message en cours revient en file s'il lui restait du temps
        const left = this.cur.ms - (now - this.cur.t0);
        const back = this.cur;
        this.queue.splice(i, 1);
        if (left > 1000) this.queue.unshift({ ...back, ms: Math.max(2500, left) });
        this.show(q, true);
      }
    }
    if (this.cur && now >= this.placeAt) this.place();
  }

  show(m, swap = false) {
    clearTimeout(this.outT);
    this.cur = { ...m, t0: performance.now() };
    this.el.classList.remove('hidden', 'out');
    this.render();
    this.el.classList.toggle('swap', swap);
    if (!swap) {
      this.el.classList.remove('in');
      void this.el.offsetWidth;
    }
    this.el.classList.add('in');
    this.posKey = '';
    this.place();
  }

  render() {
    const m = this.cur;
    if (!m) return;
    for (let p = 0; p < 4; p++) this.el.classList.toggle(`p${p}`, p === m.prio);
    this.el.classList.toggle('act', !!m.action);
    this.el.setAttribute('aria-live', m.prio >= 2 ? 'assertive' : 'polite');
    this.el.setAttribute('role', m.action ? 'button' : 'status');
    this.el.innerHTML =
      `${m.icon ? `<span class="lane-ico">${m.icon}</span>` : ''}` +
      `<span class="lane-txt"><b>${esc(m.text)}</b>${m.detail ? `<small>${esc(m.detail)}</small>` : ''}</span>` +
      (m.action ? '<span class="lane-more" aria-hidden="true">›</span>' : '');
  }

  // Premier emplacement libre parmi haut centré, haut gauche, haut droite, bas centré.
  place() {
    this.placeAt = performance.now() + 250;
    const el = this.el;
    const stage = el.parentElement;
    if (!stage) return;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    const top = Math.max(10, this.h.top?.() ?? 10);
    const cands = [
      [(W - w) / 2, top],
      [12, top],
      [W - w - 12, top],
      [(W - w) / 2, H - hgt - 10],
    ];
    const avoid = this.h.avoid?.() || [];
    // Un message large recoupe souvent S (en haut) et G (en bas) aux quatre places :
    // on essaie alors juste sous chaque zone du haut et juste au-dessus de chaque zone du bas.
    for (const a of avoid) {
      if (a.t < H / 2) cands.push([(W - w) / 2, Math.max(top, a.b + 4)]);
      else cands.push([(W - w) / 2, a.t - hgt - 4]);
    }
    // (poids `w` : 1 par défaut ; les lanternes pèsent peu, elles départagent seulement)
    const over = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
    let pos = cands[0];
    let best = Infinity;
    for (const c of cands) {
      if (c[1] < top || c[1] + hgt > H - 4) continue;
      const r = { l: c[0], t: c[1], r: c[0] + w, b: c[1] + hgt };
      const o = avoid.reduce((n, a) => n + over(a, r) * (a.w ?? 1), 0);
      if (o < best) {
        best = o;
        pos = c;
        if (!o) break;
      }
    }
    const key = `${Math.round(pos[0])}|${Math.round(pos[1])}`;
    if (key === this.posKey) return;
    this.posKey = key;
    el.style.left = `${Math.round(Math.max(4, pos[0]))}px`;
    el.style.top = `${Math.round(pos[1])}px`;
  }

  // Rectangle (repère du plateau) du message affiché, pour que les autres calques l'évitent.
  rect() {
    if (!this.cur || this.el.classList.contains('hidden')) return null;
    return { l: this.el.offsetLeft, t: this.el.offsetTop, r: this.el.offsetLeft + this.el.offsetWidth, b: this.el.offsetTop + this.el.offsetHeight };
  }
}
