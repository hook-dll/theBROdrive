/**
 * The drivable car: a Rapier dynamic chassis + ray-cast wheels + the drivetrain
 * simulation, with Three.js meshes as pure derived views.
 *
 * The car itself is ONE complete visual and physics model (vehicle/carmodels.ts):
 * collider, suspension mounts and wheel radii are measured from its geometry.
 * Drivability comes from the four typed service cells under the bonnet: engine and
 * fuel tank are required, coolant and oil protect the engine, turbine is optional.
 *
 * Anchor gizmos remain cosmetic. They add mass and looks, never capability; unlike
 * the bonnet cells they are not service fittings.
 *
 * Ownership rules (see game/state.ts): the authoritative state lives in
 * `GameWorld` / `CarState`. This class reads `carState.gizmos`, reads/writes the
 * chassis rigid body (the physics-derived view), and emits throttled deltas
 * through `world.apply`. It never mutates `CarState` directly.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld, Vec3 } from '../core/physics';
import type { InputFrame } from '../core/input';
import { MicroRelief, RoadTexture, SURFACES, SurfaceType } from '../core/surfaces';
import { WorldOrigin, type Rebasable, type RebaseShift } from '../world/origin';
import type { CarState, GameWorld } from '../game/state';
import { variant, COOLANT_LOSS_LPH, OIL_LOSS_LPH } from '../parts/registry';
import type { CarStats, EngineSpec, PartInstance } from '../parts/registry';
import {
  carModel,
  STYLIZED_TAILLIGHT_COLOR,
  frontWeightFraction,
  modelEngine,
  modelGearbox,
  staticSagM,
  wheelDampingRate,
  wheelSpringRate,
  type CarModelDef,
  type HandlingProfile,
} from './carmodels';
import { bonnetCanRun, bonnetPart, destroyedEngineSpec, engineFailureReason } from './bonnet';
import { Drivetrain, wheelTorqueToForce } from './drivetrain';
import {
  STEERING_WHEEL_NODE,
  carModelMeasure,
  createCarModel,
  type CarModelMeasure,
} from '../render/carmodel';
import { createPartMesh } from '../render/partmesh';
import { setPartCondition } from '../render/materials';
import type { VehicleLightRig } from '../render/vehiclelights';

const GRAVITY = 9.81;

// ---------------------------------------------------------------------------
// MECHANICAL CHARACTER
//
// The original Soviet cars are 1960s-1980s machinery: a worn
// recirculating-ball box, bias-ply tyres, soft springs on weak dampers, a live rear
// axle, drums at the back and no electronics. Those constants remain the `classic`
// baseline below. Later Stylized cars select `road`, `sport` or `utility`, changing
// only the mechanisms their represented chassis actually changes: steering rate and
// play, driveline compliance, radial-tyre response, speed loss and axle balance.
//
// Braking, surfaces, damage and suspension integration stay shared. This is one
// vehicle model with data-driven construction, not a second physics path for an
// asset pack.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Steering tuning.
//
// Four stages shape the wheel angle:
//  1. The profile shapes the input axis with a power law, progressively or directly.
//  2. Available lock falls with speed; later steering retains more authority.
//  3. Steering angle is rate-limited by the profile's rack or box speed.
//  4. The result passes through the profile's mechanical backlash window.
//
// The constants immediately below are the established `classic` values. They feed
// `HANDLING_PROFILES`; fixedUpdate reads only the selected immutable profile.
// ---------------------------------------------------------------------------


/** Steering input shaping exponent: |s|^p with p>1 compresses small deflections. */
const STEER_INPUT_EXPONENT = 1.55;
/** Max rate of steering-angle change at parking speed (rad/s). */
const STEER_RATE_PARK_RAD_S = 2.0;
/** Max rate of steering-angle change at highway speed (rad/s). */
const STEER_RATE_HIGHWAY_RAD_S = 0.5;
/** Below this speed (km/h) the full steering lock is available. */
const STEER_FULL_LOCK_KMH = 20;
/** At this speed (km/h) steering reaches its reduced floor. */
const STEER_REDUCED_KMH = 100;
/**
 * Fraction of full lock retained at STEER_REDUCED_KMH. Enough remains for an
 * intentional slide, but an ordinary key tap cannot demand cornering lock at speed.
 */
const STEER_HIGH_SPEED_FRACTION = 0.44;
/**
 * Lock falls progressively with speed. The old 0.161 exponent discarded almost
 * half the available steering by 50 km/h, so slowing before a turn barely changed
 * wheel angle and felt like permanent understeer.
 */
const STEER_LOCK_CURVE = 1.0;
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
const STEER_PLAY_RAD = 0.024;
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
const STEER_CASTER_RETURN_RAD_S = 1.2;
/**
 * Uneven-load steering disturbance. A worn front end does not keep both tie rods
 * perfectly aligned when one wheel climbs a bump. The effect is driven by the actual
 * left/right suspension-load difference, amplified by rough surfaces, and filtered so
 * one collider triangle cannot teleport the steering wheel.
 */
const BUMP_STEER_MAX_RAD = 0.022;
const BUMP_STEER_TAU = 0.09;
const BUMP_STEER_FULL_ROUGHNESS = 0.045;
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
/*
 * There was a SIDE_FRICTION_GAIN here: 0.7, the gain on Rapier's lateral constraint,
 * documented as "a period car's vagueness — a 40-60 km/h corner runs 4-6 degrees of
 * slip". It never did. A velocity-cancelling constraint has no curve under it, so the
 * measured figure was 1.2-1.4 degrees whatever this number was, and the gain only
 * decided how hard the rail was. LATERAL_MU and the slip-angle curve now produce that
 * slip for real, so the knob is gone rather than left to imply something it never did.
 */
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
/**
 * Maximum fraction of lateral grip shed at high speed (0 = none, 1 = all).
 *
 * This is the lever that makes instability SPEED-TRIGGERED rather than always-on:
 * planted in a straight line, honest through a slow curve, and something to catch
 * once too much speed has been carried in.
 *
 * Cut from 0.42 with the whole reason it existed inverted. Against Rapier's
 * velocity-cancelling constraint, shedding grip could not make the car floaty: an
 * infinitely stiff axle at 58% of its capacity is still infinitely stiff, so the
 * number only decided WHEN the rail let go. Against a real curve it removes
 * CORNERING STIFFNESS too, and that is what a car sliding "as if on an air cushion"
 * at speed is: reported from play, along with the rear stepping out slightly and
 * constantly in FWD and RWD alike, because the rear sheds REAR_SPEED_LOSS_GAIN more
 * of it than the front.
 *
 * There is a third symptom the same number caused, and it is the one that proves the
 * mechanism: TOP SPEED DROPPED. Side force acts perpendicular to the WHEEL, not to
 * the car's path, so a tyre carrying a slip angle spends `Fy · sin(alpha)` of it
 * pointing backwards. That is cornering drag, and it is real — but with soft tyres
 * the straight-line slip needed to hold a camber runs a few degrees, and a few
 * degrees of a 0.85 g tyre is several hundred newtons of it. On the same order as the
 * aerodynamic drag the top speed is set by.
 *
 * 0.18 keeps the character — a flat-out corner has meaningfully less grip than a
 * third-gear one — without paying for it in stiffness the car needs everywhere.
 */
const LATERAL_GRIP_MAX_LOSS = 0.26;
/**
 * Rear-axle lateral grip, as a fraction of the front's.
 *
 * A live axle on leaf springs steers itself under roll and load: the axle tramps, the
 * springs wind up, and the outer tyre runs at a slip angle the driver never asked for.
 *
 * 0.95, not 0.89. The old figure was authored to make the tail the end that goes, back
 * when nothing else could: the constraint model had no load transfer worth the name and
 * no combined-slip trade, so balance had to be written in by hand. Both exist now —
 * mu(Fz) means the loaded outer tyre gives up first and the friction ellipse means a
 * driven rear spends its side grip on power — so the authored deficit is stacked on top
 * of emergent ones, and the stack was the rear sliding in every corner in every car.
 */
const REAR_AXLE_SIDE_GRIP = 0.95;

// ---------------------------------------------------------------------------
// Slip angle: the difference between a car that PLOUGHS and one you can catch.
//
// Everything above this block loses grip for LONGITUDINAL reasons — the friction
// cone eaten by drive or brake force (SLIDE_*), a locked wheel (LOCKED_SIDE_GRIP).
// A pure cornering breakaway has neither: lift off mid-bend, turn in too hard, and
// the tyres are barely using their longitudinal channel at all. Before this, the
// only thing that limited such a corner was Rapier clipping the side impulse at the
// cone, which is a CEILING, not a curve: side force rose linearly with slip until
// it hit a wall, so the car understeered wide with a dead front end and the tail
// never came round on its own.
//
// A real tyre makes its peak side force at a few degrees of slip angle, then gives
// force back as slip grows — but it gives back to a PLATEAU, not to zero. That
// plateau is precisely the property being modelled here, because it is what makes a
// slide something you can fight:
//
//   - Below the peak angle nothing at all changes. Straight lines and gentle
//     curves run at 1-3 degrees, so ordinary driving is untouched.
//   - Past the peak the axle sheds side force smoothly, so the break is felt
//     building instead of arriving.
//   - Past the full angle it stops shedding. There is still real force under the
//     car at 30 degrees of slip, which is what a correction has to work against.
//
// The REAR peaks earlier and falls to a lower plateau than the front. That single
// asymmetry is what puts the tail out first and leaves the front with enough grip
// to steer with while it is out — a car that loses both ends together cannot be
// caught by anybody, and one that loses only the front just washes wide.
// ---------------------------------------------------------------------------

/**
 * Slip angle (deg) where each axle makes peak side force, and the fraction it keeps
 * once past it.
 *
 * THE REAR MATCHES THE FRONT PAST PEAK, and that is the difference between a slide
 * you can catch and one you cannot. The rear used to peak at 6 degrees against the
 * front's 8 and then fall to 0.62 against the front's 0.80 — earlier AND twice as
 * far. Stack that on REAR_AXLE_SIDE_GRIP and REAR_SPEED_LOSS_GAIN and the yaw
 * feedback is POSITIVE: more yaw gives more rear slip gives less rear grip gives more
 * yaw. At 100 km/h and 15 degrees of slip the rear ended on ~0.48 of lateral gain
 * against the front's ~0.72, so there was no restoring moment for a countersteer to
 * work against and the only outcomes were a spin or a lucky lift.
 *
 * The character is preserved by MAGNITUDE, not by falloff, which is the right split:
 * REAR_AXLE_SIDE_GRIP (0.89) and REAR_SPEED_LOSS_GAIN (1.32) are untouched, so the
 * tail still lets go first and still lets go earlier the faster you are going. What it
 * no longer does is keep letting go once it has gone — past peak it HOLDS, so a small
 * countersteer produces real force and the car comes back.
 *
 * `SLIP_FULL_REAR_DEG` stays below the front's, so the rear reaches its plateau
 * sooner. That keeps a trace of the old suddenness at the moment of breakaway without
 * costing anything at the angles a save is made at.
 */
/**
 * Peak slip angles encode axle cornering stiffness. Rear tyres remain slightly
 * stiffer near centre for straight-line stability, but the old 8° front against 6°
 * rear made the front roughly 25% softer and every car ploughed regardless of speed.
 * A 6.6° front peak retains mild understeer without making it the only handling state.
 */
const SLIP_PEAK_FRONT_DEG = 6.6;
const SLIP_PEAK_REAR_DEG = 6;
/**
 * Sharpness of the rise to peak: `tanh(k · a/a_peak) / tanh(k)`.
 *
 * A quarter sine was the first shape, and it is too soft where a tyre is stiffest. A
 * real carcass does most of its work in the first degree or two and then rounds over;
 * a sine spreads the same rise evenly across the whole approach, so the car floated
 * around centre and needed real slip to hold a camber — which is both the "air
 * cushion" feel reported from play and, through cornering drag, the lost top speed.
 *
 * At k = 2.2 the initial slope is 2.2/tanh(2.2) ≈ 2.28 against the sine's 1.57, so
 * the tyre is about 45% stiffer in the degrees ordinary driving lives in, with the
 * peak, the plateau and the ultimate capacity all exactly where they were. The slip a
 * given corner runs comes down with it: 0.7 g now arrives at about 4.3 degrees rather
 * than 5, still inside the 4-6 the model is built around.
 */
const SLIP_CURVE_SHARPNESS = 2.2;
/** `tanh(k)`, so the shape normalises to exactly 1 at the peak without a per-wheel call. */
const TANH_SHARPNESS = Math.tanh(SLIP_CURVE_SHARPNESS);
/** Slip angle (deg) by which the fade is complete and the plateau has been reached. */
const SLIP_FULL_FRONT_DEG = 26;
const SLIP_FULL_REAR_DEG = 22;
/** Side grip retained on the plateau, as a fraction of the axle's peak. */
const SLIP_PLATEAU_FRONT = 0.8;
const SLIP_PLATEAU_REAR = 0.8;
/**
 * Loose ground does not gain this extra resistance until a tyre is genuinely
 * travelling sideways. Below the start it still has only its ordinary cornering
 * coefficient; by the full speed it is ploughing a bank of material.
 */
const DEFORMATION_DRAG_START_MPS = 1.5;
const DEFORMATION_DRAG_FULL_MPS = 8;
/** Contact speed (m/s) floor in the slip-angle denominator, to keep it finite at rest. */
const SLIP_ANGLE_REF_MPS = 2;
/**
 * Extra share of the high-speed lateral loss (LATERAL_GRIP_MAX_LOSS) applied to the
 * REAR axle only. 1 = both axles lose the same; above 1 the tail is the end that speed
 * takes away from, so a bend taken 20 km/h too fast is an edgier car.
 *
 * Reduced from 1.32 with the same report. Against a constraint this only made the car
 * turn in more keenly at speed; against a real force it removes rear stiffness exactly
 * where the aerodynamic and yaw disturbances are largest, which is where the wag was
 * worst. 1.15 keeps the character and stops paying for it with stability.
 */
const REAR_SPEED_LOSS_GAIN = 1.2;
/**
 * Peak lateral coefficient on dry asphalt before load, speed and axle modifiers.
 * Surface multipliers are normalized with asphalt = 1, so this carries the absolute
 * road coefficient previously split between `LATERAL_MU` and asphalt's misleading
 * `sideFriction: 2`.
 */
const LATERAL_MU = 1.7;
/**
 * Forward speed (m/s) below which a tyre may spend its whole lateral capacity on
 * holding rather than on a slip-angle curve. A shade under walking pace: fast enough
 * that parking, kerbing and creeping on a camber behave like rubber on tarmac,
 * slow enough that it can never help a moving car corner.
 */
const LATERAL_STATIC_SPEED_MPS = 1.4;

/**
 * Pneumatic trail, metres: how far BEHIND the contact centre a slipping tyre's side
 * force actually acts.
 *
 * This is the term the model never had, and its absence is the other half of the tail
 * wag. A real tyre's contact patch loads up towards its rear as it slips, so the side
 * force arrives with a lever about the vertical axis and produces a moment that
 * opposes the slip. Summed over four wheels that moment is the car's principal source
 * of YAW DAMPING — it is what makes a disturbed car settle rather than hunt, and it is
 * why a real steering wheel pulls itself straight.
 *
 * Rapier's constraint model made it unnecessary to notice: a velocity-cancelling
 * constraint is its own damper. A curve is not, so the moment has to be put back, the
 * same way `applyRollCouple` and `applyAntiPitch` put back moments this vehicle
 * controller drops.
 *
 * 0.045 m is a period cross-ply at moderate slip. It is deliberately NOT scaled down
 * as slip grows (real trail collapses past the peak, which is the wheel going light in
 * your hands): that collapse is exactly the destabilising part, there is no
 * force-feedback wheel here to feel it in, and the file's own countersteer notes are
 * about keeping a slide catchable rather than making it snap.
 */
const PNEUMATIC_TRAIL_M = 0.045;
/**
 * Countersteer authority, and why the steering limiter has to step out of the way.
 *
 * STEER_HIGH_SPEED_FRACTION and STEER_RATE_HIGHWAY_RAD_S exist to stop the car
 * being twitchy at speed, and they do their job — but they are a FICTION. A real
 * steering box gives its full lock at any road speed and a real driver's hands move
 * as fast as the situation needs. Left in place during a slide they act as a
 * stability program in reverse: the one moment the driver needs a lot of lock, fast,
 * is the moment they are allowed the least of it, and the slide is uncatchable for
 * reasons that exist nowhere in the car.
 *
 * So the limiter is faded out by the REAR axle's own slip angle. This adds no force
 * and no correction — it hands back lock and hand-speed the mechanism always had,
 * exactly while the tail is out, and takes them away again as the car straightens.
 */
const COUNTERSTEER_RELEASE_START_DEG = 7;
const COUNTERSTEER_RELEASE_FULL_DEG = 18;

/**
 * Mechanical handling families. The Soviet catalogue stays on `classic`, preserving
 * its slow recirculating-ball steering, cross-ply tyre response and live-axle balance.
 * The Stylized pack spans later radial-tyred road cars, purpose-built sports cars
 * and working 4x4/van/truck chassis; forcing all of them through that Soviet baseline
 * is why visually modern cars felt delayed, vague and tail-light.
 */
interface HandlingTuning {
  readonly steerInputExponent: number;
  readonly steerRatePark: number;
  readonly steerRateHighway: number;
  readonly steerHighSpeedFraction: number;
  readonly steerLockCurve: number;
  readonly steerPlay: number;
  readonly casterReturn: number;
  readonly bumpSteer: number;
  readonly drivelineLag: number;
  readonly lateralGripFraction: number;
  readonly lateralMu: number;
  readonly lateralGripMaxLoss: number;
  readonly rearSpeedLossGain: number;
  readonly rearAxleSideGrip: number;
  readonly slipPeakFrontDeg: number;
  readonly slipPeakRearDeg: number;
  readonly tyreRelaxationLength: number;
}

const HANDLING_PROFILES: Readonly<Record<HandlingProfile, HandlingTuning>> = {
  classic: {
    steerInputExponent: STEER_INPUT_EXPONENT,
    steerRatePark: STEER_RATE_PARK_RAD_S,
    steerRateHighway: STEER_RATE_HIGHWAY_RAD_S,
    steerHighSpeedFraction: STEER_HIGH_SPEED_FRACTION,
    steerLockCurve: STEER_LOCK_CURVE,
    steerPlay: STEER_PLAY_RAD,
    casterReturn: STEER_CASTER_RETURN_RAD_S,
    bumpSteer: BUMP_STEER_MAX_RAD,
    drivelineLag: DRIVELINE_LAG_S,
    lateralGripFraction: LATERAL_GRIP_FRACTION,
    lateralMu: LATERAL_MU,
    lateralGripMaxLoss: LATERAL_GRIP_MAX_LOSS,
    rearSpeedLossGain: REAR_SPEED_LOSS_GAIN,
    rearAxleSideGrip: REAR_AXLE_SIDE_GRIP,
    slipPeakFrontDeg: SLIP_PEAK_FRONT_DEG,
    slipPeakRearDeg: SLIP_PEAK_REAR_DEG,
    tyreRelaxationLength: 0.45,
  },
  road: {
    steerInputExponent: 1.5,
    steerRatePark: 2.5,
    steerRateHighway: 0.72,
    steerHighSpeedFraction: 0.48,
    steerLockCurve: 1.0,
    steerPlay: 0.006,
    casterReturn: 1.7,
    bumpSteer: 0.009,
    drivelineLag: 0.055,
    lateralGripFraction: 0.36,
    lateralMu: 1.84,
    lateralGripMaxLoss: 0.13,
    rearSpeedLossGain: 1.05,
    rearAxleSideGrip: 0.985,
    slipPeakFrontDeg: 5.9,
    slipPeakRearDeg: 5.5,
    tyreRelaxationLength: 0.28,
  },
  sport: {
    steerInputExponent: 1.45,
    steerRatePark: 3.1,
    steerRateHighway: 0.9,
    steerHighSpeedFraction: 0.52,
    steerLockCurve: 1.1,
    steerPlay: 0.003,
    casterReturn: 2.1,
    bumpSteer: 0.005,
    drivelineLag: 0.035,
    lateralGripFraction: 0.39,
    lateralMu: 2.0,
    lateralGripMaxLoss: 0.08,
    rearSpeedLossGain: 1.02,
    rearAxleSideGrip: 0.99,
    slipPeakFrontDeg: 5.25,
    slipPeakRearDeg: 5,
    tyreRelaxationLength: 0.2,
  },
  utility: {
    steerInputExponent: 1.5,
    steerRatePark: 2.2,
    steerRateHighway: 0.62,
    steerHighSpeedFraction: 0.46,
    steerLockCurve: 0.9,
    steerPlay: 0.012,
    casterReturn: 1.45,
    bumpSteer: 0.016,
    drivelineLag: 0.075,
    lateralGripFraction: 0.34,
    lateralMu: 1.64,
    lateralGripMaxLoss: 0.18,
    rearSpeedLossGain: 1.1,
    rearAxleSideGrip: 0.97,
    slipPeakFrontDeg: 7,
    slipPeakRearDeg: 6.5,
    tyreRelaxationLength: 0.38,
  },
};

// ---------------------------------------------------------------------------
// Braking. Rapier's setWheelBrake takes a *maximum braking impulse* (N·s), not
// a force: internally `rolling_friction` is clamped to that impulse. To brake
// the whole chassis at `a` m/s² across `n` wheels for one `dt` step, each wheel
// needs the impulse `a * mass * dt / n`.
// ---------------------------------------------------------------------------

/**
 * Foot-brake pedal ceiling (m/s²): the most the hydraulics can ask for at full
 * pedal, before the tyres get a say. It only binds where grip is plentiful — a
 * high-wheelGrip car on clean asphalt on the experimental2 compound reaches
 * 1.2 · 1.1 · 0.988 = 1.30 g of capacity — and is what stops that combination
 * out-braking a modern car outright.
 */
const FOOT_BRAKE_MAX_DECEL = 13.0;
/**
 * Fraction of the vehicle's MEASURED total longitudinal capacity that a floored
 * pedal asks for. The pedal negotiates with the tyres instead of shouting one
 * number at them.
 *
 * What this replaces: a flat 9.6 m/s² demand, identical on every surface, every
 * compound and every load. That one number could only be right for one case, and
 * the case it was tuned for was a standard-tyre car on asphalt. Everywhere else it
 * was wrong in a way the player felt as an absence of control:
 *
 *  - Gravel (capacity 0.51 g) and sand (0.36 g) were asked for 0.98 g, so the wheels
 *    locked on contact with the pedal. Braking off-road was lock or nothing, with no
 *    modulation in between.
 *  - Sport tyres were a cornering upgrade only: the pedal never asked for more than
 *    standard already delivered, so the extra 35% of longitudinal grip was unusable.
 *  - Load was ignored. A laden truck stopped no better than an empty one, and a wheel
 *    unloading over a crest was asked for exactly as much as one carrying the corner.
 *
 * Calibration is preserved rather than re-tuned: asphalt on standard tyres has a
 * capacity of 2.6 · 0.38 = 0.988 g, so 0.99 of it is 9.59 m/s² — the old constant to
 * within a rounding error. The established baseline stops the same.
 *
 * It is deliberately an AGGREGATE, summed over the vehicle, not a per-wheel
 * allocation. Per-wheel negotiation would be an anti-lock brake the era never had:
 * no wheel would ever be over-asked, so nothing would ever lock, and cadence braking
 * would stop being a mechanism. Sized against the total and then split on the fixed
 * FOOT_BRAKE_REAR_BIAS below, the light rear axle is still asked for more than its
 * own share of the grip, so the rears still fill their cone first and the tail still
 * comes round. That is the whole character of the brake, and it survives.
 */
