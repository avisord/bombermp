import {
  GRID_COLS,
  GRID_ROWS,
  TILE_SIZE,
  TileType,
  ItemType,
  EXPLOSION_DURATION_MS,
  BOMB_FUSE_MS,
  Direction,
} from '@bombermp/shared';
import type { GameState } from '@bombermp/shared';
import {
  SPRITES,
  EXPLOSION_SHEET,
  ITEM_SHEET,
  ITEM_COL,
  WALL_HARD_CROP,
  WALL_SOFT_CROP,
  EMPTY_CROP,
} from './sprites.js';
import type { PlayerAppearance, BodyShape, EyeStyle, HatStyle, Accessory } from './appearance.js';
import { appearanceFromId, DIRECTION_ANGLE } from './appearance.js';

// ─── Bomb pulse config ────────────────────────────────────────────────────────
// Tune these to change how the bomb fades in/out.

const BOMB_PULSE_MIN_ALPHA = 0.5;  // alpha when pulse is at its dimmest
const BOMB_PULSE_MAX_ALPHA = 1.0;  // alpha when pulse is at its brightest
const BOMB_PULSE_BASE_HZ   = 1.5;  // pulses per second with a fresh fuse
const BOMB_PULSE_URGENT_HZ = 5.5;  // pulses per second just before detonation

// ─── Fallback palette (canvas-drawn when sprites haven't loaded) ──────────────

const FALLBACK: Record<TileType, string> = {
  [TileType.EMPTY]:     '#aad751',
  // [TileType.EMPTY]:     '#F5F0E8',
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
  predictedPos: { x: number; y: number } | null,
  playerDirections: Map<string, Direction>,
  myAppearance: PlayerAppearance,
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
    if (player.alive) {
      const pos        = (id === myPlayerId && predictedPos) ? predictedPos : null;
      const facing     = playerDirections.get(id) ?? Direction.DOWN;
      const appearance = id === myPlayerId ? myAppearance : appearanceFromId(id);
      drawPlayer(ctx, player, id, myPlayerId, playerSlotMap, pos, facing, appearance, now);
    }
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
      if (SPRITES.empty) {
        ctx.drawImage(
          SPRITES.empty,
          EMPTY_CROP.sx, EMPTY_CROP.sy, EMPTY_CROP.sw, EMPTY_CROP.sh,
          x, y, TILE_SIZE, TILE_SIZE,
        );
      } else {
        ctx.fillStyle = FALLBACK[TileType.EMPTY];
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.lineWidth = 1;
      }
      break;

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

// ─── Bomb drawing ─────────────────────────────────────────────────────────────

function drawBomb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  detonatesAt: number,
  now: number,
): void {
  // Time elapsed since this specific bomb was placed (always 0–BOMB_FUSE_MS).
  // Using elapsed (not absolute now) keeps the phase multiplier small so that
  // changes in hz don't amplify into thousands of Hz via (now/1000 * dhz/dt).
  const elapsedMs    = Math.max(0, BOMB_FUSE_MS - (detonatesAt - now));
  const fuseProgress = Math.min(1, elapsedMs / BOMB_FUSE_MS);

  // Pulse frequency ramps up linearly from base → urgent as fuse burns
  const hz = BOMB_PULSE_BASE_HZ + (BOMB_PULSE_URGENT_HZ - BOMB_PULSE_BASE_HZ) * fuseProgress;

  // Smooth sine wave → [0, 1] → mapped to alpha range
  const sine  = Math.sin((elapsedMs / 1000) * hz * Math.PI * 2) * 0.5 + 0.5;
  const alpha = BOMB_PULSE_MIN_ALPHA + (BOMB_PULSE_MAX_ALPHA - BOMB_PULSE_MIN_ALPHA) * sine;

  if (!SPRITES.bombPlain) {
    // Fallback: plain circle with pulsing fill
    const cx = x + TILE_SIZE / 2;
    const cy = y + TILE_SIZE / 2;
    const r  = TILE_SIZE * 0.35;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#1E293B';
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }

  const pad = TILE_SIZE * 0.05;
  ctx.globalAlpha = alpha;
  ctx.drawImage(
    SPRITES.bombPlain,
    x + pad, y + pad, TILE_SIZE - pad * 2, TILE_SIZE - pad * 2,
  );
  ctx.globalAlpha = 1;
}

