import * as THREE from 'three';

import {
  C,
  barrel,
  bed,
  box,
  buildingShell,
  cashRegister,
  chair,
  counter,
  crate,
  cylinder,
  partition,
  registerDoorClearance,
  roomLight,
  roomLights,
  rug,
  shelf,
  shellOpeningsBetween,
  sofa,
  table,
  type ShellLayout,
} from './kit';
import { beamBetween } from './towers';

export function upperFloorWithStairwell(
  parent: THREE.Object3D,
  width: number,
  depth: number,
  y: number,
  hole: readonly [x0: number, x1: number, z0: number, z1: number],
): void {
  const [x0, x1, z0, z1] = hole;
  registerDoorClearance(
    parent,
    new THREE.Box3(
      new THREE.Vector3(x0 + 0.08, y - 0.05, z0 + 0.08),
      new THREE.Vector3(x1 - 0.08, y + 2.15, z1 - 0.08),
    ),
    'stairwell landing',
  );
  const thickness = 0.18;
  box(parent, [x0 + width / 2, thickness, depth], [(-width / 2 + x0) / 2, y - thickness / 2, 0], C.floor, [0, 0, 0], true);
  box(parent, [width / 2 - x1, thickness, depth], [(x1 + width / 2) / 2, y - thickness / 2, 0], C.floor, [0, 0, 0], true);
  box(parent, [x1 - x0, thickness, z0 + depth / 2], [(x0 + x1) / 2, y - thickness / 2, (-depth / 2 + z0) / 2], C.floor, [0, 0, 0], true);
  box(parent, [x1 - x0, thickness, depth / 2 - z1], [(x0 + x1) / 2, y - thickness / 2, (z1 + depth / 2) / 2], C.floor, [0, 0, 0], true);
}

export function staircase(
  parent: THREE.Object3D,
  x: number,
  z: number,
  yaw: number,
  floorHeight: number,
  width: number,
  hole: readonly [x0: number, x1: number, z0: number, z1: number],
): void {
  const stairs = new THREE.Group();
  stairs.position.set(x, 0, z);
  stairs.rotation.y = yaw;
  parent.add(stairs);
  const steps = 16;
  const run = 0.29;
  const rise = floorHeight / steps;
  for (let step = 0; step < steps; step++) {
    const top = rise * (step + 1);
    const travel = step * run + run / 2;
    const centerX = x + Math.sin(yaw) * travel;
    const centerZ = z + Math.cos(yaw) * travel;
    const halfX = Math.abs(Math.cos(yaw)) * width / 2 + Math.abs(Math.sin(yaw)) * run / 2;
    const halfZ = Math.abs(Math.sin(yaw)) * width / 2 + Math.abs(Math.cos(yaw)) * run / 2;
    if (
      top + 1.9 > floorHeight
      && (centerX - halfX < hole[0] || centerX + halfX > hole[1] || centerZ - halfZ < hole[2] || centerZ + halfZ > hole[3])
    ) {
      throw new Error(`Stair step ${step + 1} has less than 1.9 m of headroom`);
    }
    box(stairs, [width, top, run + 0.015], [0, top / 2, travel], C.timber);
  }
  for (const side of [-1, 1]) {
    for (let step = 1; step < steps; step += 3) {
      const y = rise * (step + 1);
      const zPos = step * run;
      box(stairs, [0.07, 0.85, 0.07], [side * (width / 2 - 0.04), y + 0.42, zPos], C.darkTimber);
    }
    beamBetween(
      stairs,
      new THREE.Vector3(side * (width / 2 - 0.04), rise + 0.85, run),
      new THREE.Vector3(side * (width / 2 - 0.04), floorHeight + 0.85, steps * run),
      0.08,
      C.darkTimber,
    );
  }
}

