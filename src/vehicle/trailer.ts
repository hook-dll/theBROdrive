import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../core/physics';
import { WorldOrigin, type Rebasable, type RebaseShift } from '../world/origin';
import { SURFACES, SurfaceType } from '../core/surfaces';
import type { GameWorld, TrailerState } from '../game/state';
import type { Vehicle, WheelSprayState } from './vehicle';
import {
  brushPeakTan,
  clamp,
  combinedLateral,
  combinedLongitudinal,
  combinedLongitudinalSlope,
  FOOT_BRAKE_GRIP_RATIO,
  GRAVITY,
  HANDLING_PROFILES,
  IMPACT_UNEXPLAINED_FLOOR_MPS,
  LATERAL_STATIC_SPEED_MPS,
  LOAD_SENSITIVITY,
  LOAD_SENSITIVITY_MAX,
  LOAD_SENSITIVITY_MIN,
  LONGITUDINAL_PEAK_U,
  LONGITUDINAL_RELAXATION_FLOOR_MPS,
  rotateVector,
  SLIP_ANGLE_REF_MPS,
  SLIP_REFERENCE_MPS,
  tyreCurve,
  WHEEL_LOAD_TAU,
  WHEEL_MASS_KG,
  WHEEL_REFERENCE_RADIUS,
} from './vehicletuning';
import { weatherGrip } from '../world/weather';
import { createTrailerModel, type TrailerFit } from '../render/trailermodel';

/**
 * A towed trailer, and the drawbar hitch that couples it to any car.
 *
 * Deliberately not a `Vehicle`: no engine, gearbox, steering or driver. What it
 * shares with a car is the part that matters — Rapier's ray-cast suspension, via
 * its own `DynamicRayCastVehicleController` with two unpowered wheels, and the
 * car's own tyre law (see TRAILER TYRES below). That is what makes it behave like a
 * trailer rather than a sliding crate: the wheels resist sideways motion, so the
 * thing tracks behind you, and when it stops tracking you feel it in the car.
 *
 * The hitch sits just behind the measured rear face of the towing car. Car models
 * are centred on their measured body bounds, so `-halfExtents.z` is the exact rear
 * edge for every pack; `COUPLER_OFFSET` leaves the tow ball in free air.
 *
 * The trailer keeps one fixed physical drawbar. Its visual begins at the fitted
 * model's actual forward edge rather than the larger physics bed box, so there is
 * no empty seam between the shaft and the authored trailer body.
 *
 * Coupling is a spherical impulse joint: three free rotations, no relative
 * translation. That is a tow ball, and it gives yaw (following), pitch (cresting a
 * rise) and roll (one wheel over a rock) for free. Tongue weight transfers to the
 * car's rear axle through the joint rather than being faked by adding mass to the
 * car — which is the whole point of doing it with a real constraint. How much there
 * is follows from where the cargo sits (`TrailerState.cargoZ`, `tongueLoadN`).
 */

/** Bed half-extents, metres: a 1.8 x 0.7 x 2.8 m flatbed. */
const BED_HALF: readonly [number, number, number] = [0.9, 0.35, 1.4];
const WHEEL_RADIUS = 0.32;
/** Axle sits slightly behind the bed centre, which is what makes it track. */
const AXLE_Z = -0.2;
const TRACK_HALF = 0.95;
/** Tow-ball height above the ground, metres. Ordinary for a light trailer. */
const HITCH_HEIGHT = 0.45;
/** Tow ball behind the measured rear face of the car, metres. */
const COUPLER_OFFSET = 0.12;
/** Physical distance from the trailer bed collider to the tow ball, metres. */
const DRAWBAR_LENGTH = 0.9;
/**
 * The tow ball's position along the trailer, metres forward of the bed centre. With
 * the axle at AXLE_Z it sets the lever the tongue load is taken on: a payload centred
 * over the axle puts nothing on the ball, one centred on the bed (0.2 m ahead of it)
 * puts 0.2 / 2.5 = 8% of itself there.
 */
export const TRAILER_BALL_Z = BED_HALF[2] + DRAWBAR_LENGTH;
/** Empty mass, kg. */
export const TRAILER_TARE_KG = 320;
/** Most it will carry, kg. Enough to ruin the handling of a 900 kg car. */
export const TRAILER_CAPACITY_KG = 700;

/**
 * Trailer brakes, and why a trailer needs its own.
 *
 * Without them a trailer is two free-rolling wheels: under tow the car's brakes have
 * to stop the trailer's mass too, through the ball, and that push is what folds a rig
 * in a braked bend (`tools/trailer-sway.ts`, BRAKE).
 *
 * A light trailer's brakes are worked by the drawbar and sized to its own mass, so
 * they slow the trailer about as hard as the car slows itself: the ball carries
 * almost nothing in a straight stop. That is modelled directly: at full pedal the
 * trailer asks its tyres for the TOWING CAR's own brake deceleration
 * (`CarModelDef.brakeDecelG`, latched at coupling), as brake torque on its wheels.
 * The tyres then decide what they deliver — a trailer on sand locks its wheels like
 * the car does. It used to be a fixed 9.6 m/s² through Rapier's brake channel, which
 * could not lock and could not slide: with a real tyre that figure would lock both
 * trailer wheels on any surface at full pedal.
 */

/**
 * TRAILER TYRES: the car's tyre law on a small cross-ply.
 *
 * Rapier's own friction channels are zeroed on both wheels, exactly as the car's are,
 * and the forces come from the shared functions in vehicletuning.ts: the brush side
 * force (`brushPeakTan`, `combinedLateral`) read at a slip angle relaxed over the
 * distance rolled, the longitudinal curve read at a carcass slip relaxed the same
 * way (`combinedLongitudinal`) from a wheel that spins and locks, the two sharing one
 * patch (COMBINED SLIP), load sensitivity against each wheel's own static load, and
 * each surface's own coefficient, peak slip and rolling resistance.
 *
 * Rapier's channel was a velocity-cancelling constraint — an infinitely stiff tyre
 * that never slid, whatever the load — so the trailer had no slip angle to speak of
 * and could neither sway nor be dragged sideways on a loose verge.
 *
 * The tyre is a period trailer's 13-inch cross-ply (`tyreCurve`: peak at 8°, fading
 * to 0.86 of it by 30°, 0.45 m of relaxation). Its own coefficient is a little under
 * the catalogue cars' road tyres (`wheelGrip` 0.52-0.66): narrow, hard and cheap.
 * No temperature model: a trailer tyre does no work but roll.
 */
const TRAILER_TYRE = tyreCurve({ construction: 'crossply', aspect: 0.8 }, HANDLING_PROFILES.classic);
const TRAILER_TYRE_GRIP = 0.5;
/** One road wheel's spin inertia, kg·m²: the car's wheel (vehicletuning.ts) at this radius. */
const WHEEL_INERTIA =
  0.5 * WHEEL_MASS_KG * (WHEEL_RADIUS / WHEEL_REFERENCE_RADIUS) ** 2 * WHEEL_RADIUS * WHEEL_RADIUS;

/**
 * Suspension, in the same per-kilogram units the car catalogue uses — see the
 * suspension note in carmodels.ts for why a rate is per kilogram and why TRAVEL vs
 * SAG is the load-bearing relationship.
 *
 * A trailer carries its whole mass on TWO wheels, so the same ride as a car needs
 * twice a car's rate: the body frequency is sqrt(wheels * stiffness), and 32 on two
 * wheels is 8.0 rad/s against the road car's 8.25 on four. The first attempt used a
 * car-like 20 with only 0.22 m of travel, which settled with 32 mm of compression
 * left (`tools/trailer-bench.mjs`) — so any hummock taller than that pushed the
 * spring onto its clamp, and Rapier both draws AND simulates a clamped wheel at the
 * clamp while the ground goes on rising. That is what put one wheel under the
 * terrain with the other sitting correctly on it: not an asymmetric trailer, an
 * exhausted spring under whichever wheel found the bump. The bench measures 166 mm
 * of reserve here, which swallows a 200 mm step under one wheel with both tyres
 * still on the ground.
 */
const SUSPENSION = {
  // 1.27 Hz on two wheels: `sqrt(stiffness / cornerShare) / 2pi` with each wheel
  // carrying half the mass, which is where an empty box trailer sits.
  stiffness: 32,
  // Critical damping is `2 * sqrt(stiffness * cornerShare)` = 8.0, NOT `2 * sqrt(k)`:
  // the share of the mass on the corner belongs in it, and leaving it out is the same
  // octave slip the car catalogue had (see carmodels.ts). These are 0.30 and 0.45 of
  // critical — the car's compression/rebound split — where the old pair, believed to
  // be 0.35/0.45, were really 0.50/0.64 and bounced the hitch over every ripple.
  compression: 2.4,
  relaxation: 3.6,
  restLength: 0.3,
  maxTravel: 0.3,
  maxForce: 26000,
} as const;

/**
 * How far a settled wheel hangs below its mount, metres — MEASURED coupled and
 * empty on the bench in `tools/trailer-bench.mjs`, not derived from
 * `g / (wheels * stiffness)`. Rapier's ray-cast spring settles about a third
 * stiffer than that formula predicts (0.134 m of compression at k=32, not 0.153 m),
 * and this number is not free tuning: MOUNT_Y, the collider floor and
 * TRAILER_MODEL_FIT all key off it, so being wrong here rides the whole trailer at
 * the wrong height with its wheels tucked up into the arches.
 *
 * Re-measure with `node tools/trailer-bench.mjs 32 0.3 0.3 <hang>` after any change
 * to the spring above: the bench prints the settled bed height against the height
 * the art expects (0.670 m), and the two have to agree. They do at 0.166.
 */
