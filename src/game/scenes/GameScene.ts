import { Scene } from 'phaser';
import { MAP_DATA, MAP_WIDTH, MAP_HEIGHT } from '../MapData';
import { TILE_W, TILE_H } from '../entities/Entity';
import { Player } from '../entities/Player';
import { NPC } from '../entities/NPC';
import { EntityManager } from '../entities/EntityManager';
import { buildWorldState } from '../WorldState';
import { TurnManager } from '../TurnManager';
import { ConversationManager } from '../ConversationManager';
import { showSpeechBubble } from '../ui/SpeechBubble';
import { DialogueBox } from '../ui/DialogueBox';
import { ToolRegistry } from '../ToolRegistry';
import { ChronologicalLog } from '../ChronologicalLog';
import { buildRemovedFunctionNote, partitionPersistedFunctionRecords } from '../PersistedFunctionAudit';
import { executeFunction, deleteFunctionRecord, loadFunctionRecords, searchWeb } from '../ToolService';
import { FunctionRecord } from '../GameConfig';
import { FONT, NPCS, PLAYER_SPAWN, BUILDINGS } from '../GameConfig';

const TILE_KEYS = ['tile-grass', 'tile-water'];

export class GameScene extends Scene {
    private map!: Phaser.Tilemaps.Tilemap;
    private entityManager!: EntityManager;
    private player!: Player;
    private npcs: NPC[] = [];
    private turnManager!: TurnManager;
    private conversationManager!: ConversationManager;
    private dialogueBox!: DialogueBox;
    private interactKey!: Phaser.Input.Keyboard.Key;
    private toolRegistry!: ToolRegistry;
    private buildingSprites: Phaser.GameObjects.Image[] = [];
    private buildingLabels: Phaser.GameObjects.Text[] = [];
    private buildingRenderSignature = '';

    constructor() {
        super('GameScene');
    }

