import { NPC } from './entities/NPC';
import { Entity } from './entities/Entity';
import { LLMService } from './LLMService';
import { parseDirectives, Directive } from './DirectiveParser';
import { buildWorldState } from './WorldState';
import { EntityManager } from './entities/EntityManager';

/** Number of commands an NPC can execute per turn (each command runs to completion). */
export const NPC_COMMANDS_PER_TURN = 3;

type TurnState = 'idle' | 'npc-turn';

export class TurnManager {
    private npcs: NPC[];
    private allEntities: EntityManager;
    private state: TurnState = 'idle';
    private activeNpc: NPC | null = null;
    private turnNumber = 0;
    private turnLabel!: Phaser.GameObjects.Text;
    private llm: LLMService;

    constructor(scene: Phaser.Scene, npcs: NPC[], entityManager: EntityManager) {
        this.npcs = npcs;
        this.allEntities = entityManager;

        this.turnLabel = scene.add.text(10, 10, '', {
            fontSize: '14px',
            color: '#ffffff',
            fontFamily: 'Arial, sans-serif',
            stroke: '#000000',
            strokeThickness: 3,
        });
        this.turnLabel.setScrollFactor(0);
        this.turnLabel.setDepth(1000);

        this.llm = new LLMService(this.turnLabel);

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

                await this.runNpcTurn(npc);
            }

            this.state = 'idle';
            this.activeNpc = null;
            this.turnLabel.setText(`Turn ${this.turnNumber} complete`);
            await this.delay(300);
        }
    }

    private async runNpcTurn(npc: NPC) {
        let directives: Directive[];

        try {
            const worldState = buildWorldState(npc, this.allEntities.getEntities());
            const response = await this.llm.decide(npc.name, worldState);
            directives = parseDirectives(response);
        } catch (err) {
            const msg = (err as Error).message;
            console.error(
                `%c[TurnManager] LLM failed for ${npc.name}, falling back to wait(). Error: ${msg}`,
                'color: #ff4444; font-weight: bold; font-size: 14px',
            );
            this.turnLabel.setText(`⚠ ${npc.name}: LLM error — waiting`);
            directives = [{ type: 'wait' }];
        }

        // Cap at NPC_COMMANDS_PER_TURN
        const capped = directives.slice(0, NPC_COMMANDS_PER_TURN);

        for (const dir of capped) {
            await this.executeDirective(npc, dir);
        }
    }

    private async executeDirective(npc: NPC, dir: Directive) {
        switch (dir.type) {
            case 'move_to':
                console.log(`%c[${npc.name}] move_to(${dir.x}, ${dir.y})`, 'color: #6bff6b');
                await npc.walkToAsync({ x: dir.x, y: dir.y });
                break;
            case 'start_conversation_with':
                console.log(`%c[${npc.name}] start_conversation_with(${dir.name})`, 'color: #ffff6b');
                // TODO: implement conversation mechanic
                break;
            case 'wait':
                console.log(`%c[${npc.name}] wait()`, 'color: #aaa');
                await this.delay(300);
                break;
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
