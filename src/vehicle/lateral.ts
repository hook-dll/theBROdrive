/**
 * THE LATERAL MANOEUVRE, AS ONE STATE WITH ONE OWNER.
 *
 * The corridor search (`corridor.ts`) re-prices every reachable line every fixed step,
 * from measurements that move continuously: a gap, a closing speed, a stopping room.
 * Its answer is right on every step taken alone and useless as a sequence — wherever a
 * measurement sits near a threshold the cheapest line flips, and a car that obeys every
 * flip weaves, buzzes its indicators (eighty changes in one overtake, measured) or
 * stops astride the centre line. So the driver commits: this state is what turns a
 * stream of per-step verdicts into a decision.
 *
 * Its hysteresis is not a tuning artefact; it is the commitment itself, in three forms:
 *  - ENTRY IS STRICTER THAN CONTINUATION. A move begins only when the blocker is within
 *    the road the move needs (`room`) and the planner wants out by `detourMin`; it ends
 *    when the blocker is `releaseMargin` further than that, or behind. The same split is
 *    applied by the caller to the crossing and verge-pass permissions: the full sight
 *    and clearance for the decision to go, only the remaining manoeuvre for the
 *    decision to keep going — an abort that takes longer than finishing is the more
 *    dangerous of the two.
 *  - A GIVEN-UP MANOEUVRE IS BARRED FOR A WHILE (`crossingBarred`, `shoulderBarred`), so
 *    a gate that is only just shut does not reopen the move on the next step. The
 *    barrier lifts on road covered OR on time, whichever comes first: a car that gave
 *    up a crossing round a parked lorry and stopped behind it covers no road, and a
 *    distance-only barrier kept the opposing lane closed to it for good.
 *  - A COMMITMENT HAS A LIMIT (`holdMax` of road), renewed only while the lane it left
 *    is still materially slower, so nothing is held after its reason has gone.
 *
 * And one thing is NOT held here at all: whether the committed line is still safe.
 * The caller evaluates it every step and calls `release` when it is not (`drive`'s
 * reconcile); the commitment decides between good options, it never overrules a
 * refusal.
 */

export type LateralKind =
  /** Inside the driver's own carriageway: round a prop, or a lane pass on four lanes. */
  | 'detour'
  /** Over the crown, in the opposing lane. */
  | 'crossing'
  /** With the body out on the verge beside a moving car (racer). */
  | 'shoulder'
  /** Between a queue and the oncoming stream (racer). */
  | 'middle';

/** The fixed numbers the commitment is sized with; supplied by the autopilot's tables. */
export interface LateralGeometry {
  readonly carHalfWidth: number;
  readonly carHalfLength: number;
  /** How far off its lane the planner must want to be before leaving it counts. */
  readonly detourMin: number;
  /** Least road ahead the blocker may be and still be acted on. */
  readonly triggerFloor: number;
  /** Road a commitment lasts without renewal. */
  readonly holdMax: number;
  /** Extra road past the trigger distance before the lane counts as clear again. */
  readonly releaseMargin: number;
  readonly minClosing: number;
  readonly crawl: number;
  /** Speed a lane must be short of the driver's own before it counts as still slow. */
  readonly passAdvantage: number;
  /** A verge pass gaining less than this on the car it passes is stalling. */
  readonly shoulderMinGain: number;
  readonly shoulderStallS: number;
  readonly shoulderRetryM: number;
}

/** One step's facts, as the autopilot measured them. */
export interface LateralFacts {
  /** The search's cheapest admissible line this step. */
  readonly proposed: number;
  /** What committing to `proposed` would be. */
  readonly proposedKind: LateralKind;
  readonly ownLateral: number;
  readonly laneOffset: number;
  readonly hintS: number;
  readonly travelled: number;
  readonly laneBlockDistance: number;
  readonly laneBlockSpeed: number;
  readonly desiredSpeed: number;
  readonly speed: number;
  /** Lateral acceleration the commanded line will really be moved with. */
  readonly lineAccel: number;
  /** The crossing is refused, abandoned by its measurement, or no longer permitted. */
  readonly crossingRefused: boolean;
  /**
   * A REAL body, probed on the line in use, is closing faster than a driver would read
   * as a slower car going the same way. This is what a driver reacts to, rather than the
   * pre-commit room estimate behind `crossingRefused`: that estimate is pessimistic while
   * the car is still abeam the one it passes, and re-asking it of a crossing under way
   * produced a dead stop astride the centre line. But a crossing still has to end early
   * when a car really coming, really close, shows up — measured as passes that held the
   * opposing lane through a closing car because nothing woke the commitment until the
   * passed leader was a full release distance behind.
   */
  readonly headOn: boolean;
  /** Outermost line the road allows HERE. A committed one was chosen somewhere else. */
  readonly edgeLimit: number;
  /**
   * How far back a racer starts a pass already approved: from where a follower would
   * begin to brake, not from the leader's bumper. Measured: waiting for the ordinary
   * trigger turned a 90 km/h approach on a car doing 57, opposing lane empty, into two
   * hundred metres of braking to its speed first. 0 keeps the move's own trigger.
   */
  readonly passReach: number;
  /** Barrier after a given-up crossing: road and seconds, whichever runs out first. */
  readonly retryM: number;
  readonly retryS: number;
  /**
   * May a NEW move begin this step? False holds the lane (a move under way is not
   * touched): the caller's way of saying "slow first, then move" — see
   * `WAKE_CAUTION_S` in autopilot.ts.
   */
  readonly mayEnter: boolean;
}

