import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../core/physics';
import type { GameWorld } from '../game/state';
import type { Road } from './road';
import type { Terrain } from './terrain';
import type { WorldOrigin } from './origin';
import { WorldWorkScheduler } from './workqueue';
import { CHUNK_LENGTH, ROAD_PHYSICS_CHUNKS, ROAD_VISUAL_CHUNKS } from './ranges';
import { InstanceBatches } from './props/instancebatch';

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

/** Past this lateral distance NEW road content is built without physics or prop colliders. */
const ROAD_PHYSICS_REACH = 1200;

/**
 * Stops Three recomputing the local matrices of a finished, static subtree every frame.
 *
 * Streamed scenery never moves once it is built: every chunk and tile is placed once
 * and then only its ROOT is shifted, by a rebase. Left on automatic, `updateMatrixWorld`
 * still recomposed the local matrix of every one of those nodes on every render — 566
 * of the scene's 928 nodes in a measured drive. Freezing keeps the world matrices exact:
 * a frozen child is still re-multiplied whenever its parent's world matrix changes, so
 * whoever moves a frozen root afterwards (a rebase) only has to call its `updateMatrix`.
 */
export function freezeStaticSubtree(root: THREE.Object3D): void {
  root.traverse((object) => {
    object.matrixAutoUpdate = false;
    object.updateMatrix();
  });
}

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
  /**
   * The floating origin at the moment this contribution is built (see `world/origin.ts`).
   *
   * Every vertex a provider writes into a `Float32Array`, and every position it hands
   * to Rapier, MUST have these subtracted: f32 cannot hold an absolute coordinate this
   * far from (0, 0) without quantising the road surface into steps. Providers keep
   * sampling the road, the terrain and every noise field at ABSOLUTE coordinates — the
   * subtraction happens only where the number is about to be stored in f32.
   *
   * A snapshot, not a live reference, and deliberately so: it is the frame this
   * contribution's geometry is expressed in for as long as it lives, and the streamer
   * corrects for any later origin move by shifting its group. It is always the origin
   * current when the build starts: a rebase cancels any build still in flight, so one
   * build never spans two frames — but two contributions of one chunk may be written in
   * different ones.
   */
  originX: number;
  originZ: number;
  /** The shared instance batches that prop geometry takes slots in (`props/instancebatch.ts`). */
  batches: InstanceBatches;
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
  /**
   * Every collider this chunk created, in the order it created them.
   *
   * The streamer removes via `bodies`, never this array — but it does ENABLE via
   * this array. Providers build colliders disabled and hand them over here; the
   * streamer switches them on in `attachContent`, i.e. in the same call that puts
   * the chunk's visuals in the scene. A provider therefore cannot leak a live
   * collider from a half-built chunk, and — the bug this replaced — cannot forget
   * to switch its own colliders on either.
   */
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
   * Registers what this contribution names BY ID in a shared registry (fixtures, lot
   * signs, a car it adds to the world). Called by the streamer in `attachContent`, the
   * call that puts the group in the scene and enables its colliders — after the
   * contribution it replaces, if any, has been disposed, so that one's `dispose`
   * forgetting the same ids cannot take this one's entries with it.
   */
  attach?: () => void;
  /**
   * Night-time state for providers with emissive fixtures (the reflector posts).
   * Called from the render loop with the shared night factor (0..1, from the sky);
   * providers without any simply omit it.
   */
  setLamps?(on: number): void;
}

export interface ChunkProvider {
  readonly id: string;
  /**
   * Builds this chunk's contribution atomically, inside one scheduler job. Providers
   * whose work does not fit a job slice (`WORLD_JOB_SLICE_MS`) must implement
   * `buildSteps` instead; this remains for providers whose work is already bounded and
   * for synchronous callers (the labs and tools).
   */
  build(ctx: ChunkContext): ChunkContent | null;
  /**
   * Incrementally builds this chunk's contribution. Each scheduler job advances the
   * iterator until its deadline; the returned content is attached only once it
   * completes, so colliders made along the way must be built disabled (see
   * `ChunkContent.colliders`).
   *
   * A PROMOTION (see `ChunkPromotion`) runs this beside the same provider's live
   * visual-only contribution for the same chunk, and swaps the two only when the
   * physical one completes. Anything a `buildSteps` provider registers BY ID in a shared
   * registry must therefore be registered by its physical build only — as the scatter's
   * breakables and ground cover are — or in its content's `attach`, or the visual-only
   * contribution's disposal would forget its replacement's entry. Shared instance-batch
   * slots may coexist: both contributions draw the same instances for the few frames
   * the replacement builds.
   */
  buildSteps?(ctx: ChunkContext): Iterator<void, ChunkContent | null>;
}

