import { PLAYER_SPAWN, NPCS, BUILDINGS, MAP_SEED, MAP_COLS, MAP_ROWS } from './GameConfig';

export const TILE_WATER = 1;

export const MAP_WIDTH = MAP_COLS;
export const MAP_HEIGHT = MAP_ROWS;

// Seeded PRNG (mulberry32)
function mulberry32(seed: number) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function generateMap(width: number, height: number, seed: number): number[][] {
    const rng = mulberry32(seed);
    const map: number[][] = [];

    // Fill with grass
    for (let y = 0; y < height; y++) {
        map[y] = [];
        for (let x = 0; x < width; x++) {
            map[y][x] = 0;
        }
    }

    // Place 3-5 water ponds
    const pondCount = 3 + Math.floor(rng() * 3);
    for (let p = 0; p < pondCount; p++) {
        const cx = 4 + Math.floor(rng() * (width - 8));
        const cy = 4 + Math.floor(rng() * (height - 8));
        const radius = 1 + Math.floor(rng() * 3);

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                // Randomize edge for organic shape
                const threshold = radius - 0.5 + rng() * 1.5;
                if (dist <= threshold) {
                    const nx = cx + dx;
                    const ny = cy + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        map[ny][nx] = TILE_WATER;
                    }
                }
            }
        }
    }

    // Guarantee spawn areas are grass
    const spawnPoints = [
        PLAYER_SPAWN,
        ...NPCS.map(n => n.tile),
    ];

    // Also protect building positions from water
    const buildingClearPoints = BUILDINGS.map(b => b.tile);
    for (const bp of buildingClearPoints) {
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                const bx = bp.x + dx;
                const by = bp.y + dy;
                if (bx >= 0 && bx < width && by >= 0 && by < height) {
                    map[by][bx] = 0;
                }
            }
        }
    }

    for (const sp of spawnPoints) {
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                const sx = sp.x + dx;
                const sy = sp.y + dy;
                if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
                    map[sy][sx] = 0;
                }
            }
        }
    }

    return map;
}

export const MAP_DATA: number[][] = generateMap(MAP_WIDTH, MAP_HEIGHT, MAP_SEED);

export function isWithinMapBounds(x: number, y: number): boolean {
    return x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT;
}

export function isGrassTile(x: number, y: number): boolean {
    if (!isWithinMapBounds(x, y)) return false;
    return MAP_DATA[y][x] === 0;
}

export function isSpawnTile(x: number, y: number): boolean {
    if (PLAYER_SPAWN.x === x && PLAYER_SPAWN.y === y) return true;
    return NPCS.some(npc => npc.tile.x === x && npc.tile.y === y);
}
