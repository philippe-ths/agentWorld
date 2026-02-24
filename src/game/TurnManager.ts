import { NPC } from './entities/NPC';
import { Entity } from './entities/Entity';

export const NPC_ACTIONS_PER_TURN = 3;

type TurnState = 'idle' | 'npc-turn';

export class TurnManager {
    private npcs: NPC[];
    private state: TurnState = 'idle';
    private activeNpc: NPC | null = null;
    private turnNumber = 0;
    private turnLabel!: Phaser.GameObjects.Text;

    /** Called before each NPC's turn — return actions from LLM in Phase 3. */
    onNpcTurn?: (npc: NPC, actionsPerTurn: number) => Promise<void>;

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
                    await this.onNpcTurn(npc, NPC_ACTIONS_PER_TURN);
                } else {
                    // Placeholder: NPCs wait (no LLM yet)
                    for (let i = 0; i < NPC_ACTIONS_PER_TURN; i++) {
                        await this.delay(50);
                    }
                }
            }

            this.state = 'idle';
            this.activeNpc = null;
            this.turnLabel.setText(`Turn ${this.turnNumber} — NPCs thinking...`);
            await this.delay(100);
        }
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
