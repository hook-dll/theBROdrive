import * as THREE from 'three';

import { hashUnit3 } from '../core/rng';
import { DESERT_TILE_SIZE, TREE_STRIDE } from './deserttiledata';
import type { ForestWorkerRequest, ForestWorkerResponse } from './forestworker';
import { FAR_WOODS_TO_M } from './farwoods';
import { applyModelDissolve, bakeImpostorAtlas, ImpostorField, type ImpostorAtlas } from './impostors';
import type { WorldOrigin } from './origin';
import {
  loadTreeVariants,
  UNDERGROWTH_FADE_TO_M,
  UNDERGROWTH_KIND_FROM,
  UNDERGROWTH_KIND_TO,
  type TreeLod,
  type TreeVariant,
} from './props/trees';
import type { Road } from './road';

/**
 * THE FOREST: every tree, drawn in four ways by distance, none of them by scaling.
 *
 *   NEAR   within `NEAR_M`: the full model — bark marks, round leaf masses — casting
 *          shadows.
 *   MID    to `SHADOW_M`: the thinned model, still casting, past the range at which
 *          every sun shadow has faded out (render/lightshader.ts), so the ring where
 *          trees stop casting is never seen. Cut to 55 m, the edge of the tree shade
 *          ran round the car along a wooded road: dappled grass near, lit grass past.
 *   FAR    to `IMPOSTOR_FROM_M`: the thinned model, no shadow, handing over to its
 *          impostor across `IMPOSTOR_BLEND_M`.
 *   IMPOSTOR  to `IMPOSTOR_TO_M`: a camera-facing quad baked from the far model
 *          (world/impostors.ts). Past it one tree of a wood in five goes on, widened,
 *          to `FAR_WOODS_TO_M` (world/farwoods.ts), and the canopy blanket rises only
 *          beyond that, in the haze.
 *          A tree standing OUTSIDE a wood — belt, copse, a wood's edge, a lone tree —
 *          goes on as an impostor to `IMPOSTOR_OPEN_TO_M`: the blanket only draws
 *          woods, and a farmland horizon is made of exactly those trees.
 *
 * Models come from the near tiles (world/deserttiles.ts plants them with exact ground
 * heights and collides their trunks); impostors from this module's own worker, which
 * plants every tile out to the impostor radius with the same function. Both hold the
 * same trees, so the swap at `IMPOSTOR_FROM_M` changes how a tree is drawn, never
 * which tree is there.
 *
 * Model buckets are world-wide instanced meshes — one per kind, variant and level,
 * about a hundred instanced draws for the whole wood — refilled every `REBUCKET_M` of camera
 * travel. The handover to impostors does NOT wait for a refill: models are bucketed a
 * refill's travel past the band, and both sides measure the band from the camera every
 * frame, dissolving into each other (see world/impostors.ts).
 */

const NEAR_M = 60;
const SHADOW_M = 110;
export const IMPOSTOR_FROM_M = 150;
/** Width of the band, centred on `IMPOSTOR_FROM_M`, where a model becomes its impostor. */
const IMPOSTOR_BLEND_M = 30;
export const IMPOSTOR_TO_M = 2000;
/** How far a tree outside a wood stays drawn: the horizon's belts and copses. */
export const IMPOSTOR_OPEN_TO_M = 6000;
const REBUCKET_M = 14;
/**
 * Models are bucketed out to here: a tree that was just outside at one refill can
 * still reach the far edge of the handover band before the next.
 */
const MODEL_REACH_M = IMPOSTOR_FROM_M + IMPOSTOR_BLEND_M / 2 + REBUCKET_M;
const VARIANT_TAG = 0x46524553;
const SHAPE_TAG = 0x53484150;
/** Impostor tiles are kept out to this many tiles: the open trees' reach. */
const IMPOSTOR_TILE_RADIUS = Math.ceil(IMPOSTOR_OPEN_TO_M / DESERT_TILE_SIZE) + 1;
/** Within this many tiles a tile carries all its trees; past it only the open ones. */
// Two tiles of margin: a tile's woods must be in before its nearest trees come within
// reach, or a whole tile's worth of them arrived at once, already inside it.
const FULL_TILE_RADIUS = Math.ceil(IMPOSTOR_TO_M / DESERT_TILE_SIZE) + 3;
/** Within this many tiles a far tile also carries its woods' far keepers (world/farwoods.ts). */
const KEEPER_TILE_RADIUS = Math.ceil(FAR_WOODS_TO_M / DESERT_TILE_SIZE) + 1;
/** Re-anchor the impostor buffer when the camera strays this far from its anchor. */
const ANCHOR_REBASE_M = 20_000;

