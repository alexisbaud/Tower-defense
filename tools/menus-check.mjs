// Vérifie les écrans hors partie (lot MENUS, docs/UI-UX.md §6.15 à §6.22).
//
// Node : code de progression (aller-retour, lecture tolérante, code abîmé refusé,
// import par maximum : un import ne baisse jamais un record).
//
// Navigateur, doigt simulé, en INSTALLATION ACTUELLE (la page commence sous la barre
// d'état opaque : fenêtre = H − barre, --sat = 0) : 375×647, 390×797, 393×793, 430×873.
//   Accueil : héros « Jouer » (1-1 d'un toucher) puis « Continuer », « Niveaux »,
//   « À plusieurs » ; salon en feuille (code « BQKR » entier dans le champ, voile qui
//   ferme) ; réglages (code de progression, import, taille du texte) ; carte (étiquettes
//   « 1-1 · Nom » jamais tronquées, dans l'écran, sans chevauchement ; défilement vers le
//   niveau à jouer ; retour d'une victoire) ; fiche de niveau (variantes cachées avant
//   la 1re victoire, « Jouer » visible) ; message hors partie au-dessus des boutons ;
//   écran de rotation. Règles : boutons ≥ 44 px espacés ≥ 8 px, textes ≥ 12 px, libellés
//   d'action ≥ 13 px, aucun débordement horizontal, aucun « … » (sauf noms de joueurs).
// En ANCIENNE INSTALLATION (classe ios26-app, --sat = X + 40, fenêtre pleine, X = 20, 47,
//   59, 62) : aucun texte, bouton, sceau ni image ne commence dans la bande floue
//   [0, X + 40) (accueil, carte, fiche de niveau, salon, réglages) ; l'invitation à
//   réinstaller s'affiche (encart > 0) et « Plus tard » la range pour de bon.
// Coopération (relais local joignable) : accueil de l'hôte (« Jouer à 2 », équipe) et
// de l'invité (attente, « Salon »).
// Usage : (serveur local sur :8080) node tools/menus-check.mjs [url de base]
import { createRequire } from 'node:module';
import { brokerQuery } from './relay.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? '✓' : '✗'} ${name}${!cond && extra ? `\n    ${extra}` : ''}`);
};

// ───────────── Node : code de progression ─────────────
{
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v) };
  const { save, exportCode, decodeCode, sanitize } = await import('../src/save.js?menus');
  const ids = ['1-1', '1-2', '1-3', '1-4', '2-1', '2-2', '2-3', '2-4'];
  let rt = true;
  for (let t = 0; t < 500 && rt; t++) {
    const d = sanitize({});
    for (const id of ids) {
      if (Math.random() < 0.7) d.stars[id] = 1 + Math.floor(Math.random() * 3);
      if (Math.random() < 0.3) d.hard[id] = 1 + Math.floor(Math.random() * 3);
      if (Math.random() < 0.3) d.challenge[id] = true;
    }
    d.rewindTutorialSeen = Math.random() < 0.5;
    const code = exportCode(d);
    const back = decodeCode(code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l'));
    rt = !!back && ids.every((id) => (back.stars[id] || 0) === (d.stars[id] || 0) && (back.hard[id] || 0) === (d.hard[id] || 0) && !!back.challenge[id] === !!d.challenge[id]) && back.flags.rewindTutorialSeen === d.rewindTutorialSeen && /^JDE1-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/.test(code);
  }
  ok('code de progression : aller-retour (500 sauvegardes, minuscules, O/0, l/1, espaces)', rt);
  let det = 0;
  let tot = 0;
  const body = exportCode(sanitize({ stars: { '1-1': 3, '1-2': 2, '2-1': 1 }, hard: { '1-1': 2 } })).slice(5).replace('-', '');
  for (let p = 0; p < 10; p++) {
    for (const ch of '0123456789ABCDEFGHJKMNPQRSTVWXYZ') {
      if (ch === body[p]) continue;
      tot++;
      if (!decodeCode(body.slice(0, p) + ch + body.slice(p + 1))) det++;
    }
  }
  ok(`code abîmé (un caractère faux) refusé : ${det}/${tot}`, det / tot > 0.95);
  save.record('1-1', 2);
  save.record('1-2', 3);
  const r = save.importCode(exportCode(sanitize({ stars: { '1-1': 3, '1-2': 1, '1-3': 2 }, challenge: { '1-3': true } })));
  ok('import : fusion par maximum (rien ne baisse)', r.ok && save.stars('1-1') === 3 && save.stars('1-2') === 3 && save.stars('1-3') === 2 && save.level('1-3').challenge && r.stars === 8);
  const bad = save.importCode('JDE1-ZZZZZ-ZZZZZ');
  ok('import : code invalide refusé, sauvegarde intacte', !bad.ok && /invalide/.test(bad.error) && save.totalStars() === 8);
  // (navigateur) code d'une autre installation : 1-3 gagné (2 ★) ; 1-1 moins bon
  globalThis.IMPORT_CODE = exportCode(sanitize({ stars: { '1-1': 1, '1-3': 2 } }));
  delete globalThis.localStorage;
}

