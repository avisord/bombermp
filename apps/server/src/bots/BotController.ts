import type { BotDebugFrame } from '@bombermp/shared';
import type { GameEngine } from '../game/GameEngine.js';
import { BotAI } from './BotAI.js';
import { buildDangerMap } from './dangerMap.js';

export type BotDebugEmitter = (frame: BotDebugFrame) => void;

export class BotController {
  private bots = new Map<string, BotAI>();
  private engine: GameEngine;
  private onDebug: BotDebugEmitter | undefined;

  constructor(botIds: string[], engine: GameEngine, onDebug?: BotDebugEmitter) {
    this.engine = engine;
    this.onDebug = onDebug;
    for (const id of botIds) {
      this.bots.set(id, new BotAI(id));
    }
  }

  update(): void {
    const state = this.engine.getFullState();
    const dangerMap = buildDangerMap(state);

    for (const [botId, ai] of this.bots) {
      const player = state.players[botId];
      if (!player?.alive) continue;

      const decision = ai.decide(state, dangerMap);
      this.engine.queueInput(botId, decision.dir, decision.action);
    }

    if (this.onDebug) {
      const snapshots = [];
      for (const ai of this.bots.values()) {
        snapshots.push(ai.getDebugSnapshot(state, dangerMap));
      }
      this.onDebug({
        tick: state.tick,
        serverTime: state.serverTime,
        speed: this.engine.getSpeed(),
        dangerMap: [...dangerMap],
        bots: snapshots,
      });
    }
  }
}
