import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const NPC_NAME_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Vite plugin that adds GET/POST /api/logs/:npcName and /api/goals/:npcName
 * endpoints for reading and writing per-NPC markdown files under data/logs/.
 */
export function logIO() {
    const logsDir = resolve(import.meta.dirname, '..', 'data', 'logs');

    /** Shared GET/POST handler for a markdown file identified by prefix + npcName. */
    function fileHandler(prefix) {
        return (req, res, next) => {
            const match = req.url?.match(new RegExp(`^/api/${prefix}/([^/?]+)$`));
            if (!match) return next();

            const npcName = match[1];
            if (!NPC_NAME_RE.test(npcName)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid NPC name' }));
                return;
            }

            const filePath = resolve(logsDir, `${prefix === 'logs' ? 'chronological' : 'goals'}-${npcName}.md`);

            if (req.method === 'GET') {
                let content = '';
                try {
                    content = readFileSync(filePath, 'utf-8');
                } catch { /* file doesn't exist yet */ }

                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ content }));
                return;
            }

            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    let parsed;
                    try {
                        parsed = JSON.parse(body);
                    } catch {
                        res.statusCode = 400;
                        res.end(JSON.stringify({ error: 'Invalid JSON' }));
                        return;
                    }

                    if (typeof parsed.content !== 'string') {
                        res.statusCode = 400;
                        res.end(JSON.stringify({ error: 'Missing content field' }));
                        return;
                    }

                    mkdirSync(logsDir, { recursive: true });
                    writeFileSync(filePath, parsed.content, 'utf-8');

                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ ok: true }));
                });
                return;
            }

            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method not allowed' }));
        };
    }

    return {
        name: 'log-io',
        configureServer(server) {
            server.middlewares.use(fileHandler('logs'));
            server.middlewares.use(fileHandler('goals'));
        },
    };
}
