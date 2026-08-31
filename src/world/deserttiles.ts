import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

import type { PhysicsWorld } from '../core/physics';
import { hash01 } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import type { WorldOrigin } from './origin';
import {
  desertPropForms,
  propPieces,
  type BreakableSink,
  type DesertPropForm,
} from './props';
import type { Road } from './road';
import type { RoadDistance } from './roaddistance';
import type { Terrain } from './terrain';
import {
  DESERT_TILE_CELLS,
  DESERT_TILE_SIZE,
  DESERT_TILE_STEP as TILE_STEP,
  DESERT_TILE_VERTS as TILE_VERTS,
  desertTileDataTransfers,
  generateDesertTileData,
  type DesertTileData,
} from './deserttiledata';
import type {
  DesertTileWorkerRequest,
  DesertTileWorkerResponse,
} from './deserttileworker';
import type { WorldWorkScheduler } from './workqueue';
import { TERRAIN_COLLIDER_SURFACE, TERRAIN_MATERIAL } from './terrainmesh';

/**
 * Player-centred open desert.
 *
 * Unlike road chunks, tiles are keyed only by absolute X/Z. Their geometry is therefore
 * a pure function of (seed, tileX, tileZ), may be discarded at any time, and rebuilds
 * identically when the player returns. The theoretical size of the desert never enters
 * the memory or draw budget: five by five visual tiles and three by three physical tiles
 * are the complete live set.
 *
 * Invariants:
 *  - neighbouring tiles sample the same absolute edge coordinates, so render and
 *    heightfield seams are bit-identical;
 *  - every rendered/physical coordinate is relative to WorldOrigin before it reaches f32;
 *  - the current tile is always physical, even after a teleport; ordinary prefetch work
 *    is capped at one tile operation per rendered frame;
 *  - all close terrain is one uniform fine lattice. There is no coarse driveable ring;
 *    the camera-centred vista owns everything beyond the fine visual square.
 */

export { DESERT_TILE_CELLS, DESERT_TILE_SIZE } from './deserttiledata';

const VISUAL_RADIUS = 2;
const PHYSICS_RADIUS = 1;
/** Past this player-to-road distance no live tile can intersect the corridor. */
const ROAD_QUERY_CUTOFF = 900;
const PROP_TAG = 0x44535254;
const MAX_TILE_PROPS = 5;
const TILE_PROP_ID_BASE = 1_000_000;
const ROCK_COLLIDER_MIN = 0.55;
/**
 * Spare tile buffer sets held for reuse. One row of the visual ring plus a little
 * slack: enough that a boundary crossing never has to allocate, few enough that the
 * spares cost less than a megabyte.
 */
const RECYCLED_TILE_LIMIT = 12;
const instanceScratch = new THREE.Object3D();
let hullPoints = new Float32Array(0);

interface DesertPropPlacement {
  readonly form: DesertPropForm;
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
  readonly scale: number;
  readonly radius: number;
  mesh: THREE.InstancedMesh | null;
  instance: number;
}

interface DesertTile {
  readonly tx: number;
  readonly tz: number;
  readonly key: string;
  readonly centreX: number;
  readonly centreZ: number;
  readonly group: THREE.Group;
  readonly geometry: THREE.BufferGeometry;
  readonly meshes: readonly THREE.InstancedMesh[];
  readonly heights: Float32Array;
  /**
   * The buffer set backing `heights`, `geometry` and the collider, kept so teardown
   * can hand it back to the worker instead of to the collector.
   */
  readonly data: DesertTileData;
  readonly props: readonly DesertPropPlacement[];
  readonly registered: number[];
  readonly farFromRoad: boolean;
  bodies: RAPIER.RigidBody[];
  hasPhysics: boolean;
}

function tileKey(tx: number, tz: number): string {
  return `${tx},${tz}`;
}


