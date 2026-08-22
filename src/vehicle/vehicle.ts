/**
 * The drivable car: a Rapier dynamic chassis + ray-cast wheels + the drivetrain
 * simulation, with Three.js meshes as pure derived views.
 *
 * The car itself is ONE complete model (vehicle/carmodels.ts): its collider,
 * suspension mounts and wheel radii are measured off the GLB in
 * render/carmodel.ts, and its engine, gearbox and mass come from the model's
 * catalogue entry. Nothing has to be bolted on for it to drive.
 *
 * Parts survive only as *gizmos*: cosmetic things found in the world, mounted at
 * the model's anchor points (`CarState.gizmos`, keyed by anchor id). They add mass
 * and looks, never capability.
 *
 * Ownership rules (see game/state.ts): the authoritative state lives in
 * `GameWorld` / `CarState`. This class reads `carState.gizmos`, reads/writes the
 * chassis rigid body (the physics-derived view), and emits throttled deltas
 * through `world.apply`. It never mutates `CarState` directly.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../core/physics';
import type { InputFrame } from '../core/input';
import type { CarState, GameWorld } from '../game/state';
import { variant } from '../parts/registry';
import type { CarStats, PartInstance } from '../parts/registry';
import { carModel, modelEngine, modelGearbox, type CarModelDef } from './carmodels';
import { Drivetrain, wheelTorqueToForce } from './drivetrain';
import { carModelMeasure, createCarModel, type CarModelMeasure } from '../render/carmodel';
import { createPartMesh } from '../render/partmesh';
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
/**
 * Speed-dependent lateral grip falloff. Below LATERAL_GRIP_FALLOFF_START_MPS the
 * car corners exactly as before; above it the lateral constraint gain is scaled
 * down on a smoothstep toward 1 - LATERAL_GRIP_MAX_LOSS. This makes the car
 * progressively more nervous with speed (a corner that holds at 60 km/h starts
 * to wash out near 140 km/h) while parking and low-speed manoeuvring are
 * untouched. The falloff scales only the lateral (side-friction) channel, so
 * drive, brake and steering are unaffected, and a straight line carries no
 * lateral slip to amplify — so it cannot introduce straight-line wander.
 */
/** Speed (m/s) below which lateral grip is untouched (~72 km/h). */
const LATERAL_GRIP_FALLOFF_START_MPS = 20;
/** Speed (m/s) at which the falloff reaches its full loss (~144 km/h). */
const LATERAL_GRIP_FALLOFF_END_MPS = 40;
/** Maximum fraction of lateral grip shed at high speed (0 = none, 1 = all). */
const LATERAL_GRIP_MAX_LOSS = 0.25;

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
/**
 * Handbrake: a cable that LOCKS the rear wheels, not a second foot brake.
 *
 * The old 6 m/s² rear-only target was quieter than the foot brake and read as
 * "the handbrake does nothing": at 60 km/h it shaved a couple of km/h and the
 * car kept tracking straight. A locked wheel is instead an impulse ceiling far
 * above what the tyre can transmit, so the rear simply stops rotating and the
 * friction cone (see the grip note above) does the rest.
 */
const HANDBRAKE_DECEL = 30.0;
/**
 * Lateral grip left on a locked rear axle. A sliding tyre carries far less side
 * force than a rolling one, and this is what turns the handbrake into a
 * handbrake: the tail steps out instead of the car braking in a straight line.
 */
const HANDBRAKE_SIDE_GRIP = 0.3;
/**
 * Ride height, as geometry rather than a fudge factor.
 *
 * Target: with the car settled on its springs, the BOTTOM OF THE BODY sits level
 * with the CENTRE OF THE WHEELS — a kerb's worth of clearance, and what these
 * bodies look right at. Since the wheel hangs `rest - sag` below its mount, that
 * target is `mount_y = restLength - staticSag - halfHeight`.
 *
 * But that target alone is wrong for packs whose body box runs down to a low skirt
 * or a modelled underbody: applying it to them lifts the shell off its own arches
 * onto stilts. So the lift is capped at RIDE_LIFT_MAX above the stance the artist
 * drew (`wheelCentre + rest - sag`, which reproduces the model exactly), and every
 * pack ends up either at the target or a hand's width above its own drawing —
 * whichever is lower.
 *
 * Only Y comes from this; track and wheelbase always come from the model.
 */
