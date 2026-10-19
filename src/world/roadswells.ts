import { hashUnit3 } from '../core/rng';
import { Landscape } from './landscape';
import { characterOf, districtAt, newDistrictBuffer, type RoadCharacter } from './roadcharacter';
import { COARSE_SPACING, NODE_SPACING } from './roadcurve';
import { RoadDistance } from './roaddistance';
import type { Road } from './road';

/**
 * SWELLS: the rises and falls the road is driven over, laid where the road is.
 *
 * The landscape's own bands are isotropic noise, and isotropic noise cannot tell a
 * climb from a descent: whatever it does one way it does the other, so every rise is
 * as long as its fall, and the felt bands' long tempo turned into 4-14 km of gentle
 * drag the owner drove as a flat plateau (seeds 42 and 1337: 0.15 crests per km over
 * the first 20 km, one 5 km climb). What he asked for has a direction in it: SHORT
 * rises, LONG gentle descents, crests that hide the road beyond, the average level.
 * Only something that knows which way the road runs can be asymmetric, so a swell is
 * placed from the road's own spine — and then lives in the world as a pure function
 * of position, added to `Landscape.heightAt`, so the road, the terrain beside it, the
 * tiles, the vista and every worker read one field and nothing can seam.
 *
 * ONE SWELL is a ridge across the road. In its own frame (`u` along the road's chord
 * across the swell, `v` across it) its height is `rise * P(u) * Q(v)`:
 *
 *   P   integrates a piecewise-linear grade: a toe from level to the climb grade,
 *       the climb held, a short crest vertical curve back through level (the crest is
 *       at u = 0), the descent grade held, a long sag back to level. `rise` is the
 *       climb's height and the descent's drop by construction, so a swell starts and
 *       ends on the landscape and the road's net elevation is the landscape's: the
 *       swells cannot accumulate (bounded by `SWELL_RISE_MAX`, whatever the drive).
 *   Q   is 1 across the road's own corridor and fades out over a few hundred metres
 *       either side (never steeper than 1.5 / `FLANK_RUN`), so the desert rises with
 *       the road — a ridge the road crosses, not a dyke it is built on or a trench it
 *       is cut into. The corridor grading, the embankment, the director's cuts and
 *       the landforms all ride on top of it unchanged, as they ride on the bands.
 *
 * WHERE: the road is cut into `SLOT_M` slots and each holds at most one swell, wholly
 * inside it, so swells never stack along the road. The district says how likely a
 * slot is to hold one and how big it is (`RoadCharacter.swell*`). A swell is paired
 * with the corners its slot holds, read from the heading field:
 *
 *   crest   the crest sits in the corner, past its entry — a bend over a blind brow
 *   rise    the climb takes the whole corner and crests just after it — a bend on a rise
 *   dip     the descent's sag bottoms out in the corner — a bend coming out of a dip
 *
 * and is laid free in its slot when there is no corner to pair with. Where the bands
 * under it are already lifting, the swell is raised until its descent still falls
 * `DESCENT_READ` steeper than they lift, or a long gentle descent reads as level.
 *
 * THE CLIMB BUDGET. The owner's limit is a speed, not a grade: the weakest car in the
 * catalogue (the VAZ-1111 Oka, 30 W/kg with a driver) may lose at most 10-15 km/h over
 * any climb. A grade cannot say that — a 9% pitch of 8 m costs the Oka nothing and one
 * of 25 m costs it 20 km/h — so every swell is DRIVEN before it is built: the Oka,
 * at full power from the 90 km/h limit, over the real road through the swell (the
 * landscape underneath included, `LEAD_M` of it before the climb), and a swell that
 * costs more than `CLIMB_LOSS_KMH` is lowered until it does not, or dropped.
 * `tools/road-rhythm.ts` drives the whole road on the catalogue car's own torque curve
 * and gearing and holds the result.
 *
 * THE ROAD MUST CROSS IT ONCE. A swell whose road doubles back across it inside its
 * span (`u` not increasing along the chord) is dropped, and one that another stretch
 * of road within reach would pass through is narrowed to keep `OTHER_PASS_CLEAR_M`
 * clear of it (lowered with its flank), or dropped: the profile it was budgeted on is
 * then the profile that is driven. And it may not make the road anywhere steeper than
 * `ROAD_GRADE_MAX`, bands included.
 *
 * WHEN: once, in the spine's own walk (`SwellWalk`, run by `buildSpine` in the spine
 * worker), which has every node of the road in hand anyway. The swells are a table in
 * the `RoadSpine`, moved out of the worker and cached with it, and `RoadSwells` only
 * reads it: no thread that draws or drives ever builds a swell. Everything is a pure
 * function of the seed and the road, so the table is the same after a reload.
 */

