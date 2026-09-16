/** Fixed-step road follower. Inputs remain ordinary InputFrame commands. */
import type { InputFrame } from '../core/input';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../core/physics';
import { SurfaceType } from '../core/surfaces';
import type { RoadConditionBuffer } from '../world/gradient';
import { type DriveRoad } from '../world/road';
import { type HazardField, type RoadHazard } from '../world/hazards';
import type { Vehicle } from './vehicle';
import { evaluateCorridorLine, planCorridor, type CorridorObstacle } from './corridor';
import type { TrafficField, TrafficNeighbour } from './trafficfield';

/**
 * How far ahead the corridor is planned: three seconds of travel, bounded so a
 * standstill still looks far enough to plan a way out and a fast car does not pay
 * for sight no probe can supply.
 */
const CORRIDOR_HORIZON_SECONDS = 3;
const CORRIDOR_MIN_HORIZON_M = 60;
const CORRIDOR_MAX_HORIZON_M = 220;
/**
 * What the opposing lane costs a driver that is willing to use it, before its
 * mode's `passNerve` scales it. This single number replaces the old page of
 * passing thresholds: at 16 an overtake pays for itself once the car ahead is
 * costing roughly 3 m/s of pace, which is where a driver starts looking.
 */
const ONCOMING_LANE_COST = 16;
/**
 * Multiplier on that price for a driver crossing the crown only because something is
 * PARKED in its lane.
 *
 * CHEAPER THAN THE SAND, deliberately. A rock in the lane used to be gone round on
 * the shoulder by everybody, because two metres of verge at the shoulder price beat
 * any crown crossing — and cars bogged down out there, one after another, until the
 * verge itself was the blockage and the queue behind it had nowhere left to go. That
 * is what a five-minute standoff looked like. A real driver uses the empty oncoming
 * lane for this and keeps the sand for when that lane is busy; the crossing gate
 * still decides whether it is actually empty.
 */
const STILL_BYPASS_NERVE = 1.4;
/** Speed an unseen car coming the other way is assumed to be doing. */
const ONCOMING_ASSUMED_MPS = 20;
/** Opposing lane must be clear this far BEHIND before crossing into it. */
const ONCOMING_REAR_GAP_M = 20;
/** Clearance below which something alongside is squeezed past at walking pace. */
const CORRIDOR_SQUEEZE_M = 0.6;

export type AutopilotMode = 'sleeper' | 'hurried' | 'frantic';

/**
 * What the driver is doing right now. Dev HUDs and the playground benches read it;
 * no gameplay decision depends on it, so adding a state costs nothing.
 */
export type AutopilotActivity =
  | 'cruise'
  | 'follow'
  | 'pass'
  | 'avoid'
  | 'recover'
  | 'offroad';

interface ModeConfig {
  /** Speed asked for on a clear straight, m/s. */
  readonly cruiseMps: number;
  /** Cornering budget, m/s². This is what decides the speed a radius is taken at. */
  readonly lateralAccel: number;
  /** Deceleration the speed planner believes it can produce, m/s². */
  readonly brakeAccel: number;
  readonly lookaheadBase: number;
  readonly lookaheadSpeed: number;
  readonly brakeLead: number;
  readonly curveLead: number;
  /**
   * Fraction of the pure-pursuit chord error that is corrected. 1 follows the lane's
   * arc; 0 is the old behaviour, which cuts every bend toward its inside.
   */
  readonly chordGain: number;
  /**
   * Feed-forward compensation for tyre slip after Vehicle maps the command through
   * the exact handling profile.
   */
  readonly steeringGain: number;
  /**
   * Seconds of travel a cross-track error is taken out over, and the share of the
   * cornering budget lane keeping may spend doing it. Tighter holds the lane to a
   * few centimetres; looser wanders and is what keeps 130 km/h stable, since at that
   * speed a firm correction is a swerve.
   */
  readonly holdSeconds: number;
  readonly holdShare: number;
  /** Speed error, m/s, that asks for full throttle. Small is a sharp right foot. */
  readonly throttleBand: number;
  /** Speed error, m/s, that asks for the mode's full brake. */
  readonly brakeBand: number;
  /** Most brake pedal this mode uses for ordinary speed control. */
  readonly brakeCeiling: number;
  /** Seconds of headway kept behind a moving obstacle. */
  readonly headwayS: number;
  /** May it use the oncoming lane to pass a car that is merely SLOWER than it wants? */
  readonly overtakes: boolean;
  /** Curvature, rad/m, above which the road is too bent to commit to a pass. */
  readonly passCurvature: number;
  /**
   * NERVE. Multiplies every discretionary margin of an overtake: the sight it asks
   * for, the speed advantage it insists on, how slow a leader has to be to be worth
   * passing, and how long it will sulk after an abort. 1 is the cautious baseline.
   *
   * It deliberately does NOT touch the abort rules, the entry check behind, the
   * curvature the mode accepts, or anything the speed planner does with grip: a
   * bolder driver commits to smaller windows, it does not corner harder than the
   * tyres or stay in the oncoming lane once something appears in it. That is the
   * difference between hurrying and crashing.
   */
  readonly passNerve: number;
  /**
   * May this driver use ANOTHER LANE ON ITS OWN SIDE to get past somebody?
   *
   * Separate from `overtakes`, which is about crossing the crown. It is deliberately
   * rare, and the reason is that on a road with two lanes each way it is not needed:
   * drivers take the lane their own pace belongs in (`INNER_LANE_PACE_MPS`) and then
   * STAY there. A pass is a manoeuvre, and thirty cars each deciding to make one is a
   * stream that spends its life changing lanes — measured as exactly that, and
   * reported from play as cars shuttling between lanes and throwing themselves off
   * the road. Sorted by pace, the fast lane is already full of fast drivers and the
   * slow lane of slow ones, so there is nothing to gain by moving.
   *
   * What remains available to EVERY driver is the lane beside it as a way past
   * something STOPPED in its own (see the candidate gate in `drive`). This flag is
   * only about pace, and only the driver who is out of time has it.
   */
  readonly lanePasses: boolean;
  /**
   * Share of a loose surface's own grip a driver of this character dares to use.
   *
   * `SURFACE_SPEED_FACTOR` is one table for every driver, and it was set to the bound a
   * FRANTIC driver needed: at 0.72 on gravel it arrived at a bend, stood on the brake
   * inside it, lost the front and ran 1.2 m past the asphalt, so gravel came down to
   * 0.50. That is a bound on the controller, not on the surface — and charging every
   * driver the same 0.50 made the whole ambient stream crawl, because the stream has no
   * frantic drivers in it at all (see the traffic driver draw: sleeper and hurried only).
   *
   * So the strict bound is the frantic driver's, and this is the dial that says so. 1
   * spends the surface's whole grip ratio; frantic's 0.7 reproduces the measured grave
   * bound (0.72 x 0.7 = 0.50) for the only character that had earned it.
   */
  readonly looseSurfacePace: number;
}

/**
 * TWO DRIVERS, NOT ONE WITH A SPEED KNOB.
 *
 * `sleeper` is the character asleep at the wheel of his own life: 80 km/h, its own
 * lane, a cornering budget under half of what the tyres have, gentle pedals, and it
 * `frantic` is the same car driven by somebody who is out of time: 130 km/h, twice
 * the cornering budget, pedals used as switches, and it will take the oncoming lane
 * to get past traffic when it can see far enough to do it. Its corner entries are
 * deliberately less exact — half the chord correction — so it clips lines rather
 * than tracing them. Its number is left alone because the CAR runs out first: a
 * catalogue saloon measures 108 km/h flat out on this road's asphalt and 55 on its
 * gravel, so asking for more would only make its corner entries worse.
 *
 * Both hold the RIGHT-HAND LANE. That is the change with the widest reach: a car on
 * the centreline meets oncoming traffic head-on and has nowhere to put a swerve,
 * and on the test circuit it made the two modes look identical because the only
 * thing separating them was speed.
 */
const MODES: Record<AutopilotMode, ModeConfig> = {
  sleeper: {
    cruiseMps: 80 / 3.6,
    lateralAccel: 3.2,
    brakeAccel: 4.0,
    lookaheadBase: 11,
    lookaheadSpeed: 1.35,
    brakeLead: 18,
    curveLead: 30,
    chordGain: 0.9,
    steeringGain: 1.55,
    holdSeconds: 0.65,
    holdShare: 0.5,
    throttleBand: 6,
    brakeBand: 7,
    brakeCeiling: 0.55,
    headwayS: 2.2,
    overtakes: false,
    lanePasses: false,
    passCurvature: 0.012,
    passNerve: 1,
    looseSurfacePace: 1,
  },
  /**
   * The driver with somewhere to be and a licence to keep. 105 km/h, a cornering
   * budget two thirds of the tyres', pedals used deliberately rather than as
   * switches — and it overtakes, but only into a window it would take itself. It is
   * what ambient traffic's hurried drivers use, and the middle setting of the
   * player's own autopilot: livelier than sleeper without frantic's appetite for a
   * small gap.
   */
  hurried: {
    cruiseMps: 105 / 3.6,
    lateralAccel: 4.7,
    brakeAccel: 5.4,
    lookaheadBase: 10,
    lookaheadSpeed: 1.2,
    brakeLead: 12,
    curveLead: 27,
    chordGain: 0.68,
    steeringGain: 1.5,
    holdSeconds: 0.75,
    holdShare: 0.42,
    throttleBand: 3,
    brakeBand: 4,
    brakeCeiling: 0.8,
    headwayS: 1.6,
    overtakes: true,
    lanePasses: false,
    passCurvature: 0.010,
    passNerve: 0.88,
    looseSurfacePace: 1,
  },
  frantic: {
    cruiseMps: 130 / 3.6,
    lateralAccel: 6.8,
    brakeAccel: 7.2,
    lookaheadBase: 9,
    lookaheadSpeed: 1.0,
    brakeLead: 7,
    curveLead: 24,
    chordGain: 0.45,
    steeringGain: 1.45,
    holdSeconds: 0.85,
    holdShare: 0.35,
    throttleBand: 1.2,
    brakeBand: 1.8,
    brakeCeiling: 1,
    headwayS: 1.2,
    overtakes: true,
    lanePasses: true,
    // A bend of 0.009 rad/m is a 110 m radius: gentle enough that the speed planner
    // still allows most of this mode's pace through it. The old 0.006 demanded a
    // straighter road than the cautious mode did, which on a desert road that is
    // never quite straight is most of the reason an overtake never happened.
    passCurvature: 0.009,
    // Two thirds of the cautious margins. It is in a hurry, it takes the smaller
    // window, and it gets back in.
    passNerve: 0.66,
    // THE GRAVEL BOUND WAS A CORNER PROBLEM PAID FOR ON THE STRAIGHTS. 0.7 was the
    // fraction this mode was measured running off the road at — while braking at full
    // pedal INSIDE a gravel bend — so it charged every straight metre of a loose
    // district for a mistake that only happens in a corner, and it made the three
    // characters three fractions of one low number. The pedal owes that debt now:
    // BEND_BRAKE_SHARE_FLOOR takes the share of the tyres a bend is already using away
    // from the brake, so this mode spends a loose surface's whole ratio like the
    // careful ones.
    looseSurfacePace: 1,
  },
};

/** Read-only view of the tuning, so dev tools stop keeping their own stale copies. */
export const AUTOPILOT_MODES: Readonly<Record<AutopilotMode, ModeConfig>> = MODES;

/**
 * Steering is geometric. `Vehicle` interprets input as a fraction of the model's
 * steering lock, so a preview heading error cannot be sent directly as normalized
 * input. Pure pursuit computes the curvature of a waypoint and converts it to the
 * actual front-wheel angle before normalizing it.
 */
const DEFAULT_WHEELBASE_M = 2.6;
const MIN_PURSUIT_DISTANCE_SQ = 9;
/**
 * How much of a bend may be previewed, radians of arc, and the shortest preview the
 * steering stays stable with. See the cap in `drive`.
 */
const LOOKAHEAD_ARC_RAD = 0.5;
const MIN_LOOKAHEAD_M = 6;
/** Planner reserves transient tyre load and steering correction below the stable peak. */
const LATERAL_GRIP_RESERVE = 0.72;
const BRAKE_GRIP_RESERVE = 0.82;
/**
 * ONE SET OF TYRES CANNOT BRAKE AND CORNER AT THE SAME TIME, AND THE PEDAL HAS TO
 * KNOW IT.
 *
 * Ordinary speed control asked for its mode's whole brake ceiling whatever the tyres
 * were already doing laterally. On asphalt that is almost free — the budget is 7-9
 * m/s² and a sweeper spends a fraction of it — but a loose surface has a third of it
 * and a frantic driver uses pedals as switches: the measured failure was exactly
 * this, a bend on gravel entered at 70 km/h, full pedal INSIDE it, the front gone and
 * 1.2 m of road left behind. The bound written for that was a blanket pace factor on
 * the whole surface (`looseSurfacePace`), which charged the straights for a mistake
 * that only happens in a corner.
 *
 * So the brake pays the friction ellipse instead: whatever share of the cornering
 * budget the car is ACTUALLY using right now — its own yaw rate against the same
 * per-surface budget the speed plan was built from — is share the pedal does not get.
 * The floor keeps enough authority to slow down while already at the lateral limit,
 * which is the one situation where a driver still has to.
 *
 * Deliberately NOT applied to the brakes that exist to prevent a departure
 * (`edgeStability`, the off-road brake) or to the imminent-contact reflex: those are
 * the cases where the tyres are already past their budget and the answer is still the
 * pedal.
 */
const BEND_BRAKE_SHARE_FLOOR = 0.35;
const GRAVITY = 9.81;
/**
 * Straight-line pace by surface. Personality still sets the absolute speed: the
 * factors describe how much of it the road can support before bumps and loose grip
 * dominate. Decay and drifted sand reduce these further at the sampled location.
 *
 * These are COMFORT factors and nothing else. Every limit that grip actually
 * decides is computed from the real per-surface physics a few lines below — the
 * corner speed from `lateralAccel` against the sampled curvature, the approach from
 * `vehicle.estimatedBrakeDecel(surface)`, both reserved again by
 * LATERAL_GRIP_RESERVE and BRAKE_GRIP_RESERVE. So a factor low enough to be a grip
 * model is charging the car twice, and gravel's 0.45 was exactly that: measured on
 * seed 1337, 46% of this road is graded gravel and 50% is cracked asphalt, with 4%
 * of clean surface in total, so 0.45 was not an occasional loose district but the
 * pace of half the drive. It held an ordinary traffic car — 58-70 km/h of its own
 * — to a 26-31 km/h target and, through the pedal law, an actual 20-24 km/h. That
 * is a tractor on a highway, and it is why an overtake had no differential worth
 * the name: both cars were pinned to the same fraction of the same low number.
 *
 * The figures now describe a GRADED surface, which is what a road district is: a
 * gravel highway is driven briskly and the ride tells you it is gravel. A rutted
 * track is what the desert is for, and that is `Sand`.
 *
 * Gravel stops at 0.50 rather than going higher because that is where the CONTROLLER
 * runs out, not where the comfort argument does. At 0.72 a frantic driver reached
 * the bend at 12500 m (seed 42) doing 70 km/h, stood on the brake inside it — its
 * brake ceiling is 1.0, it uses pedals as switches — lost the front on the loose
 * surface and ran 1.2 m past the asphalt before recovering. 0.58 still left it
 * 0.7 m out; 0.50 keeps the whole body on the road with 0.2 m to spare. Modulating
 * the brake against real per-surface grip would buy the rest, and is the honest way
 * to go faster here; until then this is the bound.
 *
 * It is the traffic caps in world/traffic.ts that carry the pace of the stream, and
 * they are where the player's complaint actually lives. This factor only has to stop
 * being a second grip model.
 */
const SURFACE_SPEED_FACTOR: Readonly<Record<SurfaceType, number>> = {
  [SurfaceType.Asphalt]: 1,
  [SurfaceType.CrackedAsphalt]: 0.92,
  // GRAVEL AND ROCK TRACK THE SURFACE'S OWN GRIP, and that is the correction. Gravel
  // sits at 0.72 of asphalt's longitudinal coefficient (0.72 against 0.988) and rock at
  // 0.90 — rock is BETTER than the cracked asphalt beside it — while both were being
  // driven at 0.45-0.50, which is roughly half of what their own friction implies. The
  // road is a quarter gravel districts, so the whole ambient stream was held at about
  // 36 km/h there and reported from play as traffic that is simply slow.
  //
  // The strict bound those two used to carry belongs to the FRANTIC driver, which was
  // what it was measured on, and it lives on that mode now as `looseSurfacePace` — a
  // careful driver at 80 km/h with gentle pedals is not the car that ran off the road.
  [SurfaceType.Gravel]: 0.72,
  [SurfaceType.Rock]: 0.9,
  // SAND AND THE VERGE STAY CONSERVATIVE, and deliberately below their grip ratios.
  // Their coefficient is 0.44 of asphalt's, but the cost of being wrong there is not
  // running wide — it is bogging, which is a stop rather than a scare. A packed gravel
  // district road carries ordinary traffic; a sand pan does not.
  [SurfaceType.Sand]: 0.3,
  [SurfaceType.Concrete]: 0.96,
  [SurfaceType.LooseShoulder]: 0.45,
};
const DECAY_SPEED_LOSS = 0.14;
const SAND_COVER_SPEED_LOSS = 0.28;
/**
 * Straight-line share of a mode's cruise this stretch of road supports: the surface's
 * own comfort factor, reduced by how broken it is and by drifted sand.
 *
 * Exported because a bench that wants to know "did the driver get what the ROAD
 * allows" has to ask the controller, not keep a copy: every previous copy of these
 * numbers drifted from the ones the car actually used.
 */
export function surfacePaceFactor(
  mode: AutopilotMode,
  condition: Pick<RoadConditionBuffer, 'surface' | 'decay' | 'sandCover'>,
): number {
  const factor = SURFACE_SPEED_FACTOR[condition.surface];
  // Sealed surfaces are left alone: there is no character argument about how fast
  // asphalt may be driven. Only the loose ones take the mode's `looseSurfacePace`,
  // which is where the frantic driver's measured bound lives — see the table.
  const grip = factor >= 0.92 ? factor : factor * MODES[mode].looseSurfacePace;
  return (
    grip *
    Math.max(
      0.55,
      1 - condition.decay * DECAY_SPEED_LOSS - condition.sandCover * SAND_COVER_SPEED_LOSS,
    )
  );
}

/**
 * The speed this mode's own tuning allows HERE with nothing in the way: surface,
 * wear and the bend, and no traffic, no obstacle and no personality pace. It is the
 * reference a stream's measured pace has to be judged against, because a road that
 * is half graded gravel cannot carry highway speeds however good the driver is.
 */
export function roadPaceCeiling(
  mode: AutopilotMode,
  condition: Pick<RoadConditionBuffer, 'surface' | 'decay' | 'sandCover'>,
  curvature: number,
): number {
  const config = MODES[mode];
  return Math.min(
    config.cruiseMps * surfacePaceFactor(mode, condition),
    Math.sqrt(config.lateralAccel / Math.max(Math.abs(curvature), 1e-4)),
  );
}
const MIN_PLANNED_BRAKE_MPS2 = 0.75;
/** Chassis yaw feedback removes weave energy without weakening steady cornering. */
const YAW_RATE_DAMPING = 0.8;
/** Use only this share of geometric stopping distance, so setup finishes before a bend. */
const BRAKING_DISTANCE_RESERVE = 0.4;
/**
 * Half the widest catalogue body, metres, plus a little. Used only to decide whether
 * a hazard is in this car's corridor; a per-model figure would make the decision
 * differ between cars for no gain, and being slightly pessimistic is free.
 */
const CAR_HALF_WIDTH_M = 1.05;
/** Keeps the avoidance line until the whole vehicle has cleared the prop. */
const CAR_HALF_LENGTH_M = 3;
/** A standing person is narrow, but remains a physical body the whole car must clear. */
const PEDESTRIAN_RADIUS_M = 0.42;
const PEDESTRIAN_QUERY_RANGE_M = CORRIDOR_MAX_HORIZON_M + 20;
/**
 * Extra metres the middle avoidance rung asks for beyond bare body clearance, and the
 * fraction of that clearance the braking corridor is measured at. Together they
 * guarantee that a line the planner picks is outside the corridor that caused the
 * braking, which is what stops the two from deadlocking.
 */
const AVOID_HYSTERESIS_M = 0.4;
/** A valid indexed detour must keep rolling or its rate-limited line can never finish. */
const AVOIDANCE_CRAWL_MPS = 3.5;
/**
 * Share of the cornering budget a lateral manoeuvre may spend. The rest is left to the
 * steering controller, which is tracking the line this manoeuvre moves and needs grip
 * of its own to do it.
 */
const MANOEUVRE_LATERAL_SHARE = 0.45;
/**
 * How far ahead a blocked NEIGHBOURING lane is looked for before this driver starts
 * making room for the car that will have to leave it, and how much slower than that
 * car it settles to while it does. Half a lane change of road and a walking-pace
 * difference: enough for a gap to open, small enough that the clear lane keeps moving.
 */
const MERGE_YIELD_LOOKAHEAD_M = 90;
const MERGE_YIELD_MARGIN_MPS = 2.5;
/**
 * How close the nose may come to something STILL in the chosen corridor before the
 * car stops rather than crawls. Half a bumper: near enough to read as "went up to
 * it", far enough that the contact the driver used to make never happens.
 */
const STILL_BLOCK_STANDOFF_M = 1.5;
/** Physics rays begin ahead of the chassis, so their range differs from road-frame s. */
const INDEXED_RAY_MATCH_M = 4;
/**
 * Cross-track feedback: the error is taken out over a fixed DISTANCE of road, not in
 * a fixed time, so the curvature it asks for is `2·e/L²` with `L = holdSeconds · v`.
 *
 * A speed-independent gain does not survive contact with the car. A 10 m correction
 * held a lane beautifully at 70 km/h and threw the rally car off the road on its
 * first straight at 77: the same command is 0.5 m/s² of lateral demand at 8 m/s and
 * 26 m/s² at 36 m/s, and the steering box cannot move that fast. Spreading it over a
 * fixed time of travel makes it a constant fraction of a g at every speed, which is
 * what a driver does — and the per-mode share of the cornering budget (`holdShare`)
 * is the difference between a car that holds its lane and one that merely lives in
 * it: measured, frantic diverges at 130 km/h with sleeper's numbers.
 */
const LANE_HOLD_MIN_DISTANCE_M = 11;
const LANE_HOLD_CURVATURE_MAX = 0.03;
const ROAD_PROFILE_SAMPLES = 10;
const TURN_COAST_CURVATURE = 0.004;
const TURN_COAST_STEER = 0.12;
const TURN_COAST_MIN_SPEED_MPS = 5;
/**
 * CEILING on how fast the commanded line may travel, as metres of lateral per metre
 * of road. It is no longer the profile — `lineAccel` in the corridor request is —
 * because a fixed slope asks for lateral acceleration proportional to v²: 0.09
 * spends 32 m of road on a lane change at any speed, which is a comfortable second
 * and a half at 30 km/h and a 2.7 m/s lateral flick at 108. Reported from play as an
 * overtake that nearly threw the car off the road, and visible in the steering trace
 * as a step: the old limiter held full lateral rate right up to the target line and
 * then stopped dead, so the yaw-damping term saw a discontinuity and doubled it.
 *
 * What it still does is keep the line from outrunning a car that is barely moving,
 * where the acceleration budget alone would swing it across the road in a couple of
 * metres of travel.
 */
const LINE_SHIFT_PER_METRE = 0.09;
/**
 * A MANOEUVRE IS A STATE, NOT A PER-TICK VERDICT.
 *
 * The corridor planner prices every quarter metre of road and returns the cheapest, and
 * it does that twenty times a second. On a nearly flat cost surface that is an argmin
 * with no memory: the price of standing a quarter of a metre off your lane is a quarter
 * of a cost unit, so any drift in the obstacle distances picks a different winner, and
 * the car reads as one that cannot hold a line. Measured on a real stretch of this road:
 * 33 commanded-line direction reversals per kilometre while merely FOLLOWING, one every
 * two seconds.
 *
 * Making the DECISION sticky by cost was tried twice and both times made it worse. A
 * flat margin on every switch traps a car that has drifted, because the lane is then
 * better by less than the margin and it can never come back. A margin charged only for
 * departing the lane is worse still: a free return plus an expensive departure is a
 * relaxation oscillator, and it produced MORE reversals (42.8/km) and a longer excursion
 * (14 m past the asphalt) than the thing it replaced.
 *
 * So the commitment is TEMPORAL and the manoeuvre is explicit. While holding the lane the
 * commanded line IS the lane centre — no search at all. The driver leaves the lane only
 * for something actually in it and close enough to act on, and having left it holds the
 * chosen line until that thing is behind it. One decision per obstacle, so there is no
 * surface left for a wobble to live on.
 */
/** How far off the lane the planner must want to be before leaving it counts as a move. */
const DETOUR_MIN_M = 0.8;
/**
 * FLOOR on how close a blocker in the driver's own lane must be before the lane is
 * left for it. The real trigger is the CLOSING distance the move itself needs at this
 * rate; see `manoeuvreRoom` in `commitLane`. A few car lengths, because that is the
 * only case the sum leaves unanswered — a driver barely closing at all, where the
 * arithmetic says a couple of metres and a driver would still have started moving.
 */
const DETOUR_TRIGGER_FLOOR_M = 14;
/**
 * How much FURTHER than that the blocker has to be for the manoeuvre to be over.
 *
 * IT IS A MARGIN ON TOP OF THE TRIGGER, AND THAT ORDER IS THE WHOLE POINT. The two
 * thresholds face the same direction, so a release nearer than the trigger is not
 * hysteresis but an anti-hysteresis band: a blocker sitting between them satisfies
 * "close enough to leave the lane for" and "far enough to call the manoeuvre over"
 * at the same time, and the latch flips on every single fixed step. Measured on the
 * overtake bench with 40 against 45: eighty indicator changes in one manoeuvre, the
 * commanded line buzzing between the lane and the crossing at 60 Hz for 1.2 s, all
 * of it while the car was still 45 m behind the car it meant to pass. A driver never
 * returns to a lane it would immediately want to leave again.
 */
