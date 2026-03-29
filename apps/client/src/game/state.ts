import type { GameState, GameStateDiff } from '@bombermp/shared';

// ─── Client Game State ────────────────────────────────────────────────────────

export class ClientGameState {
  state: GameState | null = null;

  init(fullState: GameState): void {
    this.state = {
      grid: [...fullState.grid],
      players: { ...fullState.players },
      bombs: { ...fullState.bombs },
      explosions: { ...fullState.explosions },
      items: { ...fullState.items },
      tick: fullState.tick,
      serverTime: fullState.serverTime,
    };
  }

  applyDiff(diff: GameStateDiff): void {
    if (!this.state) return;

    this.state.tick = diff.tick;
    this.state.serverTime = diff.serverTime;

    // Grid changes
    if (diff.gridChanges) {
      for (const { index, tile } of diff.gridChanges) {
        this.state.grid[index] = tile;
      }
    }

    // Player updates (merge partial)
    if (diff.players) {
      for (const [id, partial] of Object.entries(diff.players)) {
        const existing = this.state.players[id];
        if (existing) {
          Object.assign(existing, partial);
        } else {
          // New player arrived mid-game (shouldn't happen normally, but handle it)
          this.state.players[id] = partial as unknown as (typeof this.state.players)[string];
        }
      }
    }

    // Removed players
    if (diff.removedPlayers) {
      for (const id of diff.removedPlayers) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete this.state.players[id];
      }
    }

    // Bombs: new/updated
    if (diff.bombs) {
      for (const [id, bomb] of Object.entries(diff.bombs)) {
        this.state.bombs[id] = bomb;
      }
    }

    // Removed bombs
    if (diff.removedBombs) {
      for (const id of diff.removedBombs) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete this.state.bombs[id];
      }
    }

    // Explosions: new
    if (diff.explosions) {
      for (const [id, explosion] of Object.entries(diff.explosions)) {
        this.state.explosions[id] = explosion;
      }
    }

    // Removed explosions
    if (diff.removedExplosions) {
      for (const id of diff.removedExplosions) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete this.state.explosions[id];
      }
    }

    // Items: new
    if (diff.items) {
      for (const [id, item] of Object.entries(diff.items)) {
        this.state.items[id] = item;
      }
    }

    // Removed items
    if (diff.removedItems) {
      for (const id of diff.removedItems) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete this.state.items[id];
      }
    }
  }

  reset(): void {
    this.state = null;
  }
}
