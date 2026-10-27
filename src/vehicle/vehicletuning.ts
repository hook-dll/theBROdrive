/**
 * Every static constant the car model is read through: steering, grip and tyre
 * temperature, slip, brakes, wheel inertia and the dig, suspension, roll and pitch,
 * aero and fluids, damage, bounce — plus the handling profiles and the pure helpers
 * they are selected and evaluated with.
 *
 * Nothing here holds state. The runtime that reads it is vehicle.ts, and the
 * constants only the lamps read live in vehiclelamps.ts. The `why` notes travel with
 * the constants they explain.
 */

import { LOOSE_GROUND_SLIDE, SurfaceType, type SurfaceProps, type SurfaceSlide } from '../core/surfaces';
import { FLUID_DENSITY } from '../items/items';
import { variant } from '../parts/registry';
import type { HandlingProfile } from './carmodels';

export const GRAVITY = 9.81;

// ---------------------------------------------------------------------------
// MECHANICAL CHARACTER
//
// The original Soviet cars are 1960s-1980s machinery: a worn
// recirculating-ball box, bias-ply tyres, soft springs on weak dampers, a live rear
// axle, drums at the back and no electronics. Those constants remain the `classic`
// baseline below. Later bodies select `road`, `sport` or `utility`, changing
// only the mechanisms their represented chassis actually changes: steering rate,
// driveline compliance, radial-tyre response, speed loss and axle balance.
//
// Braking, surfaces, damage and suspension integration stay shared. This is one
// vehicle model with data-driven construction, not a second physics path for an
// asset pack.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Steering tuning.
//
// The driver's hands set a RACK TARGET, and the tyres decide the rest:
//  1. The steering keys move a steering-wheel position (KEYBOARD STEERING below): a
//     held key gathering speed like a hand, the road wheels following through the
//     steering ratio, and let go it eases back to centre. A pad stick is a position:
//     with the steering assist on, a share
//     of the angle that puts the front axle at its own peak slip angle
//     (`STEER_ASSIST_SLIP_MARGIN`), measured from where it is travelling; with it off,
//     the whole lock. Autonomy commands a rack angle directly.
//  2. The rack moves toward the target no faster than the profile's rack speed, and the
//     tyres follow it with no free play.
//  3. With no hand on the wheel the tyres are moved by their own aligning moment
//     (`STEER_FREE_TAU_S`, `PNEUMATIC_TRAIL_M`, `SuspensionTuning.frontCasterDeg`).
//
// The constants immediately below are the established `classic` values. They feed
// `HANDLING_PROFILES`; fixedUpdate reads only the selected immutable profile. The car
// the player drives reads a few of them through THE PLAYER'S CAR below.
// ---------------------------------------------------------------------------

/**
 * Rack speed, radians per second at the ROAD WHEEL: how fast a driver's hands can
 * move the tyres, at any speed, the same for the player and the autopilot. 90°/s is
 * about 1450°/s at the rim of a 16:1 recirculating-ball box, a quick pair of hands
 * spinning the wheel; the later racks are quicker. It was 60 for the autopilot and
 * 1.5 × that for the player; one driver's hands are one figure, and the player's was
 * the one a person reaches.
 *
 * It replaces a pair of rates blended by a speed table (2.0 rad/s parked, 0.5 at
 * 100 km/h). The high-speed one was there to keep a held key from asking for too much
 * angle too fast; the keys now move the rim at their own rate (`KEYS_OUT_RATE_RAD_S`)
 * and the pad's assist asks for a few degrees at speed, and the parked one was faster
 * than anyone turns a wheel.
 */
export const STEER_RACK_SPEED_RAD_S = (90 * Math.PI) / 180;
/**
 * THE PAD'S STEERING ASSIST AT SPEED (`SteerMode` 'analogAssist'): a full stick asks for
 * the rack angle that puts the front tyres at their own peak slip angle, and this much
 * past it.
 *
 * The peak is the car's own tyre at its current load (`brushPeakTan`), and the angle is
 * measured from where the front axle is actually travelling, so it is the same rule at
 * every speed: at 100 km/h it is a few degrees, lower down the kinematic angle of the
 * tightest circle the grip holds takes over toward full lock; with the tail out, the
 * front axle is travelling toward the outside of the turn and the countersteer stick
 * reaches past it by the same margin, so catching a slide needs no special case. It
 * replaces a fixed speed table (100% of lock to 20 km/h, 44% at 100) that measured
 * 13-22° of front slip at 60-130 km/h (`tools/steer-feel.ts`) — two to three times the
 * tyre's peak, a plough that also could not be driven INTO, because the table was the
 * limit, not the tyre.
 *
 * The margin puts the target on the far side of the peak, never short of it: the curve
 * is flat there (a brush tyre keeps 99% of its peak force 10% past it), so a full stick
 * costs nothing and the player can still feel the front start to go.
 */
export const STEER_ASSIST_SLIP_MARGIN = 0.1;

/* ---------------------------------------------------------------------------
 * KEYBOARD STEERING (`SteerMode` 'keys'), after BeamNG.drive's keyboard filter ("Key",
 * `lua/vehicle/input.lua`; the idea and the figures, not its code): the steering WHEEL
 * is a position that a held key moves, and that a released key lets ease back to
 * centre. The road wheels follow it one to one through the steering ratio, as they do
 * the mouse's rim, with no play. It replaced HANDS ON WHEEL (a release that spun the
 * rim toward where the front tyres' travel took it, into a countersteer of its own in
 * a slide), which the owner found strange to drive.
 *
 *  1. A HELD KEY GATHERS SPEED like a hand: the rim starts at KEYS_START_RATE_RAD_S and
 *     reaches KEYS_OUT_RATE_RAD_S, linearly, KEYS_RAMP_S into the press, so a tap is a
 *     few degrees of rim and a hold sweeps on quickly. Above KEYS_RATE_REF_MPS all of it
 *     falls as KEYS_RATE_REF_MPS / speed: the hands of a driver whose wheel grows heavy
 *     with speed (the tyres' aligning moment), making the same small correction. One to
 *     one and unscaled, a 60 ms tap at 120 km/h was 0.3 g (tools/tap-response.ts);
 *     scaled, an 80 ms tap is ~0.1 g at 60–150 km/h. Scaling the ROAD WHEELS down with
 *     speed instead (a (30 km/h / v)² ratio and a progressive curve) read as a viscous
 *     wheel, and a constant slow rim with a snap return as a cast-iron one.
 *     The opposite key turns the rim back the same way, its own press ramping afresh.
 *     Both keys down hold the rim where it is (`InputFrame.steerBothHeld`). The touch
 *     wheel's deflection is a target position, a share of the lock, reached the same way.
 *     Nothing stops the rim short of the lock and nothing slows or quickens it by what
 *     the car is doing: a stop at the grip angle and BeamNG's understeer/oversteer rate
 *     shares were tried and read as the game interfering. A held key at speed asks for
 *     more than the tyres have, and the car answers as it would.
 *  2. LET GO, the rim eases back to centre like a real one under its caster: a constant
 *     share of what is left each moment (KEYS_RETURN_TAU_S), never quicker than
 *     KEYS_IN_RATE_RAD_S, and settled at centre inside KEYS_RETURN_SETTLE_RAD. A linear
 *     990°/s took back a tap's few degrees in a few milliseconds, so every correction
 *     was undone the moment the key came up, and the car read as a roly-poly toy.
 *  3. The road wheels follow through the steering ratio (`STEERING_WHEEL_HALF_LOCK_RAD`
 *     / `steerLock`), and the rack speed (`steerRackSpeed`) still applies after.
 * ------------------------------------------------------------------------- */
/** A held key's rim rate once the press has gathered speed, 720°/s (BeamNG's 1.6 × 450°). */
export const KEYS_OUT_RATE_RAD_S = (720 * Math.PI) / 180;
/** A press's rim rate at its first instant, 120°/s: a 40 ms tap is ~6° of rim. */
export const KEYS_START_RATE_RAD_S = (120 * Math.PI) / 180;
/** Seconds into a press at which the rim reaches KEYS_OUT_RATE_RAD_S. */
export const KEYS_RAMP_S = 0.3;
/**
 * Speed above which the whole press rate falls as this over the speed (rule 1): 45 km/h.
 * At 30 km/h an 80 ms tap was 0.07–0.03 g at 90–150 km/h, which the owner found too
 * sheltered; 45 km/h lets the same tap bite half as hard again.
 */
export const KEYS_RATE_REF_MPS = 45 / 3.6;
/** The cap on a released rim's return, 990°/s (BeamNG's 2.2 × 450°): from lock in ~0.5 s. */
export const KEYS_IN_RATE_RAD_S = (990 * Math.PI) / 180;
/** Time constant of a released rim's return: ~95% of the way back in 0.75 s. */
export const KEYS_RETURN_TAU_S = 0.25;
/** Inside this rim angle a released rim is at centre and the hands are off: 2°. */
export const KEYS_RETURN_SETTLE_RAD = (2 * Math.PI) / 180;
/* ---------------------------------------------------------------------------
 * DRIVER AIDS on the player's car, each a setting and off by default (`Settings.abs`,
 * `Settings.tractionControl`). Both work like
 * the autopilot's threshold braking (`modulateBrake`): the pedal is scaled down step by
 * step while the wheels are past their grip and given back over a moment once they
 * roll, so the driver's foot stays the ceiling and the aid only takes away.
 * ------------------------------------------------------------------------- */
/** ABS: only above this speed does a lock matter. */
export const ABS_MIN_KMH = 8;
/** ABS: pedal scale per step while any wheel is locked, its floor, and the recovery, s. */
export const ABS_RELEASE = 0.7;
export const ABS_MIN_SCALE = 0.35;
export const ABS_RECOVER_S = 0.4;
/**
 * TRACTION CONTROL: the driven wheels' surface speed past the car's, as a share of the
 * car's speed (never less than TCS_REF_MPS, so a launch is not all wheelspin), at which
 * the throttle is cut: 0.15 is just past a road tyre's longitudinal peak.
 */
export const TCS_SLIP = 0.15;
export const TCS_REF_MPS = 3;
/** Traction control: throttle scale per step while spinning, its floor, and the recovery, s. */
export const TCS_RELEASE = 0.75;
export const TCS_MIN_SCALE = 0.15;
export const TCS_RECOVER_S = 0.3;

/**
 * FREE STEERING: the steering column's damping, written as the seconds it takes the
 * free wheel to swing one radian under a REFERENCE moment — the front axle's whole
 * static side grip on dry asphalt acting at `PNEUMATIC_TRAIL_M`.
 *
 * The aligning moment about the kingpin is the side force times its lever: the
 * pneumatic trail (`PNEUMATIC_TRAIL_M`, collapsing past the peak) plus the mechanical
 * trail the caster puts the contact patch behind the steering axis
 * (`SuspensionTuning.frontCasterDeg`). It turns the wheel toward where the patch is
 * travelling, and the column's damping decides how fast; the wheel never swings past
 * that direction in a step, because there the moment is gone (a real column's inertia
 * is too small to carry it over). In the tyre's linear range the moment is several
 * times the reference, so the wheel all but snaps to the way the car is going. With the
 * front sliding the pneumatic trail has collapsed and only the caster's lever is left:
 * a Zhiguli's +3°30′ still swings it at about a radian a second, a Volga's +0°30′ at a
 * fifth of that, which is the "light" Volga wheel. A parked car does not steer itself.
 *
 * It is used with no hand on the wheel (keys released with the rim back at centre,
 * stick centred): the whole rack is free, so let go mid-corner and the wheel unwinds
 * toward the way the car is going and the car straightens; let go with the tail out
 * and the same moment countersteers, which is what a real wheel spinning through a
 * driver's loose fingers does. With a hand on it the rack is where the hand puts it.
 */
export const STEER_FREE_TAU_S = 0.3;
/**
 * Uneven-load steering disturbance. A worn front end does not keep both tie rods
 * perfectly aligned when one wheel climbs a bump. The effect is driven by the CHANGE in
 * the left/right suspension-load difference, amplified by rough surfaces, and filtered
 * so one collider triangle cannot teleport the steering wheel.
 *
 * Only the change: the sustained difference a steady bend holds (low-passed over
 * BUMP_STEER_SUSTAINED_TAU and subtracted) is roll, and what roll does to the toe is
 * the kinematic roll steer (`SuspensionTuning.frontRollSteer`). Fed the whole difference
 * this term counted it a second time — and as a toe change whose sign followed the
 * loaded SIDE, so bends one way got toe-out and bends the other way toe-in.
 */
export const BUMP_STEER_MAX_RAD = 0.022;
export const BUMP_STEER_TAU = 0.09;
export const BUMP_STEER_FULL_ROUGHNESS = 0.045;
export const BUMP_STEER_SUSTAINED_TAU = 1;
/**
 * STEERING FREE PLAY: the rack's lash, as the dead band it leaves at the road wheels,
 * radians, per handling profile (`HandlingTuning.steerLash`).
 *
 * Every link between the rim and the tyres has a little slack in it — the worm and
 * roller of a recirculating-ball box, the idler arm, six ball joints on the Zhiguli's
 * three-piece track rod — and a rack-and-pinion has some at the pinion. Turning the rim
 * inside that band moves nothing; past it, the wheels follow. Within it the road wheels
 * are free, and the tyres' own aligning moment takes them wherever it points (the same
 * swing `STEER_FREE_TAU_S` gives a free rack), so an old car on a cambered road wanders
 * a little and needs a constant small correction, and a reversal of the wheel has a
 * moment of nothing before the car answers.
 *
 * The VAZ manuals allow 5° of free play at the rim of a new 2101 and reject a box past
 * 10°; at its 16.4:1 ratio that is 0.3-0.6° at the wheels. A tired Zhiguli on the road
 * today is past the limit, and the owner asked for "a degree or so": the classic
 * profile carries 1°, the working 4x4s 1.2°, the later road cars' racks 0.5° and the
 * rally box 0.3°. Toggled for A/B in the dev menu (`STEERING_DEV.lash`). Only the car
 * the player steers with his own hands has it: under the autopilot and in the traffic a
 * linear controller closes the loop, and the dead band made it weave (see
 * `Vehicle.updateSteering`).
 */
