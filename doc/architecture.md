# Architecture

## File Structure

```
src/
  main.ts                  Entry point — creates the Phaser game
  game/
    main.ts                Game config & StartGame()
    MapData.ts             Procedural 64x64 map (seeded PRNG, grass + water ponds)
    entities/
      Entity.ts            Abstract base — sprite, tile movement, name label, depth sort
      Player.ts            Keyboard-controlled entity (arrows / WASD)
      NPC.ts               Random-wander entity (tinted sprite)
      EntityManager.ts     Holds all entities, runs updates, walkability check
    scenes/
      Preloader.ts         Loads sprite sheet, generates tile textures, then starts GameScene
      GameScene.ts         Builds tilemap, spawns player + 3 NPCs, sets up camera
```

## Scene Flow

```
Preloader → GameScene
```

Preloader loads the `player.png` sprite sheet and generates isometric diamond textures for grass/water tiles at runtime. Then it starts GameScene.

## Entities

`Entity` is the abstract base class. It creates a sprite at a tile position, handles animated tile-to-tile movement via tweens, and displays a name label.

- **Player** — reads keyboard input each frame, calls `moveTo()` on key press.
- **NPC** — picks a random nearby tile every 2-6 seconds and walks toward it step by step. Gives up if blocked.

`EntityManager` stores all entities, runs their `update()` each frame, and provides the `isWalkable()` check (bounds + water + occupied tiles).

## Map

Generated once at import time by `MapData.ts`. Uses a seeded PRNG (mulberry32, seed 42) to place 10-15 organic water ponds on a grass field. Spawn areas for the player and all NPCs are guaranteed clear.
