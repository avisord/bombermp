/**
 * Bot debug overlay + side panel for /test-game?debugging=bot.
 *
 * The server gates emission behind NODE_ENV !== 'production' AND BOT_DEBUG=1,
 * so this module is only fed frames in local dev. In all other cases the
 * overlay/panel stay empty and never paint.
 */

import {
  GRID_COLS,
  TILE_SIZE,
  type BotDebugFrame,
  type BotDebugSnapshot,
  type Position,
} from '@bombermp/shared';

const PLAYER_COLORS    = ['#8B5CF6', '#F472B6', '#FBBF24', '#34D399'] as const;

let latestFrame: BotDebugFrame | null = null;
let panelEl: HTMLDivElement | null = null;
let bodyEl: HTMLDivElement | null = null;
let speedRowEl: HTMLDivElement | null = null;
let onSpeedChange: ((speed: number) => void) | null = null;
let onStep: (() => void) | null = null;

const SPEED_PRESETS: { label: string; value: number }[] = [
  { label: '1×', value: 1 },
  { label: '½×', value: 0.5 },
  { label: '¼×', value: 0.25 },
  { label: '⅒×', value: 0.1 },
  { label: '⏸', value: 0 },
];

export function isBotDebugRequested(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.pathname !== '/test-game') return false;
  return new URLSearchParams(window.location.search).get('debugging') === 'bot';
}

export function setLatestBotDebug(frame: BotDebugFrame): void {
  latestFrame = frame;
  renderPanel();
}

export function clearBotDebug(): void {
  latestFrame = null;
  if (bodyEl) bodyEl.textContent = 'Bot debug: game ended — waiting for next round…';
}

// ─── Side panel ──────────────────────────────────────────────────────────────

export interface BotDebugPanelHandlers {
  onSetSpeed: (speed: number) => void;
  onStep: () => void;
}

export function mountBotDebugPanel(handlers: BotDebugPanelHandlers): void {
  if (panelEl) return;
  onSpeedChange = handlers.onSetSpeed;
  onStep = handlers.onStep;

  const el = document.createElement('div');
  el.id = 'bot-debug-panel';
  el.style.cssText = [
    'position:fixed',
    'top:8px',
    'right:8px',
    'width:340px',
    'max-height:calc(100vh - 16px)',
    'overflow-y:auto',
    'background:rgba(15,23,42,0.92)',
    'color:#E2E8F0',
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace',
    'font-size:11px',
    'line-height:1.4',
    'padding:10px 12px',
    'border:1px solid #334155',
    'border-radius:6px',
    'z-index:9999',
    'pointer-events:auto',
  ].join(';');

  // Speed control row (rendered once, never re-rendered to keep buttons stable)
  const speed = document.createElement('div');
  speed.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:8px;flex-wrap:wrap';
  speed.innerHTML = `<span style="color:#94A3B8;margin-right:4px">speed:</span>`;
  for (const preset of SPEED_PRESETS) {
    const b = document.createElement('button');
    b.dataset['speed'] = String(preset.value);
    b.textContent = preset.label;
    b.style.cssText = btnCss();
    b.onclick = (): void => {
      onSpeedChange?.(preset.value);
    };
    speed.appendChild(b);
  }
  const stepBtn = document.createElement('button');
  stepBtn.textContent = '▶ step';
  stepBtn.style.cssText = btnCss();
  stepBtn.onclick = (): void => onStep?.();
  speed.appendChild(stepBtn);
  speedRowEl = speed;

  const body = document.createElement('div');
  body.textContent = 'Bot debug: waiting for frame…';
  bodyEl = body;

  el.appendChild(speed);
  el.appendChild(body);
  document.body.appendChild(el);
  panelEl = el;
}

function btnCss(): string {
  return [
    'background:#1E293B',
    'color:#E2E8F0',
    'border:1px solid #475569',
    'border-radius:3px',
    'padding:2px 6px',
    'font-family:inherit',
    'font-size:11px',
    'cursor:pointer',
  ].join(';');
}

export function unmountBotDebugPanel(): void {
  if (!panelEl) return;
  panelEl.remove();
  panelEl = null;
  bodyEl = null;
  speedRowEl = null;
}

function fmtTile(p: Position | null): string {
  return p ? `(${p.x},${p.y})` : '—';
}

function fmtPath(path: Position[] | null): string {
  if (!path || path.length === 0) return '—';
  if (path.length <= 4) return path.map(fmtTile).join(' → ');
  return `${fmtTile(path[0]!)} → … → ${fmtTile(path[path.length - 1]!)} (${path.length})`;
}

