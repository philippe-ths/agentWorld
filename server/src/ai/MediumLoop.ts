import type Anthropic from '@anthropic-ai/sdk';
import type { Observation, SkillSelection, Goal } from '../types.js';
import { getPersona, buildMediumLoopPrompt } from './PromptTemplates.js';
import { getMatchingSkills, getAllSkillNames } from '../skills/SkillLibrary.js';
import { getRelevantMemories } from '../memory/LongTermMemory.js';
import { enqueue, Priority } from './ApiQueue.js';

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

    const activeGoal = observation.activeGoals.find((g: Goal) => g.status === 'active');
    const prompt = buildMediumLoopPrompt(persona, observation, skills, memories, activeGoal);

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
                goal_evaluation: {
                    type: 'object',
                    description: 'If you have an active goal, evaluate your current progress',
                    properties: {
                        progress_score: { type: 'number', description: '0.0 to 1.0 progress toward completion' },
                        summary: { type: 'string', description: 'One sentence summary of current progress' },
                        should_escalate: { type: 'boolean', description: 'True if goal needs deeper reasoning intervention' },
                        gap_analysis: { type: 'string', description: 'What remains to be done' },
                    },
                    required: ['progress_score', 'summary', 'should_escalate', 'gap_analysis'],
                },
            },
            required: ['skill', 'params', 'reasoning'],
        },
    };

    try {
        const priority = activeGoal ? Priority.TICK_GOAL : Priority.TICK_IDLE;
        const response = await enqueue(priority, {
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 350,
            tools: [skillTool],
            tool_choice: { type: 'tool', name: 'select_skill' },
            messages: [{ role: 'user', content: prompt }],
        });

        const toolBlock = response.content.find(b => b.type === 'tool_use');
        if (toolBlock && toolBlock.type === 'tool_use') {
            const input = toolBlock.input as {
                skill: string;
                params: Record<string, unknown>;
                reasoning?: string;
                goal_evaluation?: {
                    progress_score: number;
                    summary: string;
                    should_escalate: boolean;
                    gap_analysis?: string;
                };
            };

            const inputTokens = response.usage?.input_tokens ?? 0;
            const outputTokens = response.usage?.output_tokens ?? 0;

            // If converse is selected, escalate to slow loop for dialogue
            const escalate = input.skill === 'converse';

            const result: SkillSelection = {
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

            // Extract inline goal evaluation if present
            if (input.goal_evaluation) {
                result.goalEvaluation = {
                    timestamp: Date.now(),
                    progressScore: Math.max(0, Math.min(1, input.goal_evaluation.progress_score)),
                    summary: input.goal_evaluation.summary,
                    shouldEscalate: input.goal_evaluation.should_escalate,
                    gapAnalysis: input.goal_evaluation.gap_analysis,
                };
            }

            return result;
        }
    } catch (err) {
        console.error('[MediumLoop] Error:', err);
    }

    // Fallback: idle
    return { skill: 'idle', params: { duration: 3000 } };
}
