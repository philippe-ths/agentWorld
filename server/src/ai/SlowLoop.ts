import { enqueue, Priority } from './ApiQueue.js';

// Placeholder stubs — rebuilt in Phase 3 as protocol-aware LLM calls

export async function generateDialogue(
    npcId: string,
    observation: any,
    conversationHistory: any[],
    partnerName: string,
): Promise<any> {
    return {
        type: 'dialogue',
        dialogue: '...',
    };
}

export async function generateReasoning(
    npcId: string,
    observation: any,
    context: { stuckCount?: number; failedSkill?: string },
): Promise<any> {
    return {
        type: 'plan',
        actions: [{ type: 'wait', duration: 3000 }],
    };
}
