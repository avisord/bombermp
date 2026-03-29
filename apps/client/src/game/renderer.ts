import {
  GRID_COLS,
  GRID_ROWS,
  TILE_SIZE,
  TileType,
  ItemType,
  LATENCY_GREEN_THRESHOLD_MS,
  LATENCY_YELLOW_THRESHOLD_MS,
} from '@bombermp/shared';
import type { GameState } from '@bombermp/shared';

// ─── Palette ──────────────────────────────────────────────────────────────────

const TILE_COLORS: Record<TileType, string> = {
  [TileType.EMPTY]:     '#1e1e2e',
  [TileType.WALL_HARD]: '#44475a',
  [TileType.WALL_SOFT]: '#6272a4',
  [TileType.BOMB]:      '#1e1e2e', // drawn from state.bombs
  [TileType.EXPLOSION]: '#ffb86c',
  [TileType.ITEM]:      '#1e1e2e', // drawn from state.items
};

const PLAYER_COLORS = ['#ff5555', '#8be9fd', '#50fa7b', '#f1fa8c'] as const;

const HUD_HEIGHT = 36; // px strip at top

// ─── Render ───────────────────────────────────────────────────────────────────

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  myPlayerId: string,
  playerSlotMap: Map<string, number>,
  rtt: number,
): void {
  const canvasW = GRID_COLS * TILE_SIZE;
  const canvasH = GRID_ROWS * TILE_SIZE + HUD_HEIGHT;

  ctx.clearRect(0, 0, canvasW, canvasH);

  const offsetY = HUD_HEIGHT;

  // ── Grid tiles ──────────────────────────────────────────────────────────────
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const index = row * GRID_COLS + col;
      const tile = state.grid[index] ?? TileType.EMPTY;
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE + offsetY;

      ctx.fillStyle = TILE_COLORS[tile] ?? '#1e1e2e';
      ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

      // Explosion center dot
      if (tile === TileType.EXPLOSION) {
        ctx.fillStyle = '#ff5555';
        const pad = TILE_SIZE * 0.3;
        ctx.fillRect(x + pad, y + pad, TILE_SIZE - pad * 2, TILE_SIZE - pad * 2);
      }

      // Grid lines for hard walls — subtle outline
      if (tile === TileType.WALL_HARD || tile === TileType.WALL_SOFT) {
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
      }
    }
  }

  // ── Items ───────────────────────────────────────────────────────────────────
  for (const item of Object.values(state.items)) {
    const x = item.position.x * TILE_SIZE;
    const y = item.position.y * TILE_SIZE + offsetY;
    const cx = x + TILE_SIZE / 2;
    const cy = y + TILE_SIZE / 2;

    ctx.beginPath();
    ctx.arc(cx, cy, TILE_SIZE * 0.28, 0, Math.PI * 2);

    switch (item.type) {
      case ItemType.BOMB_UP:
        ctx.fillStyle = '#50fa7b';
        break;
      case ItemType.FIRE_UP:
        ctx.fillStyle = '#ffb86c';
        break;
      case ItemType.SPEED_DOWN:
        ctx.fillStyle = '#ff5555';
        break;
    }
    ctx.fill();

    ctx.fillStyle = '#1e1e2e';
    ctx.font = `bold ${Math.floor(TILE_SIZE * 0.28)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = item.type === ItemType.BOMB_UP ? '+B' : item.type === ItemType.FIRE_UP ? '+F' : '-S';
    ctx.fillText(label, cx, cy);
  }

  // ── Bombs ───────────────────────────────────────────────────────────────────
  for (const bomb of Object.values(state.bombs)) {
    const x = bomb.position.x * TILE_SIZE;
    const y = bomb.position.y * TILE_SIZE + offsetY;
    const cx = x + TILE_SIZE / 2;
    const cy = y + TILE_SIZE / 2;
    const radius = TILE_SIZE * 0.35;

    // Fuse ring: shrinks as detonation approaches
    const now = Date.now();
    const fuseProgress = Math.max(0, Math.min(1, (bomb.detonatesAt - now) / 3000));

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#282a36';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + fuseProgress * Math.PI * 2);
    ctx.strokeStyle = '#ff5555';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Bomb body
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.65, 0, Math.PI * 2);
    ctx.fillStyle = '#ff5555';
    ctx.fill();
  }

  // ── Players ─────────────────────────────────────────────────────────────────
  for (const [id, player] of Object.entries(state.players)) {
    if (!player.alive) continue;

    const slotIndex = playerSlotMap.get(id) ?? 0;
    const color = PLAYER_COLORS[slotIndex % PLAYER_COLORS.length] ?? '#ffffff';
    const isMe = id === myPlayerId;

    // Use pixel position for smooth movement
    const cx = player.pixelX * TILE_SIZE + TILE_SIZE / 2;
    const cy = player.pixelY * TILE_SIZE + TILE_SIZE / 2 + offsetY;
    const radius = TILE_SIZE * 0.38;

    // Shadow for depth
    ctx.beginPath();
    ctx.arc(cx + 2, cy + 2, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();

    // Player circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // "Me" ring
    if (isMe) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Name label
    const label = isMe ? `${player.displayName} (you)` : player.displayName;
    ctx.font = `11px 'Segoe UI', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(label, cx + 1, cy - radius - 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, cx, cy - radius - 2);
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────
  drawHUD(ctx, state, myPlayerId, rtt, canvasW);
}

function drawHUD(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  myPlayerId: string,
  rtt: number,
  canvasW: number,
): void {
  // Background strip
  ctx.fillStyle = 'rgba(20, 20, 35, 0.9)';
  ctx.fillRect(0, 0, canvasW, HUD_HEIGHT);

  const myPlayer = state.players[myPlayerId];

  if (myPlayer) {
    ctx.font = `13px 'Segoe UI', system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const midY = HUD_HEIGHT / 2;

    // Bomb count
    ctx.fillStyle = '#ff5555';
    ctx.textAlign = 'left';
    ctx.fillText(`💣 ${myPlayer.activeBombs}/${myPlayer.maxBombs}`, 10, midY);

    // Blast radius
    ctx.fillStyle = '#ffb86c';
    ctx.fillText(`🔥 ${myPlayer.blastRadius}`, 90, midY);
  }

  // Latency badge
  let latencyColor: string;
  if (rtt < LATENCY_GREEN_THRESHOLD_MS) {
    latencyColor = '#50fa7b';
  } else if (rtt < LATENCY_YELLOW_THRESHOLD_MS) {
    latencyColor = '#f1fa8c';
  } else {
    latencyColor = '#ff5555';
  }

  ctx.font = `12px monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  // Colored dot
  const dotX = canvasW - 55;
  const dotY = HUD_HEIGHT / 2;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
  ctx.fillStyle = latencyColor;
  ctx.fill();

  ctx.fillStyle = latencyColor;
  ctx.fillText(`${rtt}ms`, canvasW - 8, HUD_HEIGHT / 2);
}
