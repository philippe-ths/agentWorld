# Evaluation Spec

## Purpose

This document is the source of truth for the first evaluation system added to Agent World.

The goal is to introduce a **simple, useful, repeatable** test mode that measures how many turns it takes an NPC to complete a fixed task from a blank slate.

This first version is intentionally narrow:
- evaluation is launched from the command line
- scenarios are predefined in code
- only the **chronological log** is seeded
- all other persisted state is reset before each scenario
- each scenario ends with a clear terminal result and a small JSON result file

This system must not change NPC behaviour by telling them they are in a test.

---

## Non-Goals

The first version does **not** include:
- model-graded evals
- human review tooling
- web UI for benchmarks
- baseline comparison dashboards
- weighted multi-metric scoring
- random scenario generation
- seeding goals or reflection files

Those can be added later.

---

## Core Concept

A test scenario starts the game in a special evaluation mode.

On initialization for a scenario:
1. persisted logs and generated functions are reset to blank slate
2. only the target NPC's chronological log is pre-seeded with a fake prior conversation with the player
3. the game then runs normally
4. the NPC should infer and pursue the task from the seeded chronological log alone
5. the scenario ends in one of three outcomes:
   - `SUCCESS`
   - `FAIL`
   - `ABORTED`
6. the result is printed to the terminal and written to disk

---

## CLI Interface

Two CLI modes must exist.

### Single scenario mode

```bash
npm run dev -- --test-scenario scenario-one
```

This runs exactly one scenario.

### Suite mode

```bash
npm run dev -- --testing-mode scenario-one scenario-two
```

This runs multiple scenarios back-to-back.

### CLI rules

- `--test-scenario` accepts exactly one scenario id
- `--testing-mode` accepts one or more scenario ids
- scenario ids are plain strings such as `scenario-one`
- unknown scenario ids must fail fast with a clear terminal error
- if no scenario ids are provided in `--testing-mode`, startup must fail fast with a clear terminal error

---

## Execution Model

### Requirement

Each scenario in `--testing-mode` must run in a **fresh process**.

### Reason

This avoids contamination from in-memory runtime state such as:
- scene state
- singleton services
- cached function metadata
- registered buildings
- NPC runtime state
- tool registry state

### Implementation rule

- `--testing-mode` acts as a runner/orchestrator
- it must spawn one fresh child process per scenario using the existing app entry point with `--test-scenario <id>`
- it then aggregates results after each child process exits

### Summary

- `--test-scenario` = execute one scenario
- `--testing-mode` = orchestrate multiple `--test-scenario` runs

---

## Blank Slate Reset

Before each scenario begins, the system must fully reset persisted state.

### Reset scope

The reset must clear or recreate:
- chronological logs for all NPCs
- goal logs for all NPCs
- reflection logs for all NPCs
- all persisted functions created through the Code Forge
- runtime function-building state and related functional button state

### Important rule

Reset must happen **before** normal world/system initialization reads persisted state.

This is required so that:
- deleted functions do not get re-registered during startup
- old goals/reflections do not leak into the run
- old logs do not influence prompt construction

### Order of operations

For each scenario run:
1. reset all persisted state
2. seed chronological log for the target NPC only
3. continue normal startup
4. begin scenario monitoring

---

## Scenario Definition Model

Scenarios must be defined in code.

### Minimum scenario contract

```ts
export type TestScenario = {
  id: string;
  targetNpc: 'Ada' | 'Bjorn' | 'Cora';
  maxGlobalTurns: number;
  seedChronologicalLog(): Promise<void>;
  checkSuccess(state: GameState): boolean;
  checkAbort?(state: GameState): AbortReason | null;
};
```

This is intentionally small.

### Scenario responsibilities

Each scenario defines:
- id
- target NPC
- hard max global turn count
- chronological log seed content
- hard success rule
- optional hard abort rule extensions

---

## Scenario One

### Id

`scenario-one`

### Purpose

A minimal, objective first evaluation.

### Target NPC

`Ada`

### Seeded context

Only Ada's chronological log is seeded.

The seeded log must represent a fake previous conversation between the player and Ada where:
- the player clearly asks Ada to go to a specific tile
- Ada clearly acknowledges the request
- there is no mention of testing or evaluation

### Seed style requirements

The seeded log entry must:
- match the normal style of chronological memory entries used by the game
- be explicit enough for Ada to infer the task from memory alone
- avoid artificial wording like "this is a test"

### Initial task

Ada must reach a target tile `(x, y)`.

The actual coordinates must be defined in code as part of the scenario.

### Success rule

`SUCCESS` when Ada reaches the target tile.

### Fail rule

`FAIL` when `maxGlobalTurns` is reached before success.

### Abort rules

`ABORTED` when any hard failure condition is met.

### Recommended max turns

`12`

This is the default for `scenario-one` unless changed deliberately in code.

---

## Outcomes

Every scenario must end in exactly one of these three outcomes.