function botSlotIndex(snapshot: BotDebugSnapshot): number {
  // Stable slot color from botId hash so panel matches canvas overlay.
  let h = 0;
  for (let i = 0; i < snapshot.botId.length; i++) h = (h * 31 + snapshot.botId.charCodeAt(i)) | 0;
  return Math.abs(h) % PLAYER_COLORS.length;
}

function renderPanel(): void {
  if (!panelEl || !bodyEl || !latestFrame) return;
  panelEl.style.display = 'block';

  // Highlight the active speed button
  if (speedRowEl) {
    const active = latestFrame.speed;
    speedRowEl.querySelectorAll<HTMLButtonElement>('button[data-speed]').forEach((b) => {
      const v = Number(b.dataset['speed']);
      const on = Math.abs(v - active) < 1e-6;
      b.style.background = on ? '#FBBF24' : '#1E293B';
      b.style.color = on ? '#0F172A' : '#E2E8F0';
      b.style.fontWeight = on ? 'bold' : 'normal';
    });
  }

  const lines: string[] = [];
  const speedLabel = latestFrame.speed === 0 ? 'PAUSED' : `${latestFrame.speed}×`;
  lines.push(
    `<div style="font-weight:bold;color:#FBBF24;margin-bottom:6px">` +
      `bot debug · tick ${latestFrame.tick} · ${speedLabel} · danger=${latestFrame.dangerMap.length}` +
      `</div>`,
  );

  for (const b of latestFrame.bots) {
    const slot = botSlotIndex(b);
    const color = PLAYER_COLORS[slot]!;
    const aliveTxt = b.alive ? '' : ' <span style="color:#EF4444">DEAD</span>';
    const dangerTxt = b.inDanger ? ' <span style="color:#F87171">⚠ in-danger</span>' : '';
    const cooldown = b.bombCooldownTicksLeft === 0 ? 'ready' : `${b.bombCooldownTicksLeft}t`;

    lines.push(
      `<div style="margin-bottom:8px;padding:6px;border:1px solid ${color};border-radius:4px">` +
        `<div style="color:${color};font-weight:bold">${escape(b.displayName)}${aliveTxt}${dangerTxt}</div>` +
        `<div>mode: <b>${b.mode}</b> · tile ${fmtTile(b.myTile)} · tick ${b.tickCounter}</div>` +
        `<div>bomb cd: ${cooldown} · last: ${b.lastBombTick}</div>` +
        `<div>decision: dir=${b.lastDecision.dir ?? '—'} action=${b.lastDecision.action ?? '—'}</div>` +
        `<div>next-step: ${fmtTile(b.nextStepTile)}</div>` +
        `<div>path: ${fmtPath(b.currentPath)}</div>` +
        `<div>flee→ ${fmtTile(b.fleeTarget)}</div>` +
        bombPlanLine(b) +
        targetEnemyLine(b) +
        nearbyLine(b) +
        `</div>`,
    );
  }

  bodyEl.innerHTML = lines.join('');
}

function bombPlanLine(b: BotDebugSnapshot): string {
  if (!b.bombPlan) return `<div>plan: —</div>`;
  return (
    `<div>plan(<b>${b.bombPlan.phase}</b>): bomb ${fmtTile(b.bombPlan.bombPos)} → hide ${fmtTile(b.bombPlan.hidePos)}</div>`
  );
}

function targetEnemyLine(b: BotDebugSnapshot): string {
  if (!b.targetEnemy) return '';
  return `<div>target: ${escape(b.targetEnemy.id.slice(0, 8))} @ ${fmtTile(b.targetEnemy.tile)} d=${b.targetEnemy.distance}</div>`;
}

function nearbyLine(b: BotDebugSnapshot): string {
  if (b.enemiesNearby.length <= 1) return '';
  const rest = b.enemiesNearby
    .slice(1)
    .map((e) => `${e.id.slice(0, 4)}:${e.distance}`)
    .join(' ');
  return `<div>others: ${rest}</div>`;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '"' ? '&quot;' :
    '&#39;',
  );
}

// ─── Canvas overlay ──────────────────────────────────────────────────────────

export function renderBotDebugOverlay(ctx: CanvasRenderingContext2D): void {
  if (!latestFrame) return;
  drawDangerMap(ctx, latestFrame.dangerMap);
  for (const b of latestFrame.bots) {
    if (!b.alive) continue;
    drawBotOverlay(ctx, b);
  }
}

function drawDangerMap(ctx: CanvasRenderingContext2D, indices: number[]): void {
  if (indices.length === 0) return;
  ctx.save();
  ctx.fillStyle = 'rgba(239,68,68,0.22)';
  ctx.strokeStyle = 'rgba(239,68,68,0.55)';
  ctx.lineWidth = 1;
  for (const idx of indices) {
    const x = (idx % GRID_COLS) * TILE_SIZE;
    const y = Math.floor(idx / GRID_COLS) * TILE_SIZE;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    ctx.strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
  }
  ctx.restore();
}

