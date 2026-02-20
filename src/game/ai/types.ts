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
}

// ── Backend responses ────────────────────────────────────

export interface SkillSelection {
    skill: string;
    params: Record<string, unknown>;
    escalate?: boolean;
}

export interface ReasoningResult {
    type: 'plan' | 'dialogue' | 'belief_update';
    actions?: Action[];
    dialogue?: string;
    beliefs?: Record<string, unknown>;
    newSkill?: { name: string; description: string; steps?: string[]; preconditions?: string[] };
}
