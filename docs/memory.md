# Memory System

All memory is **per-NPC** and persisted to JSON files in `server/data/`.

## Short-Term Buffer

`ShortTermBuffer.ts` — rolling buffer of the last 50 observations.

Each entry records: timestamp, tile position, nearby entity names, and current event.  
Cleared after each reflection cycle.

## Long-Term Memory

`LongTermMemory.ts` — vector-indexed memory store.

- **Storage**: each memory has text, type (`observation | insight | lesson`), importance (0–1), timestamp, access count, and an embedding vector.
- **Retrieval**: queries are embedded with `all-MiniLM-L6-v2`; memories are scored by cosine similarity + recency (48 h half-life) + access frequency.
- **Decay**: runs every 10 ticks. Importance decays 5–8 % per cycle. `lesson`-type memories decay 50 % slower. Memories below 0.05 importance are pruned.
- **Concurrency**: per-NPC write locks prevent read-modify-write races.

## Knowledge Graph

`KnowledgeGraph.ts` — stores entities, relations, and world rules per NPC.

- `upsertEntity` — tracks entity type, properties, last-seen position.
- `upsertRelation` — directed edges with label, confidence, and source tag.
- `addRule` — free-text world rules (max 20) learned from stuck events and self-critique.

## Reflection

`Reflection.ts` — runs every 10 ticks (Haiku). Summarises the short-term buffer into insight memories (importance 0.7).

## Self-Critique

Triggered by failure events. Haiku generates lessons (importance 0.9, slow decay) and world rules. Also records skill failure for outcome tracking.

## World Beliefs

`WorldBelief` — high-level beliefs about known entities (relationship, last-seen position) and general insights. Updated by the slow loop's reasoning result.
