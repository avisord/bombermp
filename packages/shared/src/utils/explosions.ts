import { GRID_COLS, GRID_ROWS } from '../constants/game.js';
import { TileType } from '../types/index.js';
import type { Position } from '../types/index.js';

export interface ExplosionResult {
  affectedTiles: Position[];
  destroyedSoftWalls: Position[];
}

const DIRS: [number, number][] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

/**
 * Pure function — calculates all tiles hit by an explosion.
 * Shared so the client can reuse for local prediction.
 */
export function calculateExplosionTiles(
  grid: TileType[],
  center: Position,
  radius: number,
): ExplosionResult {
  const affectedTiles: Position[] = [{ x: center.x, y: center.y }];
  const destroyedSoftWalls: Position[] = [];

  for (const [dx, dy] of DIRS) {
    for (let step = 1; step <= radius; step++) {
      const nx = center.x + dx * step;
      const ny = center.y + dy * step;

      if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) break;

      const idx = ny * GRID_COLS + nx;
      const tile = grid[idx];
      if (tile === undefined) break;

      if (tile === TileType.WALL_HARD) break;

      if (tile === TileType.WALL_SOFT) {
        affectedTiles.push({ x: nx, y: ny });
        destroyedSoftWalls.push({ x: nx, y: ny });
        break;
      }

      affectedTiles.push({ x: nx, y: ny });
    }
  }

  return { affectedTiles, destroyedSoftWalls };
}
