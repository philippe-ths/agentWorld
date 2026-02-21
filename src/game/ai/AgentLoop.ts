import type { NPC } from '../entities/NPC';
import type { EntityManager } from '../entities/EntityManager';
import type { Observation, NearbyEntity, ReasoningResult } from './types';
import * as AgentClient from './AgentClient';
import { executeSkill, registerComposedSkill } from './SkillExecutor';
import { log as logEvent } from '../ui/EventLog';
import type { Goal, LLMUsage } from './types';

const BASE_TICK_INTERVAL = 15000;
const IDLE_TICK_INTERVAL = 60000;

// Stagger NPC starts so they don't all tick at the same time
const NPC_OFFSETS: Record<string, number> = { ada: 0, bjorn: 5000, cora: 10000 };

export class AgentLoop {
    private npc: NPC;
    private entityManager: EntityManager;
    private timeSinceLastTick: number;
    private pending = false;
    private paused = false;
    private tickCounter = 0;

    constructor(npc: NPC, entityManager: EntityManager) {
        this.npc = npc;
        this.entityManager = entityManager;
        // Stagger first tick per NPC to avoid rate limit bursts
        this.timeSinceLastTick = BASE_TICK_INTERVAL - (NPC_OFFSETS[npc.id] ?? 0);

        // When plan completes successfully, report outcome and request next tick
        this.npc.onPlanComplete = (hadFailure: boolean) => {
            if (this.npc.currentSkill) {
                AgentClient.reportSkillOutcome(this.npc.currentSkill, !hadFailure);
            }
            this.timeSinceLastTick = this.getCurrentTickInterval();
        };
    }

    pause() { this.paused = true; }
    resume() { this.paused = false; }

    restart() {
        this.paused = false;
        this.pending = false;
        this.timeSinceLastTick = BASE_TICK_INTERVAL - (NPC_OFFSETS[this.npc.id] ?? 0);
    }

    update(_time: number, delta: number) {
        if (this.paused) return;
        if (this.npc.isInConversation) return;
        if (this.pending) return;

        this.timeSinceLastTick += delta;
        const interval = this.getCurrentTickInterval();

        if (this.timeSinceLastTick >= interval && this.npc.currentPlan.length === 0) {
            this.timeSinceLastTick = 0;
            this.requestTick();
        }
    }

    private getCurrentTickInterval(): number {
        const activeGoal = this.npc.activeGoals.find(g => g.status === 'active');
        if (!activeGoal) return IDLE_TICK_INTERVAL;
        const priorityFactor = Math.max(0, Math.min(1, activeGoal.priority));
        return Math.max(7000, Math.round(BASE_TICK_INTERVAL * (1.25 - priorityFactor)));
    }

    private getEscalationBudget(goal: Goal): number {
        switch (goal.estimatedDifficulty ?? 'moderate') {
            case 'trivial': return 1;
            case 'simple': return 2;
            case 'moderate': return 3;
            case 'complex': return 5;
            default: return 3;
        }
    }

    private applyUsage(goal: Goal | undefined, usage: LLMUsage | undefined, modelKind: 'haiku' | 'sonnet') {
        if (!goal || !usage) return;
        goal.resources.totalTokensIn += usage.inputTokens;
        goal.resources.totalTokensOut += usage.outputTokens;
        goal.resources.estimatedCostUSD += usage.estimatedCostUSD;
        if (modelKind === 'haiku') goal.resources.haikuCalls++;
        if (modelKind === 'sonnet') goal.resources.sonnetCalls++;
    }

    private finalizeGoal(goal: Goal, status: 'completed' | 'abandoned' | 'failed') {
        goal.status = status;
        goal.resources.wallClockMs = Date.now() - goal.createdAt;
    }

    private isDiminishingReturns(goal: Goal): boolean {
        const history = goal.evaluation.evaluationHistory ?? [];
        if (history.length < 3) return false;
        const last3 = history.slice(-3);
        const min = Math.min(...last3);
        const max = Math.max(...last3);
        return max - min < 0.05;
    }

