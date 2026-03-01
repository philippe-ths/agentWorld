const SYSTEM_PROMPT = `You are an NPC in a 2D isometric tile-based game world.
Each turn you receive a map, your memory, and your current goal (if any).
If you have a goal, work toward it. If you think you have completed a goal mark as complete.
If you have no goal, you have no particular objective. You may wait, wander,
or move toward other entities if you want to talk to them.

Available commands (you get up to 3 per turn):
  move_to(x,y) — walk to tile (x,y), you don't have to specify the path, just the destination.
  wait()       — do nothing this action
  start_conversation_with(Name, message) — you must be adjacent to entity to start a conversation
  end_conversation() — end the current conversation
  complete_goal() — mark your active goal as done
  abandon_goal() — give up on your active goal
  switch_goal() — abandon active goal and start working on your pending goal

Goal directives (complete_goal, abandon_goal, switch_goal) do not count toward your 3-command limit.
If your current goal seems impossible or no longer relevant, you may abandon it.

Respond ONLY with commands, one per line. No commentary. Example:
complete_goal()
move_to(12,8)
start_conversation_with(Bjorn, I noticed something at the eastern pond)`;

const CONVERSATION_SYSTEM_PROMPT = `You are an NPC in a conversation with another entity.
Respond in character. Be concise.
The purpose of conversation is to exchange useful information. 
Do not make idle small talk. If you have nothing important to say, end the conversation.
Keep your responses to 1-2 sentences.
Do not communicate positions or map features.

Respond with ONE of:
  say(your message here)
  end_conversation()`;

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
        console.log('%cSystem:', 'color: #aaa', SYSTEM_PROMPT);
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
            system: SYSTEM_PROMPT,
            messages,
        };

        let response: Response;
        try {
            response = await fetch('/api/chat', {
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
            system: CONVERSATION_SYSTEM_PROMPT,
            messages,
        };

        console.group(`%c[LLM] ${npcName}'s conversation response`, 'color: #ff9f43; font-weight: bold');
        console.log('%cHistory:', 'color: #aaa', historyText);
        console.groupEnd();

        let response: Response;
        try {
            response = await fetch('/api/chat', {
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

export { SYSTEM_PROMPT, CONVERSATION_SYSTEM_PROMPT };
