# Goal System

Goals give NPCs persistent objectives that survive beyond a single tick. They are created during conversations, delegated between agents, evaluated periodically, and abandoned when cost exceeds value.

## Goal Lifecycle

```
Conversation / Self-initiated
        │
        ▼
   ┌─────────┐   every 3 ticks   ┌────────────┐   score ≥ 0.95   ┌───────────┐
   │  ACTIVE  │ ──────────────▶  │  EVALUATE   │ ──────────────▶  │ COMPLETED │
   └─────────┘                   └────────────┘                   └───────────┘
        │                              │
        │  budget exhausted            │  shouldEscalate / diminishing returns
        │                              ▼
        │                     ┌──────────────────┐
        │                     │  ESCALATE (Sonnet)│
        │                     └──────────────────┘
        │                              │
        │         ┌────────────────────┼────────────────────┐
        │         │ improving?         │ progress ≥ 0.5?    │ neither
        │         ▼                    ▼                    ▼
        │   ┌───────────┐     ┌────────────┐        ┌───────────┐
        │   │  UPGRADE   │     │  RUNWAY    │        │ ABANDONED │
        │   │ difficulty │     │ +1 call    │        └───────────┘
        │   └───────────┘     └────────────┘
        │         │                    │
        │         └────────────────────┘
        │                    │
        └────────────────────┘
                 (retry)
```

Statuses: `active` · `completed` · `failed` · `abandoned`

## Goal Structure

| Field | Type | Purpose |
|-------|------|---------|
| `id` | string | Unique identifier (`goal_<npcId>_<timestamp>`) |
| `npcId` | string | Owning NPC |
| `type` | string | Free-form category (e.g. `explore`, `social`) |
| `description` | string | Human-readable objective |
| `source` | GoalSource | How the goal was created |
| `evaluation` | GoalEvaluation | Criteria for measuring progress |
| `status` | enum | `active` / `completed` / `failed` / `abandoned` |
| `priority` | number | 0–1 weight; higher wins |
| `resources` | GoalResourceProfile | Tracks all costs incurred |
| `parentGoalId` | string \| null | Links delegated sub-goals to parent |
| `delegatedTo` / `delegatedFrom` | string \| null | NPC delegation chain |
| `estimatedDifficulty` | enum | `trivial` / `simple` / `moderate` / `complex` |
| `planAgenda` | PlanStep[] \| undefined | Structured plan from escalation (shown in medium loop prompt) |
| `baselineState` | string \| undefined | Snapshot of the world when the goal was created |

## How Goals Are Created

### From Dialogue (most common)
During NPC-to-NPC or player-to-NPC conversations, the Slow Loop (Sonnet) extracts goals via a structured tool call (`extract_goal_and_reply`). The LLM decides:
- Whether a goal should be created (`shouldCreateGoal`)
- The goal's type, description, priority, and evaluation criteria
- Whether the goal should be **delegated** to the conversation partner (`delegation.delegateToPartner`)
- Whether this is a **received delegation** (`delegation.delegatedTask`)
- Whether clarification is needed before committing

When a goal is created from dialogue, the system captures a **baseline state** — a snapshot of nearby entities and their positions at goal-creation time. This prevents the evaluator from crediting pre-existing conditions as progress.

### Delegation
When NPC A asks NPC B to do something, the system creates two linked goals:
1. **Parent goal** on the speaker — with `delegatedTo` set to the listener
2. **Delegated goal** on the listener — with `delegatedFrom` set to the speaker and `source.type = 'delegated'`

Both are recorded as **commitments** in the Knowledge Graph.

## Goal-Aware Dialogue

Active goals are injected into the dialogue prompt so the Slow Loop stays on-task:

- Each active goal appears with its **priority**, **progress score**, **success criteria**, and **gap analysis** (if available).
- A steering instruction tells the NPC: *"Be direct about what you need. If the partner can help, ask them to do a specific task. Don't make small talk — get to the point."*
- Goal extraction rules prioritize **delegation** — the LLM is prompted to set `delegateToPartner = true` when asking the partner for a task.

### Conversation Shortening
When the conversation initiator has an active goal, `maxTurns` is reduced from the default (6) to **3**. This prevents wasted turns once delegation is extracted.

### Mid-Conversation Steering
If 2+ turns pass without a goal-related extraction, a **SYSTEM note** is injected into the conversation history reminding the speaker of their active goal. This nudges the LLM back on-task.

## Goal Slots

Each NPC holds **at most 3 active goals** (`NPC.addGoal()`):
- If there's room, the goal is added and the list is sorted by priority.
- If full, the new goal **replaces** the lowest-priority goal only if it outranks it.
- Otherwise the goal is **ignored**.

## Evaluation

Every **3rd medium-loop tick**, the `AgentLoop` calls the server's `/api/npc/goal/evaluate` endpoint. Haiku scores progress using the goal's own evaluation criteria:

