import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../core/physics';
import type { GameWorld } from '../game/state';
import type { Road } from './road';
import type { Terrain } from './terrain';
import type { WorldOrigin } from './origin';
import { WorldWorkScheduler } from './workqueue';

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
/** Past this lateral distance road content carries no physics or prop colliders. */
const ROAD_PHYSICS_REACH = 1200;

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
   * The floating origin at the moment this chunk is built (see `world/origin.ts`).
   *
   * Every vertex a provider writes into a `Float32Array`, and every position it hands
   * to Rapier, MUST have these subtracted: f32 cannot hold an absolute coordinate this
   * far from (0, 0) without quantising the road surface into steps. Providers keep
   * sampling the road, the terrain and every noise field at ABSOLUTE coordinates — the
   * subtraction happens only where the number is about to be stored in f32.
   *
   * A snapshot, not a live reference, and deliberately so: it is the frame this
   * chunk's geometry is expressed in for as long as the chunk lives, and the streamer
   * corrects for any later origin move by shifting the chunk's group.
   */
  originX: number;
  originZ: number;
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
   * Night-time lamp state for providers that own lamps. Called from the render
   * loop with the shared night factor (0..1, from the sky) and the camera
   * position; providers without lamps simply omit it.
   */
  setLamps?(on: number, nearX: number, nearZ: number): void;
}

export interface ChunkProvider {
  readonly id: string;
  /**
   * Builds this chunk's contribution atomically. Providers with incremental work
   * should implement `buildSteps` instead; this remains for existing synchronous
   * callers and providers whose work is already bounded.
   */
  build(ctx: ChunkContext): ChunkContent | null;
  /**
   * Incrementally builds this chunk's contribution. A scheduler unit advances this
   * iterator within a small time slice; its returned content is attached only after
   * it completes.
   */
  buildSteps?(ctx: ChunkContext): Iterator<void, ChunkContent | null>;
}

interface BuiltContent {
  readonly providerId: string;
  readonly content: ChunkContent;
}

interface ActiveProviderBuild {
  readonly provider: ChunkProvider;
  readonly iterator: Iterator<void, ChunkContent | null>;
  /** A refresh does not affect construction-stage ordering. */
  readonly refresh: boolean;
  /** Tracks lamp ownership across a partial replacement. */
  removedLamps: boolean;
}

interface BuiltChunk {
  index: number;
  hasPhysics: boolean;
  contents: BuiltContent[];
  /** Next provider contribution to stage; the chunk is usable only once this reaches `providers.length`. */
  nextProvider: number;
  /** Exactly one provider generator may own partial resources at a time. */
  activeBuild?: ActiveProviderBuild;
  complete: boolean;
  /**
   * The origin this chunk's vertices were written relative to. Kept per chunk rather
   * than assumed to be the current one, because a rebase can happen while chunks
   * built under the previous origin are still alive — that is the normal case, since
   * a rebase never rebuilds anything.
   */
  originX: number;
  originZ: number;
}

