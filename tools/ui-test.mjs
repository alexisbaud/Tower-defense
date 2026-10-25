// Tests d'interface au doigt simulé (Playwright, 390×844) : pose au-dessus du doigt,
// annulation, barre d'actions (priorité, vente confirmée), fiches (lanterne, yokai,
// type de lanterne), pierre glissée avec aperçu du chemin, aperçu de vague, pause
// sans voile et table des combos, fusion avec aperçu, accessibilité.
// Moteur v3 (événements tactiles réels) : palette regroupée par élément, socles
// gravés, murs des Gardiens, vagues qui se chevauchent et appel anticipé, jauge de
// Rembobinage et dernière chance, carte (leçon, Difficile, défi), tutoriel, débogage.
// Commandes et construction (lockstep) : une pose apparaît « en construction » 2 s
// (or réservé, socle refusé à une autre pose, « Annuler » pendant la construction
// puis 3 s), la pause la fige ; à plusieurs, palette limitée à l'élément du joueur
// et salon à éléments distincts. Recette solo de la construction (section 12) : pierres
// posées en rafale, mur déplacé deux fois ou Gardien vendu pendant le déplacement,
// tutoriel qui attend la pierre et le mur, fusion sur une jumelle en construction,
// pause, victoire, Rembobinage pendant une construction.
// Usage : (serveur local sur :8080) node tools/ui-test.mjs
import { createRequire } from 'node:module';
import { brokerQuery } from './relay.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

// accueil (salon) : relais local s'il répond, sinon salon hors ligne (voir relay.mjs)
const HOME = `http://localhost:8080/?${await brokerQuery()}`;

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
// Socles universels (#) — ou compatibles avec la lanterne `type` (socle gravé de son élément).
const slotsOf = (type = null) =>
  page.evaluate((type) => {
    const game = window.__state.game;
    const g = game.grid;
    const el = type ? game.defs.towers[type]?.element ?? type : null;
    const out = [];
    for (let i = 0; i < g.size; i++) {
      if (g.type(i) !== 3) continue;
      const se = g.slotElement[i];
      if (se && se !== el) continue;
      out.push([g.col(i), g.row(i)]);
    }
    return out;
  }, type);
const towerName = (type) => page.evaluate((t) => window.__state.game.defs.towers[t].name, type);
// État de la partie. `towers` compte aussi les lanternes en construction (pending :
// pose en file, id « b<n° de commande> ») ; `built` : seulement les lanternes actives.
const game = () =>
  page.evaluate(() => {
    const g = window.__state.game;
    const built = g.towers.map((t) => ({ id: t.id, c: t.c, r: t.r, level: t.level, type: t.type, priority: t.priority }));
    const pending = g.pendingPlacements().filter((e) => e.op === 'placeTower').map((e) => ({ id: `b${e.id}`, c: e.args[1], r: e.args[2], level: 1, type: e.args[0], priority: null, pending: true }));
    return { gold: g.gold, spendable: g.spendable(), towers: [...built, ...pending], built, pending, tool: document.querySelector('.tool.selected')?.dataset.tool };
  });
// Achève les constructions en cours sans attendre leurs 2 s (le moteur avance d'une image).
const settle = () =>
  page.evaluate(() => {
    const g = window.__state.game;
    for (const e of g.queue) e.frame = Math.min(e.frame, g.frame + 1);
    g.update(1 / 60);
  });
// Annule les constructions en cours (commande 'cancel', comme « Annuler »).
const cancelBuilds = () => page.evaluate(() => window.__state.game.pendingPlacements().forEach((e) => window.__state.game.issue('cancel', [e.id])));
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
// moteur ralenti (×0,1) : la construction dure ~20 s réelles, le temps des vérifications
await page.evaluate(() => {
  window.__state.game.gold = 500;
  window.__state.speed = 0.1;
});
await page.locator('.tool[data-tool="fire"]').click();
const [c1, r1] = slots[0];
let p = await at(c1, r1);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(150);
let s = await game();
check('un simple toucher lance la construction sur la case touchée', s.pending.length === 1 && s.built.length === 0 && s.pending[0].c === c1 && s.pending[0].r === r1, JSON.stringify(s.towers));
check('outil désélectionné après la pose', !s.tool);
const [c2, r2] = slots[1];
p = await at(c2, r2);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(150);
s = await game();
check('un toucher sur un socle vide n’achète rien', s.towers.length === 1);
// socle d'abord (§6.7) : ce toucher a choisi le socle ; un second toucher le relâche
check('… il choisit ce socle (socle d’abord)', (await ui()).selectedSlot?.c === c2 && (await ui()).selectedSlot?.r === r2, JSON.stringify((await ui()).selectedSlot));
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(150);
check('… un second toucher le relâche', !(await ui()).selectedSlot);

console.log('Construction (2 s) : visible, or réservé, socle pris');
check('rien n’est encore payé : l’or est réservé (disponible = or − 50)', s.gold === 500 && s.spendable === 450, JSON.stringify({ gold: s.gold, spendable: s.spendable }));
const hudGold = await page.evaluate(() => [document.getElementById('hud-gold').textContent, document.getElementById('hud-reserved').textContent, !document.getElementById('hud-reserved').classList.contains('hidden')]);
check('HUD : or disponible et « −50 » promis à la construction', hudGold[0] === '450' && hudGold[1] === '−50' && hudGold[2], JSON.stringify(hudGold));
const drawn = await page.evaluate(() => window.__renderer.builds.map((b) => [b.op, b.c, b.r, Math.round(b.k * 100) / 100]));
check('la lanterne en construction est dessinée (avancement 0 → 1)', drawn.length === 1 && drawn[0][0] === 'placeTower' && drawn[0][1] === c1 && drawn[0][3] > 0 && drawn[0][3] < 1, JSON.stringify(drawn));
await page.screenshot({ path: 'qa-output/ui-construction.png' });
// le socle en construction refuse une autre pose
await page.locator('.tool[data-tool="water"]').click();
p = await at(c1, r1, LIFT);
await press(p);
{
  const u = await ui();
  const lab = await page.evaluate(() => window.__renderer.pressLabel(window.__input.ui.press));
  check('socle en construction : pose refusée « En construction »', u.press?.valid === false && u.press.reason === 'pending' && lab?.text === 'En construction', JSON.stringify({ reason: u.press?.reason, lab }));
}
await page.mouse.up();
await page.waitForTimeout(150);
check('… et rien de plus n’est construit', (await game()).towers.length === 1);
// toucher la construction : « En construction · Annuler »
p = await at(c1, r1);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(200);
const bbar = await page.evaluate(() => ({ shown: !document.getElementById('tower-bar').classList.contains('hidden'), text: document.getElementById('tower-bar').innerText.replace(/\s+/g, ' '), btns: [...document.querySelectorAll('#tower-bar button')].map((b) => b.getBoundingClientRect().height) }));
check('toucher une construction : barre « En construction · Annuler » (≥ 44 pt)', bbar.shown && /En construction/.test(bbar.text) && /Annuler/.test(bbar.text) && bbar.btns.length === 1 && bbar.btns[0] >= 44, JSON.stringify(bbar));
await page.screenshot({ path: 'qa-output/ui-construction-bar.png' });
await page.locator('#tower-bar [data-act="cancelBuild"]').click();
await page.waitForTimeout(150);
s = await game();
check('« Annuler » de la barre : construction retirée, rien n’est payé', s.towers.length === 0 && s.gold === 500 && s.spendable === 500, JSON.stringify(s));
await page.evaluate(() => (window.__state.speed = 1));

console.log('Annuler (B8)');
await selectTool('fire');
p = await at(c1, r1);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(150);
check('« Annuler » visible pendant la construction', await visible('#btn-undo'));
const ub = await rect('#btn-undo');
check('« Annuler » ≥ 44 pt', ub && ub.height >= 44 && ub.width >= 44, JSON.stringify(ub));
const goldBefore = (await game()).gold;
await page.locator('#btn-undo').click();
await page.waitForTimeout(150);
s = await game();
check('annuler pendant la construction : retirée, rien n’est payé', s.towers.length === 0 && s.gold === goldBefore && s.spendable === goldBefore, `${goldBefore} → ${s.gold}`);
check('« Annuler » masqué ensuite', !(await visible('#btn-undo')));
// après l'activation (2 s, attendues en vrai) : « Annuler » reste 3 s et rend tout l'or
await selectTool('fire');
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(2300);
s = await game();
check('2 s plus tard, la lanterne s’allume (active, or payé)', s.built.length === 1 && s.pending.length === 0 && s.gold === goldBefore - 50, JSON.stringify(s));
check('« Annuler » encore visible juste après l’activation', await visible('#btn-undo'));
await page.locator('#btn-undo').click();
await page.waitForTimeout(150);
s = await game();
check('annuler juste après : lanterne reprise, or rendu en entier', s.towers.length === 0 && s.gold === goldBefore, `${goldBefore} → ${s.gold}`);
// la pause fige les constructions (le moteur n'avance pas)
await selectTool('fire');
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(100);
await page.locator('#btn-pause').click();
await page.waitForTimeout(2400);
const frozen = await page.evaluate(() => ({ q: window.__state.game.pendingPlacements().length, t: window.__state.game.towers.length }));
check('en pause, la construction attend (figée)', frozen.q === 1 && frozen.t === 0, JSON.stringify(frozen));
await page.locator('#modal .btn.primary').click();
await page.waitForTimeout(2300);
check('reprise : la construction s’achève', (await game()).built.length === 1);
await page.evaluate(() => {
  const g = window.__state.game;
  g.towers = [];
  g.onTowersChanged();
  g.gold = 500;
});
await page.waitForTimeout(3200); // « Annuler » de la lanterne effacée disparaît

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
check('pose validée au relâchement sur la case visée (en construction)', s.towers.some((t) => t.c === target[0] && t.r === target[1]), JSON.stringify(s.towers));
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
if (slowNew) await page.evaluate(([c, r]) => window.__state.game.pendingPlacements().filter((e) => e.args[1] === c && e.args[2] === r).forEach((e) => window.__state.game.issue('cancel', [e.id])), [slowNew.c, slowNew.r]);
// relâcher hors socle annule
await selectTool('water');
const path = await page.evaluate(() => {
  const g = window.__state.game.grid;
  for (let i = 0; i < g.size; i++) if (g.type(i) === 1 && g.row(i) > 3 && g.row(i) < 10) return [g.col(i), g.row(i)];
  return null;
});
await settle(); // constructions achevées (l'or du test change ensuite)
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
// une lanterne de Feu posée à côté d'un socle libre où l'Eau peut aller
const occNow = new Set((await game()).towers.map((t) => `${t.c},${t.r}`));
const freeW = (await slotsOf('water')).filter(([c, r]) => !occNow.has(`${c},${r}`));
const pairF = (await slotsOf('fire')).filter(([c, r]) => !occNow.has(`${c},${r}`)).map(([c, r]) => [c, r, freeW.find(([c2, r2]) => Math.max(Math.abs(c - c2), Math.abs(r - r2)) === 1)]).find((x) => x[2]);
if (pairF) await page.evaluate(([c, r]) => window.__state.game.placeTower('fire', c, r), pairF);
await settle();
const nbSlot = pairF ? pairF[2] : null;
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
const occD = (await game()).towers;
const dest = (await slotsOf()).find(([c, r]) => r >= 3 && !occD.some((t) => t.c === c && t.r === r) && !(nbSlot && c === nbSlot[0] && r === nbSlot[1]));
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
await settle(); // constructions achevées
await page.waitForTimeout(3300); // fin de la fenêtre d'annulation
const sel = (await game()).towers.find((t) => t.type === 'fire');
p = await at(sel.c, sel.r);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(200);
check('un toucher sur une lanterne ouvre la barre d’actions', await visible('#tower-bar'));
const btns = await page.locator('#tower-bar button').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect()).map((r) => ({ x: r.x, w: r.width, h: r.height })));
// Priorité ▾, Fusionner (une jumelle Feu est posée), Fiche, Vendre : boutons 64 × 52 (§6.8)
check('4 boutons 64 × 52 (Priorité, Fusionner, Fiche, Vendre)', btns.length === 4 && btns.every((b) => b.w >= 63.5 && b.h >= 52) && (await page.locator('#tower-bar .tb-fuse').count()) === 1, JSON.stringify(btns));
check('espacement ≥ 8 px', btns.every((b, i) => !i || b.x - (btns[i - 1].x + btns[i - 1].w) >= 7.5), JSON.stringify(btns));
// « Premier ▾ » ouvre les quatre choix ; un toucher en règle un et referme la barre ;
// un nouveau toucher sur la lanterne (toujours choisie) la rouvre
const prioLabels = [];
for (const k of ['last', 'strong', 'close', 'first']) {
  await page.locator('#tower-bar .tb-prio').click();
  await page.waitForTimeout(80);
  const picks = await page.locator('#tower-bar .tb-pick').count();
  await page.locator(`#tower-bar .tb-pick[data-p="${k}"]`).click();
  await page.waitForTimeout(120);
  const closed = !(await visible('#tower-bar')) && (await ui()).selectedTower === sel.id;
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(150);
  prioLabels.push(`${(await game()).towers.find((t) => t.id === sel.id).priority}:${picks}:${closed}:${(await page.locator('#tower-bar .tb-prio').innerText()).replace(/\s+/g, ' ')}`);
}
await page.locator('#tower-bar .tb-info').click();
await page.waitForTimeout(150);
check('« Fiche » ouvre la fiche, la barre s’efface (pas de doublon)', (await page.evaluate(() => window.__sheets.cur?.kind)) === 'tower' && !(await visible('#tower-bar')));
await page.locator('#info .sheet-close').click();
await page.waitForTimeout(100);
check('fiche fermée : la barre revient', await visible('#tower-bar'));
check('priorité : 4 choix, un toucher règle et ferme, Dernier → Plus fort → Plus proche → Premier', /^last:4:true:.*Dernier/.test(prioLabels[0]) && /^strong:4:true:.*Fort/.test(prioLabels[1]) && /^close:4:true:.*Proche/.test(prioLabels[2]) && /^first:4:true:.*Premier/.test(prioLabels[3]), prioLabels.join(' | '));
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
check('appui long : fiche ouverte au niveau 2', /niveau 2/.test(sheet) && (await page.locator('#info .lvl-seal').innerText()) === '弐', sheet.slice(0, 80));
check('fiche moyenne : force, faiblesse, 4 chiffres, cible, vente', ['Force', 'Faiblesse', 'Dégâts', 'Cadence', 'DPS', 'Portée', 'Cible', 'Vendre'].every((k) => sheet.toLowerCase().includes(k.toLowerCase())), sheet.replace(/\n/g, ' | ').slice(0, 300));
const sellLabel = await page.locator('#info .btn.sell').innerText();
const value = await page.evaluate(() => window.__state.game.sellValue(window.__state.game.towers[0]));
check('prix de vente affiché = prix réel', sellLabel.includes(String(value)), `${sellLabel} vs ${value}`);
// feuille du bas non modale (§6.9) : hauteur moyenne ≤ 56 % de la page, le haut du plateau reste visible
const sr = await rect('#info');
const hb = await rect('.hud-top');
const vh = await page.evaluate(() => innerHeight);
check('fiche moyenne : ≤ 56 % de la page, plateau visible au-dessus', sr && hb && sr.height <= vh * 0.56 + 1 && sr.y > hb.y + hb.height + 40, JSON.stringify({ h: sr?.height, top: sr?.y, vh }));
// « Détails ⌃ » : grande hauteur avec évolution, priorité, fusion, vente
await page.locator('#info .sheet-more').click();
await page.waitForTimeout(250);
sheet = await page.locator('#info').innerText();
check('« Détails » : grande hauteur, priorité, niveau suivant, fusion, vente', (await page.locator('#info.sheet-large').count()) === 1 && ['Priorité', 'Niveau 3', 'Fusion', 'Vente'].every((k) => sheet.includes(k)), sheet.replace(/\n/g, ' | ').slice(0, 300));
await page.locator('#info .sheet-more').click();
await page.waitForTimeout(250);
check('« Moins de détails » : retour à la hauteur moyenne', (await page.locator('#info.sheet-large').count()) === 0);
p = await at(path[0], path[1]);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(150);
check('un toucher sur le plateau ferme la fiche', !(await visible('#info')));

