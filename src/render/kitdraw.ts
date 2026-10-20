/**
 * A kit car in one draw per material: its opaque parts, its glass and its four wheels.
 *
 * A kit body is some 150 meshes under 100-odd nodes (carkit: one mesh per material slot
 * per part, every door, lid, pane, needle, pedal and switch a node of its own), and a
 * near car cost 60-150 draws in the scene pass, each 3-4 µs of main thread. Every slot
 * but the glass is one material (carkit/materials.ts), so the whole car merges into one
 * buffer per material, a RIGID SKIN: every vertex weighted 1 to the node its part hangs
 * from (`prepareKitDraw`). The nodes stay: the rig (carkit/rig.ts) still turns and slides
 * them and hides the detail tiers, and `KitSkeleton` reads them once a frame into the
 * bone texture, a node's motion relative to its rest pose, or nothing where a node on
 * its way down from the body is hidden.
 *
 * The meshes the car was built of stay too, as PICK PROXIES on `KIT_PICK_LAYER`, which no
 * camera draws: player/interaction.ts, the car lab and stickers ray-cast them as before
 * (their materials, names and chassis stamps are the car's), the lamps find their lenses
 * and the far and mid bakes read them. The merged meshes are never ray-cast.
 *
 * Programs (.omp/rules/shader-variants.md): the skinned variants of the car's one
 * material, its glass and its wheel set's material, and their depth programs, are in
 * every model's program anchor (render/carmodel.ts `buildProgramAnchor`).
 */

import * as THREE from 'three';
import { KIT_DETAIL_GROUPS, paneFrame } from '../carkit/rig';
import { bakeCarPaintGeometry } from './farcars';
import { KIT_PANE_ATTRIBUTE, KIT_PANE_SLOTS, KIT_SHADOW_ATTRIBUTE, kitCastDepthMaterial } from './materials';

/** The layer the pick proxies are on alone: ray-cast, never drawn (raycasters enable it). */
export const KIT_PICK_LAYER = 2;

/** One kit model's merged meshes and the nodes they ride. */
export interface KitDrawModel {
  /** Every part but the panes, in the body node's frame, in the one material. */
  readonly opaque: THREE.BufferGeometry;
  /** Every pane; null for none. */
  readonly glass: THREE.BufferGeometry | null;
  /** Each bone's node, as its index in the body's `traverse` order. */
  readonly bones: readonly number[];
  /** Each bone's rest frame in the body node's, inverted. */
  readonly inverses: readonly THREE.Matrix4[];
}

/**
 * Whether a node moves or hides on its own (a bone): the body, every node the rig drives
 * (`kitMotion`), the detail groups and the cabin's fine detail it hides, and every drop
 * pane (the rig slides the pane mesh itself, carkit/rig.ts `SinkingPane`).
 */
function isBone(node: THREE.Object3D, body: THREE.Object3D): boolean {
  return (
    node === body ||
    node.userData.kitMotion !== undefined ||
    node.userData.kitFine === true ||
    KIT_DETAIL_GROUPS.has(node.name) ||
    ((node as THREE.Mesh).isMesh === true && node.parent?.userData.kitMotion?.kind === 'sink')
  );
}

/**
 * Prepares a fitted kit template (render/carmodel.ts `buildTemplate`, after its shadow
 * rules and chassis stamp): writes onto each built mesh what its merged vertices need
 * (`KIT_SHADOW_ATTRIBUTE` from the mesh's own shadow flags; `KIT_PANE_ATTRIBUTE` and a
 * pane slot on each drop pane), merges them, and turns the meshes into pick proxies.
 */
