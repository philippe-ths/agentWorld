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
    const fallbackModels = [
        'claude-sonnet-4-6',
        'claude-sonnet-4-5-20250929',
        'claude-opus-4-6',
    ];

    const TRANSIENT_CODES = new Set([429, 500, 502, 503, 529]);
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 1000;

    function isTransient(err) {
        const status = Number(err?.status || 0);
        return TRANSIENT_CODES.has(status);
    }

    function shouldRetryWithFallback(err) {
        const status = Number(err?.status || 0);
        const message = String(err?.message || '');
        return status === 404 || message.includes('not_found_error') || message.includes('model:');
    }

    async function callWithRetry(client, params) {
        let lastErr;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                return await client.messages.create(params);
            } catch (err) {
                lastErr = err;
                if (!isTransient(err) || attempt === MAX_RETRIES) throw err;
                const delay = BASE_DELAY_MS * 2 ** attempt;
                console.warn(
                    `[anthropic-proxy] Transient error (${err.status}), retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
                );
                await new Promise(r => globalThis.setTimeout(r, delay));
            }
        }
        throw lastErr;
    }

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

                const { model, system, messages, max_tokens } = parsed;
                if (!system || !messages) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: 'Missing system or messages' }));
                    return;
                }

                try {
                    const client = new Anthropic({ apiKey });
                    let requestedModel = model || fallbackModels[0];
                    let response;

                    const makeParams = (m) => ({
                        model: m,
                        max_tokens: Number(max_tokens) || 256,
                        system,
                        messages,
                    });

                    try {
                        response = await callWithRetry(client, makeParams(requestedModel));
                    } catch (err) {
                        if (shouldRetryWithFallback(err)) {
                            let recovered = false;

                            for (const fallbackModel of fallbackModels) {
                                if (fallbackModel === requestedModel) continue;
                                try {
                                    console.warn(
                                        `[anthropic-proxy] Model \"${requestedModel}\" unavailable, retrying with \"${fallbackModel}\"`,
                                    );
                                    requestedModel = fallbackModel;
                                    response = await callWithRetry(client, makeParams(requestedModel));
                                    recovered = true;
                                    break;
                                } catch (fallbackErr) {
                                    if (!shouldRetryWithFallback(fallbackErr)) {
                                        throw fallbackErr;
                                    }
                                }
                            }

                            if (!recovered) {
                                throw err;
                            }
                        } else {
                            throw err;
                        }
                    }

                    const text = response.content
                        .filter(b => b.type === 'text')
                        .map(b => b.text)
                        .join('');

                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ text }));
                } catch (err) {
                    const status = Number(err?.status) || 502;
                    console.error(`[anthropic-proxy] API error (${status}):`, err.message);
                    res.statusCode = status;
                    res.end(JSON.stringify({ error: `Anthropic API error: ${status} ${err.message}` }));
                }
            });
        },
    };
}
