import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SUMMARIZE_MODEL = 'claude-sonnet-4-20250514';
const SUMMARIZE_MAX_TOKENS = 512;
const SUMMARIZE_SYSTEM_PROMPT =
    'You are a memory compressor for an NPC in a 2D game. ' +
    'Given a series of chronological log entries, produce a single concise narrative paragraph ' +
    'that preserves key facts, decisions, spatial observations, and interactions. ' +
    'Drop trivial or redundant details. Write in third person past tense.';

// Load .env into process.env
try {
    const envPath = resolve(import.meta.dirname, '..', '.env');
    const envFile = readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    }
} catch { /* .env file missing — rely on env vars */ }

/**
 * Vite plugin that adds a POST /api/summarize endpoint for compressing
 * old chronological log entries via Anthropic Claude.
 */
export function summarizeProxy() {
    return {
        name: 'summarize-proxy',
        configureServer(server) {
            server.middlewares.use('/api/summarize', async (req, res) => {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.end(JSON.stringify({ error: 'Method not allowed' }));
                    return;
                }

                const apiKey = process.env.ANTHROPIC_API_KEY;
                if (!apiKey) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }));
                    return;
                }

                let body = '';
                for await (const chunk of req) {
                    body += chunk;
                }

                let parsed;
                try {
                    parsed = JSON.parse(body);
                } catch {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: 'Invalid JSON' }));
                    return;
                }

                const { entries } = parsed;
                if (typeof entries !== 'string') {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: 'Missing entries field' }));
                    return;
                }

                try {
                    const client = new Anthropic({ apiKey });
                    const response = await client.messages.create({
                        model: SUMMARIZE_MODEL,
                        max_tokens: SUMMARIZE_MAX_TOKENS,
                        system: SUMMARIZE_SYSTEM_PROMPT,
                        messages: [{ role: 'user', content: entries }],
                    });

                    const summary = response.content
                        .filter(b => b.type === 'text')
                        .map(b => b.text)
                        .join('');

                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ summary }));
                } catch (err) {
                    console.error('[summarize-proxy] API error:', err.message);
                    res.statusCode = 502;
                    res.end(JSON.stringify({ error: `Anthropic API error: ${err.message}` }));
                }
            });
        },
    };
}
