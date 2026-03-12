import { describe, expect, it } from 'vitest';
import { parseDirectives, repairDirectiveOutput, validateDirectiveOutput } from './DirectiveParser';

describe('DirectiveParser guard helpers', () => {
    it('repairs output by removing non-command lines', () => {
        const repaired = repairDirectiveOutput([
            'I will do this now:',
            'move_to(12,8)',
            'Then I should wait',
            'wait()',
        ].join('\n'));

        expect(repaired.cleanedText).toBe('move_to(12,8)\nwait()');
        expect(repaired.removedLines).toEqual(['I will do this now:', 'Then I should wait']);
    });

    it('rejects repaired output that has no executable directives', () => {
        const result = validateDirectiveOutput('');

        expect(result.isValid).toBe(false);
        expect(result.failureKey).toBe('output_format:empty_after_repair');
    });

    it('extracts REASONING from structured response', () => {
        const repaired = repairDirectiveOutput([
            'REASONING: I should move next to Bjorn and tell him the search result.',
            'ACTIONS:',
            'move_to(12,8)',
            'start_conversation_with(Bjorn, I found the answer at the terminal)',
        ].join('\n'));

        expect(repaired.reasoning).toBe('I should move next to Bjorn and tell him the search result.');
        expect(repaired.cleanedText).toBe('move_to(12,8)\nstart_conversation_with(Bjorn, I found the answer at the terminal)');
        expect(repaired.removedLines).toEqual([]);
    });

    it('parses commands without REASONING', () => {
        const repaired = repairDirectiveOutput('move_to(5,5)\nwait()');

        expect(repaired.reasoning).toBeUndefined();
        expect(repaired.cleanedText).toBe('move_to(5,5)\nwait()');
        expect(repaired.removedLines).toEqual([]);
    });

    it('does not count REASONING or ACTIONS lines as removed', () => {
        const repaired = repairDirectiveOutput([
            'REASONING: My current goal is complete.',
            'ACTIONS:',
            'complete_goal()',
        ].join('\n'));

        expect(repaired.removedLines).toEqual([]);
        expect(repaired.reasoning).toBe('My current goal is complete.');
    });
});

describe('parseDirectives', () => {
    it('skips REASONING and ACTIONS headers without flagging unknown', () => {
        const directives = parseDirectives([
            'REASONING: I should move next to Bjorn.',
            'ACTIONS:',
            'move_to(12,8)',
            'start_conversation_with(Bjorn, I found the answer)',
        ].join('\n'));

        expect(directives).toHaveLength(2);
        expect(directives[0]).toEqual({ type: 'move_to', x: 12, y: 8 });
        expect(directives[1]).toEqual({ type: 'start_conversation_with', targetName: 'Bjorn', message: 'I found the answer' });
        expect(directives.every(d => d.type !== 'unknown')).toBe(true);
    });
});