/** Road per swell slot, metres. A swell lies wholly inside its slot. */
export const SLOT_M = 950;
/** Clear road kept at each end of a slot, metres, so neighbours never touch. */
const SLOT_MARGIN_M = 25;
/** No swells this close to the homestead or the road's end, metres of arclength. */
const HOME_CLEAR_M = 2500;
const END_CLEAR_M = 3000;
/** Straight-line clearance kept between any swell's support and the house, metres. */
const HOME_RADIUS_M = 900;

/** Steepest climb grade a swell may hold, as a fraction. */
const CLIMB_GRADE_MAX = 0.11;
/** Tallest swell, metres: also the bound on how far the swells move the road. */
export const SWELL_RISE_MAX = 16;
/** Smallest swell worth building, metres: below it a crest is a ripple. */
const SWELL_RISE_MIN = 3;
/** Width across the road at full height, and the fade beyond it, metres. */
const CORE_MIN_M = 90;
const CORE_SPREAD_M = 110;
const FADE_MIN_M = 320;
const FADE_SPREAD_M = 160;
/** Longest descent a swell may have, metres. */
const DESCENT_MAX_M = 900;
/** Toe of the climb and the sag at the foot of the descent, metres. */
const TOE_M = 40;
const SAG_MIN_M = 90;
/**
 * Least metres of flank per metre of swell height across the road: the desert beside
 * a swell is no steeper than 1.5 / FLANK_RUN (the cubic fade's peak), 18.75%.
 */
const FLANK_RUN = 8;
/** Least core a swell narrowed by a neighbouring pass of the road keeps, metres. */
const CORE_FLOOR_M = 30;
/** Ground kept between another pass of the road and a swell's support, metres. */
const OTHER_PASS_CLEAR_M = 40;
/** How much steeper than the bands' own lift a descent must fall to read, fraction. */
const DESCENT_READ = 0.012;
/** Steepest the road may be anywhere through a swell, as a fraction. */
const ROAD_GRADE_MAX = 0.13;

/**
 * The steepest any swell can make the ground, as a fraction: its climb grade and its
 * steepest flank at right angles, the worst case.
 */
export const SWELL_MAX_SLOPE = Math.hypot(CLIMB_GRADE_MAX, 1.5 / FLANK_RUN);
/**
 * Farthest any point of a swell's support can be from its crest anchor, metres: the
 * descent along it and the full width across. Queries search this far.
 */
const SWELL_REACH_M = Math.hypot(DESCENT_MAX_M, CORE_MIN_M + CORE_SPREAD_M + FADE_MIN_M + FADE_SPREAD_M);

// --- the climb budget's car --------------------------------------------------------

/**
 * The weakest car in the catalogue, as a point mass: the VAZ-1111 Oka (635 kg kerb,
 * 21.5 kW) with a 75 kg driver, Cd·A 0.68. `wheelPowerW` is the least its own torque
 * curve and gearing put through the wheels anywhere from 60 to 90 km/h in the best
 * gear: 19.8 kW at 60 in third, 16.1 kW at 65 just after the shift to fourth, 19.7 kW
 * at 90 (`engineTorqueNm` on the 1111 four-speed). Flat at the dip, so the budget
 * never credits the car with a gear it is not in.
 * `tools/road-rhythm.ts` names the weakest car from the catalogue and checks this
 * figure against its drivetrain, so a weaker car joining the catalogue fails there.
 */
export const WEAK_CAR = {
  massKg: 710,
  dragArea: 0.68,
  wheelPowerW: 16_000,
  /** Gravel's rolling resistance, the worst sealed-or-graded deck the road has. */
  rolling: 0.02,
} as const;
/** The speed limit, which the budget is measured from, m/s. */
const CRUISE_MS = 25;
/** What a swell may cost the weak car, km/h. The owner's budget is 10-15. */
export const CLIMB_LOSS_KMH = 11;
/** Road driven into the swell before its climb, for the landscape's own grade, metres. */
const LEAD_M = 400;
/**
 * Road either side of a swell's span that must run monotonically along its axis,
 * metres: twice the coarse half-spacing plus margin, so every spine sample the
 * other-pass search skips as "this crossing" is proved to lie outside the swell.
 */
const NEAR_M = 300;

