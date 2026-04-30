# Bot State Machine

How a bot behaves from the moment it is created in a room until it is discarded.
There are two layers stacked on top of each other:

1. **Lifecycle** — owned by `BotController` (`apps/server/src/bots/BotController.ts`).
2. **Per-tick decision FSM** — owned by `BotAI` (`apps/server/src/bots/BotAI.ts`).

---

## Layer 1 — Lifecycle (controller-level)

`BotController` holds one `BotAI` instance per bot ID for the lifetime of the room.

```
[room created with bots]
        │
        ▼
   constructed       ← new BotAI(id) per bot       (BotController.ts:12)
        │
        ▼
   ┌─── ALIVE ────┐  ← every tick:
   │   ticking    │     buildDangerMap → ai.decide(state, danger)
   └──────┬───────┘     → engine.queueInput(...)   (BotController.ts:16-27)
          │
          │ player.alive === false
          ▼
   ┌─── DEAD ─────┐  ← controller skips it         (BotController.ts:22)
   └──────┬───────┘     AI instance retained but idle
          │
          │ room ends / bot removed
          ▼
   discarded
```

`BotAI` itself does not track life/death. `decide()` short-circuits to
`{ dir: null, action: null }` when `!me.alive` (`BotAI.ts:68`), so a dead bot
emits no inputs even if it were ticked.

---

## Layer 2 — Per-tick decision FSM (`BotAI.decide()`)

Two declared modes — `EXPLORE` and `BATTLE` (`BotAI.ts:23`). On top of those,
two transient states act as preempting layers: a reactive **FLEE** branch and
an active **BombPlan** with two phases.

### Priority each tick

```
FLEE  >  active BombPlan  >  continue current path (non-think tick)  >  EXPLORE / BATTLE think
```

### Top-level branch

```
                   ┌──────────────────────────────────────────┐
                   │  every tick: BotAI.decide(state, danger) │
                   └──────────────────────────────────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
        ▼ (1) on danger tile          ▼ (2) bombPlan active         ▼ (3) otherwise
   ╔════════════╗               ╔════════════════╗            every 4th tick:
   ║   FLEE     ║               ║  BombPlan FSM  ║            updateMode()
   ║ (preempt)  ║               ║                ║            then EXPLORE or BATTLE
   ╚════════════╝               ╚════════════════╝            tick logic
   cancels bombPlan,            move-to-bomb ──► place-and-flee
   nearest safe tile            (BotAI.ts:102-168)
   (BotAI.ts:172-183)
```

### Mode transitions (`BotAI.ts:204-225`)

- `EXPLORE → BATTLE` — any enemy within `blastRadius + 1` (Manhattan distance).
- `BATTLE → EXPLORE` — all enemies farther than `blastRadius + 3`, or none alive.
- On any switch, `currentPath` is cleared so the new mode plans from scratch.

### EXPLORE tick (`BotAI.ts:229-272`)

1. With cooldown satisfied and `EXPLORE_BOMB_CHANCE` (60%), try `findBombPlan()`
   targeting a tile adjacent to a soft wall → enter BombPlan.
2. Otherwise BFS for an exploration target:
   - first unvisited reachable cell, then
   - nearest cell next to a soft wall, then
   - nearest enemy (last resort).
3. Step one tile along the path; abort the path if the next tile becomes dangerous.

### BATTLE tick (`BotAI.ts:276-317`)

1. With cooldown satisfied and `ATTACK_CHANCE` (50%), try `findBombPlan()` where
   the enemy is in blast line-of-sight → enter BombPlan.
2. Otherwise pick a reposition tile that has ≥ 2 escape routes and (ideally)
   keeps the enemy in blast range; BFS there.
3. Fallback: walk toward the enemy while avoiding danger.

### BombPlan FSM (`BotAI.ts:46-50, 102-168`)

```
move-to-bomb  ──► (arrived at bombPos)  ──► place-and-flee  ──► (at hidePos) ──► cleared
       │                                            │
       └── bombPos no longer EMPTY/ITEM ────────────┤
       └── BFS path crosses a danger tile ──────────┤
       └── escape no longer viable on arrival ──────┘   → plan aborted; falls back to mode tick
```

The bomb is dropped on the **same tick** the bot arrives at `bombPos`: that
tick returns `{ dir: <toward hidePos>, action: 'bomb' }` (`BotAI.ts:131-132`).
After that, the bot simply walks to `hidePos` and clears the plan on arrival.

### FLEE branch (`BotAI.ts:172-183`)

Triggered whenever the bot's current tile is in `dangerMap`. It:

- discards any active `bombPlan`,
- reuses the cached `fleeTarget` if it is still safe,
- otherwise picks the nearest tile not in `dangerMap` via BFS,
- otherwise just walks any open direction as a last-ditch attempt.

### Throttling & cooldowns

- `THINK_INTERVAL = 4` ticks (~200 ms): full re-decisions only happen on these
  ticks. Between them, `continueCurrentAction()` walks the existing path,
  bailing if the next tile turns dangerous (`BotAI.ts:38, 87-89, 187-200`).
- `BOMB_COOLDOWN_TICKS = 20` (~1 s): minimum gap between bomb placements.
- `MAX_BOMB_SEARCH_DIST = 4`: BFS radius when searching for candidate bomb
  positions in `findBombPlan()`.

---

## End-to-end summary

```
constructed
   │
   ▼
ALIVE & ticking ──► EXPLORE ⇄ BATTLE                (mode swap on enemy proximity)
   │                  │
   │                  ├── may enter BombPlan        (move-to-bomb → place-and-flee → done)
   │                  └── may enter FLEE            (preempts everything until safe)
   │
   ▼
DEAD (idle)
   │
   ▼
discarded (room over)
```
