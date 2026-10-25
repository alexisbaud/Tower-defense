// Barre d'actions de la lanterne sélectionnée (docs/UI-UX.md §6.8) :
//   [先 Premier ▾] [合 Fusionner] [札 Fiche] [金 Vendre +35]
// boutons 64 × 52, fond encre ; « Premier ▾ » replie la barre en ses 4 choix
// ([先 Premier] [後 Dernier] [強 Fort] [近 Proche], la priorité courante en or ; un toucher
// règle et ferme) ; « Fusionner » n'apparaît que si une jumelle existe (or clair) ;
// « Vendre » est confirmé par un second toucher. Le Gardien de pierre déplace son mur ;
// la lanterne d'un coéquipier ne se règle ni ne se vend (fiche seule).
// Placement : au-dessus ou au-dessous de la lanterne, décalée dans le plateau, là où elle
// couvre le moins de cases de chemin (poids 2) et de lanternes (poids 1), sans jamais
// couvrir la lanterne choisie. Fermeture : après chaque action (sauf « Priorité ▾ »),
// toucher ailleurs, ouverture d'une fiche, et après 6 s sans geste (sauf vente armée
// ou choix de priorité ouvert) : un menu d'action n'est pas une information.
// Construction en cours touchée : [建 En construction · 1 s] [↶ Annuler], ou, pour
// celle d'un coéquipier, « Pris par Aki » (sans bouton).
// Les réglages partent comme commandes (commands.js), jamais en direct au moteur.
import { PRIORITIES } from '../core/game.js';
import { T } from '../core/grid.js';
import { commands } from './commands.js';
import { CONFIRM_MS } from './press.js';

// La priorité de ciblage compte-t-elle pour cette lanterne ?
export function aims(def) {
  const a = def?.attack ?? 'projectile';
  return a === 'projectile' || a === 'lob' || a === 'beam';
}

export const PRIORITY_INFO = {
  first: { kanji: '先', label: 'Premier', short: 'Premier', desc: 'le plus avancé vers le sanctuaire' },
  last: { kanji: '後', label: 'Dernier', short: 'Dernier', desc: 'le moins avancé' },
  strong: { kanji: '強', label: 'Plus fort', short: 'Fort', desc: 'le plus de PV restants' },
  close: { kanji: '近', label: 'Plus proche', short: 'Proche', desc: 'le plus proche de la lanterne' },
};

export function priorityInfo(p) {
  return PRIORITY_INFO[p] || { kanji: '的', label: String(p || 'Premier'), short: String(p || 'Premier'), desc: '' };
}

// Priorité suivante (Premier → Dernier → Plus fort → Plus proche → …), envoyée comme
// commande 'setPriority' (valeur explicite : deux touchers rapides, même avant
// l'exécution de la première commande, avancent bien de deux crans).
// Renvoie la priorité demandée, ou null si la commande est refusée.
export function cyclePriority(game, t) {
  const list = PRIORITIES || Object.keys(PRIORITY_INFO);
  const cur = commands.priorityOf(t) ?? t.priority;
  const next = list[(list.indexOf(cur) + 1) % list.length];
  return commands.issue('setPriority', t.id, next) ? next : null;
}

const IDLE_MS = 6000;
const GLYPHS = { triangle: '▲', drop: '●', diamond: '◆', square: '■' };

