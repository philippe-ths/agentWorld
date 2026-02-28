# Agent World

An isometric game where autonomous NPCs explore, make decisions, and hold conversations — all powered by an LLM. The player moves freely on a procedurally generated tile map while NPCs take turns reasoning about the world through Claude.

## Features

- **LLM-driven NPCs** — Each NPC sends a compact world state and memory to Claude, receives back commands, and executes them autonomously
- **Persistent memory** — NPCs maintain chronological logs of observations and actions, with automatic summarization of older entries
- **Conversations** — NPCs can talk to each other (speech bubbles) or to the player (interactive dialogue box). Conversations run outside the turn system and exchange meaningful information via LLM calls
- **Procedural map** — 30×30 isometric tile map with seeded terrain generation (grass + water ponds)
- **Turn system** — Sequential NPC turns with pause/resume control

## Tech Stack

- **Phaser 3** — game engine (isometric rendering, sprites, tweens)
- **TypeScript** — language
- **Vite** — bundler / dev server (with custom proxy plugins for the Anthropic API)
- **Anthropic Claude** — NPC decision-making and conversations

## Setup

```bash
npm install
```

Create a `.env` file in the project root:

```
ANTHROPIC_API_KEY=your-api-key-here
```

## Run

```bash
npm run dev      # http://localhost:8080
npm run build    # production build → dist/
```

The dev server must be restarted after changing `.env`.

## Controls

| Key | Action |
|-----|--------|
| Arrow keys / WASD | Move player one tile |
| Enter | Talk to an adjacent NPC (opens dialogue box) |
| P | Pause / resume NPC turn loop |
| Escape | Close dialogue box |

## How It Works

Each game tick, NPCs take sequential turns. On its turn, an NPC receives a text-based snapshot of the world (a character grid with entity positions) plus its memory log. Claude responds with commands like `move_to(x,y)`, `wait()`, or `start_conversation_with(Name, message)`. Commands execute with animated movement and speech bubbles.

The player is not part of the turn system and moves freely. Press **Enter** next to an NPC to open a dialogue box and chat directly — the NPC responds via Claude using its memory and world awareness.

## Documentation

Detailed docs are in the [`doc/`](doc/) folder:

| Doc | Contents |
|-----|----------|
| [Overview](doc/overview.md) | Project summary, setup, controls |
| [Architecture](doc/architecture.md) | File structure, system design, data flow |
| [Turn System](doc/turn-system.md) | NPC turn loop, commands, pause/resume |
| [LLM Integration](doc/llm-integration.md) | Prompts, API proxy, memory, debugging |
| [Conversations](doc/conversations.md) | NPC-NPC and Player-NPC conversation system |
