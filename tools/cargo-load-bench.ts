/**
 * tools/cargo-load-bench.ts
 *
 * What a heavy crate in the boot does to the car that carries it, and what Rapier's
 * ray-cast suspension does with the numbers it is handed.
 *
 * The report this exists for: a 300-700 kg `heavy_crate` in an Oka's trunk made the
 * suspension feel softer, the car wallow, and — the part no real car does — launch it
 * off apparently flat ground.
 *
 * Three sections:
 *
 *  1. THE LAW, on a bare controller: the body is pinned at a known height so the spring
 *     compression is exact, and the force Rapier returns is compared with
 *     `stiffness x compression x chassis_mass` for two masses, two stiffnesses and a
 *     rest length changed after construction. Everything the real car's numbers mean
 *     rests on this.
 *  2. STATIC, on the real car: ride height, the compression the controller is holding
 *     against the same number as the game's telemetry reports it, travel, reserve, the
 *     load each corner is carrying, the car's real centre of mass and the weight split
 *     it produces, and where the bump stop begins.
 *  3. DRIVING, on the real car, on a road built here: flat asphalt with two smooth
 *     humps, 40 mm and 90 mm, at cruise — body rise, peak vertical speed, airborne
 *     time, time on Rapier's travel clamp, peak g — and a step steer for body roll.
 *     Loads of 0, +300 and +700 kg, each in the boot through the path a delivered
 *     crate uses: a `contract_cargo` item in `car.storage`, then `Vehicle.refreshLoad`.
 *
 * Each model's loads end in a VERDICT, which is the point of keeping this tool. A load
 * in the hold is behind the rear axle, so the invariants are the ones that follow from
 * WHERE it is rather than from how heavy it is: the nose must lighten and the tail must
 * take the load, the tail must therefore drop further than the nose, each corner must
 * still sit by `load / rate` while it has the travel and must not go through it when it
 * does not, and no wheel may leave the road over either bump. A stock car must also come
 * out at its catalogue's weight distribution — see `--identity`.
 *
 * The driving runs are STEERED, by a small lane-hold on the two bump runs and their
 * run-up (`laneSteer`). A loaded car with its real centre of mass is genuinely out of
 * trim and veers hands-off, which is worth knowing but is not what this section is for:
 * unsteered, the +700 kg cars drift off the strip and the bump windows measure nothing.
 * The hold only corrects heading, its authority is printed, and the roll step's own
 * steering is added to it, so the suspension numbers stay the suspension's.
 *
 * `--legacy` puts the pre-real-COM car back through public surfaces — the whole mass as
 * one point at the catalogue's weight distribution with a solid-box tensor, and the
 * pre-fix suspension geometry — so the before/after comparison is measured by one
 * instrument; it FAILS the verdict, which is how the check is shown to bite.
 * `--identity` instead proves the opposite end: a STOCK car handed the legacy placement
 * must measure what the new one does — to the float Rapier stores its centre of mass in —
 * which is the invariant that keeps every unloaded car in the game exactly where it was.
 * `--debug` traces the first steps past a hump and dumps one parked wheel's force,
 * stiffness, rest length and mass.
 *
 * Usage: ~/.bun/bin/bun tools/cargo-load-bench.ts [modelId ...] [--legacy] [--identity] [--debug]
 *
 * Nothing here is part of the game bundle.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { installAssetShim } from './assetshim';
import { benchCarState } from './benchcar';
import { installDocumentShim } from './domshim';
import { defaultProgress } from '../src/contracts/types';
import { emptyInput, type InputFrame } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState, type CarState } from '../src/game/state';
import type { Item } from '../src/items/items';
import { preloadCarModels } from '../src/render/carmodel';
import { Vehicle } from '../src/vehicle/vehicle';
import { frontWeightFraction } from '../src/vehicle/carmodels';
import {
  BUMP_STOP_FRACTION,
  BUMP_STOP_PEAK,
  COM_DROP_FRACTION,
  FUEL_DENSITY,
  INERTIA_PITCH_YAW_GAIN,
  INERTIA_ROLL_GAIN,
  MOUNT_ABOVE_WHEEL_CENTRE,
} from '../src/vehicle/vehicletuning';
import { WorldOrigin } from '../src/world/origin';

const GRAVITY = 9.81;
/**
 * The loads the car is measured at. +100 kg is in the list because it is the only one
 * that leaves BOTH axles off their stops on the small cars: the sharpest invariant here
 * — a corner sitting by exactly `load / rate` — only holds while the springs are carrying
 * the whole car rather than part of it through the bump stops, so there has to be a load
 * that does not put the Oka's rear on the rubber.
 */
const LOADS_KG = [0, 100, 300, 700];
/** Reachable by an Oka with 700 kg aboard in the runway below; held thereafter. */
const CRUISE_KMH = 45;

interface Hump {
  readonly z: number;
  readonly h: number;
  readonly len: number;
}

/** Where the car starts, what it drives over, and where the steering step happens. */
const START_Z = -210;
const HUMP_A: Hump = { z: 0, h: 0.04, len: 1.6 };
const HUMP_B: Hump = { z: 140, h: 0.09, len: 1.6 };

/** Model ids are the bare arguments; `--debug` and friends are not model ids. */
const MODELS = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const DEFAULT_MODELS = ['sa_oka', 'gt_vaz2110'];

/* ---------------------------------------------------------------------------
 * Section 1: the law, on a bare controller.
 * ------------------------------------------------------------------------- */

interface LawRig {
  world: RAPIER.World;
  body: RAPIER.RigidBody;
  controller: RAPIER.DynamicRayCastVehicleController;
}

const LAW_RADIUS = 0.35;

function lawRig(options: {
  readonly mass: number;
  readonly stiffness: number;
  readonly rest: number;
}): LawRig {
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = FIXED_DT;
  const h = 200;
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(new Float32Array([-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h]), new Uint32Array([0, 1, 2, 0, 2, 3])),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.8, 0.5, 2).setDensity(0), body);
  // `setAdditionalMass` only marks the mass properties dirty; Rapier folds them in on
  // the next step (or on an explicit recompute, as the game does). Without this the
  // body stays at mass 0 and every suspension force is 0 x stiffness.
  body.setAdditionalMass(options.mass, true);
  body.recomputeMassPropertiesFromColliders();
  const controller = new RAPIER.DynamicRayCastVehicleController(
    body,
    world.broadPhase,
    world.narrowPhase,
    world.bodies,
    world.colliders,
  );
  controller.indexUpAxis = 1;
  controller.setIndexForwardAxis = 2;
  controller.addWheel(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: -1, y: 0, z: 0 },
    options.rest,
    LAW_RADIUS,
  );
  controller.setWheelSuspensionStiffness(0, options.stiffness);
  controller.setWheelSuspensionCompression(0, 0);
  controller.setWheelSuspensionRelaxation(0, 0);
  controller.setWheelMaxSuspensionTravel(0, 2);
  controller.setWheelMaxSuspensionForce(0, 1e9);
  return { world, body, controller };
}

/**
 * The force one step returns with the body held at exactly `height` above the floor,
 * so the suspension length is `height - radius` and the compression is known without a
 * simulation. The world is never stepped, so gravity and motion cannot drift it.
 */
