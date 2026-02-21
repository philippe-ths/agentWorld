import type { NPC } from '../entities/NPC';
import type { EntityManager } from '../entities/EntityManager';
import * as AgentClient from './AgentClient';
import type { Observation, NearbyEntity } from './types';
import { log as logEvent } from '../ui/EventLog';

interface Conversation {
    id: string;
    participants: [NPC, NPC];
    history: { speaker: string; text: string }[];
    turnIndex: number;
    maxTurns: number;
    active: boolean;
}

const MAX_TURNS = 5;
const SPEECH_DURATION = 3500;
const PAUSE_BETWEEN = 1000;

export class ConversationManager {
    private conversations = new Map<string, Conversation>();
    private entityManager: EntityManager;
    private busyNpcs = new Set<string>();

    constructor(entityManager: EntityManager) {
        this.entityManager = entityManager;

        // Listen for NPC conversation requests
        window.addEventListener('npc-wants-converse', ((e: CustomEvent) => {
            const { npcId, targetName } = e.detail;
            this.tryStartConversation(npcId, targetName);
        }) as EventListener);
    }

    private tryStartConversation(initiatorId: string, targetName: string) {
        if (this.busyNpcs.has(initiatorId)) return;

        const entities = this.entityManager.getAll();
        const initiator = entities.find(e => 'id' in e && (e as NPC).id === initiatorId) as NPC | undefined;
        const target = entities.find(e => e.name.toLowerCase() === targetName.toLowerCase()) as NPC | undefined;

        if (!initiator || !target) return;
        if (!(target instanceof Object && 'isInConversation' in target)) return;

        const targetNpc = target as NPC;
        if (this.busyNpcs.has(targetNpc.id)) return;

        this.startConversation(initiator, targetNpc);
    }

    private async startConversation(npc1: NPC, npc2: NPC) {
        const id = `conv_${Date.now()}`;

        // B3: Shorten conversations when initiator has an active goal
        const initiatorHasGoal = npc1.activeGoals.some(g => g.status === 'active');
        const conv: Conversation = {
            id,
            participants: [npc1, npc2],
            history: [],
            turnIndex: 0,
            maxTurns: initiatorHasGoal ? 3 : MAX_TURNS,
            active: true,
        };

        this.conversations.set(id, conv);
        this.busyNpcs.add(npc1.id);
        this.busyNpcs.add(npc2.id);

        // Pause both NPCs
        npc1.isInConversation = true;
        npc2.isInConversation = true;
        npc1.setPlan([]);
        npc2.setPlan([]);

        npc1.addEvent(`started conversation with ${npc2.name}`);
        npc2.addEvent(`started conversation with ${npc1.name}`);
        logEvent(npc1.name, 'system', `conversation started with ${npc2.name}`,
            { npcId: npc1.id, relatedNpcId: npc2.id });
        logEvent(npc2.name, 'system', `conversation started with ${npc1.name}`,
            { npcId: npc2.id, relatedNpcId: npc1.id });

        // Run conversation turns
        await this.runConversation(conv);
    }

