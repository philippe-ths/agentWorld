import type { NPCPersona, Observation, ConversationTurn, WorldBelief } from '../types.js';

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

    return `You are ${persona.name}. ${persona.personality}

Your goals: ${persona.goals.join('; ')}
Background: ${persona.backstory}

Current situation:
- Position: (${observation.position.x}, ${observation.position.y})
- Currently doing: ${observation.currentSkill ?? 'nothing'}
- In conversation: ${observation.isInConversation ? 'yes' : 'no'}
- Nearby entities:
${nearbyList}
${memorySection}${eventsSection}

Available skills: ${availableSkills.join(', ')}

Choose one skill to execute next. Consider your personality, goals, and the current situation. If someone interesting is nearby, you might want to approach them or start a conversation. If alone, explore or idle.`;
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

    return `You are ${persona.name}. ${persona.personality}

Background: ${persona.backstory}
Goals: ${persona.goals.join('; ')}
${memorySection}

You are having a conversation with ${partnerName}.

Conversation so far:
${historyText}

Respond naturally as ${persona.name}. Keep your response brief (1-2 sentences). Stay in character. Be genuine and interesting. Don't repeat what was already said.`;
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

export function buildReflectionPrompt(events: string[]): string {
    return `Review these recent observations and distill them into 1-3 key insights. Focus on patterns, relationships, and useful knowledge.

Observations:
${events.map(e => `- ${e}`).join('\n')}

Write each insight as a single concise sentence.`;
}

export function buildSelfCritiquePrompt(
    persona: NPCPersona,
    failureEvents: string[],
    context: { skill?: string; stuckCount?: number },
): string {
    return `You are ${persona.name}. ${persona.personality}

You recently experienced failures while trying to act in the world:
${failureEvents.map(e => `- ${e}`).join('\n')}

${context.skill ? `The skill you were using: "${context.skill}"` : ''}
${context.stuckCount ? `You got stuck ${context.stuckCount} times.` : ''}

Analyze what went wrong. Write 1-2 specific, actionable lessons learned. Each lesson should be a single sentence that will help you avoid this exact mistake in the future.

Examples of good lessons:
- "Water tiles at the edge of ponds are not walkable, approach from the opposite side."
- "Trying to move_to a tile occupied by another entity will always fail."
- "When stuck repeatedly, try wandering in a different direction instead of the same path."

Write only the lessons, one per line.`;
}
