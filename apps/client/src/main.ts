import {
  GRID_COLS,
  GRID_ROWS,
  TILE_SIZE,
  LATENCY_PING_INTERVAL_MS,
  RoomStatus,
} from '@bombermp/shared';
import type { RoomState } from '@bombermp/shared';
import { socket, getOrCreatePlayerId } from './socket/client.js';
import { ClientGameState } from './game/state.js';
import { InputHandler } from './game/input.js';
import { render } from './game/renderer.js';
import {
  showLobby,
  showLobbyError,
  showWaitingRoom,
  showGameOver,
  hideUI,
  showUI,
} from './ui/index.js';

// ─── DOM setup ────────────────────────────────────────────────────────────────

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLDivElement;

if (!canvas || !uiRoot) throw new Error('Required DOM elements not found');

const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Failed to get 2D rendering context');

const HUD_HEIGHT = 36;
canvas.width  = GRID_COLS * TILE_SIZE;
canvas.height = GRID_ROWS * TILE_SIZE + HUD_HEIGHT;

// ─── State ────────────────────────────────────────────────────────────────────

const myPlayerId = getOrCreatePlayerId();
const gameState  = new ClientGameState();
const input      = new InputHandler();

// Map from playerId → spawn slot index (for player colors)
const playerSlotMap = new Map<string, number>();

let rtt = 0;
let rafId: number | null = null;
let lastRoomState: RoomState | null = null;

// ─── Canvas show/hide ─────────────────────────────────────────────────────────

function showCanvas(): void {
  canvas.style.display = 'block';
  hideUI(uiRoot);
}

function hideCanvas(): void {
  canvas.style.display = 'none';
}

// ─── Render loop ──────────────────────────────────────────────────────────────

function startRenderLoop(): void {
  if (rafId !== null) return;
  function frame(): void {
    const state = gameState.state;
    if (state) render(ctx!, state, myPlayerId, playerSlotMap, rtt);
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
    // RoomPlayers don't carry spawnIndex — use insertion order as a proxy
    if (!playerSlotMap.has(p.id)) {
      playerSlotMap.set(p.id, playerSlotMap.size);
    }
  }
}

// ─── Socket events ────────────────────────────────────────────────────────────

socket.on('room:state', (state: RoomState) => {
  lastRoomState = state;
  buildSlotMap(state);

  switch (state.status) {
    case RoomStatus.WAITING:
    case RoomStatus.STARTING:
      stopRenderLoop();
      hideCanvas();
      input.detach(document);
      gameState.reset();
      showUI(uiRoot);
      showWaitingRoom(
        uiRoot,
        state,
        myPlayerId,
        () => socket.emit('room:start'),
        () => {
          socket.emit('room:leave');
          showLobby(uiRoot, onCreateRoom, onJoinRoom);
        },
      );
      // If STARTING, tick the countdown display every second
      if (state.status === RoomStatus.STARTING && state.countdownEndsAt) {
        tickCountdown(state.countdownEndsAt, state);
      }
      break;

    case RoomStatus.IN_GAME:
      if (state.gameState) {
        gameState.init(state.gameState);
        showCanvas();
        input.attach(document);
        startRenderLoop();
      }
      break;

    case RoomStatus.GAME_OVER:
      // game:over fires before this usually; handled there
      break;
  }
});

socket.on('game:tick', (diff) => {
  gameState.applyDiff(diff);
  // Emit current input on every tick (naturally synced to server 20 TPS)
  const currentInput = input.getCurrentInput();
  socket.emit('player:input', currentInput);
});

socket.on('game:over', ({ winnerId }) => {
  stopRenderLoop();
  input.detach(document);

  const players = gameState.state?.players ?? {};
  showGameOver(uiRoot, winnerId, players);
  // Canvas keeps showing the final frame briefly; room:state WAITING cleans up
});

socket.on('latency:pong', ({ clientTime }) => {
  rtt = Date.now() - clientTime;
});

socket.on('error', ({ message }) => {
  console.error('[server error]', message);
  showLobbyError(uiRoot, message);
});

socket.on('connect', () => {
  console.log('[socket] connected:', socket.id);
});

socket.on('disconnect', (reason) => {
  console.warn('[socket] disconnected:', reason);
  stopRenderLoop();
  input.detach(document);
  hideCanvas();
  showLobby(uiRoot, onCreateRoom, onJoinRoom);
});

// ─── Latency ping ─────────────────────────────────────────────────────────────

setInterval(() => {
  if (socket.connected) {
    socket.emit('latency:ping', { clientTime: Date.now() });
  }
}, LATENCY_PING_INTERVAL_MS);

// ─── Lobby callbacks ──────────────────────────────────────────────────────────

function onCreateRoom(name: string): void {
  socket.emit('room:create', { displayName: name });
}

function onJoinRoom(roomId: string, name: string): void {
  socket.emit('room:join', { roomId, displayName: name });
}

// ─── Countdown ticker ─────────────────────────────────────────────────────────

function tickCountdown(endsAt: number, cachedState: RoomState): void {
  const interval = setInterval(() => {
    // Stop if we've moved on (different room state arrived)
    if (lastRoomState !== cachedState) { clearInterval(interval); return; }

    const secsLeft = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    const countdownEl = uiRoot.querySelector<HTMLParagraphElement>('.countdown');
    if (countdownEl) {
      countdownEl.textContent = `Starting in ${secsLeft}…`;
    }
    if (secsLeft <= 0) clearInterval(interval);
  }, 250);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

showLobby(uiRoot, onCreateRoom, onJoinRoom);
socket.connect();
