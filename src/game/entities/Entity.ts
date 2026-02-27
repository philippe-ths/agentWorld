import { Scene } from 'phaser';

export const TILE_W = 64;
export const TILE_H = 32;

export interface TilePos {
    x: number;
    y: number;
}

export abstract class Entity {
    sprite!: Phaser.GameObjects.Sprite;
    tilePos: TilePos;
    isMoving = false;
    lastDirection = 'down';
    readonly name: string;
    protected scene: Scene;
    protected map: Phaser.Tilemaps.Tilemap;
    protected checkWalkable: (x: number, y: number) => boolean;
    private nameLabel!: Phaser.GameObjects.Text;

    constructor(
        scene: Scene,
        map: Phaser.Tilemaps.Tilemap,
        spriteKey: string,
        startTile: TilePos,
        checkWalkable: (x: number, y: number) => boolean,
        name: string,
    ) {
        this.scene = scene;
        this.map = map;
        this.tilePos = { ...startTile };
        this.checkWalkable = checkWalkable;
        this.name = name;
        this.createSprite(spriteKey);
    }

    private createSprite(spriteKey: string) {
        const worldPos = this.map.tileToWorldXY(this.tilePos.x, this.tilePos.y)!;
        this.sprite = this.scene.add.sprite(
            worldPos.x + TILE_W / 2,
            worldPos.y + TILE_H / 2,
            spriteKey,
            0,
        );
        this.sprite.setOrigin(0.5, 0.8);
        this.sprite.play('idle-down');
        this.updateDepth();

        this.nameLabel = this.scene.add.text(0, 0, this.name, {
            fontSize: '11px',
            color: '#ffffff',
            fontFamily: 'Arial, sans-serif',
            stroke: '#000000',
            strokeThickness: 3,
        });
        this.nameLabel.setOrigin(0.5, 1);
    }

    updateDepth() {
        this.sprite.setDepth(this.tilePos.x + this.tilePos.y + 1);
    }

    moveTo(dx: number, dy: number): boolean {
        if (this.isMoving) return false;
        if (dx === 0 && dy === 0) return false;

        const targetX = this.tilePos.x + dx;
        const targetY = this.tilePos.y + dy;

        if (!this.checkWalkable(targetX, targetY)) return false;

        let direction: string;
        if (dy < 0) direction = 'up';
        else if (dy > 0) direction = 'down';
        else if (dx < 0) direction = 'left';
        else direction = 'right';

        this.tilePos.x = targetX;
        this.tilePos.y = targetY;
        this.lastDirection = direction;
        this.updateDepth();

        this.sprite.play('walk-' + direction, true);

        const worldPos = this.map.tileToWorldXY(targetX, targetY)!;
        this.isMoving = true;

        this.scene.tweens.add({
            targets: this.sprite,
            x: worldPos.x + TILE_W / 2,
            y: worldPos.y + TILE_H / 2,
            duration: 180,
            ease: 'Power2',
            onComplete: () => {
                this.isMoving = false;
                this.sprite.play('idle-' + this.lastDirection, true);
            },
        });

        return true;
    }

    updateLabel() {
        this.nameLabel.setPosition(
            this.sprite.x,
            this.sprite.y - this.sprite.height * this.sprite.originY - 2,
        );
        this.nameLabel.setDepth(this.sprite.depth + 0.5);
    }

    /** Returns a promise that resolves when the move tween finishes. */
    moveToAsync(dx: number, dy: number): Promise<boolean> {
        return new Promise(resolve => {
            if (this.isMoving || (dx === 0 && dy === 0)) { resolve(false); return; }

            const targetX = this.tilePos.x + dx;
            const targetY = this.tilePos.y + dy;
            if (!this.checkWalkable(targetX, targetY)) { resolve(false); return; }

            let direction: string;
            if (dy < 0) direction = 'up';
            else if (dy > 0) direction = 'down';
            else if (dx < 0) direction = 'left';
            else direction = 'right';

            this.tilePos.x = targetX;
            this.tilePos.y = targetY;
            this.lastDirection = direction;
            this.updateDepth();
            this.sprite.play('walk-' + direction, true);

            const worldPos = this.map.tileToWorldXY(targetX, targetY)!;
            this.isMoving = true;

            this.scene.tweens.add({
                targets: this.sprite,
                x: worldPos.x + TILE_W / 2,
                y: worldPos.y + TILE_H / 2,
                duration: 180,
                ease: 'Power2',
                onComplete: () => {
                    this.isMoving = false;
                    this.sprite.play('idle-' + this.lastDirection, true);
                    resolve(true);
                },
            });
        });
    }

    isAdjacentTo(other: Entity): boolean {
        const dx = Math.abs(this.tilePos.x - other.tilePos.x);
        const dy = Math.abs(this.tilePos.y - other.tilePos.y);
        return (dx + dy) === 1;
    }

    abstract update(time: number, delta: number): void;

    destroy() {
        this.nameLabel.destroy();
        this.sprite.destroy();
    }
}