function lawForce(rig: LawRig, height: number): number {
  let force = 0;
  // Rapier builds its query pipeline inside `step`, so the first `updateVehicle` after
  // the pipeline is stale casts its ray into an empty tree and reports no contact. The
  // body is re-pinned to the same height every iteration, so the step's gravity and
  // impulse are thrown away and the compression stays exact.
  for (let i = 0; i < 3; i++) {
    rig.body.setTranslation({ x: 0, y: height, z: 0 }, true);
    rig.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rig.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    rig.controller.updateVehicle(FIXED_DT);
    force = rig.controller.wheelSuspensionForce(0) ?? 0;
    rig.world.step();
  }
  return force;
}

function lawSection(): void {
  const height = 0.75;
  const compression = 0.6 - (height - LAW_RADIUS);
  console.log('--- Rapier ray-cast suspension: force at a known compression ---');
  console.log(
    `  pinned at ${height} m, rest 0.6, radius ${LAW_RADIUS}, so compression ` +
      `${(compression * 1000).toFixed(0)} mm, zero velocity.`,
  );
  console.log('  mass   stiffness/kg   force N   force/(k*x)   chassis.mass()');
  for (const [mass, stiffness] of [
    [635, 13134 / 635],
    [1335, 13134 / 635],
    [1335, 13134 / 1335],
  ] as const) {
    const rig = lawRig({ mass, stiffness, rest: 0.6 });
    const force = lawForce(rig, height);
    console.log(
      `  ${String(mass).padStart(4)}   ${stiffness.toFixed(3).padStart(12)}   ` +
        `${force.toFixed(0).padStart(7)}   ${(force / (stiffness * compression)).toFixed(0).padStart(11)}` +
        `   ${rig.body.mass().toFixed(0)}`,
    );
    rig.controller.free();
    rig.world.free();
  }

  // A mass changed AFTER the controller exists, and a rest length changed after it too.
  const rig = lawRig({ mass: 635, stiffness: 13134 / 635, rest: 0.6 });
  const before = lawForce(rig, height);
  rig.body.setAdditionalMass(1335, true);
  const reMassed = lawForce(rig, height);
  rig.controller.setWheelSuspensionRestLength(0, 0.9);
  const reRested = lawForce(rig, height);
  console.log(
    `  live mass change 635 -> 1335: force ${before.toFixed(0)} -> ${reMassed.toFixed(0)} N` +
      ` (chassis.mass() ${rig.body.mass().toFixed(0)})`,
  );
  console.log(
    `  live rest change 0.6 -> 0.9 (+300 mm): force ${reMassed.toFixed(0)} -> ` +
      `${reRested.toFixed(0)} N (read back ${(
        rig.controller.wheelSuspensionRestLength(0) ?? 0
      ).toFixed(3)} m)`,
  );
  rig.controller.free();
  rig.world.free();
  console.log('');
}

/* ---------------------------------------------------------------------------
 * Section 2: the road, and the rig that drives it.
 * ------------------------------------------------------------------------- */

/** Smooth cosine hump: 0 at both ends, `h` at its centre. */
function humpHeight(humps: readonly Hump[], z: number): number {
  let y = 0;
  for (const b of humps) {
    const t = (z - (b.z - b.len * 0.5)) / b.len;
    if (t > 0 && t < 1) y += b.h * 0.5 * (1 - Math.cos(2 * Math.PI * t));
  }
  return y;
}

