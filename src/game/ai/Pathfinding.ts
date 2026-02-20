import { TilePos } from '../entities/Entity';

interface PathNode {
    x: number;
    y: number;
    g: number;
    h: number;
    f: number;
    parent: PathNode | null;
}

function heuristic(a: TilePos, b: TilePos): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

const DIRS = [
    { x: 0, y: -1 }, // up
    { x: 0, y: 1 },  // down
    { x: -1, y: 0 }, // left
    { x: 1, y: 0 },  // right
];

export function findPath(
    start: TilePos,
    goal: TilePos,
    isWalkable: (x: number, y: number) => boolean,
): TilePos[] {
    if (start.x === goal.x && start.y === goal.y) return [];
    if (!isWalkable(goal.x, goal.y)) return [];

    const openSet: PathNode[] = [];
    const closedSet = new Set<string>();

    const key = (x: number, y: number) => `${x},${y}`;

    const startNode: PathNode = {
        x: start.x, y: start.y,
        g: 0, h: heuristic(start, goal), f: heuristic(start, goal),
        parent: null,
    };
    openSet.push(startNode);

    while (openSet.length > 0) {
        // Find node with lowest f
        let bestIdx = 0;
        for (let i = 1; i < openSet.length; i++) {
            if (openSet[i].f < openSet[bestIdx].f) bestIdx = i;
        }
        const current = openSet[bestIdx];

        if (current.x === goal.x && current.y === goal.y) {
            // Reconstruct path (exclude start)
            const path: TilePos[] = [];
            let node: PathNode | null = current;
            while (node && !(node.x === start.x && node.y === start.y)) {
                path.push({ x: node.x, y: node.y });
                node = node.parent;
            }
            return path.reverse();
        }

        openSet.splice(bestIdx, 1);
        closedSet.add(key(current.x, current.y));

        for (const dir of DIRS) {
            const nx = current.x + dir.x;
            const ny = current.y + dir.y;

            if (closedSet.has(key(nx, ny))) continue;
            if (!isWalkable(nx, ny)) continue;

            const g = current.g + 1;
            const h = heuristic({ x: nx, y: ny }, goal);
            const f = g + h;

            const existing = openSet.find(n => n.x === nx && n.y === ny);
            if (existing) {
                if (g < existing.g) {
                    existing.g = g;
                    existing.f = f;
                    existing.parent = current;
                }
            } else {
                openSet.push({ x: nx, y: ny, g, h, f, parent: current });
            }
        }
    }

    return []; // No path found
}
