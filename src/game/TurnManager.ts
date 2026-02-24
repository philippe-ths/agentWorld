import { NPC } from './entities/NPC';
import { Entity } from './entities/Entity';
import { MAP_WIDTH, MAP_HEIGHT } from './MapData';

type TurnState = 'idle' | 'npc-turn';

export class TurnManager {
    private npcs: NPC[];
    private state: TurnState = 'idle';
    private activeNpc: NPC | null = null;
    private turnNumber = 0;
    private turnLabel!: Phaser.GameObjects.Text;

    /** Called for each NPC's turn — provides the NPC and expects the handler to move it. */
    onNpcTurn?: (npc: NPC) => Promise<void>;

    constructor(scene: Phaser.Scene, npcs: NPC[]) {
        this.npcs = npcs;

        this.turnLabel = scene.add.text(10, 10, '', {
            fontSize: '14px',
            color: '#ffffff',
            fontFamily: 'Arial, sans-serif',
            stroke: '#000000',
            strokeThickness: 3,
        });
        this.turnLabel.setScrollFactor(0);
        this.turnLabel.setDepth(1000);

        this.runLoop();
    }

    /** Called every frame — keeps label positions updated and player moving. */
    updateVisuals(entities: Entity[]) {
        for (const e of entities) {
            e.updateLabel();
        }
    }

    private async runLoop() {
        while (true) {
            this.turnNumber++;
            for (const npc of this.npcs) {
                this.state = 'npc-turn';
                this.activeNpc = npc;
                this.turnLabel.setText(`Turn ${this.turnNumber} — ${npc.name}'s turn`);

                if (this.onNpcTurn) {
                    await this.onNpcTurn(npc);
                } else {
                    // Default: random walk to a nearby tile
                    await this.randomWalkTo(npc);
                }
            }

            this.state = 'idle';
            this.activeNpc = null;
            this.turnLabel.setText(`Turn ${this.turnNumber} complete`);
            await this.delay(300);
        }
    }

    /** Walk to a random tile 1-5 steps away, taking as many steps as needed. */
    private async randomWalkTo(npc: NPC) {
        const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        const dist = 1 + Math.floor(Math.random() * 5);
        const target = {
            x: Math.max(0, Math.min(MAP_WIDTH - 1, npc.tilePos.x + dir.x * dist)),
            y: Math.max(0, Math.min(MAP_HEIGHT - 1, npc.tilePos.y + dir.y * dist)),
        };
        await npc.walkToAsync(target);
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getState(): TurnState {
        return this.state;
    }

    getActiveNpc(): NPC | null {
        return this.activeNpc;
    }

    getTurnNumber(): number {
        return this.turnNumber;
    }
}
