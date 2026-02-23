import type { NPC } from '../entities/NPC';
import type { WorldQuery } from '../world/WorldQuery';
import type { EntityManager } from '../entities/EntityManager';
import type { Action, TravelToAction, PursueAction, FleeAction, WaitUntilAction } from './types';
import type { Condition } from './ConditionChecker';
import { evaluate } from './ConditionChecker';
import { findPath } from './Pathfinding';
import { log as logEvent } from '../ui/EventLog';

export type BehaviorState =
  | 'idle'
  | 'traveling'
  | 'pursuing'
  | 'fleeing'
  | 'waiting'
  | 'waiting_until'
  | 'conversing'
  | 'speaking'
  | 'executing_sequence';

export class BehaviorMachine {
  private npc: NPC;
  private world: WorldQuery;
  private entityManager: EntityManager;

  state: BehaviorState = 'idle';

  // Current action being executed
  private currentAction: Action | null = null;

  // For travel/pursue/flee: the path being followed
  private currentPath: { x: number; y: number }[] = [];
  private pathIndex = 0;

  // For pursue/flee: re-path timer
  private repathTimer = 0;
  private repathInterval = 500;

  // For waiting
  private waitTimer = 0;

  // For wait_until
  private watchedCondition: Condition | null = null;
  private conditionCheckTimer = 0;
  private conditionTimeout = 0;
  private conditionStartTime = 0;

  // Action queue (for sequences and onComplete chains)
  private actionQueue: Action[] = [];

  // Pending converse_with: after pursuit completes, dispatch the event
  private pendingConverse: { target: string; purpose?: string } | null = null;

  // Callback when machine returns to idle
  onBecomeIdle?: () => void;
  // Callback when an action completes
  onActionComplete?: (action: Action, success: boolean) => void;
  // Incidental observations collected during movement
  observations: string[] = [];

  constructor(npc: NPC, world: WorldQuery, entityManager: EntityManager) {
    this.npc = npc;
    this.world = world;
    this.entityManager = entityManager;
  }

  /** Assign a new action (or sequence). Clears any current activity. */
  execute(action: Action) {
    this.clearCurrent();

    if (action.type === 'sequence') {
      this.actionQueue = [...action.actions];
      this.advanceQueue();
    } else {
      this.startAction(action);
    }
  }

  /** Get current state as text for logging/prompts. */
  getStateDescription(): string {
    switch (this.state) {
      case 'idle': return 'idle';
      case 'traveling': {
        const a = this.currentAction as TravelToAction | undefined;
        return a ? `traveling to (${a.destination.x},${a.destination.y})` : 'traveling';
      }
      case 'pursuing': {
        const a = this.currentAction as PursueAction | undefined;
        return a ? `pursuing ${a.target}` : 'pursuing';
      }
      case 'fleeing': {
        const a = this.currentAction as FleeAction | undefined;
        return a ? `fleeing from ${a.threat}` : 'fleeing';
      }
      case 'waiting': return 'waiting';
      case 'waiting_until': return 'waiting for condition';
      case 'conversing': return 'in conversation';
      case 'speaking': return 'speaking';
      case 'executing_sequence': return 'executing sequence';
      default: return this.state;
    }
  }

  /** Called every frame from NPC.update(). */
  update(_time: number, delta: number) {
    switch (this.state) {
      case 'idle':
        break;

      case 'traveling':
        this.updateTravel();
        break;

      case 'pursuing':
        this.updatePursue(delta);
        break;

      case 'fleeing':
        this.updateFlee(delta);
        break;

      case 'waiting':
        this.waitTimer -= delta;
        if (this.waitTimer <= 0) {
          this.completeCurrentAction(true);
        }
        break;

      case 'waiting_until':
        this.updateWaitUntil(delta);
        break;

      case 'speaking':
        this.waitTimer -= delta;
        if (this.waitTimer <= 0) {
          this.completeCurrentAction(true);
        }
        break;

      case 'conversing':
        // Managed externally by ConversationManager
        break;
    }
  }

  // ── Action execution ─────────────────────────────────

