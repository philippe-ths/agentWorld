import { HeadlessEntity, HeadlessNPC } from './HeadlessEntity';
import { HeadlessEntityManager } from './HeadlessEntityManager';
import { HeadlessDirectiveExecutor } from './HeadlessDirectiveExecutor';
import { AbortMonitor } from './AbortMonitor';
import { TestScenario, ScenarioResult, EvalGameState, TestOutcome } from './types';
import { ChronologicalLog } from '../game/ChronologicalLog';
import { GoalManager } from '../game/GoalManager';
import { ReflectionManager } from '../game/ReflectionManager';
import { LLMService } from '../game/LLMService';
import { buildWorldState } from '../game/WorldState';
import { ToolRegistry } from '../game/ToolRegistry';
import { parseDirectives, Directive, repairDirectiveOutput, validateDirectiveOutput } from '../game/DirectiveParser';
import {
    NPCS, PLAYER_SPAWN, BUILDINGS,
    SUMMARIZE_EVERY_N_TURNS, REFLECTION_EVERY_N_TURNS,
    UNKNOWN_DIRECTIVE_TRIGGER_THRESHOLD, OUTPUT_GUARD_REPROMPT_ATTEMPTS,
    LOG_CHAR_BUDGET, NPC_COMMANDS_PER_TURN, SLEEP_TURNS,
    isFeatureEnabled,
} from '../game/GameConfig';

/**
 * Runs a single evaluation scenario headlessly (no Phaser).
 * Replicates the TurnManager's NPC turn loop with monitoring for success/abort/fail.
 */
export async function runScenario(scenario: TestScenario): Promise<ScenarioResult> {
    // ── Setup ────────────────────────────────────────────────

    const toolRegistry = createToolRegistry();
    const entityManager = new HeadlessEntityManager();
    entityManager.setToolRegistry(toolRegistry);

    // Create player
    const player = new HeadlessEntity('Player', PLAYER_SPAWN);
    entityManager.add(player);

    // Create NPCs
    const npcs: HeadlessNPC[] = [];
    for (const def of NPCS) {
        const npc = new HeadlessNPC(
            def.name,
            def.tile,
            entityManager.isWalkable,
            entityManager.isTerrainWalkable,
        );
        entityManager.add(npc);
        npcs.push(npc);
    }

    const executor = new HeadlessDirectiveExecutor(toolRegistry, entityManager);
    const llm = new LLMService();
    const abortMonitor = new AbortMonitor();

    // Load persisted state
    const logs = new Map<string, ChronologicalLog>();
    const goals = new Map<string, GoalManager>();
    const reflections = new Map<string, ReflectionManager>();
    const sleepUntil = new Map<string, number>();

    for (const npc of npcs) {
        const log = new ChronologicalLog(npc.name);
        await log.load();
        logs.set(npc.name, log);

        if (isFeatureEnabled('goals')) {
            const goalMgr = new GoalManager(npc.name);
            await goalMgr.load();
            goals.set(npc.name, goalMgr);
        }

        if (isFeatureEnabled('reflection')) {
            const reflMgr = new ReflectionManager(npc.name);
            await reflMgr.load();
            reflections.set(npc.name, reflMgr);
        }
    }

    // Resume turn counter from persisted logs
    let turnNumber = 0;
    for (const log of logs.values()) {
        const last = log.getLastTurnNumber();
        if (last > turnNumber) turnNumber = last;
    }

    let targetNpcTurnsTaken = 0;

    // ── Turn loop ────────────────────────────────────────────

    for (let globalTurn = 1; globalTurn <= scenario.maxGlobalTurns; globalTurn++) {
        turnNumber++;

        for (const npc of npcs) {
            const isTarget = npc.name === scenario.targetNpc;

            // Sleep check
            const wakeAt = sleepUntil.get(npc.name);
            if (wakeAt !== undefined && turnNumber < wakeAt) {
                console.log(`[eval] ${npc.name} sleeping (${wakeAt - turnNumber} turns left)`);
                continue;
            }
            if (wakeAt !== undefined) {
                sleepUntil.delete(npc.name);
                npc.sleeping = false;
                const log = logs.get(npc.name)!;
                log.recordAction(`I woke up (turn ${turnNumber})`);
            }

            await runNpcTurn(
                npc, turnNumber, entityManager, toolRegistry, executor, llm,
                logs, goals, reflections, sleepUntil, isTarget ? abortMonitor : null,
            );

            if (isTarget) targetNpcTurnsTaken++;
        }

        // ── Post-turn evaluation (priority: success > abort > fail) ──

        const evalState: EvalGameState = {
            npcPositions: new Map(npcs.map(n => [n.name, { ...n.tilePos }])),
            globalTurnsElapsed: globalTurn,
            targetNpcTurnsTaken,
        };

        // 1. Success
        if (scenario.checkSuccess(evalState)) {
            return buildResult(scenario, 'SUCCESS', globalTurn, targetNpcTurnsTaken, null);
        }

        // 2. Abort — default rules
        const defaultAbort = abortMonitor.checkDefaultAborts();
        if (defaultAbort) {
            return buildResult(scenario, 'ABORTED', globalTurn, targetNpcTurnsTaken, defaultAbort.reason);
        }

        // 2b. Abort — scenario-specific rules
        if (scenario.checkAbort) {
            const scenarioAbort = scenario.checkAbort(evalState);
            if (scenarioAbort) {
                return buildResult(scenario, 'ABORTED', globalTurn, targetNpcTurnsTaken, scenarioAbort.reason);
            }
        }
    }

    // 3. Fail — max turns reached
    return buildResult(scenario, 'FAIL', scenario.maxGlobalTurns, targetNpcTurnsTaken, 'max turns reached');
}

