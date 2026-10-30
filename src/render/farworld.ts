/**
 * THE FAR WORLD: the mirror world's ground and road, merged from the real meshes.
 *
 * The far cars are simplified copies because a car's silhouette is cheap to rebuild.
 * The ground is not: the surface type, the road's texture and paint, the dunes' colour
 * and the shoulder line are how a player reads where they are. So this does not invent
 * them. Meshes tagged `farWorldSurface` (the road's surface, every terrain chunk) are
 * merged, with their world matrices, per material into one mesh each, carrying the very
 * same material and every attribute it reads. The near meshes' groups are tagged
 * `mirrorSkip`; `CarMirrors` hides them for that pass. The result is the real ground,
 * a few draws, on `FAR_WORLD_LAYER`.
 *
 * Only surfaces that do not cast a shadow belong here for now: the road and the terrain
 * cast none, so replacing them cannot leave a shadow without its object. Their merged
 * copies receive the sun shadow map, so the cars', poles' and buildings' shadows still
 * fall on the road and sand. Casting props are the next slice and need a mirror shadow
 * map (or no sun shadows in the mirror) before they can move.
 *
 * The merge is rebuilt only when the streamed set changes or the floating origin
 * rebases — a handful of times a kilometre, never per frame.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The layer of the world that only a mirror draws: the merged ground. */
export const FAR_WORLD_LAYER = 4;

type SurfaceSet = {
  meshes: Set<THREE.Mesh>;
  receiveShadow: boolean;
};

export class FarWorld {
  private meshes: THREE.Mesh[] = [];
  private readonly groups = new Map<THREE.Material, SurfaceSet>();
  private visible = false;
  private dirty = true;
  private lastOriginX = Number.NaN;
  private lastOriginZ = Number.NaN;

  constructor(private readonly scene: THREE.Scene) {
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
   * The merged meshes are in the floating origin's frame. A rebase moves the chunk
   * groups, so the merged geometry is rebuilt then; moving along the road changes
   * nothing because the surface set is what is merged.
   */
  update(_s: number, originX: number, originZ: number): void {
    if (originX === this.lastOriginX && originZ === this.lastOriginZ) return;
    this.lastOriginX = originX;
    this.lastOriginZ = originZ;
    this.invalidate();
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
        surface.updateWorldMatrix(true, false);
        pieces.push(surface.geometry.clone().applyMatrix4(surface.matrixWorld));
      }
      if (pieces.length === 0) continue;
      const merged = mergeGeometries(pieces, false);
      for (const piece of pieces) piece.dispose();
      if (merged === null) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `far-world:${material.name || 'ground'}`;
      mesh.layers.set(FAR_WORLD_LAYER);
      // It spans the whole streamed world: one draw, no per-chunk culling.
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = group.receiveShadow;
      mesh.visible = this.visible;
      this.scene.add(mesh);
      this.meshes.push(mesh);
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