/** One built swell. Positions are world metres; `ax`/`az` the unit axis along the road. */
export interface Swell {
  readonly x: number;
  readonly z: number;
  readonly ax: number;
  readonly az: number;
  readonly climb: number;
  readonly descent: number;
  readonly rise: number;
  readonly climbGrade: number;
  readonly descentGrade: number;
  readonly crestIn: number;
  readonly crestOut: number;
  readonly sag: number;
  readonly core: number;
  readonly fade: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Arclength of the crest, metres: for tools. */
  readonly crestS: number;
}

/** Height of `swell`'s along-road profile at `u`, metres, before the lateral fade. */
function profileAt(w: Swell, u: number): number {
  if (u <= -w.climb || u >= w.descent) return 0;
  if (u < 0) {
    const p = u + w.climb;
    if (p < TOE_M) return (w.climbGrade * p * p) / (2 * TOE_M);
    const q = u + w.crestIn;
    if (q < 0) return w.climbGrade * (TOE_M / 2 + p - TOE_M);
    return w.rise - (w.climbGrade * (w.crestIn - q) * (w.crestIn - q)) / (2 * w.crestIn);
  }
  if (u < w.crestOut) return w.rise - (w.descentGrade * u * u) / (2 * w.crestOut);
  const r = w.descent - u;
  if (r < w.sag) return (w.descentGrade * r * r) / (2 * w.sag);
  return w.descentGrade * (r - w.sag / 2);
}

function swellHeight(w: Swell, x: number, z: number): number {
  if (x < w.minX || x > w.maxX || z < w.minZ || z > w.maxZ) return 0;
  const dx = x - w.x;
  const dz = z - w.z;
  const u = dx * w.ax + dz * w.az;
  if (u <= -w.climb || u >= w.descent) return 0;
  const v = Math.abs(dx * w.az - dz * w.ax);
  if (v >= w.core + w.fade) return 0;
  let lateral = 1;
  if (v > w.core) {
    const t = (v - w.core) / w.fade;
    lateral = 1 - t * t * (3 - 2 * t);
  }
  return profileAt(w, u) * lateral;
}

/**
 * Doubles per slot in the spine's swell table (`RoadSpine.swells`). A slot with no
 * swell holds NaN in `x`. The grades, the sag and the bounds are derived on reading
 * (`swellAt`), by the very expressions the build made them with.
 */
export const SWELL_FIELDS = 11;
const F_X = 0;
const F_Z = 1;
const F_AX = 2;
const F_AZ = 3;
const F_CLIMB = 4;
const F_DESCENT = 5;
const F_RISE = 6;
const F_CREST = 7;
const F_CORE = 8;
const F_FADE = 9;
const F_CREST_S = 10;

/** The swell in `table`'s row starting at `at`. The one way a `Swell` is made. */
function swellAt(table: Float64Array, at: number): Swell {
  const x = table[at + F_X]!;
  const z = table[at + F_Z]!;
  const ax = table[at + F_AX]!;
  const az = table[at + F_AZ]!;
  const climb = table[at + F_CLIMB]!;
  const descent = table[at + F_DESCENT]!;
  const rise = table[at + F_RISE]!;
  const crestIn = table[at + F_CREST]!;
  const crestOut = crestIn;
  const core = table[at + F_CORE]!;
  const fade = table[at + F_FADE]!;
  const sag = Math.max(SAG_MIN_M, descent * 0.3);
  const climbGrade = rise / (climb - TOE_M / 2 - crestIn / 2);
  const descentGrade = rise / (descent - sag / 2 - crestOut / 2);
  const extentU = Math.max(climb, descent);
  const span = core + fade;
  const ex = Math.abs(ax) * extentU + Math.abs(az) * span;
  const ez = Math.abs(az) * extentU + Math.abs(ax) * span;
  return {
    x, z, ax, az, climb, descent, rise, climbGrade, descentGrade,
    crestIn, crestOut, sag, core, fade,
    minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, crestS: table[at + F_CREST_S]!,
  };
}

/** Side of a query cell, metres. A cell's swell list is built once and reused. */
const QUERY_CELL_M = 1024;
const QUERY_CELL_LIMIT = 16_384;
const CELL_BIAS = 1 << 20;
const CELL_STRIDE = 1 << 21;

/** Corner on the road: entry, apex and exit arclengths, metres. */
interface Corner {
  entry: number;
  apex: number;
  exit: number;
}

/** Curvature that makes a stretch of road a corner, rad/m (1.5 km radius). */
const CORNER_CURVATURE = 1 / 1500;
const CORNER_PROBE_M = 16;
/** Road before and after the slot read for a corner's entry and exit, metres. */
const CORNER_REACH_M = 120;
/** Corners of one slot considered for pairing. A slot rarely holds more than three. */
const MAX_SLOT_CORNERS = 6;

