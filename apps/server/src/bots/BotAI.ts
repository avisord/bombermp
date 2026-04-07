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
  findSafeEscape,
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

// ─── Difficulty tuning ─────────────────────────────────────────────────────────
const THINK_INTERVAL = 4;           // re-decide every 4 ticks (200ms)
const BOMB_COOLDOWN_TICKS = 20;     // min 1s between bomb placements
const ATTACK_CHANCE = 0.5;          // 50% chance to actually attack when opportunity arises
const EXPLORE_BOMB_CHANCE = 0.6;    // 60% chance to bomb a wall when exploring
const MAX_BOMB_SEARCH_DIST = 4;     // how far to search for a bomb placement spot

// ─── Bomb plan: pre-computed move-to-bomb → place → flee-to-hide ──────────────

interface BombPlan {
  bombPos: Position;
  hidePos: Position;
  phase: 'move-to-bomb' | 'place-and-flee';
}

export class BotAI {
  private mode: BotMode = 'EXPLORE';
  private readonly playerId: string;
  private visitedCells = new Set<number>();
  private currentPath: Position[] | null = null;
  private tickCounter = 0;
  private lastBombTick = -999;
  private fleeTarget: Position | null = null;
  private bombPlan: BombPlan | null = null;

  constructor(playerId: string) {
    this.playerId = playerId;
  }

  decide(state: GameState, dangerMap: Set<number>): BotDecision {
    const me = state.players[this.playerId];
    if (!me?.alive) return { dir: null, action: null };

    this.tickCounter++;
    const myTile: Position = { x: Math.round(me.pixelX), y: Math.round(me.pixelY) };
    this.visitedCells.add(toIndex(myTile.x, myTile.y));

    // --- REACT: flee if in danger (always runs, cancels bomb plan) ---
    if (dangerMap.has(toIndex(myTile.x, myTile.y))) {
      this.bombPlan = null;
      return this.flee(state.grid, myTile, dangerMap);
    }
    this.fleeTarget = null;

    // --- Execute active bomb plan ---
    if (this.bombPlan) {
      return this.executeBombPlan(state, dangerMap, me, myTile);
    }

    // --- Throttle decisions to avoid jitter ---
    if (this.tickCounter % THINK_INTERVAL !== 0) {
      return this.continueCurrentAction(state.grid, myTile, dangerMap);
    }

    // --- MODE SWITCH ---
    this.updateMode(state, me, myTile);

    if (this.mode === 'BATTLE') {
      return this.battleTick(state, dangerMap, me, myTile);
    }
    return this.exploreTick(state, dangerMap, me, myTile);
  }

  // ─── Bomb plan execution ─────────────────────────────────────────────────────

  private executeBombPlan(state: GameState, dangerMap: Set<number>, me: Player, myTile: Position): BotDecision {
    const plan = this.bombPlan!;

    if (plan.phase === 'move-to-bomb') {
      // Validate plan is still viable
      const bombTile = getTile(state.grid, plan.bombPos.x, plan.bombPos.y);
      if (bombTile !== TileType.EMPTY && bombTile !== TileType.ITEM) {
        this.bombPlan = null;
        return { dir: null, action: null };
      }

      // Arrived at bomb position?
      if (myTile.x === plan.bombPos.x && myTile.y === plan.bombPos.y) {
        plan.phase = 'place-and-flee';
        this.currentPath = null;
        // Re-verify escape is still valid
        const hypo = this.hypotheticalDanger(dangerMap, state.grid, plan.bombPos, me.blastRadius);
        const escape = findSafeEscape(state.grid, plan.bombPos, hypo, me.blastRadius + 3);
        if (!escape) {
          // Escape no longer viable — abort
          this.bombPlan = null;
          return { dir: null, action: null };
        }
        plan.hidePos = escape;
        const fleeDir = directionToward(myTile, plan.hidePos, state.grid);
        if (!fleeDir) {
          this.bombPlan = null;
          return { dir: null, action: null };
        }
        this.lastBombTick = this.tickCounter;
        return { dir: fleeDir, action: 'bomb' };
      }

      // Still moving to bomb position
      if (!this.currentPath || this.currentPath.length === 0) {
        this.currentPath = bfsPath(state.grid, myTile, plan.bombPos, dangerMap);
        if (!this.currentPath) {
          this.bombPlan = null;
          return { dir: null, action: null };
        }
      }
      this.advancePath(myTile);
      if (this.currentPath.length > 0) {
        const next = this.currentPath[0]!;
        if (dangerMap.has(toIndex(next.x, next.y))) {
          this.bombPlan = null;
          this.currentPath = null;
          return { dir: null, action: null };
        }
        return { dir: tileDirection(myTile, next), action: null };
      }
      return { dir: null, action: null };
    }

    // phase === 'place-and-flee': bomb already placed, flee to hide
    if (myTile.x === plan.hidePos.x && myTile.y === plan.hidePos.y) {
      // Arrived at hide spot
      this.bombPlan = null;
      return { dir: null, action: null };
    }
    const dir = directionToward(myTile, plan.hidePos, state.grid);
    if (!dir) {
      this.bombPlan = null;
      return { dir: null, action: null };
    }
    return { dir, action: null };
  }

