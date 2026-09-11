/**
 * The fall-out-of-world rescue, against the world it actually has to work in.
 *
 * Reported from play: the road descended, and the car — then the player — were
 * teleported to the middle of the road and pinned there, rear sunk, nose up. The
 * rescue's boundary was an absolute altitude, and this generator puts whole basins
 * below it, so the test was satisfied on solid asphalt and the "rescue" repeated every
 * fixed step. These checks pin both halves: the boundary is measured against the
 * GROUND, and a rescue that does fire leaves the car standing on the road.
 *
 *   bun run tools/rescue-check.ts
 */

import * as THREE from 'three';

import { emptyInput } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState, type CarState } from '../src/game/state';
import type { Item } from '../src/items/items';
import { variant } from '../src/parts/registry';
import { preloadCarModels } from '../src/render/carmodel';
import { createBonnetStorage } from '../src/vehicle/bonnet';
import { COLD_SOAK_C } from '../src/vehicle/cooling';
import { carModel } from '../src/vehicle/carmodels';
import { Vehicle } from '../src/vehicle/vehicle';
import { hasEscapedWorld, UNDERWORLD_DROP_M } from '../src/world/landscape';
import { WorldOrigin } from '../src/world/origin';
import { ROAD_HALF_WIDTH, Road } from '../src/world/road';
import { roadSurfaceY, SurfaceField } from '../src/world/roadsurface';
import { installAssetShim } from './assetshim';

installAssetShim();

const MODEL_ID = 'sv_vaz2105r';
/** Seeds whose road drops into a deep basin, and one that never does. */
const DEEP_SEEDS = [1337, 7, 2024];
const SHALLOW_SEED = 42;
const SCAN_STEP = 50;
const ROAD_STEP = 1;
const RIBBON_HALF_WIDTH = ROAD_HALF_WIDTH + 5;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
}

console.log('rescue check: the underworld boundary and the pose a rescue leaves behind');

// --- 1. The boundary is not an altitude. ---
let lowestRoadY = Infinity;
let deepestRoadSatisfying = 0;
for (const seed of DEEP_SEEDS) {
  const road = new Road(seed);
  for (let s = 0; s < road.length; s += SCAN_STEP) {
    const point = road.sampleAt(s);
    if (point.y < lowestRoadY) lowestRoadY = point.y;
    // A car sitting on the asphalt, one metre up, must never read as fallen.
    if (hasEscapedWorld(road.landscape, point.x, point.y + 1, point.z)) {
      deepestRoadSatisfying++;
    }
  }
}
check(
  'no point of a deep-basin road reads as having escaped',
  deepestRoadSatisfying === 0,
  `${deepestRoadSatisfying} road samples flagged, lowest road altitude ${lowestRoadY.toFixed(0)} m`,
);

const shallowRoad = new Road(SHALLOW_SEED);
const shallowPoint = shallowRoad.sampleAt(1_000);
check(
  'a body far under the ground still reads as escaped',
  hasEscapedWorld(
    shallowRoad.landscape,
    shallowPoint.x,
    shallowPoint.y - UNDERWORLD_DROP_M - 1,
    shallowPoint.z,
  ) &&
    hasEscapedWorld(shallowRoad.landscape, shallowPoint.x, Number.NaN, shallowPoint.z) &&
    !hasEscapedWorld(
      shallowRoad.landscape,
      shallowPoint.x,
      shallowPoint.y - UNDERWORLD_DROP_M + 1,
      shallowPoint.z,
    ),
  `${UNDERWORLD_DROP_M} m below ground, and a NaN pose, both flagged; one metre short of it is not`,
);

// --- 2. A rescue that fires leaves the car on the road, on a grade. ---
await preloadCarModels([MODEL_ID]);

/** Steepest descent on a road stretch that also sits deep below zero altitude. */
function steepestDescent(road: Road, from: number, to: number): { s: number; grade: number } {
  let worst = { s: from, grade: 0 };
  for (let s = from; s < to; s += 4) {
    const sample = road.sampleAt(s);
    if (sample.grade < worst.grade) worst = { s, grade: sample.grade };
  }
  return worst;
}

function carStateAt(road: Road, s: number, lateral: number): CarState {
  const def = carModel(MODEL_ID);
  const engine = variant(def.engineId).engine;
  const point = road.offsetPoint(s, lateral);
  const heading = road.sampleAt(s).heading;
  return {
    id: 'rescue-check', modelId: MODEL_ID, gizmos: {}, stickers: [],
    headlightMode: 'off', taillightsOn: false, reverseLightsOn: false,
    fuelLitres: 40, fuelKind: engine?.fuel ?? null, dirt: 0, scratches: 0, damage: [],
    waterLitres: 10, oilLitres: 10, engineTempC: COLD_SOAK_C,
    storage: new Array<Item | null>(def.storageCells).fill(null),
    bonnet: createBonnetStorage('rescue-check', def.engineId, def.bodyClass, def.tankLitres),
    odometer: 0,
    x: point.x, y: point.y + 1.2, z: point.z,
    qx: 0, qy: Math.sin(heading / 2), qz: 0, qw: Math.cos(heading / 2),
  };
}

