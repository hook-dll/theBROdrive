import * as THREE from 'three';

import {
  C,
  box,
  buildingShell,
  cashRegister,
  counter,
  cylinder,
  markDoorObstacle,
  roomLight,
  shelf,
  torus,
  type Opening,
} from './kit';

function fuelPump(parent: THREE.Object3D, x: number, z: number, yaw: number, color: number): void {
  const pump = new THREE.Group();
  pump.position.set(x, 0, z);
  pump.rotation.y = yaw;
  parent.add(pump);
  markDoorObstacle(pump, 'fuel pump');
  box(pump, [0.95, 0.16, 0.75], [0, 0.08, 0], C.concrete);
  box(pump, [0.78, 1.55, 0.52], [0, 0.88, 0], color);
  box(pump, [0.6, 0.4, 0.08], [0, 1.18, -0.29], C.darkMetal);
  box(pump, [0.38, 0.17, 0.05], [0, 1.2, -0.35], C.white);
  torus(pump, 0.34, 0.045, [0.48, 0.82, 0], C.darkMetal, [0, Math.PI / 2, 0]);
  box(pump, [0.1, 0.42, 0.12], [0.5, 0.55, -0.16], C.darkMetal, [0.1, 0, -0.12]);
}

function canopyLamp(parent: THREE.Object3D, x: number, y: number, z: number): void {
  const bulbMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe8b0,
    emissive: 0xffc76f,
    emissiveIntensity: 2.8,
    roughness: 0.3,
  });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 7), bulbMaterial);
  bulb.position.set(x, y, z);
  parent.add(bulb);
  const light = new THREE.PointLight(0xffd294, 34, 7, 2);
  light.position.set(x, y - 0.08, z);
  parent.add(light);
}

function stationSign(parent: THREE.Object3D, x: number, z: number, height: number, color: number): void {
  cylinder(parent, 0.11, 0.16, height, 8, [x, height / 2, z], C.darkMetal);
  box(parent, [2.2, 1.25, 0.18], [x, height - 0.85, z], color);
  box(parent, [1.5, 0.24, 0.22], [x, height - 0.85, z - 0.03], C.white);
  cylinder(parent, 0.32, 0.32, 0.2, 12, [x, height - 0.85, z - 0.18], C.fadedRed, [Math.PI / 2, 0, 0]);
}

function stationCabin(
  parent: THREE.Object3D,
  x: number,
  z: number,
  width: number,
  depth: number,
  wallColor: number,
  roofColor: number,
): THREE.Group {
  const cabin = new THREE.Group();
  cabin.position.set(x, 0, z);
  parent.add(cabin);
  const door: Opening = [-width / 2 + 0.45, -width / 2 + 1.7, 0, 2.25];
  const window: Opening = [door[1] + 0.65, width / 2 - 0.4, 0.9, 2.25];
  buildingShell(cabin, {
    width, depth, height: 3.0, wall: wallColor, roof: roofColor, flatRoof: true,
    front: [door, window],
    back: [[-width / 2 + 0.7, width / 2 - 0.7, 0.9, 2.2]],
    left: [[-0.7, 0.8, 0.9, 2.2]],
    right: [[-0.7, 0.8, 0.9, 2.2]],
  });
  counter(cabin, width * 0.18, 0.65, width * 0.42, 0);
  cashRegister(cabin, width * 0.22, 0.23);
  roomLight(cabin, 0, 0, 3.0, [door[1] + 0.3, 1.3, -depth / 2 + 0.12], Math.PI);
  return cabin;
}

export function buildMushroomGas(root: THREE.Group): void {
  for (const [x, color] of [[-6.2, C.fadedRed], [6.2, C.fadedBlue]] as const) {
    const canopy = cylinder(root, 3.7, 4.3, 0.35, 24, [x, 4.25, 0], color);
    canopy.castShadow = false;
    cylinder(root, 0.32, 0.58, 4.1, 12, [x, 2.05, 0], C.concreteLight);
    fuelPump(root, x, -1.45, 0, C.fadedRed);
    fuelPump(root, x, 1.45, Math.PI, C.fadedGreen);
    canopyLamp(root, x, 4.0, 0);
  }
  stationCabin(root, 11.5, 7.5, 5.2, 4.2, C.plasterPale, C.fadedRed);
  stationSign(root, -13.0, -7.0, 7.5, C.fadedRed);
  box(root, [30, 0.14, 20], [0, 0.07, 0], C.concrete);
}

export function buildButterflyGas(root: THREE.Group): void {
  for (const z of [-3.0, 3.0]) {
    const leftWing = box(root, [7.4, 0.22, 5.2], [-3.45, 4.2, z], C.fadedBlue, [0, 0, -0.14], true, 'metal');
    const rightWing = box(root, [7.4, 0.22, 5.2], [3.45, 4.2, z], C.white, [0, 0, 0.14], true, 'metal');
    leftWing.castShadow = false;
    rightWing.castShadow = false;
    box(root, [0.34, 4.0, 0.34], [0, 2.0, z], C.darkMetal);
    fuelPump(root, -2.0, z, 0, C.ochre);
    fuelPump(root, 2.0, z, Math.PI, C.fadedRed);
    canopyLamp(root, 0, 3.75, z);
  }
  stationCabin(root, 10.8, 6.6, 6.4, 5.0, C.brick, C.roofTin);
  stationSign(root, -13.0, -6.5, 8.2, C.fadedBlue);
  box(root, [30, 0.14, 19], [0, 0.07, 0], C.concrete);
}

