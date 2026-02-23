import type { Condition } from '../ai/ConditionChecker';
import type { Action } from '../ai/types';

export type IntelligenceTier = 'strategic' | 'tactical' | 'mechanical';

// ── Propose ────────────────────────────────────────────
export interface SubTask {
  id: string;
  description: string;
  assignee?: string;               // NPC name, or undefined = self
  completionCriteria: Condition | string;  // Condition = mechanical, string = needs LLM
  estimatedTier: IntelligenceTier;
  dependencies: string[];          // sub-task IDs that must complete first
  failureMode?: string;
  actions?: Action[];              // if the sub-task can be expressed as actions
}

export interface ProposeMessage {
  type: 'propose';
  id: string;
  from: string;                    // NPC name
  taskDescription: string;
  interpretation: string;          // how the NPC understood the task
  subTasks: SubTask[];
  completionCriteria: Condition | string;  // whole-task completion
  rollupLogic: string;             // how sub-task completion guarantees whole completion
  failureModes: string[];
  tier: IntelligenceTier;
}

// ── Accept ─────────────────────────────────────────────
export interface AcceptMessage {
  type: 'accept';
  id: string;
  from: string;
  proposalId: string;
  subTaskId: string;
  understoodCriteria: string;      // restates what "done" means
  escalationConditions: string[];  // when to stop and ask for help
}

// ── Attempt ────────────────────────────────────────────
export interface AttemptMessage {
  type: 'attempt';
  id: string;
  from: string;
  subTaskId: string;
  action: Action;                  // what the NPC is doing
  intendedOutcome: string;
  actualOutcome?: string;          // filled after execution
  success?: boolean;
  observations?: string[];         // incidental discoveries
}

// ── Report ─────────────────────────────────────────────
export type ReportKind = 'completion' | 'failure' | 'progress' | 'observation' | 'escalation';

export interface ReportMessage {
  type: 'report';
  id: string;
  from: string;
  to?: string;                     // specific recipient, or broadcast
  subTaskId?: string;
  kind: ReportKind;
  content: string;
  criteriaMet?: boolean;           // for completion reports
}

// ── Question ───────────────────────────────────────────
export type QuestionKind =
  | 'completeness'    // decomposition doesn't cover case X
  | 'criteria'        // sub-task completion doesn't guarantee parent
  | 'assumption'      // plan based on stale/wrong info
  | 'efficiency'      // better approach exists
  | 'result'          // reported outcome doesn't match reality
  | 'consistency';    // internal logic error

export interface QuestionMessage {
  type: 'question';
  id: string;
  from: string;
  targetProposalId?: string;
  targetReportId?: string;
  kind: QuestionKind;
  concern: string;
  evidence: string;
  suggestedAlternative?: string;
  tier: IntelligenceTier;
}

// ── Revise ─────────────────────────────────────────────
export interface ReviseMessage {
  type: 'revise';
  id: string;
  from: string;
  originalProposalId: string;
  triggeredBy: string;             // question ID or report ID
  whatChanged: string;
  updatedSubTasks?: SubTask[];
  updatedCompletionCriteria?: Condition | string;
  impactOnInProgress: string;
  tier: IntelligenceTier;
}

// ── Remember ───────────────────────────────────────────
export type MemoryKind = 'lesson' | 'pattern' | 'capability' | 'plan' | 'failure';

export interface RememberMessage {
  type: 'remember';
  id: string;
  from: string;
  kind: MemoryKind;
  content: string;
  scope: 'individual' | 'shared';  // individual = one NPC, shared = all
  taskContext?: string;             // what task this was learned from
}

export type ProtocolMessage =
  | ProposeMessage
  | AcceptMessage
  | AttemptMessage
  | ReportMessage
  | QuestionMessage
  | ReviseMessage
  | RememberMessage;
