/**
 * Regression check for the distant terrain overlap.
 *
 * The vista must begin beneath the nearest guaranteed player-centred tile edge, so a
 * delayed outer visual tile cannot expose sky. Its road-near vertices must also stay
 * below the road ribbon so the coarse desert cannot erase distant road patches. It is
 * world-anchored between lattice steps (render/vista.ts `DISC_STEP`): the drawn ground
 * at a fixed spot holds still while the camera moves inside a step, and a step changes
 * it by a fraction of a pixel.
 */

import * as THREE from 'three';
import { DESERT_TILE_SIZE } from '../src/world/deserttiledata';
import { VistaMesh } from '../src/render/vista';
import { MESA_TOP_HEIGHT, mesaFieldOf } from '../src/world/mesas';
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
/** The disc's lattice step, render/vista.ts `DISC_STEP`. */
const DISC = SNAP / 16;
/**
 * Largest change a lattice step may make to the drawn ground at a fixed spot, as seen
 * from the disc's centre: 0.05 degrees is under a pixel at 1440 lines and 85 degrees.
 */
const MAX_STEP_ANGLE = (0.05 * Math.PI) / 180;

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
  readonly key: number;
  readonly firstVertex: number;
  readonly vertexCount: number;
  readonly centreX: number;
  readonly centreZ: number;
  readonly radius: number;
};

/** render/vista.ts `MesaSet`: the mesas drawn now, and what stands them on the ground. */
type MesaSetState = {
  readonly groundY: [Float32Array, Float32Array, Float32Array, Float32Array];
  readonly heightOffset: Float32Array;
  readonly centreXZ: Float32Array;
  readonly exactY: Float32Array;
  readonly candidates: readonly MesaCandidateState[];
};

type VistaAnimationState = {
  mesaSet: MesaSetState | null;
  mesaBuild: unknown;
  interpolationX: number;
  interpolationZ: number;
};

function drawnMesas(vista: VistaMesh): MesaSetState {
  const set = (vista as unknown as VistaAnimationState).mesaSet;
  invariant(set !== null, 'vista has no mesa set');
  return set;
}

function mesaCandidateTops(vista: VistaMesh, mesa: THREE.Mesh): Map<string, number> {
  const state = vista as unknown as VistaAnimationState;
  const { centreXZ: centres, groundY: bases } = drawnMesas(vista);
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

/** Each drawn mesa's vertices in world space, by site key. */
function mesaWorldVertices(vista: VistaMesh, mesa: THREE.Mesh): Map<number, Float32Array> {
  const snapshot = worldPositionSnapshot(mesa);
  const out = new Map<number, Float32Array>();
  for (const candidate of drawnMesas(vista).candidates) {
    out.set(
      candidate.key,
      snapshot.slice(candidate.firstVertex * 3, (candidate.firstVertex + candidate.vertexCount) * 3),
    );
  }
  return out;
}

/**
 * A crossing builds the next cell's mesas over the frames the lattice point stands on
 * the shared edge (render/vista.ts `MesaBuild`), never in one frame. Stepping onto the
 * edge (`onto`) starts the build and keeps the drawn set; there the drawn set and its
 * successor stand every mesa they share in the same place, vertex for vertex; stepping
 * off it into the next cell (`off`) finds the successor drawn and builds nothing. The
 * vista is left back on the edge, still drawing the successor.
 */
function checkEdgeHandover(vista: VistaMesh, mesas: THREE.Mesh, onto: number, off: number): void {
  const state = vista as unknown as VistaAnimationState;
  const drawnBefore = drawnMesas(vista);
  vista.update(onto, LANE_Z, 0);
  invariant(drawnMesas(vista) === drawnBefore, 'stepping onto a cell edge rebuilt the mesas in its own frame');
  invariant(state.mesaBuild !== null, 'stepping onto a cell edge started no mesa build');
  const standing = mesaWorldVertices(vista, mesas);
  vista.finishMesaBuild();
  let shared = 0;
  let error = 0;
  for (const [key, rebuilt] of mesaWorldVertices(vista, mesas)) {
    const before = standing.get(key);
    if (!before) continue;
    shared++;
    invariant(before.length === rebuilt.length, `mesa ${key} changed vertex count across a rebuild`);
    for (let i = 0; i < rebuilt.length; i++) error = Math.max(error, Math.abs(rebuilt[i]! - before[i]!));
  }
  invariant(shared > 0, 'the edge handover shared no mesa between the two cells');
  invariant(error === 0, `the drawn mesas stand ${error} m off their successors on the shared edge`);
  const successor = drawnMesas(vista);
  vista.update(off, LANE_Z, 0);
  invariant(drawnMesas(vista) === successor, 'stepping off the edge rebuilt the mesas in its own frame');
  vista.update(onto, LANE_Z, 0);
  invariant(drawnMesas(vista) === successor, 'stepping back onto the edge rebuilt the mesas in its own frame');
}

const groundRay = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 20_000);

