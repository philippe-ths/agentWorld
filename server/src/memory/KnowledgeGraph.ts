import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { TilePos } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');

// ── Types ────────────────────────────────────────────────

export interface KGEntity {
    name: string;
    type: string;                    // 'npc' | 'location' | 'object' | 'concept'
    properties: Record<string, string>;
    lastSeen?: TilePos;
    lastUpdated: number;
}

export interface KGRelation {
    from: string;                    // entity name
    to: string;                      // entity name
    type: string;                    // e.g. 'friend_of', 'near', 'afraid_of'
    strength: number;                // 0-1
    evidence: string;                // why we believe this
    lastUpdated: number;
}

export interface KnowledgeGraphData {
    entities: Record<string, KGEntity>;
    relations: KGRelation[];
    rules: string[];                 // learned world rules, e.g. "water is not walkable"
}

// ── Persistence ──────────────────────────────────────────

// Per-NPC write lock to prevent concurrent read/write races
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

function kgFile(npcId: string): string {
    const safe = npcId.replace(/[^a-z0-9_-]/gi, '_');
    return path.join(DATA_DIR, `${safe}_kg.json`);
}

function emptyGraph(): KnowledgeGraphData {
    return { entities: {}, relations: [], rules: [] };
}

export async function loadGraph(npcId: string): Promise<KnowledgeGraphData> {
    await ensureDataDir();
    const file = kgFile(npcId);
    if (!existsSync(file)) return emptyGraph();
    const data = await readFile(file, 'utf-8');
    return JSON.parse(data) as KnowledgeGraphData;
}

async function saveGraph(npcId: string, graph: KnowledgeGraphData) {
    await ensureDataDir();
    await writeFile(kgFile(npcId), JSON.stringify(graph, null, 2));
}

// ── Mutations ────────────────────────────────────────────

export async function upsertEntity(
    npcId: string,
    name: string,
    type: string,
    properties: Record<string, string>,
    lastSeen?: TilePos,
) {
    return withLock(npcId, async () => {
        const graph = await loadGraph(npcId);
        const existing = graph.entities[name];
        graph.entities[name] = {
            name,
            type,
            properties: { ...existing?.properties, ...properties },
            lastSeen: lastSeen ?? existing?.lastSeen,
            lastUpdated: Date.now(),
        };
        await saveGraph(npcId, graph);
    });
}

export async function upsertRelation(
    npcId: string,
    from: string,
    to: string,
    type: string,
    strength: number,
    evidence: string,
) {
    return withLock(npcId, async () => {
        const graph = await loadGraph(npcId);
        const existing = graph.relations.find(
            r => r.from === from && r.to === to && r.type === type,
        );
        if (existing) {
            existing.strength = strength;
            existing.evidence = evidence;
            existing.lastUpdated = Date.now();
        } else {
            graph.relations.push({ from, to, type, strength, evidence, lastUpdated: Date.now() });
        }
        await saveGraph(npcId, graph);
    });
}

export async function addRule(npcId: string, rule: string) {
    return withLock(npcId, async () => {
        const graph = await loadGraph(npcId);
        if (!graph.rules.includes(rule)) {
            graph.rules.push(rule);
            await saveGraph(npcId, graph);
        }
    });
}

// ── Queries ──────────────────────────────────────────────

export async function getEntityInfo(npcId: string, entityName: string): Promise<KGEntity | undefined> {
    const graph = await loadGraph(npcId);
    return graph.entities[entityName];
}

export async function getRelationsFor(npcId: string, entityName: string): Promise<KGRelation[]> {
    const graph = await loadGraph(npcId);
    return graph.relations.filter(r => r.from === entityName || r.to === entityName);
}

export async function summarizeKnowledge(npcId: string): Promise<string> {
    const graph = await loadGraph(npcId);
    const parts: string[] = [];

    const entityNames = Object.keys(graph.entities);
    if (entityNames.length > 0) {
        parts.push('Known entities:');
        for (const name of entityNames) {
            const e = graph.entities[name];
            const props = Object.entries(e.properties).map(([k, v]) => `${k}: ${v}`).join(', ');
            parts.push(`  - ${name} (${e.type})${props ? ': ' + props : ''}`);
        }
    }

    if (graph.relations.length > 0) {
        parts.push('Relationships:');
        for (const r of graph.relations) {
            parts.push(`  - ${r.from} → ${r.type} → ${r.to} (${(r.strength * 100).toFixed(0)}%)`);
        }
    }

    if (graph.rules.length > 0) {
        parts.push('Learned rules:');
        for (const rule of graph.rules) {
            parts.push(`  - ${rule}`);
        }
    }

    return parts.join('\n');
}
