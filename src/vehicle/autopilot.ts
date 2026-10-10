/** Fixed-step road follower. Inputs remain ordinary InputFrame commands. */
import type { InputFrame } from '../core/input';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../core/physics';
import { SurfaceType } from '../core/surfaces';
import type { RoadConditionBuffer } from '../world/gradient';
import { type DriveRoad } from '../world/road';
import { type HazardField, type RoadHazard } from '../world/hazards';
import { shoulderWidthM } from '../world/roadprofile';
import type { Vehicle } from './vehicle';
import { evaluateCorridorLine, planCorridor, type CorridorObstacle } from './corridor';
import {
  classifyManoeuvre,
  isPass,
  LimitArbiter,
  type Manoeuvre,
  type SpeedLimitSource,
  type ThrottleLimitSource,
} from './manoeuvre';
import { LateralCommitment, type LateralKind } from './lateral';
import type { TrafficField, TrafficNeighbour } from './trafficfield';
import { RacingLine, type RacingLineBand } from './racingline';
import { shouldShelter } from './weatherpace';

/**
 * How far ahead the corridor is planned: three seconds of travel, bounded so a
 * standstill still looks far enough to plan a way out and a fast car does not pay
 * for sight no probe can supply.
 */
const CORRIDOR_HORIZON_SECONDS = 3;
const CORRIDOR_MIN_HORIZON_M = 60;
const CORRIDOR_MAX_HORIZON_M = 220;
/**
 * THE RACING LINE'S TERMS (see `ModeConfig.racingLine` and `vehicle/racingline.ts`).
 *
 * The window is six seconds of road plus a base, so the line always reaches past the
 * braking zone of the next bend it will have to plan for.
 */
const RACING_WINDOW_SECONDS = 6;
const RACING_WINDOW_BASE_M = 120;
const RACING_WINDOW_MIN_M = 200;
const RACING_WINDOW_MAX_M = 600;
/**
 * Body kept this far inside the asphalt edge, and off the crown when the far half is
 * not free. The edge margin grows with speed by `RACING_EDGE_MARGIN_S`: the line is
 * tracked, not ridden, and the miss grows with speed — measured at 30.85 km, a frantic
 * 2108 at 100 km/h swept 1.4 m past a line laid 0.2 m inside the edge of a 150 m bend
 * and rolled in the desert.
 */
const RACING_EDGE_MARGIN_M = 0.2;
const RACING_EDGE_MARGIN_S = 0.035;
const RACING_CROWN_MARGIN_M = 0.3;
/**
 * THE OTHER HALF OF THE ROAD IS USED ONLY WHERE THE DRIVER CAN VOUCH FOR IT: in
 * sight, clear of anything standing in it, and left again with this many seconds in
 * hand before anything coming the other way could arrive there. Beyond that the line
 * is back on its own side `RACING_CROWN_RETURN_M` before the road it cannot vouch for.
 */
const RACING_ONCOMING_MARGIN_S = 3;
const RACING_CROWN_RETURN_M = 40;
/** Below this there are no lines, only manoeuvres. */
const RACING_MIN_SPEED_MPS = 10;
/** How close to its home lane the planner's own line must be for the racing line to replace it. */
const RACING_HOME_TOLERANCE_M = 0.3;
/** Seconds of plain cruising, in its own lane, before a racing line is taken up again. */
const RACING_REARM_S = 1.5;
/**
 * The racing driver's sight rule: the slowest traffic it expects to find moving, the
 * furthest it looks, and the share of its braking it plans a sighting on.
 */
const RACING_UNSEEN_TRAFFIC_MPS = 12;
const RACING_SIGHT_LIMIT_M = 500;
const RACING_SIGHT_BRAKE_SHARE = 0.4;
/**
 * Cornering load, as a share of the tyres' capacity, below which a racing driver's
 * throttle is not limited at all, and the least it keeps at the limit so a bend still
 * holds its speed. See the friction-circle cap on the pedal.
 */
const RACING_THROTTLE_FREE_SHARE = 0.6;
const RACING_THROTTLE_MIN = 0.12;
/**
 * THE RACING DRIVER'S RIGHT FOOT: OFF FOR A MANOEUVRE, BACK DOWN GENTLY.
 *
 * The friction-circle cap above answers a steady bend, where the yaw rate is the
 * cornering load. It is blind to a TRANSIENT: a lane change at 140 km/h is a quick
 * flick and a flick back, the yaw rate crosses zero between them, and the cap opened
 * to full power right as the rear tyres were swinging the body back. Seen in play as
 * frantic cars sliding out of a pass and swaying for seconds after it.
 *
 * A driver lifts for the flick and feeds the power back as the car settles. Three
 * terms, for `racingLine` modes only:
 *  - the line moving across the road (`lineSlewRate`): zero while the car holds its
 *    lane or its racing line along a straight, 0.4-2.2 m/s through a pass, measured
 *    in the real stream. Past `RACER_LIFT_SLEW_FREE` the foot starts coming off and
 *    by `RACER_LIFT_SLEW_FULL` it is at `RACER_LIFT_MIN`. Steering lock is no measure
 *    at this speed — a pass at 140 km/h is a hundredth of lock;
 *  - the body's sideslip: past `RACER_SLIP_FREE_RAD` the car is no longer going where
 *    it points, and by `RACER_SLIP_LIFT_RAD` the foot is off;
 *  - the pedal comes back at most `RACER_FEED_PER_S` a second, whatever asked for it.
 */
const RACER_LIFT_SLEW_FREE = 0.3;
const RACER_LIFT_SLEW_FULL = 1.5;
const RACER_LIFT_MIN = 0.15;
const RACER_SLIP_FREE_RAD = (1.5 * Math.PI) / 180;
const RACER_SLIP_LIFT_RAD = (4 * Math.PI) / 180;
const RACER_FEED_PER_S = 1.2;
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
/**
 * PASSING SOMETHING STANDING STILL: how close, and how fast.
 *
 * A driver going past a rock keeps a gap that grows with speed, because the car's own
 * wander about its line grows with speed. `PASS_GAP_MIN_M` is the gap a car creeping
 * by keeps; every metre per second adds `PASS_MARGIN_S` of it. The planner is asked for
 * that gap (it inflates each prop by it, see `collectHazard`), and where the road does
 * not have it the car goes by at the speed the gap it does have supports.
 *
 * This replaced a switch: anything cleared by less than 0.6 m beyond the planning
 * margin was passed at walking pace, and the planner — pulled home by its own lane
 * cost — put almost every line exactly on that margin. So every rock on the road was
 * crept past at 3.5 m/s, reported from play as cars braking nearly to a stop for an
 * obstacle they had plenty of room to go round. At 20 m/s the gap asked for is 0.8 m.
 */
const PASS_GAP_MIN_M = 0.3;
const PASS_MARGIN_S = 0.025;

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
   * driver the same 0.50 made the whole ambient stream crawl, because the stream was
   * almost entirely careful drivers (see the traffic driver draw: frantic is rare).
   *
   * So the strict bound is the frantic driver's, and this is the dial that says so. 1
   * spends the surface's whole grip ratio; frantic's 0.7 reproduces the measured grave
   * bound (0.72 x 0.7 = 0.50) for the only character that had earned it.
   */
  readonly looseSurfacePace: number;
  /**
   * Shares of the tyres this driver plans on: of their cornering capacity, of their
   * braking capacity, and of the geometric distance a braking zone needs.
   *
   * The careful drivers keep a reserve on all three — transient load and steering
   * correction below the stable peak, and a braking zone begun at two and a half times
   * the distance it needs, so the bend is set up before it arrives. A racing driver's
   * whole skill is to not keep that reserve: measured on a flat plane, the catalogue
   * cars actually corner at 0.84-1.0 of `estimatedLateralAccel`, so 0.8 of it is the
   * limit less the margin a controller needs to still be steering, not sliding.
   */
  readonly gripReserve: number;
  readonly brakeReserve: number;
  readonly brakingDistanceShare: number;
  /**
   * Drives the least-curved line through a bend (`vehicle/racingline.ts`) instead of
   * the lane's own arc, using the whole asphalt where the opposing half is seen to be
   * clear, and plans a corner's speed on that line's curvature — except a tight bend,
   * which is planned on the road's (`tightBendShare`).
   */
  readonly racingLine: boolean;
  /**
   * Rate, per second, at which a standing curvature shortfall is trimmed out of the
   * steering. The feed-forward (`steeringGain`) is one number for every car and speed;
   * at the limit a car answers the wheel with less yaw than it answered on the way
   * there, and a proportional controller then sits outside its line — measured on the
   * playground's 320 m downhill sweeper at 170 km/h, 0.5 m/s² short and drifting a
   * metre in three seconds until it left the road. The trim integrates commanded minus
   * actual yaw curvature and adds it back, so the line is held at any understeer the
   * car happens to have. Zero is no trim: the careful drivers never go near the limit.
   */
  readonly curvatureTrim: number;
  /**
   * Share of the planned cornering budget a TIGHT bend is taken on: one whose own corner
   * speed is under `TIGHT_BEND_FREE_MPS`, fully so by `TIGHT_BEND_FULL_MPS`. In such a
   * bend the speed is also planned on the ROAD's curvature rather than the racing
   * line's, so the line's extra width is margin, not speed. See `bendSpeed`.
   *
   * 1 is no change, and the careful drivers keep it: their own `lateralAccel` is
   * already well inside the tyres.
   */
  readonly tightBendShare: number;
  /**
   * THE RACER: a driver who breaks every rule of the road and none of physics.
   *
   * The careful drivers overtake the way road design says to: only over road they can
   * see six seconds of, never again for sixty metres after giving a pass up, signalling
   * every move. A racer reads the traffic instead of the rules — the stream tells it
   * exactly where every car is — and sizes each pass on its OWN car: its measured
   * acceleration, the speed the road allows, every car of the queue in front and the
   * first gap in it the car fits. It goes the moment that pass fits before whatever is
   * coming the other way, cuts back in a car length ahead of the one it passed, and
   * re-measures the pass every step: one that stops fitting is given up at once, by
   * dropping back and diving in behind. It does not signal.
   *
   * What it keeps is everything that is not a rule: the tyres' grip, the brakes'
   * reach, the swept-path and abeam vetoes, the emergency reflex, and the rear check
   * that stops it pulling out into somebody already overtaking.
   */
  readonly racer: boolean;
}

/**
 * TWO DRIVERS, NOT ONE WITH A SPEED KNOB.
 *
 * `sleeper` is the character asleep at the wheel of his own life: 80 km/h, its own
 * lane, a cornering budget under half of what the tyres have, gentle pedals, and it
 * `frantic` is somebody out of time who can drive: no cruising speed of its own — the
 * car's power and the road's bends are the only limits — the tyres used to within a
 * fifth of what they have, braking zones begun at the last useful metre, and a racing
 * line through every bend: outside, apex, outside, across the whole road where it can
 * see that the other half is empty. It is a RACER (`ModeConfig.racer`): it takes the
 * oncoming lane the moment a pass measured on its own car fits before whatever is
 * coming, gives it back the moment it stops fitting, and signals nothing at all.
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
    gripReserve: 0.72,
    brakeReserve: 0.82,
    brakingDistanceShare: 0.4,
    racingLine: false,
    curvatureTrim: 0,
    tightBendShare: 1,
    racer: false,
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
    gripReserve: 0.72,
    brakeReserve: 0.82,
    brakingDistanceShare: 0.4,
    racingLine: false,
    curvatureTrim: 0,
    tightBendShare: 1,
    racer: false,
  },
  frantic: {
    // No cruising speed of its own: the car's power runs out first on every straight.
    cruiseMps: 200 / 3.6,
    // No budget of its own either: `gripReserve` of what the tyres have is the limit.
    lateralAccel: 14,
    brakeAccel: 14,
    lookaheadBase: 9,
    lookaheadSpeed: 1.0,
    brakeLead: 7,
    curveLead: 10,
    // A racing driver traces its line; the old half correction clipped every apex.
    chordGain: 0.9,
    steeringGain: 1.45,
    // A line is something it holds, not something it lives near: measured on the
    // playground at the limit, the old 0.85 s over a third of the budget traced the
    // racing line to 0.47 m RMS and 1.64 m at worst; this is 0.31 and 1.24. Tighter
    // still (0.55 s over 0.6) traced it better and set a GAZ-21 weaving at its 130 km/h
    // top speed: the slowest chassis sets the limit, as it does for LANE_HOLD_LEAD_S.
    holdSeconds: 0.62,
    holdShare: 0.55,
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
    // The same share of the tyres as the careful drivers — but of the tyres, not of a
    // budget of its own, which is what frantic's old 6.8 m/s² was: 55% of a rally
    // Zhiguli. 0.76 already left the road on the playground's downhill esses.
    gripReserve: 0.72,
    brakeReserve: 0.9,
    brakingDistanceShare: 0.8,
    racingLine: true,
    curvatureTrim: 1,
    // A TIGHT BEND IS NOT A FAST BEND TAKEN SLOWLY. The racing line's gain is a fifth
    // more speed in a 60 m bend, and it was planned at full value — but the line is
    // laid 0.2 m + 0.035 s·v inside the edge and the car tracks it rather than rides
    // it, so in a bend whose road speed is double digits the line's width was spent on
    // speed and nothing was left for the miss on the exit. Such a bend is now planned
    // toward the road's own curvature and this share of the tyres: by the arithmetic of
    // `bendSpeed`, a bend whose road speed is 80 km/h, which the line (at the measured
    // 0.665 of the road's curvature in racingline.ts) put at about 98, is planned at
    // about 78, and the line's width becomes margin. Sweepers whose road speed is above
    // `TIGHT_BEND_FREE_MPS` are untouched.
    tightBendShare: 0.82,
    racer: true,
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
 * which is the one situation where a driver still has to. The speed plan brakes on the
 * same ellipse (see the profile march in `drive`), so it never plans a braking zone the
 * pedal will then not be allowed to deliver.
 *
 * Deliberately NOT applied to the brakes that exist to prevent a departure
 * (`edgeStability`, the off-road brake) or to the imminent-contact reflex: those are
 * the cases where the tyres are already past their budget and the answer is still the
 * pedal.
 */
const BEND_BRAKE_SHARE_FLOOR = 0.35;
/**
 * Most of the car's weight a crest may take off its wheels at the planned speed: over a
 * vertical curvature `kv` at `v` the tyres carry `g - v²·kv`. The plan never goes faster
 * than leaves this share unloaded, and plans the grip it does use on what is left.
 */
const CREST_UNLOAD_MAX = 0.5;
const GRAVITY = 9.81;
/**
 * Straight-line pace by surface. Personality still sets the absolute speed: the
 * factors describe how much of it the road can support before bumps and loose grip
 * dominate. Decay and drifted sand reduce these further at the sampled location.
 *
 * These are COMFORT factors and nothing else. Every limit that grip actually
 * decides is computed from the real per-surface physics a few lines below — the
 * corner speed from `lateralAccel` against the sampled curvature, the approach from
 * `vehicle.estimatedBrakeDecel(surface)`, both reserved again by each mode's
 * `gripReserve` and `brakeReserve`. So a factor low enough to be a grip
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
/**
 * Road corner speed, m/s, above which a bend is taken on the mode's whole plan and
 * below which `ModeConfig.tightBendShare` fades in, completely by the second figure:
 * 110 and 70 km/h, so a bend whose speed is double digits is a tight one.
 */
const TIGHT_BEND_FREE_MPS = 110 / 3.6;
const TIGHT_BEND_FULL_MPS = 70 / 3.6;
/**
 * THE SPEED A BEND IS PLANNED AT: `tyreLateral` is the share of the tyres this mode
 * corners on (m/s²), `bankLateral` what the cross-slope gives for free, `pathCurvature`
 * the curvature of the line the car will drive and `roadCurvature` the road's own.
 *
 * For a mode whose `tightBendShare` is 1 this is `sqrt(lateral / curvature)` on the
 * path, exactly what it always was. For the racing driver, a bend whose ROAD speed is
 * under `TIGHT_BEND_FREE_MPS` fades from the line's curvature to the road's and from the
 * whole tyre share to `tightBendShare` of it; the bank is gravity, not grip, and is
 * never discounted. Everything is continuous in curvature, so the plan has no step at
 * either threshold.
 *
 * Exported so a car on rails is held to the bend speed its own driver plans on.
 */
export function bendSpeed(
  mode: AutopilotMode,
  tyreLateral: number,
  bankLateral: number,
  pathCurvature: number,
  roadCurvature: number,
): number {
  const share = MODES[mode].tightBendShare;
  if (share >= 1) return Math.sqrt((tyreLateral + bankLateral) / Math.max(pathCurvature, 1e-4));
  const roadSpeed = Math.sqrt((tyreLateral + bankLateral) / Math.max(roadCurvature, 1e-4));
  const tight = clamp(
    (TIGHT_BEND_FREE_MPS - roadSpeed) / (TIGHT_BEND_FREE_MPS - TIGHT_BEND_FULL_MPS),
    0,
    1,
  );
  const curvature = pathCurvature + Math.max(0, roadCurvature - pathCurvature) * tight;
  const lateral = tyreLateral * (1 - (1 - share) * tight) + bankLateral;
  return Math.sqrt(lateral / Math.max(curvature, 1e-4));
}
const MIN_PLANNED_BRAKE_MPS2 = 0.75;
/** Chassis yaw feedback removes weave energy without weakening steady cornering. */
const YAW_RATE_DAMPING = 0.8;
/** Curvature trim bounds and leak, per second; see `ModeConfig.curvatureTrim`. */
const CURVATURE_TRIM_SHARE = 0.4;
const CURVATURE_TRIM_FLOOR = 0.0015;
const CURVATURE_TRIM_LEAK = 0.3;
/**
 * Half the widest catalogue body, metres, plus a little. Used only to decide whether
 * a hazard is in this car's corridor; a per-model figure would make the decision
 * differ between cars for no gain, and being slightly pessimistic is free.
 */
const CAR_HALF_WIDTH_M = 1.05;
/** Asphalt left between a sheltering car's flank and the road edge, metres. */
const SHELTER_EDGE_MARGIN_M = 0.3;
/** A sheltering car is at the edge once its body is this close to the line, metres. */
const SHELTER_ARRIVED_M = 0.4;
/** Pace a sheltering car moves over to the edge at, m/s: 30 km/h. */
const SHELTER_PULL_MPS = 30 / 3.6;
/** Below this a sheltering car at its spot pulls the handbrake, m/s. */
const SHELTER_PARK_MPS = 0.5;
/** Keeps the avoidance line until the whole vehicle has cleared the prop. */
const CAR_HALF_LENGTH_M = 3;
/** A standing person is narrow, but remains a physical body the whole car must clear. */
const PEDESTRIAN_RADIUS_M = 0.42;
/** Threshold braking (`modulateBrake`): only above this speed does a lock matter. */
const ABS_MIN_KMH = 8;
/** Pedal scale applied per control step while a wheel is locked, and its floor. */
const ABS_RELEASE = 0.7;
const ABS_MIN_SCALE = 0.35;
/** Seconds for the scaled pedal to come all the way back once the wheels turn. */
const ABS_RECOVER_S = 0.4;
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
 * Where a car stops, nose to near edge, for something STILL in its corridor. Well
 * inside `MUST_STOP_GAP_M`, so a car waiting there with no line round reads as having
 * no corridor — yielding to the oncoming lane, or stuck and due a recovery — and far
 * enough out that the stop is made on the planned brake rather than on the stone.
 */
const STILL_BLOCK_STANDOFF_M = 3;
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
/**
 * Seconds ahead the cross-track error is taken at: the hold steers on where the car
 * WILL be relative to its line, `e + (line rate − lateral rate) · lead`, not where it is.
 *
 * Without it the hold was a pure spring on position, and a spring on a laggy mass
 * rings. The chassis answers the wheel late — a GAZ-21 on cross-plies and 0.95 Hz
 * springs reaches 63% of a step's yaw in 0.27-0.37 s against 0.12-0.17 s for a
 * Zhiguli — and past a point that lag alone turns the spring into an oscillator:
 * measured on the bench road in `sleeper`, the Volga swung ±1 m across its lane every
 * 2.5 s, growing with speed and never settling (32 zero crossings per km, 0.37 m RMS),
 * and `hurried` was worse. The rate term is the damper that spring was missing: 0.2 s
 * already stopped it, and at 0.4 s the Volga holds its lane to 0.07 m RMS with under
 * one crossing per km, while every other car tracked the same or better and settled
 * sooner. It is not a per-car constant because nothing about it is: the slowest
 * chassis sets how much damping is enough, and more than enough costs the quick ones
 * nothing measurable.
 */
