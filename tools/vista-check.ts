/**
 * Regression check for the distant terrain overlap.
 *
 * The vista must begin beneath the nearest guaranteed player-centred tile edge, so a
 * delayed outer visual tile cannot expose sky. Its road-near vertices must also stay
 * below the road ribbon so the coarse desert cannot erase distant road patches.
 */

import * as THREE from 'three';
import { DESERT_TILE_SIZE } from '../src/world/deserttiledata';
import { VistaMesh } from '../src/render/vista';
import { WorldOrigin } from '../src/world/origin';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';

const SEED = 3094605770;
const S = 24_000;
const MIN_TILE_OVERLAP = 40;
const ROAD_CORE = 40;
const ROAD_REACH = 1_600;
const SNAP = 250;
const REPORTED_MESA_SEED = 2225416641;
const SKY_BINS = 160;
const MIN_MESA_CLEARANCE = (2 * Math.PI) / 180;

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function worldPositionSnapshot(mesh: THREE.Mesh): Float32Array {
  const attribute = mesh.geometry.getAttribute('position');
  invariant(attribute instanceof THREE.BufferAttribute, 'mesh has no position buffer');
  const snapshot = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i++) {
    snapshot[i * 3] = attribute.getX(i) + mesh.position.x;
    snapshot[i * 3 + 1] = attribute.getY(i) + mesh.position.y;
    snapshot[i * 3 + 2] = attribute.getZ(i) + mesh.position.z;
  }
  return snapshot;
}

function maximumPositionDelta(a: Float32Array, b: Float32Array): number {
  invariant(a.length === b.length, 'position buffers changed length across a ground rebuild');
  let maximum = 0;
  for (let i = 0; i < a.length; i += 3) {
    maximum = Math.max(
      maximum,
      Math.hypot(a[i]! - b[i]!, a[i + 1]! - b[i + 1]!, a[i + 2]! - b[i + 2]!),
    );
  }
  return maximum;
}

type MesaCandidateState = {
  readonly key: string;
  readonly firstVertex: number;
  readonly vertexCount: number;
  readonly centreX: number;
  readonly centreZ: number;
  readonly radius: number;
};

type VistaAnimationState = {
  mesaGroundY: [Float32Array, Float32Array, Float32Array, Float32Array] | null;
  mesaHeightOffset: Float32Array | null;
  mesaCentreXZ: Float32Array | null;
  mesaCandidates: MesaCandidateState[];
  dissolvingMesas: Map<string, number>;
  retiredMesas: Set<string>;
  interpolationX: number;
  interpolationZ: number;
};

function mesaCandidateTops(vista: VistaMesh, mesa: THREE.Mesh): Map<string, number> {
  const state = vista as unknown as VistaAnimationState;
  const centres = state.mesaCentreXZ;
  const bases = state.mesaGroundY;
  invariant(centres !== null && bases !== null, 'vista has no mesa interpolation state');
  const position = mesa.geometry.getAttribute('position');
  invariant(position instanceof THREE.BufferAttribute, 'vista has no mesa position buffer');
  const tops = new Map<string, number>();
  for (let i = 0; i < position.count; i++) {
    const lower = bases[0][i]! + (bases[1][i]! - bases[0][i]!) * state.interpolationX;
    const upper = bases[2][i]! + (bases[3][i]! - bases[2][i]!) * state.interpolationX;
    const base = lower + (upper - lower) * state.interpolationZ;
    const key = `${centres[i * 2]},${centres[i * 2 + 1]}`;
    tops.set(key, Math.max(tops.get(key) ?? -Infinity, position.getY(i) - base));
  }
  return tops;
}