export function prepareKitDraw(body: THREE.Object3D): KitDrawModel {
  body.updateMatrixWorld(true);
  const order: THREE.Object3D[] = [];
  body.traverse((node) => order.push(node));
  const bones: number[] = [];
  const boneOf = new Map<THREE.Object3D, number>();
  const inverses: THREE.Matrix4[] = [];
  const bodyInverse = body.matrixWorld.clone().invert();
  order.forEach((node, index) => {
    if (!isBone(node, body)) return;
    boneOf.set(node, bones.length);
    bones.push(index);
    inverses.push(new THREE.Matrix4().multiplyMatrices(bodyInverse, node.matrixWorld).invert());
  });
  const boneFor = (mesh: THREE.Mesh): number => {
    for (let node: THREE.Object3D | null = mesh; node; node = node.parent) {
      const bone = boneOf.get(node);
      if (bone !== undefined) return bone;
    }
    throw new Error(`Kit mesh "${mesh.name}" is not under the body`);
  };

  let panes = 0;
  const built: THREE.Mesh[] = [];
  body.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && mesh.userData.kitSlot !== undefined) built.push(mesh);
  });
  for (const mesh of built) {
    const geometry = mesh.geometry;
    const count = geometry.getAttribute('position').count;
    if (mesh.userData.kitSlot !== 'glass') {
      const shadow = new Uint8Array(count * 2);
      const cast = mesh.castShadow ? 255 : 0;
      const receive = mesh.receiveShadow ? 255 : 0;
      for (let i = 0; i < count; i++) {
        shadow[i * 2] = cast;
        shadow[i * 2 + 1] = receive;
      }
      geometry.setAttribute(KIT_SHADOW_ATTRIBUTE, new THREE.BufferAttribute(shadow, 2, true));
      continue;
    }
    // A pane's height above its bottom edge; a pane that does not wind down stands at 1.
    const pane = new Float32Array(count * 2);
    if (mesh.parent?.userData.kitMotion?.kind === 'sink') {
      if (++panes > KIT_PANE_SLOTS) throw new Error(`Kit body has more than ${KIT_PANE_SLOTS} drop panes`);
      mesh.userData.kitPane = panes;
      const { base, up } = paneFrame(geometry);
      const position = geometry.getAttribute('position');
      const p = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        pane[i * 2] = panes;
        pane[i * 2 + 1] = p.fromBufferAttribute(position, i).sub(base).dot(up);
      }
    } else {
      for (let i = 0; i < count; i++) pane[i * 2 + 1] = 1;
    }
    geometry.setAttribute(KIT_PANE_ATTRIBUTE, new THREE.BufferAttribute(pane, 2));
  }

  // Merged in the body node's frame: its children are the roots, its own fit is the mesh's.
  const glass = (mesh: THREE.Mesh): boolean => mesh.userData.kitSlot === 'glass';
  const opaque = bakeCarPaintGeometry(body.children, (mesh) => (mesh.userData.kitSlot !== undefined && !glass(mesh) ? 0 : -1), boneFor);
  if (!opaque) throw new Error('Kit body has no opaque parts');
  const panesMerged = bakeCarPaintGeometry(body.children, (mesh) => (glass(mesh) ? 0 : -1), boneFor);

  for (const mesh of built) {
    mesh.layers.set(KIT_PICK_LAYER);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  }
  return { opaque, glass: panesMerged, bones, inverses };
}

const _rel = new THREE.Matrix4();
const _bone = new THREE.Matrix4();

/**
 * Bones that are the car's own nodes. A bone's matrix is its node's frame relative to the
 * mesh's parent (each node's `matrix` composed down the chain from its parent bone) times
 * its inverted rest frame; zero, which folds every vertex of it to a point, where a node
 * on the chain is hidden. Written into the bone texture, and the texture uploaded, only
 * when a bone moved.
 */
export class KitSkeleton extends THREE.Skeleton {
  private readonly rel: THREE.Matrix4[];
  private readonly shown: Uint8Array;

