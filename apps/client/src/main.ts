import {
  GRID_COLS,
  GRID_ROWS,
  TILE_SIZE,
  LATENCY_PING_INTERVAL_MS,
  EXPLOSION_DURATION_MS,
  RoomStatus,
  Direction,
} from '@bombermp/shared';
import type { RoomState } from '@bombermp/shared';
import { socket, getOrCreatePlayerId, getStoredDisplayName, setStoredDisplayName } from './socket/client.js';
import { loadAppearance, saveAppearance } from './game/appearance.js';
import type { PlayerAppearance } from './game/appearance.js';
import { showCustomize } from './ui/customize.js';
import { ClientGameState } from './game/state.js';
import { InputHandler } from './game/input.js';
import { render, clearExplosionTimestamps } from './game/renderer.js';
import { LocalPlayerPredictor } from './game/prediction.js';
import { loadSprites } from './game/sprites.js';
import {
  showLobby,
  showLobbyError,
  showWaitingRoom,
  showGameOver,
  updatePublicRoomsList,
  hideUI,
  showUI,
} from './ui/index.js';
import type { ShowLobbyOptions } from './ui/index.js';
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

const isTestMode  = window.location.pathname === '/test-game';
const myPlayerId  = getOrCreatePlayerId();
const gameState   = new ClientGameState();
const input       = new InputHandler();
const predictor   = new LocalPlayerPredictor();
const playerSlotMap = new Map<string, number>();

let rtt            = 0;
let rafId: number | null = null;
let lastRoomState: RoomState | null = null;

// ─── Appearance & direction ────────────────────────────────────────────────────
let myAppearance: PlayerAppearance = loadAppearance();
const playerDirections = new Map<string, Direction>();
const playerPrevPixel  = new Map<string, { x: number; y: number }>();

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
  function frame(nowMs: number): void {
    const state = gameState.state;
    if (state) {
      const me = state.players[myPlayerId];
      if (me) predictor.advance(input.currentDir, me.speedMultiplier, state.grid, nowMs);
      const predicted = predictor.isActive ? { x: predictor.x, y: predictor.y } : null;
      render(ctx!, state, myPlayerId, playerSlotMap, predicted, playerDirections, myAppearance);
    }
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
      predictor.reset();
      clearExplosionTimestamps();
      playerDirections.clear();
      playerPrevPixel.clear();
      showUI(uiRoot);

      if (isTestMode) {
        // Auto-start immediately, skipping the countdown entirely
        uiRoot.innerHTML = '<p style="color:#64748B;font-family:sans-serif;text-align:center;padding:2rem">Setting up game\u2026</p>';
        socket.emit('room:start', { skipCountdown: true });
        break;
      }

      showWaitingRoom(
        uiRoot,
        state,
        myPlayerId,
        () => socket.emit('room:start'),
        () => {
          socket.emit('room:leave');
          clearRoomHash();
          showLobby(uiRoot, makeLobbyOptions());
        },
        onConfigure,
      );
      if (state.status === RoomStatus.STARTING && state.countdownEndsAt) {
        tickCountdown(state.countdownEndsAt, state);
      }
      break;

    case RoomStatus.IN_GAME:
      if (state.gameState && state.gameState.players[myPlayerId]) {
        const me = state.gameState.players[myPlayerId]!;
        gameState.init(state.gameState);
        predictor.init(me.pixelX, me.pixelY);
        showGameView();
        input.attach(document);
        startRenderLoop();
      } else {
        // Rejoined mid-game after refresh — show waiting room as spectator
        stopRenderLoop();
        hideGameView();
        input.detach(document);
        gameState.reset();
        predictor.reset();
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
            showLobby(uiRoot, makeLobbyOptions());
          },
          onConfigure,
          true, // gameInProgress
        );
      }
      break;

    case RoomStatus.GAME_OVER:
      break;
  }
});

