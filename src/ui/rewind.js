// Jauge de Rembobinage 巻 (docs/UI-UX.md §6.5). Elle se remplit (game.rewindRatio())
// en apaisant des yokai et en appelant les vagues en avance ; chaque gain s'affiche
// (« +12 巻 »).
//
//   Se remplit   disque de 46 : anneau or = charge, ARC FANTÔME pointillé = ce que
//                rapporterait un appel anticipé maintenant, pourcentage sous le kanji.
//                Toucher : la charge et comment la remplir (écrit près du doigt) ;
//                appui long : la règle (fiche).
//   Pleine       anneau plein, lueur ; toucher : « utilisable pendant une vague ».
//   Prête        piste de 130 px (le bouton de vague ne bouge pas), poignée à droite,
//                une pulsation toutes les 4 s. DOUBLE TOUCHER : le premier arme (piste
//                vermillon, « Encore −6 s », filet de 2,6 s), le second rembobine ; le
//                glisser vers la gauche (55 % de la course) reste le raccourci.
//                Pendant « Annuler », la jauge prête reste un disque or (double toucher).
//   Dernière     la rangée entière devient la piste ; un toucher sur la poignée
//   chance       rembobine aussitôt (seule issue).

import { LONG_PRESS_MS } from './input.js';
import { commands } from './commands.js';
import { CONFIRM_MS } from './press.js';
import { digitsHTML } from './fmt.js';

const TRIGGER = 0.55; // part de la piste à parcourir pour déclencher
const FLOAT_MS = 450; // gains de charge regroupés sur cette durée
const C = 2 * Math.PI * 20.5; // circonférence de l'anneau (viewBox 46)

export class RewindGauge {
  /**
   * @param {HTMLElement} root  #rewind
   * @param {object} h  game(), onRewind(), onRefuse(why, pct), onInfo(), onHold(state, p, ms),
   *                    ghost() → charge qu'apporterait un appel anticipé (même unité que la jauge)
   */
  constructor(root, h) {
    this.root = root;
    this.h = h;
    this.track = root.querySelector('.rewind-track');
    this.fill = root.querySelector('.rewind-fill');
    this.knob = root.querySelector('.rewind-knob');
    this.knobTxt = this.knob.querySelector('b');
    this.pctEl = root.querySelector('.rewind-pct');
    this.label = root.querySelector('.rewind-label');
    this.ringFill = root.querySelector('.rr-fill');
    this.ringGhost = root.querySelector('.rr-ghost');
    this.drag = null;
    this.press = null;
    this.armed = null; // premier toucher du double toucher
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

  get compactNow() {
    return this.root.classList.contains('compact');
  }

  onDown(e) {
    const g = this.game;
    if (!g) return;
    this.h.onAction?.('pointer');
    // dernière chance : un toucher sur la poignée (la rangée entière) rembobine aussitôt
    if (g.lastChanceT > 0 && this.usable(g)) {
      this.disarmTap();
      this.h.onRewind?.();
      return;
    }
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
    this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, moved: false, slide: !this.compactNow };
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
    if (Math.hypot(e.clientX - this.drag.x0, e.clientY - this.drag.y0) > 8) this.drag.moved = true;
    if (!this.drag.slide) return; // disque (pendant « Annuler ») : double toucher seulement
    const w = this.track.clientWidth - this.knob.offsetWidth - 4;
    this.drag.dx = Math.max(-w, Math.min(0, e.clientX - this.drag.x0));
    this.knob.style.transform = `translateX(${this.drag.dx}px)`;
    const k = -this.drag.dx / w;
    this.root.classList.toggle('armed', k >= TRIGGER || !!this.armed);
    this.label.style.opacity = String(Math.max(0.2, 0.9 - k));
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
    const fire = this.drag.slide && -this.drag.dx / w >= TRIGGER;
    const tapped = !this.drag.moved;
    this.release(fire);
    if (fire || !tapped) return;
    // double toucher : le premier arme, le second (dans les 2,6 s) rembobine
    if (this.armed) {
      this.disarmTap();
      this.h.onRewind?.();
    } else this.armTap();
  }

  armTap() {
    const sec = this.game?.rules.rewindSeconds ?? 6;
    clearTimeout(this.armed?.timer);
    this.armed = { timer: setTimeout(() => this.disarmTap(), CONFIRM_MS) };
    this.root.classList.add('armed', 'tap-armed');
    this.root.style.setProperty('--arm-ms', `${CONFIRM_MS}ms`);
    this.label.textContent = `Encore −${sec} s`;
    this.label.classList.add('v');
    this.last.text = null;
    if (!this.track.querySelector('.arm-ring')) this.track.insertAdjacentHTML('beforeend', '<i class="arm-ring" aria-hidden="true"></i>');
    this.root.setAttribute('aria-label', `Rembobinage armé : touchez encore pour remonter le temps de ${sec} s`);
    this.h.onArm?.(true);
  }

