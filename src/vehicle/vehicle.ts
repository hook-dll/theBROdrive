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
import { WorldOrigin, type Rebasable, type RebaseShift } from '../world/origin';
import type { InputFrame } from '../core/input';
import { SURFACES, SurfaceType } from '../core/surfaces';
import type { CarState, GameWorld } from '../game/state';
import { variant, COOLANT_LOSS_LPH, OIL_LOSS_LPH } from '../parts/registry';
import type { CarStats, EngineSpec, PartInstance } from '../parts/registry';
import { carModel, modelEngine, modelGearbox, type CarModelDef } from './carmodels';
import { bonnetCanRun, bonnetPart, destroyedEngineSpec, engineFailureReason } from './bonnet';
import { Drivetrain, wheelTorqueToForce } from './drivetrain';
import { carModelMeasure, createCarModel, type CarModelMeasure } from '../render/carmodel';
import { createPartMesh } from '../render/partmesh';
import { setPartCondition } from '../render/materials';
import type { VehicleLightRig } from '../render/vehiclelights';

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
/**
 * Maximum fraction of lateral grip shed at high speed (0 = none, 1 = all).
 *
 * This is the lever that makes the car's instability SPEED-TRIGGERED rather than
 * always-on, which is the whole target feel: planted in a straight line, honest
 * through a slow curve, and something you have to catch once you have carried too
 * much speed into it. 0.42 means a third-gear corner is still a corner and a
 * flat-out one has lost nearly half its cornering force.
 */
const LATERAL_GRIP_MAX_LOSS = 0.42;
/**
 * Rear-axle lateral grip, as a fraction of the front's.
 *
 * A live axle on leaf springs steers itself under roll and load: the axle tramps,
 * the springs wind up, and the outer tyre runs at a slip angle the driver never
 * asked for. With the rear brake bias and the mostly-RWD catalogue, this 6% is what
 * makes the TAIL the end that goes first — the car has to be driven, not aimed, and
 * it will not catch itself.
 */
const REAR_AXLE_SIDE_GRIP = 0.89;

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
const SLIP_PEAK_FRONT_DEG = 8;
const SLIP_PEAK_REAR_DEG = 8;
/** Slip angle (deg) by which the fade is complete and the plateau has been reached. */
const SLIP_FULL_FRONT_DEG = 26;
const SLIP_FULL_REAR_DEG = 22;
/** Side grip retained on the plateau, as a fraction of the axle's peak. */
const SLIP_PLATEAU_FRONT = 0.8;
const SLIP_PLATEAU_REAR = 0.8;
/** Contact speed (m/s) floor in the slip-angle denominator, to keep it finite at rest. */
const SLIP_ANGLE_REF_MPS = 2;
/**
 * Extra share of the high-speed lateral loss (LATERAL_GRIP_MAX_LOSS) applied to the
 * REAR axle only. 1 = both axles lose the same, which is what it used to be, and
 * which made speed cost stability nothing: the car simply cornered less hard the
 * faster it went, evenly, and stayed stubbornly neutral doing it. Above 1 the tail
 * is the end that speed takes away from, so a bend taken 20 km/h too fast is
 * genuinely a different, edgier car than the same bend taken properly.
 */
const REAR_SPEED_LOSS_GAIN = 1.32;

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
/** Load low-pass (s): ray-cast suspension force is spiky over collider seams. */
const WHEEL_LOAD_TAU = 0.04;
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
 * Below TCS_AUTHORITY_START_MPS the driver still keeps full authority for digging,
 * rocking and reversing out.
 */
const TCS_SLIP_FLOOR_MPS = 2.2;
/** Slip speed (m/s) past the threshold over which the cut ramps from none to full. */
const TCS_SLIP_BAND_MPS = 1.8;
/** Road speed (m/s) below which TCS may not cut at all, and above which it may cut fully. */
const TCS_AUTHORITY_START_MPS = 1.0;
const TCS_AUTHORITY_FULL_MPS = 3.5;
/** Most of a wheel's drive torque TCS may take away. Never all of it: a bogged car still digs. */
const TCS_MAX_CUT = 0.85;
/** Cut smoothing, seconds: quick to intervene, slower to hand the torque back. */
const TCS_ATTACK_TAU = 0.03;
const TCS_RELEASE_TAU = 0.12;
/** Cut fraction above which the dashboard lamp counts the system as working. */
const TCS_LAMP_THRESHOLD = 0.05;
/**
 * Minimum time (s) the lamp stays lit once lit. A single-step intervention is real
 * but invisible at 60 Hz; a lamp that flickers for one frame teaches nothing.
 */
