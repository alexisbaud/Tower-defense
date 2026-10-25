// Salon multijoueur, dans la feuille « Jouer à plusieurs » (ouverte depuis l'accueil) :
// code à partager, joueurs (1 à 4), choix de l'élément, rejoindre un autre salon par
// son code. Le salon est créé automatiquement à l'ouverture du jeu ; « Jouer » (accueil)
// lance seul ou avec les joueurs présents.
//
// À plusieurs, chacun ne pose QUE les lanternes (et objets) de son élément : un
// élément par joueur. Un élément pris par un autre est grisé ; qui n'a rien choisi
// reçoit d'office le premier élément libre (assignElements), affiché « attribué ».
// Seul, on joue de toute façon les quatre éléments : le choix reste visible (il vaut
// pour la prochaine partie à plusieurs).

import { normalizeCode, MAX_PLAYERS } from '../net/lobby.js';
import { assignElements } from '../core/game.js';
import { elementBadge, elementInfo } from './elements.js';
import { armConfirm, isArmed } from './press.js';

const GLYPH = { triangle: '▲', drop: '●', diamond: '◆', square: '■' };
// style de jeu en un mot (la carte d'élément n'a la place que d'un mot : jamais tronqué)
const STYLE_WORD = { fire: 'Offensif', water: 'Contrôle', wind: 'Soutien', earth: 'Défense' };
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

const X_ICON = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>';

