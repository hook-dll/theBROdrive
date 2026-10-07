/**
 * tools/tow-bench.ts
 *
 * Headless bench for the car-to-car tow bar (contract kind towing,
 * src/vehicle/cartow.ts).
 *
 *   npx tsx tools/tow-bench.ts
 *
 * Nothing here is part of the game bundle, and nothing is a re-implementation: the
 * bar is the shipped `CarTowField`, the cars are the shipped `Vehicle`.
 *
 * TOWING measures what the bar exists for:
 *   - 0-60 km/h from rest on a straight, and the joint's stretch while it happens;
 *   - the same through a 30 m radius bend at 60 km/h, with the worst stretch, the
 *     worst relative speed between the two chassis and the lateral error;
 *   - a snag: the towed car held still while the tower drives off, which must SNAP
 *     the bar rather than drag or explode;
 *   - a NaN / explosion sweep over every step of every run.
 */

import * as THREE from 'three';
import { emptyInput, type InputFrame } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { GameWorld, newWorldState } from '../src/game/state';
import { benchCarState } from './benchcar';
import { addGround } from './handling-bench';
import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';
import { carModelMeasure, preloadCarModels } from '../src/render/carmodel';
import { CarTowField, towEyeWorld } from '../src/vehicle/cartow';
import { Vehicle } from '../src/vehicle/vehicle';
import { carModel } from '../src/vehicle/carmodels';
import { WorldOrigin } from '../src/world/origin';
import { encodeSaveCode, decodeSaveCode } from '../src/save/save';
import type { WorldState } from '../src/game/state';
import { DAY_LENGTH } from '../src/game/state';

// Building a Vehicle paints the sticker atlas, which needs a canvas.
installDocumentShim();
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
  rig.input.steer = rig.tower.steeringInputForWheelAngle(want);
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
// save round-trip

function benchSave(): void {
  console.log('\n== save round-trip ==');
  const world = newWorldState(9);
  const tower = benchCarState(TOWER_MODEL, { id: 'tower', z: 0 });
  const towed = benchCarState(TOWED_MODEL, { id: 'towed', z: -5 });
  towed.bonnet[0] = null;
  const spare = benchCarState(TOWER_MODEL, { id: 'contract-car:spare', z: 5 });
  world.cars.tower = tower;
  world.cars.towed = towed;
  world.cars['contract-car:spare'] = spare;
  towed.towedBy = 'tower';

  // Through the real serializer AND the real validator, which is what a reload is.
  const round = decodeSaveCode(encodeSaveCode(world));
  const towedBack = round.cars.towed;
  const spareBack = round.cars['contract-car:spare'];
  console.log(
    `  coupling   towedBy=${String(towedBack?.towedBy)} (want tower)` +
    `  tower carries none: ${round.cars.tower?.towedBy == null}`,
  );
  console.log(
    `  spare      survived=${spareBack !== undefined} model=${spareBack?.modelId}` +
    `  engine absent on towed=${towedBack?.bonnet[0] == null}`,
  );

  // A dangling tower, and a three-car chain, must both load with the bar OFF rather
  // than as a coupling the runtime would have to hallucinate.
  const danglingWorld = JSON.parse(JSON.stringify(world)) as WorldState;
  danglingWorld.cars.towed!.towedBy = 'not-a-car';
  const dangling = decodeSaveCode(encodeSaveCode(danglingWorld));
  const chainWorld = JSON.parse(JSON.stringify(world)) as WorldState;
  chainWorld.cars.tower!.towedBy = 'contract-car:spare';
  const chained = decodeSaveCode(encodeSaveCode(chainWorld));
  console.log(
    `  dangling   towedBy=${String(dangling.cars.towed?.towedBy)} (want null)` +
    `  chain kept=${String(chained.cars.towed?.towedBy)}/${String(chained.cars.tower?.towedBy)}` +
    ` (only the direct pair may survive)`,
  );
}

async function main(): Promise<void> {
  await preloadCarModels([TOWER_MODEL, TOWED_MODEL]);
  console.log(`tow bench  models ${carModel(TOWER_MODEL).label} / ${carModel(TOWED_MODEL).label}` +
    `  day ${DAY_LENGTH}s`);
  await benchTowing();
  benchSave();
}

await main();