const WHEEL_HANG = 0.166;
/** Wheel mount height in bed-local space, so a settled wheel centre sits at the bed underside. */
const MOUNT_Y = -BED_HALF[1] + WHEEL_HANG;
/** Ground level in bed-local space when settled. */
const GROUND_Y = -BED_HALF[1] - WHEEL_RADIUS;
/** Hitch anchor height in bed-local space. */
const HITCH_LOCAL_Y = GROUND_Y + HITCH_HEIGHT;

/**
 * The physics dimensions `render/trailermodel.ts` fits the GLB to. The art is the
 * variable here, not the physics: the bed, wheels and hitch above are authoritative
 * and the model is scaled, turned and slid until it agrees with them.
 */
export const TRAILER_MODEL_FIT: TrailerFit = {
  wheelRadius: WHEEL_RADIUS,
  axleZ: AXLE_Z,
  axleY: MOUNT_Y - WHEEL_HANG,
} as const;

/**
 * How high the bed centre sits above ground before its additional drop clearance.
 * The dev tool uses it to create the trailer in clear air above its wheels.
 */
export const TRAILER_SPAWN_HEIGHT = BED_HALF[1] + WHEEL_RADIUS;

/** Bed half-length, metres: what a spawn has to clear to land behind the player. */
export const TRAILER_HALF_LENGTH = BED_HALF[2];

/**
 * The prop stand under the drawbar, and why a trailer needs one.
 *
 * Both wheels sit BEHIND the bed's centre of mass (AXLE_Z), which is what makes a
 * trailer track instead of snake, and it means the tongue is heavy: uncoupled, there
 * is nothing ahead of the axle holding the nose up, so the whole thing pivots onto
 * its drawbar and stands 18 degrees nose-down (measured, `tools/trailer-bench.mjs`,
 * the "standing" case). Real trailers answer this with a jockey wheel or a prop
 * stand, and so does this one: a leg from the drawbar to the ground, whose collider
 * and mesh exist only while the trailer is standing on its own.
 *
 * Wound down it takes the tongue weight and the bed stands level. Coupled, it is
 * gone entirely — a leg left down would drag over every crest and fight the ball for
 * the nose weight the car is supposed to be carrying.
 */
const PROP_Z = BED_HALF[2] + 0.45;
const PROP_LEG_HALF: readonly [number, number, number] = [0.04, (HITCH_LOCAL_Y - GROUND_Y) / 2, 0.04];
const PROP_LEG_CENTRE_Y = (HITCH_LOCAL_Y + GROUND_Y) / 2;
const PROP_FOOT_HALF: readonly [number, number, number] = [0.1, 0.02, 0.1];

/** Cargo crate, drawn on the bed and carrying the payload's centre of mass. */
const CRATE_HALF: readonly [number, number, number] = [0.7, 0.45, 1.1];
const CRATE_CENTRE_Y = BED_HALF[1] + CRATE_HALF[1];
/**
 * How far the payload may sit fore or aft of the bed centre, metres: what keeps the
 * 2.2 m crate on the 2.8 m bed. Across that range the share of the rig's weight on the
 * ball runs from about 15% (crate against the headboard) to under 1% (against the
 * tailgate, its centre over the axle) at 500 kg — the whole span from a nose-heavy,
 * dead-stable tow to a tail-light one that snakes.
 */
const CARGO_Z_LIMIT = BED_HALF[2] - CRATE_HALF[2];

/**
 * An oversize load: a bed-length pile of pipes or a pair of beams that overhangs
 * BOTH ends of the 2.8 m bed. Only a contract trailer carries one.
 *
 * The load is drawn as a real collider rather than decoration, which is the point of
 * the kind: the overhang can take a traffic car or a rock, and a blow that slows the
 * trailer is what voids the special reward. Its own mass rides the existing bed
 * payload path (`cargoKg`), so the car in front feels it through the tow ball exactly
 * like any other load.
 */
const LOAD_RADIUS = 0.19;
/** Gap between the pipe centres, so three pipes span about 1.1 m. */
const LOAD_PIPE_SPREAD = 0.38;

/**
 * The oversize load's own look: bright sawn metal against the dark bed, so the
 * overhang reads from the driver's seat. Same shader features as the crate and the
 * steel, so it links the program the trailer warm-up already compiles.
 */
const matLoad = new THREE.MeshStandardMaterial({ color: 0x9e988c, roughness: 0.55, metalness: 0.35 });

/** Wheel spin is kept inside one turn, so a long haul cannot lose float precision. */
const TWO_PI = Math.PI * 2;

/**
 * Hitch drift correction.
 *
 * A tow ball does not stretch, but a spherical impulse joint does. Measured live at
 * 46-76 km/h, inside the fixed step, as the distance between the ball's two anchor
 * points (which are the same point by definition):
 *
 *   median            0.00006 m   <- exact almost always
 *   90th percentile   0.180 m
 *   99th percentile   0.403 m
 *   worst             0.874 m     <- 17% of steps over 0.10 m
 *
 * That is the reported judder, and it is not a convergence problem: quadrupling
 * `numSolverIterations` moved the 90th percentile only from 0.249 m to 0.197 m, and
 * Rapier pulls joint POSITION error back softly over many steps with no ERP knob
 * exposed for joints. It is also why the trailer was steady under braking (locked
 * wheels stop the drift accumulating) and why rolling resistance alone only cut the
 * mean: neither addresses recovery.
 *
 * So the coupling is enforced directly after each step: cancel the relative speed
 * at the ball along the error, then move the eye back onto the ball — the TRAILER
 * only, never the car (`enforceHitch` says why sharing it was worse). The joint still
 * owns all three rotations — this only removes stretch, which the ball never had.
 *
 * Correcting POSITION alone was tried first and was visibly wrong in a way worth
 * recording: the trailer stopped juddering against the car and the whole car-trailer
 * pair started juddering together instead, because every uncorrected velocity
 * mismatch was left for the solver to react to on the next step.
 *
 * WHAT IT DOES TO SWAY: nothing measurable. When it acts it takes the trailer's speed
 * relative to the ball along the error away and gives the car no reaction, so it is
 * not momentum-conserving and, in the car's frame, it is dissipative: it could only
 * ever damp a weave, never feed one, and acting often it would be a hidden damper. It
 * does not act often: with the tyre model the joint holds the ball to 0.1 mm mean and
 * 0.3 mm at the 95th percentile, the correction fires on about 6 steps in 46,000, and
 * the tail-heavy rig's sway damping at 100 km/h measures the same with it switched off,
 * to the digit (`tools/trailer-sway.ts sway`, the A/B line).
 */
const HITCH_TOLERANCE = 0.002;
/**
 * Above this the coupling is not drifting, something has been teleported — a save
 * being loaded, the fall-out-of-world rescue, a dev spawn. Yanking the car toward a
 * trailer that is half a world away is how you launch both into the sky, so the
 * correction stands down and lets `hitchTo` re-seat the pair instead.
 */
const HITCH_MAX_CORRECTION = 1.5;


/**
 * Rotates a body-local offset into world axes by a quaternion, returning plain
 * numbers. Allocation-free at the call sites that matter is not worth a scratch
 * object here: `enforceHitch` needs two of these live at the same time, and the
 * shared `vScratch` cannot hold both.
 */
function rotateLocal(
  p: { x: number; y: number; z: number },
  q: { x: number; y: number; z: number; w: number },
): { x: number; y: number; z: number } {
  const tx = 2 * (q.y * p.z - q.z * p.y);
  const ty = 2 * (q.z * p.x - q.x * p.z);
  const tz = 2 * (q.x * p.y - q.y * p.x);
  return {
    x: p.x + q.w * tx + (q.y * tz - q.z * ty),
    y: p.y + q.w * ty + (q.z * tx - q.x * tz),
    z: p.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

const matSteel = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.6, metalness: 0.5 });
const matCrate = new THREE.MeshStandardMaterial({ color: 0x8a6238, roughness: 0.9, metalness: 0 });
/**
 * One trailer wheel's tyre state, carried from step to step. Same quantities as the
 * car's `Wheel` (vehicle.ts), for the same reasons.
 */
interface TrailerWheel {
  /** Controller index. */
  readonly index: number;
  /** Which side of the bed, as the sign of its local X. */
  readonly side: number;
  /** What it carries standing level and coupled, N: the reference for μ(Fz). */
  staticLoadN: number;
  /** Low-passed normal load, N (the car's WHEEL_LOAD_TAU). */
  loadN: number;
  /**
   * The part of the axle's cornering moment the axle carries straight to this tyre,
   * N. The side force reaches the bed at hub height (see `applyTyres`), so the moment
   * of it about the ground is load transfer the springs never see; it loads the tyre
   * all the same, exactly as the car's `linkN` does.
   */
  linkN: number;
  /** Slip angle the carcass has built, radians, SIGNED: positive while the patch slides toward +X. */
  slipAngleRad: number;
  /** Wheel spin, rad/s, positive rolling forward. */
  spinRadS: number;
  /** Longitudinal slip the carcass carries (relaxed toward `slipRatio`). */
  carcassSlip: number;
  /** Geometric slip ratio this step. */
  slipRatio: number;
  /** Integrated spin for the drawn wheel, kept inside one turn. */
  drawnRad: number;
  /** Contact point this step, relative world frame. */
  readonly contact: { x: number; y: number; z: number };
  /** Contact normal this step. */
  readonly normal: { x: number; y: number; z: number };
  /** Rolling direction in the ground plane, world, unit. */
  readonly forward: { x: number; y: number; z: number };
  /** Surface under it on the last step it touched, for the brake's grip ceiling. */
  surface: SurfaceType;
}

