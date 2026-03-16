# Evaluation System

The evaluation system runs NPC scenarios headlessly — no Phaser, no browser. It replicates the game's turn loop in pure Node.js so scenarios can be executed, measured, and compared from the command line.

## CLI Usage

The `npm run dev` entry point routes to evaluation mode when it detects `--test-scenario` or `--testing-mode`:

```bash
# Run a single scenario
npm run dev -- --test-scenario scenario-one

# Run a single scenario with a label
npm run dev -- --test-scenario scenario-gather --title "conversation test"

# Run multiple scenarios as a suite
npm run dev -- --testing-mode scenario-one scenario-gather

# Suite with a label
npm run dev -- --testing-mode scenario-one scenario-gather --title "nightly run"
```

Exit code is `0` on success, `1` on any failure or abort.

## Available Scenarios

| ID | Target NPC | Description | Max turns |
|----|-----------|-------------|:---------:|
| `scenario-one` | Ada | Navigate to a specific tile after a player instruction | 12 |
| `scenario-gather` | Ada | Gather Bjorn and Cora at a meeting point via conversations | 25 |

## Architecture

```
npm run dev -- --test-scenario <id>
        │
        ▼
  dev-entry.ts          Detects --test-scenario / --testing-mode, delegates to cli.ts
        │
        ▼
    cli.ts              Parses args, starts Vite on a random port, calls runScenario()
        │
        ▼
  HeadlessTurnLoop      resetState() → seedChronologicalLog() → turn loop → result
        │
        ├─► HeadlessEntityManager      Entity positions + walkability (MAP_DATA)
        ├─► HeadlessDirectiveExecutor   Executes directives (move, wait, converse, …)
        ├─► HeadlessConversationManager NPC-to-NPC LLM conversations
        ├─► AbortMonitor                Tracks repeated failures / invalid output
        └─► ResultWriter                Prints + writes JSON results
```

### Entry point

`dev-entry.ts` is the unified entry for `npm run dev`. When CLI args include `--test-scenario` or `--testing-mode`, it imports `cli.ts` directly (via tsx). Otherwise it spawns the Vite dev server for the browser game.

### Vite server

`cli.ts` starts a Vite dev server on a **random available port** (not 8080) so eval runs don't collide with a running browser game. The server provides the same API endpoints (LLM proxy, log I/O, etc.) that game modules call via `fetch()`. A `patchFetch()` shim rewrites relative URLs (`/api/chat`) to the random port's base URL.

### Single vs. suite mode

- **Single** (`--test-scenario <id>`): runs one scenario in-process, writes result, exits.
- **Suite** (`--testing-mode <id> [...]`): spawns each scenario as a separate child process (isolated state), collects results, writes a suite summary.

## Headless Entities

| Class | Purpose |
|-------|---------|
| `HeadlessEntity` | Base — tracks `name`, `tilePos`, `sleeping` flag, adjacency checks |
| `HeadlessNPC` | Adds `walkToAsync(target)` — A* pathfinding with re-path on blocked tiles, instant (no animation) |
| `HeadlessEntityManager` | Stores entities, provides `isWalkable` / `isTerrainWalkable` from `MAP_DATA` arrays directly (no Phaser tilemap) |

Movement is instant — `walkToAsync` walks the full A* path in a single call, re-pathing up to 5 times if tiles become occupied. No tweens, no frame delays.

## Headless Conversations

`HeadlessConversationManager` mirrors the browser `ConversationManager`'s NPC-to-NPC conversation loop without Phaser or UI dependencies.

**Flow:**

1. Initiator calls `start_conversation_with(Name, message)` → executor delegates to `startNpcConversation()`
2. Validate: target exists, is adjacent, is not Player
3. If target is sleeping, fire `onNpcEngaged` callback → wakes target (clears sleep, logs wake event)
4. Opening message from initiator is added to history
5. Alternating `llm.converse()` calls up to `MAX_EXCHANGES`, each participant seeing full history
6. Conversation ends on `end_conversation()` response or exchange cap
7. `finishConversation()` records transcript to both NPCs' chronological logs
8. If goals enabled: `extractGoal()` runs for both participants
9. If reflection enabled: goal results trigger reflection updates (obstacle/strategy lifecycle, completion lessons)