function maximumHeightDelta(
  mesh: THREE.Mesh,
  a: Float32Array,
  b: Float32Array,
  minimumRadius: number,
): number {
  invariant(a.length === b.length, 'height buffers changed length inside one interpolation cell');
  const position = mesh.geometry.getAttribute('position');
  invariant(position instanceof THREE.BufferAttribute, 'mesh has no position buffer');
  let maximum = 0;
  for (let i = 1; i < a.length; i += 3) {
    const vertex = (i - 1) / 3;
    if (Math.hypot(position.getX(vertex), position.getZ(vertex)) < minimumRadius) continue;
    maximum = Math.max(maximum, Math.abs(a[i]! - b[i]!));
  }
  return maximum;
}

const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const origin = new WorldOrigin();
const scene = new THREE.Scene();
const vista = new VistaMesh(scene, terrain, road, origin);
const camera = road.sampleAt(S);
vista.setViewDistance(25_000);
vista.update(camera.x, camera.z, S, 0);

const mesh = scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
invariant(mesh !== undefined, 'vista mesh was not attached to the scene');
invariant(Array.isArray(mesh.material) && mesh.material.length === 2, 'vista depth bands missing');
const [overlapMaterial, distantMaterial] = mesh.material;
invariant(
  overlapMaterial instanceof THREE.MeshStandardMaterial &&
    distantMaterial instanceof THREE.MeshStandardMaterial,
  'vista lost authored terrain shading',
);
invariant(
  !overlapMaterial.depthWrite && distantMaterial.depthWrite && mesh.renderOrder < 0,
  'vista depth policy leaks beyond the terrain overlap',
);
invariant(mesh.geometry.groups.length === 2, 'vista overlap is not isolated from distant depth');
const attribute = mesh.geometry.getAttribute('position');
invariant(attribute instanceof THREE.BufferAttribute, 'vista has no position buffer');
const positions = attribute.array as Float32Array;
const roadSamples = [];
for (let s = S - ROAD_REACH; s <= S + ROAD_REACH; s += 40) {
  const point = road.sampleAt(s);
  roadSamples.push({
    x: point.x,
    z: point.z,
    y: terrain.explorationHeightFromFrame(point.x, point.z, 0, point.s),
  });
}

