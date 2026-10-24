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

const STONE_COLOR = '#7d7a70';
const ICON = 52; // taille CSS par défaut des icônes de la palette

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
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    // taille d'icône fixée par la feuille de style (--icon, selon l'écran)
    const size = parseFloat(getComputedStyle(this.palette).getPropertyValue('--icon')) || ICON;
    const add = (id, label, kanji, cost, color, draw) => {
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.tool = id;
      b.style.setProperty('--el', color);
      b.setAttribute('aria-label', `${label}, ${cost} or`);
      const cv = document.createElement('canvas');
      cv.width = Math.round(size * dpr);
      cv.height = Math.round(size * dpr);
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
      this.tools.push({ el: b, id, cost, costEl: b.querySelector('.cost') });
      return b;
    };
    for (const type of game.availableTowers) {
      const def = game.defs.towers[type];
      add(type, def.name, def.kanji, def.cost, def.color, (ctx) => drawTowerIcon(ctx, size, size, def));
    }
    if (game.level.stones && game.stoneCost) {
      add('stone', 'Pierre', '石', game.stoneCost(), STONE_COLOR, (ctx) => drawStoneIcon(ctx, size, size));
    }
    this.palette.style.setProperty('--n', String(this.tools.length));
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
        // le coût d'une pierre peut évoluer : on garde l'étiquette à jour
        if (t.id === 'stone' && String(cost) !== t.costEl.textContent) t.costEl.textContent = cost;
      }
    }
    if (force || g.lives !== this.last.lives) {
      this.lives.textContent = g.lives;
      if (!force) bump(this.lives, g.lives < (this.last.lives ?? 0) ? 'hurt' : 'bump');
      this.lives.parentElement.classList.toggle('low', g.lives <= Math.max(3, g.maxLives * 0.25));
      this.last.lives = g.lives;
    }
    const waveNum = Math.max(0, g.waveIndex + 1);
    const waveStr = `${waveNum}/${g.totalWaves}`;
    if (waveStr !== this.last.wave) {
      this.wave.innerHTML = `<small>Vague</small><b>${waveNum}<i>/${g.totalWaves}</i></b>`;
      this.wave.setAttribute('aria-label', `Vague ${waveNum} sur ${g.totalWaves}`);
      this.last.wave = waveStr;
    }
    // Bouton de vague : lancer / compte à rebours / en cours.
    let label;
    let enabled;
    let mode;
    if (g.state === 'build') {
      enabled = true;
      mode = g.countdown != null ? 'countdown' : 'ready';
      label = g.countdown != null ? `Vague ${g.waveIndex + 2} · ${Math.ceil(g.countdown)}` : g.waveIndex < 0 ? 'Commencer' : 'Vague';
    } else {
      enabled = false;
      mode = g.state === 'wave' ? 'running' : 'over';
      label = g.state === 'wave' ? 'En cours' : '—';
    }
    if (label !== this.last.label) {
      this.waveLabel.textContent = label;
      this.last.label = label;
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
    const pulse = g.state === 'build' && g.waveIndex < 0 && g.towers.length > 0;
    if (pulse !== this.last.pulse) {
      this.waveBtn.classList.toggle('pulse', pulse);
      this.last.pulse = pulse;
    }
  }

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
    this.info.innerHTML = '<div class="grip"></div>' + html + '<div class="actions"></div>';
    sealTitle(this.info.querySelector('h3'), this.game);
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

// Titre de fiche « 火 Lanterne du Feu · N2 » : le kanji devient un sceau
// à la couleur de l'élément, le niveau une pastille.
function sealTitle(h3, game) {
  if (!h3) return;
  const m = /^\s*(\S)\s+(.*?)(?:\s*·\s*(N\d))?\s*$/.exec(h3.textContent);
  if (!m || m[1].charCodeAt(0) < 0x2e80) return;
  const def = game && Object.values(game.defs.towers).find((d) => d.kanji === m[1]);
  const color = def ? def.color : STONE_COLOR;
  h3.textContent = '';
  const seal = document.createElement('span');
  seal.className = 'seal';
  seal.style.background = color;
  seal.textContent = m[1];
  const name = document.createElement('span');
  name.className = 'h3-name';
  name.textContent = m[2];
  h3.append(seal, name);
  if (m[3]) {
    const lvl = document.createElement('span');
    lvl.className = 'h3-level';
    lvl.textContent = m[3];
    h3.append(lvl);
  }
}

function bump(el, cls = 'bump') {
  el.classList.remove('bump', 'hurt');
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 260);
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