export class LateralCommitment {
  /** The manoeuvre committed to, or null while the lane is held. */
  kind: LateralKind | null = null;
  /** Its line, metres of road lateral. */
  line = 0;
  private untilS = 0;
  private crossingBarM = 0;
  private crossingBarS = 0;

  /** A verge pass in progress: the car it passes, and whether it is being given up. */
  shoulderPassing = false;
  shoulderPassSpeed = 0;
  shoulderYielding = false;
  private shoulderStallFor = 0;
  private shoulderBarM = 0;

  constructor(private readonly g: LateralGeometry) {}

  get active(): boolean {
    return this.kind !== null;
  }

  /** A fresh drive: nothing committed, nothing barred. */
  reset(line: number): void {
    this.kind = null;
    this.line = line;
    this.untilS = 0;
    this.crossingBarM = 0;
    this.crossingBarS = 0;
    this.shoulderPassing = false;
    this.shoulderPassSpeed = 0;
    this.shoulderYielding = false;
    this.shoulderStallFor = 0;
    this.shoulderBarM = 0;
  }

  /** The committed line is no longer safe or no longer reachable; the search drives. */
  release(): void {
    this.kind = null;
  }

  /** The committed move keeps going, on a line re-measured this step. */
  retarget(line: number, kind: LateralKind): void {
    if (this.kind === null) return;
    this.line = line;
    this.kind = kind;
  }

  /** Seconds pass for the time half of the barriers; once a step, before any query. */
  tick(dt: number): void {
    if (this.crossingBarS > 0) this.crossingBarS = Math.max(0, this.crossingBarS - dt);
  }

  crossingBarred(travelled: number): boolean {
    return travelled < this.crossingBarM && this.crossingBarS > 0;
  }

  shoulderBarred(travelled: number): boolean {
    return travelled < this.shoulderBarM;
  }

