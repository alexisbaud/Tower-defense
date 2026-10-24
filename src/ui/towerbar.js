// Barre d'actions flottante au-dessus de la lanterne sélectionnée :
// [priorité de ciblage | déplacer le mur | « Lanterne d’Aki »] [Fiche] [Vendre — secondaire, confirmé
// par un second toucher]. Les lanternes qui ne visent pas (aura, impulsion,
// soutien) n'ont pas de priorité ; le Gardien de pierre déplace son mur.
import { PRIORITIES } from '../core/game.js';

// La priorité de ciblage compte-t-elle pour cette lanterne ?
export function aims(def) {
  const a = def?.attack ?? 'projectile';
  return a === 'projectile' || a === 'lob' || a === 'beam';
}

export const PRIORITY_INFO = {
  first: { kanji: '先', label: 'Premier', desc: 'le plus avancé vers le sanctuaire' },
  last: { kanji: '後', label: 'Dernier', desc: 'le moins avancé' },
  strong: { kanji: '強', label: 'Plus fort', desc: 'le plus de PV restants' },
  close: { kanji: '近', label: 'Plus proche', desc: 'le plus proche de la lanterne' },
};

export function priorityInfo(p) {
  return PRIORITY_INFO[p] || { kanji: '的', label: String(p || 'Premier'), desc: '' };
}

// Priorité suivante (Premier → Dernier → Plus fort → Plus proche → …).
export function cyclePriority(game, t) {
  if (game.cyclePriority) return game.cyclePriority(t.id);
  const list = PRIORITIES || Object.keys(PRIORITY_INFO);
  const next = list[(list.indexOf(t.priority) + 1) % list.length];
  if (game.setPriority) game.setPriority(t.id, next);
  else t.priority = next;
  return next;
}

