import type { NPC } from '../entities/NPC';
import type { EntityManager } from '../entities/EntityManager';

export class AgentLoop {
    public npc: NPC;
    public entityManager: EntityManager;
    private paused = false;

    constructor(npc: NPC, entityManager: EntityManager) {
        this.npc = npc;
        this.entityManager = entityManager;
    }

    pause() { this.paused = true; }
    resume() { this.paused = false; }
    restart() { this.paused = false; }

    update(_time: number, _delta: number) {
        if (this.paused) return;
        // Will be replaced by BehaviorMachine integration in Phase 1
    }
}