interface BuiltContent {
  readonly providerId: string;
  readonly content: ChunkContent;
  /**
   * The floating origin this contribution's vertices and colliders were written in.
   * Per contribution, not per chunk: a build restarted after a rebase, or a promotion,
   * writes later contributions of the same chunk in a newer frame.
   */
  readonly originX: number;
  readonly originZ: number;
}

/**
 * What an in-flight incremental build is for: a chunk's first contribution from a
 * provider, or the physical replacement of one built visual-only.
 */
type BuildPurpose = 'construct' | 'promote';

interface ActiveProviderBuild {
  readonly provider: ChunkProvider;
  readonly purpose: BuildPurpose;
  readonly iterator: Iterator<void, ChunkContent | null>;
  /** The origin the iterator's context was made in; a rebase cancels the build. */
  readonly originX: number;
  readonly originZ: number;
}

/** A provider build that has finished; `content` is null when it contributes nothing. */
interface FinishedBuild {
  readonly content: ChunkContent | null;
  readonly originX: number;
  readonly originZ: number;
}

/**
 * The in-place physics upgrade of contributions that were built visual-only.
 *
 * Providers `[next, end)` still hold their visual-only contribution. Each is replaced,
 * in provider order and through the ordinary scheduler, by a physical build, and the
 * old contribution stays in the scene until its replacement is complete: an atomic
 * provider is replaced inside one job, an incremental one is built beside its old
 * contribution and the two change places inside the job that completes it. The chunk
 * therefore never stops drawing a contribution it had, and never draws two groups of
 * one provider.
 */
interface ChunkPromotion {
  next: number;
  readonly end: number;
}

/**
 * One road chunk, through its states:
 *
 *   CONSTRUCTING  `!complete`: providers run in order, one job at a time from the
 *                 `nextProvider` cursor; each contribution is attached as it completes.
 *   COMPLETE      every provider has run once. Visual readiness counts these.
 *   PROMOTING     `promotion !== null`: physics was switched on (`hasPhysics`, so every
 *                 build from here on is physical) after some providers had already run
 *                 without it; those are being replaced (see ChunkPromotion). A chunk
 *                 still under construction promotes the providers that had run, and
 *                 then resumes construction — physically.
 *
 * SETTLED = complete with no promotion: the chunk carries every contribution and all
 * the physics it will carry. Physics only ever goes on, never off.
 */
interface BuiltChunk {
  readonly index: number;
  /** Whether builds of this chunk are physical (`ChunkContext.hasPhysics`); only ever turns on. */
  hasPhysics: boolean;
  /** Attached contributions, in provider order. */
  contents: BuiltContent[];
  /** Construction cursor: providers `[0, nextProvider)` have run once. */
  nextProvider: number;
  /** Exactly one provider generator may own partial resources at a time. */
  activeBuild?: ActiveProviderBuild;
  complete: boolean;
  promotion: ChunkPromotion | null;
}

export class ChunkStreamer {
  private readonly providers: ChunkProvider[] = [];
  private readonly built = new Map<number, BuiltChunk>();
  /** The last update's chunks with work left, most urgent first. */
  private readonly buildQueue: number[] = [];
  private readonly lastChunkIndex: number;
  private previousPlayerS: number | null = null;
  private travelDirection: -1 | 0 | 1 = 0;
  private readonly batches: InstanceBatches;

  constructor(
    private readonly road: Road,
    private readonly terrain: Terrain,
    private readonly physics: PhysicsWorld,
    private readonly world: GameWorld,
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
    private readonly scheduler: WorldWorkScheduler,
  ) {
    this.lastChunkIndex = Math.floor((road.length - 1) / CHUNK_LENGTH);
    this.batches = new InstanceBatches(origin);
    this.scene.add(this.batches.root);
  }