function tileCenter(p: Position): { x: number; y: number } {
  return { x: p.x * TILE_SIZE + TILE_SIZE / 2, y: p.y * TILE_SIZE + TILE_SIZE / 2 };
}

function drawBotOverlay(ctx: CanvasRenderingContext2D, b: BotDebugSnapshot): void {
  const slot = botSlotIndex(b);
  const color = PLAYER_COLORS[slot]!;

  // Mode badge above the bot's tile
  const c = tileCenter(b.myTile);
  ctx.save();
  ctx.fillStyle = b.mode === 'BATTLE' ? '#EF4444' : '#22C55E';
  ctx.beginPath();
  ctx.arc(c.x, c.y - TILE_SIZE / 2 - 6, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 11px ui-monospace,monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(b.mode === 'BATTLE' ? 'B' : 'E', c.x, c.y - TILE_SIZE / 2 - 6);
  ctx.restore();

  // Current path polyline
  if (b.currentPath && b.currentPath.length > 0) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    for (const p of b.currentPath) {
      const tc = tileCenter(p);
      ctx.lineTo(tc.x, tc.y);
    }
    ctx.stroke();
    // Waypoint dots
    ctx.fillStyle = color;
    for (const p of b.currentPath) {
      const tc = tileCenter(p);
      ctx.beginPath();
      ctx.arc(tc.x, tc.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Next-step arrow
  if (b.nextStepTile) {
    drawArrow(ctx, c, tileCenter(b.nextStepTile), color);
  }

  // Flee target — yellow ring + dashed line
  if (b.fleeTarget) {
    const ft = tileCenter(b.fleeTarget);
    ctx.save();
    ctx.strokeStyle = '#FBBF24';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(ft.x, ft.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(ft.x, ft.y, TILE_SIZE * 0.35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#FBBF24';
    ctx.font = 'bold 10px ui-monospace,monospace';
    ctx.textAlign = 'center';
    ctx.fillText('FLEE', ft.x, ft.y - TILE_SIZE * 0.42);
    ctx.restore();
  }

  // Bomb plan — red bombPos, green hidePos, dashed connector
  if (b.bombPlan) {
    const bp = tileCenter(b.bombPlan.bombPos);
    const hp = tileCenter(b.bombPlan.hidePos);
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#F87171';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bp.x, bp.y);
    ctx.lineTo(hp.x, hp.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Bomb position
    ctx.fillStyle = '#F87171';
    ctx.beginPath();
    ctx.arc(bp.x, bp.y, TILE_SIZE * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 10px ui-monospace,monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💣', bp.x, bp.y);

    // Hide position
    ctx.fillStyle = '#34D399';
    ctx.beginPath();
    ctx.arc(hp.x, hp.y, TILE_SIZE * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0F172A';
    ctx.fillText('H', hp.x, hp.y);

    // Phase label near bot
    ctx.fillStyle = '#FBBF24';
    ctx.textAlign = 'left';
    ctx.font = 'bold 10px ui-monospace,monospace';
    ctx.fillText(b.bombPlan.phase, c.x + 14, c.y + 16);
    ctx.restore();
  }

  // Target enemy — orange line to enemy
  if (b.targetEnemy && b.mode === 'BATTLE') {
    const et = tileCenter(b.targetEnemy.tile);
    ctx.save();
    ctx.strokeStyle = 'rgba(251,146,60,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(et.x, et.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Crosshair on enemy
    ctx.strokeStyle = '#FB923C';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(et.x, et.y, TILE_SIZE * 0.42, 0, Math.PI * 2);
    ctx.moveTo(et.x - TILE_SIZE * 0.5, et.y);
    ctx.lineTo(et.x + TILE_SIZE * 0.5, et.y);
    ctx.moveTo(et.x, et.y - TILE_SIZE * 0.5);
    ctx.lineTo(et.x, et.y + TILE_SIZE * 0.5);
    ctx.stroke();
    ctx.restore();
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: string,
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = 7;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(to.x - Math.cos(angle) * head, to.y - Math.sin(angle) * head);
  ctx.lineTo(to.x, to.y);
  ctx.lineTo(
    to.x - Math.cos(angle - Math.PI / 6) * head * 1.5,
    to.y - Math.sin(angle - Math.PI / 6) * head * 1.5,
  );
  ctx.lineTo(
    to.x - Math.cos(angle + Math.PI / 6) * head * 1.5,
    to.y - Math.sin(angle + Math.PI / 6) * head * 1.5,
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