export const STEER_LASH_CLASSIC_RAD = (1 * Math.PI) / 180;
/**
 * COMPLIANCE STEER: the toe the rubber gives under load, radians per newton of tyre
 * force at that wheel.
 *
 * The wishbone, strut and trailing-link bushes, the subframe mounts and the steering
 * linkage's own elasticity all deflect when the tyre pushes on them, and the wheel's
 * toe moves with them. Cars are bushed so that the side force steers each axle toward
 * understeer — the front wheel turned AWAY from the force, reducing its slip angle, the
 * rear one turned INTO it — and it is a real share of a road car's understeer gradient:
 * 0.1-0.3° per kN at the front axle, a quarter to a half of that at the rear
 * (Milliken, Race Car Vehicle Dynamics, 17.3; Gillespie, Fundamentals of Vehicle
 * Dynamics, 8, "lateral force compliance steer"). The figures here are per WHEEL and
 * in the soft half of that range, for old rubber.
 *
 * Braking pulls each front patch back against the bushes, and with the positive scrub
 * radius of every car in this catalogue that toes the wheel OUT
 * (`COMPLIANCE_BRAKE_TOE_RAD_PER_N`): symmetric in a straight stop, so nothing happens,
 * but a wheel braking harder than its partner steers the car toward its side, which is
 * the old-car pull on a split road. A beam axle's wheels are tied to each other and
 * take no brake toe.
 *
 * Read off last step's forces and lagged over the rubber's own time
 * (`COMPLIANCE_STEER_TAU_S`), so the loop the steer makes with the force it changes
 * cannot ring at the step: its gain is the compliance times the cornering stiffness,
 * well under a tenth. Toggled for A/B in the dev menu (`STEERING_DEV.compliance`).
 */
export const COMPLIANCE_STEER_FRONT_RAD_PER_N = ((0.15 * Math.PI) / 180) / 1000;
export const COMPLIANCE_STEER_REAR_RAD_PER_N = ((0.05 * Math.PI) / 180) / 1000;
export const COMPLIANCE_BRAKE_TOE_RAD_PER_N = ((0.06 * Math.PI) / 180) / 1000;
export const COMPLIANCE_STEER_TAU_S = 0.05;
/** The most toe the bushes can give, radians: the rubber's own travel. */
export const COMPLIANCE_STEER_MAX_RAD = (0.6 * Math.PI) / 180;
/**
 * The two steering-feel switches, for an A/B by the owner from the dev menu
 * (ui/menu.ts) and `__bro.steering`. Both on by default; read every step by every car,
 * so a flip takes effect at once.
 */
export const STEERING_DEV = { lash: true, compliance: true };
/**
 * CAMBER THRUST, as a share of the tyre's cornering stiffness per radian of camber. A
 * leaning tyre pushes toward the side it leans to; the textbook ratio of camber to
 * cornering stiffness is 0.1-0.2 (Gillespie, Fundamentals of Vehicle Dynamics, ch. 10;
 * Milliken, Race Car Vehicle Dynamics, ch. 2), a cross-ply carcass at the top of it and
 * a radial, whose stiff belt resists the lean, at the bottom. It enters the tyre as
 * the Magic Formula's own horizontal shift (Pacejka, Tyre and Vehicle Dynamics, 4.3):
 * the curve is read at the slip angle plus `ratio · camber`, so the thrust saturates
 * with the tyre and costs nothing the friction budget does not already charge.
 */
export const CAMBER_STIFFNESS_CROSSPLY = 0.2;
export const CAMBER_STIFFNESS_RADIAL = 0.1;
/**
 * Peak grip lost per degree of camber leaning the tyre AWAY from the force it is
 * making — the outside wheel of a bend tipped onto its outer shoulder. Measured peak
 * side force falls ~1% per degree of positive camber past the optimum (Milliken, ch.
 * 2). One-sided: camber toward the force is already paid for as thrust.
 */
export const CAMBER_GRIP_LOSS_PER_DEG = 0.01;
/**
 * The share of its axle's roll an INDEPENDENT wheel takes as camber against the road,
 * from its front-view swing arm L and the axle's measured track t (`SuspensionTuning.
 * frontSwingArmM`): the body rolls by φ, the outer wheel rises (t/2)·φ against it and its
 * arm leans it back in by (t/2)·φ / L, which leaves `1 − t / 2L` of the roll. Bounded to
 * 0..1: a swing arm shorter than half the track would overcorrect, which no road linkage
 * does, and a beam axle's 0 is never read.
 */
export function rollCamberShare(swingArmM: number, trackM: number): number {
  if (!(swingArmM > 0) || !(trackM > 0)) return 0;
  return Math.min(1, Math.max(0, 1 - trackM / (2 * swingArmM)));
}
/**
 * The most camber an independent wheel's roll gain adds to its static camber, radians
 * (5°). The share above is the linkage's slope at ride height; real camber curves flatten
 * and the arms run out of travel long before the axle's roll limit (`AXLE_ROLL_LIMIT_RAD`,
 * ~9°), so the gain is held inside the band a road car's camber actually sweeps.
 */
export const ROLL_CAMBER_LIMIT_RAD = (5 * Math.PI) / 180;
/**
 * Ceiling on the axle roll the geometry reads, radians (~9°). Past it a wheel is
 * hanging in the air rather than rolling with the body, and its "roll" is droop.
 */
export const AXLE_ROLL_LIMIT_RAD = 0.15;
/**
 * THE TWO-MASS DRIVELINE. The crank, flywheel and gearbox are one mass
 * (`Drivetrain.crankInertiaAtWheelsKgM2`, `I_crank · k²` at the wheels), the driven wheels
 * the other, and everything between — propshaft, axle, half-shafts, U-joints, the rubber
 * in the mounts — one torsional spring and damper, referred to the wheels, stepped with
 * the wheels at the 480 Hz substep (`Vehicle.updateWheelDynamics`). The engine winds the
 * shaft; the shaft, not the engine, pushes the wheels.
 *
 * What it does: the crank against the whole car (`m · r²` through the tyres) is the
 * driveline's SHUFFLE mode, `sqrt(k · J_crank·J_car / (J_crank + J_car)) / 2π`: about
 * 2.6 Hz in first on a VAZ-2101, 3.8 Hz in second, 8 Hz in fourth — the 2-8 Hz band a
 * driveline shuffles in. A stab of throttle winds the shaft and the car surges a little
 * past the pull it then holds, a lift lets it unwind the other way; between shifts the
 * clutch is open and the shaft carries nothing.
 *
 * It replaced a first-order lag on the wheel torque (`DRIVELINE_LAG_S`, 0.1 s, and a
 * per-profile 35-75 ms), which could build the drive late but never overshoot it.
 *
 * Stiffness, N·m per radian of wind-up at the wheels: an ESTIMATE. No catalogue maker
 * publishes it; 8 kN·m/rad is chosen so the shuffle lands in the band above for every
 * car in the catalogue (2-3 Hz in first on the 1.2-1.6 litre cars, the cranks' inertias
 * being derived in drivetrain.ts), one figure for all of them.
 */
export const DRIVELINE_SHAFT_RATE_NM_PER_RAD = 8000;
/**
 * The shaft's damping as a share of critical FOR THE SHUFFLE MODE in the gear the car is
 * in, so every gear rings the same way. 0.4 lets a tip-in surge by a fifth of the pull
 * and settle inside a cycle (tools/chassis-stability.ts): felt, not thrown — this is a
 * kids' game, and a real shuffle at 0.1-0.2 is what car makers spend years tuning out.
 * The tyres damp the mode further. The same damper ties a wheel that loses its load to the
 * crank within milliseconds, which is what keeps a bump from flicking it into a spin.
 */
export const DRIVELINE_SHAFT_DAMPING_RATIO = 0.4;

// ---------------------------------------------------------------------------
// Lateral grip budget.
//
// The tyre model makes every side and longitudinal force itself (`Vehicle.
// updateWheelDynamics`). What is left of the old ray-cast vehicle's friction cone
//     maxImp = suspension_force * dt * friction_slip
// is the parked hold's (`TyreContacts.holdBrake`, the brake counted half against
// it), and `friction_slip` there is the surface's coefficient times this fraction.
// ---------------------------------------------------------------------------

/**
 * Fraction of the surface's frictionSlip that acts as the lateral grip budget.
 *
 * Bias-ply, not radials. 0.4 gave a ~1 g peak, which is a modern tyre on a good
 * road; a period cross-ply on a 1970s road surface is 0.7-0.8 g, and it gives up
 * progressively rather than at a cliff edge.
 */
export const LATERAL_GRIP_FRACTION = 0.33;
/** Chassis mass (kg) at which the grip budget is unscaled. */
export const GRIP_REFERENCE_MASS = 1100;
/**
 * The budget scales with (reference/mass)^GRIP_MASS_EXPONENT: a laden truck or
 * bus gets a smaller budget per kilogram, so it corners worse than a hatchback
 * even though its tyres carry more load — road tyres are sized to the chassis,
 * not scaled with it.
 */
export const GRIP_MASS_EXPONENT = 0.3;
/*
 * There was a SIDE_FRICTION_GAIN here: 0.7, the gain on Rapier's lateral constraint,
 * documented as "a period car's vagueness — a 40-60 km/h corner runs 4-6 degrees of
 * slip". It never did. A velocity-cancelling constraint has no curve under it, so the
 * measured figure was 1.2-1.4 degrees whatever this number was, and the gain only
 * decided how hard the rail was. LATERAL_MU and the slip-angle curve now produce that
 * slip for real, so the knob is gone rather than left to imply something it never did.
 */
/**
 * TYRE TEMPERATURE, and why it replaced a speed falloff.
 *
 * The lateral channel used to shed up to 26% of its grip between 50 and 144 km/h,
 * more of it at the rear, on the story that a bias-ply carcass squirms and heats at
 * speed. The mechanism is real; the implementation was not a mechanism at all. Speed
 * does not remove grip from a tyre — HEAT does, and only past the point where the
 * tread compound has gone off. Written as a function of speed it could not tell a
 * tyre that had just come up to temperature from one that had been sliding for a lap,
 * and it charged the same 26% to a car cruising a straight as to one scrubbing a
 * roundabout, which is not what temperature does to anything.
 *
 * So the tyre now has a temperature, and the temperature has the grip.
 *
 *   heat in   the power dissipated at the contact patch: force times true slip speed,
 *             longitudinal plus lateral. This is the honest source — it is where the
 *             energy in a sliding tyre goes — and it is why a hard-driven car heats
 *             its tyres and a cruising one does not.
 *   heat out  Newton's law against the air, with the film coefficient rising with
 *             airflow: a tyre at 100 km/h sheds heat several times faster than one in
 *             a car park, which is what keeps a long motorway run from cooking them.
 *
 * THE REFERENCE COEFFICIENT IS THE COLD ONE, so this changes nothing at ambient: a
 * bench that runs for thirty seconds reads exactly the numbers it always did. Grip
 * then RISES to an optimum as the tyre comes in, and falls away past it — which makes
 * the thing a driver can feel: a car is quicker after a few corners than on its first
 * one, and a tyre abused into overheating goes off and stays off until it cools.
 *
 * NOT MODELLED: tread wear, pressure, and what happens past the maximum. The
 * temperature is clamped there rather than allowed to run away, because a model that
 * can report 900 degrees is reporting the absence of a model.
 */
/**
 * THE HEAT CAPACITY THE MODEL ACTUALLY INTEGRATES, J/K, and why it is not the tyre's.
 *
 * The whole wheel really does hold about 22 kJ/K, and integrating that gives a time
 * constant of an hour: a tyre on this model would take most of a session to reach
 * anything, and the one thing the temperature exists to provide — a grip that is
 * different after a hard corner than before it — would never arrive.
 *
 * What heats is the TREAD, not the rim. A couple of kilograms of rubber and the outer
 * carcass is where the hysteresis and the sliding friction both land, and it is
 * thermally much lighter than the wheel it is bonded to: 4 kJ/K is about 2.5 kg of
 * rubber, which is a fair figure for the tread band of one of these tyres.
 *
 * So the model integrates the tread's capacity, not the wheel's. That is a real
 * simplification rather than a fudge, and it is the one that makes the state usable:
 * a hard-driven tyre reaches its optimum in a couple of minutes of abuse and a
 * cruising one creeps up over a long run, which is what both of those feel like.
 */
export const TYRE_TREAD_CAPACITY_J_PER_K = 4_000;
/**
 * Convective loss per kelvin of tyre over ambient, W/K: a still one, and how much
 * that rises per sqrt(m/s) of airflow.
 *
 * sqrt because forced convection over a cylinder goes with the square root of the
 * Reynolds number, and Reynolds is linear in speed. A parked tyre therefore sits at
 * whatever the sun put in it, and one at 30 m/s sheds roughly three times as fast.
 */
export const TYRE_COOLING_STILL_W_PER_K = 3.2;
export const TYRE_COOLING_AIRFLOW_GAIN = 0.85;
/**
 * The share of the contact patch's slip power that ends up in the TYRE rather than in
 * the road or carried off by the grit being scrubbed off it.
 *
 * A lumped stand-in for a brush model: only the rear of the contact patch is actually
 * sliding, so the kinematic slip speed overstates the energy that reaches the carcass
 * by roughly an order of magnitude. Sized so a car driven hard on a twisty road
 * settles 20-30 K above ambient, which is what a road tyre does.
 */
export const TYRE_SLIP_HEAT_SHARE = 0.1;
/**
 * Share of the ROLLING-RESISTANCE power that ends up in the tyre, and the reason this
 * term has to exist at all.
 *
 * Slip power alone cannot bring a tyre up to temperature: driving in a straight line
 * at a steady speed has almost no slip, so a model built only on `F · v_slip` reports
 * a tyre that never warms — and a grip curve whose optimum sits 45 K away from where
 * the car can actually get it is a curve with one dead half. What heats a tyre on the
 * road is HYSTERESIS: the tread deforming and springing back through every revolution
 * dissipates a fixed fraction of the energy the tyre loses to rolling drag, and that
 * drag is exactly what rolling resistance IS. A real mechanism, not a fudge.
 *
 * A quarter, so a car cruising on asphalt settles 20-30 K above the air, which is what
 * a road tyre actually reads — while a tyre being dragged sideways still heats far
 * faster, because slip power dominates the moment there is any real sliding.
 */