  private startAction(action: Action) {
    this.currentAction = action;

    switch (action.type) {
      case 'move': {
        const dx = Math.sign(action.target.x - this.npc.tilePos.x);
        const dy = Math.sign(action.target.y - this.npc.tilePos.y);
        const moved = this.npc.moveTo(dx, dy);
        if (!moved) {
          this.completeCurrentAction(false);
        } else {
          this.state = 'traveling';
        }
        break;
      }

      case 'travel_to': {
        let path = findPath(
          this.npc.tilePos,
          action.destination,
          this.entityManager.isWalkable
        );
        // If destination is occupied/unwalkable, try adjacent tiles
        if (path.length === 0) {
          const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
          for (const d of dirs) {
            const ax = action.destination.x + d.x;
            const ay = action.destination.y + d.y;
            if (this.entityManager.isWalkable(ax, ay)) {
              const altPath = findPath(this.npc.tilePos, { x: ax, y: ay }, this.entityManager.isWalkable);
              if (altPath.length > 0 && (path.length === 0 || altPath.length < path.length)) {
                path = altPath;
              }
            }
          }
        }
        if (path.length === 0) {
          logEvent(this.npc.name, 'action', `travel_to (${action.destination.x},${action.destination.y}) — no path`, { npcId: this.npc.id });
          this.completeCurrentAction(false);
        } else {
          this.currentPath = path;
          this.pathIndex = 0;
          this.state = 'traveling';
          logEvent(this.npc.name, 'action', `traveling to (${action.destination.x},${action.destination.y}) — ${path.length} tiles`, { npcId: this.npc.id });
        }
        break;
      }

      case 'pursue': {
        this.state = 'pursuing';
        this.repathTimer = 0;
        this.conditionStartTime = Date.now();
        logEvent(this.npc.name, 'action', `pursuing ${action.target}`, { npcId: this.npc.id });
        break;
      }

      case 'flee_from': {
        this.state = 'fleeing';
        this.repathTimer = 0;
        logEvent(this.npc.name, 'action', `fleeing from ${action.threat}`, { npcId: this.npc.id });
        break;
      }

      case 'wait': {
        this.state = 'waiting';
        this.waitTimer = action.duration;
        break;
      }

      case 'wait_until': {
        this.state = 'waiting_until';
        this.watchedCondition = action.condition;
        this.conditionCheckTimer = 0;
        this.conditionStartTime = Date.now();
        this.conditionTimeout = action.timeoutMs ?? 0;
        if (evaluate(action.condition, this.world)) {
          this.completeCurrentAction(true);
        }
        break;
      }

      case 'speak': {
        this.npc.say(action.text);
        this.state = 'speaking';
        this.waitTimer = 4000;
        logEvent(this.npc.name, 'action', `says: "${action.text}"`, { npcId: this.npc.id });
        break;
      }

      case 'say_to': {
        const targetPos = this.world.getEntityPosition(action.target);
        if (!targetPos) {
          logEvent(this.npc.name, 'action', `say_to ${action.target} — entity not found`, { npcId: this.npc.id });
          this.completeCurrentAction(false);
          break;
        }
        const subActions: Action[] = [
          { type: 'pursue', target: action.target, timeoutMs: 30000 },
          { type: 'speak', text: action.text },
        ];
        if (action.onDelivered) {
          subActions.push(...action.onDelivered);
        }
        this.actionQueue = subActions;
        this.advanceQueue();
        break;
      }

      case 'converse_with': {
        const convTargetPos = this.world.getEntityPosition(action.target);
        if (!convTargetPos) {
          this.completeCurrentAction(false);
          break;
        }
        // Pursue the target, then dispatch the conversation event
        const convPursuit: Action = { type: 'pursue', target: action.target, timeoutMs: 30000 };
        this.actionQueue = [convPursuit];
        // After pursuit completes, the queue empties and we need to
        // dispatch the conversation event. We do this by overriding
        // advanceQueue's idle path — store the target for post-pursuit.
        this.pendingConverse = { target: action.target, purpose: action.purpose };
        this.advanceQueue();
        break;
      }

      case 'sequence': {
        this.actionQueue = [...action.actions];
        this.advanceQueue();
        break;
      }
    }
  }

  // ── Travel execution ─────────────────────────────────

