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
}
