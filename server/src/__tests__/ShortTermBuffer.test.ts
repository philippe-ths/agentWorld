import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs modules
const fileStore = new Map<string, string>();

vi.mock('fs/promises', () => ({
    readFile: vi.fn(async (filePath: string) => {
        const data = fileStore.get(filePath);
        if (!data) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return data;
    }),
    writeFile: vi.fn(async (filePath: string, data: string) => {
        fileStore.set(filePath, data);
    }),
    mkdir: vi.fn(async () => {}),
}));

vi.mock('fs', () => ({
    existsSync: vi.fn((p: string) => fileStore.has(p) || p.endsWith('data')),
}));

import {
    addObservation,
    getRecent,
    getAll,
    clear,
    initBuffer,
    type ShortTermEntry,
} from '../memory/ShortTermBuffer.js';

function makeEntry(event: string, x = 0, y = 0): ShortTermEntry {
    return {
        timestamp: Date.now(),
        position: { x, y },
        nearbyEntities: [],
        event,
    };
}

describe('ShortTermBuffer', () => {
    beforeEach(() => {
        fileStore.clear();
        // Reset the internal buffers by clearing known npcs
        clear('test-npc');
    });

    it('addObservation stores entries', () => {
        addObservation('npc1', makeEntry('walked'));
        addObservation('npc1', makeEntry('talked'));
        expect(getAll('npc1')).toHaveLength(2);
    });

    it('getRecent returns last N entries', () => {
        for (let i = 0; i < 20; i++) {
            addObservation('npc2', makeEntry(`event-${i}`));
        }
        const recent = getRecent('npc2', 5);
        expect(recent).toHaveLength(5);
        expect(recent[0].event).toBe('event-15');
        expect(recent[4].event).toBe('event-19');
    });

    it('ring buffer caps at 50 entries', () => {
        for (let i = 0; i < 60; i++) {
            addObservation('npc3', makeEntry(`event-${i}`));
        }
        const all = getAll('npc3');
        expect(all).toHaveLength(50);
        // First 10 should have been shifted out
        expect(all[0].event).toBe('event-10');
        expect(all[49].event).toBe('event-59');
    });

    it('clear empties the buffer', () => {
        addObservation('npc4', makeEntry('hello'));
        addObservation('npc4', makeEntry('world'));
        expect(getAll('npc4')).toHaveLength(2);
        clear('npc4');
        expect(getAll('npc4')).toHaveLength(0);
    });

    it('getAll returns empty array for unknown npc', () => {
        expect(getAll('unknown-npc')).toEqual([]);
    });

    it('getRecent returns empty array for unknown npc', () => {
        expect(getRecent('unknown-npc')).toEqual([]);
    });

    it('different npcs have separate buffers', () => {
        addObservation('alice', makeEntry('alice-event'));
        addObservation('bob', makeEntry('bob-event'));
        expect(getAll('alice')).toHaveLength(1);
        expect(getAll('bob')).toHaveLength(1);
        expect(getAll('alice')[0].event).toBe('alice-event');
        expect(getAll('bob')[0].event).toBe('bob-event');
    });

    it('initBuffer loads from disk', async () => {
        const stored: ShortTermEntry[] = [
            makeEntry('restored-1'),
            makeEntry('restored-2'),
        ];
        // Pre-populate the mock file store
        // The file path includes a sanitized npcId
        // We need to set the right path — use a path that includes the buffer filename pattern
        const { existsSync } = await import('fs');
        vi.mocked(existsSync).mockReturnValue(true);

        const { readFile } = await import('fs/promises');
        vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(stored));

        await initBuffer('restored-npc');
        expect(getAll('restored-npc')).toHaveLength(2);
        expect(getAll('restored-npc')[0].event).toBe('restored-1');
    });
});
