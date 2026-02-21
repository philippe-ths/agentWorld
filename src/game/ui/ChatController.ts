import type { Scene } from 'phaser';
import type { Player } from '../entities/Player';
import type { NPC } from '../entities/NPC';
import type { EntityManager } from '../entities/EntityManager';
import * as AgentClient from '../ai/AgentClient';
import type { NearbyEntity } from '../ai/types';
import { log as logEvent } from './EventLog';

const MAX_TURNS = 5;
const SPEECH_DURATION = 4000;

export class ChatController {
    private scene: Scene;
    private player: Player;
    private entityManager: EntityManager;
    private container: HTMLElement;
    private input: HTMLInputElement;

    private activeNpc: NPC | null = null;
    private history: { speaker: string; text: string }[] = [];
    private turnCount = 0;
    private waitingForReply = false;

    constructor(scene: Scene, player: Player, entityManager: EntityManager) {
        this.scene = scene;
        this.player = player;
        this.entityManager = entityManager;

        this.container = document.getElementById('chat-container')!;
        this.input = document.getElementById('chat-input') as HTMLInputElement;

        document.addEventListener('keydown', (e) => this.onKeyDown(e));
    }

    private onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape' && this.isOpen()) {
            e.preventDefault();
            this.endConversation();
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();

            if (!this.isOpen()) {
                this.tryOpen();
            } else if (!this.waitingForReply) {
                this.submit();
            }
        }
    }

    private isOpen(): boolean {
        return !this.container.classList.contains('hidden');
    }

    private show() {
        this.container.classList.remove('hidden');
        this.input.value = '';
        this.input.focus();
        this.scene.input.keyboard!.enabled = false;
        this.scene.input.keyboard!.clearCaptures();
    }

    private hide() {
        this.container.classList.add('hidden');
        this.input.blur();
        this.scene.input.keyboard!.enabled = true;
        this.scene.input.keyboard!.addCapture('W,A,S,D,UP,DOWN,LEFT,RIGHT');
    }

    private findNearestNPC(): NPC | null {
        const nearby = this.entityManager.getEntitiesNear(
            this.player.tilePos.x, this.player.tilePos.y, 2,
        );
        let best: NPC | null = null;
        let bestDist = Infinity;

        for (const entity of nearby) {
            if (entity === this.player) continue;
            if (!('id' in entity)) continue;
            const npc = entity as NPC;
            if (npc.isInConversation) continue;
            const dx = npc.tilePos.x - this.player.tilePos.x;
            const dy = npc.tilePos.y - this.player.tilePos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bestDist) {
                bestDist = dist;
                best = npc;
            }
        }
        return best;
    }

    private tryOpen() {
        const npc = this.findNearestNPC();
        if (!npc) {
            this.player.say('No one nearby to talk to.', 2000);
            return;
        }

        this.activeNpc = npc;
        this.activeNpc.isInConversation = true;
        this.activeNpc.setPlan([]);
        this.history = [];
        this.turnCount = 0;
        this.show();
    }

    private async submit() {
        const text = this.input.value.trim();
        if (!text) {
            this.endConversation();
            return;
        }
        if (!this.activeNpc) return;

        this.turnCount++;
        this.waitingForReply = true;
        this.input.value = '';
        this.input.placeholder = '...';

        // Show player message
        this.player.say(text, SPEECH_DURATION);
        this.history.push({ speaker: 'Player', text });
        logEvent('Player', 'conversation', `→ ${this.activeNpc.name}: ${text}`);

        // Build observation for the NPC
        const nearby: NearbyEntity[] = [{
            id: 'player',
            name: 'Player',
            position: { ...this.player.tilePos },
            distance: 1,
        }];

        const observation = {
            npcId: this.activeNpc.id,
            name: this.activeNpc.name,
            position: { ...this.activeNpc.tilePos },
            nearbyEntities: nearby,
            isInConversation: true,
            currentSkill: 'converse' as string | null,
            recentEvents: [...this.activeNpc.recentEvents],
            activeGoals: this.activeNpc.activeGoals.map(g => ({ ...g })),
        };

        try {
            const result = await AgentClient.reason(
                this.activeNpc.id,
                observation,
                this.history,
                'Player',
            );

            if (result.goalExtraction?.shouldCreateGoal && result.goalExtraction.goal) {
                const now = Date.now();
                const extracted = result.goalExtraction.goal;
                const goal = {
                    id: `goal_${this.activeNpc.id}_${now}`,
                    npcId: this.activeNpc.id,
                    type: extracted.type,
                    description: extracted.description,
                    source: {
                        type: 'player_dialogue' as const,
                        assignedBy: 'Player',
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
                };

                const outcome = this.activeNpc.addGoal(goal);
                logEvent(this.activeNpc.name, 'system',
                    outcome === 'ignored'
                        ? `declined goal (low priority): ${goal.description}`
                        : `accepted goal from Player: ${goal.description}`,
                    { npcId: this.activeNpc.id },
                );
            }

            const reply = result.dialogue ?? '...';
            this.history.push({ speaker: this.activeNpc.name, text: reply });
            this.activeNpc.say(reply, SPEECH_DURATION);
            logEvent(this.activeNpc.name, 'conversation', `→ Player: ${reply}`);
            this.activeNpc.addEvent(`said to Player: "${reply}"`); 
        } catch {
            this.activeNpc.say('...', 2000);
        }

        this.waitingForReply = false;

        if (this.turnCount >= MAX_TURNS) {
            // Auto-end after max turns
            await this.delay(SPEECH_DURATION);
            this.endConversation();
        } else {
            this.input.placeholder = 'Type a message...';
            this.input.focus();
        }
    }

    private endConversation() {
        if (this.activeNpc) {
            this.activeNpc.isInConversation = false;
            this.activeNpc.addEvent('ended conversation with Player');
            this.activeNpc = null;
        }
        this.history = [];
        this.turnCount = 0;
        this.waitingForReply = false;
        this.hide();
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
