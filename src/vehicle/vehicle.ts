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
// THE ERA
//
// These cars are 1960s-1980s and not the good ones: a worn recirculating-ball
// box, bias-ply tyres, soft springs on weak dampers, a live rear axle, drums at
// the back and no electronics of any kind. Everything in this file that reads as
// "vague", "slow" or "unforgiving" is a named period mechanism rather than a
// difficulty knob, and each one is commented where it is defined:
//
//   STEER_PLAY_RAD          worn steering box: free play before the tyres move
//   DRIVELINE_LAG_S         driveline slack and compliance: torque arrives late
//   REAR_AXLE_SIDE_GRIP     live rear axle on leaf springs: the tail lets go first
//   BRAKE_LOCK_*            no ABS: a locked wheel is measured, not scripted
//   LATERAL_GRIP_*          bias-ply tyres: low peak, and it falls away with speed
//   ROLL_*, SUSP_* presets  soft springs, weak dampers, real body roll
//
// What is deliberately NOT modelled: brake fade, axle tramp, and bump-steer. They
// belong to the era too, but each needs state the driver cannot see or predict,
// and an unpredictable car is not the same thing as a demanding one.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Steering tuning.
//
// Four stages shape the wheel angle:
//  1. The input axis is shaped with a power law (STEER_INPUT_EXPONENT), so small
//     deflections command disproportionately small angles and response grows
//     progressively toward full lock.
//  2. The available lock falls off with speed on the t^k curve below. This is
//     geometry and tyre reality, not an electronic nanny: it keeps a fixed lock
//     from asking a bias-ply tyre for a slip angle it cannot make. The floor is
//     deliberately high (STEER_HIGH_SPEED_FRACTION), because a period car will
//     absolutely let you ask for more than it can do at speed.
//  3. The steer angle is rate-limited by speed: a slow box (~4.5 turns lock to
//     lock) cannot be flicked, which is what makes an evasive manoeuvre a
//     commitment rather than a reflex.
//  4. The result passes through STEER_PLAY_RAD of backlash, so the tyres do
//     nothing until the box takes up its slack — vagueness on centre, and a
//     double helping of it on every reversal.
// ---------------------------------------------------------------------------


/** Steering input shaping exponent: |s|^p with p>1 compresses small deflections. */
const STEER_INPUT_EXPONENT = 1.35;
/** Max rate of steering-angle change at parking speed (rad/s). */
const STEER_RATE_PARK_RAD_S = 3.4;
/** Max rate of steering-angle change at highway speed (rad/s). */
const STEER_RATE_HIGHWAY_RAD_S = 0.95;
/** Below this speed (km/h) the full steering lock is available. */
const STEER_FULL_LOCK_KMH = 20;
/** At this speed (km/h) steering reaches its reduced floor. */
const STEER_REDUCED_KMH = 100;
/**
 * Fraction of full lock retained at STEER_REDUCED_KMH. Was 0.15, which quietly
 * did the job of a stability program: the car simply refused to be asked for a
 * bad angle. At 0.42 the driver keeps the authority to provoke a slide, and the
 * slow rack below is what stops it being a twitch.
 */
const STEER_HIGH_SPEED_FRACTION = 0.42;
/**
 * Shape of the lock-vs-speed curve: fraction = 1 - (1-floor) * t^k with
 * t = (kmh - full)/(reduced - full). k < 1 front-loads the loss just above the
 * full-lock speed and then flattens out.
 */
const STEER_LOCK_CURVE = 0.161;
/** Same curve shape drives the rate-limit blend between the two speeds above. */
const STEER_RATE_CURVE = 1.6;
/**
 * Steering-box free play, radians at the ROAD WHEEL.
 *
 * A worn recirculating-ball box has 20-30° of slack at the steering wheel, which is
 * about a degree at the tyre. Implemented as a backlash operator on the commanded
 * angle: the tyres do not move until the command leaves the play window, so the
 * first bit of every input does nothing and a reversal costs 2x the play before
 * anything happens. That is the "delay between input and response", and unlike a
 * time delay it is honest, because holding an angle still holds it.
 *
 * 0.018 rad (1°) costs the first ~12% of stick travel at 80 km/h.
 */
const STEER_PLAY_RAD = 0.018;
/**
 * Caster self-centring inside the play window, rad/s.
 *
 * Backlash ALONE is not a steering system, and shipping it without this was the bug
 * that made the cars impossible to hold in a straight line: with the wheel centred
 * the command is zero, but the tyres are free anywhere inside the window, so they
 * stayed wherever the last input left them. A degree of residual steer never
 * cancels — the car just kept turning. The bench measured 8-11° of heading still
 * being wound on AFTER the steering was released, which is exactly the weave.
 *
 * A real front axle does not do that: caster trail and steering-axis inclination
 * mean the road pushes the tyres back to straight, and the slack gets taken up in
 * the direction of load rather than left hanging. So inside the window the angle
 * bleeds toward zero. Holding a steady input then parks the tyres at
 * `command - play` (slack taken up, the trailing edge of the window) and releasing
 * returns them to straight, while a reversal still has to cross the whole 2x play.
 */
