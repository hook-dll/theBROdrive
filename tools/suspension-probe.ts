/**
 * tools/suspension-probe.ts
 *
 * What the SPRINGS are doing, measured rather than asserted.
 *
 * `ride-bench.ts` measures the ground and `surface-feel.ts` measures the seat. This
 * measures the thing between them, and it exists because the suspension is the one
 * part of the car whose numbers cannot be read off the catalogue: Rapier's ray-cast
 * spring force is `stiffness * compression * chassis_mass`, a rate PER KILOGRAM, and
 * every quantity a chassis engineer actually thinks in — ride frequency, damping
 * ratio, static deflection, axle load — has to be derived from it. Derive it wrong
 * by a factor of two and every car in the catalogue rides like a race car while the
 * comment above it claims a land yacht.
 *
 * So section one checks the ALGEBRA against a bare Rapier controller with no game
 * code near it: drop a known mass on known springs, count the bounces, and compare
 * with the closed forms the catalogue is written in. Section two runs the real
 * `Vehicle` and reports what a driver would feel.
 *
 *   npx tsx tools/suspension-probe.ts [modelId ...]
 *
 * Nothing here is part of the game bundle.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { installAssetShim } from './assetshim';
import { emptyInput, type InputFrame } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState, type CarState } from '../src/game/state';
import type { Item } from '../src/items/items';
import { variant } from '../src/parts/registry';
import { preloadCarModels } from '../src/render/carmodel';
import { createBonnetStorage } from '../src/vehicle/bonnet';
import {
  carModel,
  heaveFrequencyHz,
  suspensionDampingRatio,
  wheelSpringRate,
} from '../src/vehicle/carmodels';
import { COLD_SOAK_C } from '../src/vehicle/cooling';
import { Vehicle } from '../src/vehicle/vehicle';
import { WorldOrigin } from '../src/world/origin';

const GRAVITY = 9.81;
const MODELS = process.argv.slice(2);
const DEFAULT_MODELS = ['st_mid_engine_v8', 'sv_vaz2101', 'st_big_saloon', 'st_v8_pickup'];

/* ---------------------------------------------------------------------------
 * Section 1: the law, on a bare controller.
 * ------------------------------------------------------------------------- */

/** A flat trimesh floor at y = 0, big enough that nothing can drive off it. */
function addFloor(world: RAPIER.World): void {
  const h = 200;
  const vertices = new Float32Array([-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(vertices, indices),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );
}

interface LawResult {
  /** Measured static compression of each spring, metres. */
  sagM: number;
  /** Measured free-bounce frequency of the body, Hz. */
  bounceHz: number;
  /** Measured damping ratio, from the decay of successive peaks. */
  zeta: number;
}

/**
 * Drops a rigid box on four ray-cast wheels and measures what it does. `damping`
 * is applied to both compression and rebound so the decay measures ONE ratio.
 */
function measureLaw(mass: number, stiffness: number, damping: number): LawResult {
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = FIXED_DT;
  addFloor(world);

  const radius = 0.35;
  const rest = 0.6;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.2, 0).setAdditionalMass(mass),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.8, 0.5, 2).setDensity(0),
    body,
  );
  const controller = new RAPIER.DynamicRayCastVehicleController(
    body,
    world.broadPhase,
    world.narrowPhase,
    world.bodies,
    world.colliders,
  );
  controller.indexUpAxis = 1;
  controller.setIndexForwardAxis = 2;
  for (const [x, z] of [
    [-0.7, 1.3],
    [0.7, 1.3],
    [-0.7, -1.3],
    [0.7, -1.3],
  ]) {
    const i = controller.numWheels();
    controller.addWheel({ x, y: 0, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, radius);
    controller.setWheelSuspensionStiffness(i, stiffness);
    controller.setWheelSuspensionCompression(i, damping);
    controller.setWheelSuspensionRelaxation(i, damping);
    controller.setWheelMaxSuspensionTravel(i, 0.5);
    controller.setWheelMaxSuspensionForce(i, 1e9);
    controller.setWheelFrictionSlip(i, 2);
    controller.setWheelSideFrictionStiffness(i, 1);
  }

  const step = (): void => {
    controller.updateVehicle(FIXED_DT);
    world.step();
  };

  // Settle, then read the static compression straight off the controller.
  for (let i = 0; i < 3000; i++) step();
  const settledY = body.translation().y;
  const sagM = rest - (controller.wheelSuspensionLength(0) ?? rest);

  // Lift it clear of static and let go: the free response is the body mode.
  body.setTranslation({ x: 0, y: settledY + 0.12, z: 0 }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);

  const ys: number[] = [];
  for (let i = 0; i < 600; i++) {
    step();
    ys.push(body.translation().y - settledY);
  }

  // Peaks of the decaying signal: the spacing is the period, the ratio of two
  // successive ones is the log decrement, and both come from the same array.
  const peaks: { t: number; y: number }[] = [];
  for (let i = 1; i < ys.length - 1; i++) {
    if (ys[i] > ys[i - 1] && ys[i] >= ys[i + 1] && ys[i] > 1e-4) {
      peaks.push({ t: i * FIXED_DT, y: ys[i] });
    }
  }
  let bounceHz = 0;
  let zeta = 0;
  if (peaks.length >= 2) {
    const spans: number[] = [];
    const decrements: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      spans.push(peaks[i].t - peaks[i - 1].t);
      if (peaks[i].y > 0) decrements.push(Math.log(peaks[i - 1].y / peaks[i].y));
    }
    const period = spans.reduce((a, b) => a + b, 0) / spans.length;
    bounceHz = period > 0 ? 1 / period : 0;
    if (decrements.length > 0) {
      const delta = decrements.reduce((a, b) => a + b, 0) / decrements.length;
      zeta = delta / Math.sqrt(4 * Math.PI * Math.PI + delta * delta);
    }
  }

  controller.free();
  world.free();
  return { sagM, bounceHz, zeta };
}

