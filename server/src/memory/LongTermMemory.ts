import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Memory, Observation, WorldBelief, TilePos, Goal } from '../types.js';
import { embed, cosineSimilarity } from './Embeddings.js';
import { trackGoalCompute } from '../goals/ResourceLedger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');

// Per-NPC write lock to prevent concurrent read-modify-write races
const locks = new Map<string, Promise<void>>();
function withLock<T>(npcId: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(npcId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    locks.set(npcId, next.then(() => {}, () => {}));
    return next;
}

async function ensureDataDir() {
    if (!existsSync(DATA_DIR)) {
        await mkdir(DATA_DIR, { recursive: true });
    }
}

function memoryFile(npcId: string): string {
    // Sanitize npcId to prevent path traversal
    const safe = npcId.replace(/[^a-z0-9_-]/gi, '_');
    return path.join(DATA_DIR, `${safe}_memory.json`);
}

async function loadMemories(npcId: string): Promise<Memory[]> {
    await ensureDataDir();
    const file = memoryFile(npcId);
    if (!existsSync(file)) return [];
    const data = await readFile(file, 'utf-8');
    return JSON.parse(data) as Memory[];
}

async function saveMemories(npcId: string, memories: Memory[]) {
    await ensureDataDir();
    await writeFile(memoryFile(npcId), JSON.stringify(memories, null, 2));
}

function goalContextKey(goal: Goal | undefined): string | undefined {
    if (!goal) return undefined;
    return `${goal.type}:${goal.description.toLowerCase()}`;
}

export function addMemory(
    npcId: string,
    text: string,
    type: Memory['type'],
    importance = 0.5,
    goalContext?: string,
) {
    return withLock(npcId, async () => {
    const memories = await loadMemories(npcId);
    let embedding: number[] | undefined;
    try {
        embedding = await embed(text);
    } catch (err) {
        console.warn('[LongTermMemory] Embedding failed, storing without vector:', err);
    }
    memories.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        text,
        type,
        importance,
        timestamp: Date.now(),
        accessCount: 0,
        embedding,
        goalContext,
    });
    await saveMemories(npcId, memories);
    });
}

export function getRelevantMemories(npcId: string, observation: Observation): Promise<string[]> {
    return withLock(npcId, async () => {
    const memories = await loadMemories(npcId);
    if (memories.length === 0) return [];

    const activeGoal = observation.activeGoals.find(g => g.status === 'active');
    const activeGoalContext = goalContextKey(activeGoal);

    // Build query text from observation context
    const queryParts: string[] = [];
    for (const e of observation.nearbyEntities) {
        queryParts.push(e.name);
    }
    for (const ev of observation.recentEvents) {
        queryParts.push(ev);
    }
    if (observation.currentSkill) queryParts.push(observation.currentSkill);
    for (const g of observation.activeGoals) {
        if (g.status === 'active') {
            queryParts.push(g.description, g.type);
        }
    }
    const queryText = queryParts.join('. ');

    // Try embedding-based retrieval first
    let queryEmbedding: number[] | undefined;
    try {
        if (queryText.length > 0) {
            if (activeGoal) {
                trackGoalCompute(activeGoal.id, npcId, { embeddingCalls: 1 });
            }
            queryEmbedding = await embed(queryText);
        }
    } catch {
        // Fall through to keyword matching
    }

    const scored = memories.map(m => {
        let score = m.importance;

        // Embedding similarity (primary signal)
        if (queryEmbedding && m.embedding) {
            score += cosineSimilarity(queryEmbedding, m.embedding) * 2;
        } else {
            // Keyword fallback when no embeddings
            const keywords: string[] = [];
            for (const e of observation.nearbyEntities) {
                keywords.push(e.name.toLowerCase());
            }
            for (const ev of observation.recentEvents) {
                keywords.push(...ev.toLowerCase().split(/\s+/));
            }
            const lower = m.text.toLowerCase();
            for (const kw of keywords) {
                if (lower.includes(kw)) score += 0.3;
            }
        }

        // Recency boost (Ebbinghaus-inspired curve)
        const ageHours = (Date.now() - m.timestamp) / (1000 * 60 * 60);
        score += Math.exp(-ageHours / 48); // half-life of ~48 hours

        // Access frequency boost (frequently retrieved = more useful)
        score += Math.min(m.accessCount * 0.05, 0.5);

        // Goal context boost for repeated-task learning.
        if (activeGoalContext && m.goalContext && m.goalContext === activeGoalContext) {
            score += 0.2;
        }

        m.accessCount++;
        return { memory: m, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Save updated access counts
    await saveMemories(npcId, memories);

    return scored.slice(0, 5).map(s => s.memory.text);
    });
}

export function decayMemories(npcId: string) {
    return withLock(npcId, async () => {
    const memories = await loadMemories(npcId);
    const now = Date.now();
    const decayed = memories
        .map(m => {
            // Access-frequency protection: frequently accessed memories decay slower
            const accessBoost = Math.min(m.accessCount * 0.005, 0.03);
            const decayRate = Math.max(0.92, 0.95 - accessBoost); // 5%-8% decay

            // Lesson-type memories decay 50% slower (hard-won knowledge)
            const typeMultiplier = m.type === 'lesson' ? 0.975 : decayRate;

            // Age-based acceleration: very old memories decay faster
            const ageHours = (now - m.timestamp) / (1000 * 60 * 60);
            const ageFactor = ageHours > 168 ? 0.98 : 1; // extra decay after 1 week

            return {
                ...m,
                importance: m.importance * typeMultiplier * ageFactor,
            };
        })
        .filter(m => m.importance > 0.05);

    await saveMemories(npcId, decayed);
    });
}

// ── World beliefs persistence ────────────────────────────

function beliefFile(npcId: string): string {
    const safe = npcId.replace(/[^a-z0-9_-]/gi, '_');
    return path.join(DATA_DIR, `${safe}_beliefs.json`);
}

function defaultBeliefs(): WorldBelief {
    return { knownEntities: {}, visitedAreas: [], insights: [] };
}

export async function loadBeliefs(npcId: string): Promise<WorldBelief> {
    await ensureDataDir();
    const file = beliefFile(npcId);
    if (!existsSync(file)) return defaultBeliefs();
    const data = await readFile(file, 'utf-8');
    return JSON.parse(data) as WorldBelief;
}

export async function saveBeliefs(npcId: string, beliefs: WorldBelief) {
    await ensureDataDir();
    await writeFile(beliefFile(npcId), JSON.stringify(beliefs, null, 2));
}

export function updateBeliefs(
    npcId: string,
    updates: { entities?: Record<string, { relationship: string; lastSeen?: TilePos }>; insights?: string[] },
) {
    return withLock(npcId, async () => {
    const beliefs = await loadBeliefs(npcId);

    if (updates.entities) {
        for (const [name, data] of Object.entries(updates.entities)) {
            beliefs.knownEntities[name] = {
                lastSeen: data.lastSeen ?? beliefs.knownEntities[name]?.lastSeen ?? { x: 0, y: 0 },
                relationship: data.relationship,
            };
        }
    }

    if (updates.insights) {
        for (const insight of updates.insights) {
            if (!beliefs.insights.includes(insight)) {
                beliefs.insights.push(insight);
            }
        }
    }

    await saveBeliefs(npcId, beliefs);
    });
}