const STEER_CASTER_RETURN_RAD_S = 2.0;
/**
 * Driveline slack and compliance, seconds. A leaf-sprung live axle on worn U-joints
 * does not deliver torque the instant the pedal moves: the slack takes up, the
 * shaft winds, and then the car goes. A first-order lag on the applied wheel torque
 * is the whole of it — no fake clunk, and it costs one float of state.
 */
const DRIVELINE_LAG_S = 0.1;

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
 *
 * Bias-ply, not radials. 0.4 gave a ~1 g peak, which is a modern tyre on a good
 * road; a period cross-ply on a 1970s road surface is 0.7-0.8 g, and it gives up
 * progressively rather than at a cliff edge.
 */
const LATERAL_GRIP_FRACTION = 0.33;
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
 * progressively with yaw rate (understeer) instead of an instant direction change.
 * 0.7 is a period car's vagueness: a 40-60 km/h corner runs 4-6° of slip, so the
 * car is always working and never railed, and the driver is steering the slip
 * rather than the wheels.
 */
const SIDE_FRICTION_GAIN = 0.7;
/**
 * Speed-dependent lateral grip falloff. Below LATERAL_GRIP_FALLOFF_START_MPS the
 * lateral gain is untouched; above it it is scaled down on a smoothstep toward
 * 1 - LATERAL_GRIP_MAX_LOSS. The falloff scales only the lateral (side-friction)
 * channel, so drive, brake and steering are unaffected, and a straight line
 * carries no lateral slip to amplify — so it cannot introduce straight-line
 * wander.
 *
 * Bias-ply carcasses squirm and heat, and they lose cornering force with speed far
 * earlier than a radial does, so the falloff starts at town speeds (~50 km/h) and
 * takes a third of the grip by 144 km/h.
 */
const LATERAL_GRIP_FALLOFF_START_MPS = 14;
/** Speed (m/s) at which the falloff reaches its full loss (~144 km/h). */
const LATERAL_GRIP_FALLOFF_END_MPS = 40;
/** Maximum fraction of lateral grip shed at high speed (0 = none, 1 = all). */
const LATERAL_GRIP_MAX_LOSS = 0.34;
/**
 * Rear-axle lateral grip, as a fraction of the front's.
 *
 * A live axle on leaf springs steers itself under roll and load: the axle tramps,
 * the springs wind up, and the outer tyre runs at a slip angle the driver never
 * asked for. With the rear brake bias and the mostly-RWD catalogue, this 6% is what
 * makes the TAIL the end that goes first — the car has to be driven, not aimed, and
 * it will not catch itself.
 */
const REAR_AXLE_SIDE_GRIP = 0.94;

// ---------------------------------------------------------------------------
// Braking. Rapier's setWheelBrake takes a *maximum braking impulse* (N·s), not
// a force: internally `rolling_friction` is clamped to that impulse. To brake
// the whole chassis at `a` m/s² across `n` wheels for one `dt` step, each wheel
// needs the impulse `a * mass * dt / n`.
// ---------------------------------------------------------------------------

/**
 * Foot-brake pedal DEMAND (m/s²), not an achievement.
 *
 * A master cylinder pushes the same pressure through the same shoes whatever the
 * axle load is doing, so this is what the pedal ASKS for; the friction cone decides
 * what each tyre delivers, and a tyre asked for more than its cone allows is a tyre
 * that has stopped cornering (see the friction-circle note below).
 *
 * 7.0 is chosen so that the ACHIEVED figure is period-correct: measured on the
 * bench, the cars stop from 100 km/h in 47-52 m at 0.76-0.87 g mean (the mean
 * exceeds the demand because engine braking, drag and rolling resistance are all
 * on top of it). For scale: a 9.5 demand gave 39-45 m, better than a modern car,
 * and a 6.6 demand gave 75-112 m once the rear tyres started saturating. The rear
 * axle still fills its cone at this demand, which is the part that matters — mid
 * corner it doubles the car's curvature (bench: trailYawGain 1.2-2.1).
 */
const FOOT_BRAKE_DECEL = 7.0;
/**
 * Rear bias for the foot brake (0..1).
 *
 * Discs at the front, drums at the back, and no proportioning valve to keep them
 * honest under load transfer. 0.62 sends more torque to the axle that is UNLOADING
 * under braking, which is exactly the period failure mode: the rears run out of grip
 * first and the car tries to swap ends. With the slide detection below, this is "the
 * lack of ABS made emergency braking almost an art".
 */
