import { HeadlessEntity, HeadlessNPC } from './HeadlessEntity';
import { HeadlessEntityManager } from './HeadlessEntityManager';
import { LLMService, ConversationMessage } from '../game/LLMService';
import { ChronologicalLog } from '../game/ChronologicalLog';
import { GoalManager } from '../game/GoalManager';
import { ReflectionManager } from '../game/ReflectionManager';
import { extractGoal, GoalExtractionResult } from '../game/GoalExtractor';
import { buildWorldState } from '../game/WorldState';
import { ToolRegistry } from '../game/ToolRegistry';
import { LOG_CHAR_BUDGET, MAX_EXCHANGES, isFeatureEnabled } from '../game/GameConfig';

interface ConversationSession {
    initiator: HeadlessEntity;
    target: HeadlessEntity;
    history: ConversationMessage[];
    turnNumber: number;
    location: { x: number; y: number };
}

/**
 * Headless NPC-to-NPC conversation manager.
 * Mirrors ConversationManager's NPC conversation loop without Phaser/UI dependencies.
 */
export class HeadlessConversationManager {
    private entityManager: HeadlessEntityManager;
    private llm: LLMService;
    private logs: Map<string, ChronologicalLog>;
    private goals: Map<string, GoalManager>;
    private reflections: Map<string, ReflectionManager>;
    private toolRegistry: ToolRegistry;

    /** Called when an NPC becomes a conversation target (wakes sleeping NPCs). */
    onNpcEngaged: ((npcName: string) => void) | null = null;

    constructor(
        entityManager: HeadlessEntityManager,
        llm: LLMService,
        logs: Map<string, ChronologicalLog>,
        goals: Map<string, GoalManager>,
        reflections: Map<string, ReflectionManager>,
        toolRegistry: ToolRegistry,
    ) {
        this.entityManager = entityManager;
        this.llm = llm;
        this.logs = logs;
        this.goals = goals;
        this.reflections = reflections;
        this.toolRegistry = toolRegistry;
    }

    async startNpcConversation(
        initiator: HeadlessNPC,
        targetName: string,
        openingMessage: string,
        turnNumber: number,
    ): Promise<{ success: boolean; error?: string }> {
        const target = this.entityManager.getByName(targetName);
        if (!target) {
            return { success: false, error: `Target "${targetName}" does not exist` };
        }
        if (target === initiator) {
            return { success: false, error: 'Cannot start a conversation with yourself' };
        }
        if (target.name === 'Player') {
            return { success: false, error: 'Player conversations not supported in headless mode' };
        }
        if (!initiator.isAdjacentTo(target)) {
            return { success: false, error: `${targetName} is not adjacent to ${initiator.name}` };
        }

        // Wake target if sleeping
        this.onNpcEngaged?.(target.name);

        const session: ConversationSession = {
            initiator,
            target,
            history: [],
            turnNumber,
            location: { ...initiator.tilePos },
        };

        // Opening message from initiator
        session.history.push({ speaker: initiator.name, text: openingMessage });
        console.log(`[eval] ${initiator.name} → ${target.name}: "${openingMessage}"`);

        // Target responds
        const targetContext = await this.buildPromptContext(target, turnNumber);
        const targetResponse = await this.llm.converse(
            target.name,
            targetContext.worldState,
            targetContext.memory,
            session.history,
            targetContext.reflection,
        );

        let exchangeCount = 1;

        if (targetResponse.type === 'say') {
            session.history.push({ speaker: target.name, text: targetResponse.message });
            console.log(`[eval] ${target.name} → ${initiator.name}: "${targetResponse.message}"`);
            exchangeCount++;
        } else {
            await this.finishConversation(session, target.name);
            return { success: true };
        }

        // Alternate back and forth
        while (exchangeCount < MAX_EXCHANGES) {
            // Initiator's turn
            const initiatorCtx = await this.buildPromptContext(initiator, turnNumber);
            const initiatorResponse = await this.llm.converse(
                initiator.name,
                initiatorCtx.worldState,
                initiatorCtx.memory,
                session.history,
                initiatorCtx.reflection,
            );

            if (initiatorResponse.type === 'say') {
                session.history.push({ speaker: initiator.name, text: initiatorResponse.message });
                console.log(`[eval] ${initiator.name} → ${target.name}: "${initiatorResponse.message}"`);
                exchangeCount++;
            } else {
                await this.finishConversation(session, initiator.name);
                return { success: true };
            }

            if (exchangeCount >= MAX_EXCHANGES) break;

            // Target's turn
            const targetCtx2 = await this.buildPromptContext(target, turnNumber);
            const targetResponse2 = await this.llm.converse(
                target.name,
                targetCtx2.worldState,
                targetCtx2.memory,
                session.history,
                targetCtx2.reflection,
            );

            if (targetResponse2.type === 'say') {
                session.history.push({ speaker: target.name, text: targetResponse2.message });
                console.log(`[eval] ${target.name} → ${initiator.name}: "${targetResponse2.message}"`);
                exchangeCount++;
            } else {
                await this.finishConversation(session, target.name);
                return { success: true };
            }
        }

        // Hit exchange cap
        await this.finishConversation(session, 'exchange limit');
        return { success: true };
    }

