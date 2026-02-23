import 'dotenv/config';
import express from 'express';
import type { Response } from 'express';
import cors from 'cors';
import { generateDialogue, generateReasoning } from './ai/SlowLoop.js';
import {
    buildProposePrompt,
    buildDialoguePrompt,
    buildQuestionPrompt,
    buildRevisePrompt,
    buildRememberPrompt,
} from './ai/PromptTemplates.js';
import { enqueue, Priority, getQueueDepth } from './ai/ApiQueue.js';
import { addObservation, initBuffer } from './memory/ShortTermBuffer.js';
import { selfCritique } from './memory/Reflection.js';
import { addMemory, getRelevantMemories, updateBeliefs, decayMemories } from './memory/LongTermMemory.js';
import { upsertEntity, upsertRelation, summarizeKnowledge } from './memory/KnowledgeGraph.js';
import { reflect } from './memory/Reflection.js';
import type { Observation, ReasoningRequest } from './types.js';
import { serverLog } from './ServerLogger.js';
import type { ServerLogEntry } from './ServerLogger.js';

export const app = express();
const PORT = 3001;

app.use(cors({ origin: ['http://localhost:8080', 'http://127.0.0.1:8080'] }));
app.use(express.json());

// ── Tick: stubbed — will be replaced by protocol engine ──

app.post('/api/npc/tick', async (req, res) => {
    const observation = req.body as Observation;

    if (!observation?.npcId || !observation?.position) {
        res.status(400).json({ error: 'Invalid observation' });
        return;
    }

    // Record observation in short-term buffer
    addObservation(observation.npcId, {
        timestamp: Date.now(),
        position: observation.position,
        nearbyEntities: observation.nearbyEntities.map(e => e.name),
        event: observation.currentSkill
            ? `executing ${observation.currentSkill}`
            : 'idle',
    });

    // Update knowledge graph with observed entities
    for (const entity of observation.nearbyEntities) {
        upsertEntity(
            observation.npcId, entity.name, 'npc',
            { distance: String(entity.distance) },
            entity.position,
        ).catch(console.error);
    }

    res.json({ skill: 'idle', params: { duration: 3000 } });
});

// ── Reasoning & dialogue ─────────────────────────────────

app.post('/api/npc/reason', async (req, res) => {
    const request = req.body as ReasoningRequest;

    if (!request?.npcId || !request?.observation) {
        res.status(400).json({ error: 'Invalid request' });
        return;
    }

    let result;

    if (request.mode === 'reasoning') {
        result = await generateReasoning(
            request.npcId,
            request.observation,
            { stuckCount: request.stuckCount, failedSkill: request.failedSkill },
        );

        // Persist belief updates to knowledge graph
        if (result.beliefs) {
            const beliefs = result.beliefs as {
                entities?: Record<string, { relationship: string }>;
                insights?: string[];
            };
            updateBeliefs(request.npcId, beliefs).catch(console.error);

            if (beliefs.entities) {
                for (const [name, data] of Object.entries(beliefs.entities)) {
                    upsertRelation(
                        request.npcId, request.observation.name, name,
                        data.relationship, 0.8, 'from reasoning',
                    ).catch(console.error);
                }
            }
        }
    } else {
        result = await generateDialogue(
            request.npcId,
            request.observation,
            request.conversationHistory ?? [],
            request.partnerName ?? 'someone',
        );
    }

    res.json(result);
});

// ── SSE log stream ──────────────────────────────────────

const sseClients: Set<Response> = new Set();

app.get('/api/logs/stream', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });
    res.write('data: {"type":"connected"}\n\n');
    sseClients.add(res);
    req.on('close', () => { sseClients.delete(res); });
});

serverLog.on('entry', (entry: ServerLogEntry) => {
    const data = JSON.stringify(entry);
    for (const client of sseClients) {
        client.write(`data: ${data}\n\n`);
    }
});

// ── Health check ─────────────────────────────────────────

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', queueDepth: getQueueDepth() });
});

app.get('/api/stats/resources', (_req, res) => {
    res.json({ goals: [], goalsTracked: 0, totalTokensIn: 0, totalTokensOut: 0, estimatedCostUSD: 0 });
});

// ── Failure reporting: triggers self-critique ────────────