const FOOT_BRAKE_REAR_BIAS = 0.62;
/**
 * No-ABS, no-traction-control slide detection: the friction circle, measured.
 *
 * There is no guessing and no scripted threshold on pedal force here. Rapier clips
 * each wheel's impulse to a cone sized by that wheel's own suspension load,
 *
 *     cone = suspensionForce * dt * frictionSlip
 *
 * and the longitudinal impulse counts half against it. How much of that cone the
 * braking or driving force is eating is therefore exactly "how close is this tyre to
 * letting go", and a tyre spending its budget on stopping has nothing left to spend
 * on cornering. That is the friction circle, and it is the whole mechanism.
 *
 * Two earlier attempts are worth recording, because both looked like they worked:
 *
 *  - Watching `wheelRotation` for a stalled wheel. Never fired (0.01 through a
 *    full-pedal stop from 100 km/h): the cone scales the force down, so an
 *    over-braked tyre keeps rotating instead of locking.
 *  - Comparing delivered impulse against the brake demand. This measured the DRIVE
 *    bias, not the brake: every FWD car reported its front axle sliding and every
 *    RWD car its rear, regardless of brake balance, because a driven wheel's net
 *    impulse carries engine torque too.
 *
 * Only the longitudinal share is used. The side impulse is deliberately left out:
 * feeding the channel this modulates back into its own input is a loop, and the
 * lateral falloff above already handles cornering grip.
 *
 * The consequence is the era's: the rear axle has 62% of the brake torque and the
 * lighter load, so its cone is the first to fill and the tail is the first to go.
 * Easing the pedal puts the tyre back inside its cone and the grip returns with it,
 * which is cadence braking, learned the same way it was learned then. Under power it
 * cuts the same way, which is a rear axle that spins up and steps out — no traction
 * control, because there was none.
 */
/** Below this speed (m/s) slide is not evaluated: a stopped wheel is just stopped. */
const SLIDE_MIN_MPS = 2.5;
/** Cone fraction the longitudinal channel may eat before side grip starts to go. */
const SLIDE_CONE_THRESHOLD = 0.55;
/** Lateral grip retained by a fully sliding wheel. */
const SLIDE_SIDE_GRIP = 0.35;
/** Smoothing for the slide estimate, seconds. Long enough to ignore one bad step. */
const SLIDE_TAU = 0.05;
/**
 * Locking the wheels: the discrete end of "no ABS".
 *
 * The friction circle above is the PROGRESSIVE part — a tyre gradually running out
 * of grip. This is the other half, and it is what a driver of one of these actually
 * had to manage: stand on the pedal long enough and the wheels stop turning
 * altogether. Two locks, deliberately different:
 *
 *  - The FOOT brake locks every wheel, but only after LOCK_HOLD_S of continuous
 *    application. Stab-and-release keeps them turning; a panicked hard press does
 *    not. That is cadence braking as a mechanic rather than as a lecture, and
 *    releasing the pedal at all resets the timer.
 *  - The HANDBRAKE locks the rear axle the instant it is pulled. No timer: it is a
 *    cable pulling shoes onto drums, and it either locks them or it does not.
 *
 * A lock does three things: it drops the wheel's longitudinal demand to
 * LOCKED_DECEL, it cuts side grip to LOCKED_SIDE_GRIP, and it freezes the drawn
 * spin. The last one matters because Rapier will not stall a wheel for us (the cone
 * scales the brake force down instead), and the wheel the player is looking at has
 * to be the wheel the simulation says is locked; the spin is a pure view of
 * `wheelRotation`, so the view is where the freeze belongs.
 *
 * LOCKED_DECEL is LOWER than the rolling demand, and that direction is the whole
 * point. A sliding tyre has less grip than one at optimal slip — that is the entire
 * reason ABS was invented. The first attempt here gave a locked wheel an impulse
 * "far past anything the contact can transmit" and let the friction cone sort it
 * out, which made locking a straight upgrade: 35-38 m from 100 km/h at up to 2.2 g,
 * better than a modern car, and it taught the player to stamp on the pedal.
 *
 * What cadence braking is worth here, measured from 100 km/h, is worth being precise
 * about rather than romantic: pedal held flat 53.9 m, a tight cadence (1.0 s on,
 * 0.12 s off, never reaching the timer) 53.3 m, a loose pump (0.9 s on, 0.25 s off)
 * 57.8 m. So the technique buys a little distance and only if the releases are
 * short — release too long and the dead time costs more than the lock does. Its real
 * payoff is the other column: rolling tyres still steer, and locked ones do not.
 *
 * The rest follows from the physics rather than being written in: a locked front
 * axle carries no side force, so the car stops steering and ploughs straight; a
 * locked rear axle carries none either, so the tail comes round.
 */
