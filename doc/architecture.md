# Architecture

## File Structure

```
src/
  main.ts                  Entry point — creates the Phaser game
  game/
    main.ts                Game config & StartGame()
    prompts.ts             Centralized LLM config — PromptConfig interface, per-prompt model/tokens/system, gameplay tuning
    MapData.ts             Procedural 30x30 map (seeded PRNG, grass + water ponds)
    Pathfinder.ts          A* pathfinding on the tile grid
    WorldState.ts          Serializes game state into compact text for LLM consumption
    LLMService.ts          Client-side LLM caller — sends decision & conversation prompts, logs I/O
    DirectiveParser.ts     Parses LLM text responses into typed directive objects
    TurnManager.ts         Orchestrates NPC turn loop, executes directives, pause/resume
    ChronologicalLog.ts    Per-NPC memory — records observations/actions, summarizes old turns
    ConversationManager.ts Manages NPC-NPC and player-NPC conversations via LLM
    GoalManager.ts         Per-NPC goal persistence — active/pending goals, promotion, serialization
    GoalExtractor.ts       Extracts new goals from conversation transcripts via LLM
    entities/
      Entity.ts            Abstract base — sprite, tile movement, name label, depth sort
      Player.ts            Keyboard-controlled entity (arrows / WASD)
      NPC.ts               LLM-driven entity (tinted sprite, async walk-to-target)
      EntityManager.ts     Holds all entities, runs updates, walkability check
    scenes/
      Preloader.ts         Loads sprite sheet, generates tile textures, then starts GameScene
      GameScene.ts         Builds tilemap, spawns player + 3 NPCs, sets up camera & TurnManager
    ui/
      DialogueBox.ts       UI overlay for player-NPC conversation input
      SpeechBubble.ts      Floating speech bubble above speaking entities
vite/
  config.dev.mjs           Dev config — includes Anthropic proxy & log I/O plugins
  config.prod.mjs          Production build config
  anthropic-proxy.mjs      Vite server plugin — proxies /api/chat to Anthropic API (all LLM calls)
  log-io.mjs               Vite server plugin — reads/writes per-NPC log & goal .md files
data/
  logs/                    Per-NPC chronological log and goal files (generated at runtime)
    chronological-{Name}.md
    goals-{Name}.md
```

## Scene Flow

```
Preloader → GameScene
```

Preloader loads the `player.png` sprite sheet and generates isometric diamond textures for grass/water tiles at runtime. Then it starts GameScene.

## Entities

`Entity` is the abstract base class. It creates a sprite at a tile position, handles animated tile-to-tile movement via tweens, and displays a name label.

- **Player** — reads keyboard input each frame, calls `moveTo()` on key press. Moves freely at any time (not part of the turn system).
- **NPC** — driven by LLM via `TurnManager`. Has `walkToAsync()` for full-path movement and `stepTowardAsync()` for single-step pathfinding.

`EntityManager` stores all entities, runs their `update()` each frame, and provides the `isWalkable()` check (bounds + water + occupied tiles).

## Map

Generated once at import time by `MapData.ts`. Uses a seeded PRNG (mulberry32, seed 42) to place 3-5 organic water ponds on a 30x30 grass field. Spawn areas for the player and all NPCs are guaranteed clear.

## Turn System

`TurnManager` runs an async loop that cycles through NPCs sequentially (Ada → Bjorn → Cora). For each NPC's turn:

1. Load the NPC's chronological log and goals from disk
2. Record observations to the log (position, visible entities)
3. Build world state text via `WorldState.buildWorldState()`
4. Build memory content from the log via `ChronologicalLog.buildPromptContent()`
5. Build goal content via `GoalManager.buildPromptContent()`
6. Send world state + memory + goals to Claude via `LLMService.decide()`
7. Parse response into directives via `DirectiveParser.parseDirectives()`
8. Execute up to 3 action directives — each runs to completion before the next; record each action to the log. Goal directives (`complete_goal`, `abandon_goal`, `switch_goal`) don't count toward the limit.
9. Save the log and goals to disk
10. Trigger summarization of old entries if enough have accumulated
11. Wait 5 seconds before the next NPC's turn

The player is **not** part of the turn system and can move at any time.

Press **P** to pause/resume the NPC turn loop.

## LLM Integration

### Configuration

All LLM parameters are centralized in `src/game/prompts.ts`. Each of the four LLM calls has its own `PromptConfig` object containing `model`, `maxTokens`, and `buildSystem()`. Gameplay tuning constants (`SUMMARIZE_EVERY_N_TURNS`, `LOG_CHAR_BUDGET`, `MAX_EXCHANGES`) also live here.

### Server Side

`vite/anthropic-proxy.mjs` is a Vite server plugin that adds a single `POST /api/chat` endpoint used by all four LLM calls. It:
- Loads `ANTHROPIC_API_KEY` from `.env` at startup
- Accepts `model`, `system`, `messages`, and `max_tokens` from the client
- Proxies requests to the Anthropic Messages API
- Keeps the API key server-side (never sent to the browser)

### Client Side