function lawSection(): void {
  console.log('--- Rapier spring law: measured vs the closed forms the catalogue uses ---');
  console.log(
    'mass    k      c     sag mm  predicted   bounce Hz  predicted   zeta   predicted',
  );
  // Two masses per rate, because the whole point of a per-kilogram rate is that
  // NEITHER the sag nor the frequency may move when the mass does.
  for (const stiffness of [12, 24, 44, 70]) {
    for (const mass of [900, 2400]) {
      const damping = 0.3 * Math.sqrt(stiffness);
      const m = measureLaw(mass, stiffness, damping);
      // Closed forms under test. Equal load on four wheels, so each spring carries
      // a quarter of the weight: sag = g / (4k). The body mode is the whole mass on
      // all four springs: omega = sqrt(4 * k * mass / mass) = 2 * sqrt(k).
      const predictedSag = GRAVITY / (4 * stiffness);
      const predictedHz = heaveFrequencyHz(stiffness, 0.25);
      const predictedZeta = suspensionDampingRatio(stiffness, damping, 0.25);
      console.log(
        `${String(mass).padStart(4)}  ${String(stiffness).padStart(4)}  ${damping.toFixed(2).padStart(5)}  ` +
          `${(m.sagM * 1000).toFixed(1).padStart(6)}  ${(predictedSag * 1000).toFixed(1).padStart(9)}  ` +
          `${m.bounceHz.toFixed(3).padStart(9)}  ${predictedHz.toFixed(3).padStart(9)}  ` +
          `${m.zeta.toFixed(3).padStart(5)}  ${predictedZeta.toFixed(3).padStart(9)}`,
      );
    }
  }
  console.log('');
}

/* ---------------------------------------------------------------------------
 * Section 2: the real car.
 * ------------------------------------------------------------------------- */

function carState(modelId: string, y: number): CarState {
  const def = carModel(modelId);
  const engine = variant(def.engineId).engine;
  return {
    id: 'suspension-probe',
    modelId,
    gizmos: {},
    stickers: [],
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
    fuelLitres: 40,
    fuelKind: engine?.fuel ?? null,
    dirt: 0,
    scratches: 0,
    damage: [],
    waterLitres: 10,
    oilLitres: 10,
    engineTempC: COLD_SOAK_C,
    storage: new Array<Item | null>(def.storageCells).fill(null),
    bonnet: createBonnetStorage('suspension-probe', def.engineId, def.bodyClass, def.tankLitres),
    odometer: 0,
    x: 0,
    y,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  };
}

interface Rig {
  physics: PhysicsWorld;
  vehicle: Vehicle;
  input: InputFrame;
}