export function stairwellRailing(
  parent: THREE.Object3D,
  y: number,
  hole: readonly [x0: number, x1: number, z0: number, z1: number],
): void {
  const [x0, x1, z0, z1] = hole;
  for (const x of [x0, x1]) {
    for (const z of [z0, z1]) box(parent, [0.08, 0.9, 0.08], [x, y + 0.45, z], C.darkTimber);
    box(parent, [0.08, 0.08, z1 - z0], [x, y + 0.88, (z0 + z1) / 2], C.darkTimber);
  }
  box(parent, [x1 - x0, 0.08, 0.08], [(x0 + x1) / 2, y + 0.88, z1], C.darkTimber);
}

export function buildCottage(root: THREE.Group): void {
  const h = 3.0;
  buildingShell(root, {
    width: 8.5, depth: 6.5, height: h, wall: C.plaster, roof: C.roof,
    front: [[-2.8, -1.5, 0, 2.25], [0.8, 2.3, 0.95, 2.15]],
    back: [[-3.0, -1.5, 0.95, 2.15], [1.4, 3.0, 0.95, 2.15]],
  });
  partition(root, 'z', 0.35, 6.5, h, -1.4);
  table(root, -2.2, 0, 0.14);
  chair(root, -2.35, -1.05, 0.05);
  chair(root, -2.0, 1.08, Math.PI);
  bed(root, 2.1, 1.1, 0.12, C.fadedBlue);
  crate(root, 2.9, -1.65, 0.3);
  roomLight(root, -1.95, 0, h, [0.27, 1.25, -0.65], Math.PI / 2);
  roomLight(root, 2.3, 0, h, [0.43, 1.25, -2.1], -Math.PI / 2);
}

export function buildPorchHouse(root: THREE.Group): void {
  const h = 3.2;
  buildingShell(root, {
    width: 10.5, depth: 7.2, height: h, wall: C.plasterPale, roof: C.fadedGreen,
    front: [[-0.65, 0.65, 0, 2.3], [-4.1, -2.3, 0.9, 2.2], [2.3, 4.1, 0.9, 2.2]],
    back: [[-3.6, -2.0, 0.95, 2.2], [1.7, 3.5, 0.95, 2.2]],
    left: [[-2.7, -1.3, 0.9, 2.2]],
    right: [[1.3, 2.7, 0.9, 2.2]],
  });
  box(root, [11.2, 0.16, 1.7], [0, 0.22, -4.25], C.timber);
  for (const x of [-4.8, -1.7, 1.7, 4.8]) box(root, [0.14, 2.45, 0.14], [x, 1.38, -4.75], C.darkTimber);
  box(root, [11.2, 0.16, 2.1], [0, 2.65, -4.25], C.roofTin, [0.08, 0, 0], true);
  partition(root, 'z', -1.4, 7.2, h, -1.8);
  partition(root, 'x', 0.6, 10.5, h, 3.0);
  sofa(root, -3.7, -1.35, 0.08, C.fadedRed);
  table(root, -3.2, 2.0, -0.2);
  bed(root, 2.8, 2.5, Math.PI / 2, C.fabric);
  chair(root, 1.4, -1.55, 1.4);
  roomLight(root, -3.3, -1.5, h, [-1.52, 1.25, -2.55], Math.PI / 2);
  roomLight(root, -3.3, 2.1, h, [-1.52, 1.25, 1.45], Math.PI / 2);
  roomLight(root, 1.9, -1.5, h, [2.2, 1.25, 0.47], 0);
  roomLight(root, 1.9, 2.1, h, [3.8, 1.25, 0.73], Math.PI);
}

