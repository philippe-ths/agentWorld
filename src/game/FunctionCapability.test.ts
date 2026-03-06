import { describe, expect, it } from 'vitest';
import {
    findUnsupportedFunctionReason,
    findUnsupportedImplementationReason,
    findUnsupportedRequestReason,
} from './FunctionCapability';

describe('FunctionCapability', () => {
    it('rejects email requests', () => {
        expect(findUnsupportedRequestReason('Send an email with the latest exchange rate')).toBe(
            'Cannot send emails: sandbox has no network access or mail service access',
        );
    });

    it('rejects filesystem requests', () => {
        expect(findUnsupportedRequestReason('Read a JSON file from disk and summarize it')).toBe(
            'Cannot access the filesystem: sandbox has no filesystem access',
        );
    });

    it('rejects forbidden implementation code', () => {
        expect(findUnsupportedImplementationReason('const res = await fetch(url); return res;')).toBe(
            'Cannot access external APIs or the network: sandbox has no network access',
        );
    });

    it('allows pure computation functions', () => {
        expect(findUnsupportedFunctionReason({
            description: 'Calculate the average of a list of numbers',
            code: 'return values.reduce((sum, value) => sum + value, 0) / values.length;',
        })).toBeNull();
    });
});