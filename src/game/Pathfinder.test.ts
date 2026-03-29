import { describe, expect, it } from 'vitest';
import { findPath } from './Pathfinder';

/** Walkability bounded to a grid so A* terminates. */
function boundedWalkable(width: number, height: number, blocked = new Set<string>()) {
    return (x: number, y: number) =>
        x >= 0 && x < width && y >= 0 && y < height && !blocked.has(`${x},${y}`);
}

describe('Pathfinder', () => {
    const walk10x10 = boundedWalkable(10, 10);

    describe('basic pathing', () => {
        it('returns empty array when start equals goal', () => {
            expect(findPath({ x: 5, y: 5 }, { x: 5, y: 5 }, walk10x10)).toEqual([]);
        });

        it('finds a straight horizontal path', () => {
            const path = findPath({ x: 0, y: 0 }, { x: 3, y: 0 }, walk10x10);
            expect(path).not.toBeNull();
            expect(path!.length).toBe(3);
            expect(path![path!.length - 1]).toEqual({ x: 3, y: 0 });
        });

        it('finds a straight vertical path', () => {
            const path = findPath({ x: 0, y: 0 }, { x: 0, y: 4 }, walk10x10);
            expect(path).not.toBeNull();
            expect(path!.length).toBe(4);
            expect(path![path!.length - 1]).toEqual({ x: 0, y: 4 });
        });

        it('finds shortest path (Manhattan distance)', () => {
            const path = findPath({ x: 0, y: 0 }, { x: 2, y: 3 }, walk10x10);
            expect(path).not.toBeNull();
            expect(path!.length).toBe(5);
        });

        it('excludes the start tile from the path', () => {
            const path = findPath({ x: 0, y: 0 }, { x: 2, y: 0 }, walk10x10);
            expect(path).not.toBeNull();
            expect(path!.find(p => p.x === 0 && p.y === 0)).toBeUndefined();
        });

        it('includes the goal tile in the path', () => {
            const path = findPath({ x: 0, y: 0 }, { x: 2, y: 0 }, walk10x10);
            expect(path).not.toBeNull();
            expect(path![path!.length - 1]).toEqual({ x: 2, y: 0 });
        });

        it('returns single-step path for adjacent tiles', () => {
            expect(findPath({ x: 5, y: 5 }, { x: 6, y: 5 }, walk10x10)).toEqual([{ x: 6, y: 5 }]);
        });
    });

    describe('obstacles', () => {
        it('routes around a wall', () => {
            const blocked = new Set(['2,0', '2,1', '2,2']);
            const walk = boundedWalkable(10, 10, blocked);
            const path = findPath({ x: 0, y: 1 }, { x: 4, y: 1 }, walk);
            expect(path).not.toBeNull();
            for (const p of path!) {
                expect(blocked.has(`${p.x},${p.y}`)).toBe(false);
            }
            expect(path![path!.length - 1]).toEqual({ x: 4, y: 1 });
        });

        it('returns null when start is fully enclosed', () => {
            // Start at (1,1), all 4 neighbors blocked, on a 3x3 grid
            const blocked = new Set(['2,1', '0,1', '1,0', '1,2']);
            const walk = boundedWalkable(3, 3, blocked);
            const path = findPath({ x: 1, y: 1 }, { x: 2, y: 2 }, walk);
            expect(path).toBeNull();
        });

        it('returns null when goal is walkable but fully enclosed', () => {
            const blocked = new Set(['4,3', '4,5', '3,4', '5,4']);
            const walk = boundedWalkable(10, 10, blocked);
            const path = findPath({ x: 0, y: 0 }, { x: 4, y: 4 }, walk);
            expect(path).toBeNull();
        });
    });

    describe('blocked goal fallback', () => {
        it('falls back to closest reachable tile when goal is blocked', () => {
            const blocked = new Set(['3,0']);
            const walk = boundedWalkable(10, 10, blocked);
            const path = findPath({ x: 0, y: 0 }, { x: 3, y: 0 }, walk);
            expect(path).not.toBeNull();
            const last = path![path!.length - 1];
            expect(blocked.has(`${last.x},${last.y}`)).toBe(false);
            // Closest reachable tile should be adjacent to the blocked goal
            const dist = Math.abs(last.x - 3) + Math.abs(last.y - 0);
            expect(dist).toBe(1);
        });

        it('does not fall back when goal is walkable but unreachable', () => {
            // Goal is walkable but enclosed — no fallback, returns null
            const blocked = new Set(['4,3', '4,5', '3,4', '5,4']);
            const walk = boundedWalkable(10, 10, blocked);
            const path = findPath({ x: 0, y: 0 }, { x: 4, y: 4 }, walk);
            expect(path).toBeNull();
        });
    });

    describe('boundary navigation', () => {
        it('paths along grid edges', () => {
            const walk = boundedWalkable(5, 5);
            const path = findPath({ x: 0, y: 0 }, { x: 4, y: 0 }, walk);
            expect(path).not.toBeNull();
            expect(path!.length).toBe(4);
        });

        it('paths to a corner', () => {
            const walk = boundedWalkable(5, 5);
            const path = findPath({ x: 0, y: 0 }, { x: 4, y: 4 }, walk);
            expect(path).not.toBeNull();
            expect(path!.length).toBe(8);
            expect(path![path!.length - 1]).toEqual({ x: 4, y: 4 });
        });
    });
});
