# Entities

## Class Hierarchy

```
Entity  (base — sprite, tile position, movement tweens, name label, speech bubble)
  ├── Player  (keyboard-controlled via WASD / arrow keys)
  └── NPC     (AI-controlled via BehaviorMachine + ProtocolAgent)
```

## Entity (base)

- Owns a Phaser sprite, a **name label** (text above head), and an optional **speech bubble**.
- `moveTo(dx, dy)` — attempts a one-tile move; checks walkability, tweens the sprite, updates depth.
- `say(text, duration?)` — shows a speech bubble for `duration` ms (default 3 s).

## NPC

- Has a `BehaviorMachine` — a state machine that executes structured actions (travel, pursue, flee, wait, speak, sequences).
- Has an optional `ProtocolAgent` — handles incoming protocol messages, manages owned sub-tasks, and routes tasks through the protocol system.
- `recentEvents: string[]` — rolling buffer (max 20) for context.
- `isInConversation` — when true, AI behaviour is paused.
- `setPlan(actions)` — wraps actions as a sequence for the BehaviorMachine.
- `pauseAI() / resumeAI() / restartAI(tile)` — control methods used by the UI control bar.

### BehaviorMachine

State machine that executes structured `Action` types:

| Action | Behaviour |
|--------|-----------|
| `move` | Move one tile toward target |
| `wait` | Count down duration ms |
| `speak` | Show speech bubble |
| `travel_to` | A* pathfind to destination, re-path on obstacles |
| `pursue` | Follow a moving entity until adjacent, with timeout |
| `flee_from` | Move away from threat until safe distance |
| `wait_until` | Wait for a `Condition` to become true, with timeout |
| `say_to` | Pursue target then speak |
| `converse_with` | Pursue target to initiate conversation |
| `sequence` | Execute a list of actions in order |

Callbacks: `onBecomeIdle` (triggers next sub-task), `onActionComplete` (checks completion criteria).

### ProtocolAgent

Per-NPC handler for the protocol system:

- Listens for protocol messages via `ProtocolRouter.onMessage()`
- Auto-accepts sub-tasks assigned to this NPC
- Executes sub-task actions through BehaviorMachine
- Reports completion/failure via protocol messages
- `receiveTask(description, from)` — entry point for new work (from player or other NPC)
- `checkCompletions()` — evaluates mechanical completion criteria on owned sub-tasks

## WorldQuery

Provides world-state queries for the mechanical tier:

- `getEntityPosition(name)` — tile position lookup
- `getDistance(a, b)` — tile distance between entities
- `isEntityAdjacent(a, b)` — within 1 tile
- `getEntitiesInRadius(name, radius)` — nearby entities
- `buildWorldSummaryFor(npcName)` — assembles a text summary for LLM briefings

## EntityManager

- Registry of all entities. Provides `getAll()`, `getEntitiesNear(x, y, radius)`, and `isWalkable(x, y)`.
- `isWalkable` also blocks tiles occupied by other entities.
