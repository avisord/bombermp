import {
  Direction,
  TileType,
  type GameState,
  type Player,
  type Position,
  calculateExplosionTiles,
  getTile,
  isInBounds,
  manhattanDistance,
  toIndex,
  GRID_COLS,
} from '@bombermp/shared';
import {
  bfsPath,
  findSafeCells,
  findNearestSafe,
  countEscapeRoutes,
  directionToward,
  tileDirection,
} from './pathfinding.js';

type BotMode = 'EXPLORE' | 'BATTLE';

export interface BotDecision {
  dir: Direction | null;
  action: 'bomb' | null;
}

const DIRS: [number, number][] = [
  [0, -1], // UP
  [0, 1],  // DOWN
  [-1, 0], // LEFT
  [1, 0],  // RIGHT
];

export class BotAI {
  private mode: BotMode = 'EXPLORE';
  private readonly playerId: string;
  private visitedCells = new Set<number>();
  private currentPath: Position[] | null = null;

  constructor(playerId: string) {
    this.playerId = playerId;
  }

  decide(state: GameState, dangerMap: Set<number>): BotDecision {
    const me = state.players[this.playerId];
    if (!me?.alive) return { dir: null, action: null };

    const myTile: Position = { x: Math.round(me.pixelX), y: Math.round(me.pixelY) };
    this.visitedCells.add(toIndex(myTile.x, myTile.y));

    // --- REACT: flee if in danger (overrides both modes) ---
    if (dangerMap.has(toIndex(myTile.x, myTile.y))) {
      const safeTile = findNearestSafe(state.grid, myTile, dangerMap);
      if (safeTile) {
        return { dir: directionToward(myTile, safeTile, state.grid), action: null };
      }
      return { dir: this.anyOpenDirection(state.grid, myTile), action: null };
    }

    // --- MODE SWITCH ---
    this.updateMode(state, me, myTile);

    if (this.mode === 'BATTLE') {
      return this.battleTick(state, dangerMap, me, myTile);
    }
    return this.exploreTick(state, dangerMap, me, myTile);
  }

  // ─── Mode switching ──────────────────────────────────────────────────────────

  private updateMode(state: GameState, me: Player, myTile: Position): void {
    const N = me.blastRadius + 1;
    const enemies = this.getEnemies(state);

    if (this.mode === 'EXPLORE') {
      for (const enemy of enemies) {
        if (manhattanDistance(myTile, enemy.position) <= N) {
          this.mode = 'BATTLE';
          this.currentPath = null;
          return;
        }
      }
    } else {
      // Hysteresis: switch back only when ALL enemies are far away
      const allFar = enemies.every(
        (e) => manhattanDistance(myTile, e.position) > N + 2,
      );
      if (allFar || enemies.length === 0) {
        this.mode = 'EXPLORE';
        this.currentPath = null;
      }
    }
  }

  // ─── Explore mode ────────────────────────────────────────────────────────────

  private exploreTick(
    state: GameState,
    dangerMap: Set<number>,
    me: Player,
    myTile: Position,
  ): BotDecision {
    // Try to bomb an adjacent soft wall
    if (me.activeBombs < me.maxBombs) {
      const adjWall = this.findAdjacentSoftWall(state.grid, myTile);
      if (adjWall && !this.hasNearbyActiveBomb(state, myTile, 2)) {
        const hypotheticalDanger = this.hypotheticalDanger(dangerMap, state.grid, myTile, me.blastRadius);
        const safeCells = findSafeCells(state.grid, myTile, hypotheticalDanger);
        if (safeCells.length > 0) {
          this.currentPath = null;
          const fleeDir = directionToward(myTile, safeCells[0]!, state.grid, dangerMap);
          return { dir: fleeDir, action: 'bomb' };
        }
      }
    }

    // Pick exploration target if no current path
    if (!this.currentPath || this.currentPath.length === 0) {
      const target = this.pickExploreTarget(state, myTile, dangerMap);
      if (target) {
        this.currentPath = bfsPath(state.grid, myTile, target, dangerMap);
      }
    }

    // Follow current path
    if (this.currentPath && this.currentPath.length > 0) {
      const next = this.currentPath[0]!;
      if (next.x === myTile.x && next.y === myTile.y) {
        this.currentPath.shift();
      }
      if (this.currentPath.length > 0) {
        return { dir: tileDirection(myTile, this.currentPath[0]!), action: null };
      }
    }

    return { dir: null, action: null };
  }

