import { NPC } from './entities/NPC';
import { Player } from './entities/Player';
import { Entity } from './entities/Entity';
import { LLMService } from './LLMService';
import { parseDirectives, Directive } from './DirectiveParser';
import { buildWorldState } from './WorldState';
import { EntityManager } from './entities/EntityManager';
import { ChronologicalLog, SUMMARIZE_EVERY_N_TURNS, LOG_CHAR_BUDGET } from './ChronologicalLog';
import { GoalManager } from './GoalManager';
import { ConversationManager } from './ConversationManager';

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
    private goals = new Map<string, GoalManager>();

    // Conversation integration
    private conversationPaused = false;
    private conversationResolve: (() => void) | null = null;
    private conversationManager!: ConversationManager;

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

            const goalMgr = new GoalManager(npc.name);
            await goalMgr.load();
            this.goals.set(npc.name, goalMgr);
        }

        // Resume turn counter from persisted logs
        for (const log of this.logs.values()) {
            const last = log.getLastTurnNumber();
            if (last > this.turnNumber) this.turnNumber = last;
        }

        this.runLoop();
    }

    /** Inject the ConversationManager once it's created by the scene. */
    setConversationManager(cm: ConversationManager) {
        this.conversationManager = cm;
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
        const goalManager = this.goals.get(npc.name)!;
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
            const goalsContent = goalManager.buildPromptContent() || undefined;
            const response = await this.llm.decide(npc.name, worldState, memory, goalsContent);
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

        // Separate goal directives (metadata, don't count toward budget) from action directives
        const goalDirectives = directives.filter(d =>
            d.type === 'complete_goal' || d.type === 'abandon_goal' || d.type === 'switch_goal',
        );
        const actionDirectives = directives.filter(d =>
            d.type !== 'complete_goal' && d.type !== 'abandon_goal' && d.type !== 'switch_goal',
        );

        // Execute goal directives first (instant, no budget cost)
        for (const dir of goalDirectives) {
            await this.executeGoalDirective(npc, dir, log, goalManager);
        }

        // Cap action directives at NPC_COMMANDS_PER_TURN
        const capped = actionDirectives.slice(0, NPC_COMMANDS_PER_TURN);

        for (const dir of capped) {
            await this.waitIfConversationPaused();
            const shouldStop = await this.executeDirective(npc, dir, log);
            if (shouldStop) break;
        }

        // Persist log to disk, then try summarization
        await log.save();
        await log.maybeSummarize(SUMMARIZE_EVERY_N_TURNS);
        await goalManager.save();
    }

    private async executeGoalDirective(
        npc: NPC, dir: Directive, log: ChronologicalLog, goalManager: GoalManager,
    ): Promise<void> {
        switch (dir.type) {
            case 'complete_goal': {
                const result = goalManager.completeGoal();
                if (result) {
                    console.log(`%c[${npc.name}] complete_goal()`, 'color: #6bff6b');
                    log.recordAction(`Completed goal: ${result.completed}`);
                    if (result.promoted) {
                        log.recordAction(`New goal: ${result.promoted.goal} (source: ${result.promoted.source})`);
                    }
                }
                break;
            }
            case 'abandon_goal': {
                const result = goalManager.abandonGoal();
                if (result) {
                    console.log(`%c[${npc.name}] abandon_goal()`, 'color: #ffaa00');
                    log.recordAction(`Abandoned goal: ${result.abandoned}`);
                    if (result.promoted) {
                        log.recordAction(`New goal: ${result.promoted.goal} (source: ${result.promoted.source})`);
                    }
                }
                break;
            }
            case 'switch_goal': {
                const result = goalManager.switchGoal();
                if (result) {
                    console.log(`%c[${npc.name}] switch_goal()`, 'color: #ff9f43');
                    log.recordAction(`Abandoned goal: ${result.abandoned}`);
                    log.recordAction(`New goal: ${result.newGoal.goal} (source: ${result.newGoal.source})`);
                }
                break;
            }
        }
    }

    private async executeDirective(npc: NPC, dir: Directive, log: ChronologicalLog): Promise<boolean> {
        switch (dir.type) {
            case 'move_to':
                console.log(`%c[${npc.name}] move_to(${dir.x}, ${dir.y})`, 'color: #6bff6b');
                await npc.walkToAsync({ x: dir.x, y: dir.y });
                log.recordAction(`I moved to (${npc.tilePos.x},${npc.tilePos.y})`);
                return false;
            case 'wait':
                console.log(`%c[${npc.name}] wait()`, 'color: #aaa');
                await this.delay(300);
                log.recordAction('I waited');
                return false;
            case 'start_conversation_with':
                console.log(`%c[${npc.name}] start_conversation_with(${dir.targetName}, ${dir.message})`, 'color: #ff9f43');
                log.recordAction(`I started a conversation with ${dir.targetName}`);
                await this.conversationManager.startNpcConversation(
                    npc, dir.targetName, dir.message, this.turnNumber,
                );
                return true; // End turn after conversation
            case 'end_conversation':
                // Should only appear inside a conversation response, not as a turn directive
                console.warn(`%c[${npc.name}] end_conversation() used outside conversation`, 'color: #ffaa00');
                return false;
            default:
                return false;
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

    pauseForConversation(): void {
        this.conversationPaused = true;
    }

    resumeFromConversation(): void {
        this.conversationPaused = false;
        if (this.conversationResolve) {
            this.conversationResolve();
            this.conversationResolve = null;
        }
    }

    private waitIfConversationPaused(): Promise<void> {
        if (!this.conversationPaused) return Promise.resolve();
        return new Promise(resolve => {
            this.conversationResolve = resolve;
        });
    }

    /** Called by GameScene when the player presses the interact key next to an NPC. */
    async playerInitiateConversation(player: Player, target: NPC): Promise<void> {
        if (this.conversationManager.isInConversation()) return;
        this.pauseForConversation();
        await this.conversationManager.startPlayerConversation(player, target, this.turnNumber);
        this.resumeFromConversation();
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

    getLogs(): Map<string, ChronologicalLog> {
        return this.logs;
    }

    getGoals(): Map<string, GoalManager> {
        return this.goals;
    }

    getLlm(): LLMService {
        return this.llm;
    }
}
