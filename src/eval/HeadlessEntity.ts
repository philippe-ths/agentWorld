import type { TilePos } from '../game/types';
import { findPath } from '../game/Pathfinder';

export interface WalkResult {
    reached: boolean;
    reason?: 'no_path' | 'repath_limit';
}

const MAX_REPATH_ATTEMPTS = 5;

/**
 * Headless entity — tracks position on the grid without Phaser sprites.
 * Compatible with WorldEntity interface used by buildWorldState().
 */
export class HeadlessEntity {
    readonly name: string;
    tilePos: TilePos;
    isMoving = false;
    sleeping = false;

    constructor(name: string, startTile: TilePos) {
        this.name = name;
        this.tilePos = { ...startTile };
    }

    isAdjacentTo(other: HeadlessEntity): boolean {
        const dx = Math.abs(this.tilePos.x - other.tilePos.x);
        const dy = Math.abs(this.tilePos.y - other.tilePos.y);
        return (dx + dy) === 1;
    }
}

/**
 * Headless NPC — adds pathfinding-based movement without Phaser animations.
 */
export class HeadlessNPC extends HeadlessEntity {
    private checkWalkable: (x: number, y: number) => boolean;
    private checkTerrainWalkable: (x: number, y: number) => boolean;

    constructor(
        name: string,
        startTile: TilePos,
        checkWalkable: (x: number, y: number) => boolean,
        checkTerrainWalkable: (x: number, y: number) => boolean,
    ) {
        super(name, startTile);
        this.checkWalkable = checkWalkable;
        this.checkTerrainWalkable = checkTerrainWalkable;
    }

    /** Walk the full path to a target tile using A* pathfinding. Instant (no animation). */
    async walkToAsync(target: TilePos): Promise<WalkResult> {
        let repathCount = 0;

        while (this.tilePos.x !== target.x || this.tilePos.y !== target.y) {
            const isRepath = repathCount > 0;
            const walkable = isRepath
                ? (x: number, y: number) => {
                    if (x === this.tilePos.x && y === this.tilePos.y) return true;
                    if (x === target.x && y === target.y) return this.checkTerrainWalkable(x, y);
                    return this.checkWalkable(x, y);
                }
                : this.checkTerrainWalkable;

            const path = findPath(this.tilePos, target, walkable);

            if (!path || path.length === 0) {
                return { reached: false, reason: 'no_path' };
            }

            let blocked = false;
            for (const step of path) {
                if (this.tilePos.x === target.x && this.tilePos.y === target.y) {
                    return { reached: true };
                }

                const nx = step.x;
                const ny = step.y;

                if (!this.checkWalkable(nx, ny)) {
                    repathCount++;
                    if (repathCount > MAX_REPATH_ATTEMPTS) {
                        return { reached: false, reason: 'repath_limit' };
                    }
                    blocked = true;
                    break;
                }

                this.tilePos = { x: nx, y: ny };
                repathCount = 0;
            }

            if (!blocked) break;
        }

        return { reached: true };
    }
}