// « de Botan », « d’Aki » (élision devant une voyelle ou un h muet).
export function ofName(name) {
  const s = String(name ?? '');
  return /^[aeiouyhàâäéèêëîïôöùûü]/i.test(s) ? `d’${s}` : `de ${s}`;
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class TowerBar {
  /**
   * @param {HTMLElement} el  #tower-bar (dans #stage)
   * @param {object} h  game(), input, renderer, sheetOpen(), onPriority(t, value), onSheet(t), onSell(t),
   *                    onRally(t), onFuse(t), onCancelBuild(build) (construction en cours),
   *                    owner(pid) → { name, color, … } (coopération)
   */
  constructor(el, h) {
    this.el = el;
    this.h = h;
    this.sig = null;
    this.pos = null;
    this.confirm = null; // id de la lanterne dont la vente attend confirmation
    this.confirmTimer = 0;
    this.prioOpen = null; // id de la lanterne dont le choix de priorité est ouvert
    this.shownFor = null; // lanterne (ou construction) affichée : le délai d'inactivité repart
    this.idleAt = 0;
    this.closedFor = null; // fermée par le délai : elle ne revient qu'à la prochaine sélection
    el.addEventListener('click', (e) => this.onClick(e));
    el.addEventListener('pointerdown', () => this.touch());
  }

  touch() {
    this.idleAt = performance.now();
  }

  onClick(e) {
    const b = e.target.closest('button');
    const g = this.h.game();
    this.touch();
    // barre d'une construction en cours
    const sb = this.h.input.ui.selectedBuild;
    if (b && sb && b.dataset.act === 'cancelBuild') {
      const build = commands.buildAt(sb.c, sb.r);
      this.h.input.ui.selectedBuild = null;
      if (build) this.h.onCancelBuild?.(build);
      this.sig = null;
      this.update();
      return;
    }
    const t = g && this.h.input.ui.selectedTower != null ? g.towerById(this.h.input.ui.selectedTower) : null;
    if (!b || !t) return;
    const act = b.dataset.act;
    let close = true;
    if (act === 'prio') {
      // « Premier ▾ » : la barre se replie en ses 4 choix
      this.prioOpen = this.prioOpen === t.id ? null : t.id;
      close = false;
    } else if (act === 'setprio') {
      this.prioOpen = null;
      this.h.onPriority?.(t, b.dataset.p);
    } else if (act === 'rally') {
      this.h.onRally?.(t);
      close = false;
    } else if (act === 'info') {
      this.h.onSheet?.(t);
      close = false;
    } else if (act === 'fuse') {
      this.h.onFuse?.(t);
      close = false;
    } else if (act === 'sell') {
      if (this.confirm === t.id) {
        this.confirm = null;
        clearTimeout(this.confirmTimer);
        this.h.onSell?.(t);
      } else {
        // Vendre est secondaire : un premier toucher demande confirmation.
        this.confirm = t.id;
        clearTimeout(this.confirmTimer);
        this.confirmTimer = setTimeout(() => {
          this.confirm = null;
          this.sig = null;
        }, CONFIRM_MS);
        close = false;
      }
    }
    // après une action : la barre se ferme (la lanterne reste choisie, portée affichée)
    if (close && act !== 'sell') this.closedFor = t.id;
    this.sig = null;
    this.update();
  }

  // Barre refermée sur la lanterne `id` (encore choisie) ?
  isClosedFor(id) {
    return id != null && this.closedFor === id;
  }

  // Un nouveau toucher sur la lanterne choisie : la barre revient.
  reopen(id) {
    if (this.closedFor !== id) return;
    this.closedFor = null;
    this.idleAt = performance.now();
    this.sig = null;
    this.update();
  }

  hide() {
    if (this.sig === 'hidden') return;
    this.sig = 'hidden';
    this.pos = null;
    this.el.classList.add('hidden');
    this.confirm = null;
    this.prioOpen = null;
  }

  update() {
    const g = this.h.game();
    const input = this.h.input;
    if (input.ui.selectedBuild && g && this.updateBuild(g, input)) return;
    const id = input.ui.selectedTower;
    const t = g && id != null ? g.towerById(id) : null;
    // nouvelle sélection : le délai d'inactivité repart, la barre peut revenir
    if (id !== this.shownFor) {
      this.shownFor = id;
      this.idleAt = performance.now();
      if (this.closedFor !== id) this.closedFor = null;
    }
    if (id == null) this.closedFor = null;
    // Fiche ouverte : ses propres boutons suffisent (pas de doublon « Vendre »).
    // « Déplacer le mur », fusion guidée : la barre s'efface pour laisser voir le plateau.
    // (fusion ou vente en route : plus rien à régler sur cette lanterne)
    if (!t || input.ui.drag || input.ui.press || input.ui.rally || input.ui.fuseFrom != null || this.h.sheetOpen?.() || g.rewindAnim || g.lastChanceT > 0 || g.state === 'won' || g.state === 'lost' || commands.towerBusy(t.id)) {
      this.hide();
      return;
    }
    if (this.closedFor === t.id) {
      this.hide();
      return;
    }
    // 6 s sans geste : la barre se ferme (pas pendant une vente armée ni le choix de priorité)
    if (this.confirm !== t.id && this.prioOpen !== t.id && performance.now() - this.idleAt > IDLE_MS) {
      this.closedFor = t.id;
      this.hide();
      return;
    }
    if (this.confirm != null && this.confirm !== t.id) this.confirm = null;
    if (this.prioOpen != null && this.prioOpen !== t.id) this.prioOpen = null;
    const sell = g.sellValue(t);
    // priorité demandée (commande en attente comprise)
    const pk = commands.priorityOf(t) ?? t.priority;
    const p = priorityInfo(pk);
    const def = g.defs.towers[t.type];
    const wall = def?.attack === 'barrier';
    const rally = wall && input.ui.rally?.towerId === t.id;
    // en coopération, la lanterne d'un autre joueur ne se règle ni ne se vend : fiche seule
    const mine = !(g.players?.length > 1) || t.owner === g.localPlayer;
    // (en pause, on étudie : ni pose ni fusion, donc pas de « Fusionner »)
    const twin = mine && g.fuse && !input.inspect && g.towers.some((o) => o.id !== t.id && commands.check('fuse', o.id, t.id).ok);
    const prio = this.prioOpen === t.id;
    const sig = `${t.id}|${pk}|${sell}|${this.confirm === t.id}|${rally}|${mine}|${t.owner}|${twin}|${prio}`;
    if (sig !== this.sig) {
      this.sig = sig;
      const confirm = this.confirm === t.id;
      let html = '';
      if (prio) {
        // les 4 priorités visibles ; la courante en or
        for (const k of PRIORITIES) {
          const info = priorityInfo(k);
          html += `<button class="tb-btn tb-pick${k === pk ? ' on' : ''}" data-act="setprio" data-p="${k}" aria-pressed="${k === pk}" aria-label="Viser : ${info.label} (${info.desc})"><span class="tb-ico">${info.kanji}</span><span class="tb-txt">${info.short}</span></button>`;
        }
      } else {
        // lanterne d'un coéquipier : « Lanterne d’Aki » (sceau de son élément), fiche seule
        if (!mine) {
          const o = this.h.owner?.(t.owner);
          const name = o?.name ?? g.players[t.owner]?.name ?? 'un coéquipier';
          const glyph = GLYPHS[o?.shape] ?? escapeHtml(o?.initial ?? '●');
          html += `<span class="tb-owner" style="--el:${o?.color ?? '#6d6a78'}"><span class="tb-owner-seal" aria-hidden="true">${glyph}</span><span class="tb-txt">Lanterne ${escapeHtml(ofName(name))}</span></span>`;
        } else if (wall) html += `<button class="tb-btn tb-rally${rally ? ' on' : ''}" data-act="rally" aria-pressed="${rally}" aria-label="${rally ? 'Annuler le déplacement du mur' : 'Déplacer le mur : touchez ensuite une case allumée'}"><span class="tb-ico">壁</span><span class="tb-txt">${rally ? 'Annuler' : 'Mur'}</span></button>`;
        else if (aims(def)) html += `<button class="tb-btn tb-prio" data-act="prio" aria-expanded="false" aria-label="Priorité de ciblage : ${p.label}. Toucher pour choisir"><span class="tb-ico">${p.kanji}</span><span class="tb-txt">${p.short} ▾</span></button>`;
        if (twin) html += `<button class="tb-btn tb-fuse" data-act="fuse" aria-label="Fusionner avec sa jumelle : touchez ensuite la jumelle"><span class="tb-ico">合</span><span class="tb-txt">Fusionner</span></button>`;
        html += `<button class="tb-btn tb-info" data-act="info" aria-label="Fiche de la lanterne"><span class="tb-ico">札</span><span class="tb-txt">Fiche</span></button>`;
        if (mine) html += `<button class="tb-btn tb-sell${confirm ? ' confirm' : ''}" data-act="sell" aria-label="${confirm ? 'Confirmer la vente' : 'Vendre'} pour ${sell} or"><span class="tb-ico">金</span><span class="tb-txt">${confirm ? 'Confirmer' : 'Vendre'} +${sell}</span>${confirm ? `<i class="arm-ring" style="--arm-ms:${CONFIRM_MS}ms" aria-hidden="true"></i>` : ''}</button>`;
      }
      this.el.innerHTML = html;
      this.el.classList.toggle('picking', prio);
      this.el.classList.remove('hidden');
      this.pos = null;
    }
    this.place(t);
  }

  // Construction en cours sélectionnée (toucher sur son socle) : « En construction »
  // et son temps restant, « Annuler » pour la sienne ; « Pris par Aki » pour celle
  // d'un coéquipier. Renvoie faux si elle n'existe plus (la barre normale reprend).
  updateBuild(g, input) {
    const sb = input.ui.selectedBuild;
    const b = commands.buildAt(sb.c, sb.r);
    if (!b || input.ui.drag || input.ui.press || this.h.sheetOpen?.() || g.rewindAnim || g.lastChanceT > 0 || g.state === 'won' || g.state === 'lost') {
      if (!b) return false;
      this.hide();
      return true;
    }
    const secs = Math.max(1, Math.ceil(b.left));
    const what = b.op === 'placeStone' ? 'Pierre' : g.defs.towers[b.type]?.name ?? 'Lanterne';
    const sig = `build|${b.c},${b.r}|${b.mine}|${secs}|${b.pid}`;
    if (sig !== this.sig) {
      this.sig = sig;
      if (b.mine) {
        this.el.innerHTML =
          `<span class="tb-owner tb-build" role="status" aria-label="${escapeHtml(what)} en construction, encore ${secs} seconde${secs > 1 ? 's' : ''}"><span class="tb-owner-seal" aria-hidden="true">建</span><span class="tb-txt">En construction · ${secs} s</span></span>` +
          `<button class="tb-btn tb-cancel" data-act="cancelBuild" aria-label="Annuler la construction : rien n’est payé"><span class="tb-ico">↶</span><span class="tb-txt">Annuler</span></button>`;
      } else {
        const o = this.h.owner?.(b.pid);
        const name = o?.name ?? g.players[b.pid]?.name ?? 'un coéquipier';
        const glyph = GLYPHS[o?.shape] ?? escapeHtml(o?.initial ?? '●');
        this.el.innerHTML = `<span class="tb-owner tb-build" role="status" style="--el:${o?.color ?? '#6d6a78'}"><span class="tb-owner-seal" aria-hidden="true">${glyph}</span><span class="tb-txt">Pris par ${escapeHtml(name)} · ${secs} s</span></span>`;
      }
      this.el.classList.remove('hidden', 'picking');
      this.pos = null;
    }
    this.place({ id: null, x: b.c + 0.5, y: b.r + 0.5 });
    return true;
  }

  // Au-dessus ou au-dessous de la lanterne, décalée dans le plateau : la position qui
  // couvre le moins de chemin (poids 2) et de lanternes (poids 1), jamais la lanterne.
  place(t) {
    const r = this.h.renderer;
    const g = this.h.game();
    const ts = r.ts;
    const w = this.el.offsetWidth;
    const hgt = this.el.offsetHeight;
    const stage = this.el.parentElement;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const p = r.toScreen(t.x, t.y);
    // haut utilisable : sous la barre de boss quand elle est affichée
    const boss = stage.querySelector('#bossbar');
    const minTop = boss && !boss.classList.contains('hidden') ? boss.offsetTop + boss.offsetHeight + 4 : 4;
    const key0 = `${t.id ?? 'b'}|${Math.round(p.x)}|${Math.round(p.y)}|${w}|${hgt}|${minTop}|${g?.towers.length}`;
    if (key0 === this.pos) return;
    this.pos = key0;
    // corps de la lanterne choisie (jamais couvert) et cases à éviter
    const self = { l: p.x - ts * 0.5, t: p.y - ts * 1.0, r: p.x + ts * 0.5, b: p.y + ts * 0.55 };
    const cost = (box) => {
      let n = 0;
      if (!g) return n;
      const grid = g.grid;
      const c0 = Math.max(0, Math.floor((box.l - r.ox) / ts));
      const c1 = Math.min(grid.cols - 1, Math.floor((box.r - r.ox) / ts));
      const r0 = Math.max(0, Math.floor((box.t - r.oy) / ts));
      const r1 = Math.min(grid.rows - 1, Math.floor((box.b - r.oy) / ts));
      for (let rr = r0; rr <= r1; rr++) {
        for (let cc = c0; cc <= c1; cc++) {
          const ty = grid.type(grid.idx(cc, rr));
          if (ty === T.PATH || ty === T.OPEN || ty === T.SPAWN || ty === T.GOAL) n += 2;
          else if (g.towerAt(cc, rr)) n += 1;
        }
      }
      return n;
    };
    const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    const above = p.y - ts * 1.0 - hgt - 6;
    const under = p.y + ts * 0.55 + 6;
    const xs = [p.x - w / 2, p.x - w + ts * 0.7, p.x - ts * 0.7].map((x) => Math.max(6, Math.min(W - w - 6, x)));
    let best = null;
    for (const top of [above, under]) {
      if (top < minTop || top + hgt > H - 4) continue;
      for (const x of xs) {
        const box = { l: x, t: top, r: x + w, b: top + hgt };
        if (hit(box, self)) continue;
        // à coût égal : au-dessus, puis centrée
        const score = cost(box) + (top === under ? 0.5 : 0) + Math.abs(x + w / 2 - p.x) / (ts * 40);
        if (!best || score < best.score) best = { x, top, score };
      }
    }
    if (!best) best = { x: xs[0], top: Math.max(minTop, above < minTop ? under : above) };
    const below = best.top > p.y;
    this.el.style.left = `${Math.round(best.x)}px`;
    this.el.style.top = `${Math.round(best.top)}px`;
    this.el.style.setProperty('--ax', `${Math.round(Math.max(14, Math.min(w - 14, p.x - best.x)))}px`);
    this.el.classList.toggle('below', below);
  }
}
