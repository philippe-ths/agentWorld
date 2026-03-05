import { NPC } from './entities/NPC';
import { ChronologicalLog } from './ChronologicalLog';
import { FunctionRecord } from './GameConfig';
import { ToolRegistry } from './ToolRegistry';
import {
    deleteFunctionRecord,
    executeFunction,
    generateFunctionSpec,
    loadFunctionRecord,
    saveFunctionRecord,
    testFunctionSpec,
} from './ToolService';
import { isGrassTile, isSpawnTile, isWithinMapBounds, isAdjacentToBuilding, isBuildingAt } from './MapData';

export class FunctionBuilderService {
    constructor(private toolRegistry: ToolRegistry) {}

    async handleCreateFunction(
        npc: NPC,
        log: ChronologicalLog,
        description: string,
        x: number,
        y: number,
    ): Promise<void> {
        const forge = this.toolRegistry.getById('code_forge');
        if (!isAdjacentToBuilding(npc.tilePos, forge)) {
            log.recordAction('I tried to use Code Forge but I am not adjacent to it');
            return;
        }

        const placementError = this.validateFunctionPlacement(x, y);
        if (placementError) {
            log.recordAction(`I used Code Forge to create function but it failed: ${placementError}`);
            return;
        }

        try {
            const generated = await generateFunctionSpec(description);
            if (this.toolRegistry.getById(generated.name)) {
                log.recordAction(`I used Code Forge to create function but it failed: Function "${generated.name}" already exists`);
                return;
            }

            const dryRun = await testFunctionSpec(generated);
            if (!dryRun.ok) {
                log.recordAction(`I used Code Forge to create function but it failed: ${dryRun.result}`);
                return;
            }

            const record: FunctionRecord = {
                ...generated,
                tile: { x, y },
                creator: npc.name,
            };

            await saveFunctionRecord(record);
            this.registerFunctionBuilding(record);

            log.recordAction(`I used Code Forge to create function "${record.name}": ${record.description}`);
            log.recordAction(`Function building placed at (${x},${y})`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.recordAction(`I used Code Forge to create function but it failed: ${msg}`);
        }
    }

    async handleUpdateFunction(
        npc: NPC,
        log: ChronologicalLog,
        functionName: string,
        changeDescription: string,
    ): Promise<void> {
        const forge = this.toolRegistry.getById('code_forge');
        if (!isAdjacentToBuilding(npc.tilePos, forge)) {
            log.recordAction('I tried to use Code Forge but I am not adjacent to it');
            return;
        }

        try {
            const existing = await loadFunctionRecord(functionName);
            if (!existing) {
                log.recordAction(`I used Code Forge to update function but it failed: Function "${functionName}" does not exist`);
                return;
            }

            const updated = await generateFunctionSpec(
                existing.description,
                {
                    name: existing.name,
                    code: existing.code,
                    description: existing.description,
                },
                changeDescription,
            );

            const updatedRecord: FunctionRecord = {
                ...updated,
                name: existing.name,
                tile: existing.tile,
                creator: existing.creator,
            };

            const dryRun = await testFunctionSpec(updatedRecord);
            if (!dryRun.ok) {
                log.recordAction(`I used Code Forge to update function but it failed: ${dryRun.result}`);
                return;
            }

            await saveFunctionRecord(updatedRecord);
            this.registerFunctionBuilding(updatedRecord);
            log.recordAction(`I used Code Forge to update function "${updatedRecord.name}": ${changeDescription}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.recordAction(`I used Code Forge to update function but it failed: ${msg}`);
        }
    }

    async handleDeleteFunction(
        npc: NPC,
        log: ChronologicalLog,
        functionName: string,
    ): Promise<void> {
        const forge = this.toolRegistry.getById('code_forge');
        if (!isAdjacentToBuilding(npc.tilePos, forge)) {
            log.recordAction('I tried to use Code Forge but I am not adjacent to it');
            return;
        }

        const existing = this.toolRegistry.getById(functionName);
        if (!existing) {
            log.recordAction(`I used Code Forge to delete function but it failed: Function "${functionName}" does not exist`);
            return;
        }

        try {
            await deleteFunctionRecord(functionName);
            this.toolRegistry.unregister(functionName);
            log.recordAction(`I used Code Forge to delete function "${functionName}"`);
            log.recordAction(`Building removed from (${existing.tile.x},${existing.tile.y})`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.recordAction(`I used Code Forge to delete function but it failed: ${msg}`);
        }
    }

    private validateFunctionPlacement(x: number, y: number): string | null {
        if (!isWithinMapBounds(x, y)) {
            return `Invalid placement (${x},${y}): outside map bounds`;
        }
        if (!isGrassTile(x, y)) {
            return `Invalid placement (${x},${y}): must be a grass tile`;
        }
        if (isBuildingAt(this.toolRegistry.getAll(), x, y)) {
            return `Invalid placement (${x},${y}): tile already has a building`;
        }
        if (isSpawnTile(x, y)) {
            return `Invalid placement (${x},${y}): tile is a spawn point`;
        }

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                if (isBuildingAt(this.toolRegistry.getAll(), x + dx, y + dy)) {
                    return `Invalid placement (${x},${y}): must be at least one tile away from existing buildings`;
                }
            }
        }

        return null;
    }

    registerFunctionBuilding(record: FunctionRecord): void {
        const parameterNames = record.parameters.map(p => p.name);

        this.toolRegistry.registerFunctionBuilding(record, async (rawArgs: string) => {
            const parsedArgs = parseToolArgs(rawArgs);
            const result = await executeFunction(parameterNames, record.code, parsedArgs);
            return result.ok ? result.result : `Error: ${result.result}`;
        });
    }
}

export function parseToolArgs(rawArgs: string): unknown[] {
    if (!rawArgs.trim()) return [];
    return rawArgs.split(',').map(value => parseSingleArg(value.trim()));
}

function parseSingleArg(value: string): unknown {
    if (!value.length) return '';
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }
    return value;
}