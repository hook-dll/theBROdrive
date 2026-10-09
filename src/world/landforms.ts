import { hashUnit3 } from '../core/rng';
import { BASIN_OUTER_M, type LakeBasins } from './lakes';
import type { Road } from './road';
import { COARSE_SPACING } from './roadspine';

/**
 * ROADSIDE LANDFORMS: the desert opening a view, or closing one, beside the road.
 *
 * A few times per hundred kilometres the ground beside the road does something at a
 * scale the corridor shapes in `corridorshape.ts` cannot: it falls away into a basin
 * the road runs along the rim of, or it falls away on both sides so the road rides a
 * ridge, or it rises on both sides into walls the road threads between.
 *
 *   rim     one side drops 10-18 m into a broad hollow and climbs back out by 344 m:
 *           the road runs along the lip and the driver sees down into it
 *   ridge   both sides drop 8-14 m: the road rides a spine with the desert below
 *   gap     both sides rise 8-14 m within 144 m: a short cut through high ground
 *
 * THE ROAD DOES NOT MOVE, for the reasons `corridorshape.ts` gives, and nothing here
 * comes nearer the road than `EDGE_M`. The asphalt, the verge, the graded corridor
 * (`CORRIDOR_OUTER`), the director's cuts and embankments (to 62 m), the pole line, the
 * delineators, the birds' perches and the sidetracks (at most 58 m out) all keep exactly
 * the ground they had. The drop starts sixty metres out, on undisturbed desert.
 *
 * A FUNCTION OF WORLD POSITION, NOT OF THE CALLER'S ROAD FRAME. That is what makes it
 * safe in the BASE field, where the lake basins live and where the large shapes have to
 * live: the tile builder only knows an exact arclength within 70 m of the road, past
 * that an `ownerAt` lattice answer that steps, and in its far mode one arclength per
 * tile. So the caller's `s` is only a HINT for finding the event, exactly as for a lake
 * (`lakes.ts`), and the shape is computed from the event's own centreline polyline: the
 * nearest point on it gives an arclength and a signed lateral that are continuous in
 * (x, z) whoever asks. Two tiles, the vista, `Terrain.heightAt` and the scatter all get
 * the same metres at the same point, so there is no step at a chunk or tile join.
 *
 * WHY THE POLYLINE IS UNAMBIGUOUS, which is what the validation below buys:
 *   - on any side the event shapes, the road's radius stays above `MIN_RADIUS_M`, more
 *     than the event's reach, so ground in the footprint is never past the centre of a
 *     bend and has one nearest point on the road;
 *   - no other pass of the road comes within `BRANCH_CLEAR_M` of the footprint, so no
 *     second corridor is graded into a basin wall and every arclength hint near the
 *     footprint belongs to this pass;
 *   - no lake basin is within reach, so the two dug shapes never meet.
 * A slot whose candidates all fail simply has no landform; three candidates per slot
 * keep that rare on open road and frequent in the tight districts, where a basin beside
 * a hairpin cannot be drawn honestly anyway.
 *
 * SLOPES. The steepest face is the rim's drop: 18 m over a 110 m smoothstep, a peak of
 * `1.5 * 18 / 110` = 25%. The corridor batter runs to 35% and the dune faces around it
 * to about 30%, so a car that leaves the road into a basin can climb back out, if not
 * from a standstill on the steepest line. Along the road a 250 m ramp gives at most 11%.
 *
 * DUNES IN THE HOLLOW. The dune relief is full strength by 200 m out, which is exactly
 * where a basin floor is, and a 40 m megadune standing in it would fill the view the
 * basin exists to open. So a falling landform also takes `flatten` of the relief away at
 * full weight; the far wall gets it back as the weight returns to zero.
 */

export type LandformKind = 'rim' | 'ridge' | 'gap';

/** Lateral distance from the centreline inside which nothing here ever applies. */
export const EDGE_M = 64;

