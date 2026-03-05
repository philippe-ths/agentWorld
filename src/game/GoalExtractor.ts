import { ConversationMessage } from './LLMService';
import { Goal, GoalManager } from './GoalManager';
import { GOAL_EXTRACTION } from './prompts';
import { LLM_ENDPOINTS } from './GameConfig';

function formatTranscript(history: ConversationMessage[]): string {
    return history.map(m => `${m.speaker}: ${m.text}`).join('\n');
}

const NONE_RE = /^none\(\s*\)$/m;

function parseGoalFromResponse(text: string): Goal | null {
    const normalized = text.replace(/\r\n?/g, '\n').trim();
    if (NONE_RE.test(normalized)) return null;

    const source = extractField(normalized, 'Source', ['Goal', 'Plan', 'Success', 'Status']);
    const goal = extractField(normalized, 'Goal', ['Plan', 'Success', 'Status']);
    const plan = extractField(normalized, 'Plan', ['Success', 'Status']);
    const success = extractField(normalized, 'Success');

    if (!source || !goal || !plan || !success) {
        const missing = [
            source ? '' : 'Source',
            goal ? '' : 'Goal',
            plan ? '' : 'Plan',
            success ? '' : 'Success',
        ].filter(Boolean).join(', ');
        console.warn(
            `%c[GoalExtractor] Could not parse goal from LLM response (missing: ${missing || 'unknown'})`,
            'color: #ffaa00',
            normalized,
        );
        return null;
    }
    return { source, goal, status: 'active', plan, success };
}

function extractField(text: string, label: string, nextLabels: string[] = []): string | null {
    const escapedLabel = escapeRegex(label);
    const next = nextLabels.length > 0
        ? `(?=^(${nextLabels.map(escapeRegex).join('|')}):\\s*|$)`
        : '$';
    const re = new RegExp(`^${escapedLabel}:\\s*([\\s\\S]*?)${next}`, 'm');
    const match = text.match(re);
    const value = match?.[1]?.trim();
    return value || null;
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function extractGoal(
    npcName: string,
    history: ConversationMessage[],
    worldState: string,
    goalManager: GoalManager,
): Promise<void> {
    const system = GOAL_EXTRACTION.buildSystem(npcName);
    const currentGoals = goalManager.buildPromptContent();
    const transcript = formatTranscript(history);

    const messages: { role: string; content: string }[] = [];
    const goalsText = currentGoals || 'You have no current goals.';
    messages.push({ role: 'user', content: `YOUR CURRENT GOALS:\n${goalsText}` });
    messages.push({ role: 'assistant', content: 'Understood.' });
    messages.push({ role: 'user', content: `WORLD STATE:\n${worldState}\n\nCONVERSATION:\n${transcript}` });

    let response: Response;
    try {
        response = await fetch(LLM_ENDPOINTS.chat, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: GOAL_EXTRACTION.model, system, messages, max_tokens: GOAL_EXTRACTION.maxTokens }),
        });
    } catch (err) {
        console.error(`%c[GoalExtractor] Network error for ${npcName}`, 'color: #ff4444', err);
        return;
    }

    if (!response.ok) {
        console.error(`%c[GoalExtractor] API error for ${npcName}: HTTP ${response.status}`, 'color: #ff4444');
        return;
    }

    const data = await response.json();
    const text: string = String(data.text ?? '').trim();

    console.group(`%c[GoalExtractor] ${npcName}`, 'color: #ff9f43; font-weight: bold');
    console.log(text);
    console.groupEnd();

    const goal = parseGoalFromResponse(text);
    if (!goal) return;

    const active = goalManager.getActiveGoal();
    const pending = goalManager.getPendingGoal();

    // Skip if the extracted goal duplicates the active or pending goal
    if (active && active.goal.toLowerCase() === goal.goal.toLowerCase()) return;
    if (pending && pending.goal.toLowerCase() === goal.goal.toLowerCase()) return;

    if (!active) {
        goalManager.setActiveGoal(goal);
    } else {
        goalManager.setPendingGoal(goal);
    }
    await goalManager.save();
}