export class Trailer implements Rebasable {
  /**
   * One spray report per wheel, written in place every fixed step and read by the
   * renderer's dust pool. Mirrors Vehicle's contract exactly so the emitter cannot
   * tell a trailer wheel from a car wheel.
   */
  private readonly sprayStates: WheelSprayState[] = [];
  private readonly wheels: TrailerWheel[] = [];
  /** Reused receivers for the per-step tyre pass, which never allocates. */
  private readonly rightScratch = { x: 0, y: 0, z: 0 };
  private readonly velocityScratch = { x: 0, y: 0, z: 0 };
  private readonly impulseScratch = { x: 0, y: 0, z: 0 };
  private readonly pointScratch = { x: 0, y: 0, z: 0 };
  private readonly rotationScratch = new RAPIER.Quaternion(0, 0, 0, 1);
  /**
   * Full-pedal deceleration the trailer's brakes ask its tyres for, m/s²: the towing
   * car's own (see the brake note at the top of the file). Latched at coupling.
   */
  private serviceBrakeDecel = 0;
  /** Static vertical load on the ball for the current payload, N (`tongueLoadN`). */
  private tongueN = 0;
  private readonly body: RAPIER.RigidBody;
  private readonly controller: RAPIER.DynamicRayCastVehicleController;
  private readonly root = new THREE.Group();
  private readonly wheelMeshes: THREE.Mesh[] = [];
  private readonly drawbar: THREE.Mesh;
  private readonly crate: THREE.Mesh;
  /**
   * Unexplained speed loss of the trailer this step, m/s, and the two numbers it
   * needs: the horizontal speed at the end of the previous step and what this
   * step's own brakes could explain. Mirrors `Vehicle.lastImpact`.
   */
  private readonly impactState = { severityMps: 0 };
  private impactThisStep = false;
  private prevSpeedMps = 0;
  private prevSpeedKnown = false;
  private ownDecelMps2 = 0;
  /** dt of the step whose physics `postStep` will read; set by `fixedUpdate`. */
  private lastStepDt = 0;
  /** Prop stand: one collider and two meshes, all live only while uncoupled. */
  private readonly propCollider: RAPIER.Collider;
  private readonly propMeshes: THREE.Mesh[] = [];
  private readonly unregisterOrigin: () => void;
  /** Procedural geometries owned by this trailer rather than the shared model. */
  private readonly disposables: THREE.BufferGeometry[] = [];

  private joint: RAPIER.ImpulseJoint | null = null;
  private disposed = false;
  /** Forward edge of the fitted trailer body, where the visual drawbar begins. */
  private readonly drawbarMountZ: number;
  /**
   * The towing chassis and both local anchors, held only while coupled. Needed by
   * `enforceHitch`, which runs every step and must not re-derive the geometry.
   */
  private hitchBody: RAPIER.RigidBody | null = null;
  private carAnchor: { x: number; y: number; z: number } | null = null;
  private trailerAnchor: { x: number; y: number; z: number } | null = null;

  /** Render interpolation snapshots, mirroring Vehicle's scheme. */
  private readonly prevPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly stepPos = new THREE.Vector3();
  private readonly stepQuat = new THREE.Quaternion();
  private snapshotPrimed = false;

