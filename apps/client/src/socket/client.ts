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

// ─── Socket instance ──────────────────────────────────────────────────────────

const WS_URL = (import.meta.env['VITE_WS_URL'] as string | undefined) ?? 'http://localhost:3001';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(WS_URL, {
  autoConnect: false,
  withCredentials: true,
  transports: ['websocket', 'polling'],
  auth: { playerId: getOrCreatePlayerId() },
});
