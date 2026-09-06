/**
 * tools/handling-bench.ts
 *
 * Instrumented driving bench for the vehicle model. It builds a private Rapier
 * world with one flat asphalt plane, drops one catalogue car on it, and drives it
 * with scripted `InputFrame`s at the simulation's own fixed timestep — the real
 * `Vehicle.fixedUpdate`, not a re-implementation — while measuring what a test
 * driver would measure:
 *
 *   accel      0-100 km/h and the speed reached in 20 s
 *   brake      100-0 km/h distance and peak deceleration, plus which axle locks
 *              first and how far the car yaws while it is stopping
 *   skidpad    steady-state lateral g and the slip angle it holds
 *   play       yaw rate for a small steering input, which is what the steering
 *              box's free play is supposed to swallow
 *   settle     ride height and body roll, to catch a spring that bottoms out
 *
 * It is loaded from the dev server in a browser (Rapier is WASM and Three wants a
 * document), so it runs as:
 *
 *   import { runBench } from '/tools/handling-bench.ts';
 *   await runBench(['sv_vaz2101', 'sa_vaz2110']);
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';
import { PhysicsWorld, FIXED_DT } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState, type CarState } from '../src/game/state';
import { Vehicle } from '../src/vehicle/vehicle';
import { emptyInput, type InputFrame } from '../src/core/input';
import { preloadCarModels } from '../src/render/carmodel';
import { CAR_MODELS, carModel } from '../src/vehicle/carmodels';
import { createBonnetStorage } from '../src/vehicle/bonnet';
import { COLD_SOAK_C } from '../src/vehicle/cooling';
import { variant } from '../src/parts/registry';
import type { Item } from '../src/items/items';
import { Trailer, TRAILER_TARE_KG } from '../src/vehicle/trailer';
import { WorldOrigin } from '../src/world/origin';

export interface BenchResult {
  id: string;
  /** Seconds to 100 km/h, or null if it never got there. */
  to100s: number | null;
  speedAfter20s: number;
  /** Sustained flat-out speed on level asphalt, km/h: the settled-window mean. */
  topSpeedKmh: number;
  /**
   * Highest single-step speed seen during that same run. It should sit a shade
   * above `topSpeedKmh`; far above means the chassis was thrown, not driven.
   */
  topSpeedSpikeKmh: number;
  /** Speed the braking test actually entered at, km/h. */
  brakeFromKmh: number;
  /** Braking distance from that speed to a standstill, metres. */
  brakeDistM: number;
  /** Peak and mean deceleration during that stop, in g. */
  brakePeakG: number;
  brakeMeanG: number;
  /** Mean lock-up (0..1) on each axle during the stop. */
  frontLock: number;
  rearLock: number;
  /** Heading change while braking in a straight line, degrees. */
  brakeYawDeg: number;
  /** Steady-state cornering, at whatever speed it could hold. */
  skidpadG: number;
  skidpadSlipDeg: number;
  skidpadRollDeg: number;
  /** Full-lock turning radius at low speed, metres. */
  turnRadiusM: number;
  /**
   * Peak lateral acceleration the car SUSTAINS while cornering speed is raised at
   * full lock, in g. Sampled only while the body is still following the circle
   * (slip angle under `LIMIT_SLIP_CEILING_DEG`), because a spin has a huge yaw
   * rate and would otherwise be recorded as enormous grip.
   */
  limitLateralG: number;
  /** Worst lean seen anywhere in the skidpad run. >45 means it went over. */
  maxLeanDeg: number;
  /** Yaw rate (deg/s) for a 12% steering input at 80 km/h: the play test. */
  smallInputYawRate: number;
  /** Same at 35% input, for the ratio that shows the dead zone. */
  midInputYawRate: number;
  /** Smallest swept input that produced any yaw at all: the play's dead zone. */
  deadZoneInput: number;
  /** Trail braking: cornering curvature with the brakes over curvature without. */
  trailYawGain: number;
  trailFrontSlide: number;
  trailRearSlide: number;
  trailLeanDeg: number;
  /** Settled ride height of the body's lowest point, metres. */
  rideHeightM: number;
  /** Peak-to-peak vertical movement of the chassis cruising on FLAT ground, mm. */
  bounceMm: number;
  /** Dominant vertical frequency while cruising, Hz. */
  bounceHz: number;
  /** Seconds for a 0.3 m drop to settle inside 5 mm. */
  settleS: number;
  /** Straight-line lane correction: heading overshoot past the input, degrees. */
  weaveOvershootDeg: number;
  /** Seconds of continuous foot brake before every wheel reads as locked. */
  footLockAtS: number;
  /** Handbrake: rear slide reported on the first step it is pulled (want 1). */
  handbrakeInstantRear: number;
  /** Handbrake: front slide on that same step (want 0 — rears only). */
  handbrakeInstantFront: number;
  /**
   * Braking distance when the pedal is PUMPED (0.9 s on, 0.25 s off) so the wheels
   * never lock, against `brakeDistM` for a pedal simply held down. Cadence braking
   * has to win, or the model teaches the wrong technique.
   */
  pumpedBrakeDistM: number;
  /** Same, but a tight cadence (1.0 s on, 0.12 s off). */
  cadenceBrakeDistM: number;
}

/**
 * A roadworthy bench car. The bonnet cells and fuel kind are not decoration: the
 * vehicle's stats read the fitted engine through them, and a car with an empty
 * bonnet has no engine to bench.
 */
function carState(modelId: string): CarState {
  const def = carModel(modelId);
  const engine = variant(def.engineId).engine;
  return {
    id: 'bench',
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
    bonnet: createBonnetStorage('bench', def.engineId, def.bodyClass, def.tankLitres),
    odometer: 0,
    x: 0,
    y: 1.2,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  };
}

