import type { NPC } from '../entities/NPC';
import type { WorldQuery } from '../world/WorldQuery';
import type { BehaviorMachine } from '../ai/BehaviorMachine';
import type { ProtocolRouter } from './ProtocolRouter';
import type { ProtocolMessage, SubTask } from './types';
import type { Action } from '../ai/types';
import type { Condition } from '../ai/ConditionChecker';
import { evaluate } from '../ai/ConditionChecker';
import { log as logEvent } from '../ui/EventLog';
import {
  propose as apiPropose,
  evaluateProposal as apiEvaluateProposal,
  revise as apiRevise,
  remember as apiRemember,
  fetchRelevantMemories,
  storeMemory,
} from '../ai/AgentClient';
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
  // Sub-tasks delegated to other NPCs (subTaskId → assignee name)
  private delegatedSubTasks: Map<string, string> = new Map();
  // Who assigned each of our sub-tasks (subTaskId → assigner name), for routing reports back
  private subTaskAssigners: Map<string, string> = new Map();
  // Progress reporting timer accumulator
  private progressAccum = 0;
  private static readonly PROGRESS_INTERVAL = 5000; // ms

  // Track the current proposal for whole-task completion detection
  private currentProposalId: string | null = null;
  private currentTaskDescription: string | null = null;
  // Track original task for replanning (avoids nested descriptions)
  private originalTaskDescription: string | null = null;
  private replanCount = 0;
  private static readonly MAX_REPLANS = 3;

  constructor(npc: NPC, world: WorldQuery, behavior: BehaviorMachine, router: ProtocolRouter) {
    this.npc = npc;
    this.world = world;
    this.behavior = behavior;
    this.router = router;

    // Listen for messages directed at this NPC
    router.onMessage((msg) => this.handleMessage(msg), npc.name);

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
        logEvent(this.npc.name, 'protocol', `received propose from ${msg.from}, subTasks: ${msg.subTasks.map(st => `${st.id}(assignee=${st.assignee ?? 'none'})`).join(', ')}`, { npcId: this.npc.id });
        // If from self, handle delegation to other NPCs and accept own sub-tasks
        if (msg.from === this.npc.name) {
          for (const subTask of msg.subTasks) {
            const assignee = subTask.assignee?.toLowerCase();
            if (assignee && assignee !== this.npc.name.toLowerCase()) {
              // Delegate to another NPC via targeted propose
              this.delegatedSubTasks.set(subTask.id, assignee);
              this.router.send({
                type: 'propose',
                id: msg.id,
                from: this.npc.name,
                to: subTask.assignee,
                taskDescription: subTask.description,
                interpretation: subTask.description,
                subTasks: [subTask],
                completionCriteria: subTask.completionCriteria,
                rollupLogic: 'Complete the assigned sub-task',
                failureModes: subTask.failureMode ? [subTask.failureMode] : [],
                tier: 'tactical',
              } as any);
            } else {
              // No assignee or assigned to self — accept it
              this.acceptSubTask(msg.id, subTask);
            }
          }
        } else {
          // From another NPC — only accept sub-tasks explicitly assigned to me
          for (const subTask of msg.subTasks) {
            if (subTask.assignee && subTask.assignee.toLowerCase() === this.npc.name.toLowerCase()) {
              this.subTaskAssigners.set(subTask.id, msg.from);
              this.acceptSubTask(msg.id, subTask);
            }
          }
        }
        break;

      case 'report':
        // Handle reports from delegated sub-tasks
        if (msg.subTaskId && this.delegatedSubTasks.has(msg.subTaskId)) {
          this.delegatedSubTasks.delete(msg.subTaskId);
          if (msg.kind === 'completion') {
            this.completedSubTasks.add(msg.subTaskId);
          }
          // Check if all work (owned + delegated) is done
          if (this.ownedSubTasks.size === 0 && this.delegatedSubTasks.size === 0 && this.currentProposalId) {
            this.distillLessons();
          }
          this.scheduleNext();
        }
        break;

      case 'question':
        // Handled via self-critique in receiveTask flow
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

    // Collect observations from BehaviorMachine
    const observations = [...this.behavior.observations];
    this.behavior.observations = [];

    if (subTask) {
      this.completedSubTasks.add(subTaskId);
      this.ownedSubTasks.delete(subTaskId);

      // Route report back to assigner if this was a delegated sub-task
      const assigner = this.subTaskAssigners.get(subTaskId);
      this.subTaskAssigners.delete(subTaskId);

      this.router.send({
        type: 'report',
        id: `report_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        from: this.npc.name,
        to: assigner,
        subTaskId,
        kind: success ? 'completion' : 'failure',
        content: `${success ? 'Completed' : 'Failed'}: ${subTask.description}` +
          (observations.length > 0 ? ` | Observations: ${observations.join('; ')}` : ''),
        criteriaMet: success,
      });
    }

    // On failure: attempt replanning with failure context
    if (!success && subTask && this.currentTaskDescription) {
      this.attemptReplan(subTask);
      return; // attemptReplan handles scheduleNext via receiveTask
    }

    // Check if all sub-tasks for current proposal are done (whole-task completion)
    if (this.ownedSubTasks.size === 0 && this.delegatedSubTasks.size === 0 && this.currentProposalId) {
      this.distillLessons();
    }

    this.scheduleNext();
  }

  /** Attempt to replan after a sub-task failure. */
  private async attemptReplan(failedSubTask: SubTask) {
    if (!this.currentTaskDescription) {
      this.scheduleNext();
      return;
    }

    if (this.replanCount >= ProtocolAgent.MAX_REPLANS) {
      logEvent(this.npc.name, 'system', `Replan limit reached (${ProtocolAgent.MAX_REPLANS}), giving up on task`, { npcId: this.npc.id });
      await this.distillLessons();
      this.scheduleNext();
      return;
    }

    this.replanCount++;

    const taskDesc = this.originalTaskDescription ?? this.currentTaskDescription;
    const remainingDescriptions = Array.from(this.ownedSubTasks.values())
      .map(st => st.description).join(', ');

    const replanDescription = `Original task: "${taskDesc}". ` +
      `Sub-task "${failedSubTask.description}" failed. ` +
      (remainingDescriptions ? `Remaining sub-tasks: ${remainingDescriptions}. ` : '') +
      `Please create a revised plan to accomplish the original goal.`;

    try {
      await this.receiveTask(replanDescription, this.npc.name);
    } catch (err) {
      logEvent(this.npc.name, 'system', `Replanning failed: ${err instanceof Error ? err.message : String(err)}`, { npcId: this.npc.id });
      this.scheduleNext();
    }
  }

  /** Distill lessons from completed task via Remember. */
  private async distillLessons() {
    if (!this.currentProposalId || !this.currentTaskDescription) return;

    const taskContext = this.currentTaskDescription;
    const completedIds = Array.from(this.completedSubTasks);
    const outcome = completedIds.length > 0
      ? `Task completed. ${completedIds.length} sub-tasks finished.`
      : 'Task had no sub-tasks.';

    const proposalId = this.currentProposalId;
    this.currentProposalId = null;
    this.currentTaskDescription = null;
    this.originalTaskDescription = null;
    this.replanCount = 0;

    try {
      const result = await apiRemember(this.npc.id, taskContext, outcome);

      // Store lessons in long-term memory
      if (result.lessons) {
        for (const lesson of result.lessons) {
          await storeMemory(
            this.npc.id,
            lesson.insight ?? (lesson as any).content ?? String(lesson),
            'lesson',
            (lesson as any).confidence ?? 0.7,
          );
        }
      }

      // Send remember message through router
      this.router.send({
        type: 'remember',
        id: result.id ?? `mem_${Date.now()}`,
        from: this.npc.name,
        kind: 'lesson',
        content: `Distilled ${result.lessons?.length ?? 0} lessons from: ${taskContext}`,
        scope: 'individual',
        taskContext: proposalId,
      });
    } catch (err) {
      logEvent(this.npc.name, 'system', `Remember failed: ${err instanceof Error ? err.message : String(err)}`, { npcId: this.npc.id });
    }
  }

  /** Player or another NPC gives this agent a task. */
  async receiveTask(description: string, _from: string): Promise<string> {
    // Cancel any previous task — one active task per NPC
    this.ownedSubTasks.clear();
    this.completedSubTasks.clear();
    this.delegatedSubTasks.clear();
    this.subTaskAssigners.clear();
    this.currentSubTaskId = null;
    this.currentProposalId = null;
    this.currentTaskDescription = null;
    this.behavior.clearCurrent();

    const worldSummary = this.world.buildWorldSummaryFor(this.npc.name);
    const capabilities = capabilitiesToPromptText();
    const memories = await fetchRelevantMemories(this.npc.id, description);

    const response = await apiPropose(
      this.npc.id,
      description,
      worldSummary,
      capabilities,
      memories,
    );

    // Convert LLM-returned sub-tasks into typed SubTask objects with Actions
    let subTasks: SubTask[] = (response.subTasks ?? []).map(st => ({
      id: st.id,
      description: st.description,
      assignee: (st as any).assignee,
      completionCriteria: st.completionCriteria,
      estimatedTier: 'tactical' as const,
      dependencies: st.dependencies ?? [],
      actions: (st.actions ?? []) as unknown as Action[],
    }));

    let interpretation = response.interpretation ?? description;
    let completionCriteria = response.completionCriteria ?? description;
    let rollupLogic = response.rollupLogic ?? 'All sub-tasks completed';

    // Self-critique: evaluate the proposal before accepting (only for non-trivial plans)
    if (subTasks.length > 1) {
      const proposalSummary = {
        taskDescription: description,
        interpretation,
        subTasks: subTasks.map(st => ({
          id: st.id,
          description: st.description,
          completionCriteria: typeof st.completionCriteria === 'string'
            ? st.completionCriteria
            : 'mechanical condition',
        })),
        completionCriteria: typeof completionCriteria === 'string'
          ? completionCriteria
          : 'mechanical condition',
        rollupLogic,
      };

      let revisionsLeft = 2;
      let previousKind: string | null = null;
      while (revisionsLeft > 0) {
        try {
          const evaluation = await apiEvaluateProposal(
            this.npc.id,
            proposalSummary,
            worldSummary,
            memories,
          );

          if (evaluation.approved) break;

          // If the evaluator raises the same category of concern twice,
          // the reviser can't fix it — accept the plan as-is.
          const currentKind = evaluation.kind ?? 'completeness';
          if (previousKind && currentKind === previousKind) {
            logEvent(this.npc.name, 'system', `Evaluator raised same concern category (${currentKind}) twice — accepting plan`, { npcId: this.npc.id });
            break;
          }
          previousKind = currentKind;

          // Send question through router
          this.router.send({
            type: 'question',
            id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            from: this.npc.name,
            targetProposalId: response.id,
            kind: (evaluation.kind ?? 'completeness') as any,
            concern: evaluation.concern ?? 'Unknown concern',
            evidence: evaluation.evidence ?? '',
            suggestedAlternative: evaluation.suggestedAlternative,
            tier: 'strategic',
          });

          // Revise the plan
          const revised = await apiRevise(
            this.npc.id,
            proposalSummary,
            {
              kind: evaluation.kind ?? 'completeness',
              concern: evaluation.concern ?? 'Unknown concern',
              evidence: evaluation.evidence ?? '',
              suggestedAlternative: evaluation.suggestedAlternative,
            },
            worldSummary,
          );

          // Apply revisions
          if (revised.revisedSubTasks && revised.revisedSubTasks.length > 0) {
            subTasks = revised.revisedSubTasks.map(st => ({
              id: st.id,
              description: st.description,
              assignee: (st as any).assignee,
              completionCriteria: st.completionCriteria,
              estimatedTier: 'tactical' as const,
              dependencies: (st as any).dependencies ?? [],
              actions: ((st as any).actions ?? []) as unknown as Action[],
            }));

            // Update summary for next evaluation round
            proposalSummary.subTasks = subTasks.map(st => ({
              id: st.id,
              description: st.description,
              completionCriteria: typeof st.completionCriteria === 'string'
                ? st.completionCriteria
                : 'mechanical condition',
            }));
          }

          if (revised.revisedCompletionCriteria) {
            completionCriteria = revised.revisedCompletionCriteria as string;
            proposalSummary.completionCriteria = completionCriteria;
          }

          // Send revise message through router
          this.router.send({
            type: 'revise',
            id: revised.id,
            from: this.npc.name,
            originalProposalId: response.id,
            triggeredBy: 'self-critique',
            whatChanged: revised.explanation ?? 'Plan revised',
            updatedSubTasks: subTasks,
            impactOnInProgress: 'none — not yet started',
            tier: 'strategic',
          });
        } catch (err) {
          logEvent(this.npc.name, 'system', `Self-critique/revise failed, proceeding: ${err instanceof Error ? err.message : String(err)}`, { npcId: this.npc.id });
          break;
        }

        revisionsLeft--;
      }
    }

    this.currentProposalId = response.id;
    this.currentTaskDescription = description;
    // Preserve the original task description for replanning (avoid nesting)
    if (!this.originalTaskDescription) {
      this.originalTaskDescription = description;
    }

    const proposal = {
      type: 'propose' as const,
      id: response.id,
      from: this.npc.name,
      taskDescription: description,
      interpretation,
      subTasks,
      completionCriteria,
      rollupLogic,
      failureModes: response.failureModes ?? [],
      tier: 'tactical' as const,
    };

    await this.router.send(proposal);

    return interpretation;
  }

  /** Get world summary for this NPC (used by ChatController for dialogue calls). */
  getWorldSummary(): string {
    return this.world.buildWorldSummaryFor(this.npc.name);
  }

  /** Whether this agent has any active (owned or in-progress) sub-tasks. */
  hasActiveTasks(): boolean {
    return this.ownedSubTasks.size > 0 || this.currentSubTaskId !== null;
  }

  /** Check all owned sub-tasks for mechanical Condition completion + progress reporting. */
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

    // Progress reporting for long-running sub-tasks
    this.progressAccum += 500; // called every 500ms from NPC.update
    if (this.progressAccum >= ProtocolAgent.PROGRESS_INTERVAL && this.currentSubTaskId) {
      this.progressAccum = 0;
      const subTask = this.ownedSubTasks.get(this.currentSubTaskId);
      if (subTask) {
        const stateDesc = this.behavior.getStateDescription();
        this.router.send({
          type: 'report',
          id: `progress_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          from: this.npc.name,
          subTaskId: this.currentSubTaskId,
          kind: 'progress',
          content: `In progress: ${subTask.description} — currently ${stateDesc}`,
        });
      }
    }
  }
}
