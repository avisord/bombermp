import type { RoomState, RoomPlayer } from '@bombermp/shared';

// ─── UI helpers ───────────────────────────────────────────────────────────────

function clear(root: HTMLElement): void {
  root.innerHTML = '';
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

export function showLobby(
  root: HTMLElement,
  onCreate: (name: string) => void,
  onJoin: (roomId: string, name: string) => void,
): void {
  clear(root);
  root.style.display = 'flex';

  root.innerHTML = `
    <h1 style="font-size:3rem;letter-spacing:0.1em;color:#f5a623;margin-bottom:2rem;">BomberMP</h1>

    <div class="card">
      <h2>Create Room</h2>
      <div class="row">
        <input id="create-name" type="text" placeholder="Your name" maxlength="32" autocomplete="off" />
        <button id="create-btn">Create Room</button>
      </div>
    </div>

    <div class="divider">— or —</div>

    <div class="card">
      <h2>Join Room</h2>
      <div class="row">
        <input id="join-id"   type="text" placeholder="Room ID" maxlength="16" autocomplete="off" style="width:120px;text-transform:uppercase;" />
        <input id="join-name" type="text" placeholder="Your name" maxlength="32" autocomplete="off" />
        <button id="join-btn">Join Room</button>
      </div>
    </div>

    <p id="lobby-error" style="color:#ff5555;min-height:1.2em;"></p>
  `;

  injectLobbyStyles();

  const createNameEl = root.querySelector<HTMLInputElement>('#create-name')!;
  const createBtn    = root.querySelector<HTMLButtonElement>('#create-btn')!;
  const joinIdEl     = root.querySelector<HTMLInputElement>('#join-id')!;
  const joinNameEl   = root.querySelector<HTMLInputElement>('#join-name')!;
  const joinBtn      = root.querySelector<HTMLButtonElement>('#join-btn')!;
  const errorEl      = root.querySelector<HTMLParagraphElement>('#lobby-error')!;

  function setError(msg: string): void {
    errorEl.textContent = msg;
  }

  createBtn.addEventListener('click', () => {
    const name = createNameEl.value.trim();
    if (!name) { setError('Enter your name first'); return; }
    setError('');
    createBtn.disabled = true;
    onCreate(name);
  });

  joinBtn.addEventListener('click', () => {
    const id   = joinIdEl.value.trim().toUpperCase();
    const name = joinNameEl.value.trim();
    if (!id)   { setError('Enter a room ID'); return; }
    if (!name) { setError('Enter your name'); return; }
    setError('');
    joinBtn.disabled = true;
    onJoin(id, name);
  });

  // Allow Enter key in inputs
  createNameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') createBtn.click(); });
  joinNameEl.addEventListener('keydown',   (e) => { if (e.key === 'Enter') joinBtn.click(); });
  joinIdEl.addEventListener('keydown',     (e) => { if (e.key === 'Enter') joinBtn.click(); });

  createNameEl.focus();
}

export function showLobbyError(root: HTMLElement, message: string): void {
  const errorEl = root.querySelector<HTMLParagraphElement>('#lobby-error');
  if (errorEl) errorEl.textContent = message;

  // Re-enable buttons so the user can retry
  const createBtn = root.querySelector<HTMLButtonElement>('#create-btn');
  const joinBtn   = root.querySelector<HTMLButtonElement>('#join-btn');
  if (createBtn) createBtn.disabled = false;
  if (joinBtn)   joinBtn.disabled   = false;
}

// ─── Waiting Room ─────────────────────────────────────────────────────────────

export function showWaitingRoom(
  root: HTMLElement,
  state: RoomState,
  myPlayerId: string,
  onStart: () => void,
  onLeave: () => void,
): void {
  clear(root);
  root.style.display = 'flex';

  const amCreator = state.players.some((p) => p.id === myPlayerId && p.isCreator);
  const isStarting = state.status === 'STARTING';

  let countdownText = '';
  if (isStarting && state.countdownEndsAt) {
    const secsLeft = Math.max(0, Math.ceil((state.countdownEndsAt - Date.now()) / 1000));
    countdownText = `<p class="countdown">Starting in ${secsLeft}…</p>`;
  }

  root.innerHTML = `
    <h1 style="font-size:2rem;letter-spacing:0.1em;color:#f5a623;margin-bottom:1.5rem;">BomberMP</h1>

    <div class="card" style="min-width:320px;">
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem;">
        <h2 style="margin:0;">Room <span style="color:#f5a623;font-family:monospace;">${state.roomId}</span></h2>
        <button id="copy-btn" style="font-size:0.75rem;padding:0.2rem 0.6rem;">Copy ID</button>
      </div>

      <ul id="player-list" style="list-style:none;padding:0;margin:0 0 1rem;">
        ${state.players.map((p) => renderPlayerRow(p, myPlayerId)).join('')}
      </ul>

      ${countdownText}

      <div style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:0.5rem;">
        <button id="leave-btn" style="background:#44475a;">Leave</button>
        ${amCreator ? `<button id="start-btn" ${isStarting ? 'disabled' : ''}>Start Game</button>` : ''}
      </div>
    </div>

    <p style="color:#888;font-size:0.8rem;margin-top:0.75rem;">${state.players.length}/${state.maxPlayers} players</p>
  `;

  const copyBtn  = root.querySelector<HTMLButtonElement>('#copy-btn')!;
  const leaveBtn = root.querySelector<HTMLButtonElement>('#leave-btn')!;
  const startBtn = root.querySelector<HTMLButtonElement>('#start-btn');

  copyBtn.addEventListener('click', () => {
    void navigator.clipboard.writeText(state.roomId).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy ID'; }, 1500);
    });
  });

  leaveBtn.addEventListener('click', onLeave);
  startBtn?.addEventListener('click', () => {
    if (startBtn) startBtn.disabled = true;
    onStart();
  });
}