// ───────────── Navigateur ─────────────
const BASE = (process.argv[2] || 'http://localhost:8080/').replace(/\?.*$/, '');
const Q = await brokerQuery();
const online = Q !== 'broker=off';
const URL = `${BASE}?${Q}`;
const PROG = { stars: { '1-1': 3, '1-2': 2 }, hard: {}, challenge: { '1-1': true }, muted: true, music: false, rewindTutorialSeen: true };
const errors = [];
const browser = await chromium.launch();

async function open(w, h, { save = null, legacy = null, query = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${w}×${h} ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${w}×${h} ${m.text()}`));
  // installation actuelle : --sat 0 ; ancienne : classe ios26-app, encart X + garde-fou de
  // 40 px (--inset-top tient lieu de l'encart réel pour la sonde de l'invitation). Posés
  // avant le premier rendu, comme sur l'appareil.
  const css = legacy != null ? `:root.ios26-app{--sat:${legacy + 40}px !important;--inset-top:${legacy}px;--sab:${h > 700 ? 34 : 0}px !important}` : `:root{--sat:0px !important;--sab:${h > 700 ? 34 : 0}px !important}`;
  await page.addInitScript(
    ([save, legacy, css]) => {
      try {
        localStorage.setItem('jardin-des-esprits:v1', JSON.stringify(save || { muted: true, music: false }));
      } catch {}
      const put = () => {
        if (legacy != null) document.documentElement.classList.add('ios26-app');
        const st = document.createElement('style');
        st.textContent = css;
        document.documentElement.appendChild(st);
      };
      if (document.documentElement) put();
      else document.addEventListener('readystatechange', put, { once: true });
    },
    [save, legacy, css],
  );
  await page.goto(`${URL}${query}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(400);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, q) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: q.x, y: q.y, id: 1, radiusX: 6, radiusY: 6 }] });
  page.tap = async (q) => {
    await touch('touchStart', q);
    await page.waitForTimeout(50);
    await touch('touchEnd');
    await page.waitForTimeout(250);
  };
  page.tapSel = async (sel) => {
    const r = await page.locator(sel).first().boundingBox();
    if (!r) throw new Error(`${sel} introuvable`);
    await page.tap({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  };
  page.ctx = ctx;
  return page;
}

// Règles communes de mise en page sur l'écran courant (et la feuille ouverte).
async function rules(page, label) {
  const res = await page.evaluate(() => {
    const issues = [];
    const W = innerWidth;
    const H = innerHeight;
    if (document.documentElement.scrollWidth > W + 1) issues.push(`débordement horizontal ${document.documentElement.scrollWidth}px`);
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (!r.width || !r.height || st.visibility === 'hidden' || el.closest('.hidden, [hidden]')) return null;
      if (el.closest('.screen') && !el.closest('.screen.active')) return null;
      if (el.closest('#modal') && document.getElementById('modal').classList.contains('hidden')) return null;
      if (el.closest('#rotate') && getComputedStyle(document.getElementById('rotate')).display === 'none') return null;
      return r;
    };
    const reachable = (b, r) => {
      const x = Math.min(W - 1, Math.max(0, r.left + r.width / 2));
      const y = Math.min(H - 1, Math.max(0, r.top + r.height / 2));
      const hit = document.elementFromPoint(x, y);
      return !!hit && (b.contains(hit) || hit.contains(b));
    };
    const btns = [];
    for (const b of document.querySelectorAll('button, a[href], input')) {
      const r = shown(b);
      if (!r || r.bottom < 0 || r.top > H) continue; // hors de la vue (carte, feuille qui défile)
      if (!reachable(b, r)) continue;
      btns.push({ r, b });
      const name = (b.getAttribute('aria-label') || b.textContent || b.value || '').trim().slice(0, 22);
      if (r.width < 43.5 || r.height < 43.5) issues.push(`cible trop petite ${Math.round(r.width)}×${Math.round(r.height)} « ${name} »`);
      if (r.left < -1 || r.right > W + 1) issues.push(`cible hors écran « ${name} »`);
    }
    for (const a of btns) {
      for (const c of btns) {
        if (a === c || a.b.contains(c.b) || c.b.contains(a.b)) continue;
        // en-tête collant d'une feuille : le corps défile dessous (pas une même rangée)
        if (!!a.b.closest('.menu-head') !== !!c.b.closest('.menu-head')) continue;
        const sameRow = Math.min(a.r.bottom, c.r.bottom) - Math.max(a.r.top, c.r.top) > 10;
        if (!sameRow || c.r.left < a.r.left || (c.r.left === a.r.left && c.r.top < a.r.top)) continue;
        const gap = c.r.left - a.r.right;
        const n = (x) => (x.b.getAttribute('aria-label') || x.b.textContent || '').trim().slice(0, 14);
        if (gap < 0 && Math.min(a.r.right, c.r.right) - Math.max(a.r.left, c.r.left) > 0) issues.push(`cibles superposées « ${n(a)} » / « ${n(c)} »`);
        else if (gap >= 0 && gap < 7.5) issues.push(`cibles à ${Math.round(gap)} px « ${n(a)} » / « ${n(c)} »`);
      }
    }
    const scope = document.querySelectorAll('.screen.active *, #modal:not(.hidden) *, #app-toast.show, #rotate *');
    for (const el of scope) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = shown(el);
      if (!r || r.bottom < 0 || r.top > H) continue;
      const st = getComputedStyle(el);
      const fs = parseFloat(st.fontSize);
      const t = el.textContent.trim().slice(0, 18);
      if (fs > 0 && fs < 11.9) issues.push(`texte ${fs}px « ${t} »`);
      // libellé d'action : ≥ 13 px (sauf les compléments : sous-ligne, marques)
      const btn = el.closest('button');
      if (btn && fs < 12.9 && !el.closest('small, .boss-tag, .node-mark, .lobby-tag, .map-label small, .el-badge')) issues.push(`libellé d'action ${fs}px « ${t} »`);
      if (st.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && !el.closest('.lobby-pname, .tt-mate')) issues.push(`texte tronqué « ${t} »`);
      if (r.left < -1 || r.right > W + 1) issues.push(`texte hors écran « ${t} »`);
    }
    return [...new Set(issues)];
  });
  ok(`${label}`, !res.length, res.join('\n    '));
}