socket.on('game:tick', (diff) => {
  // Register any new bombs placed by the local player as passable before applying
  // the diff (the grid update arrives in the same diff, so we need to mark it
  // passable before the predictor sees the BOMB tile).
  if (diff.bombs) {
    for (const bomb of Object.values(diff.bombs)) {
      // Mark passable if: (a) local player placed it, or (b) the bomb spawned
      // on a tile the local player's hitbox already overlaps (opponent placed it
      // while we were standing there — server mirrors this logic server-side).
      if (bomb.ownerId === myPlayerId || predictor.overlapsNewBomb(bomb.position.x, bomb.position.y)) {
        predictor.addPassableBomb(bomb.position.x, bomb.position.y);
      }
    }
  }

  gameState.applyDiff(diff);
  socket.emit('player:input', input.getCurrentInput());

  // Update facing directions from position deltas
  const allPlayers = gameState.state?.players;
  if (allPlayers) {
    for (const [id, player] of Object.entries(allPlayers)) {
      const prev = playerPrevPixel.get(id);
      if (prev) {
        const dx = player.pixelX - prev.x;
        const dy = player.pixelY - prev.y;
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
          playerDirections.set(id,
            Math.abs(dx) >= Math.abs(dy)
              ? (dx > 0 ? Direction.RIGHT : Direction.LEFT)
              : (dy > 0 ? Direction.DOWN  : Direction.UP),
          );
        }
      }
      playerPrevPixel.set(id, { x: player.pixelX, y: player.pixelY });
    }
  }
  // Local player: live input direction is more responsive than position delta
  const liveDir = input.currentDir;
  if (liveDir !== null) playerDirections.set(myPlayerId, liveDir);

  // Reconcile predictor with authoritative server position
  const me = gameState.state?.players[myPlayerId];
  if (me) {
    predictor.reconcile(me.pixelX, me.pixelY);
    updateHUDStats(me.activeBombs, me.maxBombs, me.blastRadius);
  }
});

socket.on('game:over', ({ winnerId }) => {
  // Stop inputs and prediction immediately — player can no longer act.
  input.detach(document);
  predictor.reset();

  // Keep the render loop alive long enough for the explosion animation to finish,
  // then freeze the canvas and show the game over overlay.
  const players = { ...gameState.state?.players };
  setTimeout(() => {
    stopRenderLoop();
    showGameOver(uiRoot, winnerId, players);
  }, EXPLOSION_DURATION_MS + 100);
});

socket.on('rooms:list', ({ rooms }) => {
  updatePublicRoomsList(uiRoot, rooms);
});

socket.on('latency:pong', ({ clientTime }: { clientTime: number }) => {
  rtt = Date.now() - clientTime;
  updateHUDLatency(rtt);
});

socket.on('error', ({ message }: { message: string }) => {
  console.error('[server error]', message);
  if (isTestMode) {
    uiRoot.innerHTML = `<p style="color:#DC2626;font-family:sans-serif;text-align:center;padding:2rem">Error: ${message}</p>`;
    return;
  }
  if (getRoomIdFromHash()) clearRoomHash();
  showLobbyError(uiRoot, message);
});

socket.on('connect', () => {
  console.log('[socket] connected:', socket.id);
  socket.emit('room:list');
});

socket.on('disconnect', (reason) => {
  console.warn('[socket] disconnected:', reason);
  stopRenderLoop();
  input.detach(document);
  hideGameView();
  if (isTestMode) {
    uiRoot.innerHTML = '<p style="color:#64748B;font-family:sans-serif;text-align:center;padding:2rem">Disconnected. Reconnecting\u2026</p>';
  } else {
    showLobby(uiRoot, makeLobbyOptions());
  }
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

function onJoinPublicRoom(roomId: string, name: string): void {
  setStoredDisplayName(name);
  socket.emit('room:join', { roomId, displayName: name });
}

function onConfigure(isPublic: boolean): void {
  socket.emit('room:configure', { isPublic });
}

function makeLobbyOptions(prefillRoomId?: string): ShowLobbyOptions {
  const opts: ShowLobbyOptions = {
    storedName: getStoredDisplayName(),
    onCreate: onCreateRoom,
    onJoinPrivate: onJoinRoom,
    onJoinPublic: onJoinPublicRoom,
    onRequestRoomList: () => { if (socket.connected) socket.emit('room:list'); },
    onCustomize,
  };
  if (prefillRoomId !== undefined) opts.prefillRoomId = prefillRoomId;
  return opts;
}

function onCustomize(): void {
  showCustomize(uiRoot, myAppearance, 0, (newAppearance) => {
    myAppearance = newAppearance;
    saveAppearance(newAppearance);
    showLobby(uiRoot, makeLobbyOptions());
  });
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

if (isTestMode) {
  const name = storedName || 'TestPlayer';
  uiRoot.innerHTML = '<p style="color:#64748B;font-family:sans-serif;text-align:center;padding:2rem">Connecting\u2026</p>';
  socket.once('connect', () => {
    setStoredDisplayName(name);
    socket.emit('room:create', { displayName: name });
  });
} else if (hashRoomId && storedName) {
  socket.once('connect', () => {
    socket.emit('room:join', { roomId: hashRoomId, displayName: storedName });
  });
  showLobby(uiRoot, makeLobbyOptions());
} else if (hashRoomId) {
  showLobby(uiRoot, makeLobbyOptions(hashRoomId));
} else {
  showLobby(uiRoot, makeLobbyOptions());
}
socket.connect();
