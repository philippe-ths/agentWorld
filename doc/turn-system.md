# Turn System

## Overview

NPCs operate on a sequential turn-based system. The player is **not** part of the turn system and can move freely at any time.

## Turn Loop

```
Turn 1: Ada → (5s) → Bjorn → (5s) → Cora → (5s) → "Turn 1 complete" → (5s)
Turn 2: Ada → (5s) → Bjorn → (5s) → Cora → (5s) → "Turn 2 complete" → (5s)
...
```

Each NPC turn:
1. Build world state from the NPC's perspective
2. Call the LLM for a decision
3. Parse the response into directives
4. Execute up to 3 commands, each running to completion
5. Wait 5 seconds before the next NPC

## Commands

Each NPC gets a budget of **3 commands per turn**. Each command runs to completion before the next starts.

- `move_to(x,y)` — walks the full path tile-by-tile to the target
- `wait()` — pauses for 300ms

If the LLM returns more than 3 commands, the extras are silently dropped.

## Pause / Resume

Press **P** to toggle the turn loop:
- When paused, the on-screen label shows `⏸ PAUSED (press P to resume)`
- The loop halts before the next NPC's turn
- The player can still move while paused

## On-Screen Indicator

A fixed label in the top-left corner shows:
- `Turn N — Ada's turn` during an NPC's turn
- `Turn N complete` between rounds
- `⏸ PAUSED (press P to resume)` when paused
- `⚠ NPC: LLM error — waiting` on failure

## Key Files

| File | Role |
|------|------|
| `src/game/TurnManager.ts` | Turn loop, directive execution, pause control |
| `src/game/entities/NPC.ts` | `walkToAsync()`, `stepTowardAsync()` |
| `src/game/entities/Entity.ts` | `moveToAsync()` — single-tile animated move |
