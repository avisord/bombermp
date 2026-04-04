import { Direction } from '@bombermp/shared';

// ─── Appearance trait types ───────────────────────────────────────────────────

export type BodyShape = 'circle' | 'square';
export type EyeStyle  = 'dot' | 'cute' | 'angry' | 'sleepy';
export type HatStyle  = 'none' | 'cap' | 'beanie' | 'crown' | 'antenna';
export type Accessory = 'none' | 'blush' | 'scar';

export interface PlayerAppearance {
  body:      BodyShape;
  eyes:      EyeStyle;
  hat:       HatStyle;
  accessory: Accessory;
}

// ─── Option lists (order = display order in UI) ───────────────────────────────

export const BODY_OPTIONS:      BodyShape[]  = ['circle', 'square'];
export const EYE_OPTIONS:       EyeStyle[]   = ['dot', 'cute', 'angry', 'sleepy'];
export const HAT_OPTIONS:       HatStyle[]   = ['none', 'cap', 'beanie', 'crown', 'antenna'];
export const ACCESSORY_OPTIONS: Accessory[]  = ['none', 'blush', 'scar'];

export const DEFAULT_APPEARANCE: PlayerAppearance = {
  body:      'circle',
  eyes:      'dot',
  hat:       'none',
  accessory: 'none',
};

// ─── Persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'bombermp_appearance';

export function loadAppearance(): PlayerAppearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    return { ...DEFAULT_APPEARANCE, ...(JSON.parse(raw) as Partial<PlayerAppearance>) };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(a: PlayerAppearance): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
}

// ─── ID → appearance hash (remote players get a stable, deterministic look) ──

export function appearanceFromId(id: string): PlayerAppearance {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = (((h << 5) + h) ^ id.charCodeAt(i)) >>> 0;
  return {
    body:      BODY_OPTIONS[h               % BODY_OPTIONS.length]!,
    eyes:      EYE_OPTIONS[(h >>> 4)        % EYE_OPTIONS.length]!,
    hat:       HAT_OPTIONS[(h >>> 8)        % HAT_OPTIONS.length]!,
    accessory: ACCESSORY_OPTIONS[(h >>> 12) % ACCESSORY_OPTIONS.length]!,
  };
}

// ─── Direction → rotation angle ───────────────────────────────────────────────

export const DIRECTION_ANGLE: Record<Direction, number> = {
  [Direction.RIGHT]:  0,
  [Direction.DOWN]:   Math.PI / 2,
  [Direction.LEFT]:   Math.PI,
  [Direction.UP]:    -Math.PI / 2,
};
