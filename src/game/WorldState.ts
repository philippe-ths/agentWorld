import { Entity } from './entities/Entity';
import { MAP_WIDTH, MAP_HEIGHT, MAP_DATA } from './MapData';

const VIEW_RADIUS = 3; // 7×7 local grid (3 in each direction)

const TILE_CHARS: Record<number, string> = {
    0: '.',  // grass
    1: 'W',  // water
};

export function buildWorldState(observer: Entity, allEntities: Entity[]): string {
    const lines: string[] = [];

    // Header
    lines.push(`MAP: ${MAP_WIDTH}x${MAP_HEIGHT}`);
    lines.push(`YOU: ${observer.name} at (${observer.tilePos.x},${observer.tilePos.y})`);

    // Other entities
    const others = allEntities.filter(e => e !== observer);
    if (others.length > 0) {
        lines.push('');
        lines.push('ENTITIES:');
        for (const e of others) {
            const dx = e.tilePos.x - observer.tilePos.x;
            const dy = e.tilePos.y - observer.tilePos.y;
            lines.push(`  ${e.name} at (${e.tilePos.x},${e.tilePos.y}) [offset ${dx >= 0 ? '+' : ''}${dx},${dy >= 0 ? '+' : ''}${dy}]`);
        }
    }

    // Local tile grid
    lines.push('');
    lines.push(`NEARBY (${VIEW_RADIUS * 2 + 1}x${VIEW_RADIUS * 2 + 1} around you, @ = you):`);

    // Build entity lookup for the local area
    const entityAt = new Map<string, string>();
    for (const e of allEntities) {
        if (e === observer) continue;
        entityAt.set(`${e.tilePos.x},${e.tilePos.y}`, e.name[0]);
    }

    for (let dy = -VIEW_RADIUS; dy <= VIEW_RADIUS; dy++) {
        const row: string[] = [];
        for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
            const x = observer.tilePos.x + dx;
            const y = observer.tilePos.y + dy;

            if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) {
                row.push('#'); // out of bounds
            } else if (dx === 0 && dy === 0) {
                row.push('@'); // observer
            } else if (entityAt.has(`${x},${y}`)) {
                row.push(entityAt.get(`${x},${y}`)!);
            } else {
                row.push(TILE_CHARS[MAP_DATA[y][x]] ?? '?');
            }
        }
        lines.push('  ' + row.join(' '));
    }

    // Legend
    lines.push('');
    lines.push('LEGEND: . = grass, W = water, # = edge, @ = you');
    if (entityAt.size > 0) {
        const legend = others.map(e => `${e.name[0]} = ${e.name}`).join(', ');
        lines.push(`  ${legend}`);
    }

    // Actions
    lines.push('');
    lines.push('ACTIONS (per turn):');
    lines.push('  move_to(x, y) — walk one step toward tile (x,y)');
    lines.push('  wait() — do nothing this action');

    return lines.join('\n');
}
