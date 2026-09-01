/**
 * Deterministic real-autopilot road-driving harness.
 *
 * This defends the fixed-step contract between Autopilot, Road, Vehicle and hazards:
 * a controller that merely writes plausible inputs, but cannot keep a real car on a
 * curved road, make progress, respect an obstacle, or release human controls fails.
 * The collider is a procedural strip sampled from the real Road and its real surface
 * field, rather than a flat plane: that keeps the car on the same grade and curve the
 * controller projects against without requiring browser-only road texture canvases.
 */

import * as THREE from 'three';
import { emptyInput, type InputFrame } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState, type CarState } from '../src/game/state';
import type { Item } from '../src/items/items';
import { variant } from '../src/parts/registry';
import { preloadCarModels } from '../src/render/carmodel';
import { createBonnetStorage } from '../src/vehicle/bonnet';
import { Autopilot, type AutopilotMode } from '../src/vehicle/autopilot';
import { carModel } from '../src/vehicle/carmodels';
import { Vehicle } from '../src/vehicle/vehicle';
import { HazardIndex, type RoadHazard } from '../src/world/hazards';
import { WorldOrigin } from '../src/world/origin';
import { ROAD_HALF_WIDTH, Road, SHOULDER_WIDTH } from '../src/world/road';
import { roadSurfaceY, SurfaceField } from '../src/world/roadsurface';

