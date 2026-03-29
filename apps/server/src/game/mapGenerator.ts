import {
  GRID_COLS,
  GRID_ROWS,
  SOFT_WALL_DENSITY,
  TileType,
  getSpawnSafeZone,
  toIndex,
} from '@bombermp/shared';

export function generateMap(): TileType[] {
  const grid: TileType[] = new Array(GRID_COLS * GRID_ROWS).fill(TileType.EMPTY) as TileType[];

  // Build safe set from all 4 spawn corners
  const safeSet = new Set<number>();
  for (let i = 0; i < 4; i++) {
    for (const pos of getSpawnSafeZone(i)) {
      safeSet.add(toIndex(pos.x, pos.y));
    }
  }

  for (let y = 0; y < GRID_ROWS; y++) {
    for (let x = 0; x < GRID_COLS; x++) {
      const idx = toIndex(x, y);

      // Perimeter → WALL_HARD
      if (x === 0 || x === GRID_COLS - 1 || y === 0 || y === GRID_ROWS - 1) {
        grid[idx] = TileType.WALL_HARD;
        continue;
      }

      // Interior pillars (even col AND even row) → WALL_HARD
      if (x % 2 === 0 && y % 2 === 0) {
        grid[idx] = TileType.WALL_HARD;
        continue;
      }

      // Spawn safe zones stay EMPTY
      if (safeSet.has(idx)) continue;

      // Eligible tiles: random soft wall
      if (Math.random() < SOFT_WALL_DENSITY) {
        grid[idx] = TileType.WALL_SOFT;
      }
    }
  }

  return grid;
}
