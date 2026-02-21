import type { SkillSelection, ReasoningResult, Observation, Goal, GoalEvaluationResult } from './types';

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
    goalDescription?: string,
    goalContext?: string,
    evaluationCriteria?: string,
    outcome?: string,
    resourceCost?: string,
): void {
    fetch(`${BASE_URL}/api/npc/failure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            npcId,
            failureEvents,
            skill,
            stuckCount,
            goalDescription,
            goalContext,
            evaluationCriteria,
            outcome,
            resourceCost,
        }),
    }).catch(() => {});
}

export function reportSkillOutcome(skill: string, success: boolean): void {
    fetch(`${BASE_URL}/api/npc/skill-outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill, success }),
    }).catch(() => {});
}

export function reportCommitment(
    npcId: string,
    from: string,
    to: string,
    goalId: string,
    description: string,
    status: 'agreed' | 'in_progress' | 'completed' | 'failed',
): void {
    fetch(`${BASE_URL}/api/npc/commitment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npcId, from, to, goalId, description, status }),
    }).catch(() => {});
}

export async function evaluateGoal(
    npcId: string,
    observation: Observation,
    goal: Goal,
): Promise<GoalEvaluationResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
        const res = await fetch(`${BASE_URL}/api/npc/goal/evaluate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ npcId, observation, goal }),
            signal: controller.signal,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as GoalEvaluationResult;
    } catch (err) {
        console.warn(`[AgentClient] evaluateGoal failed for ${npcId}:`, err);
        return {
            timestamp: Date.now(),
            progressScore: 0.5,
            summary: 'Goal evaluation unavailable; maintaining current strategy.',
            shouldEscalate: false,
        };
    } finally {
        clearTimeout(timeout);
    }
}
