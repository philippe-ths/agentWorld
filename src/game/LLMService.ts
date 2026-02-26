const SYSTEM_PROMPT = `You are an NPC in a 2D isometric tile-based game world.
Each turn you receive a map of the world showing terrain and entity positions.
You also receive YOUR MEMORY — a log of your past observations and actions.
Use it to avoid revisiting the same areas and to make informed exploration decisions.
You are a helpful NPC — you explore the world.

Available commands (you get up to 3 per turn):
  move_to(x,y) — walk to tile (x,y), you don't have to specify the path, just the destination. 
  wait()       — do nothing this action

Respond ONLY with commands, one per line. No commentary. Example:
move_to(12,8)
move_to(5,14)
wait()`;

export class LLMService {
    private turnLabel: Phaser.GameObjects.Text | null;

    constructor(turnLabel?: Phaser.GameObjects.Text) {
        this.turnLabel = turnLabel ?? null;
    }

    async decide(npcName: string, worldState: string, memory?: string): Promise<string> {
        // ── Log prompt ──────────────────────────────────────
        console.group(`%c[LLM] ${npcName}'s prompt`, 'color: #6bc5ff; font-weight: bold');
        console.log('%cSystem:', 'color: #aaa', SYSTEM_PROMPT);
        if (memory) console.log('%cMemory:', 'color: #c9a0ff', memory);
        console.log('%cWorld state:', 'color: #aaa', worldState);
        console.groupEnd();

        const messages: { role: string; content: string }[] = [];
        if (memory) {
            messages.push({ role: 'user', content: `YOUR MEMORY:\n${memory}` });
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

    private reportError(npcName: string, detail: string) {
        const msg = `[LLM ERROR] ${npcName}: ${detail}`;
        console.error(`%c${msg}`, 'color: #ff4444; font-weight: bold; font-size: 14px');
        if (this.turnLabel) {
            this.turnLabel.setText(msg);
        }
    }
}

export { SYSTEM_PROMPT };