export class LobbyUI {
  /**
   * @param {HTMLElement} root  conteneur (vidé et rempli par le salon)
   * @param {NetSession} session
   * @param {object} opts { defs, elements (data/elements.js), profile, toast(msg), sound(name),
   *                        host() (recrée son propre salon), inviteUrl(code), onRender(),
   *                        close() (ferme la feuille) }
   */
  constructor(root, session, opts) {
    this.root = root;
    this.session = session;
    this.defs = opts.defs || { elements: opts.elements, towers: {} };
    this.elements = opts.elements || this.defs.elements;
    this.profile = opts.profile;
    this.toast = opts.toast || (() => {});
    this.sound = opts.sound || (() => {});
    this.hostFn = opts.host || (() => session.host({ element: this.profile.element }));
    this.inviteUrl = opts.inviteUrl || ((code) => `${location.origin}${location.pathname}?salon=${code}`);
    this.onRender = opts.onRender || (() => {});
    this.close = opts.close || (() => {});
    this.joining = false;
    this.renaming = false;
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

    // en-tête de la feuille : sceau, titre, état du salon, fermer
    const head = el('div', 'sheet-head menu-head lobby-head');
    const seal = el('span', 'menu-seal', '人');
    seal.setAttribute('aria-hidden', 'true');
    const titles = el('div', 'menu-titles');
    const h2 = el('h2', 'menu-title', 'Jouer à plusieurs');
    h2.id = 'lobby-title';
    const line = el('p', 'lobby-statusline');
    this.status = el('span', 'lobby-status');
    this.status.setAttribute('role', 'status');
    this.btnRetry = el('button', 'lobby-retry', 'Réessayer');
    this.btnRetry.type = 'button';
    this.btnRetry.addEventListener('click', () => this.retry());
    line.append(this.status, this.btnRetry);
    titles.append(h2, line);
    const x = el('button', 'sheet-close menu-x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Fermer');
    x.innerHTML = X_ICON;
    x.addEventListener('click', () => this.close());
    head.append(seal, titles, x);

    // code du salon et invitation
    this.codeSec = el('section', 'lobby-sec lobby-code-sec');
    this.codeTitle = el('h3', 'menu-sec', 'Votre salon');
    const codeRow = el('div', 'lobby-code-row');
    this.codeBox = el('div', 'lobby-code');
    this.codeBox.setAttribute('role', 'img');
    this.btnInvite = el('button', 'btn primary lobby-invite', 'Inviter');
    this.btnInvite.type = 'button';
    this.btnInvite.addEventListener('click', () => this.invite());
    codeRow.append(this.codeBox, this.btnInvite);
    this.codeHint = el('p', 'lobby-hint');
    this.codeSec.append(this.codeTitle, codeRow, this.codeHint);

    // joueurs
    const playersSec = el('section', 'lobby-sec');
    this.playersTitle = el('h3', 'menu-sec', 'Joueurs');
    this.list = el('ul', 'lobby-players');
    this.list.setAttribute('aria-label', 'Joueurs du salon');
    playersSec.append(this.playersTitle, this.list);

    // élément : toujours visible (un mot par carte, jamais tronqué)
    const elSec = el('section', 'lobby-sec');
    const elTitle = el('h3', 'menu-sec', 'Votre élément');
    elTitle.id = 'lobby-el-title';
    this.picker = el('div', 'lobby-elements');
    this.picker.id = 'lobby-elements';
    this.picker.setAttribute('role', 'radiogroup');
    this.picker.setAttribute('aria-labelledby', elTitle.id);
    this.pickButtons = {};
    for (const [id, info] of Object.entries(this.elements)) {
      const ei = elementInfo(id, this.defs);
      const b = el('button', `lobby-el el-${id}`);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.style.setProperty('--el', info.color);
      b.style.setProperty('--el-ui', ei.ink);
      b.dataset.el = id;
      const badge = el('span', 'lobby-el-badge');
      badge.innerHTML = elementBadge(id, this.defs, { size: 26 });
      badge.setAttribute('aria-hidden', 'true');
      b.append(badge, el('span', 'lobby-el-name', info.name), el('small', 'lobby-el-style', STYLE_WORD[id] || String(info.style || '').split(/\s+/)[0]));
      b.addEventListener('click', () => this.pick(id));
      this.picker.append(b);
      this.pickButtons[id] = b;
    }
    this.note = el('p', 'lobby-note');
    elSec.append(elTitle, this.picker, this.note);

    // rejoindre un autre salon : champ toujours présent (pas de formulaire caché)
    this.joinSec = el('section', 'lobby-sec lobby-join');
    const joinTitle = el('h3', 'menu-sec', 'Rejoindre un autre salon');
    this.joinForm = el('form', 'lobby-join-form');
    this.joinInput = el('input', 'lobby-join-input');
    Object.assign(this.joinInput, { maxLength: 4, placeholder: '····', autocomplete: 'off', spellcheck: false, enterKeyHint: 'go' });
    this.joinInput.setAttribute('autocapitalize', 'characters');
    this.joinInput.setAttribute('autocorrect', 'off');
    this.joinInput.setAttribute('inputmode', 'text');
    this.joinInput.setAttribute('aria-label', 'Code du salon à rejoindre (4 lettres)');
    this.joinInput.addEventListener('input', () => {
      this.joinInput.value = this.joinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      this.btnJoin.disabled = this.joinInput.value.length < 4;
    });
    this.btnJoin = el('button', 'btn secondary lobby-join-ok', 'Rejoindre');
    this.btnJoin.type = 'submit';
    this.btnJoin.disabled = true;
    this.joinForm.append(this.joinInput, this.btnJoin);
    this.joinForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      this.join(this.joinInput.value);
    });
    this.joinSec.append(joinTitle, this.joinForm);

    this.errorBox = el('p', 'lobby-error');
    this.errorBox.setAttribute('role', 'alert');
    // invité : quitter le salon de l'hôte (confirmé) ; pendant une recherche : l'annuler
    this.btnLeave = el('button', 'btn quiet lobby-leave', 'Quitter le salon');
    this.btnLeave.type = 'button';
    this.btnLeave.addEventListener('click', () => {
      if (this.joining) return this.leave();
      armConfirm(this.btnLeave, { label: 'Quitter le salon ?', run: () => this.leave() });
    });

    const body = el('div', 'lobby-body');
    body.append(this.codeSec, playersSec, elSec, this.joinSec, this.errorBox, this.btnLeave);
    r.append(head, body);
  }

  get players() {
    return this.session.lobby?.players || [{ id: this.profile.id, name: this.profile.name, element: this.profile.element, online: true }];
  }

  render() {
    const s = this.session;
    const guest = s.role === 'guest';
    const state = this.joining ? 'connecting' : s.state;
    const players = this.players;
    const n = players.length;
    this.status.className = `lobby-status ${state}`;
    this.status.textContent = state === 'online' ? `En ligne · ${n} joueur${n > 1 ? 's' : ''} sur ${MAX_PLAYERS}` : state === 'connecting' ? 'Connexion…' : 'Hors ligne';
    this.btnRetry.classList.toggle('hidden', state !== 'offline' || this.joining);

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
    if (s.code) this.btnInvite.dataset.link = this.inviteUrl(s.code);
    const hostName = players.find((p) => p.id === (s.lobby?.host ?? players[0]?.id))?.name;
    const de = hostName && /^[aeiouyàâéèêëîïôûüh]/i.test(hostName) ? 'd’' : 'de ';
    this.codeTitle.textContent = guest ? (hostName ? `Salon ${de}${hostName}` : 'Salon rejoint') : 'Votre salon';
    this.codeHint.textContent = guest
      ? 'L’hôte choisit le niveau et lance la partie pour tous.'
      : state === 'online'
        ? 'Vos amis ouvrent le lien, ou saisissent ce code.'
        : state === 'connecting'
          ? 'Ouverture du salon…'
          : 'Salon hors ligne : vous pouvez jouer seul. Réessayez pour inviter des amis.';

    // joueurs : une ligne chacun, puis les places libres en une ligne
    this.playersTitle.textContent = `Joueurs · ${n}/${MAX_PLAYERS}`;
    const hostId = s.lobby?.host ?? players[0]?.id;
    const multi = n > 1;
    const given = multi ? assignElements(players.map((p) => p.element ?? null)).map((l) => l[0]) : []; // (même règle que la partie)
    if (!this.renaming) {
      this.list.innerHTML = '';
      players.forEach((p, k) => {
        const li = el('li', 'lobby-player');
        const auto = multi && !p.element ? given[k] : null;
        const elId = p.element || auto;
        const info = elId ? this.elements[elId] : null;
        const seal = el('span', `lobby-seal${auto ? ' auto' : ''}${info ? '' : ' none'}`);
        if (info) seal.innerHTML = elementBadge(elId, this.defs, { size: 26 });
        else seal.textContent = (p.name || '?').trim().charAt(0).toUpperCase() || '?';
        seal.setAttribute('aria-hidden', 'true');
        const name = el('span', 'lobby-pname', p.name);
        const tags = [];
        if (p.id === this.profile.id) tags.push(['you', 'vous']);
        if (p.id === hostId) tags.push(['host', 'hôte']);
        if (auto) tags.push(['auto', 'attribué']);
        if (p.online === false) tags.push(['off', 'absent']);
        const tagBox = el('span', 'lobby-tags');
        for (const [cls, txt] of tags) tagBox.append(el('i', `lobby-tag ${cls}`, txt));
        const nameBox = el('span', 'lobby-pmain');
        nameBox.append(name, tagBox);
        li.append(seal, nameBox);
        li.classList.toggle('off', p.online === false);
        const said = tags.filter((t) => t[0] !== 'auto').map((t) => t[1]);
        li.setAttribute('aria-label', `${p.name}${info ? `, ${info.name}${auto ? ' (attribué d’office)' : ''}` : ', sans élément'}${said.length ? `, ${said.join(', ')}` : ''}`);
        if (p.id === this.profile.id) {
          // sa propre ligne : « Renommer », bien visible
          li.classList.add('me');
          const ren = el('button', 'btn quiet lobby-rename', 'Renommer');
          ren.type = 'button';
          ren.addEventListener('click', () => this.rename(li, name));
          li.append(ren);
        } else if (info) li.append(el('span', 'lobby-pel', info.name));
        this.list.append(li);
      });
      const free = MAX_PLAYERS - n;
      if (free > 0 && state === 'online') this.list.append(el('li', 'lobby-free', `${free} place${free > 1 ? 's' : ''} libre${free > 1 ? 's' : ''}`));
    }

    // éléments
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
    const myIdx = players.indexOf(mine);
    const myAuto = multi && mine && !mine.element ? given[myIdx] : null;
    for (const [id, b] of Object.entries(this.pickButtons)) {
      const taker = players.find((p) => p.element === id && p.id !== this.profile.id);
      const sel = mine?.element === id;
      // élément attribué d'office (rien choisi) : marqué, sans être « choisi »
      const auto = !sel && myAuto === id;
      b.classList.toggle('selected', sel);
      b.classList.toggle('auto', auto);
      b.classList.toggle('taken', !!taker);
      b.setAttribute('aria-checked', sel ? 'true' : 'false');
      b.disabled = !!taker || s.inGame;
      b.title = taker ? `Choisi par ${taker.name}` : '';
      const word = STYLE_WORD[id] || String(this.elements[id].style || '').split(/\s+/)[0];
      b.setAttribute('aria-label', `${this.elements[id].name}${taker ? `, pris par ${taker.name}` : auto ? ', attribué d’office : touchez pour le garder' : `, ${this.elements[id].style}`}`);
      b.querySelector('.lobby-el-style').textContent = taker ? `pris : ${taker.name}` : auto ? 'attribué' : word;
    }
    let note;
    if (n <= 1) note = 'Seul, vous jouez les quatre éléments. À plusieurs, chacun prend le sien.';
    else {
      note = 'Chacun pose les lanternes de son élément (sans choix, un élément libre est attribué). Or personnel, vies communes.';
    }
    this.note.textContent = note;

    // rejoindre / quitter
    this.joinSec.classList.toggle('hidden', guest || this.joining);
    this.btnLeave.classList.toggle('hidden', !guest && !this.joining);
    // pendant la recherche, ce bouton l'annule (on retrouve son propre salon)
    const leaveLabel = this.joining ? 'Annuler la recherche' : 'Quitter le salon';
    if (!isArmed(this.btnLeave) && this.btnLeave.textContent !== leaveLabel) this.btnLeave.textContent = leaveLabel;
    this.errorBox.textContent = this.joining ? 'Recherche du salon…' : this.error;
    this.errorBox.classList.toggle('busy', this.joining);
    this.onRender();
  }

  pick(id) {
    const mine = this.players.find((p) => p.id === this.profile.id);
    // seul, toucher son élément le retire (préférence) ; à plusieurs, chacun en garde un
    if (mine?.element === id && this.players.length > 1) {
      this.sound('select');
      return;
    }
    const next = mine?.element === id ? null : id;
    this.profile.element = next;
    saveProfile(this.profile);
    // invité : l'hôte confirme (ou refuse : élément pris au même instant), cf. render()
    if (this.session.role === 'guest') this.pendingPick = { el: next, at: Date.now() };
    if (this.session.lobby) this.session.pickElement(next);
    this.sound('select');
    this.render();
  }

  // Renommer sur place : la ligne devient un champ (16 lettres), validé par OK ou Entrée.
  rename(li, nameEl) {
    if (this.renaming) return;
    this.renaming = true;
    const form = el('form', 'lobby-rename-form');
    const input = el('input', 'lobby-rename-input');
    Object.assign(input, { value: this.profile.name, maxLength: 16, autocomplete: 'off', spellcheck: false, enterKeyHint: 'done' });
    input.setAttribute('aria-label', 'Votre nom (16 lettres au plus)');
    const ok = el('button', 'btn secondary lobby-rename-ok', 'OK');
    ok.type = 'submit';
    form.append(input, ok);
    let done = false;
    const commit = (keep) => {
      if (done) return;
      done = true;
      const v = input.value.trim().slice(0, 16);
      if (keep && v && v !== this.profile.name) {
        this.profile.name = v;
        saveProfile(this.profile);
        this.session.setName(v);
        this.sound('select');
      }
      this.renaming = false;
      this.render();
    };
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      commit(true);
    });
    input.addEventListener('blur', () => setTimeout(() => commit(true), 120));
    input.addEventListener('keydown', (ev) => ev.key === 'Escape' && commit(false));
    li.querySelector('.lobby-pmain')?.replaceWith(form);
    li.querySelector('.lobby-rename')?.remove();
    void nameEl;
    input.focus();
    input.select();
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
      this.joinInput.value = '';
      this.btnJoin.disabled = true;
      if (this.profile.element) this.session.pickElement(this.profile.element);
      this.sound('combo');
      this.toast(`Vous avez rejoint le salon ${code}`);
      return true;
    } catch (e) {
      // recherche annulée (« Annuler la recherche », autre salon) : le joueur a déjà choisi la suite
      if (e.cancelled) return false;
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
    const searching = this.joining;
    this.hostFn();
    this.toast(searching ? 'Recherche annulée' : 'Vous avez quitté le salon');
  }

  retry() {
    this.error = '';
    this.hostFn();
  }
}
