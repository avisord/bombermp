import {
  GRID_COLS,
  GRID_ROWS,
  TILE_SIZE,
  TileType,
  ItemType,
  EXPLOSION_DURATION_MS,
} from '@bombermp/shared';
import type { GameState } from '@bombermp/shared';
import {
  SPRITES,
  BOMB_SHEET,
  EXPLOSION_SHEET,
  ITEM_SHEET,
  ITEM_COL,
  WALL_HARD_CROP,
  WALL_SOFT_CROP,
} from './sprites.js';

// ─── Fallback palette (canvas-drawn when sprites haven't loaded) ──────────────

const FALLBACK: Record<TileType, string> = {
  [TileType.EMPTY]:     '#F5F0E8',
  [TileType.WALL_HARD]: '#334155',
  [TileType.WALL_SOFT]: '#A78BFA',
  [TileType.BOMB]:      '#F5F0E8',
  [TileType.EXPLOSION]: '#FDE68A',
  [TileType.ITEM]:      '#F5F0E8',
};

// Violet · Pink · Amber · Emerald (stays in sync with ui/index.ts PLAYER_COLORS)
const PLAYER_COLORS    = ['#8B5CF6', '#F472B6', '#FBBF24', '#34D399'] as const;
const PLAYER_COLORS_DK = ['#6D28D9', '#DB2777', '#D97706', '#059669'] as const;

// ─── Explosion timestamp tracking ────────────────────────────────────────────

const explosionStartMs = new Map<number, number>();

/** Call on game reset so stale timestamps don't bleed across rounds. */
export function clearExplosionTimestamps(): void {
  explosionStartMs.clear();
}

// ─── Main render ─────────────────────────────────────────────────────────────

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  myPlayerId: string,
  playerSlotMap: Map<string, number>,
): void {
  const canvasW = GRID_COLS * TILE_SIZE;
  const canvasH = GRID_ROWS * TILE_SIZE;
  const now     = Date.now();

  ctx.clearRect(0, 0, canvasW, canvasH);

  // Sync explosion timestamps: add new tiles, remove stale ones
  for (let i = 0; i < state.grid.length; i++) {
    if (state.grid[i] === TileType.EXPLOSION) {
      if (!explosionStartMs.has(i)) explosionStartMs.set(i, now);
    } else {
      explosionStartMs.delete(i);
    }
  }

  // ── Grid tiles ────────────────────────────────────────────────────────────
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const index = row * GRID_COLS + col;
      const tile  = state.grid[index] ?? TileType.EMPTY;
      drawTile(ctx, tile, col * TILE_SIZE, row * TILE_SIZE, index, now);
    }
  }

  // ── Items ────────────────────────────────────────────────────────────────
  for (const item of Object.values(state.items)) {
    drawItem(ctx, item.type, item.position.x * TILE_SIZE, item.position.y * TILE_SIZE);
  }

  // ── Bombs ────────────────────────────────────────────────────────────────
  for (const bomb of Object.values(state.bombs)) {
    drawBomb(ctx, bomb.position.x * TILE_SIZE, bomb.position.y * TILE_SIZE, bomb.detonatesAt, now);
  }

  // ── Players ──────────────────────────────────────────────────────────────
  for (const [id, player] of Object.entries(state.players)) {
    if (player.alive) drawPlayer(ctx, player, id, myPlayerId, playerSlotMap);
  }
}

// ─── Tile drawing ─────────────────────────────────────────────────────────────

function drawTile(
  ctx: CanvasRenderingContext2D,
  tile: TileType,
  x: number,
  y: number,
  index: number,
  now: number,
): void {
  // Always draw the floor underneath everything
  ctx.fillStyle = FALLBACK[TileType.EMPTY];
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

  switch (tile) {
    case TileType.EMPTY:
    case TileType.BOMB:
    case TileType.ITEM:
      break; // floor already drawn above

    case TileType.WALL_HARD:
      if (SPRITES.wallHard) {
        ctx.drawImage(
          SPRITES.wallHard,
          WALL_HARD_CROP.sx, WALL_HARD_CROP.sy, WALL_HARD_CROP.sw, WALL_HARD_CROP.sh,
          x, y, TILE_SIZE, TILE_SIZE,
        );
      } else {
        ctx.fillStyle = FALLBACK[TileType.WALL_HARD];
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
      }
      break;

    case TileType.WALL_SOFT:
      if (SPRITES.wallSoft) {
        ctx.drawImage(
          SPRITES.wallSoft,
          WALL_SOFT_CROP.sx, WALL_SOFT_CROP.sy, WALL_SOFT_CROP.sw, WALL_SOFT_CROP.sh,
          x, y, TILE_SIZE, TILE_SIZE,
        );
      } else {
        ctx.fillStyle = FALLBACK[TileType.WALL_SOFT];
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 4, y + TILE_SIZE - 4);
        ctx.lineTo(x + TILE_SIZE - 4, y + 4);
        ctx.stroke();
      }
      break;

    case TileType.EXPLOSION:
      drawExplosionFrame(ctx, x, y, index, now);
      break;
  }
}

// ─── Explosion animation ──────────────────────────────────────────────────────

function drawExplosionFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  index: number,
  now: number,
): void {
  if (!SPRITES.explosionSheet) {
    ctx.fillStyle = FALLBACK[TileType.EXPLOSION];
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = '#F472B6';
    const pad = TILE_SIZE * 0.28;
    ctx.fillRect(x + pad, y + pad, TILE_SIZE - pad * 2, TILE_SIZE - pad * 2);
    return;
  }

  const startMs  = explosionStartMs.get(index) ?? now;
  const progress = Math.min(1, (now - startMs) / EXPLOSION_DURATION_MS);
  const frame    = Math.min(EXPLOSION_SHEET.total - 1, Math.floor(progress * EXPLOSION_SHEET.total));

  const srcX = (frame % EXPLOSION_SHEET.cols) * EXPLOSION_SHEET.frameW;
  const srcY = Math.floor(frame / EXPLOSION_SHEET.cols) * EXPLOSION_SHEET.frameH;

  ctx.drawImage(
    SPRITES.explosionSheet,
    srcX, srcY, EXPLOSION_SHEET.frameW, EXPLOSION_SHEET.frameH,
    x, y, TILE_SIZE, TILE_SIZE,
  );
}

// ─── Item drawing ─────────────────────────────────────────────────────────────

function drawItem(ctx: CanvasRenderingContext2D, type: ItemType, x: number, y: number): void {
  if (!SPRITES.itemSheet) {
    const COLORS: Record<ItemType, string> = {
      [ItemType.BOMB_UP]:    '#34D399',
      [ItemType.FIRE_UP]:    '#FBBF24',
      [ItemType.SPEED_DOWN]: '#F472B6',
    };
    const LABELS: Record<ItemType, string> = {
      [ItemType.BOMB_UP]:    '+B',
      [ItemType.FIRE_UP]:    '+F',
      [ItemType.SPEED_DOWN]: '-S',
    };
    const cx = x + TILE_SIZE / 2;
    const cy = y + TILE_SIZE / 2;
    const r  = TILE_SIZE * 0.3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = COLORS[type];
    ctx.fill();
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle    = '#1E293B';
    ctx.font         = `bold ${Math.floor(TILE_SIZE * 0.26)}px 'Outfit', system-ui`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(LABELS[type], cx, cy);
    return;
  }

  const colKey = type === ItemType.FIRE_UP    ? 'FIRE_UP'
               : type === ItemType.SPEED_DOWN ? 'SPEED_DOWN'
               : 'BOMB_UP';
  const srcX   = ITEM_COL[colKey] * ITEM_SHEET.frameW;
  const pad    = TILE_SIZE * 0.04;

  ctx.drawImage(
    SPRITES.itemSheet,
    srcX, 0, ITEM_SHEET.frameW, ITEM_SHEET.frameH,
    x + pad, y + pad, TILE_SIZE - pad * 2, TILE_SIZE - pad * 2,
  );
}

// ─── Bomb animation ───────────────────────────────────────────────────────────

function drawBomb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  detonatesAt: number,
  now: number,
): void {
  if (!SPRITES.bombSheet) {
    // Fallback canvas bomb
    const cx = x + TILE_SIZE / 2;
    const cy = y + TILE_SIZE / 2;
    const r  = TILE_SIZE * 0.35;
    const fuseProgress = Math.max(0, Math.min(1, (detonatesAt - now) / 3000));
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#E2E8F0';
    ctx.fill();
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 2;
    ctx.stroke();
    const fuseColor = fuseProgress > 0.4 ? '#8B5CF6' : '#F472B6';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + fuseProgress * Math.PI * 2);
    ctx.strokeStyle = fuseColor;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = '#1E293B';
    ctx.fill();
    return;
  }

  // bomb-sheet.png has real per-pixel alpha — draw normally.
  // First 10 frames: lively sparking fuse (loop at 8fps).
  // Last 5 frames (10–14): dying fuse, used proportionally in the final 30%.
  const fuseProgress = 1 - Math.max(0, Math.min(1, (detonatesAt - now) / 3000));
  let frame: number;
  if (fuseProgress < 0.7) {
    frame = Math.floor((now / 125) % 10); // 8fps loop over frames 0–9
  } else {
    const t = (fuseProgress - 0.7) / 0.3;
    frame = 10 + Math.min(4, Math.floor(t * 5));
  }

  const srcX = (frame % BOMB_SHEET.cols) * BOMB_SHEET.frameW;
  const srcY = Math.floor(frame / BOMB_SHEET.cols) * BOMB_SHEET.frameH;

  ctx.drawImage(
    SPRITES.bombSheet,
    srcX, srcY, BOMB_SHEET.frameW, BOMB_SHEET.frameH,
    x, y, TILE_SIZE, TILE_SIZE,
  );
}

// ─── Player drawing ───────────────────────────────────────────────────────────

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: GameState['players'][string],
  id: string,
  myPlayerId: string,
  playerSlotMap: Map<string, number>,
): void {
  const slotIndex = playerSlotMap.get(id) ?? 0;
  const color     = PLAYER_COLORS[slotIndex % PLAYER_COLORS.length]    ?? '#8B5CF6';
  const colorDk   = PLAYER_COLORS_DK[slotIndex % PLAYER_COLORS_DK.length] ?? '#6D28D9';
  const isMe      = id === myPlayerId;

  const cx = player.pixelX * TILE_SIZE + TILE_SIZE / 2;
  const cy = player.pixelY * TILE_SIZE + TILE_SIZE / 2;
  const r  = TILE_SIZE * 0.36;

  // Hard offset shadow (design system "pop" shadow)
  ctx.beginPath();
  ctx.arc(cx + 3, cy + 3, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(30,41,59,0.3)';
  ctx.fill();

  // Player circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = colorDk;
  ctx.lineWidth = 2;
  ctx.stroke();

  // "Me" double ring
  if (isMe) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.strokeStyle = colorDk;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Name label
  const label = isMe ? `${player.displayName} ★` : player.displayName;
  ctx.font         = `bold 11px 'Outfit', system-ui, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle    = 'rgba(30,41,59,0.55)';
  ctx.fillText(label, cx + 1, cy - r - 3);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(label, cx, cy - r - 4);
}
