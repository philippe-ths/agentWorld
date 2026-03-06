import { describe, expect, it } from 'vitest';
import { FunctionRecord } from './GameConfig';
import { buildRemovedFunctionNote, partitionPersistedFunctionRecords } from './PersistedFunctionAudit';

function makeRecord(overrides: Partial<FunctionRecord> = {}): FunctionRecord {
    return {
        name: 'sum_values',
        description: 'Calculate the sum of two numbers',
        parameters: [
            { name: 'left', type: 'number' },
            { name: 'right', type: 'number' },
        ],
        returnDescription: 'The numeric sum',
        code: 'return left + right;',
        tile: { x: 1, y: 1 },
        creator: 'Bjorn',
        ...overrides,
    };
}

describe('PersistedFunctionAudit', () => {
    it('partitions unsupported persisted functions for cleanup', () => {
        const supported = makeRecord();
        const unsupported = makeRecord({
            name: 'send_email',
            description: 'Sends an email to the player with today\'s exchange rate',
        });

        const result = partitionPersistedFunctionRecords([supported, unsupported]);

        expect(result.supported).toEqual([supported]);
        expect(result.unsupported).toHaveLength(1);
        expect(result.unsupported[0].record.name).toBe('send_email');
        expect(result.unsupported[0].reason).toBe(
            'Cannot send emails: sandbox has no network access or mail service access',
        );
    });

    it('builds a cleanup note for the creator log', () => {
        const record = makeRecord({ name: 'send_email' });

        expect(buildRemovedFunctionNote(
            record,
            'Cannot send emails: sandbox has no network access or mail service access',
        )).toBe(
            'System note: Code Forge removed function "send_email" because it was unsupported. Cannot send emails: sandbox has no network access or mail service access',
        );
    });
});