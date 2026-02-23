import type { EntityManager } from '../entities/EntityManager';
import type { TilePos } from '../entities/Entity';
import { findPath } from '../ai/Pathfinding';

export interface EntityInfo {
  id: string;
  name: string;
  position: TilePos;
  isNPC: boolean;
  isPlayer: boolean;
}

export class WorldQuery {
  private entityManager: EntityManager;

  constructor(entityManager: EntityManager) {
    this.entityManager = entityManager;
  }

  /** Get position of any entity by name. Returns null if not found. */
  getEntityPosition(name: string): TilePos | null {
    const entity = this.entityManager.getAll()
      .find(e => e.name.toLowerCase() === name.toLowerCase());
    return entity ? { ...entity.tilePos } : null;
  }

  /** Manhattan distance between two named entities. Null if either not found. */
  getEntityDistance(nameA: string, nameB: string): number | null {
    const posA = this.getEntityPosition(nameA);
    const posB = this.getEntityPosition(nameB);
    if (!posA || !posB) return null;
    return Math.abs(posA.x - posB.x) + Math.abs(posA.y - posB.y);
  }

  /** Euclidean distance between two named entities. */
  getEntityEuclideanDistance(nameA: string, nameB: string): number | null {
    const posA = this.getEntityPosition(nameA);
    const posB = this.getEntityPosition(nameB);
    if (!posA || !posB) return null;
    const dx = posA.x - posB.x;
    const dy = posA.y - posB.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** True if two entities are within 1 tile (horizontally/vertically adjacent). */
  isEntityAdjacent(nameA: string, nameB: string): boolean {
    const dist = this.getEntityDistance(nameA, nameB);
    return dist !== null && dist <= 1;
  }

  /** True if entity is within `range` tiles (euclidean). */
  isEntityWithinRange(name: string, of: string, range: number): boolean {
    const dist = this.getEntityEuclideanDistance(name, of);
    return dist !== null && dist <= range;
  }

  /** Get all entities in the world. */
  getAllEntities(): EntityInfo[] {
    return this.entityManager.getAll().map(e => ({
      id: e.name.toLowerCase().replace(/\s+/g, '_'),
      name: e.name,
      position: { ...e.tilePos },
      isNPC: 'id' in e && e.name !== 'Player',
      isPlayer: e.name === 'Player',
    }));
  }

  /** Get entities within radius of a position. */
  getEntitiesInRadius(center: TilePos, radius: number): EntityInfo[] {
    return this.entityManager.getEntitiesNear(center.x, center.y, radius)
      .map(e => ({
        id: e.name.toLowerCase().replace(/\s+/g, '_'),
        name: e.name,
        position: { ...e.tilePos },
        isNPC: 'id' in e && e.name !== 'Player',
        isPlayer: e.name === 'Player',
      }));
  }

  /** Get all NPC names (excludes Player). */
  getNPCNames(): string[] {
    return this.getAllEntities().filter(e => e.isNPC).map(e => e.name);
  }

  /** Get all entity names (includes Player). */
  getEntityNames(): string[] {
    return this.getAllEntities().map(e => e.name);
  }

  /** Delegate to EntityManager. */
  isWalkable(x: number, y: number): boolean {
    return this.entityManager.isWalkable(x, y);
  }

  /** Get A* path length between two positions (returns Infinity if no path). */
  getPathLength(from: TilePos, to: TilePos): number {
    const path = findPath(from, to, this.entityManager.isWalkable);
    return path.length > 0 ? path.length : Infinity;
  }

  /** World constants. */
  getWorldConstants() {
    return {
      mapWidth: 64,
      mapHeight: 64,
      speechRange: 2,
      perceptionRange: 15,
      conversationRange: 3,
      movementSpeedMs: 180,
      tileSize: { w: 64, h: 32 },
    };
  }

  /** Build a text summary of the world state for a specific NPC. */
  buildWorldSummaryFor(npcName: string): string {
    const npcPos = this.getEntityPosition(npcName);
    if (!npcPos) return '';

    const constants = this.getWorldConstants();
    const allEntities = this.getAllEntities().filter(e => e.name !== npcName);

    const entityLines = allEntities.map(e => {
      const dist = this.getEntityEuclideanDistance(npcName, e.name);
      const distStr = dist !== null ? `${Math.round(dist)} tiles away` : 'unknown distance';
      const adjacent = this.isEntityAdjacent(npcName, e.name) ? ' [ADJACENT]' : '';
      const inRange = dist !== null && dist <= constants.perceptionRange ? '' : ' [OUT OF PERCEPTION]';
      return `  - ${e.name} at (${e.position.x}, ${e.position.y}), ${distStr}${adjacent}${inRange}`;
    });

    return [
      `You are ${npcName}, at position (${npcPos.x}, ${npcPos.y}).`,
      `World: ${constants.mapWidth}×${constants.mapHeight} tile grid. Tiles are grass (walkable) or water (blocked).`,
      `Your capabilities:`,
      `  - Move 1 tile at a time (~${constants.movementSpeedMs}ms per tile)`,
      `  - Speech bubbles visible within ${constants.speechRange} tiles`,
      `  - Can detect entities within ${constants.perceptionRange} tiles`,
      `  - Can start conversations within ${constants.conversationRange} tiles`,
      `  - Can query any entity's position (global knowledge)`,
      ``,
      `All entities:`,
      ...entityLines,
    ].join('\n');
  }
}