const TCS_LAMP_HOLD_S = 0.35;
/**
 * Ride height, as geometry rather than a fudge factor.
 *
 * Two rules, and a body ends up at whichever leaves it LOWER:
 *
 *  - the TARGET, which puts the body's underside a little below the centre of the
 *    wheels. Since the wheel hangs `rest - sag` below its mount, that is
 *    `mount_y = restLength - staticSag - halfHeight + RIDE_TARGET_DROP`.
 *  - the artist's own STANCE (`wheelCentre + rest - sag`, which reproduces the
 *    model exactly), never lifted by more than RIDE_LIFT_MAX. Without that cap, a
 *    pack whose body box runs down to a low skirt or a modelled underbody gets put
 *    on stilts.
 *
 * RIDE_TARGET_DROP is not cosmetic tuning; it fixes a measured artefact. With the
 * target at exactly the wheel centres, every body the target rule caught sat with
 * its whole underside one wheel-radius off the ground — measured 0.248 m, 0.260 m
 * and 0.327 m of clearance, which is precisely each car's own tyre radius. That is
 * the whole Quaternius pack, and on those bodies it reads as a car on stilts with
 * its tyres hanging out of the arches. The packs that land on the stance cap
 * instead (DeJunes, PSX) sit at 0.11-0.29 m and already look right, so this must
 * move the target and not the cap.
 *
 * 0.05 m brings the Quaternius saloons to ~0.21 m, between the DeJunes compact's
 * 0.11 m and its taxi's 0.29 m, and leaves every stance-capped body untouched. A
 * real car's sills do sit below hub height, so this is also the more honest target.
 *
 * Only Y comes from this; track and wheelbase always come from the model.
 */
