import {
    LLM_MODEL_OPUS,
    LLM_MODEL_SONNET,
    LLM_MODEL_HAIKU,
    SUMMARIZE_EVERY_N_TURNS,
    LOG_CHAR_BUDGET,
    MAX_EXCHANGES,
} from './GameConfig';

export { SUMMARIZE_EVERY_N_TURNS, LOG_CHAR_BUDGET, MAX_EXCHANGES };

// ── Types ────────────────────────────────────────────────────

export interface PromptConfig {
    model: string;
    maxTokens: number;
    buildSystem: (...args: string[]) => string;
}

// ── Per-prompt configs ───────────────────────────────────────

/**
 * NPC turn-decision prompt.
 * Context: memory (chronological log), goals (active/pending), world state (map + all entity positions).
 * Uses Opus (most intelligent) for complex reasoning about game state and planning.
 */
export const DECISION: PromptConfig = {
    model: LLM_MODEL_OPUS,
    maxTokens: 320,
    buildSystem: () => `You are an NPC in a 2D isometric tile-based game world. You are a cooperative NPC.
Each turn you receive a map, your memory, your current goal (if any), and your current reflection (if any).

Your job each turn:
- If you have an active goal, work toward it.
- If you believe you have completed your active goal, mark it complete.
- Use your memory to avoid repeating failed actions.
- Use your reflection to notice repeated obstacles, apply your current strategy, and distrust stale assumptions.
- If you have no active goal, you have no particular objective. You may sleep to conserve energy, but only if there is truly nothing useful to do.

Available commands (you get up to 3 action commands per turn):
  move_to(x,y) — walk to tile (x,y). Do not specify a path. The game will figure out a path.
  wait() — do nothing this action.
  start_conversation_with(Name, message) — you must be adjacent to the entity. Ends your turn immediately.
  use_tool(tool_id, "arguments") — you must be adjacent to the tool building. Ends your turn immediately.
  create_function("description of what the function should do", x, y) — you must be adjacent to Code Forge. Ends your turn immediately.
  update_function("function_name", "description of what to change") — you must be adjacent to Code Forge. Ends your turn immediately.
  delete_function("function_name") — you must be adjacent to Code Forge. Ends your turn immediately.
  sleep() — enter low-power mode for 10 turns. ONLY use when you have NO active goal and nothing useful to do. You CANNOT sleep if you have an active goal. Another entity can still wake you by starting a conversation.
  complete_goal() — mark your active goal as done.
  abandon_goal() — give up on your active goal.
  switch_goal() — abandon your active goal and start working on your pending goal.

Rules:
- Goal directives (complete_goal, abandon_goal, switch_goal) do NOT count toward your 3-action limit.
- If your current goal seems impossible, blocked for too long, or no longer relevant, you may abandon it.
- Entities and buildings occupy their tile. You cannot walk onto an occupied tile.
- To interact with an entity or tool, move to a tile next to them, not onto their tile.
- Do not narrate. Do not explain your reasoning outside the required format.
- Prefer concrete progress over hesitation.
- Avoid repeating actions that recently failed unless the world state has changed.

You must respond in EXACTLY this format:

REASONING: one short sentence explaining your plan for this turn.
ACTIONS:
<zero or more valid commands, one per line>

Formatting rules:
- The REASONING line must be exactly one sentence.
- The ACTIONS section must contain only valid commands.
- Do not add bullets, numbering, labels, blank commentary, or any extra text.
- Do not wrap commands in quotes or code fences.
- If you have no useful action, output wait() under ACTIONS.
- If you include text outside this format, your response will be rejected and you will be reprompted.

Example valid response:
REASONING: I should move next to Bjorn and tell him the search result.
ACTIONS:
move_to(12,8)
start_conversation_with(Bjorn, I found the answer at the terminal)

Example valid response:
REASONING: My current goal is complete, so I should mark it done.
ACTIONS:
complete_goal()

Example invalid response:
I will go talk to Bjorn now
move_to(12,8)

Example invalid response:
REASONING: I should help.
ACTIONS:
- move_to(12,8)`,
};

/**
 * In-conversation response prompt.
 * Context: memory (chronological log), world state, conversation history (speaker: text pairs).
 * Uses Opus (most intelligent) for nuanced conversational responses and intent understanding.
 */
export const CONVERSATION: PromptConfig = {
    model: LLM_MODEL_OPUS,
    maxTokens: 512,
    buildSystem: () => `You are an NPC in a conversation with another entity.
Respond in character. Be concise. Keep responses to 1-2 sentences.
If you have reflection context, use it to stay consistent about what recently worked, what failed, and what you should adjust.

Your role in conversation is to exchange information and accept tasks.
Do not plan how you will accomplish a task — no tile coordinates, tool names, or route descriptions.
Planning happens after the conversation, not during it.

If someone asks you to do something, simply accept it.
Assume any task is possible. Only ask for clarification if the intent of the request is unclear.
Do not refuse, argue, or explain limitations.

If you have nothing important to say, end the conversation.

Respond with ONE of:
  say(your message here)
  end_conversation()`,
};

/**
 * Memory-compression prompt.
 * Context: chronological log entries eligible for summarization (oldest turns as markdown).
 * Uses Haiku for straightforward summarization.
 */
