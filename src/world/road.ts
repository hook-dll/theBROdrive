import { Noise1D } from '../core/rng';
import { Landscape } from './landscape';

/**
 * The road is the spine of the world.
 *
 * It is generated as an arclength-parameterised curve. Curvature is a smooth noise
 * function of distance travelled and the centreline is integrated forward from the
 * house at s = 0; elevation is not the road's own at all, but the `Landscape` field's
 * value under the centreline. Everything else in the world (terrain height, chunk
 * streaming, prop placement, save games) is indexed by that same `s`, not by world
 * XZ.
 *
 * Consequences worth knowing:
 *  - "turns often but smoothly" is one curvature amplitude, not authored geometry
 *  - the road's grade is whatever the landscape does along its tangent; there is no
 *    grade noise, and no elevation state that could drift
 *  - heading is the integral of that curvature, so it random-walks: over 400 km the
 *    road winds through several full turns and passes close to its own path. That
 *    used to matter enormously, because the desert took its height from the nearest
 *    pass of the road and two passes were hundreds of metres apart in altitude. It
 *    no longer does: both passes sit on the same landscape, at the same height, and
 *    the streamer never has two branches loaded at once (they are kilometres apart in
 *    `s`, and only ±1200 m is alive). Bounding the heading to forbid the crossing
 *    outright was tried and reverted — it doubled the direction-change rate to keep
 *    the corner radius, because bounded heading cannot sustain a curvature
 *  - the road has a real end at `length`, reached only after a very long drive
 *  - integration is sequential from s = 0, so nodes are built lazily and cached
 *  - generation is pure: same seed, same road, on any machine (see NETPLAY notes)
 */

/** Half-width of the driving surface. 3.3 m gives two genuinely narrow lanes. */
export const ROAD_HALF_WIDTH = 3.3;
/** Gravel shoulder either side of the asphalt. */
export const SHOULDER_WIDTH = 1.4;
/** Spacing between integration nodes. Small enough that 4 m chords read as curved. */
export const NODE_SPACING = 4;
/** Total road length in metres. At 90 km/h this is roughly 4.5 hours of driving. */
export const ROAD_LENGTH = 400_000;

/** Tightest corner radius in metres. Sets the curvature amplitude. */
export const MIN_CORNER_RADIUS = 170;
/** Distance over which curvature varies. Long = sweeping, short = twitchy. */
const CURVATURE_WAVELENGTH = 520;
/** First stretch out of the house is dead straight, for the garage exit. */
const STRAIGHT_RUNOUT = 260;

export interface RoadSample {
  /** Arclength along the road, metres from the house. */
  s: number;
  x: number;
  y: number;
  z: number;
  /** Direction of travel in the XZ plane, radians. 0 points down +Z. */
  heading: number;
  /** dy/ds at this point. Positive is uphill. */
  grade: number;
  /** dheading/ds at this point, radians per metre. Positive turns right. */
  curvature: number;
}

export interface RoadProjection {
  /** Arclength of the closest point on the centreline. */
  s: number;
  /** Signed distance from the centreline. Positive is LEFT of travel; see `offsetPoint`. */
  lateral: number;
  /** Centreline height at `s`. */
  height: number;
}

export class Road {
  readonly length = ROAD_LENGTH;
  readonly seed: number;

  /** The elevation field the road lies on. Public: the terrain reads the same one. */
  readonly landscape: Landscape;

  private readonly curveNoise: Noise1D;

