/**
 * WHAT A TRAFFIC DRIVER IS DOING, AND WHICH RULE IS HOLDING IT BACK.
 *
 * The driver used to be a stack of independent caps — sixteen `Math.min` on the
 * target speed, a parallel stack on the pedal — none of which knew what the car was
 * in the middle of. A rule written for one situation then quietly broke another:
 * the racer's lift for a lane change (a stability rule keyed on the line moving
 * across the road) took the power away from a pass on the verge whose whole
 * condition of success is gaining speed, and the pass gave itself up every time.
 *
 * Two things fix that class of bug:
 *  - the MANOEUVRE is decided once a step, from the planner's committed state, and
 *    every later rule that has an opinion about acceleration or speed reads it
 *    instead of re-deriving it from its own signal;
 *  - every limit on the same output goes through one ARBITER that records which
 *    named rule is binding, so a conflict is a readable fact (`Autopilot.binding*`)
 *    rather than a behaviour to be reverse-engineered from play.
 */

export type Manoeuvre =
  /** The stuck-recovery ladder owns the car. */
  | 'recover'
  /** Backing a little to give the car in front room for its own escape. */
  | 'make-room'
  /** Body off the road; getting back onto it. */
  | 'offroad'
  /** Pulling over or stopped out of a haboob. */
  | 'shelter'
  /** Waiting for the opposing lane to clear before going round something. */
  | 'yield'
  /** Overtaking a moving car through the opposing lane. */
  | 'pass-oncoming'
  /** Overtaking a moving car with the body out on the verge (frantic). */
  | 'pass-shoulder'
  /** Threading between a queue and the oncoming stream (frantic). */
  | 'pass-middle'
  /** Off the home lane round something: a prop, a stopped car, a slower lane. */
  | 'bypass'
  /** Held to a car in front. */
  | 'follow'
  | 'cruise';

/** True for the manoeuvres whose success is measured in speed gained on another car. */
export function isPass(m: Manoeuvre): boolean {
  return m === 'pass-oncoming' || m === 'pass-shoulder' || m === 'pass-middle';
}

export interface ManoeuvreState {
  readonly recovering: boolean;
  readonly offRoad: boolean;
  readonly sheltering: boolean;
  readonly yielding: boolean;
  readonly shoulderPassing: boolean;
  readonly middlePassing: boolean;
  readonly oncomingPassing: boolean;
  readonly offHomeLine: boolean;
  readonly following: boolean;
}

/** One answer per step, in priority order: who owns the car decides what it is doing. */
export function classifyManoeuvre(s: ManoeuvreState): Manoeuvre {
  if (s.recovering) return 'recover';
  if (s.offRoad) return 'offroad';
  if (s.sheltering) return 'shelter';
  if (s.shoulderPassing) return 'pass-shoulder';
  if (s.middlePassing) return 'pass-middle';
  if (s.oncomingPassing) return 'pass-oncoming';
  if (s.yielding) return 'yield';
  if (s.offHomeLine) return 'bypass';
  if (s.following) return 'follow';
  return 'cruise';
}

/** Named limits on the target speed; see `LimitArbiter`. */
export type SpeedLimitSource =
  | 'road'
  | 'sight'
  | 'speed-cap'
  | 'manoeuvre'
  | 'corridor-block'
  | 'follow'
  | 'lane-clearance'
  | 'squeeze'
  | 'pass-shoulder'
  | 'pass-middle'
  | 'verge'
  | 'inadmissible'
  | 'hold-line'
  | 'shelter'
  | 'offroad'
  | 'turned-away'
  | 'edge-stability'
  | 'contact';

/** Named limits on the throttle pedal; see `LimitArbiter`. */
export type ThrottleLimitSource =
  | 'speed-error'
  | 'friction-circle'
  | 'racer-lift'
  | 'racer-feed'
  | 'bend-entry'
  | 'offroad'
  | 'edge-stability'
  | 'contact'
  | 'emergency'
  | 'hold'
  | 'rollback'
  | 'engine-off';

/**
 * The least of a set of named upper limits, and which one it is. `limit` is the old
 * `Math.min`; `atLeast` the rare floor, which leaves the source alone because a floor
 * is not a rule holding the car back.
 */
export class LimitArbiter<S extends string> {
  value = Infinity;
  source: S;

  constructor(initial: S) {
    this.source = initial;
  }

  reset(value: number, source: S): number {
    this.value = value;
    this.source = source;
    return value;
  }

  limit(value: number, source: S): number {
    if (value < this.value) {
      this.value = value;
      this.source = source;
    }
    return this.value;
  }

  /** A floor. It does not change the source: a floor is not a rule holding the car back. */
  atLeast(value: number): number {
    if (value > this.value) this.value = value;
    return this.value;
  }
}