### SUCCESS

The scenario's success condition was met before any fail or abort condition.

### FAIL

The scenario did not complete within the scenario's max turn limit.

Typical failure reason:
- `max turns reached`

### ABORTED

The scenario ended early due to a hard failure condition.

Typical abort reasons:
- repeated invalid output
- repeated failed action loop
- unexpected runtime error

---

## Hard Failure Rules

The system must support hard abort conditions from the first version.

### Required default abort rules

#### 1. Repeated invalid output

Abort when the target NPC produces invalid or unusable output **2 times** in the same scenario run.

Suggested failure reason:
- `repeated invalid output`

#### 2. Repeated failed action loop

Abort when the same failed action occurs **3 times consecutively**.

A repeated failed action loop means the same combination of:
- action type
- action target, if any
- failure type

Suggested failure reason:
- `repeated failed action loop`

#### 3. Unexpected runtime error

Abort if the scenario cannot continue due to an unexpected exception or unrecoverable system error.

Suggested failure reason:
- `runtime error`

---

## Turn Counting

The system must record both:
- **global turns elapsed**
- **target NPC turns taken**

### Definitions

#### Global turns elapsed

The number of global NPC turns elapsed according to the turn loop / TurnManager progression.

#### Target NPC turns taken

The number of turns taken by the scenario's target NPC only.

### Reason

This avoids ambiguity in a multi-NPC sequential turn system.

---

## Monitoring Rules

Scenario monitoring starts after initialization completes.

### At the end of each global turn

The test system must evaluate, in order:
1. success condition
2. abort conditions
3. max turn failure condition

### Termination priority

Use this order:
1. `SUCCESS`
2. `ABORTED`
3. `FAIL`

This prevents a successful completion on the final allowed turn from being reported as a fail.

---

## Terminal Output

Each `--test-scenario` run must print a compact result block.

### Success example

```text
[TEST] scenario-one
Target NPC: Ada
Result: SUCCESS
Global turns elapsed: 5
Ada turns taken: 5
Failure reason: none
Result file: data/test-results/scenario-one.json
```

### Fail example

```text
[TEST] scenario-one
Target NPC: Ada
Result: FAIL
Global turns elapsed: 12
Ada turns taken: 12
Failure reason: max turns reached
Result file: data/test-results/scenario-one.json
```

### Aborted example

```text
[TEST] scenario-one
Target NPC: Ada
Result: ABORTED
Global turns elapsed: 4
Ada turns taken: 4
Failure reason: repeated invalid output
Result file: data/test-results/scenario-one.json
```

### Terminal requirements

- result must always be one of `SUCCESS`, `FAIL`, `ABORTED`
- target NPC must always be printed
- both turn counts must always be printed
- failure reason must always be printed
- on success, failure reason should be `none`

---

## Suite Mode Output

After `--testing-mode` completes, the runner must print a summary table.

### Example

```text
[TEST SUITE] Completed 2 scenarios

scenario-one   SUCCESS   global_turns=5   npc_turns=5
scenario-two   FAIL      global_turns=12  npc_turns=4   reason=max turns reached

Summary:
- Success: 1
- Fail: 1
- Aborted: 0

Suite result file: data/test-results/test-suite-2026-03-16T10-32-00.json
```

### Suite mode requirements

- preserve the order of scenarios passed on the CLI
- print one line per scenario result
- include counts of success / fail / aborted
- include path to aggregate suite result file

---

## Result Files

Result files must be written even though terminal output is the main user-facing output.

### Directory

```text
data/test-results/
```

### Per-scenario result file

Each `--test-scenario` run must write a JSON file.

Recommended path:

```text
data/test-results/scenario-one.json
```

### Per-scenario JSON shape

```json
{
  "scenarioId": "scenario-one",
  "targetNpc": "Ada",
  "result": "SUCCESS",
  "globalTurnsElapsed": 5,
  "npcTurnsTaken": 5,
  "failureReason": null,
  "maxGlobalTurns": 12,
  "timestamp": "2026-03-16T10:32:00Z"
}
```

### Rules

- `result` must be one of `SUCCESS`, `FAIL`, `ABORTED`
- `failureReason` must be `null` on success
- `failureReason` must be a string on fail or abort
- file must be overwritten on repeated single-scenario runs unless versioned output is intentionally added later

### Suite result file

Each `--testing-mode` run must write one aggregate JSON file.

Recommended path:

```text
data/test-results/test-suite-<timestamp>.json
```

### Suite JSON shape

```json
{
  "mode": "testing-mode",
  "scenarios": [
    {
      "scenarioId": "scenario-one",
      "result": "SUCCESS",
      "globalTurnsElapsed": 5,
      "npcTurnsTaken": 5,
      "failureReason": null
    },
    {
      "scenarioId": "scenario-two",
      "result": "FAIL",
      "globalTurnsElapsed": 12,
      "npcTurnsTaken": 4,
      "failureReason": "max turns reached"
    }
  ],
  "summary": {
    "successCount": 1,
    "failCount": 1,
    "abortedCount": 0
  }
}
```