/** The drawn ground's height under each fixed world point, as the GPU would draw it. */
function drawnHeights(mesh: THREE.Mesh, points: readonly { x: number; z: number }[]): number[] {
  mesh.updateMatrixWorld(true);
  return points.map((point) => {
    groundRay.ray.origin.set(point.x, 10_000, point.z);
    const hit = groundRay.intersectObject(mesh, false)[0];
    invariant(hit !== undefined, `no drawn ground under ${point.x.toFixed(0)}, ${point.z.toFixed(0)}`);
    return hit.point.y;
  });
}

/** The largest change between two height sets, as an angle from the disc's centre. */
function largestStepAngle(
  points: readonly { x: number; z: number }[],
  a: readonly number[],
  b: readonly number[],
  centreX: number,
  centreZ: number,
): number {
  let largest = 0;
  points.forEach((point, k) => {
    largest = Math.max(largest, Math.abs(a[k]! - b[k]!) / Math.hypot(point.x - centreX, point.z - centreZ));
  });
  return largest;
}

const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const origin = new WorldOrigin();
const scene = new THREE.Scene();
const vista = new VistaMesh(scene, terrain, road, origin);
const camera = road.sampleAt(S);
vista.setViewDistance(25_000);
vista.update(camera.x, camera.z, S);

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

// The inner ring as the camera sees it: the disc stands on its lattice point, up to
// DISC / sqrt 2 off the camera, so its FARTHEST inner vertex is the one that must stay
// under the nearest guaranteed tile edge.
let innerLocal = Infinity;
for (let i = 0; i < positions.length; i += 3) innerLocal = Math.min(innerLocal, Math.hypot(positions[i]!, positions[i + 2]!));
let innerReach = 0;
let coreVertices = 0;
let worstRoadOverdraw = -Infinity;
for (let i = 0; i < positions.length; i += 3) {
  const x = positions[i]! + mesh.position.x;
  const y = positions[i + 1]! + mesh.position.y;
  const z = positions[i + 2]! + mesh.position.z;
  invariant(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `non-finite vertex ${i / 3}`);

  const radius = Math.hypot(x - camera.x, z - camera.z);
  if (Math.hypot(positions[i]!, positions[i + 2]!) < innerLocal + 1) innerReach = Math.max(innerReach, radius);
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
  DESERT_TILE_SIZE - innerReach >= MIN_TILE_OVERLAP - 0.1,
  `vista leaves only ${(DESERT_TILE_SIZE - innerReach).toFixed(2)} m of guaranteed tile overlap`,
);
invariant(coreVertices > 0, 'vista generated no vertices over the road underlay core');
invariant(
  worstRoadOverdraw <= 0,
  `vista rises ${worstRoadOverdraw.toFixed(2)} m above the road`,
);

const rebuilds = 8;
const started = performance.now();
for (let i = 1; i <= rebuilds; i++) {
  vista.update(camera.x + i * SNAP, camera.z, S);
  vista.finishMesaBuild();
}
const meanRebuildMs = (performance.now() - started) / rebuilds;
const steadyCellX = Math.floor((camera.x + rebuilds * SNAP) / SNAP) * SNAP + 1;
vista.update(steadyCellX, camera.z, S);
vista.finishMesaBuild();
// Each update one lattice step on: the disc and mesa rewrite a step costs. Updates
// inside a step cost nothing.
const steadySteps = 12;
const steadyStarted = performance.now();
for (let step = 1; step <= steadySteps; step++) {
  vista.update(steadyCellX + step * DISC, camera.z, S);
}
const meanStepMs = (performance.now() - steadyStarted) / steadySteps;

console.log(
  `vista: ${attribute.count} vertices, inner ring reaches ${innerReach.toFixed(1)} m from the camera, ` +
    `${coreVertices} road-core vertices, worst overdraw ${worstRoadOverdraw.toFixed(2)} m, ` +
    `${meanRebuildMs.toFixed(2)} ms/cell load, ${meanStepMs.toFixed(2)} ms/lattice step`,
);
vista.dispose();

