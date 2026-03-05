# LLM Integration

## Overview

Each NPC's turn is driven by Anthropic Claude. The game sends the current world state, memory, and goals to the LLM and receives back a list of commands to execute. NPCs can also converse with each other and the player, with goals extracted from conversations automatically.

## Flow

```
NPC Turn → load log & goals → build world state → POST /api/chat → parse directives → execute commands → save log & goals
```

## Centralized Configuration

LLM prompt configs live in `src/game/prompts.ts`. Each of the five LLM calls has its own `PromptConfig` object:

```typescript
interface PromptConfig {
  model: string;
  maxTokens: number;
  buildSystem: (...args: string[]) => string;
}
```

The five configs are: `DECISION`, `CONVERSATION`, `SUMMARIZE`, `GOAL_EXTRACTION`, `CODE_GENERATION`.

Model constants (`LLM_MODEL_OPUS`, `LLM_MODEL_SONNET`, `LLM_MODEL_HAIKU`) and gameplay tuning constants (`SUMMARIZE_EVERY_N_TURNS`, `LOG_CHAR_BUDGET`, `MAX_EXCHANGES`, `NPC_COMMANDS_PER_TURN`, `SLEEP_TURNS`) live in `src/game/GameConfig.ts`.

## Five LLM Calls

### 1. Decision (`DECISION`)

Used by `LLMService.decide()` each NPC turn. The system prompt defines the NPC's role, available commands, and goal/conversation directives.

**Model:** Opus | **Max tokens:** 256

**Context sent:** memory (chronological log), active/pending goals, world state (map + entity positions + buildings).

### 2. Conversation (`CONVERSATION`)

Used by `LLMService.converse()` during multi-turn dialogue. The system prompt instructs the NPC to respond in character and use `say(message)` or `end_conversation()`.

**Model:** Opus | **Max tokens:** 512

**Context sent:** memory, world state, full conversation history (as alternating user/assistant messages).

### 3. Summarization (`SUMMARIZE`)

Used by `ChronologicalLog.maybeSummarize()` to compress old log entries. The system prompt instructs the LLM to write a first-person summary preserving key locations, events, and conversations.

**Model:** Haiku | **Max tokens:** 512

**Context sent:** oldest unsummarized chronological log entries.

### 4. Goal Extraction (`GOAL_EXTRACTION`)

Used by `GoalExtractor.extractGoal()` after conversations end. The system prompt defines the goal format and instructs the LLM to detect implicit or explicit goals from the transcript.

**Model:** Sonnet | **Max tokens:** 256

**Context sent:** NPC's current goals, world state, conversation transcript. The system prompt is parameterized with the NPC's name via `buildSystem(npcName)`.

### 5. Code Generation (`CODE_GENERATION`)

Used by `ToolService.generateFunctionSpec()` (working alongside `validation.ts`) when an NPC creates or updates a function at the Code Forge via the `FunctionBuilderService`. The system prompt instructs the LLM to generate a synchronous, pure JS function implementation.

**Model:** Sonnet | **Max tokens:** 512

**Context sent:** natural-language description, optionally existing function code + change description. Returns JSON: `{ name, description, parameters[], returnDescription, code }`.

## Directives

The LLM responds with commands, one per line:

| Directive | Description | Counts toward limit |
|-----------|-------------|:---:|
| `move_to(x,y)` | Walk to tile (x,y), full path step-by-step | Yes |
| `wait()` | Do nothing for this action | Yes |
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

Each action command runs to completion before the next one starts. Up to 3 action commands per turn; goal directives don't count toward this limit.

## API Proxy

The browser calls API endpoints on the Vite dev server. In production builds, no server plugins are included.

### LLM Proxy (`POST /api/chat`)

The `anthropic-proxy.mjs` plugin forwards requests to the Anthropic Messages API. It handles all five LLM calls through this single endpoint. If a model returns 404, the proxy automatically retries with fallback models.

**Request body:**
```json
{
  "model": "claude-opus-4-6",
  "system": "...",
  "messages": [
    { "role": "user", "content": "YOUR MEMORY:\n..." },
    { "role": "assistant", "content": "Understood." },
    { "role": "user", "content": "<world state + goals>" }
  ],
  "max_tokens": 256
}
```

**Response:**
```json
{
  "text": "move_to(12,8)\nstart_conversation_with(Bjorn, Hello!)\nwait()"
}
```

### Search Proxy (`POST /api/search`)