/**
 * The swells along one road, and the field they add to the landscape: a reader of
 * the spine's swell table (see `SwellWalk`).
 *
 * Built by `Road` and handed to its `Landscape` as an overlay.
 */
export class RoadSwells {
  private readonly cells = new Map<number, readonly Swell[]>();
  private readonly distance: RoadDistance;
  private readonly near: number[] = [];
  private readonly slotScratch: number[] = [];

  constructor(private readonly road: Road) {
    this.distance = new RoadDistance(road);
  }

  /**
   * Indexes the whole road for the cell lookup now: about 8 ms over a 40 000 km spine,
   * which otherwise lands in whatever streaming slice first asks for a height. `Road`
   * calls it as soon as its spine exists, so in the game it is paid at load.
   */
  prepare(): void {
    this.distance.coarseNear(0, 0, 0, this.near);
  }

  private lastCellX = Number.NaN;
  private lastCellZ = Number.NaN;
  private lastList: readonly Swell[] = [];

  /** Height the swells add at a world position, metres. */
  heightAt(x: number, z: number): number {
    const cx = Math.floor(x / QUERY_CELL_M);
    const cz = Math.floor(z / QUERY_CELL_M);
    // Queries come in runs along the road or across a tile, so the last cell answers
    // most of them without a map lookup on a key too large to be a small integer.
    if (cx !== this.lastCellX || cz !== this.lastCellZ) {
      this.lastList = this.cellList(cx, cz);
      this.lastCellX = cx;
      this.lastCellZ = cz;
    }
    const list = this.lastList;
    let h = 0;
    for (let i = 0; i < list.length; i++) h += swellHeight(list[i]!, x, z);
    return h;
  }

  /** The swell of slot `slot`, or null when it has none. Public for tools. */
  swellOf(slot: number): Swell | null {
    const table = this.road.spine.swells;
    const at = slot * SWELL_FIELDS;
    if (slot < 0 || at >= table.length || Number.isNaN(table[at + F_X]!)) return null;
    return swellAt(table, at);
  }

  private cellList(cx: number, cz: number): readonly Swell[] {
    const key = (cx + CELL_BIAS) * CELL_STRIDE + (cz + CELL_BIAS);
    const hit = this.cells.get(key);
    if (hit) return hit;
    if (this.cells.size >= QUERY_CELL_LIMIT) this.cells.clear();
    const minX = cx * QUERY_CELL_M;
    const minZ = cz * QUERY_CELL_M;
    const maxX = minX + QUERY_CELL_M;
    const maxZ = minZ + QUERY_CELL_M;
    // A swell's anchor is a road point of its own slot, so it lies within half a coarse
    // step (along the road, so also in the plane) of some spine sample: every swell that
    // reaches the cell has a sample within `radius`, and its slot is the one that sample's
    // half-step either side falls in. (`distance` was indexed by `prepare`.)
    const half = COARSE_SPACING / 2;
    const radius = QUERY_CELL_M * Math.SQRT1_2 + SWELL_REACH_M + half;
    const count = this.distance.coarseNear(minX + QUERY_CELL_M / 2, minZ + QUERY_CELL_M / 2, radius, this.near);
    const slots = this.slotScratch;
    slots.length = 0;
    for (let i = 0; i < count; i++) {
      const s = this.near[i]! * COARSE_SPACING;
      const to = Math.floor((s + half) / SLOT_M);
      for (let slot = Math.floor((s - half) / SLOT_M); slot <= to; slot++) {
        if (!slots.includes(slot)) slots.push(slot);
      }
    }
    const list: Swell[] = [];
    for (const slot of slots) {
      const w = this.swellOf(slot);
      if (w && w.maxX >= minX && w.minX <= maxX && w.maxZ >= minZ && w.minZ <= maxZ) list.push(w);
    }
    this.cells.set(key, list);
    return list;
  }
}

/** Radius of the other-pass search around a crest: its reach and half a coarse step. */
const PASS_RADIUS_M = SWELL_REACH_M + COARSE_SPACING / 2;
/** Slack on the other-pass search's z bounds, metres, for the rounding of a squared distance. */
const PASS_Z_SLACK_M = 1;
/** Nodes the walk's ring holds to begin with; it doubles if a slot is held longer. */
const RING_NODES = 4096;

