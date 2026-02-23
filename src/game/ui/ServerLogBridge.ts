import { log } from './EventLog';

export function connectServerLogStream() {
    const source = new EventSource('http://localhost:3001/api/logs/stream');

    source.onmessage = (event) => {
        try {
            const entry = JSON.parse(event.data);
            if (entry.type === 'connected') return;

            const level = entry.level === 'error' ? '❌' : entry.level === 'warn' ? '⚠️' : '';
            const prefix = level ? `${level} ` : '';
            const meta = entry.metadata
                ? ` (${Object.entries(entry.metadata).map(([k, v]) => `${k}=${v}`).join(', ')})`
                : '';

            log('server', 'server', `${prefix}[${entry.tag}] ${entry.message}${meta}`);
        } catch {
            // ignore unparseable messages
        }
    };

    source.onerror = () => {
        // EventSource auto-reconnects; no action needed
    };

    return source;
}