const FOOT_BRAKE_GRIP_RATIO = 0.99;
/**
 * Rear bias for the foot brake (0..1).
 *
 * Discs at the front, drums at the back, and no proportioning valve to keep them
 * honest under load transfer.
 *
 * It was 0.62 — more torque to the axle that UNLOADS under braking — which made the
 * rears run out first and the car try to swap ends. That is a real period failure
 * mode, but it cost two things that turned out to matter more. Total braking was
 * capped by the grip of the LIGHT axle, so peak deceleration was poor and the front
 * never gained enough load to dive: the missing nose-down attitude under brakes was a
 * brake-bias symptom all along, not a spring one. And braking mid-slide — the
 * instinctive reaction — pushed the rear further past its cone and turned a
 * recoverable slide into a spin.
 *
 * 0.42 is period-correct front bias, and note the reason is LOAD TRANSFER, not static
 * distribution: this chassis is very nearly 50/50 (see COM_REARWARD_FRACTION), but
 * braking at 0.8 g moves about 17% of the car's weight forward regardless, so the
 * front runs at ~65% of the load while being asked for 58% of the torque. The front
 * gains grip exactly when it is asked to do more work, so deceleration rises and the
 * nose dives properly. The rears still lock first — 42% of the torque on an axle
 * carrying a third of the weight is still more than its share — just no longer a
 * foregone conclusion.
 */
const FOOT_BRAKE_REAR_BIAS = 0.42;
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
/**
 * Lateral grip retained by a fully sliding wheel.
 *
 * This number IS catchability. A sliding tyre that keeps most of its side force is a
 * car that has stepped out but is still listening: the slide develops, the driver has
 * something to steer against, and lifting or unwinding puts it back. Set it low and a
 * slide is an announcement that the corner is already lost.
 *
 * Raised from 0.45, alongside giving the rear a plateau it can hold (see the slip
 * angle block above). The two compound: a rear wheel that was both past peak AND
 * saturating its cone used to keep 0.45 x 0.62 = 0.28 of its side grip, which is a car
 * with no back axle at all. It now keeps 0.60 x 0.80 = 0.48, so a countersteer bites
 * on a wheel that is genuinely sliding rather than merely on one that is about to.
 */
const SLIDE_SIDE_GRIP = 0.6;
/**
 * Slide smoothing, seconds — deliberately asymmetric.
 *
 * Grip is slow to leave and quick to return. That asymmetry is what makes a car
 * fightable rather than merely loose: the onset is gradual enough to read and react
 * to, and the recovery is prompt enough that the correction you make is rewarded on
 * the same corner rather than two beats later. Symmetric smoothing gives you either
 * a snap you cannot see coming (short) or a slide that keeps sliding after you have
 * already fixed it (long).
 */
const SLIDE_ONSET_TAU = 0.09;
const SLIDE_RECOVER_TAU = 0.04;
/**
 * Locking the wheels, and spinning them up: measured, not scripted.
 *
 * The friction circle above is the PROGRESSIVE half — a tyre gradually running out
 * of grip. This is the discrete half, and it now falls out of the wheel's own
 * rotation (`updateWheelDynamics`). Each wheel is a flywheel with real inertia:
 * drive torque spins it up, brake torque slows it, and the contact patch drags it
 * back toward free rolling with at most `frictionSlip · load · radius` of torque.
 * Demand more brake than that and the wheel genuinely stops turning; demand more
 * drive and it genuinely runs away from road speed.
 *
 * What this replaces is worth recording. The lock used to be a 1.2 s pedal timer,
 * because the earlier attempt at measuring it never fired: it watched Rapier's
 * `wheelRotation`, which is kinematic — the cone scales an over-braked wheel's
 * force down instead of stalling it, so the wheel never stopped and the renderer
 * had to freeze the drawn spin by hand. Both hacks are gone: the spin drawn is the
 * spin simulated, and a locked wheel is locked because its own rotation says so.
 *
 * The consequences follow from the physics rather than being written in: a locked
 * front axle carries no side force, so the car ploughs straight; a locked rear
 * carries none either, so the tail comes round. Easing the pedal lets the contact
 * spin the wheel back up, which is cadence braking as a mechanism.
 */
/** Wheel mass (kg) at the reference radius. Inertia is a disc's, 0.5·m·r². */
const WHEEL_MASS_KG = 20;
/** Radius (m) the wheel mass is quoted at; mass scales with radius². */
const WHEEL_REFERENCE_RADIUS = 0.35;
/**
 * Fraction of a surface's `frictionSlip` that acts as its longitudinal μ. Those
 * surface numbers are Bullet cone budgets (asphalt 2.6), not friction
 * coefficients; 0.38 lands asphalt at ~1.0, i.e. a tyre that can just about
 * transmit its own share of the car's weight.
 */
const LONGITUDINAL_GRIP_FRACTION = 0.38;
/** Contact-speed floor (m/s) for the slip-ratio denominator, to keep it finite. */
const SLIP_REFERENCE_MPS = 1.5;
/** Slip ratio at or below which a wheel counts as locked and sliding. */
const LOCK_SLIP_RATIO = -0.5;
/**
 * Load low-pass, seconds: the ray-cast suspension force is spiky over collider seams,
 * and a spike is not a load.
 *
 * Halved to 0.02 — about one and a half fixed steps, so a single-step seam artefact is
 * still swallowed while a real bump is not. What it was smoothing away is the point of
 * a rough road: capacity is proportional to load, so a wheel going light over a crest
 * SHOULD lose its grip and hand the driver a moment to catch, and at 0.04 s that
 * moment was averaged into the two steps either side of it. Reported from play as
 * uneven surfaces having stopped providing any thrill at speed.
 */
const WHEEL_LOAD_TAU = 0.025;
/**
 * Slip ratio at which a tyre makes its peak longitudinal force.
 *
 * The curve is F = μN · 2u/(1+u²) with u = slip/PEAK: linear off zero, peaking at
 * exactly u = 1, then decaying like 1/u. That decay IS sliding friction, so a
 * locked wheel now stops the car less well than one held at optimal slip because
 * of the curve's shape rather than because a constant said so. The old model could
 * not express it — Rapier's cone clipped force without ever letting a tyre slide,
 * so locking had to be given a deliberately weaker deceleration demand
 * (LOCKED_DECEL 5.6 against the pedal's 7.0) to stop it being a free upgrade.
 *
 * 0.12 is a period cross-ply on asphalt; a radial peaks earlier and sharper.
 */
const PEAK_SLIP_RATIO = 0.12;
/**
 * Force a fully sliding tyre keeps, as a fraction of its peak. This is why ABS
 * exists: locking costs about a quarter of the grip, and it is now that ratio
 * doing the work rather than a separate locked-deceleration constant.
 */
const SLIDING_GRIP_FRACTION = 0.75;
/** How quickly the sliding plateau is reached, in units of PEAK_SLIP_RATIO. */
const SLIDE_CURVE_GAIN = 1.5;
/** Lateral grip left on a locked, sliding tyre. */
const LOCKED_SIDE_GRIP = 0.22;

/**
 * Relaxation length: how far the tyre must ROLL before its carcass has built the
 * side force a new slip angle asks for, metres.
 *
 * Without it the side-force curve is read at the geometric slip angle, which changes
 * the instant the wheel is turned — so grip appeared and vanished on the frame the
 * input did, and small corrections felt like a switch rather than a load coming on.
 * A bias-ply carcass is slow: 0.45 m is roughly one wheel revolution, so at 25 m/s
 * the lag is ~18 ms (about one step) and in a car-park manoeuvre it is most of a
 * second. Distance-based, not time-based, which is the point — a stationary wheel
 * builds nothing however long it is held over.
 */
const TYRE_RELAXATION_LENGTH_M = 0.45;
/**
 * Load sensitivity of μ: how much grip a tyre LOSES per unit of extra load.
 *
 * A tyre's coefficient falls as it is pressed harder, which is the mechanism behind
 * every weight-transfer effect worth having. Without it capacity was exactly linear
 * in load, so transferring load between two wheels moved grip around without ever
 * costing any: the balance of the car could only be authored (see
 * REAR_AXLE_SIDE_GRIP) and never emerged from what the car was doing.
 *
 * μ scales as 1 - k·(Fz/Fz_static - 1), so it is EXACTLY 1 at the static load and
 * the calibrated straight-line figures are untouched. 0.18 is a mild period value:
 * an outer tyre carrying 1.6x its static load keeps 89% of its μ, so a hard corner
 * loses a few per cent of total grip and the loaded end gives up first.
 */
const LOAD_SENSITIVITY = 0.24;
/** Floor on the load-sensitivity factor, so an airborne-then-slammed wheel stays sane. */
const LOAD_SENSITIVITY_MIN = 0.5;
const LOAD_SENSITIVITY_MAX = 1.35;

/**
 * Traction control: the driver aid that used to masquerade as a tyre compound.
 *
 * `sport` was never a compound. Its only felt benefit was unsticking a car bogged in
 * sand or gravel, which is not what rubber does — it is what slip control does, and
 * it was doing it by silently handing out 35% more cornering grip as well. So the
 * mechanism is now what it always was: when a driven wheel spins up past the slip
 * where the tyre makes its peak force, the torque going to it is cut back until it
 * is near that peak again. Nothing is added; a wheel is stopped from wasting what it
 * already has on the sliding side of the curve.
 *
 * It is always armed and entirely automatic, because that is what it is for: no
 * player would ever choose to be past the peak. The dashboard lamp is the honest
 * part — it lights only while torque is actually being cut, so the player learns
 * where the surface runs out rather than being told about it.
 *
 * The threshold is a slip SPEED, not a slip ratio, and that distinction is the
 * whole difference between an aid and a trap.
 *
 * A slip ratio is (ωr − v)/max(|v|, SLIP_REFERENCE_MPS), and that denominator is
 * floored at 1.5 m/s so it stays finite at rest. At a standstill, then, a wheel
 * creeping round at 0.5 m/s of surface speed already reads a ratio of 0.33 — nearly
 * three times PEAK_SLIP_RATIO — so a ratio-based TCS pins itself at full cut the
 * instant you touch the throttle from rest. That is not a hypothetical: it is why a
 * coupe nosed into a pole on a slight grade could not reverse out with the lamp lit.
 * A standing start legitimately runs a slip ratio around 3; that is how a tyre makes
 * force at all.
 *
 * So the wheel is judged on how much faster its contact patch is moving than the
 * road, in m/s: TCS_SLIP_FLOOR_MPS is tolerated regardless of road speed, and above
 * a walking pace the allowance grows with speed until it is the same peak-slip ratio
 * the tyre model uses. Authority follows the VEHICLE'S forward speed, not one contact
 * point's instantaneous velocity: at a steep pothole face chassis pitch can make that
 * point nearly stationary even while the car is moving and the wheel is spinning.
 * Below TCS_AUTHORITY_START_MPS the driver keeps full authority for digging, rocking
 * and reversing out.
 *
 * EXCEPT WHEN THE WHEEL IS PLAINLY JUST POLISHING. Road speed alone was the whole
 * authority test, and it disabled the system exactly where it was invented for:
 * nose up a steep grade, the car crawls below walking pace, the driven wheels spin
 * freely, and TCS sat switched off watching them. Reported from play, and it is the
 * same failure the `sport` compound used to paper over — "unsticking a car bogged in
 * sand" is this case.
 *
 * A second authority path therefore opens on SLIP SPEED alone. Digging and rocking
 * run a couple of m/s of slip; a wheel turning TCS_STUCK_SLIP_MPS faster than the
 * ground it is standing on is not being driven, it is being wasted. Sign is still
 * taken from the commanded torque, so a locked wheel under braking and a car
 * deliberately reversing out are both untouched.
 */
const TCS_SLIP_FLOOR_MPS = 2.2;
/** Slip speed (m/s) past the threshold over which the cut ramps from none to full. */
const TCS_SLIP_BAND_MPS = 1.8;
/** Road speed (m/s) below which TCS may not cut at all, and above which it may cut fully. */
const TCS_AUTHORITY_START_MPS = 1.0;
const TCS_AUTHORITY_FULL_MPS = 3.5;
/**
 * Slip speed (m/s) at which TCS takes authority whatever the road speed, and the band
 * over which that authority arrives. Above the floor a wheel is spinning several
 * times faster than a rocking or digging one ever does.
 */
const TCS_STUCK_SLIP_MPS = 5.5;
const TCS_STUCK_BAND_MPS = 3;
/**
 * Share of a wheel's STATIC load at which traction control has its full authority; it
 * scales down linearly below that and reaches nothing at zero load.
 *
 * A tyre makes force in proportion to what is pressing it into the ground. Over a
 * crest, on a pothole rim or on the light side of a bump, the load goes and the spin
 * that follows is the driveline turning a free wheel — not a tyre losing its grip.
 * Rapier still reports the wheel as "in contact" throughout, because its ray still
 * reaches the ground, so contact alone cannot tell the two apart. Load can.
 *
 * Half, rather than a token fraction, because a wheel down to half its static load has
 * already lost half its grip and the aid should be backing off by then. Measured on the
 * real road collider (tools/surface-feel.ts), driven wheels sat under a third of static
 * load for half of a standing start, which is why the lamp was lit for two thirds of it
 * on a dry asphalt road.
 */
const TCS_LOAD_AUTHORITY_FRACTION = 0.5;
/** Most of a wheel's drive torque TCS may take away. Never all of it: a bogged car still digs. */
const TCS_MAX_CUT = 0.85;
/** Cut smoothing, seconds: quick to intervene, slower to hand the torque back. */
const TCS_ATTACK_TAU = 0.03;
const TCS_RELEASE_TAU = 0.12;
/**
 * Cut fraction above which the dashboard lamp counts the system as working.
 *
 * A twentieth of the torque is not an intervention, it is the aid breathing. Paired
 * with TCS_LAMP_HOLD_S it was also an amplifier: every isolated single-step trim lit
 * the lamp for 21 frames, so a duty cycle of one cut in six read on the dashboard as a
 * lamp that never goes out. Measured on the real road collider (tools/surface-feel.ts),
 * 17% of driven-wheel steps carrying a cut showed as a lamp lit for 55% of the run.
 *
 * A fifth of the torque is a cut the driver can feel through the seat, which is the
 * only thing the lamp is for: it should teach where the grip ran out, not report that
 * the system is fitted.
 */
const TCS_LAMP_THRESHOLD = 0.2;
/**
 * Minimum time (s) the lamp stays lit once lit. A single-step intervention is real
 * but invisible at 60 Hz; a lamp that flickers for one frame teaches nothing.
 */
const TCS_LAMP_HOLD_S = 0.35;
/* ---------------------------------------------------------------------------
 * THE TYRE AS A SPRING, and why road feel used to disappear whenever the
 * suspension was softened.
 *
 * The collider cannot carry the ground the driver actually feels. Its rows are
 * 1.33 m apart on the road and 2.67 m in the desert, so everything below about
 * three metres of wavelength — the entire band a tyre transmits as texture — is
 * missing from it and has to be added as a profile the wheel is told about
 * (`SurfaceProps.microRelief`, `MicroRelief` and `RoadTexture` in core/surfaces.ts).
 *
 * The mistake was in how that profile reached the body. It was pushed straight into
 * the chassis as `mass * (k * h + c * hdot)` using the BODY spring's own rate, which
 * makes road feel a function of spring stiffness: soften the springs and the road
 * goes quiet, which is exactly backwards. A real car does not work that way. Short
 * bumps reach the body through the TYRE, whose vertical rate is 150-220 kN/m — an
 * order of magnitude above any body spring — filtered by the unsprung mass hanging
 * on it. That pair is the wheel-hop mode at 10-14 Hz, and it is the reason a
 * soft-sprung 1970s saloon still tells you what the surface is doing.
 *
 * So each wheel now carries the standard quarter-car unsprung state: the tyre spring
 * to the ground profile, the wheel's own mass, and the suspension between it and the
 * body. The force handed to the chassis is the suspension force that moving wheel
 * makes, which:
 *
 *   - survives soft springs, because the wheel is driven by the TYRE rate;
 *   - rolls off above the hop frequency instead of growing without limit with speed,
 *     which is what the old 0.9-of-static force cap was standing in for;
 *   - lets the tyre leave the ground, because a tyre cannot pull the road upwards:
 *     the carcass force is clamped at the wheel's own load and no further.
 *
 * The one thing kept from the old model is envelopment: a contact patch is a couple
 * of hundred millimetres long, so a ridge shorter than the patch is partly swallowed
 * rather than transmitted. That is a low-pass on the PROFILE (over distance, not
 * time), so it does not depend on speed.
 * ------------------------------------------------------------------------- */

/**
 * Tyre vertical rate (N/m) at the reference radius, and how it scales.
 *
 * A period 165-section bias-ply tyre at its working pressure is about 160 kN/m; a
 * truck's taller, stiffer carcass is more. Rate rises roughly with the square of the
 * radius for a given construction, which also puts the hop frequency of a big wheel
 * near a small one's once its extra mass is counted.
 */
const TYRE_RATE_REFERENCE = 165_000;
const TYRE_RATE_REFERENCE_RADIUS = 0.35;
/** Damping in the carcass itself, as a fraction of critical against the hop mode. */
const TYRE_DAMPING_RATIO = 0.05;
/**
 * Unsprung mass per corner (kg) at the reference radius: wheel, tyre, hub, brake and
 * the axle's share. Scales with the wheel's mass, i.e. with radius squared.
 */
const UNSPRUNG_MASS_KG = 38;
/**
 * Contact-patch length (m) the profile is enveloped over. The tyre cannot see detail
 * shorter than the patch it stands on, so the profile is low-passed over this
 * DISTANCE — a filter in metres travelled, which is why crossing a ripple at 100 km/h
 * is no sharper than at 40.
 */
const CONTACT_PATCH_M = 0.16;

/** This wheel's tyre rate (N/m). */
function tyreVerticalRate(radius: number): number {
  const scale = radius / TYRE_RATE_REFERENCE_RADIUS;
  return TYRE_RATE_REFERENCE * scale * scale;
}

/** This wheel's unsprung mass (kg). */
function unsprungMass(radius: number): number {
  const scale = radius / TYRE_RATE_REFERENCE_RADIUS;
  return UNSPRUNG_MASS_KG * scale * scale;
}

/**
 * Progressive bump stop, in place of Rapier's rigid travel clamp.
 *
 * Rapier clamps the spring at `rest +/- maxTravel`, and a clamp is a collision: the
 * wheel simply stops moving relative to the body and the whole impact goes through as
 * a step. Real suspension has a rubber stop that starts taking load some way before
 * the end of the travel and stiffens as it crushes, which is what turns bottoming out
 * into a firm thump instead of a hammer blow — and it is what makes a genuinely soft
 * spring usable over a big hit.
 *
 * The stop engages over the last BUMP_STOP_FRACTION of the available bump travel and
 * its force rises with the square of how far into it the wheel is, reaching
 * BUMP_STOP_PEAK times the corner's static load when fully crushed.
 */
const BUMP_STOP_FRACTION = 0.4;
const BUMP_STOP_PEAK = 6;
/**
 * Ride height, as a length the catalogue states.
 *
 * Two rules, and a body ends up at whichever leaves it LOWER:
 *
 *  - the preset's own `rideHeight`: clear air under the body box, in metres.
 *  - the artist's own STANCE, never lifted by more than RIDE_LIFT_MAX. Without that
 *    cap, a pack whose body box runs down to a low skirt or a modelled underbody gets
 *    put on stilts.
 *
 * What this replaced was a rule written in terms of the spring: the mount came from
 * `restLength - staticSag`, so every change of rate moved the car up or down and a
 * soft spring stood the body high. Ride height is now independent of the springs by
 * construction — `rebuild` places each axle's mount so a settled wheel centre lands
 * exactly one radius above the chosen contact plane, whatever that axle's sag is.
 *
 * Only Y comes from this; track and wheelbase always come from the model.
 */
const RIDE_LIFT_MAX = 0.15;
/** No body sits closer to the road than this, however low its box is drawn. */
const RIDE_MIN_CLEARANCE = 0.075;
/** Requested body lift, expressed as a fraction of the fitted tyre radius. This changes
 * only the chosen static clearance; spring, damper, travel, tyre and wheel geometry stay
 * untouched. */
const CLEARANCE_WHEEL_RADIUS_FRACTION = 1 / 6;
/**
 * How far above a settled wheel's centre its suspension mount is placed, metres.
 *
 * Pure bookkeeping: `restLength = sag + this`, so the spring is `this` short of free
 * length when parked and the ray still starts above the wheel centre. It cannot
 * change how the car rides — sag is set by the frequency and the mount is then placed
 * to put the wheel on the ground — and it cannot change the available droop, which
 * for a linear spring is exactly the sag.
 */
const MOUNT_ABOVE_WHEEL_CENTRE = 0.12;
/**
 * Rapier's per-wheel suspension force ceiling, as a multiple of that corner's static
 * load. It exists so a catastrophic landing cannot launch the car; the bump stop above
 * is what shapes ordinary bottoming, and it peaks well below this.
 */
const SUSPENSION_FORCE_HEADROOM = 9;
/**
 * Static holding deceleration for a parked car, m/s². Applied across all four
 * wheels so a braked car remains at rest on any drivable road grade.
 */
const PARK_BRAKE_DECEL = 12.0;
/** Below this ground speed a braked car becomes a physically fixed parked car. */
const PARK_HOLD_SPEED_MPS = 0.12;
/**
 * Being shouldered by the player, in four numbers.
 *
 * The target is a car that feels like a car: it moves, and it is obviously not worth
 * moving far. `SHOVE_SPEED_CAP` is a slow walk, and `SHOVE_RAMP_SECONDS` is how long
 * leaning on it takes to get there — a second and a half, so the first moment of contact
 * does nothing perceptible and the motion builds. Together they cap the acceleration at
 * `0.4 / 1.5 = 0.27 m/s2`, which against a 1200 kg saloon is 320 N of shove: a person
 * pushing hard, and 45 times less than the parking brake it has to work against, which is
 * why `SHOVE_BRAKE_FRACTION` exists.
 *
 * `SHOVE_RELEASE_SECONDS` is how long a car stays shovable after the last push. It has to
 * outlast one fixed step so the hold does not re-latch between contacts, and has to be
 * short enough that letting go stops the car: at a fifth of a second the weakened brake
 * has the car down from 0.4 m/s in about the same time the hold takes to come back.
 */
const SHOVE_SPEED_CAP = 0.4;
const SHOVE_RAMP_SECONDS = 1.5;
const SHOVE_RELEASE_SECONDS = 0.2;
/**
 * Fraction of the parking brake left on while a car is being shoved. Not zero: with the
 * brake off entirely a shoved car on any grade rolls away, which is a different game.
 *
 * The first pass set this to a quarter, on the theory that 12 × 0.25 = 3 m/s² was "weak
 * enough to lose to the shove". It is weaker than the full brake, but the shove it has to
 * lose to is only 0.4 / 1.5 = 0.27 m/s² (320 N on a 1200 kg saloon), so 3 m/s² was eleven
 * times the shove and cancelled it inside a single step: the car never moved. A shove can
 * only win if the weakened brake is WEAKER than the shove itself, so this is sized just
 * under half of it: 12 × 0.01 = 0.12 m/s² of holding, leaving ~0.15 m/s² of net creep.
 * The hold (a teleport) re-latches 0.2 s after the shoulder comes off and stops the car
 * properly, so this brake only has to keep it from rolling away on a gentle grade until
 * then.
 */
