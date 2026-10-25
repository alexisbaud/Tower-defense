// État pressé commun et confirmation en deux temps (docs/UI-UX.md §5.6).
//
// installPress(root) : un écouteur pointerdown en capture pose .is-pressed sur le
// contrôle touché (bouton, carte de lanterne, onglet, puce, [data-press]) et la retire
// au relâchement, à l'annulation ou quand le doigt sort du contrôle. La réponse est
// immédiate (< 100 ms), sans dépendre de :active, peu fiable sur iOS.
//
// armConfirm(el, { label, ms, run }) : premier appel → le contrôle passe en vermillon,
// « Confirmer… », un filet or se vide pendant `ms` ; second appel avant la fin → `run`.
// Sinon, retour à l'état initial. Emplois : Vendre, Recommencer, Quitter, Rembobiner…

const SEL = 'button, .tool, .ptab, .wchip, [data-press]';
export const CONFIRM_MS = 2600;

let installed = null;

export function installPress(root = document) {
  if (installed === root) return;
  installed = root;
  let cur = null;
  let pid = null;
  const clear = () => {
    if (!cur) return;
    cur.classList.remove('is-pressed');
    cur = null;
    pid = null;
  };
  root.addEventListener(
    'pointerdown',
    (e) => {
      clear();
      const el = e.target.closest?.(SEL);
      if (!el || el.disabled || el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true') return;
      cur = el;
      pid = e.pointerId;
      el.classList.add('is-pressed');
    },
    true,
  );
  const up = (e) => {
    if (pid == null || e.pointerId === pid) clear();
  };
  root.addEventListener('pointerup', up, true);
  root.addEventListener('pointercancel', up, true);
  // doigt sorti du contrôle (sans capture du pointeur) : plus pressé
  root.addEventListener(
    'pointerout',
    (e) => {
      if (!cur || e.pointerId !== pid) return;
      const to = e.relatedTarget;
      if (!to || !cur.contains(to)) {
        // un contrôle qui capture le pointeur (palette, jauge) garde son état
        if (cur.hasPointerCapture?.(pid)) return;
        clear();
      }
    },
    true,
  );
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', clear);
}

const ARMED = new WeakMap();

// Renvoie vrai si l'action a été exécutée (second toucher), faux si le contrôle vient d'être armé.
export function armConfirm(el, { label = 'Confirmer…', ms = CONFIRM_MS, run, onDisarm } = {}) {
  if (!el) return false;
  const st = ARMED.get(el);
  if (st) {
    disarm(el);
    run?.(el);
    return true;
  }
  const s = { html: el.innerHTML, aria: el.getAttribute('aria-label'), onDisarm };
  ARMED.set(el, s);
  el.classList.add('armed');
  el.style.setProperty('--arm-ms', `${ms}ms`);
  el.innerHTML = `<span class="arm-label">${label}</span><i class="arm-ring" aria-hidden="true"></i>`;
  el.setAttribute('aria-label', `${label.replace(/…$/, '')} : toucher encore pour valider`);
  s.timer = setTimeout(() => disarm(el), ms);
  return false;
}

export function isArmed(el) {
  return !!el && ARMED.has(el);
}

// Retour à l'état initial (délai écoulé, ou contrôle remplacé).
export function disarm(el) {
  const s = el && ARMED.get(el);
  if (!s) return;
  ARMED.delete(el);
  clearTimeout(s.timer);
  el.classList.remove('armed');
  el.innerHTML = s.html;
  if (s.aria == null) el.removeAttribute('aria-label');
  else el.setAttribute('aria-label', s.aria);
  s.onDisarm?.(el);
}
