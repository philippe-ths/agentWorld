import Anthropic from '@anthropic-ai/sdk';
import { getAll, clear } from './ShortTermBuffer.js';
import { addMemory } from './LongTermMemory.js';
import { addRule } from './KnowledgeGraph.js';
import { buildReflectionPrompt, buildSelfCritiquePrompt, getPersona } from '../ai/PromptTemplates.js';
import { recordOutcome } from '../skills/SkillLibrary.js';

const client = new Anthropic({ maxRetries: 3 });

export async function reflect(npcId: string): Promise<void> {
    const observations = getAll(npcId);
    if (observations.length < 10) return; // Not enough to reflect on

    const events = observations.map(o => {
        const nearby = o.nearbyEntities.length > 0
            ? ` (near: ${o.nearbyEntities.join(', ')})`
            : '';
        return `[${new Date(o.timestamp).toLocaleTimeString()}] At (${o.position.x},${o.position.y})${nearby}: ${o.event}`;
    });

    const prompt = buildReflectionPrompt(events);

    try {
        const response = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 200,
            messages: [{ role: 'user', content: prompt }],
        });

        const textBlock = response.content.find(b => b.type === 'text');
        if (textBlock && textBlock.type === 'text') {
            const insights = textBlock.text.split('\n').filter(l => l.trim().length > 0);
            for (const insight of insights) {
                await addMemory(npcId, insight.replace(/^[-•*]\s*/, ''), 'insight', 0.7);
            }
        }
    } catch (err) {
        console.error('[Reflection] Error:', err);
    } finally {
        // Always clear buffer to avoid retrying the same observations indefinitely
        clear(npcId);
    }
}

// ── Self-critique: triggered by failures ─────────────────

export async function selfCritique(
    npcId: string,
    failureEvents: string[],
    context: { skill?: string; stuckCount?: number },
): Promise<void> {
    if (failureEvents.length === 0) return;

    const persona = getPersona(npcId);
    const prompt = buildSelfCritiquePrompt(persona, failureEvents, context);

    // Record skill failure
    if (context.skill) {
        await recordOutcome(context.skill, false);
    }

    try {
        const response = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 200,
            messages: [{ role: 'user', content: prompt }],
        });

        const textBlock = response.content.find(b => b.type === 'text');
        if (textBlock && textBlock.type === 'text') {
            const lessons = textBlock.text.split('\n').filter(l => l.trim().length > 0);
            for (const lesson of lessons) {
                const cleaned = lesson.replace(/^[-•*\d.)\s]+/, '');
                // Store as high-importance lesson (decays slower)
                await addMemory(npcId, cleaned, 'lesson', 0.9);
                // Also add as a world rule in the knowledge graph
                await addRule(npcId, cleaned);
            }
            console.log(`[SelfCritique] ${npcId} learned ${lessons.length} lesson(s)`);
        }
    } catch (err) {
        console.error('[SelfCritique] Error:', err);
    }
}