console.log('Fiche avant achat (B9)');
const tool = await rect('.tool[data-tool="water"]');
await longPress({ x: tool.x + tool.width / 2, y: tool.y + tool.height / 2 });
sheet = await page.locator('#info').innerText();
const waterName = await towerName('water');
const waterCost = await page.evaluate(() => window.__state.game.defs.towers.water.cost);
check('appui long sur la palette : fiche du type de lanterne (« Choisir · X or »)', sheet.includes(waterName) && sheet.includes(`${waterCost} or`) && /Choisir/.test(sheet), sheet.slice(0, 100));
check('l’appui long ne choisit pas l’outil', !(await game()).tool);
await page.locator('#info .sheet-more').click();
await page.waitForTimeout(250);
sheet = await page.locator('#info').innerText();
check('« Détails » du type : combos et socles', /Combos/.test(sheet) && /Socles/.test(sheet), sheet.replace(/\n/g, ' | ').slice(0, 200));
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
  g.state = 'wave';
  g.nextWaveT = 10.2;
});
await page.waitForTimeout(150);
// §6.5 : secondes dans le cadran, « ◉ +X » (prime d'appel) en sous-ligne, phrase complète lue
const wb0 = await page.evaluate(() => ({ dial: document.getElementById('btn-wave-kanji').textContent, sub: document.getElementById('btn-wave-sub').textContent, coin: !!document.querySelector('#btn-wave-sub .coin'), aria: document.getElementById('btn-wave').getAttribute('aria-label') }));
check('compte à rebours dans le cadran et bonus d’appel « ◉ +X » sur le bouton', /^\d+$/.test(wb0.dial) && /^\+\d+$/.test(wb0.sub) && wb0.coin && /\+\d+ or/.test(wb0.aria) && /dans \d+ s/.test(wb0.aria), JSON.stringify(wb0));
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
  // (légendes en petites capitales : innerText rend « FORCE »)
  check('fiche du yokai : nom, PV, vitesse, sanctuaire, force, faiblesse, contres', sheet.includes(e.name) && ['PV', 'Vitesse', 'Sanctuaire', 'Force', 'Faiblesse', 'Contres'].every((k) => sheet.toLowerCase().includes(k.toLowerCase())), sheet.replace(/\n/g, ' | ').slice(0, 200));
  check('yokai visé mis en valeur', (await ui()).focusEnemy != null);
} else check('un yokai à viser', false);

console.log('Pierre glissée avec aperçu du chemin (B10, B11, D6, D15)');
await open('1-4');
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
check('« +X cases » affiché', stones.best[2] > 0 ? new RegExp(`\\+${stones.best[2]} case`).test(sl?.text || '') : /Sans effet/.test(sl?.text || ''), JSON.stringify({ sl, best: stones.best }));
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
const stoneBuild = await page.evaluate(() => window.__renderer.builds.filter((b) => b.op === 'placeStone').map((b) => [b.c, b.r]));
check('pierre fantôme en construction au relâchement', stoneBuild.length === 1 && stoneBuild[0][0] === stones.best[0] && stoneBuild[0][1] === stones.best[1], JSON.stringify(stoneBuild));
const badge1 = await page.locator('.tool[data-tool="stone"] .tool-count').innerText();
check('badge mis à jour (pierre en construction comptée)', badge1 !== badge0, `${badge0} → ${badge1}`);
await settle();
const placed = await page.evaluate(() => window.__state.game.stonesPlaced);
check('pierre posée à la fin de la construction', placed === 1, String(placed));
await page.evaluate(() => {
  const g = window.__state.game;
  g.stats.stones = g.stoneConf().max;
});
await page.waitForTimeout(120);
check('outil pierre désactivé à 0', (await page.locator('.tool[data-tool="stone"].empty').count()) === 1);

console.log('Pause sans voile et table des combos (B13, D5)');
await open('1-3');
const gauge = await rect('#rewind');
check('jauge de rembobinage compacte hors vague (B26)', gauge && gauge.width <= 50, JSON.stringify(gauge));
await page.locator('#rewind .rewind-track').click();
await page.waitForTimeout(100);
// l'indication s'écrit près du doigt, au-dessus de la jauge (§6.4), sans rouge
const gtip = await page.evaluate(() => ({ shown: !document.getElementById('tip').classList.contains('hidden'), bad: document.getElementById('tip').classList.contains('bad'), text: document.getElementById('tip').textContent, lane: !document.getElementById('lane').classList.contains('hidden') }));
check('toucher la jauge hors vague : indication neutre près du doigt, pas d’erreur rouge', gtip.shown && !gtip.bad && /%|Pleine/.test(gtip.text) && !gtip.lane, JSON.stringify(gtip));
slots = await slotsOf();
await page.evaluate((sl) => window.__state.game.placeTower('fire', sl[2][0], sl[2][1]), slots);
const fireName = await towerName('fire');
await page.locator('#btn-pause').click();
await page.waitForTimeout(200);
const veil = await page.evaluate(() => getComputedStyle(document.getElementById('modal')).backgroundColor);
const card = await rect('#modal .modal-card');
check('pause : pas de voile sombre plein écran', /rgba\(0, 0, 0, 0\)|transparent/.test(veil), veil);
check('pause : feuille moyenne (≤ 56 % de l’écran, §6.10)', card && card.height <= 844 * 0.56, JSON.stringify(card));
p = await at(slots[2][0], slots[2][1]);
await longPress(p);
check('en pause : appui long sur une lanterne ouvre sa fiche', (await page.locator('#info').innerText()).includes(fireName));
await page.locator('#info .sheet-close').click();
await page.waitForTimeout(100);
check('la feuille de pause revient', await visible('#modal .modal-card'));
await page.locator('#modal .btn', { hasText: 'Combos' }).click();
await page.waitForTimeout(150);
// §6.11 : liste des six paires (badges des deux éléments, nom, effet, contre quoi)
const cells = await page.locator('#modal .combo-row').count();
check('liste des combos : les six paires d’éléments', cells === 6, String(cells));
const ctGap = await page.locator('#modal .combo-row').evaluateAll((els) => {
  const rs = els.map((e) => e.getBoundingClientRect());
  let m = Infinity;
  for (let i = 1; i < rs.length; i++) m = Math.min(m, rs[i].top - rs[i - 1].bottom);
  return m;
});
check('liste des combos : lignes espacées d’au moins 8 px', ctGap >= 7.5, `${ctGap}`);
const det = await page.locator('#modal .combo-row').nth(1).innerText();
check('chaque combo : nom, effet, contre quoi', /Contre/.test(det) && det.length > 40, det);
check('formes des deux éléments sur chaque ligne', (await page.locator('#modal .combo-row .cr-pair .el-badge svg').count()) === 12);
check('« Reprendre » reste visible au pied de la liste', await page.locator('#modal .combos-actions .btn.primary').isVisible());
await page.locator('#modal [data-act="back"]').click();
await page.locator('#modal .btn.primary').click();
await page.waitForTimeout(100);
check('reprendre', !(await page.evaluate(() => window.__state.paused)));

console.log('Non-intrusif (B14, B15, B22) : couloir de messages (§6.4)');
await open('1-2'); // (1-1 : la bulle du tutoriel retient les messages 0–1)
// nouveau yokai : un message du couloir (portrait, force ; toucher = sa fiche), hors portails et sanctuaire
// (la bannière du titre est un moment fort : les messages 0–1 l'attendent, §7.3)
await page.waitForFunction(() => !window.__hud.bannerShown, null, { timeout: 5000 }).catch(() => {});
const held = await page.evaluate(() => ({ tut: window.__tutorial.showing, key: window.__tutorial.current, banner: window.__hud.bannerShown }));
await page.evaluate(() => {
  // (une bulle du tutoriel retient les messages 0–1 : on la retire, le sujet ici est le couloir)
  window.__tutorial.steps = [];
  window.__tutorial.hide();
  const g = window.__state.game;
  g.level.introduce = ['kamaitachi'];
  g.events.push({ type: 'spawn', enemy: { type: 'kamaitachi', x: 0, y: 0, boss: false } });
});
await page.waitForTimeout(400);
const spawnR = await page.evaluate(() => {
  const g = window.__state.game.grid;
  return [...g.spawns, ...g.goals].map((i) => {
    const p = window.__renderer.toScreen(g.col(i), g.row(i));
    return { x: p.x, y: p.y, w: window.__renderer.ts };
  });
});
const overSG = (ir) => spawnR.some((s) => ir && ir.x < box.x + s.x + s.w && ir.x + ir.width > box.x + s.x && ir.y < box.y + s.y + s.w && ir.y + ir.height > box.y + s.y);
let ir = await rect('#lane');
const laneTxt = await page.locator('#lane').innerText().catch(() => '');
const kamaName = await page.evaluate(() => window.__state.game.defs.enemies.kamaitachi.name);
check('nouveau yokai : message du couloir (≤ 2 lignes), hors portails et sanctuaire', ir && ir.height <= 64 && !overSG(ir) && laneTxt.includes(kamaName) && (await page.locator('#lane .lane-ico img').count()) === 1, JSON.stringify({ ir, laneTxt, held, cur: await page.evaluate(() => window.__hud.lane.cur?.text) }));
await page.locator('#lane').click();
await page.waitForTimeout(200);
check('toucher le message ouvre la fiche du yokai', (await page.evaluate(() => window.__sheets.cur?.kind)) === 'enemy' && (await page.locator('#info').innerText()).includes(kamaName));
await page.locator('#info .sheet-close').click();
await page.waitForTimeout(100);
// une alerte (toast « mauvais ») : un seul message visible, toujours hors portails
await page.evaluate(() => window.__hud.toast('Test', true));
await page.waitForTimeout(300);
ir = await rect('#lane');
const lanes = await page.evaluate(() => ({ n: [...document.querySelectorAll('#lane, #toast, .toast')].filter((e) => !e.classList.contains('hidden') && e.getClientRects().length).length, text: document.getElementById('lane').innerText, p2: document.getElementById('lane').classList.contains('p2') }));
check('un seul message à la fois (alerte en priorité 2), hors portails et sanctuaire', lanes.n === 1 && /Test/.test(lanes.text) && lanes.p2 && !overSG(ir), JSON.stringify({ lanes, ir }));
await open('1-1');
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
  const slW = await slotsOf('water');
  const slE = await slotsOf('earth');
  const occ = () => game().then((g) => new Set(g.towers.map((t) => `${t.c},${t.r}`)));
  // toucher : pose sur le socle touché
  await tap(await center('.tool[data-tool="fire"]'));
  const a = sl.find(([c, r]) => r >= 4);
  await tap(await at(a[0], a[1]));
  check('doigt : un toucher pose sur le socle touché', (await occ()).has(`${a[0]},${a[1]}`));
  // doigt maintenu 60 px sous un socle, puis relâché : pose sous le fantôme
  let o = await occ();
  const b = slW.find(([c, r]) => r >= 2 && !o.has(`${c},${r}`));
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
  const d = slE.find(([c, r]) => r >= 4 && !o.has(`${c},${r}`));
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
// palette simple : pastille (forme + kanji) et nom ; le mot de l'élément est dans l'étiquette lue
const shapes = await page.locator('#palette .tool .el-badge svg').count();
const names = await page.locator('#palette .tool').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
check('chaque lanterne : forme + libellé français (lu)', shapes >= 2 && names.some((n) => /Feu/.test(n)) && names.some((n) => /Eau/.test(n)), JSON.stringify(names));
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

