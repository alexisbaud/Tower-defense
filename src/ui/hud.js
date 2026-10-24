// Interface DOM de la partie : compteurs, palette, bouton de vague, messages, fiche d'info.
import { drawTowerIcon } from '../render/towers.js';

const REASONS = {
  gold: "Pas assez d'or",
  occupied: 'Case déjà occupée',
  slot: 'Posez les lanternes sur les socles de pierre',
  blocked: 'Le chemin ne peut pas être bloqué',
  occupiedEnemy: 'Un yokai se tient ici',
  open: 'Les pierres se posent sur le gravier ouvert',
  limit: 'Plus de pierres disponibles',
  level: 'Niveau maximum atteint',
  mismatch: 'Fusion : même élément et même niveau',
  over: 'La partie est terminée',
};

export class Hud {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    this.$ = (id) => root.querySelector('#' + id);
    this.lives = this.$('hud-lives');
    this.gold = this.$('hud-gold');
    this.wave = this.$('hud-wave');
    this.palette = this.$('palette');
    this.waveBtn = this.$('btn-wave');
    this.waveLabel = this.$('btn-wave-label');
    this.toastEl = this.$('toast');
    this.bannerEl = this.$('banner');
    this.info = this.$('info');
    this.last = {};
    this.tools = [];
    this.toastTimer = 0;

    this.waveBtn.addEventListener('click', () => this.h.onWave());
    this.$('btn-pause').addEventListener('click', () => this.h.onPause());
    this.$('btn-speed').addEventListener('click', () => this.h.onSpeed());
    this.$('btn-mute').addEventListener('click', () => this.h.onMute());
    root.addEventListener('pointerdown', (e) => ripple(e), true);
  }

  setup(game, input) {
    this.game = game;
    this.input = input;
    this.last = {};
    this.palette.innerHTML = '';
    this.tools = [];
    const add = (id, label, kanji, cost, draw) => {
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.tool = id;
      b.setAttribute('aria-label', label);
      const cv = document.createElement('canvas');
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      cv.width = 52 * dpr;
      cv.height = 52 * dpr;
      const ctx = cv.getContext('2d');
      ctx.scale(dpr, dpr);
      draw(ctx);
      b.appendChild(cv);
      b.insertAdjacentHTML('beforeend', `<span class="kanji">${kanji}</span><span class="cost">${cost}</span>`);
      b.addEventListener('click', () => {
        const tool = this.input.setTool(id);
        this.h.onTool?.(tool);
        this.refreshTools();
      });
      this.palette.appendChild(b);
      this.tools.push({ el: b, id, cost });
      return b;
    };
    for (const type of game.availableTowers) {
      const def = game.defs.towers[type];
      add(type, def.name, def.kanji, def.cost, (ctx) => drawTowerIcon(ctx, 52, 52, def));
    }
    if (game.level.stones && game.stoneCost) {
      add('stone', 'Pierre', '石', game.stoneCost(), (ctx) => drawStoneIcon(ctx, 52, 52));
    }
    this.refreshTools();
    this.hideInfo();
    this.update(true);
  }

  refreshTools() {
    for (const t of this.tools) t.el.classList.toggle('selected', this.input.ui.tool === t.id);
  }

  update(force = false) {
    const g = this.game;
    if (!g) return;
    const gold = Math.floor(g.gold);
    if (force || gold !== this.last.gold) {
      this.gold.textContent = gold;
      if (!force && gold > (this.last.gold ?? 0)) bump(this.gold);
      this.last.gold = gold;
      for (const t of this.tools) {
        const cost = t.id === 'stone' ? g.stoneCost() : t.cost;
        t.el.classList.toggle('poor', gold < cost);
      }
    }
    if (force || g.lives !== this.last.lives) {
      this.lives.textContent = g.lives;
      if (!force) bump(this.lives);
      this.last.lives = g.lives;
    }
    const waveNum = Math.max(0, g.waveIndex + 1);
    const waveStr = `Vague ${waveNum}/${g.totalWaves}`;
    if (waveStr !== this.last.wave) {
      this.wave.textContent = waveStr;
      this.last.wave = waveStr;
    }
    // Bouton de vague : lancer / compte à rebours / en cours.
    let label;
    let enabled;
    if (g.state === 'build') {
      enabled = true;
      label = g.countdown != null ? `Vague ${g.waveIndex + 2} · ${Math.ceil(g.countdown)}` : g.waveIndex < 0 ? 'Commencer' : 'Vague';
    } else {
      enabled = false;
      label = g.state === 'wave' ? 'En cours' : '—';
    }
    if (label !== this.last.label) {
      this.waveLabel.textContent = label;
      this.last.label = label;
    }
    if (enabled !== this.last.enabled) {
      this.waveBtn.classList.toggle('disabled', !enabled);
      this.last.enabled = enabled;
    }
    const pulse = g.state === 'build' && g.waveIndex < 0 && g.towers.length > 0;
    if (pulse !== this.last.pulse) {
      this.waveBtn.classList.toggle('pulse', pulse);
      this.last.pulse = pulse;
    }
  }

  toast(msg, bad = false, ms = 1600) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.toggle('bad', bad);
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  reason(code) {
    return REASONS[code] || null;
  }

  banner(big, small = '') {
    const el = this.bannerEl;
    el.innerHTML = `<span class="big">${big}</span>${small ? `<span class="small">${small}</span>` : ''}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  showInfo(html, actions) {
    this.info.innerHTML = html + '<div class="actions"></div>';
    const box = this.info.querySelector('.actions');
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.cls || '');
      b.textContent = a.label;
      b.addEventListener('click', () => {
        a.run?.();
        if (a.close !== false) this.hideInfo();
      });
      box.appendChild(b);
    }
    this.info.classList.remove('hidden');
  }

  hideInfo() {
    this.info.classList.add('hidden');
  }

  get infoOpen() {
    return !this.info.classList.contains('hidden');
  }
}

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
  setTimeout(() => el.classList.remove('bump'), 160);
}

// Ondulation d'encre sous le doigt sur tous les boutons.
export function ripple(e) {
  const btn = e.target.closest?.('button');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const r = document.createElement('span');
  r.className = 'ripple';
  r.style.width = r.style.height = `${size}px`;
  r.style.left = `${e.clientX - rect.left - size / 2}px`;
  r.style.top = `${e.clientY - rect.top - size / 2}px`;
  if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
  btn.style.overflow = 'hidden';
  btn.appendChild(r);
  setTimeout(() => r.remove(), 500);
}

export function drawStoneIcon(ctx, w, h) {
  const x = w / 2;
  const y = h * 0.5;
  const r = w * 0.26;
  ctx.fillStyle = 'rgba(29,27,34,0.25)';
  ctx.beginPath();
  ctx.ellipse(x + 2, y + r * 0.6, r * 1.1, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8f8b80';
  ctx.strokeStyle = '#1d1b22';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - r, y + r * 0.5);
  ctx.quadraticCurveTo(x - r * 1.05, y - r * 0.5, x - r * 0.1, y - r * 0.8);
  ctx.quadraticCurveTo(x + r * 0.9, y - r * 0.85, x + r, y + r * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#6f7f3c';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.25, y - r * 0.5, r * 0.4, r * 0.15, -0.3, 0, Math.PI * 2);
  ctx.fill();
}
