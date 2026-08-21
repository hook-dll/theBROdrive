/**
 * The drivable car: a Rapier dynamic chassis + ray-cast wheels + the drivetrain
 * simulation, with Three.js meshes as pure derived views.
 *
 * Ownership rules (see game/state.ts): the authoritative state lives in
 * `GameWorld` / `CarState`. This class reads `carState.slots` for part layout,
 * reads/writes the chassis rigid body (the physics-derived view), and emits
 * throttled deltas through `world.apply`. It never mutates `CarState` directly.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../core/physics';
import type { InputFrame } from '../core/input';
import type { CarState, GameWorld } from '../game/state';
import { body, computeCarStats, variant } from '../parts/registry';
import type { BodyDef, CarStats, PartInstance, SlotDef, SlotId } from '../parts/registry';
import { Drivetrain, wheelTorqueToForce } from './drivetrain';
import { createBodyMesh, createPartMesh } from '../render/partmesh';
import { setCondition } from '../render/materials';

const GRAVITY = 9.81;

// ---------------------------------------------------------------------------
// Steering tuning.
//
// Three stages shape the wheel angle, each fixing one piece of the "unnaturally
// railed" feel:
//  1. The input axis is shaped with a power law (STEER_INPUT_EXPONENT), so small
//     deflections command disproportionately small angles and response grows
//     progressively toward full lock.
//  2. The available lock falls off with speed on the t^k curve below: full lock
//     up to STEER_FULL_LOCK_KMH (parking and low-speed manoeuvres), then a fast
//     collapse right above it (k < 1) to about a third of the lock at 40 km/h,
//     and a gentle slide down to the floor — at 100 km/h only 15% of the parking
//     lock remains, so corrections are small by construction.
//  3. The steer angle is rate-limited by speed: it can swing to full lock in ~0.1 s
//     at parking speed but takes ~0.5 s at highway speed, so a sudden full-lock
//     input cannot snap the front wheels when it would hurt.
// ---------------------------------------------------------------------------

/** Steering input shaping exponent: |s|^p with p>1 compresses small deflections. */
const STEER_INPUT_EXPONENT = 1.7;
/** Max rate of steering-angle change at parking speed (rad/s). */
const STEER_RATE_PARK_RAD_S = 5.0;
/** Max rate of steering-angle change at highway speed (rad/s). */
const STEER_RATE_HIGHWAY_RAD_S = 1.1;
/** Below this speed (km/h) the full steering lock is available. */
const STEER_FULL_LOCK_KMH = 20;
/** At this speed (km/h) steering reaches its reduced floor. */
const STEER_REDUCED_KMH = 100;
/** Fraction of full lock retained at STEER_REDUCED_KMH. */
const STEER_HIGH_SPEED_FRACTION = 0.15;
/**
 * Shape of the lock-vs-speed curve: fraction = 1 - (1-floor) * t^k with
 * t = 0..1 across STEER_FULL_LOCK_KMH..STEER_REDUCED_KMH. With k < 1 the lock
 * collapses fast just above the full-lock speed (0.46 at 25 km/h, 0.32 at
 * 40 km/h) and creeps down gently from there; measured against the grip cap
 * this keeps a 20 km/h U-turn at ~6 m while a 40 km/h full lock commands only
 * ~0.65 g, so the player must slow down for tight work.
 */
const STEER_LOCK_CURVE = 0.161;
/** Same curve shape drives the rate-limit blend between the two speeds above. */
const STEER_RATE_CURVE = 1.6;

// ---------------------------------------------------------------------------
// Lateral grip budget.
//
// Rapier's ray-cast wheels generate lateral force two ways (verified against the
// installed 0.20.0 sources): a soft constraint cancels the chassis' lateral
// velocity at each contact point and is then scaled by the wheel's
// `side_friction_stiffness` (a gain: 1 = near-kinematic rail), and the combined
// forward+side impulse is clipped to a friction cone
//     maxImp = wheel_suspension_force * dt * friction_slip
// where the suspension force already scales with the chassis mass and that
// wheel's load. So `friction_slip` is the per-wheel grip budget: exceeding it
// scales both impulses down (skid) instead of letting the car follow the wheels
// exactly. The forward impulse counts only half in the cone check, so drive and
// brake keep ~2x headroom before sliding; that is what makes the budget act as
// a *lateral* cap.
// ---------------------------------------------------------------------------

