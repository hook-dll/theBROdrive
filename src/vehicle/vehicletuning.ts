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

import { SurfaceType } from '../core/surfaces';
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
// The driver's hands set a RACK TARGET, and the tyres decide the rest:
//  1. A held steering key winds the KEYBOARD HOLD up over time (`KEY_STEER_WIND_S`);
//     slowly near walking pace it is a share of the lock about the car's own axis, at
//     speed a share of the angle that puts the front axle at its own peak slip angle
//     (`STEER_ASSIST_SLIP_MARGIN`), measured from where it is travelling. A pad stick
//     is a position: the same cap with the steering assist on, the whole lock with it
//     off. Autonomy commands a rack angle directly.
//  2. The rack moves toward the target no faster than the profile's rack speed.
//  3. The tyres hang off the rack through the backlash window, and inside it, or
//     everywhere when no hand is on the wheel, they are moved by their own aligning
//     moment (`STEER_FREE_TAU_S`, `PNEUMATIC_TRAIL_M`, `SuspensionTuning.frontCasterDeg`).
//
// The constants immediately below are the established `classic` values. They feed
// `HANDLING_PROFILES`; fixedUpdate reads only the selected immutable profile.
// ---------------------------------------------------------------------------

/**
 * Rack speed, radians per second at the ROAD WHEEL: how fast the driver's hands can
 * move the tyres, at any speed. 60°/s is about 1000°/s at the rim of a 16:1
 * recirculating-ball box, a quick pair of hands; the later racks are quicker.
 *
 * It replaces a pair of rates blended by a speed table (2.0 rad/s parked, 0.5 at
 * 100 km/h). The high-speed one was there to keep a held key from asking for too much
 * angle too fast, and that is now the assist's job (`STEER_ASSIST_SLIP_MARGIN`), which
 * asks for a few degrees at speed instead of a share of the lock; the parked one was
 * faster than anyone turns a wheel.
 */
export const STEER_RACK_SPEED_RAD_S = (60 * Math.PI) / 180;
/**
 * STEERING ASSIST AT SPEED: a key held to the end of its wind-up (`KEY_STEER_WIND_S`)
 * asks for the rack angle that puts the front tyres at their own peak slip angle, and
 * this much past it.
 *
 * The peak is the car's own tyre at its current load (`brushPeakTan`), and the angle is
 * measured from where the front axle is actually travelling, so it is the same rule at
 * every speed past `KEY_STEER_TYRE_KMH`: at 100 km/h it is a few degrees, under it the
 * kinematic angle of the tightest circle the grip holds takes over toward full lock;
 * with the tail out, the front axle is travelling toward the outside of the turn and
 * the countersteer key reaches past it by the same margin, so catching a slide needs
 * no special case. It replaces a fixed speed table (100% of lock
 * to 20 km/h, 44% at 100) that measured 13-22° of front slip on a held key at
 * 60-130 km/h (`tools/steer-feel.ts`) — two to three times the tyre's peak, a plough
 * that also could not be driven INTO, because the table was the limit, not the tyre.
 *
 * The margin puts the target on the far side of the peak, never short of it: the curve
 * is flat there (a brush tyre keeps 99% of its peak force 10% past it), so a held key
 * costs nothing and the player can still feel the front start to go.
 */
export const STEER_ASSIST_SLIP_MARGIN = 0.1;
/**
 * THE KEYBOARD HOLD: a steering key is a duration, not a position. How long it is
 * held is how much wheel it asks for, and the vehicle keeps that hold (-1..1) between
 * steps (`Vehicle.updateSteering`). The touch wheel's deflection is the most it winds
 * to.
 *
 * WIND-UP, near walking pace: the time constant of a held key's approach to the whole
 * lock. 0.25 s is 63% in a quarter second and 90% in 0.58 s, and a 40 ms tap is 15% of
 * the lock: taps add up to a parking turn. The approach is quickest off the centre, so
 * the steering box's free play (`STEER_PLAY_RAD`) is crossed by the first tap.
 */
