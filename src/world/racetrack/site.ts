import { hash, hash01, mulberry32 } from '../../core/rng';
import { BASIN_OUTER_M, type LakeBasins, type LakeSite } from '../lakes';
import type { RoadsideLandforms } from '../landforms';
import { mesaFieldOf } from '../mesas';
import { postSlot } from '../poislots';
import { postBracket, postS } from '../poststops';
import type { Road } from '../road';
import { COARSE_SPACING } from '../roadcurve';
import { RoadDistance } from '../roaddistance';
import { roadHalf, roadsideStop, type RoadsideStop } from '../settlement';
import type { Terrain } from '../terrain';
import { generateLoopSteps, NEIGHBOUR_S_M, TRACK_SURFACE, type TrackLoop, type TrackSector } from './layout';
import { RaceTrack, type LanePoint, type TrackCorner, type TrackPaddock } from './track';

/**
 * WHERE A RACE TRACK STANDS, AND THE GROUND IT STANDS ON.
 *
 * WHICH POSTS. `postHasTrack` is a pure roll per post stop, as `poiHasMachine` is for
 * the machines: never at posts 0 and 1, where the road teaches everything else, and
 * past them at `TRACK_CHANCE`. A roll is only a wish: the track must also find room
 * (below), and about one roll in sixteen does not, so about one settlement in three
 * has one (tools/racetrack-gen.ts counts it: 60 of 180 posts over three seeds).
 *
 * WHERE BESIDE THE POST. Always on the LAY-BY's side, so the access lane leaves the
 * pad without crossing the road: from the pad's outer edge `LANE_ALONG_M` before the
 * stop — the stretch of pad between the slip and the teddy shelter that nothing of
 * the settlement stands on — straight out, then a smooth S onto the paddock gate. The
 * loop is turned so its start straight runs along the road with the paddock on its
 * road side, `TRACK_NEAR_MIN_M`-`TRACK_NEAR_MAX_M` out, slid along the road and tilted a
 * little by the roll.
 * A placement is REJECTED, and the next rolled loop or placement tried, when any of:
 *
 *  - the levelled ground's outer edge comes within `SETTLEMENT_CLEAR_M` of the road's
 *    centreline (the settlement's houses and its levelled site live inside that);
 *  - any other pass of the road, or this one beyond the window searched, comes near;
 *  - a lake basin, a roadside landform or a mesa reaches the levelled ground or the lane;
 *  - the lane would run through a house, cross the track, or bend tighter than 14 m;
 *  - some stretch of it lies farther than `CHUNK_SPREAD_M` along the road from the
 *    rest, so no one chunk could stream it (world/racetrack/mesh.ts);
 *  - the ground is too far from the track's own plane at the run-off's edge to blend
 *    back without a wall (`FIT_MAX_M` over the `SKIRT_M` skirt: about 33% added at most, and the desert half way out the skirt within `SKIRT_FIT_MAX_M`) even
 *    with the profile's relief scaled away.
 *
 * Desert POIs keep off the track instead (`terrain.raceTracks.covers`, world/poi.ts),
 * as the scatter and the desert tiles' props do: the track is the bigger thing.
 *
 * THE HEIGHTS. The lap's profile is the ground under it smoothed along the loop over
 * `PROFILE_SIGMA_M` — so the track follows the land and the skirt has little to do —
 * plus an authored RELIEF: two or three MOUNDS and HOLLOWS 11-18 m high laid in plan (a
 * raised cosine 180-350 m round each, never steeper than `MOUND_SLOPE`), so the lap
 * climbs onto a rise and drops into a bowl and two stretches that pass near each other
 * share one slope; and one or two CRESTS on straights and a DIP along the lap. A crest
 * is a raised cosine whose vertical radius is held at `CREST_RADIUS_M` or more (a car
 * at 100 km/h keeps half its weight over it, and the lap's straights are short enough
 * that little arrives faster); the whole profile is held under `MAX_GRADE`, 11% (`limitGrade` takes any steeper ground down), which
 * a truck with a trailer still climbs. Where two stretches of the loop pass near each
 * other their facing run-off edges are held within `PAIR_SLOPE` of their gap, so the sand between
 * them is a bank and not a wall, and the plane stands within `FIT_MAX_M` of the desert
 * at the run-off's edges: the relief is earthworks, an embankment up to 13 m over a
 * hollow of the desert or a cutting through a rise of it. A relief that breaks any
 * rule is scaled down (`RELIEF_SCALES`) until it does not.
 *
 * THE GROUND: A RASTER, BLENDED IN `Terrain.openBase`. Inside the CORE — the track,
 * its `RUNOFF_M` of sand either side, and the paddock — the ground IS the track's plane
 * (banking carried on across the run-off), so the run-off is level with the asphalt's
 * edge and a car that runs wide drives onto sand, not off a ledge. Over the `SKIRT_M`
 * beyond it the ground smoothsteps back to the desert. The heights come from every
 * nearby stretch at once, weighted by `exp(-excess / SOFT_TAU_M)`, so where two
 * stretches' skirts meet (a hairpin's legs, the infield) the ground is a smooth average
 * and not a crease; inside a core the core's own plane outweighs any other by e^10. A
 * segment is charged `PAST_END_WEIGHT` per metre the point lies beyond its end, so a
 * point takes its own stretch's banking and not an average over the next ten metres
 * of a bank that is ramping up (a banked corner's run-off would otherwise miss its plane
 * by decimetres).
 * The result is stored as `height * weight` and `weight` on a `RASTER_CELL_M` lattice
 * and read bilinearly, which keeps it continuous where the weight falls to zero.
 *
 * It is a function of world position and the seed, computed from the same `Road`,
 * `Landscape`, landforms, basins and mesas in every thread, so the desert tile worker,
 * the vista worker and the main thread all level the same ground. The wheel-scale
 * detail is faded out by the same weight, so the run-off is smooth sand.
 */

/** No track at the first posts: the road's start teaches the rest of the game first. */
const TRACK_FIRST_POST = 2;
/** Share of posts past the first that roll a track (about one in sixteen fails to place). */
const TRACK_CHANCE = 0.33;
const TRACK_DOMAIN = 0x52434531; // 'RCE1'

/** Asphalt half width range: two cars side by side and room to pass. */
const HALF_WIDTH_MIN_M = 4.3;
const HALF_WIDTH_MAX_M = 5.0;
/** Level graded sand beyond each asphalt edge. */
export const RUNOFF_M = 10;
/**
 * Ground beyond the run-off that smoothsteps back into the desert: wide enough that the
 * relief's embankments and cuttings (`FIT_MAX_M`) are a bank and not a wall.
 */
export const SKIRT_M = 60;
/** Nearest the skirt's outer edge comes to the road's centreline. */
const SETTLEMENT_CLEAR_M = 75;
/** Start straight's centreline off the road, range. */
const TRACK_NEAR_MIN_M = 150;
const TRACK_NEAR_MAX_M = 250;
/** How far the start straight's middle may slide along the road from the post. */
const SLIDE_MIN_M = -230;
const SLIDE_MAX_M = 190;
/** The loop may be turned this far off parallel to the road, radians. */
const TILT_MAX = 0.18;
/** Arclength of road either side of the post searched for the road's own distance. */
const ROAD_WINDOW_M = 2500;
const ROAD_STEP_M = 10;

/** The paddock: its depth out from the asphalt and the gap to it; length along. */
const PADDOCK_DEPTH_M = 22;
const PADDOCK_GAP_M = 1.5;
const PADDOCK_LENGTH_M = 56;
/** The finish line's place on the start straight, as a share of its length. */
const FINISH_SHARE = 0.62;

