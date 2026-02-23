import { TilePos } from '../entities/Entity';

// ── Actions the NPC executes in the fast loop ────────────

export interface MoveAction {
    type: 'move';
    target: TilePos;
}

export interface WaitAction {
    type: 'wait';
    duration: number; // ms
}

export interface SpeakAction {
    type: 'speak';
    text: string;
    target?: string; // entity name
}

export type Action = MoveAction | WaitAction | SpeakAction;

// ── Observation sent to backend ──────────────────────────

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
    activeGoals: Goal[];
}

// ── Backend responses ────────────────────────────────────

export interface SkillSelection {
    skill: string;
    params: Record<string, unknown>;
    escalate?: boolean;
    reasoning?: string;
    llmUsage?: LLMUsage;
    goalEvaluation?: {
        timestamp: number;
        progressScore: number;
        summary: string;
        shouldEscalate: boolean;
        gapAnalysis?: string;
    };
}

export interface ReasoningResult {
    type: 'plan' | 'dialogue' | 'belief_update';
    actions?: Action[];
    dialogue?: string;
    beliefs?: Record<string, unknown>;
    newSkill?: { name: string; description: string; steps?: string[]; preconditions?: string[] };
    goalExtraction?: DialogueGoalExtraction;
    llmUsage?: LLMUsage;
}

export interface LLMUsage {
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUSD: number;
}

export interface GoalSource {
    type: 'player_dialogue' | 'npc_dialogue' | 'self_initiated' | 'delegated';
    conversationId?: string;
    assignedBy?: string;
}

export interface GoalEvaluation {
    successCriteria: string;
    progressSignal: string;
    failureSignal: string;
    completionCondition: string;
    lastEvaluation?: {
        timestamp: number;
        progressScore: number;
        summary: string;
        shouldEscalate: boolean;
        gapAnalysis?: string;
    };
    evaluationHistory?: number[];
}

export interface GoalEvaluationResult {
    timestamp: number;
    progressScore: number;
    summary: string;
    shouldEscalate: boolean;
    gapAnalysis?: string;
    llmUsage?: LLMUsage;
}

export interface GoalResourceProfile {
    totalTokensIn: number;
    totalTokensOut: number;
    estimatedCostUSD: number;
    haikuCalls: number;
    sonnetCalls: number;
    embeddingCalls: number;
    pathfindingCalls: number;
    evaluationCalls: number;
    wallClockMs: number;
    apiLatencyMs: number;
    mediumLoopTicks: number;
    runwayUsed?: boolean;
    productiveEscalations?: number;
    unproductiveEscalations?: number;
}

export interface PlanStep {
    skill: string;
    target?: string;
    purpose: string;
    done: boolean;
}

export interface Goal {
    id: string;
    npcId: string;
    type: string;
    description: string;
    source: GoalSource;
    evaluation: GoalEvaluation;
    status: 'active' | 'completed' | 'failed' | 'abandoned';
    priority: number;
    createdAt: number;
    expiresAt: number | null;
    resources: GoalResourceProfile;
    parentGoalId: string | null;
    delegatedTo: string | null;
    delegatedFrom: string | null;
    estimatedDifficulty?: 'trivial' | 'simple' | 'moderate' | 'complex';
    planAgenda?: PlanStep[];
    baselineState?: string;
}

export interface DialogueGoalExtraction {
    shouldCreateGoal: boolean;
    goal?: {
        type: string;
        description: string;
        priority: number;
        evaluation: GoalEvaluation;
        estimatedDifficulty: 'trivial' | 'simple' | 'moderate' | 'complex';
        needsClarification: boolean;
        clarificationQuestion?: string;
        delegation?: {
            delegateToPartner?: boolean;
            delegatedTask?: boolean;
            rationale?: string;
        };
    };
}