function buildRoad(humps: readonly Hump[]): { vertices: Float32Array; indices: Uint32Array } {
  const zs: number[] = [];
  const z0 = START_Z - 20;
  const z1 = 460;
  for (let z = z0; z <= z1 + 1e-6; ) {
    zs.push(z);
    let step = 0.5;
    for (const b of humps) {
      if (Math.abs(z - b.z) < b.len * 0.5 + 0.4) step = 0.02;
    }
    z += step;
  }
  const halfWidth = 60;
  const vertices: number[] = [];
  for (const z of zs) {
    const y = humpHeight(humps, z);
    vertices.push(-halfWidth, y, z, halfWidth, y, z);
  }
  const indices: number[] = [];
  for (let i = 0; i < zs.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

/** A delivered `heavy_crate`, exactly as the contract kitchen hands one over. */
function heavyCrateItem(id: string, kg: number): Item {
  return {
    type: 'contract_cargo',
    id,
    sourceCourierIndex: 0,
    contractKind: 'heavy_crate',
    cargoName: 'heavy crate',
    rewardStickerKind: 'chevrons',
    generatedSeed: 1,
    massKg: kg,
    progress: defaultProgress(),
  };
}

/**
 * The `Vehicle`'s controller and wheel records; private to it, read here to measure.
 *
 * Everything the legacy column writes back is declared mutable: reproducing the old
 * behaviour means writing the old numbers into these records, exactly as the old code
 * did, so they cannot be `readonly` in a mirror that exists to be overwritten.
 */
interface WheelRecord {
  readonly index: number;
  readonly isFront: boolean;
  sagM: number;
  designSagM: number;
  readonly bumpTravelM: number;
  maxTravelM: number;
  restLengthM: number;
  staticLoadN: number;
  readonly springRateNPerM: number;
  readonly rideHz: number;
  bumpStopN: number;
  bumpStopPeakN: number;
  readonly slipAngleRad: number;
  loadN: number;
  compressionM: number;
}
interface Internals {
  controller: RAPIER.DynamicRayCastVehicleController | null;
  wheels: WheelRecord[];
  /** Measured axle lines and the catalogue's kerb weight distribution. */
  axleGeometry: {
    frontZ: number;
    rearZ: number;
    frontCount: number;
    rearCount: number;
    frontWeightShare: number;
  };
  /** Share of the parked weight on the front axle at the car's real centre of mass. */
  parkedFrontShare: number;
  /** The arm the roll and pitch couples act on, metres: the COM above the contact plane. */
  rollLeverArm: number;
  contactPlaneY: number;
}

interface Rig {
  physics: PhysicsWorld;
  vehicle: Vehicle;
  input: InputFrame;
  state: CarState;
  /** Chassis origin height once parked, metres. The ground under it is y = 0. */
  settledY: number;
  /** The catalogue's kerb front share, for the stock-car identity check. */
  kerbFrontShare: number;
}

async function makeRig(modelId: string): Promise<Rig> {
  const physics = await PhysicsWorld.create();
  const road = buildRoad([HUMP_A, HUMP_B]);
  physics.addStaticTrimesh(road.vertices, road.indices, SurfaceType.Asphalt);

  const world = new GameWorld(newWorldState(7));
  const state = benchCarState(modelId, { id: `cargo-${modelId}`, z: START_Z, y: 1.2 });
  world.state.cars[state.id] = state;
  const vehicle = new Vehicle(physics, world, state, new THREE.Scene(), new WorldOrigin());
  const input = emptyInput();

  // Park it: brakes on so nothing creeps, then a second of free settling so the height
  // measured is the springs' and not the brakes'.
  for (let i = 0; i < 240; i++) {
    input.brake = 1;
    vehicle.fixedUpdate(FIXED_DT, input);
    physics.step();
    vehicle.postStep();
  }
  input.brake = 0;
  for (let i = 0; i < 120; i++) {
    vehicle.fixedUpdate(FIXED_DT, input);
    physics.step();
    vehicle.postStep();
  }
  return {
    physics,
    vehicle,
    input,
    state,
    settledY: vehicle.chassis.translation().y,
    kerbFrontShare: frontWeightFraction(vehicle.modelDef),
  };
}

/** Puts `kg` of crate in the first boot cell and lets the car re-solve for it. */
function loadCargo(rig: Rig, kg: number): void {
  if (kg <= 0) return;
  rig.state.storage[0] = heavyCrateItem(`crate-${kg}`, kg);
  rig.vehicle.refreshLoad();
}

/**
 * What Rapier hands back for one parked front wheel, step by step, against the product
 * its own getters say the force should be. Exists because the loaded car's force does
 * not match `stiffness x compression x chassis.mass` even though the law section shows
 * every one of those is honoured live; the trace is what says which of the three is not
 * the number it appears to be.
 */
function traceWheel(rig: Rig, label: string): void {
  const { controller, wheels } = rig.vehicle as unknown as Internals;
  const w = wheels.find((candidate) => candidate.isFront)!;
  for (let i = 0; i < 3; i++) {
    rig.vehicle.fixedUpdate(FIXED_DT, rig.input);
    rig.physics.step();
    rig.vehicle.postStep();
    const rest = controller?.wheelSuspensionRestLength(w.index) ?? 0;
    const length = controller?.wheelSuspensionLength(w.index) ?? 0;
    const stiffness = controller?.wheelSuspensionStiffness(w.index) ?? 0;
    const force = controller?.wheelSuspensionForce(w.index) ?? 0;
    const mass = rig.vehicle.chassis.mass();
    console.log(
      `  trace ${label} ${i}: mass ${mass.toFixed(0)} kg  k ${stiffness.toFixed(3)}/kg  ` +
        `rest ${mm(rest)} mm  len ${mm(length)} mm  comp ${mm(rest - length)} mm  ` +
        `force ${force.toFixed(0)} N  k*comp*mass ${(stiffness * (rest - length) * mass).toFixed(0)} N  ` +
        `loadN ${w.loadN.toFixed(0)} N  static ${w.staticLoadN.toFixed(0)} N`,
    );
  }
}

function mm(value: number): string {
  return (value * 1000).toFixed(0);
}

/** What one axle's parked corner measured, for the verdict at the end of a model's loads. */
interface AxleFacts {
  /** Suspension length at rest, metres: the mount's height over the wheel, so the sag
   * the BODY shows, which is not the same thing as how far the spring is compressed. */
  readonly lengthM: number;
  readonly compressionM: number;
  readonly travelM: number;
  readonly stopBeginsM: number;
  readonly staticLoadN: number;
  readonly springRateNPerM: number;
}

/** What the static section measured, for the verdict at the end of a model's loads. */
interface StaticFacts {
  readonly kg: number;
  readonly massKg: number;
  /** The car's real centre of mass, chassis-local metres. */
  readonly comZM: number;
  readonly comYM: number;
  /** Share of the parked weight on the front axle at that centre of mass. */
  readonly frontShare: number;
  /** The same share as `Vehicle` itself resolved it, in double precision. */
  readonly gameFrontShare: number;
  /** The catalogue's kerb front share, for the stock-car identity check. */
  readonly catalogueFrontShare: number;
  /** Chassis origin height once settled, metres; the ground under it is y = 0. */
  readonly rideHeightM: number;
  readonly front: AxleFacts;
  readonly rear: AxleFacts;
}

/**
 * Reproduces the suspension as it behaved BEFORE this bench existed, so the before and
 * after columns come from one instrument rather than from two builds.
 *
 * Every line is what `reloadSprings` used to do to a loaded car: re-derive the spring's
 * free length and the travel from the load it is carrying, anchor the bump stop's knee
 * on that same load's sag, and scale the stop's crush force with the load. Producing it
 * through the controller's public setters is why it can be switched on from here at all.
 */
function applyLegacyGeometry(rig: Rig): void {
  const { controller, wheels } = rig.vehicle as unknown as Internals;
  for (const w of wheels) {
    const travel = w.sagM + w.bumpTravelM;
    // The controller's free length and travel followed the load. The telemetry's rest
    // length did NOT — it stayed at the kerb value it was built with, which is why the
    // compression the game reported (and the bump stop it sized) had nothing to do with
    // the one the springs were actually holding. Both halves are part of the behaviour.
    w.restLengthM = w.designSagM + MOUNT_ABOVE_WHEEL_CENTRE;
    w.maxTravelM = travel;
    w.designSagM = w.sagM;
    w.bumpStopPeakN = BUMP_STOP_PEAK * w.staticLoadN;
    controller?.setWheelSuspensionRestLength(w.index, w.sagM + MOUNT_ABOVE_WHEEL_CENTRE);
    controller?.setWheelMaxSuspensionTravel(w.index, travel);
  }
}

/**
 * Reproduces the MASS placement as it was before this change: the whole car, a 700 kg
 * crate included, as one point at the catalogue's weight distribution and today's
 * centre-of-mass height, with a solid-box tensor scaled by the total mass. Every load
 * therefore sits at the car's own centre of mass and none of them moves it — which is
 * the thing this bench exists to disprove.
 *
 * Written out here rather than called from `Vehicle`, so the before column is produced
 * by the instrument that measures it and cannot go stale with the code it measures
 * against. `--identity` is what checks the two agree on a stock car.
 */
function applyLegacyMass(rig: Rig): void {
  const vehicle = rig.vehicle;
  const internals = vehicle as unknown as Internals;
  const { wheels, axleGeometry } = internals;
  const half = vehicle.modelMeasure.halfExtents;
  const mass = vehicle.stats.mass;
  const inertia = {
    x: INERTIA_PITCH_YAW_GAIN * (mass / 3) * (half[1] * half[1] + half[2] * half[2]),
    y: INERTIA_PITCH_YAW_GAIN * (mass / 3) * (half[0] * half[0] + half[2] * half[2]),
    z: INERTIA_ROLL_GAIN * (mass / 3) * (half[0] * half[0] + half[1] * half[1]),
  };
  const comZ =
    axleGeometry.rearZ + axleGeometry.frontWeightShare * (axleGeometry.frontZ - axleGeometry.rearZ);
  const comY = -COM_DROP_FRACTION * half[1];
  vehicle.chassis.setAdditionalMassProperties(
    mass,
    { x: 0, y: comY, z: comZ },
    inertia,
    { x: 0, y: 0, z: 0, w: 1 },
    false,
  );
  vehicle.chassis.recomputeMassPropertiesFromColliders();

  // The kerb share was also what every corner's parked load and the roll lever were read
  // against, so both halves of that go back too.
  internals.parkedFrontShare = axleGeometry.frontWeightShare;
  internals.rollLeverArm = Math.max(0.1, comY - internals.contactPlaneY);
  const weightN = mass * GRAVITY;
  for (const w of wheels) {
    const axleShare = w.isFront ? axleGeometry.frontWeightShare : 1 - axleGeometry.frontWeightShare;
    const axleCount = w.isFront ? axleGeometry.frontCount : axleGeometry.rearCount;
    w.staticLoadN = Math.max(1, (weightN * axleShare) / Math.max(1, axleCount));
    w.sagM = w.staticLoadN / w.springRateNPerM;
  }
}

function reportStatic(modelId: string, kg: number, rig: Rig): StaticFacts {
  const { vehicle } = rig;
  const internals = vehicle as unknown as Internals;
  const { controller, wheels, axleGeometry } = internals;
  const halfY = vehicle.modelMeasure.halfExtents[1];
  const front = wheels.filter((w) => w.isFront);
  const rear = wheels.filter((w) => !w.isFront);
  const ride = vehicle.wheelRide;

  const axle = (frontAxle: boolean): string => {
    const list = frontAxle ? front : rear;
    const w = list[0]!;
    const rest = controller?.wheelSuspensionRestLength(w.index) ?? 0;
    const length = controller?.wheelSuspensionLength(w.index) ?? rest;
    const travel = controller?.wheelMaxSuspensionTravel(w.index) ?? 0;
    const maxForce = controller?.wheelMaxSuspensionForce(w.index) ?? 0;
    const stiffness = controller?.wheelSuspensionStiffness(w.index) ?? 0;
    const force = controller?.wheelSuspensionForce(w.index) ?? 0;
    const stopBegins = w.designSagM + w.bumpTravelM * (1 - BUMP_STOP_FRACTION);
    const index = w.index;
    const sample = ride[index]!;
    const impliedMass = stiffness * (rest - length) > 0 ? force / (stiffness * (rest - length)) : 0;
    return (
      `k ${w.springRateNPerM.toFixed(0).padStart(6)} N/m  rest ${mm(rest).padStart(4)} mm ` +
      `(telemetry ${mm(w.restLengthM).padStart(4)})  len ${mm(length).padStart(4)} mm  ` +
      `comp ${mm(rest - length).padStart(4)} mm  sag ${mm(w.sagM).padStart(4)} mm ` +
      `(design ${mm(w.designSagM).padStart(4)})  ` +
      `travel ${mm(travel).padStart(4)} mm (record ${mm(w.maxTravelM).padStart(4)})  ` +
      `stop ${mm(stopBegins).padStart(4)} mm  ` +
      `static ${w.staticLoadN.toFixed(0).padStart(5)} N  ${w.rideHz.toFixed(2)} Hz\n` +
      `        controller k ${stiffness.toFixed(3).padStart(6)}/kg  maxF ${maxForce.toFixed(0).padStart(6)} N` +
      `  force ${force.toFixed(0).padStart(5)} N  (implies mass ${impliedMass.toFixed(0)} kg)\n` +
      `        telemetry  comp ${mm(sample.compressionM).padStart(4)} mm  reserve ${mm(sample.reserveM).padStart(4)} mm` +
      `  load ${sample.loadN.toFixed(0).padStart(5)} N  wheel record comp ${mm(w.compressionM).padStart(4)} mm`
    );
  };
  const axleFacts = (list: WheelRecord[]): AxleFacts => {
    const w = list[0]!;
    const rest = controller?.wheelSuspensionRestLength(w.index) ?? 0;
    const length = controller?.wheelSuspensionLength(w.index) ?? rest;
    return {
      lengthM: length,
      compressionM: rest - length,
      travelM: controller?.wheelMaxSuspensionTravel(w.index) ?? 0,
      stopBeginsM: w.designSagM + w.bumpTravelM * (1 - BUMP_STOP_FRACTION),
      staticLoadN: w.staticLoadN,
      springRateNPerM: w.springRateNPerM,
    };
  };
  const collider = vehicle.chassis.collider(0);
  const colliderFloorY =
    rig.settledY + collider.translation().y - (collider.halfExtents()?.y ?? 0);
  // The car's own centre of mass, read back from Rapier rather than from the game's
  // arithmetic: independent evidence that the mass properties really took. In LOCAL
  // coordinates, because Rapier stores these as floats and the world frame here is two
  // hundred metres out, where a float's resolution is 15 µm.
  const com = vehicle.chassis.localCom();
  const comX = com.x;
  const comY = com.y;
  const comZ = com.z;
  const wheelbase = axleGeometry.frontZ - axleGeometry.rearZ;
  const frontShare = wheelbase > 1e-3 ? (comZ - axleGeometry.rearZ) / wheelbase : 0;
  console.log(`--- ${modelId}  +${kg} kg ---`);
  console.log(
    `  mass ${vehicle.stats.mass.toFixed(0)} kg (chassis body ` +
      `${vehicle.chassis.mass().toFixed(0)} kg)  ride height ${(rig.settledY * 1000).toFixed(0)} mm  ` +
      `body clearance ${((rig.settledY - halfY) * 1000).toFixed(0)} mm ` +
      `(factory ${(vehicle.modelDef.factory.clearance * 1000).toFixed(0)} mm)  ` +
      `chassis collider floor ${(colliderFloorY * 1000).toFixed(0)} mm above the road`,
  );
  console.log(
    `  centre of mass x ${comX.toFixed(3)} y ${comY.toFixed(3)} z ${comZ.toFixed(3)} m ` +
      `(${(comY - internals.contactPlaneY).toFixed(3)} m above the contact plane, ` +
      `axles ${axleGeometry.frontZ.toFixed(3)} / ${axleGeometry.rearZ.toFixed(3)})  ` +
      `front share ${(frontShare * 100).toFixed(1)}% (kerb ${(rig.kerbFrontShare * 100).toFixed(1)}%)  ` +
      `game says ${(internals.parkedFrontShare * 100).toFixed(1)}%`,
  );
  console.log(`  front ${axle(true)}`);
  console.log(`  rear  ${axle(false)}`);
  return {
    kg,
    massKg: vehicle.stats.mass,
    comZM: comZ,
    comYM: comY,
    frontShare,
    gameFrontShare: internals.parkedFrontShare,
    catalogueFrontShare: rig.kerbFrontShare,
    rideHeightM: rig.settledY,
    front: axleFacts(front),
    rear: axleFacts(rear),
  };
}

/* ---------------------------------------------------------------------------
 * Section 3: driving.
 * ------------------------------------------------------------------------- */

interface Window {
  riseM: number;
  upMps: number;
  airMs: number;
  clampMs: number;
  maxCompressionM: number;
  maxBumpStopN: number;
  maxForceN: number;
  peakAccelG: number;
  /** Furthest the car wandered from the road's centreline, metres. */
  maxLateralM: number;
}

function newWindow(): Window {
  return {
    riseM: 0,
    upMps: 0,
    airMs: 0,
    clampMs: 0,
    maxCompressionM: 0,
    maxBumpStopN: 0,
    maxForceN: 0,
    peakAccelG: 0,
    maxLateralM: 0,
  };
}

/** What one step of driving read off the car. */
interface StepFacts {
  z: number;
  /** Chassis-local lateral offset from the road's centreline, metres. */
  lateralM: number;
  riseM: number;
  vyMps: number;
  accelG: number;
  wheelsDown: number;
  compressionM: number;
  forceN: number;
  clamped: boolean;
  bumpStopN: number;
  rollDeg: number;
}

/** Lean of the body: the angle its own left axis makes with horizontal, degrees. */
function rollDeg(vehicle: Vehicle): number {
  const q = vehicle.chassis.rotation();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
    new THREE.Quaternion(q.x, q.y, q.z, q.w),
  );
  return (Math.asin(Math.max(-1, Math.min(1, right.y))) * 180) / Math.PI;
}

/**
 * Where the car is pointed relative to the road and how far off-centre, both POSITIVE
 * when the car is pointing or sitting to its own left (+x). `input.steer` is positive
 * for "steer right", which is -x, so a positive error wants a positive command.
 */
function laneError(rig: Rig): { headingRad: number; lateralM: number } {
  const q = rig.vehicle.chassis.rotation();
  const ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(
    new THREE.Quaternion(q.x, q.y, q.z, q.w),
  );
  const p = rig.vehicle.chassis.translation();
  return { headingRad: Math.atan2(ahead.x, ahead.z), lateralM: p.x };
}

/** Most the lane-hold may ask for, and what one metre of lane error is worth. */
const LANE_HOLD_MAX_RAD = 0.2;
const LANE_HOLD_RAD_PER_METRE = 0.04;

/**
 * A small lane-hold, for the straight runs and their run-up.
 *
 * A car with its real centre of mass is out of trim: put 300 kg behind the Oka's rear
 * axle and it no longer tracks straight hands-off, because the weight has genuinely moved
 * off the nose. That is worth knowing and it is measured — the steer this needs is
 * printed next to the bump numbers — but it is not what the bump section is FOR, and a
 * car that has wandered off the strip has no bump numbers at all. The hold only corrects
 * heading and offset; the roll step's own input is added on top of it, so nothing the
 * suspension has to answer to is changed by more than a couple of hundredths of a radian.
 *
 * The authority is deliberately coarse. A steering rack has 8 mrad of play before the
 * tyres see anything and the input curve is a power, so the bottom of the input range
 * does nothing at all: this commands in units big enough to cross the play, and its own
 * limit is what keeps a correction a correction.
 */
function laneSteer(rig: Rig): number {
  const { headingRad, lateralM } = laneError(rig);
  const command = headingRad * 1.5 + lateralM * LANE_HOLD_RAD_PER_METRE;
  return Math.max(-LANE_HOLD_MAX_RAD, Math.min(LANE_HOLD_MAX_RAD, command));
}

/** How far off the centreline a deliberate manoeuvre is allowed to stray, metres. */
const LANE_GUARD_M = 8;

/**
 * The same hold, but only as a guard rail: nothing at all until the car is `LANE_GUARD_M`
 * off the centreline, and the hold's own limit from there. Used while the step steer is
 * being applied — a full-lock step takes the car off a straight line by design, and a
 * tight hold fighting it would be measuring the hold instead of the car. This only stops
 * the run before the car reaches the edge of the strip, which is where its numbers stop
 * meaning anything.
 */
function laneGuard(rig: Rig): number {
  const { lateralM } = laneError(rig);
  if (Math.abs(lateralM) < LANE_GUARD_M) return 0;
  return laneSteer(rig);
}

/** One fixed step with the commanded inputs, then everything that step can be read for. */
function step(rig: Rig, steer: number, throttle: number, brake: number): StepFacts {
  const { vehicle, physics, input } = rig;
  const { controller, wheels } = vehicle as unknown as Internals;

  input.steer = steer;
  input.throttle = throttle;
  input.brake = brake;
  const before = vehicle.chassis.linvel().y;
  vehicle.fixedUpdate(FIXED_DT, input);
  physics.step();
  vehicle.postStep();

  const pos = vehicle.chassis.translation();
  const vy = vehicle.chassis.linvel().y;
  const wheelCount = controller?.numWheels() ?? 0;
  let wheelsDown = 0;
  let compression = 0;
  let force = 0;
  let stopN = 0;
  let clamped = false;
  for (let w = 0; w < wheelCount; w++) {
    const rest = controller?.wheelSuspensionRestLength(w) ?? 0;
    const length = controller?.wheelSuspensionLength(w) ?? rest;
    const travel = controller?.wheelMaxSuspensionTravel(w) ?? 0;
    const comp = rest - length;
    if (comp > compression) compression = comp;
    if (length <= rest - travel + 5e-4) clamped = true;
    if ((controller?.wheelSuspensionForce(w) ?? 0) > force) force = controller?.wheelSuspensionForce(w) ?? 0;
    if (wheels[w]!.bumpStopN > stopN) stopN = wheels[w]!.bumpStopN;
    if (vehicle.wheelRide[w]?.inContact) wheelsDown++;
  }
  return {
    z: pos.z,
    lateralM: pos.x,
    riseM: pos.y - rig.settledY,
    vyMps: vy,
    accelG: Math.abs(vy - before) / FIXED_DT / GRAVITY,
    wheelsDown,
    compressionM: compression,
    forceN: force,
    clamped,
    bumpStopN: stopN,
    rollDeg: rollDeg(vehicle),
  };
}

/**
 * Throttle and brake that hold the car at `CRUISE_KMH`. */
function cruisePedals(rig: Rig): { throttle: number; brake: number } {
  const error = CRUISE_KMH - rig.vehicle.speedKmh;
  return {
    throttle: Math.max(0, Math.min(1, error * 0.25)),
    brake: Math.max(0, Math.min(0.5, -error * 0.08)),
  };
}

/**
 * Lets the car settle on its springs at the load it currently has, and re-reads the
 * ride height it has settled to. Every measurement is relative to that height, so a
 * bench that skipped this would report a loaded car's sag as negative body travel.
 */
function settle(rig: Rig, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) step(rig, 0, 0, 0.3);
  rig.settledY = rig.vehicle.chassis.translation().y;
}

