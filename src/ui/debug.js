// Panneau de débogage caché : cinq touchers rapides sur le titre de l'écran
// d'accueil l'ouvrent (invisible autrement). Une fois révélé, il reste
// accessible depuis le menu de pause jusqu'au rechargement de la page.
//   Or infini · Vitesse ×4 · Tous les niveaux · Aller à la vague N · Jauge pleine

const TAPS = 5;
const TAP_WINDOW = 1800; // ms pour les cinq touchers

export class DebugPanel {
  /**
   * @param {object} h  open() → ouvre la modale et rend sa carte (.modal-card), close(),
   *                    game() (partie en cours ou null), save, onSpeed(fast), onUnlock(),
   *                    onBack(jumped) (retour au menu de pause, ou reprise après un saut de vague)
   */
  constructor(h) {
    this.h = h;
    this.enabled = false;
    this.infiniteGold = false;
    this.fast = false;
    this.wave = 1; // vague visée (ou vague de départ hors partie)
    this.startWave = 0; // hors partie : vague de départ de la prochaine partie (0 = non)
    this.taps = [];
  }

  // Toucher sur le titre : au cinquième toucher rapide, le panneau s'ouvre.
  tap() {
    const now = performance.now();
    this.taps = this.taps.filter((t) => now - t < TAP_WINDOW);
    this.taps.push(now);
    if (this.taps.length >= TAPS) {
      this.taps = [];
      this.enabled = true;
      this.open();
      return true;
    }
    return false;
  }

  // Chaque frame : or infini (joueur local).
  tick(game) {
    if (!this.enabled || !game || !this.infiniteGold) return;
    if (game.gold < 99999) game.gold = 99999;
  }

  // Nouvelle partie : vague de départ choisie hors partie.
  onStart(game) {
    if (!this.enabled || !game) return;
    if (this.startWave > 1) this.jump(game, this.startWave);
  }

  // Saute à la vague n (1 = première) : enchaîne les appels de vague ; les yokai
  // et apparitions des vagues sautées sont effacés (leurs récompenses sont versées).
  jump(game, n) {
    const target = Math.max(1, Math.min(game.totalWaves, n)) - 1;
    let guard = 0;
    while (game.waveIndex < target && guard++ < 100) {
      if (!game.startNextWave(game.localPlayer, false)) break;
    }
    for (const s of game.spawners) if (s.wave < target) s.spawned = s.count;
    game.enemies = game.enemies.filter((e) => e.wave >= target);
    return game.waveIndex;
  }

  open() {
    const g = this.h.game();
    const max = g ? g.totalWaves : 15;
    this.wave = Math.max(1, Math.min(max, this.wave));
    const card = this.h.open();
    const onOff = (v) => (v ? 'Oui' : 'Non');
    const unlock = !!this.h.save.data.unlockAll;
    card.className = 'modal-card scroll debug-card';
    card.innerHTML = `
      <div class="pause-head"><span class="modal-kanji">調</span><div><h2>Débogage</h2><p>${g ? `${g.level.name} · vague ${Math.max(0, g.waveIndex + 1)}/${g.totalWaves}` : 'Hors partie'}</p></div></div>
      <div class="dbg-grid">
        <span class="dbg-l">Or infini</span><button class="btn dbg-t${this.infiniteGold ? ' on' : ''}" data-dbg="gold" aria-pressed="${this.infiniteGold}">${onOff(this.infiniteGold)}</button>
        <span class="dbg-l">Vitesse ×4</span><button class="btn dbg-t${this.fast ? ' on' : ''}" data-dbg="fast" aria-pressed="${this.fast}">${onOff(this.fast)}</button>
        <span class="dbg-l">Tous les niveaux</span><button class="btn dbg-t${unlock ? ' on' : ''}" data-dbg="unlock" aria-pressed="${unlock}">${onOff(unlock)}</button>
        <span class="dbg-l">${g ? 'Aller à la vague' : 'Vague de départ'}</span>
        <span class="dbg-step"><button class="btn" data-dbg="minus" aria-label="Vague précédente">−</button><b data-dbg-wave>${this.wave}</b><button class="btn" data-dbg="plus" aria-label="Vague suivante">+</button></span>
      </div>
      <div class="actions dbg-actions">
        <button class="btn primary" data-dbg="go">${g ? `Aller à la vague ${this.wave}` : this.startWave > 1 ? `Départ : vague ${this.startWave}` : 'Départ : vague 1'}</button>
        ${g && g.rewindEnabled ? '<button class="btn" data-dbg="charge">Remplir la jauge</button>' : ''}
        <button class="btn dark" data-dbg="close">Fermer</button>
      </div>`;
    card.onclick = (e) => {
      const b = e.target.closest('[data-dbg]');
      if (!b) return;
      const act = b.dataset.dbg;
      const game = this.h.game();
      if (act === 'gold') this.infiniteGold = !this.infiniteGold;
      else if (act === 'fast') {
        this.fast = !this.fast;
        this.h.onSpeed?.(this.fast);
      } else if (act === 'unlock') {
        this.h.save.set('unlockAll', !this.h.save.data.unlockAll);
        this.h.onUnlock?.();
      } else if (act === 'minus') this.wave = Math.max(1, this.wave - 1);
      else if (act === 'plus') this.wave = Math.min(game ? game.totalWaves : 15, this.wave + 1);
      else if (act === 'go') {
        if (game) {
          this.jump(game, this.wave);
          this.h.close();
          this.h.onBack?.(true);
          return;
        }
        this.startWave = this.wave;
      } else if (act === 'charge' && game) {
        game.rewindCharge = game.rules.rewindCost ?? 100;
      } else if (act === 'close') {
        this.h.close();
        this.h.onBack?.(false);
        return;
      }
      this.open();
    };
  }
}
