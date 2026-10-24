// Fiches compactes : lanterne posée, type de lanterne (avant achat), yokai, pierre,
// vague suivante. Elles prennent la place de la barre du bas (le plateau reste
// visible) et se ferment d'un toucher sur le plateau. Tout se lit dans les données.
// Le module fournit aussi la table des combos (menu de pause).
import { elementOf, elementInfo, elementBadge, elementTag, elementList } from './elements.js';
import { enemyPortrait, towerPortrait } from './portraits.js';
import { priorityInfo } from './towerbar.js';

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const fmt = (n) => nf.format(Math.round(n * 100) / 100);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ───────────────────────── calculs d'affichage ─────────────────────────

// Dégâts par seconde sur une cible (tir + brûlure).
export function dpsOf(st) {
  if (!st) return 0;
  return (st.damage ?? 0) * (st.rate ?? 0) + (st.burn?.dps ?? 0);
}

const KNOWN_STATS = new Set(['range', 'rate', 'damage', 'projectileSpeed', 'burn', 'slow', 'knockback', 'splash', 'pierce', 'stun', 'airMultiplier']);

// Effets d'un niveau de lanterne, en clair (les clés inconnues restent affichées).
export function effectsOf(st) {
  const out = [];
  if (!st) return out;
  if (st.burn) out.push(`Brûlure ${fmt(st.burn.dps)}/s pendant ${fmt(st.burn.duration)} s`);
  if (st.slow) out.push(`Ralentit de ${Math.round((1 - st.slow.factor) * 100)} % (${fmt(st.slow.duration)} s)`);
  if (st.knockback) out.push(`Recul ${fmt(st.knockback)} case`);
  if (st.splash) out.push(`Zone ${fmt(st.splash)} case`);
  if (st.pierce) out.push(st.pierce >= 1 ? 'Ignore l’armure' : `Ignore ${Math.round(st.pierce * 100)} % de l’armure`);
  if (st.stun) out.push(`Étourdit ${fmt(st.stun)} s`);
  if (st.airMultiplier && st.airMultiplier !== 1) out.push(`×${fmt(st.airMultiplier)} contre les volants`);
  for (const [k, v] of Object.entries(st)) {
    if (KNOWN_STATS.has(k)) continue;
    if (typeof v === 'number' || typeof v === 'boolean') out.push(`${k} ${typeof v === 'number' ? fmt(v) : ''}`.trim());
  }
  return out;
}

function targetsOf(def) {
  const tg = def.targets ?? { ground: true, air: true };
  if (tg.ground && tg.air) return 'Sol et air';
  if (tg.air) return 'Air seulement';
  return 'Sol seulement (ignore les volants)';
}

// Capacités d'un yokai, en clair (clés inconnues comprises).
export function abilitiesOf(def, defs, absorbNow = null) {
  const ab = def.abilities || {};
  const name = (id) => esc(defs.enemies[id]?.name || id);
  const out = [];
  for (const [k, v] of Object.entries(ab)) {
    switch (k) {
      case 'armor':
        out.push(`Carapace : −${Math.round(v * 100)} % de dégâts subis`);
        break;
      case 'flying':
        if (v) out.push('Vole droit vers le sanctuaire : ignore le chemin et les pierres');
        break;
      case 'split':
        out.push(`Se divise en ${v.count} × ${name(v.into)} à sa mort`);
        break;
      case 'absorb':
        out.push(`Absorbe ${elementTag(absorbNow || v, defs)} : cet élément le soigne`);
        break;
      case 'healAura':
        out.push(`Soigne les yokai proches (${Math.round(v.amount * 100)} % de PV toutes les ${fmt(v.interval)} s)`);
        break;
      case 'summon':
        out.push(`Invoque ${v.count} × ${name(v.enemy)} toutes les ${fmt(v.interval)} s`);
        break;
      case 'cycleAbsorb':
        out.push(`Change d’élément absorbé toutes les ${fmt(v.interval)} s : ${(v.elements || []).map((e) => elementTag(e, defs)).join(' ')}`);
        break;
      case 'stomp':
        out.push(`Coup de massue : étourdit les lanternes à ${fmt(v.radius)} cases (${fmt(v.stun)} s)`);
        break;
      case 'enrage':
        out.push(`Enrage sous ${Math.round(v.below * 100)} % de PV : vitesse ×${fmt(v.speed)}`);
        break;
      default:
        out.push(esc(k));
    }
  }
  if (def.knockResist) out.push(`Résiste au recul (${Math.round(def.knockResist * 100)} %)`);
  if (def.stunResist) out.push(`Résiste aux étourdissements (${Math.round(def.stunResist * 100)} %)`);
  return out;
}

