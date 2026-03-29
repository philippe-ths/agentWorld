import { describe, expect, it } from 'vitest';
import { buildWorldState, type WorldEntity } from './WorldState';
import { MAP_WIDTH, MAP_HEIGHT } from './MapData';
import { ToolRegistry } from './ToolRegistry';

function entity(name: string, x: number, y: number): WorldEntity {
    return { name, tilePos: { x, y } };
}

describe('WorldState', () => {
    const ada = entity('Ada', 5, 5);
    const bjorn = entity('Bjorn', 7, 5);
    const cora = entity('Cora', 5, 8);

    describe('header', () => {
        it('includes map dimensions', () => {
            const output = buildWorldState(ada, [ada]);
            expect(output).toContain(`MAP: ${MAP_WIDTH}x${MAP_HEIGHT}`);
        });

        it('includes observer name and position', () => {
            const output = buildWorldState(ada, [ada]);
            expect(output).toContain('YOU: Ada at (5,5)');
        });
    });

    describe('other entities', () => {
        it('lists other entities with positions', () => {
            const output = buildWorldState(ada, [ada, bjorn, cora]);
            expect(output).toContain('Bjorn at (7,5)');
            expect(output).toContain('Cora at (5,8)');
        });

        it('does not list the observer as another entity', () => {
            const output = buildWorldState(ada, [ada, bjorn]);
            expect(output).not.toContain('  Ada at');
        });
    });

    describe('grid rendering', () => {
        it('renders observer as @', () => {
            const output = buildWorldState(ada, [ada]);
            const lines = output.split('\n');
            // Find the grid row at y=5
            // Grid starts after header lines + empty line
            const gridStart = lines.findIndex(l => l === '') + 1;
            const row = lines[gridStart + 5];
            expect(row[5]).toBe('@');
        });

        it('renders other entities by first letter', () => {
            const output = buildWorldState(ada, [ada, bjorn]);
            const lines = output.split('\n');
            const gridStart = lines.findIndex(l => l === '') + 1;
            const row = lines[gridStart + 5];
            expect(row[7]).toBe('B');
        });

        it('renders correct number of grid rows', () => {
            const output = buildWorldState(ada, [ada]);
            const lines = output.split('\n');
            const gridStart = lines.findIndex(l => l === '') + 1;
            // Grid should have MAP_HEIGHT rows, followed by legend
            let gridRows = 0;
            for (let i = gridStart; i < lines.length; i++) {
                if (lines[i].length === MAP_WIDTH) gridRows++;
                else break;
            }
            expect(gridRows).toBe(MAP_HEIGHT);
        });
    });

    describe('legend', () => {
        it('includes terrain and entity legend entries', () => {
            const output = buildWorldState(ada, [ada]);
            expect(output).toContain('. = grass (walkable)');
            expect(output).toContain('~ = water (blocked)');
            expect(output).toContain('@ = you');
        });
    });

    describe('buildings', () => {
        it('includes buildings section when registry is provided', () => {
            const registry = new ToolRegistry();
            registry.register({
                id: 'test_building',
                displayName: 'Test Lab',
                tile: { x: 3, y: 3 },
                symbol: 'T',
                description: 'A test building.',
                instructions: 'Use: test',
                execute: async () => '',
            });
            const output = buildWorldState(ada, [ada], registry);
            expect(output).toContain('BUILDINGS:');
            expect(output).toContain('[T] Test Lab at (3,3)');
        });

        it('includes building symbol in legend', () => {
            const registry = new ToolRegistry();
            registry.register({
                id: 'lab',
                displayName: 'Lab',
                tile: { x: 3, y: 3 },
                symbol: 'L',
                description: 'A lab.',
                instructions: 'Use: lab',
                execute: async () => '',
            });
            const output = buildWorldState(ada, [ada], registry);
            expect(output).toContain('L = Lab (blocked)');
        });
    });

    describe('nearby tools', () => {
        it('shows nearby tools when observer is adjacent to a building', () => {
            const registry = new ToolRegistry();
            registry.register({
                id: 'forge',
                displayName: 'Code Forge',
                tile: { x: 6, y: 5 },
                symbol: 'C',
                description: 'A forge.',
                instructions: 'Use: forge_command',
                execute: async () => '',
            });
            // Ada at (5,5) is cardinally adjacent to building at (6,5)
            const output = buildWorldState(ada, [ada], registry);
            expect(output).toContain('NEARBY TOOLS:');
            expect(output).toContain('Code Forge: Use: forge_command');
        });

        it('does not show nearby tools when observer is not adjacent', () => {
            const registry = new ToolRegistry();
            registry.register({
                id: 'far',
                displayName: 'Far Building',
                tile: { x: 20, y: 20 },
                symbol: 'F',
                description: 'Far away.',
                instructions: 'Use: far',
                execute: async () => '',
            });
            const output = buildWorldState(ada, [ada], registry);
            expect(output).not.toContain('NEARBY TOOLS:');
        });
    });

    describe('output stability', () => {
        it('produces identical output for identical inputs', () => {
            const entities = [ada, bjorn, cora];
            const a = buildWorldState(ada, entities);
            const b = buildWorldState(ada, entities);
            expect(a).toBe(b);
        });
    });
});
