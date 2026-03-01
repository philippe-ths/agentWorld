import { Scene } from 'phaser';
import { Entity, TilePos } from './Entity';
import { findPath } from '../Pathfinder';

const MAX_REPATH_ATTEMPTS = 5;

export class NPC extends Entity {
    private checkTerrainWalkable: (x: number, y: number) => boolean;

    /** Set by TurnManager to enable mid-walk pause for player conversations. */
    conversationPauseGate: (() => Promise<void>) | null = null;

    constructor(
        scene: Scene,
        map: Phaser.Tilemaps.Tilemap,
        startTile: TilePos,
        checkWalkable: (x: number, y: number) => boolean,
        checkTerrainWalkable: (x: number, y: number) => boolean,
        name: string,
        tint: number,
    ) {
        super(scene, map, 'player', startTile, checkWalkable, name);
        this.checkTerrainWalkable = checkTerrainWalkable;
        this.sprite.setTint(tint);
    }

    /** Walk the full path to a target tile using A* pathfinding. Re-paths if blocked by an entity. */
    async walkToAsync(target: TilePos): Promise<void> {
        let repathCount = 0;

        while (this.tilePos.x !== target.x || this.tilePos.y !== target.y) {
            // First attempt: terrain-only (optimistic — entities may move).
            // Re-paths: entity-aware so the NPC routes around the blocker.
            const isRepath = repathCount > 0;
            const walkable = isRepath
                ? (x: number, y: number) => {
                    // Own tile must pass (we're standing on it)
                    if (x === this.tilePos.x && y === this.tilePos.y) return true;
                    // Goal tile: terrain-only (entity there may move before we arrive)
                    if (x === target.x && y === target.y) return this.checkTerrainWalkable(x, y);
                    // Everything else: full entity-aware check
                    return this.checkWalkable(x, y);
                }
                : this.checkTerrainWalkable;

            const path = findPath(this.tilePos, target, walkable);

            if (!path || path.length === 0) {
                console.warn(`%c[${this.name}] No path to (${target.x}, ${target.y})`, 'color: #ffaa00');
                return;
            }

            for (const step of path) {
                if (this.tilePos.x === target.x && this.tilePos.y === target.y) return;

                // Check for conversation pause between steps
                if (this.conversationPauseGate) await this.conversationPauseGate();

                const dx = step.x - this.tilePos.x;
                const dy = step.y - this.tilePos.y;
                const moved = await this.moveToAsync(dx, dy);

                if (!moved) {
                    // Blocked by an entity — re-path from current position
                    repathCount++;
                    if (repathCount > MAX_REPATH_ATTEMPTS) {
                        console.warn(`%c[${this.name}] Re-path limit reached heading to (${target.x}, ${target.y})`, 'color: #ffaa00');
                        return;
                    }
                    break;
                } else {
                    repathCount = 0;
                }
            }
        }
    }

    update(_time: number, _delta: number) {
        // No-op: NPC actions are driven by TurnManager
    }
}
