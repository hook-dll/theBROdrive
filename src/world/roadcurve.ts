import { hashUnit2, Noise1D } from '../core/rng';

/**
 * The road's heading field and the one node recurrence that integrates it.
 *
 * This exists as its own module for a single reason: THREE things integrate the
 * road and they must produce bit-identical doubles. `Road` integrates a block at a
 * time around the player, `buildSpine` integrates the whole road once to snapshot
 * checkpoints, and the spine worker does the same off the main thread. A copy of
 * the recurrence in any of them is a copy that drifts, and a drifted copy means the
 * road built from a checkpoint is a different road from the one built by walking —
 * which shows up as a step in the middle of a chunk seam, not as a compile error.
 *
 * So the recurrence lives here, once, and everything calls it.
 *
 * ---------------------------------------------------------------------------
 * HEADING IS A FUNCTION OF ARCLENGTH, NOT AN INTEGRAL OF ONE
 * ---------------------------------------------------------------------------
 *
 * It used to be the integral of a curvature noise. An integral of zero-mean noise is
 * a random walk, so the heading was unbounded: over 40 000 km it swept 33 full turns,
 * and a curve whose heading covers every direction over and over MUST come back over
 * itself. Measured, 92.5% of the road ran within 1100 m of a part of itself more than
 * 5 km away in arclength, and the closest approach was zero — it crossed. The whole
 * world was one 443 x 223 km bowl with the road scribbled inside it, because the
 * berm and the mountains are functions of distance from the NEAREST PASS of the road
 * (see `Terrain.surroundHeight`) and the scribble's corridors covered their own
 * footprint twice over.
 *
 * Bounding the heading with a restoring force does not work, and it is worth knowing
 * why before anyone tries it again: the restoring term and the corners are the same
 * channel. A pull strong enough to bound a random walk against a curvature reaching
 * 1/170 m is a pull that flattens the corners. Measured at a gain of 4e-6 — already a
 * 250 km-radius turn — the heading still swept 8.5 turns and 93.5% of the road was
 * still merged with itself.
 *
 * So the heading itself is the bounded quantity:
 *
 *     heading(s) = ROUTE_DEVIATION * fbm(s / ROUTE_WAVELENGTH)   <- broad sweep
 *                + turnSequence(seed, s)                          <- actual corners
 *
 * and curvature is its derivative. Two consequences, and the first is a theorem:
 *
 *  1. NO SELF-INTERSECTION. With |heading| < 90 degrees the road's coordinate along
 *     the axis heading 0 has d/ds = cos(heading) > 0, so it is strictly increasing. A
 *     curve whose projection onto an axis is strictly monotone cannot cross itself.
 *     Better, it is a separation bound rather than a mere absence of crossings: two
 *     points a metres apart in arclength are at least `a * cos(max deviation)` apart
 *     on the ground. `tools/road-selfcross.ts` is the acceptance test.
 *
 *  2. THE RECURRENCE CARRIES NO HEADING. Only x and z accumulate, so heading cannot
 *     drift between the three integrators at all — the hazard this module was built
 *     to contain is reduced to two numbers.
 *
 * WHAT IT COSTS, because it is not free. Over one single-sign run the heading can
 * only travel from -D to +D, so `sweeper length * curvature <= 2 * D`: a bounded road
 * cannot hold a tight radius for kilometres. The old road's 4.7 km single-sign runs
 * turned the heading through 557 degrees — those "long sweepers" WERE the corkscrew
 * that made it cross itself, and they cannot survive.
 *
 * The replacement separates slow route sweep from authored turn sequences. The
 * earlier gated-noise corner term could satisfy a minimum-radius probe at one tiny
 * patch while remaining near zero through the kilometres a player actually saw.
 * Alternating seeded bearings instead guarantee a meaningful heading change in every
 * section, then hold that bearing long enough to leave a real straight or sweeper.
 */

/** Spacing between integration nodes. Small enough that 4 m chords read as curved. */
export const NODE_SPACING = 4;
/**
 * Tight-corner target, metres.
 *
 * Radius alone was the wrong goal. An 85 m curvature spike can make a probe happy
 * while the road before and after it keeps almost the same bearing — exactly the
 * straight aerial view reported from play. A turn now has TWO authored dimensions:
 * 85-140 m peak radius and 25-60 degrees of accumulated heading change.
 *
 * The no-crossing theorem still owns the hard limit. Broad route sweep spends
 * 0.95 rad and a turn bearing spends at most 0.52 rad, for 1.47 rad (84.2 degrees)
 * total: below 90 degrees, so forward progress remains strictly positive.
 */
export const MIN_CORNER_RADIUS = 85;

/**
 * THE ROUTE TERM: where the road goes.
 *
 * `ROUTE_DEVIATION` is the main deviation budget, and the no-crossing guarantee
 * rests on the sum of it and the corner deviation staying below 90 degrees. Two
 * low-gain octaves work only at the kilometre scale: this term sweeps rather than
 * corners.
 */
const ROUTE_DEVIATION = 0.95;
const ROUTE_WAVELENGTH = 1600;
const ROUTE_OCTAVES = 2;
const ROUTE_GAIN = 0.25;

