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
1. Check sleep status — if sleeping, skip LLM call and decrement remaining turns
2. Load the NPC's chronological log and goals from disk
3. Record observations to the NPC's chronological log (position, visible entities)
4. Build world state from the NPC's perspective
5. Build memory content from the log (budget-capped at `LOG_CHAR_BUDGET`)
6. Build goal content via `GoalManager.buildPromptContent()`
7. Call the LLM for a decision (world state + memory + goals)
8. Parse the response into directives
9. Execute goal directives instantly (no budget cost), then up to 3 action commands via `DirectiveExecutor`. Each runs to completion before the next. Turn-ending directives (`start_conversation_with`, `use_tool`, `sleep`) stop execution immediately.
10. Handle function directives (`create_function`, `update_function`, `delete_function`) via `FunctionBuilderService`.
11. Save the log and goals to disk
12. Summarize old log entries if enough have accumulated
13. Wait 5 seconds before the next NPC

## Commands

Each NPC gets a budget of **3 action commands per turn** (`NPC_COMMANDS_PER_TURN` in `GameConfig.ts`). Each command runs to completion before the next starts.

| Command | Description | Counts toward limit |
|---------|-------------|:---:|
| `move_to(x,y)` | Walk the full path tile-by-tile to the target | Yes |
| `wait()` | Pause for 300ms | Yes |
| `start_conversation_with(Name, message)` | Initiate dialogue with an adjacent entity (ends turn) | Yes |
| `end_conversation()` | End the current conversation | Yes |
| `use_tool(tool_id, "args")` | Use an adjacent tool building (ends turn) | Yes |
| `sleep()` | Enter low-power mode for `SLEEP_TURNS` turns (ends turn) | Yes |
| `create_function("desc", x, y)` | Create a new function building at Code Forge (ends turn) | Yes |
| `update_function("name", "change")` | Update an existing function (ends turn) | Yes |
| `delete_function("name")` | Delete a function building (ends turn) | Yes |
| `complete_goal()` | Mark the active goal as done | No |
| `abandon_goal()` | Give up on the active goal | No |
| `switch_goal()` | Abandon active, promote pending to active | No |
| *(unknown)* | If an unparseable or misspelled line is detected, it is intercepted and explicitly logged as an error to the NPC so they can correct themselves. | Yes |

If the LLM returns more than 3 action commands, the extras are silently dropped.

## Conversations

NPCs can initiate conversations with adjacent entities via `start_conversation_with(Name, message)`. The conversation then enters a multi-turn exchange managed by `ConversationManager`:

1. The target NPC responds via the `CONVERSATION` LLM call
2. Exchanges alternate until one side calls `end_conversation()` or `MAX_EXCHANGES` (6) is reached
3. After the conversation ends, `GoalExtractor` analyzes the transcript for new goals
4. The full transcript is recorded in each NPC's chronological log

The player can also initiate conversations via the dialogue box UI (press **Enter** next to an adjacent NPC).

See [conversations.md](conversations.md) for the full conversation lifecycle and UI details.

## Sleep

NPCs can enter low-power sleep mode via the `sleep()` directive. During sleep:
- The NPC skips the LLM decision call for `SLEEP_TURNS` (10) turns
- The sprite rotates 90° and a "zzZ" label appears
- Sleeping NPCs are automatically woken if another entity starts a conversation with them
- NPCs should only sleep when they have no active goal and nothing to do

## Goals

Each NPC can hold one active goal and one pending goal. Goals are loaded at the start of each turn and saved at the end.

- Goal directives (`complete_goal`, `abandon_goal`, `switch_goal`) are processed during directive execution but don't consume action commands
- When the active goal is completed or abandoned, the pending goal auto-promotes to active
- Goals are persisted to `data/logs/goals-{Name}.md`

See [architecture.md](architecture.md) for goal format and lifecycle details.

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
| `src/game/TurnManager.ts` | Turn loop, sleep tracking, log/goal integration, pause control |
| `src/game/FunctionBuilderService.ts` | Handles the UI and prompt pipeline when crafting, modifying, or deleting function tools |
| `src/game/DirectiveExecutor.ts` | Executes parsed directives — movement, tools, goals, sleep |
| `src/game/DirectiveParser.ts` | Parses LLM text into typed directive objects |
| `src/game/GameConfig.ts` | Constants: `NPC_COMMANDS_PER_TURN`, `SLEEP_TURNS`, `NPC_TURN_DELAY` |
| `src/game/prompts.ts` | LLM prompt configs — models, tokens, system prompts |
| `src/game/ChronologicalLog.ts` | Per-NPC memory — recording, serialization, summarization |
| `src/game/GoalManager.ts` | Per-NPC goal persistence — active/pending, promotion, serialization |
| `src/game/GoalExtractor.ts` | Extracts goals from conversation transcripts via LLM |
| `src/game/ConversationManager.ts` | Multi-turn NPC-NPC and player-NPC conversations |
| `src/game/entities/NPC.ts` | `walkToAsync()` with optimistic pathfinding |
| `src/game/entities/Entity.ts` | `moveToAsync()`, sleep visuals |
