import { HeadlessNPC, WalkResult } from './HeadlessEntity';
import { HeadlessEntityManager } from './HeadlessEntityManager';
import { ChronologicalLog } from '../game/ChronologicalLog';
import { GoalManager } from '../game/GoalManager';
import { ToolRegistry } from '../game/ToolRegistry';
import { Directive } from '../game/DirectiveParser';
import { isAdjacentToBuilding } from '../game/MapData';
import { ReflectionEvent } from '../game/ReflectionManager';
import { isFeatureEnabled } from '../game/GameConfig';

export type GoalExecutionResult =
    | { type: 'completed_goal'; goal: string }
    | { type: 'abandoned_goal'; goal: string }
    | { type: 'switched_goal'; oldGoal: string; newGoal: string }
    | null;

export interface ActionExecutionResult {
    shouldStop: boolean;
    reflectionEvent?: ReflectionEvent;
}

/**
 * Headless directive executor — handles action directives without Phaser.
 * Mirrors the real DirectiveExecutor's executeAction() return shape.
 */
export class HeadlessDirectiveExecutor {
    private toolRegistry: ToolRegistry;

    constructor(toolRegistry: ToolRegistry, _entityManager: HeadlessEntityManager) {
        this.toolRegistry = toolRegistry;
    }

    async executeGoal(
        _npcName: string, dir: Directive, log: ChronologicalLog, goalManager: GoalManager,
    ): Promise<GoalExecutionResult> {
        switch (dir.type) {
            case 'complete_goal': {
                const result = goalManager.completeGoal();
                if (result) {
                    log.recordAction(`Completed goal: ${result.completed}`);
                    if (result.promoted) {
                        log.recordAction(`New goal: ${result.promoted.goal} (source: ${result.promoted.source})`);
                    }
                    return { type: 'completed_goal', goal: result.completed };
                }
                break;
            }
            case 'abandon_goal': {
                const result = goalManager.abandonGoal();
                if (result) {
                    log.recordAction(`Abandoned goal: ${result.abandoned}`);
                    if (result.promoted) {
                        log.recordAction(`New goal: ${result.promoted.goal} (source: ${result.promoted.source})`);
                    }
                    return { type: 'abandoned_goal', goal: result.abandoned };
                }
                break;
            }
            case 'switch_goal': {
                const result = goalManager.switchGoal();
                if (result) {
                    log.recordAction(`Abandoned goal: ${result.abandoned}`);
                    log.recordAction(`New goal: ${result.newGoal.goal} (source: ${result.newGoal.source})`);
                    return { type: 'switched_goal', oldGoal: result.abandoned, newGoal: result.newGoal.goal };
                }
                break;
            }
        }
        return null;
    }

    async executeAction(
        npc: HeadlessNPC, dir: Directive, log: ChronologicalLog, turnNumber: number,
    ): Promise<ActionExecutionResult> {
        switch (dir.type) {
            case 'move_to': {
                const result: WalkResult = await npc.walkToAsync({ x: dir.x, y: dir.y });
                if (result.reached) {
                    log.recordAction(`→ reached (${npc.tilePos.x},${npc.tilePos.y})`);
                    return {
                        shouldStop: false,
                        reflectionEvent: {
                            turnNumber,
                            kind: 'success',
                            summary: `Reached (${npc.tilePos.x},${npc.tilePos.y})`,
                            successPattern: 'Reaching reachable destinations by moving directly',
                        },
                    };
                } else if (result.reason === 'no_path') {
                    log.recordAction(`→ failed: no path to (${dir.x},${dir.y}), stayed at (${npc.tilePos.x},${npc.tilePos.y})`);
                    return {
                        shouldStop: false,
                        reflectionEvent: {
                            turnNumber,
                            kind: 'failure',
                            summary: `Could not path to (${dir.x},${dir.y})`,
                            obstacleKey: `no_path:(${dir.x},${dir.y})`,
                        },
                    };
                } else {
                    log.recordAction(`→ failed: path blocked, ended up at (${npc.tilePos.x},${npc.tilePos.y})`);
                    return {
                        shouldStop: false,
                        reflectionEvent: {
                            turnNumber,
                            kind: 'failure',
                            summary: `Path blocked while moving to (${dir.x},${dir.y})`,
                            obstacleKey: `blocked_path:(${dir.x},${dir.y})`,
                        },
                    };
                }
            }
            case 'wait':
                log.recordAction('→ waited');
                return { shouldStop: false };

            case 'start_conversation_with': {
                // In headless eval, conversations are no-ops — NPC notes the attempt
                if (!isFeatureEnabled('conversations')) {
                    log.recordAction('→ start_conversation_with rejected: conversations are disabled');
                    return { shouldStop: false };
                }
                log.recordAction(`→ conversation with ${dir.targetName} skipped (headless mode)`);
                return { shouldStop: true };
            }

            case 'use_tool': {
                const building = this.toolRegistry.getById(dir.toolId);
                if (!building || !this.toolRegistry.getVisible().some(b => b.id === dir.toolId)) {
                    log.recordAction(`→ failed: unknown tool "${dir.toolId}"`);
                    return {
                        shouldStop: false,
                        reflectionEvent: {
                            turnNumber,
                            kind: 'failure',
                            summary: `Unknown tool: ${dir.toolId}`,
                            obstacleKey: `unknown_tool:${dir.toolId}`,
                        },
                    };
                }
                if (!isAdjacentToBuilding(npc.tilePos, building)) {
                    log.recordAction(`→ failed: not adjacent to ${building.displayName} at (${building.tile.x},${building.tile.y})`);
                    return {
                        shouldStop: false,
                        reflectionEvent: {
                            turnNumber,
                            kind: 'failure',
                            summary: `Not adjacent to ${building.displayName}`,
                            obstacleKey: `not_adjacent_tool:${dir.toolId}`,
                        },
                    };
                }
                try {
                    const result = await building.execute(dir.args);
                    log.recordAction(`→ result: ${result}`);
                    return {
                        shouldStop: true,
                        reflectionEvent: {
                            turnNumber,
                            kind: 'success',
                            summary: `Used ${building.displayName} successfully`,
                            successPattern: `Approaching ${building.displayName} before using it works`,
                        },
                    };
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    log.recordAction(`→ failed: ${msg}`);
                    return {
                        shouldStop: true,
                        reflectionEvent: {
                            turnNumber,
                            kind: 'failure',
                            summary: `Tool execution failed for ${building.displayName}`,
                            obstacleKey: `tool_execution_failed:${dir.toolId}`,
                        },
                    };
                }
            }

            case 'sleep':
                return { shouldStop: true };

            case 'end_conversation':
                return { shouldStop: false };

            default:
                if (dir.type === 'unknown') {
                    log.recordAction(`→ unknown command: "${dir.line}"`);
                }
                return { shouldStop: false };
        }
    }
}
