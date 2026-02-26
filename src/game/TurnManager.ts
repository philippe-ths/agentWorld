import { NPC } from './entities/NPC';
import { Entity } from './entities/Entity';
import { LLMService } from './LLMService';
import { parseDirectives, Directive } from './DirectiveParser';
import { buildWorldState } from './WorldState';
import { EntityManager } from './entities/EntityManager';
import { ChronologicalLog, SUMMARIZE_EVERY_N_TURNS, LOG_CHAR_BUDGET } from './ChronologicalLog';

/** Number of commands an NPC can execute per turn (each command runs to completion). */
export const NPC_COMMANDS_PER_TURN = 3;

type TurnState = 'idle' | 'npc-turn' | 'paused';

export class TurnManager {
    private npcs: NPC[];
    private allEntities: EntityManager;
    private state: TurnState = 'idle';
    private activeNpc: NPC | null = null;
    private turnNumber = 0;
    private turnLabel!: Phaser.GameObjects.Text;
    private llm: LLMService;
    private paused = false;
    private pauseResolve: (() => void) | null = null;
    private logs = new Map<string, ChronologicalLog>();

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

        scene.input.keyboard!.on('keydown-P', () => this.togglePause());

        this.initAndRun();
    }

    private async initAndRun() {
        for (const npc of this.npcs) {
            const log = new ChronologicalLog(npc.name);
            await log.load();
            this.logs.set(npc.name, log);
        }

        // Resume turn counter from persisted logs
        for (const log of this.logs.values()) {
            const last = log.getLastTurnNumber();
            if (last > this.turnNumber) this.turnNumber = last;
        }

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
            await this.waitIfPaused();
            this.turnNumber++;
            for (const npc of this.npcs) {
                await this.waitIfPaused();
                this.state = 'npc-turn';
                this.activeNpc = npc;
                this.turnLabel.setText(`Turn ${this.turnNumber} — ${npc.name}'s turn`);

                await this.runNpcTurn(npc);
                await this.delay(5000);
            }

            this.state = 'idle';
            this.activeNpc = null;
            this.turnLabel.setText(`Turn ${this.turnNumber} complete`);
            await this.delay(5000);
        }
    }

    private async runNpcTurn(npc: NPC) {
        const log = this.logs.get(npc.name)!;
        const entities = this.allEntities.getEntities();

        // Record observations for this turn
        log.startTurn(
            this.turnNumber,
            npc.tilePos,
            entities.map(e => ({ name: e.name, tilePos: e.tilePos })),
        );

        let directives: Directive[];

        try {
            const worldState = buildWorldState(npc, entities);
            const memory = log.buildPromptContent(LOG_CHAR_BUDGET) || undefined;
            const response = await this.llm.decide(npc.name, worldState, memory);
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
            await this.executeDirective(npc, dir, log);
        }

        // Persist log to disk, then try summarization
        await log.save();
        await log.maybeSummarize(SUMMARIZE_EVERY_N_TURNS);
    }

    private async executeDirective(npc: NPC, dir: Directive, log: ChronologicalLog) {
        switch (dir.type) {
            case 'move_to':
                console.log(`%c[${npc.name}] move_to(${dir.x}, ${dir.y})`, 'color: #6bff6b');
                await npc.walkToAsync({ x: dir.x, y: dir.y });
                log.recordAction(`I moved to (${npc.tilePos.x},${npc.tilePos.y})`);
                break;
            case 'wait':
                console.log(`%c[${npc.name}] wait()`, 'color: #aaa');
                await this.delay(300);
                log.recordAction('I waited');
                break;
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    togglePause() {
        this.paused = !this.paused;
        if (this.paused) {
            this.turnLabel.setText('⏸ PAUSED (press P to resume)');
            console.log('%c[TurnManager] Paused', 'color: #ffaa00; font-weight: bold');
        } else {
            console.log('%c[TurnManager] Resumed', 'color: #6bff6b; font-weight: bold');
            if (this.pauseResolve) {
                this.pauseResolve();
                this.pauseResolve = null;
            }
        }
    }

    private waitIfPaused(): Promise<void> {
        if (!this.paused) return Promise.resolve();
        return new Promise(resolve => {
            this.pauseResolve = resolve;
        });
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