---

## Seeded Chronological Log Rules

Only the chronological log is seeded.

### Explicit rule

The evaluation system must **not** seed:
- goals
- reflection
- function definitions
- any direct scenario-completion markers

### Reason

The NPC must infer the task naturally from chronological memory, using the normal turn loop and prompt building path.

### Seed quality rules

The seeded conversation must be:
- explicit
- natural
- compatible with the existing chronological log format
- sufficient to give the NPC enough context to begin the task

---

## Integration Points

This feature must integrate with the existing project architecture.

### Turn system

The evaluation system must observe the existing sequential NPC turn loop rather than replacing it.

### Prompting

The target NPC must receive the seeded chronological context through the normal memory-loading and prompt-building path.

### Persistence

The reset path must use the same persistence locations used by:
- chronological logs
- goals
- reflection
- persisted functions

### Function system

Any Code Forge-created persisted functions must be deleted before each scenario run.

---

## Suggested Internal Components

The implementation may use components similar to these names.

```text
src/game/testing/
  TestScenarioRegistry.ts
  TestScenarioRunner.ts
  TestSuiteRunner.ts
  TestResetService.ts
  TestResultWriter.ts
  TestOutcomeTracker.ts
```

These names are suggestions, not mandatory.

### Responsibilities

#### TestScenarioRegistry
- stores available scenarios
- resolves scenario ids from CLI

#### TestResetService
- wipes logs, reflection, goals, functions, and runtime function state

#### TestScenarioRunner
- runs one scenario
- monitors outcome
- prints terminal result
- writes per-scenario JSON result

#### TestSuiteRunner
- spawns fresh child processes for multiple scenarios
- aggregates results
- prints summary table
- writes suite JSON result

#### TestResultWriter
- serializes result payloads to disk

#### TestOutcomeTracker
- counts global turns and target NPC turns
- evaluates success / abort / fail conditions

---

## Required Data Types

Suggested minimum result type:

```ts
export type TestResult = {
  scenarioId: string;
  targetNpc: 'Ada' | 'Bjorn' | 'Cora';
  result: 'SUCCESS' | 'FAIL' | 'ABORTED';
  globalTurnsElapsed: number;
  npcTurnsTaken: number;
  failureReason: string | null;
  maxGlobalTurns: number;
  timestamp: string;
};
```

Suggested abort reason type:

```ts
export type AbortReason =
  | 'repeated invalid output'
  | 'repeated failed action loop'
  | 'runtime error';
```

---

## Scenario Discovery Rules

- scenario ids must be stable strings
- scenario ids must be unique
- unknown ids must fail fast before scenario execution starts

### Recommended first ids

- `scenario-one`
- `scenario-two`
- `scenario-three`

Only `scenario-one` is required for the first implementation.

---

## Errors and Exit Codes

### Single scenario mode

- successful scenario execution should exit cleanly after printing and writing result
- invalid CLI usage should exit with non-zero status
- unexpected runner/system errors should exit with non-zero status after attempting to write an `ABORTED` result if possible

### Suite mode

- invalid scenario ids should fail fast before spawning any runs
- suite runner should continue aggregating completed scenario results if a later scenario process exits abnormally
- suite summary should still classify such a run as `ABORTED` where possible

---

## Minimal Implementation Order

The first delivery should be built in this order.

### Phase 1
- implement `--test-scenario scenario-one`
- implement reset service
- implement scenario-one seed and success check
- implement terminal result output
- implement per-scenario JSON result file

### Phase 2
- implement required abort rules
- implement target NPC turn counting
- harden startup ordering

### Phase 3
- implement `--testing-mode ...`
- run multiple scenarios via fresh child processes
- implement suite summary output
- implement suite JSON result file

---

## Acceptance Criteria

The feature is complete when all of the following are true.

### Single scenario mode

- `npm run dev -- --test-scenario scenario-one` starts the game in test mode
- all logs, goals, reflections, and persisted functions are reset before startup reads them
- only the chronological log is seeded
- Ada does not receive any explicit knowledge that she is in a test
- the scenario ends in exactly one of `SUCCESS`, `FAIL`, `ABORTED`
- terminal output includes result, target NPC, global turns, target NPC turns, failure reason, and result file path
- a JSON result file is written

### Suite mode

- `npm run dev -- --testing-mode scenario-one scenario-two` runs scenarios in CLI order
- each scenario runs in a fresh process
- each scenario produces an individual result
- suite mode prints a summary table
- suite mode writes an aggregate JSON file

---

## Future Extensions

These are explicitly out of scope for this spec but compatible with it.

- repeating scenarios multiple times
- average turn counts per scenario
- baseline comparison
- CSV export
- more complex success rules
- scenario config in JSON instead of code
- additional metrics like invalid outputs and loop counts in the result file

