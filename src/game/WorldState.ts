import { Entity } from './entities/Entity';
import { MAP_WIDTH, MAP_HEIGHT, MAP_DATA } from './MapData';

const TILE_CHARS: Record<number, string> = {
    0: '.',  // grass
    1: '~',  // water
};

export function buildWorldState(observer: Entity, allEntities: Entity[]): string {
    const lines: string[] = [];

    lines.push(`MAP: ${MAP_WIDTH}x${MAP_HEIGHT}`);
    lines.push(`YOU: ${observer.name} at (${observer.tilePos.x},${observer.tilePos.y})`);

    // Other entities
    const others = allEntities.filter(e => e !== observer);
    if (others.length > 0) {
        for (const e of others) {
            lines.push(`  ${e.name} at (${e.tilePos.x},${e.tilePos.y})`);
        }
    }

    // Compact grid — one char per tile, no spaces
    const entityAt = new Map<string, string>();
    entityAt.set(`${observer.tilePos.x},${observer.tilePos.y}`, '@');
    for (const e of others) {
        entityAt.set(`${e.tilePos.x},${e.tilePos.y}`, e.name[0]);
    }

    lines.push('');
    for (let y = 0; y < MAP_HEIGHT; y++) {
        let row = '';
        for (let x = 0; x < MAP_WIDTH; x++) {
            const key = `${x},${y}`;
            row += entityAt.get(key) ?? TILE_CHARS[MAP_DATA[y][x]] ?? '?';
        }
        lines.push(row);
    }
    lines.push('. = grass, ~ = water, @ = you, A/B/C = NPCs');

    lines.push('');
    lines.push('ACTIONS: move_to(x,y) | wait()');

    return lines.join('\n');
}
