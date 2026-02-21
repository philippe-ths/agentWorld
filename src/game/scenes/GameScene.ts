import { Scene } from 'phaser';
import { MAP_DATA, MAP_WIDTH, MAP_HEIGHT } from '../MapData';
import { TILE_W, TILE_H } from '../entities/Entity';
import { Player } from '../entities/Player';
import { NPC } from '../entities/NPC';
import { EntityManager } from '../entities/EntityManager';
import { ConversationManager } from '../ai/ConversationManager';
import { ChatController } from '../ui/ChatController';
import { ControlBar } from '../ui/ControlBar';
import { LogPanel } from '../ui/LogPanel';

const TILE_KEYS = ['tile-grass', 'tile-water'];

export class GameScene extends Scene {
    map!: Phaser.Tilemaps.Tilemap;
    private groundLayer!: Phaser.Tilemaps.TilemapLayer;
    entityManager!: EntityManager;
    private player!: Player;

    constructor() {
        super('GameScene');
    }

    create() {
        this.createTilemap();
        this.createAnimations();

        this.entityManager = new EntityManager();
        this.player = new Player(this, this.map, { x: 5, y: 5 }, this.entityManager.isWalkable);
        this.entityManager.add(this.player);

        this.spawnNPCs();
        new ConversationManager(this.entityManager);
        new ChatController(this, this.player, this.entityManager);
        new ControlBar(this.entityManager);
        new LogPanel(this.entityManager);
        this.setupCamera();
    }

    // ── Tilemap ──────────────────────────────────────────────

    private createTilemap() {
        const mapData = new Phaser.Tilemaps.MapData({
            tileWidth: TILE_W,
            tileHeight: TILE_H,
            width: MAP_WIDTH,
            height: MAP_HEIGHT,
            orientation: Phaser.Tilemaps.Orientation.ISOMETRIC,
        });
        this.map = new Phaser.Tilemaps.Tilemap(this, mapData);

        const tilesets: Phaser.Tilemaps.Tileset[] = [];
        for (let i = 0; i < TILE_KEYS.length; i++) {
            const ts = this.map.addTilesetImage(
                TILE_KEYS[i],
                TILE_KEYS[i],
                TILE_W,
                TILE_H,
                0,
                0,
                i
            );
            if (ts) tilesets.push(ts);
        }

        this.groundLayer = this.map.createBlankLayer('ground', tilesets, 0, 0)!;

        for (let y = 0; y < MAP_HEIGHT; y++) {
            for (let x = 0; x < MAP_WIDTH; x++) {
                this.map.putTileAt(MAP_DATA[y][x], x, y, false, this.groundLayer);
            }
        }
    }

    // ── Animations ───────────────────────────────────────────

    private createAnimations() {
        const rate = 8;

        this.anims.create({
            key: 'walk-down',
            frames: this.anims.generateFrameNumbers('player', { start: 0, end: 3 }),
            frameRate: rate,
            repeat: -1,
        });
        this.anims.create({
            key: 'walk-up',
            frames: this.anims.generateFrameNumbers('player', { start: 4, end: 7 }),
            frameRate: rate,
            repeat: -1,
        });
        this.anims.create({
            key: 'walk-left',
            frames: this.anims.generateFrameNumbers('player', { start: 8, end: 11 }),
            frameRate: rate,
            repeat: -1,
        });
        this.anims.create({
            key: 'walk-right',
            frames: this.anims.generateFrameNumbers('player', { start: 12, end: 15 }),
            frameRate: rate,
            repeat: -1,
        });
        this.anims.create({
            key: 'idle-down',
            frames: [{ key: 'player', frame: 0 }],
            frameRate: 1,
        });
        this.anims.create({
            key: 'idle-up',
            frames: [{ key: 'player', frame: 4 }],
            frameRate: 1,
        });
        this.anims.create({
            key: 'idle-left',
            frames: [{ key: 'player', frame: 8 }],
            frameRate: 1,
        });
        this.anims.create({
            key: 'idle-right',
            frames: [{ key: 'player', frame: 12 }],
            frameRate: 1,
        });
    }

    // ── NPCs ─────────────────────────────────────────────────

    private spawnNPCs() {
        const npcDefs = [
            { name: 'Ada', tile: { x: 15, y: 10 }, tint: 0xff6b6b },
            { name: 'Bjorn', tile: { x: 25, y: 20 }, tint: 0x6bc5ff },
            { name: 'Cora', tile: { x: 10, y: 25 }, tint: 0xb06bff },
        ];

        for (const def of npcDefs) {
            const npc = new NPC(
                this, this.map, def.tile,
                this.entityManager.isWalkable, def.name, def.tint,
            );
            npc.initAgentLoop(this.entityManager);
            this.entityManager.add(npc);
        }
    }

    // ── Camera ───────────────────────────────────────────────

    private setupCamera() {
        const cam = this.cameras.main;
        cam.startFollow(this.player.sprite, true, 0.08, 0.08);

        const top = this.map.tileToWorldXY(0, 0)!;
        const right = this.map.tileToWorldXY(MAP_WIDTH, 0)!;
        const bottom = this.map.tileToWorldXY(MAP_WIDTH, MAP_HEIGHT)!;
        const left = this.map.tileToWorldXY(0, MAP_HEIGHT)!;

        const padding = 200;
        const boundsX = left.x - padding;
        const boundsY = top.y - padding;
        const boundsW = right.x - left.x + TILE_W + padding * 2;
        const boundsH = bottom.y - top.y + TILE_H + padding * 2;

        cam.setBounds(boundsX, boundsY, boundsW, boundsH);
    }

    // ── Update loop ──────────────────────────────────────────

    update(time: number, delta: number) {
        this.entityManager.updateAll(time, delta);
    }
}
