import type { NPC } from '../entities/NPC';
import type { EntityManager } from '../entities/EntityManager';
import type { Observation, NearbyEntity, ReasoningResult } from './types';
import * as AgentClient from './AgentClient';
import { executeSkill, registerComposedSkill } from './SkillExecutor';
import { log as logEvent } from '../ui/EventLog';
import type { Goal, LLMUsage, PlanStep } from './types';

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

    private static readonly DIFFICULTY_TIERS: Array<'trivial' | 'simple' | 'moderate' | 'complex'> = [
        'trivial', 'simple', 'moderate', 'complex',
    ];

    private upgradeDifficulty(goal: Goal): boolean {
        const current = goal.estimatedDifficulty ?? 'moderate';
        const idx = AgentLoop.DIFFICULTY_TIERS.indexOf(current);
        if (idx < AgentLoop.DIFFICULTY_TIERS.length - 1) {
            goal.estimatedDifficulty = AgentLoop.DIFFICULTY_TIERS[idx + 1];
            return true;
        }
        return false;
    }

    private isScoreImproving(goal: Goal): boolean {
        const history = goal.evaluation.evaluationHistory ?? [];
        if (history.length < 2) return false;
        return history[history.length - 1] - history[history.length - 2] >= 0.15;
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

                this.handleReasoningResult(reasonResult, activeGoalForReasoning);

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

                // Process inline goal evaluation from combined tick+eval response
                if (result.goalEvaluation && activeGoalForCost && activeGoalForCost.status === 'active') {
                    const evalResult = result.goalEvaluation;

                    activeGoalForCost.evaluation.lastEvaluation = {
                        timestamp: evalResult.timestamp,
                        progressScore: evalResult.progressScore,
                        summary: evalResult.summary,
                        shouldEscalate: evalResult.shouldEscalate,
                        gapAnalysis: evalResult.gapAnalysis,
                    };
                    activeGoalForCost.resources.evaluationCalls++;
                    activeGoalForCost.evaluation.evaluationHistory = [
                        ...(activeGoalForCost.evaluation.evaluationHistory ?? []),
                        evalResult.progressScore,
                    ].slice(-8);

                    logEvent(this.npc.name, 'thought',
                        `goal check: ${activeGoalForCost.description} -> ${evalResult.summary} (score ${evalResult.progressScore.toFixed(2)})`,
                        { npcId: this.npc.id, metadata: { goalId: activeGoalForCost.id, progress: evalResult.progressScore } },
                    );

                    if (evalResult.progressScore >= 0.95) {
                        this.finalizeGoal(activeGoalForCost, 'completed');
                        this.npc.addEvent(`completed goal: ${activeGoalForCost.description}`);
                    }

                    const diminishingReturns = this.isDiminishingReturns(activeGoalForCost);
                    if ((evalResult.shouldEscalate || diminishingReturns) && activeGoalForCost.status === 'active') {
                        const budget = this.getEscalationBudget(activeGoalForCost);
                        const unproductive = activeGoalForCost.resources.unproductiveEscalations ?? 0;
                        if (unproductive >= budget) {
                            if (this.isScoreImproving(activeGoalForCost) && this.upgradeDifficulty(activeGoalForCost)) {
                                logEvent(this.npc.name, 'system',
                                    `goal difficulty upgraded to ${activeGoalForCost.estimatedDifficulty}, budget extended`,
                                    { npcId: this.npc.id, metadata: { goalId: activeGoalForCost.id } },
                                );
                            } else if (
                                evalResult.progressScore >= 0.5 &&
                                this.isScoreImproving(activeGoalForCost) &&
                                !activeGoalForCost.resources.runwayUsed
                            ) {
                                activeGoalForCost.resources.runwayUsed = true;
                                logEvent(this.npc.name, 'system',
                                    `goal runway granted (progress ${evalResult.progressScore.toFixed(2)}, improving)`,
                                    { npcId: this.npc.id, metadata: { goalId: activeGoalForCost.id } },
                                );
                            } else {
                                this.finalizeGoal(activeGoalForCost, 'abandoned');
                                this.npc.addEvent(`abandoned goal (budget exhausted): ${activeGoalForCost.description}`);
                                logEvent(this.npc.name, 'system',
                                    `goal abandoned after ${unproductive} unproductive escalations (budget ${budget})`,
                                    { npcId: this.npc.id, metadata: { goalId: activeGoalForCost.id, budget } },
                                );
                                return;
                            }
                        }

                        this.npc.addEvent(`goal needs escalation: ${activeGoalForCost.description}`);

                        const tEsc = performance.now();
                        const reasonResult = await AgentClient.reasonGeneral(
                            this.npc.id,
                            observation,
                            { failedSkill: this.npc.currentSkill ?? undefined },
                        );
                        const escLatency = Math.round(performance.now() - tEsc);

                        activeGoalForCost.resources.apiLatencyMs += escLatency;
                        this.applyUsage(activeGoalForCost, reasonResult.llmUsage, 'sonnet');

                        logEvent(this.npc.name, 'llm-call',
                            `slow loop (goal escalation) — ${escLatency}ms`,
                            { npcId: this.npc.id, metadata: { model: 'claude-sonnet-4', latency: escLatency, goalId: activeGoalForCost.id } },
                        );

                        this.handleReasoningResult(reasonResult, activeGoalForCost);
                        return;
                    }
                }

                if (result.reasoning) {
                    logEvent(this.npc.name, 'thought', result.reasoning, { npcId: this.npc.id });
                }

                this.npc.currentSkill = result.skill;
                logEvent(this.npc.name, 'skill-selection',
                    `${result.skill}${Object.keys(result.params).length ? ' — ' + JSON.stringify(result.params) : ''}`,
                    { npcId: this.npc.id, metadata: { skill: result.skill, params: result.params } },
                );

                if (result.escalate && result.skill === 'converse') {
                    // D2: Conversation priority ceiling — only converse if goal-relevant or no high-priority goal
                    const topGoal = this.npc.activeGoals.find(g => g.status === 'active');
                    const nearby = observation.nearbyEntities[0];
                    if (topGoal && topGoal.priority >= 0.7 && nearby) {
                        const goalText = (topGoal.description + ' ' + (topGoal.evaluation.lastEvaluation?.gapAnalysis ?? '')).toLowerCase();
                        const targetName = nearby.name.toLowerCase();
                        if (!goalText.includes(targetName)) {
                            // Target not mentioned in goal — skip social conversation, re-tick soon
                            logEvent(this.npc.name, 'thought',
                                `skipping conversation with ${nearby.name} — not relevant to active goal`,
                                { npcId: this.npc.id },
                            );
                            this.npc.setPlan([{ type: 'wait', duration: 2000 }]);
                            return;
                        }
                    }
                    this.npc.addEvent('wants to converse');
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

    private handleReasoningResult(result: ReasoningResult, activeGoal?: Goal) {
        // Register any new composed skill for client-side execution
        if (result.newSkill?.steps && result.newSkill.steps.length > 0) {
            registerComposedSkill(result.newSkill.name, result.newSkill.steps);
            this.npc.addEvent(`learned new skill: ${result.newSkill.name}`);
        }

        const hasConcreteOutput = (result.actions && result.actions.length > 0) || result.newSkill;

        // D3: Track escalation quality for budget accounting
        if (activeGoal) {
            if (hasConcreteOutput) {
                activeGoal.resources.productiveEscalations = (activeGoal.resources.productiveEscalations ?? 0) + 1;
            } else {
                activeGoal.resources.unproductiveEscalations = (activeGoal.resources.unproductiveEscalations ?? 0) + 1;
            }
        }

        if (result.actions && result.actions.length > 0) {
            // B4: Store plan agenda on the active goal for medium-loop reference
            if (activeGoal && result.actions.length > 1) {
                activeGoal.planAgenda = result.actions.map(a => {
                    switch (a.type) {
                        case 'move': return { skill: 'move_to', target: `(${a.target.x}, ${a.target.y})`, purpose: 'move to target', done: false } as PlanStep;
                        case 'speak': return { skill: 'speak', target: a.target, purpose: a.text ?? 'say something', done: false } as PlanStep;
                        default: return { skill: 'wait', purpose: 'pause', done: false } as PlanStep;
                    }
                });
            }
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
