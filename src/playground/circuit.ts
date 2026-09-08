import { Landscape } from '../world/landscape';

/**
 * A CLOSED test circuit, for driving and autopilot work.
 *
 * The game's road is a 40 000 km arclength-parameterised line with a bounded
 * heading: by construction it cannot turn back on itself, so it can never be a lap.
 * That is right for the world and useless for testing a controller, where what you
 * want is the same hairpin, the same crest and the same chicane again in ninety
 * seconds, without driving anywhere to find them.
 *
 * So this is a SEPARATE geometry, in its own module, and `world/road.ts` and
 * `world/roadspine.ts` are untouched by it. What it shares with the real world is
 * everything that decides how a car behaves: the same `Landscape` supplies the
 * elevation under the centreline, so grades are real terrain rather than an authored
 * profile, and `PlaygroundRoad` (playgroundroad.ts) presents the circuit through the
 * same four geometric methods `Vehicle`, `Autopilot` and `roadSurfaceY` already use.
 * Nothing in the game bundle depends on this file; the dev scene and the lap bench do.
 *
 * LAYOUT, clockwise from the start line, and every feature is here because it asks
 * the controller a different question:
 *
 *   1. main straight        — does it use the power it has?
 *   2. fast right sweeper   — does it hold a line at speed?
 *   3. back straight        — acceleration and braking distance
 *   4. hairpin              — the tightest radius it will ever meet
 *   5. esses                — two direction changes with no straight to settle in
 *   6. long right onto the start line
 *
 * CLOSURE is solved, not authored. A hand-written sequence of arcs and straights
 * almost never returns to its own start, and a lap with a kink in it would be a
 * permanent lie in every measurement taken on it. The heading budget is exactly one
 * turn by construction; the two remaining degrees of freedom (the position residual)
 * are removed by Newton on two segment lengths, and the constructor refuses a
 * circuit that does not close to a millimetre.
 */

/** Half-width of the playground asphalt. Same as the real road, deliberately. */
export const CIRCUIT_HALF_WIDTH = 2.9;

/** Centreline sampling step, metres. The table is small enough to keep whole. */
const SAMPLE_STEP = 1;
/** Fall from the crown to the edge of the asphalt, metres. */
const CROWN_DROP = 0.06;
/**
 * Where the lap sits in the world, and therefore what its hills are: the centreline
 * elevation is the landscape's, so moving the circuit gives it a different set of
 * grades.
 *
 * THE SITE IS CHOSEN FOR RELIEF, and the first one was not. Measured over 200 km of
 * the real road at this seed, the game's grades run mean 5.0%, p95 12.5%, p99 14.6%,
 * worst 18.8%. The original spot was picked for "no cliffs" and delivered 1.5% mean
 * and 4.4% worst — a billiard table, which is the one thing a driving test track
 * must not be, because grade is what decides whether the car has the power to hold
 * its line and whether it can brake at all on the way down.
 *
 * This spot came out of a scan of a 24 km square for the hilliest lap with nothing
 * steeper than 30% in it: mean 11%, 14.3% at its steepest, 151 m of climb and
 * descent per lap. That sits in the real road's own p95-p99 band, so the autopilot
 * meets the grades it actually has to work on. Shared by the bench and the dev scene
 * so both drive the same hills.
 */
export const PLAYGROUND_ORIGIN_X = -4_500;
export const PLAYGROUND_ORIGIN_Z = -12_000;

/**
 * One authored piece of the lap. `radius` is signed: positive turns right (toward
 * increasing heading, matching the road's `heading` convention where forward is
 * `(sin h, cos h)`), negative turns left, and `Infinity` is a straight.
 */
interface Piece {
  readonly name: string;
  /** Metres for a straight; metres of arc for a curve. */
  readonly length: number;
  readonly radius: number;
}

/** A named stretch of the lap, for teleports and per-sector telemetry. */
export interface CircuitSector {
  readonly name: string;
  readonly startS: number;
  readonly endS: number;
  /** Signed design radius, metres; `Infinity` on a straight. */
  readonly radius: number;
}

export interface CircuitSample {
  readonly s: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly grade: number;
  readonly curvature: number;
}

interface Walk {
  x: number;
  z: number;
  heading: number;
}

/**
 * Exact integration of one piece. A straight is a step along the heading; an arc of
 * signed radius r turns by `length / r` and steps along the chord, so no piece is
 * approximated by sampling and the closure residual is the geometry's own.
 */
