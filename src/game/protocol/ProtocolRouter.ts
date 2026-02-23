import type { ProtocolMessage } from './types';
import type { WorldQuery } from '../world/WorldQuery';
import type { NPC } from '../entities/NPC';
import { log as logEvent } from '../ui/EventLog';

export interface TaskContext {
  id: string;
  originMessage: ProtocolMessage;    // the initial Propose or player instruction
  messages: ProtocolMessage[];       // full message history for this task
  status: 'active' | 'completed' | 'failed';
  participants: string[];            // NPC names involved
}

export class ProtocolRouter {
  private npcs: Map<string, NPC> = new Map();
  private activeTasks: Map<string, TaskContext> = new Map();
  private world: WorldQuery;

  // Handlers registered by NPCs or the protocol engine
  private messageHandlers: ((msg: ProtocolMessage) => void)[] = [];

  constructor(world: WorldQuery) {
    this.world = world;
  }

  registerNPC(name: string, npc: NPC) {
    this.npcs.set(name.toLowerCase(), npc);
  }

  onMessage(handler: (msg: ProtocolMessage) => void) {
    this.messageHandlers.push(handler);
  }

  /** Send a protocol message. Routes to appropriate handler. */
  async send(message: ProtocolMessage) {
    // Find or create task context
    const taskId = this.resolveTaskId(message);
    if (taskId) {
      let ctx = this.activeTasks.get(taskId);
      if (!ctx && message.type === 'propose') {
        ctx = {
          id: taskId,
          originMessage: message,
          messages: [],
          status: 'active',
          participants: [message.from],
        };
        this.activeTasks.set(taskId, ctx);
      }
      if (ctx) {
        ctx.messages.push(message);
        // Track participants
        if (!ctx.participants.includes(message.from)) {
          ctx.participants.push(message.from);
        }
        // Update status on completion/failure reports
        if (message.type === 'report') {
          if (message.kind === 'completion' && message.criteriaMet && !message.subTaskId) {
            ctx.status = 'completed';
          } else if (message.kind === 'failure' && !message.subTaskId) {
            ctx.status = 'failed';
          }
        }
      }
    }

    // Log for debugging
    logEvent(message.from, 'protocol', `[${message.type}] ${this.summarizeMessage(message)}`);

    // Notify all handlers
    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }

  getTaskContext(taskId: string): TaskContext | undefined {
    return this.activeTasks.get(taskId);
  }

  getActiveTasksFor(npcName: string): TaskContext[] {
    return Array.from(this.activeTasks.values())
      .filter(t => t.status === 'active' && t.participants.includes(npcName));
  }

  /** Get all active tasks. */
  getAllActiveTasks(): TaskContext[] {
    return Array.from(this.activeTasks.values())
      .filter(t => t.status === 'active');
  }

  /** Get world query (for agents that need it). */
  getWorld(): WorldQuery {
    return this.world;
  }

  // ── Internals ──────────────────────────────────────────

  private resolveTaskId(message: ProtocolMessage): string | null {
    switch (message.type) {
      case 'propose': return message.id;
      case 'accept': return message.proposalId;
      case 'attempt': return null; // linked via subTaskId, find parent
      case 'report': return this.findTaskBySubTask(message.subTaskId);
      case 'question': return message.targetProposalId ?? null;
      case 'revise': return message.originalProposalId;
      case 'remember': return null; // not task-scoped
    }
  }

  private findTaskBySubTask(subTaskId?: string): string | null {
    if (!subTaskId) return null;
    for (const [taskId, ctx] of this.activeTasks) {
      if (ctx.originMessage.type === 'propose') {
        const propose = ctx.originMessage;
        if (propose.subTasks.some(st => st.id === subTaskId)) {
          return taskId;
        }
      }
    }
    return null;
  }

  private summarizeMessage(msg: ProtocolMessage): string {
    switch (msg.type) {
      case 'propose': return msg.taskDescription;
      case 'accept': return `accepts sub-task ${msg.subTaskId}`;
      case 'attempt': return msg.intendedOutcome;
      case 'report': return `${msg.kind}: ${msg.content}`;
      case 'question': return `${msg.kind}: ${msg.concern}`;
      case 'revise': return msg.whatChanged;
      case 'remember': return `${msg.kind}: ${msg.content}`;
    }
  }
}