/** Bilinear height on the tile's exact regular lattice. */
function heightFromTile(heights: Float32Array, localX: number, localZ: number): number {
  const fx = Math.min(DESERT_TILE_CELLS, Math.max(0, localX / TILE_STEP));
  const fz = Math.min(DESERT_TILE_CELLS, Math.max(0, localZ / TILE_STEP));
  const ix = Math.min(DESERT_TILE_CELLS - 1, Math.floor(fx));
  const iz = Math.min(DESERT_TILE_CELLS - 1, Math.floor(fz));
  const tx = fx - ix;
  const tz = fz - iz;
  const a = heights[ix * TILE_VERTS + iz]!;
  const b = heights[(ix + 1) * TILE_VERTS + iz]!;
  const c = heights[ix * TILE_VERTS + iz + 1]!;
  const d = heights[(ix + 1) * TILE_VERTS + iz + 1]!;
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
/**
 * Unique persisted id for practical world coordinates. At 240 m per tile this remains
 * an exact integer for billions of kilometres in either direction.
 */
function tilePropId(tx: number, tz: number, index: number): number {
  const x = tx >= 0 ? tx * 2 : -tx * 2 - 1;
  const z = tz >= 0 ? tz * 2 : -tz * 2 - 1;
  const pair = x >= z ? x * x + x + z : z * z + x;
  return -TILE_PROP_ID_BASE - pair * MAX_TILE_PROPS - index;
}


interface TileWork {
  readonly tx: number;
  readonly tz: number;
  readonly key: string;
  readonly physics: boolean;
  readonly visual: boolean;
  readonly score: number;
}

interface ReadyTileData {
  readonly data: DesertTileData;
  readonly farFromRoad: boolean;
}

interface ActiveTileRequest {
  readonly id: number;
  readonly key: string;
  readonly farFromRoad: boolean;
}

export type DesertTileWorkerFactory = () => Worker | null;

export class DesertTileStreamer {
  private readonly tiles = new Map<string, DesertTile>();
  private readonly wanted = new Map<string, TileWork>();
  private readonly readyData = new Map<string, ReadyTileData>();
  private worker: Worker | null = null;
  private workerReady = false;
  private activeRequest: ActiveTileRequest | null = null;
  private nextRequestId = 0;
  private buildFrame = -1;
  private degradedBuildFrame = -1;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private farFromRoad = false;
  private disposed = false;
  /**
   * Tile buffers reclaimed from torn-down tiles, waiting to be written over.
   *
   * Tile geometry is the largest thing this system churns: ~413 KB per tile, five
   * tiles per row crossing. Left to the collector that is the last remaining source
   * of streaming hitches — measured as pauses landing on whichever scheduler job
   * happened to be running, and scaling with GC pressure rather than with work.
   * A set enters this list only after its tile is out of `tiles`, out of the scene,
   * and its geometry disposed, so nothing live can observe the overwrite.
   *
   * Bounded because the live set is bounded: more than a row of spares is memory
   * held for no reason.
   */
  private readonly recycled: DesertTileData[] = [];

  constructor(
    private readonly seed: number,
    private readonly road: Road,
    private readonly terrain: Terrain,
    private readonly roadDistance: RoadDistance,
    private readonly physics: PhysicsWorld,
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
    private readonly breakables: BreakableSink | undefined,
    private readonly scheduler: WorldWorkScheduler,
    private readonly workerFactory?: DesertTileWorkerFactory,
  ) {
    this.worker = this.createWorker();
  }


  /**
   * Establishes solid ground before the loading cover leaves. Nine tiles are the only
   * synchronous batch in normal play; every later non-current tile is worker-built.
   */
  prime(x: number, z: number, roadLateral: number): void {
    if (this.disposed) return;
    const nextFarFromRoad = Math.abs(roadLateral) >= ROAD_QUERY_CUTOFF;
    const centreTx = Math.floor(x / DESERT_TILE_SIZE);
    const centreTz = Math.floor(z / DESERT_TILE_SIZE);
    if (nextFarFromRoad !== this.farFromRoad) {
      this.farFromRoad = nextFarFromRoad;
      this.invalidateGenerationMode(centreTx, centreTz);
    }
    for (let dz = -PHYSICS_RADIUS; dz <= PHYSICS_RADIUS; dz++) {
      for (let dx = -PHYSICS_RADIUS; dx <= PHYSICS_RADIUS; dx++) {
        this.buildSynchronously(centreTx + dx, centreTz + dz, true);
      }
    }
    this.lastX = x;
    this.lastZ = z;
    this.syncPendingState();
  }

  /**
   * Keeps the physical three-by-three square complete immediately, while visual data
   * and non-current physics are attached only from staged worker results.
   */
  update(x: number, z: number, roadLateral: number, frameId: number): void {
    if (this.disposed) return;
    const nextFarFromRoad = Math.abs(roadLateral) >= ROAD_QUERY_CUTOFF;
    const modeChanged = nextFarFromRoad !== this.farFromRoad;
    this.farFromRoad = nextFarFromRoad;
    const centreTx = Math.floor(x / DESERT_TILE_SIZE);
    const centreTz = Math.floor(z / DESERT_TILE_SIZE);
    const currentKey = tileKey(centreTx, centreTz);
    if (modeChanged) this.invalidateGenerationMode(centreTx, centreTz);

    // A teleport can beat the worker. This is the only post-prime synchronous terrain
    // generation path, and it exists solely to keep solid ground under the player.
    const current = this.tiles.get(currentKey);
    if (!current) {
      const staged = this.readyData.get(currentKey);
      if (staged && staged.farFromRoad === this.desiredModeForTile(centreTx, centreTz)) {
        this.readyData.delete(currentKey);
        this.promote(this.attach(centreTx, centreTz, staged.data, staged.farFromRoad));
      } else {
        if (staged) this.discardStaged(currentKey, staged);
        this.buildSynchronously(centreTx, centreTz, true);
      }
    } else if (!current.hasPhysics) {
      this.promote(current);
    }

    for (const [key, tile] of this.tiles) {
      const dx = Math.abs(tile.tx - centreTx);
      const dz = Math.abs(tile.tz - centreTz);
      if (dx > VISUAL_RADIUS || dz > VISUAL_RADIUS) {
        this.teardown(tile);
        this.tiles.delete(key);
      } else if (tile.hasPhysics && (dx > PHYSICS_RADIUS || dz > PHYSICS_RADIUS)) {
        this.demote(tile);
      }
    }

    if (frameId !== this.buildFrame) {
      const moveX = Number.isFinite(this.lastX) ? x - this.lastX : 0;
      const moveZ = Number.isFinite(this.lastZ) ? z - this.lastZ : 0;
      const moveLength = Math.hypot(moveX, moveZ);
      const dirX = moveLength > 1e-6 ? moveX / moveLength : 0;
      const dirZ = moveLength > 1e-6 ? moveZ / moveLength : 0;
      this.buildWantedSet(centreTx, centreTz, dirX, dirZ);
      this.dropUnwantedData();
      if (this.worker) this.pumpWorker();
      else this.pumpDegraded(frameId);
      this.buildFrame = frameId;
      this.lastX = x;
      this.lastZ = z;
    } else if (modeChanged) {
      // A mode transition can happen between fixed updates sharing one render frame.
      // Reuse the existing wanted set, but never leave the invalidated queue idle.
      if (this.worker) this.pumpWorker();
      else this.pumpDegraded(frameId);
    }

    this.applyOneStagedUnit(frameId);
    this.syncPendingState();
  }

  /** Re-express visual groups after PhysicsWorld has shifted every rigid body. */
  rebase(): void {
    for (const tile of this.tiles.values()) {
      tile.group.position.x = tile.centreX - this.origin.x;
      tile.group.position.z = tile.centreZ - this.origin.z;
    }
  }

  /** Releases the worker and every tile-owned Three/Rapier resource. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.workerReady = false;
    this.activeRequest = null;
    this.wanted.clear();
    this.readyData.clear();
    for (const tile of this.tiles.values()) this.teardown(tile);
    this.tiles.clear();
    this.scheduler.setPending('desert', false);
  }

  get visualTileCount(): number {
    return this.tiles.size;
  }

  get physicsTileCount(): number {
    let count = 0;
    for (const tile of this.tiles.values()) if (tile.hasPhysics) count++;
    return count;
  }

  /** Drawn/collided lattice height for diagnostics and ground-aware streamed content. */
  heightAt(x: number, z: number): number | null {
    const tx = Math.floor(x / DESERT_TILE_SIZE);
    const tz = Math.floor(z / DESERT_TILE_SIZE);
    const tile = this.tiles.get(tileKey(tx, tz));
    if (!tile) return null;
    return heightFromTile(
      tile.heights,
      x - tx * DESERT_TILE_SIZE,
      z - tz * DESERT_TILE_SIZE,
    );
  }

  hasPhysicsAt(x: number, z: number): boolean {
    return this.tiles.get(tileKey(Math.floor(x / DESERT_TILE_SIZE), Math.floor(z / DESERT_TILE_SIZE)))?.hasPhysics ?? false;
  }

  private buildSynchronously(tx: number, tz: number, withPhysics: boolean): void {
    const key = tileKey(tx, tz);
    const existing = this.tiles.get(key);
    if (existing) {
      if (existing.farFromRoad !== this.desiredModeForTile(tx, tz)) {
        this.teardown(existing);
        this.tiles.delete(key);
      } else {
        if (withPhysics && !existing.hasPhysics) this.promote(existing);
        return;
      }
    }

    const farFromRoad = this.desiredModeForTile(tx, tz);
    const data = generateDesertTileData(
      {
        seed: this.seed,
        road: this.road,
        terrain: this.terrain,
        roadDistance: this.roadDistance,
      },
      tx,
      tz,
      farFromRoad,
      this.recycled.pop(),
    );
    const tile = this.attach(tx, tz, data, farFromRoad);
    if (withPhysics) this.promote(tile);
  }

  /** Creates scene/physics-ready objects over worker-owned typed arrays without copying them. */
  private attach(tx: number, tz: number, data: DesertTileData, farFromRoad: boolean): DesertTile {
    const key = tileKey(tx, tz);
    const existing = this.tiles.get(key);
    if (existing) return existing;

    const centreX = (tx + 0.5) * DESERT_TILE_SIZE;
    const centreZ = (tz + 0.5) * DESERT_TILE_SIZE;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));

    const group = new THREE.Group();
    group.position.set(centreX - this.origin.x, 0, centreZ - this.origin.z);
    const mesh = new THREE.Mesh(geometry, TERRAIN_MATERIAL);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);

    const { props, meshes } = this.buildProps(
      tx,
      tz,
      data.heights,
      data.propSurfaces,
      group,
    );
    this.scene.add(group);

    const tile: DesertTile = {
      tx,
      tz,
      key,
      centreX,
      centreZ,
      group,
      geometry,
      meshes,
      heights: data.heights,
      data,
      props,
      registered: [],
      farFromRoad,
      bodies: [],
      hasPhysics: false,
    };
    this.tiles.set(key, tile);
    return tile;
  }


  private buildProps(
    tx: number,
    tz: number,
    heights: Float32Array,
    propSurfaces: Uint8Array,
    group: THREE.Group,
  ): { props: readonly DesertPropPlacement[]; meshes: readonly THREE.InstancedMesh[] } {
    const requested = 2 + Math.floor(hash01(this.seed, PROP_TAG, tx, tz) * 4);
    const props: DesertPropPlacement[] = [];
    for (let i = 0; i < requested; i++) {
      const surface = propSurfaces[i]!;
      if (surface === 0) continue;

      const localX = (0.08 + hash01(this.seed, PROP_TAG, tx, tz, i, 1) * 0.84) * DESERT_TILE_SIZE;
      const localZ = (0.08 + hash01(this.seed, PROP_TAG, tx, tz, i, 2) * 0.84) * DESERT_TILE_SIZE;
      const forms = desertPropForms(surface as SurfaceType);
      const form = forms[Math.floor(hash01(this.seed, PROP_TAG, tx, tz, i, 3) * forms.length)]!;
      const id = tilePropId(tx, tz, i);
      if (propPieces(form.id) && this.breakables?.isBroken(id)) continue;

      const scale =
        form.minScale +
        hash01(this.seed, PROP_TAG, tx, tz, i, 4) * (form.maxScale - form.minScale);
      const radius = form.baseRadius * scale;
      const ground = heightFromTile(heights, localX, localZ);
      props.push({
        form,
        id,
        x: localX - DESERT_TILE_SIZE * 0.5,
        y: ground - radius * form.sink,
        z: localZ - DESERT_TILE_SIZE * 0.5,
        rx: form.rotate3d ? hash01(this.seed, PROP_TAG, tx, tz, i, 5) * Math.PI * 2 : 0,
        ry: hash01(this.seed, PROP_TAG, tx, tz, i, 6) * Math.PI * 2,
        rz: form.rotate3d ? hash01(this.seed, PROP_TAG, tx, tz, i, 7) * Math.PI * 2 : 0,
        scale,
        radius,
        mesh: null,
        instance: 0,
      });
    }

    const meshes: THREE.InstancedMesh[] = [];
    const byForm = new Map<DesertPropForm, DesertPropPlacement[]>();
    for (const prop of props) {
      const list = byForm.get(prop.form);
      if (list) list.push(prop);
      else byForm.set(prop.form, [prop]);
    }
    for (const [form, placements] of byForm) {
      const instances = new THREE.InstancedMesh(form.geometry, form.material, placements.length);
      instances.castShadow = true;
      instances.receiveShadow = true;
      for (let i = 0; i < placements.length; i++) {
        const prop = placements[i]!;
        instanceScratch.position.set(prop.x, prop.y, prop.z);
        instanceScratch.rotation.set(prop.rx, prop.ry, prop.rz);
        instanceScratch.scale.setScalar(prop.scale);
        instanceScratch.updateMatrix();
        instances.setMatrixAt(i, instanceScratch.matrix);
        prop.mesh = instances;
        prop.instance = i;
      }
      instances.instanceMatrix.needsUpdate = true;
      group.add(instances);
      meshes.push(instances);
    }
    return { props, meshes };
  }

  private desiredModeForTile(_tx: number, _tz: number): boolean {
    return this.farFromRoad;
  }

  private invalidateGenerationMode(centreTx: number, centreTz: number): void {
    const desired = this.desiredModeForTile(centreTx, centreTz);
    if (this.activeRequest && this.activeRequest.farFromRoad !== desired) {
      // The worker cannot cancel a transferred request. Dropping its identity makes
      // the eventual response harmless; the replacement receives a new request id.
      this.activeRequest = null;
    }
    for (const [key, staged] of this.readyData) {
      if (staged.farFromRoad !== desired) this.discardStaged(key, staged);
    }
    for (const [key, tile] of this.tiles) {
      if (tile.farFromRoad === desired) continue;
      const dx = Math.abs(tile.tx - centreTx);
      const dz = Math.abs(tile.tz - centreTz);
      if (dx > VISUAL_RADIUS || dz > VISUAL_RADIUS) continue;
      this.teardown(tile);
      this.tiles.delete(key);
    }
  }

  private createWorker(): Worker | null {
    if (!this.workerFactory && typeof Worker === 'undefined') return null;
    let worker: Worker | null = null;
    try {
      const candidate = this.workerFactory
        ? this.workerFactory()
        : new Worker(new URL('./deserttileworker.ts', import.meta.url), { type: 'module' });
      if (!candidate) return null;
      worker = candidate;
      candidate.onmessage = (event: MessageEvent<DesertTileWorkerResponse>) => {
        this.handleWorkerMessage(candidate, event);
      };
      candidate.onerror = () => this.failWorker(candidate);
      candidate.onmessageerror = () => this.failWorker(candidate);
      const request: DesertTileWorkerRequest = {
        type: 'init',
        seed: this.seed,
        spine: this.road.spine,
      };
      candidate.postMessage(request);
      return candidate;
    } catch {
      worker?.terminate();
      return null;
    }
  }

  private handleWorkerMessage(
    worker: Worker,
    event: MessageEvent<DesertTileWorkerResponse>,
  ): void {
    if (this.disposed || worker !== this.worker) return;
    const response = event.data;
    if (response.type === 'ready') {
      this.workerReady = true;
      this.pumpWorker();
      this.syncPendingState();
      return;
    }

    const active = this.activeRequest;
    const key = tileKey(response.tx, response.tz);
    if (!active || active.id !== response.requestId || active.key !== key) return;
    this.activeRequest = null;
    const desired = this.desiredModeForTile(response.tx, response.tz);
    if (
      active.farFromRoad === desired &&
      this.wanted.has(key) &&
      !this.tiles.has(key)
    ) {
      this.readyData.set(key, { data: response.data, farFromRoad: active.farFromRoad });
    }
    this.pumpWorker();
    this.syncPendingState();
  }

  private failWorker(worker: Worker): void {
    if (worker !== this.worker) return;
    worker.terminate();
    this.worker = null;
    this.workerReady = false;
    this.activeRequest = null;
    this.syncPendingState();
  }

  private buildWantedSet(centreTx: number, centreTz: number, dirX: number, dirZ: number): void {
    this.wanted.clear();
    for (let dz = -VISUAL_RADIUS; dz <= VISUAL_RADIUS; dz++) {
      for (let dx = -VISUAL_RADIUS; dx <= VISUAL_RADIUS; dx++) {
        const physics = Math.abs(dx) <= PHYSICS_RADIUS && Math.abs(dz) <= PHYSICS_RADIUS;
        const ahead = dx * dirX + dz * dirZ;
        this.addWanted(
          centreTx + dx,
          centreTz + dz,
          physics,
          true,
          (physics ? -100 : 0) + dx * dx + dz * dz - ahead * 0.1,
        );
      }
    }

    // Keep one whole row of tile *data* beyond the visual square. A diagonal drive
    // still selects only its dominant cardinal component, so prefetch remains bounded.
    if (Math.abs(dirX) >= Math.abs(dirZ) && Math.abs(dirX) > 1e-6) {
      const step = dirX < 0 ? -1 : 1;
      for (let dz = -VISUAL_RADIUS; dz <= VISUAL_RADIUS; dz++) {
        this.addWanted(
          centreTx + step * (VISUAL_RADIUS + 1),
          centreTz + dz,
          false,
          false,
          -50 + dz * dz,
        );
      }
    } else if (Math.abs(dirZ) > 1e-6) {
      const step = dirZ < 0 ? -1 : 1;
      for (let dx = -VISUAL_RADIUS; dx <= VISUAL_RADIUS; dx++) {
        this.addWanted(
          centreTx + dx,
          centreTz + step * (VISUAL_RADIUS + 1),
          false,
          false,
          -50 + dx * dx,
        );
      }
    }
  }

  private addWanted(
    tx: number,
    tz: number,
    physics: boolean,
    visual: boolean,
    score: number,
  ): void {
    const key = tileKey(tx, tz);
    const existing = this.wanted.get(key);
    if (!existing) {
      this.wanted.set(key, { tx, tz, key, physics, visual, score });
      return;
    }

    const upgradedPhysics = physics && !existing.physics;
    const upgradedVisual = visual && !existing.visual;
    if (!upgradedPhysics && !upgradedVisual && score >= existing.score) return;
    this.wanted.set(key, {
      tx,
      tz,
      key,
      physics: existing.physics || physics,
      visual: existing.visual || visual,
      score: Math.min(existing.score, score),
    });
  }

  private dropUnwantedData(): void {
    for (const [key, staged] of this.readyData) {
      const work = this.wanted.get(key);
      if (
        !work ||
        this.tiles.has(key) ||
        staged.farFromRoad !== this.desiredModeForTile(work.tx, work.tz)
      ) {
        this.discardStaged(key, staged);
      }
    }
  }

  private nextUnpreparedWork(): TileWork | null {
    let next: TileWork | null = null;
    for (const work of this.wanted.values()) {
      if (this.tiles.has(work.key) || this.readyData.has(work.key)) continue;
      if (!next || work.score < next.score) next = work;
    }
    return next;
  }

  /** Sends only one job at a time so an old visual fill cannot block a new forward row. */
  private pumpWorker(): void {
    if (!this.worker || !this.workerReady || this.activeRequest) return;
    const next = this.nextUnpreparedWork();
    if (!next) return;

    const requestId = ++this.nextRequestId;
    const farFromRoad = this.desiredModeForTile(next.tx, next.tz);
    this.activeRequest = { id: requestId, key: next.key, farFromRoad };
    const request: DesertTileWorkerRequest = {
      type: 'tile',
      requestId,
      tx: next.tx,
      tz: next.tz,
      farFromRoad,
      recycle: this.recycled.pop(),
    };
    // The buffers are MOVED, not shared: after this call the main thread holds
    // detached views and the worker owns the memory until it posts the tile back.
    this.worker.postMessage(
      request,
      request.recycle ? desertTileDataTransfers(request.recycle) : [],
    );
  }

  /**
   * Worker failure leaves generation available rather than stranding the wanted ring.
   * The data build remains frame-budgeted; attachment and promotion take their usual
   * separate scheduler-gated path below.
   */
  private pumpDegraded(frameId: number): void {
    if (this.worker || this.degradedBuildFrame === frameId) return;
    const work = this.nextUnpreparedWork();
    if (!work) return;
    if (
      this.scheduler.tryRun(frameId, 'desert-generate-degraded', () => {
        const farFromRoad = this.desiredModeForTile(work.tx, work.tz);
        const data = generateDesertTileData(
          {
            seed: this.seed,
            road: this.road,
            terrain: this.terrain,
            roadDistance: this.roadDistance,
          },
          work.tx,
          work.tz,
          farFromRoad,
          this.recycled.pop(),
        );
        if (
          this.wanted.has(work.key) &&
          !this.tiles.has(work.key) &&
          farFromRoad === this.desiredModeForTile(work.tx, work.tz)
        ) {
          this.readyData.set(work.key, { data, farFromRoad });
        }
      })
    ) {
      this.degradedBuildFrame = frameId;
    }
  }

  private applyOneStagedUnit(frameId: number): void {
    let promote: DesertTile | null = null;
    for (const work of this.wanted.values()) {
      if (!work.physics) continue;
      const tile = this.tiles.get(work.key);
      if (!tile || tile.hasPhysics) continue;
      if (tile.farFromRoad !== this.desiredModeForTile(work.tx, work.tz)) {
        this.teardown(tile);
        this.tiles.delete(work.key);
        continue;
      }
      if (!promote || work.score < this.wanted.get(promote.key)!.score) promote = tile;
    }
    if (promote) {
      const tile = promote;
      this.scheduler.tryRun(frameId, 'desert-promote', () => {
        this.promote(tile);
      });
      return;
    }

    let attach: TileWork | null = null;
    for (const work of this.wanted.values()) {
      const staged = this.readyData.get(work.key);
      if (!work.visual || this.tiles.has(work.key) || !staged) continue;
      if (staged.farFromRoad !== this.desiredModeForTile(work.tx, work.tz)) {
        this.discardStaged(work.key, staged);
        continue;
      }
      if (!attach || work.score < attach.score) attach = work;
    }
    if (!attach) return;
    const work = attach;
    this.scheduler.tryRun(frameId, 'desert-attach', () => {
      const staged = this.readyData.get(work.key);
      if (
        !staged ||
        !work.visual ||
        this.tiles.has(work.key) ||
        staged.farFromRoad !== this.desiredModeForTile(work.tx, work.tz)
      ) {
        if (staged && staged.farFromRoad !== this.desiredModeForTile(work.tx, work.tz)) {
          this.discardStaged(work.key, staged);
          if (this.worker) this.pumpWorker();
        }
        return;
      }
      this.readyData.delete(work.key);
      this.attach(work.tx, work.tz, staged.data, staged.farFromRoad);
    });
  }

  private syncPendingState(): void {
    let pending = this.activeRequest !== null;
    for (const work of this.wanted.values()) {
      const tile = this.tiles.get(work.key);
      if (
        tile &&
        tile.farFromRoad !== this.desiredModeForTile(work.tx, work.tz)
      ) {
        pending = true;
        break;
      }
      if (work.physics && tile && !tile.hasPhysics) {
        pending = true;
        break;
      }
      const staged = this.readyData.get(work.key);
      if (
        staged &&
        staged.farFromRoad !== this.desiredModeForTile(work.tx, work.tz)
      ) {
        pending = true;
        break;
      }
      if (work.visual && !tile && staged) {
        pending = true;
        break;
      }
      if (!tile && !staged) {
        pending = true;
        break;
      }
    }
    this.scheduler.setPending('desert', pending);
  }

  private promote(tile: DesertTile): void {
    if (tile.hasPhysics) return;
    const terrainCollider = this.physics.addHeightfield(
      DESERT_TILE_CELLS,
      DESERT_TILE_CELLS,
      tile.heights,
      { x: DESERT_TILE_SIZE, y: 1, z: DESERT_TILE_SIZE },
      { x: tile.centreX - this.origin.x, y: 0, z: tile.centreZ - this.origin.z },
      TERRAIN_COLLIDER_SURFACE,
    );
    const terrainBody = terrainCollider.parent();
    if (terrainBody) tile.bodies.push(terrainBody);

    for (const prop of tile.props) {
      const pieces = propPieces(prop.form.id);
      if (pieces && this.breakables?.isBroken(prop.id)) continue;
      const collider = this.addPropCollider(tile, prop);
      if (!collider || !pieces || !this.breakables || !prop.mesh) continue;
      tile.registered.push(prop.id);
      this.breakables.register({
        id: prop.id,
        pieces,
        x: tile.centreX + prop.x,
        y: prop.y,
        z: tile.centreZ + prop.z,
        yaw: prop.ry,
        scale: prop.scale,
        radius: prop.form.baseRadius * prop.scale * 0.8,
        height: prop.form.height * prop.scale,
        mesh: prop.mesh,
        instance: prop.instance,
        collider,
      });
    }
    tile.hasPhysics = true;
  }

  private addPropCollider(
    tile: DesertTile,
    prop: DesertPropPlacement,
  ): RAPIER.Collider | null {
    const form = prop.form;
    if (form.collider === 'none') return null;

    const rapier = this.physics.rapier;
    let desc: RAPIER.ColliderDesc;
    let y = prop.y;
    if (form.collider === 'hull') {
      if (prop.radius < ROCK_COLLIDER_MIN) return null;
      const position = form.geometry.getAttribute('position');
      const length = position.count * 3;
      if (hullPoints.length !== length) hullPoints = new Float32Array(length);
      for (let i = 0; i < position.count; i++) {
        const j = i * 3;
        hullPoints[j] = position.getX(i) * prop.scale;
        hullPoints[j + 1] = position.getY(i) * prop.scale;
        hullPoints[j + 2] = position.getZ(i) * prop.scale;
      }
      const hull = rapier.ColliderDesc.convexHull(hullPoints);
      if (!hull) throw new Error(`Desert prop ${form.id} did not produce a convex hull`);
      desc = hull;
      instanceScratch.rotation.set(prop.rx, prop.ry, prop.rz);
      desc.setRotation(instanceScratch.quaternion);
    } else if (form.collider === 'box') {
      if (!form.colliderHalf) throw new Error(`Box collider extents missing for ${form.id}`);
      const [hx, hy, hz] = form.colliderHalf;
      desc = rapier.ColliderDesc.cuboid(hx * prop.scale, hy * prop.scale, hz * prop.scale);
      y += hy * prop.scale;
      desc.setRotation({
        x: 0,
        y: Math.sin(prop.ry * 0.5),
        z: 0,
        w: Math.cos(prop.ry * 0.5),
      });
    } else {
      const halfHeight = form.height * prop.scale * 0.42;
      const radius = form.baseRadius * prop.scale * 0.8;
      desc = rapier.ColliderDesc.capsule(halfHeight, radius);
      y += halfHeight;
    }

    const body = this.physics.world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(
        tile.centreX + prop.x - this.origin.x,
        y,
        tile.centreZ + prop.z - this.origin.z,
      ),
    );
    const collider = this.physics.world.createCollider(desc, body);
    this.physics.surfaces.register(collider.handle, SurfaceType.Rock);
    tile.bodies.push(body);
    return collider;
  }

  private demote(tile: DesertTile): void {
    if (tile.registered.length > 0) {
      this.breakables?.forget(tile.registered);
      tile.registered.length = 0;
    }
    for (const body of tile.bodies) this.physics.removeBody(body);
    tile.bodies.length = 0;
    tile.hasPhysics = false;
  }

  private teardown(tile: DesertTile): void {
    if (tile.hasPhysics) this.demote(tile);
    this.scene.remove(tile.group);
    tile.geometry.dispose();
    for (const mesh of tile.meshes) mesh.dispose();
    // Every caller drops the tile from `tiles` around this call, and the geometry
    // above is gone, so nothing can read these buffers again: they are free to be
    // written over by the next tile the worker builds.
    this.reclaim(tile.data);
  }

  /**
   * Drops staged data nobody wants any more and keeps its buffers.
   *
   * Staged data is owned by nothing else — it has not been attached to a geometry
   * yet — so a discard is exactly the case where recycling is free.
   */
  private discardStaged(key: string, staged: ReadyTileData): void {
    this.readyData.delete(key);
    this.reclaim(staged.data);
  }

  /** Returns a buffer set to the free list, or lets it go when the list is full. */
  private reclaim(data: DesertTileData): void {
    if (this.disposed || this.recycled.length >= RECYCLED_TILE_LIMIT) return;
    this.recycled.push(data);
  }
}
