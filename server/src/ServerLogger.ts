import { EventEmitter } from 'events';

export interface ServerLogEntry {
    timestamp: number;
    level: 'info' | 'warn' | 'error';
    tag: string;
    message: string;
    metadata?: Record<string, unknown>;
}

const MAX_ENTRIES = 1000;

class ServerLogger extends EventEmitter {
    private entries: ServerLogEntry[] = [];

    log(level: ServerLogEntry['level'], tag: string, message: string, metadata?: Record<string, unknown>) {
        const entry: ServerLogEntry = { timestamp: Date.now(), level, tag, message, metadata };
        this.entries.push(entry);
        if (this.entries.length > MAX_ENTRIES) this.entries.shift();
        this.emit('entry', entry);
    }

    info(tag: string, message: string, metadata?: Record<string, unknown>) {
        this.log('info', tag, message, metadata);
    }

    warn(tag: string, message: string, metadata?: Record<string, unknown>) {
        this.log('warn', tag, message, metadata);
    }

    error(tag: string, message: string, metadata?: Record<string, unknown>) {
        this.log('error', tag, message, metadata);
    }

    getEntries(): ServerLogEntry[] {
        return this.entries;
    }
}

export const serverLog = new ServerLogger();