interface LandformShape {
  readonly kind: LandformKind;
  /** Share of the draw. */
  readonly weight: number;
  /** Signed metres at full weight (negative: the ground falls away), and its roll. */
  readonly amplitudeMin: number;
  readonly amplitudeSpan: number;
  /** Lateral (from the centreline) where full amplitude is reached, held to, and gone. */
  readonly fullAt: number;
  readonly holdTo: number;
  readonly reach: number;
  /** Share of the dune relief removed at full weight. */
  readonly flatten: number;
  /** Along-road length at full weight, metres, as a base plus a roll. */
  readonly holdMin: number;
  readonly holdSpan: number;
  /** One side only (the rim) or both. */
  readonly oneSided: boolean;
}

const SHAPES: readonly LandformShape[] = [
  {
    kind: 'rim',
    weight: 0.45,
    amplitudeMin: -10,
    amplitudeSpan: -8,
    fullAt: 174,
    holdTo: 214,
    reach: 344,
    flatten: 0.5,
    holdMin: 400,
    holdSpan: 1400,
    oneSided: true,
  },
  {
    kind: 'ridge',
    weight: 0.3,
    amplitudeMin: -8,
    amplitudeSpan: -6,
    fullAt: 174,
    holdTo: 214,
    reach: 344,
    flatten: 0.4,
    holdMin: 300,
    holdSpan: 1200,
    oneSided: false,
  },
  {
    // Short on purpose: a cut is an event, and walls held for two kilometres are a
    // valley.
    kind: 'gap',
    weight: 0.25,
    amplitudeMin: 8,
    amplitudeSpan: 6,
    fullAt: 144,
    holdTo: 184,
    reach: 314,
    flatten: 0,
    holdMin: 200,
    holdSpan: 500,
    oneSided: false,
  },
];

/** The widest any shape reaches; what every bound below is sized from. */
const REACH_M = 344;
/** Along-road smoothstep in and out, metres. */
const RAMP_M = 250;
/** Polyline beyond each ramp, so ground near an end projects inside the line. */
const PAD_M = 64;
/** Polyline spacing, metres, and the stride of the coarse nearest-point pass. */
const POLY_STEP_M = 8;
const COARSE_STRIDE = 6;

/**
 * One candidate slot per this much road, beginning past the home district (30 km), so
 * the opening drive is the authored one. With three tries a slot that passes
 * validation is the common case on open road: about three landforms per 100 km.
 */
const FIRST_LANDFORM_S = 32_000;
const SLOT_M = 22_000;
const TRIES = 3;

/** Smallest radius allowed where a bend's inside faces a shaped side. */
const MIN_RADIUS_M = REACH_M + 80;
/** Clearance between the footprint and any other pass of the road. */
const BRANCH_CLEAR_M = 200;
/** Arclength either side of the polyline that is the road's own continuation. */
const OWN_ROAD_M = REACH_M + BRANCH_CLEAR_M;

/**
 * How far a terrain caller's arclength hint may be from the event's polyline and still
 * find it: the reach plus the far-mode tile's hint error (a tile is 240 m, its owner is
 * taken at its centre), with room.
 */
export const LANDFORM_HINT_WINDOW_M = REACH_M + 400;
/**
 * The vista's hint is the camera's arclength, not the sample's, and its disc is
 * kilometres wide. Six kilometres covers everything a landform is still visible from;
 * past that a 15 m hollow is under a pixel.
 */
export const LANDFORM_VISTA_WINDOW_M = 6_000;

const TAG = 0x4c4e4446; // 'LNDF'
const SALT_KIND = 1;
const SALT_SIDE = 2;
const SALT_HOLD = 3;
const SALT_AMPLITUDE = 4;
const SALT_PLACE = 5;

/** Caller-owned output: metres to add to the open ground, and the dune share to remove. */
export interface LandformSample {
  lift: number;
  flatten: number;
}

export function newLandformSample(): LandformSample {
  return { lift: 0, flatten: 0 };
}

