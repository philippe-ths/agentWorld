import { Player } from './entities/Player';
import { NPC } from './entities/NPC';
import { Entity } from './entities/Entity';

export const NPC_ACTIONS_PER_TURN = 3;

type TurnState = 'waiting-for-player' | 'npc-turn' | 'animating';

export class TurnManager {
    private player: Player;
    private npcs: NPC[];
    private state: TurnState = 'waiting-for-player';
    private turnNumber = 0;

    /** Called when a new turn round starts. */
    onRoundStart?: (turnNumber: number) => void;
    /** Called when it becomes an NPC's turn (before actions). */
    onNpcTurn?: (npc: NPC, actionsPerTurn: number) => Promise<{ type: 'move_to'; x: number; y: number } | { type: 'wait' }>[];

    constructor(player: Player, npcs: NPC[]) {
        this.player = player;
        this.npcs = npcs;
        this.startPlayerTurn();
    }

    /** Called every frame — keeps label positions updated. */
    updateVisuals(entities: Entity[]) {
        for (const e of entities) {
            e.updateLabel();
        }
    }

    private async startPlayerTurn() {
        this.turnNumber++;
        this.state = 'waiting-for-player';
        this.onRoundStart?.(this.turnNumber);

        // Wait for the player to press a key and finish the move animation
        await this.player.awaitAction();

        // Player turn done — run NPC turns
        await this.runNpcTurns();

        // All done — start next round
        this.startPlayerTurn();
    }

    private async runNpcTurns() {
        this.state = 'npc-turn';

        for (const _npc of this.npcs) {
            // For now, NPCs just wait (no LLM yet).
            // When LLM is integrated, onNpcTurn will return real actions.
            for (let i = 0; i < NPC_ACTIONS_PER_TURN; i++) {
                // Placeholder: wait (no-op)
                await this.delay(50);
            }
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getState(): TurnState {
        return this.state;
    }

    getTurnNumber(): number {
        return this.turnNumber;
    }
}
