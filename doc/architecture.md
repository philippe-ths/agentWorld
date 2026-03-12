# Architecture

## File Structure

```
src/
  main.ts                  Entry point — creates the Phaser game
  game/
    main.ts                Game config & StartGame()
    GameConfig.ts          Constants, model names, NPC/building definitions, interfaces
    prompts.ts             LLM prompt configs — PromptConfig interface, per-prompt model/tokens/system
    MapData.ts             Procedural 30x30 map (seeded PRNG, grass + water ponds)
    Pathfinder.ts          A* pathfinding on the tile grid
    WorldState.ts          Serializes game state into compact text for LLM consumption
    LLMService.ts          Client-side LLM caller — sends decision & conversation prompts, logs I/O
    DirectiveParser.ts     Parses LLM text responses into typed directive objects
    DirectiveExecutor.ts   Executes parsed directives — movement, tools, goals, sleep
    TurnManager.ts         Orchestrates NPC turn loop, sleep tracking, pause/resume
    FunctionBuilderService.ts Handles Code Forge validation, rejection feedback, and registration for LLM-generated code functions
    FunctionCapability.ts  Detects requests or generated code that need unsupported sandbox capabilities
    PersistedFunctionAudit.ts Partitions saved functions into supported vs unsupported records for startup cleanup
    validation.ts          JSON validation for generated function specs, structured rejections, and persisted records
    ChronologicalLog.ts    Per-NPC memory — records observations/actions, summarizes old turns
    ConversationManager.ts Manages NPC-NPC and player-NPC conversations via LLM
    GoalManager.ts         Per-NPC goal persistence — active/pending goals, promotion, serialization
    GoalExtractor.ts       Extracts new goals from conversation transcripts via LLM
    ToolBuilding.ts        Interface for interactive building objects (tools)
    ToolRegistry.ts        Registry mapping interactive building objects (tools) to their execution handlers
    ToolService.ts         Web search, structured code generation, sandboxed execution, and function persistence endpoints
    FunctionCapability.test.ts Capability-screening coverage for unsupported requests and code
    FunctionBuilderService.test.ts Code Forge rejection-path coverage for create/update flows
    PersistedFunctionAudit.test.ts Startup cleanup coverage for unsupported saved functions
    validation.test.ts     Coverage for valid function specs and structured rejections
    entities/
      Entity.ts            Abstract base — sprite, tile movement, name label, sleep visuals
      Player.ts            Keyboard-controlled entity (arrows / WASD)
      NPC.ts               LLM-driven entity (tinted sprite, async walk-to-target, optimistic pathfinding)
      EntityManager.ts     Holds all entities, runs updates, walkability + terrain checks
    scenes/
      Preloader.ts         Loads sprite sheet, generates tile & building textures, then starts GameScene
      GameScene.ts         Builds tilemap, spawns entities, audits persisted functions, and sets up systems
    ui/
      DialogueBox.ts       UI overlay for player-NPC conversation input
      SpeechBubble.ts      Floating speech bubble above speaking entities
vite/
  config.dev.mjs           Dev config — includes all server plugins
  config.prod.mjs          Production build config (static only, no API plugins)
  anthropic-proxy.mjs      Vite plugin — proxies /api/chat to Anthropic API with fallback model chain
  log-io.mjs               Vite plugin — reads/writes per-NPC log & goal .md files
  search-proxy.mjs         Vite plugin — proxies /api/search to Tavily Search API
  code-executor.mjs        Vite plugin — sandboxed JS execution via /api/execute (VM, 1s timeout)
  functions-io.mjs         Vite plugin — CRUD for NPC-created function records via /api/functions
  utils.mjs                Shared streaming utility for Vite request parsing
data/
  logs/                    Per-NPC chronological log and goal files (generated at runtime)
    chronological-{Name}.md
    goals-{Name}.md
    reflection-{Name}.md
  functions/               NPC-created function records (JSON, generated at runtime)
    {function_name}.json
```

## Scene Flow

```
Preloader → GameScene
```

Preloader loads the `player.png` sprite sheet and generates isometric diamond textures for grass/water tiles at runtime. Then it starts GameScene.