export const KEY_STEER_WIND_SLOW_S = 0.25;
/**
 * WIND-UP, at speed: the time constant of a held key's approach to the full reach (the
 * front tyres' peak). 0.35 s is 90% in 0.8 s, so hold time sets the angle gradually,
 * and a 40 ms tap asks for a tenth of the reach, enough to clear the free play: a fine
 * correction, not none. The old key ramp was 0.3 s, then shaped by a power law.
 */
export const KEY_STEER_WIND_S = 0.35;
/**
 * The opposite key UNWINDS the hold back toward straight at this many times the
 * wind-up's rate off the centre (1 / `KEY_STEER_WIND_S`), linearly, and stops at
 * straight: taking back a correction is quicker than making one, and one short tap of
 * the other key after a few too many is a small correction, not the opposite lock
 * (2.5× takes a whole hold back in 0.14 s at speed). Past straight it winds the new
 * way at the ordinary rate, like a fresh press, except in a slide: with the tail out
 * (`tailOut`) the countersteer side winds up to this many times faster, because
 * catching a slide needs it.
 */
export const KEY_STEER_COUNTER = 2.5;
/**
 * Release, near walking pace: the time constant of the hold's return. It comes back at
 * (|hold| + `KEY_STEER_RETURN_FLOOR`) / this per second, so a whole hold is back at
 * straight in 2.5 s: on a dune, in a car park, the wheel stays where the taps put it
 * and taps add up. The hand is on the wheel until the hold is back at straight, so the
 * tyres' aligning moment cannot turn it downhill under a sliding car.
 */
export const KEY_STEER_RETURN_SLOW_S = 1.2;
/**
 * Release, at speed: the same time constant, 0.25 s: a whole hold is back at straight
 * in 0.5 s (0.6 s with `KEY_STEER_RELEASE_S`), against the old ease's 0.9 s to let go
 * from a full key. At speed the hold is slip on top of the travel angle, so a released
 * hold leaves the wheel following the way the car is going: with the tail out, that is
 * the countersteer.
 */
export const KEY_STEER_RETURN_S = 0.25;
/**
 * The return's floor, as a share of the hold: the return is proportional to the hold,
 * so a row of taps settles at a hold that grows smoothly with how long the taps are
 * (40, 55, 70 ms every 200 ms hold about 0.26, 0.41, 0.54 at speed) instead of
 * flipping between none and most; the floor keeps it from lingering near the centre
 * the way the old ease did (0.1 of a hold is gone in 0.13 s at speed).
 */
export const KEY_STEER_RETURN_FLOOR = 0.15;
/**
 * The return reaches its full rate this long after the key comes up, from nothing,
 * linearly: the hand relaxes before the wheel comes back. A gap of 0.1 s between two
 * taps at speed gives back under a twentieth of a 0.3 hold, so a row of taps holds a
 * bend with the angle sagging a little between them instead of snapping toward the
 * centre. With the tail out the return is at its full rate at once.
 */
export const KEY_STEER_RELEASE_S = 0.25;
/**
 * The hold's frame of reference, blended by forward speed with a smoothstep: under
 * `KEY_STEER_AXIS_KMH` a key turns the wheels about the car's own axis to the whole
 * lock, wherever the car is sliding; past `KEY_STEER_TYRE_KMH` it asks for slip on top
 * of where the front axle is travelling (`STEER_ASSIST_SLIP_MARGIN`). At 20 km/h it is
 * still four fifths the car's axis, half and half at 26 km/h, nine tenths the tyres'
 * at 35. The release rate is blended over the same band. Backwards, it is the car's
 * axis.
 */