// World-anchored between lattice steps: inside a step nothing moves, the drawn ground at
// a fixed spot included; a step changes that by under a pixel and moving back restores
// it exactly. Lattice points between a cell's corners are linear blends of the corner
// samples, and a cell crossing is a step like any other.
const continuityRoad = new Road(REPORTED_MESA_SEED);
const continuityScene = new THREE.Scene();
const continuityVista = new VistaMesh(
  continuityScene,
  new Terrain(REPORTED_MESA_SEED, continuityRoad),
  continuityRoad,
  new WorldOrigin(),
);
continuityVista.setViewDistance(25_000);
const LANE_Z = 60;
continuityVista.update(3 * DISC, LANE_Z, 0);
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
continuityVista.update(8 * DISC, LANE_Z, 0);
const groundMidpoint = worldPositionSnapshot(continuityGround);
continuityVista.update(13 * DISC, LANE_Z, 0);
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

// Fixed spots at 2, 5 and 10 km in three directions.
const spots: { x: number; z: number }[] = [];
for (const distance of [2_000, 5_000, 10_000]) {
  for (const angle of [0.3, 2.1, 4.0]) {
    spots.push({ x: 125 + Math.sin(angle) * distance, z: LANE_Z + Math.cos(angle) * distance });
  }
}

// Two camera positions on one lattice point (6): nothing moves.
continuityVista.update(6 * DISC - 7, LANE_Z, 0);
const groundBeforeStep = worldPositionSnapshot(continuityGround);
const mesasBeforeStep = worldPositionSnapshot(continuityMesas);
const heightsBeforeStep = drawnHeights(continuityGround, spots);
continuityVista.update(6 * DISC + 7, LANE_Z, 0);
const stillError = Math.max(
  maximumPositionDelta(groundBeforeStep, worldPositionSnapshot(continuityGround)),
  maximumPositionDelta(mesasBeforeStep, worldPositionSnapshot(continuityMesas)),
  largestStepAngle(spots, heightsBeforeStep, drawnHeights(continuityGround, spots), 6 * DISC, LANE_Z),
);
invariant(stillError === 0, `14 m inside one lattice step moved the vista by ${stillError}`);

// One lattice step on: the ground follows, by under a pixel.
continuityVista.update(7 * DISC, LANE_Z, 0);
const heightsAfterStep = drawnHeights(continuityGround, spots);
const stepAngle = largestStepAngle(spots, heightsBeforeStep, heightsAfterStep, 7 * DISC, LANE_Z);
invariant(
  heightsAfterStep.some((height, k) => Math.abs(height - heightsBeforeStep[k]!) > 1e-4),
  'a lattice step leaves the drawn ground where it was',
);
invariant(
  stepAngle < MAX_STEP_ANGLE,
  `a lattice step moves the drawn ground by ${((stepAngle * 180) / Math.PI).toFixed(4)} degrees`,
);
continuityVista.update(6 * DISC, LANE_Z, 0);
const reverseError = maximumPositionDelta(groundBeforeStep, worldPositionSnapshot(continuityGround));
invariant(reverseError < 1e-6, `reversing one lattice step leaves ${reverseError.toFixed(6)} m of drift`);

// Across a cell edge (lattice points 15 and 16): a step like any other.
continuityVista.update(15 * DISC, LANE_Z, 0);
const groundBeforeBoundary = worldPositionSnapshot(continuityGround);
const heightsBeforeBoundary = drawnHeights(continuityGround, spots);
let previousCandidates = mesaCandidateTops(continuityVista, continuityMesas);
checkEdgeHandover(continuityVista, continuityMesas, 16 * DISC, 17 * DISC);
const boundaryAngle = largestStepAngle(
  spots,
  heightsBeforeBoundary,
  drawnHeights(continuityGround, spots),
  16 * DISC,
  LANE_Z,
);
invariant(
  boundaryAngle < MAX_STEP_ANGLE,
  `the vista jumps ${((boundaryAngle * 180) / Math.PI).toFixed(4)} degrees at a cell boundary`,
);

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
continuityVista.update(15 * DISC, LANE_Z, 0);
const boundaryReverseError = maximumPositionDelta(
  groundBeforeBoundary,
  worldPositionSnapshot(continuityGround),
);
invariant(
  boundaryReverseError < 1e-6,
  `reversing across a cell edge leaves ${boundaryReverseError.toFixed(6)} m of drift`,
);
continuityVista.update(16 * DISC, LANE_Z, 0);
continuityVista.finishMesaBuild();
previousCandidates = mesaCandidateTops(continuityVista, continuityMesas);
for (let crossing = 1; crossing <= 20; crossing++) {
  continuityVista.update(16 * DISC + crossing * SNAP, LANE_Z, 0);
  continuityVista.finishMesaBuild();
  const currentCandidates = mesaCandidateTops(continuityVista, continuityMesas);
  residentTransitions += checkResidentTransition(currentCandidates);
  previousCandidates = currentCandidates;
}
invariant(residentTransitions > 0, 'mesa residency check crossed no candidate boundary');