const LANE_HOLD_LEAD_S = 0.4;
/** Lateral trim against a steady push; see `laneTrim` where the steering is built. */
const LANE_TRIM_TAU_S = 1.5;
const LANE_TRIM_LEAK = 0.05;
const LANE_TRIM_ACCEL_MPS2 = 3;
const LANE_TRIM_LINE_RATE_MPS = 0.15;
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
 * rate; see `room` in `LateralCommitment.step`. A few car lengths, because that is the
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
 * PASSING ON THE RIGHT, the frantic driver's answer to a two-lane road whose opposing
 * lane is taken: ease out onto the verge beside the car it is held up by — the left
 * wheels may stay on the asphalt — go by at a modest speed advantage, and come back in.
 *
 * It is not a licence the corridor gives by default. The sand is for things that are
 * not going anywhere (`SHOULDER_BYPASS_MAX_SPEED` in the corridor), and only a racer on
 * a nearly straight, one-lane-each-way stretch with the verge clear of props is granted
 * it, one step at a time (`shoulderPassAllowed`). The crossing stays cheaper, so with
 * the opposing lane free the pass is still taken there.
 *
 * THE VERGE IS THE ROAD'S OWN SHOULDER, and it is the road that says how much of it
 * there is: `EDGE_MARGIN` is what the body's outer edge may reach PAST the graded strip
 * (`roadprofile.shoulderWidthM` for the surface here). The strip exists to carry the
 * WHEELS, and the budget is the two gaps between the planner's body edge and the ground
 * it is allowed to put a wheel on: about 0.4 m, because `CAR_HALF_WIDTH_M` is a
 * generous body half-width and the outer wheel sits that much further in, and half a
 * metre of that wheel in the sand beyond the strip — which is drivable ground, flush
 * with the verge (`PASSING_VERGE_M`), just slower to be on, and the pass gives itself
 * up if it stops gaining (`SHOULDER_PASS_MIN_GAIN_MPS`).
 *
 * On a highway's 1.35 m of crush that is 2.25 m of body edge, on cracked asphalt's
 * 1.05 m 1.95 — exactly the line the pass needs past a car holding its lane centre to
 * the centimetre, so a worn road is the boundary case and the measurement decides it:
 * a car sitting a little further out in its lane is passed and one sitting in is not —
 * a concrete road's wider verge grants 2.5, and the grader's spoil on a gravel road
 * 2.0, which lets the pass happen there at all. The point of measuring it is that a
 * pass is sized on the verge the road actually has, instead of a highway's on every
 * road.
 *
 * `GAP` is the room kept to the passed car's real flank, on top of the planner's own
 * body margin. The speed is the leader's plus `ADVANTAGE`, never above `MAX`: a pass
 * on the verge is a squeeze, not a sprint. The wheels end up on the shoulder, whose own
 * grip the speed profile already carries (`SURFACE_SPEED_FACTOR[LooseShoulder]`): the
 * surface under the car is what the plan is built from, and it changes to the shoulder
 * the moment a wheel is on it.
 */
const SHOULDER_PASS_EDGE_MARGIN_M = 0.9;
const SHOULDER_PASS_GAP_M = 0.25;
const SHOULDER_PASS_ADVANTAGE_MPS = 6;
const SHOULDER_PASS_MAX_MPS = 130 / 3.6;
/**
 * Cornering a car can do with its body over the loose shoulder, m/s²: about a third of
 * the asphalt's, for stone that rolls and an edge that drops. At 220 m that is 84 km/h,
 * at 120 m 62 km/h; on a straight the verge passes keep their own cap above.
 */
const VERGE_LATERAL_ACCEL = 2.5;
/** How far ahead the verge speed reads the bend: seconds of travel, with a floor. */
const VERGE_BEND_LOOK_S = 3;
const VERGE_BEND_LOOK_MIN_M = 40;
const VERGE_BEND_SAMPLES = 4;
/** Going round something standing still with the body on the verge, m/s: 60 km/h. */
const VERGE_BYPASS_STILL_MPS = 60 / 3.6;
/** Braking a driver plans with to stop at a bottleneck hold line, m/s². */
const HOLD_LINE_DECEL_MPS2 = 3;
/**
 * A PASS ON THE VERGE HAS TO BE GAINING. The loose ground out there costs grip and
 * rolling drag the asphalt does not, and a car that could not find its advantage sat
 * alongside the one it meant to pass for twenty seconds with its right wheels in the
 * dirt — measured on the real road with a racer in a Zhiguli. Gaining less than
 * `MIN_GAIN` on it for `STALL_S` gives the pass up: the racer drops `YIELD` below the
 * other car until it is out from alongside, tucks back in behind it, and leaves the
 * verge alone for `RETRY_M` of road.
 */
const SHOULDER_PASS_MIN_GAIN_MPS = 1.5;
const SHOULDER_PASS_STALL_S = 3;
const SHOULDER_PASS_YIELD_MPS = 3;
const SHOULDER_PASS_RETRY_M = 200;
/**
 * Least acceleration the engine must still have at the passed car's speed for a verge
 * pass to be started: the minimum gain over the stall clock, 1.5 m/s in 3 s, with the
 * verge's own drag on top.
 */
const SHOULDER_PASS_MIN_ACCEL_MPS2 = 0.6;
/** The body within this of the pass line counts as out on the verge; the gain clock starts there. */
const SHOULDER_PASS_OUT_M = 0.5;
/**
 * Road a car the planner put on the verge has to get its body back onto the asphalt
 * before being out there counts as a road departure: a lane's worth of return at the
 * line's own rate (`LINE_SHIFT_PER_METRE`) is about 30 m, plus the body settling.
 */
const SHOULDER_PASS_RETURN_M = 40;
/**
 * THROUGH THE MIDDLE, the frantic driver's answer to a queue the opposing lane is not
 * free enough to go round. There is no such lane as "the middle" and nobody gives it
 * one: it MEASURES the room out of the traffic field — where the cars of the queue
 * really are and where the cars coming the other way really are — and threads the body
 * down the gap their flanks leave, re-measuring it every step as the stream moves. On a
 * road one lane each way that gap is between the near flank of the queue and the middle
 * of the lane beyond it.
 *
 * And the room is all it takes from the stream: whether the line is legal is the
 * corridor's question, not this one. A line that only reaches over the crown is priced
 * against the cars coming the other way by `straddleAllowed`; one that crosses is the
 * ordinary crossing, granted or refused by `mayCrossCrown` and the measured oncoming
 * gap behind it. Nothing here grants either.
 *
 * `BODY_HALF` is the half width assumed of each car met or passed (the field reports a
 * pessimistic 1.0 for all of them, the widest saloon being 0.9), `GAP` the air kept to
 * each, measured to this car's REAL flank. It is not taken on a bend, and the pass is
 * a squeeze, not a sprint: at most `ADVANTAGE` over the car being passed. Cars further
 * than `QUEUE_M` beyond that one are room to cut back into, and oncoming ones are
 * judged out to `LOOK_M`.
 */
const MIDDLE_PASS_BODY_HALF_M = 0.9;
const MIDDLE_PASS_GAP_M = 0.35;
/** A pass already threading the middle keeps that line unless the search finds this much clearer road. */
const MIDDLE_PASS_KEEP_M = 5;
const MIDDLE_PASS_LOOK_M = 300;
const MIDDLE_PASS_QUEUE_M = 30;
const MIDDLE_PASS_ADVANTAGE_MPS = 10;
/** The line must reach at least this far toward the crown from the lane to be one. */
const MIDDLE_PASS_MIN_SHIFT_M = 0.3;
/**
 * A line whose body reaches over the crown is allowed only clear of every car coming
 * the other way that it could meet within this many seconds, by `STRADDLE_GAP_M` of
 * air between the two real flanks. See `straddleAllowed` in the corridor.
 */
const STRADDLE_LOOK_S = 4;
const STRADDLE_LOOK_MIN_M = 30;
const STRADDLE_GAP_M = 0.3;
/** Verge proven clear of props ahead: this many seconds of travel, within bounds. */
const SHOULDER_PASS_SIGHT_S = 5;
const SHOULDER_PASS_SIGHT_MIN_M = 60;
const SHOULDER_PASS_SIGHT_MAX_M = 220;
/** A passed body's assumed half width when only a collider is known (abeam query). */
const SHOULDER_PASS_BODY_HALF_M = 0.9;
/**
 * The pass line sits this far outside the exact touching line: on the exact one the
 * strict band test calls the passed car IN the corridor, and the driver follows it
 * along the verge instead of passing it.
 */
const SHOULDER_PASS_LINE_SLACK_M = 0.05;
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
/** Heading off the road beyond which a driver crawls; see its use. 35°. */
const TURNED_AWAY_RAD = 0.6;
const OFFROAD_BRAKE_MAX = 0.7;
/** Brake a developing road departure before loose-surface momentum makes it unrecoverable. */
const EDGE_STABILITY_LATERAL_M = 1.6;
const EDGE_STABILITY_LATERAL_SPEED_MPS = 0.4;
/** How far outside its own commanded line a body has to be for that to be a departure. */
const EDGE_STABILITY_OVERSHOOT_M = 0.4;
/** Road recovery needs the decisive pedal that already lets frantic escape loose sand. */
const OFFROAD_THROTTLE_BAND = 1.2;

/**
 * SEEING OTHER TRAFFIC, IN THE ROAD'S FRAME.
 *
 * Road props are known in the road frame hundreds of metres out (`HazardIndex`), so
 * they need no sensing at all. Everything that moves — other cars, the player's car, a
 * parked car, a trailer, a standing piece of a broken prop — is a dynamic body nobody
 * indexes, and a car at 130 km/h needs about 100 m of warning. So once a step one
 * broad-phase query collects every dynamic body within reach and PROJECTS it onto the
 * road (`collectRoadBodies`): arclength, lateral, the half-extents its real collider
 * spans along and across the road there, and its speed along the road where it is.
 * Every "is this lane occupied, and by what" question is answered in that frame
 * (`laneProbe`), as an interval test on the lateral, never as a line in space.
 *
 * It replaced rays cast down the CHORD of each lane, and both families of fault those
 * carried are gone by construction rather than by tuning:
 *   - a chord is only the lane while the bend is gentle. Walked in short segments it
 *     still left the arc in tight bends and found the car coming the other way, or a
 *     car on the far leg of a hairpin, standing at a fixed distance in a place the
 *     driver would never reach — read as a parked obstacle and swerved round;
 *   - the first static hit ended the ray, so a car behind a crest did not exist until
 *     it was close: measured at 127 km/h, a car doing 37 seen 109 m ahead, lost for
 *     the next 60 m behind the profile, found again at 15 m and hit.
 *
 * Knowing where a car is and being allowed to BET on an empty road are different
 * questions. The second has its own honest answer, the road's vertical profile
 * (`DriveRoad.sightDistanceAt`), and it gates what has to be committed to on sight:
 * crossing the crown, and the racer's pace over a blind crest.
 */
/**
 * Height above the road a body has to stand across to count: a car's bumper line. What
 * lies lower — a dropped wheel, a bottle, a cactus limb on its side — is not traffic.
 */
const PROBE_HEIGHT_M = 0.9;
/**
 * Road metres ahead of the car's centre where a lane probe begins. Nearer than that a
 * body is level with this one, which is the abeam scan's business, not a leader.
 */
const PROBE_START_M = 4;
/**
 * Half the band a lane probe examines either side of its line. Narrower than a car, so
 * a car squarely in the next lane is not in this one; any body whose own lateral span
 * reaches into the band is.
 */
const PROBE_HALF_WIDTH_M = 0.8;
const PROBE_MIN_SIGHT_M = 26;
const PROBE_SIGHT_SECONDS = 3.2;
/** Bodies projected further off the centreline than this are nowhere near any lane. */
const PROBE_MAX_LATERAL_M = 30;
/** Road metres behind the car's centre the rearward probe can ask about. */
const PROBE_REAR_M = PROBE_START_M + ONCOMING_REAR_GAP_M;
/**
 * Spacing of the centreline points a body is placed against (`routeFoot`), and the
 * most of them one step samples. Five metres keeps the polyline within 0.3 m of the
 * turning circle's 11 m loop, which is close enough to seed an exact projection.
 */