interface Landform {
  readonly shape: LandformShape;
  /** +1 left of travel, -1 right, 0 both sides. */
  readonly side: number;
  readonly amplitude: number;
  /** Arclengths where the along-road ramp starts and ends. */
  readonly s0: number;
  readonly s1: number;
  /** Arclength of the first polyline point, and of the last. */
  readonly polyStart: number;
  readonly polyEnd: number;
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  /** Footprint bounds, reach included. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Lateral profile: zero inside `EDGE_M`, up to full, held, back to nothing by `reach`. */
function acrossWeight(shape: LandformShape, lateral: number): number {
  if (lateral <= EDGE_M || lateral >= shape.reach) return 0;
  const rise = smoothstep01((lateral - EDGE_M) / (shape.fullAt - EDGE_M));
  if (lateral <= shape.holdTo) return rise;
  return rise * (1 - smoothstep01((lateral - shape.holdTo) / (shape.reach - shape.holdTo)));
}

/** Slots resolved per instance before the cache is dropped; values are pure, so it is free. */
const SLOT_CACHE_LIMIT = 48;

/**
 * The landforms of one road. Held by `Terrain`, which adds them to the open ground in
 * `undugOpen` and `horizonHeight`; every worker that owns a `Terrain` resolves the same
 * events from the same seed and road.
 */
export class RoadsideLandforms {
  private readonly slots = new Map<number, Landform | null>();
  /** Scratch for one road sample during resolution. */
  private readonly point = { x: 0, y: 0, z: 0 };
  /** Result of the last `project`: arclength on the polyline and signed lateral. */
  private projS = 0;
  private projLateral = 0;

  constructor(
    private readonly road: Road,
    private readonly seed: number,
    private readonly lakes: LakeBasins,
  ) {}

  /**
   * The landform term at a world point. `hintS` is any arclength near the point; events
   * whose polyline lies more than `window` from it are not considered.
   */
  sample(x: number, z: number, hintS: number, window: number, out: LandformSample): void {
    out.lift = 0;
    out.flatten = 0;
    const first = Math.max(0, Math.floor((hintS - window - FIRST_LANDFORM_S) / SLOT_M));
    const last = Math.floor((hintS + window - FIRST_LANDFORM_S) / SLOT_M);
    for (let k = first; k <= last; k++) {
      const landform = this.landformNear(k, x, z, hintS, window, 0);
      if (landform === null) continue;
      this.project(landform, x, z);
      const along = smoothstep01(Math.min(this.projS - landform.s0, landform.s1 - this.projS) / RAMP_M);
      if (along <= 0) continue;
      if (landform.side !== 0 && Math.sign(this.projLateral) !== landform.side) continue;
      const weight = along * acrossWeight(landform.shape, Math.abs(this.projLateral));
      out.lift += landform.amplitude * weight;
      out.flatten += landform.shape.flatten * weight;
    }
  }

  /**
   * Whether anything here shapes the ground within `margin` of a point. For placement
   * that wants level ground — a desert building does not belong on a basin wall.
   */
  covers(x: number, z: number, hintS: number, margin: number): boolean {
    const window = LANDFORM_HINT_WINDOW_M;
    const first = Math.max(0, Math.floor((hintS - window - FIRST_LANDFORM_S) / SLOT_M));
    const last = Math.floor((hintS + window - FIRST_LANDFORM_S) / SLOT_M);
    for (let k = first; k <= last; k++) {
      const landform = this.landformNear(k, x, z, hintS, window, margin);
      if (landform === null) continue;
      this.project(landform, x, z);
      if (this.projS < landform.s0 - margin || this.projS > landform.s1 + margin) continue;
      if (landform.side !== 0 && Math.sign(this.projLateral) !== landform.side) continue;
      const lateral = Math.abs(this.projLateral);
      if (lateral > EDGE_M - margin && lateral < landform.shape.reach + margin) return true;
    }
    return false;
  }

  /**
   * Slot `k`'s landform when both the hint and the point can be inside it (its bounds
   * grown by `margin`), else null. The bounds test is what makes a miss cheap: nearly
   * every terrain sample ends here.
   */
  private landformNear(
    k: number,
    x: number,
    z: number,
    hintS: number,
    window: number,
    margin: number,
  ): Landform | null {
    const landform = this.slot(k);
    if (landform === null) return null;
    if (hintS < landform.polyStart - window || hintS > landform.polyEnd + window) return null;
    if (x < landform.minX - margin || x > landform.maxX + margin) return null;
    if (z < landform.minZ - margin || z > landform.maxZ + margin) return null;
    return landform;
  }