// Étiquettes de la carte : entières, dans l'écran, sans chevauchement (ni entre elles,
// ni avec un autre nœud).
async function mapLabels(page, label) {
  const res = await page.evaluate(() => {
    const issues = [];
    const W = innerWidth;
    const labels = [...document.querySelectorAll('.map-label')];
    const nodes = [...document.querySelectorAll('.map-node .face')];
    for (const l of labels) {
      const r = l.getBoundingClientRect();
      const t = l.textContent.trim().slice(0, 24);
      if (l.scrollWidth > l.clientWidth + 1 || l.scrollHeight > l.clientHeight + 1) issues.push(`étiquette rognée « ${t} »`);
      if (r.left < 4 || r.right > W - 4) issues.push(`étiquette hors écran « ${t} » (${Math.round(r.left)}–${Math.round(r.right)})`);
      for (const b of [...labels.filter((x) => x !== l), ...nodes.filter((n) => !l.parentElement.contains(n))]) {
        const q = b.getBoundingClientRect();
        if (Math.min(r.right, q.right) - Math.max(r.left, q.left) > 2 && Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top) > 2) issues.push(`étiquette « ${t} » chevauche « ${b.textContent.trim().slice(0, 12)} »`);
      }
      const lines = Math.round(l.querySelector('b').getBoundingClientRect().height / parseFloat(getComputedStyle(l.querySelector('b')).lineHeight));
      if (lines > 2) issues.push(`nom sur ${lines} lignes « ${t} »`);
    }
    if (labels.length < 8) issues.push(`${labels.length} étiquettes seulement`);
    return [...new Set(issues)];
  });
  ok(label, !res.length, res.join('\n    '));
}

