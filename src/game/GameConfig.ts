import { TilePos } from './entities/Entity';

// ── Map ──────────────────────────────────────────────────────

export const MAP_SEED = 42;
export const MAP_COLS = 30;
export const MAP_ROWS = 30;
export const TILE_W = 64;
export const TILE_H = 32;

// ── Timing ───────────────────────────────────────────────────

export const NPC_TURN_DELAY = 5000;
export const SPEECH_BUBBLE_DURATION = 3000;
export const MOVE_TWEEN_DURATION = 180;
export const MAX_REPATH_ATTEMPTS = 5;

// ── LLM ──────────────────────────────────────────────────────

// Model selection by intelligence tier (most → least intelligent)
export const LLM_MODEL_OPUS = 'claude-opus-4-6';
export const LLM_MODEL_SONNET = 'claude-sonnet-4-6';
export const LLM_MODEL_HAIKU = 'claude-haiku-4-5-20251001';

export const LLM_ENDPOINTS = {
    chat: '/api/chat',
    search: '/api/search',
    logs: '/api/logs',
    goals: '/api/goals',
    reflections: '/api/reflections',
    execute: '/api/execute',
    functions: '/api/functions',
} as const;

export interface FunctionParameterSpec {
    name: string;
    type: string;
}

export interface GeneratedFunctionSpec {
    name: string;
    description: string;
    parameters: FunctionParameterSpec[];
    returnDescription: string;
    code: string;
}

export interface RejectedFunctionSpec {
    rejected: true;
    reason: string;
}

export type FunctionGenerationResult = GeneratedFunctionSpec | RejectedFunctionSpec;

export interface FunctionRecord extends GeneratedFunctionSpec {
    tile: TilePos;
    creator: string;
}

// ── Gameplay tuning ──────────────────────────────────────────

export const SUMMARIZE_EVERY_N_TURNS = 5;
export const REFLECTION_EVERY_N_TURNS = 5;
export const UNKNOWN_DIRECTIVE_TRIGGER_THRESHOLD = 2;
export const OUTPUT_GUARD_REPROMPT_ATTEMPTS = 1;
export const LOG_CHAR_BUDGET = 4000;
export const MAX_EXCHANGES = 6;
export const NPC_COMMANDS_PER_TURN = 3;
export const SLEEP_TURNS = 10;

// ── NPC definitions ──────────────────────────────────────────

export interface NPCDef {
    name: string;
    tile: TilePos;
    tint: number;
}

export const NPCS: NPCDef[] = [
    { name: 'Ada',   tile: { x: 15, y: 10 }, tint: 0xff6b6b },
    { name: 'Bjorn', tile: { x: 25, y: 20 }, tint: 0x6bc5ff },
    { name: 'Cora',  tile: { x: 10, y: 25 }, tint: 0xb06bff },
];

export const PLAYER_SPAWN: TilePos = { x: 5, y: 5 };

// ── Building definitions ─────────────────────────────────────

export interface BuildingDef {
    id: string;
    displayName: string;
    tile: TilePos;
    symbol: string;
    description: string;
    instructions: string;
    handler: string;   // key into ToolRegistry handler map
}

export const BUILDINGS: BuildingDef[] = [
    {
        id: 'search_terminal',
        displayName: 'Search Terminal',
        tile: { x: 15, y: 15 },
        symbol: 'S',
        description: 'A terminal that can search the internet for information.',
        instructions: 'Use: use_tool(search_terminal, "your search query"). Returns a summary of search results (max 500 chars). Ends your turn immediately.',
        handler: 'search',
    },
    {
        id: 'code_forge',
        displayName: 'Code Forge',
        tile: { x: 20, y: 15 },
        symbol: 'C',
        description: 'A forge where new executable function buildings can be created, updated, or deleted.',
        instructions: 'create_function("description of what the function should do", x, y) | update_function("function_name", "description of what to change") | delete_function("function_name"). Each command ends your turn immediately.',
        handler: 'code_forge',
    },
];

// ── UI ───────────────────────────────────────────────────────

export const COLORS = {
    buildingWallLight: 0xd48430,
    buildingWallDark:  0xb36b20,
    buildingRoof:      0xcc4444,
    buildingRoofEdge:  0x8b2020,
    buildingOutline:   0x5d3a1a,
    tileGrass:         0x4caf50,
    tileGrassEdge:     0x388e3c,
    tileWater:         0x2196f3,
    tileWaterEdge:     0x1565c0,
} as const;

export const FONT = {
    label: { fontSize: '11px', color: '#ffffff', fontFamily: 'Arial, sans-serif', stroke: '#000000', strokeThickness: 3 },
    turnLabel: { fontSize: '14px', color: '#ffffff', fontFamily: 'Arial, sans-serif', stroke: '#000000', strokeThickness: 3 },
} as const;
