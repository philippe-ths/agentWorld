import Anthropic from '@anthropic-ai/sdk';

/**
 * Vite plugin that adds a POST /api/chat endpoint proxying to Anthropic Claude.
 * Reads ANTHROPIC_API_KEY from process.env (set it before running `npm run dev`).
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

                const { system, messages } = parsed;
                if (!system || !messages) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: 'Missing system or messages' }));
                    return;
                }

                try {
                    const client = new Anthropic.default({ apiKey });
                    const response = await client.messages.create({
                        model: 'claude-sonnet-4-20250514',
                        max_tokens: 256,
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
