import { describe, expect, it } from 'vitest';
import {
    isRejectedFunctionSpec,
    validateFunctionGenerationResult,
    validateGeneratedFunctionSpec,
} from './validation';

describe('validation', () => {
    it('parses a valid generated function spec', () => {
        const result = validateGeneratedFunctionSpec({
            name: 'sum_values',
            description: 'Sums two numbers',
            parameters: [
                { name: 'left', type: 'number' },
                { name: 'right', type: 'number' },
            ],
            returnDescription: 'The numeric sum',
            code: 'return left + right;',
        });

        expect(result.name).toBe('sum_values');
        expect(result.parameters).toHaveLength(2);
    });

    it('accepts structured rejection payloads', () => {
        const result = validateFunctionGenerationResult({
            rejected: true,
            reason: 'Cannot send emails: sandbox has no network access or mail service access',
        });

        expect(isRejectedFunctionSpec(result)).toBe(true);
        expect(result).toEqual({
            rejected: true,
            reason: 'Cannot send emails: sandbox has no network access or mail service access',
        });
    });

    it('rejects malformed rejection payloads', () => {
        expect(() => validateFunctionGenerationResult({ rejected: true })).toThrow(
            'Invalid code-generation rejection: missing reason',
        );
    });
});