/**
 * AUTHORED TURN SEQUENCES: a real change of bearing, not curvature noise.
 *
 * Each 1.7 km section transitions from one signed bearing to the opposite sign.
 * Seeded magnitudes vary from 0.22 to 0.52 rad, so even the smallest transition is
 * 0.44 rad / 25.2 degrees and the largest is 1.04 rad / 59.6 degrees. Alternating
 * signs guarantee the turn; seeded timing, angle and radius stop the cadence reading
 * like a metronome.
 *
 * A quintic smootherstep supplies entry, one peak-curvature apex and exit with zero
 * curvature at both ends. Its maximum derivative is 1.875, so choosing transition
 * length as `1.875 * headingChange * radius` makes the requested 85-140 m peak radius
 * true by construction. The remaining section holds its new bearing as a straight or
 * broad route-driven sweeper.
 */
const TURN_SECTION_LENGTH = 1700;
const TURN_MIN_HEADING = 0.22;
const TURN_MAX_HEADING = 0.52;
const TURN_START_MIN = 250;
const TURN_START_MAX = 700;
const TURN_RADIUS_MAX = 140;
const SMOOTHERSTEP_MAX_SLOPE = 1.875;

function smootherstep01(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** First stretch out of the house is dead straight, for the garage exit. */
const STRAIGHT_RUNOUT = 260;

/**
 * Half-step used to differentiate the heading into a curvature. Half a node, so the
 * value it reports is the average bend across the segment the geometry is built from
 * rather than a point value the mesh never sees.
 */
const CURVATURE_STEP = NODE_SPACING * 0.5;

/**
 * Heading at arclength s, radians, and its derivative.
 *
 * Ramped in over the runout so the road leaves the house on the trunk bearing — which
 * is heading zero, i.e. +Z — and then blends into the full heading field.
 */
export class RoadHeading {
  private readonly route: Noise1D;
  private readonly turnMagnitudeSeed: number;
  private readonly turnTimingSeed: number;
  private readonly turnRadiusSeed: number;
  private readonly turnParity: number;

  constructor(seed: number) {
    const s = seed >>> 0;
    this.route = new Noise1D(s ^ 0x9e3779b9);
    this.turnMagnitudeSeed = (s ^ 0x3c6ef372) >>> 0;
    this.turnTimingSeed = (s ^ 0x85ebca6b) >>> 0;
    this.turnRadiusSeed = (s ^ 0xc2b2ae35) >>> 0;
    this.turnParity = s & 1;
  }

  private turnTarget(section: number): number {
    const magnitude =
      TURN_MIN_HEADING +
      (TURN_MAX_HEADING - TURN_MIN_HEADING) *
        hashUnit2(this.turnMagnitudeSeed, section);
    return ((section + this.turnParity) & 1) === 0 ? magnitude : -magnitude;
  }

  private turnAt(s: number): number {
    const section = Math.floor(s / TURN_SECTION_LENGTH);
    const local = s - section * TURN_SECTION_LENGTH;
    const from = this.turnTarget(section - 1);
    const to = this.turnTarget(section);
    const start =
      TURN_START_MIN +
      (TURN_START_MAX - TURN_START_MIN) * hashUnit2(this.turnTimingSeed, section);
    const radius =
      MIN_CORNER_RADIUS +
      (TURN_RADIUS_MAX - MIN_CORNER_RADIUS) * hashUnit2(this.turnRadiusSeed, section);
    const length = SMOOTHERSTEP_MAX_SLOPE * Math.abs(to - from) * radius;

    if (local <= start) return from;
    if (local >= start + length) return to;
    const blend = smootherstep01((local - start) / length);
    return from + (to - from) * blend;
  }

  at(s: number): number {
    const ramp = Math.min(1, Math.max(0, (s - STRAIGHT_RUNOUT) / STRAIGHT_RUNOUT));
    const route =
      this.route.fbm(s / ROUTE_WAVELENGTH, ROUTE_OCTAVES, 2.1, ROUTE_GAIN) * ROUTE_DEVIATION;
    return (route + this.turnAt(s)) * ramp;
  }

  /**
   * Signed curvature, radians per metre, by central difference on the heading.
   *
   * Differenced rather than duplicated analytically because the heading combines the
   * slow noise field, the runout clamp and seeded smootherstep transitions. Camber and
   * the HUD are the only consumers and neither can tell the difference.
   */
  curvatureAt(s: number): number {
    return (this.at(s + CURVATURE_STEP) - this.at(s - CURVATURE_STEP)) / (2 * CURVATURE_STEP);
  }
}

/**
 * One integration node, carried between steps. Mutated in place by `stepNode`, which
 * is called ten million times for a 40 000 km spine walk and must not allocate.
 *
 * No heading: it is a function of arclength now, so a node cannot carry a stale one
 * and a checkpoint has nothing to store but a position.
 */
export interface NodeState {
  x: number;
  z: number;
}

/**
 * Advances `node` from integration index `i` to `i + 1`.
 *
 * Midpoint rule: the heading is taken at the segment's centre, which is second-order
 * accurate and matters over ten million nodes. It used to average the headings at the
 * two ends, which is the same rule reached the long way round when heading had to be
 * integrated alongside position; with an analytic heading the centre is available
 * directly. Only XZ is integrated — elevation is READ from the landscape at the
 * node's own position, so it carries no state and cannot drift.
 */
export function stepNode(node: NodeState, heading: RoadHeading, i: number): void {
  const h = heading.at(i * NODE_SPACING + CURVATURE_STEP);
  node.x += Math.sin(h) * NODE_SPACING;
  node.z += Math.cos(h) * NODE_SPACING;
}