const DETOUR_RELEASE_MARGIN_M = 10;
/**
 * Hard ceiling on one manoeuvre. A detour that has not resolved in this much road is
 * re-decided rather than trusted, which is what bounds the staleness of every other
 * commitment here: a lane that closes, an obstacle that turns out to be moving.
 */
const DETOUR_MAX_M = 150;
/** Line movement allowed on TIME rather than distance while barely rolling, m/s. */
const LINE_SLEW_AT_REST_MPS = 0.5;
/**
 * Lateral error, in metres, below which no indicator is shown. Lane keeping holds
 * the body to a few tenths of its line, so the deadband has to sit above that
 * wander and well below half a lane, or a straight road flashes a lamp.
 */
const INDICATOR_DEADBAND_M = 0.6;
/** And the smaller difference it stays on down to, once it is on. */
const INDICATOR_RELEASE_M = 0.25;
/**
 * And while clearing the oncoming lane in front of something coming at us. The gap
 * must be closing this much faster than the car is moving for that to be the reading.
 */
const LINE_SLEW_ESCAPE_MPS = 2;
const HEAD_ON_MARGIN_MPS = 4;
/**
 * VERGE the autopilot is allowed to put a wheel on, metres beyond the asphalt.
 *
 * The road lost its gravel shoulders when it was narrowed to its old side markings,
 * and taking the shoulder out of these two numbers with it was a mistake: the graded
 * desert immediately outside the asphalt is solid drivable ground, but the planner
 * treated the paint as a wall. A rock of 1.5 m radius near the centreline then had no
 * detour that fitted, so `mustStop` latched and the car sat in front of it — measured
 * by tools/autopilot-bench.ts, which went from a 17 m/s cruise to 1.1 m/s, and seen
 * in play as an autopilot that stopped dead on an empty road.
 *
 * 1.2 m is one wheel plus a little: enough to squeeze past a boulder, not enough to
 * count as leaving the road, and the terrain there is flush with the asphalt edge
 * (world/terrain.ts) so a pass costs nothing but grip.
 */
const PASSING_VERGE_M = 1.2;
/**
 * THE VERGE IS NOT A LANE, AND FOUR METRES OF IT IS THE DESERT.
 *
 * This used to allow the body centre almost three metres past the paint, on the
 * argument that an indexed trunk lying at the road edge needs that much to clear.
 * Measured on the real road with the real terrain collider under it — sand, as the
 * game builds it, rather than the bench's old asphalt ribbon — that licence is how a
 * quarter of all car-time went below walking pace: drivers put the whole car in the
 * sand to get round a stone, bogged, called it a road departure, reversed, and queued
 * the road behind them. Cars were found fifteen metres out in the desert.
 *
 * A bypass that does not fit beside the obstruction is not a bypass. The driver stops,
 * waits for the oncoming lane, and goes round on the road — which is what a person
 * does, and what the give-way gate in `planCorridor` now makes safe.
 */
const STATIC_AVOID_VERGE_M = 4;
/**
 * BYPASSING SOMETHING STOPPED IN THE LANE, on the driver's own side.
 *
 * A stopped car is not an indexed prop: the corridor probe reports a distance, not a
 * footprint, so there is no radius to build a line from. The line is therefore fixed
 * and taken from the ROAD — far enough right that the whole body sits outside the
 * asphalt, which clears anything standing on it whatever its width and however it is
 * angled. It stays inside the graded shoulder the indexed detour already uses, and
 * well short of the pole line at 6 m (see `POLE_LATERAL`, world/props.ts).
 */
/** A stopped blocker clears the asphalt by this body-and-hysteresis margin. */
/**
 * How long the bypass is held past the ray hit on the blocker's front face: the
 * longest catalogue body plus room for our own rear bumper, so the line is never
 * released while the car is still alongside it.
 */
const BLOCKER_BODY_M = 5;
/** Road the bypass line must be PROVEN clear over, beyond the blocker itself. */
const BLOCKER_BYPASS_CLEAR_M = 14;
/** The commanded line counts as reached within this, metres. */
const BLOCKER_BYPASS_TOLERANCE_M = 0.35;
/** Nose distance below which contact is imminent whatever the plan says. */
const BLOCKER_BYPASS_CONTACT_M = 2;
/** Enter only after a full departure; stay latched until the whole body is on asphalt. */
/** Off-road re-entry is measured from the asphalt edge where the car stands. */
const OFFROAD_LANE_TOLERANCE_M = 0.35;
const OFFROAD_HEADING_TOLERANCE_RAD = 0.14;
/** Loose sand has almost no lateral grip: turn at walking pace, not at 29 km/h. */
const OFFROAD_SPEED_MPS = 3.5;
const OFFROAD_BRAKE_MAX = 0.7;
/** Brake a developing road departure before loose-surface momentum makes it unrecoverable. */
const EDGE_STABILITY_LATERAL_M = 1.6;
const EDGE_STABILITY_LATERAL_SPEED_MPS = 0.4;
/** Road recovery needs the decisive pedal that already lets frantic escape loose sand. */
const OFFROAD_THROTTLE_BAND = 1.2;
/** Automatic lamps come on through dusk, with hysteresis so twilight cannot chatter. */
const AUTO_LIGHTS_ON_DAY_FACTOR = 0.22;
const AUTO_LIGHTS_OFF_DAY_FACTOR = 0.32;
/** Dip before the beams meet; restore high only once the opposing car is clearly past. */
const HIGH_BEAM_DIP_M = 250;
const HIGH_BEAM_RESTORE_M = 300;

/**
 * SEEING OTHER TRAFFIC, and why it is not the same query as seeing a rock.
 *
 * Road props are known in the road frame hundreds of metres out (`HazardIndex`), so
 * they need no rays at all. Other vehicles are dynamic bodies nobody indexes, and a
 * car at 130 km/h needs about 100 m of warning — five times the old 18 m corridor
 * scan, which existed to stop the car nosing into something and nothing more.
 *
 * A straight ray cannot follow a curving road that far, so a lane probe is cast
 * along the CHORD of the lane it is checking: from a point in that lane a few metres
 * ahead, to the same lane offset `sight` metres further on, a metre above the
 * centreline. On a straight that is the lane itself; in a bend it stays inside it as
 * long as the bend is gentle, which is exactly the condition a pass is gated on
 * anyway. It follows the gradient too, so a climb does not read as a wall.
 *
 * Only hits on DYNAMIC bodies count. Everything static — road, terrain, rocks,
 * poles — is either already known in the road frame or is not what this query is
 * for, and treating a static first hit as "no traffic seen" gives the probe a free
 * and honest line-of-sight limit: a car hidden behind a crest is not seen.
 */
const PROBE_HEIGHT_M = 0.9;
const PROBE_START_M = 4;
/** Centre plus two edge rays cover narrow cars and wider catalogue bodies. */
const PROBE_HALF_WIDTH_M = 0.8;
const PROBE_MIN_SIGHT_M = 26;
const PROBE_SIGHT_SECONDS = 3.2;
/**
 * Most a probe chord may deviate from the lane it is checking, metres, and the reach
 * it always keeps however tight the bend. Two metres is inside the road; the floor is
 * long enough to see the car in front of you in a hairpin.
 */
const PROBE_CHORD_DEVIATION_M = 2;
/** Ceiling on the walk, so a hairpin cannot ask for fifty rays. */
const PROBE_MAX_SEGMENTS = 5;
/** Heading error, radians, within which the car still counts as going down a lane. */
const PROBE_PARALLEL_RAD = 0.25;
/** Imminent-collision scan in the CAR's frame: valid even spun round or off-road. */
const BODY_SCAN_RANGE_M = 18;
const MUST_STOP_GAP_M = 4;

/**
 * INTENDED SPEED AT WHICH A DRIVER BELONGS IN AN INNER LANE, m/s.
 *
 * This is what sorts a four-lane road, and it sorts it ONCE: the home lane is a
 * property of the driver's own pace, so the arrangement maintains itself without
 * anybody weaving to keep it. 25 m/s is 90 km/h, which lands between the ambient
 * stream's ordinary driver (72-84 km/h) and its hurried one (95-115), and between the
 * player's sleeper (80) and his hurried (105) — so the split is by character, not by
 * a coin toss, and the same rule places the player's autopilot and the stream.
 *
 * Compared against the driver's own habit rather than its wide-road pace below, or
 * the boost would drag borderline drivers across the sort for a couple of km/h.
 */
const INNER_LANE_PACE_MPS = 25;
/**
 * WIDER ROAD, HIGHER PACE.
 *
 * Two lanes each way means no oncoming traffic on this driver's own side, a wider
 * lane, and the sight line that comes with both. Every driver reads that and goes a
 * little faster — the sleeper included — which is why the factor is here and not in
 * a mode. It multiplies the intended speed AFTER the driver's own cap, because that
 * cap is a cruising habit and not a limiter (the same argument as the kickdown).
 */
const WIDE_ROAD_PACE = 1.12;
/**
 * LATERAL ACCELERATION AN ORDINARY LANE CHANGE IS MADE WITH, m/s².
 *
 * `MANOEUVRE_LATERAL_SHARE` of the grip budget is what the car CAN do sideways, and
 * on dry asphalt that is 1.4-3 m/s² — a quarter of a g, which is a swerve. Only a
 * driver getting round something it would otherwise hit has a reason to use it.
 * Taking a lane at that rate is what a car does when it is trying to escape a rock,
 * and reported from play it looked exactly like that: cars entering a widening
 * cranked the wheel to claim a lane.
 *
 * 0.6 m/s² spends about 4.4 s and a hundred metres of road on a full lane, which is
 * a driver indicating, looking, and moving over. The same number goes to the planner
 * as `lineAccel`, so the road it charges a lane change is the road one really takes.
 */
const LANE_CHANGE_LATERAL_ACCEL = 0.6;
/** Seconds the wide-road bonus is worth, taken and given back. See its use in `drive`. */
const WIDE_PACE_RAMP_S = 5;
/**
 * HOW FAR THE COMMANDED LINE MAY LEAVE THE LANE CENTRE BEFORE IT IS A LANE CHANGE.
 *
 * Not a lane width: it is the width of ordinary line movement inside a lane — the
 * same figure the indicator's deadband uses, because a line movement that does not
 * light a lamp is not a manoeuvre. Beyond it, the driver needs to be entitled to the
 * move; see `lateralFreedom` in the corridor request.
 */
const LANE_KEEP_FREEDOM_M = 0.6;
/**
 * A LANE'S WORTH OF LATERAL, metres — the yardstick for "how hard must this be
 * steered", answered before the planner has proposed a line to measure.
 *
 * Not the road's lane width, which the controller reads from the road itself where it
 * matters: a fixed reference keeps the answer the same on every stretch instead of
 * moving with the asphalt. It has one consequence worth knowing: an obstruction is
 * first seen at the corridor horizon, three seconds of travel, so the acceleration the
 * move asks for on the step it is decided is `4 · 2.9 / 3²` = 1.29 m/s² at EVERY speed
 * — a firm but unremarkable eighth of a g, and the same manoeuvre for the sleeper and
 * for frantic.
 */
const LANE_SHIFT_REFERENCE_M = 2.9;
/**
 * Slowest closing speed a manoeuvre is timed at, m/s. Behind something going almost
 * exactly our own pace the deadline is arbitrarily far away, and a sum that divides by
 * the difference has to stay finite. The corridor planner floors its own overtake sums
 * at the same figure.
 */
const MIN_CLOSING_MPS = 0.5;
/**
 * FOLLOWING, in three numbers.
 *
 * The old code treated everything the corridor scan found as a wall and braked on
 * absolute distance, so a car 20 m ahead at 70 km/h asked sleeper for 4 m/s. Traffic
 * needs the RELATIVE picture: the observed body's velocity gives the lead's speed,
 * the standoff is what is left when both are stopped, and the relaxation time
 * is how quickly a gap error is taken out. Everything else follows from those.
 */
const FOLLOW_STANDOFF_M = 7;
/**
 * An adjacent lane is not scanned until it can change this tick's plan. Matching
 * the corridor's minimum worthwhile advantage preserves a free lane for a slower
 * leader without making every empty ambient car inspect both carriageways.
 */
const ADJACENT_LANE_PROBE_ADVANTAGE_MPS = 0.5;
/**
 * KEEPING RIGHT, AND READING THE TAPER BEFORE IT ARRIVES.
 *
 * A lane that ends is a lane the car has to be out of BEFORE it ends. A closing
 * taper is 260 m long and the commanded line moves 0.09 m per metre of road, so a
 * full lane costs about 32 m of travel: asking about the road this far ahead leaves
 * the ordinary line rate the room to do the merge under steering instead of
 * discovering the missing lane at the bumper.
 */
const HOME_LANE_LOOKAHEAD_M = 110;
const FOLLOW_RELAX_S = 2.2;
/** Below this the obstacle counts as parked. */
const PARKED_SPEED_MPS = 1.5;
/** For how long, before a decision may be taken on it. See `updateLead`. */
const PARKED_CONFIRM_S = 0.6;

/**
 * PASSING. Frantic traffic passes things materially slower than its intended pace.
 * Sleeper follows traffic; a stationary car does not turn an unsighted shoulder into
 * a lane. A pass still needs a straight road, a clear opposing lane and a safe return.
 */
// A lane change costs 2.9/LINE_SHIFT_PER_METRE ≈ 32 m of road. Committing 3.2 s
// ahead leaves another car length after the controller has reached the passing lane,
// rather than arriving alongside while it is still crossing the lead car's corner.
const PASS_TRIGGER_SECONDS = 3.2;
const PASS_TRIGGER_MIN_M = 24;
/** Room wanted beyond the obstacle itself before a line counts as clear. */
const PASS_CLEAR_M = 30;
const PASS_SIGHT_SECONDS = 2.5;
const PASS_MIN_SPEED_MPS = 4;
/**
 * Overtaking a moving car: the speed advantage it takes to be worth starting, the
 * longest pass that may be committed to, and the speed an unseen oncoming car is
 * assumed to be doing while it happens.
 */
const PASS_ADVANTAGE_MPS = 3;
const PASS_MAX_SECONDS = 15;
const PASS_ONCOMING_MPS = 20;
/**
 * Seconds of that closure the sight requirement is actually asked for. A pass longer
 * than this cannot be guaranteed by any probe on a road with crests, so beyond it the
 * abort — return to your own side the moment something appears — is what carries the
 * risk. Asking for the whole duration meant no overtake on this circuit ever
 * qualified: the mode's speed advantage over traffic is 10-20 km/h, which is 300 m
 * of clear road, and 300 m of PROVEN clear road does not exist here.
 */
const PASS_SIGHT_CAP_S = 6;
/** Below this speed advantage frantic stays put rather than sitting alongside. */
const PASS_SPEED_MARGIN_MPS = 4;
/**
 * KICKDOWN: the extra share of its own pace a driver spends while it is shopping for
 * a pass, before `passNerve` scales it.
 *
 * A crossing is priced on `(gap to the leader + clearance) / (own speed - leader's
 * speed)`, and ambient traffic's differential over the car it has caught is 10-20
 * km/h. That makes the manoeuvre 6-7 s long and the room it must prove some 300 m,
 * which this road does not have: the gate refused most windows outright, and the ones
 * it allowed closed while the car was still alongside, so the driver came back with
 * nothing. A real driver does not overtake at its cruising speed — it uses the
 * engine, and the cap ambient traffic is given is a cruising HABIT, not a limiter.
 *
 * Divided by `passNerve`, so frantic kicks down harder than hurried; a mode with no
 * appetite for passing moving traffic never reaches it at all.
 */
const PASS_KICKDOWN_SHARE = 0.25;
/**
 * Share of its comfort headway a driver keeps while closing on a car it means to
 * pass, and how many of those gaps away that car still counts as CAUGHT.
 *
 * The follower settles at `FOLLOW_STANDOFF_M + v·headwayS`, which is 39 m at 70 km/h,
 * and every one of those metres is charged to the manoeuvre twice: once as road to be
 * made up before the leader's bumper is even level, and once again through the
 * oncoming car that is covering its own road while it happens. Tucking in before
 * pulling out is what a driver does at the back of something slow, and it is the
 * cheapest metre in the whole sum. Only the comfort term is shortened — the braking
 * term beside it is untouched, so the stopping distance behind the leader remains.
 */
const PASS_APPROACH_HEADWAY_SHARE = 0.3;
const PASS_APPROACH_REACH = 2;
/**
 * Headway, in seconds of travel, a car must still have to its lead before a pass
 * may START.
 *
 * It used to be `PASS_ABORT_SECONDS` (1.6 s), which is longer than the gap the
 * follower controller settles at — 1.0-1.6 s for traffic, 1.2 s for frantic. So a
 * car that had actually caught something and tucked in behind it was, by
 * construction, always too CLOSE to be allowed to overtake, and the only passes
 * that ever fired were the transient frames while still closing in. Sitting in a
 * leader's mirrors is precisely when a driver wants the other lane.
 */
const PASS_FOLLOW_SECONDS = 0.6;
/** Road travelled after the old lane first looks clear, giving the rear bumper room. */
const PASS_REAR_CLEAR_M = 10;
/** Passing lane must also be clear behind before the lateral move begins. */
const PASS_ENTRY_REAR_GAP_M = 18;
/** The lane must be clear this far ahead before the pass is over. */
const PASS_RETURN_GAP_M = 24;
const PASS_MIN_METRES = 32;
/** A pass that has taken this much road is abandoned; something went wrong. */
const PASS_MAX_METRES = 260;
/** Traffic appearing this close in the lane being used aborts the pass. */
const PASS_ABORT_SECONDS = 1.6;
const PASS_ABORT_MIN_M = 14;
/**
 * An aborted pass must spend long enough back on its own line to observe a new gap.
 * Without this, a congested lane alternated pass/follow every fixed step as two
 * candidate lines took turns seeing the same cars.
 */
const PASS_RETRY_DELAY_S = 5;
/** No physical overtake may own a lane indefinitely after traffic has stopped. */
const PASS_MAX_HOLD_S = 20;

/**
 * BEING STUCK, and getting out of it.
 *
 * A car asking for motion without making ground is wedged against scenery or blocked
 * in an opposing queue. Recovery backs up, turns toward the road's right shoulder,
 * pulls out, and retries the same radius-based line. There is deliberately no attempt
 * limit: an autonomous car may wait for room behind, but it never abandons the task.
 */
/** Recovery is forbidden while any physical traffic occupies this local envelope. */
/**
 * How long a driver waits at an obstruction for the oncoming lane before the wait is
 * treated as a standoff instead. Long enough for any ordinary stream of traffic to
 * pass; short enough that two queues facing each other across the same wreck reach the
 * recovery that breaks them.
 */
const YIELD_PATIENCE_S = 30;
/**
 * Road covered after a crossing has been abandoned before another may be started.
 * Long enough that the car that caused the abandonment is genuinely past, short enough
 * that a driver held up by one oncoming car does not then wait out the whole queue.
 */
const CROSSING_RETRY_METRES = 60;
/** Recovery is forbidden while any physical traffic occupies this local envelope. */
const DYNAMIC_BLOCKER_NEARBY_M = 12;
/** Move this far after losing a dynamic lead before a stop can be called unexplained. */
const DYNAMIC_BLOCKER_CLEAR_M = 5;
/**
 * The band, ahead of and behind the car's own centre, in which another body counts
 * as ALONGSIDE rather than as something to follow.
 *
 * It has to cover the forward probes' blind spot — they start `PROBE_START_M` past
 * the bumper — plus a body length either way, because two cars whose centres are
 * eight metres apart still overlap for the length of a lane change.
 */
const ABEAM_AHEAD_M = 9;
const ABEAM_BEHIND_M = 9;
const STUCK_SPEED_MPS = 1 / 3.6;
/**
 * Speed below which a car nosed up to something parked counts as going nowhere, the
 * metres of road that still count as getting somewhere at that pace, and how fast
 * the stall timer unwinds once it is moving properly. 1.5 m/s is walking pace: above
 * it the car is picking its way past something, below it it is shuffling.
 */
const CRAWL_SPEED_MPS = 1.5;
const STALL_PROGRESS_M = 1.2;
const STALL_DECAY = 2;
/** Backward speed, m/s, past which the car is rolling away rather than crawling. */
const ROLLBACK_MPS = 0.6;
/** Throttle that always breaks stiction when a small speed really is wanted. */
const THROTTLE_FLOOR = 0.2;
/** Below this target the car is waiting, and waiting is held on this much brake. */
const HOLD_TARGET_MPS = 1;
const HOLD_BRAKE = 0.6;
/**
 * MOST OF THE PEDAL THAT BRAKING FOR SOMETHING IN THE WAY MAY USE.
 *
 * The mode's own `brakeCeiling` is a personality — sleeper 0.55, hurried 0.8, frantic
 * 1.0 — and it was also being spent on obstacles, so a hurried driver answered a rock in
 * its lane by standing on the brake. On a sealed surface that is survivable; on the
 * loose half of this road it is not, because a locked-front deceleration is exactly what
 * gives up the steering. Frantic was already measured doing it: it arrived at a bend
 * too fast, stood on the brake inside it, lost the front on the loose surface and ran
 * 1.2 m past the asphalt before recovering (see `LATERAL_GRIP_RESERVE`).
 *
 * A HALF IS NOT A HALF OF THE DECELERATION, and that is why it still stops. The planner
 * brakes on `brakeAccel` — 4.0 m/s² for a sleeper — which is already well under what the
 * tyres can give on asphalt, so the margin the plan leaves is the pedals it is not
 * using. Half pedal puts roughly 4-4.5 m/s² on the road, which is the figure the plan
 * was built on; the car still stops where it planned to, it simply stops there having
 * pressed half as hard for twice as long.
 *
 * What it deliberately does NOT cap: the road-departure and edge-stability brakes below,
 * which exist to prevent exactly the "flew off the road" outcome and are raised with
 * `Math.max` after this. Nor the `HOLD_BRAKE` that keeps a waiting car from rolling back
 * down a grade, which is a standstill, not a manoeuvre.
 */
const OBSTACLE_BRAKE_MAX = 0.5;
/** Speed difference, m/s, below which two limits are the same limit. */
const BRAKE_LIMIT_EPSILON = 0.01;
/** Generic stalls need enough evidence not to mistake a slow launch for a wedge. */
const STUCK_AFTER_S = 3;
/** A bumper already against a known road prop needs no such long confirmation. */
const CONTACT_STUCK_AFTER_S = 1;
/**
 * TIME TO CONTACT AT WHICH THE PEDAL STOPS BEING A DECISION AND BECOMES A REFLEX, and
 * the closing speed below which there is nothing to react to.
 *
 * 1.4 s is inside the range emergency-braking systems are assessed over and well
 * outside anything ordinary following produces: the follow law keeps a 1.2-2.2 s
 * headway to the car in front and closes it gently, so this only fires when the gap is
 * shrinking faster than the plan believed it could.
 */
const EMERGENCY_TTC_S = 1.4;
const EMERGENCY_CLOSING_MPS = 2.5;
const CONTACT_STUCK_GAP_M = 0.75;
/**
 * Moving traffic may cross a wedged car's probes without being the obstruction.
 * Normal following requests zero speed and does not accumulate this timer.
 */
const MOVING_BLOCKER_GRACE_S = 25;
/**
 * HOW FAR BACK A LANE IS CHECKED BEFORE IT IS ENTERED, and the deceleration a driver
 * may impose on whoever is already in it.
 *
 * Fifty metres is the distance a car fifty km/h faster covers in the four seconds a
 * lane change takes. 3 m/s² is a firm but ordinary brake application — about a third
 * of what dry asphalt offers — so the rule refuses to make a stranger stand on the
 * pedal, not to make him lift.
 */
const LANE_ENTRY_REAR_LOOK_M = 50;
const LANE_ENTRY_SAFE_DECEL = 3;
const RECOVERY_REVERSE_S = 1.8;
const RECOVERY_PULLOUT_S = 1.6;
/** Opposite substantial locks make the two-point turn decisive without tyre scrub at full lock. */
const RECOVERY_REVERSE_STEER = 0.85;
const RECOVERY_PULLOUT_STEER = 0.85;
const RECOVERY_REVERSE_BRAKE = 0.72;
/** Room a yielding car keeps behind itself, and how fast it gives ground back. */
const YIELD_REVERSE_ROOM_M = 6;
const YIELD_REVERSE_MPS = 1.6;
const RECOVERY_CRAWL_MPS = 4.5;
const RECOVERY_BIAS_METRES = 50;
const RECOVERY_REAR_CLEAR_M = 5;
/** Generic recovery remains bounded; indexed traffic roadblocks bypass this guard. */
const RECOVERY_RETRY_METRES = 45;
const RECOVERY_ATTEMPT_LIMIT = 2;
/**
 * How long a generic stall in the same place waits before it may try to escape again.
 *
 * Ten seconds was measured and rejected. It does help the car that is stuck — on seed
 * 7 the ego's longest stop fell from 50.7 s to 13.8 s and its pace rose 27 -> 34 km/h
 * — but an escape manoeuvre puts a car across the carriageway, and repeating it every
 * ten seconds blocks everything behind it: stream contacts went 8 -> 15, ego contacts
 * 3 -> 7, and the longest stop in the stream went 15.9 s -> 60.4 s. A driver with
 * nothing left to try is better left waiting than left swinging across the road.
 */
const RECOVERY_REARM_S = 30;
/**
 * How far off its lane the car holds after a pull-out. This clears a 1.2 m road
 * prop by the widest car body plus avoidance hysteresis; the old 2.2 m bias still
 * overlapped that corridor and drove the first attempt back into the obstruction.
 */
