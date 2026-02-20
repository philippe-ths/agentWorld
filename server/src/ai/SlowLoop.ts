import Anthropic from '@anthropic-ai/sdk';
import type { Observation, ReasoningResult, ConversationTurn } from '../types.js';
import { getPersona, buildSlowLoopPrompt, buildReasoningPrompt } from './PromptTemplates.js';
import { getRelevantMemories, loadBeliefs } from '../memory/LongTermMemory.js';
import { summarizeKnowledge } from '../memory/KnowledgeGraph.js';

const client = new Anthropic({ maxRetries: 3 });

export async function generateDialogue(
    npcId: string,
    observation: Observation,
    conversationHistory: ConversationTurn[],
    partnerName: string,
): Promise<ReasoningResult> {
    const persona = getPersona(npcId);
    const memories = await getRelevantMemories(npcId, observation);
    const prompt = buildSlowLoopPrompt(persona, observation, conversationHistory, partnerName, memories);

    try {
        const response = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 200,
            messages: [{ role: 'user', content: prompt }],
        });

        const textBlock = response.content.find(b => b.type === 'text');
        if (textBlock && textBlock.type === 'text') {
            return {
                type: 'dialogue',
                dialogue: textBlock.text.trim(),
            };
        }
    } catch (err) {
        console.error('[SlowLoop] Error:', err);
    }

    return {
        type: 'dialogue',
        dialogue: '...',
    };
}

// ── General reasoning (novel situations, stuck recovery, planning) ──

const REASONING_TOOL: Anthropic.Tool = {
    name: 'reason_response',
    description: 'Provide your reasoned response: a plan of actions, updated beliefs, or something to say',
    input_schema: {
        type: 'object' as const,
        properties: {
            response_type: {
                type: 'string',
                enum: ['plan', 'dialogue', 'belief_update'],
                description: 'The primary type of your response',
            },
            plan: {
                type: 'array',
                description: 'A sequence of actions to execute (for plan type)',
                items: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['move', 'wait', 'speak'], description: 'Action type' },
                        targetX: { type: 'number', description: 'Target tile X (for move)' },
                        targetY: { type: 'number', description: 'Target tile Y (for move)' },
                        duration: { type: 'number', description: 'Duration in ms (for wait)' },
                        text: { type: 'string', description: 'Text to say (for speak)' },
                    },
                    required: ['action'],
                },
            },
            dialogue: {
                type: 'string',
                description: 'Something to say aloud',
            },
            beliefs: {
                type: 'object',
                description: 'Updated beliefs about entities and the world',
                properties: {
                    entities: {
                        type: 'object',
                        description: 'Map of entity name to relationship info',
                        additionalProperties: {
                            type: 'object',
                            properties: {
                                relationship: { type: 'string', description: 'Relationship description' },
                            },
                        },
                    },
                    insights: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'New insights about the world',
                    },
                },
            },
            reasoning: {
                type: 'string',
                description: 'Brief explanation of your reasoning',
            },
            new_skill: {
                type: 'object',
                description: 'If you discovered a reusable strategy, define it as a new skill',
                properties: {
                    name: { type: 'string', description: 'Snake_case name for the skill' },
                    description: { type: 'string', description: 'What this skill does' },
                    steps: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Ordered list of existing skill names that compose this skill',
                    },
                    preconditions: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Rules like "not in conversation" or "entity nearby"',
                    },
                },
                required: ['name', 'description'],
            },
        },
        required: ['response_type', 'reasoning'],
    },
};

export async function generateReasoning(
    npcId: string,
    observation: Observation,
    context: { stuckCount?: number; failedSkill?: string },
): Promise<ReasoningResult> {
    const persona = getPersona(npcId);
    const memories = await getRelevantMemories(npcId, observation);
    const beliefs = await loadBeliefs(npcId);
    const kgSummary = await summarizeKnowledge(npcId);
    const prompt = buildReasoningPrompt(persona, observation, memories, beliefs, context, kgSummary);

    try {
        const response = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 400,
            tools: [REASONING_TOOL],
            tool_choice: { type: 'tool', name: 'reason_response' },
            messages: [{ role: 'user', content: prompt }],
        });

        const toolBlock = response.content.find(b => b.type === 'tool_use');
        if (toolBlock && toolBlock.type === 'tool_use') {
            const input = toolBlock.input as {
                response_type: string;
                plan?: Array<{ action: string; targetX?: number; targetY?: number; duration?: number; text?: string }>;
                dialogue?: string;
                beliefs?: { entities?: Record<string, { relationship: string }>; insights?: string[] };
                reasoning?: string;
                new_skill?: { name: string; description: string; steps?: string[]; preconditions?: string[] };
            };

            console.log(`[SlowLoop] ${npcId} reasoning: ${input.reasoning}`);

            const result: ReasoningResult = { type: input.response_type as ReasoningResult['type'] };

            if (input.plan && input.plan.length > 0) {
                result.actions = input.plan.map(a => {
                    switch (a.action) {
                        case 'move': return { type: 'move' as const, target: { x: a.targetX ?? 0, y: a.targetY ?? 0 } };
                        case 'speak': return { type: 'speak' as const, text: a.text ?? '...' };
                        default: return { type: 'wait' as const, duration: a.duration ?? 2000 };
                    }
                });
            }

            if (input.dialogue) result.dialogue = input.dialogue;
            if (input.beliefs) result.beliefs = input.beliefs;
            if (input.new_skill) result.newSkill = input.new_skill;

            return result;
        }
    } catch (err) {
        console.error('[SlowLoop] Reasoning error:', err);
    }

    return { type: 'plan', actions: [{ type: 'wait', duration: 3000 }] };
}
