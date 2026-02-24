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
    entities/
      Entity.ts            Abstract base — sprite, tile movement, name label, depth sort
      Player.ts            Keyboard-controlled entity (arrows / WASD)
      NPC.ts               LLM-driven entity (tinted sprite, async walk-to-target)
      EntityManager.ts     Holds all entities, runs updates, walkability check
    scenes/
      Preloader.ts         Loads sprite sheet, generates tile textures, then starts GameScene
      GameScene.ts         Builds tilemap, spawns player + 3 NPCs, sets up camera & TurnManager
vite/
  config.dev.mjs           Dev config — includes Anthropic proxy plugin
  config.prod.mjs          Production build config
  anthropic-proxy.mjs      Vite server plugin — proxies /api/chat to Anthropic API
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

1. Build world state text via `WorldState.buildWorldState()`
2. Send to Claude via `LLMService.decide()`
3. Parse response into directives via `DirectiveParser.parseDirectives()`
4. Execute up to 3 directives (commands) — each runs to completion before the next
5. Wait 5 seconds before the next NPC's turn

The player is **not** part of the turn system and can move at any time.

Press **P** to pause/resume the NPC turn loop.

## LLM Integration

### Server Side

`vite/anthropic-proxy.mjs` is a Vite server plugin that adds a `POST /api/chat` endpoint. It:
- Loads `ANTHROPIC_API_KEY` from `.env` at startup
- Proxies requests to the Anthropic Messages API
- Keeps the API key server-side (never sent to the browser)

### Client Side

`LLMService` sends the system prompt + world state to `/api/chat` and returns the raw text response. All prompts and responses are logged to the browser console with colored formatting.

### Directives

`DirectiveParser` extracts structured commands from the LLM text response:
- `move_to(x,y)` — walk to a tile coordinate
- `wait()` — do nothing

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

ACTIONS: move_to(x,y) | wait()
```

Entities are overlaid on the map grid using single characters. The format is ~950 characters total for a 30x30 map.
