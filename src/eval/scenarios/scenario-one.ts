import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestScenario, EvalGameState } from '../types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET_TILE = { x: 20, y: 10 };

const scenarioOne: TestScenario = {
    id: 'scenario-one',
    targetNpc: 'Ada',
    maxGlobalTurns: 12,

    async seedChronologicalLog(): Promise<void> {
        // Seed Ada's chronological log with a fake prior conversation.
        // The player asked Ada to go to a specific tile, and Ada acknowledged.
        // Must match the existing chronological log markdown format.
        const seed = [
            `## Turn 0`,
            `- I am at (15,10)`,
            `- I can see: Player at (5,5), Bjorn at (25,20), Cora at (10,25)`,
            `- The player came up and told me: "Hey Ada, could you head over to tile (${TARGET_TILE.x},${TARGET_TILE.y}) for me? I left something there and need you to go check it out."`,
            `- I told the player: "Sure, I'll make my way over to (${TARGET_TILE.x},${TARGET_TILE.y}) right away."`,
        ].join('\n') + '\n';

        const logsDir = resolve(__dirname, '..', '..', '..', 'data', 'logs');
        mkdirSync(logsDir, { recursive: true });
        writeFileSync(resolve(logsDir, 'chronological-Ada.md'), seed, 'utf-8');
    },

    checkSuccess(state: EvalGameState): boolean {
        const adaPos = state.npcPositions.get('Ada');
        if (!adaPos) return false;
        return adaPos.x === TARGET_TILE.x && adaPos.y === TARGET_TILE.y;
    },
};

export default scenarioOne;
