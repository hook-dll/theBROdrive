/**
 * Every static constant the car model is read through: steering, grip and tyre
 * temperature, slip, brakes, wheel inertia and the dig, suspension, roll and pitch,
 * aero and fluids, damage, bounce — plus the handling profiles, the tyre compounds
 * and the pure helpers they are selected and evaluated with.
 *
 * Nothing here holds state. The runtime that reads it is vehicle.ts, and the
 * constants only the lamps read live in vehiclelamps.ts. The `why` notes travel with
 * the constants they explain.
 */

import { SurfaceType } from '../core/surfaces';
import { FLUID_DENSITY } from '../items/items';
import { variant, type FuelType } from '../parts/registry';
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
// Four stages shape the wheel angle:
//  1. The profile shapes the input axis with a power law, progressively or directly.
//  2. Available lock falls with speed; later steering retains more authority.
//  3. Steering angle is rate-limited by the profile's rack or box speed.
//  4. The result passes through the profile's mechanical backlash window.
//
// The constants immediately below are the established `classic` values. They feed
// `HANDLING_PROFILES`; fixedUpdate reads only the selected immutable profile.
// ---------------------------------------------------------------------------


/**
 * Steering input shaping exponent: |s|^p with p>1 compresses small deflections, which
 * is what a soft centre is.
 *
 * IT IS THE SECOND SOFT CENTRE IN SERIES, and that is what sets its size. The input
 * layer already smoothes a binary key into a ramp (see core/input.ts), so the value
 * this exponent sees from a keyboard is never a human's analogue position — it is that
 * ramp, halfway up, most of the time. Squaring the compression on top of the ramp
 * leaves the bottom of the range doing nothing at all.
 *
 * Measured with `tools/tap-response.ts`, one steering tap at 60 km/h, road-wheel
 * angle at the peak of the response:
 *
 *   tap     1.55 (was)     1.25 (now)
 *   40 ms       0.00 deg       0.86 deg
 *   80 ms       0.03 deg       1.92 deg
 *   120 ms      1.29 deg       3.54 deg
 *   160 ms      2.19 deg       4.59 deg
 *
 * The old curve was not merely steep, it had a CLIFF: everything below 100 ms of tap
 * produced literally nothing, and 120 ms produced more than a degree. That is the one
 * shape a discrete input cannot be asked to steer with, because the player's finest
 * available correction lands on the wrong side of it. At 1.25 the response is smooth
 * across the whole range — 0.86, 1.92, 3.54, 4.59 — and a light tap now means a light
 * correction.
 *
 * It is still well above 1, so the centre is still softer than the rim: the top of the
 * travel remains the part that gives the most angle per unit of input, which is what
 * keeps a full-lock demand from being twitchy.
 */
export const STEER_INPUT_EXPONENT = 1.25;
/** Max rate of steering-angle change at parking speed (rad/s). */
export const STEER_RATE_PARK_RAD_S = 2.0;
/** Max rate of steering-angle change at highway speed (rad/s). */
export const STEER_RATE_HIGHWAY_RAD_S = 0.5;
/** Below this speed (km/h) the full steering lock is available. */
export const STEER_FULL_LOCK_KMH = 20;
/** At this speed (km/h) steering reaches its reduced floor. */
export const STEER_REDUCED_KMH = 100;
/**
 * Fraction of full lock retained at STEER_REDUCED_KMH. Enough remains for an
 * intentional slide, but an ordinary key tap cannot demand cornering lock at speed.
 */
export const STEER_HIGH_SPEED_FRACTION = 0.44;
/**
 * Lock falls progressively with speed. The old 0.161 exponent discarded almost
 * half the available steering by 50 km/h, so slowing before a turn barely changed
 * wheel angle and felt like permanent understeer.
 */
export const STEER_LOCK_CURVE = 1.0;
/** Same curve shape drives the rate-limit blend between the two speeds above. */
export const STEER_RATE_CURVE = 1.6;
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
 * single input, not from the rare one. Measured on the same tap sweep as the exponent above, with the play at 0.024, the whole bottom half of the tap range did nothing:
 * 40, 60 and 80 ms all produced under 0.04 degrees of road-wheel angle, and the first
 * tap that moved the wheels at all was 120 ms, which then produced 1.29 degrees. Set
 * the play to zero and the cliff vanishes, which is how the play — not the exponent —
 * was identified as its main cause.
 *
 * 0.008 rad is 0.46°, at the tight end of what a worn box honestly has, and it is
 * chosen deliberately at that end: the character is worth keeping, the dead zone is
 * not. Note that it is already faded out entirely during a slide (see `slideRelease`),
 * for the same reason — a countersteering driver is making exactly this kind of
 * reversal, and the argument is the same one.
 */
