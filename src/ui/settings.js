// Réglages : feuille grande, modale, ouverte depuis l'accueil (curseurs) et depuis la
// pause (« Réglages »). Son, musique, effets ; confort (taille du texte, ralenti de
// visée, bouton de vague à gauche) ; code de progression (copier, partager, importer) ;
// « Haut de l'écran flou ? » (réinstaller l'app sans perdre sa progression) ; à propos.
//
// Contrat (docs/UI-UX.md §9.4) : openSettings({ section }) ; main.js injecte les
// rappels par initSettings() : showModal, close, setMuted, setMusic, onEffects,
// onTextScale, onImport, sound. Les réglages s'écrivent dans save (src/save.js) ; leur
// effet en partie est l'affaire de la partie (save.data.effects, textScale…).
import { save, TEXT_SCALES } from '../save.js';

let deps = null;
export function initSettings(d) {
  deps = d;
}

const X_ICON = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>';
const BACK_ICON = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 4l-6 6 6 6"/></svg>';
const SCALE_LABELS = ['Normale', 'Grande', 'Très grande'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function switchRow(key, label, on, hint = '') {
  return `<button type="button" class="set-row set-switch" role="switch" aria-checked="${on}" data-key="${key}"><span class="set-l">${label}${hint ? ` <small>${hint}</small>` : ''}</span><span class="switch${on ? ' on' : ''}" aria-hidden="true"></span></button>`;
}

function seg(name, label, options, current) {
  const id = `set-${name}-l`;
  return `<div class="set-row set-seg set-seg-${name}"><span class="set-l" id="${id}">${label}</span><div class="seg light" role="radiogroup" aria-labelledby="${id}" data-seg="${name}">${options
    .map(([v, txt]) => `<button type="button" role="radio" aria-checked="${String(v) === String(current)}" class="${String(v) === String(current) ? 'on' : ''}" data-v="${v}">${txt}</button>`)
    .join('')}</div></div>`;
}

// Le code s'affiche en entier, en Zen Kaku 700 (chiffres et lettres sans ambiguïté).
function codeHTML(code) {
  return code
    .split('-')
    .map((g, i) => `<span class="${i ? 'code-g' : 'code-p'}">${g}</span>`)
    .join('<span class="code-dash" aria-hidden="true">-</span>');
}

function offlineReady() {
  try {
    return !!navigator.serviceWorker?.controller;
  } catch {
    return false;
  }
}

/**
 * Ouvre la feuille Réglages.
 * @param {object} o { section: 'progress' | 'screen' (défile jusqu'à la rubrique),
 *                     back: { label, run } (bouton retour, ex. « ‹ Pause »), onClose() }
 */
export function openSettings({ section = null, back = null, onClose = null, from = null } = {}) {
  if (!deps) return null;
  // depuis la pause : « ‹ Pause » ; fermer la feuille y ramène aussi (la partie reste en pause)
  if (typeof back === 'function') back = { label: from === 'pause' ? 'Pause' : 'Retour', run: back };
  if (back && !onClose) onClose = () => back.run?.();
  const d = save.data;
  const code = save.exportCode();
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const html = `
    <div class="sheet-head menu-head">
      ${back ? `<button type="button" class="menu-back" data-act="back">${BACK_ICON}<span>${esc(back.label)}</span></button>` : '<span class="menu-seal" aria-hidden="true">設</span>'}
      <div class="menu-titles"><h2 class="menu-title" id="settings-title">Réglages</h2></div>
      <button type="button" class="sheet-close menu-x" data-act="close" aria-label="Fermer">${X_ICON}</button>
    </div>
    <div class="set-body">
      <h3 class="menu-sec">Son et effets</h3>
      ${switchRow('sound', 'Son', !d.muted)}
      ${switchRow('music', 'Musique', !!d.music)}
      ${seg('effects', 'Effets', [['full', 'Complets'], ['sober', 'Sobres']], d.effects)}
      <p class="set-note">Sobres : ni secousses ni vols de pièces, moins de particules.</p>

      <h3 class="menu-sec">Confort</h3>
      ${seg('text', 'Taille du texte', TEXT_SCALES.map((v, i) => [v, SCALE_LABELS[i]]), d.textScale)}
      ${switchRow('slowAim', 'Ralentir pendant la visée', !!d.slowAim, '(seul)')}
      ${switchRow('leftHanded', 'Bouton de vague à gauche', !!d.leftHanded, '(gaucher)')}

      <h3 class="menu-sec" id="set-progress">Ma progression</h3>
      <div class="code-box" role="group" aria-label="Code de progression">
        <output class="code-val" aria-label="Code : ${[...code].join(' ')}">${codeHTML(code)}</output>
      </div>
      <div class="code-actions">
        <button type="button" class="btn secondary code-copy" data-act="copy">Copier</button>
        ${canShare ? '<button type="button" class="btn secondary code-share" data-act="share">Partager</button>' : ''}
      </div>
      <p class="set-note">Ce code garde vos étoiles. Saisi dans une autre installation du jeu, il ajoute vos records sans jamais en baisser un.</p>
      <button type="button" class="btn quiet code-import-open" data-act="import-open">Importer un code</button>
      <form class="code-import hidden">
        <input class="code-input" maxlength="20" placeholder="JDE1-·····-·····" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" inputmode="text" enterkeyhint="done" aria-label="Code de progression à importer" />
        <button type="submit" class="btn secondary code-import-ok">Importer</button>
      </form>
      <p class="code-msg" role="status" aria-live="polite"></p>

      <div class="blur-help" id="set-screen">
        <h3 class="blur-title">Haut de l’écran flou ?</h3>
        <p>Si le haut du jeu est flou sur l’app ajoutée à l’écran d’accueil, réinstallez-la (2 minutes) :</p>
        <ol>
          <li>Copiez le code ci-dessus</li>
          <li>Supprimez l’icône du jeu</li>
          <li>Dans Safari : Partager ▸ Sur l’écran d’accueil</li>
          <li>Ouvrez le jeu, puis Réglages ▸ Importer un code</li>
        </ol>
        <a class="blur-link" href="diag.html">Diagnostic de l’écran <span aria-hidden="true">›</span></a>
      </div>

      <h3 class="menu-sec">À propos</h3>
      <p class="set-about">Jardin des Esprits · v4 · ${offlineReady() ? 'version hors ligne prête' : 'version en ligne'}</p>
    </div>`;
  // hors partie : feuille modale (voile) ; depuis la pause, sans voile comme les feuilles de la partie
  const card = deps.showModal(html, [], { sheet: 'large', veil: !back, grabber: true, cls: 'menu-sheet settings-sheet', onClose });
  if (!card) return null;
  const q = (s) => card.querySelector(s);
  const msg = q('.code-msg');
  const say = (text, bad = false) => {
    msg.textContent = text;
    msg.classList.toggle('bad', bad);
  };

  // (la carte de la fenêtre est partagée : un gestionnaire `onclick`, remis à zéro par showModal)
  card.onclick = async (e) => {
    const t = e.target.closest('button, a');
    if (!t || !card.contains(t)) return;
    // interrupteurs : toute la ligne est la cible
    if (t.classList.contains('set-switch')) {
      const on = t.getAttribute('aria-checked') !== 'true';
      t.setAttribute('aria-checked', String(on));
      t.querySelector('.switch')?.classList.toggle('on', on);
      const k = t.dataset.key;
      if (k === 'sound') deps.setMuted?.(!on);
      else if (k === 'music') deps.setMusic?.(on);
      else save.set(k, on);
      deps.sound?.('select');
      return;
    }
    const segBox = t.closest('.seg');
    if (segBox && t.dataset.v != null) {
      for (const b of segBox.querySelectorAll('button')) {
        const on = b === t;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      }
      if (segBox.dataset.seg === 'effects') {
        save.set('effects', t.dataset.v);
        deps.onEffects?.(t.dataset.v);
      } else if (segBox.dataset.seg === 'text') {
        const v = Number(t.dataset.v);
        save.set('textScale', v);
        deps.onTextScale?.(v);
      }
      deps.sound?.('select');
      return;
    }
    const act = t.dataset.act;
    if (act === 'close') deps.close?.();
    else if (act === 'back') {
      deps.close?.({ silent: true });
      back?.run?.();
    } else if (act === 'copy') {
      let ok = false;
      try {
        await navigator.clipboard.writeText(save.exportCode());
        ok = true;
      } catch {}
      t.textContent = ok ? 'Copié ✓' : 'Recopiez-le';
      t.classList.toggle('done', ok);
      say(ok ? 'Code copié : collez-le dans la nouvelle installation.' : 'Copie impossible : recopiez les 10 caractères à la main.', !ok);
      setTimeout(() => {
        t.textContent = 'Copier';
        t.classList.remove('done');
      }, 2200);
    } else if (act === 'share') {
      try {
        await navigator.share({ title: 'Jardin des Esprits', text: `Mon code de progression Jardin des Esprits : ${save.exportCode()}` });
      } catch {}
    } else if (act === 'import-open') {
      t.classList.add('hidden');
      const form = q('.code-import');
      form.classList.remove('hidden');
      form.querySelector('input').focus();
    }
  };

  q('.code-import').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = q('.code-input');
    const r = save.importCode(input.value);
    if (!r.ok) {
      say(r.error, true);
      deps.sound?.('reject');
      return;
    }
    say(`Progression importée : ${r.stars} ★${r.gained > 0 ? ` (+${r.gained})` : ''}`);
    input.value = '';
    // le code affiché suit la sauvegarde fusionnée
    const c = save.exportCode();
    const out = q('.code-val');
    out.innerHTML = codeHTML(c);
    out.setAttribute('aria-label', `Code : ${[...c].join(' ')}`);
    deps.sound?.('combo');
    deps.onImport?.(r);
  });

  if (section) {
    const target = section === 'screen' ? q('#set-screen') : q('#set-progress');
    // la feuille vient de s'ouvrir : on défile une fois la mise en page faite
    requestAnimationFrame(() => target?.scrollIntoView({ block: 'start' }));
  }
  deps.sound?.('select');
  return card;
}