/** The access lane: half width, where it leaves the pad, and how far out it runs straight. */
export const LANE_HALF_WIDTH_M = 3;
const LANE_ALONG_M = -21;
const LANE_OUT_M = 50;
const LANE_GATE_APPROACH_M = 12;
const LANE_MIN_RADIUS_M = 14;
const LANE_STEP_M = 3;

/**
 * Profile and its rules. `MAX_GRADE` is what a loaded truck with a trailer still climbs
 * at race pace (the rivals' autopilot drives the lap as a road).
 */
const PROFILE_SIGMA_M = 55;
const MAX_GRADE = 0.11;
const CREST_RADIUS_M = 170;
const CREST_GRADE = 0.035;
const PAIR_SLOPE = 0.3;
/**
 * The relief's mounds (see `profile`): height range, the steepest slope one has, and the
 * shares of it tried in turn until the rules hold (the last, none, is the ground alone).
 */
const MOUND_MIN_M = 11;
const MOUND_MAX_M = 18;
const MOUND_SLOPE = 0.08;
const RELIEF_SCALES = [1, 0.85, 0.7, 0.55, 0.4, 0.25, 0.25, 0];
/** The grade limiter's rounding (`limitGrade`), and the share of `MAX_GRADE` it aims at. */
const GRADE_EASE_M = 16;
const GRADE_AIM = 0.97;
/**
 * Most the track's plane may stand off the desert at the run-off's edge: the relief's
 * embankment or cutting. Smoothstepped over the skirt, the steepest the blend itself
 * adds is 1.5 x this / `SKIRT_M`: 33%. Half way out the skirt, where the blend is
 * steepest, the desert may stand no farther than `SKIRT_FIT_MAX_M` off the plane carried
 * flat — on a hillside a cutting deepens across the skirt, and that is what makes a wall.
 */
const FIT_MAX_M = SKIRT_M * 0.22;
const SKIRT_FIT_MAX_M = SKIRT_M * 0.2;

/**
 * Raster lattice (3 m: a banked bowl's run-off plane is read within centimetres) and
 * the soft-minimum's length, which grows by `SKIRT_TAU_SHARE` of a node's own excess
 * out across the skirt; the extra excess a segment is charged per metre a node lies
 * beyond its end; and how fast a node inside a core stops listening to other
 * stretches: their excess over its own is multiplied by `1 + depth / CORE_HOLD_M`,
 * depth being how far inside the core it lies, so a banked bowl's run-off is its own
 * plane and not a few per cent of the next leg's (see `buildRaster`).
 */
const RASTER_CELL_M = 3;
const SOFT_TAU_M = 3;
const SKIRT_TAU_SHARE = 0.5;
const PAST_END_WEIGHT = 1.5;
const CORE_HOLD_M = 2;
/** The lane's keep-clear margin beyond its own half width (scatter, props). */
const LANE_CLEAR_M = 5;

/** Loops rolled per post, and placements tried per loop. */
const LOOP_ATTEMPTS = 10;
const PLACEMENTS_PER_LOOP = 3;
/** Sites one thread keeps; anything else is regenerated identically when asked again. */
const SITE_CACHE = 4;
/**
 * One step of a placement (`placeTrackSteps`): raster nodes visited, centreline
 * samples or lane points checked, and rows of the profile's passing-stretches rule,
 * between two yields. Each is a few tenths of a millisecond, so a main-thread placement
 * spread over frames fits beside the rest of one.
 */
const RASTER_STEP_NODES = 8_000;
const PLACE_STEP_SAMPLES = 8;
const PAIR_STEP_ROWS = 48;
/** A track is looked up for terrain samples whose road arclength is this near its post. */
const OWNER_WINDOW_M = 3000;
/**
 * Farthest any stretch of a track, or its lane, may lie from `RaceTrack.chunkS` in road
 * arclength: four and a quarter chunks, inside the physics window (`ROAD_PHYSICS_CHUNKS`)
 * from most of the lap and inside the visual one from all of it.
 */
export const CHUNK_SPREAD_M = 850;

/**
 * Whether post stop `postIndex` (world/poststops.ts) rolls a race track: never at posts
 * 0 and 1, past them by a seeded roll. Pure in (seed, postIndex). The track exists only
 * where `terrain.raceTracks.track(postIndex)` also finds it room.
 */
export function postHasTrack(seed: number, postIndex: number): boolean {
  return postIndex >= TRACK_FIRST_POST && hash01(seed, TRACK_DOMAIN, postIndex) < TRACK_CHANCE;
}

/** What placing a track needs of the world it is placed in; `Terrain` supplies it. */
export interface TrackSiteWorld {
  readonly seed: number;
  readonly road: Road;
  readonly terrain: Terrain;
  /** The open desert WITHOUT any track: `Terrain.openBase`'s ground before the blend. */
  readonly natural: (x: number, z: number, dist: number, s: number) => number;
  readonly landforms: RoadsideLandforms;
  readonly basins: LakeBasins;
}

/** The levelled ground of one track, as a lattice (see the header). */
interface TrackRaster {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  readonly nx: number;
  readonly nz: number;
  /** Track height times blend weight, and the weight, per node (x-major). */
  readonly hw: Float32Array;
  readonly w: Float32Array;
  /** Keep-clear: levelled ground or the lane's corridor. */
  readonly mask: Uint8Array;
}

interface TrackSite {
  readonly track: RaceTrack;
  readonly raster: TrackRaster;
}

type Rand = () => number;

function between(rand: Rand, lo: number, hi: number): number {
  return lo + (hi - lo) * rand();
}

function smoothstep01(t: number): number {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}

/**
 * The road near the post as a polyline, and the distance, arclength and signed lateral
 * of a point from it: exact to the polyline, which at 10 m chords the road's 85 m
 * tightest bend to 15 cm.
 */
class RoadNear {
  private readonly xs: Float64Array;
  private readonly zs: Float64Array;
  readonly s0: number;
  readonly s1: number;
  /** Result of the last `measure`. */
  dist = 0;
  s = 0;
  lateral = 0;

  constructor(road: Road, centreS: number) {
    this.s0 = Math.max(0, centreS - ROAD_WINDOW_M);
    this.s1 = Math.min(road.length, centreS + ROAD_WINDOW_M);
    const count = Math.floor((this.s1 - this.s0) / ROAD_STEP_M) + 1;
    this.xs = new Float64Array(count);
    this.zs = new Float64Array(count);
    const point = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < count; i++) {
      road.offsetPoint(this.s0 + i * ROAD_STEP_M, 0, point);
      this.xs[i] = point.x;
      this.zs[i] = point.z;
    }
  }

  measure(x: number, z: number): this {
    let best = Infinity;
    for (let i = 0; i + 1 < this.xs.length; i++) {
      const ax = this.xs[i]!;
      const az = this.zs[i]!;
      const dx = this.xs[i + 1]! - ax;
      const dz = this.zs[i + 1]! - az;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      const px = x - ax - dx * t;
      const pz = z - az - dz * t;
      const d = px * px + pz * pz;
      if (d < best) {
        best = d;
        this.s = this.s0 + (i + t) * ROAD_STEP_M;
        // LEFT of travel is positive: left of (dx, dz) is (dz, -dx).
        this.lateral = (px * dz - pz * dx) / Math.hypot(dx, dz);
      }
    }
    this.dist = Math.sqrt(best);
    return this;
  }
}

