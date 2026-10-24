// Point d'entrée : boucle à pas de temps fixe, liaison moteur / rendu / interface.
import { Game, STEP } from './core/game.js';
import { defs, loadLevel, worldById } from './data.js';
import { Renderer } from './render/renderer.js';
import { Input } from './ui/input.js';
import { Hud } from './ui/hud.js';

const canvas = document.getElementById('board');
const stage = document.getElementById('stage');
const screenGame = document.getElementById('screen-game');

const renderer = new Renderer(canvas);
const state = {
  game: null,
  levelId: null,
  paused: false,
  speed: 1,
  muted: false,
  acc: 0,
  last: performance.now(),
};

const input = new Input(canvas, renderer, {
  game: () => state.game,
  onInfo: (target) => showInfo(target),
  onFeedback: (kind, data) => {
    if (kind === 'reject' || kind === 'hint') {
      const msg = hud.reason(data.reason);
      if (msg) hud.toast(msg, kind === 'reject');
    }
  },
  onAction: () => {},
});

const hud = new Hud(screenGame, {
  onWave: () => state.game?.startNextWave(),
  onPause: () => setPaused(!state.paused),
  onSpeed: () => {
    state.speed = state.speed === 1 ? 2 : 1;
    const b = document.getElementById('btn-speed');
    b.firstElementChild.textContent = `×${state.speed}`;
    b.classList.toggle('on', state.speed === 2);
  },
  onMute: () => {
    state.muted = !state.muted;
    document.getElementById('btn-mute').classList.toggle('off', state.muted);
  },
  onTool: () => {},
});

function setPaused(p) {
  state.paused = p;
  document.getElementById('btn-pause').classList.toggle('on', p);
  if (p) hud.toast('En pause', false, 100000);
  else hud.toast('Reprise', false, 600);
}

function showInfo(target) {
  const g = state.game;
  if (target.kind === 'tower') {
    const t = target.tower;
    const def = g.defs.towers[t.type];
    const st = g.towerStats(t);
    const combos = g.zones
      .filter((z) => z.a === t.id || z.b === t.id)
      .map((z) => `<span>${z.def.kanji} ${z.def.name}</span>`)
      .join('');
    const next = t.level < g.rules.maxTowerLevel ? 'Glissez sur une lanterne identique pour fusionner.' : 'Niveau maximum.';
    hud.showInfo(
      `<h3>${def.kanji} ${def.name} · N${t.level}</h3>
       <div class="sub">${def.role} — ${def.desc}</div>
       <div class="rows">
         <span>Dégâts <b>${st.damage}</b></span><span>Cadence <b>${st.rate}/s</b></span>
         <span>Portée <b>${st.range}</b></span><span>Investi <b>${t.invested}</b></span>
         ${combos ? `<span style="grid-column:1/-1">Combos : ${combos}</span>` : ''}
         <span style="grid-column:1/-1;opacity:.7">${next}</span>
       </div>`,
      [
        { label: `Vendre +${g.sellValue(t)}`, cls: 'primary', run: () => g.sellTower(t.id) },
        { label: 'Fermer', run: () => (input.ui.selectedTower = null) },
      ],
    );
  } else if (target.kind === 'stone') {
    const refund = Math.floor(g.stoneCost() * g.rules.stoneRefund);
    hud.showInfo(
      `<h3>石 Pierre</h3>
       <div class="sub">Détourne les yokai terrestres. Pierres restantes : ${g.stonesLeft()}</div>`,
      [
        { label: `Retirer +${refund}`, cls: 'primary', run: () => g.removeStone(target.c, target.r) },
        { label: 'Fermer' },
      ],
    );
  }
}

async function startLevel(id) {
  const level = await loadLevel(id);
  const world = worldById(level.world);
  state.levelId = id;
  state.game = new Game(level, defs, { seed: 1 });
  state.acc = 0;
  input.reset();
  renderer.setGame(state.game, world.theme);
  hud.setup(state.game, input);
  hud.banner(level.name, level.subtitle || '');
}

// Gestion des événements moteur côté présentation.
function handleEvents(game) {
  const evs = game.events;
  if (!evs.length) return;
  renderer.onEvents(evs);
  for (const ev of evs) {
    if (ev.type === 'waveStart') hud.banner(`Vague ${ev.index + 1}`, ev.index === ev.total - 1 ? 'Dernière vague' : '');
    else if (ev.type === 'earlyBonus') hud.toast(`Appel anticipé +${ev.gold} or`);
    else if (ev.type === 'win') hud.banner('Victoire', '★'.repeat(ev.stars) + '☆'.repeat(3 - ev.stars));
    else if (ev.type === 'lose') hud.banner('Défaite', 'Le sanctuaire est tombé');
  }
  evs.length = 0;
}

function resize() {
  const r = stage.getBoundingClientRect();
  renderer.resize(r.width, r.height);
}

function frame(now) {
  const dt = Math.min(0.1, (now - state.last) / 1000);
  state.last = now;
  const g = state.game;
  if (g) {
    if (!state.paused) {
      state.acc += dt * state.speed;
      let steps = 0;
      while (state.acc >= STEP && steps < 8) {
        g.update(STEP);
        state.acc -= STEP;
        steps++;
      }
      if (steps >= 8) state.acc = 0;
    }
    handleEvents(g);
    hud.update();
    renderer.render(state.paused ? 0 : dt, state.paused ? 1 : state.acc / STEP, input.ui);
  }
  requestAnimationFrame(frame);
}

// Empêche le zoom par pincement / double-tap et le défilement sur iOS.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.game && !state.paused) setPaused(true);
});

window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(stage);

// Accès de débogage (QA automatisée).
window.__renderer = renderer;
window.__state = state;

resize();
startLevel(new URLSearchParams(location.search).get('level') || '1-1').then(() => requestAnimationFrame(frame));
