import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { getScenario, getAllScenarioIds } from './scenarios/index';
import { resetState } from './resetState';
import { runScenario } from './HeadlessTurnLoop';
import { printScenarioResult, writeScenarioResult, printSuiteResult, writeSuiteResult } from './ResultWriter';
import { ScenarioResult } from './types';
import { FEATURES } from '../game/GameConfig';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '..', '..', 'data', 'test-results');

// ── Argument parsing ─────────────────────────────────────────

const args = process.argv.slice(2);

const testScenarioIdx = args.indexOf('--test-scenario');
const testingModeIdx = args.indexOf('--testing-mode');

if (testScenarioIdx !== -1 && testingModeIdx !== -1) {
    console.error('Error: cannot use --test-scenario and --testing-mode together.');
    process.exit(1);
}

if (testScenarioIdx !== -1) {
    // Single scenario mode
    const scenarioId = args[testScenarioIdx + 1];
    if (!scenarioId || scenarioId.startsWith('--')) {
        console.error('Error: --test-scenario requires exactly one scenario id.');
        process.exit(1);
    }
    void runSingle(scenarioId);
} else if (testingModeIdx !== -1) {
    // Suite mode
    const scenarioIds = args.slice(testingModeIdx + 1).filter(a => !a.startsWith('--'));
    if (scenarioIds.length === 0) {
        console.error('Error: --testing-mode requires one or more scenario ids.');
        console.error(`Available scenarios: ${getAllScenarioIds().join(', ')}`);
        process.exit(1);
    }
    void runSuite(scenarioIds);
} else {
    console.error('Usage:');
    console.error('  npm run dev -- --test-scenario <scenario-id>');
    console.error('  npm run dev -- --testing-mode <scenario-id> [scenario-id ...]');
    console.error(`\nAvailable scenarios: ${getAllScenarioIds().join(', ')}`);
    process.exit(1);
}

// ── Single scenario mode ─────────────────────────────────────

async function runSingle(scenarioId: string): Promise<void> {
    const scenario = getScenario(scenarioId);
    if (!scenario) {
        console.error(`Error: unknown scenario "${scenarioId}".`);
        console.error(`Available scenarios: ${getAllScenarioIds().join(', ')}`);
        process.exit(1);
    }

    // Start Vite dev server for API endpoints (LLM proxy, log I/O, etc.)
    const server = await createServer({
        configFile: resolve(__dirname, '..', '..', 'vite', 'config.dev.mjs'),
        server: { port: 0 }, // Use random available port
    });
    await server.listen();

    const address = server.httpServer?.address();
    const port = typeof address === 'object' && address ? address.port : 8080;

    // Set the base URL for fetch calls in game modules
    // ChronologicalLog, GoalManager, etc. use relative URLs like /api/logs/...
    // In Node, fetch needs absolute URLs. Patch global fetch to prepend the base.
    const baseUrl = `http://localhost:${port}`;
    patchFetch(baseUrl);

    try {
        // 1. Reset state
        resetState();

        // 2. Seed chronological log
        await scenario.seedChronologicalLog();
        console.log(`[eval] Seeded chronological log for ${scenario.targetNpc}`);

        // 3. Run scenario
        console.log(`[eval] Running scenario: ${scenario.id} (target: ${scenario.targetNpc}, max turns: ${scenario.maxGlobalTurns})`);
        let result: ScenarioResult;
        try {
            result = await runScenario(scenario);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[eval] Runtime error: ${msg}`);
            result = {
                scenarioId: scenario.id,
                targetNpc: scenario.targetNpc,
                result: 'ABORTED',
                globalTurnsElapsed: 0,
                npcTurnsTaken: 0,
                failureReason: 'runtime error',
                maxGlobalTurns: scenario.maxGlobalTurns,
                features: { ...FEATURES },
                timestamp: new Date().toISOString(),
            };
        }

        // 4. Output
        console.log('');
        printScenarioResult(result);
        writeScenarioResult(result);

        process.exit(result.result === 'SUCCESS' ? 0 : 1);
    } finally {
        await server.close();
    }
}

// ── Suite mode (orchestrator) ────────────────────────────────

async function runSuite(scenarioIds: string[]): Promise<void> {
    // Validate all scenario IDs first
    for (const id of scenarioIds) {
        if (!getScenario(id)) {
            console.error(`Error: unknown scenario "${id}".`);
            console.error(`Available scenarios: ${getAllScenarioIds().join(', ')}`);
            process.exit(1);
        }
    }

    const results: ScenarioResult[] = [];

    for (const id of scenarioIds) {
        console.log(`\n[eval suite] Running scenario: ${id}`);

        const result = await spawnScenarioProcess(id);
        results.push(result);
    }

    // Suite output
    printSuiteResult(results);
    writeSuiteResult(results);

    const hasFailures = results.some(r => r.result !== 'SUCCESS');
    process.exit(hasFailures ? 1 : 0);
}

function spawnScenarioProcess(scenarioId: string): Promise<ScenarioResult> {
    return new Promise((promiseResolve) => {
        const projectRoot = resolve(__dirname, '..', '..');
        const child = spawn(
            'npx',
            ['tsx', 'src/eval/cli.ts', '--test-scenario', scenarioId],
            {
                cwd: projectRoot,
                stdio: 'inherit',
                env: { ...process.env },
            },
        );

        child.on('close', (_code) => {
            // Read the result file produced by the child process
            try {
                const resultPath = resolve(RESULTS_DIR, `${scenarioId}.json`);
                const data = JSON.parse(readFileSync(resultPath, 'utf-8'));
                promiseResolve(data as ScenarioResult);
            } catch {
                // Child crashed before writing result
                promiseResolve({
                    scenarioId,
                    targetNpc: getScenario(scenarioId)?.targetNpc ?? 'unknown',
                    result: 'ABORTED',
                    globalTurnsElapsed: 0,
                    npcTurnsTaken: 0,
                    failureReason: 'runtime error',
                    maxGlobalTurns: getScenario(scenarioId)?.maxGlobalTurns ?? 0,
                    features: { ...FEATURES },
                    timestamp: new Date().toISOString(),
                });
            }
        });
    });
}

// ── Fetch patch ──────────────────────────────────────────────

/**
 * Patch globalThis.fetch so relative URLs (used by game modules like
 * ChronologicalLog, LLMService, etc.) resolve to the local Vite dev server.
 */
function patchFetch(baseUrl: string): void {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
        if (typeof input === 'string' && input.startsWith('/')) {
            return originalFetch(`${baseUrl}${input}`, init);
        }
        return originalFetch(input, init);
    };
}
