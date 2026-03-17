import { MAP_DATA, MAP_WIDTH, MAP_HEIGHT, TILE_WATER, isBuildingAt } from '../game/MapData';
import { ToolRegistry } from '../game/ToolRegistry';
import { HeadlessEntity } from './HeadlessEntity';

/**
 * Headless entity manager — walkability checks using MAP_DATA directly.
 * No Phaser tilemap dependency.
 */
export class HeadlessEntityManager {
    private entities: HeadlessEntity[] = [];
    private toolRegistry: ToolRegistry | null = null;

    setToolRegistry(registry: ToolRegistry): void {
        this.toolRegistry = registry;
    }

    add(entity: HeadlessEntity): void {
        this.entities.push(entity);
    }

    getEntities(): HeadlessEntity[] {
        return this.entities;
    }

    getByName(name: string): HeadlessEntity | undefined {
        return this.entities.find(e => e.name === name);
    }

    isTileOccupied(x: number, y: number): boolean {
        return this.entities.some(e => e.tilePos.x === x && e.tilePos.y === y);
    }

    isWalkable = (x: number, y: number): boolean => {
        if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return false;
        if (MAP_DATA[y][x] === TILE_WATER) return false;
        if (this.toolRegistry && isBuildingAt(this.toolRegistry.getAll(), x, y)) return false;
        if (this.isTileOccupied(x, y)) return false;
        return true;
    };

    isTerrainWalkable = (x: number, y: number): boolean => {
        if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return false;
        if (MAP_DATA[y][x] === TILE_WATER) return false;
        if (this.toolRegistry && isBuildingAt(this.toolRegistry.getAll(), x, y)) return false;
        return true;
    };
}
