import { v4 as uuidv4 } from 'uuid';
import {
  BOMB_FUSE_MS,
  EXPLOSION_DURATION_MS,
  ITEM_DROP_RATE,
  ITEM_DROP_WEIGHTS,
  PLAYER_DEFAULT_BLAST_RADIUS,
  PLAYER_DEFAULT_MAX_BOMBS,
  PLAYER_SPEED,
  SERVER_TICK_RATE_MS,
  SPAWN_POSITIONS,
  SPEED_DEBUFF_DURATION_MS,
  SPEED_DEBUFF_MULTIPLIER,
  Direction,
  ItemType,
  TileType,
  calculateExplosionTiles,
  getTile,
  toIndex,
} from '@bombermp/shared';
import type {
  Bomb,
  Explosion,
  GameState,
  GameStateDiff,
  Item,
  Player,
} from '@bombermp/shared';
import { generateMap } from './mapGenerator.js';

const DT = SERVER_TICK_RATE_MS / 1000; // 0.05 s per tick
const HALF = 0.45; // hitbox half-width in tile units

// ─── Internal types ───────────────────────────────────────────────────────────

interface ServerPlayer extends Player {
  socketId: string;
  pendingDir: Direction | null;
  pendingBomb: boolean;
  /** Bomb IDs still passable for this player (not yet fully walked off). */
  passableBombs: Set<string>;
}

export interface PlayerSlot {
  playerId: string;
  displayName: string;
  socketId: string;
  spawnIndex: number;
}

export type OnTickCallback = (diff: GameStateDiff) => void;
export type OnGameOverCallback = (winnerId: string | null) => void;

// ─── GameEngine ───────────────────────────────────────────────────────────────

export class GameEngine {
  private state: GameState;
  private prevState: GameState;
  private serverPlayers = new Map<string, ServerPlayer>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly onTick: OnTickCallback;
  private readonly onGameOver: OnGameOverCallback;