export const KEY_STEER_AXIS_KMH = 12;
export const KEY_STEER_TYRE_KMH = 40;
/**
 * Steering-box free play, radians at the ROAD WHEEL.
 *
 * A worn recirculating-ball box has 10-20° of slack at the rim, which through a 17:1
 * box is 0.6-1.2° at the tyre. Implemented as a backlash operator on the commanded
 * angle: the tyres do not move until the command leaves the play window, so the first
 * bit of every input does nothing and a reversal costs 2x the play before anything
 * happens. That is the "delay between input and response", and unlike a time delay it
 * is honest, because holding an angle still holds it.
 *
 * IT WAS 0.024, AND THAT MADE TAP STEERING IMPOSSIBLE. A backlash window is dead travel
 * that has to be crossed twice per correction, and a player tapping a key makes a
 * correction by DEFINITION out of reversals — so the play was subtracted from every
 * single input, not from the rare one. Measured on the tap sweep (`tools/tap-response.ts`), with the play at 0.024, the whole bottom half of the tap range did nothing:
 * 40, 60 and 80 ms all produced under 0.04 degrees of road-wheel angle, and the first
 * tap that moved the wheels at all was 120 ms, which then produced 1.29 degrees. Set
 * the play to zero and the cliff vanishes, which is how the play — not the input curve —
 * was identified as its main cause.
 *
 * 0.008 rad is 0.46°, at the tight end of what a worn box honestly has, and it is
 * chosen deliberately at that end: the character is worth keeping, the dead zone is
 * not. Inside the window the tyres are moved by their aligning moment
 * (`STEER_FREE_TAU_S`), so the slack is taken up in the direction of LOAD: a
 * countersteering driver moves the rack the way the road is already pushing the tyres,
 * and the window is crossed ahead of the hands instead of behind them.
 */
export const STEER_PLAY_RAD = 0.008;
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
 * It is used in two places. With no hand on the wheel (keys released, stick centred)
 * the whole rack is free: let go mid-corner and the wheel unwinds toward the way the
 * car is going and the car straightens; let go with the tail out and the same moment
 * countersteers, which is what a real wheel spinning through a driver's loose fingers
 * does. With a hand on it, only the backlash window is free, which replaces a constant
 * 1.2 rad/s "caster return" inside the play.
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
 * Ceiling on the axle roll the geometry reads, radians (~9°). Past it a wheel is
 * hanging in the air rather than rolling with the body, and its "roll" is droop.
 */
export const AXLE_ROLL_LIMIT_RAD = 0.15;
/**
 * Driveline slack and compliance, seconds. A leaf-sprung live axle on worn U-joints
 * does not deliver torque the instant the pedal moves: the slack takes up, the
 * shaft winds, and then the car goes. A first-order lag on the applied wheel torque
 * is the whole of it — no fake clunk, and it costs one float of state.
 */
export const DRIVELINE_LAG_S = 0.1;

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
 * far. Stack that on REAR_AXLE_SIDE_GRIP and the yaw
 * feedback is POSITIVE: more yaw gives more rear slip gives less rear grip gives more
 * yaw. At 100 km/h and 15 degrees of slip the rear ended on ~0.48 of lateral gain
 * against the front's ~0.72, so there was no restoring moment for a countersteer to
 * work against and the only outcomes were a spin or a lucky lift.
 *
 * The character is preserved by MAGNITUDE, not by falloff, which is the right split:
 * REAR_AXLE_SIDE_GRIP (0.95) is untouched, so the
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
export const SLIP_PEAK_FRONT_DEG = 6.6;
export const SLIP_PEAK_REAR_DEG = 6;
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
export const SLIP_CURVE_SHARPNESS = 2.2;
/** `tanh(k)`, so the shape normalises to exactly 1 at the peak without a per-wheel call. */
export const TANH_SHARPNESS = Math.tanh(SLIP_CURVE_SHARPNESS);
/** Slip angle (deg) by which the fade is complete and the plateau has been reached. */
export const SLIP_FULL_FRONT_DEG = 26;
export const SLIP_FULL_REAR_DEG = 22;
/** Side grip retained on the plateau, as a fraction of the axle's peak. */
export const SLIP_PLATEAU_FRONT = 0.8;
export const SLIP_PLATEAU_REAR = 0.8;
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
 * combined slip `z` (σ in the COMBINED SLIP block, 1 at the side-force peak): the brush
 * model's own result with the parabolic pressure `sideForceShape` uses,
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
 * its slow recirculating-ball steering, cross-ply tyre response and live-axle balance.
 * The GTA SA conversions span later radial-tyred road cars and working 4x4/van
 * chassis; forcing all of them through that Soviet baseline is why visually modern
 * cars felt delayed, vague and tail-light.
 */