function advance(walk: Walk, length: number, radius: number): void {
  if (!Number.isFinite(radius)) {
    walk.x += Math.sin(walk.heading) * length;
    walk.z += Math.cos(walk.heading) * length;
    return;
  }
  const turn = length / radius;
  const h0 = walk.heading;
  const h1 = h0 + turn;
  // Centre of the arc is `radius` to the right of travel (see `offsetPoint`'s note
  // on the sign convention: right of forward is (cos h, -sin h)).
  const cx = walk.x + Math.cos(h0) * radius;
  const cz = walk.z - Math.sin(h0) * radius;
  walk.x = cx - Math.cos(h1) * radius;
  walk.z = cz + Math.sin(h1) * radius;
  walk.heading = h1;
}

/**
 * AUTHORED SHAPE, and why it closes.
 *
 * The lap is a "peanut": two turns of DIFFERENT radius — a long sweeper and a
 * hairpin — joined by the two common external tangents of their circles. That
 * construction closes exactly, for any pair of radii and any centre distance, with
 * both straights positive:
 *
 *   tangent length  T  = sqrt(d^2 - (R1 - R2)^2)
 *   sweeper turn       = pi + 2*asin((R1 - R2)/d)
 *   hairpin turn       = pi - 2*asin((R1 - R2)/d)
 *
 * and the two turns sum to exactly one revolution. A general sequence of arcs and
 * straights does not have that property: closing it needs a numeric solve, and the
 * solve is free to return a NEGATIVE straight, which is a lap folded through itself
 * that still reports a zero residual. That happened, and it is why the shape is
 * constructed rather than solved.
 *
 * The esses are then inserted into the back straight as a MIRRORED PAIR of
 * S-bends. Each bend is `+r, -2r, +r` by angle, so its net turn is zero, and the
 * mirrored second bend cancels the first one's lateral offset. The pair therefore
 * only consumes distance along the straight, which is subtracted from it. Closure
 * survives by construction, and the constructor still checks the residual.
 */
const SWEEPER_RADIUS = 320;
const HAIRPIN_RADIUS = 30;
/** Straight length between the two turns, metres: the acceleration and braking room. */
const TANGENT_LENGTH = 700;
/** Radius and half-angle of one S-bend of the esses. */
const ESSES_RADIUS = 110;
const ESSES_ANGLE = Math.PI / 7;

/**
 * One S-bend: turn one way, twice back, and one way again. Net heading unchanged.
 *
 * Names are unique because they are the telemetry key: two pieces called "esses
 * left" would have their sector timings silently averaged together.
 */
function essesBend(label: string, sign: number): Piece[] {
  const radius = ESSES_RADIUS * sign;
  const first = sign > 0 ? 'right' : 'left';
  const second = sign > 0 ? 'left' : 'right';
  return [
    { name: `${label} ${first}`, length: ESSES_ANGLE * ESSES_RADIUS, radius },
    { name: `${label} ${second}`, length: 2 * ESSES_ANGLE * ESSES_RADIUS, radius: -radius },
    { name: `${label} exit`, length: ESSES_ANGLE * ESSES_RADIUS, radius },
  ];
}

/** Distance consumed along the entry heading by a run of pieces. */
function alongDisplacement(pieces: readonly Piece[]): number {
  const walk: Walk = { x: 0, z: 0, heading: 0 };
  for (const piece of pieces) advance(walk, piece.length, piece.radius);
  // Entry heading is 0, so forward is +Z.
  return walk.z;
}

/** The finished lap: a peanut with a mirrored chicane pair in its back straight. */
function buildLap(): Piece[] {
  const d = Math.hypot(TANGENT_LENGTH, SWEEPER_RADIUS - HAIRPIN_RADIUS);
  const beta = Math.asin((SWEEPER_RADIUS - HAIRPIN_RADIUS) / d);
  const sweeperTurn = Math.PI + 2 * beta;
  const hairpinTurn = Math.PI - 2 * beta;

  const chicane = [...essesBend('esses 1', 1), ...essesBend('esses 2', -1)];
  const chicaneAlong = alongDisplacement(chicane);
  const remaining = TANGENT_LENGTH - chicaneAlong;
  if (remaining <= 40) {
    throw new Error('playground esses do not fit in the back straight');
  }

  return [
    { name: 'main straight', length: TANGENT_LENGTH, radius: Infinity },
    { name: 'turn 1 sweeper', length: sweeperTurn * SWEEPER_RADIUS, radius: SWEEPER_RADIUS },
    // The back straight carries the esses: two thirds of the remaining tarmac before
    // them, so there is room to arrive at speed, and the rest as the run to the hairpin.
    { name: 'back straight', length: remaining * 0.62, radius: Infinity },
    ...chicane,
    { name: 'hairpin approach', length: remaining * 0.38, radius: Infinity },
    { name: 'hairpin', length: hairpinTurn * HAIRPIN_RADIUS, radius: HAIRPIN_RADIUS },
  ];
}

