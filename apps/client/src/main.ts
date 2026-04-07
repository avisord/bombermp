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
import {
  getOrCreatePlayerId,
  getStoredDisplayName,
  setStoredDisplayName,
  connectToServer,
} from './socket/client.js';
import type { AppSocket } from './socket/client.js';
import { fetchServerList, pingServer, pingAllServers } from './socket/servers.js';
import type { ServerInfo } from './socket/servers.js';
import { loadAppearance, saveAppearance } from './game/appearance.js';
import type { PlayerAppearance } from './game/appearance.js';
import { showCustomize } from './ui/customize.js';
import { ClientGameState } from './game/state.js';
import { InputHandler } from './game/input.js';
import { render, clearExplosionTimestamps } from './game/renderer.js';
import { LocalPlayerPredictor } from './game/prediction.js';
import type { OtherPlayerPos } from './game/prediction.js';
import { RemotePlayerInterpolator } from './game/interpolation.js';
import { loadSprites } from './game/sprites.js';
import {
  showLobby,
  showLobbyError,
  showWaitingRoom,
  showGameOver,
  showServerSelect,
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
const predictor     = new LocalPlayerPredictor();
const interpolator  = new RemotePlayerInterpolator();
const playerSlotMap = new Map<string, number>();

let rtt            = 0;
let rafId: number | null = null;
let lastRoomState: RoomState | null = null;
let socket: AppSocket | null = null;
let latencyInterval: ReturnType<typeof setInterval> | null = null;
let currentServerName: string | null = null;

// ─── Appearance & direction ────────────────────────────────────────────────────
let myAppearance: PlayerAppearance = loadAppearance();
const playerDirections = new Map<string, Direction>();
const playerPrevPixel  = new Map<string, { x: number; y: number }>();

// ─── Hash utilities ───────────────────────────────────────────────────────────

function setRoomHash(roomId: string): void {
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}#r${roomId}`);
}