const RECOVERY_BIAS_M = 3.2;
/**
 * A MANOEUVRE THAT DID NOT WORK IS NOT WORTH REPEATING UNCHANGED.
 *
 * Reported from play: a car that meets an obstacle reverses its 1.8 s, holds its 0.85
 * lock, pulls forward into the very same thing, and then does it again — identically
 * — a second and a third time, and stands there for a long time doing it. The escape
 * had ONE fixed shape, so every repeat retraced the attempt that had just failed; the
 * only state that grew across attempts was `recoveryAttempts`, and all that decides
 * is WHEN TO STOP TRYING, never HOW TO TRY DIFFERENTLY.
 *
 * Attempts at the same place now each go one rung further out: longer reverse, more
 * lock, and an escape line further from the lane — the three things a driver actually
 * changes when the first go does not clear it. Three rungs take the manoeuvre from
 * "back up a length and ease round" to "back most of two lengths at full lock and
 * come back along the shoulder".
 *
 * The ladder is bounded because past that the manoeuvre stops being a two-point turn
 * on a road: a bigger swing only puts more of the carriageway under a car that is
 * already lying across it, which is the failure `RECOVERY_REARM_S` was written for.
 */
const RECOVERY_ESCALATION_MAX = 3;
/** Seconds of reverse, and of pull-out, added per rung. */
const RECOVERY_REVERSE_STEP_S = 1.2;
const RECOVERY_PULLOUT_STEP_S = 0.6;
/** Lock added per rung; the last rung is full lock. */
const RECOVERY_STEER_STEP = 0.05;
/**
 * Escape line added per rung, and the same allowance for every line limit the
 * manoeuvre is measured against. An ordinary escape is clamped to the asphalt — which
 * is also the width the blocked corridor occupies, so an escape held inside it is an
 * escape aimed back at the obstruction. A rung buys the shoulder, a metre at a time.
 */
const RECOVERY_BIAS_STEP_M = 0.9;
/**
 * Room the reverse keeps behind the tail, and how far back it looks for it.
 *
 * The one-off check in `beginRecovery` asks once, before the leg starts, and a 1.8 s
 * reverse was short enough for that to be the whole story. Five seconds is not: the
 * queue behind closes up while the car is using the space. Measured from the axis
 * ray's own origin, which sits 1.5 m inside the tail, so this is about a metre of
 * bumper clearance.
 */
const RECOVERY_REVERSE_STOP_M = 2.5;
const RECOVERY_REVERSE_LOOK_M = 9;
/**
 * When a reverse leg is going nowhere: scenery no ray reports — a fence, a bank, a
 * pole — is found by the car's own evidence, which is that it has selected reverse
 * and is not moving. The grace covers the shift to R and the roll still to be killed;
 * without it a leg that starts from a standstill reads as stalled on its first tick.
 */
const RECOVERY_LEG_GRACE_S = 1;
const RECOVERY_LEG_CRAWL_MPS = 0.3;
const RECOVERY_LEG_STALL_S = 0.8;


export class Autopilot {
  private modeValue: AutopilotMode = 'sleeper';
  private engagedValue = false;
  private hintS = 0;
  /**
   * Whether `hintS` describes where the car actually is.
   *
   * `Road.project` searches LOCALLY around its hint and moves at most one window per
   * call, so a controller that starts with a hint of zero on a car parked 2 km along
   * the road spends the first tenth of a second being told it is hundreds of metres
   * off the centreline. It reacts to that: off-road recovery engages and steers for
   * an edge that is not there. Never seen in the game, where the car starts at the
   * house at s≈0 — and immediately fatal to the playground's traffic, which is
   * spawned all round the lap. The first projection after engaging is therefore
   * hintless, which is a coarse-table scan and happens once.
   */
  private hintValid = false;
  /**
   * Monotonic distance driven, metres. Every latched state measures road with this
   * rather than with `s`: the test circuit's arclength wraps every 2.7 km, and a
   * plan that retires on `s` retires at the start line.
   */
  private travelled = 0;
  private stoppedFor = 0;
  /**
   * Where the car was when the current stall began, absolute metres. Ground covered
   * from here is what decides whether it is stuck; see the block in `drive`.
   */
  private stallAnchorX = 0;
  private stallAnchorZ = 0;
  /** Seconds since the last recovery attempt, which is what re-arms a given-up one. */
  private sinceRecovery = 0;
  /**
   * Latched after a full departure. Merely crossing the verge again is not enough:
   * acceleration stays inhibited until the chassis is centred on its recovery line
   * and parallel to the road.
   */
  private roadRecoveryActive = false;
  private roadRecoveryTargetLine = 0;
  private roadRecoveryFollowingEscape = false;
  private activityValue: AutopilotActivity = 'cruise';
  private hazardDistance = Infinity;
  /** The same, counting only props the body would actually touch. See `visitHazard`. */
  private hazardContactDistance = Infinity;
  /** Nearest dynamic body in the driving corridor, metres, from either scan. */
  private obstacleGapValue = Infinity;
  /** Signed along-road speed of the same observed body. */
  private obstacleSpeedValue = 0;
  /** Rate the gap is shrinking, m/s. Larger than our own speed means it is coming AT us. */
  private leadClosingValue = 0;
  /** Seconds the observed body has stayed below `PARKED_SPEED_MPS`. */
  private leadParkedFor = 0;
  /**
   * A dynamic blocker remains known while this car is stationary, even when a bend
   * makes the corridor ray lose it. Moving away proves the old observation obsolete.
   */
  private dynamicBlockerKnown = false;
  private dynamicBlockerAnchorX = 0;
  private dynamicBlockerAnchorZ = 0;
  /** Obstacles handed to the planner each step; a field so the hot path allocates none. */
  private readonly corridorObstacles: CorridorObstacle[] = [];
  /** How far the current obstacle collection reached. */
  private collectHorizon = 0;
  /** Last plan: is there a way through, what is in it, and where it puts the car. */
  private corridorFeasible = true;
  private corridorBlockDistance = Infinity;
  private corridorBlockSpeed = 0;
  private corridorSqueezeDistance = Infinity;
  private corridorLaneBlockDistance = Infinity;
  private corridorLaneBlockSpeed = 0;
  /** Road width at this tick's projection, shared with hazard callbacks. */
  private asphaltHalfWidth = 0;
  /** Scratch lane centres: avoids rebuilding the planner's candidate list per tick. */
  private readonly laneCentres: number[] = [];
  private planUsesOncomingLane = false;
  private planUsesShoulder = false;
  /** Asked by the traffic coordinator to give the car in front room to reverse. */
  private yieldReverse = false;
  private bodyScanGap = Infinity;
  /** Along-road speed of the nearest hit from the most recent lane probe. */
  private probeHitSpeed = 0;
  /** Line actually commanded, rate-limited toward the line the driver wants. */
  private appliedLateral = 0;
  /**
   * Lateral speed the commanded line is currently moving at, m/s, signed. The line
   * is accelerated rather than stepped, so this is state and not a derived number;
   * see the profile in `drive`.
   */
  private lineSlewRate = 0;
  /**
   * The line the planner CHOSE last step, which is what its switching hysteresis
   * has to be measured against. Measuring it against `appliedLateral` — the
   * rate-limited line the car is still slewing along — charged the switch cost to
   * both candidates at once for the whole transition, so mid-manoeuvre the planner
   * had no commitment at all and any cost wobble flipped it.
   */
  private planLine = 0;
  /** The manoeuvre in progress: are we out of our lane, on which line, and until when. */
  private detouring = false;
  private detourLine = 0;
  private detourUntilS = 0;
  private recoveryPhase: 'none' | 'reverse' | 'pullout' = 'none';
  private recoveryTimer = 0;
  /** A deterministic right-of-way escape through an opposing-traffic deadlock. */
  private recoveryCommitted = false;
  /**
   * Ambient traffic treats only indexed scenery and opposing-gridlock as recoverable.
   * This avoids mistaking a weak climb or rough patch for an object worth reversing
   * around; the player's autopilot can still recover from unindexed collision shapes.
   */
  private trafficRecoveryPolicy = false;
  /** Seconds of asking for speed and covering no ground, whatever is in front. */
  /** Seconds this driver has been held at an obstruction by traffic coming the other way. */
  private yieldingFor = 0;
  /** Road, in metres travelled, before an abandoned crossing may be re-attempted. */
  private crossingBarredUntil = 0;
  /** Last step's crown-crossing inputs, kept for dev telemetry and the road benches. */
  private lastOncomingGap = Infinity;
  private lastRearClear = false;
  private lastMayCross = false;
  private yielding = false;
  private groundlessFor = 0;
  /** Granted by the traffic coordinator to exactly one head of an opposing queue. */
  private deadlockPermission = false;
  /** Dense ambient streams disable new overtakes; an active pass is still completed. */
  private passingEnabled = true;
  /** Signed lateral direction the recovery is escaping toward; the driver's right. */
  private recoverySide = -1;
  /** Whether the manoeuvre in progress started off the asphalt. */
  private recoveryOffRoad = false;
  private recoveryBias = 0;
  private recoveryBiasUntil = 0;
  /**
   * Rungs of escalation the manoeuvre in progress is using: 0 for a first attempt at
   * a place, one more for each attempt that follows a failed one. Getting away resets
   * it — an escape begun somewhere new starts at the bottom of the ladder.
   *
   * Deliberately NOT `recoveryAttempts`: that is a give-up budget, and it is reset to
   * zero for every blockage worth retrying without limit (a rock the bumper touches,
   * a wedge off the asphalt, a granted deadlock) — which is exactly the case that was
   * repeating one failed manoeuvre for ever.
   */
  private recoveryEscalation = 0;
  /** Seconds the current reverse leg has run, and how long it has been going nowhere. */
  private recoveryLegElapsed = 0;
  private recoveryLegStalled = 0;
  private lastRecoveryAt = -Infinity;
  private recoveryAttempts = 0;
  private speedCapValue = Infinity;
  /** Share of the mode's pace this driver uses; see `setPace`. */
  private paceValue = 1;
  /** Ambient traffic may use a per-driver following distance. */
  private followingHeadwayValue: number | null = null;
  private daylightFactor = 1;
  private oncomingGap = Infinity;
  private pedestrianActive = false;
  private pedestrianX = 0;
  private pedestrianZ = 0;
  private pedestrianVx = 0;
  private pedestrianVz = 0;
  /**
   * The coordinator's road-frame view of the other traffic, or null for a driver
   * nobody coordinates (a bench, or the player's own car before it is wired). Every
   * rule that reads it falls back to permitting the manoeuvre, so an uncoordinated
   * driver behaves exactly as it did before the field existed.
   */
  private trafficField: TrafficField | null = null;
  /**
   * Did last step's plan want the OPPOSING lane — either refused it or was already
   * out in it? A driver waiting for a window closes up on the car it means to pass;
   * one that is merely following does not. See `followHeadwayS`.
   */
  private passShopping = false;
  /**
   * DEV TELEMETRY ONLY, and nothing in the controller reads any of it back.
   *
   * A human verifying a change needs to tell "it braked for the corridor" from "it
   * braked for the manoeuvre" from "it is holding a headway": those are three
   * different decisions that all arrive as one speedometer reading.
   */
  private homeLaneValue = 0;
  /**
   * The wide-road pace bonus this driver is currently spending, 1 to `WIDE_ROAD_PACE`.
   * State rather than a lookup, because it is slewed: see `drive`.
   */
  private widePaceValue = 1;
  private manoeuvreSpeedValue = Infinity;
  private targetSpeedValue = 0;
  private passUrgeValue = false;
  private passAttemptValue = false;
  private automaticLightsOn = false;
  /** Ambient traffic keeps dipped beams lit in daylight as a visibility aid. */
  private lowBeamsAlwaysOn = false;
  /**
   * Whether this driver still owns the light switch. Traffic always does; the
   * player's autopilot gives it up the moment the driver presses the switch itself,
   * because otherwise the automation rewrote the choice on the very next fixed step
   * and the key looked broken.
   */
  private automaticLightsOwned = true;
  private playerHighBeamSuppressed = false;
  private playerHeadlightVehicle: Vehicle | null = null;
  private controlledVehicle: Vehicle | null = null;
  private readonly dynamicProximityShape: RAPIER.Ball | null;
  private readonly identityRotation = { x: 0, y: 0, z: 0, w: 1 };
  private readonly position = { x: 0, y: 0, z: 0 };
  private readonly rayOrigin = { x: 0, y: 0, z: 0 };
  private readonly rayDirection = { x: 0, y: 0, z: 0 };
  private readonly probeNear = { x: 0, y: 0, z: 0 };
  private readonly probeFar = { x: 0, y: 0, z: 0 };
  private readonly condition: RoadConditionBuffer = {
    surface: SurfaceType.Asphalt,
    decay: 0,
    sandCover: 0,
    markings: 1,
  };
  /** Car lateral at the time of the scan; a hazard off to one side is not a hazard. */
  private scanLateral = 0;
  private readonly visitHazard = (hazard: RoadHazard): void => {
    // BUMPER TO NEAR EDGE, like the planner's own obstacles (`collectHazard`).
    //
    // Centre to centre is a body length and a radius short of the truth, and the
    // recovery's "something in front, stop" gate compares this against a fixed four
    // metres — so a car pulling out at a 1.2 m rock stopped measuring 4 m when its
    // bumper was already touching it. Measured in the bench: a 2.9 m/s nose-on
    // contact with an indexed prop it was trying to get round.
    const distance = hazard.s - hazard.radius - CAR_HALF_LENGTH_M - this.hintS;
    if (distance >= this.hazardDistance) return;
    // A PROP THAT DOES NOT REACH THE ASPHALT IS SCENERY.
    //
    // The path tests below ask whether the prop is near this car's LINE, and a line
    // that has already been pushed out to the shoulder for one prop is near every
    // other prop standing out there. Measured in a live drive: cars left the road,
    // in both directions, with nothing on the road at all — the nearest thing being
    // roadside scatter and power-line pylons metres past the paint. A detour is for
    // something in the way, and only what overlaps the asphalt is in the way.
    if (Math.abs(hazard.lateral) - hazard.radius >= this.asphaltHalfWidth) return;
    // The autopilot never treats a breakable prop as permission to hit it: every
    // indexed road hazard is an immovable obstacle for planning and recovery.
    const reach = hazard.radius + CAR_HALF_WIDTH_M + AVOID_HYSTERESIS_M;
    if (Math.abs(hazard.lateral - this.scanLateral) >= reach) return;
    this.hazardDistance = distance;
    // AND "MY BUMPER IS AGAINST IT" IS A DIFFERENT QUESTION TO "IT IS NEAR MY LINE".
    //
    // The reach above carries the avoidance margin, which is planning slack, not
    // sheet metal. A car easing round a prop on exactly the line that clears it is
    // inside that reach for the whole pass, a few centimetres from touching and a
    // bumper's length short of the thing — and the short contact confirmation read
    // that as a wedge. Measured on the wedged-on-road bench: a car squeezing past at
    // 1.0 m/s, with 6 cm of clearance and every centimetre of it earned, was sent
    // into a second reversing manoeuvre one second later. Contact is the bodies
    // actually overlapping, so the margin comes off.
    if (
      Math.abs(hazard.lateral - this.scanLateral) < hazard.radius + CAR_HALF_WIDTH_M
      && distance < this.hazardContactDistance
    ) {
      this.hazardContactDistance = distance;
    }
  };
  /**
   * Every prop within the planning horizon, whatever line it sits on, inflated by
   * the avoidance margin and offered to the planner as an immovable obstacle. Props
   * that do not reach the asphalt are scenery, and are not offered at all.
   */
  private readonly collectHazard = (hazard: RoadHazard): void => {
    if (Math.abs(hazard.lateral) - hazard.radius >= this.asphaltHalfWidth) return;
    // Distance to the NEAR EDGE, from the bumper: a six-metre boulder whose centre
    // is 21 m away is 15 m of road away, and braking to its centre is braking six
    // metres too late. The planner's swept test wants the same edge.
    const s = hazard.s - hazard.radius - CAR_HALF_LENGTH_M - this.hintS;
    if (s < -hazard.radius * 2 - CAR_HALF_LENGTH_M || s > this.collectHorizon) return;
    this.corridorObstacles.push({
      s: Math.max(0, s),
      lateral: hazard.lateral,
      halfWidth: hazard.radius + AVOID_HYSTERESIS_M,
      speed: 0,
    });
  };
  /**
   * THE LANE A CROSSING BORROWS HAS TO BE CLEAR FOR THE WHOLE MANOEUVRE, NOT FOR THE
   * PLANNING HORIZON.
   *
   * The corridor is priced over three seconds of travel and the obstacle scan reaches
   * a braking distance; a crossing occupies the opposing lane for as long as it takes
   * to get past whatever is in the driver's own — up to `PASS_MAX_METRES`. So the
   * decision was being taken on a fraction of the road it commits to. Measured on the
   * real road at seed 1337, from the trace of an ego contact: the driver went out at
   * 74 km/h with "gap29 blk-", learned 28 m later that the lane it had borrowed holds
   * a prop ("blk57 NOWAY"), braked from 74 to 4 km/h and hit it anyway — then sat
   * there for 44.9 s.
   *
   * Hazards live in the road frame and the index is bisected, so asking about two
   * hundred metres of the opposing line costs what it visits and nothing for the rest.
   */
  private crossingLineLateral = 0;
  private crossingLineBlocked = false;
  private readonly visitCrossingHazard = (hazard: RoadHazard): void => {
    if (Math.abs(hazard.lateral) - hazard.radius >= this.asphaltHalfWidth) return;
    if (
      Math.abs(hazard.lateral - this.crossingLineLateral) <
      hazard.radius + CAR_HALF_WIDTH_M + AVOID_HYSTERESIS_M
    ) {
      this.crossingLineBlocked = true;
    }
  };
  /**
   * Is the opposing line clear of indexed props over a stretch of road that starts
   * `from` metres ahead and runs for `distance`?
   *
   * `from` IS NOT AN OPTIMISATION, IT IS THE RULE. A boulder wide enough to close the
   * driver's own lane is usually wide enough to reach the opposing line as well —
   * that is why the crossing is wanted — so a scan that starts at the bumper is
   * vetoed by the very obstruction it exists to get round. Measured: the whole road
   * locked, 115 s longest stop, 28.7% of car-time crawling and the ego down to
   * 15 km/h. What matters is whether the borrowed lane is clear BEYOND the thing.
   */
  private crossingLineClear(lateral: number, from: number, distance: number): boolean {
    this.crossingLineLateral = lateral;
    this.crossingLineBlocked = false;
    this.hazards.forEachAhead(this.hintS + from, distance, this.visitCrossingHazard);
    return !this.crossingLineBlocked;
  }
  /**
   * WOULD ENTERING THIS LANE FORCE SOMEBODY BEHIND TO BRAKE HARDER THAN A DRIVER MAY
   * ASK OF A STRANGER?
   *
   * The lane-change literature settled this a long time ago and calls it the safety
   * criterion: a change is refused when the new follower's required deceleration
   * exceeds a fixed bound, whatever the change would gain. Nothing here is a cost or
   * a preference — the planner still prices every line it is offered — this only
   * withholds a line the driver has no right to take.
   *
   * The required deceleration is the honest kinematic one: the follower has to lose
   * its closing speed over the gap that will be left between the two bodies, which is
   * `closing^2 / 2·gap`. A follower that is slower than us, or level with us, asks for
   * nothing.
   */
  private laneEntryOwnLateral = 0;
  private laneEntryOwnSpeed = 0;
  /** Unsafe rear bands, collected once; the visitor's borrowed buffer is not retained. */
  private readonly rearUnsafeBands: number[] = [];
  private readonly visitRearNeighbour = (neighbour: TrafficNeighbour): void => {
    if (neighbour.s > 0) return;
    const closing = neighbour.speed - this.laneEntryOwnSpeed;
    if (closing <= 0) return;
    const gap = Math.max(-neighbour.s - CAR_HALF_LENGTH_M, 0.5);
    if ((closing * closing) / (2 * gap) > LANE_ENTRY_SAFE_DECEL) {
      this.rearUnsafeBands.push(neighbour.lateral, neighbour.halfWidth + CAR_HALF_WIDTH_M);
    }
  };
  private readonly lineEntryAllowed = (line: number): boolean => {
    const from = this.laneEntryOwnLateral;
    for (let i = 0; i < this.rearUnsafeBands.length; i += 2) {
      const centre = this.rearUnsafeBands[i]!;
      const reach = this.rearUnsafeBands[i + 1]!;
      const gapNow = Math.abs(centre - from);
      const gapThere = Math.abs(centre - line);
      const through = (centre - from) * (centre - line) < 0;
      const closest = through ? 0 : Math.min(gapNow, gapThere);
      // Holding or moving out of an occupied band cannot create a new cut-in.
      if (closest <= reach && (gapNow > reach || closest < gapNow)) return false;
    }
    return true;
  };
  private oncomingScanLine = 0;
  private oncomingFieldGap = Infinity;
  private oncomingFieldSpeed = 0;
  /**
   * Nearest body ahead or longitudinally overlapping whose lateral overlaps the opposing
   * line, with its speed along this driver's direction. Anything travelling with us is not oncoming
   * traffic — it is the queue we are trying to overtake — and is priced elsewhere.
   */
  private readonly visitOncoming = (neighbour: TrafficNeighbour): void => {
    if (neighbour.s < 0 || neighbour.s >= this.oncomingFieldGap) return;
    if (Math.abs(neighbour.lateral - this.oncomingScanLine) > neighbour.halfWidth + CAR_HALF_WIDTH_M) {
      return;
    }
    if (neighbour.speed > CRAWL_SPEED_MPS) return;
    this.oncomingFieldGap = neighbour.s;
    this.oncomingFieldSpeed = neighbour.speed;
  };
  /** Supplies the coordinator's road-frame view of the other traffic; see `TrafficField`. */
  setTrafficField(field: TrafficField | null): void {
    this.trafficField = field;
  }
  /** Clears the nearest-hazard result before a scan. See the note in `drive`. */
  private beginHazardScan(lateral: number): void {
    this.hazardDistance = Infinity;
    this.hazardContactDistance = Infinity;
    this.scanLateral = lateral;
  }


  constructor(
    private road: DriveRoad,
    private hazards: HazardField,
    /** Optional only until Vehicle exposes its PhysicsWorld; main passes the shared world. */
    private readonly physics?: PhysicsWorld,
  ) {
    this.dynamicProximityShape = physics
      ? new physics.rapier.Ball(DYNAMIC_BLOCKER_NEARBY_M)
      : null;
  }

