import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import path from 'node:path';

/**
 * Structured per-event log for local debugging. Every event is JSON-serialised
 * to two destinations:
 *
 *   <cwd>/logs/events.jsonl                 — global rolling log (all events)
 *   <cwd>/logs/sessions/<sessionId>.jsonl   — focused per-game-session log
 *
 * Every line carries `ts`, `type`, `roomId`, `sessionId`, optional `tick` and
 * `playerId`, plus a `data` blob. Search with grep / jq.
 *
 * Gated by NODE_ENV !== 'production' — no-ops in prod.
 */

export interface GameEvent {
  data?: Record<string, unknown>;
  tick?: number;
  playerId?: string;
}

export interface FullGameEvent extends GameEvent {
  ts: number;
  type: string;
  roomId: string | null;
  sessionId: string | null;
}

export interface ScopedLogger {
  log(type: string, event?: GameEvent): void;
}

function isLoggingEnabled(): boolean {
  return process.env['NODE_ENV'] !== 'production';
}

function logsRoot(): string {
  return process.env['LOGS_DIR'] ?? path.join(process.cwd(), 'logs');
}

function sessionsDir(): string {
  return path.join(logsRoot(), 'sessions');
}

class EventLog {
  private sessionStreams = new Map<string, WriteStream>();
  private globalStream: WriteStream | null = null;
  private dirReady = false;

  private ensureDir(): void {
    if (this.dirReady) return;
    mkdirSync(sessionsDir(), { recursive: true });
    this.dirReady = true;
  }

  private openGlobal(): WriteStream {
    if (this.globalStream) return this.globalStream;
    this.ensureDir();
    this.globalStream = createWriteStream(path.join(logsRoot(), 'events.jsonl'), { flags: 'a' });
    return this.globalStream;
  }

  private openSession(sessionId: string): WriteStream {
    const existing = this.sessionStreams.get(sessionId);
    if (existing) return existing;
    this.ensureDir();
    const stream = createWriteStream(path.join(sessionsDir(), `${sessionId}.jsonl`), { flags: 'a' });
    this.sessionStreams.set(sessionId, stream);
    return stream;
  }

  startSession(sessionId: string, roomId: string, players: { playerId: string; displayName: string; isBot: boolean }[]): void {
    if (!isLoggingEnabled()) return;
    this.openSession(sessionId);
    this.writeFull({
      ts: Date.now(),
      type: 'session.start',
      roomId,
      sessionId,
      data: { players },
    });
  }

  endSession(sessionId: string, roomId: string, winnerId: string | null): void {
    if (!isLoggingEnabled()) return;
    this.writeFull({
      ts: Date.now(),
      type: 'session.end',
      roomId,
      sessionId,
      data: { winnerId },
    });
    const stream = this.sessionStreams.get(sessionId);
    if (stream) {
      stream.end();
      this.sessionStreams.delete(sessionId);
    }
  }

  private writeFull(event: FullGameEvent): void {
    const json = `${JSON.stringify(event)}\n`;
    this.openGlobal().write(json);
    if (event.sessionId) {
      const stream = this.sessionStreams.get(event.sessionId);
      if (stream) stream.write(json);
    }
  }

  /** Emit an event without a session context (e.g. lobby room create/join). */
  logUnscoped(type: string, event: GameEvent & { roomId?: string | null }): void {
    if (!isLoggingEnabled()) return;
    const { data, tick, playerId, roomId } = event;
    const full: FullGameEvent = {
      ts: Date.now(),
      type,
      roomId: roomId ?? null,
      sessionId: null,
    };
    if (data !== undefined) full.data = data;
    if (tick !== undefined) full.tick = tick;
    if (playerId !== undefined) full.playerId = playerId;
    this.writeFull(full);
  }

  /**
   * Build a scoped logger that auto-stamps every event with the given roomId
   * and sessionId. Returned from `startSession`-time wiring.
   */
  createScopedLogger(roomId: string, sessionId: string): ScopedLogger {
    if (!isLoggingEnabled()) return { log: () => undefined };
    return {
      log: (type: string, event: GameEvent = {}): void => {
        const full: FullGameEvent = { ts: Date.now(), type, roomId, sessionId };
        if (event.data !== undefined) full.data = event.data;
        if (event.tick !== undefined) full.tick = event.tick;
        if (event.playerId !== undefined) full.playerId = event.playerId;
        this.writeFull(full);
      },
    };
  }
}

export const eventLog = new EventLog();
export const loggingEnabled = isLoggingEnabled;