/** First node of slot `slot`'s road window: the budget's lead-in, and one for a chord. */
function windowFirst(slot: number): number {
  return Math.floor((slot * SLOT_M - LEAD_M) / NODE_SPACING) - 1;
}
/** Last node of slot `slot`'s road window: `NEAR_M` past it, and one for a chord. */
function windowLast(slot: number): number {
  return Math.ceil(((slot + 1) * SLOT_M + NEAR_M) / NODE_SPACING) + 1;
}

/**
 * Builds the swell table inside the spine's walk (`buildSpine`), which is the one place
 * every node of the road is in hand: the walk hands each node to `node` and each coarse
 * sample to `coarse`, and gets the table from `finish`.
 *
 * A slot's swell reads the road under it — `windowFirst` to `windowLast`, kept in a ring
 * of recent nodes — and, for the other passes of the road that might cross it, every
 * coarse sample within `PASS_RADIUS_M` of its crest, anywhere along the road. The
 * heading never turns 90 degrees off +Z, so z strictly increases along the road (see
 * `roadcurve.ts`): every such sample has z within the radius of the crest's, and the
 * crest lies no further along than the slot's end. So a slot is built once its window
 * is walked and a coarse sample has passed the z of its end plus the radius; the
 * search then scans the coarse table either way from the crest until z leaves the
 * radius, and finds exactly the samples a whole-road spatial query would.
 */
export class SwellWalk {
  private readonly table: Float64Array;
  /** Slots that may hold a swell: every one ending `END_CLEAR_M` before the road does. */
  private readonly slots: number;
  private readonly landscape: Landscape;
  /** The next slot to build; slots are built in order. */
  private next = 0;
  /** Walked node positions, node `i` at `i & (length - 1)`, from `windowFirst(next)`. */
  private ringX = new Float64Array(RING_NODES);
  private ringZ = new Float64Array(RING_NODES);
  private keepFrom = windowFirst(0);
  /** The road under the slot being built, one entry per node from `windowFirst`. */
  private xs = new Float64Array(0);
  private zs = new Float64Array(0);
  private first = 0;
  /** The bands' height under the road at every second node of the budget's drive. */
  private bases = new Float64Array(0);
  /** The swell being sized, as a table row. */
  private readonly row = new Float64Array(SWELL_FIELDS);
  private readonly district = newDistrictBuffer();
  private readonly corners: Corner[] = Array.from({ length: MAX_SLOT_CORNERS }, () => ({
    entry: 0,
    apex: 0,
    exit: 0,
  }));

  constructor(
    private readonly seed: number,
    private readonly length: number,
    private readonly coarseX: Float64Array,
    private readonly coarseZ: Float64Array,
  ) {
    this.slots = Math.max(0, Math.floor((length - END_CLEAR_M) / SLOT_M));
    this.table = new Float64Array(this.slots * SWELL_FIELDS).fill(Number.NaN);
    // The budget drives over the bands alone: this landscape never gets an overlay.
    this.landscape = new Landscape(seed);
  }

  /** Node `i` of the walk is at (x, z). Called for every node, in order, from 0. */
  node(i: number, x: number, z: number): void {
    if (i - this.keepFrom >= this.ringX.length) this.growRing(i);
    const j = i & (this.ringX.length - 1);
    this.ringX[j] = x;
    this.ringZ[j] = z;
  }

  /** Coarse sample `k` has been written. Builds every slot the walk is now far enough past. */
  coarse(k: number): void {
    const walked = (k * COARSE_SPACING) / NODE_SPACING;
    const reached = this.coarseZ[k]! - PASS_RADIUS_M - PASS_Z_SLACK_M;
    const mask = this.ringZ.length - 1;
    while (this.next < this.slots) {
      const slot = this.next;
      if (windowLast(slot) > walked) return;
      if (!(reached > this.ringZ[Math.ceil(((slot + 1) * SLOT_M) / NODE_SPACING) & mask]!)) return;
      this.settle(slot);
    }
  }

  /** Builds the slots still held, the coarse table now whole, and returns the table. */
  finish(): Float64Array {
    while (this.next < this.slots) this.settle(this.next);
    return this.table;
  }

  private settle(slot: number): void {
    if (this.build(slot)) this.table.set(this.row, slot * SWELL_FIELDS);
    this.next = slot + 1;
    this.keepFrom = windowFirst(this.next);
  }

