import { TilePos } from './types';

export interface ToolBuilding {
    id: string;
    displayName: string;
    tile: TilePos;
    symbol: string;
    description: string;
    instructions: string;
    execute: (args: string) => Promise<string>;
}
