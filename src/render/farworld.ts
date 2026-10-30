/**
 * THE FAR WORLD: the mirror world's ground and road, merged from the real meshes.
 *
 * The far cars are simplified copies because a car's silhouette is cheap to rebuild.
 * The ground is not: the surface type, the road's texture and paint, the dunes' colour
 * and the shoulder line are how a player reads where they are. So this does not invent
 * them. Meshes tagged `farWorldSurface` (the road's surface, every terrain chunk) are
 * merged, with their world matrices, per material into one mesh each, carrying the very
 * same material and every attribute it reads.
 *
 * TWO INSTANCES, TWO PASSES:
 *
 *  - the mirror's: every streamed surface, on `FAR_WORLD_LAYER` (4). `CarMirrors` hides
 *    all `mirrorSkip` chunk groups for that pass; the merged meshes are the ground.
 *  - the main camera's: only surfaces beyond `rangeAhead`/`rangeBehind` from the player,
 *    on `MAIN_FAR_LAYER` (5), at the world's 200 m chunk boundary: the near chunk is
 *    left whole and the far chunks are merged and their groups hidden. The switch is at
 *    a chunk edge, not a fade, because a 200 m chunk cannot be half-hidden without
 *    splitting it. The main camera enables layer 5, the mirror camera does not; the
 *    mirror camera enables layer 4, the main camera does not.
 *
 * Only surfaces that cast no shadow move here for now: the road and terrain cast none,
 * so replacing them cannot leave a shadow without its object. Their merged copies
 * receive the sun shadow map, so cars', poles' and buildings' shadows still fall on the
 * road and sand. Casting props are the next slice and need a mirror shadow map (or no
 * sun shadows in the mirror) before they can move.
 *
 * The merge is rebuilt only when the streamed set, the near/far boundary or the floating
 * origin changes — never per frame.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The mirror's far world: only a mirror camera enables this layer. */
export const FAR_WORLD_LAYER = 4;
/** The main camera's far world: only the main camera enables this layer. */
export const MAIN_FAR_LAYER = 5;

type SurfaceSet = {
  meshes: Set<THREE.Mesh>;
  receiveShadow: boolean;
};

export interface FarWorldOptions {
  /** Layer the merged meshes live on. */
  layer?: number;
  /** Merge only surfaces at least this far ahead of the player, in s metres. Infinity = all. */
  rangeAhead?: number;
  /** Merge only surfaces at least this far behind the player, in s metres. */
  rangeBehind?: number;
  /** Hide the chunk groups whose surfaces are merged into this instance. */
  hideGroups?: boolean;
  /** Start visible (the main camera's instance does). */
  visible?: boolean;
  /** The world's chunk length, which is the granularity of the near/far switch. */
  chunkLength?: number;
}

export class FarWorld {
  private meshes: THREE.Mesh[] = [];
  private readonly groups = new Map<THREE.Material, SurfaceSet>();
  private readonly layer: number;
  private readonly rangeAhead: number;
  private readonly rangeBehind: number;
  private readonly hideGroups: boolean;
  private readonly chunkLength: number;
  private visible: boolean;
  private dirty = true;
  private s = Number.NaN;
  private bucket = Number.NaN;
  private lastOriginX = Number.NaN;
  private lastOriginZ = Number.NaN;

  constructor(
    private readonly scene: THREE.Scene,
    options: FarWorldOptions = {},
  ) {
    this.layer = options.layer ?? FAR_WORLD_LAYER;
    this.rangeAhead = options.rangeAhead ?? Number.POSITIVE_INFINITY;
    this.rangeBehind = options.rangeBehind ?? Number.POSITIVE_INFINITY;
    this.hideGroups = options.hideGroups ?? false;
    this.visible = options.visible ?? false;
    this.chunkLength = options.chunkLength ?? 200;
    scene.traverse(this.collect);
    scene.addEventListener('childadded', ({ child }) => child.traverse(this.collect));
    scene.addEventListener('childremoved', ({ child }) => {
      let changed = false;
      for (const [material, group] of this.groups) {
        for (const surface of group.meshes) {
          let node: THREE.Object3D | null = surface;
          while (node !== null && node !== child) node = node.parent;
          if (node === child) {
            group.meshes.delete(surface);
            changed = true;
          }
        }
        if (group.meshes.size === 0) this.groups.delete(material);
      }
      if (changed) this.invalidate();
    });
  }

  /** Public for the mirror pass: only the mirror shows it. */
  setVisible(on: boolean): void {
    this.visible = on;
    if (on && this.dirty) this.rebuild();
    else for (const mesh of this.meshes) mesh.visible = on;
  }

  /**
   * Player arclength and the floating origin. A rebase moves the chunk groups, so the
   * merged geometry is rebuilt then; moving along the road changes the near/far set only
   * when the next 200 m chunk boundary is crossed.
   */
  update(s: number, originX: number, originZ: number): void {
    this.s = s;
    const bucket = Number.isFinite(this.rangeAhead) ? Math.floor(s / this.chunkLength) : 0;
    const crossed = bucket !== this.bucket;
    this.bucket = bucket;
    if (crossed || originX !== this.lastOriginX || originZ !== this.lastOriginZ) {
      this.lastOriginX = originX;
      this.lastOriginZ = originZ;
      this.invalidate();
    }
  }

  private readonly collect = (object: THREE.Object3D): void => {
    if (object.userData.farWorldSurface !== true || !(object instanceof THREE.Mesh)) return;
    const material = object.material;
    if (Array.isArray(material)) return;
    let group = this.groups.get(material);
    if (group === undefined) {
      group = { meshes: new Set(), receiveShadow: object.receiveShadow };
      this.groups.set(material, group);
    }
    if (group.meshes.has(object)) return;
    group.meshes.add(object);
    this.invalidate();
  };

  private isFar(surface: THREE.Mesh): boolean {
    if (!Number.isFinite(this.rangeAhead)) return true;
    if (!Number.isFinite(this.s)) return false;
    const start = surface.userData.farWorldChunkStart;
    const end = surface.userData.farWorldChunkEnd;
    if (typeof start !== 'number' || typeof end !== 'number') return false;
    return start >= this.s + this.rangeAhead || end <= this.s - this.rangeBehind;
  }

  private invalidate(): void {
    this.dirty = true;
    if (this.visible) this.rebuild();
  }

  private rebuild(): void {
    this.dirty = false;
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.meshes = [];
    for (const [material, group] of this.groups) {
      const pieces: THREE.BufferGeometry[] = [];
      for (const surface of group.meshes) {
        if (!this.isFar(surface)) continue;
        surface.updateWorldMatrix(true, false);
        pieces.push(surface.geometry.clone().applyMatrix4(surface.matrixWorld));
      }
      if (pieces.length === 0) continue;
      const merged = mergeGeometries(pieces, false);
      for (const piece of pieces) piece.dispose();
      if (merged === null) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `far-world:${material.name || 'ground'}`;
      mesh.layers.set(this.layer);
      // It spans the whole far world: one draw, no per-chunk culling.
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = group.receiveShadow;
      mesh.visible = this.visible;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
    if (this.hideGroups) {
      for (const group of this.groups.values()) {
        for (const surface of group.meshes) {
          if (surface.parent !== null) surface.parent.visible = !this.isFar(surface);
        }
      }
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.meshes = [];
    this.groups.clear();
  }
}