/** Circular Gaussian smoothing of a periodic series sampled every `step` metres. */
function smoothPeriodic(values: Float64Array, step: number, sigma: number): Float64Array {
  const n = values.length;
  const reach = Math.min(Math.floor(n / 2), Math.ceil((3 * sigma) / step));
  const kernel = new Float64Array(reach * 2 + 1);
  let total = 0;
  for (let k = -reach; k <= reach; k++) {
    const weight = Math.exp(-0.5 * ((k * step) / sigma) ** 2);
    kernel[k + reach] = weight;
    total += weight;
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    // values[(i + k) mod n], walked with one wrap rather than two modulos a term.
    let j = (((i - reach) % n) + n) % n;
    for (let k = 0; k <= 2 * reach; k++) {
      sum += values[j]! * kernel[k]!;
      if (++j === n) j = 0;
    }
    out[i] = sum / total;
  }
  return out;
}

/**
 * A closed profile (`step` metres a row) brought under `grade` with the least change in
 * shape: the mean of its upper and lower `grade`-Lipschitz envelopes (the highest such
 * profile under it and the lowest over it — equal to it wherever it is already gentle
 * enough, half way between a spike and the cone over it elsewhere), then Gaussian
 * smoothed over `GRADE_EASE_M`, which keeps the bound and rounds every change of
 * grade the envelopes leave into a vertical curve of `CREST_RADIUS_M` or more.
 */
function limitGrade(ys: Float64Array, step: number, grade: number): Float64Array {
  const n = ys.length;
  const rise = grade * step;
  const upper = Float64Array.from(ys);
  const lower = Float64Array.from(ys);
  // Two rounds of a forward and a backward sweep carry every bound once round the loop.
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n;
      upper[i] = Math.min(upper[i]!, upper[p]! + rise);
      lower[i] = Math.max(lower[i]!, lower[p]! - rise);
    }
    for (let i = n - 1; i >= 0; i--) {
      const q = (i + 1) % n;
      upper[i] = Math.min(upper[i]!, upper[q]! + rise);
      lower[i] = Math.max(lower[i]!, lower[q]! - rise);
    }
  }
  for (let i = 0; i < n; i++) upper[i] = (upper[i]! + lower[i]!) / 2;
  return smoothPeriodic(upper, step, GRADE_EASE_M);
}

/** A loop turned and slid into the world, its table re-based to the finish line. */
interface Placed {
  readonly count: number;
  readonly step: number;
  readonly length: number;
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly headings: Float64Array;
  readonly curvatures: Float64Array;
  readonly banks: Float64Array;
  readonly sectors: TrackSector[];
  readonly corners: TrackCorner[];
  readonly paddock: TrackPaddock;
  /** The start straight in the re-based arclength: [start, end), wrapped through 0. */
  readonly straightStart: number;
  readonly straightEnd: number;
}

function placeLoop(loop: TrackLoop, rand: Rand, road: Road, postArc: number, side: 1 | -1): Placed | null {
  const count = loop.count;
  const step = loop.length / count;
  const straight = loop.pieces[0]!.length;
  const finishLocal = straight * FINISH_SHARE;
  const shift = Math.round(finishLocal / step);
  const finish = shift * step;
  const paddockLength = Math.min(PADDOCK_LENGTH_M, finish - 24);
  if (paddockLength < 30) return null;

  const slide = between(rand, SLIDE_MIN_M, SLIDE_MAX_M);
  const near = between(rand, TRACK_NEAR_MIN_M, TRACK_NEAR_MAX_M);
  const tilt = between(rand, -TILT_MAX, TILT_MAX);
  const anchorS = postArc + slide;
  const anchor = road.sampleAt(anchorS);
  // Turn the loop so the outside of its start straight faces the road (see the header).
  const alpha = anchor.heading + ((side + loop.turn) * Math.PI) / 2 + Math.PI + tilt;
  const ca = Math.cos(alpha);
  const sa = Math.sin(alpha);
  const mid = Math.round(straight / 2 / step);
  const target = road.offsetPoint(anchorS, side * near);
  const ox = target.x - (loop.xs[mid]! * ca + loop.zs[mid]! * sa);
  const oz = target.z - (-loop.xs[mid]! * sa + loop.zs[mid]! * ca);

  const xs = new Float64Array(count);
  const zs = new Float64Array(count);
  const headings = new Float64Array(count);
  const curvatures = new Float64Array(count);
  const banks = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const j = (i + shift) % count;
    const lx = loop.xs[j]!;
    const lz = loop.zs[j]!;
    xs[i] = ox + lx * ca + lz * sa;
    zs[i] = oz - lx * sa + lz * ca;
    headings[i] = loop.headings[j]! + alpha;
    curvatures[i] = loop.curvatures[j]!;
    banks[i] = loop.banks[j]!;
  }
  const wrap = (s: number): number => ((s % loop.length) + loop.length) % loop.length;

  // Sectors re-based to the line and merged where the wrap joins two runs of one kind.
  const sectors: TrackSector[] = [];
  const shifted = loop.sectors
    .flatMap((sector) => {
      const a = sector.startS - finish;
      const b = sector.endS - finish;
      if (a >= 0) return [{ startS: a, endS: b, kind: sector.kind }];
      if (b <= 0) return [{ startS: a + loop.length, endS: b + loop.length, kind: sector.kind }];
      return [
        { startS: 0, endS: b, kind: sector.kind },
        { startS: a + loop.length, endS: loop.length, kind: sector.kind },
      ];
    })
    .sort((p, q) => p.startS - q.startS);
  for (const sector of shifted) {
    const last = sectors[sectors.length - 1];
    if (last && last.kind === sector.kind) sectors[sectors.length - 1] = { ...last, endS: sector.endS };
    else sectors.push(sector);
  }
  const corners: TrackCorner[] = loop.pieces
    .map((piece, i) => ({
      kind: piece.kind,
      startS: wrap(loop.pieceStarts[i]! - finish),
      length: piece.length,
      radius: piece.curvature === 0 ? Infinity : 1 / piece.curvature,
      bank: piece.bank,
    }))
    .sort((p, q) => p.startS - q.startS);
  const paddock: TrackPaddock = {
    s0: loop.length - paddockLength - 4,
    s1: loop.length - 4,
    inner: 0,
    outer: 0,
    side: (-loop.turn) as 1 | -1,
  };
  return {
    count,
    step,
    length: loop.length,
    xs,
    zs,
    headings,
    curvatures,
    banks,
    sectors,
    corners,
    paddock,
    straightStart: loop.length - finish,
    straightEnd: straight - finish,
  };
}

/** A centred raised cosine of full width `width`, for the profile's features. */
function bump(distance: number, width: number): number {
  const u = Math.abs(distance) / (width / 2);
  return u >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * u));
}

interface Feature {
  readonly centre: number;
  readonly width: number;
  readonly amplitude: number;
}

/** A MOUND of the relief (see `profile`): a raised cosine in plan, `radius` round (x, z). */
interface Mound {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly amplitude: number;
}

/**
 * The lap's heights: the ground smoothed along the loop, plus the authored relief —
 * mounds and hollows in PLAN, and crests and a dip on straights along the lap — scaled
 * down until the grade, the passing-stretches rule and the fit to the desert at the
 * run-off's edges (`edges`: the ground there, both sides, every `groundStep` rows) all
 * hold. Null when the ground alone breaks them. Yields once per relief scale tried.
 */