export const TYRE_ROLLING_HEAT_SHARE = 0.25;
/**
 * Temperature the reference grip coefficient is quoted at, degrees C, and the window
 * either side of it.
 *
 * `TYRE_REFERENCE_C` is ambient in this desert and the factor is exactly 1 there, so
 * nothing about the straight-line calibration moves.
 *
 * The optimum is a ROAD tyre's, not a racing one's: 60 C is where a cross-ply on a
 * Soviet asphalt road actually makes its best grip, and it is deliberately close to
 * what a car reaches cruising on this road (see the cooling figures). So a long run
 * leaves the tyres near their best, a cold car is a little off it, and abuse takes
 * them past it — which is the three states the model is for.
 */
export const TYRE_REFERENCE_C = 30;
export const TYRE_OPTIMUM_C = 60;
export const TYRE_MAX_C = 120;
/** Extra grip available at the optimum, as a fraction of the reference figure. */
export const TYRE_PEAK_GRIP_GAIN = 0.08;
/** Grip lost by the maximum, as a fraction: a tyre that has gone off is greasy. */
export const TYRE_OVERHEAT_LOSS = 0.22;
/**
 * Grip multiplier for a tyre at this temperature, 1.0 at the reference. It scales the
 * tyre's one coefficient, so drive, braking and cornering all feel it together.
 *
 * Rises smoothly to the optimum, then falls away: `smoothstep` at both ends so there
 * is no kink at either shoulder, and the second leg is steeper than the first because
 * a tyre goes off faster than it comes in.
 */
export function tyreTemperatureGrip(tempC: number): number {
  if (tempC <= TYRE_REFERENCE_C) return 1;
  if (tempC <= TYRE_OPTIMUM_C) {
    const t = (tempC - TYRE_REFERENCE_C) / (TYRE_OPTIMUM_C - TYRE_REFERENCE_C);
    return 1 + TYRE_PEAK_GRIP_GAIN * t * t * (3 - 2 * t);
  }
  const t = Math.min(1, (tempC - TYRE_OPTIMUM_C) / (TYRE_MAX_C - TYRE_OPTIMUM_C));
  return (
    1 +
    TYRE_PEAK_GRIP_GAIN -
    (TYRE_PEAK_GRIP_GAIN + TYRE_OVERHEAT_LOSS) * t * t * (3 - 2 * t)
  );
}

/**
 * Rear-axle lateral grip, as a fraction of the front's.
 *
 * A live axle on leaf springs steers itself under roll and load: the axle tramps, the
 * springs wind up, and the outer tyre runs at a slip angle the driver never asked for.
 *
 * 0.95, not 0.89. The old figure was authored to make the tail the end that goes, back
 * when nothing else could: the constraint model had no load transfer worth the name and
 * no combined-slip trade, so balance had to be written in by hand. Both exist now —
 * mu(Fz) means the loaded outer tyre gives up first and combined slip means a driven
 * rear spends its side grip on power — so the authored deficit is stacked on top
 * of emergent ones, and the stack was the rear sliding in every corner in every car.
 */
export const REAR_AXLE_SIDE_GRIP = 0.95;

// ---------------------------------------------------------------------------
// Slip angle: the difference between a car that PLOUGHS and one you can catch.
//
// Everything above this block loses grip for LONGITUDINAL reasons — the budget a
// drive or brake slip takes from the side force (COMBINED SLIP), a locked wheel.
// A pure cornering breakaway has neither: lift off mid-bend, turn in too hard, and
// the tyres are barely using their longitudinal channel at all. Before the tyre
// model, the only thing that limited such a corner was Rapier clipping the side
// impulse at the cone, which is a CEILING, not a curve.
//
// A real tyre makes its peak side force at a few degrees of slip angle (the brush
// tyre's peak, `brushPeakTan`), then gives force back as the patch slides — but to
// the rubber's SLIDING friction, not to zero, and that is what makes a slide
// something you can fight. How much it gives back is not a property of the angle: it
// is the friction of rubber sliding over the road at the patch's sliding speed
// (SLIDING FRICTION below). On loose ground the old angle plateau stands in for it
// (`SurfaceSlide`, the loose-ground placeholder).
// ---------------------------------------------------------------------------

/**
 * Peak slip angles encode axle cornering stiffness, for a car whose model names no
 * tyre (`tyreCurve`). Rear tyres remain slightly stiffer near centre for
 * straight-line stability; a 6.6° front peak retains mild understeer without making
 * it the only handling state.
 */
export const SLIP_PEAK_FRONT_DEG = 6.6;
export const SLIP_PEAK_REAR_DEG = 6;
/**
 * Loose ground does not gain this extra resistance until a tyre is genuinely
 * travelling sideways. Below the start it still has only its ordinary cornering
 * coefficient; by the full speed it is ploughing a bank of material.
 */
export const DEFORMATION_DRAG_START_MPS = 1.5;
export const DEFORMATION_DRAG_FULL_MPS = 8;
/** Contact speed (m/s) floor in the slip-angle denominator, to keep it finite at rest. */
export const SLIP_ANGLE_REF_MPS = 2;
/**
/**
 * Forward speed (m/s) below which a tyre may spend its whole lateral capacity on
 * holding rather than on a slip-angle curve. A shade under walking pace: fast enough
 * that parking, kerbing and creeping on a camber behave like rubber on tarmac,
 * slow enough that it can never help a moving car corner.
 */
export const LATERAL_STATIC_SPEED_MPS = 1.4;

/**
 * Pneumatic trail at zero slip, metres: how far BEHIND the contact centre (along the
 * direction the tyre is rolling) its side force acts while the whole patch still grips.
 *
 * A real tyre's patch loads up toward its rear as it slips, so the side force arrives
 * with a lever about the vertical, and it acts in two places. On the BODY it is where
 * the force's line of action really is: the tyre pass applies the force at the contact
 * centre, so this moment is the correction that moves it back, not a second force. On
 * the STEERING it is most of the aligning moment that turns the wheel toward where the
 * patch is travelling (`STEER_FREE_TAU_S`); the caster's mechanical trail adds the rest
 * there and only there, because on the body the force is already applied where the
 * patch is.
 *
 * It collapses as the patch starts to slide from the back (`pneumaticTrailShape`), and
 * that collapse is what a driver feels as the wheel going light at the limit. It used to
 * be held constant at this value through the whole slide on the argument that, with no
 * way to feel the collapse, it was better left out; it is felt now (the free steering,
 * the pad's rumble), and a constant trail had a sliding car's own side force yawing it
 * back out of the slide with a lever the tyre no longer had.
 *
 * 0.045 m is a period cross-ply's figure for small slip.
 */
export const PNEUMATIC_TRAIL_M = 0.045;

/**
 * The pneumatic trail as a share of `PNEUMATIC_TRAIL_M` at the patch's normalised
 * combined slip `z` (σ in the COMBINED SLIP block, 1 once the whole patch slides): the brush
 * model's own result with the parabolic pressure `brushShape` uses,
 *
 *     t / t0 = 3 (1 − z)³ / (3 − 3z + z²)
 *
 * which is 1 at no slip, about half by a quarter of the way to the peak, and 0 once the
 * whole patch slides (Pacejka, Tyre and Vehicle Dynamics, 3.2).
 */
export function pneumaticTrailShape(z: number): number {
  if (z >= 1) return 0;
  const s = Math.max(0, z);
  const free = 1 - s;
  return (3 * free * free * free) / (3 - 3 * s + s * s);
}

/**
 * The brush tyre's aligning moment about its steering axis under pure side slip, as a
 * share of `capacity · PNEUMATIC_TRAIL_M`, at normalised slip `z`: the side force
 * `1 − (1 − z)³` times the lever, pneumatic trail (`pneumaticTrailShape`) plus the
 * caster's mechanical trail as `casterRatio` of the pneumatic one. It rises steeply,
 * peaks well short of the side force's own peak, and falls to the mechanical trail's
 * share alone once the patch slides: the wheel going light.
 */
export function aligningMomentShape(z: number, casterRatio: number): number {
  const free = 1 - Math.min(1, Math.max(0, z));
  return (1 - free * free * free) * (pneumaticTrailShape(z) + casterRatio);
}

/** Where `aligningMomentShape` peaks for this caster, and its value there. */
export function aligningMomentPeak(casterRatio: number): { readonly z: number; readonly shape: number } {
  let z = 0;
  let shape = 0;
  for (let i = 1; i <= 100; i++) {
    const value = aligningMomentShape(i / 100, casterRatio);
    if (value > shape) {
      shape = value;
      z = i / 100;
    }
  }
  return { z, shape };
}

/**
 * Mechanical handling families. The Soviet catalogue stays on `classic`, preserving
 * its slow recirculating-ball steering and live-axle balance. The GTA SA conversions
 * span later road cars and working 4x4/van chassis; forcing all of them through that
 * Soviet baseline is why visually modern cars felt delayed, vague and tail-light. The
 * TYRE is not the profile's: every road car runs the KAMA road tyre
 * (`KAMA_217` in carmodels.ts), whatever its profile.
 */
export interface HandlingTuning {
  /** Rack speed, rad/s at the road wheel: see `STEER_RACK_SPEED_RAD_S`. */
  readonly steerRackSpeed: number;
  readonly bumpSteer: number;
  readonly lateralGripFraction: number;
  /**
   * Cornering scale on top of the tyre's own coefficient, for the profiles whose cars
   * do NOT run the KAMA road tyre: `utility` (the Niva's and the UAZs' block treads)
   * and `sport` (the rally 2105's competition tyre). No data replaces these two, so
   * they stay as authored. 1.0 on `classic` and `road`: their cars share the one road
   * tyre, and a profile multiplier on it (`road` was 1.0824) had no source.
   */
  readonly tyreLateralScale: number;
  readonly rearAxleSideGrip: number;
  readonly slipPeakFrontDeg: number;
  readonly slipPeakRearDeg: number;
  readonly tyreRelaxationLength: number;
  /** The steering's free play at the road wheels, radians: see `STEER_LASH_CLASSIC_RAD`. */
  readonly steerLash: number;
}

/**
 * The tyre's side-force geometry, per axle: see `tyreCurve`. The peak angles size the
 * brush tyre (`brushPeakTan`) on every surface; `full*` and `plateau*` are the
 * loose-ground placeholder's angle fade (`looseSideShape`) and are read nowhere else.
 */
export interface TyreCurve {
  readonly peakFrontDeg: number;
  readonly peakRearDeg: number;
  readonly fullFrontDeg: number;
  readonly fullRearDeg: number;
  readonly plateauFront: number;
  readonly plateauRear: number;
  readonly relaxationM: number;
  /** Longitudinal relaxation length, metres: see `LONGITUDINAL_RELAXATION_RATIO`. */
  readonly longitudinalRelaxationM: number;
}

/** The aspect of the road radial (`KAMA_217`), for a car whose model names no tyre. */
const ROAD_RADIAL_ASPECT = 0.7;

/**
 * THE CAR'S OWN TYRE, from its sidewall:
 *
 *   peak slip angle   a cross-ply carcass needs about 8 degrees to reach its peak; a
 *                     radial's peak falls with its sidewall, 3 + 4 · aspect (6.3 at
 *                     an 82-series, 5 at a 50), the spread road tests measure.
 *   relaxation        the rolling distance to build force: 0.45 m for cross-ply, and
 *                     0.1 + 0.3 · aspect for a radial, from 0.35 m at 82-series down to
 *                     0.24 m at 45 — tall rubber lags, low rubber answers at once. The
 *                     longitudinal one is LONGITUDINAL_RELAXATION_RATIO of it.
 *   loose breakaway   ON LOOSE GROUND ONLY (the placeholder, `SurfaceSlide`): what the
 *                     tyre keeps past its peak by slip angle and how soon it gets
 *                     there. A cross-ply fades to 0.86 by 30 degrees, a tall radial to
 *                     0.84 by 26, a 45-series to 0.72 by 20. On a paved surface the
 *                     force past the peak is sliding friction (SLIDING FRICTION).
 *
 * The rear peaks 0.6 degrees before the front and reaches its loose plateau 4 degrees
 * sooner. A car whose model names no tyre runs its handling profile's peak angles and
 * relaxation, with the road radial's loose breakaway.
 */
export function tyreCurve(spec: { construction: 'crossply' | 'radial'; aspect: number } | undefined, handling: HandlingTuning): TyreCurve {
  const aspect = Math.min(1, Math.max(0.3, spec?.aspect ?? ROAD_RADIAL_ASPECT));
  const crossply = spec?.construction === 'crossply';
  const peak = crossply ? 8 : 3 + 4 * aspect;
  const full = crossply ? 30 : 12 + 17 * aspect;
  const plateau = Math.min(0.88, crossply ? 0.86 : 0.72 + 0.35 * (aspect - 0.45));
  const relaxation = !spec ? handling.tyreRelaxationLength : crossply ? 0.45 : 0.1 + 0.3 * aspect;
  return {
    peakFrontDeg: spec ? peak : handling.slipPeakFrontDeg,
    peakRearDeg: spec ? peak - 0.6 : handling.slipPeakRearDeg,
    fullFrontDeg: full,
    fullRearDeg: full - 4,
    plateauFront: plateau,
    plateauRear: plateau,
    relaxationM: relaxation,
    longitudinalRelaxationM: LONGITUDINAL_RELAXATION_RATIO * relaxation,
  };
}

