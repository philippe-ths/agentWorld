import { Scene } from 'phaser';
import { Entity } from '../entities/Entity';

const BUBBLE_PAD_X = 10;
const BUBBLE_PAD_Y = 6;
const BUBBLE_MAX_WIDTH = 200;
const ARROW_SIZE = 6;

export class SpeechBubble {
    private container: Phaser.GameObjects.Container;
    private bg: Phaser.GameObjects.Graphics;
    private text: Phaser.GameObjects.Text;
    private entity: Entity;

    constructor(scene: Scene, entity: Entity, message: string) {
        this.entity = entity;

        this.text = scene.add.text(0, 0, message, {
            fontSize: '11px',
            color: '#000000',
            fontFamily: 'Arial, sans-serif',
            wordWrap: { width: BUBBLE_MAX_WIDTH - BUBBLE_PAD_X * 2 },
            lineSpacing: 2,
        });
        this.text.setOrigin(0.5, 1);

        const textWidth = this.text.width;
        const textHeight = this.text.height;
        const boxW = textWidth + BUBBLE_PAD_X * 2;
        const boxH = textHeight + BUBBLE_PAD_Y * 2;

        this.bg = scene.add.graphics();
        this.bg.fillStyle(0xffffff, 0.95);
        this.bg.lineStyle(1, 0x333333, 0.8);
        this.bg.fillRoundedRect(-boxW / 2, -boxH, boxW, boxH, 6);
        this.bg.strokeRoundedRect(-boxW / 2, -boxH, boxW, boxH, 6);

        // Arrow pointing down
        this.bg.fillStyle(0xffffff, 0.95);
        this.bg.fillTriangle(
            -ARROW_SIZE, 0,
            ARROW_SIZE, 0,
            0, ARROW_SIZE,
        );

        this.text.setPosition(0, -BUBBLE_PAD_Y);

        this.container = scene.add.container(0, 0, [this.bg, this.text]);
        this.container.setDepth(2000);
        this.updatePosition();
    }

    updatePosition(): void {
        const spriteX = this.entity.sprite.x;
        const spriteY = this.entity.sprite.y - this.entity.sprite.height * this.entity.sprite.originY - 20;
        this.container.setPosition(spriteX, spriteY);
    }

    destroy(): void {
        this.container.destroy();
    }
}

export function showSpeechBubble(
    scene: Scene,
    entity: Entity,
    message: string,
    duration: number,
): Promise<void> {
    return new Promise(resolve => {
        const bubble = new SpeechBubble(scene, entity, message);

        // Update position each frame while bubble is alive
        const updateHandler = () => bubble.updatePosition();
        scene.events.on('update', updateHandler);

        scene.time.delayedCall(duration, () => {
            scene.events.off('update', updateHandler);
            bubble.destroy();
            resolve();
        });
    });
}