/** Compass heading of a body quaternion, degrees. */
function headingDeg(q: { x: number; y: number; z: number; w: number }): number {
  const siny = 2 * (q.w * q.y + q.z * q.x);
  const cosy = 1 - 2 * (q.y * q.y + q.x * q.x);
  return (Math.atan2(siny, cosy) * 180) / Math.PI;
}

/**
 * How far the body's own up axis has tilted away from world up, degrees.
 *
 * Not an Euler roll: extracting roll from a quaternion that also carries a large
 * yaw reads the yaw back as roll, which is how a flat car in a hard turn measured
 * 170 degrees of lean. The angle between the two up vectors cannot do that.
 */
function leanDeg(q: { x: number; y: number; z: number; w: number }): number {
  // Body +Y rotated into the world; only its world-Y component is needed.
  const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
  return (Math.acos(Math.max(-1, Math.min(1, upY))) * 180) / Math.PI;
}
/** A flat, infinite-enough plane using the requested tyre surface. */
function addGround(physics: PhysicsWorld, surface = SurfaceType.Asphalt): void {
  const heights = new Float32Array(4);
  physics.addHeightfield(
    1,
    1,
    heights,
    { x: 8000, y: 1, z: 8000 },
    { x: 0, y: 0, z: 0 },
    surface,
  );
}

function addInclineGround(physics: PhysicsWorld, degrees: number): void {
  const halfDepth = 30;
  const rise = Math.tan((degrees * Math.PI) / 180) * halfDepth;
  physics.addStaticTrimesh(
    new Float32Array([
      -30, -rise, -halfDepth,
      30, -rise, -halfDepth,
      -30, rise, halfDepth,
      30, rise, halfDepth,
    ]),
    new Uint32Array([0, 1, 2, 2, 1, 3]),
    SurfaceType.Asphalt,
  );
}

/** A 20° asphalt incline: steeper than the game's normal roads. */
function addSlopeGround(physics: PhysicsWorld): void {
  addInclineGround(physics, 20);
}

/** A normal-road incline steep enough to produce an immediate neutral rollback. */
function addRollbackGround(physics: PhysicsWorld): void {
  addInclineGround(physics, 8);
}

interface Rig {
  physics: PhysicsWorld;
  vehicle: Vehicle;
  scene: THREE.Scene;
  input: InputFrame;
  /** Coupled trailer, when the run is a towing run. */
  trailer: Trailer | null;
}

/**
 * Builds the bench rig, optionally towing.
 *
 * `trailerCargoKg` non-null couples a trailer with that load on it. The trailer
 * goes through the same drawbar hitch the game uses, so what the bench measures is
 * the real constraint and the real tongue weight, not an approximation of them.
 */
async function makeRig(
  modelId: string,
  ground: (physics: PhysicsWorld) => void = addGround,
  settleWithHandbrake = false,
  trailerCargoKg: number | null = null,
): Promise<Rig> {
  const physics = await PhysicsWorld.create();
  ground(physics);
  const world = new GameWorld(newWorldState(1));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const state = carState(modelId);
  world.state.cars[state.id] = state;
  const vehicle = new Vehicle(physics, world, state, scene, origin);
  const input = emptyInput();
  input.handbrake = settleWithHandbrake;

  let trailer: Trailer | null = null;
  if (trailerCargoKg !== null) {
    const trailerState = {
      id: 'bench:trailer',
      hitchedTo: null,
      cargoKg: 0,
      x: state.x,
      y: state.y,
      z: state.z - 6,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
    };
    world.state.trailers[trailerState.id] = trailerState;
    trailer = new Trailer(physics, world, trailerState, scene, origin);
    trailer.setCargo(trailerCargoKg);
    trailer.hitchTo(vehicle, state.id);
  }

  const rig: Rig = { physics, vehicle, scene, input, trailer };
  // Let it settle onto its springs before anything is measured. A towed rig needs
  // longer: the drawbar has to straighten and both bodies have to stop bobbing.
  const settleSteps = trailer ? 420 : 180;
  for (let i = 0; i < settleSteps; i++) {
    rig.vehicle.fixedUpdate(FIXED_DT, rig.input);
    rig.trailer?.fixedUpdate(FIXED_DT);
    rig.physics.step();
    rig.vehicle.postStep();
    rig.trailer?.postStep();
  }
  return rig;
}

function drive(rig: Rig, seconds: number, shape: (t: number, f: InputFrame) => void): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    shape(i * FIXED_DT, rig.input);
    rig.vehicle.fixedUpdate(FIXED_DT, rig.input);
    rig.trailer?.fixedUpdate(FIXED_DT);
    rig.physics.step();
    rig.vehicle.postStep();
    rig.trailer?.postStep();
  }
}

/**
 * `drive`, but it stops as soon as `until` is true. For preconditions that are a
 * STATE the car has to reach ("it is now rolling backwards") rather than a duration:
 * a fixed window makes such a test depend on how quickly the springs settle, which is
 * not what it is checking.
 */
function driveUntil(
  rig: Rig,
  seconds: number,
  shape: (t: number, f: InputFrame) => void,
  until: (t: number) => boolean,
): boolean {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    shape(i * FIXED_DT, rig.input);
    rig.vehicle.fixedUpdate(FIXED_DT, rig.input);
    rig.trailer?.fixedUpdate(FIXED_DT);
    rig.physics.step();
    rig.vehicle.postStep();
    rig.trailer?.postStep();
    if (until(i * FIXED_DT)) return true;
  }
  return false;
}

/**
 * Body slip angle past which a full-lock circle has stopped being a cornering
 * measurement. A period car holds 4-8 degrees at its limit; 12 is generous room
 * above that and still far below the 20-30 degrees of an actual slide.
 */