const isOpen = (page, cls) => page.evaluate((cls) => !document.getElementById('modal').classList.contains('hidden') && document.querySelector('#modal .modal-card').classList.contains(cls), cls);

// ───────── Installation actuelle ─────────
for (const [w, h] of [
  [375, 647],
  [390, 797],
  [393, 793],
  [430, 873],
]) {
  const S = `${w}×${h}`;
  // premier lancement : « Jouer · 1-1 » lance le niveau d'un toucher
  let page = await open(w, h);
  await page.waitForFunction(() => /Le Seuil/.test(document.getElementById('btn-play-sub')?.textContent || ''), null, { timeout: 4000 }).catch(() => {});
  const first = await page.evaluate(() => ({ label: document.getElementById('btn-play-label').textContent, sub: document.getElementById('btn-play-sub').textContent }));
  ok(`${S} premier lancement : « ${first.label} · ${first.sub} »`, first.label === 'Jouer' && /^1-1 · Le Seuil$/.test(first.sub));
  await rules(page, `${S} accueil (premier lancement)`);
  await page.tapSel('#btn-play');
  await page.waitForTimeout(900);
  ok(`${S} « Jouer » : 1-1 lancé en un toucher`, await page.evaluate(() => window.__state.screen === 'game' && window.__state.levelId === '1-1'));
  await page.ctx.close();

  // progression : « Continuer · 1-3 », carte, fiches
  page = await open(w, h, { save: PROG });
  await page.waitForFunction(() => /L’Étang|L'Étang/.test(document.getElementById('btn-play-sub')?.textContent || ''), null, { timeout: 4000 }).catch(() => {});
  const cont = await page.evaluate(() => `${document.getElementById('btn-play-label').textContent} · ${document.getElementById('btn-play-sub').textContent}`);
  ok(`${S} accueil : « ${cont} »`, /^Continuer · 1-3 · L/.test(cont));
  // message hors partie : 12 px au-dessus des boutons
  await page.evaluate(() => window.__lobby.toast('Lien du salon copié'));
  await page.waitForTimeout(300);
  const toast = await page.evaluate(() => {
    const t = document.getElementById('app-toast').getBoundingClientRect();
    const a = document.querySelector('#screen-title .title-actions').getBoundingClientRect();
    return { gap: Math.round(a.top - t.bottom), shown: document.getElementById('app-toast').classList.contains('show') };
  });
  ok(`${S} message hors partie au-dessus des boutons (écart ${toast.gap} px)`, toast.shown && toast.gap >= 10 && toast.gap <= 14);
  await rules(page, `${S} accueil (Continuer, message)`);

  // salon en feuille
  await page.tapSel('#btn-multi');
  await page.waitForTimeout(450);
  ok(`${S} « À plusieurs » ouvre la feuille du salon`, (await isOpen(page, 'salon-sheet')) && (await page.evaluate(() => !!document.querySelector('#modal #title-lobby .lobby-code'))));
  await rules(page, `${S} salon (feuille)`);
  const field = await page.evaluate(() => {
    const i = document.querySelector('.lobby-join-input');
    i.value = 'BQKR';
    i.dispatchEvent(new Event('input'));
    const r = i.getBoundingClientRect();
    // largeur réelle du texte saisi (Mincho 26, espacement 0,3 em)
    const c = document.createElement('canvas').getContext('2d');
    const st = getComputedStyle(i);
    c.font = `${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
    const text = c.measureText('BQKR').width + 4 * parseFloat(st.letterSpacing || 0);
    return { value: i.value, room: r.width - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight) - 4, text: Math.round(text), enabled: !document.querySelector('.lobby-join-ok').disabled };
  });
  ok(`${S} champ de code : « BQKR » entier (${field.text} px pour ${Math.round(field.room)})`, field.value === 'BQKR' && field.text <= field.room && field.enabled);
  // le voile ferme la feuille, le salon retourne à sa place
  await page.tap({ x: w / 2, y: 20 });
  await page.waitForTimeout(350);
  ok(`${S} toucher le voile ferme le salon`, await page.evaluate(() => document.getElementById('modal').classList.contains('hidden') && !!document.querySelector('.lobby-park #title-lobby')));

  // réglages
  await page.tapSel('#btn-title-settings');
  await page.waitForTimeout(450);
  ok(`${S} réglages ouverts`, await isOpen(page, 'settings-sheet'));
  await rules(page, `${S} réglages`);
  const code = await page.evaluate(() => ({ shown: document.querySelector('.code-val').textContent.replace(/\s/g, ''), real: window.__save.exportCode() }));
  ok(`${S} réglages : code affiché = sauvegarde (${code.shown})`, code.shown === code.real);
  if (w === 390) {
    await page.evaluate(() => document.querySelector('.code-import-open').click());
    await page.fill('.code-input', 'JDE1-AAAAA-AAAAA');
    await page.evaluate(() => document.querySelector('.code-import-ok').click());
    const badMsg = await page.evaluate(() => document.querySelector('.code-msg').textContent);
    ok(`${S} import d'un code abîmé : « ${badMsg} »`, /invalide/.test(badMsg) && (await page.evaluate(() => window.__save.totalStars())) === 5);
    await page.evaluate(() => document.querySelector('.set-seg-text button[data-v="1.15"]').click());
    ok(`${S} taille du texte « Grande » : --fs-scale = 1.15`, await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs-scale').trim() === '1.15' && window.__save.data.textScale === 1.15));
    await rules(page, `${S} réglages en texte « Grande »`);
    await page.evaluate(() => document.querySelector('.set-seg-text button[data-v="1"]').click());
  }
  await page.tapSel('#modal .menu-x');
  await page.waitForTimeout(300);
  ok(`${S} ✕ ferme les réglages`, await page.evaluate(() => document.getElementById('modal').classList.contains('hidden')));

  // carte : en-tête, étiquettes, défilement vers le niveau à jouer
  await page.tapSel('#btn-levels');
  await page.waitForTimeout(1300);
  await rules(page, `${S} carte`);
  await mapLabels(page, `${S} carte : étiquettes entières, dans l'écran, sans chevauchement`);
  const nextVis = await page.evaluate(() => {
    const n = document.querySelector('.map-node.next')?.getBoundingClientRect();
    const b = document.querySelector('.map-body').getBoundingClientRect();
    return !!n && n.top >= b.top && n.bottom <= b.bottom;
  });
  ok(`${S} carte : le niveau à jouer est à l'écran`, nextVis);
  const head = await page.evaluate(() => ({ h: Math.round(document.querySelector('.map-head').getBoundingClientRect().height), back: document.getElementById('btn-map-back').textContent.trim(), title: document.querySelector('.map-head h2').textContent, stars: document.querySelector('.map-stars').textContent.trim() }));
  ok(`${S} en-tête de la carte : 44 px, « ‹ ${head.back} », « ${head.title} », « ${head.stars} »`, head.h === 44 && head.back === 'Accueil' && head.title === 'Niveaux' && head.stars === '★5/24');
  // fiche d'un niveau gagné : variantes ; d'un niveau jamais gagné : pas de variantes
  await page.evaluate(() => document.querySelector('.map-node[data-level="1-1"]').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  await page.tapSel('.map-node[data-level="1-1"] .face');
  await page.waitForTimeout(600);
  ok(`${S} fiche du 1-1 (gagné) : Difficile et défi`, (await isOpen(page, 'level-card')) && (await page.locator('#modal .lv-opt[data-opt="hard"]').count()) === 1 && (await page.locator('#modal .lv-opt[data-opt="challenge"]').count()) === 1);
  await rules(page, `${S} fiche de niveau (1-1, variantes)`);
  const play = await page.evaluate(() => {
    const b = document.querySelector('#modal .lv-play').getBoundingClientRect();
    return b.bottom <= innerHeight + 0.5 && b.top >= 0 && b.height >= 55;
  });
  ok(`${S} fiche de niveau : « Jouer » (56) visible sans défiler`, play);
  await page.evaluate(() => document.querySelector('#modal .lv-opt[data-opt="challenge"]').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  await page.tapSel('#modal .lv-opt[data-opt="challenge"]');
  ok(`${S} fiche : le défi s'active, « Jouer » le rappelle`, await page.evaluate(() => /Défi/.test(document.querySelector('#modal .lv-play').textContent)));
  await page.tapSel('#modal .menu-x');
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('.map-node[data-level="1-3"]').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  await page.tapSel('.map-node[data-level="1-3"] .face');
  await page.waitForTimeout(600);
  ok(`${S} fiche du 1-3 (jamais gagné) : ni Difficile ni défi`, (await isOpen(page, 'level-card')) && (await page.locator('#modal .lv-options').count()) === 0);
  await rules(page, `${S} fiche de niveau (1-3, première fois)`);
  await page.tapSel('#modal .menu-x');
  await page.waitForTimeout(300);
  // niveau scellé
  await page.evaluate(() => document.querySelector('.map-node.locked').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  await page.tapSel('.map-node.locked .face');
  await page.waitForTimeout(500);
  ok(`${S} niveau scellé : feuille explicative`, (await isOpen(page, 'level-sealed')) && /Gagnez/.test(await page.evaluate(() => document.querySelector('#modal').textContent)));
  await page.tapSel('#modal .actions .btn');
  await page.waitForTimeout(300);
  // retour d'une victoire : célébration sur la carte (sans erreur), puis carte stable
  await page.evaluate(() => {
    window.__save.record('1-3', 3);
    window.__showScreen('map', { justCleared: '1-3' });
  });
  await page.waitForTimeout(2200);
  ok(`${S} retour d'une victoire : 1-4 ouvert, à jouer`, await page.evaluate(() => !!document.querySelector('.map-node.next[data-level="1-4"]') && !document.querySelector('.map-fx')));
  await page.tapSel('#btn-map-back');
  await page.waitForTimeout(500);
  ok(`${S} « ‹ Accueil » : retour à l'accueil, héros sur 1-4`, await page.evaluate(() => window.__state.screen === 'title' && /^1-4/.test(document.getElementById('btn-play-sub').textContent)));
  if (w === 390) {
    // paysage : écran de rotation (aplat, consigne)
    await page.setViewportSize({ width: 797, height: 390 });
    await page.waitForTimeout(300);
    const rot = await page.evaluate(() => ({ shown: getComputedStyle(document.getElementById('rotate')).display !== 'none', text: document.querySelector('#rotate p').textContent }));
    ok(`${S} paysage : « ${rot.text} »`, rot.shown && /portrait/.test(rot.text));
    await rules(page, `${S} écran de rotation`);
    await page.setViewportSize({ width: w, height: h });
  }
  await page.ctx.close();
}

// ───────── Import d'un code dans une autre installation ─────────
{
  const page = await open(390, 797, { save: PROG });
  await page.tapSel('#btn-title-settings');
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('.code-import-open').click());
  await page.fill('.code-input', globalThis.IMPORT_CODE.toLowerCase().replace(/-/g, ' '));
  await page.evaluate(() => document.querySelector('.code-import-ok').click());
  const r = await page.evaluate(() => ({ msg: document.querySelector('.code-msg').textContent, s11: window.__save.stars('1-1'), s13: window.__save.stars('1-3'), code: document.querySelector('.code-val').textContent.replace(/\s/g, ''), real: window.__save.exportCode() }));
  ok(`import d'un code saisi à la main : « ${r.msg} », records gardés au maximum`, /Progression importée : 7 ★/.test(r.msg) && r.s11 === 3 && r.s13 === 2 && r.code === r.real);
  await page.tapSel('#modal .menu-x');
  await page.waitForTimeout(300);
  ok('après l’import, l’accueil propose le niveau suivant (1-4)', await page.evaluate(() => /^1-4/.test(document.getElementById('btn-play-sub').textContent)));
  await page.ctx.close();
}

// ───────── Ancienne installation : bande floue [0, X + 40) ─────────
const inBand = (page, limit) =>
  page.evaluate((limit) => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const thing = el.matches('button, [role=button], input, a, .seal, .menu-seal, img, .modal-kanji, .sheet-grabber, .mw-seal');
      if (!text && !thing) continue;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (!r.width || !r.height || st.visibility === 'hidden' || +st.opacity === 0 || el.closest('.hidden, [hidden]')) continue;
      if (el.closest('.screen') && !el.closest('.screen.active')) continue;
      if (el.closest('#modal') && document.getElementById('modal').classList.contains('hidden')) continue;
      if (el.closest('#rotate') && getComputedStyle(document.getElementById('rotate')).display === 'none') continue;
      // partie visible : rognée par les conteneurs qui défilent (carte, feuille)
      let top = r.top;
      let bottom = r.bottom;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const o = getComputedStyle(a);
        if (o.overflowY === 'visible' && o.overflowX === 'visible') continue;
        const q = a.getBoundingClientRect();
        top = Math.max(top, q.top);
        bottom = Math.min(bottom, q.bottom);
      }
      if (bottom - top < 1 || bottom <= 0 || top >= limit) continue;
      out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} « ${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)} » y=${Math.round(r.top)}`);
    }
    return out;
  }, limit);
for (const [w, h, X] of [
  [375, 667, 20],
  [390, 844, 47],
  [393, 852, 59],
  [402, 874, 62],
]) {
  const S = `${w}×${h} ancienne installation (encart ${X})`;
  const page = await open(w, h, { save: PROG, legacy: X });
  const lim = X + 40;
  const check = async (what) => {
    const r = await inBand(page, lim);
    ok(`${S} ${what} : rien dans [0, ${lim})`, !r.length, r.join('\n    '));
  };
  const inv = await page.evaluate(() => ({ kind: document.getElementById('title-notice').dataset.kind, hidden: document.getElementById('title-notice').classList.contains('hidden') }));
  ok(`${S} invitation à réinstaller affichée`, inv.kind === 'reinstall' && !inv.hidden, JSON.stringify(inv));
  await check('accueil');
  await rules(page, `${S} accueil avec invitation`);
  await page.tapSel('#title-notice .notice-main');
  await page.waitForTimeout(500);
  ok(`${S} invitation → réglages, rubrique « Ma progression »`, (await isOpen(page, 'settings-sheet')) && (await page.evaluate(() => {
    const r = document.getElementById('set-progress').getBoundingClientRect();
    return r.top >= 0 && r.top < innerHeight * 0.6;
  })));
  await check('réglages');
  await page.tapSel('#modal .menu-x');
  await page.waitForTimeout(300);
  await page.tapSel('#title-notice .notice-later');
  await page.waitForTimeout(200);
  ok(`${S} « Plus tard » range l'invitation pour de bon`, await page.evaluate(() => document.getElementById('title-notice').classList.contains('hidden') && window.__save.data.reinstallHintSeen === true));
  await page.tapSel('#btn-multi');
  await page.waitForTimeout(450);
  await check('salon');
  await page.tap({ x: w / 2, y: lim + 10 });
  await page.waitForTimeout(300);
  await page.tapSel('#btn-levels');
  await page.waitForTimeout(1200);
  await check('carte');
  await page.evaluate(() => document.querySelector('.map-node[data-level="1-2"]').scrollIntoView({ block: 'center' }));
  await page.tapSel('.map-node[data-level="1-2"] .face');
  await page.waitForTimeout(600);
  await check('fiche de niveau');
  await page.ctx.close();
}

// ───────── Coopération : accueil de l'hôte et de l'invité ─────────
if (online) {
  const host = await open(390, 797, { save: PROG });
  await host.waitForFunction(() => window.__session.online, null, { timeout: 8000 });
  const code = await host.evaluate(() => window.__session.code);
  const guest = await open(390, 797, { query: `&salon=${code}` });
  await guest.waitForFunction(() => window.__session.role === 'guest' && window.__session.online, null, { timeout: 10000 });
  await host.waitForFunction(() => window.__session.lobby?.players.length === 2, null, { timeout: 8000 });
  await host.waitForTimeout(400);
  const h = await host.evaluate(() => ({ label: document.getElementById('btn-play-label').textContent, sub: document.getElementById('btn-play-sub').textContent, team: document.querySelectorAll('#title-team .tt-mate').length, count: document.getElementById('btn-multi-count').textContent, notice: document.getElementById('title-notice').textContent }));
  ok(`hôte avec un invité : « ${h.label} · ${h.sub} », équipe ${h.team}, « À plusieurs (${h.count}) », annonce « ${h.notice} »`, h.label === 'Jouer à 2' && h.sub === 'Choisir le niveau' && h.team === 2 && h.count === '2' && /a rejoint votre salon/.test(h.notice));
  await rules(host, 'accueil de l’hôte (à deux)');
  const g = await guest.evaluate(() => ({ sheet: !document.getElementById('modal').classList.contains('hidden') && document.querySelector('#modal .modal-card').classList.contains('salon-sheet'), hero: !document.getElementById('btn-play').classList.contains('hidden') }));
  ok('invité arrivé par le lien : la feuille du salon s’ouvre d’elle-même', g.sheet);
  await rules(guest, 'salon de l’invité (feuille)');
  await guest.tap({ x: 195, y: 20 });
  await guest.waitForTimeout(300);
  const gh = await guest.evaluate(() => ({ wait: !document.getElementById('title-wait').classList.contains('hidden'), hero: !document.getElementById('btn-play').classList.contains('hidden'), levels: !document.getElementById('btn-levels').classList.contains('hidden'), multi: document.getElementById('btn-multi-label').textContent }));
  ok('accueil de l’invité : attente, ni héros ni « Niveaux », « Salon »', gh.wait && !gh.hero && !gh.levels && gh.multi === 'Salon');
  await rules(guest, 'accueil de l’invité');
  // « Quitter le salon » se confirme (second toucher)
  await guest.tapSel('#btn-multi');
  await guest.waitForTimeout(400);
  await guest.tapSel('.lobby-leave');
  const armed = await guest.evaluate(() => window.__session.role === 'guest' && document.querySelector('.lobby-leave').classList.contains('armed'));
  await guest.tapSel('.lobby-leave');
  await guest.waitForTimeout(600);
  ok('« Quitter le salon » : armé au 1er toucher, quitté au 2e', armed && (await guest.evaluate(() => window.__session.role === 'host')));
  await host.ctx.close();
  await guest.ctx.close();
} else console.log('(relais local injoignable : accueil à plusieurs non vérifié)');

ok('console sans erreur', !errors.length, errors.join('\n    '));
await browser.close();
console.log(fails ? `\n${fails} échec(s)` : '\nToutes les vérifications des menus passent');
process.exit(fails ? 1 : 0);
