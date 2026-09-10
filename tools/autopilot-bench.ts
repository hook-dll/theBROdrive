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
import { COLD_SOAK_C } from '../src/vehicle/cooling';
import { Autopilot, AUTOPILOT_MODES, type AutopilotMode } from '../src/vehicle/autopilot';
import { carModel } from '../src/vehicle/carmodels';
import { Vehicle } from '../src/vehicle/vehicle';
import { HazardIndex, type RoadHazard } from '../src/world/hazards';
import { WorldOrigin } from '../src/world/origin';
import { ROAD_HALF_WIDTH, Road } from '../src/world/road';
import { roadSurfaceY, SurfaceField } from '../src/world/roadsurface';
import { installAssetShim } from './assetshim';

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
// Every catalogue model is an imported body now, so the bench loads real FBX files
// off disk rather than building its car in code.
installAssetShim();

const MODEL_ID = 'sv_vaz2105r';
const START_S = 1_000;
const ROUTE_METRES = 3_600;
const ROAD_STEP = 1;
/**
 * Ordinary passing still uses the 1.2 m verge. Indexed props may use four metres of
 * graded shoulder, matching `STATIC_AVOID_VERGE_M`; the collider extends past that
 * envelope so the outer wheels remain supported.
 */
const PASSING_VERGE = 1.2;
const PASSING_EDGE = ROAD_HALF_WIDTH + PASSING_VERGE;
const STATIC_AVOID_EDGE = ROAD_HALF_WIDTH + 4;
const PLANNED_CLEARANCE_M = 1.05 + 0.4;
const RIBBON_HALF_WIDTH = STATIC_AVOID_EDGE + 1;
// The tuning is the shipped table, never a copy: this bench's own numbers had
// drifted to a lateral budget 40% above the autopilot's, so every corner-speed
// check was passing against a limit the car never used.
const MODES = AUTOPILOT_MODES;
let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(48)} ${detail}`);
}

function carState(road: Road, startS: number): CarState {
  const def = carModel(MODEL_ID);
  const engine = variant(def.engineId).engine;
  const p = road.sampleAt(startS);
  return {
    id: 'autopilot-bench', modelId: MODEL_ID, gizmos: {}, stickers: [],
    headlightMode: 'off', taillightsOn: false, reverseLightsOn: false,
    fuelLitres: 40, fuelKind: engine?.fuel ?? null, dirt: 0, scratches: 0, damage: [],
    waterLitres: 10, oilLitres: 10,
    engineTempC: COLD_SOAK_C,
    storage: new Array<Item | null>(def.storageCells).fill(null),
    bonnet: createBonnetStorage('autopilot-bench', def.engineId, def.bodyClass, def.tankLitres),
    odometer: 0, x: p.x, y: p.y + 1.2, z: p.z,
    qx: 0, qy: Math.sin(p.heading / 2), qz: 0, qw: Math.cos(p.heading / 2),
  };
}

/** Builds only the real, narrow asphalt ribbon needed by this run; no visual mesh needed. */
function addRoadCollider(physics: PhysicsWorld, road: Road, from: number, to: number): void {
  const field = new SurfaceField(road.seed);
  const condition = { surface: SurfaceType.Asphalt, decay: 0, sandCover: 0 };
  const chunkMetres = 100;
  const point = { x: 0, y: 0, z: 0 };
  for (let chunkFrom = from; chunkFrom < to; chunkFrom += chunkMetres) {
    const chunkTo = Math.min(to, chunkFrom + chunkMetres);
    const rows = Math.ceil((chunkTo - chunkFrom) / ROAD_STEP) + 1;
    const vertices = new Float32Array(rows * 6);
    for (let row = 0; row < rows; row++) {
      const s = Math.min(chunkTo, chunkFrom + row * ROAD_STEP);
      for (let side = 0; side < 2; side++) {
        // The ribbon reaches PAST the asphalt on purpose. The autopilot is allowed a
        // wheel on the verge to squeeze past a boulder (PASSING_VERGE_M in
        // autopilot.ts), and in the game the desert collider is flush with the asphalt
        // edge; a bench ribbon that stopped at the paint dropped every excursion into
        // the void and reported it as an autopilot that could not hold a line.
        const lateral = side === 0 ? -RIBBON_HALF_WIDTH : RIBBON_HALF_WIDTH;
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
    road.conditionAt((chunkFrom + chunkTo) * 0.5, condition);
    physics.addStaticTrimesh(vertices, indices, condition.surface);
  }
}

interface Rig { physics: PhysicsWorld; vehicle: Vehicle; road: Road; hazards: HazardIndex; autopilot: Autopilot; input: InputFrame; }

async function makeRig(
  startS = START_S,
  routeMetres = ROUTE_METRES,
  hazards?: HazardIndex,
): Promise<Rig> {
  const road = new Road(42);
  const physics = await PhysicsWorld.create();
  addRoadCollider(physics, road, startS - 40, startS + routeMetres + 400);
  const world = new GameWorld(newWorldState(42));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const state = carState(road, startS);
  world.state.cars[state.id] = state;
  const vehicle = new Vehicle(physics, world, state, scene, origin);
  const hazardIndex = hazards ?? new HazardIndex();
  const autopilot = new Autopilot(road, hazardIndex, physics);
  const input = emptyInput();
  // Settle ON THE BRAKES: three seconds of suspension settling with no pedal lets
  // the car roll away down the road's own gradient, and every metric measured from
  // START_S then starts from somewhere else.
  input.handbrake = true;
  for (let i = 0; i < 180; i++) {
    vehicle.fixedUpdate(FIXED_DT, input); physics.step(); vehicle.postStep();
  }
  input.handbrake = false;
  return { physics, vehicle, road, hazards: hazardIndex, autopilot, input };
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

const LOOSE_START_S = 12_250;
const LOOSE_ROUTE_METRES = 1_000;

interface LooseSurfaceMetrics {
  meanSpeed: number;
  peakSpeed: number;
  maxLateral: number;
  progress: number;
  monotonic: boolean;
  allGravel: boolean;
}

async function measureLooseSurface(mode: AutopilotMode): Promise<LooseSurfaceMetrics> {
  const rig = await makeRig(LOOSE_START_S, LOOSE_ROUTE_METRES);
  rig.autopilot.setMode(mode);
  rig.autopilot.setEngaged(true);
  const condition = { surface: SurfaceType.Asphalt, decay: 0, sandCover: 0 };
  let previousS = LOOSE_START_S;
  let startS = LOOSE_START_S;
  let sumSpeed = 0;
  let peakSpeed = 0;
  let maxLateral = 0;
  let samples = 0;
  let monotonic = true;
  let allGravel = true;
  for (let i = 0; i < Math.ceil(180 / FIXED_DT); i++) {
    step(rig);
    const position = rig.vehicle.absoluteTranslation({ x: 0, y: 0, z: 0 });
    const projection = rig.road.project(position.x, position.z, previousS);
    if (i === 0) startS = projection.s;
    if (i >= 2 / FIXED_DT && projection.s + 0.25 < previousS) monotonic = false;
    previousS = projection.s;
    rig.road.conditionAt(projection.s, condition);
    allGravel &&= condition.surface === SurfaceType.Gravel;
    maxLateral = Math.max(maxLateral, Math.abs(projection.lateral));
    if (i >= 5 / FIXED_DT) {
      const currentSpeed = speed(rig.vehicle);
      sumSpeed += currentSpeed;
      peakSpeed = Math.max(peakSpeed, currentSpeed);
      samples++;
    }
    if (projection.s >= LOOSE_START_S + LOOSE_ROUTE_METRES) break;
  }
  return {
    meanSpeed: sumSpeed / Math.max(samples, 1),
    peakSpeed,
    maxLateral,
    progress: previousS - startS,
    monotonic,
    allGravel,
  };
}

/**
 * One hazard per run, deliberately.
 *
 * Both in the same run cannot work: a car that correctly refuses to pass a blocked
 * road never reaches the second hazard, so the breakable check would only ever be
 * measuring the first one's success.
 */
function addHazardCollider(rig: Rig, hazard: RoadHazard): void {
  const point = rig.road.offsetPoint(hazard.s, hazard.lateral);
  const body = rig.physics.world.createRigidBody(
    rig.physics.rapier.RigidBodyDesc.fixed().setTranslation(
      point.x,
      point.y + 1,
      point.z,
    ),
  );
  rig.physics.world.createCollider(
    rig.physics.rapier.ColliderDesc.cylinder(1, hazard.radius).setFriction(0.9),
    body,
  );
}

async function driveHazard(
  hazard: RoadHazard,
  seconds: number,
): Promise<{
  minDistance: number;
  speedAtClosest: number;
  commandedAtClosest: number;
  closestLateral: number;
  minSpeedNear: number;
  approachGap: number;
  approachSpeed: number;
  /** Fastest and slowest the car went within 15 m of the hazard's edge. */
  chargeSpeed: number;
  restSpeed: number;
  passed: boolean;
  rejoined: boolean;
  recoveryStarts: number;
  thirdRecoveryAt: number;
  rig: Rig;
  worstLateral: number;
  chunk: string;
}> {
  const hazards = new HazardIndex();
  const chunk = 'autopilot-bench-hazards';
  hazards.add(chunk, hazard);
  const rig = await makeRig(START_S, ROUTE_METRES, hazards);
  rig.autopilot.setTrafficRecoveryPolicy(true);
  rig.autopilot.setEngaged(true);
  addHazardCollider(rig, hazard);
  let minDistance = Infinity;
  let speedAtClosest = 0;
  let commandedAtClosest = 0;
  let closestLateral = 0;
  let minSpeedNear = Infinity;
  let approachGap = Infinity;
  let approachSpeed = 0;
  let chargeSpeed = 0;
  let restSpeed = Infinity;
  let worstLateral = 0;
  let passed = false;
  let rejoined = false;
  let recoveryStarts = 0;
  let thirdRecoveryAt = Infinity;
  let wasRecovering = false;
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
    const recovering = rig.autopilot.activity === 'recover';
    if (recovering && !wasRecovering) {
      recoveryStarts++;
      if (recoveryStarts === 3) thirdRecoveryAt = i * FIXED_DT;
    }
    wasRecovering = recovering;
    worstLateral = Math.max(worstLateral, Math.abs(p.lateral));
    // Clearance is only meaningful ALONGSIDE the hazard: a Euclidean (s, lateral)
    // distance measured from 200 m back reports the approach, not the pass.
    if (Math.abs(p.s - hazard.s) < 3) {
      const clearance = Math.abs(p.lateral - hazard.lateral);
      if (clearance < minDistance) {
        minDistance = clearance;
        speedAtClosest = v;
        commandedAtClosest = rig.autopilot.commandedLine;
        closestLateral = p.lateral;
      }
    }
    if (Math.abs(p.s - hazard.s) < 8) minSpeedNear = Math.min(minSpeedNear, v);
    // Never got alongside it: record how close the approach came, so a car that
    // stopped short reports its stopping distance rather than an empty Infinity.
    if (!passed && p.s < hazard.s) {
      approachGap = Math.min(approachGap, hazard.s - p.s);
      approachSpeed = v;
      // Both measured from the hazard's EDGE, not its centre: a 6 m boulder's
      // braking envelope is still 7 m/s twenty metres from the middle of it.
      if (hazard.s - p.s < hazard.radius + 15) {
        chargeSpeed = Math.max(chargeSpeed, v);
        restSpeed = Math.min(restSpeed, v);
      }
    }
    if (p.s > hazard.s + 15) passed = true;
    if (
      passed &&
      p.s > hazard.s + 60 &&
      Math.abs(p.lateral - MODES.sleeper.laneOffset) < 0.35
    ) {
      rejoined = true;
      break;
    }
  }
  return {
    minDistance,
    speedAtClosest,
    commandedAtClosest,
    closestLateral,
    minSpeedNear,
    approachGap,
    approachSpeed,
    chargeSpeed,
    restSpeed,
    passed,
    rejoined,
    recoveryStarts,
    thirdRecoveryAt,
    rig,
    worstLateral,
    chunk,
  };
}

interface LitterMetrics {
  lineSignChangesPerKm: number;
  lineDirectionReversalsPerKm: number;
  steerRms: number;
  worstSteer: number;
  worstLateral: number;
  meanSpeed: number;
  progress: number;
  monotonic: boolean;
}

function litteredHazards(): RoadHazard[] {
  const hazards: RoadHazard[] = [];
  // ScatterProvider places about one in-asphalt prop at a time: 30–60 m leaves only
  // 1.5–3 seconds between them at cruise, matching that live-road density.
  const laterals = [0, -2.9, 2.9, -1.35, 1.35, 0, 2.7, -2.7, 0.75, -0.75];
  let s = START_S + 120;
  for (let i = 0; s < START_S + 1_800; i++) {
    // The index pattern is deliberately fixed: centre rocks demand a detour, verge
    // rocks exercise corridor rejection, and dirt piles cover the breakable variant.
    hazards.push({
      s,
      lateral: laterals[i % laterals.length],
      radius: 0.6 + ((i * 7) % 13) / 10,
      breakable: i % 3 === 1,
    });
    s += 30 + ((i * 17 + 11) % 31);
  }
  return hazards;
}

async function driveLitteredRoad(mode: AutopilotMode): Promise<LitterMetrics> {
  const rig = await makeRig();
  rig.autopilot.setMode(mode);
  rig.autopilot.setEngaged(true);
  const chunk = 'autopilot-bench-littered-road';
  for (const hazard of litteredHazards()) rig.hazards.add(chunk, hazard);

  let previousS = START_S;
  let startS = 0;
  let monotonic = true;
  let sumSteerSq = 0;
  let worstSteer = 0;
  let worstLateral = 0;
  let sumSpeed = 0;
  let samples = 0;
  let previousLine = 0;
  let previousLineSign = 0;
  let previousDirection = 0;
  let lineSignChanges = 0;
  let lineDirectionReversals = 0;
  // `appliedLateral` is the controller's rate-limited commanded line. Reading it
  // here, rather than inferring it from chassis motion, catches a target that flips
  // faster than the vehicle can respond.
  const commandedLine = rig.autopilot as unknown as { appliedLateral: number };
  for (let i = 0; i < Math.ceil(180 / FIXED_DT); i++) {
    step(rig);
    const pos = rig.vehicle.absoluteTranslation({ x: 0, y: 0, z: 0 });
    const p = rig.road.project(pos.x, pos.z, previousS);
    if (i === 0) startS = p.s;
    if (p.s + 0.03 < previousS) monotonic = false;
    previousS = p.s;

    const line = commandedLine.appliedLateral;
    const lineSign = Math.abs(line) > 0.15 ? Math.sign(line) : 0;
    if (lineSign && previousLineSign && lineSign !== previousLineSign) lineSignChanges++;
    if (lineSign) previousLineSign = lineSign;
    const delta = line - previousLine;
    const direction = Math.abs(delta) > 1e-4 ? Math.sign(delta) : 0;
    if (direction && previousDirection && direction !== previousDirection) lineDirectionReversals++;
    if (direction) previousDirection = direction;
    previousLine = line;

    const steer = Math.abs(rig.input.steer);
    sumSteerSq += steer * steer;
    worstSteer = Math.max(worstSteer, steer);
    worstLateral = Math.max(worstLateral, Math.abs(p.lateral));
    sumSpeed += speed(rig.vehicle);
    samples++;
    if (p.s >= START_S + 1_800) break;
  }
  const progress = previousS - startS;
  return {
    lineSignChangesPerKm: lineSignChanges / Math.max(progress / 1000, 0.001),
    lineDirectionReversalsPerKm: lineDirectionReversals / Math.max(progress / 1000, 0.001),
    steerRms: Math.sqrt(sumSteerSq / samples),
    worstSteer,
    worstLateral,
    meanSpeed: sumSpeed / samples,
    progress,
    monotonic,
  };
}

async function checkLitteredRoad(): Promise<void> {
  for (const mode of ['sleeper', 'frantic'] as const) {
    const result = await driveLitteredRoad(mode);
    const config = MODES[mode];
    // With 20+ hazards/km, a stable plan may make one outward-and-return movement per
    // hazard but must not repeatedly flip between them; 30 reversals/km is no more
    // than one commanded-line reversal every 33 m.
    check(
      `${mode}: littered road does not swerve`,
      result.lineSignChangesPerKm <= 30 && result.lineDirectionReversalsPerKm <= 30,
      `${result.lineSignChangesPerKm.toFixed(1)} line sign changes/km, ${result.lineDirectionReversalsPerKm.toFixed(1)} direction reversals/km (one direction change every ${(1000 / Math.max(result.lineDirectionReversalsPerKm, 0.001)).toFixed(0)} m)`,
    );
    // Full lock is 1.0; RMS below 0.45 leaves clear margin from the saw-tooth steering
    // a player feels even if the chassis happens to remain close to the centreline.
    check(
      `${mode}: littered road steering stays modest`,
      result.steerRms <= 0.45,
      `RMS |steer| ${result.steerRms.toFixed(3)}, worst ${result.worstSteer.toFixed(3)} (full lock 1.000)`,
    );
    check(
      `${mode}: littered road stays inside the static-avoidance shoulder`,
      result.worstLateral <= STATIC_AVOID_EDGE,
      `worst |lateral| ${result.worstLateral.toFixed(2)} m against a ${STATIC_AVOID_EDGE.toFixed(2)} m edge`,
    );
    // Dense scatter keeps the controller in the requested walking-pace avoidance
    // mode almost continuously. Progress, not the old cruise-speed floor, is the
    // contract: it must keep moving forward without charging between props.
    check(
      `${mode}: littered road keeps making slow progress`,
      result.monotonic &&
        result.progress >= 900 &&
        result.meanSpeed >= 4.5 &&
        result.meanSpeed <= 10,
      `${result.progress.toFixed(0)} m, monotonic=${result.monotonic}, ${result.meanSpeed.toFixed(2)} m/s`,
    );
  }
}

async function checkHazards(): Promise<void> {
  // A rock the width of the lane's centre: pass on the right at walking pace, then
  // settle back onto the normal lane only after the rear bumper is clear.
  const rock = await driveHazard(
    { s: START_S + 300, lateral: 0, radius: 1.2, breakable: false },
    100,
  );
  check(
    'non-breakable hazard is passed slowly on the right',
    rock.passed &&
      rock.rejoined &&
      rock.closestLateral < 0 &&
      rock.commandedAtClosest <= -(1.2 + PLANNED_CLEARANCE_M) + 0.2 &&
      rock.speedAtClosest <= 5.5,
    `passed/rejoined=${rock.passed}/${rock.rejoined}, body/commanded lateral ${rock.closestLateral.toFixed(2)}/${rock.commandedAtClosest.toFixed(2)} m, clearance ${rock.minDistance.toFixed(2)} m at ${rock.speedAtClosest.toFixed(2)} m/s`,
  );
  check(
    'static avoidance stays inside its graded shoulder',
    rock.worstLateral <= STATIC_AVOID_EDGE,
    `worst |lateral| ${rock.worstLateral.toFixed(2)} m against a ${STATIC_AVOID_EDGE.toFixed(2)} m edge`,
  );
  const trunk = await driveHazard(
    { s: START_S + 300, lateral: -2.3, radius: 1.6, breakable: false },
    120,
  );
  check(
    'right-edge trunk keeps radius clearance on the right',
    trunk.passed &&
      trunk.rejoined &&
      trunk.closestLateral < -2.3 &&
      trunk.commandedAtClosest <= -2.3 - 1.6 - PLANNED_CLEARANCE_M + 0.2 &&
      trunk.speedAtClosest <= 5.5,
    `passed/rejoined=${trunk.passed}/${trunk.rejoined}, body/commanded lateral ${trunk.closestLateral.toFixed(2)}/${trunk.commandedAtClosest.toFixed(2)} m, clearance ${trunk.minDistance.toFixed(2)} m at ${trunk.speedAtClosest.toFixed(2)} m/s`,
  );
  const wall = await driveHazard(
    { s: START_S + 300, lateral: 0, radius: 6, breakable: false },
    45,
  );
  check(
    'blocked autopilot keeps retrying without charging',
    wall.recoveryStarts >= 3 && wall.thirdRecoveryAt < 40 && wall.chargeSpeed < 8,
    `${wall.recoveryStarts} recoveries, third at ${wall.thirdRecoveryAt.toFixed(1)} s, fastest approach ${wall.chargeSpeed.toFixed(2)} m/s`,
  );
  // A breakable prop is still passed rather than deliberately struck.
  const pile = await driveHazard(
    { s: START_S + 300, lateral: 0, radius: 1.2, breakable: true },
    100,
  );
  check(
    'breakable hazard is passed slowly on the right',
    pile.passed &&
      pile.rejoined &&
      pile.closestLateral < 0 &&
      pile.minDistance >= 1.2 + 1 &&
      pile.speedAtClosest <= 5.5,
    `passed/rejoined=${pile.passed}/${pile.rejoined}, clearance ${pile.minDistance.toFixed(2)} m at ${pile.speedAtClosest.toFixed(2)} m/s`,
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
async function checkAutomaticLights(): Promise<void> {
  const rig = await makeRig();
  rig.autopilot.setMode('sleeper');
  rig.autopilot.setEngaged(true);

  rig.autopilot.setLightingConditions(0, Infinity);
  step(rig);
  const darkEmptyRoad = rig.vehicle.headlights;
  rig.autopilot.setLightingConditions(0, 180);
  step(rig);
  const darkOncomingTraffic = rig.vehicle.headlights;
  rig.autopilot.setLightingConditions(0, Infinity);
  step(rig);
  check(
    'autonomous car keeps low beam throughout darkness',
    darkEmptyRoad === 'low' &&
      darkOncomingTraffic === 'low' &&
      rig.vehicle.headlights === 'low',
    `${darkEmptyRoad}/${darkOncomingTraffic}/${rig.vehicle.headlights}`,
  );

  rig.autopilot.setLightingConditions(1, Infinity);
  step(rig);
  check(
    'autonomous car switches headlights off in daylight',
    rig.vehicle.headlights === 'off',
    rig.vehicle.headlights,
  );
  rig.vehicle.setIndicator('left');
  rig.autopilot.setEngaged(false);
  check(
    'handover clears an autonomous indicator',
    rig.vehicle.indicator === 'off',
    rig.vehicle.indicator,
  );
}


async function run(): Promise<void> {
  await preloadCarModels([MODEL_ID]);
  console.log('autopilot bench: real Road surface collider, mid-engined V8, fixed 60 Hz');
  checkHandover();
  await checkAutomaticLights();
  if (process.argv.includes('--traffic-behavior')) {
    await checkHazards();
    if (failures) process.exitCode = 1;
    return;
  }
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
    check(`${mode}: holds useful cruise speed`, result.meanSpeed >= config.cruiseMps * 0.55 && result.meanSpeed <= config.cruiseMps * 1.15, `${result.meanSpeed.toFixed(2)} m/s vs ${config.cruiseMps.toFixed(0)} m/s target`);
    check(`${mode}: slows for tightest corner`, result.tightSpeed <= cornerLimit + 3, `radius ${result.tightRadius.toFixed(1)} m, ${result.tightSpeed.toFixed(2)} m/s vs ${cornerLimit.toFixed(2)} m/s limit`);
  }
  check('frantic is materially faster than sleeper', frantic.meanSpeed >= sleeper.meanSpeed + 3, `${frantic.meanSpeed.toFixed(2)} vs ${sleeper.meanSpeed.toFixed(2)} m/s`);
  const looseSleeper = await measureLooseSurface('sleeper');
  const looseFrantic = await measureLooseSurface('frantic');
  for (const [mode, result] of [
    ['sleeper', looseSleeper],
    ['frantic', looseFrantic],
  ] as const) {
    const config = MODES[mode];
    check(
      `${mode}: traverses the real gravel district`,
      result.allGravel &&
        result.monotonic &&
        result.progress >= LOOSE_ROUTE_METRES - 5 &&
        result.maxLateral <= ROAD_HALF_WIDTH,
      `${result.progress.toFixed(0)} m, worst lateral ${result.maxLateral.toFixed(2)} m, monotonic=${result.monotonic}`,
    );
    check(
      `${mode}: respects loose-surface pace`,
      result.peakSpeed <= config.cruiseMps * 0.75 &&
        result.meanSpeed >= config.cruiseMps * 0.3,
      `mean/peak ${(result.meanSpeed * 3.6).toFixed(0)}/${(result.peakSpeed * 3.6).toFixed(0)} km/h vs ${(config.cruiseMps * 3.6).toFixed(0)} km/h asphalt cruise`,
    );
  }
  check(
    'driver styles remain distinct on gravel',
    looseFrantic.meanSpeed >= looseSleeper.meanSpeed + 3,
    `${(looseFrantic.meanSpeed * 3.6).toFixed(0)} vs ${(looseSleeper.meanSpeed * 3.6).toFixed(0)} km/h`,
  );
  await checkLitteredRoad();
  await checkHazards();
  if (failures) process.exitCode = 1;
}

void run();