Four LLM calls go through `/api/chat`, each with its own prompt config from `prompts.ts`:

1. **Decision** (`LLMService.decide()`) — NPC action selection. Context: memory, goals, world state.
2. **Conversation** (`LLMService.converse()`) — in-character dialogue responses. Context: memory, world state, conversation history.
3. **Summarization** (`ChronologicalLog.maybeSummarize()`) — compresses old memory entries. Context: oldest chronological log entries.
4. **Goal extraction** (`GoalExtractor.extractGoal()`) — detects new goals from conversation transcripts. Context: current goals, world state, conversation transcript.

### Directives

`DirectiveParser` extracts structured commands from the LLM text response:

| Directive | Description |
|-----------|-------------|
| `move_to(x,y)` | Walk to a tile coordinate |
| `wait()` | Do nothing |
| `start_conversation_with(Name, message)` | Initiate a conversation with an adjacent entity |
| `end_conversation()` | End the current conversation |
| `complete_goal()` | Mark the active goal as done (doesn't count toward 3-command limit) |
| `abandon_goal()` | Give up on the active goal (doesn't count toward 3-command limit) |
| `switch_goal()` | Abandon active goal and promote pending goal (doesn't count toward 3-command limit) |

Unknown lines are logged as warnings.

### Error Handling

LLM errors are handled loudly:
- Red bold console error with full details
- On-screen turn label shows the error
- NPC falls back to `wait()` so the game continues

## Conversations

`ConversationManager` handles multi-turn dialogue between entities. Conversations can be initiated by NPCs (via `start_conversation_with`) or by the player (via the dialogue box UI).

Each exchange:
1. Build world state and memory for the responding NPC
2. Send conversation history + context to the LLM via `LLMService.converse()`
3. Parse the response as `say(message)` or `end_conversation()`
4. Display via speech bubbles

Conversations are capped at `MAX_EXCHANGES` (6) rounds. After a conversation ends, `GoalExtractor.extractGoal()` runs on the transcript to detect new goals for each NPC participant.

Conversation transcripts are recorded in the NPC's chronological log for future memory.

## Goals

Each NPC can have one **active** goal and one **pending** goal, persisted to `data/logs/goals-{Name}.md`.

### Goal Format

```markdown
## Active Goal
Source: Player asked me to find Cora
Goal: Locate Cora and deliver the Player's message
Status: active
Plan: Walk toward Cora's last known position and start a conversation
Success: Successfully delivering the message to Cora
```

### Goal Lifecycle

- **Extraction** — `GoalExtractor` analyzes conversation transcripts via LLM to detect new goals
- **Promotion** — when the active goal is completed or abandoned, the pending goal auto-promotes to active
- **Directives** — NPCs can `complete_goal()`, `abandon_goal()`, or `switch_goal()` during their turn

### Goal Manager

`GoalManager` handles serialization to/from Markdown, loading/saving via the log I/O endpoint (`/api/goals/:name`), and goal state transitions (complete, abandon, switch, promote).

## World State Format

The world state sent to the LLM is a compact text representation:

```
MAP: 30x30
YOU: Ada at (15,10)
  Player at (5,5)
  Bjorn at (25,20)
  Cora at (10,25)

[30 rows of 30 characters — one per tile]
. = grass (walkable), ~ = water (blocked), @ = you, P = player (blocked), A/B/C = NPCs (blocked)

ACTIONS: move_to(x,y) | wait()
```

Entities are overlaid on the map grid using single characters. The format is ~950 characters total for a 30x30 map.

## NPC Memory

Each NPC maintains a chronological log file at `data/logs/chronological-{Name}.md`. The log records observations (position, visible entities), executed actions, and conversation transcripts each turn.

### Log Format

```markdown
## Summary (Turns 1-5)
Ada explored the northeast quadrant, moving from (15,10) to (22,16). She saw Player near (5,5) and Bjorn heading south...

## Turn 6
- I am at (22,16)
- I can see: Player at (6,7), Bjorn at (23,18), Cora at (12,24)
- I moved to (24,18)
- I waited
- ### Conversation with Player (Turn 6)
  Location: (24, 18)
  Initiated by: Player
  Player: Can you find Bjorn?
  Ada: I'll head toward Bjorn now.
  [Conversation ended by Player]
```

### Summarization

Every 5 turns (configurable via `SUMMARIZE_EVERY_N_TURNS` in `prompts.ts`), the oldest unsummarized entries are compressed into a paragraph via the `/api/chat` endpoint using the `SUMMARIZE` prompt config. The most recent 5 turns always stay in full detail. This gives NPCs detailed recent memory and increasingly compressed older memory.

### Token Budget

The log content injected into the prompt is capped at 4000 characters (`LOG_CHAR_BUDGET` in `prompts.ts`). If the total exceeds the budget, the oldest summaries are dropped first, then the oldest full entries.

### Persistence

Log and goal files persist across server restarts via the `log-io.mjs` Vite plugin, which provides `GET/POST /api/logs/:name` and `GET/POST /api/goals/:name` endpoints.