## Entities

`Entity` is the abstract base class. It creates a sprite at a tile position, handles animated tile-to-tile movement via tweens, displays a name label, and supports a sleeping visual state (rotated sprite + "zzZ" label).

- **Player** — reads keyboard input each frame, calls `moveTo()` on key press. Moves freely at any time (not part of the turn system).
- **NPC** — driven by LLM via `TurnManager`. Has `walkToAsync()` for full-path movement with optimistic pathfinding (ignores entities on first attempt, re-paths up to 5 times if blocked). Returns a `WalkResult` with `reached` and optional `reason` (`no_path` or `repath_limit`). A `conversationPauseGate` pauses movement mid-walk during active conversations.

`EntityManager` stores all entities, runs their `update()` each frame, and provides two walkability checks:
- `isWalkable()` — bounds + water + buildings + occupied tiles
- `isTerrainWalkable()` — bounds + water + buildings only (ignores entities, used for optimistic NPC pathfinding)

## Map

Generated once at import time by `MapData.ts`. Uses a seeded PRNG (mulberry32, seed 42) to place 3-5 organic water ponds on a 30x30 grass field. Spawn areas for the player, all NPCs, and building neighborhoods are guaranteed clear.

## Turn System

`TurnManager` runs an async loop that cycles through NPCs sequentially (Ada → Bjorn → Cora). For each NPC's turn:

