// Surcouches de l'interface dessinées dans le plateau, par les crochets du rendu
// (renderer.drawUnderlay sous les entités, renderer.extraDrawables triés en
// profondeur avec elles) :
//   - socles compatibles avec la lanterne choisie mis en valeur, socles gravés
//     d'un autre élément atténués (forme + couleur de leur élément) ;
//   - « Déplacer le mur » : cases de chemin valides dans la portée du Gardien ;
//   - Gardien sélectionné : lien vers son mur ;
//   - coopération : lanternes des coéquipiers marquées (liseré au pied et petit
//     sceau à la couleur et à la forme de l'élément de leur joueur).
// Les murs eux-mêmes et la gravure des socles sont dessinés par le rendu
// (src/render/barriers.js, terrain.js) ; ici, seulement ce qui dépend du geste.
import { T } from '../core/grid.js';
import { PALETTE, INK, withAlpha, wash } from '../render/brush.js';
import { drawEnso } from '../render/fx.js';
import { elementOf, elementInfo, drawShape } from './elements.js';


// Cases où le mur d'un Gardien peut se dresser (mêmes règles que le moteur,
// game.barrierTileFor) : chemin praticable relié au sanctuaire, sans pierre, dans
// la portée de la tour, sans le mur d'un autre gardien.
export function rallyTiles(game, t) {
  if (!t || !game) return [];
  return game.rallyTiles ? game.rallyTiles(t.id) : [];
}

export function isBarrierTower(game, t) {
  return !!t && game?.defs.towers[t.type]?.attack === 'barrier';
}

export class BoardOverlay {
  /**
   * @param {import('../render/renderer.js').Renderer} renderer
   * @param {object} h  game(), owner(pid) → { name, color, shape, … } (coopération) ou null
   */
  constructor(renderer, h) {
    this.r = renderer;
    this.h = h;
    this.ui = null;
    this.rallyCache = null;
    renderer.drawUnderlay = (ctx, ts, time, ui) => this.under(ctx, ts, time, ui);
    renderer.extraDrawables = (items) => this.extra(items);
  }

  get game() {
    return this.h.game();
  }

  // Lanterne en cours de pose : outil choisi, ou glisser depuis la palette.
  placingType(ui) {
    if (!ui || ui.drag) return null;
    const type = ui.press?.kind === 'tower' ? ui.press.type : ui.tool;
    return type && type !== 'stone' && this.game?.defs.towers[type] ? type : null;
  }

  // Cases valides du mode « Déplacer le mur » (recalculées si le jeu change).
  rallyOf(game, ui) {
    const t = ui?.rally ? game.towerById(ui.rally.towerId) : null;
    if (!t) return null;
    // (les cases où se tiennent des yokai ne s'allument pas : elles suivent leur marche)
    const feet = game.enemies.map((e) => (e.flying ? '' : game.grid.tileAt(e.mx, e.my))).join(',');
    const key = `${t.id}|${t.level}|${game.flow.version}|${game.barriers.map((b) => b.tile).join(',')}|${feet}`;
    if (this.rallyCache?.key !== key) this.rallyCache = { key, tower: t, tiles: rallyTiles(game, t) };
    return this.rallyCache;
  }

