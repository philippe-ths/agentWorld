import type { NPC } from '../entities/NPC';
import type { EntityManager } from '../entities/EntityManager';
import type { Action } from './types';

export function executeSkill(
    _npc: NPC, _skill: string, _params: Record<string, unknown>, _entityManager: EntityManager,
): Action[] {
    return [{ type: 'wait', duration: 2000 }];
}
