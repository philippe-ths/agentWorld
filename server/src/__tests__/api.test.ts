import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

// Set test environment before any imports
process.env.NODE_ENV = 'test';

// Mock all heavy dependencies used by index.ts route handlers

vi.mock('../ai/SlowLoop.js', () => ({
    generateDialogue: vi.fn(async () => ({ type: 'dialogue', dialogue: 'Hello!' })),
    generateReasoning: vi.fn(async () => ({ type: 'plan', actions: [{ type: 'wait', duration: 2000 }] })),
}));

vi.mock('../memory/ShortTermBuffer.js', () => ({
    addObservation: vi.fn(),
    initBuffer: vi.fn(async () => {}),
}));

vi.mock('../memory/Reflection.js', () => ({
    reflect: vi.fn(async () => {}),
    selfCritique: vi.fn(async () => {}),
}));

vi.mock('../memory/LongTermMemory.js', () => ({
    decayMemories: vi.fn(async () => {}),
    updateBeliefs: vi.fn(async () => {}),
}));

vi.mock('../memory/KnowledgeGraph.js', () => ({
    upsertEntity: vi.fn(async () => {}),
    upsertRelation: vi.fn(async () => {}),
    loadGraph: vi.fn(async () => ({ entities: {}, relations: [], rules: [] })),
    addRule: vi.fn(async () => {}),
}));

vi.mock('../ai/ApiQueue.js', () => ({
    enqueue: vi.fn(async () => ({
        content: [{ type: 'text', text: '{}' }],
    })),
    Priority: { BACKGROUND: 0, TICK: 1, TACTICAL: 2, REASONING: 3, STRATEGIC: 4, DIALOGUE: 5 },
    getQueueDepth: vi.fn(() => 0),
}));

vi.mock('../ai/PromptTemplates.js', () => ({
    getPersona: vi.fn(() => 'Test persona'),
    buildProposePrompt: vi.fn(() => 'propose prompt'),
    buildDialoguePrompt: vi.fn(() => 'dialogue prompt'),
    buildQuestionPrompt: vi.fn(() => 'question prompt'),
    buildRevisePrompt: vi.fn(() => 'revise prompt'),
    buildRememberPrompt: vi.fn(() => 'remember prompt'),
}));

// Import app + mocked enqueue after mocks are set up
import { app } from '../index.js';
import { enqueue } from '../ai/ApiQueue.js';
const mockEnqueue = enqueue as ReturnType<typeof vi.fn>;

// Simple helper to make HTTP requests against the Express app without supertest
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

let server: Server;
let baseUrl: string;