    private async requestTick() {
        this.pending = true;

        try {
            const observation = this.buildObservation();
            this.tickCounter++;

            for (const g of this.npc.activeGoals) {
                if (g.status === 'active') g.resources.mediumLoopTicks++;
            }

            // Log awareness: what the NPC sees right now
            const nearbyDesc = observation.nearbyEntities.length > 0
                ? observation.nearbyEntities.map(e => `${e.name} (${e.distance} tiles)`).join(', ')
                : 'nobody';
            logEvent(this.npc.name, 'awareness',
                `at (${observation.position.x},${observation.position.y}) | nearby: ${nearbyDesc}` +
                (observation.currentSkill ? ` | skill: ${observation.currentSkill}` : ' | idle'),
                {
                    npcId: this.npc.id,
                    metadata: {
                        position: observation.position,
                        nearbyEntities: observation.nearbyEntities,
                        currentSkill: observation.currentSkill,
                        stuckCount: this.npc.recentEvents.filter(e => e.includes('stuck')).length,
                    },
                },
            );

            // Periodic goal evaluation (every 3rd medium-loop tick)
            const activeGoal = this.npc.activeGoals.find(g => g.status === 'active');
            if (activeGoal && this.tickCounter % 3 === 0) {
                const tEval = performance.now();
                const evalResult = await AgentClient.evaluateGoal(this.npc.id, observation, activeGoal);
                const evalLatency = Math.round(performance.now() - tEval);

                activeGoal.evaluation.lastEvaluation = {
                    timestamp: evalResult.timestamp,
                    progressScore: evalResult.progressScore,
                    summary: evalResult.summary,
                    shouldEscalate: evalResult.shouldEscalate,
                };
                activeGoal.resources.evaluationCalls++;
                activeGoal.resources.apiLatencyMs += evalLatency;
                this.applyUsage(activeGoal, evalResult.llmUsage, 'haiku');
                activeGoal.evaluation.evaluationHistory = [
                    ...(activeGoal.evaluation.evaluationHistory ?? []),
                    evalResult.progressScore,
                ].slice(-8);

                logEvent(this.npc.name, 'thought',
                    `goal check: ${activeGoal.description} -> ${evalResult.summary} (score ${evalResult.progressScore.toFixed(2)})`,
                    { npcId: this.npc.id, metadata: { goalId: activeGoal.id, progress: evalResult.progressScore } },
                );

                if (evalResult.progressScore >= 0.95) {
                    this.finalizeGoal(activeGoal, 'completed');
                    this.npc.addEvent(`completed goal: ${activeGoal.description}`);
                }

                const diminishingReturns = this.isDiminishingReturns(activeGoal);
                if ((evalResult.shouldEscalate || diminishingReturns) && activeGoal.status === 'active') {
                    const budget = this.getEscalationBudget(activeGoal);
                    if (activeGoal.resources.sonnetCalls >= budget) {
                        this.finalizeGoal(activeGoal, 'abandoned');
                        this.npc.addEvent(`abandoned goal (budget exhausted): ${activeGoal.description}`);
                        logEvent(this.npc.name, 'system',
                            `goal abandoned after ${activeGoal.resources.sonnetCalls} sonnet calls (budget ${budget})`,
                            { npcId: this.npc.id, metadata: { goalId: activeGoal.id, budget } },
                        );
                        return;
                    }

                    this.npc.addEvent(`goal needs escalation: ${activeGoal.description}`);

                    const t0 = performance.now();
                    const reasonResult = await AgentClient.reasonGeneral(
                        this.npc.id,
                        observation,
                        { failedSkill: this.npc.currentSkill ?? undefined },
                    );
                    const latency = Math.round(performance.now() - t0);

                    activeGoal.resources.apiLatencyMs += latency;
                    this.applyUsage(activeGoal, reasonResult.llmUsage, 'sonnet');

                    logEvent(this.npc.name, 'llm-call',
                        `slow loop (goal escalation) — ${latency}ms`,
                        { npcId: this.npc.id, metadata: { model: 'claude-sonnet-4', latency, goalId: activeGoal.id } },
                    );

                    this.handleReasoningResult(reasonResult);
                    return;
                }
            }

            // Escalate to slow loop if repeatedly stuck
            if (this.shouldEscalateToReasoning()) {
                const stuckCount = this.npc.recentEvents.filter(e => e.includes('stuck')).length;
                this.npc.addEvent('escalating to reasoning (stuck)');

                const t0 = performance.now();
                const reasonResult = await AgentClient.reasonGeneral(
                    this.npc.id,
                    observation,
                    { stuckCount, failedSkill: this.npc.currentSkill ?? undefined },
                );
                const latency = Math.round(performance.now() - t0);

                const activeGoalForReasoning = this.npc.activeGoals.find(g => g.status === 'active');
                if (activeGoalForReasoning) {
                    activeGoalForReasoning.resources.apiLatencyMs += latency;
                    this.applyUsage(activeGoalForReasoning, reasonResult.llmUsage, 'sonnet');
                }

                logEvent(this.npc.name, 'llm-call',
                    `slow loop (reasoning) — ${latency}ms`,
                    { npcId: this.npc.id, metadata: { model: 'claude-sonnet-4', latency, escalated: true } },
                );

                this.handleReasoningResult(reasonResult);

                // Report the failure for self-critique
                const failureEvents = this.npc.recentEvents.filter(e => e.includes('stuck'));
                AgentClient.reportFailure(
                    this.npc.id, failureEvents,
                    this.npc.currentSkill ?? undefined, stuckCount,
                    activeGoalForReasoning?.description,
                    activeGoalForReasoning ? `${activeGoalForReasoning.type}:${activeGoalForReasoning.description.toLowerCase()}` : undefined,
                    activeGoalForReasoning?.evaluation.successCriteria,
                    'stuck while executing plan',
                    activeGoalForReasoning
                        ? `haiku=${activeGoalForReasoning.resources.haikuCalls}, sonnet=${activeGoalForReasoning.resources.sonnetCalls}, cost=$${activeGoalForReasoning.resources.estimatedCostUSD.toFixed(4)}`
                        : undefined,
                );

                this.clearStuckEvents();
            } else {
                const t0 = performance.now();
                const result = await AgentClient.tick(observation);
                const latency = Math.round(performance.now() - t0);

                const activeGoalForCost = this.npc.activeGoals.find(g => g.status === 'active');
                if (activeGoalForCost) {
                    activeGoalForCost.resources.apiLatencyMs += latency;
                    this.applyUsage(activeGoalForCost, result.llmUsage, 'haiku');
                }

                logEvent(this.npc.name, 'llm-call',
                    `medium loop (tick) — ${latency}ms`,
                    { npcId: this.npc.id, metadata: { model: 'claude-haiku-4.5', latency } },
                );

                if (result.reasoning) {
                    logEvent(this.npc.name, 'thought', result.reasoning, { npcId: this.npc.id });
                }

                this.npc.currentSkill = result.skill;
                logEvent(this.npc.name, 'skill-selection',
                    `${result.skill}${Object.keys(result.params).length ? ' — ' + JSON.stringify(result.params) : ''}`,
                    { npcId: this.npc.id, metadata: { skill: result.skill, params: result.params } },
                );

                if (result.escalate && result.skill === 'converse') {
                    this.npc.addEvent('wants to converse');
                    const nearby = observation.nearbyEntities[0];
                    if (nearby) {
                        const event = new CustomEvent('npc-wants-converse', {
                            detail: { npcId: this.npc.id, targetName: nearby.name },
                        });
                        window.dispatchEvent(event);
                    }
                } else {
                    const actions = executeSkill(this.npc, result.skill, result.params, this.entityManager);
                    this.npc.setPlan(actions);
                }
            }
        } catch (err) {
            console.error(`[AgentLoop] Error for ${this.npc.id}:`, err);
            logEvent(this.npc.name, 'system', `tick error: ${err}`, { npcId: this.npc.id });
            this.npc.setPlan([{ type: 'wait', duration: 3000 }]);
        } finally {
            this.pending = false;
        }
    }

