import {
  GRID_COLS,
  GRID_ROWS,
  TILE_SIZE,
  LATENCY_PING_INTERVAL_MS,
  RoomStatus,
} from '@bombermp/shared';
import type { RoomState } from '@bombermp/shared';
import { socket, getOrCreatePlayerId, getStoredDisplayName, setStoredDisplayName } from './socket/client.js';
import { ClientGameState } from './game/state.js';
import { InputHandler } from './game/input.js';
import { render, clearExplosionTimestamps } from './game/renderer.js';
import { loadSprites } from './game/sprites.js';
import {
  showLobby,
  showLobbyError,
  showWaitingRoom,
  showGameOver,
  hideUI,
  showUI,
} from './ui/index.js';
import {
  initHUD,
  showHUD,
  hideHUD,
  updateHUDStats,
  updateHUDLatency,
} from './ui/hud.js';

// ─── DOM setup ────────────────────────────────────────────────────────────────

const gameWrapper = document.getElementById('game-wrapper') as HTMLDivElement;
const canvas      = document.getElementById('game-canvas')  as HTMLCanvasElement;
const uiRoot      = document.getElementById('ui-root')       as HTMLDivElement;

if (!gameWrapper || !canvas || !uiRoot) throw new Error('Required DOM elements not found');

const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Failed to get 2D rendering context');

// Canvas covers only the game grid — HUD lives in DOM above it
canvas.width  = GRID_COLS * TILE_SIZE;
canvas.height = GRID_ROWS * TILE_SIZE;

// ─── State ────────────────────────────────────────────────────────────────────

const myPlayerId  = getOrCreatePlayerId();
const gameState   = new ClientGameState();
const input       = new InputHandler();
const playerSlotMap = new Map<string, number>();

let rtt            = 0;
let rafId: number | null = null;
let lastRoomState: RoomState | null = null;

// ─── Hash utilities ───────────────────────────────────────────────────────────

function setRoomHash(roomId: string): void {
  history.replaceState(null, '', `#r${roomId}`);
}

