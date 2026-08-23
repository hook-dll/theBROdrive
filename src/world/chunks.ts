import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../core/physics';
import type { GameWorld } from '../game/state';
import type { Road } from './road';
import type { Terrain } from './terrain';

/**
 * World streaming spine.
 *
 * The infinite-feeling desert is a finite set of arclength slices. Each slice is a
 * chunk `CHUNK_LENGTH` metres of road. A small set of providers turns a chunk index
 * into geometry + physics; the streamer owns which chunks are alive, and tears them
 * down cleanly (geometry, materials, colliders, surface-registry entries) when they
 * leave range. Everything is a pure function of the seed, so rebuilding a chunk
 * after unloading reproduces it exactly.
 */

/** Metres of arclength per chunk. Must divide NODE_SPACING for watertight road seams. */
export const CHUNK_LENGTH = 200;

/** Chunks of scenery kept alive either side of the player. */
const VISUAL_RADIUS = 6;
/** Chunks that carry physics colliders either side of the player. */
const PHYSICS_RADIUS = 2;
/** Max chunks built per update, so crossing a boundary never hitches. */
const BUILD_BUDGET = 2;

export interface ChunkContext {
  chunkIndex: number;
  sStart: number;
  sEnd: number;
  road: Road;
  terrain: Terrain;
  physics: PhysicsWorld;
  world: GameWorld;
  /** False for far scenery: skip colliders and physics-only work. */
  hasPhysics: boolean;
}

export interface ChunkContent {
  group: THREE.Group;
  /**
   * Rigid bodies created by this chunk. The streamer removes these via
   * `physics.removeBody`, which forgets their surface-registry entries and drops
   * the body together with all of its colliders. Providers MUST resolve the fixed
   * parent of any static collider (`collider.parent()`) and put it here — static
   * collider constructors return only the collider, not the body.
   */
  bodies: RAPIER.RigidBody[];
  /** Informational; the streamer removes via `bodies`, never this array. */
  colliders: RAPIER.Collider[];
  /**
   * Provider-specific cleanup for everything the provider created and owns.
   *
   * The streamer disposes NOTHING it did not create itself. Each provider must
   * dispose its own per-chunk resources here — geometry and materials it built
   * fresh for this chunk. It must NOT dispose shared module-level resources
   * (cached geometries/materials reused across chunks), and must NOT remove
   * physics bodies (the streamer already does that via `bodies`).
   */
  dispose?: () => void;
  /**
   * Night-time lamp state for providers that own lamps. Called from the render
   * loop with the shared night factor (0..1, from the sky) and the camera
   * position; providers without lamps simply omit it.
   */
  setLamps?(on: number, nearX: number, nearZ: number): void;
}

export interface ChunkProvider {
  readonly id: string;
  /**
   * Build this chunk's contribution. The provider owns everything it creates:
   * it must clean up its per-chunk geometry/materials via the returned
   * `ChunkContent.dispose()`. The streamer never disposes provider resources.
   */
  build(ctx: ChunkContext): ChunkContent | null;
}

interface BuiltChunk {
  index: number;
  hasPhysics: boolean;
  contents: ChunkContent[];
}

export class ChunkStreamer {
  private readonly providers: ChunkProvider[] = [];
  private readonly built = new Map<number, BuiltChunk>();
  private readonly buildQueue: number[] = [];
  private readonly lastChunkIndex: number;
  /** Increments only when scene-owned lamp sources are added or removed. */
  private lightRevision = 0;

  constructor(
    private readonly road: Road,
    private readonly terrain: Terrain,
    private readonly physics: PhysicsWorld,
    private readonly world: GameWorld,
    private readonly scene: THREE.Scene,
  ) {
    this.lastChunkIndex = Math.floor((road.length - 1) / CHUNK_LENGTH);
  }

  register(provider: ChunkProvider): void {
    this.providers.push(provider);
  }

  get lampRevision(): number {
    return this.lightRevision;
  }