/** Continuous foot-brake time (s) before the wheels stop turning. */
const LOCK_HOLD_S = 1.2;
/** Below this brake input the pedal counts as released and the timer resets. */
const LOCK_RELEASE_INPUT = 0.15;
/**
 * Deceleration (m/s²) a locked, sliding tyre delivers: ~0.57 g against the 0.71 g
 * FOOT_BRAKE_DECEL demands of a rolling one. The ratio is roughly the real
 * sliding-to-peak friction ratio for a period cross-ply.
 */
const LOCKED_DECEL = 5.6;
/** Lateral grip left on a locked, sliding tyre. */
const LOCKED_SIDE_GRIP = 0.22;
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
 * Static holding deceleration for a parked car, m/s². Applied across all four
 * wheels so a braked car remains at rest on any drivable road grade.
 */
const PARK_BRAKE_DECEL = 12.0;
/** Below this ground speed a braked car becomes a physically fixed parked car. */
const PARK_HOLD_SPEED_MPS = 0.12;
/** Residual motion treated as stopped before an automatic changes drive direction. */
const AUTO_DIRECTION_RELEASE_MPS = 0.08;

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
 *
 * 0.62, not the old 0.34, because these are period springs now: at 0.34 the softened
 * suspension still only leant 4° at 0.73 g on the bench, which is a modern car's
 * body control on 1970s springs. 0.62 lands 3° for the low-slung sports car and up
 * to 6.6° for the tall van — the body visibly takes a set and the tall bodies lean
 * hardest, which is the right ordering. The bench confirms it never approaches
 * ROLL_LIMIT_DEG or lifts a wheel in a full-lock 60 km/h turn.
 */
const ROLL_COUPLE_GAIN = 0.62;
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
const ROLL_LIMIT_DEG = 11;
/**
 * Roll-rate damping, as a fraction of roll inertia per second. Stands in for the
 * dampers' contribution about the roll axis, which the ray-cast model does not
 * produce, and is what stops the restored couple ringing.
 *
 * 1.5 was too little once the springs were softened: the body kept rocking after the
 * corner was over, which reads as a car that cannot be placed rather than a car that
 * leans. 2.6 lets it take a set and hold it. The wallow that belongs to the era is
 * in the spring rates and the vertical damping, not in an undamped roll axis.
 */
const ROLL_RATE_DAMPING = 2.6;

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
const INERTIA_PITCH_YAW_GAIN = 2.55;
/** Roll inertia is closer to a box's, since mass is not spread across the width. */
const INERTIA_ROLL_GAIN = 1.35;

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
  /** Friction-slip budget set for this wheel this step, i.e. its cone size. */
  frictionSlip: number;
  /** Smoothed slide amount, 0 = inside the friction cone, 1 = fully saturated. */
  slideT: number;
  /** Locked this step: brake held past LOCK_HOLD_S, or the handbrake on a rear. */
  locked: boolean;
  /**
   * Spin actually DRAWN, radians. Integrated here rather than read straight from
   * `wheelRotation` because a locked wheel has to look locked: Rapier keeps
   * advancing its rotation (the cone scales the brake force down instead of
   * stalling the wheel), so the view has to stop it.
   */
  drawnSpin: number;
  /** Previous `wheelRotation`, to turn its absolute value into a per-step delta. */
  prevSpin: number;
}

/** A gizmo mounted at one of the model's anchors. Cosmetic mass, nothing more. */
interface GizmoVisual {
  part: PartInstance;
  mesh: THREE.Object3D;
}

/**
 * Everything the audio layer needs to voice this car, written in place once per
 * fixed step. It is telemetry, not a sound description: the simulation reports
 * rpm, load, slip and surface, and src/audio/vehicleaudio.ts decides what that
 * sounds like. Nothing here is allocated per tick.
 */
export interface VehicleAudioState {
  rpm: number;
  idleRpm: number;
  redlineRpm: number;
  cylinders: number;
  /** Applied throttle, 0..1 — already zeroed by an empty tank. */
  throttle: number;
  brake: number;
  handbrake: boolean;
  /** Signed forward speed, m/s. */
  forwardMps: number;
  engineRunning: boolean;
  gearLabel: string;
  /** Wheels on the ground / total wheels. */
  wheelContactFraction: number;
  /** Mean micro-bump amplitude of the surfaces under the loaded wheels, metres. */
  surfaceRoughness: number;
  /** Body-frame sideways speed, m/s: the tyres' side slip. */
  lateralSlipMps: number;
  /** Downward speed killed by the ground this step, m/s. 0 when nothing landed. */
  landingImpactMps: number;
  /**
   * Mean lock-up per axle, 0..1 (see BRAKE_LOCK_* above). A tyre dragged along
   * without turning howls even in a straight line, which lateral slip alone never
   * reports — so the skid voice needs this to sound a no-ABS stop.
   */
  frontLockT: number;
  rearLockT: number;
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

type HeadlightMode = 'off' | 'low' | 'high';

/**
 * Compound factor applied uniformly to the lateral response and friction budget
 * of every wheel. Standard is the established handling baseline.
 */
const TYRE_COMPOUNDS = [
  { label: 'bald', grip: 0.55 },
  { label: 'standard', grip: 1 },
  { label: 'sport', grip: 1.35 },
] as const;

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
  private headlightMode: HeadlightMode = 'off';
  /** One selected compound for every wheel; standard preserves existing handling. */
  private tyreCompoundIndex = 1;