  /**
   * The line to drive this step. See the module comment for the shape of the state;
   * the reasons for each transition are kept beside it.
   */
  step(f: LateralFacts): number {
    const g = this.g;
    // COMING HOME IS A MANOEUVRE TOO, so it goes through the search rather than round
    // it: the lane centre while the body is in that lane, the PRICED line while it is
    // not. Returning the centre outright from another lane is a lane change the search
    // never approved — measured walking straight through the refusal to steer into a
    // car alongside, and into the rock the car had stopped for.
    const held = Math.abs(f.ownLateral - f.laneOffset) > g.carHalfWidth ? f.proposed : f.laneOffset;
    // ROAD THE MANOEUVRE NEEDS, in CLOSING distance, one number for both ends: a move of
    // `d` at `a` takes `2·sqrt(d/a)` seconds, a rock closes at the car's speed and a
    // slower car at the difference, and the line must arrive a body length before the
    // bumper does. A fixed trigger fired with less road left than the move takes at
    // every road speed (cars laid siege to obstructions); a speedometer-timed one began
    // overtakes a lifetime early. The shift is the committed line's while there is one,
    // so neither end moves while the move is in progress.
    const shift = Math.abs((this.kind !== null ? this.line : f.proposed) - f.laneOffset);
    const closing = Math.max(f.speed - Math.max(0, f.laneBlockSpeed), g.minClosing);
    const room = Math.max(
      g.triggerFloor,
      f.passReach,
      closing * 2 * Math.sqrt(shift / Math.max(f.lineAccel, 1e-3)) + g.carHalfLength * 2,
    );

    if (this.kind === null) {
      if (f.mayEnter && Math.abs(f.proposed - f.laneOffset) >= g.detourMin && f.laneBlockDistance < room) {
        this.kind = f.proposedKind;
        this.line = f.proposed;
        this.untilS = f.hintS + g.holdMax;
        return this.line;
      }
      return held;
    }
    // A COMMITTED LINE BELONGS TO THE ROAD IT WAS CHOSEN ON. A line 5.5 m out is the
    // outer lane of a dual carriageway and the desert beside a single one; measured as
    // cars holding lines twenty-four metres out in the sand. Re-decided, not clamped.
    if (Math.abs(this.line) > f.edgeLimit) {
      this.kind = null;
      return held;
    }
    const crosses = this.line * Math.sign(f.laneOffset || -1) < -g.carHalfWidth * 0.5;
    if (crosses) {
      // ON THE WRONG SIDE OF THE ROAD THE COMMITMENT NEVER OUTLIVES ITS PERMISSION:
      // two opposing drivers each committed while the other was far away and met.
      //
      // The search already answers "is every reason to be out here gone" each step,
      // with no memory of the crossing: when its fresh answer is the own lane, the
      // pass is over — waiting for the lane-clear margin below only coasted the crown.
      if (f.proposed === f.laneOffset) {
        this.kind = null;
        return held;
      }
      if (f.crossingRefused || f.headOn) {
        this.kind = null;
        // AND IT STAYS GIVEN UP FOR A WHILE; see the module comment.
        this.crossingBarM = f.travelled + f.retryM;
        this.crossingBarS = f.retryS;
        return held;
      }
    }
    // COMING BACK IS "THE LANE I LEFT IS NO LONGER HOLDING ME UP", NOT "IT IS EMPTY".
    // Inside the own carriageway a lane that still holds something materially slower
    // is being USED, and the commitment is renewed: a driver that came back after one
    // slow car and went straight out round the next is the weave a dual carriageway
    // does not have. A crossing is never held on this — the opposing lane belongs to
    // somebody coming the other way.
    const laneStillSlow =
      !crosses &&
      f.laneBlockDistance < Number.POSITIVE_INFINITY &&
      f.laneBlockSpeed > g.crawl &&
      f.laneBlockSpeed < f.desiredSpeed - g.passAdvantage;
    if (laneStillSlow) this.untilS = f.hintS + g.holdMax;
    const laneIsClear = !(f.laneBlockDistance < room + g.releaseMargin) && !laneStillSlow;
    if (laneIsClear || f.hintS > this.untilS) {
      this.kind = null;
      return held;
    }
    return this.line;
  }

  /**
   * THE VERGE PASS, once the plan has chosen its line. It lasts while the passed car
   * is still alongside, not while the forward probe still sees it.
   *
   * A PASS ON THE VERGE HAS TO BE GAINING. Loose ground costs grip and drag the asphalt
   * does not, and a racer that could not find its advantage sat alongside for twenty
   * seconds with its wheels in the dirt. The gain is judged from the moment the car is
   * out there to gain it (`outOnVerge`) — at the grant it is tucked in at the leader's
   * own speed, and counting the move out spent most of the clock before a pass could
   * start. Stalling for `shoulderStallS` gives the pass up: the caller drops the car
   * below the other one until it is out from alongside, and the verge is barred for
   * `shoulderRetryM` of road.
   */
  stepShoulder(
    granted: boolean,
    onVerge: boolean,
    laneBlockSpeed: number,
    alongsideSpeed: number,
    outOnVerge: boolean,
    speed: number,
    dt: number,
    travelled: number,
  ): void {
    const g = this.g;
    if (granted && laneBlockSpeed > g.crawl && onVerge) {
      this.shoulderPassing = true;
      this.shoulderPassSpeed = laneBlockSpeed;
    } else if (this.shoulderPassing && onVerge && alongsideSpeed < Infinity) {
      this.shoulderPassSpeed = alongsideSpeed;
    } else {
      this.shoulderPassing = false;
    }
    if (!this.shoulderPassing) {
      this.shoulderStallFor = 0;
      this.shoulderYielding = false;
      return;
    }
    if (outOnVerge) {
      this.shoulderStallFor =
        speed - this.shoulderPassSpeed < g.shoulderMinGain ? this.shoulderStallFor + dt : 0;
    }
    if (!this.shoulderYielding && this.shoulderStallFor > g.shoulderStallS) {
      this.shoulderYielding = true;
      this.shoulderBarM = travelled + g.shoulderRetryM;
    }
  }
}
