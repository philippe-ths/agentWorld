import { Entity, TilePos } from './entities/Entity';
import { NPC } from './entities/NPC';
import { Player } from './entities/Player';
import { EntityManager } from './entities/EntityManager';
import { LLMService, ConversationMessage, ConversationResponse } from './LLMService';
import { ChronologicalLog } from './ChronologicalLog';
import { GoalManager } from './GoalManager';
import { extractGoal, GoalExtractionResult } from './GoalExtractor';
import { ReflectionManager } from './ReflectionManager';
import { buildWorldState } from './WorldState';
import { ToolRegistry } from './ToolRegistry';
import { LOG_CHAR_BUDGET, MAX_EXCHANGES, SPEECH_BUBBLE_DURATION } from './GameConfig';

export interface ConversationSession {
    initiator: Entity;
    target: Entity;
    history: ConversationMessage[];
    turnNumber: number;
    location: TilePos;
}

interface ConversationCallbacks {
    showSpeechBubble: (entity: Entity, text: string, duration: number) => Promise<void>;
    openDialogue: (targetName: string) => void;
    closeDialogue: () => void;
    addDialogueMessage: (speaker: string, text: string) => void;
}

export class ConversationManager {
    private entityManager: EntityManager;
    private llm: LLMService;
    private logs: Map<string, ChronologicalLog>;
    private goals: Map<string, GoalManager>;
    private reflections: Map<string, ReflectionManager>;
    private callbacks: ConversationCallbacks;
    private toolRegistry: ToolRegistry;
    private activeSession: ConversationSession | null = null;

    /** Called when an NPC becomes a conversation target (wakes sleeping NPCs). */
    onNpcEngaged: ((npcName: string) => void) | null = null;

    // Player dialogue state
    private playerInputResolve: ((text: string) => void) | null = null;
    private playerDialogueClosed = false;

    constructor(
        entityManager: EntityManager,
        llm: LLMService,
        logs: Map<string, ChronologicalLog>,
        goals: Map<string, GoalManager>,
        reflections: Map<string, ReflectionManager>,
        callbacks: ConversationCallbacks,
        toolRegistry: ToolRegistry,
    ) {
        this.entityManager = entityManager;
        this.llm = llm;
        this.logs = logs;
        this.goals = goals;
        this.reflections = reflections;
        this.callbacks = callbacks;
        this.toolRegistry = toolRegistry;
    }

    isInConversation(): boolean {
        return this.activeSession !== null;
    }

    getActiveSession(): ConversationSession | null {
        return this.activeSession;
    }

    // ── NPC-to-NPC Conversation ─────────────────────────────

    async startNpcConversation(
        initiator: NPC,
        targetName: string,
        openingMessage: string,
        turnNumber: number,
    ): Promise<{ success: boolean; error?: string }> {
        const validation = this.validate(initiator, targetName);
        if (!validation.valid) {
            console.warn(`%c[Conversation] ${validation.error}`, 'color: #ffaa00; font-weight: bold');
            return { success: false, error: validation.error };
        }
        const target = validation.target!;

        // If the target is the Player, open dialogue box instead of running LLM loop
        if (target instanceof Player) {
            await this.startNpcToPlayerConversation(initiator, target, openingMessage, turnNumber);
            return { success: true };
        }

        this.activeSession = {
            initiator,
            target,
            history: [],
            turnNumber,
            location: { ...initiator.tilePos },
        };

        // Wake the target NPC if sleeping
        if (target instanceof NPC) this.onNpcEngaged?.(target.name);

        // Opening message from initiator
        this.activeSession.history.push({ speaker: initiator.name, text: openingMessage });

        // Show speech bubble and simultaneously call target's LLM
        const targetContext = await this.buildNpcPromptContext(target, turnNumber);

        const [, targetResponse] = await Promise.all([
            this.callbacks.showSpeechBubble(initiator, openingMessage, SPEECH_BUBBLE_DURATION),
            this.llm.converse(
                target.name,
                targetContext.worldState,
                targetContext.memory,
                this.activeSession.history,
                targetContext.reflection,
            ),
        ]);

        let exchangeCount = 1; // opening message counts as 1

        // Target responds
        if (targetResponse.type === 'say') {
            this.activeSession.history.push({ speaker: target.name, text: targetResponse.message });
            await this.callbacks.showSpeechBubble(target, targetResponse.message, SPEECH_BUBBLE_DURATION);
            exchangeCount++;
        } else {
            await this.finishConversation(target.name);
            return { success: true };
        }

        // Alternate back and forth
        while (exchangeCount < MAX_EXCHANGES) {
            // Initiator's turn
            const initiatorContext = await this.buildNpcPromptContext(initiator, turnNumber);
            const initiatorResponse = await this.llm.converse(
                initiator.name,
                initiatorContext.worldState,
                initiatorContext.memory,
                this.activeSession.history,
                initiatorContext.reflection,
            );

            if (initiatorResponse.type === 'say') {
                this.activeSession.history.push({ speaker: initiator.name, text: initiatorResponse.message });
                await this.callbacks.showSpeechBubble(initiator, initiatorResponse.message, SPEECH_BUBBLE_DURATION);
                exchangeCount++;
            } else {
                await this.finishConversation(initiator.name);
                return { success: true };
            }

            if (exchangeCount >= MAX_EXCHANGES) break;

            // Target's turn
            const targetContext2 = await this.buildNpcPromptContext(target, turnNumber);
            const targetResponse2 = await this.llm.converse(
                target.name,
                targetContext2.worldState,
                targetContext2.memory,
                this.activeSession.history,
                targetContext2.reflection,
            );

            if (targetResponse2.type === 'say') {
                this.activeSession.history.push({ speaker: target.name, text: targetResponse2.message });
                await this.callbacks.showSpeechBubble(target, targetResponse2.message, SPEECH_BUBBLE_DURATION);
                exchangeCount++;
            } else {
                await this.finishConversation(target.name);
                return { success: true };
            }
        }

        // Hit exchange cap
        await this.finishConversation('exchange limit');
        return { success: true };
    }

