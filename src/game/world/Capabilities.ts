export interface ActionCapability {
  name: string;
  description: string;
  parameters: { name: string; type: string; description: string }[];
  preconditions: string[];
  effects: string[];
  estimatedDuration: string;
}

export const NPC_CAPABILITIES: ActionCapability[] = [
  {
    name: 'travel_to',
    description: 'Walk to a specific tile coordinate via pathfinding. Handles obstacles automatically.',
    parameters: [
      { name: 'x', type: 'number', description: 'Target tile X' },
      { name: 'y', type: 'number', description: 'Target tile Y' },
    ],
    preconditions: ['Not in conversation', 'Target tile is walkable'],
    effects: ['NPC position changes to target tile'],
    estimatedDuration: '~1 tile per 200ms, plus pathfinding overhead',
  },
  {
    name: 'pursue',
    description: 'Continuously move toward a named entity until adjacent. Re-paths automatically as target moves.',
    parameters: [
      { name: 'target', type: 'string', description: 'Name of entity to pursue' },
    ],
    preconditions: ['Not in conversation', 'Target entity exists'],
    effects: ['NPC ends up adjacent to target entity'],
    estimatedDuration: 'Depends on distance and target movement',
  },
  {
    name: 'flee_from',
    description: 'Move away from a named entity until safe distance reached.',
    parameters: [
      { name: 'threat', type: 'string', description: 'Name of entity to flee from' },
      { name: 'safeDistance', type: 'number', description: 'Tiles of distance to maintain' },
    ],
    preconditions: ['Not in conversation'],
    effects: ['NPC moves away from threat'],
    estimatedDuration: 'Until safe distance reached or cornered',
  },
  {
    name: 'say',
    description: 'Display a speech bubble with text. Only entities within 2 tiles can see it.',
    parameters: [
      { name: 'text', type: 'string', description: 'What to say' },
    ],
    preconditions: [],
    effects: ['Speech bubble shown for ~4 seconds'],
    estimatedDuration: '4 seconds',
  },
  {
    name: 'say_to',
    description: 'Travel to a named entity and say something. Combines travel + speech.',
    parameters: [
      { name: 'target', type: 'string', description: 'Name of entity to speak to' },
      { name: 'text', type: 'string', description: 'What to say' },
    ],
    preconditions: ['Target entity exists'],
    effects: ['NPC moves adjacent to target, then shows speech bubble'],
    estimatedDuration: 'Travel time + 4 seconds',
  },
  {
    name: 'converse_with',
    description: 'Initiate a multi-turn conversation with a named entity. Both parties stop and talk.',
    parameters: [
      { name: 'target', type: 'string', description: 'Name of entity to talk to' },
    ],
    preconditions: ['Target entity exists', 'Target not already in conversation'],
    effects: ['Multi-turn dialogue exchange'],
    estimatedDuration: '15-30 seconds for full conversation',
  },
  {
    name: 'wait',
    description: 'Stand still for a duration.',
    parameters: [
      { name: 'duration', type: 'number', description: 'Milliseconds to wait' },
    ],
    preconditions: [],
    effects: ['NPC stays in place'],
    estimatedDuration: 'As specified',
  },
  {
    name: 'wait_until',
    description: 'Stand still until a condition becomes true, or timeout.',
    parameters: [
      { name: 'condition', type: 'Condition', description: 'Condition to watch for' },
      { name: 'timeoutMs', type: 'number', description: 'Maximum wait time in ms' },
    ],
    preconditions: [],
    effects: ['NPC waits, then resumes when condition met'],
    estimatedDuration: 'Until condition or timeout',
  },
  {
    name: 'wander',
    description: 'Move to a random nearby walkable tile. Good for idle behavior or exploration.',
    parameters: [],
    preconditions: ['Not in conversation'],
    effects: ['NPC moves to a random nearby tile'],
    estimatedDuration: '2-5 seconds',
  },
];

/** Format capabilities as text for LLM prompts. */
export function capabilitiesToPromptText(): string {
  return NPC_CAPABILITIES.map(cap => {
    const params = cap.parameters.length > 0
      ? `(${cap.parameters.map(p => `${p.name}: ${p.type}`).join(', ')})`
      : '';
    return `- ${cap.name}${params}: ${cap.description}`;
  }).join('\n');
}