  // Parallel arrays of integrated nodes; index i corresponds to s = i * NODE_SPACING.
  private readonly xs: number[] = [0];
  private readonly ys: number[] = [0];
  private readonly zs: number[] = [0];
  private readonly headings: number[] = [0];

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.landscape = new Landscape(this.seed);
    this.curveNoise = new Noise1D(this.seed ^ 0x9e3779b9);
  }

  /**
   * Curvature at arclength s, radians per metre. Ramped in over the runout so the
   * road leaves the house straight, then blends into noise-driven corners.
   */
  curvatureAt(s: number): number {
    const ramp = Math.min(1, Math.max(0, (s - STRAIGHT_RUNOUT) / STRAIGHT_RUNOUT));
    return (this.curveNoise.fbm(s / CURVATURE_WAVELENGTH, 3, 2.1, 0.42) / MIN_CORNER_RADIUS) * ramp;
  }

  /**
   * How hilly the country is at `s`, 0..1. Delegates to the landscape, because
   * hilliness is a property of the ground the road crosses, not of the arclength.
   */
  hillinessAt(s: number): number {
    const c = this.sampleAt(s);
    return this.landscape.hillinessAt(c.x, c.z);
  }

  /**
   * Integrates nodes forward until index `target` exists. Cheap and idempotent.
   *
   * Only XZ is integrated. Elevation is READ from the landscape at the node's own
   * position, so it carries no state and cannot drift: two nodes over the same
   * ground are at the same height whatever their arclength.
   */
  private ensureIndex(target: number): void {
    for (let i = this.xs.length - 1; i < target; i++) {
      // Midpoint rule: sampling curvature at the segment centre keeps the integrated
      // heading second-order accurate, which matters over 100k nodes.
      const sMid = i * NODE_SPACING + NODE_SPACING * 0.5;
      const heading = this.headings[i]! + this.curvatureAt(sMid) * NODE_SPACING;
      const midHeading = (this.headings[i]! + heading) * 0.5;
      const x = this.xs[i]! + Math.sin(midHeading) * NODE_SPACING;
      const z = this.zs[i]! + Math.cos(midHeading) * NODE_SPACING;
      this.xs.push(x);
      this.zs.push(z);
      this.ys.push(this.landscape.heightAt(x, z));
      this.headings.push(heading);
    }
  }

  /**
   * Centreline state at arclength `s`, clamped to the road's extent.
   *
   * Position is interpolated with a cubic Hermite between nodes using the node
   * headings as tangents, so the sampled curve is C1 even though the underlying
   * nodes are 4 m apart. Linear interpolation here shows up as visible faceting.
   */
  sampleAt(s: number): RoadSample {
    const clamped = Math.min(Math.max(s, 0), this.length);
    const fi = clamped / NODE_SPACING;
    const i = Math.min(Math.floor(fi), Math.floor(this.length / NODE_SPACING) - 1);
    this.ensureIndex(i + 1);
    const t = fi - i;

    const h0 = this.headings[i]!;
    const h1 = this.headings[i + 1]!;

    // Hermite basis over the unit interval, tangents scaled to segment length.
    const t2 = t * t;
    const t3 = t2 * t;
    const b0 = 2 * t3 - 3 * t2 + 1;
    const m0 = t3 - 2 * t2 + t;
    const b1 = -2 * t3 + 3 * t2;
    const m1 = t3 - t2;

    return {
      s: clamped,
      x:
        b0 * this.xs[i]! +
        m0 * Math.sin(h0) * NODE_SPACING +
        b1 * this.xs[i + 1]! +
        m1 * Math.sin(h1) * NODE_SPACING,
      y: this.ys[i]! + (this.ys[i + 1]! - this.ys[i]!) * t,
      z:
        b0 * this.zs[i]! +
        m0 * Math.cos(h0) * NODE_SPACING +
        b1 * this.zs[i + 1]! +
        m1 * Math.cos(h1) * NODE_SPACING,
      heading: h0 + (h1 - h0) * t,
      // The grade the driver actually rides: the slope of the interpolated y, which
      // is linear across the segment. Differencing the nodes is therefore exact,
      // where re-evaluating the landscape here would not match the geometry.
      grade: (this.ys[i + 1]! - this.ys[i]!) / NODE_SPACING,
      curvature: this.curvatureAt(clamped),
    };
  }

  /**
   * A point offset laterally from the centreline.
   *
   * CONVENTION, and it is a trap: positive `lateral` is to the **left** of the
   * travel direction, not the right. Forward is (sin h, cos h) and up is +Y, so true
   * right is forward x up = (-cos h, sin h); the vector used below is its negation.
   * The sign is kept this way deliberately because the road ribbon and terrain grids
   * are built by walking `lateral` and their triangle winding depends on it —
   * flipping it here inverts every road normal. Anything that cares which side of
   * the road it sits on must negate, as the pole line does.
   */
  offsetPoint(s: number, lateral: number, out?: { x: number; y: number; z: number }) {
    const c = this.sampleAt(s);
    const target = out ?? { x: 0, y: 0, z: 0 };
    target.x = c.x + Math.cos(c.heading) * lateral;
    target.y = c.y;
    target.z = c.z - Math.sin(c.heading) * lateral;
    return target;
  }

  /**
   * Finds the closest centreline point to a world XZ position.
   *
   * `hintS` should be the previous result for the same entity; the search then
   * costs a handful of samples. Without a hint this sweeps the whole road, which is
   * slow — never call it per-frame without a hint.
   */
  project(x: number, z: number, hintS?: number): RoadProjection {
    let bestS = 0;
    let bestDist = Infinity;

    if (hintS === undefined) {
      for (let s = 0; s <= this.length; s += 250) {
        const c = this.sampleAt(s);
        const d = (c.x - x) ** 2 + (c.z - z) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestS = s;
        }
      }
    } else {
      bestS = Math.min(Math.max(hintS, 0), this.length);
      const c = this.sampleAt(bestS);
      bestDist = (c.x - x) ** 2 + (c.z - z) ** 2;
    }

    // Refine by successively halving the search window around the best guess.
    let window = hintS === undefined ? 250 : 90;
    while (window > 0.05) {
      for (const s of [bestS - window, bestS + window]) {
        if (s < 0 || s > this.length) continue;
        const c = this.sampleAt(s);
        const d = (c.x - x) ** 2 + (c.z - z) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestS = s;
        }
      }
      window *= 0.5;
    }

    const c = this.sampleAt(bestS);
    return {
      s: bestS,
      // Same basis as `offsetPoint`, so positive is LEFT of travel. See its comment.
      lateral: (x - c.x) * Math.cos(c.heading) + (z - c.z) * -Math.sin(c.heading),
      height: c.y,
    };
  }
}