// ═════════════ Moteur v3, au doigt (événements tactiles réels) ═════════════
{
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, q) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: q.x, y: q.y, id: 1, radiusX: 8, radiusY: 8 }] });
  const tap = async (q, ms = 60) => {
    await touch('touchStart', q);
    await page.waitForTimeout(ms);
    await touch('touchEnd');
    await page.waitForTimeout(160);
  };
  const hold = async (q, ms = 650) => {
    await touch('touchStart', q);
    await page.waitForTimeout(ms);
    await touch('touchEnd');
    await page.waitForTimeout(200);
  };
  const swipe = async (a, b, steps = 12) => {
    await touch('touchStart', a);
    for (let k = 1; k <= steps; k++) {
      await touch('touchMove', { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(60);
    await touch('touchEnd');
    await page.waitForTimeout(200);
  };
  const center = async (sel) => {
    const r = await page.locator(sel).first().boundingBox();
    return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const rects = (sel) => page.locator(sel).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.width).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height, r: r.right })));
  const minGap = (rs) => {
    let m = Infinity;
    for (const a of rs) for (const b of rs) if (a !== b && Math.abs(a.y - b.y) < 4 && b.x > a.x) m = Math.min(m, b.x - a.r);
    return m;
  };
  const toast = () => page.locator('#lane').innerText();
  // zone tactile réelle (pseudo-éléments compris : onglets de 30 étendus à 44) : sondée au
  // pixel depuis le centre
  const hitRects = (sel) =>
    page.locator(sel).evaluateAll((els) =>
      els
        .filter((e) => e.getBoundingClientRect().width)
        .map((b) => {
          const r = b.getBoundingClientRect();
          const inside = (x, y) => {
            const h = document.elementFromPoint(x, y);
            return !!h && b.contains(h); // (le bouton, ses enfants ou ses pseudo-éléments)
          };
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const ext = (dx, dy) => {
            let k = 0;
            while (k < 60 && inside(cx + dx * (k + 1), cy + dy * (k + 1))) k++;
            return k + 0.5;
          };
          // (sondé seulement dans le sens où la boîte visible fait moins de 44)
          const x = r.width < 44 ? Math.min(r.left, cx - ext(-1, 0)) : r.left;
          const right = r.width < 44 ? Math.max(r.right, cx + ext(1, 0)) : r.right;
          const y = r.height < 44 ? Math.min(r.top, cy - ext(0, -1)) : r.top;
          const bottom = r.height < 44 ? Math.max(r.bottom, cy + ext(0, 1)) : r.bottom;
          return { x, y, w: right - x, h: bottom - y, r: right };
        }),
    );

  console.log('1. Palette regroupée par élément (onglets, ≥ 44 pt, sans défilement caché)');
  await open('2-1');
  const tabs = await hitRects('#palette-tabs .ptab');
  check('quatre onglets d’éléments (forme + kanji + libellé)', tabs.length === 4 && (await page.locator('#palette-tabs .ptab .el-badge svg').count()) === 4 && (await page.locator('#palette-tabs .ptab-label').allInnerTexts()).join() === 'Feu,Eau,Vent,Terre', JSON.stringify(tabs.length));
  check('onglets : zone tactile ≥ 44 pt, espacés ≥ 8 px', tabs.every((r) => r.h >= 44 && r.w >= 44) && minGap(tabs) >= 7.5, JSON.stringify(tabs));
  let tools = await rects('#palette .tool');
  check('seules les lanternes de l’élément choisi sont affichées (3)', tools.length === 3, String(tools.length));
  check('lanternes ≥ 44 pt, espacées ≥ 8 px', tools.every((r) => r.h >= 44 && r.w >= 44) && minGap(tools) >= 7.5, JSON.stringify(tools));
  const pal = await ev(() => {
    const p = document.getElementById('palette');
    return { sw: p.scrollWidth, cw: p.clientWidth, doc: document.documentElement.scrollWidth, w: innerWidth };
  });
  check('aucun défilement horizontal caché', pal.sw <= pal.cw + 1 && pal.doc <= pal.w + 1, JSON.stringify(pal));
  const texts = await page.locator('#palette .tool:not(.off-tab)').allInnerTexts();
  check('chaque lanterne : nom court, rôle en un mot, coût', texts.every((t) => t.split('\n').filter(Boolean).length >= 3) && texts.some((t) => /Mortier/.test(t)), JSON.stringify(texts));
  await tap(await center('.ptab[data-el="water"]'));
  const shown = await page.locator('#palette .tool:not(.off-tab)').evaluateAll((els) => els.map((e) => e.dataset.tool));
  check('toucher un onglet affiche ses lanternes', shown.join() === 'water,water_spring,water_torrent' && (await page.locator('.ptab.on').getAttribute('data-el')) === 'water', shown.join());
  await ev(() => (window.__state.game.gold = 50));
  await page.waitForTimeout(120);
  const poor = await page.locator('#palette .tool.poor:not(.off-tab)').evaluateAll((els) => els.map((e) => e.dataset.tool));
  check('lanternes trop chères grisées', poor.includes('water_torrent') && !poor.includes('water'), poor.join());
  await ev(() => (window.__state.game.gold = 999));
  await hold(await center('.ptab[data-el="wind"]'));
  let sheet = await page.locator('#info').innerText();
  check('appui long sur un onglet : fiche de l’élément (ses lanternes, socles gravés)', /Vent/.test(sheet) && /Carillon/.test(sheet) && /Socles/.test(sheet), sheet.slice(0, 120));
  await tap(await center('#info .sheet-close'));
  await hold(await center('.tool[data-tool="water_torrent"]'));
  sheet = await page.locator('#info').innerText();
  check('appui long sur une lanterne : fiche avant achat (gardée)', (await ev(() => window.__sheets.cur?.kind)) === 'type' && sheet.includes(await towerName('water_torrent')) && !(await game()).tool);
  await tap(await center('#info .sheet-close'));
  await open('1-1');
  check('une lanterne par élément : rangée simple, sans onglets', (await page.locator('#palette-tabs.hidden').count()) === 1 && (await rects('#palette .tool')).length === 4);

  console.log('2. Socles gravés (atténués / compatibles, refus « Socle réservé »)');
  await open('2-1');
  await ev(() => (window.__state.game.gold = 999));
  const typed = await ev(() => {
    const g = window.__state.game.grid;
    const out = {};
    for (let i = 0; i < g.size; i++) if (g.slotElement[i] && !out[g.slotElement[i]]) out[g.slotElement[i]] = [g.col(i), g.row(i)];
    return out;
  });
  // pixel au centre d'un socle gravé du Feu, avant / après le choix d'une lanterne d'Eau
  const px = (c, r) =>
    ev(([c, r]) => {
      const rd = window.__renderer;
      rd.render(0, 0, window.__input.ui);
      const p = rd.toScreen(c + 0.2, r + 0.75);
      const d = rd.ctx.getImageData(Math.round(p.x * rd.dpr), Math.round(p.y * rd.dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    }, [c, r]);
  const before = await px(...typed.fire);
  await tap(await center('.ptab[data-el="water"]'));
  await tap(await center('.tool[data-tool="water"]'));
  const after = await px(...typed.fire);
  const diff = Math.abs(before[0] - after[0]) + Math.abs(before[1] - after[1]) + Math.abs(before[2] - after[2]);
  check('lanterne choisie : socle gravé d’un autre élément atténué (voile + forme)', diff > 20, JSON.stringify({ before, after }));
  let q = await at(typed.fire[0], typed.fire[1], LIFT);
  await touch('touchStart', q);
  await page.waitForTimeout(560);
  await touch('touchMove', { x: q.x + 2, y: q.y + 1 });
  await page.waitForTimeout(60);
  const lab = await ev(() => window.__renderer.pressLabel(window.__input.ui.press));
  const pr = await ui();
  check('viser un socle du Feu avec l’Eau : « ▲ Socle réservé au Feu »', pr.press?.reason === 'slotElement' && /▲ Socle réservé au Feu/.test(lab?.text || ''), JSON.stringify(lab));
  await touch('touchEnd');
  await page.waitForTimeout(200);
  check('rien n’est posé sur un socle d’un autre élément', !(await game()).towers.some((t) => t.c === typed.fire[0] && t.r === typed.fire[1]));
  check('la règle est expliquée une fois (couloir)', /n’accepte que/.test(await toast()), await toast());
  if (!(await game()).tool) await tap(await center('.tool[data-tool="water"]'));
  q = await at(typed.water[0], typed.water[1]);
  await tap(q);
  check('socle gravé de l’Eau : la lanterne d’Eau s’y pose', (await game()).towers.some((t) => t.c === typed.water[0] && t.r === typed.water[1]));

  console.log('3. Murs des Gardiens, fiches v3');
  await page.waitForTimeout(3200);
  const occG = new Set((await game()).towers.map((t) => `${t.c},${t.r}`));
  const gSlot = (await slotsOf('earth_guard')).find(([c, r]) => r >= 3 && !occG.has(`${c},${r}`));
  const placedGuard = await ev(([c, r]) => !!window.__state.game.placeTower('earth_guard', c, r), gSlot);
  await page.waitForTimeout(3300);
  const guard = (await game()).towers.find((t) => t.type === 'earth_guard');
  check('Gardien posé (mur dressé)', placedGuard && (await ev(() => window.__state.game.barriers.length)) === 1);
  await tap(await at(guard.c, guard.r));
  const bar = await page.locator('#tower-bar button').evaluateAll((bs) => bs.map((b) => b.dataset.act));
  check('barre d’actions du Gardien : « Déplacer le mur » (pas de priorité)', bar.join() === 'rally,info,sell', bar.join());
  await tap(await center('#tower-bar .tb-rally'));
  const rallyOn = await ev(() => window.__input.ui.rally);
  check('mode « Déplacer le mur » : la barre s’efface, les cases s’allument', !!rallyOn && !(await visible('#tower-bar')) && (await ev(() => window.__overlay.rallyCache?.tiles.length)) > 0);
  const target = await ev(() => {
    const g = window.__state.game;
    const b = g.barriers[0];
    const i = window.__overlay.rallyCache.tiles.find((x) => x !== b.tile);
    return i == null ? null : { i, c: g.grid.col(i), r: g.grid.row(i), from: b.tile };
  });
  if (target) {
    await tap(await at(target.c, target.r));
    const movingWall = await ev(() => window.__renderer.builds.filter((b) => b.op === 'setRally').map((b) => [b.c, b.r]));
    check('toucher une case allumée : le mur se construit sur la case (2 s)', movingWall.length === 1 && movingWall[0][0] === target.c && movingWall[0][1] === target.r && (await ev(() => window.__state.game.barriers[0].tile)) === target.from, JSON.stringify(movingWall));
    await settle();
    check('toucher une case allumée y déplace le mur (setRally)', (await ev(() => window.__state.game.barriers[0].tile)) === target.i && !(await ev(() => window.__input.ui.rally)));
  } else check('une case où déplacer le mur', false, 'aucune case');
  await tap(await center('#tower-bar .tb-rally'));
  await tap(await at(0, 0));
  check('toucher ailleurs annule le mode', !(await ev(() => window.__input.ui.rally)));
  await ev((id) => window.__sheets.open('tower', id), guard.id);
  await page.waitForTimeout(150);
  const hp0 = await page.locator('#info .hpbar.wall span').innerText();
  await ev(() => (window.__state.game.barriers[0].hp -= 50));
  await page.waitForTimeout(150);
  const hp1 = await page.locator('#info .hpbar.wall span').innerText();
  check('fiche du Gardien : PV du mur en direct', /Mur \d+ \/ \d+ PV/.test(hp0) && hp0 !== hp1, `${hp0} → ${hp1}`);
  await tap(await center('#info .sheet-close'));
  // résistance du kappa à l'Eau, lue dans les données (l'équilibrage peut la changer)
  const kappaRes = await ev(() => Math.round((window.__state.game.defs.enemies.kappa.resist?.water ?? 0) * 100));
  for (const [type, want] of [
    ['kappa', ['Armure', 'Résistances', 'Eau', `−${kappaRes} %`, 'Murs', 'frappe']],
    ['ushioni', ['Armure', 'fracasse les murs']],
    ['kasaobake', ['Saute par-dessus les murs']],
    ['tokihami', ['Hors du temps']],
    ['yukionna', ['insensible', '+40 %']],
  ]) {
    await ev((t) => {
      window.__sheets.open('enemy', { type: t });
      window.__sheets.grow(true); // « Détails ⌃ » : résistances, murs…
    }, type);
    await page.waitForTimeout(120);
    const txt = await page.locator('#info').innerText();
    check(`fiche ${type} : ${want.join(', ')}`, want.every((w) => txt.includes(w)), txt.replace(/\n/g, ' | ').slice(0, 220));
  }
  // lanterne accélérée par un Carillon
  const boosted = await ev(() => {
    const g = window.__state.game;
    const gr = g.grid;
    const free = (t, i) => gr.type(i) === 3 && g.canPlaceTower(t, gr.col(i), gr.row(i)).ok;
    for (let a = 0; a < gr.size; a++) {
      if (!free('fire', a)) continue;
      for (let b = 0; b < gr.size; b++) {
        if (b === a || !free('wind_chime', b) || Math.hypot(gr.cx(a) - gr.cx(b), gr.cy(a) - gr.cy(b)) > 1.6) continue;
        const t = g.placeTower('fire', gr.col(a), gr.row(a));
        g.placeTower('wind_chime', gr.col(b), gr.row(b));
        return t.id;
      }
    }
    return null;
  });
  if (boosted != null) {
    await ev((id) => {
      window.__sheets.open('tower', id);
      window.__sheets.grow(true);
    }, boosted);
    await page.waitForTimeout(150);
    const txt = await page.locator('#info').innerText();
    check('fiche d’une lanterne : élément, cibles, armure, soutien du Carillon', ['Élément', 'Cibles', 'Armure', 'Carillon : cadence +'].every((w) => txt.includes(w)), txt.replace(/\n/g, ' | ').slice(0, 260));
    await tap(await center('#info .sheet-close'));
  } else check('un Carillon à côté d’une lanterne', false);
  await ev(() => {
    window.__sheets.open('type', 'earth_quake');
    window.__sheets.grow(true);
  });
  await page.waitForTimeout(120);
  sheet = await page.locator('#info').innerText();
  check('fiche avant achat : brise-armure et socles gravés expliqués', /Brise l’armure/.test(sheet) && /Un socle gravé n’accepte que son élément/.test(sheet), sheet.slice(0, 160));
  await tap(await center('#info .sheet-close'));

  console.log('4. Vagues qui se chevauchent : appel anticipé, climax, compte à rebours');
  await open('1-1');
  await ev(() => {
    const g = window.__state.game;
    g.gold = 999;
    const gr = g.grid;
    for (let i = 0, n = 0; i < gr.size && n < 4; i++) if (gr.type(i) === 3 && g.placeTower('fire', gr.col(i), gr.row(i))) n++;
  });
  await tap(await center('#btn-wave'));
  await page.waitForTimeout(1500);
  const sub1 = await ev(() => ({ dial: document.getElementById('btn-wave-kanji').textContent, sub: document.getElementById('btn-wave-sub').textContent }));
  check('pendant une vague : secondes dans le cadran et « ◉ +X » visibles', (await ev(() => window.__state.game.state)) === 'wave' && /^\d+$/.test(sub1.dial) && /^\+\d+$/.test(sub1.sub) && (await page.locator('#btn-wave.disabled').count()) === 0, JSON.stringify(sub1));
  const pvb = await ev(() => window.__state.game.nextWavePreview());
  const gold0 = await ev(() => window.__state.game.gold);
  await tap(await center('#btn-wave'));
  const w2 = await ev(() => window.__state.game.waveIndex);
  check('appel anticipé pendant une vague (vague suivante lancée)', w2 === 1, String(w2));
  await page.waitForTimeout(700); // pièces du bouton au sceau 金 (immédiates avec « réduire les animations »)
  const gold1 = await ev(() => ({ g: window.__state.game.gold, hud: Number(document.getElementById('hud-gold').textContent) }));
  check('bonus d’appel versé (pièces vers 金), sans message global', pvb.bonus > 0 && gold1.g >= gold0 + pvb.bonus && gold1.hud === Math.floor(gold1.g) && !/Appel anticipé/.test(await toast()), JSON.stringify({ gold0, gold1, bonus: pvb.bonus, lane: await toast() }));
  // pause douce : fiche ouverte quand plus aucun yokai n'est en jeu
  await ev(() => {
    const g = window.__state.game;
    for (const s of g.spawners) s.spawned = s.count;
    g.enemies = [];
  });
  await page.waitForTimeout(200);
  await ev(() => window.__sheets.open('wave'));
  const cdA = await ev(() => window.__state.game.nextWaveT);
  await page.waitForTimeout(700);
  const cdB = await ev(() => window.__state.game.nextWaveT);
  check('pause douce : fiche ouverte entre deux vagues, le compte à rebours attend', Math.abs(cdA - cdB) < 0.01, `${cdA} → ${cdB}`);
  await tap(await center('#info .sheet-close'));
  await page.waitForTimeout(500);
  check('fiche fermée : le compte à rebours reprend', (await ev(() => window.__state.game.nextWaveT)) < cdB - 0.2);
  // climax : aperçu marqué, bannière nommée
  const cl = await ev(() => {
    const g = window.__state.game;
    const idx = g.waves.findIndex((w) => w.climax);
    window.__debug.jump(g, idx);
    return { idx, name: g.waves[idx].name };
  });
  await page.waitForTimeout(250);
  // §6.5 : climax suivant → « Climax » (secondes dans le cadran, filet or)
  check('vague climax marquée dans l’aperçu et sur le bouton', (await page.locator('#wave-preview.climax').count()) === 1 && (await page.locator('#btn-wave.climax').count()) === 1 && /Climax/.test(await page.locator('#btn-wave-label').innerText()), await page.locator('#btn-wave').innerText());
  await tap(await center('#btn-wave'));
  await page.waitForTimeout(250);
  const bn = await page.locator('#banner').innerText();
  check('bannière nommée du climax', bn.includes(cl.name) && /Climax/.test(bn), bn);
  const lastW = await ev(() => ({ label: document.getElementById('btn-wave-label').textContent, sub: document.getElementById('btn-wave-sub').textContent, total: window.__state.game.totalWaves }));
  check('dernière vague lancée : « Vague N · dernière »', lastW.label === `Vague ${lastW.total}` && lastW.sub === 'dernière', JSON.stringify(lastW));

  console.log('5. Jauge de Rembobinage et dernière chance');
  await open('2-2');
  await ev(() => (window.__save.data.rewindTutorialSeen = true));
  let gk = await ev(() => ({ k: getComputedStyle(document.getElementById('rewind')).getPropertyValue('--k'), cls: document.getElementById('rewind').className, ratio: window.__state.game.rewindRatio() }));
  check('jauge compacte : l’anneau suit la charge', /compact/.test(gk.cls) && Math.abs(Number(gk.k) - gk.ratio) < 0.01, JSON.stringify(gk));
  await tap(await center('#rewind .rewind-track'));
  const tipTxt = await ev(() => (document.getElementById('tip').classList.contains('hidden') ? '' : document.getElementById('tip').textContent));
  check('toucher la jauge : la charge et comment la remplir (près du doigt)', /\d+ % : se remplit/.test(tipTxt), tipTxt);
  await hold(await center('#rewind .rewind-track'));
  check('appui long sur la jauge : la règle (échos remboursés, hors du temps)', (await ev(() => window.__sheets.cur?.kind)) === 'rewind' && /remboursées à 100 %/.test(await page.locator('#info').innerText()) && /Hors du temps/.test(await page.locator('#info').innerText()));
  await tap(await center('#info .sheet-close'));
  await tap(await center('#btn-wave'));
  await page.waitForTimeout(400);
  await ev(() => (window.__state.game.rewindCharge += 30));
  await page.waitForTimeout(700);
  check('gain de charge visible (« +30 巻 »)', /\+30 巻/.test(await page.locator('#rewind').innerText()), await page.locator('#rewind').innerText());
  await ev(() => (window.__state.game.rewindCharge = window.__state.game.rules.rewindCost));
  await page.waitForTimeout(2600);
  gk = await ev(() => document.getElementById('rewind').className);
  check('pleine et utilisable : elle s’illumine et s’allonge', /full/.test(gk) && /ready/.test(gk) && !/compact/.test(gk), gk);
  // dernière chance
  await ev(() => {
    const g = window.__state.game;
    g.lives = 1;
    g.leak(g.enemies.find((e) => e.alive && !e.flying && !e.timeless) || g.enemies[0]);
  });
  await page.waitForTimeout(250);
  const lc = await ev(() => ({ t: window.__state.game.lastChanceT, ov: !document.getElementById('last-chance').classList.contains('hidden'), cnt: document.getElementById('lc-count').textContent, pe: getComputedStyle(document.querySelector('#palette .tool')).pointerEvents, wave: getComputedStyle(document.getElementById('btn-wave')).pointerEvents }));
  check('dernière chance : « Rembobinez ! » et compte à rebours au-dessus du plateau', lc.t > 0 && lc.ov && /^[1-4]$/.test(lc.cnt), JSON.stringify(lc));
  check('dernière chance : le reste de l’interface est inactif', lc.pe === 'none' && lc.wave === 'none', JSON.stringify(lc));
  const k = await page.locator('#rewind .rewind-knob').boundingBox();
  const tr = await page.locator('#rewind .rewind-track').boundingBox();
  await swipe({ x: k.x + k.width / 2, y: k.y + k.height / 2 }, { x: tr.x + 8, y: k.y + k.height / 2 });
  await page.waitForTimeout(1600);
  const after2 = await ev(() => ({ used: window.__state.game.rewindsUsed, lives: window.__state.game.lives, state: window.__state.game.state, ov: !document.getElementById('last-chance').classList.contains('hidden') }));
  check('glisser la jauge sauve le sanctuaire (rembobinage, appel masqué)', after2.used === 1 && after2.lives > 0 && after2.state === 'wave' && !after2.ov, JSON.stringify(after2));

  console.log('6. Carte : leçons, Difficile, défi, sauvegarde');
  await page.goto(HOME, { waitUntil: 'networkidle' });
  // ancienne sauvegarde (étoiles seules) et champs abîmés : nettoyées, compatibles
  await ev(() => localStorage.setItem('jardin-des-esprits:v1', JSON.stringify({ stars: { '1-1': 3, '1-2': '2', bad: 'x' }, hard: { '1-1': 9, z: -1 }, challenge: { '1-2': 'oui' }, muted: 'non' })));
  await page.reload({ waitUntil: 'networkidle' });
  const sv = await ev(() => JSON.parse(JSON.stringify(window.__save.data)));
  check('sauvegarde : compatibilité et nettoyage (stars, hard, challenge)', sv.stars['1-1'] === 3 && sv.stars['1-2'] === 2 && !sv.stars.bad && sv.hard['1-1'] === 3 && !sv.hard.z && !sv.challenge['1-2'] && sv.muted === false, JSON.stringify(sv));
  await tap(await center('#btn-levels'));
  await page.waitForTimeout(900);
  // étiquette de chaque nœud : « 1-1 · Le Seuil » + leçon (« Scellé » pour un niveau fermé ; sa leçon reste lue)
  const concepts = await page.locator('.map-node').evaluateAll((ns) => ns.map((n) => `${n.querySelector('.map-label')?.innerText.replace(/\s+/g, ' ')} | ${n.getAttribute('aria-label')}`));
  check('carte : le nom et la leçon de chaque niveau', concepts.length === 8 && concepts.every((c) => /leçon : /.test(c)) && concepts.some((c) => /^1-1 · Le Seuil Poser et lancer/.test(c)), concepts.join(' || '));
  check('carte : marque Difficile sur le nœud', (await page.locator('.map-node .node-mark.hard').count()) === 1);
  await tap(await center('.map-node'));
  await page.waitForTimeout(400);
  let card = await page.locator('#modal').innerText();
  check('fiche de niveau : leçon, option Difficile (3 ★) et défi', /leçon/i.test(card) && /Poser et lancer/.test(card) && /Difficile/.test(card) && /Défi : /.test(card), card.slice(0, 200));
  const optH = await page.locator('.lv-opt[data-opt="hard"]').boundingBox();
  check('options ≥ 44 pt', optH && optH.height >= 44);
  await page.locator('.lv-opt[data-opt="hard"]').scrollIntoViewIfNeeded(); // (la fiche défile sous « Jouer »)
  await tap(await center('.lv-opt[data-opt="hard"]'));
  await page.locator('.lv-opt[data-opt="challenge"]').scrollIntoViewIfNeeded();
  await tap(await center('.lv-opt[data-opt="challenge"]'));
  check('options activées (interrupteurs)', (await page.locator('.lv-opt[aria-pressed="true"]').count()) === 2);
  await tap(await center('#modal .btn.primary'));
  await page.waitForTimeout(800);
  const mode = await ev(() => ({ hard: window.__state.game.hard, ch: window.__state.game.challenge, lives: window.__state.game.lives, max: window.__state.game.maxLives }));
  check('partie lancée en Difficile avec le défi', mode.hard === true && mode.ch === true, JSON.stringify(mode));
  await ev(() => {
    const g = window.__state.game;
    g.waveIndex = g.waves.length - 1;
    g.state = 'wave';
    g.spawners = [];
    g.enemies = [];
  });
  await page.waitForTimeout(3300);
  card = await page.locator('#modal').innerText();
  const sv2 = await ev(() => JSON.parse(JSON.stringify(window.__save.data)));
  check('victoire : sceaux Difficile et défi, record enregistré', /Victoire en Difficile/.test(card) && /Défi réussi/.test(card) && sv2.hard['1-1'] >= 1 && sv2.challenge['1-1'] === true, JSON.stringify(sv2));
  // « Carte » : bouton texte de la carte de résultat (§6.12), actif après le verrou de 700 ms
  await page.waitForTimeout(800);
  await tap(await center('#modal .result-actions .btn.text'));
  await page.waitForTimeout(700);
  check('carte : sceau du défi réussi', (await page.locator('.map-node .node-mark.ch').count()) === 1);
  await tap(await center('.map-node:nth-of-type(2)'));
  await page.waitForTimeout(400);
  card = await page.locator('#modal').innerText();
  check('Difficile verrouillé avant 3 ★', /S’ouvre après 3 ★/.test(card) || !/Difficile/.test(card), card.slice(0, 200));
  await tap(await center('#modal .menu-x'));

  console.log('7. Tutoriel : appel anticipé, Gardien, priorité, jauge');
  await ev(() => localStorage.removeItem('jardin-des-esprits:v1'));
  await open('1-1');
  await ev(() => {
    const g = window.__state.game;
    g.gold = 999;
    const gr = g.grid;
    for (let i = 0, n = 0; i < gr.size && n < 3; i++) if (gr.type(i) === 3 && g.placeTower('fire', gr.col(i), gr.row(i))) n++;
    g.startNextWave();
    for (const s of g.spawners) s.spawned = s.count;
    g.enemies = [];
  });
  await page.waitForTimeout(3600);
  let hint = await page.locator('#hint .bubble').innerText().catch(() => '');
  check('« early » : appeler la vague suivante en avance (+or)', /en avance : \+\d+ or/.test(hint), hint);
  await tap(await center('#btn-wave'));
  await page.waitForTimeout(300);
  check('« early » validé par l’appel', (await ev(() => window.__tutorial.done.has('early'))) === true);
  await open('2-1');
  await ev(() => {
    const g = window.__state.game;
    const gr = g.grid;
    for (let i = 0; i < gr.size; i++) if (gr.type(i) === 3 && !gr.slotElement[i] && g.placeTower('fire', gr.col(i), gr.row(i))) break;
  });
  await page.waitForTimeout(3400);
  hint = await page.locator('#hint .bubble').innerText().catch(() => '');
  check('« priority » : toucher une lanterne', /régler sa cible/.test(hint), hint);
  const ft = (await game()).towers[0];
  await tap(await at(ft.c, ft.r));
  await page.waitForTimeout(250);
  hint = await page.locator('#hint .bubble').innerText().catch(() => '');
  check('« priority » : puis le bouton de priorité', /visez « Fort »/i.test(hint), hint);
  await tap(await center('#tower-bar .tb-prio'));
  await page.waitForTimeout(250);
  hint = await page.locator('#hint .bubble').innerText().catch(() => '');
  check('« priority » : les quatre choix ouverts, viser « Fort »', /Visez « Fort »/.test(hint) && (await page.locator('#tower-bar .tb-pick').count()) === 4, hint);
  await tap(await center('#tower-bar .tb-pick[data-p="strong"]'));
  await page.waitForTimeout(150);
  check('« priority » validé', (await ev(() => window.__tutorial.done.has('priority'))) === true);
  await open('1-4');
  await ev(() => {
    const g = window.__state.game;
    g.gold = 999;
    const gr = g.grid;
    for (let i = 0; i < gr.size; i++) if (gr.type(i) === 3 && !gr.slotElement[i] && g.placeTower('fire', gr.col(i), gr.row(i))) break;
    window.__tutorial.done.add('stone');
  });
  await page.waitForTimeout(3400);
  hint = await page.locator('#hint .bubble').innerText().catch(() => '');
  check('« barrier » : trouver le Gardien (onglet Terre, puis la lanterne)', /Terre|Gardien/.test(hint), hint);
  await tap(await center('.ptab[data-el="earth"]'));
  await tap(await center('.tool[data-tool="earth_guard"]'));
  await page.waitForTimeout(200);
  hint = await page.locator('#hint .bubble').innerText().catch(() => '');
  const gs = await ev(() => {
    const t = window.__tutorial;
    const g = window.__state.game;
    return t.bestSlot(g, g.defs.towers.earth_guard.levels[0].range, 'earth');
  });
  check('« barrier » : poser le Gardien près du chemin', /Posez-le/.test(hint) && !!gs, hint);
  await tap(await at(gs.c, gs.r));
  await page.waitForTimeout(3400);
  await tap(await at(gs.c, gs.r));
  await page.waitForTimeout(250);
  hint = await page.locator('#hint .bubble').innerText().catch(() => '');
  check('« barrier » : « Déplacez son mur »', /Déplacez son mur/.test(hint), hint);
  await tap(await center('#tower-bar .tb-rally'));
  await page.waitForTimeout(250);
  hint = await page.locator('#hint .bubble').innerText().catch(() => '');
  const tileT = await ev(() => {
    const g = window.__state.game;
    const b = g.barriers[0];
    const i = window.__overlay.rallyCache.tiles.find((x) => x !== b.tile);
    return { c: g.grid.col(i), r: g.grid.row(i) };
  });
  check('« barrier » : « Touchez une case allumée »', /case allumée/.test(hint), hint);
  await tap(await at(tileT.c, tileT.r));
  await settle(); // le mur se dresse à la fin de sa construction
  await page.waitForTimeout(150); // (événements lus à l'image suivante)
  check('« barrier » validé par le déplacement du mur', (await ev(() => window.__tutorial.done.has('barrier'))) === true);
  await open('1-3');
  await ev(() => window.__state.game.startNextWave());
  await page.waitForTimeout(3300);
  const rw = await page.locator('#modal').innerText();
  check('« rewind » : la jauge, les échos remboursés, les yokai hors du temps', /jauge/.test(rw) && /remboursées à 100 %/.test(rw) && /hors du temps/i.test(rw), rw.slice(0, 160));
  await tap(await center('#modal .btn.primary'));

  console.log('8. Panneau de débogage caché');
  await page.goto(HOME, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  check('invisible par défaut', !(await visible('.debug-card')));
  const tw = await center('#screen-title .title-wrap');
  for (let k = 0; k < 4; k++) await tap(tw, 30);
  check('quatre touchers ne suffisent pas', !(await visible('.debug-card')));
  await tap(tw, 30);
  check('cinq touchers rapides sur le titre : panneau ouvert', await visible('.debug-card'));
  const dbtn = await rects('.debug-card button');
  check('boutons du panneau ≥ 44 pt', dbtn.every((r) => r.h >= 43.5 && r.w >= 43.5), JSON.stringify(dbtn));
  await tap(await center('[data-dbg="unlock"]'));
  await tap(await center('[data-dbg="gold"]'));
  await tap(await center('[data-dbg="fast"]'));
  await tap(await center('[data-dbg="close"]'));
  await tap(await center('#btn-levels'));
  await page.waitForTimeout(800);
  check('déverrouiller tous les niveaux', (await page.locator('.map-node.locked').count()) === 0);
  await tap(await center('.map-node:nth-of-type(6)'));
  await page.waitForTimeout(400);
  await tap(await center('#modal .btn.primary'));
  await page.waitForTimeout(900);
  const dg = await ev(() => ({ gold: window.__state.game.gold, speed: window.__state.speed }));
  check('or infini et vitesse ×4', dg.gold >= 99999 && dg.speed === 4, JSON.stringify(dg));
  await tap(await center('#btn-pause'));
  await tap(await center('#modal .btn:has-text("Débogage")'));
  for (let k = 0; k < 4; k++) await tap(await center('[data-dbg="plus"]'));
  await tap(await center('[data-dbg="charge"]'));
  const ch = await ev(() => window.__state.game.rewindRatio());
  await tap(await center('[data-dbg="go"]'));
  await page.waitForTimeout(300);
  const wv = await ev(() => ({ w: window.__state.game.waveIndex, paused: window.__state.paused }));
  check('remplir la jauge', ch === 1, String(ch));
  check('aller à la vague 5 (enchaîne les appels)', wv.w === 4 && !wv.paused, JSON.stringify(wv));
  await ev(() => {
    window.__debug.infiniteGold = false;
    window.__debug.fast = false;
    window.__save.set('unlockAll', false);
  });
  await cdp.detach();
}

console.log('9. Recette solo au doigt (défauts corrigés)');
{
  // Doigt simulé dans un contexte donné (taille d'écran), erreurs console comprises.
  const finger = async (c) => {
    const pg = await c.newPage();
    pg.on('pageerror', (e) => errors.push(e.message));
    pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const cd = await c.newCDPSession(pg);
    const touch = (type, q) => cd.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: q.x, y: q.y, id: 1, radiusX: 8, radiusY: 8 }] });
    const f = {
      pg,
      touch,
      ev: (fn, arg) => pg.evaluate(fn, arg),
      wait: (ms) => pg.waitForTimeout(ms),
      // constructions achevées sans attendre leurs 2 s
      settle: () =>
        pg.evaluate(() => {
          const g = window.__state.game;
          for (const e of g.queue) e.frame = Math.min(e.frame, g.frame + 1);
          g.update(1 / 60);
        }),
      tap: async (q, ms = 60) => {
        await touch('touchStart', q);
        await pg.waitForTimeout(ms);
        await touch('touchEnd');
        await pg.waitForTimeout(150);
      },
      // glisser au doigt de a vers b
      slide: async (a, b, n = 14) => {
        await touch('touchStart', a);
        await pg.waitForTimeout(40);
        for (let k = 1; k <= n; k++) {
          await touch('touchMove', { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
          await pg.waitForTimeout(16);
        }
        await pg.waitForTimeout(100);
      },
      center: async (sel) => {
        const r = await pg.locator(sel).first().boundingBox();
        return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      },
      open: async (q) => {
        await pg.goto(`http://localhost:8080/?${q}`, { waitUntil: 'networkidle' });
        await pg.waitForTimeout(500);
        f.box = await pg.locator('#board').boundingBox();
      },
      at: (c2, r2, dy = 0) => pg.evaluate(([c2, r2]) => window.__renderer.toScreen(c2 + 0.5, r2 + 0.5), [c2, r2]).then((q) => ({ x: f.box.x + q.x, y: f.box.y + q.y + dy })),
      // libellé visible de la jauge : la variante affichée tient-elle dans la piste ?
      gaugeLabel: () =>
        pg.evaluate(() => {
          const l = document.querySelector('#rewind .rewind-label');
          const vis = [...l.children].find((x) => getComputedStyle(x).display !== 'none');
          return { text: vis ? vis.textContent : l.textContent, need: vis ? vis.getBoundingClientRect().width : l.scrollWidth, room: l.clientWidth };
        }),
      // charge la jauge pendant une vague (au moins 2 s de passé)
      readyGauge: async () => {
        await f.tap(await f.center('#btn-wave'));
        await pg.waitForTimeout(3300);
        await pg.evaluate(() => {
          const g = window.__state.game;
          g.rewindCharge = g.rules.rewindCost;
        });
        await pg.waitForTimeout(250);
      },
    };
    return f;
  };
  const sizes = [
    [375, 667],
    [390, 844],
    [430, 932],
  ];
  for (const [w, h] of sizes) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const f = await finger(c);
    await f.open('level=1-3');
    await f.ev(() => window.__save.set('rewindTutorialSeen', true));
    await f.ev(() => (window.__tutorial.rewindPhase = 0));
    await f.readyGauge();
    const lab = await f.gaugeLabel();
    check(`${w} px : jauge prête, libellé entier (« ${lab.text} »)`, lab.need <= lab.room + 0.5 && /◀◀/.test(lab.text), JSON.stringify(lab));
    if (w === 390) {
      // simple toucher sur la jauge prête : le geste est rappelé
      await f.tap(await f.center('#rewind .rewind-track'));
      // double toucher (alternative au glisser) : le premier arme (« Encore −6 s »), rien ne recule
      const t = await f.ev(() => ({ armed: document.getElementById('rewind').classList.contains('tap-armed'), label: document.querySelector('#rewind .rewind-label').textContent, anim: !!window.__state.game.rewindAnim }));
      check('jauge prête : un premier toucher arme (« Encore −6 s »), le temps ne recule pas encore', !t.anim && t.armed && /Encore −\d+ s/.test(t.label), JSON.stringify(t));
      // une lanterne posée juste avant : elle deviendra un écho
      const slot = await f.ev(() => {
        const game = window.__state.game;
        const g = game.grid;
        for (let i = 0; i < g.size; i++) if (g.type(i) === 3 && !g.slotElement[i] && !game.towerAt(g.col(i), g.row(i))) return [g.col(i), g.row(i)];
        return null;
      });
      await f.ev(([c2, r2]) => window.__state.game.placeTower('fire', c2, r2), slot);
      const kn = await f.ev(() => document.querySelector('#rewind .rewind-knob').getBoundingClientRect().toJSON());
      const a = { x: kn.x + kn.width / 2, y: kn.y + kn.height / 2 };
      await f.slide(a, { x: a.x - 200, y: a.y });
      const mid = await f.gaugeLabel();
      await f.touch('touchEnd');
      await f.wait(250);
      const anim = await f.gaugeLabel();
      check(`pendant le rembobinage, libellé entier (« ${anim.text} »)`, anim.need <= anim.room + 0.5, JSON.stringify({ mid, anim }));
      // toucher la jauge pendant l'animation : pas de « Jauge 0 % » trompeur
      await f.ev(() => window.__hud.lane.reset());
      await f.tap(await f.center('#rewind .rewind-track'));
      const during = await f.ev(() => ({ anim: !!window.__state.game.rewindAnim, toast: (document.querySelector('#lane:not(.hidden)')?.textContent || '') + (document.querySelector('#tip:not(.hidden)')?.textContent || '') }));
      check('toucher la jauge pendant le rembobinage : pas d’indication « 0 % »', during.anim && !/\d+ %/.test(during.toast), JSON.stringify(during));
      await f.wait(1100);
      const echo = await f.ev(() => window.__state.game.echoes.length);
      check('glisser la poignée au doigt : écho de la lanterne récente', echo >= 1, String(echo));
      await f.tap(await f.at(slot[0], slot[1], -8));
      const et = await f.ev(() => document.querySelector('#lane:not(.hidden)')?.textContent || '');
      check('toucher un écho : il se présente (lanterne, puissance, durée)', /Écho/.test(et) && /%/.test(et), et);
    }
    await c.close();
  }

  // Défi « sans Rembobinage » (1-3) : pas de leçon sur une jauge cachée
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const f = await finger(c);
    await f.open('level=1-1');
    await f.ev(() => {
      window.__save.set('rewindTutorialSeen', false);
      window.__startLevel('1-3', { challenge: true });
    });
    await f.wait(1200);
    await f.tap(await f.center('#btn-wave'));
    await f.wait(3800);
    const m = await f.ev(() => ({ modal: document.querySelector('#modal:not(.hidden) h2')?.textContent || null, paused: window.__state.paused, seen: window.__save.data.rewindTutorialSeen }));
    check('défi sans Rembobinage : aucune leçon sur la jauge cachée', !m.modal && !m.paused && !m.seen, JSON.stringify(m));
    await c.close();
  }

  // Tutoriel 1-2 suivi au doigt : combo (palette puis socle compatible), fusion
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const f = await finger(c);
    await f.open('level=1-2');
    const hint = () =>
      f.ev(() => {
        const h = document.querySelector('#hint:not(.hidden)');
        const fi = h?.querySelector('.finger');
        if (!fi) return null;
        const cs = getComputedStyle(fi);
        return { key: window.__tutorial.current?.split('|')[0], text: h.querySelector('.bubble').textContent, x: parseFloat(fi.style.left), y: parseFloat(fi.style.top), dx: parseFloat(cs.getPropertyValue('--dx')) || 0, dy: parseFloat(cs.getPropertyValue('--dy')) || 0 };
      });
    // une lanterne de Feu posée (le combo se fait à côté)
    await f.tap(await f.center('.tool[data-tool="fire"]'));
    const fs = await f.ev(() => {
      const game = window.__state.game;
      const g = game.grid;
      for (let i = 0; i < g.size; i++) {
        if (g.type(i) !== 3 || (g.slotElement[i] && g.slotElement[i] !== 'fire')) continue;
        const c2 = g.col(i);
        const r2 = g.row(i);
        // un voisin gravé d'un AUTRE élément : le piège de l'ancienne indication
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && g.inBounds(c2 + dx, r2 + dy) && g.type(g.idx(c2 + dx, r2 + dy)) === 3) return [c2, r2];
      }
      return null;
    });
    await f.tap(await f.at(fs[0], fs[1]));
    await f.settle(); // la lanterne s'allume (le combo se montre ensuite)
    await f.wait(900);
    let hi = await hint();
    check('combo, sans lanterne choisie : le doigt montre d’abord la palette', hi && (hi.key === 'combo-tool' || hi.key === 'combo-tab') && /prenez/.test(hi.text), JSON.stringify(hi));
    await f.tap({ x: hi.x, y: hi.y });
    await f.wait(500);
    hi = await hint();
    const tool = await f.ev(() => window.__input.ui.tool);
    const tile = hi && (await f.ev(([x, y]) => window.__renderer.toTile(x - document.querySelector('#board').getBoundingClientRect().left, y - document.querySelector('#board').getBoundingClientRect().top), [hi.x, hi.y]));
    const ok = tile && (await f.ev(([t, c2, r2]) => window.__state.game.canPlaceTower(t, c2, r2).ok && window.__state.game.previewCombos(t, c2, r2).length > 0, [tool, tile.c, tile.r]));
    check('combo : puis un socle compatible où le combo naît', hi?.key === 'combo' && ok, JSON.stringify({ hi, tool, tile }));
    await f.tap({ x: hi.x, y: hi.y });
    await f.wait(300);
    await f.settle();
    await f.wait(200);
    check('combo validé au doigt', await f.ev(() => window.__tutorial.done.has('combo') && window.__state.game.zones.length > 0));
    // fusion : deux Braseros jumeaux, le doigt glisse d'une lanterne SUR l'autre
    await f.ev(() => (window.__state.game.gold = 999));
    const fs2 = await f.ev(([c0, r0]) => {
      const game = window.__state.game;
      const g = game.grid;
      for (let i = 0; i < g.size; i++) {
        if (g.type(i) !== 3 || (g.slotElement[i] && g.slotElement[i] !== 'fire') || game.towerAt(g.col(i), g.row(i))) continue;
        if (Math.abs(g.col(i) - c0) + Math.abs(g.row(i) - r0) >= 2) return [g.col(i), g.row(i)];
      }
      return null;
    }, fs);
    await f.tap(await f.center('.tool[data-tool="fire"]'));
    await f.tap(await f.at(fs2[0], fs2[1]));
    await f.settle();
    await f.wait(700);
    hi = await hint();
    check('fusion : le doigt glisse d’une lanterne vers sa jumelle', hi?.key === 'fuse' && (hi.dx || hi.dy), JSON.stringify(hi));
    await f.slide({ x: hi.x, y: hi.y }, { x: hi.x + hi.dx, y: hi.y + hi.dy });
    await f.touch('touchEnd');
    await f.wait(300);
    const fu = await f.ev(() => ({ done: window.__tutorial.done.has('fuse'), lv: window.__state.game.towers.map((t) => t.level) }));
    check('fusion : le geste montré (doigt posé sur la jumelle) fusionne', fu.done && fu.lv.includes(2), JSON.stringify(fu));
    await c.close();
  }

  // 375 px : la bulle du tutoriel reste dans l'écran une fois la police chargée
  {
    const c = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const f = await finger(c);
    await f.open('level=1-1');
    await f.wait(1500);
    const b = await f.ev(() => document.querySelector('#hint:not(.hidden) .bubble')?.getBoundingClientRect().toJSON());
    check('375 px : bulle « Choisissez une lanterne » entière à l’écran', b && b.left >= 0 && b.right <= 375, JSON.stringify(b));
    await c.close();
  }

  // Glisser refusé depuis la palette, puis toucher aussitôt un autre onglet
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const f = await finger(c);
    await f.open('level=2-2');
    await f.wait(2200);
    const ws = await f.ev(() => {
      const g = window.__state.game.grid;
      for (let i = 0; i < g.size; i++) if (g.type(i) === 3 && g.slotElement[i] === 'water') return [g.col(i), g.row(i)];
      return null;
    });
    await f.slide(await f.center('.tool[data-tool="fire"]'), await f.at(ws[0], ws[1], 60));
    await f.touch('touchEnd');
    await f.wait(120);
    const refused = await f.ev(([c2, r2]) => !window.__state.game.towerAt(c2, r2) && /Socle réservé/.test(window.__input.ui.flash?.text || ''), ws);
    await f.tap(await f.center('.ptab[data-el="water"]'));
    const tab = await f.ev(() => window.__hud.tab);
    check('Feu glissé sur un socle d’Eau : refusé, puis l’onglet Eau répond aussitôt', refused && tab === 'water', JSON.stringify({ refused, tab }));
    await c.close();
  }

  // Double toucher accidentel sur le bouton de vague : une seule vague appelée
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const f = await finger(c);
    await f.open('level=1-1');
    await f.wait(2200);
    const wb = await f.center('#btn-wave');
    await f.tap(wb);
    await f.wait(800);
    await f.ev(() => document.querySelector('#btn-wave').addEventListener('click', () => window.__waveClicks.push(performance.now()), true));
    // Deux touchers à ~150 ms d'écart (machine chargée : on recommence si les clics
    // arrivent trop espacés pour être un double toucher).
    let res = null;
    for (let k = 0; k < 3 && !res; k++) {
      // la vague suivante ne doit pas partir seule pendant le test (compte à rebours)
      const w0 = await f.ev(() => {
        const g = window.__state.game;
        g.nextWaveT = 60;
        window.__waveClicks = [];
        return g.waveIndex;
      });
      await f.wait(400);
      await f.touch('touchStart', wb);
      await f.wait(50);
      await f.touch('touchEnd');
      await f.wait(90);
      await f.touch('touchStart', wb);
      await f.wait(50);
      await f.touch('touchEnd');
      await f.wait(300);
      const r = await f.ev(() => ({ w: window.__state.game.waveIndex, gap: window.__waveClicks[1] - window.__waveClicks[0] }));
      if (r.gap < 340) res = { w0, w1: r.w, gap: Math.round(r.gap) };
    }
    await f.wait(500);
    await f.ev(() => (window.__state.game.nextWaveT = 60));
    const wa = await f.ev(() => window.__state.game.waveIndex);
    await f.tap(wb);
    const w2 = await f.ev(() => window.__state.game.waveIndex);
    check('double toucher sur le bouton de vague : une seule vague appelée', res && res.w1 === res.w0 + 1 && w2 === wa + 1, JSON.stringify({ res, wa, w2 }));
    await c.close();
  }

  // Jauge pleine : l'appel anticipé ne promet ni n'annonce de charge qu'il ne donnera pas
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const f = await finger(c);
    await f.open('level=2-4');
    await f.ev(() => {
      window.__save.set('rewindTutorialSeen', true);
      window.__tutorial.rewindPhase = 0;
    });
    await f.tap(await f.center('#btn-wave'));
    await f.wait(1200);
    await f.ev(() => {
      const g = window.__state.game;
      g.rewindCharge = g.rules.rewindCost - 10;
    });
    await f.wait(200);
    // §6.5 : la charge promise par un appel est l'arc fantôme de la jauge (et la phrase lue
    // du bouton), bornée à la place libre ; la sous-ligne ne montre que la prime « ◉ +X »
    const promise = () =>
      f.ev(() => ({
        aria: document.getElementById('btn-wave').getAttribute('aria-label'),
        sub: document.getElementById('btn-wave-sub').textContent,
        ghost: (document.querySelector('#rewind .rr-ghost').style.strokeDasharray || '').split(/[ ,]+/).map(Number).filter((x, i) => i % 2 === 0 && x > 0).reduce((a, b) => a + b, 0),
      }));
    const room = await promise();
    await f.ev(() => {
      const g = window.__state.game;
      g.rewindCharge = g.rules.rewindCost;
    });
    await f.wait(200);
    const full = await promise();
    await f.tap(await f.center('#btn-wave'));
    const toastFull = await f.ev(() => document.getElementById('lane').textContent);
    check('appel anticipé : charge promise bornée à la place libre (10 → +10 ; arc fantôme)', /\+10 de charge/.test(room.aria) && room.ghost > 0 && !/巻/.test(room.sub), JSON.stringify(room));
    check('jauge pleine : ni le bouton ni un message ne promettent de charge', !/charge/.test(full.aria) && !/巻/.test(full.sub) && !/巻/.test(toastFull), JSON.stringify({ full, toastFull }));
    await c.close();
  }

  // Message « Nouveau yokai » du couloir posé sur un socle : une lanterne choisie, le
  // toucher passe au socle (il ouvrait la fiche du yokai au lieu de poser)
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const f = await finger(c);
    await f.open('level=2-1');
    await f.wait(2300);
    const slot = await f.ev(() => {
      const g = window.__state.game;
      const type = g.level.introduce[0];
      g.events.push({ type: 'spawn', enemy: { type } });
      const gr = g.grid;
      for (let i = 0; i < gr.size; i++) if (gr.type(i) === 3 && !gr.slotElement[i]) return [gr.col(i), gr.row(i)];
      return null;
    });
    await f.wait(300);
    // le message recouvre ce socle (placé à la main ; le couloir se replace toutes les 250 ms)
    const q = await f.at(slot[0], slot[1]);
    const cover = () =>
      f.ev(([x, y]) => {
        const el = document.getElementById('lane');
        const st = document.getElementById('stage').getBoundingClientRect();
        window.__hud.lane.place = () => {};
        el.style.left = `${Math.max(4, x - st.left - 40)}px`;
        el.style.top = `${y - st.top - 20}px`;
        return !el.classList.contains('hidden');
      }, [q.x, q.y]);
    const shown = await cover();
    await f.tap(await f.center('.tool[data-tool="fire"]'));
    await f.tap(q);
    const r = await f.ev(([c2, r2]) => ({ placed: !!window.__state.game.towerAt(c2, r2) || window.__state.game.pendingPlacements().some((e) => e.args[1] === c2 && e.args[2] === r2), sheet: window.__sheets.isOpen }), slot);
    check('message « Nouveau yokai » sur un socle : une lanterne choisie, la pose réussit', shown && r.placed && !r.sheet, JSON.stringify({ shown, ...r }));
    await c.close();
  }

  // En pause, « Déplacer le mur » agit (les cases s'allumaient mais le toucher ne faisait rien)
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const f = await finger(c);
    await f.open('level=2-1');
    await f.wait(2300);
    const t = await f.ev(() => {
      const g = window.__state.game;
      g.gold = 999;
      const gr = g.grid;
      for (let i = 0; i < gr.size; i++) {
        if (gr.type(i) !== 3 || gr.row(i) < 4) continue;
        const tw = g.placeTower('earth_guard', gr.col(i), gr.row(i));
        if (tw && g.barriers.length) return { id: tw.id, c: tw.c, r: tw.r };
      }
      return null;
    });
    await f.tap(await f.center('#btn-pause'));
    await f.tap(await f.at(t.c, t.r, -8));
    await f.tap(await f.center('#tower-bar [data-act="rally"]'));
    const dest = await f.ev((id) => {
      const g = window.__state.game;
      const b = g.barriers.find((x) => x.towerId === id);
      const i = (window.__overlay.rallyOf(g, window.__input.ui)?.tiles || []).find((x) => x !== b.tile);
      return i == null ? null : [g.grid.col(i), g.grid.row(i), i];
    }, t.id);
    await f.tap(await f.at(dest[0], dest[1]));
    // en pause, la construction du mur attend (le moteur est figé) ; il se dresse à la reprise
    const held = await f.ev(() => window.__state.game.pendingPlacements().filter((e) => e.op === 'setRally').length);
    await f.tap(await f.center('#modal .btn.primary'));
    await f.settle();
    const tile = await f.ev((id) => window.__state.game.barriers.find((x) => x.towerId === id).tile, t.id);
    check('en pause : « Déplacer le mur » puis une case allumée : le mur se construit et se dresse à la reprise', held === 1 && tile === dest[2], JSON.stringify({ held, tile, dest }));
    await c.close();
  }

  // Tutoriel des pierres (1-4) : si aucune pierre seule n'allonge le chemin, la bulle
  // ne promet pas un détour (elle disait « Glissez-la sur le gravier » → « Sans effet »)
  {
    const c = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const f = await finger(c);
    await f.open('level=1-4');
    await f.wait(2300);
    await f.ev(() => {
      const g = window.__state.game;
      const gr = g.grid;
      for (let i = 0; i < gr.size; i++) if (gr.type(i) === 3 && !gr.slotElement[i] && g.placeTower('fire', gr.col(i), gr.row(i))) break;
    });
    await f.tap(await f.center('.tool[data-tool="stone"]'));
    await f.wait(500);
    const st = await f.ev(() => {
      const g = window.__state.game;
      const gr = g.grid;
      let best = -1;
      for (let i = 0; i < gr.size; i++) if (gr.type(i) === 2) {
        const pv = g.previewStone(gr.col(i), gr.row(i));
        if (pv.ok) best = Math.max(best, pv.delta);
      }
      return { best, key: window.__tutorial.current?.split('|')[0], text: document.querySelector('#hint:not(.hidden) .bubble')?.textContent || '' };
    });
    check('tutoriel des pierres : la bulle dit vrai sur le gain (gain max ' + st.best + ')', st.key === 'stone-spot' && (st.best > 0 ? /gravier/.test(st.text) : /alignez/.test(st.text)), JSON.stringify(st));
    await c.close();
  }

  // Défi « Dix lanternes » : le compte des poses est visible, la palette se grise au bout
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const f = await finger(c);
    await f.open('level=1-1');
    await f.ev(() => window.__startLevel('1-1', { challenge: true }));
    await f.wait(1200);
    const max = await f.ev(() => {
      const g = window.__state.game;
      g.gold = 9999;
      return g.challengeRule.maxTowers;
    });
    const sl = await f.ev(() => {
      const g = window.__state.game.grid;
      const o = [];
      for (let i = 0; i < g.size; i++) if (g.type(i) === 3 && (!g.slotElement[i] || g.slotElement[i] === 'fire')) o.push([g.col(i), g.row(i)]);
      return o;
    });
    for (let k = 0; k < max - 1; k++) await f.ev(([c2, r2]) => window.__state.game.placeTower('fire', c2, r2), sl[k]);
    await f.tap(await f.center('.tool[data-tool="fire"]'));
    await f.tap(await f.at(sl[max - 1][0], sl[max - 1][1]));
    const fl = await f.ev(() => window.__input.ui.flash?.text || '');
    check(`défi « ${max} lanternes » : le compte des poses s’affiche à la pose`, fl.includes(`${max}/${max}`), fl);
    const sp = await f.ev(() => [...document.querySelectorAll('.tool')].every((b) => b.classList.contains('spent') && /défi/.test(b.getAttribute('aria-label'))));
    check('défi épuisé : lanternes grisées (sans le rouge du manque d’or), libellé du défi', sp);
    await f.tap(await f.center('#btn-undo'));
    check('annuler la dernière pose : les lanternes redeviennent disponibles', await f.ev(() => !document.querySelector('.tool.spent')));
    await c.close();
  }

  // Toutes les fiches (yokai, types, lanternes N1→N3, éléments, vague, Rembobinage) :
  // textes ≥ 12 px, ni « undefined » ni « NaN »
  {
    const c = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const f = await finger(c);
    await f.open('level=2-4');
    const bad = await f.ev(async () => {
      const out = [];
      const g = window.__state.game;
      const S = window.__sheets;
      const look = async (label) => {
        await new Promise((r) => setTimeout(r, 20));
        const el = document.querySelector('#info');
        if (/undefined|NaN|\[object/.test(el.innerText)) out.push(`${label} : texte invalide`);
        for (const x of el.querySelectorAll('*')) {
          const own = [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (own && parseFloat(getComputedStyle(x).fontSize) < 12) {
            out.push(`${label} : « ${x.textContent.trim().slice(0, 20)} » ${getComputedStyle(x).fontSize}`);
            break;
          }
        }
      };
      for (const type of Object.keys(g.defs.enemies)) {
        S.open('enemy', { type });
        await look(`yokai ${type}`);
      }
      g.gold = 99999;
      const gr = g.grid;
      for (const type of g.availableTowers) {
        S.open('type', type);
        await look(`type ${type}`);
        let t = null;
        for (let i = 0; i < gr.size && !t; i++) if (gr.type(i) === 3 && g.canPlaceTower(type, gr.col(i), gr.row(i)).ok) t = g.placeTower(type, gr.col(i), gr.row(i));
        for (let lv = 1; t && lv <= 3; lv++) {
          t.level = lv;
          g.onTowersChanged();
          S.open('tower', t.id);
          await look(`${type} N${lv}`);
        }
      }
      for (const el of Object.keys(g.defs.elements)) {
        S.open('element', el);
        await look(`élément ${el}`);
      }
      S.open('wave');
      await look('vague');
      S.open('rewind');
      await look('Rembobinage');
      S.close();
      return out;
    });
    check('375 px : toutes les fiches lisibles (≥ 12 px, sans valeur manquante)', bad.length === 0, bad.join(' | '));
    await c.close();
  }

  // Plusieurs combos nés d'un coup (375 px, case de 34 px) : leurs noms flottants ne
  // se chevauchent pas et font au moins 12 px
  {
    const c = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const f = await finger(c);
    await f.open('level=2-1');
    const r = await f.ev(() => {
      const g = window.__state.game;
      const R = window.__renderer;
      g.gold = 99999;
      const gr = g.grid;
      const types = g.availableTowers;
      let k = 0;
      for (let i = 0; i < gr.size; i++) {
        if (gr.type(i) !== 3) continue;
        const se = gr.slotElement[i];
        const ok = types.filter((t) => !se || g.defs.towers[t].element === se);
        g.placeTower(ok[k++ % ok.length], gr.col(i), gr.row(i));
      }
      R.onEvents(g.events);
      g.events.length = 0;
      const ts = R.ts;
      const m = document.createElement('canvas').getContext('2d');
      const boxes = R.fx.texts.map((t) => {
        const px = Math.max(12, Math.round(t.size * ts));
        m.font = `800 ${px}px "Shippori Mincho", serif`;
        const w = m.measureText(t.str).width;
        return { s: t.str, px, l: t.x * ts - w / 2, r: t.x * ts + w / 2, t: t.y * ts - px * 0.5, b: t.y * ts + px * 0.5 };
      });
      const over = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.l < b.r - 2 && b.l < a.r - 2 && a.t < b.b - 1 && b.t < a.b - 1) over.push(`${a.s} / ${b.s}`);
      }
      return { n: boxes.length, ts, small: boxes.filter((b) => b.px < 12).length, over };
    });
    check(`${r.n} noms de combo nés ensemble : aucun chevauchement, ≥ 12 px (case ${r.ts} px)`, r.n >= 3 && !r.over.length && !r.small, JSON.stringify(r));
    await c.close();
  }
}

