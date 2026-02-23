import type Anthropic from '@anthropic-ai/sdk';
import type { Observation, ReasoningResult, ConversationTurn, Goal, GoalEvaluationResult } from '../types.js';
import { getPersona, buildSlowLoopPrompt, buildReasoningPrompt, buildGoalEvaluationPrompt } from './PromptTemplates.js';
import { getRelevantMemories, loadBeliefs } from '../memory/LongTermMemory.js';
import { summarizeKnowledge } from '../memory/KnowledgeGraph.js';
import { enqueue, Priority } from './ApiQueue.js';

function estimateSonnetCostUSD(inputTokens: number, outputTokens: number): number {
    const inCostPerM = 3.0;
    const outCostPerM = 15.0;
    return (inputTokens / 1_000_000) * inCostPerM + (outputTokens / 1_000_000) * outCostPerM;
}

function estimateHaikuCostUSD(inputTokens: number, outputTokens: number): number {
    const inCostPerM = 0.8;
    const outCostPerM = 4.0;
    return (inputTokens / 1_000_000) * inCostPerM + (outputTokens / 1_000_000) * outCostPerM;
}

const DIALOGUE_TOOL: Anthropic.Tool = {
    name: 'extract_goal_and_reply',
    description: 'Provide dialogue response and optional structured goal extraction from conversation intent',
    input_schema: {
        type: 'object' as const,
        properties: {
            dialogue: { type: 'string', description: 'What to say in this turn (1-2 sentences)' },
            goalExtraction: {
                type: 'object',
                properties: {
                    shouldCreateGoal: { type: 'boolean' },
                    goal: {
                        type: 'object',
                        properties: {
                            type: { type: 'string' },
                            description: { type: 'string' },
                            priority: { type: 'number' },
                            evaluation: {
                                type: 'object',
                                properties: {
                                    successCriteria: { type: 'string' },
                                    progressSignal: { type: 'string' },
                                    failureSignal: { type: 'string' },
                                    completionCondition: { type: 'string' },
                                },
                                required: ['successCriteria', 'progressSignal', 'failureSignal', 'completionCondition'],
                            },
                            estimatedDifficulty: {
                                type: 'string',
                                enum: ['trivial', 'simple', 'moderate', 'complex'],
                            },
                            needsClarification: { type: 'boolean' },
                            clarificationQuestion: { type: 'string' },
                            delegation: {
                                type: 'object',
                                properties: {
                                    delegateToPartner: { type: 'boolean' },
                                    delegatedTask: { type: 'boolean' },
                                    rationale: { type: 'string' },
                                },
                            },
                        },
                        required: ['type', 'description', 'priority', 'evaluation', 'estimatedDifficulty', 'needsClarification'],
                    },
                },
                required: ['shouldCreateGoal'],
            },
        },
        required: ['dialogue', 'goalExtraction'],
    },
};

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
        const response = await enqueue(Priority.DIALOGUE, {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 350,
            tools: [DIALOGUE_TOOL],
            tool_choice: { type: 'tool', name: 'extract_goal_and_reply' },
            messages: [{ role: 'user', content: prompt }],
        });

        const toolBlock = response.content.find(b => b.type === 'tool_use');
        if (toolBlock && toolBlock.type === 'tool_use') {
            const input = toolBlock.input as {
                dialogue: string;
                goalExtraction?: ReasoningResult['goalExtraction'];
            };

            return {
                type: 'dialogue',
                dialogue: input.dialogue?.trim() || '...',
                goalExtraction: input.goalExtraction,
                llmUsage: {
                    model: 'claude-sonnet-4-20250514',
                    inputTokens: response.usage?.input_tokens ?? 0,
                    outputTokens: response.usage?.output_tokens ?? 0,
                    estimatedCostUSD: estimateSonnetCostUSD(
                        response.usage?.input_tokens ?? 0,
                        response.usage?.output_tokens ?? 0,
                    ),
                },
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
                description: 'A sequence of actions to execute (for plan type). Each action should advance a specific goal.',
                items: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['move', 'wait', 'speak'], description: 'Action type' },
                        targetX: { type: 'number', description: 'Target tile X (for move)' },
                        targetY: { type: 'number', description: 'Target tile Y (for move)' },
                        duration: { type: 'number', description: 'Duration in ms (for wait)' },
                        text: { type: 'string', description: 'Text to say (for speak)' },
                        purpose: { type: 'string', description: 'Why this action advances the goal (e.g. "travel to Cora\'s last known area")' },
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

const GOAL_EVAL_TOOL: Anthropic.Tool = {
    name: 'goal_evaluation',
    description: 'Evaluate current progress toward a goal',
    input_schema: {
        type: 'object' as const,
        properties: {
            progress_score: { type: 'number', description: '0.0 to 1.0 progress toward completion' },
            summary: { type: 'string', description: 'One sentence summary of current progress' },
            should_escalate: { type: 'boolean', description: 'True if goal needs deeper reasoning intervention' },
            gap_analysis: { type: 'string', description: 'What remains to be done. List each sub-condition and whether it is met or not. Be specific about entities, locations, and next steps.' },
        },
        required: ['progress_score', 'summary', 'should_escalate', 'gap_analysis'],
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
        const response = await enqueue(Priority.REASONING, {
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
            result.llmUsage = {
                model: 'claude-sonnet-4-20250514',
                inputTokens: response.usage?.input_tokens ?? 0,
                outputTokens: response.usage?.output_tokens ?? 0,
                estimatedCostUSD: estimateSonnetCostUSD(
                    response.usage?.input_tokens ?? 0,
                    response.usage?.output_tokens ?? 0,
                ),
            };

            return result;
        }
    } catch (err) {
        console.error('[SlowLoop] Reasoning error:', err);
    }

    return { type: 'plan', actions: [{ type: 'wait', duration: 3000 }] };
}

export async function evaluateGoalProgress(
    npcId: string,
    observation: Observation,
    goal: Goal,
): Promise<GoalEvaluationResult> {
    const persona = getPersona(npcId);
    const prompt = buildGoalEvaluationPrompt(persona, observation, goal);

    try {
        const response = await enqueue(Priority.EVALUATION, {
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 250,
            tools: [GOAL_EVAL_TOOL],
            tool_choice: { type: 'tool', name: 'goal_evaluation' },
            messages: [{ role: 'user', content: prompt }],
        });

        const toolBlock = response.content.find(b => b.type === 'tool_use');
        if (toolBlock && toolBlock.type === 'tool_use') {
            const input = toolBlock.input as {
                progress_score: number;
                summary: string;
                should_escalate: boolean;
                gap_analysis?: string;
            };

            return {
                timestamp: Date.now(),
                progressScore: Math.max(0, Math.min(1, input.progress_score)),
                summary: input.summary,
                shouldEscalate: input.should_escalate,
                gapAnalysis: input.gap_analysis,
                llmUsage: {
                    model: 'claude-haiku-4-5-20251001',
                    inputTokens: response.usage?.input_tokens ?? 0,
                    outputTokens: response.usage?.output_tokens ?? 0,
                    estimatedCostUSD: estimateHaikuCostUSD(
                        response.usage?.input_tokens ?? 0,
                        response.usage?.output_tokens ?? 0,
                    ),
                },
            };
        }
    } catch (err) {
        console.error('[SlowLoop] Goal evaluation error:', err);
    }

    return {
        timestamp: Date.now(),
        progressScore: 0.5,
        summary: 'Unable to evaluate progress reliably; continuing current approach.',
        shouldEscalate: false,
    };
}