const LIMIT_SLIP_CEILING_DEG = 12;
/** Fixed time for the full-lock entry transient to wash out before settle detection. */
const LIMIT_ENTRY_S = 6;
/** How long the car has to stay past that ceiling before it counts as let go. */
const LIMIT_SLIDE_HOLD_S = 0.4;
/** How long it has to hold under the ceiling before the circle counts as settled. */
const LIMIT_SETTLE_S = 1.0;

/** Body-frame lateral speed / forward speed, in degrees. */
function slipAngleDeg(v: Vehicle): number {
  const s = v.audio;
  const fwd = Math.abs(s.forwardMps);
  if (fwd < 0.5) return 0;
  return (Math.atan2(Math.abs(s.lateralSlipMps), fwd) * 180) / Math.PI;
}

/**
 * Every metric for one car. `towKg` non-null runs the whole sheet while towing a
 * loaded trailer, which is the only honest way to read the handling cost of
 * freight: hitch load lands on the rear axle through the joint, and the brake and
 * grip budgets are sized from the CAR's mass alone.
 */
export async function benchOne(
  modelId: string,
  towKg: number | null = null,
): Promise<BenchResult> {
  const out: BenchResult = {
    id: modelId,
    to100s: null,
    speedAfter20s: 0,
    topSpeedKmh: 0,
    topSpeedSpikeKmh: 0,
    brakeFromKmh: 0,
    brakeDistM: 0,
    brakePeakG: 0,
    brakeMeanG: 0,
    frontLock: 0,
    rearLock: 0,
    brakeYawDeg: 0,
    skidpadG: 0,
    skidpadSlipDeg: 0,
    skidpadRollDeg: 0,
    turnRadiusM: 0,
    limitLateralG: 0,
    maxLeanDeg: 0,
    smallInputYawRate: 0,
    midInputYawRate: 0,
    deadZoneInput: 0,
    trailYawGain: 0,
    trailFrontSlide: 0,
    trailRearSlide: 0,
    trailLeanDeg: 0,
    rideHeightM: 0,
    bounceMm: 0,
    bounceHz: 0,
    settleS: 0,
    weaveOvershootDeg: 0,
    footLockAtS: 0,
    handbrakeInstantRear: 0,
    handbrakeInstantFront: 0,
    pumpedBrakeDistM: 0,
    cadenceBrakeDistM: 0,
  };

  // --- settle: ride height ---------------------------------------------------
  //
  // `Box3.setFromObject` is useless here: nothing renders this scene, so the wheel
  // and body matrices are never flushed and the box comes back in local space (it
  // read exactly -halfHeight for every car). The chassis body's own translation is
  // authoritative, and the measured half-height turns it into a ground clearance.
  {
    const rig = await makeRig(modelId, addGround, false, towKg);
    const y = rig.vehicle.chassis.translation().y;
    out.rideHeightM = +(y - rig.vehicle.modelMeasure.halfExtents[1]).toFixed(3);
    rig.vehicle.dispose();
  }

  // --- acceleration ---------------------------------------------------------
  //
  // 35 seconds, not 20: the slowest cars here need more than 20 s to see 100 km/h
  // (a 62 hp Zhiguli's factory figure is 22 s and a Volga's is worse), and "never"
  // for a car that takes 24 s says nothing about whether it matches the real one.
  // `speedAfter20s` is still sampled at exactly 20 s.
  {
    const rig = await makeRig(modelId, addGround, false, towKg);
    let t = 0;
    let reached = -1;
    let at20 = 0;
    drive(rig, 35, (_, f) => {
      f.throttle = 1;
      f.brake = 0;
      f.steer = 0;
      if (reached < 0 && rig.vehicle.speedKmh >= 100) reached = t;
      if (at20 === 0 && t >= 20) at20 = rig.vehicle.speedKmh;
      t += FIXED_DT;
    });
    out.to100s = reached < 0 ? null : +reached.toFixed(2);
    out.speedAfter20s = +at20.toFixed(1);
    rig.vehicle.dispose();
  }

  // --- top speed: wait for a level-road plateau -----------------------------
  //
  // Reported as the MEAN of the last window of HORIZONTAL speed, not the highest
  // speed seen. Three things this guards against, all of which were observed:
  //
  //  - a maximum is not a top speed: one bad step becomes the record and stays.
  //    `spikeKmh` keeps that number beside the mean instead of reporting it.
  //  - `speedKmh` includes the vertical component, so a car that leaves the ground
  //    reads faster the further it falls.
  //  - `addGround` is 8 km square, i.e. 4 km of run. A car that needs more than
  //    that drives off the edge and free-falls: the VAZ-2107 measured a 1213 km/h
  //    "plateau" this way, which is terminal velocity, not fifth gear.
  {
    const rig = await makeRig(modelId, addGround, false, towKg);
    const body = rig.vehicle.chassis;
    const start = body.translation();
    const groundY = start.y;
    let windowStartKmh = 0;
    let nextWindowS = 4;
    let windowSum = 0;
    let windowCount = 0;
    let plateauKmh = 0;
    let spikeKmh = 0;
    driveUntil(
      rig,
      180,
      (_, f) => {
        f.throttle = 1;
        f.brake = 0;
        f.steer = 0;
      },
      (t) => {
        const v = body.linvel();
        const speed = Math.hypot(v.x, v.z) * 3.6;
        spikeKmh = Math.max(spikeKmh, speed);
        windowSum += speed;
        windowCount++;
        const p = body.translation();
        // Off the plate, or fallen off it: the run is over, keep what it had.
        if (Math.abs(p.x) > 3500 || Math.abs(p.z) > 3500 || p.y < groundY - 1) {
          if (windowCount > 0) plateauKmh = windowSum / windowCount;
          return true;
        }
        if (t < nextWindowS) return false;
        const gain = speed - windowStartKmh;
        plateauKmh = windowSum / windowCount;
        windowSum = 0;
        windowCount = 0;
        windowStartKmh = speed;
        nextWindowS += 4;
        // Less than 0.15 km/h gained across a four-second window: flat out.
        return gain < 0.15;
      },
    );
    out.topSpeedKmh = +plateauKmh.toFixed(1);
    out.topSpeedSpikeKmh = +spikeKmh.toFixed(1);
    rig.vehicle.dispose();
  }

  // --- braking from 100 km/h ------------------------------------------------
  {
    const rig = await makeRig(modelId, addGround, false, towKg);
    drive(rig, 30, (_, f) => {
      f.throttle = rig.vehicle.speedKmh < 100 ? 1 : 0;
    });
    const body = rig.vehicle.chassis;
    const p0 = body.translation();
    const start = { x: p0.x, z: p0.z };
    const startHeading = headingDeg(body.rotation());
    out.brakeFromKmh = +rig.vehicle.speedKmh.toFixed(1);
    let prevSpeed = rig.vehicle.speedKmh / 3.6;
    let peakDecel = 0;
    let frontSum = 0;
    let rearSum = 0;
    let samples = 0;
    let stopSeconds = 0;
    let stoppedAt: { x: number; z: number } | null = null;
    drive(rig, 12, (_, f) => {
      f.throttle = 0;
      f.brake = 1;
      f.steer = 0;
      const speed = rig.vehicle.speedKmh / 3.6;
      const decel = (prevSpeed - speed) / FIXED_DT;
      prevSpeed = speed;
      if (speed > 1) {
        if (decel > peakDecel) peakDecel = decel;
        const locks = rig.vehicle.audio;
        frontSum += locks.frontLockT;
        rearSum += locks.rearLockT;
        samples++;
        stopSeconds += FIXED_DT;
      } else if (stoppedAt === null) {
        const p = body.translation();
        stoppedAt = { x: p.x, z: p.z };
      }
    });
    const end = stoppedAt ?? body.translation();
    out.brakeDistM = +Math.hypot(end.x - start.x, end.z - start.z).toFixed(1);
    out.brakePeakG = +(peakDecel / 9.81).toFixed(2);
    out.brakeMeanG =
      stopSeconds > 0 ? +(out.brakeFromKmh / 3.6 / stopSeconds / 9.81).toFixed(2) : 0;
    out.frontLock = samples ? +(frontSum / samples).toFixed(2) : 0;
    out.rearLock = samples ? +(rearSum / samples).toFixed(2) : 0;
    out.brakeYawDeg = +Math.abs(headingDeg(body.rotation()) - startHeading).toFixed(1);
    rig.vehicle.dispose();
  }

  // --- skidpad: hold ~60 km/h at full steer, measure what it actually pulls --
  {
    const rig = await makeRig(modelId, addGround, false, towKg);
    drive(rig, 20, (_, f) => {
      f.throttle = rig.vehicle.speedKmh < 60 ? 1 : 0;
    });
    let gSum = 0;
    let slipSum = 0;
    let rollSum = 0;
    let n = 0;
    drive(rig, 10, (t, f) => {
      f.throttle = rig.vehicle.speedKmh < 60 ? 0.6 : 0;
      f.steer = 1;
      const lean = leanDeg(rig.vehicle.chassis.rotation());
      if (lean > out.maxLeanDeg) out.maxLeanDeg = +lean.toFixed(1);
      if (t > 4) {
        const body = rig.vehicle.chassis;
        const av = body.angvel();
        const speed = Math.abs(rig.vehicle.audio.forwardMps);
        // Lateral acceleration of a steady turn: yaw rate x forward speed.
        gSum += Math.abs(av.y * speed) / 9.81;
        slipSum += slipAngleDeg(rig.vehicle);
        rollSum += lean;
        n++;
      }
    });
    out.skidpadG = n ? +(gSum / n).toFixed(2) : 0;
    out.skidpadSlipDeg = n ? +(slipSum / n).toFixed(1) : 0;
    out.skidpadRollDeg = n ? +(rollSum / n).toFixed(1) : 0;
    rig.vehicle.dispose();
  }

  // --- turning circle: full lock at a factory-figure pace ------------------
  {
    const rig = await makeRig(modelId, addGround, false, towKg);
    drive(rig, 15, (_, f) => {
      f.throttle = rig.vehicle.speedKmh < 15 ? 1 : 0;
      f.brake = 0;
      f.steer = 0;
    });
    let radiusSum = 0;
    let samples = 0;
    drive(rig, 10, (t, f) => {
      const speedKmh = rig.vehicle.speedKmh;
      // This narrow governor keeps the circle in the 12–18 km/h band: at higher
      // speeds the steering limiter deliberately fades away some of the lock.
      f.throttle = speedKmh < 14 ? 0.35 : speedKmh > 16 ? 0 : 0.15;
      f.brake = 0;
      f.steer = 1;
      if (t > 3) {
        const forwardSpeed = Math.abs(rig.vehicle.audio.forwardMps);
        const yawRate = Math.abs(rig.vehicle.chassis.angvel().y);
        if (forwardSpeed > 1 && yawRate > 0.01) {
          radiusSum += forwardSpeed / yawRate;
          samples++;
        }
      }
    });
    // This is the radius; period turning-circle figures quote its diameter.
    out.turnRadiusM = samples ? +(radiusSum / samples).toFixed(2) : 0;
    rig.vehicle.dispose();
  }

  // --- lateral limit: increase speed around one full-lock circle ------------
  //
  // A CONSTANT-RADIUS test taken UP TO the breakaway, which is how a limit-grip
  // figure is measured and the only window in which the number means grip. Two
  // observed ways to get this wrong, both of them large:
  //
  //  - a spinning car has an enormous yaw rate, so `yawRate * speed` keeps reading
  //    as "lateral g" long after the tyres have given up.
  //  - the RECOVERY from that spin passes back through moderate slip angles with a
  //    yaw rate that is still a spin's, and a slip-angle filter alone lets it
  //    through: a VAZ-2101 that peaked at 0.79 g reported 0.99 g from the flick
  //    after it let go.
  //
  // So the run ENDS at the first genuine breakaway, and the answer is the best
  // half-second average up to that moment.
  {
    const rig = await makeRig(modelId, addGround, false, towKg);
    drive(rig, 15, (_, f) => {
      f.throttle = rig.vehicle.speedKmh < 20 ? 1 : 0;
      f.brake = 0;
      f.steer = 0;
    });
    const lateralWindow: number[] = [];
    let lateralSum = 0;
    let peakSustainedG = 0;
    let slideSeconds = 0;
    let settleSeconds = 0;
    let settled = false;
    const localVelocity = new THREE.Vector3();
    const localAngularVelocity = new THREE.Vector3();
    const inverseRotation = new THREE.Quaternion();
    const readBodyKinematics = (): void => {
      const rotation = rig.vehicle.chassis.rotation();
      inverseRotation.set(-rotation.x, -rotation.y, -rotation.z, rotation.w);
      const velocity = rig.vehicle.chassis.linvel();
      localVelocity.set(velocity.x, velocity.y, velocity.z).applyQuaternion(inverseRotation);
      const angular = rig.vehicle.chassis.angvel();
      localAngularVelocity.set(angular.x, angular.y, angular.z).applyQuaternion(inverseRotation);
    };
    readBodyKinematics();
    let previousLateralMps = localVelocity.x;
    const windowSamples = Math.round(0.5 / FIXED_DT);
    driveUntil(
      rig,
      25,
      (t, f) => {
        const targetKmh = 20 + t * 2;
        // The slow 2 km/h/s target sweep reaches the tyre limit without a throttle
        // jab; unlike the fixed-60 skidpad it records the best sustained cornering.
        f.throttle = Math.max(0, Math.min(1, 0.2 + (targetKmh - rig.vehicle.speedKmh) * 0.08));
        f.brake = 0;
        f.steer = 1;
      },
      (t) => {
        readBodyKinematics();
        const lateralMps = localVelocity.x;
        const lateralAccel =
          (lateralMps - previousLateralMps) / FIXED_DT +
          localAngularVelocity.y * localVelocity.z;
        previousLateralMps = lateralMps;
        const slipDeg = slipAngleDeg(rig.vehicle);
        if (!settled) {
          // ENTRY, not cornering. Full lock applied at 20 km/h asks for a radius
          // no tyre will hold, so every car ploughs before it settles onto the
          // circle it can actually carry. Give that transient six seconds, then
          // require a full second under the real slip ceiling before sampling.
          if (t <= LIMIT_ENTRY_S) return false;
          settleSeconds =
            slipDeg > LIMIT_SLIP_CEILING_DEG ? 0 : settleSeconds + FIXED_DT;
          settled = settleSeconds >= LIMIT_SETTLE_S;
          return false;
        }
        const sliding = slipDeg > LIMIT_SLIP_CEILING_DEG;
        if (sliding) {
          // One excursion is not a breakaway: a bump or a shift throws a slip
          // transient that clears in a tenth of a second. The window is discarded
          // on any excursion, and the run ends only once the car has been past the
          // ceiling for LIMIT_SLIDE_HOLD_S.
          lateralWindow.length = 0;
          lateralSum = 0;
          slideSeconds += FIXED_DT;
          return slideSeconds >= LIMIT_SLIDE_HOLD_S;
        }
        slideSeconds = 0;
        // Actual body-frame acceleration, not `yawRate * speed`: that shortcut is
        // valid only in a perfectly steady circle and over-reports a live axle
        // rotating into a slide. This is the same kinematic identity `Vehicle` uses
        // to feed its roll couple: dv_lateral/dt + yawRate * v_forward.
        const lateralG = Math.abs(lateralAccel) / 9.81;
        lateralWindow.push(lateralG);
        lateralSum += lateralG;
        if (lateralWindow.length > windowSamples) lateralSum -= lateralWindow.shift()!;
        // A half-second moving average rejects a physics-step spike as a "limit".
        if (lateralWindow.length === windowSamples) {
          peakSustainedG = Math.max(peakSustainedG, lateralSum / lateralWindow.length);
        }
        return false;
      },
    );
    out.limitLateralG = +peakSustainedG.toFixed(2);
    rig.vehicle.dispose();
  }

  // --- steering play: where does the box start to bite, at 80 km/h? ---------
  //
  // The play is a backlash window on the ROAD WHEEL angle, so what the driver
  // notices is a band of stick travel that does nothing. Sweeping the input finds
  // that band directly: the first amount that produces any yaw at all is the edge
  // of the dead zone.
  {
    for (const amount of [0.08, 0.12, 0.17, 0.25, 0.35, 0.5]) {
      const rig = await makeRig(modelId, addGround, false, towKg);
      drive(rig, 25, (_, f) => {
        f.throttle = rig.vehicle.speedKmh < 80 ? 1 : 0;
      });
      let yawSum = 0;
      let n = 0;
      drive(rig, 6, (t, f) => {
        f.throttle = rig.vehicle.speedKmh < 80 ? 0.5 : 0;
        f.steer = amount;
        if (t > 2) {
          yawSum += Math.abs((rig.vehicle.chassis.angvel().y * 180) / Math.PI);
          n++;
        }
      });
      const rate = n ? +(yawSum / n).toFixed(2) : 0;
      if (amount === 0.12) out.smallInputYawRate = rate;
      if (amount === 0.35) out.midInputYawRate = rate;
      if (out.deadZoneInput === 0 && rate > 0.5) out.deadZoneInput = amount;
      rig.vehicle.dispose();
    }
  }

  // --- trail braking: the no-ABS test --------------------------------------
  //
  // Braking in a straight line cannot show a rear-biased brake up, because
  // symmetric grip loss makes no yaw moment (measured: 0 degrees of heading change
  // through a full-pedal stop, correctly). The era's failure mode needs a corner:
  // settle into a steady turn, then stand on the pedal and see whether the tail
  // comes round. `trailYawGain` is the yaw rate WITH the brakes over the yaw rate
  // without them, so >1 means the car rotates more than the driver asked for.
  {
    const rates: number[] = [];
    for (const braking of [false, true]) {
      const rig = await makeRig(modelId, addGround, false, towKg);
      drive(rig, 22, (_, f) => {
        f.throttle = rig.vehicle.speedKmh < 70 ? 1 : 0;
      });
      // Settle into the turn first, unbraked, so both runs enter identically.
      drive(rig, 3, (_, f) => {
        f.throttle = 0;
        f.steer = 0.6;
      });
      let curveSum = 0;
      let n = 0;
      // 1.0 s of pedal: under LOCK_HOLD_S, so this measures the ROLLING regime,
      // where a rear-biased brake stepping the tail out is the claim. Past the lock
      // timer every wheel is sliding and curvature stops meaning anything.
      drive(rig, 1.0, (t, f) => {
        f.throttle = 0;
        f.steer = 0.6;
        f.brake = braking ? 1 : 0;
        if (t > 0.35) {
          // Curvature, not yaw rate: yaw rate is v/R, so braking lowers it just by
          // slowing the car and a rear that is genuinely coming round reads as
          // "calmer". Rotation per metre travelled is the honest comparison.
          const speed = Math.max(1, Math.abs(rig.vehicle.audio.forwardMps));
          curveSum += Math.abs(rig.vehicle.chassis.angvel().y) / speed;
          n++;
          if (braking) {
            out.trailRearSlide = Math.max(out.trailRearSlide, +rig.vehicle.audio.rearLockT.toFixed(2));
            out.trailFrontSlide = Math.max(
              out.trailFrontSlide,
              +rig.vehicle.audio.frontLockT.toFixed(2),
            );
          }
        }
      });
      rates.push(n ? curveSum / n : 0);
      out.trailLeanDeg = Math.max(out.trailLeanDeg, +leanDeg(rig.vehicle.chassis.rotation()).toFixed(1));
      rig.vehicle.dispose();
    }
    out.trailYawGain = rates[0] > 1e-6 ? +(rates[1] / rates[0]).toFixed(2) : 0;
  }

  // --- bounce: is the body still moving when the road is not? ---------------
  //
  // Flat ground, steady 60 km/h. Anything the chassis does vertically here is the
  // suspension oscillating on its own, because there is nothing to excite it: a
  // well-damped car is a flat line and a pogo stick is not.
  {
    const rig = await makeRig(modelId, addGround, false, towKg);
    drive(rig, 20, (_, f) => {
      f.throttle = rig.vehicle.speedKmh < 60 ? 1 : 0;
    });
    const ys: number[] = [];
    drive(rig, 6, (_, f) => {
      f.throttle = rig.vehicle.speedKmh < 60 ? 0.35 : 0;
      ys.push(rig.vehicle.chassis.translation().y);
    });
    const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
    out.bounceMm = +((Math.max(...ys) - Math.min(...ys)) * 1000).toFixed(1);
    // Zero crossings of the mean-removed signal give the dominant frequency without
    // needing an FFT for a signal this clean.
    let crossings = 0;
    for (let i = 1; i < ys.length; i++) {
      if (ys[i - 1] - mean < 0 && ys[i] - mean >= 0) crossings++;
    }
    out.bounceHz = +(crossings / (ys.length * FIXED_DT)).toFixed(2);
    rig.vehicle.dispose();
  }

  // --- settle: drop it and see how long the body keeps moving ---------------
  {
    const rig = await makeRig(modelId, addGround, false, towKg);
    const body = rig.vehicle.chassis;
    const p = body.translation();
    body.setTranslation({ x: p.x, y: p.y + 0.3, z: p.z }, true);
    let quietFor = 0;
    let total = 0;
    let prevY = body.translation().y;
    drive(rig, 8, () => {
      const y = body.translation().y;
      const moved = Math.abs(y - prevY);
      prevY = y;
      total += FIXED_DT;
      if (moved < 0.0005) quietFor += FIXED_DT;
      else quietFor = 0;
      if (out.settleS === 0 && quietFor > 0.3) out.settleS = +(total - quietFor).toFixed(2);
    });
    if (out.settleS === 0) out.settleS = 8;
    rig.vehicle.dispose();
  }

  // --- weave: can it hold a line with small corrections? --------------------
  //
  // 80 km/h, a 0.2 lane-correction held for 0.7 s and then released to centre. A car
  // that tracks straight returns to its heading; a car fighting its own steering play
  // and its own body movement keeps turning after the input is gone, which is the
  // overshoot measured here.
  {
    const rig = await makeRig(modelId, addGround, false, towKg);
    drive(rig, 25, (_, f) => {
      f.throttle = rig.vehicle.speedKmh < 80 ? 1 : 0;
    });
    const body = rig.vehicle.chassis;
    const h0 = headingDeg(body.rotation());
    let headingAtRelease = h0;
    drive(rig, 0.7, (_, f) => {
      f.throttle = 0.3;
      f.steer = 0.2;
    });
    headingAtRelease = headingDeg(body.rotation());
    let worst = headingAtRelease;
    drive(rig, 2.5, (_, f) => {
      f.throttle = 0.3;
      f.steer = 0;
      const h = headingDeg(body.rotation());
      if (Math.abs(h - h0) > Math.abs(worst - h0)) worst = h;
    });
    out.weaveOvershootDeg = +Math.abs(worst - headingAtRelease).toFixed(1);
    rig.vehicle.dispose();
  }

  // --- locking brakes -------------------------------------------------------
  //
  // Two separate claims to check. The foot brake must lock every wheel only after a
  // continuous hold, so the timer is read by watching when both axles report a full
  // slide. The handbrake must lock the REAR axle on the very first step it is pulled
  // and leave the front alone.
  {
    const rig = await makeRig(modelId, addGround, false, towKg);
    drive(rig, 24, (_, f) => {
      f.throttle = rig.vehicle.speedKmh < 90 ? 1 : 0;
    });
    let held = 0;
    drive(rig, 3, (_, f) => {
      f.throttle = 0;
      f.brake = 1;
      const a = rig.vehicle.audio;
      if (out.footLockAtS === 0 && a.frontLockT > 0.99 && a.rearLockT > 0.99) {
        out.footLockAtS = +held.toFixed(2);
      }
      held += FIXED_DT;
    });
    rig.vehicle.dispose();
  }
  {
    const rig = await makeRig(modelId, addGround, false, towKg);
    drive(rig, 24, (_, f) => {
      f.throttle = rig.vehicle.speedKmh < 90 ? 1 : 0;
    });
    // Exactly one step with the handbrake pulled and the foot brake untouched.
    let step = 0;
    drive(rig, 0.2, (_, f) => {
      f.throttle = 0;
      f.brake = 0;
      f.handbrake = true;
      if (step === 1) {
        out.handbrakeInstantRear = +rig.vehicle.audio.rearLockT.toFixed(2);
        out.handbrakeInstantFront = +rig.vehicle.audio.frontLockT.toFixed(2);
      }
      step++;
    });
    rig.vehicle.dispose();
  }

  // --- cadence braking: does pumping the pedal beat holding it? ------------
  for (const [onS, offS, key] of [
    [0.9, 0.25, 'pumpedBrakeDistM'],
    [1.0, 0.12, 'cadenceBrakeDistM'],
  ] as const) {
    const rig = await makeRig(modelId, addGround, false, towKg);
    drive(rig, 30, (_, f) => {
      f.throttle = rig.vehicle.speedKmh < 100 ? 1 : 0;
    });
    const body = rig.vehicle.chassis;
    const p0 = body.translation();
    const start = { x: p0.x, z: p0.z };
    let stoppedAt: { x: number; z: number } | null = null;
    drive(rig, 14, (t, f) => {
      f.throttle = 0;
      f.steer = 0;
      // Every press stays under LOCK_HOLD_S, so the tyres keep turning and keep
      // their grip; the release is dead time that has to be paid for.
      f.brake = t % (onS + offS) < onS ? 1 : 0;
      if (rig.vehicle.speedKmh / 3.6 <= 1 && stoppedAt === null) {
        const p = body.translation();
        stoppedAt = { x: p.x, z: p.z };
      }
    });
    const end = stoppedAt ?? body.translation();
    out[key] = +Math.hypot(end.x - start.x, end.z - start.z).toFixed(1);
    rig.vehicle.dispose();
  }

  return out;
}

