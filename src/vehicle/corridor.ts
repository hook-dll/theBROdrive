/**
 * WHERE TO PUT THE CAR SIDEWAYS, decided once per step by geometry and cost.
 *
 * This replaces a lattice of mutually exclusive lateral modes — a committed
 * detour line, a committed passing line, a stopped-blocker bypass, a recovery
 * bias — each with its own latch and its own place in a priority ladder. That
 * shape produced a family of faults that could not be fixed one at a time,
 * because every one of them was a disagreement between two owners of the same
 * number:
 *
 *  - the detour outranked the pass, so a car out in the opposing lane was
 *    commanded onto the right-hand shoulder — across the prop it was avoiding;
 *  - a line was chosen without asking what lay on the way to it, so cars drove
 *    into pylons and rocks they had correctly identified;
 *  - the speed plan braked for "the nearest thing in any lane", so an overtaking
 *    car queued behind the car it was overtaking;
 *  - and every deadlock needed its own predicate, because "stuck" was defined
 *    per mode rather than per situation.
 *
 * Here there is one question — which lateral line is reachable, clear enough and
 * cheapest — and the behaviours fall out of the answer. Holding a lane, easing
 * round a stone, going by a stopped wreck on the right and overtaking on the
 * opposing lane are all the same decision with different obstacles in it.
 *
 * out. No physics, no rays, no clock. That is what makes the interesting cases
 * (rock in the lane with oncoming traffic at 120 m; the same rock with the road
 * clear for a kilometre) table-testable in milliseconds instead of reachable
 * only by driving twenty cars around for ten minutes and hoping.
 */

import { trafficProfile } from '../core/trafficprofile';

/**
 * One thing to stay clear of, in this driver's own road frame: `s` ahead of the
 * car, `lateral` in road coordinates, `halfWidth` already inflated by whatever
 * margin the caller wants.
 *
 * `speed` is along OUR direction of travel — zero for a prop or a parked car,
 * positive for traffic going our way, negative for something coming at us.
 */
export interface CorridorObstacle {
  readonly s: number;
  readonly lateral: number;
  readonly halfWidth: number;
  readonly speed: number;
  /**
   * Something LEVEL WITH THE BODY rather than ahead of it: a car in the next lane,
   * seen by proximity rather than by a forward ray. It is not an obstruction — it
   * blocks no line the driver is already on — it is a direction the driver may not
   * move in, so it is priced nowhere and only ever vetoes steering toward it.
   */
  readonly abeam?: boolean;
  /**
   * And of those, the ones whose BODIES actually overlap ours along the road.
   *
   * The abeam window is deliberately generous — it reaches a car length or two
   * either way — because "do not steer toward it" is the right answer for a car in
   * the next lane a few metres ahead as well as for one at the door. "Do not steer
   * THROUGH it" is not: a car nine metres up the road is somewhere this driver can
   * legitimately be by the time the line gets there, and refusing every line past it
   * closes the shoulder at exactly the moment a queue needs it. Measured on the real
   * road with the wider test: the longest standstill went from 18 to 55 seconds and
   * the crawl from 5% to 22%.
   */
  readonly level?: boolean;
  /**
   * ONLY MEANINGFUL TOGETHER WITH `abeam`: this body's own reference point is behind
   * this driver's, rather than ahead of it or level with it.
   *
   * The abeam veto exists so a driver never steers INTO the lateral space a nearby
   * body occupies — and while that body is still ahead, or genuinely alongside, that
   * protection has to hold whatever its speed is doing, because it can still be
   * there when the lateral move finishes. Once it is unambiguously BEHIND, the same
   * question has a different physical answer: a body a driver has already drawn
   * ahead of cannot be driven into by moving sideways, only followed into, and a
   * driver finishing a pass moves into exactly the lane a slower body is vacating.
   * Conflating the two directions is why a return that had cleanly cleared its
   * leader kept refusing its own lane for several more car-lengths — measured in
   * play as passes that took an extra `ABEAM_BEHIND_M` or more of road, straddling
   * the crown, after the leader was already receding and no longer any kind of
   * hazard. See its one use, gated on the leader still being the slower car, in
   * `solveCorridor`.
   */
  readonly trailing?: boolean;
}

