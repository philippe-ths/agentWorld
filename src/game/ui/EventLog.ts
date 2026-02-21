export type LogType =
    | 'action'
    | 'conversation'
    | 'system'
    | 'thought'
    | 'llm-call'
    | 'awareness'
    | 'skill-selection';

export interface LogEntry {
    timestamp: number;
    actor: string;
    type: LogType;
    message: string;
    npcId?: string;
    relatedNpcId?: string;
    metadata?: Record<string, unknown>;
}

export interface LogOpts {
    npcId?: string;
    relatedNpcId?: string;
    metadata?: Record<string, unknown>;
}

const MAX_ENTRIES = 500;
const entries: LogEntry[] = [];

export function log(actor: string, type: LogType, message: string, opts?: LogOpts) {
    const entry: LogEntry = {
        timestamp: Date.now(),
        actor,
        type,
        message,
        npcId: opts?.npcId,
        relatedNpcId: opts?.relatedNpcId,
        metadata: opts?.metadata,
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    window.dispatchEvent(new CustomEvent('activity-log', { detail: entry }));
}

export function getEntries(): LogEntry[] {
    return entries;
}