/**
 * THE CARCASS UNDER LOAD: the relaxation length as the tyre stands this step.
 *
 * A tyre's relaxation length is not a property of its rubber alone. In the stretched-
 * string model it is the cornering stiffness over the carcass's own LATERAL stiffness,
 * `σ = Cα / c_y` (Pacejka, Tyre and Vehicle Dynamics, 5.3): how far the patch must roll
 * before the belt has been pulled sideways enough to carry the side force a slip angle
 * asks for. Both halves move with load. Cα grows as `Fz^0.7` here already
 * (`BRUSH_STIFFNESS_LOAD_EXPONENT`); the carcass's lateral stiffness grows too, but
 * more slowly — pressed harder, the sidewall is pre-tensioned and the patch longer, so
 * the belt resists being pulled aside a little more (`CARCASS_LATERAL_LOAD_EXPONENT_*`).
 * The ratio is the length:
 *
 *   σ(Fz) = σ0 · (Fz / Fz0)^(0.7 − e),    e the carcass's exponent
 *
 * so a loaded outside tyre answers a new angle LATER and an unloaded inside one sooner,
 * as measured: MF 6.1's `σα = PTy1 · sin(2 atan(Fz / (PTy2 Fz0)))` rises at about
 * Fz^0.6 across a car's working loads for the passenger tyres it is fitted to.
 *
 * The carcass's compliance — 1 / c_y — is therefore load-dependent through the same
 * figure; nothing else in the model reads it, because the relaxation length is the
 * only place a lateral carcass deflection enters the force.
 *
 * A CROSS-PLY STAYS SOFTER THAN A RADIAL at every load: its σ0 is longer (`tyreCurve`),
 * and its plies, laid on the bias, stiffen less under load than a radial's steel belt
 * does, so its exponent is the larger one. Both lengths are bounded so a corner lifted
 * to nothing does not build its force in zero distance, nor a slammed one never.
 *
 * INFLATION PRESSURE IS NOT MODELLED, and deliberately so: no model in the catalogue
 * carries a pressure, every car is assumed at its book pressure, and a per-model
 * nominal figure would only rescale σ0 — which `tyreCurve` already sets from the
 * construction and sidewall — without anything else in the tyre reading it.
 */
export const CARCASS_LATERAL_LOAD_EXPONENT_RADIAL = 0.2;
export const CARCASS_LATERAL_LOAD_EXPONENT_CROSSPLY = 0.1;
/** The load ratio band σ(Fz) is read over: a quarter of the mean corner load to twice it. */
export const RELAXATION_LOAD_RATIO_MIN = 0.25;
export const RELAXATION_LOAD_RATIO_MAX = 2;

/** σ(Fz) / σ0 for this construction at `loadRatio` = Fz over the car's mean corner load. */
export function relaxationLoadScale(loadRatio: number, crossply: boolean): number {
  const ratio = Math.min(RELAXATION_LOAD_RATIO_MAX, Math.max(RELAXATION_LOAD_RATIO_MIN, loadRatio));
  const carcass = crossply ? CARCASS_LATERAL_LOAD_EXPONENT_CROSSPLY : CARCASS_LATERAL_LOAD_EXPONENT_RADIAL;
  return ratio ** (BRUSH_STIFFNESS_LOAD_EXPONENT - carcass);
}

// ---------------------------------------------------------------------------
// SLIDING FRICTION: what a sliding patch keeps on a paved surface.
//
// Rubber sliding over a road holds less than rubber gripping it, and less the faster
// it slides, from the peak coefficient towards the locked-wheel one:
//
//     μ(V_s) = μ_k + (μ_p − μ_k) · exp(−V_s / V0)          r = μ(V_s) / μ_p
//
// V_s is the patch's combined sliding speed, m/s: the hypot of its sideways speed and
// the tread's speed over the road along the wheel. μ_p is the tyre's capacity as it
// always was; μ_p / μ_k is the surface's (`SurfaceSlide`): 1.13 on dry asphalt and
// 1.30 on wet, which is what ABS gains over a locked wheel (MDPI Sustainability 2023,
// 15(8), 6945, https://www.mdpi.com/2071-1050/15/8/6945), blended by the weather's
// wetness. PennDOT's Little Book of Tire Pavement Friction finds the same on dry
// roads: little difference between peak and sliding, and little effect of speed.
//
// V0 is an ASSUMPTION, not a measurement: that the locked-wheel coefficient is reached
// once the patch slides at a few metres a second, the speeds skid tests run at.
//
// It replaces two authored plateaus: the side force fading by slip ANGLE to 0.7-0.88
// of its peak, and a locked or spinning tyre keeping a constant three quarters of its
// capacity. Both now come from how fast the rubber is sliding, in the brush tyre's
// sliding zone (`brushShape`). Loose ground keeps the plateaus as a placeholder.
// ---------------------------------------------------------------------------

/** V0 in μ(V_s), m/s: see SLIDING FRICTION. An assumption. */
export const SLIDING_DECAY_MPS = 5;

/**
 * The floor `slidingRatio` decays to on this surface in this weather: μ_k / μ_p on a
 * paved surface, the placeholder's constant sliding share on loose ground.
 */
export function slidingFloor(slide: SurfaceSlide, wet: number): number {
  if (slide.kind === 'loose') return slide.share;
  return 1 / (slide.dryPeakRatio + (slide.wetPeakRatio - slide.dryPeakRatio) * wet);
}

/** r = μ(V_s) / μ_p on a paved surface, for the floor `slidingFloor` gave. */
export function slidingRatio(floor: number, slideSpeedMps: number): number {
  return floor + (1 - floor) * Math.exp(-slideSpeedMps / SLIDING_DECAY_MPS);
}

/**
 * THE BRUSH TYRE: the force model on every paved surface, both ways.
 *
 * The tread is a row of bristles on the belt. Each one is carried through the contact
 * patch and deflects with the slip until the grip under it runs out, from the back of
 * the patch forward. With the load pressed over the patch as a parabola, a bristle
 * holds until its force reaches the PEAK coefficient μ_p and then slides at μ(V_s)
 * (SLIDING FRICTION), so the force as a fraction of μ_p Fz is the adhesion zone plus
 * the sliding zone's share of the load:
 *
 *     s(z) = 3z(1 − z)² + r · (3z² − 2z³)   for z < 1, and r once the whole patch slides
 *     z    = tan α · Cα / (3 μ_p Fz)        (sideways; along, κ over its own unit)
 *
 * With r = 1 it is the one-coefficient brush, 3z − 3z² + z³, peaking at 1 where the
 * last bristle lets go; with r < 1 it peaks at z = 1/(3 − 2r), a little sooner and a
 * little lower, and falls to r. Its slope at zero slip is 3 whatever r is, so the
 * cornering stiffness does not depend on the sliding coefficient. (Pacejka, Tyre and
 * Vehicle Dynamics, 3.2.)
 *
 * The angle the tyre peaks at is not a constant: cornering stiffness Cα grows more
 * slowly than load (`BRUSH_STIFFNESS_LOAD_EXPONENT`), so a tyre pressed harder reaches
 * its peak LATER and a light one sooner — the outside front of a car loaded into a
 * bend needs more lock than it did in a straight line, and a light inside tyre lets
 * go at small angles. At the car's mean corner load z = 1 at the `TyreCurve`'s peak angle.
 */
export function brushShape(z: number, r: number): number {
  if (z >= 1) return r;
  const free = 1 - z;
  return 3 * z * free * free + r * z * z * (3 - 2 * z);
}

/** d`brushShape`/dz: 3(1 − z)(1 − 3z + 2rz), 0 once the whole patch slides. */
export function brushShapeSlope(z: number, r: number): number {
  if (z >= 1) return 0;
  return 3 * (1 - z) * (1 - 3 * z + 2 * r * z);
}

/** The brush tyre's most force, at z = 1/(3 − 2r), as a fraction of μ_p Fz. */
export function brushPeak(r: number): number {
  return brushShape(1 / (3 - 2 * r), r);
}

/** Cα ∝ Fz^this: 0.7 is a passenger radial's measured sublinear growth. */
export const BRUSH_STIFFNESS_LOAD_EXPONENT = 0.7;

/**
 * The brush tyre's peak, as the TANGENT of the angle it peaks at for this load:
 * `loadRatio` is Fz over the car's mean corner load and `muRatio` the load-sensitivity factor
 * already in the capacity. Its side slip `z` is `tan α` over this, so z = 1 where the
 * whole patch slides.
 */
export function brushPeakTan(staticPeakDeg: number, loadRatio: number, muRatio: number): number {
  const ratio = Math.max(0.05, loadRatio);
  // Cα / (μ Fz) at the reference load, from the reference peak: z reaches 1 there.
  const stiffness = 3 / Math.tan((staticPeakDeg * Math.PI) / 180);
  const scale = (stiffness * ratio ** BRUSH_STIFFNESS_LOAD_EXPONENT) / (ratio * Math.max(0.05, muRatio));
  return 3 / scale;
}

/**
 * THE LOOSE-GROUND PLACEHOLDER's side force under PURE side slip, as a fraction of
 * capacity (`SurfaceSlide`): the one-coefficient brush, 3z − 3z² + z³ with
 * z = tan α / `peakTan`, faded by slip ANGLE to the tyre's `plateau` between
 * `fadePeakDeg` (the brush's own peak, held a degree short of `fullDeg`) and `fullDeg`.
 * Authored, not measured; it stands until loose ground has a terramechanics model.
 */
export function looseSideShape(
  slipRad: number,
  peakTan: number,
  fadePeakDeg: number,
  fullDeg: number,
  plateau: number,
): number {
  const slipDeg = (slipRad * 180) / Math.PI;
  const risen = brushShape(Math.tan(Math.min(slipRad, 1.4)) / peakTan, 1);
  const fadeT = Math.min(1, Math.max(0, (slipDeg - fadePeakDeg) / (fullDeg - fadePeakDeg)));
  return risen * (1 - (1 - plateau) * fadeT * fadeT * (3 - 2 * fadeT));
}

// ---------------------------------------------------------------------------
// COMBINED SLIP: one patch, one budget, spent both ways.
//
// A tyre's two slips are two components of ONE sliding of the tread over the road, so
// the force each direction gets is decided by both. The model is the normalised-slip
// one: each slip is measured in its own unit,
//
//     σx = κ / κ_unit               κ_unit = `longitudinalSlipUnit`
//     σy = tan α / tan α_peak       (the brush's z)
//     σ  = √(σx² + σy²)
//
// and each channel reads its pure-slip curve at the combined σ and keeps the share
// of it that its slip is of the whole:
//
//     Fx = Cap_x · Fx_pure(σ) · σx/σ        Fy = Cap_y · Fy_pure(σ) · σy/σ
//
// On a paved surface both pure curves are the one brush (`brushShape`) at one sliding
// ratio, and σ = 1 is the whole patch sliding both ways: the combined brush tyre. On
// loose ground each channel reads its placeholder curve (`looseLongitudinalShape`,
// `looseSideShape`), with σ = 1 at each one's peak.
//
// With the other slip zero this IS the pure curve, and near zero slip it reduces to
// each channel's own pure stiffness (Fx_pure(σ)/σ → its slope). Only when both slips
// are present does anything change, and then it changes BOTH ways: drive or brake slip
// shrinks the side force, and slip angle shrinks the drive and brake force.
//
// A locked wheel needs no constant of its own. At κ = -1 its σx is several times its
// σy, so the side share is small and grows with slip angle, the way a sliding patch's
// force follows its sliding direction (`tools/combined-slip.ts` prints it).
// ---------------------------------------------------------------------------

/**
 * THE LOOSE-GROUND PLACEHOLDER's longitudinal curve under pure slip (`SurfaceSlide`),
 * as a fraction of capacity, at `u = κ / optimalSlip`: a peak term that decays past
 * u = 1 blended with the surface's constant sliding `share`, so a spinning or locked
 * tyre keeps that share of its grip. Odd in `u`. Its true maximum is at
 * `LONGITUDINAL_PEAK_U`. The pure 2u/(1+u²) alone decays like 1/u, and a standing
 * start (u ≈ 25) then delivered 8% of the grip: the share carries it.
 */
export function looseLongitudinalShape(u: number, share: number): number {
  return (1 - share) * ((2 * u) / (1 + u * u)) + share * Math.tanh(SLIDE_CURVE_GAIN * u);
}

/** d`looseLongitudinalShape`/du. Even in `u`; negative past the peak. */
export function looseLongitudinalShapeSlope(u: number, share: number): number {
  const th = Math.tanh(SLIDE_CURVE_GAIN * u);
  const d = 1 + u * u;
  return (1 - share) * ((2 * (1 - u * u)) / (d * d)) + share * SLIDE_CURVE_GAIN * (1 - th * th);
}

/**
 * The slip ratio that counts as ONE in combined slip (σx = κ / this): on loose ground
 * the placeholder curve's peak, `optimalSlip · LONGITUDINAL_PEAK_U`; on a paved surface
 * the brush's whole-patch slide, `optimalSlip · LONGITUDINAL_FULL_U`.
 */
export function longitudinalSlipUnit(surface: SurfaceProps): number {
  return surface.optimalSlip * (surface.slide.kind === 'paved' ? LONGITUDINAL_FULL_U : LONGITUDINAL_PEAK_U);
}

/**
 * Longitudinal force as a fraction of the longitudinal capacity under combined slip:
 * `longSlip` is σx (signed), `sideSlip` σy (see the block above). `loose` picks the
 * loose-ground placeholder, and `slide` is its sliding share there, the sliding ratio
 * r (`slidingRatio`) on a paved surface.
 */
export function combinedLongitudinal(longSlip: number, sideSlip: number, loose: boolean, slide: number): number {
  const total = Math.hypot(longSlip, sideSlip);
  if (total < 1e-9) return 0;
  const shape = loose ? looseLongitudinalShape(total * LONGITUDINAL_PEAK_U, slide) : brushShape(total, slide);
  return (shape * longSlip) / total;
}

/**
 * d`combinedLongitudinal`/dσx at a fixed `slide`: the pure slope along the slip
 * direction, plus the secant the lateral share holds the force on. At `sideSlip = 0`
 * it is the pure curve's own slope.
 */
export function combinedLongitudinalSlope(longSlip: number, sideSlip: number, loose: boolean, slide: number): number {
  const total = Math.hypot(longSlip, sideSlip);
  if (total < 1e-9) return loose ? LONGITUDINAL_PEAK_U * looseLongitudinalShapeSlope(0, slide) : brushShapeSlope(0, slide);
  const cx = longSlip / total;
  const cy = sideSlip / total;
  if (loose) {
    const u = total * LONGITUDINAL_PEAK_U;
    return (
      LONGITUDINAL_PEAK_U * looseLongitudinalShapeSlope(u, slide) * cx * cx +
      (looseLongitudinalShape(u, slide) / total) * cy * cy
    );
  }
  return brushShapeSlope(total, slide) * cx * cx + (brushShape(total, slide) / total) * cy * cy;
}

