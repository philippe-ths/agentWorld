import { Scene } from 'phaser';
import { Entity, TilePos } from './Entity';

export class NPC extends Entity {
    private moveTarget: TilePos | null = null;
    private waitTimer = 0;
    private nextMoveDelay = 0;

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
        this.nextMoveDelay = 1000 + Math.random() * 3000;
    }

    update(_time: number, delta: number) {
        if (this.moveTarget) {
            if (this.isMoving) return;
            this.stepToward(this.moveTarget);
            return;
        }

        // Waiting between wanders
        this.waitTimer += delta;
        if (this.waitTimer < this.nextMoveDelay) return;
        this.waitTimer = 0;
        this.nextMoveDelay = 2000 + Math.random() * 4000;

        // Pick a random nearby tile to walk to
        const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        const dist = 1 + Math.floor(Math.random() * 3);
        this.moveTarget = {
            x: this.tilePos.x + dir.x * dist,
            y: this.tilePos.y + dir.y * dist,
        };
    }

    private stepToward(target: TilePos) {
        const dx = Math.sign(target.x - this.tilePos.x);
        const dy = Math.sign(target.y - this.tilePos.y);

        if (dx === 0 && dy === 0) {
            this.moveTarget = null;
            return;
        }

        let moved = false;
        if (Math.abs(target.x - this.tilePos.x) >= Math.abs(target.y - this.tilePos.y)) {
            if (dx !== 0) moved = this.moveTo(dx, 0);
            if (!moved && dy !== 0) moved = this.moveTo(0, dy);
        } else {
            if (dy !== 0) moved = this.moveTo(0, dy);
            if (!moved && dx !== 0) moved = this.moveTo(dx, 0);
        }

        if (this.tilePos.x === target.x && this.tilePos.y === target.y) {
            this.moveTarget = null;
        } else if (!moved) {
            this.moveTarget = null; // stuck, give up
        }
    }
}
