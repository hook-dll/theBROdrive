/** Fixed-step road follower. Inputs remain ordinary InputFrame commands. */
import type { InputFrame } from '../core/input';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../core/physics';
import { SurfaceType } from '../core/surfaces';
import type { RoadConditionBuffer } from '../world/gradient';
import { ROAD_HALF_WIDTH, type DriveRoad } from '../world/road';
import { type HazardField, type RoadHazard } from '../world/hazards';
import type { Vehicle } from './vehicle';
import { planCorridor, type CorridorObstacle } from './corridor';

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
   * Signed lateral of the lane the mode holds, metres. Positive lateral is LEFT of
   * travel (see `Road.offsetPoint`), so a right-hand lane is NEGATIVE.
   */
  readonly laneOffset: number;
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
}

/**
 * TWO DRIVERS, NOT ONE WITH A SPEED KNOB.
 *
 * `sleeper` is the character asleep at the wheel of his own life: 70 km/h, its own
 * lane, a cornering budget under half of what the tyres have, gentle pedals, and it
 * only leaves its lane for something that is not going to move. It arrives late and
 * it arrives.
 *
 * `frantic` is the same car driven by somebody who is out of time: 130 km/h, twice
 * the cornering budget, pedals used as switches, and it will take the oncoming lane
 * to get past traffic when it can see far enough to do it. Its corner entries are
 * deliberately less exact — half the chord correction — so it clips lines rather
 * than tracing them.
 *
 * Both hold the RIGHT-HAND LANE. That is the change with the widest reach: a car on
 * the centreline meets oncoming traffic head-on and has nowhere to put a swerve,
 * and on the test circuit it made the two modes look identical because the only
 * thing separating them was speed.
 */
