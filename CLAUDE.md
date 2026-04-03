# BOMBERMP — 2D Multiplayer Browser Bomber Game

## Project Overview

BOMBERMP is a real-time, browser-based 2D multiplayer bomber game inspired by the classic Bomberman genre. Players join rooms, navigate a maze-like grid, drop bombs to destroy walls and eliminate other players, and pick up power-ups. Last player standing wins.

Live domain: `https://bombermb.avinashjha.space`
API/WS domain: `https://bombermbapi.avinashjha.space` / `wss://bombermbapi.avinashjha.space`

---

## Monorepo Structure

```
bombermp/
├── CLAUDE.md
├── package.json               # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── journal/
│   ├── requirements/          # Project requirement notes
│   └── prompts/               # Prompt logs
├── packages/
│   └── shared/                # Shared types, models, constants, utils
│       ├── src/
│       │   ├── types/         # Game state, player, bomb, item, room types
│       │   ├── constants/     # Grid size, bomb timers, item drop rates
│       │   └── utils/         # Shared pure functions (collision, grid math)
│       └── package.json
├── apps/
│   ├── server/                # Node.js + Express + Socket.io backend
│   │   ├── src/
│   │   │   ├── game/          # Core game engine (loop, state, physics)
│   │   │   ├── rooms/         # Room management (create, join, lifecycle)
│   │   │   ├── sockets/       # Socket.io event handlers
│   │   │   ├── db/            # MongoDB models and connection
│   │   │   └── index.ts       # Entry point
│   │   ├── Dockerfile
│   │   └── package.json
│   └── client/                # Vanilla TS + HTML Canvas frontend
│       ├── src/
│       │   ├── game/          # Canvas renderer, game loop, input
│       │   ├── ui/            # Lobby, room screens, HUD
│       │   ├── socket/        # Socket.io client wrapper
│       │   └── main.ts        # Entry point
│       ├── public/
│       │   └── index.html
│       ├── Dockerfile
│       └── package.json
└── docker/
    ├── docker-compose.yml     # Local dev: server + client + mongodb
    └── nginx/
        └── nginx.conf         # Reverse proxy config
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Package manager | pnpm (workspaces) |
| Language | TypeScript (strict mode) |
| Server runtime | Node.js 20+ |
| Server framework | Express 5 |
| Real-time | Socket.io 4 (WebSocket transport) |
| Client rendering | HTML5 Canvas API (no game framework) |
| Database | MongoDB (local Docker dev / Atlas prod) |
| ODM | Mongoose |
| Bundler (client) | Vite |
| Containerisation | Docker + Docker Compose |
| Cloud deploy | Google Cloud Run / GCE (asia-south1) |
| Reverse proxy | Nginx |

---

## Commands

All commands are run from the **monorepo root** unless noted.

```bash
# Install all dependencies
pnpm install

# Dev — run all packages in watch mode
pnpm dev

# Build everything
pnpm build

# Run server only
pnpm --filter server dev

# Run client only
pnpm --filter client dev

# Run shared package in watch mode
pnpm --filter shared dev

# Lint
pnpm lint

# Type-check all packages
pnpm typecheck

# Run tests
pnpm test

# Docker local stack (server + client + mongodb)
docker compose -f docker/docker-compose.yml up --build
```

---

## Architecture

### Game Loop (Server-Authoritative)

The server owns all game state. Clients send **inputs** only; the server processes them and broadcasts **state diffs** at a fixed tick rate (~20 TPS). This prevents cheating and keeps all clients in sync.

```
Client Input (keyboard)
  → Socket.io emit("input", { dir })
    → Server receives, queues input
      → Game tick processes inputs
        → State updated (move, bomb placed, explosion)
          → Server emits("state", diff) to all room members
            → Client applies diff and re-renders canvas
