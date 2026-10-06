import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { DoorClearance } from './poi/kit';
import { buildFallenTower, buildRelayCluster, buildStandingTower } from './poi/towers';

/**
 * The kit-built buildings: the three masts the world places. Everything else is a
 * dwelling (world/dwellings); see world/poistructures.ts for the list the world draws
 * from.
 */
export interface PoiVariantDefinition {
  readonly id: string;
  readonly name: string;
  readonly footprint: readonly [number, number];
  readonly build: (root: THREE.Group) => void;
}

function validateDoorClearances(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const clearances: DoorClearance[] = [];
  root.traverse((owner) => {
    const local = owner.userData.poiDoorClearances as DoorClearance[] | undefined;
    for (const clearance of local ?? []) {
      clearances.push({
        box: clearance.box.clone().applyMatrix4(owner.matrixWorld),
        label: clearance.label,
      });
    }
  });
  root.traverse((object) => {
    const obstacle = object.userData.poiDoorObstacle;
    if (typeof obstacle !== 'string') return;
    const bounds = new THREE.Box3().setFromObject(object);
    const blocked = clearances.find((clearance) => clearance.box.intersectsBox(bounds));
    if (blocked) {
      throw new Error(`${root.name}: ${obstacle} blocks ${blocked.label}`);
    }
  });
}

/**
 * Collapses a prototype's static meshes into one mesh per material.
 *
 * A prototype is 100-250 individually positioned boxes and cylinders, and every
 * one of them is a draw call in both the shadow and the colour pass. Twenty-six of
 * them at once measured 4020 calls a frame — ~30 ms of pure command submission on
 * an Intel N100, with only 82k triangles behind it. Materials and geometries are
 * already shared through the caches above, so baking each group's world matrices
 * into a single buffer costs nothing visually and cuts the call count by ~10x.
 *
 * Meshes that must keep their identity are left alone: roof panels (the viewer
 * hides them), door obstacles (clearance metadata) and anything with a one-off
 * material.
 *
 * Call it on a finished root, before it is positioned in the world.
 */
export function mergePoiStatics(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.userData.poiRoof === true) return;
    if (typeof object.userData.poiDoorObstacle === 'string') return;
    if (Array.isArray(object.material)) return;
    const group = groups.get(object.material);
    if (group) group.push(object);
    else groups.set(object.material, [object]);
  });
  for (const [material, meshes] of groups) {
    if (meshes.length < 2) continue;
    const indexed = meshes.every((mesh) => mesh.geometry.index !== null);
    const parts: THREE.BufferGeometry[] = [];
    for (const mesh of meshes) {
      let geometry = mesh.geometry.clone();
      for (const name of Object.keys(geometry.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name);
      }
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      const position = geometry.getAttribute('position');
      if (!geometry.getAttribute('uv')) {
        geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(position.count * 2), 2));
      }
      if (!indexed && geometry.index) geometry = geometry.toNonIndexed();
      geometry.applyMatrix4(mesh.matrixWorld);
      parts.push(geometry);
    }
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    for (const original of meshes) original.removeFromParent();
  }
}

export const POI_VARIANTS: readonly PoiVariantDefinition[] = [
  { id: 'standing-tower', name: 'Стоящая вышка', footprint: [10, 10], build: buildStandingTower },
  { id: 'fallen-tower', name: 'Упавшая вышка', footprint: [32, 10], build: buildFallenTower },
  { id: 'relay-cluster', name: 'Узел связи', footprint: [23, 16], build: buildRelayCluster },
];

/** A variant's index by id; throws on a typo so a caller never builds the wrong thing. */
export function poiVariantIndex(id: string): number {
  const index = POI_VARIANTS.findIndex((definition) => definition.id === id);
  if (index < 0) throw new Error(`Unknown POI variant "${id}"`);
  return index;
}

export function createPoiVariant(index: number): THREE.Group {
  const definition = POI_VARIANTS[index];
  if (!definition) throw new RangeError(`Unknown POI variant ${index + 1}`);
  const root = new THREE.Group();
  root.name = `poi-${String(index + 1).padStart(2, '0')}-${definition.id}`;
  root.userData.poiVariant = definition.id;
  definition.build(root);
  validateDoorClearances(root);
  return root;
}
