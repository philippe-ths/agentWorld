import type { WorldQuery } from '../world/WorldQuery';

/** All condition types that can be checked mechanically. */
export type Condition =
  | { type: 'entity_adjacent'; entity: string; to: string }
  | { type: 'entity_within_range'; entity: string; of: string; range: number }
  | { type: 'entity_at_position'; entity: string; x: number; y: number; tolerance: number }
  | { type: 'all_within_range'; entities: string[]; of: string; range: number }
  | { type: 'timer_expired'; startTime: number; durationMs: number }
  | { type: 'flag_set'; flag: string }
  | { type: 'and'; conditions: Condition[] }
  | { type: 'or'; conditions: Condition[] }
  | { type: 'not'; condition: Condition }
  | { type: 'always_true' }
  | { type: 'always_false' };

/** A mutable set of flags that NPCs can set/check mechanically. */
const flags = new Map<string, boolean>();

export function setFlag(flag: string, value = true) { flags.set(flag, value); }
export function clearFlag(flag: string) { flags.delete(flag); }
export function clearAllFlags() { flags.clear(); }

/** Evaluate a condition against current world state. Pure function (plus flags). */
export function evaluate(condition: Condition, world: WorldQuery): boolean {
  switch (condition.type) {
    case 'always_true': return true;
    case 'always_false': return false;

    case 'entity_adjacent':
      return world.isEntityAdjacent(condition.entity, condition.to);

    case 'entity_within_range':
      return world.isEntityWithinRange(condition.entity, condition.of, condition.range);

    case 'entity_at_position': {
      const pos = world.getEntityPosition(condition.entity);
      if (!pos) return false;
      const dx = Math.abs(pos.x - condition.x);
      const dy = Math.abs(pos.y - condition.y);
      return dx <= condition.tolerance && dy <= condition.tolerance;
    }

    case 'all_within_range':
      return condition.entities.every(name =>
        world.isEntityWithinRange(name, condition.of, condition.range)
      );

    case 'timer_expired':
      return Date.now() >= condition.startTime + condition.durationMs;

    case 'flag_set':
      return flags.get(condition.flag) === true;

    case 'and':
      return condition.conditions.every(c => evaluate(c, world));

    case 'or':
      return condition.conditions.some(c => evaluate(c, world));

    case 'not':
      return !evaluate(condition.condition, world);
  }
}

/** Serialize a condition to human-readable text (for LLM prompts / logging). */
export function conditionToText(condition: Condition): string {
  switch (condition.type) {
    case 'always_true': return 'always';
    case 'always_false': return 'never';
    case 'entity_adjacent': return `${condition.entity} is adjacent to ${condition.to}`;
    case 'entity_within_range': return `${condition.entity} is within ${condition.range} tiles of ${condition.of}`;
    case 'entity_at_position': return `${condition.entity} is at (${condition.x}, ${condition.y})`;
    case 'all_within_range': return `all of [${condition.entities.join(', ')}] are within ${condition.range} tiles of ${condition.of}`;
    case 'timer_expired': return `${condition.durationMs}ms have elapsed`;
    case 'flag_set': return `flag "${condition.flag}" is set`;
    case 'and': return condition.conditions.map(conditionToText).join(' AND ');
    case 'or': return condition.conditions.map(conditionToText).join(' OR ');
    case 'not': return `NOT (${conditionToText(condition.condition)})`;
  }
}