/**
 * Side force as a fraction of the lateral capacity under combined slip, times σy/σ:
 * the brush at the combined σ on a paved surface, the placeholder (`looseSideShape`,
 * whose arguments the curve ones are) read at the angle whose σy is σ on loose ground.
 * `sideSlip` is σy ≥ 0, `longSlip` σx; `loose` and `slide` as `combinedLongitudinal`.
 */
export function combinedLateral(
  sideSlip: number,
  longSlip: number,
  peakTan: number,
  fadePeakDeg: number,
  fullDeg: number,
  plateau: number,
  loose: boolean,
  slide: number,
): number {
  const total = Math.hypot(longSlip, sideSlip);
  if (total < 1e-9) return 0;
  const shape = loose
    ? looseSideShape(Math.atan(total * peakTan), peakTan, fadePeakDeg, fullDeg, plateau)
    : brushShape(total, slide);
  return (shape * sideSlip) / total;
}

/**
 * The most longitudinal force a tyre makes before it locks or spins, as a fraction of
 * its capacity, for the threshold-brake estimates: the placeholder curve's peak on loose
 * ground; on a paved surface the brush's peak with the patch sliding at V0 (a tyre at
 * its peak at road speed slides at about that, `SLIDING_DECAY_MPS`).
 */
export function longitudinalPeakShare(slide: SurfaceSlide, wet: number): number {
  if (slide.kind === 'loose') return looseLongitudinalShape(LONGITUDINAL_PEAK_U, slide.share);
  return brushPeak(slidingRatio(slidingFloor(slide, wet), SLIDING_DECAY_MPS));
}

export const HANDLING_PROFILES: Readonly<Record<HandlingProfile, HandlingTuning>> = {
  classic: {
    steerRackSpeed: STEER_RACK_SPEED_RAD_S,
    bumpSteer: BUMP_STEER_MAX_RAD,
    lateralGripFraction: LATERAL_GRIP_FRACTION,
    tyreLateralScale: 1,
    rearAxleSideGrip: REAR_AXLE_SIDE_GRIP,
    slipPeakFrontDeg: SLIP_PEAK_FRONT_DEG,
    slipPeakRearDeg: SLIP_PEAK_REAR_DEG,
    tyreRelaxationLength: 0.45,
    steerLash: STEER_LASH_CLASSIC_RAD,
  },
  road: {
    // The old rate pair's own ratio to classic's (×1.25 parked, ×1.44 at speed).
    steerRackSpeed: (117 * Math.PI) / 180,
    bumpSteer: 0.009,
    lateralGripFraction: 0.36,
    tyreLateralScale: 1,
    rearAxleSideGrip: 0.985,
    slipPeakFrontDeg: 5.9,
    slipPeakRearDeg: 5.5,
    tyreRelaxationLength: 0.28,
    steerLash: STEER_LASH_CLASSIC_RAD * 0.5,
  },
  sport: {
    steerRackSpeed: (150 * Math.PI) / 180,
    bumpSteer: 0.005,
    lateralGripFraction: 0.39,
    tyreLateralScale: 1.1765,
    rearAxleSideGrip: 0.99,
    slipPeakFrontDeg: 5.25,
    slipPeakRearDeg: 5,
    tyreRelaxationLength: 0.2,
    steerLash: STEER_LASH_CLASSIC_RAD * 0.3,
  },
  utility: {
    steerRackSpeed: (105 * Math.PI) / 180,
    bumpSteer: 0.016,
    lateralGripFraction: 0.34,
    tyreLateralScale: 0.9647,
    rearAxleSideGrip: 0.97,
    slipPeakFrontDeg: 7,
    slipPeakRearDeg: 6.5,
    tyreRelaxationLength: 0.38,
    steerLash: STEER_LASH_CLASSIC_RAD * 1.2,
  },
};

// ---------------------------------------------------------------------------
// Braking. The parked hold (`TyreContacts.holdBrake`) takes a *maximum braking
// impulse* (N·s) per wheel, not a force. To brake the whole chassis at `a` m/s²
// across `n` wheels for one `dt` step, each wheel needs the impulse `a * mass * dt / n`.
// ---------------------------------------------------------------------------

/**
 * Share of the tyres' longitudinal PEAK that a threshold stop asks for: the most a
 * driver who can feel the lock coming gets out of the car without locking anything.
 *
 * It is NOT a cap on the pedal. It used to be one: the floored pedal asked for
 * `min(brakeDecelG, 0.99 × summed tyre capacity)`, so on any surface where the tyres
 * gave out first the pedal could never over-ask the car as a whole — an aggregate
 * anti-lock brake the era never had. On dry asphalt `brakeDecelG` (0.42-0.6 g) was
 * below that, so the pedal never reached the tyres at all; on gravel the two limits
 * met at the same 0.5 g, which is why gravel braked as well as asphalt.
 *
 * The pedal now asks the brakes for `brakeDecelG` and nothing else, and the tyre
 * decides what it gets: past its peak the wheel locks. This ratio only sizes what a
 * careful driver would get, for the three readers that want that number rather than
 * the pedal's: the planner's `estimatedBrakeDecel`, the published threshold pedal
 * (`Vehicle.thresholdBrakePedal`, which the autopilot brakes on) and a coupled
 * trailer's brakes.
 */
export const FOOT_BRAKE_GRIP_RATIO = 0.97;
/**
 * Rear bias for the foot brake (0..1): the split at EQUAL line pressure, which is all of
 * it on a car without a rear regulator and all of it below the regulator's knee on a
 * car with one (`CarModelDef.rearBrakeValve`: the Zhiguli, Samara and AZLK-2141). Past the
 * knee the regulator passes the rear brakes only a share of each further rise.
 *
 * Discs at the front, drums at the back. The figure itself is not sourced per car:
 * one split for the catalogue.
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
 * nose dives properly. Without a regulator the rears still lock first — 42% of the
 * torque on an axle carrying a third of the weight is still more than its share — just
 * no longer a foregone conclusion. A front-driver's rear carries 38% standing, under
 * this 42%, so its rear is over-braked at every deceleration until its regulator
 * closes.
 */
export const FOOT_BRAKE_REAR_BIAS = 0.42;
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
export const SLIDE_MIN_MPS = 2.5;
/** Cone fraction the longitudinal channel may eat before side grip starts to go. */
export const SLIDE_CONE_THRESHOLD = 0.55;
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
export const SLIDE_ONSET_TAU = 0.09;
export const SLIDE_RECOVER_TAU = 0.04;
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
export const WHEEL_MASS_KG = 20;
/** Radius (m) the wheel mass is quoted at; mass scales with radius². */
export const WHEEL_REFERENCE_RADIUS = 0.35;
/**
/** Contact-speed floor (m/s) for the slip-ratio denominator, to keep it finite. */
export const SLIP_REFERENCE_MPS = 1.5;
/** Slip ratio at or below which a wheel counts as locked and sliding. */
export const LOCK_SLIP_RATIO = -0.5;
/**
 * Substeps of the wheel, carcass and driveline loop per 60 Hz fixed step
 * (`Vehicle.updateWheelDynamics`): 8, so the loop runs at 480 Hz. The chassis is
 * Rapier's and is held through them; it receives each tyre's force averaged over the
 * substeps, as one impulse.
 *
 * What the loop integrates, and how fast it moves (VAZ-2101, GAZ-24, VAZ-2108 at
 * the suite's load):
 *
 *   wheel against its tyre's slip stiffness   I·v / (Cx·r²): 4-7 ms at 100 km/h,
 *                                             about 1 ms at 20, under 0.5 at a walk
 *   carcass, longitudinal (`longitudinalRelaxationM`)  Lx / v: 8-12 ms at 100,
 *                                             42-61 ms at 20, 78-113 ms at the floor
 *   carcass, lateral (`TyreCurve.relaxationM`) Ly / v: 11-16 ms at 100, 56-81 at 20
 *   wheel and carcass together                one mode at sqrt(Cx·r² / (I·Lx)), the
 *                                             same at every speed: 18 Hz on the GAZ-24,
 *                                             21 on the 2101, 27 on the 2108's front
 *   fuel cut against the crank                I_crank · (150 rpm) / T_peak: ~30 ms
 *   driveline shuffle (`DRIVELINE_SHAFT_RATE_NM_PER_RAD`)  2-8 Hz by gear; a wheel
 *                                             against the crank through the shaft's
 *                                             damper, 1-10 ms
 *   clutch (drivetrain.ts)                    engage 0.12 s, launch 0.15 s, sync 0.12 s
 *
 * At 60 Hz the wheel-carcass mode had two to three steps a period: the implicit solve
 * kept it stable but did not follow it, and a braked wheel could rest on the falling
 * side of its force curve, where a real one either recovers or locks. Measured on the
 * VAZ-2108's 100-0 stop: one front wheel held at 37-60% slip for 1.5 s, the other at
 * 10%, and the car turned 12 degrees. At 240 Hz the mode has 9-13 substeps a period,
 * and at 480 Hz 18-26: the owner's choice for the cars the player owns, for a closer
 * follow of that mode. The wheel against its slip stiffness below about 20 km/h (1 ms
 * and less) is still shorter than a substep, so it stays implicit.
 *
 * Traffic keeps 240 Hz (`TRAFFIC_WHEEL_SUBSTEPS`). The physics suite moves by at most
 * 0.1-0.2 of a figure between the two, and on the high-traffic road the doubled loop for
 * every traffic car raised the simulation tick from about 2.5 ms to 3.5-4.0 ms, which a
 * 144 FPS frame (6.9 ms) cannot carry.
 */
export const WHEEL_SUBSTEPS = 8;
/** Wheel-loop substeps for the AI traffic's cars; see `WHEEL_SUBSTEPS`. */
export const TRAFFIC_WHEEL_SUBSTEPS = 4;
/**
 * THE SLIP THE LONGITUDINAL CURVE PEAKS AT IS A SURFACE PROPERTY, and it now lives in
 * `SurfaceProps.optimalSlip` rather than here. It used to be this one constant (0.12, a
 * period cross-ply on asphalt) for every surface in the world, which quietly made the
 * whole model read sand at an asphalt slip angle — see the field's own note.
 */
/**
 * How quickly the loose-ground placeholder's longitudinal curve reaches its sliding
 * share (`looseLongitudinalShape`), per unit of `optimalSlip`.
 */
export const SLIDE_CURVE_GAIN = 1.5;
/**
 * Where the loose-ground placeholder's longitudinal curve (`looseLongitudinalShape`)
 * really peaks, in units of the surface's `optimalSlip`: the sliding share lifts the
 * peak past the peak term's own u = 1, to about 1.45. On loose ground it is the slip
 * that counts as ONE in combined slip (`longitudinalSlipUnit`). Found numerically from
 * the curve constants so it cannot drift.
 */
export const LONGITUDINAL_PEAK_U = ((): number => {
  let best = 1;
  let bestForce = 0;
  for (let u = 1; u <= 4; u += 0.001) {
    const force = looseLongitudinalShape(u, LOOSE_GROUND_SLIDE.share);
    if (force > bestForce) {
      bestForce = force;
      best = u;
    }
  }
  return best;
})();
/**
 * The paved surfaces' longitudinal slip unit, in units of `optimalSlip`: the slip at
 * which the brush's whole patch slides (σx = 1). Set so the tyre's slip STIFFNESS is
 * the one every surface's `optimalSlip` was calibrated at, the slope of the old curve
 * at zero slip (2(1 − 0.75) + 0.75 · 1.5 = 1.625 per unit of optimalSlip): the brush's
 * slope is 3 per unit of this, so it is 3 / 1.625 ≈ 1.85. The brush then peaks at
 * 1/(3 − 2r) of it, 1.5-1.6 optimalSlip at road speed, beside the old 1.45.
 */
export const LONGITUDINAL_FULL_U = 3 / looseLongitudinalShapeSlope(0, LOOSE_GROUND_SLIDE.share);

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
export const TYRE_RELAXATION_LENGTH_M = 0.45;
/**
 * Longitudinal relaxation length, as a fraction of the tyre's lateral one
 * (`TyreCurve.relaxationM`).
 *
 * The carcass winds up circumferentially before the tread pushes on the road the way
 * it deflects sideways before it corners, so a change of slip ratio also needs some
 * rolling to become force. Without it the drive and brake force followed the wheel's
 * slip on the very step, and only the wheel's inertia and the driveline lag stood
 * between a pedal and the road. A tyre is stiffer round its circumference than across
 * it, so the length is shorter: three quarters of the lateral one puts a period
 * cross-ply at 0.34 m and the catalogue's 70-80-series radials at 0.23-0.26 m.
 *
 * The relaxed slip (`Wheel.carcassSlip`) is what the longitudinal force and the
 * combined-slip split are read at; the wheel's own slip ratio stays the geometric one.
 */
export const LONGITUDINAL_RELAXATION_RATIO = 0.75;
/**
 * Rolling-speed floor for the longitudinal relaxation, m/s. The carcass is wound by
 * the faster of the road under it and the tread over it (a spinning wheel on a
 * stationary car is still feeding rubber through the patch), but a car stood on its
 * brakes has neither — and a filter driven by distance alone would then never let
 * the tyre's force change at all, so a car would hold or creep on whatever force it
 * stopped with. At the floor the carcass catches up in a tenth of a second.
 */
export const LONGITUDINAL_RELAXATION_FLOOR_MPS = 3;
/**
 * Load sensitivity of μ: how much grip a tyre LOSES per unit of extra load.
 *
 * A tyre's coefficient falls as it is pressed harder, which is the mechanism behind
 * every weight-transfer effect worth having. Without it capacity was exactly linear
 * in load, so transferring load between two wheels moved grip around without ever
 * costing any: the balance of the car could only be authored (see
 * REAR_AXLE_SIDE_GRIP) and never emerged from what the car was doing.
 *
 * μ scales as 1 - k·(Fz/Fz_ref - 1), Fz_ref the car's MEAN corner load (weight over the
 * wheel count): one tyre all round. It was each wheel's own static load, which made every
 * car exactly neutral whatever its weight split — a 62% nose-heavy front-driver ran its
 * front and rear tyres at the same share of their peak to the limit, and any yaw
 * overshoot or lift took the tail (tools: a 0.35 s key at 80 km/h spun the VAZ-2111,
 * 2108 and Vectra). Against the mean, the heavy end runs further up its load curve —
 * here and in the peak angle (`brushPeakTan`) — and the front-drivers understeer
 * ~1.3–2.2°/g, the front axle reaching its peak at ~0.72 g with the rear short of it.
 * An outer tyre carrying 1.6x the reference keeps 86% of its μ.
 */
