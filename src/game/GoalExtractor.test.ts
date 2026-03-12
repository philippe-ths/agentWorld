import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractGoal } from './GoalExtractor';
import { GoalManager } from './GoalManager';

describe('GoalExtractor', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('completes the current goal when the extractor returns complete_current_goal()', async () => {
        const goalManager = new GoalManager('Ada');
        goalManager.setActiveGoal({
            source: 'Player request',
            goal: 'Inspect the pond',
            status: 'active',
            plan: 'Walk to the pond and look around',
            success: 'I know what is happening at the pond',
        });

        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ text: 'complete_current_goal()' }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ ok: true }),
            });
        vi.stubGlobal('fetch', fetchMock);

        const result = await extractGoal(
            'Ada',
            [{ speaker: 'Bjorn', text: 'The pond situation is already handled.' }],
            'WORLD STATE',
            goalManager,
        );

        expect(result).toEqual({ kind: 'completed', completedGoal: 'Inspect the pond', promotedGoal: null });
        expect(goalManager.getActiveGoal()).toBeNull();
    });

    it('reports when a conversation creates a new active goal', async () => {
        const goalManager = new GoalManager('Cora');

        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    text: [
                        'Source: Ada asked me to inspect the workshop',
                        'Goal: Inspect the workshop and report back',
                        'Status: active',
                        'Plan: Walk to the workshop and look for changes',
                        'Success: I can explain what I found at the workshop',
                    ].join('\n'),
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ ok: true }),
            });
        vi.stubGlobal('fetch', fetchMock);

        const result = await extractGoal(
            'Cora',
            [{ speaker: 'Ada', text: 'Please inspect the workshop.' }],
            'WORLD STATE',
            goalManager,
        );

        expect(result.kind).toBe('activated');
        if (result.kind === 'activated') {
            expect(result.goal.goal).toBe('Inspect the workshop and report back');
        }
        expect(goalManager.getActiveGoal()?.goal).toBe('Inspect the workshop and report back');
    });
});