export interface HandlingTuning {
  /** Rack speed, rad/s at the road wheel: see `STEER_RACK_SPEED_RAD_S`. */
  readonly steerRackSpeed: number;
  readonly steerPlay: number;
  readonly bumpSteer: number;
  readonly drivelineLag: number;
  readonly lateralGripFraction: number;
  /**
   * The profile's own cornering quality, multiplied ON TOP of the surface's measured
   * coefficient — later radials and quicker racks against the period baseline. 1.0 is
   * the classic profile, which is what the surface table is quoted for.
   */
  readonly tyreLateralScale: number;
  readonly rearAxleSideGrip: number;
  readonly slipPeakFrontDeg: number;
  readonly slipPeakRearDeg: number;
  readonly tyreRelaxationLength: number;
}

/** The side-force curve's shape, per axle: see `tyreCurve`. */
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

/**
 * THE CAR'S OWN TYRE. Without a `TyreSpec` a car runs its handling profile's curve and
 * the constants above, exactly as before. With one, the curve comes from the sidewall:
 *
 *   peak slip angle   a cross-ply carcass needs about 8 degrees to reach its peak; a
 *                     radial's peak falls with its sidewall, 3 + 4 · aspect (6.3 at
 *                     an 82-series, 5 at a 50), the spread road tests measure.
 *   relaxation        the rolling distance to build force: 0.45 m for cross-ply, and
 *                     0.1 + 0.3 · aspect for a radial, from 0.35 m at 82-series down to
 *                     0.24 m at 45 — tall rubber lags, low rubber answers at once. The
 *                     longitudinal one is LONGITUDINAL_RELAXATION_RATIO of it.
 *   breakaway         what the tyre keeps past its peak and how soon it gets there:
 *                     a cross-ply fades gently to 0.86 by 30 degrees, a tall radial
 *                     to 0.84 by 26, a 45-series to 0.72 by 20. That is the feel of
 *                     a slide: a tall tyre warns and forgives, a low one lets go.
 *
 * The rear peaks 0.6 degrees before the front and reaches its plateau 4 degrees
 * sooner, the same relation the profile constants keep (see SLIP_PEAK_*).
 */
export function tyreCurve(spec: { construction: 'crossply' | 'radial'; aspect: number } | undefined, handling: HandlingTuning): TyreCurve {
  if (!spec) {
    return {
      peakFrontDeg: handling.slipPeakFrontDeg,
      peakRearDeg: handling.slipPeakRearDeg,
      fullFrontDeg: SLIP_FULL_FRONT_DEG,
      fullRearDeg: SLIP_FULL_REAR_DEG,
      plateauFront: SLIP_PLATEAU_FRONT,
      plateauRear: SLIP_PLATEAU_REAR,
      relaxationM: handling.tyreRelaxationLength,
      longitudinalRelaxationM: LONGITUDINAL_RELAXATION_RATIO * handling.tyreRelaxationLength,
    };
  }
  const aspect = Math.min(1, Math.max(0.3, spec.aspect));
  const crossply = spec.construction === 'crossply';
  const peak = crossply ? 8 : 3 + 4 * aspect;
  const full = crossply ? 30 : 12 + 17 * aspect;
  const plateau = crossply ? 0.86 : 0.72 + 0.35 * (aspect - 0.45);
  const relaxation = crossply ? 0.45 : 0.1 + 0.3 * aspect;
  return {
    peakFrontDeg: peak,
    peakRearDeg: peak - 0.6,
    fullFrontDeg: full,
    fullRearDeg: full - 4,
    plateauFront: Math.min(0.88, plateau),
    plateauRear: Math.min(0.88, plateau),
    relaxationM: relaxation,
    longitudinalRelaxationM: LONGITUDINAL_RELAXATION_RATIO * relaxation,
  };
}

