import { NPC } from './entities/NPC';
import { ChronologicalLog } from './ChronologicalLog';
import { FunctionRecord, GeneratedFunctionSpec } from './GameConfig';
import { findUnsupportedFunctionReason, findUnsupportedRequestReason } from './FunctionCapability';
import { ToolRegistry } from './ToolRegistry';
import {
    deleteFunctionRecord,
    executeFunction,
    generateFunctionSpec,
    loadFunctionRecord,
    saveFunctionRecord,
    testFunctionSpec,
} from './ToolService';
import { isRejectedFunctionSpec } from './validation';
import { isGrassTile, isSpawnTile, isWithinMapBounds, isAdjacentToBuilding, isBuildingAt } from './MapData';
import { ActionExecutionResult } from './DirectiveExecutor';

export class FunctionBuilderService {
    constructor(private toolRegistry: ToolRegistry) {}

    async handleCreateFunction(
        npc: NPC,
        log: ChronologicalLog,
        description: string,
        x: number,
        y: number,
        turnNumber: number,
    ): Promise<ActionExecutionResult> {
        const forge = this.toolRegistry.getById('code_forge');
        if (!isAdjacentToBuilding(npc.tilePos, forge)) {
            log.recordAction('→ failed: not adjacent to Code Forge');
            return this.forgeFailure(turnNumber, 'Not adjacent to Code Forge', 'not_adjacent_forge');
        }

        const placementError = this.validateFunctionPlacement(x, y);
        if (placementError) {
            log.recordAction(`→ failed: ${placementError}`);
            return this.forgeFailure(turnNumber, placementError, 'create_function_placement');
        }

        const requestRejection = findUnsupportedRequestReason(description);
        if (requestRejection) {
            log.recordAction(`→ Code Forge rejected request: ${requestRejection}`);
            return this.forgeFailure(turnNumber, requestRejection, 'create_function_rejected');
        }

        try {
            const generated = await generateFunctionSpec(description);
            if (isRejectedFunctionSpec(generated)) {
                log.recordAction(`→ Code Forge rejected request: ${generated.reason}`);
                return this.forgeFailure(turnNumber, generated.reason, 'create_function_rejected');
            }

            const unsupportedResult = this.findUnsupportedGeneratedSpecReason(generated);
            if (unsupportedResult) {
                log.recordAction(`→ Code Forge rejected request: ${unsupportedResult}`);
                return this.forgeFailure(turnNumber, unsupportedResult, 'create_function_rejected');
            }

            if (this.toolRegistry.getById(generated.name)) {
                const msg = `Function "${generated.name}" already exists`;
                log.recordAction(`→ failed: ${msg}`);
                return this.forgeFailure(turnNumber, msg, 'create_function_duplicate');
            }

            const dryRun = await testFunctionSpec(generated);
            if (!dryRun.ok) {
                log.recordAction(`→ failed: ${dryRun.result}`);
                return this.forgeFailure(turnNumber, dryRun.result, 'create_function_test');
            }

            const record: FunctionRecord = {
                ...generated,
                tile: { x, y },
                creator: npc.name,
            };

            await saveFunctionRecord(record);
            this.registerFunctionBuilding(record);

            log.recordAction(`→ created function "${record.name}": ${record.description}`);
            log.recordAction(`→ building placed at (${x},${y})`);
            return {
                shouldStop: true,
                reflectionEvent: {
                    turnNumber,
                    kind: 'success',
                    summary: `Created function "${record.name}" at Code Forge`,
                    successPattern: 'Creating functions at Code Forge with valid placement and description',
                },
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.recordAction(`→ failed: ${msg}`);
            return this.forgeFailure(turnNumber, msg, 'create_function_error');
        }
    }

    async handleUpdateFunction(
        npc: NPC,
        log: ChronologicalLog,
        functionName: string,
        changeDescription: string,
        turnNumber: number,
    ): Promise<ActionExecutionResult> {
        const forge = this.toolRegistry.getById('code_forge');
        if (!isAdjacentToBuilding(npc.tilePos, forge)) {
            log.recordAction('→ failed: not adjacent to Code Forge');
            return this.forgeFailure(turnNumber, 'Not adjacent to Code Forge', 'not_adjacent_forge');
        }

        const requestRejection = findUnsupportedRequestReason(changeDescription);
        if (requestRejection) {
            log.recordAction(`→ Code Forge rejected update: ${requestRejection}`);
            return this.forgeFailure(turnNumber, requestRejection, 'update_function_rejected');
        }

        try {
            const existing = await loadFunctionRecord(functionName);
            if (!existing) {
                const msg = `Function "${functionName}" does not exist`;
                log.recordAction(`→ failed: ${msg}`);
                return this.forgeFailure(turnNumber, msg, 'update_function_not_found');
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

            if (isRejectedFunctionSpec(updated)) {
                log.recordAction(`→ Code Forge rejected update: ${updated.reason}`);
                return this.forgeFailure(turnNumber, updated.reason, 'update_function_rejected');
            }

            const unsupportedResult = this.findUnsupportedGeneratedSpecReason(updated);
            if (unsupportedResult) {
                log.recordAction(`→ Code Forge rejected update: ${unsupportedResult}`);
                return this.forgeFailure(turnNumber, unsupportedResult, 'update_function_rejected');
            }

            const updatedRecord: FunctionRecord = {
                ...updated,
                name: existing.name,
                tile: existing.tile,
                creator: existing.creator,
            };

            const dryRun = await testFunctionSpec(updatedRecord);
            if (!dryRun.ok) {
                log.recordAction(`→ failed: ${dryRun.result}`);
                return this.forgeFailure(turnNumber, dryRun.result, 'update_function_test');
            }

            await saveFunctionRecord(updatedRecord);
            this.registerFunctionBuilding(updatedRecord);
            log.recordAction(`→ updated function "${updatedRecord.name}": ${updatedRecord.description}`);
            return {
                shouldStop: true,
                reflectionEvent: {
                    turnNumber,
                    kind: 'success',
                    summary: `Updated function "${updatedRecord.name}" at Code Forge`,
                    successPattern: 'Updating functions at Code Forge with valid description',
                },
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.recordAction(`→ failed: ${msg}`);
            return this.forgeFailure(turnNumber, msg, 'update_function_error');
        }
    }

    async handleDeleteFunction(
        npc: NPC,
        log: ChronologicalLog,
        functionName: string,
        turnNumber: number,
    ): Promise<ActionExecutionResult> {
        const forge = this.toolRegistry.getById('code_forge');
        if (!isAdjacentToBuilding(npc.tilePos, forge)) {
            log.recordAction('→ failed: not adjacent to Code Forge');
            return this.forgeFailure(turnNumber, 'Not adjacent to Code Forge', 'not_adjacent_forge');
        }

        const existing = this.toolRegistry.getById(functionName);
        if (!existing) {
            const msg = `Function "${functionName}" does not exist`;
            log.recordAction(`→ failed: ${msg}`);
            return this.forgeFailure(turnNumber, msg, 'delete_function_not_found');
        }

        try {
            await deleteFunctionRecord(functionName);
            this.toolRegistry.unregister(functionName);
            log.recordAction(`→ deleted function "${functionName}"`);
            log.recordAction(`→ building removed from (${existing.tile.x},${existing.tile.y})`);
            return {
                shouldStop: true,
                reflectionEvent: {
                    turnNumber,
                    kind: 'success',
                    summary: `Deleted function "${functionName}"`,
                    successPattern: 'Deleting functions at Code Forge',
                },
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.recordAction(`→ failed: ${msg}`);
            return this.forgeFailure(turnNumber, msg, 'delete_function_error');
        }
    }

    private forgeFailure(turnNumber: number, summary: string, obstacleKey: string): ActionExecutionResult {
        return {
            shouldStop: true,
            reflectionEvent: {
                turnNumber,
                kind: 'failure',
                summary,
                obstacleKey,
            },
        };
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

    private findUnsupportedGeneratedSpecReason(spec: GeneratedFunctionSpec): string | null {
        return findUnsupportedFunctionReason(spec);
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