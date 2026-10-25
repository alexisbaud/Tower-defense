// Fiches compactes : lanterne posée, type de lanterne (avant achat), yokai, pierre,
// vague suivante. Elles prennent la place de la barre du bas (le plateau reste
// visible) et se ferment d'un toucher sur le plateau. Tout se lit dans les données.
// Le module fournit aussi la table des combos (menu de pause).
import { elementOf, elementInfo, elementBadge, elementTag, elementList } from './elements.js';
import { enemyPortrait, towerPortrait } from './portraits.js';
import { priorityInfo, aims } from './towerbar.js';
import { earlyCharge } from './wavepreview.js';
import { commands } from './commands.js';

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const fmt = (n) => nf.format(Math.round(n * 100) / 100);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ───────────────────────── calculs d'affichage ─────────────────────────

// Comportement d'attaque d'une lanterne (cf. game.attackOf).
export function attackOf(def) {
  return def?.attack ?? (def?.projectile === 'boulder' ? 'lob' : 'projectile');
}

// Dégâts par seconde sur une cible (tir + brûlure ; aura : brûlure continue).
// `rateMult` : bonus de cadence reçu d'un Carillon.
export function dpsOf(st, def = null, rateMult = 1) {
  if (!st) return 0;
  const a = attackOf(def);
  if (a === 'support' || a === 'barrier') return 0;
  if (a === 'aura') return st.auraDps ?? 0;
  return (st.damage ?? 0) * (st.rate ?? 0) * rateMult + (st.burn?.dps ?? 0);
}

const KNOWN_STATS = new Set([
  'range', 'rate', 'damage', 'projectileSpeed', 'burn', 'slow', 'knockback', 'splash', 'pierce', 'stun', 'airMultiplier',
  'armorBreak', 'auraDps', 'width', 'heal', 'rateBonus', 'cleanse', 'barrierHp', 'respawn', 'thorns',
]);

// Effets d'un niveau de lanterne, en clair (les clés inconnues restent affichées).
export function effectsOf(st) {
  const out = [];
  if (!st) return out;
  if (st.auraDps) out.push(`Brûle tout à portée : ${fmt(st.auraDps)}/s (ignore l’armure)`);
  if (st.burn) out.push(`Brûlure ${fmt(st.burn.dps)}/s pendant ${fmt(st.burn.duration)} s`);
  if (st.slow) out.push(`Ralentit de ${Math.round((1 - st.slow.factor) * 100)} % (${fmt(st.slow.duration)} s)`);
  if (st.knockback) out.push(`Recul ${fmt(st.knockback)} case`);
  if (st.splash) out.push(`Zone ${fmt(st.splash)} case`);
  if (st.width) out.push(`Jet perçant : toute la file (${fmt(st.width * 2)} case de large)`);
  if (st.pierce) out.push(st.pierce >= 1 ? 'Ignore l’armure' : `Perce ${Math.round(st.pierce * 100)} % de l’armure`);
  if (st.armorBreak) out.push(`Brise l’armure ${fmt(st.armorBreak)} s`);
  if (st.stun) out.push(`Étourdit ${fmt(st.stun)} s`);
  if (st.airMultiplier && st.airMultiplier !== 1) out.push(`×${fmt(st.airMultiplier)} contre les volants`);
  if (st.rateBonus) out.push(`Lanternes voisines : cadence +${Math.round(st.rateBonus * 100)} %`);
  if (st.heal) out.push(`Répare les murs : ${fmt(st.heal)} PV/s`);
  if (st.cleanse) out.push(`Étourdissements des voisines −${Math.round(st.cleanse * 100)} %`);
  if (st.barrierHp) out.push(`Mur de ${fmt(st.barrierHp)} PV, relevé en ${fmt(st.respawn ?? 6)} s`);
  if (st.thorns) out.push(`Épines : ${fmt(st.thorns)} dégâts/s à qui frappe le mur`);
  for (const [k, v] of Object.entries(st)) {
    if (KNOWN_STATS.has(k)) continue;
    if (typeof v === 'number' || typeof v === 'boolean') out.push(`${k} ${typeof v === 'number' ? fmt(v) : ''}`.trim());
  }
  return out;
}

