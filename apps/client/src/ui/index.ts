import { Direction } from '@bombermp/shared';
import type { RoomState, RoomPlayer, PublicRoomInfo } from '@bombermp/shared';
import type { PlayerAppearance } from '../game/appearance.js';
import { drawPlayerPreview } from '../game/renderer.js';
import { iconPath } from '../assets/registry.js';

// ─── Design constants ─────────────────────────────────────────────────────────

// Must stay in sync with renderer.ts PLAYER_COLORS
const PLAYER_COLORS    = ['#8B5CF6', '#F472B6', '#FBBF24', '#34D399'] as const;
const PLAYER_BG_LIGHT  = ['#EDE9FE', '#FCE7F3', '#FEF3C7', '#D1FAE5'] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clear(root: HTMLElement): void {
  root.innerHTML = '';
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Lobby (slide navigator) ─────────────────────────────────────────────────

const NAME_ADJS  = ['Red','Blue','Fast','Cool','Bold','Dark','Wild','Swift','Brave','Chill'];
const NAME_NOUNS = ['Fox','Tiger','Eagle','Wolf','Bear','Panda','Shark','Dragon','Hawk','Lion'];
function randomName(): string {
  const a = NAME_ADJS[Math.floor(Math.random() * NAME_ADJS.length)]!;
  const n = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)]!;
  return a + n;
}

export interface ShowLobbyOptions {
  storedName: string | null;
  appearance: PlayerAppearance;
  onCreate: (name: string) => void;
  onJoinPrivate: (roomId: string, name: string) => void;
  onJoinPublic: (roomId: string, name: string) => void;
  onRequestRoomList: () => void;
  onNameSave: (name: string) => void;
  onCustomize?: () => void;
  prefillRoomId?: string;
}

// ─── (removed variant stubs — now replaced by slide navigator below) ─────────