export function buildLongHouse(root: THREE.Group): void {
  const h = 2.85;
  buildingShell(root, {
    width: 12.5, depth: 5.8, height: h, wall: C.plasterBlue, roof: C.roofTin,
    front: [[-5.2, -3.9, 0, 2.2], [-1.9, -0.4, 0.9, 2.05], [2.1, 3.7, 0.9, 2.05]],
    back: [[-5.0, -3.6, 0.9, 2.05], [-1.2, 0.3, 0.9, 2.05], [3.0, 4.6, 0.9, 2.05]],
    right: [[-0.7, 0.7, 0, 2.2]],
  });
  partition(root, 'z', -2.8, 5.8, h, -1.25);
  partition(root, 'z', 1.2, 5.8, h, 1.2);
  bed(root, -4.5, 1.1, Math.PI / 2, C.fadedGreen);
  sofa(root, -1.05, 1.75, Math.PI, C.ochre);
  table(root, 4.0, -0.45, 0.3);
  chair(root, 3.25, -1.55, -0.25);
  crate(root, 5.1, 1.7, 0.4, 0.55);
  roomLight(root, -4.5, 0, h, [-2.92, 1.25, -2.05], Math.PI / 2);
  roomLight(root, -0.8, 0, h, [-2.68, 1.25, -0.35], -Math.PI / 2);
  // Swung round to face the partition at x = 1.2: with its back toward +X it was mounted
  // on nothing, since the wall it belongs to is behind it. Measured, it stood 8 cm off
  // any surface with its back to open room.
  roomLight(root, 3.7, 0, h, [1.32, 1.25, 2.0], -Math.PI / 2);
}

export function buildCourtyardHouse(root: THREE.Group): void {
  const h = 3.6;
  buildingShell(root, {
    width: 18, depth: 13, height: h, wall: C.brick, roof: C.roof,
    wallPattern: 'brick', roofPattern: 'tiles',
    front: [[-1.0, 0.5, 0, 2.45], [-7.2, -5.3, 1.0, 2.35], [2.3, 4.2, 1.0, 2.35], [6.0, 7.9, 1.0, 2.35]],
    back: [[-7.2, -5.3, 1.0, 2.35], [-0.9, 1.0, 1.0, 2.35], [5.8, 7.7, 1.0, 2.35]],
    left: [[-4.5, -2.7, 1.0, 2.35], [2.7, 4.5, 1.0, 2.35]],
    right: [[-4.5, -2.7, 1.0, 2.35], [2.7, 4.5, 1.0, 2.35]],
  });
  partition(root, 'z', -3.0, 13, h, -2.2);
  partition(root, 'x', 1.2, 18, h, 4.8);
  box(root, [19.2, 0.18, 2.2], [0, 0.2, -7.55], C.timber);
  box(root, [19.2, 0.18, 2.6], [0, 3.0, -7.45], C.roofTin, [0.08, 0, 0], true);
  for (const x of [-8.4, -5.6, -2.8, 0, 2.8, 5.6, 8.4]) box(root, [0.14, 2.75, 0.14], [x, 1.5, -8.1], C.darkTimber);

  sofa(root, 1.2, -3.7, 0.1, C.fadedBlue);
  rug(root, 1.2, -2.4, 4.2, 2.8, C.fadedRed, 0.04);
  table(root, 6.1, -1.6, -0.08);
  chair(root, 6.0, -2.75, 0);
  chair(root, 6.2, -0.45, Math.PI);
  bed(root, -6.2, 3.6, Math.PI / 2, C.fabric);
  bed(root, 1.0, 4.1, Math.PI / 2, C.fadedGreen);
  shelf(root, 7.6, 4.6, 3.2, Math.PI / 2, false);
  crate(root, -7.5, -4.8, 0.2, 0.58);

  roomLight(root, -6.0, -2.65, h, [-3.12, 1.3, -3.15], Math.PI / 2);
  roomLight(root, -6.0, 3.85, h, [-3.12, 1.3, -1.1], Math.PI / 2);
  roomLight(root, 3.0, -2.65, h, [3.8, 1.3, 1.08], 0);
  roomLight(root, 3.0, 3.85, h, [5.85, 1.3, 1.32], Math.PI);
}