const RIDE_LIFT_MAX = 0.15;
/** How far below the wheel centres the target puts the body's underside, metres. */
const RIDE_TARGET_DROP = 0.05;
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
 * Per-wheel telemetry the renderer's sand/gravel spray reads each frame: where
 * the tyre is, which way it points and how hard it is disturbing the ground.
 * Written in place once per fixed step; nothing here is allocated per tick.
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
  private readonly measure: CarModelMeasure;
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
  private gizmos: GizmoVisual[] = [];
  /** Wheel objects taken from the instantiated model, keyed by wheel id. */
  private readonly wheelMeshes = new Map<string, THREE.Object3D>();
  private headlightMounts: VehicleBeamMount[] = [];
  private taillightMounts: VehicleBeamMount[] = [];
  private reverseLightMounts: VehicleBeamMount[] = [];
  private headlightEnvironmentFactor = 1;
  private headlightMode: HeadlightMode = 'off';
  private headlightLensMeshes: THREE.Mesh[] = [];
  private taillightLensMeshes: THREE.Mesh[] = [];
  private reverseLightLensMeshes: THREE.Mesh[] = [];
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
  /** Driveline torque actually reaching the wheels, lagged by DRIVELINE_LAG_S. */
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
  private lastAuthOil: number;
  private fluidEmitTimer = 0;

  // Odometer and transform emission.
  private odoAccum = 0;
  private odoEmitTimer = 0;
  private transformEmitTimer = 0;

  // Scratch buffers reused across fixedUpdate (no per-tick allocation).
  private readonly linvel = { x: 0, y: 0, z: 0 };
  private readonly rotationScratch = { x: 0, y: 0, z: 0, w: 1 };
  private readonly forwardScratch = { x: 0, y: 0, z: 0 };
  private readonly forceScratch = { x: 0, y: 0, z: 0 };
  /** Per-wheel tyre impulse, applied at the contact patch. */
  private readonly tyreImpulse = { x: 0, y: 0, z: 0 };
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
    this.model = carModel(carState.modelId);
    this.measure = carModelMeasure(carState.modelId);

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

  /** Off -> dipped beam -> high beam -> off. */
  cycleHeadlights(): void {
    this.headlightMode =
      this.headlightMode === 'off' ? 'low' : this.headlightMode === 'low' ? 'high' : 'off';
    this.applyHeadlightMode();
    this.applyRearLightState();
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
    this.appliedDriveTorqueNm = 0;
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

    const frontShare = 1 - this.model.rearDriveBias;
    const rearShare = this.model.rearDriveBias;
    const suspension = this.model.suspension;

    // Ride height (see RIDE_LIFT_MAX above). `hangs` is how far below its mount a
    // settled wheel sits; `target` puts the body's underside on the wheel centres,
    // and `stance` reproduces the model's own drawing. Take whichever is lower —
    // i.e. never lift a body more than RIDE_LIFT_MAX off its own arches. X and Z
    // always stay where the model put its wheels.
    const hangs = suspension.restLength - staticSag(suspension.stiffness);
    const target = hangs - this.measure.halfExtents[1] + RIDE_TARGET_DROP;
    const stance = hangs + this.measure.wheels[0].pos[1];
    const mountY = Math.max(target, stance - RIDE_LIFT_MAX);

    // Roll lever: how far the centre of mass sits above the tyre contact plane.
    // The contact plane is one radius below where a settled wheel centre ends up
    // (`mountY - hangs`), and the centre of mass is the same offset applied in
    // applyChassisMass. This is the arm the missing roll couple acts on.
    const comY = -COM_DROP_FRACTION * this.measure.halfExtents[1];
    const contactY = mountY - hangs - this.measure.wheels[0].radius;
    this.rollLeverArm = Math.max(0.1, comY - contactY);
    this.contactPlaneY = contactY;
    // Headlight height is measured from the settled contact plane, so a low skirt
    // or oddly-centred model cannot put the light source below an uphill surface.
    this.buildVisuals();

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
        groundSurface: SurfaceType.Asphalt,
        grounded: false,
        slideT: 0,
        tcsCut: 0,
        locked: false,
        spinRadS: 0,
        drawnSpin: 0,
        slipRatio: 0,
        loadN: 0,
        driveTorqueNm: 0,
        brakeForceN: 0,
        forwardDir: { x: 0, y: 0, z: 1 },
        contactPoint: { x: 0, y: 0, z: 0 },
        contactNormal: { x: 0, y: 1, z: 0 },
        contactVel: { x: 0, y: 0, z: 0 },
      });

      if (wheel.isFront) {
        this.frontWheelCount++;
        if (frontShare > 0) this.frontDrivenCount++;
      } else {
        this.rearWheelCount++;
        if (rearShare > 0) this.rearDrivenCount++;
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
        inContact: false,
        surface: SurfaceType.Asphalt,
        slipRatio: 0,
        slideT: 0,
        forwardSpeed: 0,
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

    if (this.odoAccum > 0) {
      this.world.apply({ t: 'car_odometer', carId: this.car.id, metres: this.odoAccum });
      this.odoAccum = 0;
    }
    this.odoEmitTimer = 0;
    this.pushTransform();
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


  fixedUpdate(dt: number, input: InputFrame): void {
    const controller = this.controller;
    if (!controller) return;

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

    let fwd = this.forwardSpeedMps();
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
    const steerT = clamp(
      (speedKmh - STEER_FULL_LOCK_KMH) / (STEER_REDUCED_KMH - STEER_FULL_LOCK_KMH),
      0,
      1,
    );
    const steerInput =
      Math.sign(input.steer) * Math.pow(Math.abs(input.steer), STEER_INPUT_EXPONENT);
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
    const speedFactor = 1 - (1 - STEER_HIGH_SPEED_FRACTION) * Math.pow(steerT, STEER_LOCK_CURVE);
    const targetSteer =
      -steerInput * this.model.steerLock * (speedFactor + (1 - speedFactor) * slideRelease);
    const steerRate =
      STEER_RATE_HIGHWAY_RAD_S +
      (STEER_RATE_PARK_RAD_S - STEER_RATE_HIGHWAY_RAD_S) *
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
    const play = STEER_PLAY_RAD * (1 - slideRelease);
    const caster = STEER_CASTER_RETURN_RAD_S * dt;
    this.steerAngle -= clamp(this.steerAngle, -caster, caster);
    if (this.steerCommand > this.steerAngle + play) {
      this.steerAngle = this.steerCommand - play;
    } else if (this.steerCommand < this.steerAngle - play) {
      this.steerAngle = this.steerCommand + play;
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
    // Same for every wheel: the lateral grip budget (see constants above). The
    // cone cap is mass-scaled so heavy vehicles corner worse per kilogram.
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
    // The loss is split by axle: the rear sheds REAR_SPEED_LOSS_GAIN times as much
    // of it, so speed does not just cost cornering power, it costs STABILITY.
    const speedLossT = lateralGripT * lateralGripT * (3 - 2 * lateralGripT);
    const lateralGripFront = 1 - LATERAL_GRIP_MAX_LOSS * speedLossT;
    const lateralGripRear = Math.max(
      0.2,
      1 - LATERAL_GRIP_MAX_LOSS * REAR_SPEED_LOSS_GAIN * speedLossT,
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
      const coneGrip = 1 - w.slideT * (1 - SLIDE_SIDE_GRIP);
      // Locked: the parking cable is immediate, because it is a cable pulling shoes
      // onto drums. The foot brake earns its lock from the wheel's own rotation,
      // measured by updateWheelDynamics after the step that delivered the torque.
      const locked = handbraked || w.locked;
      const slideGrip = locked ? Math.min(LOCKED_SIDE_GRIP, coneGrip) : coneGrip;
      // The rear axle is a live axle on leaf springs and never had the front's
      // cornering power (REAR_AXLE_SIDE_GRIP).
      const axleGrip = w.isFront ? 1 : REAR_AXLE_SIDE_GRIP;

      // Slip angle of this tyre: the angle between where the contact patch is going
      // and where the wheel is pointing. The wheel's own right-hand direction is the
      // chassis' +X yawed by this wheel's steering angle, so a steered front wheel is
      // measured in ITS plane, not the body's — which is the difference between
      // "the car is sideways" and "the tyre is slipping".
      const steer = w.isFront ? this.steerAngle : 0;
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
      if (!w.isFront && w.grounded) rearSlipMax = Math.max(rearSlipMax, slipRad);

      // Peak, then a smooth fade to the plateau. Below the peak this is exactly 1.
      const peakDeg = w.isFront ? SLIP_PEAK_FRONT_DEG : SLIP_PEAK_REAR_DEG;
      const fullDeg = w.isFront ? SLIP_FULL_FRONT_DEG : SLIP_FULL_REAR_DEG;
      const plateau = w.isFront ? SLIP_PLATEAU_FRONT : SLIP_PLATEAU_REAR;
      const fadeT = clamp(((slipRad * 180) / Math.PI - peakDeg) / (fullDeg - peakDeg), 0, 1);
      const slipGrip = 1 - (1 - plateau) * fadeT * fadeT * (3 - 2 * fadeT);

      const frictionSlip = surface.frictionSlip * gripBudgetFactor;
      controller.setWheelFrictionSlip(w.index, frictionSlip);
      controller.setWheelSideFrictionStiffness(
        w.index,
        surface.sideFriction *
          compound.side *
          SIDE_FRICTION_GAIN *
          (w.isFront ? lateralGripFront : lateralGripRear) *
          axleGrip *
          slipGrip *
          slideGrip,
      );

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

      controller.setWheelSteering(w.index, w.isFront ? this.steerAngle : 0);

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
    } else {
      this.updateWheelDynamics(dt, stats.wheelGrip, tyreGrip, fwd);
    }
    this.refreshWheelSpray(fwd);

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

    // Gizmos are bolted to the shell: they never move relative to it, so all they
    // need per frame is their condition, which a scrubbing player can change.
    for (const g of this.gizmos) setPartCondition(g.mesh, g.part);
  }

  /**
   * Projects this vehicle's local lamp mounts through its interpolated render pose
   * into the shared renderer rig. The game uses this for the driven vehicle and
   * the last vehicle left behind, so its lights remain visible on foot.
   */
  syncProjectedLights(rig: VehicleLightRig): void {
    const headlightBeam =
      this.headlightMode === 'high'
        ? HEADLIGHT_HIGH
        : this.headlightMode === 'low'
          ? HEADLIGHT_LOW
          : HEADLIGHT_LOW;
    const headlightIntensity =
      this.headlightMode === 'off' ? 0 : headlightBeam.intensity * this.headlightEnvironmentFactor;
    for (let i = 0; i < 2; i++) {
      this.syncProjectedBeam(
        rig,
        i,
        this.headlightMounts[i],
        HEADLIGHT_EMISSIVE,
        headlightIntensity,
        headlightBeam,
      );
      this.syncProjectedBeam(
        rig,
        i + 2,
        this.taillightMounts[i],
        TAILLIGHT_EMISSIVE,
        this.taillightBeamIntensity,
        TAILLIGHT_BEAM,
      );
      this.syncProjectedBeam(
        rig,
        i + 4,
        this.reverseLightMounts[i],
        REVERSE_LIGHT_EMISSIVE,
        this.reverseLightBeamIntensity,
        REVERSE_LIGHT_BEAM,
      );
    }
  }

  private syncProjectedBeam(
    rig: VehicleLightRig,
    slot: number,
    mount: VehicleBeamMount | undefined,
    color: THREE.ColorRepresentation,
    intensity: number,
    shape: ProjectedBeamShape,
  ): void {
    const sourceWorld = this.projectedLightSource;
    const targetWorld = this.projectedLightTarget;
    if (mount) {
      sourceWorld
        .copy(mount.sourceLocal)
        .applyQuaternion(this.rootGroup.quaternion)
        .add(this.rootGroup.position);
      targetWorld
        .copy(mount.aimLocal)
        .applyQuaternion(this.rootGroup.quaternion)
        .add(this.rootGroup.position);
    } else {
      sourceWorld.set(0, 0, 0);
      targetWorld.set(0, 0, 0);
      intensity = 0;
    }
    rig.setBeam(
      slot,
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

    this.chassisBody.rotation(this.rotationScratch);
    const loadBlend = dt / (WHEEL_LOAD_TAU + dt);
    // Grip leaves slowly and comes back quickly: see SLIDE_ONSET_TAU.
    const slideOnsetBlend = dt / (SLIDE_ONSET_TAU + dt);
    const slideRecoverBlend = dt / (SLIDE_RECOVER_TAU + dt);
    const tcsAttackBlend = dt / (TCS_ATTACK_TAU + dt);
    const tcsReleaseBlend = dt / (TCS_RELEASE_TAU + dt);
    this.tcsLampS = Math.max(0, this.tcsLampS - dt);

    const spinCeiling = this.drivetrain.maxDrivenWheelSpinRadS;

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
      // radius², inertia with mass·radius².
      const wheelMass = WHEEL_MASS_KG * (w.radius / WHEEL_REFERENCE_RADIUS) ** 2;
      const inertia = 0.5 * wheelMass * w.radius * w.radius;

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
      const authority = clamp(
        (Math.abs(vehicleForwardSpeed) - TCS_AUTHORITY_START_MPS) /
          (TCS_AUTHORITY_FULL_MPS - TCS_AUTHORITY_START_MPS),
        0,
        1,
      );
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
        const capacityN =
          surface.frictionSlip * LONGITUDINAL_GRIP_FRACTION * wheelGrip * tyreGrip * w.loadN;
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
  }

  /**
   * Copies the per-wheel contact, slip and surface data the renderer's sand and
   * gravel spray needs into the pre-allocated `wheelSprayStates`. Runs once per
   * fixed step, after `updateWheelDynamics` has finalised slipRatio/slideT, and
   * never allocates.
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
      s.inContact = w.grounded;
      s.surface = w.groundSurface;
      s.slipRatio = w.slipRatio;
      s.slideT = w.slideT;
      s.forwardSpeed = forwardSpeed;
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
    const next =
      this.brakeLightCommand > 0.03 ? 2 : this.headlightMode === 'off' ? 0 : 1;
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
    const reversing = this.drivetrain.gearLabel === 'R';
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
