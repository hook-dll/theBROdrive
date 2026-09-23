import * as THREE from 'three';

import {
  C,
  barrel,
  box,
  buildingShell,
  counter,
  crate,
  cylinder,
  gableGeometry,
  geometryCache,
  material,
  roomLight,
  torus,
  type V3,
} from './kit';
import { beamBetween } from './towers';

function hullGeometry(length: number, width: number, height: number): THREE.BufferGeometry {
  const key = `hull:${length}:${width}:${height}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const stations = [
    [-length / 2, width * 0.08, height * 1.28, height * 0.42],
    [-length * 0.39, width * 0.43, height * 1.02, height * 0.08],
    [length * 0.28, width * 0.5, height, 0],
    [length * 0.46, width * 0.35, height * 1.12, height * 0.18],
    [length / 2, width * 0.07, height * 1.35, height * 0.55],
  ] as const;
  const vertices: number[] = [];
  for (const [x, half, top, bottom] of stations) {
    vertices.push(x, top, -half, x, top, half, x, bottom, half * 0.45, x, bottom, -half * 0.45);
  }
  const indices: number[] = [];
  for (let station = 0; station < stations.length - 1; station++) {
    const a = station * 4;
    const b = a + 4;
    for (let edge = 0; edge < 4; edge++) {
      const next = (edge + 1) % 4;
      indices.push(a + edge, b + edge, b + next, a + edge, b + next, a + next);
    }
  }
  indices.push(0, 1, 2, 0, 2, 3);
  const last = (stations.length - 1) * 4;
  indices.push(last, last + 2, last + 1, last, last + 3, last + 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometryCache.set(key, geometry);
  return geometry;
}

function hull(parent: THREE.Object3D, length: number, width: number, height: number, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(hullGeometry(length, width, height), material(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function boatRailing(parent: THREE.Object3D, length: number, width: number, y: number): void {
  for (const side of [-1, 1]) {
    for (let x = -length / 2; x <= length / 2; x += 1.55) {
      box(parent, [0.055, 0.75, 0.055], [x, y + 0.37, side * width / 2], C.darkMetal);
    }
    box(parent, [length, 0.055, 0.055], [0, y + 0.72, side * width / 2], C.darkMetal);
  }
}

export function buildTugboat(root: THREE.Group): void {
  const wreck = new THREE.Group();
  wreck.position.y = -1.15;
  wreck.rotation.set(0.025, -0.16, -0.075);
  root.add(wreck);
  hull(wreck, 16.2, 5.4, 2.1, C.rustDark);
  box(wreck, [11.2, 0.18, 4.15], [-0.25, 2.14, 0], C.darkMetal);
  box(wreck, [3.4, 0.22, 3.8], [-6.0, 2.42, 0], C.rust);
  boatRailing(wreck, 12.6, 4.45, 2.2);

  const cabin = new THREE.Group();
  cabin.position.set(-1.6, 2.23, 0);
  wreck.add(cabin);
  buildingShell(cabin, {
    width: 4.8, depth: 3.55, height: 2.5, wall: C.white, roof: C.fadedBlue, flatRoof: true,
    front: [[-0.7, 0.7, 0, 2.05]],
    back: [[-1.85, -0.65, 0.8, 1.85], [0.65, 1.85, 0.8, 1.85]],
    left: [[-1.05, 0.55, 0.78, 1.82]],
    right: [[-1.05, 0.55, 0.78, 1.82]],
  });
  counter(cabin, 0.8, 0.75, 1.5);
  roomLight(cabin, 0, 0, 2.5, [1.6, 1.2, -1.66], Math.PI);

  cylinder(wreck, 0.42, 0.5, 2.8, 12, [1.45, 4.05, 0.45], C.rust, [0, 0, -0.08]);
  cylinder(wreck, 0.16, 0.2, 5.4, 8, [-3.3, 6.4, 0], C.darkMetal, [0, 0, 0.035]);
  box(wreck, [3.2, 0.1, 0.1], [-2.2, 8.2, 0], C.darkMetal, [0, 0, -0.12]);
  for (const x of [2.2, 3.3]) {
    cylinder(wreck, 0.62, 0.62, 1.45, 14, [x, 2.75, 0], C.darkMetal, [Math.PI / 2, 0, 0]);
    cylinder(wreck, 0.2, 0.2, 1.8, 10, [x, 2.75, 0], C.rust, [Math.PI / 2, 0, 0]);
  }
  for (const x of [-5.0, -2.9, 0.1, 2.9, 5.2]) {
    torus(wreck, 0.52, 0.16, [x, 1.75, -2.52], C.darkMetal);
    torus(wreck, 0.52, 0.16, [x, 1.75, 2.52], C.darkMetal);
  }
  cylinder(wreck, 0.12, 0.12, 1.1, 8, [7.3, 0.95, 0], C.darkMetal, [0, 0, Math.PI / 2]);
  for (const angle of [0, Math.PI / 2]) box(wreck, [0.16, 1.45, 0.32], [7.9, 0.95, 0], C.rust, [angle, 0, 0.72]);
  barrel(wreck, 4.4, -0.8, C.rust, 0.16, 2.2);
  barrel(wreck, 5.05, 0.65, C.fadedBlue, -0.08, 2.2);
  box(root, [7.5, 0.55, 3.8], [4.2, 0.06, 0.3], C.sandDark, [0.02, -0.1, 0.06]);
}

export function buildFishingWreck(root: THREE.Group): void {
  const wreck = new THREE.Group();
  wreck.position.y = -1.05;
  wreck.rotation.set(-0.045, 0.28, 0.12);
  root.add(wreck);
  hull(wreck, 12.8, 4.4, 1.8, C.fadedBlue);
  box(wreck, [8.7, 0.15, 3.25], [-0.3, 1.88, 0], C.timber);
  for (let x = -4.5; x <= 4.5; x += 1.5) {
    beamBetween(wreck, new THREE.Vector3(x, 1.9, -1.65), new THREE.Vector3(x, 2.65, -2.0), 0.09, C.darkTimber);
    beamBetween(wreck, new THREE.Vector3(x, 1.9, 1.65), new THREE.Vector3(x, 2.65, 2.0), 0.09, C.darkTimber);
    box(wreck, [0.09, 0.09, 3.4], [x, 1.96, 0], C.darkTimber);
  }
  boatRailing(wreck, 8.8, 3.7, 2.05);

  const wheelhouse = new THREE.Group();
  wheelhouse.position.set(-2.65, 2.0, 0);
  wreck.add(wheelhouse);
  buildingShell(wheelhouse, {
    width: 3.0, depth: 2.75, height: 1.95, wall: C.plasterBlue, roof: C.roofTin, flatRoof: true,
    front: [[-0.55, 0.55, 0, 1.65]],
    back: [[-1.1, -0.2, 0.65, 1.5], [0.2, 1.1, 0.65, 1.5]],
    left: [[-0.7, 0.45, 0.65, 1.5]],
    right: [[-0.7, 0.45, 0.65, 1.5]],
  });
  cylinder(wreck, 0.13, 0.17, 6.0, 8, [-0.9, 5.0, 0], C.darkTimber, [0, 0, 0.14]);
  beamBetween(wreck, new THREE.Vector3(-0.5, 6.85, 0), new THREE.Vector3(4.4, 4.55, 0), 0.12, C.darkTimber);
  for (const z of [-1.4, 1.4]) {
    beamBetween(wreck, new THREE.Vector3(-0.8, 6.6, 0), new THREE.Vector3(4.1, 2.15, z), 0.035, C.darkMetal);
  }
  cylinder(wreck, 0.4, 0.4, 1.25, 12, [3.25, 2.35, 0], C.rust, [Math.PI / 2, 0, 0]);
  torus(wreck, 0.42, 0.09, [-2.7, 3.05, -1.5], C.white);
  crate(wreck, 2.1, 0.75, 0.35, 0.58, 2.02);
  crate(wreck, 3.0, -0.7, -0.2, 0.48, 2.02);
  box(root, [6.5, 0.48, 3.2], [2.8, 0.02, -0.1], C.sandDark, [0.04, 0.22, -0.04]);
}

function planformGeometry(points: readonly (readonly [number, number])[], thickness: number): THREE.BufferGeometry {
  const key = `planform:${points.map((point) => point.join(',')).join(';')}:${thickness}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const vertices: number[] = [];
  for (const y of [-thickness / 2, thickness / 2]) {
    for (const [x, z] of points) vertices.push(x, y, z);
  }
  const count = points.length;
  const indices: number[] = [];
  for (let i = 1; i < count - 1; i++) {
    indices.push(0, i + 1, i, count, count + i, count + i + 1);
  }
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    indices.push(i, next, count + next, i, count + next, count + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometryCache.set(key, geometry);
  return geometry;
}

function planform(
  parent: THREE.Object3D,
  points: readonly (readonly [number, number])[],
  thickness: number,
  position: V3,
  color: number,
  rotation: V3 = [0, 0, 0],
): THREE.Mesh {
  const mesh = new THREE.Mesh(planformGeometry(points, thickness), material(color));
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function aircraftWing(parent: THREE.Object3D, y: number, color: number, damaged = false): void {
  const span = damaged ? 7.8 : 11.2;
  const chord = damaged ? 2.8 : 3.5;
  const rightWing = planform(
    parent,
    [[-chord, 0], [-2.2, 2.2], [-0.55, span], [1.05, span], [2.25, 2.2], [chord * 0.85, 0]],
    0.46,
    [0, y, 0],
    color,
    [0.015, 0, -0.012],
  );
  const leftWing = planform(
    parent,
    [[-chord, 0], [-2.2, -2.2], [-0.55, -span], [1.05, -span], [2.25, -2.2], [chord * 0.85, 0]],
    0.46,
    [0, y, 0],
    color,
    [-0.015, 0, 0.012],
  );
  rightWing.userData.poiAircraftMainWing = true;
  leftWing.userData.poiAircraftMainWing = true;
}

function propeller(parent: THREE.Object3D, x: number, y: number, z: number, broken = false): void {
  cylinder(parent, 0.24, 0.34, 0.72, 12, [x, y, z], C.darkMetal, [0, 0, Math.PI / 2]);
  const blade = broken ? 1.2 : 2.05;
  box(parent, [0.1, blade * 2, 0.22], [x - 0.4, y, z], C.darkMetal, [0.25, 0, 0.18]);
  if (!broken) box(parent, [0.1, 0.22, blade * 2], [x - 0.41, y, z], C.darkMetal, [0, 0.15, 0]);
}

function aircraftWindows(
  parent: THREE.Object3D,
  fromX: number,
  count: number,
  spacing = 1.28,
  y = 2.4,
  sideZ = 1.64,
): void {
  for (let i = 0; i < count; i++) {
    const x = fromX + i * spacing;
    for (const side of [-1, 1]) {
      const glass = cylinder(parent, 0.28, 0.28, 0.075, 16, [x, y, side * sideZ], C.darkMetal, [Math.PI / 2, 0, 0]);
      glass.userData.poiAircraftWindow = true;
      torus(parent, 0.31, 0.045, [x, y, side * (sideZ + 0.035)], C.metal);
    }
  }
}

function ellipsoid(parent: THREE.Object3D, position: V3, radii: V3, color: number): THREE.Mesh {
  const key = 'aircraft-ellipsoid:24:16';
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = new THREE.SphereGeometry(1, 24, 16);
    geometryCache.set(key, geometry);
  }
  const mesh = new THREE.Mesh(geometry, material(color));
  mesh.position.set(position[0], position[1], position[2]);
  mesh.scale.set(radii[0], radii[1], radii[2]);
  mesh.userData.poiAircraftRoundedNose = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cockpitPoint(radii: V3, pitch: number, yaw: number): THREE.Vector3 {
  const ring = Math.cos(pitch);
  return new THREE.Vector3(
    -radii[0] * ring * Math.cos(yaw),
    radii[1] * Math.sin(pitch),
    radii[2] * ring * Math.sin(yaw),
  );
}

function cockpitPaneGeometry(radii: V3, yawStart: number, yawEnd: number): THREE.BufferGeometry {
  const key = `cockpit-pane:${radii.join(':')}:${yawStart}:${yawEnd}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const columns = 5;
  const rows = 4;
  const vertices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const pitch = THREE.MathUtils.lerp(0.18, 0.72, row / rows);
    for (let column = 0; column <= columns; column++) {
      const yaw = THREE.MathUtils.lerp(yawStart, yawEnd, column / columns);
      const point = cockpitPoint(radii, pitch, yaw);
      vertices.push(point.x, point.y, point.z);
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometryCache.set(key, geometry);
  return geometry;
}

function aircraftCockpit(parent: THREE.Object3D, center: V3, noseRadii: V3): void {
  const paneRadii: V3 = [noseRadii[0] + 0.025, noseRadii[1] + 0.025, noseRadii[2] + 0.025];
  const glassMaterial = material(C.fadedBlue).clone();
  glassMaterial.side = THREE.DoubleSide;
  for (const [yawStart, yawEnd] of [[-1.0, -0.07], [0.07, 1.0]] as const) {
    const pane = new THREE.Mesh(cockpitPaneGeometry(paneRadii, yawStart, yawEnd), glassMaterial);
    pane.position.set(center[0], center[1], center[2]);
    pane.userData.poiAircraftCockpitWindow = true;
    parent.add(pane);
  }
  for (const yaw of [-1.02, 0, 1.02]) {
    const bottom = cockpitPoint(paneRadii, 0.18, yaw).add(new THREE.Vector3(...center));
    const top = cockpitPoint(paneRadii, 0.72, yaw).add(new THREE.Vector3(...center));
    beamBetween(parent, bottom, top, 0.065, C.metal);
  }
}


export function buildPlaneFuselage(root: THREE.Group): void {
  const wreck = new THREE.Group();
  wreck.rotation.set(0.018, 0.1, -0.025);
  wreck.position.y = -0.28;
  wreck.userData.poiAircraftCabinHeight = 3.4;
  wreck.userData.poiBuriedInSand = true;
  root.add(wreck);

  const noseCenter: V3 = [-8.2, 1.9, 0];
  const noseRadii: V3 = [2.6, 1.7, 1.7];
  cylinder(wreck, 1.7, 1.7, 15.8, 24, [-0.3, 1.9, 0], C.white, [0, 0, Math.PI / 2]);
  ellipsoid(wreck, noseCenter, noseRadii, C.white);
  cylinder(wreck, 1.68, 0.62, 5.2, 24, [10.2, 1.9, 0], C.white, [0, 0, Math.PI / 2]);
  aircraftWing(wreck, 1.72, C.white);

  planform(wreck, [[-1.8, 0], [-0.1, 4.4], [1.2, 4.4], [1.8, 0], [1.2, -4.4], [-0.1, -4.4]], 0.2, [10.0, 2.2, 0], C.fadedRed, [0, 0, 0.04]);
  const fin = new THREE.Mesh(gableGeometry(4.2, 3.8, 0.2), material(C.fadedRed));
  fin.position.set(10.2, 2.15, 0);
  fin.rotation.z = -0.12;
  fin.castShadow = true;
  wreck.add(fin);

  for (const z of [-5.4, 5.4]) {
    cylinder(wreck, 0.96, 0.78, 3.2, 18, [-1.6, 1.35, z], C.rustDark, [0, 0, Math.PI / 2]);
    propeller(wreck, -3.25, 1.35, z, z > 0);
  }
  aircraftWindows(wreck, -5.7, 8);
  aircraftCockpit(wreck, noseCenter, noseRadii);

  for (const [x, z, tilt] of [[-2.0, -3.0, -0.2], [1.2, 3.2, 0.3], [6.0, -1.2, 0.5]] as const) {
    beamBetween(wreck, new THREE.Vector3(x, 1.05, z), new THREE.Vector3(x + tilt, 0.05, z + 0.28), 0.12, C.darkMetal);
    torus(wreck, 0.36, 0.13, [x + tilt, 0.14, z + 0.28], C.darkMetal, [Math.PI / 2, 0, 0]);
  }
}

export function buildBrokenPlane(root: THREE.Group): void {
  const nose = new THREE.Group();
  nose.position.set(-5.0, -0.15, 1.8);
  nose.rotation.set(0.07, -0.22, 0.09);
  nose.userData.poiAircraftCabinHeight = 3.4;
  nose.userData.poiBuriedInSand = true;
  root.add(nose);
  const noseCenter: V3 = [-4.75, 1.85, 0];
  const noseRadii: V3 = [2.6, 1.7, 1.7];
  cylinder(nose, 1.7, 1.7, 9.5, 22, [0, 1.85, 0], C.white, [0, 0, Math.PI / 2]);
  ellipsoid(nose, noseCenter, noseRadii, C.white);
  aircraftWing(nose, 1.68, C.white, true);
  aircraftWindows(nose, -2.7, 5);
  aircraftCockpit(nose, noseCenter, noseRadii);

  const tail = new THREE.Group();
  tail.position.set(8.5, -0.12, -3.2);
  tail.rotation.set(-0.06, 0.42, -0.14);
  root.add(tail);
  cylinder(tail, 1.62, 0.58, 6.4, 18, [0, 1.7, 0], C.metal, [0, 0, Math.PI / 2]);
  planform(tail, [[-1.5, 0], [-0.1, 4.0], [1.1, 3.8], [1.7, 0], [1.1, -3.8], [-0.1, -4.0]], 0.18, [2.1, 2.0, 0], C.fadedRed, [0.05, 0, 0.08]);
  const fin = new THREE.Mesh(gableGeometry(3.8, 3.4, 0.18), material(C.fadedRed));
  fin.position.set(2.1, 1.95, 0);
  fin.rotation.z = -0.22;
  fin.castShadow = true;
  tail.add(fin);

  const detachedWing = new THREE.Group();
  detachedWing.position.set(3.0, -0.35, 6.5);
  detachedWing.rotation.set(0.08, -0.38, -0.08);
  root.add(detachedWing);
  planform(detachedWing, [[-3.4, 0], [-0.3, 8.8], [1.4, 8.1], [2.8, 0]], 0.46, [0, 0.5, 0], C.white);
  cylinder(root, 0.95, 0.78, 3.0, 18, [2.8, 0.95, 2.2], C.rustDark, [0.2, 0.45, Math.PI / 2]);
  propeller(root, 1.25, 1.0, 1.8, true);
  for (let i = 0; i < 7; i++) {
    box(root, [0.1, 0.1, 1.4 + i * 0.22], [-0.2 + i * 0.55, 0.4 + i * 0.07, -0.5 + i * 0.25], C.darkMetal, [0.2 * i, 0.35, 0.5 - i * 0.06]);
  }
}