  /**
   * Appends a provider. Live chunks fall back to CONSTRUCTING; their cursors stand
   * where they were, so the next jobs run exactly the new provider for each.
   */
  register(provider: ChunkProvider): void {
    this.providers.push(provider);
    for (const chunk of this.built.values()) chunk.complete = false;
    if (this.built.size > 0) this.scheduler.setPending('road', true);
  }

  /**
   * Completed chunks against the visual window the last update asked for.
   *
   * Boot reports and waits on this: `hasPending` alone cannot tell "nothing queued
   * yet" from "everything built", and a resumed drive must not start over chunks
   * that have not run a single provider.
   */
  get readiness(): { readonly ready: number; readonly wanted: number } {
    const clamped = Math.min(Math.max(this.previousPlayerS ?? 0, 0), this.road.length);
    const playerChunk = Math.min(Math.floor(clamped / CHUNK_LENGTH), this.lastChunkIndex);
    const min = Math.max(0, playerChunk - ROAD_VISUAL_CHUNKS);
    const max = Math.min(this.lastChunkIndex, playerChunk + ROAD_VISUAL_CHUNKS);
    let ready = 0;
    for (let index = min; index <= max; index++) {
      if (this.built.get(index)?.complete) ready++;
    }
    return { ready, wanted: max - min + 1 };
  }

  /** Push the shared night factor into every live chunk that has emissive fixtures. */
  setLamps(on: number): void {
    for (const chunk of this.built.values()) {
      for (const entry of chunk.contents) entry.content.setLamps?.(on);
    }
  }

  /**
   * `frameId` must change once per rendered frame and stay equal across every
   * fixed step within it. The shared scheduler enforces the rendered-frame cap.
   *
   * Builds nothing itself: it decides the window, starts promotions, and hands the
   * single most urgent stage to the scheduler as one deadline-bounded job.
   */
  update(playerS: number, frameId: number, playerLateral = 0): void {
    this.scheduler.beginFrame(frameId);
    const clamped = Math.min(Math.max(playerS, 0), this.road.length);
    if (this.previousPlayerS !== null) {
      if (clamped > this.previousPlayerS) this.travelDirection = 1;
      else if (clamped < this.previousPlayerS) this.travelDirection = -1;
    }
    this.previousPlayerS = clamped;

    const playerChunk = Math.min(Math.floor(clamped / CHUNK_LENGTH), this.lastChunkIndex);
    // Chunks may leave the road's own range: every road-owned provider sees an empty
    // range and contributes nothing, while the independent desert tiles continue.
    const min = playerChunk - ROAD_VISUAL_CHUNKS;
    const max = playerChunk + ROAD_VISUAL_CHUNKS;
    const prefetch =
      this.travelDirection === 0 ? null : playerChunk + this.travelDirection * (ROAD_VISUAL_CHUNKS + 1);

    // Tear down anything that left the visual window and is not the one directional
    // lookahead.
    //
    // PHYSICS ONLY EVER GOES ON IN PLACE, NEVER OFF. On the road every chunk is built
    // physical (see ROAD_PHYSICS_CHUNKS), so a physical chunk keeps its colliders until it
    // leaves the window, and the player walking off into the desert leaves them where
    // they are rather than rebuilding thirteen chunks to take them away.
    //
    // A chunk inside the guaranteed band that ran providers without physics — built
    // while the player was out in the desert, or before a teleport — is PROMOTED in
    // place (see ChunkPromotion): its contributions are rebuilt physical one provider at
    // a time by the ordinary queue below, each old one staying in the scene until its
    // replacement is complete. Deleting such a chunk and rebuilding it from nothing made
    // the road and its scenery blink out for as many frames as it has providers; the
    // full synchronous rebuild that replaced that cost 35-50 ms of one frame per chunk
    // found. Ground the player needs on the very next step after being PUT somewhere is
    // `prime`'s job, not this loop's.
    const onRoad = Math.abs(playerLateral) < ROAD_PHYSICS_REACH;
    for (const [index, chunk] of this.built) {
      const wanted = (index >= min && index <= max) || index === prefetch;
      if (!wanted) {
        this.teardown(chunk);
        this.built.delete(index);
        continue;
      }
      const needsPhysics = onRoad && Math.abs(index - playerChunk) <= ROAD_PHYSICS_CHUNKS;
      if (needsPhysics && !chunk.hasPhysics) this.beginPromotion(chunk);
    }

    // Collision-bearing chunks come before scenery prefetches. The current tile is
    // first, then the rest of its physics neighborhood nearest-first, so a promotion
    // or a new physical chunk is never queued behind a lookahead.
    this.buildQueue.length = 0;
    if (this.needsWork(playerChunk)) this.buildQueue.push(playerChunk);
    for (let d = 1; d <= ROAD_PHYSICS_CHUNKS; d++) this.queuePair(playerChunk, d);
    // After physical continuity is covered, start one bounded tile in the travel
    // direction before it enters the visual window.
    if (prefetch !== null && this.needsWork(prefetch)) this.buildQueue.push(prefetch);
    for (let d = ROAD_PHYSICS_CHUNKS + 1; d <= ROAD_VISUAL_CHUNKS; d++) this.queuePair(playerChunk, d);

    const index = this.buildQueue[0];
    if (index !== undefined) {
      this.scheduler.tryRun(frameId, this.jobTag(index), (deadline) => {
        this.runStage(this.chunkAt(index, onRoad), deadline);
      });
    }

    this.syncPending();
  }

