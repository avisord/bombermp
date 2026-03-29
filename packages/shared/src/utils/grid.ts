import { GRID_COLS, GRID_ROWS, SPAWN_POSITIONS, SPAWN_SAFE_RADIUS } from '../constants/game.js';
import { type Position, type TileType } from '../types/index.js';

/** Convert (col, row) → flat array index */
export function toIndex(x: number, y: number): number {
  return y * GRID_COLS + x;
}

/** Convert flat array index → (col, row) */
export function fromIndex(index: number): Position {
  return {
    x: index % GRID_COLS,
    y: Math.floor(index / GRID_COLS),
  };
}

/** Returns true if (x, y) is within grid bounds */
export function isInBounds(x: number, y: number): boolean {
  return x >= 0 && x < GRID_COLS && y >= 0 && y < GRID_ROWS;
}

/** Safe tile getter — returns undefined if out-of-bounds */
export function getTile(grid: TileType[], x: number, y: number): TileType | undefined {
  if (!isInBounds(x, y)) return undefined;
  return grid[toIndex(x, y)];
}

/** Returns the 4 spawn positions (immutable copies) */
export function getSpawnPositions(): Position[] {
  return SPAWN_POSITIONS.map(({ x, y }) => ({ x, y }));
}

/**
 * Returns all tile positions that should be cleared around a spawn corner.
 * Includes the corner itself + adjacent tiles within SPAWN_SAFE_RADIUS.
 */
export function getSpawnSafeZone(spawnIndex: number): Position[] {
  const spawn = SPAWN_POSITIONS[spawnIndex];
  if (!spawn) throw new RangeError(`spawnIndex ${spawnIndex} out of range`);

  const positions: Position[] = [];
  for (let dy = -SPAWN_SAFE_RADIUS; dy <= SPAWN_SAFE_RADIUS; dy++) {
    for (let dx = -SPAWN_SAFE_RADIUS; dx <= SPAWN_SAFE_RADIUS; dx++) {
      const nx = spawn.x + dx;
      const ny = spawn.y + dy;
      if (isInBounds(nx, ny)) {
        positions.push({ x: nx, y: ny });
      }
    }
  }
  return positions;
}

/** Manhattan distance between two positions */
export function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
