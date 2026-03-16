import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ScenarioResult, SuiteResult } from './types';

const RESULTS_DIR = resolve(import.meta.dirname, '..', '..', 'data', 'test-results');

function ensureDir(): void {
    mkdirSync(RESULTS_DIR, { recursive: true });
}

// ── Terminal output ──────────────────────────────────────────

export function printScenarioResult(r: ScenarioResult): void {
    const lines = [
        `[TEST] ${r.scenarioId}`,
        `Target NPC: ${r.targetNpc}`,
        `Result: ${r.result}`,
        `Global turns elapsed: ${r.globalTurnsElapsed}`,
        `${r.targetNpc} turns taken: ${r.npcTurnsTaken}`,
        `Failure reason: ${r.failureReason ?? 'none'}`,
        `Result file: data/test-results/${r.scenarioId}.json`,
    ];
    console.log(lines.join('\n'));
}

export function printSuiteResult(results: ScenarioResult[]): void {
    const summary = computeSummary(results);

    console.log(`\n[TEST SUITE] Completed ${results.length} scenarios\n`);

    for (const r of results) {
        let line = `${r.scenarioId.padEnd(20)} ${r.result.padEnd(10)} global_turns=${r.globalTurnsElapsed}   npc_turns=${r.npcTurnsTaken}`;
        if (r.failureReason) line += `   reason=${r.failureReason}`;
        console.log(line);
    }

    console.log(`\nSummary:`);
    console.log(`- Success: ${summary.successCount}`);
    console.log(`- Fail: ${summary.failCount}`);
    console.log(`- Aborted: ${summary.abortedCount}`);

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    console.log(`\nSuite result file: data/test-results/test-suite-${ts}.json`);
}

// ── File output ──────────────────────────────────────────────

export function writeScenarioResult(r: ScenarioResult): void {
    ensureDir();
    const path = resolve(RESULTS_DIR, `${r.scenarioId}.json`);
    writeFileSync(path, JSON.stringify(r, null, 2) + '\n', 'utf-8');
}

export function writeSuiteResult(results: ScenarioResult[]): string {
    ensureDir();
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const path = resolve(RESULTS_DIR, `test-suite-${ts}.json`);

    const suite: SuiteResult = {
        mode: 'testing-mode',
        scenarios: results.map(r => ({
            scenarioId: r.scenarioId,
            result: r.result,
            globalTurnsElapsed: r.globalTurnsElapsed,
            npcTurnsTaken: r.npcTurnsTaken,
            failureReason: r.failureReason,
        })),
        summary: computeSummary(results),
    };

    writeFileSync(path, JSON.stringify(suite, null, 2) + '\n', 'utf-8');
    return path;
}

function computeSummary(results: ScenarioResult[]) {
    return {
        successCount: results.filter(r => r.result === 'SUCCESS').length,
        failCount: results.filter(r => r.result === 'FAIL').length,
        abortedCount: results.filter(r => r.result === 'ABORTED').length,
    };
}