export function showLobby(root: HTMLElement, options: ShowLobbyOptions): void {
  clear(root);
  root.style.display = 'flex';
  injectStyles();

  type Slide = 'home' | 'browse' | 'join';
  let currentSlide: Slide = options.prefillRoomId ? 'join' : 'home';
  let playerName = options.storedName ?? randomName();

  function go(slide: Slide): void {
    currentSlide = slide;
    render();
    if (slide === 'browse') options.onRequestRoomList();
  }

  function setError(msg: string): void {
    const el = root.querySelector<HTMLParagraphElement>('#lobby-error');
    if (el) el.textContent = msg;
  }

  function render(): void {
    clear(root);
    switch (currentSlide) {
      case 'home':   renderHome();   break;
      case 'browse': renderBrowse(); break;
      case 'join':   renderJoin();   break;
    }
  }

  // ── Home slide ──────────────────────────────────────────────────────────────
  function renderHome(): void {
    const bombIcon = iconPath('hudBombIcon');
    root.innerHTML = `
      <div class="bmp-dec bmp-dec--circle-yellow" aria-hidden="true"></div>
      <div class="bmp-dec bmp-dec--circle-pink"   aria-hidden="true"></div>

      <div class="bmp-logo bmp-logo--sm">
        <img class="bmp-logo__bomb" src="${bombIcon}" alt="Bomb">
        <h1 class="bmp-logo__text">BomberMP</h1>
      </div>

      <!-- Identity card: name (left) + avatar (right) -->
      <div class="bmp-card" style="width:100%">
        <div class="bmp-home-identity">
          <div class="bmp-home-name-side">
            <span class="bmp-home-label">Player</span>
            <div class="bmp-home-name-view" id="name-view">
              <span class="bmp-home-name-text" id="name-text">${escHtml(playerName)}</span>
              <button class="bmp-icon-btn" id="name-edit-btn" title="Edit name">✏️</button>
            </div>
            <div class="bmp-home-name-edit bmp-hidden" id="name-edit">
              <input class="bmp-input bmp-home-name-input" id="name-input"
                value="${escHtml(playerName)}" maxlength="32" autocomplete="off" />
              <button class="bmp-icon-btn bmp-icon-btn--confirm" id="name-save-btn" title="Save">✓</button>
            </div>
          </div>
          <div class="bmp-home-avatar-side">
            <div class="bmp-home-avatar-wrap">
              <canvas id="home-avatar" width="72" height="72"></canvas>
              <button class="bmp-icon-btn bmp-icon-btn--avatar" id="avatar-edit-btn" title="Customize">✏️</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Play card -->
      <div class="bmp-card" style="width:100%">
        <div class="bmp-card__header bmp-card__header--violet">
          <h2 class="bmp-card__title">Play</h2>
        </div>
        <div class="bmp-card__body" style="gap:0.4rem;padding:0.75rem 0.9rem">
          <button class="bmp-play-option" id="create-btn">
            <span class="bmp-play-option__icon">🏠</span>
            <div class="bmp-play-option__text">
              <span class="bmp-play-option__title">Create Room</span>
              <span class="bmp-play-option__sub">Host a new game</span>
            </div>
            <span class="bmp-play-option__arrow">→</span>
          </button>
          <button class="bmp-play-option" id="browse-btn">
            <span class="bmp-play-option__icon">🌐</span>
            <div class="bmp-play-option__text">
              <span class="bmp-play-option__title">Browse Rooms</span>
              <span class="bmp-play-option__sub">Join a public game</span>
            </div>
            <span class="bmp-play-option__arrow">→</span>
          </button>
          <button class="bmp-play-option" id="join-private-btn">
            <span class="bmp-play-option__icon">🔒</span>
            <div class="bmp-play-option__text">
              <span class="bmp-play-option__title">Join Room</span>
              <span class="bmp-play-option__sub">Enter room ID</span>
            </div>
            <span class="bmp-play-option__arrow">→</span>
          </button>
        </div>
      </div>

      <p id="lobby-error" class="bmp-error" role="alert" aria-live="polite"></p>
    `;

    // Draw avatar preview
    const avatarCanvas = root.querySelector<HTMLCanvasElement>('#home-avatar')!;
    drawPlayerPreview(avatarCanvas, options.appearance, 0, Direction.RIGHT);

    // Inline name edit
    const nameView    = root.querySelector<HTMLDivElement>('#name-view')!;
    const nameEditDiv = root.querySelector<HTMLDivElement>('#name-edit')!;
    const nameTextEl  = root.querySelector<HTMLSpanElement>('#name-text')!;
    const nameInput   = root.querySelector<HTMLInputElement>('#name-input')!;

    function enterEditMode(): void {
      nameView.classList.add('bmp-hidden');
      nameEditDiv.classList.remove('bmp-hidden');
      nameInput.focus();
      nameInput.select();
    }

    function saveName(): void {
      const trimmed = nameInput.value.trim();
      if (!trimmed) return;
      playerName = trimmed;
      options.onNameSave(trimmed);
      nameTextEl.textContent = trimmed;
      nameEditDiv.classList.add('bmp-hidden');
      nameView.classList.remove('bmp-hidden');
    }

    root.querySelector('#name-edit-btn')!.addEventListener('click', enterEditMode);
    root.querySelector('#name-save-btn')!.addEventListener('click', saveName);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveName();
      if (e.key === 'Escape') {
        nameInput.value = playerName;
        nameEditDiv.classList.add('bmp-hidden');
        nameView.classList.remove('bmp-hidden');
      }
    });

    root.querySelector('#avatar-edit-btn')!.addEventListener('click', () => options.onCustomize?.());

    root.querySelector('#create-btn')!.addEventListener('click', () => {
      setError('');
      options.onCreate(playerName);
    });
    root.querySelector('#browse-btn')!.addEventListener('click', () => go('browse'));
    root.querySelector('#join-private-btn')!.addEventListener('click', () => go('join'));
  }

  // ── Browse slide ────────────────────────────────────────────────────────────
  function renderBrowse(): void {
    root.innerHTML = `
      <div class="bmp-slide-nav">
        <button class="bmp-back-btn" id="back-btn">← Back</button>
        <h2 class="bmp-slide-title">Public Rooms</h2>
        <button class="bmp-btn bmp-btn--ghost bmp-btn--xs" id="refresh-rooms-btn">↻ Refresh</button>
      </div>

      <div class="bmp-card" style="width:100%">
        <div class="bmp-card__body" style="padding-top:0.7rem;padding-bottom:0.7rem">
          <ul class="bmp-room-list" id="public-rooms-list">
            <li class="bmp-room-list__empty">Loading rooms…</li>
          </ul>
        </div>
      </div>

      <p id="lobby-error" class="bmp-error" role="alert" aria-live="polite"></p>
    `;

    root.querySelector('#back-btn')!.addEventListener('click', () => go('home'));
    root.querySelector('#refresh-rooms-btn')!.addEventListener('click', () => {
      const list = root.querySelector<HTMLUListElement>('#public-rooms-list');
      if (list) list.innerHTML = '<li class="bmp-room-list__empty">Loading rooms…</li>';
      options.onRequestRoomList();
    });
    root.querySelector('#public-rooms-list')!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.bmp-room-list__join');
      if (!btn) return;
      const roomId = btn.dataset['roomId'];
      if (!roomId) return;
      setError('');
      btn.disabled = true;
      options.onJoinPublic(roomId, playerName);
    });
  }

  // ── Join private slide ──────────────────────────────────────────────────────
  function renderJoin(): void {
    root.innerHTML = `
      <div class="bmp-slide-nav">
        <button class="bmp-back-btn" id="back-btn">← Back</button>
        <h2 class="bmp-slide-title">Join Private Room</h2>
        <div></div>
      </div>

      <div class="bmp-card" style="width:100%;max-width:380px">
        <div class="bmp-card__header bmp-card__header--pink">
          <span class="bmp-card__icon">🔒</span>
          <h2 class="bmp-card__title">Enter Room ID</h2>
        </div>
        <div class="bmp-card__body">
          <div class="bmp-field">
            <label class="bmp-label" for="join-id">Room ID</label>
            <input class="bmp-input bmp-input--mono" id="join-id" type="text"
              placeholder="ABCD1234" maxlength="16" autocomplete="off"
              style="text-transform:uppercase;letter-spacing:0.12em;" />
          </div>
          <button class="bmp-btn bmp-btn--secondary" id="join-btn">
            Join Room <span class="bmp-btn__arrow">→</span>
          </button>
        </div>
      </div>

      <p id="lobby-error" class="bmp-error" role="alert" aria-live="polite"></p>
    `;

    const joinIdEl = root.querySelector<HTMLInputElement>('#join-id')!;
    const joinBtn  = root.querySelector<HTMLButtonElement>('#join-btn')!;

    if (options.prefillRoomId) {
      joinIdEl.value = options.prefillRoomId;
      joinBtn.focus();
    } else {
      joinIdEl.focus();
    }

    function submit(): void {
      const id = joinIdEl.value.trim().toUpperCase();
      if (!id) { setError('Enter a room ID'); return; }
      setError('');
      joinBtn.disabled = true;
      options.onJoinPrivate(id, playerName);
    }

    joinBtn.addEventListener('click', submit);
    joinIdEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    root.querySelector('#back-btn')!.addEventListener('click', () => go('home'));
  }

  render();
}

