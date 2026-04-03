import { Direction } from '@bombermp/shared';
import type { C2SPlayerInput } from '@bombermp/shared';

// ─── Input Handler ────────────────────────────────────────────────────────────

export class InputHandler {
  private heldKeys = new Set<string>();
  private bombQueued = false;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.heldKeys.add(e.key);
    if (e.key === ' ') {
      e.preventDefault();
      this.bombQueued = true;
    }
    // Prevent arrow keys from scrolling the page
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.heldKeys.delete(e.key);
  };

  attach(document: Document): void {
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  detach(document: Document): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    this.heldKeys.clear();
    this.bombQueued = false;
  }

  get currentDir(): Direction | null {
    return this.deriveDirection();
  }

  getCurrentInput(): C2SPlayerInput {
    const dir = this.deriveDirection();
    const action: 'bomb' | null = this.bombQueued ? 'bomb' : null;
    if (this.bombQueued) this.bombQueued = false;
    return { dir, action };
  }

  private deriveDirection(): Direction | null {
    const keys = this.heldKeys;
    if (keys.has('ArrowUp') || keys.has('w') || keys.has('W')) return Direction.UP;
    if (keys.has('ArrowDown') || keys.has('s') || keys.has('S')) return Direction.DOWN;
    if (keys.has('ArrowLeft') || keys.has('a') || keys.has('A')) return Direction.LEFT;
    if (keys.has('ArrowRight') || keys.has('d') || keys.has('D')) return Direction.RIGHT;
    return null;
  }
}