  // ─── Flee (always immediate) ─────────────────────────────────────────────────

  private flee(grid: TileType[], myTile: Position, dangerMap: Set<number>): BotDecision {
    if (this.fleeTarget && !dangerMap.has(toIndex(this.fleeTarget.x, this.fleeTarget.y))) {
      const dir = directionToward(myTile, this.fleeTarget, grid);
      if (dir) return { dir, action: null };
    }
    const safeTile = findNearestSafe(grid, myTile, dangerMap);
    if (safeTile) {
      this.fleeTarget = safeTile;
      return { dir: directionToward(myTile, safeTile, grid), action: null };
    }
    return { dir: this.anyOpenDirection(grid, myTile), action: null };
  }

  // ─── Continue current path between think ticks ───────────────────────────────

  private continueCurrentAction(grid: TileType[], myTile: Position, dangerMap: Set<number>): BotDecision {
    if (this.currentPath && this.currentPath.length > 0) {
      this.advancePath(myTile);
      if (this.currentPath.length > 0) {
        const next = this.currentPath[0]!;
        if (dangerMap.has(toIndex(next.x, next.y))) {
          this.currentPath = null;
          return { dir: null, action: null };
        }
        return { dir: tileDirection(myTile, next), action: null };
      }
    }
    return { dir: null, action: null };
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
    // Try to plan a bomb near a soft wall
    if (
      me.activeBombs < me.maxBombs &&
      this.tickCounter - this.lastBombTick >= BOMB_COOLDOWN_TICKS &&
      Math.random() < EXPLORE_BOMB_CHANCE &&
      !this.hasNearbyActiveBomb(state, myTile, 2)
    ) {
      const plan = this.findBombPlan(state, dangerMap, me, myTile, null);
      if (plan) {
        this.bombPlan = plan;
        this.currentPath = null;
        return this.executeBombPlan(state, dangerMap, me, myTile);
      }
    }

    // Pick exploration target if path is exhausted
    if (!this.currentPath || this.currentPath.length === 0) {
      const target = this.pickExploreTarget(state, myTile, dangerMap);
      if (target) {
        this.currentPath = bfsPath(state.grid, myTile, target, dangerMap);
      }
    }

    // Follow current path
    if (this.currentPath && this.currentPath.length > 0) {
      this.advancePath(myTile);
      if (this.currentPath.length > 0) {
        const next = this.currentPath[0]!;
        if (dangerMap.has(toIndex(next.x, next.y))) {
          this.currentPath = null;
          return { dir: null, action: null };
        }
        return { dir: tileDirection(myTile, next), action: null };
      }
    }

    return { dir: null, action: null };
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

    // --- ATTACK with planning ---
    if (
      me.activeBombs < me.maxBombs &&
      this.tickCounter - this.lastBombTick >= BOMB_COOLDOWN_TICKS &&
      Math.random() < ATTACK_CHANCE
    ) {
      const plan = this.findBombPlan(state, dangerMap, me, myTile, enemyTile);
      if (plan) {
        this.bombPlan = plan;
        this.currentPath = null;
        return this.executeBombPlan(state, dangerMap, me, myTile);
      }
    }

    // --- REPOSITION ---
    const repositionTarget = this.findRepositionTile(state, dangerMap, me, myTile, enemyTile);
    if (repositionTarget) {
      this.currentPath = bfsPath(state.grid, myTile, repositionTarget, dangerMap);
      if (this.currentPath && this.currentPath.length > 1) {
        this.advancePath(myTile);
        if (this.currentPath.length > 0) {
          return { dir: tileDirection(myTile, this.currentPath[0]!), action: null };
        }
      }
    }

    // Fallback: move toward enemy
    const dir = directionToward(myTile, enemyTile, state.grid, dangerMap);
    return { dir, action: null };
  }

  // ─── Bomb planning ───────────────────────────────────────────────────────────

