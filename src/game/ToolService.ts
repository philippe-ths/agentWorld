import { LLM_ENDPOINTS } from './GameConfig';
import { CODE_GENERATION } from './prompts';
import { FunctionRecord, GeneratedFunctionSpec } from './GameConfig';
import {
    parseJsonFromModelText,
    validateGeneratedFunctionSpec,
    validateFunctionRecord,
    defaultValueForType
} from './validation';

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
