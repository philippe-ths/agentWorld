import type { NPC } from '../entities/NPC';
import type { WorldQuery } from '../world/WorldQuery';
import type { BehaviorMachine } from '../ai/BehaviorMachine';
import type { ProtocolRouter } from './ProtocolRouter';
import type { ProtocolMessage, SubTask } from './types';
import type { Action } from '../ai/types';
import type { Condition } from '../ai/ConditionChecker';
import { evaluate } from '../ai/ConditionChecker';
import { propose as apiPropose } from '../ai/AgentClient';
import { capabilitiesToPromptText } from '../world/Capabilities';

export class ProtocolAgent {
  private npc: NPC;
  private world: WorldQuery;
  private behavior: BehaviorMachine;
  private router: ProtocolRouter;

  // Tasks this agent is responsible for
  private ownedSubTasks: Map<string, SubTask> = new Map();
  // Which sub-task is currently being executed
  private currentSubTaskId: string | null = null;
  // Sub-tasks that have finished (for dependency checks)
  private completedSubTasks: Set<string> = new Set();

  constructor(npc: NPC, world: WorldQuery, behavior: BehaviorMachine, router: ProtocolRouter) {
    this.npc = npc;
    this.world = world;
    this.behavior = behavior;
    this.router = router;

    // Listen for messages directed at this NPC
    router.onMessage((msg) => this.handleMessage(msg));

    // When behavior machine goes idle, check if there's more work
    behavior.onBecomeIdle = () => this.onIdle();

    // When an action completes, check completion criteria
    behavior.onActionComplete = (action, success) => this.onActionComplete(action, success);
  }

  /** Handle incoming protocol message. */
  private async handleMessage(msg: ProtocolMessage) {
    // Only handle messages relevant to this NPC
    if ('to' in msg && msg.to && msg.to.toLowerCase() !== this.npc.name.toLowerCase()) {
      return;
    }

    switch (msg.type) {
      case 'propose':
        // If we're a participant, auto-accept our assigned sub-tasks
        for (const subTask of msg.subTasks) {
          if (subTask.assignee?.toLowerCase() === this.npc.name.toLowerCase()) {
            this.acceptSubTask(msg.id, subTask);
          }
        }
        // If from self and no assignees, accept all
        if (msg.from === this.npc.name) {
          for (const subTask of msg.subTasks) {
            if (!subTask.assignee) {
              this.acceptSubTask(msg.id, subTask);
            }
          }
        }
        break;

      case 'report':
        // If this is a completion/failure for one of our tracked tasks, note it
        break;

      case 'question':
        // Will need LLM to generate a response (Phase 3)
        break;

      case 'revise':
        // Update owned sub-tasks if they changed
        if (msg.updatedSubTasks) {
          for (const updated of msg.updatedSubTasks) {
            if (this.ownedSubTasks.has(updated.id)) {
              this.ownedSubTasks.set(updated.id, updated);
            }
          }
        }
        break;
    }
  }

  /** Accept a sub-task (queue it, don't execute immediately). */
  private acceptSubTask(proposalId: string, subTask: SubTask) {
    this.ownedSubTasks.set(subTask.id, subTask);

    this.router.send({
      type: 'accept',
      id: `accept_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      from: this.npc.name,
      proposalId,
      subTaskId: subTask.id,
      understoodCriteria: typeof subTask.completionCriteria === 'string'
        ? subTask.completionCriteria
        : 'mechanical condition',
      escalationConditions: subTask.failureMode ? [subTask.failureMode] : [],
    });

    // Don't execute immediately — scheduleNext() picks the first ready sub-task
    this.scheduleNext();
  }

  /** Execute the actions for a sub-task. */
  private executeSubTaskActions(subTask: SubTask) {
    if (!subTask.actions || subTask.actions.length === 0) return;

    const action: Action = subTask.actions.length === 1
      ? subTask.actions[0]
      : { type: 'sequence', actions: subTask.actions };

    // Send attempt message
    this.router.send({
      type: 'attempt',
      id: `attempt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      from: this.npc.name,
      subTaskId: subTask.id,
      action,
      intendedOutcome: subTask.description,
    });

    this.behavior.execute(action);
  }