export const STEER_PLAY_RAD = 0.008;
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
export const STEER_CASTER_RETURN_RAD_S = 1.2;
/**
 * Uneven-load steering disturbance. A worn front end does not keep both tie rods
 * perfectly aligned when one wheel climbs a bump. The effect is driven by the actual
 * left/right suspension-load difference, amplified by rough surfaces, and filtered so
 * one collider triangle cannot teleport the steering wheel.
 */
export const BUMP_STEER_MAX_RAD = 0.022;
export const BUMP_STEER_TAU = 0.09;
export const BUMP_STEER_FULL_ROUGHNESS = 0.045;
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
 * Floor on the friction ellipse's lateral term.
 *
 * A tyre that spends its entire budget on braking has none left for cornering, and
 * the ellipse says so: the term is exactly zero at full longitudinal usage. Kept
 * slightly off zero because a literal zero makes a locked wheel a perfect castor —
 * numerically, not physically — and the slip-angle curve already gives the slide its
 * shape. It is a numerical floor, not a handling one: at ordinary usage the term is
 * the full ellipse.
 */
export const ELLIPSE_LATERAL_FLOOR = 0.05;

/**
 * Grip multiplier for a tyre at this temperature, 1.0 at the reference.
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
 * mu(Fz) means the loaded outer tyre gives up first and the friction ellipse means a
 * driven rear spends its side grip on power — so the authored deficit is stacked on top
 * of emergent ones, and the stack was the rear sliding in every corner in every car.
 */
export const REAR_AXLE_SIDE_GRIP = 0.95;

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
export const PNEUMATIC_TRAIL_M = 0.045;
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
export const COUNTERSTEER_RELEASE_START_DEG = 7;
export const COUNTERSTEER_RELEASE_FULL_DEG = 18;

/**
 * Mechanical handling families. The Soviet catalogue stays on `classic`, preserving
 * its slow recirculating-ball steering, cross-ply tyre response and live-axle balance.
 * The GTA SA conversions span later radial-tyred road cars and working 4x4/van
 * chassis; forcing all of them through that Soviet baseline is why visually modern
 * cars felt delayed, vague and tail-light.
 */
