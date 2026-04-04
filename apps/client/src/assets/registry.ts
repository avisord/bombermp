// ─── Types ────────────────────────────────────────────────────────────────────

export interface SheetMeta {
  cols:   number;
  rows:   number;
  total:  number;
  frameW: number;
  frameH: number;
}

export interface CropRegion {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

interface PlainEntry {
  kind: 'plain';
  path: string;
}

interface SheetEntry {
  kind:       'sheet';
  path:       string;
  sheet:      SheetMeta;
  alphaStrip: boolean;
}

interface CroppedEntry {
  kind: 'cropped';
  path: string;
  crop: CropRegion;
}

interface IconEntry {
  kind: 'icon';
  path: string;
}

export type AssetEntry = PlainEntry | SheetEntry | CroppedEntry | IconEntry;

// ─── Registry ─────────────────────────────────────────────────────────────────

export const ASSET_REGISTRY = {
   wallHard: {
    kind: 'cropped',
    path: '/sprites/new/unbreakable-wall.png',
    crop: { sx: 0, sy: 0, sw: 735, sh: 735 },
  },
  wallSoft: {
    kind: 'cropped',
    path: '/sprites/new/brekable-brick.png',
    crop: { sx: 0, sy: 0, sw: 703, sh: 703 },
  },
  empty: {
    kind: 'cropped',
    path: '/sprites/new/empty.png',
    crop: { sx: 0, sy: 0, sw: 722, sh: 722 },
  },
  bombPlain: {
    kind: 'plain',
    path: '/sprites/new/bomb.png',
  },
  bombSheet: {
    kind:       'sheet',
    path:       '/sprites/bomb-sheet.png',
    alphaStrip: false,
    sheet: {
      cols:   5,
      rows:   3,
      total:  15,
      frameW: 1536 / 5, // 307.2
      frameH: 1024 / 3, // 341.33
    },
  },
  explosionSheet: {
    kind:       'sheet',
    path:       '/sprites/explosion-sheet.png',
    alphaStrip: true,
    sheet: {
      cols:   4,
      rows:   3,
      total:  12,
      frameW: 1536 / 4, // 384
      frameH: 1024 / 3, // 341.33
    },
  },
  itemSheet: {
    kind:       'sheet',
    path:       '/sprites/items.png',
    alphaStrip: true,
    sheet: {
      cols:   3,
      rows:   1,
      total:  3,
      frameW: 1536 / 3, // 512
      frameH: 1024,
    },
  },
  hudBombIcon: {
    kind: 'icon',
    path: '/sprites/cropped-bomb.png',
  },
  hudFireIcon: {
    kind: 'icon',
    path: '/sprites/cropped-fire.png',
  },
} as const satisfies Record<string, AssetEntry>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

type IconKey = {
  [K in keyof typeof ASSET_REGISTRY]: (typeof ASSET_REGISTRY)[K]['kind'] extends 'icon' ? K : never;
}[keyof typeof ASSET_REGISTRY];

export function iconPath(key: IconKey): string {
  return ASSET_REGISTRY[key].path;
}
