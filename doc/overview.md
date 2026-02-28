# Agent World

A Phaser 3 isometric game where NPCs are driven by an LLM (Anthropic Claude). The player moves freely on a 30×30 tile map while 3 NPCs take turns deciding what to do via Claude. NPCs maintain a chronological log of their observations and actions, giving them memory of past turns. NPCs can hold conversations with each other and with the player.

## Tech Stack

- **Phaser 3** — game engine
- **TypeScript** — language
- **Vite** — bundler / dev server
- **Anthropic Claude** (claude-sonnet-4-20250514) — NPC decision-making

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
| Escape | Close dialogue box |
| P | Pause / resume NPC turn loop |
