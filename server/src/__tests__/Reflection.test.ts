import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../memory/ShortTermBuffer.js', () => ({
    getAll: vi.fn(),
    clear: vi.fn(),
}));

vi.mock('../memory/LongTermMemory.js', () => ({
    addMemory: vi.fn(async () => {}),
}));

vi.mock('../memory/KnowledgeGraph.js', () => ({
    addRule: vi.fn(async () => {}),
}));

vi.mock('../ai/PromptTemplates.js', () => ({
    buildReflectionPrompt: vi.fn(() => 'mock reflection prompt'),
    buildSelfCritiquePrompt: vi.fn(() => 'mock self-critique prompt'),
    getPersona: vi.fn(() => ({
        id: 'test',
        name: 'TestNpc',
        personality: 'Curious',
        goals: ['Explore'],
    })),
}));

vi.mock('../skills/SkillLibrary.js', () => ({
    recordOutcome: vi.fn(async () => {}),
}));

// Mock Anthropic SDK
const { mockCreate } = vi.hoisted(() => {
    return { mockCreate: vi.fn() };
});
vi.mock('@anthropic-ai/sdk', () => {
    const MockAnthropic = function(this: any) {
        this.messages = { create: mockCreate };
    };
    return { default: MockAnthropic };
});

import { reflect, selfCritique } from '../memory/Reflection.js';
import { getAll, clear } from '../memory/ShortTermBuffer.js';
import { addMemory } from '../memory/LongTermMemory.js';
import { addRule } from '../memory/KnowledgeGraph.js';
import { recordOutcome } from '../skills/SkillLibrary.js';
import type { ShortTermEntry } from '../memory/ShortTermBuffer.js';

function makeEntries(count: number): ShortTermEntry[] {
    return Array.from({ length: count }, (_, i) => ({
        timestamp: Date.now() - (count - i) * 1000,
        position: { x: i, y: i },
        nearbyEntities: [],
        event: `event-${i}`,
    }));
}

describe('Reflection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('reflect', () => {
        it('skips if fewer than 10 observations', async () => {
            vi.mocked(getAll).mockReturnValue(makeEntries(5));

            await reflect('test-npc');

            expect(mockCreate).not.toHaveBeenCalled();
            expect(clear).not.toHaveBeenCalled();
        });

        it('calls LLM and stores insights on success', async () => {
            vi.mocked(getAll).mockReturnValue(makeEntries(15));
            mockCreate.mockResolvedValue({
                content: [{ type: 'text', text: '- Insight one\n- Insight two' }],
            });

            await reflect('test-npc');

            expect(mockCreate).toHaveBeenCalledOnce();
            expect(addMemory).toHaveBeenCalledTimes(2);
            expect(vi.mocked(addMemory).mock.calls[0][1]).toBe('Insight one');
            expect(vi.mocked(addMemory).mock.calls[0][2]).toBe('insight');
            expect(vi.mocked(addMemory).mock.calls[0][3]).toBe(0.7);
            expect(clear).toHaveBeenCalledWith('test-npc');
        });

        it('clears buffer even on LLM failure (bug fix)', async () => {
            vi.mocked(getAll).mockReturnValue(makeEntries(15));
            mockCreate.mockRejectedValue(new Error('API error'));

            await reflect('test-npc');

            expect(addMemory).not.toHaveBeenCalled();
            // Buffer should still be cleared to avoid infinite retry
            expect(clear).toHaveBeenCalledWith('test-npc');
        });
    });

    describe('selfCritique', () => {
        it('skips if no failure events', async () => {
            await selfCritique('test-npc', [], {});

            expect(mockCreate).not.toHaveBeenCalled();
        });

        it('records skill failure and stores lessons', async () => {
            mockCreate.mockResolvedValue({
                content: [{ type: 'text', text: '1. Avoid water tiles\n2. Try different direction' }],
            });

            await selfCritique('test-npc', ['got stuck at (5,5)'], { skill: 'move_to', stuckCount: 3 });

            // Should record skill failure
            expect(recordOutcome).toHaveBeenCalledWith('move_to', false);

            // Should store lessons as high-importance memories
            expect(addMemory).toHaveBeenCalledTimes(2);
            expect(vi.mocked(addMemory).mock.calls[0][2]).toBe('lesson');
            expect(vi.mocked(addMemory).mock.calls[0][3]).toBe(0.9);

            // Should add rules to knowledge graph
            expect(addRule).toHaveBeenCalledTimes(2);
        });

        it('handles LLM error gracefully', async () => {
            mockCreate.mockRejectedValue(new Error('API error'));

            // Should not throw
            await selfCritique('test-npc', ['failed action'], { skill: 'wander' });

            expect(recordOutcome).toHaveBeenCalledWith('wander', false);
            // No lessons stored since LLM failed
            expect(addMemory).not.toHaveBeenCalled();
        });
    });
});
