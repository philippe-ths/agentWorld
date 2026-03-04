import { TilePos } from './entities/Entity';

export interface ToolBuilding {
    id: string;
    displayName: string;
    tile: TilePos;
    symbol: string;
    description: string;
    instructions: string;
    execute: (args: string) => Promise<string>;
}
