import 'dotenv/config';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@bombermp/shared';
import { connectDB, disconnectDB } from './db/connection.js';
import { registerHandlers } from './sockets/handlers.js';

const PORT = process.env['PORT'] ? Number(process.env['PORT']) : 3001;
const CLIENT_ORIGIN = process.env['CLIENT_ORIGIN'] ?? 'http://localhost:5173';

// ─── Express ──────────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(cookieParser(process.env['COOKIE_SECRET'] ?? 'dev-secret'));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

// ─── HTTP + Socket.io ─────────────────────────────────────────────────────────

const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
  httpServer,
  {
    cors: { origin: CLIENT_ORIGIN, credentials: true },
    transports: ['websocket', 'polling'],
  },
);

// ─── Socket handlers ──────────────────────────────────────────────────────────

registerHandlers(io);

// ─── Start ────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  try {
    await connectDB();
  } catch (err) {
    console.error('[db] connection failed, running without DB:', err);
  }

  httpServer.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
  });
}

void start();

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  console.log('[server] shutting down…');
  httpServer.close();
  await disconnectDB();
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT',  () => { void shutdown(); });
