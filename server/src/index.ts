import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { mediumLoopTick } from './ai/MediumLoop.js';
import { generateDialogue, generateReasoning, evaluateGoalProgress } from './ai/SlowLoop.js';
import { addObservation, initBuffer } from './memory/ShortTermBuffer.js';
import { reflect, selfCritique } from './memory/Reflection.js';
import { decayMemories, updateBeliefs } from './memory/LongTermMemory.js';
import { upsertEntity, upsertRelation, loadGraph, addRule } from './memory/KnowledgeGraph.js';
import { loadLearnedSkills, addSkill, recordOutcome } from './skills/SkillLibrary.js';
import type { Observation, ReasoningRequest, GoalEvaluationRequest, CommitmentRequest } from './types.js';
import {
    initResourceLedger,
    trackGoalUsage,
    syncGoalComputeTotals,
    getAggregateResourceStats,
} from './goals/ResourceLedger.js';

export const app = express();
const PORT = 3001;

app.use(cors({ origin: ['http://localhost:8080', 'http://127.0.0.1:8080'] }));
app.use(express.json());

// Track tick count per NPC for periodic reflection
const tickCounts = new Map<string, number>();

// ── Medium loop: skill selection ─────────────────────────

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

    // World model correction: check if observations contradict known beliefs
    correctWorldModel(observation.npcId, observation).catch(console.error);

    // Periodic reflection + decay (every 10 ticks)
    const count = (tickCounts.get(observation.npcId) ?? 0) + 1;
    tickCounts.set(observation.npcId, count);
    if (count % 10 === 0) {
        const activeGoal = observation.activeGoals.find(g => g.status === 'active');
        reflect(observation.npcId, {
            activeGoals: observation.activeGoals
                .filter(g => g.status === 'active')
                .map(g => `${g.description} (p=${g.priority.toFixed(2)})`),
            recentOutcomes: observation.activeGoals
                .filter(g => g.status !== 'active')
                .map(g => `${g.description}: ${g.status}`),
            goalContext: activeGoal ? `${activeGoal.type}:${activeGoal.description.toLowerCase()}` : undefined,
        }).catch(console.error);
        decayMemories(observation.npcId).catch(console.error);
    }

    const result = await mediumLoopTick(observation);

    const activeGoal = observation.activeGoals.find(g => g.status === 'active');
    if (activeGoal) {
        trackGoalUsage(activeGoal.id, observation.npcId, result.llmUsage, 'haiku');
        syncGoalComputeTotals(activeGoal.id, observation.npcId, {
            embeddingCalls: activeGoal.resources.embeddingCalls,
            pathfindingCalls: activeGoal.resources.pathfindingCalls,
        });
    }

    res.json(result);
});

// ── Slow loop: reasoning & dialogue ──────────────────────

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

            // Also update KG relations
            if (beliefs.entities) {
                for (const [name, data] of Object.entries(beliefs.entities)) {
                    upsertRelation(
                        request.npcId, request.observation.name, name,
                        data.relationship, 0.8, 'from reasoning',
                    ).catch(console.error);
                }
            }
        }

        // Register new skill if the reasoning produced one
        if (result.newSkill) {
            addSkill(
                result.newSkill.name,
                result.newSkill.description,
                result.newSkill.steps,
                result.newSkill.preconditions,
            ).catch(console.error);
        }
    } else {
        result = await generateDialogue(
            request.npcId,
            request.observation,
            request.conversationHistory ?? [],
            request.partnerName ?? 'someone',
        );
    }

    const activeGoal = request.observation.activeGoals.find(g => g.status === 'active');
    if (activeGoal) {
        trackGoalUsage(activeGoal.id, request.npcId, result.llmUsage, 'sonnet');
    }

    res.json(result);
});

// ── Health check ─────────────────────────────────────────

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
});

app.get('/api/stats/resources', (_req, res) => {
    res.json(getAggregateResourceStats());
});
// ── Failure reporting: triggers self-critique ────────────

