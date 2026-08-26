import { Noise1D } from '../core/rng';

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
 *     heading(s) = ROUTE_DEVIATION * fbm(s / ROUTE_WAVELENGTH)   <- where it goes
 *                + corner(s) * noise(s / CORNER_WAVELENGTH)      <- how it bends
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
 * that made it cross itself, and they cannot survive. What replaces them is the
 * two-term split below: the route term spends the deviation budget on where the road
 * goes, and a short-wavelength gated term buys tight corners almost free, because
 * budget is spent by amplitude while curvature is bought by amplitude over
 * wavelength. Measured against the old road, the direction-change rate and sweeper
 * length remain in the same order while the heading stays bounded.
 */

/** Spacing between integration nodes. Small enough that 4 m chords read as curved. */
export const NODE_SPACING = 4;
/** Tight-corner target, metres. The gated term is tuned around this value. */
export const MIN_CORNER_RADIUS = 170;

/**
 * THE ROUTE TERM: where the road goes.
 *
 * `ROUTE_DEVIATION` is the main deviation budget, and the no-crossing guarantee
 * rests on the sum of it and the corner deviation staying below 90 degrees. Two
 * low-gain octaves work only at the kilometre scale: this term sweeps rather than
 * corners.
 */
const ROUTE_DEVIATION = 1.15;
const ROUTE_WAVELENGTH = 1600;
const ROUTE_OCTAVES = 2;
const ROUTE_GAIN = 0.25;
/** Worst curvature the route term can contribute, including its second octave. */
const ROUTE_CURVATURE_BOUND =
  (ROUTE_DEVIATION * 3.75 / ROUTE_WAVELENGTH) *
  ((1 + ROUTE_GAIN * 2.1) / (1 + ROUTE_GAIN));

/**
 * THE CORNER TERM: how the road bends.
 *
 * Short wavelength, small amplitude, and GATED so it is not always there. Ungated
 * it triples the direction-change rate — twitchy, and exactly the failure the
 * earlier bounded-heading attempt was reverted for. The slow gate makes tight
 * corners occasional instead.
 *
 * The corner amplitude is small in heading space — 0.23 rad — but divided by
 * 190 m it can still buy the old road's tightest bends. Its theoretical derivative
 * can add to the route term in a pathological alignment and briefly beat the target;
 * the acceptance bench therefore checks the REAL field over several seeds, where
 * the floor is 150 m and typical minima land around the authored 170 m.
 */
const CORNER_WAVELENGTH = 190;
const CORNER_DEVIATION = 0.23;
/** Gate field wavelength, metres: how far apart the tight corners are. */
const CORNER_GATE_WAVELENGTH = 9000;
/** Gate threshold. Higher = rarer, sharper corners. */
const CORNER_GATE = 0.6;

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
 * is heading zero, i.e. +Z — and then blends into the noise.
 */
export class RoadHeading {
  private readonly route: Noise1D;
  private readonly corner: Noise1D;
  private readonly gate: Noise1D;

  constructor(seed: number) {
    const s = seed >>> 0;
    this.route = new Noise1D(s ^ 0x9e3779b9);
    this.corner = new Noise1D(s ^ 0x3c6ef372);
    this.gate = new Noise1D(s ^ 0x85ebca6b);
  }

  at(s: number): number {
    const ramp = Math.min(1, Math.max(0, (s - STRAIGHT_RUNOUT) / STRAIGHT_RUNOUT));
    const route =
      this.route.fbm(s / ROUTE_WAVELENGTH, ROUTE_OCTAVES, 2.1, ROUTE_GAIN) * ROUTE_DEVIATION;
    // Gate in [0, 1]: the field's excess over the threshold, rescaled. Below it the
    // corner term is exactly zero, so most of the road is pure route.
    const open = Math.max(0, (this.gate.at(s / CORNER_GATE_WAVELENGTH) - CORNER_GATE)) /
      (1 - CORNER_GATE);
    const corner = open * CORNER_DEVIATION * this.corner.at(s / CORNER_WAVELENGTH);
    return (route + corner) * ramp;
  }

  /**
   * Signed curvature, radians per metre, by central difference on the heading.
   *
   * Differenced rather than differentiated analytically because the heading is a sum
   * of three noise fields with a clamp and a ramp in it, and the analytic derivative
   * of that is four more expressions to keep in step with `at`. The camber and the
   * HUD are the only consumers and neither can tell the difference.
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