let minimumRadius = Infinity;
let coreVertices = 0;
let worstRoadOverdraw = -Infinity;
for (let i = 0; i < positions.length; i += 3) {
  const x = positions[i]! + mesh.position.x;
  const y = positions[i + 1]! + mesh.position.y;
  const z = positions[i + 2]! + mesh.position.z;
  invariant(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `non-finite vertex ${i / 3}`);

  const radius = Math.hypot(x - camera.x, z - camera.z);
  minimumRadius = Math.min(minimumRadius, radius);
  if (radius > ROAD_REACH) continue;

  const absoluteX = x + origin.x;
  const absoluteZ = z + origin.z;
  let closestDistanceSq = Infinity;
  let closestRoadY = 0;
  for (let j = 0; j < roadSamples.length - 1; j++) {
    const a = roadSamples[j]!;
    const b = roadSamples[j + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t = Math.max(
      0,
      Math.min(1, ((absoluteX - a.x) * dx + (absoluteZ - a.z) * dz) / lengthSq),
    );
    const distanceSq =
      (absoluteX - (a.x + dx * t)) ** 2 + (absoluteZ - (a.z + dz * t)) ** 2;
    if (distanceSq >= closestDistanceSq) continue;
    closestDistanceSq = distanceSq;
    closestRoadY = a.y + (b.y - a.y) * t;
  }
  if (closestDistanceSq > ROAD_CORE * ROAD_CORE) continue;
  coreVertices++;
  worstRoadOverdraw = Math.max(worstRoadOverdraw, y - closestRoadY);
}

invariant(
  DESERT_TILE_SIZE - minimumRadius >= MIN_TILE_OVERLAP - 0.1,
  `vista leaves only ${(DESERT_TILE_SIZE - minimumRadius).toFixed(2)} m of guaranteed tile overlap`,
);
invariant(coreVertices > 0, 'vista generated no vertices over the road underlay core');
invariant(
  worstRoadOverdraw <= 0,
  `vista rises ${worstRoadOverdraw.toFixed(2)} m above the road`,
);

const rebuilds = 8;
const started = performance.now();
for (let i = 1; i <= rebuilds; i++) {
  vista.update(camera.x + i * SNAP, camera.z, S, 0);
}
const meanRebuildMs = (performance.now() - started) / rebuilds;
const steadyCellX = Math.floor((camera.x + rebuilds * SNAP) / SNAP) * SNAP + 10;
vista.update(steadyCellX, camera.z, S, 0);
const steadyFrames = 60;
const steadyStarted = performance.now();
for (let frame = 0; frame < steadyFrames; frame++) {
  vista.update(steadyCellX + frame * 2, camera.z, S, 0);
}
const meanSteadyFrameMs = (performance.now() - steadyStarted) / steadyFrames;

console.log(
  `vista: ${attribute.count} vertices, inner radius ${minimumRadius.toFixed(1)} m, ` +
    `${coreVertices} road-core vertices, worst overdraw ${worstRoadOverdraw.toFixed(2)} m, ` +
    `${meanRebuildMs.toFixed(2)} ms/cell load, ${meanSteadyFrameMs.toFixed(2)} ms/steady frame`,
);
vista.dispose();

// Inside one sample cell, every metre must change the horizon immediately and moving
// back must restore it exactly. Shared edge samples make a cell crossing continuous.
const continuityRoad = new Road(REPORTED_MESA_SEED);
const continuityScene = new THREE.Scene();
const continuityVista = new VistaMesh(
  continuityScene,
  new Terrain(REPORTED_MESA_SEED, continuityRoad),
  continuityRoad,
  new WorldOrigin(),
);
continuityVista.setViewDistance(25_000);
continuityVista.update(50, 60, 0, 0);
const continuityMeshes = continuityScene.children.filter(
  (child): child is THREE.Mesh => child instanceof THREE.Mesh,
);
invariant(
  continuityMeshes.length === 2,
  `continuity vista attached ${continuityMeshes.length} meshes instead of ground + mesas`,
);
const continuityGround = continuityMeshes[0]!;
const continuityMesas = continuityMeshes[1]!;
const groundStart = worldPositionSnapshot(continuityGround);
continuityVista.update(125, 60, 0, 0);
const groundMidpoint = worldPositionSnapshot(continuityGround);
continuityVista.update(200, 60, 0, 0);
const groundEnd = worldPositionSnapshot(continuityGround);
const continuityPositions = continuityGround.geometry.getAttribute('position');
invariant(
  continuityPositions instanceof THREE.BufferAttribute,
  'continuity ground has no position buffer',
);
let midpointError = 0;
for (let i = 0; i < groundMidpoint.length; i++) {
  const vertex = Math.floor(i / 3);
  if (
    Math.hypot(continuityPositions.getX(vertex), continuityPositions.getZ(vertex)) <
    ROAD_REACH
  ) {
    continue;
  }
  midpointError = Math.max(
    midpointError,
    Math.abs(groundMidpoint[i]! - (groundStart[i]! + groundEnd[i]!) * 0.5),
  );
}
invariant(
  midpointError < 0.02,
  `spatial vista interpolation deviates ${midpointError.toFixed(3)} m at midpoint`,
);

continuityVista.update(100, 60, 0, 0);
const groundBeforeStep = worldPositionSnapshot(continuityGround);
continuityVista.update(101, 60, 0, 0);
const groundAfterStep = worldPositionSnapshot(continuityGround);
const oneMetreHeightChange = maximumHeightDelta(
  continuityGround,
  groundBeforeStep,
  groundAfterStep,
  ROAD_REACH,
);
invariant(oneMetreHeightChange > 0.001, 'one metre of travel leaves the horizon stationary');
continuityVista.update(100, 60, 0, 0);
const reverseError = maximumPositionDelta(
  groundBeforeStep,
  worldPositionSnapshot(continuityGround),
);
invariant(reverseError < 0.001, `reversing one metre leaves ${reverseError.toFixed(4)} m of drift`);

continuityVista.update(249.999, 60, 0, 0);
const groundBeforeBoundary = worldPositionSnapshot(continuityGround);
let previousCandidates = mesaCandidateTops(continuityVista, continuityMesas);
continuityVista.update(250.001, 60, 0, 0);
const boundaryJump = maximumPositionDelta(
  groundBeforeBoundary,
  worldPositionSnapshot(continuityGround),
);
invariant(boundaryJump < 0.01, `vista jumps ${boundaryJump.toFixed(3)} m at a cell boundary`);

function checkResidentTransition(currentCandidates: Map<string, number>): number {
  let transitions = 0;
  for (const [key, top] of currentCandidates) {
    if (previousCandidates.has(key)) continue;
    transitions++;
    invariant(top <= 0.1, `new mesa ${key} appears ${top.toFixed(2)} m above its ground base`);
  }
  for (const [key, top] of previousCandidates) {
    if (currentCandidates.has(key)) continue;
    transitions++;
    invariant(top <= 0.1, `departing mesa ${key} vanishes ${top.toFixed(2)} m above ground`);
  }
  return transitions;
}

const afterBoundaryCandidates = mesaCandidateTops(continuityVista, continuityMesas);
let residentTransitions = checkResidentTransition(afterBoundaryCandidates);
continuityVista.update(249.999, 60, 0, 0);
const boundaryReverseError = maximumPositionDelta(
  groundBeforeBoundary,
  worldPositionSnapshot(continuityGround),
);
invariant(
  boundaryReverseError < 0.001,
  `reversing across a cell edge leaves ${boundaryReverseError.toFixed(4)} m of drift`,
);
continuityVista.update(250.001, 60, 0, 0);
previousCandidates = mesaCandidateTops(continuityVista, continuityMesas);
for (let crossing = 1; crossing <= 20; crossing++) {
  continuityVista.update(250.001 + crossing * SNAP, 60, 0, 0);
  const currentCandidates = mesaCandidateTops(continuityVista, continuityMesas);
  residentTransitions += checkResidentTransition(currentCandidates);
  previousCandidates = currentCandidates;
}
invariant(residentTransitions > 0, 'mesa residency check crossed no candidate boundary');
console.log(
  `vista interpolation: ${oneMetreHeightChange.toFixed(3)} m response per metre, ` +
    `${reverseError.toFixed(4)} m reverse error, ${boundaryJump.toFixed(3)} m boundary step, ` +
    `${boundaryReverseError.toFixed(4)} m boundary reverse error, ` +
    `${residentTransitions} buried residency transitions`,
);
continuityVista.dispose();

// Regression for the two failures reported together on seed 2225416641:
// generated mesas hidden below the rolling-hill skyline, and independently warped
// height rings producing diagonal dark triangles across each nominal wall quad.
const mesaRoad = new Road(REPORTED_MESA_SEED);
const mesaScene = new THREE.Scene();
const mesaVista = new VistaMesh(
  mesaScene,
  new Terrain(REPORTED_MESA_SEED, mesaRoad),
  mesaRoad,
  new WorldOrigin(),
);
mesaVista.setViewDistance(25_000);
mesaVista.update(0, 0, 0, 0);
const mesaMeshes = mesaScene.children.filter(
  (child): child is THREE.Mesh => child instanceof THREE.Mesh,
);
invariant(mesaMeshes.length === 2, `vista attached ${mesaMeshes.length} meshes instead of ground + mesas`);
const groundPositions = mesaMeshes[0]!.geometry.getAttribute('position');
const mesaPositions = mesaMeshes[1]!.geometry.getAttribute('position');
invariant(groundPositions instanceof THREE.BufferAttribute, 'mesa regression has no ground vertices');
invariant(mesaPositions instanceof THREE.BufferAttribute, 'mesa regression generated no mesa vertices');

// The visual skirt must meet the triangles that are actually rendered, not the
// higher-resolution analytic height field used to generate those triangles.
const mesaState = mesaVista as unknown as VistaAnimationState;
invariant(
  mesaState.mesaHeightOffset !== null && mesaState.mesaCentreXZ !== null,
  'mesa regression has no grounding state',
);
mesaScene.updateMatrixWorld(true);
const downward = new THREE.Raycaster(
  new THREE.Vector3(),
  new THREE.Vector3(0, -1, 0),
  0,
  10_000,
);
const sampledContacts = new Set<string>();
let groundedSamples = 0;
let worstContactError = 0;
for (let i = 0; i < mesaPositions.count && groundedSamples < 32; i++) {
  if (mesaState.mesaHeightOffset[i] !== -3) continue;
  const centreDistance = Math.hypot(
    mesaState.mesaCentreXZ[i * 2]!,
    mesaState.mesaCentreXZ[i * 2 + 1]!,
  );
  if (centreDistance < 2_000 || centreDistance > 15_000) continue;
  const x = mesaPositions.getX(i);
  const z = mesaPositions.getZ(i);
  const key = `${x.toFixed(3)},${z.toFixed(3)}`;
  if (sampledContacts.has(key)) continue;
  sampledContacts.add(key);
  downward.ray.origin.set(x, 5_000, z);
  const hit = downward.intersectObject(mesaMeshes[0]!, false)[0];
  if (!hit) continue;
  groundedSamples++;
  worstContactError = Math.max(
    worstContactError,
    Math.abs(mesaPositions.getY(i) - hit.point.y + 3),
  );
}
invariant(groundedSamples >= 16, `only ${groundedSamples} mesa skirt contacts could be sampled`);
invariant(
  worstContactError < 0.05,
  `mesa skirt floats ${worstContactError.toFixed(2)} m from rendered ground`,
);

const skyline = new Float64Array(SKY_BINS);
skyline.fill(-Infinity);
const eyeY = mesaRoad.sampleAt(0).y + 2;
for (let i = 0; i < groundPositions.count; i++) {
  const x = groundPositions.getX(i);
  const z = groundPositions.getZ(i);
  const bin =
    (Math.round((Math.atan2(x, z) / (Math.PI * 2)) * SKY_BINS) + SKY_BINS) % SKY_BINS;
  const elevation = Math.atan2(groundPositions.getY(i) - eyeY, Math.hypot(x, z));
  skyline[bin] = Math.max(skyline[bin]!, elevation);
}
let visibleMesaVertices = 0;
let bestMesaClearance = -Infinity;
const visibleOctants = new Set<number>();
for (let i = 0; i < mesaPositions.count; i++) {
  const x = mesaPositions.getX(i);
  const z = mesaPositions.getZ(i);
  const bin =
    (Math.round((Math.atan2(x, z) / (Math.PI * 2)) * SKY_BINS) + SKY_BINS) % SKY_BINS;
  const elevation = Math.atan2(mesaPositions.getY(i) - eyeY, Math.hypot(x, z));
  const clearance = elevation - skyline[bin]!;
  bestMesaClearance = Math.max(bestMesaClearance, clearance);
  if (clearance <= MIN_MESA_CLEARANCE) continue;
  visibleMesaVertices++;
  visibleOctants.add(Math.floor(bin / (SKY_BINS / 8)));
}
invariant(
  visibleMesaVertices >= 500 && visibleOctants.size >= 4,
  `mesas remain hidden: ${visibleMesaVertices} visible vertices across ${visibleOctants.size} octants`,
);

const silhouettes = new Map<string, { radius: number; height: number }>();
invariant(
  mesaState.mesaCentreXZ !== null && mesaState.mesaHeightOffset !== null,
  'mesa regression has no silhouette state',
);
for (let i = 0; i < mesaPositions.count; i++) {
  const centreX = mesaState.mesaCentreXZ[i * 2]!;
  const centreZ = mesaState.mesaCentreXZ[i * 2 + 1]!;
  const key = `${centreX},${centreZ}`;
  const silhouette = silhouettes.get(key) ?? { radius: 0, height: 0 };
  silhouette.radius = Math.max(
    silhouette.radius,
    Math.hypot(mesaPositions.getX(i) - centreX, mesaPositions.getZ(i) - centreZ),
  );
  silhouette.height = Math.max(silhouette.height, mesaState.mesaHeightOffset[i]!);
  silhouettes.set(key, silhouette);
}
const broadMediumMesas = [...silhouettes.values()].filter(
  ({ radius, height }) => radius >= 500 && height <= 600,
).length;
const tallNarrowMesas = [...silhouettes.values()].filter(
  ({ radius, height }) => radius < 450 && height >= 650,
).length;
invariant(
  silhouettes.size >= 20 && silhouettes.size <= 55,
  `mesa density produced ${silhouettes.size} candidates`,
);
invariant(
  broadMediumMesas / silhouettes.size >= 0.4,
  `only ${broadMediumMesas}/${silhouettes.size} mesas are broad and medium-height`,
);
invariant(
  tallNarrowMesas / silhouettes.size <= 0.2,
  `${tallNarrowMesas}/${silhouettes.size} mesas remain narrow and tall`,
);

const mesaNormals = mesaMeshes[1]!.geometry.getAttribute('normal');
invariant(mesaNormals instanceof THREE.BufferAttribute, 'mesa regression has no normal buffer');
const c = new THREE.Vector3();
const b = new THREE.Vector3();
const sharedC = new THREE.Vector3();
const sharedB = new THREE.Vector3();
const n1 = new THREE.Vector3();
const n2 = new THREE.Vector3();
const wallCreases: number[] = [];
for (let i = 0; i + 5 < mesaPositions.count; i += 6) {
  b.fromBufferAttribute(mesaPositions, i + 1);
  c.fromBufferAttribute(mesaPositions, i + 2);
  sharedC.fromBufferAttribute(mesaPositions, i + 3);
  sharedB.fromBufferAttribute(mesaPositions, i + 4);
  if (c.distanceToSquared(sharedC) > 1e-6 || b.distanceToSquared(sharedB) > 1e-6) continue;
  n1.fromBufferAttribute(mesaNormals, i);
  n2.fromBufferAttribute(mesaNormals, i + 3);
  wallCreases.push(Math.acos(Math.max(-1, Math.min(1, n1.dot(n2)))));
}
wallCreases.sort((x, y) => x - y);
const wallCreaseP95 = wallCreases[Math.floor(wallCreases.length * 0.95)] ?? Infinity;
invariant(
  wallCreaseP95 < (0.1 * Math.PI) / 180,
  `mesa wall lighting diverges by ${((wallCreaseP95 * 180) / Math.PI).toFixed(2)} degrees at p95`,
);
console.log(
  `mesa seed ${REPORTED_MESA_SEED}: ${silhouettes.size} candidates, ` +
    `${broadMediumMesas} broad/medium, ${tallNarrowMesas} narrow/tall; ` +
    `${visibleMesaVertices} skyline vertices across ${visibleOctants.size}/8 octants, ` +
    `best clearance ${((bestMesaClearance * 180) / Math.PI).toFixed(1)} deg, ` +
    `${groundedSamples} contacts within ${worstContactError.toFixed(3)} m, ` +
    `wall-lighting crease p95 ${((wallCreaseP95 * 180) / Math.PI).toFixed(2)} deg`,
);
mesaVista.dispose();

// Once the camera reaches 500 m from a mesa's actual footprint, it dissolves on its
// own clock. Retreating cannot reverse it, and revisiting cannot rebuild it.
const approachScene = new THREE.Scene();
const approachVista = new VistaMesh(
  approachScene,
  new Terrain(REPORTED_MESA_SEED, mesaRoad),
  mesaRoad,
  new WorldOrigin(),
);
approachVista.setViewDistance(25_000);
approachVista.update(0, 0, 0, 0);
const approachState = approachVista as unknown as VistaAnimationState;
const targetMesa = approachState.mesaCandidates.find((candidate) => {
  const distance = Math.hypot(candidate.centreX, candidate.centreZ);
  return distance > candidate.radius + 1_000 && distance < 12_000;
});
invariant(targetMesa !== undefined, 'mesa approach check found no suitable candidate');
const targetDistance = Math.hypot(targetMesa.centreX, targetMesa.centreZ);
const triggerDistance = targetMesa.radius + 499;
const triggerX =
  targetMesa.centreX - (targetMesa.centreX / targetDistance) * triggerDistance;
const triggerZ =
  targetMesa.centreZ - (targetMesa.centreZ / targetDistance) * triggerDistance;
approachVista.update(triggerX, triggerZ, 0, 0);
invariant(
  approachState.dissolvingMesas.has(targetMesa.key),
  'mesa did not begin dissolving 499 m from its footprint',
);
approachVista.update(triggerX, triggerZ, 0, 9);
const fadingCandidate = approachState.mesaCandidates.find(
  (candidate) => candidate.key === targetMesa.key,
);
invariant(fadingCandidate !== undefined, 'dissolving mesa left residency unexpectedly');
const approachMesas = approachScene.children.filter(
  (child): child is THREE.Mesh => child instanceof THREE.Mesh,
)[1];
invariant(approachMesas !== undefined, 'mesa approach check has no mesa mesh');
const dissolveColors = approachMesas.geometry.getAttribute('color');
invariant(
  dissolveColors instanceof THREE.BufferAttribute && dissolveColors.itemSize === 4,
  'mesa dissolve has no vertex alpha',
);
const halfwayAlpha = dissolveColors.getW(fadingCandidate.firstVertex);
invariant(
  halfwayAlpha > 0.45 && halfwayAlpha < 0.55,
  `mesa dissolve alpha is ${halfwayAlpha.toFixed(3)} halfway through`,
);
const approachSparkles = approachScene.children.find(
  (child): child is THREE.Points => child instanceof THREE.Points,
);
invariant(approachSparkles !== undefined, 'mesa dissolve has no sparkle pool');
invariant(
  approachSparkles.visible &&
    approachSparkles.geometry.drawRange.count > 0 &&
    approachSparkles.geometry.drawRange.count <= 64,
  `mesa dissolve draws ${approachSparkles.geometry.drawRange.count} sparkles outside its fixed pool`,
);
approachVista.update(0, 0, 0, 9.1);
invariant(
  approachState.retiredMesas.has(targetMesa.key) &&
    !approachState.dissolvingMesas.has(targetMesa.key),
  'retreat restored or paused a dissolving mesa',
);
invariant(
  !approachSparkles.visible && approachSparkles.geometry.drawRange.count === 0,
  'mesa sparkle pool remained visible after the dissolve',
);
approachVista.update(triggerX, triggerZ, 0, 0);
invariant(
  !approachState.mesaCandidates.some((candidate) => candidate.key === targetMesa.key),
  'retired mesa was rebuilt when its location was revisited',
);
const approachMaterial = approachMesas.material;
invariant(
  !Array.isArray(approachMaterial) && approachMaterial.alphaHash,
  'mesa dissolve does not use hashed transparency',
);
console.log(
  `mesa dissolve: triggered at 499 m clearance, halfway alpha ${halfwayAlpha.toFixed(2)}, ` +
    `${approachSparkles.geometry.getAttribute('position').count} pooled sparkles, ` +
    'retreat and revisit kept it retired',
);
approachVista.dispose();
