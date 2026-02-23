import 'dotenv/config';
import express from 'express';
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
import { updateBeliefs } from './memory/LongTermMemory.js';
import { upsertEntity, upsertRelation } from './memory/KnowledgeGraph.js';
import type { Observation, ReasoningRequest } from './types.js';

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
        const prompt = buildProposePrompt(
            npcId, worldSummary, taskDescription, capabilities ?? '', memories ?? [],
        );

        const response = await enqueue(Priority.REASONING, {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
        });

        const parsed = parseJsonResponse(extractJsonText(response)) as Record<string, unknown>;

        res.json({
            type: 'propose',
            id: `task_${Date.now()}`,
            from: npcId,
            taskDescription,
            ...parsed,
        });
    } catch (err) {
        console.error('[Protocol/propose] Error:', err);
        res.status(500).json({ error: 'LLM call failed' });
    }
});

// Generate dialogue for a conversation turn
app.post('/api/protocol/dialogue', async (req, res) => {
    const { npcId, partner, history, purpose, worldSummary, memories } = req.body as {
        npcId: string;
        partner: string;
        history?: { speaker: string; text: string }[];
        purpose?: string;
        worldSummary: string;
        memories?: string[];
    };

    if (!npcId || !partner || !worldSummary) {
        res.status(400).json({ error: 'Missing npcId, partner, or worldSummary' });
        return;
    }

    try {
        const prompt = buildDialoguePrompt(
            npcId, worldSummary, partner, history ?? [], purpose, memories ?? [],
        );

        const response = await enqueue(Priority.DIALOGUE, {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 256,
            messages: [{ role: 'user', content: prompt }],
        });

        const parsed = parseJsonResponse(extractJsonText(response)) as Record<string, unknown>;

        res.json({
            dialogue: parsed.dialogue ?? '...',
            internalThought: parsed.internalThought,
            taskRequested: parsed.taskRequested ?? null,
        });
    } catch (err) {
        console.error('[Protocol/dialogue] Error:', err);
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
        const prompt = buildQuestionPrompt(npcId, proposal, worldSummary, memories ?? []);

        const response = await enqueue(Priority.REASONING, {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 512,
            messages: [{ role: 'user', content: prompt }],
        });

        const parsed = parseJsonResponse(extractJsonText(response)) as Record<string, unknown>;

        if (parsed.approved === true) {
            res.json({ approved: true });
        } else {
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
        console.error('[Protocol/evaluate-proposal] Error:', err);
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
        const prompt = buildRevisePrompt(npcId, originalProposal, question, worldSummary);

        const response = await enqueue(Priority.REASONING, {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
        });

        const parsed = parseJsonResponse(extractJsonText(response)) as Record<string, unknown>;

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
        console.error('[Protocol/revise] Error:', err);
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
        const prompt = buildRememberPrompt(npcId, taskContext, outcome);

        const response = await enqueue(Priority.BACKGROUND, {
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 256,
            messages: [{ role: 'user', content: prompt }],
        });

        const parsed = parseJsonResponse(extractJsonText(response)) as { lessons?: unknown[] };

        res.json({
            type: 'remember',
            id: `mem_${Date.now()}`,
            from: npcId,
            lessons: parsed.lessons ?? [],
        });
    } catch (err) {
        console.error('[Protocol/remember] Error:', err);
        res.status(500).json({ error: 'LLM call failed' });
    }
});

// ── Init & start ────────────────────────────────────────

const NPC_IDS = ['ada', 'bjorn', 'cora'];

async function start() {
    await Promise.all(NPC_IDS.map(id => initBuffer(id)));

    app.listen(PORT, () => {
        console.log(`[AgentWorld Server] Running on http://localhost:${PORT}`);
    });
}

if (process.env.NODE_ENV !== 'test') {
    start().catch(console.error);
}
