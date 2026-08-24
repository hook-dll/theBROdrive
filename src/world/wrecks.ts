import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../core/physics';
import type { CarState, GameWorld } from '../game/state';
import { carModel } from '../vehicle/carmodels';
import { variant } from '../parts/registry';
import type { Item } from '../items/items';

/**
 * Derelicts that can be brought back to life, and the one place that knows which
 * collider is which.
 *
 * Cars are not spawned from a menu — they are found. A `roadside_wrecks` POI is
 * mostly scenery, but some of them hide one derelict that still turns over, and
 * the whole car supply of the game runs through here.
 *
 * Ownership is split deliberately:
 *  - Which wrecks EXIST is a pure function of the seed, decided in `poi.ts`.
 *  - Which have been revived is player state (`WorldState.revivedWrecks`).
 *  - The shell, its collider and the collider-to-id map are per-chunk runtime
 *    views, registered on build and dropped when the chunk unloads. A revived
 *    wreck's shell is torn down the instant it becomes a car, which is why the
 *    entry keeps the chunk's own `bodies` array: the body has to come out of it
 *    or the streamer would remove an already-removed body on teardown.
 *
 * Revival progress is deliberately NOT persisted. Walking away from a half-freed
 * car and coming back to it reset is a smaller sin than a save file that grows a
 * field per derelict the player poked at.
 */

/** A derelict that can be revived, as decided by the seed. */
export interface RevivableWreck {
  /** Deterministic and stable across sessions: `wreck:<poiIndex>:<slot>`. */
  readonly id: string;
  readonly modelId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Heading the shell is sitting at, so the revived car keeps its pose. */
  readonly yaw: number;
}

interface WreckEntry {
  readonly wreck: RevivableWreck;
  readonly shell: THREE.Object3D;
  readonly body: RAPIER.RigidBody;
  readonly colliderHandle: number;
  /** The owning chunk's body array, so revival can take the body back out of it. */
  readonly chunkBodies: RAPIER.RigidBody[];
}

/** Seconds of wrench work to free one up. Long enough to feel like labour. */
export const WRECK_REVIVE_SECONDS = 6;

export class WreckField {
  private readonly entries = new Map<string, WreckEntry>();
  private readonly colliderToWreckId = new Map<number, string>();
  /** Session-only wrench progress, 0..1 per wreck id. */
  private readonly progress = new Map<string, number>();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly world: GameWorld,
  ) {}

  /**
   * Records a live shell so the player can aim at it. Called from the POI builder
   * once per revivable derelict that has not already been driven away.
   */
  register(
    wreck: RevivableWreck,
    shell: THREE.Object3D,
    body: RAPIER.RigidBody,
    collider: RAPIER.Collider,
    chunkBodies: RAPIER.RigidBody[],
  ): void {
    this.entries.set(wreck.id, {
      wreck,
      shell,
      body,
      colliderHandle: collider.handle,
      chunkBodies,
    });
    this.colliderToWreckId.set(collider.handle, wreck.id);
  }

  /** Drops every registration whose collider belongs to an unloading chunk. */
  forgetChunk(chunkBodies: RAPIER.RigidBody[]): void {
    for (const [id, entry] of this.entries) {
      if (entry.chunkBodies !== chunkBodies) continue;
      this.colliderToWreckId.delete(entry.colliderHandle);
      this.entries.delete(id);
      // Progress is dropped with the chunk: a wreck 12 chunks behind you is not
      // half-freed any more, and keeping the number would leak a map entry per
      // derelict ever approached over a 400 km drive.
      this.progress.delete(id);
    }
  }

  wreckIdForCollider(colliderHandle: number): string | null {
    return this.colliderToWreckId.get(colliderHandle) ?? null;
  }

  wreck(id: string): RevivableWreck | null {
    return this.entries.get(id)?.wreck ?? null;
  }

  /** Every registered live wreck. Used by the dev inspection hook. */
  all(): RevivableWreck[] {
    return [...this.entries.values()].map((e) => e.wreck);
  }

  /** 0..1 of the wrench work done on this wreck in this session. */
  progressOf(id: string): number {
    return this.progress.get(id) ?? 0;
  }

  /**
   * Advances wrench work. Returns the freed car once the work completes, null
   * while it is still in progress or if the id is not a live wreck.
   */
  advance(id: string, dt: number): CarState | null {
    if (!this.entries.has(id)) return null;
    const next = this.progressOf(id) + dt / WRECK_REVIVE_SECONDS;
    if (next < 1) {
      this.progress.set(id, next);
      return null;
    }
    return this.revive(id);
  }

  /**
   * Turns a derelict into a car: tears the static shell down and records the car
   * at the same pose with a dry tank.
   *
   * Dry is the point. A found car is a car you have to carry fuel to, which is
   * what makes the fuel cans at a gas stop worth stopping for.
   */
  private revive(id: string): CarState | null {
    const entry = this.entries.get(id);
    if (!entry) return null;

    // Take the body out of the chunk's array BEFORE removing it, or the streamer
    // will remove the same handle again when the chunk unloads.
    const at = entry.chunkBodies.indexOf(entry.body);
    if (at >= 0) entry.chunkBodies.splice(at, 1);
    this.physics.removeBody(entry.body);
    entry.shell.removeFromParent();

    this.colliderToWreckId.delete(entry.colliderHandle);
    this.entries.delete(id);
    this.progress.delete(id);

    const w = entry.wreck;
    const half = w.yaw / 2;
    const def = carModel(w.modelId);
    const engine = variant(def.engineId).engine;
    const car: CarState = {
      id: this.world.runtimePartId(),
      modelId: w.modelId,
      gizmos: {},
      stickers: [],
      fuelLitres: 0,
      // Dry of everything, not just fuel. A derelict is a derelict: the whole point
      // of freeing one is that you then have to supply it.
      coolantLitres: 0,
      oilLitres: 0,
      storage: new Array<Item | null>(def.storageCells).fill(null),
      odometer: 0,
      x: w.x,
      y: w.y,
      z: w.z,
      qx: 0,
      qy: Math.sin(half),
      qz: 0,
      qw: Math.cos(half),
    };
    this.world.apply({ t: 'wreck_revived', wreckId: id });
    this.world.apply({ t: 'car_add', car });
    return car;
  }

  /** Catalogue label for prompts, without the caller importing the catalogue. */
  labelFor(id: string): string | null {
    const wreck = this.wreck(id);
    return wreck ? carModel(wreck.modelId).label : null;
  }
}