  get mode(): AutopilotMode { return this.modeValue; }
  setMode(mode: AutopilotMode): void { this.modeValue = mode; }
  /**
   * Ceiling below the mode's own cruise, m/s, or Infinity for none.
   *
   * The traffic on the test circuit uses it. Without it there is no speed
   * differential to overtake into: this lap's gradients hold every car to much the
   * same speed whatever its mode asks for, so the fast mode spent a whole lap
   * queueing politely behind cars it was theoretically 60 km/h quicker than.
   */
  setSpeedCap(mps: number): void { this.speedCapValue = mps; }
  /**
   * HOW MUCH OF THE AVAILABLE ROAD THIS DRIVER USES, as a fraction of its mode's pace.
   *
   * An absolute ceiling in km/h is not a character: on any road where the surface is
   * what limits the pace, a ceiling set above that limit does nothing at all. Measured
   * on the real road: cracked asphalt at 0.84 and a 0.85 condition factor hold the
   * careful mode to 57 km/h, and the stream's three characters were capped at 58-70,
   * 72-84 and 95-115 — so not one of the three caps ever bound, every careful driver
   * drove at exactly the same 57, and the whole stream's speed spread was 10 km/h.
   *
   * A fraction binds on every road, because it scales whatever the road allows.
   */
  setPace(fraction: number): void {
    this.paceValue = clamp(fraction, 0.4, 1);
  }
  setFollowingHeadway(seconds: number): void {
    this.followingHeadwayValue = clamp(seconds, 0.9, 3.4);
  }
  setTrafficRecoveryPolicy(enabled: boolean): void {
    this.trafficRecoveryPolicy = enabled;
  }
  setDeadlockPermission(enabled: boolean): void {
    this.deadlockPermission = enabled;
  }
  /**
   * MAKING ROOM FOR THE CAR IN FRONT TO BACK UP.
   *
   * A car that has to reverse out of something — a rock across its lane, a wedge —
   * cannot, because the queue behind it is against its bumper. Seen in play: the
   * head of a queue at a rock shuffling backwards into the car behind it while the
   * whole line, the player included, waited for good.
   *
   * So the coordinator tells the cars behind to give the room back, and they pass
   * the request down the line. Each one only ever reverses while its OWN rear is
   * clear, so the chain unwinds from the back and nobody is pushed.
   */
  setYieldReverse(enabled: boolean): void {
    this.yieldReverse = enabled;
  }
  /** True while this driver is backing out of something and needs the room behind. */
  get needsReverseRoom(): boolean {
    return this.recoveryPhase === 'reverse' || this.yieldReverse;
  }
  setPassingEnabled(enabled: boolean): void {
    this.passingEnabled = enabled;
  }
  setLowBeamsAlwaysOn(enabled: boolean): void {
    this.lowBeamsAlwaysOn = enabled;
  }
  /**
   * The lateral manoeuvre, as a state with an entry and an exit.
   *
   * Holding the lane returns the lane centre itself rather than whatever the cost search
   * preferred this tick, which is the whole point: with nothing in the lane there is no
   * decision to make and therefore nothing to oscillate. Leaving the lane takes a blocker
   * in it, close enough to act on, and a line the planner genuinely wants; from then on
   * the chosen line is held while that blocker is still ahead, and the lane is taken back
   * once it is behind.
   *
   * `laneBlockDistance` is the nearest thing in the driver's OWN lane, which is exactly
   * the thing a detour or an overtake exists to get past — so it is also the right thing
   * to end the manoeuvre on. A driver that gets back as soon as its lane is clear may
   * well meet the next obstacle and move out again, and that is a road with props on it
   * rather than a fault: the manoeuvre cap bounds how long it can be strung along.
   */
  private commitLane(
    proposed: number,
    ownLateral: number,
    laneOffset: number,
    hintS: number,
    laneBlockDistance: number,
    laneBlockSpeed: number,
    desiredSpeed: number,
    speed: number,
    /** Lateral acceleration the commanded line will really be moved with. */
    lineAccel: number,
    crossingRefused: boolean,
    /** Outermost line the road allows HERE. A latched one was planned somewhere else. */
    edgeLimit: number,
  ): number {
    // COMING HOME IS A MANOEUVRE TOO, so it goes through the search rather than round it.
    //
    // Every exit below used to return the lane centre outright, and that was a no-op:
    // the driver's lane was the one beside the crown and the car was always in it, so
    // "hold the lane" and "stay where you are" were the same number. With every driver
    // keeping to the OUTERMOST lane, a car that has just finished a pass — or been
    // handed a new home lane by a taper — is somewhere else, and returning the centre
    // outright is a lane change the corridor search never approved: it walks straight
    // through the refusal to steer into a car alongside. Measured on the boxed-in
    // bench: the driver commanded the outer lane with a car level in it, and while it
    // was being dragged over there it crept into the rock it had stopped for.
    //
    // So the lane centre is the answer while the body is in that lane, and the PRICED
    // line is the answer while it is not. This cannot oscillate: the search's own lane
    // cost pulls every candidate toward home, and the only thing that keeps the car
    // out is something in the way.
    const held = Math.abs(ownLateral - laneOffset) > CAR_HALF_WIDTH_M ? proposed : laneOffset;
    // ROAD THE MANOEUVRE NEEDS, and one number for both ends of the state.
    //
    // CLOSE ENOUGH TO ACT ON IS A DISTANCE THE MOVE DECIDES, NOT A CONSTANT.
    // `DETOUR_TRIGGER_M` is 45 m, and a lateral move of `d` metres at `a` needs
    // `v · 2·sqrt(d/a)` metres of road: at 20 m/s and the comfortable rate that is
    // seventy-odd, and at 30 m/s it is over a hundred. So the trigger fired with less
    // road left than the manoeuvre takes — by construction, at every road speed. The
    // planner had already proposed the line that clears the obstruction, and this threw
    // it away until it was too late to use, at which point the swept test correctly
    // reported that no line could be reached and the driver braked at the thing as
    // though it were a wall. Reported from play as cars driving into an obstruction and
    // laying siege to it before eventually getting round.
    //
    // A driver starts moving over when the obstruction is as far ahead as the move is
    // long, plus a body length so the line arrives before the bumper does.
    //
    // AND "AS FAR AHEAD AS THE MOVE IS LONG" IS MEASURED IN CLOSING DISTANCE. A rock
    // closes at the speed the car is doing and a slower car closes at the difference,
    // so timing both on the speedometer made every overtake begin a lifetime early:
    // sixty-odd metres behind a leader four metres a second slower, where the gap is
    // fifteen seconds of closing. Reported from play — on the two-lane road the pass
    // starts a long way back, and the driver never does the closing-up it is told to.
    //
    // The floor is a few car lengths rather than the old forty-five for the same
    // reason: forty-five metres of gap to a slower car is not "close enough to act on",
    // it is a comfortable following distance, and a floor that large simply reinstated
    // the defect for every moving leader.
    //
    // The RELEASE is the same distance plus a margin, and it has to be: with a fixed
    // 55 m release against a trigger that can now fire at a hundred, a manoeuvre begun
    // in good time would have been abandoned on the very next step for being begun too
    // early. The shift is taken from whichever line the state owns, so neither end of
    // the manoeuvre moves while it is in progress.
    const manoeuvreShift = Math.abs((this.detouring ? this.detourLine : proposed) - laneOffset);
    const manoeuvreClosing = Math.max(speed - Math.max(0, laneBlockSpeed), MIN_CLOSING_MPS);
    const manoeuvreRoom = Math.max(
      DETOUR_TRIGGER_FLOOR_M,
      manoeuvreClosing * 2 * Math.sqrt(manoeuvreShift / Math.max(lineAccel, 1e-3)) +
        CAR_HALF_LENGTH_M * 2,
    );
    const committedCrossesCrown =
      this.detouring && this.detourLine * Math.sign(laneOffset || -1) < -CAR_HALF_WIDTH_M * 0.5;
    if (!this.detouring) {
      const wantsOut = Math.abs(proposed - laneOffset) >= DETOUR_MIN_M;
      const blockerClose = laneBlockDistance < manoeuvreRoom;
      if (wantsOut && blockerClose) {
        this.detouring = true;
        this.detourLine = proposed;
        this.detourUntilS = hintS + DETOUR_MAX_M;
      }
      return this.detouring ? this.detourLine : held;
    }
    // A LATCHED LINE BELONGS TO THE ROAD IT WAS CHOSEN ON.
    //
    // The commitment is a number of metres from the centreline, and the road it was
    // chosen on can be twice as wide as the road the car is on a hundred metres later:
    // a line 5.5 m out is the outer lane of a dual carriageway and the desert beside a
    // single one. Measured on the real road: cars holding lines their current asphalt
    // does not reach, ending up twenty-four metres out in the sand. The manoeuvre is
    // re-decided rather than clamped — a detour that no longer fits is not a detour.
    if (Math.abs(this.detourLine) > edgeLimit) {
      this.detouring = false;
      return held;
    }
    // A MANOEUVRE ON THE WRONG SIDE OF THE ROAD IS NEVER LATCHED.
    //
    // The latch exists so a detour is not re-argued every fixed step, and for a
    // manoeuvre inside this driver's own carriageway that is exactly right. On the
    // OPPOSING side it is a way to hold a decision after its reason has expired: the
    // crossing gate is re-checked every step against the car coming the other way, and
    // while the latch held, the answer changing from "clear" to "here it comes" had no
    // effect at all. Measured on the real road: two opposing drivers each committed to
    // a crossing while the other was far away, both kept it as they converged, and met.
    //
    // So a crossing survives only while the planner still offers one. Coming back is
    // handled by the ordinary line rate, with the head-on escape floor behind it.
    if (committedCrossesCrown && crossingRefused) {
      this.detouring = false;
      // AND IT STAYS ABANDONED FOR A WHILE. The gate is re-asked every fixed step, so
      // a car coming the other way that is only just too close flickers the answer —
      // and each flicker was a fresh crossing, a fresh commitment and a fresh
      // indicator. Measured on the overtake bench: eighty indicator changes in one
      // manoeuvre where the driver should have signalled twice.
      this.crossingBarredUntil = this.travelled + CROSSING_RETRY_METRES;
      return held;
    }
    // COMING BACK IS "THE LANE I LEFT IS NO LONGER HOLDING ME UP", NOT "IT IS EMPTY
    // FOR FIFTY METRES".
    //
    // On a single-lane road those are the same sentence. On a four-lane one they are
    // not: a driver that has just passed one slow car with another one sixty metres
    // further on returns to its lane, closes on it, and goes straight back out. That
    // is the weave a real dual carriageway does not have — drivers sort themselves by
    // speed and stay sorted. So a manoeuvre inside the driver's OWN carriageway is
    // held while the lane it came from still holds something materially slower than
    // this driver: the passing lane is being USED, not borrowed, and the cap is
    // renewed for as long as that stays true.
    //
    // A crossing is never held on this. The opposing lane belongs to somebody coming
    // the other way, and the same rule there is a driver sitting in it through a whole
    // queue.
    const laneStillSlow =
      !committedCrossesCrown &&
      laneBlockDistance < Number.POSITIVE_INFINITY &&
      laneBlockSpeed > CRAWL_SPEED_MPS &&
      laneBlockSpeed < desiredSpeed - PASS_ADVANTAGE_MPS;
    if (laneStillSlow) this.detourUntilS = hintS + DETOUR_MAX_M;
    const laneIsClear =
      !(laneBlockDistance < manoeuvreRoom + DETOUR_RELEASE_MARGIN_M) && !laneStillSlow;
    if (laneIsClear || hintS > this.detourUntilS) {
      this.detouring = false;
      return held;
    }
    return this.detourLine;
  }

  /** Supplies ambient light and road distance to the nearest approaching vehicle. */
  setLightingConditions(daylightFactor: number, oncomingGap: number): void {
    this.daylightFactor = clamp(daylightFactor, 0, 1);
    this.oncomingGap = oncomingGap >= 0 ? oncomingGap : Infinity;
  }
  /** Supplies the on-foot player as a physical obstacle in absolute world space. */
  setPedestrianObstacle(x: number, z: number, vx: number, vz: number): void {
    this.pedestrianActive = true;
    this.pedestrianX = x;
    this.pedestrianZ = z;
    this.pedestrianVx = vx;
    this.pedestrianVz = vz;
  }

  /** Removes the player-shaped obstacle while the player is represented by a car. */
  clearPedestrianObstacle(): void {
    this.pedestrianActive = false;
  }
  /**
   * Dips a manually driven player's high beam for an approaching vehicle, then
   * restores it after the opposing car has passed. Low/off player choices remain
   * untouched.
   */
  syncPlayerHighBeam(vehicle: Vehicle): void {
    if (this.playerHeadlightVehicle !== vehicle) {
      this.playerHeadlightVehicle = vehicle;
      this.playerHighBeamSuppressed = false;
    }
    if (vehicle.headlights === 'high') {
      if (this.oncomingGap <= HIGH_BEAM_DIP_M) {
        vehicle.setHeadlights('low');
        this.playerHighBeamSuppressed = true;
      }
      return;
    }
    if (!this.playerHighBeamSuppressed) return;
    if (vehicle.headlights === 'off') {
      this.playerHighBeamSuppressed = false;
    } else if (this.oncomingGap >= HIGH_BEAM_RESTORE_M) {
      vehicle.setHeadlights('high');
      this.playerHighBeamSuppressed = false;
    }
  }
  get engaged(): boolean { return this.engagedValue; }
  /** Rate-limited line being steered to, metres of road lateral. */
  get commandedLine(): number { return this.appliedLateral; }
  /** Distance to the nearest dynamic body in the corridor, metres, or Infinity. */
  get obstacleGap(): number { return this.obstacleGapValue; }
  /** Observed signed along-road speed of that body, m/s. */
  get obstacleSpeed(): number { return this.obstacleSpeedValue; }
  get activity(): AutopilotActivity { return this.activityValue; }
  /**
   * True while this driver is stopped, or slowing, for traffic coming the other way
   * rather than for anything it can do something about.
   *
   * A stream coordinator must not read a pair of yielding drivers as a deadlock: they
   * are executing the give-way rule correctly and one of them is about to go. Granting
   * either of them a reversing escape turns a four-second wait into a manoeuvre across
   * the carriageway in front of the traffic it was waiting for.
   */
  get isYielding(): boolean { return this.yielding; }

  /**
   * WHY THE CAR IS DOING WHAT IT IS DOING. Read-only, for the dev overlay in
   * `main.ts` and the road benches; see the fields for why it exists.
   */
  get homeLane(): number { return this.homeLaneValue; }
  /** Speed the pending lateral move allows, m/s; Infinity when no deadline applies. */
  get manoeuvreSpeed(): number { return this.manoeuvreSpeedValue; }
  /** What the speed plan asked the pedal for this step, m/s, before the bumper veto. */
  get targetSpeed(): number { return this.targetSpeedValue; }
  /** Nearest thing in the HOME lane and its speed, whatever line was chosen. */
  get laneBlockDistance(): number { return this.corridorLaneBlockDistance; }
  get laneBlockSpeed(): number { return this.corridorLaneBlockSpeed; }
  /** Caught something worth passing, and whether the kickdown is being spent on it. */
  get passUrge(): boolean { return this.passUrgeValue; }
  get passAttempt(): boolean { return this.passAttemptValue; }

  /**
   * Hands this driver a different road, mid-drive.
   *
   * The turning circle at the road's start is a second road view (`world/turnaround.ts`),
   * and an ambient car that reaches the end of the world is given it, driven round the
   * bulb, and handed the ordinary road back facing the other way. Everything the
   * controller holds about WHERE it is - the projection hint, the planned line, the
   * recovery state - belongs to the road it was holding, so this resets exactly what a
   * fresh engagement resets and nothing else: the mode, the speed cap and the headway
   * are the driver's, not the road's.
   */
  retarget(road: DriveRoad, hazards: HazardField): void {
    this.road = road;
    this.hazards = hazards;
    this.setEngaged(this.engagedValue);
  }

  setEngaged(engaged: boolean): void {
    if (!engaged) this.controlledVehicle?.setIndicator('off');
    this.engagedValue = engaged;
    // A fresh engagement is a fresh mandate: the automation drives the lamps again
    // until the driver takes the switch back.
    if (engaged) this.automaticLightsOwned = true;
    this.hintValid = false;
    this.stoppedFor = 0;
    this.sinceRecovery = RECOVERY_REARM_S;
    this.recoveryPhase = 'none';
    this.recoveryOffRoad = false;
    this.roadRecoveryActive = false;
    this.roadRecoveryTargetLine = 0;
    this.roadRecoveryFollowingEscape = false;
    this.recoveryTimer = 0;
    this.recoveryBias = 0;
    this.recoveryBiasUntil = 0;
    this.lastRecoveryAt = -Infinity;
    this.recoveryAttempts = 0;
    this.recoveryEscalation = 0;
    this.recoveryLegElapsed = 0;
    this.recoveryLegStalled = 0;
    this.recoveryCommitted = false;
    this.deadlockPermission = false;
    this.yieldReverse = false;
    this.dynamicBlockerKnown = false;
    this.obstacleGapValue = Infinity;
    this.obstacleSpeedValue = 0;
    this.activityValue = 'cruise';
    if (!engaged) {
      this.appliedLateral = 0;
      this.planLine = 0;
      this.detouring = false;
      this.detourLine = 0;
      this.detourUntilS = 0;
    }
  }

  /** Writes controls in-place using a geometric pure-pursuit waypoint. */
  drive(dt: number, vehicle: Vehicle, out: InputFrame, originX: number, originZ: number): void {
    if (!this.engagedValue) return;
    this.controlledVehicle = vehicle;
    // Autonomy inverts the ordinary shaped steering path explicitly. Never let a
    // player's precise-control preference change the physical command it computed.
    out.preciseSteering = false;
    const firstProjection = !this.hintValid;
    this.updateAutomaticHeadlights(vehicle);
    const config = MODES[this.modeValue];
    vehicle.absoluteTranslation(this.position);
    const projection = this.road.project(
      this.position.x,
      this.position.z,
      this.hintValid ? this.hintS : undefined,
    );
    if (firstProjection) {
      this.appliedLateral = projection.lateral;
      this.lineSlewRate = 0;
      this.planLine = projection.lateral;
      // A fresh engagement has no manoeuvre behind it; inheriting one from a previous
      // drive would have the car commit to a detour chosen for another road position.
      this.detouring = false;
      this.detourLine = projection.lateral;
      this.detourUntilS = 0;
    }
    this.hintS = projection.s;
    this.hintValid = true;
    this.asphaltHalfWidth = this.road.halfWidthAt(this.hintS);
    const lanesPerSide = this.road.lanesPerSideAt(this.hintS);
    // WHICH LANE IS THIS DRIVER'S, and it is the driver's own answer — the player's
    // autopilot included, which used to be the one car on the road with no opinion
    // about lanes at all, because the lane arrived through `requestLane` and only the
    // traffic coordinator ever called it.
    //
    // A road with two lanes each way is sorted by PACE: anything materially quick
    // lives in the lane beside the crown, everything else keeps to the outside, and
    // both then stay put. Keeping right and overtaking was tried first and is what
    // produced the chaos it was meant to remove — every driver with a slower car
    // ahead had a reason to move, so the stream shuttled between lanes.
    //
    // A lane that ENDS is still a lane to be out of before it ends, so the outer home
    // is the outermost one that exists HERE and still exists a taper's warning ahead.
    // That merge used to be the coordinator's (`assignRequestedLanes`), which is
    // exactly why it only ever happened to ambient traffic.
    const lanesAhead = this.road.lanesPerSideAt(this.hintS + HOME_LANE_LOOKAHEAD_M);
    const ownPace = Math.min(config.cruiseMps * this.paceValue, this.speedCapValue);
    /**
     * THE WIDE-ROAD PACE IS TAKEN AND GIVEN BACK OVER SECONDS, NOT ON ONE STEP.
     *
     * `lanesPerSideAt` is a step function, so a flat multiplier on it is a twelve per
     * cent jump in the speed every driver wants, at one arclength, in both directions —
     * and a jump DOWN is a brake, arriving for each car at a slightly different metre
     * while they are also being asked to merge. Reported from play: the four-to-two
     * transition is untidy.
     *
     * Two things fix it, and both are what a driver does. The bonus is withdrawn as
     * soon as the narrowing is VISIBLE — the same taper's warning the home lane already
     * reads, so the lift-off happens before the merge rather than during it — and the
     * factor is slewed rather than switched, so the whole twelve per cent is worth a
     * few seconds of gentle throttle either way.
     */
    const widePaceTarget = lanesPerSide > 1 && lanesAhead > 1 ? WIDE_ROAD_PACE : 1;
    const widePaceStep = ((WIDE_ROAD_PACE - 1) / WIDE_PACE_RAMP_S) * Math.max(dt, 0);
    this.widePaceValue += clamp(widePaceTarget - this.widePaceValue, -widePaceStep, widePaceStep);
    const desiredSpeed = ownPace * this.widePaceValue;
    const homeLane =
      ownPace >= INNER_LANE_PACE_MPS ? 0 : Math.min(lanesPerSide, lanesAhead) - 1;
    this.homeLaneValue = homeLane;
    const ownLaneOffset = this.road.laneCentreAt(this.hintS, homeLane);
    const passingEdge = this.asphaltHalfWidth + PASSING_VERGE_M;
    const staticAvoidEdge = this.asphaltHalfWidth + STATIC_AVOID_VERGE_M;
    const staticAvoidLine = staticAvoidEdge - CAR_HALF_WIDTH_M;
    const offRoadRecoveryLine = this.asphaltHalfWidth - CAR_HALF_WIDTH_M - 0.2;
    const offRoadRejoinLateral = this.asphaltHalfWidth - CAR_HALF_WIDTH_M - 0.05;
    this.laneCentres.length = 0;
    // WHICH LANES THIS DRIVER MAY EVEN CONSIDER.
    //
    // The home lane always. An inner lane is one of three things:
    //
    //   - the only way past something STOPPED in the home lane, which is everybody's
    //     right: the alternative on a wide road is queueing behind a boulder for good,
    //     or crossing the crown for it, and the second is how two opposing streams
    //     meet head-on;
    //   - a passing lane, for a driver with the character to use one (`lanePasses`);
    //   - where the car already IS, mid-manoeuvre, so the plan keeps pricing the line
    //     it is on and not only the one it came from.
    //
    // The blocked tests are deliberately about the lane, not about the driver's mood:
    // the lane centres are only candidates, and the planner still prices staying put.
    // They read LAST step's plan, which is a step of lag on a decision that takes a
    // hundred metres — and it is what keeps an empty road down to one probe per tick.
    const laneBlockedNear = this.corridorLaneBlockDistance < CORRIDOR_MAX_HORIZON_M;
    const ownLaneObstructed = laneBlockedNear && this.corridorLaneBlockSpeed <= CRAWL_SPEED_MPS;
    const ownLaneSlow =
      laneBlockedNear &&
      this.corridorLaneBlockSpeed < desiredSpeed - ADJACENT_LANE_PROBE_ADVANTAGE_MPS;
    const velocity = vehicle.chassis.linvel();
    const speed = Math.hypot(velocity.x, velocity.z);
    this.laneEntryOwnLateral = projection.lateral;
    this.laneEntryOwnSpeed = speed;
    this.rearUnsafeBands.length = 0;
    this.trafficField?.forEachNear(0, LANE_ENTRY_REAR_LOOK_M, this.visitRearNeighbour);
    const awayFromHomeLane = Math.abs(projection.lateral - ownLaneOffset) > CAR_HALF_WIDTH_M;
    if (
      lanesPerSide > 1 &&
      (awayFromHomeLane || ownLaneObstructed || (config.lanePasses && ownLaneSlow))
    ) {
      for (let lane = 0; lane < lanesPerSide; lane++) {
        const centre = this.road.laneCentreAt(this.hintS, lane);
        // Rear entry is a hard swept-path constraint on every planner candidate,
        // not just on these exact lane centres. Keep the lane probed even if entry
        // is barred, so a lattice line cannot hide traffic by avoiding its centre.
        this.laneCentres.push(centre);
      }
      if (this.laneCentres.length === 0) this.laneCentres.push(ownLaneOffset);
    } else {
      this.laneCentres.push(ownLaneOffset);
    }
    this.travelled += speed * dt;
    this.sinceRecovery += dt;
    const wasRoadRecoveryActive = this.roadRecoveryActive;
    // A car out on the graded shoulder because its corridor goes round something is
    // not a car that has left the road: the planner put it there and will bring it
    // back. Only a departure the planner did not ask for is a road departure.
    const insideStaticAvoidance =
      this.planUsesShoulder && Math.abs(projection.lateral) <= staticAvoidEdge;
    if (Math.abs(projection.lateral) > passingEdge && !insideStaticAvoidance) {
      this.roadRecoveryActive = true;
    }
    let offRoad = this.roadRecoveryActive;
    const roadRecoveryBias =
      this.recoveryPhase !== 'none'
        ? this.recoverySide * (RECOVERY_BIAS_M + this.recoveryEscalation * RECOVERY_BIAS_STEP_M)
        : this.travelled < this.recoveryBiasUntil
          ? this.recoveryBias
          : 0;
    if (offRoad && !wasRoadRecoveryActive) {
      this.roadRecoveryFollowingEscape = Math.abs(roadRecoveryBias) > 0.01;
      this.roadRecoveryTargetLine =
        Math.abs(roadRecoveryBias) > 0.01
          ? clamp(
              ownLaneOffset + roadRecoveryBias,
              -offRoadRejoinLateral,
              offRoadRejoinLateral,
            )
          : ownLaneOffset;
      // Ordinary road re-entry is not obstacle recovery: cancel an old generic
      // manoeuvre and hold the nearest edge line. A coordinator-committed deadlock
      // escape is different; crossing the verge is part of its chosen outer path,
      // so preserve that manoeuvre until it clears the opposing head.
      if (!this.recoveryCommitted) {
        this.recoveryPhase = 'none';
        this.recoveryTimer = 0;
        this.stoppedFor = 0;
        this.stallAnchorX = this.position.x;
        this.stallAnchorZ = this.position.z;
        this.appliedLateral =
          Math.sign(projection.lateral || 1) * offRoadRecoveryLine;
      }
      this.planUsesShoulder = false;
      this.planUsesOncomingLane = false;
    }
    // Pure pursuit aims at a point `lookahead` metres along the road. In a bend the
    // chord to that point cuts the apex, so a preview longer than the corner itself
    // steers the car inside the entry and then wide of the exit: measured on
    // tools/playground-lap.ts, a 30 m hairpin taken with 24 m of preview put a wheel
    // 1.1 m past the asphalt. Half a radian of arc is the most that can be previewed
    // before the chord stops describing the curve, so the preview is capped at
    // `0.5 / curvature` — no effect on a straight or a sweeper, decisive in a hairpin.
    const lookahead = Math.max(
      MIN_LOOKAHEAD_M,
      Math.min(
        config.lookaheadBase + speed * config.lookaheadSpeed,
        LOOKAHEAD_ARC_RAD / Math.max(Math.abs(this.road.curvatureAt(this.hintS)), 1e-4),
      ),
    );
    const currentRoad = this.road.sampleAt(this.hintS);
    const roadForwardX = Math.sin(currentRoad.heading);
    const roadForwardZ = Math.cos(currentRoad.heading);
    const target = this.road.sampleAt(this.hintS + lookahead);
    this.road.conditionAt(this.hintS, this.condition);
    const currentSurface = this.condition.surface;
    const currentPhysicalBrake = vehicle.estimatedBrakeDecel(currentSurface);
    const currentBrakeAccel = Math.max(
      MIN_PLANNED_BRAKE_MPS2,
      Math.min(config.brakeAccel, currentPhysicalBrake * BRAKE_GRIP_RESERVE) +
        currentRoad.grade * GRAVITY,
    );
    const gradeLoad = Math.min(
      0.8,
      Math.abs(currentRoad.grade * GRAVITY) / Math.max(currentPhysicalBrake, 1),
    );
    // Match the plan to the force the capped pedal can actually ask of the
    // measured wheel loads and surfaces, not an unloaded surface-only estimate.
    // Before the first wheel pass there is no measurement to use yet.
    const measuredBrake = vehicle.measuredBrakeDecel > 0
      ? vehicle.measuredBrakeDecel : currentPhysicalBrake;
    const obstacleBrakeAccel = Math.max(
      MIN_PLANNED_BRAKE_MPS2,
      Math.min(
        currentBrakeAccel,
        measuredBrake * Math.min(config.brakeCeiling, OBSTACLE_BRAKE_MAX) +
          currentRoad.grade * GRAVITY,
      ),
    );
    // The tyres' own cornering capacity here, and the share of it this mode plans to
    // use. The plan keeps a reserve; the friction ellipse the brake pays below is
    // physics and must be measured against the CAPACITY, or a car at its planned
    // cornering limit is charged as though it had no grip left at all.
    const physicalLateralAccel = Math.max(
      1e-3,
      vehicle.estimatedLateralAccel(currentSurface, speed) *
        Math.sqrt(Math.max(0.35, 1 - gradeLoad * gradeLoad)),
    );
    const currentLateralAccel = Math.min(
      config.lateralAccel,
      physicalLateralAccel * LATERAL_GRIP_RESERVE,
    );
    const rotation = vehicle.chassis.rotation();
    const forwardX = 2 * (rotation.x * rotation.z + rotation.w * rotation.y);
    const forwardZ = 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y);
    const forwardSpeed = velocity.x * forwardX + velocity.z * forwardZ;
    let pedestrianGap = Infinity;
    let pedestrianLateral = 0;
    let pedestrianSpeed = 0;
    let pedestrianBodyGap = Infinity;
    if (this.pedestrianActive) {
      const dx = this.pedestrianX - this.position.x;
      const dz = this.pedestrianZ - this.position.z;
      if (dx * dx + dz * dz <= PEDESTRIAN_QUERY_RANGE_M * PEDESTRIAN_QUERY_RANGE_M) {
        const pedestrianProjection = this.road.project(
          this.pedestrianX,
          this.pedestrianZ,
          this.hintS,
        );
        pedestrianGap =
          pedestrianProjection.s - this.hintS - CAR_HALF_LENGTH_M - PEDESTRIAN_RADIUS_M;
        pedestrianLateral = pedestrianProjection.lateral;
        pedestrianSpeed = Math.max(
          0,
          this.pedestrianVx * roadForwardX + this.pedestrianVz * roadForwardZ,
        );
        const bodyAhead = dx * forwardX + dz * forwardZ;
        const bodyAcross = Math.abs(dx * forwardZ - dz * forwardX);
        if (
          bodyAhead >= -PEDESTRIAN_RADIUS_M
          && bodyAhead <= BODY_SCAN_RANGE_M + CAR_HALF_LENGTH_M
          && bodyAcross <= CAR_HALF_WIDTH_M + PEDESTRIAN_RADIUS_M
        ) {
          pedestrianBodyGap = bodyAhead - CAR_HALF_LENGTH_M - PEDESTRIAN_RADIUS_M;
        }
      }
    }