  private readonly dragCoeff: number;

  // Axle bookkeeping for torque splitting and the drivetrain input.
  private frontWheelCount = 0;
  private rearWheelCount = 0;
  private frontDrivenCount = 0;
  private rearDrivenCount = 0;
  private drivenRadius = 0.35;

  // Steering state. `steerCommand` is what the box has been turned to (rate
  // limited); `steerAngle` is what the tyres are actually at, which lags it by the
  // backlash in STEER_PLAY_RAD.
  private steerCommand = 0;
  private steerAngle = 0;
  /** Driveline torque actually reaching the wheels, lagged by DRIVELINE_LAG_S. */
  private appliedDriveTorqueNm = 0;
  /** Seconds the foot brake has been held without release, for the lock timer. */
  private brakeHeldS = 0;
  /**
   * Parking hold is armed by the fixed update and applied after Rapier has stepped.
   * Freezing after the step removes the tiny gravity displacement that a ray-cast
   * wheel brake otherwise accumulates while a car is stopped on a slope.
   */
  private parkingHoldRequested = false;
  private parkingHoldActive = false;
  private readonly parkingHoldPos = { x: 0, y: 0, z: 0 };
  private readonly parkingHoldRot = { x: 0, y: 0, z: 0, w: 1 };

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
  // Audio telemetry, written every fixed step and read by the audio layer at frame
  // rate. One object for the life of the vehicle; never reallocated.
  private readonly audioState: VehicleAudioState = {
    rpm: 0,
    idleRpm: 0,
    redlineRpm: 1,
    cylinders: 4,
    throttle: 0,
    brake: 0,
    handbrake: false,
    forwardMps: 0,
    engineRunning: false,
    gearLabel: 'N',
    wheelContactFraction: 0,
    surfaceRoughness: 0,
    lateralSlipMps: 0,
    landingImpactMps: 0,
    frontLockT: 0,
    rearLockT: 0,
  };
  /** Previous step's vertical velocity, for detecting a landing. */
  private prevVerticalVel = 0;
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

  get tyreCompoundLabel(): string {
    return TYRE_COMPOUNDS[this.tyreCompoundIndex].label;
  }

  get speedKmh(): number {
    return Math.abs(this.forwardSpeedMps()) * 3.6;
  }

  get engineRunning(): boolean {
    return this.statsValue.engine != null && this.localFuel > 0;
  }

  /**
   * Live audio telemetry. Returns the vehicle's own buffer, refreshed each fixed
   * step: callers read it and must not retain or mutate it.
   */
  get audio(): VehicleAudioState {
    return this.audioState;
  }


  /** Off -> dipped beam -> high beam -> off. */
  cycleHeadlights(): void {
    this.headlightMode =
      this.headlightMode === 'off' ? 'low' : this.headlightMode === 'low' ? 'high' : 'off';
    this.applyHeadlightMode();
  }

