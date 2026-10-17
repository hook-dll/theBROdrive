/**
 * What every kit builder module gets: the body frame, the scene root and the shell's
 * hinged nodes, plus the two ways to put geometry into the scene.
 */

import * as THREE from 'three';
import { mirrorFaceMaterial } from '../render/carmirrors';
import { mirrorFaceGeometry } from '../render/mirrorview';
import type { BodyFrame, KitHole } from './body';
import type { KitSlot, PartBuilder, Vec3 } from './builder';
import { kitBodyMaterial, kitGlassMaterial } from './materials';
import { KIT_LAMP_NODES, type KitMirror } from './names';
import type { KitControl, KitMotion } from './rig';

export interface KitNode {
  readonly node: THREE.Object3D;
  /** Where the node stands in the car frame (its origin). */
  readonly pivot: Vec3;
}

export interface KitContext {
  readonly frame: BodyFrame;
  readonly root: THREE.Group;
  /** The shell's moving parts by owner: door_fl, door_rl, bonnet, boot, tailgate, flap, ... */
  readonly nodes: ReadonlyMap<string, KitNode>;
  /** The cabin lining the shell derives from its greenhouse and roof (`ShellResult.lining`). */
  readonly lining: readonly (readonly Vec3[])[];
  /**
   * Where the parts built on the outside stand on the shell: kit.ts cuts the skin away
   * under each (`cutShellHoles`) once everything is built.
   */
  readonly holes: KitHole[];
}

/**
 * Meshes of one builder, one per slot, under `parent`. Geometry is written in the car
 * frame and moved into the parent's (`origin` is where the parent stands in the car
 * frame). Every slot but the glass draws with the one kit material; the slot is kept on
 * the mesh (`userData.kitSlot`) until `finishKitSurfaces` writes it into the vertices.
 * `shadowed` marks the detail parts (cabin, bay, boot, underbody): they take the shell's
 * shadow but cast none (see `prepareMaterials` in render/carmodel.ts).
 */
export function addBuilt(parent: THREE.Object3D, builder: PartBuilder, origin: Vec3, name: string, shadowed = false): void {
  for (const [slot, geometry] of builder.build()) {
    geometry.translate(-origin[0], -origin[1], -origin[2]);
    const mesh = new THREE.Mesh(geometry, slot === 'glass' ? kitGlassMaterial() : kitBodyMaterial());
    mesh.name = meshName(slot, name);
    mesh.userData.kitSlot = slot;
    if (shadowed) mesh.userData.kitShadowed = true;
    parent.add(mesh);
  }
}

function meshName(slot: KitSlot, part: string): string {
  const lamp = (KIT_LAMP_NODES as Partial<Record<KitSlot, string>>)[slot];
  return lamp ?? `${part}_${slot}`;
}

/**
 * A mirror head's frame at `centre`, its glass facing local -Z, turned so that the eye at
 * `eye` sees along `view` in it: the glass's normal halves the angle between the two.
 * Local X stays level.
 */
export function mirrorFrame(centre: Vec3, eye: Vec3, view: Vec3): THREE.Matrix4 {
  const at = new THREE.Vector3(...centre);
  const back = new THREE.Vector3(...eye).sub(at).normalize().add(new THREE.Vector3(...view).normalize()).normalize().negate();
  const x = new THREE.Vector3(0, 1, 0).cross(back).normalize();
  const y = back.clone().cross(x);
  return new THREE.Matrix4().makeBasis(x, y, back).setPosition(at);
}

/**
 * A mirror's live face (render/carmirrors.ts) under `parent`, like `addBuilt`'s meshes: a
 * quad `half` wide and high on the plane z = `z` of `frame` (`mirrorFrame`, as the head
 * is built in), just proud of the static glass. Hidden: the mirror pass shows the faces
 * of the car the player sits in, in the cabin view, and only those. It casts nothing, and
 * its userData keeps carmodel.ts's static merge off it.
 */
export function addMirrorFace(parent: THREE.Object3D, frame: THREE.Matrix4, origin: Vec3, half: readonly [number, number], z: number, mirror: KitMirror): void {
  const geometry = mirrorFaceGeometry(frame, half, z).translate(-origin[0], -origin[1], -origin[2]);
  const mesh = new THREE.Mesh(geometry, mirrorFaceMaterial(mirror));
  mesh.name = 'mirror_face';
  mesh.visible = false;
  mesh.userData.kitMirror = mirror;
  mesh.userData.kitCastsNone = true;
  parent.add(mesh);
}

/** A group in the car frame at `at`, tagged for the rig. Add it to its parent yourself. */
export function pivotGroup(name: string, at: Vec3, motion?: KitMotion, control?: KitControl): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(at[0], at[1], at[2]);
  if (motion) g.userData.kitMotion = motion;
  if (control) g.userData.kitControl = control;
  return g;
}

/**
 * Tags `node` as the cabin's fine detail: the small parts (needles, lit faces, switches,
 * cranks, pedals) the rig draws only with the eye in this car or within `KIT_FINE_M` of it
 * (rig.ts `setDetail`). Returns `node`.
 */
export function fineDetail<T extends THREE.Object3D>(node: T): T {
  node.userData.kitFine = true;
  return node;
}

/**
 * Adds `child` (built at car-frame position `at`) under `parent` (standing at
 * `parentPivot` in the car frame, unrotated at build time).
 */
export function attach(parent: THREE.Object3D, parentPivot: Vec3, child: THREE.Object3D): void {
  child.position.x -= parentPivot[0];
  child.position.y -= parentPivot[1];
  child.position.z -= parentPivot[2];
  parent.add(child);
}
