import type { Scene } from 'phaser';
import type { Player } from '../entities/Player';
import type { NPC } from '../entities/NPC';
import type { EntityManager } from '../entities/EntityManager';
import { log as logEvent } from './EventLog';
import { dialogue as apiDialogue } from '../ai/AgentClient';

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

        this.player.say(text, SPEECH_DURATION);
        this.history.push({ speaker: 'Player', text });
        logEvent('Player', 'conversation', `→ ${this.activeNpc.name}: ${text}`);

        try {
            const worldSummary = this.activeNpc.protocolAgent?.getWorldSummary() ?? '';

            const response = await apiDialogue(
                this.activeNpc.id,
                'Player',
                worldSummary,
                this.history,
            );

            const reply = response.dialogue || '...';
            this.activeNpc.say(reply, SPEECH_DURATION);
            this.history.push({ speaker: this.activeNpc.name, text: reply });
            logEvent(this.activeNpc.name, 'conversation', `→ Player: ${reply}`);

            // If the LLM detected a task in the message, delegate it
            if (response.taskRequested && this.activeNpc.protocolAgent) {
                this.activeNpc.addEvent(`received task from Player: "${response.taskRequested}"`);
                // Don't await — let task planning happen in background after conversation
                this.activeNpc.protocolAgent.receiveTask(response.taskRequested, 'Player')
                    .catch(err => console.warn('[ChatController] Task delegation failed:', err));
            }
        } catch {
            this.activeNpc.say('...', 2000);
        }

        this.waitingForReply = false;
        this.input.placeholder = '';

        if (this.turnCount >= MAX_TURNS) {
            this.endConversation();
        }
    }

    private endConversation() {
        if (this.activeNpc) {
            this.activeNpc.isInConversation = false;
            this.activeNpc = null;
        }
        this.history = [];
        this.turnCount = 0;
        this.waitingForReply = false;
        this.hide();
    }
}
