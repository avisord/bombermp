import {
  Direction,
  TileType,
  PLAYER_SPEED,
  GRID_COLS,
  GRID_ROWS,
} from '@bombermp/shared';

// ─── Local Player Predictor ────────────────────────────────────────────────────
//
// Mirrors the server's movePlayer + collidesWithGrid logic exactly, advancing
// position with real elapsed time (dt) at 60fps for smooth visual movement.
// On each game:tick the predictor reconciles against the authoritative server pos.

const HALF = 0.45;

export interface OtherPlayerPos {
  pixelX: number;
  pixelY: number;
  alive: boolean;
}

function collidesGrid(px: number, py: number, grid: TileType[], passable: Set<number>): boolean {
  const corners = [
    [px - HALF, py - HALF],
    [px + HALF, py - HALF],
    [px - HALF, py + HALF],
    [px + HALF, py + HALF],
  ] as const;
  for (const [cx, cy] of corners) {
    const col = Math.round(cx);
    const row = Math.round(cy);
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return true;
    const idx = row * GRID_COLS + col;
    const tile = grid[idx];
    if (tile === TileType.WALL_HARD || tile === TileType.WALL_SOFT) return true;
    if (tile === TileType.BOMB && !passable.has(idx)) return true;
  }
  return false;
}

function collidesPlayers(px: number, py: number, others: OtherPlayerPos[]): boolean {
  const size = 2 * HALF; // 0.9
  for (const other of others) {
    if (!other.alive) continue;
    if (Math.abs(px - other.pixelX) < size && Math.abs(py - other.pixelY) < size) {
      return true;
    }
  }
  return false;
}

function collides(px: number, py: number, grid: TileType[], passable: Set<number>, others: OtherPlayerPos[]): boolean {
  return collidesGrid(px, py, grid, passable) || collidesPlayers(px, py, others);
}

/** Mirror of server hitboxOverlapsTile: true if any corner of the hitbox rounds to (tx, ty). */
function hitboxOverlapsTile(px: number, py: number, tx: number, ty: number): boolean {
  const corners = [
    [px - HALF, py - HALF],
    [px + HALF, py - HALF],
    [px - HALF, py + HALF],
    [px + HALF, py + HALF],
  ] as const;
  for (const [cx, cy] of corners) {
    if (Math.round(cx) === tx && Math.round(cy) === ty) return true;
  }
  return false;
}

export class LocalPlayerPredictor {
  private px = 0;
  private py = 0;
  private lastFrameMs = 0;
  private active = false;
  /** tile index → {x, y} for bombs the local player can still walk through */
  private passableBombs = new Map<number, { x: number; y: number }>();

  get x(): number { return this.px; }
  get y(): number { return this.py; }
  get isActive(): boolean { return this.active; }

  /** Call with server's initial position when IN_GAME starts. */
  init(serverX: number, serverY: number): void {
    this.px = serverX;
    this.py = serverY;
    this.lastFrameMs = performance.now();
    this.passableBombs.clear();
    this.active = true;
  }

  reset(): void {
    this.active = false;
    this.passableBombs.clear();
  }

  /**
   * Called when the server confirms a bomb placed by the local player.
   * Mirrors the server's passableBombs set so the predictor allows walking off it.
   */
  addPassableBomb(tileX: number, tileY: number): void {
    this.passableBombs.set(tileY * GRID_COLS + tileX, { x: tileX, y: tileY });
  }

  /**
   * Returns true if the local player's current hitbox overlaps the given tile.
   * Used to detect when an opponent's bomb spawns on/near the local player so
   * we can mark it passable — mirroring the server's placement logic.
   */
  overlapsNewBomb(tileX: number, tileY: number): boolean {
    if (!this.active) return false;
    return hitboxOverlapsTile(this.px, this.py, tileX, tileY);
  }

  /**
   * Called on every game:tick with the server's authoritative position.
   * Only snaps on catastrophic divergence (> 1.5 tiles) — e.g. server rejected
   * a move because the predictor walked through a wall it didn't know about.
   */
  reconcile(serverX: number, serverY: number): void {
    if (!this.active) return;
    const errSq = (this.px - serverX) ** 2 + (this.py - serverY) ** 2;
    if (errSq > 2.25) {
      this.px = serverX;
      this.py = serverY;
    }
  }

  /**
   * Called every render frame (~60 fps). Advances predicted position using
   * real elapsed time and the same movement + corner-rounding logic as the server.
   */
  advance(
    dir: Direction | null,
    speedMult: number,
    grid: TileType[],
    nowMs: number,
    otherPlayers: OtherPlayerPos[] = [],
  ): void {
    if (!this.active) return;
    const dt = Math.min((nowMs - this.lastFrameMs) / 1000, 0.1); // cap at 100 ms
    this.lastFrameMs = nowMs;

    // Promote passable bombs to solid once the hitbox fully leaves their tile.
    for (const [idx, pos] of this.passableBombs) {
      if (!hitboxOverlapsTile(this.px, this.py, pos.x, pos.y)) {
        this.passableBombs.delete(idx);
      }
    }

    if (dir === null) return;

    const passable = new Set(this.passableBombs.keys());
    const dx = dir === Direction.RIGHT ? 1 : dir === Direction.LEFT ? -1 : 0;
    const dy = dir === Direction.DOWN  ? 1 : dir === Direction.UP   ? -1 : 0;
    const delta = PLAYER_SPEED * speedMult * dt;
    const newX = this.px + dx * delta;
    const newY = this.py + dy * delta;

    if (!collides(newX, newY, grid, passable, otherPlayers)) {
      this.px = newX;
      this.py = newY;
      return;
    }

    // ── Corner-rounding (exact mirror of server logic) ─────────────────────────
    if (dx !== 0) {
      const targetY = Math.round(this.py);
      const yDiff   = targetY - this.py;
      if (Math.abs(yDiff) > 0.001) {
        const nudgedY = this.py + Math.sign(yDiff) * Math.min(Math.abs(yDiff), delta);
        if (!collides(newX, nudgedY, grid, passable, otherPlayers)) {
          this.px = newX;
          this.py = nudgedY;
          return;
        }
        if (!collides(this.px, nudgedY, grid, passable, otherPlayers)) {
          this.py = nudgedY;
          return;
        }
      }
    } else if (dy !== 0) {
      const targetX = Math.round(this.px);
      const xDiff   = targetX - this.px;
      if (Math.abs(xDiff) > 0.001) {
        const nudgedX = this.px + Math.sign(xDiff) * Math.min(Math.abs(xDiff), delta);
        if (!collides(nudgedX, newY, grid, passable, otherPlayers)) {
          this.px = nudgedX;
          this.py = newY;
          return;
        }
        if (!collides(nudgedX, this.py, grid, passable, otherPlayers)) {
          this.px = nudgedX;
          return;
        }
      }
    }
    // Fully blocked — don't move.
  }
}
