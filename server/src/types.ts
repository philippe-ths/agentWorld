// ── Shared types between client and server ───────────────

export interface TilePos {
    x: number;
    y: number;
}

export interface NearbyEntity {
    id: string;
    name: string;
    position: TilePos;
    distance: number;
}

export interface Observation {
    npcId: string;
    name: string;
    position: TilePos;
    nearbyEntities: NearbyEntity[];
    isInConversation: boolean;
    currentSkill: string | null;
    recentEvents: string[];
}

export interface SkillSelection {
    skill: string;
    params: Record<string, unknown>;
    escalate?: boolean;
    reasoning?: string;
    llmUsage?: LLMUsage;
}

export interface ReasoningResult {
    type: 'plan' | 'dialogue' | 'belief_update';
    actions?: Action[];
    dialogue?: string;
    beliefs?: Record<string, unknown>;
    llmUsage?: LLMUsage;
}

export interface LLMUsage {
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUSD: number;
}

export interface MoveAction {
    type: 'move';
    target: TilePos;
}

export interface WaitAction {
    type: 'wait';
    duration: number;
}

export interface SpeakAction {
    type: 'speak';
    text: string;
    target?: string;
}

export type Action = MoveAction | WaitAction | SpeakAction;

// ── NPC persona ──────────────────────────────────────────

export interface NPCPersona {
    id: string;
    name: string;
    personality: string;
}

// ── Conversation ─────────────────────────────────────────

export interface ConversationTurn {
    speaker: string;
    text: string;
}

export interface ConversationRequest {
    npcId: string;
    observation: Observation;
    conversationHistory: ConversationTurn[];
    partnerName: string;
}

export interface ReasoningRequest {
    npcId: string;
    observation: Observation;
    mode?: 'conversation' | 'reasoning';
    conversationHistory?: ConversationTurn[];
    partnerName?: string;
    stuckCount?: number;
    failedSkill?: string;
}

// ── Memory ───────────────────────────────────────────────

export interface Memory {
    id: string;
    text: string;
    type: 'fact' | 'insight' | 'lesson';
    importance: number;
    timestamp: number;
    accessCount: number;
    embedding?: number[];
    /** @deprecated Legacy field — no longer set by new protocol system. */
    goalContext?: string;
}

export interface WorldBelief {
    knownEntities: Record<string, { lastSeen: TilePos; relationship: string }>;
    visitedAreas: TilePos[];
    insights: string[];
}
