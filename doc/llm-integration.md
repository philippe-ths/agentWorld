# LLM Integration

## Overview

Each NPC's turn is driven by Anthropic Claude. The game sends the current world state, memory, and goals to the LLM and receives back a list of commands to execute. NPCs can also converse with each other and the player, with goals extracted from conversations automatically.

## Flow

```
NPC Turn → load log & goals → build world state → POST /api/chat → parse directives → execute commands → save log & goals
```

## Centralized Configuration

All LLM parameters live in `src/game/prompts.ts`. Each of the four LLM calls has its own `PromptConfig` object:

```typescript
interface PromptConfig {
  model: string;
  maxTokens: number;
  buildSystem: (...args: string[]) => string;
}
```

The four configs are: `DECISION`, `CONVERSATION`, `SUMMARIZE`, `GOAL_EXTRACTION`.

Gameplay tuning constants are also exported from `prompts.ts`: `SUMMARIZE_EVERY_N_TURNS`, `LOG_CHAR_BUDGET`, `MAX_EXCHANGES`.

## Four LLM Calls

### 1. Decision (`DECISION`)

Used by `LLMService.decide()` each NPC turn. The system prompt defines the NPC's role, available commands, and goal/conversation directives.

**Context sent:** memory (chronological log), active/pending goals, world state (map + entity positions).

### 2. Conversation (`CONVERSATION`)

Used by `LLMService.converse()` during multi-turn dialogue. The system prompt instructs the NPC to respond in character and use `say(message)` or `end_conversation()`.

**Context sent:** memory, world state, full conversation history (as alternating user/assistant messages).

### 3. Summarization (`SUMMARIZE`)

Used by `ChronologicalLog.maybeSummarize()` to compress old log entries. The system prompt instructs the LLM to write a first-person summary preserving key locations, events, and conversations.

**Context sent:** oldest unsummarized chronological log entries.

### 4. Goal Extraction (`GOAL_EXTRACTION`)

Used by `GoalExtractor.extractGoal()` after conversations end. The system prompt defines the goal format and instructs the LLM to detect implicit or explicit goals from the transcript.

**Context sent:** NPC's current goals, world state, conversation transcript. The system prompt is parameterized with the NPC's name via `buildSystem(npcName)`.

## Directives

The LLM responds with commands, one per line:

| Directive | Description | Counts toward limit |
|-----------|-------------|:---:|
| `move_to(x,y)` | Walk to tile (x,y), full path step-by-step | Yes |
| `wait()` | Do nothing for this action | Yes |
| `start_conversation_with(Name, message)` | Initiate dialogue with an adjacent entity | Yes |
| `end_conversation()` | End the current conversation | Yes |
| `complete_goal()` | Mark the active goal as done | No |
| `abandon_goal()` | Give up on the active goal | No |
| `switch_goal()` | Abandon active, promote pending to active | No |

Each action command runs to completion before the next one starts. Up to 3 action commands per turn; goal directives don't count toward this limit.

## API Proxy

The browser calls `POST /api/chat` on the Vite dev server. The `anthropic-proxy.mjs` plugin forwards it to the Anthropic Messages API. This single endpoint handles all four LLM calls.

**Request body:**
```json
{
  "model": "claude-sonnet-4-20250514",
  "system": "...",
  "messages": [
    { "role": "user", "content": "YOUR MEMORY:\n..." },
    { "role": "assistant", "content": "Understood." },
    { "role": "user", "content": "<world state + goals>" }
  ],
  "max_tokens": 256
}
```

The `model` and `max_tokens` come from the prompt config on the client side. Memory is sent as a prior conversation turn so the LLM treats it as background context, separate from the current world state snapshot.

**Response:**
```json
{
  "text": "move_to(12,8)\nstart_conversation_with(Bjorn, Hello!)\nwait()"
}
```

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
| Model | claude-sonnet-4-20250514 | `src/game/prompts.ts` (per-prompt) |
| Max tokens (decision) | 256 | `src/game/prompts.ts` → `DECISION` |
| Max tokens (conversation) | 512 | `src/game/prompts.ts` → `CONVERSATION` |
| Max tokens (summarize) | 512 | `src/game/prompts.ts` → `SUMMARIZE` |
| Max tokens (goal extraction) | 128 | `src/game/prompts.ts` → `GOAL_EXTRACTION` |
| Commands per turn | 3 | `src/game/TurnManager.ts` |
| Delay between turns | 5 seconds | `src/game/TurnManager.ts` |
| Summarize every N turns | 5 | `src/game/prompts.ts` |
| Log character budget | 4000 | `src/game/prompts.ts` |
| Max conversation exchanges | 6 | `src/game/prompts.ts` |
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

NPCs have persistent memory via chronological log files stored at `data/logs/chronological-{Name}.md`. Each turn, the log records the NPC's position, visible entities, executed actions, and conversation transcripts. Old entries are periodically summarized into compressed paragraphs.

At decision time, the log content is included in the prompt as a prior conversation turn (separate from the world state). The memory is capped at 4000 characters — the oldest summaries are dropped first if over budget, giving NPCs detailed recent memory and compressed older memory.

See [architecture.md](architecture.md) for the full log format and summarization details.