export interface CorridorRequest {
  /** Where the body is now, and the line commanded last step. */
  readonly ownLateral: number;
  readonly previousLine: number;
  /** The lane this driver holds when nothing else matters. */
  readonly laneOffset: number;
  readonly speed: number;
  /** Exact driveable lane centres on this driver's side, including `laneOffset`. */
  readonly laneCentres?: readonly number[];
  /**
   * Signed lateral of the crown separating this direction from oncoming traffic.
   * It is geometry supplied by the road view, not an inference from a line's sign.
   */
  readonly oncomingBoundary?: number;
  /** Speed the driver would hold on a clear road. */
  readonly desiredSpeed: number;
  readonly halfWidth: number;
  /** How far ahead obstacles were collected. Costs fade to zero at this range. */
  readonly horizon: number;
  /**
   * Lateral acceleration, m/s², the commanded line may be moved with.
   *
   * NOT a rate. A rate is a slope, and a slope of 0.09 m per metre is 0.7 m/s of
   * lateral speed at 30 km/h and 2.7 m/s at 108 — the same manoeuvre asking for
   * fourteen times the lateral acceleration at road speed. The move is a pair of
   * constant-acceleration arcs, so the road it consumes is `speed · 2·sqrt(shift/a)`,
   * which is what the swept test below needs and is the same budget the speed plan
   * prices the manoeuvre with.
   */
  readonly lineAccel: number;
  /**
   * The same, for a move that starts or ends with the body over the paint: the verge's
   * own grip, which is about half the asphalt's (`VERGE_CROSS_FALL` in the
   * autopilot). A line onto the shoulder sized on the asphalt's rate was a line the
   * tyres could not stop at. Defaults to `lineAccel`.
   */
  readonly vergeLineAccel?: number;
  /** Outermost line that keeps the body on asphalt, and on the graded verge. */
  readonly asphaltLimit: number;
  readonly edgeLimit: number;
  /**
   * HOW FAR FROM ITS OWN LANE THIS DRIVER IS ENTITLED TO GO THIS STEP, metres.
   *
   * Defaults to the whole road, and that default was the hole. `laneCentres` decides
   * which lane CENTRES are priced exactly and which lanes are probed for traffic, and
   * it was doing duty as "may this driver change lane at all" — but the search also
   * walks every quarter metre between the verges, so the next lane was a candidate for
   * every driver on every tick whatever its character. `SLOW_COST_PER_MPS` is 6 per
   * m/s and a lane is worth 2.9 in lane cost, so any car a metre per second slower
   * than this driver's pace bought a lane change outright.
   *
   * Reported from play on a four-lane stretch, and it is two halves of one defect: a
   * car in the inner lane undertaking on the right, and the car it had just passed
   * pulling out into the lane it was vacating. Nobody had asked for either manoeuvre.
   *
   * The caller grants the whole road for what genuinely needs it — a driver entitled
   * to pass, one whose own lane is blocked by something stopped, one already
   * mid-manoeuvre, one with no admissible corridor — and otherwise grants its own lane
   * and wherever the body already is, so a car away from its lane can always hold
   * position or come home, and never go further out.
   */
  readonly lateralFreedom?: number;
  /** Hard permission to occupy a line across the crown, independent of its price. */
  readonly mayCrossCrown: boolean;
  /**
   * How far past the asphalt the body's edge may go on THIS driver's side to pass a
   * MOVING car on the right, metres; 0 (the default) is no such pass. The caller grants
   * it only where the verge is fit for it, and only as far as the road's guaranteed
   * shoulder reaches — see `SHOULDER_PASS_GAP_M` in the autopilot and
   * `roadprofile.SHOULDER_WIDTH_M`.
   */
  readonly shoulderPassOverhang?: number;
  /**
   * The granted verge pass is the soonest way past — sooner than the crossing the
   * caller sized on the same car, or there is none. Priced at
   * `SHOULDER_PASS_SOONER_COST_PER_M`, so it beats an open crossing; otherwise at
   * `SHOULDER_PASS_COST_PER_M`, so an open crossing that is sooner still wins and the
   * verge is the way past only while the crossing is refused.
   */
  readonly shoulderPassSooner?: boolean;
  /**
   * May the body reach over the crown on this line without crossing it? A line up to
   * half a body past the centre is not a crossing (`crossesCentre`), so the oncoming
   * gate never prices it — and on it, a car coming the other way in its own lane is
   * met door to door. The caller answers from where the oncoming traffic really is;
   * absent, every such line is allowed, as it always was.
   */
  readonly straddleAllowed?: (line: number) => boolean;
  /** Hard permission for the entire transition to a line, not only its destination. */
  readonly lineAllowed?: (line: number) => boolean;
  /**
   * What this driver thinks of the opposing lane, in cost. Low is bold: it is the
   * single knob that used to be a page of passing thresholds.
   */
  readonly oncomingLaneCost: number;
  /** Measured clear road in the opposing lane, metres, or Infinity. */
  readonly oncomingGap: number;
  /** Assumed speed of an unseen car coming the other way. */
  readonly oncomingSpeed: number;
  /** Slowest speed at which a pending lateral move may be driven; see the standing-car pair below. */
  readonly manoeuvreFloorSpeed: number;
  /**
   * THE LINE THE CAR STEERS TO IS RATE-LIMITED AS WELL AS ACCELERATION-LIMITED, and the
   * cap is what decides a move made at walking pace: `perMetre` metres of line per metre
   * travelled, never slower than `atRest` m/s (the autopilot's `LINE_SHIFT_PER_METRE` and
   * `LINE_SLEW_AT_REST_MPS`). Without it a 2.5 m move at 2.5 m/s round a car standing in
   * the lane was planned as 2 s and five metres of road against the steering's real 5 s
   * and twelve: measured on tools/traffic-blocker.ts as every driver behind a stopped
   * player rolling up to his bumper with its body still in the lane, stopped by the nose
   * scan, reversing and trying again. It prices the move's SPEED round a standing car
   * (`manoeuvreSpeed`), not whether a line is reachable: see the swept test. Absent, the
   * move is the two arcs alone.
   */
  readonly lineRate?: { readonly perMetre: number; readonly atRest: number };
  /**
   * Round a CAR standing in the lane (not moving), the move has to be finished
   * this far short of it, and the approach is floored at `stillManoeuvreFloorSpeed`
   * rather than `manoeuvreFloorSpeed`: a fixed 3.5 m/s floor was a promise to arrive at
   * its bumper before the line could get out of its way. Default 0 and
   * `manoeuvreFloorSpeed`.
   */
  readonly stillManoeuvreStandoff?: number;
  readonly stillManoeuvreFloorSpeed?: number;
  /**
   * A CAR STANDING IN THIS DRIVER'S LANE IS GONE ROUND ON ITS OWN SHOULDER, never across
   * the crown: `line` just clears its flank (the body on the graded strip, no further),
   * and `open` once the driver is near enough to start the move. Lines past the asphalt
   * on this side further out than `line` — and, until it opens, further out than the
   * body already is — are inadmissible; the shoulder up to it is priced as a granted
   * verge (`SHOULDER_PASS_SOONER_COST_PER_M`). A car across the road is gone round by
   * each stream on its own side. Set by the autopilot (`planStandingBypass`).
   */
  readonly standingBypass?: { readonly line: number; readonly open: boolean };
  /**
   * Speed the driver will really make while it is out in the opposing lane with a
   * CLEAR line — its cruise plus whatever kickdown it spends on a pass.
   *
   * Separate from `desiredSpeed`, which is what the driver wants on an empty road and
   * therefore what decides which obstacles are in the way at all and what a slow one
   * costs. Feeding a pass allowance into THAT number moved the whole cost search: more
   * things counted as hard blocks, more drivers went round their own leaders onto the
   * shoulder, and the road jammed — measured on the real road at seed 1337, 64% of
   * car-time under 8 km/h against 23%, with 29% of it spent in recovery. The
   * allowance belongs to the sums below and to nothing else.
   */
  readonly crossingSpeed: number;
  /**
   * THE PASS AS THIS DRIVER'S OWN CAR WILL DRIVE IT, when the caller has measured it:
   * seconds until the body is back in its own lane in a slot it fits, and the road the
   * body covers meanwhile. Infinity when no slot is reachable at all.
   *
   * `crossingSpeed` is a wish, and the closing-speed sum below prices a pass on it as if
   * the car could have it at once. For the racer that wish was 276 km/h: a pass begun at
   * 64 km/h behind a car doing 58 was priced at under a second and took eleven, and the
   * car it had measured 107 m of room against arrived in the middle of it. Measured on
   * the real road at seed 545124 as a head-on at 7 km/h after braking to a stop beside
   * the car being passed. Undefined keeps the old sum for the drivers that use it.
   */
  readonly passSeconds?: number;
  readonly passTravel?: number;
  /**
   * Seconds of closing speed kept between the end of a measured pass and the car coming
   * the other way. Replaces `PASS_ENTRY_MARGIN` for a measured pass: a margin on a number
   * that is right is a nerve, not an error bar.
   */
  readonly passMarginS?: number;
  /**
   * Is the opposing lane clear BEHIND us? Pulling out in front of something already
   * overtaking is a rear-end, and the corridor search has no rearward obstacles.
   */
  readonly crossingRearClear: boolean;
  readonly obstacles: readonly CorridorObstacle[];
}

