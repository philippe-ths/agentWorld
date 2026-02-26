# LLM Integration

## Overview

Each NPC's turn is driven by Anthropic Claude. The game sends the current world state to the LLM and receives back a list of commands to execute.

## Flow

```
NPC Turn → build world state → POST /api/chat → parse directives → execute commands
```

## System Prompt

All NPCs share the same system prompt:

```
You are an NPC in a 2D isometric tile-based game world.
Each turn you receive a map of the world showing terrain and entity positions.
You also receive YOUR MEMORY — a log of your past observations and actions.
Use it to avoid revisiting the same areas and to make informed exploration decisions.
You are a helpful NPC — you explore the world.

Available commands (you get up to 3 per turn):
  move_to(x,y) — walk to tile (x,y)
  wait()       — do nothing this action

Respond ONLY with commands, one per line. No commentary. Example:
move_to(12,8)
move_to(5,14)
wait()
```

## World State (User Message)

The world state is built per-NPC and sent as the user message. Example:

```
MAP: 30x30
YOU: Ada at (15,10)
  Player at (5,5)
  Bjorn at (25,20)
  Cora at (10,25)

..............................
..............................
......................~.~~....
....................~~~~~~....
.....P..............~~~~~~....
...............@..............
..............................
[... 30 rows total ...]
. = grass (walkable), ~ = water (blocked), @ = you, P = player (blocked), A/B/C = NPCs (blocked)

ACTIONS: move_to(x,y) | wait()
```

## Directives

The LLM responds with up to 3 commands, one per line:

| Directive | Description |
|-----------|-------------|
| `move_to(x,y)` | Walk to tile (x,y), full path step-by-step |
| `wait()` | Do nothing for this action |

Each command runs to completion before the next one starts.

## API Proxy

The browser calls `POST /api/chat` on the Vite dev server. The `anthropic-proxy.mjs` plugin forwards it to the Anthropic Messages API.

**Request body (without memory):**
```json
{
  "system": "...",
  "messages": [{ "role": "user", "content": "<world state>" }]
}
```

**Request body (with memory):**
```json
{
  "system": "...",
  "messages": [
    { "role": "user", "content": "YOUR MEMORY:\n..." },
    { "role": "assistant", "content": "Understood." },
    { "role": "user", "content": "<world state>" }
  ]
}
```

Memory is sent as a prior conversation turn so the LLM treats it as background context, separate from the current world state snapshot.

**Response:**
```json
{
  "text": "move_to(12,8)\nmove_to(5,14)\nwait()"
}
```

## Summarize Endpoint

The `summarize-proxy.mjs` plugin provides `POST /api/summarize` for compressing old log entries.

**Request:**
```json
{
  "entries": "## Turn 1\n- I am at (15,10)\n..."
}
```

**Response:**
```json
{
  "summary": "I explored the northeast quadrant, starting from (15,10)..."
}
```

Uses a dedicated system prompt that instructs the LLM to write a first-person summary preserving key locations and events.

## Configuration

| Setting | Value | Location |
|---------|-------|----------|
| Model | claude-sonnet-4-20250514 | `vite/anthropic-proxy.mjs` |
| Max tokens (decisions) | 256 | `vite/anthropic-proxy.mjs` |
| Max tokens (summaries) | 512 | `vite/summarize-proxy.mjs` |
| Commands per turn | 3 | `src/game/TurnManager.ts` |
| Delay between turns | 5 seconds | `src/game/TurnManager.ts` |
| Summarize every N turns | 5 | `src/game/ChronologicalLog.ts` |
| Log character budget | 4000 | `src/game/ChronologicalLog.ts` |
| API key | `.env` file | `ANTHROPIC_API_KEY` |

## Error Handling

- Network/API errors are logged in red bold text to the browser console
- The on-screen turn label shows the error message
- The NPC falls back to `wait()` so the game loop continues
- Unknown directives from the LLM are logged as yellow warnings

## Debugging

All prompts and responses are logged to the browser console:
- **Blue** `[LLM] Ada's prompt` — system prompt, memory (if any), and world state
- **Purple (light)** `Memory:` — chronological log content sent to the LLM
- **Purple** `[LLM] Ada's response` — raw LLM output
- **Green** `[Ada] move_to(12, 8)` — each directive as it executes

## Memory

NPCs have persistent memory via chronological log files stored at `data/logs/chronological-{Name}.md`. Each turn, the log records the NPC's position, visible entities, and executed actions. Old entries are periodically summarized into compressed paragraphs.

At decision time, the log content is included in the prompt as a prior conversation turn (separate from the world state). The memory is capped at 4000 characters — the oldest summaries are dropped first if over budget, giving NPCs detailed recent memory and compressed older memory.

See [architecture.md](architecture.md) for the full log format and summarization details.
