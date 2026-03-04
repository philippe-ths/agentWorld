import { Scene } from 'phaser';
import { TILE_W, TILE_H, COLORS } from '../GameConfig';

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
        const tileW = TILE_W;
        const tileH = TILE_H;

        const colors: Record<string, { fill: number; stroke: number }> = {
            'tile-grass': { fill: COLORS.tileGrass, stroke: COLORS.tileGrassEdge },
            'tile-water': { fill: COLORS.tileWater, stroke: COLORS.tileWaterEdge },
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

        this.generateBuildingTexture(tileW, tileH);
    }

    private generateBuildingTexture(tileW: number, tileH: number) {
        const wallH = 24;
        const texH = tileH + wallH;
        const gfx = this.add.graphics();
        const outline = COLORS.buildingOutline;

        // Roof diamond vertices
        const roofTop    = { x: tileW / 2, y: 0 };          // (32, 0)
        const roofRight  = { x: tileW,     y: tileH / 2 };  // (64, 16)
        const roofBottom = { x: tileW / 2, y: tileH };      // (32, 32)
        const roofLeft   = { x: 0,         y: tileH / 2 };  // (0, 16)

        // Right wall (medium shade) — drops from roof-bottom/roof-right edge
        gfx.fillStyle(COLORS.buildingWallLight);
        gfx.lineStyle(1, outline);
        gfx.beginPath();
        gfx.moveTo(roofBottom.x, roofBottom.y);
        gfx.lineTo(roofRight.x, roofRight.y);
        gfx.lineTo(roofRight.x, roofRight.y + wallH);
        gfx.lineTo(roofBottom.x, roofBottom.y + wallH);
        gfx.closePath();
        gfx.fillPath();
        gfx.strokePath();

        // Left wall (darker shade) — drops from roof-left/roof-bottom edge
        gfx.fillStyle(COLORS.buildingWallDark);
        gfx.lineStyle(1, outline);
        gfx.beginPath();
        gfx.moveTo(roofLeft.x, roofLeft.y);
        gfx.lineTo(roofBottom.x, roofBottom.y);
        gfx.lineTo(roofBottom.x, roofBottom.y + wallH);
        gfx.lineTo(roofLeft.x, roofLeft.y + wallH);
        gfx.closePath();
        gfx.fillPath();
        gfx.strokePath();

        // Door on left wall
        gfx.fillStyle(COLORS.buildingOutline);
        gfx.beginPath();
        gfx.moveTo(10, 28);
        gfx.lineTo(20, 33);
        gfx.lineTo(20, 46);
        gfx.lineTo(10, 41);
        gfx.closePath();
        gfx.fillPath();

        // Roof top face (red diamond)
        gfx.fillStyle(COLORS.buildingRoof);
        gfx.lineStyle(1, COLORS.buildingRoofEdge);
        gfx.beginPath();
        gfx.moveTo(roofTop.x, roofTop.y);
        gfx.lineTo(roofRight.x, roofRight.y);
        gfx.lineTo(roofBottom.x, roofBottom.y);
        gfx.lineTo(roofLeft.x, roofLeft.y);
        gfx.closePath();
        gfx.fillPath();
        gfx.strokePath();

        gfx.generateTexture('building-house', tileW, texH);
        gfx.destroy();
    }
}
