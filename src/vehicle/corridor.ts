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
 * It is a PURE function: road-relative obstacles in, a line and what blocks it
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
}

export interface CorridorRequest {
  /** Where the body is now, and the line commanded last step. */
  readonly ownLateral: number;
  readonly previousLine: number;
  /** The lane this driver holds when nothing else matters. */
  readonly laneOffset: number;
  readonly speed: number;
  /** Speed the driver would hold on a clear road. */
  readonly desiredSpeed: number;
  readonly halfWidth: number;
  /** How far ahead obstacles were collected. Costs fade to zero at this range. */
  readonly horizon: number;
  /** Lateral metres the commanded line may move per metre of road covered. */
  readonly lineRatePerMetre: number;
  /** Outermost line that keeps the body on asphalt, and on the graded verge. */
  readonly asphaltLimit: number;
  readonly edgeLimit: number;
  /**
   * What this driver thinks of the opposing lane, in cost. Low is bold: it is the
   * single knob that used to be a page of passing thresholds.
   */
  readonly oncomingLaneCost: number;
  /** Measured clear road in the opposing lane, metres, or Infinity. */
  readonly oncomingGap: number;
  /** Assumed speed of an unseen car coming the other way. */
  readonly oncomingSpeed: number;
  /** Road the car needs to stop from here; a hard block inside it is not feasible. */
  readonly stopRoom: number;
  readonly obstacles: readonly CorridorObstacle[];
}

export interface CorridorPlan {
  /** Lateral line to command. */
  readonly line: number;
  /** Is there a line whose corridor has nothing immovable inside stopping range? */
  readonly feasible: boolean;
  /** Nearest thing in the chosen corridor and how fast it is going, or Infinity. */
  readonly blockDistance: number;
  readonly blockSpeed: number;
  /** True while the chosen line is on the wrong side of the centre for this driver. */
  readonly usesOncomingLane: boolean;
  /** True while the chosen line puts the body past the asphalt. */
  readonly usesShoulder: boolean;
}

/** Lateral resolution of the search. A quarter of a metre is a tenth of a car. */
const LINE_STEP_M = 0.25;
/** Cost per metre of deviation from the driver's own lane. */
const LANE_COST_PER_M = 1;
/** Cost per metre of body past the asphalt edge. Deliberately steep. */
const SHOULDER_COST_PER_M = 14;
/** Something immovable in the corridor, scaled by how soon it arrives. */
const BLOCK_COST = 600;
/** Cost per m/s of speed a slower car in the corridor would cost us. */
const SLOW_COST_PER_MPS = 6;
/** Paid once for changing the commanded line at all: the hysteresis. */
const SWITCH_COST = 1.2;
/** Room wanted beyond an obstacle before the corridor counts as past it. */
const CLEAR_M = 30;
/** Slowest closing speed an overtake is planned at, so the sums stay finite. */
const MIN_ADVANTAGE_MPS = 0.5;
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
 */
