import { SERVER_TICK_RATE_MS } from '@bombermp/shared';

interface PlayerLerp {
  prevX: number;
  prevY: number;
  currX: number;
  currY: number;
}

/**
 * Tracks previous and current server positions for each remote player
 * and lerps between them for smooth 60fps rendering.
 */
export class RemotePlayerInterpolator {
  private players = new Map<string, PlayerLerp>();
  private lastTickMs = 0;

  /** Call once per game:tick, BEFORE applying the diff. */
  onTick(
    allPlayers: Record<string, { pixelX: number; pixelY: number }>,
    updatedPlayers: Record<string, Partial<{ pixelX: number; pixelY: number }>> | undefined,
  ): void {
    this.lastTickMs = performance.now();

    for (const [id, player] of Object.entries(allPlayers)) {
      const entry = this.players.get(id);
      const newX = updatedPlayers?.[id]?.pixelX ?? player.pixelX;
      const newY = updatedPlayers?.[id]?.pixelY ?? player.pixelY;

      if (entry) {
        // Shift current → prev, new server pos → current
        entry.prevX = entry.currX;
        entry.prevY = entry.currY;
        entry.currX = newX;
        entry.currY = newY;
      } else {
        // First time seeing this player — no interpolation, snap
        this.players.set(id, {
          prevX: newX,
          prevY: newY,
          currX: newX,
          currY: newY,
        });
      }
    }
  }

  /** Get interpolated position for a remote player at the current frame time. */
  getPosition(playerId: string, nowMs: number): { x: number; y: number } | null {
    const entry = this.players.get(playerId);
    if (!entry) return null;

    const elapsed = nowMs - this.lastTickMs;
    // Lerp from prev→curr over one tick duration, clamp to [0, 1]
    const t = Math.min(elapsed / SERVER_TICK_RATE_MS, 1);

    return {
      x: entry.prevX + (entry.currX - entry.prevX) * t,
      y: entry.prevY + (entry.currY - entry.prevY) * t,
    };
  }

  /** Remove a player (on death/disconnect). */
  remove(playerId: string): void {
    this.players.delete(playerId);
  }

  /** Clear all state (on game reset). */
  reset(): void {
    this.players.clear();
    this.lastTickMs = 0;
  }
}