  /**
   * Synchronously settles the road chunk containing the player: built if missing,
   * finished if partial, promoted if it needs physics it was built without, and left
   * exactly as it is if already settled.
   *
   * The one synchronous road path, deliberately outside `update`. Boot uses it so the
   * starter objects and the first physics step see the complete start chunk. Anything
   * that PUTS the player somewhere and needs the road solid under them on the next
   * step — a rescue, a teleport — must call it too, because the ordinary queue settles
   * a chunk over several frames.
   */
  prime(playerS: number, playerLateral = 0): void {
    const clamped = Math.min(Math.max(playerS, 0), this.road.length);
    const playerChunk = Math.min(Math.floor(clamped / CHUNK_LENGTH), this.lastChunkIndex);
    const hasPhysics = Math.abs(playerLateral) < ROAD_PHYSICS_REACH;
    this.previousPlayerS = clamped;
    this.travelDirection = 0;
    this.buildQueue.length = 0;

    const chunk = this.chunkAt(playerChunk, hasPhysics);
    if (hasPhysics && !chunk.hasPhysics) this.beginPromotion(chunk);
    try {
      while (!chunk.complete || chunk.promotion !== null) this.runStage(chunk, Number.POSITIVE_INFINITY);
    } catch (error) {
      this.teardown(chunk);
      this.built.delete(playerChunk);
      throw error;
    }
  }

  /** The live chunk at `index`, created (constructing, nothing attached) if there is none. */
  private chunkAt(index: number, hasPhysics: boolean): BuiltChunk {
    let chunk = this.built.get(index);
    if (!chunk) {
      chunk = {
        index,
        hasPhysics,
        contents: [],
        nextProvider: 0,
        complete: this.providers.length === 0,
        promotion: null,
      };
      this.built.set(index, chunk);
    }
    return chunk;
  }

  /** True when the chunk at `index` is missing or not yet settled. */
  private needsWork(index: number): boolean {
    const chunk = this.built.get(index);
    return !chunk || !chunk.complete || chunk.promotion !== null;
  }

  /** Queues the two chunks `d` either side of the player, the travel side first. */
  private queuePair(playerChunk: number, d: number): void {
    const back = playerChunk - d;
    const front = playerChunk + d;
    const first = this.travelDirection < 0 ? back : front;
    const second = this.travelDirection < 0 ? front : back;
    if (this.needsWork(first)) this.buildQueue.push(first);
    if (this.needsWork(second)) this.buildQueue.push(second);
  }

  /** `road:build:<chunk>:<provider>` or `road:promote:<chunk>:<provider>`, for the profiler. */
  private jobTag(index: number): string {
    const chunk = this.built.get(index);
    if (chunk?.promotion) {
      return `road:promote:${index}:${this.providers[chunk.promotion.next]?.id ?? 'complete'}`;
    }
    return `road:build:${index}:${this.providers[chunk?.nextProvider ?? 0]?.id ?? 'complete'}`;
  }

