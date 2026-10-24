// Jauge de Rembobinage. Elle se remplit (game.rewindRatio()) en apaisant des
// yokai et en appelant les vagues en avance ; chaque gain s'affiche (« +12 巻 »).
// Tant qu'elle n'est pas utilisable, elle se réduit à un disque dont l'anneau
// montre la charge ; pleine, elle s'illumine. Utilisable, elle s'allonge en
// piste : on fait glisser la poignée vers la gauche pour remonter le temps.
// Appui long : la règle du Rembobinage (fiche).

import { LONG_PRESS_MS } from './input.js';

const TRIGGER = 0.55; // part de la piste à parcourir pour déclencher
const FLOAT_MS = 450; // gains de charge regroupés sur cette durée

export class RewindGauge {
  /**
   * @param {HTMLElement} root  #rewind
   * @param {object} h  game(), onRewind(), onRefuse(why, pct), onInfo(), onHold(state, p, ms)
   */
  constructor(root, h) {
    this.root = root;
    this.h = h;
    this.track = root.querySelector('.rewind-track');
    this.fill = root.querySelector('.rewind-fill');
    this.knob = root.querySelector('.rewind-knob');
    this.label = root.querySelector('.rewind-label');
    this.drag = null;
    this.press = null;
    this.last = {};
    this.gain = 0;
    this.gainTimer = 0;
    this.track.addEventListener('pointerdown', (e) => this.onDown(e));
    this.track.addEventListener('pointermove', (e) => this.onMove(e));
    this.track.addEventListener('pointerup', (e) => this.onUp(e));
    this.track.addEventListener('pointercancel', () => {
      this.endPress();
      this.release(false);
    });
  }

  get game() {
    return this.h.game();
  }

  onDown(e) {
    const g = this.game;
    if (!g) return;
    this.h.onAction?.('pointer');
    if (!this.usable(g)) {
      // pas encore utilisable : toucher = indication, appui long = la règle
      const p = { id: e.pointerId, x: e.clientX, y: e.clientY, long: false };
      this.press = p;
      p.ring = setTimeout(() => this.press === p && this.h.onHold?.('start', { x: e.clientX, y: e.clientY }, LONG_PRESS_MS - 110), 110);
      p.timer = setTimeout(() => {
        if (this.press !== p) return;
        p.long = true;
        this.h.onHold?.('end');
        this.h.onInfo?.();
      }, LONG_PRESS_MS);
      return;
    }
    this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, moved: false };
    try {
      this.track.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.knob.style.transition = 'none';
  }

  onMove(e) {
    if (this.press && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 10) this.endPress();
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const w = this.track.clientWidth - this.knob.offsetWidth - 4;
    if (Math.hypot(e.clientX - this.drag.x0, e.clientY - this.drag.y0) > 8) this.drag.moved = true;
    this.drag.dx = Math.max(-w, Math.min(0, e.clientX - this.drag.x0));
    this.knob.style.transform = `translateX(${this.drag.dx}px)`;
    const k = -this.drag.dx / w;
    this.root.classList.toggle('armed', k >= TRIGGER);
    this.label.style.opacity = String(Math.max(0.2, 0.85 - k));
  }

  onUp(e) {
    const p = this.press;
    if (p && p.id === e.pointerId) {
      const long = p.long;
      this.endPress();
      if (!long) this.refuse();
      return;
    }
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const w = this.track.clientWidth - this.knob.offsetWidth - 4;
    const fire = -this.drag.dx / w >= TRIGGER;
    const tapped = !this.drag.moved;
    this.release(fire);
    // Simple toucher sur la jauge prête : rien ne se passait ; on rappelle le geste.
    if (tapped && !fire) this.h.onRefuse?.('drag', Math.round(this.ratio(this.game) * 100));
  }

  endPress() {
    if (!this.press) return;
    clearTimeout(this.press.timer);
    clearTimeout(this.press.ring);
    this.h.onHold?.('end');
    this.press = null;
  }

  // Pourquoi la jauge ne sert pas encore (indication neutre, sans son de refus).
  refuse() {
    const g = this.game;
    // pendant le rembobinage, la jauge vient d'être vidée : « Jauge 0 % » serait faux
    if (!g || g.rewindAnim) return;
    const pct = Math.round(this.ratio(g) * 100);
    let why = 'short';
    if (pct < 100) why = 'charge';
    else if (g.state !== 'wave') why = 'wave';
    this.h.onRefuse?.(why, pct);
  }

  ratio(g) {
    return typeof g.rewindRatio === 'function' ? g.rewindRatio() : 0;
  }

  // Utilisable maintenant (méthode du moteur, défensif si elle évolue).
  usable(g) {
    return !!(g && typeof g.canRewind === 'function' && g.canRewind());
  }