export interface CorridorPlan {
  /** Lateral line to command. */
  readonly line: number;
  /** The chosen line passed every hard permission and geometry gate. */
  readonly admissible: boolean;
  /**
   * No corridor was found, and the reason is a car coming the other way rather than
   * anything this driver can do about it. A driver in this state is yielding, not
   * stuck: it stops short of the obstruction and waits for the road.
   */
  readonly waitingForOncoming: boolean;
  /**
   * A FRESH line across the crown was refused by the give-way gate this step because
   * the room did not clear `PASS_ENTRY_MARGIN`. Never set for a crossing already in
   * progress — see the gate's own comment for why re-litigating it there produced a
   * dead stop astride the centre line instead of an aborted pass.
   */
  readonly crossingRefused: boolean;
  /**
   * The chosen line is across the crown for a MEASURED pass that no longer fits: the
   * car coming the other way will arrive before this one can be back in its lane.
   * The line is still admissible — the body is out there and has to be allowed to stay
   * while it gets back — but it is priced as a wall, so any line home wins the moment it
   * exists, and the caller drops back behind the car it was passing to make one.
   */
  readonly crossingAbandoned: boolean;
  /** Nearest thing in the chosen corridor and how fast it is going, or Infinity. */
  readonly blockDistance: number;
  readonly blockSpeed: number;
  /** Speed allowed by this line's pending lateral move; Infinity means no deadline. */
  readonly manoeuvreSpeed: number;
  /** True while the chosen line is on the wrong side of the centre for this driver. */
  readonly usesOncomingLane: boolean;
  /** True while the chosen line puts the body past the asphalt. */
  readonly usesShoulder: boolean;
  /**
   * Nearest thing in the driver's OWN lane and its speed, whatever line was
   * chosen. While the body is still in that lane — and a lane change costs about
   * thirty metres of road — this is what it must keep a headway behind, or it
   * accelerates into the bumper of the car it is committed to overtaking.
   */
  readonly laneBlockDistance: number;
  readonly laneBlockSpeed: number;
}

/** Lateral resolution of the search. A quarter of a metre is a tenth of a car. */
const LINE_STEP_M = 0.25;
/**
 * Shifts of at most 40 cm need no separate manoeuvre deadline. This is the existing
 * controller's half-detour threshold; ordinary corridor braking still owns its blocks.
 */
const MANOEUVRE_SHIFT_MIN_M = 0.4;
/** Cost per metre of deviation from the driver's own lane. */
const LANE_COST_PER_M = 1;
/**
 * Cost per metre of body past the asphalt edge. Deliberately steep: two metres of
 * sand priced below the road was a car that went into the sand, bogged there, and
 * never got past.
 */
const SHOULDER_COST_PER_M = 26;
/** A line priced as a wall: an abandoned crossing, taken only while nothing else is. */
const BLOCK_COST = 600;
/** Cost per m/s of speed a slower car in the corridor would cost us. */
const SLOW_COST_PER_MPS = 6;
/** Paid once for changing the commanded line at all: the hysteresis. */
const SWITCH_COST = 3;
/** Room wanted beyond an obstacle before the corridor counts as past it. */
const CLEAR_M = 30;
/**
 * The same, for something STOPPED, and it is a third of the figure for a moving car
 * on purpose: overtaking traffic needs room to pull back in front of the car it has
 * passed, a stopped car needs its own length and this car's and nothing else.
 */
const STILL_CLEAR_M = 10;
/** Slowest closing speed an overtake is planned at, so the sums stay finite. */
const MIN_ADVANTAGE_MPS = 0.5;
/**
 * A FRESH DECISION TO CROSS ASKS FOR MORE ROOM THAN FINISHING ONE ALREADY UNDER WAY.
 *
 * `roomNeeded` below is the bare kinematic minimum: the gap that makes the sums come
 * out exactly even, with no slack for a leader that eases off or an oncoming car
 * doing a little more than assumed. A driver who has not committed can simply wait
 * for a fatter window — that costs a few seconds of following and nothing else — so
 * the decision to GO is priced at a margin over the minimum. A driver already across
 * cannot buy the same safety by waiting; see the gate below for what it does instead.
 */
const PASS_ENTRY_MARGIN = 1.3;
/**
 * THE SHOULDER IS FOR GETTING ROUND SOMETHING THAT IS NOT GOING ANYWHERE.
 *
 * Without this the planner will happily undertake a car doing 50 km/h by putting
 * two wheels on the sand, because the sand is cheaper than losing the pace. A
 * stalled or overturned car, or the head of a stopped queue, is a different matter,
 * and this is the line between them.
 */