/**
 * Fraction of the surface's frictionSlip that acts as the lateral grip budget.
 * Asphalt's 2.6 becomes ~1.05, i.e. peak cornering of about 1 g for a light car
 * instead of the railed 2.1-2.4 g measured before — tyres simply do not hold
 * that, and exceeding the budget now sheds speed instead of snapping direction.
 */
const LATERAL_GRIP_FRACTION = 0.4;
/** Chassis mass (kg) at which the grip budget is unscaled. */
const GRIP_REFERENCE_MASS = 1100;
/**
 * The budget scales with (reference/mass)^GRIP_MASS_EXPONENT: a laden truck or
 * bus gets a smaller budget per kilogram, so it corners worse than a hatchback
 * even though its tyres carry more load — road tyres are sized to the chassis,
 * not scaled with it.
 */
const GRIP_MASS_EXPONENT = 0.3;
/**
 * Lateral constraint gain applied to the surface's sideFriction. Below 1, the
 * wheels stop cancelling all lateral velocity every tick: slip builds
 * progressively with yaw rate (understeer) instead of an instant direction
 * change. 0.8 is firm enough that a 40-60 km/h corner at ~0.6-0.9 g holds only
 * ~2-4° of slip and a 20 km/h U-turn still closes to ~6 m, while staying well
 * below the 1.0 rail.
 */
const SIDE_FRICTION_GAIN = 0.8;

// ---------------------------------------------------------------------------
// Braking. Rapier's setWheelBrake takes a *maximum braking impulse* (N·s), not
// a force: internally `rolling_friction` is clamped to that impulse. To brake
// the whole chassis at `a` m/s² across `n` wheels for one `dt` step, each wheel
// needs the impulse `a * mass * dt / n`.
// ---------------------------------------------------------------------------

/** Foot-brake deceleration target (m/s²), ~0.9 g. */
const FOOT_BRAKE_DECEL = 9.0;
/** Rear bias for the foot brake (0..1). More on the rear, like a real car. */
const FOOT_BRAKE_REAR_BIAS = 0.55;
/** Handbrake deceleration target, rear wheels only. */
const HANDBRAKE_DECEL = 6.0;

// ---------------------------------------------------------------------------
// Aerodynamic drag: 0.5 * rho * Cd * A, with A = 4 * hx * hy (frontal area).
// This is what limits top speed by power instead of a magic speed cap.
// ---------------------------------------------------------------------------

const AIR_DENSITY = 1.225;
const DRAG_CD = 0.35;

/** Roll damping on the chassis for stability against low-speed flop. */
const CHASSIS_ANGULAR_DAMPING = 0.1;

// ---------------------------------------------------------------------------
// Delta emission throttling (keep the delta stream small).
// ---------------------------------------------------------------------------

const TRANSFORM_EMIT_INTERVAL = 0.25;
const ODOMETER_EMIT_INTERVAL = 0.5;
const FUEL_EMIT_INTERVAL = 0.5;

const TWO_PI = Math.PI * 2;

/** Rotates v by quaternion q into `out`, in place. */
function rotateVector(
  out: { x: number; y: number; z: number },
  q: { x: number; y: number; z: number; w: number },
  vx: number,
  vy: number,
  vz: number,
): void {
  const qx = q.x;
  const qy = q.y;
  const qz = q.z;
  const qw = q.w;
  // a = q_vec × v
  const ax = qy * vz - qz * vy;
  const ay = qz * vx - qx * vz;
  const az = qx * vy - qy * vx;
  // b = q_vec × a
  const bx = qy * az - qz * ay;
  const by = qz * ax - qx * az;
  const bz = qx * ay - qy * ax;
  // v' = v + 2 (qw·a + b)
  out.x = vx + 2 * (qw * ax + bx);
  out.y = vy + 2 * (qw * ay + by);
  out.z = vz + 2 * (qw * az + bz);
}

interface WheelVisual {
  index: number;
  isFront: boolean;
  radius: number;
  part: PartInstance;
  mesh: THREE.Object3D;
  /** Reused per-frame buffer for wheelChassisConnectionPointCs. */
  scratchCp: { x: number; y: number; z: number };
}