/** Walks the finished lap, returning the end pose; the residual must be zero. */
function walkLap(pieces: readonly Piece[]): Walk {
  const walk: Walk = { x: 0, z: 0, heading: 0 };
  for (const piece of pieces) advance(walk, piece.length, piece.radius);
  return walk;
}


/**
 * Peak grade on the lap, as a fraction. The real road at seed 1337 runs mean 5.0%,
 * p95 12.5% and 18.8% at its very worst over 200 km; the open desert is steeper
 * still. 28% is therefore past anything the road asks for and inside what a player
 * can find off it: the worst case a period car has to climb, hold and stop on.
 */
const MAX_GRADE = 0.28;

/**
 * Grade as a function of position round the lap, stated as keyframes at fractions
 * of the lap and interpolated smoothly.
 *
 * The keyframes are placed against the plan (`buildLap`) so that each feature meets
 * a specific question:
 *
 *   0.00 main straight    flat, then a full-gradient CLIMB — can it use its power?
 *   0.26 turn 1 sweeper   the descent starts INSIDE the bend, so braking and
 *   0.45                  cornering compete for the same tyres for 600 m
 *   0.70 esses            climbing through direction changes
 *   0.86 hairpin approach the steepest DESCENT on the lap, straight into the
 *   0.95 hairpin          tightest corner: the worst braking case there is
 *
 * Signs are grades in the direction of travel, so a positive keyframe is a climb.
 */
const GRADE_KEYFRAMES: readonly (readonly [number, number])[] = [
  [0.0, 0.0],
  [0.08, 0.9],
  [0.2, 1.0],
  [0.26, 0.35],
  [0.32, -0.5],
  [0.45, -0.9],
  [0.58, -0.35],
  [0.66, 0.3],
  [0.78, 0.8],
  [0.86, 0.2],
  [0.9, -1.0],
  [0.96, -0.6],
  [1.0, 0.0],
];

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Shape value at a lap fraction: keyframes with a smooth (C1) blend between them. */
function gradeShape(fraction: number): number {
  for (let i = 1; i < GRADE_KEYFRAMES.length; i++) {
    const [atA, valueA] = GRADE_KEYFRAMES[i - 1]!;
    const [atB, valueB] = GRADE_KEYFRAMES[i]!;
    if (fraction > atB) continue;
    const t = atB > atA ? (fraction - atA) / (atB - atA) : 0;
    return valueA + (valueB - valueA) * smoothstep01(t);
  }
  return 0;
}

/**
 * The authored grade per table sample, mean-corrected and scaled to `MAX_GRADE`.
 *
 * Order matters: the mean is removed FIRST, so the lap returns to its own start
 * height, and the scale is applied afterwards to the corrected shape, so the peak is
 * exactly the stated maximum rather than the maximum before correction.
 */
function gradeProfile(length: number, count: number, step: number): Float64Array {
  const grades = new Float64Array(count);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    grades[i] = gradeShape((i * step) / length);
    sum += grades[i]!;
  }
  const mean = sum / count;
  let peak = 0;
  for (let i = 0; i < count; i++) {
    grades[i] = grades[i]! - mean;
    peak = Math.max(peak, Math.abs(grades[i]!));
  }
  const scale = peak > 0 ? MAX_GRADE / peak : 0;
  for (let i = 0; i < count; i++) grades[i] = grades[i]! * scale;
  return grades;
}

export class PlaygroundCircuit {
  /** Lap length, metres. */
  readonly length: number;
  /** Steepest grade on the lap, as a fraction; authored, see `gradeProfile`. */
  readonly maxGrade: number;
  /** Height mismatch across the start line, metres. Zero by construction. */
  readonly elevationResidualM: number;
  readonly sectors: readonly CircuitSector[];
  /** The elevation field under the circuit: the game's own, at this seed. */
  readonly landscape: Landscape;
  /** Closure residual in metres, kept for the bench to report. */
  readonly closureResidualM: number;

  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly zs: Float64Array;
  private readonly headings: Float64Array;
  private readonly curvatures: Float64Array;
  private readonly count: number;