function clearRoomHash(): void {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

function getRoomIdFromHash(): string | null {
  const m = window.location.hash.match(/^#r([A-Z0-9]{1,16})$/i);
  return m ? m[1]!.toUpperCase() : null;
}

// ─── Server slug URL persistence ──────────────────────────────────────────────

function getServerSlugFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('server');
}

function setServerSlug(slug: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('server', slug);
  history.replaceState(null, '', url.pathname + url.search + url.hash);
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
      if (me) {
        const others: OtherPlayerPos[] = [];
        for (const [id, p] of Object.entries(state.players)) {
          if (id !== myPlayerId) others.push(p);
        }
        predictor.advance(input.currentDir, me.speedMultiplier, state.grid, nowMs, others);
      }
      const predicted = predictor.isActive ? { x: predictor.x, y: predictor.y } : null;

      // Build interpolated positions for remote players
      const interpPositions = new Map<string, { x: number; y: number }>();
      for (const id of Object.keys(state.players)) {
        if (id === myPlayerId) continue;
        const pos = interpolator.getPosition(id, nowMs);
        if (pos) interpPositions.set(id, pos);
      }

      render(ctx!, state, myPlayerId, playerSlotMap, predicted, playerDirections, myAppearance, interpPositions);
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

// ─── Socket event registration ───────────────────────────────────────────────

function registerSocketHandlers(sock: AppSocket): void {
  sock.on('room:state', (state: RoomState) => {
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
        interpolator.reset();
        clearExplosionTimestamps();
        playerDirections.clear();
        playerPrevPixel.clear();
        showUI(uiRoot);

        if (isTestMode) {
          uiRoot.innerHTML = '<p style="color:#64748B;font-family:sans-serif;text-align:center;padding:2rem">Setting up game\u2026</p>';
          sock.emit('room:start', { skipCountdown: true });
          break;
        }

        showWaitingRoom(
          uiRoot,
          state,
          myPlayerId,
          () => sock.emit('room:start'),
          () => {
            sock.emit('room:leave');
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
          stopRenderLoop();
          hideGameView();
          input.detach(document);
          gameState.reset();
          predictor.reset();
          interpolator.reset();
          clearExplosionTimestamps();
          showUI(uiRoot);
          showWaitingRoom(
            uiRoot,
            state,
            myPlayerId,
            () => sock.emit('room:start'),
            () => {
              sock.emit('room:leave');
              clearRoomHash();
              showLobby(uiRoot, makeLobbyOptions());
            },
            onConfigure,
            true,
          );
        }
        break;

      case RoomStatus.GAME_OVER:
        break;
    }
  });

  sock.on('game:tick', (diff) => {
    if (diff.bombs) {
      for (const bomb of Object.values(diff.bombs)) {
        if (bomb.ownerId === myPlayerId || predictor.overlapsNewBomb(bomb.position.x, bomb.position.y)) {
          predictor.addPassableBomb(bomb.position.x, bomb.position.y);
        }
      }
    }

    if (gameState.state?.players) {
      interpolator.onTick(gameState.state.players, diff.players);
    }

    gameState.applyDiff(diff);
    sock.emit('player:input', input.getCurrentInput());

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
    const liveDir = input.currentDir;
    if (liveDir !== null) playerDirections.set(myPlayerId, liveDir);

    const me = gameState.state?.players[myPlayerId];
    if (me) {
      predictor.reconcile(me.pixelX, me.pixelY);
      updateHUDStats(me.activeBombs, me.maxBombs, me.blastRadius);
    }
  });

  sock.on('game:over', ({ winnerId }) => {
    input.detach(document);
    predictor.reset();

    const players = { ...gameState.state?.players };
    setTimeout(() => {
      stopRenderLoop();
      showGameOver(uiRoot, winnerId, players);
    }, EXPLOSION_DURATION_MS + 100);
  });

  sock.on('rooms:list', ({ rooms }) => {
    updatePublicRoomsList(uiRoot, rooms);
  });

  sock.on('latency:pong', ({ clientTime }: { clientTime: number }) => {
    rtt = Date.now() - clientTime;
    updateHUDLatency(rtt);
  });

  sock.on('error', ({ message }: { message: string }) => {
    console.error('[server error]', message);
    if (isTestMode) {
      uiRoot.innerHTML = `<p style="color:#DC2626;font-family:sans-serif;text-align:center;padding:2rem">Error: ${message}</p>`;
      return;
    }
    if (getRoomIdFromHash()) clearRoomHash();
    showLobbyError(uiRoot, message);
  });

  sock.on('connect', () => {
    console.log('[socket] connected:', sock.id);
    sock.emit('room:list');
  });

  sock.on('disconnect', (reason) => {
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

  // Latency ping
  if (latencyInterval !== null) clearInterval(latencyInterval);
  latencyInterval = setInterval(() => {
    if (sock.connected) sock.emit('latency:ping', { clientTime: Date.now() });
  }, LATENCY_PING_INTERVAL_MS);
}

// ─── Connect to a server and wire everything up ──────────────────────────────

function switchToServer(server: ServerInfo): void {
  currentServerName = server.name;
  setServerSlug(server.slug);
  socket = connectToServer(server.url);
  registerSocketHandlers(socket);
}

// ─── Lobby callbacks ──────────────────────────────────────────────────────────

function onCreateRoom(name: string): void {
  setStoredDisplayName(name);
  socket!.emit('room:create', { displayName: name });
}

function onJoinRoom(roomId: string, name: string): void {
  setStoredDisplayName(name);
  socket!.emit('room:join', { roomId, displayName: name });
}

function onJoinPublicRoom(roomId: string, name: string): void {
  setStoredDisplayName(name);
  socket!.emit('room:join', { roomId, displayName: name });
}

function onConfigure(isPublic: boolean): void {
  socket!.emit('room:configure', { isPublic });
}

function makeLobbyOptions(prefillRoomId?: string): ShowLobbyOptions {
  const opts: ShowLobbyOptions = {
    storedName: getStoredDisplayName(),
    appearance: myAppearance,
    onCreate: onCreateRoom,
    onJoinPrivate: onJoinRoom,
    onJoinPublic: onJoinPublicRoom,
    onRequestRoomList: () => { if (socket?.connected) socket.emit('room:list'); },
    onNameSave: setStoredDisplayName,
    onCustomize,
    serverName: currentServerName ?? undefined,
    onServerChange: showServerSelectScreen,
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

// ─── Server select screen ────────────────────────────────────────────────────

function showServerSelectScreen(): void {
  // Disconnect if currently connected
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  if (latencyInterval !== null) {
    clearInterval(latencyInterval);
    latencyInterval = null;
  }
  stopRenderLoop();
  hideGameView();
  input.detach(document);

  showServerSelect(uiRoot, {
    onServerSelected: (server) => {
      switchToServer(server);
      const hashRoomId = getRoomIdFromHash();
      const storedName = getStoredDisplayName();

      if (isTestMode) {
        const name = storedName || 'TestPlayer';
        uiRoot.innerHTML = '<p style="color:#64748B;font-family:sans-serif;text-align:center;padding:2rem">Connecting\u2026</p>';
        socket!.once('connect', () => {
          setStoredDisplayName(name);
          socket!.emit('room:create', { displayName: name });
        });
      } else if (hashRoomId && storedName) {
        socket!.once('connect', () => {
          socket!.emit('room:join', { roomId: hashRoomId, displayName: storedName });
        });
        showLobby(uiRoot, makeLobbyOptions());
      } else if (hashRoomId) {
        showLobby(uiRoot, makeLobbyOptions(hashRoomId));
      } else {
        showLobby(uiRoot, makeLobbyOptions());
      }
      socket!.connect();
    },
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

initHUD(gameWrapper);
void loadSprites();

async function boot(): Promise<void> {
  const servers = await fetchServerList();
  const slugFromUrl = getServerSlugFromUrl();

  // If a server is persisted in URL, try to connect directly
  if (slugFromUrl) {
    const match = servers.find((s) => s.slug === slugFromUrl);
    if (match) {
      const status = await pingServer(match);
      if (status.online) {
        switchToServer(match);
        const hashRoomId = getRoomIdFromHash();
        const storedName = getStoredDisplayName();

        if (isTestMode) {
          const name = storedName || 'TestPlayer';
          uiRoot.innerHTML = '<p style="color:#64748B;font-family:sans-serif;text-align:center;padding:2rem">Connecting\u2026</p>';
          socket!.once('connect', () => {
            setStoredDisplayName(name);
            socket!.emit('room:create', { displayName: name });
          });
        } else if (hashRoomId && storedName) {
          socket!.once('connect', () => {
            socket!.emit('room:join', { roomId: hashRoomId, displayName: storedName });
          });
          showLobby(uiRoot, makeLobbyOptions());
        } else if (hashRoomId) {
          showLobby(uiRoot, makeLobbyOptions(hashRoomId));
        } else {
          showLobby(uiRoot, makeLobbyOptions());
        }
        socket!.connect();
        return;
      }
    }
  }

  // If only one server, skip selection and connect directly
  if (servers.length === 1) {
    const only = servers[0]!;
    switchToServer(only);
    const hashRoomId = getRoomIdFromHash();
    const storedName = getStoredDisplayName();

    if (isTestMode) {
      const name = storedName || 'TestPlayer';
      uiRoot.innerHTML = '<p style="color:#64748B;font-family:sans-serif;text-align:center;padding:2rem">Connecting\u2026</p>';
      socket!.once('connect', () => {
        setStoredDisplayName(name);
        socket!.emit('room:create', { displayName: name });
      });
    } else if (hashRoomId && storedName) {
      socket!.once('connect', () => {
        socket!.emit('room:join', { roomId: hashRoomId, displayName: storedName });
      });
      showLobby(uiRoot, makeLobbyOptions());
    } else if (hashRoomId) {
      showLobby(uiRoot, makeLobbyOptions(hashRoomId));
    } else {
      showLobby(uiRoot, makeLobbyOptions());
    }
    socket!.connect();
    return;
  }

  // Multiple servers — show selection screen
  showServerSelectScreen();
}

void boot();