function accumulate(w: Window, f: StepFacts): void {
  if (f.riseM > w.riseM) w.riseM = f.riseM;
  if (f.vyMps > w.upMps) w.upMps = f.vyMps;
  if (f.wheelsDown === 0) w.airMs += FIXED_DT * 1000;
  if (f.clamped) w.clampMs += FIXED_DT * 1000;
  if (f.compressionM > w.maxCompressionM) w.maxCompressionM = f.compressionM;
  if (f.bumpStopN > w.maxBumpStopN) w.maxBumpStopN = f.bumpStopN;
  if (f.forceN > w.maxForceN) w.maxForceN = f.forceN;
  if (f.accelG > w.peakAccelG) w.peakAccelG = f.accelG;
  if (Math.abs(f.lateralM) > w.maxLateralM) w.maxLateralM = Math.abs(f.lateralM);
}

interface HumpRun {
  bumpA: Window;
  bumpB: Window;
  speedAtHumpKmh: number;
  /** Largest lane-hold command used anywhere in the run, radians. */
  maxSteerRad: number;
}

function humpRun(rig: Rig): HumpRun {
  const run: HumpRun = {
    bumpA: newWindow(),
    bumpB: newWindow(),
    speedAtHumpKmh: 0,
    maxSteerRad: 0,
  };
  const trace = process.argv.includes('--debug');
  let sinceHumpA = -1;
  for (let i = 0; i < Math.round(40 / FIXED_DT); i++) {
    const pedals = cruisePedals(rig);
    const steer = laneSteer(rig);
    if (Math.abs(steer) > run.maxSteerRad) run.maxSteerRad = Math.abs(steer);
    const f = step(rig, steer, pedals.throttle, pedals.brake);
    if (f.z > HUMP_A.z - 3 && f.z < HUMP_A.z + 40) accumulate(run.bumpA, f);
    else if (f.z > HUMP_B.z - 3 && f.z < HUMP_B.z + 40) accumulate(run.bumpB, f);
    if (Math.abs(f.z - HUMP_A.z) < 4) run.speedAtHumpKmh = rig.vehicle.speedKmh;
    if (trace && f.z > HUMP_A.z - 2 && sinceHumpA < 0) sinceHumpA = 0;
    if (trace && sinceHumpA >= 0 && sinceHumpA < Math.round(3 / FIXED_DT)) {
      if (sinceHumpA % 8 === 0) {
        const p = rig.vehicle.chassis.translation();
        const v = rig.vehicle.chassis.linvel();
        console.log(
          `    t ${(sinceHumpA * FIXED_DT).toFixed(2)} z ${p.z.toFixed(1)} x ${p.x.toFixed(2)} ` +
            `y ${p.y.toFixed(2)} vy ${v.y.toFixed(2)} vx ${v.x.toFixed(2)} ` +
            `roll ${rollDeg(rig.vehicle).toFixed(0)} speed ${rig.vehicle.speedKmh.toFixed(0)} ` +
            `wheelsDown ${f.wheelsDown} stop ${f.bumpStopN.toFixed(0)} `,
        );
      }
      sinceHumpA++;
    }
    if (f.z > HUMP_B.z + 20) break;
  }
  return run;
}

