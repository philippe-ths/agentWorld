import Anthropic from '@anthropic-ai/sdk';
import type { Observation, SkillSelection } from '../types.js';
import { getPersona, buildMediumLoopPrompt } from './PromptTemplates.js';
import { getMatchingSkills, getAllSkillNames } from '../skills/SkillLibrary.js';
import { getRelevantMemories } from '../memory/LongTermMemory.js';

const client = new Anthropic({ maxRetries: 3 });

function estimateHaikuCostUSD(inputTokens: number, outputTokens: number): number {
    // Approximate list pricing per 1M tokens (kept lightweight for simulation economics).
    const inCostPerM = 0.8;
    const outCostPerM = 4.0;
    return (inputTokens / 1_000_000) * inCostPerM + (outputTokens / 1_000_000) * outCostPerM;
}

export async function mediumLoopTick(observation: Observation): Promise<SkillSelection> {
    const persona = getPersona(observation.npcId);
    const skills = getMatchingSkills(observation);
    const memories = await getRelevantMemories(observation.npcId, observation);

    const prompt = buildMediumLoopPrompt(persona, observation, skills, memories);

    // Build tool schema dynamically so new skills are included
    const skillNames = getAllSkillNames();
    const skillTool: Anthropic.Tool = {
        name: 'select_skill',
        description: 'Select a skill for the NPC to execute next',
        input_schema: {
            type: 'object' as const,
            properties: {
                skill: {
                    type: 'string',
                    description: 'The skill name to execute',
                    enum: skillNames,
                },
                params: {
                    type: 'object',
                    description: 'Parameters for the skill',
                    properties: {
                        targetX: { type: 'number', description: 'Target tile X coordinate' },
                        targetY: { type: 'number', description: 'Target tile Y coordinate' },
                        entityName: { type: 'string', description: 'Name of entity to interact with' },
                        duration: { type: 'number', description: 'Duration in ms for idle/wait' },
                    },
                },
                reasoning: {
                    type: 'string',
                    description: 'Brief explanation of why this skill was chosen',
                },
            },
            required: ['skill', 'params', 'reasoning'],
        },
    };

    try {
        const response = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 256,
            tools: [skillTool],
            tool_choice: { type: 'tool', name: 'select_skill' },
            messages: [{ role: 'user', content: prompt }],
        });

        const toolBlock = response.content.find(b => b.type === 'tool_use');
        if (toolBlock && toolBlock.type === 'tool_use') {
            const input = toolBlock.input as { skill: string; params: Record<string, unknown>; reasoning?: string };

            const inputTokens = response.usage?.input_tokens ?? 0;
            const outputTokens = response.usage?.output_tokens ?? 0;

            // If converse is selected, escalate to slow loop for dialogue
            const escalate = input.skill === 'converse';

            return {
                skill: input.skill,
                params: input.params ?? {},
                escalate,
                reasoning: input.reasoning,
                llmUsage: {
                    model: 'claude-haiku-4-5-20251001',
                    inputTokens,
                    outputTokens,
                    estimatedCostUSD: estimateHaikuCostUSD(inputTokens, outputTokens),
                },
            };
        }
    } catch (err) {
        console.error('[MediumLoop] Error:', err);
    }

    // Fallback: idle
    return { skill: 'idle', params: { duration: 3000 } };
}