export function buildWorkshopHome(root: THREE.Group): void {
  const floorHeight = 3.2;
  const totalHeight = 6.4;
  const stairwell: readonly [number, number, number, number] = [3.25, 5.75, -3.15, 0.65];
  buildingShell(root, {
    width: 16, depth: 12, height: totalHeight, wall: C.plasterPale, roof: C.fadedGreen,
    wallPattern: 'boards', roofPattern: 'metal',
    front: [
      [-1.0, 0.4, 0, 2.45], [-6.4, -4.6, 0.95, 2.35], [2.5, 4.3, 0.95, 2.35],
      [-6.4, -4.6, 4.0, 5.4], [-0.9, 0.9, 4.0, 5.4], [4.6, 6.4, 4.0, 5.4],
    ],
    back: [
      [-6.3, -4.5, 0.95, 2.35], [0.4, 2.2, 0.95, 2.35], [5.2, 6.8, 0, 2.4],
      [-6.3, -4.5, 4.0, 5.4], [2.5, 4.3, 4.0, 5.4],
    ],
    left: [[-4.0, -2.4, 0.95, 2.35], [2.4, 4.0, 0.95, 2.35], [-4.0, -2.4, 4.0, 5.4], [2.4, 4.0, 4.0, 5.4]],
    right: [[-4.0, -2.4, 0.95, 2.35], [2.4, 4.0, 0.95, 2.35], [-4.0, -2.4, 4.0, 5.4], [2.4, 4.0, 4.0, 5.4]],
  });
  partition(root, 'z', -2.0, 12, floorHeight, -2.5);
  const groundLeft = new THREE.Group();
  groundLeft.position.x = -5;
  root.add(groundLeft);
  partition(groundLeft, 'x', 1.5, 6.0, floorHeight, 0);
  upperFloorWithStairwell(root, 16, 12, floorHeight, stairwell);
  staircase(root, 4.5, -4.6, 0, floorHeight, 1.55, stairwell);
  stairwellRailing(root, floorHeight, stairwell);

  const upper = new THREE.Group();
  upper.position.y = floorHeight;
  root.add(upper);
  upper.userData.poiShell = shellOpeningsBetween(root.userData.poiShell as ShellLayout, floorHeight, totalHeight);
  partition(upper, 'z', 1.6, 12, floorHeight, 2.8);
  sofa(root, 1.2, -3.4, 0, C.fadedGreen);
  table(root, -5.2, -1.0, 0.12);
  chair(root, -5.3, -2.15, 0);
  chair(root, -5.1, 0.15, Math.PI);
  bed(root, -5.1, 3.7, Math.PI / 2, C.fabric);
  shelf(root, 7.3, 0, 3.4, Math.PI / 2, false);
  bed(upper, -4.1, 2.1, Math.PI / 2, C.fadedBlue);
  sofa(upper, -3.5, -3.7, 0.08, C.ochre);
  table(upper, 4.4, 2.8, -0.15);
  rug(upper, -3.4, -2.2, 3.6, 2.4, C.fadedRed, 0.05);

  roomLight(root, -5.0, -2.2, floorHeight, [-2.12, 1.3, -3.5], Math.PI / 2);
  roomLight(root, -5.0, 3.7, floorHeight, [-2.12, 1.3, -1.5], Math.PI / 2);
  roomLight(root, 3.0, -2.6, floorHeight, [0.8, 1.3, -5.88], Math.PI);
  roomLight(upper, -3.2, 0, floorHeight, [1.48, 1.3, 1.8], Math.PI / 2);
  roomLight(upper, 4.8, 0, floorHeight, [1.72, 1.3, 3.8], -Math.PI / 2);

  box(root, [7.2, 0.18, 1.8], [3.9, floorHeight + 0.05, -6.7], C.timber);
  for (const x of [0.5, 2.2, 3.9, 5.6, 7.3]) box(root, [0.08, 1.0, 0.08], [x, floorHeight + 0.5, -7.5], C.darkTimber);
  box(root, [7.0, 0.08, 0.08], [3.9, floorHeight + 0.95, -7.5], C.darkTimber);
}

