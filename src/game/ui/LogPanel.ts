import type { LogEntry } from './EventLog';
import { getEntries } from './EventLog';
import type { EntityManager } from '../entities/EntityManager';
import { NPC } from '../entities/NPC';

const NPC_COLORS: Record<string, string> = {
    ada: '#ff6b6b',
    bjorn: '#6bc5ff',
    cora: '#b06bff',
};

export class LogPanel {
    private panel: HTMLElement;
    private entries: HTMLElement;
    private awarenessBar: HTMLElement;
    private selectedNpcId: string | null = null;
    private entityManager: EntityManager;
    private awarenessInterval: number | null = null;

    constructor(entityManager: EntityManager) {
        this.entityManager = entityManager;
        this.panel = document.getElementById('log-panel')!;
        this.entries = document.getElementById('log-entries')!;
        this.awarenessBar = document.getElementById('npc-awareness')!;

        document.getElementById('log-toggle')!.addEventListener('click', () => {
            this.panel.classList.toggle('collapsed');
        });

        // Wire NPC selector buttons
        const selectorBtns = document.querySelectorAll<HTMLButtonElement>('.npc-filter-btn');
        selectorBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const npcId = btn.dataset.npcId || null;
                this.selectNpc(npcId);
                selectorBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        window.addEventListener('activity-log', ((e: CustomEvent<LogEntry>) => {
            this.appendIfVisible(e.detail);
        }) as EventListener);
    }

    private selectNpc(npcId: string | null) {
        this.selectedNpcId = npcId;

        // Re-render all entries with filter
        this.entries.innerHTML = '';
        const all = getEntries();
        for (const entry of all) {
            this.appendIfVisible(entry);
        }

        // Start/stop awareness bar
        if (this.awarenessInterval) {
            clearInterval(this.awarenessInterval);
            this.awarenessInterval = null;
        }

        if (npcId) {
            this.updateAwareness();
            this.awarenessInterval = window.setInterval(() => this.updateAwareness(), 2000);
            this.awarenessBar.classList.remove('hidden');
        } else {
            this.awarenessBar.classList.add('hidden');
            this.awarenessBar.innerHTML = '';
        }
    }

    private matchesFilter(entry: LogEntry): boolean {
        if (!this.selectedNpcId) return true;
        return entry.npcId === this.selectedNpcId || entry.relatedNpcId === this.selectedNpcId;
    }

    private appendIfVisible(entry: LogEntry) {
        if (!this.matchesFilter(entry)) return;

        const el = document.createElement('div');
        el.className = `log-entry log-${entry.type}`;

        const time = new Date(entry.timestamp);
        const ts = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;

        const actorColor = NPC_COLORS[entry.npcId ?? ''] ?? '#ccc';

        el.innerHTML = this.renderEntry(entry, ts, actorColor);

        this.entries.appendChild(el);
        this.entries.scrollTop = this.entries.scrollHeight;

        while (this.entries.children.length > 500) {
            this.entries.removeChild(this.entries.firstChild!);
        }
    }

    private renderEntry(entry: LogEntry, ts: string, actorColor: string): string {
        const actor = `<span class="log-actor" style="color:${actorColor}">${esc(entry.actor)}</span>`;
        const time = `<span class="log-time">${ts}</span>`;

        switch (entry.type) {
            case 'thought':
                return `${time} ${actor} <span class="log-icon">💭</span> <span class="log-msg log-thought-text">${esc(entry.message)}</span>`;

            case 'llm-call':
                return `${time} ${actor} <span class="log-icon">⚡</span> <span class="log-msg log-llm-text">${esc(entry.message)}</span>`;

            case 'awareness': {
                const msg = esc(entry.message);
                return `${time} ${actor} <span class="log-icon">👁</span> <span class="log-msg log-awareness-text">${msg}</span>`;
            }

            case 'skill-selection':
                return `${time} ${actor} <span class="log-icon">🎯</span> <span class="log-msg log-skill-text">${esc(entry.message)}</span>`;

            case 'conversation':
                return `${time} ${actor} <span class="log-icon">💬</span> <span class="log-msg log-conv-text">${esc(entry.message)}</span>`;

            case 'system':
                return `${time} ${actor} <span class="log-icon">⚙️</span> <span class="log-msg log-system-text">${esc(entry.message)}</span>`;

            default: // 'action'
                return `${time} ${actor} <span class="log-msg">${esc(entry.message)}</span>`;
        }
    }

    private updateAwareness() {
        if (!this.selectedNpcId) return;

        const entities = this.entityManager.getAll();
        const npc = entities.find(e => e instanceof NPC && (e as NPC).id === this.selectedNpcId) as NPC | undefined;
        if (!npc) return;

        const nearby = this.entityManager.getEntitiesNear(npc.tilePos.x, npc.tilePos.y, 15)
            .filter(e => e !== npc)
            .map(e => {
                const dx = e.tilePos.x - npc.tilePos.x;
                const dy = e.tilePos.y - npc.tilePos.y;
                const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
                return `<span class="aw-entity">${esc(e.name)} <span class="aw-dist">${dist} tiles</span></span>`;
            });

        const color = NPC_COLORS[this.selectedNpcId] ?? '#ccc';

        this.awarenessBar.innerHTML =
            `<div class="aw-row">` +
            `<span class="aw-label" style="color:${color}">${esc(npc.name)}</span>` +
            `<span class="aw-pos">📍 (${npc.tilePos.x}, ${npc.tilePos.y})</span>` +
            `<span class="aw-skill">🎯 ${esc(npc.currentSkill ?? 'idle')}</span>` +
            (npc.isInConversation ? '<span class="aw-conv">💬 in conversation</span>' : '') +
            `</div>` +
            (nearby.length > 0
                ? `<div class="aw-row aw-nearby">👁 nearby: ${nearby.join(', ')}</div>`
                : `<div class="aw-row aw-nearby">👁 nobody nearby</div>`);
    }
}

function pad(n: number): string {
    return n < 10 ? '0' + n : String(n);
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