interface RollRun {
  peakRollDeg: number;
  steadyRollDeg: number;
  speedKmh: number;
  peakForceN: number;
}

/** What a gentle corner does when the throttle goes away. */
interface LiftRun {
  speedKmh: number;
  /** Mean slip angle of each axle in the steady corner and the peak after the lift. */
  frontSlipBeforeRad: number;
  frontSlipAfterRad: number;
  rearSlipBeforeRad: number;
  rearSlipAfterRad: number;
  /** Body yaw rate in the steady corner and the peak it reaches after the lift. */
  yawBeforeRadS: number;
  yawAfterRadS: number;
}

/** Mean |slip angle| of one axle, radians. */
function axleSlip(rig: Rig, front: boolean): number {
  const { wheels } = rig.vehicle as unknown as Internals;
  const list = wheels.filter((w) => w.isFront === front);
  if (list.length === 0) return 0;
  let sum = 0;
  for (const w of list) sum += Math.abs(w.slipAngleRad);
  return sum / list.length;
}

/** The steering held through the lift-off corner, as an input, and its measured g. */
const LIFT_TURN_INPUT = 0.18;

/**
 * LIFT-OFF IN A CORNER, which is where a car whose mass has moved back tells you so.
 *
 * A steady turn first — `LIFT_TURN_INPUT` at cruise, which the run prints as a real
 * corner in g rather than as a slide, because the steering rack's play eats most of a
 * small input and an input that looks gentle is nearly straight — and then the throttle
 * goes away with the steering held. The measured pair is the tail's slip angle and the
 * body's yaw rate before and after, so a load that has taken the rear axle's grip and
 * given it to the front shows up as a car whose tail steps out on the overrun.
 */