console.log('10. Correctifs de la relecture (dernière chance, pause, vieux Safari, rendu)');
{
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pg = await c.newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const cd = await c.newCDPSession(pg);
  const touch = (type, q) => cd.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: q.x, y: q.y, id: 1, radiusX: 8, radiusY: 8 }] });
  const tap = async (q, ms = 60) => {
    await touch('touchStart', q);
    await pg.waitForTimeout(ms);
    await touch('touchEnd');
    await pg.waitForTimeout(160);
  };
  const center = async (sel) => {
    const r = await pg.locator(sel).first().boundingBox();
    return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const ev = (fn, arg) => pg.evaluate(fn, arg);
  let tutoSeen = false;
  const openLevel = async (id) => {
    if (!tutoSeen) {
      // la règle du Rembobinage (fenêtre du tutoriel) est déjà lue
      await pg.goto('http://localhost:8080/?broker=off', { waitUntil: 'networkidle' });
      await ev(() => window.__save.set('rewindTutorialSeen', true));
      tutoSeen = true;
    }
    await pg.goto(`http://localhost:8080/?level=${id}&broker=off`, { waitUntil: 'networkidle' });
    await pg.waitForTimeout(500);
  };
  const atTile = async (cc, rr) => {
    const box = await pg.locator('#board').boundingBox();
    const q = await ev(([cc, rr]) => window.__renderer.toScreen(cc + 0.5, rr + 0.5), [cc, rr]);
    return { x: box.x + q.x, y: box.y + q.y };
  };

  // Dernière chance ouverte, menu de pause (arrière-plan), « Recommencer » : l'appel
  // « Rembobinez ! » et l'interface inerte ne doivent pas suivre dans la partie suivante.
  await openLevel('1-3');
  await ev(() => window.__state.game.startNextWave());
  await pg.waitForTimeout(3200);
  await ev(() => {
    const g = window.__state.game;
    g.rewindCharge = g.rules.rewindCost;
    g.lives = 1;
    g.leak(g.enemies.find((e) => e.alive && !e.flying && !e.timeless) || g.enemies[0]);
  });
  await pg.waitForTimeout(300);
  const lc0 = await ev(() => ({ t: window.__state.game.lastChanceT, ov: !document.getElementById('last-chance').classList.contains('hidden') }));
  await ev(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  // « Recommencer » se confirme par un second toucher (§6.10)
  await pg.locator('#modal .pause-danger [data-act="restart"]').click();
  await pg.waitForTimeout(150);
  await pg.locator('#modal .pause-danger [data-act="restart"]').click();
  await pg.waitForTimeout(900);
  const lc1 = await ev(() => ({
    wave: window.__state.game.waveIndex,
    lives: window.__state.game.lives,
    ov: !document.getElementById('last-chance').classList.contains('hidden'),
    lcOn: document.getElementById('screen-game').classList.contains('lc-on'),
    pe: ['btn-pause', 'btn-wave'].map((id) => getComputedStyle(document.getElementById(id)).pointerEvents),
  }));
  check('dernière chance puis « Recommencer » : appel masqué, interface active', lc0.t > 0 && lc0.ov && lc1.wave === -1 && !lc1.ov && !lc1.lcOn && lc1.pe.every((v) => v !== 'none'), JSON.stringify([lc0, lc1]));
  await tap(await center('#btn-pause'));
  check('… la pause répond dans la nouvelle partie', await ev(() => window.__state.paused === true));
  await ev(() => document.querySelector('#modal .modal-card .btn.primary')?.click()); // Reprendre

  // En pause, une fiche passée en haut découvre la barre du bas : ni appel de vague
  // ni rembobinage tant que le jeu est figé.
  // (la feuille de pause couvre le bas du plateau : la fiche d'une lanterne du bas s'ouvre
  // ici par l'API, comme un appui long — elle passe en haut et découvre la barre du bas)
  await openLevel('1-3');
  await ev(() => {
    const g = window.__state.game;
    g.gold = 9999;
    g.startNextWave();
  });
  await pg.waitForTimeout(3200);
  await ev(() => (window.__state.game.rewindCharge = window.__state.game.rules.rewindCost));
  await tap(await center('#btn-pause'));
  const spot = await ev(() => {
    const g = window.__state.game;
    const gr = g.grid;
    let best = null;
    for (let i = 0; i < gr.size; i++) {
      const c = gr.col(i);
      const r = gr.row(i);
      if (gr.type(i) !== 3 || g.towerAt(c, r) || (gr.slotElement[i] && gr.slotElement[i] !== 'fire')) continue;
      if (!best || r > best[1]) best = [c, r];
    }
    const t = best && g.placeTower('fire', best[0], best[1]);
    if (t) {
      window.__input.ui.selectedTower = t.id;
      window.__sheets.open('tower', t.id);
    }
    return best;
  });
  await pg.waitForTimeout(400);
  const p0 = await ev(() => ({ wave: window.__state.game.waveIndex, gold: window.__state.game.gold, rw: window.__state.game.rewindsUsed, top: document.querySelector('#info')?.classList.contains('top') }));
  await tap(await center('#btn-wave'));
  const k = await pg.locator('#rewind .rewind-knob').boundingBox();
  const tr = await pg.locator('#rewind .rewind-track').boundingBox();
  if (k && tr) {
    const a = { x: k.x + k.width / 2, y: k.y + k.height / 2 };
    await touch('touchStart', a);
    for (let i = 1; i <= 12; i++) {
      await touch('touchMove', { x: a.x + (tr.x + 8 - a.x) * (i / 12), y: a.y });
      await pg.waitForTimeout(16);
    }
    await touch('touchEnd');
  }
  await pg.waitForTimeout(400);
  const p1 = await ev(() => ({ wave: window.__state.game.waveIndex, gold: window.__state.game.gold, rw: window.__state.game.rewindsUsed, paused: window.__state.paused }));
  check('en pause (fiche en haut) : ni vague appelée ni rembobinage', p0.top && p1.paused && p1.wave === p0.wave && p1.gold === p0.gold && p1.rw === p0.rw, JSON.stringify([spot, p0, p1]));

  // Retour d'une lanterne déposée à côté : son corps n'est pas redessiné à chaque image.
  await openLevel('1-3');
  await ev(() => {
    const g = window.__state.game;
    g.gold = 9999;
    window.__dragT = g.placeTower('fire_mortar', 3, 11);
  });
  await pg.waitForTimeout(400);
  const made = await ev(
    () =>
      new Promise((res) => {
        const orig = document.createElement.bind(document);
        let n = 0;
        // (seuls comptent les corps de lanterne : portails et effets ont leurs propres caches)
        document.createElement = (tag, ...rest) => {
          if (String(tag).toLowerCase() === 'canvas' && /getBody/.test(new Error().stack)) n++;
          return orig(tag, ...rest);
        };
        let rounds = 0;
        const go = () => {
          const t = window.__dragT;
          const p = window.__renderer.toScreen(t.x + 2, t.y - 3);
          window.__input.ui.dragBack = { towerId: t.id, x: p.x, y: p.y, t0: performance.now() };
          if (++rounds < 4) setTimeout(go, 220);
          else
            setTimeout(() => {
              document.createElement = orig;
              res(n);
            }, 220);
        };
        go();
      }),
  );
  check('retour d’une lanterne (4 fois) : corps en cache, pas de canvas neufs', made <= 1, `${made} corps créés`);

  // Membres et sablier des yokai : aucun tracé NaN, aucune couleur invalide.
  const paths = await ev(async () => {
    const { LOOKS } = await import('/src/render/enemies.js');
    const out = {};
    for (const look of Object.keys(LOOKS)) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 300;
      const g = cv.getContext('2d');
      const bad = { nan: 0, style: 0 };
      for (const m of ['moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'arcTo', 'ellipse']) {
        const f = g[m].bind(g);
        g[m] = (...a) => {
          if (a.some((v) => typeof v === 'number' && !Number.isFinite(v))) bad.nan++;
          return f(...a);
        };
      }
      for (const prop of ['fillStyle', 'strokeStyle']) {
        const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, prop);
        Object.defineProperty(g, prop, {
          get: () => d.get.call(g),
          set: (v) => {
            if (typeof v === 'number') bad.style++;
            d.set.call(g, v);
          },
        });
      }
      g.translate(150, 150);
      for (const t of [0, 0.3, 0.6]) LOOKS[look](g, { seed: 0.5, breakT: 0, enraged: false, blocked: null }, 40, t);
      if (bad.nan || bad.style) out[look] = bad;
    }
    return out;
  });
  check('dessins des yokai : aucun tracé NaN ni couleur invalide (membres, sablier)', Object.keys(paths).length === 0, JSON.stringify(paths));
  await c.close();

  // Safari < 16 (iPhone 6s, 7, SE) : pas de ctx.roundRect. L'accueil, la carte et un
  // niveau s'affichent quand même, et la boucle tourne.
  const old = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const op = await old.newPage();
  const oldErr = [];
  op.on('pageerror', (e) => oldErr.push(e.message));
  op.on('console', (m) => m.type() === 'error' && oldErr.push(m.text()));
  await op.addInitScript(() => {
    delete CanvasRenderingContext2D.prototype.roundRect;
    if (window.Path2D) delete Path2D.prototype.roundRect;
  });
  await op.goto('http://localhost:8080/?broker=off', { waitUntil: 'networkidle' });
  await op.waitForTimeout(400);
  await op.locator('#btn-levels').click();
  await op.waitForTimeout(900);
  const nodes = await op.locator('.map-node').count();
  await op.goto('http://localhost:8080/?level=1-1&broker=off', { waitUntil: 'networkidle' });
  await op.waitForTimeout(800);
  const t1 = await op.evaluate(() => (window.__renderer.game ? window.__renderer.time : -1));
  await op.waitForTimeout(600);
  const t2 = await op.evaluate(() => window.__renderer.time);
  const native = await op.evaluate(() => /native code/.test(String(CanvasRenderingContext2D.prototype.roundRect)));
  check('sans ctx.roundRect (Safari < 16) : carte et plateau dessinés, boucle vivante', !native && nodes === 8 && t1 >= 0 && t2 > t1 && oldErr.length === 0, JSON.stringify({ nodes, t1, t2, native, err: oldErr.slice(0, 3) }));
  await old.close();
}

