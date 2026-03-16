import { readdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', 'data');
const LOGS_DIR = resolve(ROOT, 'logs');
const FUNCTIONS_DIR = resolve(ROOT, 'functions');

/**
 * Delete all persisted NPC state and generated functions.
 * Must run BEFORE normal startup reads any state.
 */
export function resetState(): void {
    clearDirectory(LOGS_DIR, f => f.endsWith('.md'));
    clearDirectory(FUNCTIONS_DIR, f => f.endsWith('.json'));
    console.log('[eval] Blank slate: cleared logs, goals, reflections, and functions.');
}

function clearDirectory(dir: string, matcher: (filename: string) => boolean): void {
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return; // directory doesn't exist — nothing to clear
    }
    for (const name of entries) {
        if (matcher(name)) {
            unlinkSync(resolve(dir, name));
        }
    }
}
