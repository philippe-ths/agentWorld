import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ToolRegistry } from './ToolRegistry';
import { FEATURES } from './GameConfig';
import type { ToolBuilding } from './ToolBuilding';

function makeBuilding(id: string, symbol = 'T'): ToolBuilding {
    return {
        id,
        displayName: id,
        tile: { x: 0, y: 0 },
        symbol,
        description: '',
        instructions: '',
        execute: async () => '',
    };
}

describe('ToolRegistry', () => {
    let registry: ToolRegistry;
    let savedFeatures: typeof FEATURES;

    beforeEach(() => {
        registry = new ToolRegistry();
        savedFeatures = { ...FEATURES };
    });

    afterEach(() => {
        Object.assign(FEATURES, savedFeatures);
    });

    describe('register and retrieve', () => {
        it('registers and retrieves a building by id', () => {
            const building = makeBuilding('lab');
            registry.register(building);
            expect(registry.getById('lab')).toBe(building);
        });

        it('returns undefined for unregistered id', () => {
            expect(registry.getById('nonexistent')).toBeUndefined();
        });

        it('getAll returns all registered buildings', () => {
            registry.register(makeBuilding('a'));
            registry.register(makeBuilding('b'));
            expect(registry.getAll().length).toBe(2);
        });

        it('unregister removes a building', () => {
            registry.register(makeBuilding('lab'));
            expect(registry.unregister('lab')).toBe(true);
            expect(registry.getById('lab')).toBeUndefined();
        });

        it('unregister returns false for unknown id', () => {
            expect(registry.unregister('missing')).toBe(false);
        });
    });

    describe('registerFromConfig', () => {
        it('throws when handler is not registered', () => {
            expect(() => registry.registerFromConfig({
                id: 'test',
                displayName: 'Test',
                tile: { x: 0, y: 0 },
                symbol: 'T',
                description: '',
                instructions: '',
                handler: 'missing_handler',
            })).toThrow('No handler registered for "missing_handler"');
        });

        it('registers building when handler exists', () => {
            registry.registerHandler('search', async () => 'result');
            registry.registerFromConfig({
                id: 'search_terminal',
                displayName: 'Search Terminal',
                tile: { x: 10, y: 10 },
                symbol: 'S',
                description: 'Search',
                instructions: 'Use: search',
                handler: 'search',
            });
            expect(registry.getById('search_terminal')).toBeDefined();
        });
    });

    describe('registerFunctionBuilding', () => {
        it('registers a function record as a building with symbol F', () => {
            registry.registerFunctionBuilding(
                {
                    name: 'add',
                    description: 'Adds two numbers',
                    parameters: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }],
                    returnDescription: 'sum',
                    code: 'return a + b;',
                    tile: { x: 5, y: 5 },
                    creator: 'Ada',
                },
                async () => '3',
            );
            const building = registry.getById('add');
            expect(building).toBeDefined();
            expect(building!.symbol).toBe('F');
            expect(building!.instructions).toContain('a: number, b: number');
        });
    });

    describe('getVisible with feature flags', () => {
        it('returns all buildings when both flags are enabled', () => {
            FEATURES.functionBuilding = true;
            FEATURES.searchTerminal = true;
            registry.register(makeBuilding('search_terminal', 'S'));
            registry.register(makeBuilding('code_forge', 'C'));
            registry.register(makeBuilding('my_func', 'F'));
            expect(registry.getVisible().length).toBe(3);
        });

        it('hides function buildings and code forge when functionBuilding is disabled', () => {
            FEATURES.functionBuilding = false;
            FEATURES.searchTerminal = true;
            registry.register(makeBuilding('search_terminal', 'S'));
            registry.register(makeBuilding('code_forge', 'C'));
            registry.register(makeBuilding('my_func', 'F'));
            const visible = registry.getVisible();
            const ids = visible.map(b => b.id);
            expect(ids).toEqual(['search_terminal']);
        });

        it('hides search terminal when searchTerminal is disabled', () => {
            FEATURES.functionBuilding = true;
            FEATURES.searchTerminal = false;
            registry.register(makeBuilding('search_terminal', 'S'));
            registry.register(makeBuilding('code_forge', 'C'));
            const visible = registry.getVisible();
            const ids = visible.map(b => b.id);
            expect(ids).toEqual(['code_forge']);
        });

        it('hides all flagged buildings when both flags are disabled', () => {
            FEATURES.functionBuilding = false;
            FEATURES.searchTerminal = false;
            registry.register(makeBuilding('search_terminal', 'S'));
            registry.register(makeBuilding('code_forge', 'C'));
            registry.register(makeBuilding('my_func', 'F'));
            registry.register(makeBuilding('plain', 'P'));
            const visible = registry.getVisible();
            const ids = visible.map(b => b.id);
            expect(ids).toEqual(['plain']);
        });
    });
});
