import type { NPC } from '../entities/NPC';
import type { EntityManager } from '../entities/EntityManager';
import type { Observation, NearbyEntity, ReasoningResult } from './types';
import * as AgentClient from './AgentClient';
import { executeSkill, registerComposedSkill } from './SkillExecutor';

const TICK_INTERVAL = 15000; // ms between medium-loop ticks

// Stagger NPC starts so they don't all tick at the same time
const NPC_OFFSETS: Record<string, number> = { ada: 0, bjorn: 5000, cora: 10000 };

export class AgentLoop {
    private npc: NPC;
    private entityManager: EntityManager;
    private timeSinceLastTick: number;
    private pending = false;

    constructor(npc: NPC, entityManager: EntityManager) {
        this.npc = npc;
        this.entityManager = entityManager;
        // Stagger first tick per NPC to avoid rate limit bursts
        this.timeSinceLastTick = TICK_INTERVAL - (NPC_OFFSETS[npc.id] ?? 0);

        // When plan completes successfully, report outcome and request next tick
        this.npc.onPlanComplete = (hadFailure: boolean) => {
            if (this.npc.currentSkill) {
                AgentClient.reportSkillOutcome(this.npc.currentSkill, !hadFailure);
            }
            this.timeSinceLastTick = TICK_INTERVAL;
        };
    }

    update(_time: number, delta: number) {
        if (this.npc.isInConversation) return;
        if (this.pending) return;

        this.timeSinceLastTick += delta;

        if (this.timeSinceLastTick >= TICK_INTERVAL && this.npc.currentPlan.length === 0) {
            this.timeSinceLastTick = 0;
            this.requestTick();
        }
    }

    private async requestTick() {
        this.pending = true;

        try {
            const observation = this.buildObservation();

            // Escalate to slow loop if repeatedly stuck
            if (this.shouldEscalateToReasoning()) {
                const stuckCount = this.npc.recentEvents.filter(e => e.includes('stuck')).length;
                this.npc.addEvent('escalating to reasoning (stuck)');
                const reasonResult = await AgentClient.reasonGeneral(
                    this.npc.id,
                    observation,
                    { stuckCount, failedSkill: this.npc.currentSkill ?? undefined },
                );
                this.handleReasoningResult(reasonResult);

                // Report the failure for self-critique
                const failureEvents = this.npc.recentEvents.filter(e => e.includes('stuck'));
                AgentClient.reportFailure(
                    this.npc.id, failureEvents,
                    this.npc.currentSkill ?? undefined, stuckCount,
                );

                this.clearStuckEvents();
            } else {
                const result = await AgentClient.tick(observation);

                this.npc.currentSkill = result.skill;
                this.npc.addEvent(`chose skill: ${result.skill}`);

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
        };
    }
}
