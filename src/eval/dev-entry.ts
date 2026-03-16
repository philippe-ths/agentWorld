/**
 * Unified dev entry point.
 *
 * When invoked with --test-scenario or --testing-mode, delegates to the
 * evaluation CLI.  Otherwise starts the normal Vite dev server.
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const isEval = args.includes('--test-scenario') || args.includes('--testing-mode');

if (isEval) {
    // Delegate to eval CLI (same process — tsx can import it directly)
    void import('./cli.js');
} else {
    // Start Vite dev server, forwarding any remaining CLI args
    const projectRoot = resolve(__dirname, '..', '..');
    const child = spawn(
        'npx',
        ['vite', '--config', 'vite/config.dev.mjs', ...args],
        { cwd: projectRoot, stdio: 'inherit' },
    );
    child.on('close', (code: number | null) => process.exit(code ?? 0));
}