| Evaluation Field | Role |
|-----------------|------|
| `successCriteria` | What "done" looks like |
| `progressSignal` | Observable signs of progress |
| `failureSignal` | Observable signs of failure |
| `completionCondition` | Machine-checkable finish line |

The result includes:
- `progressScore` (0–1)
- `shouldEscalate` boolean
- `gapAnalysis` — a breakdown of what remains: which sub-conditions are met/unmet, specific entity names and positions, and the next concrete step.

Evaluation behaviour:
- **Score ≥ 0.95** → goal is marked `completed`.
- **shouldEscalate = true** → triggers Sonnet reasoning for a new plan.
- **Diminishing returns** (last 3 scores differ by < 0.05) → also triggers escalation.

Scores are kept in `evaluationHistory` (last 8 entries) for trend detection.

### Baseline State

When a goal is created, a `baselineState` string is captured (positions and nearby entities at that moment). The evaluation prompt includes this baseline with the instruction: *"Score only genuine progress since goal creation — do not credit pre-existing conditions."*

### Gap Analysis

The evaluation prompt asks for a structured gap analysis: for each sub-condition, state whether it is met or not, include specific entity names and positions, and name the next concrete step. This gap analysis is then surfaced in:
- The **medium loop prompt** (so Haiku picks skills that address the gap)
- The **dialogue prompt** (so Sonnet steers conversations toward the gap)
- The **reasoning prompt** (so escalation plans target the gap)

## Budget & Abandonment

Each difficulty tier has a **Sonnet call budget**:

| Difficulty | Budget |
|-----------|--------|
| trivial | 1 |
| simple | 2 |
| moderate | 3 |
| complex | 5 |

When an active goal exhausts its budget (unproductive escalation count ≥ budget), the system attempts two resilience measures before abandoning:

1. **Difficulty Upgrade** — if the progress score is improving (latest score ≥ 0.15 above previous), the difficulty tier is bumped up one level, extending the budget. E.g. `simple → moderate` raises the budget from 2 to 3.

2. **Completion Runway** — if progress ≥ 0.5, the score is improving, and the runway hasn't already been used, one extra Sonnet call is granted (`runwayUsed = true`).

If neither condition applies, the goal is **abandoned**.

Escalations are tracked as `productiveEscalations` (score improved after the call) and `unproductiveEscalations` (no improvement). Only unproductive escalations count against the budget.

## Resource Tracking

Every API call, embedding, and pathfinding operation is charged to the active goal's `GoalResourceProfile`:

| Metric | Description |
|--------|-------------|
| `haikuCalls` / `sonnetCalls` | LLM invocations by model |
| `evaluationCalls` | Goal progress checks |
| `embeddingCalls` | Vector similarity lookups |
| `pathfindingCalls` | Route calculations |
| `totalTokensIn/Out` | Token consumption |
| `estimatedCostUSD` | Running dollar estimate |
| `wallClockMs` | Time from creation to completion |
| `apiLatencyMs` | Cumulative API wait time |
| `mediumLoopTicks` | Number of ticks while active |
| `runwayUsed` | Whether the completion runway was granted |
| `productiveEscalations` | Sonnet calls that improved progress |
| `unproductiveEscalations` | Sonnet calls with no improvement |

These totals are **persisted** by the `ResourceLedger` to `data/goal_resources.json` and exposed via `/api/resources` for monitoring.

## Plan Agenda

When Sonnet produces a structured plan during escalation, the steps are stored on the goal as `planAgenda`:

```ts
interface PlanStep {
    skill: string;   // e.g. "approach", "converse"
    target?: string; // e.g. "Bjorn"
    purpose: string; // why this step matters
    done: boolean;   // toggled as steps complete
}
```

The medium loop prompt renders the plan agenda with checkmarks (✅ done / → pending), so Haiku can see which steps remain and pick the next one.

## Tick Interval Adaptation

The medium-loop interval adjusts based on the active goal's priority:

```
interval = max(7s, 15s × (1.25 − priority))
```

- High-priority goal (p ≈ 1.0) → tick every ~4 s
- No active goal → tick every 60 s (idle mode)

## Integration Points

| System | How it uses goals |
|--------|-------------------|
| **Medium Loop** | Includes active goals with gap analysis and plan agenda in prompts; Haiku picks skills that advance the top goal |
| **Slow Loop** | Extracts goals from dialogue with delegation support; provides structured plans when goals escalate |
| **Dialogue** | Active goals are injected into conversation prompts; conversations are shortened and steered when goals are active |
| **Reflection** | Periodic reflection receives active goals and recent outcomes for insight generation |
| **Long-Term Memory** | Memories tagged with `goalContext` get a relevance boost when the same goal type is active again |
| **Knowledge Graph** | Delegation commitments are stored as relations between NPCs |
| **Self-Critique** | Failed goals feed context (description, criteria, cost) into lesson extraction |
