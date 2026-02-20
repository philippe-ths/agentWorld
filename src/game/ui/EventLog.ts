export interface LogEntry {
    timestamp: number;
    actor: string;
    type: 'action' | 'conversation' | 'system';
    message: string;
}

const MAX_ENTRIES = 500;
const entries: LogEntry[] = [];

export function log(actor: string, type: LogEntry['type'], message: string) {
    const entry: LogEntry = { timestamp: Date.now(), actor, type, message };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    window.dispatchEvent(new CustomEvent('activity-log', { detail: entry }));
}

export function getEntries(): LogEntry[] {
    return entries;
}