    // ── NPC-to-Player Conversation ──────────────────────────

    private async startNpcToPlayerConversation(
        initiator: NPC,
        player: Player,
        openingMessage: string,
        turnNumber: number,
    ): Promise<void> {
        this.activeSession = {
            initiator,
            target: player,
            history: [],
            turnNumber,
            location: { ...initiator.tilePos },
        };

        // Wake the initiating NPC if sleeping (they're being talked to by the player via NPC initiation)
        this.onNpcEngaged?.(initiator.name);

        // NPC's opening message
        this.activeSession.history.push({ speaker: initiator.name, text: openingMessage });

        // Show speech bubble for the opening, then open dialogue box
        await this.callbacks.showSpeechBubble(initiator, openingMessage, SPEECH_BUBBLE_DURATION);

        this.callbacks.openDialogue(initiator.name);
        this.callbacks.addDialogueMessage(initiator.name, openingMessage);

        await this.runPlayerConversationLoop(initiator);
        await this.finishConversation('Player', true);
    }

    // ── Player-to-NPC Conversation ──────────────────────────

    async startPlayerConversation(
        player: Player,
        target: NPC,
        turnNumber: number,
    ): Promise<void> {
        if (this.activeSession) {
            console.warn('%c[Conversation] Already in a conversation', 'color: #ffaa00; font-weight: bold');
            return;
        }
        if (!player.isAdjacentTo(target)) {
            console.warn('%c[Conversation] Target is not adjacent', 'color: #ffaa00; font-weight: bold');
            return;
        }

        this.activeSession = {
            initiator: player,
            target,
            history: [],
            turnNumber,
            location: { ...player.tilePos },
        };

        // Wake the target NPC if sleeping
        this.onNpcEngaged?.(target.name);

        this.callbacks.openDialogue(target.name);

        await this.runPlayerConversationLoop(target);
        await this.finishConversation('Player', true);
    }

    /** Shared loop: alternates player input and NPC LLM responses until dialogue closes. */
    private async runPlayerConversationLoop(npc: NPC): Promise<void> {
        this.playerDialogueClosed = false;

        while (!this.playerDialogueClosed) {
            const playerText = await this.waitForPlayerInput();
            if (this.playerDialogueClosed) break;

            this.activeSession!.history.push({ speaker: 'Player', text: playerText });
            this.callbacks.addDialogueMessage('Player', playerText);

            const npcResponse = await this.sendPlayerMessageToNpc(npc);
            if (this.playerDialogueClosed) break;

            if (npcResponse.type === 'say') {
                this.activeSession!.history.push({ speaker: npc.name, text: npcResponse.message });
                this.callbacks.addDialogueMessage(npc.name, npcResponse.message);
            } else {
                this.activeSession!.history.push({ speaker: npc.name, text: '[ended conversation]' });
                this.callbacks.addDialogueMessage(npc.name, '(has nothing more to say)');
            }
        }
    }

    /** Called by the dialogue UI when the player submits a message. */
    submitPlayerMessage(text: string): void {
        if (this.playerInputResolve) {
            this.playerInputResolve(text);
            this.playerInputResolve = null;
        }
    }

    /** Called when the player closes the dialogue box. */
    closePlayerDialogue(): void {
        this.playerDialogueClosed = true;
        // Resolve any pending input wait
        if (this.playerInputResolve) {
            this.playerInputResolve('');
            this.playerInputResolve = null;
        }
    }

    // ── Private helpers ─────────────────────────────────────

    private waitForPlayerInput(): Promise<string> {
        return new Promise(resolve => {
            this.playerInputResolve = resolve;
        });
    }

    private async sendPlayerMessageToNpc(npc: NPC): Promise<ConversationResponse> {
        const context = await this.buildNpcPromptContext(npc, this.activeSession!.turnNumber);
        return this.llm.converse(
            npc.name,
            context.worldState,
            context.memory,
            this.activeSession!.history,
            context.reflection,
        );
    }