export interface HandlingTuning {
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

export const HANDLING_PROFILES: Readonly<Record<HandlingProfile, HandlingTuning>> = {
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
    tyreLateralScale: 1,
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
    tyreLateralScale: 1.0824,
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
    tyreLateralScale: 1.1765,
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
 * Foot-brake pedal ceiling (m/s²): the most the hydraulics can ask for at full
 * pedal, before the tyres get a say. It only binds where grip is plentiful — a
 * high-wheelGrip car on clean asphalt on the experimental2 compound reaches
 * 1.2 · 1.1 · 0.988 = 1.30 g of capacity — and is what stops that combination
 * out-braking a modern car outright.
 */
export const FOOT_BRAKE_MAX_DECEL = 13.0;
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
/** Lateral grip left on a locked, sliding tyre. */
export const LOCKED_SIDE_GRIP = 0.22;

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
 * needed to hold 18.7 degrees at sand's own rolling resistance of 0.16. Raising the
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
 * world: just under asphalt's own 0.013, and a thirteenth of the loose sand it replaces.
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
 * WHAT BREAKS WITHOUT IT. `tools/climb-sweep.ts` measures the steepest grade each body
 * escapes from a parked start, and the road's own steepest grade is measured by
 * `tools/road-profile.ts`. Those two numbers are supposed to nest — the road is what the
 * fleet was designed around — and they do not: the starter VAZ-2101 escapes 10.9 degrees
 * of honest asphalt, while seed 1's road reaches 21.0% (11.9 degrees) and six seeds
 * measured reach 17.0-21.0%. From a standstill on one of those pitches the stock car
 * cannot move at all: measured on a 12-degree ramp, it sits at 0 km/h with the driven
 * wheels at 7.2 rad/s and a slip ratio of 7 against a peak-slip of 0.12, and the grade
 * wins. Even the whole plateau is not the problem — the tyre's own best point is
 * `0.946 * capacity`, and the capacity is short.
 *
 * WHY NO COEFFICIENT FIXES IT. A 2101's `wheelGrip` is 0.558 — worn Soviet factory
 * tyres — and asphalt's own coefficient is 0.988, so the driven axle works at 0.551 of
 * mu. On an 18.7-degree climb the rear axle carries 5.1 kN and the grade asks 3.0 kN, so
 * the axle needs 0.63 of mu to hold it and has 0.55. That is not a tuning error, it is
 * the arithmetic of a 1.2-litre car on hard rubber, and it is why the honest model stops
 * it just below the steepest road the generator can draw.
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
 * BUMP_STOP_PEAK times the corner's static load when fully crushed.
 */
export const BUMP_STOP_FRACTION = 0.4;
export const BUMP_STOP_PEAK = 6;
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
 * Static holding deceleration for a parked car, m/s². Applied across all four
 * wheels so a braked car remains at rest on any drivable road grade.
 */
export const PARK_BRAKE_DECEL = 12.0;
/** Below this ground speed a braked car becomes a physically fixed parked car. */
export const PARK_HOLD_SPEED_MPS = 0.12;
/**
 * Share of its own weight the springs must be carrying before a parked car may be
 * PINNED in place, as a fraction of `m·g`.
 *
 * The hold works by teleporting the chassis back to the pose it latched, every step.
 * That is only a resting pose if the car was standing on its wheels when it latched,
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
export const ROLL_COUPLE_GAIN = 1;
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
export const ANTI_ROLL_FRONT_FRACTION = 0.55;
export const ANTI_ROLL_REAR_FRACTION = 0.3;
/**
 * Low-pass time constant for the lateral-acceleration estimate, seconds. The shorter
 * window lets a bump or quick steering correction move the body before the next bend.
 */
export const ROLL_ACCEL_TAU = 0.045;
/** Ceiling on the restored couple, in g of lateral acceleration. */
export const ROLL_ACCEL_MAX = 12;
/** Lean angle, degrees, at which the couple has faded to nothing. */
export const ROLL_LIMIT_DEG = 17;
/**
 * Roll-rate damping, as a fraction of roll inertia per second. This is intentionally
 * below the previous road-car value: the worn damper should take a set, then sway once
 * or twice over a disturbance instead of pinning the body flat.
 */
export const ROLL_RATE_DAMPING = 1.45;

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

/**
 * The fuel's density, kg/L.
 *
 * `'mixed'` weighs as diesel because a tank holding both holds at least some of the
 * heavier one, and a car with NO fuel kind is a dry tank — the term it feeds is
 * measured against a full tank either way, so the density only has to be right for
 * the litres actually present.
 */
export function fuelDensity(kind: FuelType | 'mixed' | null): number {
  if (kind === 'diesel' || kind === 'mixed') return FLUID_DENSITY.diesel;
  return FLUID_DENSITY.petrol;
}

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
 * 24 km of track over 6 km of desert, so the first clearly visible crust (a quarter)
 * arrives within about a kilometre and a half of sand or two and a half of graded
 * gravel, and one ordinary off-road leg leaves the car the colour of the desert. The
 * former 100 km took 25 km of sand, which no drive in the game ever reached. The
 * bounded slip multiplier below still makes a digging wheel throw more.
 */
export const BODY_DIRT_TYRE_METRES_TO_FULL = 24_000;
/**
 * Floor on how dusty any surface is FOR THE BODY. Sealed road reports `dust = 0`,
 * which is right for the spray effect (a tyre on tarmac throws no plume) and wrong
 * for paint: road film, sand blown across the carriageway and the spray of passing
 * traffic still settle. At 0.05 a car picks up a light film over some tens of
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
 */
export const COM_DROP_FRACTION = 0.45;


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
 * There is no `sport`. What it did on the surfaces where it was felt was traction
 * control, and traction control has since been deleted — see the note below on the
 * dig, which is what the tyre model does instead on loose ground.
 */
export const TYRE_COMPOUNDS = [
  { label: 'bald', grip: 0.55, side: 0.55 },
  { label: 'standard', grip: 1, side: 1 },
  { label: 'experimental', grip: 1, side: 0.55 },
  { label: 'experimental2', grip: 1.1, side: 0.3 },
] as const;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
