/**
 * tools/tow-convoy-bench.ts
 *
 * Headless benches for the two wave-2 subsystems that are about MOVING a second
 * car: the car-to-car tow bar (contract kind 17, src/vehicle/cartow.ts) and the
 * convoy escort (kind 16, driven by the registry in src/main.ts).
 *
 *   npx tsx tools/tow-convoy-bench.ts
 *
 * Nothing here is part of the game bundle, and nothing is a re-implementation: the
 * bar is the shipped `CarTowField`, the cars are the shipped `Vehicle`, the road is
 * the shipped `Road` ribbon the autopilot bench uses, and the escort is the shipped
 * `Autopilot` with the shipped pace policy copied from main.ts.
 *
 * TOWING measures what the bar exists for:
 *   - 0-60 km/h from rest on a straight, and the joint's stretch while it happens;
 *   - the same through a 30 m radius bend at 60 km/h, with the worst stretch, the
 *     worst relative speed between the two chassis and the lateral error;
 *   - a snag: the towed car held still while the tower drives off, which must SNAP
 *     the bar rather than drag or explode;
 *   - a NaN / explosion sweep over every step of every run.
 *
 * CONVOY measures the escort's actual job: follow the player's car through an
 * accelerate/cruise/stop cycle over a few km of the real road, and report the
 * headway it held, whether it matched speed, whether it stopped when the player
 * stopped, and whether it caught up again.
 */

import * as THREE from 'three';
import { emptyInput, type InputFrame } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { GameWorld, newWorldState } from '../src/game/state';
import { benchCarState } from './benchcar';
import { addGround } from './handling-bench';
import { installAssetShim } from './assetshim';
import {
  carModelMeasure,
  carSpawnYAboveGround,
  preloadCarModels,
} from '../src/render/carmodel';
import { Autopilot } from '../src/vehicle/autopilot';
import { CarTowField, towEyeWorld } from '../src/vehicle/cartow';
import { Vehicle } from '../src/vehicle/vehicle';
import { carModel } from '../src/vehicle/carmodels';
import { HazardIndex } from '../src/world/hazards';
import { WorldOrigin } from '../src/world/origin';
import { ROAD_HALF_WIDTH, Road } from '../src/world/road';
import { roadSurfaceY, SurfaceField } from '../src/world/roadsurface';
import { SurfaceType } from '../src/core/surfaces';
import { encodeSaveCode, decodeSaveCode } from '../src/save/save';
import type { WorldState } from '../src/game/state';
import { DAY_LENGTH } from '../src/game/state';

installAssetShim();

const TOWER_MODEL = 'sv_vaz2101';
const TOWED_MODEL = 'gt_vaz2110';
/** The bend the bar has to survive: 30 m radius, as asked for. */
const BEND_RADIUS_M = 30;
const TARGET_SPEED_MPS = 60 / 3.6;
/** A 30 m radius at 60 km/h needs 9.3 m/s² of grip, which no car on this road has;
 *  the bend is taken at the speed a driver would actually take it. */
const BEND_SPEED_MPS = 40 / 3.6;
/** metres of straight before the bend starts, and of road the straight phase covers */
const ARC_FROM_M = 500;
const STRAIGHT_RUN_M = 400;
/** Heading-error trim on top of the curvature feed-forward, and the cross-track
 *  gain, rad of wheel angle per metre off the line. */
const HEADING_TRIM = 0.4;
const CROSS_GAIN = 0.06;
// ---------------------------------------------------------------------------
// helpers

interface Stats {
  max: number;
  median: number;
  steps: number;
}

function summarise(values: number[]): Stats {
  if (values.length === 0) return { max: 0, median: 0, steps: 0 };
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    max: sorted[sorted.length - 1]!,
    median: sorted[Math.floor(sorted.length / 2)]!,
    steps: values.length,
  };
}

function yawOf(q: { x: number; y: number; z: number; w: number }): number {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
}