  private updateTravel() {
    if (this.npc.isMoving) return;

    // Collect observations about nearby entities during movement
    this.collectMovementObservations();

    if (this.pathIndex >= this.currentPath.length) {
      this.completeCurrentAction(true);
      return;
    }

    const nextTile = this.currentPath[this.pathIndex];
    const dx = Math.sign(nextTile.x - this.npc.tilePos.x);
    const dy = Math.sign(nextTile.y - this.npc.tilePos.y);

    const moved = this.npc.moveTo(dx, dy);
    if (moved) {
      if (this.npc.tilePos.x === nextTile.x && this.npc.tilePos.y === nextTile.y) {
        this.pathIndex++;
      }
    } else {
      // Blocked — try to re-path
      const action = this.currentAction as TravelToAction;
      if (action && action.type === 'travel_to') {
        const newPath = findPath(
          this.npc.tilePos,
          action.destination,
          this.entityManager.isWalkable
        );
        if (newPath.length > 0) {
          this.currentPath = newPath;
          this.pathIndex = 0;
        } else {
          this.npc.addEvent('stuck — no alternative path');
          this.completeCurrentAction(false);
        }
      } else {
        this.completeCurrentAction(false);
      }
    }
  }

  // ── Pursue execution ─────────────────────────────────

  private updatePursue(delta: number) {
    const action = this.currentAction as PursueAction;
    if (!action) return;

    // Check timeout
    if (action.timeoutMs && Date.now() - this.conditionStartTime > action.timeoutMs) {
      logEvent(this.npc.name, 'action', `pursuit of ${action.target} timed out`, { npcId: this.npc.id });
      this.completeCurrentAction(false);
      return;
    }

    // Check if adjacent to target
    if (this.world.isEntityAdjacent(this.npc.name, action.target)) {
      logEvent(this.npc.name, 'action', `reached ${action.target}`, { npcId: this.npc.id });
      this.completeCurrentAction(true);
      return;
    }

    if (this.npc.isMoving) return;

    // Collect observations during pursuit
    this.collectMovementObservations();

    // Re-path periodically
    this.repathTimer += delta;
    if (this.repathTimer >= this.repathInterval || this.currentPath.length === 0) {
      this.repathTimer = 0;

      const targetPos = this.world.getEntityPosition(action.target);
      if (!targetPos) {
        this.completeCurrentAction(false);
        return;
      }

      // Find adjacent tile to target
      const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
      let bestPath: { x: number; y: number }[] = [];

      for (const d of dirs) {
        const ax = targetPos.x + d.x;
        const ay = targetPos.y + d.y;
        if (this.entityManager.isWalkable(ax, ay)) {
          const path = findPath(this.npc.tilePos, { x: ax, y: ay }, this.entityManager.isWalkable);
          if (path.length > 0 && (bestPath.length === 0 || path.length < bestPath.length)) {
            bestPath = path;
          }
        }
      }

      this.currentPath = bestPath;
      this.pathIndex = 0;
    }

    // Follow current path
    if (this.pathIndex < this.currentPath.length) {
      const nextTile = this.currentPath[this.pathIndex];
      const dx = Math.sign(nextTile.x - this.npc.tilePos.x);
      const dy = Math.sign(nextTile.y - this.npc.tilePos.y);

      if (this.npc.moveTo(dx, dy)) {
        if (this.npc.tilePos.x === nextTile.x && this.npc.tilePos.y === nextTile.y) {
          this.pathIndex++;
        }
      }
    }
  }

  // ── Flee execution ───────────────────────────────────

  private updateFlee(delta: number) {
    const action = this.currentAction as FleeAction;
    if (!action) return;

    const dist = this.world.getEntityEuclideanDistance(this.npc.name, action.threat);
    if (dist !== null && dist >= action.safeDistance) {
      this.completeCurrentAction(true);
      return;
    }

    if (this.npc.isMoving) return;

    this.repathTimer += delta;
    if (this.repathTimer >= this.repathInterval || this.currentPath.length === 0) {
      this.repathTimer = 0;

      const threatPos = this.world.getEntityPosition(action.threat);
      if (!threatPos) {
        this.completeCurrentAction(true); // Threat gone
        return;
      }

      // Move in opposite direction from threat
      const ddx = this.npc.tilePos.x - threatPos.x;
      const ddy = this.npc.tilePos.y - threatPos.y;
      const len = Math.sqrt(ddx * ddx + ddy * ddy) || 1;

      const fleeX = Math.round(this.npc.tilePos.x + (ddx / len) * 10);
      const fleeY = Math.round(this.npc.tilePos.y + (ddy / len) * 10);

      const clampedX = Math.max(0, Math.min(63, fleeX));
      const clampedY = Math.max(0, Math.min(63, fleeY));

      const path = findPath(this.npc.tilePos, { x: clampedX, y: clampedY }, this.entityManager.isWalkable);
      if (path.length > 0) {
        this.currentPath = path;
        this.pathIndex = 0;
      }
    }

    // Follow current path
    if (this.pathIndex < this.currentPath.length) {
      const nextTile = this.currentPath[this.pathIndex];
      const ndx = Math.sign(nextTile.x - this.npc.tilePos.x);
      const ndy = Math.sign(nextTile.y - this.npc.tilePos.y);

      if (this.npc.moveTo(ndx, ndy)) {
        if (this.npc.tilePos.x === nextTile.x && this.npc.tilePos.y === nextTile.y) {
          this.pathIndex++;
        }
      }
    }
  }