  /**
   * Turns physics on for a chunk that has run providers without it. Builds nothing:
   * every later build of the chunk is physical, and the providers that already ran
   * become a promotion the queue works through.
   */
  private beginPromotion(chunk: BuiltChunk): void {
    chunk.hasPhysics = true;
    // A construction build in flight was started visual-only. Cancelled here, its
    // provider restarts physical when construction resumes and needs no promoting.
    if (chunk.activeBuild?.purpose === 'construct') this.cancelBuild(chunk);
    chunk.promotion = chunk.nextProvider > 0 ? { next: 0, end: chunk.nextProvider } : null;
  }

  /** One job's worth of a chunk. Promotion first: it carries the providers that already ran, road first. */
  private runStage(chunk: BuiltChunk, deadline: number): void {
    if (chunk.promotion) this.runPromotionStage(chunk, chunk.promotion, deadline);
    else if (!chunk.complete) this.runConstructionStage(chunk, deadline);
  }

  private runConstructionStage(chunk: BuiltChunk, deadline: number): void {
    const provider = this.providers[chunk.nextProvider];
    if (!provider) {
      chunk.complete = true;
      return;
    }
    const built = this.buildContribution(chunk, provider, 'construct', deadline);
    if (!built) return;
    chunk.nextProvider++;
    this.addContribution(chunk, provider, built);
    chunk.complete = chunk.nextProvider === this.providers.length;
  }

  private runPromotionStage(chunk: BuiltChunk, promotion: ChunkPromotion, deadline: number): void {
    const provider = this.providers[promotion.next];
    if (provider?.buildSteps) {
      // Built beside the live visual-only contribution, which stays in the scene until
      // this replacement is complete; the two change places within this job.
      const built = this.buildContribution(chunk, provider, 'promote', deadline);
      if (!built) return;
      this.removeContribution(chunk, provider);
      this.addContribution(chunk, provider, built);
    } else if (provider) {
      // One job, so no rendered frame falls between the old contribution leaving and
      // its replacement arriving. Old first: atomic providers register shared ids (the
      // POI's market and fixtures) that the old one's disposal would otherwise forget
      // out from under the new one.
      this.removeContribution(chunk, provider);
      const built = this.buildContribution(chunk, provider, 'promote', deadline);
      if (built) this.addContribution(chunk, provider, built);
    }
    promotion.next++;
    if (promotion.next >= promotion.end) chunk.promotion = null;
  }

  /**
   * Runs `provider` for `chunk`: an atomic provider whole, an incremental one for at
   * least one step and then until `deadline`. Null while an incremental build is still
   * in flight; it resumes on the chunk's next job.
   */
  private buildContribution(
    chunk: BuiltChunk,
    provider: ChunkProvider,
    purpose: BuildPurpose,
    deadline: number,
  ): FinishedBuild | null {
    if (!provider.buildSteps) {
      const ctx = this.context(chunk);
      return { content: provider.build(ctx), originX: ctx.originX, originZ: ctx.originZ };
    }
    let active = chunk.activeBuild;
    if (!active) {
      const ctx = this.context(chunk);
      active = {
        provider,
        purpose,
        iterator: provider.buildSteps(ctx),
        originX: ctx.originX,
        originZ: ctx.originZ,
      };
      chunk.activeBuild = active;
    } else if (active.provider !== provider || active.purpose !== purpose) {
      throw new Error(
        `chunk ${chunk.index}: ${purpose} of ${provider.id} found ${active.purpose} of ${active.provider.id} in flight`,
      );
    }

    let result: IteratorResult<void, ChunkContent | null>;
    try {
      // At least one step, so every job advances its build, then as many as fit.
      result = active.iterator.next();
      while (!result.done && performance.now() < deadline) result = active.iterator.next();
    } catch (error) {
      chunk.activeBuild = undefined;
      throw error;
    }
    if (!result.done) return null;
    chunk.activeBuild = undefined;
    return { content: result.value, originX: active.originX, originZ: active.originZ };
  }

  /** Takes `provider`'s attached contribution, if any, out of the scene and the physics world. */
  private removeContribution(chunk: BuiltChunk, provider: ChunkProvider): void {
    const at = chunk.contents.findIndex((entry) => entry.providerId === provider.id);
    if (at < 0) return;
    this.teardownContent(chunk.contents[at]!.content);
    chunk.contents.splice(at, 1);
  }