class BunProgressEvent extends Event implements ProgressEvent {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
  constructor(type: string, init: ProgressEventInit = {}) {
    super(type, init);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}
if (globalThis.ProgressEvent === undefined) globalThis.ProgressEvent = BunProgressEvent;

const MODEL_ID = 'proc_wedge';
const START_S = 1_000;
const ROUTE_METRES = 3_600;
const ROAD_STEP = 1;
const MODES: Record<AutopilotMode, { cruise: number; lateralAccel: number }> = {
  sleeper: { cruise: 20, lateralAccel: 5.1 },
  frantic: { cruise: 28, lateralAccel: 6.7 },
};
let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(48)} ${detail}`);
}

function carState(road: Road): CarState {
  const def = carModel(MODEL_ID);
  const engine = variant(def.engineId).engine;
  const p = road.sampleAt(START_S);
  return {
    id: 'autopilot-bench', modelId: MODEL_ID, gizmos: {}, stickers: [],
    headlightMode: 'off', taillightsOn: false, reverseLightsOn: false,
    fuelLitres: 40, fuelKind: engine?.fuel ?? null, dirt: 0, scratches: 0,
    coolantLitres: 10, oilLitres: 10,
    storage: new Array<Item | null>(def.storageCells).fill(null),
    bonnet: createBonnetStorage('autopilot-bench', def.engineId, def.bodyClass, def.tankLitres),
    odometer: 0, x: p.x, y: p.y + 1.2, z: p.z,
    qx: 0, qy: Math.sin(p.heading / 2), qz: 0, qw: Math.cos(p.heading / 2),
  };
}

/** Builds only the real, narrow asphalt ribbon needed by this run; no visual mesh needed. */
function addRoadCollider(physics: PhysicsWorld, road: Road, from: number, to: number): void {
  const field = new SurfaceField(road.seed);
  const rows = Math.ceil((to - from) / ROAD_STEP) + 1;
  const vertices = new Float32Array(rows * 6);
  const point = { x: 0, y: 0, z: 0 };
  for (let row = 0; row < rows; row++) {
    const s = Math.min(to, from + row * ROAD_STEP);
    for (let side = 0; side < 2; side++) {
      // Asphalt PLUS shoulder. The avoidance policy is allowed to use the shoulder as
      // a last resort, so a ribbon that stops at the asphalt edge would drop the car
      // into the void the first time it did — measured, 22 m off the road.
      const lateral = side === 0 ? -(ROAD_HALF_WIDTH + SHOULDER_WIDTH) : ROAD_HALF_WIDTH + SHOULDER_WIDTH;
      road.offsetPoint(s, lateral, point);
      const i = (row * 2 + side) * 3;
      vertices[i] = point.x;
      vertices[i + 1] = roadSurfaceY(road, field, s, lateral, point.x, point.z);
      vertices[i + 2] = point.z;
    }
  }
  const indices = new Uint32Array((rows - 1) * 6);
  for (let row = 0, i = 0; row < rows - 1; row++) {
    const a = row * 2;
    indices[i++] = a; indices[i++] = a + 2; indices[i++] = a + 1;
    indices[i++] = a + 2; indices[i++] = a + 3; indices[i++] = a + 1;
  }
  physics.addStaticTrimesh(vertices, indices, SurfaceType.Asphalt);
}

interface Rig { physics: PhysicsWorld; vehicle: Vehicle; road: Road; hazards: HazardIndex; autopilot: Autopilot; input: InputFrame; }

async function makeRig(): Promise<Rig> {
  const road = new Road(42);
  const physics = await PhysicsWorld.create();
  addRoadCollider(physics, road, START_S - 40, START_S + ROUTE_METRES + 400);
  const world = new GameWorld(newWorldState(42));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const state = carState(road);
  world.state.cars[state.id] = state;
  const vehicle = new Vehicle(physics, world, state, scene, origin);
  const hazards = new HazardIndex();
  const autopilot = new Autopilot(road, hazards, physics);
  const input = emptyInput();
  for (let i = 0; i < 180; i++) {
    vehicle.fixedUpdate(FIXED_DT, input); physics.step(); vehicle.postStep();
  }
  return { physics, vehicle, road, hazards, autopilot, input };
}

function step(rig: Rig): void {
  rig.autopilot.drive(FIXED_DT, rig.vehicle, rig.input, 0, 0);
  rig.vehicle.fixedUpdate(FIXED_DT, rig.input);
  rig.physics.step();
  rig.vehicle.postStep();
}

function speed(vehicle: Vehicle): number {
  const v = vehicle.chassis.linvel();
  return Math.hypot(v.x, v.z);
}

interface DriveMetrics { meanSpeed: number; meanLateral: number; maxLateral: number; rmsLateral: number; signChangesPerKm: number; progress: number; monotonic: boolean; tightRadius: number; tightSpeed: number; }

async function measureMode(mode: AutopilotMode): Promise<DriveMetrics> {
  const rig = await makeRig();
  rig.autopilot.setMode(mode);
  rig.autopilot.setEngaged(true);
  let previousS = -Infinity;
  let monotonic = true;
  let startS = 0;
  let sumSpeed = 0;
  let sumLateralSq = 0;
  let sumLateral = 0;
  let maxLateral = 0;
  let samples = 0;
  let signChanges = 0;
  let previousSign = 0;
  let tightCurvature = 0;
  let tightSpeed = 0;
  const maxSteps = Math.ceil(360 / FIXED_DT);
  for (let i = 0; i < maxSteps; i++) {
    step(rig);
    const p = rig.road.project(rig.vehicle.absoluteTranslation({ x: 0, y: 0, z: 0 }).x, rig.vehicle.absoluteTranslation({ x: 0, y: 0, z: 0 }).z, previousS < 0 ? START_S : previousS);
    if (i === 0) startS = p.s;
    if (p.s + 0.03 < previousS) monotonic = false;
    previousS = p.s;
    const lateral = Math.abs(p.lateral);
    const sign = Math.abs(p.lateral) > 0.15 ? Math.sign(p.lateral) : 0;
    if (sign && previousSign && sign !== previousSign) signChanges++;
    if (sign) previousSign = sign;
    const v = speed(rig.vehicle);
    sumSpeed += v; sumLateral += lateral; sumLateralSq += p.lateral * p.lateral; maxLateral = Math.max(maxLateral, lateral); samples++;
    const curvature = Math.abs(rig.road.sampleAt(p.s).curvature);
    if (curvature > tightCurvature) { tightCurvature = curvature; tightSpeed = v; }
    if (p.s >= START_S + ROUTE_METRES) break;
  }
  const progress = previousS - startS;
  return { meanSpeed: sumSpeed / samples, meanLateral: sumLateral / samples, maxLateral, rmsLateral: Math.sqrt(sumLateralSq / samples), signChangesPerKm: signChanges / Math.max(progress / 1000, 0.001), progress, monotonic, tightRadius: 1 / Math.max(tightCurvature, 1e-9), tightSpeed };
}

/**
 * One hazard per run, deliberately.
 *
 * Both in the same run cannot work: a car that correctly refuses to pass a blocked
 * road never reaches the second hazard, so the breakable check would only ever be
 * measuring the first one's success.
 */
async function driveHazard(
  hazard: RoadHazard,
  seconds: number,
): Promise<{
  minDistance: number;
  speedAtClosest: number;
  minSpeedNear: number;
  approachGap: number;
  approachSpeed: number;
  passed: boolean;
  rig: Rig;
  worstLateral: number;
  chunk: string;
}> {
  const rig = await makeRig();
  rig.autopilot.setEngaged(true);
  const chunk = 'autopilot-bench-hazards';
  rig.hazards.add(chunk, hazard);
  let minDistance = Infinity;
  let speedAtClosest = 0;
  let minSpeedNear = Infinity;
  let approachGap = Infinity;
  let approachSpeed = 0;
  let worstLateral = 0;
  let passed = false;
  // The projection hint MUST be carried. `project` searches locally around it, so a
  // fixed hint saturates a couple of hundred metres out and every distance measured
  // against a hazard further along the route silently freezes.
  let hint = START_S;
  for (let i = 0; i < Math.ceil(seconds / FIXED_DT); i++) {
    step(rig);
    const pos = rig.vehicle.absoluteTranslation({ x: 0, y: 0, z: 0 });
    const p = rig.road.project(pos.x, pos.z, hint);
    hint = p.s;
    const v = speed(rig.vehicle);
    worstLateral = Math.max(worstLateral, Math.abs(p.lateral));
    // Clearance is only meaningful ALONGSIDE the hazard: a Euclidean (s, lateral)
    // distance measured from 200 m back reports the approach, not the pass.
    if (Math.abs(p.s - hazard.s) < 3) {
      const clearance = Math.abs(p.lateral - hazard.lateral);
      if (clearance < minDistance) {
        minDistance = clearance;
        speedAtClosest = v;
      }
    }
    if (Math.abs(p.s - hazard.s) < 8) minSpeedNear = Math.min(minSpeedNear, v);
    // Never got alongside it: record how close the approach came, so a car that
    // stopped short reports its stopping distance rather than an empty Infinity.
    if (!passed && p.s < hazard.s) {
      approachGap = Math.min(approachGap, hazard.s - p.s);
      approachSpeed = v;
    }
    if (p.s > hazard.s + 15) {
      passed = true;
      break;
    }
  }
  return { minDistance, speedAtClosest, minSpeedNear, approachGap, approachSpeed, worstLateral, passed, rig, chunk };
}

async function checkHazards(): Promise<void> {
  // A rock the width of the lane's centre: passable, but only by moving over.
  const rock = await driveHazard({ s: START_S + 300, lateral: 0, radius: 1.2, breakable: false }, 100);
  check(
    'non-breakable hazard is cleared, never driven through',
    rock.passed && rock.minDistance >= 1.2,
    `passed=${rock.passed}, clearance ${rock.minDistance.toFixed(2)} m at ${rock.speedAtClosest.toFixed(2)} m/s, closest approach ${rock.approachGap.toFixed(2)} m at ${rock.approachSpeed.toFixed(2)} m/s`,
  );
  check(
    'avoiding it does not put the car off the road',
    rock.worstLateral <= ROAD_HALF_WIDTH + SHOULDER_WIDTH,
    `worst |lateral| ${rock.worstLateral.toFixed(2)} m against a ${(ROAD_HALF_WIDTH + SHOULDER_WIDTH).toFixed(2)} m edge`,
  );
  const wall = await driveHazard({ s: START_S + 300, lateral: 0, radius: 6, breakable: false }, 100);
  check(
    'impassable hazard stops the car short of it',
    !wall.passed && wall.approachGap > 6 && wall.approachSpeed < 2,
    `stopped ${wall.approachGap.toFixed(2)} m short at ${wall.approachSpeed.toFixed(2)} m/s, passed=${wall.passed}`,
  );
  // A dirt pile: driven through, lifting off but never stopping.
  const pile = await driveHazard({ s: START_S + 300, lateral: 0, radius: 1.2, breakable: true }, 100);
  check(
    'breakable hazard is driven through without stopping',
    pile.passed && pile.minSpeedNear > 1,
    `passed=${pile.passed}, near-hazard minimum ${pile.minSpeedNear.toFixed(2)} m/s`,
  );
  // Unloading the chunk must give the road back.
  wall.rig.hazards.forget(wall.chunk);
  let resumed = false;
  for (let i = 0; i < Math.ceil(20 / FIXED_DT); i++) {
    step(wall.rig);
    if (speed(wall.rig.vehicle) > 16) resumed = true;
  }
  check(
    'forget removes hazards and cruise resumes',
    resumed,
    `speed after forget ${speed(wall.rig.vehicle).toFixed(2)} m/s`,
  );
}

function checkHandover(): void {
  const road = new Road(42);
  const autopilot = new Autopilot(road, new HazardIndex());
  const input = { ...emptyInput(), throttle: 0.37, brake: 0.19, reverse: true, steer: -0.42, handbrake: true, shift: 1 };
  const before = JSON.stringify(input);
  autopilot.drive(FIXED_DT, {} as Vehicle, input, 0, 0);
  check('disengaged autopilot leaves human frame untouched', JSON.stringify(input) === before, JSON.stringify(input));
}

async function run(): Promise<void> {
  await preloadCarModels([MODEL_ID]);
  console.log('autopilot bench: real Road surface collider, procedural wedge, fixed 60 Hz');
  checkHandover();
  const sleeper = await measureMode('sleeper');
  const frantic = await measureMode('frantic');
  for (const [mode, result] of [['sleeper', sleeper], ['frantic', frantic]] as const) {
    const config = MODES[mode];
    const cornerLimit = Math.sqrt(config.lateralAccel * result.tightRadius);
    check(`${mode}: stays on asphalt`, result.maxLateral <= ROAD_HALF_WIDTH, `mean/RMS/worst lateral ${result.meanLateral.toFixed(2)}/${result.rmsLateral.toFixed(2)}/${result.maxLateral.toFixed(2)} m`);
    check(`${mode}: does not oscillate across lane`, result.signChangesPerKm < 18, `${result.signChangesPerKm.toFixed(1)} sign changes/km (18 bound: a correction every 56 m)`);
    // The route loop breaks ON reaching the target, so the last sample lands a metre
    // or two short of it by construction.
    check(`${mode}: makes monotonic road progress`, result.monotonic && result.progress >= ROUTE_METRES - 5, `${result.progress.toFixed(0)} m, monotonic=${result.monotonic}`);
    check(`${mode}: holds useful cruise speed`, result.meanSpeed >= config.cruise * 0.55 && result.meanSpeed <= config.cruise * 1.15, `${result.meanSpeed.toFixed(2)} m/s vs ${config.cruise.toFixed(0)} m/s target`);
    check(`${mode}: slows for tightest corner`, result.tightSpeed <= cornerLimit + 3, `radius ${result.tightRadius.toFixed(1)} m, ${result.tightSpeed.toFixed(2)} m/s vs ${cornerLimit.toFixed(2)} m/s limit`);
  }
  check('frantic is materially faster than sleeper', frantic.meanSpeed >= sleeper.meanSpeed + 3, `${frantic.meanSpeed.toFixed(2)} vs ${sleeper.meanSpeed.toFixed(2)} m/s`);
  await checkHazards();
  if (failures) process.exitCode = 1;
}

void run();
