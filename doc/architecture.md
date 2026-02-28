# Architecture

## File Structure

```
src/
  main.ts                  Entry point — creates the Phaser game
  game/
    main.ts                Game config & StartGame()
    MapData.ts             Procedural 30x30 map (seeded PRNG, grass + water ponds)
    WorldState.ts          Serializes game state into compact text for LLM consumption
    LLMService.ts          Client-side LLM caller — sends prompts, logs I/O to console
    DirectiveParser.ts     Parses LLM text responses into typed directive objects
    TurnManager.ts         Orchestrates NPC turn loop, executes directives, pause/resume
    ChronologicalLog.ts    Per-NPC memory — records observations/actions, summarizes old turns
    ConversationManager.ts NPC-NPC and Player-NPC conversation orchestrator
    entities/
      Entity.ts            Abstract base — sprite, tile movement, name label, depth sort
      Player.ts            Keyboard-controlled entity (arrows / WASD)
      NPC.ts               LLM-driven entity (tinted sprite, async walk-to-target)
      EntityManager.ts     Holds all entities, runs updates, walkability check
    scenes/
      Preloader.ts         Loads sprite sheet, generates tile textures, then starts GameScene
      GameScene.ts         Builds tilemap, spawns player + 3 NPCs, sets up camera & TurnManager
    ui/
      SpeechBubble.ts      NPC speech bubble rendering (white rounded-rect with arrow)
      DialogueBox.ts       Player dialogue panel with hybrid Phaser/HTML text input
vite/
  config.dev.mjs           Dev config — includes Anthropic proxy plugin
  config.prod.mjs          Production build config
  anthropic-proxy.mjs      Vite server plugin — proxies /api/chat to Anthropic API
  log-io.mjs               Vite server plugin — reads/writes per-NPC log .md files
  summarize-proxy.mjs      Vite server plugin — proxies /api/summarize for log compression
data/
  logs/                    Per-NPC chronological log files (generated at runtime, gitignored)
```

## Scene Flow

```
Preloader → GameScene
```

Preloader loads the `player.png` sprite sheet and generates isometric diamond textures for grass/water tiles at runtime. Then it starts GameScene.

## Entities

`Entity` is the abstract base class. It creates a sprite at a tile position, handles animated tile-to-tile movement via tweens, and displays a name label.

- **Player** — reads keyboard input each frame, calls `moveTo()` on key press. Moves freely at any time (not part of the turn system). Can initiate conversations with adjacent NPCs via **Enter**.
- **NPC** — driven by LLM via `TurnManager`. Has `walkToAsync()` for full-path movement and `stepTowardAsync()` for single-step pathfinding. Movement is gated during active conversations.

`Entity` provides `isAdjacentTo(other)` for proximity checks (used by the conversation system).

`EntityManager` stores all entities, runs their `update()` each frame, provides `isWalkable()` (bounds + water + occupied tiles), and `getByName()` for entity lookup.

## Map

Generated once at import time by `MapData.ts`. Uses a seeded PRNG (mulberry32, seed 42) to place 3-5 organic water ponds on a 30x30 grass field. Spawn areas for the player and all NPCs are guaranteed clear.

## Turn System

`TurnManager` runs an async loop that cycles through NPCs sequentially (Ada → Bjorn → Cora). For each NPC's turn:

1. Record observations to the NPC's chronological log (position, visible entities)
2. Build world state text via `WorldState.buildWorldState()`
3. Build memory content from the log via `ChronologicalLog.buildPromptContent()`
4. Send world state + memory to Claude via `LLMService.decide()`
5. Parse response into directives via `DirectiveParser.parseDirectives()`
6. Execute up to 3 directives — each runs to completion before the next; record each action to the log
7. Save the log to disk
8. Trigger summarization of old entries if enough have accumulated
9. Wait 5 seconds before the next NPC's turn

The player is **not** part of the turn system and can move at any time.

Press **P** to pause/resume the NPC turn loop.

## LLM Integration

### Server Side

`vite/anthropic-proxy.mjs` is a Vite server plugin that adds a `POST /api/chat` endpoint. It:
- Loads `ANTHROPIC_API_KEY` from `.env` at startup
- Proxies requests to the Anthropic Messages API
- Keeps the API key server-side (never sent to the browser)

### Client Side

`LLMService` sends the system prompt, optional memory (as a prior conversation turn), and the world state to `/api/chat` and returns the raw text response. All prompts, memory, and responses are logged to the browser console with colored formatting.

`ChronologicalLog` manages per-NPC memory. It records observations and actions each turn, serializes them to Markdown files on disk via the log I/O endpoint, and builds budget-constrained prompt content for the LLM.

### Directives

`DirectiveParser` extracts structured commands from the LLM text response:
- `move_to(x,y)` — walk to a tile coordinate
- `wait()` — do nothing
- `start_conversation_with(Name, message)` — begin a conversation with an adjacent entity
- `end_conversation()` — end the current conversation

Unknown lines are logged as warnings.

### Error Handling

LLM errors are handled loudly:
- Red bold console error with full details
- On-screen turn label shows the error
- NPC falls back to `wait()` so the game continues

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

ACTIONS: move_to(x,y) | wait() | start_conversation_with(Name, message) | end_conversation()
```

Entities are overlaid on the map grid using single characters. The format is ~950 characters total for a 30x30 map.

## Conversations

NPCs can hold conversations with each other (shown via speech bubbles) and with the player (via a dialogue box). Conversations pause the turn system and resume when they finish. See [conversations.md](conversations.md) for full details.

## NPC Memory

Each NPC maintains a chronological log file at `data/logs/chronological-{Name}.md`. The log records observations (position, visible entities) and executed actions each turn.

### Log Format

```markdown
## Summary (Turns 1-5)
I explored the northeast quadrant, moving from (15,10) to (22,16). I saw Player near (5,5) and Bjorn heading south...

## Turn 6
- I am at (22,16)
- I can see: Player at (6,7), Bjorn at (23,18), Cora at (12,24)
- I moved to (24,18)
- I waited
```

### Summarization

Every 5 turns (configurable via `SUMMARIZE_EVERY_N_TURNS`), the oldest unsummarized entries are compressed into a paragraph via the `/api/summarize` endpoint. The most recent 5 turns always stay in full detail. This gives NPCs detailed recent memory and increasingly compressed older memory.

Conversation transcripts are also recorded in the log — for NPC-NPC conversations both participants get the transcript, for player conversations only the NPC's log is updated.

### Token Budget

The log content injected into the prompt is capped at 4000 characters (`LOG_CHAR_BUDGET`). If the total exceeds the budget, the oldest summaries are dropped first, then the oldest full entries.

### Persistence

Log files persist across server restarts via the `log-io.mjs` Vite plugin, which provides `GET /api/logs/:name` and `POST /api/logs/:name` endpoints.