export function updatePublicRoomsList(root: HTMLElement, rooms: PublicRoomInfo[]): void {
  const list = root.querySelector<HTMLUListElement>('#public-rooms-list');
  if (!list) return;

  if (rooms.length === 0) {
    list.innerHTML = '<li class="bmp-room-list__empty">No public rooms available</li>';
    return;
  }

  list.innerHTML = rooms.map((r) => `
    <li class="bmp-room-list__item">
      <span class="bmp-room-list__id">${escHtml(r.roomId)}</span>
      <span class="bmp-room-list__count">${r.playerCount} / ${r.maxPlayers}</span>
      <button class="bmp-btn bmp-btn--ghost bmp-btn--xs bmp-room-list__join"
        data-room-id="${escHtml(r.roomId)}">Join →</button>
    </li>
  `).join('');
}

export function showLobbyError(root: HTMLElement, message: string): void {
  const errorEl = root.querySelector<HTMLParagraphElement>('#lobby-error');
  if (errorEl) errorEl.textContent = message;

  const createBtn = root.querySelector<HTMLButtonElement>('#create-btn');
  const joinBtn   = root.querySelector<HTMLButtonElement>('#join-btn');
  if (createBtn) createBtn.disabled = false;
  if (joinBtn)   joinBtn.disabled   = false;

  root.querySelectorAll<HTMLButtonElement>('.bmp-room-list__join').forEach((btn) => {
    btn.disabled = false;
  });
}

// ─── Waiting Room ─────────────────────────────────────────────────────────────