const MODES: Record<AutopilotMode, ModeConfig> = {
  sleeper: {
    cruiseMps: 70 / 3.6,
    lateralAccel: 3.2,
    brakeAccel: 4.0,
    lookaheadBase: 11,
    lookaheadSpeed: 1.35,
    brakeLead: 18,
    curveLead: 30,
    laneOffset: -ROAD_HALF_WIDTH / 2,
    chordGain: 0.9,
    steeringGain: 1.55,
    holdSeconds: 0.65,
    holdShare: 0.5,
    throttleBand: 6,
    brakeBand: 7,
    brakeCeiling: 0.55,
    headwayS: 2.2,
    overtakes: false,
    passCurvature: 0.012,
    passNerve: 1,
  },
  /**
   * The driver with somewhere to be and a licence to keep. 95 km/h, a cornering
   * budget two thirds of the tyres', pedals used deliberately rather than as
   * switches — and it overtakes, but only into a window it would take itself. It is
   * what ambient traffic's hurried drivers use, and the middle setting of the
   * player's own autopilot: livelier than sleeper without frantic's appetite for a
   * small gap.
   */
  hurried: {
    cruiseMps: 95 / 3.6,
    lateralAccel: 4.7,
    brakeAccel: 5.4,
    lookaheadBase: 10,
    lookaheadSpeed: 1.2,
    brakeLead: 12,
    curveLead: 27,
    laneOffset: -ROAD_HALF_WIDTH / 2,
    chordGain: 0.68,
    steeringGain: 1.5,
    holdSeconds: 0.75,
    holdShare: 0.42,
    throttleBand: 3,
    brakeBand: 4,
    brakeCeiling: 0.8,
    headwayS: 1.6,
    overtakes: true,
    passCurvature: 0.010,
    passNerve: 0.88,
  },
  frantic: {
    cruiseMps: 130 / 3.6,
    lateralAccel: 6.8,
    brakeAccel: 7.2,
    lookaheadBase: 9,
    lookaheadSpeed: 1.0,
    brakeLead: 7,
    curveLead: 24,
    laneOffset: -ROAD_HALF_WIDTH / 2,
    chordGain: 0.45,
    steeringGain: 1.45,
    holdSeconds: 0.85,
    holdShare: 0.35,
    throttleBand: 1.2,
    brakeBand: 1.8,
    brakeCeiling: 1,
    headwayS: 1.2,
    overtakes: true,
    // A bend of 0.009 rad/m is a 110 m radius: gentle enough that the speed planner
    // still allows most of this mode's pace through it. The old 0.006 demanded a
    // straighter road than the cautious mode did, which on a desert road that is
    // never quite straight is most of the reason an overtake never happened.
    passCurvature: 0.009,
    // Two thirds of the cautious margins. It is in a hurry, it takes the smaller
    // window, and it gets back in.
    passNerve: 0.66,
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
const GRAVITY = 9.81;
/**
 * Straight-line pace by surface. Personality still sets the absolute speed: the
 * factors describe how much of it the road can support before bumps and loose grip
 * dominate. Decay and drifted sand reduce these further at the sampled location.
 */
const SURFACE_SPEED_FACTOR: Readonly<Record<SurfaceType, number>> = {
  [SurfaceType.Asphalt]: 1,
  [SurfaceType.CrackedAsphalt]: 0.84,
  [SurfaceType.Gravel]: 0.45,
  [SurfaceType.Sand]: 0.2,
  [SurfaceType.Rock]: 0.32,
  [SurfaceType.Concrete]: 0.96,
};
const DECAY_SPEED_LOSS = 0.14;
const SAND_COVER_SPEED_LOSS = 0.28;
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
/**
 * Extra metres the middle avoidance rung asks for beyond bare body clearance, and the
 * fraction of that clearance the braking corridor is measured at. Together they
 * guarantee that a line the planner picks is outside the corridor that caused the
 * braking, which is what stops the two from deadlocking.
 */
const AVOID_HYSTERESIS_M = 0.4;
/** A valid indexed detour must keep rolling or its rate-limited line can never finish. */
const AVOIDANCE_CRAWL_MPS = 3.5;
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
 * Metres the commanded line may move per metre travelled. 0.09 spends about 40 m of
 * road moving a full lane across, which is what a driver does when they see a rock
 * early — and slow enough that a replan cannot present the loop with a step.
 */
const LINE_SHIFT_PER_METRE = 0.09;
/** Line movement allowed on TIME rather than distance while barely rolling, m/s. */
const LINE_SLEW_AT_REST_MPS = 0.5;
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
const PASSING_EDGE = ROAD_HALF_WIDTH + PASSING_VERGE_M;
/** Outermost line either side that still keeps the body inside the verge allowance. */
const EDGE_LINE_M = PASSING_EDGE - CAR_HALF_WIDTH_M;
/**
 * Indexed road props may use the wider graded shoulder, but only while an exact
 * radius-based plan is active. Four metres clears the longest rotated trunk at the
 * road edge; ordinary passing and accidental departures keep the tighter verge.
 */
const STATIC_AVOID_VERGE_M = 4;
const STATIC_AVOID_EDGE = ROAD_HALF_WIDTH + STATIC_AVOID_VERGE_M;
const STATIC_AVOID_LINE_M = STATIC_AVOID_EDGE - CAR_HALF_WIDTH_M;
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
const BLOCKER_BYPASS_LINE_M = ROAD_HALF_WIDTH + CAR_HALF_WIDTH_M + AVOID_HYSTERESIS_M;
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
const OFFROAD_RECOVERY_EDGE = PASSING_EDGE;
const OFFROAD_RECOVERY_LINE = ROAD_HALF_WIDTH - CAR_HALF_WIDTH_M - 0.2;
const OFFROAD_REJOIN_LATERAL_M = ROAD_HALF_WIDTH - CAR_HALF_WIDTH_M - 0.05;
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
 * FOLLOWING, in three numbers.
 *
 * The old code treated everything the corridor scan found as a wall and braked on
 * absolute distance, so a car 20 m ahead at 70 km/h asked sleeper for 4 m/s. Traffic
 * needs the RELATIVE picture: the probe's own distance derivative gives the lead's
 * speed, the standoff is what is left when both are stopped, and the relaxation time
 * is how quickly a gap error is taken out. Everything else follows from those.
 */
const FOLLOW_STANDOFF_M = 7;
const FOLLOW_RELAX_S = 2.2;
const LEAD_SPEED_TAU_S = 0.3;
/**
 * Distance step per second beyond which the probe must have changed target rather
 * than measured a closing rate. Two cars nose to tail are 40 m/s apart only if one
 * of them is not there.
 */
const LEAD_JUMP_MPS = 40;
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
const DYNAMIC_BLOCKER_NEARBY_M = 12;
/** Move this far after losing a dynamic lead before a stop can be called unexplained. */
const DYNAMIC_BLOCKER_CLEAR_M = 5;
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
const STUCK_AFTER_S = 3;
const RECOVERY_REVERSE_S = 1.8;
const RECOVERY_PULLOUT_S = 2.4;
const RECOVERY_STEER = 0.85;
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
const RECOVERY_REARM_S = 30;
/**
 * How far off its lane the car holds after a pull-out. It has to be enough to CLEAR
 * what it was stuck on: 1.7 m left a body-width overlap with a car parked in the
 * lane, so the bias puts the line just past the centreline, where 2.2 m of
 * separation is a real pass.
 */
const RECOVERY_BIAS_M = 2.2;

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
  private hazard: RoadHazard | null = null;
  private hazardDistance = Infinity;
  /** Nearest dynamic body in the driving corridor, metres, from either scan. */
  private obstacleGapValue = Infinity;
  /** Its speed, estimated from the corridor probe's own distance derivative. */
  private obstacleSpeedValue = 0;
  /** Rate the gap is shrinking, m/s. Larger than our own speed means it is coming AT us. */
  private leadClosingValue = 0;
  /** Seconds that estimate has stayed below `PARKED_SPEED_MPS`, and whether it is real. */
  private leadParkedFor = 0;
  private leadMeasured = false;
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
  private planUsesOncomingLane = false;
  private planUsesShoulder = false;
  /** Asked by the traffic coordinator to give the car in front room to reverse. */
  private yieldReverse = false;
  private bodyScanGap = Infinity;
  /** Line actually commanded, rate-limited toward the line the driver wants. */
  private appliedLateral = 0;
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
  private lastRecoveryAt = -Infinity;
  private recoveryAttempts = 0;
  private speedCapValue = Infinity;
  /** Ambient traffic may use a per-driver following distance. */
  private followingHeadwayValue: number | null = null;
  private daylightFactor = 1;
  private oncomingGap = Infinity;
  private automaticLightsOn = false;
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
    const distance = hazard.s - this.hintS;
    if (distance >= this.hazardDistance) return;
    // A PROP THAT DOES NOT REACH THE ASPHALT IS SCENERY.
    //
    // The path tests below ask whether the prop is near this car's LINE, and a line
    // that has already been pushed out to the shoulder for one prop is near every
    // other prop standing out there. Measured in a live drive: cars left the road,
    // in both directions, with nothing on the road at all — the nearest thing being
    // roadside scatter and power-line pylons metres past the paint. A detour is for
    // something in the way, and only what overlaps the asphalt is in the way.
    if (Math.abs(hazard.lateral) - hazard.radius >= ROAD_HALF_WIDTH) return;
    // `visitHazard` still answers "what is the nearest prop on the line I am on",
    // which the breakable-speed rule and the recovery reach both want. The corridor
    // planner uses `collectHazard` below instead, because a planner that only ever
    // heard about the prop on its current line could not price any other line.
    const reach = hazard.radius + CAR_HALF_WIDTH_M + AVOID_HYSTERESIS_M;
    if (Math.abs(hazard.lateral - this.scanLateral) >= reach) return;
    this.hazard = hazard;
    this.hazardDistance = distance;
  };
  /**
   * Every prop within the planning horizon, whatever line it sits on, inflated by
   * the avoidance margin and offered to the planner as an immovable obstacle. Props
   * that do not reach the asphalt are scenery, and are not offered at all.
   */
  private readonly collectHazard = (hazard: RoadHazard): void => {
    if (Math.abs(hazard.lateral) - hazard.radius >= ROAD_HALF_WIDTH) return;
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
  /** Clears the nearest-hazard result before a scan. See the note in `drive`. */
  private beginHazardScan(lateral: number): void {
    this.hazard = null;
    this.hazardDistance = Infinity;
    this.scanLateral = lateral;
  }


  constructor(
    private readonly road: DriveRoad,
    private readonly hazards: HazardField,
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
  /** Supplies ambient light and road distance to the nearest approaching vehicle. */
  setLightingConditions(daylightFactor: number, oncomingGap: number): void {
    this.daylightFactor = clamp(daylightFactor, 0, 1);
    this.oncomingGap = oncomingGap >= 0 ? oncomingGap : Infinity;
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
  /** Estimated speed of that body, m/s. Zero for anything parked. */
  get obstacleSpeed(): number { return this.obstacleSpeedValue; }
  get activity(): AutopilotActivity { return this.activityValue; }

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
    this.recoveryCommitted = false;
    this.deadlockPermission = false;
    this.yieldReverse = false;
    this.dynamicBlockerKnown = false;
    this.obstacleGapValue = Infinity;
    this.obstacleSpeedValue = 0;
    this.activityValue = 'cruise';
    if (!engaged) this.appliedLateral = 0;
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
    if (firstProjection) this.appliedLateral = projection.lateral;
    this.hintS = projection.s;
    this.hintValid = true;
    const velocity = vehicle.chassis.linvel();
    const speed = Math.hypot(velocity.x, velocity.z);
    this.travelled += speed * dt;
    this.sinceRecovery += dt;
    const wasRoadRecoveryActive = this.roadRecoveryActive;
    // A car out on the graded shoulder because its corridor goes round something is
    // not a car that has left the road: the planner put it there and will bring it
    // back. Only a departure the planner did not ask for is a road departure.
    const insideStaticAvoidance =
      this.planUsesShoulder && Math.abs(projection.lateral) <= STATIC_AVOID_EDGE;
    if (Math.abs(projection.lateral) > OFFROAD_RECOVERY_EDGE && !insideStaticAvoidance) {
      this.roadRecoveryActive = true;
    }
    let offRoad = this.roadRecoveryActive;
    const roadRecoveryBias =
      this.recoveryPhase !== 'none'
        ? this.recoverySide * RECOVERY_BIAS_M
        : this.travelled < this.recoveryBiasUntil
          ? this.recoveryBias
          : 0;
    if (offRoad && !wasRoadRecoveryActive) {
      this.roadRecoveryFollowingEscape = Math.abs(roadRecoveryBias) > 0.01;
      this.roadRecoveryTargetLine =
        Math.abs(roadRecoveryBias) > 0.01
          ? clamp(
              config.laneOffset + roadRecoveryBias,
              -OFFROAD_REJOIN_LATERAL_M,
              OFFROAD_REJOIN_LATERAL_M,
            )
          : config.laneOffset;
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
          Math.sign(projection.lateral || 1) * OFFROAD_RECOVERY_LINE;
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
    const currentLateralAccel = Math.min(
      config.lateralAccel,
      vehicle.estimatedLateralAccel(currentSurface, speed) *
        LATERAL_GRIP_RESERVE *
        Math.sqrt(Math.max(0.35, 1 - gradeLoad * gradeLoad)),
    );
    const rotation = vehicle.chassis.rotation();
    const forwardX = 2 * (rotation.x * rotation.z + rotation.w * rotation.y);
    const forwardZ = 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y);
    const forwardSpeed = velocity.x * forwardX + velocity.z * forwardZ;


    this.beginHazardScan(projection.lateral);
    this.hazards.forEachAhead(
      this.hintS,
      Math.max(lookahead + 8, config.brakeLead + (speed * speed) / (2 * config.brakeAccel)),
      this.visitHazard,
    );
    const hazard = this.hazard;

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
    this.bodyScanGap = this.axisScan(vehicle, originX, originZ, 1, BODY_SCAN_RANGE_M);
    const sight = Math.max(PROBE_MIN_SIGHT_M, speed * PROBE_SIGHT_SECONDS);
    const laneGap = this.laneProbe(vehicle, this.appliedLateral, sight, originX, originZ);
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
    const bodyOnAsphalt = Math.abs(projection.lateral) <= OFFROAD_REJOIN_LATERAL_M;
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
      if (Math.abs(this.roadRecoveryTargetLine - config.laneOffset) > 0.01) {
        this.recoveryBias = this.roadRecoveryTargetLine - config.laneOffset;
        this.recoveryBiasUntil = this.travelled + RECOVERY_BIAS_METRES;
      }
      this.roadRecoveryFollowingEscape = false;
    }
    const bodyLaneGap =
      Math.abs(headingError) < PROBE_PARALLEL_RAD &&
      Math.abs(projection.lateral - this.appliedLateral) > PROBE_HALF_WIDTH_M
        ? this.laneProbe(vehicle, projection.lateral, sight, originX, originZ)
        : Infinity;
    this.updateLead(dt, Math.min(this.bodyScanGap, laneGap, bodyLaneGap), speed);
    const gap = this.obstacleGapValue;
    const leadSpeed = this.obstacleSpeedValue;
    // A recovery is normally an escape from unexplained static blockage. Dynamic
    // traffic ahead cancels it immediately, while a queued car behind does not.
    // An opposing-road deadlock is the exception: one direction receives stable
    // right of way and commits to the outer shoulder while the other keeps waiting.
    if (
      !this.recoveryCommitted &&
      (
        gap < Infinity ||
        this.dynamicBodyAhead(
          vehicle,
          originX,
          originZ,
          roadForwardX,
          roadForwardZ,
        )
      )
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
      Math.min(CORRIDOR_MAX_HORIZON_M, speed * CORRIDOR_HORIZON_SECONDS),
    );
    this.collectHorizon = horizon;
    this.hazards.forEachAhead(this.hintS, horizon, this.collectHazard);
    // The rays report a distance, not a lateral: the lane probe was cast down the
    // commanded line and the body scan down the car's own, so the thing it found is
    // in one of those two. But it MUST NOT be recorded as sitting on our commanded
    // line, because that line moves: as it slid toward the opposing lane, the car
    // ahead slid with it, the opposing corridor read as blocked, the lane read as
    // clear, and the planner flipped back — every step, for as long as the car sat
    // behind it. Seen in play as an indicator buzzing while the overtake never
    // happened. Traffic keeps to lane centres, so the estimate is snapped to
    // whichever lane the probe that found it was looking down.
    if (gap < Infinity) {
      const probeLine =
        bodyLaneGap <= laneGap && bodyLaneGap <= this.bodyScanGap
          ? projection.lateral
          : this.appliedLateral;
      const leadLateral =
        Math.abs(probeLine - config.laneOffset) <= Math.abs(probeLine + config.laneOffset)
          ? config.laneOffset
          : -config.laneOffset;
      obstacles.push({
        s: gap,
        lateral: leadLateral,
        halfWidth: CAR_HALF_WIDTH_M + AVOID_HYSTERESIS_M,
        // A car coming AT us reads as stationary through `speed - closing`, and the
        // planner wants exactly that: something to be gone round, not followed.
        speed: this.leadClosingValue > speed + HEAD_ON_MARGIN_MPS ? 0 : leadSpeed,
      });
    }
    const oncomingLine = -Math.sign(config.laneOffset || -1) * (ROAD_HALF_WIDTH / 2);
    const plan = planCorridor({
      ownLateral: projection.lateral,
      previousLine: this.appliedLateral,
      laneOffset: config.laneOffset,
      speed,
      desiredSpeed: Math.min(config.cruiseMps, this.speedCapValue),
      halfWidth: CAR_HALF_WIDTH_M,
      horizon,
      // The commanded line moves per METRE of road, except near a standstill, where
      // it slews on time instead (see `LINE_SLEW_AT_REST_MPS` below) — a stationary
      // driver turns the wheel before moving off. The planner has to know that, or
      // a stopped car computes that reaching the shoulder costs thirty metres it
      // cannot cover, calls every corridor blocked, and waits for good. Seen in
      // play: a queue stopped at a rock with nobody going round it, the player's
      // car at the back of it, indefinitely.
      lineRatePerMetre:
        speed < CRAWL_SPEED_MPS
          ? LINE_SLEW_AT_REST_MPS / Math.max(speed, 0.4)
          : LINE_SHIFT_PER_METRE,
      asphaltLimit: ROAD_HALF_WIDTH,
      edgeLimit: STATIC_AVOID_LINE_M,
      // The mode's whole appetite for the opposing lane, in one number. A driver
      // that does not overtake simply prices that lane out of reach.
      oncomingLaneCost: config.overtakes && this.passingEnabled
        ? ONCOMING_LANE_COST * config.passNerve
        : Number.POSITIVE_INFINITY,
      oncomingGap: Math.min(
        this.oncomingGap,
        this.laneProbe(vehicle, oncomingLine, horizon, originX, originZ),
      ),
      oncomingSpeed: ONCOMING_ASSUMED_MPS,
      // Nothing already coming up the opposing lane behind us: the search only ever
      // looks forward, so this is the one rearward fact it needs.
      crossingRearClear:
        this.laneProbe(vehicle, oncomingLine, ONCOMING_REAR_GAP_M, originX, originZ, -1) >=
        ONCOMING_REAR_GAP_M,
      stopRoom: MUST_STOP_GAP_M + (speed * speed) / (2 * currentBrakeAccel),
      obstacles,
    });
    this.corridorFeasible = plan.feasible || offRoad || recovering;
    this.corridorBlockDistance = plan.blockDistance;
    this.corridorBlockSpeed = plan.blockSpeed;
    this.corridorLaneBlockDistance = plan.laneBlockDistance;
    this.corridorLaneBlockSpeed = plan.laneBlockSpeed;
    // Telemetry reads "pass" from where the CAR is, not from where the line points:
    // the planner re-decides every step, so a line that dips across the centre for
    // a moment is not an overtake, and counting those turned a bench's pass counter
    // into a per-frame tally.
    this.planUsesOncomingLane =
      !offRoad &&
      !recovering &&
      plan.usesOncomingLane &&
      projection.lateral * Math.sign(config.laneOffset || -1) < -CAR_HALF_WIDTH_M * 0.5;
    this.planUsesShoulder = !offRoad && !recovering && plan.usesShoulder;
    // Anything the corridor clears by only its hysteresis margin is squeezed past at
    // walking pace rather than at road speed.
    this.corridorSqueezeDistance = Number.POSITIVE_INFINITY;
    for (const obstacle of obstacles) {
      if (obstacle.speed > CRAWL_SPEED_MPS) continue;
      const clearance = Math.abs(obstacle.lateral - plan.line) - obstacle.halfWidth;
      if (clearance < CAR_HALF_WIDTH_M + CORRIDOR_SQUEEZE_M && obstacle.s >= 0) {
        this.corridorSqueezeDistance = Math.min(this.corridorSqueezeDistance, obstacle.s);
      }
    }
    const desiredLine = offRoad
      ? Math.abs(projection.lateral) <= OFFROAD_REJOIN_LATERAL_M
        ? this.roadRecoveryTargetLine
        : Math.sign(projection.lateral || 1) * OFFROAD_RECOVERY_LINE
      : recovering || this.travelled < this.recoveryBiasUntil
        ? clamp(config.laneOffset + this.recoveryBias, -EDGE_LINE_M, EDGE_LINE_M)
        : plan.line;
    const indicatorDelta = desiredLine - this.appliedLateral;
    vehicle.setIndicator(
      Math.abs(indicatorDelta) < 0.2 ? 'off' : indicatorDelta > 0 ? 'left' : 'right',
    );


    // Ease onto the chosen line instead of jumping to it. The waypoint itself is
    // shifted by the rate-limited line, so lane keeping, obstacle avoidance and
    // passing all use one stable controller rather than fighting over the steering.
    // THE LINE MOVES PER METRE OF ROAD, EXCEPT WHEN THERE IS NO ROAD BEING COVERED.
    //
    // Rate-limiting by distance is what keeps a replan from stepping the steering,
    // but it deadlocks a car that has stopped BECAUSE of where its line points: the
    // line needed two metres of movement to clear a parked car, two metres of line
    // costs 22 m of travel, and the travel was exactly what the line was preventing.
    // Measured, the car shuffled backwards and forwards for half a minute.
    //
    // A stationary driver turns the wheel before moving off, so below walking pace
    // the line may slew on time instead. Above it the distance rule is unchanged —
    // the two are equal at 5.6 m/s, and nothing fast ever sees the floor.
    // AND ONE EXCEPTION ABOVE THAT: something coming the other way.
    //
    // A pass that has been abandoned leaves the car on the wrong side of the road,
    // and if it has also been braked to walking pace it takes seven seconds of the
    // ordinary rate to get back — measured, that is long enough to be hit head-on at
    // 8 km/h by traffic doing 70. When the gap is closing FASTER than the car is
    // moving, the thing ahead is coming at it, and clearing the lane stops being a
    // manoeuvre and becomes the only thing that matters.
    // Where the CAR is, not where its line is: the line is often already home while
    // the body is still out in the other lane, which is exactly the dangerous state.
    const onWrongSide =
      projection.lateral * Math.sign(config.laneOffset || -1) < -CAR_HALF_WIDTH_M * 0.5;
    const headOn = gap < Infinity && this.leadClosingValue > speed + HEAD_ON_MARGIN_MPS;
    const lineRate =
      Math.max(
        LINE_SHIFT_PER_METRE * speed,
        LINE_SLEW_AT_REST_MPS,
        onWrongSide && headOn ? LINE_SLEW_ESCAPE_MPS : 0,
      ) * Math.max(dt, 0);
    this.appliedLateral += clamp(desiredLine - this.appliedLateral, -lineRate, lineRate);
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
    const lateralLimit = this.planUsesShoulder ? STATIC_AVOID_EDGE : PASSING_EDGE;
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
    const clearRoadSpeed = Math.min(config.cruiseMps, this.speedCapValue);
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
      const conditionFactor = Math.max(
        0.55,
        1 -
          this.condition.decay * DECAY_SPEED_LOSS -
          this.condition.sandCover * SAND_COVER_SPEED_LOSS,
      );
      const straightLimit = Math.max(
        OFFROAD_SPEED_MPS,
        clearRoadSpeed * SURFACE_SPEED_FACTOR[surface] * conditionFactor,
      );
      const physicalBrake = vehicle.estimatedBrakeDecel(surface);
      const sampleGradeLoad = Math.min(
        0.8,
        Math.abs(sample.grade * GRAVITY) / Math.max(physicalBrake, 1),
      );
      const lateralAccel = Math.min(
        config.lateralAccel,
        vehicle.estimatedLateralAccel(surface, Math.max(speed, clearRoadSpeed)) *
          LATERAL_GRIP_RESERVE *
          Math.sqrt(Math.max(0.35, 1 - sampleGradeLoad * sampleGradeLoad)),
      );
      const curvature = Math.abs(sample.curvature);
      upcomingCurvature = Math.max(upcomingCurvature, curvature);
      const localLimit = Math.min(
        straightLimit,
        Math.sqrt(lateralAccel / Math.max(curvature, 1e-4)),
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
    targetSpeed = Math.max(3, targetSpeed);
    if (hazard?.breakable) targetSpeed = Math.min(targetSpeed, 8);
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
      const braking = Math.sqrt(blockSpeed * blockSpeed + 2 * currentBrakeAccel * room);
      // Something STILL in the corridor is approached at walking pace, not stopped
      // for: the car is going to ease past it, and a littered road is otherwise a
      // continuous emergency stop — measured at 0.9 m/s against a 30 m/s cruise,
      // with a clear line through the whole field the entire time. The nose scan
      // and `mustStop` are what actually stop the car when contact is imminent.
      targetSpeed = Math.min(
        targetSpeed,
        blockSpeed > CRAWL_SPEED_MPS ? braking : Math.max(AVOIDANCE_CRAWL_MPS, braking),
      );
      if (blockSpeed > CRAWL_SPEED_MPS) {
        // Moving: keep a time headway behind it.
        const headwayGap =
          FOLLOW_STANDOFF_M + speed * (this.followingHeadwayValue ?? config.headwayS);
        targetSpeed = Math.min(
          targetSpeed,
          Math.max(0, blockSpeed + (this.corridorBlockDistance - headwayGap) / FOLLOW_RELAX_S),
        );
      }
    }
    // A LANE CHANGE TAKES THIRTY METRES, AND THE CAR AHEAD IS STILL AHEAD FOR ALL
    // OF THEM. Once the chosen corridor is the opposing lane, the car being passed
    // is no longer in it and stops being braked for — correct once the body is out
    // there, and a rear-end while still crossing: measured as twelve contacts in
    // the dense bench the moment overtakes started working. So while the body is
    // still in its own lane, whatever is in THAT lane keeps its headway.
    if (
      this.corridorLaneBlockDistance < Infinity &&
      // Moving only: a STATIC prop in the lane is what the corridor is going round,
      // and keeping a headway behind it is a crawl that never ends.
      this.corridorLaneBlockSpeed > CRAWL_SPEED_MPS &&
      // A body at the centreline still overlaps the lane it is leaving, so the
      // headway holds until the car is genuinely out of it — a whole body width,
      // not half. Released at half, the crossing car rear-ended the leader it was
      // committed to overtaking: eight contacts in the dense bench, every one of
      // them logged at a lateral of about zero.
      Math.abs(projection.lateral - config.laneOffset) < CAR_HALF_WIDTH_M * 2
    ) {
      const laneSpeed = Math.max(0, this.corridorLaneBlockSpeed);
      const headwayGap =
        FOLLOW_STANDOFF_M + speed * (this.followingHeadwayValue ?? config.headwayS);
      targetSpeed = Math.min(
        targetSpeed,
        Math.sqrt(
          laneSpeed * laneSpeed +
            2 * currentBrakeAccel * Math.max(0, this.corridorLaneBlockDistance - FOLLOW_STANDOFF_M),
        ),
        // Never below the leader's own pace: dropping back is not how a pass starts.
        Math.max(
          laneSpeed,
          laneSpeed + (this.corridorLaneBlockDistance - headwayGap) / FOLLOW_RELAX_S,
        ),
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
              currentBrakeAccel *
              Math.max(0, this.corridorSqueezeDistance - config.brakeLead),
        ),
      );
    }
    if (offRoad) targetSpeed = Math.min(targetSpeed, OFFROAD_SPEED_MPS);
    if (edgeStability) targetSpeed = Math.min(targetSpeed, OFFROAD_SPEED_MPS);
    // What the driver WANTED before the bumper veto. A nose scan against scenery is
    // the very situation the stall rule exists for, so it must not be the thing
    // that hides the driver's intent from it.
    const wantedSpeed = targetSpeed;
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
    const stalled =
      vehicle.engineRunning &&
      (!this.corridorFeasible || askingToMove || opposingDeadlock) &&
      speed < CRAWL_SPEED_MPS;
    const movedFromAnchor = Math.hypot(
      this.position.x - this.stallAnchorX,
      this.position.z - this.stallAnchorZ,
    );
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

    if (
      stalled &&
      this.recoveryPhase === 'none' &&
      (opposingDeadlock || this.stoppedFor >= STUCK_AFTER_S)
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
      // The pull-out drives on a fixed lock with no planner behind it, so it has to
      // be given everything known to be in front: the rays see only dynamic bodies,
      // and it was accelerating at indexed rock it could not feel.
      this.driveRecovery(
        dt,
        out,
        forwardSpeed,
        projection.lateral,
        this.recoveryCommitted ? Infinity : Math.min(gap, this.hazardDistance),
      );
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
    out.brake =
      speedError < 0 ? clamp(-speedError / config.brakeBand, 0, config.brakeCeiling) : 0;
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
    const enteringCurve =
      upcomingCurvature >= TURN_COAST_CURVATURE ||
      Math.abs(out.steer) >= TURN_COAST_STEER;
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
    if (this.automaticLightsOn) {
      if (this.daylightFactor >= AUTO_LIGHTS_OFF_DAY_FACTOR) this.automaticLightsOn = false;
    } else if (this.daylightFactor <= AUTO_LIGHTS_ON_DAY_FACTOR) {
      this.automaticLightsOn = true;
    }
    vehicle.setHeadlights(this.automaticLightsOn ? 'low' : 'off');
  }

  /**
   * Estimated speed of whatever the corridor holds, from the probe's own derivative.
   *
   * A body that has just come into view is assumed to be travelling with us for one
   * time constant rather than treated as a wall, which is the difference between
   * joining traffic and standing on the brakes every time a car appears over a
   * crest. The estimate converges within a third of a second either way.
   *
   * TWO THINGS PROTECT IT, and both were learned from the traffic lap.
   *
   * A probe that switches from one car to another, or loses one round a bend, steps
   * its distance by tens of metres in a single tick. Differentiated, that is a
   * closing rate no vehicle has, so a step beyond `LEAD_JUMP_MPS` is treated as a
   * change of target and contributes no sample at all. Without it the estimate dipped
   * to zero for a few tenths of a second at a time.
   *
   * And "parked" has to be CONFIRMED over time, because it decides whether the car
   * may use the shoulder. Those brief dips were enough to convince both modes that
   * a car doing 70 km/h in front of them was stationary: sleeper hopped onto the
   * verge thirteen times in a lap, and frantic did it at 120 km/h and left the road.
   */
  private updateLead(dt: number, gap: number, speed: number): void {
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
      this.leadMeasured = false;
      return;
    }
    const previous = this.obstacleGapValue;
    this.obstacleGapValue = gap;
    if (!(previous < Infinity) || dt <= 0) {
      this.obstacleSpeedValue = speed;
      this.leadClosingValue = 0;
      this.leadParkedFor = 0;
      this.leadMeasured = false;
      return;
    }
    const closing = (previous - gap) / dt;
    if (Math.abs(closing) <= LEAD_JUMP_MPS) {
      const measured = clamp(speed - closing, 0, 80);
      // The first real sample REPLACES the acquisition guess instead of being
      // averaged into it: the guess is "it is moving with us", which is the safe
      // thing to assume for one tick and the wrong thing to keep believing.
      const alpha = this.leadMeasured ? Math.min(1, dt / LEAD_SPEED_TAU_S) : 1;
      this.leadMeasured = true;
      this.obstacleSpeedValue += (measured - this.obstacleSpeedValue) * alpha;
      this.leadClosingValue += (closing - this.leadClosingValue) * alpha;
    }
    // A CAR COMING AT US IS NOT A PARKED CAR.
    //
    // `measured` is our own speed minus the closing rate, clamped at zero — and for
    // an oncoming car the closing rate is the SUM of the two speeds, so the estimate
    // pins at zero and the confirmation timer runs exactly as it would behind a
    // wreck. Six tenths of a second later the driver believed there was an abandoned
    // car in its lane and took the shoulder to get round it, on a clean road, in
    // both directions at once, every time two streams met near a bend where the
    // corridor probe strays into the other lane. The closing rate is what tells the
    // two apart: nothing stationary can approach faster than we are travelling.
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
    const persistentRoadblock =
      committedDeadlock || wedgedOffRoad || !this.corridorFeasible;
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
    const right = Math.sign(config.laneOffset || -1);
    this.recoverySide =
      lateral * right > ROAD_HALF_WIDTH - CAR_HALF_WIDTH_M ? -right : right;
    this.recoveryAttempts = persistentRoadblock
      ? 0
      : samePlace
        ? this.recoveryAttempts + 1
        : 1;
    this.lastRecoveryAt = this.travelled;
    this.sinceRecovery = 0;
    this.stoppedFor = 0;
    this.recoveryCommitted = committedDeadlock;
    // Reversing into the car behind is worse than the obstacle in front, so a blocked
    // tail skips straight to the pull-out and steers out of the problem instead.
    const rearClear =
      this.axisScan(vehicle, originX, originZ, -1, RECOVERY_REAR_CLEAR_M + 2) >
      RECOVERY_REAR_CLEAR_M;
    this.recoveryPhase = rearClear ? 'reverse' : 'pullout';
    this.recoveryTimer = rearClear ? RECOVERY_REVERSE_S : RECOVERY_PULLOUT_S;
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
   * The manoeuvre itself. Reversing with the wheels turned toward `recoverySide`
   * swings the NOSE that way — a steered axle dragged backwards yaws the body the
   * opposite way to the same lock driven forwards — and the pull-out then uses the
   * opposite lock to drive out along the side the nose is already pointing at.
   */
  private driveRecovery(
    dt: number,
    out: InputFrame,
    forwardSpeed: number,
    lateral: number,
    gap: number,
  ): void {
    this.recoveryTimer -= dt;
    out.handbrake = false;
    if (this.recoveryPhase === 'reverse') {
      out.throttle = 0;
      // In automatic mode, reverse=true selects R at rest and brake becomes reverse
      // throttle on the following tick, so the same pedal stops a car still rolling
      // forward and then backs it up.
      out.brake = RECOVERY_REVERSE_BRAKE;
      out.reverse = true;
      out.steer = clamp(this.recoverySide * RECOVERY_STEER, -1, 1);
      // The lateral test is "the reverse has taken the car far enough out to steer
      // round what blocked it". A car that was ALREADY out there — wedged on a pole
      // on the verge — satisfies it on the first tick, which ended the reverse
      // before the clutch had taken up and handed straight back to a pull-out that
      // drove into the same pole. Out there the timer owns the phase.
      if (
        this.recoveryTimer <= 0 ||
        (!this.recoveryOffRoad && Math.abs(lateral) > EDGE_LINE_M + CAR_HALF_WIDTH_M)
      ) {
        this.recoveryPhase = 'pullout';
        this.recoveryTimer = RECOVERY_PULLOUT_S;
      }
      return;
    }
    out.reverse = false;
    out.steer = clamp(-this.recoverySide * RECOVERY_STEER, -1, 1);
    // Still rolling backwards: the automatic only selects a forward gear at rest, so
    // the pedal that matters is the brake until it is stopped.
    if (forwardSpeed < -0.15) {
      out.throttle = 0;
      out.brake = 0.5;
      return;
    }
    out.brake = 0;
    out.throttle = forwardSpeed < RECOVERY_CRAWL_MPS ? 0.55 : 0;
    // The pull-out is what brings a car back from where the reverse put it, so its
    // own end condition cannot be the line limit the reverse just crossed — that cut
    // the manoeuvre off on its first tick and left the car sitting on the verge. It
    // ends on time, on something in front, or on genuinely leaving the road.
    //
    // A wedge that happened OFF the asphalt is already outside that line, so the
    // same test would end the manoeuvre before it moved a metre and hand the car
    // straight back to the throttle that was cooking the engine against a pole.
    // Out there, only the timer and the nose end it.
    const arrived =
      this.recoveryTimer <= 0 ||
      gap < MUST_STOP_GAP_M ||
      (!this.recoveryCommitted &&
        !this.recoveryOffRoad &&
        Math.abs(lateral) > OFFROAD_RECOVERY_EDGE);
    if (arrived) {
      this.recoveryPhase = 'none';
      this.recoveryOffRoad = false;
      this.recoveryTimer = 0;
      this.stoppedFor = 0;
      this.recoveryCommitted = false;
      // Hold the escape side for the next stretch of road. Without this the resumed
      // line is the one that was blocked, and the car drives back into the obstacle
      // it just reversed away from — the loop this manoeuvre exists to break.
      this.recoveryBias = this.recoverySide * RECOVERY_BIAS_M;
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
    if (!this.physics) return Infinity;
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
        if (along < nearest) nearest = along;
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
      if (hit && collider?.parent()?.isDynamic() && hit.toi < nearest) nearest = hit.toi;
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
