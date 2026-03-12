import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseReflectionMarkdown, ReflectionManager, summarizeRepeatedObstacle } from './ReflectionManager';

describe('ReflectionManager helpers', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('parses persisted reflection markdown', () => {
        const parsed = parseReflectionMarkdown([
            '## Reflection',
            'Repeated obstacle: no_path:(12,8) (repeated 2 times)',
            'Recent success pattern: Checking adjacency before using a tool',
            'Failed assumption: I assumed the pond path was open',
            'Strategy adjustment: Walk around the water before trying again',
            'Confidence: 4',
            'Stale reflection flag: no',
            'Updated turn: 15',
            'Trigger: repeated_failed_action',
            '',
            '## Recent Failures',
            '- Turn 13: no_path:(12,8)',
            '- Turn 14: no_path:(12,8)',
            '',
            '## Recent Successes',
            '- Turn 15: Completed goal: inspect the pond',
        ].join('\n'));

        expect(parsed.state.repeatedObstacle).toBe('no_path:(12,8) (repeated 2 times)');
        expect(parsed.state.confidence).toBe(4);
        expect(parsed.state.stale).toBe(false);
        expect(parsed.failures).toHaveLength(2);
        expect(parsed.successes[0].label).toBe('Completed goal: inspect the pond');
    });

    it('summarizes repeated obstacle patterns from structured failures', () => {
        expect(summarizeRepeatedObstacle([
            { turnNumber: 8, label: 'no_path:(4,4)' },
            { turnNumber: 9, label: 'wrong_tile:code_forge' },
            { turnNumber: 10, label: 'no_path:(4,4)' },
        ])).toBe('no_path:(4,4) (repeated 2 times)');
    });

    it('promotes consecutive output format failures to primary obstacle', () => {
        const manager = new ReflectionManager('Ada');

        manager.recordOutputFormatFailure(10, 'output_format:unknown_directive', 'Unknown directive found');
        manager.recordOutputFormatFailure(11, 'output_format:unknown_directive', 'Unknown directive found');

        const state = manager.getState();
        expect(state.activeObstacle).toContain('output_format:unknown_directive');
        expect(state.trigger).toBe('primary_output_obstacle');
        expect(state.stale).toBe(true);
    });

    it('retires active obstacle and strategy after completion', () => {
        const manager = new ReflectionManager('Bjorn');

        manager.markUnknownDirectiveFlood(12, 3);
        manager.markGoalCompleted(12, 'Inspect the workshop');

        const state = manager.getState();
        expect(state.activeObstacle).toBe('none');
        expect(state.resolvedObstacle).toContain('output_format_unknown_flood');
        expect(state.currentStrategy).toBe('none');
        expect(state.retiredStrategy).toBe('Respond with command lines only and no commentary');
    });

    it('captures completion lesson text', async () => {
        const manager = new ReflectionManager('Cora');
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ text: 'Lesson: Verify placement with precise checks before finalizing output' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        await manager.generateCompletionLesson(14, 'Place function building safely', 'MEMORY', 'WORLD');

        expect(manager.getState().completionLesson).toBe('Verify placement with precise checks before finalizing output');
    });
});