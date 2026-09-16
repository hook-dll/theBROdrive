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
   * CAN THIS THING GO AWAY BY ITSELF?
   *
   * A rock cannot; a car can, and usually will. The difference decides whether a
   * corridor with it inside is impassable or merely occupied — and conflating the two
   * is how a queue became a pile of reversing cars: every driver behind a stopped head
   * found no feasible corridor, concluded it was wedged, and started a two-point turn
   * in the middle of the road. Measured at a single blocked lane: eight per cent of all
   * car-time spent in recovery, and the longest stop of the run a hundred seconds.
   *
   * Defaults to immovable, so anything a caller forgets to mark is treated as scenery.
   */
  readonly movable?: boolean;
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
   * mid-manoeuvre, one with no feasible corridor — and otherwise grants its own lane
   * and wherever the body already is, so a car away from its lane can always hold
   * position or come home, and never go further out.
   */
  readonly lateralFreedom?: number;
  /** Hard permission to occupy a line across the crown, independent of its price. */
  readonly mayCrossCrown: boolean;
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
  /** Slowest speed at which a pending lateral move may be driven. */
  readonly manoeuvreFloorSpeed: number;
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
   * Is the opposing lane clear BEHIND us? Pulling out in front of something already
   * overtaking is a rear-end, and the corridor search has no rearward obstacles.
   */
  readonly crossingRearClear: boolean;
  /** Road the car needs to stop from here; a hard block inside it is not feasible. */
  readonly stopRoom: number;
  readonly obstacles: readonly CorridorObstacle[];
}