export function buildKiosk(root: THREE.Group): void {
  const h = 2.65;
  buildingShell(root, { width: 5.2, depth: 4.2, height: h, wall: C.ochre, roof: C.fadedRed, flatRoof: true, front: [[-1.9, 1.1, 1.0, 2.15]], right: [[-1.25, 0.05, 0, 2.2]], back: [[-1.3, 1.3, 1.0, 2.05]], left: [] });
  counter(root, -0.35, -1.45, 3.1);
  shelf(root, 0, 1.65, 3.4, 0, true);
  crate(root, -1.8, 0.45, 0.2, 0.55);
  box(root, [5.8, 0.18, 1.1], [0, 2.85, -2.35], C.roofTin, [-0.08, 0, 0], true);
  roomLight(root, 0, 0, h, [2.48, 1.25, 0.45], Math.PI / 2);
}

export function buildRoadCafe(root: THREE.Group): void {
  const h = 3.25;
  buildingShell(root, { width: 10.5, depth: 8.2, height: h, wall: C.plasterPale, roof: C.fadedBlue, flatRoof: true, front: [[-4.3, -2.2, 0.75, 2.35], [-0.7, 0.7, 0, 2.35], [2.0, 4.3, 0.75, 2.35]], back: [[-3.8, -2.3, 0.9, 2.2], [2.1, 3.7, 0.9, 2.2]], left: [[-2.8, -1.2, 0.9, 2.2]], right: [[2.0, 3.4, 0.9, 2.2]] });
  partition(root, 'x', 1.45, 10.5, h, 3.5);
  counter(root, 2.7, 3.15, 3.4, 0);
  cashRegister(root, 3.5, 2.73);
  for (const [x, z, yaw] of [[-3.0, -1.3, 0.1], [-2.8, 0.55, -0.1], [0.1, -1.4, 0.25]] as const) {
    table(root, x, z, yaw);
    const dx = Math.cos(yaw) * 1.22;
    const dz = -Math.sin(yaw) * 1.22;
    chair(root, x - dx, z - dz, yaw + Math.PI / 2);
    chair(root, x + dx, z + dz, yaw - Math.PI / 2);
  }
  crate(root, -4.25, 3.15, 0.5, 0.6);
  roomLight(root, 0, -1.3, h, [0.95, 1.25, -3.98], Math.PI);
  roomLight(root, 0, 2.78, h, [2.7, 1.25, 1.58], Math.PI);
}

export function buildGeneralStore(root: THREE.Group): void {
  const h = 3.5;
  buildingShell(root, { width: 12.0, depth: 9.0, height: h, wall: C.fadedGreen, roof: C.roofTin, front: [[-4.8, -2.1, 0.8, 2.45], [-0.65, 0.65, 0, 2.45], [2.1, 4.8, 0.8, 2.45]], left: [[-2.8, -1.1, 0.9, 2.25]], right: [[1.2, 2.9, 0.9, 2.25]], flatRoof: true });
  counter(root, 3.7, -2.8, 3.7, 0);
  cashRegister(root, 3.4, -3.18);
  for (const x of [-3.6, 0]) shelf(root, x, 0.5, 4.8, Math.PI / 2, true);
  shelf(root, 0, 3.8, 8.2, 0, true);
  crate(root, -4.8, 3.25, -0.2);
  crate(root, 4.8, 2.9, 0.35, 0.55);
  roomLight(root, 0, 0, h, [0.95, 1.25, -4.38], Math.PI);
}