function speedWord(s) {
  if (s < 0.7) return 'très lent';
  if (s < 1.0) return 'lent';
  if (s < 1.5) return 'moyen';
  if (s < 2.2) return 'rapide';
  return 'très rapide';
}

// Combos d'un élément : [{ def, partner }].
function combosOf(el, defs) {
  const out = [];
  for (const c of defs.combos || []) {
    const els = c.elements || [];
    const i = els.indexOf(el);
    if (i < 0) continue;
    out.push({ def: c, partner: els[1 - i] ?? els[0] });
  }
  return out;
}

// Contre quoi un combo est utile : `def.counters` s'il existe, sinon les yokai dont
// la fiche le cite comme contre, sinon une indication tirée de son effet.
export function comboCounters(def, defs) {
  if (def.counters) return Array.isArray(def.counters) ? def.counters.join(', ') : def.counters;
  const norm = (s) => String(s || '').toLowerCase();
  const names = [];
  for (const [id, e] of Object.entries(defs.enemies || {})) {
    if (id.endsWith('_ko')) continue;
    if (norm(e.counters).includes(norm(def.name))) names.push(e.name);
  }
  if (names.length) return names.join(', ');
  const fx = def.effect || {};
  const st = fx.status || {};
  const hints = [];
  if (fx.kind === 'tornado') hints.push('volants et groupes');
  if (st.blind) hints.push('soigneuses, invocateurs, absorbeurs');
  if (st.stun) hints.push('yokai rapides et groupes');
  if (st.slow) hints.push('yokai rapides');
  if (st.burn) hints.push('yokai nombreux au sol');
  if (st.shred) hints.push('yokai blindés');
  return hints.join(', ') || '—';
}

// ───────────────────────── gestionnaire des fiches ─────────────────────────

export class Sheets {
  /**
   * @param {HTMLElement} el  #info
   * @param {object} h  game(), input, anchor(kind, data) → ordonnée page du sujet | null,
   *                    onOpen(kind), onClose(), onSell(t), onPriority(t),
   *                    onSelectTool(type), onRemoveStone(c, r), onCallWave(), onEnemy(type, absorb)
   */
  constructor(el, h) {
    this.el = el;
    this.h = h;
    this.cur = null;
    this.sig = null;
    this.confirm = false;
    el.addEventListener('click', (e) => this.onClick(e));
    // Le doigt qui a ouvert la fiche (appui long sur la palette) se relève parfois
    // au-dessus d'elle : son clic ne doit pas toucher un bouton (« Choisir »…).
    el.addEventListener('pointerdown', () => (this.armed = true), true);
    // le bas de la fiche s'estompe tant qu'il reste du contenu à faire défiler
    el.addEventListener('scroll', () => this.markMore(), true);
  }

  markMore() {
    const b = this.el.querySelector('.sheet-body');
    if (b) b.classList.toggle('more', b.scrollHeight - b.scrollTop - b.clientHeight > 4);
  }

  get isOpen() {
    return !!this.cur;
  }

  get game() {
    return this.h.game();
  }