async function makeRig(modelId: string): Promise<Rig> {
  const physics = await PhysicsWorld.create();
  // Ten kilometres of flat asphalt each way. A 400 m pad looked ample and was not:
  // one rig drives every section back to back, so a car that never turns leaves a
  // small pad mid-bench and reports free fall as a 1.000 g "jolt".
  const h = 10_000;
  physics.addStaticTrimesh(
    new Float32Array([-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h]),
    new Uint32Array([0, 1, 2, 0, 2, 3]),
    SurfaceType.Asphalt,
  );
  const world = new GameWorld(newWorldState(42));
  const state = carState(modelId, 1.4);
  world.state.cars[state.id] = state;
  const vehicle = new Vehicle(physics, world, state, new THREE.Scene(), new WorldOrigin());
  const input = emptyInput();
  for (let i = 0; i < 600; i++) {
    vehicle.fixedUpdate(FIXED_DT, input);
    physics.step();
    vehicle.postStep();
  }
  return { physics, vehicle, input };
}

function run(rig: Rig, seconds: number, each?: (t: number) => void): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    rig.vehicle.fixedUpdate(FIXED_DT, rig.input);
    rig.physics.step();
    rig.vehicle.postStep();
    each?.(i * FIXED_DT);
  }
}

async function carSection(modelId: string): Promise<void> {
  const rig = await makeRig(modelId);
  const { vehicle } = rig;
  const ride = vehicle.wheelRide;
  const mass = vehicle.stats.mass;

  // --- what it is standing on -------------------------------------------------
  let frontStatic = 0;
  let rearStatic = 0;
  let frontLoad = 0;
  let rearLoad = 0;
  let frontComp = 0;
  let rearComp = 0;
  let frontN = 0;
  let rearN = 0;
  for (const w of ride) {
    if (w.isFront) {
      frontStatic += w.staticLoadN;
      frontLoad += w.loadN;
      frontComp += w.compressionM;
      frontN++;
    } else {
      rearStatic += w.staticLoadN;
      rearLoad += w.loadN;
      rearComp += w.compressionM;
      rearN++;
    }
  }
  const weight = mass * GRAVITY;
  const clearance = vehicle.chassis.translation().y - vehicle.modelMeasure.halfExtents[1];
  const susp = vehicle.modelDef.suspension;

  console.log(`--- ${modelId}: ${mass.toFixed(0)} kg, ${ride.length} wheels ---`);
  console.log(
    `  weight split   front ${((frontLoad / Math.max(1, frontLoad + rearLoad)) * 100).toFixed(1)}% ` +
      `measured, ${((frontStatic / weight) * 100).toFixed(1)}% intended` +
      `   (rear ${((rearLoad / Math.max(1, frontLoad + rearLoad)) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  static sag     front ${((frontComp / Math.max(1, frontN)) * 1000).toFixed(0)} mm, ` +
      `rear ${((rearComp / Math.max(1, rearN)) * 1000).toFixed(0)} mm` +
      `   reserve ${Math.min(...ride.map((w) => w.reserveM * 1000)).toFixed(0)} mm`,
  );
  console.log(
    `  ride frequency front ${susp.frontHz.toFixed(2)} Hz, rear ${susp.rearHz.toFixed(2)} Hz asked` +
      `   clearance ${(clearance * 1000).toFixed(0)} mm (target ${(susp.rideHeight * 1000).toFixed(0)} mm)`,
  );

  // --- drop test: frequency and damping, on the real car ----------------------
  //
  // 40 mm, deliberately small. A 120 mm drop puts a soft car straight into its bump
  // stops (a Zhiguli has 100 mm of bump travel), and a measurement taken through the
  // stops reports the stop's frequency, not the spring's.
  {
    const body = vehicle.chassis;
    const settled = body.translation().y;
    body.setTranslation({ x: body.translation().x, y: settled + 0.04, z: body.translation().z }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const ys: number[] = [];
    run(rig, 6, () => ys.push(body.translation().y - settled));
    const peaks: { t: number; y: number }[] = [];
    for (let i = 1; i < ys.length - 1; i++) {
      if (ys[i] > ys[i - 1] && ys[i] >= ys[i + 1] && ys[i] > 2e-4) {
        peaks.push({ t: i * FIXED_DT, y: ys[i] });
      }
    }
    let hz = 0;
    let zeta = 0;
    if (peaks.length >= 2) {
      let span = 0;
      let delta = 0;
      let dn = 0;
      for (let i = 1; i < peaks.length; i++) {
        span += peaks[i].t - peaks[i - 1].t;
        if (peaks[i].y > 0) {
          delta += Math.log(peaks[i - 1].y / peaks[i].y);
          dn++;
        }
      }
      const period = span / (peaks.length - 1);
      hz = period > 0 ? 1 / period : 0;
      if (dn > 0) {
        const d = delta / dn;
        zeta = d / Math.sqrt(4 * Math.PI * Math.PI + d * d);
      }
    }
    // Settling: when the body's remaining motion is under a millimetre. Measured on
    // the AMPLITUDE, not on a per-step delta: a slow drift and a decayed oscillation
    // look identical to a delta threshold.
    let settleS = 0;
    for (let i = ys.length - 1; i > 0; i--) {
      if (Math.abs(ys[i]) > 0.001) {
        settleS = (i + 1) * FIXED_DT;
        break;
      }
    }
    console.log(
      `  drop 40 mm     ${hz.toFixed(2)} Hz, zeta ${zeta.toFixed(2)}, settles in ` +
        `${settleS > 0 ? settleS.toFixed(2) : '<0.02'} s`,
    );
  }

  // --- texture: what a flat, smooth, sealed surface transmits ------------------
  //
  // Flat trimesh, so the collider has no vertical content at all. Anything the
  // chassis reports here is the sub-collider road texture arriving through the
  // tyres, which is the whole point: a soft car must still feel the road.
  for (const speedKmh of [50, 90]) {
    // Bring it up to speed, then hold it there with a proportional throttle: the
    // measurement window must be at ONE speed, because everything about road feel is
    // a function of it.
    const hold = (): void => {
      const error = speedKmh - vehicle.speedKmh;
      rig.input.throttle = Math.max(0, Math.min(1, error * 0.15));
      rig.input.brake = Math.max(0, Math.min(0.4, -error * 0.05));
    };
    run(rig, 22, hold);
    let prevVy = vehicle.chassis.linvel().y;
    const accels: number[] = [];
    let held = 0;
    let deflection = 0;
    let n = 0;
    run(rig, 6, () => {
      hold();
      const vy = vehicle.chassis.linvel().y;
      accels.push(Math.abs((vy - prevVy) / FIXED_DT / GRAVITY));
      prevVy = vy;
      held += vehicle.speedKmh;
      for (const w of ride) deflection = Math.max(deflection, Math.abs(w.tyreDeflectionM));
      n++;
    });
    rig.input.throttle = 0;
    rig.input.brake = 0;
    const rms = Math.sqrt(accels.reduce((a, b) => a + b * b, 0) / Math.max(1, accels.length));
    const sorted = [...accels].sort((a, b) => a - b);
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
    console.log(
      `  texture ${String(speedKmh).padStart(3)} km/h heave ${rms.toFixed(3)} g, jolt ${p99.toFixed(3)} g` +
        `   (held ${(held / Math.max(1, n)).toFixed(0)} km/h, tyre ${(deflection * 1000).toFixed(2)} mm)`,
    );
  }

  // --- attitude: dive under braking, and where the load goes -------------------
  {
    run(rig, 16, () => {
      const error = 70 - vehicle.speedKmh;
      rig.input.throttle = Math.max(0, Math.min(1, error * 0.15));
      rig.input.brake = 0;
    });
    const level = pitchDeg(vehicle.chassis.rotation());
    let dive = 0;
    let frontPeak = 0;
    let rearAtPeak = 0;
    run(rig, 2.2, () => {
      rig.input.throttle = 0;
      rig.input.brake = 1;
      dive = Math.max(dive, Math.abs(level - pitchDeg(vehicle.chassis.rotation())));
      let f = 0;
      let r = 0;
      for (const w of ride) (w.isFront ? (f += w.loadN) : (r += w.loadN));
      if (f > frontPeak) {
        frontPeak = f;
        rearAtPeak = r;
      }
    });
    rig.input.brake = 0;
    const total = frontPeak + rearAtPeak;
    console.log(
      `  brake attitude dive ${dive.toFixed(2)} deg, peak front load ` +
        `${total > 0 ? ((frontPeak / total) * 100).toFixed(1) : '0'}% of the pair`,
    );
  }

  vehicle.dispose();
}

function pitchDeg(q: { x: number; y: number; z: number; w: number }): number {
  const sin = 2 * (q.w * q.x - q.y * q.z);
  return (Math.asin(Math.max(-1, Math.min(1, sin))) * 180) / Math.PI;
}

async function main(): Promise<void> {
  await RAPIER.init();
  lawSection();
  installAssetShim();
  const ids = MODELS.length > 0 ? MODELS : DEFAULT_MODELS;
  await preloadCarModels(ids);
  for (const id of ids) {
    await carSection(id);
    console.log('');
  }
}

await main();