  private readonly vScratch = new THREE.Vector3();
  private readonly qScratch = new THREE.Quaternion();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly world: GameWorld,
    private readonly state: TrailerState,
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
  ) {
    // `state.x/z` are absolute (from the save); Rapier holds relative positions.
    // No angular damping. It used to carry 0.2, which in yaw is a damper on the sway
    // mode worth about 0.02 of critical at 1 Hz — a fake that would hide exactly what
    // the tyres and the load placement are supposed to decide. Pitch and roll have the
    // suspension's own dampers.
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(state.x - this.origin.x, state.y, state.z - this.origin.z)
      .setRotation({ x: state.qx, y: state.qy, z: state.qz, w: state.qw })
      .setCanSleep(false);
    this.body = physics.world.createRigidBody(desc);

    // Collider floor raised to the wheel-centre line, exactly as the car's is, so
    // the bed does not catch on the ground before the suspension has any travel.
    const colliderHalfY = (BED_HALF[1] - MOUNT_Y) / 2;
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(BED_HALF[0], colliderHalfY, BED_HALF[2])
        .setTranslation(0, MOUNT_Y + colliderHalfY, 0)
        .setDensity(0)
        .setFriction(0.5)
        .setRestitution(0.02),
      this.body,
    );

    // Prop stand (see PROP_Z above). A plain collider rather than a third ray-cast
    // wheel: it is a leg, not a spring, and the difference is what stops the parked
    // trailer bouncing on its nose. High friction, because a stand that slides is a
    // trailer that walks itself down a slope.
    this.propCollider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(PROP_LEG_HALF[0], PROP_LEG_HALF[1], PROP_LEG_HALF[2])
        .setTranslation(0, PROP_LEG_CENTRE_Y, PROP_Z)
        .setDensity(0)
        .setFriction(1.2)
        .setRestitution(0),
      this.body,
    );

    this.controller = new physics.rapier.DynamicRayCastVehicleController(
      this.body,
      physics.world.broadPhase,
      physics.world.narrowPhase,
      physics.world.bodies,
      physics.world.colliders,
    );
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;

    for (const side of [-1, 1]) {
      const index = this.controller.numWheels();
      this.controller.addWheel(
        { x: side * TRACK_HALF, y: MOUNT_Y, z: AXLE_Z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        SUSPENSION.restLength,
        WHEEL_RADIUS,
      );
      this.controller.setWheelSuspensionStiffness(index, SUSPENSION.stiffness);
      this.controller.setWheelSuspensionCompression(index, SUSPENSION.compression);
      this.controller.setWheelSuspensionRelaxation(index, SUSPENSION.relaxation);
      this.controller.setWheelMaxSuspensionTravel(index, SUSPENSION.maxTravel);
      this.controller.setWheelMaxSuspensionForce(index, SUSPENSION.maxForce);
      // ZERO, both channels, as the car does: the tyre forces are this file's own
      // (`applyTyres`). Brake and side gain zero leave Rapier's controller a suspension.
      this.controller.setWheelSideFrictionStiffness(index, 0);
      this.controller.setWheelBrake(index, 0);
      this.wheels.push({
        index,
        side,
        staticLoadN: 0,
        loadN: 0,
        linkN: 0,
        slipAngleRad: 0,
        spinRadS: 0,
        carcassSlip: 0,
        slipRatio: 0,
        drawnRad: 0,
        contact: { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 1, z: 0 },
        forward: { x: 0, y: 0, z: 1 },
        surface: SurfaceType.Asphalt,
      });
      // Pre-allocated alongside the wheel, so the per-step refresh never allocates.
      this.sprayStates.push({
        contactX: 0,
        contactY: 0,
        contactZ: 0,
        absoluteContactX: 0,
        absoluteContactZ: 0,
        forwardX: 0,
        forwardY: 0,
        forwardZ: 1,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
        inContact: false,
        surface: SurfaceType.Asphalt,
        slipRatio: 0,
        slideSlip: 0,
        forwardSpeed: 0,
      });
    }

    // --- Visuals -----------------------------------------------------------
    // Body and wheels come from the fitted GLB (render/trailermodel.ts). Their
    // geometry and materials are shared with every other trailer in the world, so
    // they are never disposed here — only the procedural drawbar and crate below
    // own geometry of their own.
    const model = createTrailerModel();
    this.root.add(model.body);
    this.drawbarMountZ = model.drawbarMountZ;

    // The physical bed collider ends where the cargo box ends, while the action the
    // player aims at is the coupler out on the tongue. A sensor along the procedural
    // drawbar makes that visible geometry ray-pickable without letting a long narrow
    // collision box snag the towing car or the road. TrailerField registers it with
    // the same trailer id as the bed and prop colliders.
    const hitchZ = TRAILER_BALL_Z;
    const drawbarStart = Math.min(this.drawbarMountZ, hitchZ);
    const drawbarLength = Math.max(0.05, hitchZ - drawbarStart);
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.14, 0.14, drawbarLength / 2)
        .setTranslation(0, HITCH_LOCAL_Y, drawbarStart + drawbarLength / 2)
        .setDensity(0)
        .setSensor(true),
      this.body,
    );

    // Unit-length bar along +Z, scaled per coupling so the drawn tongue always
    // reaches exactly to the joint.
    const barGeo = new THREE.BoxGeometry(0.09, 0.09, 1);
    this.disposables.push(barGeo);
    this.drawbar = new THREE.Mesh(barGeo, matSteel);
    this.drawbar.castShadow = true;
    this.root.add(this.drawbar);

    // The controller indexes wheels right (-1) first, so the visual list must be
    // built in the same order or syncVisuals reads the wrong side's suspension.
    model.rightWheel.position.set(-TRACK_HALF, MOUNT_Y - WHEEL_HANG, AXLE_Z);
    model.leftWheel.position.set(TRACK_HALF, MOUNT_Y - WHEEL_HANG, AXLE_Z);
    this.root.add(model.rightWheel);
    this.root.add(model.leftWheel);
    this.wheelMeshes.push(model.rightWheel, model.leftWheel);

    const crateGeo = new THREE.BoxGeometry(CRATE_HALF[0] * 2, CRATE_HALF[1] * 2, CRATE_HALF[2] * 2);
    this.disposables.push(crateGeo);
    this.crate = new THREE.Mesh(crateGeo, matCrate);
    this.crate.position.set(0, CRATE_CENTRE_Y, this.cargoZ);
    this.crate.castShadow = true;
    this.root.add(this.crate);

    // An oversize load (contract kinds 7): a real collider on the overhang plus the
    // meshes that show it. The crate above is drawn for ordinary cargo only.
    const load = state.load;
    if (load) {
      const [lx, ly, lz] = load.halfExtents;
      const centreY = BED_HALF[1] + ly;
      physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(lx, ly, lz)
          .setTranslation(0, centreY, this.cargoZ)
          .setDensity(0)
          .setFriction(0.6)
          .setRestitution(0.02),
        this.body,
      );
      if (load.kind === 'pipes') {
        // Three tubes lying along the bed, which is what makes it read as a pipe
        // bundle rather than a crate. One shared cross-section per tube.
        const geo = new THREE.CylinderGeometry(LOAD_RADIUS, LOAD_RADIUS, lz * 2, 10);
        geo.rotateX(Math.PI / 2);
        this.disposables.push(geo);
        for (const offset of [-LOAD_PIPE_SPREAD, 0, LOAD_PIPE_SPREAD]) {
          const mesh = new THREE.Mesh(geo, matLoad);
          mesh.position.set(offset, BED_HALF[1] + LOAD_RADIUS, this.cargoZ);
          mesh.castShadow = true;
          this.root.add(mesh);
        }
      } else {
        const geo = new THREE.BoxGeometry(lx * 2, ly * 2, lz * 2);
        this.disposables.push(geo);
        const mesh = new THREE.Mesh(geo, matLoad);
        mesh.position.set(0, centreY, this.cargoZ);
        mesh.castShadow = true;
        this.root.add(mesh);
      }
    }

    // The prop stand's leg and foot, matching the collider above.
    const legGeo = new THREE.BoxGeometry(PROP_LEG_HALF[0] * 2, PROP_LEG_HALF[1] * 2, PROP_LEG_HALF[2] * 2);
    const footGeo = new THREE.BoxGeometry(PROP_FOOT_HALF[0] * 2, PROP_FOOT_HALF[1] * 2, PROP_FOOT_HALF[2] * 2);
    this.disposables.push(legGeo, footGeo);
    const leg = new THREE.Mesh(legGeo, matSteel);
    leg.position.set(0, PROP_LEG_CENTRE_Y, PROP_Z);
    const foot = new THREE.Mesh(footGeo, matSteel);
    foot.position.set(0, GROUND_Y + PROP_FOOT_HALF[1], PROP_Z);
    for (const mesh of [leg, foot]) {
      mesh.castShadow = true;
      this.propMeshes.push(mesh);
      this.root.add(mesh);
    }

    scene.add(this.root);

    this.setDrawbarVisual();
    // A trailer restored from a save may already be coupled; the second pass in
    // TrailerField re-hitches it, but until then the stand matches its state.
    this.setPropStand(this.state.hitchedTo === null);
    this.applyMass();
    this.syncVisuals(1);
    this.unregisterOrigin = this.origin.register(this);
  }

  get id(): string {
    return this.state.id;
  }

  get rigidBody(): RAPIER.RigidBody {
    return this.body;
  }

  get hitchedTo(): string | null {
    return this.state.hitchedTo;
  }

  get cargoKg(): number {
    return this.state.cargoKg;
  }

  /** Total mass on the road: tare plus whatever is on the bed. */
  get massKg(): number {
    return TRAILER_TARE_KG + this.state.cargoKg;
  }

  /**
   * Where the payload's centre of mass sits, metres forward of the bed centre
   * (`TrailerState.cargoZ`), held to what keeps the crate on the bed.
   */
  get cargoZ(): number {
    return Math.min(CARGO_Z_LIMIT, Math.max(-CARGO_Z_LIMIT, this.state.cargoZ ?? 0));
  }

  /**
   * TONGUE LOAD: the static vertical force the trailer puts on the tow ball, N, for
   * its current payload and placement — the trailer's weight times how far its centre
   * of mass sits ahead of the axle, over the axle-to-ball lever. Standing level with no
   * pull on the drawbar this is exactly what the joint carries (the bench measures it
   * on both ends, `tools/trailer-sway.ts load`); under way the joint carries this plus
   * whatever the drawbar's pull and the pitch of the road add, physically, and the
   * figure here stays the static spec. Read it as `tongueFraction` of the rig's weight
   * to judge the load: 7-10% is a well-loaded trailer, under ~3% is one that snakes.
   */
  get tongueLoadN(): number {
    return this.tongueN;
  }

  /** `tongueLoadN` as a fraction of the trailer's weight. */
  get tongueFraction(): number {
    return this.tongueN / (this.massKg * GRAVITY);
  }

  /**
   * Non-null during the step that classified the previous solve as a collision.
   * Same contract as `Vehicle.lastImpact`, which is what lets the trailer cargo
   * kinds read a blow the player put through the tow ball.
   */
  get lastImpact(): { readonly severityMps: number } | null {
    return this.impactThisStep ? this.impactState : null;
  }

  /** True when a world-space sphere touches the trailer bed's oriented box. */
  touchesSphere(x: number, y: number, z: number, radius: number): boolean {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.qScratch.set(r.x, r.y, r.z, r.w).invert();
    const local = this.vScratch.set(x - t.x, y - t.y, z - t.z).applyQuaternion(this.qScratch);
    const dx = Math.max(0, Math.abs(local.x) - BED_HALF[0]);
    const dy = Math.max(0, Math.abs(local.y) - BED_HALF[1]);
    const dz = Math.max(0, Math.abs(local.z) - BED_HALF[2]);
    return dx * dx + dy * dy + dz * dz <= radius * radius;
  }

  /**
   * Toggles the trailer between wheels-down and roof-down while preserving its
   * heading. This intentionally mirrors Vehicle.flipOver: a snap is dependable on
   * dunes, and the gum bubble hides the cheap rescue teleport.
   */
  flipOver(): void {
    const rotation = this.body.rotation();
    const forward = this.vScratch
      .set(0, 0, 1)
      .applyQuaternion(this.qScratch.set(rotation.x, rotation.y, rotation.z, rotation.w));
    const heading = Math.atan2(forward.x, forward.z);
    const halfHeading = heading * 0.5;
    const sin = Math.sin(halfHeading);
    const cos = Math.cos(halfHeading);
    const upY = 1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z);
    const t = this.body.translation();

    this.body.setTranslation({ x: t.x, y: t.y + 0.65, z: t.z }, true);
    this.body.setRotation(
      upY >= 0
        ? { x: sin, y: 0, z: cos, w: 0 }
        : { x: 0, y: sin, z: 0, w: cos },
      true,
    );
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.snapshotPrimed = false;
    this.resetTyres();
  }

  /**
   * Loads or empties the bed. Mass and centre of mass are the only things cargo
   * changes — there is no fragility, no lashing, no spoilage. A heavy load rides
   * high on the bed, so it raises the combined centre of mass and the trailer
   * starts wanting to swap ends. Where along the bed it rides is the state's
   * `cargoZ`, and that decides the tongue load: the rest of the difficulty of hauling.
   */
  setCargo(cargoKg: number): void {
    const clamped = Math.min(Math.max(0, cargoKg), TRAILER_CAPACITY_KG);
    if (clamped === this.state.cargoKg) return;
    this.world.apply({ t: 'trailer_cargo', trailerId: this.state.id, cargoKg: clamped });
    this.applyMass();
  }

  /**
   * Couples to a car at a tow ball just behind that model's measured rear face,
   * teleporting the trailer into place first.
   *
   * The teleport is not cosmetic: a spherical joint whose anchors start metres
   * apart is resolved by the solver as an explosion, so the trailer must already be
   * standing where the constraint wants it before the joint exists.
   */
  hitchTo(vehicle: Vehicle, carId: string): void {
    this.coupleTo(vehicle, carId, true);
  }

  /** Rebuilds a saved coupling without recording a duplicate hitch delta. */
  restoreHitch(vehicle: Vehicle, carId: string): void {
    this.coupleTo(vehicle, carId, false);
  }

  private coupleTo(vehicle: Vehicle, carId: string, recordHitch: boolean): void {
    this.detachCoupling(recordHitch);

    const measure = vehicle.modelMeasure;

    // Car models are centred on their body bounds by render/carmodel.ts. Negative Z
    // is the rear, so this puts the ball just outside the bumper instead of under
    // the body at the rear axle.
    const carAnchor = {
      x: 0,
      y: vehicle.contactPlaneLocalY + HITCH_HEIGHT,
      z: -measure.halfExtents[2] - COUPLER_OFFSET,
    };
    const trailerAnchor = {
      x: 0,
      y: HITCH_LOCAL_Y,
      z: TRAILER_BALL_Z,
    };

    // Place the trailer so its anchor already coincides with the car's, facing the
    // same way. The car's rotation carries pitch and roll too, so a car parked on a
    // slope gets a trailer on the same slope rather than one buried in the hill.
    //
    // `vehicle.chassis.translation()` is RELATIVE (Rapier's frame), so `origin`
    // below is relative too and this placement needs no origin conversion: it is
    // car-relative geometry, not a world coordinate read in from a save.
    const t = vehicle.chassis.translation();
    const r = vehicle.chassis.rotation();
    this.qScratch.set(r.x, r.y, r.z, r.w);
    const anchorWorld = this.vScratch
      .set(carAnchor.x, carAnchor.y, carAnchor.z)
      .applyQuaternion(this.qScratch)
      .add(new THREE.Vector3(t.x, t.y, t.z));
    const backFromAnchor = new THREE.Vector3(
      trailerAnchor.x,
      trailerAnchor.y,
      trailerAnchor.z,
    ).applyQuaternion(this.qScratch);
    const origin = anchorWorld.clone().sub(backFromAnchor);
    this.body.setTranslation({ x: origin.x, y: origin.y, z: origin.z }, true);

    this.body.setRotation({ x: r.x, y: r.y, z: r.z, w: r.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.snapshotPrimed = false;
    this.resetTyres();
    // The trailer's brakes are matched to the car that tows it: see the brake note.
    this.serviceBrakeDecel = vehicle.modelDef.brakeDecelG * GRAVITY;

    this.joint = this.physics.world.createImpulseJoint(
      RAPIER.JointData.spherical(carAnchor, trailerAnchor),
      vehicle.chassis,
      this.body,
      true,
    );
    // Kept for the post-step hitch correction below: the body on the other end and
    // both local anchors, so the coupling can be checked every step without
    // re-deriving the geometry or reaching back into the Vehicle.
    this.hitchBody = vehicle.chassis;
    this.carAnchor = carAnchor;
    this.trailerAnchor = trailerAnchor;
    // The shaft has no collider, but the car and trailer bodies do. Their initial
    // spacing now clears the bumper, so contacts can stay enabled and prevent the
    // car from passing through the trailer during a jackknife or reversing impact.
    this.joint.setContactsEnabled(true);

    this.setDrawbarVisual();
    // Stand wound up: the ball has the nose weight now.
    this.setPropStand(false);
    if (recordHitch) {
      this.world.apply({ t: 'trailer_hitch', trailerId: this.state.id, carId });
    }
    this.pushTransform();
  }

  /**
   * Drops the coupling. The trailer stays exactly where it is, standing on its own
   * wheels and its prop stand — which goes back down here, because the tongue weight
   * has nowhere else to go the moment the ball is gone.
   */
  unhitch(): void {
    this.detachCoupling(true);
  }

  private detachCoupling(recordUnhitch: boolean): void {
    if (this.joint) {
      this.physics.world.removeImpulseJoint(this.joint, true);
      this.joint = null;
    }
    // The correction must stop the instant the coupling does, or it would keep
    // dragging a dropped trailer toward a car that has driven away.
    this.hitchBody = null;
    this.carAnchor = null;
    this.trailerAnchor = null;
    this.setPropStand(true);
    if (recordUnhitch && this.state.hitchedTo !== null) {
      this.world.apply({ t: 'trailer_hitch', trailerId: this.state.id, carId: null });
    }
  }

  /** True while a joint exists, i.e. the coupling is live in the solver. */
  get coupled(): boolean {
    return this.joint !== null;
  }

  /**
   * Suspension, then tyres.
   *
   * `carBrake` is the towing car's SERVICE brake demand, 0..1 — the pedal, not the
   * handbrake. A real light trailer's brakes are actuated by the drawbar, so they
   * come on with the car's and let go with it; mirroring the pedal is that
   * behaviour without inventing an overrun mechanism the player cannot see.
   *
   * Uncoupled, the brakes are simply ON: both wheels held still, as by a wound-on
   * handbrake. That is the whole answer to a trailer parked on a grade rolling away:
   * since a trailer with no car attached is by definition parked, there is no state to
   * track and nothing for the player to remember. Dropping a trailer therefore leaves
   * it exactly where it was dropped.
   */
  fixedUpdate(dt: number, carBrake = 0): void {
    this.lastStepDt = dt;
    this.controller.updateVehicle(dt);
    this.applyTyres(dt, Math.min(1, Math.max(0, carBrake)));
  }

  /**
   * THE TYRE PASS: the car's tyre model on each trailer wheel, after the suspension
   * has run and before the solver, the order vehicle.ts keeps. Never allocates. It also
   * fills the spray reports and what the tyres explain of a slowdown (`ownDecelMps2`).
   *
   *   side      the slip angle of the contact patch, SIGNED and relaxed over the
   *             distance rolled (TRAILER_TYRE.relaxationM), read on the brush curve
   *             (`brushPeakTan`, load-dependent peak) under combined slip. The car
   *             relaxes the angle's size and takes its sign from the patch's speed on
   *             the step; a trailer's whole question is the lag in a weave, so here
   *             the carcass keeps its own sign while it unwinds. Applied at hub height:
   *             a beam axle hands it to the bed there, and the moment of it about the
   *             ground goes to the tyres as `linkN`.
   *   along     the car's implicit wheel-and-carcass solve (vehicle.ts, the wheel
   *             pass): brake torque on a wheel of the car's inertia, the force read back
   *             out of the wheel's own change, never driving it past synchronous speed.
   *             Parked, the wheels are held still as the car's cable holds a wheel, and
   *             a locked patch at a crawl may spend its capacity on stopping (the car's
   *             static hold, both ways here).
   *   rolling   the surface's own rolling resistance at the patch, never reversing it.
   *
   * Both capacities are the surface's μ (weather included) times the trailer tyre's
   * coefficient times load sensitivity against this wheel's static load. Every force
   * is capped at what stops the patch within the step — the car's guard against a
   * stiff tyre overshooting at 60 Hz.
   */
  private applyTyres(dt: number, pedal: number): void {
    if (!(dt > 0)) return;
    const body = this.body;
    const rotation = body.rotation(this.rotationScratch);
    const parked = !this.coupled;
    // The car's brake law (FOOT_BRAKE_GRIP_RATIO): the pedal asks for the brakes'
    // deceleration or for what the tyres can take, summed over the axle on last step's
    // loads, whichever gives out first, shared equally — so a straight stop on sand does
    // not lock both wheels, while an inside wheel unloaded in a bend still can.
    let gripN = 0;
    for (const w of this.wheels) {
      gripN += SURFACES[w.surface].mu * weatherGrip(w.surface) * TRAILER_TYRE_GRIP * w.loadN;
    }
    const brakeTorque =
      (pedal *
        Math.min(this.serviceBrakeDecel * this.massKg, FOOT_BRAKE_GRIP_RATIO * gripN) *
        WHEEL_RADIUS) /
      this.wheels.length;
    const loadBlend = dt / (WHEEL_LOAD_TAU + dt);
    const lv = body.linvel(this.velocityScratch);
    const speed = Math.hypot(lv.x, lv.z);
    const travelX = speed > 1e-3 ? lv.x / speed : 0;
    const travelZ = speed > 1e-3 ? lv.z / speed : 0;
    let retardImpulse = 0;
    let sideForceN = 0;
    const right = this.rightScratch;
    const vel = this.velocityScratch;
    const impulse = this.impulseScratch;
    const point = this.pointScratch;

    for (const w of this.wheels) {
      const s = this.sprayStates[w.index];
      const inContact = this.controller.wheelIsInContact(w.index);
      const rawLoad = inContact
        ? Math.max(0, (this.controller.wheelSuspensionForce(w.index) ?? 0) + w.linkN)
        : 0;
      w.loadN += (rawLoad - w.loadN) * loadBlend;
      s.inContact = inContact;
      if (!inContact || !(w.loadN > 0) || !(w.staticLoadN > 0)) {
        // In the air a wheel only turns, and its brake (or the parked lock) slows it.
        const brakeDelta = parked ? Infinity : (dt * brakeTorque) / WHEEL_INERTIA;
        w.spinRadS =
          Math.abs(w.spinRadS) <= brakeDelta ? 0 : w.spinRadS - Math.sign(w.spinRadS) * brakeDelta;
        w.carcassSlip = 0;
        w.slipRatio = 0;
        w.drawnRad = (w.drawnRad + w.spinRadS * dt) % TWO_PI;
        s.slipRatio = 0;
        s.slideSlip = 0;
        continue;
      }

      // The patch's own frame: the bed's forward and side axes laid into the ground.
      this.controller.wheelContactPoint(w.index, w.contact);
      this.controller.wheelContactNormal(w.index, w.normal);
      const n = w.normal;
      const f = w.forward;
      rotateVector(f, rotation, 0, 0, 1);
      let along = f.x * n.x + f.y * n.y + f.z * n.z;
      f.x -= n.x * along;
      f.y -= n.y * along;
      f.z -= n.z * along;
      let length = Math.hypot(f.x, f.y, f.z) || 1;
      f.x /= length;
      f.y /= length;
      f.z /= length;
      rotateVector(right, rotation, 1, 0, 0);
      along = right.x * n.x + right.y * n.y + right.z * n.z;
      const alongF = right.x * f.x + right.y * f.y + right.z * f.z;
      right.x -= n.x * along + f.x * alongF;
      right.y -= n.y * along + f.y * alongF;
      right.z -= n.z * along + f.z * alongF;
      length = Math.hypot(right.x, right.y, right.z) || 1;
      right.x /= length;
      right.y /= length;
      right.z /= length;
      body.velocityAtPoint(w.contact, vel);
      const forwardSpeed = vel.x * f.x + vel.y * f.y + vel.z * f.z;
      const lateralSpeed = vel.x * right.x + vel.y * right.y + vel.z * right.z;
      const absForward = Math.abs(forwardSpeed);

      const ground = this.controller.wheelGroundObject(w.index);
      const surfaceType = this.physics.surfaces.lookupType(ground ? ground.handle : null);
      const surface = SURFACES[surfaceType];
      const loadRatio = w.loadN / w.staticLoadN;
      const loadFactor = clamp(
        1 - LOAD_SENSITIVITY * (loadRatio - 1),
        LOAD_SENSITIVITY_MIN,
        LOAD_SENSITIVITY_MAX,
      );
      const capacityN =
        surface.mu * weatherGrip(surfaceType) * TRAILER_TYRE_GRIP * loadFactor * w.loadN;
      const shareMass = w.loadN / GRAVITY;

      // SIDE SLIP, built over the distance rolled.
      const geometricSlip = Math.atan2(lateralSpeed, Math.max(absForward, SLIP_ANGLE_REF_MPS));
      w.slipAngleRad +=
        (geometricSlip - w.slipAngleRad) *
        (1 - Math.exp(-(absForward * dt) / TRAILER_TYRE.relaxationM));
      const peakTan = brushPeakTan(TRAILER_TYRE.peakFrontDeg, loadRatio, loadFactor);
      const fadePeakDeg = Math.min((Math.atan(peakTan) * 180) / Math.PI, TRAILER_TYRE.fullFrontDeg - 1);
      const sideSlip = Math.tan(Math.min(Math.abs(w.slipAngleRad), 1.4)) / peakTan;

      // ALONG: the car's wheel and carcass, solved together.
      const slipScale = 1 / (surface.optimalSlip * LONGITUDINAL_PEAK_U);
      const reference = Math.max(absForward, SLIP_REFERENCE_MPS);
      const carcassBlend =
        1 -
        Math.exp(
          -(
            Math.max(absForward, Math.abs(w.spinRadS * WHEEL_RADIUS), LONGITUDINAL_RELAXATION_FLOOR_MPS) *
            dt
          ) / TRAILER_TYRE.longitudinalRelaxationM,
        );
      let forceN: number;
      let spin: number;
      if (parked) {
        const carcass = w.carcassSlip + (-forwardSpeed / reference - w.carcassSlip) * carcassBlend;
        const stopN = (shareMass * absForward) / dt;
        const slide = clamp(capacityN * combinedLongitudinal(carcass * slipScale, sideSlip), -stopN, stopN);
        // STATIC FRICTION holds against the slope as well as the slide: the impulse goes
        // in before the solver adds this step's gravity, so a hold that cancelled only
        // the speed already there is undone every step. Counting the slope took the
        // creep of a trailer parked nose-down on 12° from 25 to 15 mm/s
        // (`tools/trailer-sway.ts park`); the rest is the patch being softer than its
        // share of the mass, because the bed pitches about its centre as it is held.
        const holdSpeed = forwardSpeed - GRAVITY * f.y * dt;
        const hold =
          -Math.sign(holdSpeed) *
          Math.min(capacityN, (shareMass * Math.abs(holdSpeed)) / dt) *
          clamp(1 - absForward / LATERAL_STATIC_SPEED_MPS, 0, 1);
        forceN = Math.abs(hold) > Math.abs(slide) ? hold : slide;
        spin = 0;
      } else {
        const brakeDelta = (dt * brakeTorque) / WHEEL_INERTIA;
        spin =
          Math.abs(w.spinRadS) <= brakeDelta ? 0 : w.spinRadS - Math.sign(w.spinRadS) * brakeDelta;
        const carcass0 =
          w.carcassSlip + ((spin * WHEEL_RADIUS - forwardSpeed) / reference - w.carcassSlip) * carcassBlend;
        const stiffness =
          (capacityN *
            Math.max(0, combinedLongitudinalSlope(carcass0 * slipScale, sideSlip)) *
            slipScale *
            carcassBlend *
            WHEEL_RADIUS) /
          reference;
        const force0 = capacityN * combinedLongitudinal(carcass0 * slipScale, sideSlip);
        let delta = -(dt * force0 * WHEEL_RADIUS) / (WHEEL_INERTIA + dt * stiffness * WHEEL_RADIUS);
        const toSync = forwardSpeed / WHEEL_RADIUS - spin;
        delta = delta >= 0 ? Math.min(delta, Math.max(0, toSync)) : Math.max(delta, Math.min(0, toSync));
        forceN = clamp((-WHEEL_INERTIA * delta) / (dt * WHEEL_RADIUS), -capacityN, capacityN);
        spin -= (forceN * dt * WHEEL_RADIUS) / WHEEL_INERTIA;
      }
      w.spinRadS = spin;
      w.slipRatio = (spin * WHEEL_RADIUS - forwardSpeed) / reference;
      w.carcassSlip += (w.slipRatio - w.carcassSlip) * carcassBlend;
      w.drawnRad = (w.drawnRad + spin * dt) % TWO_PI;
      // A held wheel is not rolling, and its sliding force above is all it has.
      const rollingN = parked
        ? 0
        : -Math.sign(forwardSpeed) *
          Math.min(surface.rollingResistance * w.loadN, (shareMass * absForward) / dt);
      const alongImpulse = (forceN + rollingN) * dt;
      if (alongImpulse !== 0) {
        impulse.x = f.x * alongImpulse;
        impulse.y = f.y * alongImpulse;
        impulse.z = f.z * alongImpulse;
        body.applyImpulseAtPoint(impulse, w.contact, false);
        retardImpulse -= impulse.x * travelX + impulse.z * travelZ;
      }

      // SIDE FORCE: the curve at the built angle, or below a walk the static hold the
      // car's side force has (what the patch has left after the longitudinal force).
      const usage = capacityN > 0 ? Math.min(1, Math.abs(forceN) / capacityN) : 1;
      const curveImpulse =
        -Math.sign(w.slipAngleRad) *
        capacityN *
        combinedLateral(
          sideSlip,
          w.carcassSlip * slipScale,
          peakTan,
          fadePeakDeg,
          TRAILER_TYRE.fullFrontDeg,
          TRAILER_TYRE.plateauFront,
          true,
        ) *
        dt;
      const stopImpulse = Math.abs(lateralSpeed) * shareMass;
      const staticImpulse =
        Math.min(capacityN * dt * Math.sqrt(1 - usage * usage), stopImpulse) *
        clamp(1 - absForward / LATERAL_STATIC_SPEED_MPS, 0, 1);
      const sideImpulse = clamp(
        Math.abs(curveImpulse) >= staticImpulse ? curveImpulse : -Math.sign(lateralSpeed) * staticImpulse,
        -stopImpulse,
        stopImpulse,
      );
      if (sideImpulse !== 0) {
        impulse.x = right.x * sideImpulse;
        impulse.y = right.y * sideImpulse;
        impulse.z = right.z * sideImpulse;
        point.x = w.contact.x + n.x * WHEEL_RADIUS;
        point.y = w.contact.y + n.y * WHEEL_RADIUS;
        point.z = w.contact.z + n.z * WHEEL_RADIUS;
        body.applyImpulseAtPoint(impulse, point, false);
        retardImpulse -= impulse.x * travelX + impulse.z * travelZ;
        sideForceN += sideImpulse / dt;
      }

      s.contactX = w.contact.x;
      s.contactY = w.contact.y;
      s.contactZ = w.contact.z;
      s.absoluteContactX = w.contact.x + this.origin.x;
      s.absoluteContactZ = w.contact.z + this.origin.z;
      s.forwardX = f.x;
      s.forwardY = f.y;
      s.forwardZ = f.z;
      s.normalX = n.x;
      s.normalY = n.y;
      s.normalZ = n.z;
      s.surface = surfaceType;
      w.surface = surfaceType;
      s.forwardSpeed = forwardSpeed;
      s.slipRatio = w.slipRatio;
      // Past the surface's peak, as the car reports it: a locked trailer wheel throws.
      s.slideSlip = Math.max(0, Math.abs(w.slipRatio) - surface.optimalSlip * LONGITUDINAL_PEAK_U);
    }

    // The axle's share of the cornering moment, onto the tyres for the next step: the
    // side force acts at the patch but reaches the bed at hub height, so the tyre on
    // the side the force points away from carries `F · r / track` more (see `linkN`).
    for (const w of this.wheels) {
      w.linkN = (-w.side * sideForceN * WHEEL_RADIUS) / (2 * TRACK_HALF);
    }
    // What the tyres themselves took off the trailer's speed this step, for the impact
    // classification in `postStep`.
    const mass = body.mass();
    this.ownDecelMps2 = mass > 0 ? Math.max(0, retardImpulse) / (mass * dt) : 0;
  }

  /** Zeroes the tyres' carried state: for a teleport, where the motion they built is gone. */
  private resetTyres(): void {
    for (const w of this.wheels) {
      w.slipAngleRad = 0;
      w.spinRadS = 0;
      w.carcassSlip = 0;
      w.slipRatio = 0;
      w.linkN = 0;
    }
  }

  /** One spray report per wheel; same contract as Vehicle's. */
  get wheelSpray(): readonly WheelSprayState[] {
    return this.sprayStates;
  }

  /**
   * Pulls the drawbar eye back onto the tow ball. See HITCH_TOLERANCE above for the
   * measurements and for why the joint alone is not enough.
   *
   * Runs after the step and before the render snapshots are latched, so the drawn
   * pose is the corrected one and there is no visual seam.
   */
  private enforceHitch(): void {
    const car = this.hitchBody;
    const ca = this.carAnchor;
    const ta = this.trailerAnchor;
    if (!this.joint || !car || !ca || !ta) return;

    // BOTH translations below are in Rapier's relative frame, so the ball/eye
    // difference needs no origin conversion: subtracting the same (unused) origin
    // from each would cancel out. A 1 km origin step must never land inside this
    // read-then-write pair, which is why `PhysicsWorld.rebase` runs between the
    // physics step and this post-step correction rather than inside it.

    const ct = car.translation();
    const cr = car.rotation();
    const tt = this.body.translation();
    const trot = this.body.rotation();

    // Both anchors in world space. The rotated offsets are kept as plain numbers
    // rather than in the shared scratch vectors, because both are needed at once
    // (the velocity terms below use omega x r for each end).
    const bl = rotateLocal(ca, cr);
    const ballX = ct.x + bl.x, ballY = ct.y + bl.y, ballZ = ct.z + bl.z;
    const el = rotateLocal(ta, trot);
    const eyeX = tt.x + el.x, eyeY = tt.y + el.y, eyeZ = tt.z + el.z;

    const dx = ballX - eyeX, dy = ballY - eyeY, dz = ballZ - eyeZ;
    const err = Math.hypot(dx, dy, dz);
    if (err <= HITCH_TOLERANCE || err > HITCH_MAX_CORRECTION) return;

    const mC = car.mass();
    const mT = this.body.mass();
    if (!(mC > 0) || !(mT > 0)) return;

    // Everything below moves the TRAILER and never the car.
    //
    // Sharing the correction between both bodies was tried, mass-weighted, with
    // equal and opposite impulses so momentum was conserved. It was much worse:
    // the pair juddered together, harder the faster you went. Two reasons, and both
    // matter more than the momentum bookkeeping. The car is what the camera is
    // locked to, so a millimetre of car correction is more visible than a
    // centimetre of trailer correction; and the car is simultaneously being driven
    // by its own tyre model, which reacts to being moved, so the two fought and the
    // exchange grew with speed.
    //
    // Leaving the car alone is also the better physics of the two. The reaction a
    // 320 kg trailer's drift would put through the ball is small next to a 1240 kg
    // car on four loaded tyres, and the real load transfer — tongue weight, the
    // trailer braking the car — still goes through the joint, which is untouched.
    const nx = dx / err, ny = dy / err, nz = dz / err;
    const cv = car.linvel(), cw = car.angvel();
    const tv = this.body.linvel(), tw = this.body.angvel();
    // Velocity at each anchor: v + omega x r.
    const vbx = cv.x + (cw.y * bl.z - cw.z * bl.y);
    const vby = cv.y + (cw.z * bl.x - cw.x * bl.z);
    const vbz = cv.z + (cw.x * bl.y - cw.y * bl.x);
    const vex = tv.x + (tw.y * el.z - tw.z * el.y);
    const vey = tv.y + (tw.z * el.x - tw.x * el.z);
    const vez = tv.z + (tw.x * el.y - tw.y * el.x);
    // Drift RATE along the error. Cancelling it is what stops the correction from
    // being re-earned every step, which is the difference between a coupling that
    // settles and one that rings.
    const vRel = (vbx - vex) * nx + (vby - vey) * ny + (vbz - vez) * nz;
    if (Number.isFinite(vRel) && vRel !== 0) {
      this.body.setLinvel(
        { x: tv.x + nx * vRel, y: tv.y + ny * vRel, z: tv.z + nz * vRel },
        true,
      );
    }

    this.body.setTranslation({ x: tt.x + dx, y: tt.y + dy, z: tt.z + dz }, true);
  }

  postStep(): void {
    this.enforceHitch();
    const t = this.body.translation();
    const r = this.body.rotation();

    // IMPACT, the same way the car classifies one: horizontal speed the trailer's own
    // tyres cannot account for. `ownDecelMps2` is what the tyre pass actually took off
    // the trailer's speed this step — brakes, rolling resistance, a sideways scrub —
    // which is why a hard stop the player asked for is not an impact while a rock is;
    // the floor covers what the ball adds when the car brakes harder than the trailer.
    // Blind to a blow that jolts the load without slowing the trailer (a side swipe
    // from behind at matched speed).
    const lv = this.body.linvel();
    const speed = Math.hypot(lv.x, lv.z);
    this.impactThisStep = false;
    if (this.prevSpeedKnown && this.lastStepDt > 0) {
      const severity =
        this.prevSpeedMps - speed - this.ownDecelMps2 * this.lastStepDt
        - IMPACT_UNEXPLAINED_FLOOR_MPS;
      if (severity > 0) {
        this.impactThisStep = true;
        this.impactState.severityMps = severity;
      }
    }
    this.prevSpeedMps = speed;
    this.prevSpeedKnown = true;

    if (!this.snapshotPrimed) {
      this.prevPos.set(t.x, t.y, t.z);
      this.prevQuat.set(r.x, r.y, r.z, r.w);
      this.snapshotPrimed = true;
    } else {
      this.prevPos.copy(this.stepPos);
      this.prevQuat.copy(this.stepQuat);
    }
    this.stepPos.set(t.x, t.y, t.z);
    this.stepQuat.set(r.x, r.y, r.z, r.w);
  }

  syncVisuals(alpha: number): void {
    if (!this.snapshotPrimed) {
      const t = this.body.translation();
      const r = this.body.rotation();
      this.root.position.set(t.x, t.y, t.z);
      this.root.quaternion.set(r.x, r.y, r.z, r.w);
    } else {
      this.root.position.lerpVectors(this.prevPos, this.stepPos, alpha);
      this.root.quaternion.slerpQuaternions(this.prevQuat, this.stepQuat, alpha);
    }

    // Wheels ride their suspension and turn with their own spin. The ride comes off
    // the controller, so the drawn wheel is the one the solver used; the spin is the
    // tyre pass's own wheel, integrated like the car's `drawnSpin`, so a wheel the
    // brakes have locked is drawn locked.
    for (let i = 0; i < this.wheelMeshes.length; i++) {
      const suspension = this.controller.wheelSuspensionLength(i) ?? SUSPENSION.restLength;
      const mesh = this.wheelMeshes[i];
      mesh.position.y = MOUNT_Y - suspension;
      mesh.rotation.x = this.wheels[i].drawnRad;
    }

    this.crate.visible = this.state.cargoKg > 0 && this.state.load === undefined;
  }

  /** Pushes the current pose into state, so a save puts the trailer back here. */
  pushTransform(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    // The save stores absolute world coordinates; `t` is relative.
    this.world.apply({
      t: 'trailer_transform',
      trailerId: this.state.id,
      x: t.x + this.origin.x,
      y: t.y,
      z: t.z + this.origin.z,
      qx: r.x,
      qy: r.y,
      qz: r.z,
      qw: r.w,
    });
  }

  /**
   * Shifts the fixed-step interpolation snapshots when the floating origin moves.
   * `prevPos`/`stepPos` are relative positions held across steps; without this the
   * renderer lerps the trailer across the whole origin step for one frame.
   */
  rebase(shift: RebaseShift): void {
    this.prevPos.x -= shift.dx;
    this.prevPos.z -= shift.dz;
    this.stepPos.x -= shift.dx;
    this.stepPos.z -= shift.dz;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.detachCoupling(false);
    this.unregisterOrigin();
    this.controller.free();
    this.physics.removeBody(this.body);
    this.scene.remove(this.root);
    for (const geo of this.disposables) geo.dispose();
  }

  /** Bridges the fitted body's real front edge to the tow-ball anchor. */
  private setDrawbarVisual(): void {
    const hitchZ = TRAILER_BALL_Z;
    const length = Math.max(0.05, hitchZ - this.drawbarMountZ);
    this.drawbar.scale.z = length;
    this.drawbar.position.set(0, HITCH_LOCAL_Y, (this.drawbarMountZ + hitchZ) / 2);
  }

  /**
   * Winds the prop stand down (standing) or up (coupled). One collider and two
   * meshes, switched together — the leg has to disappear from the solver as well as
   * from the screen, or a towed trailer drags a steel post over every crest.
   */
  private setPropStand(down: boolean): void {
    this.propCollider.setEnabled(down);
    for (const mesh of this.propMeshes) mesh.visible = down;
  }

  /**
   * Mass, centre of mass, inertia and tongue load for the current load.
   *
   * Two solid boxes: the empty bed, whose mass sits low as a trailer's does, and the
   * payload — the crate, or an oversize load's own box — at its centre on top of the
   * bed, `cargoZ` along it. The inertia is the two boxes' own plus their offsets from
   * the combined centre (parallel axes), so a long load resists yaw in a way the crate
   * does not and a load pushed to the tailgate swings a longer arm. Blending the two
   * by mass is what makes a full trailer roll and a light one dart.
   *
   * The same centre of mass sets the static tongue load and each wheel's static load,
   * which is the reference the tyres' load sensitivity is taken against.
   */
  private applyMass(): void {
    const cargo = this.state.cargoKg;
    const mass = TRAILER_TARE_KG + cargo;
    const tareY = -0.35 * BED_HALF[1];
    const load = this.state.load;
    const [cx, cy, cz] = load ? load.halfExtents : CRATE_HALF;
    const cargoY = BED_HALF[1] + cy;
    const cargoZ = this.cargoZ;
    const comY = (TRAILER_TARE_KG * tareY + cargo * cargoY) / mass;
    const comZ = (cargo * cargoZ) / mass;

    const [bx, by, bz] = BED_HALF;
    const tareDy = tareY - comY;
    const tareDz = -comZ;
    const cargoDy = cargoY - comY;
    const cargoDz = cargoZ - comZ;
    const tareBox = TRAILER_TARE_KG / 3;
    const cargoBox = cargo / 3;
    this.body.setAdditionalMassProperties(
      mass,
      { x: 0, y: comY, z: comZ },
      {
        x:
          tareBox * (by * by + bz * bz) +
          cargoBox * (cy * cy + cz * cz) +
          TRAILER_TARE_KG * (tareDy * tareDy + tareDz * tareDz) +
          cargo * (cargoDy * cargoDy + cargoDz * cargoDz),
        y:
          tareBox * (bx * bx + bz * bz) +
          cargoBox * (cx * cx + cz * cz) +
          TRAILER_TARE_KG * tareDz * tareDz +
          cargo * cargoDz * cargoDz,
        z:
          tareBox * (bx * bx + by * by) +
          cargoBox * (cx * cx + cy * cy) +
          TRAILER_TARE_KG * tareDy * tareDy +
          cargo * cargoDy * cargoDy,
      },
      { x: 0, y: 0, z: 0, w: 1 },
      false,
    );
    this.body.recomputeMassPropertiesFromColliders();

    // Moments about the axle, level and with no pull on the drawbar: the ball carries
    // the share of the weight its lever gives it, the two tyres the rest.
    const weight = mass * GRAVITY;
    this.tongueN = (weight * (comZ - AXLE_Z)) / (TRAILER_BALL_Z - AXLE_Z);
    for (const w of this.wheels) w.staticLoadN = (weight - this.tongueN) / this.wheels.length;
  }
}

/**
 * Every trailer in the world, and the collider map that lets the aim ray name one.
 *
 * Mirrors `LoosePartField`: `WorldState.trailers` is authoritative, the bodies and
 * meshes here are derived views, and every mutation records into state first. A
 * trailer is NOT chunk-owned — it moves, so it must outlive the chunk it was found
 * in, exactly like a car does.
 */
export class TrailerField {
  private readonly trailers = new Map<string, Trailer>();
  private readonly colliderToTrailerId = new Map<number, string>();
  /** Invisible instance that holds the trailer material's program compiled from boot. */
  private readonly warmup = new THREE.Group();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly world: GameWorld,
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
  ) {
    this.mountWarmup();
  }

  /**
   * Holds the trailer material's program compiled from boot.
   *
   * A trailer is visualised only when it materialises at an encounter, so its one
   * shared material — which no warmed car model draws, because the car paints carry
   * their own custom program cache key — would first compile and link mid-drive.
   * `createTrailerModel` wraps the template's shared geometry and material, so one
   * invisible instance is enough; Three's `compile` walks the scene with `traverse`,
   * not `traverseVisible`, and covers the body and wheel layouts.
   */
  private mountWarmup(): void {
    if (this.warmup.children.length > 0) return;
    const model = createTrailerModel();
    for (const mesh of [model.body, model.leftWheel, model.rightWheel]) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.visible = false;
      this.warmup.add(mesh);
    }
    // The oversize load's material shares the crate's shader features, but a contract
    // trailer is spawned long after boot, so its one instance is compiled here with the
    // rest rather than the first time a pipe bundle is drawn.
    const load = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), matLoad);
    load.castShadow = false;
    load.receiveShadow = false;
    load.visible = false;
    this.warmup.add(load);
    this.scene.add(this.warmup);
  }

  /** The number of trailers with physics and visuals currently materialised. */
  get liveCount(): number {
    return this.trailers.size;
  }

  /** Records a trailer into state and materialises it. Idempotent per id. */
  spawn(state: TrailerState): Trailer | null {
    if (this.trailers.has(state.id)) return this.trailers.get(state.id) ?? null;
    this.world.apply({ t: 'trailer_add', trailer: state });
    return this.materialise(this.world.state.trailers[state.id] ?? state);
  }

  /**
   * Rebuilds every trailer from a loaded save, then restores the couplings. The
   * caller supplies the vehicle lookup because `Vehicle` instances are owned by the
   * composition root, not here.
   */
  restoreFromState(vehicleFor: (carId: string) => Vehicle | null): void {
    this.dispose();
    // `dispose` took the warm-up node with it, so put it back before anything can
    // draw: a restored save may hold no trailer at all.
    this.mountWarmup();

    for (const state of Object.values(this.world.state.trailers)) {
      this.materialise(state);
    }
    // Second pass: a coupling needs both ends to exist.
    for (const trailer of this.trailers.values()) {
      const carId = trailer.hitchedTo;
      if (carId === null) continue;
      const vehicle = vehicleFor(carId);
      // A save whose towing car has gone leaves the trailer standing where it is
      // rather than refusing to load.
      if (vehicle) trailer.restoreHitch(vehicle, carId);
      else trailer.unhitch();
    }
  }

  /**
   * Reconciles the runtime set with saved trailers around an absolute position.
   * Coupled trailers follow their live towing vehicle rather than the player so a
   * car cannot out-run its own drawbar. Standing trailers use separate radii to
   * avoid repeatedly rebuilding at one boundary.
   */
  updateActive(
    absoluteX: number,
    absoluteZ: number,
    vehicleFor: (carId: string) => Vehicle | null,
    loadRadius: number,
    unloadRadius: number,
  ): void {
    if (!(loadRadius >= 0) || !(loadRadius < unloadRadius)) {
      throw new RangeError('TrailerField load radius must be non-negative and smaller than unload radius');
    }
    const loadRadiusSq = loadRadius * loadRadius;
    const unloadRadiusSq = unloadRadius * unloadRadius;

    for (const state of Object.values(this.world.state.trailers)) {
      let trailer = this.trailers.get(state.id) ?? null;
      const carId = state.hitchedTo;
      const vehicle = carId === null ? null : vehicleFor(carId);

      if (vehicle && carId !== null) {
        if (!trailer) trailer = this.materialise(state);
        if (!trailer.coupled) trailer.restoreHitch(vehicle, carId);
        continue;
      }

      // Authoritative state says this trailer is not towed by a live car, so a
      // surviving joint is stale: the towing body may already be gone, and the
      // `coupled` guard below would otherwise pin the trailer alive forever.
      // `unhitch` only records a delta when state still claims a coupling, so this
      // is silent when state is what changed.
      if (trailer?.coupled) trailer.unhitch();

      // A live standing trailer's body may have moved since its last state snapshot.
      // Use Rapier's current relative pose plus the floating-origin offset; dormant
      // trailers have no body, so only those fall back to their saved absolute pose.
      const position = trailer?.rigidBody.translation();
      const x = position ? position.x + this.origin.x : state.x;
      const z = position ? position.z + this.origin.z : state.z;
      const dx = x - absoluteX;
      const dz = z - absoluteZ;
      const distanceSq = dx * dx + dz * dz;
      if (!trailer) {
        if (distanceSq <= loadRadiusSq) this.materialise(state);
        continue;
      }

      // A joint owns a live physics relationship and must never be torn down by
      // range streaming. In the normal path `vehicle` above keeps it alive.
      if (!trailer.coupled && distanceSq > unloadRadiusSq) {
        this.dematerialise(trailer);
      }
    }
  }

  get(id: string): Trailer | null {
    return this.trailers.get(id) ?? null;
  }

  /**
   * Drops a trailer that left authoritative state — a contract trailer handed over
   * at a courier. `updateActive` reconciles FROM state, so a trailer missing there
   * would never be visited again and its body, meshes and collider map would stand
   * in the world for the rest of the session.
   */
  remove(id: string): void {
    const trailer = this.trailers.get(id);
    if (!trailer) return;
    this.removeColliderHandles(trailer);
    this.trailers.delete(id);
    trailer.dispose();
  }

  /** Visits each live trailer without allocating a temporary collection. */
  forEach(visit: (trailer: Trailer) => void): void {
    for (const trailer of this.trailers.values()) visit(trailer);
  }

  trailerIdForCollider(colliderHandle: number): string | null {
    return this.colliderToTrailerId.get(colliderHandle) ?? null;
  }

  /** The live trailer coupled to this car, if any. */
  hitchedTo(carId: string): Trailer | null {
    for (const trailer of this.trailers.values()) {
      if (trailer.hitchedTo === carId) return trailer;
    }
    return null;
  }

  /**
   * Suspension and brake step for every live trailer, towed or standing.
   *
   * `brakeForCar` reports a car's service-brake demand (0..1) by id. It is a lookup
   * rather than a single number because each coupled trailer follows the pedal of
   * the car it is actually attached to, not the one the player happens to be in.
   */
  fixedUpdate(dt: number, brakeForCar: (carId: string) => number): void {
    for (const trailer of this.trailers.values()) {
      const carId = trailer.hitchedTo;
      trailer.fixedUpdate(dt, carId === null ? 0 : brakeForCar(carId));
    }
  }

  postStep(): void {
    for (const trailer of this.trailers.values()) trailer.postStep();
  }

  syncVisuals(alpha: number): void {
    for (const trailer of this.trailers.values()) trailer.syncVisuals(alpha);
  }

  /**
   * Visits every live trailer wheel's spray report. A callback rather than a
   * collected array so nothing allocates per frame; trailers are few and the dust
   * emitter is the only caller.
   */
  forEachSpray(visit: (state: WheelSprayState) => void): void {
    for (const trailer of this.trailers.values()) {
      for (const state of trailer.wheelSpray) visit(state);
    }
  }

  /** Records every live trailer's pose, so a save puts them all back. */
  pushTransforms(): void {
    for (const trailer of this.trailers.values()) trailer.pushTransform();
  }

  /** Releases every derived runtime object while retaining authoritative state. */
  dispose(): void {
    for (const trailer of this.trailers.values()) {
      this.removeColliderHandles(trailer);
      trailer.dispose();
    }
    this.trailers.clear();
    this.colliderToTrailerId.clear();
    this.scene.remove(this.warmup);
    this.warmup.clear();
  }

  private materialise(state: TrailerState): Trailer {
    const trailer = new Trailer(this.physics, this.world, state, this.scene, this.origin);
    this.trailers.set(state.id, trailer);
    const body = trailer.rigidBody;
    for (let i = 0; i < body.numColliders(); i++) {
      this.colliderToTrailerId.set(body.collider(i).handle, state.id);
    }
    return trailer;
  }

  /** Flushes a standing trailer before dropping all non-authoritative runtime state. */
  private dematerialise(trailer: Trailer): void {
    trailer.pushTransform();
    this.removeColliderHandles(trailer);
    this.trailers.delete(trailer.id);
    trailer.dispose();
  }

  private removeColliderHandles(trailer: Trailer): void {
    const body = trailer.rigidBody;
    for (let i = 0; i < body.numColliders(); i++) {
      this.colliderToTrailerId.delete(body.collider(i).handle);
    }
  }
}