console.log('11. Coopération : un élément par joueur, constructions des coéquipiers, salon');
{
  // partie coopérative simulée (sans réseau) : Moi (Feu) et Aki (rien choisi → Eau)
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pg = await c.newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await pg.goto('http://localhost:8080/?broker=off', { waitUntil: 'networkidle' });
  await pg.evaluate(async () => {
    const { Game, assignElements } = await import('/src/core/game.js');
    const { defs, loadLevel } = await import('/src/data.js');
    const level = await loadLevel('2-3');
    const els = assignElements(['fire', null]);
    const players = [
      { name: 'Moi', elements: els[0], element: 'fire' },
      { name: 'Aki', elements: els[1], element: null },
    ];
    const game = new Game(level, defs, { seed: 3, players, localPlayer: 0 });
    window.__state.coopRole = 'host';
    window.__state.coopPlayers = players;
    window.__beginGame('2-3', level, game, { hard: false, challenge: false });
  });
  await pg.waitForTimeout(800);
  const box = await pg.locator('#board').boundingBox();
  const atT = async (cc, rr, dy = 0) => {
    const q = await pg.evaluate(([cc, rr]) => window.__renderer.toScreen(cc + 0.5, rr + 0.5), [cc, rr]);
    return { x: box.x + q.x, y: box.y + q.y + dy };
  };
  const pal = await pg.evaluate(() => ({
    tools: [...document.querySelectorAll('#palette .tool')].map((b) => b.dataset.tool),
    tabs: !document.getElementById('palette-tabs').classList.contains('hidden'),
    mine: window.__state.game.towersFor(0),
  }));
  check('palette coopérative : seulement les lanternes de son élément (Feu), sans pierre ni onglets', pal.tools.join() === pal.mine.join() && pal.mine.every((t) => t.startsWith('fire')) && !pal.tools.includes('stone') && !pal.tabs, JSON.stringify(pal));
  const paths = await pg.evaluate(() => {
    const g = window.__state.game;
    const I = window.__input;
    const slot = (() => {
      for (let i = 0; i < g.grid.size; i++) if (g.grid.type(i) === 3 && !g.grid.slotElement[i]) return [g.grid.col(i), g.grid.row(i)];
      return null;
    })();
    const set = I.setTool('water');
    window.__sheets.open('type', 'water');
    const sheet = document.querySelector('#info .sheet-actions')?.innerText || '';
    const choose = !!document.querySelector('#info [data-act="choose"]');
    window.__sheets.close();
    return { allowed: I.allowed('water'), set, sheet, choose, check: window.__commands.check('placeTower', 'water', slot[0], slot[1]).reason, stone: I.allowed('stone') };
  });
  check('aucun chemin vers une lanterne d’un autre élément (outil, fiche, commande)', !paths.allowed && paths.set === null && !paths.choose && /autre joueur/.test(paths.sheet) && paths.check === 'element' && !paths.stone, JSON.stringify(paths));
  // construction d'Aki (commande datée venue du réseau) : visible, liseré de son élément
  const akiSlot = await pg.evaluate(() => {
    const g = window.__state.game;
    for (let i = 0; i < g.grid.size; i++) {
      const c2 = g.grid.col(i);
      const r2 = g.grid.row(i);
      if (g.grid.type(i) === 3 && !g.grid.slotElement[i] && r2 > 3 && g.canIssue('placeTower', ['water', c2, r2], 1).ok) {
        g.issue('placeTower', ['water', c2, r2], 1);
        return [c2, r2];
      }
    }
    return null;
  });
  await pg.evaluate(() => (window.__state.speed = 0.1)); // le temps des vérifications
  const mate = await pg.evaluate(() => ({ builds: window.__renderer.builds.map((b) => ({ mine: b.mine, pid: b.pid, color: window.__renderer.buildOwner(b.pid)?.color })), spend: window.__commands.spendable(), gold: window.__state.game.gold, water: window.__state.game.defs.elements.water.color }));
  check('construction d’un coéquipier : dessinée à la couleur de son élément, mon or intact', mate.builds.length === 1 && !mate.builds[0].mine && mate.builds[0].color === mate.water && mate.spend === mate.gold, JSON.stringify(mate));
  await pg.locator('.tool[data-tool="fire"]').click();
  let q = await atT(akiSlot[0], akiSlot[1], 60);
  await pg.mouse.move(q.x, q.y);
  await pg.mouse.down();
  await pg.waitForTimeout(520);
  await pg.mouse.move(q.x + 2, q.y + 1);
  await pg.mouse.move(q.x, q.y);
  await pg.waitForTimeout(60);
  const lab = await pg.evaluate(() => window.__renderer.pressLabel(window.__input.ui.press));
  await pg.mouse.up();
  await pg.waitForTimeout(150);
  check('socle en construction chez un coéquipier : « Pris par Aki »', lab?.text === 'Pris par Aki', JSON.stringify(lab));
  q = await atT(akiSlot[0], akiSlot[1]);
  await pg.mouse.click(q.x, q.y);
  await pg.waitForTimeout(200);
  const bar = await pg.evaluate(() => ({ text: document.getElementById('tower-bar').innerText.replace(/\s+/g, ' '), shown: !document.getElementById('tower-bar').classList.contains('hidden'), btns: document.querySelectorAll('#tower-bar button').length }));
  check('toucher sa construction : « Pris par Aki », sans bouton d’annulation', bar.shown && /Pris par Aki/.test(bar.text) && bar.btns === 0, JSON.stringify(bar));
  await pg.screenshot({ path: 'qa-output/ui-coop-construction.png' });
  await c.close();

  // salon à deux (relais local) : éléments distincts, attribution d'office affichée
  if (!HOME.includes('broker=off')) {
    const hc = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const host = await hc.newPage();
    host.on('pageerror', (e) => errors.push(`[hôte] ${e.message}`));
    host.on('console', (m) => m.type() === 'error' && errors.push(`[hôte] ${m.text()}`));
    await host.goto(HOME, { waitUntil: 'networkidle' });
    await host.waitForFunction(() => window.__session.online, null, { timeout: 10000 });
    const code = await host.evaluate(() => window.__session.code);
    const gc = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const guest = await gc.newPage();
    guest.on('pageerror', (e) => errors.push(`[invité] ${e.message}`));
    guest.on('console', (m) => m.type() === 'error' && errors.push(`[invité] ${m.text()}`));
    await guest.goto(`${HOME}&salon=${code}`, { waitUntil: 'networkidle' });
    await guest.waitForFunction(() => window.__session.role === 'guest' && window.__session.online, null, { timeout: 10000 });
    await host.waitForFunction(() => (window.__session.lobby?.players.length ?? 0) === 2, null, { timeout: 10000 });
    // l'invité reçoit un élément libre en arrivant ; l'hôte n'a rien choisi : le sien
    // lui est attribué d'office (affiché)
    await host.waitForTimeout(400);
    const hs = await host.evaluate(() => {
      const players = window.__session.lobby.players;
      const taken = players[1].element;
      return {
        taken,
        takenOff: document.querySelector(`.lobby-el[data-el="${taken}"]`)?.disabled,
        note: document.querySelector('.lobby-note').textContent,
        autoTag: document.querySelectorAll('.lobby-player .lobby-tag.auto').length,
        autoSeal: document.querySelectorAll('.lobby-seal.auto').length,
        autoEl: document.querySelector('.lobby-el.auto')?.dataset.el,
      };
    });
    check('salon à deux : « un élément par joueur », élément pris grisé, élément d’office de l’hôte affiché', /chacun pose les lanternes de son élément/i.test(hs.note) && !/à tous/.test(hs.note) && hs.takenOff === true && hs.autoTag === 1 && hs.autoSeal === 1 && hs.autoEl && hs.autoEl !== hs.taken, JSON.stringify(hs));
    const pick = ['wind', 'earth', 'water', 'fire'].find((el) => el !== hs.taken);
    await host.locator('#btn-multi').click(); // « À plusieurs » : feuille du salon
    await host.locator(`.lobby-el[data-el="${pick}"]`).click();
    await guest.waitForFunction((el) => window.__session.lobby?.players.some((p) => p.element === el), pick, { timeout: 10000 });
    await guest.waitForTimeout(300);
    const gs = await guest.evaluate((el) => ({ off: document.querySelector(`.lobby-el[data-el="${el}"]`).disabled, auto: document.querySelectorAll('.lobby-tag.auto').length }), pick);
    check('salon (invité) : l’élément choisi par l’hôte est grisé, plus d’attribution d’office', gs.off === true && gs.auto === 0, JSON.stringify(gs));
    await host.locator(`.lobby-el[data-el="${pick}"]`).click();
    await host.waitForTimeout(300);
    check('à plusieurs, toucher son élément ne le retire pas', await host.evaluate((el) => window.__session.lobby.players[0].element === el, pick));
    // l'hôte retire son choix… impossible ; on teste l'affichage de la fiche de niveau
    // avec un joueur sans élément : on vide le choix de l'hôte côté salon
    await host.evaluate(() => window.__session.assignElement(window.__session.id, null));
    await host.waitForTimeout(300);
    await host.screenshot({ path: 'qa-output/ui-lobby-two.png' });
    await host.locator('#modal .menu-x').click();
    await host.locator('#btn-play').click(); // hôte avec un invité : « Jouer à 2 » ouvre la carte
    await host.waitForTimeout(600);
    await host.locator('.map-node').first().click();
    await host.waitForTimeout(500);
    const team = await host.evaluate(() => document.querySelector('#modal .lv-team')?.parentElement?.innerText || '');
    check('fiche de niveau de l’hôte : élément de chacun (attribué), règle d’un élément', /attribué/.test(team) && /Chacun ne pose que les lanternes de son élément/.test(team), team.replace(/\s+/g, ' ').slice(0, 200));
    await hc.close();
    await gc.close();
  } else console.log('  (salon à deux : relais local injoignable, vérification sautée)');
}

