import { describe, it, expect, vi } from 'vitest';
import { cosineSimilarity } from '../memory/Embeddings.js';

// We only test the pure function — embed/embedBatch require the ML model

describe('Embeddings', () => {
    describe('cosineSimilarity', () => {
        it('returns 1 for identical vectors', () => {
            const v = [1, 0, 0, 0];
            expect(cosineSimilarity(v, v)).toBeCloseTo(1);
        });

        it('returns 0 for orthogonal vectors', () => {
            const a = [1, 0, 0, 0];
            const b = [0, 1, 0, 0];
            expect(cosineSimilarity(a, b)).toBeCloseTo(0);
        });

        it('returns -1 for opposite vectors', () => {
            const a = [1, 0];
            const b = [-1, 0];
            expect(cosineSimilarity(a, b)).toBeCloseTo(-1);
        });

        it('returns 0 for mismatched lengths', () => {
            expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
        });

        it('returns 0 for zero vectors', () => {
            expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
        });

        it('computes similarity for normalized vectors', () => {
            const a = [0.6, 0.8];
            const b = [0.8, 0.6];
            const expected = 0.6 * 0.8 + 0.8 * 0.6; // = 0.96
            expect(cosineSimilarity(a, b)).toBeCloseTo(expected);
        });
    });
});
