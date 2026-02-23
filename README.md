# AgentWorld

An isometric Phaser 3 game where AI-driven NPCs collaborate autonomously using a **protocol-based collective reasoning** system powered by Claude LLMs. NPCs decompose tasks, negotiate plans, execute actions, verify results, and learn from experience — all through a vocabulary of 7 protocol primitives with no central coordinator.

![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)

## Tech Stack

| Layer | Technology |
|-------|------------|
| Client | Phaser 3, TypeScript, Vite |
| Server | Express, TypeScript (tsx) |
| AI | Anthropic Claude (Haiku + Sonnet) |
| Embeddings | @xenova/transformers (all-MiniLM-L6-v2, local) |
| Tests | Vitest |

## Architecture

NPCs operate across three intelligence tiers:

| Tier | Implementation | Purpose |
|------|---------------|---------|
| **Strategic** | Sonnet LLM calls | Task decomposition, plan evaluation, revision on failure |
| **Tactical** | Haiku LLM calls | Dialogue, simple decisions, lesson extraction |
| **Mechanical** | Client-side code | Movement, pathfinding, condition checks, state queries |

Each tier's job is to reduce complexity so the tier below it can operate. Strategy removes ambiguity for tactics. Tactics reduces decisions to actions for execution.

### Protocol System

NPCs coordinate using 7 protocol primitives (see [docs/protocol-primitives.md](docs/protocol-primitives.md)):

```
Propose → Accept → Attempt → Report
            ↑                    │
            └── Question/Revise ─┘
                                 └── Remember
```

- **Propose** — decompose a task into sub-tasks with completion criteria
- **Accept** — commit to a sub-task with understood criteria and escalation conditions
- **Attempt** — execute an action and observe the result
- **Report** — share completion, failure, progress, or observations
- **Question** — challenge a proposal's completeness, assumptions, or efficiency
- **Revise** — update a plan in response to questions or failures
- **Remember** — distill lessons from completed cycles

No central coordinator. Leadership is emergent — it belongs to whoever proposed the approach others accepted.

## Features

- **Protocol-based NPC coordination** — NPCs propose, debate, execute, and verify plans through structured message passing.
- **Mechanical intelligence layer** — BehaviorMachine executes structured actions (travel, pursue, flee, wait_until); ConditionChecker evaluates completion criteria without LLM calls.
- **Conversations** — NPC-to-NPC and player-to-NPC dialogue. Player messages trigger protocol task flows.
- **Memory** — per-NPC short-term buffer, vector-indexed long-term memory with decay, knowledge graph (entities, relations, world rules), and periodic reflection.
- **Procedural world** — 64×64 isometric tile map with seeded terrain generation.

## Prerequisites

- Node.js ≥ 18
- An [Anthropic API key](https://console.anthropic.com/)

## Setup

```bash
# Clone
git clone https://github.com/philippe-ths/agentWorld.git
cd agentWorld

# Client dependencies
npm install

# Server dependencies
cd server
npm install

# Create .env with your API key
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
cd ..
```

## Run

Start both the server and the client dev server:

```bash
# Terminal 1 — API server (port 3001)
cd server && npm run dev

# Terminal 2 — Vite dev server (port 8080)
npm run dev
```

Open `http://localhost:8080` in your browser.

## Controls

| Key / UI | Action |
|----------|--------|
| WASD / Arrows | Move the player |
| Enter | Open chat input (talk to nearest NPC) |
| Escape | Close chat input |
| ▶ / ⏸ / ↺ buttons | Play / Pause / Restart AI loops |
| 📋 button | Toggle activity log panel |

## Project Structure

```
agentWorld/
├── src/game/              # Phaser client
│   ├── entities/          #   Entity, NPC, Player, EntityManager
│   ├── scenes/            #   Boot, Preloader, GameScene
│   ├── ai/                #   BehaviorMachine, ConditionChecker, AgentClient,
│   │                      #   AgentLoop, ConversationManager, Pathfinding
│   ├── protocol/          #   ProtocolRouter, ProtocolAgent, types
│   ├── world/             #   WorldQuery, Capabilities
│   └── ui/                #   ChatController, SpeechBubble, EventLog, LogPanel
├── server/src/            # Express API server
│   ├── ai/                #   PromptTemplates, ApiQueue, SlowLoop
│   ├── memory/            #   ShortTermBuffer, LongTermMemory, KnowledgeGraph,
│   │                      #   Reflection, Embeddings
│   └── __tests__/         #   Vitest test suites
├── server/data/           # Persisted NPC memory & knowledge (JSON)
├── public/                # Static assets & CSS
├── docs/                  # Detailed documentation
└── vite/                  # Vite configs (dev & prod)
```

## NPCs

| Name | Spawn | Personality |
|------|-------|-------------|
| Ada | (15, 10) | Thoughtful and methodical. Prefers careful analysis before acting. |
| Bjorn | (25, 20) | Direct and practical. Focuses on efficient solutions. |
| Cora | (10, 25) | Curious and observant. Notices details others miss. |

Each NPC has per-agent memory files in `server/data/` (`*_memory.json`, `*_buffer.json`, `*_kg.json`, `*_beliefs.json`).

## Server API

| Endpoint | Purpose |
|----------|---------|
| `POST /api/npc/tick` | Stub skill selection |
| `POST /api/npc/reason` | Dialogue or reasoning |
| `POST /api/npc/failure` | Report failure for self-critique |
| `POST /api/npc/skill-outcome` | Report skill success/failure |
| `POST /api/protocol/propose` | Generate task decomposition (Sonnet) |
| `POST /api/protocol/dialogue` | Generate conversation turn (Sonnet) |
| `POST /api/protocol/evaluate-proposal` | Evaluate plan / raise Question (Sonnet) |
| `POST /api/protocol/revise` | Revise plan in response to Question (Sonnet) |
| `POST /api/protocol/remember` | Distill lessons from task (Haiku) |
| `GET /api/health` | Health check |
| `GET /api/stats/resources` | Resource tracking stats |

See [docs/server-api.md](docs/server-api.md) for full request/response schemas.

## Tests

```bash
cd server && npm test
```

## Build for Production

```bash
npm run build
```

Output goes to `dist/`. Serve with any static file server; the API server still needs to run separately.

## Documentation

Detailed docs live in the `docs/` directory:

- [Overview](docs/overview.md) — architecture and tech stack
- [Getting Started](docs/getting-started.md) — setup and run instructions
- [Protocol Primitives](docs/protocol-primitives.md) — the 7 reasoning primitives and how they compose
- [Entities](docs/entities.md) — Entity, NPC, Player, BehaviorMachine, ProtocolAgent
- [Memory](docs/memory.md) — short-term buffer, long-term memory, knowledge graph, reflection
- [Conversations](docs/conversations.md) — NPC and player dialogue
- [Game World](docs/game-world.md) — map generation, rendering, pathfinding
- [Server API](docs/server-api.md) — endpoint reference

## License

[MIT](LICENSE)