    create() {
        this.toolRegistry = this.createToolRegistry();
        this.createTilemap();
        this.createAnimations();

        this.entityManager = new EntityManager();
        this.entityManager.setToolRegistry(this.toolRegistry);
        this.player = new Player(this, this.map, PLAYER_SPAWN, this.entityManager.isWalkable);
        this.entityManager.add(this.player);

        this.spawnNPCs();
        this.setupCamera();
        this.placeBuildingLabels();
        void this.loadPersistedFunctions();

        // Temporary: log world state so we can inspect the format
        console.log(buildWorldState(this.player, this.entityManager.getEntities(), this.toolRegistry));

        this.turnManager = new TurnManager(this, this.npcs, this.entityManager, this.toolRegistry);

        // Set up dialogue box UI
        this.dialogueBox = new DialogueBox(this);

        // Set up ConversationManager with callbacks
        this.conversationManager = new ConversationManager(
            this.entityManager,
            this.turnManager.getLlm(),
            this.turnManager.getLogs(),
            this.turnManager.getGoals(),
            {
                showSpeechBubble: (entity, text, duration) =>
                    showSpeechBubble(this, entity, text, duration),
                openDialogue: (targetName) => this.dialogueBox.open(targetName),
                closeDialogue: () => this.dialogueBox.close(),
                addDialogueMessage: (speaker, text) => this.dialogueBox.addMessage(speaker, text),
            },
            this.toolRegistry,
        );
        this.turnManager.setConversationManager(this.conversationManager);

        // Wire dialogue box events
        this.dialogueBox.onSubmit((text) => this.conversationManager.submitPlayerMessage(text));
        this.dialogueBox.onClose(() => this.conversationManager.closePlayerDialogue());

        // Wire NPC conversation pause gates
        for (const npc of this.npcs) {
            npc.conversationPauseGate = () => this.turnManager['waitIfConversationPaused']();
        }

        // Enter key to initiate conversation
        this.interactKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
        this.interactKey.on('down', () => this.tryStartPlayerConversation());
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

        const groundLayer = this.map.createBlankLayer('ground', tilesets, 0, 0)!;

        for (let y = 0; y < MAP_HEIGHT; y++) {
            for (let x = 0; x < MAP_WIDTH; x++) {
                this.map.putTileAt(MAP_DATA[y][x], x, y, false, groundLayer);
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
        for (const def of NPCS) {
            const npc = new NPC(
                this, this.map, def.tile,
                this.entityManager.isWalkable,
                this.entityManager.isTerrainWalkable,
                def.name, def.tint,
            );
            this.npcs.push(npc);
            this.entityManager.add(npc);
        }
    }

    // ── Tool Buildings ───────────────────────────────────────

    private createToolRegistry(): ToolRegistry {
        const registry = new ToolRegistry();

        // Register tool handlers
        registry.registerHandler('search', searchWeb);
        registry.registerHandler('code_forge', async () => 'Use create_function/update_function/delete_function when adjacent to Code Forge.');

        // Register buildings from config
        for (const def of BUILDINGS) {
            registry.registerFromConfig(def);
        }

        return registry;
    }

    private placeBuildingLabels(): void {
        this.clearBuildingVisuals();

        for (const building of this.toolRegistry.getAll()) {
            const worldPos = this.map.tileToWorldXY(building.tile.x, building.tile.y)!;
            const depth = building.tile.x + building.tile.y + 1;

            // 3D house image overlay on the grass tile
            const house = this.add.image(
                worldPos.x + TILE_W / 2,
                worldPos.y + TILE_H,
                'building-house',
            );
            house.setOrigin(0.5, 1);
            house.setDepth(depth);
            this.buildingSprites.push(house);

            // Name label above the house
            const label = this.add.text(
                worldPos.x + TILE_W / 2,
                worldPos.y + TILE_H - house.height,
                building.displayName,
                FONT.label as Phaser.Types.GameObjects.Text.TextStyle,
            );
            label.setOrigin(0.5, 1);
            label.setDepth(depth + 0.5);
            this.buildingLabels.push(label);
        }

        this.buildingRenderSignature = this.getBuildingSignature();
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
        // Suppress player movement while in a conversation
        if (!this.dialogueBox.isOpen()) {
            this.player.update(time, delta);
        }
        if (this.buildingRenderSignature !== this.getBuildingSignature()) {
            this.placeBuildingLabels();
        }
        this.turnManager.updateVisuals(this.entityManager.getEntities());
    }

    // ── Player conversation ──────────────────────────────────

    private tryStartPlayerConversation(): void {
        if (this.dialogueBox.isOpen()) return;
        if (this.conversationManager.isInConversation()) return;

        // Find an adjacent NPC, prefer the one in the direction the player is facing
        const adjacentNpc = this.findAdjacentNpc();
        if (!adjacentNpc) return;

        this.turnManager.playerInitiateConversation(this.player, adjacentNpc);
    }

    private findAdjacentNpc(): NPC | null {
        const facing = this.player.lastDirection;
        const pos = this.player.tilePos;

        // Direction offsets in order of preference: facing direction first
        const offsets: Record<string, { dx: number; dy: number }> = {
            up: { dx: 0, dy: -1 },
            down: { dx: 0, dy: 1 },
            left: { dx: -1, dy: 0 },
            right: { dx: 1, dy: 0 },
        };

        const facingOffset = offsets[facing];
        const orderedOffsets = [facingOffset, ...Object.values(offsets).filter(o => o !== facingOffset)];

        for (const offset of orderedOffsets) {
            const tx = pos.x + offset.dx;
            const ty = pos.y + offset.dy;
            const npc = this.npcs.find(n => n.tilePos.x === tx && n.tilePos.y === ty);
            if (npc) return npc;
        }

        return null;
    }

    private clearBuildingVisuals(): void {
        for (const sprite of this.buildingSprites) sprite.destroy();
        for (const label of this.buildingLabels) label.destroy();
        this.buildingSprites = [];
        this.buildingLabels = [];
    }

    private getBuildingSignature(): string {
        return this.toolRegistry.getAll()
            .map(b => `${b.id}@${b.tile.x},${b.tile.y}`)
            .sort()
            .join('|');
    }

    private async loadPersistedFunctions(): Promise<void> {
        const records = await loadFunctionRecords();
        const { supported, unsupported } = partitionPersistedFunctionRecords(records);

        for (const item of unsupported) {
            await deleteFunctionRecord(item.record.name);
            await this.appendRemovedFunctionNote(item.record, item.reason);
        }

        for (const record of supported) {
            const parameterNames = record.parameters.map(p => p.name);
            this.toolRegistry.registerFunctionBuilding(record, async (rawArgs: string) => {
                const parsedArgs = rawArgs
                    ? rawArgs.split(',').map(v => v.trim()).filter(Boolean)
                    : [];
                const execution = await executeFunction(parameterNames, record.code, parsedArgs);
                return execution.ok ? execution.result : `Error: ${execution.result}`;
            });
        }

        if (supported.length > 0) {
            this.placeBuildingLabels();
        }
    }

    private async appendRemovedFunctionNote(record: FunctionRecord, reason: string): Promise<void> {
        const log = new ChronologicalLog(record.creator);
        await log.load();
        log.appendSystemNote(buildRemovedFunctionNote(record, reason));
        await log.save();
    }
}