/**
 * Focused surface check at one speed and steering input. Unlike the full bench,
 * this is deliberately small enough to compare loose-surface tuning interactively.
 */
export async function runSurfaceCorneringCheck(
  modelId = 'sv_vaz2101',
  surface = SurfaceType.Asphalt,
  targetSpeedKmh = 45,
  steer = 0.5,
): Promise<{
  surface: SurfaceType;
  speedKmh: number;
  lateralG: number;
  yawRateDegS: number;
  radiusM: number;
  slipDeg: number;
}> {
  await preloadCarModels([modelId]);
  const rig = await makeRig(modelId, (physics) => addGround(physics, surface));
  drive(rig, 20, (_, input) => {
    input.throttle = rig.vehicle.speedKmh < targetSpeedKmh ? 1 : 0;
  });
  let speedSum = 0;
  let lateralGSum = 0;
  let yawRateSum = 0;
  let slipSum = 0;
  let samples = 0;
  drive(rig, 8, (time, input) => {
    input.throttle = rig.vehicle.speedKmh < targetSpeedKmh ? 0.6 : 0;
    input.steer = steer;
    if (time > 4) {
      const speed = Math.abs(rig.vehicle.audio.forwardMps);
      const yawRate = Math.abs(rig.vehicle.chassis.angvel().y);
      speedSum += speed * 3.6;
      lateralGSum += (yawRate * speed) / 9.81;
      yawRateSum += yawRate;
      slipSum += slipAngleDeg(rig.vehicle);
      samples++;
    }
  });
  rig.vehicle.dispose();
  const meanSpeedMps = samples ? speedSum / samples / 3.6 : 0;
  const meanYawRate = samples ? yawRateSum / samples : 0;
  return {
    surface,
    speedKmh: +(meanSpeedMps * 3.6).toFixed(1),
    lateralG: samples ? +(lateralGSum / samples).toFixed(2) : 0,
    yawRateDegS: +((meanYawRate * 180) / Math.PI).toFixed(1),
    radiusM: meanYawRate > 0 ? +(meanSpeedMps / meanYawRate).toFixed(1) : 0,
    slipDeg: samples ? +(slipSum / samples).toFixed(1) : 0,
  };
}

