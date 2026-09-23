import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { DoorClearance } from './poi/kit';
import {
  buildAutoPartsStore,
  buildCottage,
  buildCourtyardHouse,
  buildGeneralStore,
  buildKiosk,
  buildLongHouse,
  buildMarket,
  buildPorchHouse,
  buildRoadCafe,
  buildWorkshopHome,
} from './poi/houses';
import { buildButterflyGas, buildHighwayGas, buildMushroomGas, buildPavilionGas, buildUfoGas } from './poi/gas';
import { buildStarterHome } from './poi/starter';
import { buildBrokenPlane, buildFishingWreck, buildPlaneFuselage, buildTugboat } from './poi/wrecks';
import {
  buildBuriedContainer,
  buildContainerStack,
  buildFallenTower,
  buildOpenContainer,
  buildRelayCluster,
  buildStandingTower,
} from './poi/towers';

export interface PoiVariantDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: 'house' | 'shop' | 'gas' | 'wreck' | 'tower' | 'container';
  readonly footprint: readonly [number, number];
  readonly build: (root: THREE.Group) => void;
}

function validateDoorClearances(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const clearances: DoorClearance[] = [];
  const windowClearances: DoorClearance[] = [];
  root.traverse((owner) => {
    const local = owner.userData.poiDoorClearances as DoorClearance[] | undefined;
    for (const clearance of local ?? []) {
      clearances.push({
        box: clearance.box.clone().applyMatrix4(owner.matrixWorld),
        label: clearance.label,
      });
    }
    const localWindows = owner.userData.poiWindowClearances as DoorClearance[] | undefined;
    for (const clearance of localWindows ?? []) {
      windowClearances.push({
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
    if (obstacle === 'light switch') {
      const window = windowClearances.find((clearance) => clearance.box.intersectsBox(bounds));
      if (window) throw new Error(`${root.name}: light switch overlaps ${window.label}`);
    }
  });
}

/**
 * Whether `object`, or anything it hangs from, carries `flag` in its `userData`.
 *
 * Used to keep whole subtrees out of a merge: a marker is set on the GROUP that owns the
 * part, but the geometry that would be merged is its grandchild, and a one-level parent
 * test silently misses it.
 */
function hasAncestorFlag(object: THREE.Object3D, flag: string): boolean {
  for (let node: THREE.Object3D | null = object; node !== null; node = node.parent) {
    if (node.userData[flag] === true) return true;
  }
  return false;
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
 * hides them), light switches (raycast targets carrying the toggle closure), door
 * obstacles (clearance metadata) and anything with a one-off material, such as the
 * bulbs whose emissive intensity follows their switch.
 *
 * Call it on a finished root, before it is positioned in the world.
 */
export function mergePoiStatics(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.userData.poiRoof === true) return;
    // Light switches must stay their own objects: they are aim targets, and merging them
    // into the wall would leave the world unable to find one. Keyed on the marker the
    // catalogue sets, which is why that marker exists.
    // The WHOLE SUBTREE, not the marker object alone: the plate and its lever hang two
    // levels below the switch group, and merging either would leave the switch group with
    // no geometry — which does not look broken, it measures as a switch nought metres
    // across at the origin. So walk up, rather than testing one parent.
    if (hasAncestorFlag(object, 'poiLightSwitch')) return;
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
  { id: 'two-room-cottage', name: 'Двухкомнатный домик', category: 'house', footprint: [8.5, 6.5], build: buildCottage },
  { id: 'porch-house', name: 'Дом с верандой', category: 'house', footprint: [11.2, 9.2], build: buildPorchHouse },
  { id: 'long-house', name: 'Длинный трёхкомнатный дом', category: 'house', footprint: [12.5, 5.8], build: buildLongHouse },
  { id: 'spacious-veranda-house', name: 'Просторный дом с верандой', category: 'house', footprint: [20, 15], build: buildCourtyardHouse },
  { id: 'two-storey-country-house', name: 'Просторный двухэтажный дом', category: 'house', footprint: [18, 16], build: buildWorkshopHome },
  { id: 'road-kiosk', name: 'Придорожный киоск', category: 'shop', footprint: [5.8, 5.3], build: buildKiosk },
  { id: 'road-cafe', name: 'Небольшое кафе', category: 'shop', footprint: [10.5, 8.2], build: buildRoadCafe },
  { id: 'general-store', name: 'Сельский магазин', category: 'shop', footprint: [12, 9], build: buildGeneralStore },
  { id: 'large-village-market', name: 'Большой сельский универсам', category: 'shop', footprint: [27, 20], build: buildMarket },
  { id: 'parts-warehouse-store', name: 'Большой магазин-склад автозапчастей', category: 'shop', footprint: [30, 22], build: buildAutoPartsStore },
  { id: 'tugboat-wreck', name: 'Остов буксира', category: 'wreck', footprint: [18, 9], build: buildTugboat },
  { id: 'fishing-boat-wreck', name: 'Рыбацкий кораблик', category: 'wreck', footprint: [14, 9], build: buildFishingWreck },
  { id: 'plane-fuselage', name: 'Крупный разбитый самолёт', category: 'wreck', footprint: [27, 24], build: buildPlaneFuselage },
  { id: 'scattered-plane', name: 'Крупные обломки самолёта', category: 'wreck', footprint: [34, 28], build: buildBrokenPlane },
  { id: 'standing-tower', name: 'Стоящая вышка', category: 'tower', footprint: [10, 10], build: buildStandingTower },
  { id: 'fallen-tower', name: 'Упавшая вышка', category: 'tower', footprint: [32, 10], build: buildFallenTower },
  { id: 'relay-cluster', name: 'Узел связи', category: 'tower', footprint: [23, 16], build: buildRelayCluster },
  { id: 'open-container', name: 'Открытый контейнер', category: 'container', footprint: [5, 8], build: buildOpenContainer },
  { id: 'container-stack', name: 'Склад контейнеров', category: 'container', footprint: [12, 10], build: buildContainerStack },
  { id: 'buried-container', name: 'Занесённое убежище', category: 'container', footprint: [10, 10], build: buildBuriedContainer },
  { id: 'mushroom-gas-station', name: 'АЗС с навесами-грибками', category: 'gas', footprint: [30, 20], build: buildMushroomGas },
  { id: 'butterfly-gas-station', name: 'АЗС «Крыло»', category: 'gas', footprint: [30, 19], build: buildButterflyGas },
  { id: 'pavilion-gas-station', name: 'АЗС-павильон 1950-х', category: 'gas', footprint: [30, 19], build: buildPavilionGas },
  { id: 'ufo-gas-station', name: 'Футуристическая АЗС', category: 'gas', footprint: [32, 22], build: buildUfoGas },
  { id: 'highway-gas-station', name: 'Двухпоточная трассовая АЗС', category: 'gas', footprint: [35, 23], build: buildHighwayGas },
  { id: 'starter-homestead', name: 'Стартовый двухэтажный дом', category: 'house', footprint: [29, 19], build: buildStarterHome },
];

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
