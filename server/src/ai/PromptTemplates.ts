import type { NPCPersona, Observation, ConversationTurn, WorldBelief, Goal } from '../types.js';

const NPC_PERSONAS: Record<string, NPCPersona> = {
    ada: {
        id: 'ada',
        name: 'Ada',
        personality: 'Curious and analytical. Loves exploring new places and understanding how the world works. Speaks precisely but warmly.',
        goals: ['Map out the entire world', 'Understand the water patterns', 'Make friends with everyone'],
        backstory: 'Ada is a wanderer who arrived in this world seeking knowledge. She believes every tile has a story to tell.',
    },
    bjorn: {
        id: 'bjorn',
        name: 'Bjorn',
        personality: 'Jovial and social. Prefers company over solitude. Tells stories and jokes. A bit scatterbrained.',
        goals: ['Never be alone for long', 'Share stories with others', 'Find the most beautiful spot in the world'],
        backstory: 'Bjorn is a storyteller at heart. He wandered into this world looking for new tales to tell.',
    },
    cora: {
        id: 'cora',
        name: 'Cora',
        personality: 'Thoughtful and philosophical. Observant, often quiet, but speaks with depth when she does. Values meaningful connections.',
        goals: ['Find inner peace', 'Have deep conversations', 'Discover hidden patterns in the landscape'],
        backstory: 'Cora is a contemplative soul who sees beauty in stillness and meaning in movement.',
    },
};

export function getPersona(npcId: string): NPCPersona {
    return NPC_PERSONAS[npcId] ?? NPC_PERSONAS['ada'];
}

export function buildMediumLoopPrompt(
    persona: NPCPersona,
    observation: Observation,
    availableSkills: string[],
    memories: string[],
): string {
    const nearbyList = observation.nearbyEntities.length > 0
        ? observation.nearbyEntities.map(e => `  - ${e.name} at (${e.position.x},${e.position.y}), distance ${e.distance}`).join('\n')
        : '  (nobody nearby)';

    const memorySection = memories.length > 0
        ? `\nRelevant memories:\n${memories.map(m => `  - ${m}`).join('\n')}`
        : '';

    const eventsSection = observation.recentEvents.length > 0
        ? `\nRecent events:\n${observation.recentEvents.map(e => `  - ${e}`).join('\n')}`
        : '';

    const activeGoalSection = observation.activeGoals.length > 0
        ? `\nActive goals:\n${observation.activeGoals
            .map((g, i) => {
                const evalText = g.evaluation.lastEvaluation
                    ? ` | progress=${g.evaluation.lastEvaluation.progressScore.toFixed(2)} (${g.evaluation.lastEvaluation.summary})`
                    : ' | progress=unknown';
                return `  ${i + 1}. [${g.status.toUpperCase()}|p=${g.priority.toFixed(2)}] ${g.description}${evalText}`;
            })
            .join('\n')}`
        : '\nActive goals:\n  (none)';

    return `You are ${persona.name}. ${persona.personality}

Your goals: ${persona.goals.join('; ')}
Background: ${persona.backstory}

Current situation:
- Position: (${observation.position.x}, ${observation.position.y})
- Currently doing: ${observation.currentSkill ?? 'nothing'}
- In conversation: ${observation.isInConversation ? 'yes' : 'no'}
- Nearby entities:
${nearbyList}
${activeGoalSection}${memorySection}${eventsSection}

Available skills: ${availableSkills.join(', ')}

Choose one skill to execute next. Prioritize active commitments first, then personality goals. If a goal requires proximity to someone, prefer approach/move skills that reduce distance. If no urgent goal is active, explore or idle.`;
}

export function buildSlowLoopPrompt(
    persona: NPCPersona,
    observation: Observation,
    conversationHistory: ConversationTurn[],
    partnerName: string,
    memories: string[],
): string {
    const historyText = conversationHistory.length > 0
        ? conversationHistory.map(t => `${t.speaker}: "${t.text}"`).join('\n')
        : '(This is the start of the conversation)';

    const memorySection = memories.length > 0
        ? `\nRelevant memories about ${partnerName}:\n${memories.map(m => `  - ${m}`).join('\n')}`
        : '';

    const activeGoalSection = observation.activeGoals.length > 0
        ? `\nCurrent active goals:\n${observation.activeGoals
            .map((g, i) => `  ${i + 1}. [${g.status}] ${g.description} (priority ${g.priority.toFixed(2)})`)
            .join('\n')}`
        : '\nCurrent active goals:\n  (none)';

    return `You are ${persona.name}. ${persona.personality}

Background: ${persona.backstory}
Goals: ${persona.goals.join('; ')}
${memorySection}${activeGoalSection}

You are having a conversation with ${partnerName}.

Conversation so far:
${historyText}

Respond naturally as ${persona.name}. Keep your response brief (1-2 sentences). Stay in character. Be genuine and interesting. Don't repeat what was already said.

Also decide if this conversation should create a persistent goal. A goal should be extracted only when there is a clear commitment, assignment, or intention that should influence future behavior.

If one NPC asks the other to perform a subtask, include delegation metadata:
- delegation.delegateToPartner=true when this speaker is asking the conversation partner to take on a task.
- delegation.delegatedTask=true when this speaker is accepting a task delegated by the partner.
- add a short delegation.rationale.

If the task is ambiguous, mark needsClarification=true and provide a concise clarification question.`;
}

