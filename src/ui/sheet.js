// Mécanique commune des feuilles du bas (docs/UI-UX.md §6.9), utilisée par les fiches
// de la partie (#info) et par showModal (pause, combos, résultats, feuilles des menus).
//
//   Hauteurs : « moyenne » = hauteur du contenu, plafonnée à 56 % de la page (CSS) ;
//              « grande » = jusqu'à 8 px sous le HUD en partie, 56 px sous la barre
//              d'état hors partie (classe .sheet-large, CSS).
//   Glisser  : seules la poignée et l'en-tête lancent le glisser (le corps défile
//              normalement). Vers le bas, la feuille suit le doigt 1:1 ; vers le haut,
//              elle grandit jusqu'à la grande hauteur, puis résiste (×0,3).
//              Relâchée : fermeture si déplacement > 25 % de la hauteur ou vitesse
//              > 0,5 px/ms vers le bas ; grande si tirée de > 60 px ou > 0,5 px/ms vers
//              le haut ; sinon retour en place (200 ms, ressort). Le ✕ reste.
//   Mouvement réduit : pas de glissé animé, la feuille se ferme ou revient d'un coup.

const HANDLE = '.sheet-grabber, .sheet-head, .pause-head, [data-sheet-handle]';
const START = 6; // px avant de prendre la main sur le geste (un toucher reste un toucher)

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('fx-sober');

export function attachSheet(el, h = {}) {
  let drag = null;
  let suppressClick = 0;

  const largeHeight = () => {
    // hauteur qu'aurait la feuille en grande taille : du haut prévu au bas du conteneur
    const parent = el.offsetParent || el.parentElement;
    if (!parent) return el.offsetHeight;
    const pr = parent.getBoundingClientRect();
    const top = h.largeTop ? h.largeTop() : pr.top + 56;
    return Math.max(el.offsetHeight, pr.bottom - top);
  };

  const onDown = (e) => {
    if (drag || (e.button != null && e.button > 0)) return;
    if (h.enabled && !h.enabled()) return;
    const zone = e.target.closest?.(HANDLE);
    if (!zone || !el.contains(zone)) return;
    drag = { id: e.pointerId, y0: e.clientY, x0: e.clientX, h0: el.offsetHeight, active: false, samples: [{ y: e.clientY, t: performance.now() }], large: el.classList.contains('sheet-large') };
  };

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    if (!drag.active) {
      if (Math.abs(dy) < START || Math.abs(dy) < Math.abs(e.clientX - drag.x0)) {
        if (Math.hypot(dy, e.clientX - drag.x0) > 14) drag = null; // geste horizontal : pas pour nous
        return;
      }
      drag.active = true;
      drag.maxH = largeHeight();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      el.style.transition = 'none';
      el.classList.add('sheet-dragging');
    }
    const now = performance.now();
    drag.samples.push({ y: e.clientY, t: now });
    if (drag.samples.length > 5) drag.samples.shift();
    if (dy >= 0) {
      el.style.height = '';
      el.style.transform = `translateY(${dy}px)`;
    } else {
      // vers le haut : la feuille grandit (jusqu'à la grande hauteur), puis résiste
      const room = h.canGrow && !h.canGrow() ? 0 : Math.max(0, drag.maxH - drag.h0);
      const up = -dy;
      const grow = up <= room ? up : room + (up - room) * 0.3;
      el.style.transform = '';
      el.style.maxHeight = 'none';
      el.style.height = `${Math.round(drag.h0 + grow)}px`;
    }
    e.preventDefault?.();
  };

  const settle = (fn) => {
    const ms = reduced() ? 0 : 200;
    el.style.transition = ms ? `transform ${ms}ms var(--e-spring), height ${ms}ms var(--e-spring)` : 'none';
    fn();
    clearTimeout(el._sheetT);
    el._sheetT = setTimeout(() => {
      el.style.transition = '';
      el.classList.remove('sheet-dragging');
    }, ms + 20);
  };

  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.active) return;
    suppressClick = performance.now() + 350;
    const dy = e.clientY - d.y0;
    const s = d.samples;
    const a = s[0];
    const b = s[s.length - 1];
    const v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0; // px/ms, positif vers le bas
    if (e.type === 'pointercancel') {
      settle(() => reset());
      return;
    }
    if (dy > d.h0 * 0.25 || (v > 0.5 && dy > 0)) {
      close(true);
      return;
    }
    if ((-dy > 60 || v < -0.5) && !(h.canGrow && !h.canGrow())) {
      settle(() => {
        el.style.transform = '';
        el.style.height = `${Math.round(d.maxH)}px`;
      });
      setTimeout(() => {
        el.classList.add('sheet-large');
        el.style.height = '';
        el.style.maxHeight = '';
        h.onSize?.('large');
      }, reduced() ? 0 : 210);
      return;
    }
    settle(() => reset());
  };

  const reset = () => {
    el.style.transform = '';
    el.style.height = '';
    el.style.maxHeight = '';
  };

  // Fermeture glissée vers le bas (animée), puis le propriétaire masque la feuille.
  const close = (dragged = false) => {
    const ms = reduced() ? 0 : 200;
    el.style.transition = ms ? `transform ${ms}ms var(--e-in)` : 'none';
    el.style.transform = `translateY(${el.offsetHeight + 40}px)`;
    clearTimeout(el._sheetT);
    el._sheetT = setTimeout(() => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.height = '';
      el.style.maxHeight = '';
      el.classList.remove('sheet-dragging', 'sheet-large');
      h.onClose?.(dragged);
    }, ms + 10);
  };

  const onClick = (e) => {
    if (performance.now() < suppressClick) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('click', onClick, true);

  return {
    // nouvelle ouverture : hauteur moyenne, sans transformation restante
    reset() {
      drag = null;
      clearTimeout(el._sheetT);
      el.style.transition = '';
      reset();
      el.classList.remove('sheet-dragging', 'sheet-large');
    },
    grow() {
      el.classList.add('sheet-large');
      h.onSize?.('large');
    },
    close,
    get dragging() {
      return !!drag?.active;
    },
  };
}