  /**
   * Nearest point on the event's polyline: a coarse pass over every `COARSE_STRIDE`th
   * vertex, then the segments either side of the winner. Validation guarantees the
   * distance along the line is unimodal for any point that can be shaped, so the
   * coarse winner always brackets the true segment. The lateral is the TRUE distance
   * with the side's sign, so it is continuous across a vertex.
   */
  private project(landform: Landform, x: number, z: number): void {
    const xs = landform.xs;
    const zs = landform.zs;
    const n = xs.length;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i += COARSE_STRIDE) {
      const dx = xs[i]! - x;
      const dz = zs[i]! - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    {
      const dx = xs[n - 1]! - x;
      const dz = zs[n - 1]! - z;
      if (dx * dx + dz * dz < bestD) best = n - 1;
    }
    const lo = Math.max(0, best - COARSE_STRIDE);
    const hi = Math.min(n - 1, best + COARSE_STRIDE);
    let segD = Infinity;
    let segI = lo;
    let segT = 0;
    let cross = 0;
    for (let i = lo; i < hi; i++) {
      const ax = xs[i]!;
      const az = zs[i]!;
      const dx = xs[i + 1]! - ax;
      const dz = zs[i + 1]! - az;
      const len2 = dx * dx + dz * dz;
      let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t - x;
      const pz = az + dz * t - z;
      const d = px * px + pz * pz;
      if (d < segD) {
        segD = d;
        segI = i;
        segT = t;
        // Positive lateral is LEFT of travel, as in `Road.offsetPoint`: forward is
        // (sin h, cos h) and left is (cos h, -sin h) = (dz, -dx) per unit length.
        cross = (x - ax) * dz - (z - az) * dx;
      }
    }
    this.projS = landform.polyStart + (segI + segT) * POLY_STEP_M;
    const distance = Math.sqrt(segD);
    this.projLateral = cross < 0 ? -distance : distance;
  }

  private slot(k: number): Landform | null {
    const hit = this.slots.get(k);
    if (hit !== undefined) return hit;
    if (this.slots.size >= SLOT_CACHE_LIMIT) this.slots.clear();
    let landform: Landform | null = null;
    for (let attempt = 0; attempt < TRIES && landform === null; attempt++) {
      landform = this.resolve(k, attempt);
    }
    this.slots.set(k, landform);
    return landform;
  }

  /** Candidate `attempt` of slot `k`, built and validated; null if it fails. */
  private resolve(k: number, attempt: number): Landform | null {
    const draw = k * TRIES + attempt;
    const shape = pickShape(hashUnit3(this.seed ^ TAG, draw, SALT_KIND));
    const side = shape.oneSided ? (hashUnit3(this.seed ^ TAG, draw, SALT_SIDE) < 0.5 ? -1 : 1) : 0;
    const hold = shape.holdMin + hashUnit3(this.seed ^ TAG, draw, SALT_HOLD) * shape.holdSpan;
    const amplitude =
      shape.amplitudeMin + hashUnit3(this.seed ^ TAG, draw, SALT_AMPLITUDE) * shape.amplitudeSpan;
    const count = Math.ceil((hold + 2 * RAMP_M + 2 * PAD_M) / POLY_STEP_M) + 1;
    const polyLength = (count - 1) * POLY_STEP_M;
    // The polyline lies inside its slot, so a hint near it always looks in this slot.
    const slotStart = FIRST_LANDFORM_S + k * SLOT_M;
    const polyStart = slotStart + hashUnit3(this.seed ^ TAG, draw, SALT_PLACE) * (SLOT_M - polyLength);
    const polyEnd = polyStart + polyLength;
    const s0 = polyStart + PAD_M;
    const s1 = polyEnd - PAD_M;
    if (polyEnd + OWN_ROAD_M >= this.road.length) return null;

    const lake = this.lakes.nearest(0.5 * (polyStart + polyEnd));
    if (lake && lake.s > polyStart - BASIN_OUTER_M - REACH_M && lake.s < polyEnd + BASIN_OUTER_M + REACH_M) {
      return null;
    }

    if (!this.bendsAllow(side, polyStart - REACH_M, polyEnd + REACH_M)) return null;

    const xs = new Float64Array(count);
    const zs = new Float64Array(count);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      this.road.offsetPoint(polyStart + i * POLY_STEP_M, 0, this.point);
      xs[i] = this.point.x;
      zs[i] = this.point.z;
      if (this.point.x < minX) minX = this.point.x;
      if (this.point.x > maxX) maxX = this.point.x;
      if (this.point.z < minZ) minZ = this.point.z;
      if (this.point.z > maxZ) maxZ = this.point.z;
    }
    const reach = shape.reach;
    const landform: Landform = {
      shape,
      side,
      amplitude,
      s0,
      s1,
      polyStart,
      polyEnd,
      xs,
      zs,
      minX: minX - reach,
      maxX: maxX + reach,
      minZ: minZ - reach,
      maxZ: maxZ + reach,
    };
    return this.clearOfOtherPasses(landform) ? landform : null;
  }

