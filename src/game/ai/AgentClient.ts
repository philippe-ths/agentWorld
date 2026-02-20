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
