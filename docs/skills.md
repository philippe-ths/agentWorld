# Skill System

## Built-in Skills

| Skill | Description | Precondition |
|-------|-------------|--------------|
| `wander` | Random nearby walkable tile | not in conversation |
| `move_to` | Move to specific (x, y) | not in conversation |
| `approach_entity` | Walk toward named entity | not in conversation, entity nearby |
| `converse` | Start conversation (escalates to slow loop) | entity within 3 tiles |
| `idle` | Wait in place | always |
| `end_conversation` | End active conversation | in conversation |

## Skill Executor (client)

`SkillExecutor.executeSkill()` translates a skill name + params into an `Action[]` plan:

- `wander` — picks a random tile within 10 tiles, runs A* pathfinding.
- `move_to` — A* path to `(targetX, targetY)`.
- `approach_entity` — finds the target entity, paths to an adjacent tile.
- `idle` — single `wait` action.

## Composed Skills (learned at runtime)

The slow loop can propose a `new_skill` with `steps: string[]` — an ordered list of existing skill names.

- Registered on the server via `SkillLibrary.addSkill()` and persisted to `data/learned_skills.json`.
- Registered on the client via `SkillExecutor.registerComposedSkill()`.
- Execution recursively expands steps into actions.

## Outcome Tracking

Every plan completion reports `POST /api/npc/skill-outcome` with `{ skill, success }`. The server tracks per-skill success/failure counts to inform future decisions.