app.post('/api/npc/failure', async (req, res) => {
    const { npcId, failureEvents, skill, stuckCount } = req.body as {
        npcId: string;
        failureEvents: string[];
        skill?: string;
        stuckCount?: number;
    };

    if (!npcId || !failureEvents?.length) {
        res.status(400).json({ error: 'Invalid failure report' });
        return;
    }

    selfCritique(npcId, failureEvents, { skill, stuckCount }).catch(console.error);

    res.json({ status: 'accepted' });
});

// ── Skill outcome reporting (stub) ──────────────────────

app.post('/api/npc/skill-outcome', async (req, res) => {
    const { skill, success } = req.body as {
        skill: string;
        success: boolean;
    };

    if (!skill || typeof success !== 'boolean') {
        res.status(400).json({ error: 'Invalid outcome' });
        return;
    }

    res.json({ status: 'recorded' });
});

// ── Protocol endpoints ──────────────────────────────────

function extractJsonText(response: { content: { type: string; text?: string }[] }): string {
    const block = response.content.find(b => b.type === 'text');
    return block && 'text' in block ? block.text! : '';
}

function parseJsonResponse(text: string): unknown {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```$/i, '').trim();
    return JSON.parse(cleaned);
}

// Generate a Propose for a new task
app.post('/api/protocol/propose', async (req, res) => {
    const { npcId, taskDescription, worldSummary, capabilities, memories } = req.body as {
        npcId: string;
        taskDescription: string;
        worldSummary: string;
        capabilities?: string;
        memories?: string[];
    };

    if (!npcId || !taskDescription || !worldSummary) {
        res.status(400).json({ error: 'Missing npcId, taskDescription, or worldSummary' });
        return;
    }

    try {
        serverLog.info('propose', `${npcId}: "${taskDescription}"`);
        const prompt = buildProposePrompt(
            npcId, worldSummary, taskDescription, capabilities ?? '', memories ?? [],
        );

        const t0 = Date.now();
        const response = await enqueue(Priority.REASONING, {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
        });
        const duration = Date.now() - t0;
        const usage = response.usage;

        const parsed = parseJsonResponse(extractJsonText(response)) as Record<string, unknown>;
        const subCount = Array.isArray(parsed.subTasks) ? parsed.subTasks.length : 0;
        serverLog.info('propose', `${npcId}: ${subCount} sub-tasks, interpretation: "${String(parsed.interpretation ?? '').slice(0, 80)}"`, { model: 'claude-sonnet-4-20250514', durationMs: duration, tokensIn: usage?.input_tokens, tokensOut: usage?.output_tokens });

        res.json({
            type: 'propose',
            id: `task_${Date.now()}`,
            from: npcId,
            taskDescription,
            ...parsed,
        });
    } catch (err) {
        serverLog.error('propose', `${npcId}: LLM call failed — ${err instanceof Error ? err.message : String(err)}`);
        res.status(500).json({ error: 'LLM call failed' });
    }
});

// Generate dialogue for a conversation turn
app.post('/api/protocol/dialogue', async (req, res) => {
    const { npcId, partner, history, purpose, worldSummary, memories, role } = req.body as {
        npcId: string;
        partner: string;
        history?: { speaker: string; text: string }[];
        purpose?: string;
        worldSummary: string;
        memories?: string[];
        role?: 'initiator' | 'responder';
    };

    if (!npcId || !partner || !worldSummary) {
        res.status(400).json({ error: 'Missing npcId, partner, or worldSummary' });
        return;
    }

    try {
        serverLog.info('dialogue', `${npcId} → ${partner}${purpose ? ` (purpose: ${purpose})` : ''}`);
        const prompt = buildDialoguePrompt(
            npcId, worldSummary, partner, history ?? [], purpose, memories ?? [], role,
        );

        const t0 = Date.now();
        const response = await enqueue(Priority.DIALOGUE, {
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 256,
            messages: [{ role: 'user', content: prompt }],
        });
        const duration = Date.now() - t0;
        const usage = response.usage;

        const parsed = parseJsonResponse(extractJsonText(response)) as Record<string, unknown>;
        serverLog.info('dialogue', `${npcId} → ${partner}: "${String(parsed.dialogue ?? '').slice(0, 80)}"`, { model: 'claude-haiku-4-5-20251001', durationMs: duration, tokensIn: usage?.input_tokens, tokensOut: usage?.output_tokens });

        res.json({
            dialogue: parsed.dialogue ?? '...',
            internalThought: parsed.internalThought,
            taskRequested: parsed.taskRequested ?? null,
        });
    } catch (err) {
        serverLog.error('dialogue', `${npcId} → ${partner}: LLM failed — ${err instanceof Error ? err.message : String(err)}`);
        res.status(500).json({ error: 'LLM call failed' });
    }
});

// Evaluate a proposal (generate Question or approve)
app.post('/api/protocol/evaluate-proposal', async (req, res) => {
    const { npcId, proposal, worldSummary, memories } = req.body as {
        npcId: string;
        proposal: {
            taskDescription: string;
            interpretation: string;
            subTasks: { id: string; description: string; completionCriteria: string }[];
            completionCriteria: string;
            rollupLogic: string;
        };
        worldSummary: string;
        memories?: string[];
    };

    if (!npcId || !proposal || !worldSummary) {
        res.status(400).json({ error: 'Missing npcId, proposal, or worldSummary' });
        return;
    }

    try {
        serverLog.info('evaluate', `${npcId}: evaluating proposal for "${proposal.taskDescription.slice(0, 60)}"`);
        const prompt = buildQuestionPrompt(npcId, proposal, worldSummary, memories ?? []);

        const t0 = Date.now();
        const response = await enqueue(Priority.REASONING, {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 512,
            messages: [{ role: 'user', content: prompt }],
        });
        const duration = Date.now() - t0;
        const usage = response.usage;

        const parsed = parseJsonResponse(extractJsonText(response)) as Record<string, unknown>;

        if (parsed.approved === true) {
            serverLog.info('evaluate', `${npcId}: proposal approved`, { durationMs: duration, tokensIn: usage?.input_tokens, tokensOut: usage?.output_tokens });
            res.json({ approved: true });
        } else {
            serverLog.info('evaluate', `${npcId}: concern raised — ${String(parsed.concern ?? '').slice(0, 80)}`, { durationMs: duration, tokensIn: usage?.input_tokens, tokensOut: usage?.output_tokens });
            res.json({
                type: 'question',
                id: `q_${Date.now()}`,
                from: npcId,
                kind: parsed.kind,
                concern: parsed.concern,
                evidence: parsed.evidence,
                suggestedAlternative: parsed.suggestedAlternative,
                tier: 'strategic',
            });
        }
    } catch (err) {
        serverLog.error('evaluate', `${npcId}: LLM failed — ${err instanceof Error ? err.message : String(err)}`);
        res.status(500).json({ error: 'LLM call failed' });
    }
});

// Generate a Revise in response to a Question
app.post('/api/protocol/revise', async (req, res) => {
    const { npcId, originalProposal, question, worldSummary } = req.body as {
        npcId: string;
        originalProposal: {
            taskDescription: string;
            interpretation: string;
            subTasks: { id: string; description: string; completionCriteria: string }[];
            completionCriteria: string;
        };
        question: {
            kind: string;
            concern: string;
            evidence: string;
            suggestedAlternative?: string;
        };
        worldSummary: string;
    };

    if (!npcId || !originalProposal || !question || !worldSummary) {
        res.status(400).json({ error: 'Missing npcId, originalProposal, question, or worldSummary' });
        return;
    }

    try {
        serverLog.info('revise', `${npcId}: revising for concern "${question.concern.slice(0, 60)}"`);
        const prompt = buildRevisePrompt(npcId, originalProposal, question, worldSummary);

        const t0 = Date.now();
        const response = await enqueue(Priority.REASONING, {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            messages: [{ role: 'user', content: prompt }],
        });
        const duration = Date.now() - t0;
        const usage = response.usage;

        const parsed = parseJsonResponse(extractJsonText(response)) as Record<string, unknown>;
        serverLog.info('revise', `${npcId}: revised — "${String(parsed.whatChanged ?? parsed.explanation ?? '').slice(0, 80)}"`, { durationMs: duration, tokensIn: usage?.input_tokens, tokensOut: usage?.output_tokens });

        res.json({
            type: 'revise',
            id: `rev_${Date.now()}`,
            from: npcId,
            originalProposalId: (originalProposal as any).id ?? 'unknown',
            triggeredBy: (question as any).id ?? 'unknown',
            ...parsed,
            tier: 'strategic',
        });
    } catch (err) {
        serverLog.error('revise', `${npcId}: LLM failed — ${err instanceof Error ? err.message : String(err)}`);
        res.status(500).json({ error: 'LLM call failed' });
    }
});

// Distill lessons from a completed task
app.post('/api/protocol/remember', async (req, res) => {
    const { npcId, taskContext, outcome } = req.body as {
        npcId: string;
        taskContext: string;
        outcome: string;
    };

    if (!npcId || !taskContext || !outcome) {
        res.status(400).json({ error: 'Missing npcId, taskContext, or outcome' });
        return;
    }

    try {
        serverLog.info('remember', `${npcId}: distilling lessons from "${taskContext.slice(0, 60)}"`);
        const prompt = buildRememberPrompt(npcId, taskContext, outcome);

        const t0 = Date.now();
        const response = await enqueue(Priority.BACKGROUND, {
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 256,
            messages: [{ role: 'user', content: prompt }],
        });
        const duration = Date.now() - t0;
        const usage = response.usage;

        const parsed = parseJsonResponse(extractJsonText(response)) as { lessons?: unknown[] };
        serverLog.info('remember', `${npcId}: ${parsed.lessons?.length ?? 0} lessons distilled`, { durationMs: duration, tokensIn: usage?.input_tokens, tokensOut: usage?.output_tokens });

        res.json({
            type: 'remember',
            id: `mem_${Date.now()}`,
            from: npcId,
            lessons: parsed.lessons ?? [],
        });
    } catch (err) {
        serverLog.error('remember', `${npcId}: LLM failed — ${err instanceof Error ? err.message : String(err)}`);
        res.status(500).json({ error: 'LLM call failed' });
    }
});

// ── Memory endpoints ────────────────────────────────────

// Retrieve relevant memories + knowledge for a task/query
app.post('/api/memory/relevant', async (req, res) => {
    const { npcId, query } = req.body as { npcId: string; query: string };

    if (!npcId || !query) {
        res.status(400).json({ error: 'Missing npcId or query' });
        return;
    }

    try {
        const observation: Observation = {
            npcId,
            name: npcId,
            position: { x: 0, y: 0 },
            nearbyEntities: [],
            isInConversation: false,
            currentSkill: null,
            recentEvents: [query],
        };

        const [memories, knowledge] = await Promise.all([
            getRelevantMemories(npcId, observation),
            summarizeKnowledge(npcId),
        ]);

        const combined: string[] = [...memories];
        if (knowledge.length > 0) {
            combined.push(knowledge);
        }

        serverLog.info('memory', `${npcId}: retrieved ${combined.length} relevant memories for "${query.slice(0, 60)}"`);
        res.json({ memories: combined });
    } catch (err) {
        serverLog.error('memory', `${npcId}: retrieval failed — ${err instanceof Error ? err.message : String(err)}`);
        res.json({ memories: [] });
    }
});

// Store a lesson/memory from task completion
app.post('/api/memory/store', async (req, res) => {
    const { npcId, text, type, importance } = req.body as {
        npcId: string;
        text: string;
        type?: string;
        importance?: number;
    };

    if (!npcId || !text) {
        res.status(400).json({ error: 'Missing npcId or text' });
        return;
    }

    try {
        await addMemory(npcId, text, (type ?? 'lesson') as 'lesson', importance ?? 0.7);
        serverLog.info('memory', `${npcId}: stored ${type ?? 'lesson'} (importance: ${importance ?? 0.7})`);
        res.json({ status: 'stored' });
    } catch (err) {
        serverLog.error('memory', `${npcId}: store failed — ${err instanceof Error ? err.message : String(err)}`);
        res.status(500).json({ error: 'Failed to store memory' });
    }
});

// ── Init & start ────────────────────────────────────────

const NPC_IDS = ['ada', 'bjorn', 'cora'];

async function start() {
    await Promise.all(NPC_IDS.map(id => initBuffer(id)));

    // Periodic memory maintenance: reflection + decay every 60s
    setInterval(async () => {
        for (const npcId of NPC_IDS) {
            try {
                await reflect(npcId);
                await decayMemories(npcId);
                serverLog.info('maintenance', `${npcId}: reflection + decay complete`);
            } catch (err) {
                serverLog.warn('maintenance', `${npcId}: failed — ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }, 60_000);

    app.listen(PORT, () => {
        console.log(`[AgentWorld Server] Running on http://localhost:${PORT}`);
    });
}

if (process.env.NODE_ENV !== 'test') {
    start().catch(console.error);
}
