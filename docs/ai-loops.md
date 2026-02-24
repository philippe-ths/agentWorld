# AI Loops

## Fast Loop (client, every frame)

Located in `NPC.update()`. Pops the next `Action` from `currentPlan` and executes it:

| Action | Behaviour |
|--------|-----------|
| `move` | Tween one tile toward `target`; mark `stuck` on failure |
| `wait` | Count down `duration` ms |
| `speak` | Show speech bubble, advance immediately |

When the plan is exhausted, `onPlanComplete` fires and reports success/failure to the server.

## Medium Loop (server, Haiku, every 15 s)

`POST /api/npc/tick` — sends an `Observation` and receives a `SkillSelection`.

- Haiku is called with a dynamic tool (`select_skill`) whose `enum` contains all registered skill names.
- If the selected skill is `converse`, the result sets `escalate: true` → triggers slow loop.
- NPC ticks are **staggered** (Ada +0 s, Bjorn +5 s, Cora +10 s) to stay within the 5 req/min rate limit.
- Every 10 ticks, the server runs **reflection** and **memory decay**.

## Slow Loop (server, Sonnet, on demand)

Two entry points:

1. **Dialogue** — `POST /api/npc/reason` with `mode: 'dialogue'`. Generates free-text conversation turns.
2. **Reasoning** — `POST /api/npc/reason` with `mode: 'reasoning'`. Returns a structured plan, belief updates, and optionally a new composed skill.

Reasoning is triggered when an NPC is **stuck ≥ 3 times** or when conversation is requested.

## Escalation Flow

```
medium loop → selects "converse"  → slow loop (dialogue)
medium loop → stuck 3+ times      → slow loop (reasoning) + self-critique
```