  /**
   * No bend whose inside faces a shaped side may be tighter than `MIN_RADIUS_M`, over
   * the event and a reach either side of it. Curvature is the heading's rate of change
   * per polyline step, read off the node table (`Road.headingAt`) rather than the
   * heading field, which would cost a corner-sequence evaluation per sample. Heading
   * increasing turns toward positive lateral (left), so that bend's inside is +1.
   */
  private bendsAllow(side: number, from: number, to: number): boolean {
    const limit = POLY_STEP_M / MIN_RADIUS_M;
    let s = Math.max(0, from);
    let heading = this.road.headingAt(s);
    while (s < to) {
      s += POLY_STEP_M;
      const next = this.road.headingAt(s);
      const turn = next - heading;
      heading = next;
      if (Math.abs(turn) <= limit) continue;
      if (side === 0 || Math.sign(turn) === side) return false;
    }
    return true;
  }

  /**
   * No other pass of the road through the footprint plus `BRANCH_CLEAR_M`. Read off the
   * spine's coarse table (one sample per `COARSE_SPACING`), which is the whole road in
   * memory already: a branch crossing the cleared band cannot slip between two samples
   * 200 m apart without one of them landing in it.
   */
  private clearOfOtherPasses(landform: Landform): boolean {
    const spine = this.road.spine;
    const cx = spine.coarseX;
    const cz = spine.coarseZ;
    const pad = BRANCH_CLEAR_M;
    const minX = landform.minX - pad;
    const maxX = landform.maxX + pad;
    const minZ = landform.minZ - pad;
    const maxZ = landform.maxZ + pad;
    const ownFrom = landform.polyStart - OWN_ROAD_M;
    const ownTo = landform.polyEnd + OWN_ROAD_M;
    const outer = landform.shape.reach + pad;
    for (let k = 0; k < cx.length; k++) {
      const x = cx[k]!;
      const z = cz[k]!;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      const s = k * COARSE_SPACING;
      if (s >= ownFrom && s <= ownTo) continue;
      this.project(landform, x, z);
      if (this.projS < landform.s0 - pad || this.projS > landform.s1 + pad) continue;
      if (landform.side !== 0 && Math.sign(this.projLateral) !== landform.side) continue;
      // Anything nearer than the outer clearance is refused, the near side included: a
      // pass at another arclength that close to the centreline is the road nearly
      // crossing itself, and a basin graded into two corridors is a wall either way.
      if (Math.abs(this.projLateral) < outer) return false;
    }
    return true;
  }
}

function pickShape(roll: number): LandformShape {
  let total = 0;
  for (const shape of SHAPES) total += shape.weight;
  let pick = roll * total;
  for (const shape of SHAPES) {
    pick -= shape.weight;
    if (pick <= 0) return shape;
  }
  return SHAPES[SHAPES.length - 1]!;
}
