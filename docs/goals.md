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
        │  budget exhausted /          │  shouldEscalate
        │  diminishing returns         ▼
        │                        ┌───────────┐
        └──────────────────────▶ │ ABANDONED  │
                                 └───────────┘
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

## How Goals Are Created

### From Dialogue (most common)
During NPC-to-NPC or player-to-NPC conversations, the Slow Loop (Sonnet) extracts goals via a structured tool call (`extract_goal_and_reply`). The LLM decides:
- Whether a goal should be created (`shouldCreateGoal`)
- The goal's type, description, priority, and evaluation criteria
- Whether the goal should be **delegated** to the conversation partner
- Whether clarification is needed before committing

### Delegation
When NPC A asks NPC B to do something, the system creates two linked goals:
1. **Parent goal** on the speaker — with `delegatedTo` set to the listener
2. **Delegated goal** on the listener — with `delegatedFrom` set to the speaker and `source.type = 'delegated'`

Both are recorded as **commitments** in the Knowledge Graph.

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

The result is a `progressScore` (0–1) and a `shouldEscalate` boolean.

- **Score ≥ 0.95** → goal is marked `completed`.
- **shouldEscalate = true** → triggers Sonnet reasoning for a new plan.
- **Diminishing returns** (last 3 scores differ by < 0.05) → also triggers escalation.

Scores are kept in `evaluationHistory` (last 8 entries) for trend detection.

## Budget & Abandonment

Each difficulty tier has a **Sonnet call budget**:

| Difficulty | Budget |
|-----------|--------|
| trivial | 1 |
| simple | 2 |
| moderate | 3 |
| complex | 5 |

When an active goal exhausts its budget (escalation count ≥ budget), it is **abandoned**. This prevents runaway costs on unsolvable goals.

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

These totals are **persisted** by the `ResourceLedger` to `data/goal_resources.json` and exposed via `/api/resources` for monitoring.

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
| **Medium Loop** | Includes active goals in prompts; Haiku picks skills that advance the top goal |
| **Slow Loop** | Extracts goals from dialogue; provides reasoning when goals escalate |
| **Reflection** | Periodic reflection receives active goals and recent outcomes for insight generation |
| **Long-Term Memory** | Memories tagged with `goalContext` get a relevance boost when the same goal type is active again |
| **Knowledge Graph** | Delegation commitments are stored as relations between NPCs |
| **Self-Critique** | Failed goals feed context (description, criteria, cost) into lesson extraction |