console.log('12. Construction de 2 s en solo : recette au doigt (pierres en rafale, mur, Rembobinage, tutoriel, fusion, fin)');
{
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pg = await c.newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const cd = await c.newCDPSession(pg);
  const touch = (type, q) => cd.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: q.x, y: q.y, id: 1, radiusX: 8, radiusY: 8 }] });
  const ev = (fn, arg) => pg.evaluate(fn, arg);
  const wait = (ms) => pg.waitForTimeout(ms);
  const tap = async (q, ms = 60) => {
    await touch('touchStart', q);
    await wait(ms);
    await touch('touchEnd');
    await wait(150);
  };
  const center = async (sel) => {
    const r = await pg.locator(sel).first().boundingBox();
    return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const tapSel = async (sel) => tap(await center(sel));
  let box = null;
  const open = async (id) => {
    await pg.goto(`http://localhost:8080/?level=${id}&broker=off`, { waitUntil: 'networkidle' });
    await wait(500);
    box = await pg.locator('#board').boundingBox();
  };
  const at = (cc, rr, dy = 0) => ev(([cc, rr]) => window.__renderer.toScreen(cc + 0.5, rr + 0.5), [cc, rr]).then((q) => ({ x: box.x + q.x, y: box.y + q.y + dy }));
  // constructions achevées sans attendre leurs 2 s
  const settle = () =>
    ev(() => {
      const g = window.__state.game;
      for (const e of g.queue) e.frame = Math.min(e.frame, g.frame + 1);
      g.update(1 / 60);
    });
  const hint = () => ev(() => (document.getElementById('hint').classList.contains('hidden') ? '' : document.getElementById('hint').innerText.trim()));
  const queue = () => ev(() => window.__state.game.queue.map((e) => [e.op, ...e.args]));
  await pg.goto('http://localhost:8080/?broker=off', { waitUntil: 'networkidle' });
  await ev(() => window.__save.set('rewindTutorialSeen', true));

  // ── Pierres posées coup sur coup : celles en construction comptent déjà ──
  await open('1-4');
  await ev(() => (window.__state.game.gold = 1000));
  await tapSel('.tool[data-tool="stone"]');
  for (const cc of [1, 2, 3, 5]) await tap(await at(cc, 7));
  await settle();
  await tap(await at(6, 7)); // en construction : seule, elle laisse passer par (7,7)
  {
    // doigt posé puis soulevé au-dessus de (7,7) : (6,7) et (7,7) ensemble fermeraient la rangée
    const q = await at(7, 7, LIFT);
    await touch('touchStart', q);
    await wait(600);
    await touch('touchMove', { x: q.x + 2, y: q.y + 1 });
    await touch('touchMove', q);
    await wait(80);
    const pr = await ev(() => {
      const p = window.__input.ui.press;
      return p && { c: p.c, r: p.r, valid: p.valid, reason: p.reason, label: window.__renderer.pressLabel(p)?.text };
    });
    check('pierres en rafale : celle qui fermerait le passage avec une pierre en construction est refusée dès l’aperçu (« Bloqué ! »)', pr && pr.c === 7 && pr.r === 7 && !pr.valid && pr.reason === 'blocked' && pr.label === 'Bloqué !', JSON.stringify(pr));
    await touch('touchEnd');
    await wait(150);
    const qs = await queue();
    check('… rien n’est parti : seule la pierre précédente se construit', qs.length === 1 && qs[0][0] === 'placeStone' && qs[0][1] === 6, JSON.stringify(qs));
  }
  {
    // (le refus du toucher est déjà écrit ; rien de nouveau ne doit s'y ajouter)
    const t0 = await ev(() => window.__input.ui.flash?.t0 ?? null);
    await settle();
    await wait(100);
    const s = await ev(() => ({ t0: window.__input.ui.flash?.t0 ?? null, stones: window.__state.game.grid.stone.reduce((a, b) => a + b, 0), six: window.__state.game.grid.stone[window.__state.game.grid.idx(6, 7)] }));
    check('… et aucun refus ne tombe 2 s plus tard : la pierre en construction est posée', s.t0 === t0 && s.stones === 5 && s.six === 1, JSON.stringify(s));
  }

  // ── « Déplacer le mur » : un seul déplacement à la fois ; Gardien vendu pendant le déplacement ──
  await open('1-4');
  const gid = await ev(() => {
    const g = window.__state.game;
    g.gold = 1000;
    return g.placeTower('earth_guard', 4, 7).id;
  });
  const rally = await ev((id) => {
    const g = window.__state.game;
    const bar = g.barriers.find((b) => b.towerId === id);
    return g.rallyTiles(id).filter((i) => i !== bar?.tile).map((i) => [g.grid.col(i), g.grid.row(i)]);
  }, gid);
  await tap(await at(4, 7));
  await tapSel('#tower-bar .tb-rally');
  await tap(await at(...rally[0]));
  await tapSel('#tower-bar .tb-rally');
  await tap(await at(...rally[2]));
  {
    const b = await ev(() => window.__renderer.builds.filter((x) => x.op === 'setRally').map((x) => [x.c, x.r]));
    check('mur déplacé deux fois pendant sa construction : un seul mur en construction (le dernier)', b.length === 1 && b[0][0] === rally[2][0] && b[0][1] === rally[2][1], JSON.stringify(b));
  }
  if (!(await ev(() => window.__input.ui.selectedTower))) await tap(await at(4, 7));
  await tapSel('#tower-bar [data-act="sell"]');
  await tapSel('#tower-bar [data-act="sell"]');
  {
    const s = await ev(() => ({ t: window.__state.game.towers.length, b: window.__renderer.builds.length, undo: !document.getElementById('btn-undo').classList.contains('hidden') }));
    check('Gardien vendu pendant le déplacement de son mur : plus de mur fantôme ni d’« Annuler »', s.t === 0 && s.b === 0 && !s.undo, JSON.stringify(s));
  }
  await settle();
  await wait(60);
  check('… et pas de « Mur non déplacé » à l’échéance', !(await ev(() => /Mur/.test(window.__input.ui.flash?.text || ''))), await ev(() => window.__input.ui.flash?.text));

  // ── Tutoriel 1-4 : la leçon attend la pierre, puis le mur, en construction ──
  await open('1-4');
  await ev(() => (window.__state.game.gold = 1000));
  await tapSel('.tool[data-tool="fire"]');
  await tap(await at(3, 1));
  await settle();
  await tapSel('.tool[data-tool="stone"]');
  await wait(200);
  const spot = await ev(() => {
    const el = document.querySelector('#hint .finger');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const b = document.getElementById('board').getBoundingClientRect();
    const t = window.__renderer.toTile(r.left + r.width / 2 - b.left, r.top + r.height / 2 - b.top);
    return [t.c, t.r];
  });
  await tap(await at(...spot));
  await wait(400);
  check('tutoriel : pendant la construction de la pierre, le doigt ne réclame pas déjà la suivante', (await hint()) === '' && (await queue()).some((e) => e[0] === 'placeStone'), await hint());
  await settle();
  await tapSel('.tool[data-tool="stone"]'); // l'outil se range
  const g2 = await ev(() => window.__state.game.placeTower('earth_guard', 2, 3).id);
  await wait(200);
  await tap(await at(2, 3));
  await tapSel('#tower-bar .tb-rally');
  const t2 = await ev((id) => {
    const g = window.__state.game;
    const bar = g.barriers.find((b) => b.towerId === id);
    const i = g.rallyTiles(id).find((x) => x !== bar?.tile);
    return [g.grid.col(i), g.grid.row(i)];
  }, g2);
  await tap(await at(...t2));
  await wait(400);
  check('tutoriel : pendant le déplacement du mur, plus de « Déplacez son mur… »', (await hint()) === '' && (await queue()).some((e) => e[0] === 'setRally'), await hint());

  // ── Fusion : une jumelle encore en construction le dit (« En construction ») ──
  await open('1-1');
  await ev(() => {
    const g = window.__state.game;
    g.gold = 1000;
    g.placeTower('fire', 4, 4);
    window.__state.speed = 0.2; // la construction dure ~10 s réelles, le temps des gestes
  });
  await tapSel('.tool[data-tool="fire"]');
  await tap(await at(2, 3));
  {
    // pause pendant la construction : « Annuler » ne dépasse plus à moitié de la feuille
    const vis = () => ev(() => getComputedStyle(document.getElementById('btn-undo')).display !== 'none' && !document.getElementById('btn-undo').classList.contains('hidden'));
    const before = await vis();
    await tapSel('#btn-pause');
    await wait(250);
    const during = await vis();
    await tapSel('#modal .btn.primary');
    await wait(250);
    check('pause pendant une construction : « Annuler » caché sous la feuille de pause, de retour à la reprise', before && !during && (await vis()), JSON.stringify({ before, during }));
  }
  {
    const a = await at(4, 4, -10);
    const b = await at(2, 3, -10);
    await touch('touchStart', a);
    await wait(60);
    for (let k = 1; k <= 14; k++) {
      await touch('touchMove', { x: a.x + ((b.x - a.x) * k) / 14, y: a.y + ((b.y + LIFT - a.y) * k) / 14 });
      await wait(16);
    }
    await wait(150);
    const h = await ev(() => window.__input.ui.drag?.hover);
    await touch('touchEnd');
    await wait(150);
    const s = await ev(() => ({ flash: window.__input.ui.flash?.text, towers: window.__state.game.towers.map((t) => [t.c, t.r, t.level]), q: window.__state.game.queue.length }));
    check('lanterne glissée sur sa jumelle en construction : refus « En construction », rien ne change', h?.reason === 'pending' && !h.valid && s.flash === 'En construction' && s.towers.length === 1 && s.towers[0][2] === 1 && s.q === 1, JSON.stringify({ h, s }));
    // portée au-dessus de la jumelle jusqu'à son allumage : la cible devient valable
    // sans bouger le doigt, relâcher fusionne
    await touch('touchStart', a);
    await wait(60);
    for (let k = 1; k <= 14; k++) {
      await touch('touchMove', { x: a.x + ((b.x - a.x) * k) / 14, y: a.y + ((b.y + LIFT - a.y) * k) / 14 });
      await wait(16);
    }
    await wait(120);
    const h1 = await ev(() => window.__input.ui.drag?.hover?.reason ?? null);
    await settle();
    await wait(120);
    const h2 = await ev(() => window.__input.ui.drag?.hover?.valid ?? null);
    await touch('touchEnd');
    await wait(150);
    const t = await ev(() => window.__state.game.towers.map((x) => [x.c, x.r, x.level]));
    check('… tenue au-dessus jusqu’à son allumage : la fusion devient possible sans bouger le doigt', h1 === 'pending' && h2 === true && t.length === 1 && t[0][2] === 2, JSON.stringify({ h1, h2, t }));
    await ev(() => (window.__state.speed = 1));
  }

  // ── Fin de partie : plus de construction figée ni d'or promis ──
  await tapSel('.tool[data-tool="water"]');
  await tap(await at(5, 2));
  await ev(() => {
    const g = window.__state.game;
    g.waveIndex = g.waves.length - 1;
    g.spawners = [];
    g.enemies = [];
    g.state = 'wave';
    g.nextWaveT = null;
  });
  await wait(300);
  {
    const s = await ev(() => ({ state: window.__state.game.state, q: window.__state.game.queue.length, builds: window.__renderer.builds.length, res: !document.getElementById('hud-reserved').classList.contains('hidden') }));
    check('victoire avec des constructions en cours : elles ne restent pas figées à l’écran, plus d’or promis', s.state === 'won' && s.q > 0 && s.builds === 0 && !s.res, JSON.stringify(s));
  }

  // ── Rembobinage pendant une construction : or jamais négatif, « Annuler » revient ──
  await open('1-3');
  await ev(() => (window.__state.game.gold = 400));
  await tapSel('#btn-wave');
  await ev(() => {
    const g = window.__state.game;
    for (let i = 0; i < 480; i++) g.update(1 / 60);
    g.events.length = 0;
    g.rewindCharge = 100;
    for (const h of g.history) h.gold[0] = 60; // il y a 6 s : 60 or, le Mortier (70) ne sera plus payable
    window.__state.speed = 0.5;
  });
  await wait(200);
  await tapSel('.tool[data-tool="fire_mortar"]');
  const fslot = await ev(() => {
    const g = window.__state.game;
    for (let i = 0; i < g.grid.size; i++) if (g.grid.type(i) === 3 && g.grid.slotElement[i] === 'fire' && !g.towerAt(g.grid.col(i), g.grid.row(i))) return [g.grid.col(i), g.grid.row(i)];
    return null;
  });
  await tap(await at(...fslot));
  {
    const k = await pg.locator('#rewind .rewind-knob').boundingBox();
    const tr = await pg.locator('#rewind .rewind-track').boundingBox();
    const a = { x: k.x + k.width / 2, y: k.y + k.height / 2 };
    // pendant « Annuler », la jauge prête reste un disque (la piste prendrait sa place) :
    // deux touchers rembobinent ; sinon, on glisse la poignée
    if (await ev(() => document.getElementById('rewind').classList.contains('compact'))) {
      await tap(a);
      await wait(120);
      await touch('touchStart', a);
      await wait(40);
      await touch('touchEnd');
    } else {
      await touch('touchStart', a);
      await wait(30);
      for (let i = 1; i <= 8; i++) {
        await touch('touchMove', { x: a.x + (tr.x + 4 - a.x) * (i / 8), y: a.y });
        await wait(16);
      }
      await touch('touchEnd');
    }
    const seen = [];
    let back = false;
    for (let i = 0; i < 140; i++) {
      await wait(50);
      const s = await ev(() => ({ gold: Number(document.getElementById('hud-gold').textContent), anim: !!window.__state.game.rewindAnim, q: window.__state.game.queue.length, undo: !document.getElementById('btn-undo').classList.contains('hidden'), flash: window.__input.ui.flash?.text }));
      seen.push(s);
      if (!s.anim && s.q === 1 && s.undo) back = true;
      if (!s.q) break;
    }
    check('Rembobinage pendant une construction : l’or affiché n’est jamais négatif', seen.some((s) => s.anim) && seen.every((s) => s.gold >= 0), JSON.stringify(seen.map((s) => s.gold)));
    check('… « Annuler » revient après l’animation tant que la construction continue', back, JSON.stringify(seen.map((s) => [s.anim, s.q, s.undo])));
    check('… plus payable avec l’or revenu en arrière : refus dit sur la case', seen.some((s) => /or/.test(s.flash || '')), JSON.stringify(seen.at(-1)));
  }
  await c.close();
}