function* profileSteps(
  placed: Placed,
  rand: Rand,
  ground: Float64Array,
  edges: Float64Array,
  groundStep: number,
  halfWidth: number,
): Generator<void, Float64Array | null> {
  const { count, step, length } = placed;
  // The ground under the centreline every `groundStep` rows, smoothed, back on the table.
  let smooth = smoothPeriodic(ground, groundStep * step, PROFILE_SIGMA_M);
  const base = new Float64Array(count);
  const upsample = (series: Float64Array): void => {
    const n = series.length;
    for (let i = 0; i < count; i++) {
      const f = i / groundStep;
      const a = Math.floor(f) % n;
      const t = f - Math.floor(f);
      base[i] = series[a]! + (series[(a + 1) % n]! - series[a]!) * t;
    }
  };
  upsample(smooth);

  const wrapDistance = (a: number, b: number): number => {
    const d = Math.abs(a - b) % length;
    return Math.min(d, length - d);
  };
  // The start straight and 20 m round it carry no feature: the grid stands level-ish.
  const straightMid = (placed.straightStart + (placed.straightEnd + length - placed.straightStart) / 2) % length;
  const straightHalf = (placed.straightEnd + length - placed.straightStart) / 2 + 20;
  const clearOfStart = (centre: number, width: number): boolean => wrapDistance(centre, straightMid) > straightHalf + width / 2;
  const features: Feature[] = [];

  // THE RELIEF: two or three mounds and hollows laid in PLAN, not along the lap. Two
  // stretches that pass near each other (a hairpin's legs) stand on the same slope of
  // the same mound, so they differ by its gradient times their gap — which the
  // passing-stretches rule allows at `MOUND_SLOPE` — where a rise laid along the lap
  // would put the legs of a hairpin metres apart and be scaled away. A mound's radius
  // is held at `amplitude / MOUND_SLOPE x pi/2` or more, so that is also its steepest
  // grade. Each stands with the start straight's middle on its outer fifth, where it is
  // nearly level, so the grid stays level-ish; the second is the first's opposite: a
  // rise and a hollow.
  const startX = placed.xs[Math.round(straightMid / step) % count]!;
  const startZ = placed.zs[Math.round(straightMid / step) % count]!;
  const mounds: Mound[] = [];
  const moundCount = rand() < 0.45 ? 3 : 2;
  let sign = rand() < 0.75 ? 1 : -1;
  for (let m = 0; m < moundCount; m++) {
    const amplitude = between(rand, MOUND_MIN_M, MOUND_MAX_M) * (m === 2 ? 0.6 : 1);
    const radius = Math.max((amplitude * Math.PI) / (2 * MOUND_SLOPE), between(rand, 180, 300));
    for (let tries = 0; tries < 30; tries++) {
      const i = Math.floor(rand() * count);
      const angle = rand() * Math.PI * 2;
      const off = rand() * radius * 0.4;
      const x = placed.xs[i]! + Math.cos(angle) * off;
      const z = placed.zs[i]! + Math.sin(angle) * off;
      if (Math.hypot(x - startX, z - startZ) < radius * 0.75) continue;
      if (mounds.some((other) => Math.hypot(x - other.x, z - other.z) < (radius + other.radius) * 0.4)) continue;
      mounds.push({ x, z, radius, amplitude: sign * amplitude });
      break;
    }
    sign = -sign;
  }
  const relief = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let y = 0;
    for (const mound of mounds) y += mound.amplitude * bump(Math.hypot(placed.xs[i]! - mound.x, placed.zs[i]! - mound.z), 2 * mound.radius);
    relief[i] = y;
  }
  // Crests on the longer straights, a dip on one more.
  const straights = placed.corners.filter((c) => c.kind === 'straight' && c.length >= 70);
  let crests = 0;
  let dips = 0;
  for (const straight of straights) {
    const width = Math.min(straight.length - 16, 130);
    const centre = (straight.startS + straight.length / 2) % length;
    if (!clearOfStart(centre, width)) continue;
    // Held under `CREST_RADIUS_M` of vertical radius and `CREST_GRADE` of slope: the
    // grade budget is the relief's (see `MOUND_SLOPE`).
    const limit = Math.min((width * width) / (2 * Math.PI * Math.PI * CREST_RADIUS_M), (CREST_GRADE * width) / Math.PI);
    if (crests < 2 && rand() < 0.7) {
      features.push({ centre, width, amplitude: Math.min(3, limit) * between(rand, 0.7, 1) });
      crests++;
    } else if (dips < 1 && rand() < 0.6) {
      features.push({ centre, width, amplitude: -Math.min(2.6, limit) * between(rand, 0.7, 1) });
      dips++;
    }
  }

  const ys = new Float64Array(count);
  const core = halfWidth + RUNOFF_M;
  const reach = 2 * (core + SKIRT_M);
  const stride = 4;
  const grid = new Map<number, number[]>();
  const key = (cx: number, cz: number): number => cx * 73_856_093 + cz * 19_349_663;
  for (let i = 0; i < count; i += stride) {
    const k = key(Math.floor(placed.xs[i]! / reach), Math.floor(placed.zs[i]! / reach));
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(i);
  }
  function* holdsSteps(): Generator<void, boolean> {
    for (let i = 0; i < count; i++) {
      if (Math.abs(ys[(i + 1) % count]! - ys[i]!) / step > MAX_GRADE) return false;
    }
    for (let k = 0; k * groundStep < count; k++) {
      const i = k * groundStep;
      for (let side = 0; side < 2; side++) {
        const lateral = (side === 0 ? -1 : 1) * core;
        if (Math.abs(ys[i]! - placed.banks[i]! * lateral - edges[k * 4 + side]!) > FIT_MAX_M) return false;
        // Half way out the skirt: the plane carried flat from the run-off's edge.
        if (Math.abs(ys[i]! - placed.banks[i]! * lateral - edges[k * 4 + 2 + side]!) > SKIRT_FIT_MAX_M) return false;
      }
    }
    for (let i = 0; i < count; i += stride) {
      if ((i / stride) % PAIR_STEP_ROWS === PAIR_STEP_ROWS - 1) yield;
      const cx = Math.floor(placed.xs[i]! / reach);
      const cz = Math.floor(placed.zs[i]! / reach);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of grid.get(key(cx + dx, cz + dz)) ?? []) {
            if (j <= i || Math.min(j - i, count - (j - i)) * step < NEIGHBOUR_S_M) continue;
            const d = Math.hypot(placed.xs[j]! - placed.xs[i]!, placed.zs[j]! - placed.zs[i]!);
            if (d >= reach) continue;
            // The run-off edges that face each other, with their banking: the sand
            // between them is what must be a bank.
            const hi = placed.headings[i]!;
            const hj = placed.headings[j]!;
            const ex = placed.xs[j]! - placed.xs[i]!;
            const ez = placed.zs[j]! - placed.zs[i]!;
            const edgeI = ys[i]! - placed.banks[i]! * Math.sign(ex * Math.cos(hi) - ez * Math.sin(hi)) * core;
            const edgeJ = ys[j]! + placed.banks[j]! * Math.sign(ex * Math.cos(hj) - ez * Math.sin(hj)) * core;
            if (Math.abs(edgeI - edgeJ) > PAIR_SLOPE * Math.max(0, d - 2 * core) + 0.5) return false;
          }
        }
      }
    }
    return true;
  }

  for (let pass = 0; pass < RELIEF_SCALES.length; pass++) {
    yield;
    // The relief shrinks pass by pass; the last but one also smooths the ground harder,
    // the last drops the relief altogether.
    const scale = RELIEF_SCALES[pass]!;
    if (pass === RELIEF_SCALES.length - 2) {
      smooth = smoothPeriodic(ground, groundStep * step, PROFILE_SIGMA_M * 2);
      upsample(smooth);
    }
    for (let i = 0; i < count; i++) {
      let y = base[i]! + relief[i]! * scale;
      const s = i * step;
      for (const feature of features) y += feature.amplitude * scale * bump(wrapDistance(s, feature.centre), feature.width);
      ys[i] = y;
    }
    ys.set(limitGrade(ys, step, MAX_GRADE * GRADE_AIM));
    yield;
    if (yield* holdsSteps()) return ys;
  }
  return null;
}

