import { NPC } from './entities/NPC';
import { Player } from './entities/Player';
import { Entity } from './entities/Entity';
import { LLMService } from './LLMService';
import { parseDirectives, Directive } from './DirectiveParser';
import { buildWorldState } from './WorldState';
import { EntityManager } from './entities/EntityManager';
import { ChronologicalLog } from './ChronologicalLog';
import { GoalManager } from './GoalManager';
import { ConversationManager } from './ConversationManager';
import { ToolRegistry } from './ToolRegistry';
import { DirectiveExecutor } from './DirectiveExecutor';
import { FunctionBuilderService } from './FunctionBuilderService';
import {
    SUMMARIZE_EVERY_N_TURNS, LOG_CHAR_BUDGET, NPC_COMMANDS_PER_TURN,
    NPC_TURN_DELAY, FONT, SLEEP_TURNS,
} from './GameConfig';

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
    private executor: DirectiveExecutor;
    private toolRegistry: ToolRegistry;
    private sleepUntil = new Map<string, number>();

    // Conversation integration
    private conversationPaused = false;
    private conversationResolve: (() => void) | null = null;
    private conversationManager!: ConversationManager;
    private functionBuilder: FunctionBuilderService;

    constructor(scene: Phaser.Scene, npcs: NPC[], entityManager: EntityManager, toolRegistry: ToolRegistry) {
        this.npcs = npcs;
        this.allEntities = entityManager;
        this.toolRegistry = toolRegistry;
        this.executor = new DirectiveExecutor(toolRegistry);
        this.functionBuilder = new FunctionBuilderService(toolRegistry);

        this.turnLabel = scene.add.text(10, 10, '', FONT.turnLabel as Phaser.Types.GameObjects.Text.TextStyle);
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
        this.executor.setConversationManager(cm);
        cm.onNpcEngaged = (name: string) => this.wakeNpc(name);
    }

    /** Remove an NPC from sleep so they get an LLM call next turn. */
    wakeNpc(name: string): void {
        if (this.sleepUntil.delete(name)) {
            const npc = this.npcs.find(n => n.name === name);
            npc?.setSleeping(false);
            console.log(`%c[TurnManager] ${name} woke up (conversation)`, 'color: #6bff6b; font-weight: bold');
        }
    }

    /** Called every frame — keeps label positions updated and player moving. */
    updateVisuals(entities: Entity[]) {
        for (const e of entities) {
            e.updateLabel();
        }
    }

    private async runLoop() {
        while (true) {
            await this.waitIfAnyPause();
            this.turnNumber++;
            for (const npc of this.npcs) {
                await this.waitIfAnyPause();
                this.state = 'npc-turn';
                this.activeNpc = npc;
                this.turnLabel.setText(`Turn ${this.turnNumber} — ${npc.name}'s turn`);

                await this.runNpcTurn(npc);
                await this.waitIfAnyPause();
                await this.delay(NPC_TURN_DELAY);
            }

            this.state = 'idle';
            this.activeNpc = null;
            this.turnLabel.setText(`Turn ${this.turnNumber} complete`);
            await this.delay(NPC_TURN_DELAY);
        }
    }

    private async runNpcTurn(npc: NPC) {
        // Wait if a player conversation is active — ensures this NPC's entire
        // turn is deferred so it won't make decisions without fresh memory.
        await this.waitIfConversationPaused();

        // Sleep check — skip LLM call if NPC is sleeping
        const wakeAt = this.sleepUntil.get(npc.name);
        if (wakeAt !== undefined && this.turnNumber < wakeAt) {
            const remaining = wakeAt - this.turnNumber;
            this.turnLabel.setText(`Turn ${this.turnNumber} — ${npc.name} sleeping (${remaining} turns left)`);
            console.log(`%c[${npc.name}] sleeping (${remaining} turns left)`, 'color: #aaa');
            return;
        }
        if (wakeAt !== undefined) {
            // Just woke up naturally
            this.sleepUntil.delete(npc.name);
            npc.setSleeping(false);
            const log = this.logs.get(npc.name)!;
            log.recordAction(`I woke up (turn ${this.turnNumber})`);
            console.log(`%c[${npc.name}] woke up (sleep expired)`, 'color: #6bff6b; font-weight: bold');
        }

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
            const worldState = buildWorldState(npc, entities, this.toolRegistry);
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
            
            // Fix: Feed the error back to the NPC's memory log
            log.recordAction(`My action failed because my response wasn't understood: ${msg}`);
            
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
            await this.executor.executeGoal(npc, dir, log, goalManager);
        }

        // Cap action directives at NPC_COMMANDS_PER_TURN
        const capped = actionDirectives.slice(0, NPC_COMMANDS_PER_TURN);

        for (const dir of capped) {
            await this.waitIfConversationPaused();

            if (dir.type === 'create_function') {
                await this.functionBuilder.handleCreateFunction(npc, log, dir.description, dir.x, dir.y);
                break;
            }

            if (dir.type === 'update_function') {
                await this.functionBuilder.handleUpdateFunction(npc, log, dir.functionName, dir.changeDescription);
                break;
            }

            if (dir.type === 'delete_function') {
                await this.functionBuilder.handleDeleteFunction(npc, log, dir.functionName);
                break;
            }

            try {
                const shouldStop = await this.executor.executeAction(npc, dir, log, this.turnNumber);
                if (shouldStop) break;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`%c[TurnManager] Action error for ${npc.name}: ${msg}`, 'color: #ff4444');
                log.recordAction(`My action '${dir.type}' failed with an exception: ${msg}`);
                break;
            }
        }

        // Check if NPC chose to sleep (blocked if they have an active goal)
        if (actionDirectives.some(d => d.type === 'sleep')) {
            if (goalManager.getActiveGoal()) {
                console.log(`%c[${npc.name}] sleep() rejected — has active goal`, 'color: #ffaa00; font-weight: bold');
                log.recordAction('I tried to sleep but I have an active goal to work on');
            } else {
                this.sleepUntil.set(npc.name, this.turnNumber + SLEEP_TURNS);
                npc.setSleeping(true);
                log.recordAction(`Entered sleep mode (will wake at turn ${this.turnNumber + SLEEP_TURNS})`);
                console.log(`%c[${npc.name}] sleep() — waking at turn ${this.turnNumber + SLEEP_TURNS}`, 'color: #aaa; font-weight: bold');
            }
        }

        // Persist log to disk, then try summarization
        await log.save();
        await log.maybeSummarize(SUMMARIZE_EVERY_N_TURNS);
        await goalManager.save();
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

    /** Block until both manual pause and conversation pause are released. */
    private async waitIfAnyPause(): Promise<void> {
        await this.waitIfPaused();
        await this.waitIfConversationPaused();
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
