import * as THREE from 'three';

import { hashUnit3 } from '../core/rng';
import { TREE_STRIDE } from './deserttiledata';
import type { WorldOrigin } from './origin';
import { loadTreeVariants, type TreeLod, type TreeVariant } from './props/trees';
import { CANOPY_FULL_M } from './vistaground';

/**
 * THE FOREST: every tree the tiles planted, drawn as a handful of world-wide
 * instanced meshes — one per kind, variant, level of detail and part.
 *
 * Tiles plant (world/deserttiledata.ts) and collide (world/deserttiles.ts); this
 * draws. Drawing per tile was the first version and it cost a draw per kind per
 * part per tile — well over a hundred for a wooded window. Here the count is fixed by
 * the catalogue, about twenty, whatever the window holds.
 *
 * Every `REBUCKET_M` of camera travel (or when a tile arrives or leaves) each tree is
 * put in its level: NEAR within `NEAR_M` (full model, casts shadows), FAR out to
 * `CANOPY_FULL_M` (the thinned model, no shadow), and nowhere past that, where the
 * canopy blanket on the ground has taken over.
 */

const NEAR_M = 110;
const REBUCKET_M = 14;
const VARIANT_TAG = 0x46524553;

interface TileTrees {
  readonly centreX: number;
  readonly centreZ: number;
  readonly trees: Float32Array;
  readonly count: number;
}

interface Bucket {
  readonly mesh: THREE.InstancedMesh;
  count: number;
}

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const tint = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export class ForestRenderer {
  private readonly tiles = new Map<string, TileTrees>();
  private variants: readonly TreeVariant[][] | null = null;
  /** [kind][variant][lod] -> one bucket per part. */
  private buckets: Bucket[][][][] = [];
  private dirty = true;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private lastOriginX = Number.NaN;
  private lastOriginZ = Number.NaN;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
  ) {
    void loadTreeVariants().then((variants) => {
      this.variants = variants;
      this.buckets = variants.map((kind) =>
        kind.map((variant) => [this.makeBuckets(variant.near, true), this.makeBuckets(variant.far, false)]),
      );
      this.dirty = true;
    });
  }

  private makeBuckets(lod: TreeLod, near: boolean): Bucket[] {
    return lod.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, 64);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = near;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(mesh);
      return { mesh, count: 0 };
    });
  }

  /** A tile's trees, copied: the tile's own buffer goes back to the worker. */
  addTile(key: string, centreX: number, centreZ: number, trees: Float32Array, count: number): void {
    this.tiles.set(key, { centreX, centreZ, trees: trees.slice(0, count * TREE_STRIDE), count });
    this.dirty = true;
  }

  removeTile(key: string): void {
    if (this.tiles.delete(key)) this.dirty = true;
  }

  /** `x`/`z` are the camera's ABSOLUTE world position. */
  update(x: number, z: number): void {
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
  }

  private rebucket(camX: number, camZ: number): void {
    const variants = this.variants!;
    for (const kind of this.buckets) for (const variant of kind) for (const lod of variant) for (const b of lod) b.count = 0;
    const far = CANOPY_FULL_M + 5;
    const reach = far + 240;
    for (const tile of this.tiles.values()) {
      // A whole tile out of reach is skipped without looking at its trees.
      if (Math.abs(tile.centreX - camX) > reach || Math.abs(tile.centreZ - camZ) > reach) continue;
      const t = tile.trees;
      for (let i = 0; i < tile.count; i++) {
        const o = i * TREE_STRIDE;
        const wx = tile.centreX + t[o]!;
        const wz = tile.centreZ + t[o + 2]!;
        const d = Math.hypot(wx - camX, wz - camZ);
        if (d > far) continue;
        const kind = t[o + 5]!;
        const kindVariants = variants[kind]!;
        const variant = Math.floor(hashUnit3(VARIANT_TAG, Math.round(wx * 4), Math.round(wz * 4)) * kindVariants.length);
        const lod = d < NEAR_M ? 0 : 1;
        const s = t[o + 3]!;
        const shade = t[o + 6]!;
        pos.set(wx - this.origin.x, t[o + 1]! - 0.15, wz - this.origin.z);
        quat.setFromAxisAngle(UP, t[o + 4]!);
        scl.set(s, s * (0.92 + 0.5 * (shade - 0.84)), s);
        matrix.compose(pos, quat, scl);
        tint.setScalar(shade);
        for (const bucket of this.buckets[kind]![variant]![lod]!) this.push(bucket, matrix, tint);
      }
    }
    for (const kind of this.buckets) {
      for (const variant of kind) {
        for (const lod of variant) {
          for (const b of lod) {
            b.mesh.count = b.count;
            b.mesh.instanceMatrix.needsUpdate = true;
            if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
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
      const grown = new THREE.InstancedMesh(mesh.geometry, mesh.material, capacity * 2);
      grown.frustumCulled = false;
      grown.castShadow = mesh.castShadow;
      grown.receiveShadow = true;
      grown.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      (grown.instanceMatrix.array as Float32Array).set(mesh.instanceMatrix.array as Float32Array);
      if (mesh.instanceColor) {
        grown.setColorAt(0, c);
        (grown.instanceColor!.array as Float32Array).set(mesh.instanceColor.array as Float32Array);
      }
      this.scene.remove(mesh);
      mesh.dispose();
      this.scene.add(grown);
      (bucket as { mesh: THREE.InstancedMesh }).mesh = grown;
      mesh = grown;
    }
    mesh.setMatrixAt(bucket.count, m);
    mesh.setColorAt(bucket.count, c);
    bucket.count++;
  }
}
