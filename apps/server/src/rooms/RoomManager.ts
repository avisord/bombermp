import { v4 as uuidv4 } from 'uuid';
import {
  COUNTDOWN_DURATION_MS,
  MAX_PLAYERS,
  RoomStatus,
  Direction,
} from '@bombermp/shared';
import type { RoomState, PublicRoomInfo } from '@bombermp/shared';
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from '@bombermp/shared';
import { GameEngine } from '../game/GameEngine.js';
import type { PlayerSlot } from '../game/GameEngine.js';
import { GameSessionModel } from '../db/models/GameSession.js';
import { isDbEnabled } from '../db/connection.js';
import { BotController } from '../bots/BotController.js';
import { pickBotName } from '../bots/botNames.js';
import { isBotDebugEnabled, botDebugRoom } from '../bots/debug.js';
import { eventLog, type ScopedLogger } from '../logging/event-log.js';
import type { Server } from 'socket.io';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

interface ServerRoomPlayer {
  playerId: string;
  displayName: string;
  socketId: string;
  spawnIndex: number;
  lateJoin: boolean; // joined after game was starting/in-progress
}

interface ServerRoom {
  roomId: string;
  status: RoomStatus;
  players: Map<string, ServerRoomPlayer>;
  creatorId: string;
  isPublic: boolean;
  countdownTimer: ReturnType<typeof setTimeout> | null;
  countdownEndsAt: number | null;
  engine: GameEngine | null;
  sessionId: string | null;
  /** Local event-log session id (always set during IN_GAME, independent of DB). */
  logSessionId: string | null;
  logger: ScopedLogger | null;
}

export class RoomManager {
  private rooms = new Map<string, ServerRoom>();
  private readonly io: IoServer;

  constructor(io: IoServer) {
    this.io = io;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  getTotalPlayerCount(): number {
    let total = 0;
    for (const room of this.rooms.values()) {
      total += room.players.size;
    }
    return total;
  }

  createRoom(playerId: string, displayName: string, socketId: string, isPublic = true): RoomState {
    const roomId = uuidv4().slice(0, 8).toUpperCase();
    const room: ServerRoom = {
      roomId,
      status: RoomStatus.WAITING,
      players: new Map(),
      creatorId: playerId,
      isPublic,
      countdownTimer: null,
      countdownEndsAt: null,
      engine: null,
      sessionId: null,
      logSessionId: null,
      logger: null,
    };
    room.players.set(playerId, { playerId, displayName, socketId, spawnIndex: 0, lateJoin: false });
    this.rooms.set(roomId, room);
    eventLog.logUnscoped('room.create', {
      roomId,
      playerId,
      data: { displayName, isPublic },
    });
    return this.toRoomState(room);
  }

  joinRoom(roomId: string, playerId: string, displayName: string, socketId: string): RoomState {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.status === RoomStatus.GAME_OVER) throw new Error('Room is not accepting players');
    if (room.players.size >= MAX_PLAYERS && !room.players.has(playerId)) throw new Error('Room is full');

    const lateJoin = room.status !== RoomStatus.WAITING;
    const spawnIndex = room.players.has(playerId)
      ? room.players.get(playerId)!.spawnIndex
      : this.assignSpawnIndex(room);
    room.players.set(playerId, { playerId, displayName, socketId, spawnIndex, lateJoin });
    const evt = { roomId, playerId, data: { displayName, lateJoin, spawnIndex } };
    if (room.logger) room.logger.log('room.join', evt);
    else eventLog.logUnscoped('room.join', evt);
    return this.toRoomState(room);
  }

