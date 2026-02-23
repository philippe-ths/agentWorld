import type { TilePos } from '../entities/Entity';
import type { Condition } from './ConditionChecker';

// ── Base actions ─────────────────────────────────────────

export interface MoveAction { type: 'move'; target: TilePos; }
export interface WaitAction { type: 'wait'; duration: number; }
export interface SpeakAction { type: 'speak'; text: string; target?: string; }

// ── Structured actions ───────────────────────────────────

/** Travel to a position using pathfinding. Re-paths on obstacles. */
export interface TravelToAction {
  type: 'travel_to';
  destination: TilePos;
  onArrive?: Action[];
  onFail?: Action[];
}

/** Pursue a moving entity until adjacent. Re-paths continuously. */
export interface PursueAction {
  type: 'pursue';
  target: string;
  onCatch?: Action[];
  timeoutMs?: number;
  onTimeout?: Action[];
}

/** Flee from an entity until distance > safeDistance. */
export interface FleeAction {
  type: 'flee_from';
  threat: string;
  safeDistance: number;
  onSafe?: Action[];
}

/** Wait until a condition becomes true. */
export interface WaitUntilAction {
  type: 'wait_until';
  condition: Condition;
  timeoutMs?: number;
  onComplete?: Action[];
  onTimeout?: Action[];
}

/** Travel to an entity and speak to them. */
export interface SayToAction {
  type: 'say_to';
  target: string;
  text: string;
  onDelivered?: Action[];
}

/** Travel to an entity and start a conversation. */
export interface ConverseWithAction {
  type: 'converse_with';
  target: string;
  purpose?: string;
  onComplete?: Action[];
}

/** Execute actions in sequence. */
export interface SequenceAction {
  type: 'sequence';
  actions: Action[];
}

export type Action =
  | MoveAction | WaitAction | SpeakAction
  | TravelToAction | PursueAction | FleeAction
  | WaitUntilAction | SayToAction | ConverseWithAction
  | SequenceAction;

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
}

// ── Backend responses ────────────────────────────────────

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