  /** Pick the next ready sub-task and execute it. */
  private scheduleNext() {
    // Don't interrupt a running sub-task
    if (this.currentSubTaskId) return;

    for (const [_id, subTask] of this.ownedSubTasks) {
      // Check all dependencies are completed
      const depsComplete = subTask.dependencies.every(
        depId => this.completedSubTasks.has(depId)
      );
      if (!depsComplete) continue;

      // Must have actions to execute
      if (!subTask.actions || subTask.actions.length === 0) continue;

      this.currentSubTaskId = subTask.id;
      this.executeSubTaskActions(subTask);
      return;
    }
  }

  /** Called when behavior machine becomes idle. */
  private onIdle() {
    // If we were executing a sub-task and went idle, it succeeded
    if (this.currentSubTaskId) {
      this.completeCurrentSubTask(true);
      return; // completeCurrentSubTask calls scheduleNext
    }
    this.scheduleNext();
  }

  /** Called when an action completes (individual action within a sub-task). */
  private onActionComplete(_action: Action, success: boolean) {
    // Only process if we have an active sub-task
    if (!this.currentSubTaskId) return;

    // BehaviorMachine calls onActionComplete for each action in a sequence,
    // then calls onBecomeIdle when the full sequence finishes.
    // We only mark the sub-task complete/failed on the FINAL action —
    // which is when the behavior machine goes idle right after.
    // However, if an individual action fails, BehaviorMachine stops
    // the sequence and goes idle, so we handle failure here.
    if (!success) {
      this.completeCurrentSubTask(false);
    }
  }

  /** Mark the current sub-task as completed or failed, then schedule next. */
  private completeCurrentSubTask(success: boolean) {
    const subTaskId = this.currentSubTaskId;
    if (!subTaskId) return;

    const subTask = this.ownedSubTasks.get(subTaskId);
    this.currentSubTaskId = null;

    if (subTask) {
      this.completedSubTasks.add(subTaskId);
      this.ownedSubTasks.delete(subTaskId);

      this.router.send({
        type: 'report',
        id: `report_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        from: this.npc.name,
        subTaskId,
        kind: success ? 'completion' : 'failure',
        content: `${success ? 'Completed' : 'Failed'}: ${subTask.description}`,
        criteriaMet: success,
      });
    }

    this.scheduleNext();
  }

  /** Player or another NPC gives this agent a task. */
  async receiveTask(description: string, _from: string): Promise<string> {
    const worldSummary = this.world.buildWorldSummaryFor(this.npc.name);
    const capabilities = capabilitiesToPromptText();

    const response = await apiPropose(
      this.npc.id,
      description,
      worldSummary,
      capabilities,
    );

    // Convert LLM-returned sub-tasks into typed SubTask objects with Actions
    const subTasks: SubTask[] = (response.subTasks ?? []).map(st => ({
      id: st.id,
      description: st.description,
      completionCriteria: st.completionCriteria,
      estimatedTier: 'tactical' as const,
      dependencies: st.dependencies ?? [],
      actions: (st.actions ?? []) as unknown as Action[],
    }));

    const proposal = {
      type: 'propose' as const,
      id: response.id,
      from: this.npc.name,
      taskDescription: description,
      interpretation: response.interpretation ?? description,
      subTasks,
      completionCriteria: response.completionCriteria ?? description,
      rollupLogic: response.rollupLogic ?? 'All sub-tasks completed',
      failureModes: response.failureModes ?? [],
      tier: 'tactical' as const,
    };

    await this.router.send(proposal);

    return response.interpretation ?? description;
  }

  /** Get world summary for this NPC (used by ChatController for dialogue calls). */
  getWorldSummary(): string {
    return this.world.buildWorldSummaryFor(this.npc.name);
  }

  /** Check all owned sub-tasks for mechanical Condition completion. */
  checkCompletions() {
    for (const [id, subTask] of this.ownedSubTasks) {
      if (typeof subTask.completionCriteria === 'string') continue;

      if (evaluate(subTask.completionCriteria as Condition, this.world)) {
        this.completedSubTasks.add(id);
        this.ownedSubTasks.delete(id);

        if (this.currentSubTaskId === id) {
          this.currentSubTaskId = null;
        }

        this.router.send({
          type: 'report',
          id: `report_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          from: this.npc.name,
          subTaskId: id,
          kind: 'completion',
          content: `Completed: ${subTask.description}`,
          criteriaMet: true,
        });

        this.scheduleNext();
      }
    }
  }
}