  startGame(roomId: string, requesterId: string, skipCountdown = false): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.creatorId !== requesterId) throw new Error('Only the room creator can start the game');
    if (room.status !== RoomStatus.WAITING) throw new Error('Room is not in WAITING state');

    eventLog.logUnscoped('room.start', { roomId, playerId: requesterId, data: { skipCountdown } });

    if (skipCountdown) {
      room.status = RoomStatus.STARTING;
      room.countdownEndsAt = Date.now();
      this.io.to(roomId).emit('room:state', this.toRoomState(room));
      this.launchGame(room);
      return;
    }

    room.status = RoomStatus.STARTING;
    room.countdownEndsAt = Date.now() + COUNTDOWN_DURATION_MS;

    this.io.to(roomId).emit('room:state', this.toRoomState(room));

    room.countdownTimer = setTimeout(() => {
      this.launchGame(room);
    }, COUNTDOWN_DURATION_MS);
  }

  leaveRoom(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const leaveEvt = { roomId, playerId };
    if (room.logger) room.logger.log('room.leave', leaveEvt);
    else eventLog.logUnscoped('room.leave', leaveEvt);

    room.engine?.removePlayer(playerId);
    room.players.delete(playerId);

    // Cancel countdown if no players remain
    if (room.status === RoomStatus.STARTING && room.players.size < 1) {
      if (room.countdownTimer) clearTimeout(room.countdownTimer);
      room.countdownTimer = null;
      room.countdownEndsAt = null;
      room.status = RoomStatus.WAITING;
    }

    // Destroy room if empty
    if (room.players.size === 0) {
      if (room.countdownTimer) clearTimeout(room.countdownTimer);
      room.engine?.stop();
      this.rooms.delete(roomId);
      return;
    }

    // Transfer creator if the creator left
    if (room.creatorId === playerId) {
      const next = room.players.values().next().value as ServerRoomPlayer | undefined;
      if (next) room.creatorId = next.playerId;
    }

    this.io.to(roomId).emit('room:state', this.toRoomState(room));
  }

  listPublicRooms(): PublicRoomInfo[] {
    const result: PublicRoomInfo[] = [];
    for (const room of this.rooms.values()) {
      if (room.isPublic && room.status === RoomStatus.WAITING) {
        result.push({ roomId: room.roomId, playerCount: room.players.size, maxPlayers: MAX_PLAYERS });
      }
    }
    return result;
  }

  configureRoom(roomId: string, requesterId: string, isPublic: boolean): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.creatorId !== requesterId) throw new Error('Only the room creator can configure the room');
    room.isPublic = isPublic;
    eventLog.logUnscoped('room.configure', { roomId, playerId: requesterId, data: { isPublic } });
    this.io.to(roomId).emit('room:state', this.toRoomState(room));
  }

  queueInput(roomId: string, playerId: string, dir: Direction | null, action: 'bomb' | null): void {
    const room = this.rooms.get(roomId);
    if (!room?.engine) return;
    room.engine.queueInput(playerId, dir, action);
  }

  setEngineSpeed(roomId: string, speed: number): void {
    const room = this.rooms.get(roomId);
    if (!room?.engine) return;
    room.engine.setSpeed(speed);
  }

  stepEngine(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room?.engine) return;
    room.engine.step();
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private launchGame(room: ServerRoom): void {
    room.countdownTimer = null;
    room.countdownEndsAt = null;

    const humanSlots: PlayerSlot[] = [...room.players.values()]
      .filter((p) => !p.lateJoin)
      .map((p) => ({
        playerId: p.playerId,
        displayName: p.displayName,
        socketId: p.socketId,
        spawnIndex: p.spawnIndex,
      }));

    if (humanSlots.length < 1) {
      room.status = RoomStatus.WAITING;
      this.io.to(room.roomId).emit('room:state', this.toRoomState(room));
      return;
    }

    // Fill remaining spawn slots with bots
    const usedSpawns = new Set(humanSlots.map((s) => s.spawnIndex));
    const botSlots: PlayerSlot[] = [];
    for (let i = 0; i < 4; i++) {
      if (!usedSpawns.has(i)) {
        botSlots.push({
          playerId: `bot-${uuidv4().slice(0, 8)}`,
          displayName: pickBotName(i),
          socketId: 'bot-no-socket',
          spawnIndex: i,
        });
      }
    }
    const allSlots = [...humanSlots, ...botSlots];

    room.status = RoomStatus.IN_GAME;

    // Local event-log session id (decoupled from DB session id).
    const logSessionId = uuidv4();
    room.logSessionId = logSessionId;
    eventLog.startSession(logSessionId, room.roomId, allSlots.map((s) => ({
      playerId: s.playerId,
      displayName: s.displayName,
      isBot: s.playerId.startsWith('bot-'),
    })));
    const logger = eventLog.createScopedLogger(room.roomId, logSessionId);
    room.logger = logger;
    logger.log('game.launch', {
      data: {
        humans: humanSlots.length,
        bots: botSlots.length,
        slots: allSlots.map((s) => ({ playerId: s.playerId, displayName: s.displayName, spawnIndex: s.spawnIndex })),
      },
    });

    // BotController is created lazily — it needs the engine reference, and
    // the engine needs the preTick callback. We solve this with a closure that
    // captures a mutable variable.
    let botController: BotController | null = null;
    const preTick = botSlots.length > 0
      ? (): void => { botController?.update(); }
      : undefined;

    room.engine = new GameEngine(
      allSlots,
      (diff) => { this.io.to(room.roomId).emit('game:tick', diff); },
      (winnerId) => { this.handleGameOver(room, winnerId); },
      preTick,
      logger,
    );

    if (botSlots.length > 0) {
      const debugEmitter = isBotDebugEnabled()
        ? (frame: import('@bombermp/shared').BotDebugFrame): void => {
            this.io.to(botDebugRoom(room.roomId)).emit('bot:debug', frame);
          }
        : undefined;
      botController = new BotController(
        botSlots.map((s) => s.playerId),
        room.engine,
        debugEmitter,
        logger,
      );
    }

    // Persist session (fire-and-forget; only when MongoDB is enabled)
    if (isDbEnabled()) {
      GameSessionModel.create({
        roomId: room.roomId,
        startedAt: new Date(),
        endedAt: null,
        winnerId: null,
        playerIds: humanSlots.map((s) => s.playerId),
      }).then((session) => {
        room.sessionId = String(session._id);
      }).catch((err: unknown) => {
        console.error('[db] failed to create game session', err);
      });
    }

    this.io.to(room.roomId).emit('room:state', this.toRoomState(room));
    room.engine.start();
  }

  private handleGameOver(room: ServerRoom, winnerId: string | null): void {
    room.status = RoomStatus.GAME_OVER;
    this.io.to(room.roomId).emit('game:over', { winnerId });

    if (room.logger) {
      room.logger.log('game.end', { data: { winnerId } });
    }
    if (room.logSessionId) {
      eventLog.endSession(room.logSessionId, room.roomId, winnerId);
    }

    // Update DB session (fire-and-forget; only when MongoDB is enabled)
    if (isDbEnabled() && room.sessionId) {
      GameSessionModel.findByIdAndUpdate(room.sessionId, {
        endedAt: new Date(),
        winnerId,
      }).catch((err: unknown) => {
        console.error('[db] failed to update game session', err);
      });
    }

    // Return to WAITING after 3 s
    setTimeout(() => {
      if (!this.rooms.has(room.roomId)) return;
      room.status = RoomStatus.WAITING;
      room.engine = null;
      room.sessionId = null;
      room.logSessionId = null;
      room.logger = null;
      for (const p of room.players.values()) p.lateJoin = false;
      this.io.to(room.roomId).emit('room:state', this.toRoomState(room));
    }, 3000);
  }

  private assignSpawnIndex(room: ServerRoom): number {
    const taken = new Set([...room.players.values()].map((p) => p.spawnIndex));
    for (let i = 0; i < 4; i++) {
      if (!taken.has(i)) return i;
    }
    return room.players.size % 4;
  }

  private toRoomState(room: ServerRoom): RoomState {
    const players = [...room.players.values()].map((p) => ({
      id: p.playerId,
      displayName: p.displayName,
      isReady: true,
      isCreator: p.playerId === room.creatorId,
    }));

    const state: RoomState = {
      roomId: room.roomId,
      status: room.status,
      players,
      maxPlayers: MAX_PLAYERS,
      isPublic: room.isPublic,
    };

    if (room.countdownEndsAt !== null) {
      state.countdownEndsAt = room.countdownEndsAt;
    }

    if (room.engine !== null && room.status === RoomStatus.IN_GAME) {
      state.gameState = room.engine.getFullState();
    }

    return state;
  }
}
