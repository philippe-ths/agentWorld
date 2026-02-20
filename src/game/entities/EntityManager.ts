import { Entity } from './Entity';
import { MAP_DATA, MAP_WIDTH, MAP_HEIGHT, TILE_WATER } from '../MapData';

export class EntityManager {
    private entities: Entity[] = [];

    add(entity: Entity) {
        this.entities.push(entity);
    }

    remove(entity: Entity) {
        const idx = this.entities.indexOf(entity);
        if (idx >= 0) this.entities.splice(idx, 1);
    }

    getAll(): Entity[] {
        return this.entities;
    }

    updateAll(time: number, delta: number) {
        for (const entity of this.entities) {
            entity.update(time, delta);
            entity.updateBubble();
        }
    }

    getEntitiesNear(tileX: number, tileY: number, radius: number): Entity[] {
        return this.entities.filter(e => {
            const dx = e.tilePos.x - tileX;
            const dy = e.tilePos.y - tileY;
            return Math.sqrt(dx * dx + dy * dy) <= radius;
        });
    }

    isTileOccupied(x: number, y: number): boolean {
        return this.entities.some(e => e.tilePos.x === x && e.tilePos.y === y);
    }

    isWalkable = (x: number, y: number): boolean => {
        if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return false;
        if (MAP_DATA[y][x] === TILE_WATER) return false;
        if (this.isTileOccupied(x, y)) return false;
        return true;
    };
}
