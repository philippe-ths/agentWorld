import { Scene } from 'phaser';
import { Entity, TilePos } from './Entity';

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

    /** Take one step toward a target tile. Returns a promise that resolves when the animation finishes. */
    async stepTowardAsync(target: TilePos): Promise<boolean> {
        const dx = Math.sign(target.x - this.tilePos.x);
        const dy = Math.sign(target.y - this.tilePos.y);

        if (dx === 0 && dy === 0) return false;

        // Prefer the axis with the greater distance
        if (Math.abs(target.x - this.tilePos.x) >= Math.abs(target.y - this.tilePos.y)) {
            if (dx !== 0 && await this.moveToAsync(dx, 0)) return true;
            if (dy !== 0 && await this.moveToAsync(0, dy)) return true;
        } else {
            if (dy !== 0 && await this.moveToAsync(0, dy)) return true;
            if (dx !== 0 && await this.moveToAsync(dx, 0)) return true;
        }

        return false; // blocked
    }

    update(_time: number, _delta: number) {
        // No-op: NPC actions are driven by TurnManager
    }
}
