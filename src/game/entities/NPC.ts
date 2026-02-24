import { Scene } from 'phaser';
import { Entity, TilePos } from './Entity';
import { MAP_WIDTH, MAP_HEIGHT } from '../MapData';

export class NPC extends Entity {
    constructor(
        scene: Scene,
        map: Phaser.Tilemaps.Tilemap,
        startTile: TilePos,
        checkWalkable: (x: number, y: number) => boolean,
        name: string,
        tint: number,
    ) {
        super(scene, map, 'player', startTile, checkWalkable, name);
        this.sprite.setTint(tint);
    }

    /** BFS pathfinding from current position to target. Returns the path (excluding start) or empty if unreachable. */
    private findPath(target: TilePos): TilePos[] {
        const start = this.tilePos;
        if (start.x === target.x && start.y === target.y) return [];

        const key = (x: number, y: number) => `${x},${y}`;
        const visited = new Set<string>();
        visited.add(key(start.x, start.y));

        const queue: { x: number; y: number; path: TilePos[] }[] = [
            { x: start.x, y: start.y, path: [] },
        ];

        const dirs = [
            { x: 1, y: 0 }, { x: -1, y: 0 },
            { x: 0, y: 1 }, { x: 0, y: -1 },
        ];

        while (queue.length > 0) {
            const curr = queue.shift()!;

            for (const d of dirs) {
                const nx = curr.x + d.x;
                const ny = curr.y + d.y;

                if (nx < 0 || nx >= MAP_WIDTH || ny < 0 || ny >= MAP_HEIGHT) continue;

                const k = key(nx, ny);
                if (visited.has(k)) continue;
                visited.add(k);

                const nextPath = [...curr.path, { x: nx, y: ny }];

                if (nx === target.x && ny === target.y) return nextPath;

                if (this.checkWalkable(nx, ny)) {
                    queue.push({ x: nx, y: ny, path: nextPath });
                }
            }
        }

        return []; // unreachable
    }

    /** Walk the full BFS path to a target tile, step by step. */
    async walkToAsync(target: TilePos): Promise<void> {
        const path = this.findPath(target);
        if (path.length === 0) {
            console.warn(`%c[${this.name}] No path to (${target.x},${target.y})`, 'color: #ffaa00');
            return;
        }

        for (const step of path) {
            const dx = step.x - this.tilePos.x;
            const dy = step.y - this.tilePos.y;
            const moved = await this.moveToAsync(dx, dy);
            if (!moved) {
                console.warn(`%c[${this.name}] Blocked at (${this.tilePos.x},${this.tilePos.y})`, 'color: #ffaa00');
                break;
            }
        }
    }

    update(_time: number, _delta: number) {
        // No-op: NPC actions are driven by TurnManager
    }
}