  /** Bald -> standard -> sport -> bald, applied to every wheel on the next step. */
  cycleTyreCompound(): void {
    this.tyreCompoundIndex = (this.tyreCompoundIndex + 1) % TYRE_COMPOUNDS.length;
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
    this.steerCommand = 0;
    this.steerAngle = 0;
    this.appliedDriveTorqueNm = 0;
    this.brakeHeldS = 0;
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
        frictionSlip: 0,
        slideT: 0,
        locked: false,
        drawnSpin: 0,
        prevSpin: 0,
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
    this.parkingHoldRequested = true;
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
    this.parkingHoldRequested =
      input.handbrake && (this.parkingHoldActive || Math.abs(fwd) < PARK_HOLD_SPEED_MPS);

    // Manual shift request; with driver assist on this is a +/- gate — the
    // request applies now and the next automatic decision may override it.
    if (input.shift !== 0) this.drivetrain.shift(input.shift);

    // The pedal opposite the current travel direction remains the service brake
    // until the car is nearly stopped. In particular, W must not feed torque
    // through an engaged reverse gear while it is still rolling backward.
    const automatic = this.world.state.settings.gearboxMode === 'automatic' || this.drivetrain.isPhysicallyAutomatic;
    const brakingForDirectionChange =
      automatic &&
      ((input.reverse && fwd > AUTO_DIRECTION_RELEASE_MPS) ||
        (!input.reverse && fwd < -AUTO_DIRECTION_RELEASE_MPS));
    const reverseDrive =
      automatic &&
      input.reverse &&
      fwd <= AUTO_DIRECTION_RELEASE_MPS &&
      this.drivetrain.isReverseDriveEngaged;
    const throttleInput = reverseDrive
      ? input.brake
      : brakingForDirectionChange
        ? 0
        : input.throttle;
    const throttle = this.localFuel > 0 ? throttleInput : 0;
    const drive = this.drivetrain.update(
      dt,
      throttle,
      fwd / this.drivenRadius,
      this.drivenRadius,
      automatic,
      input.reverse,
      input.throttle,
    );
    const brake = reverseDrive
      ? 0
      : Math.max(input.brake, brakingForDirectionChange ? input.throttle : 0);

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

    // Steering: shaped input, speed-scaled lock, a speed-scaled rate limit and the
    // steering box's own free play.
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
    this.steerCommand += clamp(targetSteer - this.steerCommand, -maxDelta, maxDelta);

    // Caster first, then backlash. Inside the window the tyres are not held by the
    // box at all, so the road returns them toward straight
    // (STEER_CASTER_RETURN_RAD_S); the backlash operator then drags them out of the
    // window whenever the command has moved beyond it. Order matters: centring
    // before the operator means a held input settles on the window's trailing edge
    // (slack taken up in the direction of load) instead of drifting off it.
    const caster = STEER_CASTER_RETURN_RAD_S * dt;
    this.steerAngle -= clamp(this.steerAngle, -caster, caster);
    if (this.steerCommand > this.steerAngle + STEER_PLAY_RAD) {
      this.steerAngle = this.steerCommand - STEER_PLAY_RAD;
    } else if (this.steerCommand < this.steerAngle - STEER_PLAY_RAD) {
      this.steerAngle = this.steerCommand + STEER_PLAY_RAD;
    }

    // Driveline slack and compliance: torque arrives late (DRIVELINE_LAG_S). One
    // pole, so a stab of throttle builds over ~0.3 s instead of hitting the tyres
    // on the same tick the pedal moved.
    const driveBlend = dt / (DRIVELINE_LAG_S + dt);
    this.appliedDriveTorqueNm += (drive.driveTorqueNm - this.appliedDriveTorqueNm) * driveBlend;
    // The brake pedal overrides what is left of the drive.
    //
    // With the throttle shut the drivetrain still hands out idle torque, and through
    // a low gear that is hundreds of Nm at the wheel. Braking against it wrecked the
    // stop: the driven axle's brake force was cancelled to the point that the RWD
    // cars needed 86 m from 100 km/h instead of 60, and their rear tyres never even
    // reached their friction limit, so a rear-biased brake could not step the tail
    // out. Real cars do creep against the brakes at idle in gear, but not at speed
    // and not against a firm pedal.
    const appliedTorque = this.appliedDriveTorqueNm * (1 - brake);

    // Brake impulses (N·s), distributed so the total matches the target decel.
    const mass = stats.mass;
    const frontShare = 1 - this.model.rearDriveBias;
    const rearShare = this.model.rearDriveBias;
    const brakeFrontShare = 1 - FOOT_BRAKE_REAR_BIAS;
    const brakeRearShare = FOOT_BRAKE_REAR_BIAS;
    const brakeDenom =
      this.frontWheelCount * brakeFrontShare + this.rearWheelCount * brakeRearShare;
    const footBrakeBase = brakeDenom > 0 ? (FOOT_BRAKE_DECEL * mass * dt) / brakeDenom : 0;
    const lockPerWheel = (LOCKED_DECEL * mass * dt) / Math.max(1, this.wheels.length);
    const parkingBrakePerWheel = input.handbrake
      ? (PARK_BRAKE_DECEL * mass * dt) / Math.max(1, this.wheels.length)
      : 0;

    // Foot-brake lock timer: continuous application only. Any real release (below
    // LOCK_RELEASE_INPUT) puts the wheels back on the road, which is what makes
    // pumping the pedal the technique it was.
    if (brake > LOCK_RELEASE_INPUT) this.brakeHeldS += dt;
    else this.brakeHeldS = 0;
    const footLocked = this.brakeHeldS >= LOCK_HOLD_S;

    const wheelCount = this.wheels.length;
    const totalDrivenCount = this.frontDrivenCount + this.rearDrivenCount;
    let rollingResistanceSum = 0;
    let roughnessSum = 0;
    let contactCount = 0;
    let drivenContactCount = 0;
    // Same for every wheel: the lateral grip budget (see constants above). The
    // cone cap is mass-scaled so heavy vehicles corner worse per kilogram.
    const tyreGrip = TYRE_COMPOUNDS[this.tyreCompoundIndex].grip;
    const gripBudgetFactor =
      stats.wheelGrip *
      tyreGrip *
      LATERAL_GRIP_FRACTION *
      Math.pow(GRIP_REFERENCE_MASS / mass, GRIP_MASS_EXPONENT);

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

      // A tyre spending its friction budget on stopping or accelerating has none
      // left for cornering (see the friction-circle note above). The rear parking
      // cable still marks the rear wheels locked for tyre visuals and skid audio.
      // Holding force itself is distributed across every wheel below, because a
      // rear-only cable cannot reliably hold the vehicle's mass on this game's
      // steep, uneven roads.
      const handbraked = input.handbrake && !w.isFront;
      const coneGrip = 1 - w.slideT * (1 - SLIDE_SIDE_GRIP);
      // Locked: the parking cable is immediate; the foot brake earns a lock after
      // being held for its threshold.
      const locked = handbraked || footLocked;
      const slideGrip = locked ? Math.min(LOCKED_SIDE_GRIP, coneGrip) : coneGrip;
      w.locked = locked;
      // The rear axle is a live axle on leaf springs and never had the front's
      // cornering power (REAR_AXLE_SIDE_GRIP).
      const axleGrip = w.isFront ? 1 : REAR_AXLE_SIDE_GRIP;
      const frictionSlip = surface.frictionSlip * gripBudgetFactor;
      controller.setWheelFrictionSlip(w.index, frictionSlip);
      controller.setWheelSideFrictionStiffness(
        w.index,
        surface.sideFriction *
          tyreGrip *
          SIDE_FRICTION_GAIN *
          lateralGripFactor *
          axleGrip *
          slideGrip,
      );

      const axleShare = w.isFront ? frontShare : rearShare;
      const axleCount = w.isFront ? this.frontDrivenCount : this.rearDrivenCount;
      const driven = axleShare > 0 && axleCount > 0;

      // Brakes first, because the two channels are not independent: Rapier's
      // vehicle controller (a Bullet port) computes a wheel's longitudinal impulse
      // as `engine_force * dt` whenever that force is non-zero, and only falls back
      // to the braking branch when it is exactly zero. So a wheel carrying ANY
      // drive force silently brakes with nothing at all — which is what made a
      // braked car keep its speed while its wheels were drawn locked: the driven
      // axle contributed zero retardation and the pedal only ever got the other
      // axle's share of the bias.
      //
      // Foot brake is rear-biased; the lock impulse replaces it on a locked wheel.
      // Engine braking is applied separately as a chassis impulse below — routing
      // it through setWheelBrake saturates at the same ceiling, so every gear would
      // brake the same.
      let brakeImpulse = 0;
      if (brake > 0) {
        brakeImpulse += brake * footBrakeBase * (w.isFront ? brakeFrontShare : brakeRearShare);
      }
      // A latched parking brake takes precedence across every wheel and is strong
      // enough to resist gravity on the road network; a locked foot brake otherwise
      // replaces the pedal's rolling demand.
      if (input.handbrake) brakeImpulse = parkingBrakePerWheel;
      else if (locked) brakeImpulse = lockPerWheel;
      controller.setWheelBrake(w.index, brakeImpulse);

      // Drive torque -> engine force (Newtons), signed by gear (reverse < 0). Zero
      // on any braked wheel, per the branch above: the brake wins the contact.
      let engineForce = 0;
      if (driven && brakeImpulse <= 0) {
        engineForce = wheelTorqueToForce((appliedTorque * axleShare) / axleCount, w.radius);
      }
      controller.setWheelEngineForce(w.index, engineForce);

      w.frictionSlip = frictionSlip;

      controller.setWheelSteering(w.index, w.isFront ? this.steerAngle : 0);

      if (ground) {
        contactCount++;
        rollingResistanceSum += surface.rollingResistance;
        roughnessSum += surface.roughness;
        if (driven) drivenContactCount++;
      }
    }

