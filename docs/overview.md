# AgentWorld — Overview

An isometric Phaser 3 game where AI-driven NPCs act autonomously using a **three-loop architecture** powered by Claude LLMs.

## Tech Stack

| Layer | Tech |
|-------|------|
| Client | Phaser 3, TypeScript, Vite |
| Server | Express, TypeScript (tsx) |
| AI | Anthropic Claude (Haiku + Sonnet) |
| Embeddings | @xenova/transformers (all-MiniLM-L6-v2, local) |
| Tests | Vitest (72 tests) |

## Three-Loop Architecture

```
┌──────────────┐   every frame   ┌──────────────┐   every 15s   ┌──────────────┐
│  Fast Loop   │ ◄────────────── │ Medium Loop  │ ◄──────────── │  Slow Loop   │
│  (client)    │  execute plan   │  (Haiku)     │   escalate    │  (Sonnet)    │
│  move/wait   │                 │  pick skill  │               │  reason/talk │
└──────────────┘                 └──────────────┘               └──────────────┘
```

- **Fast loop** — runs every frame on the client; executes move/wait/speak actions from the current plan.
- **Medium loop** — fires every 15 s (staggered per NPC); calls Haiku to select the next skill.
- **Slow loop** — invoked on escalation (conversation or stuck recovery); calls Sonnet for dialogue or deep reasoning.

## Project Layout

```
agentWorld/
├── src/game/          # Phaser client (entities, scenes, AI client, UI)
├── server/src/        # Express API (AI loops, memory, skills)
├── public/            # Static assets & CSS
├── docs/              # You are here
└── vite/              # Vite configs (dev & prod)
```

See the other docs for details on each subsystem.
