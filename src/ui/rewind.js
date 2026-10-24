// Jauge de Rembobinage : on fait glisser la poignée vers la gauche pour
// remonter le temps (une fois par vague).

const TRIGGER = 0.55; // part de la piste à parcourir pour déclencher

export class RewindGauge {
  constructor(root, h) {
    this.root = root;
    this.h = h;
    this.track = root.querySelector('.rewind-track');
    this.fill = root.querySelector('.rewind-fill');
    this.knob = root.querySelector('.rewind-knob');
    this.label = root.querySelector('.rewind-label');
    this.drag = null;
    this.last = {};
    this.track.addEventListener('pointerdown', (e) => this.onDown(e));
    this.track.addEventListener('pointermove', (e) => this.onMove(e));
    this.track.addEventListener('pointerup', (e) => this.onUp(e));
    this.track.addEventListener('pointercancel', () => this.release(false));
  }

  get game() {
    return this.h.game();
  }

  onDown(e) {
    const g = this.game;
    if (!g) return;
    this.h.onAction?.('pointer');
    if (!g.canRewind()) {
      this.h.onRefuse?.(g.rewindUsed ? 'used' : g.state !== 'wave' ? 'wave' : 'short');
      return;
    }
    this.drag = { id: e.pointerId, x0: e.clientX, dx: 0 };
    try {
      this.track.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.knob.style.transition = 'none';
  }

  onMove(e) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const w = this.track.clientWidth - this.knob.offsetWidth - 4;
    this.drag.dx = Math.max(-w, Math.min(0, e.clientX - this.drag.x0));
    this.knob.style.transform = `translateX(${this.drag.dx}px)`;
    const k = -this.drag.dx / w;
    this.root.classList.toggle('armed', k >= TRIGGER);
    this.label.style.opacity = String(Math.max(0.2, 0.85 - k));
  }

  onUp(e) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const w = this.track.clientWidth - this.knob.offsetWidth - 4;
    this.release(-this.drag.dx / w >= TRIGGER);
  }

  release(fire) {
    this.drag = null;
    this.root.classList.remove('armed');
    this.knob.style.transition = 'transform 0.35s cubic-bezier(.3,1.4,.6,1)';
    this.knob.style.transform = 'translateX(0)';
    this.label.style.opacity = '';
    if (fire) this.h.onRewind?.();
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
    const avail = g.state === 'wave' && !g.rewindUsed ? g.rewindAvailable() : 0;
    const pct = Math.round((avail / (g.rules.rewindSeconds ?? 6)) * 100);
    if (pct !== this.last.pct) {
      this.fill.style.width = `${pct}%`;
      this.last.pct = pct;
    }
    const ready = g.canRewind();
    let text;
    if (g.rewindAnim) text = 'Le temps recule…';
    else if (g.rewindUsed) text = 'Déjà utilisé';
    else if (g.state !== 'wave') text = 'Pendant la vague';
    else if (!ready) text = 'Le passé s’accumule…';
    else text = `◀◀ glisser · −${avail.toFixed(0)} s`;
    if (text !== this.last.text) {
      this.label.textContent = text;
      this.last.text = text;
    }
    if (ready !== this.last.ready) {
      this.root.classList.toggle('ready', ready);
      this.last.ready = ready;
    }
    const used = g.rewindUsed && g.state === 'wave';
    if (used !== this.last.used) {
      this.root.classList.toggle('used', used);
      this.last.used = used;
    }
  }

  // Position (px page) du centre de la poignée, pour les indications du tutoriel.
  knobRect() {
    return this.knob.getBoundingClientRect();
  }
  trackRect() {
    return this.track.getBoundingClientRect();
  }
}
