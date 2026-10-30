/**
 * THE FAR WORLD: the mirror world's ground, road and prop silhouettes.
 *
 * The far cars are simplified copies because a car's silhouette is cheap to rebuild.
 * The ground is not: the surface type, the road's texture and paint, the dunes' colour
 * and the shoulder line are how a player reads where they are. So the ground is the
 * real surface at a coarser grid (render/griddecimate.ts): the desert tile every fourth
 * row/column, the road every second, the same materials and attributes. Props are boxes:
 * one instanced draw for all far prop silhouettes, with their real footprints and an
 * averaged material colour. Near the chunk draws itself; far the far world does.
 *
 * TWO INSTANCES, TWO PASSES:
 *
 *  - the mirror's: every streamed surface, on `FAR_WORLD_LAYER` (4), exact geometry (the
 *    road is what a mirror is read by), plus the prop boxes. `CarMirrors` hides all
 *    `mirrorSkip` chunk groups for that pass.
 *  - the main camera's: only surfaces beyond `rangeAhead`/`rangeBehind`, on
 *    `MAIN_FAR_LAYER` (5), coarse ground/road and prop boxes. The near chunks stay whole.
 *    The switch is at the world's 200 m chunk boundary: a 200 m chunk cannot be
 *    half-hidden without splitting it. The main camera enables layer 5, the mirror camera
 *    does not; the mirror camera enables layer 4, the main camera does not.
 *
 * Only surfaces that cast no shadow move as ground: the road and terrain cast none, so
 * replacing them cannot leave a shadow without its object. Prop boxes do cast, but the
 * far shadow map is the next slice; the near road/sand still receive every near caster's
 * shadow. The merged/batched ground receives the sun shadow map as before.
 *
 * The far set is rebuilt only when the streamed set, the near/far boundary or the
 * floating origin changes — never per frame.
 */

import * as THREE from 'three';
import { decimateGrid, type GridWinding } from './griddecimate';

/** The mirror's far world: only a mirror camera enables this layer. */
export const FAR_WORLD_LAYER = 4;
/** The main camera's far world: only the main camera enables this layer. */
export const MAIN_FAR_LAYER = 5;

const PROP_BOX = new THREE.BoxGeometry(1, 1, 1);
const PROP_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.92,
  metalness: 0,
});
const PROP_FALLBACK = new THREE.Color(0x8b7d68);

type SurfaceSet = {
  meshes: Set<THREE.Mesh>;
  receiveShadow: boolean;
};

export interface FarWorldOptions {
  /** Layer the merged meshes live on. */
  layer?: number;
  /** Far only at least this far ahead of the player, in s metres. Infinity = all. */
  rangeAhead?: number;
  /** Far only at least this far behind the player, in s metres. */
  rangeBehind?: number;
  /** Hide the chunk groups whose surfaces are far. */
  hideGroups?: boolean;
  /** Start visible (the main camera's instance does). */
  visible?: boolean;
  /** Use the coarse grid copy where a surface carries one. */
  coarse?: boolean;
}