const RIDE_LIFT_MAX = 0.15;
/**
 * Static spring compression, metres. Rapier's ray-cast suspension force is
 * `stiffness * (rest - length) * chassis_mass`, i.e. the rate is per kilogram, so
 * one wheel carrying a quarter of the weight settles at `g / (4 * stiffness)`
 * regardless of how heavy the vehicle is. That is what makes the pre-compensation
 * above closed-form instead of a per-model number to tune.
 */
function staticSag(stiffness: number): number {
  return GRAVITY / (4 * stiffness);
}
/**
 * Holding deceleration for a parked car, m/s². Low enough that a shove still
 * rolls it, high enough that it does not creep down a dune on its own.
 */
const PARK_BRAKE_DECEL = 4.0;

// ---------------------------------------------------------------------------
// Body attitude: why a car that squats under power does not lean in a corner.
//
// Rapier's ray-cast vehicle is a port of Bullet's, and Bullet deliberately throws
// the roll couple away: the side-friction impulse is applied with its vertical
// lever arm scaled almost to nothing (Bullet calls it "roll influence", default
// 0.1), because an arcade vehicle that can trip over its own grip is worse than
// one that never leans. Rapier does not expose that knob at all — the API has
// stiffness, compression, relaxation, travel, friction slip and side friction, and
// nothing about roll.
//
// Longitudinal impulses are NOT treated that way, which is exactly the asymmetry
// you can see: the nose lifts under power and the tail squats, while the same car
// corners flat as a table. The fix is to put the missing moment back by hand —
// lateral acceleration times mass times the height of the centre of mass above the
// contact plane, applied about the car's own forward axis. The suspension then
// resists it the way it already resists pitch, because rolling the body shortens
// the outer springs' raycasts and they push back. Nothing here fakes a lean angle;
// it restores the force that produces one.
// ---------------------------------------------------------------------------

/**
 * Fraction of the physical roll couple to restore.
 *
 * NOT 1. The ray-cast suspension has almost no roll stiffness of its own — its
 * springs push along vertical rays at the mounts, and it has no anti-roll bar to
 * model — so feeding in the whole moment simply tips the car over: measured at
 * gain 1, a 33 km/h turn rolled the body to 81 degrees and put it on its side.
 * A third of the moment reads as a real, weighted lean without ever threatening
 * to trip a car that the rest of the model cannot catch.
 */
const ROLL_COUPLE_GAIN = 0.34;
/**
 * Low-pass time constant for the lateral-acceleration estimate, seconds. The
 * estimate differences body-frame velocity, so a kerb strike or a one-frame solver
 * correction shows up as a huge spike; smoothing over ~60 ms keeps a real corner
 * intact and throws the spikes away.
 */
const ROLL_ACCEL_TAU = 0.06;
/** Ceiling on the restored couple, in g of lateral acceleration. */
const ROLL_ACCEL_MAX = 12;
/**
 * Lean angle, degrees, at which the couple has faded to nothing. Past this the car
 * is already leaning harder than any road car does, and continuing to push is how
 * a lean becomes a rollover.
 */
const ROLL_LIMIT_DEG = 8;
/**
 * Roll-rate damping, as a fraction of roll inertia per second. Stands in for the
 * dampers' contribution about the roll axis, which the ray-cast model does not
 * produce, and is what stops the restored couple ringing.
 */
const ROLL_RATE_DAMPING = 2.2;

/**
 * Inertia gains over a uniform solid box.
 *
 * A car is not a uniform box: its engine hangs off one end, its tank and boot off
 * the other, and the body box we measure is shorter than the real overhangs. A
 * solid-box tensor therefore under-states pitch and yaw inertia by roughly half —
 * which is why the nose rose so eagerly under power. Real saloons sit near a
 * pitch/yaw radius of gyration of 0.3-0.35 of wheelbase; these gains bring the box
 * up to that without pretending to model mass distribution properly.
 */
