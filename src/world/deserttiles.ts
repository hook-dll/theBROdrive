import { lightGeometryActive } from '../render/retro';
import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

import type { PhysicsWorld } from '../core/physics';
import { hash01 } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import { freezeStaticSubtree } from './chunks';
import type { WorldOrigin } from './origin';
import {
  desertPropForms,
  pickDesertForm,
  propPieces,
  type BreakableSink,
  type DesertPropForm,
} from './props/forms';
import { buildContactShadows, contactShadowMatrix } from './props/contactshadow';
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
  MAX_TILE_PROPS,
  type DesertTileData,
} from './deserttiledata';
import { newRegionMix, regionAt } from './regions';
import type {
  DesertTileWorkerRequest,
  DesertTileWorkerResponse,
} from './deserttileworker';
import type { WorldWorkScheduler } from './workqueue';
import {
  DESERT_TILE_FADE_FULL,
  DESERT_TILE_FADE_GONE,
  DESERT_TILE_MATERIAL,
  TERRAIN_COLLIDER_SURFACE,
} from './terrainmesh';
import { DESERT_PHYSICS_TILES, DESERT_VISUAL_TILES } from './ranges';

/**
 * Player-centred open desert.
 *
 * Unlike road chunks, tiles are keyed only by absolute X/Z. Their geometry is therefore
 * a pure function of (seed, tileX, tileZ), may be discarded at any time, and rebuilds
 * identically when the player returns. The theoretical size of the desert never enters
 * the memory or draw budget: the squares in world/ranges.ts (5x5, all solid) are the complete
 * live set.
 *
 * Invariants:
 *  - neighbouring tiles of one generation mode sample the same absolute edge
 *    coordinates, so render and heightfield seams are bit-identical (during a mode
 *    switch both modes stand side by side for a while; each is valid where it stands);
 *  - every rendered/physical coordinate is relative to WorldOrigin before it reaches f32;
 *  - the current tile is always solid, even after a teleport (`ensureGroundUnderPlayer`);
 *    every other tile operation is one scheduler job: an attach, a few collider stages,
 *    or one step of a replacement;
 *  - a tile's colliders are staged disabled and switched on together, so a tile is
 *    either solid with every prop collider and breakable, or not solid at all;
 *  - outside `prime`, a live tile is never removed from inside the window to be rebuilt:
 *    a tile of the other generation mode stays drawn and solid until its replacement is
 *    complete;
 *  - all close terrain is one uniform fine lattice. There is no coarse driveable ring;
 *    the camera-centred vista owns everything beyond the fine visual square.
 */

export { DESERT_TILE_CELLS, DESERT_TILE_SIZE } from './deserttiledata';

/**
 * Past this player-to-road distance no live tile can intersect the corridor, so tiles
 * may skip the road queries ("far" generation mode). Far mode is valid anywhere past it,
 * which is why it is where far mode is LEFT.
 */
const ROAD_QUERY_CUTOFF = 900;
/**
 * Far mode is ENTERED only this much further out. Every switch regenerates the whole
 * window in the other mode, so a drive along the cutoff must not switch at each wobble
 * across it. Near mode is valid everywhere; the band costs only worker time.
 */
const ROAD_QUERY_HYSTERESIS = 200;
/**
 * Rank added to a replacement's score when choosing the worker's next tile: a live tile
 * of the other mode is valid ground meanwhile, a missing tile is a hole, so every
 * missing tile (prefetch included) is generated first.
 */
const REPLACEMENT_RANK = 1000;
const PROP_TAG = 0x44535254;
/** Scratch for a tile's region; props are built synchronously, one tile at a time. */
const tileRegion = newRegionMix();
const TILE_PROP_ID_BASE = 1_000_000;
const ROCK_COLLIDER_MIN = 0.55;
/**
 * Spare tile buffer sets held for reuse. One row of the visual ring plus a little
 * slack: enough that a boundary crossing never has to allocate, few enough that the
 * spares cost less than a megabyte.
 */
const RECYCLED_TILE_LIMIT = 12;
const instanceScratch = new THREE.Object3D();
const shadowScratch = new THREE.Matrix4();
/** Lean axis and the turn about it. A lean is measured from vertical in world space,
 *  which the instance's own euler triple cannot express once it has a yaw. */
const leanAxis = new THREE.Vector3();
const leanQuat = new THREE.Quaternion();
/** Collider centre offset in the instance's frame, carried out through its orientation. */
const colliderOffset = new THREE.Vector3();
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
  /**
   * Per-axis instance scale. A plant's `vary` moves the vertical axis and the two
   * radial ones independently, so one dragon tree stands tall and narrow where the
   * next is squat and broad. Every other form keeps all three at `scale`, which makes
   * its matrix bit-identical to the uniform one it had before.
   */
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  /** Lean from vertical in radians, and the world-space horizontal axis it turns about. */
  readonly lean: number;
  readonly leanAxisX: number;
  readonly leanAxisZ: number;
  renderScale: number;
  readonly radius: number;
  mesh: THREE.InstancedMesh | null;
  instance: number;
  /** The ground under the prop, and its contact shadow's batch (same index as the prop). */
  readonly groundY: number;
  /** Standing height, metres: a tall prop's contact shadow reaches further. */
  readonly height: number;
  shadow: THREE.InstancedMesh | null;
  shadowInstance: number;
}