  /**
   * `originX/originZ` place the lap in the world, which is what decides its grades:
   * the centreline elevation is the landscape's, so moving the circuit gives it a
   * different set of hills. The bench picks a deterministic spot with real relief.
   */
  constructor(seed: number, originX = 0, originZ = 0) {
    this.landscape = new Landscape(seed);
    const lap = buildLap();
    const end = walkLap(lap);
    this.closureResidualM = Math.hypot(end.x, end.z);
    if (this.closureResidualM > 1e-3) {
      throw new Error(
        `playground circuit does not close: ${this.closureResidualM.toFixed(4)} m residual`,
      );
    }
    if (lap.some((piece) => piece.length <= 0)) {
      throw new Error('playground circuit has a piece of zero or negative length');
    }

    // Lay the centreline out at a fixed step, piece by piece, so arclength IS the
    // table index and no reparameterisation is needed anywhere else.
    this.length = lap.reduce((total, piece) => total + piece.length, 0);
    this.count = Math.round(this.length / SAMPLE_STEP);
    // The step is adjusted so a whole number of samples spans the lap exactly; the
    // table then wraps without a short final segment.
    const step = this.length / this.count;

    this.xs = new Float64Array(this.count);
    this.ys = new Float64Array(this.count);
    this.zs = new Float64Array(this.count);
    this.headings = new Float64Array(this.count);
    this.curvatures = new Float64Array(this.count);

    const sectors: CircuitSector[] = [];
    const walk: Walk = { x: originX, z: originZ, heading: 0 };
    let index = 0;
    let travelled = 0;
    for (const spec of lap) {
      const length = spec.length;
      sectors.push({
        name: spec.name,
        startS: travelled,
        endS: travelled + length,
        radius: spec.radius,
      });
      const curvature = Number.isFinite(spec.radius) ? 1 / spec.radius : 0;
      // Samples are written at the piece's own resolution and the walk is advanced
      // exactly, so rounding cannot accumulate along the lap.
      while (index * step < travelled + length - 1e-9) {
        const into = index * step - travelled;
        const at: Walk = { x: walk.x, z: walk.z, heading: walk.heading };
        advance(at, into, spec.radius);
        this.xs[index] = at.x;
        this.zs[index] = at.z;
        this.headings[index] = at.heading;
        this.curvatures[index] = curvature;
        index++;
      }
      advance(walk, length, spec.radius);
      travelled += length;
    }
    this.sectors = sectors;

    // ELEVATION IS AUTHORED, and that is the point of the circuit.
    //
    // It used to be the landscape's own height under the centreline, which sounded
    // honest and tested nothing: the flattest site in a 24 km square gave 1.5% of
    // mean grade against the real road's 5.0%, and the hilliest gave 11% with its
    // steepest pitch wherever the noise happened to put it — never in a corner, and
    // never at the limit. What the autopilot has to survive is the WORST case: a
    // full-gradient climb, a full-gradient descent, and a gradient held THROUGH a
    // bend, where braking and cornering compete for the same tyres.
    //
    // `gradeProfile` therefore states the grade as a function of arclength, with a
    // zero mean so the lap closes in Y as it does in XZ, and a peak scaled to
    // exactly MAX_GRADE. The landscape supplies only the altitude the whole thing
    // sits at, so the circuit still stands in the world rather than in a void.
    const base = this.landscape.heightAt(this.xs[0]!, this.zs[0]!);
    const grades = gradeProfile(this.length, this.count, step);
    let height = base;
    for (let i = 0; i < this.count; i++) {
      this.ys[i] = height;
      height += grades[i]! * step;
    }
    this.maxGrade = grades.reduce((worst, grade) => Math.max(worst, Math.abs(grade)), 0);
    // The integral closed to zero by construction; a drift here means the profile
    // was edited without keeping its mean, which would put a step in the start line.
    this.elevationResidualM = Math.abs(height - base);
    if (this.elevationResidualM > 1e-3) {
      throw new Error(
        `playground elevation does not close: ${this.elevationResidualM.toFixed(4)} m residual`,
      );
    }
  }

  /** Arclength wrapped into one lap. */
  wrap(s: number): number {
    const lap = this.length;
    return ((s % lap) + lap) % lap;
  }

  /** Which sector an arclength falls in. */
  sectorAt(s: number): CircuitSector {
    const wrapped = this.wrap(s);
    for (const sector of this.sectors) {
      if (wrapped < sector.endS) return sector;
    }
    return this.sectors[this.sectors.length - 1]!;
  }