```

### Room Lifecycle

```
WAITING → STARTING (countdown 3s) → IN_GAME → GAME_OVER → WAITING
```

- Rooms hold max **4 players**.
- Room creator can start the game once ≥ 2 players are present (or solo for testing).
- On game over, all players return to the lobby (same room, WAITING state).
- Rooms are destroyed when all players leave.

### Player Identity

- No authentication. Each browser gets a **UUID cookie** (`player_id`) on first visit.
- The UUID is used to re-associate a reconnecting player with their session.
- Display name is chosen by the player (stored in cookie or session).

---

## Game Mechanics

### Grid / World

- Fixed 2D tile grid (e.g. 15×13 tiles).
- Tile types:
  - `EMPTY` — walkable
  - `WALL_HARD` — indestructible
  - `WALL_SOFT` — destructible by bombs, has drop chance
  - `BOMB` — active bomb tile (blocks movement)
  - `EXPLOSION` — active explosion tile (damages players/items)
  - `ITEM` — dropped item on floor

### Bomb Mechanics

- Default: each player holds **1 bomb** max at a time.
- Bomb fuse: **3 seconds** after placement.
- Explosion propagates in 4 directions (up/down/left/right) by `blastRadius` tiles.
- Explosion blocked by `WALL_HARD`; destroys `WALL_SOFT`.
- Chain explosions: a bomb in the path of another explosion detonates immediately.
- Explosion lasts **0.5s** then clears.

### Items / Power-ups (dropped from WALL_SOFT)

| Item | Effect |
|------|--------|
| `BOMB_UP` | +1 max bomb capacity |
| `FIRE_UP` | +1 blast radius |
| `SPEED_DOWN` (trap) | −30% movement speed for 5s |

Drop rates are configurable constants in `packages/shared/src/constants`.

### Spawn

- 4 corner spawns (top-left, top-right, bottom-left, bottom-right).
- Initial safe zone: corners cleared of soft walls.

---

## Networking

### Socket.io Events

**Client → Server**

| Event | Payload | Description |
|-------|---------|-------------|
| `room:create` | `{ displayName }` | Create a new room |
| `room:join` | `{ roomId, displayName }` | Join an existing room |
| `room:start` | — | Creator starts the game |
| `player:input` | `{ dir: Direction \| null, action: 'bomb' \| null }` | Movement / bomb drop |
| `room:leave` | — | Leave room gracefully |

**Server → Client**

| Event | Payload | Description |
|-------|---------|-------------|
| `room:state` | `RoomState` | Full room state on join |
| `game:tick` | `GameStateDiff` | Incremental state diff each tick |
| `game:over` | `{ winnerId }` | Game ended |
| `latency:pong` | `{ serverTime }` | Latency measurement response |
| `error` | `{ message }` | Error feedback |

### Latency Display

- Client pings server every 2 seconds with `latency:ping`.
- Server responds with `latency:pong`.
- Client calculates RTT and displays it on HUD for all visible players (color-coded: green < 80ms, yellow < 200ms, red ≥ 200ms).

---

## Database (MongoDB)

Collections:
- `players` — `{ _id: UUID, displayName, createdAt, lastSeen }`
- `rooms` — `{ roomId, status, players[], createdAt }` (ephemeral, cleared on restart or TTL)
- `game_sessions` — `{ roomId, startedAt, endedAt, winnerId, playerIds[] }` (stats/history)

Ephemeral room state lives **in-memory** on the server (not persisted to DB mid-game). DB is used for player identity and match history only.

---

## Deployment

### Docker Images

- `client`: Nginx serving the built Vite static bundle.
- `server`: Node.js runtime running the compiled server.

### Google Cloud (asia-south1)

- Single region deployment.
- Frontend container → `https://bombermb.avinashjha.space`
- Backend container → `https://bombermbapi.avinashjha.space`
- Nginx reverse proxy handles TLS termination and routes.

### Environment Variables

```bash
# server/.env
PORT=3001
MONGODB_URI=mongodb://localhost:27017/bombermp
COOKIE_SECRET=<random-secret>
CLIENT_ORIGIN=https://bombermb.avinashjha.space
NODE_ENV=production

# client/.env (Vite)
VITE_API_URL=https://bombermbapi.avinashjha.space
VITE_WS_URL=wss://bombermbapi.avinashjha.space
```

---

## Implementation Plan

### Phase 1 — Monorepo Scaffold
- [ ] Init pnpm workspace with `apps/server`, `apps/client`, `packages/shared`
- [ ] Configure TypeScript (strict, path aliases, project references)
- [ ] Set up ESLint + Prettier
- [ ] Set up Vite for client
- [ ] Configure `pnpm dev` concurrent runner

