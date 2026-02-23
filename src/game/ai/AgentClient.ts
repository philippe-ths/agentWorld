import type { SkillSelection, ReasoningResult, Observation } from './types';

const BASE_URL = 'http://localhost:3001';

export async function tick(observation: Observation): Promise<SkillSelection> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
        const res = await fetch(`${BASE_URL}/api/npc/tick`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(observation),
            signal: controller.signal,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as SkillSelection;
    } catch (err) {
        console.warn(`[AgentClient] tick failed for ${observation.npcId}:`, err);
        return { skill: 'idle', params: { duration: 5000 } };
    } finally {
        clearTimeout(timeout);
    }
}

export async function reason(
    npcId: string,
    observation: Observation,
    conversationHistory: { speaker: string; text: string }[],
    partnerName: string,
): Promise<ReasoningResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
        const res = await fetch(`${BASE_URL}/api/npc/reason`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ npcId, observation, conversationHistory, partnerName }),
            signal: controller.signal,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ReasoningResult;
    } catch (err) {
        console.warn(`[AgentClient] reason failed for ${npcId}:`, err);
        return { type: 'dialogue' as const, dialogue: '...' } satisfies ReasoningResult;
    } finally {
        clearTimeout(timeout);
    }
}

export async function reasonGeneral(
    npcId: string,
    observation: Observation,
    context: { stuckCount?: number; failedSkill?: string },
): Promise<ReasoningResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
        const res = await fetch(`${BASE_URL}/api/npc/reason`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ npcId, observation, mode: 'reasoning', ...context }),
            signal: controller.signal,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ReasoningResult;
    } catch (err) {
        console.warn(`[AgentClient] reasonGeneral failed for ${npcId}:`, err);
        return { type: 'plan', actions: [{ type: 'wait', duration: 3000 }] };
    } finally {
        clearTimeout(timeout);
    }
}

export function reportFailure(
    npcId: string,
    failureEvents: string[],
    skill?: string,
    stuckCount?: number,
): void {
    fetch(`${BASE_URL}/api/npc/failure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npcId, failureEvents, skill, stuckCount }),
    }).catch(() => {});
}

export function reportSkillOutcome(skill: string, success: boolean): void {
    fetch(`${BASE_URL}/api/npc/skill-outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill, success }),
    }).catch(() => {});
}

// ── Protocol endpoints ──────────────────────────────────

export interface ProposeSubTask {
    id: string;
    description: string;
    completionCriteria: string;
    actions?: { type: string; [key: string]: unknown }[];
    dependencies?: string[];
}

export interface ProposeResponse {
    type: 'propose';
    id: string;
    from: string;
    taskDescription: string;
    interpretation?: string;
    subTasks?: ProposeSubTask[];
    completionCriteria?: string;
    rollupLogic?: string;
    failureModes?: string[];
}

export interface DialogueResponse {
    dialogue: string;
    internalThought?: string;
    taskRequested?: string | null;
}

export interface EvaluateResponse {
    approved: boolean;
    type?: 'question';
    id?: string;
    from?: string;
    kind?: string;
    concern?: string;
    evidence?: string;
    suggestedAlternative?: string;
}

export interface ReviseResponse {
    type: 'revise';
    id: string;
    from: string;
    originalProposalId: string;
    triggeredBy: string;
    revisedSubTasks?: { id: string; description: string; completionCriteria: string }[];
    revisedCompletionCriteria?: string;
    explanation?: string;
}

export interface RememberResponse {
    type: 'remember';
    id: string;
    from: string;
    lessons: { insight: string; condition: string; confidence: number }[];
}

export async function propose(
    npcId: string,
    taskDescription: string,
    worldSummary: string,
    capabilities?: string,
    memories?: string[],
): Promise<ProposeResponse> {
    const res = await fetch(`${BASE_URL}/api/protocol/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npcId, taskDescription, worldSummary, capabilities, memories }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as ProposeResponse;
}

export async function dialogue(
    npcId: string,
    partner: string,
    worldSummary: string,
    history?: { speaker: string; text: string }[],
    purpose?: string,
    memories?: string[],
): Promise<DialogueResponse> {
    const res = await fetch(`${BASE_URL}/api/protocol/dialogue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npcId, partner, worldSummary, history, purpose, memories }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as DialogueResponse;
}

export async function evaluateProposal(
    npcId: string,
    proposal: {
        taskDescription: string;
        interpretation: string;
        subTasks: { id: string; description: string; completionCriteria: string }[];
        completionCriteria: string;
        rollupLogic: string;
    },
    worldSummary: string,
    memories?: string[],
): Promise<EvaluateResponse> {
    const res = await fetch(`${BASE_URL}/api/protocol/evaluate-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npcId, proposal, worldSummary, memories }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as EvaluateResponse;
}

export async function revise(
    npcId: string,
    originalProposal: {
        taskDescription: string;
        interpretation: string;
        subTasks: { id: string; description: string; completionCriteria: string }[];
        completionCriteria: string;
    },
    question: {
        kind: string;
        concern: string;
        evidence: string;
        suggestedAlternative?: string;
    },
    worldSummary: string,
): Promise<ReviseResponse> {
    const res = await fetch(`${BASE_URL}/api/protocol/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npcId, originalProposal, question, worldSummary }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as ReviseResponse;
}

export async function remember(
    npcId: string,
    taskContext: string,
    outcome: string,
): Promise<RememberResponse> {
    const res = await fetch(`${BASE_URL}/api/protocol/remember`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npcId, taskContext, outcome }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as RememberResponse;
}

// ── Memory endpoints ──────────────────────────────────

export async function fetchRelevantMemories(
    npcId: string,
    query: string,
): Promise<string[]> {
    try {
        const res = await fetch(`${BASE_URL}/api/memory/relevant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ npcId, query }),
        });
        if (!res.ok) return [];
        const data = (await res.json()) as { memories: string[] };
        return data.memories ?? [];
    } catch {
        return [];
    }
}

export async function storeMemory(
    npcId: string,
    text: string,
    type: string = 'lesson',
    importance: number = 0.7,
): Promise<void> {
    fetch(`${BASE_URL}/api/memory/store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npcId, text, type, importance }),
    }).catch(() => {});
}