app.post('/api/npc/failure', async (req, res) => {
    const { npcId, failureEvents, skill, stuckCount, goalDescription, goalContext, evaluationCriteria, outcome, resourceCost } = req.body as {
        npcId: string;
        failureEvents: string[];
        skill?: string;
        stuckCount?: number;
        goalDescription?: string;
        goalContext?: string;
        evaluationCriteria?: string;
        outcome?: string;
        resourceCost?: string;
    };

    if (!npcId || !failureEvents?.length) {
        res.status(400).json({ error: 'Invalid failure report' });
        return;
    }

    // Fire self-critique asynchronously — don't block response
    selfCritique(npcId, failureEvents, {
        skill,
        stuckCount,
        goalDescription,
        goalContext,
        evaluationCriteria,
        outcome,
        resourceCost,
    }).catch(console.error);

    res.json({ status: 'accepted' });
});

// ── Skill outcome reporting ─────────────────────────────

app.post('/api/npc/skill-outcome', async (req, res) => {
    const { skill, success } = req.body as {
        skill: string;
        success: boolean;
    };

    if (!skill || typeof success !== 'boolean') {
        res.status(400).json({ error: 'Invalid outcome' });
        return;
    }

    await recordOutcome(skill, success);
    res.json({ status: 'recorded' });
});

// ── Goal evaluation (phase 2) ──────────────────────────

app.post('/api/npc/goal/evaluate', async (req, res) => {
    const request = req.body as GoalEvaluationRequest;

    if (!request?.npcId || !request?.observation || !request?.goal) {
        res.status(400).json({ error: 'Invalid goal evaluation request' });
        return;
    }

    const result = await evaluateGoalProgress(request.npcId, request.observation, request.goal);
    trackGoalUsage(request.goal.id, request.npcId, result.llmUsage, 'evaluation');
    res.json(result);
});

app.post('/api/npc/commitment', async (req, res) => {
    const request = req.body as CommitmentRequest;
    if (!request?.npcId || !request?.from || !request?.to || !request?.goalId || !request?.description) {
        res.status(400).json({ error: 'Invalid commitment request' });
        return;
    }

    await upsertRelation(
        request.npcId,
        request.from,
        request.to,
        'committed_to',
        request.status === 'failed' ? 0.4 : 0.9,
        `${request.status}: ${request.goalId} :: ${request.description}`,
    );

    res.json({ status: 'recorded' });
});

// ── World model correction ─────────────────────────────

async function correctWorldModel(npcId: string, observation: Observation) {
    const graph = await loadGraph(npcId);

    for (const entity of observation.nearbyEntities) {
        const known = graph.entities[entity.name];
        if (!known?.lastSeen) continue;

        // Check if entity moved significantly from where we last saw it
        const dx = Math.abs(entity.position.x - known.lastSeen.x);
        const dy = Math.abs(entity.position.y - known.lastSeen.y);
        if (dx + dy > 10) {
            // Entity has moved far — update knowledge and note the correction
            await upsertEntity(
                npcId, entity.name, known.type,
                { ...known.properties, last_known_behavior: 'mobile' },
                entity.position,
            );
        }
    }

    // Check if any recent events contradict known rules
    for (const event of observation.recentEvents) {
        const lower = event.toLowerCase();

        // If stuck while moving, learn about obstacles
        if (lower.includes('stuck')) {
            const pos = observation.position;
            const rule = `Area around (${pos.x},${pos.y}) may have obstacles`;
            // Only add if we don't have too many area rules already
            const existingAreaRules = graph.rules.filter(r => r.includes('Area around'));
            if (existingAreaRules.length < 10) {
                await addRule(npcId, rule);
            }
        }
    }
}
// ── Init & start ────────────────────────────────────────

const NPC_IDS = ['ada', 'bjorn', 'cora'];

async function start() {
    // Restore short-term buffers from disk
    await Promise.all(NPC_IDS.map(id => initBuffer(id)));
    // Load any previously learned skills
    await loadLearnedSkills();
    // Restore persisted resource usage ledger
    await initResourceLedger();

    app.listen(PORT, () => {
        console.log(`[AgentWorld Server] Running on http://localhost:${PORT}`);
    });
}

// Only auto-start when not running under test
if (process.env.NODE_ENV !== 'test') {
    start().catch(console.error);
}
