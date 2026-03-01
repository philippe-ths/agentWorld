import { ConversationMessage } from './LLMService';
import { Goal, GoalManager } from './GoalManager';

function buildExtractionSystemPrompt(npcName: string): string {
    return `You are analyzing a conversation transcript for an NPC called ${npcName}.
Does this conversation contain a NEW request, task, objective, or intention
that ${npcName} should pursue?

This includes:
- Direct requests from the other party ("go check the pond")
- Agreements the NPC made ("I'll head north and meet you there")
- Self-initiated intentions ("I want to find out what's over there")

IMPORTANT: If ${npcName} already has an active or pending goal that matches
what the conversation suggests, respond with none(). Do not re-extract a goal
that is already being tracked.

If yes, respond with the goal in this exact format:
  ## Active Goal
  Source: (who or what prompted this goal, in one sentence)
  Goal: (the objective in one sentence)
  Status: active
  Plan: (how to achieve the goal, given the available commands: move_to, wait, start_conversation_with)
  Tasks: (concrete steps, comma-separated)

If no, respond with:
  none()

Respond with exactly one goal or none(). No commentary.`;
}

function formatTranscript(history: ConversationMessage[]): string {
    return history.map(m => `${m.speaker}: ${m.text}`).join('\n');
}

const NONE_RE = /^none\(\s*\)$/m;

function parseGoalFromResponse(text: string): Goal | null {
    if (NONE_RE.test(text.trim())) return null;

    const source = text.match(/^Source:\s*(.+)$/m)?.[1]?.trim();
    const goal = text.match(/^Goal:\s*(.+)$/m)?.[1]?.trim();
    const plan = text.match(/^Plan:\s*(.+)$/m)?.[1]?.trim();
    const tasks = text.match(/^Tasks:\s*(.+)$/m)?.[1]?.trim();
    if (!source || !goal || !plan || !tasks) {
        console.warn('%c[GoalExtractor] Could not parse goal from LLM response', 'color: #ffaa00', text);
        return null;
    }
    return { source, goal, status: 'active', plan, tasks };
}

export async function extractGoal(
    npcName: string,
    history: ConversationMessage[],
    worldState: string,
    goalManager: GoalManager,
): Promise<void> {
    const system = buildExtractionSystemPrompt(npcName);
    const currentGoals = goalManager.buildPromptContent();
    const transcript = formatTranscript(history);

    const messages: { role: string; content: string }[] = [];
    if (currentGoals) {
        messages.push({ role: 'user', content: `YOUR CURRENT GOALS:\n${currentGoals}` });
        messages.push({ role: 'assistant', content: 'Understood.' });
    }
    messages.push({ role: 'user', content: `WORLD STATE:\n${worldState}\n\nCONVERSATION:\n${transcript}` });

    let response: Response;
    try {
        response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ system, messages, max_tokens: 128 }),
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
    const text: string = data.text;

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
