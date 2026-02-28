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
1. Record observations to the NPC's chronological log
2. Build world state from the NPC's perspective
3. Build memory content from the log (budget-capped)
4. Call the LLM for a decision (world state + memory)
5. Parse the response into directives
6. Execute up to 3 commands, recording each action to the log
7. Save the log to disk
8. Summarize old log entries if enough have accumulated
9. Wait 5 seconds before the next NPC

## Commands

Each NPC gets a budget of **3 commands per turn**. Each command runs to completion before the next starts.

- `move_to(x,y)` — walks the full path tile-by-tile to the target
- `wait()` — pauses for 300ms
- `start_conversation_with(Name, message)` — starts a conversation with an adjacent entity (see below)
- `end_conversation()` — ends the current conversation

If the LLM returns more than 3 commands, the extras are silently dropped.

`start_conversation_with` is special: it **stops the turn immediately** — no further directives in that turn are executed. The turn system pauses while the conversation is active.

## Conversation Pause

When a conversation starts (whether initiated by an NPC directive or by the player pressing **Enter**), the turn loop pauses:

1. `pauseForConversation()` is called on TurnManager
2. NPC movement is gated — `walkToAsync()` checks a pause gate before each step
3. The conversation runs to completion (see [conversations.md](conversations.md))
4. `resumeFromConversation()` resumes the turn loop

The player can start a conversation with an adjacent NPC by pressing **Enter**. This also pauses the turn system.

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
| `src/game/TurnManager.ts` | Turn loop, directive execution, log integration, pause control |
| `src/game/ConversationManager.ts` | Conversation lifecycle, validation, NPC/player flows |
| `src/game/ChronologicalLog.ts` | Per-NPC memory — recording, serialization, summarization |
| `src/game/entities/NPC.ts` | `walkToAsync()`, `stepTowardAsync()`, conversation pause gate |
| `src/game/entities/Entity.ts` | `moveToAsync()` — single-tile animated move |
