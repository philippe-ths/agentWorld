import { TilePos } from './entities/Entity';

/**
 * A* pathfinding on a 4-directional grid.
 * Returns the path from `start` (exclusive) to `goal` (inclusive),
 * or null if no path exists.
 */
export function findPath(
    start: TilePos,
    goal: TilePos,
    isWalkable: (x: number, y: number) => boolean,
): TilePos[] | null {
    if (start.x === goal.x && start.y === goal.y) return [];

    const goalBlocked = !isWalkable(goal.x, goal.y);

    const key = (x: number, y: number) => `${x},${y}`;
    const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    const gScore = new Map<string, number>();
    const cameFrom = new Map<string, string>();
    const startKey = key(start.x, start.y);
    gScore.set(startKey, 0);

    // Min-heap entries: [f, g, x, y]
    const open: [number, number, number, number][] = [];
    const h = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
    open.push([h(start.x, start.y), 0, start.x, start.y]);

    const closed = new Set<string>();

    // Track the closest reachable tile to the goal (for fallback when goal is blocked)
    let bestKey = startKey;
    let bestH = h(start.x, start.y);
    let bestG = 0;

    while (open.length > 0) {
        // Find the entry with the lowest f score
        let bestIdx = 0;
        for (let i = 1; i < open.length; i++) {
            if (open[i][0] < open[bestIdx][0]) bestIdx = i;
        }
        const [, g, cx, cy] = open[bestIdx];
        open[bestIdx] = open[open.length - 1];
        open.pop();

        const ck = key(cx, cy);
        if (closed.has(ck)) continue;
        closed.add(ck);

        // Update closest reachable tile (prefer closer to goal, break ties by fewer steps)
        const ch = h(cx, cy);
        if (ch < bestH || (ch === bestH && g < bestG)) {
            bestKey = ck;
            bestH = ch;
            bestG = g;
        }

        if (cx === goal.x && cy === goal.y) {
            // Reconstruct path
            const path: TilePos[] = [];
            let cur = ck;
            while (cur !== startKey) {
                const [px, py] = cur.split(',').map(Number);
                path.push({ x: px, y: py });
                cur = cameFrom.get(cur)!;
            }
            path.reverse();
            return path;
        }

        for (const [dx, dy] of DIRS) {
            const nx = cx + dx;
            const ny = cy + dy;
            const nk = key(nx, ny);
            if (closed.has(nk)) continue;
            if (!isWalkable(nx, ny) && !(nx === start.x && ny === start.y)) continue;

            const ng = g + 1;
            const prev = gScore.get(nk);
            if (prev !== undefined && ng >= prev) continue;

            gScore.set(nk, ng);
            cameFrom.set(nk, ck);
            open.push([ng + h(nx, ny), ng, nx, ny]);
        }
    }

    // Goal unreachable — if goal was blocked, fall back to closest reachable tile
    if (goalBlocked && bestKey !== startKey) {
        const path: TilePos[] = [];
        let cur = bestKey;
        while (cur !== startKey) {
            const [px, py] = cur.split(',').map(Number);
            path.push({ x: px, y: py });
            cur = cameFrom.get(cur)!;
        }
        path.reverse();
        return path;
    }

    return null;
}
