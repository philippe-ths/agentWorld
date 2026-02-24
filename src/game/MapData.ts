export const TILE_WATER = 1;

export const MAP_WIDTH = 64;
export const MAP_HEIGHT = 64;

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

function generateMap(width: number, height: number, seed = 42): number[][] {
    const rng = mulberry32(seed);
    const map: number[][] = [];

    // Fill with grass
    for (let y = 0; y < height; y++) {
        map[y] = [];
        for (let x = 0; x < width; x++) {
            map[y][x] = 0;
        }
    }

    // Place 10-15 water ponds
    const pondCount = 10 + Math.floor(rng() * 6);
    for (let p = 0; p < pondCount; p++) {
        const cx = 4 + Math.floor(rng() * (width - 8));
        const cy = 4 + Math.floor(rng() * (height - 8));
        const radius = 2 + Math.floor(rng() * 4);

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
        { x: 5, y: 5 },   // Player
        { x: 15, y: 10 }, // Ada
        { x: 25, y: 20 }, // Bjorn
        { x: 10, y: 25 }, // Cora
    ];
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

export const MAP_DATA: number[][] = generateMap(MAP_WIDTH, MAP_HEIGHT);