export function buildPavilionGas(root: THREE.Group): void {
  const pavilionRoof = box(root, [20, 0.32, 7.5], [-1.0, 4.6, -0.2], C.roof, [0, 0, 0], true, 'tiles');
  const pavilionFascia = box(root, [20.8, 0.16, 1.0], [-1.0, 4.85, -3.55], C.white, [0, 0, 0], true);
  pavilionRoof.castShadow = false;
  pavilionFascia.castShadow = false;
  for (const x of [-9, -5, -1, 3, 7]) {
    cylinder(root, 0.2, 0.28, 4.5, 12, [x, 2.25, -2.8], C.plasterPale);
    cylinder(root, 0.16, 0.23, 4.5, 12, [x, 2.25, 2.4], C.plasterPale);
  }
  for (const [index, x] of [-7, -3, 1, 5].entries()) {
    const color = index % 2 === 0 ? C.fadedGreen : C.fadedRed;
    fuelPump(root, x, -2.8, 0, color);
    fuelPump(root, x, 2.4, Math.PI, color);
    canopyLamp(root, x, 4.35, -0.2);
  }
  stationCabin(root, 11.0, 6.0, 6.0, 5.2, C.plasterPale, C.roof);
  box(root, [2.2, 7.8, 2.2], [11.0, 3.9, -3.8], C.brick, [0, 0, 0], false, 'brick');
  box(root, [2.8, 0.3, 2.8], [11.0, 7.9, -3.8], C.roof, [0, 0, 0], true, 'tiles');
  stationSign(root, -13.0, -6.2, 6.8, C.ochre);
  box(root, [30, 0.14, 19], [0, 0.07, 0], C.concrete);
}

export function buildUfoGas(root: THREE.Group): void {
  const lowerSaucer = cylinder(root, 7.7, 8.8, 0.55, 32, [0, 5.35, 0], C.white);
  const upperSaucer = cylinder(root, 3.2, 7.7, 0.46, 32, [0, 5.82, 0], C.fadedRed);
  lowerSaucer.castShadow = false;
  upperSaucer.castShadow = false;
  cylinder(root, 0.55, 0.95, 5.1, 16, [0, 2.55, 0], C.concreteLight);
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3;
    const x = Math.cos(angle) * 5.7;
    const z = Math.sin(angle) * 5.7;
    fuelPump(root, x, z, -angle + Math.PI / 2, i % 2 === 0 ? C.fadedRed : C.fadedGreen);
    canopyLamp(root, Math.cos(angle) * 4.2, 5.0, Math.sin(angle) * 4.2);
  }
  stationCabin(root, 12.0, 7.2, 6.0, 5.2, C.fadedBlue, C.white);
  stationSign(root, -14.0, -8.0, 9.0, C.fadedRed);
  box(root, [32, 0.16, 22], [0, 0.08, 0], C.concrete);
}

export function buildHighwayGas(root: THREE.Group): void {
  for (const laneX of [-5.2, 5.2]) {
    const canopy = box(root, [6.4, 0.3, 17.0], [laneX, 5.25, 0], laneX < 0 ? C.fadedBlue : C.fadedRed, [0, 0, 0], true, 'metal');
    const fascia = box(root, [6.4, 0.14, 0.8], [laneX, 5.5, -8.1], C.white, [0, 0, 0], true);
    canopy.castShadow = false;
    fascia.castShadow = false;
    const outerX = laneX + Math.sign(laneX) * 2.55;
    for (const z of [-7.2, 7.2]) box(root, [0.34, 5.1, 0.34], [outerX, 2.55, z], C.darkMetal);
    const pumpX = laneX + Math.sign(laneX) * 0.9;
    for (const [index, z] of [-4.5, 0, 4.5].entries()) {
      fuelPump(root, pumpX, z, laneX < 0 ? -Math.PI / 2 : Math.PI / 2, index === 1 ? C.fadedGreen : C.fadedRed);
      canopyLamp(root, laneX, 4.98, z);
    }
  }
  const shop = stationCabin(root, 12.0, 5.2, 7.0, 6.0, C.concreteLight, C.roofTin);
  shelf(shop, 2.0, 1.9, 3.0, Math.PI / 2, true);
  shelf(shop, -1.8, 2.2, 3.2, 0, true);
  box(root, [3.0, 2.2, 1.5], [11.8, 1.1, -5.8], C.fadedBlue, [0, 0, 0], false, 'metal');
  cylinder(root, 0.34, 0.34, 1.5, 12, [13.8, 0.75, -5.8], C.darkMetal, [Math.PI / 2, 0, 0]);
  stationSign(root, -15.0, 8.0, 10.5, C.fadedRed);
  box(root, [34, 0.16, 23], [0, 0.08, 0], C.concrete);
}