  /**
   * Search nearby walkable tiles for the best place to drop a bomb.
   * For each candidate, simulate the blast and find a hide spot.
   * Returns the best (bombPos, hidePos) plan, or null if none is safe.
   *
   * In EXPLORE: candidates must be adjacent to a soft wall.
   * In BATTLE: candidates must have the enemy in blast line-of-sight.
   */
  private findBombPlan(
    state: GameState,
    dangerMap: Set<number>,
    me: Player,
    myTile: Position,
    enemyTile: Position | null,
  ): BombPlan | null {
    // BFS from bot to find candidate bomb positions within range
    const startIdx = toIndex(myTile.x, myTile.y);
    const visited = new Set<number>([startIdx]);
    const candidates: Array<{ pos: Position; dist: number }> = [];
    const queue: Array<{ idx: number; dist: number }> = [{ idx: startIdx, dist: 0 }];

    // Include current tile as a candidate
    candidates.push({ pos: { ...myTile }, dist: 0 });

    while (queue.length > 0) {
      const { idx: current, dist } = queue.shift()!;
      if (dist >= MAX_BOMB_SEARCH_DIST) continue;

      const cx = current % GRID_COLS;
      const cy = Math.floor(current / GRID_COLS);

      for (const [ddx, ddy] of DIRS) {
        const nx = cx + ddx;
        const ny = cy + ddy;
        if (!isInBounds(nx, ny)) continue;
        const nIdx = toIndex(nx, ny);
        if (visited.has(nIdx)) continue;
        const tile = getTile(state.grid, nx, ny);
        if (tile !== TileType.EMPTY && tile !== TileType.ITEM) continue;
        if (dangerMap.has(nIdx)) continue;
        visited.add(nIdx);
        candidates.push({ pos: { x: nx, y: ny }, dist: dist + 1 });
        queue.push({ idx: nIdx, dist: dist + 1 });
      }
    }

    let bestPlan: BombPlan | null = null;
    let bestScore = -Infinity;

    for (const { pos: candidatePos, dist: distToCandidate } of candidates) {
      // Filter: must be useful
      if (enemyTile) {
        // BATTLE: candidate must have enemy in blast line-of-sight
        if (!this.isInBlastLineOfSight(state.grid, candidatePos, enemyTile, me.blastRadius)) {
          continue;
        }
      } else {
        // EXPLORE: candidate must be adjacent to a soft wall
        if (!this.findAdjacentSoftWall(state.grid, candidatePos)) {
          continue;
        }
      }

      // Simulate blast and find escape
      const hypo = this.hypotheticalDanger(dangerMap, state.grid, candidatePos, me.blastRadius);
      const escapeTo = findSafeEscape(state.grid, candidatePos, hypo, me.blastRadius + 3);
      if (!escapeTo) continue;

      // Verify flee direction exists from bomb pos
      const fleeDir = directionToward(candidatePos, escapeTo, state.grid);
      if (!fleeDir) continue;

      // Score: prefer closer bomb spots with better escape routes
      const escapeRoutes = countEscapeRoutes(state.grid, escapeTo, hypo);
      const score = escapeRoutes * 2 - distToCandidate;

      if (score > bestScore) {
        bestScore = score;
        bestPlan = {
          bombPos: candidatePos,
          hidePos: escapeTo,
          phase: distToCandidate === 0 ? 'place-and-flee' : 'move-to-bomb',
        };
      }
    }

    return bestPlan;
  }

  // ─── Explore helpers ─────────────────────────────────────────────────────────

  private pickExploreTarget(
    state: GameState,
    myTile: Position,
    dangerMap: Set<number>,
  ): Position | null {
    const unvisited = this.bfsFirstUnvisited(state.grid, myTile, dangerMap);
    if (unvisited) return unvisited;

    const wallAdj = this.findCellNearSoftWall(state.grid, myTile, dangerMap);
    if (wallAdj) return wallAdj;

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

  // ─── Battle helpers ──────────────────────────────────────────────────────────

  private isInBlastLineOfSight(
    grid: TileType[],
    from: Position,
    target: Position,
    blastRadius: number,
  ): boolean {
    if (from.x !== target.x && from.y !== target.y) return false;
    const dist = manhattanDistance(from, target);
    if (dist > blastRadius || dist === 0) return false;

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

  // ─── Shared helpers ──────────────────────────────────────────────────────────

  private advancePath(myTile: Position): void {
    while (
      this.currentPath &&
      this.currentPath.length > 0 &&
      this.currentPath[0]!.x === myTile.x &&
      this.currentPath[0]!.y === myTile.y
    ) {
      this.currentPath.shift();
    }
  }

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
