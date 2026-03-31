import {
  LATENCY_GREEN_THRESHOLD_MS,
  LATENCY_YELLOW_THRESHOLD_MS,
} from '@bombermp/shared';
import { SPRITES, BOMB_SHEET, ITEM_SHEET, ITEM_COL } from '../game/sprites.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ICON_SIZE      = 44; // px — icon canvas dimensions
const BOMB_ANIM_FPS  = 8;  // frames per second for the bomb animation

// ─── Module state ─────────────────────────────────────────────────────────────

let hudEl:        HTMLElement | null = null;
let bombIconCtx:  CanvasRenderingContext2D | null = null;
let fireIconCtx:  CanvasRenderingContext2D | null = null;
let lastBombFrame = -1;
let fireDrawn     = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Builds the HUD DOM and inserts it at the top of `container`.
 * Call once at application boot — the HUD persists between game rounds.
 */
export function initHUD(container: HTMLElement): void {
  // Remove any previous HUD (safety)
  container.querySelector('#game-hud')?.remove();

  const div = document.createElement('div');
  div.id        = 'game-hud';
  div.className = 'bmp-hud';
  div.setAttribute('aria-label', 'Game HUD');
  div.innerHTML = `
    <div class="bmp-hud__left">
      <div class="bmp-hud__stat" title="Active bombs / capacity">
        <canvas id="hud-bomb-icon" class="bmp-hud__sprite" width="${ICON_SIZE}" height="${ICON_SIZE}"></canvas>
        <span class="bmp-hud__val" id="hud-bombs">—</span>
      </div>
      <div class="bmp-hud__sep" aria-hidden="true"></div>
      <div class="bmp-hud__stat" title="Blast radius">
        <canvas id="hud-fire-icon" class="bmp-hud__sprite" width="${ICON_SIZE}" height="${ICON_SIZE}"></canvas>
        <span class="bmp-hud__val" id="hud-blast">—</span>
      </div>
    </div>
    <div class="bmp-hud__right" aria-label="Latency">
      <span class="bmp-hud__dot" id="hud-dot" aria-hidden="true"></span>
      <span class="bmp-hud__ms" id="hud-ms">—</span>
    </div>
  `;

  container.insertBefore(div, container.firstChild);
  hudEl = div;

  bombIconCtx = div.querySelector<HTMLCanvasElement>('#hud-bomb-icon')!.getContext('2d');
  fireIconCtx = div.querySelector<HTMLCanvasElement>('#hud-fire-icon')!.getContext('2d');

  // Draw fire icon immediately if sprites are already loaded
  tryDrawFireIcon();
  injectHUDStyles();
}

// ─── Per-frame tick (bomb animation) ─────────────────────────────────────────

/**
 * Drive the looping bomb-fuse animation.
 * Call this from the render loop — internally throttled to BOMB_ANIM_FPS.
 */
export function tickHUDIcons(): void {
  // Bomb: loop all 15 frames at BOMB_ANIM_FPS
  if (bombIconCtx && SPRITES.bombSheet) {
    const frame = Math.floor(Date.now() / (1000 / BOMB_ANIM_FPS)) % BOMB_SHEET.total;
    if (frame !== lastBombFrame) {
      lastBombFrame = frame;
      const srcX = (frame % BOMB_SHEET.cols) * BOMB_SHEET.frameW;
      const srcY = Math.floor(frame / BOMB_SHEET.cols) * BOMB_SHEET.frameH;
      bombIconCtx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
      bombIconCtx.drawImage(
        SPRITES.bombSheet,
        srcX, srcY, BOMB_SHEET.frameW, BOMB_SHEET.frameH,
        0, 0, ICON_SIZE, ICON_SIZE,
      );
    }
  }

  // Fire: static, draw once when sprite becomes available
  if (!fireDrawn) tryDrawFireIcon();
}

function tryDrawFireIcon(): void {
  if (fireDrawn || !fireIconCtx || !SPRITES.itemSheet) return;
  const srcX = ITEM_COL.FIRE_UP * ITEM_SHEET.frameW;
  fireIconCtx.drawImage(
    SPRITES.itemSheet,
    srcX, 0, ITEM_SHEET.frameW, ITEM_SHEET.frameH,
    0, 0, ICON_SIZE, ICON_SIZE,
  );
  fireDrawn = true;
}

// ─── Stats update ─────────────────────────────────────────────────────────────

export function updateHUDStats(
  activeBombs: number,
  maxBombs: number,
  blastRadius: number,
): void {
  if (!hudEl) return;
  const bombsEl = hudEl.querySelector<HTMLElement>('#hud-bombs');
  const blastEl = hudEl.querySelector<HTMLElement>('#hud-blast');
  if (bombsEl) bombsEl.textContent = `${activeBombs}/${maxBombs}`;
  if (blastEl) blastEl.textContent = String(blastRadius);
}

export function updateHUDLatency(rtt: number): void {
  if (!hudEl) return;
  const dotEl = hudEl.querySelector<HTMLElement>('#hud-dot');
  const msEl  = hudEl.querySelector<HTMLElement>('#hud-ms');
  const color = rtt < LATENCY_GREEN_THRESHOLD_MS
    ? '#34D399'
    : rtt < LATENCY_YELLOW_THRESHOLD_MS
    ? '#FBBF24'
    : '#F472B6';
  if (dotEl) dotEl.style.background = color;
  if (msEl)  { msEl.style.color = color; msEl.textContent = `${rtt}ms`; }
}

// ─── Show / hide ──────────────────────────────────────────────────────────────

export function showHUD(): void {
  if (hudEl) hudEl.style.display = '';
}

export function hideHUD(): void {
  if (hudEl) hudEl.style.display = 'none';
  // Reset animation state so next game starts cleanly
  lastBombFrame = -1;
  fireDrawn     = false;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

let hudStylesInjected = false;

function injectHUDStyles(): void {
  if (hudStylesInjected) return;
  hudStylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    /* ── HUD bar ─────────────────────────────────────────────── */
    .bmp-hud {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #1E293B;
      padding: 5px 14px;
      gap: 1rem;
      /* Width matches the canvas via the shared #game-wrapper */
    }

    /* ── Left stat group ─────────────────────────────────────── */
    .bmp-hud__left {
      display: flex;
      align-items: center;
      gap: 0.7rem;
    }

    .bmp-hud__stat {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    /* Icon canvas — pixelated so sprites stay crisp at any size */
    .bmp-hud__sprite {
      display: block;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }

    .bmp-hud__val {
      font-family: 'Outfit', system-ui, sans-serif;
      font-weight: 700;
      font-size: 1.05rem;
      color: #FFFFFF;
      min-width: 3ch;
      letter-spacing: 0.03em;
    }

    /* Thin vertical separator between stat groups */
    .bmp-hud__sep {
      width: 1.5px;
      height: 22px;
      background: rgba(255, 255, 255, 0.14);
      border-radius: 1px;
      flex-shrink: 0;
    }

    /* ── Right latency group ─────────────────────────────────── */
    .bmp-hud__right {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    .bmp-hud__dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #34D399;
      flex-shrink: 0;
      transition: background 0.4s;
    }

    .bmp-hud__ms {
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      font-weight: 600;
      font-size: 0.82rem;
      color: #34D399;
      min-width: 4ch;
      text-align: right;
      transition: color 0.4s;
    }
  `;
  document.head.appendChild(style);
}