function targetsOf(def) {
  const a = attackOf(def);
  if (a === 'support') return 'Aucune : soutient les lanternes et les murs voisins';
  if (a === 'barrier') return 'Aucune : dresse un mur sur le chemin (les volants passent au-dessus)';
  const tg = def.targets ?? { ground: true, air: true };
  if (tg.ground && tg.air) return 'Sol et air';
  if (tg.air) return 'Air seulement';
  return 'Sol seulement (ignore les volants)';
}

// Comment la lanterne traite l'armure (pierce, brise-armure, brûlure qui l'ignore).
function armorOf(def, st) {
  const a = attackOf(def);
  if (a === 'support' || a === 'barrier') return null;
  const parts = [];
  if (a === 'aura') parts.push('ignore l’armure (brûlure continue)');
  else if (st.pierce >= 1) parts.push('ignore l’armure');
  else if (st.pierce) parts.push(`perce ${Math.round(st.pierce * 100)} %`);
  if (st.armorBreak) parts.push(`la brise ${fmt(st.armorBreak)} s (les autres lanternes en profitent)`);
  if (st.burn && a !== 'aura') parts.push('sa brûlure l’ignore');
  if (!parts.length) parts.push('aucun perce-armure : les carapaces encaissent les petits coups');
  return parts.join(' · ');
}

// Rangée de chiffres clés, selon le comportement de la lanterne.
function statsRow(def, st, rateMult = 1) {
  const a = attackOf(def);
  const cell = (k, v) => `<span><i>${k}</i><b>${v}</b></span>`;
  const cells = [];
  if (a === 'support') {
    if (st.rateBonus) cells.push(cell('Cadence', `+${Math.round(st.rateBonus * 100)} %`));
    if (st.heal) cells.push(cell('Soin', `${fmt(st.heal)}/s`));
    if (st.cleanse) cells.push(cell('Purifie', `${Math.round(st.cleanse * 100)} %`));
  } else if (a === 'barrier') {
    cells.push(cell('Mur', `${fmt(st.barrierHp ?? 0)} PV`));
    cells.push(cell('Relevé', `${fmt(st.respawn ?? 6)} s`));
    if (st.thorns) cells.push(cell('Épines', `${fmt(st.thorns)}/s`));
  } else if (a === 'aura') {
    cells.push(cell('Aura', `${fmt(st.auraDps ?? 0)}/s`));
    cells.push(cell('Cibles', 'toutes'));
  } else {
    cells.push(cell('Dégâts', fmt(st.damage ?? 0)));
    cells.push(cell('Cadence', `${fmt((st.rate ?? 0) * rateMult)}/s`));
    cells.push(cell('DPS', fmt(Math.round(dpsOf(st, def, rateMult)))));
  }
  cells.push(cell('Portée', fmt(st.range ?? 0)));
  return `<div class="stats">${cells.join('')}</div>`;
}

