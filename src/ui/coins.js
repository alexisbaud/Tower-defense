// Vols de pièces (docs/UI-UX.md §7.2) : l'or gagné vole de sa source (bouton de vague,
// bloc « Vague », lanterne vendue) jusqu'au sceau 金 du HUD, en arc (point de contrôle
// 40 px au-dessus), 480 ms, 45 ms d'écart entre deux pièces ; le compteur monte à chaque
// arrivée (onArrive). Mouvement réduit ou « Effets sobres » : pas de vol, les arrivées
// sont immédiates (le compteur fait seulement un pop).

export function soberFx() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('fx-sober');
}

const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/**
 * @param {object} o  root (conteneur positionné), from (DOMRect | {x,y}), to (DOMRect),
 *                    n (pièces), onArrive(i, last)
 */
export function flyCoins({ root, from, to, n = 3, onArrive } = {}) {
  n = Math.max(1, Math.min(6, Math.round(n)));
  if (!root || !from || !to || soberFx() || typeof Element.prototype.animate !== 'function') {
    for (let i = 0; i < n; i++) onArrive?.(i, i === n - 1);
    return;
  }
  const base = root.getBoundingClientRect();
  const a = from.width != null ? center(from) : from;
  const b = center(to);
  const ax = a.x - base.left;
  const ay = a.y - base.top;
  const bx = b.x - base.left;
  const by = b.y - base.top;
  const cx = (ax + bx) / 2;
  const cy = Math.min(ay, by) - 40;
  const frames = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    const x = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx;
    const y = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy + t * t * by;
    frames.push({ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(1 - 0.25 * t).toFixed(2)})`, opacity: k === 8 ? 0.6 : 1 });
  }
  for (let i = 0; i < n; i++) {
    const c = document.createElement('i');
    c.className = 'coin-fly';
    c.setAttribute('aria-hidden', 'true');
    c.style.transform = frames[0].transform;
    root.appendChild(c);
    const anim = c.animate(frames, { duration: 480, delay: i * 45, easing: 'cubic-bezier(0.3, 0, 0.8, 0.15)', fill: 'both' });
    anim.onfinish = () => {
      c.remove();
      onArrive?.(i, i === n - 1);
    };
    anim.oncancel = () => c.remove();
  }
}