  // ── Wait-until execution ─────────────────────────────

  private updateWaitUntil(delta: number) {
    const action = this.currentAction as WaitUntilAction;
    if (!action || !this.watchedCondition) return;

    // Check timeout
    if (this.conditionTimeout > 0 && Date.now() - this.conditionStartTime > this.conditionTimeout) {
      this.completeCurrentAction(false);
      return;
    }

    // Check condition every 250ms
    this.conditionCheckTimer += delta;
    if (this.conditionCheckTimer >= 250) {
      this.conditionCheckTimer = 0;
      if (evaluate(this.watchedCondition, this.world)) {
        this.completeCurrentAction(true);
      }
    }
  }

  // ── Completion and chaining ──────────────────────────

  private completeCurrentAction(success: boolean) {
    const action = this.currentAction;
    if (!action) {
      this.goIdle();
      return;
    }

    this.onActionComplete?.(action, success);

    // Determine what to chain next
    let chainActions: Action[] | undefined;

    if (success) {
      switch (action.type) {
        case 'travel_to': chainActions = action.onArrive; break;
        case 'pursue': chainActions = action.onCatch; break;
        case 'flee_from': chainActions = action.onSafe; break;
        case 'wait_until': chainActions = action.onComplete; break;
        case 'say_to': chainActions = action.onDelivered; break;
        case 'converse_with': chainActions = action.onComplete; break;
      }
    } else {
      switch (action.type) {
        case 'travel_to': chainActions = action.onFail; break;
        case 'pursue': chainActions = action.onTimeout; break;
        case 'wait_until': chainActions = action.onTimeout; break;
      }
    }

    this.currentAction = null;
    this.currentPath = [];
    this.pathIndex = 0;
    this.watchedCondition = null;

    if (chainActions && chainActions.length > 0) {
      this.actionQueue = [...chainActions, ...this.actionQueue];
    }

    this.advanceQueue();
  }

  private advanceQueue() {
    if (this.actionQueue.length > 0) {
      const next = this.actionQueue.shift()!;
      this.startAction(next);
    } else {
      this.goIdle();
    }
  }

  private goIdle() {
    // If we just finished a pursuit for a converse_with, dispatch the event
    if (this.pendingConverse) {
      const { target, purpose } = this.pendingConverse;
      this.pendingConverse = null;
      this.state = 'conversing';
      // currentAction stays as the converse_with so conversationEnded() can complete it
      window.dispatchEvent(new CustomEvent('npc-wants-converse', {
        detail: { npcId: this.npc.id, targetName: target, purpose },
      }));
      return;
    }

    this.state = 'idle';
    this.currentAction = null;
    this.currentPath = [];
    this.pathIndex = 0;
    this.onBecomeIdle?.();
  }

  /** Reset all state — cancel any current activity. */
  clearCurrent() {
    this.state = 'idle';
    this.currentAction = null;
    this.currentPath = [];
    this.pathIndex = 0;
    this.actionQueue = [];
    this.pendingConverse = null;
    this.watchedCondition = null;
    this.waitTimer = 0;
    this.repathTimer = 0;
    this.conditionCheckTimer = 0;
    this.observations = [];
  }

  /** Collect observations about entities encountered during movement. */
  private collectMovementObservations() {
    const nearby = this.entityManager.getEntitiesNear(
      this.npc.tilePos.x, this.npc.tilePos.y, 3,
    );
    for (const entity of nearby) {
      if (entity === this.npc) continue;
      const note = `Noticed ${entity.name} at (${entity.tilePos.x},${entity.tilePos.y})`;
      if (!this.observations.includes(note)) {
        this.observations.push(note);
      }
    }
  }

  /** External signal that conversation has ended (from ConversationManager). */
  conversationEnded() {
    if (this.state === 'conversing') {
      this.completeCurrentAction(true);
    }
  }

  /** Check if the machine is idle (available for new work). */
  isIdle(): boolean {
    return this.state === 'idle';
  }
}