function sweptOverlap(
  obstacle: CorridorObstacle,
  from: number,
  to: number,
  halfWidth: number,
  transitionDistance: number,
): boolean {
  if (obstacle.s <= transitionDistance) {
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
  const {
    ownLateral,
    previousLine,
    laneOffset,
    speed,
    desiredSpeed,
    halfWidth,
    horizon,
    lineRatePerMetre,
    asphaltLimit,
    edgeLimit,
    oncomingLaneCost,
    oncomingGap,
    oncomingSpeed,
    stopRoom,
    obstacles,
  } = request;
  const ownSide = Math.sign(laneOffset || -1);
  let bestLine = laneOffset;
  let bestCost = Number.POSITIVE_INFINITY;
  let bestBlockDistance = Number.POSITIVE_INFINITY;
  let bestBlockSpeed = 0;
  let bestFeasible = false;
  // What blocks the driver's OWN lane, once, for every candidate to reason about:
  // it is the thing a detour or an overtake exists to get past, and whether it is
  // moving decides which of the two is even allowed.
  let laneBlockDistance = Number.POSITIVE_INFINITY;
  let laneBlockSpeed = 0;
  let laneBlockLateral = laneOffset;
  for (const obstacle of obstacles) {
    if (obstacle.s < 0 || obstacle.s > horizon) continue;
    if (!overlaps(obstacle, laneOffset, halfWidth)) continue;
    if (obstacle.s >= laneBlockDistance) continue;
    laneBlockDistance = obstacle.s;
    laneBlockSpeed = obstacle.speed;
    laneBlockLateral = obstacle.lateral;
  }
  const laneBlockIsStill = laneBlockSpeed <= SHOULDER_BYPASS_MAX_SPEED;

  const evaluate = (line: number): void => {
    if (Math.abs(line) > edgeLimit) return;
    const transitionDistance =
      Math.abs(line - ownLateral) / Math.max(lineRatePerMetre, 1e-4);
    let blockDistance = Number.POSITIVE_INFINITY;
    let blockSpeed = 0;
    let hardBlockDistance = Number.POSITIVE_INFINITY;
    for (const obstacle of obstacles) {
      if (obstacle.s < 0 || obstacle.s > horizon) continue;
      if (!sweptOverlap(obstacle, ownLateral, line, halfWidth, transitionDistance)) continue;
      if (obstacle.s < blockDistance) {
        blockDistance = obstacle.s;
        blockSpeed = obstacle.speed;
      }
      // Anything that is not moving away from us has to be gone round, not
      // followed: for the lateral decision that is what "blocked" means.
      if (obstacle.speed < desiredSpeed - MIN_ADVANTAGE_MPS && obstacle.s < hardBlockDistance) {
        hardBlockDistance = obstacle.s;
      }
    }
    const crossesCentre = line * ownSide < -halfWidth * 0.5;
    if (crossesCentre) {
      // Room for a car coming the other way is not a preference. The manoeuvre
      // lasts as long as it takes to overhaul whatever is in our own lane, and an
      // oncoming car covers its own road while it happens.
      const ownLaneBlock = obstacles.reduce((nearest, obstacle) => {
        if (obstacle.s < 0 || obstacle.s > horizon) return nearest;
        if (!overlaps(obstacle, laneOffset, halfWidth)) return nearest;
        return Math.min(nearest, obstacle.s);
      }, Number.POSITIVE_INFINITY);
      const leaderSpeed = obstacles.reduce((slowest, obstacle) => {
        if (obstacle.s < 0 || obstacle.s > horizon) return slowest;
        if (!overlaps(obstacle, laneOffset, halfWidth)) return slowest;
        return Math.min(slowest, obstacle.speed);
      }, desiredSpeed);
      const advantage = Math.max(MIN_ADVANTAGE_MPS, desiredSpeed - leaderSpeed);
      const manoeuvreSeconds =
        (Math.min(ownLaneBlock, horizon) + CLEAR_M) / advantage;
      const roomNeeded = (Math.max(speed, desiredSpeed) + oncomingSpeed) * manoeuvreSeconds;
      if (oncomingGap < roomNeeded) return;
    }
    const bodyEdge = Math.abs(line) + halfWidth;
    const leavesAsphalt = bodyEdge > asphaltLimit;
    // The sand is for getting round something that is not going anywhere. Left
    // unpriced, the planner undertook moving traffic on the shoulder because sand
    // was cheaper than losing pace.
    if (leavesAsphalt && !laneBlockIsStill) return;
    const nearness = (distance: number): number =>
      distance >= horizon ? 0 : 1 - distance / horizon;
    let cost =
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
    const feasible = hardBlockDistance > stopRoom;
    // A feasible corridor always beats an infeasible one, however cheap.
    const better =
      bestCost === Number.POSITIVE_INFINITY ||
      (feasible && !bestFeasible) ||
      (feasible === bestFeasible && cost < bestCost);
    if (!better) return;
    bestLine = line;
    bestCost = cost;
    bestBlockDistance = blockDistance;
    bestBlockSpeed = blockSpeed;
    bestFeasible = feasible;
  };

  evaluate(laneOffset);
  const first = Math.ceil(-edgeLimit / LINE_STEP_M) * LINE_STEP_M;
  for (let line = first; line <= edgeLimit + 1e-6; line += LINE_STEP_M) {
    evaluate(line);
  }

  return {
    line: bestLine,
    feasible: bestFeasible,
    blockDistance: bestBlockDistance,
    blockSpeed: bestBlockSpeed,
    usesOncomingLane: bestLine * ownSide < -halfWidth * 0.5,
    usesShoulder: Math.abs(bestLine) + halfWidth > asphaltLimit,
  };
}