/**
 * THE BRUSH TYRE: the side-force model for every car with a `TyreSpec`, which is the
 * whole catalogue. The curve above remains for A/B (`?tyre=curve`, or
 * `__bro.brushTyres(false)` on the move) and for a car that names no tyre.
 *
 * The tread is a row of bristles on the belt. Each one is carried through the contact
 * patch and deflects sideways with the slip until the local grip under it runs out,
 * from the back of the patch forward. With the load pressed over the patch as a
 * parabola, the side force as a fraction of the grip is
 *
 *     s(z) = 3z - 3z² + z³   for z < 1, and 1 once the whole patch slides,
 *     z    = tan α · Cα / (3 μ Fz)
 *
 * which is the model racing simulators build on. What it adds over a fixed curve is
 * that the angle the tyre peaks at is not a constant: cornering stiffness Cα grows
 * more slowly than load (`BRUSH_STIFFNESS_LOAD_EXPONENT`), so a tyre pressed harder
 * reaches its peak LATER and a light one sooner — the outside front of a car loaded
 * into a bend needs more lock than it did in a straight line, and a light inside tyre
 * lets go at small angles. At the car's static load it peaks exactly where the
 * `TyreCurve` says, so the two models agree in the straight and part in the bend.
 */
export const TYRE_MODEL = { brush: true };
/** Cα ∝ Fz^this: 0.7 is a passenger radial's measured sublinear growth. */
export const BRUSH_STIFFNESS_LOAD_EXPONENT = 0.7;

/**
 * The brush tyre's peak, as the TANGENT of the angle it peaks at for this load:
 * `loadRatio` is Fz over the static load and `muRatio` the load-sensitivity factor
 * already in the capacity. Its side slip `z` is `tan α` over this, so z = 1 at the peak.
 */
export function brushPeakTan(staticPeakDeg: number, loadRatio: number, muRatio: number): number {
  const ratio = Math.max(0.05, loadRatio);
  // Cα / (μ Fz) at static load, from the static peak: z reaches 1 there.
  const stiffness = 3 / Math.tan((staticPeakDeg * Math.PI) / 180);
  const scale = (stiffness * ratio ** BRUSH_STIFFNESS_LOAD_EXPONENT) / (ratio * Math.max(0.05, muRatio));
  return 3 / scale;
}

/**
 * The side-force curve's shape at slip angle `slipRad`, as a fraction of the tyre's
 * lateral capacity, under PURE side slip. Both models rise to a peak and fade to the
 * plateau between `fadePeakDeg` and `fullDeg`:
 *
 *   brush   rises as 3z - 3z² + z³ with z = tan α / `peakTan` (`brushPeakTan`), and
 *           fades from `fadePeakDeg`, its own peak held a degree short of `fullDeg`
 *   curve   rises as tanh(k · α/α_peak) / tanh(k) to the peak at `fadePeakDeg`;
 *           `peakTan` is that angle's tangent and only normalises its combined slip
 */
export function sideForceShape(
  slipRad: number,
  peakTan: number,
  fadePeakDeg: number,
  fullDeg: number,
  plateau: number,
  brush: boolean,
): number {
  const slipDeg = (slipRad * 180) / Math.PI;
  let risen: number;
  if (brush) {
    const z = Math.tan(Math.min(slipRad, 1.4)) / peakTan;
    risen = z >= 1 ? 1 : 3 * z - 3 * z * z + z * z * z;
  } else {
    risen = Math.tanh(SLIP_CURVE_SHARPNESS * Math.min(slipDeg / fadePeakDeg, 1)) / TANH_SHARPNESS;
  }
  const fadeT = Math.min(1, Math.max(0, (slipDeg - fadePeakDeg) / (fullDeg - fadePeakDeg)));
  return risen * (1 - (1 - plateau) * fadeT * fadeT * (3 - 2 * fadeT));
}

