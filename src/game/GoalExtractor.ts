import { ConversationMessage } from './LLMService';
import { Goal, GoalManager } from './GoalManager';
import { GOAL_EXTRACTION } from './prompts';
import { LLM_ENDPOINTS } from './GameConfig';

function formatTranscript(history: ConversationMessage[]): string {
    return history.map(m => `${m.speaker}: ${m.text}`).join('\n');
}

const NONE_RE = /^none\(\s*\)$/m;
const COMPLETE_RE = /^complete_current_goal\(\s*\)$/m;

export type GoalExtractionResult =
    | { kind: 'none' }
    | { kind: 'duplicate'; goal: Goal }
    | { kind: 'activated'; goal: Goal }
    | { kind: 'pending'; goal: Goal }
    | { kind: 'completed'; completedGoal: string; promotedGoal: Goal | null };

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
): Promise<GoalExtractionResult> {
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
        return { kind: 'none' };
    }

    if (!response.ok) {
        console.error(`%c[GoalExtractor] API error for ${npcName}: HTTP ${response.status}`, 'color: #ff4444');
        return { kind: 'none' };
    }

    const data = await response.json();
    const text: string = String(data.text ?? '').trim();

    console.group(`%c[GoalExtractor] ${npcName}`, 'color: #ff9f43; font-weight: bold');
    console.log(text);
    console.groupEnd();

    const normalized = text.replace(/\r\n?/g, '\n').trim();
    if (COMPLETE_RE.test(normalized)) {
        const result = goalManager.completeGoal();
        if (!result) return { kind: 'none' };
        await goalManager.save();
        return { kind: 'completed', completedGoal: result.completed, promotedGoal: result.promoted };
    }

    const goal = parseGoalFromResponse(text);
    if (!goal) return { kind: 'none' };

    const active = goalManager.getActiveGoal();
    const pending = goalManager.getPendingGoal();

    // Skip if the extracted goal duplicates the active or pending goal
    if (active && active.goal.toLowerCase() === goal.goal.toLowerCase()) return { kind: 'duplicate', goal };
    if (pending && pending.goal.toLowerCase() === goal.goal.toLowerCase()) return { kind: 'duplicate', goal };

    if (!active) {
        goalManager.setActiveGoal(goal);
        await goalManager.save();
        return { kind: 'activated', goal };
    } else {
        goalManager.setPendingGoal(goal);
        await goalManager.save();
        return { kind: 'pending', goal };
    }
}