function liftRun(rig: Rig): LiftRun {
  // Cruise to speed on the level, lane held.
  for (let i = 0; i < Math.round(40 / FIXED_DT); i++) {
    const pedals = cruisePedals(rig);
    const f = step(rig, laneSteer(rig), pedals.throttle, pedals.brake);
    if (f.z > -40) break;
  }
  const run: LiftRun = {
    speedKmh: rig.vehicle.speedKmh,
    frontSlipBeforeRad: 0,
    frontSlipAfterRad: 0,
    rearSlipBeforeRad: 0,
    rearSlipAfterRad: 0,
    yawBeforeRadS: 0,
    yawAfterRadS: 0,
  };
  // Two seconds to reach the steady corner, read over its last half second.
  const steadySteps = Math.round(2 / FIXED_DT);
  for (let i = 0; i < steadySteps; i++) {
    const pedals = cruisePedals(rig);
    step(rig, LIFT_TURN_INPUT + laneGuard(rig), pedals.throttle, pedals.brake);
    if (i >= steadySteps - 30) {
      run.frontSlipBeforeRad = Math.max(run.frontSlipBeforeRad, axleSlip(rig, true));
      run.rearSlipBeforeRad = Math.max(run.rearSlipBeforeRad, axleSlip(rig, false));
      run.yawBeforeRadS = Math.max(run.yawBeforeRadS, Math.abs(rig.vehicle.chassis.angvel().y));
    }
  }
  // Then the lift: throttle and brake both away, steering untouched.
  for (let i = 0; i < Math.round(1.5 / FIXED_DT); i++) {
    step(rig, LIFT_TURN_INPUT + laneGuard(rig), 0, 0);
    run.frontSlipAfterRad = Math.max(run.frontSlipAfterRad, axleSlip(rig, true));
    run.rearSlipAfterRad = Math.max(run.rearSlipAfterRad, axleSlip(rig, false));
    run.yawAfterRadS = Math.max(run.yawAfterRadS, Math.abs(rig.vehicle.chassis.angvel().y));
  }
  return run;
}

function rollRun(rig: Rig): RollRun {
  const run: RollRun = { peakRollDeg: 0, steadyRollDeg: 0, speedKmh: 0, peakForceN: 0 };
  // Straight and level up to cruise first: a step steer measured during the launch
  // would report the loading transient, not the cornering attitude. Lane-held, for the
  // same reason the bump run is.
  for (let i = 0; i < Math.round(40 / FIXED_DT); i++) {
    const pedals = cruisePedals(rig);
    const f = step(rig, laneSteer(rig), pedals.throttle, pedals.brake);
    if (f.z > -40) break;
  }
  run.speedKmh = rig.vehicle.speedKmh;
  const steps = Math.round(5 / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    const f = step(rig, 0.35 + laneGuard(rig), 0.35, 0);
    if (Math.abs(f.rollDeg) > Math.abs(run.peakRollDeg)) run.peakRollDeg = f.rollDeg;
    if (f.forceN > run.peakForceN) run.peakForceN = f.forceN;
    if (i > steps - 60) run.steadyRollDeg = f.rollDeg;
  }
  const release = cruisePedals(rig);
  for (let i = 0; i < 60; i++) step(rig, laneSteer(rig), release.throttle, release.brake);
  return run;
}

/**
 * Where the car ended up after the hump run: a car that has left the road, flipped or
 * come to rest means the numbers above are not the ones they claim to be.
 */
function reportRunEnd(rig: Rig): void {
  const p = rig.vehicle.chassis.translation();
  const v = rig.vehicle.chassis.linvel();
  console.log(
    `  end of run: z ${p.z.toFixed(0)} m, y ${p.y.toFixed(2)} m, speed ` +
      `${rig.vehicle.speedKmh.toFixed(0)} km/h, |v| ${Math.hypot(v.x, v.y, v.z).toFixed(1)} m/s, ` +
      `roll ${rollDeg(rig.vehicle).toFixed(0)} deg`,
  );
}

function reportHump(run: HumpRun): Window[] {
  const line = (label: string, w: Window): void => {
    console.log(
      `  ${label}  rise ${(w.riseM * 1000).toFixed(0).padStart(3)} mm  ` +
        `vy ${w.upMps.toFixed(2).padStart(5)} m/s  air ${w.airMs.toFixed(0).padStart(3)} ms  ` +
        `clamp ${w.clampMs.toFixed(0).padStart(3)} ms  ` +
        `comp ${(w.maxCompressionM * 1000).toFixed(0).padStart(4)} mm  ` +
        `F ${w.maxForceN.toFixed(0).padStart(6)} N  ` +
        `stop ${w.maxBumpStopN.toFixed(0).padStart(5)} N  ` +
        `peak ${w.peakAccelG.toFixed(1).padStart(4)} g  ` +
        `lane ${w.maxLateralM.toFixed(1).padStart(4)} m`,
    );
  };
  line('hump 40 mm', run.bumpA);
  console.log(
    `        (speed at the first hump: ${run.speedAtHumpKmh.toFixed(0)} km/h; ` +
      `lane-hold never asked for more than ${run.maxSteerRad.toFixed(3)} rad)`,
  );
  line('hump 90 mm', run.bumpB);
  return [run.bumpA, run.bumpB];
}