const ROUTE_STEP_M = 5;
const ROUTE_MAX_POINTS = 129;
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
 * SECONDS OF CLOSING the reach is also measured in, whichever answer is longer.
 *
 * A following distance is a headway at a matched pace and a countdown at a closing
 * one: two of them are 86 m behind a leader at 30 m/s, which is 2.9 s when the
 * difference is nothing and 1.4 s when it is twenty metres a second. Six seconds of
 * closing is the same number for every differential — at 4 m/s it is 31 m, less than
 * the headway reach, so the headway answer stands; at 20 m/s it is 127 m, and the
 * driver starts reading the queue while it is still seven seconds away from the
 * follower envelope rather than inside it. Planning only, never the lateral move
 * (`passReach` in `LateralCommitment.step` still times that on the move's own length): it decides
 * when the line is looked for, not when the wheel is turned.
 */
const PASS_APPROACH_CLOSING_S = 6;
/**
 * Seconds of closing a racer wants between itself and the next car of a queue before
 * it brings a crossing back into its own lane, and the road a gap must offer beyond
 * that to be worth the manoeuvre at all; see the weave in `drive`.
 *
 * `HOLD_S` is the room to hold the lane rather than to brake in it — the follower
 * settles at a headway, and this is a headway of closing. `HOLD_M` is the hysteresis
 * against the distance the driver goes OUT at (`passReachM`): a gap a metre longer than
 * the out-trigger is two lane changes inside a second, which is the shuttling this file
 * has already been measured into, so the gap has to be a gap and not a hair.
 */
const WEAVE_HOME_HOLD_S = 2;
const WEAVE_HOME_HOLD_M = 60;
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
 * THE RACER'S PASS, sized on its own car (`ModeConfig.racer`, `sizePass`).
 *
 * It cuts back in with its tail this far past the nose of the car it passed — rude by
 * any standard but a racer's — and needs a slot in front of the next car of the queue
 * no bigger than this plus a third of a second of its own speed.
 */
const RACER_CUT_IN_M = 2.5;
const RACER_SLOT_M = 3;
const RACER_SLOT_SECONDS = 0.3;
/** Seconds of closing kept between a finished pass and the car coming the other way. */
const RACER_PASS_MARGIN_S = 1;
/** Opposing line that has to be clear of props beyond the pass itself. */
const RACER_CROSSING_CLEAR_M = 30;
/** Road, or seconds, after a given-up pass before a racer tries again; see `CROSSING_RETRY_METRES`. */
const RACER_CROSSING_RETRY_M = 20;
const RACER_CROSSING_RETRY_S = 1.5;
/**
 * THE LEGAL PASS IS MEASURED TOO, on the same simulation of the driver's own car
 * (`sizePass`), only with a driver's manners: back in a few car lengths ahead of the
 * car passed, into a gap a following distance long, and with two and a half seconds of
 * closing to spare against what is coming. It used to be a constant-speed sum with no
 * acceleration in it, the oncoming speed guessed when the car was unseen, and a second
 * guess on top (`PASS_ENTRY_MARGIN`): it refused windows a real driver takes and
 * accepted ones a weak car could not finish.
 */
const LEGAL_CUT_IN_M = 8;
const LEGAL_SLOT_M = 8;
const LEGAL_SLOT_SECONDS = 1;
const LEGAL_PASS_MARGIN_S = 2.5;
/** Step of the pass simulation, and how far up the road the queue is looked for. */
const PASS_SIZING_STEP_S = 0.1;
const PASS_QUEUE_LOOK_M = 400;
/**
 * A pass given up while the car being passed is still level: drop this far below its
 * speed until it is ahead of the abeam window, then take the lane behind it.
 */
const ABANDON_DROP_BACK_MPS = 4;
/**
 * WHAT THE CAR CAN DO, which a pass cannot be sized without.
 *
 * Acceleration is power over momentum, less drag and rolling resistance, less the
 * grade: `a = share·P/(m·v) − ½ρ·CdA·v²/m − roll − g·grade`, capped at what the
 * driven wheels can put down from rest. `share` is what a flat-out run actually gets of
 * the engine's peak power once gearing, shifts and the power band are paid for. It
 * starts at a prior and is then MEASURED: every step of full throttle on a straight
 * reports the share it implied, and the driver keeps a running average of it — so a
 * worn engine, a loaded boot or a gravel district is what the next pass is sized on.
 */
const HALF_AIR_DENSITY = 0.6;
const ROLLING_DECEL_MPS2 = 0.12;
const POWER_SHARE_PRIOR = 0.6;
const POWER_SHARE_MIN = 0.2;
const POWER_SHARE_MAX = 1;
const POWER_SHARE_TAU_S = 2;
const POWER_SAMPLE_MIN_SPEED_MPS = 6;
/** Straight enough, as lateral acceleration, for the throttle to be all longitudinal. */
const POWER_SAMPLE_MAX_LATERAL_MPS2 = 1.5;
const TRACTION_ACCEL_CAP_MPS2 = 3;
/**
 * GIVING THE OPPOSING LANE BACK.
 *
 * The opposing lane is borrowed to go fast. Coming back from a long pass at road speed
 * is a lane change, taken at the ordinary manoeuvre rate so the car is not set weaving
 * at 120 km/h. Coming back from a pass that stalled, a poke out that met something, or
 * a slow bypass is not a lane change but getting out of somebody's way, and at those
 * speeds the ordinary rate was the danger: its heading ceiling is 0.09 m of lateral per
 * metre of road, so at walking pace a car took seven seconds to cross back — measured
 * as long enough to be hit head-on at 8 km/h by traffic doing 70.
 *
 * So the return is brisk below `RETURN_BRISK_BELOW_MPS` — up to `RETURN_HEADING_SLOPE`
 * of lateral per metre and `RETURN_GRIP_SHARE` of the cornering budget, which is a
 * decisive swerve at those speeds and nowhere near the tyres — and blends into the
 * ordinary rate by `RETURN_SMOOTH_ABOVE_MPS`. The band ends low on purpose: blended up
 * to 90 km/h, the return from a finished pass at 70 put the body 0.8 m past its lane,
 * the edge-stability brake answered that on a loose surface, and the swing grew until
 * the car left the road (seed 1337 at s 62 040).
 */
const RETURN_BRISK_BELOW_MPS = 8;
const RETURN_SMOOTH_ABOVE_MPS = 16;
const RETURN_HEADING_SLOPE = 0.3;
const RETURN_GRIP_SHARE = 0.7;

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
 *
 * OR SECONDS, WHICHEVER RUNS OUT FIRST (`CROSSING_RETRY_S`). Distance alone never runs
 * out for a car that has stopped: one that gave up a crossing round a parked lorry and
 * pulled up behind it covered no road, the opposing lane stayed shut to it for good, and
 * the stall rule eventually had it reverse out of a perfectly passable situation. The
 * oncoming car it gave way to is past in a few seconds at any speed; the flicker the
 * barrier exists for is step to step.
 */
const CROSSING_RETRY_METRES = 60;
const CROSSING_RETRY_S = 3;
/** Recovery is forbidden while any physical traffic occupies this local envelope. */
const DYNAMIC_BLOCKER_NEARBY_M = 12;
/** Move this far after losing a dynamic lead before a stop can be called unexplained. */
const DYNAMIC_BLOCKER_CLEAR_M = 5;
/**
 * The band, ahead of and behind the car's own centre, in which another body counts
 * as ALONGSIDE rather than as something to follow.
 *
 * It has to cover the lane probes' blind spot — they start `PROBE_START_M` ahead of
 * the car's centre — plus a body length either way, because two cars whose centres
 * are eight metres apart still overlap for the length of a lane change.
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
 * The launch pedal (see where the throttle is built): below this speed the pedal holds
 * the grade and pulls toward the target at up to `LAUNCH_ACCEL_MPS2`, closing the gap
 * over `LAUNCH_TAU_S`. An eighth of a g is a brisk but ordinary pull-away.
 */
const LAUNCH_ASSIST_BELOW_MPS = 6;
const LAUNCH_ACCEL_MPS2 = 1.2;
const LAUNCH_TAU_S = 1.5;
/** Below this forward speed a car whose gears cannot pull yet is held on the brake. */
const LAUNCH_HOLD_MPS = 0.5;
/**
 * MOST OF THE PEDAL THAT BRAKING FOR SOMETHING IN THE WAY MAY USE.
 *
 * The mode's own `brakeCeiling` is a personality — sleeper 0.55, hurried 0.8, frantic
 * 1.0 — and it was also being spent on obstacles, so a hurried driver answered a rock in
 * its lane by standing on the brake. On a sealed surface that is survivable; on the
 * loose half of this road it is not, because a locked-front deceleration is exactly what
 * gives up the steering. Frantic was already measured doing it: it arrived at a bend
 * too fast, stood on the brake inside it, lost the front on the loose surface and ran
 * 1.2 m past the asphalt before recovering (see `ModeConfig.gripReserve`).
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
/**
 * THE ESCAPE STARTS SMALL. Reported from play: a stuck car swung back in a sweeping
 * ten-metre arc at 0.85 lock with nothing limiting its reverse speed, and only then
 * worked out where the road was — an overreaction for what is usually a bumper's
 * length of trouble. A driver first backs off a metre or two with the wheel one way
 * and pulls forward with it the other; only if that does not clear it does he back
 * further, harder over. So each rung of the ladder is a distance, a reverse speed, a
 * lock and a pull-out crawl, from gentle to the old decisive turn, and the reverse is
 * measured in METRES covered rather than seconds of pedal.
 */
const RECOVERY_RUNG_REVERSE_M = [1.8, 3.2, 5, 7.5] as const;
const RECOVERY_RUNG_REVERSE_MPS = [1.1, 1.5, 2, 2.5] as const;
const RECOVERY_RUNG_LOCK = [0.55, 0.7, 0.85, 1] as const;
const RECOVERY_RUNG_CRAWL_MPS = [2.5, 3.2, 4, 4.5] as const;
/** Seconds past the time the rung's distance needs at its speed before the leg gives up. */
const RECOVERY_REVERSE_SLACK_S = 2.5;
const RECOVERY_PULLOUT_S = 1.6;
const RECOVERY_REVERSE_BRAKE = 0.72;
/** The pull-out's least pedal; the launch pedal raises it on a grade. */
const RECOVERY_PULLOUT_THROTTLE = 0.45;
/**
 * A car whose tail is boxed in waits this long, in reverse, for the queue behind to
 * ease back (`needsReverseRoom`), before it gives up the reverse and pulls out.
 */
const RECOVERY_ROOM_WAIT_S = 2.5;
/** Room a yielding car keeps behind itself, and how fast it gives ground back. */
const YIELD_REVERSE_ROOM_M = 6;
/** A crawl: the car in front only needs a metre or two, so nobody behind lunges. */
const YIELD_REVERSE_MPS = 0.8;
/** Most a yielding car gives back per request, metres. */
const YIELD_REVERSE_BUDGET_M = 2.5;
/** A prop this close in front decides which way the escape goes (`beginRecovery`). */
const RECOVERY_PROP_AWARE_M = 6;
/**
 * Opposing lane an escape may swing into, metres of it clear: a car closing at 25 m/s
 * plus this one's own 15 m/s needs about four seconds, which is the whole manoeuvre.
 */
const RECOVERY_ONCOMING_CLEAR_M = 160;
const RECOVERY_BIAS_METRES = 50;
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
 * With the prop known, the escape line clears it by this much over the planner's own
 * clearance (radius, body, `AVOID_HYSTERESIS_M`): the wedged-on-road bench's 1.2 m rock
 * needed 2.8 m of line from its centre, and this puts the line at 3.0.
 */
const RECOVERY_CLEAR_MARGIN_M = 0.35;
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
 * changes when the first go does not clear it. The rungs (`RECOVERY_RUNG_*`) take the
 * manoeuvre from "ease back under two metres at half lock" to "back most of two
 * lengths at full lock and come back along the shoulder".
 *
 * The ladder is bounded because past that the manoeuvre stops being a two-point turn
 * on a road: a bigger swing only puts more of the carriageway under a car that is
 * already lying across it, which is the failure `RECOVERY_REARM_S` was written for.
 */
const RECOVERY_ESCALATION_MAX = RECOVERY_RUNG_REVERSE_M.length - 1;
/** Seconds of pull-out added per rung. */
const RECOVERY_PULLOUT_STEP_S = 0.6;
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

/** One dynamic body as this driver's road sees it; see `Autopilot.collectRoadBodies`. */
interface RoadBody {
  /** Road metres from this car's centre to the body's centre; negative is behind. */
  s: number;
  /** Signed lateral of its centre, positive LEFT of travel, as `DriveRoad.project`. */
  lateral: number;
  /** Half the span its collider covers along the road and across it, where it is. */
  halfAlong: number;
  halfAcross: number;
  /** Speed along the road's direction of travel where it is; negative is oncoming. */
  speed: number;
}

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
  /** Road lateral of the prop `hazardDistance` measured: which side it blocks. */
  private hazardLateral = 0;
  /** Its radius, and the road arclength its far edge reaches. */
  private hazardRadius = 0;
  private hazardEndS = 0;
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
  /** Integral cross-track trim, rad/m: the lean on the wheel against wind and camber. */
  private laneTrim = 0;
  /** Last plan: is there a way through, what is in it, and where it puts the car. */
  private corridorFeasible = true;
  private corridorBlockDistance = Infinity;
  private corridorBlockSpeed = 0;
  /** Speed the gaps to things standing beside the corridor allow; see `PASS_MARGIN_S`. */
  private corridorSqueezeSpeed = Infinity;
  /** Gap asked for past a prop at this step's speed, on top of the planning margin. */
  private hazardPassMargin = 0;
  private corridorLaneBlockDistance = Infinity;
  private corridorLaneBlockSpeed = 0;
  /** Road width at this tick's projection, shared with hazard callbacks. */
  private asphaltHalfWidth = 0;
  /** Steering curvature trim, rad/m; see `ModeConfig.curvatureTrim`. */
  private curvatureTrim = 0;
  /** The pedal as it was last left, so it can only be fed back in; see RACER_FEED_PER_S. */
  private racerThrottle = 0;
  /** This step's manoeuvre and the named rules binding speed and pedal; see manoeuvre.ts. */
  private manoeuvreValue: Manoeuvre = 'cruise';
  private readonly speedLimit = new LimitArbiter<SpeedLimitSource>('road');
  private readonly throttleLimit = new LimitArbiter<ThrottleLimitSource>('speed-error');
  /** The least-curved line a racing driver is on; see `ModeConfig.racingLine`. */
  private readonly racingLine = new RacingLine();
  private racingActive = false;
  /** This step's racing band terms, read by `racingBand` for every sample it solves. */
  private racingCrownClearM = 0;
  private racingHazardM = Number.POSITIVE_INFINITY;
  private racingOwnSign = -1;
  private racingBodyHalfWidth = CAR_HALF_WIDTH_M;
  /** Edge margin for this step's solve: `RACING_EDGE_MARGIN_M` plus the speed's share. */
  private racingEdgeMargin = RACING_EDGE_MARGIN_M;
  private racingHomeLane = 0;
  private racingOwnCarriageway = false;
  /** Seconds of plain cruising since anything else; see `RACING_REARM_S`. */
  private racingQuietFor = 0;
  /**
   * The usable band at a sample: the whole asphalt where the far half is vouched for,
   * the driver's own half (or its whole carriageway on a road with two lanes a side and
   * nobody else in them) elsewhere, and the home lane alone from the first thing
   * standing on the road, so the line is home before the planner has to go round it.
   */
  private readonly racingBand: RacingLineBand = (s, distance, out) => {
    const lanes = this.road.lanesPerSideAt(s);
    const home = this.road.laneCentreAt(s, Math.min(this.racingHomeLane, lanes - 1));
    out[2] = home;
    const edge = Math.max(0, this.road.halfWidthAt(s) - this.racingBodyHalfWidth - this.racingEdgeMargin);
    const crown = this.racingBodyHalfWidth + RACING_CROWN_MARGIN_M;
    if (distance >= this.racingHazardM || edge <= crown) {
      out[0] = home;
      out[1] = home;
      return;
    }
    if (lanes === 1 && distance <= this.racingCrownClearM) {
      out[0] = -edge;
      out[1] = edge;
      return;
    }
    if (lanes > 1 && !this.racingOwnCarriageway) {
      out[0] = home;
      out[1] = home;
      return;
    }
    out[0] = this.racingOwnSign * edge;
    out[1] = this.racingOwnSign * crown;
  };
  private readonly visitRacingHazard = (hazard: RoadHazard): void => {
    if (Math.abs(hazard.lateral) - hazard.radius >= this.asphaltHalfWidth) return;
    this.racingHazardM = Math.min(
      this.racingHazardM,
      hazard.s - hazard.radius - CAR_HALF_LENGTH_M - this.hintS,
    );
  };
  /** Scratch lane centres: avoids rebuilding the planner's candidate list per tick. */
  private readonly laneCentres: number[] = [];
  private planUsesOncomingLane = false;
  private planUsesShoulder = false;
  /** Last step's line came from the search over an infeasible commitment; see `drive`. */
  private planOverridden = false;
  /** Asked by the traffic coordinator to give the car in front room to reverse. */
  private yieldReverse = false;
  private bodyScanGap = Infinity;
  /** Along-road speed of the body the most recent lane probe or axis scan found. */
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
  /** The lateral manoeuvre committed to, its barriers and the verge pass; see lateral.ts. */
  private readonly lateral = new LateralCommitment({
    carHalfWidth: CAR_HALF_WIDTH_M,
    carHalfLength: CAR_HALF_LENGTH_M,
    detourMin: DETOUR_MIN_M,
    triggerFloor: DETOUR_TRIGGER_FLOOR_M,
    holdMax: DETOUR_MAX_M,
    releaseMargin: DETOUR_RELEASE_MARGIN_M,
    minClosing: MIN_CLOSING_MPS,
    crawl: CRAWL_SPEED_MPS,
    passAdvantage: PASS_ADVANTAGE_MPS,
    shoulderMinGain: SHOULDER_PASS_MIN_GAIN_MPS,
    shoulderStallS: SHOULDER_PASS_STALL_S,
    shoulderRetryM: SHOULDER_PASS_RETRY_M,
  });
  private recoveryPhase: 'none' | 'reverse' | 'pullout' = 'none';
  private recoveryTimer = 0;
  /** A deterministic right-of-way escape through an opposing-traffic deadlock. */
  private recoveryCommitted = false;
  /** Seconds this driver has been held at an obstruction by traffic coming the other way. */
  private yieldingFor = 0;
  /** Last step's crown-crossing inputs, kept for dev telemetry and the road benches. */
  private lastOncomingGap = Infinity;
  private lastRearClear = false;
  private lastMayCross = false;
  private lastCrossingRefused = false;
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
  /** Road arclength the escape's prop ends at, plus a body; NaN when no prop was known. */
  private recoveryPropEndS = Number.NaN;
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
  /** Metres the current reverse leg has covered, and seconds it has waited for room. */
  private recoveryReversed = 0;
  private recoveryRoomWait = 0;
  /** Metres given back to the car in front during the current yield request. */
  private yieldReversed = 0;
  private lastRecoveryAt = -Infinity;
  private recoveryAttempts = 0;
  private speedCapValue = Infinity;
  /** See `sheltering`. */
  private shelteringValue = false;
  /** A sheltering car has reached its spot at the edge and stays stopped there. */
  private shelterArrived = false;
  /** The pedal share threshold braking allows this step; see `modulateBrake`. */
  private brakeScale = 1;
  /** See `setHoldDistance`. */
  private holdDistance = Infinity;
  /** Share of the mode's pace this driver uses; see `setPace`. */
  private paceValue = 1;
  /** Ambient traffic may use a per-driver following distance. */
  private followingHeadwayValue: number | null = null;
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
  /** This step's grant of the verge for passing a moving car; see SHOULDER_PASS_*. */
  private shoulderPassAllowed = false;
  /**
   * The verge this road has for that pass, metres of body edge past the asphalt; 0 when
   * there is no grant. See SHOULDER_PASS_EDGE_MARGIN_M.
   */
  private shoulderPassOverhang = 0;
  /** Road-frame lateral and half width of the car being passed, from the field. */
  private shoulderLeaderLateral = 0;
  private shoulderLeaderHalfWidth = 0;
  private shoulderLeaderHalfLength = 0;
  private shoulderLeaderGap = Infinity;
  private shoulderLeaderSpeed = 0;
  /** Road, in metres travelled, a body the plan put on the verge is still coming back from it. */
  private vergeReturnUntil = 0;
  /** Last step: the car being passed on the verge was still alongside. */
  private shoulderAlongside = false;
  /** This step's grant of the centre line past a yielding car; see MIDDLE_PASS_*. */
  private middlePassAllowed = false;
  /** The car is on that line, beside the car it is passing. */
  private middlePassingValue = false;
  private middleLine = 0;
  private middleOwnHalf = 0;
  private middleClear = true;
  private middleQueueLimit = 0;
  /** Of the queue being passed, the flank nearest the crown, in this driver's side sign. */
  private middleQueueEdge = 0;
  private readonly visitMiddleQueue = (neighbour: TrafficNeighbour): void => {
    if (neighbour.s < 0 || neighbour.speed <= CRAWL_SPEED_MPS) return;
    // In this driver's lane: the same membership test the leader search uses.
    if (Math.abs(neighbour.lateral - this.shoulderLaneOffset) > neighbour.halfWidth + CAR_HALF_WIDTH_M) return;
    this.middleQueueEdge = Math.min(this.middleQueueEdge, neighbour.lateral * this.shoulderSideSign);
  };
  /** Obstacles the thread line has to clear, and the band each is given. See MIDDLE_PASS_*. */
  private middleObstacles: CorridorObstacle[] | null = null;
  private middleObstacleHalf = 0;
  private readonly visitMiddleOncoming = (neighbour: TrafficNeighbour): void => {
    // Everything ahead on the crown side of the line, whichever way it is going.
    if (neighbour.s <= 0) return;
    if ((neighbour.lateral - this.middleLine) * this.shoulderSideSign >= 0) return;
    this.middleObstacles?.push({
      s: neighbour.s,
      lateral: neighbour.lateral,
      halfWidth: this.middleObstacleHalf,
      speed: neighbour.speed,
      movable: true,
    });
  };
  /** Laterals of the traffic a line over the crown could meet; see STRADDLE_LOOK_S. */
  private readonly straddleLaterals: number[] = [];
  private straddleSpeed = 0;
  private straddleOwnHalf = 0;
  private straddleSide = -1;
  private readonly visitStraddle = (neighbour: TrafficNeighbour): void => {
    // Only what is coming, or standing on the far side: a car going our way is a
    // leader or a car being passed, and the planner already has it.
    const closing = this.straddleSpeed - neighbour.speed;
    if (neighbour.speed > CRAWL_SPEED_MPS) return;
    if (neighbour.speed >= -CRAWL_SPEED_MPS && neighbour.lateral * this.straddleSide >= 0) return;
    if (neighbour.s > Math.max(STRADDLE_LOOK_MIN_M, closing * STRADDLE_LOOK_S)) return;
    this.straddleLaterals.push(neighbour.lateral);
  };
  private readonly straddleAllowed = (line: number): boolean => {
    const reach = MIDDLE_PASS_BODY_HALF_M + this.straddleOwnHalf + STRADDLE_GAP_M;
    for (const lateral of this.straddleLaterals) {
      if (Math.abs(lateral - line) < reach) return false;
    }
    return true;
  };
  private readonly visitMiddleNeighbour = (neighbour: TrafficNeighbour): void => {
    if (!this.middleClear) return;
    // Something going our way far enough up the road is room to come back in ahead of.
    if (neighbour.speed > -CRAWL_SPEED_MPS && neighbour.s > this.middleQueueLimit) return;
    if (
      Math.abs(neighbour.lateral - this.middleLine) <
      MIDDLE_PASS_BODY_HALF_M + MIDDLE_PASS_GAP_M + this.middleOwnHalf - 1e-3
    ) {
      this.middleClear = false;
    }
  };
  private shoulderLaneOffset = 0;
  private shoulderSideSign = -1;
  private shoulderVergeBlocked = false;
  private readonly visitShoulderLeader = (neighbour: TrafficNeighbour): void => {
    if (neighbour.s < 0 || neighbour.s >= this.shoulderLeaderGap) return;
    if (neighbour.speed <= CRAWL_SPEED_MPS) return;
    if (Math.abs(neighbour.lateral - this.shoulderLaneOffset) > neighbour.halfWidth + CAR_HALF_WIDTH_M) return;
    this.shoulderLeaderGap = neighbour.s;
    this.shoulderLeaderSpeed = neighbour.speed;
    this.shoulderLeaderLateral = neighbour.lateral;
    this.shoulderLeaderHalfWidth = neighbour.halfWidth;
    this.shoulderLeaderHalfLength = neighbour.halfLength;
  };
  /** Any prop on this side beyond the asphalt, out to where the pass would put the body. */
  private readonly visitShoulderHazard = (hazard: RoadHazard): void => {
    const outward = hazard.lateral * this.shoulderSideSign;
    const edge = this.asphaltHalfWidth;
    if (outward + hazard.radius < edge - CAR_HALF_WIDTH_M) return;
    if (outward - hazard.radius > edge + this.shoulderPassOverhang + AVOID_HYSTERESIS_M) return;
    this.shoulderVergeBlocked = true;
  };
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
  /**
   * Whether this driver still owns the light switch. Traffic always does; the
   * player's autopilot gives it up the moment the driver presses the switch itself,
   * because otherwise the automation rewrote the choice on the very next fixed step
   * and the key looked broken.
   */
  private automaticLightsOwned = true;
  private controlledVehicle: Vehicle | null = null;
  private readonly dynamicProximityShape: RAPIER.Ball | null;
  private readonly identityRotation = { x: 0, y: 0, z: 0, w: 1 };
  private readonly position = { x: 0, y: 0, z: 0 };
  private readonly rayOrigin = { x: 0, y: 0, z: 0 };
  private readonly rayDirection = { x: 0, y: 0, z: 0 };
  private readonly condition: RoadConditionBuffer = {
    surface: SurfaceType.Asphalt,
    decay: 0,
    sandCover: 0,
    markings: 1,
  };
  /**
   * The speed profile's samples, one slot per `ROAD_PROFILE_SAMPLES` point: where it
   * is, the speed the point itself allows, the braking and the cornering capacity the
   * tyres have there, the curvature it is driven at and the grade. Filled forward and
   * read backward by the march in `drive`; preallocated, so planning allocates nothing.
   */
  private readonly profileDistance = new Float64Array(ROAD_PROFILE_SAMPLES + 1);
  private readonly profileLimit = new Float64Array(ROAD_PROFILE_SAMPLES + 1);
  private readonly profileBrake = new Float64Array(ROAD_PROFILE_SAMPLES + 1);
  private readonly profileGrip = new Float64Array(ROAD_PROFILE_SAMPLES + 1);
  private readonly profileCurvature = new Float64Array(ROAD_PROFILE_SAMPLES + 1);
  private readonly profileGrade = new Float64Array(ROAD_PROFILE_SAMPLES + 1);
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
    this.hazardLateral = hazard.lateral;
    this.hazardRadius = hazard.radius;
    this.hazardEndS = hazard.s + hazard.radius;
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
      halfWidth: hazard.radius + AVOID_HYSTERESIS_M + this.hazardPassMargin,
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
   * Anything that makes a racing line the wrong instrument: something standing on the
   * asphalt anywhere ahead within the corridor horizon, or something going OUR way on
   * either side of the crown — a car out in the opposing lane passing somebody is still
   * a car this driver is about to catch. Traffic coming the other way is not here; it
   * narrows the band instead (`racingCrownClearM`).
   */
  private racingObstructed(obstacles: readonly CorridorObstacle[]): boolean {
    for (const obstacle of obstacles) {
      if (obstacle.abeam || obstacle.s < 0) continue;
      if (Math.abs(obstacle.lateral) - obstacle.halfWidth >= this.asphaltHalfWidth) continue;
      if (obstacle.speed > -CRAWL_SPEED_MPS) return true;
    }
    return false;
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
  /**
   * THE QUEUE A RACER IS ABOUT TO PASS: every car in its own lane going its way, from
   * the one level with it to `PASS_QUEUE_LOOK_M` up the road, nearest first, as centres
   * and speeds in this driver's frame. Rebuilt from the field on every step it matters;
   * the buffers are kept so that costs no allocation.
   */
  private readonly queueCentre: number[] = [];
  private readonly queueSpeed: number[] = [];
  private readonly queueHalfLength: number[] = [];
  private queueLaneOffset = 0;
  private queueBackLimit = 0;
  private readonly visitQueue = (neighbour: TrafficNeighbour): void => {
    if (neighbour.speed < -CRAWL_SPEED_MPS) return;
    if (Math.abs(neighbour.lateral - this.queueLaneOffset) > neighbour.halfWidth + CAR_HALF_WIDTH_M) {
      return;
    }
    // The field reports the near face. A body overlapping ours is placed as far ahead
    // as it can be, which is the pessimistic answer for a pass.
    const halfLength = neighbour.halfLength;
    const centre = neighbour.s > 0
      ? neighbour.s + halfLength
      : neighbour.s < 0 ? neighbour.s - halfLength : halfLength;
    if (centre + halfLength <= this.queueBackLimit) return;
    const centres = this.queueCentre;
    let index = centres.length;
    centres.push(centre);
    this.queueSpeed.push(neighbour.speed);
    this.queueHalfLength.push(halfLength);
    while (index > 0 && centres[index - 1]! > centre) {
      centres[index] = centres[index - 1]!;
      this.queueSpeed[index] = this.queueSpeed[index - 1]!;
      this.queueHalfLength[index] = this.queueHalfLength[index - 1]!;
      index--;
    }
    centres[index] = centre;
    this.queueSpeed[index] = neighbour.speed;
    this.queueHalfLength[index] = halfLength;
  };
  /** The racer's measured pass, seconds and metres; see `sizePass`. */
  private passSecondsValue = Number.POSITIVE_INFINITY;
  private passTravelValue = 0;
  /** Last step's road-limited speed: the ceiling a pass is sized against. */
  private roadLimitValue = Number.POSITIVE_INFINITY;
  /** Measured share of peak power a flat-out run delivers; see `POWER_SHARE_PRIOR`. */
  private powerShare = POWER_SHARE_PRIOR;
  private powerSampleSpeed = -1;
  /**
   * HOW LONG THIS PASS REALLY TAKES, AND HOW MUCH ROAD IT USES.
   *
   * The car is driven forward in tenth-of-a-second steps on its own acceleration
   * (`accelerationAt`) up to the speed the road allows, against every car of the queue
   * moving at its own speed. The pass is over when the tail is `RACER_CUT_IN_M` past a
   * car's nose AND there is a slot in front of that car it fits — the next car of the
   * queue still far enough ahead — or nothing further up the road at all. Half a lane
   * change is added for the body to leave the opposing lane. A pass that finds no slot
   * within `PASS_MAX_SECONDS` is Infinity: no window, whatever is coming.
   *
   * Returns false when nothing in the driver's own lane is going its way, which is not
   * an overtake and keeps the corridor's own sum for going round stopped things.
   */
  private sizePass(
    vehicle: Vehicle,
    speed: number,
    laneOffset: number,
    grade: number,
    topSpeed: number,
    returnSeconds: number,
    racer: boolean,
  ): boolean {
    const cutIn = racer ? RACER_CUT_IN_M : LEGAL_CUT_IN_M;
    const slotM = racer ? RACER_SLOT_M : LEGAL_SLOT_M;
    const slotSeconds = racer ? RACER_SLOT_SECONDS : LEGAL_SLOT_SECONDS;
    this.queueCentre.length = 0;
    this.queueSpeed.length = 0;
    this.queueHalfLength.length = 0;
    const field = this.trafficField;
    if (!field) return false;
    const ownHalfLength = vehicle.modelMeasure.halfExtents[2];
    this.queueLaneOffset = laneOffset;
    this.queueBackLimit = -ownHalfLength;
    field.forEachNear(PASS_QUEUE_LOOK_M, ownHalfLength * 2, this.visitQueue);
    const count = this.queueCentre.length;
    if (count === 0) return false;
    let v = speed;
    let travel = 0;
    let seconds = 0;
    let finished = false;
    while (seconds < PASS_MAX_SECONDS) {
      v = v > topSpeed
        ? Math.max(topSpeed, v - MIN_PLANNED_BRAKE_MPS2 * PASS_SIZING_STEP_S)
        : Math.min(topSpeed, Math.max(0, v + this.accelerationAt(vehicle, v, grade) * PASS_SIZING_STEP_S));
      travel += v * PASS_SIZING_STEP_S;
      seconds += PASS_SIZING_STEP_S;
      const tail = travel - ownHalfLength - cutIn;
      let cleared = 0;
      while (
        cleared < count &&
        tail >= this.queueCentre[cleared]! + this.queueSpeed[cleared]! * seconds + this.queueHalfLength[cleared]!
      ) {
        cleared++;
      }
      if (cleared === 0) continue;
      if (
        cleared === count ||
        this.queueCentre[cleared]! + this.queueSpeed[cleared]! * seconds - this.queueHalfLength[cleared]! >=
          travel + ownHalfLength + slotM + slotSeconds * v
      ) {
        finished = true;
        break;
      }
    }
    this.passSecondsValue = finished ? seconds + returnSeconds : Number.POSITIVE_INFINITY;
    this.passTravelValue = travel + v * returnSeconds;
    return true;
  }
  /**
   * Every dynamic body within reach this step, in the road frame; see the note above
   * `PROBE_HEIGHT_M`. Pooled: the first `roadBodyCount` entries are this step's.
   */
  private readonly roadBodies: RoadBody[] = [];
  private roadBodyCount = 0;
  private readonly roadBodyShape: RAPIER.Ball | null;
  private roadBodyOriginX = 0;
  private roadBodyOriginZ = 0;
  private roadBodyReach = 0;
  /**
   * The stretch of road this driver is on, sampled once a step and only when a body
   * needs placing on it: centreline points from `PROBE_REAR_M` behind to the reach
   * ahead. See `routeFoot`.
   */
  private readonly routeS = new Float64Array(ROUTE_MAX_POINTS);
  private readonly routeX = new Float64Array(ROUTE_MAX_POINTS);
  private readonly routeZ = new Float64Array(ROUTE_MAX_POINTS);
  private routeCount = 0;
  private readonly routePoint = { x: 0, y: 0, z: 0 };
  private readonly bodyRotation = { x: 0, y: 0, z: 0, w: 1 };
  private readonly bodyTranslation = { x: 0, y: 0, z: 0 };
  private readonly bodyHalfExtents = { x: 0, y: 0, z: 0 };
  private readonly bodyVelocity = { x: 0, y: 0, z: 0 };
  private readonly visitRoadBody = (collider: RAPIER.Collider): boolean => {
    if (collider.isSensor()) return true;
    const parent = collider.parent();
    if (!parent) return true;
    // The collider as a box of half-extents plus a rounding radius: exact for a cuboid,
    // a ball and a capsule, and a cylinder's bounding capsule. Nothing else is dynamic.
    const shapes = this.physics!.rapier.ShapeType;
    const shape = collider.shapeType();
    let hx = 0;
    let hy = 0;
    let hz = 0;
    let round = 0;
    if (shape === shapes.Cuboid) {
      const half = collider.halfExtents(this.bodyHalfExtents);
      if (!half) return true;
      hx = half.x;
      hy = half.y;
      hz = half.z;
    } else if (shape === shapes.Ball) {
      round = collider.radius();
    } else if (shape === shapes.Capsule || shape === shapes.Cylinder) {
      hy = collider.halfHeight();
      round = collider.radius();
    } else {
      return true;
    }
    // The collider's own axes in the world: the columns of its rotation.
    const q = collider.rotation(this.bodyRotation);
    const axX = 1 - 2 * (q.y * q.y + q.z * q.z);
    const axY = 2 * (q.x * q.y + q.w * q.z);
    const axZ = 2 * (q.x * q.z - q.w * q.y);
    const ayX = 2 * (q.x * q.y - q.w * q.z);
    const ayY = 1 - 2 * (q.x * q.x + q.z * q.z);
    const ayZ = 2 * (q.y * q.z + q.w * q.x);
    const azX = 2 * (q.x * q.z + q.w * q.y);
    const azY = 2 * (q.y * q.z - q.w * q.x);
    const azZ = 1 - 2 * (q.x * q.x + q.y * q.y);
    const halfUp = hx * Math.abs(axY) + hy * Math.abs(ayY) + hz * Math.abs(azY) + round;
    // Too small to reach the bumper line even resting on the road: skip it before
    // paying for a projection.
    if (2 * halfUp < PROBE_HEIGHT_M) return true;
    const t = collider.translation(this.bodyTranslation);
    const x = t.x + this.roadBodyOriginX;
    const z = t.z + this.roadBodyOriginZ;
    // WHERE ON THIS DRIVER'S ROAD the body is: the foot of its perpendicular on the
    // stretch it is about to drive or has just driven, then refined exactly. Not a
    // guess from the straight line between the two: the road through a hairpin, or
    // round the turning circle, passes back within metres of itself, and a projection
    // seeded from the wrong side settles on the wrong leg.
    if (this.routeCount === 0) this.sampleRoute();
    const foot = this.routeFoot(x, z);
    if (!(foot === foot)) return true;
    const projection = this.road.project(x, z, foot);
    if (Math.abs(projection.lateral) > PROBE_MAX_LATERAL_M) return true;
    const s = projection.s - this.hintS;
    if (Math.abs(s) > this.roadBodyReach) return true;
    const bumperLine = projection.height + PROBE_HEIGHT_M;
    if (t.y - halfUp > bumperLine || t.y + halfUp < bumperLine) return true;
    const heading = this.road.headingAt(projection.s);
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    // Across is (cos h, -sin h): positive LEFT of travel, the lateral's own basis.
    const halfAlong =
      hx * Math.abs(axX * fx + axZ * fz) +
      hy * Math.abs(ayX * fx + ayZ * fz) +
      hz * Math.abs(azX * fx + azZ * fz) +
      round;
    const halfAcross =
      hx * Math.abs(axX * fz - axZ * fx) +
      hy * Math.abs(ayX * fz - ayZ * fx) +
      hz * Math.abs(azX * fz - azZ * fx) +
      round;
    const velocity = parent.linvel(this.bodyVelocity);
    let entry = this.roadBodies[this.roadBodyCount];
    if (!entry) {
      entry = { s: 0, lateral: 0, halfAlong: 0, halfAcross: 0, speed: 0 };
      this.roadBodies.push(entry);
    }
    this.roadBodyCount++;
    entry.s = s;
    entry.lateral = projection.lateral;
    entry.halfAlong = halfAlong;
    entry.halfAcross = halfAcross;
    entry.speed = velocity.x * fx + velocity.z * fz;
    return true;
  };
  /** Straight-line acceleration available at `speed` on `grade`; see `POWER_SHARE_PRIOR`. */
  private accelerationAt(vehicle: Vehicle, speed: number, grade: number): number {
    if (!vehicle.engineRunning) return -ROLLING_DECEL_MPS2 - GRAVITY * grade;
    const mass = vehicle.stats.mass;
    const drive = Math.min(
      TRACTION_ACCEL_CAP_MPS2,
      (this.powerShare * vehicle.stats.engine.peakPowerKw * 1000) / (mass * Math.max(speed, 1)),
    );
    return drive - this.resistanceAt(vehicle, speed) - GRAVITY * grade;
  }
  private resistanceAt(vehicle: Vehicle, speed: number): number {
    const dragArea = vehicle.modelDef.dragArea ?? 1;
    return (HALF_AIR_DENSITY * dragArea * speed * speed) / vehicle.stats.mass + ROLLING_DECEL_MPS2;
  }
  /**
   * One step of full throttle on a straight is one measurement of the power share. Only
   * where the power, not the tyres, is the limit — below that the traction cap decides
   * and the step says nothing about the engine.
   */
  private updatePowerShare(vehicle: Vehicle, speed: number, grade: number, lateralAccel: number, dt: number): void {
    const previous = this.powerSampleSpeed;
    this.powerSampleSpeed = speed;
    if (previous < 0 || dt <= 0) return;
    const audio = vehicle.audio;
    const mass = vehicle.stats.mass;
    const peakWatts = vehicle.stats.engine.peakPowerKw * 1000;
    if (
      audio.throttle < 0.95 ||
      vehicle.brakeCommand > 0 ||
      audio.wheelContactFraction < 1 ||
      speed < POWER_SAMPLE_MIN_SPEED_MPS ||
      lateralAccel > POWER_SAMPLE_MAX_LATERAL_MPS2 ||
      (this.powerShare * peakWatts) / (mass * speed) >= TRACTION_ACCEL_CAP_MPS2
    ) {
      return;
    }
    const measured = (speed - previous) / dt;
    // A step that is not one step — the first after re-engaging, say — is not a sample.
    if (Math.abs(measured) > TRACTION_ACCEL_CAP_MPS2 * 2) return;
    const implied =
      ((measured + this.resistanceAt(vehicle, speed) + GRAVITY * grade) * mass * speed) / peakWatts;
    this.powerShare = clamp(
      this.powerShare + (implied - this.powerShare) * Math.min(1, dt / POWER_SHARE_TAU_S),
      POWER_SHARE_MIN,
      POWER_SHARE_MAX,
    );
  }
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
    this.roadBodyShape = physics ? new physics.rapier.Ball(CORRIDOR_MAX_HORIZON_M) : null;
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
   * Metres to a line this driver must stop at, or Infinity. Set by the traffic
   * coordinator every step it applies; see `assignBottleneckTurns` in traffic.ts.
   */
  setHoldDistance(metres: number): void { this.holdDistance = metres; }
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
  /** The lateral manoeuvre committed to, or null while the lane is held; see lateral.ts. */
  get lateralCommitment(): LateralKind | null {
    return this.lateral.kind;
  }
  /** True while a racer is threading the middle, between the cars on either side. */
  get middlePassing(): boolean {
    return this.middlePassingValue;
  }
  /** Supplies the road distance to the nearest approaching vehicle. */
  setOncomingGap(oncomingGap: number): void {
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
  get engaged(): boolean { return this.engagedValue; }
  /** True while a racing driver is on its racing line rather than its lane. */
  get onRacingLine(): boolean { return this.racingActive; }
  /** Rate-limited line being steered to, metres of road lateral. */
  get commandedLine(): number { return this.appliedLateral; }
  /** Distance to the nearest dynamic body in the corridor, metres, or Infinity. */
  get obstacleGap(): number { return this.obstacleGapValue; }
  /** Observed signed along-road speed of that body, m/s. */
  get obstacleSpeed(): number { return this.obstacleSpeedValue; }
  get activity(): AutopilotActivity { return this.activityValue; }
  /** What the driver is in the middle of; see `classifyManoeuvre`. */
  get manoeuvre(): Manoeuvre { return this.manoeuvreValue; }
  /** The named rule that set this step's target speed. */
  get bindingSpeedLimit(): SpeedLimitSource { return this.speedLimit.source; }
  /** The named rule that set this step's throttle. */
  get bindingThrottleLimit(): ThrottleLimitSource { return this.throttleLimit.source; }
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
  /**
   * The pace this driver holds on a clear straight, m/s: its mode's cruise at its own
   * pace, under its speed cap, with the wide-road bonus it last had. No surface, bend
   * or traffic in it; see `roadPaceCeiling` for the road's half.
   */
  get cruisePace(): number {
    return Math.min(MODES[this.modeValue].cruiseMps * this.paceValue, this.speedCapValue) * this.widePaceValue;
  }
  /** Pulled over with the hazards on, waiting out a haboob's dust; see weatherpace.ts. */
  get sheltering(): boolean { return this.shelteringValue; }
  /** The line the plan wants this step, driver frame; see `planLine`. */
  get plannedLine(): number { return this.planLine; }
  /** Whether this driver's mode passes slower cars at all, across the crown or between lanes. */
  get overtakes(): boolean {
    const config = MODES[this.modeValue];
    return config.overtakes || config.lanePasses;
  }
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
    this.laneTrim = 0;
    this.recoveryEscalation = 0;
    this.recoveryLegElapsed = 0;
    this.recoveryLegStalled = 0;
    this.recoveryReversed = 0;
    this.recoveryRoomWait = 0;
    this.yieldReversed = 0;
    this.recoveryCommitted = false;
    this.deadlockPermission = false;
    this.yieldReverse = false;
    this.dynamicBlockerKnown = false;
    this.obstacleGapValue = Infinity;
    this.obstacleSpeedValue = 0;
    this.activityValue = 'cruise';
    this.manoeuvreValue = 'cruise';
    if (!engaged) {
      this.appliedLateral = 0;
      this.planLine = 0;
      this.lateral.reset(0);
    }
  }

  /** Writes controls in-place using a geometric pure-pursuit waypoint. */
  drive(dt: number, vehicle: Vehicle, out: InputFrame, originX: number, originZ: number): void {
    if (!this.engagedValue) return;
    this.driveControls(dt, vehicle, out, originX, originZ);
    this.modulateBrake(dt, vehicle, out);
  }

  /**
   * THRESHOLD BRAKING. None of these cars has ABS, and a pedal held past the tyres'
   * peak locks the wheels: a locked front cannot steer and a locked rear cannot hold
   * the tail. Measured at 30.6 km, cars braking at 0.9 pedal from 140 km/h for the
   * queue at the rock drifted off the asphalt on a 1000 m bend with the wheel turned
   * against the drift. A driver who can feel the lock lets the pedal up until the
   * wheels turn again and squeezes it back on: the pedal is scaled down while any
   * wheel is locked and returns over `ABS_RECOVER_S`.
   */
  private modulateBrake(dt: number, vehicle: Vehicle, out: InputFrame): void {
    const sliding = out.brake > 0 && !out.handbrake && vehicle.speedKmh > ABS_MIN_KMH && vehicle.wheelLocked;
    this.brakeScale = sliding
      ? Math.max(ABS_MIN_SCALE, this.brakeScale * ABS_RELEASE)
      : Math.min(1, this.brakeScale + dt / ABS_RECOVER_S);
    out.brake *= this.brakeScale;
  }

  private driveControls(dt: number, vehicle: Vehicle, out: InputFrame, originX: number, originZ: number): void {
    this.controlledVehicle = vehicle;
    // Autonomy computes the wheel angle it wants and commands the rack with it. Never
    // let a player's device or assist setting reinterpret that command.
    out.steerMode = 'direct';
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
      this.lateral.reset(projection.lateral);
      this.planOverridden = false;
    }
    this.lateral.tick(dt);
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
    this.shelteringValue = shouldShelter(this.shelteringValue);
    if (!this.shelteringValue) this.shelterArrived = false;
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
    //
    // AND BRINGING IT BACK TAKES ROAD. The plan stops using the verge the step a pass on
    // it ends — the car is past, or the pass stalled and gave itself up — while the body
    // is still out there, most of a lane from home, and sometimes still drifting outward
    // on the loose ground. Read as a departure at that step, the car was braked to
    // `OFFROAD_SPEED_MPS` from road speed on the verge: measured on the real road (seed
    // 4) as a racer asking for 13 km/h at 66 km/h, and again at 32 km/h, the step each of
    // two verge passes ended. See `SHOULDER_PASS_RETURN_M`.
    if (this.planUsesShoulder) this.vergeReturnUntil = this.travelled + SHOULDER_PASS_RETURN_M;
    const plannedOntoVerge =
      (this.planUsesShoulder || this.travelled < this.vergeReturnUntil) &&
      Math.abs(projection.lateral) <= staticAvoidEdge;
    if (Math.abs(projection.lateral) > passingEdge && !plannedOntoVerge) {
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
      Math.min(config.brakeAccel, currentPhysicalBrake * config.brakeReserve) +
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
      physicalLateralAccel * config.gripReserve,
    );
    const rotation = vehicle.chassis.rotation();
    const forwardX = 2 * (rotation.x * rotation.z + rotation.w * rotation.y);
    const forwardZ = 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y);
    const forwardSpeed = velocity.x * forwardX + velocity.z * forwardZ;
    this.updatePowerShare(
      vehicle,
      speed,
      currentRoad.grade,
      Math.abs(vehicle.chassis.angvel().y) * speed,
      dt,
    );
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

    // Traffic: the short body-frame scan for anything about to be hit, and the lane
    // probes, in the road's frame, for anything to be followed.
    //
    // The probe asks about the COMMANDED line and, when the car is not on it and is
    // still pointing along the road, about the line the body actually occupies as well.
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
    const horizon = Math.max(
      CORRIDOR_MIN_HORIZON_M,
      obstacleSight,
      Math.min(CORRIDOR_MAX_HORIZON_M, speed * CORRIDOR_HORIZON_SECONDS),
    );
    this.collectRoadBodies(
      vehicle,
      originX,
      originZ,
      PROBE_START_M + Math.max(sight, horizon),
    );
    const pedestrianOnAppliedLine =
      pedestrianGap >= -PEDESTRIAN_RADIUS_M
      && pedestrianGap <= sight
      && Math.abs(pedestrianLateral - this.appliedLateral)
        <= CAR_HALF_WIDTH_M + PEDESTRIAN_RADIUS_M;
    const laneGap = Math.min(
      this.laneProbe(this.appliedLateral, sight),
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
    // A DEPARTURE IS THE BODY GOING PAST WHERE IT WAS SENT, NOT PAST A FIXED LATERAL.
    // At a fixed 1.6 m every planned move outward on a loose road read as one — the
    // lane centre itself is 1.75 — so on gravel a verge pass, an overtake across the
    // crown and a racing line easing out were all braked to walking pace the moment the
    // body moved over at the rate the move was planned at. Reported from play as
    // frantic drivers that went out onto the verge, dithered there and came back. The
    // threshold is the commanded line plus `EDGE_STABILITY_OVERSHOOT_M` when the line
    // is on the body's side, and never nearer than the old 1.6 m: a car sent there and
    // getting there is driving, a car running wide of it is the departure this brakes.
    const commandedOut = projection.lateral * this.appliedLateral > 0 ? Math.abs(this.appliedLateral) : 0;
    const edgeStability =
      looseSurface &&
      !offRoad &&
      Math.abs(projection.lateral) >
        Math.max(EDGE_STABILITY_LATERAL_M, commandedOut + EDGE_STABILITY_OVERSHOOT_M) &&
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
            this.laneProbe(projection.lateral, sight),
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
    const probedLaneGap = lineInOwnLane
      ? Math.min(laneGap, bodyLaneGap)
      : this.laneProbe(ownLaneOffset, sight);
    const probedLaneSpeed = lineInOwnLane
      ? bodyLaneGap < laneGap ? bodyLaneSpeed : laneProbeSpeed
      : this.probeHitSpeed;
    const ownLaneGap = Math.min(
      probedLaneGap,
      pedestrianInOwnLane ? pedestrianGap : Infinity,
    );
    const ownLaneProbeSpeed =
      pedestrianInOwnLane && ownLaneGap === pedestrianGap
        ? pedestrianSpeed
        : probedLaneSpeed;
    const nearestGap = Math.min(this.bodyScanGap, laneGap, bodyLaneGap, ownLaneGap);
    const nearestSpeed = nearestGap === ownLaneGap ? ownLaneProbeSpeed
      : nearestGap === laneGap ? laneProbeSpeed
      : nearestGap === bodyLaneGap ? bodyLaneSpeed
      : bodyScanSpeed;
    this.updateLead(dt, nearestGap, speed, nearestSpeed);
    /**
     * A REAL body on the line this driver is actually using, closing faster than a
     * driver would read as "going the same way as a slightly slower car". Computed
     * here — before the corridor plan, not after it — because the lateral commitment needs it
     * to know when to give up a crossing already in progress; see its own comment.
     */
    const headOn =
      (laneGap < Infinity && laneProbeSpeed < -HEAD_ON_MARGIN_MPS) ||
      (bodyLaneGap < Infinity && bodyLaneSpeed < -HEAD_ON_MARGIN_MPS);
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
    this.collectHorizon = horizon;
    this.hazardPassMargin = PASS_MARGIN_S * speed;
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
    //
    // THE DISTANCE IT HAS TO BE CAUGHT BY IS TWO ANSWERS, WHICHEVER IS LONGER. Two
    // following distances is a headway, which is the right trigger for a leader closing
    // slowly — there is no rush at four metres a second. It is the wrong one for a car
    // arriving on something twenty metres a second slower, where the same two following
    // distances are a second and a half: by the time the driver has seen it, the
    // following envelope has arrived, the line is planned inside the braking zone, and
    // the "pass" begins with a brake. So the reach is also asked for in CLOSING time,
    // and the longer of the two wins — a reach that only ever grows, and only for the
    // arrivals that need it.
    const passClosing = Math.max(
      0,
      speed - Math.max(0, this.corridorLaneBlockSpeed),
    );
    const passReachM = Math.max(
      PASS_APPROACH_REACH * (FOLLOW_STANDOFF_M + speed * comfortHeadwayS),
      FOLLOW_STANDOFF_M + passClosing * PASS_APPROACH_CLOSING_S,
    );
    const passUrge =
      (config.overtakes || config.lanePasses) &&
      this.corridorLaneBlockSpeed > PASS_MIN_SPEED_MPS &&
      this.corridorLaneBlockSpeed < desiredSpeed - PASS_ADVANTAGE_MPS &&
      this.corridorLaneBlockDistance <= passReachM;
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
    // MAY THIS DRIVER PASS ON THE RIGHT THIS STEP? See SHOULDER_PASS_EDGE_MARGIN_M.
    this.shoulderPassAllowed = false;
    this.shoulderPassOverhang = 0;
    if (
      config.racer &&
      lanesPerSide === 1 &&
      this.passingEnabled &&
      !offRoad &&
      !recovering &&
      (passUrge || this.lateral.shoulderPassing) &&
      // A given-up pass keeps the verge only until it is out from alongside.
      (this.lateral.shoulderYielding ? this.shoulderAlongside : !this.lateral.shoulderBarred(this.travelled)) &&
      // The sand is not a lane and rock is not a verge; the grader's spoil on a gravel
      // road IS the road's own material, and the room test below sizes the pass on its
      // 1.1 m strip anyway, so only the two surfaces that are genuinely unfit are barred.
      currentSurface !== SurfaceType.Sand &&
      currentSurface !== SurfaceType.Rock &&
      this.trafficField
    ) {
      this.shoulderLaneOffset = ownLaneOffset;
      this.shoulderSideSign = Math.sign(ownLaneOffset) || -1;
      this.shoulderLeaderGap = Infinity;
      this.trafficField.forEachNear(horizon, 0, this.visitShoulderLeader);
      // THE DECISION TO GO ASKS FOR FIVE SECONDS OF VERGE; THE DECISION TO KEEP GOING
      // ONLY FOR WHAT IS LEFT OF THE PASS. Re-asked at the full figure every step, a
      // prop or a bend coming into view at the far end of the window revoked the grant
      // with the car out beside the leader: the verge line went inadmissible, every line
      // back was vetoed by the car alongside, and nothing admissible is a full stop — on
      // loose ground, beside a moving car, for something a hundred metres beyond where
      // the pass would have ended.
      const entrySightM = clamp(
        speed * SHOULDER_PASS_SIGHT_S,
        SHOULDER_PASS_SIGHT_MIN_M,
        SHOULDER_PASS_SIGHT_MAX_M,
      );
      let sightM = entrySightM;
      if (this.lateral.shoulderPassing && this.shoulderLeaderGap < Infinity) {
        const leftToPass =
          this.shoulderLeaderGap +
          2 * this.shoulderLeaderHalfLength +
          vehicle.modelMeasure.halfExtents[2] +
          RACER_CUT_IN_M;
        const gain = Math.max(speed - this.shoulderLeaderSpeed, SHOULDER_PASS_MIN_GAIN_MPS);
        sightM = clamp(
          (speed * leftToPass) / gain + SHOULDER_PASS_RETURN_M,
          SHOULDER_PASS_SIGHT_MIN_M,
          entrySightM,
        );
      }
      // The line that clears the leader's real flank, and the verge this road has to
      // fit it on.
      const overhangLimit = shoulderWidthM(currentSurface) + SHOULDER_PASS_EDGE_MARGIN_M;
      const passLine =
        this.shoulderLeaderLateral +
        this.shoulderSideSign *
          (this.shoulderLeaderHalfWidth + SHOULDER_PASS_GAP_M + CAR_HALF_WIDTH_M + SHOULDER_PASS_LINE_SLACK_M);
      const overhang = Math.abs(passLine) + CAR_HALF_WIDTH_M - this.asphaltHalfWidth;
      if (
        this.shoulderLeaderGap < Infinity &&
        overhang <= overhangLimit &&
        this.straightAhead(this.hintS, sightM, config.passCurvature) &&
        // A PASS THIS CAR CAN WIN, OR NONE. The grant used to ask only for room; the
        // gain clock then gave up, after three seconds out on the verge, every pass the
        // car could not have won from the start — the verge's own bend speed
        // (`VERGE_LATERAL_ACCEL`: 60 km/h on the 110 m radius `passCurvature` allows)
        // or its cap no faster than the car being passed, or an engine with nothing
        // left at that speed. Entry only: one already out there is judged by its gain.
        (this.lateral.shoulderPassing ||
          this.vergePassWinnable(vehicle, currentRoad.grade, sightM))
      ) {
        this.shoulderVergeBlocked = false;
        this.shoulderPassOverhang = overhangLimit;
        this.hazards.forEachAhead(this.hintS, sightM, this.visitShoulderHazard);
        this.shoulderPassAllowed = !this.shoulderVergeBlocked;
        // The exact line, as a candidate of its own: the search's quarter-metre lattice
        // rounds it outward by up to 0.25 m, which on a road this narrow is the
        // difference between the left wheels on the paint and past the overhang.
        if (this.shoulderPassAllowed) this.laneCentres.push(passLine);
      }
    }
    if (this.shoulderPassAllowed) {
      // The planner measures the verge pass against the car's REAL flank, not the
      // lane-wide band a probe hit is otherwise given: that band alone is wider than
      // the room there is.
      for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i]!;
        if (!o.abeam || o.speed <= CRAWL_SPEED_MPS) continue;
        if ((o.lateral - projection.lateral) * this.shoulderSideSign >= 0) continue;
        obstacles[i] = { ...o, halfWidth: SHOULDER_PASS_BODY_HALF_M + SHOULDER_PASS_GAP_M };
      }
    }
    // MAY THIS DRIVER GO THROUGH THE MIDDLE THIS STEP? See MIDDLE_PASS_*.
    const middleSide = Math.sign(ownLaneOffset) || -1;
    // The band the planner is given for a body it passes or meets through the middle:
    // with its own `CAR_HALF_WIDTH_M` on top, exactly the measured room and no more.
    const middleBandHalf =
      MIDDLE_PASS_BODY_HALF_M + MIDDLE_PASS_GAP_M + vehicle.modelMeasure.halfExtents[0] - CAR_HALF_WIDTH_M - 0.05;
    this.middlePassAllowed = false;
    if (
      config.racer &&
      lanesPerSide === 1 &&
      this.passingEnabled &&
      !offRoad &&
      !recovering &&
      (passUrge || this.middlePassingValue) &&
      this.trafficField
    ) {
      this.shoulderLaneOffset = ownLaneOffset;
      this.shoulderSideSign = middleSide;
      this.shoulderLeaderGap = Infinity;
      this.trafficField.forEachNear(horizon, 0, this.visitShoulderLeader);
      const sightM = clamp(speed * SHOULDER_PASS_SIGHT_S, SHOULDER_PASS_SIGHT_MIN_M, SHOULDER_PASS_SIGHT_MAX_M);
      if (this.shoulderLeaderGap < Infinity && this.straightAhead(this.hintS, sightM, config.passCurvature)) {
        this.middleOwnHalf = vehicle.modelMeasure.halfExtents[0];
        // The line clears the whole queue it goes past, not only the car at its head:
        // the near flank of every one of them, measured, and the widest band this car
        // needs to be past it.
        this.middleQueueLimit = this.shoulderLeaderGap + MIDDLE_PASS_QUEUE_M;
        this.middleQueueEdge = this.shoulderLeaderLateral * middleSide;
        this.trafficField.forEachNear(this.middleQueueLimit, 0, this.visitMiddleQueue);
        this.middleLine =
          middleSide * this.middleQueueEdge -
          middleSide * (MIDDLE_PASS_BODY_HALF_M + MIDDLE_PASS_GAP_M + this.middleOwnHalf);
        // A REAL SHIFT TOWARD THE CROWN, AND NEVER DEEPER THAN THE BORROWED LANE'S
        // MIDDLE. Everything else about the line is the corridor's to admit: one that
        // only reaches over the crown is priced against the cars coming the other way
        // (`straddleAllowed`), one that crosses it is the ordinary crossing
        // (`mayCrossCrown`, and the measured oncoming gap behind it), and both are
        // measured against the real bodies here. A line that hardly leaves the lane is
        // no way past anything, and one past the middle of the opposing lane is not a
        // gap between two cars — it is a second car parked in the oncoming lane.
        if (
          (this.middleLine - ownLaneOffset) * middleSide <= -MIDDLE_PASS_MIN_SHIFT_M &&
          this.middleLine * middleSide >= -Math.abs(ownLaneOffset)
        ) {
          this.middleClear = true;
          this.trafficField.forEachNear(MIDDLE_PASS_LOOK_M, 0, this.visitMiddleNeighbour);
          this.middlePassAllowed = this.middleClear;
        }
        if (this.middlePassAllowed) this.laneCentres.push(this.middleLine);
      }
    }
    if (this.middlePassAllowed) {
      // The car being passed is measured, not given a lane's width: see the leader below.
      for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i]!;
        if (!o.abeam || o.speed <= CRAWL_SPEED_MPS) continue;
        // The car being passed is on the verge side of this one.
        if ((o.lateral - projection.lateral) * middleSide <= 0) continue;
        obstacles[i] = { ...o, halfWidth: Math.min(o.halfWidth, middleBandHalf) };
      }
    }
    // WHAT IS COMING THE OTHER WAY IS AN OBSTACLE LIKE ANY OTHER, AT ITS REAL LATERAL.
    // Everything the planner is otherwise given is a band on a LANE or on the one car
    // it is passing, and a line through the middle is exactly the case where a car
    // coming the other way is not in any of them: priced only by the crossing gate's
    // single measured gap, it would be a head-on the moment that gap closed. At its
    // real lateral it is a body to be steered clear of, like every other, and a gap
    // that closes is braked for, not driven into.
    if ((this.middlePassAllowed || this.middlePassingValue) && this.trafficField) {
      this.middleObstacles = obstacles;
      this.middleObstacleHalf = middleBandHalf;
      this.trafficField.forEachNear(horizon, 0, this.visitMiddleOncoming);
      this.middleObstacles = null;
    }
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
      const leaderMeasured =
        (this.shoulderPassAllowed || this.middlePassAllowed) &&
        Math.abs(this.shoulderLeaderGap - ownLaneGap) < CAR_HALF_LENGTH_M * 2;
      obstacles.push({
        s: ownLaneGap,
        lateral: leaderMeasured ? this.shoulderLeaderLateral : ownLaneOffset,
        halfWidth: leaderMeasured
          ? this.middlePassAllowed
            ? middleBandHalf
            : this.shoulderLeaderHalfWidth + SHOULDER_PASS_GAP_M
          : CAR_HALF_WIDTH_M + AVOID_HYSTERESIS_M,
        speed: ownLaneProbeSpeed,
        movable: true,
      });
    }
    if (probeAdjacentLanes) {
      for (const laneCentre of this.laneCentres) {
        if (laneCentre === ownLaneOffset) continue;
        // The middle line's room is measured from the field, flank to flank; the probe
        // band is the wrong question for a line that exists only between two cars.
        if (this.middlePassAllowed && (laneCentre === this.middleLine || laneCentre === -ownLaneOffset)) continue;
        const laneGapForPlan = this.laneProbe(laneCentre, sight);
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
     * than the real shift needs, and the trigger in `LateralCommitment.step` uses the real one.
     *
     * AND THE DEADLINE IS SET BY CLOSING SPEED, NOT BY THE SPEEDOMETER. A rock is
     * arriving at the speed the car is doing; a car in the lane ahead is arriving at
     * the DIFFERENCE, which behind a leader four metres a second slower is a sixth of
     * it. Priced on the speedometer, a forty-metre gap to a moving leader asked for
     * 4.5 m/s² — the whole grip share — so an overtake was steered like an escape and,
     * worse, the trigger in `LateralCommitment.step` sized on that rate fired sixty-odd metres
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
    // A racer does not ease out to pass: a pass is taken at the manoeuvre's own share of
    // the tyres. Eased, a pass begun from the tail of a car doing nearly the same speed
    // asked for 0.6 m/s² and spent four and a half seconds straddling the crown before
    // it was out — measured on seed 545124. Going round something STANDING keeps the
    // gentle rate: the rate is also what the planner sizes the speed of a bypass on
    // (`manoeuvreSpeed`), and a brisker one only means taking the loose verge faster.
    // A driver with NO feasible corridor gets the full rate too, once the search has
    // said so this step; see the second search after `planCorridor`.
    let lineAccel = config.racer && passUrge
      ? manoeuvreLateralAccel
      : clamp(
          neededLateralAccel,
          Math.min(manoeuvreLateralAccel, LANE_CHANGE_LATERAL_ACCEL),
          manoeuvreLateralAccel,
        );
    /**
     * AND WHETHER IT IS ENTITLED TO LEAVE ITS LANE AT ALL. See `lateralFreedom`.
     *
     * Crossing the crown is `overtakes` and only on a road that has one lane each way;
     * a lane change for pace is `lanePasses`. Getting round something STOPPED is
     * everybody's right, a manoeuvre already latched keeps what it was granted, and a
     * driver with no feasible corridor is not choosing between lanes at all — that
     * last one, like the rate, is granted by the second search after `planCorridor`.
     */
    const entitledToLeaveLane =
      config.lanePasses ||
      (lanesPerSide === 1 && config.overtakes) ||
      ownLaneObstructed ||
      this.lateral.active;
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
    //
    // …EXCEPT FOR THE RACER, which sizes its own pass (`ModeConfig.racer`). The stream
    // tells it where every car is, crest or no crest, so it needs neither the textbook
    // sight nor the six-second commitment: only the road its own pass will use, plus a
    // return, clear of props. It is sized while the driver is held up or already out
    // there, because a pass under way is re-measured every step — see the corridor.
    const passSized =
      config.overtakes &&
      lanesPerSide === 1 &&
      (passUrge || this.planUsesOncomingLane) &&
      this.sizePass(
        vehicle,
        speed,
        ownLaneOffset,
        currentRoad.grade,
        Math.min(this.roadLimitValue, crossingSpeed),
        Math.sqrt(LANE_SHIFT_REFERENCE_M / Math.max(lineAccel, 1e-3)),
        config.racer,
      );
    const mayCrossCrown =
      this.passingEnabled &&
      lanesPerSide === 1 &&
      !this.lateral.crossingBarred(this.travelled) &&
      (config.overtakes || stillBlocker) &&
      (stillBlocker ||
        !this.corridorFeasible ||
        (config.racer
          ? this.crossingLineClear(
              oncomingLine,
              0,
              passSized && Number.isFinite(this.passSecondsValue)
                ? this.passTravelValue + RACER_CROSSING_CLEAR_M
                : crossingCommitM,
            )
          : this.crossingLineClear(oncomingLine, 0, crossingCommitM) &&
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
    // The field carries the truth for every car of the stream and for the player, at
    // any range: the nearest body in the opposing lane and the speed it is actually
    // doing along this driver's direction (negative when it is coming at us). The
    // probe adds the bodies the coordinator does not know about — a parked car, a
    // trailer — and the shorter of the two answers wins.
    this.oncomingScanLine = oncomingLine;
    this.oncomingFieldGap = Infinity;
    this.oncomingFieldSpeed = 0;
    this.trafficField?.forEachNear(horizon, 0, this.visitOncoming);
    const oncomingProbeGap = this.laneProbe(oncomingLine, horizon);
    const oncomingProbeSpeed = this.probeHitSpeed;
    const crossingOncomingGap = Math.min(this.oncomingGap, this.oncomingFieldGap, oncomingProbeGap);
    // What that gap is closing at — measured on the SAME body that set the gap. The
    // probe sees what the field does not (a parked car, a trailer), and pairing its
    // distance with the field's speed for some other car further up priced a stopped
    // trailer as a car coming at full speed, or the reverse. An opposing car that has
    // stopped closes at nothing, and a driver may then take as long over the manoeuvre
    // as the obstruction needs. A gap nobody measured a speed for, and the unseen road
    // beyond the horizon, keep the assumed figure.
    const crossingOncomingSpeed =
      oncomingProbeGap < Infinity && oncomingProbeGap <= this.oncomingFieldGap
        ? Math.max(0, -oncomingProbeSpeed)
        : this.oncomingFieldGap < Infinity
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
    //
    // Nor, for a racer, is a car that has just gone PAST us the other way: it is behind
    // us in that lane and leaving at its own speed plus ours. Read by magnitude, the
    // tail of every oncoming car closed the crown for another second after it had gone,
    // which is the exact second a window behind it opens — measured on seed 545124 as a
    // racer refused the lane behind car after car of a steady oncoming stream. The
    // careful drivers keep the magnitude: their windows are sized on a kickdown they may
    // not have, and that second is margin they spend.
    const rearProbe = this.laneProbe(oncomingLine, ONCOMING_REAR_GAP_M, -1);
    const crossingRearClear =
      rearProbe >= ONCOMING_REAR_GAP_M ||
      (config.racer ? this.probeHitSpeed : Math.abs(this.probeHitSpeed)) <= CRAWL_SPEED_MPS;
    this.lastOncomingGap = crossingOncomingGap;
    this.lastRearClear = crossingRearClear;
    this.lastMayCross = mayCrossCrown;
    this.straddleLaterals.length = 0;
    this.straddleSpeed = speed;
    this.straddleOwnHalf = vehicle.modelMeasure.halfExtents[0];
    this.straddleSide = Math.sign(ownLaneOffset) || -1;
    this.trafficField?.forEachNear(horizon, 0, this.visitStraddle);
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
      shoulderPassOverhang: this.shoulderPassAllowed ? this.shoulderPassOverhang : 0,
      straddleAllowed: this.trafficField && lanesPerSide === 1 ? this.straddleAllowed : undefined,
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
      // The pass measured on this driver's own car; see `sizePass`.
      passSeconds: passSized ? this.passSecondsValue : undefined,
      passTravel: this.passTravelValue,
      passMarginS: config.racer ? RACER_PASS_MARGIN_S : LEGAL_PASS_MARGIN_S,
      // Nothing already coming up the opposing lane behind us: the search only ever
      // looks forward, so this is the one rearward fact it needs.
      crossingRearClear: crossingRearClear,
      stopRoom: MUST_STOP_GAP_M + (speed * speed) / (2 * obstacleBrakeAccel),
      obstacles,
    };
    let proposal = planCorridor(corridorRequest);
    // A DRIVER WITH NO WAY THROUGH GETS THE WHOLE MANOEUVRE, AND IT IS ASKED THIS STEP.
    //
    // No feasible corridor lifts the lane-keeping leash and grants the manoeuvre's full
    // share of the tyres. Both used to be read off LAST step's plan — and the plan they
    // produce is the one that decides whether the corridor is feasible. With the full
    // rate a line round the rock fits, so the corridor reads feasible; the next step
    // plans on the gentle rate, finds the same line too late to finish, reads
    // infeasible, and grants the full rate again. A two-step oscillator: measured on the
    // real road's four-lane stretch (seed 1337, s 40 000), cars swapping between their
    // lane and the verge line EVERY STEP for seconds on end, the indicator with them.
    // So the ordinary question is asked first, and only a step whose ordinary answer
    // has no way through asks again with the whole manoeuvre: what the driver is
    // entitled to is a property of the road this step, not of the answer it produced.
    if (
      !(proposal.admissible && (proposal.feasible || offRoad || recovering)) &&
      (lineAccel < manoeuvreLateralAccel || lateralFreedom < Number.POSITIVE_INFINITY)
    ) {
      lineAccel = manoeuvreLateralAccel;
      corridorRequest.lineAccel = lineAccel;
      corridorRequest.lateralFreedom = Number.POSITIVE_INFINITY;
      proposal = planCorridor(corridorRequest);
    }
    // THROUGH THE MIDDLE IS A DECISION, NOT A LATTICE POINT. Every line between the
    // lane and the crown prices within a lane-cost of every other, so the search
    // settled on whichever quarter-metre was nearest the last one — the crown itself,
    // with the car being passed still in its band — and followed. When the measured
    // line is clearer than what the search chose, it is the answer — and once the car
    // is threading, it stays the answer unless the search finds materially clearer road
    // (`MIDDLE_PASS_KEEP_M`): two lines both clear to the horizon used to be decided by
    // the search's own preference each step, and the car swapped between them.
    if (this.middlePassAllowed && !proposal.usesOncomingLane) {
      const middle = evaluateCorridorLine(corridorRequest, this.middleLine);
      const keep = this.middlePassingValue ? MIDDLE_PASS_KEEP_M : 0;
      if (
        middle.admissible &&
        middle.feasible &&
        (middle.blockDistance > proposal.blockDistance ||
          (keep > 0 && middle.blockDistance >= proposal.blockDistance - keep))
      ) {
        proposal = middle;
      }
    }
    // A CROSSING IS BORROWED FOR ONE CAR AT A TIME, AND GIVEN BACK IN THE GAP.
    //
    // The measured pass is sized to the first slot past the car at the head of the
    // queue (`sizePass`), so one borrow is already meant to be "past this car and into
    // the gap in front of it" rather than "past everything to the horizon". What it
    // never asks is for the lane BACK afterwards: while the opposing lane stays clear
    // a crossing keeps pricing cheaper than the queue, so a racer in a traffic stream
    // rides the wrong side past car after car on one borrow, up to `PASS_MAX_METRES`.
    // A driver threading a queue goes in and out of it instead, and that is also the
    // safer reading of "any available way past": the borrow is a manoeuvre, not a
    // second lane.
    //
    // Two things have to be true for the lane to be worth taking back, and the first
    // is the safety one. The lane home must be admissible — and the corridor's own
    // gates already say the car this crossing was taken for is no longer in the way:
    // the abeam veto refuses to steer into it and the swept test to drive through it,
    // so the admissible line home has its space. It must also leave `HOLD_S` seconds
    // of CLOSING to the next car of the queue, which is the room to be in the lane
    // rather than to brake in it — the follower settles at a headway, and this is a
    // headway of closing — and a car still being passed fails that on its own: the gap
    // to it is metres and closing fast.
    //
    // The second is that there is nothing to gain by staying out. A gap only just
    // longer than the distance at which this driver goes out again is a lane change for
    // its own sake — two of those inside a second is the "cars shuttling between lanes"
    // this file has already been measured into — so the next car of the queue has to be
    // `HOLD_M` past that out-trigger as well. Coming home into a real break in the
    // traffic, staying out through a queue that offers none, and taking the next line
    // from inside the lane every time.
    if (this.planUsesOncomingLane && proposal.usesOncomingLane) {
      const home = evaluateCorridorLine(corridorRequest, ownLaneOffset);
      const homeClosing = Math.max(MIN_CLOSING_MPS, speed - Math.max(0, home.blockSpeed));
      if (
        home.admissible &&
        (home.blockDistance - FOLLOW_STANDOFF_M) / homeClosing >= WEAVE_HOME_HOLD_S &&
        home.blockDistance > passReachM + WEAVE_HOME_HOLD_M
      ) {
        proposal = home;
      }
    }
    this.lastCrossingRefused = proposal.crossingRefused;
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
    // commitment it hands back is what the car actually steers to. See lateral.ts.
    // A pass through the middle follows the room as it is made: the line is re-measured
    // every step from where the two cars actually are.
    const proposalIsMiddle = this.middlePassAllowed && proposal.line === this.middleLine;
    if (proposalIsMiddle && this.lateral.active) this.lateral.retarget(this.middleLine, 'middle');
    const proposedKind: LateralKind = proposal.usesOncomingLane
      ? 'crossing'
      : proposal.usesShoulder && this.shoulderPassAllowed && proposal.laneBlockSpeed > CRAWL_SPEED_MPS
        ? 'shoulder'
        : proposalIsMiddle
          ? 'middle'
          : 'detour';
    const committedLine = this.lateral.step({
      proposed: proposal.line,
      proposedKind,
      ownLateral: projection.lateral,
      laneOffset: ownLaneOffset,
      hintS: this.hintS,
      travelled: this.travelled,
      laneBlockDistance: proposal.laneBlockDistance,
      laneBlockSpeed: proposal.laneBlockSpeed,
      desiredSpeed,
      speed,
      lineAccel,
      crossingRefused: proposal.crossingRefused || proposal.crossingAbandoned || !mayCrossCrown,
      headOn,
      edgeLimit: staticAvoidLine,
      // A pass on the verge closes up first: it is a squeeze past the car, not a
      // momentum pass begun from where a follower would brake.
      passReach:
        config.racer && passUrge && !proposal.usesShoulder
          ? PASS_APPROACH_REACH * (FOLLOW_STANDOFF_M + speed * comfortHeadwayS)
          : 0,
      retryM: config.racer ? RACER_CROSSING_RETRY_M : CROSSING_RETRY_METRES,
      retryS: config.racer ? RACER_CROSSING_RETRY_S : CROSSING_RETRY_S,
    });
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
        : this.shelteringValue
          // SHELTERING: the outer edge of the asphalt on this driver's own side, the
          // wheels still on it — the verge is where props and soft sand are.
          ? Math.sign(ownLaneOffset || 1) * Math.max(
              Math.abs(ownLaneOffset),
              this.asphaltHalfWidth - CAR_HALF_WIDTH_M - SHELTER_EDGE_MARGIN_M,
            )
          : committedLine;
    // Recovery retains its existing verge allowance, but never bypasses traffic
    // entry constraints. Evaluate whichever override will actually steer the car.
    if (offRoad || recovering || this.travelled < this.recoveryBiasUntil) {
      corridorRequest.edgeLimit = Math.max(staticAvoidLine, recoveryLineLimit, Math.abs(desiredLine));
      corridorRequest.lateralFreedom = Number.POSITIVE_INFINITY;
    } else if (this.shelteringValue) {
      // Pulling over is a move to the edge of its own side, not a lane change.
      corridorRequest.edgeLimit = Math.max(corridorRequest.edgeLimit, Math.abs(desiredLine));
      corridorRequest.lateralFreedom = Number.POSITIVE_INFINITY;
    }
    // Reconcile the commitment/override once. Both it and the search proposal
    // already carry the speed cap used to admit their crossing window.
    let plan = evaluateCorridorLine(corridorRequest, desiredLine);
    // A COMMITMENT THAT CANNOT STOP IN TIME HANDS THE LINE TO THE SEARCH — AND DOES NOT
    // TAKE IT BACK ON THE STEP IT SCRAPES IN AGAIN.
    //
    // "Feasible" is a wall further off than the stopping room, and a driver braking
    // behind somebody sheds that room as fast as it closes on the wall: measured on the
    // four-lane stretch at seed 1337, a car with a rock 170 m ahead in its lane read its
    // lane feasible, infeasible, feasible on alternate steps by a few decimetres, and
    // swapped between its lane and the line round the rock on every one of them. So
    // the lane it was handed away from is taken back only with the stopping room and
    // `DETOUR_RELEASE_MARGIN_M` to spare: the same order of thresholds the latch keeps.
    const searchFeasible = proposal.admissible && proposal.feasible;
    let commitmentHolds = plan.feasible;
    if (commitmentHolds && this.planOverridden && searchFeasible && proposal.line !== desiredLine) {
      const stopRoom = corridorRequest.stopRoom;
      corridorRequest.stopRoom = stopRoom + DETOUR_RELEASE_MARGIN_M;
      commitmentHolds = evaluateCorridorLine(corridorRequest, desiredLine).feasible;
      corridorRequest.stopRoom = stopRoom;
    }
    this.planOverridden = plan.admissible && !commitmentHolds && searchFeasible;
    if (!plan.admissible || this.planOverridden) {
      this.lateral.release();
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
    // THE RACING LINE REPLACES THE LANE ONLY ON AN EMPTY ROAD. The planner has to want
    // the home lane, nothing may be followed, and nothing may stand on the asphalt on
    // this side within the corridor horizon — the planner, not the line, goes round
    // things. Traffic coming the other way does not stop it; it only takes the far
    // half away (`racingCrownClearM`).
    this.racingQuietFor = this.activityValue === 'cruise' ? this.racingQuietFor + dt : 0;
    const racingEligible =
      config.racingLine &&
      !offRoad &&
      !recovering &&
      this.travelled >= this.recoveryBiasUntil &&
      plan.admissible &&
      plan.feasible &&
      speed > RACING_MIN_SPEED_MPS &&
      Math.abs(desiredLine - ownLaneOffset) < RACING_HOME_TOLERANCE_M &&
      this.corridorBlockDistance === Number.POSITIVE_INFINITY &&
      !this.racingObstructed(obstacles) &&
      // A racing line is picked up from the driver's own lane, after a spell of plain
      // cruising — never as the continuation of a pass it has just come back from.
      // Taken up straight out of one, the line began in the opposing half, the next
      // car re-opened the pass, and the two traded the car between them at 150 km/h.
      (this.racingActive ||
        (this.racingQuietFor >= RACING_REARM_S &&
          Math.abs(this.appliedLateral - ownLaneOffset) < RACING_HOME_TOLERANCE_M));
    if (racingEligible) {
      const window = clamp(
        RACING_WINDOW_BASE_M + speed * RACING_WINDOW_SECONDS,
        RACING_WINDOW_MIN_M,
        RACING_WINDOW_MAX_M,
      );
      this.racingOwnSign = Math.sign(ownLaneOffset) || -1;
      this.racingBodyHalfWidth = vehicle.modelMeasure.halfExtents[0];
      this.racingEdgeMargin = RACING_EDGE_MARGIN_M + speed * RACING_EDGE_MARGIN_S;
      this.racingHomeLane = homeLane;
      this.racingOwnCarriageway = true;
      for (const obstacle of obstacles) {
        if (obstacle.abeam || obstacle.lateral * this.racingOwnSign > 0) {
          this.racingOwnCarriageway = false;
          break;
        }
      }
      this.racingHazardM = Number.POSITIVE_INFINITY;
      this.hazards.forEachAhead(this.hintS, window, this.visitRacingHazard);
      // The far half: in sight, clear of props, and vacated before anything coming
      // the other way can be there. An unseen car is assumed just past the corridor
      // horizon, doing the speed every unseen car is assumed to do.
      let crownClear = 0;
      if (lanesPerSide === 1 && this.passingEnabled && config.overtakes && crossingRearClear) {
        const gap = Math.min(crossingOncomingGap, horizon);
        const closing = crossingOncomingSpeed;
        const meet = (gap - closing * RACING_ONCOMING_MARGIN_S) / (1 + closing / Math.max(speed, 1));
        crownClear = Math.min(this.road.sightDistanceAt(this.hintS, window), meet) - RACING_CROWN_RETURN_M;
        for (const obstacle of obstacles) {
          if (!obstacle.abeam && obstacle.s >= 0 && obstacle.lateral * this.racingOwnSign < 0) {
            crownClear = Math.min(crownClear, obstacle.s - RACING_CROWN_RETURN_M);
          }
        }
        if (crownClear > 0 && !this.crossingLineClear(-ownLaneOffset, 0, crownClear + RACING_CROWN_RETURN_M)) {
          crownClear = 0;
        }
      }
      this.racingCrownClearM = Math.max(0, crownClear);
      const startOffset = this.racingActive ? this.racingLine.offsetAt(this.hintS) : this.appliedLateral;
      const startSlope = this.racingActive
        ? this.racingLine.slopeAt(this.hintS)
        : this.lineSlewRate / Math.max(speed, 1);
      this.racingLine.solve(this.road, this.hintS, window, startOffset, startSlope, this.racingBand);
      this.racingActive = true;
    } else if (this.racingActive) {
      this.racingActive = false;
      this.racingLine.reset();
    }
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
    // The pass lasts until the passed car is behind, not until the forward probe
    // loses it: alongside, only the abeam query still sees it, and the pace cap below
    // has to hold there most of all.
    let passedAlongside = Number.POSITIVE_INFINITY;
    for (const obstacle of obstacles) {
      if (!obstacle.abeam || obstacle.speed <= CRAWL_SPEED_MPS) continue;
      if ((obstacle.lateral - projection.lateral) * this.shoulderSideSign >= 0) continue;
      passedAlongside = Math.min(passedAlongside, obstacle.speed);
    }
    this.shoulderAlongside = passedAlongside < Infinity;
    this.lateral.stepShoulder(
      this.shoulderPassAllowed,
      this.planUsesShoulder,
      plan.laneBlockSpeed,
      passedAlongside,
      this.shoulderAlongside || Math.abs(projection.lateral - desiredLine) <= SHOULDER_PASS_OUT_M,
      speed,
      dt,
      this.travelled,
    );
    // Through the middle for as long as the car being passed is still alongside or
    // ahead on the line the planner chose; see MIDDLE_PASS_*.
    let middleAlongside = false;
    for (const obstacle of obstacles) {
      if (!obstacle.abeam || obstacle.speed <= CRAWL_SPEED_MPS) continue;
      if ((obstacle.lateral - projection.lateral) * middleSide <= 0) continue;
      middleAlongside = true;
    }
    this.middlePassingValue =
      !offRoad &&
      !recovering &&
      !plan.usesOncomingLane &&
      !plan.usesShoulder &&
      ((this.middlePassAllowed && Math.abs(plan.line - this.middleLine) < 0.3) ||
        (this.middlePassingValue &&
          middleAlongside &&
          (projection.lateral - ownLaneOffset) * middleSide < -MIDDLE_PASS_MIN_SHIFT_M));
    // Something standing still beside the corridor is gone past at the speed the gap
    // to it supports; see `PASS_MARGIN_S`. A prop's width already carries the margin
    // asked for at this speed, so a line the planner fitted costs no speed at all.
    this.corridorSqueezeSpeed = Number.POSITIVE_INFINITY;
    for (const obstacle of obstacles) {
      // A car alongside is not a squeeze: it is beside the corridor, not in it, and
      // pricing it here put every driver with a neighbour at walking pace.
      if (obstacle.abeam || obstacle.speed > CRAWL_SPEED_MPS || obstacle.s < 0) continue;
      const gap =
        Math.abs(obstacle.lateral - plan.line) -
        obstacle.halfWidth -
        CAR_HALF_WIDTH_M +
        AVOID_HYSTERESIS_M +
        (obstacle.movable ? 0 : this.hazardPassMargin);
      const passSpeed = Math.max(AVOIDANCE_CRAWL_MPS, (gap - PASS_GAP_MIN_M) / PASS_MARGIN_S);
      this.corridorSqueezeSpeed = Math.min(
        this.corridorSqueezeSpeed,
        Math.sqrt(
          passSpeed * passSpeed +
            2 * obstacleBrakeAccel * Math.max(0, obstacle.s - config.brakeLead),
        ),
      );
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
    // A car on its racing line is not changing lanes, however far it moves across; and
    // a racer tells nobody anything.
    vehicle.setIndicator(
      this.shelteringValue
        ? 'hazard'
        : config.racer || this.racingActive || Math.abs(indicatorDelta) < threshold
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
    const lineError = desiredLine - this.appliedLateral;
    // GIVING THE OPPOSING LANE BACK (see `RETURN_BRISK_BELOW_MPS`): the line or the body
    // is past the crown and the line is on its way home.
    const ownSign = Math.sign(ownLaneOffset || -1);
    const comingHome =
      (onWrongSide || this.appliedLateral * ownSign < 0) && lineError * ownSign > 0;
    const smoothReturn = clamp(
      (speed - RETURN_BRISK_BELOW_MPS) / (RETURN_SMOOTH_ABOVE_MPS - RETURN_BRISK_BELOW_MPS),
      0,
      1,
    );
    const slewAccel = comingHome
      ? Math.max(
          lineAccel,
          currentLateralAccel * RETURN_GRIP_SHARE * (1 - smoothReturn) + lineAccel * smoothReturn,
        )
      : lineAccel;
    const headingCeiling = comingHome
      ? RETURN_HEADING_SLOPE + (LINE_SHIFT_PER_METRE - RETURN_HEADING_SLOPE) * smoothReturn
      : LINE_SHIFT_PER_METRE;
    const lineRateCeiling = Math.max(
      headingCeiling * speed,
      LINE_SLEW_AT_REST_MPS,
      onWrongSide && headOn ? LINE_SLEW_ESCAPE_MPS : 0,
    );
    const lineRateTarget =
      Math.sign(lineError) *
      Math.min(lineRateCeiling, Math.sqrt(2 * slewAccel * Math.abs(lineError)));
    const lineRateStep = slewAccel * Math.max(dt, 0);
    this.lineSlewRate += clamp(lineRateTarget - this.lineSlewRate, -lineRateStep, lineRateStep);
    // Never past the line: the braking curve above is what makes that possible, and
    // this is what makes a target that jumps to the other side stop the line rather
    // than sail through it while the rate reverses.
    const appliedBefore = this.appliedLateral;
    this.appliedLateral += clamp(
      this.lineSlewRate * Math.max(dt, 0),
      Math.min(0, lineError),
      Math.max(0, lineError),
    );
    // What the line actually did this step. `lineSlewRate` is only the rate it was
    // allowed; clamped at its target, the line stops while that rate is still winding
    // down, and leading on it steered the car on past a line that had already stopped.
    let appliedLineRate = dt > 0 ? (this.appliedLateral - appliedBefore) / dt : 0;
    // On the racing line the line is the line, at this arclength, moving at its slope.
    if (this.racingActive) {
      this.appliedLateral = this.racingLine.offsetAt(this.hintS);
      appliedLineRate = this.racingLine.slopeAt(this.hintS) * speed;
      this.lineSlewRate = appliedLineRate;
    }
    // Pure pursuit through a point ON the lane still cuts the bend: the chord to a
    // point `d` along an arc of curvature k passes k·d²/8 inside it, which in the
    // 110 m esses is a metre and a half — the car left its lane, and on the real road
    // it was the reason a "careful" mode sat 1.9 m off the centreline on average.
    // Moving the aim point OUTWARD by that sagitta makes the commanded arc the
    // lane's own arc, so the mode follows the corner instead of straightening it.
    // Curvature is taken mid-preview, where the chord error is generated.
    const previewCurvature = this.racingActive
      ? this.racingLine.pathCurvatureAt(this.hintS + lookahead * 0.5)
      : this.road.curvatureAt(this.hintS + lookahead * 0.5);
    const chordShift =
      -previewCurvature *
      lookahead *
      lookahead *
      0.125 *
      config.chordGain;
    const lateralLimit = this.planUsesShoulder ? staticAvoidEdge : passingEdge;
    const targetLateral = clamp(
      (this.racingActive ? this.racingLine.offsetAt(this.hintS + lookahead) : this.appliedLateral) + chordShift,
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
    // Road-frame lateral velocity: the lateral axis is (cos h, −sin h), see `offsetPoint`.
    const lateralRate = velocity.x * roadForwardZ - velocity.z * roadForwardX;
    const holdError =
      this.appliedLateral -
      projection.lateral +
      (appliedLineRate - lateralRate) * LANE_HOLD_LEAD_S;
    const holdCurvature = clamp(
      (2 * holdError) / (holdDistance * holdDistance),
      -holdCap,
      holdCap,
    );
    // THE WIND IS HELD OFF BY STEERING INTO IT, AND A PROPORTIONAL HOLD CANNOT DO THAT.
    // A steady side push — a crosswind, the road's camber — needs a steady wheel angle,
    // and the hold above only produces one while it is off its line: the car settles
    // as far downwind as it takes to earn the steer. A driver leans on the wheel
    // instead. `laneTrim` is that lean, an integral of the cross-track error at a
    // time constant of `LANE_TRIM_TAU_S` on the hold's own gain, for every mode. It
    // learns only while the line is still (a lane change is not a push), is bounded to
    // `LANE_TRIM_ACCEL_MPS2` of lateral authority, and leaks so it lets go once the
    // wind does.
    const lineStill = Math.abs(appliedLineRate) < LANE_TRIM_LINE_RATE_MPS && Math.abs(holdError) < 1;
    if (speed > 5 && !offRoad && !recovering) {
      const trimCap = LANE_TRIM_ACCEL_MPS2 / Math.max(speed * speed, 1);
      const learn = lineStill ? (2 * holdError) / (holdDistance * holdDistance) / LANE_TRIM_TAU_S : 0;
      this.laneTrim = clamp(this.laneTrim + (learn - LANE_TRIM_LEAK * this.laneTrim) * dt, -trimCap, trimCap);
    } else {
      this.laneTrim = 0;
    }
    const pathCurvature = pursuitCurvature + holdCurvature + this.laneTrim;
    // Feed-forward preserves the cornering authority proven by the tyre model. The
    // second term is zero in a settled turn but opposes residual yaw after a lane
    // change, preventing the delayed tyres from amplifying a weave into a spin.
    const actualYawCurvature = vehicle.chassis.angvel().y / Math.max(speed, 3);
    // See `ModeConfig.curvatureTrim`. It leaks, so a trim earned in one bend does not
    // steer the next, and it is bounded to a share of the curvature being asked for.
    if (config.curvatureTrim > 0 && speed > 5 && !offRoad && !recovering) {
      const trimLimit = CURVATURE_TRIM_SHARE * Math.abs(pathCurvature) + CURVATURE_TRIM_FLOOR;
      this.curvatureTrim = clamp(
        this.curvatureTrim +
          (config.curvatureTrim * (pathCurvature - actualYawCurvature) -
            CURVATURE_TRIM_LEAK * this.curvatureTrim) *
            dt,
        -trimLimit,
        trimLimit,
      );
    } else {
      this.curvatureTrim = 0;
    }
    const controlledCurvature =
      pathCurvature * config.steeringGain +
      YAW_RATE_DAMPING * (pathCurvature - actualYawCurvature) +
      this.curvatureTrim;
    const wheelAngle = Math.atan(wheelbaseOf(vehicle) * controlledCurvature);
    out.steer = vehicle.steeringInputForWheelAngle(wheelAngle);

    // Build a local speed profile rather than applying one worst bend to the whole
    // horizon. Every sample contributes its surface, decay, grade and curvature;
    // braking distance then propagates that local limit back to the car.
    //
    // `crossingSpeed` ONLY while the plan is actually committed to the other lane.
    // The gate sizes the manoeuvre on that number, so the pedal has to deliver it out
    // there; spending it on the APPROACH as well simply arrives at the back of a queue
    // 4 m/s faster, and the rear-end that follows is what launched bodies below the
    // road in the real-road bench — 65 km/h into a car doing 3.
    // A crossing the planner has given up (`crossingAbandoned`) is not a pass any more,
    // and gets no kickdown: see the drop-back below.
    const usingPassingLine = plan.admissible &&
      !plan.crossingAbandoned &&
      Math.abs(plan.line - ownLaneOffset) >= DETOUR_MIN_M &&
      (plan.usesOncomingLane || (passAttempt && !plan.usesShoulder));
    const clearRoadSpeed = usingPassingLine ? crossingSpeed : desiredSpeed;
    this.passAttemptValue = passAttempt && usingPassingLine;
    // What is left of the cornering budget once a pending lateral manoeuvre has taken
    // its share. A manoeuvre cap below the driver's own pace means that grip is
    // being spent on a pending lateral move rather than entirely on the bend.
    const manoeuvreShare =
      plan.manoeuvreSpeed < desiredSpeed - 0.1 ? 1 - MANOEUVRE_LATERAL_SHARE : 1;
    // Long enough to shed the whole speed on the share of the distance the plan brakes
    // over (`brakingDistanceShare`): a bend whose limit needs that much road has to be in
    // the profile when the braking for it starts, not when it is already late.
    const turnLookahead = Math.max(
      lookahead,
      config.curveLead +
        config.brakeLead +
        (speed * speed) / (2 * currentBrakeAccel * config.brakingDistanceShare),
    );
    let targetSpeed = this.speedLimit.reset(clearRoadSpeed, 'road');
    let upcomingCurvature = Math.abs(currentRoad.curvature);
    const samples = ROAD_PROFILE_SAMPLES;
    const profileDistance = this.profileDistance;
    const profileLimit = this.profileLimit;
    const profileBrake = this.profileBrake;
    const profileGrip = this.profileGrip;
    const profileCurvature = this.profileCurvature;
    const profileGrade = this.profileGrade;
    for (let i = 0; i <= samples; i++) {
      const distance = (turnLookahead * i) / samples;
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
      const physicalLateral =
        vehicle.estimatedLateralAccel(surface, Math.max(speed, clearRoadSpeed)) *
        Math.sqrt(Math.max(0.35, 1 - sampleGradeLoad * sampleGradeLoad));
      const lateralAccel =
        Math.min(config.lateralAccel, physicalLateral * config.gripReserve) * manoeuvreShare;
      // On the racing line a bend is taken at the LINE's curvature, which is the
      // whole point of it; past the solved window, at the road's. A tight bend is the
      // exception, and `bendSpeed` says how.
      const roadCurvature = Math.abs(sample.curvature);
      const curvature =
        this.racingActive && this.racingLine.covers(sample.s)
          ? Math.abs(this.racingLine.pathCurvatureAt(sample.s))
          : roadCurvature;
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
      const bank = GRAVITY * Math.abs(this.road.bankingAt(sample.s));
      // `bendSpeed` is `sqrt((lateral + bank) / curvature)` for the careful modes; for
      // the racer it also takes a tight bend on the road's curvature and its
      // `tightBendShare` of the tyres.
      let localLimit = Math.min(
        straightLimit,
        bendSpeed(this.modeValue, lateralAccel, bank, curvature, roadCurvature),
      );
      // OVER A CREST THE TYRES PRESS WITH LESS THAN THE CAR'S WEIGHT.
      //
      // Driven at `v` over a vertical curvature `kv`, the body is accelerating DOWN at
      // `v²·kv`, so the wheels carry `g - v²·kv` of it, and every grip figure above —
      // cornering and braking alike — scales with that load. The road's crests are
      // 560 m of radius at their sharpest: at 160 km/h that is 0.35 g gone, which is a
      // bend after a crest taken on two thirds of the tyres it was planned on, or a
      // car that leaves the road. The curvature is the profile's own: the change of
      // grade from the sample before this one, positive over a crest.
      const crest = i === 0 ? 0 : -(sample.grade - profileGrade[i - 1]!) / (distance - profileDistance[i - 1]!);
      profileGrade[i] = sample.grade;
      profileDistance[i] = distance;
      if (crest > 0) {
        // Never so fast that the crest takes more than `CREST_UNLOAD_MAX` of the
        // weight, and through a bend on the crest at the grip the load leaves.
        localLimit = Math.min(localLimit, Math.sqrt((CREST_UNLOAD_MAX * GRAVITY) / crest));
        const load = 1 - (localLimit * localLimit * crest) / GRAVITY;
        localLimit = Math.min(
          localLimit,
          bendSpeed(this.modeValue, lateralAccel * load, bank, curvature, roadCurvature),
        );
      }
      profileLimit[i] = localLimit;
      profileGrip[i] = physicalLateral;
      profileCurvature[i] = curvature;
      profileBrake[i] = Math.min(config.brakeAccel, physicalBrake * config.brakeReserve);
    }
    // THE BRAKING ZONE IS PLANNED ON WHAT THE TYRES HAVE LEFT FOR IT.
    //
    // Each point's own limit is carried back toward the car one segment at a time, and
    // a segment brakes on the friction ellipse: the share of the braking capacity left
    // once the bend it is in has taken `v²·curvature` of the cornering capacity, never
    // less than `BEND_BRAKE_SHARE_FLOOR` — the same split the pedal is held to below,
    // so the plan never asks the pedal for a deceleration it will not be allowed. The
    // old envelope braked at full capacity right up to a bend's own limit point, while
    // a road's bends ramp in over tens of metres: measured on seed 42's esses, a frantic
    // car arrived 40 km/h over the corner's speed with the curve already building, stood
    // on 0.8 of the pedal at 0.65 of its cornering grip on a 3% descent, and spun.
    //
    // The crest takes its share here too, at the speed the segment is entered at.
    let reach = profileLimit[samples]!;
    for (let i = samples - 1; i >= 0; i--) {
      const near = Math.max(0, profileDistance[i]! - config.curveLead);
      const far = Math.max(0, profileDistance[i + 1]! - config.curveLead);
      const run = (far - near) * config.brakingDistanceShare;
      const exit = reach;
      if (run > 0) {
        const curvature = Math.max(profileCurvature[i]!, profileCurvature[i + 1]!);
        const grip = Math.min(profileGrip[i]!, profileGrip[i + 1]!);
        const friction = Math.min(profileBrake[i]!, profileBrake[i + 1]!);
        const grade = (profileGrade[i]! + profileGrade[i + 1]!) * 0.5;
        const crest = Math.max(0, -(profileGrade[i + 1]! - profileGrade[i]!) / Math.max(profileDistance[i + 1]! - profileDistance[i]!, 1));
        // Twice: the entry speed found with the exit's load is a better guess at the
        // load the entry has, and the second answer is the lower one.
        let entry = exit;
        for (let pass = 0; pass < 2; pass++) {
          const load = Math.max(1 - CREST_UNLOAD_MAX, 1 - (entry * entry * crest) / GRAVITY);
          const cornering = (entry * entry * curvature) / Math.max(grip * load, 1e-3);
          const share = Math.max(BEND_BRAKE_SHARE_FLOOR, Math.sqrt(Math.max(0, 1 - cornering * cornering)));
          const decel = Math.max(MIN_PLANNED_BRAKE_MPS2, friction * load * share + grade * GRAVITY);
          entry = Math.sqrt(exit * exit + 2 * decel * run);
        }
        reach = entry;
      }
      reach = Math.min(reach, profileLimit[i]!);
    }
    targetSpeed = this.speedLimit.limit(reach, 'road');
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
    // …EXCEPT FOR A DRIVER WHO GOES FAST ENOUGH FOR IT TO MATTER. At a racing driver's
    // pace a crest hides a car that cannot be lost in the road that is left: measured
    // on the playground, 150 km/h over a blind crest on a 25% descent found a car doing
    // 53 at 80 m, and the only braking that could avoid it put the car off the road.
    // So it never goes faster than it could slow to the slowest moving traffic in the
    // road it can see over the profile, on a share of its brakes that leaves the tyres
    // something for the bend. A bend is not a limit on it: the lane probe follows the
    // road round it and finds a car wherever the road puts it.
    if (config.racingLine) {
      const sight = this.road.sightDistanceAt(this.hintS, RACING_SIGHT_LIMIT_M);
      const sightBrake = Math.max(MIN_PLANNED_BRAKE_MPS2, currentBrakeAccel * RACING_SIGHT_BRAKE_SHARE);
      targetSpeed = this.speedLimit.limit(
        RACING_UNSEEN_TRAFFIC_MPS + Math.sqrt(2 * sightBrake * Math.max(0, sight - FOLLOW_STANDOFF_M)),
        'sight',
      );
    }
    // The 3 m/s floor is the road profile's (a hairpin never asks for a standstill),
    // and it must not swallow a cap set from outside: a race rival told to stop beside
    // its courier was held at 11 km/h by it, creeping past the courier for good.
    this.speedLimit.atLeast(3);
    targetSpeed = this.speedLimit.limit(this.speedCapValue, 'speed-cap');
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
    this.roadLimitValue = roadLimitSpeed;
    // A PASS GIVEN UP IS GIVEN UP BEHIND THE CAR IT WAS PASSING.
    //
    // While that car is still level the way home is vetoed (the abeam rule), and the
    // crossing line is the only admissible one — so without this the speed plan drove
    // it at the pass's own pace, alongside, until the car coming the other way arrived.
    // Dropping a little under its speed opens the lane behind it in a second or two,
    // and the planner takes it the moment it opens.
    let dropBackSpeed = Number.POSITIVE_INFINITY;
    if (plan.crossingAbandoned) {
      for (const obstacle of obstacles) {
        if (!obstacle.abeam || obstacle.trailing || obstacle.speed <= CRAWL_SPEED_MPS) continue;
        if (Math.abs(obstacle.lateral - ownLaneOffset) >= obstacle.halfWidth + CAR_HALF_WIDTH_M) continue;
        dropBackSpeed = Math.min(dropBackSpeed, obstacle.speed - ABANDON_DROP_BACK_MPS);
      }
    }
    // The speed the way round the obstruction can actually be taken at, the speed that
    // lets the car beside us come across, and the drop-back. All are braking for
    // something in the way, so they belong on THIS side of `roadLimitSpeed`: the pedal
    // that serves them is the capped obstacle brake, not the mode's full ceiling for a
    // bend.
    targetSpeed = this.speedLimit.limit(
      Math.min(plan.manoeuvreSpeed, mergeYieldSpeed, Math.max(AVOIDANCE_CRAWL_MPS, dropBackSpeed)),
      'manoeuvre',
    );
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
      // A RACER BRAKES ONTO A MOVING CAR, NOT ONTO WHERE IT STANDS NOW. The absolute
      // envelope plans the stop as if the leader stood still at its speed, so it charges
      // the road the leader itself covers while the gap closes: arriving at 120 km/h on
      // a car doing 50, at a planned 4 m/s², that is braking from 115 m back instead of
      // 47, and then rolling up the rest of the way. Relative closing is what a racer's
      // "last useful metre" means; the careful drivers keep the margin, and full pedal
      // beyond `OBSTACLE_BRAKE_MAX` plus the emergency reflex stay behind both.
      const braking = config.racer && blockSpeed > CRAWL_SPEED_MPS
        ? blockSpeed + Math.sqrt(2 * obstacleBrakeAccel * room)
        : Math.sqrt(blockSpeed * blockSpeed + 2 * obstacleBrakeAccel * room);
      // Something STILL in the corridor is approached at walking pace, not stopped
      // for: the car is going to ease past it, and a littered road is otherwise a
      // continuous emergency stop — measured at 0.9 m/s against a 30 m/s cruise,
      // with a clear line through the whole field the entire time.
      //
      // AND THE CRAWL IS A CRAWL, not whatever the manoeuvre limit happens to be. This
      // floor used to be the manoeuvre limit, which was always a walking pace whenever
      // anything was being gone round; now that the manoeuvre limit only prices what
      // the commanded line CLEARS, a thing the line does not clear left the floor at
      // the driver's full pace and the clamp did nothing at all. Measured on the
      // boxed-in bench: a car that used to stop 4.2 m short of a rock it could not get
      // round crept into it instead.
      //
      // BUT THE CRAWL IS FOR EASING PAST, NOT FOR LEANING ON, and it may never be
      // faster than the car can still stop at `STILL_BLOCK_STANDOFF_M` short. A crawl
      // floor above the braking envelope is a promise to arrive: this used to switch
      // the target from the crawl to zero only once the corridor had failed AND the
      // nose was 1.5 m out, and 3.5 m/s at the planned brake needs 2.4 m. Measured on
      // the real road with the stream's own scenery contacts counted: every one was a
      // car rolling at 12-13 km/h from nine metres out onto a rock it had been braking
      // for the whole way — waiting for an oncoming car with its line still in the
      // lane, or steering out onto the verge on a line that could not finish in time.
      // Capped, the first stops and waits, and the second slows until its own swept
      // path clears the thing (see `sweptOverlap`) and eases round at that speed.
      //
      // AND THE CAP IS ONE THE PEDAL CAN FOLLOW. The brake is proportional — the
      // obstacle pedal is the speed error over `brakeBand` — so a stopping envelope in
      // the square root of the distance is never tracked: the error that asks for the
      // brake only exists once the car is already too fast for the road left. Measured:
      // a cautious driver planned 2.6 m/s² and shed 1.7. A target falling LINEARLY with
      // the road left, `v = k·x`, is tracked by that loop as a damped second-order
      // system (x'' + c·x' + c·k·x = 0, with c the loop's decel per m/s of error), and
      // `k = c/4` is the fastest gain at which the nose never passes the stop point.
      // The pedal delivers `obstacleBrakeAccel` at OBSTACLE_BRAKE_MAX, so
      // c = obstacleBrakeAccel / (OBSTACLE_BRAKE_MAX · brakeBand).
      //
      // The taper lands on `HOLD_TARGET_MPS` AT the standoff, not on zero. Below that
      // target the car stands on the hold brake, so a taper to zero parked it 1/k
      // short — metres, outside the stopping room — where the corridor read as open,
      // the stall was never seen, and on the bench's boulder across the whole road the
      // car waited in front of it for good instead of backing out and trying again.
      const standoffRoom = this.corridorBlockDistance - STILL_BLOCK_STANDOFF_M;
      const approachGain = obstacleBrakeAccel / (4 * OBSTACLE_BRAKE_MAX * config.brakeBand);
      const stillLimit = standoffRoom > 0
        ? Math.min(
            Math.max(AVOIDANCE_CRAWL_MPS, braking),
            Math.sqrt(2 * obstacleBrakeAccel * standoffRoom),
            HOLD_TARGET_MPS + approachGain * standoffRoom,
          )
        : 0;
      targetSpeed = this.speedLimit.limit(blockSpeed > CRAWL_SPEED_MPS ? braking : stillLimit, 'corridor-block');
      if (blockSpeed > CRAWL_SPEED_MPS) {
        // Moving: keep a time headway behind it.
        const headwayGap =
          followStandoffM + speed * followHeadwayS;
        targetSpeed = this.speedLimit.limit(
          Math.max(0, blockSpeed + (this.corridorBlockDistance - headwayGap) / FOLLOW_RELAX_S),
          'follow',
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
      targetSpeed = this.speedLimit.limit(
        Math.max(laneSpeed, laneSpeed + this.corridorLaneBlockDistance / secondsToClear),
        'lane-clearance',
      );
    }
    targetSpeed = this.speedLimit.limit(this.corridorSqueezeSpeed, 'squeeze');
    // A verge pass is a speed floor, not another upper limit. The corridor may still
    // carry the moving leader's follow/squeeze target after the shoulder line has been
    // selected; using `limit` here preserved that lower target, so frantic cars moved
    // onto the verge and then simply matched the leader. Raise the target to the
    // leader-plus-advantage speed, while the later verge and road limits remain caps.
    const lateral = this.lateral;
    if (lateral.shoulderPassing) {
      targetSpeed = this.speedLimit.atLeast(
        Math.min(
          SHOULDER_PASS_MAX_MPS,
          lateral.shoulderYielding
            ? Math.max(0, lateral.shoulderPassSpeed - SHOULDER_PASS_YIELD_MPS)
            : lateral.shoulderPassSpeed + SHOULDER_PASS_ADVANTAGE_MPS,
        ),
      );
    }
    if (this.middlePassingValue) {
      targetSpeed = this.speedLimit.limit(this.shoulderLeaderSpeed + MIDDLE_PASS_ADVANTAGE_MPS, 'pass-middle');
    }
    // ON THE VERGE THE ROBOT SLOWS FOR WHAT THE VERGE IS. Any line that puts the body
    // past the asphalt — a pass on the shoulder, a bypass, an escape — is taken at a
    // speed loose stone can carry through the bend it is in, and going past something
    // STANDING there at a speed it could stop from. Measured at 30.6 km: frantic
    // drivers went round a queue on the verge at 130 km/h and hit what stood on it, and
    // took the verge at 85 km/h through a 220 m bend. Braked for as soon as the line
    // is out there, so the speed comes off while the body is still crossing over.
    const vergeOverhang = Math.max(Math.abs(desiredLine), Math.abs(projection.lateral))
      + CAR_HALF_WIDTH_M - this.asphaltHalfWidth;
    if (vergeOverhang > 0) {
      const reach = Math.max(VERGE_BEND_LOOK_MIN_M, speed * VERGE_BEND_LOOK_S);
      let bend = 0;
      for (let k = 0; k <= VERGE_BEND_SAMPLES; k++) {
        bend = Math.max(bend, Math.abs(this.road.curvatureAt(this.hintS + (reach * k) / VERGE_BEND_SAMPLES)));
      }
      targetSpeed = this.speedLimit.limit(
        Math.min(
          Math.sqrt(VERGE_LATERAL_ACCEL / Math.max(bend, 1e-4)),
          // Only round something that IS there: with nothing in the chosen corridor the
          // planner reports a block speed of 0 at Infinity, and reading that as "still"
          // held every verge pass to 60 km/h, at or below the car being passed.
          this.lateral.active &&
            this.corridorBlockDistance < Infinity &&
            this.corridorBlockSpeed <= CRAWL_SPEED_MPS
            ? VERGE_BYPASS_STILL_MPS
            : Infinity,
        ),
        'verge',
      );
    }
    if (!plan.admissible) targetSpeed = this.speedLimit.limit(0, 'inadmissible');
    // Held at a bottleneck so a car waiting there can go through (traffic.ts
    // `assignBottleneckTurns`): stop at the line, gently, as at a give-way sign.
    if (this.holdDistance < Infinity) {
      targetSpeed = this.speedLimit.limit(
        this.holdDistance <= 0 ? 0 : Math.sqrt(2 * HOLD_LINE_DECEL_MPS2 * this.holdDistance),
        'hold-line',
      );
    }
    // Sheltering: slow to a crawl while the body is still moving over to the edge,
    // then stop and wait there. Before the stall rule reads it, so a car waiting out
    // the dust on purpose is never taken for one that is stuck.
    if (this.shelteringValue) {
      // Latched: a body the gusts rock across the arrival band must not start and stop.
      if (Math.abs(projection.lateral - desiredLine) <= SHELTER_ARRIVED_M) this.shelterArrived = true;
      targetSpeed = this.speedLimit.limit(this.shelterArrived ? 0 : SHELTER_PULL_MPS, 'shelter');
    }
    // Everything priced as being in the way has now been applied. Taken BEFORE the
    // departure limits below, which are a different problem with a different pedal.
    const obstacleLimitSpeed = targetSpeed;
    if (offRoad) targetSpeed = this.speedLimit.limit(OFFROAD_SPEED_MPS, 'offroad');
    // POINTED AWAY FROM THE ROAD, A CAR CRAWLS UNTIL IT IS POINTED ALONG IT. Measured at
    // 31.27 km: a car handed back from a pull-out with its nose 40° off the road drove on
    // at full throttle and full lock, slid across the loose verge instead of turning,
    // and rolled on the slope beyond. At walking pace the tyres turn it.
    if (Math.abs(headingError) > TURNED_AWAY_RAD) targetSpeed = this.speedLimit.limit(OFFROAD_SPEED_MPS, 'turned-away');
    if (edgeStability) targetSpeed = this.speedLimit.limit(OFFROAD_SPEED_MPS, 'edge-stability');
    // What the driver WANTED before the bumper veto. A nose scan against scenery is
    // the very situation the stall rule exists for, so it must not be the thing
    // that hides the driver's intent from it.
    const wantedSpeed = targetSpeed;
    this.targetSpeedValue = wantedSpeed;
    if (mustStop) targetSpeed = this.speedLimit.limit(0, 'contact');
    // WHAT THE CAR IS IN THE MIDDLE OF, decided once from the committed plan, for the
    // pedal rules below to read; see manoeuvre.ts. A crossing is a PASS from the step
    // its line is chosen round a moving car, not only once the body is across, because
    // the move out is exactly when the pass needs its power.
    this.manoeuvreValue = classifyManoeuvre({
      recovering,
      offRoad,
      sheltering: this.shelteringValue,
      yielding: this.yielding,
      shoulderPassing: this.lateral.shoulderPassing,
      middlePassing: this.middlePassingValue,
      oncomingPassing:
        this.planUsesOncomingLane || (plan.usesOncomingLane && plan.laneBlockSpeed > CRAWL_SPEED_MPS),
      offHomeLine: Math.abs(desiredLine - ownLaneOffset) >= DETOUR_MIN_M,
      following: gap < Infinity && targetSpeed < config.cruiseMps - 0.5 && leadSpeed < config.cruiseMps,
    });

    // Asked to give the car in front room to back out: roll back gently, and only
    // while this car's own rear is clear, so the chain unwinds from the end of the
    // queue rather than shoving whoever is last.
    if (this.yieldReverse && this.recoveryPhase === 'none') {
      const rearClear =
        this.axisScan(vehicle, originX, originZ, -1, YIELD_REVERSE_ROOM_M + 2) >
        YIELD_REVERSE_ROOM_M;
      // A little, not all it can: the car in front needs a metre or two for its first
      // rung, and a queue that each backs off its whole free room moves the jam back
      // down the road. Measured on the real road, seed 1337 at 150 km: a follower gave
      // 6.6 m to a car that reversed 1.7.
      this.yieldReversed += Math.max(0, -forwardSpeed) * dt;
      out.throttle = 0;
      out.handbrake = false;
      out.reverse =
        rearClear && forwardSpeed > -YIELD_REVERSE_MPS && this.yieldReversed < YIELD_REVERSE_BUDGET_M;
      out.brake = out.reverse ? RECOVERY_REVERSE_BRAKE * 0.6 : 0.4;
      out.steer = 0;
      this.activityValue = 'recover';
      this.manoeuvreValue = 'make-room';
      return;
    }
    this.yieldReversed = 0;

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
    //
    // EXCEPT WHEN THE THING IT WAITS FOR IS WAITING FOR IT. The coordinator's deadlock
    // grant is exactly that fact: the opposing head is stopped too, nobody between
    // them, and both are yielding to each other. Waiting out `YIELD_PATIENCE_S` there
    // only made every standoff cost thirty seconds before anybody moved.
    const stalled =
      vehicle.engineRunning &&
      (!this.yielding || opposingDeadlock) &&
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
        ownLaneOffset,
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
        currentRoad.grade,
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
      out.throttle = this.throttleLimit.reset(0, 'rollback');
      out.brake = 1;
      out.reverse = false;
      out.handbrake = false;
      this.activityValue = offRoad ? 'offroad' : 'recover';
      return;
    }

    const speedError = targetSpeed - speed;
    out.reverse = false;
    // Parked at the edge to wait out the dust: the lever goes on, as a driver's would.
    // On the foot brake alone a stopped car crept downwind a centimetre a second.
    out.handbrake = this.shelterArrived && speed < SHELTER_PARK_MPS;
    // The floor exists to break stiction when a small speed is genuinely wanted. It
    // must not apply when the target is zero: 20% throttle against a stopped car's
    // own brakes is a creep into whatever it stopped for, and it walked the car up to
    // a parked obstacle a metre at a time.
    const floor = targetSpeed > 1 ? THROTTLE_FLOOR : 0;
    let pedal =
      speedError > 0
        ? clamp(speedError / (offRoad ? OFFROAD_THROTTLE_BAND : config.throttleBand), floor, 1)
        : 0;
    // PULLING AWAY IS A FORCE, NOT A SPEED ERROR. The proportional pedal above is a
    // fifth of the travel at walking pace, and the engine's net torque at a fifth of the
    // pedal is a few percent of its curve — less than a 5% grade takes to stand still
    // on. Reported from play: two cars at a mound on a climb rolled back, were caught by
    // the rollback brake, lurched, and rolled back again until the stall rule had them
    // reverse. And the error is read on the speedometer's magnitude, so a car rolling
    // back asked for LESS pedal the faster it rolled.
    //
    // So below `LAUNCH_ASSIST_BELOW_MPS` the pedal is at least the one that holds the
    // grade and rolling resistance and adds a gentle pull toward the target, read on
    // the SIGNED speed, through the car's own engine and first gear
    // (`Vehicle.throttleForDriveForce`). Never less than the proportional answer, and
    // only when the driver means to move — a target at the hold speed is waited out on
    // the brake below.
    if (targetSpeed > HOLD_TARGET_MPS && forwardSpeed < LAUNCH_ASSIST_BELOW_MPS && vehicle.engineRunning) {
      // Signed, so the term fades continuously through the target instead of holding
      // the grade against the brake once the car is a little over it.
      const want = clamp((targetSpeed - forwardSpeed) / LAUNCH_TAU_S, -LAUNCH_ACCEL_MPS2, LAUNCH_ACCEL_MPS2);
      pedal = Math.max(
        pedal,
        vehicle.throttleForDriveForce(
          vehicle.stats.mass * (GRAVITY * currentRoad.grade + ROLLING_DECEL_MPS2 + want),
        ),
      );
    }
    out.throttle = this.throttleLimit.reset(pedal, 'speed-error');
    // A RACING DRIVER FEEDS THE THROTTLE IN AS THE CAR STRAIGHTENS. At the limit of
    // the tyres there is no longitudinal grip left for the driven wheels; the pedals-as-
    // switches habit put full power down at the apex of an uphill bend and spun the
    // rear-driven car round (measured on the playground esses at 0.8 of the tyres).
    // The pedal is capped by what the friction circle leaves: full once the cornering
    // load falls below `RACING_THROTTLE_FREE_SHARE` of the tyres, nothing at the limit.
    if (config.racingLine) {
      const cornering = Math.min(1, (Math.abs(vehicle.chassis.angvel().y) * speed) / physicalLateralAccel);
      out.throttle = this.throttleLimit.limit(
        clamp((1 - cornering * cornering) / (1 - RACING_THROTTLE_FREE_SHARE ** 2), RACING_THROTTLE_MIN, 1),
        'friction-circle',
      );
      // The lift for a manoeuvre and for a slide; see RACER_LIFT_SLEW_FREE.
      //
      // NOT FOR A PASS. The line-movement term is a guess at a transient from the
      // line alone; a pass is the one lateral move whose success IS the speed it
      // gains, and lifting through it cost the verge pass its power right while its
      // gain clock ran (SHOULDER_PASS_MIN_GAIN_MPS): it gave itself up every time.
      // A pass keeps the slip term, which is the real sign of a car getting away.
      const bodyLateral = velocity.x * forwardZ - velocity.z * forwardX;
      const slip = forwardSpeed > 5 ? Math.atan2(Math.abs(bodyLateral), forwardSpeed) : 0;
      const slewLift = isPass(this.manoeuvreValue)
        ? 0
        : clamp((Math.abs(this.lineSlewRate) - RACER_LIFT_SLEW_FREE) / (RACER_LIFT_SLEW_FULL - RACER_LIFT_SLEW_FREE), 0, 1);
      const lift = Math.max(slewLift, clamp((slip - RACER_SLIP_FREE_RAD) / (RACER_SLIP_LIFT_RAD - RACER_SLIP_FREE_RAD), 0, 1));
      this.throttleLimit.limit(1 - (1 - RACER_LIFT_MIN) * lift, 'racer-lift');
      out.throttle = this.throttleLimit.limit(this.racerThrottle + RACER_FEED_PER_S * dt, 'racer-feed');
    }
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
    // …UNLESS HALF A PEDAL CANNOT LOSE THE SPEED IN THE ROOM THERE IS. Behind a MOVING
    // car that is not a decision about the road any more, it is the only way not to
    // hit it: a racing driver arriving at 146 km/h on a car doing 53 it found 81 m off
    // over a blind crest braked at 0.44 of the pedal, all the cap allowed, and hit it.
    // Something standing still keeps the cap while there is a way round it: the pass is
    // the plan, and the brake only has to buy the manoeuvre its speed. With NO corridor
    // the thing is going to be stopped for, and the same arithmetic applies to the road
    // left before the standoff. Measured on the real road at seed 545124: a hurried
    // driver at 56 km/h lost its last line round a rock 28 m out, braked at half pedal
    // with the target already at 31 km/h, and hit the rock at 33-40 km/h.
    const followRoom = Math.max(1, this.corridorBlockDistance - FOLLOW_STANDOFF_M);
    const followNeed =
      this.corridorBlockDistance === Infinity
        ? 0
        : this.corridorBlockSpeed > CRAWL_SPEED_MPS
          ? (speed * speed - this.corridorBlockSpeed * this.corridorBlockSpeed) / (2 * followRoom)
          : !this.corridorFeasible
            ? (speed * speed) / (2 * Math.max(1, this.corridorBlockDistance - STILL_BLOCK_STANDOFF_M))
            : 0;
    const brakeCeiling =
      (obstacleLimitSpeed < roadLimitSpeed - BRAKE_LIMIT_EPSILON && followNeed <= obstacleBrakeAccel
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
      out.throttle = this.throttleLimit.limit(0, 'emergency');
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
      out.throttle = this.throttleLimit.limit(0, 'hold');
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
      out.throttle = this.throttleLimit.limit(0, 'bend-entry');
    }
    if (offRoad && speed > OFFROAD_SPEED_MPS) {
      out.throttle = this.throttleLimit.limit(0, 'offroad');
      out.brake = Math.max(
        out.brake,
        clamp((speed - OFFROAD_SPEED_MPS) / 6, 0.05, OFFROAD_BRAKE_MAX),
      );
    }
    if (edgeStability) {
      out.throttle = this.throttleLimit.limit(0, 'edge-stability');
      out.brake = Math.max(
        out.brake,
        clamp(Math.abs(lateralSpeed) / 3, 0.3, config.brakeCeiling),
      );
    }
    if (this.bodyScanGap <= CONTACT_STUCK_GAP_M) {
      out.throttle = this.throttleLimit.limit(0, 'contact');
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
      out.throttle = this.throttleLimit.limit(0, 'engine-off');
      out.brake = Math.max(out.brake, speed < CRAWL_SPEED_MPS ? HOLD_BRAKE : out.brake);
    }
    // A HILL START HOLDS THE BRAKE UNTIL THE GEAR PULLS. Out of reverse or neutral the
    // gearbox spends its shift time with the clutch open, and a car released for it on a
    // grade rolls back the whole time before first gear delivers a newton — the lurch
    // the rollback brake then catches. The brake costs nothing while there is no drive
    // to fight it, and it comes off the step the gear is in.
    if (out.throttle > 0 && forwardSpeed < LAUNCH_HOLD_MPS && vehicle.forwardDriveInterrupted) {
      out.brake = Math.max(out.brake, HOLD_BRAKE);
    }
    this.racerThrottle = out.throttle;
    this.activityValue = offRoad
      ? 'offroad'
      : this.planUsesOncomingLane || this.middlePassingValue
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

  /**
   * Can this car take the verge past the leader found this step at all: the verge's
   * bend speed over `sightM` and `SHOULDER_PASS_MAX_MPS` both clear the leader by the
   * least gain a pass has to show (`SHOULDER_PASS_MIN_GAIN_MPS`), and the engine still
   * pulls `SHOULDER_PASS_MIN_ACCEL_MPS2` at the leader's speed on this grade.
   */
  private vergePassWinnable(vehicle: Vehicle, grade: number, sightM: number): boolean {
    const need = this.shoulderLeaderSpeed + SHOULDER_PASS_MIN_GAIN_MPS;
    if (need > SHOULDER_PASS_MAX_MPS) return false;
    let bend = 0;
    for (let k = 0; k <= VERGE_BEND_SAMPLES; k++) {
      bend = Math.max(bend, Math.abs(this.road.curvatureAt(this.hintS + (sightM * k) / VERGE_BEND_SAMPLES)));
    }
    if (Math.sqrt(VERGE_LATERAL_ACCEL / Math.max(bend, 1e-4)) < need) return false;
    return this.accelerationAt(vehicle, this.shoulderLeaderSpeed, grade) >= SHOULDER_PASS_MIN_ACCEL_MPS2;
  }

  /**
   * Every automatic driver runs on dipped beam, day and night, and never touches main
   * beam: main beam is the player's own choice, made with the switch. The automation
   * used to dip a player's main beam for oncoming cars and switch the player's lamps
   * off by day; both rules are gone, so what the driver selects is what the car shows.
   */
  private updateAutomaticHeadlights(vehicle: Vehicle): void {
    if (this.automaticLightsOwned) vehicle.setHeadlights('low');
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
    /** Centre of the lane the driver holds, road lateral; the escape line is measured from it. */
    ownLaneOffset: number,
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
    // THE SIDE THE OBSTACLE IS NOT ON. A prop the car is up against, or about to be,
    // says which way round is open: away from where it stands across the road. With
    // nothing indexed in front the driver's own shoulder is the default, as before.
    const propSide =
      this.hazardDistance < RECOVERY_PROP_AWARE_M ? Math.sign(lateral - this.hazardLateral) : 0;
    const preferred = propSide !== 0 ? propSide : right;
    const side =
      lateral * preferred > this.road.halfWidthAt(this.hintS) - CAR_HALF_WIDTH_M ? -preferred : preferred;
    // BUT NEVER INTO A CAR THAT IS COMING. `-right` is the opposing carriageway, and
    // the reverse and the pull-out are blind fixed-lock legs: unlike the planner's own
    // crossing (corridor.ts), nothing in them looks up the other lane. So the escape
    // swings that way only with the opposing lane clear for `RECOVERY_ONCOMING_CLEAR_M`;
    // otherwise it goes to the car's own shoulder, as it always used to.
    this.recoverySide = side === right || this.oncomingGap > RECOVERY_ONCOMING_CLEAR_M ? side : right;
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
    this.recoveryReversed = 0;
    this.recoveryRoomWait = 0;
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
    //
    // AND IT IS THE LINE THAT CLEARS THE PROP, HELD UNTIL THE PROP IS BEHIND. A fixed
    // 3.2 m from the lane centre, held for 50 m, was sized for a 1.2 m rock sitting in
    // the middle of the lane, and for everything else it was either more road than the
    // prop takes — on a narrow road, a line past the asphalt, which the departure rule
    // then crawled along at walking pace — or the same detour fifty metres after the
    // prop had gone by. Reported from play as escapes that got round and then drove on
    // slowly and carefully, holding up everybody behind. With a prop known, the line is
    // the planner's own clearance from it (`RECOVERY_CLEAR_MARGIN_M` over the radius,
    // the body and the avoidance margin), never back across the lane, a rung wider
    // for each failed attempt, and it lasts until the body is past the prop's far edge.
    // With nothing known it is the old fixed escape.
    const escapeStep = this.recoveryEscalation * RECOVERY_BIAS_STEP_M;
    if (propSide !== 0 && this.recoverySide === propSide) {
      const clearLine =
        this.hazardLateral +
        this.recoverySide * (this.hazardRadius + CAR_HALF_WIDTH_M + AVOID_HYSTERESIS_M + RECOVERY_CLEAR_MARGIN_M);
      this.recoveryBias =
        this.recoverySide * (Math.max(0, (clearLine - ownLaneOffset) * this.recoverySide) + escapeStep);
      this.recoveryPropEndS = this.hazardEndS + CAR_HALF_LENGTH_M * 2;
    } else {
      this.recoveryBias = this.recoverySide * (RECOVERY_BIAS_M + escapeStep);
      this.recoveryPropEndS = Number.NaN;
    }
    this.recoveryBiasUntil = this.travelled + RECOVERY_BIAS_METRES;
    // A boxed-in tail no longer skips the reverse outright: the leg starts and WAITS
    // (`RECOVERY_ROOM_WAIT_S`), and because a reversing car asks for room
    // (`needsReverseRoom`) the queue behind eases back a little to give it.
    this.recoveryPhase = 'reverse';
    this.recoveryTimer =
      RECOVERY_RUNG_REVERSE_M[this.recoveryEscalation]! / RECOVERY_RUNG_REVERSE_MPS[this.recoveryEscalation]! +
      RECOVERY_REVERSE_SLACK_S +
      RECOVERY_ROOM_WAIT_S;
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
          trailing: along < 0,
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
    /** Road grade along the driver's direction, rise over run; uphill positive. */
    grade: number,
    lateral: number,
    gap: number,
    vehicle: Vehicle,
    originX: number,
    originZ: number,
  ): void {
    out.handbrake = false;
    // What this rung of the ladder steers with. Both legs escalate together: the
    // pull-out has to follow the arc the reverse set up.
    const rung = this.recoveryEscalation;
    const lock = RECOVERY_RUNG_LOCK[rung]!;
    if (this.recoveryPhase === 'reverse') {
      this.recoveryTimer -= dt;
      out.throttle = 0;
      out.reverse = true;
      out.steer = clamp(this.recoverySide * lock, -1, 1);
      // A LONGER REVERSE HAS TO BE WATCHED WHILE IT RUNS. The queue behind can close
      // the space up while the car is using it, and static scenery no ray reports — a
      // fence, a bank, a pole — is found by the car's own evidence: it has selected
      // reverse and is covering no ground.
      const roomBehind = this.axisScan(vehicle, originX, originZ, -1, RECOVERY_REVERSE_LOOK_M);
      // NO ROOM YET: WAIT FOR IT. Still in the reverse phase, so `needsReverseRoom`
      // keeps asking the car behind to ease back; the leg itself does not move and its
      // stall clock does not run, because standing still is the point.
      if (roomBehind < RECOVERY_REVERSE_STOP_M && this.recoveryRoomWait < RECOVERY_ROOM_WAIT_S) {
        this.recoveryRoomWait += dt;
        out.brake = 0;
        return;
      }
      this.recoveryLegElapsed += dt;
      // In automatic mode, reverse=true selects R at rest and brake becomes reverse
      // throttle on the following tick, so the same pedal stops a car still rolling
      // forward and then backs it up. Eased off toward the rung's walking pace: the
      // reverse is a crawl, not a lunge.
      const back = Math.max(0, -forwardSpeed);
      const cap = RECOVERY_RUNG_REVERSE_MPS[rung]!;
      // Never less than what backs the car up the grade behind it, when there is one:
      // the old pedal alone stalled a nose-down reverse and ended the leg with no room
      // gained. See the launch pedal in `driveControls`.
      out.brake = Math.max(
        RECOVERY_REVERSE_BRAKE * clamp((cap - back) / cap, 0, 1) * 0.6,
        back < cap
          ? vehicle.throttleForDriveForce(
              vehicle.stats.mass *
                (ROLLING_DECEL_MPS2 - GRAVITY * grade + clamp((cap - back) / LAUNCH_TAU_S, 0, LAUNCH_ACCEL_MPS2)),
              true,
            )
          : 0,
      );
      this.recoveryReversed += back * dt;
      this.recoveryLegStalled =
        this.recoveryLegElapsed > RECOVERY_LEG_GRACE_S &&
        forwardSpeed > -RECOVERY_LEG_CRAWL_MPS
          ? this.recoveryLegStalled + dt
          : 0;
      // The lateral test is "the reverse has taken the car far enough out to steer
      // round what blocked it". A car that was ALREADY out there — wedged on a pole
      // on the verge — satisfies it on the first tick, which ended the reverse
      // before the clutch had taken up and handed straight back to a pull-out that
      // drove into the same pole. Out there the distance and the timer own the phase.
      //
      // The line it is measured against widens with the rung. Held at the verge, the
      // reverse stops inside the width the obstruction blocks, and the pull-out that
      // follows aims back down it: that is the second and third bump the ladder
      // exists to break.
      if (
        this.recoveryReversed >= RECOVERY_RUNG_REVERSE_M[rung]! ||
        this.recoveryTimer <= 0 ||
        roomBehind < RECOVERY_REVERSE_STOP_M ||
        this.recoveryLegStalled > RECOVERY_LEG_STALL_S ||
        (!this.recoveryOffRoad &&
          Math.abs(lateral) >
            this.road.halfWidthAt(this.hintS) +
            PASSING_VERGE_M +
            rung * RECOVERY_BIAS_STEP_M)
      ) {
        this.recoveryPhase = 'pullout';
        this.recoveryTimer = RECOVERY_PULLOUT_S + rung * RECOVERY_PULLOUT_STEP_S;
      }
      return;
    }

    out.reverse = false;
    // Keep the reverse lock while braking the remaining backward roll. Reversing
    // the wheel before the car reverses its travel bends the tail back toward the
    // obstacle and also spends the pull-out timer without moving forward.
    if (forwardSpeed < -0.15) {
      out.steer = clamp(this.recoverySide * lock, -1, 1);
      out.throttle = 0;
      out.brake = 0.5;
      return;
    }

    this.recoveryTimer -= dt;
    out.steer = clamp(-this.recoverySide * lock, -1, 1);
    // The same launch pedal as ordinary driving, never less than the old fixed 0.45, and
    // held on the brake while the gearbox comes out of reverse: released for the shift,
    // a car on a climb rolled back the whole shift time, was caught by the backward-roll
    // brake above, and lurched — the rocking reported from play at a mound on a grade.
    const crawl = RECOVERY_RUNG_CRAWL_MPS[rung]!;
    out.throttle =
      forwardSpeed < crawl
        ? Math.max(
            RECOVERY_PULLOUT_THROTTLE,
            vehicle.throttleForDriveForce(
              vehicle.stats.mass *
                (GRAVITY * grade + ROLLING_DECEL_MPS2 + clamp((crawl - forwardSpeed) / LAUNCH_TAU_S, 0, LAUNCH_ACCEL_MPS2)),
            ),
          )
        : 0;
    out.brake = out.throttle > 0 && forwardSpeed < LAUNCH_HOLD_MPS && vehicle.forwardDriveInterrupted ? HOLD_BRAKE : 0;
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
      // A known prop is held for exactly as far as it lasts; see `beginRecovery`.
      this.recoveryBiasUntil =
        this.travelled +
        (Number.isFinite(this.recoveryPropEndS)
          ? Math.max(0, this.recoveryPropEndS - this.hintS)
          : RECOVERY_BIAS_METRES);
    }
  }

  /**
   * Fills `roadBodies` with every dynamic body within `reach` road metres ahead, or
   * `PROBE_REAR_M` behind, projected onto the road; see the note above
   * `PROBE_HEIGHT_M`. Once a step, before the first lane probe.
   */
  private collectRoadBodies(
    vehicle: Vehicle,
    originX: number,
    originZ: number,
    reach: number,
  ): void {
    this.roadBodyCount = 0;
    this.routeCount = 0;
    if (!this.physics || !this.roadBodyShape) return;
    this.roadBodyOriginX = originX;
    this.roadBodyOriginZ = originZ;
    // A body's centre may sit half a body beyond the face a probe reports, and a
    // straight line is never longer than the road between two points, so this ball
    // holds everything any probe of this step can ask about.
    this.roadBodyReach = reach + CAR_HALF_LENGTH_M;
    this.roadBodyShape.radius = this.roadBodyReach;
    this.rayOrigin.x = this.position.x - originX;
    this.rayOrigin.y = this.position.y;
    this.rayOrigin.z = this.position.z - originZ;
    this.physics.world.intersectionsWithShape(
      this.rayOrigin,
      this.identityRotation,
      this.roadBodyShape,
      this.visitRoadBody,
      this.physics.rapier.QueryFilterFlags.ONLY_DYNAMIC,
      undefined,
      undefined,
      vehicle.chassis,
    );
  }

  /** Centreline points over this step's stretch; see `routeS`. */
  private sampleRoute(): void {
    const from = this.hintS - PROBE_REAR_M - CAR_HALF_LENGTH_M;
    const span = this.roadBodyReach + PROBE_REAR_M + CAR_HALF_LENGTH_M;
    const count = Math.min(ROUTE_MAX_POINTS, Math.ceil(span / ROUTE_STEP_M) + 1);
    const step = span / (count - 1);
    for (let i = 0; i < count; i++) {
      const s = from + i * step;
      this.road.offsetPoint(s, 0, this.routePoint);
      this.routeS[i] = s;
      this.routeX[i] = this.routePoint.x;
      this.routeZ[i] = this.routePoint.z;
    }
    this.routeCount = count;
  }

  /**
   * Arclength of the nearest point to (x, z) on this step's stretch of road, or NaN
   * when nothing on it is within `PROBE_MAX_LATERAL_M`. A foot beyond either end of
   * the stretch is not on it: a car 50 m behind is not beside the stretch's first
   * point.
   */
  private routeFoot(x: number, z: number): number {
    let best = PROBE_MAX_LATERAL_M * PROBE_MAX_LATERAL_M;
    let foot = Number.NaN;
    const segments = this.routeCount - 1;
    for (let i = 0; i < segments; i++) {
      const ax = this.routeX[i]!;
      const az = this.routeZ[i]!;
      const dx = this.routeX[i + 1]! - ax;
      const dz = this.routeZ[i + 1]! - az;
      const lengthSq = dx * dx + dz * dz;
      if (lengthSq < 1e-9) continue;
      const t = ((x - ax) * dx + (z - az) * dz) / lengthSq;
      if ((i === 0 && t < 0) || (i === segments - 1 && t > 1)) continue;
      const along = clamp(t, 0, 1);
      const ex = ax + dx * along - x;
      const ez = az + dz * along - z;
      const distanceSq = ex * ex + ez * ez;
      if (distanceSq < best) {
        best = distanceSq;
        foot = this.routeS[i]! + along * (this.routeS[i + 1]! - this.routeS[i]!);
      }
    }
    return foot;
  }

  /**
   * Road metres from this car's centre to the near face of the nearest body in a lane,
   * looking `facing` along the road from `PROBE_START_M` for `sight` metres, or
   * Infinity. Sets `probeHitSpeed` to that body's speed along the road.
   *
   * Membership is an interval on the lateral — the body's own span across the road
   * against the probe band round `lane` — at the body's own arclength, so the answer
   * follows the lane round any bend and over any crest. A body already straddling the
   * start of the probe is reported AT the start.
   */
  private laneProbe(lane: number, sight: number, facing: 1 | -1 = 1): number {
    this.probeHitSpeed = 0;
    let nearest = Infinity;
    for (let i = 0; i < this.roadBodyCount; i++) {
      const body = this.roadBodies[i]!;
      if (Math.abs(body.lateral - lane) > body.halfAcross + PROBE_HALF_WIDTH_M) continue;
      const centre = facing * body.s;
      if (centre + body.halfAlong < PROBE_START_M) continue;
      const gap = Math.max(PROBE_START_M, centre - body.halfAlong);
      if (gap > PROBE_START_M + sight || gap >= nearest) continue;
      nearest = gap;
      this.probeHitSpeed = body.speed;
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
          const heading = this.road.headingAt(this.hintS);
          this.probeHitSpeed = velocity.x * Math.sin(heading) + velocity.z * Math.cos(heading);
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