// A metre at a time across a whole cell: the drawn ground changes only where the camera
// crosses onto a new lattice point, sixteen times, each by under a pixel.
const sweepX0 = 40 * SNAP;
continuityVista.update(sweepX0, LANE_Z, 0);
let sweepHeights = drawnHeights(continuityGround, spots);
let sweepChanges = 0;
let sweepAngle = 0;
for (let x = sweepX0 + 1; x < sweepX0 + SNAP; x++) {
  continuityVista.update(x, LANE_Z, 0);
  const heights = drawnHeights(continuityGround, spots);
  if (heights.some((height, k) => height !== sweepHeights[k])) {
    sweepChanges++;
    sweepAngle = Math.max(sweepAngle, largestStepAngle(spots, sweepHeights, heights, x, LANE_Z));
  }
  sweepHeights = heights;
}
invariant(sweepChanges <= 16, `the drawn ground changed ${sweepChanges} times across one 250 m cell`);
invariant(
  sweepAngle < MAX_STEP_ANGLE,
  `a lattice step in the sweep moves the drawn ground by ${((sweepAngle * 180) / Math.PI).toFixed(4)} degrees`,
);
console.log(
  `vista anchoring: still inside a step, largest step ${((stepAngle * 180) / Math.PI).toFixed(4)} deg, ` +
    `${((boundaryAngle * 180) / Math.PI).toFixed(4)} deg at a cell edge, ` +
    `${sweepChanges} changes across a cell in 1 m steps (largest ${((sweepAngle * 180) / Math.PI).toFixed(4)} deg), ` +
    `${reverseError.toFixed(6)} m reverse error, ${boundaryReverseError.toFixed(6)} m boundary reverse error, ` +
    `${residentTransitions} buried residency transitions`,
);

