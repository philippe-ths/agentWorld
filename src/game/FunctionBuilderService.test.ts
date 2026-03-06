import { beforeEach, describe, expect, it, vi } from 'vitest';

const toolServiceMocks = vi.hoisted(() => ({
    generateFunctionSpec: vi.fn(),
    testFunctionSpec: vi.fn(),
    saveFunctionRecord: vi.fn(),
    loadFunctionRecord: vi.fn(),
    deleteFunctionRecord: vi.fn(),
    executeFunction: vi.fn(),
}));

vi.mock('./ToolService', () => ({
    generateFunctionSpec: toolServiceMocks.generateFunctionSpec,
    testFunctionSpec: toolServiceMocks.testFunctionSpec,
    saveFunctionRecord: toolServiceMocks.saveFunctionRecord,
    loadFunctionRecord: toolServiceMocks.loadFunctionRecord,
    deleteFunctionRecord: toolServiceMocks.deleteFunctionRecord,
    executeFunction: toolServiceMocks.executeFunction,
}));

vi.mock('./MapData', () => ({
    isGrassTile: vi.fn(() => true),
    isSpawnTile: vi.fn(() => false),
    isWithinMapBounds: vi.fn(() => true),
    isAdjacentToBuilding: vi.fn(() => true),
    isBuildingAt: vi.fn(() => false),
}));

import { FunctionBuilderService } from './FunctionBuilderService';
import { ToolRegistry } from './ToolRegistry';

function createRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.register({
        id: 'code_forge',
        displayName: 'Code Forge',
        tile: { x: 20, y: 15 },
        symbol: 'C',
        description: 'Forge',
        instructions: 'Use it',
        execute: async () => 'ok',
    });
    return registry;
}

function createLog() {
    const actions: string[] = [];
    return {
        actions,
        recordAction: (message: string) => {
            actions.push(message);
        },
    };
}

describe('FunctionBuilderService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        toolServiceMocks.testFunctionSpec.mockResolvedValue({ ok: true, result: '3' });
    });

    it('rejects unsupported create requests before generation', async () => {
        const service = new FunctionBuilderService(createRegistry());
        const log = createLog();
        const npc = { name: 'Bjorn', tilePos: { x: 20, y: 14 } };

        await service.handleCreateFunction(
            npc as never,
            log as never,
            'Send an email to the player with today\'s exchange rate',
            5,
            5,
        );

        expect(toolServiceMocks.generateFunctionSpec).not.toHaveBeenCalled();
        expect(toolServiceMocks.saveFunctionRecord).not.toHaveBeenCalled();
        expect(log.actions).toContain(
            'Code Forge rejected request: Cannot send emails: sandbox has no network access or mail service access',
        );
    });

    it('rejects structured update rejections without changing the existing function', async () => {
        toolServiceMocks.loadFunctionRecord.mockResolvedValue({
            name: 'sum_values',
            description: 'Calculate the sum of two numbers',
            parameters: [
                { name: 'left', type: 'number' },
                { name: 'right', type: 'number' },
            ],
            returnDescription: 'The numeric sum',
            code: 'return left + right;',
            tile: { x: 4, y: 4 },
            creator: 'Ada',
        });
        toolServiceMocks.generateFunctionSpec.mockResolvedValue({
            rejected: true,
            reason: 'Cannot access external APIs or the network: sandbox has no network access',
        });

        const service = new FunctionBuilderService(createRegistry());
        const log = createLog();
        const npc = { name: 'Ada', tilePos: { x: 20, y: 14 } };

        await service.handleUpdateFunction(
            npc as never,
            log as never,
            'sum_values',
            'Fetch live pricing data from an API before calculating the total',
        );

        expect(toolServiceMocks.saveFunctionRecord).not.toHaveBeenCalled();
        expect(log.actions).toContain(
            'Code Forge rejected update: Cannot access external APIs or the network: sandbox has no network access',
        );
    });
});