// ---------------------------------------------------------------------------
// COMBINED SLIP: one patch, one budget, spent both ways.
//
// A tyre's two slips are two components of ONE sliding of the tread over the road, so
// the force each direction gets is decided by both. The model is the normalised-slip
// one: each slip is measured in units of its own peak,
//
//     σx = κ / κ_peak               κ_peak = optimalSlip · LONGITUDINAL_PEAK_U
//     σy = tan α / tan α_peak       (the brush's z, the curve's own peak)
//     σ  = √(σx² + σy²)
//
// and each channel reads its OWN pure-slip curve at the combined σ and keeps the share
// of it that its slip is of the whole:
//
//     Fx = Cap_x · Fx_pure(σ) · σx/σ        Fy = Cap_y · Fy_pure(σ) · σy/σ
//
// With the other slip zero this IS the pure curve, to the digit, so every straight-line
// and every throttle-steady figure the pure curves were calibrated on stands. Near zero
// slip it reduces to each channel's own pure stiffness (Fx_pure(σ)/σ → its slope), so
// the stiffnesses stand too. Only when both slips are present does anything change, and
// then it changes BOTH ways: drive or brake slip shrinks the side force, and slip angle
// shrinks the drive and brake force, which the one-way friction ellipse this replaced
// never did — a driven wheel kept its whole traction mid-corner.
//
// A locked wheel needs no constant of its own any more. At κ = -1 its σx is several
// times its σy, so the side share is small and grows with slip angle, the way a sliding
// patch's force follows its sliding direction (`tools/combined-slip.ts` prints it).
// ---------------------------------------------------------------------------

/**
 * The longitudinal force curve under pure slip, as a fraction of capacity, at
 * `u = κ / optimalSlip`: a peak term that decays past u = 1 blended with a sliding
 * plateau (`SLIDING_GRIP_FRACTION`), so a spinning or locked tyre keeps three quarters
 * of its grip. Odd in `u`. Its true maximum is at `LONGITUDINAL_PEAK_U`.
 */
export function longitudinalShape(u: number): number {
  return (
    (1 - SLIDING_GRIP_FRACTION) * ((2 * u) / (1 + u * u)) +
    SLIDING_GRIP_FRACTION * Math.tanh(SLIDE_CURVE_GAIN * u)
  );
}

/** d`longitudinalShape`/du. Even in `u`; negative past the peak. */
export function longitudinalShapeSlope(u: number): number {
  const th = Math.tanh(SLIDE_CURVE_GAIN * u);
  const d = 1 + u * u;
  return (
    (1 - SLIDING_GRIP_FRACTION) * ((2 * (1 - u * u)) / (d * d)) +
    SLIDING_GRIP_FRACTION * SLIDE_CURVE_GAIN * (1 - th * th)
  );
}

/**
 * Longitudinal force as a fraction of the longitudinal capacity under combined slip:
 * `longSlip` is σx (signed), `sideSlip` σy (see the block above).
 */
export function combinedLongitudinal(longSlip: number, sideSlip: number): number {
  const total = Math.hypot(longSlip, sideSlip);
  if (total < 1e-9) return 0;
  return (longitudinalShape(total * LONGITUDINAL_PEAK_U) * longSlip) / total;
}

/**
 * d`combinedLongitudinal`/dσx: the pure slope along the slip direction, plus the
 * secant the lateral share holds the force on. At `sideSlip = 0` it is the pure curve's
 * own slope.
 */
export function combinedLongitudinalSlope(longSlip: number, sideSlip: number): number {
  const total = Math.hypot(longSlip, sideSlip);
  if (total < 1e-9) return LONGITUDINAL_PEAK_U * longitudinalShapeSlope(0);
  const cx = longSlip / total;
  const cy = sideSlip / total;
  const u = total * LONGITUDINAL_PEAK_U;
  return LONGITUDINAL_PEAK_U * longitudinalShapeSlope(u) * cx * cx + (longitudinalShape(u) / total) * cy * cy;
}

/**
 * Side force as a fraction of the lateral capacity under combined slip: the side
 * curve (`sideForceShape`) read at the angle whose σy is the combined σ, times σy/σ.
 * `sideSlip` is σy ≥ 0, `longSlip` σx; the curve arguments are `sideForceShape`'s.
 */
export function combinedLateral(
  sideSlip: number,
  longSlip: number,
  peakTan: number,
  fadePeakDeg: number,
  fullDeg: number,
  plateau: number,
  brush: boolean,
): number {
  const total = Math.hypot(longSlip, sideSlip);
  if (total < 1e-9) return 0;
  const shape = sideForceShape(Math.atan(total * peakTan), peakTan, fadePeakDeg, fullDeg, plateau, brush);
  return (shape * sideSlip) / total;
}

