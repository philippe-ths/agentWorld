import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
 * Vite plugin that adds a POST /api/chat endpoint proxying to Anthropic Claude.
 * Reads ANTHROPIC_API_KEY from .env file.
 */
export function anthropicProxy() {
    return {
        name: 'anthropic-proxy',
        configureServer(server) {
            server.middlewares.use('/api/chat', async (req, res) => {
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

                const { system, messages, max_tokens } = parsed;
                if (!system || !messages) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: 'Missing system or messages' }));
                    return;
                }

                // Allow callers to override max_tokens (capped at 512, default 256)
                const tokens = Math.min(Number(max_tokens) || 256, 512);

                try {
                    const client = new Anthropic({ apiKey });
                    const response = await client.messages.create({
                        model: 'claude-sonnet-4-20250514',
                        max_tokens: tokens,
                        system,
                        messages,
                    });

                    const text = response.content
                        .filter(b => b.type === 'text')
                        .map(b => b.text)
                        .join('');

                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ text }));
                } catch (err) {
                    console.error('[anthropic-proxy] API error:', err.message);
                    res.statusCode = 502;
                    res.end(JSON.stringify({ error: `Anthropic API error: ${err.message}` }));
                }
            });
        },
    };
}
