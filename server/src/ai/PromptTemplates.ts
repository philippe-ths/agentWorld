import type { NPCPersona, Observation, ConversationTurn, WorldBelief, Goal } from '../types.js';

const NPC_PERSONAS: Record<string, NPCPersona> = {
    ada: {
        id: 'ada',
        name: 'Ada',
        personality: 'Helpful NPC.',
        goals: ["Assist"],
    },
    bjorn: {
        id: 'bjorn',
        name: 'Bjorn',
        personality: 'Helpful NPC.',
        goals: ["Assist"],
    },
    cora: {
        id: 'cora',
        name: 'Cora',
        personality: 'Helpful NPC.',
        goals: ["Assist"],
    },
};

export function getPersona(npcId: string): NPCPersona {
    return NPC_PERSONAS[npcId] ?? NPC_PERSONAS['ada'];
}

export function buildWorldPreamble(): string {
    return `WORLD: You are in a 64×64 tile grid world. Tiles are grass (walkable) or water (blocked).
There are exactly 4 entities: Player, Ada, Bjorn, and Cora.

YOUR CAPABILITIES:
- You can move one tile at a time along walkable paths
- You can speak, but only entities within ~2 tiles can see your speech bubble
- You can only interact with entities listed in NEARBY ENTITIES
- You cannot communicate with distant entities — you must physically travel to them
- Movement takes real time: roughly 1 tile per second along a path

SKILLS:
- wander: move to a random nearby tile (for exploration)
- move_to(x, y): pathfind to a specific coordinate
- approach_entity(name): walk toward a nearby entity (must be in NEARBY ENTITIES)
- converse(name): start a conversation (entity must be within 3 tiles)
- idle: wait in place

IMPORTANT: If an entity is not in your NEARBY ENTITIES list, you don't know where they are. You must either recall their last known position from memory, ask someone who might know, or explore to find them.

`;
}

export function buildMediumLoopPrompt(
    persona: NPCPersona,
    observation: Observation,
    availableSkills: string[],
    memories: string[],
    activeGoal?: Goal,
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
                let line = `  ${i + 1}. [${g.status.toUpperCase()}|p=${g.priority.toFixed(2)}] ${g.description}${evalText}`;
                if (g.evaluation.lastEvaluation?.gapAnalysis) {
                    line += `\n     GAP: ${g.evaluation.lastEvaluation.gapAnalysis}`;
                }
                if (g.planAgenda && g.planAgenda.length > 0) {
                    line += '\n     PLAN:';
                    for (const step of g.planAgenda) {
                        line += `\n       ${step.done ? '\u2705' : '\u2192'} ${step.skill}${step.target ? ` (${step.target})` : ''} \u2014 ${step.purpose}`;
                    }
                }
                return line;
            })
            .join('\n')}`
        : '\nActive goals:\n  (none)';

    return `${buildWorldPreamble()}You are ${persona.name}. ${persona.personality}

Your goals: ${persona.goals.join('; ')}

Current situation:
- Position: (${observation.position.x}, ${observation.position.y})
- Currently doing: ${observation.currentSkill ?? 'nothing'}
- In conversation: ${observation.isInConversation ? 'yes' : 'no'}
- Nearby entities:
${nearbyList}
${activeGoalSection}${memorySection}${eventsSection}

Available skills: ${availableSkills.join(', ')}

Choose one skill to execute next. Prioritize active commitments first. If no urgent goal is active, explore or idle.${activeGoal ? buildEvaluationRubric(persona, observation, activeGoal) : ''}`;
}

function buildEvaluationRubric(persona: NPCPersona, observation: Observation, goal: Goal): string {
    const allEntities: Array<{ name: string; x: number; y: number }> = [
        { name: `${persona.name} (you)`, x: observation.position.x, y: observation.position.y },
        ...observation.nearbyEntities.map(e => ({ name: e.name, x: e.position.x, y: e.position.y })),
    ];

    let pairwiseSection = '';
    if (allEntities.length > 1) {
        const pairs: string[] = [];
        for (let i = 0; i < allEntities.length; i++) {
            for (let j = i + 1; j < allEntities.length; j++) {
                const a = allEntities[i];
                const b = allEntities[j];
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
                pairs.push(`  - ${a.name} ↔ ${b.name}: ${dist} tile${dist !== 1 ? 's' : ''}`);
            }
        }
        pairwiseSection = `\nPairwise distances:\n${pairs.join('\n')}`;
    }

    const baselineSection = goal.baselineState
        ? `\nBaseline (when goal was created): ${goal.baselineState}\nScore only genuine progress since goal creation.`
        : '';

    return `\n\n── GOAL EVALUATION ──