/**
 * The one place an instance's orientation is decided.
 *
 * The lean is applied last and about a world-space horizontal axis, so it reads as an
 * angle from vertical whatever yaw the instance happens to carry. Colliders are built
 * through this same call: a tree that leans is met leaning, not as the upright capsule
 * its authored geometry would suggest.
 */
function orientInstance(prop: DesertPropPlacement): void {
  instanceScratch.rotation.set(prop.rx, prop.ry, prop.rz);
  if (prop.lean === 0) return;
  leanAxis.set(prop.leanAxisX, 0, prop.leanAxisZ);
  leanQuat.setFromAxisAngle(leanAxis, prop.lean);
  instanceScratch.quaternion.premultiply(leanQuat);
}

/**
 * Position, orientation and per-axis scale of one instance, shrunk by a single fade
 * factor. The fade multiplies every axis, so a fading plant shrinks towards its own
 * foot rather than sliding along its lean the way a uniform scale would.
 */
function writeInstanceTransform(prop: DesertPropPlacement, fade: number): void {
  instanceScratch.position.set(prop.x, prop.y, prop.z);
  orientInstance(prop);
  instanceScratch.scale.set(prop.sx * fade, prop.sy * fade, prop.sz * fade);
  instanceScratch.updateMatrix();
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
  /** Every body this tile's colliders hang off, staged or solid. */
  readonly bodies: RAPIER.RigidBody[];
  /** Every collider staged so far; disabled until the tile turns solid. */
  readonly colliders: RAPIER.Collider[];
  /** Prop `i`'s collider, or null where it has none; registered as breakable when solid. */
  readonly propColliders: (RAPIER.Collider | null)[];
  /**
   * Collider staging cursor: 0 nothing built, 1 the ground heightfield, `1 + i` the
   * ground and props `[0, i)`. Every stage is built at `1 + props.length`.
   */
  physicsStage: number;
  /** Solid: every staged collider enabled and every breakable registered. */
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
  /** Finished tile data awaiting attachment or a replacement; always in the current mode. */
  private readonly readyData = new Map<string, ReadyTileData>();
  /**
   * Tiles being assembled off-scene to take the place of a live tile of the other
   * generation mode, keyed like `tiles` (see `advanceReplacement`).
   */
  private readonly replacements = new Map<string, DesertTile>();
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
   * Establishes solid ground before the loading cover leaves: the whole physical square,
   * `(2 * DESERT_PHYSICS_TILES + 1)²` tiles, generated here on the main thread. The
   * bootstrap batch; in play only `ensureGroundUnderPlayer` builds synchronously.
   */
  prime(x: number, z: number, roadLateral: number): void {
    if (this.disposed) return;
    const nextFarFromRoad = this.farModeAt(roadLateral);
    const centreTx = Math.floor(x / DESERT_TILE_SIZE);
    const centreTz = Math.floor(z / DESERT_TILE_SIZE);
    if (nextFarFromRoad !== this.farFromRoad) {
      this.farFromRoad = nextFarFromRoad;
      this.invalidateGenerationMode();
    }
    for (let dz = -DESERT_PHYSICS_TILES; dz <= DESERT_PHYSICS_TILES; dz++) {
      for (let dx = -DESERT_PHYSICS_TILES; dx <= DESERT_PHYSICS_TILES; dx++) {
        this.buildSynchronously(centreTx + dx, centreTz + dz, true);
      }
    }
    this.lastX = x;
    this.lastZ = z;
    this.syncPendingState();
  }

  /**
   * Keeps the tile under the player solid immediately; everything else arrives from
   * the worker and is attached, made solid or replaced one scheduler job at a time.
   */
  update(x: number, z: number, roadLateral: number, frameId: number): void {
    if (this.disposed) return;
    const nextFarFromRoad = this.farModeAt(roadLateral);
    const modeChanged = nextFarFromRoad !== this.farFromRoad;
    const centreTx = Math.floor(x / DESERT_TILE_SIZE);
    const centreTz = Math.floor(z / DESERT_TILE_SIZE);
    if (modeChanged) {
      this.farFromRoad = nextFarFromRoad;
      this.invalidateGenerationMode();
    }

    this.ensureGroundUnderPlayer(centreTx, centreTz);

    for (const [key, tile] of this.tiles) {
      const dx = Math.abs(tile.tx - centreTx);
      const dz = Math.abs(tile.tz - centreTz);
      if (dx > DESERT_VISUAL_TILES || dz > DESERT_VISUAL_TILES) {
        this.teardown(tile);
        this.tiles.delete(key);
      } else if (tile.physicsStage > 0 && (dx > DESERT_PHYSICS_TILES || dz > DESERT_PHYSICS_TILES)) {
        this.demote(tile);
      }
    }
    for (const [key, next] of this.replacements) {
      if (!this.tiles.has(key)) {
        // The tile it was to replace has left the window.
        this.discardReplacement(key, next);
      } else if (
        next.physicsStage > 0 &&
        (Math.abs(next.tx - centreTx) > DESERT_PHYSICS_TILES || Math.abs(next.tz - centreTz) > DESERT_PHYSICS_TILES)
      ) {
        this.demote(next);
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
    this.syncPropFades(x, z);
    this.syncPendingState();
  }

  /**
   * Solid ground under the player, now: the one synchronous path in `update`.
   *
   * Reached only when ordinary streaming is behind the player — after a teleport, or
   * with the worker starved. In ordinary movement the tile under the player entered the
   * physical square two tiles earlier and has long been solid, so this does nothing. A
   * live tile of the other generation mode is valid ground and is kept as it is.
   */
  private ensureGroundUnderPlayer(tx: number, tz: number): void {
    const key = tileKey(tx, tz);
    const current = this.tiles.get(key);
    if (current) {
      this.makeSolidNow(current);
      return;
    }
    const staged = this.readyData.get(key);
    if (staged) {
      this.readyData.delete(key);
      this.makeSolidNow(this.attach(tx, tz, staged.data, staged.farFromRoad));
      return;
    }
    this.buildSynchronously(tx, tz, true);
  }

  /**
   * Re-express visual groups after PhysicsWorld has shifted every rigid body. Staged
   * colliders moved with the rest; a replacement still off-scene is placed when it goes
   * live (`goLive`).
   */
  rebase(): void {
    for (const tile of this.tiles.values()) {
      tile.group.position.x = tile.centreX - this.origin.x;
      tile.group.position.z = tile.centreZ - this.origin.z;
      // Frozen at creation (see `freezeStaticSubtree`): the root recomposes, the rest follows.
      tile.group.updateMatrix();
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
    for (const tile of this.replacements.values()) this.teardown(tile);
    this.replacements.clear();
    this.scheduler.setPending('desert', false);
  }

  get visualTileCount(): number {
    return this.tiles.size;
  }

  /**
   * Attached visual tiles against the square the last update asked for. Boot waits
   * on this so the player never arrives over ground that is still in the worker.
   */
  get readiness(): { readonly ready: number; readonly wanted: number } {
    let ready = 0;
    let wanted = 0;
    for (const work of this.wanted.values()) {
      if (!work.visual) continue;
      wanted++;
      if (this.tiles.has(work.key)) ready++;
    }
    return { ready, wanted };
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

  /** Generates and attaches a tile on the main thread: `prime` and `ensureGroundUnderPlayer` only. */
  private buildSynchronously(tx: number, tz: number, withPhysics: boolean): void {
    const key = tileKey(tx, tz);
    const existing = this.tiles.get(key);
    if (existing) {
      if (existing.farFromRoad === this.farFromRoad) {
        if (withPhysics) this.makeSolidNow(existing);
        return;
      }
      this.teardown(existing);
      this.tiles.delete(key);
    }
    const pending = this.replacements.get(key);
    if (pending) this.discardReplacement(key, pending);
    const staged = this.readyData.get(key);
    if (staged) this.discardStaged(key, staged);

    const data = generateDesertTileData(
      {
        seed: this.seed,
        road: this.road,
        terrain: this.terrain,
        roadDistance: this.roadDistance,
        coarseAway: lightGeometryActive(),
      },
      tx,
      tz,
      this.farFromRoad,
      this.recycled.pop(),
    );
    const tile = this.attach(tx, tz, data, this.farFromRoad);
    if (withPhysics) this.makeSolidNow(tile);
  }

  /** Puts a new tile in the scene and in `tiles`, not yet solid. */
  private attach(tx: number, tz: number, data: DesertTileData, farFromRoad: boolean): DesertTile {
    const tile = this.createTile(tx, tz, data, farFromRoad);
    this.goLive(tile);
    return tile;
  }

  /**
   * Builds a tile's scene objects over worker-owned typed arrays without copying them,
   * out of the scene: `goLive` puts it there.
   */
  private createTile(tx: number, tz: number, data: DesertTileData, farFromRoad: boolean): DesertTile {
    const centreX = (tx + 0.5) * DESERT_TILE_SIZE;
    const centreZ = (tz + 0.5) * DESERT_TILE_SIZE;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('aTerrainDetail', new THREE.BufferAttribute(data.detailOffsets, 1));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.setDrawRange(0, data.indexCount);

    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geometry, DESERT_TILE_MATERIAL);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);

    const { props, meshes } = this.buildProps(
      tx,
      tz,
      data.heights,
      data.propSurfaces,
      data.regionS,
      group,
    );
    freezeStaticSubtree(group);

    return {
      tx,
      tz,
      key: tileKey(tx, tz),
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
      colliders: [],
      propColliders: props.map(() => null),
      physicsStage: 0,
      hasPhysics: false,
    };
  }

  /** Places a created tile in the current origin and makes it the live tile at its key. */
  private goLive(tile: DesertTile): void {
    if (this.tiles.has(tile.key)) throw new Error(`desert tile ${tile.key} is already live`);
    tile.group.position.set(tile.centreX - this.origin.x, 0, tile.centreZ - this.origin.z);
    tile.group.updateMatrix();
    this.scene.add(tile.group);
    this.tiles.set(tile.key, tile);
  }


  private buildProps(
    tx: number,
    tz: number,
    heights: Float32Array,
    propSurfaces: Uint8Array,
    regionS: number,
    group: THREE.Group,
  ): { props: readonly DesertPropPlacement[]; meshes: readonly THREE.InstancedMesh[] } {
    // The forms weighted by the region that chose the candidates (see generateDesertTileData).
    const bias = regionAt(regionS, tileRegion).forms;
    const props: DesertPropPlacement[] = [];
    for (let i = 0; i < MAX_TILE_PROPS; i++) {
      const surface = propSurfaces[i]!;
      if (surface === 0) continue;

      const localX = (0.08 + hash01(this.seed, PROP_TAG, tx, tz, i, 1) * 0.84) * DESERT_TILE_SIZE;
      const localZ = (0.08 + hash01(this.seed, PROP_TAG, tx, tz, i, 2) * 0.84) * DESERT_TILE_SIZE;
      const forms = desertPropForms(surface as SurfaceType);
      const form = pickDesertForm(forms, hash01(this.seed, PROP_TAG, tx, tz, i, 3), bias);
      const id = tilePropId(tx, tz, i);
      if (propPieces(form.id) && this.breakables?.isBroken(id)) continue;

      const scale =
        form.minScale +
        hash01(this.seed, PROP_TAG, tx, tz, i, 4) * (form.maxScale - form.minScale);
      const vary = form.vary;
      // Shape variation, drawn from the same (seed, tile, index) as the placement, so
      // the tall tree the player passed at breakfast is the same tall tree on the way
      // back. Slot numbers continue the sequence above: renumbering one would re-roll
      // every prop in the world, and adding one must never shift the ones already used.
      const stretch =
        1 + (hash01(this.seed, PROP_TAG, tx, tz, i, 8) * 2 - 1) * (vary?.stretch ?? 0);
      const spread =
        1 + (hash01(this.seed, PROP_TAG, tx, tz, i, 9) * 2 - 1) * (vary?.spread ?? 0);
      const lean = hash01(this.seed, PROP_TAG, tx, tz, i, 10) * (vary?.lean ?? 0);
      // A lean needs a direction as well as a size; without one the axis is never read.
      const leanAzimuth =
        lean > 0 ? hash01(this.seed, PROP_TAG, tx, tz, i, 11) * Math.PI * 2 : 0;
      const sx = scale * spread;
      const sy = scale * stretch;
      const radius = form.baseRadius * sx;
      const ground = heightFromTile(heights, localX, localZ);
      // The sink hides the form's foot in the sand and is a vertical distance, so it
      // follows the vertical factor: a squat instance buries the same share of the foot
      // it actually has.
      const sink = form.baseRadius * form.sink * sy;
      props.push({
        form,
        id,
        x: localX - DESERT_TILE_SIZE * 0.5,
        y: ground - sink,
        z: localZ - DESERT_TILE_SIZE * 0.5,
        rx: form.rotate3d ? hash01(this.seed, PROP_TAG, tx, tz, i, 5) * Math.PI * 2 : 0,
        ry: hash01(this.seed, PROP_TAG, tx, tz, i, 6) * Math.PI * 2,
        rz: form.rotate3d ? hash01(this.seed, PROP_TAG, tx, tz, i, 7) * Math.PI * 2 : 0,
        scale,
        sx,
        sy,
        sz: sx,
        lean,
        leanAxisX: Math.cos(leanAzimuth),
        leanAxisZ: Math.sin(leanAzimuth),
        renderScale: scale,
        radius,
        mesh: null,
        instance: 0,
        groundY: ground,
        height: form.height * sy,
        shadow: null,
        shadowInstance: 0,
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
      // Their own place in the opaque list. The scatter's batch pages draw the same forms
      // in the same materials without receiving shadows, and three sorts opaque draws by
      // material then distance: interleaved, every change between the two re-resolved the
      // material's program and uploaded all its uniforms again (16 times a frame on the
      // road at km 30). Before the contact shadows (1), which lie over what is drawn first.
      instances.renderOrder = 0.5;
      for (let i = 0; i < placements.length; i++) {
        const prop = placements[i]!;
        writeInstanceTransform(prop, 1);
        instances.setMatrixAt(i, instanceScratch.matrix);
        prop.mesh = instances;
        prop.instance = i;
      }
      instances.instanceMatrix.needsUpdate = true;
      // Culling bounds over the instances at FULL size, computed now, before the first
      // fade write. Left to three, the sphere was computed lazily at the first cull —
      // after `syncPropFades` had already shrunk a freshly streamed tile's props towards
      // zero — and then never again, so a tile that grew to full size kept bounds a
      // fraction of its props (measured: 52 of 61 live meshes, a lone cactus at radius
      // 0), and a prop vanished as soon as its origin left the view. Fades and breaks
      // only ever shrink an instance, so the full-size sphere stays conservative for
      // the tile's whole life, and a rebase moves the tile group it is local to.
      instances.computeBoundingSphere();
      group.add(instances);
      meshes.push(instances);
    }
    const shadows = buildContactShadows(
      props.map((prop) => ({ x: prop.x, groundY: prop.groundY, z: prop.z, radius: prop.radius, height: prop.height })),
    );
    if (shadows) {
      props.forEach((prop, i) => {
        prop.shadow = shadows;
        prop.shadowInstance = i;
      });
      group.add(shadows);
      meshes.push(shadows);
    }
    return { props, meshes };
  }

  /**
   * Tile props share catalogue materials, so they cannot use the terrain vertex morph.
   * Scale them through the same radial band instead. A tile enters the visual square
   * with every prop at zero and reaches authored size over 180 metres; broken instances
   * remain zero rather than being resurrected by this visual update.
   */
  private syncPropFades(cameraX: number, cameraZ: number): void {
    const fadeSpan = DESERT_TILE_FADE_GONE - DESERT_TILE_FADE_FULL;
    for (const tile of this.tiles.values()) {
      for (const prop of tile.props) {
        if (!prop.mesh) continue;
        const dx = tile.centreX + prop.x - cameraX;
        const dz = tile.centreZ + prop.z - cameraZ;
        const distance = Math.hypot(dx, dz);
        const t = Math.min(1, Math.max(0, (distance - DESERT_TILE_FADE_FULL) / fadeSpan));
        const smooth = t * t * (3 - 2 * t);
        const broken = propPieces(prop.form.id) && this.breakables?.isBroken(prop.id);
        const fade = broken ? 0 : 1 - smooth;
        const renderScale = prop.scale * fade;
        if (Math.abs(renderScale - prop.renderScale) < 1e-4) continue;

        prop.renderScale = renderScale;
        writeInstanceTransform(prop, fade);
        prop.mesh.setMatrixAt(prop.instance, instanceScratch.matrix);
        prop.mesh.instanceMatrix.needsUpdate = true;
        if (prop.shadow) {
          prop.shadow.setMatrixAt(prop.shadowInstance, contactShadowMatrix(prop, fade, shadowScratch));
          prop.shadow.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }

  /** Far mode for a player `roadLateral` from the road, with hysteresis (see ROAD_QUERY_HYSTERESIS). */
  private farModeAt(roadLateral: number): boolean {
    return Math.abs(roadLateral) >= ROAD_QUERY_CUTOFF + (this.farFromRoad ? 0 : ROAD_QUERY_HYSTERESIS);
  }

  /**
   * The generation mode just changed. Work in flight or staged for the old mode is
   * dropped. LIVE tiles of the old mode are kept, drawn and solid, until their
   * replacements are complete (`advanceReplacement`): the old mode was the right one
   * where and when they were built, and tearing them down here left holes in the window
   * — and, under the player, a synchronous rebuild — at every crossing.
   */
  private invalidateGenerationMode(): void {
    if (this.activeRequest && this.activeRequest.farFromRoad !== this.farFromRoad) {
      // The worker cannot cancel a transferred request. Dropping its identity makes
      // the eventual response harmless; the replacement receives a new request id.
      this.activeRequest = null;
    }
    for (const [key, staged] of this.readyData) {
      if (staged.farFromRoad !== this.farFromRoad) this.discardStaged(key, staged);
    }
    for (const [key, next] of this.replacements) {
      if (next.farFromRoad !== this.farFromRoad) this.discardReplacement(key, next);
    }
  }

  /**
   * Whether finished data for `key` in mode `farFromRoad` still has a use: the tile is
   * wanted, in the current mode, and has no live tile of that mode nor a replacement
   * already being assembled.
   */
  private wantsData(key: string, farFromRoad: boolean): boolean {
    if (farFromRoad !== this.farFromRoad || !this.wanted.has(key) || this.replacements.has(key)) return false;
    return this.tiles.get(key)?.farFromRoad !== farFromRoad;
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
        coarseAway: lightGeometryActive(),
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
    if (this.wantsData(key, active.farFromRoad)) {
      this.readyData.set(key, { data: response.data, farFromRoad: active.farFromRoad });
    } else {
      this.reclaim(response.data);
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
    for (let dz = -DESERT_VISUAL_TILES; dz <= DESERT_VISUAL_TILES; dz++) {
      for (let dx = -DESERT_VISUAL_TILES; dx <= DESERT_VISUAL_TILES; dx++) {
        const physics = Math.abs(dx) <= DESERT_PHYSICS_TILES && Math.abs(dz) <= DESERT_PHYSICS_TILES;
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
      for (let dz = -DESERT_VISUAL_TILES; dz <= DESERT_VISUAL_TILES; dz++) {
        this.addWanted(
          centreTx + step * (DESERT_VISUAL_TILES + 1),
          centreTz + dz,
          false,
          false,
          -50 + dz * dz,
        );
      }
    } else if (Math.abs(dirZ) > 1e-6) {
      const step = dirZ < 0 ? -1 : 1;
      for (let dx = -DESERT_VISUAL_TILES; dx <= DESERT_VISUAL_TILES; dx++) {
        this.addWanted(
          centreTx + dx,
          centreTz + step * (DESERT_VISUAL_TILES + 1),
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
      if (!this.wantsData(key, staged.farFromRoad)) this.discardStaged(key, staged);
    }
  }

  /**
   * The best-scored wanted tile that needs data: one with no tile at all, or — after
   * every missing one (REPLACEMENT_RANK) — one whose live tile is in the other mode.
   */
  private nextUnpreparedWork(): TileWork | null {
    let next: TileWork | null = null;
    let nextRank = Number.POSITIVE_INFINITY;
    for (const work of this.wanted.values()) {
      if (this.readyData.has(work.key) || this.replacements.has(work.key)) continue;
      const tile = this.tiles.get(work.key);
      if (tile && (tile.farFromRoad === this.farFromRoad || !work.visual)) continue;
      const rank = work.score + (tile ? REPLACEMENT_RANK : 0);
      if (rank < nextRank) {
        next = work;
        nextRank = rank;
      }
    }
    return next;
  }

  /** Sends only one job at a time so an old visual fill cannot block a new forward row. */
  private pumpWorker(): void {
    if (!this.worker || !this.workerReady || this.activeRequest) return;
    const next = this.nextUnpreparedWork();
    if (!next) return;

    const requestId = ++this.nextRequestId;
    const farFromRoad = this.farFromRoad;
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
   *
   * KNOWN OVERRUN: this generates a whole tile in one job, far past a job slice, because
   * `generateDesertTileData` is not resumable. It runs only once the worker has failed,
   * and the scheduler's DEV report names it (`desert-generate-degraded`).
   */
  private pumpDegraded(frameId: number): void {
    if (this.worker || this.degradedBuildFrame === frameId) return;
    const work = this.nextUnpreparedWork();
    if (!work) return;
    if (
      this.scheduler.tryRun(frameId, 'desert-generate-degraded', () => {
        const farFromRoad = this.farFromRoad;
        const data = generateDesertTileData(
          {
            seed: this.seed,
            road: this.road,
            terrain: this.terrain,
            roadDistance: this.roadDistance,
            coarseAway: lightGeometryActive(),
          },
          work.tx,
          work.tz,
          farFromRoad,
          this.recycled.pop(),
        );
        if (this.wantsData(work.key, farFromRoad)) {
          this.readyData.set(work.key, { data, farFromRoad });
        } else {
          this.reclaim(data);
        }
      })
    ) {
      this.degradedBuildFrame = frameId;
    }
  }

  /**
   * At most one tile job per call, most urgent kind first:
   *  1. collider stages for a live tile the physical square needs solid;
   *  2. attaching staged data where the window has no tile at all (a hole);
   *  3. a step of replacing a live tile of the other generation mode.
   */
  private applyOneStagedUnit(frameId: number): void {
    let promote: DesertTile | null = null;
    let promoteScore = Number.POSITIVE_INFINITY;
    for (const work of this.wanted.values()) {
      if (!work.physics) continue;
      const tile = this.tiles.get(work.key);
      if (!tile || tile.hasPhysics || work.score >= promoteScore) continue;
      promote = tile;
      promoteScore = work.score;
    }
    if (promote) {
      const tile = promote;
      this.scheduler.tryRun(frameId, 'desert-promote', (deadline) => {
        if (this.advancePhysics(tile, deadline)) this.finishPhysics(tile);
      });
      return;
    }

    let attach: TileWork | null = null;
    for (const work of this.wanted.values()) {
      if (!work.visual || this.tiles.has(work.key) || !this.readyData.has(work.key)) continue;
      if (!attach || work.score < attach.score) attach = work;
    }
    if (attach) {
      const work = attach;
      this.scheduler.tryRun(frameId, 'desert-attach', () => {
        const staged = this.readyData.get(work.key);
        if (!staged || this.tiles.has(work.key)) return;
        this.readyData.delete(work.key);
        this.attach(work.tx, work.tz, staged.data, staged.farFromRoad);
      });
      return;
    }

    let replace: TileWork | null = null;
    for (const work of this.wanted.values()) {
      const tile = this.tiles.get(work.key);
      if (!work.visual || !tile || tile.farFromRoad === this.farFromRoad) continue;
      if (!this.replacements.has(work.key) && !this.readyData.has(work.key)) continue;
      if (!replace || work.score < replace.score) replace = work;
    }
    if (!replace) return;
    const work = replace;
    this.scheduler.tryRun(frameId, 'desert-replace', (deadline) => {
      this.advanceReplacement(work, deadline);
    });
  }

  /**
   * One job of replacing a live tile built in the other generation mode.
   *
   * The old tile stays drawn and solid throughout. Its replacement is created off-scene
   * from the staged data, its colliders are staged disabled if the square needs it
   * solid, and the two change places inside the job that finishes it: old torn down
   * first (its breakables forgotten), new placed, switched on and registered. No frame
   * is rendered or simulated between, so the ground never has a hole.
   */
  private advanceReplacement(work: TileWork, deadline: number): void {
    const old = this.tiles.get(work.key);
    if (!old) return;
    let next = this.replacements.get(work.key);
    if (!next) {
      const staged = this.readyData.get(work.key);
      if (!staged) return;
      this.readyData.delete(work.key);
      next = this.createTile(work.tx, work.tz, staged.data, staged.farFromRoad);
      this.replacements.set(work.key, next);
      if (performance.now() >= deadline) return;
    }
    if (work.physics && !this.advancePhysics(next, deadline)) return;

    this.replacements.delete(work.key);
    this.teardown(old);
    this.tiles.delete(work.key);
    this.goLive(next);
    if (work.physics) this.finishPhysics(next);
  }

  private syncPendingState(): void {
    let pending = this.activeRequest !== null;
    for (const work of this.wanted.values()) {
      if (pending) break;
      const tile = this.tiles.get(work.key);
      if (!tile) {
        // A hole is owed an attach; prefetch-only data is done once it is staged.
        pending = work.visual || !this.readyData.has(work.key);
      } else {
        pending = tile.farFromRoad !== this.farFromRoad || (work.physics && !tile.hasPhysics);
      }
    }
    this.scheduler.setPending('desert', pending);
  }

  /**
   * Builds one collider stage: the ground heightfield first, then one prop per stage.
   * Colliders are created disabled; nothing is solid until `finishPhysics`.
   */
  private buildPhysicsStage(tile: DesertTile): void {
    if (tile.physicsStage === 0) {
      const ground = this.physics.addHeightfield(
        DESERT_TILE_CELLS,
        DESERT_TILE_CELLS,
        tile.heights,
        { x: DESERT_TILE_SIZE, y: 1, z: DESERT_TILE_SIZE },
        { x: tile.centreX - this.origin.x, y: 0, z: tile.centreZ - this.origin.z },
        TERRAIN_COLLIDER_SURFACE,
      );
      ground.setEnabled(false);
      tile.colliders.push(ground);
      const body = ground.parent();
      if (body) tile.bodies.push(body);
    } else {
      const i = tile.physicsStage - 1;
      const prop = tile.props[i]!;
      if (!(propPieces(prop.form.id) && this.breakables?.isBroken(prop.id))) {
        const collider = this.addPropCollider(tile, prop);
        if (collider) {
          collider.setEnabled(false);
          tile.colliders.push(collider);
          tile.propColliders[i] = collider;
        }
      }
    }
    tile.physicsStage++;
  }

  /**
   * Builds collider stages until `deadline`, at least one while any remain. True once
   * every stage is built (the tile is ready for `finishPhysics`).
   */
  private advancePhysics(tile: DesertTile, deadline: number): boolean {
    const stages = 1 + tile.props.length;
    while (tile.physicsStage < stages) {
      this.buildPhysicsStage(tile);
      if (performance.now() >= deadline) break;
    }
    return tile.physicsStage >= stages;
  }

  /** The tile turns solid: every staged collider switches on and its breakables register. */
  private finishPhysics(tile: DesertTile): void {
    for (const collider of tile.colliders) collider.setEnabled(true);
    for (let i = 0; i < tile.props.length; i++) {
      const prop = tile.props[i]!;
      const collider = tile.propColliders[i];
      const pieces = propPieces(prop.form.id);
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
        // The impact test is a coarse box around the standing prop, so it takes the
        // footprint the instance actually has — spread wide or stretched tall — and
        // not the authored one.
        radius: prop.radius * 0.8,
        height: prop.form.height * prop.sy,
        mesh: prop.mesh,
        instance: prop.instance,
        collider,
      });
    }
    tile.hasPhysics = true;
  }

  /** Every remaining stage and the switch-on, now: ground the player stands on. */
  private makeSolidNow(tile: DesertTile): void {
    if (tile.hasPhysics) return;
    this.advancePhysics(tile, Number.POSITIVE_INFINITY);
    this.finishPhysics(tile);
  }

  private addPropCollider(
    tile: DesertTile,
    prop: DesertPropPlacement,
  ): RAPIER.Collider | null {
    const form = prop.form;
    if (form.collider === 'none') return null;

    const rapier = this.physics.rapier;
    // The collider is described in the instance's own frame and then carried into the
    // world by the instance's orientation — the very one the drawn matrix uses — so a
    // tree that leans, stretches or spreads is met where it is drawn. `colliderOffset`
    // is the centre offset that frame shift needs; it stays zero for forms whose body
    // already sits on the instance origin.
    let desc: RAPIER.ColliderDesc;
    orientInstance(prop);
    colliderOffset.set(0, 0, 0);
    if (form.collider === 'hull') {
      if (prop.radius < ROCK_COLLIDER_MIN) return null;
      const position = form.geometry.getAttribute('position');
      const length = position.count * 3;
      if (hullPoints.length !== length) hullPoints = new Float32Array(length);
      for (let i = 0; i < position.count; i++) {
        const j = i * 3;
        hullPoints[j] = position.getX(i) * prop.sx;
        hullPoints[j + 1] = position.getY(i) * prop.sy;
        hullPoints[j + 2] = position.getZ(i) * prop.sz;
      }
      const hull = rapier.ColliderDesc.convexHull(hullPoints);
      if (!hull) throw new Error(`Desert prop ${form.id} did not produce a convex hull`);
      desc = hull;
      desc.setRotation(instanceScratch.quaternion);
    } else if (form.collider === 'box') {
      if (!form.colliderHalf) throw new Error(`Box collider extents missing for ${form.id}`);
      const [hx, hy, hz] = form.colliderHalf;
      desc = rapier.ColliderDesc.cuboid(hx * prop.sx, hy * prop.sy, hz * prop.sz);
      colliderOffset.set(0, hy * prop.sy, 0).applyQuaternion(instanceScratch.quaternion);
      desc.setRotation(instanceScratch.quaternion);
    } else {
      const halfHeight = form.height * prop.sy * 0.42;
      const radius = form.baseRadius * prop.sx * 0.8;
      desc = rapier.ColliderDesc.capsule(halfHeight, radius);
      // A capsule is described about its middle, but an instance pivots about its foot:
      // the centre goes through the same orientation, so a leaning trunk's collider
      // leans with the trunk instead of swinging it out of the ground.
      colliderOffset.set(0, halfHeight, 0).applyQuaternion(instanceScratch.quaternion);
      desc.setRotation(instanceScratch.quaternion);
    }

    const body = this.physics.world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(
        tile.centreX + prop.x + colliderOffset.x - this.origin.x,
        prop.y + colliderOffset.y,
        tile.centreZ + prop.z + colliderOffset.z - this.origin.z,
      ),
    );
    const collider = this.physics.world.createCollider(desc, body);
    this.physics.surfaces.register(collider.handle, SurfaceType.Rock);
    tile.bodies.push(body);
    return collider;
  }

  /** Back to not solid: breakables forgotten, every staged or live collider removed. */
  private demote(tile: DesertTile): void {
    if (tile.registered.length > 0) {
      this.breakables?.forget(tile.registered);
      tile.registered.length = 0;
    }
    for (const body of tile.bodies) this.physics.removeBody(body);
    tile.bodies.length = 0;
    tile.colliders.length = 0;
    tile.propColliders.fill(null);
    tile.physicsStage = 0;
    tile.hasPhysics = false;
  }

  /** Frees a tile, live or an off-scene replacement; callers drop it from its map. */
  private teardown(tile: DesertTile): void {
    if (tile.physicsStage > 0) this.demote(tile);
    this.scene.remove(tile.group);
    tile.geometry.dispose();
    for (const mesh of tile.meshes) mesh.dispose();
    // Every caller drops the tile from `tiles` or `replacements` around this call, and
    // the geometry above is gone, so nothing can read these buffers again: they are
    // free to be written over by the next tile the worker builds.
    this.reclaim(tile.data);
  }

  private discardReplacement(key: string, next: DesertTile): void {
    this.replacements.delete(key);
    this.teardown(next);
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