    // Seeing a prop only inside the old full-pedal stopping distance leaves no
    // target curve that the capped obstacle pedal can still execute.
    const obstacleSight = config.brakeLead + (speed * speed) / (2 * obstacleBrakeAccel);
    this.beginHazardScan(projection.lateral);
    this.hazards.forEachAhead(
      this.hintS,
      Math.max(lookahead + 8, obstacleSight),
      this.visitHazard,
    );

    // Traffic: the short body-frame scan for anything about to be hit, and the long
    // lane probe for anything to be followed.
    //
    // The probe is cast down the COMMANDED line and, when the car is not on it and is
    // still pointing along the road, down the line the body actually occupies as well.
    // Those are the same corridor during ordinary lane keeping and very different
    // after an abandoned pass: the car sat in the oncoming lane while its probe
    // examined the lane it wanted to be in, and the traffic it was about to meet
    // head-on was never in the corridor it was looking at.
    //
    // The parallel test is what keeps it honest. A car ANGLED across the road — one
    // mid-recovery, say — is not going down any lane, and reading its own displaced
    // corridor as blocked is how the escape manoeuvre talked itself out of moving.
    // The car-frame scan above is the query that is valid at any angle.
    this.bodyScanGap = Math.min(
      this.axisScan(vehicle, originX, originZ, 1, BODY_SCAN_RANGE_M),
      pedestrianBodyGap,
    );
    const bodyScanSpeed = this.bodyScanGap === pedestrianBodyGap
      ? pedestrianSpeed
      : this.probeHitSpeed;
    const sight = Math.max(PROBE_MIN_SIGHT_M, speed * PROBE_SIGHT_SECONDS);
    const pedestrianOnAppliedLine =
      pedestrianGap >= -PEDESTRIAN_RADIUS_M
      && pedestrianGap <= sight
      && Math.abs(pedestrianLateral - this.appliedLateral)
        <= CAR_HALF_WIDTH_M + PEDESTRIAN_RADIUS_M;
    const laneGap = Math.min(
      this.laneProbe(vehicle, this.appliedLateral, sight, originX, originZ),
      pedestrianOnAppliedLine ? pedestrianGap : Infinity,
    );
    const laneProbeSpeed = pedestrianOnAppliedLine && laneGap === pedestrianGap
      ? pedestrianSpeed
      : this.probeHitSpeed;
    let headingError = Math.atan2(forwardX, forwardZ) - currentRoad.heading;
    while (headingError > Math.PI) headingError -= Math.PI * 2;
    while (headingError < -Math.PI) headingError += Math.PI * 2;
    const lateralSpeed =
      velocity.x * Math.cos(currentRoad.heading) -
      velocity.z * Math.sin(currentRoad.heading);
    const looseSurface =
      currentSurface === SurfaceType.Gravel ||
      currentSurface === SurfaceType.Sand ||
      currentSurface === SurfaceType.Rock;
    const edgeStability =
      looseSurface &&
      !offRoad &&
      Math.abs(projection.lateral) > EDGE_STABILITY_LATERAL_M &&
      projection.lateral * lateralSpeed > 0 &&
      Math.abs(lateralSpeed) > EDGE_STABILITY_LATERAL_SPEED_MPS;
    // A plain road departure remains capped at walking speed until the whole car is
    // centred on its own lane and parallel to the road. An obstacle escape already
    // has a deliberate clear-side line; once its body is back on asphalt, preserve
    // that line long enough to pass the obstacle instead of steering back into it.
    const bodyOnAsphalt = Math.abs(projection.lateral) <= offRoadRejoinLateral;
    const settledOnRecoveryLine =
      Math.abs(projection.lateral - this.roadRecoveryTargetLine) <=
        OFFROAD_LANE_TOLERANCE_M &&
      Math.abs(headingError) <= OFFROAD_HEADING_TOLERANCE_RAD;
    if (
      offRoad &&
      bodyOnAsphalt &&
      (this.roadRecoveryFollowingEscape || settledOnRecoveryLine)
    ) {
      this.roadRecoveryActive = false;
      offRoad = false;
      this.stoppedFor = 0;
      this.stallAnchorX = this.position.x;
      this.stallAnchorZ = this.position.z;
      if (Math.abs(this.roadRecoveryTargetLine - ownLaneOffset) > 0.01) {
        this.recoveryBias = this.roadRecoveryTargetLine - ownLaneOffset;
        this.recoveryBiasUntil = this.travelled + RECOVERY_BIAS_METRES;
      }
      this.roadRecoveryFollowingEscape = false;
    }
    const pedestrianOnBodyLine =
      pedestrianGap >= -PEDESTRIAN_RADIUS_M
      && pedestrianGap <= sight
      && Math.abs(pedestrianLateral - projection.lateral)
        <= CAR_HALF_WIDTH_M + PEDESTRIAN_RADIUS_M;
    const bodyLaneGap =
      Math.abs(headingError) < PROBE_PARALLEL_RAD &&
      Math.abs(projection.lateral - this.appliedLateral) > PROBE_HALF_WIDTH_M
        ? Math.min(
            this.laneProbe(vehicle, projection.lateral, sight, originX, originZ),
            pedestrianOnBodyLine ? pedestrianGap : Infinity,
          )
        : Infinity;
    const bodyLaneSpeed = pedestrianOnBodyLine && bodyLaneGap === pedestrianGap
      ? pedestrianSpeed
      : this.probeHitSpeed;
    // Keep observing the home lane while passing, but retain that observation's
    // own velocity rather than borrowing a nearer body's speed from another lane.
    const lineInOwnLane =
      Math.abs(projection.lateral - ownLaneOffset) < PROBE_HALF_WIDTH_M &&
      Math.abs(this.appliedLateral - ownLaneOffset) < PROBE_HALF_WIDTH_M;
    const pedestrianInOwnLane =
      pedestrianGap >= -PEDESTRIAN_RADIUS_M
      && pedestrianGap <= sight
      && Math.abs(pedestrianLateral - ownLaneOffset)
        <= CAR_HALF_WIDTH_M + PEDESTRIAN_RADIUS_M;
    const ownLaneGap = Math.min(
      lineInOwnLane
        ? Math.min(laneGap, bodyLaneGap)
        : this.laneProbe(vehicle, ownLaneOffset, sight, originX, originZ),
      pedestrianInOwnLane ? pedestrianGap : Infinity,
    );
    const ownLaneProbeSpeed =
      pedestrianInOwnLane && ownLaneGap === pedestrianGap
        ? pedestrianSpeed
        : lineInOwnLane
          ? bodyLaneGap < laneGap ? bodyLaneSpeed : laneProbeSpeed
          : this.probeHitSpeed;
    const nearestGap = Math.min(this.bodyScanGap, laneGap, bodyLaneGap, ownLaneGap);
    const nearestSpeed = nearestGap === ownLaneGap ? ownLaneProbeSpeed
      : nearestGap === laneGap ? laneProbeSpeed
      : nearestGap === bodyLaneGap ? bodyLaneSpeed
      : bodyScanSpeed;
    this.updateLead(dt, nearestGap, speed, nearestSpeed);
    const gap = this.obstacleGapValue;
    const leadSpeed = this.obstacleSpeedValue;
    // A recovery is normally an escape from unexplained static blockage, and
    // MOVING traffic ahead cancels it: a queue is not a wedge, and reversing out of
    // one is how a stream turns into a pile-up.
    //
    // Something STOPPED ahead is the opposite. Seen in play: the player's car came
    // off the sand into the opposing lane, met a stopped oncoming car nose to nose,
    // and both sat there for good — because this test cancelled the manoeuvre and
    // zeroed the stall timer every single step, for as long as that car was there.
    // The car in front of a wedged driver is usually the reason it is wedged.
    const blockerMoving = gap < Infinity && this.obstacleSpeedValue > CRAWL_SPEED_MPS;
    //
    // A passing body can hide a static wedge from the dynamic probes, but only
    // briefly. A normal follower requests zero speed and never accumulates
    // `groundlessFor`, so this shorter grace does not make queues reverse.
    if (
      !this.recoveryCommitted &&
      this.groundlessFor < MOVING_BLOCKER_GRACE_S &&
      (blockerMoving ||
        (gap === Infinity &&
          this.dynamicBodyAhead(vehicle, originX, originZ, roadForwardX, roadForwardZ)))
    ) {
      this.recoveryPhase = 'none';
      this.recoveryTimer = 0;
      this.stoppedFor = 0;
    }
    let mustStop = this.bodyScanGap < MUST_STOP_GAP_M;

    // ONE LATERAL DECISION, MADE FROM GEOMETRY.
    //
    // Everything that used to live here — a latched detour line, a latched passing
    // line, a stopped-blocker bypass, and a priority ladder deciding which of them
    // won — is now a single call to `planCorridor`. The obstacles are assembled in
    // this car's own road frame, the planner prices every reachable line, and the
    // behaviours are what comes out: hold the lane, ease round a stone, go by a
    // wreck on the right, overtake on the opposing lane.
    //
    // Recovery and road re-entry keep their priority: those are manoeuvres that own
    // the car outright, and neither is a choice between corridors.
    const recovering = this.recoveryPhase !== 'none';
    const obstacles = this.corridorObstacles;
    obstacles.length = 0;
    const horizon = Math.max(
      CORRIDOR_MIN_HORIZON_M,
      obstacleSight,
      Math.min(CORRIDOR_MAX_HORIZON_M, speed * CORRIDOR_HORIZON_SECONDS),
    );
    this.collectHorizon = horizon;
    this.hazards.forEachAhead(this.hintS, horizon, this.collectHazard);
    if (
      pedestrianGap >= -PEDESTRIAN_RADIUS_M
      && pedestrianGap <= horizon
    ) {
      obstacles.push({
        s: pedestrianGap,
        lateral: pedestrianLateral,
        halfWidth: PEDESTRIAN_RADIUS_M + AVOID_HYSTERESIS_M,
        speed: pedestrianSpeed,
        movable: true,
      });
    }
    // AND WHAT IS BESIDE THE CAR, which no forward ray can answer: the lane probes
    // start four metres past the bumper, so a car level with the door is invisible
    // to every one of them. That blind spot is how a driver indicated, moved into
    // the next lane and drove into the car already in it.
    this.collectAbeamNeighbours(
      vehicle,
      originX,
      originZ,
      roadForwardX,
      roadForwardZ,
      projection.lateral,
    );
    // WHICH LANE THE CAR AHEAD IS IN IS MEASURED, NEVER INFERRED FROM OUR OWN LINE.
    //
    // The rays report a distance, not a lateral. Snapping that distance to whichever
    // lane centre was nearest the probe's own cast line works only while the cast
    // line is inside a lane — and during an overtake it is not. Measured in the
    // repro: the moment the commanded line crossed the centre, the car being passed
    // was recorded in the OPPOSING lane, the opposing corridor read as blocked, our
    // own lane read as clear, and the planner turned back. Next step the line had
    // slewed back below the centre, the same car moved back into our lane, and the
    // pass fired again. The car settled straddling the centre line with the planner
    // flipping every step: both indicators buzzing, no speed cap from a lane the
    // planner believed was empty, and the lead nudged along at 120 km/h.
    //
    // The obstacle's lane and velocity come from a probe cast down a FIXED lane
    // centre, even while the body is out in another lane.
    // A LANE THAT IS A CANDIDATE IS A LANE THAT GETS LOOKED AT.
    //
    // A lane probe is three rays per chord segment, so it used to be spent only on
    // the hurried driver that shops for lanes. Then the second lane on this side was
    // opened to anybody whose own lane is blocked — and those drivers changed lane
    // into traffic they had never probed. Measured immediately: side contacts in the
    // outer lane at 30 km/h, between two cars merging into the same gap.
    //
    // So the gate is now exactly "is there another candidate line", which is what
    // `laneCentres` already answers. An empty-road driver still has one candidate and
    // still pays for one probe.
    const probeAdjacentLanes = this.laneCentres.length > 1;
    // A DRIVER THAT HAS CAUGHT SOMETHING SLOW DRIVES DIFFERENTLY FROM ONE ON A CLEAR
    // ROAD: it closes up, and it uses the engine. See `PASS_KICKDOWN_SHARE`.
    const comfortHeadwayS = this.followingHeadwayValue ?? config.headwayS;
    // Last step's own-lane block, which is this step's leader to within a sixtieth of
    // a second: something in the driver's own lane going somewhere, materially slower
    // than it wants to go, and near enough to be what it is actually held up by rather
    // than traffic in the distance.
    //
    // `PASS_MIN_SPEED_MPS` is what keeps this out of a jam. A queue shuffling at 10
    // km/h is not a car to be overtaken, it is a road that is blocked, and treating it
    // as the former closed the gaps a blocked queue needs to unwind through: measured
    // on the real road at seed 1337, which is a seed with a blockage on it, 56% of
    // car-time under 8 km/h and an 81 s standstill against 23% and 14 s.
    const passUrge =
      (config.overtakes || config.lanePasses) &&
      this.corridorLaneBlockSpeed > PASS_MIN_SPEED_MPS &&
      this.corridorLaneBlockSpeed < desiredSpeed - PASS_ADVANTAGE_MPS &&
      this.corridorLaneBlockDistance <=
        PASS_APPROACH_REACH * (FOLLOW_STANDOFF_M + speed * comfortHeadwayS);
    /**
     * AND IT HAS TO BE A DRIVER THAT ACTUALLY WANTS THE OTHER LANE, which is what
     * `passShopping` records: last step's plan either asked for the crossing and was
     * refused it, or was already out there.
     *
     * Spending the allowance on everything merely slower is a whole queue driving 15%
     * harder into the back of itself for no extra pass, and that is what it measured:
     * on the real road at seed 202, 18 stream contacts against 3 and two bodies
     * launched, with one extra pass to show for it. The gate is self-starting because
     * a refusal is the state a held-up driver is already in — the manoeuvre it cannot
     * afford at its cruise is re-priced at its kickdown on the very next step.
     */
    const passAttempt = passUrge && this.passShopping;
    this.passUrgeValue = passUrge;
    /**
     * The kickdown, and it is the SAME number the crossing gate sizes the manoeuvre
     * with and the speed plan asks the pedal for: a pass committed to at a speed the
     * driver will not then use is how a crossing becomes a head-on.
     */
    const crossingSpeed = passAttempt
      ? desiredSpeed * (1 + PASS_KICKDOWN_SHARE / config.passNerve)
      : desiredSpeed;
    // The gap a driver shopping for a window keeps behind the car it means to pass.
    //
    // It is deliberately NOT conditioned on the pace already being matched. That was
    // tried — tuck in only once the closing speed is under 2 m/s — and it is a control
    // target that switches on the state it produces: tucking in raises the target, the
    // car closes, the test fails, the target drops, the car brakes, the test passes
    // again. Measured on the real road at seed 559316, that limit cycle turned a 1.6 s
    // longest stop and 8% crawl into a 132 s standstill and 55%.
    // AND IT DOES NOT NEED THE PLAN'S PERMISSION TO DO IT.
    //
    // Gated on `passShopping`, this never happened on a clear road: that flag only
    // comes on once a crossing has been refused or taken, so a driver that had simply
    // caught a slow car sat at full comfort headway and then went out from forty-five
    // metres back — reported from play as "the distance to the car being overtaken
    // never shrinks". The urge is the honest gate; it already says "I have caught
    // something materially slower and I am a driver that passes".
    //
    // The KICKDOWN stays behind `passAttempt` all the same: arriving at the back of a
    // queue 4 m/s faster is the rear-end measured at `clearRoadSpeed`. Closing the gap
    // and spending the engine are two decisions, and only one of them is safe to take
    // on an approach.
    const followHeadwayS = passUrge
      ? comfortHeadwayS * PASS_APPROACH_HEADWAY_SHARE
      : comfortHeadwayS;
    // AND THE STANDOFF SHORTENS WITH IT. The comfort gap is a headway plus the room
    // left when both cars have stopped, and shortening only the first of the two left
    // a driver sitting seven metres further back than it means to at every speed —
    // which at the pace this stream runs is a fifth of the whole gap. A driver waiting
    // for a window sits close enough to see past the car in front, and that is this.
    // The BRAKING term below still uses the full standoff, so the stopping distance
    // behind the leader is untouched.
    const followStandoffM = passUrge
      ? FOLLOW_STANDOFF_M * PASS_APPROACH_HEADWAY_SHARE
      : FOLLOW_STANDOFF_M;
    // Each fixed-lane observation carries its own hit speed; another lane's nearer
    // body must not lend this leader its velocity.
    if (ownLaneGap < Infinity) {
      obstacles.push({
        s: ownLaneGap,
        lateral: ownLaneOffset,
        halfWidth: CAR_HALF_WIDTH_M + AVOID_HYSTERESIS_M,
        speed: ownLaneProbeSpeed,
        movable: true,
      });
    }
    if (probeAdjacentLanes) {
      for (const laneCentre of this.laneCentres) {
        if (laneCentre === ownLaneOffset) continue;
        const laneGapForPlan = this.laneProbe(vehicle, laneCentre, sight, originX, originZ);
        if (laneGapForPlan === Infinity) continue;
        obstacles.push({
          s: laneGapForPlan,
          lateral: laneCentre,
          halfWidth: CAR_HALF_WIDTH_M + AVOID_HYSTERESIS_M,
          speed: this.probeHitSpeed,
          movable: true,
        });
      }
    }
    /**
     * WHAT A DRIVER DOES ABOUT A LOG IN THE ROAD: slow to the speed the way round can
     * be taken at, and take it. Not stop at it, not creep past it at walking pace.
     *
     * Moving the car `shift` metres sideways while covering `room` metres of road is a
     * pair of constant-lateral-acceleration arcs: the shift takes `T = 2·sqrt(shift/a)`
     * seconds whatever the speed, so the road it consumes is `v·T`, and requiring that
     * to fit inside `room` gives the speed directly.
     *
     *     v = room / 2 · sqrt(a / shift)
     *
     * `a` is a share of the grip budget the speed plan has already worked out for this
     * surface and grade, so the answer is slower on gravel and slower again downhill.
     * Far from the obstruction the number is enormous and nothing happens; it closes in
     * smoothly as the car approaches, which is a driver lifting off.
     *
     * TWO THINGS ABOUT `room`, AND THEY ARE BOTH WHY THIS WAS WRONG.
     *
     * 1. IT IS THE THING THE LINE IS GETTING PAST — not the nearest thing in the lane.
     *    The old sum took the nearest own-lane block or indexed prop whatever line had
     *    been chosen, so a driver already out in the other lane still lifted off for a
     *    rock in the lane it had LEFT: the one obstacle it was demonstrably clearing.
     *    Reported from play in exactly those words. What sets the speed is an
     *    obstruction the body's present band touches and the commanded line does not —
     *    that is what the manoeuvre is for. Anything the line still overlaps is IN the
     *    corridor, and the corridor's own braking below owns it.
     *
     * 2. THE ROOM IS CLOSING DISTANCE, so a moving car is priced on the difference.
     *    The move has to be finished before we reach the thing, and against a car doing
     *    20 m/s that takes as long as the CLOSING speed says it does. Priced as a rock,
     *    a lane change thirty metres behind a moving leader asked for 11 m/s — so an
     *    overtake began with the driver braking from its cruise, which is what "the
     *    kickdown does not accelerate, it slows down" was.
     */
    const manoeuvreLateralAccel = Math.max(0.8, currentLateralAccel * MANOEUVRE_LATERAL_SHARE);
    /**
     * HOW HARD THIS MOVE HAS TO BE STEERED, and it is decided BEFORE the move rather
     * than from the move, which is what was wrong with it.
     *
     * It used to ask only "is a shift already pending" — and a shift is
     * pending only once the line has started moving, so on the step where the driver
     * first sees the obstruction the answer was always "no deadline, be gentle". The
     * gentle rate then went to the planner as `lineAccel`, which made
     * `transitionDistance` two to three times longer, which made the swept test
     * declare every line that clears the rock unreachable, which left the driver with
     * no corridor at all: it braked at the thing as if it were a wall, crept up to it,
     * and only found the way round once it was slow enough for the sums to close.
     * Reported from play exactly so — cars driving into an obstruction and laying
     * siege to it before eventually getting round.
     *
     * AS GENTLE AS THE ROOM ALLOWS, NEVER GENTLER, NEVER HARDER THAN THE TYRES.
     * Inverting the arc gives the acceleration a move of `shift` needs to fit inside
     * `room` at this speed:
     *
     *     room = v · 2·sqrt(shift / a)   →   a = 4 · shift · v² / room²
     *
     * so the rule is one clamp of that between the comfortable rate and the grip
     * share. A rock a hundred metres off at 20 m/s asks for 0.46 and gets the
     * comfortable 0.6; the same rock at fifty asks for 1.9 and gets what the tyres
     * have. It is continuous, which a two-state switch was not: at frantic's speed
     * the comfortable rate needs 3.6 s and 130 m of road while the planning horizon
     * is three seconds of travel, so "comfortable unless it is an emergency" left the
     * fast driver with no reachable line at all — the very defect above, one speed
     * band higher up.
     *
     * The reference shift is a lane's worth rather than the line the planner has not
     * proposed yet; being a little conservative here asks for a slightly brisker rate
     * than the real shift needs, and the trigger in `commitLane` uses the real one.
     *
     * AND THE DEADLINE IS SET BY CLOSING SPEED, NOT BY THE SPEEDOMETER. A rock is
     * arriving at the speed the car is doing; a car in the lane ahead is arriving at
     * the DIFFERENCE, which behind a leader four metres a second slower is a sixth of
     * it. Priced on the speedometer, a forty-metre gap to a moving leader asked for
     * 4.5 m/s² — the whole grip share — so an overtake was steered like an escape and,
     * worse, the trigger in `commitLane` sized on that rate fired sixty-odd metres
     * back. Reported from play: on a two-lane road the pass starts a long way behind
     * the car it is passing, with none of the closing-up that was asked for.
     */
    const laneBlockClosing = Math.max(
      speed - Math.max(0, this.corridorLaneBlockSpeed),
      MIN_CLOSING_MPS,
    );
    const moveClosing = this.corridorLaneBlockDistance <= this.hazardDistance
      ? laneBlockClosing
      : speed;
    const moveRoom = Math.min(this.corridorLaneBlockDistance, this.hazardDistance);
    const neededLateralAccel =
      moveRoom > 0.5 && moveRoom < Number.POSITIVE_INFINITY
        ? (4 * LANE_SHIFT_REFERENCE_M * moveClosing * moveClosing) / (moveRoom * moveRoom)
        : 0;
    const lineAccel = this.corridorFeasible
      ? clamp(
          neededLateralAccel,
          Math.min(manoeuvreLateralAccel, LANE_CHANGE_LATERAL_ACCEL),
          manoeuvreLateralAccel,
        )
      : manoeuvreLateralAccel;
    /**
     * AND WHETHER IT IS ENTITLED TO LEAVE ITS LANE AT ALL. See `lateralFreedom`.
     *
     * Crossing the crown is `overtakes` and only on a road that has one lane each way;
     * a lane change for pace is `lanePasses`. Getting round something STOPPED is
     * everybody's right, a manoeuvre already latched keeps what it was granted, and a
     * driver with no feasible corridor is not choosing between lanes at all.
     */
    const entitledToLeaveLane =
      config.lanePasses ||
      (lanesPerSide === 1 && config.overtakes) ||
      ownLaneObstructed ||
      this.detouring ||
      !this.corridorFeasible;
    const lateralFreedom = entitledToLeaveLane
      ? Number.POSITIVE_INFINITY
      : Math.max(LANE_KEEP_FREEDOM_M, Math.abs(projection.lateral - ownLaneOffset));
    const oncomingLine = -ownLaneOffset;
    // THE CROWN IS FOR A ROAD THAT HAS NOTHING ELSE TO OFFER.
    //
    // Two permissions, in order of how much they cost when they are wrong:
    //
    //   1. A SECOND LANE ON THIS SIDE MAKES THE CROWN POINTLESS. Overtaking and
    //      getting round a wreck are both done within the driver's own carriageway
    //      when one exists, so on a dual carriageway nobody crosses at all. Measured
    //      on the real road before this rule: 10.6% of all car-time was spent past
    //      the centreline, and every single contact in the run was an opposing pair
    //      that had both left their lanes and met.
    //   2. On a single-lane road the crown is the only way past anything, so it stays
    //      available — under the gate in `planCorridor`, which now prices the
    //      manoeuvre at the speed it will actually be driven.
    let stillBlocker = this.hazardDistance < horizon || this.leadIsParked;
    // Clearing a prop with the body does not clear the lane being bypassed. In
    // particular a non-overtaking driver still needs permission to FINISH its
    // static bypass, rather than being forced back across that same prop as soon
    // as its current-lateral hazard scan goes clear.
    for (const obstacle of obstacles) {
      if (
        !obstacle.movable && !obstacle.abeam && obstacle.s >= 0 && obstacle.s < horizon &&
        Math.abs(obstacle.lateral - ownLaneOffset) < obstacle.halfWidth + CAR_HALF_WIDTH_M
      ) {
        stillBlocker = true;
        break;
      }
    }
    // WHAT A DISCRETIONARY OVERTAKE HAS TO PROVE ABOUT THE LANE IT BORROWS.
    //
    // A pass at road speed commits to a long stretch of the opposing lane — up to
    // `PASS_MAX_METRES` — while the decision used to be taken on the three seconds of
    // corridor the planner prices. Measured on seed 1337, from the trace of an ego
    // contact: out at 74 km/h with "gap29 blk-", 28 m later "blk57 NOWAY" as the prop
    // in the borrowed lane arrived, braked 74 -> 4 km/h, hit it, and stood for 44.9 s.
    // Six seconds of travel is the window the pass rule already asks its sight to
    // cover (`PASS_SIGHT_CAP_S`), floored so even a slow car proves a real length of
    // road and capped at the longest pass that may be committed to at all.
    //
    // IT IS ONLY ASKED OF A DISCRETIONARY PASS, and the two cases that taught that are
    // both measured:
    //
    //   - a driver with NO feasible corridor is not choosing between lines, it is
    //     choosing between the opposing lane and standing still. Asking it for proof
    //     turned a bottleneck into a permanent queue: two of the four longest stops on
    //     seed 1337 were cars with `no corridor` and `may cross false`, 80.1 s and
    //     90.5 s;
    //   - going round something STOPPED already proves its own line with a probe over
    //     `BLOCKER_BYPASS_CLEAR_M`, and a littered road always has another prop in the
    //     window beyond the one being passed. Asking for that window measured as the
    //     car giving up the road entirely: on the autopilot bench a right-edge trunk
    //     that is meant to be cleared on the asphalt was crept past at 1.6 m/s with
    //     the body 5.4 m off the centreline, out in the sand.
    const crossingCommitM = clamp(
      speed * PASS_SIGHT_CAP_S,
      PASS_MIN_METRES + PASS_CLEAR_M,
      PASS_MAX_METRES,
    );
    // AND IT MUST BE ROAD THE DRIVER CAN SEE.
    //
    // Road design has one rule about overtaking and this is it: a driver may use the
    // opposing lane only over a stretch it has sight of, because everything the
    // manoeuvre assumes about that lane is an observation and an observation needs a
    // line of sight. `sightDistanceAt` is a march over the road's own vertical
    // profile, so a blind crest now closes the crown the way it closes it in reality —
    // measured on seed 1337, a third of the road has under 150 m of sight, and before
    // this the driver borrowed that lane exactly as confidently as it borrowed a
    // straight one. The requirement is the same stretch the crossing commits to, not
    // the full design figure: the gate below still prices the oncoming traffic it can
    // actually see, and asking for a textbook 580 m on a road whose corners are 90 m
    // would simply forbid overtaking everywhere.
    const mayCrossCrown =
      this.passingEnabled &&
      lanesPerSide === 1 &&
      this.travelled >= this.crossingBarredUntil &&
      (config.overtakes || stillBlocker) &&
      (stillBlocker ||
        !this.corridorFeasible ||
        (this.crossingLineClear(oncomingLine, 0, crossingCommitM) &&
          this.road.sightDistanceAt(this.hintS, crossingCommitM) >= crossingCommitM));
    if (mayCrossCrown) this.laneCentres.push(oncomingLine);
    // HOW FAR AWAY IS SOMETHING COMING THE OTHER WAY, AND HOW FAST IS IT REALLY?
    //
    // The gate that decides a crossing needs both, and until the field existed the
    // second was a CONSTANT: every opposing car was assumed to be doing 20 m/s. That
    // assumption is what locks a shared bottleneck. Two queues meet at a single-file
    // gap, both are stationary, and each driver prices the room it needs against a
    // 72 km/h closing speed that does not exist — so both refuse, for as long as they
    // are there. Measured on seed 1337 at s 40 000: an 80.1 s stop for one car and a
    // 90.5 s stop for another, both with `no corridor` and the way past open.
    //
    // The field carries the truth, for every car and for the player, without a ray:
    // the nearest body in the opposing lane and the speed it is actually doing along
    // this driver's direction (negative when it is coming at us). The probe stays as
    // the second opinion — it sees debris and anything the coordinator does not know
    // about — and the shorter of the two answers wins.
    this.oncomingScanLine = oncomingLine;
    this.oncomingFieldGap = Infinity;
    this.oncomingFieldSpeed = 0;
    this.trafficField?.forEachNear(horizon, 0, this.visitOncoming);
    const crossingOncomingGap = Math.min(
      this.oncomingGap,
      this.oncomingFieldGap,
      this.laneProbe(vehicle, oncomingLine, horizon, originX, originZ),
    );
    // What that gap is closing at. An opposing car that has stopped closes at nothing,
    // and a driver may then take as long over the manoeuvre as the obstruction needs.
    const crossingOncomingSpeed =
      this.oncomingFieldGap < Infinity
        ? Math.max(0, -this.oncomingFieldSpeed)
        : ONCOMING_ASSUMED_MPS;
    // WHAT IS BEHIND ME IN THAT LANE, AND IS IT COMING?
    //
    // The rule exists to stop a driver pulling out in front of something already
    // overtaking. A car that is STANDING there is not that, and reading it as one is
    // how two queues lock each other out permanently: our stopped queue blocks the
    // road, the opposing queue stops beside it, every driver's rearward probe on the
    // crown finds a stationary bumper within twenty metres, and the crossing that
    // would clear the obstruction is refused on both sides for good. Measured on the
    // real road: a four-minute standstill with the way past open the whole time.
    const rearProbe = this.laneProbe(
      vehicle,
      oncomingLine,
      ONCOMING_REAR_GAP_M,
      originX,
      originZ,
      -1,
    );
    const crossingRearClear =
      rearProbe >= ONCOMING_REAR_GAP_M || Math.abs(this.probeHitSpeed) <= CRAWL_SPEED_MPS;
    this.lastOncomingGap = crossingOncomingGap;
    this.lastRearClear = crossingRearClear;
    this.lastMayCross = mayCrossCrown;
    const corridorRequest = {
      ownLateral: projection.lateral,
      previousLine: this.planLine,
      laneOffset: ownLaneOffset,
      speed,
      desiredSpeed,
      halfWidth: CAR_HALF_WIDTH_M,
      horizon,
      // The road a lateral move costs, in the planner's own words: it is given the
      // acceleration budget and works the distance out from the arc. A stopped car
      // needs almost none of it, which is what the old slope needed a standstill
      // exception for — without it, a stopped car computed that reaching the shoulder
      // cost thirty metres it could not cover, called every corridor blocked and
      // waited for good. Seen in play: a queue stopped at a rock with nobody going
      // round it, the player's car at the back of it, indefinitely.
      lineAccel,
      laneCentres: this.laneCentres,
      oncomingBoundary: 0,
      asphaltLimit: this.asphaltHalfWidth,
      edgeLimit: staticAvoidLine,
      lateralFreedom,
      mayCrossCrown,
      lineAllowed: this.lineEntryAllowed,
      // The mode's whole appetite for the opposing lane, in one number — and a
      // dearer one for a driver that is only there because something is parked in
      // its way, so it prefers the shoulder and its own lane while either works.
      oncomingLaneCost: config.overtakes
        ? ONCOMING_LANE_COST * config.passNerve
        : ONCOMING_LANE_COST * STILL_BYPASS_NERVE,
      oncomingGap: crossingOncomingGap,
      oncomingSpeed: crossingOncomingSpeed,
      // THE SPEED THE CAR WILL REALLY BE DOING WHILE IT IS OUT THERE.
      //
      // The gate used to size the manoeuvre on the driver's DESIRED speed, and the
      // speed plan then eased past the stopped thing at walking pace: a crossing
      // committed to as a three-second move took fifteen, and the oncoming car it had
      // measured 150 m of room against arrived halfway through. Every head-on contact
      // in the real-road bench was this, in both directions at once.
      manoeuvreFloorSpeed: AVOIDANCE_CRAWL_MPS,
      crossingSpeed,
      // Nothing already coming up the opposing lane behind us: the search only ever
      // looks forward, so this is the one rearward fact it needs.
      crossingRearClear: crossingRearClear,
      stopRoom: MUST_STOP_GAP_M + (speed * speed) / (2 * obstacleBrakeAccel),
      obstacles,
    };
    const proposal = planCorridor(corridorRequest);
    // EVERYBODY SEES THE LOG, NOT ONLY THE LANE IT IS LYING IN.
    //
    // Indexed hazards are in the ROAD frame, so a driver in the clear lane already
    // knows the next lane is blocked and which car is going to have to come across.
    // Nothing was done with that: the blocked driver asked for a lane that was full,
    // was refused by the abeam veto, and queued at the obstruction while a perfectly
    // ordinary gap went past beside it.
    //
    // A driver that is not the one in trouble lifts off and lets it in. It costs the
    // one that yields a few seconds; it is what makes the obstruction cost the ROAD a
    // few seconds instead of a queue. Deliberately one-sided: only the clear lane
    // yields, so two drivers cannot both wait for each other.
    //
    // A LANE THAT ENDS IS THE SAME SITUATION, and it was the one case nobody yielded
    // for. A taper is not an obstacle, so the wall loop below could never see it, and
    // the drivers whose lane survives — the quick ones, sorted into the lane beside
    // the crown — held their pace while the outer lane emptied itself into them.
    // Reported from play as the four-to-two transition being untidy. The road says
    // which lane ends and it says so a taper's warning ahead, which is the same
    // question `homeLane` above already asked.
    let mergeYieldSpeed = Number.POSITIVE_INFINITY;
    if (lanesPerSide > 1) {
      const laneEndsAhead = lanesAhead < lanesPerSide;
      for (const neighbour of obstacles) {
        if (!neighbour.abeam) continue;
        // Somebody in another lane, level with this car — and on OUR side of the crown,
        // or an oncoming car in its own outer lane reads as a neighbour about to merge
        // into us.
        if (neighbour.lateral * ownLaneOffset <= 0) continue;
        if (Math.abs(neighbour.lateral - ownLaneOffset) < CAR_HALF_WIDTH_M * 2) continue;
        // And OUTSIDE it, so the lane that is about to go is theirs and not ours.
        if (laneEndsAhead && Math.abs(neighbour.lateral) > Math.abs(ownLaneOffset)) {
          mergeYieldSpeed = Math.min(
            mergeYieldSpeed,
            Math.max(AVOIDANCE_CRAWL_MPS, neighbour.speed - MERGE_YIELD_MARGIN_MPS),
          );
        }
        for (const wall of obstacles) {
          if (wall.abeam || wall.movable || wall.s < 0 || wall.s > MERGE_YIELD_LOOKAHEAD_M) continue;
          if (Math.abs(wall.lateral - neighbour.lateral) >= wall.halfWidth + CAR_HALF_WIDTH_M) continue;
          // Their lane ends at that thing and ours does not. Open the gap.
          mergeYieldSpeed = Math.min(
            mergeYieldSpeed,
            Math.max(AVOIDANCE_CRAWL_MPS, neighbour.speed - MERGE_YIELD_MARGIN_MPS),
          );
        }
      }
    }
    // The manoeuvre decides the line; the search offers only a proposal to it, and the
    // commitment it hands back is what the car actually steers to. See `commitLane`.
    const committedLine = this.commitLane(
      proposal.line,
      projection.lateral,
      ownLaneOffset,
      this.hintS,
      proposal.laneBlockDistance,
      proposal.laneBlockSpeed,
      desiredSpeed,
      speed,
      lineAccel,
      proposal.crossingRefused || !mayCrossCrown,
      staticAvoidLine,
    );
    // An escape that has already failed here is allowed off the asphalt, a rung at a
    // time: the ordinary clamp is the asphalt, which is also the width the thing it
    // is escaping blocks. See RECOVERY_BIAS_STEP_M.
    const recoveryLineLimit =
      offRoadRecoveryLine + this.recoveryEscalation * RECOVERY_BIAS_STEP_M;
    let desiredLine = offRoad
      ? Math.abs(projection.lateral) <= offRoadRejoinLateral
        ? this.roadRecoveryTargetLine
        : Math.sign(projection.lateral || 1) * offRoadRecoveryLine
      : recovering || this.travelled < this.recoveryBiasUntil
        ? clamp(ownLaneOffset + this.recoveryBias, -recoveryLineLimit, recoveryLineLimit)
        : committedLine;
    // Recovery retains its existing verge allowance, but never bypasses traffic
    // entry constraints. Evaluate whichever override will actually steer the car.
    if (offRoad || recovering || this.travelled < this.recoveryBiasUntil) {
      corridorRequest.edgeLimit = Math.max(staticAvoidLine, recoveryLineLimit, Math.abs(desiredLine));
      corridorRequest.lateralFreedom = Number.POSITIVE_INFINITY;
    }
    // Reconcile the commitment/override once. Both it and the search proposal
    // already carry the speed cap used to admit their crossing window.
    let plan = evaluateCorridorLine(corridorRequest, desiredLine);
    if (!plan.admissible || (!plan.feasible && proposal.admissible && proposal.feasible)) {
      this.detouring = false;
      plan = proposal;
      desiredLine = plan.line;
    }
    if (!plan.admissible) {
      this.appliedLateral = projection.lateral;
      this.lineSlewRate = 0;
    }
    this.planLine = desiredLine;
    this.manoeuvreSpeedValue = plan.manoeuvreSpeed;
    // YIELDING IS A STATE WITH ITS OWN PATIENCE.
    //
    // A driver held at an obstruction by oncoming traffic has somewhere to go and is
    // simply not going yet, so none of the stuck machinery may touch it. That
    // patience is bounded all the same: if the road never clears — two queues facing
    // each other across the same wreck, say — the wait has to expire and become an
    // ordinary standoff, which the recovery and the coordinator know how to break.
    this.yieldingFor =
      (plan.waitingForOncoming ||
        (desiredLine === proposal.line && proposal.waitingForOncoming)) && !offRoad && !recovering
        ? this.yieldingFor + dt : 0;
    this.yielding = this.yieldingFor > 0 && this.yieldingFor < YIELD_PATIENCE_S;
    this.corridorFeasible = plan.admissible && (plan.feasible || offRoad || recovering);
    this.corridorBlockDistance = plan.blockDistance;
    this.corridorBlockSpeed = plan.blockSpeed;
    this.corridorLaneBlockDistance = plan.laneBlockDistance;
    this.corridorLaneBlockSpeed = plan.laneBlockSpeed;
    // Wanting another lane and not having it yet is the state a driver tucks in from;
    // being out there already is the state it must not lift off in.
    //
    // A pass inside the driver's own carriageway is that same state and used to set
    // neither flag — both of these are about the CROWN, and a lane change never
    // crosses it — so on a four-lane road the kickdown was unreachable by
    // construction, whatever the character of the driver.
    this.passShopping =
      proposal.crossingRefused ||
      plan.usesOncomingLane ||
      (plan.laneBlockSpeed > CRAWL_SPEED_MPS &&
        Math.abs(plan.line - ownLaneOffset) >= DETOUR_MIN_M);
    // Telemetry reads "pass" from where the CAR is, not from where the line points:
    // the planner re-decides every step, so a line that dips across the centre for
    // a moment is not an overtake, and counting those turned a bench's pass counter
    // into a per-frame tally.
    this.planUsesOncomingLane =
      !offRoad &&
      !recovering &&
      plan.usesOncomingLane &&
      (projection.lateral - 0) * Math.sign(ownLaneOffset || -1) < -CAR_HALF_WIDTH_M * 0.5;
    this.planUsesShoulder = !offRoad && !recovering && plan.usesShoulder;
    // Anything the corridor clears by only its hysteresis margin is squeezed past at
    // walking pace rather than at road speed.
    this.corridorSqueezeDistance = Number.POSITIVE_INFINITY;
    for (const obstacle of obstacles) {
      // A car alongside is not a squeeze: it is beside the corridor, not in it, and
      // pricing it here put every driver with a neighbour at walking pace.
      if (obstacle.abeam || obstacle.speed > CRAWL_SPEED_MPS) continue;
      const clearance = Math.abs(obstacle.lateral - plan.line) - obstacle.halfWidth;
      if (clearance < CAR_HALF_WIDTH_M + CORRIDOR_SQUEEZE_M && obstacle.s >= 0) {
        this.corridorSqueezeDistance = Math.min(this.corridorSqueezeDistance, obstacle.s);
      }
    }
    // SIGNAL WHILE THE CAR IS STILL MOVING ACROSS, which is what the commanded line
    // cannot tell us: it reaches the target line long before the body does, so a
    // delta measured against it goes dark in the middle of a lane change. Measured
    // against the BODY, the indicator is on for exactly as long as there is lateral
    // travel left to do. The deadband is wider than a lane-keeping wander so that
    // holding a lane never lights a lamp.
    // AND IT HAS HYSTERESIS, because a lamp is a story told to another driver.
    //
    // One threshold means the indicator follows every wobble of the difference across
    // it: measured on the overtake bench, eighty changes during a single manoeuvre a
    // driver would have signalled twice. Coming on takes a real intention to move; going
    // off takes the move being genuinely finished.
    const indicatorDelta = desiredLine - projection.lateral;
    const indicatorOn = vehicle.indicator !== 'off';
    const threshold = indicatorOn ? INDICATOR_RELEASE_M : INDICATOR_DEADBAND_M;
    vehicle.setIndicator(
      Math.abs(indicatorDelta) < threshold
        ? 'off'
        : indicatorDelta > 0
          ? 'left'
          : 'right',
    );