Also evaluate your current progress on your active goal in the goal_evaluation field.
GOAL: "${goal.description}"
SUCCESS CRITERIA: ${goal.evaluation.successCriteria}
PROGRESS SIGNAL: ${goal.evaluation.progressSignal}
FAILURE SIGNAL: ${goal.evaluation.failureSignal}
COMPLETION CONDITION: ${goal.evaluation.completionCondition}${baselineSection}${pairwiseSection}
Return progress_score (0.0-1.0), summary (one sentence), should_escalate (true if goal needs deeper reasoning), and gap_analysis (what remains to be done).`;
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

    const activeGoals = observation.activeGoals.filter(g => g.status === 'active');
    let goalDirective = '';
    if (activeGoals.length > 0) {
        goalDirective = '\n── ACTIVE GOALS (use this conversation to advance them) ──';
        for (const g of activeGoals) {
            const evalText = g.evaluation.lastEvaluation
                ? `Progress: ${g.evaluation.lastEvaluation.progressScore.toFixed(2)} — ${g.evaluation.lastEvaluation.summary}`
                : 'Progress: not yet evaluated';
            goalDirective += `\n  GOAL (priority ${g.priority.toFixed(2)}): ${g.description}`;
            goalDirective += `\n    ${evalText}`;
            goalDirective += `\n    Success criteria: ${g.evaluation.successCriteria}`;
            if (g.evaluation.lastEvaluation?.gapAnalysis) {
                goalDirective += `\n    Gap: ${g.evaluation.lastEvaluation.gapAnalysis}`;
            }
        }
        goalDirective += `\n\n  INSTRUCTION: Be direct with ${partnerName} about what you need. If ${partnerName} can help with your goal, ask them to do a specific task. Don't make small talk — get to the point.`;
    }

    return `${buildWorldPreamble()}You are ${persona.name}. ${persona.personality}

Personality goals: ${persona.goals.join('; ')}
${memorySection}${goalDirective}

You are having a conversation with ${partnerName}.

Conversation so far:
${historyText}

Respond naturally as ${persona.name}. Keep your response brief (1-2 sentences). Stay in character.${activeGoals.length > 0 ? ' Your active goal takes priority — steer the conversation toward it.' : ' Be genuine and interesting.'} Don't repeat what was already said.

Goal extraction rules:
- If you are asking ${partnerName} to perform a task, set shouldCreateGoal=true with delegation.delegateToPartner=true.
  The delegated goal must be specific and actionable (e.g. "Go to tile (14, 10)"), not vague (e.g. "help out").
- If ${partnerName} is asking you to do something, set shouldCreateGoal=true with delegation.delegatedTask=true.
- If there is a clear commitment or intention, set shouldCreateGoal=true.
- Otherwise set shouldCreateGoal=false.
- If the task is ambiguous, mark needsClarification=true and provide a concise clarification question.`;
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

    const activeGoals = observation.activeGoals.filter(g => g.status === 'active');
    let activeGoalSection = '';
    if (activeGoals.length > 0) {
        activeGoalSection = '\n── ACTIVE GOALS (your plan MUST advance these) ──';
        for (const g of activeGoals) {
            const evalText = g.evaluation.lastEvaluation
                ? `Progress: ${g.evaluation.lastEvaluation.progressScore.toFixed(2)} — ${g.evaluation.lastEvaluation.summary}`
                : 'Progress: not yet evaluated';
            activeGoalSection += `\n  GOAL (priority ${g.priority.toFixed(2)}): ${g.description}`;
            activeGoalSection += `\n    ${evalText}`;
            activeGoalSection += `\n    Success: ${g.evaluation.successCriteria}`;
            activeGoalSection += `\n    Completion: ${g.evaluation.completionCondition}`;
            if (g.evaluation.lastEvaluation?.gapAnalysis) {
                activeGoalSection += `\n    Gap: ${g.evaluation.lastEvaluation.gapAnalysis}`;
            }
        }
    }

    return `${buildWorldPreamble()}You are ${persona.name}. ${persona.personality}

Personality goals: ${persona.goals.join('; ')}

Current situation:
- Position: (${observation.position.x}, ${observation.position.y})
- Currently doing: ${observation.currentSkill ?? 'nothing'}
- Nearby entities:
${nearbyList}
${activeGoalSection}${memorySection}${eventsSection}${beliefSection}${situationContext}${knowledgeSummary ? '\nKnowledge graph:\n' + knowledgeSummary : ''}

Produce a concrete, goal-directed plan. Each action must advance an active goal. Do NOT produce abstract reflections or poetic monologues.

Prioritize:
1. Active goals above all else
2. If someone nearby can help, plan to converse and delegate
3. If you need to find someone, move toward their last known position
4. Only fall back to personality goals if no active goals exist`;
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

    return `${buildWorldPreamble()}Review these recent observations and distill them into 1-3 key insights. Focus on patterns, relationships, and useful knowledge.

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
    return `${buildWorldPreamble()}You are ${persona.name}. ${persona.personality}

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
    // Build structured entity list with positions
    const allEntities: Array<{ name: string; x: number; y: number }> = [
        { name: `${persona.name} (you)`, x: observation.position.x, y: observation.position.y },
        ...observation.nearbyEntities.map(e => ({ name: e.name, x: e.position.x, y: e.position.y })),
    ];

    const entitySection = allEntities.length > 1
        ? 'ENTITIES:\n' + allEntities.map(e => `- ${e.name}: at (${e.x}, ${e.y})`).join('\n')
        : 'ENTITIES:\n- (nobody nearby)';

    // Compute pairwise distances between all entities
    let pairwiseSection = '';
    if (allEntities.length > 1) {
        const pairs: string[] = [];
        for (let i = 0; i < allEntities.length; i++) {
            for (let j = i + 1; j < allEntities.length; j++) {
                const a = allEntities[i];
                const b = allEntities[j];
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
                pairs.push(`- ${a.name} ↔ ${b.name}: ${dist} tile${dist !== 1 ? 's' : ''}`);
            }
        }
        pairwiseSection = '\n\nPAIRWISE DISTANCES:\n' + pairs.join('\n');
    }

    const baselineSection = goal.baselineState
        ? `\nBASELINE (when goal was created):\n${goal.baselineState}\n\nScore only genuine progress since goal creation — do not credit pre-existing conditions.`
        : '';

    return `${buildWorldPreamble()}You are ${persona.name}. Evaluate progress on your active goal.

GOAL: "${goal.description}"
SUCCESS CRITERIA: ${goal.evaluation.successCriteria}
PROGRESS SIGNAL: ${goal.evaluation.progressSignal}
FAILURE SIGNAL: ${goal.evaluation.failureSignal}
COMPLETION CONDITION: ${goal.evaluation.completionCondition}
${baselineSection}
CURRENT STATE:
- Current skill: ${observation.currentSkill ?? 'none'}
- Recent events:
${observation.recentEvents.length > 0 ? observation.recentEvents.map(e => `  - ${e}`).join('\n') : '  - none'}

${entitySection}${pairwiseSection}

Use the exact positions and pairwise distances above to verify each sub-condition of the success criteria.

Return an evaluation with:
- progress_score (0.0-1.0)
- summary (one sentence)
- should_escalate (true if goal needs deep reasoning help)
- gap_analysis: list what remains to be done. For each sub-condition, state whether it is met or not. Include specific entity names, positions, and the next concrete step.`;
}