  /** Doubles the ring, keeping nodes `keepFrom` to `i - 1`. */
  private growRing(i: number): void {
    let size = this.ringX.length * 2;
    while (i - this.keepFrom >= size) size *= 2;
    const x = new Float64Array(size);
    const z = new Float64Array(size);
    const from = Math.max(0, this.keepFrom);
    const oldMask = this.ringX.length - 1;
    const mask = size - 1;
    for (let n = from; n < i; n++) {
      x[n & mask] = this.ringX[n & oldMask]!;
      z[n & mask] = this.ringZ[n & oldMask]!;
    }
    this.ringX = x;
    this.ringZ = z;
  }

  /**
   * The corners whose apex lies in [from, to], in order, written to `corners`; returns
   * how many (at most `MAX_SLOT_CORNERS`). Curvature is the turn between the window's
   * two chords either side of a node, so it is read off the walked nodes without
   * evaluating the heading field per node.
   */
  private findCorners(from: number, to: number): number {
    let inside = false;
    let peak = 0;
    let count = 0;
    let c = this.corners[0]!;
    const base = this.first;
    for (let s = from - CORNER_REACH_M; s <= to + CORNER_REACH_M; s += CORNER_PROBE_M) {
      const i = Math.round(s / NODE_SPACING) - base;
      const before = Math.atan2(this.xs[i]! - this.xs[i - 1]!, this.zs[i]! - this.zs[i - 1]!);
      const after = Math.atan2(this.xs[i + 1]! - this.xs[i]!, this.zs[i + 1]! - this.zs[i]!);
      const k = Math.abs(after - before) / NODE_SPACING;
      if (k >= CORNER_CURVATURE) {
        if (!inside) {
          inside = true;
          peak = 0;
          c.entry = s;
        }
        if (k > peak) {
          peak = k;
          c.apex = s;
        }
      } else if (inside) {
        inside = false;
        c.exit = s;
        if (c.apex >= from && c.apex <= to) {
          if (++count === MAX_SLOT_CORNERS) return count;
          c = this.corners[count]!;
        }
      }
    }
    return count;
  }