export function buildReasoningPrompt(
    persona: NPCPersona,
    observation: Observation,
    memories: string[],
    beliefs: WorldBelief,
    context: { stuckCount?: number; failedSkill?: string },
    knowledgeSummary?: string,
): string {
    const nearbyList = observation.nearbyEntities.length > 0
        ? observation.nearbyEntities.map(e => `  - ${e.name} at (${e.position.x},${e.position.y}), distance ${e.distance}`).join('\n')
        : '  (nobody nearby)';

    const memorySection = memories.length > 0
        ? `\nRelevant memories:\n${memories.map(m => `  - ${m}`).join('\n')}`
        : '';

    const eventsSection = observation.recentEvents.length > 0
        ? `\nRecent events:\n${observation.recentEvents.map(e => `  - ${e}`).join('\n')}`
        : '';

    let beliefSection = '';
    const entityNames = Object.keys(beliefs.knownEntities);
    if (entityNames.length > 0 || beliefs.insights.length > 0) {
        beliefSection = '\nYour beliefs about the world:';
        if (entityNames.length > 0) {
            beliefSection += '\n  Known entities:';
            for (const name of entityNames) {
                const info = beliefs.knownEntities[name];
                beliefSection += `\n    - ${name}: ${info.relationship} (last seen at ${info.lastSeen.x},${info.lastSeen.y})`;
            }
        }
        if (beliefs.insights.length > 0) {
            beliefSection += '\n  Insights:';
            for (const insight of beliefs.insights) {
                beliefSection += `\n    - ${insight}`;
            }
        }
    }

    let situationContext = '';
    if (context.stuckCount && context.stuckCount > 0) {
        situationContext = `\nYou've been stuck ${context.stuckCount} times recently.`;
        if (context.failedSkill) {
            situationContext += ` Your last attempt was "${context.failedSkill}" which didn't work.`;
        }
        situationContext += ' Consider a different approach.';
    }

    return `You are ${persona.name}. ${persona.personality}

Your goals: ${persona.goals.join('; ')}
Background: ${persona.backstory}

Current situation:
- Position: (${observation.position.x}, ${observation.position.y})
- Currently doing: ${observation.currentSkill ?? 'nothing'}
- Nearby entities:
${nearbyList}
${memorySection}${eventsSection}${beliefSection}${situationContext}${knowledgeSummary ? '\nKnowledge graph:\n' + knowledgeSummary : ''}

Think deeply about your situation. What should you do next? Consider:
1. Your personality and goals
2. What you've learned from recent events and memories
3. Whether to move somewhere specific, talk to someone, or wait

Provide a concrete plan of actions, any new beliefs about the world, or something to say aloud.`;
}

export function buildReflectionPrompt(
    events: string[],
    context?: { activeGoals?: string[]; recentOutcomes?: string[] },
): string {
    const goalSection = context?.activeGoals && context.activeGoals.length > 0
        ? `\nActive goals during this period:\n${context.activeGoals.map(g => `- ${g}`).join('\n')}`
        : '';

    const outcomeSection = context?.recentOutcomes && context.recentOutcomes.length > 0
        ? `\nRecent goal outcomes:\n${context.recentOutcomes.map(o => `- ${o}`).join('\n')}`
        : '';

    return `Review these recent observations and distill them into 1-3 key insights. Focus on patterns, relationships, and useful knowledge.

Observations:
${events.map(e => `- ${e}`).join('\n')}
${goalSection}${outcomeSection}

Write each insight as a single concise sentence.`;
}

export function buildSelfCritiquePrompt(
    persona: NPCPersona,
    failureEvents: string[],
    context: {
        skill?: string;
        stuckCount?: number;
        goalDescription?: string;
        evaluationCriteria?: string;
        outcome?: string;
        resourceCost?: string;
    },
): string {
    return `You are ${persona.name}. ${persona.personality}

You recently experienced failures while trying to act in the world:
${failureEvents.map(e => `- ${e}`).join('\n')}

${context.skill ? `The skill you were using: "${context.skill}"` : ''}
${context.stuckCount ? `You got stuck ${context.stuckCount} times.` : ''}
${context.goalDescription ? `Goal: "${context.goalDescription}"` : ''}
${context.evaluationCriteria ? `Evaluation criteria: ${context.evaluationCriteria}` : ''}
${context.outcome ? `Outcome: ${context.outcome}` : ''}
${context.resourceCost ? `Resource cost: ${context.resourceCost}` : ''}

Analyze what went wrong. Write 1-2 specific, actionable lessons learned. Each lesson should be a single sentence that will help you avoid this exact mistake in the future.

Examples of good lessons:
- "Water tiles at the edge of ponds are not walkable, approach from the opposite side."
- "Trying to move_to a tile occupied by another entity will always fail."
- "When stuck repeatedly, try wandering in a different direction instead of the same path."

Write only the lessons, one per line.`;
}

export function buildGoalEvaluationPrompt(
    persona: NPCPersona,
    observation: Observation,
    goal: Goal,
): string {
    const nearbyList = observation.nearbyEntities.length > 0
        ? observation.nearbyEntities.map(e => `${e.name} (${e.distance} tiles)`).join(', ')
        : 'nobody nearby';

    return `You are ${persona.name}. Evaluate progress on your active goal.

GOAL: "${goal.description}"
SUCCESS CRITERIA: ${goal.evaluation.successCriteria}
PROGRESS SIGNAL: ${goal.evaluation.progressSignal}
FAILURE SIGNAL: ${goal.evaluation.failureSignal}
COMPLETION CONDITION: ${goal.evaluation.completionCondition}

CURRENT STATE:
- Position: (${observation.position.x}, ${observation.position.y})
- Current skill: ${observation.currentSkill ?? 'none'}
- Nearby: ${nearbyList}
- Recent events:
${observation.recentEvents.length > 0 ? observation.recentEvents.map(e => `  - ${e}`).join('\n') : '  - none'}

Return an evaluation with:
- progress_score (0.0-1.0)
- summary (one sentence)
- should_escalate (true if goal needs deep reasoning help)`;
}