export const HANDLING_PROFILES: Readonly<Record<HandlingProfile, HandlingTuning>> = {
  classic: {
    steerRackSpeed: STEER_RACK_SPEED_RAD_S,
    steerPlay: STEER_PLAY_RAD,
    bumpSteer: BUMP_STEER_MAX_RAD,
    drivelineLag: DRIVELINE_LAG_S,
    lateralGripFraction: LATERAL_GRIP_FRACTION,
    tyreLateralScale: 1,
    rearAxleSideGrip: REAR_AXLE_SIDE_GRIP,
    slipPeakFrontDeg: SLIP_PEAK_FRONT_DEG,
    slipPeakRearDeg: SLIP_PEAK_REAR_DEG,
    tyreRelaxationLength: 0.45,
  },
  road: {
    // The old rate pair's own ratio to classic's (×1.25 parked, ×1.44 at speed).
    steerRackSpeed: (78 * Math.PI) / 180,
    steerPlay: 0.006,
    bumpSteer: 0.009,
    drivelineLag: 0.055,
    lateralGripFraction: 0.36,
    tyreLateralScale: 1.0824,
    rearAxleSideGrip: 0.985,
    slipPeakFrontDeg: 5.9,
    slipPeakRearDeg: 5.5,
    tyreRelaxationLength: 0.28,
  },
  sport: {
    steerRackSpeed: (100 * Math.PI) / 180,
    steerPlay: 0.003,
    bumpSteer: 0.005,
    drivelineLag: 0.035,
    lateralGripFraction: 0.39,
    tyreLateralScale: 1.1765,
    rearAxleSideGrip: 0.99,
    slipPeakFrontDeg: 5.25,
    slipPeakRearDeg: 5,
    tyreRelaxationLength: 0.2,
  },
  utility: {
    steerRackSpeed: (70 * Math.PI) / 180,
    steerPlay: 0.012,
    bumpSteer: 0.016,
    drivelineLag: 0.075,
    lateralGripFraction: 0.34,
    tyreLateralScale: 0.9647,
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
 * Fraction of the vehicle's MEASURED total longitudinal capacity that a floored
 * pedal asks for, where the tyres rather than the car's own brakes (`brakeDecelG`)
 * are the limit — loose ground, the wet, bald tyres. On dry asphalt the brakes give
 * out first, as they did on the real cars.
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
 * The pedal's own ceiling is the car's `brakeDecelG`. It used to be a single fleet
 * constant, while the thing that really held these cars to their period stops — the
 * drums themselves — lived inside the tyre's coefficient, and made every tyre spin in
 * first gear on dry asphalt to keep the stopping distances right.
 *
 * It is deliberately an AGGREGATE, summed over the vehicle, not a per-wheel
 * allocation. Per-wheel negotiation would be an anti-lock brake the era never had:
 * no wheel would ever be over-asked, so nothing would ever lock, and cadence braking
 * would stop being a mechanism. Sized against the total and then split on the fixed
 * FOOT_BRAKE_REAR_BIAS below, the light rear axle is still asked for more than its
 * own share of the grip, so the rears still fill their cone first and the tail still
 * comes round. That is the whole character of the brake, and it survives.
 */
export const FOOT_BRAKE_GRIP_RATIO = 0.99;
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
export const WHEEL_LOAD_TAU = 0.025;
/**
 * THE SLIP THE LONGITUDINAL CURVE PEAKS AT IS A SURFACE PROPERTY, and it now lives in
 * `SurfaceProps.optimalSlip` rather than here. It used to be this one constant (0.12, a
 * period cross-ply on asphalt) for every surface in the world, which quietly made the
 * whole model read sand at an asphalt slip angle — see the field's own note.
 */
/**
 * Force a fully sliding tyre keeps, as a fraction of its peak. This is why ABS
 * exists: locking costs about a quarter of the grip, and it is now that ratio
 * doing the work rather than a separate locked-deceleration constant.
 */
export const SLIDING_GRIP_FRACTION = 0.75;
/** How quickly the sliding plateau is reached, in units of PEAK_SLIP_RATIO. */
export const SLIDE_CURVE_GAIN = 1.5;
/**
 * Where the longitudinal force curve (`longitudinalShape`) really peaks, in units
 * of the surface's `optimalSlip`: the sliding plateau lifts the peak past the peak
 * term's own u = 1, to about 1.45. Below it a tyre is working, not sliding — a hard
 * launch runs right up to it — so anything that SHOWS sliding (spray, dark tracks)
 * starts here. It is also the longitudinal slip that counts as ONE in combined slip
 * (see COMBINED SLIP). Found numerically from the two curve constants so it cannot
 * drift.
 */
export const LONGITUDINAL_PEAK_U = ((): number => {
  let best = 1;
  let bestForce = 0;
  for (let u = 1; u <= 4; u += 0.001) {
    const force = longitudinalShape(u);
    if (force > bestForce) {
      bestForce = force;
      best = u;
    }
  }
  return best;
})();

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
 * μ scales as 1 - k·(Fz/Fz_static - 1), so it is EXACTLY 1 at the static load and
 * the calibrated straight-line figures are untouched. 0.18 is a mild period value:
 * an outer tyre carrying 1.6x its static load keeps 89% of its μ, so a hard corner
 * loses a few per cent of total grip and the loaded end gives up first.
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
 * by. Rapier applies that linear part; `updateWheelDynamics` adds the bleed's extra
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
 * length when parked and the ray still starts above the wheel centre. It cannot
 * change how the car rides — sag is set by the frequency and the mount is then placed
 * to put the wheel on the ground — and it cannot change the available droop, which
 * for a linear spring is exactly the sag.
 */
export const MOUNT_ABOVE_WHEEL_CENTRE = 0.12;
/**
 * Rapier's per-wheel suspension force ceiling, as a multiple of that corner's static
 * load. It exists so a catastrophic landing cannot launch the car; the bump stop above
 * is what shapes ordinary bottoming, and it peaks well below this.
 */
export const SUSPENSION_FORCE_HEADROOM = 9;
/**
 * Static holding deceleration for a parked car nobody is driving, m/s². Applied
 * across all four wheels so it remains at rest on any drivable road grade. A driven
 * car's handbrake is a cable lock on every wheel instead (`cableLocked` in vehicle.ts).
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
export const SHOVE_SPEED_CAP = 0.4;
export const SHOVE_RAMP_SECONDS = 1.5;
export const SHOVE_RELEASE_SECONDS = 0.2;
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
export const SHOVE_BRAKE_FRACTION = 0.01;
/** Residual motion treated as stopped before an automatic changes drive direction. */
export const AUTO_DIRECTION_RELEASE_MPS = 0.08;
/** Hard road-speed ceiling for a catastrophically damaged but still running engine. */
export const DESTROYED_ENGINE_SPEED_CAP_MPS = 20 / 3.6;

// ---------------------------------------------------------------------------
// Body roll and lateral load transfer: from the linkage, not from a gain.
//
// Rapier's ray-cast vehicle is a port of Bullet's, and Bullet throws the roll
// couple away ("roll influence"). This car does not use Rapier's side friction at
// all any more: `updateWheelDynamics` makes each tyre's side force itself and
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
export const INERTIA_PITCH_YAW_GAIN = 2.55;
/** Roll inertia is closer to a box's, since mass is not spread across the width. */
export const INERTIA_ROLL_GAIN = 1.35;

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

/** Roll damping on the chassis for stability against low-speed flop. */
export const CHASSIS_ANGULAR_DAMPING = 0.1;

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
 * its collider and the ray-cast suspension never see this: it is drawn on top
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
 * It is the longitudinal counterpart of the roll centre (see the body-roll block
 * above): the share of the moment the links carry never reaches the springs. Here the
 * engine applies the moment in full at the contact patch, so that share is taken out.
 *
 * Real geometry runs 20-50% anti-squat and 20-40% anti-dive, and the two differ
 * because the ends of the car are built differently — a live rear axle on trailing
 * leaves has far more anti-squat available than a MacPherson front has anti-dive. The
 * pair below sit inside those bands, deliberately at the low end: this removes the
 * exaggeration, it does not iron the car flat. Squat and dive are how a driver reads
 * weight transfer, and a car with no pitch at all feels like it is on rails.
 */
export const ANTI_SQUAT_FRACTION = 0.38;
export const ANTI_DIVE_FRACTION = 0.26;

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
