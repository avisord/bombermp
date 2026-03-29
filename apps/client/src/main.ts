import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@bombermp/shared';
import { LATENCY_PING_INTERVAL_MS } from '@bombermp/shared';

// ─── Canvas Setup ─────────────────────────────────────────────────────────────

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const uiRoot = document.getElementById('ui-root') as HTMLDivElement | null;

if (!canvas || !uiRoot) {
  throw new Error('Required DOM elements not found');
}

const ctx = canvas.getContext('2d');
if (!ctx) {
  throw new Error('Failed to get 2D rendering context');
}

// ─── Socket Setup ─────────────────────────────────────────────────────────────

const WS_URL = import.meta.env['VITE_WS_URL'] ?? 'http://localhost:3001';

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(WS_URL, {
  autoConnect: false,
  withCredentials: true,
  transports: ['websocket', 'polling'],
});

// ─── Socket Events ────────────────────────────────────────────────────────────

socket.on('connect', () => {
  console.log('[socket] connected:', socket.id);
  const statusEl = uiRoot.querySelector('p');
  if (statusEl) statusEl.textContent = 'Connected — lobby coming soon';
});

socket.on('disconnect', (reason) => {
  console.warn('[socket] disconnected:', reason);
  const statusEl = uiRoot.querySelector('p');
  if (statusEl) statusEl.textContent = 'Disconnected — reconnecting…';
});

socket.on('connect_error', (err) => {
  console.error('[socket] connection error:', err.message);
});

socket.on('latency:pong', ({ clientTime, serverTime }) => {
  const rtt = Date.now() - clientTime;
  console.debug(`[latency] RTT=${rtt}ms  serverTime=${serverTime}`);
});

socket.on('error', ({ message }) => {
  console.error('[server error]', message);
});

// ─── Latency Ping ─────────────────────────────────────────────────────────────

setInterval(() => {
  if (socket.connected) {
    socket.emit('latency:ping', { clientTime: Date.now() });
  }
}, LATENCY_PING_INTERVAL_MS);

// ─── Connect ──────────────────────────────────────────────────────────────────

socket.connect();
