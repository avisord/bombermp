import type { GameEngine } from '../game/GameEngine.js';
import { BotAI } from './BotAI.js';
import { buildDangerMap } from './dangerMap.js';

export class BotController {
  private bots = new Map<string, BotAI>();
  private engine: GameEngine;

  constructor(botIds: string[], engine: GameEngine) {
    this.engine = engine;
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
  }
}
