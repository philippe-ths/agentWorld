import { Scene } from 'phaser';

export class Preloader extends Scene {
    constructor() {
        super('Preloader');
    }

    preload() {
        this.load.spritesheet('player', 'assets/sprites/player.png', {
            frameWidth: 32,
            frameHeight: 32,
        });
    }

    create() {
        this.generateTileTextures();
        this.scene.start('GameScene');
    }

    private generateTileTextures() {
        const tileW = 64;
        const tileH = 32;

        const colors: Record<string, { fill: number; stroke: number }> = {
            'tile-grass': { fill: 0x4caf50, stroke: 0x388e3c },
            'tile-water': { fill: 0x2196f3, stroke: 0x1565c0 },
        };

        for (const [key, { fill, stroke }] of Object.entries(colors)) {
            const gfx = this.add.graphics();

            // Top face (diamond)
            gfx.fillStyle(fill);
            gfx.lineStyle(1, stroke);
            gfx.beginPath();
            gfx.moveTo(tileW / 2, 0);
            gfx.lineTo(tileW, tileH / 2);
            gfx.lineTo(tileW / 2, tileH);
            gfx.lineTo(0, tileH / 2);
            gfx.closePath();
            gfx.fillPath();
            gfx.strokePath();

            gfx.generateTexture(key, tileW, tileH);
            gfx.destroy();
        }
    }
}