    private async finishConversation(session: ConversationSession, endedBy: string): Promise<void> {
        const transcript = {
            partnerName: '',
            turnNumber: session.turnNumber,
            location: session.location,
            initiatedBy: session.initiator.name,
            messages: session.history,
            endedBy,
        };

        // Record to both NPCs' logs
        const initiatorLog = this.logs.get(session.initiator.name);
        const targetLog = this.logs.get(session.target.name);
        if (initiatorLog) {
            initiatorLog.recordConversation({ ...transcript, partnerName: session.target.name });
        }
        if (targetLog) {
            targetLog.recordConversation({ ...transcript, partnerName: session.initiator.name });
        }

        console.log(`[eval] Conversation between ${session.initiator.name} and ${session.target.name} ended (by: ${endedBy}, ${session.history.length} messages)`);

        // Extract goals for both NPCs
        if (isFeatureEnabled('goals')) {
            const entities = this.entityManager.getEntities();

            const initiatorGoals = this.goals.get(session.initiator.name);
            if (initiatorGoals) {
                const ws = buildWorldState(session.initiator, entities, this.toolRegistry);
                const result = await extractGoal(session.initiator.name, session.history, ws, initiatorGoals);
                await this.applyGoalResult(session.initiator.name, result, session.turnNumber);
            }

            const targetGoals = this.goals.get(session.target.name);
            if (targetGoals) {
                const ws = buildWorldState(session.target, entities, this.toolRegistry);
                const result = await extractGoal(session.target.name, session.history, ws, targetGoals);
                await this.applyGoalResult(session.target.name, result, session.turnNumber);
            }
        }
    }

    private async applyGoalResult(
        npcName: string,
        result: GoalExtractionResult,
        turnNumber: number,
    ): Promise<void> {
        if (!isFeatureEnabled('reflection')) return;

        const reflectionManager = this.reflections.get(npcName);
        if (!reflectionManager) return;

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

        const entity = this.entityManager.getByName(npcName);
        if (!entity) return;

        const entities = this.entityManager.getEntities();
        const worldState = buildWorldState(entity, entities, this.toolRegistry);
        const memory = this.logs.get(npcName)?.buildPromptContent(LOG_CHAR_BUDGET) || '';
        const goalsText = this.goals.get(npcName)?.buildPromptContent() || '';

        if (result.kind === 'completed') {
            await reflectionManager.generateCompletionLesson(turnNumber, result.completedGoal, memory, worldState);
        }

        const refreshed = await reflectionManager.refreshIfStale(turnNumber, worldState, memory, goalsText);
        if (!refreshed) {
            await reflectionManager.save();
        }
    }

    private async buildPromptContext(entity: HeadlessEntity, turnNumber: number): Promise<{
        worldState: string;
        memory: string | undefined;
        reflection: string | undefined;
    }> {
        const entities = this.entityManager.getEntities();
        const worldState = buildWorldState(entity, entities, this.toolRegistry);
        const memory = this.logs.get(entity.name)?.buildPromptContent(LOG_CHAR_BUDGET) || undefined;
        const goalsText = this.goals.get(entity.name)?.buildPromptContent() || '';
        const reflectionManager = this.reflections.get(entity.name);
        if (!reflectionManager) {
            return { worldState, memory, reflection: undefined };
        }

        await reflectionManager.refreshIfStale(turnNumber, worldState, memory ?? '', goalsText);
        return {
            worldState,
            memory,
            reflection: reflectionManager.buildPromptContent() || undefined,
        };
    }
}
