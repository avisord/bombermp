// ─── Tile Types ────────────────────────────────────────────────────────────────

export enum TileType {
  EMPTY = 0,
  WALL_HARD = 1,
  WALL_SOFT = 2,
  BOMB = 3,
  EXPLOSION = 4,
  ITEM = 5,
}

// ─── Item Types ────────────────────────────────────────────────────────────────

export enum ItemType {
  BOMB_UP = 'BOMB_UP',
  FIRE_UP = 'FIRE_UP',
  SPEED_DOWN = 'SPEED_DOWN',
}

// ─── Direction ─────────────────────────────────────────────────────────────────

export enum Direction {
  UP = 'UP',
  DOWN = 'DOWN',
  LEFT = 'LEFT',
  RIGHT = 'RIGHT',
}

// ─── Room Status ───────────────────────────────────────────────────────────────

export enum RoomStatus {
  WAITING = 'WAITING',
  STARTING = 'STARTING',
  IN_GAME = 'IN_GAME',
  GAME_OVER = 'GAME_OVER',
}

// ─── Entities ─────────────────────────────────────────────────────────────────

export interface Position {
  x: number;
  y: number;
}

export interface Player {
  id: string;
  displayName: string;
  position: Position;
  /** Pixel-precise position for smooth interpolation */
  pixelX: number;
  pixelY: number;
  alive: boolean;
  maxBombs: number;
  activeBombs: number;
  blastRadius: number;
  speedMultiplier: number;
  speedDebuffUntil: number | null;
  isReady: boolean;
}

export interface Bomb {
  id: string;
  ownerId: string;
  position: Position;
  blastRadius: number;
  placedAt: number;
  /** ms until detonation — absolute server timestamp */
  detonatesAt: number;
}

export interface Explosion {
  id: string;
  /** All tiles affected by this explosion */
  tiles: Position[];
  startedAt: number;
  endsAt: number;
}

export interface Item {
  id: string;
  type: ItemType;
  position: Position;
}

// ─── Game State ────────────────────────────────────────────────────────────────

export interface GameState {
  /** Flat array of TileType; index = row * GRID_COLS + col */
  grid: TileType[];
  players: Record<string, Player>;
  bombs: Record<string, Bomb>;
  explosions: Record<string, Explosion>;
  items: Record<string, Item>;
  tick: number;
  serverTime: number;
}

export interface GameStateDiff {
  tick: number;
  serverTime: number;
  gridChanges?: Array<{ index: number; tile: TileType }>;
  players?: Record<string, Partial<Player>>;
  removedPlayers?: string[];
  bombs?: Record<string, Bomb>;
  removedBombs?: string[];
  explosions?: Record<string, Explosion>;
  removedExplosions?: string[];
  items?: Record<string, Item>;
  removedItems?: string[];
}

// ─── Room ─────────────────────────────────────────────────────────────────────

export interface RoomPlayer {
  id: string;
  displayName: string;
  isReady: boolean;
  isCreator: boolean;
}

export interface RoomState {
  roomId: string;
  status: RoomStatus;
  players: RoomPlayer[];
  maxPlayers: number;
  countdownEndsAt?: number;
  gameState?: GameState;
}

// ─── Socket Event Payloads ─────────────────────────────────────────────────────

export interface C2SRoomCreate {
  displayName: string;
}

export interface C2SRoomJoin {
  roomId: string;
  displayName: string;
}

export interface C2SPlayerInput {
  dir: Direction | null;
  action: 'bomb' | null;
}

// ─── Socket Event Maps (for Socket.io generics) ────────────────────────────────

/** Client → Server events */
export interface ClientToServerEvents {
  'room:create': (payload: C2SRoomCreate) => void;
  'room:join': (payload: C2SRoomJoin) => void;
  'room:start': () => void;
  'room:leave': () => void;
  'player:input': (payload: C2SPlayerInput) => void;
  'latency:ping': (payload: { clientTime: number }) => void;
}

/** Server → Client events */
export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'game:tick': (diff: GameStateDiff) => void;
  'game:over': (payload: { winnerId: string | null }) => void;
  'latency:pong': (payload: { clientTime: number; serverTime: number }) => void;
  error: (payload: { message: string }) => void;
}

/** Inter-server events (unused but required by Socket.io generics) */
export type InterServerEvents = Record<string, never>;

/** Socket data (per-socket metadata stored server-side) */
export interface SocketData {
  playerId: string;
  displayName: string;
  roomId: string | null;
}
