/**
 * What every kit builder module gets: the body frame, the scene root and the shell's
 * hinged nodes, plus the two ways to put geometry into the scene.
 */

import * as THREE from 'three';
import type { BodyFrame } from './body';
import type { KitSlot, PartBuilder, Vec3 } from './builder';
import { kitMaterial } from './materials';
import { KIT_LAMP_NODES } from './names';
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
}

/**
 * Meshes of one builder, one per slot, under `parent`. Geometry is written in the car
 * frame and moved into the parent's (`origin` is where the parent stands in the car
 * frame). `shadowed` marks cabin parts, which take the roof's shadow (bodywork does
 * not; see `prepareMaterials` in render/carmodel.ts).
 */
export function addBuilt(parent: THREE.Object3D, builder: PartBuilder, origin: Vec3, name: string, shadowed = false): void {
  for (const [slot, geometry] of builder.build()) {
    geometry.translate(-origin[0], -origin[1], -origin[2]);
    const mesh = new THREE.Mesh(geometry, kitMaterial(slot));
    mesh.name = meshName(slot, name);
    if (shadowed) mesh.userData.kitShadowed = true;
    parent.add(mesh);
  }
}

function meshName(slot: KitSlot, part: string): string {
  const lamp = (KIT_LAMP_NODES as Partial<Record<KitSlot, string>>)[slot];
  return lamp ?? `${part}_${slot}`;
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
 * Adds `child` (built at car-frame position `at`) under `parent` (standing at
 * `parentPivot` in the car frame, unrotated at build time).
 */
export function attach(parent: THREE.Object3D, parentPivot: Vec3, child: THREE.Object3D): void {
  child.position.x -= parentPivot[0];
  child.position.y -= parentPivot[1];
  child.position.z -= parentPivot[2];
  parent.add(child);
}
