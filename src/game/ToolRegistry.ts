import { TilePos } from './entities/Entity';
import { ToolBuilding } from './ToolBuilding';
import { BuildingDef, FunctionRecord } from './GameConfig';

export class ToolRegistry {
    private buildings = new Map<string, ToolBuilding>();
    private handlers = new Map<string, (args: string) => Promise<string>>();

    registerHandler(key: string, fn: (args: string) => Promise<string>): void {
        this.handlers.set(key, fn);
    }

    registerFromConfig(def: BuildingDef): void {
        const handler = this.handlers.get(def.handler);
        if (!handler) {
            throw new Error(`No handler registered for "${def.handler}" (building: ${def.id})`);
        }
        this.register({
            id: def.id,
            displayName: def.displayName,
            tile: def.tile,
            symbol: def.symbol,
            description: def.description,
            instructions: def.instructions,
            execute: handler,
        });
    }

    register(building: ToolBuilding): void {
        this.buildings.set(building.id, building);
    }

    unregister(id: string): boolean {
        return this.buildings.delete(id);
    }

    registerFunctionBuilding(
        record: FunctionRecord,
        execute: (args: string) => Promise<string>,
    ): void {
        const parameterSummary = record.parameters
            .map(p => `${p.name}: ${p.type}`)
            .join(', ');

        this.register({
            id: record.name,
            displayName: record.name,
            tile: record.tile,
            symbol: 'F',
            description: record.description,
            instructions: `Parameters: ${parameterSummary || 'none'} | Returns: ${record.returnDescription} | Use: use_tool(${record.name}, "arg1, arg2, ..."). Ends your turn immediately.`,
            execute,
        });
    }

    getAll(): ToolBuilding[] {
        return [...this.buildings.values()];
    }

    getById(id: string): ToolBuilding | undefined {
        return this.buildings.get(id);
    }

    getBuildingAt(x: number, y: number): ToolBuilding | undefined {
        for (const b of this.buildings.values()) {
            if (b.tile.x === x && b.tile.y === y) return b;
        }
        return undefined;
    }

    isBuildingAt(x: number, y: number): boolean {
        return this.getBuildingAt(x, y) !== undefined;
    }

    isAdjacentTo(pos: TilePos, toolId: string): boolean {
        const building = this.buildings.get(toolId);
        if (!building) return false;
        const dx = Math.abs(pos.x - building.tile.x);
        const dy = Math.abs(pos.y - building.tile.y);
        return (dx + dy) === 1;
    }

    getAdjacentBuildings(pos: TilePos): ToolBuilding[] {
        return this.getAll().filter(b => {
            const dx = Math.abs(pos.x - b.tile.x);
            const dy = Math.abs(pos.y - b.tile.y);
            return (dx + dy) === 1;
        });
    }
}
