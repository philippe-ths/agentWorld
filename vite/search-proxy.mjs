/**
 * Vite plugin that adds a POST /api/search endpoint proxying to Tavily.
 * Reads TAVILY_API_KEY from process.env (loaded by anthropic-proxy).
 */
export function searchProxy() {
    return {
        name: 'search-proxy',
        configureServer(server) {
            server.middlewares.use('/api/search', async (req, res) => {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.end(JSON.stringify({ error: 'Method not allowed' }));
                    return;
                }

                const apiKey = process.env.TAVILY_API_KEY;
                if (!apiKey) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: 'TAVILY_API_KEY not set' }));
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

                const { query } = parsed;
                if (!query || typeof query !== 'string' || !query.trim()) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: 'Missing or empty query' }));
                    return;
                }

                try {
                    const tavilyRes = await fetch('https://api.tavily.com/search', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            api_key: apiKey,
                            query: query.trim(),
                            include_answer: true,
                            max_results: 3,
                        }),
                    });

                    if (!tavilyRes.ok) {
                        const errText = await tavilyRes.text().catch(() => 'Unknown error');
                        console.error(`[search-proxy] Tavily API error ${tavilyRes.status}: ${errText}`);
                        res.statusCode = 502;
                        res.end(JSON.stringify({ error: 'Search API error' }));
                        return;
                    }

                    const data = await tavilyRes.json();
                    const answer = data.answer ?? '';
                    const results = (data.results ?? []).slice(0, 3).map(r => ({
                        title: r.title ?? '',
                        snippet: r.content ?? '',
                    }));

                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ answer, results }));
                } catch (err) {
                    console.error('[search-proxy] Tavily request failed:', err.message);
                    res.statusCode = 502;
                    res.end(JSON.stringify({ error: 'Search request failed' }));
                }
            });
        },
    };
}