    // Ease onto the chosen line instead of jumping to it. The waypoint itself is
    // shifted by the rate-limited line, so lane keeping, obstacle avoidance and
    // passing all use one stable controller rather than fighting over the steering.
    // THE LINE HAS AN ACCELERATION BUDGET, NOT A SLOPE, AND THAT IS THE WHOLE
    // DIFFERENCE BETWEEN A LANE CHANGE AND A FLICK OF THE WHEEL.
    //
    // The old limiter moved the line a fixed 0.09 m per metre of road. A slope is a
    // lateral SPEED once the car is moving — 2.7 m/s at 108 km/h — and it was held at
    // full value right up to the target line and then stopped dead. Both ends of that
    // profile are steps in lateral velocity, which is a demand for unbounded lateral
    // acceleration; pure pursuit turned each step into a step in commanded curvature,
    // and the yaw-damping term (`YAW_RATE_DAMPING`, which leads on the difference
    // between commanded and actual yaw) multiplied the first one by about 2.25.
    // Reported from play: an overtaking car cranking the wheel hard enough to nearly
    // throw itself off the road, which no driver does and no driver needs to.
    //
    // So the line is driven like a car instead: a lateral rate that ramps in at `a`,
    // and a target rate of `sqrt(2·a·e)` — the fastest it can still be brought to
    // rest exactly ON the line — which ramps it out again. Peak lateral acceleration
    // is then `a` by construction, and `a` is the same share of the grip budget the
    // speed plan prices the manoeuvre with (`manoeuvreLateralAccel`), so the move,
    // the speed it is taken at, and the road the planner charges it are one decision.
    // A full lane comes out at about 2.3 s, which is a brisk overtaking lane change.
    //
    // TWO FLOORS SURVIVE, and both are deadlock rules rather than comfort ones.
    //
    // A stationary driver turns the wheel before moving off: without a floor on time
    // the line needed two metres of movement to clear a parked car, two metres of line
    // cost 22 m of travel, and the travel was exactly what the line was preventing —
    // measured, the car shuffled backwards and forwards for half a minute.
    //
    // And a pass that has been abandoned leaves the car on the wrong side of the road;
    // braked to walking pace it takes seven seconds of the ordinary rate to get back,
    // which measured as long enough to be hit head-on at 8 km/h by traffic doing 70.
    // When the gap is closing FASTER than the car is moving, the thing ahead is coming
    // at it and clearing the lane stops being a manoeuvre. Where the CAR is, not where
    // its line is: the line is often already home while the body is still out there,
    // which is exactly the dangerous state.
    const onWrongSide =
      projection.lateral * Math.sign(ownLaneOffset || -1) < -CAR_HALF_WIDTH_M * 0.5;
    const headOn =
      (laneGap < Infinity && laneProbeSpeed < -HEAD_ON_MARGIN_MPS) ||
      (bodyLaneGap < Infinity && bodyLaneSpeed < -HEAD_ON_MARGIN_MPS);
    const lineError = desiredLine - this.appliedLateral;
    const lineRateCeiling = Math.max(
      LINE_SHIFT_PER_METRE * speed,
      LINE_SLEW_AT_REST_MPS,
      onWrongSide && headOn ? LINE_SLEW_ESCAPE_MPS : 0,
    );
    const lineRateTarget =
      Math.sign(lineError) *
      Math.min(lineRateCeiling, Math.sqrt(2 * lineAccel * Math.abs(lineError)));
    const lineRateStep = lineAccel * Math.max(dt, 0);
    this.lineSlewRate += clamp(lineRateTarget - this.lineSlewRate, -lineRateStep, lineRateStep);
    // Never past the line: the braking curve above is what makes that possible, and
    // this is what makes a target that jumps to the other side stop the line rather
    // than sail through it while the rate reverses.
    this.appliedLateral += clamp(
      this.lineSlewRate * Math.max(dt, 0),
      Math.min(0, lineError),
      Math.max(0, lineError),
    );
    // Pure pursuit through a point ON the lane still cuts the bend: the chord to a
    // point `d` along an arc of curvature k passes k·d²/8 inside it, which in the
    // 110 m esses is a metre and a half — the car left its lane, and on the real road
    // it was the reason a "careful" mode sat 1.9 m off the centreline on average.
    // Moving the aim point OUTWARD by that sagitta makes the commanded arc the
    // lane's own arc, so the mode follows the corner instead of straightening it.
    // Curvature is taken mid-preview, where the chord error is generated.
    const previewCurvature = this.road.curvatureAt(this.hintS + lookahead * 0.5);
    const chordShift =
      -previewCurvature *
      lookahead *
      lookahead *
      0.125 *
      config.chordGain;
    const lateralLimit = this.planUsesShoulder ? staticAvoidEdge : passingEdge;
    const targetLateral = clamp(
      this.appliedLateral + chordShift,
      -lateralLimit,
      lateralLimit,
    );
    const waypointX = target.x + Math.cos(target.heading) * targetLateral;
    const waypointZ = target.z - Math.sin(target.heading) * targetLateral;
    const relativeX = waypointX - this.position.x;
    const relativeZ = waypointZ - this.position.z;
    // Positive road lateral is the same signed side used by the vehicle's steering
    // input after the vehicle applies its internal steering-angle negation.
    const waypointRight = relativeX * forwardZ - relativeZ * forwardX;
    const waypointDistanceSq = Math.max(
      relativeX * relativeX + relativeZ * relativeZ,
      MIN_PURSUIT_DISTANCE_SQ,
    );
    const pursuitCurvature = (2 * waypointRight) / waypointDistanceSq;
    // HOLDING THE LANE IS A SEPARATE JOB FROM AIMING AT IT.
    //
    // Pure pursuit's cross-track gain is 2/d²: at a 36 m preview, a metre off line
    // asks for 1/650 of curvature — a 0.004 rad wheel angle, which is INSIDE the
    // steering box's own play and is thrown away by the conversion below. Measured on
    // a lap of the test circuit, that left the car sitting 1.1-1.8 m from its lane on
    // straights with the controller commanding nothing at all: the aim point was
    // right, the authority was missing.
    //
    // So cross-track error is fed in as curvature directly, where its gain is a
    // number rather than a consequence of the preview length, and pure pursuit keeps
    // doing what it is good at — previewing the road's own shape.
    const holdDistance = Math.max(LANE_HOLD_MIN_DISTANCE_M, speed * config.holdSeconds);
    const holdCap = Math.min(
      LANE_HOLD_CURVATURE_MAX,
      (config.holdShare * currentLateralAccel) / Math.max(speed * speed, 1),
    );
    const holdCurvature = clamp(
      (2 * (this.appliedLateral - projection.lateral)) / (holdDistance * holdDistance),
      -holdCap,
      holdCap,
    );
    const pathCurvature = pursuitCurvature + holdCurvature;
    // Feed-forward preserves the cornering authority proven by the tyre model. The
    // second term is zero in a settled turn but opposes residual yaw after a lane
    // change, preventing the delayed tyres from amplifying a weave into a spin.
    const actualYawCurvature = vehicle.chassis.angvel().y / Math.max(speed, 3);
    const controlledCurvature =
      pathCurvature * config.steeringGain +
      YAW_RATE_DAMPING * (pathCurvature - actualYawCurvature);
    const wheelAngle = Math.atan(wheelbaseOf(vehicle) * controlledCurvature);
    out.steer = vehicle.steeringInputForWheelAngle(wheelAngle, speed);