The `search-proxy.mjs` plugin forwards queries to the Tavily Search API. Returns an answer summary and up to 3 search result snippets.

### Code Executor (`POST /api/execute`)

The `code-executor.mjs` plugin runs NPC-generated JavaScript in a sandboxed VM context with a 1-second timeout. Only safe globals are available (`Math`, `String`, `JSON`, etc.).

### Function Persistence (`/api/functions`)

The `functions-io.mjs` plugin provides CRUD for function records stored as JSON in `data/functions/`.

## Goals

Goals are extracted from conversation transcripts by the `GOAL_EXTRACTION` prompt. Each NPC can have one active and one pending goal, persisted to `data/logs/goals-{Name}.md`.

**Goal format:**
```markdown
## Active Goal
Source: Player asked me to find Cora
Goal: Locate Cora and deliver the Player's message
Status: active
Plan: Walk toward Cora's last known position and start a conversation
Success: Successfully delivering the message to Cora
```

Goal directives (`complete_goal`, `abandon_goal`, `switch_goal`) let NPCs manage their goals during turns without consuming action commands.

## Configuration

| Setting | Value | Location |
|---------|-------|----------|
| Model (decision) | Opus | `src/game/prompts.ts` → `DECISION` |
| Model (conversation) | Opus | `src/game/prompts.ts` → `CONVERSATION` |
| Model (summarize) | Haiku | `src/game/prompts.ts` → `SUMMARIZE` |
| Model (goal extraction) | Sonnet | `src/game/prompts.ts` → `GOAL_EXTRACTION` |
| Model (code generation) | Sonnet | `src/game/prompts.ts` → `CODE_GENERATION` |
| Max tokens (decision) | 256 | `src/game/prompts.ts` → `DECISION` |
| Max tokens (conversation) | 512 | `src/game/prompts.ts` → `CONVERSATION` |
| Max tokens (summarize) | 512 | `src/game/prompts.ts` → `SUMMARIZE` |
| Max tokens (goal extraction) | 256 | `src/game/prompts.ts` → `GOAL_EXTRACTION` |
| Max tokens (code generation) | 512 | `src/game/prompts.ts` → `CODE_GENERATION` |
| Commands per turn | 3 | `src/game/GameConfig.ts` → `NPC_COMMANDS_PER_TURN` |
| Delay between turns | 5 seconds | `src/game/GameConfig.ts` → `NPC_TURN_DELAY` |
| Summarize every N turns | 5 | `src/game/GameConfig.ts` → `SUMMARIZE_EVERY_N_TURNS` |
| Log character budget | 4000 | `src/game/GameConfig.ts` → `LOG_CHAR_BUDGET` |
| Max conversation exchanges | 6 | `src/game/GameConfig.ts` → `MAX_EXCHANGES` |
| Sleep duration | 10 turns | `src/game/GameConfig.ts` → `SLEEP_TURNS` |
| Anthropic API key | `.env` file | `ANTHROPIC_API_KEY` |
| Tavily API key | `.env` file | `TAVILY_API_KEY` |

## Error Handling

- Network/API errors are logged in red bold text to the browser console
- The on-screen turn label shows the error message
- The NPC falls back to `wait()` so the game loop continues
- Unknown directives from the LLM are logged as yellow warnings
- **Core Principle**: All execution outcomes, particularly parse errors and tool/sandbox fail states, MUST be explicitly fed back into the NPC's Chronological Log (`log.recordAction(error)`). If errors are only console-logged or thrown uncaught, the NPC loses feedback, repeats the exact same failing command on the next turn, and gets stuck in a loop.

## Debugging

All prompts and responses are logged to the browser console:
- **Blue** `[LLM] Ada's prompt` — system prompt, memory (if any), and world state
- **Purple (light)** `Memory:` — chronological log content sent to the LLM
- **Purple** `[LLM] Ada's response` — raw LLM output
- **Green** `[Ada] move_to(12, 8)` — each directive as it executes

## Memory

NPCs have persistent memory via chronological log files stored at `data/logs/chronological-{Name}.md`. Each turn, the log records the NPC's position, visible entities, executed actions, and conversation transcripts. Old entries are periodically summarized into compressed paragraphs.

At decision time, the log content is included in the prompt as a prior conversation turn (separate from the world state). The memory is capped at 4000 characters — the oldest summaries are dropped first if over budget, giving NPCs detailed recent memory and compressed older memory.

See [architecture.md](architecture.md) for the full log format and summarization details.
