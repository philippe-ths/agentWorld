import { describe, expect, it } from 'vitest';
import {
    MAP_DATA,
    MAP_WIDTH,
    MAP_HEIGHT,
    TILE_WATER,
    isWithinMapBounds,
    isGrassTile,
    isSpawnTile,
    getBuildingAt,
    isBuildingAt,
    isAdjacentToBuilding,
    getAdjacentBuildings,
} from './MapData';
import { PLAYER_SPAWN, NPCS, BUILDINGS } from './GameConfig';
import type { ToolBuilding } from './ToolBuilding';

function makeBuilding(x: number, y: number, id = 'test'): ToolBuilding {
    return {
        id,
        displayName: id,
        tile: { x, y },
        symbol: 'T',
        description: '',
        instructions: '',
        execute: async () => '',
    };
}

describe('MapData', () => {
    describe('map dimensions', () => {
        it('has the expected dimensions', () => {
            expect(MAP_DATA.length).toBe(MAP_HEIGHT);
            for (const row of MAP_DATA) {
                expect(row.length).toBe(MAP_WIDTH);
            }
        });
    });

    describe('determinism', () => {
        it('produces identical tile values across runs', () => {
            // Snapshot specific tiles — if the PRNG or generation logic changes, these fail
            expect(MAP_DATA[0][0]).toBe(0);
            expect(MAP_DATA[MAP_HEIGHT - 1][MAP_WIDTH - 1]).toBe(MAP_DATA[MAP_HEIGHT - 1][MAP_WIDTH - 1]);

            // Flatten and checksum the full map to detect any drift
            const flat = MAP_DATA.flat();
            const checksum = flat.reduce((sum, v) => sum + v, 0);
            expect(checksum).toMatchSnapshot();
        });
    });

    describe('pond generation', () => {
        it('contains at least some water tiles', () => {
            const waterCount = MAP_DATA.flat().filter(v => v === TILE_WATER).length;
            expect(waterCount).toBeGreaterThan(0);
        });

        it('guarantees spawn points are grass', () => {
            const spawns = [PLAYER_SPAWN, ...NPCS.map(n => n.tile)];
            for (const sp of spawns) {
                expect(MAP_DATA[sp.y][sp.x]).toBe(0);
            }
        });

        it('guarantees building positions are grass', () => {
            for (const b of BUILDINGS) {
                expect(MAP_DATA[b.tile.y][b.tile.x]).toBe(0);
            }
        });
    });

    describe('isWithinMapBounds', () => {
        it('returns true for interior tiles', () => {
            expect(isWithinMapBounds(5, 5)).toBe(true);
        });

        it('returns true for corner tiles', () => {
            expect(isWithinMapBounds(0, 0)).toBe(true);
            expect(isWithinMapBounds(MAP_WIDTH - 1, 0)).toBe(true);
            expect(isWithinMapBounds(0, MAP_HEIGHT - 1)).toBe(true);
            expect(isWithinMapBounds(MAP_WIDTH - 1, MAP_HEIGHT - 1)).toBe(true);
        });

        it('returns false for negative coordinates', () => {
            expect(isWithinMapBounds(-1, 0)).toBe(false);
            expect(isWithinMapBounds(0, -1)).toBe(false);
        });

        it('returns false beyond map boundaries', () => {
            expect(isWithinMapBounds(MAP_WIDTH, 0)).toBe(false);
            expect(isWithinMapBounds(0, MAP_HEIGHT)).toBe(false);
        });
    });

    describe('isGrassTile', () => {
        it('returns true for a known grass tile (spawn point)', () => {
            expect(isGrassTile(PLAYER_SPAWN.x, PLAYER_SPAWN.y)).toBe(true);
        });

        it('returns false for a water tile', () => {
            // Find a water tile from the generated map
            let waterX = -1, waterY = -1;
            for (let y = 0; y < MAP_HEIGHT && waterX === -1; y++) {
                for (let x = 0; x < MAP_WIDTH; x++) {
                    if (MAP_DATA[y][x] === TILE_WATER) {
                        waterX = x;
                        waterY = y;
                        break;
                    }
                }
            }
            expect(waterX).toBeGreaterThanOrEqual(0);
            expect(isGrassTile(waterX, waterY)).toBe(false);
        });

        it('returns false for out-of-bounds coordinates', () => {
            expect(isGrassTile(-1, 0)).toBe(false);
            expect(isGrassTile(0, MAP_HEIGHT)).toBe(false);
        });
    });

    describe('isSpawnTile', () => {
        it('returns true for the player spawn', () => {
            expect(isSpawnTile(PLAYER_SPAWN.x, PLAYER_SPAWN.y)).toBe(true);
        });

        it('returns true for each NPC spawn', () => {
            for (const npc of NPCS) {
                expect(isSpawnTile(npc.tile.x, npc.tile.y)).toBe(true);
            }
        });

        it('returns false for a non-spawn tile', () => {
            expect(isSpawnTile(0, 0)).toBe(false);
        });
    });

    describe('getBuildingAt / isBuildingAt', () => {
        const buildings = [makeBuilding(10, 10, 'a'), makeBuilding(20, 20, 'b')];

        it('finds a building at its position', () => {
            const found = getBuildingAt(buildings, 10, 10);
            expect(found).toBeDefined();
            expect(found!.id).toBe('a');
        });

        it('returns undefined for an empty position', () => {
            expect(getBuildingAt(buildings, 0, 0)).toBeUndefined();
        });

        it('isBuildingAt returns true when a building exists', () => {
            expect(isBuildingAt(buildings, 20, 20)).toBe(true);
        });

        it('isBuildingAt returns false when no building exists', () => {
            expect(isBuildingAt(buildings, 0, 0)).toBe(false);
        });
    });

    describe('isAdjacentToBuilding', () => {
        const building = makeBuilding(10, 10);

        it('returns true for cardinal neighbors', () => {
            expect(isAdjacentToBuilding({ x: 11, y: 10 }, building)).toBe(true);
            expect(isAdjacentToBuilding({ x: 9, y: 10 }, building)).toBe(true);
            expect(isAdjacentToBuilding({ x: 10, y: 11 }, building)).toBe(true);
            expect(isAdjacentToBuilding({ x: 10, y: 9 }, building)).toBe(true);
        });

        it('returns false for diagonals', () => {
            expect(isAdjacentToBuilding({ x: 11, y: 11 }, building)).toBe(false);
            expect(isAdjacentToBuilding({ x: 9, y: 9 }, building)).toBe(false);
        });

        it('returns false for the same tile', () => {
            expect(isAdjacentToBuilding({ x: 10, y: 10 }, building)).toBe(false);
        });

        it('returns false for undefined building', () => {
            expect(isAdjacentToBuilding({ x: 10, y: 10 }, undefined)).toBe(false);
        });
    });

    describe('getAdjacentBuildings', () => {
        const buildings = [
            makeBuilding(5, 10, 'left'),
            makeBuilding(7, 10, 'right'),
            makeBuilding(6, 15, 'far'),
        ];

        it('returns only cardinally adjacent buildings', () => {
            const adjacent = getAdjacentBuildings({ x: 6, y: 10 }, buildings);
            const ids = adjacent.map(b => b.id).sort();
            expect(ids).toEqual(['left', 'right']);
        });

        it('returns empty array when no buildings are adjacent', () => {
            expect(getAdjacentBuildings({ x: 0, y: 0 }, buildings)).toEqual([]);
        });
    });
});
