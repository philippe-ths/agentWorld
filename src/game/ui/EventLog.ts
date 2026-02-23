export type LogType =
    | 'action'
    | 'conversation'
    | 'system'
    | 'thought'
    | 'llm-call'
    | 'awareness'
    | 'skill-selection'
    | 'protocol'
    | 'server';

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

const MAX_ENTRIES = 5000;
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

function padMs(n: number): string {
    if (n < 10) return '00' + n;
    if (n < 100) return '0' + n;
    return String(n);
}

function pad2(n: number): string {
    return n < 10 ? '0' + n : String(n);
}

export function formatLogEntry(entry: LogEntry): string {
    const d = new Date(entry.timestamp);
    const ts = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${padMs(d.getMilliseconds())}`;
    const type = entry.type.padEnd(12);
    return `[${ts}] [${type}] ${entry.actor}: ${entry.message}`;
}

export function exportLog(): string {
    return entries.map(formatLogEntry).join('\n');
}