  private build(slot: number): Swell | null {
    const slotStart = slot * SLOT_M;
    const slotEnd = slotStart + SLOT_M;
    if (slotStart < HOME_CLEAR_M) return null;
    const seed = this.seed;
    districtAt(seed, slotStart + SLOT_M / 2, this.district);
    const c: RoadCharacter = characterOf(seed, this.district.index);
    if (hashUnit3(seed ^ 0x5357_4c31, slot, 0) >= c.swellChance) return null;

    const roll = (tag: number) => hashUnit3(seed ^ 0x5357_4c32, slot, tag);
    let rise = c.swellRiseMin + roll(1) * (c.swellRiseMax - c.swellRiseMin);
    let climb = c.swellClimbMin + roll(2) * (c.swellClimbMax - c.swellClimbMin);
    let descent = Math.min(DESCENT_MAX_M, climb * (2.4 + roll(3) * 1.6));
    const crest = c.swellCrestM * (0.8 + roll(4) * 0.4);
    const lo = slotStart + SLOT_MARGIN_M;
    const hi = slotEnd - SLOT_MARGIN_M;
    // Room first: a long climb in a short slot gives up descent, never its climb.
    descent = Math.min(descent, hi - lo - climb);
    if (descent < climb * 1.5) return null;

    // The road under the whole slot, from the budget's lead-in to `NEAR_M` past it:
    // every node anything below reads lies inside this window, and the walk has passed
    // it (`END_CLEAR_M` is far more than `NEAR_M`).
    const first = windowFirst(slot);
    const nodes = windowLast(slot) - first + 1;
    if (this.xs.length < nodes) {
      this.xs = new Float64Array(nodes);
      this.zs = new Float64Array(nodes);
    }
    const mask = this.ringX.length - 1;
    for (let i = 0; i < nodes; i++) {
      this.xs[i] = this.ringX[(first + i) & mask]!;
      this.zs[i] = this.ringZ[(first + i) & mask]!;
    }
    this.first = first;

    // Paired with a corner of the slot when one fits: the corners are tried from a
    // rolled start, each as the rolled kind of pairing, and a swell that has to give up
    // descent to fit keeps at least 1.5 times its climb.
    let crestS = lo + climb + roll(5) * (hi - lo - climb - descent);
    const corners = this.findCorners(lo, hi);
    const mode = roll(6);
    const from = Math.floor(roll(7) * corners);
    for (let j = 0; j < corners; j++) {
      const corner = this.corners[(from + j) % corners]!;
      let wanted: number;
      let wantedClimb = climb;
      if (mode < 0.4) {
        // A bend over a blind brow: crest a little past the apex's way in.
        wanted = corner.entry + (corner.apex - corner.entry) * (0.5 + roll(20 + j) * 0.5);
      } else if (mode < 0.75) {
        // A bend on a rise: the climb takes the whole corner and crests past its exit.
        wantedClimb = Math.max(climb, Math.min(c.swellClimbMax * 1.4, corner.exit - corner.entry + 40));
        wanted = corner.exit + 20;
      } else {
        // A bend out of a dip: the sag at the foot of the descent sits on the apex.
        wanted = corner.apex - descent + SAG_MIN_M / 2;
      }
      const fitted = Math.max(lo + wantedClimb, Math.min(wanted, hi - wantedClimb * 1.5));
      if (Math.abs(fitted - wanted) > 60) continue;
      crestS = fitted;
      climb = wantedClimb;
      descent = Math.min(descent, hi - crestS);
      break;
    }

    const crestIn = crest * 0.5;
    const crestOut = crest * 0.5;

    const ix = Math.round(crestS / NODE_SPACING) - first;
    const x = this.xs[ix]!;
    const z = this.zs[ix]!;
    if (Math.hypot(x, z) < HOME_RADIUS_M + SWELL_REACH_M) return null;
    const startNode = Math.floor((crestS - climb) / NODE_SPACING) - first;
    const endNode = Math.ceil((crestS + descent) / NODE_SPACING) - first;
    const nearStart = Math.max(0, Math.floor((crestS - climb - NEAR_M) / NODE_SPACING) - first);
    const nearEnd = Math.ceil((crestS + descent + NEAR_M) / NODE_SPACING) - first;

    // The ridge lies square to the road's CHORD across it, not to its tangent at the
    // crest: through a corner the chord is the one axis the whole span runs along, so
    // the road crosses the ridge once, forwards, wherever that can be true at all. The
    // check runs `NEAR_M` either side of the span too, so the road just before and just
    // after it is outside the swell's length, and only further road can come back.
    const cx = this.xs[endNode]! - this.xs[startNode]!;
    const cz = this.zs[endNode]! - this.zs[startNode]!;
    const chord = Math.hypot(cx, cz);
    const ax = cx / chord;
    const az = cz / chord;
    let previousU = -Infinity;
    for (let i = nearStart; i <= nearEnd; i++) {
      const u = (this.xs[i]! - x) * ax + (this.zs[i]! - z) * az;
      if (u < previousU + NODE_SPACING * 0.3) return null;
      previousU = u;
    }
    previousU = (this.xs[endNode]! - x) * ax + (this.zs[endNode]! - z) * az;
    // Measured along the axis: a curved approach is shorter in `u` than in arclength.
    const climbS = climb;
    const descentS = descent;
    climb = -((this.xs[startNode]! - x) * ax + (this.zs[startNode]! - z) * az);
    descent = previousU;
    const sag = Math.max(SAG_MIN_M, descent * 0.3);
    if (climb <= TOE_M + crestIn + 20 || descent <= sag + crestOut + 20) return null;

    let core = CORE_MIN_M + roll(8) * CORE_SPREAD_M;
    let fade = FADE_MIN_M + roll(9) * FADE_SPREAD_M;

    const row = this.row;
    const make = (r: number): Swell => {
      row[F_X] = x;
      row[F_Z] = z;
      row[F_AX] = ax;
      row[F_AZ] = az;
      row[F_CLIMB] = climb;
      row[F_DESCENT] = descent;
      row[F_RISE] = r;
      row[F_CREST] = crestIn;
      row[F_CORE] = core;
      row[F_FADE] = fade;
      row[F_CREST_S] = crestS;
      return swellAt(row, 0);
    };
    // A descent has to READ as one: on country the bands are already lifting, a swell
    // whose fall is gentler than that lift leaves a level shelf, which is the plateau
    // this exists to break. So the swell is raised until its descent beats the bands'
    // own grade under it by `DESCENT_READ`, as far as the caps allow; the budget below
    // has the last word.
    const lift =
      (this.landscape.baseHeightAt(this.xs[endNode]!, this.zs[endNode]!) - this.landscape.baseHeightAt(x, z)) / descent;
    rise = Math.max(rise, (Math.max(0, lift) + DESCENT_READ) * (descent - sag / 2 - crestOut / 2));
    rise = Math.min(rise, SWELL_RISE_MAX, CLIMB_GRADE_MAX * (climb - TOE_M / 2 - crestIn / 2));

    // Any other stretch of road within reach must stay off the swell: the swell narrows
    // to keep clear of it (and lowers, so its flank is no steeper than `FLANK_RUN`), or
    // is dropped when that leaves too little. Read off the spine's coarse samples with
    // half their spacing allowed for, which only ever over-narrows; the samples whose
    // whole half-spacing lies inside the monotone run above are this crossing itself.
    const allowance = COARSE_SPACING / 2;
    const ownFrom = crestS - climbS - NEAR_M + allowance;
    const ownTo = crestS + descentS + NEAR_M - allowance;
    let clear = Infinity;
    // Every coarse sample within `PASS_RADIUS_M` of the crest, which is exactly what a
    // whole-road spatial query returns: z only grows along the road, so they all lie in
    // one run of the table around the crest's own sample (see `SwellWalk`).
    const coarseX = this.coarseX;
    const coarseZ = this.coarseZ;
    const r2 = PASS_RADIUS_M * PASS_RADIUS_M;
    let passFrom = Math.round(crestS / COARSE_SPACING);
    let passTo = passFrom;
    while (passFrom > 0 && coarseZ[passFrom - 1]! >= z - PASS_RADIUS_M - PASS_Z_SLACK_M) passFrom--;
    while (passTo + 1 < coarseZ.length && coarseZ[passTo + 1]! <= z + PASS_RADIUS_M + PASS_Z_SLACK_M) passTo++;
    for (let index = passFrom; index <= passTo; index++) {
      const s = index * COARSE_SPACING;
      if (s >= ownFrom && s <= ownTo) continue;
      const dx = coarseX[index]! - x;
      const dz = coarseZ[index]! - z;
      if (dx * dx + dz * dz > r2) continue;
      const u = dx * ax + dz * az;
      if (u <= -climb - allowance || u >= descent + allowance) continue;
      clear = Math.min(clear, Math.abs(dx * az - dz * ax) - allowance - OTHER_PASS_CLEAR_M);
    }
    if (clear < core + fade) {
      core = Math.min(core, Math.max(CORE_FLOOR_M, clear * 0.3));
      fade = clear - core;
      rise = Math.min(rise, fade / FLANK_RUN);
      if (rise < SWELL_RISE_MIN) return null;
    }

    // The budget: drive the weak car over it from the limit, and lower it until it pays.
    // The bands under the road are read once; only the swell changes between attempts.
    const leadNode = Math.max(0, Math.floor((crestS - climbS - LEAD_M) / NODE_SPACING) - first);
    const samples = ((endNode - leadNode) >> 1) + 1;
    if (this.bases.length < samples) this.bases = new Float64Array(samples);
    for (let j = 0; j < samples; j++) {
      const i = leadNode + j * 2;
      this.bases[j] = this.landscape.baseHeightAt(this.xs[i]!, this.zs[i]!);
    }
    for (let attempt = 0; attempt < 8 && rise >= SWELL_RISE_MIN; attempt++) {
      const w = make(rise);
      if (this.lossOver(w, leadNode, samples) <= CLIMB_LOSS_KMH) return w;
      rise *= 0.8;
    }
    return null;
  }