async function startServer(): Promise<void> {
    return new Promise(resolve => {
        server = createServer(app);
        server.listen(0, () => {
            const addr = server.address() as AddressInfo;
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    return new Promise(resolve => {
        server.close(() => resolve());
    });
}

async function post(path: string, body: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
}

async function get(path: string) {
    const res = await fetch(`${baseUrl}${path}`);
    return { status: res.status, data: await res.json() };
}

const validObservation = {
    npcId: 'ada',
    name: 'Ada',
    position: { x: 5, y: 5 },
    nearbyEntities: [],
    isInConversation: false,
    currentSkill: null,
    recentEvents: [],
};

describe('API Endpoints', () => {
    beforeAll(async () => {
        await startServer();
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('GET /api/health', () => {
        it('returns ok', async () => {
            const { status, data } = await get('/api/health');
            expect(status).toBe(200);
            expect(data.status).toBe('ok');
        });
    });

    describe('GET /api/stats/resources', () => {
        it('returns aggregate resource stats payload', async () => {
            const { status, data } = await get('/api/stats/resources');
            expect(status).toBe(200);
            expect(typeof data.goalsTracked).toBe('number');
            expect(typeof data.totalTokensIn).toBe('number');
            expect(typeof data.totalTokensOut).toBe('number');
            expect(typeof data.estimatedCostUSD).toBe('number');
        });
    });

    describe('POST /api/npc/tick', () => {
        it('returns skill selection', async () => {
            const { status, data } = await post('/api/npc/tick', validObservation);
            expect(status).toBe(200);
            expect(data.skill).toBe('idle');
        });

        it('rejects invalid observation', async () => {
            const { status } = await post('/api/npc/tick', { invalid: true });
            expect(status).toBe(400);
        });

        it('rejects missing npcId', async () => {
            const { status } = await post('/api/npc/tick', { position: { x: 0, y: 0 } });
            expect(status).toBe(400);
        });
    });

    describe('POST /api/npc/reason', () => {
        it('returns reasoning result', async () => {
            const { status, data } = await post('/api/npc/reason', {
                npcId: 'ada',
                observation: validObservation,
                mode: 'reasoning',
            });
            expect(status).toBe(200);
            expect(data.type).toBe('plan');
        });

        it('returns dialogue for conversation mode', async () => {
            const { status, data } = await post('/api/npc/reason', {
                npcId: 'ada',
                observation: validObservation,
                mode: 'conversation',
                conversationHistory: [],
                partnerName: 'Bjorn',
            });
            expect(status).toBe(200);
            expect(data.type).toBe('dialogue');
        });

        it('rejects missing npcId', async () => {
            const { status } = await post('/api/npc/reason', { observation: validObservation });
            expect(status).toBe(400);
        });

        it('rejects missing observation', async () => {
            const { status } = await post('/api/npc/reason', { npcId: 'ada' });
            expect(status).toBe(400);
        });
    });

    describe('POST /api/npc/failure', () => {
        it('accepts valid failure report', async () => {
            const { status, data } = await post('/api/npc/failure', {
                npcId: 'ada',
                failureEvents: ['got stuck'],
                skill: 'move_to',
                stuckCount: 2,
            });
            expect(status).toBe(200);
            expect(data.status).toBe('accepted');
        });

        it('rejects empty failureEvents', async () => {
            const { status } = await post('/api/npc/failure', {
                npcId: 'ada',
                failureEvents: [],
            });
            expect(status).toBe(400);
        });

        it('rejects missing npcId', async () => {
            const { status } = await post('/api/npc/failure', {
                failureEvents: ['error'],
            });
            expect(status).toBe(400);
        });
    });

    describe('POST /api/npc/skill-outcome', () => {
        it('records successful outcome', async () => {
            const { status, data } = await post('/api/npc/skill-outcome', {
                skill: 'wander',
                success: true,
            });
            expect(status).toBe(200);
            expect(data.status).toBe('recorded');
        });

        it('rejects missing skill', async () => {
            const { status } = await post('/api/npc/skill-outcome', {
                success: true,
            });
            expect(status).toBe(400);
        });

        it('rejects non-boolean success', async () => {
            const { status } = await post('/api/npc/skill-outcome', {
                skill: 'wander',
                success: 'yes',
            });
            expect(status).toBe(400);
        });
    });

    // ── Protocol endpoints ────────────────────────────────

    describe('POST /api/protocol/propose', () => {
        it('returns a Propose message on success', async () => {
            mockEnqueue.mockResolvedValueOnce({
                content: [{ type: 'text', text: JSON.stringify({
                    interpretation: 'find wood',
                    subTasks: [{ id: 's1', description: 'chop tree', completionCriteria: 'has wood' }],
                    completionCriteria: 'wood obtained',
                    rollupLogic: 'all sub-tasks done',
                }) }],
            });

            const { status, data } = await post('/api/protocol/propose', {
                npcId: 'ada',
                taskDescription: 'gather wood',
                worldSummary: 'forest nearby',
            });
            expect(status).toBe(200);
            expect(data.type).toBe('propose');
            expect(data.from).toBe('ada');
            expect(data.interpretation).toBe('find wood');
        });

        it('rejects missing npcId', async () => {
            const { status } = await post('/api/protocol/propose', {
                taskDescription: 'gather wood',
                worldSummary: 'forest',
            });
            expect(status).toBe(400);
        });

        it('rejects missing taskDescription', async () => {
            const { status } = await post('/api/protocol/propose', {
                npcId: 'ada',
                worldSummary: 'forest',
            });
            expect(status).toBe(400);
        });

        it('rejects missing worldSummary', async () => {
            const { status } = await post('/api/protocol/propose', {
                npcId: 'ada',
                taskDescription: 'gather wood',
            });
            expect(status).toBe(400);
        });
    });

    describe('POST /api/protocol/dialogue', () => {
        it('returns dialogue on success', async () => {
            mockEnqueue.mockResolvedValueOnce({
                content: [{ type: 'text', text: JSON.stringify({
                    dialogue: 'Hello Bjorn!',
                    internalThought: 'I should be friendly',
                }) }],
            });

            const { status, data } = await post('/api/protocol/dialogue', {
                npcId: 'ada',
                partner: 'Bjorn',
                worldSummary: 'village square',
            });
            expect(status).toBe(200);
            expect(data.dialogue).toBe('Hello Bjorn!');
            expect(data.internalThought).toBe('I should be friendly');
        });

        it('rejects missing partner', async () => {
            const { status } = await post('/api/protocol/dialogue', {
                npcId: 'ada',
                worldSummary: 'village',
            });
            expect(status).toBe(400);
        });

        it('rejects missing worldSummary', async () => {
            const { status } = await post('/api/protocol/dialogue', {
                npcId: 'ada',
                partner: 'Bjorn',
            });
            expect(status).toBe(400);
        });
    });

    describe('POST /api/protocol/evaluate-proposal', () => {
        const validProposal = {
            taskDescription: 'gather wood',
            interpretation: 'find wood',
            subTasks: [{ id: 's1', description: 'chop', completionCriteria: 'done' }],
            completionCriteria: 'wood obtained',
            rollupLogic: 'all done',
        };

        it('returns approved when LLM approves', async () => {
            mockEnqueue.mockResolvedValueOnce({
                content: [{ type: 'text', text: JSON.stringify({ approved: true }) }],
            });

            const { status, data } = await post('/api/protocol/evaluate-proposal', {
                npcId: 'ada',
                proposal: validProposal,
                worldSummary: 'forest',
            });
            expect(status).toBe(200);
            expect(data.approved).toBe(true);
        });

        it('returns question when LLM questions', async () => {
            mockEnqueue.mockResolvedValueOnce({
                content: [{ type: 'text', text: JSON.stringify({
                    approved: false,
                    kind: 'feasibility',
                    concern: 'no axe available',
                    evidence: 'inventory is empty',
                }) }],
            });

            const { status, data } = await post('/api/protocol/evaluate-proposal', {
                npcId: 'ada',
                proposal: validProposal,
                worldSummary: 'forest',
            });
            expect(status).toBe(200);
            expect(data.type).toBe('question');
            expect(data.kind).toBe('feasibility');
            expect(data.concern).toBe('no axe available');
        });

        it('rejects missing proposal', async () => {
            const { status } = await post('/api/protocol/evaluate-proposal', {
                npcId: 'ada',
                worldSummary: 'forest',
            });
            expect(status).toBe(400);
        });
    });

    describe('POST /api/protocol/revise', () => {
        it('returns a revised proposal on success', async () => {
            mockEnqueue.mockResolvedValueOnce({
                content: [{ type: 'text', text: JSON.stringify({
                    revisedSubTasks: [{ id: 's1', description: 'find axe first', completionCriteria: 'has axe' }],
                    revisedCompletionCriteria: 'wood obtained with axe',
                    explanation: 'need tool first',
                }) }],
            });

            const { status, data } = await post('/api/protocol/revise', {
                npcId: 'ada',
                originalProposal: {
                    taskDescription: 'gather wood',
                    interpretation: 'find wood',
                    subTasks: [{ id: 's1', description: 'chop', completionCriteria: 'done' }],
                    completionCriteria: 'wood obtained',
                },
                question: {
                    kind: 'feasibility',
                    concern: 'no axe',
                    evidence: 'empty inventory',
                },
                worldSummary: 'forest',
            });
            expect(status).toBe(200);
            expect(data.type).toBe('revise');
            expect(data.from).toBe('ada');
            expect(data.explanation).toBe('need tool first');
        });

        it('rejects missing originalProposal', async () => {
            const { status } = await post('/api/protocol/revise', {
                npcId: 'ada',
                question: { kind: 'a', concern: 'b', evidence: 'c' },
                worldSummary: 'forest',
            });
            expect(status).toBe(400);
        });

        it('rejects missing question', async () => {
            const { status } = await post('/api/protocol/revise', {
                npcId: 'ada',
                originalProposal: { taskDescription: 'a', interpretation: 'b', subTasks: [], completionCriteria: 'c' },
                worldSummary: 'forest',
            });
            expect(status).toBe(400);
        });
    });

    describe('POST /api/protocol/remember', () => {
        it('returns lessons on success', async () => {
            mockEnqueue.mockResolvedValueOnce({
                content: [{ type: 'text', text: JSON.stringify({
                    lessons: [
                        { insight: 'axes help', condition: 'gathering wood', confidence: 0.9 },
                    ],
                }) }],
            });

            const { status, data } = await post('/api/protocol/remember', {
                npcId: 'ada',
                taskContext: 'gathered wood in forest',
                outcome: 'success after finding axe',
            });
            expect(status).toBe(200);
            expect(data.type).toBe('remember');
            expect(data.from).toBe('ada');
            expect(data.lessons).toHaveLength(1);
            expect(data.lessons[0].insight).toBe('axes help');
        });

        it('rejects missing taskContext', async () => {
            const { status } = await post('/api/protocol/remember', {
                npcId: 'ada',
                outcome: 'success',
            });
            expect(status).toBe(400);
        });

        it('rejects missing outcome', async () => {
            const { status } = await post('/api/protocol/remember', {
                npcId: 'ada',
                taskContext: 'gathered wood',
            });
            expect(status).toBe(400);
        });
    });

    // Cleanup
    afterAll(async () => {
        await stopServer();
    });
});
