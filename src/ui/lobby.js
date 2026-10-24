// Salon de l'écran d'accueil : code à partager, joueurs (1 à 4), choix de l'élément,
// rejoindre un autre salon par son code. Le salon est créé automatiquement à
// l'ouverture du jeu ; « Jouer » lance seul ou avec les joueurs présents.
//
// Seul, le choix de l'élément se replie (une ligne « Votre élément : Feu ▾ ») —
// seul, on joue de toute façon les quatre éléments — et laisse voir la scène ;
// il se déplie dès qu'un ami arrive.

import { normalizeCode, MAX_PLAYERS } from '../net/lobby.js';

const GLYPH = { triangle: '▲', drop: '●', diamond: '◆', square: '■' };
const ERRORS = {
  full: 'Ce salon est complet (4 joueurs).',
  inGame: 'Une partie est déjà en cours dans ce salon.',
  version: 'Ce salon utilise une autre version du jeu : rechargez la page.',
  'salon introuvable': 'Salon introuvable : vérifiez le code.',
  'code invalide': 'Le code fait 4 lettres.',
  'hors ligne': 'Pas de réseau : le salon n’est pas joignable.',
  'aucun relais disponible': 'Relais injoignable : réessayez plus tard.',
};

const PROFILE_KEY = 'jardin-esprits.profil';
const TAB_KEY = 'jardin-esprits.onglet'; // sessionStorage : id du joueur dans cet onglet
const ALIVE_KEY = 'jardin-esprits.actif.'; // localStorage : battement de chaque id en service
const BEAT_MS = 2000;

const newId = () => `p${Math.random().toString(36).slice(2, 10)}`;
let primaryId = null; // id enregistré du profil (le premier onglet l'utilise)

