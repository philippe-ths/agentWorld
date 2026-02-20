import { Scene } from 'phaser';
import { Entity, TilePos } from './Entity';
import { Action } from '../ai/types';
import { AgentLoop } from '../ai/AgentLoop';
import type { EntityManager } from './EntityManager';

export class NPC extends Entity {
    readonly id: string;
    currentPlan: Action[] = [];
    private planIndex = 0;
    private waitTimer = 0;
    private planHadFailure = false;
    isInConversation = false;
    currentSkill: string | null = null;
    recentEvents: string[] = [];

    // Callback fired when the NPC finishes its current plan
    onPlanComplete?: (hadFailure: boolean) => void;
    private agentLoop?: AgentLoop;

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

    setPlan(actions: Action[]) {
        this.currentPlan = actions;
        this.planIndex = 0;
        this.waitTimer = 0;
        this.planHadFailure = false;
    }

    update(_time: number, delta: number) {
        // Run agent loop (medium-loop timer)
        this.agentLoop?.update(_time, delta);

        if (this.planIndex >= this.currentPlan.length) {
            // Plan exhausted — notify
            if (this.currentPlan.length > 0) {
                const hadFailure = this.planHadFailure;
                this.currentPlan = [];
                this.planIndex = 0;
                this.onPlanComplete?.(hadFailure);
            }
            return;
        }

        const action = this.currentPlan[this.planIndex];

        switch (action.type) {
            case 'move':
                if (this.isMoving) return; // wait for current tween
                this.executeMove(action.target);
                break;
            case 'wait':
                this.waitTimer += delta;
                if (this.waitTimer >= action.duration) {
                    this.waitTimer = 0;
                    this.planIndex++;
                }
                break;
            case 'speak':
                this.executeSpeech(action.text);
                break;
        }
    }

    private executeMove(target: TilePos) {
        const dx = Math.sign(target.x - this.tilePos.x);
        const dy = Math.sign(target.y - this.tilePos.y);

        // Prefer the axis with larger distance
        let moved = false;
        if (Math.abs(target.x - this.tilePos.x) >= Math.abs(target.y - this.tilePos.y)) {
            if (dx !== 0) moved = this.moveTo(dx, 0);
            if (!moved && dy !== 0) moved = this.moveTo(0, dy);
        } else {
            if (dy !== 0) moved = this.moveTo(0, dy);
            if (!moved && dx !== 0) moved = this.moveTo(dx, 0);
        }

        // Check if we reached the target tile
        if (this.tilePos.x === target.x && this.tilePos.y === target.y) {
            this.planIndex++;
        } else if (!moved) {
            // Stuck — skip this move action
            this.planIndex++;
            this.planHadFailure = true;
            this.addEvent('stuck while moving');
        }
    }

    private executeSpeech(text: string) {
        this.say(text);
        this.addEvent(`said: "${text}"`);
        this.planIndex++;
    }

    addEvent(event: string) {
        this.recentEvents.push(event);
        if (this.recentEvents.length > 20) {
            this.recentEvents.shift();
        }
    }
}
