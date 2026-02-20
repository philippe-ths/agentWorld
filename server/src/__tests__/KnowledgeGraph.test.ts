import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs
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
    existsSync: vi.fn((p: string) => {
        if (p.endsWith('data')) return true;
        return fileStore.has(p);
    }),
}));

import {
    loadGraph,
    upsertEntity,
    upsertRelation,
    addRule,
    getEntityInfo,
    getRelationsFor,
    summarizeKnowledge,
} from '../memory/KnowledgeGraph.js';

describe('KnowledgeGraph', () => {
    beforeEach(() => {
        fileStore.clear();
    });

    describe('loadGraph', () => {
        it('returns empty graph when no file exists', async () => {
            const graph = await loadGraph('new-npc');
            expect(graph.entities).toEqual({});
            expect(graph.relations).toEqual([]);
            expect(graph.rules).toEqual([]);
        });
    });

    describe('upsertEntity', () => {
        it('creates a new entity', async () => {
            await upsertEntity('kg-npc', 'Ada', 'npc', { mood: 'happy' }, { x: 3, y: 4 });
            const entity = await getEntityInfo('kg-npc', 'Ada');
            expect(entity).toBeDefined();
            expect(entity!.name).toBe('Ada');
            expect(entity!.type).toBe('npc');
            expect(entity!.properties.mood).toBe('happy');
            expect(entity!.lastSeen).toEqual({ x: 3, y: 4 });
        });

        it('merges properties on update', async () => {
            await upsertEntity('kg-npc2', 'Bjorn', 'npc', { mood: 'jolly' });
            await upsertEntity('kg-npc2', 'Bjorn', 'npc', { activity: 'walking' });

            const entity = await getEntityInfo('kg-npc2', 'Bjorn');
            expect(entity!.properties.mood).toBe('jolly');
            expect(entity!.properties.activity).toBe('walking');
        });

        it('preserves lastSeen when not provided in update', async () => {
            await upsertEntity('kg-npc3', 'Cora', 'npc', {}, { x: 10, y: 20 });
            await upsertEntity('kg-npc3', 'Cora', 'npc', { mood: 'calm' });

            const entity = await getEntityInfo('kg-npc3', 'Cora');
            expect(entity!.lastSeen).toEqual({ x: 10, y: 20 });
        });
    });

    describe('upsertRelation', () => {
        it('creates a new relation', async () => {
            await upsertRelation('rel-npc', 'Ada', 'Bjorn', 'friend_of', 0.8, 'had conversation');
            const relations = await getRelationsFor('rel-npc', 'Ada');
            expect(relations).toHaveLength(1);
            expect(relations[0].type).toBe('friend_of');
            expect(relations[0].strength).toBe(0.8);
        });

        it('updates existing relation', async () => {
            await upsertRelation('rel-npc2', 'Ada', 'Cora', 'knows', 0.5, 'met once');
            await upsertRelation('rel-npc2', 'Ada', 'Cora', 'knows', 0.9, 'met many times');

            const relations = await getRelationsFor('rel-npc2', 'Ada');
            expect(relations).toHaveLength(1);
            expect(relations[0].strength).toBe(0.9);
            expect(relations[0].evidence).toBe('met many times');
        });

        it('getRelationsFor returns relations where entity is from or to', async () => {
            await upsertRelation('rel-npc3', 'Ada', 'Bjorn', 'friend_of', 0.8, 'test');
            await upsertRelation('rel-npc3', 'Cora', 'Bjorn', 'knows', 0.5, 'test');

            const bjornRels = await getRelationsFor('rel-npc3', 'Bjorn');
            expect(bjornRels).toHaveLength(2);
        });
    });

    describe('addRule', () => {
        it('adds a new rule', async () => {
            await addRule('rule-npc', 'Water is not walkable');
            const graph = await loadGraph('rule-npc');
            expect(graph.rules).toContain('Water is not walkable');
        });

        it('deduplicates identical rules', async () => {
            await addRule('rule-npc2', 'Trees block movement');
            await addRule('rule-npc2', 'Trees block movement');

            const graph = await loadGraph('rule-npc2');
            expect(graph.rules.filter(r => r === 'Trees block movement')).toHaveLength(1);
        });
    });

    describe('summarizeKnowledge', () => {
        it('returns empty string for empty graph', async () => {
            const summary = await summarizeKnowledge('empty-npc');
            expect(summary).toBe('');
        });

        it('includes entities, relations, and rules', async () => {
            await upsertEntity('sum-npc', 'Ada', 'npc', { mood: 'curious' });
            await upsertRelation('sum-npc', 'Ada', 'Bjorn', 'friend_of', 0.8, 'test');
            await addRule('sum-npc', 'Water blocks movement');

            const summary = await summarizeKnowledge('sum-npc');
            expect(summary).toContain('Ada');
            expect(summary).toContain('friend_of');
            expect(summary).toContain('Water blocks movement');
        });
    });
});