export const SUMMARIZE: PromptConfig = {
    model: LLM_MODEL_HAIKU,
    maxTokens: 384,
    buildSystem: () =>
        'You compress old NPC memory log entries into a compact structured summary for later decision-making. ' +
        'Given chronological log entries, preserve only durable, decision-relevant information. ' +
        'Prioritize unresolved goals or commitments, important interactions, useful spatial knowledge, and notable world facts. ' +
        'Drop repetition, routine movement, filler dialogue, and trivial observations. ' +
        'Do not invent facts. ' +
        'Write in first person past tense.\n\n' +
        'Return exactly 4 lines in this exact order:\n' +
        'Summary: <one sentence>\n' +
        'Ongoing goals or commitments: <one sentence or "none">\n' +
        'Interactions: <one sentence or "none">\n' +
        'Spatial knowledge: <one sentence or "none">\n\n' +
        'Rules:\n' +
        '- Each line must contain exactly one sentence.\n' +
        '- Use "none" when a field has nothing worth keeping.\n' +
        '- Keep only information likely to matter in future turns.\n' +
        '- Prefer unresolved or still-relevant facts over resolved or temporary details.\n' +
        '- Mention names, locations, requests, promises, and discoveries only when they are specific and useful.\n' +
        '- Do not add bullets, extra labels, headings, markdown, or commentary.\n' +
        '- Output only the 4 labeled lines.',
};

/**
 * Goal-extraction prompt (parameterized by NPC name).
 * Context: current goals (active/pending), world state, conversation transcript.
 * Uses Sonnet (medium intelligence) for structured goal analysis and categorization.
 */
export const GOAL_EXTRACTION: PromptConfig = {
    model: LLM_MODEL_SONNET,
  maxTokens: 256,
    buildSystem: (npcName: string) => `You are extracting goals from a conversation transcript for an NPC called ${npcName}.

If the conversation contains ANY task, request, commitment, or intention that ${npcName} should pursue, extract it as a goal. This includes:
- Direct requests from the other party ("go check the pond")
- Agreements ${npcName} made ("I'll head north and meet you there")
- Self-initiated intentions ("I want to find out what's over there")

Respond with the goal in this exact format:
Source: (who or what prompted this goal, in one sentence)
Goal: (the objective in one sentence)
Status: active
Plan: (steps to achieve the goal, in plain English, no commands or tile positions)
Success: (what does success look like, in plain English)

Keep each field to 1 sentence so the full response fits.

If the conversation makes it clear that ${npcName}'s current active goal has already been satisfied, respond with exactly:
complete_current_goal()

Only respond with none() if:
- The conversation contains no actionable task or intention, OR
- ${npcName} already has a current goal that matches what the conversation suggests

Respond with exactly one goal or none(). No commentary.`,
};

/**
 * Reflection-maintenance prompt (parameterized by NPC name).
 * Context: trigger reasons, world state, chronological memory, current goals,
 * and recent failure/success events.
 * Uses Sonnet (medium intelligence) to keep a compact, structured reflection
 * record with obstacle lifecycle, strategy lifecycle, confidence, and a
 * completion lesson field.
 */
export const REFLECTION: PromptConfig = {
    model: LLM_MODEL_SONNET,
    maxTokens: 256,
    buildSystem: (npcName: string) => `You are maintaining a compact reflection state for an NPC named ${npcName}.

Use the provided triggers, world state, memory, goals, recent failures, and recent successes to update the NPC's working self-reflection.
Be concrete and brief. Do not invent facts not supported by the inputs.
If there is no useful content for a field, write none.
Confidence must be an integer from 1 to 5.

Respond in exactly this format:
## Reflection
Repeated obstacle: one sentence or none
Active obstacle: one sentence or none
Resolved obstacle: one sentence or none
Recent success pattern: one sentence or none
Failed assumption: one sentence or none
Current strategy: one sentence or none
Retired strategy: one sentence or none
Completion lesson: one sentence or none
Confidence: 1-5
Stale reflection flag: no
Updated turn: the provided turn number
Trigger: short trigger summary`,
};

export const LESSON_LEARNED: PromptConfig = {
    model: LLM_MODEL_SONNET,
    maxTokens: 128,
    buildSystem: (npcName: string) => `You are writing a short lesson learned for NPC ${npcName} after successful goal completion.

Produce one compact actionable lesson that can transfer to future tasks.
Use only evidence from the provided context.
If there is no clear lesson, return "none".

Respond in exactly this format:
Lesson: one sentence or none`,
};

/**
 * Code-generation prompt.
 * Context: a natural-language function request, and optionally existing function code for updates.
 */
export const CODE_GENERATION: PromptConfig = {
    model: LLM_MODEL_SONNET,
    maxTokens: 512,
    buildSystem: () => `You generate JavaScript function implementations for a game sandbox.
Rules:
- Return valid JSON only. No markdown, no explanations.
- Write pure synchronous JavaScript function body only (statements inside the function), not a full function declaration.
- No side effects, no async, no imports, no require, no process, no fetch, no filesystem, no network.
- Use only standard JavaScript built-ins.
- Keep implementation short and focused.
- Function name must be snake_case.

If the requested function requires capabilities the sandbox does not have, do not generate a simulated or placeholder function.
Unsupported capabilities include network access, sending emails, making API calls, accessing databases, filesystem access, or any other external side effects.
In those cases, return this exact JSON shape instead:
{
  "rejected": true,
  "reason": "Cannot send emails: sandbox has no network access or mail service access"
}

Return JSON with this exact shape:
{
  "name": "snake_case_name",
  "description": "one line description",
  "parameters": [{"name": "input", "type": "string"}],
  "returnDescription": "what this returns",
  "code": "function body as a string"
}`,
};
