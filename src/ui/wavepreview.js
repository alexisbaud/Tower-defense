// Aperçu de la prochaine vague, à côté du bouton de vague : une pastille par
// yokai (portrait + nombre, badge d'élément pour un absorbeur). Toucher une
// pastille ouvre la fiche du yokai ; « +N » ouvre la liste complète.
import { enemyPortrait } from './portraits.js';
import { elementBadge, elementInfo } from './elements.js';

const CHIP = 44; // zone tactile minimale (pt)
const GAP = 8;

export class WavePreview {
  constructor(el, h) {
    this.el = el;
    this.h = h; // onEnemy(type, absorb), onMore()
    this.sig = null;
    this.slots = 0;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.more) this.h.onMore?.();
      else this.h.onEnemy?.(b.dataset.enemy, b.dataset.absorb || null);
    });
  }

  reset() {
    this.sig = null;
    this.el.innerHTML = '';
  }

  // Nombre de pastilles qui tiennent dans la place laissée par la jauge et le bouton.
  resize() {
    const w = this.el.clientWidth;
    const n = Math.max(0, Math.floor((w + GAP) / (CHIP + GAP)));
    if (n !== this.slots) {
      this.slots = n;
      this.sig = null;
    }
  }

  update(game, pv) {
    if (!pv) {
      if (this.sig !== '') {
        this.sig = '';
        this.el.innerHTML = '';
        this.el.classList.remove('climax');
      }
      return;
    }
    if (!this.slots) this.resize();
    const groups = pv.groups || [];
    const sig = `${pv.index}|${pv.climax}|${this.slots}|${groups.map((g) => `${g.enemy}:${g.absorb || ''}:${g.count}`).join(',')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const defs = game.defs;
    const n = this.slots;
    const shown = groups.length > n ? groups.slice(0, Math.max(0, n - 1)) : groups;
    const more = groups.length - shown.length;
    let html = '';
    for (const g of shown) {
      const def = defs.enemies[g.enemy];
      if (!def) continue;
      const absorb = g.absorb ?? def.abilities?.absorb ?? null;
      const badge = absorb ? elementBadge(absorb, defs, { size: 18, cls: 'wchip-el', kanji: false }) : '';
      const label = `${g.count} × ${def.name}${absorb ? ` (absorbe ${elementInfo(absorb, defs).label})` : ''}${def.boss ? ', boss' : ''}`;
      html += `<button class="wchip${def.boss ? ' boss' : ''}" data-enemy="${g.enemy}" data-absorb="${absorb || ''}" aria-label="${label}"><img alt="" src="${enemyPortrait(defs, g.enemy, absorb, 38)}"><b>${g.count}</b>${badge}</button>`;
    }
    if (more > 0 && n > 0) html += `<button class="wchip more" data-more="1" aria-label="${more} autres yokai"><b>+${more}</b></button>`;
    this.el.innerHTML = html;
    this.el.classList.toggle('climax', !!pv.climax);
  }
}
