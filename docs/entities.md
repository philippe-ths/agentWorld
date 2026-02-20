# Entities

## Class Hierarchy

```
Entity  (base — sprite, tile position, movement tweens, name label, speech bubble)
  ├── Player  (keyboard-controlled via WASD / arrow keys)
  └── NPC     (AI-controlled via AgentLoop, has plan queue + event log)
```

## Entity (base)

- Owns a Phaser sprite, a **name label** (text above head), and an optional **speech bubble**.
- `moveTo(dx, dy)` — attempts a one-tile move; checks walkability, tweens the sprite, updates depth.
- `say(text, duration?)` — shows a speech bubble for `duration` ms (default 3 s).

## NPC

- Has an `AgentLoop` that ticks every 15 s to pick the next skill.
- Maintains `currentPlan: Action[]` — a queue of `move | wait | speak` actions executed in the fast loop.
- `recentEvents: string[]` — rolling buffer (max 20) sent to the LLM as context.
- `isInConversation` — when true, the medium loop is paused.
- `pauseAI() / resumeAI() / restartAI(tile)` — control methods used by the UI control bar.

## EntityManager

- Registry of all entities. Provides `getAll()`, `getEntitiesNear(x, y, radius)`, and `isWalkable(x, y)`.
- `isWalkable` also blocks tiles occupied by other entities.
