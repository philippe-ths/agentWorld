import type { NPC } from '../entities/NPC';
import type { EntityManager } from '../entities/EntityManager';
import type { Action } from './types';
import { findPath } from './Pathfinding';
import { MAP_WIDTH, MAP_HEIGHT } from '../MapData';
import { log as logEvent } from '../ui/EventLog';

// Composed skill definitions received from server
const composedSkills = new Map<string, string[]>();

export function registerComposedSkill(name: string, steps: string[]) {
    composedSkills.set(name, steps);
}

export function executeSkill(
    npc: NPC,
    skill: string,
    params: Record<string, unknown>,
    entityManager: EntityManager,
): Action[] {
    // Check if it's a composed skill
    const steps = composedSkills.get(skill);
    if (steps) {
        const allActions: Action[] = [];
        for (const step of steps) {
            allActions.push(...executeSkill(npc, step, params, entityManager));
        }
        logEvent(npc.name, 'action', `composed skill "${skill}" → ${allActions.length} actions (${steps.join(' → ')})`,
            { npcId: npc.id });
        return allActions;
    }

    let actions: Action[];
    switch (skill) {
        case 'wander':
            actions = wanderActions(npc, entityManager);
            break;
        case 'move_to':
            actions = moveToActions(npc, params, entityManager);
            break;
        case 'approach_entity':
            actions = approachActions(npc, params, entityManager);
            break;
        case 'idle':
            actions = idleActions(params);
            break;
        default:
            actions = idleActions({ duration: 2000 });
            break;
    }

    // Log the generated plan
    const desc = summarizeActions(skill, actions, params);
    logEvent(npc.name, 'action', desc, { npcId: npc.id });

    return actions;
}

function summarizeActions(skill: string, actions: Action[], params: Record<string, unknown>): string {
    if (skill === 'wander') {
        const moves = actions.filter(a => a.type === 'move');
        if (moves.length > 0) {
            const last = moves[moves.length - 1] as { target: { x: number; y: number } };
            return `wander → ${moves.length}-tile path to (${last.target.x},${last.target.y})`;
        }
        return 'wander → idle (no path found)';
    }
    if (skill === 'move_to') {
        const moves = actions.filter(a => a.type === 'move');
        return `move_to (${params.targetX},${params.targetY}) → ${moves.length}-tile path`;
    }
    if (skill === 'approach_entity') {
        const moves = actions.filter(a => a.type === 'move');
        return `approach ${params.entityName} → ${moves.length}-tile path`;
    }
    if (skill === 'idle') {
        return `idle for ${params.duration ?? 3000}ms`;
    }
    return `${skill} → ${actions.length} actions`;
}

function wanderActions(npc: NPC, entityManager: EntityManager): Action[] {
    // Pick a random walkable tile within ~10 tiles
    const range = 10;
    for (let attempt = 0; attempt < 20; attempt++) {
        const tx = npc.tilePos.x + Math.floor(Math.random() * range * 2) - range;
        const ty = npc.tilePos.y + Math.floor(Math.random() * range * 2) - range;

        if (tx < 0 || tx >= MAP_WIDTH || ty < 0 || ty >= MAP_HEIGHT) continue;
        if (!entityManager.isWalkable(tx, ty)) continue;

        const activeGoal = npc.activeGoals.find(g => g.status === 'active');
        if (activeGoal) activeGoal.resources.pathfindingCalls++;
        const path = findPath(npc.tilePos, { x: tx, y: ty }, entityManager.isWalkable);
        if (path.length > 0 && path.length <= 15) {
            return path.map(p => ({ type: 'move' as const, target: p }));
        }
    }
    // Couldn't find a path — idle instead
    return [{ type: 'wait', duration: 2000 + Math.random() * 3000 }];
}

function moveToActions(
    npc: NPC,
    params: Record<string, unknown>,
    entityManager: EntityManager,
): Action[] {
    const targetX = typeof params.targetX === 'number' ? params.targetX : npc.tilePos.x;
    const targetY = typeof params.targetY === 'number' ? params.targetY : npc.tilePos.y;

    const activeGoal = npc.activeGoals.find(g => g.status === 'active');
    if (activeGoal) activeGoal.resources.pathfindingCalls++;
    const path = findPath(npc.tilePos, { x: targetX, y: targetY }, entityManager.isWalkable);
    if (path.length > 0) {
        return path.map(p => ({ type: 'move' as const, target: p }));
    }
    return [{ type: 'wait', duration: 1000 }];
}

function approachActions(
    npc: NPC,
    params: Record<string, unknown>,
    entityManager: EntityManager,
): Action[] {
    const targetName = typeof params.entityName === 'string' ? params.entityName : '';
    const entities = entityManager.getAll();
    const target = entities.find(e => e.name.toLowerCase() === targetName.toLowerCase());

    if (!target) return [{ type: 'wait', duration: 1000 }];

    // Find a walkable tile adjacent to the target
    const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
    for (const d of dirs) {
        const ax = target.tilePos.x + d.x;
        const ay = target.tilePos.y + d.y;
        if (entityManager.isWalkable(ax, ay)) {
            const activeGoal = npc.activeGoals.find(g => g.status === 'active');
            if (activeGoal) activeGoal.resources.pathfindingCalls++;
            const path = findPath(npc.tilePos, { x: ax, y: ay }, entityManager.isWalkable);
            if (path.length > 0) {
                return path.map(p => ({ type: 'move' as const, target: p }));
            }
        }
    }
    return [{ type: 'wait', duration: 1000 }];
}

function idleActions(params: Record<string, unknown>): Action[] {
    const duration = typeof params.duration === 'number' ? params.duration : 3000;
    return [{ type: 'wait', duration }];
}
