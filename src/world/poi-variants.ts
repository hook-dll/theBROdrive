import * as THREE from 'three';

import { mergeKitStatics, type DoorClearance } from './poi/kit';
import { buildFallenTower, buildRelayCluster, buildStandingTower } from './poi/towers';
import { TOILET_VARIANTS } from './toilets/catalog';
import { buildToiletShell, toiletFootprint } from './toilets/geometry';

/**
 * The kit-built buildings: the two masts the world places (world/poislots.ts `MAST_IDS`),
 * the fallen tower, then the Japanese toilet shells (world/toilets). The fallen tower and
 * the toilets are shown only by the POI gallery. Everything else is a dwelling
 * (world/dwellings); see world/poistructures.ts for the list the world draws from.
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
 * Collapses a prototype's static meshes into one mesh per material, and its flat colours
 * into one palette mesh per roughness (poi/kit.ts `mergeKitStatics`).
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
  mergeKitStatics(root, { deep: true, shared: true });
}

export const POI_VARIANTS: readonly PoiVariantDefinition[] = [
  { id: 'standing-tower', name: 'Стоящая вышка', footprint: [10, 10], build: buildStandingTower },
  { id: 'fallen-tower', name: 'Упавшая вышка', footprint: [32, 10], build: buildFallenTower },
  { id: 'relay-cluster', name: 'Узел связи', footprint: [23, 16], build: buildRelayCluster },
  // The static shell only: the moving fixtures, lamp, face and mirror are a
  // `ToiletRig` (world/toilets/rig.ts) laid over the merged instance.
  ...TOILET_VARIANTS.map((variant): PoiVariantDefinition => ({
    id: variant.id,
    name: variant.name,
    footprint: toiletFootprint(variant.shell),
    build: (root) => buildToiletShell(root, variant),
  })),
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
