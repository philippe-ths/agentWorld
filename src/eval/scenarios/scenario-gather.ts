import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestScenario, EvalGameState } from '../types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEETING_POINT = { x: 18, y: 15 };
const GATHER_RADIUS = 2; // Manhattan distance threshold

const scenarioGather: TestScenario = {
    id: 'scenario-gather',
    targetNpc: 'Ada',
    maxGlobalTurns: 25,

    async seedChronologicalLog(): Promise<void> {
        const logsDir = resolve(__dirname, '..', '..', '..', 'data', 'logs');
        mkdirSync(logsDir, { recursive: true });

        // Ada was told by the player to gather the others at the meeting point
        const adaSeed = [
            `## Turn 0`,
            `- I am at (15,10)`,
            `- I can see: Player at (5,5), Bjorn at (25,20), Cora at (10,25)`,
            `- The player came up and told me: "Ada, I need you to gather Bjorn and Cora. Go to each of them, tell them to meet at tile (${MEETING_POINT.x},${MEETING_POINT.y}), and then head there yourself. Everyone needs to be at (${MEETING_POINT.x},${MEETING_POINT.y})."`,
            `- I told the player: "Got it, I'll go find Bjorn and Cora and tell them to meet at (${MEETING_POINT.x},${MEETING_POINT.y}). I'll head there too once I've spoken to both of them."`,
        ].join('\n') + '\n';

        writeFileSync(resolve(logsDir, 'chronological-Ada.md'), adaSeed, 'utf-8');

        // Bjorn and Cora start with empty logs — they don't know the plan yet
        writeFileSync(resolve(logsDir, 'chronological-Bjorn.md'), '', 'utf-8');
        writeFileSync(resolve(logsDir, 'chronological-Cora.md'), '', 'utf-8');
    },

    checkSuccess(state: EvalGameState): boolean {
        const ada = state.npcPositions.get('Ada');
        const bjorn = state.npcPositions.get('Bjorn');
        const cora = state.npcPositions.get('Cora');
        if (!ada || !bjorn || !cora) return false;

        const adaDist = Math.abs(ada.x - MEETING_POINT.x) + Math.abs(ada.y - MEETING_POINT.y);
        const bjornDist = Math.abs(bjorn.x - MEETING_POINT.x) + Math.abs(bjorn.y - MEETING_POINT.y);
        const coraDist = Math.abs(cora.x - MEETING_POINT.x) + Math.abs(cora.y - MEETING_POINT.y);

        return adaDist <= GATHER_RADIUS && bjornDist <= GATHER_RADIUS && coraDist <= GATHER_RADIUS;
    },
};

export default scenarioGather;
