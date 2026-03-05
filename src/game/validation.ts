import { GeneratedFunctionSpec, FunctionRecord } from './GameConfig';

const NAME_RE = /^[a-z_][a-z0-9_]*$/;

export function parseJsonFromModelText(text: string): unknown {
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

export function validateGeneratedFunctionSpec(input: unknown): GeneratedFunctionSpec {
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

export function validateFunctionRecord(input: unknown): FunctionRecord {
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

export function defaultValueForType(type: string): unknown {
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