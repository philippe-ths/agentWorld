# Agent World

A Phaser 3 isometric game where NPCs are driven by an LLM (Anthropic Claude). The player moves freely on a 30x30 tile map while 3 NPCs take turns deciding what to do via Claude. NPCs maintain chronological logs giving them persistent memory, converse with each other and the player, extract goals from conversations, use tool buildings (web search, code forge), and can create new executable function buildings at runtime.

## Tech Stack

- **Phaser 3** — game engine
- **TypeScript** — language
- **Vite** — bundler / dev server
- **Anthropic Claude** — NPC decision-making, conversations, memory summarization, goal extraction, code generation

## Setup

```bash
npm install
```

Create a `.env` file in the project root:

```
ANTHROPIC_API_KEY=your-api-key-here
TAVILY_API_KEY=your-tavily-key-here
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
| Enter | Start conversation with adjacent NPC |
| P | Pause / resume NPC turn loop |