export const LOAD_SENSITIVITY = 0.24;
/** Floor on the load-sensitivity factor, so an airborne-then-slammed wheel stays sane. */
export const LOAD_SENSITIVITY_MIN = 0.5;
export const LOAD_SENSITIVITY_MAX = 1.35;

/**
 * THE DIG: the one place this simulation lies to the player on purpose.
 *
 * Honest sand gives a two-wheel-drive car about 0.13 of mu on its driven axle, against
 * the 0.62 the terrain's own maximum slope asks for. That is not a tuning error and no
 * coefficient fixes it: it is the arithmetic of a 52 per cent axle share against dry
 * loose sand, and it is why a real car on ordinary tyres does not climb dunes.
 * MODELLED HONESTLY, A VAZ-2101 IS IMMOBILE ON ANY SAND SLOPE AND ON MOST FLAT SAND.
 *
 * That would be correct and it would be a worse game, because the desert is most of
 * this world and the player drives to it on purpose. So the model lies, in ONE place,
 * with the lie written down here rather than hidden in a friction table.
 *
 * WHAT THE LIE CLAIMS TO BE. A driven wheel spinning on sand does not slide over it —
 * it EXCAVATES. It throws material back, digs a trench, and within a turn or two it is
 * standing on the damper, firmer sand beneath the dry surface layer. Off-roaders call
 * this giving it the beans, and it is why a spinning wheel on a dune sometimes climbs
 * where a gentle one digs in and stops. In terramechanics it is the soil-flow regime
 * change at roughly 0.2 of slip: past it the tyre is no longer shearing the surface,
 * it is cutting into it.
 *
 * So the dig is a FRICTION FLOOR on the driven wheels. The only question that matters is
 * WHAT TURNS IT ON, and the answer is HOW FAST THE CAR IS MOVING — full below 3 m/s and
 * gone by 10:
 *
 *   - it cannot help a car that is already making progress: the concession removes
 *     itself as the car accelerates, so sand at pace stays exactly as treacherous as the
 *     coefficients in `surfaces.ts` say;
 *   - it is what the player DISCOVERS, because the only way it shows up is to be stopped
 *     or nearly so with the throttle down;
 *   - it cannot be used on the road, because it applies to sand and the loose verge and
 *     nothing else. The packed gravel of a maintained yard is honest: its coefficient is
 *     measured, and a car that cannot climb it cannot climb it.
 *
 * THE GATE USED TO BE THE WHEEL'S SLIP, and that was wrong in a way no tuning would
 * have fixed. A grip floor keyed to slip is a POSITIVE FEEDBACK LOOP against the very
 * thing it feeds: the dig grips, the slip falls, the dig switches off, the slip rises,
 * the dig grips again. Measured on a 18.7-degree sand slope with the wheel traced every
 * step, it settled into a limit cycle of period two — capacity alternating 860 N,
 * 7879 N, 862 N, 7815 N, with the wheel's own surface speed swinging between 0.15 and
 * 0.90 m/s on alternate ticks — and the thrust averaged out to exactly the force needed
 * to hold the car still. It neither climbed nor rolled back: full throttle, 12 kN of
 * instantaneous thrust, and no motion at all.
 *
 * Speed is the right signal because it is SLOW. It is the integral of those forces, so it
 * cannot follow the wheel's slip inside a step and the loop that made the slip gate
 * oscillate has nowhere to close. It is also the better story: a wheel excavates in
 * proportion to how long it has been turning without getting anywhere, which is precisely
 * what low speed means.
 *
 * AND IT IS DELIBERATELY THE SAME FOR EVERY CAR. It does not scale with `wheelGrip`,
 * because its purpose is to guarantee that the weakest machine in the catalogue can
 * leave the desert, and a concession that scaled with tyre quality would abandon
 * exactly the cars that need it.
 *
 * The magnitude is set by measurement, not by taste, and the instrument is
 * `tools/climb-sweep.ts`: for EVERY body in the catalogue, the steepest grade it still
 * escapes has to be at least the steepest grade the world can generate. That is the
 * whole specification, and it is deliberately a floor rather than a feel — a concession
 * granted to the surfaces that need one, not a blanket grip multiplier.
 */
/**
 * Speed (m/s) below which the dig is fully in, and the speed by which it is gone.
 *
 * A stuck car creeps; a car crossing a dune at 40 km/h does not. See the block comment
 * above for why the gate is a speed at all.
 */
export const DIG_FULL_MPS = 3;
export const DIG_GONE_MPS = 10;
/**
 * Effective driven-axle mu the dig grants at full bite, before load sensitivity.
 *
 * Calibrated against the climb sweep; see the block comment above for the target. It is
 * deliberately only a little above the honest asphalt figure rather than as high as the
 * grip budget would allow, because THE TYRE IS NOT WHAT LIMITS THIS CLIMB — see
 * DIG_FIRM_RR.
 */
export const DIG_FIRM_MU = 1.6;
/**
 * Rolling resistance of the FIRM sand under the dry crust, while the dig is in, as a
 * fraction of the wheel's load. The other half of the same lie, and the half that
 * actually decides the climb.
 *
 * Measured, this is what stops a two-wheel-drive car on a sand slope, and it is not the
 * friction coefficient at all. With the dig's friction floor raised until the tyre had
 * 4.5 kN of capacity per rear wheel — more than twice what the grade asks for — the
 * car still would not move, because the driven axle was already delivering everything
 * the ENGINE had: 5924 N of thrust, measured at zero wheel slip against the 6738 N
 * needed to hold 18.7 degrees at sand's then rolling resistance of 0.16. Raising the
 * friction floor from 1.2 to 2.1 changed the outcome by exactly nothing, which is the
 * signature of a limit that is not where it looks: 2163 N of that 6738 was rolling
 * resistance, and no amount of grip moves a number the engine cannot reach.
 *
 * The fix is not a bigger friction lie, it is to stop applying only HALF the dig. The
 * mechanism it models is a wheel cutting through the dry surface layer onto the damper
 * sand beneath, and damper sand does not merely grip better — it also carries a wheel
 * instead of sinking under it, which is precisely what rolling resistance measures. A
 * car cannot be on firmer ground and still be ploughing through loose sand, so the two
 * have to switch together.
 *
 * 0.012 is the bottom of a wheel rut, which is as firm as loose ground gets in this
 * world: just under asphalt's own 0.013, and a sixth of the loose sand it replaces.
 * It is set from the far end of the fleet rather than the middle, and the car that
 * decides it is the VAZ-1111 Oka — front-driven, so on an 18.7-degree climb it is
 * standing on 32 per cent of its own weight, and it crosses that slope at 2185 N of
 * thrust against 2205 N of resistance. A tenth of a per cent of the fleet's weight either
 * way decides whether the smallest car in the catalogue is trapped in the desert, so the
 * concession is sized to leave it a real margin rather than to make the big cars look
 * good.
 */
export const DIG_FIRM_RR = 0.012;
/**
 * The surfaces a wheel can excavate, and therefore the surfaces the dig applies to.
 *
 * Sand and the loose verge, and NOT the packed gravel of a maintained yard or apron.
 * The distinction is the dig's own mechanism: it models a wheel cutting through a loose
 * layer onto something firm beneath, and only a surface with a loose layer over a firm
 * one has anything to cut through. Sand is the desert, tens of centimetres of it over
 * damper sand. The verge is the spoil the grader pushed off the road, lying on the
 * road's own compacted base — and it is the surface a driver lands on BY MISTAKE, so it
 * is the one that most needs a way back.
 *
 * The verge is why this is a set rather than a single comparison. Measured, a car with
 * an honest loose coefficient climbs 5 degrees of it: run a wheel off the edge on any
 * road steep enough to be interesting and the car could neither rejoin the road nor make
 * progress along the verge. Backing down is always available and is not a trap, but a
 * verge you cannot drive off is not what "punishing but escapable" means.
 */
export const DIG_SURFACES: ReadonlySet<SurfaceType> = new Set([
  SurfaceType.Sand,
  SurfaceType.LooseShoulder,
]);

/**
 * THE LOW RANGE: the second time this simulation lies to the player on purpose.
 *
 * The first lie is the dig, and it exists because the desert is most of this world. This
 * one exists because the ROAD is the rest of it, and the road can be steeper than the car
 * that starts on it.
 *
 * WHAT IT GUARDS. `tools/climb-sweep.ts` measures the steepest grade each body escapes
 * from a parked start, and the road's own steepest grade is measured by
 * `tools/road-profile.ts`: seed 1's road reaches 21.0% (11.9 degrees), and six seeds
 * measured reach 17.0-21.0%. Those two numbers have to nest — the road is what the fleet
 * was designed around — on EVERY surface the road deck is made of.
 *
 * WHERE THE HONEST TYRE IS SHORT. On an 18.7-degree climb a 2101's rear axle carries
 * 5.1 kN and the grade asks 3.0 kN, so the axle needs 0.63 of mu to hold it. On asphalt
 * the tyre has about 0.99 and the floor below never binds. On GRAVEL it has 0.70, and a
 * heavier car on softer tyres less than that: a GAZ-21 is at 0.58. That is the arithmetic
 * of hard period rubber on loose stone, and it is why the floor still exists. It used to
 * bind on asphalt too, when the tyre's drive coefficient was the brake test's 0.55, and
 * its fade then read as the rear wheels breaking loose at 5-14 km/h on every launch.
 *
 * SO THE MODEL LIES, ONCE, IN ONE PLACE, AND THE LIE IS THIS: on a road surface, a
 * driven wheel at a CRAWL does not have to make its worst case. A driver on a hill start
 * is not holding full throttle and hoping — they slip the clutch, they take the gear
 * that pulls, and the tyre is loaded long enough to bite. The concession grants the
 * driven axle an absolute mu floor at a crawl, which is the same shape of lie as the dig
 * and is argued the same way: a concession granted to the ground that needs one, sized
 * by measurement, and it cannot be used anywhere it was not intended.
 *
 * WHY THE GATE IS THE CAR'S SPEED, AND WHY IT IS NARROW. `DIG_FULL_MPS` and
 * `DIG_GONE_MPS` explain why a speed gate is the only stable choice — a slip-gated floor
 * is a positive feedback loop against the thing it feeds. This one is deliberately much
 * narrower than the dig's 3-10 m/s: fully in below 1 m/s and gone by 4. On a grade the
 * car settles into a stable creep, because a faster car gets less of the floor and a
 * slower one gets more — measured, that equilibrium is a few km/h up the pitch, which is
 * the whole intent. Off a grade, the honest model is back by 14 km/h, so the road at any
 * real speed, every corner, every slide and every braking distance are untouched.
 *
 * AND IT IS THE SAME FOR EVERY CAR, for the dig's own reason: it exists to guarantee that
 * the weakest machine in the catalogue can leave a climb, and a concession that scaled
 * with tyre quality would abandon exactly the cars that need it.
 *
 * The surfaces are the road DECK — the four the generator draws a district from (see
 * `DISTRICT_SURFACES` in `world/gradient.ts`) — and deliberately not rock. A bedrock
 * outcrop is honest ground, and "this slope is too steep for this car" is a legitimate
 * answer there in a way that it is not on a road the player was routed along.
 */
export const LOW_RANGE_SURFACES: ReadonlySet<SurfaceType> = new Set([
  SurfaceType.Asphalt,
  SurfaceType.CrackedAsphalt,
  SurfaceType.Gravel,
  SurfaceType.Concrete,
]);
/**
 * Driven-axle mu the low range grants at full bite, before load sensitivity.
 *
 * Sized against the requirement rather than by taste, and the requirement is the same
 * shape as the dig's: EVERY body in the catalogue must escape the world's steepest road
 * grade from a standstill, on the WORST surface the road deck is made of — which is
 * gravel, at 0.72, not asphalt. `tools/climb-sweep.ts` measures it; the honest figure for
 * the 2101 is 0.63 of mu at 18.7 degrees, so this sits above that with the margin the
 * bench asserts rather than a hair above the threshold.
 */
export const LOW_RANGE_MU = 1.2;
/** Speed (m/s) below which the low range is fully in, and the speed by which it is gone. */
export const LOW_RANGE_FULL_MPS = 1;
export const LOW_RANGE_GONE_MPS = 4;

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
export const TYRE_RATE_REFERENCE = 165_000;
export const TYRE_RATE_REFERENCE_RADIUS = 0.35;
/** Damping in the carcass itself, as a fraction of critical against the hop mode. */
export const TYRE_DAMPING_RATIO = 0.05;
/**
 * Unsprung mass per corner (kg) at the reference radius: wheel, tyre, hub, brake and
 * the axle's share. Scales with the wheel's mass, i.e. with radius squared.
 */
export const UNSPRUNG_MASS_KG = 38;
/**
 * Contact-patch length (m) the profile is enveloped over. The tyre cannot see detail
 * shorter than the patch it stands on, so the profile is low-passed over this
 * DISTANCE — a filter in metres travelled, which is why crossing a ripple at 100 km/h
 * is no sharper than at 40.
 */
export const CONTACT_PATCH_M = 0.16;

/** This wheel's tyre rate (N/m). */
export function tyreVerticalRate(radius: number): number {
  const scale = radius / TYRE_RATE_REFERENCE_RADIUS;
  return TYRE_RATE_REFERENCE * scale * scale;
}

/** This wheel's unsprung mass (kg). */
export function unsprungMass(radius: number): number {
  const scale = radius / TYRE_RATE_REFERENCE_RADIUS;
  return UNSPRUNG_MASS_KG * scale * scale;
}