    private async runConversation(conv: Conversation) {
        const [npc1, npc2] = conv.participants;
        let delegationExtracted = false;
        let turnsWithoutGoalProgress = 0;

        for (let turn = 0; turn < conv.maxTurns && conv.active; turn++) {
            const speaker = turn % 2 === 0 ? npc1 : npc2;
            const listener = turn % 2 === 0 ? npc2 : npc1;

            const observation = this.buildObservation(speaker, listener);

            // D1: If speaker has a high-priority goal and 2+ turns produced nothing,
            // inject a steering note into the conversation history
            const speakerTopGoal = speaker.activeGoals.find(g => g.status === 'active');
            if (speakerTopGoal && speakerTopGoal.priority >= 0.5 && turnsWithoutGoalProgress >= 2) {
                conv.history.push({
                    speaker: 'SYSTEM',
                    text: `[${speaker.name} remembers: active goal — "${speakerTopGoal.description}". Steer the conversation toward this objective or wrap up.]`,
                });
            }

            const t0 = performance.now();
            const result = await AgentClient.reason(
                speaker.id,
                observation,
                conv.history,
                listener.name,
            );
            const latency = Math.round(performance.now() - t0);

            if (!conv.active) break;

            logEvent(speaker.name, 'llm-call',
                `dialogue generation — ${latency}ms`,
                { npcId: speaker.id, relatedNpcId: listener.id, metadata: { model: 'claude-sonnet-4', latency } },
            );

            const text = result.dialogue ?? '...';

            if (result.goalExtraction?.shouldCreateGoal && result.goalExtraction.goal) {
                turnsWithoutGoalProgress = 0; // Reset counter — goal-relevant turn
                const now = Date.now();
                const extracted = result.goalExtraction.goal;

                // C3: Snapshot baseline state for evaluation accuracy
                const nearbySnapshot = observation.nearbyEntities
                    .map(e => `- ${e.name}: at (${e.position.x}, ${e.position.y}), ${e.distance} tiles away`)
                    .join('\n');
                const baselineState = `Position: (${observation.position.x}, ${observation.position.y})\n${nearbySnapshot}`;

                const goal = {
                    id: `goal_${speaker.id}_${now}`,
                    npcId: speaker.id,
                    type: extracted.type,
                    description: extracted.description,
                    source: {
                        type: 'npc_dialogue' as const,
                        conversationId: conv.id,
                        assignedBy: listener.name,
                    },
                    evaluation: extracted.evaluation,
                    status: 'active' as const,
                    priority: Math.max(0, Math.min(1, extracted.priority)),
                    createdAt: now,
                    expiresAt: null,
                    resources: {
                        totalTokensIn: 0,
                        totalTokensOut: 0,
                        estimatedCostUSD: 0,
                        haikuCalls: 0,
                        sonnetCalls: 0,
                        embeddingCalls: 0,
                        pathfindingCalls: 0,
                        evaluationCalls: 0,
                        wallClockMs: 0,
                        apiLatencyMs: 0,
                        mediumLoopTicks: 0,
                    },
                    parentGoalId: null,
                    delegatedTo: null,
                    delegatedFrom: null,
                    estimatedDifficulty: extracted.estimatedDifficulty,
                    baselineState,
                };

                const outcome = speaker.addGoal(goal);
                logEvent(speaker.name, 'system',
                    outcome === 'ignored'
                        ? `declined goal (low priority): ${goal.description}`
                        : `accepted goal: ${goal.description}`,
                    { npcId: speaker.id, relatedNpcId: listener.id },
                );

                // Delegation support: speaker can assign partner a mirrored delegated sub-goal.
                if (extracted.delegation?.delegateToPartner) {
                    goal.delegatedTo = listener.id;
                    const delegated = {
                        ...goal,
                        id: `${goal.id}_delegated_${listener.id}`,
                        npcId: listener.id,
                        source: {
                            type: 'delegated' as const,
                            conversationId: conv.id,
                            assignedBy: speaker.name,
                        },
                        parentGoalId: goal.id,
                        delegatedTo: null,
                        delegatedFrom: speaker.id,
                    };

                    const delegatedOutcome = listener.addGoal(delegated);
                    logEvent(listener.name, 'system',
                        delegatedOutcome === 'ignored'
                            ? `declined delegated task from ${speaker.name}: ${delegated.description}`
                            : `accepted delegated task from ${speaker.name}: ${delegated.description}`,
                        { npcId: listener.id, relatedNpcId: speaker.id },
                    );

                    if (delegatedOutcome !== 'ignored') {
                        AgentClient.reportCommitment(
                            speaker.id,
                            speaker.name,
                            listener.name,
                            goal.id,
                            goal.description,
                            'agreed',
                        );
                        AgentClient.reportCommitment(
                            listener.id,
                            speaker.name,
                            listener.name,
                            delegated.id,
                            delegated.description,
                            'in_progress',
                        );
                    }
                }

                if (extracted.delegation?.delegatedTask) {
                    goal.delegatedFrom = listener.id;
                    AgentClient.reportCommitment(
                        speaker.id,
                        listener.name,
                        speaker.name,
                        goal.id,
                        goal.description,
                        'in_progress',
                    );
                }

                // B3: End conversation early once delegation is extracted
                if (extracted.delegation?.delegateToPartner || extracted.delegation?.delegatedTask) {
                    delegationExtracted = true;
                }
            } else {
                // No goal extracted this turn
                const speakerHasGoal = speaker.activeGoals.some(g => g.status === 'active');
                if (speakerHasGoal) turnsWithoutGoalProgress++;
            }

            conv.history.push({ speaker: speaker.name, text });
            logEvent(speaker.name, 'conversation', `→ ${listener.name}: ${text}`,
                { npcId: speaker.id, relatedNpcId: listener.id });

            // Show speech bubble
            speaker.say(text, SPEECH_DURATION);
            speaker.addEvent(`said to ${listener.name}: "${text}"`);
            listener.addEvent(`${speaker.name} said: "${text}"`); 

            // Wait for speech bubble to finish
            await this.delay(SPEECH_DURATION + PAUSE_BETWEEN);

            // B3: After delegation extracted, allow one more turn for acknowledgment then end
            if (delegationExtracted && turn >= 1) {
                break;
            }
        }

        this.endConversation(conv);
    }

    private endConversation(conv: Conversation) {
        const [npc1, npc2] = conv.participants;

        conv.active = false;
        npc1.isInConversation = false;
        npc2.isInConversation = false;
        this.busyNpcs.delete(npc1.id);
        this.busyNpcs.delete(npc2.id);

        npc1.addEvent(`ended conversation with ${npc2.name}`);
        npc2.addEvent(`ended conversation with ${npc1.name}`);
        logEvent(npc1.name, 'system', `conversation ended with ${npc2.name}`,
            { npcId: npc1.id, relatedNpcId: npc2.id });
        logEvent(npc2.name, 'system', `conversation ended with ${npc1.name}`,
            { npcId: npc2.id, relatedNpcId: npc1.id });

        this.conversations.delete(conv.id);
    }

    private buildObservation(speaker: NPC, listener: NPC): Observation {
        const nearby: NearbyEntity[] = [{
            id: listener.id,
            name: listener.name,
            position: { ...listener.tilePos },
            distance: 1,
        }];

        return {
            npcId: speaker.id,
            name: speaker.name,
            position: { ...speaker.tilePos },
            nearbyEntities: nearby,
            isInConversation: true,
            currentSkill: 'converse',
            recentEvents: [...speaker.recentEvents],
            activeGoals: speaker.activeGoals.map(g => ({ ...g })),
        };
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
