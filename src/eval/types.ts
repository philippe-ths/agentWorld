import type { TilePos } from '../game/types';
import { FeatureKey } from '../game/GameConfig';

// ── Outcomes ─────────────────────────────────────────────────

export type TestOutcome = 'SUCCESS' | 'FAIL' | 'ABORTED';

export interface AbortReason {
    reason: string;
}

// ── Game state visible to scenario checks ────────────────────

export interface EvalGameState {
    npcPositions: Map<string, TilePos>;
    globalTurnsElapsed: number;
    targetNpcTurnsTaken: number;
}

// ── Scenario contract ────────────────────────────────────────

export interface TestScenario {
    id: string;
    targetNpc: 'Ada' | 'Bjorn' | 'Cora';
    maxGlobalTurns: number;
    features?: Partial<Record<FeatureKey, boolean>>;
    seedChronologicalLog(): Promise<void>;
    checkSuccess(state: EvalGameState): boolean;
    checkAbort?(state: EvalGameState): AbortReason | null;
}

// ── Result shapes ────────────────────────────────────────────

export interface GameConfigSnapshot {
    models: {
        opus: string;
        sonnet: string;
        haiku: string;
    };
    tuning: {
        summarizeEveryNTurns: number;
        reflectionEveryNTurns: number;
        unknownDirectiveTriggerThreshold: number;
        outputGuardRepromptAttempts: number;
        logCharBudget: number;
        maxExchanges: number;
        npcCommandsPerTurn: number;
        sleepTurns: number;
    };
    features: {
        conversations: boolean;
        goals: boolean;
        reflection: boolean;
        logSummarization: boolean;
        functionBuilding: boolean;
        searchTerminal: boolean;
    };
}

export interface ScenarioResult {
    scenarioId: string;
    targetNpc: string;
    result: TestOutcome;
    globalTurnsElapsed: number;
    npcTurnsTaken: number;
    failureReason: string | null;
    maxGlobalTurns: number;
    config: GameConfigSnapshot;
    timestamp: string;
    title?: string;
}

export interface SuiteResult {
    mode: 'testing-mode';
    scenarios: Array<{
        scenarioId: string;
        result: TestOutcome;
        globalTurnsElapsed: number;
        npcTurnsTaken: number;
        failureReason: string | null;
        config: GameConfigSnapshot;
        title?: string;
    }>;
    summary: {
        successCount: number;
        failCount: number;
        abortedCount: number;
    };
}