  constructor(
    /** Each bone's parent bone, or -1 for one relative to the mesh's parent. */
    private readonly parents: Int16Array,
    /** The nodes from a bone's parent bone (exclusive) down to its own node. */
    private readonly chains: readonly (readonly THREE.Object3D[])[],
    private readonly inverses: readonly THREE.Matrix4[],
  ) {
    super();
    // Three sizes the bone texture by `bones.length`; nothing else reads them.
    this.bones = new Array<THREE.Bone>(parents.length);
    this.boneMatrices = new Float32Array(parents.length * 16);
    this.rel = Array.from({ length: parents.length }, () => new THREE.Matrix4());
    this.shown = new Uint8Array(parents.length);
  }

  override update(): void {
    const out = this.boneMatrices!;
    let changed = false;
    for (let i = 0; i < this.parents.length; i++) {
      const parent = this.parents[i]!;
      const rel = this.rel[i]!;
      let shown = parent < 0 ? 1 : this.shown[parent]!;
      if (parent < 0) rel.identity();
      else rel.copy(this.rel[parent]!);
      for (const node of this.chains[i]!) {
        if (!node.visible) shown = 0;
        rel.multiply(node.matrix);
      }
      this.shown[i] = shown;
      const e = _bone.multiplyMatrices(rel, this.inverses[i]!).elements;
      const at = i * 16;
      for (let k = 0; k < 16; k++) {
        const value = shown ? Math.fround(e[k]!) : 0;
        if (out[at + k] !== value) {
          out[at + k] = value;
          changed = true;
        }
      }
    }
    if (changed && this.boneTexture) this.boneTexture.needsUpdate = true;
  }
}

/** A merged kit mesh: never ray-cast (the proxies are), its bones read straight from the texture data. */
class KitSkinnedMesh extends THREE.SkinnedMesh {
  override raycast(): void {}

  override applyBoneTransform(index: number, vector: THREE.Vector3): THREE.Vector3;
  override applyBoneTransform(index: number, vector: THREE.Vector4): THREE.Vector4;
  override applyBoneTransform(index: number, vector: THREE.Vector3 | THREE.Vector4): THREE.Vector3 | THREE.Vector4;
  override applyBoneTransform(index: number, vector: THREE.Vector3 | THREE.Vector4): THREE.Vector3 | THREE.Vector4 {
    const bone = _rel.fromArray(this.skeleton.boneMatrices!, this.geometry.getAttribute('skinIndex').getX(index) * 16);
    return vector instanceof THREE.Vector4 ? vector.applyMatrix4(bone) : vector.applyMatrix4(bone);
  }
}

/** How far a part of a car swings out of its shut outline (an open door, the bonnet), metres. */
export const SWING_REACH_M = 1.5;

/** A skinned mesh over `skeleton`, its bones in the frame of the mesh's parent. */
function skinned(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], skeleton: THREE.Skeleton, sphere: THREE.Sphere): THREE.SkinnedMesh {
  const mesh = new KitSkinnedMesh(geometry, material);
  mesh.bindMode = THREE.DetachedBindMode;
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.boundingSphere = sphere;
  return mesh;
}

/**
 * A car instance's merged meshes (a clone of a template `prepareKitDraw` ran on), added to
 * `body` in its own materials: `paint`, the car's one material, and `glass`. Call before
 * anything else adds to `body` below its own children (the bones are found by their
 * place in `traverse`). Returns the skeleton, which the car alone owns (its bone texture).
 */