const SHOULDER_BYPASS_MAX_SPEED = 2;
/**
 * Cost per metre of body past the asphalt on a GRANTED pass on the right
 * (`shoulderPassOverhang`), in place of `SHOULDER_COST_PER_M`. The full verge price is
 * a bogging deterrent; a granted verge is paved-road-side and short. At the full
 * overhang this is dearer than a frantic crossing (16 x 0.66 plus a lane), so an open
 * opposing lane that gets past sooner still wins. When the verge is the sooner way
 * (`shoulderPassSooner`) it is priced at `SOONER`, a quarter of that, under the
 * crossing at any overhang the road's strip allows.
 */
const SHOULDER_PASS_COST_PER_M = 8;
const SHOULDER_PASS_SOONER_COST_PER_M = 2;
/**
 * The escape hatch in `sweptOverlap`, and both halves of it are deliberately tiny:
 * walking pace with the thing already at the bumper is the only arrangement where
 * stopping has nothing left to offer.
 */
const STANDING_SPEED_MPS = 1.5;
const STANDING_REACH_M = 2;
/** Fixed-point steps solving the move's speed against its own speed-dependent duration. */
const MANOEUVRE_SPEED_ITERATIONS = 4;

/**
 * Seconds the commanded line takes to move `shift` metres: two constant-acceleration
 * arcs at `accel`, unless that would need the line to move faster than its rate cap at
 * this speed, in which case it accelerates to the cap, holds it and brakes from it.
 */
function lineMoveSeconds(
  shift: number,
  accel: number,
  speed: number,
  lineRate: CorridorRequest['lineRate'],
): number {
  const arcs = 2 * Math.sqrt(shift / accel);
  if (!lineRate) return arcs;
  const rate = Math.max(lineRate.perMetre * speed, lineRate.atRest);
  if (shift <= (rate * rate) / accel) return arcs;
  return shift / rate + rate / accel;
}

function overlaps(
  obstacle: CorridorObstacle,
  centre: number,
  halfWidth: number,
): boolean {
  return Math.abs(obstacle.lateral - centre) < obstacle.halfWidth + halfWidth;
}

/**
 * Does the swept path from `from` to `to` touch this obstacle?
 *
 * The line moves at a bounded rate, so reaching a line costs road: until that
 * distance is covered the car occupies EVERY lateral between the two. Asking
 * only about the destination is what let a planner commit to a line whose path
 * went straight through the thing it was avoiding.
 *
 * BUT THE ROAD THAT MATTERS IS CLOSING DISTANCE, NOT OUR OWN TRAVEL. A lane
 * change costs tens of metres of travel, and measured against a car 30 m ahead that
 * looked like a certain collision — so a driver tucked in behind a slower car
 * could never choose the other lane, sat on its tail and followed it forever,
 * which is exactly what it did. The car ahead is MOVING: by the time the line has
 * crossed, it has gone its own way, and only the difference in speeds is spent.
 * At 20 m/s behind a car doing 16, four fifths of that travel is not closure.
 */
function sweptOverlap(
  obstacle: CorridorObstacle,
  from: number,
  to: number,
  halfWidth: number,
  transitionDistance: number,
  speed: number,
): boolean {
  // A STOPPED CAR CANNOT SWEEP INTO ANYTHING, and judging it as if it could is a trap
  // it never gets out of. The swept band runs from where the body IS, so a still car
  // that already overlaps this lateral — one this car has crept up to and stopped
  // behind — poisons every candidate line, including the ones that would clear it.
  //
  // Below walking pace, against something that is not moving either, only the
  // destination matters: the wheels are turned before the car rolls, and there is no
  // closing speed left to run out of. A body at the bumper still cuts the pedal
  // (`bodyScanGap` in the autopilot).
  if (
    speed <= STANDING_SPEED_MPS &&
    obstacle.speed <= SHOULDER_BYPASS_MAX_SPEED &&
    obstacle.s <= STANDING_REACH_M &&
    overlaps(obstacle, from, halfWidth)
  ) {
    return overlaps(obstacle, to, halfWidth);
  }
  const closingShare =
    speed > 0.1 ? Math.min(1, Math.max(0, (speed - obstacle.speed) / speed)) : 1;
  if (obstacle.s <= transitionDistance * closingShare) {
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    return obstacle.lateral + obstacle.halfWidth > low - halfWidth &&
      obstacle.lateral - obstacle.halfWidth < high + halfWidth;
  }
  return overlaps(obstacle, to, halfWidth);
}

/**
 * Cheapest reachable corridor.
 *
 * Candidates are every quarter metre the body may legally occupy, plus the
 * driver's own lane exactly. Each is priced on what it costs to be there and on
 * what is in it; the cheapest wins. A pass is simply a candidate on the far side
 * whose corridor is clear and whose price is beaten by the speed it buys.
 */
export function planCorridor(request: CorridorRequest): CorridorPlan {
  return solveCorridor(request);
}

/** Evaluate an executable or held line with exactly the search's geometry and gates. */
export function evaluateCorridorLine(request: CorridorRequest, line: number): CorridorPlan {
  return solveCorridor(request, line);
}