export class ChunkStreamer {
  private readonly providers: ChunkProvider[] = [];
  private readonly built = new Map<number, BuiltChunk>();
  private readonly buildQueue: number[] = [];
  /** Provider contributions awaiting an amortized rebuild after a world setting changes. */
  private readonly refreshQueue: { index: number; providerId: string }[] = [];
  private readonly lastChunkIndex: number;
  /** Increments only when scene-owned lamp sources are added or removed. */
  private lightRevision = 0;
  private previousPlayerS: number | null = null;
  private travelDirection: -1 | 0 | 1 = 0;

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
  }

  register(provider: ChunkProvider): void {
    this.providers.push(provider);
    for (const chunk of this.built.values()) {
      this.cancelBuild(chunk);
      chunk.complete = false;
    }
    if (this.built.size > 0) this.scheduler.setPending('road', true);
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
      for (const entry of chunk.contents) entry.content.setLamps?.(on, nearX, nearZ);
    }
  }

  /**
   * Queue the current contribution for every chunk that has already run it.
   * Repeated calls replace stale queued work, so a settings slider applies only
   * its final value.
   */
  refreshProvider(providerId: string): void {
    const providerIndex = this.providers.findIndex((provider) => provider.id === providerId);
    if (providerIndex < 0) return;
    for (let i = this.refreshQueue.length - 1; i >= 0; i--) {
      if (this.refreshQueue[i]!.providerId === providerId) this.refreshQueue.splice(i, 1);
    }
    for (const chunk of this.built.values()) {
      if (chunk.nextProvider > providerIndex) this.refreshQueue.push({ index: chunk.index, providerId });
    }
    if (this.refreshQueue.length > 0) this.scheduler.setPending('road', true);
  }

  /**
   * `frameId` must change once per rendered frame and stay equal across every
   * fixed step within it. The shared scheduler enforces the rendered-frame cap.
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
    const min = playerChunk - VISUAL_RADIUS;
    const max = playerChunk + VISUAL_RADIUS;
    const prefetch =
      this.travelDirection === 0 ? null : playerChunk + this.travelDirection * (VISUAL_RADIUS + 1);

    // Tear down anything that left the visual window and is not the one directional
    // lookahead, or whose physics status no longer matches its distance. This also
    // cancels partially staged and prefetched chunks without leaking their content.
    for (const [index, chunk] of this.built) {
      const wanted = (index >= min && index <= max) || index === prefetch;
      const needsPhysics =
        Math.abs(playerLateral) < ROAD_PHYSICS_REACH &&
        Math.abs(index - playerChunk) <= PHYSICS_RADIUS;
      if (!wanted || chunk.hasPhysics !== needsPhysics) {
        if (this.teardown(chunk)) this.lightRevision++;
        this.built.delete(index);
      }
    }

    // Collision-bearing chunks come before scenery prefetches. The current tile is
    // first, then the rest of its physics neighborhood nearest-first, so changing a
    // chunk from visual-only to physical cannot let a lookahead delay collision work.
    this.buildQueue.length = 0;
    {
      const current = this.built.get(playerChunk);
      if (!current || !current.complete) this.buildQueue.push(playerChunk);
    }
    for (let d = 1; d <= PHYSICS_RADIUS; d++) {
      const back = playerChunk - d;
      const front = playerChunk + d;
      const first = this.travelDirection < 0 ? back : front;
      const second = this.travelDirection < 0 ? front : back;
      const firstChunk = this.built.get(first);
      if (!firstChunk || !firstChunk.complete) this.buildQueue.push(first);
      const secondChunk = this.built.get(second);
      if (!secondChunk || !secondChunk.complete) this.buildQueue.push(second);
    }
    // After physical continuity is covered, start one bounded tile in the travel
    // direction before it enters the visual window.
    if (prefetch !== null) {
      const lookahead = this.built.get(prefetch);
      if (!lookahead || !lookahead.complete) this.buildQueue.push(prefetch);
    }
    for (let d = PHYSICS_RADIUS + 1; d <= VISUAL_RADIUS; d++) {
      const back = playerChunk - d;
      const front = playerChunk + d;
      const first = this.travelDirection < 0 ? back : front;
      const second = this.travelDirection < 0 ? front : back;
      const firstChunk = this.built.get(first);
      if (!firstChunk || !firstChunk.complete) this.buildQueue.push(first);
      const secondChunk = this.built.get(second);
      if (!secondChunk || !secondChunk.complete) this.buildQueue.push(second);
    }

    let index: number | null = null;
    for (const candidate of this.buildQueue) {
      if (!this.built.get(candidate)?.complete) {
        index = candidate;
        break;
      }
    }
    const hasPhysics =
      index !== null &&
      Math.abs(playerLateral) < ROAD_PHYSICS_REACH &&
      Math.abs(index - playerChunk) <= PHYSICS_RADIUS;
    // A live collider takes precedence over cosmetic refresh work. The road mesh is
    // the first provider, so this also gets a newly physical chunk back under the
    // player as soon as the shared frame budget admits a unit.
    const refresh = hasPhysics ? null : this.nextRefresh();
    if (refresh) {
      this.scheduler.tryRun(frameId, `road:refresh:${refresh.index}:${refresh.providerId}`, () => {
        this.runRefresh(refresh);
      });
    } else if (index !== null) {
      const buildIndex = index;
      const staged = this.built.get(buildIndex);
      const providerId = this.providers[staged?.nextProvider ?? 0]?.id ?? 'complete';
      this.scheduler.tryRun(frameId, `road:build:${buildIndex}:${providerId}`, () => {
        this.runBuildStage(buildIndex, hasPhysics);
      });
    }

    this.syncPending();
  }
  /**
   * Synchronously build the clamped road chunk containing the player.
   *
   * Boot uses this instead of consuming a scheduler slice: starter objects and the
   * first physics step must see the complete homestead chunk. Normal updates still
   * own the desired-window queue and remain scheduler-controlled.
   */
  prime(playerS: number, playerLateral = 0): void {
    const clamped = Math.min(Math.max(playerS, 0), this.road.length);
    const playerChunk = Math.min(Math.floor(clamped / CHUNK_LENGTH), this.lastChunkIndex);
    const hasPhysics = Math.abs(playerLateral) < ROAD_PHYSICS_REACH;

    const existing = this.built.get(playerChunk);
    if (existing) {
      if (this.teardown(existing)) this.lightRevision++;
      this.built.delete(playerChunk);
    }

    const chunk: BuiltChunk = {
      index: playerChunk,
      hasPhysics,
      contents: [],
      nextProvider: 0,
      complete: this.providers.length === 0,
      originX: this.origin.x,
      originZ: this.origin.z,
    };
    this.built.set(playerChunk, chunk);
    this.previousPlayerS = clamped;
    this.travelDirection = 0;
    this.buildQueue.length = 0;

    try {
      for (const provider of this.providers) {
        const content = provider.build(this.context(chunk));
        chunk.nextProvider++;
        if (content) {
          this.attachContent(content, chunk.originX, chunk.originZ);
          this.insertContent(chunk, provider, content);
          if (content.setLamps) this.lightRevision++;
        }
      }
      chunk.complete = true;
    } catch (error) {
      if (this.teardown(chunk)) this.lightRevision++;
      this.built.delete(playerChunk);
      throw error;
    }

  }
  private nextRefresh(): { index: number; providerId: string } | null {
    for (let i = 0; i < this.refreshQueue.length; ) {
      const request = this.refreshQueue[i]!;
      const chunk = this.built.get(request.index);
      const providerIndex = this.providers.findIndex((provider) => provider.id === request.providerId);
      // A chunk that has not run this provider will use the latest settings when it
      // reaches that stage, so it needs no separate refresh.
      if (!chunk || providerIndex < 0 || chunk.nextProvider <= providerIndex) {
        this.refreshQueue.splice(i, 1);
        continue;
      }
      if (!chunk.complete) {
        i++;
        continue;
      }
      // Keep advancing an in-flight refresh even if another provider's request is
      // queued ahead of it.
      if (chunk.activeBuild?.refresh) {
        if (chunk.activeBuild.provider.id === request.providerId) return request;
        i++;
        continue;
      }
      return request;
    }
    return null;
  }

  private runRefresh(request: { index: number; providerId: string }): void {
    const chunk = this.built.get(request.index);
    const provider = this.providers.find((candidate) => candidate.id === request.providerId);
    if (!chunk || !chunk.complete || !provider) return;
    let active = chunk.activeBuild;
    if (!active) {
      if (!provider.buildSteps) {
        this.replaceContribution(chunk, provider);
        const queueIndex = this.refreshQueue.indexOf(request);
        if (queueIndex >= 0) this.refreshQueue.splice(queueIndex, 1);
        return;
      }
      const current = chunk.contents.findIndex((entry) => entry.providerId === provider.id);
      let removedLamps = false;
      if (current >= 0) {
        removedLamps = this.teardownContent(chunk.contents[current]!.content);
        chunk.contents.splice(current, 1);
      }
      active = {
        provider,
        iterator: provider.buildSteps(this.context(chunk)),
        refresh: true,
        removedLamps,
      };
      chunk.activeBuild = active;
    }
    if (!active.refresh || active.provider !== provider) return;

    let result: IteratorResult<void, ChunkContent | null>;
    try {
      result = this.advanceIncrementalProvider(active);
    } catch (error) {
      chunk.activeBuild = undefined;
      throw error;
    }
    if (!result.done) return;
    chunk.activeBuild = undefined;
    const content = result.value;
    if (content) {
      this.attachContent(content, chunk.originX, chunk.originZ);
      this.insertContent(chunk, provider, content);
      active.removedLamps ||= content.setLamps !== undefined;
    }
    if (active.removedLamps) this.lightRevision++;
    const queueIndex = this.refreshQueue.indexOf(request);
    if (queueIndex >= 0) this.refreshQueue.splice(queueIndex, 1);
  }

  /**
   * Advance an incremental provider far enough to amortize cheap yields without
   * allowing it to consume the scheduler's entire frame slice.
   */
  private advanceIncrementalProvider(
    active: ActiveProviderBuild,
  ): IteratorResult<void, ChunkContent | null> {
    const deadline = performance.now() + 2;
    let result = active.iterator.next();
    while (!result.done && performance.now() < deadline) {
      result = active.iterator.next();
    }
    return result;
  }

  private runBuildStage(index: number, hasPhysics: boolean): void {
    let chunk = this.built.get(index);
    if (!chunk) {
      chunk = {
        index,
        hasPhysics,
        contents: [],
        nextProvider: 0,
        complete: this.providers.length === 0,
        originX: this.origin.x,
        originZ: this.origin.z,
      };
      this.built.set(index, chunk);
    }
    if (chunk.complete) return;

    const provider = this.providers[chunk.nextProvider];
    if (!provider) {
      chunk.complete = true;
      return;
    }
    if (provider.buildSteps) {
      let active = chunk.activeBuild;
      if (!active) {
        active = {
          provider,
          iterator: provider.buildSteps(this.context(chunk)),
          refresh: false,
          removedLamps: false,
        };
        chunk.activeBuild = active;
      }
      if (active.refresh || active.provider !== provider) return;

      let result: IteratorResult<void, ChunkContent | null>;
      try {
        result = this.advanceIncrementalProvider(active);
      } catch (error) {
        chunk.activeBuild = undefined;
        throw error;
      }
      if (!result.done) return;
      chunk.activeBuild = undefined;
      const content = result.value;
      chunk.nextProvider++;
      if (content) {
        this.attachContent(content, chunk.originX, chunk.originZ);
        this.insertContent(chunk, provider, content);
        if (content.setLamps) this.lightRevision++;
      }
      chunk.complete = chunk.nextProvider === this.providers.length;
      return;
    }

    const content = provider.build(this.context(chunk));
    chunk.nextProvider++;
    if (content) {
      this.attachContent(content, chunk.originX, chunk.originZ);
      this.insertContent(chunk, provider, content);
      if (content.setLamps) this.lightRevision++;
    }
    chunk.complete = chunk.nextProvider === this.providers.length;
  }

  /** Rebuild one provider's current contribution for a live, complete chunk. */
  private replaceContribution(chunk: BuiltChunk, provider: ChunkProvider): void {
    const current = chunk.contents.findIndex((entry) => entry.providerId === provider.id);
    let changedLamps = false;
    if (current >= 0) {
      changedLamps = this.teardownContent(chunk.contents[current]!.content);
      chunk.contents.splice(current, 1);
    }
    const content = provider.build(this.context(chunk));
    if (content) {
      this.attachContent(content, chunk.originX, chunk.originZ);
      this.insertContent(chunk, provider, content);
      changedLamps ||= content.setLamps !== undefined;
    }
    if (changedLamps) this.lightRevision++;
  }

  private insertContent(chunk: BuiltChunk, provider: ChunkProvider, content: ChunkContent): void {
    const providerIndex = this.providers.indexOf(provider);
    let insertAt = 0;
    while (insertAt < chunk.contents.length) {
      const currentIndex = this.providers.findIndex(
        (candidate) => candidate.id === chunk.contents[insertAt]!.providerId,
      );
      if (currentIndex > providerIndex) break;
      insertAt++;
    }
    chunk.contents.splice(insertAt, 0, { providerId: provider.id, content });
  }

  /**
   * Re-express complete chunks after the floating origin moves and discard partial work.
   */
  rebase(): void {
    // Do not rebuild a partial chunk in the new frame. Its generators may have
    // retained origin-relative geometry or physics; cancel and tear it down first,
    // then let the next update restart it from the current origin.
    const incomplete: BuiltChunk[] = [];
    for (const chunk of this.built.values()) {
      if (!chunk.complete) incomplete.push(chunk);
    }
    for (const chunk of incomplete) {
      if (this.teardown(chunk)) this.lightRevision++;
      this.built.delete(chunk.index);
    }

    // Complete chunks remain valid; only their group offsets need to follow the
    // newly rebased world origin.
    for (const chunk of this.built.values()) {
      for (const entry of chunk.contents) {
        entry.content.group.position.x = chunk.originX - this.origin.x;
        entry.content.group.position.z = chunk.originZ - this.origin.z;
      }
    }
  }

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
      originX: chunk.originX,
      originZ: chunk.originZ,
    };
  }

  private attachContent(content: ChunkContent, originX: number, originZ: number): void {
    content.group.position.x = originX - this.origin.x;
    content.group.position.z = originZ - this.origin.z;
    this.scene.add(content.group);
    // The one place a chunk's colliders join the simulation. Incremental providers
    // yield mid-build, so a collider created early must not be solid until the mesh
    // and any breakable registration that names it exist.
    for (const collider of content.colliders) collider.setEnabled(true);
  }

  private teardownContent(content: ChunkContent): boolean {
    const ownedLamps = content.setLamps !== undefined;
    this.scene.remove(content.group);
    for (const body of content.bodies) this.physics.removeBody(body);
    content.dispose?.();
    return ownedLamps;
  }

  private cancelBuild(chunk: BuiltChunk): void {
    const active = chunk.activeBuild;
    if (!active) return;
    chunk.activeBuild = undefined;
    active.iterator.return?.();
  }

  private teardown(chunk: BuiltChunk): boolean {
    this.cancelBuild(chunk);
    let removedLamps = false;
    for (const entry of chunk.contents) {
      const contentRemovedLamps = this.teardownContent(entry.content);
      removedLamps ||= contentRemovedLamps;
    }
    return removedLamps;
  }

  private syncPending(): void {
    // Prune refreshes that were invalidated by a teardown before reporting work.
    this.nextRefresh();
    let buildPending = false;
    for (const index of this.buildQueue) {
      if (!this.built.get(index)?.complete) {
        buildPending = true;
        break;
      }
    }
    this.scheduler.setPending('road', buildPending || this.refreshQueue.length > 0);
  }

  dispose(): void {
    let removedLamps = false;
    for (const [, chunk] of this.built) {
      const chunkRemovedLamps = this.teardown(chunk);
      removedLamps ||= chunkRemovedLamps;
    }
    if (removedLamps) this.lightRevision++;
    this.built.clear();
    this.buildQueue.length = 0;
    this.refreshQueue.length = 0;
    this.scheduler.setPending('road', false);
  }
}