export function attachKitDraw(body: THREE.Object3D, model: KitDrawModel, paint: THREE.Material, glass: THREE.Material | null): KitSkeleton {
  const order: THREE.Object3D[] = [];
  body.traverse((node) => order.push(node));
  const nodes = model.bones.map((index) => order[index]!);
  const index = new Map(nodes.map((node, i) => [node, i]));
  const parents = new Int16Array(nodes.length);
  const chains = nodes.map((node, i) => {
    const chain: THREE.Object3D[] = [];
    parents[i] = -1;
    for (let at: THREE.Object3D | null = node; at && at !== body; at = at.parent) {
      if (at !== node && index.has(at)) {
        parents[i] = index.get(at)!;
        break;
      }
      chain.unshift(at);
    }
    return chain;
  });
  const skeleton = new KitSkeleton(parents, chains, model.inverses);
  const reach = (geometry: THREE.BufferGeometry): THREE.Sphere => {
    const sphere = geometry.boundingSphere!.clone();
    sphere.radius += SWING_REACH_M;
    return sphere;
  };

  const opaque = skinned(model.opaque, paint, skeleton, reach(model.opaque));
  opaque.name = 'kit-body-draw';
  // Casts only where its parts do (`KIT_SHADOW_ATTRIBUTE`), receives only where they do.
  opaque.castShadow = true;
  opaque.receiveShadow = true;
  opaque.customDepthMaterial = kitCastDepthMaterial();
  body.add(opaque);
  if (model.glass && glass) {
    const panes = skinned(model.glass, glass, skeleton, reach(model.glass));
    panes.name = 'kit-glass-draw';
    // The panes' contract (`prepareMaterials`): they cast as the body round them, receive none.
    panes.castShadow = true;
    panes.receiveShadow = false;
    body.add(panes);
  }
  return skeleton;
}

/** One wheel set as one skinned mesh on one body: its pieces per material, and each wheel's rest. */
export interface KitWheelModel {
  readonly geometry: THREE.BufferGeometry;
  readonly materials: readonly THREE.Material[];
  /** Each wheel's rest frame (its fitted scale at the origin), inverted, in `WHEEL_ORDER`. */
  readonly inverses: readonly THREE.Matrix4[];
}

/** The order of a wheel set's bones. */
export const KIT_WHEEL_ORDER = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] as const;

/**
 * A wheel set's four wheels merged (`wheels`: fresh fitted wrappers, render/carmodel.ts
 * `cloneWheels`, at the origin and unturned): one buffer, one group per material, each
 * wheel's vertices weighted to its own bone.
 */
export function bakeKitWheels(wheels: ReadonlyMap<string, THREE.Object3D>): KitWheelModel {
  const roots = KIT_WHEEL_ORDER.map((id) => wheels.get(id)!);
  const owner = new Map<THREE.Object3D, number>();
  roots.forEach((root, bone) => root.traverse((node) => owner.set(node, bone)));
  const materials: THREE.Material[] = [];
  const geometry = bakeCarPaintGeometry(
    roots,
    (_mesh, material) => {
      const slot = materials.indexOf(material);
      return slot >= 0 ? slot : materials.push(material) - 1;
    },
    (mesh) => owner.get(mesh)!,
  );
  if (!geometry) throw new Error('A wheel set has no meshes');
  const inverses = roots.map((root) => new THREE.Matrix4().compose(root.position, root.quaternion, root.scale).invert());
  return { geometry, materials, inverses };
}

/**
 * The wheels of one car (`wheels`, its own fitted wrappers, which the vehicle or the lab
 * places and turns) as one skinned mesh: add it beside them, under their parent. Their
 * meshes become pick proxies. `reach` is the radius round the parent's origin the wheels
 * stand within, for culling.
 */
export function attachKitWheels(model: KitWheelModel, wheels: ReadonlyMap<string, THREE.Object3D>, reach: number): { mesh: THREE.SkinnedMesh; skeleton: KitSkeleton } {
  const roots = KIT_WHEEL_ORDER.map((id) => wheels.get(id)!);
  for (const root of roots) {
    root.traverse((node) => {
      if (!(node as THREE.Mesh).isMesh) return;
      node.layers.set(KIT_PICK_LAYER);
      node.castShadow = false;
    });
  }
  const skeleton = new KitSkeleton(new Int16Array(roots.length).fill(-1), roots.map((root) => [root]), model.inverses);
  const mesh = skinned(model.geometry, model.materials.length === 1 ? model.materials[0]! : [...model.materials], skeleton, new THREE.Sphere(new THREE.Vector3(), reach));
  mesh.name = 'kit-wheels-draw';
  // The wheels' contract (`prepareMaterials`): closed solids, they cast and receive.
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, skeleton };
}