export function showWaitingRoom(
  root: HTMLElement,
  state: RoomState,
  myPlayerId: string,
  onStart: () => void,
  onLeave: () => void,
  onConfigure?: (isPublic: boolean) => void,
  gameInProgress?: boolean,
): void {
  clear(root);
  root.style.display = 'flex';
  injectStyles();

  const amCreator  = state.players.some((p) => p.id === myPlayerId && p.isCreator);
  const isStarting = state.status === 'STARTING';
  const isPublic   = state.isPublic !== false; // treat undefined as true

  let countdownHtml = '';
  if (isStarting && state.countdownEndsAt) {
    const secsLeft = Math.max(0, Math.ceil((state.countdownEndsAt - Date.now()) / 1000));
    countdownHtml = `
      <div class="bmp-countdown-wrap">
        <span class="bmp-countdown-label">Starting in</span>
        <span class="bmp-countdown">${secsLeft}</span>
      </div>
    `;
  }

  // Empty slot placeholders
  const emptySlots = Array.from(
    { length: state.maxPlayers - state.players.length },
    (_, i) => `
      <li class="bmp-player-row bmp-player-row--empty">
        <span class="bmp-player-slot">Slot ${state.players.length + i + 1}</span>
      </li>
    `,
  ).join('');

  const gameInProgressBanner = gameInProgress
    ? `<div class="bmp-game-banner">🎮 Game in progress — you'll join next round</div>`
    : '';

  const startBtn = gameInProgress
    ? ''
    : amCreator
      ? `<button class="bmp-btn bmp-btn--primary bmp-btn--sm" id="start-btn" ${isStarting ? 'disabled' : ''}>
           ${isStarting ? 'Starting…' : 'Start Game <span class="bmp-btn__arrow" aria-hidden="true">→</span>'}
         </button>`
      : `<span class="bmp-waiting-hint">Waiting for host…</span>`;

  const shareUrl = `${window.location.origin}${window.location.pathname}#r${state.roomId}`;

  const toggleDisabled = !amCreator ? 'disabled' : '';
  const toggleChecked  = isPublic ? 'checked' : '';
  const toggleHint     = isPublic
    ? 'Visible in the public room list'
    : 'Private — join via direct link only';

  root.innerHTML = `
    <div class="bmp-dec bmp-dec--circle-yellow bmp-dec--sm" aria-hidden="true"></div>

    <div class="bmp-logo bmp-logo--sm">
      <img class="bmp-logo__bomb" src="${iconPath('hudBombIcon')}" alt="Bomb">
      <h1 class="bmp-logo__text">BomberMP</h1>
    </div>

    <div class="bmp-waiting-layout">
      <!-- Player list card -->
      <div class="bmp-card">
        <div class="bmp-card__header bmp-card__header--violet">
          <h2 class="bmp-card__title" style="font-size:1rem;">Room</h2>
          <div class="bmp-room-id-wrap">
            <span class="bmp-room-id">${escHtml(state.roomId)}</span>
            <button class="bmp-btn bmp-btn--ghost bmp-btn--xs" id="copy-btn">Copy ID</button>
          </div>
        </div>

        <div class="bmp-card__body">
          <ul class="bmp-player-list" id="player-list">
            ${state.players.map((p, i) => renderPlayerRow(p, myPlayerId, i)).join('')}
            ${emptySlots}
          </ul>

          ${countdownHtml}
          ${gameInProgressBanner}

          <div class="bmp-action-row">
            <button class="bmp-btn bmp-btn--danger bmp-btn--sm" id="leave-btn">Leave</button>
            ${startBtn}
          </div>

          <p class="bmp-player-count">${state.players.length} / ${state.maxPlayers} players</p>
        </div>
      </div>

      <!-- Room settings card -->
      <div class="bmp-card">
        <div class="bmp-card__header bmp-card__header--green">
          <span class="bmp-card__icon" aria-hidden="true">⚙️</span>
          <h2 class="bmp-card__title">Room Settings</h2>
        </div>
        <div class="bmp-card__body">
          <div class="bmp-toggle-row">
            <span class="bmp-label" style="margin-bottom:0">Public room</span>
            <label class="bmp-toggle" title="${amCreator ? 'Toggle public/private' : 'Only the host can change this'}">
              <input type="checkbox" id="room-public-toggle"
                ${toggleChecked} ${toggleDisabled} />
              <span class="bmp-toggle__track"></span>
            </label>
          </div>
          <p class="bmp-toggle-hint" id="toggle-hint">${toggleHint}</p>

          <div class="bmp-share-row">
            <span class="bmp-share-link" title="${escHtml(shareUrl)}">${escHtml(shareUrl)}</span>
            <button class="bmp-btn bmp-btn--ghost bmp-btn--xs" id="share-copy-btn">Copy Link</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const copyBtn      = root.querySelector<HTMLButtonElement>('#copy-btn')!;
  const leaveBtn     = root.querySelector<HTMLButtonElement>('#leave-btn')!;
  const startBtnEl   = root.querySelector<HTMLButtonElement>('#start-btn');
  const toggleEl     = root.querySelector<HTMLInputElement>('#room-public-toggle');
  const toggleHintEl = root.querySelector<HTMLParagraphElement>('#toggle-hint');
  const shareCopyBtn = root.querySelector<HTMLButtonElement>('#share-copy-btn')!;

  copyBtn.addEventListener('click', () => {
    void navigator.clipboard.writeText(state.roomId).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy ID'; }, 1500);
    });
  });

  leaveBtn.addEventListener('click', onLeave);
  startBtnEl?.addEventListener('click', () => {
    if (startBtnEl) startBtnEl.disabled = true;
    onStart();
  });

  toggleEl?.addEventListener('change', () => {
    if (!amCreator || !toggleEl) return;
    const nowPublic = toggleEl.checked;
    if (toggleHintEl) {
      toggleHintEl.textContent = nowPublic
        ? 'Visible in the public room list'
        : 'Private — join via direct link only';
    }
    onConfigure?.(nowPublic);
  });

  shareCopyBtn.addEventListener('click', () => {
    void navigator.clipboard.writeText(shareUrl).then(() => {
      shareCopyBtn.textContent = 'Copied!';
      setTimeout(() => { shareCopyBtn.textContent = 'Copy Link'; }, 1500);
    });
  });
}

function renderPlayerRow(player: RoomPlayer, myPlayerId: string, slotIndex: number): string {
  const isMe     = player.id === myPlayerId;
  const color    = PLAYER_COLORS[slotIndex % PLAYER_COLORS.length] ?? '#8B5CF6';
  const lightBg  = PLAYER_BG_LIGHT[slotIndex % PLAYER_BG_LIGHT.length] ?? '#EDE9FE';
  const initial  = escHtml(player.displayName.charAt(0).toUpperCase());
  const crown    = player.isCreator ? '<span class="bmp-crown" title="Room creator" aria-label="Room creator">👑</span>' : '';
  const youBadge = isMe ? '<span class="bmp-you-badge">you</span>' : '';

  return `
    <li class="bmp-player-row">
      <div class="bmp-avatar" style="background:${lightBg};color:${color};border-color:${color};"
           aria-hidden="true">${initial}</div>
      <span class="bmp-player-name">${escHtml(player.displayName)}</span>
      ${crown}${youBadge}
    </li>
  `;
}

// ─── Game Over overlay ────────────────────────────────────────────────────────

export function showGameOver(
  root: HTMLElement,
  winnerId: string | null,
  players: Record<string, { displayName: string }>,
): void {
  root.style.display = 'flex';
  injectStyles();

  const winnerName = winnerId ? (players[winnerId]?.displayName ?? 'Unknown') : null;
  const message    = winnerName ? `${escHtml(winnerName)} Wins!` : "It's a Draw!";
  const emoji      = winnerName ? '🏆' : '💥';

  const overlay = document.createElement('div');
  overlay.id        = 'game-over-overlay';
  overlay.className = 'bmp-game-over';
  overlay.innerHTML = `
    <div class="bmp-game-over__panel">
      <div class="bmp-game-over__emoji">${emoji}</div>
      <p class="bmp-game-over__msg">${message}</p>
      <p class="bmp-game-over__sub">Returning to lobby…</p>
      <div class="bmp-game-over__dots" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 3200);
}

