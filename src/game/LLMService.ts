import { DECISION, CONVERSATION } from './prompts';
import { LLM_ENDPOINTS } from './GameConfig';

export interface ConversationMessage {
    speaker: string;
    text: string;
}

export type ConversationResponse =
    | { type: 'say'; message: string }
    | { type: 'end_conversation' };

const SAY_RE = /^say\((.+)\)$/;
const END_CONVO_RESPONSE_RE = /^end_conversation\(\s*\)$/;

export class LLMService {
    private turnLabel: Phaser.GameObjects.Text | null;

    constructor(turnLabel?: Phaser.GameObjects.Text) {
        this.turnLabel = turnLabel ?? null;
    }

    async decide(npcName: string, worldState: string, memory?: string, goals?: string): Promise<string> {
        // ── Log prompt ──────────────────────────────────────
        console.group(`%c[LLM] ${npcName}'s prompt`, 'color: #6bc5ff; font-weight: bold');
        console.log('%cSystem:', 'color: #aaa', DECISION.buildSystem());
        if (memory) console.log('%cMemory:', 'color: #c9a0ff', memory);
        if (goals) console.log('%cGoals:', 'color: #ffcc00', goals);
        console.log('%cWorld state:', 'color: #aaa', worldState);
        console.groupEnd();

        const messages: { role: string; content: string }[] = [];
        if (memory) {
            messages.push({ role: 'user', content: `YOUR MEMORY:\n${memory}` });
            messages.push({ role: 'assistant', content: 'Understood.' });
        }
        if (goals) {
            messages.push({ role: 'user', content: `YOUR GOALS:\n${goals}` });
            messages.push({ role: 'assistant', content: 'Understood.' });
        }
        messages.push({ role: 'user', content: worldState });

        const body = {
            model: DECISION.model,
            system: DECISION.buildSystem(),
            messages,
            max_tokens: DECISION.maxTokens,
        };

        let response: Response;
        try {
            response = await fetch(LLM_ENDPOINTS.chat, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch (err) {
            this.reportError(npcName, `Network error: ${(err as Error).message}`);
            throw err;
        }

        if (!response.ok) {
            let detail = `HTTP ${response.status}`;
            try {
                const errBody = await response.json();
                detail = errBody.error ?? detail;
            } catch { /* ignore parse error */ }
            this.reportError(npcName, detail);
            throw new Error(`LLM request failed for ${npcName}: ${detail}`);
        }

        const data = await response.json();
        const text: string = data.text;

        // ── Log response ────────────────────────────────────
        console.group(`%c[LLM] ${npcName}'s response`, 'color: #b06bff; font-weight: bold');
        console.log(text);
        console.groupEnd();

        return text;
    }

    async converse(
        npcName: string,
        worldState: string,
        memory: string | undefined,
        conversationHistory: ConversationMessage[],
    ): Promise<ConversationResponse> {
        const messages: { role: string; content: string }[] = [];
        if (memory) {
            messages.push({ role: 'user', content: `YOUR MEMORY:\n${memory}` });
            messages.push({ role: 'assistant', content: 'Understood.' });
        }
        messages.push({ role: 'user', content: `WORLD STATE:\n${worldState}` });
        messages.push({ role: 'assistant', content: 'Understood.' });

        const historyText = conversationHistory
            .map(m => `${m.speaker}: ${m.text}`)
            .join('\n');
        messages.push({ role: 'user', content: `CONVERSATION:\n${historyText}\n\nRespond with say(message) or end_conversation().` });

        const body = {
            model: CONVERSATION.model,
            system: CONVERSATION.buildSystem(),
            messages,
            max_tokens: CONVERSATION.maxTokens,
        };

        console.group(`%c[LLM] ${npcName}'s conversation response`, 'color: #ff9f43; font-weight: bold');
        console.log('%cHistory:', 'color: #aaa', historyText);
        console.groupEnd();

        let response: Response;
        try {
            response = await fetch(LLM_ENDPOINTS.chat, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch (err) {
            this.reportError(npcName, `Network error: ${(err as Error).message}`);
            return { type: 'end_conversation' };
        }

        if (!response.ok) {
            let detail = `HTTP ${response.status}`;
            try {
                const errBody = await response.json();
                detail = errBody.error ?? detail;
            } catch { /* ignore parse error */ }
            this.reportError(npcName, detail);
            return { type: 'end_conversation' };
        }

        const data = await response.json();
        const text: string = data.text.trim();

        console.group(`%c[LLM] ${npcName}'s conversation response`, 'color: #ff9f43; font-weight: bold');
        console.log(text);
        console.groupEnd();

        return this.parseConversationResponse(text);
    }

    private parseConversationResponse(text: string): ConversationResponse {
        const line = text.split('\n')[0].trim();
        const sayMatch = line.match(SAY_RE);
        if (sayMatch) {
            return { type: 'say', message: sayMatch[1].trim() };
        }
        if (END_CONVO_RESPONSE_RE.test(line)) {
            return { type: 'end_conversation' };
        }
        // Fallback: treat unrecognized response as a say
        console.warn(`%c[LLM] Unrecognized conversation response: "${line}", treating as say()`, 'color: #ffaa00');
        return { type: 'say', message: text };
    }

    private reportError(npcName: string, detail: string) {
        const msg = `[LLM ERROR] ${npcName}: ${detail}`;
        console.error(`%c${msg}`, 'color: #ff4444; font-weight: bold; font-size: 14px');
        if (this.turnLabel) {
            this.turnLabel.setText(msg);
        }
    }
}