  /**
   * Centreline state at arclength `s`, wrapped. Linear between one-metre samples:
   * the table is dense enough that the interpolation error is below a millimetre,
   * and unlike the real road there is no 4 m node spacing to hide.
   */
  sampleAt(s: number): CircuitSample {
    const wrapped = this.wrap(s);
    const step = this.length / this.count;
    const fi = wrapped / step;
    const i = Math.floor(fi) % this.count;
    const j = (i + 1) % this.count;
    const t = fi - Math.floor(fi);

    const x = this.xs[i]! + (this.xs[j]! - this.xs[i]!) * t;
    const z = this.zs[i]! + (this.zs[j]! - this.zs[i]!) * t;
    const y = this.ys[i]! + (this.ys[j]! - this.ys[i]!) * t;
    // Headings accumulate past 2π along the lap, so the wrap point is the only place
    // the raw difference is wrong; taking the shortest turn fixes it everywhere.
    const h0 = this.headings[i]!;
    let dh = this.headings[j]! - h0;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;

    return {
      s: wrapped,
      x,
      y,
      z,
      heading: h0 + dh * t,
      grade: (this.ys[j]! - this.ys[i]!) / step,
      curvature: this.curvatures[i]!,
    };
  }

  /**
   * Closest centreline point to a world XZ, with the same `lateral` sign convention
   * as the road: positive is LEFT of travel.
   *
   * With a hint this descends from the previous answer, exactly as the road does. A
   * hintless query scans the whole table, which is a few thousand doubles — the lap
   * is short enough that the road's coarse-table machinery would buy nothing.
   */
  project(x: number, z: number, hintS?: number): { s: number; lateral: number; height: number } {
    const step = this.length / this.count;
    let bestIndex = 0;
    let bestDist = Infinity;
    if (hintS === undefined) {
      for (let i = 0; i < this.count; i++) {
        const d = (this.xs[i]! - x) ** 2 + (this.zs[i]! - z) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestIndex = i;
        }
      }
    } else {
      // A car cannot move far in one step, so a window around the hint is enough —
      // and it keeps the answer on the right side of a hairpin whose two ends pass
      // within a few tens of metres of each other.
      const centre = Math.round(this.wrap(hintS) / step);
      const window = Math.ceil(60 / step);
      for (let offset = -window; offset <= window; offset++) {
        const i = (((centre + offset) % this.count) + this.count) % this.count;
        const d = (this.xs[i]! - x) ** 2 + (this.zs[i]! - z) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestIndex = i;
        }
      }
    }

    // Refine within the two neighbouring segments by projecting onto them.
    let bestS = bestIndex * step;
    let bestSigned = 0;
    let bestRefined = Infinity;
    for (const offset of [-1, 0]) {
      const i = (((bestIndex + offset) % this.count) + this.count) % this.count;
      const j = (i + 1) % this.count;
      const ax = this.xs[i]!;
      const az = this.zs[i]!;
      const bx = this.xs[j]!;
      const bz = this.zs[j]!;
      const dx = bx - ax;
      const dz = bz - az;
      const lengthSq = dx * dx + dz * dz;
      if (lengthSq <= 0) continue;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSq));
      const px = ax + dx * t;
      const pz = az + dz * t;
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d >= bestRefined) continue;
      bestRefined = d;
      bestS = this.wrap((i + t) * step);
      // Left of travel is (cos h, -sin h) negated; matching Road.offsetPoint means a
      // point to the left has POSITIVE lateral.
      const heading = this.headings[i]!;
      bestSigned = (x - px) * Math.cos(heading) - (z - pz) * Math.sin(heading);
    }

    return { s: bestS, lateral: bestSigned, height: this.sampleAt(bestS).y };
  }

  /**
   * Height of the driving surface, metres, at an arclength and lateral offset.
   *
   * THIS, and not `roadSurfaceY`, is what the playground's collider is built from.
   * The road's surface function is parameterised by arclength over a 40 000 km line
   * whose noise has no period, so on a closed lap it does not meet itself: measured,
   * the seam arrived with a 10 cm step in the tarmac, and a raycast suspension turns
   * a 10 cm step into a car launched 70 m into the air. Everything here is a
   * function of the centreline table and |lateral|, both of which are periodic by
   * construction, so the lap closes to the millimetre in Y as well as in XZ.
   *
   * The cross-section is a crown: a gentle parabolic fall to each edge, which is
   * what a real road sheds water with, and which gives the tyres something to
   * report on a cambered turn.
   */
  surfaceY(s: number, lateral: number): number {
    const edge = Math.min(1, Math.abs(lateral) / CIRCUIT_HALF_WIDTH);
    return this.sampleAt(s).y - CROWN_DROP * edge * edge;
  }

  /** Steepest grade anywhere on the lap, as a fraction. For the bench's report. */
  worstGrade(): number {
    let worst = 0;
    for (let s = 0; s < this.length; s += 1) {
      worst = Math.max(worst, Math.abs(this.sampleAt(s).grade));
    }
    return worst;
  }
}
