import { Scene } from 'phaser';
import { TILE_W, TILE_H, MOVE_TWEEN_DURATION, FONT } from '../GameConfig';

export { TILE_W, TILE_H };

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

        this.nameLabel = this.scene.add.text(0, 0, this.name,
            FONT.label as Phaser.Types.GameObjects.Text.TextStyle,
        );
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

        // Fire-and-forget: start the async move but don't await it
        this.moveToAsync(dx, dy);
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
                duration: MOVE_TWEEN_DURATION,
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
