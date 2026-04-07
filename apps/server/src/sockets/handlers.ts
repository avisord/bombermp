import { validate as validateUUID } from 'uuid';
import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@bombermp/shared';
import { RoomManager } from '../rooms/RoomManager.js';
import { PlayerModel } from '../db/models/Player.js';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function registerHandlers(io: IoServer): RoomManager {
  const roomManager = new RoomManager(io);

  io.on('connection', (socket: IoSocket) => {
    // ── Validate player identity ──────────────────────────────────────────────
    const rawId = socket.handshake.auth['playerId'] as unknown;
    const playerId = typeof rawId === 'string' && validateUUID(rawId) ? rawId : null;

    if (!playerId) {
      socket.emit('error', { message: 'Invalid player identity. Please refresh.' });
      socket.disconnect(true);
      return;
    }

    socket.data.playerId = playerId;
    socket.data.roomId = null;
    socket.data.displayName = '';

    console.log(`[socket] connected: ${socket.id} player=${playerId}`);

    // ── room:create ───────────────────────────────────────────────────────────
    socket.on('room:create', ({ displayName, isPublic }) => {
      try {
        if (socket.data.roomId) {
          socket.emit('error', { message: 'Already in a room' });
          return;
        }
        const name = displayName.trim().slice(0, 32) || 'Player';
        socket.data.displayName = name;
        const publicFlag = isPublic ?? true;
        const state = roomManager.createRoom(playerId, name, socket.id, publicFlag);
        socket.data.roomId = state.roomId;
        void socket.join(state.roomId);
        socket.emit('room:state', state);
        upsertPlayer(playerId, name);
      } catch (err: unknown) {
        socket.emit('error', { message: errMsg(err, 'Failed to create room') });
      }
    });

    // ── room:join ─────────────────────────────────────────────────────────────
    socket.on('room:join', async ({ roomId, displayName }) => {
      try {
        if (socket.data.roomId) {
          socket.emit('error', { message: 'Already in a room' });
          return;
        }
        const name = displayName.trim().slice(0, 32) || 'Player';
        socket.data.displayName = name;
        const state = roomManager.joinRoom(roomId, playerId, name, socket.id);
        socket.data.roomId = state.roomId;
        await socket.join(state.roomId);
        io.to(state.roomId).emit('room:state', state);
        upsertPlayer(playerId, name);
      } catch (err: unknown) {
        socket.emit('error', { message: errMsg(err, 'Failed to join room') });
      }
    });

    // ── room:list ─────────────────────────────────────────────────────────────
    socket.on('room:list', () => {
      socket.emit('rooms:list', { rooms: roomManager.listPublicRooms() });
    });

    // ── room:configure ────────────────────────────────────────────────────────
    socket.on('room:configure', ({ isPublic }) => {
      try {
        const roomId = socket.data.roomId;
        if (!roomId) { socket.emit('error', { message: 'Not in a room' }); return; }
        roomManager.configureRoom(roomId, playerId, isPublic);
      } catch (err: unknown) {
        socket.emit('error', { message: errMsg(err, 'Failed to configure room') });
      }
    });

    // ── room:start ────────────────────────────────────────────────────────────
    socket.on('room:start', (payload) => {
      try {
        const roomId = socket.data.roomId;
        if (!roomId) { socket.emit('error', { message: 'Not in a room' }); return; }
        roomManager.startGame(roomId, playerId, payload?.skipCountdown === true);
      } catch (err: unknown) {
        socket.emit('error', { message: errMsg(err, 'Failed to start game') });
      }
    });

    // ── player:input (hot path — no try/catch) ────────────────────────────────
    socket.on('player:input', ({ dir, action }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      roomManager.queueInput(roomId, playerId, dir, action);
    });

    // ── room:leave ────────────────────────────────────────────────────────────
    socket.on('room:leave', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      void socket.leave(roomId);
      socket.data.roomId = null;
      roomManager.leaveRoom(roomId, playerId);
    });

    // ── latency:ping ──────────────────────────────────────────────────────────
    socket.on('latency:ping', ({ clientTime }) => {
      socket.emit('latency:pong', { clientTime, serverTime: Date.now() });
    });

    // ── disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnected: ${socket.id} player=${playerId} — ${reason}`);
      const roomId = socket.data.roomId;
      if (roomId) roomManager.leaveRoom(roomId, playerId);
    });
  });

  return roomManager;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function upsertPlayer(playerId: string, displayName: string): void {
  PlayerModel.findByIdAndUpdate(
    playerId,
    { $set: { displayName, lastSeen: new Date() } },
    { upsert: true },
  ).catch((err: unknown) => {
    console.error('[db] player upsert failed', err);
  });
}