export class FarWorld {
  private batches: THREE.BatchedMesh[] = [];
  private propMeshes: THREE.InstancedMesh[] = [];
  private readonly groups = new Map<THREE.Material, SurfaceSet>();
  private readonly props = new Set<THREE.Object3D>();
  private readonly layer: number;
  private readonly rangeAhead: number;
  private readonly rangeBehind: number;
  private readonly hideGroups: boolean;
  private readonly coarse: boolean;
  private visible: boolean;
  private dirty = true;
  private s = Number.NaN;
  private playerX = Number.NaN;
  private playerZ = Number.NaN;
  private farMask = -1;
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
    this.coarse = options.coarse ?? false;
    this.visible = options.visible ?? false;
    scene.traverse(this.collect);
    scene.addEventListener('childadded', ({ child }) => child.traverse(this.collect));
    scene.addEventListener('childremoved', ({ child }) => {
      let changed = false;
      for (const [material, group] of this.groups) {
        for (const surface of group.meshes) {
          if (isInside(surface, child)) {
            group.meshes.delete(surface);
            changed = true;
          }
        }
        if (group.meshes.size === 0) this.groups.delete(material);
      }
      for (const prop of this.props) {
        if (isInside(prop, child)) {
          this.props.delete(prop);
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
    else {
      for (const batch of this.batches) batch.visible = on;
      for (const props of this.propMeshes) props.visible = on;
    }
  }

  /**
   * Player arclength and absolute position, and the floating origin. A rebase moves the
   * chunk groups, so the far set is rebuilt then. The near/far set is compared exactly
   * (one bit per surface/prop), not on a distance bucket.
   */
  update(s: number, originX: number, originZ: number, playerX = Number.NaN, playerZ = Number.NaN): void {
    this.s = s;
    this.playerX = playerX;
    this.playerZ = playerZ;
    let mask = 0;
    let bit = 1;
    for (const group of this.groups.values()) {
      for (const surface of group.meshes) {
        if (this.isFar(surface)) mask |= bit;
        bit <<= 1;
      }
    }
    for (const prop of this.props) {
      if (this.isFar(prop)) mask |= bit;
      bit <<= 1;
    }
    if (mask !== this.farMask || originX !== this.lastOriginX || originZ !== this.lastOriginZ) {
      this.farMask = mask;
      this.lastOriginX = originX;
      this.lastOriginZ = originZ;
      this.invalidate();
    }
  }

  private readonly collect = (object: THREE.Object3D): void => {
    if (object.userData.farWorldProp === true) {
      if (this.props.has(object)) return;
      this.props.add(object);
      this.invalidate();
      return;
    }
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

  /** Whether a surface/prop with this chunk/tile centre is wholly past the range. */
  private isFar(object: THREE.Object3D): boolean {
    if (!Number.isFinite(this.rangeAhead)) return true;
    const centerX = object.userData.farWorldCenterX;
    const centerZ = object.userData.farWorldCenterZ;
    if (typeof centerX === 'number' && typeof centerZ === 'number') {
      if (!Number.isFinite(this.playerX) || !Number.isFinite(this.playerZ)) return false;
      const half = typeof object.userData.farWorldHalf === 'number' ? object.userData.farWorldHalf : 0;
      const dx = Math.abs(centerX - this.playerX);
      const dz = Math.abs(centerZ - this.playerZ);
      return Math.max(dx, dz) - half > this.rangeAhead;
    }
    if (!Number.isFinite(this.s)) return false;
    const start = object.userData.farWorldChunkStart;
    const end = object.userData.farWorldChunkEnd;
    if (typeof start !== 'number' || typeof end !== 'number') return false;
    return start >= this.s + this.rangeAhead || end <= this.s - this.rangeBehind;
  }

  private invalidate(): void {
    this.dirty = true;
    if (this.visible) this.rebuild();
  }

  /**
   * The geometry this far world adds for `surface`: the coarse grid copy when the
   * surface carries one and this instance wants coarse (the main camera's), the source
   * otherwise. The copy is source data, not a GPU buffer (BatchedMesh copies it).
   */
  private farGeometry(surface: THREE.Mesh): THREE.BufferGeometry {
    if (!this.coarse) return surface.geometry;
    const cached = surface.userData.farWorldFarGeometry;
    if (cached instanceof THREE.BufferGeometry) return cached;
    const rows = surface.userData.farWorldGridRows;
    const columns = surface.userData.farWorldGridColumns;
    const stride = surface.userData.farWorldGridStride;
    const winding = surface.userData.farWorldGridWinding;
    if (
      typeof rows !== 'number' ||
      typeof columns !== 'number' ||
      typeof stride !== 'number' ||
      (winding !== 'road' && winding !== 'desert')
    ) {
      return surface.geometry;
    }
    const coarse = decimateGrid(surface.geometry, rows, columns, stride, winding as GridWinding);
    surface.userData.farWorldFarGeometry = coarse;
    return coarse;
  }

  private rebuild(): void {
    this.dirty = false;
    for (const batch of this.batches) {
      batch.removeFromParent();
      batch.dispose();
    }
    this.batches = [];
    for (const props of this.propMeshes) {
      props.removeFromParent();
      props.dispose();
    }
    this.propMeshes = [];

    for (const [material, group] of this.groups) {
      const surfaces: THREE.Mesh[] = [];
      let vertices = 0;
      let indices = 0;
      for (const surface of group.meshes) {
        if (!this.isFar(surface)) continue;
        const geometry = this.farGeometry(surface);
        const positions = geometry.getAttribute('position');
        surfaces.push(surface);
        vertices += positions.count;
        indices += geometry.index?.count ?? positions.count;
      }
      if (surfaces.length === 0) continue;
      const batch = new THREE.BatchedMesh(
        surfaces.length,
        Math.max(1, vertices),
        Math.max(1, indices),
        material,
      );
      batch.name = `far-world:${material.name || 'ground'}`;
      batch.layers.set(this.layer);
      // One batch, but each surface is frustum-culled on its own (BatchedMesh's
      // per-object culling). A single merged mesh with culling off drew the whole far
      // world even behind the camera: fewer draw calls but MORE triangles.
      batch.frustumCulled = false;
      batch.castShadow = false;
      batch.receiveShadow = group.receiveShadow;
      batch.visible = this.visible;
      for (const surface of surfaces) {
        surface.updateWorldMatrix(true, false);
        const geometryId = batch.addGeometry(this.farGeometry(surface));
        const instanceId = batch.addInstance(geometryId);
        batch.setMatrixAt(instanceId, surface.matrixWorld);
      }
      this.scene.add(batch);
      this.batches.push(batch);
    }

    const farProps = [...this.props].filter((prop) => this.isFar(prop));
    if (farProps.length > 0) {
      const boxes = new THREE.InstancedMesh(PROP_BOX, PROP_MATERIAL, farProps.length);
      boxes.name = 'far-world:props';
      boxes.layers.set(this.layer);
      boxes.castShadow = true;
      boxes.receiveShadow = false;
      boxes.frustumCulled = false;
      boxes.visible = this.visible;
      const box = new THREE.Box3();
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const size = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      const colour = new THREE.Color();
      let count = 0;
      for (const prop of farProps) {
        const was = prop.visible;
        prop.visible = true;
        prop.updateWorldMatrix(true, true);
        box.setFromObject(prop);
        if (!box.isEmpty()) {
          box.getCenter(position);
          box.getSize(size);
          size.set(Math.max(size.x, 0.05), Math.max(size.y, 0.05), Math.max(size.z, 0.05));
          matrix.compose(position, rotation, size);
          boxes.setMatrixAt(count, matrix);
          boxes.setColorAt(count, propColour(prop, colour));
          count++;
        }
        prop.visible = was;
      }
      boxes.count = count;
      boxes.instanceMatrix.needsUpdate = true;
      if (boxes.instanceColor !== null) boxes.instanceColor.needsUpdate = true;
      if (count > 0) {
        this.scene.add(boxes);
        this.propMeshes.push(boxes);
      } else {
        boxes.dispose();
      }
    }

    if (this.hideGroups) {
      for (const group of this.groups.values()) {
        for (const surface of group.meshes) {
          const target = surface.userData.farWorldHideSelf === true ? surface : surface.parent;
          if (target !== null) target.visible = !this.isFar(surface);
        }
      }
      for (const prop of this.props) prop.visible = !this.isFar(prop);
    }
  }

  dispose(): void {
    for (const batch of this.batches) {
      batch.removeFromParent();
      batch.dispose();
    }
    this.batches = [];
    for (const props of this.propMeshes) {
      props.removeFromParent();
      props.dispose();
    }
    this.propMeshes = [];
    this.groups.clear();
    this.props.clear();
  }
}

function isInside(object: THREE.Object3D, root: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  while (node !== null && node !== root) node = node.parent;
  return node === root;
}

function propColour(prop: THREE.Object3D, out: THREE.Color): THREE.Color {
  let found: THREE.Color | null = null;
  prop.traverse((object) => {
    if (found !== null || !(object instanceof THREE.Mesh)) return;
    const material = object.material;
    if (Array.isArray(material)) return;
    if (material.color !== undefined) found = material.color;
  });
  return found === null ? out.copy(PROP_FALLBACK) : out.copy(found);
}
