import { Scene } from 'phaser';
import { Entity, TilePos } from './Entity';
import { findPath } from '../Pathfinder';

const MAX_REPATH_ATTEMPTS = 3;

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
            const path = findPath(this.tilePos, target, this.checkTerrainWalkable);

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
                }
            }
        }
    }

    update(_time: number, _delta: number) {
        // No-op: NPC actions are driven by TurnManager
    }
}