export async function runBench(
  ids?: readonly string[],
  towKg: number | null = null,
): Promise<BenchResult[]> {
  const list = ids ?? CAR_MODELS.map((d) => d.id);
  await preloadCarModels(list);
  const results: BenchResult[] = [];
  for (const id of list) results.push(await benchOne(id, towKg));
  return results;
}

/**
 * Side-by-side sheet for one car, solo against towing. Prints the deltas that
 * matter when re-tuning suspension for a trailer: braking distance, steady-state
 * lateral grip and body roll.
 */
export async function benchTowing(
  modelId: string,
  cargoKg = 650,
): Promise<{ solo: BenchResult; towing: BenchResult; tareKg: number }> {
  await preloadCarModels([modelId]);
  const solo = await benchOne(modelId, null);
  const towing = await benchOne(modelId, cargoKg);
  return { solo, towing, tareKg: TRAILER_TARE_KG };
}

/**
 * Regression check for a latched parking brake: after suspension settling, a car
 * must move less than 2 cm over ten seconds on a 20° asphalt slope.
 */
export async function runParkingSlopeCheck(modelId = 'sa_vaz2110'): Promise<number> {
  await preloadCarModels([modelId]);
  const rig = await makeRig(modelId, addSlopeGround, true);
  const start = rig.vehicle.chassis.translation();
  const origin = { x: start.x, z: start.z };
  drive(rig, 10, (_, input) => {
    input.throttle = 0;
    input.brake = 0;
    input.steer = 0;
    input.handbrake = true;
  });
  const end = rig.vehicle.chassis.translation();
  const driftM = Math.hypot(end.x - origin.x, end.z - origin.z);
  rig.vehicle.dispose();
  if (driftM > 0.02) {
    throw new Error(`Parking brake drifted ${driftM.toFixed(3)} m on a 20° slope`);
  }
  return driftM;
}

