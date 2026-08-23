import { Noise1D } from '../core/rng';

/**
 * The road is the spine of the world.
 *
 * It is generated as an arclength-parameterised curve: curvature and grade are
 * smooth noise functions of distance travelled, integrated forward from the house
 * at s = 0. Everything else in the world (terrain height, chunk streaming, prop
 * placement, save games) is indexed by that same `s`, not by world XZ.
 *
 * Consequences worth knowing:
 *  - "turns often but smoothly" is one curvature amplitude, not authored geometry
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
const MIN_CORNER_RADIUS = 170;
/** Distance over which curvature varies. Long = sweeping, short = twitchy. */
const CURVATURE_WAVELENGTH = 520;
/**
 * Elevation, in three layers, because one noise band cannot be both "a hill you
 * crest" and "country that is flat for a while".
 *
 * Two rounds of tuning happened here, and the second is the important one. The
 * original was a single 1400 m band at 5.5% max: ~4 m of relief over a kilometre,
 * which is not level but reads as dead flat. Widening it to three bands at 10% max
 * got the relief up (230 m over 60 km) yet still looked flat from the seat, because
 * what the driver actually sees is the GRADE UNDER THE BONNET, not the total
 * relief, and a mean of 2% is a third of a degree of pitch.
 *
 * So the bands are sized by what they do to the view instead:
 *
 *  - ROLL, 340 m crest to crest, is the band you feel. At 340 m and 9% the road
 *    rises about 5 m between trough and crest — more than eye height, so the far
 *    side genuinely disappears — and a crest arrives every ten seconds at 90 km/h.
 *  - SWELL, 3 km, is the landscape: tens of metres of rise and fall that the
 *    rolling band sits on, so hills are not a corrugation on a table.
 *  - HILLINESS gates both over 8 km, so a seed gives hill country here and open
 *    basin there, and crossing between them takes minutes of driving.
 *
 * MAX_GRADE bounds the sum of the two bands. 12% is steep for a real two-lane and
 * deliberately at the edge of what this catalogue pulls: measured in-game, the
 * saloon climbs a sustained 9% at 55-70 km/h in third and needs second only past
 * 11%. Anything gentler than this does not read as hills at all.
 */
const MAX_GRADE = 0.12;
/** Rolling band: crest-to-crest distance of the hills you actually drive over. */
const GRADE_ROLL_WAVELENGTH = 340;
/** Its share of the grade budget. */
const GRADE_ROLL_WEIGHT = 0.95;
/** Swell band: the long rise and fall the rolling band rides on. */
const GRADE_SWELL_WAVELENGTH = 3000;
const GRADE_SWELL_WEIGHT = 0.5;
/**
 * Amplification applied to the summed bands before clamping (see `gradeAt`). Value
 * noise clusters near zero; without this the road's mean grade is a third of a
 * degree.
 */
const GRADE_GAIN = 2.1;
/** How far you drive before flat country becomes hill country, metres. */
const HILLINESS_WAVELENGTH = 8000;
/**
 * Grade fraction kept in the flattest country. Not small: even the flat stretches
 * should breathe, or the contrast makes them read as broken rather than flat.
 */
const HILLINESS_FLOOR = 0.42;
/** First stretch out of the house is dead straight and flat, for the garage exit. */
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

  private readonly curveNoise: Noise1D;
  private readonly gradeNoise: Noise1D;
  private readonly swellNoise: Noise1D;
  private readonly hillNoise: Noise1D;

  // Parallel arrays of integrated nodes; index i corresponds to s = i * NODE_SPACING.
  private readonly xs: number[] = [0];
  private readonly ys: number[] = [0];
  private readonly zs: number[] = [0];
  private readonly headings: number[] = [0];

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.curveNoise = new Noise1D(this.seed ^ 0x9e3779b9);
    this.gradeNoise = new Noise1D(this.seed ^ 0x85ebca6b);
    this.swellNoise = new Noise1D(this.seed ^ 0xc2b2ae3d);
    this.hillNoise = new Noise1D(this.seed ^ 0x27d4eb2f);
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
   * How hilly the country is at `s`, 0..1. Its own noise band, an order of
   * magnitude longer than the hills it gates, so the landscape has regions.
   */
  hillinessAt(s: number): number {
    const n = this.hillNoise.fbm(s / HILLINESS_WAVELENGTH, 2, 2, 0.5);
    // Value noise clusters near zero, so widen before clamping or almost every
    // stretch lands mid-scale and the regions all feel the same.
    const t0 = Math.min(1, Math.max(0, 0.5 + n * 1.35));
    const t = t0 * t0 * (3 - 2 * t0);
    return HILLINESS_FLOOR + (1 - HILLINESS_FLOOR) * t;
  }

  /**
   * Grade at arclength s, dy/ds. Rolling band plus long swell, amplified, clamped,
   * gated by hilliness and ramped in over the runout.
   *
   * GRADE_GAIN is why this reads as hills. Value-noise fbm spends almost all its
   * time near zero — the raw sum averages about 0.3 of its own range — so feeding
   * it straight into MAX_GRADE produced a mean grade of 2% and a road that measured
   * hilly and looked flat. Amplifying and then clamping trades the rare peak for
   * sustained climbs and descents at real gradients, which is what a road through
   * hills actually is: long pulls at a steady 8%, not a sine wave.
   */
  gradeAt(s: number): number {
    const ramp = Math.min(1, Math.max(0, (s - STRAIGHT_RUNOUT) / (STRAIGHT_RUNOUT * 2)));
    const roll = this.gradeNoise.fbm(s / GRADE_ROLL_WAVELENGTH, 3, 2.1, 0.45) * GRADE_ROLL_WEIGHT;
    const swell = this.swellNoise.fbm(s / GRADE_SWELL_WAVELENGTH, 2, 2, 0.5) * GRADE_SWELL_WEIGHT;
    const shape = Math.min(1, Math.max(-1, (roll + swell) * GRADE_GAIN));
    return shape * MAX_GRADE * this.hillinessAt(s) * ramp;
  }

  /** Integrates nodes forward until index `target` exists. Cheap and idempotent. */
  private ensureIndex(target: number): void {
    for (let i = this.xs.length - 1; i < target; i++) {
      // Midpoint rule: sampling curvature and grade at the segment centre keeps the
      // integrated heading second-order accurate, which matters over 100k nodes.
      const sMid = i * NODE_SPACING + NODE_SPACING * 0.5;
      const heading = this.headings[i]! + this.curvatureAt(sMid) * NODE_SPACING;
      const midHeading = (this.headings[i]! + heading) * 0.5;
      this.xs.push(this.xs[i]! + Math.sin(midHeading) * NODE_SPACING);
      this.zs.push(this.zs[i]! + Math.cos(midHeading) * NODE_SPACING);
      this.ys.push(this.ys[i]! + this.gradeAt(sMid) * NODE_SPACING);
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
      grade: this.gradeAt(clamped),
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