### Phase 2 — Shared Package
- [ ] Define all TypeScript types: `Player`, `Room`, `Bomb`, `Item`, `GameState`, `Tile`, socket event payloads
- [ ] Define game constants: grid dimensions, tick rate, bomb fuse, blast radius, drop rates
- [ ] Implement pure utility functions: grid helpers, position math, explosion spread calculator

### Phase 3 — Server Core
- [ ] Express app + CORS + cookie parser
- [ ] MongoDB connection + Mongoose models
- [ ] Room manager (in-memory Map, CRUD)
- [ ] Socket.io integration: connect, disconnect, room events
- [ ] Game engine: tick loop, input processing, bomb timers, explosion propagation, item drops
- [ ] Player identity via UUID cookie

### Phase 4 — Client Core
- [ ] HTML page + Canvas setup
- [ ] Socket.io client connection
- [ ] Lobby UI (create room / join room by ID)
- [ ] Game renderer: grid, players (colored), bombs, explosions, items, HUD
- [ ] Input handler (WASD/arrow keys + Space for bomb)
- [ ] Latency display

### Phase 5 — Game Loop Integration
- [ ] Full game flow: lobby → countdown → in-game → game over → lobby
- [ ] Smooth movement interpolation on client
- [ ] Explosion + death animations

### Phase 6 — Polish & Deployment
- [ ] Responsive canvas scaling
- [ ] Docker Compose local dev stack
- [ ] Dockerfiles for server + client
- [ ] Nginx config for reverse proxy
- [ ] Google Cloud deployment scripts/CI

---

## Code Style & Conventions

- **TypeScript strict mode** — no `any`, explicit return types on public functions.
- **Shared types first** — all data structures live in `packages/shared`, never duplicated.
- **Server is authoritative** — clients never mutate game state; only render and send inputs.
- **Immutable state updates** — prefer returning new state objects over mutation in the game engine.
- **Event naming** — kebab-case with namespace prefix: `room:create`, `game:tick`.
- **File naming** — kebab-case for files/directories, PascalCase for classes/interfaces.
- **No magic numbers** — all game tuning values live in `packages/shared/src/constants/game.ts`.
- **Error handling** — all socket events have try/catch; errors emit back to the originating client.

---

## Key Design Decisions

1. **No game framework** — Raw HTML Canvas keeps the bundle lean and gives full control over the rendering pipeline.
2. **Server-authoritative tick loop** — Prevents cheating; all physics runs server-side.
3. **Incremental state diffs** — Only send what changed each tick to reduce bandwidth.
4. **UUID cookie identity** — Lowest friction for players; no registration required.
5. **In-memory room state** — Rooms are ephemeral; only completed match summaries hit the DB.
6. **Monorepo with shared package** — Single source of truth for types/constants prevents client-server drift.

---

## Client-Side Prediction (`apps/client/src/game/prediction.ts`)

Local player moves at native framerate (rAF); server state reconciles each tick.

### How it works

- `LocalPlayerPredictor.advance(dir, speedMult, grid, nowMs)` — called every render frame; mirrors server `movePlayer` with real `dt` instead of fixed server DT.
- `reconcile(serverX, serverY)` — called on every `game:tick`; snaps to server if error > 1.5 tiles, ignores normal prediction lead.
- `init(x, y)` / `reset()` — called on IN_GAME start / game over / disconnect.
- Renderer uses predicted position for local player only; remote players use raw server state.

### Critical invariants — must match server exactly

| Rule | Detail |
|------|--------|
| **Use `Math.round` for tile lookup** | Server uses `Math.round(corner)` to find which tile a hitbox corner is in. Using `Math.floor` causes false collisions at spawn (corner at 0.55 → tile 0 = WALL_HARD instead of tile 1 = EMPTY). |
| **Own-bomb passthrough** | Server keeps `passableBombs` per player; BOMB tiles are walkable until hitbox fully leaves. Client mirrors this via `addPassableBomb(x, y)` (called in `game:tick` handler **before** `applyDiff`, so the passable entry exists before the BOMB grid tile is written). Passable bombs are promoted to solid in `advance()` using `hitboxOverlapsTile`. |
| **HALF = 0.45** | Hitbox half-width, identical to server constant. |
| **Corner-rounding slide** | On blocked move, nudge the perpendicular axis toward `Math.round(pos)` to allow sliding through corridors — same logic as server. |
