import { TilePos } from '../game/types';

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
    seedChronologicalLog(): Promise<void>;
    checkSuccess(state: EvalGameState): boolean;
    checkAbort?(state: EvalGameState): AbortReason | null;
}

// ── Result shapes ────────────────────────────────────────────

export interface FeatureSnapshot {
    conversations: boolean;
    goals: boolean;
    reflection: boolean;
    logSummarization: boolean;
    functionBuilding: boolean;
    searchTerminal: boolean;
}

export interface ScenarioResult {
    scenarioId: string;
    targetNpc: string;
    result: TestOutcome;
    globalTurnsElapsed: number;
    npcTurnsTaken: number;
    failureReason: string | null;
    maxGlobalTurns: number;
    features: FeatureSnapshot;
    timestamp: string;
}

export interface SuiteResult {
    mode: 'testing-mode';
    scenarios: Array<{
        scenarioId: string;
        result: TestOutcome;
        globalTurnsElapsed: number;
        npcTurnsTaken: number;
        failureReason: string | null;
        features: FeatureSnapshot;
    }>;
    summary: {
        successCount: number;
        failCount: number;
        abortedCount: number;
    };
}
