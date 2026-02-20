import { Scene } from 'phaser';

const BUBBLE_PAD = 8;
const BUBBLE_MAX_W = 160;
const BUBBLE_RADIUS = 6;
const BUBBLE_COLOR = 0xffffff;
const BUBBLE_ALPHA = 0.92;
const TEXT_COLOR = '#1a1a2e';
const FONT_SIZE = 12;
const SHOW_DURATION = 4000; // ms
const FADE_DURATION = 400;

export class SpeechBubble {
    private container: Phaser.GameObjects.Container;
    private bg: Phaser.GameObjects.Graphics;
    private text: Phaser.GameObjects.Text;
    private scene: Scene;
    private target: Phaser.GameObjects.Sprite;
    private queue: { text: string; duration: number }[] = [];
    private hideEvent?: Phaser.Time.TimerEvent;
    private showing = false;

    constructor(scene: Scene, target: Phaser.GameObjects.Sprite) {
        this.scene = scene;
        this.target = target;

        this.bg = scene.add.graphics();
        this.text = scene.add.text(0, 0, '', {
            fontSize: `${FONT_SIZE}px`,
            color: TEXT_COLOR,
            fontFamily: 'Arial, sans-serif',
            wordWrap: { width: BUBBLE_MAX_W - BUBBLE_PAD * 2 },
            align: 'center',
        });
        this.text.setOrigin(0.5, 0.5);

        this.container = scene.add.container(0, 0, [this.bg, this.text]);
        this.container.setVisible(false);
        this.container.setAlpha(1);
    }

    show(message: string, duration = SHOW_DURATION) {
        if (this.showing) {
            this.queue.push({ text: message, duration });
            return;
        }
        this.showing = true;
        this.render(message);
        this.container.setVisible(true);
        this.container.setAlpha(1);

        this.hideEvent = this.scene.time.delayedCall(duration, () => {
            this.fadeOut();
        });
    }

    private render(message: string) {
        this.text.setText(message);

        const tw = this.text.width;
        const th = this.text.height;
        const bw = Math.min(BUBBLE_MAX_W, tw + BUBBLE_PAD * 2);
        const bh = th + BUBBLE_PAD * 2;

        this.bg.clear();
        this.bg.fillStyle(BUBBLE_COLOR, BUBBLE_ALPHA);
        this.bg.lineStyle(1, 0x888888, 0.6);
        this.bg.fillRoundedRect(-bw / 2, -bh, bw, bh, BUBBLE_RADIUS);
        this.bg.strokeRoundedRect(-bw / 2, -bh, bw, bh, BUBBLE_RADIUS);

        // Small triangle pointer
        this.bg.fillStyle(BUBBLE_COLOR, BUBBLE_ALPHA);
        this.bg.fillTriangle(-4, 0, 4, 0, 0, 6);

        this.text.setPosition(0, -bh / 2);
    }

    private fadeOut() {
        this.scene.tweens.add({
            targets: this.container,
            alpha: 0,
            duration: FADE_DURATION,
            onComplete: () => {
                this.container.setVisible(false);
                this.showing = false;
                this.processQueue();
            },
        });
    }

    private processQueue() {
        if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            this.show(next.text, next.duration);
        }
    }

    updatePosition() {
        if (!this.container.visible) return;
        this.container.setPosition(
            this.target.x,
            this.target.y - this.target.height * this.target.originY - 8,
        );
        this.container.setDepth(this.target.depth + 0.5);
    }

    hide() {
        if (this.hideEvent) {
            this.hideEvent.destroy();
            this.hideEvent = undefined;
        }
        this.container.setVisible(false);
        this.container.setAlpha(1);
        this.showing = false;
        this.queue = [];
    }

    destroy() {
        this.hide();
        this.container.destroy();
    }
}