console.log('13. Revue adversariale de la refonte, au doigt : modes en conflit, couloir, tutoriel, pierres, pause');
{
  const c = await browser.newContext({ viewport: { width: 390, height: 797 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const pg = await c.newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const cd = await c.newCDPSession(pg);
  const touch = (type, q) => cd.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x: q.x, y: q.y, id: 1, radiusX: 8, radiusY: 8 }] });
  const ev = (fn, arg) => pg.evaluate(fn, arg);
  const wait = (ms) => pg.waitForTimeout(ms);
  const tap = async (q, ms = 60) => {
    await touch('touchStart', q);
    await wait(ms);
    await touch('touchEnd');
    await wait(180);
  };
  const drag = async (a, b, { hold = 40, steps = 14, end = 'touchEnd' } = {}) => {
    await touch('touchStart', a);
    await wait(hold);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
      await wait(16);
    }
    await wait(60);
    await touch(end);
    await wait(200);
  };
  const center = async (sel) => {
    const r = await pg.locator(sel).first().boundingBox();
    return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const tapSel = async (sel) => tap(await center(sel));
  let box = null;
  const open = async (id) => {
    await pg.goto(`http://localhost:8080/?level=${id}&broker=off`, { waitUntil: 'networkidle' });
    await wait(500);
    box = await pg.locator('#board').boundingBox();
    await ev(() => (window.__state.game.gold = 3000));
  };
  const at = (cc, rr, dy = 0) => ev(([cc, rr]) => window.__renderer.toScreen(cc + 0.5, rr + 0.5), [cc, rr]).then((q) => ({ x: box.x + q.x, y: box.y + q.y + dy }));
  const settle = () =>
    ev(() => {
      const g = window.__state.game;
      for (const e of g.queue) e.frame = Math.min(e.frame, g.frame + 1);
      g.update(1 / 60);
    });
  const st = () => ev(() => ({ sel: window.__input.ui.selectedSlot, tool: window.__input.ui.tool, fuse: window.__input.ui.fuseFrom, pending: window.__state.game.pendingPlacements().map((e) => [e.op, ...e.args]), towers: window.__state.game.towers.map((t) => [t.type, t.c, t.r, t.level]) }));
  const lane = () => ev(() => (document.getElementById('lane').classList.contains('hidden') ? '' : document.getElementById('lane').textContent));
  const place = async (type, cc, rr) => {
    await tapSel(`.tool[data-tool="${type}"]`);
    await tap(await at(cc, rr));
    await settle();
  };
  const overlaps = (a, b) => a && b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

  // socle d'abord, puis une carte glissée vers un AUTRE socle : le premier choix s'efface
  await open('1-2');
  await tap(await at(4, 1));
  let s = await st();
  check('socle d’abord : le socle touché est choisi', s.sel?.c === 4 && s.sel?.r === 1, JSON.stringify(s.sel));
  await drag(await center('.tool[data-tool="fire"]'), await at(2, 3, 60));
  s = await st();
  check('… une carte glissée vers un autre socle y pose', s.pending.some((e) => e[2] === 2 && e[3] === 3), JSON.stringify(s.pending));
  check('… et le premier socle n’est plus choisi (ni consigne ni pose en douce au toucher suivant)', !s.sel && !/Choisissez une lanterne/.test(await lane()), JSON.stringify({ sel: s.sel, lane: await lane() }));
  await wait(500);
  await tapSel('.tool[data-tool="fire"]');
  s = await st();
  check('… toucher ensuite une carte choisit l’outil sans poser sur l’ancien socle', s.tool === 'fire' && !s.pending.some((e) => e[2] === 4 && e[3] === 1), JSON.stringify(s));
  await ev(() => window.__input.setTool(null));
  await settle();

  // glisser depuis la palette interrompu par le système (pointercancel) : l'outil se range
  await drag(await center('.tool[data-tool="water"]'), await at(2, 5, 60), { end: 'touchCancel' });
  s = await st();
  check('pose glissée interrompue (geste annulé par le système) : rien n’est posé, l’outil se range', !s.tool && !s.pending.length, JSON.stringify(s));

  // nouvelle partie (relance de l'hôte, « Suivant ») pendant qu'un doigt tient une carte :
  // la carte disparaît sans « pointerup » ; la palette nouvelle doit répondre ensuite
  {
    const card = await center('.tool[data-tool="water"]');
    const to = await at(2, 5, 60);
    await touch('touchStart', card);
    for (let i = 1; i <= 6; i++) {
      await touch('touchMove', { x: card.x + ((to.x - card.x) * i) / 12, y: card.y + ((to.y - card.y) * i) / 12 });
      await wait(16);
    }
    await ev(() => window.__startLevel('1-2'));
    await wait(1200);
    await touch('touchEnd');
    await wait(200);
    box = await pg.locator('#board').boundingBox();
    await ev(() => (window.__state.game.gold = 3000));
    const ws = await ev(() => {
      const g = window.__state.game;
      for (let i = 0; i < g.grid.size; i++) if (g.grid.row(i) >= 3 && window.__commands.check('placeTower', 'water', g.grid.col(i), g.grid.row(i)).ok) return [g.grid.col(i), g.grid.row(i)];
      return null;
    });
    await drag(await center('.tool[data-tool="water"]'), await at(ws[0], ws[1], 60));
    s = await st();
    check('partie relancée pendant qu’un doigt tient une carte : la palette se glisse encore', s.pending.some((e) => e[1] === 'water' && e[2] === ws[0] && e[3] === ws[1]), JSON.stringify({ ws, s }));
    await ev(() => window.__input.setTool(null));
  }

  // tutoriel de 1-2 : la bulle de fusion ne couvre pas les lanternes à fusionner
  await open('1-2');
  await place('fire', 4, 1);
  await place('fire', 0, 4);
  await wait(600);
  const tut = await ev(() => {
    const b = document.querySelector('#hint:not(.hidden) .bubble');
    return b ? { text: b.textContent, r: b.getBoundingClientRect().toJSON() } : null;
  });
  const t1 = await at(4, 1, -12);
  const t2 = await at(0, 4, -12);
  const tile = (p) => ({ x: p.x - 20, y: p.y - 20, width: 40, height: 40 });
  check('tutoriel « Glissez une lanterne sur sa jumelle » : la bulle ne cache aucune des deux lanternes', tut && /jumelle/.test(tut.text) && !overlaps(tut.r, tile(t1)) && !overlaps(tut.r, tile(t2)), JSON.stringify({ tut, t1, t2 }));

  // pause : ni « Fusionner » dans la barre ni dans la fiche (la fusion n'y est pas possible)
  const barActs = () => ev(() => [...document.querySelectorAll('#tower-bar:not(.hidden) button')].map((b) => b.dataset.act));
  await tapSel('#btn-pause');
  await tap(await at(4, 1));
  const pbar = await barActs();
  check('en pause : la barre d’une lanterne ne propose pas « Fusionner »', pbar.length > 0 && !pbar.includes('fuse'), JSON.stringify(pbar));
  await ev(() => window.__sheets.open('tower', window.__state.game.towerAt(4, 1).id));
  await wait(150);
  check('en pause : la fiche non plus', !(await ev(() => !!document.querySelector('#info [data-act="fuse"]'))));
  await ev(() => window.__sheets.close());
  await ev(() => document.querySelector('#modal [data-act="resume"]')?.click());
  await wait(200);
  if (!(await barActs()).length) await tap(await at(4, 1));
  const rbar = await barActs();
  check('… après la reprise, « Fusionner » revient', rbar.includes('fuse'), JSON.stringify(rbar));
  await tap(await at(4, 1));

  // couloir : un message évite les lanternes ; sur une lanterne, il laisse passer le doigt
  await ev(() => {
    window.__hud.lane.reset();
    window.__hud.say({ key: 'qa', text: '刻 Socles réservés ▲ ● ◆ ■ : chacun n’accepte que son élément', prio: 2 });
  });
  await wait(500);
  const lr = await pg.locator('#lane').boundingBox();
  check('message du couloir : il ne couvre pas la lanterne du haut', lr && !overlaps(lr, tile(t1)), JSON.stringify({ lr, t1 }));
  // même posé exprès sur elle, il laisse passer le geste (la lanterne se glisse et fusionne)
  await ev(([x, y]) => {
    const L = window.__hud.lane;
    L.place = () => {};
    const el = document.getElementById('lane');
    const sr = document.getElementById('stage').getBoundingClientRect();
    el.style.left = `${Math.round(x - sr.left - 60)}px`;
    el.style.top = `${Math.round(y - sr.top - 25)}px`;
  }, [t1.x, t1.y]);
  await wait(80);
  const hitLane = await ev(([x, y]) => !!document.elementFromPoint(x, y)?.closest('#lane'), [t1.x, t1.y]);
  await drag(t1, await at(0, 4, 40), { hold: 50, steps: 16 });
  await settle();
  s = await st();
  check('lanterne sous un message : le geste passe au plateau (fusion)', hitLane && s.towers.some((t) => t[3] === 2), JSON.stringify({ hitLane, towers: s.towers }));
  check('… et le message touché s’efface', !(await ev(() => window.__hud.lane.current)));
  // message à action (fiche) posé sur une lanterne : le toucher choisit la lanterne
  const t3 = await at(0, 4, -12);
  await ev(([x, y]) => {
    window.__hud.say({ key: 'qa2', text: 'Kodama', detail: 'Nombreux', prio: 2, action: { kind: 'enemy', type: 'kodama' } });
    window.__hud.lane.update();
    const el = document.getElementById('lane');
    const sr = document.getElementById('stage').getBoundingClientRect();
    el.style.left = `${Math.round(x - sr.left - 40)}px`;
    el.style.top = `${Math.round(y - sr.top - 20)}px`;
  }, [t3.x, t3.y]);
  await wait(80);
  const hitLane2 = await ev(([x, y]) => !!document.elementFromPoint(x, y)?.closest('#lane'), [t3.x, t3.y]);
  await tap(t3);
  const pick = await ev(() => ({ sel: window.__input.ui.selectedTower, tower: window.__state.game.towerAt(0, 4)?.id, sheet: window.__sheets.isOpen }));
  check('message à action posé sur une lanterne : le toucher la choisit (pas la fiche du message)', hitLane2 && pick.sel === pick.tower && !pick.sheet, JSON.stringify({ hitLane2, ...pick }));
  await tap(t3);
  await ev(() => delete window.__hud.lane.place);

  // Combos (grande feuille) : la liste défile au doigt, « ‹ Pause » reste en haut
  await ev(() => window.__hud.lane.reset());
  await tapSel('#btn-pause');
  await tapSel('#modal [data-act="combos"]');
  await wait(300);
  const row = await center('#modal .combo-row:nth-of-type(2)');
  await drag({ x: row.x, y: row.y + 60 }, { x: row.x, y: row.y - 140 }, { hold: 20, steps: 12 });
  await wait(400);
  const scrolled = await ev(() => document.querySelector('#modal .modal-card').scrollTop);
  const backAt = await center('#modal [data-act="back"]');
  const backHit = await ev(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-act="back"]'), backAt);
  check('combos : la liste défile au doigt et « ‹ Pause » reste en haut, touchable', scrolled > 40 && backHit, JSON.stringify({ scrolled, backAt }));
  await tap(backAt);
  check('… « ‹ Pause » ramène au menu de pause', await ev(() => !!document.querySelector('#modal:not(.hidden) .pause-main [data-act="resume"]')));
  await ev(() => document.querySelector('#modal [data-act="resume"]')?.click());
  await wait(200);

  // pierres : les textes disent la règle du moteur (une pierre retirée ne revient pas)
  await open('1-4');
  await ev(() => {
    const g = window.__state.game;
    g.stats.stones = g.stoneConf().max;
  });
  await wait(100);
  await tapSel('.tool[data-tool="stone"]');
  const tipStone = await ev(() => (document.getElementById('tip').classList.contains('hidden') ? '' : document.getElementById('tip').textContent));
  check('plus de pierres : l’indication ne promet pas qu’en retirer une la rend', /Plus de pierres/.test(tipStone) && !/retirer/.test(tipStone), tipStone);
  await ev(() => window.__sheets.open('stoneTool'));
  await wait(150);
  const toolSheet = await ev(() => document.getElementById('info').textContent);
  check('fiche de l’outil pierre : « la pierre ne revient pas »', /ne revient pas/.test(toolSheet) && !/la pierre revient/.test(toolSheet), toolSheet.slice(0, 200));
  await ev(() => window.__sheets.close());

  // coopération (simulée) : toucher un socle réservé à l'élément d'un coéquipier ne le
  // choisit pas (la consigne « Choisissez une lanterne » n'aurait aucune carte possible)
  await pg.goto('http://localhost:8080/?broker=off', { waitUntil: 'networkidle' });
  await ev(async () => {
    const { Game, assignElements } = await import('/src/core/game.js');
    const { defs, loadLevel } = await import('/src/data.js');
    const level = await loadLevel('1-2');
    const els = assignElements(['fire', 'water']);
    const players = [
      { name: 'Aki', elements: els[0], element: 'fire' },
      { name: 'Moi', elements: els[1], element: 'water' },
    ];
    const game = new Game(level, defs, { seed: 3, players, localPlayer: 1 });
    window.__state.coopRole = 'host';
    window.__state.coopPlayers = players;
    window.__beginGame('1-2', level, game, { hard: false, challenge: false });
  });
  await wait(800);
  box = await pg.locator('#board').boundingBox();
  const fireSlot = await ev(() => {
    const g = window.__state.game;
    for (let i = 0; i < g.grid.size; i++) if (g.grid.type(i) === 3 && g.grid.slotElement[i] === 'fire') return [g.grid.col(i), g.grid.row(i)];
    return null;
  });
  await tap(await at(fireSlot[0], fireSlot[1]));
  const rs = await ev(() => ({ sel: window.__input.ui.selectedSlot, flash: window.__input.ui.flash?.text || '', forbid: document.querySelectorAll('#palette .tool.forbid').length }));
  check('coop : socle réservé au coéquipier touché : pas choisi, refus dit sur le socle', !rs.sel && rs.forbid === 0 && /Socle réservé/.test(rs.flash), JSON.stringify(rs));
  await ev(() => {
    window.__state.coopRole = null;
    window.__state.coopPlayers = null;
  });

  // un message hors partie ne suit pas dans la partie (un seul message à la fois)
  await pg.goto('http://localhost:8080/?broker=off', { waitUntil: 'networkidle' });
  await ev(() => document.getElementById('app-toast').classList.add('show'));
  await ev(() => window.__startLevel('1-1'));
  await wait(900);
  check('message de l’accueil effacé en entrant en partie', !(await ev(() => document.getElementById('app-toast').classList.contains('show'))));
  await c.close();
}

check('aucune erreur console', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests d’interface passent');
process.exit(failures ? 1 : 0);
