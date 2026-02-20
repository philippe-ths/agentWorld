import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

// Set test environment before any imports
process.env.NODE_ENV = 'test';

// Mock all heavy dependencies used by index.ts route handlers

vi.mock('../ai/MediumLoop.js', () => ({
    mediumLoopTick: vi.fn(async () => ({ skill: 'idle', params: { duration: 3000 } })),
}));

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

vi.mock('../skills/SkillLibrary.js', () => ({
    loadLearnedSkills: vi.fn(async () => {}),
    addSkill: vi.fn(async () => true),
    recordOutcome: vi.fn(async () => {}),
}));

// Import app after mocks are set up
import { app } from '../index.js';
import { mediumLoopTick } from '../ai/MediumLoop.js';
import { generateReasoning } from '../ai/SlowLoop.js';
import { selfCritique } from '../memory/Reflection.js';
import { recordOutcome } from '../skills/SkillLibrary.js';

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
            expect(recordOutcome).toHaveBeenCalledWith('wander', true);
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

    // Cleanup
    afterAll(async () => {
        await stopServer();
    });
});
