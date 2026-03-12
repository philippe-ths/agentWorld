import { NPC, WalkResult } from './entities/NPC';
import { ChronologicalLog } from './ChronologicalLog';
import { GoalManager } from './GoalManager';
import { ConversationManager } from './ConversationManager';
import { ToolRegistry } from './ToolRegistry';
import { Directive } from './DirectiveParser';
import { isAdjacentToBuilding } from './MapData';
import { ReflectionEvent } from './ReflectionManager';

export type GoalExecutionResult =
    | { type: 'completed_goal'; goal: string }
    | { type: 'abandoned_goal'; goal: string }
    | { type: 'switched_goal'; oldGoal: string; newGoal: string }
    | null;

export interface ActionExecutionResult {
    shouldStop: boolean;
    reflectionEvent?: ReflectionEvent;
}

export class DirectiveExecutor {
    private conversationManager!: ConversationManager;
    private toolRegistry: ToolRegistry;

    constructor(toolRegistry: ToolRegistry) {
        this.toolRegistry = toolRegistry;
    }

    setConversationManager(cm: ConversationManager): void {
        this.conversationManager = cm;
    }

    /** Execute a goal directive (instant, no budget cost). */
    async executeGoal(
        npc: NPC, dir: Directive, log: ChronologicalLog, goalManager: GoalManager,
    ): Promise<GoalExecutionResult> {
        switch (dir.type) {
            case 'complete_goal': {
                const result = goalManager.completeGoal();
                if (result) {
                    console.log(`%c[${npc.name}] complete_goal()`, 'color: #6bff6b');
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
                    console.log(`%c[${npc.name}] abandon_goal()`, 'color: #ffaa00');
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
                    console.log(`%c[${npc.name}] switch_goal()`, 'color: #ff9f43');
                    log.recordAction(`Abandoned goal: ${result.abandoned}`);
                    log.recordAction(`New goal: ${result.newGoal.goal} (source: ${result.newGoal.source})`);
                    return { type: 'switched_goal', oldGoal: result.abandoned, newGoal: result.newGoal.goal };
                }
                break;
            }
        }

        return null;
    }

    /** Execute an action directive. Returns true if the turn should end immediately. */
    async executeAction(
        npc: NPC, dir: Directive, log: ChronologicalLog, turnNumber: number,
    ): Promise<ActionExecutionResult> {
        switch (dir.type) {
            case 'move_to': {
                console.log(`%c[${npc.name}] move_to(${dir.x}, ${dir.y})`, 'color: #6bff6b');
                const result: WalkResult = await npc.walkToAsync({ x: dir.x, y: dir.y });
                if (result.reached) {
                    log.recordAction(`I moved to (${npc.tilePos.x},${npc.tilePos.y})`);
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
                    log.recordAction(`I couldn't find a path to (${dir.x},${dir.y}), I stayed at (${npc.tilePos.x},${npc.tilePos.y})`);
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
                    log.recordAction(`I tried to reach (${dir.x},${dir.y}) but the path was blocked, I ended up at (${npc.tilePos.x},${npc.tilePos.y})`);
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
                console.log(`%c[${npc.name}] wait()`, 'color: #aaa');
                await delay(300);
                log.recordAction('I waited');
                return { shouldStop: false };
            case 'start_conversation_with':
                console.log(`%c[${npc.name}] start_conversation_with(${dir.targetName}, ${dir.message})`, 'color: #ff9f43');
                log.recordAction(`I started a conversation with ${dir.targetName}`);
                await this.conversationManager.startNpcConversation(
                    npc, dir.targetName, dir.message, turnNumber,
                );
                return {
                    shouldStop: true,
                    reflectionEvent: {
                        turnNumber,
                        kind: 'success',
                        summary: `Started a conversation with ${dir.targetName}`,
                        successPattern: 'Using conversation to gather or hand off information',
                    },
                };
            case 'use_tool': {
                const building = this.toolRegistry.getById(dir.toolId);
                if (!building) {
                    console.warn(`%c[${npc.name}] use_tool: unknown tool "${dir.toolId}"`, 'color: #ffaa00');
                    log.recordAction(`I tried to use unknown tool "${dir.toolId}"`);
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
                    console.log(`%c[${npc.name}] use_tool(${dir.toolId}) — not adjacent`, 'color: #ffaa00');
                    log.recordAction(`I tried to use ${building.displayName} but I'm not close enough — I need to be adjacent to (${building.tile.x},${building.tile.y})`);
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
                console.log(`%c[${npc.name}] use_tool(${dir.toolId}, "${dir.args}")`, 'color: #6bff6b');
                log.recordAction(`I used ${building.displayName}: "${dir.args}"`);
                try {
                    const result = await building.execute(dir.args);
                    log.recordAction(`Result: ${result}`);
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
                    console.warn(`%c[${npc.name}] use_tool error: ${msg}`, 'color: #ffaa00');
                    log.recordAction(`The tool execution failed: ${msg}`);
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
                // Handled by TurnManager after directive loop
                return { shouldStop: true };
            case 'end_conversation':
                console.warn(`%c[${npc.name}] end_conversation() used outside conversation`, 'color: #ffaa00');
                return { shouldStop: false };
            default:
                return { shouldStop: false };
        }
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