// ─── Visibility helpers ───────────────────────────────────────────────────────

export function hideUI(root: HTMLElement): void {
  root.style.display = 'none';
}

export function showUI(root: HTMLElement): void {
  root.style.display = 'flex';
}

// ─── Style injection ──────────────────────────────────────────────────────────

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    /* ── Decorative shapes ─────────────────────────────────────── */
    .bmp-dec {
      position: absolute;
      border-radius: 50%;
      pointer-events: none;
      z-index: -1;
    }
    .bmp-dec--circle-yellow {
      width: 200px; height: 200px;
      background: #FBBF24;
      opacity: 0.22;
      top: -70px; right: -60px;
    }
    .bmp-dec--circle-pink {
      width: 130px; height: 130px;
      background: #F472B6;
      opacity: 0.18;
      bottom: 10px; left: -50px;
    }
    .bmp-dec--dots {
      width: 80px; height: 80px;
      background-image: radial-gradient(circle, #8B5CF6 2.5px, transparent 2.5px);
      background-size: 12px 12px;
      bottom: 50px; right: -20px;
    }
    .bmp-dec--sm {
      width: 110px !important; height: 110px !important;
      top: -35px !important; right: -30px !important;
    }

    /* ── Logo ──────────────────────────────────────────────────── */
    .bmp-logo {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      margin-bottom: 0.25rem;
    }
    .bmp-logo--sm .bmp-logo__text { font-size: 1.8rem; }
    .bmp-logo--sm .bmp-logo__bomb { font-size: 1.5rem; }
    .bmp-logo__bomb { display: block; height: 3.5rem; width: auto; }
    .bmp-logo--sm { margin-bottom: 0.15rem; }
    .bmp-logo__bomb {
      font-size: 2.6rem;
    }
    .bmp-logo__bomb:hover {
      animation: bmp-wiggle 2.4s ease-in-out infinite;
    }
    .bmp-logo__text {
      font-family: 'Outfit', system-ui, sans-serif;
      font-weight: 800;
      font-size: 2.8rem;
      color: #1E293B;
      letter-spacing: -0.02em;
      line-height: 1;
    }
    @keyframes bmp-wiggle {
      0%, 85%, 100% { transform: rotate(0deg); }
      90%            { transform: rotate(-10deg); }
      95%            { transform: rotate(10deg); }
    }

    /* ── Card ──────────────────────────────────────────────────── */
    .bmp-card {
      background: #FFFFFF;
      border: 2px solid #1E293B;
      border-radius: 16px;
      box-shadow: 5px 5px 0px 0px #1E293B;
      width: 100%;
      overflow: hidden;
      transition:
        box-shadow 0.25s cubic-bezier(0.34,1.56,0.64,1),
        transform  0.25s cubic-bezier(0.34,1.56,0.64,1);
    }
    .bmp-card:hover {
      box-shadow: 7px 7px 0px 0px #1E293B;
      transform: translate(-1px, -1px);
    }
    .bmp-card__header {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      padding: 0.8rem 1.2rem;
      border-bottom: 2px solid #1E293B;
    }
    .bmp-card__header--violet { background: #EDE9FE; }
    .bmp-card__header--pink   { background: #FCE7F3; }
    .bmp-card__header--yellow { background: #FEF3C7; }
    .bmp-card__header--green  { background: #D1FAE5; }
    .bmp-card__icon { font-size: 1rem; }
    .bmp-card__title {
      font-family: 'Outfit', system-ui, sans-serif;
      font-weight: 700;
      font-size: 1rem;
      color: #1E293B;
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }
    .bmp-card__body {
      padding: 1.1rem 1.2rem;
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
    }

    /* ── Form elements ─────────────────────────────────────────── */
    .bmp-field { display: flex; flex-direction: column; }
    .bmp-input-row { display: flex; gap: 0.55rem; }
    .bmp-label {
      display: block;
      font-weight: 600;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: #64748B;
      margin-bottom: 0.28rem;
    }
    .bmp-input {
      display: block;
      width: 100%;
      background: #FFFFFF;
      border: 2px solid #CBD5E1;
      border-radius: 8px;
      color: #1E293B;
      padding: 0.55rem 0.75rem;
      font-size: 0.9rem;
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      outline: none;
      box-shadow: 4px 4px 0px transparent;
      transition:
        border-color 0.15s,
        box-shadow   0.2s cubic-bezier(0.34,1.56,0.64,1);
      box-sizing: border-box;
    }
    .bmp-input:focus {
      border-color: #8B5CF6;
      box-shadow: 4px 4px 0px 0px #8B5CF6;
    }
    .bmp-input--mono {
      font-family: 'Outfit', monospace;
      font-weight: 700;
    }

    /* ── Buttons ───────────────────────────────────────────────── */
    .bmp-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      font-weight: 700;
      font-size: 0.9rem;
      border-radius: 9999px;
      padding: 0.62rem 1.4rem;
      border: 2px solid #1E293B;
      cursor: pointer;
      white-space: nowrap;
      transition:
        transform  0.22s cubic-bezier(0.34,1.56,0.64,1),
        box-shadow 0.22s cubic-bezier(0.34,1.56,0.64,1),
        background 0.15s;
    }
    .bmp-btn--primary {
      background: #8B5CF6;
      color: #FFFFFF;
      box-shadow: 4px 4px 0px 0px #1E293B;
    }
    .bmp-btn--primary:hover:not(:disabled) {
      transform: translate(-2px, -2px);
      box-shadow: 6px 6px 0px 0px #1E293B;
    }
    .bmp-btn--primary:active:not(:disabled) {
      transform: translate(2px, 2px);
      box-shadow: 2px 2px 0px 0px #1E293B;
    }
    .bmp-btn--secondary {
      background: #FBBF24;
      color: #1E293B;
      box-shadow: 4px 4px 0px 0px #1E293B;
    }
    .bmp-btn--secondary:hover:not(:disabled) {
      transform: translate(-2px, -2px);
      box-shadow: 6px 6px 0px 0px #1E293B;
    }
    .bmp-btn--secondary:active:not(:disabled) {
      transform: translate(2px, 2px);
      box-shadow: 2px 2px 0px 0px #1E293B;
    }
    .bmp-btn--danger {
      background: transparent;
      color: #1E293B;
      border-color: #1E293B;
      box-shadow: none;
    }
    .bmp-btn--danger:hover:not(:disabled) {
      background: #FEE2E2;
      color: #DC2626;
      border-color: #DC2626;
    }
    .bmp-btn--ghost {
      background: transparent;
      border: 1.5px solid #CBD5E1;
      color: #64748B;
      box-shadow: none;
    }
    .bmp-btn--ghost:hover { background: #F1F5F9; }
    .bmp-btn--xs { padding: 0.15rem 0.5rem; font-size: 0.7rem; }
    .bmp-btn--sm { padding: 0.48rem 1rem; font-size: 0.85rem; }
    .bmp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .bmp-btn__arrow {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px; height: 20px;
      background: rgba(255,255,255,0.28);
      border-radius: 50%;
      font-size: 0.85rem;
    }

    /* ── Error ─────────────────────────────────────────────────── */
    .bmp-error {
      min-height: 1.4em;
      font-size: 0.85rem;
      font-weight: 600;
      color: #DC2626;
      text-align: center;
      padding: 0;
      transition: all 0.15s;
    }
    .bmp-error:not(:empty) {
      background: #FEE2E2;
      border-radius: 8px;
      padding: 0.35rem 0.8rem;
      border: 1.5px solid #FECACA;
    }

    /* ── Public room list ──────────────────────────────────────── */
    .bmp-room-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      max-height: 180px;
      overflow-y: auto;
    }
    .bmp-room-list__empty {
      font-style: italic;
      color: #64748B;
      font-size: 0.85rem;
      text-align: center;
      padding: 0.5rem 0;
    }
    .bmp-room-list__item {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.45rem 0.55rem;
      border-radius: 10px;
      background: #FAFAFA;
      border: 1.5px solid #F1F5F9;
    }
    .bmp-room-list__id {
      font-family: 'Outfit', monospace;
      font-weight: 800;
      font-size: 0.88rem;
      letter-spacing: 0.1em;
      color: #8B5CF6;
    }
    .bmp-room-list__count {
      font-size: 0.75rem;
      color: #64748B;
      margin-left: auto;
    }

    /* ── Waiting room layout ───────────────────────────────────── */
    .bmp-waiting-layout {
      display: flex;
      gap: 1rem;
      width: 100%;
      flex-wrap: wrap;
    }
    .bmp-waiting-layout > .bmp-card {
      flex: 1 1 300px;
      min-width: 280px;
    }
    .bmp-room-id-wrap {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      margin-left: auto;
    }
    .bmp-room-id {
      font-family: 'Outfit', monospace;
      font-weight: 800;
      font-size: 1.05rem;
      letter-spacing: 0.15em;
      color: #8B5CF6;
      background: #EDE9FE;
      border: 2px solid #8B5CF6;
      border-radius: 8px;
      padding: 0.1rem 0.5rem;
    }
    .bmp-player-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }
    .bmp-player-row {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.45rem 0.55rem;
      border-radius: 10px;
      background: #FAFAFA;
      border: 1.5px solid #F1F5F9;
    }
    .bmp-player-row--empty {
      border-style: dashed;
      background: transparent;
    }
    .bmp-avatar {
      width: 32px; height: 32px;
      border-radius: 50%;
      border: 2px solid currentColor;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Outfit', system-ui, sans-serif;
      font-weight: 800;
      font-size: 0.9rem;
      flex-shrink: 0;
    }
    .bmp-player-slot { color: #CBD5E1; font-size: 0.8rem; font-weight: 500; font-style: italic; }
    .bmp-player-name { font-weight: 600; font-size: 0.88rem; flex: 1; }
    .bmp-crown { font-size: 0.85rem; }
    .bmp-you-badge {
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #8B5CF6;
      background: #EDE9FE;
      border-radius: 99px;
      padding: 0.1rem 0.4rem;
    }

    /* ── Toggle ────────────────────────────────────────────────── */
    .bmp-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .bmp-toggle {
      display: inline-flex;
      position: relative;
      cursor: pointer;
      flex-shrink: 0;
    }
    .bmp-toggle input {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
    }
    .bmp-toggle__track {
      display: block;
      width: 42px;
      height: 24px;
      background: #CBD5E1;
      border-radius: 99px;
      border: 2px solid #1E293B;
      position: relative;
      transition: background 0.2s;
    }
    .bmp-toggle__track::after {
      content: '';
      position: absolute;
      top: 2px; left: 2px;
      width: 16px; height: 16px;
      border-radius: 50%;
      background: #FFFFFF;
      border: 1.5px solid #1E293B;
      transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1);
    }
    .bmp-toggle input:checked + .bmp-toggle__track {
      background: #34D399;
    }
    .bmp-toggle input:checked + .bmp-toggle__track::after {
      transform: translateX(18px);
    }
    .bmp-toggle input:disabled + .bmp-toggle__track {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .bmp-toggle-hint {
      font-size: 0.75rem;
      color: #64748B;
      margin: 0;
    }

    /* ── Share row ─────────────────────────────────────────────── */
    .bmp-share-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: #F8FAFC;
      border: 1.5px solid #E2E8F0;
      border-radius: 8px;
      padding: 0.4rem 0.6rem;
    }
    .bmp-share-link {
      font-size: 0.72rem;
      color: #8B5CF6;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: 'Outfit', monospace;
    }

    /* ── Countdown ─────────────────────────────────────────────── */
    .bmp-countdown-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: #FEF3C7;
      border: 2px solid #FBBF24;
      border-radius: 12px;
    }
    .bmp-countdown-label { font-size: 0.85rem; font-weight: 600; color: #92400E; }
    .bmp-countdown {
      font-family: 'Outfit', system-ui, sans-serif;
      font-weight: 800;
      font-size: 1.9rem;
      color: #92400E;
      min-width: 2ch;
      text-align: center;
      animation: bmp-pop 0.4s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes bmp-pop {
      0%   { transform: scale(0.6); }
      100% { transform: scale(1); }
    }

    /* ── Game-in-progress banner ───────────────────────────────── */
    .bmp-game-banner {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: #FEF3C7;
      border: 2px solid #FBBF24;
      border-radius: 12px;
      font-size: 0.85rem;
      font-weight: 600;
      color: #92400E;
    }

    /* ── Action row ────────────────────────────────────────────── */
    .bmp-action-row {
      display: flex;
      gap: 0.55rem;
      justify-content: flex-end;
      align-items: center;
    }
    .bmp-waiting-hint { font-size: 0.8rem; color: #64748B; font-style: italic; }
    .bmp-player-count { font-size: 0.78rem; color: #64748B; text-align: right; }

    /* ── Game Over ─────────────────────────────────────────────── */
    .bmp-game-over {
      position: fixed;
      inset: 0;
      background: rgba(30, 41, 59, 0.72);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      pointer-events: none;
      animation: bmp-fade-in 0.3s ease;
    }
    .bmp-game-over__panel {
      background: #FFFFFF;
      border: 2px solid #1E293B;
      border-radius: 20px;
      box-shadow: 8px 8px 0px 0px #1E293B;
      padding: 2.5rem 3.5rem;
      text-align: center;
      animation: bmp-pop-in 0.5s cubic-bezier(0.34,1.56,0.64,1);
    }
    .bmp-game-over__emoji {
      font-size: 3.5rem;
      margin-bottom: 0.5rem;
      display: block;
      animation: bmp-wiggle 1.2s ease-in-out infinite;
    }
    .bmp-game-over__msg {
      font-family: 'Outfit', system-ui, sans-serif;
      font-weight: 800;
      font-size: 2rem;
      color: #1E293B;
      margin-bottom: 0.35rem;
    }
    .bmp-game-over__sub { font-size: 0.875rem; color: #64748B; margin-bottom: 1rem; }
    .bmp-game-over__dots { display: flex; gap: 0.4rem; justify-content: center; }
    .bmp-game-over__dots span {
      width: 9px; height: 9px;
      border-radius: 50%;
      animation: bmp-pulse 1.2s ease-in-out infinite;
    }
    .bmp-game-over__dots span:nth-child(1) { background: #8B5CF6; animation-delay: 0s; }
    .bmp-game-over__dots span:nth-child(2) { background: #F472B6; animation-delay: 0.2s; }
    .bmp-game-over__dots span:nth-child(3) { background: #FBBF24; animation-delay: 0.4s; }

    @keyframes bmp-pulse {
      0%, 100% { transform: scale(1);   opacity: 1; }
      50%       { transform: scale(1.5); opacity: 0.6; }
    }
    @keyframes bmp-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes bmp-pop-in {
      0%   { transform: scale(0.55); opacity: 0; }
      100% { transform: scale(1);    opacity: 1; }
    }

    /* ── Home identity section ─────────────────────────────────── */
    .bmp-home-identity {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem 1.2rem;
    }
    .bmp-home-name-side {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      min-width: 0;
    }
    .bmp-home-label {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #94A3B8;
    }
    .bmp-home-name-view {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .bmp-home-name-text {
      font-family: 'Outfit', system-ui, sans-serif;
      font-weight: 800;
      font-size: 1.25rem;
      color: #1E293B;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bmp-home-name-edit {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .bmp-home-name-input {
      font-size: 1rem !important;
      font-weight: 700 !important;
      padding: 0.3rem 0.55rem !important;
      flex: 1;
    }
    .bmp-icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 0.9rem;
      padding: 0.2rem 0.25rem;
      border-radius: 6px;
      line-height: 1;
      color: #94A3B8;
      transition: background 0.12s, color 0.12s;
      flex-shrink: 0;
    }
    .bmp-icon-btn:hover { background: #F1F5F9; color: #1E293B; }
    .bmp-icon-btn--confirm { color: #10B981; font-size: 1.05rem; }
    .bmp-icon-btn--confirm:hover { background: #D1FAE5; color: #059669; }
    .bmp-home-avatar-side { flex-shrink: 0; }
    .bmp-home-avatar-wrap {
      position: relative;
      display: inline-flex;
    }
    .bmp-home-avatar-wrap canvas {
      border-radius: 12px;
      border: 2px solid #E2E8F0;
      background: #FFFDF5;
      display: block;
    }
    .bmp-icon-btn--avatar {
      position: absolute;
      bottom: -6px;
      right: -6px;
      background: #FFFFFF;
      border: 1.5px solid #1E293B !important;
      font-size: 0.65rem;
      padding: 0.15rem 0.3rem;
      border-radius: 6px;
      box-shadow: 2px 2px 0 #1E293B;
      color: #1E293B;
    }
    .bmp-icon-btn--avatar:hover { background: #EDE9FE; }
    .bmp-hidden { display: none !important; }

    /* ── Play options ───────────────────────────────────────────── */
    .bmp-play-option {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      width: 100%;
      padding: 0.65rem 0.75rem;
      border: 2px solid #E2E8F0;
      border-radius: 12px;
      background: #FAFAFA;
      cursor: pointer;
      text-align: left;
      font-family: inherit;
      transition: border-color 0.15s, background 0.15s, transform 0.15s, box-shadow 0.15s;
    }
    .bmp-play-option:hover {
      border-color: #8B5CF6;
      background: #FFFFFF;
      transform: translate(-1px, -1px);
      box-shadow: 3px 3px 0 #1E293B;
    }
    .bmp-play-option:active { transform: translate(1px, 1px); box-shadow: 1px 1px 0 #1E293B; }
    .bmp-play-option__icon { font-size: 1.35rem; flex-shrink: 0; }
    .bmp-play-option__text { flex: 1; display: flex; flex-direction: column; gap: 0.08rem; }
    .bmp-play-option__title { font-weight: 700; font-size: 0.88rem; color: #1E293B; }
    .bmp-play-option__sub { font-size: 0.72rem; color: #94A3B8; }
    .bmp-play-option__arrow { font-size: 0.95rem; color: #CBD5E1; flex-shrink: 0; }

    /* ── Slide navigation header ────────────────────────────────── */
    .bmp-slide-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      gap: 0.5rem;
    }
    .bmp-back-btn {
      background: none;
      border: 2px solid #1E293B;
      border-radius: 9999px;
      padding: 0.38rem 0.85rem;
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      font-weight: 700;
      font-size: 0.8rem;
      cursor: pointer;
      color: #1E293B;
      white-space: nowrap;
      transition: background 0.12s;
    }
    .bmp-back-btn:hover { background: #F1F5F9; }
    .bmp-slide-title {
      font-family: 'Outfit', system-ui, sans-serif;
      font-weight: 800;
      font-size: 1.05rem;
      color: #1E293B;
      margin: 0;
      text-align: center;
    }

    /* ── Responsive ────────────────────────────────────────────── */
    @media (max-width: 480px) {
      .bmp-logo__text { font-size: 2.2rem; }
      .bmp-game-over__panel { padding: 1.75rem 2rem; }
      .bmp-btn--primary,
      .bmp-btn--secondary { box-shadow: 2px 2px 0px 0px #1E293B; }
      .bmp-btn--primary:hover:not(:disabled),
      .bmp-btn--secondary:hover:not(:disabled) { box-shadow: 4px 4px 0px 0px #1E293B; }
      .bmp-card { box-shadow: 3px 3px 0px 0px #1E293B; }
    }

    /* Honour reduced-motion */
    @media (prefers-reduced-motion: reduce) {
      .bmp-logo__bomb,
      .bmp-game-over__emoji { animation: none !important; }
      .bmp-countdown          { animation: none !important; }
      .bmp-game-over__dots span { animation: none !important; }
      .bmp-card:hover         { transform: none !important; }
    }
  `;
  document.head.appendChild(style);
}
