import { Scene } from 'phaser';
import { Entity, TilePos } from './Entity';
import { Action } from '../ai/types';
import { AgentLoop } from '../ai/AgentLoop';
import { BehaviorMachine } from '../ai/BehaviorMachine';
import type { ProtocolAgent } from '../protocol/ProtocolAgent';
import type { EntityManager } from './EntityManager';
import type { WorldQuery } from '../world/WorldQuery';
import { log as logEvent } from '../ui/EventLog';

export class NPC extends Entity {
    readonly id: string;
    isInConversation = false;
    currentSkill: string | null = null;
    recentEvents: string[] = [];

    behaviorMachine!: BehaviorMachine;
    protocolAgent?: ProtocolAgent;
    private agentLoop?: AgentLoop;
    private completionCheckAccum = 0;

    constructor(
        scene: Scene,
        map: Phaser.Tilemaps.Tilemap,
        startTile: TilePos,
        checkWalkable: (x: number, y: number) => boolean,
        name: string,
        tint: number,
    ) {
        super(scene, map, 'player', startTile, checkWalkable, name);
        this.id = name.toLowerCase().replace(/\s+/g, '_');
        this.sprite.setTint(tint);
    }

    initAgentLoop(entityManager: EntityManager) {
        this.agentLoop = new AgentLoop(this, entityManager);
    }

    initBehaviorMachine(world: WorldQuery, entityManager: EntityManager) {
        this.behaviorMachine = new BehaviorMachine(this, world, entityManager);
    }

    pauseAI() { this.agentLoop?.pause(); }
    resumeAI() { this.agentLoop?.resume(); }

    restartAI(startTile: TilePos) {
        this.agentLoop?.restart();
        this.recentEvents = [];
        this.currentSkill = null;
        this.isInConversation = false;
        this.tilePos = { ...startTile };
        const worldPos = this.map.tileToWorldXY(startTile.x, startTile.y)!;
        this.sprite.setPosition(worldPos.x + 32, worldPos.y + 16);
        this.updateDepth();
    }

    /** Backwards-compatible: converts action array into a sequence for BehaviorMachine. */
    setPlan(actions: Action[]) {
        if (actions.length > 0) {
            this.behaviorMachine.execute({ type: 'sequence', actions });
        }
    }

    update(time: number, delta: number) {
        this.agentLoop?.update(time, delta);
        this.behaviorMachine?.update(time, delta);

        // Periodically check mechanical completion conditions (~500ms)
        this.completionCheckAccum += delta;
        if (this.completionCheckAccum >= 500) {
            this.completionCheckAccum = 0;
            this.protocolAgent?.checkCompletions();
        }
    }

    addEvent(event: string) {
        this.recentEvents.push(event);
        if (this.recentEvents.length > 20) {
            this.recentEvents.shift();
        }
        logEvent(this.name, 'action', event, { npcId: this.id });
    }
}
