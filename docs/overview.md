# AgentWorld — Overview

An isometric Phaser 3 game where AI-driven NPCs collaborate autonomously using a **protocol-based collective reasoning** system powered by Claude LLMs.

## Tech Stack

| Layer | Tech |
|-------|------|
| Client | Phaser 3, TypeScript, Vite |
| Server | Express, TypeScript (tsx) |
| AI | Anthropic Claude (Haiku + Sonnet) |
| Embeddings | @xenova/transformers (all-MiniLM-L6-v2, local) |
| Tests | Vitest |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Phaser 3)                        │
│                                                                 │
│  ┌─────────────┐   ┌─────────────────┐   ┌──────────────────┐  │
│  │ WorldQuery   │   │ BehaviorMachine │   │ ProtocolRouter   │  │
│  │ Capabilities │   │ ConditionChecker│   │ ProtocolAgent    │  │
│  └─────────────┘   └─────────────────┘   └──────────────────┘  │
│        ▲ world state      ▲ actions            ▲ messages       │
│        │                  │                    │                 │
│  ┌─────┴──────────────────┴────────────────────┴──────────────┐ │
│  │                     NPC / Entity                           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                            │ HTTP                               │
└────────────────────────────┼────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Server (Express)                           │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────────┐   │
│  │ ApiQueue     │   │ Prompt       │   │ Memory            │   │
│  │ (rate limit) │   │ Templates    │   │ (STB, LTM, KG,    │   │
│  └──────┬───────┘   └──────────────┘   │  Reflection,      │   │
│         │                              │  Embeddings)       │   │
│         ▼                              └───────────────────┘   │
│  ┌──────────────┐                                               │
│  │ Claude API   │                                               │
│  │ Sonnet/Haiku │                                               │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Intelligence Tiers

Every operation runs at the cheapest tier capable of handling it:

| Tier | Model | Purpose | Cost |
|------|-------|---------|------|
| **Strategic** | Sonnet | Ambiguity, novelty, judgment — decomposing problems, debating plans, revising on failure | High |
| **Tactical** | Haiku | Well-scoped tasks — dialogue, simple decisions, summarisation | Low |
| **Mechanical** | None (code) | Deterministic — movement, pathfinding, condition checks, timer management | Free |

Each tier's job is to reduce complexity so the tier below it can operate.

## Protocol System

NPCs coordinate using 7 protocol primitives (see [protocol-primitives.md](protocol-primitives.md)):

**Propose** → **Accept** → **Attempt** → **Report** (with **Question**, **Revise**, and **Remember** as needed)

- No central coordinator — leadership is emergent
- Any NPC can propose, question, or revise at any time
- Tasks are decomposed with mechanical completion criteria where possible
- Context is curated per-invocation, not accumulated

## Project Layout

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

See the other docs for details on each subsystem.
