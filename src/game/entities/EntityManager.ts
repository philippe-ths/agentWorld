import { Entity } from './Entity';
import { MAP_DATA, MAP_WIDTH, MAP_HEIGHT, TILE_WATER } from '../MapData';

export class EntityManager {
    private entities: Entity[] = [];

    add(entity: Entity) {
        this.entities.push(entity);
    }

    updateAll(time: number, delta: number) {
        for (const entity of this.entities) {
            entity.update(time, delta);
            entity.updateLabel();
        }
    }

    isTileOccupied(x: number, y: number): boolean {
        return this.entities.some(e => e.tilePos.x === x && e.tilePos.y === y);
    }

    getEntities(): Entity[] {
        return this.entities;
    }

    isWalkable = (x: number, y: number): boolean => {
        if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return false;
        if (MAP_DATA[y][x] === TILE_WATER) return false;
        if (this.isTileOccupied(x, y)) return false;
        return true;
    };

    isTerrainWalkable = (x: number, y: number): boolean => {
        if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return false;
        if (MAP_DATA[y][x] === TILE_WATER) return false;
        return true;
    };
}