const SHOVE_BRAKE_FRACTION = 0.01;
/** Residual motion treated as stopped before an automatic changes drive direction. */
const AUTO_DIRECTION_RELEASE_MPS = 0.08;
/** Hard road-speed ceiling for a catastrophically damaged but still running engine. */
const DESTROYED_ENGINE_SPEED_CAP_MPS = 20 / 3.6;

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
 * Fraction of the physical roll couple to restore. ONE, now that there is something
 * for it to work against.
 *
 * It was 0.78 with a note about the couple being a rollover switch, and that was true
 * of a car whose only roll resistance was four soft springs: at 0.6 g the outer spring
 * needed 108 mm of extra compression against 100 mm of bump travel, so the body rolled
 * until it hit the stops and then stopped rolling — measured 2.1 degrees where a
 * period saloon leans five or six, with the last of it arriving as a rigid clunk.
 * ANTI_ROLL_* below adds the bar a real car of the era has, which carries the roll off
 * the stops; with that in place the full moment is what the car should get.
 */
const ROLL_COUPLE_GAIN = 1;
/**
 * ANTI-ROLL BARS, as a fraction of that axle's own wheel rate.
 *
 * A bar ties the two wheels of an axle so that only their DIFFERENCE in travel loads
 * it: it does nothing in heave, everything in roll. That is the one component that
 * lets a car ride softly and still corner without lying on its outer springs, and it
 * is why no real car's roll stiffness is just its ride springs — a 1970s saloon runs a
 * front bar worth 30-60% of the front's own rate, and often a smaller one behind.
 *
 * The split front-to-rear is also the classic balance lever, and it is set here the
 * way a period front-engined car is set: stiffer at the front, so the front axle takes
 * the larger share of the load transfer, loses its outer tyre first and the car runs
 * out of grip at the nose rather than the tail. Everything else in this file that
 * makes the tail let go — the live axle's lower side grip, the earlier rear slip peak,
 * the speed-biased rear loss — is then the interesting exception it should be, not the
 * default.
 */
const ANTI_ROLL_FRONT_FRACTION = 0.55;
const ANTI_ROLL_REAR_FRACTION = 0.3;
/**
 * Low-pass time constant for the lateral-acceleration estimate, seconds. The shorter
 * window lets a bump or quick steering correction move the body before the next bend.
 */
const ROLL_ACCEL_TAU = 0.045;
/** Ceiling on the restored couple, in g of lateral acceleration. */
const ROLL_ACCEL_MAX = 12;
/** Lean angle, degrees, at which the couple has faded to nothing. */
const ROLL_LIMIT_DEG = 17;
/**
 * Roll-rate damping, as a fraction of roll inertia per second. This is intentionally
 * below the previous road-car value: the worn damper should take a set, then sway once
 * or twice over a disturbance instead of pinning the body flat.
 */
const ROLL_RATE_DAMPING = 1.45;

/**
 * Where the axles are and how the weight is split between them. Measured once from
 * the model; everything load-bearing about balance is derived from it — the centre of
 * mass, each corner's static load, and therefore each spring's rate.
 */
interface AxleGeometry {
  /** Mean mount Z of the front and rear wheel groups, chassis-local metres. */
  readonly frontZ: number;
  readonly rearZ: number;
  readonly frontCount: number;
  readonly rearCount: number;
  /** Fraction of the parked car's weight on the front axle. */
  readonly frontWeightShare: number;
}

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

/**
 * Cosmetic shell wear is emitted with the other slow-moving vehicle values; half a
 * second keeps the state stream coarse while still making a wash visible promptly.
 */
const BODY_CONDITION_EMIT_INTERVAL = 0.5;
/**
 * Four rolling tyres cover 100 km of tyre-track over 25 km of road, so sand
 * (`dust = 1`) reaches full dirt after roughly 25 km. The first visible layer
 * arrives within a couple of off-road kilometres, while a 2x slip/slide multiplier
 * still makes a digging wheel throw more material.
 */
const BODY_DIRT_TYRE_METRES_TO_FULL = 100_000;
/** A kerb nudge is under this unexplained loss; shell scratches start above it. */
const SCRATCH_IMPACT_THRESHOLD_MPS = 2.5;
/** Each m/s above the scratch threshold adds this much shell damage. */
const SCRATCH_PER_SEVERITY_MPS = 0.025;
/** One collision cannot add more than this much cosmetic damage. */
const SCRATCH_PER_IMPACT_CAP = 0.12;
/**
 * Suspension and solver noise are below 0.35 m/s once the tyres' force ceiling is
 * removed; keeping that margin stops ordinary road seams becoming collision signals.
 */
const IMPACT_UNEXPLAINED_FLOOR_MPS = 0.35;

const TWO_PI = Math.PI * 2;

/**
 * Authored steering-wheel travel: 970 degrees lock-to-lock, or 485 degrees from
 * centre to either stop. Normalising by each model's tyre lock keeps the rim travel
 * identical across the catalogue despite their different steering geometries.
 */
const STEERING_WHEEL_HALF_LOCK_RAD = (485 * Math.PI) / 180;

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
  /** Sign of the wheel's chassis-local lateral position; left=-1, right=+1. */
  sideSign: number;
  radius: number;
  /** Geometry this wheel was built with, metres (see `rebuild`). */
  restLengthM: number;
  maxTravelM: number;
  /** Static spring compression this corner settles at, metres. */
  sagM: number;
  /** What this corner carries when the car is parked and level, newtons. */
  staticLoadN: number;
  /** Per-kilogram spring rate and damping coefficients handed to Rapier. */
  springRate: number;
  compressionRate: number;
  relaxationRate: number;
  /** Progressive bump-stop force applied this step, newtons. */
  bumpStopN: number;
  /** This tyre's vertical carcass rate, N/m. Nothing to do with the springs. */
  tyreRateN: number;
  /**
   * Enveloped sub-collider ground height under this wheel (m) and its rate (m/s).
   * "Enveloped" because a tyre cannot see detail shorter than the patch it stands on:
   * the profile is low-passed over CONTACT_PATCH_M of TRAVEL before it gets here, so
   * the filter is in metres and does not soften with speed.
   */
  profileHeight: number;
  profileRate: number;
  /** Wheel-hop state: unsprung deflection (m) and its rate (m/s). See the tyre block. */
  hopZ: number;
  hopV: number;
  mesh: THREE.Object3D;
  /** Reused per-frame buffer for wheelChassisConnectionPointCs. */
  scratchCp: { x: number; y: number; z: number };
  /** Friction-slip budget set for this wheel this step, i.e. its cone size. */
  frictionSlip: number;
  /** Registered surface under this wheel this step; read by the spray. */
  groundSurface: SurfaceType;
  /** Did this wheel find a collider this step? Read by the spray. */
  grounded: boolean;
  /** Smoothed slide amount, 0 = inside the friction cone, 1 = fully saturated. */
  slideT: number;
  /** Smoothed TCS torque cut on this wheel, 0 = none, 1 = all of it. */
  tcsCut: number;
  /** Locked and sliding: emergent from the wheel's rotation, or the handbrake on a rear. */
  locked: boolean;
  /** Physical wheel speed (rad/s), integrated by updateWheelDynamics. */
  spinRadS: number;
  /** Accumulated spin (radians) for rendering. A stalled wheel stops accumulating. */
  drawnSpin: number;
  /** Longitudinal slip ratio, (ωr - v)/max(|v|, ref). Negative under lock-up. */
  slipRatio: number;
  /** Low-passed normal load (N) reported by the suspension. */
  loadN: number;
  /** Spring compression from rest this step, metres; negative in droop. */
  compressionM: number;
  /**
   * Slip angle the CARCASS has actually built, radians, lagged behind the geometric
   * one by the relaxation length. This is the angle the side-force curve is read at.
   */
  slipAngleRad: number;
  /**
   * Share of this tyre's longitudinal capacity the last step spent, 0..1. Feeds the
   * friction ellipse that decides what is left for cornering.
   */
  gripUsage: number;
  /**
   * Lateral force capacity (N) and the fraction of it this tyre's built slip angle
   * asks for, plus the wheel-plane right vector and the contact's sideways speed.
   * Resolved in the setup pass and consumed by the tyre pass, so neither recomputes
   * the other's geometry.
   */
  lateralCapacityN: number;
  lateralShape: number;
  lateralRightX: number;
  lateralRightY: number;
  lateralRightZ: number;
  lateralSpeed: number;
  /** Drive torque (N·m) commanded to this wheel this step. */
  driveTorqueNm: number;
  /** Brake force (N) commanded to this wheel this step. */
  brakeForceN: number;
  /** Wheel forward tangent in world space; projected onto steep contact surfaces. */
  forwardDir: { x: number; y: number; z: number };
  /** Contact point, normal and chassis-frame velocity; all reused every step. */
  contactPoint: { x: number; y: number; z: number };
  contactNormal: { x: number; y: number; z: number };
  contactVel: { x: number; y: number; z: number };
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
  engineDestroyed: boolean;
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
 * A collision the chassis velocity change cannot be explained by its own tyres and
 * drag. Direction points from the object into the chassis, in chassis-local space.
 */
export interface VehicleImpact {
  /** Speed the chassis lost this step that its own tyre and drag forces cannot explain, m/s. */
  readonly severityMps: number;
  /** Unit direction the blow came FROM, in chassis-local space (+Z forward, +X right, +Y up). */
  readonly localX: number;
  readonly localY: number;
  readonly localZ: number;
}

/**
 * Per-wheel telemetry consumed by the pooled ground effects: where the tyre is, which
 * way it points, the ground plane, and how hard it is disturbing that ground. Written
 * in place once per fixed step; nothing here is allocated per tick.
 */
export interface WheelSprayState {
  /**
   * Contact patch position RELATIVE to the floating origin, metres — the same frame
   * Rapier and the scene graph use, so `emitSpray` can drop it straight into the
   * particle buffer. Consumers that sample the world (road projection, terrain
   * surface) must use `absoluteContactX/Z` instead: sampling a noise field at a
   * rebased coordinate silently changes the ground's shape.
   */
  contactX: number;
  contactY: number;
  contactZ: number;
  /** Contact patch position in ABSOLUTE world coordinates (X and Z; Y never shifts). */
  absoluteContactX: number;
  absoluteContactZ: number;
  /** Wheel-plane forward direction in world space (x, z), unit length. */
  forwardX: number;
  forwardZ: number;
  /** Terrain contact normal in world axes, unit length. */
  normalX: number;
  normalY: number;
  normalZ: number;
  /**
   * Is this wheel touching anything? A wheel in the air reports whatever slip its
   * free spin produces, and `surface` falls back to asphalt when there is no
   * collider — which is a SMOKING surface, so without this a launched car would
   * trail smoke through the air.
   */
  inContact: boolean;
  /**
   * Registered surface of the collider under this wheel. The spray reads it to
   * decide between thrown grit and tyre smoke; see `emitSpray` in main.ts, which
   * refines it against the terrain's own surface field off the road.
   */
  surface: SurfaceType;
  /** Longitudinal slip ratio this tick. */
  slipRatio: number;
  /** Friction-circle saturation, 0..1. */
  slideT: number;
  /** Chassis forward speed, m/s (signed). */
  forwardSpeed: number;
}

/**
 * Per-wheel RIDE state, as opposed to the spray's per-wheel contact state.
 *
 * This is the only window onto the suspension anything outside this file has, and it
 * exists because the three things that decide whether a car rides like a car —
 * where its weight sits, how far the springs are compressed, and how much of the
 * travel is left — are otherwise invisible: Rapier keeps them inside the controller
 * and the game only ever sees the chassis pose that results.
 *
 * Written in place once per fixed step; nothing here allocates.
 */
export interface WheelRideState {
  readonly isFront: boolean;
  /** left = -1, right = +1. */
  readonly sideSign: number;
  inContact: boolean;
  /** Low-passed normal load (N) this wheel is carrying. */
  loadN: number;
  /** What it carries PARKED (N), from the axle geometry and the weight distribution. */
  staticLoadN: number;
  /** Spring compression from rest, metres. Negative while the wheel hangs in droop. */
  compressionM: number;
  /** Compression still available before the bump stop is fully shut, metres. */
  reserveM: number;
  /** Force the bump stop is contributing (N), 0 until the spring runs out of travel. */
  bumpStopN: number;
  /** Tyre carcass deflection from the sub-collider profile, metres (see WheelHop). */
  tyreDeflectionM: number;
}

/**
 * Anti-squat and anti-dive: the fraction of the longitudinal pitch couple that real
 * suspension GEOMETRY carries through the links instead of through the springs.
 *
 * Rapier's ray-cast suspension has no geometry at all — no wishbones, no instant
 * centre, no trailing-arm angle — so 100% of the couple goes into the springs and the
 * nose rises under power like a speedboat. `INERTIA_PITCH_YAW_GAIN` was already raised
 * to 2.55 in an earlier pass for exactly this complaint, but pitch inertia only makes
 * the lift SLOWER: the body still travels the whole way, just less abruptly. The cause
 * is a missing reaction path, not too little inertia.
 *
 * This is the same class of fix as `applyRollCouple`, and the mirror image of it.
 * There, Bullet threw a moment away and it had to be put back; here the engine applies
 * a moment in full that a real car resists mechanically, so a fraction is taken out.
 *
 * Real geometry runs 20-50% anti-squat and 20-40% anti-dive, and the two differ
 * because the ends of the car are built differently — a live rear axle on trailing
 * leaves has far more anti-squat available than a MacPherson front has anti-dive. The
 * pair below sit inside those bands, deliberately at the low end: this removes the
 * exaggeration, it does not iron the car flat. Squat and dive are how a driver reads
 * weight transfer, and a car with no pitch at all feels like it is on rails.
 */
const ANTI_SQUAT_FRACTION = 0.38;
const ANTI_DIVE_FRACTION = 0.26;

/**
 * Height of the centre of mass, as a fraction of the measured chassis box below its
 * centre: dropped well below the box centre, which is what keeps a tall van from
 * tipping. Measured per model rather than authored, so a firetruck and a kart both
 * get a sane one.
 *
 * There is no rearward fraction any more. Where the mass sits ALONG the car is the
 * weight distribution (`frontWeightFraction` in carmodels.ts) resolved against the
 * model's own axle positions, because "2% of the half-length behind the box centre"
 * is not a measurable property of anything: it made every vehicle in the catalogue a
 * 50/50 car, front-drive hatchbacks included, and left the tyre model referencing a
 * static load no wheel was actually carrying.
 */
const COM_DROP_FRACTION = 0.45;

/** Headlight placement as fractions of the chassis box (x of half-width, y of height). */
const HEADLIGHT_X_FRACTION = 0.62;
const HEADLIGHT_Y_FRACTION = 0.28;
/** Minimum real height of a lamp above the settled tyre contact plane. */
const HEADLIGHT_MIN_HEIGHT = 0.65;

/**
 * Beam geometry per mode.
 *
 * A single inverse-power cone must cover both the bumper and the useful road
 * distance. Even a 0.7 decay still made the foreground about five times brighter
 * than terrain at 100 m. The deliberately shallow exponents below make the beam
 * read like a shaped automotive projector rather than a bare inverse-square bulb:
 * compared with the original tune, 5 m receives roughly two-thirds of the
 * irradiance while 100–150 m receives several times as much. Cone, aim and cutoff remain unchanged.
 */
interface HeadlightBeam {
  readonly intensity: number;
  readonly distance: number;
  readonly angle: number;
  readonly penumbra: number;
  readonly targetDistance: number;
  readonly targetDrop: number;
  /** Exponent in Three's distance attenuation `intensity / distance^decay`. */
  readonly decay: number;
}

interface VehicleBeamMount {
  /** Source and aim in chassis-local coordinates. */
  readonly sourceLocal: THREE.Vector3;
  readonly aimLocal: THREE.Vector3;
}

interface ProjectedBeamShape {
  readonly distance: number;
  readonly angle: number;
  readonly penumbra: number;
  readonly decay: number;
}

/**
 * Dipped beam: broad foreground light aimed to meet the ground at roughly half
 * the previous range. Both its aim distance and attenuation cutoff are halved, so
 * the cone does not merely point past a shorter cutoff.
 */
const HEADLIGHT_LOW: HeadlightBeam = {
  intensity: 12.5,
  distance: 144,
  angle: 0.853,
  penumbra: 0.68,
  targetDistance: 13,
  targetDrop: 0.5,
  decay: 0.25,
};

/**
 * Main beam: narrower and longer than dipped beam, with both aim and cutoff halved
 * from the previous long-distance tune.
 */
const HEADLIGHT_HIGH: HeadlightBeam = {
  intensity: 20,
  distance: 260,
  angle: 0.616,
  penumbra: 0.45,
  targetDistance: 28,
  targetDrop: 0.45,
  decay: 0.2,
};

type HeadlightMode = 'off' | 'low' | 'high';

type EmissiveMaterial = THREE.MeshStandardMaterial | THREE.MeshPhongMaterial;
type IndicatorSide = 'off' | 'left' | 'right';

const HEADLIGHT_EMISSIVE = 0xffffff;
/** Tail lenses are red even when unlit; braking only raises their red emission. */
const TAILLIGHT_EMISSIVE = 0xff0000;
const REVERSE_LIGHT_EMISSIVE = 0xf4f7ff;
const BLINKER_EMISSIVE = 0xff8a00;

const TAILLIGHT_BEAM = {
  distance: 6,
  angle: 0.68,
  penumbra: 0.78,
  decay: 1.4,
  targetDistance: 3.5,
  targetDrop: 0.12,
  runningIntensity: 6,
  brakeIntensity: 24,
} as const;
const REVERSE_LIGHT_BEAM = {
  distance: 10,
  angle: 0.38,
  penumbra: 0.62,
  decay: 1.1,
  targetDistance: 6,
  targetDrop: 0.18,
  intensity: 24,
} as const;
/** 90 flashes per minute, with equal on/off halves. */
const BLINKER_PERIOD_S = 2 / 3;

/**
 * Per-compound factors for every wheel. Standard is the established handling
 * baseline (both 1).
 *
 * The two channels are deliberately separate, because they are separate physics:
 *
 *  - `grip` scales the FORCE CEILING at both ends of the tyre: the longitudinal
 *    capacity in `updateWheelDynamics` (drive and brake) and Rapier's friction cone,
 *    which with the longitudinal channels zeroed is the lateral force ceiling. It is
 *    how much the tyre can ultimately do.
 *  - `side` scales only `sideFrictionStiffness`, the GAIN of the lateral
 *    velocity-cancelling constraint: how much slip angle the tyre needs before it
 *    develops that force. It is how quickly the tyre responds, not how hard it holds.
 *
 * `experimental` is the combination that has no real-world compound behind it: a
 * standard ceiling reached lazily. Ultimate cornering grip, braking and traction are
 * untouched; the steering goes vague and the car has to be given time to take a set.
 * `experimental2` takes that further than any real tyre would — a ceiling slightly
 * ABOVE standard, reached at three times the slip angle — which is the pure form of
 * "loose but never lost": there is more grip there than a standard tyre has, and the
 * car makes you work for every newton of it.
 *
 * There is no `sport`. What it did on the surfaces where it was felt is traction
 * control, and it is now traction control (see the TCS constants above).
 */
const TYRE_COMPOUNDS = [
  { label: 'bald', grip: 0.55, side: 0.55 },
  { label: 'standard', grip: 1, side: 1 },
  { label: 'experimental', grip: 1, side: 0.55 },
  { label: 'experimental2', grip: 1.1, side: 0.3 },
] as const;

export class Vehicle implements Rebasable {
  private readonly physics: PhysicsWorld;
  private readonly world: GameWorld;
  private readonly car: CarState;
  private readonly model: CarModelDef;
  /** Shared immutable tuning selected once from the catalogue's mechanical family. */
  private readonly handling: HandlingTuning;
  private readonly measure: CarModelMeasure;
  /** Axle positions, wheel counts and weight distribution; measured once, in `measureAxles`. */
  private readonly axleGeometry: AxleGeometry;
  private readonly scene: THREE.Scene;
  private readonly origin: WorldOrigin;
  /** Removes this runtime from floating-origin notifications when it despawns. */
  private originDisposer: (() => void) | null = null;
  private disposed = false;


  private readonly chassisBody: RAPIER.RigidBody;
  private controller: RAPIER.DynamicRayCastVehicleController | null = null;
  private readonly drivetrain: Drivetrain;

  private statsValue: CarStats;

  private readonly rootGroup = new THREE.Group();

  private wheels: WheelVisual[] = [];
  /** One spray report per wheel, written in place every fixed step. */
  private wheelSprayStates: WheelSprayState[] = [];
  /** One ride report per wheel, written in place every fixed step. */
  private wheelRideStates: WheelRideState[] = [];
  private gizmos: GizmoVisual[] = [];
  /** Wheel objects taken from the instantiated model, keyed by wheel id. */
  private readonly wheelMeshes = new Map<string, THREE.Object3D>();
  /**
   * The cabin's steering wheel, turned to match the rack every frame.
   *
   * `steeringWheelRest` is the node's AUTHORED rotation about its own axis, which
   * the spin is added to rather than replacing: the wheel's rake lives in the same
   * Euler and overwriting it lays the rim flat.
   */
  private steeringWheel: THREE.Object3D | null = null;
  private steeringWheelRest = 0;
  private headlightMounts: VehicleBeamMount[] = [];
  private taillightMounts: VehicleBeamMount[] = [];
  private reverseLightMounts: VehicleBeamMount[] = [];
  private headlightEnvironmentFactor = 1;
  private headlightMode: HeadlightMode;
  private headlightLensMeshes: THREE.Mesh[] = [];
  private taillightLensMeshes: THREE.Mesh[] = [];
  private reverseLightLensMeshes: THREE.Mesh[] = [];
  /** Keep a loaded lamp snapshot visible until the first simulation step re-evaluates it. */
  private restoredLightStatePending = true;
  private readonly headlightLensMaterials: EmissiveMaterial[] = [];
  private readonly taillightMaterials: EmissiveMaterial[] = [];
  private readonly reverseLightMaterials: EmissiveMaterial[] = [];
  private readonly leftBlinkerMaterials: EmissiveMaterial[] = [];
  private readonly rightBlinkerMaterials: EmissiveMaterial[] = [];
  private rearLightState = -1;
  private reverseLightState = false;
  private indicatorSide: IndicatorSide = 'off';
  private indicatorElapsed = 0;
  private taillightBeamIntensity = 0;
  private reverseLightBeamIntensity = 0;
  private readonly projectedLightSource = new THREE.Vector3();
  private readonly projectedLightTarget = new THREE.Vector3();
  private indicatorLit = false;
  /** One selected compound for every wheel; standard preserves existing handling. */
  private tyreCompoundIndex = 1;

  /**
   * Seconds the TCS dashboard lamp still owes the player. Set whenever the system
   * actually cuts torque, counted down every step, so the lamp reports work done
   * rather than a system merely being fitted.
   */
  private tcsLampS = 0;

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
  /** Load-sensitive front bump-steer disturbance, filtered in fixedUpdate. */
  private bumpSteerAngle = 0;
  private appliedDriveTorqueNm = 0;
  /**
   * Parking hold is armed by the fixed update and applied after Rapier has stepped.
   * Freezing after the step removes the tiny gravity displacement that a ray-cast
   * wheel brake otherwise accumulates while a car is stopped on a slope.
   */
  private parkingHoldRequested = false;
  private parkingHoldActive = false;
  /**
   * Seconds of shove left before the parking hold re-latches. Counted down in `settle`,
   * so it only ever matters on a car nobody is driving.
   */
  private shoveTimer = 0;
  /**
   * Service-brake demand from the last driven step, 0..1. Read by a coupled
   * trailer so its brakes come on with the car's pedal.
   */
  private serviceBrakeCommand = 0;
  /** Literal backward/brake control, retained while an automatic uses it as reverse throttle. */
  private brakeLightCommand = 0;
  // Relative (Rapier frame): read from the body when the hold first latches, then
  // re-applied every step. Shifted by `rebase` alongside the interpolation
  // snapshots, so a held car does not snap a kilometre when the origin moves.
  private readonly parkingHoldPos = { x: 0, y: 0, z: 0 };
  private readonly parkingHoldRot = { x: 0, y: 0, z: 0, w: 1 };

