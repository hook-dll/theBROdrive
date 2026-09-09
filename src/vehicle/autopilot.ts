/** Fixed-step road follower. Inputs remain ordinary InputFrame commands. */
import type { InputFrame } from '../core/input';
import type { PhysicsWorld } from '../core/physics';
import { ROAD_HALF_WIDTH, type Road } from '../world/road';
import { HazardIndex, type RoadHazard } from '../world/hazards';
import type { Vehicle } from './vehicle';

export type AutopilotMode = 'sleeper' | 'frantic';

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
  readonly hazardMargin: number;
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
    hazardMargin: 1.4,
    brakeLead: 18,
    curveLead: 30,
    laneOffset: -ROAD_HALF_WIDTH / 2,
    chordGain: 0.9,
    holdSeconds: 0.65,
    holdShare: 0.5,
    throttleBand: 6,
    brakeBand: 7,
    brakeCeiling: 0.55,
    headwayS: 2.2,
    overtakes: false,
    passCurvature: 0.012,
  },
  frantic: {
    cruiseMps: 130 / 3.6,
    lateralAccel: 6.8,
    brakeAccel: 7.2,
    lookaheadBase: 9,
    lookaheadSpeed: 1.0,
    hazardMargin: 0.45,
    brakeLead: 7,
    curveLead: 24,
    laneOffset: -ROAD_HALF_WIDTH / 2,
    chordGain: 0.45,
    holdSeconds: 0.85,
    holdShare: 0.35,
    throttleBand: 1.2,
    brakeBand: 1.8,
    brakeCeiling: 1,
    headwayS: 1.2,
    overtakes: true,
    passCurvature: 0.006,
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
// These mirror Vehicle's input-to-road-wheel path. Pure pursuit must cross the
// steering-box play window without turning a small, valid curvature into full lock.
const STEER_INPUT_EXPONENT = 1.35;
const STEER_PLAY_RAD = 0.024;
const STEER_FULL_LOCK_KMH = 20;
const STEER_REDUCED_KMH = 100;
const STEER_HIGH_SPEED_FRACTION = 0.5;
const STEER_LOCK_CURVE = 0.161;
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
const TURN_CURVATURE_SAMPLES = 8;
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
const OFFROAD_RECOVERY_EDGE = PASSING_EDGE;
const OFFROAD_RECOVERY_LINE = ROAD_HALF_WIDTH - CAR_HALF_WIDTH_M - 0.2;
const OFFROAD_SPEED_MPS = 8;
const OFFROAD_BRAKE_MAX = 0.35;

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
/** Two rays a body's width apart cover a lane without pretending to be a sweep. */
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
/** Below this the obstacle counts as parked, and even `sleeper` will go round it. */
const PARKED_SPEED_MPS = 1.5;
/** For how long, before a decision may be taken on it. See `updateLead`. */
const PARKED_CONFIRM_S = 0.6;

/**
 * PASSING. Sleeper only passes things that are not going to move; frantic passes
 * anything slower than it wants to go, and both need the same three answers: is the
 * road straight enough to commit, is there a line that is clear, and is it time to
 * come back.
 */
// A lane change costs 2.9/LINE_SHIFT_PER_METRE ≈ 32 m of road, so the decision has
// to be taken with at least that much left: 2.5 s of travel is 37 m at 15 m/s and
// 90 m at 130 km/h, which is also about when a driver commits.
const PASS_TRIGGER_SECONDS = 2.5;
const PASS_TRIGGER_MIN_M = 16;
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
/** The lane must be clear this far ahead before the pass is over. */
const PASS_RETURN_GAP_M = 24;
const PASS_MIN_METRES = 32;
/** A pass that has taken this much road is abandoned; something went wrong. */
const PASS_MAX_METRES = 260;
/** Traffic appearing this close in the lane being used aborts the pass. */
const PASS_ABORT_SECONDS = 1.6;
const PASS_ABORT_MIN_M = 14;

/**
 * BEING STUCK, and getting out of it.
 *
 * A car that is asking for motion and not producing any is wedged, nosed into
 * something, or resting on ground it cannot climb. The old response was two seconds
 * of reverse with the wheels turned toward the road, after which ordinary guidance
 * resumed — and ordinary guidance aims at the same point it was aiming at before, so
 * the car drove straight back into the obstacle it had just backed away from.
 *
 * The manoeuvre is now the one a driver makes: back up with the wheels turned so the
 * NOSE swings toward the free side, then pull forward with them turned the other
 * way, and hold a lateral bias for the next stretch of road so the line that is
 * resumed goes round the obstacle instead of into it. A second stall within
 * `RECOVERY_RETRY_METRES` tries the other side, and after both sides have been tried
 * in the same place the car GIVES UP and waits: a road blocked from verge to verge
 * is a road blocked, and a car that keeps reversing and re-approaching a wall is
 * worse than one that sits in front of it. Moving 45 m of road, or the obstacle
 * going away, arms the manoeuvre again.
 *
 * Reversing is skipped when something is close behind: in traffic the car behind is
 * a worse problem than the one in front.
 */
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
const RECOVERY_CRAWL_MPS = 4.5;
const RECOVERY_BIAS_METRES = 50;
const RECOVERY_REAR_CLEAR_M = 5;
const RECOVERY_RETRY_METRES = 45;
/**
 * How far off its lane the car holds after a pull-out. It has to be enough to CLEAR
 * what it was stuck on: 1.7 m left a body-width overlap with a car parked in the
 * lane, so the bias puts the line just past the centreline, where 2.2 m of
 * separation is a real pass.
 */
const RECOVERY_BIAS_M = 2.2;
const RECOVERY_ATTEMPT_LIMIT = 2;
/** Seconds of getting nowhere after which a given-up manoeuvre is worth retrying. */
const RECOVERY_REARM_S = 30;

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
  private bodyScanGap = Infinity;
  /**
   * The hazard currently being avoided and the line chosen for it.
   *
   * Latched, and that is the whole point. Replanning every tick made the car swerve
   * continuously on a real road: in-asphalt scatter is frequent, so the NEAREST
   * hazard changed every few seconds, the side preference flipped with it, and the
   * moment one was passed the target snapped back to the centreline — into the line
   * of the next one. A plan is kept until its hazard is behind the car.
   */
  private plannedHazard: RoadHazard | null = null;
  private plannedLateral = 0;
  /** Line actually commanded, rate-limited toward the line the driver wants. */
  private appliedLateral = 0;
  /** Committed passing line while going round traffic, or null. */
  private passLine: number | null = null;
  private passStartedAt = 0;
  private recoveryPhase: 'none' | 'reverse' | 'pullout' = 'none';
  private recoveryTimer = 0;
  /** Signed lateral direction the recovery is escaping toward. */
  private recoverySide = 1;
  private recoveryBias = 0;
  private recoveryBiasUntil = 0;
  private lastRecoveryAt = -Infinity;
  private recoveryAttempts = 0;
  private speedCapValue = Infinity;
  private readonly position = { x: 0, y: 0, z: 0 };
  private readonly rayOrigin = { x: 0, y: 0, z: 0 };
  private readonly rayDirection = { x: 0, y: 0, z: 0 };
  private readonly probeNear = { x: 0, y: 0, z: 0 };
  private readonly probeFar = { x: 0, y: 0, z: 0 };
  /** Car lateral at the time of the scan; a hazard off to one side is not a hazard. */
  private scanLateral = 0;
  private readonly visitHazard = (hazard: RoadHazard): void => {
    const distance = hazard.s - this.hintS;
    if (distance >= this.hazardDistance) return;
    // The intended line matters as much as the current line: after avoiding one prop,
    // the next prop may be on the detour rather than on the centreline.
    const reach = hazard.radius + CAR_HALF_WIDTH_M + AVOID_HYSTERESIS_M;
    const inCurrentPath = Math.abs(hazard.lateral - this.scanLateral) < reach;
    const inPlannedPath = Math.abs(hazard.lateral - this.plannedLateral) < reach;
    if (!inCurrentPath && !inPlannedPath) return;
    this.hazard = hazard;
    this.hazardDistance = distance;
  };
  /** Clears the nearest-hazard result before a scan. See the note in `drive`. */
  private beginHazardScan(lateral: number): void {
    this.hazard = null;
    this.hazardDistance = Infinity;
    this.scanLateral = lateral;
  }


  constructor(
    private readonly road: Road,
    private readonly hazards: HazardIndex,
    /** Optional only until Vehicle exposes its PhysicsWorld; main passes the shared world. */
    private readonly physics?: PhysicsWorld,
  ) {}

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
  get engaged(): boolean { return this.engagedValue; }
  /** Rate-limited line being steered to, metres of road lateral. */
  get commandedLine(): number { return this.appliedLateral; }
  /** Distance to the nearest dynamic body in the corridor, metres, or Infinity. */
  get obstacleGap(): number { return this.obstacleGapValue; }
  /** Estimated speed of that body, m/s. Zero for anything parked. */
  get obstacleSpeed(): number { return this.obstacleSpeedValue; }
  get activity(): AutopilotActivity { return this.activityValue; }

  setEngaged(engaged: boolean): void {
    this.engagedValue = engaged;
    this.hintValid = false;
    this.stoppedFor = 0;
    this.sinceRecovery = RECOVERY_REARM_S;
    this.recoveryPhase = 'none';
    this.recoveryTimer = 0;
    this.recoveryBias = 0;
    this.recoveryBiasUntil = 0;
    this.lastRecoveryAt = -Infinity;
    this.recoveryAttempts = 0;
    this.passLine = null;
    this.obstacleGapValue = Infinity;
    this.obstacleSpeedValue = 0;
    this.activityValue = 'cruise';
    if (!engaged) {
      this.plannedHazard = null;
      this.plannedLateral = 0;
      this.appliedLateral = 0;
    }
  }

  /** Writes controls in-place using a geometric pure-pursuit waypoint. */
  drive(dt: number, vehicle: Vehicle, out: InputFrame, originX: number, originZ: number): void {
    if (!this.engagedValue) return;
    const config = MODES[this.modeValue];
    vehicle.absoluteTranslation(this.position);
    const projection = this.road.project(
      this.position.x,
      this.position.z,
      this.hintValid ? this.hintS : undefined,
    );
    this.hintS = projection.s;
    this.hintValid = true;
    const velocity = vehicle.chassis.linvel();
    const speed = Math.hypot(velocity.x, velocity.z);
    this.travelled += speed * dt;
    this.sinceRecovery += dt;
    const offRoad = Math.abs(projection.lateral) > OFFROAD_RECOVERY_EDGE;
    if (offRoad) {
      // A previous obstacle plan is no longer useful after an impact or flight into
      // the desert. Road recovery takes priority and starts from the nearest safe
      // road-edge line instead of trying to continue the old detour.
      this.plannedHazard = null;
      this.plannedLateral = 0;
      this.appliedLateral = 0;
      this.passLine = null;
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
    const target = this.road.sampleAt(this.hintS + lookahead);
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
    let headingError = Math.atan2(forwardX, forwardZ) - this.road.sampleAt(this.hintS).heading;
    while (headingError > Math.PI) headingError -= Math.PI * 2;
    while (headingError < -Math.PI) headingError += Math.PI * 2;
    const bodyLaneGap =
      Math.abs(headingError) < PROBE_PARALLEL_RAD &&
      Math.abs(projection.lateral - this.appliedLateral) > PROBE_HALF_WIDTH_M
        ? this.laneProbe(vehicle, projection.lateral, sight, originX, originZ)
        : Infinity;
    this.updateLead(dt, Math.min(this.bodyScanGap, laneGap, bodyLaneGap), speed);
    const gap = this.obstacleGapValue;
    const leadSpeed = this.obstacleSpeedValue;
    let mustStop = this.bodyScanGap < MUST_STOP_GAP_M;

    // Retire only after the REAR of the car has passed the far edge of the prop.
    // The old subtraction retired at the near edge, exactly while the car was
    // alongside it, and centreline guidance then steered back through the obstacle.
    const planned = this.plannedHazard;
    if (planned && planned.s + planned.radius + CAR_HALF_LENGTH_M < this.hintS) {
      this.plannedHazard = null;
      this.plannedLateral = 0;
    }
    if (!offRoad && hazard && (this.plannedHazard === null || hazard.s < this.plannedHazard.s)) {
      const line = this.detourLine(hazard, config);
      if (line === null) {
        mustStop = true;
      } else {
        this.plannedHazard = hazard;
        this.plannedLateral = line;
      }
    }
    const hasIndexedDetour = hazard !== null && this.plannedHazard === hazard;
    const rayMatchesIndexedHazard =
      hasIndexedDetour &&
      this.bodyScanGap < Infinity &&
      Math.abs(this.bodyScanGap - this.hazardDistance) <= INDEXED_RAY_MATCH_M;
    if (rayMatchesIndexedHazard) {
      // The short ray is seeing the same prop for which a clear line already exists.
      // Do not convert a controlled crawl into a full stop before the lateral move.
      mustStop = false;
    }

    // Where the driver wants the car, before the rate limit: recovery bias, an
    // indexed detour, a pass in progress, or simply its own lane.
    const recovering = this.recoveryPhase !== 'none';
    if (!offRoad && !recovering && this.plannedHazard === null) {
      this.updatePass(vehicle, config, projection.lateral, speed, gap, leadSpeed, originX, originZ);
    } else if (this.passLine !== null && (offRoad || recovering)) {
      this.passLine = null;
    }
    const desiredLine = offRoad
      ? Math.sign(projection.lateral || 1) * OFFROAD_RECOVERY_LINE
      : this.plannedHazard !== null
        ? this.plannedLateral
        : this.travelled < this.recoveryBiasUntil
          ? clamp(config.laneOffset + this.recoveryBias, -EDGE_LINE_M, EDGE_LINE_M)
          : (this.passLine ?? config.laneOffset);

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
    const chordShift =
      -this.road.curvatureAt(this.hintS + lookahead * 0.5) *
      lookahead *
      lookahead *
      0.125 *
      config.chordGain;
    const targetLateral = clamp(this.appliedLateral + chordShift, -PASSING_EDGE, PASSING_EDGE);
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
      (config.holdShare * config.lateralAccel) / Math.max(speed * speed, 1),
    );
    const holdCurvature = clamp(
      (2 * (this.appliedLateral - projection.lateral)) / (holdDistance * holdDistance),
      -holdCap,
      holdCap,
    );
    const wheelAngle = Math.atan(wheelbaseOf(vehicle) * (pursuitCurvature + holdCurvature));
    // Vehicle applies its speed-dependent lock, input exponent and backlash after
    // receiving this value. Pre-compensate those three stages so the requested
    // geometric angle is what reaches the tyres, not a command hidden inside slack.
    out.steer = steeringInputForWheelAngle(wheelAngle, vehicle.modelDef.steerLock, speed);

    // Look beyond the physical braking distance for the bend's peak curvature.
    // `curveLead` provides setup distance before braking becomes mandatory; keeping
    // it separate from obstacle `brakeLead` avoids making prop stops unnecessarily
    // early. Extra samples retain roughly the old spatial resolution over the
    // longer preview.
    const turnLookahead = Math.max(
      lookahead,
      config.curveLead + config.brakeLead + (speed * speed) / (2 * config.brakeAccel),
    );
    let upcomingCurvature = Math.abs(target.curvature);
    for (let i = 1; i <= TURN_CURVATURE_SAMPLES; i++) {
      upcomingCurvature = Math.max(
        upcomingCurvature,
        Math.abs(this.road.curvatureAt(this.hintS + (turnLookahead * i) / TURN_CURVATURE_SAMPLES)),
      );
    }
    let targetSpeed = Math.min(
      Math.min(config.cruiseMps, this.speedCapValue),
      Math.sqrt(config.lateralAccel / Math.max(upcomingCurvature, 1e-4)),
    );
    targetSpeed = Math.max(3, targetSpeed - Math.max(0, target.grade) * 4);
    // What the ROAD alone asks for, before anything in the way is considered. The
    // stall detector needs it: a car at a standstill because of an obstacle is a very
    // different thing from one at a standstill because the mode wants to be.
    const roadSpeed = targetSpeed;
    if (hazard?.breakable) targetSpeed = Math.min(targetSpeed, 8);
    // A prop the COMMANDED LINE already clears is scenery to drive past, not an
    // obstacle to brake for.
    //
    // Braking for it anyway is what made a littered road crawl: in-asphalt scatter
    // arrives every few tens of metres, so the next prop was always inside the
    // braking envelope and the target speed never climbed out of it — measured at
    // 6.4 m/s against a 20 m/s cruise, with the steering calm and a clear line
    // through the whole field the entire time. The envelope keeps a planned prop
    // only while the car is still moving onto the line that passes it.
    // Two ways a planned prop leaves the braking envelope: the line already passes
    // it, or there is still room to GET onto that line before reaching it. The line
    // moves at `LINE_SHIFT_PER_METRE` of road, so the distance the move needs is
    // arithmetic; the 1.5 factor and the body length are the margin for arriving
    // established rather than still moving across.
    const shiftNeeded =
      (Math.abs(this.plannedLateral - this.appliedLateral) / LINE_SHIFT_PER_METRE) * 1.5
      + CAR_HALF_LENGTH_M;
    const lineClearsHazard =
      hazard !== null &&
      hasIndexedDetour &&
      (Math.abs(this.appliedLateral - hazard.lateral) >= hazard.radius + CAR_HALF_WIDTH_M
        || this.hazardDistance >= shiftNeeded);
    if (!lineClearsHazard && this.hazardDistance < Infinity) {
      const brakingSpeed = Math.sqrt(
        Math.max(0, 2 * config.brakeAccel * Math.max(0, this.hazardDistance - config.brakeLead)),
      );
      targetSpeed = Math.min(
        targetSpeed,
        hasIndexedDetour ? Math.max(AVOIDANCE_CRAWL_MPS, brakingSpeed) : brakingSpeed,
      );
    }
    // Traffic, on relative terms. `leadSpeed` is what the probe measured, so the
    // stopping bound reduces to the old wall case when the obstacle is parked and
    // stops asking a following car to brake for a gap that is not closing.
    if (gap < Infinity && !(rayMatchesIndexedHazard && lineClearsHazard)) {
      const closingRoom = Math.max(0, gap - FOLLOW_STANDOFF_M);
      const stoppingCap = leadSpeed + Math.sqrt(2 * config.brakeAccel * closingRoom);
      const headwayGap = FOLLOW_STANDOFF_M + speed * config.headwayS;
      const followCap = Math.max(0, leadSpeed + (gap - headwayGap) / FOLLOW_RELAX_S);
      targetSpeed = Math.min(targetSpeed, stoppingCap, followCap);
    }
    if (offRoad) targetSpeed = Math.min(targetSpeed, OFFROAD_SPEED_MPS);
    if (mustStop) targetSpeed = 0;

    // BEING STUCK IS A LACK OF PROGRESS, NOT A STANDSTILL, AND NOT A SPEEDOMETER
    // READING EITHER.
    //
    // Three ways to be stuck: asking for motion and getting none, sitting behind
    // something parked, or nosed into scenery nobody indexed. The last one is what a
    // crash leaves behind, and it used to be undetectable: rays only report DYNAMIC
    // bodies, because static obstacles are supposed to be known in the road frame, so
    // a car resting against a rock or a bank has no obstacle ahead of it at all as
    // far as this class can tell. The test that was left — a target above 1 m/s and a
    // speed under 1 km/h — then never fired, because a car with its foot down against
    // something solid does not sit still: the tyres bite and slip, the body rocks, and
    // every excursion past 1 km/h decayed the timer. Reported as an autopilot that
    // revs the engine forever and never tries to back out.
    //
    // So there is ONE test, and it measures metres of GROUND COVERED from an anchor
    // dropped where the stall began. Distance travelled cannot be used for this:
    // `travelled` integrates the speed MAGNITUDE, so a car rocking in place accrues
    // it and keeps clearing its own timer. A car picking its way past a rock field at
    // 1.4 m/s covers the anchor distance and is working; a car that has moved two
    // metres in three seconds is stuck, whatever it is doing with the throttle.
    const wantsProgress = vehicle.engineRunning && roadSpeed > 1;
    const stalled = wantsProgress && speed < CRAWL_SPEED_MPS;
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

    if (this.recoveryPhase === 'none' && this.stoppedFor >= STUCK_AFTER_S) {
      this.beginRecovery(vehicle, config, projection.lateral, originX, originZ);
    }
    if (this.recoveryPhase !== 'none') {
      this.activityValue = 'recover';
      // The pull-out drives on a fixed lock with no planner behind it, so it has to
      // be given everything known to be in front: the rays see only dynamic bodies,
      // and it was accelerating at indexed rock it could not feel.
      this.driveRecovery(
        dt,
        out,
        forwardSpeed,
        projection.lateral,
        Math.min(gap, this.hazardDistance),
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
      this.activityValue = 'recover';
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
    out.throttle = speedError > 0 ? clamp(speedError / config.throttleBand, floor, 1) : 0;
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
    this.activityValue = offRoad
      ? 'offroad'
      : this.plannedHazard !== null
        ? 'avoid'
        : this.passLine !== null
          ? 'pass'
          : gap < Infinity && targetSpeed < config.cruiseMps - 0.5 && leadSpeed < config.cruiseMps
            ? 'follow'
            : 'cruise';
  }

  /**
   * Smallest detour that clears an indexed prop, or null if none fits.
   *
   * Sleeper takes the side that keeps it on its OWN half of the road wherever that
   * fits, because crossing the centreline for a rock is what it is trying not to do;
   * frantic takes whichever side is the smaller move from the line it is already on.
   */
  private detourLine(hazard: RoadHazard, config: ModeConfig): number | null {
    // Pick the smallest safe detour first, then decide about braking separately.
    // A full sleeper margin before the compact clearance pushed centre-lane rocks
    // to the road edge even when a modest lane change was enough.
    const bodyClearance = hazard.radius + CAR_HALF_WIDTH_M;
    const ownSide = Math.sign(config.laneOffset) || -1;
    const clearanceLevels = [
      bodyClearance + Math.min(config.hazardMargin, AVOID_HYSTERESIS_M),
      bodyClearance + config.hazardMargin,
      bodyClearance,
    ];
    for (const clearance of clearanceLevels) {
      const left = hazard.lateral + clearance;
      const right = hazard.lateral - clearance;
      const leftFits = Math.abs(left) <= EDGE_LINE_M;
      const rightFits = Math.abs(right) <= EDGE_LINE_M;
      if (!leftFits && !rightFits) continue;
      const own = ownSide < 0 ? right : left;
      const other = ownSide < 0 ? left : right;
      const ownFits = ownSide < 0 ? rightFits : leftFits;
      const otherFits = ownSide < 0 ? leftFits : rightFits;
      if (!config.overtakes && ownFits) return own;
      if (!otherFits) return own;
      if (!ownFits) return other;
      // Whichever side needs the smaller move from the line already being held,
      // so an off-centre hazard is passed without crossing the whole road and a
      // plan in progress is not thrown away for its mirror image.
      return Math.abs(own - this.appliedLateral) <= Math.abs(other - this.appliedLateral)
        ? own
        : other;
    }
    return null;
  }

  /**
   * Starts, holds and ends a pass. Writes `passLine`; reads only what it is given.
   *
   * The trigger is deliberately different per mode: sleeper goes round a PARKED
   * obstacle (nothing else is worth crossing a centreline for), frantic goes round
   * anything materially slower than it wants to be going. Everything after the
   * trigger is common — a clear line, a straight enough road, and a return as soon
   * as the lane it left has room again.
   */
  private updatePass(
    vehicle: Vehicle,
    config: ModeConfig,
    lateral: number,
    speed: number,
    gap: number,
    leadSpeed: number,
    originX: number,
    originZ: number,
  ): void {
    const lane = config.laneOffset;
    // The distance at which this pass would be STARTED. The return test is measured
    // against it, because a return that can be immediately re-triggered is not a
    // return: measured with traffic on the circuit, checking only 24 m of lane while
    // the car being passed was 70 m ahead left the controller flapping across the
    // centreline every few metres and the commanded line stuck halfway.
    const triggerGap = Math.max(PASS_TRIGGER_MIN_M, speed * PASS_TRIGGER_SECONDS);
    if (this.passLine !== null) {
      const abortGap = Math.max(PASS_ABORT_MIN_M, speed * PASS_ABORT_SECONDS);
      // Anything appearing in the lane BEING USED that is not moving with us is
      // oncoming or parked; either way the pass is over and the car belongs back on
      // its own side, where ordinary following will brake for whatever is left.
      if (gap < abortGap && leadSpeed < PARKED_SPEED_MPS) {
        this.passLine = null;
        return;
      }
      if (this.travelled - this.passStartedAt > PASS_MAX_METRES) {
        this.passLine = null;
        return;
      }
      // A lane change costs about 32 m of road; returning before that means the car
      // never actually got to the line it committed to.
      if (this.travelled - this.passStartedAt < PASS_MIN_METRES) return;
      const returnSight = Math.max(PASS_RETURN_GAP_M, triggerGap + PASS_CLEAR_M);
      if (this.laneProbe(vehicle, lane, returnSight, originX, originZ) >= returnSight) {
        this.passLine = null;
      }
      return;
    }

    if (gap === Infinity) return;
    const blocking = config.overtakes
      ? leadSpeed < config.cruiseMps - PASS_SPEED_MARGIN_MPS
      : this.leadIsParked;
    if (!blocking) return;
    // OVERTAKING NEEDS SPEED; GETTING ROUND A PARKED CAR DOES NOT.
    //
    // Sitting alongside slower traffic at walking pace is not a pass, so a moving
    // obstacle has a speed floor. Something parked is different, and the floor used
    // to apply to it too: the follow brake wins the race against the planner — by
    // the time the obstacle is confirmed stationary the car is already down to
    // walking pace — so a car parked on a dead straight got a reverse manoeuvre
    // instead of the lane change any driver would make. Seen in the playground with
    // the traffic parked, and now the commanded line may slew at rest, which is what
    // makes a pass from a standstill physical rather than a wish.
    if (!this.leadIsParked && speed < PASS_MIN_SPEED_MPS) return;
    if (gap > triggerGap) return;
    // HOW MUCH ROAD A PASS ACTUALLY NEEDS.
    //
    // Getting round something PARKED costs the gap, the length of the thing and a
    // couple of seconds: it is not going anywhere, and the manoeuvre can be abandoned
    // at any point.
    //
    // Overtaking something MOVING costs the time to close the gap at the difference
    // in speeds, and during that time an oncoming car covers its own road. Counting
    // only our own travel is how frantic committed to a 121 m window behind a car it
    // was overhauling at 10 km/h — a 24 second pass — and got hit head-on at 8 km/h
    // three seconds later, having quite correctly stood on the brakes in the wrong
    // lane. So the requirement is the CLOSING one, and a pass that would take longer
    // than `PASS_MAX_SECONDS` is simply not available: overhauling a car ten km/h
    // slower than you is not an overtake, it is a kilometre of hoping.
    let need: number;
    if (this.leadIsParked) {
      need = gap + PASS_CLEAR_M + speed * PASS_SIGHT_SECONDS;
    } else {
      const advantage = speed - leadSpeed;
      if (advantage < PASS_ADVANTAGE_MPS) return;
      const seconds = (gap + PASS_CLEAR_M) / advantage;
      if (seconds > PASS_MAX_SECONDS) return;
      need = (speed + PASS_ONCOMING_MPS) * Math.min(seconds, PASS_SIGHT_CAP_S);
    }
    // Two conditions, and they are different questions. `passCurvature` is policy:
    // this mode does not overtake in a bend that tight. The reach is capability: the
    // segmented probe can only answer over `PROBE_MAX_SEGMENTS` chords of the local
    // radius, and committing to sight the probe cannot deliver is how a pass becomes
    // a head-on.
    if (!this.straightAhead(this.hintS, need, config.passCurvature)) return;
    if (need > this.probeReach(this.hintS + PROBE_START_M)) return;
    // THE SHOULDER IS FOR THINGS THAT ARE NOT GOING ANYWHERE.
    //
    // Squeezing past a parked car or a boulder with a wheel on the verge is what the
    // verge allowance is for, and the careful mode tries it FIRST because it keeps
    // the car on its own side of the road. Using the same shoulder to overtake
    // MOVING traffic is not driving, it is undertaking on the sand at 70 km/h — which
    // is what both modes did on the traffic lap until the candidate list depended on
    // whether the obstacle is parked rather than only on the mode.
    const verge = Math.sign(config.laneOffset || -1) * EDGE_LINE_M;
    const oncoming = -Math.sign(config.laneOffset || -1) * (ROAD_HALF_WIDTH / 2);
    const candidates = !this.leadIsParked
      ? [oncoming]
      : config.overtakes
        ? [oncoming, verge]
        : [verge, oncoming];
    for (const candidate of candidates) {
      if (Math.abs(candidate - lateral) < CAR_HALF_WIDTH_M) continue;
      if (this.laneProbe(vehicle, candidate, need, originX, originZ) < need) continue;
      this.passLine = candidate;
      this.passStartedAt = this.travelled;
      return;
    }
  }

  /** True while every sampled curvature over `distance` stays under `limit`. */
  private straightAhead(fromS: number, distance: number, limit: number): boolean {
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      if (Math.abs(this.road.curvatureAt(fromS + (distance * i) / steps)) > limit) return false;
    }
    return true;
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
    this.leadParkedFor =
      this.obstacleSpeedValue < PARKED_SPEED_MPS ? this.leadParkedFor + dt : 0;
  }

  /** True only once the thing in front has been slow for long enough to believe. */
  private get leadIsParked(): boolean {
    return this.leadParkedFor >= PARKED_CONFIRM_S;
  }

  /**
   * Chooses an escape side and enters the reverse (or pull-out) phase — unless both
   * sides have already been tried here, in which case the road really is blocked and
   * waiting is the correct manoeuvre.
   */
  private beginRecovery(
    vehicle: Vehicle,
    config: ModeConfig,
    lateral: number,
    originX: number,
    originZ: number,
  ): void {
    // "Same place" is both a distance and a WAIT. Distance alone made the give-up
    // permanent: re-arming needed 45 m of road, and a car wedged against something is
    // precisely a car that will never cover 45 m, so a driver who had tried both
    // sides once sat there for the rest of the session. The world moves — traffic
    // clears, a prop is destroyed, the ground settles — so after `RECOVERY_REARM_S`
    // of getting nowhere it is worth trying again.
    const samePlace =
      this.travelled - this.lastRecoveryAt < RECOVERY_RETRY_METRES &&
      this.sinceRecovery < RECOVERY_REARM_S;
    if (samePlace && this.recoveryAttempts >= RECOVERY_ATTEMPT_LIMIT) {
      this.stoppedFor = 0;
      return;
    }
    // A second stall in the same place means the side chosen last time did not work.
    this.recoverySide = samePlace
      ? -this.recoverySide
      : Math.abs(lateral) > CAR_HALF_WIDTH_M
        ? -Math.sign(lateral)
        : -Math.sign(config.laneOffset || -1);
    this.recoveryAttempts = samePlace ? this.recoveryAttempts + 1 : 1;
    this.lastRecoveryAt = this.travelled;
    this.sinceRecovery = 0;
    this.stoppedFor = 0;
    this.plannedHazard = null;
    this.plannedLateral = 0;
    this.passLine = null;
    // Reversing into the car behind is worse than the obstacle in front, so a blocked
    // tail skips straight to the pull-out and steers out of the problem instead.
    const rearClear =
      this.axisScan(vehicle, originX, originZ, -1, RECOVERY_REAR_CLEAR_M + 2) >
      RECOVERY_REAR_CLEAR_M;
    this.recoveryPhase = rearClear ? 'reverse' : 'pullout';
    this.recoveryTimer = rearClear ? RECOVERY_REVERSE_S : RECOVERY_PULLOUT_S;
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
      if (this.recoveryTimer <= 0 || Math.abs(lateral) > EDGE_LINE_M + CAR_HALF_WIDTH_M) {
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
    const arrived =
      this.recoveryTimer <= 0 ||
      gap < MUST_STOP_GAP_M ||
      Math.abs(lateral) > OFFROAD_RECOVERY_EDGE;
    if (arrived) {
      this.recoveryPhase = 'none';
      this.recoveryTimer = 0;
      this.stoppedFor = 0;
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
  ): number {
    if (!this.physics) return Infinity;
    const body = vehicle.chassis;
    const fromS = this.hintS + PROBE_START_M;
    const curvature = Math.max(Math.abs(this.road.curvatureAt(fromS)), 1e-4);
    const maxChord = Math.sqrt((8 * PROBE_CHORD_DEVIATION_M) / curvature);
    const segments = Math.min(PROBE_MAX_SEGMENTS, Math.max(1, Math.ceil(sight / maxChord)));
    const segment = sight / segments;
    let nearest = Infinity;
    for (let side = -1; side <= 1; side += 2) {
      const offset = lane + side * PROBE_HALF_WIDTH_M;
      for (let step = 0; step < segments; step++) {
        const start = fromS + step * segment;
        this.road.offsetPoint(start, offset, this.probeNear);
        this.road.offsetPoint(start + segment, offset, this.probeFar);
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
function steeringInputForWheelAngle(
  wheelAngle: number,
  modelSteerLock: number,
  speedMps: number,
): number {
  const magnitude = Math.abs(wheelAngle);
  // Commands under a fraction of the play are dropped, so a settled car is not
  // sawing at the wheel. It has to stay WELL under the play itself: the fraction was
  // 0.55, which discarded every correction worth less than a 180 m radius and is why
  // a straight was held a metre and a half off line.
  if (magnitude <= STEER_PLAY_RAD * 0.12) return 0;
  const speedKmh = speedMps * 3.6;
  const speedT = clamp(
    (speedKmh - STEER_FULL_LOCK_KMH) / (STEER_REDUCED_KMH - STEER_FULL_LOCK_KMH),
    0,
    1,
  );
  const lockFactor = 1 - (1 - STEER_HIGH_SPEED_FRACTION) * Math.pow(speedT, STEER_LOCK_CURVE);
  const effectiveLock = Math.max(modelSteerLock * lockFactor, 0.1);
  const targetAngle = Math.min(magnitude + STEER_PLAY_RAD, effectiveLock);
  const normalized = Math.pow(targetAngle / effectiveLock, 1 / STEER_INPUT_EXPONENT);
  // Vehicle negates normalized input when converting it to a wheel angle.
  return clamp(-Math.sign(wheelAngle) * normalized, -1, 1);
}
