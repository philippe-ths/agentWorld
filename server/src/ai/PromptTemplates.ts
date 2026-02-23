// ── NPC Personas ─────────────────────────────────────────

const personas: Record<string, { id: string; name: string; personality: string }> = {
  ada:   { id: 'ada',   name: 'Ada',   personality: 'Thoughtful and methodical. Prefers careful analysis before acting. Values precision and correctness.' },
  bjorn: { id: 'bjorn', name: 'Bjorn', personality: 'Direct and practical. Focuses on efficient solutions. Values action over deliberation.' },
  cora:  { id: 'cora',  name: 'Cora',  personality: 'Curious and observant. Notices details others miss. Values learning and exploration.' },
};

export function getPersona(npcId: string) {
  return personas[npcId] ?? personas['ada'];
}

// ── Protocol Prompts ─────────────────────────────────────

/**
 * Generate a Propose message — decompose a task into sub-tasks with
 * mechanical completion criteria where possible.
 */
export function buildProposePrompt(
  npcName: string,
  worldSummary: string,
  taskDescription: string,
  capabilities: string,
  memories: string[],
): string {
  const persona = getPersona(npcName.toLowerCase());
  const memoryBlock = memories.length > 0
    ? `\nRelevant memories:\n${memories.map(m => `  - ${m}`).join('\n')}`
    : '';

  return `You are ${persona.name}, an NPC in a tile-based isometric world. ${persona.personality}

${worldSummary}

Available actions:
${capabilities}

${memoryBlock}

A task has been given to you: "${taskDescription}"

Decompose this into concrete sub-tasks. For each sub-task, specify:
1. A short description
2. Completion criteria — prefer mechanical conditions (entity_adjacent, entity_at_position, entity_within_range) over vague descriptions
3. The actions needed, using ONLY these exact JSON shapes:
   - {"type": "travel_to", "destination": {"x": N, "y": N}}
   - {"type": "pursue", "target": "EntityName"}
   - {"type": "flee_from", "threat": "EntityName", "safeDistance": N}
   - {"type": "speak", "text": "..."}
   - {"type": "say_to", "target": "EntityName", "text": "..."}
   - {"type": "converse_with", "target": "EntityName", "purpose": "why you need to talk to them"}
   - {"type": "wait", "duration": milliseconds}

Action selection rules:
- Use "say_to" for one-way message delivery, announcements, greetings, or relaying messages. It is lightweight (no LLM dialogue calls).
- Use "converse_with" ONLY when a two-way exchange is required — negotiation, asking questions that need answers, or gathering information. It triggers a multi-turn dialogue and is expensive.
- When using "converse_with", the "purpose" MUST include ALL relevant context — exact message content, specific names, goals, what was previously said. The conversation partner will ONLY see this purpose field, not the original task description.
- Prefer the simplest action that accomplishes the goal. Do NOT add verification sub-tasks for simple deliveries — if you used "say_to" the message was delivered.

4. Dependencies on other sub-tasks (by ID)

Respond in this exact JSON format:
{
  "interpretation": "your understanding of the task in your own words",
  "subTasks": [
    {
      "id": "st_1",
      "description": "what this sub-task does",
      "completionCriteria": "how to know it's done",
      "actions": [{"type": "pursue", "target": "Bjorn"}],
      "dependencies": []
    }
  ],
  "completionCriteria": "how to know the whole task is done",
  "rollupLogic": "why completing all sub-tasks means the task is done",
  "failureModes": ["what could go wrong"]
}

Be concrete. Use exact tile coordinates and entity names from the world summary.
Every sub-task MUST have at least one action. Use entity names exactly as they appear in the world summary.
Respond ONLY with the JSON object, no other text.`;
}

/**
 * Generate dialogue for a conversation turn.
 */
export function buildDialoguePrompt(
  npcName: string,
  worldSummary: string,
  partner: string,
  history: { speaker: string; text: string }[],
  purpose: string | undefined,
  memories: string[],
): string {
  const persona = getPersona(npcName.toLowerCase());
  const memoryBlock = memories.length > 0
    ? `\nRelevant memories:\n${memories.map(m => `  - ${m}`).join('\n')}`
    : '';

  const historyBlock = history.length > 0
    ? `\nConversation so far:\n${history.map(t => `  ${t.speaker}: ${t.text}`).join('\n')}`
    : '\nThis is the start of the conversation.';

  const purposeBlock = purpose
    ? `\nIMPORTANT — You have a specific purpose for this conversation: ${purpose}\nYou MUST steer the conversation toward this purpose. Do not get sidetracked with small talk. Accomplish your purpose within the first 1-2 turns.`
    : '';

  return `You are ${persona.name}, an NPC in a tile-based isometric world. ${persona.personality}

${worldSummary}
${memoryBlock}

You are talking to ${partner}.${purposeBlock}
${historyBlock}

Respond as ${persona.name}. Keep your response natural and in-character.
Keep it concise — 1-2 sentences unless the situation calls for more.
Only reference facts from the world summary, your memories, or this conversation history. Do NOT invent messages, events, or details that have not been established.

Respond in this exact JSON format:
{
  "dialogue": "what you say",
  "internalThought": "brief private reasoning (not shown to other characters)",
  "taskRequested": "a brief description of what you've been asked to DO, or null if this is just conversation"
}

Set "taskRequested" to a short task description ONLY if the speaker is asking you to perform an action, go somewhere, find something, deliver a message, etc. Regular greetings, questions, or chitchat should have "taskRequested": null.

Respond ONLY with the JSON object, no other text.`;
}

