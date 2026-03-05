import { LLM_ENDPOINTS } from './GameConfig';
import { CODE_GENERATION } from './prompts';
import { FunctionRecord, GeneratedFunctionSpec } from './GameConfig';

const MAX_RESULT_LENGTH = 500;
const NAME_RE = /^[a-z_][a-z0-9_]*$/;

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

export interface SandboxExecuteResult {
    ok: boolean;
    result: string;
}

export async function generateFunctionSpec(
    description: string,
    existing?: { name: string; code: string; description: string },
    changeDescription?: string,
): Promise<GeneratedFunctionSpec> {
    const requestLines = [
        `Create a function for this request: ${description}`,
    ];

    if (existing && changeDescription) {
        requestLines.push(`Update existing function \"${existing.name}\".`);
        requestLines.push(`Current description: ${existing.description}`);
        requestLines.push(`Current code body:\n${existing.code}`);
        requestLines.push(`Requested change: ${changeDescription}`);
    }

    const body = {
        model: CODE_GENERATION.model,
        system: CODE_GENERATION.buildSystem(),
        messages: [{ role: 'user', content: requestLines.join('\n\n') }],
        max_tokens: CODE_GENERATION.maxTokens,
    };

    const res = await fetch(LLM_ENDPOINTS.chat, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Code generation failed' }));
        throw new Error(err.error ?? 'Code generation failed');
    }

    const data = await res.json();
    const text = String(data.text ?? '').trim();
    const parsed = parseJsonFromModelText(text);
    return validateGeneratedFunctionSpec(parsed);
}

export async function executeFunction(
    parameters: string[],
    code: string,
    args: unknown[],
): Promise<SandboxExecuteResult> {
    const res = await fetch(LLM_ENDPOINTS.execute, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parameters, code, args }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Sandbox execution failed' }));
        return { ok: false, result: `Error: ${err.error ?? 'Sandbox execution failed'}` };
    }

    const data = await res.json();
    if (typeof data.error === 'string' && data.error.length > 0) {
        return { ok: false, result: data.error };
    }
    return { ok: true, result: String(data.result ?? 'undefined') };
}

export async function testFunctionSpec(spec: GeneratedFunctionSpec): Promise<SandboxExecuteResult> {
    const args = spec.parameters.map(p => defaultValueForType(p.type));
    const names = spec.parameters.map(p => p.name);
    return executeFunction(names, spec.code, args);
}

export async function saveFunctionRecord(record: FunctionRecord): Promise<void> {
    const endpoint = `${LLM_ENDPOINTS.functions}/${encodeURIComponent(record.name)}`;
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to save function record' }));
        throw new Error(err.error ?? 'Failed to save function record');
    }
}

export async function loadFunctionRecords(): Promise<FunctionRecord[]> {
    const res = await fetch(LLM_ENDPOINTS.functions, { method: 'GET' });
    if (!res.ok) return [];

    const data = await res.json();
    const list = Array.isArray(data.functions) ? data.functions : [];
    const valid: FunctionRecord[] = [];

    for (const item of list) {
        try {
            valid.push(validateFunctionRecord(item));
        } catch {
            // Ignore malformed stored entries so startup remains resilient.
        }
    }

    return valid;
}

export async function loadFunctionRecord(name: string): Promise<FunctionRecord | null> {
    const endpoint = `${LLM_ENDPOINTS.functions}/${encodeURIComponent(name)}`;
    const res = await fetch(endpoint, { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json();
    return validateFunctionRecord(data.function);
}

export async function deleteFunctionRecord(name: string): Promise<void> {
    const endpoint = `${LLM_ENDPOINTS.functions}/${encodeURIComponent(name)}`;
    const res = await fetch(endpoint, { method: 'DELETE' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to delete function record' }));
        throw new Error(err.error ?? 'Failed to delete function record');
    }
}

function parseJsonFromModelText(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return JSON.parse(text.slice(start, end + 1));
        }
        throw new Error('Code generation returned unparseable JSON');
    }
}

function validateGeneratedFunctionSpec(input: unknown): GeneratedFunctionSpec {
    if (!input || typeof input !== 'object') {
        throw new Error('Invalid code-generation output: expected object');
    }
    const raw = input as Record<string, unknown>;

    const name = String(raw.name ?? '').trim();
    const description = String(raw.description ?? '').trim();
    const returnDescription = String(raw.returnDescription ?? '').trim();
    const code = String(raw.code ?? '').trim();
    const parameters = Array.isArray(raw.parameters)
        ? raw.parameters.map((p): { name: string; type: string } => {
            const val = p as Record<string, unknown>;
            return {
                name: String(val.name ?? '').trim(),
                type: String(val.type ?? 'unknown').trim() || 'unknown',
            };
        })
        : [];

    if (!NAME_RE.test(name)) {
        throw new Error(`Invalid function name: ${name || '(empty)'}`);
    }
    if (!description) throw new Error('Missing function description');
    if (!returnDescription) throw new Error('Missing return description');
    if (!code) throw new Error('Missing function code');
    if (parameters.some(p => !NAME_RE.test(p.name))) {
        throw new Error('Invalid parameter names in code-generation output');
    }

    return { name, description, parameters, returnDescription, code };
}

function validateFunctionRecord(input: unknown): FunctionRecord {
    if (!input || typeof input !== 'object') {
        throw new Error('Invalid function record: expected object');
    }
    const raw = input as Record<string, unknown>;
    const spec = validateGeneratedFunctionSpec(raw);
    const tile = raw.tile as { x?: unknown; y?: unknown };
    const creator = String(raw.creator ?? '').trim();

    if (!tile || typeof tile.x !== 'number' || typeof tile.y !== 'number') {
        throw new Error('Invalid function record tile');
    }
    if (!creator) {
        throw new Error('Invalid function record creator');
    }

    return {
        ...spec,
        tile: { x: tile.x, y: tile.y },
        creator,
    };
}

function defaultValueForType(type: string): unknown {
    const t = type.toLowerCase();
    if (t.includes('number')) return 1;
    if (t.includes('boolean')) return true;
    if (t.includes('array')) return [1, 2, 3];
    if (t.includes('object') || t.includes('map')) return { key: 'value' };
    if (t.includes('set')) return ['a', 'b'];
    if (t.includes('date')) return '2026-01-01T00:00:00.000Z';
    if (t.includes('regexp')) return 'abc';
    return 'sample';
}