  /**
   * Speed the weak car loses over `samples` road points every second node from
   * `from`, with `w` built on the bands in `bases`, km/h; infinite when the road
   * anywhere through it is steeper than `ROAD_GRADE_MAX` (a swell on top of the bands'
   * own pitch, or crossed on its flank by a corner).
   */
  private lossOver(w: Swell, from: number, samples: number): number {
    const car = WEAK_CAR;
    const g = 9.81;
    const run = NODE_SPACING * 2;
    let v = CRUISE_MS;
    let lowest = v;
    let previous = this.bases[0]! + swellHeight(w, this.xs[from]!, this.zs[from]!);
    for (let j = 1; j < samples; j++) {
      const i = from + j * 2;
      const y = this.bases[j]! + swellHeight(w, this.xs[i]!, this.zs[i]!);
      const slope = (y - previous) / run;
      previous = y;
      if (Math.abs(slope) > ROAD_GRADE_MAX) return Infinity;
      const resist =
        car.massKg * g * (slope / Math.sqrt(1 + slope * slope) + car.rolling) +
        0.6 * car.dragArea * v * v;
      const drive = v < CRUISE_MS ? car.wheelPowerW / v : Math.max(0, resist);
      v = Math.sqrt(Math.max(1, v * v + (2 * (drive - resist) * run) / car.massKg));
      if (v > CRUISE_MS) v = CRUISE_MS;
      if (v < lowest) lowest = v;
    }
    return (CRUISE_MS - lowest) * 3.6;
  }
}
