import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@bombermp/shared';

// ─── Player Identity ──────────────────────────────────────────────────────────

const PLAYER_ID_KEY = 'bombermp_player_id';

export function getOrCreatePlayerId(): string {
  const existing = localStorage.getItem(PLAYER_ID_KEY);
  if (existing) return existing;

  // Generate a UUID v4 without a library
  const id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  localStorage.setItem(PLAYER_ID_KEY, id);
  return id;
}

// ─── Display Name ─────────────────────────────────────────────────────────────

const DISPLAY_NAME_KEY = 'bombermp_display_name';

export function getStoredDisplayName(): string | null {
  return localStorage.getItem(DISPLAY_NAME_KEY);
}

export function setStoredDisplayName(name: string): void {
  localStorage.setItem(DISPLAY_NAME_KEY, name);
}

// ─── Socket lifecycle ─────────────────────────────────────────────────────────

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let activeSocket: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (!activeSocket) throw new Error('No active socket — call connectToServer first');
  return activeSocket;
}

export function connectToServer(url: string): AppSocket {
  if (activeSocket) {
    activeSocket.removeAllListeners();
    activeSocket.disconnect();
  }
  activeSocket = io(url, {
    autoConnect: false,
    withCredentials: true,
    transports: ['websocket', 'polling'],
    auth: { playerId: getOrCreatePlayerId() },
  });
  return activeSocket;
}