interface PartVisual {
  part: PartInstance;
  mesh: THREE.Object3D;
}

export class Vehicle {
  private readonly physics: PhysicsWorld;
  private readonly world: GameWorld;
  private readonly car: CarState;
  private readonly def: BodyDef;
  private readonly scene: THREE.Scene;

  private readonly chassisBody: RAPIER.RigidBody;
  private controller: RAPIER.DynamicRayCastVehicleController | null = null;
  private readonly drivetrain: Drivetrain;

  private statsValue: CarStats;

  private readonly rootGroup = new THREE.Group();

  private wheels: WheelVisual[] = [];
  private parts: PartVisual[] = [];
  private headlights: THREE.SpotLight[] = [];
  private lightsOnFlag = false;

  private readonly dragCoeff: number;

  // Axle bookkeeping for torque splitting and the drivetrain input.
  private frontWheelCount = 0;
  private rearWheelCount = 0;
  private frontDrivenCount = 0;
  private rearDrivenCount = 0;
  private drivenRadius = 0.35;

  // Steering state (rate-limited).
  private steerAngle = 0;

  // Fuel: a local mirror of car.fuelLitres, resynced on external changes.
  private localFuel: number;
  private lastAuthFuel: number;
  private fuelEmitTimer = 0;

  // Odometer and transform emission.
  private odoAccum = 0;
  private odoEmitTimer = 0;
  private transformEmitTimer = 0;

  // Scratch buffers reused across fixedUpdate (no per-tick allocation).
  private readonly linvel = { x: 0, y: 0, z: 0 };
  private readonly rotationScratch = { x: 0, y: 0, z: 0, w: 1 };
  private readonly forwardScratch = { x: 0, y: 0, z: 0 };
  private readonly forceScratch = { x: 0, y: 0, z: 0 };
  // Render-frame scratch.
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();

  // Fixed-step transform snapshots for render interpolation. The simulation steps
  // at exactly 60 Hz while frames arrive whenever the GPU is done, so a frame that
  // draws the newest physics transform draws a body that has advanced by 1, 2 or 3
  // steps since the last frame — the car visibly surges and stalls even though the
  // physics is perfectly regular. Rendering between the last two steps at the
  // loop's leftover-accumulator alpha turns that staircase back into constant
  // velocity, at the cost of being one step (16.7 ms) behind the sim.
  private readonly prevPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly stepPos = new THREE.Vector3();
  private readonly stepQuat = new THREE.Quaternion();
  private snapshotPrimed = false;