/** A far tile's trees, as the worker planted them; `openOnly` when the woods are left out. */
interface ImpostorTile {
  readonly tx: number;
  readonly tz: number;
  readonly trees: Float32Array;
  readonly count: number;
  readonly openOnly: boolean;
  /** Whether an open-only tile also carries its woods' far keepers. */
  readonly keepers: boolean;
}

interface TileTrees {
  readonly centreX: number;
  readonly centreZ: number;
  readonly trees: Float32Array;
  readonly count: number;
}

interface Bucket {
  mesh: THREE.InstancedMesh;
  count: number;
}

/** Variant, and the height and width multipliers, of the tree at a world position. */
export function treeShape(wx: number, wz: number, variants: number, out: { variant: number; sx: number; sy: number }): void {
  const ix = Math.round(wx * 4);
  const iz = Math.round(wz * 4);
  out.variant = Math.floor(hashUnit3(VARIANT_TAG, ix, iz) * variants);
  // Height and girth vary independently: a tall thin one, a short broad one.
  out.sy = 0.82 + 0.4 * hashUnit3(SHAPE_TAG, ix, iz);
  out.sx = 0.85 + 0.32 * hashUnit3(SHAPE_TAG + 1, ix, iz);
}

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const tint = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const shape = { variant: 0, sx: 1, sy: 1 };

/** A round patch no tree may stand in: a POI's yard. Absolute metres. */
export interface Clearing {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

/** Clearings touching a square of ground centred on (x, z) with half-side `half`. */
export type ClearingSource = (x: number, z: number, half: number) => readonly Clearing[];

/**
 * A tile's trees minus those standing in a clearing, as a new packed array (or the
 * input itself when nothing is cleared).
 */
export function clearTrees(
  source: ClearingSource | null,
  centreX: number,
  centreZ: number,
  trees: Float32Array,
  count: number,
): { trees: Float32Array; count: number } {
  const clearings = source ? source(centreX, centreZ, DESERT_TILE_SIZE / 2) : [];
  if (clearings.length === 0) return { trees, count };
  const out = new Float32Array(count * TREE_STRIDE);
  let n = 0;
  for (let i = 0; i < count; i++) {
    const o = i * TREE_STRIDE;
    const x = centreX + trees[o]!;
    const z = centreZ + trees[o + 2]!;
    if (clearings.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) continue;
    out.set(trees.subarray(o, o + TREE_STRIDE), n * TREE_STRIDE);
    n++;
  }
  return { trees: out, count: n };
}

export class ForestRenderer {
  private readonly tiles = new Map<string, TileTrees>();
  /** Where no tree may stand (POI yards); set by the game, read on every tile. */
  clearings: ClearingSource | null = null;
  private variants: readonly TreeVariant[][] | null = null;
  /** [kind][variant][lod] -> one bucket per part. */
  private buckets: Bucket[][][][] = [];
  private dirty = true;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private lastOriginX = Number.NaN;
  private lastOriginZ = Number.NaN;

  private renderer: THREE.WebGLRenderer | null = null;
  private atlas: ImpostorAtlas | null = null;
  private impostors: ImpostorField | null = null;
  private anchorX = 0;
  private anchorZ = 0;
  private worker: Worker | null = null;
  private workerReady = false;
  private inFlight: string | null = null;
  /**
   * Impostor tiles. A tree's tint (float 6) is stored NEGATIVE when it stands outside
   * a wood: the impostor shader reads the sign as its reach, the magnitude as tint.
   */
  private readonly impostorTiles = new Map<string, ImpostorTile>();
  private centreTx = Number.NaN;
  private centreTz = Number.NaN;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
    private readonly seed: number,
    private readonly road: Road,
  ) {
    void loadTreeVariants().then((variants) => {
      this.variants = variants;
      for (const kind of variants) {
        for (const variant of kind) {
          for (const part of [...variant.near, ...variant.far]) applyModelDissolve(part.material, IMPOSTOR_FROM_M, IMPOSTOR_BLEND_M);
        }
      }
      this.buckets = variants.map((kind) =>
        kind.map((variant) => [
          this.makeBuckets(variant.near, true),
          this.makeBuckets(variant.far, true),
          this.makeBuckets(variant.far, false),
        ]),
      );
      this.dirty = true;
      this.maybeBake();
    });
    this.startWorker();
  }