function wrapPi(a: number): number {
  let v = a;
  while (v > Math.PI) v -= 2 * Math.PI;
  while (v < -Math.PI) v += 2 * Math.PI;
  return v;
}

function speedOf(v: Vehicle): number {
  const l = v.chassis.linvel();
  return Math.hypot(l.x, l.z);
}

/**
 * Where a point stands relative to the driven path — straight along +Z to `arcFrom`,
 * then a constant-radius left bend: arclength along it, the signed offset out of it
 * (positive to the path's left), and the path's own yaw and radius there.
 *
 * Derived from the POSITION, never integrated from the car's speed: a car that
 * spins on the spot reports a speed every step while covering no road, and an
 * integrated arclength then runs away from the car — which is exactly how an early
 * version of this bench reported 246 m of "path error" over 65 m of arc.
 */
function pathFoot(x: number, z: number, arcFrom: number, radius: number): {
  s: number;
  lateral: number;
  yaw: number;
  radius: number;
} {
  if (z <= arcFrom) return { s: z, lateral: x, yaw: 0, radius: Infinity };
  const dx = x - radius;
  const dz = z - arcFrom;
  const phi = Math.atan2(dz, -dx);
  const r = Math.hypot(dx, dz);
  // Radial error: positive when the car is inside the bend.
  return { s: arcFrom + radius * phi, lateral: radius - r, yaw: phi, radius: r };
}

/** The real road's asphalt ribbon as a collider, sampled from the shipped `Road`.
 *
 * The same construction the autopilot bench uses, duplicated rather than imported
 * because that module runs its whole suite from its top level. The ribbon reaches
 * past the paint (`ROAD_HALF_WIDTH + 3`) so a wheel that strays onto the verge still
 * has ground under it, exactly as the desert collider is flush with the asphalt in
 * the game.
 */