  under(ctx, ts, time, ui) {
    const game = this.game;
    this.ui = ui;
    if (!game) return;
    const g = game.grid;
    const type = this.placingType(ui);
    const el = type ? elementOf(type, game.defs) : null;
    for (let i = 0; i < g.size; i++) {
      if (g.type(i) !== T.SLOT) continue;
      const se = g.slotElement?.[i];
      if (!se) continue;
      const c = g.col(i);
      const r = g.row(i);
      // (une construction en cours occupe déjà le socle)
      if (game.towerAt(c, r) || this.r.buildTiles?.has(c * 64 + r)) continue;
      const x = g.cx(i) * ts;
      const y = g.cy(i) * ts;
      const info = elementInfo(se, game.defs);
      // Socle gravé de l'élément choisi : anneau à sa couleur, en plus de l'ensō doré.
      if (el && se === el) {
        wash(ctx, x, y, ts * 0.5, info.color, 0.3);
        ctx.save();
        ctx.strokeStyle = withAlpha(info.color, 0.95);
        ctx.lineWidth = Math.max(2, ts * 0.06);
        ctx.beginPath();
        ctx.arc(x, y - ts * 0.01, ts * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    const rally = this.rallyOf(game, ui);
    if (rally) this.drawRally(ctx, ts, time, game, rally);
    else if (ui?.selectedTower != null) {
      const t = game.towerById(ui.selectedTower);
      if (isBarrierTower(game, t)) this.drawWallLink(ctx, ts, time, game, t);
    }
  }

  extra(items) {
    const game = this.game;
    const ui = this.ui;
    if (!game) return;
    const type = this.placingType(ui);
    if (type) items.push({ y: -1e6, k: 9, draw: (ctx, ts, time) => this.dimSlots(ctx, ts, time, game, type) });
    // Coopération : liseré sous la lanterne (dessiné avant elle) et sceau après.
    if (this.h.owner && game.players?.length > 1) {
      for (const t of game.towers) {
        if (t.owner == null || t.owner === game.localPlayer) continue;
        const o = this.h.owner(t.owner);
        if (!o) continue;
        items.push({ y: t.y - 0.001, k: 9, draw: (ctx, ts) => drawOwnerRim(ctx, t, o, ts) });
        items.push({ y: t.y + 0.02, k: 9, draw: (ctx, ts) => drawOwnerSeal(ctx, t, o, ts) });
      }
    }
  }

  // Socles gravés d'un autre élément : voile de papier, hachures et forme de
  // leur élément (le refus se lit avant même de viser).
  dimSlots(ctx, ts, time, game, type) {
    const g = game.grid;
    const el = elementOf(type, game.defs);
    for (let i = 0; i < g.size; i++) {
      if (g.type(i) !== T.SLOT) continue;
      const se = g.slotElement?.[i];
      if (!se || se === el) continue;
      const c = g.col(i);
      const r = g.row(i);
      if (game.towerAt(c, r)) continue;
      const x0 = c * ts + ts * 0.08;
      const y0 = r * ts + ts * 0.06;
      const s = ts * 0.84;
      ctx.save();
      ctx.fillStyle = withAlpha('#ece4cf', 0.72);
      roundRect(ctx, x0, y0, s, s, ts * 0.12);
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = withAlpha(INK, 0.22);
      ctx.lineWidth = Math.max(1, ts * 0.03);
      ctx.beginPath();
      for (let k = -s; k < s; k += ts * 0.17) {
        ctx.moveTo(x0 + k, y0 + s);
        ctx.lineTo(x0 + k + s, y0);
      }
      ctx.stroke();
      ctx.restore();
      const info = elementInfo(se, game.defs);
      const x = (c + 0.5) * ts;
      const y = (r + 0.5) * ts;
      drawShape(ctx, info.shape, x, y, ts * 0.2, info.color, INK, Math.max(1.2, ts * 0.035));
      ctx.save();
      ctx.fillStyle = PALETTE.cream;
      ctx.font = `800 ${Math.max(9, Math.round(ts * 0.2))}px "Shippori Mincho", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(info.kanji, x, y + (info.shape === 'triangle' ? ts * 0.05 : info.shape === 'drop' ? ts * 0.04 : 0));
      ctx.restore();
    }
  }

  // « Déplacer le mur » : cases valides (or), mur actuel (vermillon).
  drawRally(ctx, ts, time, game, rally) {
    const g = game.grid;
    const bar = game.barriers.find((b) => b.towerId === rally.tower.id);
    const a = 0.7 + Math.sin(time * 5) * 0.2;
    for (const i of rally.tiles) {
      const x0 = g.col(i) * ts;
      const y0 = g.row(i) * ts;
      const cur = bar && bar.tile === i;
      wash(ctx, x0 + ts / 2, y0 + ts / 2, ts * 0.55, cur ? PALETTE.vermillion : PALETTE.goldLight, cur ? 0.22 : 0.42 * a);
      ctx.save();
      ctx.strokeStyle = cur ? withAlpha(PALETTE.vermillion, 0.95) : withAlpha(PALETTE.gold, a);
      ctx.lineWidth = Math.max(2, ts * 0.06);
      ctx.setLineDash([ts * 0.14, ts * 0.09]);
      ctx.lineDashOffset = -time * ts * 0.3;
      roundRect(ctx, x0 + ts * 0.1, y0 + ts * 0.1, ts * 0.8, ts * 0.8, ts * 0.12);
      ctx.stroke();
      ctx.restore();
      // ombre d'encre sous l'ensō : lisible sur le gravier clair
      if (!cur) drawEnso(ctx, x0 + ts / 2, y0 + ts / 2, ts * 0.2, PALETTE.gold, 0.9 * a, i * 1.3, 0.8);
    }
  }

  // Gardien sélectionné : un fil d'encre relie la tour à son mur.
  drawWallLink(ctx, ts, time, game, t) {
    const bar = game.barriers.find((b) => b.towerId === t.id);
    if (!bar) return;
    const g = game.grid;
    const bx = g.cx(bar.tile) * ts;
    const by = g.cy(bar.tile) * ts;
    ctx.save();
    ctx.strokeStyle = withAlpha(bar.alive ? INK : '#7d7a70', 0.7);
    ctx.lineWidth = Math.max(1.5, ts * 0.045);
    ctx.lineCap = 'round';
    ctx.setLineDash([ts * 0.04, ts * 0.12]);
    ctx.lineDashOffset = -time * ts * 0.4;
    ctx.beginPath();
    ctx.moveTo(t.x * ts, t.y * ts);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = withAlpha(bar.alive ? PALETTE.gold : '#7d7a70', 0.95);
    ctx.lineWidth = Math.max(2, ts * 0.06);
    roundRect(ctx, bx - ts * 0.42, by - ts * 0.42, ts * 0.84, ts * 0.84, ts * 0.12);
    ctx.stroke();
    ctx.restore();
  }
}

// Liseré au pied d'une lanterne de coéquipier : ellipse à la couleur de son élément.
function drawOwnerRim(ctx, t, o, ts) {
  const x = t.x * ts;
  const y = (t.y + 0.3) * ts;
  ctx.save();
  ctx.lineWidth = Math.max(2, ts * 0.06);
  ctx.strokeStyle = withAlpha(INK, 0.55);
  ctx.beginPath();
  ctx.ellipse(x, y, ts * 0.4, ts * 0.15, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = Math.max(1.5, ts * 0.04);
  ctx.strokeStyle = o.color;
  ctx.stroke();
  ctx.restore();
}

// Petit sceau du joueur (coin bas droit du socle) : forme + couleur de son élément.
function drawOwnerSeal(ctx, t, o, ts) {
  const s = Math.max(12, ts * 0.3);
  const x = (t.c + 0.84) * ts - s / 2;
  const y = (t.r + 0.86) * ts - s / 2;
  ctx.save();
  ctx.fillStyle = o.color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, s * 0.09);
  roundRect(ctx, x, y, s, s, s * 0.22);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = withAlpha(PALETTE.cream, 0.85);
  ctx.lineWidth = Math.max(0.8, s * 0.06);
  roundRect(ctx, x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76, s * 0.14);
  ctx.stroke();
  ctx.restore();
  if (o.shape && o.shape !== 'circle') drawShape(ctx, o.shape, x + s / 2, y + s / 2, s * 0.28, PALETTE.cream, PALETTE.cream, 0.5);
  else if (o.initial) {
    // joueur sans élément choisi : son initiale
    ctx.save();
    ctx.fillStyle = PALETTE.cream;
    ctx.font = `800 ${Math.round(s * 0.62)}px "Zen Kaku Gothic New", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.initial, x + s / 2, y + s / 2 + s * 0.04);
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