    // Build a local speed profile rather than applying one worst bend to the whole
    // horizon. Every sample contributes its surface, decay, grade and curvature;
    // braking distance then propagates that local limit back to the car.
    //
    // `crossingSpeed` ONLY while the plan is actually committed to the other lane.
    // The gate sizes the manoeuvre on that number, so the pedal has to deliver it out
    // there; spending it on the APPROACH as well simply arrives at the back of a queue
    // 4 m/s faster, and the rear-end that follows is what launched bodies below the
    // road in the real-road bench — 65 km/h into a car doing 3.
    const usingPassingLine = plan.admissible &&
      Math.abs(plan.line - ownLaneOffset) >= DETOUR_MIN_M &&
      (plan.usesOncomingLane || (passAttempt && !plan.usesShoulder));
    const clearRoadSpeed = usingPassingLine ? crossingSpeed : desiredSpeed;
    this.passAttemptValue = passAttempt && usingPassingLine;
    // What is left of the cornering budget once a pending lateral manoeuvre has taken
    // its share. A manoeuvre cap below the driver's own pace means that grip is
    // being spent on a pending lateral move rather than entirely on the bend.
    const manoeuvreShare =
      plan.manoeuvreSpeed < desiredSpeed - 0.1 ? 1 - MANOEUVRE_LATERAL_SHARE : 1;
    const turnLookahead = Math.max(
      lookahead,
      config.curveLead +
        config.brakeLead +
        (speed * speed) / (2 * currentBrakeAccel),
    );
    let targetSpeed = clearRoadSpeed;
    let upcomingCurvature = Math.abs(currentRoad.curvature);
    for (let i = 0; i <= ROAD_PROFILE_SAMPLES; i++) {
      const distance = (turnLookahead * i) / ROAD_PROFILE_SAMPLES;
      const sample = i === 0 ? currentRoad : this.road.sampleAt(this.hintS + distance);
      this.road.conditionAt(sample.s, this.condition);
      const surface = this.condition.surface;
      const straightLimit = Math.max(
        OFFROAD_SPEED_MPS,
        clearRoadSpeed * surfacePaceFactor(this.modeValue, this.condition),
      );
      const physicalBrake = vehicle.estimatedBrakeDecel(surface);
      const sampleGradeLoad = Math.min(
        0.8,
        Math.abs(sample.grade * GRAVITY) / Math.max(physicalBrake, 1),
      );
      // ONE SET OF TYRES, TWO DEMANDS ON IT.
      //
      // A bend already spends `v²·curvature` of the lateral budget, and a driver
      // stepping round a log spends its own share on top of that — on the same
      // contact patches, on the same surface, on the same gradient. Left unshared,
      // the corner is planned at the whole budget and the manoeuvre adds forty-five
      // per cent more: a log on a downhill bend is then gone round at the exact speed
      // that leaves the road. So while a lateral manoeuvre is pending, the corner is
      // planned on what is left after the manoeuvre has taken its share.
      //
      // `estimatedLateralAccel` and `sampleGradeLoad` already carry the surface and
      // the gradient, so nothing here needs to know about either.
      const lateralAccel =
        Math.min(
          config.lateralAccel,
          vehicle.estimatedLateralAccel(surface, Math.max(speed, clearRoadSpeed)) *
            LATERAL_GRIP_RESERVE *
            Math.sqrt(Math.max(0.35, 1 - sampleGradeLoad * sampleGradeLoad)),
        ) * manoeuvreShare;
      const curvature = Math.abs(sample.curvature);
      upcomingCurvature = Math.max(upcomingCurvature, curvature);
      // THE CORNER IS BANKED, AND THE BANK IS LATERAL ACCELERATION THE TYRES DO NOT
      // HAVE TO FIND.
      //
      // A cross-slope of `e` contributes `g · e` toward holding the car in the bend —
      // that is the whole reason roads are built with it — so a driver that plans on
      // grip alone leaves it unused and takes a banked corner at the speed of a flat
      // one. `road.bankingAt` is the same function the mesh is tilted from, so there
      // is no way for the two to disagree. It is added rather than multiplied because
      // it is a force from gravity, not more friction, and only its magnitude counts:
      // a corner is banked INTO the bend whichever way the bend goes.
      const bank = Math.abs(this.road.bankingAt(sample.s));
      const localLimit = Math.min(
        straightLimit,
        Math.sqrt((lateralAccel + GRAVITY * bank) / Math.max(curvature, 1e-4)),
      );
      const sampleBrake = Math.max(
        MIN_PLANNED_BRAKE_MPS2,
        Math.min(config.brakeAccel, physicalBrake * BRAKE_GRIP_RESERVE) +
          sample.grade * GRAVITY,
      );
      const brakingDistance =
        Math.max(0, distance - config.curveLead) * BRAKING_DISTANCE_RESERVE;
      targetSpeed = Math.min(
        targetSpeed,
        Math.sqrt(localLimit * localLimit + 2 * sampleBrake * brakingDistance),
      );
    }
    // WHAT THE DRIVER CAN SEE IS NOT YET A SPEED LIMIT HERE, AND THAT IS DELIBERATE.
    //
    // `DriveRoad.sightDistanceAt` exists and is honest — measured on seed 1337, a
    // third of the road has under 150 m of sight and a twentieth under 60 m — and the
    // rule that belongs on it is the one road design is built on: never faster than
    // you can stop in what you can see. It was built and measured, and it is NOT
    // applied, because on this road it buys nothing and costs something:
    //
    //   - nothing, because at the pace the stream actually runs (41-48 km/h) the
    //     stopping distance is inside the available sight almost everywhere: four
    //     seeds of the real-road bench came out identical to the digit with the cap
    //     in and out;
    //   - something, because the profile march is sampled at 10 m and this road's
    //     surface noise makes short false occlusions. Measured on the autopilot
    //     bench: a right-edge trunk that used to be cleared at 9.5 m/s was crept past
    //     at 1.6 m/s, and the wider line that a crawl allows put the body 5.4 m off
    //     the centreline instead of 0.7.
    //
    // It becomes the right rule the moment the road has geometry worth hiding things
    // behind — real crests and bends, with the profile smooth enough that the march
    // measures the crest rather than the gravel. That is the road work, not this file.
    targetSpeed = Math.max(3, targetSpeed);
    // THE SPEED PLAN FOLLOWS THE CORRIDOR THAT WAS CHOSEN, AND NOTHING ELSE.
    //
    // This replaces four overlapping clamps — an approach crawl for a planned prop,
    // a braking envelope for the nearest prop whether or not the line cleared it, a
    // "committed bypass may creep" exception, and a follow rule with its own
    // exceptions for a live pass. Each of them measured a different thing and they
    // contradicted each other: an overtaking car queued behind the car it was
    // overtaking, a littered road crawled at a third of its cruise because the next
    // stone was always inside the envelope of a line that already cleared it, and a
    // car that had stopped could not move because the rule that stopped it was
    // reading the lane it was trying to leave.
    //
    // The limit the ROAD asks for, before anything standing in it is priced. Kept so
    // the pedal section can tell braking for an obstacle from braking for a bend: they
    // are capped differently, and only the former was locking fronts on loose surfaces.
    const roadLimitSpeed = targetSpeed;
    // The speed the way round the obstruction can actually be taken at, and the speed
    // that lets the car beside us come across. Both are braking for something in the
    // way, so they belong on THIS side of `roadLimitSpeed`: the pedal that serves them
    // is the capped obstacle brake, not the mode's full ceiling for a bend.
    targetSpeed = Math.min(targetSpeed, plan.manoeuvreSpeed, mergeYieldSpeed);
    // One question now: what is in the corridor this car is actually going to
    // occupy? A stone the corridor passes is scenery. A car in it is followed. A
    // stopped thing in it is braked to a crawl and then gone round — and once the
    // corridor moves off it, it stops being braked for at all.
    if (this.corridorBlockDistance < Infinity) {
      const room = Math.max(
        0,
        this.corridorBlockDistance -
          (this.corridorBlockSpeed > CRAWL_SPEED_MPS
            ? FOLLOW_STANDOFF_M
            : Math.max(FOLLOW_STANDOFF_M, config.brakeLead)),
      );
      const blockSpeed = Math.max(0, this.corridorBlockSpeed);
      const braking = Math.sqrt(blockSpeed * blockSpeed + 2 * obstacleBrakeAccel * room);
      // Something STILL in the corridor is approached at walking pace, not stopped
      // for: the car is going to ease past it, and a littered road is otherwise a
      // continuous emergency stop — measured at 0.9 m/s against a 30 m/s cruise,
      // with a clear line through the whole field the entire time.
      //
      // BUT THE CRAWL IS FOR EASING PAST, NOT FOR LEANING ON. When the planner has
      // found NO way through, the thing in front is going to be touched at walking
      // pace, and the nose scan cannot prevent it: that scan sees dynamic bodies
      // only, so an indexed rock had nothing at all to stop the car and it crept
      // into it — measured as a 2.9 m/s nose-on contact. With a corridor still
      // available the crawl is exactly right and the field is driven through; with
      // none, the car stops a bumper short and waits for a line to open.
      //
      // AND THE CRAWL IS A CRAWL, not whatever the manoeuvre limit happens to be. This
      // floor used to be the manoeuvre limit, which was always a walking pace whenever
      // anything was being gone round; now that the manoeuvre limit only prices what
      // the commanded line CLEARS, a thing the line does not clear left the floor at
      // the driver's full pace and the clamp did nothing at all. Measured on the
      // boxed-in bench: a car that used to stop 4.2 m short of a rock it could not get
      // round crept into it instead.
      targetSpeed = Math.min(
        targetSpeed,
        blockSpeed > CRAWL_SPEED_MPS
          ? braking
          : !this.corridorFeasible && this.corridorBlockDistance <= STILL_BLOCK_STANDOFF_M
            ? 0
            : Math.max(AVOIDANCE_CRAWL_MPS, braking),
      );
      if (blockSpeed > CRAWL_SPEED_MPS) {
        // Moving: keep a time headway behind it.
        const headwayGap =
          followStandoffM + speed * followHeadwayS;
        targetSpeed = Math.min(
          targetSpeed,
          Math.max(0, blockSpeed + (this.corridorBlockDistance - headwayGap) / FOLLOW_RELAX_S),
        );
      }
    }
    // A LANE CHANGE TAKES THIRTY METRES, AND THE CAR AHEAD IS STILL AHEAD FOR ALL
    // OF THEM. Once the chosen corridor is the opposing lane, the car being passed is
    // no longer in it and stops being braked for — correct once the body is out there,
    // and a rear-end while still crossing: measured as twelve contacts in the dense
    // bench the moment overtakes started working.
    //
    // THE QUESTION IS "WILL I BE CLEAR OF IT BEFORE I REACH IT", NOT "COULD I STOP
    // BEHIND IT", and using the second for the first is what made an overtake hesitate.
    //
    // This branch used to keep a full following headway — a braking envelope onto the
    // leader's speed, plus a comfort gap — for as long as the body was within a car's
    // width of its own lane centre. That width is the right figure for "may I be beside
    // it", but it is reached at about seventy per cent of the way across, so for the
    // last second of every crossing the driver was told to match the speed of the car
    // it was drawing level with. Reported from play on an empty road with an empty
    // opposing lane: the car pulls out, brakes just as it comes level, waits a second,
    // accelerates, and does the same at the next car.
    //
    // The honest constraint is the one the rest of this file already uses: the move has
    // a duration, and the gap has to outlast it. The clearance still missing takes
    // `2·sqrt(left/a)` to produce, so the closing speed that has it finished before the
    // bumpers meet is `gap / that`. It is strict where it matters — mid-crossing, a
    // body width to find and a few metres of gap, closing is held to walking pace —
    // and it opens up exactly as the clearance arrives, which is the manoeuvre the
    // driver is already committed to. The floor at the leader's own speed stays:
    // dropping back is not how a pass starts.
    //
    // No braking envelope here. While the body is still IN its lane the chosen
    // corridor IS that lane, so the ordinary follow rule above owns the case and this
    // one would only be a second copy of it.
    //
    // AND IT COMES BACK THE MOMENT THE LINE DOES. An abandoned crossing leaves the
    // body out in the opposing lane with its commanded line already home and the car
    // it was overtaking still beside it: the clearance deficit is rebuilt from the
    // other side by `appliedLateral`, and the rule returns with it.
    const laneClearanceLeft = Math.max(
      0,
      CAR_HALF_WIDTH_M * 2 -
        Math.min(
          Math.abs(projection.lateral - ownLaneOffset),
          Math.abs(this.appliedLateral - ownLaneOffset) + CAR_HALF_WIDTH_M,
        ),
    );
    if (
      this.corridorLaneBlockDistance < Infinity &&
      // Moving only: a STATIC prop in the lane is what the corridor is going round,
      // and keeping a headway behind it is a crawl that never ends.
      this.corridorLaneBlockSpeed > CRAWL_SPEED_MPS &&
      laneClearanceLeft > 0
    ) {
      const laneSpeed = Math.max(0, this.corridorLaneBlockSpeed);
      const secondsToClear = 2 * Math.sqrt(laneClearanceLeft / Math.max(lineAccel, 1e-3));
      targetSpeed = Math.min(
        targetSpeed,
        Math.max(laneSpeed, laneSpeed + this.corridorLaneBlockDistance / secondsToClear),
      );
    }
    // Easing past something close alongside is done at walking pace even when the
    // corridor clears it: the clearance is centimetres of hysteresis, not a lane.
    if (this.corridorSqueezeDistance < Infinity) {
      targetSpeed = Math.min(
        targetSpeed,
        Math.sqrt(
          AVOIDANCE_CRAWL_MPS * AVOIDANCE_CRAWL_MPS +
            2 *
              obstacleBrakeAccel *
              Math.max(0, this.corridorSqueezeDistance - config.brakeLead),
        ),
      );
    }
    if (!plan.admissible) targetSpeed = 0;
    // Everything priced as being in the way has now been applied. Taken BEFORE the
    // departure limits below, which are a different problem with a different pedal.
    const obstacleLimitSpeed = targetSpeed;
    if (offRoad) targetSpeed = Math.min(targetSpeed, OFFROAD_SPEED_MPS);
    if (edgeStability) targetSpeed = Math.min(targetSpeed, OFFROAD_SPEED_MPS);
    // What the driver WANTED before the bumper veto. A nose scan against scenery is
    // the very situation the stall rule exists for, so it must not be the thing
    // that hides the driver's intent from it.
    const wantedSpeed = targetSpeed;
    this.targetSpeedValue = wantedSpeed;
    if (mustStop) targetSpeed = 0;

    // Asked to give the car in front room to back out: roll back gently, and only
    // while this car's own rear is clear, so the chain unwinds from the end of the
    // queue rather than shoving whoever is last.
    if (this.yieldReverse && this.recoveryPhase === 'none') {
      const rearClear =
        this.axisScan(vehicle, originX, originZ, -1, YIELD_REVERSE_ROOM_M + 2) >
        YIELD_REVERSE_ROOM_M;
      out.throttle = 0;
      out.handbrake = false;
      out.reverse = rearClear && forwardSpeed > -YIELD_REVERSE_MPS;
      out.brake = out.reverse ? RECOVERY_REVERSE_BRAKE * 0.6 : 0.4;
      out.steer = 0;
      this.activityValue = 'recover';
      return;
    }

    // BEING STUCK IS "NO WAY THROUGH", AND THAT IS NOW ONE QUESTION.
    //
    // This used to be four predicates that had each been added the day a specific
    // deadlock was found: an unexplained static stall, a coordinator-granted
    // opposing deadlock, a nose-to-nose standoff in the wrong lane, a standoff
    // against a prop. Every one of them was the same fact seen through a different
    // mode — and each needed its own escape from the guards the others had added.
    //
    // The planner answers it directly: is there ANY reachable corridor without
    // something immovable inside stopping range? If there is not, and the car is
    // covering no ground, it is stuck, whatever the reason. Queueing politely
    // behind moving traffic is feasible by construction, which is what keeps a
    // patient follower out of this branch without a guard for it.
    //
    // Ground covered, rather than the speedometer, remains the evidence: a car
    // pressed into scenery spins its tyres above 1 km/h without going anywhere.
    // Two ways to be stuck, and the second is what covers scenery the planner has
    // never heard of: a pole, an unindexed rock, a fence. Nothing reports
    // them — the rays see only dynamic bodies and the hazard index only props — so
    // the evidence has to be the car's own: it is asking for speed and covering no
    // ground. Queueing behind traffic is not that, because following is what takes
    // the target to zero in the first place.
    const opposingDeadlock = this.deadlockPermission;
    const askingToMove = wantedSpeed > 1;
    // AND WAITING FOR THE ROAD IS NOT BEING STUCK. A driver stopped short of a wreck
    // because something is coming the other way has a plan and is executing it; the
    // only thing missing is a gap, and nothing it does with its own wheels produces
    // one. `yielding` carries its own bounded patience, so a wait that never ends
    // still reaches this branch eventually.
    const stalled =
      vehicle.engineRunning &&
      !this.yielding &&
      (!this.corridorFeasible || askingToMove || opposingDeadlock) &&
      speed < CRAWL_SPEED_MPS;
    const movedFromAnchor = Math.hypot(
      this.position.x - this.stallAnchorX,
      this.position.z - this.stallAnchorZ,
    );
    // Ground covered while asking for speed, and NOTHING else clears it. `stoppedFor`
    // is cancelled by traffic ahead; this is the fact that cancel is allowed to hide
    // only for a while.
    this.groundlessFor =
      askingToMove && speed < CRAWL_SPEED_MPS && movedFromAnchor <= STALL_PROGRESS_M
        ? this.groundlessFor + dt
        : 0;
    if (!stalled) {
      this.stoppedFor = Math.max(0, this.stoppedFor - dt * STALL_DECAY);
      this.stallAnchorX = this.position.x;
      this.stallAnchorZ = this.position.z;
    } else if (movedFromAnchor > STALL_PROGRESS_M) {
      this.stoppedFor = 0;
      this.stallAnchorX = this.position.x;
      this.stallAnchorZ = this.position.z;
    } else {
      this.stoppedFor += dt;
    }
    // TOUCHING IS NOT WEDGED, and the short timer used to treat them as one thing.
    //
    // A car easing past a prop spends SECONDS inside `CONTACT_STUCK_GAP_M` of it —
    // that is what easing past means — and at the crawl the planner asks for there, it
    // covers the `STALL_PROGRESS_M` that would reset the timer in 0.8 s, which is less
    // than the 1 s the contact path allows. Measured on a two-lane prop: the car got
    // itself 0.25 m clear and was rolling at 1.5 m/s when recovery fired at 11.2 s,
    // cancelled the bypass that was working, and escalated from there into the desert.
    // The fast path is for a bumper against something and no ground covered.
    const stuckAfter =
      this.hazardContactDistance <= CONTACT_STUCK_GAP_M && speed < ROLLBACK_MPS
        ? CONTACT_STUCK_AFTER_S
        : STUCK_AFTER_S;

    if (
      stalled &&
      this.recoveryPhase === 'none' &&
      (opposingDeadlock || this.stoppedFor >= stuckAfter)
    ) {
      this.beginRecovery(
        vehicle,
        config,
        projection.lateral,
        originX,
        originZ,
        opposingDeadlock,
        offRoad,
      );
    }
    if (this.recoveryPhase !== 'none') {
      this.activityValue = offRoad ? 'offroad' : 'recover';
      // The indexed prop that triggered recovery is the thing this fixed-lock arc
      // must drive around; treating it as a new stop signal ended the forward leg
      // on its first tick. Dynamic bodies remain a hard guard against pulling into
      // another car.
      this.driveRecovery(
        dt,
        out,
        forwardSpeed,
        projection.lateral,
        this.recoveryCommitted ? Infinity : gap,
        vehicle,
        originX,
        originZ,
      );
      if (!out.reverse && this.bodyScanGap <= CONTACT_STUCK_GAP_M) {
        out.throttle = 0;
        out.brake = Math.max(out.brake, Math.min(config.brakeCeiling, OBSTACLE_BRAKE_MAX));
      }
      return;
    }

    // ROLLING BACKWARDS DOWN A GRADE IS NOT PROGRESS.
    //
    // `speed` is a magnitude, so a car sliding back down an 18% climb reads as one
    // doing 20 km/h and gets coasted while it gathers pace — and pure pursuit,
    // which assumes the car is going the way it is pointing, steers it into the
    // desert. Measured with the traffic on the test circuit: engaged on a hill after
    // rolling back, the car left the road within four seconds every time. Stand on
    // the brake until it is stopped; the wheels are already aimed at the lane for
    // when it is.
    if (forwardSpeed < -ROLLBACK_MPS) {
      out.throttle = 0;
      out.brake = 1;
      out.reverse = false;
      out.handbrake = false;
      this.activityValue = offRoad ? 'offroad' : 'recover';
      return;
    }

