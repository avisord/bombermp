// ─── Sprite sheet frame configs ───────────────────────────────────────────────

export const BOMB_SHEET = {
  cols: 5,
  rows: 3,
  total: 15,
  frameW: 1536 / 5, // 307.2
  frameH: 1024 / 3, // 341.33
} as const;

export const EXPLOSION_SHEET = {
  cols: 4,
  rows: 3,
  total: 12,
  frameW: 1536 / 4, // 384
  frameH: 1024 / 3, // 341.33
} as const;

// 3 item icons laid out horizontally: [0]=FIRE_UP  [1]=SPEED_DOWN  [2]=BOMB_UP
export const ITEM_SHEET = {
  cols: 3,
  rows: 1,
  total: 3,
  frameW: 1536 / 3, // 512
  frameH: 1024,
} as const;

// Column index per item type (matches the order in items.png)
export const ITEM_COL = {
  FIRE_UP:    0,
  SPEED_DOWN: 1,
  BOMB_UP:    2,
} as const;

// Source crop for wall tile textures (single tile unit from each tileset)
export const WALL_HARD_CROP = { sx: 0, sy: 0, sw: 190, sh: 190 } as const;
export const WALL_SOFT_CROP = { sx: 0, sy: 0, sw: 370, sh: 370 } as const;

// ─── Sprite registry ──────────────────────────────────────────────────────────
//
// explosionSheet and itemSheet are stored as HTMLCanvasElement after the dark
// near-black background has been stripped to transparency.
// bombSheet and wall images keep their original HTMLImageElement (bomb has real
// alpha from the source file; walls are opaque textures).

export const SPRITES: {
  wallHard:       HTMLImageElement  | null;
  wallSoft:       HTMLImageElement  | null;
  bombSheet:      HTMLImageElement  | null;
  explosionSheet: HTMLCanvasElement | null;
  itemSheet:      HTMLCanvasElement | null;
} = {
  wallHard:       null,
  wallSoft:       null,
  bombSheet:      null,
  explosionSheet: null,
  itemSheet:      null,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => {
      console.warn(`[sprites] failed to load: ${src}`);
      reject(new Error(`Failed to load ${src}`));
    };
    img.src = src;
  });
}

/**
 * Returns a canvas copy of `img` where any pixel whose maximum RGB channel is
 * below `threshold` has its alpha set to 0 (transparent).  A gradient fade
 * covers [threshold, threshold×2] to avoid hard aliased edges.
 *
 * This removes the solid near-black backgrounds present in explosion-sheet.png
 * and items.png, which have no native alpha channel.
 */
function removeBlackBackground(img: HTMLImageElement, threshold = 60): HTMLCanvasElement {
  const canvas  = document.createElement('canvas');
  canvas.width  = img.naturalWidth;
  canvas.height = img.naturalHeight;

  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d         = imageData.data;

  for (let i = 0; i < d.length; i += 4) {
    const maxCh = Math.max(d[i]!, d[i + 1]!, d[i + 2]!);
    if (maxCh < threshold) {
      d[i + 3] = 0;
    } else if (maxCh < threshold * 2) {
      d[i + 3] = Math.round(255 * (maxCh - threshold) / threshold);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// ─── Public loader ────────────────────────────────────────────────────────────

export async function loadSprites(): Promise<void> {
  const results = await Promise.allSettled([
    loadImage('/sprites/wall-hard.png'),
    loadImage('/sprites/wall-soft.png'),
    loadImage('/sprites/bomb-sheet.png'),
    loadImage('/sprites/explosion-sheet.png'),
    loadImage('/sprites/items.png'),
  ]);

  const [wallHard, wallSoft, bombSheet, explosionRaw, itemsRaw] = results;

  if (wallHard.status  === 'fulfilled') SPRITES.wallHard  = wallHard.value;
  if (wallSoft.status  === 'fulfilled') SPRITES.wallSoft  = wallSoft.value;
  if (bombSheet.status === 'fulfilled') SPRITES.bombSheet = bombSheet.value;

  // Strip near-black backgrounds → proper transparency
  if (explosionRaw.status === 'fulfilled') {
    SPRITES.explosionSheet = removeBlackBackground(explosionRaw.value);
  }
  if (itemsRaw.status === 'fulfilled') {
    SPRITES.itemSheet = removeBlackBackground(itemsRaw.value);
  }

  const loaded = results.filter((r) => r.status === 'fulfilled').length;
  console.log(`[sprites] loaded ${loaded}/${results.length} sprites`);
}