/**
 * A BEAM AXLE's roll inertia about its own centre, as a share of what its mass would
 * have if it all sat at the two wheels: `J = BEAM_AXLE_GYRATION_SQ · m · (track / 2)²`,
 * `m` the two corners' unsprung mass together.
 *
 * It is the number that makes a beam a beam in the hop layer. At 1 the two ends of the
 * axle are dynamically independent — an impulse under one wheel moves only that wheel
 * — and the beam is two quarter-cars. A live axle carries its final drive in the
 * middle and its tubes and half-shafts along its length, so its radius of gyration is
 * short of the half-track: lift one end sharply and the axle pivots about a point
 * inside the other wheel, pressing that tyre into the road before the roll mode
 * carries it up.
 *
 * The Zhiguli's rear axle is 52 kg assembled without its wheels and 1.40 m long (the
 * VAZ-2101-07 axle, bumper.guru and the VAZ parts tables), on two 13-inch wheels of
 * about 13.5 kg. Its brake drums (~5 kg each) and the wheels at the ends, the final
 * drive (~16 kg, an estimate) at the centre and the remaining ~26 kg of banjo, tubes
 * and shafts spread along the 1.40 m give `J ≈ 20 kg·m²` against `m (t/2)² ≈ 33` at its
 * 1.30 m track: 0.6, and within 0.03 of it for any split of the centre mass from 10 to
 * 20 kg. The UAZ's and the Volga's axles are the same arrangement.
 */
export const BEAM_AXLE_GYRATION_SQ = 0.6;

/**
 * Progressive bump stop, in place of a rigid travel clamp.
 *
 * The contact clamps the spring at `rest +/- maxTravel` (vehicle/tyrecontact.ts), and
 * a clamp is a collision: the wheel simply stops moving relative to the body and the
 * whole impact goes through as a step. Real suspension has a rubber stop that starts
 * taking load some way before
 * the end of the travel and stiffens as it crushes, which is what turns bottoming out
 * into a firm thump instead of a hammer blow — and it is what makes a genuinely soft
 * spring usable over a big hit.
 *
 * The stop engages over the last BUMP_STOP_FRACTION of the available bump travel and
 * its force rises with the square of how far into it the wheel is, reaching
 * BUMP_STOP_PEAK times the corner load the car was DESIGNED at when fully crushed.
 *
 * The design load, not the load it is carrying: the stop is a piece of rubber bolted
 * to the car, and scaling its crush force with the payload made a loaded car's stop
 * several times stronger than an empty one's, which threw it at every bump it met.
 * Fixed, a loaded car settles further into the same rubber — and bottoms on it more
 * gently in proportion to its own weight, which is what the real thing does.
 */
export const BUMP_STOP_FRACTION = 0.4;
export const BUMP_STOP_PEAK = 6;
/**
 * The damper's LOW-SPEED circuit. A real telescopic damper is not one linear
 * coefficient: below a knee of piston speed the oil only gets through the bleed
 * orifice, which damps DAMPER_BLEED_GAIN times harder than the valve stack that opens
 * above it. That is how a car can ride a sharp bump softly (high piston speed, valves
 * open) and still have its body motions — roll, pitch, the slow float after a crest,
 * all of them low piston speed — come to rest in about one swing.
 *
 * The preset damping ratios are the valve stack's, the figure a damper is specified
 * by. The wheel contact applies that linear part; `resolveTravel` adds the bleed's extra
 * `(gain − 1) · c · clamp(v, ±knee)` at each contact patch, and the tyre carries it.
 *
 * It is the only roll damping in the model (see the body-roll block below): with the
 * linear part alone the roll mode sat at 0.26-0.34 of critical, because the bars add
 * roll stiffness and nothing that damps it, and every car swung a third of its lean
 * back past upright when a couple was let go (tools/roll-balance.ts, roll release).
 */
export const DAMPER_BLEED_GAIN = 2;
export const DAMPER_BLEED_KNEE_MPS = 0.1;
/**
 * How far above a settled wheel's centre its suspension mount is placed, metres.
 *
 * Pure bookkeeping: `restLength = sag + this`, so the spring is `this` short of free
 * length when parked. It cannot
 * change how the car rides — sag is set by the frequency and the mount is then placed
 * to put the wheel on the ground — and it cannot change the available droop, which
 * for a linear spring is exactly the sag.
 */
export const MOUNT_ABOVE_WHEEL_CENTRE = 0.12;
/**
 * The per-wheel suspension force ceiling, as a multiple of that corner's static
 * load. It exists so a catastrophic landing cannot launch the car; the bump stop above
 * is what shapes ordinary bottoming, and it peaks well below this.
 */
export const SUSPENSION_FORCE_HEADROOM = 9;
/**
 * Static holding deceleration for a parked car nobody is driving, m/s². Applied
 * across all four wheels so it remains at rest on any drivable road grade. A driven
 * car's handbrake is a cable lock on the rear wheels instead (`cableLocked` in vehicle.ts).
 */
export const PARK_BRAKE_DECEL = 12.0;
/**
 * Below this ground speed a braked car is pinned where it stands and facing the way it
 * faces; its height, pitch and roll stay the springs' (`Vehicle.postStep`).
 */
export const PARK_HOLD_SPEED_MPS = 0.12;
/**
 * Share of its own weight the springs must be carrying before a parked car may be
 * PINNED in place, as a fraction of `m·g`.
 *
 * The hold used to teleport the WHOLE chassis back to the pose it latched, every step,
 * which is only a resting pose if the car was standing on its wheels when it latched,
 * and nothing used to check: the handbrake pulled during the drop after a spawn — or
 * on any car whose suspension had not settled — latched the body IN THE AIR, at
 * whatever height it happened to occupy. The car then hung there for as long as the
 * brake was on, and the moment it was released it fell the whole distance and landed
 * hard enough to bounce back up. Measured on a hatchback before this guard, holding
 * the handbrake from the first step: pinned 0.748 m above its resting height with
 * every wheel unloaded, then on release a 2.45 m/s impact, a rebound to 0.265 m and
 * three more oscillations. Reported from play as the car jumping when the handbrake
 * is let off.
 *
 * A car that is genuinely parked sits within a few per cent of its own weight, so the
 * threshold only has to separate "on its wheels" from "in the air"; it is deliberately
 * well below 1 so a car parked across a crest with a wheel lifted still holds.
 */
export const PARK_HOLD_MIN_LOAD_FRACTION = 0.45;

/**
 * Seconds the parking hold stays off after `Vehicle.flipOver`: longer than one fixed
 * step, so the hold cannot latch the lifted, velocity-zeroed body in mid-air before it
 * drops onto its wheels.
 */
export const FLIP_HOLD_RELEASE_SECONDS = 0.2;
/** Residual motion treated as stopped before an automatic changes drive direction. */
export const AUTO_DIRECTION_RELEASE_MPS = 0.08;
/** Hard road-speed ceiling for a catastrophically damaged but still running engine. */
export const DESTROYED_ENGINE_SPEED_CAP_MPS = 20 / 3.6;

// ---------------------------------------------------------------------------
// Body roll and lateral load transfer: from the linkage, not from a gain.
//
// Bullet's ray-cast vehicle, which Rapier's ported, threw the roll couple away ("roll
// influence"). This car's side force is its own: `updateWheelDynamics` makes each
// tyre's side force itself and
// applies it to the body at that axle's ROLL CENTRE (`SuspensionTuning.
// frontRollCentreM` / `rearRollCentreM`), which is where real links hand it over.
//
// The cornering moment `m · a_y · h` then splits the way it does on a real car:
//
//   - ELASTIC: the side force times the centre of mass' height above the roll axis
//     rolls the body, and the outer springs and the anti-roll bars (`frontBar` /
//     `rearBar`, `applyAntiRollBars`) hold it. Their reaction is what loads the
//     outer tyre, and the bars' split front-to-rear decides which axle takes more.
//   - GEOMETRIC: the side force times the roll centre's own height goes through the
//     links straight to the tyres (`resolveLinkTransfer`, a wheel's `linkN`) and never
//     rolls the body.
//
// Each wheel's `loadN`, which sizes its grip through load sensitivity, is the sum of
// what its spring, bump stop, bar and links put through it this step. There is no
// roll torque and no roll-rate damping anywhere: the lean is what the springs allow
// and it settles on the dampers. tools/roll-balance.ts measures the roll and
// understeer gradients this produces.
//
// It replaced a couple of `m · a_y · h` added about the forward axis with the side
// force applied at the centre of mass' height. That put the WHOLE moment into the
// springs, so every car leaned as though its roll axis lay on the road — 7-9 degrees
// per g — and the front/rear split of the transfer was set by the bars alone.
// ---------------------------------------------------------------------------

/**
 * Where the axles are and how the weight is split between them. Measured once from
 * the model; everything load-bearing about balance is derived from it — the centre of
 * mass, each corner's static load, and therefore each spring's rate.
 */
export interface AxleGeometry {
  /** Mean mount Z of the front and rear wheel groups, chassis-local metres. */
  readonly frontZ: number;
  readonly rearZ: number;
  readonly frontCount: number;
  readonly rearCount: number;
  /** Fraction of the parked car's weight on the front axle. */
  readonly frontWeightShare: number;
}

/* ---------------------------------------------------------------------------
 * The chassis' mass, as the parts it is made of (`Vehicle.applyChassisMass`).
 *
 * The kerb car is summed from components, each a mass at its own place with its own
 * small inertia, carried to the car's centre of mass by the parallel-axis theorem:
 *
 *   - an unsprung mass at each wheel centre (`unsprungMass`), a disc of the wheel's
 *     radius;
 *   - the engine and the gearbox, from the part registry's masses for the model's own
 *     `engineId` and `gearboxId` (parts/registry.ts), each a solid box (`ENGINE_*`,
 *     `GEARBOX_*`). The layout follows the drive: a car that drives its rear axle has a
 *     propshaft and a longitudinal engine set back behind the front axle with the
 *     gearbox bolted on behind it (and, on four-wheel drive, the transfer box behind
 *     that, which the Niva's registry mass already includes); a front-drive car has a
 *     transverse engine just ahead of its front axle and the transaxle on the axle line;
 *   - the fuel of a full tank (the kerb car is a full one) at the tank's anchor
 *     (`LOAD_TANK_*`), a point: a liquid does not spin with the tank it is in;
 *   - the body shell (`BODY_SHELL_MASS_FRACTION`), a thin uniform shell over the
 *     measured body box;
 *   - and the fittings, everything else — seats, glass, trim, wiring, the sprung half
 *     of the suspension, radiator, battery, exhaust, spare wheel — a solid box between
 *     the axle lines, the wheels' track wide and the body's height tall.
 *
 * The shell and the fittings share one centroid, solved so the whole kerb car's centre
 * of mass lands where the catalogue's weight split and `COM_DROP_FRACTION` put it.
 *
 * Checked against the published passenger-car range of the yaw DYNAMIC INDEX
 * k²/(a·b), 0.85-1.0 (k the yaw radius of gyration, a and b the centre of mass to each
 * axle): the kit VAZ-2101/2106/2108/2121/1111 come out at 0.88-0.93 and the UAZ-469 at
 * 0.90 from these figures alone. The solid box times 2.55 this replaced was 2.3-2.9.
 *
 * The factory unit-mass tables ("Масса агрегатов", autoopt.ru encyclopedia pages after
 * the factory manuals) are the data:
 *
 *   VAZ-2106, kerb 1035: engine 117, gearbox with its clutch housing 26, body assembled
 *     without seats 275, rear axle 53, wheel and tyre 15;
 *   VAZ-2108, kerb 900: engine without clutch or gearbox 82, gearbox with differential
 *     34, body assembled without trim or seats 245, front suspension 55, rear 45, wheel
 *     and tyre 14.3;
 *   VAZ-2121, kerb 1150: engine 114, gearbox 32, transfer box 27.6, body assembled
 *     without trim 284, wheel and tyre 21;
 *   VAZ-1111, kerb 635: engine without clutch or gearbox 66.5, gearbox with
 *     differential 24.5, body assembled without trim or seats 172.
 * --------------------------------------------------------------------------- */

/**
 * The body shell's share of the kerb mass: 275/1035 = 0.266 (VAZ-2106), 245/900 =
 * 0.272 (VAZ-2108), 284/1150 = 0.247 (VAZ-2121), 172/635 = 0.271 (VAZ-1111) in the
 * tables above; avtotema.ru gives the VAZ-2101's as 280 of 955, 0.293.
 */
export const BODY_SHELL_MASS_FRACTION = 0.27;
/**
 * The engine's box, along its crank, across it and tall, metres: the kit bay's engine
 * cell for the classic four (carkit/bay.ts, 0.54 × 0.47 × 0.54 [E]).
 */
export const ENGINE_LENGTH_M = 0.54;
export const ENGINE_WIDTH_M = 0.47;
export const ENGINE_HEIGHT_M = 0.54;
/**
 * The engine's centre above the crank, which sits at the wheel centres' height: the
 * block and head stand over the crank and only the sump hangs below it [E].
 */
export const ENGINE_ABOVE_CRANK_M = 0.15;
/** The gearbox's box: along its shafts, and its square section, metres [E]. */
export const GEARBOX_LENGTH_M = 0.5;
export const GEARBOX_SECTION_M = 0.3;
/** A four-wheel-drive car's transfer box, behind the gearbox on a short shaft [E]. */
export const TRANSFER_BOX_LENGTH_M = 0.3;
/**
 * The longitudinal engine's centre behind the front axle line: the kit bay's engine
 * cell stands 0.11 m behind it on the classic, 0.05 on the Niva and 0.06 on the UAZ-469
 * (carkit/bay.ts, measured through the body fit).
 */
export const LONGITUDINAL_ENGINE_BEHIND_FRONT_AXLE_M = 0.1;
/**
 * The transverse engine's centre ahead of the front axle line: the kit bay's engine
 * cell stands 0.11 m ahead on the Samara, the Oka and the Nexia. Its transaxle's
 * differential drives the wheels, so the gearbox sits on the axle line itself.
 */
export const TRANSVERSE_ENGINE_AHEAD_OF_FRONT_AXLE_M = 0.1;

/**
 * Moment of inertia of a thin uniform box SHELL — six plates of one surface density —
 * about the axis through its centre along `along`, with `p` and `q` the other two
 * half-extents. Each plate adds its own moment and its offset from the axis.
 */
export function thinBoxShellMoment(mass: number, along: number, p: number, q: number): number {
  const areaSum = along * p + p * q + q * along;
  if (areaSum <= 0) return 0;
  return (
    (mass / areaSum) *
    ((p * q * (p * p + q * q)) / 3 + along * q * (p * p + (q * q) / 3) + along * p * ((p * p) / 3 + q * q))
  );
}

// ---------------------------------------------------------------------------
// Aerodynamic drag: 0.5 * rho * Cd * A, with A = 4 * hx * hy (frontal area).
// This is what limits top speed by power instead of a magic speed cap.
// ---------------------------------------------------------------------------

