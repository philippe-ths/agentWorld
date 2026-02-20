import type { LogEntry } from './EventLog';

export class LogPanel {
    private panel: HTMLElement;
    private entries: HTMLElement;

    constructor() {
        this.panel = document.getElementById('log-panel')!;
        this.entries = document.getElementById('log-entries')!;

        document.getElementById('log-toggle')!.addEventListener('click', () => {
            this.panel.classList.toggle('collapsed');
        });

        window.addEventListener('activity-log', ((e: CustomEvent<LogEntry>) => {
            this.append(e.detail);
        }) as EventListener);
    }

    private append(entry: LogEntry) {
        const el = document.createElement('div');
        el.className = `log-entry ${entry.type}`;

        const time = new Date(entry.timestamp);
        const ts = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;

        el.innerHTML =
            `<span class="log-time">${ts}</span>` +
            `<span class="log-actor">${entry.actor}</span> ` +
            `<span class="log-msg">${escapeHtml(entry.message)}</span>`;

        this.entries.appendChild(el);

        // Auto-scroll to bottom
        this.entries.scrollTop = this.entries.scrollHeight;

        // Cap DOM nodes
        while (this.entries.children.length > 500) {
            this.entries.removeChild(this.entries.firstChild!);
        }
    }
}

function pad(n: number): string {
    return n < 10 ? '0' + n : String(n);
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
