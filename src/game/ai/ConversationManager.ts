import type { NPC } from '../entities/NPC';
import type { EntityManager } from '../entities/EntityManager';
import { dialogue as apiDialogue } from './AgentClient';
import { log as logEvent } from '../ui/EventLog';

interface Conversation {
    id: string;
    participants: [NPC, NPC];
    history: { speaker: string; text: string }[];
    turnIndex: number;
    maxTurns: number;
    active: boolean;
    purpose?: string;
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

        window.addEventListener('npc-wants-converse', ((e: CustomEvent) => {
            const { npcId, targetName, purpose } = e.detail;
            this.tryStartConversation(npcId, targetName, purpose);
        }) as EventListener);
    }

    private tryStartConversation(initiatorId: string, targetName: string, purpose?: string) {
        if (this.busyNpcs.has(initiatorId)) return;

        const entities = this.entityManager.getAll();
        const initiator = entities.find(e => 'id' in e && (e as NPC).id === initiatorId) as NPC | undefined;
        const target = entities.find(e => e.name.toLowerCase() === targetName.toLowerCase()) as NPC | undefined;

        if (!initiator || !target) return;
        if (!(target instanceof Object && 'isInConversation' in target)) return;

        const targetNpc = target as NPC;
        if (this.busyNpcs.has(targetNpc.id)) return;

        this.startConversation(initiator, targetNpc, purpose);
    }

    private async startConversation(npc1: NPC, npc2: NPC, purpose?: string) {
        const id = `conv_${Date.now()}`;

        const conv: Conversation = {
            id,
            participants: [npc1, npc2],
            history: [],
            turnIndex: 0,
            maxTurns: MAX_TURNS,
            active: true,
            purpose,
        };

        this.conversations.set(id, conv);
        this.busyNpcs.add(npc1.id);
        this.busyNpcs.add(npc2.id);

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

        await this.runConversation(conv);
    }

    private async runConversation(conv: Conversation) {
        const [npc1, npc2] = conv.participants;

        for (let turn = 0; turn < conv.maxTurns && conv.active; turn++) {
            const speaker = turn % 2 === 0 ? npc1 : npc2;
            const listener = turn % 2 === 0 ? npc2 : npc1;

            const worldSummary = speaker.protocolAgent?.getWorldSummary() ?? '';

            const t0 = performance.now();
            const result = await apiDialogue(
                speaker.id,
                listener.name,
                worldSummary,
                conv.history,
                conv.purpose,
            );
            const latency = Math.round(performance.now() - t0);

            if (!conv.active) break;

            logEvent(speaker.name, 'llm-call',
                `dialogue generation — ${latency}ms`,
                { npcId: speaker.id, relatedNpcId: listener.id, metadata: { model: 'claude-haiku', latency } },
            );

            const text = result.dialogue ?? '...';

            conv.history.push({ speaker: speaker.name, text });
            logEvent(speaker.name, 'conversation', `→ ${listener.name}: ${text}`,
                { npcId: speaker.id, relatedNpcId: listener.id });

            speaker.say(text, SPEECH_DURATION);
            speaker.addEvent(`said to ${listener.name}: "${text}"`);
            listener.addEvent(`${speaker.name} said: "${text}"`);

            // If the speaker's dialogue requests a task from the listener, delegate it
            if (result.taskRequested && listener.protocolAgent) {
                listener.addEvent(`received task from ${speaker.name}: "${result.taskRequested}"`);
                listener.protocolAgent.receiveTask(result.taskRequested, speaker.name)
                    .catch(err => console.warn('[ConversationManager] Task delegation failed:', err));
            }

            await this.delay(SPEECH_DURATION + PAUSE_BETWEEN);
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

        // Signal BehaviorMachines so converse_with actions complete
        npc1.behaviorMachine.conversationEnded();
        npc2.behaviorMachine.conversationEnded();

        npc1.addEvent(`ended conversation with ${npc2.name}`);
        npc2.addEvent(`ended conversation with ${npc1.name}`);
        logEvent(npc1.name, 'system', `conversation ended with ${npc2.name}`,
            { npcId: npc1.id, relatedNpcId: npc2.id });
        logEvent(npc2.name, 'system', `conversation ended with ${npc1.name}`,
            { npcId: npc2.id, relatedNpcId: npc1.id });

        this.conversations.delete(conv.id);
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
