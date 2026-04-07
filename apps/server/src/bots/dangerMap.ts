import type { GameState } from '@bombermp/shared';
import { calculateExplosionTiles, toIndex } from '@bombermp/shared';

/**
 * Builds a Set of flat grid indices that are currently dangerous:
 * - Tiles with active explosions
 * - Tiles that will be hit when active bombs detonate
 */
export function buildDangerMap(state: GameState): Set<number> {
  const danger = new Set<number>();

  // Active explosion tiles
  for (const exp of Object.values(state.explosions)) {
    for (const t of exp.tiles) {
      danger.add(toIndex(t.x, t.y));
    }
  }

  // Tiles threatened by active bombs
  for (const bomb of Object.values(state.bombs)) {
    danger.add(toIndex(bomb.position.x, bomb.position.y));
    const { affectedTiles } = calculateExplosionTiles(
      state.grid,
      bomb.position,
      bomb.blastRadius,
    );
    for (const t of affectedTiles) {
      danger.add(toIndex(t.x, t.y));
    }
  }

  return danger;
}