**Key differences from browser `ConversationManager`:**
- No speech bubbles or UI rendering
- No Phaser scene or sprite dependencies
- `onNpcEngaged` callback handles sleep-waking externally (via `HeadlessTurnLoop`'s `sleepUntil` map)

## Headless Directive Executor

`HeadlessDirectiveExecutor` handles the same directive set as the browser `DirectiveExecutor`:

| Directive | Headless behavior |
|-----------|-------------------|
| `move_to(x,y)` | Instant A* pathfinding via `walkToAsync` |
| `wait()` | No-op |
| `start_conversation_with(Name, msg)` | Real LLM conversation via `HeadlessConversationManager` (when conversations enabled) |
| `use_tool(id, args)` | Adjacency check + tool execution (tools return eval-mode placeholder) |
| `sleep()` | Adds to `sleepUntil` map (rejected if NPC has active goal) |
| `create_function` / `update_function` / `delete_function` | Skipped in eval mode |
| Goal directives | Delegated to `GoalManager` (same as browser) |

## Abort Monitoring

`AbortMonitor` tracks the target NPC's behavior and triggers early abort when:

| Rule | Threshold | Description |
|------|:---------:|-------------|
| Repeated invalid output | 2 | Output guard fell back to `wait()` twice in one run |
| Repeated failed action loop | 3 | Same failed action (type + target + failure key) 3 times consecutively |
| Runtime error | — | Unhandled exception during `runScenario()` (caught externally) |

A successful action resets the consecutive failure counter.

## Turn Loop

`HeadlessTurnLoop.runScenario()` replicates the browser `TurnManager` loop:

1. **Setup** — create entities at configured spawn points, load persisted logs/goals/reflections
2. **Per global turn** — iterate all NPCs sequentially:
   - Skip sleeping NPCs (wake if turn threshold reached)
   - Build world state, memory, goals, reflection context
   - Call `llm.decide()` → output guard → parse directives
   - Execute goal directives (no budget cost), then action directives (capped at `NPC_COMMANDS_PER_TURN`)
   - Persist logs, run summarization if enabled, persist goals + reflection
3. **Post-turn evaluation** (priority order):
   - `checkSuccess()` → **SUCCESS**
   - `AbortMonitor.checkDefaultAborts()` → **ABORTED**
   - `scenario.checkAbort()` → **ABORTED** (scenario-specific)
   - Max turns reached → **FAIL**

## Per-Scenario Feature Overrides

`TestScenario` has an optional `features` field:

```ts
features?: Partial<Record<FeatureKey, boolean>>;
```

When set, `runScenario()` applies the overrides to the global `FEATURES` object before running, and restores the originals in a `finally` block. Scenarios that omit `features` run with whatever the global config has.

## Result Format

### Single scenario (`ScenarioResult`)

```json
{
  "scenarioId": "scenario-gather",
  "targetNpc": "Ada",
  "result": "SUCCESS",
  "globalTurnsElapsed": 3,
  "npcTurnsTaken": 3,
  "failureReason": null,
  "maxGlobalTurns": 25,
  "config": {
    "models": { "opus": "...", "sonnet": "...", "haiku": "..." },
    "tuning": { "summarizeEveryNTurns": 5, "..." : "..." },
    "features": { "conversations": true, "goals": true, "..." : "..." }
  },
  "timestamp": "2026-03-16T10:30:00.000Z",
  "title": "conversation test"
}
```

### Suite (`SuiteResult`)

```json
{
  "mode": "testing-mode",
  "scenarios": [ { "scenarioId": "...", "result": "...", "..." : "..." } ],
  "summary": { "successCount": 2, "failCount": 0, "abortedCount": 0 }
}
```

Results are written to `data/test-results/`:
- **Stable file**: `<scenario-id>.json` — overwritten each run (used by suite orchestrator)
- **History file**: `<scenario-id>-<timestamp>.json` — never overwritten

## State Management

Before each scenario run:

1. `resetState()` deletes all `.md` files in `data/logs/` and all `.json` files in `data/functions/` — blank slate
2. `scenario.seedChronologicalLog()` writes the initial chronological log(s) that give the target NPC its starting context (e.g. a prior player instruction)

This means eval runs are fully isolated and do not depend on prior game state.

## Authoring a New Scenario

1. Create `src/eval/scenarios/scenario-<name>.ts` implementing `TestScenario`:

```ts
import { TestScenario, EvalGameState } from '../types';

const scenario: TestScenario = {
    id: 'scenario-<name>',
    targetNpc: 'Ada',       // NPC tracked by AbortMonitor
    maxGlobalTurns: 15,

    async seedChronologicalLog(): Promise<void> {
        // Write initial log files to data/logs/
    },

    checkSuccess(state: EvalGameState): boolean {
        // Return true when the scenario objective is met
        return false;
    },

    // Optional: scenario-specific abort conditions
    checkAbort(state: EvalGameState) {
        return null; // or { reason: 'description' }
    },
};

export default scenario;
```

2. Register in `src/eval/scenarios/index.ts`:

```ts
import scenarioName from './scenario-<name>';

// Add to SCENARIOS map:
[scenarioName.id, scenarioName],
```

3. Run: `npm run dev -- --test-scenario scenario-<name>`

## Key Files

| File | Purpose |
|------|---------|
| `src/eval/dev-entry.ts` | Unified `npm run dev` entry — routes to eval CLI or Vite server |
| `src/eval/cli.ts` | Argument parsing, Vite startup, single / suite orchestration |
| `src/eval/HeadlessTurnLoop.ts` | Core turn loop — `runScenario()`, per-NPC turns, output guard |
| `src/eval/HeadlessConversationManager.ts` | NPC-to-NPC conversation loop without Phaser |
| `src/eval/HeadlessDirectiveExecutor.ts` | Executes directives (move, converse, tool use, sleep) |
| `src/eval/HeadlessEntity.ts` | `HeadlessEntity` + `HeadlessNPC` (instant pathfinding) |
| `src/eval/HeadlessEntityManager.ts` | Entity storage + walkability from MAP_DATA |
| `src/eval/AbortMonitor.ts` | Tracks repeated failures / invalid output for early abort |
| `src/eval/ResultWriter.ts` | Prints terminal output + writes JSON result files |
| `src/eval/resetState.ts` | Clears all persisted NPC state before a run |
| `src/eval/types.ts` | `TestScenario`, `ScenarioResult`, `SuiteResult`, `GameConfigSnapshot` |
| `src/eval/scenarios/index.ts` | Scenario registry (`getScenario`, `getAllScenarioIds`) |
| `src/eval/scenarios/scenario-one.ts` | Navigation test — Ada walks to target tile |
| `src/eval/scenarios/scenario-gather.ts` | Cooperation test — Ada gathers Bjorn + Cora at meeting point |
