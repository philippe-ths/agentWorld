import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChronologicalLog, parseStructuredSummaryText } from './ChronologicalLog';

describe('parseStructuredSummaryText', () => {
    it('parses and normalizes a valid structured summary', () => {
        const parsed = parseStructuredSummaryText([
            'Summary: I inspected the workshop and prepared the next step.   ',
            'Ongoing goals or commitments: I still needed to collect materials before forging.',
            'Interactions: I coordinated with Bjorn about the handoff.',
            'Spatial knowledge: I stayed near the code forge entrance.',
        ].join('\n'));

        expect(parsed).toBe([
            'Summary: I inspected the workshop and prepared the next step.',
            'Ongoing goals or commitments: I still needed to collect materials before forging.',
            'Interactions: I coordinated with Bjorn about the handoff.',
            'Spatial knowledge: I stayed near the code forge entrance.',
        ].join('\n'));
    });

    it('throws when required labels are missing', () => {
        expect(() => parseStructuredSummaryText([
            'Summary: I inspected the workshop.',
            'Interactions: I coordinated with Bjorn.',
            'Spatial knowledge: I stayed near the code forge entrance.',
        ].join('\n'))).toThrow(/missing: Ongoing goals or commitments/);
    });
});

describe('ChronologicalLog maybeSummarize', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('falls back to raw text when structured parsing fails', async () => {
        const capturedSaves: string[] = [];
        const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
            if (input.includes('/chat')) {
                return {
                    ok: true,
                    json: async () => ({ text: 'Plain narrative fallback summary without labels' }),
                };
            }

            if (input.includes('/logs/') && init?.method === 'POST') {
                const body = JSON.parse(String(init.body ?? '{}')) as { content?: string };
                capturedSaves.push(String(body.content ?? ''));
                return { ok: true, json: async () => ({}) };
            }

            return { ok: false, status: 404, json: async () => ({}) };
        });

        vi.stubGlobal('fetch', fetchMock);

        const log = new ChronologicalLog('Ada');
        log.startTurn(1, { x: 1, y: 1 }, []);
        log.recordAction('I checked the forge status');
        log.startTurn(2, { x: 2, y: 1 }, []);
        log.recordAction('I moved toward the workshop');
        log.startTurn(3, { x: 3, y: 1 }, []);
        log.recordAction('I waited for new instructions');
        log.startTurn(4, { x: 4, y: 1 }, []);
        log.recordAction('I reviewed the map');

        await log.maybeSummarize(2);

        expect(capturedSaves).toHaveLength(1);
        expect(capturedSaves[0]).toContain('## Summary (Turns 1-2)');
        expect(capturedSaves[0]).toContain('Plain narrative fallback summary without labels');
    });
});
