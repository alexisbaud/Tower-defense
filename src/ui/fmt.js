// Chiffres en cases fixes (docs/UI-UX.md §5.3). Ni Zen Kaku Gothic New ni Shippori
// Mincho n'ont de chiffres tabulaires : `font-variant-numeric: tabular-nums` ne change
// rien (« 1111 » = 32,7 px, « 0000 » = 40,2 px en Zen 700 20 px). Chaque chiffre est donc
// posé dans une case `<i class="dg">` de 0,52 em (styles.css) : un compteur ne glisse
// plus quand sa valeur change. Le texte lu (textContent, lecteurs d'écran) reste « 450 ».

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Une suite de chiffres forme un seul bloc `.dgr` : dans un conteneur flex à `gap`
// (coût d'une carte, pastille), les cases ne s'écartent pas les unes des autres.
export function digitsHTML(n) {
  return String(n ?? '').replace(/[&<>"']|\d+/g, (c) => (c in ESC ? ESC[c] : `<span class="dgr">${c.replace(/\d/g, (d) => `<i class="dg">${d}</i>`)}</span>`));
}

// N'écrit le DOM que si la valeur change (appelé à chaque image).
export function setDigits(el, n) {
  if (!el) return;
  const s = String(n ?? '');
  if (el.dataset.v === s) return;
  el.dataset.v = s;
  el.innerHTML = digitsHTML(s);
}