  private pickExploreTarget(
    state: GameState,
    myTile: Position,
    dangerMap: Set<number>,
  ): Position | null {
    // 1. Nearest unvisited reachable cell
    const unvisited = this.bfsFirstUnvisited(state.grid, myTile, dangerMap);
    if (unvisited) return unvisited;

    // 2. Cell adjacent to a soft wall (to break new paths)
    const wallAdj = this.findCellNearSoftWall(state.grid, myTile, dangerMap);
    if (wallAdj) return wallAdj;

    // 3. Move toward nearest enemy
    const enemies = this.getEnemies(state);
    if (enemies.length > 0) {
      const nearest = this.findNearestEnemy(enemies, myTile);
      if (nearest) return nearest.position;
    }

    return null;
  }

  private bfsFirstUnvisited(
    grid: TileType[],
    start: Position,
    dangerMap: Set<number>,
  ): Position | null {
    const startIdx = toIndex(start.x, start.y);
    const visited = new Set<number>([startIdx]);
    const queue: number[] = [startIdx];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const cx = current % GRID_COLS;
      const cy = Math.floor(current / GRID_COLS);

      if (!this.visitedCells.has(current) && current !== startIdx) {
        return { x: cx, y: cy };
      }

      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!isInBounds(nx, ny)) continue;
        const nIdx = toIndex(nx, ny);
        if (visited.has(nIdx)) continue;
        const tile = getTile(grid, nx, ny);
        if (tile !== TileType.EMPTY && tile !== TileType.ITEM) continue;
        if (dangerMap.has(nIdx)) continue;
        visited.add(nIdx);
        queue.push(nIdx);
      }
    }

    return null;
  }

  private findCellNearSoftWall(
    grid: TileType[],
    start: Position,
    dangerMap: Set<number>,
  ): Position | null {
    const startIdx = toIndex(start.x, start.y);
    const visited = new Set<number>([startIdx]);
    const queue: number[] = [startIdx];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const cx = current % GRID_COLS;
      const cy = Math.floor(current / GRID_COLS);

      // Check if this cell is adjacent to a soft wall
      if (current !== startIdx) {
        for (const [dx, dy] of DIRS) {
          const tile = getTile(grid, cx + dx, cy + dy);
          if (tile === TileType.WALL_SOFT) return { x: cx, y: cy };
        }
      }

      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!isInBounds(nx, ny)) continue;
        const nIdx = toIndex(nx, ny);
        if (visited.has(nIdx)) continue;
        const tile = getTile(grid, nx, ny);
        if (tile !== TileType.EMPTY && tile !== TileType.ITEM) continue;
        if (dangerMap.has(nIdx)) continue;
        visited.add(nIdx);
        queue.push(nIdx);
      }
    }

    return null;
  }

  // ─── Battle mode ─────────────────────────────────────────────────────────────

  private battleTick(
    state: GameState,
    dangerMap: Set<number>,
    me: Player,
    myTile: Position,
  ): BotDecision {
    const enemies = this.getEnemies(state);
    const nearestEnemy = this.findNearestEnemy(enemies, myTile);
    if (!nearestEnemy) return this.exploreTick(state, dangerMap, me, myTile);

    const enemyTile = nearestEnemy.position;

    // --- ATTACK ---
    if (
      me.activeBombs < me.maxBombs &&
      this.isInBlastLineOfSight(state.grid, myTile, enemyTile, me.blastRadius)
    ) {
      const hypotheticalDanger = this.hypotheticalDanger(dangerMap, state.grid, myTile, me.blastRadius);
      const safeCells = findSafeCells(state.grid, myTile, hypotheticalDanger);
      if (safeCells.length > 0) {
        const fleeDir = directionToward(myTile, safeCells[0]!, state.grid, dangerMap);
        return { dir: fleeDir, action: 'bomb' };
      }
    }

    // --- REPOSITION ---
    const repositionTarget = this.findRepositionTile(state, dangerMap, me, myTile, enemyTile);
    if (repositionTarget) {
      return { dir: directionToward(myTile, repositionTarget, state.grid, dangerMap), action: null };
    }

    // Fallback: move toward enemy
    const dir = directionToward(myTile, enemyTile, state.grid, dangerMap);
    return { dir, action: null };
  }

  private isInBlastLineOfSight(
    grid: TileType[],
    from: Position,
    target: Position,
    blastRadius: number,
  ): boolean {
    // Must be on same row or column
    if (from.x !== target.x && from.y !== target.y) return false;

    const dist = manhattanDistance(from, target);
    if (dist > blastRadius || dist === 0) return false;

    // Check no hard walls between
    const dx = Math.sign(target.x - from.x);
    const dy = Math.sign(target.y - from.y);
    let cx = from.x + dx;
    let cy = from.y + dy;

    while (cx !== target.x || cy !== target.y) {
      const tile = getTile(grid, cx, cy);
      if (tile === TileType.WALL_HARD || tile === TileType.WALL_SOFT) return false;
      cx += dx;
      cy += dy;
    }

    return true;
  }

  private findRepositionTile(
    state: GameState,
    dangerMap: Set<number>,
    me: Player,
    myTile: Position,
    enemyTile: Position,
  ): Position | null {
    // BFS from bot, score reachable tiles (limit search depth)
    const startIdx = toIndex(myTile.x, myTile.y);
    const visited = new Set<number>([startIdx]);
    const queue: Array<{ idx: number; depth: number }> = [{ idx: startIdx, depth: 0 }];
    let bestTile: Position | null = null;
    let bestScore = -Infinity;
    const maxDepth = me.blastRadius + 3;

    while (queue.length > 0) {
      const { idx: current, depth } = queue.shift()!;
      if (depth > maxDepth) continue;

      const cx = current % GRID_COLS;
      const cy = Math.floor(current / GRID_COLS);
      const pos: Position = { x: cx, y: cy };

      if (!dangerMap.has(current) && current !== startIdx) {
        const escapes = countEscapeRoutes(state.grid, pos, dangerMap);
        if (escapes >= 2) {
          const distToEnemy = manhattanDistance(pos, enemyTile);
          // Prefer tiles close to enemy but within blast range
          const inRange = distToEnemy <= me.blastRadius ? 10 : 0;
          const score = inRange + escapes - depth;
          if (score > bestScore) {
            bestScore = score;
            bestTile = pos;
          }
        }
      }

      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!isInBounds(nx, ny)) continue;
        const nIdx = toIndex(nx, ny);
        if (visited.has(nIdx)) continue;
        const tile = getTile(state.grid, nx, ny);
        if (tile !== TileType.EMPTY && tile !== TileType.ITEM) continue;
        visited.add(nIdx);
        queue.push({ idx: nIdx, depth: depth + 1 });
      }
    }

    return bestTile;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private getEnemies(state: GameState): Player[] {
    return Object.values(state.players).filter(
      (p) => p.id !== this.playerId && p.alive,
    );
  }

  private findNearestEnemy(enemies: Player[], myTile: Position): Player | null {
    let nearest: Player | null = null;
    let minDist = Infinity;
    for (const e of enemies) {
      const d = manhattanDistance(myTile, e.position);
      if (d < minDist) {
        minDist = d;
        nearest = e;
      }
    }
    return nearest;
  }

  private findAdjacentSoftWall(grid: TileType[], pos: Position): Position | null {
    for (const [dx, dy] of DIRS) {
      const nx = pos.x + dx;
      const ny = pos.y + dy;
      if (getTile(grid, nx, ny) === TileType.WALL_SOFT) {
        return { x: nx, y: ny };
      }
    }
    return null;
  }

  private hasNearbyActiveBomb(state: GameState, pos: Position, radius: number): boolean {
    for (const bomb of Object.values(state.bombs)) {
      if (manhattanDistance(pos, bomb.position) <= radius) return true;
    }
    return false;
  }

  private hypotheticalDanger(
    dangerMap: Set<number>,
    grid: TileType[],
    bombPos: Position,
    blastRadius: number,
  ): Set<number> {
    const hypo = new Set(dangerMap);
    hypo.add(toIndex(bombPos.x, bombPos.y));
    const { affectedTiles } = calculateExplosionTiles(grid, bombPos, blastRadius);
    for (const t of affectedTiles) {
      hypo.add(toIndex(t.x, t.y));
    }
    return hypo;
  }

  private anyOpenDirection(grid: TileType[], pos: Position): Direction | null {
    const directions: [number, number, Direction][] = [
      [0, -1, Direction.UP],
      [0, 1, Direction.DOWN],
      [-1, 0, Direction.LEFT],
      [1, 0, Direction.RIGHT],
    ];
    for (const [dx, dy, dir] of directions) {
      const tile = getTile(grid, pos.x + dx, pos.y + dy);
      if (tile === TileType.EMPTY || tile === TileType.ITEM) return dir;
    }
    return null;
  }
}
