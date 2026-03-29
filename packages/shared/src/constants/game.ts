// ─── Grid ──────────────────────────────────────────────────────────────────────

export const GRID_COLS = 15 as const;
export const GRID_ROWS = 13 as const;
export const TILE_SIZE = 48 as const; // px — used by client renderer

// ─── Tick Rate ─────────────────────────────────────────────────────────────────

export const SERVER_TICK_RATE_MS = 50 as const; // 20 TPS

// ─── Player ────────────────────────────────────────────────────────────────────

export const PLAYER_SPEED = 3.0 as const; // tiles per second
export const PLAYER_DEFAULT_MAX_BOMBS = 1 as const;
export const PLAYER_DEFAULT_BLAST_RADIUS = 2 as const;
export const SPEED_DEBUFF_MULTIPLIER = 0.7 as const;
export const SPEED_DEBUFF_DURATION_MS = 5000 as const;

// ─── Bomb ──────────────────────────────────────────────────────────────────────

export const BOMB_FUSE_MS = 3000 as const;
export const EXPLOSION_DURATION_MS = 500 as const;

// ─── Item Drop Rates ───────────────────────────────────────────────────────────

/** Probability (0–1) that a soft wall drops an item when destroyed */
export const ITEM_DROP_RATE = 0.3 as const;

export const ITEM_DROP_WEIGHTS = {
  BOMB_UP: 0.4,
  FIRE_UP: 0.4,
  SPEED_DOWN: 0.2,
} as const;

// ─── Room ─────────────────────────────────────────────────────────────────────

export const MAX_PLAYERS = 4 as const;
export const COUNTDOWN_DURATION_MS = 3000 as const;

// ─── Spawn Corners (tile positions) ───────────────────────────────────────────

export const SPAWN_POSITIONS = [
  { x: 1, y: 1 },
  { x: GRID_COLS - 2, y: 1 },
  { x: 1, y: GRID_ROWS - 2 },
  { x: GRID_COLS - 2, y: GRID_ROWS - 2 },
] as const;

/** Number of tiles cleared around each spawn corner */
export const SPAWN_SAFE_RADIUS = 1 as const;

// ─── Soft Wall Density ────────────────────────────────────────────────────────

/** Probability (0–1) that an eligible tile is filled with a soft wall */
export const SOFT_WALL_DENSITY = 0.65 as const;

// ─── Latency ──────────────────────────────────────────────────────────────────

export const LATENCY_PING_INTERVAL_MS = 2000 as const;
export const LATENCY_GREEN_THRESHOLD_MS = 80 as const;
export const LATENCY_YELLOW_THRESHOLD_MS = 200 as const;