    private async finishConversation(endedBy: string, playerInvolved = false): Promise<void> {
        if (!this.activeSession) return;

        const session = this.activeSession;
        const transcript = {
            partnerName: '',
            turnNumber: session.turnNumber,
            location: session.location,
            initiatedBy: session.initiator.name,
            messages: session.history,
            endedBy,
        };

        const entities = this.entityManager.getEntities();

        if (playerInvolved) {
            // Player involved: save to the NPC's log only (Player has no log)
            const npcName = session.initiator instanceof Player
                ? session.target.name
                : session.initiator.name;
            const npcLog = this.logs.get(npcName);
            if (npcLog) {
                npcLog.recordConversation({ ...transcript, partnerName: 'Player' });
            }
            // Extract goal for the NPC participant
            const npcEntity = session.initiator instanceof Player ? session.target : session.initiator;
            const goalMgr = this.goals.get(npcName);
            if (goalMgr) {
                const worldState = buildWorldState(npcEntity, entities, this.toolRegistry);
                const result = await extractGoal(npcName, session.history, worldState, goalMgr);
                await this.applyConversationGoalResult(npcName, npcEntity, result, session.turnNumber);
            }
        } else {
            // NPC-to-NPC: save to both logs and extract goals for both
            const initiatorLog = this.logs.get(session.initiator.name);
            const targetLog = this.logs.get(session.target.name);
            if (initiatorLog) {
                initiatorLog.recordConversation({ ...transcript, partnerName: session.target.name });
            }
            if (targetLog) {
                targetLog.recordConversation({ ...transcript, partnerName: session.initiator.name });
            }

            const initiatorGoals = this.goals.get(session.initiator.name);
            const targetGoals = this.goals.get(session.target.name);
            if (initiatorGoals) {
                const ws = buildWorldState(session.initiator, entities, this.toolRegistry);
                const result = await extractGoal(session.initiator.name, session.history, ws, initiatorGoals);
                await this.applyConversationGoalResult(session.initiator.name, session.initiator, result, session.turnNumber);
            }
            if (targetGoals) {
                const ws = buildWorldState(session.target, entities, this.toolRegistry);
                const result = await extractGoal(session.target.name, session.history, ws, targetGoals);
                await this.applyConversationGoalResult(session.target.name, session.target, result, session.turnNumber);
            }
        }

        this.callbacks.closeDialogue();
        this.activeSession = null;
    }

    private validate(
        initiator: Entity,
        targetName: string,
    ): { valid: boolean; error?: string; target?: Entity } {
        if (this.activeSession) {
            return { valid: false, error: 'Already in a conversation' };
        }

        const target = this.entityManager.getByName(targetName);
        if (!target) {
            return { valid: false, error: `Target "${targetName}" does not exist` };
        }

        if (target === initiator) {
            return { valid: false, error: 'Cannot start a conversation with yourself' };
        }

        if (!initiator.isAdjacentTo(target)) {
            return { valid: false, error: `${targetName} is not adjacent to ${initiator.name}` };
        }

        return { valid: true, target };
    }

    private async buildNpcPromptContext(npc: NPC, turnNumber: number): Promise<{
        worldState: string;
        memory: string | undefined;
        reflection: string | undefined;
    }> {
        const entities = this.entityManager.getEntities();
        const worldState = buildWorldState(npc, entities, this.toolRegistry);
        const memory = this.logs.get(npc.name)?.buildPromptContent(LOG_CHAR_BUDGET) || undefined;
        const goals = this.goals.get(npc.name)?.buildPromptContent() || '';
        const reflectionManager = this.reflections.get(npc.name);
        if (!reflectionManager) {
            return { worldState, memory, reflection: undefined };
        }

        await reflectionManager.refreshIfStale(turnNumber, worldState, memory ?? '', goals);
        return {
            worldState,
            memory,
            reflection: reflectionManager.buildPromptContent() || undefined,
        };
    }

    private async applyConversationGoalResult(
        npcName: string,
        npc: Entity,
        result: GoalExtractionResult,
        turnNumber: number,
    ): Promise<void> {
        const reflectionManager = this.reflections.get(npcName);
        if (!reflectionManager || !(npc instanceof NPC)) return;

        let detail = '';
        if (result.kind === 'activated') {
            detail = `Conversation created a new active goal: ${result.goal.goal}`;
        } else if (result.kind === 'pending') {
            detail = `Conversation created a pending goal: ${result.goal.goal}`;
        } else if (result.kind === 'completed') {
            detail = `Conversation resolved a goal: ${result.completedGoal}`;
            reflectionManager.markGoalCompleted(turnNumber, result.completedGoal);
        } else {
            return;
        }

        reflectionManager.markConversationGoalChange(turnNumber, detail);

        const context = await this.buildNpcPromptContext(npc, turnNumber);
        if (result.kind === 'completed') {
            await reflectionManager.generateCompletionLesson(
                turnNumber,
                result.completedGoal,
                context.memory ?? '',
                context.worldState,
            );
        }
        const goals = this.goals.get(npcName)?.buildPromptContent() || '';
        const refreshed = await reflectionManager.refreshIfStale(turnNumber, context.worldState, context.memory ?? '', goals);
        if (!refreshed) {
            await reflectionManager.save();
        }
    }
}