export interface CorridorPlan {
  /** Lateral line to command. */
  readonly line: number;
  /** The chosen line passed every hard permission and geometry gate. */
  readonly admissible: boolean;
  /** The line is admissible and has nothing immovable inside stopping range. */
  readonly feasible: boolean;
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
 * Cost per metre of body past the asphalt edge. Deliberately steep, and steep enough to
 * beat `LEFT_PASS_COST` after about a metre of it.
 *
 * Reported from play, and the reason for the number: a low pile of rubble in the
 * driver's own lane with a COMPLETELY EMPTY opposing lane beside it. Going round on the
 * right means leaving the asphalt, and two metres of sand used to be priced below the
 * convention that immovable things are passed on the right - so the car went into the
 * sand, bogged there, and never got past. The convention is worth keeping while both
 * options are road; it is not worth a bogging.
 */
const SHOULDER_COST_PER_M = 26;
/** Something immovable in the corridor, scaled by how soon it arrives. */
const BLOCK_COST = 600;
/** Cost per m/s of speed a slower car in the corridor would cost us. */
const SLOW_COST_PER_MPS = 6;
/** Paid once for changing the commanded line at all: the hysteresis. */
const SWITCH_COST = 3;
/** Room wanted beyond an obstacle before the corridor counts as past it. */
const CLEAR_M = 30;
/**
 * The same, for something STOPPED, and it is a third of the figure for a moving car
 * on purpose.
 *
 * Overtaking traffic needs room to pull back in front of the car it has passed. A log
 * needs the log's own length and this car's, and nothing else: measured on the real
 * road, charging the 30 m overtake margin to a standing obstruction turned a 61 m
 * window into a 211 m one, which a stream with 150 m between cars never offers. A
 * cautious driver stood at a rock for the entire six-minute run with a clear line to
 * take and the whole road queueing behind it.
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
 * wreck, a stone or the head of a stopped queue is a different matter, and this
 * is the line between them.
 */
const SHOULDER_BYPASS_MAX_SPEED = 2;
/**
 * Cost of going round an immovable thing on its LEFT rather than its right.
 *
 * Passing obstacles on the right is what lets two opposing streams go round the
 * same wreck and still clear each other — it is a convention, not geometry, so it
 * lives here as a price rather than as a hard rule: high enough that the right is
 * taken whenever it exists, low enough that a thing lying against the right verge
 * is passed on the left instead of stopping the car.
 */
const LEFT_PASS_COST = 34;
/**
 * The escape hatch in `sweptOverlap`, and both halves of it are deliberately tiny.
 *
 * Wider, it is not an escape but a licence: at 4 m/s and three metres of reach the
 * planner committed to lines the body could not reach and the bench caught it clipping
 * a rock it had been asked to creep past. Walking pace with the thing already at the
 * bumper is the only arrangement where stopping has nothing left to offer.
 */
const STANDING_SPEED_MPS = 1.5;
const STANDING_REACH_M = 2;

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
  // it never gets out of. The swept band runs from where the body IS, so a still thing
  // that already overlaps this lateral - a pile the car has crept up to and stopped at -
  // poisons every candidate line, including the ones that would clear it. The corridor
  // is then infeasible at zero speed, the car is held at zero speed because the corridor
  // is infeasible, and it stands beside the pile for good. Reported from play exactly
  // that way: the player's car stuck at a mound in its own lane while ambient traffic
  // went round it.
  //
  // Below walking pace, against something that is not moving either, only the
  // destination matters: the wheels are turned before the car rolls, and there is no
  // closing speed left to run out of.
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
    lineAccel,
    asphaltLimit,
    edgeLimit,
    oncomingLaneCost,
    oncomingGap,
    oncomingSpeed,
    manoeuvreFloorSpeed,
    crossingSpeed,
    laneCentres = [laneOffset],
    lateralFreedom = Number.POSITIVE_INFINITY,
    oncomingBoundary = 0,
    stopRoom,
    crossingRearClear,
    obstacles,
    mayCrossCrown,
    lineAllowed,
  } = request;
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
  let bestFeasible = false;
  let bestAdmissible = false;
  // What blocks the driver's OWN lane, once, for every candidate to reason about:
  // it is the thing a detour or an overtake exists to get past, and whether it is
  // moving decides which of the two is even allowed.
  let laneBlockDistance = Number.POSITIVE_INFINITY;
  let laneBlockSpeed = 0;
  let laneBlockLateral = laneOffset;
  // The slowest own-lane body is not necessarily the nearest one.
  let leaderSpeed = crossingSpeed;
  for (const obstacle of obstacles) {
    if (obstacle.abeam || obstacle.s < 0 || obstacle.s > horizon) continue;
    if (!overlaps(obstacle, laneOffset, halfWidth)) continue;
    leaderSpeed = Math.min(leaderSpeed, obstacle.speed);
    if (obstacle.s >= laneBlockDistance) continue;
    laneBlockDistance = obstacle.s;
    laneBlockSpeed = obstacle.speed;
    laneBlockLateral = obstacle.lateral;
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

  const nearness = (distance: number): number =>
    distance >= horizon ? 0 : 1 - distance / horizon;

  const evaluate = (line: number, captureRejected = false): void => {
    const crossesCentre =
      (line - oncomingBoundary) * ownSide < -halfWidth * 0.5;
    let admissible =
      Math.abs(line) <= edgeLimit &&
      Math.abs(line - laneOffset) <= lateralFreedom &&
      (!crossesCentre || mayCrossCrown) &&
      (lineAllowed?.(line) ?? true);
    if (!admissible && !captureRejected) return;
    const shift = Math.abs(line - ownLateral);
    // Road covered while the line is being moved there, from the manoeuvre's own arc.
    // A car that is barely moving covers almost none of it, which is what the old
    // slope needed a standstill special case for.
    const transitionDistance =
      speed * 2 * Math.sqrt(shift / Math.max(lineAccel, 1e-3));
    let blockDistance = Number.POSITIVE_INFINITY;
    let blockSpeed = 0;
    let hardBlockDistance = Number.POSITIVE_INFINITY;
    /** The same, counting only what cannot drive away. See `CorridorObstacle.movable`. */
    let wallDistance = Number.POSITIVE_INFINITY;
    let manoeuvreRoom = Number.POSITIVE_INFINITY;
    let manoeuvrePastSpeed = 0;
    for (const obstacle of obstacles) {
      // NEVER STEER TOWARD A CAR ALONGSIDE, NEVER STEER THROUGH ONE, and never be
      // trapped by one either.
      //
      // Holding the present gap or widening it stays available whatever is beside
      // the body, so a driver pinned between two cars still has lines to choose
      // from; only closing on one is refused. Treating it as an ordinary obstacle
      // instead would make every line infeasible the moment a neighbour drew level
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
      if (!sweptOverlap(obstacle, ownLateral, line, halfWidth, transitionDistance, speed)) {
        continue;
      }
      if (obstacle.s < blockDistance) {
        blockDistance = obstacle.s;
        blockSpeed = obstacle.speed;
      }
      // ANYTHING THAT IS NOT MOVING AWAY FROM US HAS TO BE DEALT WITH — BUT ONLY
      // SCENERY HAS TO BE GONE ROUND.
      //
      // `BLOCK_COST` is documented as the price of something IMMOVABLE, and until
      // here it was charged to anything merely slower than desired, movable or not.
      // That is right for the FRESH decision to overtake — it is the whole reason a
      // slow leader with an empty opposing lane gets crossed rather than followed —
      // and wrong for the return from one already under way: a driver aborting a
      // pass is choosing to go back to following the very car it was passing, which
      // this same price then read as "still practically a wall", worth exactly as
      // much escaping as the real, closing oncoming car the driver was aborting
      // FOR. Measured in play: a car that had barely started a pass, saw the
      // oncoming lane taken, and could not price its own lane as home either —
      // both directions "blocked" by the same number, so the cheapest line was
      // neither, straddling the crown between two real cars for good. A body that
      // can drive away by itself is followed, not routed round, and the ordinary
      // speed plan already prices following it — see `SLOW_COST_PER_MPS` below.
      if (obstacle.speed >= desiredSpeed - MIN_ADVANTAGE_MPS) continue;
      if (!obstacle.movable && obstacle.s < hardBlockDistance) hardBlockDistance = obstacle.s;
      if (!obstacle.movable && obstacle.s < wallDistance) wallDistance = obstacle.s;
    }
    // Invert the same two lateral-acceleration arcs used by the swept test. The
    // obstacle's speed matters: room is closing distance, not distance past a rock.
    const manoeuvreSpeed = manoeuvreRoom < Number.POSITIVE_INFINITY
      ? Math.max(
          manoeuvreFloorSpeed,
          Math.min(
            manoeuvreCeilingSpeed,
            manoeuvrePastSpeed + 0.5 * manoeuvreRoom * Math.sqrt(lineAccel / shift),
          ),
        )
      : Number.POSITIVE_INFINITY;
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
      const passSpeed = Number.isFinite(manoeuvreSpeed)
        ? manoeuvreSpeed
        : Math.max(speed, crossingSpeed);
      const manoeuvreSeconds =
        leaderSpeed > SHOULDER_BYPASS_MAX_SPEED
          ? (Math.min(ownLaneBlock, horizon) + CLEAR_M) /
            Math.max(MIN_ADVANTAGE_MPS, crossingSpeed - leaderSpeed)
          : (Math.min(ownLaneBlock, horizon) + STILL_CLEAR_M) /
            Math.max(MIN_ADVANTAGE_MPS, passSpeed);
      const roomNeeded = (Math.max(speed, passSpeed) + oncomingSpeed) * manoeuvreSeconds;
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
      if (!alreadyAcross && !firstToTheGap && oncomingGap < roomNeeded * PASS_ENTRY_MARGIN) {
        crossingRefused = true;
        if (wallDistance === Number.POSITIVE_INFINITY) waitingForOncoming = true;
        admissible = false;
        if (!captureRejected) return;
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
        if (wallDistance === Number.POSITIVE_INFINITY) waitingForOncoming = true;
        admissible = false;
        if (!captureRejected) return;
      }
    }
    const bodyEdge = Math.abs(line) + halfWidth;
    const leavesAsphalt = bodyEdge > asphaltLimit;
    // The sand is for getting round something that is not going anywhere. Left
    // unpriced, the planner undertook moving traffic on the shoulder because sand
    // was cheaper than losing pace.
    if (leavesAsphalt && !laneBlockIsStill) admissible = false;
    if (!admissible && !captureRejected) return;
    let cost = Number.POSITIVE_INFINITY;
    if (admissible) {
      cost =
        Math.abs(line - laneOffset) * LANE_COST_PER_M +
        Math.max(0, bodyEdge - asphaltLimit) * SHOULDER_COST_PER_M +
        (crossesCentre ? oncomingLaneCost : 0);
      // Immovable things are passed on the right, so that two opposing streams go
      // round the same one and still clear each other.
      if (laneBlockDistance < Number.POSITIVE_INFINITY && laneBlockIsStill && line > laneBlockLateral) {
        cost += LEFT_PASS_COST;
      }
      if (hardBlockDistance < Number.POSITIVE_INFINITY) {
        cost += BLOCK_COST * nearness(hardBlockDistance);
      } else if (blockDistance < Number.POSITIVE_INFINITY) {
        cost +=
          Math.max(0, desiredSpeed - blockSpeed) * SLOW_COST_PER_MPS * nearness(blockDistance);
      }
      if (Math.abs(line - previousLine) > LINE_STEP_M) cost += SWITCH_COST;
    }
    // FEASIBLE MEANS "NOTHING IMMOVABLE IN IT WITHIN STOPPING DISTANCE".
    //
    // A car in the corridor is a reason to slow down, never a reason to conclude the
    // road has no way through: the driver in front is going somewhere, and the queue
    // behind it is traffic behaving correctly. Only scenery closes a corridor.
    const feasible = admissible && wallDistance > stopRoom;
    // A feasible corridor always beats an infeasible one, however cheap.
    const better =
      !bestAdmissible ||
      (feasible && !bestFeasible) ||
      (feasible === bestFeasible && cost < bestCost);
    if (!better) return;
    bestLine = line;
    bestCost = cost;
    bestBlockDistance = blockDistance;
    bestBlockSpeed = blockSpeed;
    bestManoeuvreSpeed = manoeuvreSpeed;
    bestFeasible = feasible;
    bestAdmissible = admissible;
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
      bestFeasible = false;
    }
  }

  return {
    line: bestLine,
    admissible: bestAdmissible,
    feasible: bestFeasible,
    waitingForOncoming: waitingForOncoming && !bestFeasible,
    crossingRefused,
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
