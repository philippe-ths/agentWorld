import { Entity } from './entities/Entity';
import { MAP_WIDTH, MAP_HEIGHT, MAP_DATA, getAdjacentBuildings } from './MapData';
import { ToolRegistry } from './ToolRegistry';

const TILE_CHARS: Record<number, string> = {
    0: '.',  // grass
    1: '~',  // water
};

export function buildWorldState(observer: Entity, allEntities: Entity[], toolRegistry?: ToolRegistry): string {
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

    // Buildings (always visible)
    const buildings = toolRegistry?.getAll() ?? [];
    if (buildings.length > 0) {
        lines.push('BUILDINGS:');
        for (const b of buildings) {
            lines.push(`  [${b.symbol}] ${b.displayName} at (${b.tile.x},${b.tile.y}) — ${b.description}`);
        }
    }

    // Compact grid — one char per tile, no spaces
    const entityAt = new Map<string, string>();
    entityAt.set(`${observer.tilePos.x},${observer.tilePos.y}`, '@');
    for (const e of others) {
        entityAt.set(`${e.tilePos.x},${e.tilePos.y}`, e.name[0]);
    }
    for (const b of buildings) {
        const bk = `${b.tile.x},${b.tile.y}`;
        if (!entityAt.has(bk)) entityAt.set(bk, b.symbol);
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
    const legendParts = ['. = grass (walkable)', '~ = water (blocked)', '@ = you', 'P = player (blocked)', 'A/B/C = NPCs (blocked)'];
    for (const b of buildings) {
        legendParts.push(`${b.symbol} = ${b.displayName} (blocked)`);
    }
    lines.push(legendParts.join(', '));

    // Nearby tools (adjacency-gated instructions)
    if (toolRegistry) {
        const nearby = getAdjacentBuildings(observer.tilePos, buildings);
        if (nearby.length > 0) {
            lines.push('');
            lines.push('NEARBY TOOLS:');
            for (const b of nearby) {
                lines.push(`  ${b.displayName}: ${b.instructions}`);
            }
        }
    }

    return lines.join('\n');
}