  release(fire) {
    this.drag = null;
    this.root.classList.remove('armed');
    this.knob.style.transition = 'transform 0.35s cubic-bezier(.3,1.4,.6,1)';
    this.knob.style.transform = 'translateX(0)';
    this.label.style.opacity = '';
    if (fire) this.h.onRewind?.();
  }

  // Nouvelle partie : pas de « +charge » pour la charge de départ.
  reset() {
    this.last = {};
    this.gain = 0;
    clearTimeout(this.gainTimer);
    this.root.querySelectorAll('.rewind-float').forEach((el) => el.remove());
  }

  update() {
    const g = this.game;
    if (!g) return;
    const enabled = g.rewindEnabled;
    if (enabled !== this.last.enabled) {
      this.root.classList.toggle('hidden', !enabled);
      this.last.enabled = enabled;
    }
    if (!enabled) return;
    const ratio = this.ratio(g);
    const pct = Math.round(ratio * 100);
    if (pct !== this.last.pct) {
      this.fill.style.width = `${pct}%`;
      this.root.style.setProperty('--k', String(ratio));
      this.last.pct = pct;
    }
    // Gains de charge (éliminations, appels anticipés) : « +N 巻 » au-dessus de la jauge.
    const charge = g.rewindCharge ?? 0;
    if (this.last.charge != null && charge > this.last.charge + 0.05 && !g.rewindAnim) this.addGain(charge - this.last.charge);
    this.last.charge = charge;
    const full = ratio >= 0.999;
    const ready = this.usable(g);
    const urgent = g.lastChanceT > 0;
    const sec = g.rules.rewindSeconds ?? 6;
    // Libellé en trois longueurs : la piste, étroite quand l'aperçu de vague est
    // affiché, ne montre que la variante qui tient (requêtes de conteneur, styles.css)
    // au lieu d'un mot coupé (« ◀◀ g », « Le ter »).
    let text;
    let mid = null;
    if (g.rewindAnim) {
      text = 'Le temps recule…';
      mid = 'Recule…';
    } else if (urgent) {
      text = `◀◀ glissez · −${sec} s`;
      mid = '◀◀ glissez';
    } else if (ready) {
      text = `◀◀ glisser · −${sec} s`;
      mid = '◀◀ glisser';
    } else if (!full) text = `Jauge ${pct} %`;
    else if (g.state !== 'wave') text = 'Pleine · pendant la vague';
    else text = 'Le passé s’accumule…';
    // Compacte tant qu'elle n'est pas utilisable (et pas pendant un glisser).
    const compact = !ready && !this.drag && !g.rewindAnim;
    if (compact !== this.last.compact || text !== this.last.aria) {
      this.root.classList.toggle('compact', compact);
      this.root.setAttribute('aria-label', compact ? `Rembobinage : ${text}. Appui long : la règle` : 'Rembobinage : glissez vers la gauche');
      this.last.compact = compact;
      this.last.aria = text;
    }
    if (text !== this.last.text) {
      if (mid) this.label.innerHTML = `<span class="rl-full">${text}</span><span class="rl-mid">${mid}</span><span class="rl-short">◀◀</span>`;
      else this.label.textContent = text;
      this.label.classList.toggle('v', !!mid);
      this.last.text = text;
    }
    if (ready !== this.last.ready) {
      this.root.classList.toggle('ready', ready);
      this.last.ready = ready;
    }
    if (full !== this.last.full) {
      this.root.classList.toggle('full', full);
      this.last.full = full;
    }
    if (urgent !== this.last.urgent) {
      this.root.classList.toggle('urgent', urgent);
      this.last.urgent = urgent;
    }
  }

  // Regroupe les petits gains (une élimination ≈ quelques points) en un seul message.
  addGain(v) {
    this.gain += v;
    if (this.gainTimer) return;
    this.gainTimer = setTimeout(() => {
      this.gainTimer = 0;
      const n = Math.round(this.gain);
      this.gain = 0;
      if (n >= 1) this.float(`+${n} 巻`, n >= 20);
    }, FLOAT_MS);
  }

  float(text, big = false) {
    const el = document.createElement('span');
    el.className = `rewind-float${big ? ' big' : ''}`;
    el.textContent = text;
    el.setAttribute('aria-hidden', 'true');
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 1200);
    this.root.classList.remove('gain');
    void this.root.offsetWidth;
    this.root.classList.add('gain');
  }

  // Position (px page) du centre de la poignée, pour les indications du tutoriel.
  knobRect() {
    return this.knob.getBoundingClientRect();
  }
  trackRect() {
    return this.track.getBoundingClientRect();
  }
}