  // Fuel: a local mirror of car.fuelLitres, resynced on external changes.
  private localFuel: number;
  private lastAuthFuel: number;
  private fuelEmitTimer = 0;
  /**
   * Coolant and oil, mirrored locally for the same reason fuel is: the authoritative
   * value is in state, but a per-tick round trip through `world.apply` for a number
   * that changes in the fourth decimal place is waste. Resynced whenever something
   * external (a poured can) moves the authority.
   */
  private localCoolant: number;
  private localOil: number;
  private lastAuthCoolant: number;

  // Cosmetic shell condition is mirrored locally so dust and impacts do not write
  // authoritative state every 16.7 ms; washing resyncs through the same authority check.
  private localBodyDirt: number;
  private localBodyScratches: number;
  private lastAuthBodyDirt: number;
  private lastAuthBodyScratches: number;
  private bodyConditionEmitTimer = 0;
  private lastAuthOil: number;
  private fluidEmitTimer = 0;

  // Odometer and transform emission.
  private odoAccum = 0;
  private odoEmitTimer = 0;
  private transformEmitTimer = 0;

  // Scratch buffers reused across fixedUpdate (no per-tick allocation).
  private readonly linvel = { x: 0, y: 0, z: 0 };

  /**
   * The prior controller pass's maximum legitimate deceleration. It bounds tyres
   * plus rolling/aero drag before the next solver result is classified as a blow.
   */
  private ownTyreCapacityN = 0;
  private ownDragRollingDeltaMps = 0;
  private previousStepContactCount = 0;
  private impactVelocityPrimed = false;
  private readonly previousStepLinvel = { x: 0, y: 0, z: 0 };
  private readonly stepStartLinvel = { x: 0, y: 0, z: 0 };
  private previousOwnTyreCapacityN = 0;
  private previousOwnDragRollingDeltaMps = 0;
  private impactThisStep = false;
  private readonly impactState = { severityMps: 0, localX: 0, localY: 0, localZ: 0 };
  private readonly rotationScratch = { x: 0, y: 0, z: 0, w: 1 };
  /** Reused application point for the lateral impulse; see the note where it is used. */
  private readonly lateralPoint = { x: 0, y: 0, z: 0 };
  private readonly forwardScratch = { x: 0, y: 0, z: 0 };
  /** Aligning moment summed over the wheels this step, N·m·s about world up. */
  private alignTorqueImpulse = 0;
  private readonly forceScratch = { x: 0, y: 0, z: 0 };
  /** Per-wheel tyre impulse, applied at the contact patch. */
  private readonly tyreImpulse = { x: 0, y: 0, z: 0 };
  /** Reused micro-relief impulse, applied along the suspension axis at the contact. */
  private readonly microUp = { x: 0, y: 0, z: 0 };
  /**
   * The sub-collider ground profile this car drives over. Seeded from the WORLD, not
   * from the car, so every vehicle in the same desert is thrown by the same ripple.
   */
  private readonly microRelief: MicroRelief;
  /** The sealed-surface texture field, seeded from the same world (see `RoadTexture`). */
  private readonly roadTexture: RoadTexture;
  private readonly invRotationScratch = { x: 0, y: 0, z: 0, w: 1 };
  private readonly localVelScratch = { x: 0, y: 0, z: 0 };
  private readonly localAngScratch = { x: 0, y: 0, z: 0 };
  private readonly leanScratch = { x: 0, y: 0, z: 0 };
  private readonly wheelRightScratch = { x: 0, y: 0, z: 0 };
  /**
   * Rear-axle slip angle (radians, unsigned) measured on the previous step. Read one
   * tick later by the steering limiter, which runs before the wheels are looked at:
   * at 60 Hz that is 17 ms of lag on a signal that takes tenths of a second to
   * build, and it is what keeps this a single-pass update instead of two.
   */
  private rearSlipRad = 0;
  /**
   * Custom tyre-force passes suppressed after the floating origin moves.
   *
   * Rapier's vehicle controller caches each wheel's world-space contact point and
   * refreshes it one controller update AFTER a body teleport. The floating origin is
   * such a teleport. On the first tick after a rebase, `updateWheelDynamics` therefore
   * received a point still expressed in the old origin and applied an ordinary tyre
   * impulse roughly one kilometre from the chassis: measured angular velocity jumped
   * from 0.05 to 19.8 rad/s inside that method alone — the distance-triggered
   * "invisible bump" that could spin a car in place.
   *
   * Suspension still updates on that tick, which refreshes the controller's contact
   * cache. Suppressing one 16.7 ms custom tyre pass is imperceptible and means the next
   * one applies at a contact point beside the wheel rather than a kilometre away.
   */
  private skipTyreDynamicsSteps = 0;
  // Roll-couple state: low-passed lateral acceleration and its lever arm.
  private prevLatVel = 0;
  private rollAccel = 0;
  private rollPrimed = false;
  private rollLeverArm = 0.5;
  /**
   * Total longitudinal tyre force applied to the chassis this step, newtons. Signed:
   * positive drives, negative brakes. Summed in `updateWheelDynamics` and consumed by
   * `applyAntiPitch`, which needs the force that was actually DELIVERED rather than
   * the one the pedals asked for — the tyre model routinely delivers less.
   */
  private longitudinalForceSum = 0;
  /**
   * The tyre contact plane in chassis-local metres: where the ground is when the
   * car is standing on its own suspension. Set by `rebuild` from the mount it
   * actually gives Rapier, which is NOT the mount the model measured (see the ride
   * height rule above), so this is the only honest answer to "how high off the
   * ground is this point on the car" — which is exactly what bolting a tow ball to
   * an arbitrary body needs. Anything deriving a height from `measure.wheels[].pos`
   * instead is out by the ride-height correction, up to RIDE_LIFT_MAX.
   */
  private contactPlaneY = -0.5;
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
    engineDestroyed: false,
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
  /** Shared scratch for player-contact and bubble-flip queries. */
  private readonly contactPoint = new THREE.Vector3();
  private readonly contactNormal = new THREE.Vector3();

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

  constructor(
    physics: PhysicsWorld,
    world: GameWorld,
    carState: CarState,
    scene: THREE.Scene,
    origin: WorldOrigin,
  ) {
    this.physics = physics;
    this.world = world;
    this.car = carState;
    this.scene = scene;
    this.origin = origin;
    this.microRelief = new MicroRelief(world.seed);
    this.roadTexture = new RoadTexture(world.seed);
    this.model = carModel(carState.modelId);
    this.handling = HANDLING_PROFILES[this.model.handlingProfile];
    this.measure = carModelMeasure(carState.modelId);
    this.axleGeometry = this.measureAxles();
    this.headlightMode = carState.headlightMode;

    const half = this.measure.halfExtents;
    // Frontal area 4·hx·hy; 0.5·ρ·Cd collapses to the constant below.
    this.dragCoeff = 0.5 * AIR_DENSITY * DRAG_CD * (4 * half[0] * half[1]);

    // `carState.x/z` are absolute (from the save); Rapier holds relative positions.
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(carState.x - this.origin.x, carState.y, carState.z - this.origin.z)
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
      this.drivetrainEngine(),
      this.statsValue.gearbox,
      this.model.rearDriveBias,
    );

