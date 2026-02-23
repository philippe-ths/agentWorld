# Getting Started

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

## Tests

```bash
cd server && npm test
```

Runs 74 tests across 6 suites with Vitest.

## Build for Production

```bash
npm run build
```

Output goes to `dist/`. Serve with any static file server; the API server still needs to run separately.
