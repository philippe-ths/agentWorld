import { LLM_ENDPOINTS } from './GameConfig';

const MAX_RESULT_LENGTH = 500;

export async function searchWeb(query: string): Promise<string> {
    const res = await fetch(LLM_ENDPOINTS.search, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Search request failed' }));
        return `Error: ${err.error ?? 'Search request failed'}`;
    }

    const data = await res.json();
    let text = data.answer ?? '';

    if (!text && data.results?.length) {
        text = data.results.map((r: { title: string; snippet: string }) =>
            `${r.title}: ${r.snippet}`
        ).join(' | ');
    }

    if (text.length > MAX_RESULT_LENGTH) {
        text = text.slice(0, MAX_RESULT_LENGTH - 3) + '...';
    }

    return text || 'No results found.';
}