const CONFIRM_MS = 2600;
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
   * @param {object} h  game(), input, renderer, sheetOpen(), onPriority(t), onSheet(t), onSell(t), onRally(t),
   *                    owner(pid) → { name, color, … } (coopération)
   */
  constructor(el, h) {
    this.el = el;
    this.h = h;
    this.sig = null;
    this.pos = null;
    this.confirm = null; // id de la lanterne dont la vente attend confirmation
    this.confirmTimer = 0;
    el.addEventListener('click', (e) => this.onClick(e));
  }

  onClick(e) {
    const b = e.target.closest('button');
    const g = this.h.game();
    const t = g && this.h.input.ui.selectedTower != null ? g.towerById(this.h.input.ui.selectedTower) : null;
    if (!b || !t) return;
    const act = b.dataset.act;
    if (act === 'prio') {
      this.h.onPriority?.(t);
    } else if (act === 'rally') {
      this.h.onRally?.(t);
    } else if (act === 'info') {
      this.h.onSheet?.(t);
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
      }
    }
    this.sig = null;
    this.update();
  }

  hide() {
    if (this.sig === 'hidden') return;
    this.sig = 'hidden';
    this.pos = null;
    this.el.classList.add('hidden');
    this.confirm = null;
  }

  update() {
    const g = this.h.game();
    const input = this.h.input;
    const id = input.ui.selectedTower;
    const t = g && id != null ? g.towerById(id) : null;
    // Fiche ouverte : ses propres boutons suffisent (pas de doublon « Vendre »).
    // « Déplacer le mur » : la barre s'efface pour laisser voir les cases allumées.
    if (!t || input.ui.drag || input.ui.press || input.ui.rally || this.h.sheetOpen?.() || g.rewindAnim || g.lastChanceT > 0 || g.state === 'won' || g.state === 'lost') {
      this.hide();
      return;
    }
    if (this.confirm != null && this.confirm !== t.id) this.confirm = null;
    const sell = g.sellValue(t);
    const p = priorityInfo(t.priority);
    const def = g.defs.towers[t.type];
    const wall = def?.attack === 'barrier';
    const rally = wall && input.ui.rally?.towerId === t.id;
    // en coopération, la lanterne d'un autre joueur ne se règle ni ne se vend : fiche seule
    const mine = !(g.players?.length > 1) || t.owner === g.localPlayer;
    const sig = `${t.id}|${t.priority}|${sell}|${this.confirm === t.id}|${rally}|${mine}|${t.owner}`;
    if (sig !== this.sig) {
      this.sig = sig;
      const confirm = this.confirm === t.id;
      let first = '';
      // lanterne d'un coéquipier : « Lanterne d’Aki » (sceau de son élément), fiche seule
      if (!mine) {
        const o = this.h.owner?.(t.owner);
        const name = o?.name ?? g.players[t.owner]?.name ?? 'un coéquipier';
        const glyph = GLYPHS[o?.shape] ?? escapeHtml(o?.initial ?? '●');
        first = `<span class="tb-owner" style="--el:${o?.color ?? '#6d6a78'}"><span class="tb-owner-seal" aria-hidden="true">${glyph}</span><span class="tb-txt">Lanterne ${escapeHtml(ofName(name))}</span></span>`;
      } else if (wall) first = `<button class="tb-btn tb-rally${rally ? ' on' : ''}" data-act="rally" aria-pressed="${rally}" aria-label="${rally ? 'Annuler le déplacement du mur' : 'Déplacer le mur : touchez ensuite une case allumée'}"><span class="tb-ico">壁</span><span class="tb-txt">${rally ? 'Annuler' : 'Déplacer le mur'}</span></button>`;
      else if (aims(def)) first = `<button class="tb-btn tb-prio" data-act="prio" aria-label="Priorité de ciblage : ${p.label}. Toucher pour changer"><span class="tb-ico">${p.kanji}</span><span class="tb-txt">${p.label}</span></button>`;
      this.el.innerHTML =
        first +
        `<button class="tb-btn tb-info" data-act="info" aria-label="Fiche de la lanterne"><span class="tb-ico">札</span><span class="tb-txt">Fiche</span></button>` +
        (mine ? `<button class="tb-btn tb-sell${confirm ? ' confirm' : ''}" data-act="sell" aria-label="${confirm ? 'Confirmer la vente' : 'Vendre'} pour ${sell} or"><span class="tb-ico">金</span><span class="tb-txt">${confirm ? 'Confirmer' : 'Vendre'} +${sell}</span></button>` : '');
      this.el.classList.remove('hidden');
      this.pos = null;
    }
    this.place(t);
  }

  // Au-dessus de la lanterne (sous elle près du haut du plateau), dans le plateau.
  place(t) {
    const r = this.h.renderer;
    const ts = r.ts;
    const w = this.el.offsetWidth;
    const hgt = this.el.offsetHeight;
    const stage = this.el.parentElement;
    const W = stage.clientWidth;
    const p = r.toScreen(t.x, t.y);
    const left = Math.max(6, Math.min(W - w - 6, p.x - w / 2));
    const above = p.y - ts * 1.0 - hgt - 6;
    const under = p.y + ts * 0.55 + 6;
    // Au-dessus par défaut ; dessous si la place manque, ou si la barre y cacherait
    // moins de lanternes voisines.
    const covered = (y0) => {
      let n = 0;
      for (const o of this.h.game().towers) {
        if (o.id === t.id) continue;
        const q = r.toScreen(o.x, o.y - 0.35);
        if (q.x > left - ts * 0.3 && q.x < left + w + ts * 0.3 && q.y > y0 - ts * 0.3 && q.y < y0 + hgt + ts * 0.3) n++;
      }
      return n;
    };
    const H = stage.clientHeight;
    // haut utilisable : sous la barre de boss quand elle est affichée
    const boss = stage.querySelector('#bossbar');
    const minTop = boss && !boss.classList.contains('hidden') ? boss.offsetTop + boss.offsetHeight + 4 : 4;
    let below = above < minTop || (under + hgt < H - 4 && covered(under) < covered(above));
    if (below && under + hgt > H - 4 && above >= minTop) below = false;
    const top = below ? under : above;
    const key = `${Math.round(left)}|${Math.round(top)}|${below}`;
    if (key === this.pos) return;
    this.pos = key;
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
    this.el.style.setProperty('--ax', `${Math.round(p.x - left)}px`);
    this.el.classList.toggle('below', below);
  }
}