const INERTIA_PITCH_YAW_GAIN = 2.2;
/** Roll inertia is closer to a box's, since mass is not spread across the width. */
const INERTIA_ROLL_GAIN = 1.25;

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
  mesh: THREE.Object3D;
  /** Reused per-frame buffer for wheelChassisConnectionPointCs. */
  scratchCp: { x: number; y: number; z: number };
}

/** A gizmo mounted at one of the model's anchors. Cosmetic mass, nothing more. */
interface GizmoVisual {
  part: PartInstance;
  mesh: THREE.Object3D;
}

/**
 * Centre of mass, as fractions of the measured chassis box: dropped well below the
 * box centre and pushed slightly rearward, which is what keeps a tall van from
 * tipping and a light tail from stepping out. Measured per model rather than
 * authored, so a firetruck and a kart both get a sane one.
 */
const COM_DROP_FRACTION = 0.45;
const COM_REARWARD_FRACTION = 0.02;

/** Headlight placement as fractions of the chassis box (x of half-width, y of height). */
const HEADLIGHT_X_FRACTION = 0.62;
const HEADLIGHT_Y_FRACTION = 0.28;

export class Vehicle {
  private readonly physics: PhysicsWorld;
  private readonly world: GameWorld;
  private readonly car: CarState;
  private readonly model: CarModelDef;
  private readonly measure: CarModelMeasure;
  private readonly scene: THREE.Scene;

  private readonly chassisBody: RAPIER.RigidBody;
  private controller: RAPIER.DynamicRayCastVehicleController | null = null;
  private readonly drivetrain: Drivetrain;

  private statsValue: CarStats;

  private readonly rootGroup = new THREE.Group();

  private wheels: WheelVisual[] = [];
  private gizmos: GizmoVisual[] = [];
  /** Wheel objects taken from the instantiated model, keyed by wheel id. */
  private readonly wheelMeshes = new Map<string, THREE.Object3D>();
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
  private readonly invRotationScratch = { x: 0, y: 0, z: 0, w: 1 };
  private readonly localVelScratch = { x: 0, y: 0, z: 0 };
  private readonly localAngScratch = { x: 0, y: 0, z: 0 };
  private readonly leanScratch = { x: 0, y: 0, z: 0 };
  // Roll-couple state: low-passed lateral acceleration and its lever arm.
  private prevLatVel = 0;
  private rollAccel = 0;
  private rollPrimed = false;
  private rollLeverArm = 0.5;
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
    this.model = carModel(carState.modelId);
    this.measure = carModelMeasure(carState.modelId);