  // kind : 'tower' (id) | 'type' (type) | 'enemy' ({ type, enemy, absorb }) | 'stone' ({ c, r }) | 'wave'
  open(kind, data) {
    this.cur = { kind, data };
    this.sig = null;
    this.confirm = false;
    this.armed = false;
    this.openedAt = performance.now();
    this.render(true);
    if (!this.cur) return; // la cible a disparu
    this.el.classList.remove('hidden', 'top');
    this.el.parentElement?.classList.add('sheet-open');
    this.el.parentElement?.classList.remove('sheet-top');
    this.el.scrollTop = 0;
    // La lanterne ou le yokai décrit serait caché sous la fiche (bas du plateau) :
    // la fiche passe en haut, sous la barre du haut.
    const ay = this.h.anchor?.(kind, data);
    // position de repos (offsetTop ignore l'animation d'entrée)
    const top = (this.el.offsetParent?.getBoundingClientRect().top ?? 0) + this.el.offsetTop;
    if (ay != null && ay > top - 8) {
      this.el.classList.add('top');
      this.el.parentElement?.classList.add('sheet-top');
    }
    this.h.onOpen?.(kind, data);
    requestAnimationFrame(() => this.syncHeight());
  }

  close() {
    if (!this.cur) return;
    this.cur = null;
    this.sig = null;
    this.el.classList.add('hidden');
    this.el.parentElement?.classList.remove('sheet-open', 'sheet-top');
    this.el.innerHTML = '';
    this.h.onClose?.();
  }

  // Hauteur de la fiche, pour placer les toasts au-dessus.
  syncHeight() {
    const root = this.el.parentElement;
    if (root && this.cur) root.style.setProperty('--sheet-h', `${this.el.offsetHeight}px`);
  }

  // Chaque frame : la fiche se reconstruit quand ce qu'elle montre change.
  update() {
    if (!this.cur) return;
    this.render(false);
  }

  // La lanterne affichée a fusionné : la fiche suit sa nouvelle identité.
  onEvent(ev) {
    if (!this.cur || this.cur.kind !== 'tower') return;
    if (ev.type === 'fuse' && (this.cur.data === ev.oldId || this.cur.data === ev.srcId)) {
      this.cur.data = ev.tower.id;
      this.sig = null;
    }
  }

  render(force) {
    const g = this.game;
    if (!g) return this.close();
    const { kind, data } = this.cur;
    let out = null;
    if (kind === 'tower') out = this.towerSheet(g, data);
    else if (kind === 'type') out = this.typeSheet(g, data);
    else if (kind === 'enemy') out = this.enemySheet(g, data);
    else if (kind === 'stone') out = this.stoneSheet(g, data);
    else if (kind === 'stoneTool') out = this.stoneToolSheet(g);
    else if (kind === 'wave') out = this.waveSheet(g);
    if (!out) {
      this.close();
      return;
    }
    if (!force && out.sig === this.sig) {
      out.live?.(this.el);
      return;
    }
    this.sig = out.sig;
    const body = this.el.querySelector('.sheet-body');
    const scroll = body ? body.scrollTop : 0;
    this.el.innerHTML =
      `<div class="sheet-head">${out.pic || ''}<div class="sheet-title"><h3>${out.title}</h3>${out.tags ? `<div class="sheet-tags">${out.tags}</div>` : ''}</div>${out.level ? `<span class="h3-level">${out.level}</span>` : ''}<button class="sheet-close" data-act="close" aria-label="Fermer la fiche">✕</button></div>` +
      `<div class="sheet-body scroll">${out.body}</div>` +
      (out.actions ? `<div class="sheet-actions">${out.actions}</div>` : '');
    const nb = this.el.querySelector('.sheet-body');
    if (nb && !force) nb.scrollTop = scroll;
    out.live?.(this.el);
    if (force) requestAnimationFrame(() => this.syncHeight());
    requestAnimationFrame(() => this.markMore());
  }

  onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b || !this.cur) return;
    if (!this.armed && performance.now() - this.openedAt < 800) return; // clic du doigt qui l'a ouverte
    const g = this.game;
    const { kind, data } = this.cur;
    const act = b.dataset.act;
    if (act === 'close') return this.close();
    if (act === 'prio' && kind === 'tower') {
      const t = g.towerById(data);
      if (t) this.h.onPriority?.(t);
    } else if (act === 'sell' && kind === 'tower') {
      const t = g.towerById(data);
      if (!t) return;
      if (!this.confirm) {
        this.confirm = true;
        this.sig = null;
        clearTimeout(this.confirmTimer);
        this.confirmTimer = setTimeout(() => {
          this.confirm = false;
          this.sig = null;
        }, 2600);
      } else {
        this.h.onSell?.(t);
        this.close();
        return;
      }
    } else if (act === 'choose' && (kind === 'type' || kind === 'stoneTool')) {
      if (b.classList.contains('disabled')) return;
      this.close();
      this.h.onSelectTool?.(kind === 'stoneTool' ? 'stone' : data);
      return;
    } else if (act === 'unstone' && kind === 'stone') {
      this.h.onRemoveStone?.(data.c, data.r);
      this.close();
      return;
    } else if (act === 'call') {
      this.close();
      this.h.onCallWave?.();
      return;
    } else if (act === 'enemy') {
      this.h.onEnemy?.(b.dataset.enemy, b.dataset.absorb || null);
      return;
    }
    this.render(false);
  }

  // ───────────── fiche d'une lanterne posée ─────────────

  towerSheet(g, id) {
    const t = g.towerById(id);
    if (!t) return null;
    const defs = g.defs;
    const def = defs.towers[t.type];
    const st = g.towerStats(t);
    const el = elementOf(t.type, defs);
    const info = elementInfo(el, defs);
    const max = g.maxLevelOf ? g.maxLevelOf(t.type) : def.levels.length;
    const next = t.level < max ? def.levels[t.level] : null;
    const zones = g.zones.filter((z) => z.a === t.id || z.b === t.id);
    const sell = g.sellValue(t);
    const p = priorityInfo(t.priority);
    // Fusion : une lanterne identique (même type, même niveau) glissée dessus.
    const twinCost = def.cost * Math.pow(2, t.level - 1);
    const twin = next ? g.towers.find((o) => o.id !== t.id && g.canFuse(o.id, t.id).ok) : null;
    const sig = `${t.id}|${t.level}|${t.priority}|${sell}|${zones.map((z) => z.key ?? z.def.id).join(',')}|${!!twin}|${this.confirm}`;
    const dps = dpsOf(st);
    const fx = effectsOf(st);
    const rows = [];
    rows.push(
      `<div class="stats"><span><i>Dégâts</i><b>${fmt(st.damage ?? 0)}</b></span><span><i>Cadence</i><b>${fmt(st.rate ?? 0)}/s</b></span><span><i>DPS</i><b>${fmt(Math.round(dps))}</b></span><span><i>Portée</i><b>${fmt(st.range ?? 0)}</b></span></div>`,
    );
    if (fx.length) rows.push(row('Effets', fx.join(' · ')));
    // ce qui change en jeu d'abord (combos, niveau suivant), puis le réglage et les rappels
    if (zones.length) {
      rows.push(
        row(
          'Combos',
          zones
            .map((z) => {
              const pid = z.a === t.id ? z.b : z.a;
              const other = g.towerById(pid) || g.echoes?.find((e) => e.id === pid);
              const pel = other ? elementOf(other.type, defs) : null;
              return `<span class="combo-line">${pel ? elementBadge(pel, defs, { size: 18 }) : ''}<span><b>${esc(z.def.kanji || '')} ${esc(z.def.name)}</b> — ${esc(z.def.desc)}</span></span>`;
            })
            .join(''),
        ),
      );
    } else {
      const poss = combosOf(el, defs).filter((c) => g.availableTowers.some((a) => elementOf(a, defs) === c.partner));
      if (poss.length) rows.push(row('Combos', `<span class="muted">Aucun. À côté d’une autre lanterne :</span> ${poss.map((c) => `<span class="combo-mini">${elementBadge(c.partner, defs, { size: 16, kanji: false })}${esc(c.def.name)}</span>`).join(' ')}`));
    }
    if (next) {
      const nd = dpsOf(next);
      const gains = [`Dégâts ${fmt(next.damage ?? 0)} (+${fmt((next.damage ?? 0) - (st.damage ?? 0))})`, `DPS ${Math.round(nd)} (+${Math.round(nd - dps)})`];
      if ((next.range ?? 0) !== (st.range ?? 0)) gains.push(`Portée ${fmt(next.range)}`);
      const newFx = effectsOf(next).filter((f) => !fx.some((o) => o.split(' ')[0] === f.split(' ')[0]));
      if (newFx.length) gains.push(`+ ${newFx.join(', ')}`);
      rows.push(row(`Niveau ${t.level + 1}`, gains.join(' · ')));
      rows.push(row('Fusion', `+ une lanterne identique N${t.level} (≈ ${twinCost} or)${twin ? ' · <b>une jumelle est posée</b> : glissez-la dessus' : ''}`));
    } else {
      rows.push(row('Niveau', 'Maximum atteint'));
    }
    rows.push(row('Priorité', `<b>${p.label}</b> <small>— vise ${esc(p.desc)}</small>`));
    rows.push(row('Cible', targetsOf(def)));
    rows.push(row('Vente', `${sell} or <small>(investi ${t.invested})</small>`));
    rows.push(fw(def.strength, def.weakness));
    rows.push(`<p class="sheet-desc">${esc(def.desc)}</p>`);
    return {
      sig,
      pic: `<span class="sheet-pic"><img alt="" src="${towerPortrait(def, t.level, 44)}"></span>`,
      title: esc(def.name),
      tags: `${elementBadge(el, defs, { size: 18 })}<span>${esc(info.label)}</span><span class="dot">·</span><span>${esc(def.role || '')}</span>`,
      level: `N${t.level}`,
      body: rows.join(''),
      actions: `<button class="btn prio" data-act="prio" aria-label="Priorité de ciblage : ${p.label}. Toucher pour changer"><span class="tb-ico">${p.kanji}</span>${p.label}</button><button class="btn sell${this.confirm ? ' confirm' : ''}" data-act="sell">${this.confirm ? 'Confirmer' : 'Vendre'} +${sell}</button>`,
    };
  }

  // ───────────── fiche d'un type de lanterne (palette, avant achat) ─────────────

  typeSheet(g, type) {
    const defs = g.defs;
    const def = defs.towers[type];
    if (!def) return null;
    const el = elementOf(type, defs);
    const info = elementInfo(el, defs);
    const st = def.levels[0];
    const max = g.maxLevelOf ? g.maxLevelOf(type) : def.levels.length;
    const poor = g.gold < def.cost;
    const sig = `${type}|${poor}`;
    const rows = [];
    rows.push(`<p class="sheet-desc">${esc(def.desc)}</p>`);
    rows.push(
      `<div class="stats"><span><i>Dégâts</i><b>${fmt(st.damage ?? 0)}</b></span><span><i>Cadence</i><b>${fmt(st.rate ?? 0)}/s</b></span><span><i>DPS</i><b>${Math.round(dpsOf(st))}</b></span><span><i>Portée</i><b>${fmt(st.range ?? 0)}</b></span></div>`,
    );
    rows.push(fw(def.strength, def.weakness));
    const fx = effectsOf(st);
    if (fx.length) rows.push(row('Effets', fx.join(' · ')));
    rows.push(row('Cible', targetsOf(def)));
    const evo = [];
    for (let l = 2; l <= max; l++) {
      const s = def.levels[l - 1];
      if (s) evo.push(`N${l} : DPS ${Math.round(dpsOf(s))}, portée ${fmt(s.range ?? 0)}`);
    }
    if (evo.length) rows.push(row('Fusion', `Deux lanternes identiques → niveau supérieur. ${evo.join(' · ')}`));
    const poss = combosOf(el, defs);
    if (poss.length) {
      rows.push(
        row(
          'Combos',
          poss
            .map((c) => `<span class="combo-line">${elementBadge(c.partner, defs, { size: 18 })}<span><b>${esc(c.def.kanji || '')} ${esc(c.def.name)}</b> — ${esc(c.def.desc)}</span></span>`)
            .join(''),
        ),
      );
    }
    return {
      sig,
      pic: `<span class="sheet-pic"><img alt="" src="${towerPortrait(def, 1, 44)}"></span>`,
      title: esc(def.name),
      tags: `${elementBadge(el, defs, { size: 18 })}<span>${esc(info.label)}</span><span class="dot">·</span><span>${esc(def.role || '')}</span>`,
      level: `${def.cost} or`,
      body: rows.join(''),
      actions: `<button class="btn${poor ? ' disabled' : ' primary'}" data-act="choose"${poor ? ' aria-disabled="true"' : ''}>${poor ? `Il manque ${Math.ceil(def.cost - g.gold)} or` : `Choisir · ${def.cost} or`}</button>`,
    };
  }

  // ───────────── fiche d'un yokai (appui long, aperçu de vague) ─────────────

  enemySheet(g, data) {
    const defs = g.defs;
    const def = defs.enemies[data.type];
    if (!def) return null;
    const inst = data.enemy || null;
    const e = inst && inst.alive && g.enemies.includes(inst) ? inst : null;
    const gone = !!inst && !e; // apaisé, ou parvenu au sanctuaire, depuis l'ouverture
    const absorb = e?.absorb ?? data.absorb ?? def.abilities?.absorb ?? null;
    const scale = g.level.hpScale ?? 1;
    const tags = [];
    if (def.boss) tags.push('<span class="tag boss">Boss</span>');
    if (def.abilities?.flying) tags.push('<span class="tag">Volant</span>');
    if (absorb) tags.push(`${elementBadge(absorb, defs, { size: 18 })}<span>absorbe ${esc(elementInfo(absorb, defs).label)}</span>`);
    const rows = [];
    if (e) rows.push(`<div class="hpbar" aria-label="Points de vie"><i style="width:${Math.max(0, (e.hp / e.maxHp) * 100).toFixed(1)}%"></i><span>${Math.ceil(e.hp)} / ${Math.ceil(e.maxHp)} PV</span></div>`);
    else if (gone) rows.push(`<div class="hpbar dead"><i style="width:0"></i><span>${inst.hp <= 0 ? 'Apaisé' : 'Parvenu au sanctuaire'}</span></div>`);
    rows.push(
      `<div class="stats"><span><i>PV</i><b>${Math.ceil(e ? e.maxHp : def.hp * scale)}</b></span><span><i>Vitesse</i><b>${fmt(def.speed)}</b></span><span><i>Sanctuaire</i><b>−${def.damage ?? 1}</b></span><span><i>Prime</i><b>${def.reward ?? 0}</b></span></div>`,
    );
    rows.push(row('Allure', `${fmt(def.speed)} case/s, ${speedWord(def.speed)}${scale !== 1 ? ` · PV ×${fmt(scale)} dans ce niveau` : ''} · −${def.damage ?? 1} vie${(def.damage ?? 1) > 1 ? 's' : ''} s’il passe`));
    const ab = abilitiesOf(def, defs, absorb);
    if (ab.length) rows.push(row('Capacités', ab.join('<br>')));
    rows.push(fw(def.strength, def.weakness));
    if (def.counters) rows.push(row('Contres', esc(def.counters)));
    rows.push(`<p class="sheet-desc">${esc(def.desc)}</p>`);
    const sig = `${data.type}|${absorb}|${!!e}|${gone}`;
    return {
      sig,
      pic: `<span class="sheet-pic enemy"><img alt="" src="${enemyPortrait(defs, data.type, absorb, 44)}"></span>`,
      title: esc(def.name),
      tags: tags.join(''),
      body: rows.join(''),
      // PV en direct, sans reconstruire la fiche
      live: e
        ? (root) => {
            const bar = root.querySelector('.hpbar');
            if (!bar) return;
            const txt = `${Math.max(0, Math.ceil(e.hp))} / ${Math.ceil(e.maxHp)} PV`;
            const span = bar.querySelector('span');
            if (span.textContent !== txt) {
              span.textContent = txt;
              bar.querySelector('i').style.width = `${Math.max(0, (e.hp / e.maxHp) * 100).toFixed(1)}%`;
            }
            if (!e.alive) bar.classList.add('dead');
          }
        : null,
    };
  }

  // ───────────── pierre posée ─────────────

  stoneSheet(g, { c, r }) {
    const grid = g.grid;
    if (!grid.inBounds(c, r) || !grid.stone[grid.idx(c, r)]) return null;
    const refund = Math.floor(g.stoneCost() * (g.rules.stoneRefund ?? 0.5));
    const conf = g.stoneConf?.();
    const left = g.stonesLeft();
    return {
      sig: `${c},${r}|${left}`,
      pic: '<span class="sheet-pic stone">石</span>',
      title: 'Pierre',
      tags: `<span>${left}${conf ? `/${conf.max}` : ''} restante${left > 1 ? 's' : ''}</span>`,
      body: `<p class="sheet-desc">Elle détourne les yokai terrestres et allonge leur chemin. Les volants l’ignorent.</p>${row('Retirer', `rend ${refund} or et une pierre`)}`,
      actions: `<button class="btn" data-act="unstone">Retirer +${refund}</button>`,
    };
  }

  // ───────────── outil pierre (appui long sur la palette) ─────────────

  stoneToolSheet(g) {
    if (!g.level.stones) return null;
    const conf = g.stoneConf?.();
    const left = g.stonesLeft();
    const refund = Math.floor(g.stoneCost() * (g.rules.stoneRefund ?? 0.5));
    const poor = g.gold < g.stoneCost();
    return {
      sig: `${left}|${poor}`,
      pic: '<span class="sheet-pic stone">石</span>',
      title: 'Pierre',
      tags: `<span>${left}${conf ? `/${conf.max}` : ''} restante${left > 1 ? 's' : ''}</span><span class="dot">·</span><span>${g.stoneCost()} or</span>`,
      body:
        `<p class="sheet-desc">Posée sur le gravier ouvert, elle détourne les yokai terrestres et allonge leur chemin. Glissez-la : le nouveau tracé s’affiche avant de relâcher.</p>` +
        row('Règle', 'Le chemin ne peut jamais être coupé. Les volants l’ignorent.') +
        row('Retirer', `toucher une pierre posée : +${refund} or, la pierre revient`),
      actions: `<button class="btn${poor || left <= 0 ? ' disabled' : ' primary'}" data-act="choose"${poor || left <= 0 ? ' aria-disabled="true"' : ''}>${left <= 0 ? 'Plus de pierres' : poor ? `Il manque ${Math.ceil(g.stoneCost() - g.gold)} or` : `Choisir · ${g.stoneCost()} or`}</button>`,
    };
  }

  // ───────────── vague suivante (toute la composition) ─────────────

  waveSheet(g) {
    const pv = g.nextWavePreview ? g.nextWavePreview() : null;
    if (!pv) return null;
    const defs = g.defs;
    const canCall = g.state === 'build' || (typeof g.canCallNextWave === 'function' && g.canCallNextWave());
    const list = pv.groups
      .map((gr) => {
        const def = defs.enemies[gr.enemy];
        if (!def) return '';
        const absorb = gr.absorb ?? def.abilities?.absorb ?? null;
        return `<button class="wave-line" data-act="enemy" data-enemy="${gr.enemy}" data-absorb="${absorb || ''}"><img alt="" src="${enemyPortrait(defs, gr.enemy, absorb, 36)}"><b>${gr.count} ×</b><span>${esc(def.name)}</span>${absorb ? elementBadge(absorb, defs, { size: 18 }) : ''}</button>`;
      })
      .join('');
    const cd = pv.countdown != null ? `${Math.max(0, Math.ceil(pv.countdown))} s` : null;
    const sig = `${pv.index}|${cd}|${pv.bonus}|${canCall}`;
    return {
      sig,
      pic: `<span class="sheet-pic stone">${pv.climax ? '嵐' : '波'}</span>`,
      title: `Vague ${pv.index + 1}/${g.totalWaves}`,
      tags: `${pv.climax ? '<span class="tag boss">Climax</span>' : ''}${cd ? `<span>dans ${cd}</span>` : ''}${pv.bonus > 0 ? `<span class="dot">·</span><span>appel anticipé +${pv.bonus} or</span>` : ''}`,
      body: `<div class="wave-list">${list}</div>`,
      actions: canCall ? `<button class="btn primary" data-act="call">${g.waveIndex < 0 ? 'Commencer' : 'Lancer maintenant'}${pv.bonus > 0 ? ` · +${pv.bonus} or` : ''}</button>` : '',
    };
  }
}