  /**
   * Push the shared night state into every live chunk that owns lamps. Cheap:
   * each provider does its own nearest-fixture selection over per-chunk lists.
   */
  setLamps(on: number, nearX: number, nearZ: number): void {
    for (const chunk of this.built.values()) {
      for (const content of chunk.contents) content.setLamps?.(on, nearX, nearZ);
    }
  }

  update(playerS: number): void {    const clamped = Math.min(Math.max(playerS, 0), this.road.length);
    const playerChunk = Math.min(Math.floor(clamped / CHUNK_LENGTH), this.lastChunkIndex);
    // Chunks may leave the road's own range: negative indices apron the desert
    // behind s = 0 and indices past the end apron the road's termination. The
    // terrain provider fills those; every other provider sees an empty road range
    // (see `build`) and contributes nothing, exactly as if it had never run.
    const min = playerChunk - VISUAL_RADIUS;
    const max = playerChunk + VISUAL_RADIUS;

    // Tear down anything that left the visual window, or whose physics status no
    // longer matches its distance (physics and visual radii differ, so a chunk can
    // need its colliders added or dropped without leaving view).
    for (const [index, chunk] of this.built) {
      const wanted = index >= min && index <= max;
      const needsPhysics = Math.abs(index - playerChunk) <= PHYSICS_RADIUS;
      if (!wanted || chunk.hasPhysics !== needsPhysics) {
        this.teardown(chunk);
        this.lightRevision++;
        this.built.delete(index);
      }
    }

    // Rebuild the queue nearest-first each frame. It is tiny (at most 2*radius+1
    // entries) and this keeps build priority correct as the player moves.
    this.buildQueue.length = 0;
    for (let d = 0; d <= VISUAL_RADIUS; d++) {
      const back = playerChunk - d;
      const front = playerChunk + d;
      if (back >= min && back <= max && !this.built.has(back)) this.buildQueue.push(back);
      if (d !== 0 && front >= min && front <= max && !this.built.has(front)) {
        this.buildQueue.push(front);
      }
    }

    let budget = BUILD_BUDGET;
    while (budget > 0 && this.buildQueue.length > 0) {
      const index = this.buildQueue.shift()!;
      if (this.built.has(index)) continue;
      this.build(index, Math.abs(index - playerChunk) <= PHYSICS_RADIUS);
      budget--;
    }
  }

  private build(index: number, hasPhysics: boolean): void {
    // `sStart`/`sEnd` are the road-relevant part of the chunk, clamped into the
    // road's extent. A chunk wholly outside the road therefore gets an empty range
    // (`sEnd <= sStart`), which is what makes the road/prop/POI/monument/homestead
    // providers return nothing there. The terrain provider derives its apron extent
    // from `chunkIndex` instead, so it still builds in those chunks.
    const ctx: ChunkContext = {
      chunkIndex: index,
      sStart: Math.max(0, index * CHUNK_LENGTH),
      sEnd: Math.min((index + 1) * CHUNK_LENGTH, this.road.length),
      road: this.road,
      terrain: this.terrain,
      physics: this.physics,
      world: this.world,
      hasPhysics,
    };

    const contents: ChunkContent[] = [];
    for (const provider of this.providers) {
      const content = provider.build(ctx);
      if (content) {
        this.scene.add(content.group);
        contents.push(content);
      }
    }
    this.built.set(index, { index, hasPhysics, contents });
    this.lightRevision++;
  }

  private teardown(chunk: BuiltChunk): void {
    for (const content of chunk.contents) {
      this.scene.remove(content.group);
      for (const body of content.bodies) this.physics.removeBody(body);
      // The streamer disposes nothing else: geometry and materials are the
      // provider's own (and often shared at module level across chunks), so each
      // provider cleans up what it created inside `content.dispose()`.
      content.dispose?.();
    }
  }

  dispose(): void {
    for (const [, chunk] of this.built) this.teardown(chunk);
    this.built.clear();
    this.buildQueue.length = 0;
  }
}
