import * as THREE from 'three';

import { C, barrel, bed, box, buildingShell, crate, cylinder, roomLight, shelf, type V3 } from './kit';

export function beamBetween(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, width: number, color: number): void {
  const direction = new THREE.Vector3().subVectors(b, a);
  const mesh = box(parent, [width, direction.length(), width], [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2], color);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
}

function latticeTower(parent: THREE.Object3D, height: number, color: number = C.rust, fallen = false): THREE.Group {
  const tower = new THREE.Group();
  if (fallen) {
    tower.position.set(height / 2, 1.1, 0);
    tower.rotation.z = Math.PI / 2 - 0.055;
  }
  parent.add(tower);
  const levels = Math.max(6, Math.round(height / 2.5));
  for (let level = 0; level < levels; level++) {
    const y0 = level * height / levels;
    const y1 = (level + 1) * height / levels;
    const half0 = 1.85 * (1 - y0 / height * 0.76);
    const half1 = 1.85 * (1 - y1 / height * 0.76);
    const corners0 = [[-half0, y0, -half0], [half0, y0, -half0], [half0, y0, half0], [-half0, y0, half0]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const corners1 = [[-half1, y1, -half1], [half1, y1, -half1], [half1, y1, half1], [-half1, y1, half1]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      beamBetween(tower, corners0[i], corners1[i], 0.13, color);
      beamBetween(tower, corners0[i], corners0[next], 0.1, C.darkMetal);
      beamBetween(tower, corners0[i], corners1[next], 0.07, color);
      beamBetween(tower, corners0[next], corners1[i], 0.055, C.rustDark);
    }
    box(tower, [0.72, 0.055, 0.18], [0, (y0 + y1) / 2, -half0], C.darkMetal);
  }
  return tower;
}

function antennaDish(
  parent: THREE.Object3D,
  position: V3,
  yaw: number,
  radius: number,
  color: number = C.white,
): void {
  const dish = new THREE.Group();
  dish.position.set(position[0], position[1], position[2]);
  dish.rotation.y = yaw;
  parent.add(dish);
  cylinder(dish, 0.08, radius, 0.28, 18, [0, 0, 0], color, [Math.PI / 2, 0, 0]);
  beamBetween(dish, new THREE.Vector3(0, 0, -0.1), new THREE.Vector3(0, 0, -0.75), 0.045, C.darkMetal);
  cylinder(dish, 0.08, 0.08, 0.12, 8, [0, 0, -0.8], C.darkMetal, [Math.PI / 2, 0, 0]);
}

function guyWires(parent: THREE.Object3D, height: number, radius: number): void {
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2 + Math.PI / 4;
    const anchor = new THREE.Vector3(Math.cos(angle) * radius, 0.12, Math.sin(angle) * radius);
    beamBetween(parent, new THREE.Vector3(0, height * 0.72, 0), anchor, 0.026, C.darkMetal);
    beamBetween(parent, new THREE.Vector3(0, height * 0.94, 0), anchor.clone().multiplyScalar(0.72), 0.022, C.darkMetal);
    cylinder(parent, 0.13, 0.18, 0.28, 8, [anchor.x, 0.14, anchor.z], C.concrete);
  }
}

export function buildStandingTower(root: THREE.Group): void {
  const height = 31;
  const tower = latticeTower(root, height);
  cylinder(tower, 0.08, 0.11, 5.2, 8, [0, height + 2.5, 0], C.darkMetal);
  for (const y of [20.5, 25.2, 29.5]) {
    for (let side = 0; side < 4; side++) {
      const angle = side * Math.PI / 2;
      box(tower, [0.82, 1.75, 0.13], [Math.cos(angle) * 0.62, y, Math.sin(angle) * 0.62], C.white, [0, -angle, 0.06]);
    }
  }
  antennaDish(tower, [0.65, 16.5, 0], Math.PI / 2, 1.0);
  antennaDish(tower, [-0.55, 23.1, 0], -Math.PI / 2, 0.78, C.concreteLight);
  for (const y of [10, 20, 28]) box(tower, [3.2 - y * 0.065, 0.1, 3.2 - y * 0.065], [0, y, 0], C.darkMetal);
  cylinder(tower, 0.16, 0.16, 0.28, 10, [0, height + 5.12, 0], C.fadedRed);
  box(root, [5.2, 0.18, 5.2], [0, 0.09, 0], C.concrete);
  box(root, [2.1, 1.5, 1.35], [3.5, 0.75, 2.0], C.fadedGreen);
  for (let i = 0; i < 4; i++) box(root, [0.09, 0.09, 4.3], [-1.1 + i * 0.72, 0.45 + i * 0.05, 3.2], C.darkMetal, [0, 0, -0.05]);
}

export function buildFallenTower(root: THREE.Group): void {
  const height = 29;
  const tower = latticeTower(root, height, C.rust, true);
  antennaDish(tower, [0.7, 19, 0], Math.PI / 2, 0.9, C.concreteLight);
  antennaDish(tower, [-0.55, 25, 0], -Math.PI / 2, 0.72, C.white);
  for (const y of [21, 24, 27]) box(tower, [0.82, 1.7, 0.13], [0.55, y, 0], C.white, [0, 0, 0.08]);
  box(root, [4.8, 0.24, 4.8], [height / 2, 0.12, 0], C.concrete);
  box(root, [2.0, 1.2, 1.35], [-11.5, 0.62, -2.2], C.rustDark, [0, 0.3, -0.18]);
  for (let i = 0; i < 4; i++) box(root, [0.85, 1.5, 0.12], [-8.0 + i * 1.1, 0.5 + i * 0.14, 1.2 + i * 0.45], C.white, [0.2 * i, 0.4, 1.25 - i * 0.18]);
}

