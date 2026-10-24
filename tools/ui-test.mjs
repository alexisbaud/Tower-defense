// Tests d'interface au doigt simulé (Playwright, 390×844) : pose au-dessus du doigt,
// annulation, barre d'actions (priorité, vente confirmée), fiches (lanterne, yokai,
// type de lanterne), pierre glissée avec aperçu du chemin, aperçu de vague, pause
// sans voile et table des combos, fusion avec aperçu, accessibilité.
// Usage : (serveur local sur :8080) node tools/ui-test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const LIFT = 60;
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ' ' + extra}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let box = null;
async function open(level) {
  await page.goto(`http://localhost:8080/?level=${level}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  box = await page.locator('#board').boundingBox();
}
// Centre écran (page) d'une case (c, r) ; `dy` décale le point de contact.
const at = (c, r, dy = 0) => page.evaluate(([c, r]) => window.__renderer.toScreen(c + 0.5, r + 0.5), [c, r]).then((p) => ({ x: box.x + p.x, y: box.y + p.y + dy }));
const slotsOf = () =>
  page.evaluate(() => {
    const g = window.__state.game.grid;
    const out = [];
    for (let i = 0; i < g.size; i++) if (g.type(i) === 3) out.push([g.col(i), g.row(i)]);
    return out;
  });
const game = () =>
  page.evaluate(() => {
    const g = window.__state.game;
    return { gold: g.gold, towers: g.towers.map((t) => ({ id: t.id, c: t.c, r: t.r, level: t.level, type: t.type, priority: t.priority })), tool: document.querySelector('.tool.selected')?.dataset.tool };
  });
const ui = () => page.evaluate(() => JSON.parse(JSON.stringify({ ...window.__input.ui, press: window.__input.ui.press && { ...window.__input.ui.press, combos: (window.__input.ui.press.combos || []).map((c) => c.def.name), routes: (window.__input.ui.press.routes || []).length } })));
// Doigt posé, maintenu puis déplacé : le fantôme se soulève au-dessus du doigt
// (montée après ~260 ms, finie vers 430 ms ; avant, relâcher reste un toucher).
async function press(p, holdMs = 520) {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.move(p.x + 2, p.y + 1);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(60);
}
async function longPress(p, ms = 620) {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await page.waitForTimeout(150);
}
// Choisit un outil de la palette (sans le désélectionner s'il l'est déjà).
async function selectTool(id) {
  if ((await page.locator(`.tool[data-tool="${id}"].selected`).count()) === 0) await page.locator(`.tool[data-tool="${id}"]`).click();
}
const visible = (sel) => page.locator(sel).first().isVisible().catch(() => false);
const rect = (sel) => page.locator(sel).first().boundingBox();

// ───────────────────────────────────────────────────────────────────────────
await open('1-1');
let slots = await slotsOf();

console.log('Pose et désélection (B1)');
await page.evaluate(() => (window.__state.game.gold = 500));
await page.locator('.tool[data-tool="fire"]').click();
const [c1, r1] = slots[0];
let p = await at(c1, r1);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(150);
let s = await game();
check('un simple toucher pose sur la case touchée', s.towers.length === 1 && s.towers[0].c === c1 && s.towers[0].r === r1, JSON.stringify(s.towers));
check('outil désélectionné après la pose', !s.tool);
const [c2, r2] = slots[1];
p = await at(c2, r2);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(150);
s = await game();
check('un toucher sur un socle vide n’achète rien', s.towers.length === 1);

console.log('Annuler (B8)');
check('« Annuler » visible après la pose', await visible('#btn-undo'));
const ub = await rect('#btn-undo');
check('« Annuler » ≥ 44 pt', ub && ub.height >= 44 && ub.width >= 44, JSON.stringify(ub));
const goldBefore = (await game()).gold;
await page.locator('#btn-undo').click();
await page.waitForTimeout(150);
s = await game();
check('annuler retire la lanterne et rend tout l’or', s.towers.length === 0 && s.gold === goldBefore + 50, `${goldBefore} → ${s.gold}`);
check('« Annuler » masqué ensuite', !(await visible('#btn-undo')));

console.log('Pose au-dessus du doigt (B2, B16, D14)');
await selectTool('fire');
// le doigt est 60 px SOUS le socle visé
const target = slots.find(([c, r]) => r >= 2) || slots[2];
p = await at(target[0], target[1], LIFT);
await press(p);
let u = await ui();
check('fantôme soulevé au-dessus du doigt', u.press?.lifted === true && u.press.gy < u.press.fy - 40, JSON.stringify(u.press && { gy: u.press.gy, fy: u.press.fy }));
check('case visée = case sous le fantôme', u.press?.c === target[0] && u.press?.r === target[1], JSON.stringify(u.press && [u.press.c, u.press.r]));
await page.mouse.up();
await page.waitForTimeout(150);
s = await game();
check('pose validée au relâchement sur la case visée', s.towers.some((t) => t.c === target[0] && t.r === target[1]), JSON.stringify(s.towers));
// toucher lent (doigt immobile ~340 ms) : le fantôme n'a pas fini de monter, la pose
// reste sur la case touchée (pas une rangée plus haut)
await selectTool('water');
const slowT = (await slotsOf()).find(([c, r]) => r >= 3 && !s.towers.some((t) => t.c === c && t.r === r));
p = await at(slowT[0], slowT[1]);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
await page.waitForTimeout(340);
await page.mouse.up();
await page.waitForTimeout(150);
const slowS = await game();
const slowNew = slowS.towers.find((t) => !s.towers.some((o) => o.id === t.id));
check('toucher lent (340 ms) : pose sur la case touchée', !!slowNew && slowNew.c === slowT[0] && slowNew.r === slowT[1], JSON.stringify(slowNew));
if (slowNew) await page.evaluate((id) => window.__state.game.undoPlace(id), slowNew.id);
// relâcher hors socle annule
await selectTool('water');
const path = await page.evaluate(() => {
  const g = window.__state.game.grid;
  for (let i = 0; i < g.size; i++) if (g.type(i) === 1 && g.row(i) > 3 && g.row(i) < 10) return [g.col(i), g.row(i)];
  return null;
});
const nb = (await game()).towers.length;
const g0 = (await game()).gold;
p = await at(path[0], path[1], LIFT);
await press(p);
await page.mouse.up();
await page.waitForTimeout(150);
s = await game();
check('relâcher hors socle annule (rien d’acheté)', s.towers.length === nb && s.gold === g0);
// aperçu invalide (or insuffisant) : grisé + raison écrite
await page.evaluate(() => (window.__state.game.gold = 0));
await selectTool('water');
const free = (await slotsOf()).find(([c, r]) => !s.towers.some((t) => t.c === c && t.r === r) && r >= 2);
p = await at(free[0], free[1], LIFT);
await press(p);
u = await ui();
const label = await page.evaluate(() => window.__renderer.pressLabel(window.__input.ui.press));
check('aperçu refusé : raison « Il manque X or » à côté du fantôme', u.press?.valid === false && u.press.reason === 'gold' && /Il manque \d+ or/.test(label?.text || ''), JSON.stringify(label));
// le fantôme gris est pré-rendu : ctx.filter à chaque image coûtait ~200 ms
const ghostCost = await page.evaluate(() => {
  const r = window.__renderer;
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) {
    r.render(0, 0, window.__input.ui);
    r.ctx.getImageData(0, 0, 1, 1);
  }
  return (performance.now() - t0) / 20;
});
check('fantôme refusé : rendu rapide (< 40 ms par image)', ghostCost < 40, `${ghostCost.toFixed(1)} ms`);
await page.mouse.up();
await page.waitForTimeout(100);
check('rien posé sans or', (await game()).towers.length === nb);
await page.evaluate(() => (window.__state.game.gold = 500));

console.log('Combos en direct pendant la pose (D14)');
const fireT = (await game()).towers.find((t) => t.type === 'fire');
const nbSlot = (await slotsOf()).find(([c, r]) => Math.max(Math.abs(c - fireT.c), Math.abs(r - fireT.r)) === 1);
if (nbSlot) {
  await selectTool('water');
  p = await at(nbSlot[0], nbSlot[1], LIFT);
  await press(p);
  u = await ui();
  check('le nom du combo qui naîtrait est affiché (previewCombos)', u.press?.combos?.length >= 1, JSON.stringify(u.press?.combos));
  await page.mouse.up();
  await page.waitForTimeout(150);
} else check('socle voisin pour tester le combo', false, 'aucun socle voisin');

console.log('Glisser depuis la palette');
const gp = (await game()).towers.length;
const dest = (await slotsOf()).find(([c, r]) => r >= 3 && !(s.towers.some((t) => t.c === c && t.r === r)) && !(nbSlot && c === nbSlot[0] && r === nbSlot[1]));
const tb = await rect('.tool[data-tool="fire"]');
const to = await at(dest[0], dest[1], LIFT);
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
await page.mouse.down();
for (let k = 1; k <= 14; k++) await page.mouse.move(tb.x + tb.width / 2 + ((to.x - tb.x - tb.width / 2) * k) / 14, tb.y + tb.height / 2 + ((to.y - tb.y - tb.height / 2) * k) / 14);
await page.waitForTimeout(80);
await page.mouse.up();
await page.waitForTimeout(200);
s = await game();
check('lanterne posée en glissant depuis la palette', s.towers.length === gp + 1 && s.towers.some((t) => t.c === dest[0] && t.r === dest[1]), JSON.stringify(s.towers.map((t) => [t.c, t.r])));

console.log('Barre d’actions : priorité, fiche, vente confirmée (B7, B8)');
await page.waitForTimeout(3300); // fin de la fenêtre d'annulation
const sel = (await game()).towers.find((t) => t.type === 'fire');
p = await at(sel.c, sel.r);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(200);
check('un toucher sur une lanterne ouvre la barre d’actions', await visible('#tower-bar'));
const btns = await page.locator('#tower-bar button').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect()).map((r) => ({ x: r.x, w: r.width, h: r.height })));
check('3 boutons ≥ 44 pt', btns.length === 3 && btns.every((b) => b.w >= 44 && b.h >= 44), JSON.stringify(btns));
check('espacement ≥ 8 px', btns.every((b, i) => !i || b.x - (btns[i - 1].x + btns[i - 1].w) >= 7.5), JSON.stringify(btns));
const prioLabels = [];
for (let k = 0; k < 4; k++) {
  await page.locator('#tower-bar .tb-prio').click();
  await page.waitForTimeout(80);
  prioLabels.push((await game()).towers.find((t) => t.id === sel.id).priority + ':' + (await page.locator('#tower-bar .tb-prio').innerText()).replace(/\s+/g, ' '));
}
await page.locator('#tower-bar .tb-info').click();
await page.waitForTimeout(150);
check('« Fiche » ouvre la fiche, la barre s’efface (pas de doublon)', (await page.evaluate(() => window.__sheets.cur?.kind)) === 'tower' && !(await visible('#tower-bar')));
await page.locator('#info .sheet-close').click();
await page.waitForTimeout(100);
check('fiche fermée : la barre revient', await visible('#tower-bar'));
check('priorité : Premier → Dernier → Plus fort → Plus proche → Premier', /^last:.*Dernier/.test(prioLabels[0]) && /^strong:.*Plus fort/.test(prioLabels[1]) && /^close:.*Plus proche/.test(prioLabels[2]) && /^first:.*Premier/.test(prioLabels[3]), prioLabels.join(' | '));
await page.locator('#tower-bar .tb-sell').click();
await page.waitForTimeout(80);
check('vendre : un premier toucher demande confirmation', !!(await game()).towers.find((t) => t.id === sel.id) && /Confirmer/.test(await page.locator('#tower-bar .tb-sell').innerText()));
await page.locator('#tower-bar .tb-sell').click();
await page.waitForTimeout(120);
check('vendre : le second toucher vend', !(await game()).towers.find((t) => t.id === sel.id));
// toucher ailleurs ferme la barre
const other = (await game()).towers[0];
p = await at(other.c, other.r);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(120);
p = await at(path[0], path[1]);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(120);
check('toucher ailleurs ferme la barre', !(await visible('#tower-bar')));

console.log('Fusion avec aperçu (D3, D22, B24)');
await page.evaluate(() => {
  const g = window.__state.game;
  g.gold = 999;
  g.towers = [];
  g.onTowersChanged();
});
slots = await slotsOf();
await page.evaluate((sl) => {
  const g = window.__state.game;
  g.placeTower('fire', sl[0][0], sl[0][1]);
  g.placeTower('fire', sl[sl.length - 1][0], sl[sl.length - 1][1]);
}, slots);
const fsrc = slots[slots.length - 1];
const fdst = slots[0];
let from = await at(fsrc[0], fsrc[1]);
let fto = await at(fdst[0], fdst[1], LIFT - 13);
await page.mouse.move(from.x, from.y);
await page.mouse.down();
for (let k = 1; k <= 14; k++) await page.mouse.move(from.x + ((fto.x - from.x) * k) / 14, from.y + ((fto.y - from.y) * k) / 14);
await page.waitForTimeout(80);
u = await ui();
check('aperçu de fusion : niveau obtenu et case libérée', u.drag?.preview?.ok && u.drag.preview.level === 2 && u.drag.preview.freed?.c === fsrc[0], JSON.stringify(u.drag?.preview && { level: u.drag.preview.level, freed: u.drag.preview.freed }));
// dépôt raté : retour animé
await page.mouse.move(fto.x + 150, fto.y + 300);
await page.mouse.up();
await page.waitForTimeout(30);
u = await ui();
check('dépôt raté : la lanterne revient (animation)', !!u.dragBack && (await game()).towers.length === 2);
await page.waitForTimeout(300);
from = await at(fsrc[0], fsrc[1]);
await page.mouse.move(from.x, from.y);
await page.mouse.down();
for (let k = 1; k <= 14; k++) await page.mouse.move(from.x + ((fto.x - from.x) * k) / 14, from.y + ((fto.y - from.y) * k) / 14);
await page.mouse.up();
await page.waitForTimeout(200);
s = await game();
check('fusion réussie en visant avec la lanterne portée', s.towers.length === 1 && s.towers[0].level === 2, JSON.stringify(s.towers));

console.log('Fiche de lanterne tenue à jour (B4, B5, B27)');
const t2 = s.towers[0];
p = await at(t2.c, t2.r);
await longPress(p);
let sheet = await page.locator('#info').innerText();
check('appui long : fiche ouverte au niveau 2', /N2/.test(sheet), sheet.slice(0, 80));
check('fiche : DPS, portée, priorité, niveau suivant, fusion, vente', ['DPS', 'Portée', 'Priorité', 'Niveau 3', 'Fusion', 'Vente', 'Force', 'Faiblesse'].every((k) => sheet.includes(k)), sheet.replace(/\n/g, ' | ').slice(0, 300));
const sellLabel = await page.locator('#info .btn.sell').innerText();
const value = await page.evaluate(() => window.__state.game.sellValue(window.__state.game.towers[0]));
check('prix de vente affiché = prix réel', sellLabel.includes(String(value)), `${sellLabel} vs ${value}`);
const sr = await rect('#info');
const fr = await rect('#hud-bottom');
check('fiche compacte : au plus 2 rangées de plateau couvertes', sr && fr && fr.y - sr.y <= 100, JSON.stringify({ sheet: sr?.y, footer: fr?.y }));
p = await at(path[0], path[1]);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(150);
check('un toucher sur le plateau ferme la fiche', !(await visible('#info')));

console.log('Fiche avant achat (B9)');
const tool = await rect('.tool[data-tool="water"]');
await longPress({ x: tool.x + tool.width / 2, y: tool.y + tool.height / 2 });
sheet = await page.locator('#info').innerText();
check('appui long sur la palette : fiche du type de lanterne', /Lanterne de l'Eau/.test(sheet) && /45 or/.test(sheet) && /Combos/.test(sheet), sheet.slice(0, 100));
check('l’appui long ne choisit pas l’outil', !(await game()).tool);
await page.locator('#info .sheet-close').click();

console.log('Aperçu de la prochaine vague (B12)');
const pv = await page.evaluate(() => window.__state.game.nextWavePreview());
const chips = await page.locator('#wave-preview .wchip').count();
check('une pastille par yokai de la vague suivante', chips === pv.groups.length, `${chips} vs ${pv.groups.length}`);
const count = await page.locator('#wave-preview .wchip b').first().innerText();
check('nombre affiché sur la pastille', Number(count) === pv.groups[0].count, `${count}`);
await page.locator('#wave-preview .wchip').first().click();
await page.waitForTimeout(150);
sheet = await page.locator('#info').innerText();
check('toucher une pastille ouvre la fiche du yokai', /PV/.test(sheet) && /Vitesse/.test(sheet), sheet.slice(0, 60));
await page.locator('#info .sheet-close').click();
await page.evaluate(() => {
  const g = window.__state.game;
  g.waveIndex = 0;
  g.state = 'build';
  g.countdown = 10.2;
});
await page.waitForTimeout(150);
const sub = await page.locator('#btn-wave-sub').innerText();
check('compte à rebours et bonus d’appel « +X or » sur le bouton', /\d+ s · \+\d+ or/.test(sub), sub);
await page.evaluate(() => {
  const g = window.__state.game;
  g.waves[1].climax = true;
});
await page.waitForTimeout(100);
check('vague climax mise en valeur', await page.locator('#btn-wave.climax').count() === 1);

console.log('Fiche de yokai par appui long (B6)');
await open('1-1');
await page.locator('#btn-wave').click();
await page.waitForTimeout(3200);
const e = await page.evaluate(() => {
  const g = window.__state.game;
  const e = g.enemies.find((x) => x.alive && x.spawnT <= 0);
  if (!e) return null;
  const s = window.__renderer.toScreen(e.x, e.y - 0.22);
  return { x: s.x, y: s.y, name: g.defs.enemies[e.type].name };
});
if (e) {
  // le doigt à ~0,4 case du yokai : le plus proche est pris
  await longPress({ x: box.x + e.x + 12, y: box.y + e.y + 8 });
  sheet = await page.locator('#info').innerText();
  check('fiche du yokai : nom, PV, vitesse, sanctuaire, force, faiblesse, contres', sheet.includes(e.name) && ['PV', 'Vitesse', 'Sanctuaire', 'Force', 'Faiblesse', 'Contres'].every((k) => sheet.includes(k)), sheet.replace(/\n/g, ' | ').slice(0, 200));
  check('yokai visé mis en valeur', (await ui()).focusEnemy != null);
} else check('un yokai à viser', false);

console.log('Pierre glissée avec aperçu du chemin (B10, B11, D6, D15)');
await open('1-2');
const stones = await page.evaluate(() => {
  const g = window.__state.game;
  g.gold = 999;
  const gr = g.grid;
  let best = null;
  let blocked = null;
  for (let i = 0; i < gr.size; i++) {
    if (gr.type(i) !== 2) continue;
    const pv = g.previewStone(gr.col(i), gr.row(i));
    if (pv.ok && (!best || pv.delta > best[2])) best = [gr.col(i), gr.row(i), pv.delta];
    if (!pv.ok && pv.reason === 'blocked' && !blocked) blocked = [gr.col(i), gr.row(i)];
  }
  return { best, blocked };
});
const badge0 = await page.locator('.tool[data-tool="stone"] .tool-count').innerText();
check('pierres restantes en badge sur l’outil', /^\d+\/\d+$/.test(badge0), badge0);
await page.locator('.tool[data-tool="stone"]').click();
p = await at(stones.best[0], stones.best[1], LIFT);
await press(p);
u = await ui();
const sl = await page.evaluate(() => window.__renderer.pressLabel(window.__input.ui.press));
check('pierre fantôme au-dessus du doigt, nouveau tracé affiché', u.press?.kind === 'stone' && u.press.c === stones.best[0] && u.press.r === stones.best[1] && u.press.routes >= 1, JSON.stringify(u.press));
check('« +X cases » affiché', new RegExp(`\\+${stones.best[2]} case`).test(sl?.text || ''), JSON.stringify(sl));
if (stones.blocked) {
  const q = await at(stones.blocked[0], stones.blocked[1], LIFT);
  await page.mouse.move(q.x, q.y);
  await page.waitForTimeout(60);
  const bl = await page.evaluate(() => window.__renderer.pressLabel(window.__input.ui.press));
  check('« Bloqué ! » en rouge sur une case qui couperait le chemin', bl?.text === 'Bloqué !' && bl.tone === 'bad', JSON.stringify(bl));
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(60);
}
await page.mouse.up();
await page.waitForTimeout(150);
const placed = await page.evaluate(() => window.__state.game.stonesPlaced);
check('pierre posée au relâchement', placed === 1, String(placed));
const badge1 = await page.locator('.tool[data-tool="stone"] .tool-count').innerText();
check('badge mis à jour', badge1 !== badge0, `${badge0} → ${badge1}`);
await page.evaluate(() => {
  const g = window.__state.game;
  g.stonesPlaced = g.stoneConf().max;
});
await page.waitForTimeout(120);
check('outil pierre désactivé à 0', (await page.locator('.tool[data-tool="stone"].empty').count()) === 1);

console.log('Pause sans voile et table des combos (B13, D5)');
await open('1-3');
const gauge = await rect('#rewind');
check('jauge de rembobinage compacte hors vague (B26)', gauge && gauge.width <= 50, JSON.stringify(gauge));
await page.locator('#rewind .rewind-track').click();
await page.waitForTimeout(100);
check('toucher la jauge hors vague : indication neutre, pas d’erreur rouge', (await page.locator('#toast.bad.show').count()) === 0 && (await page.locator('#toast.show').count()) === 1);
slots = await slotsOf();
await page.evaluate((sl) => window.__state.game.placeTower('fire', sl[2][0], sl[2][1]), slots);
await page.locator('#btn-pause').click();
await page.waitForTimeout(200);
const veil = await page.evaluate(() => getComputedStyle(document.getElementById('modal')).backgroundColor);
const card = await rect('#modal .modal-card');
check('pause : pas de voile sombre plein écran', /rgba\(0, 0, 0, 0\)|transparent/.test(veil), veil);
check('pause : feuille compacte (< 40 % de l’écran)', card && card.height < 844 * 0.4, JSON.stringify(card));
p = await at(slots[2][0], slots[2][1]);
await longPress(p);
check('en pause : appui long sur une lanterne ouvre sa fiche', /Lanterne du Feu/.test(await page.locator('#info').innerText()));
await page.locator('#info .sheet-close').click();
await page.waitForTimeout(100);
check('la feuille de pause revient', await visible('#modal .modal-card'));
await page.locator('#modal .btn', { hasText: 'Combos' }).click();
await page.waitForTimeout(150);
const cells = await page.locator('.combo-table .ct-cell[data-combo]').count();
check('table des combos (matrice des éléments)', cells === 12, String(cells));
const ctGap = await page.locator('.combo-table .ct-cell').evaluateAll((els) => {
  const rs = els.map((e) => e.getBoundingClientRect());
  let m = Infinity;
  for (const a of rs) for (const b of rs) if (a !== b && Math.abs(a.top - b.top) < 2 && b.left > a.left) m = Math.min(m, b.left - a.right);
  return m;
});
check('table des combos : cases espacées d’au moins 8 px', ctGap >= 7.5, `${ctGap}`);
await page.locator('.combo-table .ct-cell[data-combo]').nth(1).click();
const det = await page.locator('.ct-detail').innerText();
check('détail : nom, effet, contre quoi', /Contre/.test(det) && det.length > 40, det);
check('formes des éléments dans la table', (await page.locator('.combo-table .ct-head .el-badge svg').count()) >= 8);
await page.locator('#modal [data-act="back"]').click();
await page.locator('#modal .btn.primary').click();
await page.waitForTimeout(100);
check('reprendre', !(await page.evaluate(() => window.__state.paused)));

console.log('Non-intrusif (B14, B15, B22)');
await open('1-1');
// carte « Nouveau yokai » : ne couvre ni portail ni sanctuaire
await page.evaluate(() => {
  const g = window.__state.game;
  g.events.push({ type: 'spawn', enemy: { type: 'kamaitachi', x: 0, y: 0, boss: false } });
  g.level.introduce = ['kamaitachi'];
});
await page.waitForTimeout(200);
const ir = await rect('#intro');
const spawnR = await page.evaluate(() => {
  const g = window.__state.game.grid;
  return [...g.spawns, ...g.goals].map((i) => {
    const p = window.__renderer.toScreen(g.col(i), g.row(i));
    return { x: p.x, y: p.y, w: window.__renderer.ts };
  });
});
const hits = spawnR.some((s) => ir && ir.x < box.x + s.x + s.w && ir.x + ir.width > box.x + s.x && ir.y < box.y + s.y + s.w && ir.y + ir.height > box.y + s.y);
check('carte « Nouveau yokai » compacte, hors portails et sanctuaire', ir && ir.height <= 70 && !hits, JSON.stringify(ir));
// toasts : au-dessus de la barre du bas, plus sur la rangée des portails
await page.evaluate(() => window.__hud.toast('Test', true));
await page.waitForTimeout(250);
const tr = await rect('#toast');
const row2 = await at(0, 2);
check('toasts loin de la rangée des portails', tr && tr.y > row2.y, JSON.stringify(tr));
// bulle du tutoriel masquée pendant qu'un doigt est posé
await page.locator('.tool[data-tool="fire"]').click();
await page.waitForTimeout(250);
const hintBefore = await visible('#hint .bubble');
slots = await slotsOf();
p = await at(slots[3][0], slots[3][1], LIFT);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
await page.waitForTimeout(150);
const hintDuring = await visible('#hint .bubble');
await page.mouse.up();
check('bulle du tutoriel masquée pendant le geste', hintBefore && !hintDuring, `${hintBefore} / ${hintDuring}`);

console.log('Gestes au doigt réel (événements tactiles, vague en cours)');
{
  await open('1-2');
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, q) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: q.x, y: q.y, id: 1, radiusX: 8, radiusY: 8 }] });
  const tap = async (q, ms = 60) => {
    await touch('touchStart', q);
    await page.waitForTimeout(ms);
    await touch('touchEnd');
    await page.waitForTimeout(150);
  };
  const center = async (sel) => {
    const r = await page.locator(sel).first().boundingBox();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  await page.evaluate(() => (window.__state.game.gold = 999));
  await tap(await center('#btn-wave'));
  await page.waitForTimeout(1200);
  let sl = await slotsOf();
  const occ = () => game().then((g) => new Set(g.towers.map((t) => `${t.c},${t.r}`)));
  // toucher : pose sur le socle touché
  await tap(await center('.tool[data-tool="fire"]'));
  const a = sl.find(([c, r]) => r >= 4);
  await tap(await at(a[0], a[1]));
  check('doigt : un toucher pose sur le socle touché', (await occ()).has(`${a[0]},${a[1]}`));
  // doigt maintenu 60 px sous un socle, puis relâché : pose sous le fantôme
  let o = await occ();
  const b = sl.find(([c, r]) => r >= 2 && !o.has(`${c},${r}`));
  await tap(await center('.tool[data-tool="water"]'));
  const q = await at(b[0], b[1], LIFT);
  await touch('touchStart', q);
  await page.waitForTimeout(560);
  await touch('touchMove', { x: q.x + 3, y: q.y + 1 });
  await page.waitForTimeout(60);
  const pu = await ui();
  await touch('touchEnd');
  await page.waitForTimeout(150);
  check('doigt : fantôme soulevé, pose sous le fantôme au relâchement', pu.press?.lifted && (await occ()).has(`${b[0]},${b[1]}`), JSON.stringify(pu.press && [pu.press.c, pu.press.r]));
  // glisser depuis la palette
  o = await occ();
  const d = sl.find(([c, r]) => r >= 4 && !o.has(`${c},${r}`));
  const from = await center('.tool[data-tool="earth"]');
  const to = await at(d[0], d[1], LIFT);
  await touch('touchStart', from);
  for (let k = 1; k <= 12; k++) {
    await touch('touchMove', { x: from.x + ((to.x - from.x) * k) / 12, y: from.y + ((to.y - from.y) * k) / 12 });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(60);
  await touch('touchEnd');
  await page.waitForTimeout(200);
  check('doigt : glisser depuis la palette pose la lanterne', (await occ()).has(`${d[0]},${d[1]}`));
  // appui long sur la palette : la fiche s'ouvre sous le doigt, le relâcher ne la
  // referme pas et ne choisit pas l'outil (clic du doigt qui l'a ouverte)
  await touch('touchStart', await center('.tool[data-tool="water"]'));
  await page.waitForTimeout(650);
  await touch('touchEnd');
  await page.waitForTimeout(200);
  check('doigt : appui long sur la palette → fiche ouverte, outil non choisi', (await page.evaluate(() => window.__sheets.cur?.kind)) === 'type' && !(await game()).tool, JSON.stringify(await page.evaluate(() => [window.__sheets.cur?.kind, window.__input.ui.tool])));
  await tap(await center('#info .sheet-close'));
  // appui long sur une lanterne : fiche ; toucher le plateau : fermée
  await page.waitForTimeout(3200);
  await touch('touchStart', await at(a[0], a[1]));
  await page.waitForTimeout(600);
  await touch('touchEnd');
  await page.waitForTimeout(150);
  check('doigt : appui long sur une lanterne → fiche', (await page.evaluate(() => window.__sheets.cur?.kind)) === 'tower');
  await tap(await at(4, 6));
  check('doigt : un toucher sur le plateau ferme la fiche', !(await page.evaluate(() => window.__sheets.isOpen)));
  // un yokai volant passe au-dessus de la lanterne : un toucher la sélectionne quand même
  const tw = (await game()).towers.find((t) => t.c === a[0] && t.r === a[1]);
  await page.evaluate((t) => {
    window.__state.paused = true; // figé, sans le mode étude de la pause
    const g = window.__state.game;
    const e = g.enemies.find((x) => x.alive) || null;
    if (e) {
      e.flying = true;
      e.x = t.c + 0.5;
      e.y = t.r + 0.5 + 0.25; // corps du volant (0,55 case plus haut) sur la lanterne
    }
  }, tw);
  await tap(await at(a[0], a[1], -13));
  check('doigt : toucher une lanterne sous un volant la sélectionne', (await game()).towers && (await page.evaluate(() => window.__input.ui.selectedTower)) === tw.id);
  await page.evaluate(() => (window.__state.paused = false));
  await cdp.detach();
}

console.log('Accessibilité (B17 à B21)');
const shapes = await page.locator('#palette .tool .el-badge svg').count();
const names = await page.locator('#palette .tool .tool-name').allInnerTexts();
check('chaque lanterne : forme + libellé français', shapes >= 2 && names.includes('Feu') && names.includes('Eau'), JSON.stringify(names));
const small = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('#screen-game *')) {
    if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || el.closest('.hidden')) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12) out.push(`${el.className || el.tagName} ${fs}px « ${el.textContent.trim().slice(0, 12)} »`);
  }
  return out;
});
check('textes ≥ 12 px', small.length === 0, small.join(', '));
const gaps = await page.evaluate(() => {
  const gap = (sel) => {
    const rs = [...document.querySelectorAll(sel)].map((b) => b.getBoundingClientRect()).filter((r) => r.width);
    let m = Infinity;
    for (let i = 1; i < rs.length; i++) m = Math.min(m, rs[i].left - rs[i - 1].right);
    return m;
  };
  return { top: gap('#hud-top .hud-buttons button'), palette: gap('#palette .tool') };
});
check('espacement ≥ 8 px (HUD haut, palette)', gaps.top >= 8 && gaps.palette >= 8, JSON.stringify(gaps));

console.log('Animations réduites (B23)');
await page.evaluate(() => window.__hud.banner('Test', 'bannière'));
await page.waitForTimeout(400);
const op = await page.evaluate(() => getComputedStyle(document.getElementById('banner')).opacity);
check('bannière visible avec « réduire les animations »', Number(op) > 0.5, `opacity ${op}`);

check('aucune erreur console', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests d’interface passent');
process.exit(failures ? 1 : 0);
