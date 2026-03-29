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

// ─── Socket Events ────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  socket.on('latency:ping', ({ clientTime }) => {
    socket.emit('latency:pong', { clientTime, serverTime: Date.now() });
  });

  socket.on('disconnect', (reason) => {
    console.log(`[socket] disconnected: ${socket.id} — ${reason}`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