export function buildMarket(root: THREE.Group): void {
  const h = 4.5;
  buildingShell(root, {
    width: 24, depth: 16, height: h, wall: C.concreteLight, roof: C.fadedRed, flatRoof: true,
    front: [[-2.0, 2.0, 0, 2.9], [-10.5, -6.0, 1.0, 2.8], [5.0, 10.5, 1.0, 2.8]],
    back: [[-9.5, -6.5, 1.1, 2.7], [7.8, 10.5, 0, 3.1]],
    left: [[-5.8, -3.2, 1.1, 2.7], [0.2, 2.8, 1.1, 2.7]],
    right: [[-5.5, -3.0, 1.1, 2.7], [0.2, 2.8, 1.1, 2.7]],
  });
  partition(root, 'x', 5.2, 24, h, 8.5, C.concrete);
  for (const x of [-8.0, -4.0, 0, 4.0]) shelf(root, x, -0.2, 8.0, Math.PI / 2, true);
  shelf(root, -5.5, 4.35, 10.5, 0, true);
  counter(root, 6.2, -5.8, 3.0, 0);
  counter(root, 9.6, -5.8, 2.6, 0);
  cashRegister(root, 6.7, -6.22);
  cashRegister(root, 10.0, -6.22);
  crate(root, -9.8, 7.0, 0.15, 0.7);
  crate(root, -8.7, 7.1, -0.2, 0.62);
  barrel(root, -7.5, 7.05, C.fadedBlue);
  roomLights(root, [[-6, -1], [2, -1], [8, -1]], h, [2.6, 1.35, -7.88], Math.PI);
  roomLights(root, [[-5, 6.6], [3, 6.6]], h, [7.4, 1.35, 5.32], Math.PI);
  box(root, [25.5, 0.24, 2.2], [0, 3.9, -8.85], C.fadedRed, [-0.07, 0, 0], true);
  for (const x of [-11.2, -5.6, 0, 5.6, 11.2]) box(root, [0.16, 3.8, 0.16], [x, 1.9, -9.4], C.darkMetal);
}

export function buildAutoPartsStore(root: THREE.Group): void {
  const h = 5.0;
  buildingShell(root, {
    width: 28, depth: 18, height: h, wall: C.brick, roof: C.roofTin, flatRoof: true,
    front: [[-10.5, -7.3, 0, 3.0], [-5.4, -1.5, 1.1, 2.9], [1.0, 4.2, 1.1, 2.9], [8.0, 12.0, 1.1, 2.9]],
    back: [[-11.5, -8.0, 1.1, 2.8], [-3.5, 0, 1.1, 2.8], [8.2, 11.8, 0, 3.3]],
    left: [[-6.7, -3.8, 1.1, 2.8], [-1.2, 1.2, 1.1, 2.8], [5.0, 7.2, 1.1, 2.8]],
    right: [[-6.5, -3.5, 1.1, 2.8], [-1.2, 1.0, 1.1, 2.8], [5.1, 7.3, 1.1, 2.8]],
  });
  partition(root, 'z', 5.5, 18, h, 2.8, C.concreteLight);
  for (const x of [-10.8, -6.8, -2.8, 1.2]) shelf(root, x, 0, 10.5, Math.PI / 2, true);
  shelf(root, -4.5, 7.8, 15.5, 0, false);
  counter(root, -3.8, -6.4, 5.0, 0);
  cashRegister(root, -2.8, -6.82);
  for (const [x, z, tilt] of [[8.0, -4.5, 0], [9.4, -4.2, 0.18], [11.0, -4.7, Math.PI / 2], [8.5, -2.8, 0]] as const) {
    cylinder(root, 0.52, 0.52, 0.28, 18, [x, tilt === 0 ? 0.52 : 0.35, z], C.darkMetal, tilt === 0 ? [Math.PI / 2, 0, 0] : [0, 0, tilt]);
  }
  crate(root, 9.0, 6.4, -0.2, 0.8);
  crate(root, 10.3, 6.7, 0.25, 0.7);
  barrel(root, 12.3, 6.5, C.rust);
  roomLight(root, -5.0, -2.5, h, [-6.7, 1.4, -8.88], Math.PI);
  roomLight(root, -5.0, 4.5, h, [5.38, 1.4, 1.75], Math.PI / 2);
  roomLight(root, 9.5, 0, h, [5.62, 1.4, 4.0], -Math.PI / 2);
  box(root, [29.5, 0.26, 2.6], [0, 4.25, -9.2], C.roofTin, [-0.08, 0, 0], true);
  for (const x of [-13, -6.5, 0, 6.5, 13]) box(root, [0.18, 4.0, 0.18], [x, 2, -10.0], C.darkMetal);
}