    const half = this.measure.halfExtents;
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
    //
    // Its FLOOR is raised to the wheel-centre line rather than the bottom of the
    // body box. A car's underside must not touch down before its tyres do: with the
    // full box, anything with a high floor and a tall silhouette — the buggy, with
    // its roll cage — grounded its collider on a dune crest, the solver held the
    // chassis up, and the ray-cast wheels kept reaching for terrain that was now
    // above their contact point. On screen that is a car whose wheels sink into the
    // road, which is exactly what it looked like.
    const floor = Math.max(-half[1], this.measure.wheels[0].pos[1]);
    const colliderHalfY = (half[1] - floor) / 2;
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half[0], colliderHalfY, half[2])
        .setTranslation(0, floor + colliderHalfY, 0)
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
      this.model.rearDriveBias,
      this.statsValue.engineEfficiency,
    );

    this.localFuel = carState.fuelLitres;
    this.lastAuthFuel = carState.fuelLitres;

    this.rebuild();
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

  /** The catalogue entry behind this car. */
  get modelDef(): CarModelDef {
    return this.model;
  }

  /** Measurements taken off the model's GLB (chassis-local metres). */
  get modelMeasure(): CarModelMeasure {
    return this.measure;
  }

  /** Hood-camera eye in chassis-local metres, for the in-car view. */
  get eyePoint(): readonly [number, number, number] {
    return this.measure.eyePoint;
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

  /** Rebuilds stats, drivetrain, controller and meshes from the model and its gizmos. */
  rebuild(): void {
    if (this.controller) {
      this.controller.free();
      this.controller = null;
    }
    this.clearVisuals();
    this.wheels = [];
    this.gizmos = [];
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

    // Gizmos change the mass; re-apply so the CoG stays low and rearward.
    this.applyChassisMass(stats.mass);

    this.buildVisuals();

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

    const frontShare = 1 - this.model.rearDriveBias;
    const rearShare = this.model.rearDriveBias;
    const suspension = this.model.suspension;

    // Ride height (see RIDE_LIFT_MAX above). `hangs` is how far below its mount a
    // settled wheel sits; `target` puts the body's underside on the wheel centres,
    // and `stance` reproduces the model's own drawing. Take whichever is lower —
    // i.e. never lift a body more than RIDE_LIFT_MAX off its own arches. X and Z
    // always stay where the model put its wheels.
    const hangs = suspension.restLength - staticSag(suspension.stiffness);
    const target = hangs - this.measure.halfExtents[1];
    const stance = hangs + this.measure.wheels[0].pos[1];
    const mountY = Math.max(target, stance - RIDE_LIFT_MAX);

    // Roll lever: how far the centre of mass sits above the tyre contact plane.
    // The contact plane is one radius below where a settled wheel centre ends up
    // (`mountY - hangs`), and the centre of mass is the same offset applied in
    // applyChassisMass. This is the arm the missing roll couple acts on.
    const comY = -COM_DROP_FRACTION * this.measure.halfExtents[1];
    const contactY = mountY - hangs - this.measure.wheels[0].radius;
    this.rollLeverArm = Math.max(0.1, comY - contactY);

    for (const wheel of this.measure.wheels) {
      const index = this.controller.numWheels();

      this.controller.addWheel(
        { x: wheel.pos[0], y: mountY, z: wheel.pos[2] },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        suspension.restLength,
        wheel.radius,
      );

      // Rapier's ray-cast suspension multiplies the spring force by the chassis
      // mass internally (`force * chassis_mass` in update_suspension), so the
      // catalogue's rate is *per kilogram* of chassis mass. Passing it through
      // unchanged is what makes a laden firetruck and a kart settle at the same
      // static sag; scaling it again here would double-apply mass and make heavy
      // vehicles ride rigid. The force ceiling is absolute and likewise passed
      // through unchanged.
      this.controller.setWheelSuspensionStiffness(index, suspension.stiffness);
      this.controller.setWheelSuspensionCompression(index, suspension.compression);
      this.controller.setWheelSuspensionRelaxation(index, suspension.relaxation);
      this.controller.setWheelMaxSuspensionTravel(index, suspension.maxTravel);
      this.controller.setWheelMaxSuspensionForce(index, suspension.maxForce);

      const mesh = this.wheelMeshes.get(wheel.id);
      if (!mesh) throw new Error(`Car model "${this.model.id}" is missing wheel ${wheel.id}`);
      mesh.name = wheel.id;
      mesh.rotation.order = 'YXZ';
      this.rootGroup.add(mesh);

      this.wheels.push({
        index,
        isFront: wheel.isFront,
        radius: wheel.radius,
        mesh,
        scratchCp: { x: 0, y: 0, z: 0 },
      });

      if (wheel.isFront) {
        this.frontWheelCount++;
        if (frontShare > 0) this.frontDrivenCount++;
      } else {
        this.rearWheelCount++;
        if (rearShare > 0) this.rearDrivenCount++;
      }
    }

    // Wheel-angular-speed input uses the primary driven axle's radius.
    const primaryRear = this.model.rearDriveBias >= 0.5;
    if (primaryRear && this.rearWheelCount > 0) {
      this.drivenRadius = this.averageWheelRadius(false);
    } else if (this.frontWheelCount > 0) {
      this.drivenRadius = this.averageWheelRadius(true);
    }
  }

  /**
   * Suspension-only step for a car nobody is driving.
   *
   * Rapier's ray-cast suspension is not a constraint that persists between steps —
   * it is a force recomputed inside `updateVehicle`, and it is the *only* thing
   * holding the chassis off the ground. A vehicle that never gets `updateVehicle`
   * therefore has no springs at all: gravity pulls the chassis down until its own
   * box collider lands on the terrain, and because the wheel meshes are positioned
   * chassis-locally at `connectionPoint - suspensionLength`, they end up buried
   * under the road while the body sits on its belly. That was exactly the "parked
   * car lies on its floor" bug, and it applied to every car the moment the player
   * stepped out of it.
   *
   * So every vehicle is stepped every tick. The driven one goes through
   * `fixedUpdate`; the rest come through here, which does the minimum: no engine
   * force, no steering, and enough brake to hold the car still on a slope.
   *
   * Cost is four ray-casts per parked car per step, which is what a parked car
   * standing on its wheels is worth.
   */
  settle(dt: number): void {
    const controller = this.controller;
    if (!controller) return;

    const n = this.wheels.length;
    if (n === 0) return;

    // Parking brake: same impulse units as the foot brake (see the braking note
    // above), spread over every wheel. Sized to hold, not to stop.
    const impulse = (PARK_BRAKE_DECEL * this.statsValue.mass * dt) / n;
    for (const w of this.wheels) {
      controller.setWheelEngineForce(w.index, 0);
      controller.setWheelSteering(w.index, 0);
      controller.setWheelBrake(w.index, impulse);
    }

    controller.updateVehicle(dt);
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

    const throttle = this.localFuel > 0 ? input.throttle : 0;
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
    const targetSteer = -steerInput * this.model.steerLock * speedFactor;
    const steerRate =
      STEER_RATE_HIGHWAY_RAD_S +
      (STEER_RATE_PARK_RAD_S - STEER_RATE_HIGHWAY_RAD_S) * Math.pow(1 - steerT, STEER_RATE_CURVE);
    const maxDelta = steerRate * dt;
    this.steerAngle += clamp(targetSteer - this.steerAngle, -maxDelta, maxDelta);

    // Brake impulses (N·s), distributed so the total matches the target decel.
    const mass = stats.mass;
    const frontShare = 1 - this.model.rearDriveBias;
    const rearShare = this.model.rearDriveBias;
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

    // Speed-dependent lateral grip (see constants above). Below the start speed
    // the smoothstep evaluates to exactly 0, so the factor is exactly 1 and
    // low-speed handling is untouched; above it the factor falls smoothly to
    // 1 - LATERAL_GRIP_MAX_LOSS. The smoothstep's zero slope at both ends keeps
    // the transition kink-free, so grip never changes abruptly.
    const lateralGripT = clamp(
      (Math.abs(fwd) - LATERAL_GRIP_FALLOFF_START_MPS) /
        (LATERAL_GRIP_FALLOFF_END_MPS - LATERAL_GRIP_FALLOFF_START_MPS),
      0,
      1,
    );
    const lateralGripFactor =
      1 - LATERAL_GRIP_MAX_LOSS * lateralGripT * lateralGripT * (3 - 2 * lateralGripT);

    for (const w of this.wheels) {
      // Surface under this wheel drives traction and rolling resistance.
      const ground = controller.wheelGroundObject(w.index);
      const surface = this.physics.surfaces.lookup(ground ? ground.handle : null);

      // A locked rear tyre slides: it keeps its longitudinal cone but sheds most of
      // its side force, which is what makes the handbrake rotate the car.
      const locked = input.handbrake && !w.isFront;
      controller.setWheelFrictionSlip(w.index, surface.frictionSlip * gripBudgetFactor);
      controller.setWheelSideFrictionStiffness(
        w.index,
        surface.sideFriction *
          SIDE_FRICTION_GAIN *
          lateralGripFactor *
          (locked ? HANDBRAKE_SIDE_GRIP : 1),
      );

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

    this.applyRollCouple(dt, mass, contactCount);

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
    }

    // Gizmos are bolted to the shell: they never move relative to it, so all they
    // need per frame is their condition, which a scrubbing player can change.
    for (const g of this.gizmos) setCondition(g.mesh, g.part.dirt, g.part.rust);
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

  /**
   * Stats of a complete vehicle. The model IS the car: it always has its engine,
   * its gearbox, its tank and its four wheels, so nothing here can be "missing"
   * and a car is never undrivable. Gizmos only add mass.
   */
  private computeStats(): CarStats {
    const engine = modelEngine(this.model);
    let mass = this.model.mass;
    for (const part of Object.values(this.gizmoParts())) mass += variant(part.variantId).mass;

    return {
      mass,
      engine,
      gearbox: modelGearbox(this.model),
      engineEfficiency: 1,
      fuel: engine.fuel,
      tankCapacity: this.model.tankLitres,
      wheelCount: this.measure.wheels.length,
      wheelGrip: this.model.wheelGrip,
      hasHeadlights: true,
    };
  }

  private gizmoParts(): Record<string, PartInstance> {
    return this.car.gizmos ?? {};
  }

  /**
   * Puts the cornering roll couple back (see the ROLL_COUPLE_GAIN note above).
   *
   * Lateral acceleration is measured in the car's own frame, and it needs BOTH
   * terms: the change in body-frame sideways velocity *and* the centripetal term
   * `yawRate * forwardSpeed`. Differencing alone reads ~0 in a steady circle —
   * body-frame sideways velocity is constant there while the world velocity vector
   * swings around — so a car would lean into a corner and then stand back up
   * mid-bend. With the centripetal term it holds its lean as long as it holds the
   * radius, which is what a real one does.
   *
   * The result is low-passed, clamped, and applied as a torque impulse about the
   * car's forward axis with the centre of mass' height above the contact plane as
   * the lever. Sign follows the physics: accelerating towards +X (left) rolls the
   * body to the right, a positive rotation about +Z.
   *
   * Skipped with no wheel on the ground — an airborne car has nothing to lean
   * against.
   */
  private applyRollCouple(dt: number, mass: number, contactCount: number): void {
    this.chassisBody.linvel(this.linvel);
    this.chassisBody.rotation(this.rotationScratch);

    // Body-frame velocity: rotate the world velocity by the inverse rotation.
    this.invRotationScratch.x = -this.rotationScratch.x;
    this.invRotationScratch.y = -this.rotationScratch.y;
    this.invRotationScratch.z = -this.rotationScratch.z;
    this.invRotationScratch.w = this.rotationScratch.w;
    rotateVector(
      this.localVelScratch,
      this.invRotationScratch,
      this.linvel.x,
      this.linvel.y,
      this.linvel.z,
    );
    const latVel = this.localVelScratch.x;
    const fwdVel = this.localVelScratch.z;

    // Yaw rate in the body frame, for the centripetal term.
    const angvel = this.chassisBody.angvel();
    rotateVector(this.localAngScratch, this.invRotationScratch, angvel.x, angvel.y, angvel.z);
    const yawRate = this.localAngScratch.y;

    if (!this.rollPrimed) {
      this.rollPrimed = true;
      this.prevLatVel = latVel;
      return;
    }
    const rawAccel = (latVel - this.prevLatVel) / dt + yawRate * fwdVel;
    this.prevLatVel = latVel;
    const k = 1 - Math.exp(-dt / ROLL_ACCEL_TAU);
    this.rollAccel += (rawAccel - this.rollAccel) * k;

    if (contactCount === 0) return;

    // Current lean: the body's own left axis tilted out of horizontal. Positive
    // means the left side is up, i.e. the car is leaning right.
    rotateVector(this.leanScratch, this.rotationScratch, 1, 0, 0);
    const leanSin = clamp(this.leanScratch.y, -1, 1);
    const limitSin = Math.sin((ROLL_LIMIT_DEG * Math.PI) / 180);
    const accel = clamp(this.rollAccel, -ROLL_ACCEL_MAX * GRAVITY, ROLL_ACCEL_MAX * GRAVITY);

    // Fade the couple out as the lean approaches the limit, but only in the
    // direction that would deepen it: a car already leaning hard must still be able
    // to be pushed back upright by the opposite corner.
    const deepening = Math.sign(accel) === Math.sign(leanSin) || leanSin === 0;
    const fade = deepening ? Math.max(0, 1 - Math.abs(leanSin) / limitSin) : 1;

    const half = this.measure.halfExtents;
    const rollInertia = INERTIA_ROLL_GAIN * (mass / 3) * (half[0] * half[0] + half[1] * half[1]);
    const rollRate = this.localAngScratch.z;
    const torque =
      (mass * accel * this.rollLeverArm * ROLL_COUPLE_GAIN * fade -
        rollInertia * ROLL_RATE_DAMPING * rollRate) *
      dt;
    rotateVector(this.forceScratch, this.rotationScratch, 0, 0, torque);
    this.chassisBody.applyTorqueImpulse(this.forceScratch, true);
  }

  private applyChassisMass(mass: number): void {
    const half = this.measure.halfExtents;
    const hx = half[0];
    const hy = half[1];
    const hz = half[2];
    // Solid-box principal inertias about the centre, scaled by mass and then by the
    // gains above: x is pitch, y is yaw, z is roll.
    const inertia = {
      x: INERTIA_PITCH_YAW_GAIN * (mass / 3) * (hy * hy + hz * hz),
      y: INERTIA_PITCH_YAW_GAIN * (mass / 3) * (hx * hx + hz * hz),
      z: INERTIA_ROLL_GAIN * (mass / 3) * (hx * hx + hy * hy),
    };
    this.chassisBody.setAdditionalMassProperties(
      mass,
      { x: 0, y: -COM_DROP_FRACTION * hy, z: -COM_REARWARD_FRACTION * hz },
      inertia,
      { x: 0, y: 0, z: 0, w: 1 },
      false,
    );
    // Make mass() current immediately so the vehicle controller's suspension
    // (which reads chassis.mass() each step) sees the new value on the next tick.
    this.chassisBody.recomputeMassPropertiesFromColliders();
  }

  /**
   * Instantiates the model: body into the chassis group, wheels held aside for
   * `rebuild` to register with the controller, gizmos onto their anchors.
   */
  private buildVisuals(): void {
    const instance = createCarModel(this.model.id);
    this.rootGroup.add(instance.body);

    this.wheelMeshes.clear();
    for (const [id, mesh] of instance.wheels) this.wheelMeshes.set(id, mesh);

    const anchors = new Map(this.measure.anchors.map((a) => [a.id, a]));
    for (const [anchorId, part] of Object.entries(this.gizmoParts())) {
      const anchor = anchors.get(anchorId);
      if (!anchor) continue; // a gizmo saved against an anchor this model lacks
      const mesh = createPartMesh(part.variantId);
      mesh.name = anchorId;
      mesh.position.set(anchor.pos[0], anchor.pos[1], anchor.pos[2]);
      mesh.rotation.y = anchor.yaw;
      setCondition(mesh, part.dirt, part.rust);
      this.rootGroup.add(mesh);
      this.gizmos.push({ part, mesh });
    }

    this.buildHeadlights();
  }

  /**
   * Two spotlights at the front corners of the measured chassis box. The model
   * already draws its lamps; these are what makes them light the road.
   */
  private buildHeadlights(): void {
    const half = this.measure.halfExtents;
    const y = -half[1] + HEADLIGHT_Y_FRACTION * 2 * half[1];
    const z = half[2];
    for (const sign of [-1, 1]) {
      const x = sign * HEADLIGHT_X_FRACTION * half[0];
      const light = new THREE.SpotLight(0xfff2d8, 120, 80, 0.55, 0.5, 1.5);
      light.position.set(x, y, z);
      light.target.position.set(x, y, z + 8);
      light.castShadow = false;
      light.visible = this.lightsOnFlag;
      this.rootGroup.add(light.target);
      this.rootGroup.add(light);
      this.headlights.push(light);
    }
  }

  /**
   * Detaches every visual without disposing anything: model geometry, model
   * materials and gizmo geometry are all owned by their caches (render/carmodel.ts,
   * render/partmesh.ts) and shared with every other instance in the world, so
   * disposing here would blank out other cars.
   */
  private clearVisuals(): void {
    for (const child of this.rootGroup.children.slice()) this.rootGroup.remove(child);
    this.wheelMeshes.clear();
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