function row(label, html) {
  return `<div class="sheet-row"><i>${label}</i><span>${html}</span></div>`;
}

function fw(strength, weakness) {
  if (!strength && !weakness) return '';
  return `<div class="fw">${strength ? `<span class="fw-plus"><i>Force</i>${esc(strength)}</span>` : ''}${weakness ? `<span class="fw-minus"><i>Faiblesse</i>${esc(weakness)}</span>` : ''}</div>`;
}

// ───────────────────────── table des combos (pause) ─────────────────────────

// Matrice des éléments : chaque case donne le combo de la paire (kanji + nom) ;
// la case touchée détaille son effet et contre quoi il sert.
export function comboTable(defs, available) {
  const els = elementList(defs, available).filter((e) => (defs.combos || []).some((c) => c.elements?.includes(e)));
  const find = (a, b) => (defs.combos || []).find((c) => c.elements?.includes(a) && c.elements?.includes(b) && (a !== b || c.elements[0] === c.elements[1]));
  const avail = new Set((available || []).map((t) => elementOf(t, defs)));
  let html = `<div class="combo-table" style="--n:${els.length}" role="grid"><span class="ct-corner"></span>`;
  for (const e of els) html += `<span class="ct-head${avail.size && !avail.has(e) ? ' off' : ''}">${elementBadge(e, defs, { size: 22 })}<small>${esc(elementInfo(e, defs).label)}</small></span>`;
  for (const a of els) {
    html += `<span class="ct-head row${avail.size && !avail.has(a) ? ' off' : ''}">${elementBadge(a, defs, { size: 22 })}<small>${esc(elementInfo(a, defs).label)}</small></span>`;
    for (const b of els) {
      const c = a === b ? null : find(a, b);
      if (!c) html += '<span class="ct-cell empty">—</span>';
      else html += `<button class="ct-cell" data-combo="${esc(c.id)}" style="--c:${c.color || '#c99a2e'}" aria-label="${esc(c.name)}"><b>${esc(c.kanji || '')}</b><small>${esc(c.name)}</small></button>`;
    }
  }
  html += '</div><div class="ct-detail" aria-live="polite"></div>';
  return html;
}

export function comboDetail(defs, id) {
  const c = (defs.combos || []).find((x) => x.id === id);
  if (!c) return '';
  const [a, b] = c.elements || [];
  return `<div class="ct-name"><b>${esc(c.kanji || '')} ${esc(c.name)}</b> ${a ? elementTag(a, defs) : ''} + ${b ? elementTag(b, defs) : ''}</div><p>${esc(c.desc)}</p><p><i>Contre</i> ${esc(comboCounters(c, defs))}</p>`;
}

export { fmt, esc };