/**
 * Regression check for an automatic starting in neutral on an incline. Once a
 * slow rollback has begun, throttle must engage first and drive the car uphill
 * without requiring the chassis to stop before the gearbox responds.
 */
export async function runAutomaticRollbackCheck(
  modelId = 'sa_vaz2110',
): Promise<{ rollbackMps: number; recoveryS: number; finalMps: number }> {
  await preloadCarModels([modelId]);
  const rig = await makeRig(modelId, addRollbackGround, true);
  const movingMps = 0.1;

  // Roll UNTIL it is rolling, and no further: the test is about a car that has JUST
  // begun to creep backwards. The window used to be a fixed 0.25 s, which is not a
  // property of the car under test but of how quickly the suspension settles after
  // the parking brake lets go — and period-correct soft springs take longer over that
  // than the old stiff ones did, so the precondition failed on a car that rolls back
  // perfectly well. Two seconds without reaching a creep is still a hard failure.
  const rolling = driveUntil(
    rig,
    2,
    (_, input) => {
      input.throttle = 0;
      input.brake = 0;
      input.steer = 0;
      input.handbrake = false;
    },
    () => rig.vehicle.audio.forwardMps < -movingMps,
  );
  const rollbackMps = rig.vehicle.audio.forwardMps;
  if (!rolling) {
    rig.vehicle.dispose();
    throw new Error(`Rollback precondition was only ${rollbackMps.toFixed(2)} m/s`);
  }

  let recoveryS = -1;
  drive(rig, 4, (t, input) => {
    input.throttle = 1;
    input.brake = 0;
    input.steer = 0;
    input.handbrake = false;
    if (recoveryS < 0 && rig.vehicle.audio.forwardMps > movingMps) recoveryS = t;
  });
  const finalMps = rig.vehicle.audio.forwardMps;
  rig.vehicle.dispose();

  if (recoveryS < 0 || finalMps <= movingMps) {
    throw new Error(
      `Automatic failed to recover from ${rollbackMps.toFixed(2)} m/s rollback; ` +
        `final speed ${finalMps.toFixed(2)} m/s`,
    );
  }
  return {
    rollbackMps: +rollbackMps.toFixed(2),
    recoveryS: +recoveryS.toFixed(2),
    finalMps: +finalMps.toFixed(2),
  };
}