// ── Per-NPC turn (mirrors TurnManager.runNpcTurn) ────────────

async function runNpcTurn(
    npc: HeadlessNPC,
    turnNumber: number,
    entityManager: HeadlessEntityManager,
    toolRegistry: ToolRegistry,
    executor: HeadlessDirectiveExecutor,
    llm: LLMService,
    logs: Map<string, ChronologicalLog>,
    goals: Map<string, GoalManager>,
    reflections: Map<string, ReflectionManager>,
    sleepUntil: Map<string, number>,
    abortMonitor: AbortMonitor | null,
): Promise<void> {
    const log = logs.get(npc.name)!;
    const goalManager = goals.get(npc.name);
    const reflectionManager = reflections.get(npc.name);
    const entities = entityManager.getEntities();

    // Record observations
    log.startTurn(
        turnNumber,
        npc.tilePos,
        entities.map(e => ({ name: e.name, tilePos: e.tilePos })),
    );

    let directives: Directive[];
    let worldState = '';
    let memory = '';
    let goalsContent = '';
    let reflectionContent = '';

    try {
        worldState = buildWorldState(npc, entities, toolRegistry);
        memory = log.buildPromptContent(LOG_CHAR_BUDGET);
        if (goalManager) goalsContent = goalManager.buildPromptContent();
        if (reflectionManager) {
            reflectionManager.markPeriodicStale(turnNumber, REFLECTION_EVERY_N_TURNS);
            await reflectionManager.refreshIfStale(turnNumber, worldState, memory, goalsContent);
            reflectionContent = reflectionManager.buildPromptContent();
        }

        const response = await llm.decide(
            npc.name,
            worldState,
            memory || undefined,
            goalsContent || undefined,
            reflectionContent || undefined,
        );

        const guarded = await enforceOutputGuard(
            npc.name, response, worldState, memory, goalsContent, reflectionContent,
            reflectionManager, log, llm, turnNumber, abortMonitor,
        );

        if (reflectionManager && guarded.unknownCountFromRaw >= UNKNOWN_DIRECTIVE_TRIGGER_THRESHOLD) {
            reflectionManager.markUnknownDirectiveFlood(turnNumber, guarded.unknownCountFromRaw);
            await reflectionManager.refreshIfStale(turnNumber, worldState, memory, goalsContent);
        }

        if (guarded.reasoning) {
            log.recordAction(`Reasoning: ${guarded.reasoning}`);
        }

        directives = parseDirectives(guarded.cleanedResponse);

        for (const line of guarded.cleanedResponse.split('\n')) {
            const trimmed = line.trim();
            if (trimmed) log.recordAction(trimmed);
        }
    } catch (err) {
        const msg = (err as Error).message;
        console.error(`[eval] LLM failed for ${npc.name}: ${msg}`);
        log.recordAction(`My action failed because my response wasn't understood: ${msg}`);
        reflectionManager?.recordEvent({
            turnNumber,
            kind: 'failure',
            summary: `Decision failed: ${msg}`,
            obstacleKey: `llm_error:${msg}`,
        });
        directives = [{ type: 'wait' }];
    }

    // Separate goal directives from action directives
    const goalDirectives = directives.filter(d =>
        d.type === 'complete_goal' || d.type === 'abandon_goal' || d.type === 'switch_goal',
    );
    const actionDirectives = directives.filter(d =>
        d.type !== 'complete_goal' && d.type !== 'abandon_goal' && d.type !== 'switch_goal',
    );

    // Execute goal directives (instant, no budget cost)
    if (goalManager) {
        for (const dir of goalDirectives) {
            const result = await executor.executeGoal(npc.name, dir, log, goalManager);
            if (!result) continue;
            if (result.type === 'completed_goal') {
                reflectionManager?.markGoalCompleted(turnNumber, result.goal);
                await reflectionManager?.generateCompletionLesson(turnNumber, result.goal, memory, worldState);
            } else if (result.type === 'abandoned_goal') {
                reflectionManager?.markGoalAbandoned(turnNumber, result.goal);
            } else if (result.type === 'switched_goal') {
                reflectionManager?.markGoalSwitched(turnNumber, result.oldGoal, result.newGoal);
            }
        }
    }

    // Execute action directives (capped)
    const capped = actionDirectives.slice(0, NPC_COMMANDS_PER_TURN);

    for (const dir of capped) {
        if (dir.type === 'unknown') {
            log.recordAction(`→ unknown command: "${dir.line}"`);
            continue;
        }

        // Skip function-building directives in eval mode
        if (dir.type === 'create_function' || dir.type === 'update_function' || dir.type === 'delete_function') {
            log.recordAction(`→ ${dir.type} skipped (eval mode)`);
            continue;
        }

        try {
            const result = await executor.executeAction(npc, dir, log, turnNumber);
            if (result.reflectionEvent) {
                reflectionManager?.recordEvent(result.reflectionEvent);

                // Feed abort monitor for target NPC
                if (abortMonitor) {
                    if (result.reflectionEvent.kind === 'failure' && result.reflectionEvent.obstacleKey) {
                        abortMonitor.recordFailedAction(
                            dir.type,
                            'target' in dir ? (dir as { target?: string }).target : undefined,
                            result.reflectionEvent.obstacleKey,
                        );
                    } else if (result.reflectionEvent.kind === 'success') {
                        abortMonitor.recordSuccess();
                    }
                }
            }
            if (result.shouldStop) break;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[eval] Action error for ${npc.name}: ${msg}`);
            log.recordAction(`My action '${dir.type}' failed with an exception: ${msg}`);
            reflectionManager?.recordEvent({
                turnNumber,
                kind: 'failure',
                summary: `Action ${dir.type} threw an exception`,
                obstacleKey: `action_exception:${dir.type}`,
            });
            break;
        }
    }

    // Sleep handling
    if (actionDirectives.some(d => d.type === 'sleep')) {
        if (goalManager?.getActiveGoal()) {
            log.recordAction('→ sleep rejected: has active goal');
        } else {
            sleepUntil.set(npc.name, turnNumber + SLEEP_TURNS);
            npc.sleeping = true;
            log.recordAction(`Entered sleep mode (will wake at turn ${turnNumber + SLEEP_TURNS})`);
        }
    }

    // Persist
    await log.save();
    if (isFeatureEnabled('logSummarization')) await log.maybeSummarize(SUMMARIZE_EVERY_N_TURNS);
    if (goalManager) await goalManager.save();
    if (reflectionManager) await reflectionManager.save();
}

// ── Output guard (mirrors TurnManager.enforceOutputGuard) ────

interface GuardedDecision {
    cleanedResponse: string;
    unknownCountFromRaw: number;
    reasoning?: string;
}

async function enforceOutputGuard(
    npcName: string,
    rawResponse: string,
    worldState: string,
    memory: string,
    goalsText: string,
    reflectionText: string,
    reflectionManager: ReflectionManager | undefined,
    log: ChronologicalLog,
    llm: LLMService,
    turnNumber: number,
    abortMonitor: AbortMonitor | null,
): Promise<GuardedDecision> {
    const parsedRaw = parseDirectives(rawResponse);
    const unknownCountFromRaw = parsedRaw.filter(d => d.type === 'unknown').length;

    let candidate = rawResponse;
    let reasoning: string | undefined;

    for (let attempt = 0; attempt <= OUTPUT_GUARD_REPROMPT_ATTEMPTS; attempt++) {
        const repaired = repairDirectiveOutput(candidate);
        const validation = validateDirectiveOutput(repaired.cleanedText);

        if (repaired.reasoning) reasoning = repaired.reasoning;

        if (repaired.removedLines.length > 0) {
            reflectionManager?.recordOutputFormatFailure(
                turnNumber,
                'output_format:non_command_lines',
                `Removed ${repaired.removedLines.length} non-command lines before execution`,
            );
        }

        if (validation.isValid) {
            return { cleanedResponse: repaired.cleanedText, unknownCountFromRaw, reasoning };
        }

        const failureKey = validation.failureKey ?? 'output_format:invalid_response';
        const reason = validation.reason ?? 'Directive output failed validation.';
        reflectionManager?.recordOutputFormatFailure(turnNumber, failureKey, reason);

        if (attempt >= OUTPUT_GUARD_REPROMPT_ATTEMPTS) {
            log.recordAction(`My output format was invalid and execution was guarded: ${reason}`);
            abortMonitor?.recordInvalidOutput();
            return { cleanedResponse: 'wait()', unknownCountFromRaw, reasoning };
        }

        candidate = await llm.decide(
            npcName,
            worldState,
            memory || undefined,
            goalsText || undefined,
            reflectionText || undefined,
            `Your previous output failed strict validation. ${reason} Respond in EXACTLY this format:\nREASONING: one short sentence explaining your plan.\nACTIONS:\n<commands, one per line>`,
        );
    }

    // Unreachable: loop always returns. Keep as safety net.
    return { cleanedResponse: 'wait()', unknownCountFromRaw, reasoning };
}

// ── Tool registry (static buildings only, no function-buildings) ──

function createToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();

    for (const def of BUILDINGS) {
        // Register no-op handlers — eval doesn't use search terminal or code forge
        registry.registerHandler(def.handler, async (_args: string) => {
            return `[eval] Tool "${def.id}" not available in evaluation mode`;
        });
        registry.registerFromConfig(def);
    }

    return registry;
}

// ── Helper ───────────────────────────────────────────────────

function buildResult(
    scenario: TestScenario,
    result: TestOutcome,
    globalTurnsElapsed: number,
    npcTurnsTaken: number,
    failureReason: string | null,
): ScenarioResult {
    return {
        scenarioId: scenario.id,
        targetNpc: scenario.targetNpc,
        result,
        globalTurnsElapsed,
        npcTurnsTaken,
        failureReason,
        maxGlobalTurns: scenario.maxGlobalTurns,
        timestamp: new Date().toISOString(),
    };
}