// ─── Player drawing ───────────────────────────────────────────────────────────

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: GameState['players'][string],
  id: string,
  myPlayerId: string,
  playerSlotMap: Map<string, number>,
  predictedPos: { x: number; y: number } | null,
  facing: Direction,
  appearance: PlayerAppearance,
  now: number,
): void {
  const slotIndex = playerSlotMap.get(id) ?? 0;
  const color     = PLAYER_COLORS[slotIndex % PLAYER_COLORS.length]    ?? '#8B5CF6';
  const colorDk   = PLAYER_COLORS_DK[slotIndex % PLAYER_COLORS_DK.length] ?? '#6D28D9';
  const isMe      = id === myPlayerId;

  const renderX = predictedPos ? predictedPos.x : player.pixelX;
  const renderY = predictedPos ? predictedPos.y : player.pixelY;
  const cx = renderX * TILE_SIZE + TILE_SIZE / 2;
  const cy = renderY * TILE_SIZE + TILE_SIZE / 2;
  const r  = TILE_SIZE * 0.36;

  drawCharacter(ctx, cx, cy, r, color, colorDk, appearance, facing, now);

  // "Me" double ring
  // if (isMe) {
  //   ctx.beginPath();
  //   ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  //   ctx.strokeStyle = '#FFFFFF';
  //   ctx.lineWidth = 3;
  //   ctx.stroke();
  //   ctx.beginPath();
  //   ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  //   ctx.strokeStyle = colorDk;
  //   ctx.lineWidth = 1.5;
  //   ctx.stroke();
  // }

  // Name label
  const label = isMe ? `${player.displayName} ★` : player.displayName;
  ctx.font         = `bold 13px 'Outfit', system-ui, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle    = 'rgba(30,41,59,0.55)';
  ctx.fillText(label, cx + 1, cy + r + 19);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(label, cx, cy + r + 20);
}

// ─── Character drawing (shared with customize preview) ────────────────────────

/**
 * Draws the player character body at (cx, cy) with radius r.
 * Used by both the game renderer and the customize-panel live preview.
 */
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  color: string, colorDk: string,
  appearance: PlayerAppearance,
  facing: Direction,
  now: number,
): void {
  const angle = DIRECTION_ANGLE[facing];
  const sqR   = r * 0.88; // half-side for square body

  // Shadow
  ctx.beginPath();
  ctx.fillStyle = 'rgba(30,41,59,0.28)';
  if (appearance.body === 'square') {
    ctx.roundRect(cx - sqR + 3, cy - sqR + 3, sqR * 2, sqR * 2, sqR * 0.28);
  } else {
    ctx.arc(cx + 3, cy + 3, r, 0, Math.PI * 2);
  }
  ctx.fill();

  // Body
  ctx.beginPath();
  if (appearance.body === 'square') {
    ctx.roundRect(cx - sqR, cy - sqR, sqR * 2, sqR * 2, sqR * 0.28);
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = colorDk;
  ctx.lineWidth = 2;
  ctx.stroke();

  drawHat(ctx, cx, cy, r, appearance.hat, color, colorDk, now);
  if (appearance.accessory === 'blush') drawBlush(ctx, cx, cy, r, angle);
  drawEyes(ctx, cx, cy, r, angle, appearance.eyes);
  if (appearance.accessory === 'scar') drawScar(ctx, cx, cy, r, angle);
}

// ─── Hat ─────────────────────────────────────────────────────────────────────

function drawHat(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  style: HatStyle,
  color: string, colorDk: string,
  now: number,
): void {
  if (style === 'none') return;
  const top = cy - r; // top edge of the body circle

  switch (style) {
    case 'cap': {
      const cr = r * 0.68;
      // Dome
      ctx.beginPath();
      ctx.arc(cx, top, cr, Math.PI, 0, false);
      ctx.fillStyle = colorDk;
      ctx.fill();
      // Brim strip
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(cx - cr * 1.2, top - r * 0.07, cr * 2.4, r * 0.13);
      break;
    }
    case 'beanie': {
      const br = r * 0.68;
      ctx.beginPath();
      ctx.arc(cx, top, br, Math.PI, 0, false);
      ctx.fillStyle = colorDk;
      ctx.fill();
      ctx.strokeStyle = '#1E293B';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Stripes (clipped to dome)
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, top, br, Math.PI, 0, false);
      ctx.clip();
      for (let i = 1; i <= 3; i++) {
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(cx - br, top - br + br * 0.22 * i, br * 2, br * 0.1);
      }
      ctx.restore();
      // Pom
      ctx.beginPath();
      ctx.arc(cx, top - br, r * 0.13, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = colorDk;
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    case 'crown': {
      const ph = r * 0.5,  hw = r * 0.75;
      ctx.beginPath();
      ctx.moveTo(cx - hw,           top);
      ctx.lineTo(cx - hw * 0.55,    top - ph * 0.6);
      ctx.lineTo(cx - hw * 0.18,    top - ph * 0.12);
      ctx.lineTo(cx,                top - ph);
      ctx.lineTo(cx + hw * 0.18,    top - ph * 0.12);
      ctx.lineTo(cx + hw * 0.55,    top - ph * 0.6);
      ctx.lineTo(cx + hw,           top);
      ctx.closePath();
      ctx.fillStyle = '#FBBF24';
      ctx.fill();
      ctx.strokeStyle = '#92400E';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Gems
      for (const [gx, gy] of [
        [cx,          top - ph + r * 0.06],
        [cx - hw * 0.55, top - ph * 0.6 + r * 0.04],
        [cx + hw * 0.55, top - ph * 0.6 + r * 0.04],
      ] as [number, number][]) {
        ctx.beginPath();
        ctx.arc(gx, gy, r * 0.065, 0, Math.PI * 2);
        ctx.fillStyle = '#DC2626';
        ctx.fill();
      }
      break;
    }
    case 'antenna': {
      const bob   = Math.sin(now / 320) * r * 0.07;
      const stemH = r * 0.55;
      const tipR  = r * 0.1;
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx + bob, top - stemH);
      ctx.strokeStyle = '#1E293B';
      ctx.lineWidth = r * 0.07;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + bob, top - stemH - tipR, tipR, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = colorDk;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
    }
  }
}

// ─── Eyes ─────────────────────────────────────────────────────────────────────

function drawEyes(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  angle: number,
  style: EyeStyle,
): void {
  // Eye positions in local "facing right" frame: (fx, ±fy).
  // Rotated to world space by the facing angle.
  //   eye0  →  upper side  →  local (fx, -fy)
  //   eye1  →  lower side  →  local (fx, +fy)
  const fx = r * 0.38, fy = r * 0.22;
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const eyes: [number, number][] = [
    [cx + fx * cosA + fy * sinA, cy + fx * sinA - fy * cosA],
    [cx + fx * cosA - fy * sinA, cy + fx * sinA + fy * cosA],
  ];

  switch (style) {
    case 'dot': {
      ctx.fillStyle = '#1E293B';
      for (const [ex, ey] of eyes) {
        ctx.beginPath();
        ctx.arc(ex, ey, r * 0.078, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'cute': {
      const er = r * 0.12;
      for (const [ex, ey] of eyes) {
        ctx.beginPath();
        ctx.arc(ex, ey, er, 0, Math.PI * 2);
        ctx.fillStyle = '#1E293B';
        ctx.fill();
        // Shine highlight
        ctx.beginPath();
        ctx.arc(ex - er * 0.3, ey - er * 0.3, er * 0.34, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fill();
      }
      break;
    }
    case 'angry': {
      // Squished horizontal slits (screen-space, always horizontal — readable in any direction)
      for (const [ex, ey] of eyes) {
        ctx.save();
        ctx.translate(ex, ey);
        ctx.scale(1.6, 0.38);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.09, 0, Math.PI * 2);
        ctx.fillStyle = '#1E293B';
        ctx.fill();
        ctx.restore();
      }
      // V-shaped brows above each eye, tilted inward
      // "Above" here means offset toward the back of the head (opposite facing)
      const bLen = r * 0.14;
      for (let i = 0; i < 2; i++) {
        const [ex, ey] = eyes[i]!;
        // Perpendicular to facing, sign flips per eye
        const perpSign = i === 0 ? 1 : -1;
        const perpX = -sinA * perpSign, perpY = cosA * perpSign;
        // Brow hovers slightly behind+above eye
        const baseX = ex - cosA * r * 0.07;
        const baseY = ey - sinA * r * 0.07;
        // Outer end: away from center, slightly further back
        const ox = baseX + perpX * bLen * 0.6 - cosA * bLen * 0.2;
        const oy = baseY + perpY * bLen * 0.6 - sinA * bLen * 0.2;
        // Inner end: toward center line
        const ix = baseX - perpX * bLen * 0.4 + cosA * bLen * 0.1;
        const iy = baseY - perpY * bLen * 0.4 + sinA * bLen * 0.1;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ix, iy);
        ctx.strokeStyle = '#1E293B';
        ctx.lineWidth = r * 0.07;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      break;
    }
    case 'sleepy': {
      // Half-circle (upper half), flat side pointing toward body center
      // Rotate so flat side faces "inward" (opposite facing direction)
      for (const [ex, ey] of eyes) {
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(angle + Math.PI); // flat faces back → open side faces forward
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.1, Math.PI, 0, false);
        ctx.closePath();
        ctx.fillStyle = '#1E293B';
        ctx.fill();
        ctx.restore();
        // Tiny highlight on open side
        ctx.beginPath();
        ctx.arc(ex + cosA * r * 0.02, ey + sinA * r * 0.02, r * 0.03, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fill();
      }
      break;
    }
  }
}

// ─── Accessories ──────────────────────────────────────────────────────────────

function drawBlush(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  angle: number,
): void {
  // Two pink cheek patches at ±50° from the facing direction, ~0.45r out
  const dist   = r * 0.45;
  const blushR = r * 0.15;
  for (const offset of [-Math.PI / 3.6, Math.PI / 3.6]) {
    const bx = cx + Math.cos(angle + offset) * dist;
    const by = cy + Math.sin(angle + offset) * dist;
    ctx.beginPath();
    ctx.arc(bx, by, blushR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(244,114,182,0.48)';
    ctx.fill();
  }
}

function drawScar(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  angle: number,
): void {
  // Short diagonal line on the face, positioned in the facing direction
  const fx = Math.cos(angle) * r * 0.22;
  const fy = Math.sin(angle) * r * 0.22;
  ctx.beginPath();
  ctx.moveTo(cx + fx - r * 0.08, cy + fy - r * 0.09);
  ctx.lineTo(cx + fx + r * 0.06, cy + fy + r * 0.08);
  ctx.strokeStyle = '#DC2626';
  ctx.lineWidth = r * 0.058;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// ─── Customize-panel preview ──────────────────────────────────────────────────

/**
 * Renders a standalone player character to a canvas element.
 * Used by the customize panel — called inside a requestAnimationFrame loop.
 */
export function drawPlayerPreview(
  canvas: HTMLCanvasElement,
  appearance: PlayerAppearance,
  slotIndex: number,
  facing: Direction = Direction.DOWN,
): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cx      = canvas.width / 2;
  const cy      = canvas.height / 2 + 8; // shift down slightly so hat has headroom
  const r       = Math.min(canvas.width, canvas.height) * 0.29;
  const color   = PLAYER_COLORS[slotIndex   % PLAYER_COLORS.length]    ?? '#8B5CF6';
  const colorDk = PLAYER_COLORS_DK[slotIndex % PLAYER_COLORS_DK.length] ?? '#6D28D9';
  drawCharacter(ctx, cx, cy, r, color, colorDk, appearance, facing, Date.now());
}
