import { FunctionRecord, GeneratedFunctionSpec } from './GameConfig';

interface UnsupportedPattern {
    test: RegExp;
    reason: string;
}

const REQUEST_PATTERNS: UnsupportedPattern[] = [
    {
        test: /\b(send(?:s|ing|ed)?|deliver(?:s|ing|ed)?|compose(?:s|d|ing)?|draft(?:s|ed|ing)?)\b[\s\S]{0,40}\b(email|mail|gmail|outlook|inbox|message)\b|\b(email|mail)\b[\s\S]{0,20}\b(send(?:s|ing|ed)?|deliver(?:s|ing|ed)?)\b/i,
        reason: 'Cannot send emails: sandbox has no network access or mail service access',
    },
    {
        test: /\b(fetch(?:es|ing|ed)?|call(?:s|ing|ed)?|request(?:s|ing|ed)?|post(?:s|ing|ed)?|get(?:s|ting)?|download(?:s|ing|ed)?|upload(?:s|ing|ed)?|connect(?:s|ing|ed)?|hit(?:s|ting)?)\b[\s\S]{0,40}\b(api|endpoint|url|website|server|webhook|service|internet|network|http|https)\b|\b(api|endpoint|url|website|server|webhook|internet|network|http|https)\b/i,
        reason: 'Cannot access external APIs or the network: sandbox has no network access',
    },
    {
        test: /\b(read(?:s|ing)?|write(?:s|n|ing)?|save(?:s|d|ing)?|load(?:s|ed|ing)?|open(?:s|ed|ing)?|create(?:s|d|ing)?|delete(?:s|d|ing)?|append(?:s|ed|ing)?|modif(?:y|ies|ied|ying))\b[\s\S]{0,40}\b(file|files|filesystem|folder|directory|disk|path|csv|json|txt)\b|\bfilesystem\b|\bfile system\b/i,
        reason: 'Cannot access the filesystem: sandbox has no filesystem access',
    },
    {
        test: /\b(database|db|sql|sqlite|postgres|mysql|mongodb|redis|query\s+the\s+database|insert\s+into|select\s+from)\b/i,
        reason: 'Cannot access databases: sandbox has no database access',
    },
];

const CODE_PATTERNS: UnsupportedPattern[] = [
    {
        test: /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bhttp\b|\bhttps\b/i,
        reason: 'Cannot access external APIs or the network: sandbox has no network access',
    },
    {
        test: /\brequire\s*\(|\bimport\s+|\bprocess\b|\bfs\b|\bwriteFile\b|\breadFile\b/i,
        reason: 'Cannot access the filesystem or Node APIs: sandbox only supports pure computation',
    },
];

function matchUnsupportedPattern(text: string, patterns: UnsupportedPattern[]): string | null {
    const normalized = text.trim();
    if (!normalized) return null;

    for (const pattern of patterns) {
        if (pattern.test.test(normalized)) {
            return pattern.reason;
        }
    }

    return null;
}

export function findUnsupportedRequestReason(request: string): string | null {
    return matchUnsupportedPattern(request, REQUEST_PATTERNS);
}

export function findUnsupportedImplementationReason(code: string): string | null {
    return matchUnsupportedPattern(code, CODE_PATTERNS);
}

export function findUnsupportedFunctionReason(
    input: Pick<GeneratedFunctionSpec, 'description' | 'code'> | Pick<FunctionRecord, 'description' | 'code'>,
): string | null {
    return findUnsupportedRequestReason(input.description) ?? findUnsupportedImplementationReason(input.code);
}