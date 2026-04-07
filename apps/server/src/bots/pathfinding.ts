import {
  GRID_COLS,
  GRID_ROWS,
  type Position,
  TileType,
  Direction,
  getTile,
  isInBounds,
  toIndex,
} from '@bombermp/shared';

const DIRS: [number, number][] = [
  [0, -1], // UP
  [0, 1],  // DOWN
  [-1, 0], // LEFT
  [1, 0],  // RIGHT
];

function isWalkable(grid: TileType[], x: number, y: number): boolean {
  const tile = getTile(grid, x, y);
  return tile === TileType.EMPTY || tile === TileType.ITEM;
}

/**
 * BFS shortest path from start to target, avoiding unwalkable tiles and
 * optionally avoiding danger tiles. Returns the path including start and
 * target, or null if unreachable.
 */
export function bfsPath(
  grid: TileType[],
  start: Position,
  target: Position,
  dangerMap?: Set<number>,
): Position[] | null {
  const startIdx = toIndex(start.x, start.y);
  const targetIdx = toIndex(target.x, target.y);
  if (startIdx === targetIdx) return [start];

  const visited = new Set<number>([startIdx]);
  const parent = new Map<number, number>();
  const queue: number[] = [startIdx];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const cx = current % GRID_COLS;
    const cy = Math.floor(current / GRID_COLS);

    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isInBounds(nx, ny)) continue;

      const nIdx = toIndex(nx, ny);
      if (visited.has(nIdx)) continue;

      if (!isWalkable(grid, nx, ny)) continue;
      if (dangerMap?.has(nIdx)) continue;

      visited.add(nIdx);
      parent.set(nIdx, current);

      if (nIdx === targetIdx) {
        // Reconstruct path
        const path: Position[] = [];
        let cur = nIdx;
        while (cur !== startIdx) {
          path.push({ x: cur % GRID_COLS, y: Math.floor(cur / GRID_COLS) });
          cur = parent.get(cur)!;
        }
        path.push(start);
        path.reverse();
        return path;
      }

      queue.push(nIdx);
    }
  }

  return null;
}

/**
 * BFS from start, returns all reachable walkable cells that are NOT in the danger map.
 * The start cell is included even if it's in danger (bot is already there).
 */
export function findSafeCells(
  grid: TileType[],
  start: Position,
  dangerMap: Set<number>,
): Position[] {
  const startIdx = toIndex(start.x, start.y);
  const visited = new Set<number>([startIdx]);
  const queue: number[] = [startIdx];
  const safe: Position[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const cx = current % GRID_COLS;
    const cy = Math.floor(current / GRID_COLS);

    if (!dangerMap.has(current)) {
      safe.push({ x: cx, y: cy });
    }

    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isInBounds(nx, ny)) continue;

      const nIdx = toIndex(nx, ny);
      if (visited.has(nIdx)) continue;
      if (!isWalkable(grid, nx, ny)) continue;

      visited.add(nIdx);
      queue.push(nIdx);
    }
  }

  return safe;
}

/**
 * BFS from start, returns the nearest walkable cell not in the danger map.
 * Returns null if no safe cell is reachable.
 */
export function findNearestSafe(
  grid: TileType[],
  start: Position,
  dangerMap: Set<number>,
): Position | null {
  const startIdx = toIndex(start.x, start.y);

  // If start is already safe, return it
  if (!dangerMap.has(startIdx)) return start;

  const visited = new Set<number>([startIdx]);
  const queue: number[] = [startIdx];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const cx = current % GRID_COLS;
    const cy = Math.floor(current / GRID_COLS);

    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isInBounds(nx, ny)) continue;

      const nIdx = toIndex(nx, ny);
      if (visited.has(nIdx)) continue;
      if (!isWalkable(grid, nx, ny)) continue;

      visited.add(nIdx);

      if (!dangerMap.has(nIdx)) {
        return { x: nx, y: ny };
      }

      queue.push(nIdx);
    }
  }

  return null;
}

/**
 * Count how many of the 4 cardinal neighbours are walkable and safe.
 */
export function countEscapeRoutes(
  grid: TileType[],
  pos: Position,
  dangerMap: Set<number>,
): number {
  let count = 0;
  for (const [dx, dy] of DIRS) {
    const nx = pos.x + dx;
    const ny = pos.y + dy;
    if (!isInBounds(nx, ny)) continue;
    if (!isWalkable(grid, nx, ny)) continue;
    if (dangerMap.has(toIndex(nx, ny))) continue;
    count++;
  }
  return count;
}

/**
 * Convert a target tile into a Direction for one step of BFS movement.
 */
export function directionToward(
  from: Position,
  to: Position,
  grid: TileType[],
  dangerMap?: Set<number>,
): Direction | null {
  const path = bfsPath(grid, from, to, dangerMap);
  if (!path || path.length < 2) return null;
  return tileDirection(from, path[1]!);
}

/**
 * Get the cardinal Direction from one adjacent tile to another.
 */
export function tileDirection(from: Position, to: Position): Direction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx > 0) return Direction.RIGHT;
  if (dx < 0) return Direction.LEFT;
  if (dy > 0) return Direction.DOWN;
  if (dy < 0) return Direction.UP;
  return null;
}