// The other way, -x: from cell 41 into cell 40, whose build starts a step earlier, on
// cell 41's own first lattice point.
const backEdge = 41 * 16 * DISC;
continuityVista.update(backEdge + 2 * DISC, LANE_Z, 0);
continuityVista.finishMesaBuild();
continuityVista.update(backEdge + DISC, LANE_Z, 0);
checkEdgeHandover(continuityVista, continuityMesas, backEdge, backEdge - DISC);
console.log('mesa handover: exact on the shared edge both ways, no rebuild in a crossing frame');
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
mesaVista.update(0, 0, 0);
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
const mesaState = drawnMesas(mesaVista);
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
  if (mesaState.heightOffset[i] !== -3) continue;
  const centreDistance = Math.hypot(
    mesaState.centreXZ[i * 2]!,
    mesaState.centreXZ[i * 2 + 1]!,
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
  // Never above the rendered ground less the skirt's drop; up close it may be lower,
  // held under the exact ground too (`MESA_FOOTING_FULL` in render/vista.ts).
  worstContactError = Math.max(worstContactError, mesaPositions.getY(i) - hit.point.y + 3);
}
invariant(groundedSamples >= 16, `only ${groundedSamples} mesa skirt contacts could be sampled`);
invariant(
  worstContactError < 0.05,
  `mesa skirt floats ${worstContactError.toFixed(2)} m above rendered ground`,
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
for (let i = 0; i < mesaPositions.count; i++) {
  const centreX = mesaState.centreXZ[i * 2]!;
  const centreZ = mesaState.centreXZ[i * 2 + 1]!;
  const key = `${centreX},${centreZ}`;
  const silhouette = silhouettes.get(key) ?? { radius: 0, height: 0 };
  silhouette.radius = Math.max(
    silhouette.radius,
    Math.hypot(mesaPositions.getX(i) - centreX, mesaPositions.getZ(i) - centreZ),
  );
  silhouette.height = Math.max(silhouette.height, mesaState.heightOffset[i]!);
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

// Mesas no longer dissolve: placement keeps them off the road (world/mesas.ts), so one
// the camera drives right up to stays standing at full height, held under the exact
// ground there, and is still there after a retreat and a return.
const approachScene = new THREE.Scene();
const approachTerrain = new Terrain(REPORTED_MESA_SEED, mesaRoad);
const approachVista = new VistaMesh(approachScene, approachTerrain, mesaRoad, new WorldOrigin());
approachVista.setViewDistance(25_000);
approachVista.update(0, 0, 0);
const targetMesa = drawnMesas(approachVista).candidates.find((candidate) => {
  const distance = Math.hypot(candidate.centreX, candidate.centreZ);
  return distance > candidate.radius + 1_500 && distance < 12_000;
});
invariant(targetMesa !== undefined, 'mesa approach check found no suitable candidate');
const approachMesas = approachScene.children.filter(
  (child): child is THREE.Mesh => child instanceof THREE.Mesh,
)[1];
invariant(approachMesas !== undefined, 'mesa approach check has no mesa mesh');
const approachMaterial = approachMesas.material;
invariant(
  !Array.isArray(approachMaterial) && !approachMaterial.alphaHash && !approachMaterial.transparent,
  'mesa material still carries the dissolve transparency',
);
/** The target's plateau and rise as drawn, or null when it is not resident. */
function targetStanding(): { top: number; rise: number; footed: number } | null {
  const drawn = drawnMesas(approachVista);
  const candidate = drawn.candidates.find((c) => c.key === targetMesa!.key);
  if (!candidate) return null;
  const position = approachMesas!.geometry.getAttribute('position');
  invariant(position instanceof THREE.BufferAttribute, 'mesa approach has no positions');
  let low = Infinity;
  let high = -Infinity;
  let footed = 0;
  for (let i = candidate.firstVertex; i < candidate.firstVertex + candidate.vertexCount; i++) {
    low = Math.min(low, position.getY(i));
    high = Math.max(high, position.getY(i));
    if (Number.isFinite(drawn.exactY[i]!)) footed++;
  }
  return { top: high, rise: high - low, footed };
}
const farStanding = targetStanding();
invariant(farStanding !== null && farStanding.footed === 0, 'distant mesa missing or footed');
// The world origin is zero here, so the candidate's centre is its absolute centre.
const targetSite = mesaFieldOf(mesaRoad, approachTerrain)
  .sitesNear(targetMesa.centreX, targetMesa.centreZ, 0, [])
  .find((site) => site.key === targetMesa.key);
invariant(targetSite !== undefined, 'mesa approach target is not a MesaField site');
const targetFooting = mesaFieldOf(mesaRoad, approachTerrain).footing(targetSite);
const exactTop = targetFooting.centreGroundY + targetSite.height * MESA_TOP_HEIGHT;
const targetDistance = Math.hypot(targetMesa.centreX, targetMesa.centreZ);
// Fifty metres outside the footprint, at the foot of the wall.
const nearDistance = targetMesa.radius + 50;
const nearX = targetMesa.centreX - (targetMesa.centreX / targetDistance) * nearDistance;
const nearZ = targetMesa.centreZ - (targetMesa.centreZ / targetDistance) * nearDistance;
approachVista.update(nearX, nearZ, 0);
const nearStanding = targetStanding();
invariant(nearStanding !== null, 'mesa left the vista when the camera reached its foot');
const plateauError = Math.abs(nearStanding.top - exactTop);
invariant(
  nearStanding.footed > 0 && plateauError < 0.05 && approachMesas.visible,
  `mesa at its foot: plateau ${plateauError.toFixed(2)} m off the exact ground, ${nearStanding.footed} footed vertices`,
);
invariant(
  nearStanding.rise >= targetSite.height * MESA_TOP_HEIGHT,
  `mesa at its foot rises only ${nearStanding.rise.toFixed(0)} m of ${targetSite.height.toFixed(0)}`,
);
approachVista.update(0, 0, 0);
approachVista.update(nearX, nearZ, 0);
const revisit = targetStanding();
invariant(
  revisit !== null && Math.abs(revisit.rise - nearStanding.rise) < 0.01,
  'mesa changed after a retreat and a return',
);
console.log(
  `mesa approach: plateau ${nearStanding.top.toFixed(1)} m at 50 m from its footprint, ` +
    `${plateauError.toFixed(3)} m from the exact ground's, rise ${nearStanding.rise.toFixed(0)} m ` +
    `(${farStanding.rise.toFixed(0)} m from afar on the vista's ground), ${nearStanding.footed} vertices ` +
    `on exact ground, unchanged after retreat and return`,
);
approachVista.dispose();