/** One strip of levelled ground: a polyline with the plane it carries and its core. */
interface Strip {
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly ys: Float64Array;
  readonly banks: Float64Array;
  readonly closed: boolean;
  /** Half width of the level core; the plane's banking is carried this far and no further. */
  readonly core: number;
}

/**
 * The levelled ground's lattice (see the header): two passes over every strip segment's
 * neighbourhood, the first for the least excess over a core, the second for the
 * soft-minimum's weighted heights. Yields every `RASTER_STEP_NODES` nodes visited.
 */
function* buildRasterSteps(strips: readonly Strip[], lane: readonly LanePoint[]): Generator<void, TrackRaster> {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const strip of strips) {
    const reach = strip.core + SKIRT_M + RASTER_CELL_M;
    for (let i = 0; i < strip.xs.length; i++) {
      minX = Math.min(minX, strip.xs[i]! - reach);
      maxX = Math.max(maxX, strip.xs[i]! + reach);
      minZ = Math.min(minZ, strip.zs[i]! - reach);
      maxZ = Math.max(maxZ, strip.zs[i]! + reach);
    }
  }
  const laneReach = LANE_HALF_WIDTH_M + LANE_CLEAR_M + RASTER_CELL_M;
  for (const point of lane) {
    minX = Math.min(minX, point.x - laneReach);
    maxX = Math.max(maxX, point.x + laneReach);
    minZ = Math.min(minZ, point.z - laneReach);
    maxZ = Math.max(maxZ, point.z + laneReach);
  }
  minX = Math.floor(minX / RASTER_CELL_M) * RASTER_CELL_M;
  minZ = Math.floor(minZ / RASTER_CELL_M) * RASTER_CELL_M;
  const nx = Math.ceil((maxX - minX) / RASTER_CELL_M) + 1;
  const nz = Math.ceil((maxZ - minZ) / RASTER_CELL_M) + 1;
  const nodes = nx * nz;
  const excess = new Float64Array(nodes).fill(Infinity);
  const sumK = new Float64Array(nodes);
  const sumKH = new Float64Array(nodes);

  let visited = 0;
  function* visit(pass: 0 | 1): Generator<void, void> {
    for (const strip of strips) {
      const n = strip.xs.length;
      const segments = strip.closed ? n : n - 1;
      const reach = strip.core + SKIRT_M + 1;
      for (let a = 0; a < segments; a++) {
        const b = (a + 1) % n;
        const ax = strip.xs[a]!;
        const az = strip.zs[a]!;
        const dx = strip.xs[b]! - ax;
        const dz = strip.zs[b]! - az;
        const lengthSq = dx * dx + dz * dz;
        if (lengthSq <= 0) continue;
        const inv = 1 / Math.sqrt(lengthSq);
        const i0 = Math.max(0, Math.floor((Math.min(ax, ax + dx) - reach - minX) / RASTER_CELL_M));
        const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, ax + dx) + reach - minX) / RASTER_CELL_M));
        const j0 = Math.max(0, Math.floor((Math.min(az, az + dz) - reach - minZ) / RASTER_CELL_M));
        const j1 = Math.min(nz - 1, Math.ceil((Math.max(az, az + dz) + reach - minZ) / RASTER_CELL_M));
        visited += (i1 - i0 + 1) * (j1 - j0 + 1);
        for (let i = i0; i <= i1; i++) {
          const px = minX + i * RASTER_CELL_M - ax;
          for (let j = j0; j <= j1; j++) {
            const pz = minZ + j * RASTER_CELL_M - az;
            const along = (px * dx + pz * dz) / lengthSq;
            const t = Math.min(1, Math.max(0, along));
            const fx = px - dx * t;
            const fz = pz - dz * t;
            const d = Math.sqrt(fx * fx + fz * fz);
            const e = d - strip.core;
            if (e > SKIRT_M) continue;
            const node = i * nz + j;
            if (pass === 0) {
              if (e < excess[node]!) excess[node] = e;
              continue;
            }
            const over = (e - excess[node]!) * (1 + Math.max(0, -excess[node]!) / CORE_HOLD_M);
            // Out in the skirt the soft-minimum widens, so where two stretches' skirts
            // meet the ground goes from one's height to the other's over metres in
            // proportion to the gap, not in a crease.
            const tau = SOFT_TAU_M + SKIRT_TAU_SHARE * Math.max(0, excess[node]!);
            if (over > tau * 12) continue;
            const lateral = Math.max(-strip.core, Math.min(strip.core, (fx * dz - fz * dx) * inv));
            // Heights carry on along the segment past its ends (up to the core's half
            // width), so a strip's open end — the paddock's — keeps the lap's grade
            // instead of holding its last row's.
            const spill = strip.core * inv;
            const y = strip.ys[a]! + (strip.ys[b]! - strip.ys[a]!) * Math.min(1 + spill, Math.max(-spill, along));
            const bank = strip.banks[a]! + (strip.banks[b]! - strip.banks[a]!) * t;
            // Charged for lying past the segment's end (see the header): its own segment's
            // banking, not an average over the ramp either side.
            const past = Math.abs(along - t) * Math.sqrt(lengthSq);
            // Faded to nothing at the skirt's outer edge, where the segment stops being
            // visited: a wide soft-minimum would otherwise switch it on as a step.
            const k = Math.exp(-(over + PAST_END_WEIGHT * past) / tau) * (1 - smoothstep01(Math.max(0, e) / SKIRT_M));
            sumK[node] += k;
            sumKH[node] += k * (y - bank * lateral);
          }
        }
        if (visited >= RASTER_STEP_NODES) {
          visited = 0;
          yield;
        }
      }
    }
  }
  yield;
  yield* visit(0);
  yield* visit(1);
  yield;

  const hw = new Float32Array(nodes);
  const w = new Float32Array(nodes);
  const mask = new Uint8Array(nodes);
  for (let node = 0; node < nodes; node++) {
    if (node % (8 * RASTER_STEP_NODES) === 8 * RASTER_STEP_NODES - 1) yield;
    if (sumK[node]! <= 0) continue;
    const weight = 1 - smoothstep01(excess[node]! / SKIRT_M);
    if (weight <= 0) continue;
    w[node] = weight;
    hw[node] = (sumKH[node]! / sumK[node]!) * weight;
    mask[node] = 1;
  }
  yield;
  // The lane's corridor is kept clear of props but not levelled: it is draped on the sand.
  const laneClear = LANE_HALF_WIDTH_M + LANE_CLEAR_M;
  for (let p = 0; p + 1 < lane.length; p++) {
    const ax = lane[p]!.x;
    const az = lane[p]!.z;
    const dx = lane[p + 1]!.x - ax;
    const dz = lane[p + 1]!.z - az;
    const lengthSq = dx * dx + dz * dz || 1;
    const i0 = Math.max(0, Math.floor((Math.min(ax, ax + dx) - laneClear - minX) / RASTER_CELL_M));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, ax + dx) + laneClear - minX) / RASTER_CELL_M));
    const j0 = Math.max(0, Math.floor((Math.min(az, az + dz) - laneClear - minZ) / RASTER_CELL_M));
    const j1 = Math.min(nz - 1, Math.ceil((Math.max(az, az + dz) + laneClear - minZ) / RASTER_CELL_M));
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const px = minX + i * RASTER_CELL_M - ax;
        const pz = minZ + j * RASTER_CELL_M - az;
        const t = Math.min(1, Math.max(0, (px * dx + pz * dz) / lengthSq));
        if (Math.hypot(px - dx * t, pz - dz * t) <= laneClear) mask[i * nz + j] = 1;
      }
    }
  }
  return { minX, minZ, maxX: minX + (nx - 1) * RASTER_CELL_M, maxZ: minZ + (nz - 1) * RASTER_CELL_M, nx, nz, hw, w, mask };
}