    this.localFuel = carState.fuelLitres;
    this.lastAuthFuel = carState.fuelLitres;
    this.localCoolant = carState.coolantLitres;
    this.lastAuthCoolant = carState.coolantLitres;
    this.localBodyDirt = clamp(carState.dirt, 0, 1);
    this.lastAuthBodyDirt = this.localBodyDirt;
    this.localBodyScratches = clamp(carState.scratches, 0, 1);
    this.lastAuthBodyScratches = this.localBodyScratches;
    this.localOil = carState.oilLitres;
    this.lastAuthOil = carState.oilLitres;
    this.rebuild();
    this.originDisposer = this.origin.register(this);
  }

  get stats(): CarStats {
    return this.statsValue;
  }

  get chassis(): RAPIER.RigidBody {
    return this.chassisBody;
  }

  /** Non-null only during the fixed step that classified the previous solve as a collision. */
  get lastImpact(): VehicleImpact | null {
    return this.impactThisStep ? this.impactState : null;
  }

  /** Live cosmetic shell dirt, including unflushed fixed-step accumulation. */
  get bodyDirt(): number {
    return this.localBodyDirt;
  }

  /** Live cosmetic shell scratches, including unflushed fixed-step accumulation. */
  get bodyScratches(): number {
    return this.localBodyScratches;
  }

  /**
   * Absolute chassis position, for consumers that sample the world (road projection,
   * terrain height). Rapier holds the relative position; add the origin here so no
   * caller does origin arithmetic on a body translation. `chassis.translation()` is
   * the same point in the relative frame, for anything compared against a body.
   */
  absoluteTranslation(out: Vec3): Vec3 {
    this.chassisBody.translation(out);
    out.x += this.origin.x;
    out.z += this.origin.z;
    return out;
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

  /**
   * Where the ground is in chassis-local metres when this car stands on its own
   * suspension (see `contactPlaneY`). Anything mounted at a real-world height off
   * the road — the trailer's tow ball — measures from here, not from the model's
   * measured wheel mounts.
   */
  get contactPlaneLocalY(): number {
    return this.contactPlaneY;
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

  /**
   * Is traction control cutting torque right now? Drives the dashboard lamp, and
   * nothing else: the aid itself is unconditional.
   */
  get tcsActive(): boolean {
    return this.tcsLampS > 0;
  }

  get speedKmh(): number {
    return Math.abs(this.forwardSpeedMps()) * 3.6;
  }

  get engineRunning(): boolean {
    return bonnetCanRun(this.car.bonnet, this.localFuel, this.car.fuelKind);
  }

  get engineDestroyed(): boolean {
    return bonnetPart(this.car.bonnet, 0)?.destroyed === true;
  }

  /**
   * Live audio telemetry. Returns the vehicle's own buffer, refreshed each fixed
   * step: callers read it and must not retain or mutate it.
   */
  get audio(): VehicleAudioState {
    return this.audioState;
  }

  /**
   * Live per-wheel spray telemetry. Returns the vehicle's own buffer, refreshed
   * each fixed step: callers read it and must not retain or mutate it. Parked
   * cars are never refreshed, but only the driven car is ever asked.
   */
  get wheelSpray(): readonly WheelSprayState[] {
    return this.wheelSprayStates;
  }

  /**
   * Live per-wheel RIDE telemetry: loads, spring compression and what the tyre is
   * doing about the road. Same contract as `wheelSpray` — the vehicle's own buffer,
   * refreshed each fixed step, not to be retained or mutated.
   */
  get wheelRide(): readonly WheelRideState[] {
    return this.wheelRideStates;
  }

  /** Off -> dipped beam -> high beam -> off. */
  cycleHeadlights(): void {
    this.restoredLightStatePending = false;
    this.headlightMode =
      this.headlightMode === 'off' ? 'low' : this.headlightMode === 'low' ? 'high' : 'off';
    this.applyHeadlightMode();
    this.applyRearLightState();
    this.pushLightState();
  }
  toggleIndicator(side: Exclude<IndicatorSide, 'off'>): void {
    this.indicatorSide = this.indicatorSide === side ? 'off' : side;
    this.indicatorElapsed = 0;
    this.applyIndicatorState(this.indicatorSide !== 'off');
  }

  setHeadlightEnvironmentFactor(factor: number): void {
    const next = clamp(factor, 0, 1);
    if (next === this.headlightEnvironmentFactor) return;
    this.headlightEnvironmentFactor = next;
    this.applyHeadlightMode();
    this.applyRearLightState(true);
  }

  /**
   * Bald -> standard -> experimental -> experimental2 -> bald, applied to every wheel
   * on the next step. Not persisted: a reload or a change of car is back on standard.
   */
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
    this.headlightMounts = [];
    this.taillightMounts = [];
    this.reverseLightMounts = [];
    this.steerCommand = 0;
    this.steerAngle = 0;
    this.bumpSteerAngle = 0;
    this.frontWheelCount = 0;
    this.rearWheelCount = 0;
    this.frontDrivenCount = 0;
    this.rearDrivenCount = 0;
    this.drivenRadius = 0.35;

    this.statsValue = this.computeStats();
    const stats = this.statsValue;

    this.drivetrain.reconfigure(this.drivetrainEngine(), stats.gearbox);

    // Fitted parts change the drivetrain; gizmos still change only mass.
    this.applyChassisMass(stats.mass);

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

    const frontDriveShare = 1 - this.model.rearDriveBias;
    const rearDriveShare = this.model.rearDriveBias;
    const suspension = this.model.suspension;
    const axles = this.axleGeometry;

    // RIDE HEIGHT, as a length rather than a consequence.
    //
    // The body's clearance is now a number the catalogue states (see RIDE_LIFT_MAX):
    // whichever is lower of the preset's own figure and the model's drawn stance plus
    // the lift cap. Nothing in it depends on a spring rate, which is the whole point —
    // softening the springs used to change how high the car stood.
    const halfHeight = this.measure.halfExtents[1];
    const referenceWheel = this.measure.wheels[0];
    const drawnClearance = referenceWheel.radius - referenceWheel.pos[1] - halfHeight;
    const baseClearance = Math.max(
      RIDE_MIN_CLEARANCE,
      Math.min(suspension.rideHeight, drawnClearance + RIDE_LIFT_MAX),
    );
    const clearance = baseClearance + referenceWheel.radius * CLEARANCE_WHEEL_RADIUS_FRACTION;
    const contactY = -halfHeight - clearance;

    // Roll lever: how far the centre of mass sits above the tyre contact plane. This
    // is the arm the missing roll couple acts on (see applyRollCouple).
    const comY = -COM_DROP_FRACTION * halfHeight;
    this.rollLeverArm = Math.max(0.1, comY - contactY);
    this.contactPlaneY = contactY;
    // Headlight height is measured from the settled contact plane, so a low skirt
    // or oddly-centred model cannot put the light source below an uphill surface.
    this.buildVisuals();

    const weightN = stats.mass * GRAVITY;
    for (const wheel of this.measure.wheels) {
      const index = this.controller.numWheels();

      // This corner's share of the parked car's weight, from the weight distribution
      // and the model's own axle geometry. Everything below is derived from it: the
      // spring that gives this axle its frequency AT THIS LOAD, the damper that gives
      // it its ratio, and the load the tyre model calls "normal".
      const axleShare = wheel.isFront ? axles.frontWeightShare : 1 - axles.frontWeightShare;
      const axleCount = wheel.isFront ? axles.frontCount : axles.rearCount;
      const cornerShare = axleShare / Math.max(1, axleCount);
      const staticLoadN = Math.max(1, weightN * cornerShare);
      const hz = wheel.isFront ? suspension.frontHz : suspension.rearHz;
      const sag = staticSagM(hz);
      const stiffness = wheelSpringRate(hz, cornerShare);
      const compression = wheelDampingRate(hz, suspension.compressionRatio, cornerShare);
      const relaxation = wheelDampingRate(hz, suspension.reboundRatio, cornerShare);
      // Travel is sized around the sag the frequency demands, so a soft spring gets
      // the room it needs instead of riding on Rapier's clamp (see the travel note in
      // carmodels.ts). The bump stop below catches the last of it progressively.
      const maxTravel = sag + suspension.bumpTravel;
      const restLength = sag + MOUNT_ABOVE_WHEEL_CENTRE;

      // The mount is placed so a settled wheel centre lands exactly one radius above
      // the chosen contact plane, per axle. Two axles with different sag therefore sit
      // the car LEVEL rather than raked, and the model's track and wheelbase are
      // untouched.
      this.controller.addWheel(
        { x: wheel.pos[0], y: contactY + wheel.radius + MOUNT_ABOVE_WHEEL_CENTRE, z: wheel.pos[2] },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        restLength,
        wheel.radius,
      );

      // Rapier's ray-cast suspension multiplies the spring force by the chassis
      // mass internally (`force * chassis_mass` in update_suspension), so these rates
      // are *per kilogram* of chassis mass — which is what makes them independent of
      // load and the reason `cornerShare` has to appear in them explicitly. The force
      // ceiling is absolute newtons, and is set from this corner's own static load so
      // a heavy vehicle is not quietly given a stiffer landing than a light one.
      this.controller.setWheelSuspensionStiffness(index, stiffness);
      this.controller.setWheelSuspensionCompression(index, compression);
      this.controller.setWheelSuspensionRelaxation(index, relaxation);
      this.controller.setWheelMaxSuspensionTravel(index, maxTravel);
      this.controller.setWheelMaxSuspensionForce(index, SUSPENSION_FORCE_HEADROOM * staticLoadN);

      const mesh = this.wheelMeshes.get(wheel.id);
      if (!mesh) throw new Error(`Car model "${this.model.id}" is missing wheel ${wheel.id}`);
      mesh.name = wheel.id;
      mesh.rotation.order = 'YXZ';
      this.rootGroup.add(mesh);

      this.wheels.push({
        index,
        isFront: wheel.isFront,
        sideSign: Math.sign(wheel.pos[0]) || 1,
        radius: wheel.radius,
        restLengthM: restLength,
        maxTravelM: maxTravel,
        sagM: sag,
        staticLoadN,
        springRate: stiffness,
        compressionRate: compression,
        relaxationRate: relaxation,
        bumpStopN: 0,
        tyreRateN: tyreVerticalRate(wheel.radius),
        profileHeight: 0,
        profileRate: 0,
        hopZ: 0,
        hopV: 0,
        mesh,
        scratchCp: { x: 0, y: 0, z: 0 },
        frictionSlip: 0,
        groundSurface: SurfaceType.Asphalt,
        grounded: false,
        slideT: 0,
        slipAngleRad: 0,
        gripUsage: 0,
        tcsCut: 0,
        locked: false,
        spinRadS: 0,
        drawnSpin: 0,
        slipRatio: 0,
        loadN: 0,
        compressionM: 0,
        lateralCapacityN: 0,
        lateralShape: 0,
        lateralRightX: 1,
        lateralRightY: 0,
        lateralRightZ: 0,
        lateralSpeed: 0,
        driveTorqueNm: 0,
        brakeForceN: 0,
        forwardDir: { x: 0, y: 0, z: 1 },
        contactPoint: { x: 0, y: 0, z: 0 },
        contactNormal: { x: 0, y: 1, z: 0 },
        contactVel: { x: 0, y: 0, z: 0 },
      });

      if (wheel.isFront) {
        this.frontWheelCount++;
        if (frontDriveShare > 0) this.frontDrivenCount++;
      } else {
        this.rearWheelCount++;
        if (rearDriveShare > 0) this.rearDrivenCount++;
      }
    }

    // One spray report per wheel, filled in place every fixed step (never
    // reallocated); sized here so it tracks the wheel count through a rebuild.
    this.wheelSprayStates = [];
    for (let i = 0; i < this.wheels.length; i++) {
      this.wheelSprayStates.push({
        contactX: 0,
        contactY: 0,
        contactZ: 0,
        absoluteContactX: 0,
        absoluteContactZ: 0,
        forwardX: 0,
        forwardZ: 1,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
        inContact: false,
        surface: SurfaceType.Asphalt,
        slipRatio: 0,
        slideT: 0,
        forwardSpeed: 0,
      });
    }

    // One ride report per wheel, on the same terms: allocated here, written in place.
    this.wheelRideStates = [];
    for (const w of this.wheels) {
      this.wheelRideStates.push({
        isFront: w.isFront,
        sideSign: w.sideSign,
        inContact: false,
        loadN: 0,
        staticLoadN: w.staticLoadN,
        compressionM: 0,
        reserveM: w.maxTravelM - w.sagM,
        bumpStopN: 0,
        tyreDeflectionM: 0,
      });
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
    this.restoredLightStatePending = false;
    // Nobody is driving this one, so no step of its own explains its velocity. Leaving
    // the impact detector primed across that gap would report the whole standing
    // interval as one collision the moment the player got back in.
    this.impactVelocityPrimed = false;

    const n = this.wheels.length;
    // Being shoved suspends the hold, not the brake. The hold is a teleport — it
    // re-places the chassis at `parkingHoldPos` every step — so with it active no
    // impulse from anywhere can move the car at all.
    //
    // Crucially, a newly spawned car is NOT held yet. The old unconditional request
    // latched its first airborne transform before gravity could land it; every menu
    // and POI spawn therefore remained floating forever.
    const shoved = this.shoveTimer > 0;
    if (shoved) this.shoveTimer = Math.max(0, this.shoveTimer - dt);
    this.parkingHoldRequested = false;
    // Nobody is driving, so there is no pedal. A trailer left coupled to a parked
    // car holds on its own brakes (uncoupled or not, it is not being towed).
    this.serviceBrakeCommand = 0;
    this.brakeLightCommand = 0;
    this.advanceIndicator(dt);
    if (n === 0) return;

    // A parked car keeps the road-wheel angle it had when the driver stepped out.
    // Do not feed zero here: that would visually straighten the car on the first
    // parked tick and lose the driver's last steering position.
    const parkedSteer = this.steerAngle;
    // Parking brake: same impulse units as the foot brake (see the braking note
    // above), spread over every wheel. Sized to hold, not to stop.
    const decel = shoved ? PARK_BRAKE_DECEL * SHOVE_BRAKE_FRACTION : PARK_BRAKE_DECEL;
    const impulse = (decel * this.statsValue.mass * dt) / n;
    for (const w of this.wheels) {
      controller.setWheelEngineForce(w.index, 0);
      controller.setWheelSteering(w.index, w.isFront ? parkedSteer : 0);
      controller.setWheelBrake(w.index, impulse);
    }
    // Keep the controller's wheel pose aligned with the retained angle so the render
    // path and the parked physics path observe the same state.

    controller.updateVehicle(dt);
    // Latch only after suspension contact and vertical settlement. Two contacts let
    // a car parked across a crest hold normally; an already-held car remains held.
    let contacts = 0;
    for (const w of this.wheels) {
      if (controller.wheelIsInContact(w.index)) contacts++;
    }
    const verticalSpeed = Math.abs(this.chassisBody.linvel().y);
    this.parkingHoldRequested =
      !shoved &&
      (
        this.parkingHoldActive ||
        (this.snapshotPrimed && contacts >= 2 && verticalSpeed < PARK_HOLD_SPEED_MPS)
      );
  }

  /**
   * Somebody is leaning on this car. Push it, grudgingly.
   *
   * `Shoveable`, implemented for the player's character controller (player.ts). It is a
   * REQUEST rather than an impulse applied from outside for one reason: a parked car pins
   * its own chassis every step, and only the car can lift that pin. It also owns the
   * arithmetic, which wants the car's mass — a 1200 kg hatchback and a 7 t truck should
   * both creep, not one be immovable and the other slide.
   *
   * The cap is a target SPEED, not a force: it takes the velocity the body already has
   * along the push axis and only supplies the impulse needed to close the gap to
   * SHOVE_SPEED_CAP, scaled so that gap closes over SHOVE_RAMP_SECONDS. That is what makes
   * the same call reasonable on a parked saloon and harmless on a wreck: nothing can be
   * accelerated past a walking shove however long it is leaned on.
   */
  shove(dirX: number, dirZ: number, seconds: number): void {
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-4 || seconds <= 0) return;
    const nx = dirX / len;
    const nz = dirZ / len;

    const v = this.chassisBody.linvel();
    const along = v.x * nx + v.z * nz;
    const gap = SHOVE_SPEED_CAP - along;
    // Already going that way at least as fast as a shove can push: nothing to add. This
    // is also what stops a shove helping a rolling car along indefinitely.
    if (gap <= 0) {
      this.shoveTimer = SHOVE_RELEASE_SECONDS;
      return;
    }

    const mass = this.statsValue.mass;
    const impulse = Math.min(gap, (SHOVE_SPEED_CAP * seconds) / SHOVE_RAMP_SECONDS) * mass;
    // Horizontal only. A player walking into a bumper must never lift a car or press it
    // into the ground, and the wheel ray-casts are unforgiving about both.
    this.chassisBody.applyImpulse({ x: nx * impulse, y: 0, z: nz * impulse }, true);
    this.shoveTimer = SHOVE_RELEASE_SECONDS;
  }

  /**
   * Push fallback for the player's capsule. Character-controller collision reports
   * can disappear at a raised rear edge when autostep owns the contact; testing the
   * same capsule sphere against the chassis OBB keeps the boot side shoulderable.
   * Returns true only while the player is touching and moving into the body.
   */
  tryShoveFromSphere(
    x: number,
    y: number,
    z: number,
    radius: number,
    moveX: number,
    moveZ: number,
    seconds: number,
  ): boolean {
    if (!this.sphereTouchesBody(x, y, z, radius)) return false;
    const pushX = -this.contactNormal.x;
    const pushZ = -this.contactNormal.z;
    if (moveX * pushX + moveZ * pushZ <= 0) return false;
    this.shove(pushX, pushZ, seconds);
    return true;
  }

  /** True when a world-space sphere touches the chassis body box. */
  touchesSphere(x: number, y: number, z: number, radius: number): boolean {
    return this.sphereTouchesBody(x, y, z, radius);
  }

  /**
   * Toggles the car between wheels-down and roof-down while preserving its heading.
   * The expanding bubble hides this deliberately cheap teleport; snapping is more
   * reliable than an impulse on dunes and cannot leave a heavy bus balanced on edge.
   */
  flipOver(): void {
    const rotation = this.chassisBody.rotation();
    const forward = this.contactPoint
      .set(0, 0, 1)
      .applyQuaternion(this.quat.set(rotation.x, rotation.y, rotation.z, rotation.w));
    const heading = Math.atan2(forward.x, forward.z);
    const halfHeading = heading * 0.5;
    const sin = Math.sin(halfHeading);
    const cos = Math.cos(halfHeading);
    const upY = 1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z);
    const t = this.chassisBody.translation();
    const lift = Math.max(0.65, this.measure.halfExtents[1] * 1.25);

    this.chassisBody.setTranslation({ x: t.x, y: t.y + lift, z: t.z }, true);
    this.chassisBody.setRotation(
      upY >= 0
        ? { x: sin, y: 0, z: cos, w: 0 }
        : { x: 0, y: sin, z: 0, w: cos },
      true,
    );
    this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.parkingHoldRequested = false;
    this.parkingHoldActive = false;
    this.shoveTimer = SHOVE_RELEASE_SECONDS;
    this.snapshotPrimed = false;
  }

  /**
   * Sphere/OBB overlap in chassis-local space. On success `contactNormal` points
   * horizontally out of the car toward the sphere and is reused by the shove path.
   */
  private sphereTouchesBody(x: number, y: number, z: number, radius: number): boolean {
    const t = this.chassisBody.translation();
    const r = this.chassisBody.rotation();
    this.quat.set(r.x, r.y, r.z, r.w).invert();
    const local = this.contactPoint.set(x - t.x, y - t.y, z - t.z).applyQuaternion(this.quat);
    const half = this.measure.halfExtents;
    const floor = Math.max(-half[1], this.measure.wheels[0].pos[1]);
    const closestX = clamp(local.x, -half[0], half[0]);
    const closestY = clamp(local.y, floor, half[1]);
    const closestZ = clamp(local.z, -half[2], half[2]);
    const dx = local.x - closestX;
    const dy = local.y - closestY;
    const dz = local.z - closestZ;
    if (dx * dx + dy * dy + dz * dz > radius * radius) return false;

    let nx = dx;
    let nz = dz;
    if (nx * nx + nz * nz < 1e-8) {
      const gapX = half[0] - Math.abs(local.x);
      const gapZ = half[2] - Math.abs(local.z);
      if (gapX < gapZ) nx = local.x < 0 ? -1 : 1;
      else nz = local.z < 0 ? -1 : 1;
    }
    const horizontalLength = Math.hypot(nx, nz);
    if (horizontalLength < 1e-4) return false;
    this.contactNormal
      .set(nx / horizontalLength, 0, nz / horizontalLength)
      .applyQuaternion(this.quat.invert());
    const worldHorizontalLength = Math.hypot(this.contactNormal.x, this.contactNormal.z);
    if (worldHorizontalLength < 1e-4) return false;
    this.contactNormal.x /= worldHorizontalLength;
    this.contactNormal.y = 0;
    this.contactNormal.z /= worldHorizontalLength;
    return true;
  }

  /**
   * Service-brake demand, 0..1 — the pedal only, never the handbrake. Exposed so a
   * coupled trailer's brakes can follow the car that is towing it.
   */
  get brakeCommand(): number {
    return this.serviceBrakeCommand;
  }

  /**
   * Flushes every runtime-owned value into serialisable state before a save.
   *
   * External pours update `CarState` first and are accepted here instead of being
   * overwritten by an older local mirror. Consumption goes the other direction:
   * while the authoritative value still matches the last emitted value, the local
   * mirror contains the newer level and is pushed now.
   */
  pushState(): void {
    if (this.car.fuelLitres !== this.lastAuthFuel) {
      this.localFuel = this.car.fuelLitres;
    } else if (this.localFuel !== this.car.fuelLitres) {
      this.world.apply({ t: 'car_fuel', carId: this.car.id, litres: this.localFuel });
    }
    this.lastAuthFuel = this.localFuel;
    this.fuelEmitTimer = 0;

    if (this.car.coolantLitres !== this.lastAuthCoolant) {
      this.localCoolant = this.car.coolantLitres;
    } else if (this.localCoolant !== this.car.coolantLitres) {
      this.world.apply({
        t: 'car_fluid',
        carId: this.car.id,
        fluid: 'coolant',

        litres: this.localCoolant,
      });
    }
    this.lastAuthCoolant = this.localCoolant;

    if (this.car.oilLitres !== this.lastAuthOil) {
      this.localOil = this.car.oilLitres;
    } else if (this.localOil !== this.car.oilLitres) {
      this.world.apply({ t: 'car_fluid', carId: this.car.id, fluid: 'oil', litres: this.localOil });
    }
    this.lastAuthOil = this.localOil;
    this.fluidEmitTimer = 0;

    if (
      this.car.dirt !== this.lastAuthBodyDirt ||
      this.car.scratches !== this.lastAuthBodyScratches
    ) {
      this.localBodyDirt = clamp(this.car.dirt, 0, 1);
      this.localBodyScratches = clamp(this.car.scratches, 0, 1);
    } else if (
      this.localBodyDirt !== this.car.dirt ||
      this.localBodyScratches !== this.car.scratches
    ) {
      this.world.apply({
        t: 'car_body_condition',
        carId: this.car.id,
        dirt: this.localBodyDirt,
        scratches: this.localBodyScratches,
      });
    }
    this.lastAuthBodyDirt = this.localBodyDirt;
    this.lastAuthBodyScratches = this.localBodyScratches;
    this.bodyConditionEmitTimer = 0;

    if (this.odoAccum > 0) {
      this.world.apply({ t: 'car_odometer', carId: this.car.id, metres: this.odoAccum });
      this.odoAccum = 0;
    }
    this.odoEmitTimer = 0;
    this.pushTransform();
    this.restoredLightStatePending = false;
    this.applyRearLightState();
    this.pushLightState();
  }

  /** Pushes the current chassis pose into state immediately. */
  pushTransform(): void {
    this.transformEmitTimer = 0;
    this.chassisBody.translation(this.pos);
    this.chassisBody.rotation(this.quat);
    // The save stores absolute world coordinates; `pos` is relative.
    this.world.apply({
      t: 'car_transform',
      carId: this.car.id,
      x: this.pos.x + this.origin.x,
      y: this.pos.y,
      z: this.pos.z + this.origin.z,
      qx: this.quat.x,
      qy: this.quat.y,
      qz: this.quat.z,
      qw: this.quat.w,
    });
  }

  private pushLightState(): void {
    const taillightsOn = this.rearLightState > 0;
    const reverseLightsOn = this.reverseLightState;
    if (
      this.car.headlightMode === this.headlightMode &&
      this.car.taillightsOn === taillightsOn &&
      this.car.reverseLightsOn === reverseLightsOn
    ) {
      return;
    }
    this.world.apply({
      t: 'car_lights',
      carId: this.car.id,
      headlightMode: this.headlightMode,
      taillightsOn,
      reverseLightsOn,
    });
  }

  fixedUpdate(dt: number, input: InputFrame): void {
    const controller = this.controller;
    if (!controller) return;
    this.restoredLightStatePending = false;

    const stats = this.statsValue;

    // Resync if an external system (pouring a can) changed the authoritative value.
    if (this.car.fuelLitres !== this.lastAuthFuel) {
      this.localFuel = this.car.fuelLitres;
      this.lastAuthFuel = this.car.fuelLitres;
    }
    if (this.car.coolantLitres !== this.lastAuthCoolant) {
      this.localCoolant = this.car.coolantLitres;
      this.lastAuthCoolant = this.car.coolantLitres;
    }
    if (this.car.oilLitres !== this.lastAuthOil) {
      this.localOil = this.car.oilLitres;
      this.lastAuthOil = this.car.oilLitres;
    }

    if (
      this.car.dirt !== this.lastAuthBodyDirt ||
      this.car.scratches !== this.lastAuthBodyScratches
    ) {
      this.localBodyDirt = clamp(this.car.dirt, 0, 1);
      this.localBodyScratches = clamp(this.car.scratches, 0, 1);
      this.lastAuthBodyDirt = this.localBodyDirt;
      this.lastAuthBodyScratches = this.localBodyScratches;
    }

    // The solver runs between fixedUpdate calls. Sampling here therefore compares
    // its completed result against the velocity cached before the prior solve.
    this.chassisBody.linvel(this.stepStartLinvel);
    this.impactThisStep = false;

    let fwd = this.forwardSpeedMps();
    let bodyConditionChanged = false;
    if (this.engineRunning && this.engineDestroyed && Math.abs(fwd) > DESTROYED_ENGINE_SPEED_CAP_MPS) {
      this.capDestroyedEngineSpeed(fwd);
      fwd = Math.sign(fwd) * DESTROYED_ENGINE_SPEED_CAP_MPS;
    }
    this.parkingHoldRequested =
      input.handbrake && (this.parkingHoldActive || Math.abs(fwd) < PARK_HOLD_SPEED_MPS);

    // Manual shift request; with driver assist on this is a +/- gate — the
    // request applies now and the next automatic decision may override it.
    if (input.shift !== 0) this.drivetrain.shift(input.shift);

    // The pedal opposite an ENGAGED drive direction remains the service brake
    // until the car is nearly stopped. Neutral is different: drive may engage
    // during a slow rollback so engine torque, rather than the brakes, arrests it.
    const automatic = this.world.state.settings.gearboxMode === 'automatic' || this.drivetrain.isPhysicallyAutomatic;
    const brakingForDirectionChange =
      automatic &&
      ((input.reverse && fwd > AUTO_DIRECTION_RELEASE_MPS) ||
        (!input.reverse &&
          fwd < -AUTO_DIRECTION_RELEASE_MPS &&
          this.drivetrain.isReverseDriveEngaged));
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
    const throttle = this.engineRunning ? throttleInput : 0;
    // Crank speed comes from ROAD speed, not the wheel's own rotation. Gearing it to
    // the wheel is the physically complete answer, and it was measured: it bounds
    // wheelspin properly (a slipping tyre revs the engine out), but with thrust still
    // coming from Rapier's engine force a slipping wheel then pinned the engine at its
    // redline, where torque is cut — full throttle in 1st settled at 26 km/h and 50%
    // slip. That coupling belongs with the tyre force model, not before it; until then
    // wheelspin is bounded by the gear's own redline ceiling (maxDrivenWheelSpinRadS).
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
    // S is a brake request in neutral/forward gears, but reverse throttle once R
    // has engaged. The same physical key must not command propulsion and brake lamps.
    this.brakeLightCommand =
      this.drivetrain.gearLabel !== 'R' && input.reverse ? 1 : 0;

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

    // Coolant and oil seep while the engine turns. They are not consumed by work
    // like fuel is — the rate is flat per running second, which is why this sits
    // outside the fuel-burn branch and only asks whether the engine is alive.
    //
    // Mirrored locally and emitted on the same throttled cadence as fuel, for the
    // same reason: a delta per tick for a number that moves by 0.0004 L would be
    // three hundred pointless state writes a second.
    // A dry intact engine becomes permanently destroyed. It remains fitted and
    // running, but its drivetrain spec collapses to limp-home torque.
    const failure = this.engineRunning
      ? engineFailureReason(this.car.bonnet, this.localCoolant, this.localOil)
      : null;
    if (failure !== null) {
      const engineItem = this.car.bonnet[0];
      if (engineItem?.type === 'part') {
        const destroyed = {
          ...engineItem,
          part: { ...engineItem.part, destroyed: true },
        };
        this.world.apply({ t: 'car_bonnet', carId: this.car.id, cell: 0, item: destroyed });
        this.drivetrain.reconfigure(this.drivetrainEngine(), stats.gearbox);
        this.appliedDriveTorqueNm = 0;
      }
    }

    if (this.engineRunning) {
      const perSecond = 1 / 3600;
      this.localCoolant = Math.max(0, this.localCoolant - COOLANT_LOSS_LPH * perSecond * dt);
      this.localOil = Math.max(0, this.localOil - OIL_LOSS_LPH * perSecond * dt);
      this.fluidEmitTimer += dt;
      if (this.fluidEmitTimer >= FUEL_EMIT_INTERVAL) {
        this.fluidEmitTimer = 0;
        this.lastAuthCoolant = this.localCoolant;
        this.lastAuthOil = this.localOil;
        this.world.apply({
          t: 'car_fluid',
          carId: this.car.id,
          fluid: 'coolant',
          litres: this.localCoolant,
        });
        this.world.apply({ t: 'car_fluid', carId: this.car.id, fluid: 'oil', litres: this.localOil });
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
    this.updateBumpSteer(dt, speedKmh);
    const steerT = clamp(
      (speedKmh - STEER_FULL_LOCK_KMH) / (STEER_REDUCED_KMH - STEER_FULL_LOCK_KMH),
      0,
      1,
    );
    const steerInput =
      Math.sign(input.steer) * Math.pow(Math.abs(input.steer), this.handling.steerInputExponent);
    // How far out is the tail? (See the countersteer note above.) Both the lock
    // ceiling and the rate limit are faded back toward their parking-speed values by
    // this, so a driver catching a slide has the lock and the hand-speed the car
    // physically has, and loses them again as the slide is gathered up.
    const slideRelease = clamp(
      ((this.rearSlipRad * 180) / Math.PI - COUNTERSTEER_RELEASE_START_DEG) /
        (COUNTERSTEER_RELEASE_FULL_DEG - COUNTERSTEER_RELEASE_START_DEG),
      0,
      1,
    );
    // fraction = 1 - (1-floor) * t^k: full lock up to STEER_FULL_LOCK_KMH, then a
    // fast collapse right above it and a gentle slide to the floor.
    const speedFactor =
      1 -
      (1 - this.handling.steerHighSpeedFraction) *
        Math.pow(steerT, this.handling.steerLockCurve);
    const targetSteer =
      -steerInput * this.model.steerLock * (speedFactor + (1 - speedFactor) * slideRelease);
    const steerRate =
      this.handling.steerRateHighway +
      (this.handling.steerRatePark - this.handling.steerRateHighway) *
        Math.max(Math.pow(1 - steerT, STEER_RATE_CURVE), slideRelease);
    const maxDelta = steerRate * dt;
    this.steerCommand += clamp(targetSteer - this.steerCommand, -maxDelta, maxDelta);

    // Caster first, then backlash. Inside the window the tyres are not held by the
    // box at all, so the road returns them toward straight
    // (STEER_CASTER_RETURN_RAD_S); the backlash operator then drags them out of the
    // window whenever the command has moved beyond it. Order matters: centring
    // before the operator means a held input settles on the window's trailing edge
    // (slack taken up in the direction of load) instead of drifting off it.
    //
    // THE PLAY FADES OUT DURING A SLIDE, on the same `slideRelease` the lock ceiling
    // and the rate limit use — and it is the most honest of the three. Catching a
    // slide is a sequence of REVERSALS, and every reversal crosses the whole window:
    // 1.03 degrees each way, so 2.06 degrees of dead travel per correction, arriving
    // late every single time. That is a driver-induced oscillation generator, and it
    // is exactly the rocking left and right that ends in the scenery.
    //
    // Physically it is also what a real box does. Backlash is only there when the
    // gear teeth are unloaded; a driver countersteering against a sliding rear is
    // holding the wheel hard against the load, so the slack is already taken up on
    // that side and there is nothing to cross. The vagueness belongs to cruising on
    // centre, which is where it is left untouched.
    const play = this.handling.steerPlay * (1 - slideRelease);
    const caster = this.handling.casterReturn * dt;
    this.steerAngle -= clamp(this.steerAngle, -caster, caster);
    if (this.steerCommand > this.steerAngle + play) {
      this.steerAngle = this.steerCommand - play;
    } else if (this.steerCommand < this.steerAngle - play) {
      this.steerAngle = this.steerCommand + play;
    }

    // Driveline slack and compliance: torque arrives late (DRIVELINE_LAG_S). One
    // pole, so a stab of throttle builds over ~0.3 s instead of hitting the tyres
    // on the same tick the pedal moved.
    const driveBlend = dt / (this.handling.drivelineLag + dt);
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

    // Brake FORCES (N) at the contact, distributed so the total matches the target
    // deceleration. They are demands: the tyre model decides what is delivered, and
    // a demand past what the contact can transmit is what locks the wheel.
    const mass = stats.mass;
    const frontShare = 1 - this.model.rearDriveBias;
    const rearShare = this.model.rearDriveBias;
    const brakeFrontShare = 1 - FOOT_BRAKE_REAR_BIAS;
    const brakeRearShare = FOOT_BRAKE_REAR_BIAS;
    const brakeDenom =
      this.frontWheelCount * brakeFrontShare + this.rearWheelCount * brakeRearShare;

    // Compound first: the pedal's demand is sized against the grip the tyres have,
    // so it has to know which tyres are fitted before it can ask for anything.
    const compound = TYRE_COMPOUNDS[this.tyreCompoundIndex];
    const tyreGrip = compound.grip;

    // Total longitudinal capacity the vehicle is standing on, in newtons: the same
    // per-wheel capacity the tyre model uses in updateWheelDynamics, summed.
    //
    // Both inputs are one step old — `loadN` is the low-passed suspension force from
    // the last step and `groundSurface` was resolved in the last wheel pass — which is
    // 16 ms of lag on a quantity that barely moves (the sum is near mg whatever the
    // car is doing). Reading it here rather than mid-pass keeps ONE demand for the
    // whole vehicle, which is what preserves the brake bias as the thing that decides
    // which axle lets go. Airborne wheels contribute nothing, so a car with its wheels
    // off the ground has no brakes to over-ask with.
    let brakeCapacityN = 0;
    for (const w of this.wheels) {
      if (!w.grounded) continue;
      brakeCapacityN +=
        SURFACES[w.groundSurface].frictionSlip *
        LONGITUDINAL_GRIP_FRACTION *
        stats.wheelGrip *
        tyreGrip *
        w.loadN;
    }
    const footBrakeDemandN = Math.min(
      FOOT_BRAKE_MAX_DECEL * mass,
      FOOT_BRAKE_GRIP_RATIO * brakeCapacityN,
    );
    const footBrakeForce = brakeDenom > 0 ? footBrakeDemandN / brakeDenom : 0;
    const parkingBrakeForce = input.handbrake
      ? (PARK_BRAKE_DECEL * mass) / Math.max(1, this.wheels.length)
      : 0;

    const wheelCount = this.wheels.length;
    const totalDrivenCount = this.frontDrivenCount + this.rearDrivenCount;
    let rollingResistanceSum = 0;
    let roughnessSum = 0;
    let contactCount = 0;
    let drivenContactCount = 0;
    // Same for every wheel. `gripBudgetFactor` sizes Rapier's own cone, which now
    // bounds nothing it applies — its lateral and longitudinal channels are both
    // switched off — but the number is still what the spray and audio read as this
    // tyre's budget, so it keeps its meaning.
    const gripBudgetFactor =
      stats.wheelGrip *
      tyreGrip *
      this.handling.lateralGripFraction *
      Math.pow(GRIP_REFERENCE_MASS / mass, GRIP_MASS_EXPONENT);
    // The real lateral coefficient. Mass-scaled for the same reason the cone was:
    // road tyres are sized to the chassis, not scaled with it, so a laden truck
    // corners worse per kilogram than a hatchback.
    const lateralMu =
      this.handling.lateralMu *
      stats.wheelGrip *
      Math.pow(GRIP_REFERENCE_MASS / mass, GRIP_MASS_EXPONENT);
    // The load μ(Fz) is measured against THIS WHEEL parked: `w.staticLoadN`, from the
    // weight distribution and the axle geometry (see AxleGeometry). It is per-wheel
    // now, which is the point — referencing a front tyre against a quarter of the
    // car's weight told a front-drive hatchback that its nose tyres were permanently
    // overloaded and its rears permanently light, and the load-sensitivity term then
    // handed the grip to the wrong end. A heavier car still gets no free advantage
    // from sitting harder on its tyres; that is what GRIP_MASS_EXPONENT is for.

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
    // The loss is split by axle: the rear sheds REAR_SPEED_LOSS_GAIN times as much
    // of it, so speed does not just cost cornering power, it costs STABILITY.
    const speedLossT = lateralGripT * lateralGripT * (3 - 2 * lateralGripT);
    const lateralGripFront = 1 - this.handling.lateralGripMaxLoss * speedLossT;
    const lateralGripRear = Math.max(
      0.2,
      1 -
        this.handling.lateralGripMaxLoss *
          this.handling.rearSpeedLossGain *
          speedLossT,
    );

    // Slip angles are read off the CONTACT PATCH velocity measured on the previous
    // step (updateWheelDynamics fills `contactVel`/`forwardDir`), so the whole
    // curve costs one dot product and one atan per wheel and no extra ray casts.
    this.chassisBody.rotation(this.rotationScratch);
    let rearSlipMax = 0;

    for (const w of this.wheels) {
      // Surface under this wheel drives traction and rolling resistance. The type is
      // kept alongside its properties because the spray needs the identity, not just
      // the numbers.
      const ground = controller.wheelGroundObject(w.index);
      const surfaceType = this.physics.surfaces.lookupType(ground ? ground.handle : null);
      const surface = SURFACES[surfaceType];

      // A tyre spending its friction budget on stopping or accelerating has none
      // left for cornering (see the friction-circle note above). The rear parking
      // cable still marks the rear wheels locked for tyre visuals and skid audio.
      // Holding force itself is distributed across every wheel below, because a
      // rear-only cable cannot reliably hold the vehicle's mass on this game's
      // steep, uneven roads.
      const handbraked = input.handbrake && !w.isFront;
      // Locked: the parking cable is immediate, because it is a cable pulling shoes
      // onto drums. The foot brake earns its lock from the wheel's own rotation,
      // measured by updateWheelDynamics after the step that delivered the torque.
      //
      // The friction ellipse is NOT applied here. It used to be — a cone reduction
      // computed from last step's longitudinal usage, folded into the constraint gain
      // — but the lateral force is now built in the tyre pass, which applies the
      // ellipse against the force it is computing on the same tick. Leaving it here
      // too charged a tyre twice for one shared budget.
      const locked = handbraked || w.locked;
      const lockGrip = locked ? LOCKED_SIDE_GRIP : 1;
      // The rear axle is a live axle on leaf springs and never had the front's
      // cornering power (REAR_AXLE_SIDE_GRIP).
      const axleGrip = w.isFront ? 1 : this.handling.rearAxleSideGrip;

      // Slip angle of this tyre: the angle between where the contact patch is going
      // and where the wheel is pointing. The wheel's own right-hand direction is the
      // chassis' +X yawed by this wheel's steering angle, so a steered front wheel is
      // measured in ITS plane, not the body's — which is the difference between
      // "the car is sideways" and "the tyre is slipping".
      const steer = this.wheelSteerAngle(w);
      rotateVector(
        this.wheelRightScratch,
        this.rotationScratch,
        Math.cos(steer),
        0,
        -Math.sin(steer),
      );
      const latSpeed =
        w.contactVel.x * this.wheelRightScratch.x +
        w.contactVel.y * this.wheelRightScratch.y +
        w.contactVel.z * this.wheelRightScratch.z;
      const fwdSpeed =
        w.contactVel.x * w.forwardDir.x +
        w.contactVel.y * w.forwardDir.y +
        w.contactVel.z * w.forwardDir.z;
      const slipRad = Math.atan2(
        Math.abs(latSpeed),
        Math.max(Math.abs(fwdSpeed), SLIP_ANGLE_REF_MPS),
      );
      // Relaxation: the carcass follows the geometric angle over a rolling DISTANCE,
      // so the blend is per metre travelled and a parked wheel builds nothing.
      const rollDistance = Math.abs(fwdSpeed) * dt;
      w.slipAngleRad +=
        (slipRad - w.slipAngleRad) *
        (1 - Math.exp(-rollDistance / this.handling.tyreRelaxationLength));
      // The limiter reads the BUILT angle, not the geometric one: countersteer has to
      // respond to the slide the tyres are actually carrying.
      if (!w.isFront && w.grounded) rearSlipMax = Math.max(rearSlipMax, w.slipAngleRad);

      // The side-force CURVE, read at the built angle: rising as a quarter sine to a
      // peak at the axle's peak angle, then fading to its plateau. This is the shape
      // that decides how much slip the car runs, and it is why the number comes out
      // where a period car's does — at 0.7 g a tyre needs 0.7/LATERAL_MU of its peak,
      // which the sine reaches around five degrees.
      const peakDeg = w.isFront
        ? this.handling.slipPeakFrontDeg
        : this.handling.slipPeakRearDeg;
      const fullDeg = w.isFront ? SLIP_FULL_FRONT_DEG : SLIP_FULL_REAR_DEG;
      const plateau = w.isFront ? SLIP_PLATEAU_FRONT : SLIP_PLATEAU_REAR;
      const slipDeg = (w.slipAngleRad * 180) / Math.PI;
      const fadeT = clamp((slipDeg - peakDeg) / (fullDeg - peakDeg), 0, 1);
      const risen =
        Math.tanh(SLIP_CURVE_SHARPNESS * Math.min(slipDeg / peakDeg, 1)) / TANH_SHARPNESS;
      const shape = risen * (1 - (1 - plateau) * fadeT * fadeT * (3 - 2 * fadeT));

      // μ(Fz). Exactly 1 at this wheel's static share of the car's weight, so the
      // calibrated straight-line figures stand and only TRANSFER changes anything.
      const loadFactor = clamp(
        1 - LOAD_SENSITIVITY * (w.loadN / w.staticLoadN - 1),
        LOAD_SENSITIVITY_MIN,
        LOAD_SENSITIVITY_MAX,
      );

      const frictionSlip = surface.frictionSlip * gripBudgetFactor * loadFactor;
      controller.setWheelFrictionSlip(w.index, frictionSlip);
      // ZERO. Rapier's lateral channel is a velocity-cancelling constraint scaled by
      // this gain, and a constraint is a ceiling with no curve under it: side force
      // rose linearly with slip until it hit the cone, so the car ran 1.2-1.4 degrees
      // of slip at the limit where the model's own constants say 4-6. Everything the
      // authored pipeline used to feed into this gain now sizes a real force below.
      controller.setWheelSideFrictionStiffness(w.index, 0);
      w.lateralCapacityN =
        lateralMu *
        surface.sideFriction *
        compound.side *
        (w.isFront ? lateralGripFront : lateralGripRear) *
        axleGrip *
        lockGrip *
        loadFactor *
        w.loadN;
      w.lateralShape = shape;
      w.lateralRightX = this.wheelRightScratch.x;
      w.lateralRightY = this.wheelRightScratch.y;
      w.lateralRightZ = this.wheelRightScratch.z;
      w.lateralSpeed = latSpeed;

      // THE GROUND THE COLLIDER DOES NOT HAVE.
      //
      // Two fields, both sampled at the wheel's own ABSOLUTE contact position so the
      // same ripple is under the same patch of world for every car and across every
      // floating-origin rebase:
      //
      //   microRelief  the desert's own wind-blown corrugation, centimetres, with a
      //                grain: crossing it hammers and running with it settles.
      //   hummock      the 3-6 m band under the terrain heightfield's own 3 m cells:
      //                the long swell a car HEAVES on once it leaves the asphalt, as
      //                opposed to the buzz above. Loose surfaces only.
      //   texture      what a SEALED surface has instead — millimetres of chip and
      //                crack, isotropic, and the reason a road is not glass. Asphalt
      //                used to have exactly zero of this, which is why a smooth
      //                stretch reported no road feel at all: the collider's own rows
      //                are 1.33 m apart and there was nothing between them.
      //
      // The sum is then ENVELOPED over the contact patch. A tyre stands on 160 mm of
      // road and cannot see anything shorter, so the filter is a low-pass over
      // DISTANCE TRAVELLED, not over time: the same ripple is equally sharp at 40 and
      // at 100 km/h, and detail below the patch length is attenuated at both.
      const profileTarget =
        ground && w.grounded
          ? surface.microRelief *
              this.microRelief.at(
                w.contactPoint.x + this.origin.x,
                w.contactPoint.z + this.origin.z,
              ) +
            surface.hummock *
              this.microRelief.hummockAt(
                w.contactPoint.x + this.origin.x,
                w.contactPoint.z + this.origin.z,
              ) +
            surface.texture *
              this.roadTexture.at(
                w.contactPoint.x + this.origin.x,
                w.contactPoint.z + this.origin.z,
              )
          : 0;
      const rolled = Math.abs(fwdSpeed) * dt;
      const envelope = 1 - Math.exp(-rolled / CONTACT_PATCH_M);
      const beforeProfile = w.profileHeight;
      w.profileHeight += (profileTarget - w.profileHeight) * envelope;
      w.profileRate = w.grounded ? (w.profileHeight - beforeProfile) / dt : 0;

      const axleShare = w.isFront ? frontShare : rearShare;
      const axleCount = w.isFront ? this.frontDrivenCount : this.rearDrivenCount;
      const driven = axleShare > 0 && axleCount > 0;

      // Rapier applies NO longitudinal force any more: both of its channels are
      // zeroed and the tyre model in updateWheelDynamics owns drive and brake. Its
      // engine-force path could never brake and drive the same wheel anyway (a
      // Bullet port: any non-zero engine force skips the braking branch outright),
      // and its cone only ever scaled force down — it could not represent a tyre
      // past its peak, which is exactly what a locked or spinning one is.
      let brakeForce = brake > 0 ? brake * footBrakeForce * (w.isFront ? brakeFrontShare : brakeRearShare) : 0;
      // A latched parking cable takes precedence across every wheel: it is strong
      // enough to hold the car on this road network's grades.
      if (input.handbrake) brakeForce = parkingBrakeForce;

      controller.setWheelBrake(w.index, 0);
      controller.setWheelEngineForce(w.index, 0);

      w.driveTorqueNm = driven ? (appliedTorque * axleShare) / axleCount : 0;
      w.brakeForceN = brakeForce;
      w.frictionSlip = frictionSlip;
      w.groundSurface = surfaceType;
      w.grounded = ground !== null;

      controller.setWheelSteering(w.index, this.wheelSteerAngle(w));

      if (ground) {
        contactCount++;
        rollingResistanceSum += surface.rollingResistance;
        roughnessSum += surface.roughness;
        if (driven) drivenContactCount++;
      }
    }
    // Handed to next step's steering limiter (see the countersteer note above).
    this.rearSlipRad = rearSlipMax;

    controller.updateVehicle(dt);

    // Wheel rotation, before the telemetry pass that reads it: each wheel is
    // integrated from its own drive and brake torque against what its contact can
    // actually transmit, so lock-up and wheelspin are outcomes, not timers.
    //
    // One pass is deliberately omitted after a floating-origin rebase; see
    // `skipTyreDynamicsSteps`. `longitudinalForceSum` must be cleared on that path or
    // anti-pitch would reuse the previous tick's force even though no tyre force was
    // applied this tick.
    if (this.skipTyreDynamicsSteps > 0) {
      this.skipTyreDynamicsSteps--;
      this.longitudinalForceSum = 0;
      this.ownTyreCapacityN = 0;
      // No tyre pass ran, so no aligning moment was earned. Leaving a stale one would
      // apply the previous tick's yaw damping to a step that had no tyre forces at all.
      this.alignTorqueImpulse = 0;
    } else {
      this.updateWheelDynamics(dt, stats.wheelGrip, tyreGrip, fwd);
    }
    this.refreshWheelSpray(fwd);

    // Each grounded wheel contributes its travelled tyre-track on its reported
    // surface. A spinning or sliding contact carries more loose material up the
    // body than a rolling one, hence the bounded slip multiplier in the scale above.
    const wheelDistance = Math.abs(fwd) * dt;
    let dirtGain = 0;
    for (const w of this.wheels) {
      if (!w.grounded) continue;
      dirtGain +=
        (wheelDistance *
          SURFACES[w.groundSurface].dust *
          (1 + clamp(Math.abs(w.slipRatio), 0, 2) + w.slideT)) /
        BODY_DIRT_TYRE_METRES_TO_FULL;
    }
    if (dirtGain > 0) {
      this.localBodyDirt = clamp(this.localBodyDirt + dirtGain, 0, 1);
      bodyConditionChanged = true;
    }

    // Slide, lock and the friction-circle usage that costs a working tyre its side
    // grip are all computed inside updateWheelDynamics now, from the tyre's own
    // force against its own capacity. Rapier's forward impulse used to stand in for
    // that, and with its longitudinal channel zeroed it reads zero. What is left
    // here is the per-axle mean the audio layer voices.
    let frontSlideSum = 0;
    let rearSlideSum = 0;
    const speedAbs = Math.abs(fwd);
    for (const w of this.wheels) {
      // A locked wheel is sliding by definition; no need to infer it from the cone.
      const reported = w.locked && speedAbs > SLIDE_MIN_MPS ? 1 : w.slideT;
      if (w.isFront) frontSlideSum += reported;
      else rearSlideSum += reported;
    }
    this.audioState.frontLockT =
      this.frontWheelCount > 0 ? frontSlideSum / this.frontWheelCount : 0;
    this.audioState.rearLockT = this.rearWheelCount > 0 ? rearSlideSum / this.rearWheelCount : 0;

    this.applyAntiRollBars(dt);
    this.applyRollCouple(dt, mass, contactCount);
    this.applyAntiPitch(dt, contactCount);

    // Rolling resistance (∝ weight) + quadratic aerodynamic drag, opposing
    // horizontal motion. Drag always applies; rolling resistance fades with the
    // fraction of wheels still on the ground.
    //
    // This MUST be an impulse, not `addForce`: Rapier's force accumulator is
    // persistent — a force added here would be re-applied on every subsequent step
    // until `resetForces`, so adding one per tick accumulates without bound and
    // strangles the car to a standstill within a couple of seconds.
    this.ownDragRollingDeltaMps = 0;
    this.chassisBody.linvel(this.linvel);
    const hSpeedSq = this.linvel.x * this.linvel.x + this.linvel.z * this.linvel.z;
    const hSpeed = Math.sqrt(hSpeedSq);
    if (hSpeed > 0.01) {
      let retarding = this.dragCoeff * hSpeedSq;
      if (contactCount > 0 && wheelCount > 0) {
        const rr = rollingResistanceSum / contactCount;
        retarding += rr * mass * GRAVITY * (contactCount / wheelCount);
      }
      const dragRollingForce = retarding;

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
      this.ownDragRollingDeltaMps = Math.min(dragRollingForce * dt, impulse) / mass;
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
    // Same number a coupled trailer's brakes follow (see vehicle/trailer.ts). It is
    // the SERVICE brake only: the handbrake is the driver's own parking decision
    // and does not reach down the drawbar.
    this.serviceBrakeCommand = brake;
    audio.handbrake = input.handbrake;
    audio.forwardMps = fwd;
    audio.engineRunning = this.engineRunning;
    audio.engineDestroyed = this.engineDestroyed;
    audio.gearLabel = this.drivetrain.gearLabel;
    audio.wheelContactFraction = wheelCount > 0 ? contactCount / wheelCount : 0;
    audio.surfaceRoughness = contactCount > 0 ? roughnessSum / contactCount : 0;
    audio.lateralSlipMps = Math.abs(this.localVelScratch.x);
    const vy = this.linvel.y;
    audio.landingImpactMps =
      contactCount > 0 ? Math.max(0, -this.prevVerticalVel - Math.max(0, -vy)) : 0;
    this.prevVerticalVel = vy;

    // What hit the car, derived rather than asked for: Rapier has no event queue here
    // (see core/physics.ts), and the vertical channel above already shows that a
    // velocity delta across one solve is a usable signal.
    //
    // HORIZONTAL ONLY, and that is the load-bearing decision. A suspension absorbing
    // a landing puts several m/s of legitimate vertical delta through the chassis
    // that no tyre or drag term explains, so including Y reported every touchdown as
    // a crash — measured: an ordinary drop scratched the paint. Collisions with rocks,
    // walls and other cars are horizontal; potholes and landings are vertical and
    // belong to `landingImpactMps`. Gravity leaves the equation with the same stroke.
    //
    // The allowance is what the car itself could have done: every contacting tyre's
    // full longitudinal capacity plus the drag and rolling-resistance impulse actually
    // applied. On asphalt that is around 0.17 m/s a step, so hard cornering (Rapier's
    // lateral constraint, ~0.15 m/s a step at 0.9 g) stays under it and a shunt does
    // not.
    if (this.impactVelocityPrimed && this.previousStepContactCount > 0 && contactCount > 0) {
      const deltaX = this.stepStartLinvel.x - this.previousStepLinvel.x;
      const deltaZ = this.stepStartLinvel.z - this.previousStepLinvel.z;
      const deltaMps = Math.hypot(deltaX, deltaZ);
      const ownDeltaMps =
        (this.previousOwnTyreCapacityN * dt) / mass + this.previousOwnDragRollingDeltaMps;
      const severityMps = deltaMps - ownDeltaMps - IMPACT_UNEXPLAINED_FLOOR_MPS;
      if (severityMps > 0 && deltaMps > 1e-4) {
        this.chassisBody.rotation(this.rotationScratch);
        this.invRotationScratch.x = -this.rotationScratch.x;
        this.invRotationScratch.y = -this.rotationScratch.y;
        this.invRotationScratch.z = -this.rotationScratch.z;
        this.invRotationScratch.w = this.rotationScratch.w;
        // The blow came FROM the direction the velocity change points away from.
        rotateVector(
          this.localVelScratch,
          this.invRotationScratch,
          -deltaX / deltaMps,
          0,
          -deltaZ / deltaMps,
        );
        this.impactState.severityMps = severityMps;
        this.impactState.localX = this.localVelScratch.x;
        this.impactState.localY = this.localVelScratch.y;
        this.impactState.localZ = this.localVelScratch.z;
        this.impactThisStep = true;

        // Above 2.5 m/s, 0.025 per unexplained m/s reaches 0.12 at 7.3 m/s;
        // capping there keeps even a high-speed single crash below a full repaint.
        const scratchGain = Math.min(
          SCRATCH_PER_IMPACT_CAP,
          Math.max(0, severityMps - SCRATCH_IMPACT_THRESHOLD_MPS) *
            SCRATCH_PER_SEVERITY_MPS,
        );
        if (scratchGain > 0) {
          this.localBodyScratches = clamp(this.localBodyScratches + scratchGain, 0, 1);
          bodyConditionChanged = true;
        }
      }
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

    if (bodyConditionChanged) this.bodyConditionEmitTimer += dt;
    if (
      this.bodyConditionEmitTimer >= BODY_CONDITION_EMIT_INTERVAL &&
      (this.localBodyDirt !== this.car.dirt || this.localBodyScratches !== this.car.scratches)
    ) {
      this.bodyConditionEmitTimer = 0;
      this.lastAuthBodyDirt = this.localBodyDirt;
      this.lastAuthBodyScratches = this.localBodyScratches;
      this.world.apply({
        t: 'car_body_condition',
        carId: this.car.id,
        dirt: this.localBodyDirt,
        scratches: this.localBodyScratches,
      });
    }

    // Cache before the next Rapier solve; fixedUpdate is the controller half of the
    // fixed step, and the following call begins after physics has advanced the body.
    //
    // `previousStepLinvel` is read AFTER this method's own impulses (drag, rolling
    // resistance, the tyre forces) have gone in, so the delta the next step measures
    // is exactly what the SOLVER did: gravity, contacts, and Rapier's lateral
    // constraint. That is the only quantity a collision can hide in.
    this.previousOwnTyreCapacityN = this.ownTyreCapacityN;
    this.previousOwnDragRollingDeltaMps = this.ownDragRollingDeltaMps;
    this.chassisBody.linvel(this.previousStepLinvel);
    this.previousStepContactCount = contactCount;
    this.impactVelocityPrimed = true;

    // Transform deltas, a few times per second.
    this.transformEmitTimer += dt;
    if (this.transformEmitTimer >= TRANSFORM_EMIT_INTERVAL) this.pushTransform();
    this.advanceIndicator(dt);
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
   * Shifts every relative position this car caches across steps when the floating
   * origin moves: the parking-hold latch and the interpolation snapshots. Without
   * this the renderer lerps the chassis across the whole origin step for one frame,
   * and a held car snaps a kilometre sideways the next `postStep`.
   */
  rebase(shift: RebaseShift): void {
    this.parkingHoldPos.x -= shift.dx;
    this.parkingHoldPos.z -= shift.dz;
    this.prevPos.x -= shift.dx;
    this.prevPos.z -= shift.dz;
    this.stepPos.x -= shift.dx;
    this.stepPos.z -= shift.dz;
    // The wheel contact scratch is in the same relative world frame as the chassis.
    // Shift the last good value for spray telemetry, then omit the first custom tyre
    // pass while Rapier refreshes its own internal copy (see the field comment).
    for (const wheel of this.wheels) {
      wheel.contactPoint.x -= shift.dx;
      wheel.contactPoint.z -= shift.dz;
    }
    this.skipTyreDynamicsSteps = Math.max(this.skipTyreDynamicsSteps, 1);
  }

  /**
   * Places the chassis upright and at rest at a world position. For the
   * fall-out-of-world rescue only: velocities are cleared so the car does not
   * arrive carrying the speed of its fall, and the interpolation snapshots are
   * re-primed so the renderer does not draw a streak from wherever it fell to.
   */
  rescueTo(x: number, y: number, z: number, heading: number): void {
    // x/z arrive absolute (road.sampleAt); Rapier holds relative positions.
    this.chassisBody.setTranslation({ x: x - this.origin.x, y, z: z - this.origin.z }, true);
    this.chassisBody.setRotation(
      { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) },
      true,
    );
    this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) {
      w.spinRadS = 0;
      w.slipRatio = 0;
      w.locked = false;
    }
    this.impactVelocityPrimed = false;
    // Release the parking hold, or this does nothing at all on a car nobody is
    // driving: `postStep` re-teleports a held chassis to `parkingHoldPos` every
    // step, so the move would be silently undone one tick later. Clearing the flag
    // makes the next `postStep` re-latch the hold at wherever we just put it.
    this.parkingHoldActive = false;
    this.snapshotPrimed = false;
  }

  syncVisuals(alpha: number): void {
    const controller = this.controller;
    if (!controller) return;

    this.interpolatedTransform(alpha, this.pos, this.quat);
    this.rootGroup.position.copy(this.pos);
    this.rootGroup.quaternion.copy(this.quat);

    this.applyRearLightState();

    // Wheels are chassis-local: suspension travel and spin are small, smooth and
    // already snapped to the same step, so they need no second interpolation.
    for (const w of this.wheels) {
      const cp = controller.wheelChassisConnectionPointCs(w.index, w.scratchCp);
      const susp = controller.wheelSuspensionLength(w.index);
      const steer = controller.wheelSteering(w.index);
      if (cp) w.mesh.position.set(cp.x, cp.y - (susp ?? 0), cp.z);
      w.mesh.rotation.set(w.drawnSpin % TWO_PI, steer ?? 0, 0);
    }

    // The rim follows the steering-box command, before rack backlash: the driver
    // turns the wheel even while play delays the tyres. Every model reaches the same
    // authored 970-degree lock-to-lock rim travel despite different tyre locks.
    //
    // Sign: `steerCommand` is positive to the LEFT, and the wheel's own axis (its
    // node's local Y, before the rake in the same Euler) points back at the driver,
    // so a positive rotation about it turns the rim anticlockwise as the driver sees
    // it — left. The two agree, so the angle is added, not negated.
    if (this.steeringWheel) {
      this.steeringWheel.rotation.y =
        this.steeringWheelRest +
        (this.steerCommand / this.model.steerLock) * STEERING_WHEEL_HALF_LOCK_RAD;
    }

    // Gizmos are bolted to the shell: they never move relative to it, so all they
    // need per frame is their condition, which a scrubbing player can change.
    for (const g of this.gizmos) setPartCondition(g.mesh, g.part);
  }

  /**
   * True while any lamp on this vehicle is emitting. Lets the caller skip dark
   * vehicles entirely and order the lit ones before they claim rig slots.
   */
  get hasLitLamps(): boolean {
    return (
      (this.headlightMode !== 'off' && this.headlightEnvironmentFactor > 0) ||
      this.taillightBeamIntensity > 0 ||
      this.reverseLightBeamIntensity > 0
    );
  }

  /**
   * Offers this vehicle's LIT lamps to the shared rig, projected from local mounts
   * through the interpolated render pose. Called for every live vehicle, not just
   * the driven one: a lamp that is on casts a beam whoever left it on, so a
   * restored save and a car abandoned with its headlights burning both light the
   * ground. Dark lamps are offered nothing and cost no slot.
   */
  syncProjectedLights(rig: VehicleLightRig): void {
    const headlightBeam = this.headlightMode === 'high' ? HEADLIGHT_HIGH : HEADLIGHT_LOW;
    const headlightIntensity =
      this.headlightMode === 'off' ? 0 : headlightBeam.intensity * this.headlightEnvironmentFactor;
    for (let i = 0; i < 2; i++) {
      this.projectBeam(
        rig,
        this.headlightMounts[i],
        HEADLIGHT_EMISSIVE,
        headlightIntensity,
        headlightBeam,
      );
      this.projectBeam(
        rig,
        this.taillightMounts[i],
        TAILLIGHT_EMISSIVE,
        this.taillightBeamIntensity,
        TAILLIGHT_BEAM,
      );
      this.projectBeam(
        rig,
        this.reverseLightMounts[i],
        REVERSE_LIGHT_EMISSIVE,
        this.reverseLightBeamIntensity,
        REVERSE_LIGHT_BEAM,
      );
    }
  }

  private projectBeam(
    rig: VehicleLightRig,
    mount: VehicleBeamMount | undefined,
    color: THREE.ColorRepresentation,
    intensity: number,
    shape: ProjectedBeamShape,
  ): void {
    if (!mount || !(intensity > 0)) return;
    const sourceWorld = this.projectedLightSource
      .copy(mount.sourceLocal)
      .applyQuaternion(this.rootGroup.quaternion)
      .add(this.rootGroup.position);
    const targetWorld = this.projectedLightTarget
      .copy(mount.aimLocal)
      .applyQuaternion(this.rootGroup.quaternion)
      .add(this.rootGroup.position);
    rig.addBeam(
      sourceWorld,
      targetWorld,
      color,
      intensity,
      shape.distance,
      shape.angle,
      shape.penumbra,
      shape.decay,
    );
  }

  /**
   * Wheel rotational dynamics: the state whose absence made lock-up a timer.
   *
   * The tyre owns longitudinal force. Drive torque spins the wheel up, brake torque
   * slows it (never past a standstill), and the contact makes a force from the SLIP
   * that results — peaking at PEAK_SLIP_RATIO and decaying past it, so a locked or
   * spinning tyre transmits less than one held at optimal slip. That force is what
   * accelerates and stops the car: it is applied to the chassis at the contact
   * point, which also gives the pitch couple (dive and squat) for free.
   *
   * The wheel's own equation is solved with the contact force linearised and taken
   * implicitly. It has to be: at 60 Hz the explicit gain is ~20-50, so an explicit
   * step oscillates and then explodes.
   */
  private updateWheelDynamics(
    dt: number,
    wheelGrip: number,
    tyreGrip: number,
    vehicleForwardSpeed: number,
  ): void {
    const controller = this.controller;
    if (!controller || dt <= 0) return;
    this.longitudinalForceSum = 0;
    this.ownTyreCapacityN = 0;

    this.chassisBody.rotation(this.rotationScratch);
    const loadBlend = dt / (WHEEL_LOAD_TAU + dt);
    // Grip leaves slowly and comes back quickly: see SLIDE_ONSET_TAU.
    const slideOnsetBlend = dt / (SLIDE_ONSET_TAU + dt);
    const slideRecoverBlend = dt / (SLIDE_RECOVER_TAU + dt);
    const tcsAttackBlend = dt / (TCS_ATTACK_TAU + dt);
    const tcsReleaseBlend = dt / (TCS_RELEASE_TAU + dt);
    this.tcsLampS = Math.max(0, this.tcsLampS - dt);

    const spinCeiling = this.drivetrain.maxDrivenWheelSpinRadS;
    // The crank and flywheel a driven wheel has to drag round with it, geared up by
    // the square of the ratio. See `Drivetrain.drivenWheelInertiaKgM2`: without it a
    // driven wheel is a bare disc and every dip in load is an instant wheelspin.
    const drivelineInertia = this.drivetrain.drivenWheelInertiaKgM2(
      this.frontDrivenCount + this.rearDrivenCount,
    );
    // Each wheel's own parked load (`w.staticLoadN`, set in `rebuild`) is the reference
    // both the μ(Fz) factor and the traction-control load gate are measured against.
    // It varies across the axles, because the weight does.

    for (const w of this.wheels) {
      const driven = w.isFront ? this.frontDrivenCount > 0 : this.rearDrivenCount > 0;
      const steer = controller.wheelSteering(w.index) ?? 0;
      // Wheel-plane forward: chassis +Z yawed by the steering angle — the same
      // basis the wheel mesh is drawn in — taken into world space.
      rotateVector(w.forwardDir, this.rotationScratch, Math.sin(steer), 0, Math.cos(steer));

      const inContact = controller.wheelIsInContact(w.index);
      let contactSpeed = 0;
      if (inContact) {
        // The rolling direction is the wheel plane projected onto the surface. On
        // flat ground this is unchanged. On a steep pothole wall it gains the
        // vertical component the contact patch actually travels along, preventing
        // both slip and TCS from being measured in the wrong plane.
        const normal = controller.wheelContactNormal(w.index, w.contactNormal);
        if (normal) {
          const normalComponent =
            w.forwardDir.x * normal.x +
            w.forwardDir.y * normal.y +
            w.forwardDir.z * normal.z;
          const tangentX = w.forwardDir.x - normal.x * normalComponent;
          const tangentY = w.forwardDir.y - normal.y * normalComponent;
          const tangentZ = w.forwardDir.z - normal.z * normalComponent;
          const tangentLength = Math.hypot(tangentX, tangentY, tangentZ);
          if (tangentLength > 1e-4) {
            w.forwardDir.x = tangentX / tangentLength;
            w.forwardDir.y = tangentY / tangentLength;
            w.forwardDir.z = tangentZ / tangentLength;
          }
        }
        const cp = controller.wheelContactPoint(w.index, w.contactPoint);
        if (cp) {
          this.chassisBody.velocityAtPoint(cp, w.contactVel);
          contactSpeed =
            w.contactVel.x * w.forwardDir.x +
            w.contactVel.y * w.forwardDir.y +
            w.contactVel.z * w.forwardDir.z;
        }
      }

      // Ray-cast suspension load spikes over trimesh seams, so it is low-passed
      // before it is allowed to size a friction budget.
      const rawLoad = inContact ? Math.max(0, controller.wheelSuspensionForce(w.index) ?? 0) : 0;
      w.loadN += (rawLoad - w.loadN) * loadBlend;

      // A wheel is a disc, and a bigger wheel is a heavier one: mass scales with
      // radius², inertia with mass·radius². A DRIVEN wheel also has to turn the
      // engine, which through the gears is the larger half of the total in the low
      // gears — and the reason a bump cannot flick it into a spin.
      const wheelMass = WHEEL_MASS_KG * (w.radius / WHEEL_REFERENCE_RADIUS) ** 2;
      const inertia = 0.5 * wheelMass * w.radius * w.radius + (driven ? drivelineInertia : 0);

      // Traction control, measured from this wheel's OWN pre-step slip SPEED: how
      // much faster its contact patch is moving than the road, in m/s. Signed by the
      // commanded torque, which is what keeps this a traction aid and not an
      // accidental ABS — a wheel locking under the brakes slips the other way
      // relative to its drive torque and is left alone.
      //
      // The allowance is the larger of a fixed floor and the tyre model's own peak
      // slip at this contact's road speed. Authority is intentionally based on the
      // chassis' forward speed instead: angular motion over a sharp pothole can make
      // one contact point almost stationary, but it must not switch TCS off while the
      // vehicle itself is moving.
      const slipSpeed =
        (w.spinRadS * w.radius - contactSpeed) * (w.driveTorqueNm >= 0 ? 1 : -1);
      const allowance = Math.max(
        TCS_SLIP_FLOOR_MPS,
        PEAK_SLIP_RATIO * Math.abs(contactSpeed),
      );
      // Two authority paths, whichever grants more: road speed, and slip speed alone.
      // The second is what rescues a climb — see the note on TCS_STUCK_SLIP_MPS.
      const speedAuthority =
        (Math.abs(vehicleForwardSpeed) - TCS_AUTHORITY_START_MPS) /
        (TCS_AUTHORITY_FULL_MPS - TCS_AUTHORITY_START_MPS);
      const stuckAuthority = (slipSpeed - TCS_STUCK_SLIP_MPS) / TCS_STUCK_BAND_MPS;
      // AND WHETHER THE TYRE IS CARRYING ANYTHING. `inContact` is Rapier's ray hit; it
      // stays true over a crest or a pothole rim while the spring is extended and the
      // load has gone. A wheel with no load on it is not losing traction, it is simply
      // not being asked for any — and the sand note in core/surfaces.ts already says
      // what follows: traction control only stops a wheel WASTING force it could make,
      // and there is nothing to un-waste when the normal load is missing. Cutting there
      // lights the lamp and throws away the drive without buying a newton of grip.
      const loadAuthority = w.loadN / (w.staticLoadN * TCS_LOAD_AUTHORITY_FRACTION);
      const authority =
        clamp(Math.max(speedAuthority, stuckAuthority), 0, 1) * clamp(loadAuthority, 0, 1);
      const cutTarget =
        driven && inContact && w.driveTorqueNm !== 0
          ? Math.min(1, Math.max(0, slipSpeed - allowance) / TCS_SLIP_BAND_MPS) *
            TCS_MAX_CUT *
            authority
          : 0;
      w.tcsCut +=
        (cutTarget - w.tcsCut) * (cutTarget > w.tcsCut ? tcsAttackBlend : tcsReleaseBlend);
      if (w.tcsCut > TCS_LAMP_THRESHOLD) this.tcsLampS = TCS_LAMP_HOLD_S;

      let spin = w.spinRadS + (dt * w.driveTorqueNm * (1 - w.tcsCut)) / inertia;

      const brakeDelta = (dt * w.brakeForceN * w.radius) / inertia;
      if (Math.abs(spin) <= brakeDelta) spin = 0;
      else spin -= Math.sign(spin) * brakeDelta;

      let longitudinalForce = 0;
      let gripUsage = 0;
      if (w.loadN > 0) {
        const ground = controller.wheelGroundObject(w.index);
        const surface = this.physics.surfaces.lookup(ground ? ground.handle : null);
        // μ(Fz) again, and it MUST be the same factor the lateral channel uses or the
        // two axes would disagree about how much grip this tyre has. Reference load is
        // this wheel's own parked load, so a car standing still is exactly as it was.
        const loadFactor = clamp(
          1 - LOAD_SENSITIVITY * (w.loadN / w.staticLoadN - 1),
          LOAD_SENSITIVITY_MIN,
          LOAD_SENSITIVITY_MAX,
        );
        const capacityN =
          surface.frictionSlip *
          LONGITUDINAL_GRIP_FRACTION *
          wheelGrip *
          tyreGrip *
          loadFactor *
          w.loadN;
        if (inContact) this.ownTyreCapacityN += capacityN;
        const reference = Math.max(Math.abs(contactSpeed), SLIP_REFERENCE_MPS);

        // Shape: a peak that decays to a SLIDING PLATEAU, not to nothing.
        //
        // The first version was the tidy 2u/(1+u²), which decays like 1/u. Measured,
        // that car could not pull away at all (0 km/h after 20 s of full throttle): a
        // standing start runs slip ≈ 3, i.e. u ≈ 25, where that curve delivers 8% of
        // the tyre's grip. A sliding tyre keeps roughly three quarters of its peak,
        // so the plateau term carries the force once the peak term has decayed.
        const slipOf = (omega: number): number => (omega * w.radius - contactSpeed) / reference;
        const forceOf = (slip: number): number => {
          const u = slip / PEAK_SLIP_RATIO;
          const peak = (2 * u) / (1 + u * u);
          const slide = Math.tanh(SLIDE_CURVE_GAIN * u);
          return capacityN * ((1 - SLIDING_GRIP_FRACTION) * peak + SLIDING_GRIP_FRACTION * slide);
        };

        // Damping uses the curve's own slope, clamped to the rising side: past the
        // peak it goes negative, and feeding that back drives the wheel away from
        // equilibrium instead of toward it.
        const u0 = slipOf(spin) / PEAK_SLIP_RATIO;
        const th = Math.tanh(SLIDE_CURVE_GAIN * u0);
        const slopeU =
          (1 - SLIDING_GRIP_FRACTION) * ((2 * (1 - u0 * u0)) / ((1 + u0 * u0) * (1 + u0 * u0))) +
          SLIDING_GRIP_FRACTION * SLIDE_CURVE_GAIN * (1 - th * th);
        const stiffness =
          (capacityN * Math.max(0, slopeU) * w.radius) / (PEAK_SLIP_RATIO * reference);

        const spin0 = spin;
        const force0 = forceOf(slipOf(spin0));
        let delta = -(dt * force0 * w.radius) / (inertia + dt * stiffness * w.radius);

        // Friction reduces sliding; it never reverses it within one step. Without
        // this projection the wheel shot straight past synchronous speed every tick
        // — once the tyre is past its peak the damping slope is zero, so nothing held
        // the step back — and the force alternated sign from tick to tick. Measured
        // like that: 23.8 km/h after twenty seconds of full throttle, and 0.06 g of
        // braking.
        const toSync = contactSpeed / w.radius - spin0;
        delta =
          delta >= 0 ? Math.min(delta, Math.max(0, toSync)) : Math.max(delta, Math.min(0, toSync));

        // Read the force back OUT of the wheel's actual change: whatever torque the
        // contact took from the wheel is what the tyre put into the road. That keeps
        // action and reaction equal on the step the projection binds — which is
        // exactly the step where a gripping tyre is transmitting everything the
        // engine sent it, and where deriving the force from the post-step slip would
        // instead report zero.
        longitudinalForce = clamp((-inertia * delta) / (dt * w.radius), -capacityN, capacityN);
        spin = spin0 - (longitudinalForce * dt * w.radius) / inertia;
        gripUsage = Math.abs(longitudinalForce) / capacityN;
      }

      // Geared to the engine, so it cannot outrun the engine's redline.
      if (driven && spinCeiling !== Infinity) spin = clamp(spin, -spinCeiling, spinCeiling);

      w.spinRadS = spin;
      w.drawnSpin += spin * dt;
      // The next step's friction ellipse reads this. Published raw: the ellipse is a
      // force trade, and lagging it here would put a time constant back into the one
      // relationship that should be instantaneous.
      w.gripUsage = gripUsage;

      const reference = Math.max(Math.abs(contactSpeed), SLIP_REFERENCE_MPS);
      w.slipRatio = (spin * w.radius - contactSpeed) / reference;
      // Only a moving car can have a locked wheel; a stopped one is just stopped.
      w.locked = Math.abs(contactSpeed) > SLIDE_MIN_MPS && w.slipRatio <= LOCK_SLIP_RATIO;

      // Drive the chassis with it, at the contact patch. Applying it there is what
      // produces the pitch couple (dive and squat) for free — and, because Rapier has
      // no suspension geometry to react any of it, produces ALL of it. `applyAntiPitch`
      // below takes back the share real links would have carried, so the running total
      // is accumulated here rather than recomputed from the pedals.
      if (longitudinalForce !== 0) {
        const impulse = longitudinalForce * dt;
        this.tyreImpulse.x = w.forwardDir.x * impulse;
        this.tyreImpulse.y = w.forwardDir.y * impulse;
        this.tyreImpulse.z = w.forwardDir.z * impulse;
        this.chassisBody.applyImpulseAtPoint(this.tyreImpulse, w.contactPoint, false);
        this.longitudinalForceSum += longitudinalForce;
      }

      // LATERAL FORCE, ours now. Three things decide it: the capacity the setup pass
      // sized from load and surface, the slip-angle curve read at the BUILT angle, and
      // what the longitudinal channel has left over — a real friction ellipse on this
      // tyre's own usage, so drive and brake take their share of one budget.
      //
      // The ellipse keeps SLIDE_SIDE_GRIP as a floor. A tyre that has spent everything
      // on stopping does not become a castor: that floor IS catchability (see the
      // constant), and it is the one place the shape is deliberately not the physics.
      //
      // Applied at the contact patch's POSITION but at the centre of mass' HEIGHT, and
      // that is deliberate. The yaw geometry is what matters for balance and it is
      // exact either way; the roll lever is not, because this suspension has almost no
      // roll stiffness of its own — measured, the full moment at the patch rolled a
      // 33 km/h turn to 81 degrees and laid the car on its side. Roll therefore stays
      // with the calibrated couple in `applyRollCouple`, which exists for exactly this
      // reason and is now the only thing supplying it.
      if (inContact && w.lateralCapacityN > 0) {
        const ellipse = Math.max(
          SLIDE_SIDE_GRIP,
          Math.sqrt(Math.max(0, 1 - gripUsage * gripUsage)),
        );
        const capacityImpulse = w.lateralCapacityN * ellipse * dt;
        const curveImpulse = capacityImpulse * w.lateralShape;
        // Friction opposes the slip and never reverses it inside one step: cap the
        // impulse at what brings this contact's sideways speed exactly to zero, with
        // the wheel's share of the mass taken from the load it is carrying. Without
        // that cap a stiff tyre at 60 Hz overshoots and the car shivers on its axles.
        const shareMass = w.loadN / GRAVITY;
        const stopImpulse = Math.abs(w.lateralSpeed) * shareMass;
        // STATIC HOLD. A slip-angle curve is a rolling tyre's law, and a car at
        // walking pace is not rolling enough to have one: the angle collapses, the
        // curve asks for almost nothing, and the car creeps sideways down a camber —
        // which Rapier's velocity-cancelling constraint used to prevent for free.
        // Below LATERAL_STATIC_SPEED_MPS the tyre is therefore allowed to spend its
        // whole remaining capacity on simply stopping the slide, which is what static
        // friction does. It is still bounded by that capacity, so a hard enough shove
        // still slides the car.
        const staticBlend = clamp(1 - Math.abs(contactSpeed) / LATERAL_STATIC_SPEED_MPS, 0, 1);
        const staticImpulse = Math.min(capacityImpulse, stopImpulse) * staticBlend;
        const magnitude = Math.min(stopImpulse, Math.max(curveImpulse, staticImpulse));
        const impulse = -Math.sign(w.lateralSpeed) * magnitude;
        if (impulse !== 0) {
          this.tyreImpulse.x = w.lateralRightX * impulse;
          this.tyreImpulse.y = w.lateralRightY * impulse;
          this.tyreImpulse.z = w.lateralRightZ * impulse;
          this.lateralPoint.x = w.contactPoint.x;
          // The CENTRE OF MASS' height, not the body origin's. `translation()` is the
          // origin, which sits COM_DROP_FRACTION of the half-height ABOVE the centre of
          // mass — so applying the side force there gave every corner a roll moment
          // INTO the turn worth `m · a · 0.45 · halfHeight`, cancelling nearly half of
          // the couple `applyRollCouple` had just been asked to restore. Measured: 2.6
          // degrees of lean at 0.6 g where the roll stiffness says 5.8. At the centre
          // of mass the side force carries no roll moment at all, which is the whole
          // point of applying it here: the roll couple is then the only thing supplying
          // one, and it is calibrated.
          this.lateralPoint.y = this.chassisBody.worldCom().y;
          this.lateralPoint.z = w.contactPoint.z;
          this.chassisBody.applyImpulseAtPoint(this.tyreImpulse, this.lateralPoint, false);
          // Aligning moment. The force acts PNEUMATIC_TRAIL_M behind the contact
          // centre, so it carries a moment about the vertical of exactly
          // -trail * impulse — the cross product collapses to that because forward and
          // right are orthogonal unit vectors in the ground plane. Summed over the
          // wheels this is the car's yaw damping.
          this.alignTorqueImpulse -= PNEUMATIC_TRAIL_M * impulse;
        }

        // LOOSE-SURFACE PLOUGHING. Cornering grip stays low on sand, but a tyre
        // travelling substantially sideways builds a bank of material against its
        // sidewall. That force is drag, not extra steering grip: it wakes only at
        // large lateral speed and cannot reverse the slide within this step.
        //
        // Apply it at the real contact patch rather than the COM-height point above.
        // The low application point is the trip mechanism of a broadside sand skid:
        // the vehicle sheds energy quickly and the body can carry on over the tyres.
        const deformationDrag = SURFACES[w.groundSurface].deformationDrag;
        if (deformationDrag > 0 && magnitude < stopImpulse) {
          const deformationT = clamp(
            (Math.abs(w.lateralSpeed) - DEFORMATION_DRAG_START_MPS) /
              (DEFORMATION_DRAG_FULL_MPS - DEFORMATION_DRAG_START_MPS),
            0,
            1,
          );
          const smoothDeformationT =
            deformationT * deformationT * (3 - 2 * deformationT);
          const deformationMagnitude = Math.min(
            stopImpulse - magnitude,
            w.loadN * deformationDrag * smoothDeformationT * dt,
          );
          const deformationImpulse =
            -Math.sign(w.lateralSpeed) * deformationMagnitude;
          if (deformationImpulse !== 0) {
            this.tyreImpulse.x = w.lateralRightX * deformationImpulse;
            this.tyreImpulse.y = w.lateralRightY * deformationImpulse;
            this.tyreImpulse.z = w.lateralRightZ * deformationImpulse;
            this.chassisBody.applyImpulseAtPoint(
              this.tyreImpulse,
              w.contactPoint,
              false,
            );
          }
        }
      }

      // THE ROAD, through the tyre. See the TYRE AS A SPRING block above for why this
      // is not the suspension's job.
      //
      // `w.profileHeight` is the enveloped ground the collider does not carry, under
      // this wheel, in metres. The wheel is a mass on the tyre's carcass rate with the
      // suspension between it and the body:
      //
      //   m_u * z_u'' = k_t (h - z_u) + c_t (h' - z_u') - k_s z_u - c_s z_u'
      //   F_body      = k_s z_u + c_s z_u'
      //
      // Both spring terms are relative to the body, which is treated as still over the
      // 10-14 Hz the hop mode lives at — the body's own motion is Rapier's problem and
      // it is already solving it against the smooth collider. Integrated semi-implicitly
      // so the stiff tyre rate is stable at 60 Hz.
      if (inContact && w.loadN > 0) {
        const mUnsprung = unsprungMass(w.radius);
        const kSusp = w.springRate * this.statsValue.mass;
        const cSusp = (w.hopV > 0 ? w.compressionRate : w.relaxationRate) * this.statsValue.mass;
        const cTyre = 2 * TYRE_DAMPING_RATIO * Math.sqrt(w.tyreRateN * mUnsprung);

        // Solved for the new velocity with BOTH springs and BOTH dampers evaluated at
        // it. The tyre rate is 165 kN/m against 38 kg, i.e. a 10.5 Hz mode at 60 Hz
        // steps: an explicit step would ring at that rate and a symplectic one would
        // mistune it, so the whole pair goes in the denominator and the solve is
        // unconditionally stable.
        const kTotal = kSusp + w.tyreRateN;
        const cTotal = cSusp + cTyre;
        const drive = w.tyreRateN * w.profileHeight + cTyre * w.profileRate;
        w.hopV =
          (mUnsprung * w.hopV + dt * (drive - kTotal * w.hopZ)) /
          (mUnsprung + dt * cTotal + dt * dt * kTotal);
        w.hopZ += w.hopV * dt;

        // The suspension force that moving wheel makes on the body. A road can take a
        // wheel's load away and it can push, but it cannot PULL the car down: bounding
        // the force at minus this wheel's own load is the tyre leaving the ground, and
        // it is the physical bound the old 0.9-of-static force cap stood in for.
        let bodyForce = kSusp * w.hopZ + cSusp * w.hopV;
        if (bodyForce < -w.loadN) bodyForce = -w.loadN;
        if (bodyForce !== 0) {
          rotateVector(this.microUp, this.rotationScratch, 0, bodyForce * dt, 0);
          this.chassisBody.applyImpulseAtPoint(this.microUp, w.contactPoint, false);
        }
      } else {
        // Airborne: the carcass relaxes towards free length rather than storing the
        // last bump until the landing.
        w.hopZ *= 0.5;
        w.hopV *= 0.5;
      }

      // BUMP STOP. Rapier's travel limit is a rigid clamp; a real stop is rubber that
      // starts taking load before the end and stiffens as it crushes (see
      // BUMP_STOP_FRACTION). Without it the soft springs this car now runs would hand
      // every big hit to the solver as a step.
      const length = controller.wheelSuspensionLength(w.index) ?? w.restLengthM;
      w.compressionM = w.restLengthM - length;
      // The stop lives in the BUMP travel — the compression available past static sag
      // — and not in the total. Measured against the total it sat below the sag of
      // every soft car in the catalogue, so a parked Zhiguli rested on its bump stops
      // and rang at 1.76 Hz instead of the 1.10 its springs were cut for.
      const bumpTravel = w.maxTravelM - w.sagM;
      const stopBegins = w.sagM + bumpTravel * (1 - BUMP_STOP_FRACTION);
      w.bumpStopN = 0;
      if (inContact && w.compressionM > stopBegins) {
        const into = Math.min(1, (w.compressionM - stopBegins) / (w.maxTravelM - stopBegins));
        w.bumpStopN = BUMP_STOP_PEAK * w.staticLoadN * into * into;
        rotateVector(this.microUp, this.rotationScratch, 0, w.bumpStopN * dt, 0);
        this.chassisBody.applyImpulseAtPoint(this.microUp, w.contactPoint, false);
      }

      // Friction-circle usage: how much of THIS tyre's force capacity the
      // longitudinal channel is eating, which is what it has no longer got left for
      // cornering.
      //
      // It must be a force ratio. The first version divided slip by PEAK_SLIP_RATIO,
      // which is unbounded and reads 1.0 at a slip of 0.12 — and a car at full
      // throttle cruises at 0.28-0.34. So every driven wheel sat pinned at "fully
      // sliding" whenever the throttle was open, cutting its side grip to
      // SLIDE_SIDE_GRIP and never giving it back. On a rear-driven car that is the
      // tail letting go the moment you use the engine, with no recovery: reported as
      // the fastback going straight on and refusing to steer at speed.
      const slideTarget =
        Math.abs(contactSpeed) > SLIDE_MIN_MPS
          ? clamp((gripUsage - SLIDE_CONE_THRESHOLD) / (1 - SLIDE_CONE_THRESHOLD), 0, 1)
          : 0;
      w.slideT +=
        (slideTarget - w.slideT) *
        (slideTarget > w.slideT ? slideOnsetBlend : slideRecoverBlend);
    }

    // One torque impulse for the whole axle set. Applied after the loop so the four
    // aligning moments are summed rather than four separate solver touches, and about
    // WORLD up rather than the body's: at any lean the yaw axis a car is disturbed
    // about is the vertical one, not its own tilted Y.
    if (this.alignTorqueImpulse !== 0) {
      this.forceScratch.x = 0;
      this.forceScratch.y = this.alignTorqueImpulse;
      this.forceScratch.z = 0;
      this.chassisBody.applyTorqueImpulse(this.forceScratch, false);
      this.alignTorqueImpulse = 0;
    }
  }

  /**
   * Copies per-wheel contact, orientation, slip and surface data into the pre-allocated
   * ground-effect states, and load/travel into `wheelRideStates`. Runs once per fixed
   * step after wheel dynamics finalise, and never allocates.
   */
  private refreshWheelSpray(forwardSpeed: number): void {
    const n = this.wheels.length;
    for (let i = 0; i < n; i++) {
      const w = this.wheels[i];
      const s = this.wheelSprayStates[i];
      s.contactX = w.contactPoint.x;
      s.contactY = w.contactPoint.y;
      s.contactZ = w.contactPoint.z;
      s.absoluteContactX = w.contactPoint.x + this.origin.x;
      s.absoluteContactZ = w.contactPoint.z + this.origin.z;
      s.forwardX = w.forwardDir.x;
      s.forwardZ = w.forwardDir.z;
      s.normalX = w.contactNormal.x;
      s.normalY = w.contactNormal.y;
      s.normalZ = w.contactNormal.z;
      s.inContact = w.grounded;
      s.surface = w.groundSurface;
      s.slipRatio = w.slipRatio;
      s.slideT = w.slideT;
      s.forwardSpeed = forwardSpeed;

      const r = this.wheelRideStates[i];
      r.inContact = w.grounded;
      r.loadN = w.loadN;
      r.staticLoadN = w.staticLoadN;
      r.compressionM = w.compressionM;
      r.reserveM = w.maxTravelM - w.compressionM;
      r.bumpStopN = w.bumpStopN;
      r.tyreDeflectionM = w.profileHeight - w.hopZ;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.originDisposer?.();
    this.originDisposer = null;
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

  /** Live drivetrain service parts override the catalogue defaults. */
  private computeStats(): CarStats {
    const installedEngine = bonnetPart(this.car.bonnet, 0);
    const engine = installedEngine
      ? variant(installedEngine.variantId).engine ?? modelEngine(this.model)
      : modelEngine(this.model);
    let mass = this.model.mass;
    for (const part of Object.values(this.gizmoParts())) mass += variant(part.variantId).mass;

    return {
      mass,
      engine,
      gearbox: modelGearbox(this.model),
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
   * Returns the steering angle a wheel actually presents to the road. Bump-steer is
   * asymmetric by wheel side; the rack angle remains the driver's commanded state.
   */
  private wheelSteerAngle(w: WheelVisual): number {
    return w.isFront ? this.steerAngle + w.sideSign * this.bumpSteerAngle : 0;
  }

  /**
   * Lets the road talk through the worn front end. A load difference across the front
   * axle means one wheel has climbed or dropped relative to the other. The disturbance
   * is stronger on rough surfaces and at speed, where a small toe change becomes a
   * visible lateral lurch. It is filtered in time, not replaced with random steering,
   * so the same pothole produces the same correction and a smooth road stays calm.
   */
  private updateBumpSteer(dt: number, speedKmh: number): void {
    let leftLoad = 0;
    let rightLoad = 0;
    let roughness = 0;
    let roughWheels = 0;
    for (const w of this.wheels) {
      if (!w.isFront) continue;
      if (w.sideSign < 0) leftLoad += w.loadN;
      else rightLoad += w.loadN;
      if (w.grounded) {
        roughness += SURFACES[w.groundSurface].roughness;
        roughWheels++;
      }
    }

    let target = 0;
    if (roughWheels > 0) {
      const staticWheelLoadN = Math.max(1, (this.statsValue.mass * GRAVITY) / this.wheels.length);
      const loadImbalance = clamp((rightLoad - leftLoad) / staticWheelLoadN, -1, 1);
      const roughFactor = clamp(
        roughness / roughWheels / BUMP_STEER_FULL_ROUGHNESS,
        0.25,
        1.4,
      );
      const speedFactor = clamp((speedKmh - 12) / 73, 0, 1);
      target = loadImbalance * this.handling.bumpSteer * roughFactor * speedFactor;
    }
    const blend = 1 - Math.exp(-dt / BUMP_STEER_TAU);
    this.bumpSteerAngle += (target - this.bumpSteerAngle) * blend;
  }

  /**
   * The anti-roll bars (see ANTI_ROLL_FRONT_FRACTION).
   *
   * A bar is a torsion spring between the two wheels of one axle, so it is loaded by
   * their DIFFERENCE in travel and by nothing else: it adds roll stiffness without
   * adding ride stiffness, which is exactly what a soft-sprung car needs to corner
   * without running its outer springs into the bump stops.
   *
   * Implemented as the pair of equal and opposite vertical forces the real bar applies
   * at the two wheels, so nothing about it is a torque fudge: the more compressed side
   * is pushed down and the other pulled up, at the contact points, and the moment that
   * results is the bar's own. It carries no damping, because a bar has none worth
   * modelling.
   *
   * Runs after `updateWheelDynamics`, which is where `compressionM` is read off the
   * controller. An axle with a wheel in the air contributes nothing — a bar needs both
   * ends on the ground to have a difference worth resisting.
   */
  private applyAntiRollBars(dt: number): void {
    for (let axle = 0; axle < 2; axle++) {
      const front = axle === 0;
      let leftSum = 0;
      let rightSum = 0;
      let leftCount = 0;
      let rightCount = 0;
      let groundedBoth = true;
      let rate = 0;
      for (const w of this.wheels) {
        if (w.isFront !== front) continue;
        if (!w.grounded) groundedBoth = false;
        if (w.sideSign < 0) {
          leftSum += w.compressionM;
          leftCount++;
        } else {
          rightSum += w.compressionM;
          rightCount++;
        }
        // The bar is sized against its own axle's wheel rate, which is per kilogram.
        rate = w.springRate * this.statsValue.mass;
      }
      if (!groundedBoth || leftCount === 0 || rightCount === 0) continue;
      const leftMean = leftSum / leftCount;
      const rightMean = rightSum / rightCount;
      if (leftMean === rightMean) continue;

      const fraction = front ? ANTI_ROLL_FRONT_FRACTION : ANTI_ROLL_REAR_FRACTION;
      // Each wheel is pushed by the bar in proportion to how much MORE compressed its
      // own side is than the other. The two are equal and opposite by construction, so
      // a bar can never lift or drop the car — only untwist it. Written this way rather
      // than from `sideSign` because the force follows the measured travel, and no
      // left/right convention can get it backwards.
      const gain = fraction * rate * 0.5;
      for (const w of this.wheels) {
        if (w.isFront !== front) continue;
        const own = w.sideSign < 0 ? leftMean : rightMean;
        const other = w.sideSign < 0 ? rightMean : leftMean;
        // Up on the compressed side: that is the bar unloading the outer spring.
        rotateVector(this.microUp, this.rotationScratch, 0, gain * (own - other) * dt, 0);
        this.chassisBody.applyImpulseAtPoint(this.microUp, w.contactPoint, false);
      }
    }
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

  /**
   * Takes back the share of the longitudinal pitch couple that real suspension
   * geometry would carry through the links (see ANTI_SQUAT_FRACTION).
   *
   * The couple exists because the tyre force is applied at the CONTACT PATCH while the
   * centre of mass is `rollLeverArm` above it: a forward force of F therefore makes a
   * nose-up moment of F times that arm, and Rapier applies every newton of it to the
   * springs because it has no wishbones to react any of it. Removing a fixed fraction
   * is the whole model — it is what an anti-squat percentage MEANS, so there is nothing
   * to tune beyond the two fractions.
   *
   * Sign: forward is body +Z and the contact patch is below the centre of mass, so a
   * driving force gives a NEGATIVE moment about body +X (nose up). The correction is
   * therefore positive about +X under power and negative under braking, which falls out
   * of the sign of the force without a branch — only the FRACTION differs by direction,
   * because a car has more anti-squat available at the back than anti-dive at the front.
   *
   * Skipped with nothing on the ground: an airborne car has no contact patch for the
   * couple to have come from, so there is none to take back.
   */
  private applyAntiPitch(dt: number, contactCount: number): void {
    if (contactCount === 0 || this.longitudinalForceSum === 0) return;
    const fraction =
      this.longitudinalForceSum >= 0 ? ANTI_SQUAT_FRACTION : ANTI_DIVE_FRACTION;
    const torque = this.longitudinalForceSum * this.rollLeverArm * fraction * dt;
    this.chassisBody.rotation(this.rotationScratch);
    rotateVector(this.forceScratch, this.rotationScratch, torque, 0, 0);
    this.chassisBody.applyTorqueImpulse(this.forceScratch, true);
  }

  /**
   * The axle geometry and weight distribution, measured once from the model.
   *
   * Front is +Z (the controller's forward axis), so `frontZ` is the mean mount Z of
   * the front wheels and `rearZ` the rear's. Multi-axle vehicles (the six-wheel
   * semi, the twelve-wheel loader) collapse to two groups, which is what `isFront`
   * already means everywhere else in this file.
   */
  private measureAxles(): AxleGeometry {
    let frontZ = 0;
    let rearZ = 0;
    let frontCount = 0;
    let rearCount = 0;
    for (const wheel of this.measure.wheels) {
      if (wheel.isFront) {
        frontZ += wheel.pos[2];
        frontCount++;
      } else {
        rearZ += wheel.pos[2];
        rearCount++;
      }
    }
    frontZ = frontCount > 0 ? frontZ / frontCount : this.measure.halfExtents[2];
    rearZ = rearCount > 0 ? rearZ / rearCount : -this.measure.halfExtents[2];
    return {
      frontZ,
      rearZ,
      frontCount: Math.max(1, frontCount),
      rearCount: Math.max(1, rearCount),
      frontWeightShare: frontWeightFraction(this.model),
    };
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
    // WHERE THE MASS SITS ALONG THE CAR. A front weight fraction f puts the centre of
    // mass f of the way from the rear axle to the front one, which is the definition
    // of the fraction and the only placement that makes the axle loads come out at
    // f and 1-f. Front-drive cars therefore genuinely carry their nose, and the
    // static loads every grip calculation is referenced against are the real ones.
    const axles = this.axleGeometry;
    const comZ = axles.rearZ + axles.frontWeightShare * (axles.frontZ - axles.rearZ);
    this.chassisBody.setAdditionalMassProperties(
      mass,
      { x: 0, y: -COM_DROP_FRACTION * hy, z: comZ },
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
    const instance = createCarModel(this.model.id, this.car.id);
    this.rootGroup.add(instance.body);

    // The body subtree is cloned per vehicle, so this node belongs to this car and
    // turning it cannot turn anybody else's wheel.
    this.steeringWheel = instance.body.getObjectByName(STEERING_WHEEL_NODE) ?? null;
    this.steeringWheelRest = this.steeringWheel?.rotation.y ?? 0;

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
      setPartCondition(mesh, part);
      this.rootGroup.add(mesh);
      this.gizmos.push({ part, mesh });
    }

    this.bindVehicleLights();
    this.buildHeadlightMounts();
    this.buildRearLightMounts(this.taillightLensMeshes, TAILLIGHT_BEAM, this.taillightMounts);
    this.buildRearLightMounts(
      this.reverseLightLensMeshes,
      REVERSE_LIGHT_BEAM,
      this.reverseLightMounts,
    );
    this.applyRearLightState();
  }

  private bindLampMaterials(
    selectors: readonly string[] | undefined,
    output: EmissiveMaterial[],
  ): THREE.Mesh[] {
    if (!selectors || selectors.length === 0) return [];
    const wanted = new Set(selectors);
    const meshes: THREE.Mesh[] = [];
    this.rootGroup.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const nodeMatch = wanted.has(object.name);
      let matched = false;
      const bind = (source: THREE.Material): THREE.Material => {
        if (!nodeMatch && !wanted.has(source.name)) return source;
        matched = true;
        if (
          !(source instanceof THREE.MeshStandardMaterial) &&
          !(source instanceof THREE.MeshPhongMaterial)
        ) {
          throw new Error(
            `Car model "${this.model.id}" lamp material cannot emit light: ${source.name}`,
          );
        }
        const material = source.clone();
        material.emissive.setHex(0x000000);
        material.emissiveIntensity = 0;
        output.push(material);
        return material;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(bind)
        : bind(object.material);
      if (matched) meshes.push(object);
    });
    if (output.length === 0) {
      throw new Error(
        `Car model "${this.model.id}" is missing authored lamp selectors: ${selectors.join(', ')}`,
      );
    }
    return meshes;
  }

  private bindVehicleLights(): void {
    const lights = this.model.lights;
    if (!lights) return;
    this.headlightLensMeshes = this.bindLampMaterials(
      lights.headlights,
      this.headlightLensMaterials,
    );
    this.taillightLensMeshes = this.bindLampMaterials(
      lights.taillights,
      this.taillightMaterials,
    );
    if (this.model.paintStyle === 'stylized-palette') {
      for (const material of this.taillightMaterials) {
        material.color.setHex(STYLIZED_TAILLIGHT_COLOR);
      }
    }
    this.reverseLightLensMeshes = this.bindLampMaterials(
      lights.reverseLights,
      this.reverseLightMaterials,
    );
    this.bindLampMaterials(lights.leftBlinkers, this.leftBlinkerMaterials);
    this.bindLampMaterials(lights.rightBlinkers, this.rightBlinkerMaterials);
    this.rearLightState = -1;
    this.reverseLightState = false;
    this.applyIndicatorState(false);
  }

  private lampBounds(meshes: readonly THREE.Mesh[]): THREE.Box3 {
    this.rootGroup.updateMatrixWorld(true);
    const worldToRoot = this.rootGroup.matrixWorld.clone().invert();
    const bounds = new THREE.Box3();
    for (const mesh of meshes) {
      mesh.geometry.computeBoundingBox();
      const meshBounds = mesh.geometry.boundingBox;
      if (!meshBounds) continue;
      bounds.union(
        meshBounds
          .clone()
          .applyMatrix4(worldToRoot.clone().multiply(mesh.matrixWorld)),
      );
    }
    return bounds;
  }

  private buildRearLightMounts(
    lenses: readonly THREE.Mesh[],
    shape: {
      readonly targetDistance: number;
      readonly targetDrop: number;
    },
    output: VehicleBeamMount[],
  ): void {
    if (lenses.length === 0) return;
    const box = this.lampBounds(lenses);
    const centre = box.getCenter(new THREE.Vector3());
    const halfWidth = Math.max(0.1, (box.max.x - box.min.x) * 0.325);
    const z = box.min.z - 0.015;
    for (const sign of [-1, 1]) {
      const x = centre.x + sign * halfWidth;
      output.push({
        sourceLocal: new THREE.Vector3(x, centre.y, z),
        aimLocal: new THREE.Vector3(
          x,
          centre.y - shape.targetDrop,
          z - shape.targetDistance,
        ),
      });
    }
  }

  /**
   * Headlight mounts follow authored lamp bounds when available. Models without
   * lamp metadata retain the measured-chassis fallback used by static/wreck packs.
   */
  private buildHeadlightMounts(): void {
    const half = this.measure.halfExtents;
    let centreX = 0;
    let halfWidth = HEADLIGHT_X_FRACTION * half[0];
    let y = Math.max(
      -half[1] + HEADLIGHT_Y_FRACTION * 2 * half[1],
      this.contactPlaneY + HEADLIGHT_MIN_HEIGHT,
    );
    let z = half[2];
    if (this.headlightLensMeshes.length > 0) {
      const box = this.lampBounds(this.headlightLensMeshes);
      const centre = box.getCenter(new THREE.Vector3());
      centreX = centre.x;
      halfWidth = Math.max(0.1, (box.max.x - box.min.x) * 0.325);
      y = centre.y;
      z = box.max.z;
    }
    for (const sign of [-1, 1]) {
      const x = centreX + sign * halfWidth;
      this.headlightMounts.push({
        sourceLocal: new THREE.Vector3(x, y, z),
        aimLocal: new THREE.Vector3(
          x,
          y - HEADLIGHT_LOW.targetDrop,
          z + HEADLIGHT_LOW.targetDistance,
        ),
      });
    }
    this.applyHeadlightMode();
  }

  private applyHeadlightMode(): void {
    const beam =
      this.headlightMode === 'high'
        ? HEADLIGHT_HIGH
        : this.headlightMode === 'low'
          ? HEADLIGHT_LOW
          : null;
    const shape = beam ?? HEADLIGHT_LOW;
    for (const headlight of this.headlightMounts) {
      headlight.aimLocal.set(
        headlight.sourceLocal.x,
        headlight.sourceLocal.y - shape.targetDrop,
        headlight.sourceLocal.z + shape.targetDistance,
      );
    }
    const intensity = this.headlightMode === 'high' ? 3 : this.headlightMode === 'low' ? 2.4 : 0;
    for (const material of this.headlightLensMaterials) {
      material.emissive.setHex(intensity > 0 ? HEADLIGHT_EMISSIVE : 0x000000);
      material.emissiveIntensity = intensity;
    }
  }

  private applyRearLightState(force = false): void {
    const next = this.restoredLightStatePending
      ? (this.car.taillightsOn ? 1 : 0)
      : this.brakeLightCommand > 0.03
        ? 2
        : this.headlightMode === 'off'
          ? 0
          : 1;
    if (force || next !== this.rearLightState) {
      this.rearLightState = next;
      const intensity = next === 2 ? 6 : next === 1 ? 0.55 : 0;
      for (const material of this.taillightMaterials) {
        material.emissive.setHex(intensity > 0 ? TAILLIGHT_EMISSIVE : 0x000000);
        material.emissiveIntensity = intensity;
      }
      const authoredBeamIntensity =
        next === 2
          ? TAILLIGHT_BEAM.brakeIntensity
          : next === 1
            ? TAILLIGHT_BEAM.runningIntensity
            : 0;
      this.taillightBeamIntensity = authoredBeamIntensity * this.headlightEnvironmentFactor;
    }
    const reversing = this.restoredLightStatePending
      ? this.car.reverseLightsOn
      : this.drivetrain.gearLabel === 'R';
    if (!force && reversing === this.reverseLightState) return;
    this.reverseLightState = reversing;
    for (const material of this.reverseLightMaterials) {
      material.emissive.setHex(reversing ? REVERSE_LIGHT_EMISSIVE : 0x000000);
      material.emissiveIntensity = reversing ? 4 : 0;
    }
    this.reverseLightBeamIntensity = reversing
      ? REVERSE_LIGHT_BEAM.intensity * this.headlightEnvironmentFactor
      : 0;
  }

  private applyIndicatorState(lit: boolean): void {
    this.indicatorLit = lit;
    const apply = (materials: readonly EmissiveMaterial[], active: boolean): void => {
      for (const material of materials) {
        material.emissive.setHex(active ? BLINKER_EMISSIVE : 0x000000);
        material.emissiveIntensity = active ? 5 : 0;
      }
    };
    apply(this.leftBlinkerMaterials, lit && this.indicatorSide === 'left');
    apply(this.rightBlinkerMaterials, lit && this.indicatorSide === 'right');
  }

  private advanceIndicator(dt: number): void {
    if (this.indicatorSide === 'off') {
      if (this.indicatorLit) this.applyIndicatorState(false);
      return;
    }
    this.indicatorElapsed = (this.indicatorElapsed + dt) % BLINKER_PERIOD_S;
    const lit = this.indicatorElapsed < BLINKER_PERIOD_S * 0.5;
    if (lit !== this.indicatorLit) this.applyIndicatorState(lit);
  }

  /** Releases per-instance lamp materials and detaches the model-owned visual tree. */
  private clearVisuals(): void {
    for (const material of this.headlightLensMaterials) material.dispose();
    for (const material of this.taillightMaterials) material.dispose();
    for (const material of this.reverseLightMaterials) material.dispose();
    for (const material of this.leftBlinkerMaterials) material.dispose();
    for (const material of this.rightBlinkerMaterials) material.dispose();
    for (const child of this.rootGroup.children.slice()) this.rootGroup.remove(child);
    this.wheelMeshes.clear();
    this.steeringWheel = null;
    this.steeringWheelRest = 0;
    this.headlightMounts = [];
    this.taillightMounts = [];
    this.reverseLightMounts = [];
    this.headlightLensMeshes = [];
    this.taillightLensMeshes = [];
    this.reverseLightLensMeshes = [];
    this.headlightLensMaterials.length = 0;
    this.taillightMaterials.length = 0;
    this.reverseLightMaterials.length = 0;
    this.leftBlinkerMaterials.length = 0;
    this.rightBlinkerMaterials.length = 0;
    this.rearLightState = -1;
    this.reverseLightState = false;
    this.taillightBeamIntensity = 0;
    this.reverseLightBeamIntensity = 0;
    this.indicatorLit = false;
  }

  private drivetrainEngine(): EngineSpec | null {
    const part = bonnetPart(this.car.bonnet, 0);
    if (!part) return null;
    const engine = variant(part.variantId).engine ?? null;
    return engine && part.destroyed ? destroyedEngineSpec(engine) : engine;
  }

  private capDestroyedEngineSpeed(forwardMps: number): void {
    const excess = forwardMps - Math.sign(forwardMps) * DESTROYED_ENGINE_SPEED_CAP_MPS;
    this.linvel.x -= this.forwardScratch.x * excess;
    this.linvel.z -= this.forwardScratch.z * excess;
    this.chassisBody.setLinvel(this.linvel, true);
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