function clearRoomHash(): void {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

function getRoomIdFromHash(): string | null {
  const m = window.location.hash.match(/^#r([A-Z0-9]{1,16})$/i);
  return m ? m[1]!.toUpperCase() : null;
}

// ─── Game view show / hide ────────────────────────────────────────────────────

function showGameView(): void {
  gameWrapper.style.display = 'flex';
  hideUI(uiRoot);
  showHUD();
}

function hideGameView(): void {
  gameWrapper.style.display = 'none';
  hideHUD();
}

// ─── Render loop ──────────────────────────────────────────────────────────────

function startRenderLoop(): void {
  if (rafId !== null) return;
  function frame(): void {
    const state = gameState.state;
    if (state) render(ctx!, state, myPlayerId, playerSlotMap);
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
}

function stopRenderLoop(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

// ─── Player slot map ─────────────────────────────────────────────────────────

function buildSlotMap(roomState: RoomState): void {
  playerSlotMap.clear();
  for (const p of roomState.players) {
    if (!playerSlotMap.has(p.id)) playerSlotMap.set(p.id, playerSlotMap.size);
  }
}

// ─── Socket events ────────────────────────────────────────────────────────────

socket.on('room:state', (state: RoomState) => {
  lastRoomState = state;
  buildSlotMap(state);
  setRoomHash(state.roomId);

  switch (state.status) {
    case RoomStatus.WAITING:
    case RoomStatus.STARTING:
      stopRenderLoop();
      hideGameView();
      input.detach(document);
      gameState.reset();
      clearExplosionTimestamps();
      showUI(uiRoot);
      showWaitingRoom(
        uiRoot,
        state,
        myPlayerId,
        () => socket.emit('room:start'),
        () => {
          socket.emit('room:leave');
          clearRoomHash();
          showLobby(uiRoot, onCreateRoom, onJoinRoom);
        },
      );
      if (state.status === RoomStatus.STARTING && state.countdownEndsAt) {
        tickCountdown(state.countdownEndsAt, state);
      }
      break;

    case RoomStatus.IN_GAME:
      if (state.gameState && state.gameState.players[myPlayerId]) {
        gameState.init(state.gameState);
        showGameView();
        input.attach(document);
        startRenderLoop();
      } else {
        // Rejoined mid-game after refresh — show waiting room as spectator
        stopRenderLoop();
        hideGameView();
        input.detach(document);
        gameState.reset();
        clearExplosionTimestamps();
        showUI(uiRoot);
        showWaitingRoom(
          uiRoot,
          state,
          myPlayerId,
          () => socket.emit('room:start'),
          () => {
            socket.emit('room:leave');
            clearRoomHash();
            showLobby(uiRoot, onCreateRoom, onJoinRoom);
          },
          true, // gameInProgress
        );
      }
      break;

    case RoomStatus.GAME_OVER:
      break;
  }
});

socket.on('game:tick', (diff) => {
  gameState.applyDiff(diff);
  socket.emit('player:input', input.getCurrentInput());

  // Update HUD text with latest player stats
  const me = gameState.state?.players[myPlayerId];
  if (me) updateHUDStats(me.activeBombs, me.maxBombs, me.blastRadius);
});

socket.on('game:over', ({ winnerId }) => {
  stopRenderLoop();
  input.detach(document);
  showGameOver(uiRoot, winnerId, gameState.state?.players ?? {});
});

socket.on('latency:pong', ({ clientTime }: { clientTime: number }) => {
  rtt = Date.now() - clientTime;
  updateHUDLatency(rtt);
});

socket.on('error', ({ message }: { message: string }) => {
  console.error('[server error]', message);
  if (getRoomIdFromHash()) clearRoomHash();
  showLobbyError(uiRoot, message);
});

socket.on('connect', () => {
  console.log('[socket] connected:', socket.id);
});

socket.on('disconnect', (reason) => {
  console.warn('[socket] disconnected:', reason);
  stopRenderLoop();
  input.detach(document);
  hideGameView();
  showLobby(uiRoot, onCreateRoom, onJoinRoom);
});

// ─── Latency ping ─────────────────────────────────────────────────────────────

setInterval(() => {
  if (socket.connected) socket.emit('latency:ping', { clientTime: Date.now() });
}, LATENCY_PING_INTERVAL_MS);

// ─── Lobby callbacks ──────────────────────────────────────────────────────────

function onCreateRoom(name: string): void {
  setStoredDisplayName(name);
  socket.emit('room:create', { displayName: name });
}

function onJoinRoom(roomId: string, name: string): void {
  setStoredDisplayName(name);
  socket.emit('room:join', { roomId, displayName: name });
}

// ─── Countdown ticker ─────────────────────────────────────────────────────────

function tickCountdown(endsAt: number, cachedState: RoomState): void {
  const interval = setInterval(() => {
    if (lastRoomState !== cachedState) { clearInterval(interval); return; }
    const secsLeft = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    const el = uiRoot.querySelector<HTMLSpanElement>('.bmp-countdown');
    if (el) el.textContent = String(secsLeft);
    if (secsLeft <= 0) clearInterval(interval);
  }, 250);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

// Build the HUD DOM once (it persists across game rounds)
initHUD(gameWrapper);

// Load sprites in the background — renderer falls back to canvas primitives
// until they arrive so the lobby is never blocked
void loadSprites();

const hashRoomId  = getRoomIdFromHash();
const storedName  = getStoredDisplayName();

if (hashRoomId && storedName) {
  socket.once('connect', () => {
    socket.emit('room:join', { roomId: hashRoomId, displayName: storedName });
  });
  showLobby(uiRoot, onCreateRoom, onJoinRoom);
} else if (hashRoomId) {
  showLobby(uiRoot, onCreateRoom, onJoinRoom, hashRoomId);
} else {
  showLobby(uiRoot, onCreateRoom, onJoinRoom);
}
socket.connect();