1. Check sleep status — if sleeping, skip the LLM call and decrement remaining sleep turns
2. Load the NPC's chronological log, goals, and reflection snapshot from disk
3. Record observations to the log (position, visible entities)
4. Build world state text via `WorldState.buildWorldState()`
5. Build memory content from the log via `ChronologicalLog.buildPromptContent()`
6. Build goal content via `GoalManager.buildPromptContent()`
7. Refresh reflection when stale, then build reflection content via `ReflectionManager.buildPromptContent()`
8. Send world state + memory + goals + reflection to Claude via `LLMService.decide()`
9. Apply the output guard (repair + strict validation + one reprompt). If still invalid, fall back to `wait()` and record an output-format failure for reflection.
10. Parse response into directives via `DirectiveParser.parseDirectives()`
11. Execute goal directives instantly (don't count toward budget), then up to 3 action directives via `DirectiveExecutor`. Structured action outcomes are also fed into reflection state so repeated obstacles can be detected without scraping free-form log text. Turn-ending directives (`start_conversation_with`, `use_tool`, `sleep`) stop execution immediately.
12. Handle function directives (`create_function`, `update_function`, `delete_function`) via `TurnManager`, with capability checks and rejection feedback handled by `FunctionBuilderService`
13. Save the log, goals, and reflection snapshot to disk
14. Trigger summarization of old entries if enough have accumulated
15. Wait 5 seconds before the next NPC's turn

The player is **not** part of the turn system and can move at any time.

Press **P** to pause/resume the NPC turn loop.

## LLM Integration

### Configuration

LLM prompt configs live in `src/game/prompts.ts`. Each LLM call has its own `PromptConfig` object containing `model`, `maxTokens`, and `buildSystem()`. Model constants (`LLM_MODEL_OPUS`, `LLM_MODEL_SONNET`, `LLM_MODEL_HAIKU`) and gameplay tuning constants (`SUMMARIZE_EVERY_N_TURNS`, `REFLECTION_EVERY_N_TURNS`, `LOG_CHAR_BUDGET`, `MAX_EXCHANGES`, `NPC_COMMANDS_PER_TURN`, `SLEEP_TURNS`) live in `src/game/GameConfig.ts`.

### Server Side

Vite server plugins (dev only) expose the following API endpoints:

| Endpoint | Plugin | Purpose |
|----------|--------|---------|
| `POST /api/chat` | `anthropic-proxy.mjs` | Proxy to Anthropic Messages API (all 5 LLM calls). Auto-retries with fallback models on 404. |
| `POST /api/search` | `search-proxy.mjs` | Proxy to Tavily Search API for web search queries |
| `POST /api/execute` | `code-executor.mjs` | Sandboxed JS execution in VM context (1s timeout) |
| `GET/POST /api/logs/:name` | `log-io.mjs` | Per-NPC chronological log file I/O |
| `GET/POST /api/goals/:name` | `log-io.mjs` | Per-NPC goal file I/O |
| `GET/POST /api/reflections/:name` | `log-io.mjs` | Per-NPC reflection snapshot file I/O |
| `GET/POST/DELETE /api/functions[/:name]` | `functions-io.mjs` | CRUD for NPC-created function records |

All API keys (`ANTHROPIC_API_KEY`, `TAVILY_API_KEY`) are loaded from `.env` and kept server-side.

### Client Side

Six LLM calls go through `/api/chat`, each with its own prompt config from `prompts.ts`:

1. **Decision** (`LLMService.decide()`) — NPC action selection. Context: memory, goals, reflection, world state.
2. **Conversation** (`LLMService.converse()`) — in-character dialogue responses. Context: memory, reflection, world state, conversation history.
3. **Reflection refresh** (`ReflectionManager.refreshIfStale()`) — updates compact reflection state. Context: triggers, recent failures, recent successes, goals, memory, world state.
4. **Summarization** (`ChronologicalLog.maybeSummarize()`) — compresses old memory entries. Context: oldest chronological log entries.
5. **Goal extraction** (`GoalExtractor.extractGoal()`) — detects new goals or resolves the current goal from conversation transcripts. Context: current goals, world state, conversation transcript.
6. **Code generation** (`ToolService.generateFunctionSpec()`) — generates JS function implementations. Context: description, optional existing code + change description.

### Directives

`DirectiveParser` extracts structured commands from the LLM text response:

| Directive | Description | Budget |
|-----------|-------------|:------:|
| `move_to(x,y)` | Walk to a tile coordinate | Yes |
| `wait()` | Do nothing | Yes |
| `start_conversation_with(Name, message)` | Initiate a conversation with an adjacent entity (ends turn) | Yes |
| `end_conversation()` | End the current conversation | Yes |
| `use_tool(tool_id, "args")` | Use an adjacent tool building (ends turn) | Yes |
| `sleep()` | Enter low-power mode for `SLEEP_TURNS` turns (ends turn) | Yes |
| `create_function("desc", x, y)` | Create a new function building at Code Forge (ends turn) | Yes |
| `update_function("name", "change")` | Update an existing function at Code Forge (ends turn) | Yes |
| `delete_function("name")` | Delete a function building at Code Forge (ends turn) | Yes |
| `complete_goal()` | Mark the active goal as done | No |
| `abandon_goal()` | Give up on the active goal | No |
| `switch_goal()` | Abandon active goal and promote pending goal | No |

Execution is handled by `DirectiveExecutor`. Unknown lines are logged as warnings.

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

See [conversations.md](conversations.md) for the full conversation lifecycle, validation rules, and UI details.

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

## Reflection

Each NPC also has a compact reflection snapshot persisted to `data/logs/reflection-{Name}.md`.

### Reflection Format

```markdown
## Reflection
Repeated obstacle: no_path:(12,8) (repeated 2 times)
Active obstacle: output_format:unknown_directive (consecutive turns)
Resolved obstacle: no_path:(12,8) (repeated 2 times)
Recent success pattern: Approaching the Search Terminal before using it works
Failed assumption: I assumed the north path to the pond was open
Current strategy: Respond with command lines only and no commentary
Retired strategy: Try a different route before attempting the pond again
Completion lesson: Verify placement with precise checks before finalizing output
Confidence: 3
Stale reflection flag: no
Updated turn: 15
Trigger: repeated_failed_action
```

Reflection is separate from chronological memory, summaries, and goals. It is refreshed when one of these triggers fires:

- Every `REFLECTION_EVERY_N_TURNS` turns
- After a repeated failed action detected from structured action outcomes
- Immediately when unknown directives in one turn reach `UNKNOWN_DIRECTIVE_TRIGGER_THRESHOLD`
- As a primary obstacle when the same output-format failure repeats on consecutive turns
- After a completed goal
- After a conversation that creates or resolves a goal

Reflection is injected into both decision and conversation prompts so NPCs can carry a compact strategy signal without bloating the chronological log.

## World State Format

The world state sent to the LLM is a compact text representation:

```
MAP: 30x30
YOU: Ada at (15,10)
  Player at (5,5)
  Bjorn at (25,20)
  Cora at (10,25)

BUILDINGS:
  Search Terminal at (15,15) — A terminal that can search the internet
  Code Forge at (20,15) — A forge where new function buildings can be created

[30 rows of 30 characters — one per tile]
. = grass, ~ = water, @ = you, P/A/B/C = entities, S/C = buildings

ACTIONS: move_to(x,y) | wait()
```

Entities and buildings are overlaid on the map grid using single characters. When an NPC is adjacent to a tool building, that building's usage instructions are appended to the world state.

## Buildings & Tools

The game has interactive building objects that NPCs can use by moving adjacent and issuing directives. Buildings are defined in `GameConfig.ts` and managed by `ToolRegistry`.

### Built-in Buildings

| Building | Position | Symbol | Description |
|----------|----------|--------|-------------|
| Search Terminal | (15,15) | `S` | Searches the web via Tavily API. Use: `use_tool(search_terminal, "query")` |
| Code Forge | (20,15) | `C` | Creates, updates, or deletes supported pure-computation function buildings. Unsupported requests are rejected. Use: `create_function(...)`, `update_function(...)`, `delete_function(...)` |

### NPC-Created Function Buildings

NPCs can create new function buildings at the Code Forge. The flow:
1. NPC moves adjacent to Code Forge and issues `create_function("description", x, y)`
2. `FunctionBuilderService` screens the request for unsupported capabilities such as email sending, external APIs, filesystem access, or database access
3. `ToolService.generateFunctionSpec()` calls the `CODE_GENERATION` LLM prompt, which can return either a normal function spec or a structured rejection
4. Generated code is screened again, then tested in the sandbox (`/api/execute`) before saving
5. On success, a `FunctionRecord` is persisted to `data/functions/{name}.json` and registered as a new tool building on the map
6. On rejection or failure, the reason is written into the creator NPC's chronological log so the NPC can react honestly on a later turn
7. Other NPCs can then move adjacent and call supported functions via `use_tool(function_name, "args")`

Function buildings can also be updated (`update_function`) or deleted (`delete_function`).

Persisted function records are also audited when the scene starts. Unsupported legacy records are removed from `data/functions/`, skipped during building registration, and a system note is appended to the creator NPC's chronological log explaining why the function was removed.

### Tool System

- `ToolBuilding` — interface: `id`, `displayName`, `tile`, `symbol`, `description`, `instructions`, `execute(args)`
- `ToolRegistry` — registers/unregisters buildings, lookup by id or position, adjacency checks
- `ToolService` — web search (`/api/search`), code generation (`/api/chat`), sandboxed execution (`/api/execute`), function CRUD (`/api/functions`)

## Sleep

NPCs can enter a low-power sleep mode via the `sleep()` directive. Sleep lasts for `SLEEP_TURNS` (10) turns during which the NPC skips the LLM call entirely. Visual feedback: the sprite rotates 90° and a "zzZ" label appears.

Sleeping NPCs are automatically woken if another entity starts a conversation with them.

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

Every 5 turns (configurable via `SUMMARIZE_EVERY_N_TURNS` in `GameConfig.ts`), the oldest unsummarized entries are compressed into a paragraph via the `/api/chat` endpoint using the `SUMMARIZE` prompt config. The most recent 5 turns always stay in full detail. This gives NPCs detailed recent memory and increasingly compressed older memory.

### Token Budget

The log content injected into the prompt is capped at 4000 characters (`LOG_CHAR_BUDGET` in `GameConfig.ts`). If the total exceeds the budget, the oldest summaries are dropped first, then the oldest full entries.

### Persistence

Log, goal, and reflection files persist across server restarts via the `log-io.mjs` Vite plugin, which provides `GET/POST /api/logs/:name`, `GET/POST /api/goals/:name`, and `GET/POST /api/reflections/:name` endpoints.
