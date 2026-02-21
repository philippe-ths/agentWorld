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
        // DATA_DIR always exists, individual files check fileStore
        if (p.endsWith('data')) return true;
        return fileStore.has(p);
    }),
}));

// Mock embeddings to avoid loading the model
vi.mock('../memory/Embeddings.js', () => ({
    embed: vi.fn(async (text: string) => {
        // Return a deterministic fake embedding based on text hash
        const arr = new Array(384).fill(0);
        for (let i = 0; i < text.length; i++) {
            arr[i % 384] = text.charCodeAt(i) / 255;
        }
        // Normalize
        const norm = Math.sqrt(arr.reduce((s: number, v: number) => s + v * v, 0));
        return arr.map((v: number) => v / (norm || 1));
    }),
    cosineSimilarity: vi.fn((a: number[], b: number[]) => {
        if (a.length !== b.length) return 0;
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dot / denom;
    }),
}));

import { addMemory, getRelevantMemories, decayMemories, loadBeliefs, saveBeliefs, updateBeliefs } from '../memory/LongTermMemory.js';
import type { Observation, Memory } from '../types.js';

function makeObs(overrides: Partial<Observation> = {}): Observation {
    return {
        npcId: 'test-npc',
        name: 'TestNpc',
        position: { x: 5, y: 5 },
        nearbyEntities: [],
        isInConversation: false,
        currentSkill: null,
        recentEvents: [],
        activeGoals: [],
        ...overrides,
    };
}

describe('LongTermMemory', () => {
    beforeEach(() => {
        fileStore.clear();
    });

    describe('addMemory', () => {
        it('stores a memory with embedding', async () => {
            await addMemory('memnpc', 'I saw a tree', 'fact', 0.6);

            // Check what was written to the file store
            const files = [...fileStore.entries()].filter(([k]) => k.includes('memnpc_memory'));
            expect(files).toHaveLength(1);

            const memories = JSON.parse(files[0][1]) as Memory[];
            expect(memories).toHaveLength(1);
            expect(memories[0].text).toBe('I saw a tree');
            expect(memories[0].type).toBe('fact');
            expect(memories[0].importance).toBe(0.6);
            expect(memories[0].accessCount).toBe(0);
            expect(memories[0].embedding).toBeDefined();
            expect(memories[0].embedding).toHaveLength(384);
        });

        it('appends multiple memories', async () => {
            await addMemory('memnpc2', 'first memory', 'fact');
            await addMemory('memnpc2', 'second memory', 'insight', 0.8);

            const files = [...fileStore.entries()].filter(([k]) => k.includes('memnpc2_memory'));
            const memories = JSON.parse(files[0][1]) as Memory[];
            expect(memories).toHaveLength(2);
        });
    });

    describe('getRelevantMemories', () => {
        it('returns relevant memories matching nearby entities', async () => {
            await addMemory('rel-npc', 'Ada is friendly', 'fact', 0.8);
            await addMemory('rel-npc', 'The pond is deep', 'fact', 0.5);

            const obs = makeObs({
                npcId: 'rel-npc',
                nearbyEntities: [
                    { id: 'ada', name: 'Ada', position: { x: 3, y: 3 }, distance: 2 },
                ],
            });

            const results = await getRelevantMemories('rel-npc', obs);
            expect(results.length).toBeGreaterThan(0);
            expect(results.length).toBeLessThanOrEqual(5);
        });

        it('returns empty array when no memories', async () => {
            const obs = makeObs({ npcId: 'empty-npc' });
            const results = await getRelevantMemories('empty-npc', obs);
            expect(results).toEqual([]);
        });

        it('increments access counts', async () => {
            await addMemory('accnpc', 'some memory', 'fact', 0.5);
            const obs = makeObs({ npcId: 'accnpc' });
            await getRelevantMemories('accnpc', obs);

            const files = [...fileStore.entries()].filter(([k]) => k.includes('accnpc_memory'));
            const memories = JSON.parse(files[0][1]) as Memory[];
            expect(memories[0].accessCount).toBe(1);
        });
    });

    describe('decayMemories', () => {
        it('reduces importance of memories', async () => {
            await addMemory('decaynpc', 'test memory', 'fact', 0.5);

            await decayMemories('decaynpc');

            const files = [...fileStore.entries()].filter(([k]) => k.includes('decaynpc_memory'));
            const memories = JSON.parse(files[0][1]) as Memory[];
            expect(memories[0].importance).toBeLessThan(0.5);
        });

        it('removes memories below threshold', async () => {
            await addMemory('decaynpc2', 'fading memory', 'fact', 0.06);

            // Decay multiple times to push below 0.05
            for (let i = 0; i < 20; i++) {
                await decayMemories('decaynpc2');
            }

            const files = [...fileStore.entries()].filter(([k]) => k.includes('decaynpc2_memory'));
            const memories = JSON.parse(files[0][1]) as Memory[];
            expect(memories).toHaveLength(0);
        });

        it('lesson-type memories decay slower', async () => {
            await addMemory('lessonnpc', 'regular fact', 'fact', 0.5);
            await addMemory('lessonnpc', 'important lesson', 'lesson', 0.5);

            for (let i = 0; i < 5; i++) {
                await decayMemories('lessonnpc');
            }

            const files = [...fileStore.entries()].filter(([k]) => k.includes('lessonnpc_memory'));
            const memories = JSON.parse(files[0][1]) as Memory[];
            const fact = memories.find(m => m.type === 'fact')!;
            const lesson = memories.find(m => m.type === 'lesson')!;
            expect(lesson.importance).toBeGreaterThan(fact.importance);
        });
    });

    describe('Beliefs', () => {
        it('loadBeliefs returns defaults when no file', async () => {
            const beliefs = await loadBeliefs('new-npc');
            expect(beliefs.knownEntities).toEqual({});
            expect(beliefs.visitedAreas).toEqual([]);
            expect(beliefs.insights).toEqual([]);
        });

        it('saveBeliefs then loadBeliefs roundtrips', async () => {
            const beliefs = {
                knownEntities: { Ada: { lastSeen: { x: 1, y: 2 }, relationship: 'friend' } },
                visitedAreas: [{ x: 0, y: 0 }],
                insights: ['Water is wet'],
            };
            await saveBeliefs('belief-npc', beliefs);
            const loaded = await loadBeliefs('belief-npc');
            expect(loaded).toEqual(beliefs);
        });

        it('updateBeliefs merges entities', async () => {
            await saveBeliefs('upd-npc', {
                knownEntities: { Ada: { lastSeen: { x: 0, y: 0 }, relationship: 'acquaintance' } },
                visitedAreas: [],
                insights: [],
            });

            await updateBeliefs('upd-npc', {
                entities: { Ada: { relationship: 'friend' } },
            });

            const loaded = await loadBeliefs('upd-npc');
            expect(loaded.knownEntities['Ada'].relationship).toBe('friend');
        });

        it('updateBeliefs adds insights without duplicates', async () => {
            await saveBeliefs('ins-npc', {
                knownEntities: {},
                visitedAreas: [],
                insights: ['First insight'],
            });

            await updateBeliefs('ins-npc', {
                insights: ['First insight', 'Second insight'],
            });

            const loaded = await loadBeliefs('ins-npc');
            expect(loaded.insights).toEqual(['First insight', 'Second insight']);
        });
    });
});