function renderPlayerRow(player: RoomPlayer, myPlayerId: string): string {
  const isMe      = player.id === myPlayerId;
  const crownIcon = player.isCreator ? ' 👑' : '';
  const youLabel  = isMe ? ' <span style="color:#888;font-size:0.8em;">(you)</span>' : '';
  return `
    <li style="padding:0.35rem 0;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:0.5rem;">
      <span style="color:#50fa7b;font-size:0.8rem;">●</span>
      <span>${escHtml(player.displayName)}${crownIcon}${youLabel}</span>
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

  const winnerName = winnerId ? (players[winnerId]?.displayName ?? 'Unknown') : null;
  const message = winnerName ? `${escHtml(winnerName)} wins!` : 'Draw!';

  const overlay = document.createElement('div');
  overlay.id = 'game-over-overlay';
  overlay.innerHTML = `
    <div style="
      background:rgba(20,20,35,0.92);
      border:2px solid #f5a623;
      border-radius:12px;
      padding:2rem 3rem;
      text-align:center;
    ">
      <p style="font-size:2.5rem;color:#f5a623;margin:0 0 0.5rem;">${message}</p>
      <p style="color:#888;font-size:0.9rem;">Returning to lobby…</p>
    </div>
  `;
  overlay.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    display:flex;align-items:center;justify-content:center;
    z-index:100;pointer-events:none;
  `;

  document.body.appendChild(overlay);

  // Auto-remove after 3 seconds (server will send room:state WAITING anyway)
  setTimeout(() => overlay.remove(), 3200);
}

// ─── Visibility helpers ───────────────────────────────────────────────────────

export function hideUI(root: HTMLElement): void {
  root.style.display = 'none';
}

export function showUI(root: HTMLElement): void {
  root.style.display = 'flex';
}

// ─── Shared styles ────────────────────────────────────────────────────────────

let stylesInjected = false;

function injectLobbyStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      padding: 1.25rem 1.5rem;
      margin-bottom: 0.75rem;
    }
    .card h2 {
      margin: 0 0 0.75rem;
      font-size: 1rem;
      color: #aaa;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .row {
      display: flex;
      gap: 0.6rem;
      align-items: center;
    }
    input[type="text"] {
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px;
      color: #eee;
      padding: 0.45rem 0.7rem;
      font-size: 0.95rem;
      outline: none;
      width: 180px;
    }
    input[type="text"]:focus {
      border-color: #f5a623;
    }
    button {
      background: #f5a623;
      color: #1a1a2e;
      border: none;
      border-radius: 6px;
      padding: 0.45rem 1rem;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
      white-space: nowrap;
    }
    button:hover:not(:disabled) { opacity: 0.85; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    .divider {
      color: #555;
      font-size: 0.85rem;
      margin: 0.25rem 0;
    }
    .countdown {
      color: #f5a623;
      font-size: 1.4rem;
      font-weight: 700;
      text-align: center;
      margin: 0.5rem 0;
    }
  `;
  document.head.appendChild(style);
}

// ─── Util ─────────────────────────────────────────────────────────────────────

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
