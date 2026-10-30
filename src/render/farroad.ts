/**
 * THE FAR ROAD: the mirror world's road, merged from the road's own surfaces.
 *
 * A flat ribbon lost the thing a mirror is read by — the surface type, its texture, the
 * paint and the shoulder line. So this does not invent a road. Every road chunk's
 * surface mesh is tagged `farRoadSurface` (world/roadmesh.ts); this collects those
 * geometries, applies their world matrices and merges them into ONE mesh with the very
 * same `roadMaterial` and every attribute it reads (`color`, `uv`, `aRoadCourse`,
 * `aRoadEdge`). The result is the real road, one draw, on `FAR_WORLD_LAYER`.
 *
 * The near surface meshes themselves are hidden for the mirror pass: their chunk group
 * is tagged `mirrorSkip` and `CarMirrors` hides it. Their bed, skirt and shoulder go with
 * them; the merged surfaces carry the asphalt, gravel, paint and wear the player sees.
 * The road casts no shadow, so replacing it cannot leave a shadow without its object.
 *
 * The merge is rebuilt only when the streamed surface set changes or the floating origin
 * rebases — a handful of times a kilometre, never per frame.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The layer of the world that only a mirror draws: the merged road (and, later, far props). */
export const FAR_WORLD_LAYER = 4;

export class FarRoad {
  private mesh: THREE.Mesh | null = null;
  private material: THREE.Material | null = null;
  private visible = false;
  private dirty = true;
  private lastOriginX = Number.NaN;
  private lastOriginZ = Number.NaN;
  /** Every live road surface mesh, by identity. */
  private readonly surfaces = new Set<THREE.Mesh>();

  constructor(private readonly scene: THREE.Scene) {
    scene.traverse(this.collect);
    scene.addEventListener('childadded', ({ child }) => child.traverse(this.collect));
    scene.addEventListener('childremoved', ({ child }) => {
      let changed = false;
      for (const surface of this.surfaces) {
        let node: THREE.Object3D | null = surface;
        while (node !== null && node !== child) node = node.parent;
        if (node === child) {
          this.surfaces.delete(surface);
          changed = true;
        }
      }
      if (changed) this.invalidate();
    });
  }

  /** Public for the mirror pass: only the mirror shows it. */
  setVisible(on: boolean): void {
    this.visible = on;
    if (on && this.dirty) this.rebuild();
    else if (this.mesh !== null) this.mesh.visible = on;
  }

  /**
   * The merged mesh is in the floating origin's frame. A rebase moves the chunk groups,
   * so the merged geometry is rebuilt then; the movement along the road alone changes
   * nothing (the surface set is what is merged, not a sampled ribbon).
   */
  update(_s: number, originX: number, originZ: number): void {
    if (originX === this.lastOriginX && originZ === this.lastOriginZ) return;
    this.lastOriginX = originX;
    this.lastOriginZ = originZ;
    this.invalidate();
  }

  private readonly collect = (object: THREE.Object3D): void => {
    if (object.userData.farRoadSurface !== true || !(object instanceof THREE.Mesh)) return;
    if (this.surfaces.has(object)) return;
    this.surfaces.add(object);
    this.invalidate();
  };

  private invalidate(): void {
    this.dirty = true;
    if (this.visible) this.rebuild();
  }

  private rebuild(): void {
    this.dirty = false;
    if (this.mesh !== null) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.surfaces.size === 0) return;
    const pieces: THREE.BufferGeometry[] = [];
    for (const surface of this.surfaces) {
      const material = surface.material;
      if (Array.isArray(material)) continue;
      this.material = material;
      surface.updateWorldMatrix(true, false);
      pieces.push(surface.geometry.clone().applyMatrix4(surface.matrixWorld));
    }
    if (pieces.length === 0 || this.material === null) return;
    const merged = mergeGeometries(pieces, false);
    for (const piece of pieces) piece.dispose();
    if (merged === null) return;
    const mesh = new THREE.Mesh(merged, this.material);
    mesh.name = 'far-road';
    mesh.layers.set(FAR_WORLD_LAYER);
    // It spans the whole streamed road: one draw, no per-chunk culling.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.visible = this.visible;
    this.scene.add(mesh);
    this.mesh = mesh;
  }

  dispose(): void {
    if (this.mesh !== null) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.surfaces.clear();
  }
}