  constructor(physics: PhysicsWorld, world: GameWorld, carState: CarState, scene: THREE.Scene) {
    this.physics = physics;
    this.world = world;
    this.car = carState;
    this.scene = scene;
    this.def = body(carState.bodyId);

    const half = this.def.halfExtents;
    // Frontal area 4·hx·hy; 0.5·ρ·Cd collapses to the constant below.
    this.dragCoeff = 0.5 * AIR_DENSITY * DRAG_CD * (4 * half[0] * half[1]);

    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(carState.x, carState.y, carState.z)
      .setRotation({ x: carState.qx, y: carState.qy, z: carState.qz, w: carState.qw })
      .setAngularDamping(CHASSIS_ANGULAR_DAMPING)
      .setCanSleep(false);

    this.chassisBody = physics.world.createRigidBody(desc);

    // The chassis box carries zero collider mass; all mass and the low/rearward
    // centre of gravity come from setAdditionalMassProperties in rebuild().
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2])
        .setDensity(0)
        .setFriction(0.4)
        .setRestitution(0.05),
      this.chassisBody,
    );

    this.scene.add(this.rootGroup);

    this.statsValue = this.computeStats();
    this.drivetrain = new Drivetrain(
      this.statsValue.engine,
      this.statsValue.gearbox,
      this.def.rearDriveBias,
      this.statsValue.engineEfficiency,
    );

    this.localFuel = carState.fuelLitres;
    this.lastAuthFuel = carState.fuelLitres;

    this.rebuildFromSlots();
  }

  get stats(): CarStats {
    return this.statsValue;
  }

  get chassis(): RAPIER.RigidBody {
    return this.chassisBody;
  }

  get root(): THREE.Object3D {
    return this.rootGroup;
  }

  get rpm(): number {
    return this.drivetrain.rpm;
  }

  get gearLabel(): string {
    return this.drivetrain.gearLabel;
  }

  get speedKmh(): number {
    return Math.abs(this.forwardSpeedMps()) * 3.6;
  }

  get engineRunning(): boolean {
    return this.statsValue.engine != null && this.localFuel > 0;
  }

  get lightsOn(): boolean {
    return this.lightsOnFlag;
  }

  setLights(on: boolean): void {
    this.lightsOnFlag = on;
    for (const light of this.headlights) light.visible = on;
  }

  /** Rebuilds stats, drivetrain, controller and meshes from the current slots. */
  rebuildFromSlots(): void {
    if (this.controller) {
      this.controller.free();
      this.controller = null;
    }
    this.clearVisuals();
    this.wheels = [];
    this.parts = [];
    this.headlights = [];
    this.steerAngle = 0;
    this.frontWheelCount = 0;
    this.rearWheelCount = 0;
    this.frontDrivenCount = 0;
    this.rearDrivenCount = 0;
    this.drivenRadius = 0.35;

    this.statsValue = this.computeStats();
    const stats = this.statsValue;

    this.drivetrain.reconfigure(stats.engine, stats.gearbox, stats.engineEfficiency);

    // Parts change the mass; re-apply so the CoG stays low and rearward.
    this.applyChassisMass(stats.mass);

    this.buildBodyAndParts();

    const rapier = this.physics.rapier;
    this.controller = new rapier.DynamicRayCastVehicleController(
      this.chassisBody,
      this.physics.world.broadPhase,
      this.physics.world.narrowPhase,
      this.physics.world.bodies,
      this.physics.world.colliders,
    );
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;

    const frontShare = 1 - this.def.rearDriveBias;
    const rearShare = this.def.rearDriveBias;
    const suspension = this.def.suspension;

    for (const slot of this.def.slots) {
      if (slot.kind !== 'wheel') continue;
      const part = this.partAt(slot.id);
      if (!part) continue;
      const v = variant(part.variantId);
      if (!v.wheel) continue;

      const isFront = slot.pos[2] > 0;
      const radius = v.wheel.radius;
      const index = this.controller.numWheels();

      this.controller.addWheel(
        { x: slot.pos[0], y: slot.pos[1], z: slot.pos[2] },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        suspension.restLength,
        radius,
      );

      // Rapier's ray-cast suspension multiplies the spring force by the chassis
      // mass internally (`force * chassis_mass` in update_suspension), so the
      // registry's rate is *per kilogram* of chassis mass. Passing it through
      // unchanged is what makes a laden bus and a bare hatchback settle at the
      // same static sag; scaling it again here would double-apply mass and make
      // heavy vehicles ride rigid. The force ceiling is absolute and likewise
      // passed through unchanged.
      this.controller.setWheelSuspensionStiffness(index, suspension.stiffness);
      this.controller.setWheelSuspensionCompression(index, suspension.compression);
      this.controller.setWheelSuspensionRelaxation(index, suspension.relaxation);
      this.controller.setWheelMaxSuspensionTravel(index, suspension.maxTravel);
      this.controller.setWheelMaxSuspensionForce(index, suspension.maxForce);

      const mesh = createPartMesh(part.variantId);
      mesh.name = slot.id;
      mesh.rotation.order = 'YXZ';
      setCondition(mesh, part.dirt, part.rust);
      this.rootGroup.add(mesh);

      this.wheels.push({ index, isFront, radius, part, mesh, scratchCp: { x: 0, y: 0, z: 0 } });

      if (isFront) {
        this.frontWheelCount++;
        if (frontShare > 0) this.frontDrivenCount++;
      } else {
        this.rearWheelCount++;
        if (rearShare > 0) this.rearDrivenCount++;
      }
    }

    // Wheel-angular-speed input uses the primary driven axle's radius.
    const primaryRear = this.def.rearDriveBias >= 0.5;
    if (primaryRear && this.rearWheelCount > 0) {
      this.drivenRadius = this.averageWheelRadius(false);
    } else if (this.frontWheelCount > 0) {
      this.drivenRadius = this.averageWheelRadius(true);
    }
  }

  fixedUpdate(dt: number, input: InputFrame): void {
    const controller = this.controller;
    if (!controller) return;

    const stats = this.statsValue;

    // Resync fuel if an external system (refuelling) changed the authoritative value.
    if (this.car.fuelLitres !== this.lastAuthFuel) {
      this.localFuel = this.car.fuelLitres;
      this.lastAuthFuel = this.car.fuelLitres;
    }

    const fwd = this.forwardSpeedMps();

    // Manual shift request; with driver assist on this is a +/- gate — the
    // request applies now and the next automatic decision may override it.
    if (input.shift !== 0) this.drivetrain.shift(input.shift);

    const throttle = stats.drivable && this.localFuel > 0 ? input.throttle : 0;
    // The settings gearbox mode rides along as driver assist; a physically
    // automatic gearbox shifts regardless (hardware wins, see Drivetrain).
    const drive = this.drivetrain.update(
      dt,
      throttle,
      fwd / this.drivenRadius,
      this.drivenRadius,
      this.world.state.settings.gearboxMode === 'automatic',
    );

    // Consume fuel locally and emit throttled absolute deltas.
    if (drive.fuelBurnLitres > 0) {
      this.localFuel = Math.max(0, this.localFuel - drive.fuelBurnLitres);
      this.fuelEmitTimer += dt;
      if (this.fuelEmitTimer >= FUEL_EMIT_INTERVAL) {
        this.fuelEmitTimer = 0;
        this.lastAuthFuel = this.localFuel;
        this.world.apply({ t: 'car_fuel', carId: this.car.id, litres: this.localFuel });
      }
    }

    // Steering: shaped input, speed-scaled lock and a speed-scaled rate limit.
    //
    // The negation converts our basis into Rapier's steering sign. Forward is +Z and
    // the axle is set to (-1, 0, 0), and with that pairing a POSITIVE steering angle
    // yaws the car left, while `input.steer` is positive for "the player pressed
    // right". Measured: without this negation, holding right rotated the car +1.74
    // rad (left) over two seconds.
    const speedKmh = Math.abs(fwd) * 3.6;
    const steerT = clamp(
      (speedKmh - STEER_FULL_LOCK_KMH) / (STEER_REDUCED_KMH - STEER_FULL_LOCK_KMH),
      0,
      1,
    );
    const steerInput =
      Math.sign(input.steer) * Math.pow(Math.abs(input.steer), STEER_INPUT_EXPONENT);
    // fraction = 1 - (1-floor) * t^k: full lock up to STEER_FULL_LOCK_KMH, then a
    // fast collapse right above it and a gentle slide to the floor.
    const speedFactor = 1 - (1 - STEER_HIGH_SPEED_FRACTION) * Math.pow(steerT, STEER_LOCK_CURVE);
    const targetSteer = -steerInput * this.def.steerLock * speedFactor;
    const steerRate =
      STEER_RATE_HIGHWAY_RAD_S +
      (STEER_RATE_PARK_RAD_S - STEER_RATE_HIGHWAY_RAD_S) * Math.pow(1 - steerT, STEER_RATE_CURVE);
    const maxDelta = steerRate * dt;
    this.steerAngle += clamp(targetSteer - this.steerAngle, -maxDelta, maxDelta);

    // Brake impulses (N·s), distributed so the total matches the target decel.
    const mass = stats.mass;
    const frontShare = 1 - this.def.rearDriveBias;
    const rearShare = this.def.rearDriveBias;
    const brakeFrontShare = 1 - FOOT_BRAKE_REAR_BIAS;
    const brakeRearShare = FOOT_BRAKE_REAR_BIAS;
    const brakeDenom =
      this.frontWheelCount * brakeFrontShare + this.rearWheelCount * brakeRearShare;
    const footBrakeBase = brakeDenom > 0 ? (FOOT_BRAKE_DECEL * mass * dt) / brakeDenom : 0;
    const handbrakePerRear =
      this.rearWheelCount > 0 ? (HANDBRAKE_DECEL * mass * dt) / this.rearWheelCount : 0;

    const wheelCount = this.wheels.length;
    const totalDrivenCount = this.frontDrivenCount + this.rearDrivenCount;
    let rollingResistanceSum = 0;
    let contactCount = 0;
    let drivenContactCount = 0;
    // Same for every wheel: the lateral grip budget (see constants above). The
    // cone cap is mass-scaled so heavy vehicles corner worse per kilogram.
    const gripBudgetFactor =
      stats.wheelGrip * LATERAL_GRIP_FRACTION * Math.pow(GRIP_REFERENCE_MASS / mass, GRIP_MASS_EXPONENT);

    for (const w of this.wheels) {
      // Surface under this wheel drives traction and rolling resistance.
      const ground = controller.wheelGroundObject(w.index);
      const surface = this.physics.surfaces.lookup(ground ? ground.handle : null);

      controller.setWheelFrictionSlip(w.index, surface.frictionSlip * gripBudgetFactor);
      controller.setWheelSideFrictionStiffness(w.index, surface.sideFriction * SIDE_FRICTION_GAIN);

      const axleShare = w.isFront ? frontShare : rearShare;
      const axleCount = w.isFront ? this.frontDrivenCount : this.rearDrivenCount;
      const driven = axleShare > 0 && axleCount > 0;

      // Drive torque -> engine force (Newtons), signed by gear (reverse < 0).
      let engineForce = 0;
      if (driven) {
        engineForce = wheelTorqueToForce((drive.driveTorqueNm * axleShare) / axleCount, w.radius);
      }
      controller.setWheelEngineForce(w.index, engineForce);

      // Brakes: foot (rear-biased) + handbrake (rear). Engine braking is applied
      // separately as a chassis impulse below — routing it through setWheelBrake
      // saturates at the tyre-lockup impulse, so every gear would brake the same.
      let brakeImpulse = 0;
      if (input.brake > 0) {
        brakeImpulse += input.brake * footBrakeBase * (w.isFront ? brakeFrontShare : brakeRearShare);
      }
      if (input.handbrake && !w.isFront) {
        brakeImpulse += handbrakePerRear;
      }
      controller.setWheelBrake(w.index, brakeImpulse);

      controller.setWheelSteering(w.index, w.isFront ? this.steerAngle : 0);

      if (ground) {
        contactCount++;
        rollingResistanceSum += surface.rollingResistance;
        if (driven) drivenContactCount++;
      }
    }

    controller.updateVehicle(dt);

    // Rolling resistance (∝ weight) + quadratic aerodynamic drag, opposing
    // horizontal motion. Drag always applies; rolling resistance fades with the
    // fraction of wheels still on the ground.
    //
    // This MUST be an impulse, not `addForce`: Rapier's force accumulator is
    // persistent — a force added here would be re-applied on every subsequent step
    // until `resetForces`, so adding one per tick accumulates without bound and
    // strangles the car to a standstill within a couple of seconds.
    this.chassisBody.linvel(this.linvel);
    const hSpeedSq = this.linvel.x * this.linvel.x + this.linvel.z * this.linvel.z;
    const hSpeed = Math.sqrt(hSpeedSq);
    if (hSpeed > 0.01) {
      let retarding = this.dragCoeff * hSpeedSq;
      if (contactCount > 0 && wheelCount > 0) {
        const rr = rollingResistanceSum / contactCount;
        retarding += rr * mass * GRAVITY * (contactCount / wheelCount);
      }

      // Engine braking: closed-throttle crank drag carried through the gearbox
      // to a wheel force, applied as a longitudinal chassis impulse — the same
      // mechanism as the drag/rolling resistance above, so it never saturates at
      // a tyre-lockup clamp the way setWheelBrake does.
      //
      // Only with the throttle shut, only while a gear is engaged (the drivetrain
      // reports zero brake torque in neutral and mid-shift), and scaled by the
      // fraction of driven wheels still in contact so airborne driven wheels
      // don't brake the car through thin air.
      if (
        throttle <= 0 &&
        drive.engineBrakeTorqueNm > 0 &&
        totalDrivenCount > 0 &&
        drivenContactCount > 0
      ) {
        retarding +=
          (drive.engineBrakeTorqueNm / this.drivenRadius) *
          (drivenContactCount / totalDrivenCount);
      }

      // Never let one tick's retarding impulse reverse the car; cap it at the
      // impulse that would bring horizontal motion exactly to rest.
      const impulse = Math.min(retarding * dt, hSpeed * mass);
      const inv = 1 / hSpeed;
      this.forceScratch.x = -impulse * this.linvel.x * inv;
      this.forceScratch.y = 0;
      this.forceScratch.z = -impulse * this.linvel.z * inv;
      this.chassisBody.applyImpulse(this.forceScratch, false);
    }

    // Odometer: metres travelled forward this tick, emitted in throttled batches.
    if (fwd > 0) {
      this.odoAccum += fwd * dt;
      this.odoEmitTimer += dt;
      if (this.odoEmitTimer >= ODOMETER_EMIT_INTERVAL) {
        this.odoEmitTimer = 0;
        const metres = this.odoAccum;
        this.odoAccum = 0;
        if (metres > 0) this.world.apply({ t: 'car_odometer', carId: this.car.id, metres });
      }
    }

    // Transform deltas, a few times per second.
    this.transformEmitTimer += dt;
    if (this.transformEmitTimer >= TRANSFORM_EMIT_INTERVAL) {
      this.transformEmitTimer = 0;
      this.chassisBody.translation(this.pos);
      this.chassisBody.rotation(this.quat);
      this.world.apply({
        t: 'car_transform',
        carId: this.car.id,
        x: this.pos.x,
        y: this.pos.y,
        z: this.pos.z,
        qx: this.quat.x,
        qy: this.quat.y,
        qz: this.quat.z,
        qw: this.quat.w,
      });
    }
  }

  /**
   * Latches the chassis transform after the physics step that produced it. Must be
   * called once per fixed step, after `physics.step()` — never from render, whose
   * rate is unrelated.
   */
  postStep(): void {
    if (!this.snapshotPrimed) {
      // First step (or first after a spawn): both ends of the interpolation are the
      // current transform, so the car does not lerp in from the origin.
      this.chassisBody.translation(this.stepPos);
      this.chassisBody.rotation(this.stepQuat);
      this.prevPos.copy(this.stepPos);
      this.prevQuat.copy(this.stepQuat);
      this.snapshotPrimed = true;
      return;
    }
    this.prevPos.copy(this.stepPos);
    this.prevQuat.copy(this.stepQuat);
    this.chassisBody.translation(this.stepPos);
    this.chassisBody.rotation(this.stepQuat);
  }

  /**
   * Chassis transform at render time, interpolated between the last two fixed
   * steps. The camera target and the car's own visuals must read exactly the same
   * pose, or the camera chases a car that is drawn somewhere else.
   */
  interpolatedTransform(alpha: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
    outPos.lerpVectors(this.prevPos, this.stepPos, alpha);
    outQuat.slerpQuaternions(this.prevQuat, this.stepQuat, alpha);
  }

  /**
   * Places the chassis upright and at rest at a world position. For the
   * fall-out-of-world rescue only: velocities are cleared so the car does not
   * arrive carrying the speed of its fall, and the interpolation snapshots are
   * re-primed so the renderer does not draw a streak from wherever it fell to.
   */
  rescueTo(x: number, y: number, z: number, heading: number): void {
    this.chassisBody.setTranslation({ x, y, z }, true);
    this.chassisBody.setRotation(
      { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) },
      true,
    );
    this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.snapshotPrimed = false;
  }

  syncVisuals(alpha: number): void {
    const controller = this.controller;
    if (!controller) return;

    this.interpolatedTransform(alpha, this.pos, this.quat);
    this.rootGroup.position.copy(this.pos);
    this.rootGroup.quaternion.copy(this.quat);

    // Wheels are chassis-local: suspension travel and spin are small, smooth and
    // already snapped to the same step, so they need no second interpolation.
    for (const w of this.wheels) {
      const cp = controller.wheelChassisConnectionPointCs(w.index, w.scratchCp);
      const susp = controller.wheelSuspensionLength(w.index);
      const spin = controller.wheelRotation(w.index);
      const steer = controller.wheelSteering(w.index);
      if (cp) w.mesh.position.set(cp.x, cp.y - (susp ?? 0), cp.z);
      w.mesh.rotation.set((spin ?? 0) % TWO_PI, steer ?? 0, 0);
      setCondition(w.mesh, w.part.dirt, w.part.rust);
    }

    for (const p of this.parts) {
      setCondition(p.mesh, p.part.dirt, p.part.rust);
    }
  }

  dispose(): void {
    if (this.controller) {
      this.controller.free();
      this.controller = null;
    }
    this.physics.removeBody(this.chassisBody);
    this.clearVisuals();
    this.scene.remove(this.rootGroup);
  }

  // ---------------------------------------------------------------------------
  // Internals.
  // ---------------------------------------------------------------------------

  private computeStats(): CarStats {
    const slotMap = new Map<SlotId, PartInstance | null>();
    for (const slot of this.def.slots) {
      slotMap.set(slot.id, this.partAt(slot.id));
    }
    return computeCarStats(this.def, slotMap);
  }
  private partAt(slotId: SlotId): PartInstance | null {
    const slots = this.car.slots as Record<string, PartInstance | undefined>;
    return slots[slotId] ?? null;
  }

  private applyChassisMass(mass: number): void {
    const half = this.def.halfExtents;
    const hx = half[0];
    const hy = half[1];
    const hz = half[2];
    // Solid-box principal inertias about the centre, scaled by mass.
    const inertia = {
      x: (mass / 3) * (hy * hy + hz * hz),
      y: (mass / 3) * (hx * hx + hz * hz),
      z: (mass / 3) * (hx * hx + hy * hy),
    };
    const com = this.def.comOffset;
    this.chassisBody.setAdditionalMassProperties(
      mass,
      { x: com[0], y: com[1], z: com[2] },
      inertia,
      { x: 0, y: 0, z: 0, w: 1 },
      false,
    );
    // Make mass() current immediately so the vehicle controller's suspension
    // (which reads chassis.mass() each step) sees the new value on the next tick.
    this.chassisBody.recomputeMassPropertiesFromColliders();
  }

  private buildBodyAndParts(): void {
    const bodyMesh = createBodyMesh(this.def.id, this.car.paintColor);
    bodyMesh.name = 'body';
    this.rootGroup.add(bodyMesh);

    for (const slot of this.def.slots) {
      if (slot.kind === 'wheel' || slot.kind === 'headlight') continue;
      const part = this.partAt(slot.id);
      if (!part) continue;
      this.addPartMesh(slot, part);
    }

    if (this.statsValue.hasHeadlights) this.buildHeadlights();
  }

  private addPartMesh(slot: SlotDef, part: PartInstance): void {
    const mesh = createPartMesh(part.variantId);
    mesh.name = slot.id;
    mesh.position.set(slot.pos[0], slot.pos[1], slot.pos[2]);
    if (slot.yaw) mesh.rotation.y = slot.yaw;
    setCondition(mesh, part.dirt, part.rust);
    this.rootGroup.add(mesh);
    this.parts.push({ part, mesh });
  }

  private buildHeadlights(): void {
    for (const slot of this.def.slots) {
      if (slot.kind !== 'headlight') continue;
      const part = this.partAt(slot.id);
      if (!part) continue;

      this.addPartMesh(slot, part);

      const light = new THREE.SpotLight(0xfff2d8, 120, 80, 0.55, 0.5, 1.5);
      light.position.set(slot.pos[0], slot.pos[1], slot.pos[2]);
      light.target.position.set(slot.pos[0], slot.pos[1], slot.pos[2] + 8);
      light.castShadow = false;
      light.visible = this.lightsOnFlag;
      this.rootGroup.add(light.target);
      this.rootGroup.add(light);
      this.headlights.push(light);
    }
  }

  private clearVisuals(): void {
    const children = this.rootGroup.children.slice();
    for (const child of children) {
      this.rootGroup.remove(child);
      child.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) {
          for (const m of material) m.dispose();
        } else if (material) {
          material.dispose();
        }
      });
    }
  }

  private forwardSpeedMps(): number {
    this.chassisBody.linvel(this.linvel);
    this.chassisBody.rotation(this.rotationScratch);
    rotateVector(this.forwardScratch, this.rotationScratch, 0, 0, 1);
    return (
      this.linvel.x * this.forwardScratch.x +
      this.linvel.y * this.forwardScratch.y +
      this.linvel.z * this.forwardScratch.z
    );
  }

  private averageWheelRadius(isFront: boolean): number {
    let sum = 0;
    let count = 0;
    for (const w of this.wheels) {
      if (w.isFront === isFront) {
        sum += w.radius;
        count++;
      }
    }
    return count > 0 ? sum / count : 0.35;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