/** The access lane's polyline, or null when it cannot be laid smoothly. */
function accessLane(road: Road, postArc: number, side: 1 | -1, padOuter: number, gate: LanePoint, gateOut: LanePoint): LanePoint[] | null {
  const laneS = postArc + LANE_ALONG_M;
  const a = road.offsetPoint(laneS, side * padOuter);
  const b = road.offsetPoint(laneS, side * LANE_OUT_M);
  const outX = (b.x - a.x) / (LANE_OUT_M - padOuter);
  const outZ = (b.z - a.z) / (LANE_OUT_M - padOuter);
  const c = { x: gate.x + gateOut.x * LANE_GATE_APPROACH_M, z: gate.z + gateOut.z * LANE_GATE_APPROACH_M };
  const span = Math.hypot(c.x - b.x, c.z - b.z);
  // Out of the pad square to the road, a cubic onto the gate's approach, in through it.
  const handle = span / 3;
  const p1 = { x: b.x + outX * handle, z: b.z + outZ * handle };
  const p2 = { x: c.x + gateOut.x * handle, z: c.z + gateOut.z * handle };
  const points: LanePoint[] = [];
  const straightOut = Math.max(1, Math.ceil((LANE_OUT_M - padOuter) / LANE_STEP_M));
  for (let i = 0; i < straightOut; i++) {
    const t = i / straightOut;
    points.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  }
  const curveSteps = Math.max(4, Math.ceil((span * 1.3) / LANE_STEP_M));
  for (let i = 0; i <= curveSteps; i++) {
    const t = i / curveSteps;
    const u = 1 - t;
    points.push({
      x: u * u * u * b.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * c.x,
      z: u * u * u * b.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * c.z,
    });
  }
  const inSteps = Math.ceil(LANE_GATE_APPROACH_M / LANE_STEP_M);
  for (let i = 1; i <= inSteps; i++) {
    const t = i / inSteps;
    points.push({ x: c.x + (gate.x - c.x) * t, z: c.z + (gate.z - c.z) * t });
  }
  // Tightest turn: the circle through three consecutive points.
  for (let i = 1; i + 1 < points.length; i++) {
    const p = points[i - 1]!;
    const q = points[i]!;
    const r = points[i + 1]!;
    const ab = Math.hypot(q.x - p.x, q.z - p.z);
    const bc = Math.hypot(r.x - q.x, r.z - q.z);
    const ca = Math.hypot(p.x - r.x, p.z - r.z);
    const cross = Math.abs((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
    if (cross > 1e-9 && (ab * bc * ca) / (2 * cross) < LANE_MIN_RADIUS_M) return null;
  }
  return points;
}

/**
 * Tries one rolled loop at a few placements beside the post; the first that passes
 * every rule (see the header) becomes the track. Yields between the rules' passes, and
 * every `PLACE_STEP_SAMPLES` points inside the dearer ones.
 */
function* tryLoopSteps(
  world: TrackSiteWorld,
  distance: RoadDistance,
  postIndex: number,
  stop: RoadsideStop,
  loop: TrackLoop,
  rand: Rand,
  near: RoadNear,
): Generator<void, TrackSite | null> {
  const road = world.road;
  const postArc = stop.roll.s;
  const side = stop.layout.side;
  const pad = stop.pad!;
  const halfWidth = between(rand, HALF_WIDTH_MIN_M, HALF_WIDTH_MAX_M);
  const core = halfWidth + RUNOFF_M;
  const mesas = mesaFieldOf(road, world.terrain);
  const coarse: number[] = [];
  for (let placement = 0; placement < PLACEMENTS_PER_LOOP; placement++) {
    yield;
    const placed = placeLoop(loop, rand, road, postArc, side);
    if (!placed) return null;
    const { count, xs, zs, step } = placed;
    const paddock: TrackPaddock = {
      ...placed.paddock,
      inner: halfWidth + PADDOCK_GAP_M,
      outer: halfWidth + PADDOCK_GAP_M + PADDOCK_DEPTH_M,
    };

    // The levelled ground's edge clears the settlement, and the road's own distance and
    // arclength are kept per centreline sample for the ground reads below.
    const groundStep = 8;
    const samples = Math.ceil(count / groundStep);
    const roadDist = new Float64Array(samples);
    const roadS = new Float64Array(samples);
    let clear = true;
    for (let k = 0; k < samples && clear; k++) {
      if (k % (4 * PLACE_STEP_SAMPLES) === 4 * PLACE_STEP_SAMPLES - 1) yield;
      near.measure(xs[k * groundStep]!, zs[k * groundStep]!);
      roadDist[k] = near.dist;
      roadS[k] = near.s;
      if (near.dist < SETTLEMENT_CLEAR_M + SKIRT_M + core) clear = false;
    }
    if (!clear) continue;
    // The chunk that builds the track is the one at the mean road arclength of its
    // centreline; every stretch of it, and the lane's start at the post, stays within
    // `CHUNK_SPREAD_M` of that, so the owner chunk is streamed wherever the player is on it.
    let chunkS = 0;
    for (let k = 0; k < samples; k++) chunkS += roadS[k]!;
    chunkS /= samples;
    if (Math.abs(postArc - chunkS) > CHUNK_SPREAD_M) continue;
    for (let k = 0; k < samples && clear; k++) if (Math.abs(roadS[k]! - chunkS) > CHUNK_SPREAD_M) clear = false;
    if (!clear) continue;
    // The paddock's corners, and the gate the lane comes in at.
    const paddockS = [paddock.s0, (paddock.s0 + paddock.s1) / 2, paddock.s1];
    const sampleAt = (s: number): { x: number; z: number; heading: number } => {
      const i = Math.round(s / step) % count;
      return { x: xs[i]!, z: zs[i]!, heading: placed.headings[i]! };
    };
    for (const s of paddockS) {
      const at = sampleAt(s);
      const lateral = paddock.side * (paddock.outer + 2);
      near.measure(at.x + Math.cos(at.heading) * lateral, at.z - Math.sin(at.heading) * lateral);
      if (near.dist < SETTLEMENT_CLEAR_M + SKIRT_M) clear = false;
    }
    if (!clear) continue;

    // No other pass of the road, nor this one past the window, anywhere near.
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < count; i++) {
      cx += xs[i]!;
      cz += zs[i]!;
    }
    cx /= count;
    cz /= count;
    let radius = 0;
    for (let i = 0; i < count; i += 8) radius = Math.max(radius, Math.hypot(xs[i]! - cx, zs[i]! - cz));
    const found = distance.coarseNear(cx, cz, radius + core + SKIRT_M + 300 + COARSE_SPACING / 2, coarse);
    for (let k = 0; k < found && clear; k++) {
      const s = coarse[k]! * COARSE_SPACING;
      if (s < near.s0 + 200 || s > near.s1 - 200) clear = false;
    }
    if (!clear) continue;
    yield;

    // The gate, and the lane to it.
    const gateAt = sampleAt((paddock.s0 + paddock.s1) / 2);
    const gateLateral = paddock.side * paddock.outer;
    const gate = { x: gateAt.x + Math.cos(gateAt.heading) * gateLateral, z: gateAt.z - Math.sin(gateAt.heading) * gateLateral };
    const gateOut = { x: Math.cos(gateAt.heading) * paddock.side, z: -Math.sin(gateAt.heading) * paddock.side };
    const lane = accessLane(road, postArc, side, pad.padOuter, gate, gateOut);
    if (!lane) continue;
    const laneStraight = Math.ceil((LANE_OUT_M - pad.padOuter) / LANE_STEP_M);
    for (let p = laneStraight; p < lane.length && clear; p++) {
      if ((p - laneStraight) % PLACE_STEP_SAMPLES === PLACE_STEP_SAMPLES - 1) yield;
      const point = lane[p]!;
      near.measure(point.x, point.z);
      if (near.dist < LANE_OUT_M - 6) clear = false;
      if (Math.abs(near.s - chunkS) > CHUNK_SPREAD_M) clear = false;
      // Not through a house of the settlement.
      for (const house of stop.layout.houses) {
        const { along, across } = roadHalf(house.halfX, house.halfZ);
        if (Math.abs(near.s - house.s) <= along + LANE_CLEAR_M && Math.abs(near.lateral - house.lateral) <= across + LANE_CLEAR_M) clear = false;
      }
      if (world.landforms.covers(point.x, point.z, near.s, LANE_HALF_WIDTH_M + 6)) clear = false;
      if (mesas.blocks(point.x, point.z, LANE_HALF_WIDTH_M + 10)) clear = false;
      // Not across the track: the lane stays a run-off and a half from its centreline.
      for (let i = 0; i < count && clear; i += 4) {
        if (Math.hypot(xs[i]! - point.x, zs[i]! - point.z) < core + LANE_HALF_WIDTH_M + 4) clear = false;
      }
    }
    if (!clear) continue;

    // Lakes, landforms and mesas off the levelled ground.
    const lakes = new Set<LakeSite>();
    for (let s = near.s0; s <= near.s1; s += 400) {
      const lake = world.basins.nearest(s);
      if (lake) lakes.add(lake);
    }
    const lakeCentres = [...lakes].map((lake) => road.offsetPoint(lake.s, lake.lateral));
    const reachOut = core + SKIRT_M;
    for (let k = 0; k < samples && clear; k++) {
      if (k % PLACE_STEP_SAMPLES === PLACE_STEP_SAMPLES - 1) yield;
      const x = xs[k * groundStep]!;
      const z = zs[k * groundStep]!;
      for (const centre of lakeCentres) {
        if (Math.hypot(centre.x - x, centre.z - z) < BASIN_OUTER_M + reachOut + 30) clear = false;
      }
      if (k % 2 === 0 && world.landforms.covers(x, z, roadS[k]!, reachOut + 10)) clear = false;
      if (k % 2 === 0 && mesas.blocks(x, z, reachOut + 30)) clear = false;
    }
    for (const point of lane) {
      for (const centre of lakeCentres) {
        if (Math.hypot(centre.x - point.x, centre.z - point.z) < BASIN_OUTER_M + LANE_HALF_WIDTH_M + 20) clear = false;
      }
    }
    if (!clear) continue;

    // The ground under the centreline, at the run-off's edges and at the skirt's middle
    // either side, then the heights. The edges are held to the chunk spread too: where
    // the road bends round a track, an edge can lie nearer another stretch of road than
    // its centreline does.
    const ground = new Float64Array(samples);
    const edges = new Float64Array(samples * 4);
    for (let k = 0; k < samples; k++) {
      if (k % PLACE_STEP_SAMPLES === PLACE_STEP_SAMPLES - 1) yield;
      const i = k * groundStep;
      ground[k] = world.natural(xs[i]!, zs[i]!, roadDist[k]!, roadS[k]!);
      for (let side = 0; side < 4; side++) {
        const lateral = (side % 2 === 0 ? -1 : 1) * (side < 2 ? core : core + SKIRT_M / 2);
        const x = xs[i]! + Math.cos(placed.headings[i]!) * lateral;
        const z = zs[i]! - Math.sin(placed.headings[i]!) * lateral;
        near.measure(x, z);
        if (side < 2 && Math.abs(near.s - chunkS) > CHUNK_SPREAD_M) clear = false;
        edges[k * 4 + side] = world.natural(x, z, near.dist, near.s);
      }
    }
    if (!clear) continue;
    const ys = yield* profileSteps(placed, rand, ground, edges, groundStep, halfWidth);
    if (!ys) continue;
    yield;

    // Accepted. The surfaces by row, the paddock strip, the ground lattice.
    const surfaces = new Uint8Array(count);
    for (const sector of placed.sectors) {
      const from = Math.max(0, Math.round(sector.startS / step));
      const to = Math.min(count, Math.round(sector.endS / step));
      surfaces.fill(TRACK_SURFACE[sector.kind], from, to);
    }
    // The track's plane every other row: the 2 m chord is centimetres off the 1 m table
    // on the tightest hairpin, and halves the lattice's build.
    const strideRows = Math.floor(count / 2);
    const trackStrip: Strip = {
      xs: new Float64Array(strideRows),
      zs: new Float64Array(strideRows),
      ys: new Float64Array(strideRows),
      banks: new Float64Array(strideRows),
      closed: true,
      core,
    };
    for (let r = 0; r < strideRows; r++) {
      const i = Math.round((r * count) / strideRows) % count;
      (trackStrip.xs as Float64Array)[r] = xs[i]!;
      (trackStrip.zs as Float64Array)[r] = zs[i]!;
      (trackStrip.ys as Float64Array)[r] = ys[i]!;
      (trackStrip.banks as Float64Array)[r] = placed.banks[i]!;
    }
    const paddockRows = Math.round((paddock.s1 - paddock.s0) / 2) + 1;
    const paddockMid = paddock.side * (paddock.inner + paddock.outer) / 2;
    const paddockStrip: Strip = {
      xs: new Float64Array(paddockRows),
      zs: new Float64Array(paddockRows),
      ys: new Float64Array(paddockRows),
      banks: new Float64Array(paddockRows),
      closed: false,
      core: (paddock.outer - paddock.inner) / 2 + 2,
    };
    for (let r = 0; r < paddockRows; r++) {
      const s = paddock.s0 + ((paddock.s1 - paddock.s0) * r) / (paddockRows - 1);
      const i = Math.round(s / step) % count;
      (paddockStrip.xs as Float64Array)[r] = xs[i]! + Math.cos(placed.headings[i]!) * paddockMid;
      (paddockStrip.zs as Float64Array)[r] = zs[i]! - Math.sin(placed.headings[i]!) * paddockMid;
      (paddockStrip.ys as Float64Array)[r] = ys[i]!;
    }
    const raster = yield* buildRasterSteps([trackStrip, paddockStrip], lane);
    yield;
    const track = new RaceTrack({
      postIndex,
      postS: postArc,
      chunkS,
      side,
      halfWidth,
      runoffM: RUNOFF_M,
      xs,
      zs,
      ys,
      headings: placed.headings,
      curvatures: placed.curvatures,
      banks: placed.banks,
      surfaces,
      sectors: placed.sectors,
      corners: placed.corners,
      paddock,
      accessLane: lane,
      laneHalfWidth: LANE_HALF_WIDTH_M,
      turn: loop.turn,
    });
    return { track, raster };
  }
  return null;
}

/**
 * The track at a post, placed, or null when it has none or no placement fits: a
 * generator whose steps are each a small part of the work (`RASTER_STEP_NODES`,
 * `PLACE_STEP_SAMPLES`), so the main thread can spread one placement over frames.
 */
function* placeTrackSteps(world: TrackSiteWorld, distance: RoadDistance, postIndex: number): Generator<void, TrackSite | null> {
  if (!postHasTrack(world.seed, postIndex)) return null;
  const stop = roadsideStop(world.seed, postSlot(postIndex));
  if (!stop || !stop.pad || !stop.layout.settlement) return null;
  const rand = mulberry32(hash(world.seed, TRACK_DOMAIN, postIndex, 1));
  const near = new RoadNear(world.road, stop.roll.s);
  for (let attempt = 0; attempt < LOOP_ATTEMPTS; attempt++) {
    yield;
    let loop: TrackLoop | null = null;
    for (let roll = 0; roll < 12 && !loop; roll++) {
      yield;
      loop = yield* generateLoopSteps(rand);
    }
    if (!loop) continue;
    const site = yield* tryLoopSteps(world, distance, postIndex, stop, loop, rand, near);
    if (site) return site;
  }
  return null;
}

/**
 * Every race track of one `Terrain`, and the ground they level: owned by the terrain
 * (`terrain.raceTracks`) and read by it in `openBase`, the detail layers and the vista,
 * so every mesh and collider in every thread agrees (see the header).
 *
 * A terrain sample asks with its road arclength; only posts within `OWNER_WINDOW_M` of
 * it are looked at, and a placement makes sure every road arclength its ground can be
 * owned by lies within that window. The last answer is kept, because the terrain asks
 * for the blend and then for the detail's share at the same point.
 *
 * Placing one track is tens of milliseconds. A sample that finds its track unplaced
 * places it there and then, whole; the main thread places them ahead of its samples
 * instead, a step at a time (`prepareSteps`, driven per chunk by `RaceTrackSiteProvider`).
 */
export class RaceTrackField {
  private readonly sites = new Map<number, TrackSite | null>();
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private lastS = Number.NaN;
  private lastW = 0;
  private lastHW = 0;
  private lastMask = false;
  /** Whole-road coarse index for the other-pass test; built on the first placement. */
  private distance: RoadDistance | null = null;
  /** Placements `prepareSteps` started and has not finished, by post; resumed by either caller. */
  private readonly placing = new Map<number, Generator<void, TrackSite | null>>();

  constructor(private readonly world: TrackSiteWorld) {}

  /** The race track beside post stop `postIndex`, or null when it has none. */
  track(postIndex: number): RaceTrack | null {
    return this.site(postIndex)?.track ?? null;
  }

  /** `open` ground blended into any track's levelled ground at a point. */
  level(x: number, z: number, s: number, open: number): number {
    this.lookup(x, z, s);
    return this.lastW > 0 ? open * (1 - this.lastW) + this.lastHW : open;
  }

  /** Share of the wheel-scale detail kept at a point: none on a track's levelled core. */
  detailShare(x: number, z: number, s: number): number {
    this.lookup(x, z, s);
    return 1 - this.lastW;
  }

  /**
   * Whether a point is on a track's levelled ground or in its lane's corridor: where
   * nothing of the desert (scatter, tile props, desert buildings) may stand.
   */
  covers(x: number, z: number, s: number): boolean {
    this.lookup(x, z, s);
    return this.lastMask;
  }

  /**
   * The open desert at a point as it would be with no track: what the levelling blends
   * from. For the bench, which measures what the skirt adds to the desert's own slope.
   */
  naturalAt(x: number, z: number, dist: number, s: number): number {
    return this.world.natural(x, z, dist, s);
  }

  /**
   * Places, a step per yield, every track a terrain sample at a road arclength between
   * `fromS` and `toS` would look up (see `lookup`), so that sample finds it placed. A
   * placement left part-way is resumed by the next caller, this or `site`.
   */
  *prepareSteps(fromS: number, toS: number): Generator<void, void> {
    const seed = this.world.seed;
    const first = Math.max(TRACK_FIRST_POST, postBracket(seed, Math.max(0, fromS)).before - 1);
    const last = postBracket(seed, Math.max(0, toS)).after + 1;
    for (let k = first; k <= last; k++) {
      if (this.sites.has(k) || !postHasTrack(seed, k)) continue;
      const at = postS(seed, k);
      if (at < fromS - OWNER_WINDOW_M || at > toS + OWNER_WINDOW_M) continue;
      // Re-checked every step: a sample may have needed it meanwhile and finished it.
      while (!this.sites.has(k)) {
        const step = this.placement(k).next();
        if (step.done) this.store(k, step.value);
        else yield;
      }
    }
  }

  private site(postIndex: number): TrackSite | null {
    const hit = this.sites.get(postIndex);
    if (hit !== undefined) return hit;
    const steps = this.placement(postIndex);
    let step = steps.next();
    while (!step.done) step = steps.next();
    this.store(postIndex, step.value);
    return step.value;
  }

  /** The placement of a post in flight, started if there is none. */
  private placement(postIndex: number): Generator<void, TrackSite | null> {
    let steps = this.placing.get(postIndex);
    if (!steps) {
      this.distance ??= new RoadDistance(this.world.road);
      steps = placeTrackSteps(this.world, this.distance, postIndex);
      this.placing.set(postIndex, steps);
    }
    return steps;
  }

  /** Files a finished placement, dropping the oldest held track past `SITE_CACHE`. */
  private store(postIndex: number, site: TrackSite | null): void {
    this.placing.delete(postIndex);
    if (site) {
      let held = 0;
      for (const value of this.sites.values()) if (value) held++;
      if (held >= SITE_CACHE) {
        for (const [key, value] of this.sites) {
          if (!value) continue;
          this.sites.delete(key);
          break;
        }
      }
    }
    this.sites.set(postIndex, site);
  }

  private lookup(x: number, z: number, s: number): void {
    if (x === this.lastX && z === this.lastZ && s === this.lastS) return;
    this.lastX = x;
    this.lastZ = z;
    this.lastS = s;
    this.lastW = 0;
    this.lastHW = 0;
    this.lastMask = false;
    const seed = this.world.seed;
    const { before, after } = postBracket(seed, Math.max(0, s));
    for (let k = Math.max(TRACK_FIRST_POST, before - 1); k <= after + 1; k++) {
      // Cached first: the roll is a hash with a rest array, and this runs per vertex.
      let site = this.sites.get(k);
      if (site === undefined) {
        if (Math.abs(postS(seed, k) - s) > OWNER_WINDOW_M) continue;
        site = this.site(k);
      }
      if (!site || Math.abs(site.track.postS - s) > OWNER_WINDOW_M) continue;
      const raster = site.raster;
      if (x < raster.minX || x > raster.maxX || z < raster.minZ || z > raster.maxZ) continue;
      const fx = (x - raster.minX) / RASTER_CELL_M;
      const fz = (z - raster.minZ) / RASTER_CELL_M;
      const i = Math.min(raster.nx - 2, Math.floor(fx));
      const j = Math.min(raster.nz - 2, Math.floor(fz));
      const u = fx - i;
      const v = fz - j;
      const a = i * raster.nz + j;
      const b = a + raster.nz;
      const w =
        (raster.w[a]! * (1 - v) + raster.w[a + 1]! * v) * (1 - u) + (raster.w[b]! * (1 - v) + raster.w[b + 1]! * v) * u;
      const mask = raster.mask[Math.round(fx) * raster.nz + Math.round(fz)] === 1;
      if (w <= 0 && !mask) continue;
      this.lastW = w;
      this.lastHW =
        (raster.hw[a]! * (1 - v) + raster.hw[a + 1]! * v) * (1 - u) + (raster.hw[b]! * (1 - v) + raster.hw[b + 1]! * v) * u;
      this.lastMask = mask;
      return;
    }
  }
}