function addRoadCollider(physics: PhysicsWorld, road: Road, from: number, to: number): void {
  const step = 1;
  const halfWidth = ROAD_HALF_WIDTH + 3;
  const field = new SurfaceField(road.seed);
  const condition = { surface: SurfaceType.Asphalt, decay: 0, sandCover: 0 };
  const point = { x: 0, y: 0, z: 0 };
  for (let chunkFrom = from; chunkFrom < to; chunkFrom += 100) {
    const chunkTo = Math.min(to, chunkFrom + 100);
    const rows = Math.ceil((chunkTo - chunkFrom) / step) + 1;
    const vertices = new Float32Array(rows * 6);
    for (let row = 0; row < rows; row++) {
      const s = Math.min(chunkTo, chunkFrom + row * step);
      for (let side = 0; side < 2; side++) {
        const lateral = side === 0 ? -halfWidth : halfWidth;
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

// ---------------------------------------------------------------------------
// towing rig

interface TowRig {
  physics: PhysicsWorld;
  world: GameWorld;
  tower: Vehicle;
  towed: Vehicle;
  field: CarTowField;
  input: InputFrame;
  stretch: number[];
  relSpeed: number[];
  lateral: number[];
}

async function makeTowRig(): Promise<TowRig> {
  const physics = await PhysicsWorld.create();
  addGround(physics);
  const world = new GameWorld(newWorldState(7));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const measureTower = carModelMeasure(TOWER_MODEL);
  const measureTowed = carModelMeasure(TOWED_MODEL);
  const gap = measureTower.halfExtents[2] + measureTowed.halfExtents[2] + 1.2;
  const towerState = benchCarState(TOWER_MODEL, { id: 'tower', z: 0 });
  const towedState = benchCarState(TOWED_MODEL, { id: 'towed', z: -gap });
  // The contract's stranded car: no engine in the bay. Nothing else about it is
  // special — it is a complete car otherwise.
  towedState.bonnet[0] = null;
  world.state.cars.tower = towerState;
  world.state.cars.towed = towedState;
  const vehicles = new Map<string, Vehicle>();
  const tower = new Vehicle(physics, world, towerState, scene, origin);
  const towed = new Vehicle(physics, world, towedState, scene, origin);
  vehicles.set('tower', tower);
  vehicles.set('towed', towed);
  const field = new CarTowField(
    physics,
    world,
    scene,
    origin,
    (carId) => vehicles.get(carId) ?? null,
    () => {},
  );
  const input = emptyInput();
  // Let both settle onto their springs before coupling.
  input.brake = 1;
  for (let i = 0; i < 240; i++) {
    tower.fixedUpdate(FIXED_DT, input);
    towed.fixedUpdate(FIXED_DT, input);
    physics.step();
    tower.postStep();
    towed.postStep();
  }
  input.brake = 0;
  field.hitch(tower, 'tower', towed, 'towed');
  return { physics, world, tower, towed, field, input, stretch: [], relSpeed: [], lateral: [] };
}

function towStep(rig: TowRig, target: number, holdPoint: { x: number; y: number; z: number } | null): void {
  const t = rig.tower.chassis.translation();
  const r = rig.tower.chassis.rotation();
  const yaw = yawOf(r);
  const v = speedOf(rig.tower);
  // The bend is driven from a curvature feed-forward, trimmed by the heading error
  // against the path's own tangent at the car's arclength and by the radial offset.
  // A follower that fights the tow would report its own gain rather than the bar, so
  // the gains are slack and the radius actually driven is what gets reported.
  const foot = pathFoot(t.x, t.z, ARC_FROM_M, BEND_RADIUS_M);
  const curvature = foot.s >= ARC_FROM_M ? 1 / BEND_RADIUS_M : 0;
  const ff = Math.atan(rig.tower.modelDef.factory.wheelbase * curvature);
  const want =
    ff + wrapPi(foot.yaw - yaw) * HEADING_TRIM - CROSS_GAIN * foot.lateral;
  rig.input.steer = rig.tower.steeringInputForWheelAngle(want, v);
  const dv = target - v;
  rig.input.throttle = Math.max(0, Math.min(1, dv * 0.4));
  rig.input.brake = dv < -0.5 ? Math.max(0, Math.min(1, -dv * 0.4)) : 0;
  rig.input.handbrake = false;

  rig.tower.fixedUpdate(FIXED_DT, rig.input);
  rig.field.fixedUpdate(FIXED_DT, (carId) => (carId === 'tower' ? rig.tower.brakeCommand : 0));

  rig.physics.step();

  if (holdPoint) {
    // A snag: the towed car is against something immovable, so it does not move at
    // all. The bar sees the whole of the tower's motion from here as stretch.
    rig.towed.chassis.setTranslation({ x: holdPoint.x, y: holdPoint.y, z: holdPoint.z }, true);
    rig.towed.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rig.towed.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  rig.field.postStep(FIXED_DT);
  rig.tower.postStep();
  rig.towed.postStep();

  const eyeTower = towEyeWorld(rig.tower, 'rear', { x: 0, y: 0, z: 0 });
  const eyeTowed = towEyeWorld(rig.towed, 'front', { x: 0, y: 0, z: 0 });
  rig.stretch.push(Math.hypot(eyeTower.x - eyeTowed.x, eyeTower.y - eyeTowed.y, eyeTower.z - eyeTowed.z));
  const lv = rig.tower.chassis.linvel();
  const tw = rig.towed.chassis.linvel();
  rig.relSpeed.push(Math.hypot(lv.x - tw.x, lv.z - tw.z));
  rig.lateral.push(Math.abs(foot.lateral));
}

/** Arclength the tower is at, from its own position. */
function towProgress(rig: TowRig): number {
  const t = rig.tower.chassis.translation();
  return pathFoot(t.x, t.z, ARC_FROM_M, BEND_RADIUS_M).s;
}

function finiteRig(rig: TowRig): boolean {
  for (const body of [rig.tower.chassis, rig.towed.chassis]) {
    const t = body.translation();
    const l = body.linvel();
    if (!Number.isFinite(t.x + t.y + t.z + l.x + l.y + l.z)) return false;
  }
  return rig.stretch.every((s) => Number.isFinite(s));
}

async function benchTowing(): Promise<void> {
  console.log('\n== towing: car-to-car bar ==');
  const rig = await makeTowRig();

  // Phase A: straight, rest to 60 km/h, over STRAIGHT_RUN_M of road.
  let to60 = null as number | null;
  const straightSteps = Math.ceil(45 / FIXED_DT);
  for (let i = 0; i < straightSteps; i++) {
    towStep(rig, TARGET_SPEED_MPS, null);
    if (to60 === null && speedOf(rig.tower) >= TARGET_SPEED_MPS) to60 = (i + 1) * FIXED_DT;
    if (towProgress(rig) >= STRAIGHT_RUN_M) break;
  }
  const straightStretch = summarise(rig.stretch);
  const straightRel = summarise(rig.relSpeed);
  console.log(
    `  straight  0-60 km/h ${to60 === null ? 'never' : `${to60.toFixed(2)} s`}` +
    `  over ${towProgress(rig).toFixed(0)} m  tower ${(speedOf(rig.tower) * 3.6).toFixed(1)} km/h` +
    `  towed ${(speedOf(rig.towed) * 3.6).toFixed(1)} km/h`,
  );
  console.log(
    `  stretch    median ${(straightStretch.median * 1000).toFixed(3)} mm` +
    `  max ${(straightStretch.max * 1000).toFixed(2)} mm`,
  );
  console.log(`  rel speed  max ${straightRel.max.toFixed(3)} m/s`);

  // Phase B: approach the bend, slowing to the radius's speed well before it, then
  // take the arc.
  while (towProgress(rig) < ARC_FROM_M - 5 && rig.field.isTowed('towed')) {
    const approach = towProgress(rig) > ARC_FROM_M - 70 ? BEND_SPEED_MPS : TARGET_SPEED_MPS;
    towStep(rig, approach, null);
  }
  rig.stretch.length = 0;
  rig.relSpeed.length = 0;
  rig.lateral.length = 0;
  const bendStart = towProgress(rig);
  const bendEnd = ARC_FROM_M + 60;
  const bendSteps = Math.ceil(30 / FIXED_DT);
  let yawTravelled = 0;
  let previousYaw = yawOf(rig.tower.chassis.rotation());
  let pathMetres = 0;
  let previousSpeed = speedOf(rig.tower);
  for (let i = 0; i < bendSteps && rig.field.isTowed('towed') && towProgress(rig) < bendEnd; i++) {
    towStep(rig, BEND_SPEED_MPS, null);
    const yaw = yawOf(rig.tower.chassis.rotation());
    yawTravelled += wrapPi(yaw - previousYaw);
    previousYaw = yaw;
    pathMetres += previousSpeed * FIXED_DT;
    previousSpeed = speedOf(rig.tower);
  }
  const bendStretch = summarise(rig.stretch);
  const bendRel = summarise(rig.relSpeed);
  const bendLat = summarise(rig.lateral);
  const meanSpeed = pathMetres / (rig.stretch.length * FIXED_DT);
  const drivenRadius = Math.abs(yawTravelled) > 1e-3
    ? meanSpeed * (rig.stretch.length * FIXED_DT) / Math.abs(yawTravelled)
    : Infinity;
  console.log(
    `  bend       ${(towProgress(rig) - bendStart).toFixed(1)} m of arc at` +
    ` ${(BEND_SPEED_MPS * 3.6).toFixed(0)} km/h target; radius driven ${drivenRadius.toFixed(1)} m` +
    ` (nominal ${BEND_RADIUS_M} m)  still coupled: ${rig.field.isTowed('towed')}`,
  );
  console.log(
    `  stretch    median ${(bendStretch.median * 1000).toFixed(3)} mm` +
    `  max ${(bendStretch.max * 1000).toFixed(2)} mm`,
  );
  console.log(`  rel speed  max ${bendRel.max.toFixed(3)} m/s`);
  console.log(`  path error max ${bendLat.max.toFixed(2)} m`);
  console.log(`  finite     ${finiteRig(rig)}`);

  // Phase C: the snag. The towed car is against something immovable from this step
  // on, and the bar must SNAP rather than drag it.
  const snag = await makeTowRig();
  const cruiseSteps = Math.ceil(12 / FIXED_DT);
  for (let i = 0; i < cruiseSteps; i++) towStep(snag, 30 / 3.6, null);
  const snagSpeed = speedOf(snag.tower) * 3.6;
  const holdPoint = snag.towed.chassis.translation();
  const snagTowerStart = snag.tower.chassis.translation().z;
  let brokeAt = null as number | null;
  let stretchWhenBroke = 0;
  let towerMoved = 0;
  for (let i = 0; i < Math.ceil(4 / FIXED_DT); i++) {
    towStep(snag, 30 / 3.6, holdPoint);
    if (!snag.field.isTowed('towed')) {
      brokeAt = (i + 1) * FIXED_DT;
      stretchWhenBroke = snag.stretch[snag.stretch.length - 1] ?? 0;
      towerMoved = snag.tower.chassis.translation().z - snagTowerStart;
      break;
    }
  }
  console.log(
    `  snag       held at ${snagSpeed.toFixed(0)} km/h: bar ` +
    (brokeAt === null
      ? 'DID NOT BREAK (still coupled)'
      : `snapped after ${brokeAt.toFixed(2)} s at ${(stretchWhenBroke * 1000).toFixed(0)} mm`) +
    `  tower moved ${towerMoved.toFixed(2)} m against the hold` +
    `  state cleared: ${snag.world.state.cars.towed?.towedBy === null}`,
  );
}

// ---------------------------------------------------------------------------
// convoy escort

const CONVOY_HEADWAY_S = 2.0;
const CONVOY_CLOSE_MARGIN_MPS = 3;
const CONVOY_CREEP_MPS = 3;
const CONVOY_RECOVER_GAP_M = 45;
const CONVOY_CRUISE_MPS = 22;
const START_S = 1_000;
const ROUTE_METRES = 1_400;

async function benchConvoy(): Promise<void> {
  console.log('\n== convoy: escort following the player ==');
  const modelId = TOWER_MODEL;
  const road = new Road(42);
  const physics = await PhysicsWorld.create();
  addRoadCollider(physics, road, START_S - 40, START_S + ROUTE_METRES + 400);
  const world = new GameWorld(newWorldState(42));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const hazards = new HazardIndex();

  const start = road.sampleAt(START_S);
  const leadState = benchCarState(modelId, {
    id: 'player',
    x: start.x,
    y: carSpawnYAboveGround(carModelMeasure(modelId), start.y, 0),
    z: start.z,
    heading: start.heading,
  });
  // The escort stands 12 m up the road behind the player's car, on the lane.
  const back = road.offsetPoint(START_S - 12, 0);
  const escortState = benchCarState(modelId, {
    id: 'escort',
    x: back.x,
    y: carSpawnYAboveGround(carModelMeasure(modelId), back.y, 0),
    z: back.z,
    heading: road.sampleAt(START_S - 12).heading,
  });
  world.state.cars.player = leadState;
  world.state.cars.escort = escortState;
  const playerCar = new Vehicle(physics, world, leadState, scene, origin);
  const escortCar = new Vehicle(physics, world, escortState, scene, origin);
  const playerPilot = new Autopilot(road, hazards, physics);
  const escortPilot = new Autopilot(road, hazards, physics);
  for (const pilot of [playerPilot, escortPilot]) {
    pilot.setMode('sleeper');
    pilot.setPace(1);
    pilot.setTrafficRecoveryPolicy(true);
  }
  // The escort's shipped policy: no overtaking, a fixed headway, and the pace
  // ceiling the main loop sets.
  escortPilot.setPassingEnabled(false);
  escortPilot.setFollowingHeadway(CONVOY_HEADWAY_S);
  playerPilot.setFollowingHeadway(CONVOY_HEADWAY_S);

  const playerInput = emptyInput();
  const escortInput = emptyInput();
  const settle = (vehicle: Vehicle, input: InputFrame, steps: number): void => {
    input.brake = 1;
    for (let i = 0; i < steps; i++) {
      vehicle.fixedUpdate(FIXED_DT, input);
      physics.step();
      vehicle.postStep();
    }
    input.brake = 0;
  };
  settle(playerCar, playerInput, 150);
  settle(escortCar, escortInput, 150);
  playerPilot.setEngaged(true);
  escortPilot.setEngaged(true);

  // Two stop events inside one run: accelerate/cruise, stop, restart, stop again.
  const totalSteps = Math.ceil(90 / FIXED_DT);
  const stopWindows: [number, number][] = [
    [30, 45],
    [62, 77],
  ];
  const gaps: number[] = [];
  const cruiseGaps: number[] = [];
  const playerSpeeds: number[] = [];
  const escortSpeeds: number[] = [];
  let stopOverlap = 0;
  let stopSamples = 0;
  let maxGapPhase = 0;
  let minGap = Infinity;
  for (let i = 0; i < totalSteps; i++) {
    const t = i * FIXED_DT;
    playerPilot.drive(FIXED_DT, playerCar, playerInput, 0, 0);
    const stopping = stopWindows.some(([a, b]) => t >= a && t < b);
    if (stopping) {
      playerInput.throttle = 0;
      playerInput.brake = 1;
    }
    playerCar.fixedUpdate(FIXED_DT, playerInput);

    const pv = playerCar.chassis.translation();
    const ev = escortCar.chassis.translation();
    const gap = Math.hypot(pv.x - ev.x, pv.z - ev.z);
    const playerSpeed = speedOf(playerCar);
    const cap = gap > CONVOY_RECOVER_GAP_M
      ? CONVOY_CRUISE_MPS
      : Math.max(CONVOY_CREEP_MPS, playerSpeed + CONVOY_CLOSE_MARGIN_MPS);
    escortPilot.setSpeedCap(cap);
    escortPilot.drive(FIXED_DT, escortCar, escortInput, 0, 0);
    escortCar.fixedUpdate(FIXED_DT, escortInput);

    physics.step();
    playerCar.postStep();
    escortCar.postStep();

    if (t > 8) {
      gaps.push(gap);
      maxGapPhase = Math.max(maxGapPhase, gap);
      minGap = Math.min(minGap, gap);
      playerSpeeds.push(playerSpeed);
      escortSpeeds.push(speedOf(escortCar));
    }
    if (stopping) {
      stopSamples++;
      if (speedOf(escortCar) < 2) stopOverlap++;
    } else if (t > 16) {
      cruiseGaps.push(gap);
    }
  }
  const playerS = road.project(playerCar.chassis.translation().x, playerCar.chassis.translation().z).s;
  const escortS = road.project(escortCar.chassis.translation().x, escortCar.chassis.translation().z).s;
  const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const meanCruiseGap = cruiseGaps.reduce((a, b) => a + b, 0) / cruiseGaps.length;
  const maxPlayerSpeed = playerSpeeds.reduce((a, b) => Math.max(a, b), 0);
  const maxEscortSpeed = escortSpeeds.reduce((a, b) => Math.max(a, b), 0);
  const meanPlayer = playerSpeeds.reduce((a, b) => a + b, 0) / playerSpeeds.length;
  const meanEscort = escortSpeeds.reduce((a, b) => a + b, 0) / escortSpeeds.length;
  console.log(
    `  route      player ${((playerS - START_S) / 1000).toFixed(2)} km, escort ${((escortS - (START_S - 12)) / 1000).toFixed(2)} km`,
  );
  console.log(
    `  headway    cruise mean ${meanCruiseGap.toFixed(1)} m` +
    `  overall mean ${meanGap.toFixed(1)} m  min ${minGap.toFixed(1)} m  max ${maxGapPhase.toFixed(1)} m`,
  );
  console.log(
    `  speed      player mean ${(meanPlayer * 3.6).toFixed(1)} / max ${(maxPlayerSpeed * 3.6).toFixed(1)} km/h` +
    `  escort mean ${(meanEscort * 3.6).toFixed(1)} / max ${(maxEscortSpeed * 3.6).toFixed(1)} km/h`,
  );
  console.log(
    `  stops      escort under 2 m/s for ${stopOverlap}/${stopSamples} stopped samples` +
    `  final gap ${gaps[gaps.length - 1]!.toFixed(1)} m`,
  );
  console.log(
    `  finite     ${Number.isFinite(meanGap) && Number.isFinite(maxEscortSpeed)}` +
    `  escort on asphalt: ${Math.abs(road.project(escortCar.chassis.translation().x, escortCar.chassis.translation().z).lateral) < 5}`,
  );
}

// ---------------------------------------------------------------------------
// save round-trip

function benchSave(): void {
  console.log('\n== save round-trip ==');
  const world = newWorldState(9);
  const tower = benchCarState(TOWER_MODEL, { id: 'tower', z: 0 });
  const towed = benchCarState(TOWED_MODEL, { id: 'towed', z: -5 });
  towed.bonnet[0] = null;
  const escort = benchCarState(TOWER_MODEL, { id: 'contract-car:escort', z: 5 });
  world.cars.tower = tower;
  world.cars.towed = towed;
  world.cars['contract-car:escort'] = escort;
  towed.towedBy = 'tower';

  // Through the real serializer AND the real validator, which is what a reload is.
  const round = decodeSaveCode(encodeSaveCode(world));
  const towedBack = round.cars.towed;
  const escortBack = round.cars['contract-car:escort'];
  console.log(
    `  coupling   towedBy=${String(towedBack?.towedBy)} (want tower)` +
    `  tower carries none: ${round.cars.tower?.towedBy == null}`,
  );
  console.log(
    `  escort     survived=${escortBack !== undefined} model=${escortBack?.modelId}` +
    `  engine absent on towed=${towedBack?.bonnet[0] == null}`,
  );

  // A dangling tower, and a three-car chain, must both load with the bar OFF rather
  // than as a coupling the runtime would have to hallucinate.
  const danglingWorld = JSON.parse(JSON.stringify(world)) as WorldState;
  danglingWorld.cars.towed!.towedBy = 'not-a-car';
  const dangling = decodeSaveCode(encodeSaveCode(danglingWorld));
  const chainWorld = JSON.parse(JSON.stringify(world)) as WorldState;
  chainWorld.cars.tower!.towedBy = 'contract-car:escort';
  const chained = decodeSaveCode(encodeSaveCode(chainWorld));
  console.log(
    `  dangling   towedBy=${String(dangling.cars.towed?.towedBy)} (want null)` +
    `  chain kept=${String(chained.cars.towed?.towedBy)}/${String(chained.cars.tower?.towedBy)}` +
    ` (only the direct pair may survive)`,
  );
}

async function main(): Promise<void> {
  await preloadCarModels([TOWER_MODEL, TOWED_MODEL]);
  console.log(`tow-convoy bench  models ${carModel(TOWER_MODEL).label} / ${carModel(TOWED_MODEL).label}` +
    `  day ${DAY_LENGTH}s`);
  await benchTowing();
  await benchConvoy();
  benchSave();
}

await main();
