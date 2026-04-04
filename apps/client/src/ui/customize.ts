import { Direction } from '@bombermp/shared';
import type { PlayerAppearance } from '../game/appearance.js';
import {
  BODY_OPTIONS, EYE_OPTIONS, HAT_OPTIONS, ACCESSORY_OPTIONS,
} from '../game/appearance.js';
import { drawPlayerPreview } from '../game/renderer.js';

// ─── Human-readable labels ────────────────────────────────────────────────────

const LABELS: Record<string, string> = {
  circle:  '● Circle',
  square:  '■ Square',
  dot:     'Dot',
  cute:    'Cute',
  angry:   'Angry',
  sleepy:  'Sleepy',
  none:    '–',
  cap:     'Cap',
  beanie:  'Beanie',
  crown:   'Crown',
  antenna: 'Antenna',
  blush:   'Blush',
  scar:    'Scar',
};

// Preview cycles through facing directions to show direction-aware features
const PREVIEW_DIRS: Direction[] = [Direction.RIGHT, Direction.DOWN, Direction.LEFT, Direction.UP];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Replaces `root` content with the customization panel.
 * `onBack(appearance)` is called when the user saves or cancels.
 * Pass the saved appearance back; pass the original on cancel.
 */
export function showCustomize(
  root: HTMLElement,
  appearance: PlayerAppearance,
  slotIndex: number,
  onBack: (a: PlayerAppearance) => void,
): void {
  let current = { ...appearance };
  let rafId: number | null = null;
  let dirIdx = 0;
  let lastDirSwitch = 0;

  injectStyles();
  root.style.display = 'flex';
  root.innerHTML = `
    <div class="bmp-dec bmp-dec--circle-yellow bmp-dec--sm" aria-hidden="true"></div>

    <div class="bmp-logo bmp-logo--sm">
      <img class="bmp-logo__bomb" src="/sprites/new/bomb.png" alt="Bomb">
      <h1 class="bmp-logo__text">BomberMP</h1>
    </div>

    <div class="bmp-card" style="min-width:320px;width:100%">
      <div class="bmp-card__header bmp-card__header--pink">
        <span class="bmp-card__icon" aria-hidden="true">🎨</span>
        <h2 class="bmp-card__title">Customize Character</h2>
      </div>
      <div class="bmp-card__body">

        <!-- Live preview -->
        <div style="display:flex;flex-direction:column;align-items:center;gap:0.3rem;margin-bottom:0.2rem">
          <canvas id="cust-preview" width="110" height="110"
            style="border:2px solid #E2E8F0;border-radius:12px;background:#FFFDF5"></canvas>
          <span style="font-size:0.68rem;color:#94A3B8;font-style:italic">Rotates to show all directions</span>
        </div>

        ${row('Body',  'cust-body', BODY_OPTIONS,      current.body)}
        ${row('Eyes',  'cust-eyes', EYE_OPTIONS,        current.eyes)}
        ${row('Hat',   'cust-hat',  HAT_OPTIONS,        current.hat)}
        ${row('Extra', 'cust-acc',  ACCESSORY_OPTIONS,  current.accessory)}

        <div class="bmp-action-row" style="margin-top:0.35rem">
          <button class="bmp-btn bmp-btn--danger bmp-btn--sm" id="cust-back">Cancel</button>
          <button class="bmp-btn bmp-btn--primary bmp-btn--sm" id="cust-save">
            Save &amp; Back <span class="bmp-btn__arrow" aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const canvas = root.querySelector<HTMLCanvasElement>('#cust-preview')!;

  // Animation loop — slowly rotates direction so all features are visible
  function loop(now: number): void {
    if (now - lastDirSwitch > 1200) {
      dirIdx = (dirIdx + 1) % PREVIEW_DIRS.length;
      lastDirSwitch = now;
    }
    drawPlayerPreview(canvas, current, slotIndex, PREVIEW_DIRS[dirIdx]);
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  // Bind option buttons
  bindGroup(root, 'cust-body', 'body');
  bindGroup(root, 'cust-eyes', 'eyes');
  bindGroup(root, 'cust-hat',  'hat');
  bindGroup(root, 'cust-acc',  'accessory');

  function bindGroup(r: HTMLElement, groupId: string, key: keyof PlayerAppearance): void {
    r.querySelector(`#${groupId}`)!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.bmp-cust-btn');
      if (!btn?.dataset['value']) return;
      current = { ...current, [key]: btn.dataset['value'] };
      r.querySelectorAll(`#${groupId} .bmp-cust-btn`).forEach((b) => {
        b.classList.toggle('bmp-cust-btn--active', (b as HTMLElement).dataset['value'] === current[key]);
      });
    });
  }

  root.querySelector('#cust-back')!.addEventListener('click', () => {
    stop();
    onBack(appearance); // discard — pass original back
  });

  root.querySelector('#cust-save')!.addEventListener('click', () => {
    stop();
    onBack(current); // save
  });

  function stop(): void {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function row(label: string, id: string, options: string[], selected: string): string {
  const btns = options.map((v) =>
    `<button class="bmp-cust-btn${v === selected ? ' bmp-cust-btn--active' : ''}" data-value="${v}">${LABELS[v] ?? v}</button>`,
  ).join('');
  return `
    <div class="bmp-cust-row">
      <span class="bmp-cust-label">${label}</span>
      <div class="bmp-cust-options" id="${id}">${btns}</div>
    </div>`;
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .bmp-cust-row {
      display: flex;
      align-items: center;
      gap: 0.55rem;
    }
    .bmp-cust-label {
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #64748B;
      min-width: 2.6rem;
      flex-shrink: 0;
    }
    .bmp-cust-options {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
    }
    .bmp-cust-btn {
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      font-size: 0.73rem;
      font-weight: 600;
      padding: 0.28rem 0.6rem;
      border: 1.5px solid #CBD5E1;
      border-radius: 9999px;
      background: #FFFFFF;
      color: #64748B;
      cursor: pointer;
      transition: all 0.12s;
      white-space: nowrap;
    }
    .bmp-cust-btn:hover { background: #F1F5F9; border-color: #94A3B8; color: #1E293B; }
    .bmp-cust-btn--active {
      background: #EDE9FE;
      border-color: #8B5CF6;
      color: #6D28D9;
      font-weight: 700;
    }
    .bmp-cust-btn--active:hover { background: #DDD6FE; }
  `;
  document.head.appendChild(s);
}
