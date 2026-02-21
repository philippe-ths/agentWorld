import type { LLMUsage } from '../types.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface GoalResourceStats {
    goalId: string;
    npcId: string;
    totalTokensIn: number;
    totalTokensOut: number;
    estimatedCostUSD: number;
    haikuCalls: number;
    sonnetCalls: number;
    evaluationCalls: number;
    embeddingCalls: number;
    pathfindingCalls: number;
    apiLatencyMs: number;
    updatedAt: number;
}

const ledger = new Map<string, GoalResourceStats>();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const LEDGER_FILE = path.join(DATA_DIR, 'goal_resources.json');

let initialized = false;

async function ensureDataDir() {
    if (!existsSync(DATA_DIR)) {
        await mkdir(DATA_DIR, { recursive: true });
    }
}

async function persistLedger(): Promise<void> {
    try {
        await ensureDataDir();
        const data = JSON.stringify(Array.from(ledger.values()), null, 2);
        await writeFile(LEDGER_FILE, data);
    } catch (err) {
        console.error('[ResourceLedger] Failed to persist:', err);
    }
}

export async function initResourceLedger(): Promise<void> {
    if (initialized) return;
    initialized = true;

    try {
        await ensureDataDir();
        if (!existsSync(LEDGER_FILE)) return;

        const raw = await readFile(LEDGER_FILE, 'utf-8');
        const rows = JSON.parse(raw) as Array<Partial<GoalResourceStats>>;
        for (const row of rows) {
            if (!row.goalId || !row.npcId) continue;
            ledger.set(row.goalId, {
                goalId: row.goalId,
                npcId: row.npcId,
                totalTokensIn: row.totalTokensIn ?? 0,
                totalTokensOut: row.totalTokensOut ?? 0,
                estimatedCostUSD: row.estimatedCostUSD ?? 0,
                haikuCalls: row.haikuCalls ?? 0,
                sonnetCalls: row.sonnetCalls ?? 0,
                evaluationCalls: row.evaluationCalls ?? 0,
                embeddingCalls: row.embeddingCalls ?? 0,
                pathfindingCalls: row.pathfindingCalls ?? 0,
                apiLatencyMs: row.apiLatencyMs ?? 0,
                updatedAt: row.updatedAt ?? Date.now(),
            });
        }
    } catch (err) {
        console.error('[ResourceLedger] Failed to load persisted ledger:', err);
    }
}

function getOrCreate(goalId: string, npcId: string): GoalResourceStats {
    const existing = ledger.get(goalId);
    if (existing) return existing;

    const created: GoalResourceStats = {
        goalId,
        npcId,
        totalTokensIn: 0,
        totalTokensOut: 0,
        estimatedCostUSD: 0,
        haikuCalls: 0,
        sonnetCalls: 0,
        evaluationCalls: 0,
        embeddingCalls: 0,
        pathfindingCalls: 0,
        apiLatencyMs: 0,
        updatedAt: Date.now(),
    };
    ledger.set(goalId, created);
    return created;
}

export function trackGoalUsage(
    goalId: string,
    npcId: string,
    usage: LLMUsage | undefined,
    kind: 'haiku' | 'sonnet' | 'evaluation',
    latencyMs = 0,
): void {
    const row = getOrCreate(goalId, npcId);

    if (usage) {
        row.totalTokensIn += usage.inputTokens;
        row.totalTokensOut += usage.outputTokens;
        row.estimatedCostUSD += usage.estimatedCostUSD;
    }

    if (kind === 'haiku') row.haikuCalls++;
    if (kind === 'sonnet') row.sonnetCalls++;
    if (kind === 'evaluation') row.evaluationCalls++;

    row.apiLatencyMs += latencyMs;
    row.updatedAt = Date.now();

    // Fire-and-forget persistence to keep request path lightweight.
    void persistLedger();
}

export function getAllGoalUsage(): GoalResourceStats[] {
    return Array.from(ledger.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function trackGoalCompute(
    goalId: string,
    npcId: string,
    compute: { embeddingCalls?: number; pathfindingCalls?: number },
): void {
    const row = getOrCreate(goalId, npcId);
    row.embeddingCalls += compute.embeddingCalls ?? 0;
    row.pathfindingCalls += compute.pathfindingCalls ?? 0;
    row.updatedAt = Date.now();
    void persistLedger();
}

export function syncGoalComputeTotals(
    goalId: string,
    npcId: string,
    totals: { embeddingCalls?: number; pathfindingCalls?: number },
): void {
    const row = getOrCreate(goalId, npcId);
    row.embeddingCalls = Math.max(row.embeddingCalls, totals.embeddingCalls ?? row.embeddingCalls);
    row.pathfindingCalls = Math.max(row.pathfindingCalls, totals.pathfindingCalls ?? row.pathfindingCalls);
    row.updatedAt = Date.now();
    void persistLedger();
}

export function getAggregateResourceStats() {
    const all = getAllGoalUsage();
    return {
        goalsTracked: all.length,
        totalTokensIn: all.reduce((s, g) => s + g.totalTokensIn, 0),
        totalTokensOut: all.reduce((s, g) => s + g.totalTokensOut, 0),
        estimatedCostUSD: all.reduce((s, g) => s + g.estimatedCostUSD, 0),
        haikuCalls: all.reduce((s, g) => s + g.haikuCalls, 0),
        sonnetCalls: all.reduce((s, g) => s + g.sonnetCalls, 0),
        evaluationCalls: all.reduce((s, g) => s + g.evaluationCalls, 0),
        embeddingCalls: all.reduce((s, g) => s + (g.embeddingCalls ?? 0), 0),
        pathfindingCalls: all.reduce((s, g) => s + (g.pathfindingCalls ?? 0), 0),
        apiLatencyMs: all.reduce((s, g) => s + g.apiLatencyMs, 0),
        goals: all,
    };
}
