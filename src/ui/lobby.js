// Salon de l'écran d'accueil : code à partager, joueurs (1 à 4), choix de l'élément,
// rejoindre un autre salon par son code. Le salon est créé automatiquement à
// l'ouverture du jeu ; « Jouer » lance seul ou avec les joueurs présents.

import { normalizeCode, MAX_PLAYERS } from '../net/lobby.js';

const GLYPH = { triangle: '▲', drop: '●', diamond: '◆', square: '■' };
const ERRORS = {
  full: 'Ce salon est complet (4 joueurs).',
  inGame: 'Une partie est déjà en cours dans ce salon.',
  version: 'Ce salon utilise une autre version du jeu : rechargez la page.',
  'salon introuvable': 'Salon introuvable : vérifiez le code.',
  'code invalide': 'Le code fait 4 lettres.',
};

const PROFILE_KEY = 'jardin-esprits.profil';

export function loadProfile() {
  let p = null;
  try {
    p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
  } catch {}
  if (!p || typeof p.id !== 'string') p = { id: `p${Math.random().toString(36).slice(2, 10)}`, name: `Esprit ${Math.floor(100 + Math.random() * 900)}`, element: null };
  saveProfile(p);
  return p;
}

export function saveProfile(p) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {}
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export class LobbyUI {
  /**
   * @param {HTMLElement} root  conteneur (vidé et rempli par le salon)
   * @param {NetSession} session
   * @param {object} opts { elements (data/elements.js), profile, toast(msg), sound(name) }
   */
  constructor(root, session, opts) {
    this.root = root;
    this.session = session;
    this.elements = opts.elements;
    this.profile = opts.profile;
    this.toast = opts.toast || (() => {});
    this.sound = opts.sound || (() => {});
    this.joining = false;
    this.joinOpen = false;
    this.error = '';
    this.build();
    session.on('status', () => this.render());
    session.on('lobby', () => this.render());
    this.render();
  }

  build() {
    const r = this.root;
    r.innerHTML = '';
    r.classList.add('lobby');
    this.head = el('div', 'lobby-head');
    this.status = el('span', 'lobby-status');
    this.codeBox = el('div', 'lobby-code');
    this.codeBox.setAttribute('aria-label', 'Code du salon');
    const share = el('div', 'lobby-share');
    this.btnInvite = el('button', 'btn small primary', 'Inviter');
    this.btnInvite.addEventListener('click', () => this.invite());
    this.btnRetry = el('button', 'btn small', 'Réessayer');
    this.btnRetry.addEventListener('click', () => this.retry());
    share.append(this.btnInvite, this.btnRetry);
    const title = el('div', 'lobby-title');
    title.append(el('span', 'lobby-label', 'Salon'), this.status);
    this.head.append(title, this.codeBox, share);

    this.list = el('ul', 'lobby-players');
    this.list.setAttribute('aria-label', 'Joueurs du salon');

    this.pickTitle = el('p', 'lobby-sub', 'Votre élément');
    this.picker = el('div', 'lobby-elements');
    this.picker.setAttribute('role', 'radiogroup');
    this.pickButtons = {};
    for (const [id, info] of Object.entries(this.elements)) {
      const b = el('button', `lobby-el el-${id}`);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.style.setProperty('--el', info.color);
      b.dataset.el = id;
      const glyph = el('span', 'lobby-el-glyph', GLYPH[info.shape] ?? '●');
      glyph.setAttribute('aria-hidden', 'true');
      b.append(glyph, el('span', 'lobby-el-kanji', info.kanji), el('span', 'lobby-el-name', info.name), el('small', 'lobby-el-style', info.style));
      b.addEventListener('click', () => this.pick(id));
      this.picker.append(b);
      this.pickButtons[id] = b;
    }
    this.note = el('p', 'lobby-note');

    this.joinRow = el('div', 'lobby-join');
    this.btnJoin = el('button', 'btn small', 'Rejoindre un salon');
    this.btnJoin.addEventListener('click', () => this.openJoin());
    this.joinForm = el('form', 'lobby-join-form hidden');
    this.joinInput = el('input', 'lobby-join-input');
    Object.assign(this.joinInput, { maxLength: 4, placeholder: 'CODE', autocomplete: 'off', spellcheck: false, enterKeyHint: 'go' });
    this.joinInput.setAttribute('autocapitalize', 'characters');
    this.joinInput.setAttribute('aria-label', 'Code du salon à rejoindre');
    this.joinInput.addEventListener('input', () => {
      this.joinInput.value = this.joinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    });
    const ok = el('button', 'btn small primary', 'Rejoindre');
    ok.type = 'submit';
    const cancel = el('button', 'btn small', 'Annuler');
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.closeJoin());
    this.joinForm.append(this.joinInput, ok, cancel);
    this.joinForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      this.join(this.joinInput.value);
    });
    this.btnLeave = el('button', 'btn small', 'Quitter ce salon');
    this.btnLeave.addEventListener('click', () => this.leave());
    this.errorBox = el('p', 'lobby-error');
    this.errorBox.setAttribute('role', 'alert');
    this.joinRow.append(this.btnJoin, this.joinForm, this.btnLeave);

    r.append(this.head, this.list, this.pickTitle, this.picker, this.note, this.joinRow, this.errorBox);
  }

  get players() {
    return this.session.lobby?.players || [{ id: this.profile.id, name: this.profile.name, element: this.profile.element, online: true }];
  }

  render() {
    const s = this.session;
    const guest = s.role === 'guest';
    const state = s.state;
    this.status.className = `lobby-status ${state}`;
    this.status.textContent = { online: 'en ligne', connecting: 'connexion…', offline: 'hors ligne' }[state];
    // code en sceaux (lettre par lettre : lisible à voix haute)
    this.codeBox.innerHTML = '';
    const code = s.code || '····';
    for (const ch of code) this.codeBox.append(el('span', 'lobby-code-ch', ch));
    this.codeBox.classList.toggle('dim', state !== 'online');
    this.btnInvite.classList.toggle('hidden', state !== 'online' || guest);
    this.btnRetry.classList.toggle('hidden', state !== 'offline' || this.joining);

    // joueurs
    this.list.innerHTML = '';
    const players = this.players;
    for (let k = 0; k < MAX_PLAYERS; k++) {
      const p = players[k];
      const li = el('li', `lobby-player${p ? '' : ' empty'}`);
      if (!p) {
        li.append(el('span', 'lobby-seal empty', '空'), el('span', 'lobby-pname', state === 'online' && !guest ? 'Place libre' : '—'));
        this.list.append(li);
        continue;
      }
      const info = p.element ? this.elements[p.element] : null;
      const seal = el('span', 'lobby-seal', info ? GLYPH[info.shape] : '？');
      if (info) seal.style.setProperty('--el', info.color);
      seal.setAttribute('aria-label', info ? info.name : 'aucun élément');
      const name = el('span', 'lobby-pname', p.name);
      const tags = el('span', 'lobby-tags');
      if (k === 0) tags.append(el('i', 'lobby-tag host', 'hôte'));
      if (p.id === this.profile.id) tags.append(el('i', 'lobby-tag you', 'vous'));
      if (p.online === false) tags.append(el('i', 'lobby-tag off', 'absent'));
      li.append(seal, name, tags);
      if (p.id === this.profile.id) {
        li.classList.add('me');
        name.setAttribute('role', 'button');
        name.tabIndex = 0;
        name.title = 'Changer de nom';
        name.addEventListener('click', () => this.rename());
      }
      this.list.append(li);
    }

    // éléments
    const mine = players.find((p) => p.id === this.profile.id);
    for (const [id, b] of Object.entries(this.pickButtons)) {
      const taker = players.find((p) => p.element === id && p.id !== this.profile.id);
      const sel = mine?.element === id;
      b.classList.toggle('selected', sel);
      b.setAttribute('aria-checked', sel ? 'true' : 'false');
      b.disabled = !!taker || s.inGame;
      b.title = taker ? `Choisi par ${taker.name}` : '';
      b.querySelector('.lobby-el-style').textContent = taker ? taker.name : this.elements[id].style;
    }
    const n = players.length;
    let note;
    if (n <= 1) note = 'Seul, vous jouez les quatre éléments. Partagez le code pour jouer à plusieurs (jusqu’à 4).';
    else {
      const free = Object.keys(this.elements).filter((id) => !players.some((p) => p.element === id));
      note = `Chacun bâtit les lanternes de son élément${free.length ? ` ; ${free.map((id) => this.elements[id].name).join(', ')} : à tous` : ''}. Or personnel, vies communes.`;
      if (guest) note += ' L’hôte choisit le niveau.';
    }
    this.note.textContent = note;

    // rejoindre / quitter
    this.btnJoin.classList.toggle('hidden', this.joinOpen || guest);
    this.joinForm.classList.toggle('hidden', !this.joinOpen || guest);
    this.btnLeave.classList.toggle('hidden', !guest);
    this.errorBox.textContent = this.joining ? 'Recherche du salon…' : this.error;
    this.errorBox.classList.toggle('busy', this.joining);
  }

  pick(id) {
    const mine = this.players.find((p) => p.id === this.profile.id);
    const next = mine?.element === id ? null : id;
    this.profile.element = next;
    saveProfile(this.profile);
    if (this.session.lobby) this.session.pickElement(next);
    this.sound('select');
    this.render();
  }

  rename() {
    const name = window.prompt('Votre nom (16 lettres au plus)', this.profile.name);
    if (name == null) return;
    this.profile.name = name.trim().slice(0, 16) || this.profile.name;
    saveProfile(this.profile);
    this.session.setName(this.profile.name);
    this.render();
  }

  async invite() {
    const code = this.session.code;
    if (!code) return;
    const url = `${location.origin}${location.pathname}?salon=${code}`;
    const text = `Rejoins mon salon ${code} dans Jardin des Esprits`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Jardin des Esprits', text, url });
        return;
      }
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(`${text} : ${url}`);
      this.toast('Lien du salon copié');
    } catch {
      this.toast(`Code du salon : ${code}`);
    }
  }

  openJoin() {
    this.joinOpen = true;
    this.error = '';
    this.render();
    this.joinInput.value = '';
    this.joinInput.focus();
  }

  closeJoin() {
    this.joinOpen = false;
    this.error = '';
    this.render();
  }

  async join(text) {
    const code = normalizeCode(text);
    if (!code) {
      this.error = ERRORS['code invalide'];
      this.render();
      return false;
    }
    if (code === this.session.code) {
      this.error = 'C’est le code de votre propre salon.';
      this.render();
      return false;
    }
    this.joining = true;
    this.error = '';
    this.render();
    try {
      await this.session.join(code);
      this.joinOpen = false;
      if (this.profile.element) this.session.pickElement(this.profile.element);
      this.sound('combo');
      this.toast('Vous avez rejoint le salon');
      return true;
    } catch (e) {
      this.error = ERRORS[e.message] || `Connexion impossible (${e.message}).`;
      // on retrouve son propre salon
      this.session.host({ element: this.profile.element });
      return false;
    } finally {
      this.joining = false;
      this.render();
    }
  }

  leave() {
    this.session.host({ element: this.profile.element });
    this.toast('Vous avez quitté le salon');
  }

  retry() {
    this.session.host({ element: this.profile.element });
  }
}