function store(kind) {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}
function get(kind, key) {
  try {
    return store(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function put(kind, key, value) {
  try {
    if (value == null) store(kind)?.removeItem(key);
    else store(kind)?.setItem(key, value);
  } catch {}
}

// Profil local : nom et élément préféré (localStorage), id du joueur propre à
// l'onglet (sessionStorage) : un rechargement garde le même id — l'hôte reconnaît
// l'invité et lui renvoie la partie en cours —, un second onglet ouvert en même
// temps en prend un autre (sans quoi l'hôte confondrait les deux joueurs).
export function loadProfile() {
  let p = null;
  try {
    p = JSON.parse(get('local', PROFILE_KEY) || 'null');
  } catch {}
  if (!p || typeof p.id !== 'string') p = { id: newId(), name: `Esprit ${Math.floor(100 + Math.random() * 900)}`, element: null };
  primaryId = p.id;
  let id = get('session', TAB_KEY);
  if (!id) {
    const beat = Number(get('local', ALIVE_KEY + p.id) || 0);
    id = Date.now() - beat < BEAT_MS * 2.5 ? newId() : p.id;
    put('session', TAB_KEY, id);
  }
  const alive = () => put('local', ALIVE_KEY + id, String(Date.now()));
  alive();
  setInterval(alive, BEAT_MS);
  window.addEventListener('pagehide', () => put('local', ALIVE_KEY + id, null));
  const profile = { id, name: String(p.name || 'Esprit').slice(0, 16), element: p.element ?? null };
  saveProfile(profile);
  return profile;
}

export function saveProfile(p) {
  put('local', PROFILE_KEY, JSON.stringify({ id: primaryId || p.id, name: p.name, element: p.element ?? null }));
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Sceau d'un élément (forme + couleur) : lisible sans la couleur.
export function elementGlyph(info) {
  return info ? GLYPH[info.shape] ?? '●' : '？';
}

export class LobbyUI {
  /**
   * @param {HTMLElement} root  conteneur (vidé et rempli par le salon)
   * @param {NetSession} session
   * @param {object} opts { elements (data/elements.js), profile, toast(msg), sound(name),
   *                        host() (recrée son propre salon), inviteUrl(code), onRender() }
   */
  constructor(root, session, opts) {
    this.root = root;
    this.session = session;
    this.elements = opts.elements;
    this.profile = opts.profile;
    this.toast = opts.toast || (() => {});
    this.sound = opts.sound || (() => {});
    this.hostFn = opts.host || (() => session.host({ element: this.profile.element }));
    this.inviteUrl = opts.inviteUrl || ((code) => `${location.origin}${location.pathname}?salon=${code}`);
    this.onRender = opts.onRender || (() => {});
    this.joining = false;
    this.joinOpen = false;
    this.folded = null; // null : automatique (replié tant qu'on est seul)
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
    this.status.setAttribute('role', 'status');
    this.codeBox = el('div', 'lobby-code');
    this.codeBox.setAttribute('role', 'img');
    const share = el('div', 'lobby-share');
    this.btnInvite = el('button', 'btn small primary lobby-invite', 'Inviter');
    this.btnInvite.addEventListener('click', () => this.invite());
    this.btnRetry = el('button', 'btn small lobby-retry', 'Réessayer');
    this.btnRetry.addEventListener('click', () => this.retry());
    share.append(this.btnInvite, this.btnRetry);
    const title = el('div', 'lobby-title');
    title.append(el('span', 'lobby-label', 'Salon'), this.status);
    this.head.append(title, this.codeBox, share);

    this.list = el('ul', 'lobby-players');
    this.list.setAttribute('aria-label', 'Joueurs du salon');

    // « Votre élément » : titre de la section, et bouton qui la replie / déplie
    this.foldBtn = el('button', 'lobby-sub lobby-fold');
    this.foldBtn.type = 'button';
    this.foldBtn.addEventListener('click', () => {
      this.folded = !this.isFolded();
      this.sound('select');
      this.render();
    });
    this.picker = el('div', 'lobby-elements');
    this.picker.id = 'lobby-elements';
    this.foldBtn.setAttribute('aria-controls', this.picker.id);
    this.picker.setAttribute('role', 'radiogroup');
    this.picker.setAttribute('aria-label', 'Votre élément');
    this.pickButtons = {};
    for (const [id, info] of Object.entries(this.elements)) {
      const b = el('button', `lobby-el el-${id}`);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.style.setProperty('--el', info.color);
      b.dataset.el = id;
      const glyph = el('span', 'lobby-el-glyph', elementGlyph(info));
      glyph.setAttribute('aria-hidden', 'true');
      b.append(glyph, el('span', 'lobby-el-kanji', info.kanji), el('span', 'lobby-el-name', info.name), el('small', 'lobby-el-style', info.style));
      b.addEventListener('click', () => this.pick(id));
      this.picker.append(b);
      this.pickButtons[id] = b;
    }
    this.note = el('p', 'lobby-note');

    this.joinRow = el('div', 'lobby-join');
    this.btnJoin = el('button', 'btn small lobby-join-btn', 'Rejoindre un salon');
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
    this.btnLeave = el('button', 'btn small lobby-leave', 'Quitter ce salon');
    this.btnLeave.addEventListener('click', () => this.leave());
    this.errorBox = el('p', 'lobby-error');
    this.errorBox.setAttribute('role', 'alert');
    this.joinRow.append(this.btnJoin, this.joinForm, this.btnLeave);

    r.append(this.head, this.list, this.foldBtn, this.picker, this.note, this.joinRow, this.errorBox);
  }

  get players() {
    return this.session.lobby?.players || [{ id: this.profile.id, name: this.profile.name, element: this.profile.element, online: true }];
  }

  // Replié : choix explicite, sinon tant qu'on est seul.
  isFolded() {
    if (this.folded != null) return this.folded;
    return this.players.length <= 1;
  }

  render() {
    const s = this.session;
    const guest = s.role === 'guest';
    const state = this.joining ? 'connecting' : s.state;
    this.status.className = `lobby-status ${state}`;
    this.status.textContent = { online: 'en ligne', connecting: 'connexion…', offline: 'hors ligne' }[state];
    // code en sceaux (lettre par lettre : lisible à voix haute)
    const code = s.code || '····';
    if (this.codeBox.dataset.code !== code) {
      this.codeBox.dataset.code = code;
      this.codeBox.innerHTML = '';
      for (const ch of code) this.codeBox.append(el('span', 'lobby-code-ch', ch));
    }
    this.codeBox.setAttribute('aria-label', s.code ? `Code du salon : ${[...s.code].join(' ')}` : 'Code du salon : aucun');
    this.codeBox.classList.toggle('dim', state !== 'online');
    this.btnInvite.classList.toggle('hidden', state !== 'online' || guest);
    this.btnRetry.classList.toggle('hidden', state !== 'offline' || this.joining);
    if (s.code) this.btnInvite.dataset.link = this.inviteUrl(s.code);

    // joueurs : quatre places
    this.list.innerHTML = '';
    const players = this.players;
    const hostId = s.lobby?.host ?? players[0]?.id;
    for (let k = 0; k < MAX_PLAYERS; k++) {
      const p = players[k];
      const li = el('li', `lobby-player${p ? '' : ' empty'}`);
      if (!p) {
        li.append(el('span', 'lobby-seal empty', '空'), el('span', 'lobby-pname', state === 'online' && !guest ? 'Place libre' : '—'));
        li.setAttribute('aria-label', 'Place libre');
        this.list.append(li);
        continue;
      }
      const info = p.element ? this.elements[p.element] : null;
      const seal = el('span', 'lobby-seal', elementGlyph(info));
      if (info) seal.style.setProperty('--el', info.color);
      seal.setAttribute('aria-hidden', 'true');
      const name = el('span', 'lobby-pname', p.name);
      const tags = [];
      if (p.id === hostId) tags.push(['host', 'hôte']);
      if (p.id === this.profile.id) tags.push(['you', 'vous']);
      if (p.online === false) tags.push(['off', 'absent']);
      const tagBox = el('span', 'lobby-tags');
      for (const [cls, txt] of tags) tagBox.append(el('i', `lobby-tag ${cls}`, txt));
      li.append(seal, name, tagBox);
      li.classList.toggle('off', p.online === false);
      li.setAttribute('aria-label', `${p.name}${info ? `, ${info.name}` : ', sans élément'}${tags.length ? `, ${tags.map((t) => t[1]).join(', ')}` : ''}`);
      if (p.id === this.profile.id) {
        // sa propre place : toucher pour changer de nom (toute la case : ≥ 44 pt)
        li.classList.add('me');
        li.setAttribute('role', 'button');
        li.tabIndex = 0;
        li.title = 'Changer de nom';
        li.setAttribute('aria-label', `${li.getAttribute('aria-label')}. Toucher pour changer de nom`);
        li.addEventListener('click', () => this.rename());
      }
      this.list.append(li);
    }

    // éléments (repliables)
    const mine = players.find((p) => p.id === this.profile.id);
    // Choix envoyé à l'hôte : accordé, ou pris au même instant par un autre joueur
    // (l'hôte tranche) — on le dit, et le profil garde l'élément réellement obtenu.
    const want = this.pendingPick;
    if (want && mine && guest) {
      const taker = want.el && players.find((p) => p.element === want.el && p.id !== this.profile.id);
      if (mine.element === want.el) this.pendingPick = null;
      else if (taker || Date.now() - want.at > 4000) {
        this.pendingPick = null;
        this.profile.element = mine.element ?? null;
        saveProfile(this.profile);
        if (taker) {
          this.toast(`${this.elements[want.el]?.name ?? 'Cet élément'} : déjà choisi par ${taker.name}`);
          this.sound('reject');
        }
      }
    }
    const folded = this.isFolded();
    this.root.classList.toggle('folded', folded);
    this.foldBtn.setAttribute('aria-expanded', String(!folded));
    const cur = mine?.element ? this.elements[mine.element] : null;
    this.foldBtn.innerHTML = folded
      ? `<span>Votre élément :</span>${cur ? `<span class="lobby-fold-el" style="--el:${cur.color}"><i aria-hidden="true">${elementGlyph(cur)}</i>${cur.name}</span>` : '<span class="lobby-fold-el none">au choix</span>'}<span class="lobby-chev" aria-hidden="true">▾</span>`
      : `<span>Votre élément</span><span class="lobby-chev" aria-hidden="true">▴</span>`;
    for (const [id, b] of Object.entries(this.pickButtons)) {
      const taker = players.find((p) => p.element === id && p.id !== this.profile.id);
      const sel = mine?.element === id;
      b.classList.toggle('selected', sel);
      b.setAttribute('aria-checked', sel ? 'true' : 'false');
      b.disabled = !!taker || s.inGame;
      b.title = taker ? `Choisi par ${taker.name}` : '';
      b.setAttribute('aria-label', `${this.elements[id].name}${taker ? `, choisi par ${taker.name}` : `, ${this.elements[id].style}`}`);
      b.querySelector('.lobby-el-style').textContent = taker ? taker.name : this.elements[id].style;
    }
    const n = players.length;
    let note;
    if (n <= 1) note = 'Seul, vous jouez les quatre éléments. Invitez jusqu’à 3 amis : chacun bâtit son élément.';
    else {
      const free = Object.keys(this.elements).filter((id) => !players.some((p) => p.element === id));
      note = `Chacun bâtit les lanternes de son élément${free.length ? ` ; ${free.map((id) => this.elements[id].name).join(', ')} : à tous` : ''}. Or personnel, vies communes.`;
      if (!guest) note += ' « Jouer » lance la partie pour tous.';
    }
    this.note.textContent = note;

    // rejoindre / quitter
    this.btnJoin.classList.toggle('hidden', this.joinOpen || guest);
    this.joinForm.classList.toggle('hidden', !this.joinOpen || guest);
    this.btnLeave.classList.toggle('hidden', !guest);
    // hors ligne : le jeu seul marche ; « Réessayer » rouvre le salon
    const offlineHint = state === 'offline' && !this.error && !guest ? 'Salon hors ligne : vous pouvez jouer seul. Réessayez pour inviter des amis.' : '';
    this.errorBox.textContent = this.joining ? 'Recherche du salon…' : this.error || offlineHint;
    this.errorBox.classList.toggle('busy', this.joining);
    this.errorBox.classList.toggle('info', !this.joining && !this.error && !!offlineHint);
    this.onRender();
  }

  pick(id) {
    const mine = this.players.find((p) => p.id === this.profile.id);
    const next = mine?.element === id ? null : id;
    this.profile.element = next;
    saveProfile(this.profile);
    // invité : l'hôte confirme (ou refuse : élément pris au même instant), cf. render()
    if (this.session.role === 'guest') this.pendingPick = { el: next, at: Date.now() };
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
    const url = this.inviteUrl(code);
    const text = `Rejoins mon salon ${code} dans Jardin des Esprits`;
    this.sound('select');
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
      this.toast(`Lien du salon ${code} copié`);
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
    if (code === this.session.code && this.session.role === 'host') {
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
      this.toast(`Vous avez rejoint le salon ${code}`);
      return true;
    } catch (e) {
      this.error = ERRORS[e.message] || `Connexion impossible (${e.message}).`;
      // on retrouve son propre salon
      this.hostFn();
      return false;
    } finally {
      this.joining = false;
      this.render();
    }
  }

  leave() {
    this.hostFn();
    this.toast('Vous avez quitté le salon');
  }

  retry() {
    this.error = '';
    this.hostFn();
  }
}
