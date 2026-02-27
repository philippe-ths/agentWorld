import { Entity, TilePos } from './entities/Entity';
import { NPC } from './entities/NPC';
import { Player } from './entities/Player';
import { EntityManager } from './entities/EntityManager';
import { LLMService, ConversationMessage, ConversationResponse } from './LLMService';
import { ChronologicalLog, LOG_CHAR_BUDGET } from './ChronologicalLog';
import { buildWorldState } from './WorldState';

const MAX_EXCHANGES = 6;

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
    private callbacks: ConversationCallbacks;
    private activeSession: ConversationSession | null = null;

    // Player dialogue state
    private playerInputResolve: ((text: string) => void) | null = null;
    private playerDialogueClosed = false;

    constructor(
        entityManager: EntityManager,
        llm: LLMService,
        logs: Map<string, ChronologicalLog>,
        callbacks: ConversationCallbacks,
    ) {
        this.entityManager = entityManager;
        this.llm = llm;
        this.logs = logs;
        this.callbacks = callbacks;
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
    ): Promise<void> {
        const validation = this.validate(initiator, targetName);
        if (!validation.valid) {
            console.warn(`%c[Conversation] ${validation.error}`, 'color: #ffaa00; font-weight: bold');
            return;
        }
        const target = validation.target!;

        // If the target is the Player, open dialogue box instead of running LLM loop
        if (target instanceof Player) {
            await this.startNpcToPlayerConversation(initiator, target, openingMessage, turnNumber);
            return;
        }

        this.activeSession = {
            initiator,
            target,
            history: [],
            turnNumber,
            location: { ...initiator.tilePos },
        };

        // Opening message from initiator
        this.activeSession.history.push({ speaker: initiator.name, text: openingMessage });

        // Show speech bubble and simultaneously call target's LLM
        const entities = this.entityManager.getEntities();
        const targetWorldState = buildWorldState(target, entities);
        const targetMemory = this.logs.get(target.name)?.buildPromptContent(LOG_CHAR_BUDGET) || undefined;

        const [, targetResponse] = await Promise.all([
            this.callbacks.showSpeechBubble(initiator, openingMessage, 3000),
            this.llm.converse(target.name, targetWorldState, targetMemory, this.activeSession.history),
        ]);

        let exchangeCount = 1; // opening message counts as 1

        // Target responds
        if (targetResponse.type === 'say') {
            this.activeSession.history.push({ speaker: target.name, text: targetResponse.message });
            await this.callbacks.showSpeechBubble(target, targetResponse.message, 3000);
            exchangeCount++;
        } else {
            this.finishConversation(target.name);
            return;
        }

        // Alternate back and forth
        while (exchangeCount < MAX_EXCHANGES) {
            // Initiator's turn
            const initiatorWorldState = buildWorldState(initiator, entities);
            const initiatorMemory = this.logs.get(initiator.name)?.buildPromptContent(LOG_CHAR_BUDGET) || undefined;
            const initiatorResponse = await this.llm.converse(
                initiator.name, initiatorWorldState, initiatorMemory, this.activeSession.history,
            );

            if (initiatorResponse.type === 'say') {
                this.activeSession.history.push({ speaker: initiator.name, text: initiatorResponse.message });
                await this.callbacks.showSpeechBubble(initiator, initiatorResponse.message, 3000);
                exchangeCount++;
            } else {
                this.finishConversation(initiator.name);
                return;
            }

            if (exchangeCount >= MAX_EXCHANGES) break;

            // Target's turn
            const targetResponse2 = await this.llm.converse(
                target.name, targetWorldState, targetMemory, this.activeSession.history,
            );

            if (targetResponse2.type === 'say') {
                this.activeSession.history.push({ speaker: target.name, text: targetResponse2.message });
                await this.callbacks.showSpeechBubble(target, targetResponse2.message, 3000);
                exchangeCount++;
            } else {
                this.finishConversation(target.name);
                return;
            }
        }

        // Hit exchange cap
        this.finishConversation('exchange limit');
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

        // NPC's opening message
        this.activeSession.history.push({ speaker: initiator.name, text: openingMessage });

        // Show speech bubble for the opening, then open dialogue box
        await this.callbacks.showSpeechBubble(initiator, openingMessage, 3000);

        this.playerDialogueClosed = false;
        this.callbacks.openDialogue(initiator.name);
        this.callbacks.addDialogueMessage(initiator.name, openingMessage);

        // Wait for player messages until dialogue is closed
        while (!this.playerDialogueClosed) {
            const playerText = await this.waitForPlayerInput();
            if (this.playerDialogueClosed) break;

            this.activeSession.history.push({ speaker: 'Player', text: playerText });
            this.callbacks.addDialogueMessage('Player', playerText);

            // NPC responds via LLM
            const npcResponse = await this.sendPlayerMessageToNpc(initiator);
            if (this.playerDialogueClosed) break;

            if (npcResponse.type === 'say') {
                this.activeSession.history.push({ speaker: initiator.name, text: npcResponse.message });
                this.callbacks.addDialogueMessage(initiator.name, npcResponse.message);
            } else {
                this.activeSession.history.push({ speaker: initiator.name, text: '[ended conversation]' });
                this.callbacks.addDialogueMessage(initiator.name, '(has nothing more to say)');
            }
        }

        this.finishConversation('Player', true);
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

        this.playerDialogueClosed = false;
        this.callbacks.openDialogue(target.name);

        // Wait for player messages until dialogue is closed
        while (!this.playerDialogueClosed) {
            const playerText = await this.waitForPlayerInput();
            if (this.playerDialogueClosed) break;

            this.activeSession.history.push({ speaker: 'Player', text: playerText });
            this.callbacks.addDialogueMessage('Player', playerText);

            const npcResponse = await this.sendPlayerMessageToNpc(target);
            if (this.playerDialogueClosed) break;

            if (npcResponse.type === 'say') {
                this.activeSession.history.push({ speaker: target.name, text: npcResponse.message });
                this.callbacks.addDialogueMessage(target.name, npcResponse.message);
            } else {
                this.activeSession.history.push({ speaker: target.name, text: '[ended conversation]' });
                this.callbacks.addDialogueMessage(target.name, '(has nothing more to say)');
            }
        }

        // Save transcript to NPC's log only
        this.finishConversation('Player', true);
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
        const entities = this.entityManager.getEntities();
        const worldState = buildWorldState(npc, entities);
        const memory = this.logs.get(npc.name)?.buildPromptContent(LOG_CHAR_BUDGET) || undefined;
        return this.llm.converse(npc.name, worldState, memory, this.activeSession!.history);
    }

    private finishConversation(endedBy: string, playerInvolved = false): void {
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

        if (playerInvolved) {
            // Player involved: save to the NPC's log only (Player has no log)
            const npcName = session.initiator instanceof Player
                ? session.target.name
                : session.initiator.name;
            const npcLog = this.logs.get(npcName);
            if (npcLog) {
                npcLog.recordConversation({ ...transcript, partnerName: 'Player' });
            }
        } else {
            // NPC-to-NPC: save to both logs
            const initiatorLog = this.logs.get(session.initiator.name);
            const targetLog = this.logs.get(session.target.name);
            if (initiatorLog) {
                initiatorLog.recordConversation({ ...transcript, partnerName: session.target.name });
            }
            if (targetLog) {
                targetLog.recordConversation({ ...transcript, partnerName: session.initiator.name });
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
}