/**
 * The invariants the load has to satisfy, checked rather than eyeballed. These are what
 * the bench is FOR, and they are all consequences of WHERE the load is rather than of
 * how heavy it is:
 *
 *   - a stock car is its catalogue's — the front share the game resolves is the one
 *     `frontWeightFraction` published, which the identity run proves the long way round;
 *   - a load in the HOLD is behind the rear axle, so it must lighten the nose, load the
 *     tail, and make the tail drop further than the nose: the last of these is the
 *     driver-visible form of the first two and is the check a load placed at the car's
 *     own centre of mass cannot pass;
 *   - a corner off its stop still sits by `load / rate` (the length that has to move is
 *     the BODY's: compression is `load / rate` in any implementation, including one
 *     that cancels the sag by stretching the spring's free length), and a corner on its
 *     stop sits lower by less, never through it;
 *   - no wheel leaves the road over either bump, and the car stays in its lane, because a
 *     car that has wandered off the strip has no bump numbers at all.
 */
function verdict(modelId: string, facts: StaticFacts[], bumps: Window[][]): void {
  const failures: string[] = [];
  const empty = facts[0]!;
  for (const list of bumps) {
    for (const w of list) {
      if (w.airMs > 0) failures.push(`a car leaves the ground on the bump for ${w.airMs.toFixed(0)} ms`);
      if (w.maxLateralM > 30) {
        failures.push(`a car wanders ${w.maxLateralM.toFixed(0)} m off the centreline over the run`);
      }
    }
  }
  const axle = (label: string, baseline: AxleFacts, f: AxleFacts): void => {
    // The springs carry the whole car here (see the gate below), so a corner off its
    // stop sits by exactly the change in its parked load over its rate, and nothing else.
    const expectedDropM = (f.staticLoadN - baseline.staticLoadN) / baseline.springRateNPerM;
    const droppedM = baseline.lengthM - f.lengthM;
    if (Math.abs(droppedM - expectedDropM) > 2e-3) {
      failures.push(
        `${label} sits ${mm(droppedM)} mm lower where load/rate says ${mm(expectedDropM)} mm`,
      );
    }
  };
  // A stock car comes out at its catalogue's weight distribution. The game's own share
  // is compared exactly, and the one read back from Rapier's centre of mass — which is
  // stored as a float — to what a float can hold.
  if (Math.abs(empty.gameFrontShare - empty.catalogueFrontShare) > 1e-12) {
    failures.push(
      `a stock car resolves its front share as ${empty.gameFrontShare.toFixed(12)}, not the ` +
        `catalogue's ${empty.catalogueFrontShare.toFixed(12)}`,
    );
  }
  if (Math.abs(empty.frontShare - empty.catalogueFrontShare) > 1e-4) {
    failures.push(
      `a stock car's centre of mass is at z ${empty.comZM.toFixed(5)}, which is a front ` +
        `share of ${empty.frontShare.toFixed(5)} rather than ${empty.catalogueFrontShare.toFixed(5)}`,
    );
  }
  for (let i = 1; i < facts.length; i++) {
    const f = facts[i]!;
    if (f.front.staticLoadN >= empty.front.staticLoadN) {
      failures.push(`+${f.kg} kg in the hold does not lighten the nose`);
    }
    if (f.rear.staticLoadN <= empty.rear.staticLoadN) {
      failures.push(`+${f.kg} kg in the hold does not load the tail`);
    }
    const frontDropM = empty.front.lengthM - f.front.lengthM;
    const rearDropM = empty.rear.lengthM - f.rear.lengthM;
    if (rearDropM <= frontDropM) {
      failures.push(
        `+${f.kg} kg in the hold drops the tail ${mm(rearDropM)} mm and the nose ` +
          `${mm(frontDropM)} mm — it is not behind the rear axle`,
      );
    }
    if (f.rear.lengthM > facts[i - 1]!.rear.lengthM + 1e-4) {
      failures.push(`+${f.kg} kg lifts the tail off the load below it`);
    }
    // `load / rate` is the stiffness of the SPRINGS, so it only settles the car while
    // the springs are carrying it: put the tail on its bump stop and the stop takes part
    // of the corner, which shifts the balance off the nose by more than the share says.
    // The exact check therefore needs both axles off their stops, and the +100 kg pass
    // exists to have one load that qualifies on the small cars.
    const springsOnly =
      f.front.compressionM < f.front.stopBeginsM && f.rear.compressionM < f.rear.stopBeginsM;
    for (const which of ['front', 'rear'] as const) {
      if (springsOnly) {
        axle(`+${f.kg} kg ${which}`, empty[which], f[which]);
      } else {
        if (f[which].compressionM > f[which].travelM + 5e-4) {
          failures.push(
            `+${f.kg} kg ${which} compresses ${mm(f[which].compressionM)} mm, past its ` +
              `${mm(f[which].travelM)} mm of travel`,
          );
        }
      }
    }
  }
  console.log(
    failures.length === 0
      ? `  VERDICT ${modelId}: ok — a boot load lightens the nose, loads the tail, sags ` +
          `the tail further, stays within travel and never leaves the road`
      : `  VERDICT ${modelId}: FAIL\n    ${failures.join('\n    ')}`,
  );
  // A failure is a failure when the real code is being measured. Under `--legacy` the
  // failure IS the result — it is what the before column is supposed to look like — so
  // it must not make the tool look broken to whatever ran it.
  if (failures.length > 0 && !process.argv.includes('--legacy')) process.exitCode = 1;
}

/**
 * The FUEL half of the load story: the same car with a dry tank.
 *
 * Fuel is a load like any other and it is the one that moves every time the car is
 * driven. It is also the case that has to keep working for the cars the game spawns
 * half-full — the roadside working vehicles — so it is measured rather than assumed:
 * the tank sits behind the centre of mass on every front-engined car, so burning it off
 * must move the centre of mass FORWARD and take weight off the tail.
 */