export function buildRelayCluster(root: THREE.Group): void {
  for (const [x, z, height, yaw] of [[-4.2, -2.0, 20, 0.2], [0.2, 2.6, 26, 2.4], [4.4, -1.4, 17, 4.2]] as const) {
    const mast = new THREE.Group();
    mast.position.set(x, 0, z);
    root.add(mast);
    cylinder(mast, 0.1, 0.18, height, 8, [0, height / 2, 0], C.darkMetal);
    for (let i = 0; i < 6; i++) {
      const y = height * (0.42 + i * 0.09);
      box(mast, [1.6, 0.08, 0.08], [0, y, 0], C.rust, [0, yaw + i * 0.7, 0]);
      box(mast, [0.7, 1.35, 0.11], [0.5, y, 0], i % 2 === 0 ? C.white : C.concreteLight, [0, yaw, 0.04]);
    }
    antennaDish(mast, [0.48, height * 0.68, 0], yaw, 0.72);
    cylinder(mast, 0.12, 0.12, 0.25, 9, [0, height + 0.12, 0], C.fadedRed);
    guyWires(mast, height, 4.4);
  }
  const hut = new THREE.Group();
  hut.position.set(-9.0, 0, 6.0);
  root.add(hut);
  buildingShell(hut, {
    width: 4.2, depth: 3.0, height: 2.4, wall: C.concreteLight, roof: C.roofTin, flatRoof: true,
    front: [[-0.6, 0.6, 0, 2.05]],
    back: [[-1.5, -0.4, 0.8, 1.75]],
    left: [],
    right: [[-0.7, 0.55, 0.8, 1.75]],
  });
  shelf(hut, -1.4, 0.6, 1.5, Math.PI / 2, false);
  roomLight(hut, 0, 0, 2.4, [0.9, 1.2, -1.38], Math.PI);
  box(root, [2.4, 1.55, 1.35], [9.0, 0.78, 6.0], C.fadedGreen);
  cylinder(root, 0.34, 0.34, 1.4, 10, [10.5, 0.7, 6.0], C.darkMetal, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 5; i++) box(root, [0.1, 0.1, 7.2], [-5.5 + i * 2.7, 0.08, 0.5], C.darkMetal, [0, 0.12 * i, 0]);
  barrel(root, 9.5, 4.5, C.rust);
}

function shippingContainer(parent: THREE.Object3D, color: number, open = true): THREE.Group {
  const group = new THREE.Group();
  parent.add(group);
  const w = 2.45;
  const h = 2.6;
  const d = 6.05;
  box(group, [w, 0.13, d], [0, 0.065, 0], C.darkMetal);
  box(group, [w, 0.13, d], [0, h, 0], color, [0, 0, 0], true);
  box(group, [0.12, h, d], [-w / 2, h / 2, 0], color);
  box(group, [0.12, h, d], [w / 2, h / 2, 0], color);
  box(group, [w, h, 0.12], [0, h / 2, d / 2], color);
  if (!open) box(group, [w, h, 0.12], [0, h / 2, -d / 2], color);
  for (let i = -4; i <= 4; i++) {
    const z = i * 0.58;
    box(group, [0.08, h - 0.22, 0.07], [-w / 2 - 0.065, h / 2, z], C.rustDark);
    box(group, [0.08, h - 0.22, 0.07], [w / 2 + 0.065, h / 2, z], C.rustDark);
  }
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) box(group, [0.16, h + 0.08, 0.16], [x, h / 2, z], C.darkMetal);
  return group;
}

export function buildOpenContainer(root: THREE.Group): void {
  const container = shippingContainer(root, C.fadedBlue, true);
  container.rotation.y = 0.08;
  crate(container, -0.45, 1.25, 0.3, 0.58);
  crate(container, 0.48, 1.7, -0.2, 0.52);
  barrel(container, 0.35, 2.55, C.rust);
}

export function buildContainerStack(root: THREE.Group): void {
  const first = shippingContainer(root, C.fadedRed, true);
  first.position.set(-2.0, 0, -1.0);
  first.rotation.y = -0.08;
  const second = shippingContainer(root, C.fadedGreen, false);
  second.position.set(2.1, 0, 1.1);
  second.rotation.y = 0.12;
  const top = shippingContainer(root, C.ochre, true);
  top.position.set(0.25, 2.72, 0.4);
  top.rotation.set(0, 0.04, -0.035);
  crate(root, -4.0, 2.8, 0.3);
  barrel(root, 4.0, -2.0, C.fadedBlue, 0.08);
}

export function buildBuriedContainer(root: THREE.Group): void {
  const container = shippingContainer(root, C.rust, true);
  container.position.set(0, -0.72, 0.45);
  container.rotation.set(0.03, -0.18, -0.06);
  box(root, [5.7, 0.7, 4.0], [-0.4, 0.05, 2.1], C.sandDark, [0.02, -0.12, 0.06]);
  box(root, [5.0, 0.5, 3.0], [0.7, -0.05, -1.9], C.sandDark, [-0.04, 0.15, -0.04]);
  bed(container, 0.25, 0.9, 0, C.fabric);
  shelf(container, -0.82, 1.8, 1.5, Math.PI / 2, false);
  box(root, [4.8, 0.16, 2.0], [0, 1.95, -3.6], C.roofTin, [-0.13, -0.18, 0], true);
  for (const x of [-1.8, 1.8]) box(root, [0.13, 2.0, 0.13], [x, 0.95, -3.1], C.darkTimber, [0.08, 0, x * 0.02]);
}