    private shouldEscalateToReasoning(): boolean {
        return this.npc.recentEvents.filter(e => e.includes('stuck')).length >= 3;
    }

    private clearStuckEvents() {
        this.npc.recentEvents = this.npc.recentEvents.filter(e => !e.includes('stuck'));
    }

    private handleReasoningResult(result: ReasoningResult) {
        // Register any new composed skill for client-side execution
        if (result.newSkill?.steps && result.newSkill.steps.length > 0) {
            registerComposedSkill(result.newSkill.name, result.newSkill.steps);
            this.npc.addEvent(`learned new skill: ${result.newSkill.name}`);
        }

        if (result.actions && result.actions.length > 0) {
            this.npc.setPlan(result.actions);
            this.npc.addEvent('received plan from reasoning');
        } else if (result.dialogue) {
            this.npc.say(result.dialogue);
            this.npc.addEvent(`thought aloud: "${result.dialogue}"`);
            this.npc.setPlan([{ type: 'wait', duration: 3000 }]);
        } else {
            this.npc.setPlan([{ type: 'wait', duration: 3000 }]);
        }
    }

    private buildObservation(): Observation {
        const nearby: NearbyEntity[] = [];
        const allEntities = this.entityManager.getEntitiesNear(
            this.npc.tilePos.x, this.npc.tilePos.y, 15,
        );

        for (const entity of allEntities) {
            if (entity === this.npc) continue;
            const dx = entity.tilePos.x - this.npc.tilePos.x;
            const dy = entity.tilePos.y - this.npc.tilePos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            nearby.push({
                id: entity.name.toLowerCase().replace(/\s+/g, '_'),
                name: entity.name,
                position: { ...entity.tilePos },
                distance: Math.round(distance),
            });
        }

        nearby.sort((a, b) => a.distance - b.distance);

        return {
            npcId: this.npc.id,
            name: this.npc.name,
            position: { ...this.npc.tilePos },
            nearbyEntities: nearby,
            isInConversation: this.npc.isInConversation,
            currentSkill: this.npc.currentSkill,
            recentEvents: [...this.npc.recentEvents],
            activeGoals: this.npc.activeGoals.map(g => ({ ...g })),
        };
    }
}