async function fuelRun(modelId: string, full: StaticFacts, legacy: boolean): Promise<void> {
  const rig = await makeRig(modelId);
  const capacity = rig.vehicle.modelDef.tankLitres;
  rig.state.fuelLitres = 0;
  rig.vehicle.refreshLoad();
  if (legacy) applyLegacyMass(rig);
  settle(rig, 5);
  const dry = reportStatic(modelId, 0, rig);
  rig.vehicle.dispose();

  const failures: string[] = [];
  if (Math.abs(dry.massKg - (full.massKg - capacity * FUEL_DENSITY)) > 0.05) {
    failures.push(
      `a dry tank weighs ${dry.massKg.toFixed(1)} kg where ${capacity} L says ` +
        `${(full.massKg - capacity * FUEL_DENSITY).toFixed(1)} kg`,
    );
  }
  if (dry.gameFrontShare <= full.gameFrontShare) {
    failures.push(
      `a dry tank does not move the centre of mass forward (front share ` +
        `${(full.gameFrontShare * 100).toFixed(1)}% full, ${(dry.gameFrontShare * 100).toFixed(1)}% dry)`,
    );
  }
  if (dry.rear.staticLoadN >= full.rear.staticLoadN) {
    failures.push(`a dry tank does not lighten the tail`);
  }
  // The nose keeps more of what the tail loses: on a lighter car its absolute load may
  // still fall, because the whole car lost weight, and only the RELATIVE share has to
  // move forward — which is the check above.
  const frontLossN = full.front.staticLoadN - dry.front.staticLoadN;
  const rearLossN = full.rear.staticLoadN - dry.rear.staticLoadN;
  if (rearLossN <= frontLossN) {
    failures.push(
      `a dry tank takes ${rearLossN.toFixed(0)} N off the tail and ${frontLossN.toFixed(0)} N off the nose`,
    );
  }
  if (dry.rideHeightM < full.rideHeightM - 1e-4) {
    failures.push(`a dry tank sits the car lower than a full one`);
  }
  const deg = (m: number): string => (m * 1000).toFixed(0);
  console.log(
    `  dry tank (0 of ${capacity} L, ${(-capacity * FUEL_DENSITY).toFixed(1)} kg at the tank): ` +
      `mass ${dry.massKg.toFixed(0)} kg, front share ` +
      `${(dry.gameFrontShare * 100).toFixed(1)}% (${(full.gameFrontShare * 100).toFixed(1)}% full), ` +
      `static ${dry.front.staticLoadN.toFixed(0)}/${dry.rear.staticLoadN.toFixed(0)} N ` +
      `(${full.front.staticLoadN.toFixed(0)}/${full.rear.staticLoadN.toFixed(0)} full), ` +
      `centre of mass z ${dry.comZM.toFixed(3)} (${full.comZM.toFixed(3)}) y ${dry.comYM.toFixed(3)} ` +
      `(${full.comYM.toFixed(3)}), ride height ${deg(dry.rideHeightM)} mm ` +
      `(${deg(full.rideHeightM)} mm)`,
  );
  console.log(
    failures.length === 0
      ? `  VERDICT ${modelId} fuel: ok — a dry tank moves the centre of mass forward and ` +
          `takes weight off the tail`
      : `  VERDICT ${modelId} fuel: FAIL\n    ${failures.join('\n    ')}`,
  );
  if (failures.length > 0 && !legacy) process.exitCode = 1;
}

/**
 * The identity this change has to keep: a STOCK car is its catalogue's, to the last
 * digit. Builds the same unloaded car twice, once with the pre-change mass placement put
 * back through `applyLegacyMass`, and compares everything the static section measures.
 * If a crate-loading change ever moves the empty car, this is what catches it.
 */
async function identityRun(modelId: string): Promise<void> {
  const fresh = await makeRig(modelId);
  settle(fresh, 5);
  const before = reportStatic(modelId, 0, fresh);
  fresh.vehicle.dispose();

  const legacy = await makeRig(modelId);
  applyLegacyMass(legacy);
  settle(legacy, 5);
  const after = reportStatic(modelId, 0, legacy);
  legacy.vehicle.dispose();

  const failures: string[] = [];
  const compare = (what: string, a: number, b: number, tolerance: number): void => {
    if (Math.abs(a - b) > tolerance) {
      failures.push(`${what}: ${a} with the real centre of mass, ${b} with the legacy one`);
    }
  };
  const axles = ['front', 'rear'] as const;
  compare('centre of mass z', before.comZM, after.comZM, 1e-6);
  compare('centre of mass y', before.comYM, after.comYM, 1e-6);
  compare('front share', before.gameFrontShare, after.gameFrontShare, 1e-12);
  for (const which of axles) {
    compare(`${which} static load`, before[which].staticLoadN, after[which].staticLoadN, 1e-9);
    compare(`${which} length`, before[which].lengthM, after[which].lengthM, 1e-6);
    compare(`${which} compression`, before[which].compressionM, after[which].compressionM, 1e-6);
  }
  console.log(
    failures.length === 0
      ? `  IDENTITY ${modelId}: ok — a stock car is the car it always was, to the float ` +
          `Rapier stores its centre of mass in`
      : `  IDENTITY ${modelId}: FAIL\n    ${failures.join('\n    ')}`,
  );
  if (failures.length > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  await RAPIER.init();
  const undoDocument = installDocumentShim();
  installAssetShim();
  const legacy = process.argv.includes('--legacy');
  const identity = process.argv.includes('--identity');
  const debug = process.argv.includes('--debug');
  const ids = MODELS.length > 0 ? MODELS : DEFAULT_MODELS;
  await preloadCarModels(ids);
  try {
    lawSection();
    for (const id of ids) {
      if (identity) {
        await identityRun(id);
        console.log('');
        continue;
      }
      const facts: StaticFacts[] = [];
      const bumps: Window[][] = [];
      for (const kg of LOADS_KG) {
        const rig = await makeRig(id);
        if (kg > 0) loadCargo(rig, kg);
        // `--legacy` puts the pre-real-COM car back — the whole mass at the car's own
        // centre of mass and the pre-fix suspension geometry — through public surfaces,
        // so the before column is measured by this bench rather than by an older build.
        if (legacy) {
          applyLegacyMass(rig);
          if (kg > 0) applyLegacyGeometry(rig);
        }
        // Everything the load changed (springs, stance, the low-passed load the tyre
        // model reads) has to be settled before anything is measured, or the numbers
        // are the car it was a second ago.
        settle(rig, 5);
        if (debug) traceWheel(rig, `${id}+${kg}`);
        facts.push(reportStatic(id, kg, rig));
        bumps.push(reportHump(humpRun(rig)));
        reportRunEnd(rig);
        rig.vehicle.dispose();

        // The roll test gets its own rig: the bump run leaves the tyres warm and the car
        // a lane off centre, and the lateral share of the grip budget is read straight
        // off the tyre temperature.
        const rollRig = await makeRig(id);
        if (kg > 0) loadCargo(rollRig, kg);
        if (legacy) {
          applyLegacyMass(rollRig);
          if (kg > 0) applyLegacyGeometry(rollRig);
        }
        settle(rollRig, 5);
        const roll = rollRun(rollRig);
        console.log(
          `  step steer 0.35 at ${roll.speedKmh.toFixed(0)} km/h: peak roll ` +
            `${roll.peakRollDeg.toFixed(2)} deg, steady ${roll.steadyRollDeg.toFixed(2)} deg, ` +
            `peak corner force ${roll.peakForceN.toFixed(0)} N`,
        );
        rollRig.vehicle.dispose();

        // A third rig for the lift-off: the roll run ends mid-slide, which is the wrong
        // state to lift out of, and the tyres it has just heated would flatter the rear.
        const liftRig = await makeRig(id);
        if (kg > 0) loadCargo(liftRig, kg);
        if (legacy) {
          applyLegacyMass(liftRig);
          if (kg > 0) applyLegacyGeometry(liftRig);
        }
        settle(liftRig, 5);
        const lift = liftRun(liftRig);
        const deg = (rad: number): string => ((rad * 180) / Math.PI).toFixed(2);
        console.log(
          `  lift-off in a ${LIFT_TURN_INPUT} steer at ${lift.speedKmh.toFixed(0)} km/h: ` +
            `slip front ${deg(lift.frontSlipBeforeRad)} -> ${deg(lift.frontSlipAfterRad)} deg, ` +
            `rear ${deg(lift.rearSlipBeforeRad)} -> ${deg(lift.rearSlipAfterRad)} deg, ` +
            `yaw rate ${lift.yawBeforeRadS.toFixed(3)} -> ${lift.yawAfterRadS.toFixed(3)} rad/s`,
        );
        liftRig.vehicle.dispose();
        console.log('');
      }
      verdict(id, facts, bumps);
      await fuelRun(id, facts[0]!, legacy);
      console.log('');
    }
  } finally {
    undoDocument();
  }
}

await main();