  disarmTap() {
    if (!this.armed) return;
    clearTimeout(this.armed.timer);
    this.armed = null;
    this.root.classList.remove('armed', 'tap-armed');
    this.track.querySelector('.arm-ring')?.remove();
    this.last.text = null;
    this.last.aria = null;
    this.h.onArm?.(false);
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
    if (commands.pending('rewind')) why = 'coming';
    else if (pct < 100) why = 'charge';
    else if (g.state !== 'wave') why = 'wave';
    this.h.onRefuse?.(why, pct);
  }

  ratio(g) {
    return typeof g.rewindRatio === 'function' ? g.rewindRatio() : 0;
  }

  // Utilisable maintenant : la commande 'rewind' serait acceptée (moteur, et pas
  // déjà un rembobinage en file).
  usable(g) {
    return !!g && commands.check('rewind').ok;
  }

  release(fire) {
    this.drag = null;
    if (!this.armed) this.root.classList.remove('armed');
    this.knob.style.transition = 'transform 0.35s cubic-bezier(.3,1.4,.6,1)';
    this.knob.style.transform = 'translateX(0)';
    this.label.style.opacity = '';
    if (fire) {
      this.disarmTap();
      this.h.onRewind?.();
    }
  }

  // Nouvelle partie : pas de « +charge » pour la charge de départ.
  reset() {
    this.disarmTap();
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
    const cost = g.rules?.rewindCost ?? 100;
    const ghost = Math.max(0, Math.min(1 - ratio, (this.h.ghost?.() ?? 0) / cost));
    const gk = `${pct}|${Math.round(ghost * 100)}`;
    if (gk !== this.last.ring) {
      this.fill.style.width = `${pct}%`;
      this.root.style.setProperty('--k', String(ratio));
      this.ringFill.style.strokeDasharray = `${(ratio * C).toFixed(1)} ${C.toFixed(1)}`;
      this.ringGhost.style.strokeDasharray = dotted(ratio * C, ghost * C);
      this.pctEl.innerHTML = `${digitsHTML(pct)} %`;
      this.last.ring = gk;
    }
    // Gains de charge (éliminations, appels anticipés) : « +N 巻 » au-dessus de la jauge.
    const charge = g.rewindCharge ?? 0;
    if (this.last.charge != null && charge > this.last.charge + 0.05 && !g.rewindAnim) this.addGain(charge - this.last.charge);
    this.last.charge = charge;
    const full = ratio >= 0.999;
    const ready = this.usable(g);
    if (!ready && this.armed) this.disarmTap();
    // coopération : Rembobinage demandé (par soi ou un coéquipier), pas encore exécuté
    const coming = !g.rewindAnim && commands.pending('rewind');
    const urgent = g.lastChanceT > 0;
    const sec = g.rules.rewindSeconds ?? 6;
    const undo = !!this.root.parentElement?.classList.contains('has-undo');
    let text;
    if (g.rewindAnim) text = 'Recule…';
    else if (coming) text = 'Recule…';
    else if (urgent) text = '◀◀ Touchez la poignée';
    else if (ready) text = '◀◀';
    else if (!full) text = `Jauge ${pct} %`;
    else if (g.state !== 'wave') text = 'Pleine · pendant la vague';
    else text = 'Le passé s’accumule…';
    // Disque tant qu'elle n'est pas utilisable (et pas pendant un glisser) ; prête
    // pendant « Annuler » : disque or (la piste prendrait la place de « Annuler »).
    const compact = (!ready || (undo && !urgent)) && !this.drag && !g.rewindAnim && !coming;
    if (compact !== this.last.compact || text !== this.last.aria) {
      this.root.classList.toggle('compact', compact);
      if (!this.armed) {
        const aria = urgent
          ? `Rembobinage : touchez la poignée pour remonter le temps de ${sec} s`
          : ready
            ? `Rembobinage prêt : touchez deux fois, ou glissez vers la gauche, pour remonter le temps de ${sec} s`
            : `Rembobinage : ${text}. Appui long : la règle`;
        this.root.setAttribute('aria-label', aria);
      }
      this.last.compact = compact;
      this.last.aria = text;
    }
    if (text !== this.last.text && !this.armed) {
      this.label.textContent = text;
      this.label.classList.toggle('v', ready || urgent);
      this.last.text = text;
    }
    // poignée : 巻, ou le compte de la dernière chance
    const knob = urgent ? String(Math.max(1, Math.ceil(g.lastChanceT))) : '巻';
    if (knob !== this.last.knob) {
      this.knobTxt.textContent = knob;
      this.knob.classList.toggle('count', urgent);
      this.last.knob = knob;
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

// Arc fantôme pointillé de `start` à `start + len` (unités du contour du cercle).
function dotted(start, len) {
  if (len < 1) return `0 ${C.toFixed(1)}`;
  const parts = [0, start.toFixed(1)];
  let done = 0;
  while (done < len) {
    const on = Math.min(2.4, len - done);
    parts.push(on.toFixed(1));
    done += on;
    const off = Math.min(2.6, len - done);
    if (off > 0) {
      parts.push(off.toFixed(1));
      done += off;
    }
  }
  if (parts.length % 2) parts.push('0');
  parts.push('0', C.toFixed(1));
  return parts.join(' ');
}