// Socles gravés de l'élément dans ce niveau (un socle gravé n'accepte que son élément).
function slotsRow(g, el) {
  const grid = g.grid;
  if (!grid.slotElement?.some(Boolean)) return '';
  let own = 0;
  let universal = 0;
  for (let i = 0; i < grid.size; i++) {
    if (grid.type(i) !== 3) continue; // T.SLOT
    const se = grid.slotElement[i];
    if (!se) universal++;
    else if (se === el) own++;
  }
  const defs = g.defs;
  return row('Socles', `${universal} universel${universal > 1 ? 's' : ''} et ${own} gravé${own > 1 ? 's' : ''} ${elementBadge(el, defs, { size: 16 })}. <small>Un socle gravé n’accepte que son élément.</small>`);
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
      case 'hop':
        out.push(`Saute par-dessus les murs (toutes les ${fmt(v.interval)} s ; pas s’il est aveuglé)`);
        break;
      case 'timeless':
        if (v) out.push('Hors du temps : le Rembobinage ne le ramène pas, le recul ne le repousse pas');
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
   *                    onSelectTool(type), onRemoveStone(c, r), onCallWave(), onEnemy(type, absorb),
   *                    onRally(t)
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
  //        | 'element' (élément) | 'rewind' (règle du Rembobinage)
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
    else if (kind === 'element') out = this.elementSheet(g, data);
    else if (kind === 'rewind') out = this.rewindSheet(g);
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
    } else if (act === 'rally' && kind === 'tower') {
      const t = g.towerById(data);
      if (!t) return;
      this.close();
      this.h.onRally?.(t);
      return;
    } else if (act === 'type') {
      this.open('type', b.dataset.type);
      return;
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
    const atk = attackOf(def);
    const max = g.maxLevelOf ? g.maxLevelOf(t.type) : def.levels.length;
    const next = t.level < max ? def.levels[t.level] : null;
    const zones = g.zones.filter((z) => z.a === t.id || z.b === t.id);
    const sell = g.sellValue(t);
    // priorité demandée (commande en attente comprise)
    const p = priorityInfo(commands.priorityOf(t) ?? t.priority);
    const rateMult = t.rateMult || 1;
    const cleanse = t.cleanse || 0;
    const bar = atk === 'barrier' ? (g.barriers || []).find((b) => b.towerId === t.id) : null;
    // Fusion : une lanterne identique (même type, même niveau) glissée dessus.
    const twinCost = def.cost * Math.pow(2, t.level - 1);
    const twin = next ? g.towers.find((o) => o.id !== t.id && g.canFuse(o.id, t.id).ok) : null;
    const sig = `${t.id}|${t.level}|${p.label}|${sell}|${zones.map((z) => z.key ?? z.def.id).join(',')}|${!!twin}|${this.confirm}|${rateMult.toFixed(2)}|${cleanse.toFixed(2)}|${bar ? `${bar.id}:${bar.alive}` : ''}`;
    const dps = dpsOf(st, def, rateMult);
    const fx = effectsOf(st);
    const rows = [];
    // en coopération, la lanterne d'un autre joueur se consulte seulement
    const mine = !(g.players?.length > 1) || t.owner === g.localPlayer;
    if (g.players?.length > 1) {
      const o = this.h.owner?.(t.owner);
      const name = o?.name ?? g.players[t.owner]?.name ?? '?';
      const seal = o?.element ? elementBadge(o.element, defs, { size: 18 }) : `<span class="seal-any" style="--s:18px" aria-hidden="true">${esc(o?.initial ?? '?')}</span>`;
      rows.push(row('Joueur', `<span class="sheet-owner">${seal}<b>${esc(name)}</b>${mine ? ' <small>(vous)</small>' : ' <small>— ni vente ni fusion</small>'}</span>`));
    }
    rows.push(statsRow(def, st, rateMult));
    // Mur du Gardien : PV en direct (voir `live`).
    if (atk === 'barrier') {
      if (bar) rows.push(`<div class="hpbar wall${bar.alive ? '' : ' dead'}" aria-label="PV du mur"><i style="width:${bar.alive ? Math.max(0, (bar.hp / bar.maxHp) * 100).toFixed(1) : 0}%"></i><span>${wallText(bar)}</span></div>`);
      else rows.push(`<div class="hpbar wall dead"><i style="width:0"></i><span>Aucune case de chemin à portée</span></div>`);
    }
    if (fx.length) rows.push(row('Effets', fx.join(' · ')));
    // Soutien reçu : Carillon (cadence) et Source sacrée (purification).
    const support = [];
    if (rateMult > 1.001) support.push(`<b>Carillon</b> : cadence +${Math.round((rateMult - 1) * 100)} %`);
    if (cleanse > 0.001) support.push(`<b>Source</b> : étourdissements −${Math.round(cleanse * 100)} %`);
    if (support.length) rows.push(row('Soutien', support.join(' · ')));
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
      const gains = [];
      if (atk === 'barrier') gains.push(`Mur ${fmt(next.barrierHp ?? 0)} PV (+${fmt((next.barrierHp ?? 0) - (st.barrierHp ?? 0))})`);
      else if (atk === 'support') {
        if (next.rateBonus) gains.push(`Cadence +${Math.round(next.rateBonus * 100)} %`);
        if (next.heal) gains.push(`Soin ${fmt(next.heal)}/s`);
      } else {
        const nd = dpsOf(next, def, rateMult);
        if (atk !== 'aura') gains.push(`Dégâts ${fmt(next.damage ?? 0)} (+${fmt((next.damage ?? 0) - (st.damage ?? 0))})`);
        gains.push(`DPS ${Math.round(nd)} (+${Math.round(nd - dps)})`);
      }
      if ((next.range ?? 0) !== (st.range ?? 0)) gains.push(`Portée ${fmt(next.range)}`);
      const newFx = effectsOf(next).filter((f) => !fx.some((o) => o.split(' ')[0] === f.split(' ')[0]));
      if (newFx.length) gains.push(`+ ${newFx.join(', ')}`);
      rows.push(row(`Niveau ${t.level + 1}`, gains.join(' · ')));
      rows.push(row('Fusion', `+ une lanterne identique N${t.level} (≈ ${twinCost} or)${twin ? ' · <b>une jumelle est posée</b> : glissez-la dessus' : ''}`));
    } else {
      rows.push(row('Niveau', 'Maximum atteint'));
    }
    if (aims(def)) rows.push(row('Priorité', `<b>${p.label}</b> <small>— vise ${esc(p.desc)}</small>`));
    rows.push(row('Élément', `${elementTag(el, defs)}${info.style ? ` <small>— ${esc(info.style)}</small>` : ''}`));
    rows.push(row('Cibles', targetsOf(def)));
    const armor = armorOf(def, st);
    if (armor) rows.push(row('Armure', armor));
    rows.push(row('Vente', `${sell} or <small>(investi ${t.invested})</small>`));
    rows.push(fw(def.strength, def.weakness));
    rows.push(`<p class="sheet-desc">${esc(def.desc)}</p>`);
    let first = '';
    if (atk === 'barrier') first = `<button class="btn rally" data-act="rally"${bar ? '' : ' disabled'}><span class="tb-ico">壁</span>Déplacer le mur</button>`;
    else if (aims(def)) first = `<button class="btn prio" data-act="prio" aria-label="Priorité de ciblage : ${p.label}. Toucher pour changer"><span class="tb-ico">${p.kanji}</span>${p.label}</button>`;
    return {
      sig,
      pic: `<span class="sheet-pic"><img alt="" src="${towerPortrait(def, t.level, 44)}"></span>`,
      title: esc(def.name),
      tags: `${elementBadge(el, defs, { size: 18 })}<span>${esc(info.label)}</span><span class="dot">·</span><span>${esc(def.role || '')}</span>`,
      level: `N${t.level}`,
      body: rows.join(''),
      actions: mine ? `${first}<button class="btn sell${this.confirm ? ' confirm' : ''}" data-act="sell">${this.confirm ? 'Confirmer' : 'Vendre'} +${sell}</button>` : '',
      // PV du mur en direct, sans reconstruire la fiche
      live: bar
        ? (root) => {
            const hb = root.querySelector('.hpbar.wall');
            if (!hb) return;
            const txt = wallText(bar);
            const span = hb.querySelector('span');
            if (span.textContent !== txt) {
              span.textContent = txt;
              hb.querySelector('i').style.width = `${bar.alive ? Math.max(0, (bar.hp / bar.maxHp) * 100).toFixed(1) : 0}%`;
              hb.classList.toggle('dead', !bar.alive);
            }
          }
        : null,
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
    const atk = attackOf(def);
    const max = g.maxLevelOf ? g.maxLevelOf(type) : def.levels.length;
    // or disponible : celui des constructions en cours est déjà promis
    const poor = commands.spendable() < def.cost;
    // coopération : une lanterne d'un autre élément se consulte, ne se choisit pas
    const mine = g.availableTowers.includes(type);
    const sig = `${type}|${poor}|${mine}`;
    const rows = [];
    rows.push(`<p class="sheet-desc">${esc(def.desc)}</p>`);
    rows.push(statsRow(def, st));
    rows.push(fw(def.strength, def.weakness));
    const fx = effectsOf(st);
    if (fx.length) rows.push(row('Effets', fx.join(' · ')));
    rows.push(row('Cibles', targetsOf(def)));
    const armor = armorOf(def, st);
    if (armor) rows.push(row('Armure', armor));
    rows.push(slotsRow(g, el));
    const evo = [];
    for (let l = 2; l <= max; l++) {
      const s = def.levels[l - 1];
      if (!s) continue;
      if (atk === 'barrier') evo.push(`N${l} : mur ${fmt(s.barrierHp ?? 0)} PV`);
      else if (atk === 'support') evo.push(`N${l} : ${effectsOf(s).slice(0, 2).join(', ')}`);
      else evo.push(`N${l} : DPS ${Math.round(dpsOf(s, def))}, portée ${fmt(s.range ?? 0)}`);
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
    const forbid = g.challengeRule?.forbidTowers?.includes(type);
    return {
      sig,
      pic: `<span class="sheet-pic"><img alt="" src="${towerPortrait(def, 1, 44)}"></span>`,
      title: esc(def.name),
      tags: `${elementBadge(el, defs, { size: 18 })}<span>${esc(info.label)}</span><span class="dot">·</span><span>${esc(def.role || '')}</span>`,
      level: `${def.cost} or`,
      body: rows.join(''),
      actions: forbid
        ? '<button class="btn disabled" aria-disabled="true">Interdit par le défi</button>'
        : !mine
          ? `<button class="btn disabled" aria-disabled="true">Élément d’un autre joueur</button>`
          : `<button class="btn${poor ? ' disabled' : ' primary'}" data-act="choose"${poor ? ' aria-disabled="true"' : ''}>${poor ? `Il manque ${commands.missing(type)} or` : `Choisir · ${def.cost} or`}</button>`,
    };
  }

  // ───────────── fiche d'un élément (appui long sur un onglet de la palette) ─────────────

  elementSheet(g, el) {
    const defs = g.defs;
    const info = elementInfo(el, defs);
    const list = g.availableTowers.filter((t) => elementOf(t, defs) === el);
    if (!list.length) return null;
    const lines = list
      .map((t) => {
        const d = defs.towers[t];
        return `<button class="wave-line" data-act="type" data-type="${esc(t)}"><img alt="" src="${towerPortrait(d, 1, 36)}"><span><b>${esc(d.name)}</b> <small>— ${esc(d.role || '')}</small></span><b>${d.cost} or</b></button>`;
      })
      .join('');
    const rows = [];
    if (info.desc) rows.push(`<p class="sheet-desc">${esc(info.desc)}</p>`);
    rows.push(`<div class="wave-list">${lines}</div>`);
    rows.push(slotsRow(g, el));
    if (el === 'earth' && g.stoneConf?.()) rows.push(row('Pierres', 'La Terre façonne le chemin : en coopération, seul le joueur de la Terre pose des pierres.'));
    return {
      sig: `${el}|${list.join(',')}`,
      pic: `<span class="sheet-pic el">${elementBadge(el, defs, { size: 34 })}</span>`,
      title: esc(info.label),
      tags: `<span>${esc(info.style || '')}</span><span class="dot">·</span><span>${list.length} lanterne${list.length > 1 ? 's' : ''}</span>`,
      body: rows.join(''),
    };
  }

  // ───────────── règle du Rembobinage (appui long sur la jauge) ─────────────

  rewindSheet(g) {
    if (!g.rewindEnabled) return null;
    const pct = Math.round((g.rewindRatio ? g.rewindRatio() : 0) * 100);
    return {
      sig: `${pct}|${g.canRewind?.()}`,
      pic: '<span class="sheet-pic stone">巻</span>',
      title: 'Rembobinage',
      tags: `<span>Jauge ${pct} %</span>${g.canRewind?.() ? '<span class="dot">·</span><span>prête</span>' : ''}`,
      body: rewindRules(g),
      actions: '',
      live: (root) => {
        const t = root.querySelector('.sheet-tags span');
        const txt = `Jauge ${Math.round((g.rewindRatio ? g.rewindRatio() : 0) * 100)} %`;
        if (t && t.textContent !== txt) t.textContent = txt;
      },
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
    const scale = g.hpScale ?? g.level.hpScale ?? 1;
    const ab = def.abilities || {};
    const tags = [];
    if (def.boss) tags.push('<span class="tag boss">Boss</span>');
    if (ab.flying) tags.push('<span class="tag">Volant</span>');
    if (ab.timeless) tags.push('<span class="tag">Hors du temps</span>');
    if (absorb) tags.push(`${elementBadge(absorb, defs, { size: 18 })}<span>absorbe ${esc(elementInfo(absorb, defs).label)}</span>`);
    const rows = [];
    if (e) rows.push(`<div class="hpbar" aria-label="Points de vie"><i style="width:${Math.max(0, (e.hp / e.maxHp) * 100).toFixed(1)}%"></i><span>${Math.ceil(e.hp)} / ${Math.ceil(e.maxHp)} PV</span></div>`);
    else if (gone) rows.push(`<div class="hpbar dead"><i style="width:0"></i><span>${inst.hp <= 0 ? 'Apaisé' : 'Parvenu au sanctuaire'}</span></div>`);
    if (e) rows.push(`<p class="enemy-state" aria-live="polite">${enemyState(g, e)}</p>`);
    const armor = def.armor ?? 0;
    const cells = [`<span><i>PV</i><b>${Math.ceil(e ? e.maxHp : def.hp * scale)}</b></span>`, `<span><i>Vitesse</i><b>${fmt(def.speed)}</b></span>`];
    // quatre chiffres clés au plus (une rangée) : l'armure prend la place de la prime
    if (armor) cells.push(`<span><i>Armure</i><b>${fmt(armor)}</b></span>`);
    cells.push(`<span><i>Sanctuaire</i><b>−${def.damage ?? 1}</b></span>`);
    if (!armor) cells.push(`<span><i>Prime</i><b>${def.reward ?? 0}</b></span>`);
    rows.push(`<div class="stats">${cells.join('')}</div>`);
    rows.push(row('Allure', `${fmt(def.speed)} case/s, ${speedWord(def.speed)}${scale !== 1 ? ` · PV ×${fmt(scale)} dans ce niveau` : ''} · −${def.damage ?? 1} vie${(def.damage ?? 1) > 1 ? 's' : ''} s’il passe${armor ? ` · prime ${def.reward ?? 0} or` : ''}`));
    if (armor) {
      const min = Math.round((g.rules.armorMinDamage ?? 0.2) * 100);
      rows.push(row('Armure', `${fmt(armor)} retranchés de chaque coup (au moins ${min} % passe). Perce-armure, brûlures et auras la contournent ; un brise-armure l’annule.`));
    }
    const res = resistList(def, defs);
    if (res) rows.push(row('Résistances', res));
    rows.push(row('Murs', wallLine(def)));
    const abl = abilitiesOf(def, defs, absorb);
    if (abl.length) rows.push(row('Capacités', abl.join('<br>')));
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
      // PV et état en direct, sans reconstruire la fiche
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
            const stEl = root.querySelector('.enemy-state');
            const st = enemyState(g, e);
            if (stEl && stEl.innerHTML !== st) stEl.innerHTML = st;
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
    const canStone = typeof g.canUseStones === 'function' ? g.canUseStones() : true;
    // en coopération, seul celui qui a posé (et payé) la pierre la retire
    const owner = g.stoneOwner?.[grid.idx(c, r)] ?? -1;
    const mine = !(g.players?.length > 1 && owner >= 0 && owner !== g.localPlayer);
    const canRemove = canStone && mine;
    const ownerName = !mine ? g.players[owner]?.name : null;
    return {
      sig: `${c},${r}|${left}|${canStone}|${owner}`,
      pic: '<span class="sheet-pic stone">石</span>',
      title: 'Pierre',
      tags: `<span>${left}${conf ? `/${conf.max}` : ''} restante${left > 1 ? 's' : ''}</span>`,
      body: `<p class="sheet-desc">Elle détourne les yokai terrestres et allonge leur chemin. Les volants l’ignorent.</p>${
        canRemove ? row('Retirer', `rend ${refund} or et une pierre`) : !canStone ? row('Retirer', 'réservé au joueur de la Terre') : row('Retirer', `réservé à ${esc(ownerName || 'celui qui l’a posée')}`)
      }`,
      // en coopération, seul le joueur de la Terre façonne le chemin
      actions: canRemove ? `<button class="btn" data-act="unstone">Retirer +${refund}</button>` : '',
    };
  }

  // ───────────── outil pierre (appui long sur la palette) ─────────────

  stoneToolSheet(g) {
    if (!g.level.stones) return null;
    const conf = g.stoneConf?.();
    const left = commands.stonesLeft(); // celles en construction déduites
    const refund = Math.floor(g.stoneCost() * (g.rules.stoneRefund ?? 0.5));
    const poor = commands.spendable() < g.stoneCost();
    const canStone = typeof g.canUseStones === 'function' ? g.canUseStones() : true;
    return {
      sig: `${left}|${poor}|${canStone}`,
      pic: '<span class="sheet-pic stone">石</span>',
      title: 'Pierre',
      tags: `<span>${left}${conf ? `/${conf.max}` : ''} restante${left > 1 ? 's' : ''}</span><span class="dot">·</span><span>${g.stoneCost()} or</span>`,
      body:
        `<p class="sheet-desc">Posée sur le gravier ouvert, elle détourne les yokai terrestres et allonge leur chemin. Glissez-la : le nouveau tracé s’affiche avant de relâcher.</p>` +
        row('Règle', 'Le chemin ne peut jamais être coupé. Les volants l’ignorent.') +
        row('Retirer', `toucher une pierre posée : +${refund} or, la pierre revient`),
      actions: !canStone
        ? '<button class="btn disabled" aria-disabled="true">Réservé à la Terre</button>'
        : `<button class="btn${poor || left <= 0 ? ' disabled' : ' primary'}" data-act="choose"${poor || left <= 0 ? ' aria-disabled="true"' : ''}>${left <= 0 ? 'Plus de pierres' : poor ? `Il manque ${commands.missing('stone')} or` : `Choisir · ${g.stoneCost()} or`}</button>`,
    };
  }

  // ───────────── vague suivante (toute la composition) ─────────────

  waveSheet(g) {
    const pv = g.nextWavePreview ? g.nextWavePreview() : null;
    if (!pv) return null;
    const defs = g.defs;
    const canCall = commands.check('startNextWave').ok;
    const list = pv.groups
      .map((gr) => {
        const def = defs.enemies[gr.enemy];
        if (!def) return '';
        const absorb = gr.absorb ?? def.abilities?.absorb ?? null;
        return `<button class="wave-line" data-act="enemy" data-enemy="${gr.enemy}" data-absorb="${absorb || ''}"><img alt="" src="${enemyPortrait(defs, gr.enemy, absorb, 36)}"><b>${gr.count} ×</b><span>${esc(def.name)}</span>${absorb ? elementBadge(absorb, defs, { size: 18 }) : ''}</button>`;
      })
      .join('');
    const cd = pv.countdown != null ? `${Math.max(0, Math.ceil(pv.countdown))} s` : null;
    const charge = earlyCharge(g, pv);
    const sig = `${pv.index}|${cd}|${pv.bonus}|${charge}|${canCall}`;
    const gains = [pv.bonus > 0 ? `+${pv.bonus} or` : '', charge > 0 ? `+${charge} 巻` : ''].filter(Boolean).join(' · ');
    const first = g.waveIndex < 0;
    return {
      sig,
      pic: `<span class="sheet-pic stone${pv.climax ? ' climax' : ''}">${pv.climax ? '嵐' : '波'}</span>`,
      title: `${pv.name ? esc(pv.name) : `Vague ${pv.index + 1}`}`,
      tags: `${pv.climax ? '<span class="tag boss">嵐 Climax</span>' : ''}<span>vague ${pv.index + 1}/${g.totalWaves}</span>${cd ? `<span class="dot">·</span><span>arrive dans ${cd}</span>` : ''}`,
      body: `<div class="wave-list">${list}</div>${!first && gains ? row('Appel', `l’appeler maintenant rapporte ${gains}`) : ''}`,
      actions: canCall ? `<button class="btn primary" data-act="call">${first ? 'Commencer' : 'Appeler maintenant'}${!first && gains ? ` · ${gains}` : ''}</button>` : '',
    };
  }
}

// PV du mur d'un Gardien, ou délai avant qu'il se relève.
function wallText(bar) {
  if (!bar.alive) return `Mur brisé · relevé dans ${Math.max(0, Math.ceil(bar.respawnT))} s`;
  return `Mur ${Math.max(0, Math.ceil(bar.hp))} / ${Math.ceil(bar.maxHp)} PV`;
}

// État d'un yokai en direct (fiche) : arrêté par un mur, armure brisée, statuts.
function enemyState(g, e) {
  const out = [];
  if (e.blocked != null) out.push('<b>壁</b> arrêté par un mur');
  if (e.breakT > 0 && e.armor > 0) out.push('armure brisée');
  if (e.stunT > 0) out.push('étourdi');
  if (e.slowT > 0) out.push('ralenti');
  if (e.burnT > 0) out.push('brûle');
  if (e.blindT > 0) out.push('aveuglé');
  if (e.hopT > 0) out.push('bondit');
  return out.length ? out.join(' · ') : 'en marche';
}

// Résistances et faiblesses : forme + élément + pourcentage.
function resistList(def, defs) {
  const res = def.resist || {};
  const parts = [];
  for (const [el, v] of Object.entries(res)) {
    if (!v) continue;
    const txt = v >= 1 ? 'insensible' : v > 0 ? `−${Math.round(v * 100)} %` : `<b>+${Math.round(-v * 100)} %</b> (faiblesse)`;
    parts.push(`<span class="res-line">${elementTag(el, defs)} ${txt}</span>`);
  }
  if (def.knockResist) parts.push(`<span class="res-line">recul −${Math.round(def.knockResist * 100)} %</span>`);
  if (def.stunResist) parts.push(`<span class="res-line">étourdissement −${Math.round(def.stunResist * 100)} %</span>`);
  return parts.join(' ');
}

// Face aux murs des Gardiens : dégâts infligés, ou comment il les évite.
function wallLine(def) {
  const ab = def.abilities || {};
  if (ab.flying) return 'Vole par-dessus les murs';
  const atk = def.attack ?? 8;
  const hop = ab.hop ? ' quand il ne les saute pas' : '';
  const strong = atk >= 40 ? ' <b>(fracasse les murs)</b>' : '';
  return `${atk > 0 ? `frappe ${fmt(atk)} PV/s` : 'ne frappe pas'}${hop}${strong}`;
}

// Règle du Rembobinage (fiche et tutoriel) : jauge, échos remboursés, hors du temps.
// `short` : sans les deux premières lignes (déjà dites par le texte du tutoriel).
export function rewindRules(g, short = false) {
  const r = g.rules;
  const sec = r.rewindSeconds ?? 6;
  const echo = r.echoSeconds ?? 10;
  const pow = Math.round((r.echoPower ?? 0.5) * 100);
  const lc = r.lastChanceSeconds ?? 4;
  return (
    (short ? '' : row('Jauge', 'Elle se remplit quand vous apaisez des yokai et quand vous appelez une vague en avance.')) +
    (short ? '' : row('Pleine', `Glissez la jauge ◀◀ pendant une vague : le temps recule de ${sec} s (vies, or, yokai).`)) +
    row('Échos', `Les lanternes posées pendant ces ${sec} s sont remboursées à 100 % et laissent un écho qui tire à ${pow} % pendant ${echo} s.`) +
    row('Hors du temps', 'Les yokai hors du temps (Tokihami) ne reculent pas ; les vies qu’ils prennent ne reviennent pas.') +
    row('Dernière chance', `Si le sanctuaire tombe avec la jauge pleine, la partie se fige ${lc} s : rembobinez !`)
  );
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