function solveCorridor(request: CorridorRequest, fixedLine?: number): CorridorPlan {
  const {
    ownLateral,
    previousLine,
    laneOffset,
    speed,
    desiredSpeed,
    halfWidth,
    horizon,
    lineAccel: roadLineAccel,
    vergeLineAccel = roadLineAccel,
    asphaltLimit,
    edgeLimit,
    oncomingLaneCost,
    oncomingGap,
    oncomingSpeed,
    manoeuvreFloorSpeed,
    lineRate,
    stillManoeuvreStandoff = 0,
    stillManoeuvreFloorSpeed = manoeuvreFloorSpeed,
    standingBypass,
    crossingSpeed,
    laneCentres = [laneOffset],
    lateralFreedom = Number.POSITIVE_INFINITY,
    oncomingBoundary = 0,
    crossingRearClear,
    obstacles,
    mayCrossCrown,
    shoulderPassOverhang = 0,
    shoulderPassSooner = false,
    straddleAllowed,
    lineAllowed,
    passSeconds,
    passTravel = 0,
    passMarginS = 0,
  } = request;
  const passMeasured = passSeconds !== undefined;
  const profiling = trafficProfile.enabled;
  if (profiling) trafficProfile.corridorSolves++;
  let bestLine = laneOffset;
  let bestCost = Number.POSITIVE_INFINITY;
  let bestBlockDistance = Number.POSITIVE_INFINITY;
  let bestBlockSpeed = 0;
  let bestManoeuvreSpeed = Number.POSITIVE_INFINITY;
  const manoeuvreCeilingSpeed = Math.max(desiredSpeed, crossingSpeed);
  const ownSide = Math.sign(laneOffset - oncomingBoundary || -1);
  /**
   * Is the body ALREADY on the other side of the crown? Two rules below are about
   * entering the opposing lane and must not be re-asked of a car that is out there:
   * see the rear-clearance gate.
   */
  const alreadyAcross = (ownLateral - oncomingBoundary) * ownSide < -halfWidth * 0.5;
  let bestAbandoned = false;
  let bestAdmissible = false;
  // What blocks the driver's OWN lane, once, for every candidate to reason about:
  // it is the thing a detour or an overtake exists to get past, and whether it is
  // moving decides which of the two is even allowed.
  let laneBlockDistance = Number.POSITIVE_INFINITY;
  let laneBlockSpeed = 0;
  // The slowest own-lane body is not necessarily the nearest one.
  let leaderSpeed = crossingSpeed;
  for (const obstacle of obstacles) {
    if (obstacle.abeam || obstacle.s < 0 || obstacle.s > horizon) continue;
    if (!overlaps(obstacle, laneOffset, halfWidth)) continue;
    leaderSpeed = Math.min(leaderSpeed, obstacle.speed);
    if (obstacle.s >= laneBlockDistance) continue;
    laneBlockDistance = obstacle.s;
    laneBlockSpeed = obstacle.speed;
  }
  const laneBlockIsStill = laneBlockSpeed <= SHOULDER_BYPASS_MAX_SPEED;
  /**
   * A line across the crown that this driver would otherwise have taken, refused only
   * because of traffic coming the other way. See the note at the gate.
   */
  let waitingForOncoming = false;
  /**
   * A crossing candidate was REFUSED by the gate this step — as opposed to merely
   * losing on price. A manoeuvre already under way out there is abandoned on this and
   * on nothing else: the planner re-prices every step, and a line that is a penny
   * dearer for one step is not a reason to come back across the road.
   */
  let crossingRefused = false;

  const evaluate = (line: number, captureRejected = false): void => {
    if (profiling) {
      trafficProfile.corridorCandidates++;
      trafficProfile.corridorObstacleTests += obstacles.length;
    }
    const crossesCentre =
      (line - oncomingBoundary) * ownSide < -halfWidth * 0.5;
    // THE PERMISSION TO CROSS IS AN ENTRY RULE TOO. A body already out there is always
    // allowed to stay across while it gets back: withdrawn from under it — by the retry
    // bar an abort itself sets, or by a crest that has just come into view — nothing
    // is admissible, and the answer to that is a full stop in the oncoming lane beside
    // the car being passed. Measured on the real road at seed 545124, from 71 km/h to
    // standstill with the car coming the other way 54 m off, and hit by it.
    //
    // Withdrawn permission still means "go home", so such a line is ABANDONED: priced
    // as a wall below, taken only while nothing on this side is admissible yet.
    let admissible =
      Math.abs(line) <= edgeLimit &&
      Math.abs(line - laneOffset) <= lateralFreedom &&
      (!crossesCentre || mayCrossCrown || alreadyAcross) &&
      (lineAllowed?.(line) ?? true);
    let abandoned = crossesCentre && !mayCrossCrown;
    // OVER THE CROWN WITHOUT CROSSING IT: only where nothing is coming. A body already
    // out there is not refused the line it is on — it is sent home, like a crossing
    // whose permission has gone.
    if (
      admissible &&
      !crossesCentre &&
      straddleAllowed &&
      (line - oncomingBoundary) * ownSide > -halfWidth &&
      !straddleAllowed(line)
    ) {
      if ((ownLateral - oncomingBoundary) * ownSide > -halfWidth) abandoned = true;
      else admissible = false;
    }
    if (!admissible && !captureRejected) return;
    const shift = Math.abs(line - ownLateral);
    // A move that starts or ends with the body over the paint is driven on the
    // verge's grip; see `vergeLineAccel`.
    const lineAccel =
      Math.max(Math.abs(line), Math.abs(ownLateral)) + halfWidth > asphaltLimit
        ? Math.min(roadLineAccel, vergeLineAccel)
        : roadLineAccel;
    // Road covered while the line is being moved there, from the manoeuvre's own arc.
    // A car that is barely moving covers almost none of it, which is what the old
    // slope needed a standstill special case for.
    //
    // THE ARCS ALONE, NOT THE LINE'S RATE CAP (`lineRate`), and on purpose: this asks
    // whether the line is reachable at all, and round something still it is, because
    // `manoeuvreSpeed` below slows the car until the capped move fits. Priced on the cap
    // at the present speed, a car rolling up to a stopped one found every way round too
    // late, held its lane and chose a line only once standing at the bumper — measured
    // on tools/traffic-blocker.ts as the very stall the cap was brought in to end.
    const transitionDistance =
      speed * 2 * Math.sqrt(shift / Math.max(lineAccel, 1e-3));
    let blockDistance = Number.POSITIVE_INFINITY;
    let blockSpeed = 0;
    let manoeuvreRoom = Number.POSITIVE_INFINITY;
    let manoeuvrePastSpeed = 0;
    for (const obstacle of obstacles) {
      // NEVER STEER TOWARD A CAR ALONGSIDE, NEVER STEER THROUGH ONE, and never be
      // trapped by one either.
      //
      // Holding the present gap or widening it stays available whatever is beside
      // the body, so a driver pinned between two cars still has lines to choose
      // from; only closing on one is refused. Treating it as an ordinary obstacle
      // instead would make every line inadmissible the moment a neighbour drew level
      // and stop the car dead in the middle of the carriageway.
      //
      // Judging the CANDIDATE alone is not enough, and the hole it left was the
      // whole bug it was written to fix. A line past the neighbour is further from
      // it than the lane the driver is in, so it read as moving away and was
      // allowed: refused the next lane because it was occupied, the search walked
      // outward and settled on the sand beyond it, and the rate-limited line then
      // dragged the body straight over the car it had just refused to touch.
      // Measured on the side-by-side bench: a commanded line 7.0 m out with a
      // neighbour at 4.35 m, and 1.54 m of gap between two bodies while level. So
      // the test is the CLOSEST the body comes to it anywhere on the way there,
      // which is zero when it has to be driven through.
      if (obstacle.abeam) {
        const reach = obstacle.halfWidth + halfWidth;
        const gapNow = Math.abs(obstacle.lateral - ownLateral);
        const gapThere = Math.abs(obstacle.lateral - line);
        // ALREADY INSIDE ITS BAND IS NOT "ABOUT TO DRIVE THROUGH IT".
        //
        // `through` is for a line on the FAR side of a car in the next lane: getting
        // there means crossing the space it occupies. A car in our OWN lane — the one
        // tailgating us — overlaps our band by definition, so the test fired on it and
        // reported zero clearance for every candidate line on either side. Every line
        // was then refused, and a manoeuvre already under way was abandoned: reported
        // from play as a car that had committed to an overtake going meekly back into
        // its lane the moment the player closed up behind it. Moving sideways out of a
        // band we are already in is not driving through anybody; the plain test below
        // still refuses to CLOSE on whoever is in it.
        const through =
          obstacle.level === true &&
          gapNow >= reach &&
          (obstacle.lateral - ownLateral) * (obstacle.lateral - line) <= 0;
        // A LEADER ALREADY BEHIND US AND SLOWER IS NOT A LEADER WE ARE CUTTING OFF.
        //
        // The plain `gapThere` test below reads "destination coincides with this
        // body" as "driving into it" whichever direction the body actually lies —
        // correct for one still ahead or genuinely alongside, since it can still be
        // there when the lateral move finishes, but wrong for one this driver has
        // already drawn ahead of and is pulling away from: that body is vacating the
        // lane, not occupying it, and returning to it is how a pass ends. Gated on
        // `trailing` (this driver's own probe already put it behind us) AND on speed
        // (still catching up is still a hazard whichever side it is on), so a body
        // merely alongside, or one keeping pace, keeps the ordinary veto.
        const recedingLeader =
          obstacle.trailing === true &&
          gapNow >= reach &&
          obstacle.speed < speed - MIN_ADVANTAGE_MPS;
        const closest = through ? 0 : recedingLeader ? gapNow : Math.min(gapNow, gapThere);
        if (closest < reach && closest < gapNow) {
          admissible = false;
          if (!captureRejected) return;
        }
        continue;
      }
      // Only a body the present band touches and the destination clears sets the
      // move's deadline. A body still in the destination belongs to corridor braking.
      if (
        shift > MANOEUVRE_SHIFT_MIN_M &&
        obstacle.s >= 0 && obstacle.s < manoeuvreRoom &&
        overlaps(obstacle, ownLateral, halfWidth) &&
        !overlaps(obstacle, line, halfWidth)
      ) {
        manoeuvreRoom = obstacle.s;
        manoeuvrePastSpeed = Math.max(0, obstacle.speed);
      }
      if (obstacle.s < 0 || obstacle.s > horizon) continue;
      // ON AN OPEN SHOULDER BYPASS, A STANDING CAR IS ONLY IN THE WAY OF A LINE THAT ENDS
      // IN IT. The swept band at the present speed is the wrong test there: the move is
      // priced at the speed it will be driven (`manoeuvreSpeed`, which ends it short of
      // the car), and at the approach speed the band covered the car, so the lane was
      // kept and braked in until the bumper — then the line was too late from anywhere.
      const bypassingIt =
        standingBypass?.open === true &&
        obstacle.speed <= SHOULDER_BYPASS_MAX_SPEED &&
        (line - oncomingBoundary) * ownSide > 0 &&
        Math.abs(line) + halfWidth > asphaltLimit;
      if (
        bypassingIt
          ? !overlaps(obstacle, line, halfWidth)
          : !sweptOverlap(obstacle, ownLateral, line, halfWidth, transitionDistance, speed)
      ) {
        continue;
      }
      if (obstacle.s < blockDistance) {
        blockDistance = obstacle.s;
        blockSpeed = obstacle.speed;
      }
    }
    // Invert the same two lateral-acceleration arcs used by the swept test. The
    // obstacle's speed matters: room is closing distance, not distance past it.
    //
    // ROUND A CAR STANDING IN THE LANE, THE MOVE IS PRICED ON THE LINE'S RATE CAP TOO
    // (`lineRate`), IT ENDS SHORT OF THE CAR, and the approach is floored at a crawl
    // rather than at the moving-traffic figure. The duration depends on the speed through
    // the cap, so it is solved by fixed point from the arcs-only answer, which is an upper
    // bound and only ever comes down.
    const standingCar = manoeuvrePastSpeed <= SHOULDER_BYPASS_MAX_SPEED;
    let manoeuvreSpeed = Number.POSITIVE_INFINITY;
    if (manoeuvreRoom < Number.POSITIVE_INFINITY) {
      const room = Math.max(0, manoeuvreRoom - (standingCar ? stillManoeuvreStandoff : 0));
      const accel = Math.max(lineAccel, 1e-3);
      let solved = manoeuvrePastSpeed + room / (2 * Math.sqrt(shift / accel));
      for (let k = 0; standingCar && lineRate && k < MANOEUVRE_SPEED_ITERATIONS; k++) {
        solved = manoeuvrePastSpeed + room / lineMoveSeconds(shift, accel, solved, lineRate);
      }
      manoeuvreSpeed = Math.max(
        standingCar ? stillManoeuvreFloorSpeed : manoeuvreFloorSpeed,
        Math.min(manoeuvreCeilingSpeed, solved),
      );
    }
    // Never across the crown for a car standing in the lane: see `standingBypass`. A body
    // already out there is let home as from any other crossing.
    if (crossesCentre && standingBypass !== undefined && !alreadyAcross) {
      admissible = false;
      if (!captureRejected) return;
    }
    if (crossesCentre) {
      // Room for a car coming the other way is not a preference. The manoeuvre
      // lasts as long as it takes to get past whatever is in our own lane, and an
      // oncoming car covers its own road while it happens.
      const ownLaneBlock = laneBlockDistance;
      // OVERHAULING SOMETHING MOVING AND GOING ROUND SOMETHING STOPPED ARE TIMED
      // DIFFERENTLY, and using the overhaul sum for both is how the crossing became a
      // head-on. Against a moving car the manoeuvre ends when the speed difference has
      // eaten the gap. Against a stopped one there is no speed difference to spend: it
      // ends when the car has driven the length of the thing and got back.
      //
      // A pending move is driven at THIS candidate's executable speed. Once the
      // current band already clears the obstacle there is no lateral deadline and
      // the pass uses its full allowance. No previous line's cap enters this search.
      // The gate keeps timing the crossing at no less than the moving-traffic floor: the
      // still approach's crawl is the stretch before the body is out, not the crossing.
      const passSpeed = Number.isFinite(manoeuvreSpeed)
        ? Math.max(manoeuvreSpeed, manoeuvreFloorSpeed)
        : Math.max(speed, crossingSpeed);
      const manoeuvreSeconds =
        leaderSpeed > SHOULDER_BYPASS_MAX_SPEED
          ? (Math.min(ownLaneBlock, horizon) + CLEAR_M) /
            Math.max(MIN_ADVANTAGE_MPS, crossingSpeed - leaderSpeed)
          : (Math.min(ownLaneBlock, horizon) + STILL_CLEAR_M) /
            Math.max(MIN_ADVANTAGE_MPS, passSpeed);
      let roomNeeded = (Math.max(speed, passSpeed) + oncomingSpeed) * manoeuvreSeconds;
      let entryRoom = roomNeeded * PASS_ENTRY_MARGIN;
      // A MEASURED PASS IS PRICED ON THE CAR THAT WILL DRIVE IT. See `passSeconds`.
      const measuredOvertake = passMeasured && leaderSpeed > SHOULDER_BYPASS_MAX_SPEED;
      if (measuredOvertake) {
        // No reachable slot is no window at all, whatever is or is not coming.
        roomNeeded = Number.isFinite(passSeconds)
          ? passTravel + oncomingSpeed * passSeconds
          : Number.POSITIVE_INFINITY;
        entryRoom = Number.isFinite(roomNeeded)
          ? roomNeeded + passMarginS * (passTravel / Math.max(passSeconds, 1e-3) + oncomingSpeed)
          : Number.POSITIVE_INFINITY;
      }
      // ONE OBSTRUCTION, TWO DIRECTIONS, AND SOMEBODY HAS TO GO FIRST.
      //
      // A wreck wide enough to close both lanes is a bottleneck: the corridor past it
      // exists, it is single file, and both streams want it. The room rule above is
      // symmetric, so at a shared bottleneck it refuses BOTH drivers and the road
      // stops — measured as two facing queues and 41% of car-time below walking pace.
      //
      // The tie is broken by geometry both drivers can measure without talking to each
      // other: the one already nearer the obstruction goes, the one further away stops
      // short of it. `oncomingGap - ownLaneBlock` is how far the approaching car still
      // has to come to reach the same thing, so "nearer" is a comparison of two numbers
      // this driver already has. It is exact, symmetric and produces opposite answers
      // in the two cars, which is the whole requirement.
      //
      // If the oncoming car is NEARER than the obstruction it is not at a bottleneck
      // with us at all; it is simply traffic in the lane we want, and the room rule is
      // the right one.
      const oncomingDistanceToBlock = oncomingGap - Math.min(ownLaneBlock, horizon);
      const sharedBottleneck =
        leaderSpeed <= SHOULDER_BYPASS_MAX_SPEED &&
        ownLaneBlock < horizon &&
        oncomingDistanceToBlock > 0;
      const firstToTheGap =
        sharedBottleneck && Math.min(ownLaneBlock, horizon) < oncomingDistanceToBlock;
      // THE ROOM CHECK IS FOR THE DECISION TO GO, NOT FOR THE ONE TO KEEP GOING.
      //
      // `roomNeeded` is a snapshot estimate, re-taken every step, and refusing the
      // crossing line on it here used to end a crossing already in progress: exactly
      // the case `crossingRearClear` below is exempted for, and for the identical
      // reason. While this driver is still ABEAM the car it is passing, the abeam
      // veto a few lines up refuses every line back into its own lane — cutting in on
      // top of the car beside it — whatever this gate decides. Refusing the crossing
      // line as well then leaves NOTHING admissible, and the fallback for that is a
      // full stop, delivered broadside across the lane the oncoming car is using: the
      // most exposed place on the road to stand still. Measured in play as a frantic
      // overtake braking to a dead stop astride the centre line with a clear leader
      // gap and a car still hundreds of metres out.
      //
      // A real driver in that position does not brake into the middle of the road:
      // it finishes the move it is already committed to — the kickdown it is already
      // spending is exactly that — and takes its own lane back the moment the abeam
      // veto lifts, which the cost search already prefers with nothing further owed
      // here. So a FRESH decision to cross is priced at `PASS_ENTRY_MARGIN` over the
      // bare minimum and may simply wait for a fatter window; a crossing already
      // under way is not re-litigated on the same shrinking estimate.
      // A pass with no slot to finish in is not a window, even on an empty road: the
      // comparison below alone would read Infinity against Infinity as room.
      const noSlot = measuredOvertake && !Number.isFinite(roomNeeded);
      if (!alreadyAcross && !firstToTheGap && (noSlot || oncomingGap < entryRoom)) {
        crossingRefused = true;
        waitingForOncoming = true;
        admissible = false;
        if (!captureRejected) return;
      }
      // …BUT A MEASURED PASS IS RE-MEASURED EVERY STEP, AND ONE THAT NO LONGER FITS IS
      // OVER. Not refused — see the permission above — but priced as a wall, so the
      // lane home wins the moment it exists. The opposing lane is borrowed to go fast;
      // a pass that has stopped going fast enough to finish before the car coming the
      // other way is a car parked in somebody else's lane.
      if (alreadyAcross && measuredOvertake && (noSlot || oncomingGap < roomNeeded)) {
        abandoned = true;
      }
      // A CROSSING REFUSED BECAUSE SOMETHING IS COMING IS NOT A DEAD END.
      //
      // The driver that would have taken this line is going to arrive at the
      // obstruction, stop, and wait for the road — which is correct behaviour and not
      // the same thing as having nowhere to go. Without the distinction the stall
      // rule read a yielding driver as a wedged one and started a reversing
      // manoeuvre, which put it across the carriageway in front of the very traffic
      // it was waiting for. Measured as 8% of all car-time spent in recovery.
      //
      // AND THE REAR CLEARANCE IS AN ENTRY RULE, asked only of a car that is still on
      // its own side. Its purpose is to stop a driver pulling out in front of somebody
      // already overtaking; re-asked every step of a manoeuvre in progress, it means
      // that anybody who pulls out BEHIND the passer sends the passer back across the
      // crown — into the lane it is being overtaken from. The car behind is a follower,
      // and the answer to a follower is to finish the pass and get back in.
      if (!crossingRearClear && !alreadyAcross) {
        crossingRefused = true;
        waitingForOncoming = true;
        admissible = false;
        if (!captureRejected) return;
      }
    }
    const bodyEdge = Math.abs(line) + halfWidth;
    const leavesAsphalt = bodyEdge > asphaltLimit;
    // The sand is for getting round something that is not going anywhere. Left
    // unpriced, the planner undertook moving traffic on the shoulder because sand
    // was cheaper than losing pace.
    const shoulderPass =
      leavesAsphalt &&
      !laneBlockIsStill &&
      shoulderPassOverhang > 0 &&
      (line - oncomingBoundary) * ownSide > 0 &&
      bodyEdge - asphaltLimit <= shoulderPassOverhang;
    // …BUT A BODY ALREADY OUT THERE MAY ALWAYS HOLD ITS LINE OR COME IN. A car that has
    // just gone round a standing one is on the shoulder beside moving traffic; refusing
    // it every line there left nothing admissible, the stall rule read that as a wedge,
    // and the escape put it in the desert (tools/traffic-blocker.ts: 30% of the queue
    // head's time with no admissible line, cars level with the ego 6 m past the paint).
    const holdingOnShoulder =
      (line - oncomingBoundary) * ownSide > 0 && Math.abs(line) <= Math.abs(ownLateral) + 1e-6;
    if (leavesAsphalt && !laneBlockIsStill && !shoulderPass && !holdingOnShoulder) admissible = false;
    // ROUND A STANDING CAR ON THIS SIDE'S SHOULDER: out to the line that clears it and no
    // further, priced as a short paved-road-side move, and not before the driver is near
    // enough to start it — until then it may hold the line it is on, not go further out.
    const bypassShoulder =
      standingBypass !== undefined && leavesAsphalt && (line - oncomingBoundary) * ownSide > 0;
    if (
      bypassShoulder &&
      Math.abs(line) > Math.abs(ownLateral) + 1e-6 &&
      (!standingBypass.open || Math.abs(line) > Math.abs(standingBypass.line) + 1e-6)
    ) {
      admissible = false;
    }
    if (!admissible && !captureRejected) return;
    let cost = Number.POSITIVE_INFINITY;
    if (admissible) {
      cost =
        Math.abs(line - laneOffset) * LANE_COST_PER_M +
        Math.max(0, bodyEdge - asphaltLimit) *
          (shoulderPass || bypassShoulder
            ? shoulderPassSooner || bypassShoulder ? SHOULDER_PASS_SOONER_COST_PER_M : SHOULDER_PASS_COST_PER_M
            : SHOULDER_COST_PER_M) +
        (crossesCentre ? oncomingLaneCost : 0);
      if (blockDistance < Number.POSITIVE_INFINITY) {
        // Fading to nothing at the horizon.
        const nearness = blockDistance >= horizon ? 0 : 1 - blockDistance / horizon;
        cost += Math.max(0, desiredSpeed - blockSpeed) * SLOW_COST_PER_MPS * nearness;
      }
      if (abandoned) cost += BLOCK_COST;
      if (Math.abs(line - previousLine) > LINE_STEP_M) cost += SWITCH_COST;
    }
    // A CAR IN THE CORRIDOR IS A REASON TO SLOW DOWN, never a reason to conclude the
    // road has no way through: the driver in front is going somewhere, and the queue
    // behind it is traffic behaving correctly. An admissible line always beats an
    // inadmissible one, however cheap.
    const better = !bestAdmissible || (admissible && cost < bestCost);
    if (!better) return;
    bestLine = line;
    bestCost = cost;
    bestBlockDistance = blockDistance;
    bestBlockSpeed = blockSpeed;
    bestManoeuvreSpeed = manoeuvreSpeed;
    bestAdmissible = admissible;
    bestAbandoned = abandoned;
  };

  // Exact centres matter: the quarter-metre avoidance lattice would otherwise shave
  // clearance from a lane by centimetres. `laneCentres` includes every lane on this
  // side; only a line across the explicit crown boundary pays the opposing gate.
  if (fixedLine !== undefined) {
    evaluate(fixedLine, true);
  } else {
    for (const laneCentre of laneCentres) evaluate(laneCentre);
    const first = Math.ceil(-edgeLimit / LINE_STEP_M) * LINE_STEP_M;
    for (let line = first; line <= edgeLimit + 1e-6; line += LINE_STEP_M) {
      evaluate(line);
    }
    if (!bestAdmissible) {
      // Keep actual occupied-corridor metrics, but never advertise a failed search
      // as a clear route just because its default line had no samples.
      evaluate(ownLateral, true);
      bestAdmissible = false;
    }
  }

  return {
    line: bestLine,
    admissible: bestAdmissible,
    waitingForOncoming: waitingForOncoming && !bestAdmissible,
    crossingRefused,
    crossingAbandoned: bestAbandoned && bestAdmissible,
    blockDistance: bestBlockDistance,
    blockSpeed: bestBlockSpeed,
    manoeuvreSpeed: bestManoeuvreSpeed,
    usesOncomingLane:
      (bestLine - oncomingBoundary) * ownSide < -halfWidth * 0.5,
    usesShoulder: Math.abs(bestLine) + halfWidth > asphaltLimit,
    laneBlockDistance,
    laneBlockSpeed,
  };
}
