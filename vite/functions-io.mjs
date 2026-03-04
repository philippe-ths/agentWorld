import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FUNCTION_NAME_RE = /^[a-z_][a-z0-9_]*$/;

function isValidRecordShape(record) {
    if (!record || typeof record !== 'object') return false;
    if (!FUNCTION_NAME_RE.test(String(record.name ?? ''))) return false;
    if (typeof record.description !== 'string' || !record.description.trim()) return false;
    if (!Array.isArray(record.parameters)) return false;
    if (typeof record.returnDescription !== 'string' || !record.returnDescription.trim()) return false;
    if (typeof record.code !== 'string' || !record.code.trim()) return false;
    if (!record.tile || typeof record.tile.x !== 'number' || typeof record.tile.y !== 'number') return false;
    if (typeof record.creator !== 'string' || !record.creator.trim()) return false;
    return true;
}

export function functionsIO() {
    const functionsDir = resolve(import.meta.dirname, '..', 'data', 'functions');

    function getRecordPath(name) {
        return resolve(functionsDir, `${name}.json`);
    }

    function listHandler(req, res, next) {
        if (!req.url?.match(/^\/api\/functions(?:\?.*)?$/)) return next();
        if (req.method !== 'GET') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        mkdirSync(functionsDir, { recursive: true });
        const functions = [];

        for (const name of readdirSync(functionsDir)) {
            if (!name.endsWith('.json')) continue;
            const path = resolve(functionsDir, name);
            try {
                const data = JSON.parse(readFileSync(path, 'utf-8'));
                if (isValidRecordShape(data)) {
                    functions.push(data);
                }
            } catch {
                // Ignore malformed files to keep startup robust.
            }
        }

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ functions }));
    }

    function itemHandler(req, res, next) {
        const match = req.url?.match(/^\/api\/functions\/([^/?]+)$/);
        if (!match) return next();

        const functionName = decodeURIComponent(match[1]);
        if (!FUNCTION_NAME_RE.test(functionName)) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid function name' }));
            return;
        }

        const recordPath = getRecordPath(functionName);

        if (req.method === 'GET') {
            try {
                const content = JSON.parse(readFileSync(recordPath, 'utf-8'));
                if (!isValidRecordShape(content)) {
                    throw new Error('Invalid function record');
                }
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ function: content }));
            } catch {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: 'Function not found' }));
            }
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

                if (!isValidRecordShape(parsed)) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: 'Invalid function record payload' }));
                    return;
                }

                if (parsed.name !== functionName) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: 'Name mismatch between URL and payload' }));
                    return;
                }

                mkdirSync(functionsDir, { recursive: true });
                writeFileSync(recordPath, JSON.stringify(parsed, null, 2), 'utf-8');

                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true }));
            });
            return;
        }

        if (req.method === 'DELETE') {
            try {
                rmSync(recordPath);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true }));
            } catch {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: 'Function not found' }));
            }
            return;
        }

        res.statusCode = 405;
        res.end(JSON.stringify({ error: 'Method not allowed' }));
    }

    return {
        name: 'functions-io',
        configureServer(server) {
            server.middlewares.use(listHandler);
            server.middlewares.use(itemHandler);
        },
    };
}