/**
 * Regression check for selecting reverse from neutral while already rolling
 * backward. The flat road isolates reverse torque from gravity.
 */
export async function runAutomaticNeutralReverseCheck(
  modelId = 'sa_vaz2110',
): Promise<{ rollbackMps: number; engagementS: number; finalMps: number }> {
  await preloadCarModels([modelId]);
  const rig = await makeRig(modelId);
  rig.vehicle.chassis.setLinvel({ x: 0, y: 0, z: -0.5 }, true);

  drive(rig, FIXED_DT, (_, input) => {
    input.throttle = 0;
    input.brake = 0;
    input.reverse = false;
  });
  const rollbackMps = rig.vehicle.audio.forwardMps;

  let engagementS = -1;
  drive(rig, 2, (t, input) => {
    input.throttle = 0;
    input.brake = 1;
    input.steer = 0;
    input.handbrake = false;
    input.reverse = true;
    if (engagementS < 0 && rig.vehicle.gearLabel === 'R') engagementS = t;
  });
  const finalMps = rig.vehicle.audio.forwardMps;
  const finalGear = rig.vehicle.gearLabel;
  rig.vehicle.dispose();

  if (rollbackMps >= -0.1) {
    throw new Error(`Reverse rollback precondition was only ${rollbackMps.toFixed(2)} m/s`);
  }
  if (engagementS < 0 || finalGear !== 'R' || finalMps >= rollbackMps - 0.5) {
    throw new Error(
      `Automatic failed to drive backward from ${rollbackMps.toFixed(2)} m/s neutral roll; ` +
        `gear ${finalGear}, final speed ${finalMps.toFixed(2)} m/s`,
    );
  }
  return {
    rollbackMps: +rollbackMps.toFixed(2),
    engagementS: +engagementS.toFixed(2),
    finalMps: +finalMps.toFixed(2),
  };
}