  constructor(
    playerSlots: PlayerSlot[],
    onTick: OnTickCallback,
    onGameOver: OnGameOverCallback,
    private readonly preTick?: () => void,
  ) {
    this.onTick = onTick;
    this.onGameOver = onGameOver;

    const grid = generateMap();
    const players: Record<string, Player> = {};

    for (const slot of playerSlots) {
      const spawnPos = SPAWN_POSITIONS[slot.spawnIndex] ?? { x: 1, y: 1 };
      const sp: ServerPlayer = {
        id: slot.playerId,
        displayName: slot.displayName,
        position: { x: spawnPos.x, y: spawnPos.y },
        pixelX: spawnPos.x,
        pixelY: spawnPos.y,
        alive: true,
        maxBombs: PLAYER_DEFAULT_MAX_BOMBS,
        activeBombs: 0,
        blastRadius: PLAYER_DEFAULT_BLAST_RADIUS,
        speedMultiplier: 1,
        speedDebuffUntil: null,
        isReady: true,
        ...(slot.socketId === 'bot-no-socket' ? { isBot: true } : {}),
        socketId: slot.socketId,
        pendingDir: null,
        pendingBomb: false,
        passableBombs: new Set(),
      };
      this.serverPlayers.set(slot.playerId, sp);
      players[slot.playerId] = this.toSharedPlayer(sp);
    }

    this.state = {
      grid,
      players,
      bombs: {},
      explosions: {},
      items: {},
      tick: 0,
      serverTime: Date.now(),
    };
    this.prevState = this.cloneState();
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  start(): void {
    this.intervalId = setInterval(() => { this.tick(); }, SERVER_TICK_RATE_MS);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  queueInput(playerId: string, dir: Direction | null, action: 'bomb' | null): void {
    const sp = this.serverPlayers.get(playerId);
    if (!sp?.alive) return;
    sp.pendingDir = dir;
    if (action === 'bomb') sp.pendingBomb = true;
  }

  removePlayer(playerId: string): void {
    const sp = this.serverPlayers.get(playerId);
    if (!sp) return;
    sp.alive = false;
    const statePlayer = this.state.players[playerId];
    if (statePlayer) statePlayer.alive = false;
  }

  updateSocketId(playerId: string, socketId: string): void {
    const sp = this.serverPlayers.get(playerId);
    if (sp) sp.socketId = socketId;
  }

  getFullState(): GameState {
    return this.state;
  }

  // ─── Tick ────────────────────────────────────────────────────────────────────

  private tick(): void {
    this.preTick?.();
    this.state.tick++;
    this.state.serverTime = Date.now();

    this.processInputs();
    this.updateBombs();
    this.updateExplosions();
    this.checkExplosionDamage();
    this.checkItemPickups();

    const winner = this.checkWinCondition();
    const diff = this.computeDiff();
    this.prevState = this.cloneState();
    this.onTick(diff);

    if (winner !== undefined) {
      this.stop();
      this.onGameOver(winner);
    }
  }

  // ─── Movement ────────────────────────────────────────────────────────────────

  private processInputs(): void {
    const now = Date.now();

    for (const [playerId, sp] of this.serverPlayers) {
      if (!sp.alive) continue;

      // Expire speed debuff
      if (sp.speedDebuffUntil !== null && now >= sp.speedDebuffUntil) {
        sp.speedMultiplier = 1;
        sp.speedDebuffUntil = null;
        const statePlayer = this.state.players[playerId];
        if (statePlayer) {
          statePlayer.speedMultiplier = 1;
          statePlayer.speedDebuffUntil = null;
        }
      }

      if (sp.pendingDir !== null) {
        this.movePlayer(sp, playerId);
      }

      if (sp.pendingBomb) {
        sp.pendingBomb = false;
        this.placeBomb(sp, playerId);
      }

      sp.pendingDir = null;
    }
  }

  private movePlayer(sp: ServerPlayer, playerId: string): void {
    let dx = 0;
    let dy = 0;
    switch (sp.pendingDir) {
      case Direction.UP:    dy = -1; break;
      case Direction.DOWN:  dy =  1; break;
      case Direction.LEFT:  dx = -1; break;
      case Direction.RIGHT: dx =  1; break;
    }

    const speed = PLAYER_SPEED * sp.speedMultiplier;
    const delta = speed * DT;
    const newX = sp.pixelX + dx * delta;
    const newY = sp.pixelY + dy * delta;

    const passableIndices = this.buildPassableIndices(sp);

    if (!this.collidesAny(newX, newY, passableIndices, playerId)) {
      // Direct movement clears — take it.
      sp.pixelX = newX;
      sp.pixelY = newY;
    } else if (dx !== 0) {
      // Horizontal movement blocked.
      // Classic Bomberman corner-rounding: if the block is caused by the hitbox
      // clipping into the row above/below (perpendicular misalignment), nudge Y
      // toward the nearest row centre so the player can slide through corridors.
      const targetY = Math.round(sp.pixelY);
      const yDiff   = targetY - sp.pixelY;
      if (Math.abs(yDiff) > 0.001) {
        const nudgedY = sp.pixelY + Math.sign(yDiff) * Math.min(Math.abs(yDiff), delta);
        if (!this.collidesAny(newX, nudgedY, passableIndices, playerId)) {
          sp.pixelX = newX;
          sp.pixelY = nudgedY;
        } else if (!this.collidesAny(sp.pixelX, nudgedY, passableIndices, playerId)) {
          sp.pixelY = nudgedY;
        }
      }
    } else if (dy !== 0) {
      // Vertical movement blocked — same logic for X misalignment.
      const targetX = Math.round(sp.pixelX);
      const xDiff   = targetX - sp.pixelX;
      if (Math.abs(xDiff) > 0.001) {
        const nudgedX = sp.pixelX + Math.sign(xDiff) * Math.min(Math.abs(xDiff), delta);
        if (!this.collidesAny(nudgedX, newY, passableIndices, playerId)) {
          sp.pixelX = nudgedX;
          sp.pixelY = newY;
        } else if (!this.collidesAny(nudgedX, sp.pixelY, passableIndices, playerId)) {
          sp.pixelX = nudgedX;
        }
      }
    }

    sp.position.x = Math.round(sp.pixelX);
    sp.position.y = Math.round(sp.pixelY);

    const statePlayer = this.state.players[playerId];
    if (statePlayer) {
      statePlayer.pixelX = sp.pixelX;
      statePlayer.pixelY = sp.pixelY;
      statePlayer.position.x = sp.position.x;
      statePlayer.position.y = sp.position.y;
    }

    // Promote any passable bomb to solid once ALL four hitbox corners have left its tile.
    for (const bombId of [...sp.passableBombs]) {
      const bomb = this.state.bombs[bombId];
      if (!bomb) {
        sp.passableBombs.delete(bombId);
        continue;
      }
      if (!this.hitboxOverlapsTile(sp.pixelX, sp.pixelY, bomb.position.x, bomb.position.y)) {
        sp.passableBombs.delete(bombId);
      }
    }
  }

  /**
   * Returns the set of flat grid indices for bombs that are still passable for
   * the given player, pruning any bomb IDs that no longer exist in state.
   */
  private buildPassableIndices(sp: ServerPlayer): Set<number> {
    const indices = new Set<number>();
    for (const bombId of [...sp.passableBombs]) {
      const bomb = this.state.bombs[bombId];
      if (!bomb) { sp.passableBombs.delete(bombId); continue; }
      indices.add(toIndex(bomb.position.x, bomb.position.y));
    }
    return indices;
  }

  /**
   * Returns true if at least one hitbox corner of the player at (px, py)
   * rounds to the tile at (tx, ty).  Used to determine when a player has
   * fully walked off a bomb tile.
   */
  private hitboxOverlapsTile(px: number, py: number, tx: number, ty: number): boolean {
    const corners: [number, number][] = [
      [px - HALF, py - HALF],
      [px + HALF, py - HALF],
      [px - HALF, py + HALF],
      [px + HALF, py + HALF],
    ];
    for (const [cx, cy] of corners) {
      if (Math.round(cx) === tx && Math.round(cy) === ty) return true;
    }
    return false;
  }

  /**
   * AABB collision check against the tile grid.
   * passableIndices: flat grid indices of bomb tiles that are still passable
   * for the moving player (they haven't fully walked off yet).
   */
  private collidesWithGrid(cx: number, cy: number, passableIndices: Set<number>): boolean {
    const corners: [number, number][] = [
      [cx - HALF, cy - HALF],
      [cx + HALF, cy - HALF],
      [cx - HALF, cy + HALF],
      [cx + HALF, cy + HALF],
    ];
    for (const [cornerX, cornerY] of corners) {
      const tx = Math.round(cornerX);
      const ty = Math.round(cornerY);
      const tile = getTile(this.state.grid, tx, ty);
      if (tile === TileType.WALL_HARD || tile === TileType.WALL_SOFT) return true;
      if (tile === TileType.BOMB && !passableIndices.has(toIndex(tx, ty))) return true;
    }
    return false;
  }

  /**
   * AABB collision check against all other alive players.
   * Two hitboxes overlap when their centers are within 2*HALF on both axes.
   */
  private collidesWithPlayers(cx: number, cy: number, excludeId: string): boolean {
    const size = 2 * HALF; // 0.9
    for (const [id, other] of this.serverPlayers) {
      if (id === excludeId || !other.alive) continue;
      if (Math.abs(cx - other.pixelX) < size && Math.abs(cy - other.pixelY) < size) {
        return true;
      }
    }
    return false;
  }

  /** Combined grid + player collision check. */
  private collidesAny(cx: number, cy: number, passableIndices: Set<number>, excludeId: string): boolean {
    return this.collidesWithGrid(cx, cy, passableIndices) || this.collidesWithPlayers(cx, cy, excludeId);
  }

  // ─── Bomb placement ──────────────────────────────────────────────────────────

  private placeBomb(sp: ServerPlayer, playerId: string): void {
    if (sp.activeBombs >= sp.maxBombs) return;

    const tx = Math.round(sp.pixelX);
    const ty = Math.round(sp.pixelY);
    const tile = getTile(this.state.grid, tx, ty);
    if (tile !== TileType.EMPTY && tile !== TileType.ITEM) return;

    const now = Date.now();
    const bomb: Bomb = {
      id: uuidv4(),
      ownerId: sp.id,
      position: { x: tx, y: ty },
      blastRadius: sp.blastRadius,
      placedAt: now,
      detonatesAt: now + BOMB_FUSE_MS,
    };

    sp.activeBombs++;
    sp.passableBombs.add(bomb.id);
    this.state.bombs[bomb.id] = bomb;
    this.state.grid[toIndex(tx, ty)] = TileType.BOMB;

    const statePlayer = this.state.players[playerId];
    if (statePlayer) statePlayer.activeBombs = sp.activeBombs;

    // Any other player whose hitbox already overlaps this tile must also be
    // able to walk off it — otherwise they get pinned against the new bomb.
    for (const [otherId, otherSp] of this.serverPlayers) {
      if (otherId === playerId || !otherSp.alive) continue;
      if (this.hitboxOverlapsTile(otherSp.pixelX, otherSp.pixelY, tx, ty)) {
        otherSp.passableBombs.add(bomb.id);
      }
    }
  }

  // ─── Bomb detonation ─────────────────────────────────────────────────────────

  private updateBombs(): void {
    const now = Date.now();
    const toDetonate: Bomb[] = [];
    for (const bomb of Object.values(this.state.bombs)) {
      if (now >= bomb.detonatesAt) toDetonate.push(bomb);
    }
    for (const bomb of toDetonate) {
      if (this.state.bombs[bomb.id]) {
        this.detonateBomb(bomb, 0);
      }
    }
  }

  private detonateBomb(bomb: Bomb, depth: number): void {
    if (depth > 8) return; // chain explosion safety cap

    // Remove bomb from state
    this.state.grid[toIndex(bomb.position.x, bomb.position.y)] = TileType.EMPTY;
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.state.bombs[bomb.id];

    // Decrement owner's active bomb count
    const sp = this.serverPlayers.get(bomb.ownerId);
    const stateOwner = this.state.players[bomb.ownerId];
    if (sp) sp.activeBombs = Math.max(0, sp.activeBombs - 1);
    if (stateOwner) stateOwner.activeBombs = sp ? sp.activeBombs : Math.max(0, stateOwner.activeBombs - 1);

    const { affectedTiles, destroyedSoftWalls } = calculateExplosionTiles(
      this.state.grid,
      bomb.position,
      bomb.blastRadius,
    );

    // Destroy soft walls
    for (const pos of destroyedSoftWalls) {
      this.state.grid[toIndex(pos.x, pos.y)] = TileType.EMPTY;
    }

    // Mark explosion on all affected tiles
    const now = Date.now();
    const explosion: Explosion = {
      id: uuidv4(),
      tiles: affectedTiles,
      startedAt: now,
      endsAt: now + EXPLOSION_DURATION_MS,
    };
    for (const pos of affectedTiles) {
      this.state.grid[toIndex(pos.x, pos.y)] = TileType.EXPLOSION;
    }
    this.state.explosions[explosion.id] = explosion;

    // Maybe spawn items on destroyed soft walls (after marking EXPLOSION so item
    // tiles get EXPLOSION temporarily; updateExplosions will restore to ITEM)
    for (const pos of destroyedSoftWalls) {
      if (Math.random() < ITEM_DROP_RATE) {
        this.spawnItem(pos.x, pos.y);
      }
    }

    // Kill players on explosion tiles
    const explodedSet = new Set(affectedTiles.map((p) => toIndex(p.x, p.y)));
    for (const [playerId, serverP] of this.serverPlayers) {
      if (!serverP.alive) continue;
      const tx = Math.round(serverP.pixelX);
      const ty = Math.round(serverP.pixelY);
      if (explodedSet.has(toIndex(tx, ty))) {
        serverP.alive = false;
        const statePlayer = this.state.players[playerId];
        if (statePlayer) statePlayer.alive = false;
      }
    }

    // Chain explosions: collect candidates first to avoid mutation-during-iteration
    const chainCandidates = Object.values(this.state.bombs).filter((b) =>
      explodedSet.has(toIndex(b.position.x, b.position.y)),
    );
    for (const chainBomb of chainCandidates) {
      if (this.state.bombs[chainBomb.id]) {
        this.detonateBomb(chainBomb, depth + 1);
      }
    }
  }

  // ─── Explosions ──────────────────────────────────────────────────────────────

  private updateExplosions(): void {
    const now = Date.now();
    for (const [expId, explosion] of Object.entries(this.state.explosions)) {
      if (now < explosion.endsAt) continue;

      for (const pos of explosion.tiles) {
        const idx = toIndex(pos.x, pos.y);
        if (this.state.grid[idx] === TileType.EXPLOSION) {
          // Restore ITEM tile if an item exists here, otherwise EMPTY
          const hasItem = Object.values(this.state.items).some(
            (item) => item.position.x === pos.x && item.position.y === pos.y,
          );
          this.state.grid[idx] = hasItem ? TileType.ITEM : TileType.EMPTY;
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete this.state.explosions[expId];
    }
  }

  // ─── Ongoing explosion damage ─────────────────────────────────────────────────

  /**
   * Kill any alive player who is currently standing on an EXPLOSION tile.
   * Called every tick after updateExplosions() so expired explosions are already
   * cleared before we test. This ensures players who walk INTO a live flame die.
   */
  private checkExplosionDamage(): void {
    for (const [playerId, sp] of this.serverPlayers) {
      if (!sp.alive) continue;
      const tx = Math.round(sp.pixelX);
      const ty = Math.round(sp.pixelY);
      if (this.state.grid[toIndex(tx, ty)] === TileType.EXPLOSION) {
        sp.alive = false;
        const statePlayer = this.state.players[playerId];
        if (statePlayer) statePlayer.alive = false;
      }
    }
  }

  // ─── Items ───────────────────────────────────────────────────────────────────

  private spawnItem(x: number, y: number): void {
    const roll = Math.random();
    let type: ItemType;
    if (roll < ITEM_DROP_WEIGHTS.BOMB_UP) {
      type = ItemType.BOMB_UP;
    } else if (roll < ITEM_DROP_WEIGHTS.BOMB_UP + ITEM_DROP_WEIGHTS.FIRE_UP) {
      type = ItemType.FIRE_UP;
    } else {
      type = ItemType.SPEED_DOWN;
    }
    const item: Item = { id: uuidv4(), type, position: { x, y } };
    this.state.items[item.id] = item;
    // Grid tile is EXPLOSION at this point; updateExplosions will set it to ITEM later
  }

  private checkItemPickups(): void {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [itemId, item] of Object.entries(this.state.items)) {
      const itemIdx = toIndex(item.position.x, item.position.y);
      for (const [playerId, sp] of this.serverPlayers) {
        if (!sp.alive) continue;
        if (toIndex(Math.round(sp.pixelX), Math.round(sp.pixelY)) !== itemIdx) continue;

        const statePlayer = this.state.players[playerId];
        switch (item.type) {
          case ItemType.BOMB_UP:
            sp.maxBombs++;
            if (statePlayer) statePlayer.maxBombs = sp.maxBombs;
            break;
          case ItemType.FIRE_UP:
            sp.blastRadius++;
            if (statePlayer) statePlayer.blastRadius = sp.blastRadius;
            break;
          case ItemType.SPEED_DOWN:
            sp.speedMultiplier = SPEED_DEBUFF_MULTIPLIER;
            sp.speedDebuffUntil = now + SPEED_DEBUFF_DURATION_MS;
            if (statePlayer) {
              statePlayer.speedMultiplier = SPEED_DEBUFF_MULTIPLIER;
              statePlayer.speedDebuffUntil = sp.speedDebuffUntil;
            }
            break;
        }

        toRemove.push(itemId);
        if (this.state.grid[itemIdx] === TileType.ITEM) {
          this.state.grid[itemIdx] = TileType.EMPTY;
        }
        break; // one player picks up one item per tick
      }
    }

    for (const id of toRemove) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete this.state.items[id];
    }
  }

  // ─── Win condition ───────────────────────────────────────────────────────────

  /**
   * Returns:
   * - `undefined`       → game continues
   * - `string`          → that player won
   * - `null`            → draw (everyone dead)
   */
  private checkWinCondition(): string | null | undefined {
    const alive = [...this.serverPlayers.values()].filter((p) => p.alive);
    const total = this.serverPlayers.size;

    // Solo: game over when the player dies
    if (total === 1) {
      return alive.length === 1 ? undefined : null;
    }

    if (alive.length <= 1) {
      return alive[0]?.id ?? null;
    }
    return undefined;
  }

  // ─── State diff ──────────────────────────────────────────────────────────────

  private computeDiff(): GameStateDiff {
    const diff: GameStateDiff = {
      tick: this.state.tick,
      serverTime: this.state.serverTime,
    };

    // Grid changes
    const gridChanges: Array<{ index: number; tile: TileType }> = [];
    for (let i = 0; i < this.state.grid.length; i++) {
      const cur = this.state.grid[i];
      const prev = this.prevState.grid[i];
      if (cur !== undefined && prev !== undefined && cur !== prev) {
        gridChanges.push({ index: i, tile: cur });
      }
    }
    if (gridChanges.length > 0) diff.gridChanges = gridChanges;

    // Player changes
    const playerChanges: Record<string, Partial<Player>> = {};
    for (const [id, player] of Object.entries(this.state.players)) {
      const prev = this.prevState.players[id];
      const changes = diffPlayer(player, prev);
      if (changes !== null) playerChanges[id] = changes;
    }
    if (Object.keys(playerChanges).length > 0) diff.players = playerChanges;

    // Bombs: new entries
    const newBombs: Record<string, Bomb> = {};
    for (const [id, bomb] of Object.entries(this.state.bombs)) {
      if (!this.prevState.bombs[id]) newBombs[id] = bomb;
    }
    if (Object.keys(newBombs).length > 0) diff.bombs = newBombs;

    // Bombs: removed
    const removedBombs = Object.keys(this.prevState.bombs).filter((id) => !this.state.bombs[id]);
    if (removedBombs.length > 0) diff.removedBombs = removedBombs;

    // Explosions: new
    const newExplosions: Record<string, Explosion> = {};
    for (const [id, exp] of Object.entries(this.state.explosions)) {
      if (!this.prevState.explosions[id]) newExplosions[id] = exp;
    }
    if (Object.keys(newExplosions).length > 0) diff.explosions = newExplosions;

    // Explosions: removed
    const removedExplosions = Object.keys(this.prevState.explosions).filter(
      (id) => !this.state.explosions[id],
    );
    if (removedExplosions.length > 0) diff.removedExplosions = removedExplosions;

    // Items: new
    const newItems: Record<string, Item> = {};
    for (const [id, item] of Object.entries(this.state.items)) {
      if (!this.prevState.items[id]) newItems[id] = item;
    }
    if (Object.keys(newItems).length > 0) diff.items = newItems;

    // Items: removed
    const removedItems = Object.keys(this.prevState.items).filter((id) => !this.state.items[id]);
    if (removedItems.length > 0) diff.removedItems = removedItems;

    return diff;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private toSharedPlayer(sp: ServerPlayer): Player {
    return {
      id: sp.id,
      displayName: sp.displayName,
      position: { x: sp.position.x, y: sp.position.y },
      pixelX: sp.pixelX,
      pixelY: sp.pixelY,
      alive: sp.alive,
      maxBombs: sp.maxBombs,
      activeBombs: sp.activeBombs,
      blastRadius: sp.blastRadius,
      speedMultiplier: sp.speedMultiplier,
      speedDebuffUntil: sp.speedDebuffUntil,
      isReady: sp.isReady,
      ...(sp.isBot ? { isBot: true } : {}),
    };
  }

  private cloneState(): GameState {
    return {
      grid: [...this.state.grid],
      players: Object.fromEntries(
        Object.entries(this.state.players).map(([id, p]) => [
          id,
          { ...p, position: { ...p.position } },
        ]),
      ),
      bombs: Object.fromEntries(
        Object.entries(this.state.bombs).map(([id, b]) => [
          id,
          { ...b, position: { ...b.position } },
        ]),
      ),
      explosions: Object.fromEntries(
        Object.entries(this.state.explosions).map(([id, e]) => [
          id,
          { ...e, tiles: e.tiles.map((t) => ({ ...t })) },
        ]),
      ),
      items: Object.fromEntries(
        Object.entries(this.state.items).map(([id, i]) => [
          id,
          { ...i, position: { ...i.position } },
        ]),
      ),
      tick: this.state.tick,
      serverTime: this.state.serverTime,
    };
  }
}

// ─── Player diff helper ───────────────────────────────────────────────────────

function diffPlayer(current: Player, prev: Player | undefined): Partial<Player> | null {
  if (prev === undefined) return { ...current };

  const changes: Partial<Player> = {};
  let hasChanges = false;

  if (current.alive !== prev.alive) { changes.alive = current.alive; hasChanges = true; }
  if (current.maxBombs !== prev.maxBombs) { changes.maxBombs = current.maxBombs; hasChanges = true; }
  if (current.activeBombs !== prev.activeBombs) { changes.activeBombs = current.activeBombs; hasChanges = true; }
  if (current.blastRadius !== prev.blastRadius) { changes.blastRadius = current.blastRadius; hasChanges = true; }
  if (current.speedMultiplier !== prev.speedMultiplier) { changes.speedMultiplier = current.speedMultiplier; hasChanges = true; }
  if (current.speedDebuffUntil !== prev.speedDebuffUntil) { changes.speedDebuffUntil = current.speedDebuffUntil; hasChanges = true; }
  if (current.isReady !== prev.isReady) { changes.isReady = current.isReady; hasChanges = true; }
  if (current.displayName !== prev.displayName) { changes.displayName = current.displayName; hasChanges = true; }
  if (current.pixelX !== prev.pixelX) { changes.pixelX = current.pixelX; hasChanges = true; }
  if (current.pixelY !== prev.pixelY) { changes.pixelY = current.pixelY; hasChanges = true; }
  if (current.position.x !== prev.position.x || current.position.y !== prev.position.y) {
    changes.position = { ...current.position };
    hasChanges = true;
  }

  return hasChanges ? changes : null;
}