    const speedError = targetSpeed - speed;
    out.reverse = false;
    out.handbrake = false;
    // The floor exists to break stiction when a small speed is genuinely wanted. It
    // must not apply when the target is zero: 20% throttle against a stopped car's
    // own brakes is a creep into whatever it stopped for, and it walked the car up to
    // a parked obstacle a metre at a time.
    const floor = targetSpeed > 1 ? THROTTLE_FLOOR : 0;
    out.throttle =
      speedError > 0
        ? clamp(speedError / (offRoad ? OFFROAD_THROTTLE_BAND : config.throttleBand), floor, 1)
        : 0;
    // BRAKING FOR SOMETHING IN THE WAY IS NOT DONE AT FULL PEDAL. The mode's ceiling is
    // a personality and stays the cap for braking at the road itself — a bend, a surface,
    // a limit — but an obstacle gets the mode's ceiling reduced to OBSTACLE_BRAKE_MAX.
    //
    // The mode's own ceiling is NOT lowered: `edgeStability` and the off-road brake below
    // deliberately keep it, because giving up the front on a loose verge is the outcome
    // this cap exists to prevent and those two are the brakes that prevent it.
    // What the tyres have left for stopping once the bend they are in has been paid
    // for. See BEND_BRAKE_SHARE_FLOOR: the lateral demand is the car's OWN yaw rate,
    // against the tyres' own cornering CAPACITY rather than the reserved plan budget.
    const lateralUse = Math.abs(vehicle.chassis.angvel().y) * speed;
    const bendBrakeShare = Math.max(
      BEND_BRAKE_SHARE_FLOOR,
      Math.sqrt(
        Math.max(0, 1 - Math.min(1, (lateralUse / physicalLateralAccel) ** 2)),
      ),
    );
    const brakeCeiling =
      (obstacleLimitSpeed < roadLimitSpeed - BRAKE_LIMIT_EPSILON
        ? Math.min(config.brakeCeiling, OBSTACLE_BRAKE_MAX)
        : config.brakeCeiling) * bendBrakeShare;
    out.brake = speedError < 0 ? clamp(-speedError / config.brakeBand, 0, brakeCeiling) : 0;
    // AN IMMINENT CONTACT IS NOT AN OBSTACLE DECISION, AND IT DOES NOT SHARE ITS PEDAL.
    //
    // `OBSTACLE_BRAKE_MAX` is there because braking hard for everything the planner
    // prices turns a littered road into a series of emergency stops and a frantic
    // driver into 108 steering reversals per kilometre. It is the right cap for a
    // DECISION. It is the wrong cap for a lead car that has just braked hard: the
    // follower is then asked to lose a closing speed it is not allowed to lose.
    // Measured on the real road at seed 7, from the trace: twenty samples of steady
    // `follow gap30@46`, the lead dropping 49 -> 33 -> 13 km/h, and a contact at
    // 10.4 m/s of closing speed with the pedal never past half.
    //
    // Each occupied-line observation brings its own velocity. The keep-alive
    // home-lane leader and the short nose scan are not TTC targets during a pass.
    const laneClosing = Math.max(0, speed - laneProbeSpeed);
    const bodyClosing = Math.max(0, speed - bodyLaneSpeed);
    if (
      (laneGap < Infinity && laneClosing > EMERGENCY_CLOSING_MPS &&
        laneGap - FOLLOW_STANDOFF_M * 0.5 <= laneClosing * EMERGENCY_TTC_S) ||
      (bodyLaneGap < Infinity && bodyClosing > EMERGENCY_CLOSING_MPS &&
        bodyLaneGap - FOLLOW_STANDOFF_M * 0.5 <= bodyClosing * EMERGENCY_TTC_S)
    ) {
      out.throttle = 0;
      out.brake = 1;
    }
    // WAITING IS DONE ON THE BRAKE.
    //
    // A target under walking pace and a car already at it leaves the proportional
    // term commanding a dribble of throttle and no brake at all — which on any grade
    // is a car rolling quietly backwards down the hill it is waiting on, measured as
    // lost road-progress monotonicity on a 5% mean gradient. Below that target it
    // stands on the brake, as a driver does at a stop.
    if (targetSpeed < HOLD_TARGET_MPS && speed < CRAWL_SPEED_MPS) {
      out.throttle = 0;
      out.brake = Math.max(out.brake, HOLD_BRAKE);
    }
    // THE STEERING TERM IS ABOUT A BEND, NOT ABOUT A LANE CHANGE.
    //
    // `out.steer` past a tenth of lock means the tyres are working laterally, which
    // for a corner is the right proxy and for a deliberate lateral move is a
    // double-charge: the speed plan has ALREADY reserved that share of the grip
    // (`MANOEUVRE_LATERAL_SHARE`) before asking for this speed. Reported from play as
    // an overtake with no acceleration in it — and it was literal, the throttle was
    // being closed for the whole crossing, because a lane change sits well past the
    // threshold and `speed >= 0.9 · target` is true the moment a driver at its cruise
    // decides to pass. The line's own rate is what distinguishes the two: a car
    // holding a bend is not moving its line.
    const changingLine = Math.abs(this.lineSlewRate) > 0.05;
    const enteringCurve =
      upcomingCurvature >= TURN_COAST_CURVATURE ||
      (!changingLine && Math.abs(out.steer) >= TURN_COAST_STEER);
    // Coast while HOLDING a bend at its limit, not merely while in one.
    //
    // The gate used to be a fixed 5 m/s: any curve tighter than 250 m, or any steer
    // past 0.12, cut the throttle at every speed above it. The car then coasted down
    // to 5 m/s, got its throttle back, crept over the threshold, and lost it again —
    // stabilising at exactly 18 km/h for the whole corner however fast the corner
    // could actually be taken. Measured on tools/playground-lap.ts: 18 km/h through a
    // 110 m radius whose lateral limit is 85 km/h, and the same rule is what made an
    // obstacle-strewn road crawl at 6 m/s, because avoidance steer sits past 0.12.
    //
    // `targetSpeed` already carries the grip limit (`lateralAccel / curvature`), the
    // grade and every obstacle decision, so it is the honest thing to compare
    // against: no power within a tenth of the limit, full use of the road below it.
    // The floor remains, so a hairpin can always be pulled out of.
    const coastSpeed = Math.max(TURN_COAST_MIN_SPEED_MPS, targetSpeed * 0.9);
    if (!offRoad && speed >= coastSpeed && enteringCurve) {
      out.throttle = 0;
    }
    if (offRoad && speed > OFFROAD_SPEED_MPS) {
      out.throttle = 0;
      out.brake = Math.max(
        out.brake,
        clamp((speed - OFFROAD_SPEED_MPS) / 6, 0.05, OFFROAD_BRAKE_MAX),
      );
    }
    if (edgeStability) {
      out.throttle = 0;
      out.brake = Math.max(
        out.brake,
        clamp(Math.abs(lateralSpeed) / 3, 0.3, config.brakeCeiling),
      );
    }
    if (this.bodyScanGap <= CONTACT_STUCK_GAP_M) {
      out.throttle = 0;
      out.brake = Math.max(out.brake, Math.min(config.brakeCeiling, OBSTACLE_BRAKE_MAX));
    }
    // A DEAD ENGINE IS NOT A DRIVING PROBLEM, AND THE PEDAL DOES NOT FIX IT.
    //
    // `Vehicle.engineRunning` is false while the block is stalled on its own oil film
    // or the fuel has gone. Measured from the reported case: the car had crept up to a
    // mound in its lane, could not plan its way past it, sat there with the throttle at
    // 1.00 until the coolant boiled, and then stood with the pedal still down - an
    // engine that would not restart because nothing let it cool, and a stall rule that
    // does not look at cars whose engine has stopped, so no recovery either. Closing
    // the throttle is what a driver does and what lets the temperature come back.
    if (!vehicle.engineRunning) {
      out.throttle = 0;
      out.brake = Math.max(out.brake, speed < CRAWL_SPEED_MPS ? HOLD_BRAKE : out.brake);
    }
    this.activityValue = offRoad
      ? 'offroad'
      : this.planUsesOncomingLane
        ? 'pass'
        : this.planUsesShoulder
          ? 'avoid'
          : gap < Infinity && targetSpeed < config.cruiseMps - 0.5 && leadSpeed < config.cruiseMps
            ? 'follow'
            : 'cruise';
  }


  /** True while every sampled curvature over `distance` stays under `limit`. */
  private straightAhead(fromS: number, distance: number, limit: number): boolean {
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      if (Math.abs(this.road.curvatureAt(fromS + (distance * i) / steps)) > limit) return false;
    }
    return true;
  }

  /** Surrenders the light switch to the driver until this autopilot is re-engaged. */
  releaseAutomaticHeadlights(): void {
    this.automaticLightsOwned = false;
  }

  private updateAutomaticHeadlights(vehicle: Vehicle): void {
    if (!this.automaticLightsOwned) return;
    if (this.lowBeamsAlwaysOn) {
      vehicle.setHeadlights('low');
      return;
    }
    if (this.automaticLightsOn) {
      if (this.daylightFactor >= AUTO_LIGHTS_OFF_DAY_FACTOR) this.automaticLightsOn = false;
    } else if (this.daylightFactor <= AUTO_LIGHTS_ON_DAY_FACTOR) {
      this.automaticLightsOn = true;
    }
    vehicle.setHeadlights(this.automaticLightsOn ? 'low' : 'off');
  }

  /** Keep blocker memory and parked confirmation, using the observed body's velocity. */
  private updateLead(dt: number, gap: number, speed: number, observedSpeed: number): void {
    if (gap < Infinity) {
      this.dynamicBlockerKnown = true;
      this.dynamicBlockerAnchorX = this.position.x;
      this.dynamicBlockerAnchorZ = this.position.z;
    } else if (
      this.dynamicBlockerKnown &&
      Math.hypot(
        this.position.x - this.dynamicBlockerAnchorX,
        this.position.z - this.dynamicBlockerAnchorZ,
      ) >= DYNAMIC_BLOCKER_CLEAR_M
    ) {
      this.dynamicBlockerKnown = false;
    }
    if (!(gap < Infinity)) {
      this.obstacleGapValue = Infinity;
      this.obstacleSpeedValue = 0;
      this.leadClosingValue = 0;
      this.leadParkedFor = 0;
      return;
    }
    this.obstacleGapValue = gap;
    this.obstacleSpeedValue = observedSpeed;
    this.leadClosingValue = Math.max(0, speed - observedSpeed);
    const approaching = this.leadClosingValue > speed + HEAD_ON_MARGIN_MPS;
    this.leadParkedFor =
      !approaching && this.obstacleSpeedValue < PARKED_SPEED_MPS ? this.leadParkedFor + dt : 0;
  }

  /** True only once the thing in front has been slow for long enough to believe. */
  private get leadIsParked(): boolean {
    return this.leadParkedFor >= PARKED_CONFIRM_S;
  }

  /**
   * Enters the reverse (or pull-out) phase.
   *
   * EVERY ESCAPE GOES TO THE DRIVER'S RIGHT. The side used to alternate — a search
   * for room when nothing was known about the blockage — and its second attempt
   * aimed at the ONCOMING lane: two opposing queues then pulled out into each other
   * and neither could finish. Left is kept for the one case where it is the way back
   * onto the road: a car already past its own right-hand edge. Attempts at the same
   * place stay bounded for generic stalls, so rough ground cannot make a car reverse
   * indefinitely; a known roadblock or a granted deadlock retries without limit.
   *
   * THE SIDE NEVER CHANGES; THE SIZE DOES. An attempt that follows a failed one at the
   * same place goes a rung further out — see RECOVERY_ESCALATION_MAX — because the
   * thing that kept cars standing at an obstacle was not the number of tries, it was
   * that every try was the same try.
   */
  private beginRecovery(
    vehicle: Vehicle,
    config: ModeConfig,
    lateral: number,
    originX: number,
    originZ: number,
    committedDeadlock: boolean,
    /** Was the car off the asphalt when it wedged? Changes what ends the pull-out. */
    wedgedOffRoad: boolean,
  ): void {
    this.recoveryOffRoad = wedgedOffRoad;
    // A pole on the verge does not get bored. Giving up after the attempt limit put
    // the car straight back to full throttle against whatever it was leaning on, so
    // a wedge off the asphalt retries for as long as it takes, exactly like an
    // opposing-queue deadlock does.
    // "No way through" is also a thing that does not get bored: giving up on it
    // after the attempt limit leaves the car parked against it for good. The
    // planner's own verdict is the test.
    //
    // AND NEITHER DOES A ROCK THE BODY IS ACTUALLY TOUCHING. The attempt limit was
    // written for the case where nothing is known — a weak climb, loose ground, where
    // a car that keeps trying digs itself in. A prop in the hazard index that the
    // bodies overlap is the opposite: there is nothing to dig into and the only way
    // out is a manoeuvre. Measured on the real road, seed 1337: the ego wedged on a
    // prop whose near edge reads BEHIND it (a wide boulder is `s - radius - half
    // length` away, which goes negative once the body is alongside), so the corridor
    // was clear, the driver was not yielding, and `persistentRoadblock` was false —
    // two escapes were spent, the third was barred, and ordinary speed control then
    // held the throttle open against the rock until the coolant hit 125 C and the
    // engine seized. 44.9 s of standstill, of which 17.3 s with a dead engine.
    const persistentRoadblock =
      committedDeadlock ||
      wedgedOffRoad ||
      !this.corridorFeasible ||
      this.hazardContactDistance <= CONTACT_STUCK_GAP_M;
    const samePlace =
      this.travelled - this.lastRecoveryAt < RECOVERY_RETRY_METRES &&
      this.sinceRecovery < RECOVERY_REARM_S;
    if (
      !persistentRoadblock &&
      samePlace &&
      this.recoveryAttempts >= RECOVERY_ATTEMPT_LIMIT
    ) {
      this.stoppedFor = 0;
      return;
    }
    const right = Math.sign(this.road.laneCentreAt(this.hintS, 0) || -1);
    this.recoverySide =
      lateral * right > this.road.halfWidthAt(this.hintS) - CAR_HALF_WIDTH_M ? -right : right;
    this.recoveryAttempts = persistentRoadblock
      ? 0
      : samePlace
        ? this.recoveryAttempts + 1
        : 1;
    // ONE RUNG FURTHER THAN THE ATTEMPT THAT DID NOT WORK. `samePlace` is already the
    // test for "this is the same blockage as last time" — the car has covered less
    // than `RECOVERY_RETRY_METRES` since the last escape and did so recently — so a
    // car that got away and wedged again somewhere else starts from the bottom.
    this.recoveryEscalation = samePlace
      ? Math.min(this.recoveryEscalation + 1, RECOVERY_ESCALATION_MAX)
      : 0;
    this.recoveryLegElapsed = 0;
    this.recoveryLegStalled = 0;
    this.lastRecoveryAt = this.travelled;
    this.sinceRecovery = 0;
    this.stoppedFor = 0;
    this.recoveryCommitted = committedDeadlock;
    // THE ESCAPE LINE IS CHOSEN WHEN THE MANOEUVRE STARTS, NOT WHEN IT ENDS.
    //
    // The commanded line is rate-limited, and near a standstill it moves on TIME
    // (`LINE_SLEW_AT_REST_MPS`) — which is the only reason a stopped car can wind a
    // line out at all. Setting the bias at the end of the pull-out threw that away:
    // for the whole reverse and the whole pull-out the line was dragged back to the
    // lane centre, so the manoeuvre finished aimed at the very prop it had just
    // backed away from, and had to cover the offset from scratch at 0.5 m/s while
    // rolling toward it. Measured on the wedged-on-road bench: the first escape put
    // the car back in its lane 3.4 m short of the prop needing 2.8 m of line, it
    // reached 3.55 of them, wedged a second time, and only the SECOND escape — which
    // inherited the bias from the first — got round. A driver winds the wheel while
    // it is backing up.
    this.recoveryBias =
      this.recoverySide * (RECOVERY_BIAS_M + this.recoveryEscalation * RECOVERY_BIAS_STEP_M);
    this.recoveryBiasUntil = this.travelled + RECOVERY_BIAS_METRES;
    // Reversing into the car behind is worse than the obstacle in front, so a blocked
    // tail skips straight to the pull-out and steers out of the problem instead.
    const rearClear =
      this.axisScan(vehicle, originX, originZ, -1, RECOVERY_REAR_CLEAR_M + 2) >
      RECOVERY_REAR_CLEAR_M;
    this.recoveryPhase = rearClear ? 'reverse' : 'pullout';
    this.recoveryTimer = rearClear
      ? RECOVERY_REVERSE_S + this.recoveryEscalation * RECOVERY_REVERSE_STEP_S
      : RECOVERY_PULLOUT_S + this.recoveryEscalation * RECOVERY_PULLOUT_STEP_S;
  }

  /**
   * Every dynamic body LEVEL WITH THIS ONE, offered to the planner as an abeam
   * obstacle: a direction it may not steer in, priced nowhere.
   *
   * One broad-phase query rather than a ray per lane, and it is deliberately not
   * demand-gated: the danger is not "can I overtake", it is "is the space I am
   * drifting into already taken", and that question is live on every tick of
   * ordinary lane keeping. Positions are resolved in the ROAD's frame, not the
   * car's, so a body angled across the road still reports the lateral it occupies.
   *
   * IT STILL DOES NOT LOOK BEHIND, and that is a measured decision rather than an
   * oversight — see the note in `autopilot_current.md`. A driver that moves into the
   * next lane in front of a faster one is a real collision on the real road, and
   * three ways of refusing it were built and measured: a rearward `laneProbe`, the
   * same as a `level` veto, and this query widened to 50 m behind. None was a net
   * win across seeds, and the two stretches that exercise a second lane at all are
   * the two where cars are thrown into the desert at 150-330 km/h by something under
   * the terrain, which is what the contact count on them is actually counting.
   */
  private collectAbeamNeighbours(
    vehicle: Vehicle,
    originX: number,
    originZ: number,
    roadForwardX: number,
    roadForwardZ: number,
    ownLateral: number,
  ): void {
    if (!this.physics || !this.dynamicProximityShape) return;
    const obstacles = this.corridorObstacles;
    this.rayOrigin.x = this.position.x - originX;
    this.rayOrigin.y = this.position.y;
    this.rayOrigin.z = this.position.z - originZ;
    this.physics.world.intersectionsWithShape(
      this.rayOrigin,
      this.identityRotation,
      this.dynamicProximityShape,
      (collider) => {
        const other = collider.translation();
        const dx = other.x - this.rayOrigin.x;
        const dz = other.z - this.rayOrigin.z;
        const along = dx * roadForwardX + dz * roadForwardZ;
        if (along > ABEAM_AHEAD_M || along < -ABEAM_BEHIND_M) return true;
        // Positive lateral is LEFT of travel (see `Road.offsetPoint`), and the
        // road's own forward vector is what that sign is measured against.
        const across = dx * roadForwardZ - dz * roadForwardX;
        const parent = collider.parent();
        const velocity = parent ? parent.linvel() : { x: 0, y: 0, z: 0 };
        obstacles.push({
          s: 0,
          lateral: ownLateral + across,
          halfWidth: CAR_HALF_WIDTH_M + AVOID_HYSTERESIS_M,
          speed: velocity.x * roadForwardX + velocity.z * roadForwardZ,
          abeam: true,
          level: Math.abs(along) < CAR_HALF_LENGTH_M * 2,
          movable: true,
        });
        return true;
      },
      this.physics.rapier.QueryFilterFlags.ONLY_DYNAMIC,
      undefined,
      undefined,
      vehicle.chassis,
    );
  }
  /**
   * Broad-phase guard for the sensor blind spot created by an angled car or tight
   * bend. Bodies beside or ahead make a blind pull-out unsafe. A body clearly behind
   * is deliberately ignored: it is the waiting queue, and `beginRecovery` uses the
   * rear scan to choose a forward-only escape when that queue leaves no reversing
   * room.
   */
  private dynamicBodyAhead(
    vehicle: Vehicle,
    originX: number,
    originZ: number,
    forwardX: number,
    forwardZ: number,
  ): boolean {
    if (!this.physics || !this.dynamicProximityShape) return false;
    this.rayOrigin.x = this.position.x - originX;
    this.rayOrigin.y = this.position.y;
    this.rayOrigin.z = this.position.z - originZ;
    let found = false;
    this.physics.world.intersectionsWithShape(
      this.rayOrigin,
      this.identityRotation,
      this.dynamicProximityShape,
      (collider) => {
        const other = collider.translation();
        const along =
          (other.x - this.rayOrigin.x) * forwardX +
          (other.z - this.rayOrigin.z) * forwardZ;
        if (along < -CAR_HALF_LENGTH_M) return true;
        found = true;
        return false;
      },
      this.physics.rapier.QueryFilterFlags.ONLY_DYNAMIC,
      undefined,
      undefined,
      vehicle.chassis,
    );
    return found;
  }

  /**
   * The manoeuvre is a deliberate two-point turn. Reverse holds a substantial lock
   * toward `recoverySide`; once the backward roll stops, the forward pull-out holds
   * the opposite lock and follows the nose clear of the obstacle.
   */
  private driveRecovery(
    dt: number,
    out: InputFrame,
    forwardSpeed: number,
    lateral: number,
    gap: number,
    vehicle: Vehicle,
    originX: number,
    originZ: number,
  ): void {
    out.handbrake = false;
    // What this rung of the ladder steers with. Both legs escalate together: the
    // pull-out has to follow the arc the reverse set up.
    const reverseLock = Math.min(
      1,
      RECOVERY_REVERSE_STEER + this.recoveryEscalation * RECOVERY_STEER_STEP,
    );
    const pulloutLock = Math.min(
      1,
      RECOVERY_PULLOUT_STEER + this.recoveryEscalation * RECOVERY_STEER_STEP,
    );
    if (this.recoveryPhase === 'reverse') {
      this.recoveryTimer -= dt;
      this.recoveryLegElapsed += dt;
      out.throttle = 0;
      // In automatic mode, reverse=true selects R at rest and brake becomes reverse
      // throttle on the following tick, so the same pedal stops a car still rolling
      // forward and then backs it up.
      out.brake = RECOVERY_REVERSE_BRAKE;
      out.reverse = true;
      out.steer = clamp(this.recoverySide * reverseLock, -1, 1);
      // A LONGER REVERSE HAS TO BE WATCHED WHILE IT RUNS.
      //
      // At 1.8 s the one-off rear check in `beginRecovery` was the whole story. An
      // escalated leg is long enough for the queue behind to close the space up while
      // the car is still using it, and long enough to spend itself pressed against
      // static scenery no ray reports — a fence, a bank, a pole. The first is
      // answered by re-measuring the room; the second by the car's own evidence,
      // which is that it has selected reverse and is covering no ground. Either way
      // the leg ends and the pull-out — the half that gets the car ROUND the
      // obstacle — starts, rather than the car grinding backwards for five seconds.
      const roomBehind = this.axisScan(vehicle, originX, originZ, -1, RECOVERY_REVERSE_LOOK_M);
      this.recoveryLegStalled =
        this.recoveryLegElapsed > RECOVERY_LEG_GRACE_S &&
        forwardSpeed > -RECOVERY_LEG_CRAWL_MPS
          ? this.recoveryLegStalled + dt
          : 0;
      // The lateral test is "the reverse has taken the car far enough out to steer
      // round what blocked it". A car that was ALREADY out there — wedged on a pole
      // on the verge — satisfies it on the first tick, which ended the reverse
      // before the clutch had taken up and handed straight back to a pull-out that
      // drove into the same pole. Out there the timer owns the phase.
      //
      // The line it is measured against widens with the rung. Held at the verge, the
      // reverse stops inside the width the obstruction blocks, and the pull-out that
      // follows aims back down it: that is the second and third bump the ladder
      // exists to break.
      if (
        this.recoveryTimer <= 0 ||
        roomBehind < RECOVERY_REVERSE_STOP_M ||
        this.recoveryLegStalled > RECOVERY_LEG_STALL_S ||
        (!this.recoveryOffRoad &&
          Math.abs(lateral) >
            this.road.halfWidthAt(this.hintS) +
            PASSING_VERGE_M +
            this.recoveryEscalation * RECOVERY_BIAS_STEP_M)
      ) {
        this.recoveryPhase = 'pullout';
        this.recoveryTimer =
          RECOVERY_PULLOUT_S + this.recoveryEscalation * RECOVERY_PULLOUT_STEP_S;
      }
      return;
    }

    out.reverse = false;
    // Keep the reverse lock while braking the remaining backward roll. Reversing
    // the wheel before the car reverses its travel bends the tail back toward the
    // obstacle and also spends the pull-out timer without moving forward.
    if (forwardSpeed < -0.15) {
      out.steer = clamp(this.recoverySide * reverseLock, -1, 1);
      out.throttle = 0;
      out.brake = 0.5;
      return;
    }

    this.recoveryTimer -= dt;
    out.steer = clamp(-this.recoverySide * pulloutLock, -1, 1);
    out.brake = 0;
    out.throttle = forwardSpeed < RECOVERY_CRAWL_MPS ? 0.55 : 0;
    // The pull-out is what brings a car back from where the reverse put it, so its
    // own end condition cannot be the indexed prop or the line limit the reverse
    // just crossed. Both ended the manoeuvre on its first tick. A dynamic body still
    // stops the arc; otherwise the opposite lock is held for the full pull-out.
    //
    // A wedge that happened OFF the asphalt is already outside that line, so the
    // same test would end the manoeuvre before it moved a metre and hand the car
    // straight back to the throttle that was cooking the engine against a pole.
    // Out there, only the timer and a dynamic body end it.
    const arrived =
      this.recoveryTimer <= 0 ||
      gap < MUST_STOP_GAP_M;
    if (arrived) {
      this.recoveryPhase = 'none';
      this.recoveryOffRoad = false;
      this.recoveryTimer = 0;
      this.stoppedFor = 0;
      this.recoveryCommitted = false;
      // Hold the escape side for the next stretch of road, measured from HERE.
      // Without it the resumed line is the one that was blocked, and the car drives
      // back into the obstacle it just reversed away from — the loop this manoeuvre
      // exists to break. The side itself was committed at `beginRecovery`, so the
      // line has been winding out for the whole manoeuvre rather than starting now.
      this.recoveryBiasUntil = this.travelled + RECOVERY_BIAS_METRES;
    }
  }

  /**
   * Metres of lane the segmented probe can actually examine from `fromS`. A caller
   * that needs more than this has to treat a clear answer as "cannot see".
   */
  private probeReach(fromS: number): number {
    const curvature = Math.max(Math.abs(this.road.curvatureAt(fromS)), 1e-4);
    return PROBE_MAX_SEGMENTS * Math.sqrt((8 * PROBE_CHORD_DEVIATION_M) / curvature);
  }

  /**
   * Distance to the nearest dynamic body in a road lane, metres, or Infinity.
   *
   * The ray follows the lane's chord rather than the car's nose, so it keeps to the
   * road's curve and gradient. See the block comment above `PROBE_HEIGHT_M` for why
   * only dynamic hits count.
   *
   * A CHORD IS ONLY THE LANE WHILE THE BEND IS GENTLE, so the sight is WALKED in
   * segments short enough that each one stays within `PROBE_CHORD_DEVIATION_M` of the
   * lane, and the walk stops at the first dynamic hit. One segment covers a straight;
   * a 170 m look down a 320 m sweeper takes three, and a hairpin takes one per
   * twenty metres.
   *
   * Capping the reach instead was tried, and it silently forbade every fast overtake:
   * a single 170 m chord in that sweeper misses the lane by eleven metres, so the cap
   * shortened the answer to 71 m, and the pass rule — which must not commit to sight
   * it does not have — refused. Before the cap existed, the same probe left the road
   * in the 110 m esses and found a car on the far side of the lap: a body at a fixed
   * distance in a place the car will never reach, which reads as a PARKED obstacle
   * and had sleeper hopping onto the verge thirteen times a lap to pass nothing.
   */
  private laneProbe(
    vehicle: Vehicle,
    lane: number,
    sight: number,
    originX: number,
    originZ: number,
    facing: 1 | -1 = 1,
  ): number {
    this.probeHitSpeed = 0;
    if (!this.physics) return Infinity;
    // The ray must not find the car casting it.
    const body = vehicle.chassis;
    const fromS = this.hintS + facing * PROBE_START_M;
    const curvature = Math.max(Math.abs(this.road.curvatureAt(fromS)), 1e-4);
    const maxChord = Math.sqrt((8 * PROBE_CHORD_DEVIATION_M) / curvature);
    const segments = Math.min(PROBE_MAX_SEGMENTS, Math.max(1, Math.ceil(sight / maxChord)));
    const segment = sight / segments;
    let nearest = Infinity;
    // Centre and edge rays cover both narrow cars and wider catalogue bodies.
    // Pass abort hysteresis prevents the centre ray briefly reacquiring the car
    // alongside from being mistaken for a new stationary obstruction.
    for (let side = -1; side <= 1; side++) {
      const offset = lane + side * PROBE_HALF_WIDTH_M;
      for (let step = 0; step < segments; step++) {
        const start = fromS + facing * step * segment;
        this.road.offsetPoint(start, offset, this.probeNear);
        this.road.offsetPoint(start + facing * segment, offset, this.probeFar);
        const dx = this.probeFar.x - this.probeNear.x;
        const dy = this.probeFar.y - this.probeNear.y;
        const dz = this.probeFar.z - this.probeNear.z;
        const length = Math.hypot(dx, dy, dz);
        if (length < 1) continue;
        // Position is durable absolute state; only the ray passed to Rapier is relative.
        this.rayOrigin.x = this.probeNear.x - originX;
        this.rayOrigin.y = this.probeNear.y + PROBE_HEIGHT_M;
        this.rayOrigin.z = this.probeNear.z - originZ;
        this.rayDirection.x = dx / length;
        this.rayDirection.y = dy / length;
        this.rayDirection.z = dz / length;
        const hit = this.physics.raycast(this.rayOrigin, this.rayDirection, length, body);
        if (!hit) continue;
        const collider = this.physics.world.getCollider(hit.colliderHandle);
        // A static first hit ends this segment's line of sight, and the walk with it:
        // whatever is beyond a crest or a rock is not visible from here.
        if (!collider?.parent()?.isDynamic()) break;
        // Chord metres are shorter than road metres in a bend; report road metres,
        // measured from the car rather than from where the probe starts.
        const along = PROBE_START_M + step * segment + (hit.toi * segment) / length;
        if (along < nearest) {
          nearest = along;
          const otherVelocity = collider.parent()!.linvel();
          const road = this.road.sampleAt(this.hintS + facing * along);
          this.probeHitSpeed =
            otherVelocity.x * Math.sin(road.heading) + otherVelocity.z * Math.cos(road.heading);
        }
        break;
      }
    }
    return nearest;
  }

  /**
   * Scan straight off the nose (`facing` 1) or the tail (-1), in the CAR's frame:
   * valid even when the car is spun round or off the road, which is exactly when the
   * road-frame lane probe is not.
   */
  private axisScan(
    vehicle: Vehicle,
    originX: number,
    originZ: number,
    facing: number,
    range: number,
  ): number {
    this.probeHitSpeed = 0;
    if (!this.physics) return Infinity;
    const body = vehicle.chassis;
    const r = body.rotation();
    const forwardX = facing * 2 * (r.x * r.z + r.w * r.y);
    const forwardZ = facing * (1 - 2 * (r.x * r.x + r.y * r.y));
    let nearest = Infinity;
    for (let lateral = -0.32; lateral <= 0.32; lateral += 0.32) {
      // Position is durable absolute state; only the ray passed to Rapier is relative.
      this.rayOrigin.x = this.position.x - originX + forwardX * 1.5 - forwardZ * lateral;
      this.rayOrigin.y = this.position.y + 0.55;
      this.rayOrigin.z = this.position.z - originZ + forwardZ * 1.5 + forwardX * lateral;
      this.rayDirection.x = forwardX;
      this.rayDirection.y = 0;
      this.rayDirection.z = forwardZ;
      const hit = this.physics.raycast(this.rayOrigin, this.rayDirection, range, body);
      const collider = hit ? this.physics.world.getCollider(hit.colliderHandle) : null;
      const other = collider?.parent();
      // Fixed scenery participates only at actual nose-contact range. Farther
      // props belong to indexed planning; rearward recovery stays dynamic-only.
      if (hit && collider && hit.toi < nearest &&
        (other?.isDynamic() ||
          (facing > 0 && (!other || other.isFixed()) && hit.toi <= CONTACT_STUCK_GAP_M))) {
        nearest = hit.toi;
        if (other?.isDynamic()) {
          const velocity = other.linvel();
          const road = this.road.sampleAt(this.hintS);
          this.probeHitSpeed = velocity.x * Math.sin(road.heading) + velocity.z * Math.cos(road.heading);
        } else {
          this.probeHitSpeed = 0;
        }
      }
    }
    return nearest;
  }
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function wheelbaseOf(vehicle: Vehicle): number {
  let frontZ = -Infinity;
  let rearZ = Infinity;
  for (const wheel of vehicle.modelMeasure.wheels) {
    if (wheel.isFront) frontZ = Math.max(frontZ, wheel.pos[2]);
    else rearZ = Math.min(rearZ, wheel.pos[2]);
  }
  return Number.isFinite(frontZ) && Number.isFinite(rearZ)
    ? Math.max(frontZ - rearZ, 1.5)
    : DEFAULT_WHEELBASE_M;
}
