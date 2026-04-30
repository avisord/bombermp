import type { BotDebugFrame } from '@bombermp/shared';
import type { GameEngine } from '../game/GameEngine.js';
import type { ScopedLogger } from '../logging/event-log.js';
import { BotAI } from './BotAI.js';
import { buildDangerMap } from './dangerMap.js';

export type BotDebugEmitter = (frame: BotDebugFrame) => void;

export class BotController {
  private bots = new Map<string, BotAI>();
  private engine: GameEngine;
  private onDebug: BotDebugEmitter | undefined;
  private logger: ScopedLogger | undefined;

  constructor(
    botIds: string[],
    engine: GameEngine,
    onDebug?: BotDebugEmitter,
    logger?: ScopedLogger,
  ) {
    this.engine = engine;
    this.onDebug = onDebug;
    this.logger = logger;
    for (const id of botIds) {
      const ai = new BotAI(id);
      if (logger) ai.setLogger(logger);
      this.bots.set(id, ai);
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

      if (this.logger) {
        const snapshot = ai.getDebugSnapshot(state, dangerMap);
        this.logger.log('bot.decision', {
          tick: state.tick,
          playerId: botId,
          data: {
            decision,
            mode: snapshot.mode,
            tile: snapshot.myTile,
            inDanger: snapshot.inDanger,
            nextStep: snapshot.nextStepTile,
            pathLen: snapshot.currentPath ? snapshot.currentPath.length : 0,
            bombPlanPhase: snapshot.bombPlan ? snapshot.bombPlan.phase : null,
            targetEnemy: snapshot.targetEnemy ? { id: snapshot.targetEnemy.id, distance: snapshot.targetEnemy.distance } : null,
            cooldown: snapshot.bombCooldownTicksLeft,
          },
        });
      }
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