    controller.updateVehicle(dt);

    // Slide measurement, after the step that resolved the contacts: how much of each
    // tyre's friction cone the longitudinal channel ate. Rapier counts the forward
    // impulse at half against the cone, so the same half applies here. Evaluated
    // every step, so grip returns on its own the moment the pedal eases or the
    // wheelspin stops and the tyre is back inside its cone.
    const slideBlend = dt / (SLIDE_TAU + dt);
    const speedAbs = Math.abs(fwd);
    let frontSlideSum = 0;
    let rearSlideSum = 0;
    for (const w of this.wheels) {
      let target = 0;
      if (speedAbs > SLIDE_MIN_MPS && controller.wheelIsInContact(w.index)) {
        const load = controller.wheelSuspensionForce(w.index) ?? 0;
        const cone = load * dt * w.frictionSlip;
        if (cone > 0) {
          const used = 0.5 * Math.abs(controller.wheelForwardImpulse(w.index) ?? 0);
          const share = used / cone;
          target = clamp(
            (share - SLIDE_CONE_THRESHOLD) / (1 - SLIDE_CONE_THRESHOLD),
            0,
            1,
          );
        }
      }
      w.slideT += (target - w.slideT) * slideBlend;
      // A locked wheel is sliding by definition; no need to infer it from the cone.
      const reported = w.locked && speedAbs > SLIDE_MIN_MPS ? 1 : w.slideT;
      if (w.isFront) frontSlideSum += reported;
      else rearSlideSum += reported;
    }
    this.audioState.frontLockT =
      this.frontWheelCount > 0 ? frontSlideSum / this.frontWheelCount : 0;
    this.audioState.rearLockT = this.rearWheelCount > 0 ? rearSlideSum / this.rearWheelCount : 0;

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