  /** Attaches a finished build and files it in provider order. */
  private addContribution(chunk: BuiltChunk, provider: ChunkProvider, built: FinishedBuild): void {
    const content = built.content;
    if (!content) return;
    this.attachContent(content, built.originX, built.originZ);
    const providerIndex = this.providers.indexOf(provider);
    let insertAt = 0;
    while (insertAt < chunk.contents.length) {
      const currentIndex = this.providers.findIndex(
        (candidate) => candidate.id === chunk.contents[insertAt]!.providerId,
      );
      if (currentIndex > providerIndex) break;
      insertAt++;
    }
    chunk.contents.splice(insertAt, 0, {
      providerId: provider.id,
      content,
      originX: built.originX,
      originZ: built.originZ,
    });
  }

  /**
   * Re-express every attached contribution after the floating origin moves, and cancel
   * every build still in flight.
   *
   * Attached contributions stay valid: each recorded the origin it was written in, so
   * only its group offset follows (the groups are frozen, see `attachContent`, so the
   * moved root recomposes its own matrix and its children follow it), and its colliders
   * moved with every other body in `PhysicsWorld.rebase`. A generator part-way through
   * a build does not: it holds geometry and collider input written in the old frame. It
   * is cancelled, and its provider restarts in the current frame on the chunk's next
   * job — the construction or promotion cursor has not moved, and a promotion's
   * visual-only contribution is still live — so a rebase never takes anything drawn or
   * solid away.
   */
  rebase(): void {
    for (const chunk of this.built.values()) {
      this.cancelBuild(chunk);
      for (const entry of chunk.contents) {
        const group = entry.content.group;
        group.position.x = entry.originX - this.origin.x;
        group.position.z = entry.originZ - this.origin.z;
        group.updateMatrix();
      }
    }
    // The batches hold their instances in the origin frame of the page's anchor, so
    // only their own offsets move (see `props/instancebatch.ts`).
    this.batches.rebase();
  }

  /** A build context in the CURRENT origin (see `ChunkContext.originX`). */
  private context(chunk: BuiltChunk): ChunkContext {
    return {
      chunkIndex: chunk.index,
      sStart: Math.max(0, chunk.index * CHUNK_LENGTH),
      sEnd: Math.min((chunk.index + 1) * CHUNK_LENGTH, this.road.length),
      road: this.road,
      terrain: this.terrain,
      physics: this.physics,
      world: this.world,
      hasPhysics: chunk.hasPhysics,
      originX: this.origin.x,
      originZ: this.origin.z,
      batches: this.batches,
    };
  }

  private attachContent(content: ChunkContent, originX: number, originZ: number): void {
    content.group.position.x = originX - this.origin.x;
    content.group.position.z = originZ - this.origin.z;
    // Complete, placed, and never moved again except by `rebase`.
    freezeStaticSubtree(content.group);
    this.scene.add(content.group);
    // The one place a chunk's colliders join the simulation. Incremental providers
    // yield mid-build, so a collider created early must not be solid until the mesh
    // and any breakable registration that names it exist.
    for (const collider of content.colliders) collider.setEnabled(true);
    content.attach?.();
  }

  private teardownContent(content: ChunkContent): void {
    this.scene.remove(content.group);
    for (const body of content.bodies) this.physics.removeBody(body);
    content.dispose?.();
  }

  /** Abandons the build in flight; the generator's own cleanup frees what it made. */
  private cancelBuild(chunk: BuiltChunk): void {
    const active = chunk.activeBuild;
    if (!active) return;
    chunk.activeBuild = undefined;
    active.iterator.return?.();
  }

  private teardown(chunk: BuiltChunk): void {
    this.cancelBuild(chunk);
    for (const entry of chunk.contents) this.teardownContent(entry.content);
  }

  private syncPending(): void {
    let pending = false;
    // Re-checked rather than read off the queue's length: the job that just ran may
    // have settled the last chunk the queue named.
    for (const index of this.buildQueue) {
      if (this.needsWork(index)) {
        pending = true;
        break;
      }
    }
    this.scheduler.setPending('road', pending);
  }

  dispose(): void {
    for (const [, chunk] of this.built) this.teardown(chunk);
    this.built.clear();
    this.buildQueue.length = 0;
    this.scheduler.setPending('road', false);
    this.batches.dispose();
    this.scene.remove(this.batches.root);
  }
}