const seed = 1337;
const road = new Road(seed);
const field = new SurfaceField(seed);
const deepFrom = 200_000;
const worst = steepestDescent(road, deepFrom, deepFrom + 40_000);
const physics = await PhysicsWorld.create();
const world = new GameWorld(newWorldState(seed));
const origin = new WorldOrigin();
// Rapier holds ORIGIN-RELATIVE positions, so the probe ribbon must be written in the
// same frame the vehicle will be: 200 km of absolute coordinate is also more than f32
// can carry at centimetre resolution.
const originAt = road.sampleAt(worst.s);
origin.reset(originAt.x, originAt.z);
const condition = { surface: SurfaceType.Asphalt, decay: 0, sandCover: 0 };
const point = { x: 0, y: 0, z: 0 };
for (let chunkFrom = worst.s - 60; chunkFrom < worst.s + 60; chunkFrom += 100) {
  const chunkTo = Math.min(worst.s + 60, chunkFrom + 100);
  const rows = Math.ceil((chunkTo - chunkFrom) / ROAD_STEP) + 1;
  const vertices = new Float32Array(rows * 6);
  for (let row = 0; row < rows; row++) {
    const s = Math.min(chunkTo, chunkFrom + row * ROAD_STEP);
    for (let side = 0; side < 2; side++) {
      const lateral = side === 0 ? -RIBBON_HALF_WIDTH : RIBBON_HALF_WIDTH;
      road.offsetPoint(s, lateral, point);
      vertices[(row * 2 + side) * 3] = point.x - origin.x;
      vertices[(row * 2 + side) * 3 + 1] = roadSurfaceY(road, field, s, lateral, point.x, point.z);
      vertices[(row * 2 + side) * 3 + 2] = point.z - origin.z;
    }
  }
  const indices = new Uint32Array((rows - 1) * 6);
  for (let row = 0, i = 0; row < rows - 1; row++) {
    const a = row * 2;
    indices[i++] = a; indices[i++] = a + 2; indices[i++] = a + 1;
    indices[i++] = a + 2; indices[i++] = a + 3; indices[i++] = a + 1;
  }
  road.conditionAt((chunkFrom + chunkTo) * 0.5, condition);
  physics.addStaticTrimesh(vertices, indices, condition.surface);
}

const state = carStateAt(road, worst.s, -ROAD_HALF_WIDTH / 2);
world.state.cars[state.id] = state;
const vehicle = new Vehicle(physics, world, state, new THREE.Scene(), origin);
const input = emptyInput();

// The rescue, exactly as main.ts performs it.
const roadPoint = road.sampleAt(worst.s);
vehicle.rescueTo(
  roadPoint.x,
  roadPoint.y - vehicle.contactPlaneLocalY,
  roadPoint.z,
  roadPoint.heading,
  roadPoint.grade,
);

/**
 * Penetration of the body's lowest fore and aft corners into the asphalt, in the pose
 * the rescue leaves — before any physics step. That is what the reported pose was:
 * rear sunk, nose up. A body placed LEVEL on a grade is buried by half its length
 * times the grade, and the solver's answer to that is to shove it somewhere.
 */
const cornerPenetration = (): number => {
  const translation = vehicle.chassis.translation();
  const rotation = vehicle.chassis.rotation();
  const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  const half = vehicle.modelMeasure.halfExtents;
  let deepest = 0;
  for (const along of [-half[2], half[2]]) {
    const corner = new THREE.Vector3(0, vehicle.contactPlaneLocalY, along)
      .applyQuaternion(quaternion)
      .add(new THREE.Vector3(translation.x + origin.x, translation.y, translation.z + origin.z));
    const here = road.project(corner.x, corner.z, worst.s);
    const surface = roadSurfaceY(road, field, here.s, here.lateral, corner.x, corner.z);
    deepest = Math.max(deepest, surface - corner.y);
  }
  return deepest;
};
const placedPenetration = cornerPenetration();

const position = new THREE.Vector3();
let escapedAfterRescue = false;
for (let i = 0; i < Math.ceil(2 / FIXED_DT); i++) {
  vehicle.fixedUpdate(FIXED_DT, input);
  physics.step();
  vehicle.postStep();
  vehicle.absoluteTranslation(position);
  if (hasEscapedWorld(road.landscape, position.x, position.y, position.z)) {
    escapedAfterRescue = true;
  }
}
vehicle.absoluteTranslation(position);
const settled = road.project(position.x, position.z, worst.s);
const settledPenetration = cornerPenetration();

check(
  'a rescue on a steep grade places the car along the road',
  placedPenetration < 0.05,
  `${(worst.grade * 100).toFixed(0)}% grade at ${roadPoint.y.toFixed(0)} m altitude, ` +
    `corner into the asphalt ${(placedPenetration * 100).toFixed(1)} cm as placed, ` +
    `${(settledPenetration * 100).toFixed(1)} cm settled`,
);
check(
  'a rescued car does not immediately read as fallen again',
  !escapedAfterRescue,
  `settled at lateral ${settled.lateral.toFixed(2)} m, altitude ${position.y.toFixed(0)} m`,
);

vehicle.dispose();
physics.world.free();
console.log(failures === 0 ? '\nall rescue checks passed' : `\n${failures} rescue check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