    // Audio telemetry. Written after the vehicle step and the roll couple, so the
    // slip and contact numbers describe the tick that just ran; `localVelScratch`
    // holds the body-frame velocity applyRollCouple already computed, so the side
    // slip costs nothing extra. A landing is however much downward speed the
    // ground took away this step, which is exactly what should be heard as a thump.
    const audio = this.audioState;
    const engine = stats.engine;
    audio.rpm = this.drivetrain.rpm;
    audio.idleRpm = engine ? engine.idleRpm : 0;
    audio.redlineRpm = engine ? engine.redlineRpm : 1;
    audio.cylinders = engine ? engine.cylinders : 4;
    audio.throttle = throttle;
    audio.brake = brake;
    audio.handbrake = input.handbrake;
    audio.forwardMps = fwd;
    audio.engineRunning = this.engineRunning;
    audio.gearLabel = this.drivetrain.gearLabel;
    audio.wheelContactFraction = wheelCount > 0 ? contactCount / wheelCount : 0;
    audio.surfaceRoughness = contactCount > 0 ? roughnessSum / contactCount : 0;
    audio.lateralSlipMps = Math.abs(this.localVelScratch.x);
    const vy = this.linvel.y;
    audio.landingImpactMps =
      contactCount > 0 ? Math.max(0, -this.prevVerticalVel - Math.max(0, -vy)) : 0;
    this.prevVerticalVel = vy;

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
    if (this.parkingHoldRequested) {
      if (!this.parkingHoldActive) {
        this.chassisBody.translation(this.parkingHoldPos);
        this.chassisBody.rotation(this.parkingHoldRot);
        this.parkingHoldActive = true;
      } else {
        this.chassisBody.setTranslation(this.parkingHoldPos, true);
        this.chassisBody.setRotation(this.parkingHoldRot, true);
        this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    } else {
      this.parkingHoldActive = false;
    }

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
      const spin = controller.wheelRotation(w.index) ?? w.prevSpin;
      const steer = controller.wheelSteering(w.index);
      // A locked wheel is drawn stopped. Rapier keeps integrating its rotation
      // regardless, so the delta is accumulated only while the wheel is turning.
      if (!w.locked) w.drawnSpin += spin - w.prevSpin;
      w.prevSpin = spin;
      if (cp) w.mesh.position.set(cp.x, cp.y - (susp ?? 0), cp.z);
      w.mesh.rotation.set(w.drawnSpin % TWO_PI, steer ?? 0, 0);
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
   * Two persistent spotlights at the front corners of the measured chassis box.
   * They remain renderer-visible at zero intensity while off, which keeps Three's
   * spotlight shader permutation stable when the driver changes beam mode.
   */
  private buildHeadlights(): void {
    const half = this.measure.halfExtents;
    const y = -half[1] + HEADLIGHT_Y_FRACTION * 2 * half[1];
    const z = half[2];
    for (const sign of [-1, 1]) {
      const x = sign * HEADLIGHT_X_FRACTION * half[0];
      const light = new THREE.SpotLight(0xfff2d8, 0, 144, 0.52, 0.68, 1.5);
      light.position.set(x, y, z);
      light.target.position.set(x, y - 1.8, z + 26);
      light.castShadow = false;
      light.visible = true;
      this.rootGroup.add(light.target);
      this.rootGroup.add(light);
      this.headlights.push(light);
    }
    this.applyHeadlightMode();
  }

  private applyHeadlightMode(): void {
    const low = this.headlightMode === 'low';
    const high = this.headlightMode === 'high';
    const intensity = low ? 110 : high ? 210 : 0;
    const distance = high ? 260 : 144;
    const angle = high ? 0.34 : 0.52;
    const penumbra = high ? 0.45 : 0.68;
    const targetDistance = high ? 56 : 26;
    const targetDrop = high ? 0.9 : 1.8;
    for (const light of this.headlights) {
      light.intensity = intensity;
      light.distance = distance;
      light.angle = angle;
      light.penumbra = penumbra;
      light.target.position.set(
        light.position.x,
        light.position.y - targetDrop,
        light.position.z + targetDistance,
      );
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
