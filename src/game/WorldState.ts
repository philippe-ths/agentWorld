import { Entity } from './entities/Entity';
import { MAP_WIDTH, MAP_HEIGHT, MAP_DATA, TILE_WATER } from './MapData';

export function buildWorldState(observer: Entity, allEntities: Entity[]): string {
    const lines: string[] = [];

    // Header
    lines.push(`MAP: ${MAP_WIDTH}x${MAP_HEIGHT} (bounds 0,0 to ${MAP_WIDTH - 1},${MAP_HEIGHT - 1})`);
    lines.push(`YOU: ${observer.name} at (${observer.tilePos.x},${observer.tilePos.y})`);

    // Other entities with distance
    const others = allEntities.filter(e => e !== observer);
    if (others.length > 0) {
        lines.push('');
        lines.push('ENTITIES:');
        for (const e of others) {
            const dist = Math.abs(e.tilePos.x - observer.tilePos.x) + Math.abs(e.tilePos.y - observer.tilePos.y);
            lines.push(`  ${e.name} (${e.tilePos.x},${e.tilePos.y}) dist:${dist}`);
        }
    }

    // Water tiles — sparse list, only non-grass
    const waterCoords: string[] = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            if (MAP_DATA[y][x] === TILE_WATER) {
                waterCoords.push(`(${x},${y})`);
            }
        }
    }
    lines.push('');
    lines.push(`WATER[${waterCoords.length}]: ${waterCoords.join(' ')}`);

    // Actions
    lines.push('');
    lines.push('ACTIONS:');
    lines.push('  move_to(x,y) — step toward tile');
    lines.push('  wait() — skip action');

    return lines.join('\n');
}