  /** The WebGL renderer the impostor atlas is baked with. */
  attachRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
    this.maybeBake();
  }

  private maybeBake(): void {
    if (this.atlas || !this.renderer || !this.variants) return;
    this.atlas = bakeImpostorAtlas(this.renderer, this.variants);
    this.impostors = new ImpostorField(this.renderer, this.atlas, IMPOSTOR_FROM_M, IMPOSTOR_BLEND_M, IMPOSTOR_TO_M, IMPOSTOR_OPEN_TO_M, FAR_WOODS_TO_M);
    this.scene.add(this.impostors.mesh);
    // Tiles that arrived before the atlas existed are written now.
    for (const [key, tile] of this.impostorTiles) this.writeImpostorTile(key, tile);
  }

  private startWorker(): void {
    if (typeof Worker === 'undefined') return;
    try {
      const worker = new Worker(new URL('./forestworker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<ForestWorkerResponse>) => this.onWorker(event.data);
      worker.onerror = () => {
        worker.terminate();
        this.worker = null;
      };
      const init: ForestWorkerRequest = { type: 'init', seed: this.seed, spine: this.road.spine };
      worker.postMessage(init);
      this.worker = worker;
    } catch {
      this.worker = null;
    }
  }

  private onWorker(message: ForestWorkerResponse): void {
    if (message.type === 'ready') {
      this.workerReady = true;
      this.pump();
      return;
    }
    const key = `${message.tx},${message.tz}`;
    if (this.inFlight === key) this.inFlight = null;
    if (this.wantsImpostorTile(message.tx, message.tz)) {
      // The tint carries the tree's reach (world/impostors.ts): negative outside a wood,
      // plus 10 for a wood's far keeper.
      for (let i = 0; i < message.count; i++) {
        if (message.open[i] === 1) message.trees[i * TREE_STRIDE + 6] = -message.trees[i * TREE_STRIDE + 6]!;
        else if (message.open[i] === 2) message.trees[i * TREE_STRIDE + 6] = message.trees[i * TREE_STRIDE + 6]! + 10;
      }
      const cleared = clearTrees(
        this.clearings,
        (message.tx + 0.5) * DESERT_TILE_SIZE,
        (message.tz + 0.5) * DESERT_TILE_SIZE,
        message.trees,
        message.count,
      );
      const tile = { tx: message.tx, tz: message.tz, trees: cleared.trees, count: cleared.count, openOnly: message.openOnly, keepers: message.keepers };
      this.impostorTiles.set(key, tile);
      this.writeImpostorTile(key, tile);
    }
    this.pump();
  }

  private wantsImpostorTile(tx: number, tz: number): boolean {
    return Math.abs(tx - this.centreTx) <= IMPOSTOR_TILE_RADIUS && Math.abs(tz - this.centreTz) <= IMPOSTOR_TILE_RADIUS;
  }

  private wantsKeepers(tx: number, tz: number): boolean {
    return Math.abs(tx - this.centreTx) <= KEEPER_TILE_RADIUS && Math.abs(tz - this.centreTz) <= KEEPER_TILE_RADIUS;
  }

  private wantsFullTile(tx: number, tz: number): boolean {
    return Math.abs(tx - this.centreTx) <= FULL_TILE_RADIUS && Math.abs(tz - this.centreTz) <= FULL_TILE_RADIUS;
  }

  /**
   * Requests the nearest tile that is missing — or holds only its open trees but has
   * come within the woods' reach — one at a time.
   */
  private pump(): void {
    if (!this.worker || !this.workerReady || this.inFlight !== null || !Number.isFinite(this.centreTx)) return;
    let best: [number, number] | null = null;
    let bestD = Infinity;
    const R = IMPOSTOR_TILE_RADIUS;
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        const d = dx * dx + dz * dz;
        if (d > (R + 0.5) * (R + 0.5) || d >= bestD) continue;
        const tx = this.centreTx + dx;
        const tz = this.centreTz + dz;
        const have = this.impostorTiles.get(`${tx},${tz}`);
        if (have && !(have.openOnly && (this.wantsFullTile(tx, tz) || (!have.keepers && this.wantsKeepers(tx, tz))))) continue;
        best = [tx, tz];
        bestD = d;
      }
    }
    if (!best) return;
    this.inFlight = `${best[0]},${best[1]}`;
    const request: ForestWorkerRequest = {
      type: 'tile',
      tx: best[0],
      tz: best[1],
      openOnly: !this.wantsFullTile(best[0], best[1]),
      keepers: this.wantsKeepers(best[0], best[1]),
    };
    this.worker.postMessage(request);
  }

  private writeImpostorTile(key: string, tile: ImpostorTile): void {
    const field = this.impostors;
    const atlas = this.atlas;
    const variants = this.variants;
    if (!field || !atlas || !variants) return;
    const centreX = (tile.tx + 0.5) * DESERT_TILE_SIZE;
    const centreZ = (tile.tz + 0.5) * DESERT_TILE_SIZE;
    const t = tile.trees;
    field.add(key, tile.count, (i, a0, a1, at) => {
      const o = i * TREE_STRIDE;
      const wx = centreX + t[o]!;
      const wz = centreZ + t[o + 2]!;
      const kind = t[o + 5]!;
      treeShape(wx, wz, variants[kind]!.length, shape);
      const cell = atlas.cells[kind]![shape.variant]!;
      const s = t[o + 3]!;
      a0[at] = wx - this.anchorX;
      a0[at + 1] = t[o + 1]! - 0.15;
      a0[at + 2] = wz - this.anchorZ;
      a0[at + 3] = cell.drop * s * shape.sy;
      // The first view's cell, plus the tree's own turn as a fraction (world/impostors.ts).
      const turn = t[o + 4]! / (Math.PI * 2);
      a1[at] = cell.index + (turn - Math.floor(turn)) * 0.999;
      a1[at + 1] = cell.width * s * shape.sx;
      a1[at + 2] = cell.height * s * shape.sy;
      a1[at + 3] = t[o + 6]!;
    }, centreX - this.anchorX, centreZ - this.anchorZ, DESERT_TILE_SIZE * 0.75);
  }

  private makeBuckets(lod: TreeLod, near: boolean): Bucket[] {
    return lod.map((part) => {
      const mesh = this.makeMesh(part.geometry, part.material, part.depthMaterial, near, 64);
      return { mesh, count: 0 };
    });
  }

  private makeMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    depth: THREE.Material | null,
    near: boolean,
    capacity: number,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = near;
    // Wood only: the tree material keeps shadow off its leaves (world/props/trees.ts).
    mesh.receiveShadow = true;
    if (depth) mesh.customDepthMaterial = depth;
    mesh.userData.tree = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    return mesh;
  }

  /**
   * Drops every impostor tile so the worker plants them again against the current
   * clearings (after the POI spacing changed).
   */
  refreshImpostors(): void {
    for (const key of this.impostorTiles.keys()) this.impostors?.remove(key);
    this.impostorTiles.clear();
    this.inFlight = null;
    this.pump();
  }

  /** A tile's trees, copied: the tile's own buffer goes back to the worker. */
  addTile(key: string, centreX: number, centreZ: number, trees: Float32Array, count: number): void {
    this.tiles.set(key, { centreX, centreZ, trees: trees.slice(0, count * TREE_STRIDE), count });
    this.dirty = true;
  }

  removeTile(key: string): void {
    if (this.tiles.delete(key)) this.dirty = true;
  }

  /**
   * `x`/`z` are the camera's ABSOLUTE world position; `fx`/`fz` its look direction on
   * the ground and `halfFov` half its horizontal field of view, radians: impostors
   * out of view are not drawn (world/impostors.ts).
   */
  update(x: number, z: number, fx: number, fz: number, halfFov: number): void {
    this.updateImpostorWindow(x, z);
    this.impostors?.cull(x - this.anchorX, z - this.anchorZ, fx, fz, halfFov);
    if (!this.variants) return;
    const moved = Math.hypot(x - this.lastX, z - this.lastZ);
    if (
      !this.dirty &&
      moved < REBUCKET_M &&
      this.origin.x === this.lastOriginX &&
      this.origin.z === this.lastOriginZ
    ) {
      return;
    }
    this.dirty = false;
    this.lastX = x;
    this.lastZ = z;
    this.lastOriginX = this.origin.x;
    this.lastOriginZ = this.origin.z;
    this.rebucket(x, z);
    if (this.impostors) {
      this.impostors.mesh.position.set(this.anchorX - this.origin.x, 0, this.anchorZ - this.origin.z);
      this.impostors.mesh.updateMatrix();
    }
  }

  private updateImpostorWindow(x: number, z: number): void {
    const tx = Math.floor(x / DESERT_TILE_SIZE);
    const tz = Math.floor(z / DESERT_TILE_SIZE);
    if (Math.hypot(x - this.anchorX, z - this.anchorZ) > ANCHOR_REBASE_M || !Number.isFinite(this.centreTx)) {
      this.anchorX = Math.round(x);
      this.anchorZ = Math.round(z);
      for (const [key, tile] of this.impostorTiles) this.writeImpostorTile(key, tile);
      this.dirty = true;
    }
    if (tx === this.centreTx && tz === this.centreTz) return;
    this.centreTx = tx;
    this.centreTz = tz;
    for (const [key, tile] of this.impostorTiles) {
      if (this.wantsImpostorTile(tile.tx, tile.tz)) continue;
      this.impostorTiles.delete(key);
      this.impostors?.remove(key);
    }
    this.pump();
  }

  private rebucket(camX: number, camZ: number): void {
    const variants = this.variants!;
    for (const kind of this.buckets) for (const variant of kind) for (const lod of variant) for (const b of lod) b.count = 0;
    const reach = MODEL_REACH_M + DESERT_TILE_SIZE;
    for (const tile of this.tiles.values()) {
      // A whole tile out of reach is skipped without looking at its trees.
      if (Math.abs(tile.centreX - camX) > reach || Math.abs(tile.centreZ - camZ) > reach) continue;
      const t = tile.trees;
      for (let i = 0; i < tile.count; i++) {
        const o = i * TREE_STRIDE;
        const wx = tile.centreX + t[o]!;
        const wz = tile.centreZ + t[o + 2]!;
        const d = Math.hypot(wx - camX, wz - camZ);
        if (d >= MODEL_REACH_M) continue;
        const kind = t[o + 5]!;
        // Undergrowth has dissolved by here (world/props/trees.ts).
        if (kind >= UNDERGROWTH_KIND_FROM && kind <= UNDERGROWTH_KIND_TO && d >= UNDERGROWTH_FADE_TO_M) continue;
        treeShape(wx, wz, variants[kind]!.length, shape);
        const lod = d < NEAR_M ? 0 : d < SHADOW_M ? 1 : 2;
        const s = t[o + 3]!;
        pos.set(wx - this.origin.x, t[o + 1]! - 0.15, wz - this.origin.z);
        quat.setFromAxisAngle(UP, t[o + 4]!);
        scl.set(s * shape.sx, s * shape.sy, s * shape.sx);
        matrix.compose(pos, quat, scl);
        tint.setScalar(t[o + 6]!);
        for (const bucket of this.buckets[kind]![shape.variant]![lod]!) this.push(bucket, matrix, tint);
      }
    }
    for (const kind of this.buckets) {
      for (const variant of kind) {
        for (const lod of variant) {
          for (const b of lod) {
            b.mesh.count = b.count;
            // An empty bucket is still a draw, and its shadow another: most kinds are
            // absent from any one stretch of road.
            b.mesh.visible = b.count > 0;
            if (b.count === 0) continue;
            // Only what is used: the buffers are sized for the densest stretch of wood
            // seen, and uploading their whole length every 14 m was a stall of tens of
            // milliseconds (the GPU is still reading them).
            b.mesh.instanceMatrix.clearUpdateRanges();
            b.mesh.instanceMatrix.addUpdateRange(0, b.count * 16);
            b.mesh.instanceMatrix.needsUpdate = true;
            if (b.mesh.instanceColor) {
              b.mesh.instanceColor.clearUpdateRanges();
              b.mesh.instanceColor.addUpdateRange(0, b.count * 3);
              b.mesh.instanceColor.needsUpdate = true;
            }
          }
        }
      }
    }
  }

  private push(bucket: Bucket, m: THREE.Matrix4, c: THREE.Color): void {
    let mesh = bucket.mesh;
    const capacity = mesh.instanceMatrix.count;
    if (bucket.count >= capacity) {
      // Grow by doubling: a fresh mesh over the same geometry and material.
      const grown = this.makeMesh(
        mesh.geometry,
        mesh.material as THREE.Material,
        (mesh.customDepthMaterial as THREE.Material | undefined) ?? null,
        mesh.castShadow,
        capacity * 2,
      );
      (grown.instanceMatrix.array as Float32Array).set(mesh.instanceMatrix.array as Float32Array);
      if (mesh.instanceColor) {
        grown.setColorAt(0, c);
        (grown.instanceColor!.array as Float32Array).set(mesh.instanceColor.array as Float32Array);
      }
      this.scene.remove(mesh);
      mesh.dispose();
      bucket.mesh = grown;
      mesh = grown;
    }
    mesh.setMatrixAt(bucket.count, m);
    mesh.setColorAt(bucket.count, c);
    bucket.count++;
  }
}