export const AIR_DENSITY = 1.225;
export const DRAG_CD = 0.35;

/**
 * A load smaller than this is not worth re-solving the springs for, kg.
 *
 * Fuel burns off in grams a second, so without a dead band every tick would re-size
 * four springs for a change nobody could measure. A tenth of a kilogram is below the
 * resolution of anything the player can feel and well above the rate the tank drains:
 * at the thirstiest point in the catalogue the tank loses well under a gram in one
 * fixed step, so the springs settle on a new rate about once a minute of driving.
 */
export const CARRIED_MASS_EPSILON_KG = 0.1;

/** Oil's density, kg/L. Water is 1.0 by definition and the fuel's is in the item table. */
export const FLUID_DENSITY_OIL = 0.87;

/** Petrol's density, kg/L, the one fuel there is. */
export const FUEL_DENSITY = FLUID_DENSITY.petrol;

/** Water a stock radiator of this variant holds, litres. Zero if it holds none. */
export function stockRadiatorWater(variantId: string): number {
  return variant(variantId).radiator?.capacity ?? 0;
}

/**
 * Damping of the chassis' ROLL rate, per second: each step the body's angular velocity
 * about its own forward axis loses `c·dt / (1 + c·dt)` of itself (`Vehicle.
 * applyRollDamping`), the same implicit decay Rapier's `setAngularDamping` applies.
 *
 * It used to be exactly that Rapier setting, at the same 0.1, documented as roll damping
 * for stability against low-speed flop. Rapier's damping is isotropic: it took the same
 * share out of the YAW and PITCH rates too, so a car rotating into a slide or rocking on
 * its springs lost momentum no real car loses — air does not damp a body's yaw, and the
 * pitch is the springs' and dampers' business. Only roll is the stability case: a car
 * crawling at full lock or parked on one kerb rocks on four light tyres and nothing else
 * bleeds that motion, so it is kept, about the roll axis alone and at the same rate.
 * 0.1/s is a 10 s time constant; the suspension's own roll damping (a 0.45-0.67 damping
 * ratio, tools/roll-balance.ts) dwarfs it whenever the wheels are working.
 */
export const CHASSIS_ROLL_DAMPING_PER_S = 0.1;

// ---------------------------------------------------------------------------
// Delta emission throttling (keep the delta stream small).
// ---------------------------------------------------------------------------

export const TRANSFORM_EMIT_INTERVAL = 0.25;
export const ODOMETER_EMIT_INTERVAL = 0.5;
export const FUEL_EMIT_INTERVAL = 0.5;
/**
 * Seconds of RUNNING with a dry sump before the block is destroyed.
 *
 * Shorter than the overheat grace (`SEIZE_SECONDS`, vehicle/cooling.ts) because oil
 * has no gauge and no lamp ramp: the warning is the oil light, which is already on
 * before the level reaches zero. Half a minute is enough to notice it, stop, and
 * pour in the can you are carrying.
 */
export const OIL_STARVE_SECONDS = 30;

/**
 * Cosmetic shell wear is emitted with the other slow-moving vehicle values; half a
 * second keeps the state stream coarse while still making a wash visible promptly.
 */
export const BODY_CONDITION_EMIT_INTERVAL = 0.5;
/**
 * Tyre-track metres over sand (`dust = 1`) to full dirt. Four rolling tyres cover
 * 120 km of track over 30 km of desert, so the first clearly visible crust (a quarter)
 * arrives after about seven and a half kilometres of sand or twelve of graded gravel:
 * a long off-road leg browns the car, it takes a day of desert to make it the colour
 * of the sand. 24 km (six of sand to full) caked the car within minutes of leaving
 * the road, which read as paint rather than wear. The bounded slip multiplier below
 * still makes a digging wheel throw more.
 */
export const BODY_DIRT_TYRE_METRES_TO_FULL = 120_000;
/**
 * Floor on how dusty any surface is FOR THE BODY. Sealed road reports `dust = 0`,
 * which is right for the spray effect (a tyre on tarmac throws no plume) and wrong
 * for paint: road film, sand blown across the carriageway and the spray of passing
 * traffic still settle. At 0.05 a car picks up a light film over a hundred-odd
 * kilometres of asphalt, an order of magnitude slower than off it.
 */
export const BODY_DIRT_ROAD_FILM = 0.05;
/** A kerb nudge is under this unexplained loss; shell damage starts above it. */
export const SCRATCH_IMPACT_THRESHOLD_MPS = 1.8;
/**
 * Each m/s above the threshold adds this much shell damage, up to one impact's cap.
 *
 * A 5 m/s shunt (18 km/h into a rock) lands 0.19 rather than the former 0.06.
 * This is the aggregate the paint draws as streak density and the brush and sponge
 * polish back.
 */
export const SCRATCH_PER_SEVERITY_MPS = 0.06;
/** One collision cannot add more than this much cosmetic damage. */
export const SCRATCH_PER_IMPACT_CAP = 0.3;
/**
 * Suspension and solver noise are below 0.35 m/s once the tyres' force ceiling is
 * removed; keeping that margin stops ordinary road seams becoming collision signals.
 */
export const IMPACT_UNEXPLAINED_FLOOR_MPS = 0.35;

export const TWO_PI = Math.PI * 2;

/**
 * `Settings.bouncyCars`: a purely cosmetic joke — the "bouncing Yaris" meme, a
 * cartoon hop applied to the whole visual root (body, wheels, lights, stickers)
 * after the physics pose is copied into it in `syncVisuals`. The chassis body,
 * its collider and the suspension never see this: it is drawn on top
 * of the settled pose, so handling, contact patches and projected lights are
 * exactly as if the toggle were off.
 *
 * One-sided (`Math.abs(Math.sin(...))`) rather than a plain sine: the resting
 * pose IS the physics pose, so the hop only ever lifts the car above it and
 * always returns to exactly zero, twice a cycle. A signed sine would either
 * dip the wheels below the road surface on every trough or leave the car
 * permanently floating above its resting height.
 *
 * The wheels hop with the body rather than staying planted: a raised body over
 * grounded wheels would need the body drawn from a second local origin, and every
 * sticker (parented to `rootGroup`, not to the body subtree — see main.ts) would
 * visibly slide off its panel as the body moved out from under it. Bouncing the
 * whole root avoids both for one extra Y write that the toggle already pays for.
 */
export const BOUNCE_HOP_HZ = 2.4;
/** Peak lift of a hop, metres. Cartoonish and unmissable; a car's own affair. */
export const BOUNCE_AMPLITUDE_METRES = 0.12;
/**
 * Body-only squash-and-stretch, synced to the same hop: the panel work at the heart
 * of the meme, and cheap because it is one non-uniform `Object3D.scale` write on the
 * body subtree alone — no extra geometry, shader or draw call, and the wheels are
 * separate children of `rootGroup` so they stay round and never deform.
 *
 * Peaks at touchdown (`bounce01 === 0`) and relaxes to the stock shape at the top of
 * the hop (`bounce01 === 1`): flatten on impact, spring back on the way up, exactly
 * the read the clip has. Y compresses by up to this fraction; X/Z widen by half that,
 * the standard volume-preserving approximation for a small squash.
 *
 * Pivots on the body subtree's OWN local origin, not the chassis origin — cheaper
 * than computing a pivot, and correct here because `buildTemplate` (render/carmodel.ts)
 * already recentres that origin to the body's own bounding box, itself built on the
 * asset convention of an origin at ground level: squashing about it reads as the roof
 * dropping toward the wheels, not as the whole car sinking through the road.
 */
export const BOUNCE_SQUASH_MAX = 0.2;

/**
 * Authored steering-wheel travel: 970 degrees lock-to-lock, or 485 degrees from
 * centre to either stop. Normalising by each model's tyre lock keeps the rim travel
 * identical across the catalogue despite their different steering geometries.
 */
export const STEERING_WHEEL_HALF_LOCK_RAD = (485 * Math.PI) / 180;

/** Rotates v by quaternion q into `out`, in place. */
export function rotateVector(
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

/**
 * Anti-squat, anti-dive and anti-lift: the share of the longitudinal load transfer that
 * real suspension GEOMETRY carries through the links instead of through the springs,
 * now read off each axle's side-view instant centre (`SuspensionTuning.frontPitchCentre`,
 * resolved in the body pass of `Vehicle.updateWheelDynamics`).
 *
 * The wheel contacts' suspension has no links: Rapier receives each tyre's force at the
 * contact patch, so 100% of the pitch couple goes into the springs and the nose rises
 * under power like a speedboat. Pitch inertia cannot cure that (an earlier pass raised
 * it to 2.55 times a solid box's for exactly this complaint): it only makes the lift
 * SLOWER. The cause is a missing reaction path, not too little inertia.
 *
 * The path, per wheel: a longitudinal tyre force F reaches the body along the line from
 * the patch through the axle's instant centre, so besides F itself the body takes a
 * vertical `F · tanθ` at that wheel — up at a braking front, down at a braking rear, up
 * at a driving rear, down at a driving front — and the tyre carries the same load (it is
 * the link's reaction), next step, the way it carries the roll centre's share of the side
 * force (`linkN`). The springs therefore see only what the links do not, the total
 * transfer `m · a · h / L` at the tyres is unchanged, and the difference between the two
 * ends is a small heave the geometry makes too (jacking). Which line: the PATCH's for
 * brake torque and a live axle's drive, the WHEEL CENTRE's for drive through half-shafts
 * and for engine braking on such an axle.
 *
 * It replaced two fixed fractions of the couple, 0.38 under power and 0.26 under braking,
 * taken back as a torque at the centre of mass for every car alike. That model also kept
 * the links' share of the transfer away from the TYRES, so the loads a stop or a launch
 * put on each axle were 26-38% short of `m · a · h / L`; now they are the whole of it.
 *
 * `aboveM` is the height the line starts from: 0 for the patch, the wheel radius for the
 * wheel centre.
 */
export function pitchLinkTan(centre: { lengthM: number; heightM: number }, aboveM: number): number {
  return centre.lengthM > 0 ? (centre.heightM - aboveM) / centre.lengthM : 0;
}

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
 *
 * This is the KERB BODY's point, and only the kerb body's: the complete factory car
 * at its published distribution, with its reservoirs full. Anything loaded since is
 * carried separately, at its own anchor (see the `LOAD_*` block below), and the two
 * are combined by mass. A stock car therefore sits exactly where it always did.
 */
export const COM_DROP_FRACTION = 0.45;

/* ---------------------------------------------------------------------------
 * Where the masses that are NOT the kerb body sit.
 *
 * `COM_DROP_FRACTION` above places ONE point: the complete factory car, at its
 * published weight distribution and its published ride height. Everything the player
 * changes afterwards — fuel burned, a crate in the boot, the pack in his hands — is a
 * second mass somewhere else, and it is placed here. Where it sits decides the whole
 * character of a loaded car: which axle takes the crate, whether the nose lifts or
 * digs, and how far the centre of mass moves. Placing it at the car's own centre of
 * mass instead (as this used to) makes a load weigh more without ever moving the car,
 * so a boot crate is carried 62% by the FRONT axle of a front-drive hatchback.
 *
 * Every figure is a cut of the MEASURED geometry — the chassis box and the two axle
 * lines — never of the visual trunk grid, which is an interaction plane drawn behind
 * the tailgate at beltline height and is not where cargo would physically be. A
 * body-type rule (saloon/hatch hold versus a truck's bed) plus the model's own axle
 * positions covers the catalogue: the range spans a 3.2 m Oka to a 4.5 m flatbed, and
 * the rule has to be right at both ends rather than tuned to one car. A body whose hold
 * is not behind its rear axle — a rear-engined car, whose luggage compartment is at the
 * NOSE — would need the anchor authored per model, and none is in the catalogue, so
 * there is no override and no field for one: `measureLoadAnchors` is where it would go.
 *
 * These are the physical anchors, all chassis-local metres, x right, y up, z forward
 * (+Z is the nose, matching the controller's forward axis):
 *
 *   - a floor pan, `LOAD_FLOOR_FRACTION` up the measured box, which the cabin floor,
 *     the boot floor and a pickup's bed floor all sit at;
 *   - the tank, low and just ahead of the rear axle (`LOAD_TANK_*`), where a rear
 *     seat or a rear footwell covers it;
 *   - the engine bay (`LOAD_ENGINE_*`), over the front axle, for service parts and
 *     for the water and oil that live with the engine;
 *   - the hold behind the rear axle for cargo, at the floor, its centroid half a
 *     crate up (`LOAD_CARGO_HALF_HEIGHT`, half a `TRUNK_CELL_HEIGHT` in trunk.ts) —
 *     a saloon or hatch carries it over the tail, a pickup over and just behind its
 *     rear axle;
 *   - the driver's seat (`LOAD_SEAT_*`), for what he is carrying rather than for the
 *     car: no driver mass is modelled, so this anchor is a hand-sized load only.
 *
 * None of these is off the centreline, so the combined centre of mass stays on x = 0
 * and the left/right static split is untouched.
 */
export const LOAD_FLOOR_FRACTION = 0.32;
/** Tank centre, below the floor pan it hangs under. */
export const LOAD_TANK_BELOW_FLOOR = 0.10;
/** Tank centre, ahead of the rear axle line, as a fraction of the wheelbase. */
export const LOAD_TANK_AHEAD_OF_REAR_AXLE = 0.12;
/** Engine-bay centre, above the floor pan. */
export const LOAD_ENGINE_ABOVE_FLOOR = 0.15;
/** Driver's seat, above the floor pan, and behind the front axle as a fraction of the wheelbase. */
export const LOAD_SEAT_ABOVE_FLOOR = 0.28;
export const LOAD_SEAT_BEHIND_FRONT_AXLE = 0.55;
/** Cargo centroid above the floor: half a trunk cell. */
export const LOAD_CARGO_HALF_HEIGHT = 0.13;
/** Cargo hold behind the rear axle line, as a fraction of the tail overhang. */
export const LOAD_BOOT_BEHIND_REAR_AXLE = 0.5;
/** A flatbed's payload rides further forward over its axle than a car's hold does. */
export const LOAD_BED_BEHIND_REAR_AXLE = 0.25;


export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
