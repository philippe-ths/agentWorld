# Game World

## Map Generation

The map is a **64 × 64** isometric tile grid generated procedurally with a seeded PRNG (`mulberry32`, seed 42).

- Two tile types: `TILE_GRASS` (0, walkable) and `TILE_WATER` (1, non-walkable).
- 10–15 water ponds are placed with randomised radii (2–5 tiles) and organic edges.
- A 5 × 5 grass clearing is guaranteed around each spawn point.

Spawn points:

| Entity | Tile |
|--------|------|
| Player | (5, 5) |
| Ada | (15, 10) |
| Bjorn | (25, 20) |
| Cora | (10, 25) |

## Rendering

- Phaser isometric tilemap (`ISOMETRIC` orientation, 64 × 32 px tiles).
- Two tile images: `grass` and `water`, drawn from a single sprite-sheet.
- Camera follows the player with lerp-based smoothing.
- Entities are depth-sorted by tile Y so sprites overlap correctly.

## Pathfinding

Client-side **A\*** (`src/game/ai/Pathfinding.ts`) with Manhattan heuristic. Used by `wander`, `move_to`, and `approach_entity` skills to convert a target tile into a sequence of `move` actions.