/**
 * Evaluate a proposal — generate a Question or approve it.
 */
export function buildQuestionPrompt(
  npcName: string,
  proposal: {
    taskDescription: string;
    interpretation: string;
    subTasks: { id: string; description: string; completionCriteria: string }[];
    completionCriteria: string;
    rollupLogic: string;
  },
  worldSummary: string,
  memories: string[],
): string {
  const persona = getPersona(npcName.toLowerCase());
  const memoryBlock = memories.length > 0
    ? `\nRelevant memories:\n${memories.map(m => `  - ${m}`).join('\n')}`
    : '';

  const subTaskList = proposal.subTasks.map(st =>
    `  - [${st.id}] ${st.description} (done when: ${st.completionCriteria})`
  ).join('\n');

  return `You are ${persona.name}, critically evaluating a plan. ${persona.personality}

${worldSummary}
${memoryBlock}

A plan has been proposed:
Task: "${proposal.taskDescription}"
Interpretation: "${proposal.interpretation}"
Sub-tasks:
${subTaskList}
Overall completion: "${proposal.completionCriteria}"
Rollup logic: "${proposal.rollupLogic}"

Evaluate this plan for:
- Completeness: does the decomposition cover all cases?
- Criteria: does completing sub-tasks actually guarantee the parent task?
- Assumptions: is the plan based on correct/current world state?
- Efficiency: is there a simpler approach?

If you find a concern, respond with:
{
  "approved": false,
  "kind": "completeness|criteria|assumption|efficiency",
  "concern": "what's wrong",
  "evidence": "why you think so",
  "suggestedAlternative": "a better approach"
}

If the plan looks sound, respond with:
{ "approved": true }

Respond ONLY with the JSON object, no other text.`;
}

/**
 * Revise a proposal in response to a Question.
 */
export function buildRevisePrompt(
  npcName: string,
  originalProposal: {
    taskDescription: string;
    interpretation: string;
    subTasks: { id: string; description: string; completionCriteria: string }[];
    completionCriteria: string;
  },
  question: {
    kind: string;
    concern: string;
    evidence: string;
    suggestedAlternative?: string;
  },
  worldSummary: string,
): string {
  const persona = getPersona(npcName.toLowerCase());
  const subTaskList = originalProposal.subTasks.map(st =>
    `  - [${st.id}] ${st.description} (done when: ${st.completionCriteria})`
  ).join('\n');

  return `You are ${persona.name}, revising a plan based on feedback. ${persona.personality}

${worldSummary}

Your original plan:
Task: "${originalProposal.taskDescription}"
Sub-tasks:
${subTaskList}

A concern was raised (${question.kind}):
Concern: "${question.concern}"
Evidence: "${question.evidence}"
${question.suggestedAlternative ? `Suggested alternative: "${question.suggestedAlternative}"` : ''}

Revise your plan to address this concern. Keep what works, fix what doesn't.

Respond in this exact JSON format:
{
  "whatChanged": "summary of changes",
  "updatedSubTasks": [
    {
      "id": "st_1",
      "description": "updated description",
      "completionCriteria": "updated criteria",
      "actions": [{"type": "action_name", ...params}],
      "dependencies": []
    }
  ],
  "updatedCompletionCriteria": "updated overall criteria",
  "impactOnInProgress": "how this affects work already started"
}

Respond ONLY with the JSON object, no other text.`;
}

/**
 * Distill lessons from a completed task.
 */
export function buildRememberPrompt(
  npcName: string,
  taskContext: string,
  outcome: string,
): string {
  const persona = getPersona(npcName.toLowerCase());

  return `You are ${persona.name}, reflecting on a completed task. ${persona.personality}

Task context:
${taskContext}

Outcome: ${outcome}

Extract 1-3 short, reusable lessons from this experience. Focus on:
- What worked well that should be repeated
- What failed that should be avoided
- Patterns that might apply to future tasks

Respond in this exact JSON format:
{
  "lessons": [
    {
      "kind": "lesson|pattern|capability|failure",
      "content": "the insight in one sentence",
      "scope": "individual|shared"
    }
  ]
}

Respond ONLY with the JSON object, no other text.`;
}
